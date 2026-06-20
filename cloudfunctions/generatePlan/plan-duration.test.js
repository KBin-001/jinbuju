const assert = require("assert");
const {
  attachPlanMetadata,
  buildBaseStagePlan,
  buildPlanOutline,
  getStageTimeoutBudget,
  validateCreateStagePreviewInput,
} = require("./stage-v2");
const { normalizeManualTask } = require("./home");
const { selectRolloverTasks } = require("./plan-management");
const { plannedExecutionDays } = require("./plan-window");

function input(days) {
  return {
    templateId: "python",
    customGoalTitle: "",
    currentLevel: "zero",
    dailyMinutes: 30,
    weeklyDays: 5,
    intensity: "normal",
    durationDays: days,
    planDurationDays: days,
    deadline: "",
  };
}

for (const days of [7, 14, 21, 30, 90]) {
  const normalized = validateCreateStagePreviewInput(input(days));
  assert.strictEqual(normalized.planDurationDays, days);
  assert.strictEqual(normalized.durationDays, days);
}

for (const days of [2, 91]) {
  assert.throws(() => validateCreateStagePreviewInput(input(days)), /3～90/);
}

const normalized30 = validateCreateStagePreviewInput(input(30));
const complete30 = buildBaseStagePlan(normalized30);
const plan30 = attachPlanMetadata(complete30, normalized30);
assert.strictEqual(plan30.stage.planDurationDays, 30);
assert.strictEqual(plan30.days.length, 30);
assert.strictEqual(plan30.outline.totalDays, 30);
assert.strictEqual(plan30.outline.blocks.length, 5);
assert.strictEqual(plan30.outline.blocks.at(-1).startDay, 29);
assert.strictEqual(plan30.outline.blocks.at(-1).endDay, 30);
assert.match(plan30.outline.blocks.at(-1).objective, /成果|验证|复盘/);
assert.strictEqual(new Set(plan30.outline.blocks.map((block) => block.focus)).size, 5);

const normalized14 = validateCreateStagePreviewInput(input(14));
assert.strictEqual(buildBaseStagePlan(normalized14).days.length, 14);
assert.strictEqual(buildPlanOutline(14, "练习").blocks.length, 2);

const normalized90 = validateCreateStagePreviewInput(input(90));
const plan90 = attachPlanMetadata(buildBaseStagePlan(normalized90), normalized90);
assert.strictEqual(plan90.days.length, 90);
assert.strictEqual(plan90.outline.blocks.length, 13);
assert.ok(plan90.days.every((day) => day.actions.length <= 1));

const highBudget90 = validateCreateStagePreviewInput({ ...input(90), dailyMinutes: 360 });
const highBudgetPlan = buildBaseStagePlan(highBudget90);
assert.ok(highBudgetPlan.days.flatMap((day) => day.actions).every((action) => action.estimatedMinutes <= 180));
assert.strictEqual(plannedExecutionDays(30, 5).length, 22);
assert.strictEqual(plannedExecutionDays(90, 5).length, 65);
assert.strictEqual(plannedExecutionDays(90, 3).length, 39);
assert.deepStrictEqual(getStageTimeoutBudget(7), {
  generation: 45000,
  repair: 30000,
  optimization: 30000,
});
assert.deepStrictEqual(getStageTimeoutBudget(30), {
  generation: 90000,
  repair: 60000,
  optimization: 60000,
});
assert.deepStrictEqual(getStageTimeoutBudget(90), {
  generation: 180000,
  repair: 120000,
  optimization: 120000,
});

const legacy = validateCreateStagePreviewInput({ ...input(7), planDurationDays: undefined });
assert.strictEqual(legacy.planDurationDays, 7);

const rollover = selectRolloverTasks(
  [
    { _id: "new", status: "pending", taskDate: "2026-06-19" },
    { _id: "old", status: "pending", currentDate: "2026-06-17" },
    { _id: "done", status: "completed", taskDate: "2026-06-16" },
    { _id: "today", status: "pending", taskDate: "2026-06-20" },
  ],
  "2026-06-20",
  1,
);
assert.deepStrictEqual(rollover.map((task) => task._id), ["old"]);

const manual = normalizeManualTask({
  requestId: "manual-test-request",
  planId: "plan-test",
  title: "补充一次练习",
  description: "记录本次练习结果",
  taskDate: "2026-06-20",
  estimatedMinutes: 20,
});
assert.strictEqual(manual.title, "补充一次练习");
assert.strictEqual(manual.estimatedMinutes, 20);
assert.strictEqual(manual.repeatType, "none");
assert.throws(
  () => normalizeManualTask({ requestId: "manual-test-request", title: "短", taskDate: "2026-06-20" }),
  /2～40/,
);

console.log("plan duration tests passed");
