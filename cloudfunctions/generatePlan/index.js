const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { generateText } = require("./ai");
const { submitCheckin, getCheckinStatus } = require("./checkin");
const { formatBusinessDate } = require("./date");
const { buildFallbackPlan } = require("./fallback");
const { createManualTask, getHomeData, toggleTask } = require("./home");
const { completePlanActions } = require("./plan-window");
const { buildPrompt, buildRepairPrompt } = require("./prompt");
const {
  adoptPlan,
  adoptNextWeekPlan,
  deleteCurrentPlan,
  ensureCollections,
  enforceRateLimit,
  getCurrentPlan,
  hasActiveGoal,
  hashPlan,
  recordGeneration,
  verifyGeneratedPlan,
} = require("./repository");
const {
  archivePlan,
  continueExpiredPlan,
  getNextWeekContext,
  getPlanPageData,
  pausePlan,
  postponeTask,
  resumePlan,
  updatePlanTime,
} = require("./plan-management");
const { getMyTeam, joinTeam, sendEncouragement, syncTeamActivity } = require("./team");
const {
  deleteUserData,
  getCommunityEntry,
  getProfileData,
} = require("./profile");
const {
  parseAiJson,
  validateGoal,
  validatePlan,
  validateRequestId,
} = require("./validate");
const { generateStagePlan } = require("./stage-generation");
const {
  confirmStagePlan,
  getStagePreview,
  getStageReview,
  submitStageReview,
} = require("./stage-management");
const {
  analyzeGoal,
  submitGoalClarification,
} = require("./goal-analysis");
const {
  applyStageOptimization,
  createStagePreview,
  optimizeStagePreview,
  regenerateStagePreview,
  updateStagePreviewTask,
} = require("./stage-v2");

function success(data) {
  return { success: true, data };
}

function failure(error) {
  const allowedCodes = [
    "INVALID_ARGUMENT",
    "INVALID_PLAN_DURATION",
    "UNAUTHORIZED",
    "GOAL_ALREADY_EXISTS",
    "PLAN_SCHEMA_INVALID",
    "RATE_LIMITED",
    "GOAL_NOT_FOUND",
    "PLAN_NOT_FOUND",
    "PLAN_NOT_ACTIVE",
    "PLAN_EXPIRED",
    "PLAN_ALREADY_COMPLETED",
    "PLAN_WINDOW_ALREADY_GENERATED",
    "PLAN_WINDOW_INVALID",
    "MANUAL_ACTION_INVALID",
    "ACTION_ROLLOVER_FAILED",
    "TASK_NOT_FOUND",
    "CHECKIN_ALREADY_EXISTS",
    "PLAN_PAUSED",
    "PLAN_STATUS_INVALID",
    "TASK_NOT_ELIGIBLE",
    "TASK_ALREADY_POSTPONED",
    "PLAN_DATE_EXCEEDED",
    "TASK_ALREADY_EXISTS",
    "STAGE_NOT_FOUND",
    "TEAM_NOT_FOUND",
    "NOT_TEAM_MEMBER",
    "ALREADY_IN_TEAM",
    "TEAM_FULL",
    "CANNOT_ENCOURAGE_SELF",
    "MEMBER_NOT_FOUND",
    "ENCOURAGEMENT_ALREADY_SENT",
    "USER_NOT_FOUND",
    "COMMUNITY_LOCKED",
    "COMMUNITY_CONFIG_NOT_FOUND",
    "DELETE_CONFIRMATION_INVALID",
    "DELETE_IN_PROGRESS",
    "DATA_DELETE_FAILED",
    "STAGE_ALREADY_EXISTS",
    "STAGE_GENERATION_IN_PROGRESS",
    "STAGE_GENERATION_LIMIT_REACHED",
    "AI_REQUEST_FAILED",
    "AI_RESPONSE_INVALID",
    "AI_RESPONSE_SCHEMA_INVALID",
    "STAGE_PREVIEW_NOT_FOUND",
    "STAGE_ALREADY_CONFIRMED",
    "ACTIVE_GOAL_ALREADY_EXISTS",
    "STAGE_REVIEW_NOT_ALLOWED",
    "STAGE_REVIEW_ALREADY_EXISTS",
    "STAGE_OPTIMIZATION_IN_PROGRESS",
    "STAGE_OPTIMIZATION_LIMIT_REACHED",
    "STAGE_OPTIMIZATION_NOT_READY",
    "STAGE_PREVIEW_CONFLICT",
    "GOAL_ANALYSIS_NOT_FOUND",
    "GOAL_ANALYSIS_EXPIRED",
    "GOAL_ANALYSIS_SCHEMA_INVALID",
    "GOAL_ANALYSIS_SAVE_FAILED",
    "GOAL_ANALYSIS_RELOAD_FAILED",
    "PREVIEW_NOT_FOUND",
    "PREVIEW_EXPIRED",
    "PREVIEW_ALREADY_CONFIRMED",
    "PREVIEW_NOT_READY",
    "PREVIEW_REGENERATION_IN_PROGRESS",
    "INVALID_FEEDBACK_TYPE",
    "INVALID_FEEDBACK_NOTE",
    "STAGE_REGENERATION_LIMIT_REACHED",
    "STAGE_REGENERATION_FAILED",
    "STAGE_REGENERATION_SCHEMA_INVALID",
    "STAGE_REGENERATION_QUALITY_FAILED",
    "STAGE_FEEDBACK_NOT_RESOLVED",
    "PREVIEW_VERSION_MISMATCH",
  ];
  const code = allowedCodes.includes(error.code) ? error.code : "INTERNAL_ERROR";
  if (code === "INTERNAL_ERROR") {
    console.error("generatePlan internal error sanitized", {
      originalCode: error && error.code ? String(error.code).slice(0, 80) : "UNKNOWN",
      message: error && error.message ? String(error.message).slice(0, 200) : "",
    });
  }
  const messages = {
    INVALID_ARGUMENT: error.message,
    INVALID_PLAN_DURATION: error.message,
    UNAUTHORIZED: "用户身份无效，请重新进入小程序。",
    GOAL_ALREADY_EXISTS: error.message,
    PLAN_SCHEMA_INVALID: "计划内容暂时不可用，请重新生成。",
    RATE_LIMITED: error.message,
    GOAL_NOT_FOUND: "当前目标不存在，请重新进入小程序。",
    PLAN_NOT_FOUND: "当前计划不存在，请重新进入小程序。",
    PLAN_NOT_ACTIVE: error.message,
    PLAN_EXPIRED: error.message,
    PLAN_ALREADY_COMPLETED: error.message,
    PLAN_WINDOW_ALREADY_GENERATED: error.message,
    PLAN_WINDOW_INVALID: error.message,
    MANUAL_ACTION_INVALID: error.message,
    ACTION_ROLLOVER_FAILED: error.message,
    TASK_NOT_FOUND: "今日暂无任务安排。",
    TASK_ALREADY_EXISTS: "任务已创建，请勿重复提交。",
    CHECKIN_ALREADY_EXISTS: "今天已经打过卡了，明天继续加油。",
    PLAN_PAUSED: error.message,
    PLAN_STATUS_INVALID: error.message,
    TASK_NOT_ELIGIBLE: error.message,
    TASK_ALREADY_POSTPONED: error.message,
    PLAN_DATE_EXCEEDED: error.message,
    STAGE_NOT_FOUND: error.message,
    TEAM_NOT_FOUND: error.message,
    NOT_TEAM_MEMBER: error.message,
    ALREADY_IN_TEAM: error.message,
    TEAM_FULL: error.message,
    CANNOT_ENCOURAGE_SELF: error.message,
    MEMBER_NOT_FOUND: error.message,
    ENCOURAGEMENT_ALREADY_SENT: error.message,
    USER_NOT_FOUND: "用户信息不存在，请重新进入小程序。",
    COMMUNITY_LOCKED: error.message,
    COMMUNITY_CONFIG_NOT_FOUND: error.message,
    DELETE_CONFIRMATION_INVALID: error.message,
    DELETE_IN_PROGRESS: "数据正在清除，请勿重复提交。",
    DATA_DELETE_FAILED: "数据暂时未能清除，请稍后重试。",
    STAGE_ALREADY_EXISTS: error.message,
    STAGE_GENERATION_IN_PROGRESS: error.message,
    STAGE_GENERATION_LIMIT_REACHED: error.message,
    AI_REQUEST_FAILED: "行动阶段暂时无法生成，请稍后重试。",
    AI_RESPONSE_INVALID: "生成结果格式暂时不可用，请重新生成。",
    AI_RESPONSE_SCHEMA_INVALID: "生成结果未通过安全校验，请重新生成。",
    STAGE_PREVIEW_NOT_FOUND: "阶段预览已失效，请重新生成。",
    STAGE_ALREADY_CONFIRMED: "当前阶段已经确认。",
    ACTIVE_GOAL_ALREADY_EXISTS: error.message,
    STAGE_REVIEW_NOT_ALLOWED: error.message,
    STAGE_REVIEW_ALREADY_EXISTS: error.message,
    STAGE_OPTIMIZATION_IN_PROGRESS: error.message,
    STAGE_OPTIMIZATION_LIMIT_REACHED: error.message,
    STAGE_OPTIMIZATION_NOT_READY: error.message,
    STAGE_PREVIEW_CONFLICT: error.message,
    GOAL_ANALYSIS_NOT_FOUND: error.message,
    GOAL_ANALYSIS_EXPIRED: error.message,
    GOAL_ANALYSIS_SCHEMA_INVALID: error.message,
    GOAL_ANALYSIS_SAVE_FAILED: error.message,
    GOAL_ANALYSIS_RELOAD_FAILED: error.message,
    PREVIEW_NOT_FOUND: "计划预览已失效，请重新生成。",
    PREVIEW_EXPIRED: "计划预览已过期，请重新生成。",
    PREVIEW_ALREADY_CONFIRMED: "当前计划已经确认。",
    PREVIEW_NOT_READY: "方案尚未准备好，请稍后重试。",
    PREVIEW_REGENERATION_IN_PROGRESS: "AI 正在重新生成方案，请稍后。",
    INVALID_FEEDBACK_TYPE: error.message,
    INVALID_FEEDBACK_NOTE: error.message,
    STAGE_REGENERATION_LIMIT_REACHED: "重新生成次数已用完。",
    STAGE_REGENERATION_FAILED: "暂时没有生成新的方案，当前方案已经保留。",
    STAGE_REGENERATION_SCHEMA_INVALID: "重新生成方案未通过安全校验，请重试。",
    STAGE_REGENERATION_QUALITY_FAILED: "重新生成方案未通过质量检查，请重试。",
    STAGE_FEEDBACK_NOT_RESOLVED: error.message,
    PREVIEW_VERSION_MISMATCH: error.message,
    INTERNAL_ERROR: "服务暂时不可用，请稍后重试。",
  };
  return {
    success: false,
    error: {
      code,
      message: messages[code],
    },
  };
}

async function generate(event, openid) {
  const startedAt = Date.now();
  const fallbackDeadline = startedAt + 48000;
  const goal = validateGoal(event.goal);
  const requestId = validateRequestId(event.requestId);
  await enforceRateLimit(openid, requestId, event.forceFallback === true);
  await recordGeneration(openid, requestId, event.forceFallback ? "fallback" : "pending", "processing");

  let plan;
  let source = "fallback";
  if (!event.forceFallback) {
    let firstOutput = "";
    try {
      firstOutput = await generateText(buildPrompt(goal, formatBusinessDate()), 18000);
      plan = validatePlan(parseAiJson(firstOutput), goal);
      source = "ai";
    } catch (firstError) {
      console.warn("generatePlan first AI attempt failed", {
        requestId,
        code: firstError.code || "AI_GENERATION_FAILED",
        message: String(firstError.message || "").slice(0, 160),
      });
      try {
        const remainingMilliseconds = fallbackDeadline - Date.now();
        if (remainingMilliseconds < 5000) {
          const timeoutError = new Error("AI_REPAIR_SKIPPED");
          timeoutError.code = "AI_REPAIR_SKIPPED";
          throw timeoutError;
        }
        const repairedOutput = await generateText(
          buildRepairPrompt(goal, firstOutput, formatBusinessDate()),
          Math.min(16000, remainingMilliseconds),
        );
        plan = validatePlan(parseAiJson(repairedOutput), goal);
        source = "ai";
      } catch (repairError) {
        console.warn("generatePlan AI fallback", {
          requestId,
          code: repairError.code || "AI_GENERATION_FAILED",
          message: String(repairError.message || "").slice(0, 160),
        });
      }
    }
  }

  if (!plan) {
    plan = validatePlan(buildFallbackPlan(goal), goal);
  }
  plan.source = source;
  await recordGeneration(openid, requestId, source, "generated", hashPlan(plan));
  return success({ requestId, plan });
}

async function adopt(event, openid) {
  const goal = validateGoal(event.goal);
  const requestId = validateRequestId(event.requestId);
  const plan = validatePlan(event.plan, goal);
  await verifyGeneratedPlan(openid, requestId, plan);
  const result = await adoptPlan(openid, requestId, goal, plan);
  return success(result);
}

async function checkActive(openid) {
  return success({ hasActiveGoal: await hasActiveGoal(openid) });
}

async function getCurrent(openid) {
  return success({ currentPlan: await getCurrentPlan(openid) });
}

async function deleteCurrent(openid) {
  return success(await deleteCurrentPlan(openid));
}

async function getHome(openid) {
  return success(await getHomeData(openid));
}

async function generateNextWeek(event, openid) {
  const context = await getNextWeekContext(openid, event.planId);
  const requestId = validateRequestId(event.requestId);
  await enforceRateLimit(openid, requestId, event.forceFallback === true);
  await recordGeneration(openid, requestId, event.forceFallback ? "fallback" : "pending", "processing");

  let plan;
  let source = "fallback";
  if (!event.forceFallback) {
    let firstOutput = "";
    try {
      firstOutput = await generateText(
        buildPrompt(context.goal, context.nextStartDate),
        18000,
      );
      plan = validatePlan(
        parseAiJson(firstOutput),
        context.goal,
        context.nextStartDate,
      );
      source = "ai";
    } catch (firstError) {
      console.warn("generateNextWeek first AI attempt failed", {
        requestId,
        code: firstError.code || "AI_GENERATION_FAILED",
      });
      try {
        const repairedOutput = await generateText(
          buildRepairPrompt(context.goal, firstOutput, context.nextStartDate),
          16000,
        );
        plan = validatePlan(
          parseAiJson(repairedOutput),
          context.goal,
          context.nextStartDate,
        );
        source = "ai";
      } catch (repairError) {
        console.warn("generateNextWeek AI fallback", {
          requestId,
          code: repairError.code || "AI_GENERATION_FAILED",
        });
      }
    }
  }
  if (!plan) {
    plan = validatePlan(
      buildFallbackPlan(context.goal, context.nextStartDate),
      context.goal,
      context.nextStartDate,
    );
  }
  plan.source = source;
  await recordGeneration(openid, requestId, source, "generated", hashPlan(plan));
  return success({
    requestId,
    previousPlanId: context.plan._id,
    plan,
  });
}

async function adoptNextWeek(event, openid) {
  const context = await getNextWeekContext(openid, event.planId);
  const requestId = validateRequestId(event.requestId);
  const plan = validatePlan(event.plan, context.goal, context.nextStartDate);
  await verifyGeneratedPlan(openid, requestId, plan);
  return success(
    await adoptNextWeekPlan(
      openid,
      requestId,
      context.goal,
      context.plan,
      plan,
    ),
  );
}

async function handleToggleTask(event, openid) {
  return success(await toggleTask(openid, event));
}

async function handleCreateManualTask(event, openid) {
  return success(await createManualTask(openid, event));
}

async function handleSubmitCheckin(event, openid) {
  return success(await submitCheckin(openid, event));
}

async function handleGetCheckinStatus(openid) {
  return success(await getCheckinStatus(openid));
}

exports.main = async (event) => {
  try {
    const context = cloud.getWXContext();
    if (!context.OPENID) {
      const error = new Error("Missing OPENID");
      error.code = "UNAUTHORIZED";
      throw error;
    }

    await ensureCollections();

    if (event.action === "generate") {
      return await generate(event, context.OPENID);
    }
    if (event.action === "adopt") {
      return await adopt(event, context.OPENID);
    }
    if (event.action === "checkActive") {
      return await checkActive(context.OPENID);
    }
    if (event.action === "getCurrent") {
      return await getCurrent(context.OPENID);
    }
    if (event.action === "deleteCurrent") {
      return await deleteCurrent(context.OPENID);
    }
    if (event.action === "getHomeData") {
      return await getHome(context.OPENID);
    }
    if (event.action === "submitCheckin") {
      return await handleSubmitCheckin(event, context.OPENID);
    }
    if (event.action === "getCheckinStatus") {
      return await handleGetCheckinStatus(context.OPENID);
    }
    if (event.action === "toggleTask") {
      return await handleToggleTask(event, context.OPENID);
    }
    if (event.action === "createManualTask") {
      return await handleCreateManualTask(event, context.OPENID);
    }
    if (event.action === "getPlanPageData") {
      return success(await getPlanPageData(context.OPENID));
    }
    if (event.action === "updatePlanTime") {
      return success(await updatePlanTime(context.OPENID, event));
    }
    if (event.action === "postponeTask") {
      return success(await postponeTask(context.OPENID, event));
    }
    if (event.action === "pausePlan") {
      return success(await pausePlan(context.OPENID, event));
    }
    if (event.action === "resumePlan") {
      return success(await resumePlan(context.OPENID, event));
    }
    if (event.action === "continueExpiredPlan") {
      return success(await continueExpiredPlan(context.OPENID, event));
    }
    if (event.action === "archivePlan") {
      return success(await archivePlan(context.OPENID, event));
    }
    if (event.action === "completePlanActions") {
      return success(await completePlanActions(context.OPENID, event));
    }
    if (event.action === "generateNextWeek") {
      return await generateNextWeek(event, context.OPENID);
    }
    if (event.action === "adoptNextWeek") {
      return await adoptNextWeek(event, context.OPENID);
    }
    if (event.action === "getMyTeam") {
      return success(await getMyTeam(context.OPENID));
    }
    if (event.action === "joinTeam") {
      return success(await joinTeam(context.OPENID, event));
    }
    if (event.action === "sendEncouragement") {
      return success(await sendEncouragement(context.OPENID, event));
    }
    if (event.action === "syncTeamActivity") {
      return success(await syncTeamActivity(context.OPENID, event));
    }
    if (event.action === "getProfileData") {
      return success(await getProfileData(context.OPENID));
    }
    if (event.action === "getCommunityEntry") {
      return success(await getCommunityEntry(context.OPENID));
    }
    if (event.action === "deleteUserData") {
      return success(await deleteUserData(context.OPENID, event));
    }
    if (event.action === "generateStagePlan") {
      return success(await generateStagePlan(context.OPENID, event));
    }
    if (event.action === "analyzeGoal") {
      return success(await analyzeGoal(context.OPENID, event));
    }
    if (event.action === "submitGoalClarification") {
      return success(await submitGoalClarification(context.OPENID, event));
    }
    if (event.action === "createStagePreview") {
      return success(await createStagePreview(context.OPENID, event));
    }
    if (event.action === "optimizeStagePreview") {
      return success(await optimizeStagePreview(context.OPENID, event));
    }
    if (event.action === "updateStagePreviewTask") {
      return success(await updateStagePreviewTask(context.OPENID, event));
    }
    if (event.action === "applyStageOptimization") {
      return success(await applyStageOptimization(context.OPENID, event));
    }
    if (event.action === "regenerateStagePreview") {
      return success(await regenerateStagePreview(context.OPENID, event));
    }
    if (event.action === "getStagePreview") {
      return success(await getStagePreview(context.OPENID, event));
    }
    if (event.action === "confirmStagePlan") {
      return success(await confirmStagePlan(context.OPENID, event));
    }
    if (event.action === "getStageReview") {
      return success(await getStageReview(context.OPENID, event));
    }
    if (event.action === "submitStageReview") {
      return success(await submitStageReview(context.OPENID, event));
    }

    const error = new Error("不支持的操作。");
    error.code = "INVALID_ARGUMENT";
    throw error;
  } catch (error) {
    console.error("generatePlan failed", {
      action: event && event.action,
      code: error.code || "INTERNAL_ERROR",
      message: error && error.message ? String(error.message).slice(0, 160) : "",
      analysisIdSuffix: event && event.analysisId ? String(event.analysisId).slice(-8) : "",
      answerCount: Array.isArray(event && event.answers) ? event.answers.length : undefined,
    });
    return failure(error);
  }
};
