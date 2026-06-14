const cloud = require("wx-server-sdk");
const { addBusinessDays, formatBusinessDate } = require("./date");
const { DANGEROUS_CONTENT } = require("./constants");
const { stableId } = require("./repository");

const db = cloud.database();

const VALID_FEELINGS = ["easy", "normal", "challenging", "rewarding"];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
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

function validateCheckinInput(event) {
  if (!event || typeof event !== "object") {
    fail("INVALID_ARGUMENT", "打卡信息不完整。");
  }

  const { goalId, planId, completedTaskIds, feeling } = event;

  if (typeof goalId !== "string" || !goalId.trim()) {
    fail("INVALID_ARGUMENT", "目标 ID 无效。");
  }
  if (typeof planId !== "string" || !planId.trim()) {
    fail("INVALID_ARGUMENT", "计划 ID 无效。");
  }
  if (!Array.isArray(completedTaskIds) || completedTaskIds.length === 0) {
    fail("INVALID_ARGUMENT", "请至少完成一项任务后再打卡。");
  }
  for (const id of completedTaskIds) {
    if (typeof id !== "string" || !id.trim()) {
      fail("INVALID_ARGUMENT", "任务 ID 格式无效。");
    }
  }
  if (!VALID_FEELINGS.includes(feeling)) {
    fail("INVALID_ARGUMENT", "感受选项无效。");
  }

  let note = "";
  if (event.note !== undefined && event.note !== null && event.note !== "") {
    if (typeof event.note !== "string") {
      fail("INVALID_ARGUMENT", "备注格式无效。");
    }
    note = event.note.trim();
    if (note.length > 100) {
      fail("INVALID_ARGUMENT", "备注最多 100 个字符。");
    }
    if (DANGEROUS_CONTENT.test(note)) {
      fail("INVALID_ARGUMENT", "备注包含不支持的内容。");
    }
  }

  return {
    goalId: goalId.trim(),
    planId: planId.trim(),
    completedTaskIds: completedTaskIds.map((id) => String(id).trim()),
    feeling,
    note,
  };
}

async function submitCheckin(openid, event) {
  const input = validateCheckinInput(event);
  const businessDate = formatBusinessDate();
  const checkinId = stableId("checkin", `${openid}:${businessDate}`);

  // Verify goal ownership.
  const goal = await getFirst("goals", {
    _openid: openid,
    _id: input.goalId,
    status: "active",
  });
  if (!goal) {
    fail("GOAL_NOT_FOUND", "当前目标不存在，请重新进入小程序。");
  }

  // Verify plan ownership and association with goal.
  const plan = await getFirst("plans", {
    _openid: openid,
    _id: input.planId,
    goalId: input.goalId,
  });
  if (!plan) {
    fail("PLAN_NOT_FOUND", "当前计划不存在，请重新进入小程序。");
  }
  if (plan.status === "paused") {
    fail("PLAN_PAUSED", "计划暂停期间不能提交打卡。");
  }
  if (plan.status !== "active") {
    fail("PLAN_STATUS_INVALID", "当前计划状态不支持打卡。");
  }

  // Fetch today's tasks and build valid ID set.
  const todayTasks = await getMany("tasks", {
    _openid: openid,
    planId: input.planId,
    taskDate: businessDate,
  });

  if (todayTasks.length === 0) {
    fail("TASK_NOT_FOUND", "今日暂无任务安排。");
  }

  const validTaskIds = new Set(todayTasks.map((task) => String(task._id)));
  const validCompletedIds = input.completedTaskIds.filter((id) =>
    validTaskIds.has(id),
  );

  if (validCompletedIds.length === 0) {
    fail("INVALID_ARGUMENT", "至少需要完成一项有效任务。");
  }

  const totalCount = todayTasks.length;
  const completedCount = validCompletedIds.length;
  const completionRate = clampPercentage((completedCount / totalCount) * 100);
  const userId = stableId("user", openid);

  return db.runTransaction(async (transaction) => {
    // Idempotency: check existing checkin for today.
    const existing = await transaction
      .collection("checkins")
      .doc(checkinId)
      .get()
      .catch(() => null);
    if (existing && existing.data) {
      fail("CHECKIN_ALREADY_EXISTS", "今天已经打过卡了，明天继续加油。");
    }

    // Calculate streak: check yesterday's checkin record.
    const yesterdayDate = addBusinessDays(businessDate, -1);
    const yesterdayCheckinId = stableId("checkin", `${openid}:${yesterdayDate}`);
    const yesterdayRecord = await transaction
      .collection("checkins")
      .doc(yesterdayCheckinId)
      .get()
      .catch(() => null);
    const streakDays =
      yesterdayRecord && yesterdayRecord.data
        ? Number(yesterdayRecord.data.streakDays || 0) + 1
        : 1;

    const now = db.serverDate();

    // Write checkin record using deterministic ID.
    await transaction.collection("checkins").doc(checkinId).set({
      data: {
        _openid: openid,
        goalId: input.goalId,
        planId: input.planId,
        businessDate,
        completedTaskIds: validCompletedIds,
        completedCount,
        totalCount,
        completionRate,
        feeling: input.feeling,
        note: input.note,
        streakDays,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Update user streak.
    const existingUser = await transaction
      .collection("users")
      .doc(userId)
      .get()
      .catch(() => null);
    if (existingUser && existingUser.data) {
      await transaction.collection("users").doc(userId).update({
        data: {
          streakDays,
          updatedAt: now,
        },
      });
    } else {
      await transaction.collection("users").doc(userId).set({
        data: {
          _openid: openid,
          streakDays,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    return {
      businessDate,
      completedCount,
      totalCount,
      completionRate,
      streakDays,
      isFirstCheckinToday: true,
    };
  });
}

async function getCheckinStatus(openid) {
  const businessDate = formatBusinessDate();

  const [checkinRecords, goal] = await Promise.all([
    db
      .collection("checkins")
      .where({ _openid: openid, businessDate })
      .limit(1)
      .get(),
    getFirst("goals", { _openid: openid, status: "active" }),
  ]);

  const checkedInToday = checkinRecords.data.length > 0;

  if (!goal) {
    return {
      checkedInToday,
      tasks: [],
      completedCount: 0,
      totalCount: 0,
      planStatus: null,
    };
  }

  const plans = await getMany("plans", {
    _openid: openid,
    goalId: goal._id,
  }, 20);
  const plan =
    plans.find((item) => item.status === "active") ||
    plans.find((item) => item.status === "paused") ||
    null;

  if (!plan) {
    return {
      checkedInToday,
      tasks: [],
      completedCount: 0,
      totalCount: 0,
      planStatus: null,
    };
  }

  const todayTaskRecords = await getMany("tasks", {
    _openid: openid,
    planId: plan._id,
    taskDate: businessDate,
  });

  todayTaskRecords.sort(
    (left, right) => Number(left.order || 0) - Number(right.order || 0),
  );

  const tasks = todayTaskRecords.map((task) => ({
    id: String(task._id || ""),
    title: String(task.title || "今日任务"),
    description: String(task.description || task.dayTitle || ""),
    estimatedMinutes: Math.max(Number(task.estimatedMinutes) || 0, 0),
    completed: task.status === "completed",
  }));

  const completedCount = tasks.filter((task) => task.completed).length;

  return {
    checkedInToday,
    tasks,
    completedCount,
    totalCount: tasks.length,
    planStatus: plan.status,
  };
}

module.exports = {
  submitCheckin,
  getCheckinStatus,
};
