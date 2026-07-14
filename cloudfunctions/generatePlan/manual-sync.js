const cloud = require("wx-server-sdk");
const { stableId } = require("./repository");
const { resolveAccount } = require("./account");

const db = cloud.database();
const COLLECTIONS = {
  goals: "manual_goals",
  tasks: "manual_tasks",
  checkins: "manual_checkins",
  archivedGoals: "manual_archived_goals",
  achievementUnlocks: "achievement_unlocks",
  sparkCheckins: "spark_checkins",
  proposals: "coach_action_proposals",
};
let collectionsReady;

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function logAction(stage, event, extra = {}) {
  console.info("coach action", {
    action: event && event.action,
    requestId: String(event && event.requestId || "").slice(0, 100),
    stage,
    ...extra,
  });
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validBusinessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

function shouldReplace(existing, incoming) {
  if (!existing) return true;
  const currentTime = String(existing.updatedAt || "");
  const incomingTime = String(incoming.updatedAt || "");
  return incomingTime > currentTime || (incomingTime === currentTime && incoming.deletedAt && !existing.deletedAt);
}

function cleanRecord(raw, kind) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw createError("MANUAL_SYNC_INVALID", `${kind}数据无效。`);
  const id = String(raw.id || "").trim();
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) throw createError("MANUAL_SYNC_INVALID", `${kind}标识无效。`);
  const updatedAt = validIso(raw.updatedAt) ? raw.updatedAt : validIso(raw.createdAt) ? raw.createdAt : new Date(0).toISOString();
  if (Date.parse(updatedAt) > Date.now() + 5 * 60 * 1000) throw createError("MANUAL_SYNC_INVALID", `${kind}更新时间无效。`);
  if (raw.deletedAt && !validIso(raw.deletedAt)) throw createError("MANUAL_SYNC_INVALID", `${kind}删除时间无效。`);
  if (kind === "目标") {
    if (typeof raw.title !== "string" || !raw.title.trim() || !["active", "completed", "ended", "archived"].includes(raw.status)) {
      throw createError("MANUAL_SYNC_INVALID", "目标数据无效。");
    }
  }
  if (kind === "行动") {
    if (typeof raw.goalId !== "string" || !raw.goalId || typeof raw.title !== "string" || !raw.title.trim()) throw createError("MANUAL_SYNC_INVALID", "行动数据无效。");
    if (!validBusinessDate(raw.currentDate)) throw createError("MANUAL_SYNC_INVALID", "行动日期无效。");
    if (!["pending", "completed", "partially_completed", "skipped", "rescheduled"].includes(raw.status)) throw createError("MANUAL_SYNC_INVALID", "行动状态无效。");
    if (!Number.isInteger(raw.estimatedMinutes) || raw.estimatedMinutes < 5 || raw.estimatedMinutes > 240) throw createError("MANUAL_SYNC_INVALID", "行动预计时间无效。");
    if (raw.actualMinutes !== undefined && (!Number.isInteger(raw.actualMinutes) || raw.actualMinutes < 0 || raw.actualMinutes > 480)) throw createError("MANUAL_SYNC_INVALID", "行动实际时间无效。");
    if (raw.reflection !== undefined && (typeof raw.reflection !== "string" || raw.reflection.length > 200)) throw createError("MANUAL_SYNC_INVALID", "行动感受记录无效。");
  }
  if (kind === "打卡" && (typeof raw.goalId !== "string" || !raw.goalId || !validBusinessDate(raw.businessDate))) {
    throw createError("MANUAL_SYNC_INVALID", "打卡数据无效。");
  }
  return { ...raw, id, updatedAt };
}

function publicRecord(value) {
  const next = { ...value };
  delete next._id;
  delete next._openid;
  delete next.userId;
  delete next.serverUpdatedAt;
  return next;
}

function isCollectionMissing(error) {
  const code = Number(error && (error.errCode || error.code));
  const message = String(error && (error.errMsg || error.message) || "");
  return code === -502005 || /collection not exist|collection not exists|集合不存在/i.test(message);
}

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get();
    return;
  } catch (error) {
    if (!isCollectionMissing(error)) throw error;
  }
  try {
    await db.createCollection(name);
  } catch (error) {
    // 并发冷启动可能同时创建集合；创建失败后再次读取，以读取结果为准。
    await db.collection(name).limit(1).get();
  }
}

function ensureManualCollections() {
  if (!collectionsReady) {
    collectionsReady = Promise.all(Object.values(COLLECTIONS).map(ensureCollection)).catch((error) => {
      collectionsReady = undefined;
      console.error("manual collections unavailable", { code: error && (error.code || error.errCode), message: error && (error.message || error.errMsg) });
      throw createError("MANUAL_STORAGE_UNAVAILABLE", "行动数据存储尚未初始化，请稍后重试。");
    });
  }
  return collectionsReady;
}

async function listOwned(collection, openid, limit = 2000) {
  const pageSize = 100;
  const records = [];
  for (let offset = 0; offset < limit; offset += pageSize) {
    const result = await db.collection(collection).where({ _openid: openid }).skip(offset).limit(pageSize).get();
    const page = result.data || [];
    records.push(...page.map(publicRecord));
    if (page.length < pageSize) break;
  }
  return records;
}

async function prepareCollectionMerge(openid, collection, rawItems, kind) {
  const incoming = (Array.isArray(rawItems) ? rawItems : []).map((item) => cleanRecord(item, kind));
  const current = await listOwned(collection, openid);
  const merged = new Map(current.map((item) => [item.id, item]));
  const changes = [];
  for (const item of incoming) {
    const existing = merged.get(item.id);
    if (shouldReplace(existing, item)) {
      merged.set(item.id, item);
      changes.push(item);
    }
  }
  return { items: Array.from(merged.values()), changes };
}

async function persistCollectionChanges(openid, userId, collection, changes) {
  for (const item of changes) {
    const docId = stableId(collection, `${openid}:${item.id}`);
    await db.runTransaction(async (transaction) => {
      const ref = transaction.collection(collection).doc(docId);
      const found = await ref.get().catch(() => null);
      const existing = found && found.data ? publicRecord(found.data) : null;
      if (!shouldReplace(existing, item)) return;
      await ref.set({ data: { ...item, _openid: openid, userId, serverUpdatedAt: db.serverDate() } });
    });
  }
}

async function syncManualData(openid, event) {
  await ensureManualCollections();
  const account = await resolveAccount(openid, true);
  const store = event && event.store;
  if (!store || store.version !== 1) throw createError("MANUAL_SYNC_INVALID", "本地行动数据无效。");
  const prepared = await Promise.all([
    prepareCollectionMerge(openid, COLLECTIONS.goals, store.goals, "目标"),
    prepareCollectionMerge(openid, COLLECTIONS.tasks, store.tasks, "行动"),
    prepareCollectionMerge(openid, COLLECTIONS.checkins, store.checkins, "打卡"),
    prepareCollectionMerge(openid, COLLECTIONS.archivedGoals, store.archivedGoals, "归档目标"),
    prepareCollectionMerge(openid, COLLECTIONS.achievementUnlocks,
      (store.achievementUnlocks || []).map((item) => ({ ...item, id: item.achievementId, updatedAt: item.celebratedAt || item.unlockedAt })), "成就"),
    prepareCollectionMerge(openid, COLLECTIONS.sparkCheckins,
      (store.sparkCheckins || []).map((item) => ({ ...item, id: item.businessDate, updatedAt: item.checkedAt })), "火花签到"),
  ]);
  const [goalMerge, taskMerge, checkinMerge, archivedMerge, achievementMerge, sparkMerge] = prepared;
  const goals = goalMerge.items;
  const tasks = taskMerge.items;
  const checkins = checkinMerge.items;
  const goalIds = new Set(goals.map((item) => item.id));
  if (tasks.some((item) => !item.deletedAt && !goalIds.has(item.goalId)) || checkins.some((item) => !item.deletedAt && !goalIds.has(item.goalId))) {
    throw createError("MANUAL_SYNC_INVALID", "行动或打卡不属于当前目标。");
  }
  await Promise.all([
    persistCollectionChanges(openid, account.userId, COLLECTIONS.goals, goalMerge.changes),
    persistCollectionChanges(openid, account.userId, COLLECTIONS.tasks, taskMerge.changes),
    persistCollectionChanges(openid, account.userId, COLLECTIONS.checkins, checkinMerge.changes),
    persistCollectionChanges(openid, account.userId, COLLECTIONS.archivedGoals, archivedMerge.changes),
    persistCollectionChanges(openid, account.userId, COLLECTIONS.achievementUnlocks, achievementMerge.changes),
    persistCollectionChanges(openid, account.userId, COLLECTIONS.sparkCheckins, sparkMerge.changes),
  ]);
  const userSyncData = {
    lastManualSyncAt: new Date().toISOString(),
    updatedAt: db.serverDate(),
  };
  if (event && event.migration === true) {
    userSyncData.legacyMigrationCompleted = true;
    userSyncData.migrationVersion = 1;
  }
  await db.collection("users").doc(account.userId).update({ data: userSyncData });
  return {
    version: 1,
    activeGoalId: goals.some((item) => item.id === store.activeGoalId) ? store.activeGoalId : goals.find((item) => item.status === "active")?.id,
    goals,
    tasks,
    checkins,
    archivedGoals: archivedMerge.items,
    achievementUnlocks: achievementMerge.items,
    sparkCheckins: sparkMerge.items,
  };
}

async function createCoachProposal(openid, input) {
  await ensureManualCollections();
  const now = Date.now();
  const proposalId = stableId("coach_action", `${openid}:${input.messageSentAt}:${input.type}:${input.taskId || input.title}`);
  const existing = await db.collection(COLLECTIONS.proposals).doc(proposalId).get().catch(() => null);
  if (!existing || !existing.data) {
    await db.collection(COLLECTIONS.proposals).doc(proposalId).set({
      data: {
        _openid: openid,
        status: "pending",
        type: input.type,
        goalId: input.goalId,
        taskId: input.taskId || "",
        taskTitle: input.taskTitle || input.title || "",
        title: input.title || "",
        estimatedMinutes: input.estimatedMinutes || 0,
        actualMinutes: input.actualMinutes || 0,
        currentDate: input.currentDate,
        completedAt: input.completedAt || "",
        expectedUpdatedAt: input.expectedUpdatedAt || "",
        createdAtMs: now,
        expiresAtMs: now + 10 * 60 * 1000,
        executedAt: null,
        result: null,
      },
    });
  }
  return {
    id: proposalId,
    type: input.type,
    status: "pending",
    summary: input.type === "complete_task"
      ? `完成${input.taskTitle} · 实际 ${input.actualMinutes} 分钟 · ${input.completedAt.slice(11, 16)}`
      : `新增${input.title} · 预计 ${input.estimatedMinutes} 分钟 · ${input.currentDate}`,
    taskId: input.taskId || undefined,
    taskTitle: input.taskTitle || undefined,
    actualMinutes: input.actualMinutes || undefined,
    completedAt: input.completedAt || undefined,
    title: input.title || undefined,
    estimatedMinutes: input.estimatedMinutes || undefined,
    currentDate: input.currentDate,
    expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  };
}

async function executeCoachAction(openid, event) {
  await ensureManualCollections();
  const proposalId = String(event && event.proposalId || "");
  if (!proposalId) throw createError("COACH_ACTION_INVALID", "操作确认信息无效。");
  let stage = "transaction_begin";
  logAction(stage, event, { proposalIdSuffix: proposalId.slice(-8) });
  try {
    const result = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.proposals).doc(proposalId);
      const found = await ref.get().catch(() => null);
      const proposal = found && found.data;
      if (!proposal || proposal._openid !== openid) throw createError("COACH_ACTION_NOT_FOUND", "操作不存在或无权执行。");
      if (proposal.status === "executed" && proposal.result) return proposal.result;
      if (proposal.status !== "pending") throw createError("COACH_ACTION_EXPIRED", "操作确认已过期，请重新告诉 AI。");

      let task;
      let reconciled = false;
      if (proposal.type === "complete_task") {
        stage = "task_validation";
        const query = await transaction.collection(COLLECTIONS.tasks).where({ _openid: openid, id: proposal.taskId }).limit(1).get();
        const current = query.data && query.data[0];
        if (!current) throw createError("COACH_ACTION_CONFLICT", "行动已不存在，请刷新后重试。");
        if (current.status === "completed") {
          task = publicRecord(current);
          reconciled = true;
        } else {
          if (proposal.expiresAtMs < Date.now()) throw createError("COACH_ACTION_EXPIRED", "操作确认已过期，请重新告诉 AI。");
          if (current.updatedAt !== proposal.expectedUpdatedAt) throw createError("COACH_ACTION_CONFLICT", "行动已发生变化，请重新确认。");
          if (!Number.isInteger(proposal.actualMinutes) || proposal.actualMinutes < 1 || proposal.actualMinutes > 480) throw createError("COACH_ACTION_INVALID", "实际投入时间无效。");
          stage = "task_write";
          const changes = {
            status: "completed", actualMinutes: proposal.actualMinutes, completedAt: proposal.completedAt,
            updatedAt: new Date().toISOString(), serverUpdatedAt: db.serverDate(),
          };
          await transaction.collection(COLLECTIONS.tasks).doc(current._id).update({ data: changes });
          task = { ...publicRecord(current), status: changes.status, actualMinutes: changes.actualMinutes, completedAt: changes.completedAt, updatedAt: changes.updatedAt };
        }
      } else if (proposal.type === "create_task") {
        const taskId = `task_ai_${proposalId.slice(-20)}`;
        const docId = stableId(COLLECTIONS.tasks, `${openid}:${taskId}`);
        const existing = await transaction.collection(COLLECTIONS.tasks).doc(docId).get().catch(() => null);
        if (existing && existing.data) {
          if (existing.data._openid !== openid) throw createError("COACH_ACTION_CONFLICT", "行动归属校验失败。");
          task = publicRecord(existing.data);
          reconciled = true;
        } else {
          if (proposal.expiresAtMs < Date.now()) throw createError("COACH_ACTION_EXPIRED", "操作确认已过期，请重新告诉 AI。");
          stage = "goal_validation";
          const goal = await transaction.collection(COLLECTIONS.goals).where({ _openid: openid, id: proposal.goalId, status: "active" }).limit(1).get();
          if (!goal.data || !goal.data.length) throw createError("COACH_ACTION_CONFLICT", "当前目标已变化，请重新确认。");
          stage = "task_write";
          const now = new Date().toISOString();
          task = {
            id: taskId, goalId: proposal.goalId, title: proposal.title, plannedDate: proposal.currentDate,
            currentDate: proposal.currentDate, estimatedMinutes: proposal.estimatedMinutes, status: "pending",
            source: "ai", createdAt: now, updatedAt: now,
          };
          await transaction.collection(COLLECTIONS.tasks).doc(docId).set({ data: { ...task, _openid: openid, serverUpdatedAt: db.serverDate() } });
        }
      } else throw createError("COACH_ACTION_INVALID", "暂不支持此操作。");

      if (reconciled) logAction("task_reconciled", event, { type: proposal.type });
      const actionResult = { proposalId, type: proposal.type, status: "executed", task };
      stage = "proposal_commit";
      await ref.update({ data: { status: "executed", executedAt: db.serverDate(), result: actionResult } });
      return actionResult;
    });
    stage = "transaction_committed";
    logAction(stage, event, { type: result.type });
    return result;
  } catch (error) {
    console.error("coach action failed", {
      requestId: String(event && event.requestId || "").slice(0, 100),
      stage,
      code: error && error.code || "INTERNAL_ERROR",
      message: error && error.message ? String(error.message).slice(0, 160) : "",
      proposalIdSuffix: proposalId.slice(-8),
    });
    throw error;
  }
}

async function getCoachActionStatus(openid, event) {
  await ensureManualCollections();
  const proposalId = String(event && event.proposalId || "");
  if (!proposalId) throw createError("COACH_ACTION_INVALID", "操作确认信息无效。");
  const found = await db.collection(COLLECTIONS.proposals).doc(proposalId).get().catch(() => null);
  const proposal = found && found.data;
  if (!proposal || proposal._openid !== openid) throw createError("COACH_ACTION_NOT_FOUND", "操作不存在或无权查看。");
  const status = proposal.status === "executed" && proposal.result
    ? "executed"
    : proposal.expiresAtMs < Date.now() ? "expired" : "pending";
  logAction("status_checked", event, { status, proposalIdSuffix: proposalId.slice(-8) });
  return { proposalId, type: proposal.type, status, result: status === "executed" ? proposal.result : undefined };
}

module.exports = { createCoachProposal, executeCoachAction, getCoachActionStatus, syncManualData };
