const cloud = require("wx-server-sdk");
const { businessDateDiff, formatBusinessDate } = require("./date");
const { stableId } = require("./repository");

const db = cloud.database();
const command = db.command;

const TIME_PERIODS = ["morning", "afternoon", "evening", "anytime"];
const TIME_PERIOD_ORDER = {
  morning: 1,
  afternoon: 2,
  evening: 3,
  anytime: 4,
};
const SOURCE_LABELS = {
  manual: "自定义任务",
  ai: "AI 计划",
  template: "计划任务",
  carry_over: "顺延任务",
};

const ACTION_TYPE_LABELS = {
  practice: "练习",
  learning: "学习",
  preparation: "准备",
  reflection: "复盘",
  recovery: "恢复",
  creation: "创作",
  execution: "执行",
};

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clampPercentage(value) {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

async function getFirst(collectionName, where) {
  const result = await db.collection(collectionName).where(where).limit(1).get();
  return result.data[0] || null;
}

async function getMany(collectionName, where, limit = 100) {
  const result = await db.collection(collectionName).where(where).limit(limit).get();
  return result.data || [];
}

const VALID_RESULT_STATUSES = ["completed", "partially_completed", "skipped", "rescheduled"];

function normalizeTextList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function buildTask(task) {
  const status = task.status || "pending";
  const resultStatus = VALID_RESULT_STATUSES.includes(status) ? status : undefined;
  const actionType = String(task.actionType || "").trim();
  return {
    id: String(task._id || ""),
    title: String(task.title || "今日任务"),
    description: String(task.description || task.dayTitle || ""),
    actionType,
    actionTypeLabel: actionType ? ACTION_TYPE_LABELS[actionType] || actionType : "",
    completionCriteria: String(task.completionCriteria || ""),
    requiredResources: normalizeTextList(task.requiredResources),
    safetyNotes: normalizeTextList(task.safetyNotes),
    estimatedMinutes: Math.max(Number(task.estimatedMinutes) || 0, 0),
    timePeriod: TIME_PERIODS.includes(task.timePeriod) ? task.timePeriod : "anytime",
    source: task.source || "template",
    sourceLabel: task.planTitle || SOURCE_LABELS[task.source] || SOURCE_LABELS.template,
    planId: String(task.planId || ""),
    planTitle: String(task.planTitle || ""),
    completed: status === "completed",
    resultStatus,
  };
}

function buildTaskGroups(tasks) {
  const titles = {
    morning: "上午",
    afternoon: "下午",
    evening: "晚上",
    anytime: "随时",
  };
  return TIME_PERIODS.map((key) => ({
    key,
    title: titles[key],
    tasks: tasks.filter((task) => task.timePeriod === key),
  })).filter((group) => group.tasks.length > 0);
}

function buildSourceSummary(tasks) {
  const summary = new Map();
  tasks.forEach((task) => {
    const key = task.planId || task.source;
    const label = task.planTitle || task.sourceLabel;
    const current = summary.get(key) || { key, label, count: 0 };
    current.count += 1;
    summary.set(key, current);
  });
  return Array.from(summary.values());
}

function calculateCurrentDay(startDate, businessDate, durationDays) {
  if (!startDate) return 1;
  const day = businessDateDiff(startDate, businessDate) + 1;
  return Math.min(Math.max(day, 1), durationDays);
}

async function getHomeData(openid) {
  const businessDate = formatBusinessDate();
  const [user, goal] = await Promise.all([
    getFirst("users", { _openid: openid }),
    getFirst("goals", { _openid: openid, status: "active" }),
  ]);
  const userProgress = {
    nickname: String((user && user.nickname) || ""),
    streakDays: Math.max(
      Number((user && (user.streakDays ?? user.currentStreak)) || 0),
      0,
    ),
  };

  const [plannedTodayRecords, overdueRecords] = await Promise.all([
    getMany("tasks", { _openid: openid, taskDate: businessDate }, 20),
    getMany("tasks", { _openid: openid, status: "pending", taskDate: command.lt(businessDate) }, 20),
  ]);
  const todayTaskRecords = plannedTodayRecords.slice(0, 5);
  const remainingSlots = Math.max(5 - todayTaskRecords.length, 0);
  const selectedOverdue = overdueRecords
    .sort((left, right) => String(left.taskDate).localeCompare(String(right.taskDate)))
    .slice(0, remainingSlots);
  for (const task of selectedOverdue) {
    await db.collection("tasks").doc(task._id).update({
      data: {
        plannedDate: task.plannedDate || task.originalScheduledDate || task.taskDate,
        currentDate: businessDate,
        taskDate: businessDate,
        scheduledDate: businessDate,
        rolloverCount: Number(task.rolloverCount || 0) + 1,
        updatedAt: db.serverDate(),
      },
    });
    todayTaskRecords.push({
      ...task,
      taskDate: businessDate,
      currentDate: businessDate,
      source: "carry_over",
    });
  }
  const pendingActionCount = Math.max(plannedTodayRecords.length + overdueRecords.length - todayTaskRecords.length, 0);
  const planIds = Array.from(new Set(todayTaskRecords.map((task) => task.planId).filter(Boolean)));
  const planTitles = new Map();
  if (planIds.length) {
    const planRecords = await Promise.all(
      planIds.map((planId) => db.collection("plans").doc(planId).get().catch(() => null)),
    );
    planRecords.forEach((record) => {
      const planRecord = record && record.data;
      if (planRecord && planRecord._openid === openid) {
        planTitles.set(
          planRecord._id,
          String(planRecord.title || planRecord.stageTitle || planRecord.weeklyGoal || "计划任务"),
        );
      }
    });
  }

  todayTaskRecords.forEach((task) => {
    if (task.planId && planTitles.has(task.planId)) {
      task.planTitle = planTitles.get(task.planId);
    }
  });
  todayTaskRecords.sort((left, right) => {
    const periodDiff =
      (TIME_PERIOD_ORDER[left.timePeriod] || TIME_PERIOD_ORDER.anytime) -
      (TIME_PERIOD_ORDER[right.timePeriod] || TIME_PERIOD_ORDER.anytime);
    if (periodDiff !== 0) return periodDiff;
    return Number(left.order || 0) - Number(right.order || 0);
  });

  const todayTasks = todayTaskRecords.map(buildTask);
  const completedCount = todayTasks.filter((task) => task.completed).length;
  const totalCount = todayTasks.length;
  const completionRate =
    totalCount > 0 ? clampPercentage((completedCount / totalCount) * 100) : 0;
  const checkinRecords = await getMany("checkins", {
    _openid: openid,
    businessDate,
  }, 1);

  if (!goal) {
    return {
      businessDate,
      user: userProgress,
      goal: null,
      todayTasks,
      taskGroups: buildTaskGroups(todayTasks),
      sourceSummary: buildSourceSummary(todayTasks),
      completedCount,
      totalCount,
      completionRate,
      checkedInToday: checkinRecords.length > 0,
      todayRest: false,
      pendingActionCount,
    };
  }

  const plans = await getMany("plans", {
    _openid: openid,
    goalId: goal._id,
  }, 20);
  const plan =
    plans.find((item) => item.status === "active") ||
    plans.find((item) => item.status === "paused") ||
    plans.find((item) => item.status === "reviewing") ||
    null;

  if (!plan) {
    return {
      businessDate,
      user: userProgress,
      goal: {
        id: String(goal._id),
        planId: "",
        title: String(goal.title || goal.goalTitle || "当前目标"),
        category: String(goal.category || ""),
        currentDay: 1,
        totalDays: Number(goal.planDurationDays || goal.durationDays || 7),
        stageTitle: "",
        planCompletionRate: 0,
        planStatus: "active",
      },
      todayTasks,
      taskGroups: buildTaskGroups(todayTasks),
      sourceSummary: buildSourceSummary(todayTasks),
      completedCount,
      totalCount,
      completionRate,
      checkedInToday: checkinRecords.length > 0,
      todayRest: false,
      pendingActionCount,
    };
  }

  const [planTaskRecords] = await Promise.all([
    getMany("tasks", {
      _openid: openid,
      planId: plan._id,
    }),
  ]);

  const planCompleted = planTaskRecords.filter(
    (task) => task.status === "completed",
  ).length;
  const planCompletionRate =
    planTaskRecords.length > 0
      ? clampPercentage((planCompleted / planTaskRecords.length) * 100)
      : 0;
  const durationDays = Math.max(Number(plan.planDurationDays || plan.durationDays || plan.totalDays || 7), 1);
  const plannedEndDate = String(plan.plannedEndDate || plan.endDate || "");
  const effectiveStatus = plan.status === "active" && plannedEndDate && businessDate > plannedEndDate
    ? "expired"
    : plan.status;

  return {
    businessDate,
    user: userProgress,
    goal: {
      id: String(goal._id),
      planId: String(plan._id),
      title: String(goal.title || goal.goalTitle || "当前目标"),
      category: String(goal.category || ""),
      currentDay: calculateCurrentDay(plan.startDate, businessDate, durationDays),
      totalDays: durationDays,
      stageTitle: String(plan.stageTitle || plan.title || plan.weeklyGoal || "当前行动阶段"),
      planCompletionRate,
      planStatus: effectiveStatus,
    },
    todayTasks,
    taskGroups: buildTaskGroups(todayTasks),
    sourceSummary: buildSourceSummary(todayTasks),
    completedCount,
    totalCount,
    completionRate,
    checkedInToday: checkinRecords.length > 0,
    todayRest: totalCount === 0 && businessDate >= plan.startDate && businessDate <= plannedEndDate,
    pendingActionCount,
  };
}

async function toggleTask(openid, event) {
  if (!event || typeof event !== "object") {
    throw createError("INVALID_ARGUMENT", "任务信息不完整。");
  }

  const { taskId, completed } = event;

  if (typeof taskId !== "string" || !taskId.trim()) {
    throw createError("INVALID_ARGUMENT", "任务 ID 无效。");
  }

  if (typeof completed !== "boolean") {
    throw createError("INVALID_ARGUMENT", "任务状态无效。");
  }

  const newStatus = completed ? "completed" : "pending";

  // Verify the task belongs to the current user before updating.
  const task = await db.collection("tasks").doc(taskId).get().catch(() => null);
  if (!task || !task.data) {
    throw createError("TASK_NOT_FOUND", "任务不存在。");
  }

  if (task.data._openid !== openid) {
    throw createError("UNAUTHORIZED", "无权操作此任务。");
  }

  if (task.data.planId) {
    const plan = await getFirst("plans", {
      _openid: openid,
      _id: task.data.planId,
    });
    if (!plan || !["active", "extended", "expired"].includes(plan.status)) {
      throw createError(
        plan && plan.status === "paused" ? "PLAN_PAUSED" : "PLAN_STATUS_INVALID",
        plan && plan.status === "paused"
          ? "计划暂停期间不能修改任务。"
          : "当前计划状态不支持修改任务。",
      );
    }
  }
  if (task.data.taskDate > formatBusinessDate()) {
    throw createError("TASK_NOT_ELIGIBLE", "只能在今日页修改当天任务。");
  }

  await db.collection("tasks").doc(taskId).update({
    data: {
      status: newStatus,
      currentDate: formatBusinessDate(),
      taskDate: formatBusinessDate(),
      scheduledDate: formatBusinessDate(),
      completedAt: completed ? db.serverDate() : command.remove(),
      updatedAt: db.serverDate(),
    },
  });

  return { taskId, completed, status: newStatus };
}

function normalizeManualTask(event) {
  const title = String(event.title || "").trim();
  if (title.length < 2) {
    throw createError("MANUAL_ACTION_INVALID", "行动标题需为 2～40 个字。");
  }
  if (title.length > 40) {
    throw createError("MANUAL_ACTION_INVALID", "行动标题需为 2～40 个字。");
  }

  const description = String(event.description || "").trim();
  if (description.length > 150) {
    throw createError("MANUAL_ACTION_INVALID", "行动说明请控制在 150 个字以内。");
  }

  const requestId = String(event.requestId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
    throw createError("INVALID_ARGUMENT", "任务请求无效，请重试。");
  }

  const taskDate = event.taskDate || formatBusinessDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) {
    throw createError("INVALID_ARGUMENT", "任务日期无效。");
  }

  const timePeriod = TIME_PERIODS.includes(event.timePeriod) ? event.timePeriod : "anytime";
  const estimatedMinutes = Math.round(Number(event.estimatedMinutes) || 30);
  if (estimatedMinutes < 5 || estimatedMinutes > 180) {
    throw createError("MANUAL_ACTION_INVALID", "预计时长需在 5 到 180 分钟之间。");
  }

  const repeatType = ["none", "daily", "weekly", "custom"].includes(event.repeatType)
    ? event.repeatType
    : "none";
  const priority = event.priority === "important" ? "important" : "normal";
  const taskType = event.taskType === "optional" ? "optional" : "required";

  return {
    requestId,
    title,
    description,
    taskDate,
    timePeriod,
    estimatedMinutes,
    repeatType,
    priority,
    taskType,
    tagName: String(event.tagName || "").trim().slice(0, 20),
    planId: String(event.planId || "").trim(),
  };
}

async function createManualTask(openid, event) {
  const taskInput = normalizeManualTask(event);
  if (!taskInput.planId) {
    throw createError("PLAN_NOT_ACTIVE", "请先创建一个计划，再新增行动。");
  }
  const taskId = stableId("task_manual", `${openid}:${taskInput.requestId}`);
  const existing = await db.collection("tasks").doc(taskId).get().catch(() => null);
  if (existing && existing.data) {
    return { taskId, created: false };
  }

  if (taskInput.planId) {
    const plan = await getFirst("plans", { _openid: openid, _id: taskInput.planId });
    if (!plan || !["active", "extended", "expired"].includes(plan.status)) {
      throw createError("PLAN_STATUS_INVALID", "所属计划暂时不可用。");
    }
  }

  const now = db.serverDate();
  await db.collection("tasks").doc(taskId).set({
    data: {
      _openid: openid,
      title: taskInput.title,
      description: taskInput.description,
      taskDate: taskInput.taskDate,
      plannedDate: taskInput.taskDate,
      currentDate: taskInput.taskDate,
      timePeriod: taskInput.timePeriod,
      estimatedMinutes: taskInput.estimatedMinutes,
      tagName: taskInput.tagName,
      tagId: null,
      planId: taskInput.planId || null,
      source: "manual",
      generatedBy: "manual",
      rolloverCount: 0,
      taskType: taskInput.taskType,
      priority: taskInput.priority,
      repeatType: taskInput.repeatType,
      status: "pending",
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  return { taskId, created: true };
}

module.exports = {
  createManualTask,
  getHomeData,
  normalizeManualTask,
  toggleTask,
};
