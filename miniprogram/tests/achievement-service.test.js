const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, filename);
};

const storage = new Map();
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
};

const { ACHIEVEMENT_DEFINITIONS, getAchievementCollection, markAchievementCelebrated } = require("../services/achievement.ts");
const { loadManualStoreIntoMemory, readManualStore } = require("../services/manualStore.ts");
const { addBusinessDays, getTodayBusinessDate } = require("../utils/date.ts");

assert.equal(ACHIEVEMENT_DEFINITIONS.length, 18, "商业版应提供 18 枚徽章");
assert.equal(new Set(ACHIEVEMENT_DEFINITIONS.map((item) => item.id)).size, 18, "徽章 id 必须唯一");
for (const definition of ACHIEVEMENT_DEFINITIONS) {
  const asset = path.resolve(__dirname, "..", definition.icon.replace(/^\//, ""));
  assert.equal(fs.existsSync(asset), true, `${definition.id} 缺少徽章资源`);
}

const today = getTodayBusinessDate();
const oldDate = addBusinessDays(today, -14);
let sequence = 0;
function task(overrides = {}) {
  sequence += 1;
  return {
    id: `task-${sequence}`,
    goalId: "goal-1",
    title: `行动 ${sequence}`,
    plannedDate: oldDate,
    currentDate: oldDate,
    estimatedMinutes: 30,
    status: "completed",
    source: "manual",
    createdAt: `${oldDate}T08:00:00.000Z`,
    updatedAt: `${oldDate}T09:00:00.000Z`,
    completedAt: `${oldDate}T09:00:00.000Z`,
    actualMinutes: 20,
    ...overrides,
  };
}

const tasks = [
  task({ currentDate: today, plannedDate: today, activityDate: today, reflection: "今天先拆小再开始", completedAt: `${today}T09:00:00.000Z`, updatedAt: `${today}T09:00:00.000Z` }),
  task({ status: "partially_completed", actualMinutes: 40 }),
  task({ status: "pending", actualMinutes: 999 }),
  task({ deletedAt: `${today}T10:00:00.000Z`, actualMinutes: 999, reflection: "不应统计" }),
  task({ currentDate: addBusinessDays(today, 1), plannedDate: addBusinessDays(today, 1), actualMinutes: 999 }),
];
for (let index = 0; index < 4; index += 1) tasks.push(task({ currentDate: addBusinessDays(oldDate, index), activityDate: addBusinessDays(oldDate, index) }));

loadManualStoreIntoMemory({
  version: 1,
  activeGoalId: "goal-1",
  goals: [{ id: "goal-1", title: "测试目标", category: "custom", status: "active", createdAt: oldDate, updatedAt: oldDate }],
  tasks,
  checkins: [], archivedGoals: [], achievementUnlocks: [], sparkCheckins: [],
});

let collection = getAchievementCollection();
const byId = (id) => collection.achievements.find((item) => item.id === id);
assert.equal(byId("reflection_1").unlocked, true, "真实复盘应解锁初次回望");
assert.equal(byId("reflection_10").current, 1, "空白、删除和未来复盘不得计数");
assert.equal(byId("minutes_60").current, 140, "只累计已完成或有投入的部分完成行动");
assert.equal(byId("streak_3").unlocked, true, "有真实投入的部分完成应计入行动连续日");
assert.equal(readManualStore().achievementUnlocks.length, collection.unlockedCount, "解锁记录应持久化且不重复");

const unlockCount = readManualStore().achievementUnlocks.length;
collection = getAchievementCollection();
assert.equal(readManualStore().achievementUnlocks.length, unlockCount, "重复读取不得重复写入解锁记录");
assert.equal(collection.newlyUnlocked.some((item) => item.id === "reflection_1"), true, "当天新徽章应进入一次性庆祝队列");
markAchievementCelebrated("reflection_1");
collection = getAchievementCollection();
assert.equal(collection.newlyUnlocked.some((item) => item.id === "reflection_1"), false, "确认收藏后不应再次庆祝");

console.log("achievement service tests passed");
