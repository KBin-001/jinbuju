const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { formatBusinessDate } = require("./date");
const { stableId } = require("./repository");
const { resolveAccount } = require("./account");
const {
  ENCOURAGEMENT_TYPES,
  MAX_TEAM_MEMBERS,
  compareRank,
  isValidEncouragementType,
  normalizeRoomCode,
  publicMemberId,
} = require("./team-rules");

const db = cloud.database();
const command = db.command;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEAM_COLLECTIONS = ["teams", "team_members", "team_events", "team_join_requests", "encouragements"];
let collectionsReady;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function cleanText(value, max) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, max); }
function publicDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return value.$date ? new Date(value.$date).toISOString() : "";
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
async function membershipFor(userId) { return first("team_members", { userId, status: "active" }); }
async function requireMembership(openid) {
  const account = await getUser(openid);
  const membership = await membershipFor(account.userId);
  if (!membership) fail("NOT_TEAM_MEMBER", "请先创建或加入小队");
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
  await db.collection("team_events").doc(id).set({ data: { teamId, userId, type, ...data, createdAtMs, createdAt: db.serverDate() } });
}

async function getMemberProgress(teamId, membership, currentUserId, businessDate) {
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
  const growthMinutes = [...completed, ...partial].reduce((sum, task) => sum + Math.max(0, Number(task.actualMinutes || 0)), 0);
  const completionRate = eligible.length ? Math.round(((completed.length + partial.length * 0.5) / eligible.length) * 100) : 0;
  const completedAt = completed.length && completed.length + partial.length === eligible.length
    ? completed.map((task) => String(task.completedAt || task.updatedAt || "")).sort().pop() || ""
    : "";
  const user = userResult && userResult.data || {};
  const isSelf = membership.userId === currentUserId;
  const displayMode = membership.displayMode || "nicknameOnly";
  const anonymous = displayMode === "anonymous" && !isSelf;
  const detailsVisible = !anonymous && membership.taskDetailVisible !== false;
  const status = !eligible.length ? "not_started" : completionRate >= 100 ? "completed" : completionRate > 0 || growthMinutes > 0 ? "partial" : "not_started";
  const encouragementId = stableId("encouragement", `${teamId}:${currentUserId}:${membership.userId}:${businessDate}`);
  const encouraged = await db.collection("encouragements").doc(encouragementId).get().catch(() => null);
  const publicId = publicMemberId(teamId, membership.userId);
  return {
    id: publicId, userId: publicId, teamId, role: membership.role || "member", displayMode,
    nickname: anonymous ? (membership.anonymousName || "行动伙伴") : cleanText(user.nickname || "行动伙伴", 20),
    anonymousName: membership.anonymousName || "行动伙伴", avatar: anonymous ? "" : String(user.avatarUrl || ""),
    goalTitle: anonymous ? "正在稳步行动" : cleanText(goals[0] && goals[0].title || "正在建立目标", 30),
    todayActionTitle: detailsVisible ? cleanText((visibleTasks.find((task) => task.status !== "completed") || visibleTasks[0] || {}).title, 40) : "今日行动不公开",
    todayActionDetails: detailsVisible ? visibleTasks.slice(0, 20).map((task) => ({
      id: String(task.id), title: cleanText(task.title, 50), status: task.status === "completed" ? "completed" : task.status === "partially_completed" ? "partial" : task.status === "skipped" ? "missed" : "not_started",
      estimatedMinutes: Number(task.estimatedMinutes || 0), growthMinutes: Number(task.actualMinutes || 0), actualMinutes: Number(task.actualMinutes || 0),
    })) : [],
    taskDetailVisible: detailsVisible, todayStatus: status, estimatedMinutes: visibleTasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0),
    growthMinutes, completionRate, completedAt, encouragementCount: Number(encouragementCount.total || 0), encouragedByMeToday: Boolean(encouraged && encouraged.data),
    isSelf, updatedAt: publicDate(membership.updatedAt || membership.joinedAt),
  };
}

async function buildTeamPage(openid, event = {}) {
  const account = await getUser(openid);
  const membership = await membershipFor(account.userId);
  if (!membership) {
    return { team: null, members: [], dailyStats: null, page: 1, pageSize: Math.min(50, Math.max(1, Number(event.pageSize || 20))), total: 0, hasMore: false };
  }
  const teamResult = await db.collection("teams").doc(membership.teamId).get().catch(() => null);
  const team = teamResult && teamResult.data;
  if (!team || team.status !== "active") return { team: null, members: [], dailyStats: null, page: 1, pageSize: 20, total: 0, hasMore: false };
  const context = { ...account, membership, team };
  const allMemberships = await list("team_members", { teamId: context.team._id, status: "active" }, MAX_TEAM_MEMBERS);
  const businessDate = formatBusinessDate();
  const members = await Promise.all(allMemberships.map((item) => getMemberProgress(context.team._id, item, context.userId, businessDate)));
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
  const page = Math.max(1, Math.floor(Number(event.page || 1)));
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize || 20))));
  const start = (page - 1) * pageSize;
  const totalGrowthMinutes = members.reduce((sum, member) => sum + member.growthMinutes, 0);
  const completedMembers = members.filter((member) => member.todayStatus === "completed").length;
  const partialMembers = members.filter((member) => member.todayStatus === "partial").length;
  return {
    team: {
      id: context.team._id, name: context.team.name, avatar: context.team.avatar || "", roomCode: context.team.roomCode,
      ownerId: publicMemberId(context.team._id, context.team.ownerUserId), announcement: context.team.announcement || "一起行动，各自成长",
      joinMode: context.team.joinMode || "direct", version: Number(context.team.version || 1), visibility: context.team.visibility || "private",
      allowAnonymous: context.team.allowAnonymous !== false, actionDetailVisibility: context.team.actionDetailVisibility || "all_members",
      maxMembers: MAX_TEAM_MEMBERS, memberCount: allMemberships.length, createdAt: publicDate(context.team.createdAt),
      phaseStartDate: context.team.phaseStartDate || businessDate, phaseEndDate: context.team.phaseEndDate || "",
      description: context.team.announcement || "", status: "active", updatedAt: publicDate(context.team.updatedAt),
    },
    members: members.slice(start, start + pageSize),
    dailyStats: {
      teamId: context.team._id, date: businessDate, totalMembers: members.length, completedMembers, partialMembers,
      notStartedMembers: members.filter((member) => member.todayStatus === "not_started").length, missedMembers: 0,
      totalGrowthMinutes, encouragementCount: members.reduce((sum, member) => sum + member.encouragementCount, 0),
      completionRate: members.length ? Math.round(members.reduce((sum, member) => sum + member.completionRate, 0) / members.length) : 0,
    },
    page, pageSize, total: members.length, hasMore: start + pageSize < members.length,
  };
}

async function createTeam(openid, event) {
  const { userId } = await getUser(openid);
  const existing = await membershipFor(userId);
  if (existing) fail("ALREADY_IN_TEAM", "你已经加入了一个小队");
  const input = event && event.input || {};
  const roomCode = await uniqueRoomCode();
  const teamId = stableId("team", `${userId}:${Date.now()}:${roomCode}`);
  const name = cleanText(input.name || "进步小队", 20);
  if (name.length < 2) fail("INVALID_TEAM_NAME", "小队名称至少 2 个字符");
  const now = db.serverDate();
  await db.runTransaction(async (transaction) => {
    await transaction.collection("teams").doc(teamId).set({ data: {
      name, avatar: "", roomCode, ownerUserId: userId, announcement: "一起行动，各自成长", joinMode: "direct", visibility: "private",
      allowAnonymous: true, actionDetailVisibility: "all_members", memberCount: 1, maxMembers: MAX_TEAM_MEMBERS,
      version: 1, status: "active", phaseStartDate: formatBusinessDate(), phaseEndDate: "", createdAt: now, updatedAt: now,
    } });
    await transaction.collection("team_members").doc(memberDocId(teamId, userId)).set({ data: {
      teamId, userId, role: "owner", displayMode: "nicknameOnly", taskDetailVisible: true, status: "active", joinedAt: now, updatedAt: now,
    } });
  });
  await recordEvent(teamId, userId, "joined", { businessDate: formatBusinessDate(), dedupeKey: "owner" });
  return { teamId, joined: true };
}

async function joinTeamByRoomCode(openid, event) {
  const roomCode = normalizeRoomCode(event && event.roomCode);
  if (!roomCode) fail("INVALID_ROOM_CODE", "房间号格式无效");
  const { userId } = await getUser(openid);
  if (await membershipFor(userId)) fail("ALREADY_IN_TEAM", "你已经加入了一个小队");
  const team = await first("teams", { roomCode, status: "active" });
  if (!team) fail("ROOM_NOT_FOUND", "没有找到这个房间，请确认房间号");
  if (team.joinMode === "approval") {
    const requestId = stableId("team_join_request", `${team._id}:${userId}`);
    await db.collection("team_join_requests").doc(requestId).set({ data: { teamId: team._id, userId, status: "pending", createdAt: db.serverDate(), updatedAt: db.serverDate() } });
    return { teamId: team._id, pending: true };
  }
  await addMember(team._id, userId);
  return { teamId: team._id, joined: true };
}

async function addMember(teamId, userId) {
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection("teams").doc(teamId).get();
    const team = result.data;
    if (!team || team.status !== "active") fail("TEAM_NOT_FOUND", "小队不存在");
    if (Number(team.memberCount || 0) >= MAX_TEAM_MEMBERS) fail("TEAM_FULL", "小队已满 50 人");
    const memberRef = transaction.collection("team_members").doc(memberDocId(teamId, userId));
    const existing = await memberRef.get().catch(() => null);
    if (existing && existing.data && existing.data.status === "active") return;
    const now = db.serverDate();
    await memberRef.set({ data: { teamId, userId, role: "member", displayMode: "nicknameOnly", taskDetailVisible: true, status: "active", joinedAt: now, updatedAt: now } });
    await transaction.collection("teams").doc(teamId).update({ data: { memberCount: command.inc(1), version: command.inc(1), updatedAt: now } });
  });
  await recordEvent(teamId, userId, "joined", { businessDate: formatBusinessDate() });
}

async function updateTeamSettings(openid, event) {
  const context = await requireMembership(openid); assertOwner(context);
  const input = event && event.input || {};
  const name = cleanText(input.name, 20); const announcement = cleanText(input.announcement, 80);
  if (name.length < 2) fail("INVALID_TEAM_NAME", "小队名称至少 2 个字符");
  if (!["direct", "approval"].includes(input.joinMode || "direct")) fail("INVALID_JOIN_MODE", "加入方式无效");
  await db.collection("teams").doc(context.team._id).update({ data: {
    name, announcement, avatar: cleanText(input.avatar, 500), visibility: input.visibility === "public" ? "public" : "private",
    joinMode: input.joinMode || "direct", allowAnonymous: input.allowAnonymous !== false,
    actionDetailVisibility: ["all_members", "admins_only", "hidden"].includes(input.actionDetailVisibility) ? input.actionDetailVisibility : "all_members",
    version: command.inc(1), updatedAt: db.serverDate(),
  } });
  return { updated: true };
}

async function updateTeamMemberPrivacy(openid, event) {
  const context = await requireMembership(openid); const changes = { updatedAt: db.serverDate() };
  if (["public", "nicknameOnly", "anonymous"].includes(event.displayMode)) changes.displayMode = event.displayMode;
  if (typeof event.taskDetailVisible === "boolean") changes.taskDetailVisible = event.taskDetailVisible;
  await db.collection("team_members").doc(context.membership._id).update({ data: changes }); return { updated: true };
}

async function syncTeamActivity(openid) {
  const context = await requireMembership(openid); const businessDate = formatBusinessDate();
  const summary = await getMemberProgress(context.team._id, context.membership, context.userId, businessDate);
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
  const account = await getUser(openid); const membership = await membershipFor(account.userId);
  const page = Math.max(1, Number(event.page || 1)); const pageSize = Math.min(30, Math.max(1, Number(event.pageSize || 10)));
  if (!membership) return { list: [], hasMore: false, total: 0, page, pageSize: 0 };
  const context = await requireMembership(openid);
  const totalResult = await db.collection("team_events").where({ teamId: context.team._id }).count();
  const events = await db.collection("team_events").where({ teamId: context.team._id }).orderBy("createdAtMs", "desc").skip((page - 1) * pageSize).limit(pageSize).get();
  const memberships = await list("team_members", { teamId: context.team._id }, MAX_TEAM_MEMBERS); const memberMap = new Map(memberships.map((item) => [item.userId, item]));
  const users = await Promise.all(events.data.map((item) => db.collection("users").doc(item.userId).get().catch(() => null)));
  const listData = events.data.map((item, index) => {
    const membership = memberMap.get(item.userId) || {}; const user = users[index] && users[index].data || {}; const anonymous = membership.displayMode === "anonymous" && item.userId !== context.userId;
    const name = anonymous ? (membership.anonymousName || "行动伙伴") : cleanText(user.nickname || "行动伙伴", 20);
    const labels = { completed: "完成了今日行动", partial: "推进了今日行动", joined: "加入了小队", encouraged: "收到了队友鼓励", streak: "达成连续行动里程碑" };
    const timestamp = Number(item.createdAtMs || 0); const date = new Date(timestamp); const today = formatBusinessDate(); const dateKey = formatBusinessDate(date);
    return { id: item._id, memberId: publicMemberId(context.team._id, item.userId), name, avatar: anonymous ? "" : String(user.avatarUrl || ""), avatarText: name.slice(0, 1), type: item.type,
      actionText: labels[item.type] || "更新了行动", detail: item.type === "completed" || item.type === "partial" ? `今日已投入 ${Number(item.growthMinutes || 0)} 分钟` : labels[item.type] || "更新了行动",
      goalTitle: "", growthMinutes: Number(item.growthMinutes || 0), actionCount: Number(item.actionCount || 0), timestamp,
      dateLabel: dateKey === today ? "今天" : dateKey, timeText: dateKey === today ? `今天 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : dateKey,
    };
  });
  return { list: listData, hasMore: page * pageSize < Number(totalResult.total || 0), total: Number(totalResult.total || 0), page, pageSize };
}

async function removeMemberRecord(teamId, userId) {
  await db.runTransaction(async (transaction) => {
    const teamResult = await transaction.collection("teams").doc(teamId).get();
    await transaction.collection("team_members").doc(memberDocId(teamId, userId)).update({ data: { status: "left", leftAt: db.serverDate(), updatedAt: db.serverDate() } });
    await transaction.collection("teams").doc(teamId).update({ data: { memberCount: Math.max(0, Number(teamResult.data.memberCount || 1) - 1), version: command.inc(1), updatedAt: db.serverDate() } });
  });
}
async function leaveTeam(openid) { const context = await requireMembership(openid); if (context.membership.role === "owner") fail("OWNER_TRANSFER_REQUIRED", "队长退出前需要先转让小队或解散小队"); await removeMemberRecord(context.team._id, context.userId); return { teamId: context.team._id }; }
async function removeTeamMember(openid, event) { const context = await requireMembership(openid); assertOwner(context); const target = await resolvePublicMember(context.team._id, event.memberId); if (!target || target.role === "owner") fail("INVALID_TARGET", "无法移除该成员"); await removeMemberRecord(context.team._id, target.userId); return { teamId: context.team._id }; }
async function resolvePublicMember(teamId, memberId) { const members = await list("team_members", { teamId, status: "active" }, MAX_TEAM_MEMBERS); return members.find((item) => publicMemberId(teamId, item.userId) === String(memberId || "")); }
async function transferTeamOwner(openid, event) {
  const context = await requireMembership(openid); assertOwner(context); const target = await resolvePublicMember(context.team._id, event.memberId); if (!target || target.userId === context.userId) fail("INVALID_TARGET", "请选择其他成员");
  await db.runTransaction(async (transaction) => { await transaction.collection("team_members").doc(context.membership._id).update({ data: { role: "member", updatedAt: db.serverDate() } }); await transaction.collection("team_members").doc(target._id).update({ data: { role: "owner", updatedAt: db.serverDate() } }); await transaction.collection("teams").doc(context.team._id).update({ data: { ownerUserId: target.userId, version: command.inc(1), updatedAt: db.serverDate() } }); });
  return { teamId: context.team._id };
}
async function dissolveTeam(openid) { const context = await requireMembership(openid); assertOwner(context); const members = await list("team_members", { teamId: context.team._id, status: "active" }, MAX_TEAM_MEMBERS); await db.runTransaction(async (transaction) => { for (const member of members) await transaction.collection("team_members").doc(member._id).update({ data: { status: "left", leftAt: db.serverDate(), updatedAt: db.serverDate() } }); await transaction.collection("teams").doc(context.team._id).update({ data: { status: "closed", memberCount: 0, version: command.inc(1), closedAt: db.serverDate(), updatedAt: db.serverDate() } }); }); return { teamId: context.team._id, dissolved: true }; }
async function reviewTeamJoinRequest(openid, event) { const context = await requireMembership(openid); assertOwner(context); const requestId = String(event.requestId || ""); const result = await db.collection("team_join_requests").doc(requestId).get().catch(() => null); const request = result && result.data; if (!request || request.teamId !== context.team._id || request.status !== "pending") fail("REQUEST_NOT_FOUND", "申请不存在或已处理"); if (event.approved) await addMember(context.team._id, request.userId); await db.collection("team_join_requests").doc(requestId).update({ data: { status: event.approved ? "approved" : "rejected", reviewedAt: db.serverDate(), updatedAt: db.serverDate() } }); return { teamId: context.team._id, joined: Boolean(event.approved) }; }

module.exports = { ENCOURAGEMENT_TYPES, createTeam, dissolveTeam, getMyTeam: buildTeamPage, getTeamPage: buildTeamPage, getTeamActivityFeed, joinTeam: joinTeamByRoomCode, joinTeamByRoomCode, leaveTeam, publicMemberId, removeTeamMember, reviewTeamJoinRequest, sendEncouragement, syncTeamActivity, transferTeamOwner, updateTeamMemberPrivacy, updateTeamSettings };
