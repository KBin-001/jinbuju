const cloud = require("wx-server-sdk");
const { addBusinessDays, businessDateDiff, formatBusinessDate } = require("./date");
const { getDayStatus, getTaskState } = require("./plan-rules");

const db = cloud.database();

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function clampPercentage(value) {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function validateId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    fail("INVALID_ARGUMENT", `${label}无效。`);
  }
  return value.trim();
}

async function getFirst(collectionName, where) {
  const result = await db.collection(collectionName).where(where).limit(1).get();
  return result.data[0] || null;
}

async function getMany(collectionName, where, limit = 100) {
  const result = await db.collection(collectionName).where(where).limit(limit).get();
  return result.data || [];
}

async function getOwnedPlan(openid, planId) {
  const plan = await getFirst("plans", { _openid: openid, _id: planId });
  if (!plan) fail("PLAN_NOT_FOUND", "当前计划不存在。");
  return plan;
}

async function ensureActiveGoalForPlan(openid, plan) {
  const goal = await getFirst("goals", {
    _openid: openid,
    _id: plan.goalId,
    status: "active",
  });
  if (!goal) fail("GOAL_NOT_FOUND", "当前目标不存在。");
  return goal;
}

async function getCurrentGoalAndPlan(openid) {
  const goal = await getFirst("goals", { _openid: openid, status: "active" });
  if (!goal) return { goal: null, plan: null };

  const plans = await getMany("plans", { _openid: openid, goalId: goal._id }, 20);
  const plan =
    plans.find((item) => item.status === "active") ||
    plans.find((item) => item.status === "paused") ||
    plans.find((item) => item.status === "completed") ||
    null;
  return { goal, plan };
}

function getCurrentDay(startDate, businessDate) {
  const day = businessDateDiff(startDate, businessDate) + 1;
  return Math.min(Math.max(day, 1), 7);
}

async function getPlanPageData(openid) {
  const businessDate = formatBusinessDate();
  const { goal, plan } = await getCurrentGoalAndPlan(openid);
  if (!goal || !plan) {
    return { businessDate, goal: null, plan: null, days: [] };
  }

  const taskRecords = await getMany("tasks", {
    _openid: openid,
    planId: plan._id,
  });
  const totalCount = taskRecords.length;
  const completedCount = taskRecords.filter((task) => task.status === "completed").length;
  const completionRate =
    totalCount > 0 ? clampPercentage((completedCount / totalCount) * 100) : 0;
  const tomorrow = addBusinessDays(businessDate, 1);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addBusinessDays(plan.startDate, index);
    const dayTasks = taskRecords
      .filter((task) => task.taskDate === date)
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    const dayCompletedCount = dayTasks.filter((task) => task.status === "completed").length;
    return {
      day: index + 1,
      date,
      isToday: date === businessDate,
      status: getDayStatus(
        plan.status,
        date,
        businessDate,
        dayCompletedCount,
        dayTasks.length,
      ),
      completedCount: dayCompletedCount,
      totalCount: dayTasks.length,
      tasks: dayTasks.map((task) => ({
        id: String(task._id),
        planId: String(plan._id),
        day: Number(task.day || index + 1),
        title: String(task.title || "计划任务"),
        description: String(task.description || task.dayTitle || ""),
        estimatedMinutes: Math.max(Number(task.estimatedMinutes) || 0, 0),
        scheduledDate: String(task.taskDate || date),
        originalScheduledDate: String(task.originalScheduledDate || task.taskDate || date),
        completed: task.status === "completed",
        completedAt: task.completedAt || null,
        postponed: task.postponed === true,
        state: getTaskState(plan.status, task, businessDate),
        canPostpone:
          plan.status === "active" &&
          task.status !== "completed" &&
          task.postponed !== true &&
          task.taskDate <= businessDate &&
          tomorrow <= plan.endDate,
      })),
    };
  });

  return {
    businessDate,
    goal: {
      id: String(goal._id),
      title: String(goal.goalTitle || "当前目标"),
      category: String(goal.category || ""),
    },
    plan: {
      id: String(plan._id),
      status: plan.status || "active",
      summary: String(plan.summary || ""),
      weeklyGoal: String(plan.weeklyGoal || ""),
      startDate: String(plan.startDate),
      endDate: String(plan.endDate),
      currentDay: getCurrentDay(plan.startDate, businessDate),
      totalDays: 7,
      dailyReminderTime: String(plan.dailyReminderTime || "21:00"),
      completedCount,
      totalCount,
      completionRate,
      nextWeekEligible: plan.status === "active" && businessDate >= plan.endDate,
    },
    days,
  };
}

async function updatePlanTime(openid, event) {
  const planId = validateId(event && event.planId, "计划 ID");
  const dailyReminderTime = String((event && event.dailyReminderTime) || "");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dailyReminderTime)) {
    fail("INVALID_ARGUMENT", "计划时间格式无效。");
  }
  const plan = await getOwnedPlan(openid, planId);
  await ensureActiveGoalForPlan(openid, plan);
  if (!["active", "paused"].includes(plan.status)) {
    fail("PLAN_STATUS_INVALID", "当前计划状态不支持修改时间。");
  }
  await db.collection("plans").doc(planId).update({
    data: { dailyReminderTime, updatedAt: db.serverDate() },
  });
  return { planId, dailyReminderTime };
}

async function postponeTask(openid, event) {
  const taskId = validateId(event && event.taskId, "任务 ID");
  const planId = validateId(event && event.planId, "计划 ID");
  const businessDate = formatBusinessDate();
  const targetDate = addBusinessDays(businessDate, 1);

  return db.runTransaction(async (transaction) => {
    const planResult = await transaction.collection("plans").doc(planId).get().catch(() => null);
    const plan = planResult && planResult.data;
    if (!plan || plan._openid !== openid) fail("PLAN_NOT_FOUND", "当前计划不存在。");
    const goalResult = await transaction
      .collection("goals")
      .doc(plan.goalId)
      .get()
      .catch(() => null);
    const goal = goalResult && goalResult.data;
    if (!goal || goal._openid !== openid || goal.status !== "active") {
      fail("GOAL_NOT_FOUND", "当前目标不存在。");
    }
    if (plan.status === "paused") fail("PLAN_PAUSED", "计划暂停期间不能顺延任务。");
    if (plan.status !== "active") fail("PLAN_STATUS_INVALID", "当前计划状态不支持顺延。");

    const taskResult = await transaction.collection("tasks").doc(taskId).get().catch(() => null);
    const task = taskResult && taskResult.data;
    if (!task || task._openid !== openid || task.planId !== planId) {
      fail("TASK_NOT_FOUND", "任务不存在。");
    }
    if (task.status === "completed") fail("TASK_NOT_ELIGIBLE", "已完成任务不能顺延。");
    if (task.taskDate > businessDate) fail("TASK_NOT_ELIGIBLE", "未来任务不能提前顺延。");
    if (task.postponed === true) fail("TASK_ALREADY_POSTPONED", "该任务已经顺延过。");
    if (targetDate > plan.endDate) fail("PLAN_DATE_EXCEEDED", "顺延后会超出当前计划。");

    await transaction.collection("tasks").doc(taskId).update({
      data: {
        originalScheduledDate: task.originalScheduledDate || task.taskDate,
        taskDate: targetDate,
        day: businessDateDiff(plan.startDate, targetDate) + 1,
        postponed: true,
        postponedAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
    return { taskId, planId, scheduledDate: targetDate, postponed: true };
  });
}

async function changePlanStatus(openid, event, expectedStatus, nextStatus) {
  const planId = validateId(event && event.planId, "计划 ID");
  const plan = await getOwnedPlan(openid, planId);
  await ensureActiveGoalForPlan(openid, plan);
  if (plan.status === nextStatus) {
    return { planId, status: nextStatus, changed: false };
  }
  if (plan.status !== expectedStatus) {
    fail("PLAN_STATUS_INVALID", "当前计划状态已变化，请刷新后重试。");
  }
  const timeField = nextStatus === "paused" ? "pausedAt" : "resumedAt";
  await db.collection("plans").doc(planId).update({
    data: {
      status: nextStatus,
      [timeField]: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  return { planId, status: nextStatus, changed: true };
}

function pausePlan(openid, event) {
  return changePlanStatus(openid, event, "active", "paused");
}

function resumePlan(openid, event) {
  return changePlanStatus(openid, event, "paused", "active");
}

async function getNextWeekContext(openid, planId) {
  const plan = await getOwnedPlan(openid, validateId(planId, "计划 ID"));
  if (plan.status !== "active") {
    fail(
      plan.status === "paused" ? "PLAN_PAUSED" : "PLAN_STATUS_INVALID",
      "当前计划状态不支持生成下一周计划。",
    );
  }
  if (formatBusinessDate() < plan.endDate) {
    fail("PLAN_STATUS_INVALID", "到达当前计划第 7 天后才可以生成下一周计划。");
  }
  const goal = await getFirst("goals", {
    _openid: openid,
    _id: plan.goalId,
    status: "active",
  });
  if (!goal) fail("GOAL_NOT_FOUND", "当前目标不存在。");
  return {
    goal,
    plan,
    nextStartDate: addBusinessDays(plan.endDate, 1),
  };
}

module.exports = {
  getNextWeekContext,
  getPlanPageData,
  pausePlan,
  postponeTask,
  resumePlan,
  updatePlanTime,
};
