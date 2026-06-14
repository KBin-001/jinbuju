const assert = require("assert");
const { buildFallbackPlan } = require("./fallback");
const { validateGoal, validatePlan } = require("./validate");

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

console.log("generatePlan tests passed");
