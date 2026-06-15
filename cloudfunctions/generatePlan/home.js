const cloud = require("wx-server-sdk");
const { businessDateDiff, formatBusinessDate } = require("./date");

const db = cloud.database();
const command = db.command;

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

function buildTask(task) {
  return {
    id: String(task._id || ""),
    title: String(task.title || "今日任务"),
    description: String(task.description || task.dayTitle || ""),
    estimatedMinutes: Math.max(Number(task.estimatedMinutes) || 0, 0),
    completed: task.status === "completed",
  };
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

  if (!goal) {
    return {
      businessDate,
      user: userProgress,
      goal: null,
      todayTasks: [],
      completedCount: 0,
      totalCount: 0,
      completionRate: 0,
      checkedInToday: false,
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
        totalDays: 7,
        stageTitle: "",
        weeklyCompletionRate: 0,
        planStatus: "active",
      },
      todayTasks: [],
      completedCount: 0,
      totalCount: 0,
      completionRate: 0,
      checkedInToday: false,
    };
  }

  const [todayTaskRecords, planTaskRecords, checkinRecords] = await Promise.all([
    getMany("tasks", {
      _openid: openid,
      planId: plan._id,
      taskDate: businessDate,
    }),
    getMany("tasks", {
      _openid: openid,
      planId: plan._id,
    }),
    getMany("checkins", {
      _openid: openid,
      businessDate,
    }, 1),
  ]);
  todayTaskRecords.sort(
    (left, right) => Number(left.order || 0) - Number(right.order || 0),
  );

  const todayTasks = todayTaskRecords.map(buildTask);
  const completedCount = todayTasks.filter((task) => task.completed).length;
  const totalCount = todayTasks.length;
  const completionRate =
    totalCount > 0 ? clampPercentage((completedCount / totalCount) * 100) : 0;
  const weeklyCompleted = planTaskRecords.filter(
    (task) => task.status === "completed",
  ).length;
  const weeklyCompletionRate =
    planTaskRecords.length > 0
      ? clampPercentage((weeklyCompleted / planTaskRecords.length) * 100)
      : 0;
  const durationDays = Math.max(Number(plan.durationDays || plan.totalDays || 7), 1);

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
      weeklyCompletionRate,
      planStatus: plan.status,
    },
    todayTasks,
    completedCount,
    totalCount,
    completionRate,
    checkedInToday: checkinRecords.length > 0,
  };
}

async function toggleTask(openid, event) {
  if (!event || typeof event !== "object") {
    const error = new Error("任务信息不完整。");
    error.code = "INVALID_ARGUMENT";
    throw error;
  }

  const { taskId, completed } = event;

  if (typeof taskId !== "string" || !taskId.trim()) {
    const error = new Error("任务 ID 无效。");
    error.code = "INVALID_ARGUMENT";
    throw error;
  }

  if (typeof completed !== "boolean") {
    const error = new Error("任务状态无效。");
    error.code = "INVALID_ARGUMENT";
    throw error;
  }

  const newStatus = completed ? "completed" : "pending";

  // Verify the task belongs to the current user before updating.
  const task = await db.collection("tasks").doc(taskId).get().catch(() => null);
  if (!task || !task.data) {
    const error = new Error("任务不存在。");
    error.code = "TASK_NOT_FOUND";
    throw error;
  }

  if (task.data._openid !== openid) {
    const error = new Error("无权操作此任务。");
    error.code = "UNAUTHORIZED";
    throw error;
  }

  const plan = await getFirst("plans", {
    _openid: openid,
    _id: task.data.planId,
  });
  if (!plan || plan.status !== "active") {
    const error = new Error(
      plan && plan.status === "paused"
        ? "计划暂停期间不能修改任务。"
        : "当前计划状态不支持修改任务。",
    );
    error.code = plan && plan.status === "paused" ? "PLAN_PAUSED" : "PLAN_STATUS_INVALID";
    throw error;
  }
  if (task.data.taskDate !== formatBusinessDate()) {
    const error = new Error("只能在今日页修改当天任务。");
    error.code = "TASK_NOT_ELIGIBLE";
    throw error;
  }

  await db.collection("tasks").doc(taskId).update({
    data: {
      status: newStatus,
      completedAt: completed ? db.serverDate() : command.remove(),
      updatedAt: db.serverDate(),
    },
  });

  return { taskId, completed, status: newStatus };
}

module.exports = {
  getHomeData,
  toggleTask,
};
