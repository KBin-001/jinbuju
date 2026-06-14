const cloud = require("wx-server-sdk");
const { businessDateDiff, formatBusinessDate } = require("./date");

const db = cloud.database();

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

function calculateCurrentDay(startDate, businessDate) {
  if (!startDate) return 1;
  const day = businessDateDiff(startDate, businessDate) + 1;
  return Math.min(Math.max(day, 1), 7);
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
    };
  }

  const plan = await getFirst("plans", {
    _openid: openid,
    goalId: goal._id,
    status: "active",
  });

  if (!plan) {
    return {
      businessDate,
      user: userProgress,
      goal: {
        id: String(goal._id),
        planId: "",
        title: String(goal.goalTitle || "当前目标"),
        category: String(goal.category || ""),
        currentDay: 1,
        totalDays: 7,
        weeklyCompletionRate: 0,
      },
      todayTasks: [],
      completedCount: 0,
      totalCount: 0,
      completionRate: 0,
    };
  }

  const [todayTaskRecords, planTaskRecords] = await Promise.all([
    getMany("tasks", {
      _openid: openid,
      planId: plan._id,
      taskDate: businessDate,
    }),
    getMany("tasks", {
      _openid: openid,
      planId: plan._id,
    }),
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

  return {
    businessDate,
    user: userProgress,
    goal: {
      id: String(goal._id),
      planId: String(plan._id),
      title: String(goal.goalTitle || "当前目标"),
      category: String(goal.category || ""),
      currentDay: calculateCurrentDay(plan.startDate, businessDate),
      totalDays: 7,
      weeklyCompletionRate,
    },
    todayTasks,
    completedCount,
    totalCount,
    completionRate,
  };
}

module.exports = {
  getHomeData,
};
