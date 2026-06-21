const assert = require("node:assert/strict");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
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

const { createGoal } = require("../services/manualGoal.ts");
const { createTask, getTasksByDate, getTodayPageTasks, rescheduleTask, updateTaskStatus } = require("../services/manualTask.ts");
const { getProgressSummary, recordDailyCheckin } = require("../services/manualStats.ts");

const today = "2026-06-21";
const goal = createGoal({ title: "完成个人博客", category: "custom" });
assert.throws(() => createGoal({ title: "第二个目标", category: "custom" }), /已有一个/);
assert.throws(() => createTask({ goalId: goal.id, title: "", currentDate: today, estimatedMinutes: 30 }), /2～40/);
assert.throws(() => createTask({ goalId: goal.id, title: "无效时间", currentDate: today, estimatedMinutes: 4 }), /5～240/);

const completed = createTask({ goalId: goal.id, title: "完成首页布局", currentDate: today, estimatedMinutes: 30 });
const partial = createTask({ goalId: goal.id, title: "写一篇项目文章", currentDate: today, estimatedMinutes: 45 });
const pending = createTask({ goalId: goal.id, title: "检查移动端适配", currentDate: today, estimatedMinutes: 20 });
updateTaskStatus(completed.id, "completed", 35);
updateTaskStatus(partial.id, "partially_completed", 20, "not_enough_time");
assert.throws(() => updateTaskStatus(pending.id, "completed", 481), /1～480/);
rescheduleTask(pending.id);

assert.equal(getTasksByDate(goal.id, today).length, 2);
assert.equal(getTasksByDate(goal.id, "2026-06-22").length, 1);
assert.equal(getTodayPageTasks(goal.id, today).length, 2);
assert.equal(getTodayPageTasks(goal.id, "2026-06-22").length, 2);
const firstCheckin = recordDailyCheckin(goal.id, today);
const repeatedCheckin = recordDailyCheckin(goal.id, today);
assert.equal(firstCheckin.id, repeatedCheckin.id);

const summary = getProgressSummary(goal.id, today);
assert.equal(summary.totalTasks, 3);
assert.equal(summary.completedTasks, 1);
assert.equal(summary.totalActualMinutes, 55);
assert.equal(summary.totalActionDays, 1);
assert.equal(summary.todayCompleted, 1);
assert.equal(summary.todayTotal, 2);

console.log("manual service tests passed");
