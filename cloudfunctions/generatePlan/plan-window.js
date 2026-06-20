const cloud = require("wx-server-sdk");
const { createStagePlanProvider } = require("./stage-ai");
const { addBusinessDays } = require("./date");
const { stableId } = require("./repository");
const { mapStageActionToTaskFields } = require("./stage-task");
const { buildDirectStageGenerationPrompt } = require("./stage-prompt");
const { validateGeneratedStagePlan } = require("./stage-validate");
const { buildBaseStagePlan, getStageTimeoutBudget } = require("./stage-v2");

const db = cloud.database();

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validId(value) {
  return typeof value === "string" && value.trim() && value.length <= 100;
}

function plannedExecutionDays(durationDays, weeklyDays) {
  const activeWeekDays = {
    3: [1, 3, 5],
    5: [1, 2, 3, 5, 6],
    7: [1, 2, 3, 4, 5, 6, 7],
  }[weeklyDays] || [1, 2, 3, 4, 5, 6, 7];
  return Array.from({ length: durationDays }, (_, index) => index + 1).filter((dayIndex) =>
    activeWeekDays.includes(((dayIndex - 1) % 7) + 1),
  );
}

async function completePlanActions(openid, event) {
  const planId = String((event && event.planId) || "").trim();
  if (!validId(planId)) fail("PLAN_NOT_FOUND", "计划不存在。");

  const planRecord = await db.collection("plans").doc(planId).get().catch(() => null);
  const plan = planRecord && planRecord.data;
  if (!plan || plan._openid !== openid) fail("PLAN_NOT_FOUND", "计划不存在。");
  if (!["active", "extended", "expired"].includes(plan.status)) {
    fail("PLAN_NOT_ACTIVE", "当前计划状态不支持补全行动。");
  }
  const planDurationDays = Math.max(Number(plan.planDurationDays || plan.durationDays || plan.totalDays || 7), 1);

  const taskResult = await db.collection("tasks").where({ _openid: openid, planId }).limit(1000).get();
  const tasks = taskResult.data || [];
  const existingDays = new Set(
    tasks
      .filter((task) => task.generatedBy !== "manual")
      .map((task) => Number(task.dayIndex || task.day || 0))
      .filter(Boolean),
  );
  const generatedWindows = Array.isArray(plan.generatedWindows) ? plan.generatedWindows : [];
  const maxGeneratedDay = Math.max(
    ...existingDays,
    ...generatedWindows.map((window) => Number(window.endDay || 0)),
    0,
  );
  const goalRecord = await db.collection("goals").doc(plan.goalId).get().catch(() => null);
  const goal = goalRecord && goalRecord.data;
  if (!goal || goal._openid !== openid) fail("GOAL_NOT_FOUND", "目标不存在。");
  const executionDays = plannedExecutionDays(planDurationDays, Number(goal.weeklyDays || 7));
  const missingExecutionDays = executionDays.filter((dayIndex) => !existingDays.has(dayIndex));
  if (!missingExecutionDays.length) {
    if (maxGeneratedDay < planDurationDays) {
      await db.collection("plans").doc(planId).update({
        data: {
          generatedWindows: [{ startDay: 1, endDay: planDurationDays, generatedBy: "existing" }],
          fullPlanGenerationStatus: "complete",
          updatedAt: db.serverDate(),
        },
      });
    }
    return {
      planId,
      totalDays: planDurationDays,
      generatedBy: "existing",
      createdTaskCount: 0,
      completed: true,
      reused: true,
    };
  }

  const generationInput = {
    templateId: goal.templateId || "custom",
    customGoalTitle: goal.title || goal.goalTitle || "当前目标",
    goalTitle: goal.title || goal.goalTitle || "当前目标",
    category: goal.category || "other",
    desiredResult: goal.desiredResult || plan.focus || plan.title,
    currentLevel: goal.currentLevel || "zero",
    dailyMinutes: Number(goal.dailyMinutes || 30),
    weeklyDays: Number(goal.weeklyDays || 5),
    intensity: goal.intensity || "normal",
    durationDays: planDurationDays,
    planDurationDays,
    deadline: goal.deadline || "",
    targetDuration: goal.targetDuration || "long_term",
    stageNumber: Number(plan.stageNumber || 1),
  };
  const goalProfile = {
    title: generationInput.goalTitle,
    desiredOutcome: generationInput.desiredResult,
    domainLabel: generationInput.goalTitle,
    goalType: "project",
    categoryGroup: "other",
    currentLevel: generationInput.currentLevel,
    intensity: generationInput.intensity,
    dailyMinutes: generationInput.dailyMinutes,
    durationDays: planDurationDays,
    planDurationDays,
    weeklyFrequency: generationInput.weeklyDays,
    constraints: [
      `必须完整生成第 1～${planDurationDays} 天，后续只补写缺失天数，不得覆盖已有行动`,
    ],
    availableResources: [],
    preferences: [],
  };

  let generatedBy = "template";
  let completePlan;
  const timeoutBudget = getStageTimeoutBudget(planDurationDays);
  try {
    const provider = createStagePlanProvider();
    const result = await provider.generateStagePlanWithMetadata(
      buildDirectStageGenerationPrompt(goalProfile),
      timeoutBudget.generation,
      { action: "completePlanActions", planId, planDurationDays },
    );
    completePlan = validateGeneratedStagePlan(JSON.parse(result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")), goalProfile);
    generatedBy = "ai";
  } catch (error) {
    console.warn("complete plan actions fallback", {
      code: error.code || "AI_REQUEST_FAILED",
      planDurationDays,
      existingDayCount: existingDays.size,
    });
    completePlan = buildBaseStagePlan(generationInput);
  }

  const fallbackPlan = buildBaseStagePlan(generationInput);
  const now = db.serverDate();
  let createdTaskCount = 0;
  for (const dayIndex of missingExecutionDays) {
    const aiDay = completePlan.days.find((day) => Number(day.dayIndex) === dayIndex);
    const fallbackDay = fallbackPlan.days.find((day) => Number(day.dayIndex) === dayIndex);
    const day = aiDay && aiDay.actions.length ? aiDay : fallbackDay;
    if (!day || !day.actions.length) continue;
    const dayGeneratedBy = aiDay && aiDay.actions.length ? generatedBy : "template";
    for (let actionIndex = 0; actionIndex < day.actions.length; actionIndex += 1) {
      const action = day.actions[actionIndex];
      const taskId = stableId("action_window", `${openid}:${planId}:${dayIndex}:${actionIndex}`);
      const plannedDate = addBusinessDays(plan.startDate, dayIndex - 1);
      await db.collection("tasks").doc(taskId).set({
        data: {
          _openid: openid,
          goalId: plan.goalId,
          stageId: planId,
          planId,
          dayIndex,
          day: dayIndex,
          plannedDate,
          currentDate: plannedDate,
          scheduledDate: plannedDate,
          taskDate: plannedDate,
          theme: day.theme,
          dayTitle: day.theme,
          ...mapStageActionToTaskFields(action, dayIndex, actionIndex),
          status: "pending",
          generatedBy: dayGeneratedBy,
          rolloverCount: 0,
          createdAt: now,
          updatedAt: now,
        },
      });
      createdTaskCount += 1;
    }
  }
  await db.collection("plans").doc(planId).update({
    data: {
      generatedWindows: [{ startDay: 1, endDay: planDurationDays, generatedBy }],
      fullPlanGenerationStatus: "complete",
      updatedAt: now,
    },
  });
  return {
    planId,
    totalDays: planDurationDays,
    generatedBy,
    createdTaskCount,
    completed: true,
    reused: false,
  };
}

module.exports = { completePlanActions, plannedExecutionDays };
