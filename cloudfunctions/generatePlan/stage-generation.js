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
  if (!event.forceFallback) {
    const provider = createStagePlanProvider();
    let firstOutput = "";
    try {
      firstOutput = await provider.generateStagePlan(
        buildStagePrompt(input),
        18000,
      );
      stagePlan = validateStagePlan(parseStageAiJson(firstOutput), input);
      generatedBy = "ai";
    } catch (firstError) {
      console.warn("stage generation attempt failed", {
        code: firstError.code || "AI_REQUEST_FAILED",
        stageNumber: input.stageNumber,
      });
      try {
        const repaired = await provider.generateStagePlan(
          buildStageRepairPrompt(input, firstOutput),
          16000,
        );
        stagePlan = validateStagePlan(parseStageAiJson(repaired), input);
        generatedBy = "ai";
      } catch (repairError) {
        console.warn("stage generation using template", {
          code: repairError.code || "AI_REQUEST_FAILED",
          stageNumber: input.stageNumber,
        });
      }
    }
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
