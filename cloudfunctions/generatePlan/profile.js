const cloud = require("wx-server-sdk");
const { businessDateDiff, formatBusinessDate } = require("./date");
const { buildBadges, isCommunityUnlocked } = require("./profile-rules");
const { stableId } = require("./repository");

const db = cloud.database();
const CATEGORY_LABELS = {
  exam: "考试备考",
  skill: "技能学习",
  career: "求职提升",
  reading: "阅读成长",
  fitness: "运动健康",
  habit: "习惯养成",
  other: "其他目标",
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function getFirst(collectionName, where) {
  const result = await db.collection(collectionName).where(where).limit(1).get();
  return result.data[0] || null;
}

async function getMany(collectionName, where, limit = 1000) {
  const result = await db.collection(collectionName).where(where).limit(limit).get();
  return result.data || [];
}

async function getCommunityConfig() {
  const result = await db
    .collection("community_config")
    .doc("default")
    .get()
    .catch(() => null);
  return (result && result.data) || null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.$date) return new Date(value.$date);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toBusinessDate(value) {
  const date = toDate(value);
  return date ? formatBusinessDate(date) : "";
}

function createdTimestamp(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function calculateJoinedDays(user) {
  const createdAt = toDate(user && user.createdAt);
  if (!createdAt) return 0;
  return Math.max(
    businessDateDiff(formatBusinessDate(createdAt), formatBusinessDate()) + 1,
    1,
  );
}

function calculateCurrentDay(plan, businessDate) {
  if (!plan || !plan.startDate) return 1;
  const durationDays = Math.max(Number(plan.durationDays || plan.totalDays || 7), 1);
  return Math.min(
    Math.max(businessDateDiff(plan.startDate, businessDate) + 1, 1),
    durationDays,
  );
}

function findCheckinUnlockDate(checkins, predicate) {
  const record = checkins.find(predicate);
  return record ? String(record.businessDate || "") : "";
}

async function buildProfile(openid) {
  const businessDate = formatBusinessDate();
  const [user, goals, plans, tasks, checkins, communityConfig] = await Promise.all([
    getFirst("users", { _openid: openid }),
    getMany("goals", { _openid: openid }),
    getMany("plans", { _openid: openid }),
    getMany("tasks", { _openid: openid }),
    getMany("checkins", { _openid: openid }),
    getCommunityConfig(),
  ]);
  checkins.sort((left, right) =>
    String(left.businessDate || "").localeCompare(String(right.businessDate || "")),
  );
  plans.sort((left, right) => createdTimestamp(left.createdAt) - createdTimestamp(right.createdAt));

  const currentGoal = goals.find((goal) => goal.status === "active") || null;
  const currentPlan = currentGoal
    ? plans.find(
        (plan) =>
          plan.goalId === currentGoal._id &&
          ["active", "paused", "reviewing"].includes(plan.status),
      ) || null
    : null;
  const currentPlanTasks = currentPlan
    ? tasks.filter((task) => task.planId === currentPlan._id)
    : [];
  const currentCompletedCount = currentPlanTasks.filter(
    (task) => task.status === "completed",
  ).length;
  const totalCheckinDays = new Set(
    checkins.map((record) => String(record.businessDate || "")).filter(Boolean),
  ).size;
  const longestStreak = Math.max(
    Number((user && (user.longestStreak || user.streakDays)) || 0),
    ...checkins.map((record) => Number(record.streakDays || 0)),
  );
  const completedTasks = tasks.filter((task) => task.status === "completed");
  const completedStages = plans.filter((plan) => plan.status === "completed");
  const statistics = {
    totalCheckinDays,
    longestStreak,
    completedTaskCount: completedTasks.length,
    totalActionMinutes: completedTasks.reduce(
      (total, task) => total + Math.max(Number(task.estimatedMinutes || 0), 0),
      0,
    ),
    completedStageCount: completedStages.length,
  };
  const unlockDates = {
    first_checkin: findCheckinUnlockDate(checkins, () => true),
    streak_3: findCheckinUnlockDate(checkins, (record) => Number(record.streakDays || 0) >= 3),
    streak_7: findCheckinUnlockDate(checkins, (record) => Number(record.streakDays || 0) >= 7),
    checkin_10: checkins[9] ? String(checkins[9].businessDate || "") : "",
    first_stage_completed: completedStages[0] ? toBusinessDate(
      completedStages[0].completedAt || completedStages[0].updatedAt,
    ) : "",
  };

  const endedGoals = goals
    .filter((goal) => goal.status === "completed" || goal.status === "stopped")
    .sort((left, right) => createdTimestamp(right.createdAt) - createdTimestamp(left.createdAt))
    .slice(0, 3)
    .map((goal) => {
      const goalPlans = plans.filter((plan) => plan.goalId === goal._id);
      const goalPlanIds = new Set(goalPlans.map((plan) => plan._id));
      return {
        id: String(goal._id),
        title: String(goal.title || goal.goalTitle || "成长目标"),
        category: String(goal.category || ""),
        categoryLabel: CATEGORY_LABELS[goal.category] || "成长行动",
        status: goal.status === "completed" ? "completed" : "stopped",
        startedAt: toBusinessDate(goal.createdAt),
        endedAt: toBusinessDate(goal.completedAt || goal.stoppedAt || goal.updatedAt),
        checkinDays: new Set(
          checkins
            .filter((record) => record.goalId === goal._id)
            .map((record) => String(record.businessDate || "")),
        ).size,
        completedStageCount: goalPlans.filter((plan) => plan.status === "completed").length,
        completedTaskCount: tasks.filter(
          (task) => goalPlanIds.has(task.planId) && task.status === "completed",
        ).length,
      };
    });
  const communityUnlocked = isCommunityUnlocked({
    hasCurrentGoal: Boolean(currentGoal),
    totalCheckinDays,
    longestStreak,
  }, communityConfig || {});
  const minimumStreakDays = Math.max(
    Number((communityConfig && communityConfig.minimumStreakDays) || 3),
    0,
  );

  return {
    businessDate,
    user: {
      nickname: String((user && user.nickname) || "进步行动者"),
      avatarUrl: String((user && user.avatarUrl) || ""),
      joinedDays: calculateJoinedDays(user),
      streakDays: Math.max(Number((user && user.streakDays) || 0), 0),
    },
    currentGoal: currentGoal
      ? {
          id: String(currentGoal._id),
          planId: currentPlan ? String(currentPlan._id) : "",
          title: String(currentGoal.title || currentGoal.goalTitle || "当前目标"),
          category: String(currentGoal.category || ""),
          categoryLabel: CATEGORY_LABELS[currentGoal.category] || "成长行动",
          stageTitle: String(
            (currentPlan &&
              (currentPlan.stageTitle ||
                currentPlan.title ||
                currentPlan.weeklyGoal ||
                currentPlan.summary)) ||
              "当前行动阶段",
          ),
          currentDay: currentPlan ? calculateCurrentDay(currentPlan, businessDate) : 1,
          totalDays: currentPlan
            ? Math.max(Number(currentPlan.durationDays || currentPlan.totalDays || 7), 1)
            : 7,
          planStatus: currentPlan ? String(currentPlan.status) : "completed",
          stageCompletionRate:
            currentPlanTasks.length > 0
              ? Math.round((currentCompletedCount / currentPlanTasks.length) * 100)
              : 0,
        }
      : null,
    statistics,
    badges: buildBadges(
      {
        checkinDays: totalCheckinDays,
        longestStreak,
        completedStages: completedStages.length,
      },
      unlockDates,
    ),
    recentGoals: endedGoals,
    community: {
      unlocked: communityUnlocked,
      title: communityUnlocked ? "加入微信陪跑群" : "微信陪跑群尚未解锁",
      description: communityUnlocked
        ? "你已满足基础行动条件，可查看社群入口。"
        : `完成首次打卡并连续行动 ${minimumStreakDays} 天后解锁。`,
    },
  };
}

async function getProfileData(openid) {
  return buildProfile(openid);
}

async function getCommunityEntry(openid) {
  const profile = await buildProfile(openid);
  if (!profile.community.unlocked) {
    fail("COMMUNITY_LOCKED", profile.community.description);
  }

  const config = await getCommunityConfig();
  if (!config || config.status !== "active") {
    fail("COMMUNITY_CONFIG_NOT_FOUND", "社群入口暂未配置，请稍后再来看看。");
  }
  const expiresAt = toDate(config.expiresAt);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    fail("COMMUNITY_CONFIG_NOT_FOUND", "当前社群入口已过期，请稍后再来看看。");
  }

  return {
    unlocked: true,
    title: String(config.title || "加入微信陪跑群"),
    description: String(config.description || "扫码加入陪跑群，一起稳步行动。"),
    imageFileId: String(config.imageFileId || ""),
    expiresAt: expiresAt ? expiresAt.toISOString() : "",
  };
}

async function removeMembership(membership) {
  await db.runTransaction(async (transaction) => {
    const current = await transaction
      .collection("team_members")
      .doc(membership._id)
      .get()
      .catch(() => null);
    if (!current || !current.data) return;

    const teamResult = await transaction
      .collection("teams")
      .doc(current.data.teamId)
      .get()
      .catch(() => null);
    if (
      current.data.status === "active" &&
      teamResult &&
      teamResult.data
    ) {
      const nextCount = Math.max(Number(teamResult.data.memberCount || 0) - 1, 0);
      await transaction.collection("teams").doc(current.data.teamId).update({
        data: {
          memberCount: nextCount,
          status: nextCount === 0 ? "closed" : teamResult.data.status,
          updatedAt: db.serverDate(),
        },
      });
    }
    await transaction.collection("team_members").doc(membership._id).remove();
  });
}

async function deleteUserData(openid, event) {
  if (!event || event.confirmation !== "确认清除") {
    fail("DELETE_CONFIRMATION_INVALID", "请输入“确认清除”后再提交。");
  }

  const userKey = stableId("user", openid);
  const user = await getFirst("users", { _openid: openid });
  if (!user) {
    return { deleted: false };
  }

  try {
    const memberships = await getMany("team_members", { userKey });
    for (const membership of memberships) {
      await removeMembership(membership);
    }

    await Promise.all([
      db.collection("encouragements").where({ senderUserKey: userKey }).remove(),
      db.collection("encouragements").where({ receiverUserKey: userKey }).remove(),
      db.collection("checkins").where({ _openid: openid }).remove(),
      db.collection("tasks").where({ _openid: openid }).remove(),
      db.collection("plans").where({ _openid: openid }).remove(),
      db.collection("goals").where({ _openid: openid }).remove(),
      db.collection("plan_generation_requests").where({ _openid: openid }).remove(),
      db.collection("stage_generation_requests").where({ _openid: openid }).remove(),
      db.collection("stage_previews").where({ _openid: openid }).remove(),
      db.collection("stage_reviews").where({ _openid: openid }).remove(),
    ]);
    await db.collection("team_members").where({ userKey }).remove();
    await db.collection("users").where({ _openid: openid }).remove();
    return { deleted: true };
  } catch (error) {
    const deleteError = new Error("Data deletion failed");
    deleteError.code = "DATA_DELETE_FAILED";
    throw deleteError;
  }
}

module.exports = {
  deleteUserData,
  getCommunityEntry,
  getProfileData,
};
