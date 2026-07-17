const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { formatBusinessDate } = require("./date");
const { stableId } = require("./repository");
const { resolveAccount } = require("./account");
const {
  ENCOURAGEMENT_TYPES,
  MAX_TEAM_MEMBERS,
  TEAM_BUILD_ID,
  TEAM_CONTRACT_VERSION,
  TEAM_SCHEMA_VERSION,
  TEAM_SUPPORTED_ACTIONS,
  compareRank,
  isValidEncouragementType,
  normalizeRoomCode,
  publicMemberId,
  resolveMemberTodayStatus,
} = require("./team-rules");

const db = cloud.database();
const command = db.command;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEAM_COLLECTIONS = ["teams", "team_members", "team_user_memberships", "team_room_codes", "team_member_daily", "team_events", "team_join_requests", "encouragements"];
let collectionsReady;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function cleanText(value, max) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, max); }
function publicDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return value.$date ? new Date(value.$date).toISOString() : "";
}
function formatShanghaiClock(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}
function normalizeAnonymityMode(value) { return value === "public" ? "public" : "anonymous"; }
function anonymousNameFor(teamId, userId) {
  const value = parseInt(crypto.createHash("sha256").update(`${teamId}:${userId}`).digest("hex").slice(0, 8), 16) % 100;
  return `同行者 ${String(value).padStart(2, "0")}`;
}
function publicIdentity(team, membership, user, currentUserId) {
  const isSelf = membership.userId === currentUserId;
  const profileAllowed = user.useProfileInTeam !== false;
  const memberMode = membership.displayMode === "anonymous"
    ? "anonymous"
    : membership.displayMode === "public" ? "public" : "nicknameOnly";
  const canShowName = isSelf || (
    normalizeAnonymityMode(team.anonymityMode) === "public"
    && profileAllowed
    && memberMode !== "anonymous"
  );
  const canShowAvatar = isSelf || (canShowName && memberMode === "public");
  return {
    isSelf,
    anonymous: !canShowName,
    name: canShowName ? cleanText(user.nickname || "行动伙伴", 20) : anonymousNameFor(team._id, membership.userId),
    avatar: canShowAvatar ? String(user.avatarUrl || "") : "",
  };
}
async function first(name, where) { const result = await db.collection(name).where(where).limit(1).get(); return result.data[0] || null; }
async function list(name, where, limit = 100, skip = 0) { const result = await db.collection(name).where(where).skip(skip).limit(limit).get(); return result.data || []; }
function isCollectionMissing(error) {
  const code = Number(error && (error.errCode || error.code));
  return code === -502005 || /collection not exist|collection not exists|集合不存在/i.test(String(error && (error.errMsg || error.message) || ""));
}
async function ensureCollection(name) {
  try { await db.collection(name).limit(1).get(); return; } catch (error) { if (!isCollectionMissing(error)) throw error; }
  try { await db.createCollection(name); } catch (_) { await db.collection(name).limit(1).get(); }
}
async function ensureTeamCollections() {
  if (!collectionsReady) collectionsReady = Promise.all(TEAM_COLLECTIONS.map(ensureCollection)).catch((error) => { collectionsReady = undefined; throw error; });
  return collectionsReady;
}
async function getUser(openid) {
  await ensureTeamCollections();
  return resolveAccount(openid, true);
}
function membershipLockId(userId) { return stableId("team_user_membership", userId); }
function roomLockId(roomCode) { return stableId("team_room_code", roomCode); }
function dailyDocId(teamId, userId, businessDate) { return stableId("team_member_daily", `${teamId}:${userId}:${businessDate}`); }
function detectMembershipSchema(record) { return record && record.userId ? 2 : record && record.userKey ? 1 : 0; }
async function membershipFor(userId, openid) {
  const lock = await db.collection("team_user_memberships").doc(membershipLockId(userId)).get().catch(() => null);
  if (lock && lock.data && lock.data.status === "active") {
    const member = await db.collection("team_members").doc(lock.data.memberId).get().catch(() => null);
    if (member && member.data && member.data.status === "active") return member.data;
  }
  const current = await first("team_members", { userId, status: "active" });
  if (current) return current;
  return openid ? first("team_members", { userKey: stableId("user", openid), status: "active" }) : null;
}
async function requireMembership(openid) {
  const account = await getUser(openid);
  const membership = await membershipFor(account.userId, openid);
  if (!membership) fail("NOT_TEAM_MEMBER", "请先创建或加入小队");
  if (detectMembershipSchema(membership) === 1) fail("TEAM_MIGRATION_REQUIRED", "旧版小队数据需要先完成迁移");
  const teamResult = await db.collection("teams").doc(membership.teamId).get().catch(() => null);
  const team = teamResult && teamResult.data;
  if (!team || team.status !== "active") fail("TEAM_NOT_FOUND", "当前小队不存在或已解散");
  return { ...account, membership, team };
}
function assertOwner(context) { if (context.membership.role !== "owner") fail("TEAM_PERMISSION_DENIED", "只有队长可以执行此操作"); }
function randomRoomCode() { let code = ""; for (let i = 0; i < 6; i += 1) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]; return code; }
async function uniqueRoomCode() {
  for (let index = 0; index < 12; index += 1) {
    const code = randomRoomCode();
    if (!await first("teams", { roomCode: code, status: "active" })) return code;
  }
  fail("ROOM_CODE_UNAVAILABLE", "房间号生成失败，请稍后重试");
}
function memberDocId(teamId, userId) { return stableId("team_member", `${teamId}:${userId}`); }
async function recordEvent(teamId, userId, type, data = {}) {
  const createdAtMs = Date.now();
  const id = stableId("team_event", `${teamId}:${userId}:${type}:${data.businessDate || createdAtMs}:${data.dedupeKey || ""}`);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("team_events").doc(id);
    const existing = await ref.get().catch(() => null);
    if (existing && existing.data) return;
    await ref.set({ data: { teamId, userId, type, ...data, createdAtMs, createdAt: db.serverDate(), schemaVersion: TEAM_SCHEMA_VERSION } });
  });
  return id;
}

function getTeamRuntimeInfo() {
  return {
    contractVersion: TEAM_CONTRACT_VERSION,
    schemaVersion: TEAM_SCHEMA_VERSION,
    buildId: TEAM_BUILD_ID,
    supportedActions: TEAM_SUPPORTED_ACTIONS.slice(),
    maxMembers: MAX_TEAM_MEMBERS,
    teamSettings: { anonymityModes: ["anonymous", "public"], defaultAnonymityMode: "anonymous", allowMemberInviteDefault: true, editableFields: ["name", "announcement", "anonymityMode", "allowMemberInvite"] },
  };
}

async function getMemberProgress(teamId, membership, currentUserId, businessDate, persistDaily = false, teamPolicy = {}) {
  const [userResult, goals, tasks, encouragementCount] = await Promise.all([
    db.collection("users").doc(membership.userId).get().catch(() => null),
    list("manual_goals", { userId: membership.userId, status: "active" }, 5),
    list("manual_tasks", { userId: membership.userId, currentDate: businessDate }, 100),
    db.collection("encouragements").where({ teamId, receiverUserId: membership.userId, businessDate }).count(),
  ]);
  const visibleTasks = tasks.filter((task) => !task.deletedAt && task.status !== "rescheduled");
  const completed = visibleTasks.filter((task) => task.status === "completed");
  const partial = visibleTasks.filter((task) => task.status === "partially_completed");
  const eligible = visibleTasks.filter((task) => task.status !== "skipped");
  const skipped = visibleTasks.filter((task) => task.status === "skipped");
  const growthMinutes = [...completed, ...partial].reduce((sum, task) => sum + Math.max(0, Number(task.actualMinutes || 0)), 0);
  const completionRate = eligible.length ? Math.round(((completed.length + partial.length * 0.5) / eligible.length) * 100) : 0;
  const completedAt = completed.length && completed.length === eligible.length
    ? completed.map((task) => String(task.completedAt || task.updatedAt || "")).sort().pop() || ""
    : "";
  const lastEffectiveActionAt = [...completed, ...partial]
    .map((task) => String(task.completedAt || task.updatedAt || ""))
    .filter(Boolean)
    // 同分时比较“达到当前投入值”的时刻，因此应取最后一次有效行动，
    // 而不是当天最早一次行动。
    .sort()
    .pop() || "";
  const user = userResult && userResult.data || {};
  const identity = publicIdentity({ _id: teamId, anonymityMode: teamPolicy.anonymityMode }, membership, user, currentUserId);
  const isSelf = identity.isSelf;
  const displayMode = identity.anonymous ? "anonymous" : "public";
  const anonymous = identity.anonymous;
  const detailsVisible = isSelf || (!anonymous && membership.taskDetailVisible !== false);
  const status = resolveMemberTodayStatus({
    visibleCount: visibleTasks.length,
    skippedCount: skipped.length,
    completionRate,
    growthMinutes,
  });
  const encouragementId = stableId("encouragement", `${teamId}:${currentUserId}:${membership.userId}:${businessDate}`);
  const encouraged = await db.collection("encouragements").doc(encouragementId).get().catch(() => null);
  const publicId = publicMemberId(teamId, membership.userId);
  const daily = {
    teamId, userId: membership.userId, businessDate, monthPartition: businessDate.slice(0, 7),
    status, plannedCount: eligible.length, completedCount: completed.length, partialCount: partial.length,
    actualMinutes: growthMinutes, growthMinutes, completionRate, completedAt, lastEffectiveActionAt,
    sourceVersion: visibleTasks.map((task) => `${task.id}:${task.updatedAt || ""}:${task.status}:${task.actualMinutes || 0}`).sort().join("|"),
    sourceUpdatedAt: visibleTasks.map((task) => String(task.updatedAt || "")).sort().pop() || "",
    schemaVersion: TEAM_SCHEMA_VERSION, updatedAt: db.serverDate(),
  };
  if (persistDaily) await db.collection("team_member_daily").doc(dailyDocId(teamId, membership.userId, businessDate)).set({ data: daily });
  return {
    id: publicId, userId: publicId, teamId, role: membership.role || "member", displayMode,
    nickname: identity.name,
    anonymousName: anonymousNameFor(teamId, membership.userId), avatar: identity.avatar,
    goalTitle: anonymous ? "正在稳步行动" : cleanText(goals[0] && goals[0].title || "正在建立目标", 30),
    todayActionTitle: detailsVisible ? cleanText((visibleTasks.find((task) => task.status !== "completed") || visibleTasks[0] || {}).title, 40) : "今日行动不公开",
    todayActionDetails: detailsVisible ? visibleTasks.slice(0, 20).map((task) => ({
      id: String(task.id), title: cleanText(task.title, 50), status: task.status === "completed" ? "completed" : task.status === "partially_completed" ? "partial" : task.status === "skipped" ? "missed" : "not_started",
      estimatedMinutes: Number(task.estimatedMinutes || 0), growthMinutes: Number(task.actualMinutes || 0), actualMinutes: Number(task.actualMinutes || 0),
    })) : [],
    taskDetailVisible: detailsVisible, todayStatus: status, estimatedMinutes: visibleTasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0),
    growthMinutes, completionRate, completedAt, lastEffectiveActionAt, encouragementCount: Number(encouragementCount.total || 0), encouragedByMeToday: Boolean(encouraged && encouraged.data),
    isSelf, joinedAt: publicDate(membership.joinedAt), updatedAt: publicDate(membership.updatedAt || membership.joinedAt),
  };
}

async function buildTeamPage(openid, event = {}) {
  const account = await getUser(openid);
  const membership = await membershipFor(account.userId, openid);
  if (!membership) {
    return { team: null, members: [], selfMember: null, dailyStats: null, page: 1, pageSize: Math.min(MAX_TEAM_MEMBERS, Math.max(1, Number(event.pageSize || MAX_TEAM_MEMBERS))), total: 0, hasMore: false };
  }
  if (detectMembershipSchema(membership) === 1) fail("TEAM_MIGRATION_REQUIRED", "旧版小队数据需要先完成迁移");
  const teamResult = await db.collection("teams").doc(membership.teamId).get().catch(() => null);
  const team = teamResult && teamResult.data;
  if (!team || team.status !== "active") return { team: null, members: [], selfMember: null, dailyStats: null, page: 1, pageSize: MAX_TEAM_MEMBERS, total: 0, hasMore: false };
  const context = { ...account, membership, team };
  const allMemberships = await list("team_members", { teamId: context.team._id, status: "active" }, MAX_TEAM_MEMBERS);
  const businessDate = formatBusinessDate();
  const members = await Promise.all(allMemberships.map((item) => getMemberProgress(context.team._id, item, context.userId, businessDate, true, context.team)));
  const canSeeSharedDetails = context.team.actionDetailVisibility === "all_members"
    || (context.team.actionDetailVisibility === "admins_only" && context.membership.role === "owner");
  for (const member of members) {
    if (!member.isSelf && !canSeeSharedDetails) {
      member.todayActionDetails = [];
      member.todayActionTitle = "今日行动不公开";
      member.taskDetailVisible = false;
    }
  }
  members.sort(compareRank);
  members.forEach((member, index) => { member.rank = index + 1; });
  const page = Math.max(1, Math.floor(Number(event.page || 1)));
  const pageSize = Math.min(MAX_TEAM_MEMBERS, Math.max(1, Math.floor(Number(event.pageSize || MAX_TEAM_MEMBERS))));
  const start = (page - 1) * pageSize;
  const totalGrowthMinutes = members.reduce((sum, member) => sum + member.growthMinutes, 0);
  const completedMembers = members.filter((member) => member.todayStatus === "completed").length;
  const partialMembers = members.filter((member) => member.todayStatus === "partial").length;
  return {
    team: {
      id: context.team._id, name: context.team.name, avatar: "", roomCode: context.team.roomCode,
      ownerId: publicMemberId(context.team._id, context.team.ownerUserId), announcement: context.team.announcement || "一起行动，各自成长",
      joinMode: context.team.joinMode || "direct", version: Number(context.team.version || 1), visibility: context.team.visibility || "private",
      anonymityMode: normalizeAnonymityMode(context.team.anonymityMode), allowMemberInvite: context.team.allowMemberInvite !== false,
      canInvite: context.membership.role === "owner" || context.team.allowMemberInvite !== false,
      allowAnonymous: context.team.allowAnonymous !== false, actionDetailVisibility: context.team.actionDetailVisibility || "all_members",
      maxMembers: MAX_TEAM_MEMBERS, memberCount: allMemberships.length, createdAt: publicDate(context.team.createdAt),
      phaseStartDate: context.team.phaseStartDate || businessDate, phaseEndDate: context.team.phaseEndDate || "",
      description: context.team.announcement || "", status: "active", updatedAt: publicDate(context.team.updatedAt), schemaVersion: Number(context.team.schemaVersion || TEAM_SCHEMA_VERSION),
    },
    members: members.slice(start, start + pageSize),
    selfMember: members.find((member) => member.isSelf) || null,
    dailyStats: {
      teamId: context.team._id, date: businessDate, totalMembers: members.length, completedMembers, partialMembers,
      notStartedMembers: members.filter((member) => member.todayStatus === "not_started").length,
      missedMembers: members.filter((member) => member.todayStatus === "missed").length,
      totalGrowthMinutes, encouragementCount: members.reduce((sum, member) => sum + member.encouragementCount, 0),
      completionRate: members.length ? Math.round(members.reduce((sum, member) => sum + member.completionRate, 0) / members.length) : 0,
    },
    page, pageSize, total: members.length, hasMore: start + pageSize < members.length,
  };
}

async function createTeam(openid, event) {
  const { userId } = await getUser(openid);
  const existing = await membershipFor(userId, openid);
  if (existing) fail(detectMembershipSchema(existing) === 1 ? "TEAM_MIGRATION_REQUIRED" : "ALREADY_IN_TEAM", detectMembershipSchema(existing) === 1 ? "旧版小队数据需要先完成迁移" : "你已经加入了一个小队");
  const input = event && event.input || {};
  const name = cleanText(input.name || "进步小队", 20);
  if (name.length < 2) fail("INVALID_TEAM_NAME", "小队名称至少 2 个字符");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const roomCode = randomRoomCode();
    const teamId = stableId("team", `${userId}:${Date.now()}:${roomCode}`);
    const memberId = memberDocId(teamId, userId);
    try {
      await db.runTransaction(async (transaction) => {
        const userLockRef = transaction.collection("team_user_memberships").doc(membershipLockId(userId));
        const userLock = await userLockRef.get().catch(() => null);
        if (userLock && userLock.data && ["active", "pending"].includes(userLock.data.status)) fail("ALREADY_IN_TEAM", "你已经加入或申请了一个小队");
        const roomRef = transaction.collection("team_room_codes").doc(roomLockId(roomCode));
        const roomLock = await roomRef.get().catch(() => null);
        if (roomLock && roomLock.data && roomLock.data.status === "active") fail("ROOM_CODE_CONFLICT", "房间号冲突");
        const now = db.serverDate();
        await transaction.collection("teams").doc(teamId).set({ data: {
          schemaVersion: TEAM_SCHEMA_VERSION, name, avatar: "", roomCode, ownerUserId: userId, announcement: "一起行动，各自成长", joinMode: "direct", visibility: "private",
          allowAnonymous: true, actionDetailVisibility: "all_members", anonymityMode: "anonymous", allowMemberInvite: true, memberCount: 1, maxMembers: MAX_TEAM_MEMBERS,
          version: 1, status: "active", phaseStartDate: formatBusinessDate(), phaseEndDate: "", createdAt: now, updatedAt: now,
        } });
        await transaction.collection("team_members").doc(memberId).set({ data: {
          schemaVersion: TEAM_SCHEMA_VERSION, teamId, userId, role: "owner", displayMode: "nicknameOnly", taskDetailVisible: false, status: "active", joinedAt: now, updatedAt: now,
        } });
        await userLockRef.set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, userId, teamId, memberId, status: "active", updatedAt: now } });
        await roomRef.set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, roomCode, teamId, status: "active", updatedAt: now } });
      });
      await recordEvent(teamId, userId, "joined", { businessDate: formatBusinessDate(), dedupeKey: "owner" });
      return { teamId, joined: true };
    } catch (error) {
      if (error && error.code === "ROOM_CODE_CONFLICT") continue;
      throw error;
    }
  }
  fail("ROOM_CODE_UNAVAILABLE", "房间号生成失败，请稍后重试");
}

async function joinTeamByRoomCode(openid, event) {
  const roomCode = normalizeRoomCode(event && event.roomCode);
  if (!roomCode) fail("INVALID_ROOM_CODE", "房间号格式无效");
  const { userId } = await getUser(openid);
  const existingMembership = await membershipFor(userId, openid);
  if (existingMembership) fail(detectMembershipSchema(existingMembership) === 1 ? "TEAM_MIGRATION_REQUIRED" : "ALREADY_IN_TEAM", detectMembershipSchema(existingMembership) === 1 ? "旧版小队数据需要先完成迁移" : "你已经加入了一个小队");
  const roomLockResult = await db.collection("team_room_codes").doc(roomLockId(roomCode)).get().catch(() => null);
  const roomLock = roomLockResult && roomLockResult.data;
  let team = null;
  if (roomLock && roomLock.status === "active") {
    const teamResult = await db.collection("teams").doc(roomLock.teamId).get().catch(() => null);
    team = teamResult && teamResult.data;
  }
  if (!team) {
    const legacyRoomTeam = await first("teams", { roomCode, status: "active" });
    if (legacyRoomTeam) fail("TEAM_MIGRATION_REQUIRED", "该房间需要先完成数据迁移");
    fail("ROOM_NOT_FOUND", "没有找到这个房间，请确认房间号");
  }
  const inviterMemberId = cleanText(event && event.inviterMemberId, 80);
  if (inviterMemberId) {
    const activeMembers = await list("team_members", { teamId: team._id, status: "active" }, MAX_TEAM_MEMBERS);
    const inviter = activeMembers.find((item) => publicMemberId(team._id, item.userId) === inviterMemberId);
    if (!inviter) fail("TEAM_INVITE_FORBIDDEN", "邀请信息无效，请向队长重新获取邀请");
    if (inviter.role !== "owner" && team.allowMemberInvite === false) {
      fail("TEAM_INVITE_FORBIDDEN", "队长已关闭成员邀请");
    }
  }
  if (team.joinMode === "approval") {
    const requestId = stableId("team_join_request", `${team._id}:${userId}`);
    await db.runTransaction(async (transaction) => {
      const lockRef = transaction.collection("team_user_memberships").doc(membershipLockId(userId));
      const lock = await lockRef.get().catch(() => null);
      if (lock && lock.data && ["active", "pending"].includes(lock.data.status)) fail("ALREADY_IN_TEAM", "你已经加入或申请了一个小队");
      const now = db.serverDate();
      await transaction.collection("team_join_requests").doc(requestId).set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, teamId: team._id, userId, status: "pending", createdAt: now, updatedAt: now } });
      await lockRef.set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, userId, teamId: team._id, requestId, status: "pending", updatedAt: now } });
    });
    return { teamId: team._id, pending: true };
  }
  await addMember(team._id, userId);
  return { teamId: team._id, joined: true };
}

async function getTeamInviteInfo(openid) {
  const context = await requireMembership(openid);
  const canInvite = context.membership.role === "owner" || context.team.allowMemberInvite !== false;
  if (!canInvite) fail("TEAM_INVITE_FORBIDDEN", "队长已关闭成员邀请");
  return {
    teamId: context.team._id,
    roomCode: context.team.roomCode,
    inviterMemberId: publicMemberId(context.team._id, context.userId),
    canInvite: true,
  };
}

async function addMember(teamId, userId) {
  let joined = true;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection("teams").doc(teamId).get();
    const team = result.data;
    if (!team || team.status !== "active") fail("TEAM_NOT_FOUND", "小队不存在");
    const lockRef = transaction.collection("team_user_memberships").doc(membershipLockId(userId));
    const lock = await lockRef.get().catch(() => null);
    if (lock && lock.data && lock.data.status === "active") {
      if (lock.data.teamId === teamId) { joined = false; return; }
      fail("MEMBERSHIP_CONFLICT", "你已经加入了其他小队");
    }
    if (lock && lock.data && lock.data.status === "pending" && lock.data.teamId !== teamId) {
      fail("MEMBERSHIP_CONFLICT", "你已经申请了其他小队");
    }
    if (Number(team.memberCount || 0) >= MAX_TEAM_MEMBERS) fail("TEAM_FULL", `小队已满 ${MAX_TEAM_MEMBERS} 人`);
    const memberRef = transaction.collection("team_members").doc(memberDocId(teamId, userId));
    const existing = await memberRef.get().catch(() => null);
    if (existing && existing.data && existing.data.status === "active") { joined = false; return; }
    const now = db.serverDate();
    await memberRef.set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, teamId, userId, role: "member", displayMode: "nicknameOnly", taskDetailVisible: false, status: "active", joinedAt: now, updatedAt: now } });
    await lockRef.set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, userId, teamId, memberId: memberDocId(teamId, userId), status: "active", updatedAt: now } });
    await transaction.collection("teams").doc(teamId).update({ data: { memberCount: command.inc(1), version: command.inc(1), updatedAt: now } });
  });
  if (joined) await recordEvent(teamId, userId, "joined", { businessDate: formatBusinessDate() });
  return { joined };
}

async function updateTeamSettings(openid, event) {
  const context = await requireMembership(openid); assertOwner(context);
  const input = event && event.input || {};
  const changes = { version: command.inc(1), updatedAt: db.serverDate() };
  if (Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = cleanText(input.name, 20);
    if (name.length < 2) fail("INVALID_TEAM_NAME", "小队名称至少 2 个字符");
    changes.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(input, "anonymityMode")) {
    if (!["anonymous", "public"].includes(input.anonymityMode)) fail("INVALID_ANONYMITY_MODE", "匿名模式无效");
    changes.anonymityMode = input.anonymityMode;
  }
  if (Object.prototype.hasOwnProperty.call(input, "announcement") || Object.prototype.hasOwnProperty.call(input, "slogan")) {
    const announcement = cleanText(
      Object.prototype.hasOwnProperty.call(input, "announcement") ? input.announcement : input.slogan,
      30,
    );
    changes.announcement = announcement;
  }
  if (typeof input.allowMemberInvite === "boolean") changes.allowMemberInvite = input.allowMemberInvite;
  await db.collection("teams").doc(context.team._id).update({ data: changes });
  return { updated: true };
}

async function updateTeamMemberPrivacy(openid, event) {
  const context = await requireMembership(openid); const changes = { updatedAt: db.serverDate() };
  if (["public", "nicknameOnly", "anonymous"].includes(event.displayMode)) {
    if (event.displayMode === "anonymous" && context.team.allowAnonymous === false) fail("ANONYMOUS_NOT_ALLOWED", "当前小队未开放匿名参与");
    changes.displayMode = event.displayMode;
    if (event.displayMode !== "public") changes.taskDetailVisible = false;
  }
  if (typeof event.taskDetailVisible === "boolean") {
    const effectiveMode = changes.displayMode || context.membership.displayMode || "nicknameOnly";
    changes.taskDetailVisible = effectiveMode === "public" ? event.taskDetailVisible : false;
  }
  await db.collection("team_members").doc(context.membership._id).update({ data: changes }); return { updated: true };
}

async function syncTeamActivity(openid) {
  const context = await requireMembership(openid); const businessDate = formatBusinessDate();
  const summary = await getMemberProgress(context.team._id, context.membership, context.userId, businessDate, true, context.team);
  const type = summary.todayStatus === "completed" ? "completed" : summary.todayStatus === "partial" ? "partial" : null;
  if (type) await recordEvent(context.team._id, context.userId, type, { businessDate, growthMinutes: summary.growthMinutes, actionCount: summary.todayActionDetails.filter((item) => item.status === "completed").length, dedupeKey: type });
  return { updated: true };
}

async function sendEncouragement(openid, event) {
  const context = await requireMembership(openid); const memberId = String(event && event.memberId || ""); const type = String(event && event.type || "");
  if (!isValidEncouragementType(type)) fail("INVALID_ARGUMENT", "鼓励类型无效");
  const memberships = await list("team_members", { teamId: context.team._id, status: "active" }, MAX_TEAM_MEMBERS);
  const receiver = memberships.find((item) => publicMemberId(context.team._id, item.userId) === memberId);
  if (!receiver) fail("MEMBER_NOT_FOUND", "该成员不在当前小队");
  if (receiver.userId === context.userId) fail("CANNOT_ENCOURAGE_SELF", "不能给自己发送鼓励");
  const businessDate = formatBusinessDate(); const id = stableId("encouragement", `${context.team._id}:${context.userId}:${receiver.userId}:${businessDate}`);
  const exists = await db.collection("encouragements").doc(id).get().catch(() => null);
  if (exists && exists.data) fail("ENCOURAGEMENT_ALREADY_SENT", "今天已经鼓励过这位伙伴了");
  await db.collection("encouragements").doc(id).set({ data: { teamId: context.team._id, senderUserId: context.userId, receiverUserId: receiver.userId, type, businessDate, createdAt: db.serverDate() } });
  await recordEvent(context.team._id, receiver.userId, "encouraged", { businessDate, dedupeKey: context.userId });
  return { memberId, sent: true };
}

async function getTeamActivityFeed(openid, event) {
  const account = await getUser(openid); const membership = await membershipFor(account.userId, openid);
  const page = Math.max(1, Number(event.page || 1)); const pageSize = Math.min(30, Math.max(1, Number(event.pageSize || 10)));
  if (!membership) return { list: [], hasMore: false, total: 0, page, pageSize: 0 };
  if (detectMembershipSchema(membership) === 1) fail("TEAM_MIGRATION_REQUIRED", "旧版小队数据需要先完成迁移");
  const context = await requireMembership(openid);
  const totalResult = await db.collection("team_events").where({ teamId: context.team._id }).count();
  const events = await db.collection("team_events").where({ teamId: context.team._id }).orderBy("createdAtMs", "desc").skip((page - 1) * pageSize).limit(pageSize).get();
  const memberships = await Promise.all(events.data.map((item) => first("team_members", { teamId: context.team._id, userId: item.userId })));
  const users = await Promise.all(events.data.map((item) => db.collection("users").doc(item.userId).get().catch(() => null)));
  const listData = events.data.map((item, index) => {
    const membership = memberships[index] || {}; const user = users[index] && users[index].data || {};
    const identity = publicIdentity(context.team, { ...membership, userId: item.userId }, user, context.userId);
    const name = identity.name;
    const labels = { completed: "完成了今日行动", partial: "推进了今日行动", joined: "加入了小队", encouraged: "收到了队友鼓励", streak: "达成连续行动里程碑" };
    const timestamp = Number(item.createdAtMs || 0); const date = new Date(timestamp); const today = formatBusinessDate(); const dateKey = formatBusinessDate(date);
    return { id: item._id, memberId: publicMemberId(context.team._id, item.userId), name, avatar: identity.avatar, avatarText: name.slice(0, 1), type: item.type,
      actionText: labels[item.type] || "更新了行动", detail: item.type === "completed" || item.type === "partial" ? `今日已投入 ${Number(item.growthMinutes || 0)} 分钟` : labels[item.type] || "更新了行动",
      goalTitle: "", growthMinutes: Number(item.growthMinutes || 0), actionCount: Number(item.actionCount || 0), timestamp,
      dateLabel: dateKey === today ? "今天" : dateKey, timeText: dateKey === today ? `今天 ${formatShanghaiClock(timestamp)}` : dateKey,
    };
  });
  return { list: listData, hasMore: page * pageSize < Number(totalResult.total || 0), total: Number(totalResult.total || 0), page, pageSize };
}

async function removeMemberRecord(teamId, userId) {
  let changed = false;
  await db.runTransaction(async (transaction) => {
    const teamResult = await transaction.collection("teams").doc(teamId).get();
    const memberRef = transaction.collection("team_members").doc(memberDocId(teamId, userId));
    const member = await memberRef.get().catch(() => null);
    const lockRef = transaction.collection("team_user_memberships").doc(membershipLockId(userId));
    if (!member || !member.data || member.data.status !== "active") {
      const lock = await lockRef.get().catch(() => null);
      if (lock && lock.data && lock.data.teamId === teamId && lock.data.status !== "left") await lockRef.update({ data: { status: "left", updatedAt: db.serverDate() } });
      return;
    }
    changed = true;
    const now = db.serverDate();
    await memberRef.update({ data: { status: "left", leftAt: now, updatedAt: now } });
    await lockRef.set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, userId, teamId, memberId: memberDocId(teamId, userId), status: "left", updatedAt: now } });
    await transaction.collection("teams").doc(teamId).update({ data: { memberCount: Math.max(0, Number(teamResult.data.memberCount || 1) - 1), version: command.inc(1), updatedAt: db.serverDate() } });
  });
  return changed;
}
async function leaveTeam(openid) {
  const account = await getUser(openid); const membership = await membershipFor(account.userId, openid);
  if (!membership) return { left: true, idempotent: true };
  if (detectMembershipSchema(membership) === 1) fail("TEAM_MIGRATION_REQUIRED", "旧版小队数据需要先完成迁移");
  if (membership.role === "owner") fail("OWNER_TRANSFER_REQUIRED", "队长退出前需要先转让小队或解散小队");
  const changed = await removeMemberRecord(membership.teamId, account.userId); return { teamId: membership.teamId, left: true, idempotent: !changed };
}
async function removeTeamMember(openid, event) {
  const context = await requireMembership(openid); assertOwner(context); const target = await resolvePublicMember(context.team._id, event.memberId, true);
  if (!target) return { teamId: context.team._id, removed: true, idempotent: true };
  if (target.role === "owner") fail("INVALID_TARGET", "无法移除该成员");
  const changed = await removeMemberRecord(context.team._id, target.userId); return { teamId: context.team._id, removed: true, idempotent: !changed };
}
async function resolvePublicMember(teamId, memberId, includeLeft = false) { const members = await list("team_members", includeLeft ? { teamId } : { teamId, status: "active" }, includeLeft ? 200 : MAX_TEAM_MEMBERS); return members.find((item) => item.userId && publicMemberId(teamId, item.userId) === String(memberId || "")); }
async function transferTeamOwner(openid, event) {
  const context = await requireMembership(openid); assertOwner(context); const target = await resolvePublicMember(context.team._id, event.memberId); if (!target || target.userId === context.userId) fail("INVALID_TARGET", "请选择其他成员");
  await db.runTransaction(async (transaction) => { await transaction.collection("team_members").doc(context.membership._id).update({ data: { role: "member", updatedAt: db.serverDate() } }); await transaction.collection("team_members").doc(target._id).update({ data: { role: "owner", updatedAt: db.serverDate() } }); await transaction.collection("teams").doc(context.team._id).update({ data: { ownerUserId: target.userId, version: command.inc(1), updatedAt: db.serverDate() } }); });
  return { teamId: context.team._id };
}
async function dissolveTeam(openid) { const context = await requireMembership(openid); assertOwner(context); const members = await list("team_members", { teamId: context.team._id, status: "active" }, MAX_TEAM_MEMBERS); await db.runTransaction(async (transaction) => { const now = db.serverDate(); for (const member of members) { await transaction.collection("team_members").doc(member._id).update({ data: { status: "left", leftAt: now, updatedAt: now } }); await transaction.collection("team_user_memberships").doc(membershipLockId(member.userId)).set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, userId: member.userId, teamId: context.team._id, memberId: member._id, status: "left", updatedAt: now } }); } await transaction.collection("teams").doc(context.team._id).update({ data: { status: "closed", memberCount: 0, version: command.inc(1), closedAt: now, updatedAt: now } }); await transaction.collection("team_room_codes").doc(roomLockId(context.team.roomCode)).set({ data: { schemaVersion: TEAM_SCHEMA_VERSION, roomCode: context.team.roomCode, teamId: context.team._id, status: "closed", updatedAt: now } }); }); return { teamId: context.team._id, dissolved: true }; }
async function reviewTeamJoinRequest(openid, event) {
  const context = await requireMembership(openid); assertOwner(context); const requestId = String(event.requestId || "");
  const result = await db.collection("team_join_requests").doc(requestId).get().catch(() => null); const request = result && result.data;
  if (!request || request.teamId !== context.team._id || request.status !== "pending") fail("REQUEST_NOT_FOUND", "申请不存在或已处理");
  if (event.approved) await addMember(context.team._id, request.userId);
  await db.runTransaction(async (transaction) => {
    const now = db.serverDate();
    await transaction.collection("team_join_requests").doc(requestId).update({ data: { status: event.approved ? "approved" : "rejected", reviewedAt: now, updatedAt: now } });
    if (!event.approved) {
      const lockRef = transaction.collection("team_user_memberships").doc(membershipLockId(request.userId));
      const lock = await lockRef.get().catch(() => null);
      if (lock && lock.data && lock.data.requestId === requestId && lock.data.status === "pending") await lockRef.update({ data: { status: "left", updatedAt: now } });
    }
  });
  return { teamId: context.team._id, joined: Boolean(event.approved) };
}

async function recordManualCompletionEvent(userId, eventId, completedTasks) {
  const membership = await membershipFor(userId, "");
  if (!membership || detectMembershipSchema(membership) !== 2 || !Array.isArray(completedTasks) || !completedTasks.length) {
    return { recorded: false };
  }
  const firstTask = completedTasks[0];
  const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(String(firstTask.currentDate || ""))
    ? firstTask.currentDate
    : formatBusinessDate();
  await recordEvent(membership.teamId, userId, "completed", {
    businessDate,
    growthMinutes: completedTasks.reduce((sum, task) => sum + Math.max(0, Number(task.actualMinutes || 0)), 0),
    actionCount: completedTasks.length,
    dedupeKey: eventId,
  });
  return { recorded: true, teamId: membership.teamId };
}

module.exports = { ENCOURAGEMENT_TYPES, createTeam, detectMembershipSchema, dissolveTeam, getMyTeam: buildTeamPage, getTeamPage: buildTeamPage, getTeamActivityFeed, getTeamInviteInfo, getTeamRuntimeInfo, joinTeam: joinTeamByRoomCode, joinTeamByRoomCode, leaveTeam, publicMemberId, recordManualCompletionEvent, removeTeamMember, reviewTeamJoinRequest, sendEncouragement, syncTeamActivity, transferTeamOwner, updateTeamMemberPrivacy, updateTeamSettings };
