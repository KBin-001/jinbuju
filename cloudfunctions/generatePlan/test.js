const assert = require("assert");
const { buildFallbackPlan } = require("./fallback");
const { addBusinessDays } = require("./date");
const { validateGoal, validatePlan } = require("./validate");
const { getDayStatus, getTaskState } = require("./plan-rules");

const categories = ["exam", "skill", "career"];
const weeklyDaysOptions = [3, 5, 7];
const minuteOptions = [15, 45, 120];

for (const category of categories) {
  for (const weeklyDays of weeklyDaysOptions) {
    for (const dailyMinutes of minuteOptions) {
      const goal = validateGoal({
        category,
        goalTitle: "测试成长目标",
        goalTemplate: "test",
        currentLevel: "zero",
        deadline: "2099-12-31",
        weeklyDays,
        dailyMinutes,
        intensity: "normal",
      });
      const plan = validatePlan(buildFallbackPlan(goal), goal);
      assert.strictEqual(plan.days.length, 7);
      assert.strictEqual(
        plan.days.filter((day) => day.isStudyDay).length,
        weeklyDays,
      );
    }
  }
}

assert.throws(
  () =>
    validateGoal({
      category: "skill",
      goalTitle: "<script>alert(1)</script>",
      goalTemplate: "test",
      currentLevel: "zero",
      deadline: "2099-12-31",
      weeklyDays: 5,
      dailyMinutes: 45,
      intensity: "normal",
    }),
  /具体目标/,
);

assert.strictEqual(getDayStatus("active", "2026-06-15", "2026-06-15", 0, 2), "today");
assert.strictEqual(getDayStatus("active", "2026-06-14", "2026-06-15", 1, 2), "partial");
assert.strictEqual(getDayStatus("paused", "2026-06-16", "2026-06-15", 0, 2), "paused");
assert.strictEqual(
  getTaskState("active", { status: "pending", taskDate: "2026-06-14" }, "2026-06-15"),
  "expired",
);

const nextWeekGoal = validateGoal({
  category: "skill",
  goalTitle: "继续练习 TypeScript",
  goalTemplate: "test",
  currentLevel: "basic",
  deadline: "2099-12-31",
  weeklyDays: 5,
  dailyMinutes: 45,
  intensity: "normal",
});
const nextWeekPlan = validatePlan(
  buildFallbackPlan(nextWeekGoal, "2026-06-30"),
  nextWeekGoal,
  "2026-06-30",
);
assert.strictEqual(nextWeekPlan.days[0].date, "2026-06-30");
assert.strictEqual(nextWeekPlan.days[6].date, "2026-07-06");
assert.strictEqual(addBusinessDays("2026-06-30", 1), "2026-07-01");
assert.strictEqual(
  getTaskState("paused", { status: "pending", taskDate: "2026-06-15" }, "2026-06-15"),
  "paused",
);
assert.strictEqual(
  getTaskState(
    "active",
    { status: "pending", taskDate: "2026-06-14", postponed: true },
    "2026-06-15",
  ),
  "expired",
);

console.log("generatePlan tests passed");
