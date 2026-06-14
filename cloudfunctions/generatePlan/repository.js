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
];

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function hashPlan(plan) {
  return crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

async function ensureCollections() {
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
        endDate: plan.days[6].date,
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

module.exports = {
  adoptPlan,
  ensureCollections,
  enforceRateLimit,
  hasActiveGoal,
  hashPlan,
  recordGeneration,
  verifyGeneratedPlan,
};
