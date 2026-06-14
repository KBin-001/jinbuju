const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { generateText } = require("./ai");
const { submitCheckin, getCheckinStatus } = require("./checkin");
const { formatBusinessDate } = require("./date");
const { buildFallbackPlan } = require("./fallback");
const { getHomeData, toggleTask } = require("./home");
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
  getNextWeekContext,
  getPlanPageData,
  pausePlan,
  postponeTask,
  resumePlan,
  updatePlanTime,
} = require("./plan-management");
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
    "GOAL_NOT_FOUND",
    "PLAN_NOT_FOUND",
    "TASK_NOT_FOUND",
    "CHECKIN_ALREADY_EXISTS",
    "PLAN_PAUSED",
    "PLAN_STATUS_INVALID",
    "TASK_NOT_ELIGIBLE",
    "TASK_ALREADY_POSTPONED",
    "PLAN_DATE_EXCEEDED",
  ];
  const code = allowedCodes.includes(error.code) ? error.code : "INTERNAL_ERROR";
  const messages = {
    INVALID_ARGUMENT: error.message,
    UNAUTHORIZED: "用户身份无效，请重新进入小程序。",
    GOAL_ALREADY_EXISTS: error.message,
    PLAN_SCHEMA_INVALID: "计划内容暂时不可用，请重新生成。",
    RATE_LIMITED: error.message,
    GOAL_NOT_FOUND: "当前目标不存在，请重新进入小程序。",
    PLAN_NOT_FOUND: "当前计划不存在，请重新进入小程序。",
    TASK_NOT_FOUND: "今日暂无任务安排。",
    CHECKIN_ALREADY_EXISTS: "今天已经打过卡了，明天继续加油。",
    PLAN_PAUSED: error.message,
    PLAN_STATUS_INVALID: error.message,
    TASK_NOT_ELIGIBLE: error.message,
    TASK_ALREADY_POSTPONED: error.message,
    PLAN_DATE_EXCEEDED: error.message,
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
    if (event.action === "generateNextWeek") {
      return await generateNextWeek(event, context.OPENID);
    }
    if (event.action === "adoptNextWeek") {
      return await adoptNextWeek(event, context.OPENID);
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
