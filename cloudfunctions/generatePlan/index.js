const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { generateText } = require("./ai");
const { formatBusinessDate } = require("./date");
const { buildFallbackPlan } = require("./fallback");
const { buildPrompt, buildRepairPrompt } = require("./prompt");
const {
  adoptPlan,
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
  parseAiJson,
  validateGoal,
  validatePlan,
  validateRequestId,
} = require("./validate");

function success(data) {
  return { success: true, data };
}

function failure(error) {
  const allowedCodes = [
    "INVALID_ARGUMENT",
    "UNAUTHORIZED",
    "GOAL_ALREADY_EXISTS",
    "PLAN_SCHEMA_INVALID",
    "RATE_LIMITED",
  ];
  const code = allowedCodes.includes(error.code) ? error.code : "INTERNAL_ERROR";
  const messages = {
    INVALID_ARGUMENT: error.message,
    UNAUTHORIZED: "用户身份无效，请重新进入小程序。",
    GOAL_ALREADY_EXISTS: error.message,
    PLAN_SCHEMA_INVALID: "计划内容暂时不可用，请重新生成。",
    RATE_LIMITED: error.message,
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

    const error = new Error("不支持的操作。");
    error.code = "INVALID_ARGUMENT";
    throw error;
  } catch (error) {
    console.error("generatePlan failed", {
      action: event && event.action,
      code: error.code || "INTERNAL_ERROR",
    });
    return failure(error);
  }
};
