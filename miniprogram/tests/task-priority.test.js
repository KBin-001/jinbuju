const assert = require("node:assert/strict");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, filename);
};

const { groupTasksByPriority } = require("../utils/taskPriority.ts");

const today = "2026-07-25";
const baseContext = { today, currentStreakDays: 0 };

let seq = 0;
function makeTask(overrides) {
  seq += 1;
  return {
    id: `task_${seq}`,
    title: "背单词 30 个",
    status: "pending",
    currentDate: today,
    estimatedMinutes: 30,
    source: "manual",
    ...overrides,
  };
}

function findGroup(groups, key) {
  return groups.find((g) => g.key === key);
}
function groupKeys(groups) {
  return groups.map((g) => g.key);
}

// 1. 空列表返回空数组
assert.deepEqual(groupTasksByPriority([], baseContext), [], "空列表返回空数组");

// 2. 单个普通任务（无特殊属性，未来日期）只产生一个非空分组，默认进入"稍后安排"
const singleWeak = groupTasksByPriority(
  [makeTask({ currentDate: "2026-07-28" })],
  baseContext,
);
assert.equal(singleWeak.length, 1, "单个弱依据任务只产生一个分组");
assert.equal(singleWeak[0].key, "later", "弱依据任务默认进入稍后安排");

// 3. 单个必须完成且今天截止的任务只产生"今日重点"一个分组
const singleFocus = groupTasksByPriority(
  [makeTask({ importance: "required", currentDate: today })],
  baseContext,
);
assert.equal(singleFocus.length, 1, "单个强依据任务只产生一个分组");
assert.equal(singleFocus[0].key, "focus", "必须完成且今天截止的任务进入今日重点");

// 4. importance = "required" 的任务优先分高于 importance = "normal"
const normalTask = makeTask({ id: "normal_a", currentDate: today, estimatedMinutes: 30 });
const requiredTask = makeTask({ id: "required_a", importance: "required", currentDate: today, estimatedMinutes: 30 });
const mixedGroups = groupTasksByPriority([normalTask, requiredTask], baseContext);
const focusG = findGroup(mixedGroups, "focus");
assert.ok(focusG, "存在今日重点分组");
assert.ok(
  focusG.tasks.some((t) => t.id === "required_a"),
  "required 任务应在今日重点中",
);
assert.ok(
  !focusG.tasks.some((t) => t.id === "normal_a"),
  "normal 任务不应在今日重点中（当 required 任务存在时）",
);

// 5. currentDate === today 的任务比未来任务排序靠前
const todayTask = makeTask({ id: "today_task", currentDate: today, estimatedMinutes: 30 });
const futureTask = makeTask({ id: "future_task", currentDate: "2026-07-28", estimatedMinutes: 30 });
const dateGroups = groupTasksByPriority([futureTask, todayTask], baseContext);
const quickG = findGroup(dateGroups, "quick");
assert.ok(quickG, "存在快速推进分组");
assert.ok(
  quickG.tasks.some((t) => t.id === "today_task"),
  "今天截止的任务进入快速推进",
);
assert.ok(
  !quickG.tasks.some((t) => t.id === "future_task"),
  "未来任务不进入快速推进（优先分不足）",
);

// 6. estimatedMinutes > 40 的任务不进入"快速推进"，即使优先分中等
const longTask = makeTask({ id: "long_task", currentDate: today, estimatedMinutes: 90 });
const longGroups = groupTasksByPriority([longTask], baseContext);
assert.ok(
  !findGroup(longGroups, "quick"),
  "90 分钟任务不进入快速推进",
);
assert.ok(
  longGroups.some((g) => g.tasks.some((t) => t.id === "long_task")),
  "90 分钟任务应在某个分组中",
);

// 7. "今日重点"最多 2 个
const threeRequired = [
  makeTask({ id: "req_1", importance: "required", currentDate: today }),
  makeTask({ id: "req_2", importance: "required", currentDate: today }),
  makeTask({ id: "req_3", importance: "required", currentDate: today }),
];
const threeGroups = groupTasksByPriority(threeRequired, baseContext);
const threeFocus = findGroup(threeGroups, "focus");
assert.ok(threeFocus, "存在今日重点");
assert.ok(threeFocus.tasks.length <= 2, "今日重点最多 2 个");
// 超出的任务不丢失
const allTaskIds = threeGroups.flatMap((g) => g.tasks.map((t) => t.id));
assert.ok(allTaskIds.includes("req_3"), "超额的 required 任务降级到其他分组，不丢失");

// 8. "快速推进"最多 3 个
const quickTasks = Array.from({ length: 5 }, (_, i) =>
  makeTask({ id: `q_${i}`, currentDate: today, estimatedMinutes: 30 }),
);
const quickGroups = groupTasksByPriority(quickTasks, baseContext);
const quickGroup = findGroup(quickGroups, "quick");
assert.ok(quickGroup, "存在快速推进");
assert.ok(quickGroup.tasks.length <= 3, "快速推进最多 3 个");
// 超出的任务不丢失
const allQuickIds = quickGroups.flatMap((g) => g.tasks.map((t) => t.id));
assert.equal(allQuickIds.length, 5, "5 个任务全部在分组中，无丢失");

// 9. 依据不足时默认进入"稍后安排"
const noBasisTask = makeTask({ id: "no_basis", currentDate: "2026-07-28", estimatedMinutes: 60, source: "manual" });
const noBasisGroups = groupTasksByPriority([noBasisTask], baseContext);
assert.equal(noBasisGroups.length, 1, "依据不足只产生一个分组");
assert.equal(noBasisGroups[0].key, "later", "依据不足默认进入稍后安排");

// 10. priorityOverride = "focus" 直接进入"今日重点"
const focusOverride = makeTask({ id: "override_f", priorityOverride: "focus", currentDate: "2026-07-28" });
const overrideFGroups = groupTasksByPriority([focusOverride], baseContext);
assert.equal(overrideFGroups.length, 1, "focus override 只产生一个分组");
assert.equal(overrideFGroups[0].key, "focus", "priorityOverride=focus 直接进入今日重点");
assert.ok(
  overrideFGroups[0].tasks[0].priorityReasons.some((r) => r.label === "手动置顶"),
  "override 任务理由包含'手动置顶'",
);

// 11. priorityOverride = "quick" 直接进入"快速推进"
const quickOverride = makeTask({ id: "override_q", priorityOverride: "quick", estimatedMinutes: 90 });
const overrideQGroups = groupTasksByPriority([quickOverride], baseContext);
assert.equal(overrideQGroups.length, 1, "quick override 只产生一个分组");
assert.equal(overrideQGroups[0].key, "quick", "priorityOverride=quick 直接进入快速推进（即使超过 40 分钟）");

// 12. priorityOverride = "later" 直接进入"稍后安排"
const laterOverride = makeTask({ id: "override_l", priorityOverride: "later", currentDate: today, importance: "required" });
const overrideLGroups = groupTasksByPriority([laterOverride], baseContext);
assert.equal(overrideLGroups.length, 1, "later override 只产生一个分组");
assert.equal(overrideLGroups[0].key, "later", "priorityOverride=later 直接进入稍后安排（即使其他维度高分）");

// 13. 超额 override 任务降级不丢失
const threeFocusOverrides = [
  makeTask({ id: "of_1", priorityOverride: "focus" }),
  makeTask({ id: "of_2", priorityOverride: "focus" }),
  makeTask({ id: "of_3", priorityOverride: "focus" }),
];
const threeOverrideGroups = groupTasksByPriority(threeFocusOverrides, baseContext);
const threeOverrideFocus = findGroup(threeOverrideGroups, "focus");
assert.ok(threeOverrideFocus, "存在今日重点");
assert.equal(threeOverrideFocus.tasks.length, 2, "今日重点最多 2 个 override 任务");
const allOverrideIds = threeOverrideGroups.flatMap((g) => g.tasks.map((t) => t.id));
assert.ok(allOverrideIds.includes("of_3"), "第 3 个 focus override 降级到其他分组，不丢失");

// 14. 理由标签：今天截止的高分任务理由包含"今天截止"
const dueTodayTask = makeTask({ id: "due_today", importance: "required", currentDate: today });
const dueTodayGroups = groupTasksByPriority([dueTodayTask], baseContext);
const dueTodayFocusTask = dueTodayGroups[0].tasks[0];
assert.ok(
  dueTodayFocusTask.priorityReasons.some((r) => r.label === "今天截止"),
  "今天截止的任务理由包含'今天截止'",
);

// 15. 理由标签：currentStreakDays >= 6 时理由包含"已连续行动 N 天"
const streakContext = { today, currentStreakDays: 7 };
const streakTask = makeTask({ id: "streak_task", priorityOverride: "focus" });
const streakGroups = groupTasksByPriority([streakTask], streakContext);
const streakFocusTask = streakGroups[0].tasks[0];
assert.ok(
  streakFocusTask.priorityReasons.some((r) => r.label === "已连续行动 7 天"),
  "连续行动 7 天时理由包含'已连续行动 7 天'",
);

// 16. 分组标题和提示文案正确
const titleCheckTask = makeTask({ importance: "required", currentDate: today });
const titleGroups = groupTasksByPriority([titleCheckTask], baseContext);
assert.equal(titleGroups[0].title, "今日重点", "focus 分组标题为'今日重点'");
assert.equal(titleGroups[0].hint, "推进核心目标", "focus 分组提示为'推进核心目标'");

const quickTitleTask = makeTask({ currentDate: today, estimatedMinutes: 30 });
const quickTitleGroups = groupTasksByPriority([quickTitleTask], baseContext);
const quickTitleGroup = findGroup(quickTitleGroups, "quick");
if (quickTitleGroup) {
  assert.equal(quickTitleGroup.title, "快速推进", "quick 分组标题为'快速推进'");
  assert.equal(quickTitleGroup.hint, "适合现在开始", "quick 分组提示为'适合现在开始'");
}

const laterTitleTask = makeTask({ currentDate: "2026-07-28", estimatedMinutes: 60 });
const laterTitleGroups = groupTasksByPriority([laterTitleTask], baseContext);
assert.equal(laterTitleGroups[0].title, "稍后安排", "later 分组标题为'稍后安排'");
assert.equal(laterTitleGroups[0].hint, "已为你安排到专注时段", "later 分组提示为'已为你安排到专注时段'");

// 17. 清除覆盖（priorityOverride = null）后回到自动评分
const overrideThenCleared = makeTask({ id: "cleared", priorityOverride: null, importance: "required", currentDate: today });
const clearedGroups = groupTasksByPriority([overrideThenCleared], baseContext);
// importance=required + currentDate=today 应回到"今日重点"
assert.equal(clearedGroups.length, 1, "清除覆盖后只产生一个分组");
assert.equal(clearedGroups[0].key, "focus", "清除覆盖后必须完成的任务回到今日重点");
assert.ok(
  !clearedGroups[0].tasks[0].priorityReasons.some((r) => r.label === "手动置顶"),
  "清除覆盖后理由不再包含'手动置顶'",
);
assert.ok(
  clearedGroups[0].tasks[0].priorityReasons.some((r) => r.label === "必须完成"),
  "清除覆盖后理由应包含'必须完成'",
);

// 18. 理由标签最多 2 个（即使触发多个条件）
const multiReasonTask = makeTask({
  id: "multi_reason",
  importance: "required",
  currentDate: today,
  source: "ai",
  blocksOthers: true,
});
const multiContext = { today, currentStreakDays: 7, goalTargetDate: "2026-07-28" };
const multiGroups = groupTasksByPriority([multiReasonTask], multiContext);
const multiTask = multiGroups[0].tasks[0];
assert.ok(
  multiTask.priorityReasons.length <= 2,
  "理由标签最多 2 个，实际为 " + multiTask.priorityReasons.length,
);
// "手动置顶"不存在（非 override），"今天截止"应优先于"推进核心目标"
assert.ok(
  multiTask.priorityReasons.some((r) => r.label === "今天截止"),
  "多条件任务理由应包含'今天截止'（优先级高）",
);

console.log("task priority tests passed");
