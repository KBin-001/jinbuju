const assert = require("assert");
const { buildFallbackPlan } = require("./fallback");
const { addBusinessDays } = require("./date");
const { validateGoal, validatePlan } = require("./validate");
const { getDayStatus, getTaskState } = require("./plan-rules");
const {
  ENCOURAGEMENT_TYPES,
  isValidEncouragementType,
  publicMemberId,
} = require("./team-rules");
const { buildBadges, isCommunityUnlocked } = require("./profile-rules");
const { buildStageFallback } = require("./stage-fallback");
const {
  parseStageAiJson,
  validateStageGenerationInput,
  validateStagePlan,
  validateStageRequestId,
} = require("./stage-validate");
const {
  GOAL_TEMPLATES,
  buildBaseStagePlan,
  isExecutionDay,
  mergeOptimizationPlan,
  validateCreateStagePreviewInput,
  validateOptimizedPlan,
} = require("./stage-v2");

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
assert.strictEqual(getDayStatus("active", "2026-06-15", "2026-06-15", 0, 0), "rest");
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
assert.strictEqual(ENCOURAGEMENT_TYPES.length, 4);
assert.strictEqual(isValidEncouragementType("keep_going"), true);
assert.strictEqual(isValidEncouragementType("custom_message"), false);
assert.match(publicMemberId("team_test", "user_test"), /^member_[a-f0-9]{24}$/);
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
const badges = buildBadges({
  checkinDays: 3,
  longestStreak: 3,
  completedStages: 0,
});
assert.strictEqual(badges.find((badge) => badge.code === "first_checkin").unlocked, true);
assert.strictEqual(badges.find((badge) => badge.code === "streak_7").unlocked, false);
assert.strictEqual(
  isCommunityUnlocked({
    hasCurrentGoal: true,
    totalCheckinDays: 3,
    longestStreak: 3,
  }),
  true,
);
assert.strictEqual(
  isCommunityUnlocked({
    hasCurrentGoal: false,
    totalCheckinDays: 3,
    longestStreak: 3,
  }),
  false,
);
assert.strictEqual(
  isCommunityUnlocked(
    {
      hasCurrentGoal: false,
      totalCheckinDays: 1,
      longestStreak: 1,
    },
    {
      requiresActiveGoal: false,
      minimumCheckinDays: 1,
      minimumStreakDays: 1,
    },
  ),
  true,
);

const longTermCategories = [
  "exam",
  "skill",
  "career",
  "reading",
  "fitness",
  "habit",
  "other",
];
for (const category of longTermCategories) {
  for (const durationDays of [7, 10, 14, 21, 30]) {
    const input = validateStageGenerationInput({
      goalTitle: "建立长期成长能力",
      category,
      desiredResult: "能够稳定完成每周行动并看到清晰的阶段成果",
      dailyMinutes: 45,
      targetDuration: "3_months",
      stageNumber: 1,
      durationDays,
    });
    const stagePlan = validateStagePlan(buildStageFallback(input), input);
    assert.strictEqual(stagePlan.stage.durationDays, durationDays);
    assert.strictEqual(stagePlan.days.length, durationDays);
    stagePlan.days.forEach((day, index) => {
      assert.strictEqual(day.dayIndex, index + 1);
      assert.ok(day.actions.length >= 1 && day.actions.length <= 4);
      assert.ok(day.totalMinutes <= Math.ceil(input.dailyMinutes * 1.2));
    });
  }
}

const templateIds = Object.keys(GOAL_TEMPLATES);
assert.strictEqual(templateIds.length, 8);
for (const templateId of templateIds) {
  for (const currentLevel of ["zero", "basic", "intermediate"]) {
    for (const dailyMinutes of [15, 30, 45, 60, 90]) {
      for (const weeklyDays of [3, 5, 7]) {
        for (const intensity of ["light", "normal", "intensive"]) {
          for (const durationDays of [7, 21, 30]) {
            const input = validateCreateStagePreviewInput({
              templateId,
              customGoalTitle: templateId === "custom" ? "学习基础摄影" : undefined,
              currentLevel,
              dailyMinutes,
              weeklyDays,
              intensity,
              durationDays,
              deadline: "2099-12-31",
            });
            const plan = buildBaseStagePlan(input);
            assert.strictEqual(plan.days.length, durationDays);
            plan.days.forEach((day) => {
              const active = isExecutionDay(day.dayIndex, weeklyDays);
              assert.strictEqual(day.actions.length, active ? 1 : 0);
              if (active) {
                assert.strictEqual(day.actions[0].slotId, `slot_day_${day.dayIndex}`);
                assert.ok(day.actions[0].estimatedMinutes <= dailyMinutes);
              }
            });
          }
        }
      }
    }
  }
}

const v2Input = validateCreateStagePreviewInput({
  templateId: "python",
  currentLevel: "zero",
  dailyMinutes: 30,
  weeklyDays: 5,
  intensity: "normal",
  durationDays: 30,
  deadline: "2099-12-31",
});
const v2BasePlan = buildBaseStagePlan(v2Input);
assert.strictEqual(v2BasePlan.days[28].actions.length, 1);
assert.strictEqual(v2BasePlan.days[29].actions.length, 1);
assert.deepStrictEqual(
  validateOptimizedPlan(JSON.parse(JSON.stringify(v2BasePlan)), v2Input, v2BasePlan),
  v2BasePlan,
);
const changedExecutionDay = JSON.parse(JSON.stringify(v2BasePlan));
changedExecutionDay.days[3].actions = [
  {
    slotId: "slot_day_4",
    title: "不应出现的任务",
    description: "AI 不得在休息日增加任务",
    estimatedMinutes: 30,
  },
];
assert.throws(
  () => validateOptimizedPlan(changedExecutionDay, v2Input, v2BasePlan),
  /执行日/,
);
const changedSlot = JSON.parse(JSON.stringify(v2BasePlan));
changedSlot.days[0].actions[0].slotId = "slot_day_2";
assert.throws(
  () => validateOptimizedPlan(changedSlot, v2Input, v2BasePlan),
  /任务内容/,
);
const editedBase = JSON.parse(JSON.stringify(v2BasePlan));
editedBase.days[0].actions[0].title = "用户手工编辑的任务";
const optimizedCandidate = JSON.parse(JSON.stringify(v2BasePlan));
optimizedCandidate.stage.title = "AI 优化后的计划";
optimizedCandidate.days[0].actions[0].title = "AI 修改的第一天";
optimizedCandidate.days[1].actions[0].title = "AI 修改的第二天";
const mergedCandidate = mergeOptimizationPlan(
  editedBase,
  optimizedCandidate,
  ["slot_day_1"],
);
assert.strictEqual(mergedCandidate.stage.title, "AI 优化后的计划");
assert.strictEqual(mergedCandidate.days[0].actions[0].title, "用户手工编辑的任务");
assert.strictEqual(mergedCandidate.days[1].actions[0].title, "AI 修改的第二天");
assert.throws(
  () =>
    validateCreateStagePreviewInput({
      templateId: "custom",
      customGoalTitle: "",
      currentLevel: "zero",
      dailyMinutes: 30,
      weeklyDays: 5,
      intensity: "normal",
      durationDays: 7,
    }),
  /自定义目标/,
);
assert.throws(
  () =>
    validateCreateStagePreviewInput({
      templateId: "python",
      currentLevel: "zero",
      dailyMinutes: 30,
      weeklyDays: 5,
      intensity: "normal",
      durationDays: 7,
      deadline: "2026-99-99",
    }),
  /截止日期/,
);

const stageInput = validateStageGenerationInput({
  goalTitle: "通过英语四级",
  category: "exam",
  desiredResult: "能够达到英语四级考试合格水平并稳定完成练习",
  dailyMinutes: 30,
  targetDuration: "3_months",
  stageNumber: 1,
  durationDays: 7,
});
const validStageJson = JSON.stringify(buildStageFallback(stageInput));
assert.deepStrictEqual(
  validateStagePlan(parseStageAiJson(`\`\`\`json\n${validStageJson}\n\`\`\``), stageInput),
  validateStagePlan(JSON.parse(validStageJson), stageInput),
);
assert.throws(
  () =>
    validateStageGenerationInput({
      ...stageInput,
      desiredResult: "短",
    }),
  /期望结果/,
);
assert.throws(
  () =>
    validateStageGenerationInput({
      ...stageInput,
      stageNumber: 2,
    }),
  /阶段编号/,
);
assert.throws(
  () =>
    validateStageGenerationInput({
      ...stageInput,
      previousReview: {
        completionRate: 100,
      },
    }),
  /不支持的字段/,
);
const nextStageInput = validateStageGenerationInput(
  {
    ...stageInput,
    stageNumber: 2,
    previousReview: {
      completionRate: 68,
      actionDays: 5,
      previousFocus: "建立词汇与听力基础",
      difficulty: "suitable",
      nextPreference: "same",
      focusAdjustment: "",
    },
  },
  true,
);
assert.strictEqual(nextStageInput.stageNumber, 2);
assert.strictEqual(nextStageInput.previousReview.actionDays, 5);
assert.throws(
  () => validateStageRequestId("plan_wrong_prefix"),
  /请求标识/,
);
assert.strictEqual(
  validateStageRequestId("stage_12345678_test"),
  "stage_12345678_test",
);

const invalidExtraField = buildStageFallback(stageInput);
invalidExtraField.stage.extra = "not allowed";
assert.throws(
  () => validateStagePlan(invalidExtraField, stageInput),
  /阶段信息结构/,
);

const invalidDayCount = buildStageFallback(stageInput);
invalidDayCount.days.pop();
assert.throws(
  () => validateStagePlan(invalidDayCount, stageInput),
  /阶段周期/,
);

const invalidDayIndex = buildStageFallback(stageInput);
invalidDayIndex.days[1].dayIndex = 4;
assert.throws(
  () => validateStagePlan(invalidDayIndex, stageInput),
  /日期序号/,
);

const invalidMinutes = buildStageFallback(stageInput);
invalidMinutes.days[0].actions = [
  {
    title: "完成一组核心词汇练习",
    description: "学习词汇并完成对应测试题，记录正确率。",
    estimatedMinutes: 37,
  },
];
assert.throws(
  () => validateStagePlan(invalidMinutes, stageInput),
  /总时长/,
);

const duplicateAction = buildStageFallback(stageInput);
duplicateAction.days[1].actions[0].title =
  duplicateAction.days[0].actions[0].title;
assert.throws(
  () => validateStagePlan(duplicateAction, stageInput),
  /重复行动/,
);

const vagueAction = buildStageFallback(stageInput);
vagueAction.days[0].actions[0].title = "努力学习";
assert.throws(
  () => validateStagePlan(vagueAction, stageInput),
  /过于空泛/,
);

console.log("generatePlan tests passed");
