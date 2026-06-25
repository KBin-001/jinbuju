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

const { createGoal, endGoal, getActiveGoal, getActiveGoals, getArchivedGoals, setCurrentGoal } = require("../services/manualGoal.ts");
const { createTask, getTasksByDate, getTodayPageTasks, rescheduleTask, updateTaskStatus } = require("../services/manualTask.ts");
const { getProgressSummary, recordDailyCheckin } = require("../services/manualStats.ts");

const today = "2026-06-21";
const blogGoal = createGoal({ title: "完成个人博客", category: "custom" });
const cetGoal = createGoal({ title: "通过英语四六级", category: "cet" });

assert.equal(getActiveGoals().length, 2);
assert.equal(getActiveGoal().id, cetGoal.id);
assert.equal(setCurrentGoal(blogGoal.id).id, blogGoal.id);
assert.equal(getActiveGoal().id, blogGoal.id);

assert.throws(() => createTask({ goalId: blogGoal.id, title: "", currentDate: today, estimatedMinutes: 30 }));
assert.throws(() => createTask({ goalId: blogGoal.id, title: "无效时间", currentDate: today, estimatedMinutes: 4 }));

const completed = createTask({ goalId: blogGoal.id, title: "完成首页布局", currentDate: today, estimatedMinutes: 30 });
const partial = createTask({ goalId: blogGoal.id, title: "写一篇项目文章", currentDate: today, estimatedMinutes: 45 });
const pending = createTask({ goalId: blogGoal.id, title: "检查移动端适配", currentDate: today, estimatedMinutes: 20 });
createTask({ goalId: cetGoal.id, title: "背30个单词", currentDate: today, estimatedMinutes: 30 });

updateTaskStatus(completed.id, "completed", 35);
updateTaskStatus(partial.id, "partially_completed", 20, "not_enough_time");
assert.throws(() => updateTaskStatus(pending.id, "completed", 481));
rescheduleTask(pending.id);

assert.equal(getTasksByDate(blogGoal.id, today).length, 2);
assert.equal(getTasksByDate(blogGoal.id, "2026-06-22").length, 1);
assert.equal(getTodayPageTasks(blogGoal.id, today).length, 2);
assert.equal(getTodayPageTasks(blogGoal.id, "2026-06-22").length, 2);
const firstCheckin = recordDailyCheckin(blogGoal.id, today);
const repeatedCheckin = recordDailyCheckin(blogGoal.id, today);
assert.equal(firstCheckin.id, repeatedCheckin.id);

const summary = getProgressSummary(blogGoal.id, today);
assert.equal(summary.totalTasks, 3);
assert.equal(summary.completedTasks, 1);
assert.equal(summary.totalActualMinutes, 55);
assert.equal(summary.totalActionDays, 1);
assert.equal(summary.todayCompleted, 1);
assert.equal(summary.todayTotal, 2);

const archivedGoal = endGoal(blogGoal.id);
assert.equal(archivedGoal.id, blogGoal.id);
assert.equal(archivedGoal.actions.length, 3);
assert.equal(archivedGoal.stats.completedActions, 1);
assert.equal(archivedGoal.stats.actualMinutes, 55);
assert.equal(archivedGoal.stats.completionRate, 33);
assert.equal(getActiveGoals().length, 1);
assert.equal(getActiveGoal().id, cetGoal.id);
assert.equal(getArchivedGoals()[0].id, blogGoal.id);

console.log("manual service tests passed");
