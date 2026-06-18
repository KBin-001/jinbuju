const cloud = require("wx-server-sdk");
const { createStagePlanProvider } = require("./stage-ai");
const { buildStageFallback } = require("./stage-fallback");
const { buildStagePrompt, buildStageRepairPrompt } = require("./stage-prompt");
const {
  fingerprintStageInput,
  parseStageAiJson,
  validateStageGenerationInput,
  validateStagePlan,
  validateStageRequestId,
} = require("./stage-validate");
const { stableId } = require("./repository");

const db = cloud.database();
const command = db.command;
const MAX_GENERATIONS_PER_STAGE = 3;
const RATE_LIMIT_MILLISECONDS = 60 * 1000;
const PREVIEW_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
const STAGE_REVIEW_AI_TIMEOUT_MS = 32000;
const STAGE_REVIEW_REPAIR_TIMEOUT_MS = 22000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function getRequest(openid, requestId) {
  const id = stableId("stage_generation", `${openid}:${requestId}`);
  const result = await db
    .collection("stage_generation_requests")
    .doc(id)
    .get()
    .catch(() => null);
  return (result && result.data) || null;
}

async function getPreview(openid, previewId) {
  const result = await db
    .collection("stage_previews")
    .doc(previewId)
    .get()
    .catch(() => null);
  const preview = result && result.data;
  return preview && preview._openid === openid ? preview : null;
}

function publicPreview(preview, reused) {
  const generatedBy = ["ai", "ai_repaired", "template"].includes(preview.generatedBy)
    ? preview.generatedBy
    : "template";
  return {
    previewId: String(preview._id),
    requestId: String(preview.requestId),
    stageNumber: Number(preview.stageNumber),
    generatedBy,
    generationSource: generatedBy,
    stagePlan: preview.stagePlan,
    reused,
    fallbackReason: preview.fallbackReason || "",
    modelId: preview.modelId || "",
    providerGroup: preview.providerGroup || "",
  };
}

async function reserveGeneration(
  openid,
  requestId,
  input,
  fingerprint,
  regenerate,
) {
  const requestDocId = stableId("stage_generation", `${openid}:${requestId}`);
  const previewId = stableId("stage_preview", `${openid}:${requestId}`);
  const existing = await getRequest(openid, requestId);
  if (existing) {
    if (existing.status === "generated" && existing.previewId) {
      const preview = await getPreview(openid, existing.previewId);
      if (preview) return { existingPreview: preview };
    }
    fail("STAGE_GENERATION_IN_PROGRESS", "当前阶段正在生成，请稍后再试。");
  }

  const generated = await db
    .collection("stage_generation_requests")
    .where({
      _openid: openid,
      inputFingerprint: fingerprint,
      stageNumber: input.stageNumber,
      status: "generated",
    })
    .limit(MAX_GENERATIONS_PER_STAGE)
    .get();
  if (!regenerate && generated.data.length > 0) {
    for (const request of generated.data) {
      if (!request.previewId) continue;
      const preview = await getPreview(openid, request.previewId);
      if (preview) return { existingPreview: preview };
    }
  }
  if (generated.data.length >= MAX_GENERATIONS_PER_STAGE) {
    fail("STAGE_GENERATION_LIMIT_REACHED", "当前阶段的调整次数已用完。");
  }

  const cutoff = new Date(Date.now() - RATE_LIMIT_MILLISECONDS);
  const recent = await db
    .collection("stage_generation_requests")
    .where({
      _openid: openid,
      createdAt: command.gte(cutoff),
    })
    .limit(1)
    .get();
  if (recent.data.length) {
    fail("RATE_LIMITED", "生成得有点快，请稍等一分钟再试。");
  }

  await db.collection("stage_generation_requests").doc(requestDocId).set({
    data: {
      _openid: openid,
      requestId,
      previewId,
      inputFingerprint: fingerprint,
      stageNumber: input.stageNumber,
      status: "processing",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  return { requestDocId, previewId };
}

async function savePreview(
  openid,
  reservation,
  requestId,
  input,
  fingerprint,
  stagePlan,
  generatedBy,
  metadata = {},
) {
  const expiresAt = new Date(Date.now() + PREVIEW_LIFETIME_MILLISECONDS);
  await db.collection("stage_previews").doc(reservation.previewId).set({
    data: {
      _openid: openid,
      requestId,
      inputFingerprint: fingerprint,
      stageNumber: input.stageNumber,
      generationInput: input,
      stagePlan,
      generatedBy,
      fallbackReason: metadata.fallbackReason || "",
      modelId: metadata.modelId || "",
      providerGroup: metadata.providerGroup || "",
      generationDurationMs: Number(metadata.generationDurationMs || 0),
      totalTokens: Number(metadata.totalTokens || 0),
      status: "preview",
      expiresAt,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  await db
    .collection("stage_generation_requests")
    .doc(reservation.requestDocId)
    .update({
      data: {
        status: "generated",
        generatedBy,
        updatedAt: db.serverDate(),
      },
    });
  const preview = await getPreview(openid, reservation.previewId);
  return publicPreview(preview, false);
}

async function generateWithInput(openid, event, input) {
  const requestId = validateStageRequestId(event && event.requestId);
  const fingerprint = fingerprintStageInput(input);
  const generationStartedAt = Date.now();
  const reservation = await reserveGeneration(
    openid,
    requestId,
    input,
    fingerprint,
    event && event.regenerate === true,
  );
  if (reservation.existingPreview) {
    return publicPreview(reservation.existingPreview, true);
  }

  let stagePlan;
  let generatedBy = "template";
  let fallbackReason = "";
  let modelId = "";
  let providerGroup = "";
  let totalTokens = 0;
  if (!event.forceFallback) {
    const provider = createStagePlanProvider();
    let firstOutput = "";
    try {
      const result = await provider.generateStagePlanWithMetadata(
        buildStagePrompt(input),
        input.previousReview ? STAGE_REVIEW_AI_TIMEOUT_MS : 18000,
        {
          action: "submitStageReview",
          promptVersion: "stage-review-next-v1",
          schemaVersion: "stage-plan-v1",
          stageNumber: input.stageNumber,
          durationDays: input.durationDays,
          dailyMinutes: input.dailyMinutes,
          hasPreviousReview: Boolean(input.previousReview),
          hasFocusAdjustment: Boolean(input.previousReview && input.previousReview.focusAdjustment),
          hasPreviousPlanSummary: Boolean(input.previousReview && input.previousReview.previousPlanSummary),
          repairAttempted: false,
        },
      );
      firstOutput = result.text;
      modelId = result.metadata.modelId || "";
      providerGroup = result.metadata.providerGroup || "";
      totalTokens += Number(result.metadata.totalTokens || 0);
      stagePlan = validateStagePlan(parseStageAiJson(firstOutput), input);
      generatedBy = "ai";
      console.info("stage review next generation accepted", {
        action: "submitStageReview",
        stageNumber: input.stageNumber,
        generatedBy,
        modelId,
        providerGroup,
        generationDurationMs: Date.now() - generationStartedAt,
        totalTokens,
      });
    } catch (firstError) {
      fallbackReason = firstError.code || "AI_REQUEST_FAILED";
      console.warn("stage generation attempt failed", {
        action: "submitStageReview",
        code: fallbackReason,
        stageNumber: input.stageNumber,
        hasFocusAdjustment: Boolean(input.previousReview && input.previousReview.focusAdjustment),
        hasPreviousPlanSummary: Boolean(input.previousReview && input.previousReview.previousPlanSummary),
      });
      try {
        const repaired = await provider.generateStagePlanWithMetadata(
          buildStageRepairPrompt(input, firstOutput),
          input.previousReview ? STAGE_REVIEW_REPAIR_TIMEOUT_MS : 16000,
          {
            action: "submitStageReviewRepair",
            promptVersion: "stage-review-next-v1",
            schemaVersion: "stage-plan-v1",
            stageNumber: input.stageNumber,
            durationDays: input.durationDays,
            dailyMinutes: input.dailyMinutes,
            hasPreviousReview: Boolean(input.previousReview),
            hasFocusAdjustment: Boolean(input.previousReview && input.previousReview.focusAdjustment),
            hasPreviousPlanSummary: Boolean(input.previousReview && input.previousReview.previousPlanSummary),
            repairAttempted: true,
            fallbackReason,
          },
        );
        modelId = repaired.metadata.modelId || modelId;
        providerGroup = repaired.metadata.providerGroup || providerGroup;
        totalTokens += Number(repaired.metadata.totalTokens || 0);
        stagePlan = validateStagePlan(parseStageAiJson(repaired.text), input);
        generatedBy = "ai_repaired";
        fallbackReason = "";
        console.info("stage review next generation repaired", {
          action: "submitStageReview",
          stageNumber: input.stageNumber,
          generatedBy,
          modelId,
          providerGroup,
          generationDurationMs: Date.now() - generationStartedAt,
          totalTokens,
        });
      } catch (repairError) {
        fallbackReason = repairError.code || fallbackReason || "AI_REQUEST_FAILED";
        console.warn("stage generation using template", {
          action: "submitStageReview",
          code: fallbackReason,
          stageNumber: input.stageNumber,
          generationDurationMs: Date.now() - generationStartedAt,
        });
      }
    }
  } else {
    fallbackReason = "FORCE_FALLBACK";
  }
  if (!stagePlan) {
    stagePlan = validateStagePlan(buildStageFallback(input), input);
  }
  return savePreview(
    openid,
    reservation,
    requestId,
    input,
    fingerprint,
    stagePlan,
    generatedBy,
    {
      fallbackReason,
      modelId,
      providerGroup,
      generationDurationMs: Date.now() - generationStartedAt,
      totalTokens,
    },
  );
}

async function generateStagePlan(openid, event) {
  const input = validateStageGenerationInput(event && event.input);
  return generateWithInput(openid, event, input);
}

async function generateTrustedStagePlan(openid, event, input) {
  return generateWithInput(
    openid,
    event,
    validateStageGenerationInput(input, true),
  );
}

module.exports = {
  generateStagePlan,
  generateTrustedStagePlan,
};
