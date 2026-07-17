const crypto = require("crypto");
const cloud = require("wx-server-sdk");

const db = cloud.database();
const command = db.command;
const REQUIRED_COLLECTIONS = [
  "users",
  "goals",
  "plans",
  "tasks",
  "plan_generation_requests",
  "checkins",
  "teams",
  "team_members",
  "encouragements",
  "community_config",
  "stage_generation_requests",
  "stage_previews",
  "stage_reviews",
  "goal_analysis_drafts",
  "stage_preview_versions",
  "progress_ai_snapshots",
  "manual_goals",
  "manual_tasks",
  "manual_checkins",
  "manual_archived_goals",
  "achievement_unlocks",
  "spark_checkins",
  "coach_action_proposals",
  "account_bindings",
  "user_consents",
  "account_operations",
  "subscription_ledger",
  "notification_preference",
  "notification_sent_log",
  "in_app_messages",
];
let collectionsReady = false;

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function hashPlan(plan) {
  return crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

async function ensureCollections() {
  if (collectionsReady) return;

  for (const collectionName of REQUIRED_COLLECTIONS) {
    try {
      await db.createCollection(collectionName);
    } catch (error) {
      const message = String(error && (error.errMsg || error.message || error));
      const alreadyExists =
        error.errCode === -502005 ||
        message.includes("DATABASE_COLLECTION_EXIST") ||
        message.includes("CollectionName") ||
        message.includes("already exists") ||
        message.includes("exist");
      if (!alreadyExists) {
        throw error;
      }
    }
  }
  collectionsReady = true;
}

async function recordGeneration(openid, requestId, source, status, planHash = "") {
  const id = stableId("generation", `${openid}:${requestId}`);
  await db.collection("plan_generation_requests").doc(id).set({
    data: {
      _openid: openid,
      requestId,
      source,
      status,
      planHash,
      updatedAt: db.serverDate(),
      createdAt: db.serverDate(),
    },
  });
}

async function verifyGeneratedPlan(openid, requestId, plan) {
  const id = stableId("generation", `${openid}:${requestId}`);
  const result = await db.collection("plan_generation_requests").doc(id).get().catch(() => null);
  const record = result && result.data;
  if (
    !record ||
    record._openid !== openid ||
    record.status !== "generated" ||
    record.planHash !== hashPlan(plan)
  ) {
    const error = new Error("计划预览已失效，请重新生成。");
    error.code = "PLAN_SCHEMA_INVALID";
    throw error;
  }
}

async function enforceRateLimit(openid, requestId, bypassRecent = false) {
  const sameRequestId = stableId("generation", `${openid}:${requestId}`);
  const duplicate = await db.collection("plan_generation_requests").doc(sameRequestId).get().catch(() => null);
  if (duplicate && duplicate.data) {
    const error = new Error("请勿重复提交同一次生成请求。");
    error.code = "RATE_LIMITED";
    throw error;
  }

  if (bypassRecent) return;

  const cutoff = new Date(Date.now() - 60 * 1000);
  const recent = await db
    .collection("plan_generation_requests")
    .where({
      _openid: openid,
      createdAt: command.gte(cutoff),
    })
    .limit(1)
    .get();
  if (recent.data.length) {
    const error = new Error("生成得有点快，请稍等一分钟再试。");
    error.code = "RATE_LIMITED";
    throw error;
  }
}

async function adoptPlan(openid, requestId, goal, plan) {
  const goalId = stableId("goal", `${openid}:${requestId}`);
  const planId = stableId("plan", `${openid}:${requestId}`);
  const userId = stableId("user", openid);

  return db.runTransaction(async (transaction) => {
    const existingPlan = await transaction.collection("plans").doc(planId).get().catch(() => null);
    if (existingPlan && existingPlan.data && existingPlan.data.status === "active") {
      return { goalId, planId, adopted: false };
    }

    const activeGoals = await transaction
      .collection("goals")
      .where({
        _openid: openid,
        status: "active",
      })
      .limit(1)
      .get();
    if (activeGoals.data.length) {
      const error = new Error("你已经有一个进行中的目标，V1 暂不支持同时创建多个目标。");
      error.code = "GOAL_ALREADY_EXISTS";
      throw error;
    }

    const now = db.serverDate();
    await transaction.collection("goals").doc(goalId).set({
      data: {
        _openid: openid,
        category: goal.category,
        goalTitle: goal.goalTitle,
        goalTemplate: goal.goalTemplate,
        currentLevel: goal.currentLevel,
        deadline: goal.deadline,
        weeklyDays: goal.weeklyDays,
        dailyMinutes: goal.dailyMinutes,
        intensity: goal.intensity,
        status: "active",
        requestId,
        createdAt: now,
        updatedAt: now,
      },
    });

    await transaction.collection("plans").doc(planId).set({
      data: {
        _openid: openid,
        goalId,
        summary: plan.summary,
        weeklyGoal: plan.weeklyGoal,
        fallbackAdvice: plan.fallbackAdvice,
        source: plan.source,
        status: "active",
        startDate: plan.days[0].date,
        endDate: plan.days[plan.days.length - 1].date,
        plannedEndDate: plan.days[plan.days.length - 1].date,
        planDurationDays: plan.days.length,
        dailyReminderTime: "21:00",
        requestId,
        createdAt: now,
        updatedAt: now,
      },
    });

    for (const day of plan.days) {
      for (let index = 0; index < day.tasks.length; index += 1) {
        const task = day.tasks[index];
        const taskId = stableId("task", `${openid}:${requestId}:${day.day}:${index}`);
        await transaction.collection("tasks").doc(taskId).set({
          data: {
            _openid: openid,
            goalId,
            planId,
            day: day.day,
            taskDate: day.date,
            dayTitle: day.title,
            isStudyDay: day.isStudyDay,
            title: task.title,
            estimatedMinutes: task.estimatedMinutes,
            order: index + 1,
            status: "pending",
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }

    const existingUser = await transaction.collection("users").doc(userId).get().catch(() => null);
    if (existingUser && existingUser.data) {
      await transaction.collection("users").doc(userId).update({
        data: {
          currentGoalId: goalId,
          updatedAt: now,
        },
      });
    } else {
      await transaction.collection("users").doc(userId).set({
        data: {
          _openid: openid,
          currentGoalId: goalId,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    return { goalId, planId, adopted: true };
  });
}

async function adoptNextWeekPlan(openid, requestId, goal, previousPlan, plan) {
  const planId = stableId("plan", `${openid}:${requestId}`);
  return db.runTransaction(async (transaction) => {
    const existingPlan = await transaction.collection("plans").doc(planId).get().catch(() => null);
    if (existingPlan && existingPlan.data) {
      return { goalId: goal._id, planId, adopted: false };
    }

    const currentResult = await transaction
      .collection("plans")
      .doc(previousPlan._id)
      .get()
      .catch(() => null);
    const current = currentResult && currentResult.data;
    if (!current || current._openid !== openid || current.status !== "active") {
      const error = new Error("当前计划状态已变化，请刷新后重试。");
      error.code = "PLAN_STATUS_INVALID";
      throw error;
    }

    const now = db.serverDate();
    await transaction.collection("plans").doc(previousPlan._id).update({
      data: {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      },
    });
    await transaction.collection("plans").doc(planId).set({
      data: {
        _openid: openid,
        goalId: goal._id,
        summary: plan.summary,
        weeklyGoal: plan.weeklyGoal,
        fallbackAdvice: plan.fallbackAdvice,
        source: plan.source,
        status: "active",
        startDate: plan.days[0].date,
        endDate: plan.days[plan.days.length - 1].date,
        plannedEndDate: plan.days[plan.days.length - 1].date,
        planDurationDays: plan.days.length,
        previousPlanId: previousPlan._id,
        dailyReminderTime: previousPlan.dailyReminderTime || "21:00",
        requestId,
        createdAt: now,
        updatedAt: now,
      },
    });

    for (const day of plan.days) {
      for (let index = 0; index < day.tasks.length; index += 1) {
        const task = day.tasks[index];
        const taskId = stableId("task", `${openid}:${requestId}:${day.day}:${index}`);
        await transaction.collection("tasks").doc(taskId).set({
          data: {
            _openid: openid,
            goalId: goal._id,
            planId,
            day: day.day,
            taskDate: day.date,
            dayTitle: day.title,
            isStudyDay: day.isStudyDay,
            title: task.title,
            estimatedMinutes: task.estimatedMinutes,
            order: index + 1,
            status: "pending",
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }
    return { goalId: goal._id, planId, adopted: true };
  });
}

async function hasActiveGoal(openid) {
  const result = await db
    .collection("goals")
    .where({
      _openid: openid,
      status: "active",
    })
    .limit(1)
    .get();
  return result.data.length > 0;
}

async function getCurrentPlan(openid) {
  const goalsResult = await db
    .collection("goals")
    .where({
      _openid: openid,
      status: "active",
    })
    .limit(1)
    .get();
  const goal = goalsResult.data[0];
  if (!goal) return null;

  const plansResult = await db
    .collection("plans")
    .where({
      _openid: openid,
      goalId: goal._id,
      status: "active",
    })
    .limit(1)
    .get();
  const plan = plansResult.data[0];
  if (!plan) return null;

  return {
    goalId: goal._id,
    planId: plan._id,
    goalTitle: goal.goalTitle,
    summary: plan.summary,
    weeklyGoal: plan.weeklyGoal,
    startDate: plan.startDate,
    endDate: plan.endDate,
    source: plan.source,
  };
}

async function deleteCurrentPlan(openid) {
  const goalsResult = await db
    .collection("goals")
    .where({
      _openid: openid,
      status: "active",
    })
    .limit(1)
    .get();
  const goal = goalsResult.data[0];
  if (!goal) {
    return { deleted: false };
  }

  await db.collection("tasks").where({
    _openid: openid,
    goalId: goal._id,
  }).remove();

  await db.collection("checkins").where({
    _openid: openid,
    goalId: goal._id,
  }).remove();

  await db.collection("stage_reviews").where({
    _openid: openid,
    goalId: goal._id,
  }).remove();

  await db.collection("stage_previews").where({
    _openid: openid,
    goalId: goal._id,
  }).remove();

  await db.collection("plans").where({
    _openid: openid,
    goalId: goal._id,
  }).remove();

  await db.collection("goals").doc(goal._id).remove();

  const userId = stableId("user", openid);
  await db.collection("users").doc(userId).update({
    data: {
      currentGoalId: command.remove(),
      updatedAt: db.serverDate(),
    },
  }).catch(() => null);

  if (goal.requestId) {
    const generationId = stableId("generation", `${openid}:${goal.requestId}`);
    await db.collection("plan_generation_requests").doc(generationId).remove().catch(() => null);
  }

  return { deleted: true };
}

module.exports = {
  adoptPlan,
  adoptNextWeekPlan,
  deleteCurrentPlan,
  ensureCollections,
  enforceRateLimit,
  getCurrentPlan,
  hasActiveGoal,
  hashPlan,
  recordGeneration,
  stableId,
  verifyGeneratedPlan,
};
