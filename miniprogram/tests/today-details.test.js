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
const { createTask, updateTaskStatus } = require("../services/manualTask.ts");
const { getTodayDataBounds, getTodayDataCalendar, getTodayDataDetails } = require("../services/todayDetails.ts");

const goal = createGoal({ title: "考公", category: "civil_service" });
const completed = createTask({ goalId: goal.id, title: "看言语理解", currentDate: "2026-06-21", estimatedMinutes: 30 });
const partial = createTask({ goalId: goal.id, title: "做一组逻辑推理题", currentDate: "2026-06-21", estimatedMinutes: 30 });
const yesterday = createTask({ goalId: goal.id, title: "复盘错题", currentDate: "2026-06-20", estimatedMinutes: 15 });

updateTaskStatus(completed.id, "completed", 30);
updateTaskStatus(partial.id, "partially_completed", 20, "not_enough_time");
updateTaskStatus(yesterday.id, "completed", 15);

const day = getTodayDataDetails(goal.id, "2026-06-21", "day");
assert.deepEqual(day.metrics, { minutes: 50, completed: 1, focusRate: 50, total: 2 });
assert.deepEqual(day.previous, { minutes: 15, completed: 1, focusRate: 100, total: 1 });
assert.equal(day.completedTasks.length, 1);
assert.equal(day.completedTasks[0].minutes, 30);
assert.equal(day.durationTotal, 30);
assert.equal(day.bars.reduce((sum, item) => sum + item.value, 0), 50);
assert.match(day.pieGradient, /^conic-gradient/);

const week = getTodayDataDetails(goal.id, "2026-06-21", "week");
assert.equal(week.bars.length, 7);
assert.equal(week.bars.reduce((sum, item) => sum + item.value, 0), 65);

const month = getTodayDataDetails(goal.id, "2026-06-21", "month");
assert.equal(month.bars.length, 6);
assert.equal(month.bars.reduce((sum, item) => sum + item.value, 0), 65);

const empty = getTodayDataDetails(goal.id, "2026-06-19", "day");
assert.equal(empty.durationTotal, 0);
assert.equal(empty.pieGradient, "conic-gradient(#E8EFEA 0% 100%)");

const bounds = getTodayDataBounds(goal.id, "2026-06-28");
assert.deepEqual(bounds, { minDate: "2026-06-20", maxDate: "2026-06-28" });
const calendar = getTodayDataCalendar(goal.id, "2026-06-21", "2026-06-01", bounds.minDate, bounds.maxDate);
assert.equal(calendar.days.length, 42);
assert.equal(calendar.days.find((item) => item.date === "2026-06-21").isSelected, true);
assert.equal(calendar.days.find((item) => item.date === "2026-06-21").hasAction, true);
assert.equal(calendar.days.find((item) => item.date === "2026-06-21").isCompleted, true);
assert.equal(calendar.days.find((item) => item.date === "2026-06-29").isFuture, true);
assert.equal(calendar.days.find((item) => item.date === "2026-06-19").isBeforeMin, true);

console.log("today details tests passed");
