const cloud = require("wx-server-sdk");
const { stableId } = require("./repository");

const db = cloud.database();
const COLLECTIONS = {
  goals: "manual_goals",
  tasks: "manual_tasks",
  checkins: "manual_checkins",
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

function cleanRecord(raw, kind) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw createError("MANUAL_SYNC_INVALID", `${kind}数据无效。`);
  const id = String(raw.id || "").trim();
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) throw createError("MANUAL_SYNC_INVALID", `${kind}标识无效。`);
  const updatedAt = validIso(raw.updatedAt) ? raw.updatedAt : validIso(raw.createdAt) ? raw.createdAt : new Date(0).toISOString();
  return { ...raw, id, updatedAt };
}

function publicRecord(value) {
  const next = { ...value };
  delete next._id;
  delete next._openid;
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

async function listOwned(collection, openid, limit = 500) {
  const result = await db.collection(collection).where({ _openid: openid }).limit(limit).get();
  return (result.data || []).map(publicRecord);
}

async function mergeCollection(openid, collection, rawItems, kind) {
  const incoming = (Array.isArray(rawItems) ? rawItems : []).map((item) => cleanRecord(item, kind));
  const current = await listOwned(collection, openid);
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = merged.get(item.id);
    if (!existing || String(item.updatedAt) > String(existing.updatedAt || "")) merged.set(item.id, item);
  }
  for (const item of merged.values()) {
    const docId = stableId(collection, `${openid}:${item.id}`);
    await db.collection(collection).doc(docId).set({ data: { ...item, _openid: openid, serverUpdatedAt: db.serverDate() } });
  }
  return Array.from(merged.values());
}

async function syncManualData(openid, event) {
  await ensureManualCollections();
  const store = event && event.store;
  if (!store || store.version !== 1) throw createError("MANUAL_SYNC_INVALID", "本地行动数据无效。");
  const goals = await mergeCollection(openid, COLLECTIONS.goals, store.goals, "目标");
  const goalIds = new Set(goals.map((item) => item.id));
  const tasks = await mergeCollection(openid, COLLECTIONS.tasks, store.tasks, "行动");
  const checkins = await mergeCollection(openid, COLLECTIONS.checkins, store.checkins, "打卡");
  if (tasks.some((item) => !goalIds.has(item.goalId)) || checkins.some((item) => !goalIds.has(item.goalId))) {
    throw createError("MANUAL_SYNC_INVALID", "行动或打卡不属于当前目标。");
  }
  return {
    version: 1,
    activeGoalId: goals.some((item) => item.id === store.activeGoalId) ? store.activeGoalId : goals.find((item) => item.status === "active")?.id,
    goals,
    tasks,
    checkins,
    archivedGoals: Array.isArray(store.archivedGoals) ? store.archivedGoals : [],
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
  let stage = "proposal_lookup";
  logAction(stage, event, { proposalIdSuffix: proposalId.slice(-8) });
  try {
    const ref = db.collection(COLLECTIONS.proposals).doc(proposalId);
    const found = await ref.get().catch(() => null);
    const proposal = found && found.data;
    if (!proposal || proposal._openid !== openid) throw createError("COACH_ACTION_NOT_FOUND", "操作不存在或无权执行。");
    if (proposal.status === "executed" && proposal.result) return proposal.result;
    if (proposal.status !== "pending" || proposal.expiresAtMs < Date.now()) throw createError("COACH_ACTION_EXPIRED", "操作确认已过期，请重新告诉 AI。");

    let task;
    if (proposal.type === "complete_task") {
      stage = "task_validation";
      logAction(stage, event, { type: proposal.type });
      const query = await db.collection(COLLECTIONS.tasks).where({ _openid: openid, id: proposal.taskId }).limit(1).get();
      const current = query.data && query.data[0];
      if (!current) throw createError("COACH_ACTION_CONFLICT", "行动已不存在，请刷新后重试。");
      if (current.status === "completed") {
        task = publicRecord(current);
      } else {
        if (current.updatedAt !== proposal.expectedUpdatedAt) throw createError("COACH_ACTION_CONFLICT", "行动已发生变化，请重新确认。");
        if (!Number.isInteger(proposal.actualMinutes) || proposal.actualMinutes < 1 || proposal.actualMinutes > 480) throw createError("COACH_ACTION_INVALID", "实际投入时间无效。");
        stage = "task_write";
        logAction(stage, event, { type: proposal.type });
        await db.collection(COLLECTIONS.tasks).doc(current._id).update({ data: {
          status: "completed",
          actualMinutes: proposal.actualMinutes,
          completedAt: proposal.completedAt,
          updatedAt: new Date().toISOString(),
          serverUpdatedAt: db.serverDate(),
        } });
        const updated = await db.collection(COLLECTIONS.tasks).doc(current._id).get();
        task = publicRecord(updated.data);
      }
    } else if (proposal.type === "create_task") {
      stage = "goal_validation";
      logAction(stage, event, { type: proposal.type });
      const goal = await db.collection(COLLECTIONS.goals).where({ _openid: openid, id: proposal.goalId, status: "active" }).limit(1).get();
      if (!goal.data || !goal.data.length) throw createError("COACH_ACTION_CONFLICT", "当前目标已变化，请重新确认。");
      stage = "task_write";
      logAction(stage, event, { type: proposal.type });
      const taskId = `task_ai_${proposalId.slice(-20)}`;
      const docId = stableId(COLLECTIONS.tasks, `${openid}:${taskId}`);
      const existing = await db.collection(COLLECTIONS.tasks).doc(docId).get().catch(() => null);
      if (existing && existing.data) task = publicRecord(existing.data);
      else {
        const now = new Date().toISOString();
        task = {
          id: taskId, goalId: proposal.goalId, title: proposal.title, plannedDate: proposal.currentDate,
          currentDate: proposal.currentDate, estimatedMinutes: proposal.estimatedMinutes, status: "pending",
          source: "ai", createdAt: now, updatedAt: now,
        };
        await db.collection(COLLECTIONS.tasks).doc(docId).set({ data: { ...task, _openid: openid, serverUpdatedAt: db.serverDate() } });
      }
    } else throw createError("COACH_ACTION_INVALID", "暂不支持此操作。");

    const result = { proposalId, type: proposal.type, status: "executed", task };
    stage = "proposal_commit";
    logAction(stage, event, { type: proposal.type });
    await ref.update({ data: { status: "executed", executedAt: db.serverDate(), result } });
    logAction("completed", event, { type: proposal.type });
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

module.exports = { createCoachProposal, executeCoachAction, syncManualData };
