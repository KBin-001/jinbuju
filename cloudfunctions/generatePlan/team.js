const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { formatBusinessDate } = require("./date");
const { stableId } = require("./repository");
const {
  ENCOURAGEMENT_TYPES,
  isValidEncouragementType,
  publicMemberId,
} = require("./team-rules");

const db = cloud.database();
const command = db.command;
const MAX_MEMBERS = 5;
const CATEGORY_LABELS = {
  exam: "考试备考",
  skill: "技能学习",
  career: "求职提升",
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function createTeamNumber(seed) {
  const value = parseInt(
    crypto.createHash("sha256").update(seed).digest("hex").slice(0, 8),
    16,
  );
  return (value % 9000) + 1000;
}

async function getFirst(collectionName, where) {
  const result = await db.collection(collectionName).where(where).limit(1).get();
  return result.data[0] || null;
}

async function getMany(collectionName, where, limit = 100) {
  const result = await db.collection(collectionName).where(where).limit(limit).get();
  return result.data || [];
}

async function getCurrentStage(openid) {
  const userKey = stableId("user", openid);
  const userResult = await db.collection("users").doc(userKey).get().catch(() => null);
  if (!userResult || !userResult.data || userResult.data._openid !== openid) {
    fail("UNAUTHORIZED", "用户信息不存在，请重新进入小程序。");
  }
  const goal = await getFirst("goals", { _openid: openid, status: "active" });
  if (!goal) fail("GOAL_NOT_FOUND", "请先创建当前目标。");

  const plans = await getMany("plans", {
    _openid: openid,
    goalId: goal._id,
  }, 20);
  const plan =
    plans.find((item) => item.status === "active") ||
    plans.find((item) => item.status === "paused") ||
    null;
  if (!plan) fail("STAGE_NOT_FOUND", "当前目标还没有可加入小队的行动阶段。");
  return { goal, plan };
}

async function getMembershipByUserKey(userKey) {
  return getFirst("team_members", { userKey, status: "active" });
}

async function countEncouragements(teamId, receiverUserKey) {
  const result = await db
    .collection("encouragements")
    .where({ teamId, receiverUserKey })
    .count();
  return Number(result.total || 0);
}

async function buildMemberSummary(team, membership, currentUserKey, businessDate) {
  const userResult = await db.collection("users").doc(membership.userKey).get().catch(() => null);
  const user = userResult && userResult.data;
  const memberOpenid = user && user._openid;

  let todayCompleted = false;
  let todayRest = false;
  let stageCompletionRate = 0;
  if (memberOpenid) {
    const [checkin, tasks] = await Promise.all([
      getFirst("checkins", {
        _openid: memberOpenid,
        planId: membership.stageId,
        businessDate,
      }),
      getMany("tasks", {
        _openid: memberOpenid,
        planId: membership.stageId,
      }),
    ]);
    todayCompleted = Boolean(checkin);
    todayRest =
      !tasks.some((task) => task.taskDate === businessDate) &&
      businessDate >= String(team.stageStartDate) &&
      businessDate <= String(team.stageEndDate);
    const completed = tasks.filter((task) => task.status === "completed").length;
    stageCompletionRate =
      tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
  }

  const encouragementId = stableId(
    "encouragement",
    `${team._id}:${currentUserKey}:${membership.userKey}:${businessDate}`,
  );
  const [encouragementCount, encouragedRecord] = await Promise.all([
    countEncouragements(team._id, membership.userKey),
    db.collection("encouragements").doc(encouragementId).get().catch(() => null),
  ]);

  return {
    id: publicMemberId(team._id, membership.userKey),
    nickname: String((user && user.nickname) || "行动伙伴"),
    avatarUrl: String((user && user.avatarUrl) || ""),
    isSelf: membership.userKey === currentUserKey,
    streakDays: Math.max(Number((user && user.streakDays) || 0), 0),
    todayCompleted,
    todayRest,
    stageCompletionRate,
    encouragementCount,
    encouragedByMeToday: Boolean(encouragedRecord && encouragedRecord.data),
  };
}

async function getMyTeam(openid) {
  const userKey = stableId("user", openid);
  const membership = await getMembershipByUserKey(userKey);
  if (!membership) {
    return { team: null, members: [] };
  }

  const teamResult = await db.collection("teams").doc(membership.teamId).get().catch(() => null);
  const team = teamResult && teamResult.data;
  if (!team || team.status !== "active") {
    fail("TEAM_NOT_FOUND", "当前小队不存在。");
  }

  const memberships = await getMany("team_members", {
    teamId: team._id,
    status: "active",
  }, MAX_MEMBERS);
  if (!memberships.some((item) => item.userKey === userKey)) {
    fail("NOT_TEAM_MEMBER", "你不是该小队的有效成员。");
  }

  memberships.sort((left, right) =>
    String(left.joinOrder || left._id).localeCompare(String(right.joinOrder || right._id)),
  );
  const businessDate = formatBusinessDate();
  const members = await Promise.all(
    memberships.map((item) =>
      buildMemberSummary(team, item, userKey, businessDate),
    ),
  );

  return {
    team: {
      id: String(team._id),
      name: String(team.name),
      goalCategory: String(team.goalCategory),
      stageTitle: String(team.stageTitle || "当前行动计划"),
      stageStartDate: String(team.stageStartDate),
      stageEndDate: String(team.stageEndDate),
      memberCount: memberships.length,
      maxMembers: Number(team.maxMembers || MAX_MEMBERS),
      todayCompletedCount: members.filter((member) => member.todayCompleted).length,
      status: String(team.status),
    },
    members,
  };
}

async function joinExistingTeam(openid, userKey, stage, team) {
  const memberId = stableId("team_member", userKey);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction
      .collection("team_members")
      .doc(memberId)
      .get()
      .catch(() => null);
    if (existing && existing.data && existing.data.status === "active") {
      return { teamId: existing.data.teamId, joined: false };
    }

    const teamResult = await transaction.collection("teams").doc(team._id).get().catch(() => null);
    const currentTeam = teamResult && teamResult.data;
    if (
      !currentTeam ||
      currentTeam.status !== "active" ||
      Number(currentTeam.memberCount || 0) >= Number(currentTeam.maxMembers || MAX_MEMBERS)
    ) {
      fail("TEAM_FULL", "这个小队刚刚满员了，请重新匹配。");
    }

    const now = db.serverDate();
    const nextCount = Number(currentTeam.memberCount || 0) + 1;
    await transaction.collection("team_members").doc(memberId).set({
      data: {
        _openid: openid,
        teamId: team._id,
        userKey,
        goalId: stage.goal._id,
        stageId: stage.plan._id,
        status: "active",
        joinOrder: nextCount,
        joinedAt: now,
        updatedAt: now,
      },
    });
    await transaction.collection("teams").doc(team._id).update({
      data: {
        memberCount: nextCount,
        updatedAt: now,
      },
    });
    return { teamId: team._id, joined: true };
  });
}

async function createTeamAndJoin(openid, userKey, stage) {
  const teamId = stableId(
    "team",
    `${stage.goal.category}:${stage.plan.startDate}:${stage.plan.endDate}:${userKey}`,
  );
  const memberId = stableId("team_member", userKey);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction
      .collection("team_members")
      .doc(memberId)
      .get()
      .catch(() => null);
    if (existing && existing.data && existing.data.status === "active") {
      return { teamId: existing.data.teamId, joined: false };
    }

    const existingTeam = await transaction.collection("teams").doc(teamId).get().catch(() => null);
    if (existingTeam && existingTeam.data) {
      const currentTeam = existingTeam.data;
      if (Number(currentTeam.memberCount || 0) >= MAX_MEMBERS) {
        fail("TEAM_FULL", "当前小队已满员。");
      }
      const now = db.serverDate();
      const nextCount = Number(currentTeam.memberCount || 0) + 1;
      await transaction.collection("team_members").doc(memberId).set({
        data: {
          _openid: openid,
          teamId,
          userKey,
          goalId: stage.goal._id,
          stageId: stage.plan._id,
          status: "active",
          joinOrder: nextCount,
          joinedAt: now,
          updatedAt: now,
        },
      });
      await transaction.collection("teams").doc(teamId).update({
        data: { memberCount: nextCount, updatedAt: now },
      });
      return { teamId, joined: true };
    }

    const teamNumber = createTeamNumber(teamId);
    const now = db.serverDate();
    await transaction.collection("teams").doc(teamId).set({
      data: {
        name: `${CATEGORY_LABELS[stage.goal.category] || "成长行动"}第 ${teamNumber} 队`,
        teamNumber,
        goalCategory: stage.goal.category,
        stageType: "current_plan",
        stageTitle: `${CATEGORY_LABELS[stage.goal.category] || "成长行动"}阶段`,
        stageStartDate: stage.plan.startDate,
        stageEndDate: stage.plan.endDate,
        memberCount: 1,
        maxMembers: MAX_MEMBERS,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    });
    await transaction.collection("team_members").doc(memberId).set({
      data: {
        _openid: openid,
        teamId,
        userKey,
        goalId: stage.goal._id,
        stageId: stage.plan._id,
        status: "active",
        joinOrder: 1,
        joinedAt: now,
        updatedAt: now,
      },
    });
    return { teamId, joined: true };
  });
}

async function joinTeam(openid) {
  const userKey = stableId("user", openid);
  const existing = await getMembershipByUserKey(userKey);
  if (existing) return { teamId: existing.teamId, joined: false };

  const stage = await getCurrentStage(openid);
  const candidates = await db
    .collection("teams")
    .where({
      goalCategory: stage.goal.category,
      stageStartDate: stage.plan.startDate,
      stageEndDate: stage.plan.endDate,
      status: "active",
      memberCount: command.lt(MAX_MEMBERS),
    })
    .limit(5)
    .get();

  for (const team of candidates.data) {
    try {
      return await joinExistingTeam(openid, userKey, stage, team);
    } catch (error) {
      if (error.code !== "TEAM_FULL") throw error;
    }
  }
  return createTeamAndJoin(openid, userKey, stage);
}

async function sendEncouragement(openid, event) {
  const memberId = String((event && event.memberId) || "");
  const type = String((event && event.type) || "");
  if (!/^member_[a-f0-9]{24}$/.test(memberId)) {
    fail("INVALID_ARGUMENT", "成员标识无效。");
  }
  if (!isValidEncouragementType(type)) {
    fail("INVALID_ARGUMENT", "鼓励类型无效。");
  }

  const senderUserKey = stableId("user", openid);
  const senderMembership = await getMembershipByUserKey(senderUserKey);
  if (!senderMembership) fail("NOT_TEAM_MEMBER", "请先加入小队。");

  const members = await getMany("team_members", {
    teamId: senderMembership.teamId,
    status: "active",
  }, MAX_MEMBERS);
  const receiver = members.find(
    (item) => publicMemberId(senderMembership.teamId, item.userKey) === memberId,
  );
  if (!receiver) fail("MEMBER_NOT_FOUND", "该成员不在当前小队。");
  if (receiver.userKey === senderUserKey) {
    fail("CANNOT_ENCOURAGE_SELF", "不能给自己发送鼓励。");
  }

  const businessDate = formatBusinessDate();
  const encouragementId = stableId(
    "encouragement",
    `${senderMembership.teamId}:${senderUserKey}:${receiver.userKey}:${businessDate}`,
  );
  return db.runTransaction(async (transaction) => {
    const existing = await transaction
      .collection("encouragements")
      .doc(encouragementId)
      .get()
      .catch(() => null);
    if (existing && existing.data) {
      fail("ENCOURAGEMENT_ALREADY_SENT", "今天已经鼓励过这位伙伴了。");
    }
    await transaction.collection("encouragements").doc(encouragementId).set({
      data: {
        teamId: senderMembership.teamId,
        senderUserKey,
        receiverUserKey: receiver.userKey,
        type,
        businessDate,
        createdAt: db.serverDate(),
      },
    });
    return { memberId, sent: true };
  });
}

module.exports = {
  ENCOURAGEMENT_TYPES,
  getMyTeam,
  joinTeam,
  publicMemberId,
  sendEncouragement,
};
