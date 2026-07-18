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
const {
  USER_OWNED_COLLECTIONS,
  buildBadges,
  isCommunityUnlocked,
} = require("./profile-rules");
const { buildStageFallback } = require("./stage-fallback");
const { mapStageActionToTaskFields } = require("./stage-task");
const {
  fallbackAnalysis,
  buildGoalProfile: buildClarifiedGoalProfile,
  validateAnswers,
  validateGoalAnalysisResult,
} = require("./goal-analysis");
const {
  evaluateStagePlanQuality,
  parseStageAiJson,
  validateGeneratedStagePlan,
  validateStageGenerationInput,
  validateStagePlan,
  validateStageRequestId,
} = require("./stage-validate");
const {
  GOAL_TEMPLATES,
  buildBaseStagePlan,
  buildGoalProfile,
  isExecutionDay,
  mergeOptimizationPlan,
  validateCreateStagePreviewInput,
  validateOptimizedPlan,
} = require("./stage-v2");
const { TEMPLATES: NOTIFICATION_TEMPLATES, SCENES: NOTIFICATION_SCENES } = require("./notification-config");
const { AUTH_RESULTS, RETRYABLE_CODES, assertRequestObject, buildTemplateData, shanghaiParts, validateRequestId: validateNotificationRequestId } = require("./notification");

const persistedStageAction = mapStageActionToTaskFields(
  {
    slotId: "slot_day_2_1",
    title: "完成一次针对性练习",
    description: "按计划完成练习并记录结果。",
    actionType: "practice",
    completionCriteria: "完成 10 道题并订正错题。",
    estimatedMinutes: 30,
    requiredResources: ["练习册", "计时器"],
    safetyNotes: ["感到不适时立即停止"],
  },
  2,
  0,
);
assert.deepStrictEqual(
  {
    actionType: persistedStageAction.actionType,
    completionCriteria: persistedStageAction.completionCriteria,
    requiredResources: persistedStageAction.requiredResources,
    safetyNotes: persistedStageAction.safetyNotes,
  },
  {
    actionType: "practice",
    completionCriteria: "完成 10 道题并订正错题。",
    requiredResources: ["练习册", "计时器"],
    safetyNotes: ["感到不适时立即停止"],
  },
);

const categories = ["exam", "skill", "career"];
const weeklyDaysOptions = [3, 5, 7];
const minuteOptions = [15, 45, 120, 180, 360];

assert.ok(USER_OWNED_COLLECTIONS.includes("goal_analysis_drafts"));
assert.ok(USER_OWNED_COLLECTIONS.includes("stage_preview_versions"));
assert.ok(USER_OWNED_COLLECTIONS.includes("progress_ai_snapshots"));
assert.ok(USER_OWNED_COLLECTIONS.includes("coach_conversations"));
assert.ok(USER_OWNED_COLLECTIONS.includes("coach_messages"));

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
  true,
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
  for (const durationDays of [3, 4, 5, 6, 7]) {
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
assert.strictEqual(templateIds.length, 12);
for (const templateId of templateIds) {
  for (const currentLevel of ["zero", "basic", "intermediate"]) {
    for (const dailyMinutes of [15, 30, 45, 60, 90, 120, 180, 360]) {
      for (const weeklyDays of [3, 5, 7]) {
        for (const intensity of ["light", "normal", "intensive"]) {
          for (const durationDays of [3, 4, 5, 6, 7]) {
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
              const active = isExecutionDay(day.dayIndex, weeklyDays, durationDays);
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
  durationDays: 7,
  deadline: "2099-12-31",
});
const v2BasePlan = buildBaseStagePlan(v2Input);
assert.strictEqual(v2BasePlan.days[5].actions.length, 1);
assert.strictEqual(v2BasePlan.days[6].actions.length, 1);
assert.deepStrictEqual(
  validateOptimizedPlan(JSON.parse(JSON.stringify(v2BasePlan)), v2Input, v2BasePlan),
  v2BasePlan,
);
const changedExecutionDay = JSON.parse(JSON.stringify(v2BasePlan));
changedExecutionDay.days[3].actions = [
  {
    slotId: "slot_day_4",
    title: "不应出现的任务",
    description: "AI 不得改变执行日任务数量",
    estimatedMinutes: 30,
  },
  {
    slotId: "slot_day_4_extra",
    title: "多余的任务",
    description: "AI 不得增加任务数量",
    estimatedMinutes: 15,
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

const combatAnalysis = fallbackAnalysis({
  title: "练出搏击",
  description: "",
  dailyMinutes: 30,
  durationDays: 7,
  currentLevel: "",
  intensity: "normal",
  deadline: "",
});
assert.strictEqual(combatAnalysis.needsClarification, true);
assert.ok(combatAnalysis.questions.length >= 3 && combatAnalysis.questions.length <= 5);
assert.ok(combatAnalysis.questions.some((question) => /什么结果/.test(question.question)));
assert.ok(combatAnalysis.questions.some((question) => /训练经验|水平/.test(question.question)));
assert.ok(combatAnalysis.questions.some((question) => /正规场馆|教练/.test(question.question)));
assert.strictEqual(combatAnalysis.safetyContext.requiresProfessionalGuidance, true);
assert.ok(!combatAnalysis.questions.some((question) => /攻击|打败|伤害/.test(question.question)));

const analysisCandidate = validateGoalAnalysisResult(
  {
    normalizedGoal: "每天睡前阅读20分钟，坚持30天",
    categoryGroup: "habit",
    domainLabel: "阅读习惯",
    goalType: "habit",
    ambiguityScore: 0.1,
    confidenceScore: 0.9,
    needsClarification: false,
    missingDimensions: [],
    questions: [],
    safetyContext: {
      riskLevel: "low",
      requiresProfessionalGuidance: false,
      boundaries: [],
    },
  },
  {
    title: "每天睡前阅读20分钟，坚持30天",
    description: "主要想培养稳定阅读习惯",
    dailyMinutes: 20,
    durationDays: 7,
  },
);
assert.strictEqual(analysisCandidate.needsClarification, false);
assert.strictEqual(analysisCandidate.questions.length, 0);

const combatAnswers = validateAnswers(combatAnalysis.questions, [
  { questionId: "q_desired_outcome", value: "提升体能和协调性" },
  { questionId: "q_current_level", value: "零基础" },
  { questionId: "q_weekly_frequency", value: 3 },
  { questionId: "q_resources", value: true },
]);
const combatProfile = buildClarifiedGoalProfile(
  {
    title: "练出搏击",
    description: "",
    dailyMinutes: 30,
    durationDays: 7,
    currentLevel: "",
    intensity: "normal",
    deadline: "",
  },
  combatAnalysis,
  combatAnswers,
);
assert.match(combatProfile.title, /正规指导|搏击/);
assert.strictEqual(combatProfile.categoryGroup, "health");
assert.strictEqual(combatProfile.weeklyFrequency, 3);
assert.strictEqual(combatProfile.safetyContext.requiresProfessionalGuidance, true);
assert.throws(
  () => validateAnswers(combatAnalysis.questions, [
    { questionId: "q_desired_outcome", value: "无效选项" },
  ]),
  /有效选项|必填/,
);

function buildGeneratedCandidate(profile) {
  return {
    stage: {
      title: `${profile.title.slice(0, 18)}起步阶段`,
      objective: profile.desiredOutcome,
      focus: "完成可验证的低压力起步行动",
      durationDays: profile.durationDays,
      successMetrics: ["完成每日行动并留下可检查结果"],
      assumptions: ["用户每天按设置时间投入"],
    },
    days: Array.from({ length: profile.durationDays }, (_, index) => ({
      dayIndex: index + 1,
      theme: `第${index + 1}天推进`,
      isRestDay: false,
      actions: [
        {
          title: `完成第${index + 1}个实践行动`,
          actionType: profile.categoryGroup === "health" ? "preparation" : "practice",
          description:
            profile.categoryGroup === "health"
              ? "完成安全筛选、基础体能或正规指导相关准备，避免自行高风险训练。"
              : "完成一个能看见结果的小步骤，并保存当天产出。",
          completionCriteria:
            profile.categoryGroup === "health"
              ? "写下完成内容、身体反馈和下一步正规指导安排。"
              : "留下作品、练习结果、清单或复盘记录。",
          estimatedMinutes: Math.min(30, profile.dailyMinutes),
          requiredResources:
            profile.categoryGroup === "health" ? ["正规场馆信息", "舒适运动装备"] : ["纸笔或手机"],
          safetyNotes:
            profile.categoryGroup === "health"
              ? ["涉及专业训练应在正规场馆和合格教练指导下进行"]
              : [],
        },
      ],
    })),
  };
}

const directGoalTitles = [
  "通过英语四级",
  "零基础学习摄影",
  "完成个人博客",
  "准备第一次求职",
  "建立阅读习惯",
  "学习家庭烹饪基础",
  "改善作息",
  "在正规指导下学习搏击运动基础",
  "制作一个微信小程序",
  "学习 Android 驱动开发",
];
for (const title of directGoalTitles) {
  const input = validateCreateStagePreviewInput({
    templateId: "custom",
    customGoalTitle: title,
    currentLevel: "zero",
    dailyMinutes: 45,
    weeklyDays: 5,
    intensity: "normal",
    durationDays: 7,
  });
  const profile = buildGoalProfile(input);
  const plan = validateGeneratedStagePlan(buildGeneratedCandidate(profile), profile);
  const quality = evaluateStagePlanQuality(plan, profile);
  assert.strictEqual(plan.days.length, 7);
  assert.strictEqual(quality.shouldRepair, false, `${title}: ${quality.problems.join(",")}`);
  assert.ok(plan.days.every((day) => day.totalMinutes <= Math.ceil(profile.dailyMinutes * 1.2)));
  assert.ok(plan.days.every((day) => day.actions[0].completionCriteria));
}

const boxingInput = validateCreateStagePreviewInput({
  templateId: "custom",
  customGoalTitle: "在正规指导下学习搏击运动基础",
  currentLevel: "zero",
  dailyMinutes: 45,
  weeklyDays: 5,
  intensity: "normal",
  durationDays: 7,
});
const boxingProfile = buildGoalProfile(boxingInput);
const boxingPlan = validateGeneratedStagePlan(buildGeneratedCandidate(boxingProfile), boxingProfile);
const boxingQuality = evaluateStagePlanQuality(boxingPlan, boxingProfile);
assert.strictEqual(boxingQuality.shouldRepair, false);
assert.ok(
  boxingPlan.days.some((day) =>
    day.actions.some((action) => /正规|教练|场馆/.test(action.description + action.safetyNotes.join(""))),
  ),
);

const passivePlan = buildGeneratedCandidate(boxingProfile);
passivePlan.days.forEach((day, index) => {
  day.actions[0].title = `观看搏击资料${index + 1}`;
  day.actions[0].actionType = "learning";
  day.actions[0].description = "观看搏击视频并记录相关知识。";
  day.actions[0].completionCriteria = "写下三条知识点。";
  day.actions[0].safetyNotes = [];
});
const passiveQuality = evaluateStagePlanQuality(
  validateGeneratedStagePlan(passivePlan, boxingProfile),
  boxingProfile,
);
assert.strictEqual(passiveQuality.shouldRepair, true);

const indexLearningInput = validateCreateStagePreviewInput({
  templateId: "custom",
  customGoalTitle: "系统学习沪深300指数",
  currentLevel: "basic",
  dailyMinutes: 30,
  weeklyDays: 7,
  intensity: "normal",
  durationDays: 7,
});
const indexLearningProfile = buildGoalProfile(indexLearningInput);
const indexLearningPlan = buildGeneratedCandidate(indexLearningProfile);
indexLearningPlan.days.forEach((day, index) => {
  day.actions[0].title = `阅读第${index + 1}个指数主题并完成练习`;
  day.actions[0].actionType = "learning";
  day.actions[0].description = "阅读基础资料，完成一份对比表或计算练习并保存结果。";
  day.actions[0].completionCriteria = "完成资料阅读，并留下可检查的表格或练习结果。";
});
const indexLearningQuality = evaluateStagePlanQuality(
  validateGeneratedStagePlan(indexLearningPlan, indexLearningProfile),
  indexLearningProfile,
);
assert.strictEqual(
  indexLearningQuality.shouldRepair,
  false,
  indexLearningQuality.problems.join(","),
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

const videoEditingReviewInput = validateStageGenerationInput(
  {
    ...stageInput,
    goalTitle: "剪映视频剪辑",
    desiredResult: "完成一个完整的原创视频作品并掌握基础剪辑流程",
    dailyMinutes: 60,
    weeklyDays: 5,
    stageNumber: 3,
    previousReview: {
      completionRate: 14,
      actionDays: 1,
      previousFocus: "视频跟读、镜前模仿和复盘",
      difficulty: "suitable",
      nextPreference: "change_focus",
      focusAdjustment:
        "下一阶段只做视频剪辑：整理素材、完成粗剪、补字幕和音频、导出小样。不要安排英语口语、跟读或镜前练习。",
    },
  },
  true,
);
const videoEditingReviewFallback = validateStagePlan(
  buildStageFallback(videoEditingReviewInput),
  videoEditingReviewInput,
);
assert.match(videoEditingReviewFallback.stage.title, /视频剪辑/);
assert.doesNotMatch(
  JSON.stringify(videoEditingReviewFallback),
  /口语跟读|镜前练习|美剧片段/,
);
assert.strictEqual(
  videoEditingReviewFallback.days.filter((day) => day.actions.length > 0).length,
  5,
);
const aiPlanWithRestDayAction = JSON.parse(JSON.stringify(videoEditingReviewFallback));
aiPlanWithRestDayAction.days[3].actions = [
  {
    title: "AI 多生成的休息日任务",
    description: "该行动应由可信服务端清空，保持每周五天执行设置。",
    estimatedMinutes: 20,
  },
];
const normalizedRestDayPlan = validateStagePlan(
  aiPlanWithRestDayAction,
  videoEditingReviewInput,
);
assert.strictEqual(normalizedRestDayPlan.days[3].actions.length, 0);

assert.deepStrictEqual(Array.from(AUTH_RESULTS).sort(), ["accept", "ban", "filter", "reject"]);
assert.deepStrictEqual(Array.from(RETRYABLE_CODES).sort((a, b) => a - b), [-1, 45009]);
assert.strictEqual(NOTIFICATION_TEMPLATES[NOTIFICATION_SCENES.DAILY_ACTION].enabled, false);
assert.strictEqual(NOTIFICATION_TEMPLATES[NOTIFICATION_SCENES.AI_COACH].configured, false);
assert.strictEqual(NOTIFICATION_TEMPLATES[NOTIFICATION_SCENES.TEAM_ACTIVITY].templateId, "");
assert.deepStrictEqual(
  buildTemplateData(
    { dataKeys: { date: "date1", hint: "thing2" }, maxLengths: { date: 10, hint: 5 } },
    { date: "2026-07-17", hint: "  保持真实行动记录  " },
  ),
  { date1: { value: "2026-07-17" }, thing2: { value: "保持真实行" } },
);
assert.throws(() => buildTemplateData(
  { dataKeys: { hint: "thing1" }, maxLengths: { hint: 20 } },
  { hint: "" },
), (error) => error.code === "NOTIFICATION_INVALID");
assert.deepStrictEqual(
  buildTemplateData(
    { dataKeys: { count: "number1", completedAt: "time2" }, maxLengths: { count: 10, completedAt: 10 } },
    { count: "3", completedAt: "08:05" },
  ),
  { number1: { value: "3" }, time2: { value: "08:05" } },
);
assert.throws(
  () => buildTemplateData({ dataKeys: { count: "number1" }, maxLengths: { count: 10 } }, { count: "3 项" }),
  (error) => error.code === "NOTIFICATION_INVALID",
);
assert.strictEqual(validateNotificationRequestId("n1:2026-07-17:user_abc"), "n1:2026-07-17:user_abc");
assert.throws(() => validateNotificationRequestId("bad id"), (error) => error.code === "NOTIFICATION_INVALID");
assert.doesNotThrow(() => assertRequestObject({ action: "notification.preference" }, "request"));
assert.doesNotThrow(() => assertRequestObject(
  { action: "notification.updatePreference", scene: "daily_action_reminder", enabled: true, userInfo: { openId: "platform-injected" }, ignored: true },
  "request",
));
assert.throws(() => assertRequestObject(null, "request"), (error) => error.code === "NOTIFICATION_INVALID");
assert.deepStrictEqual(shanghaiParts(new Date("2026-07-17T00:00:00.000Z")), { date: "2026-07-17", hour: 8, minute: 0 });

console.log("generatePlan tests passed");
