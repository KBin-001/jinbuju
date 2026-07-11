const assert = require("node:assert/strict");
const Module = require("node:module");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createDatabase() {
  let state = new Map();
  const failUpdates = new Set();
  const ensure = (name, source = state) => {
    if (!source.has(name)) source.set(name, new Map());
    return source.get(name);
  };
  const matches = (record, query) => Object.entries(query).every(([key, value]) => record[key] === value);
  const api = (source) => ({
    collection(name) {
      const records = ensure(name, source);
      return {
        doc(id) {
          return {
            async get() { return { data: clone(records.get(id)) }; },
            async set({ data }) { records.set(id, { ...clone(data), _id: id }); },
            async update({ data }) {
              if (failUpdates.has(`${name}:${id}`)) throw new Error("forced update failure");
              const current = records.get(id);
              if (!current) throw new Error("document not found");
              records.set(id, { ...current, ...clone(data) });
            },
          };
        },
        where(query) {
          let offset = 0;
          let count = Number.MAX_SAFE_INTEGER;
          const builder = {
            skip(value) { offset = value; return builder; },
            limit(value) { count = value; return builder; },
            async get() {
              return { data: Array.from(records.values()).filter((item) => matches(item, query)).slice(offset, offset + count).map(clone) };
            },
          };
          return builder;
        },
        limit() { return { async get() { return { data: Array.from(records.values()).map(clone) }; } }; },
      };
    },
  });
  return {
    collection(name) { return api(state).collection(name); },
    serverDate: () => ({ $date: "server" }),
    async createCollection(name) { ensure(name); },
    async runTransaction(callback) {
      const draft = new Map(Array.from(state, ([name, records]) => [name, new Map(Array.from(records, ([id, value]) => [id, clone(value)]))]));
      const result = await callback(api(draft));
      state = draft;
      return result;
    },
    seed(name, id, value) { ensure(name).set(id, { ...clone(value), _id: id }); },
    read(name, id) { return clone(ensure(name).get(id)); },
    list(name) { return Array.from(ensure(name).values()).map(clone); },
    failUpdate(name, id, enabled) { enabled ? failUpdates.add(`${name}:${id}`) : failUpdates.delete(`${name}:${id}`); },
  };
}

const database = createDatabase();
const cloudMock = { database: () => database };
const originalLoad = Module._load;
Module._load = function mockLoad(request, parent, isMain) {
  if (request === "wx-server-sdk") return cloudMock;
  if (request === "./repository" && parent?.filename.endsWith("manual-sync.js")) {
    return { stableId: (prefix, key) => `${prefix}_${key}` };
  }
  if (request === "./account" && parent?.filename.endsWith("manual-sync.js")) {
    return { resolveAccount: async () => ({ userId: "user_test" }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { executeCoachAction, getCoachActionStatus, syncManualData } = require("./manual-sync");
Module._load = originalLoad;

const openid = "openid_test";
const future = Date.now() + 60_000;
database.seed("manual_goals", "goal_doc", { _openid: openid, id: "goal_1", status: "active" });

function seedCreateProposal(id, overrides = {}) {
  database.seed("coach_action_proposals", id, {
    _openid: openid, status: "pending", type: "create_task", goalId: "goal_1", title: "看NBA",
    estimatedMinutes: 30, currentDate: "2026-07-07", expiresAtMs: future, result: null, ...overrides,
  });
}

(async () => {
  database.seed("users", "user_test", { userId: "user_test" });
  const oldTime = "2026-07-01T00:00:00.000Z";
  const newTime = "2026-07-02T00:00:00.000Z";
  const goal = { id: "goal_sync", title: "准备考试", category: "custom", status: "active", createdAt: oldTime, updatedAt: newTime };
  const task = { id: "task_sync", goalId: goal.id, title: "复习一章", plannedDate: "2026-07-02", currentDate: "2026-07-02", estimatedMinutes: 30, status: "pending", source: "manual", createdAt: oldTime, updatedAt: newTime };
  const synced = await syncManualData(openid, { store: { version: 1, activeGoalId: goal.id, goals: [goal], tasks: [task], checkins: [], archivedGoals: [], achievementUnlocks: [], sparkCheckins: [] } });
  assert.equal(synced.tasks.length, 1);
  assert.equal(database.list("manual_tasks").some((item) => item.id === task.id), true);

  const tombstone = { ...task, deletedAt: newTime };
  const deleted = await syncManualData(openid, { store: { version: 1, activeGoalId: goal.id, goals: [goal], tasks: [tombstone], checkins: [], archivedGoals: [], achievementUnlocks: [], sparkCheckins: [] } });
  assert.equal(deleted.tasks.find((item) => item.id === task.id).deletedAt, newTime);

  seedCreateProposal("proposal_ok");
  const created = await executeCoachAction(openid, { action: "executeCoachAction", proposalId: "proposal_ok", requestId: "req_ok" });
  assert.equal(created.task.title, "看NBA");
  assert.equal(database.read("coach_action_proposals", "proposal_ok").status, "executed");
  assert.equal(database.list("manual_tasks").length, 2);
  const repeated = await executeCoachAction(openid, { action: "executeCoachAction", proposalId: "proposal_ok", requestId: "req_repeat" });
  assert.equal(repeated.task.id, created.task.id);
  assert.equal(database.list("manual_tasks").length, 2);

  seedCreateProposal("proposal_rollback");
  database.failUpdate("coach_action_proposals", "proposal_rollback", true);
  await assert.rejects(() => executeCoachAction(openid, { action: "executeCoachAction", proposalId: "proposal_rollback", requestId: "req_fail" }));
  database.failUpdate("coach_action_proposals", "proposal_rollback", false);
  assert.equal(database.list("manual_tasks").some((item) => item.id.endsWith("proposal_rollback")), false);
  assert.equal(database.read("coach_action_proposals", "proposal_rollback").status, "pending");

  seedCreateProposal("proposal_legacy", { expiresAtMs: Date.now() - 1 });
  const legacyTaskId = "task_ai_proposal_legacy";
  const legacyDocId = `manual_tasks_${openid}:${legacyTaskId}`;
  database.seed("manual_tasks", legacyDocId, {
    _openid: openid, id: legacyTaskId, goalId: "goal_1", title: "历史任务", currentDate: "2026-07-07",
    plannedDate: "2026-07-07", estimatedMinutes: 30, status: "pending", source: "ai",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const reconciled = await executeCoachAction(openid, { action: "executeCoachAction", proposalId: "proposal_legacy", requestId: "req_legacy" });
  assert.equal(reconciled.task.id, legacyTaskId);
  assert.equal(database.read("coach_action_proposals", "proposal_legacy").status, "executed");
  const status = await getCoachActionStatus(openid, { action: "getCoachActionStatus", proposalId: "proposal_legacy", requestId: "req_status" });
  assert.equal(status.status, "executed");
  assert.equal(status.result.task.id, legacyTaskId);

  console.log("manual sync transaction tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
