const assert = require("node:assert/strict");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, filename);
};

const { getActionTaskDisplayStatus, groupTodayTasks, isCarryOverTask } = require("../utils/taskStatus.ts");
const { getTodayBusinessDate } = require("../utils/date.ts");
const today = "2026-06-21";

assert.equal(getTodayBusinessDate(new Date("2026-06-20T16:00:00.000Z")), today);

assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "pending" }, today), { text: "待开始", tone: "success" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: "2026-06-22", status: "pending" }, today), { text: "未到日期", tone: "muted" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: "2026-06-20", status: "pending" }, today), { text: "待继续", tone: "warning" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "completed" }, today), { text: "已完成", tone: "success" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: "2026-06-20", status: "partially_completed" }, today), { text: "完成一部分", tone: "neutral", badge: "待继续" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "skipped" }, today), { text: "今天不做", tone: "muted" });
assert.deepEqual(getActionTaskDisplayStatus({ currentDate: today, status: "rescheduled" }, today), { text: "已顺延", tone: "muted" });

const carried = { currentDate: today, plannedDate: "2026-06-20", status: "pending" };
assert.equal(isCarryOverTask(carried), true);
assert.deepEqual(getActionTaskDisplayStatus(carried, today), { text: "待开始", tone: "success" });

const groups = groupTodayTasks([
  carried,
  { currentDate: "2026-06-20", status: "pending" },
  { currentDate: "2026-06-22", status: "pending" },
], today);
assert.deepEqual(groups.map((group) => [group.key, group.tasks.length]), [["today", 1], ["continue", 1]]);

console.log("task status tests passed");
