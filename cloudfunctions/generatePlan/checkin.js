const cloud = require("wx-server-sdk");
const { addBusinessDays, formatBusinessDate } = require("./date");
const { DANGEROUS_CONTENT } = require("./constants");
const { stableId } = require("./repository");

const db = cloud.database();

const VALID_FEELINGS = ["easy", "normal", "challenging", "rewarding"];
const VALID_STATUSES = ["completed", "partially_completed", "skipped", "rescheduled"];
const VALID_SKIP_REASONS = [
  "not_enough_time",
  "too_difficult",
  "insufficient_resources",
  "not_feeling_well",
  "unexpected_event",
  "task_not_realistic",
  "other",
];

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

function computeOverallStatus(taskResults) {
  const statuses = taskResults.map((r) => r.status);
  const completedCount = statuses.filter((s) => s === "completed").length;
  const partialCount = statuses.filter((s) => s === "partially_completed").length;
  const rescheduledCount = statuses.filter((s) => s === "rescheduled").length;

  if (completedCount === statuses.length) return "completed";
  if (completedCount + partialCount > 0) return "partially_completed";
  if (rescheduledCount === statuses.length) return "rescheduled";
  return "skipped";
}

function validateCheckinInput(event) {
  if (!event || typeof event !== "object") {
    fail("INVALID_ARGUMENT", "打卡信息不完整。");
  }

  const { goalId, planId, feeling } = event;

  if (typeof goalId !== "string" || !goalId.trim()) {
    fail("INVALID_ARGUMENT", "目标 ID 无效。");
  }
  if (typeof planId !== "string" || !planId.trim()) {
    fail("INVALID_ARGUMENT", "计划 ID 无效。");
  }

  // Validate taskResults (new format) or fall back to completedTaskIds (legacy).
  let taskResults = [];

  if (Array.isArray(event.taskResults) && event.taskResults.length > 0) {
    for (const item of event.taskResults) {
      if (!item || typeof item !== "object") {
        fail("INVALID_ARGUMENT", "任务结果格式无效。");
      }
      if (typeof item.taskId !== "string" || !item.taskId.trim()) {
        fail("INVALID_ARGUMENT", "任务 ID 格式无效。");
      }
      if (!VALID_STATUSES.includes(item.status)) {
        fail("INVALID_ARGUMENT", "任务状态无效。");
      }
      taskResults.push({
        taskId: item.taskId.trim(),
        status: item.status,
      });
    }
  } else if (Array.isArray(event.completedTaskIds) && event.completedTaskIds.length > 0) {
    // Legacy format: convert to taskResults with all completed.
    for (const id of event.completedTaskIds) {
      if (typeof id !== "string" || !id.trim()) {
        fail("INVALID_ARGUMENT", "任务 ID 格式无效。");
      }
      taskResults.push({ taskId: String(id).trim(), status: "completed" });
    }
  } else {
    fail("INVALID_ARGUMENT", "请至少为一项任务选择执行状态。");
  }

  if (!VALID_FEELINGS.includes(feeling)) {
    fail("INVALID_ARGUMENT", "感受选项无效。");
  }

  // Validate skipReason (optional).
  let skipReason = "";
  if (event.skipReason !== undefined && event.skipReason !== null && event.skipReason !== "") {
    if (!VALID_SKIP_REASONS.includes(event.skipReason)) {
      fail("INVALID_ARGUMENT", "原因选项无效。");
    }
    skipReason = event.skipReason;
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
    taskResults,
    feeling,
    note,
    skipReason,
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
  if (!["active", "expired", "extended"].includes(plan.status)) {
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
  const validTaskResults = input.taskResults.filter((r) => validTaskIds.has(r.taskId));

  if (validTaskResults.length === 0) {
    fail("INVALID_ARGUMENT", "至少需要一项有效任务。");
  }

  // Compute statistics from taskResults.
  const totalCount = todayTasks.length;
  const completedCount = validTaskResults.filter((r) => r.status === "completed").length;
  const partiallyCompletedCount = validTaskResults.filter(
    (r) => r.status === "partially_completed",
  ).length;
  const skippedCount = validTaskResults.filter((r) => r.status === "skipped").length;
  const rescheduledCount = validTaskResults.filter(
    (r) => r.status === "rescheduled",
  ).length;
  const completionRate = clampPercentage((completedCount / totalCount) * 100);
  const overallStatus = computeOverallStatus(validTaskResults);

  // Legacy: extract completedTaskIds for backward compatibility.
  const completedTaskIds = validTaskResults
    .filter((r) => r.status === "completed")
    .map((r) => r.taskId);

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

    let streakDays;
    if (yesterdayRecord && yesterdayRecord.data) {
      const yesterdayOverallStatus = yesterdayRecord.data.overallStatus;
      // Backward compat: old records without overallStatus count as active.
      const yesterdayActive =
        !yesterdayOverallStatus ||
        ["completed", "partially_completed"].includes(yesterdayOverallStatus);
      streakDays = yesterdayActive
        ? Number(yesterdayRecord.data.streakDays || 0) + 1
        : 1;
    } else {
      streakDays = 1;
    }

    // If today is skipped/rescheduled, streak resets.
    const effectiveStreakDays = ["completed", "partially_completed"].includes(overallStatus)
      ? streakDays
      : 0;

    const now = db.serverDate();

    // Write checkin record using deterministic ID.
    await transaction.collection("checkins").doc(checkinId).set({
      data: {
        _openid: openid,
        goalId: input.goalId,
        planId: input.planId,
        businessDate,
        taskResults: validTaskResults,
        overallStatus,
        skipReason: input.skipReason,
        // Legacy fields for backward compatibility.
        completedTaskIds,
        completedCount,
        partiallyCompletedCount,
        skippedCount,
        rescheduledCount,
        totalCount,
        completionRate,
        feeling: input.feeling,
        note: input.note,
        streakDays: effectiveStreakDays,
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
          streakDays: effectiveStreakDays,
          updatedAt: now,
        },
      });
    } else {
      await transaction.collection("users").doc(userId).set({
        data: {
          _openid: openid,
          streakDays: effectiveStreakDays,
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
      streakDays: effectiveStreakDays,
      overallStatus,
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

  // If there's a checkin record today, use its taskResults for status mapping.
  const todayCheckin = checkedInToday ? checkinRecords.data[0] : null;
  const checkinResultMap = {};
  if (todayCheckin && Array.isArray(todayCheckin.taskResults)) {
    for (const r of todayCheckin.taskResults) {
      checkinResultMap[r.taskId] = r.status;
    }
  }

  const tasks = todayTaskRecords.map((task) => {
    const taskId = String(task._id || "");
    const completed = task.status === "completed";
    const resultStatus = checkinResultMap[taskId] || (completed ? "completed" : undefined);
    return {
      id: taskId,
      title: String(task.title || "今日任务"),
      description: String(task.description || task.dayTitle || ""),
      estimatedMinutes: Math.max(Number(task.estimatedMinutes) || 0, 0),
      completed,
      resultStatus,
    };
  });

  const completedCount = tasks.filter((task) => task.completed).length;

  // Include taskResults in response if checkin exists.
  const response = {
    checkedInToday,
    tasks,
    completedCount,
    totalCount: tasks.length,
    planStatus: plan.status,
  };

  if (todayCheckin && Array.isArray(todayCheckin.taskResults)) {
    response.taskResults = todayCheckin.taskResults;
  }

  return response;
}

module.exports = {
  submitCheckin,
  getCheckinStatus,
};
