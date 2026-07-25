const assert = require("node:assert/strict");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, filename);
};

const { getActionTaskDisplayStatus, groupTodayTasks, isCarryOverTask, sortTodayTasksIncompleteFirst } = require("../utils/taskStatus.ts");
const { getTodayBusinessDate } = require("../utils/date.ts");
const today = "2026-06-21";

assert.equal(getTodayBusinessDate(new Date("2026-06-20T16:00:00.000Z")), today);

assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "pending" }, today), { text: "待开始", tone: "neutral" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: "2026-06-22", status: "pending" }, today), { text: "未到日期", tone: "muted" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: "2026-06-20", status: "pending" }, today), { text: "待继续", tone: "warning" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "completed" }, today), { text: "已完成", tone: "success" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: "2026-06-20", status: "partially_completed" }, today), { text: "完成一部分", tone: "neutral", badge: "待继续" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "skipped" }, today), { text: "今天不做", tone: "muted" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "rescheduled" }, today), { text: "已顺延", tone: "muted" });

const carried = { currentDate: today, plannedDate: "2026-06-20", status: "pending" };
assert.equal(isCarryOverTask(carried), true);
assert.deepEqual(getActionTaskDisplayStatus(carried, today), { text: "待开始", tone: "neutral" });

const groups = groupTodayTasks([
  carried,
  { currentDate: "2026-06-20", status: "pending" },
  { currentDate: "2026-06-22", status: "pending" },
], today);
assert.deepEqual(groups.map((group) => [group.key, group.tasks.length]), [["today", 1], ["continue", 1]]);

const originalTasks = [
  { id: "done-first", status: "completed" },
  { id: "pending", status: "pending" },
  { id: "done-second", status: "completed" },
  { id: "partial", status: "partially_completed" },
];
assert.deepEqual(
  sortTodayTasksIncompleteFirst(originalTasks).map((task) => task.id),
  ["pending", "partial", "done-first", "done-second"],
  "未完成行动应保持在前，已完成行动应稳定移动到最后",
);
assert.deepEqual(originalTasks.map((task) => task.id), ["done-first", "pending", "done-second", "partial"], "排序不应修改原数组");

console.log("task status tests passed");
