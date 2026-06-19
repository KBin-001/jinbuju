const crypto = require("crypto");
const { DANGEROUS_CONTENT } = require("./constants");

const GOAL_CATEGORIES = [
  "exam",
  "skill",
  "career",
  "reading",
  "fitness",
  "habit",
  "other",
];
const TARGET_DURATIONS = ["1_month", "3_months", "6_months", "long_term"];
const STAGE_DURATIONS = [1, 2, 3, 4, 5, 6, 7];
const DIFFICULTIES = ["easy", "suitable", "hard"];
const NEXT_PREFERENCES = ["lighter", "same", "stronger", "change_focus"];
const VAGUE_ACTION =
  /^(努力|努力学习|坚持|加油|继续努力|认真学习|保持坚持|提升自己|了解相关内容|学习一下)$/;
const GENERATED_STAGE_SCHEMA_VERSION = "generated-stage-v1";
const ACTION_TYPES = [
  "practice",
  "learning",
  "preparation",
  "reflection",
  "recovery",
  "creation",
  "execution",
];
const PASSIVE_ACTION_WORDS = /了解|学习|观看|阅读|记录|整理笔记|查资料/;
const PRACTICE_ACTION_WORDS = /练习|完成|制作|执行|尝试|参加|筛选|联系|搭建|写出|做出|拍摄|烹饪|调整|准备|复盘/;
const DANGER_ACTION_WORDS = /伤害|击打要害|偷袭|无保护对练|实战攻击|致伤|制服他人|危险动作/;
const QUALITY_PRACTICE_ACTION_TYPES = new Set(["practice", "execution", "creation"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function hasExactKeys(value, allowedKeys) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === allowedKeys.length &&
    keys.every((key, index) => key === [...allowedKeys].sort()[index])
  );
}

function safeText(value, minimum, maximum) {
  if (typeof value !== "string") return false;
  const cleaned = stripUnicodeNonCharacters(value);
  return (
    cleaned.trim().length >= minimum &&
    cleaned.trim().length <= maximum &&
    !DANGEROUS_CONTENT.test(cleaned)
  );
}

function stripUnicodeNonCharacters(text) {
  // Remove Unicode noncharacters: U+FFFE, U+FFFF, and ranges U+FDD0-U+FDEF
  return text.replace(/[\ufdd0-\ufdef\ufffe\uffff]/g, "");
}

function normalizeText(value, minimum, maximum, label) {
  if (typeof value !== "string") fail("AI_RESPONSE_SCHEMA_INVALID", `${label}无效。`);
  const text = stripUnicodeNonCharacters(value).trim().replace(/\s+/g, " ");
  if (text.length < minimum) fail("AI_RESPONSE_SCHEMA_INVALID", `${label}不能为空。`);
  if (DANGEROUS_CONTENT.test(text)) fail("AI_RESPONSE_SCHEMA_INVALID", `${label}包含不支持内容。`);
  return text.slice(0, maximum);
}

function normalizeStringArray(value, maximumItems, maximumLength) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("AI_RESPONSE_SCHEMA_INVALID", "数组字段无效。");
  const items = [];
  for (const item of value) {
    if (typeof item !== "string") fail("AI_RESPONSE_SCHEMA_INVALID", "数组字段只能包含文本。");
    const text = stripUnicodeNonCharacters(item).trim().replace(/\s+/g, " ");
    if (text && !DANGEROUS_CONTENT.test(text) && !items.includes(text)) {
      items.push(text.slice(0, maximumLength));
    }
    if (items.length >= maximumItems) break;
  }
  return items;
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function validateStringArray(value, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string" && v.trim())
    .slice(0, maxLength)
    .map((v) => v.trim().slice(0, 50));
}

function validateSkipReasonsMap(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof key === "string" && Number.isFinite(Number(count))) {
      result[key.slice(0, 30)] = clampInt(count, 0, 1000);
    }
  }
  return result;
}

function validateRatesMap(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const [key, rate] of Object.entries(value)) {
    if (typeof key === "string" && Number.isFinite(Number(rate))) {
      result[key.slice(0, 30)] = clampInt(rate, 0, 100);
    }
  }
  return result;
}

function validateExecutionSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    completionRate: clampInt(value.completionRate, 0, 100),
    actionDays: clampInt(value.actionDays, 0, 366),
    streakDays: clampInt(value.streakDays, 0, 366),
    completedActionCount: clampInt(value.completedActionCount, 0, 10000),
    totalActionCount: clampInt(value.totalActionCount, 0, 10000),
    averageDailyMinutes: clampInt(value.averageDailyMinutes, 0, 600),
    plannedDailyMinutes: clampInt(value.plannedDailyMinutes, 0, 600),
    completedActionTypes: validateStringArray(value.completedActionTypes, 20),
    frequentlySkippedActionTypes: validateStringArray(value.frequentlySkippedActionTypes, 20),
    skipReasons: validateSkipReasonsMap(value.skipReasons),
    actualResourceUsage: validateStringArray(value.actualResourceUsage, 30),
    userDifficulty: DIFFICULTIES.includes(value.userDifficulty) ? value.userDifficulty : "suitable",
    actionTypeCompletionRates: validateRatesMap(value.actionTypeCompletionRates),
    feelingDistribution: validateRatesMap(value.feelingDistribution),
  };
}

function validatePreviousPlanSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    stageTitle: typeof value.stageTitle === "string" ? value.stageTitle.trim().slice(0, 40) : "",
    stageFocus: typeof value.stageFocus === "string" ? value.stageFocus.trim().slice(0, 80) : "",
    actionThemes: validateStringArray(value.actionThemes, 10),
    actionSamples: validateStringArray(value.actionSamples, 12),
    completedActionSamples: validateStringArray(value.completedActionSamples, 12),
    skippedActionSamples: validateStringArray(value.skippedActionSamples, 12),
  };
}

function validatePreviousReview(input) {
  if (!input || typeof input !== "object") {
    fail("INVALID_ARGUMENT", "阶段复盘信息无效。");
  }
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "completionRate",
          "actionDays",
          "previousFocus",
          "difficulty",
          "nextPreference",
          "focusAdjustment",
          "executionSummary",
          "previousPlanSummary",
        ].includes(key),
    )
  ) {
    fail("INVALID_ARGUMENT", "阶段复盘信息包含不支持的字段。");
  }
  if (
    !Number.isInteger(input.completionRate) ||
    input.completionRate < 0 ||
    input.completionRate > 100 ||
    !Number.isInteger(input.actionDays) ||
    input.actionDays < 0 ||
    input.actionDays > 366 ||
    !safeText(input.previousFocus, 2, 50) ||
    !DIFFICULTIES.includes(input.difficulty) ||
    !NEXT_PREFERENCES.includes(input.nextPreference)
  ) {
    fail("INVALID_ARGUMENT", "阶段复盘信息无效。");
  }
  if (
    input.nextPreference === "change_focus" &&
    !safeText(input.focusAdjustment, 2, 200)
  ) {
    fail("INVALID_ARGUMENT", "重点调整需为 2～200 个字符。");
  }
  const executionSummary = input.executionSummary !== undefined
    ? validateExecutionSummary(input.executionSummary)
    : null;
  const previousPlanSummary = validatePreviousPlanSummary(input.previousPlanSummary);
  return {
    completionRate: input.completionRate,
    actionDays: input.actionDays,
    previousFocus: input.previousFocus.trim(),
    difficulty: input.difficulty,
    nextPreference: input.nextPreference,
    focusAdjustment:
      input.nextPreference === "change_focus"
        ? input.focusAdjustment.trim()
        : "",
    executionSummary,
    previousPlanSummary,
  };
}

function validateStageGenerationInput(input, allowNextStage = false) {
  if (!input || typeof input !== "object") {
    fail("INVALID_ARGUMENT", "长期目标信息不完整。");
  }
  const allowed = [
    "goalTitle",
    "category",
    "desiredResult",
    "dailyMinutes",
    "targetDuration",
    "stageNumber",
    "durationDays",
    "templateId",
    "currentLevel",
    "weeklyDays",
    "intensity",
    "deadline",
  ];
  if (allowNextStage) allowed.push("previousReview");
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    fail("INVALID_ARGUMENT", "长期目标包含不支持的字段。");
  }
  if (!safeText(input.goalTitle, 2, 30)) {
    fail("INVALID_ARGUMENT", "目标名称需为 2～30 个字符。");
  }
  if (!GOAL_CATEGORIES.includes(input.category)) {
    fail("INVALID_ARGUMENT", "目标分类无效。");
  }
  if (!safeText(input.desiredResult, 5, 200)) {
    fail("INVALID_ARGUMENT", "期望结果需为 5～200 个字符。");
  }
  if (
    !Number.isInteger(input.dailyMinutes) ||
    input.dailyMinutes < 10 ||
    input.dailyMinutes > 180
  ) {
    fail("INVALID_ARGUMENT", "每日投入时间需为 10～180 分钟。");
  }
  if (!TARGET_DURATIONS.includes(input.targetDuration)) {
    fail("INVALID_ARGUMENT", "目标周期无效。");
  }
  if (
    !Number.isInteger(input.stageNumber) ||
    input.stageNumber < 1 ||
    (!allowNextStage && input.stageNumber !== 1)
  ) {
    fail("INVALID_ARGUMENT", "阶段编号无效。");
  }
  if (!STAGE_DURATIONS.includes(input.durationDays)) {
    fail("INVALID_ARGUMENT", "阶段周期需为 1～7 天。");
  }
  const result = {
    goalTitle: input.goalTitle.trim(),
    category: input.category,
    desiredResult: input.desiredResult.trim(),
    dailyMinutes: input.dailyMinutes,
    targetDuration: input.targetDuration,
    stageNumber: input.stageNumber,
    durationDays: input.durationDays,
    templateId: typeof input.templateId === "string" ? input.templateId : "",
    currentLevel: ["zero", "basic", "intermediate"].includes(input.currentLevel)
      ? input.currentLevel
      : "zero",
    weeklyDays: [3, 5, 7].includes(input.weeklyDays) ? input.weeklyDays : 7,
    intensity: ["light", "normal", "intensive"].includes(input.intensity)
      ? input.intensity
      : "normal",
    deadline:
      typeof input.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.deadline)
        ? input.deadline
        : "",
  };
  if (allowNextStage) {
    result.previousReview = validatePreviousReview(input.previousReview);
  }
  return result;
}

function parseStageAiJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    fail("AI_RESPONSE_INVALID", "AI 返回内容为空。");
  }
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(normalized);
  } catch (error) {
    fail("AI_RESPONSE_INVALID", "AI 返回内容不是合法 JSON。");
  }
}

function validateStagePlan(input, generationInput) {
  if (
    !input ||
    typeof input !== "object" ||
    !hasOnlyKeys(input, ["stage", "days"]) ||
    !Object.prototype.hasOwnProperty.call(input, "stage") ||
    !Object.prototype.hasOwnProperty.call(input, "days")
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段方案结构无效。");
  }
  if (
    !input.stage ||
    typeof input.stage !== "object" ||
    !hasOnlyKeys(input.stage, [
      "title",
      "summary",
      "objective",
      "focus",
      "durationDays",
      "successMetrics",
      "assumptions",
    ])
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段信息结构无效。");
  }
  if (!safeText(input.stage.title, 2, 30)) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段标题无效。");
  }
  const stageSummary = input.stage.summary || input.stage.objective;
  if (!safeText(stageSummary, 5, 150)) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段说明无效。");
  }
  if (!safeText(input.stage.focus, 2, 50)) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段重点无效。");
  }
  if (input.stage.durationDays !== generationInput.durationDays) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段周期与请求不一致。");
  }
  if (
    !Array.isArray(input.days) ||
    input.days.length !== generationInput.durationDays
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动数量与阶段周期不一致。");
  }

  const actionTitles = new Set();
  const days = input.days.map((day, index) => {
    if (
      !day ||
      typeof day !== "object" ||
      !hasOnlyKeys(day, ["dayIndex", "theme", "actions", "totalMinutes", "isRestDay"])
    ) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动结构无效。");
    }
    if (day.dayIndex !== index + 1) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "日期序号必须从 1 连续递增。");
    }
    if (!safeText(day.theme, 2, 40)) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每日主题无效。");
    }
    const weekDay = ((day.dayIndex - 1) % 7) + 1;
    const activeDays =
      generationInput.durationDays < 7
        ? [1, 2, 3, 4, 5, 6, 7]
        : {
            3: [1, 3, 5],
            5: [1, 2, 3, 5, 6],
            7: [1, 2, 3, 4, 5, 6, 7],
          }[generationInput.weeklyDays || 7];
    const shouldRest = !activeDays.includes(weekDay);
    const minimumActions = generationInput.templateId ? 1 : 1;
    const maximumActions = generationInput.templateId ? 1 : 4;
    if (!Array.isArray(day.actions)) {
      fail("AI_RESPONSE_SCHEMA_INVALID", `第 ${day.dayIndex} 天行动列表无效。`);
    }
    if (shouldRest) {
      return {
        dayIndex: day.dayIndex,
        theme: "休息与整理",
        totalMinutes: 0,
        actions: [],
      };
    }
    if (day.actions.length < minimumActions || day.actions.length > maximumActions) {
      const actionCount = Array.isArray(day.actions) ? day.actions.length : -1;
      fail(
        "AI_RESPONSE_SCHEMA_INVALID",
        `第 ${day.dayIndex} 天行动数量为 ${actionCount}，执行日应为 ${minimumActions}～${maximumActions}。`,
      );
    }

    let totalMinutes = 0;
    const actions = day.actions.map((action) => {
      if (
        !action ||
        typeof action !== "object" ||
        !hasOnlyKeys(action, [
          "title",
          "description",
          "estimatedMinutes",
          "actionType",
          "completionCriteria",
          "requiredResources",
          "safetyNotes",
          "slotId",
        ])
      ) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "行动结构无效。");
      }
      if (!safeText(action.title, 2, 40)) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "行动标题无效。");
      }
      if (!safeText(action.description, 2, 150)) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "行动说明无效。");
      }
      const normalizedTitle = action.title.trim().replace(/\s+/g, "");
      if (VAGUE_ACTION.test(normalizedTitle)) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "行动内容过于空泛。");
      }
      if (actionTitles.has(normalizedTitle)) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "阶段中存在重复行动。");
      }
      if (
        !Number.isInteger(action.estimatedMinutes) ||
        action.estimatedMinutes < 5 ||
        action.estimatedMinutes > 180
      ) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "行动时长无效。");
      }
      actionTitles.add(normalizedTitle);
      totalMinutes += action.estimatedMinutes;
      return {
        title: stripUnicodeNonCharacters(action.title).trim(),
        description: stripUnicodeNonCharacters(action.description).trim(),
        estimatedMinutes: action.estimatedMinutes,
        ...(ACTION_TYPES.includes(action.actionType) ? { actionType: action.actionType } : {}),
        ...(safeText(action.completionCriteria, 3, 150)
          ? { completionCriteria: stripUnicodeNonCharacters(action.completionCriteria).trim() }
          : {}),
        ...(Array.isArray(action.requiredResources)
          ? { requiredResources: normalizeStringArray(action.requiredResources, 5, 40) }
          : {}),
        ...(Array.isArray(action.safetyNotes)
          ? { safetyNotes: normalizeStringArray(action.safetyNotes, 5, 80) }
          : {}),
      };
    });
    if (totalMinutes > generationInput.dailyMinutes) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动总时长超出设置。");
    }
    return {
      dayIndex: day.dayIndex,
      theme: stripUnicodeNonCharacters(day.theme).trim(),
      totalMinutes,
      actions,
    };
  });

  return {
    stage: {
      title: stripUnicodeNonCharacters(input.stage.title).trim(),
      summary: stripUnicodeNonCharacters(stageSummary).trim(),
      focus: stripUnicodeNonCharacters(input.stage.focus).trim(),
      durationDays: input.stage.durationDays,
    },
    days,
  };
}

function validateGeneratedStagePlan(input, goalProfile) {
  if (!input || typeof input !== "object" || !hasOnlyKeys(input, ["stage", "days"])) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段方案结构无效。");
  }
  if (!input.stage || typeof input.stage !== "object") {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段信息结构无效。");
  }
  if (
    !hasOnlyKeys(input.stage, [
      "title",
      "objective",
      "focus",
      "durationDays",
      "successMetrics",
      "assumptions",
    ])
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段信息包含不支持字段。");
  }
  if (input.stage.durationDays !== goalProfile.durationDays) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段周期与请求不一致。");
  }
  if (!Array.isArray(input.days) || input.days.length !== goalProfile.durationDays) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动数量与阶段周期不一致。");
  }

  const titleCounts = new Map();
  const days = input.days.map((day, index) => {
    if (
      !day ||
      typeof day !== "object" ||
      !hasOnlyKeys(day, ["dayIndex", "theme", "isRestDay", "actions"])
    ) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动结构无效。");
    }
    if (day.dayIndex !== index + 1) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "日期序号必须从 1 连续递增。");
    }
    const isRestDay = day.isRestDay === true;
    if (!Array.isArray(day.actions)) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动列表无效。");
    }
    if (isRestDay && day.actions.length !== 0) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "休息日不能包含行动。");
    }
    if (!isRestDay && (day.actions.length < 1 || day.actions.length > 4)) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "普通日需包含 1～4 个行动。");
    }

    let totalMinutes = 0;
    const actions = day.actions.map((action, actionIndex) => {
      if (
        !action ||
        typeof action !== "object" ||
        !hasOnlyKeys(action, [
          "title",
          "actionType",
          "description",
          "completionCriteria",
          "estimatedMinutes",
          "requiredResources",
          "safetyNotes",
        ])
      ) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "行动结构无效。");
      }
      const estimatedMinutes = Math.round(Number(action.estimatedMinutes));
      if (
        !Number.isInteger(estimatedMinutes) ||
        estimatedMinutes < 5 ||
        estimatedMinutes > 180
      ) {
        fail("AI_RESPONSE_SCHEMA_INVALID", "行动时长无效。");
      }
      const title = normalizeText(action.title, 2, 50, "行动标题");
      const normalizedTitle = title.replace(/\s+/g, "");
      titleCounts.set(normalizedTitle, (titleCounts.get(normalizedTitle) || 0) + 1);
      totalMinutes += estimatedMinutes;
      return {
        slotId: `slot_day_${day.dayIndex}_${actionIndex + 1}`,
        title,
        actionType: ACTION_TYPES.includes(action.actionType) ? action.actionType : "practice",
        description: normalizeText(action.description, 5, 200, "执行说明"),
        completionCriteria: normalizeText(action.completionCriteria, 3, 150, "完成标准"),
        estimatedMinutes,
        requiredResources: normalizeStringArray(action.requiredResources, 5, 40),
        safetyNotes: normalizeStringArray(action.safetyNotes, 5, 80),
      };
    });
    if (totalMinutes > Math.ceil(goalProfile.dailyMinutes * 1.2)) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动总时长超出设置。");
    }
    return {
      dayIndex: day.dayIndex,
      theme: normalizeText(day.theme, 2, 40, "每日主题"),
      isRestDay,
      totalMinutes,
      actions,
    };
  });

  const repeatedTitles = Array.from(titleCounts.values()).filter((count) => count > 1).length;
  if (repeatedTitles > 1) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段中存在大量重复行动。");
  }

  const stage = {
    title: normalizeText(input.stage.title, 2, 40, "阶段标题"),
    objective: normalizeText(input.stage.objective, 5, 200, "阶段目标"),
    focus: normalizeText(input.stage.focus, 2, 80, "阶段重点"),
    durationDays: input.stage.durationDays,
    successMetrics: normalizeStringArray(input.stage.successMetrics, 5, 80),
    assumptions: normalizeStringArray(input.stage.assumptions, 5, 80),
  };
  return {
    stage: {
      title: stage.title,
      summary: stage.objective,
      objective: stage.objective,
      focus: stage.focus,
      durationDays: stage.durationDays,
      successMetrics: stage.successMetrics,
      assumptions: stage.assumptions,
    },
    days,
  };
}

function evaluateStagePlanQuality(plan, goalProfile) {
  const problems = [];
  const actions = plan.days.flatMap((day) => day.actions);
  const isPracticeAction = (action) =>
    QUALITY_PRACTICE_ACTION_TYPES.has(action.actionType) ||
    PRACTICE_ACTION_WORDS.test(
      `${action.title}${action.description}${action.completionCriteria || ""}`,
    );
  // Reading or learning can still be an executable action when it produces a
  // verifiable exercise or artifact. Only count actions that remain purely passive.
  const passiveCount = actions.filter(
    (action) =>
      PASSIVE_ACTION_WORDS.test(`${action.title}${action.description}`) &&
      !isPracticeAction(action),
  ).length;
  const practiceCount = actions.filter(isPracticeAction).length;
  const uniqueTitles = new Set(actions.map((action) => action.title.replace(/\s+/g, ""))).size;
  const dangerCount = actions.filter((action) =>
    DANGER_ACTION_WORDS.test(`${action.title}${action.description}${action.safetyNotes.join("")}`),
  ).length;
  const overBudgetDays = plan.days.filter(
    (day) => day.totalMinutes > Math.ceil(goalProfile.dailyMinutes * 1.2),
  ).length;
  const practicalGoal = ["skill", "project", "outcome"].includes(goalProfile.goalType) ||
    ["health", "creative", "project", "life"].includes(goalProfile.categoryGroup);

  if (actions.length === 0) problems.push("阶段缺少可执行行动。");
  if (passiveCount >= Math.ceil(actions.length * 0.65)) {
    problems.push("行动过于笔记化，实践行动不足。");
  }
  if (practicalGoal && practiceCount < Math.ceil(actions.length * 0.4)) {
    problems.push("实践型目标缺少实践或执行类行动。");
  }
  if (uniqueTitles < Math.ceil(actions.length * 0.75)) {
    problems.push("多天行动高度重复。");
  }
  if (overBudgetDays > 0) problems.push("存在每日时间明显超标。");
  if (dangerCount > 0) problems.push("存在不安全行为或危险指导。");
  if (
    /搏击|格斗|拳击|散打|武术|防身/.test(goalProfile.title) &&
    !actions.some((action) => /正规|教练|场馆|安全/.test(`${action.description}${action.safetyNotes.join("")}`))
  ) {
    problems.push("搏击类目标缺少正规指导和安全提醒。");
  }
  if (!plan.stage.successMetrics || plan.stage.successMetrics.length === 0) {
    problems.push("阶段缺少成功指标。");
  }

  const specificityScore = Math.max(0, 100 - passiveCount * 15 - problems.length * 5);
  const feasibilityScore = Math.max(0, 100 - overBudgetDays * 30);
  const diversityScore = actions.length ? Math.round((uniqueTitles / actions.length) * 100) : 0;
  const progressionScore = plan.days.length > 1 && uniqueTitles > 1 ? 80 : 50;
  const safetyScore = dangerCount > 0 ? 20 : 100;
  return {
    specificityScore,
    feasibilityScore,
    diversityScore,
    progressionScore,
    safetyScore,
    problems,
    shouldRepair:
      problems.length > 0 ||
      specificityScore < 65 ||
      feasibilityScore < 80 ||
      diversityScore < 70 ||
      safetyScore < 80,
  };
}

function validateStageRequestId(value) {
  if (typeof value !== "string" || !/^stage_[a-zA-Z0-9_]{8,80}$/.test(value)) {
    fail("INVALID_ARGUMENT", "阶段生成请求标识无效。");
  }
  return value;
}

function fingerprintStageInput(input) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

const VALID_FEEDBACK_TYPES = [
  "too_many_tasks",
  "too_few_tasks",
  "too_difficult",
  "too_easy",
  "too_theoretical",
  "not_enough_practice",
  "time_unreasonable",
  "resource_unavailable",
  "direction_mismatch",
  "too_repetitive",
  "other",
];
const MAX_FEEDBACK_TYPES = 3;
const MAX_FEEDBACK_NOTE_LENGTH = 200;
const PASSIVE_ACTION_TYPES = new Set(["learning", "preparation", "reflection"]);
const PRACTICE_ACTION_TYPES = new Set(["practice", "execution", "creation"]);

function validateFeedbackTypes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("INVALID_FEEDBACK_TYPE", "请选择至少一个问题类型。");
  }
  if (value.length > MAX_FEEDBACK_TYPES) {
    fail("INVALID_FEEDBACK_TYPE", `最多选择 ${MAX_FEEDBACK_TYPES} 个问题类型。`);
  }
  const seen = new Set();
  const types = [];
  for (const item of value) {
    const type = String(item || "");
    if (!VALID_FEEDBACK_TYPES.includes(type)) {
      fail("INVALID_FEEDBACK_TYPE", "包含不支持的反馈类型。");
    }
    if (!seen.has(type)) {
      seen.add(type);
      types.push(type);
    }
  }
  return types;
}

function validateFeedbackNote(value) {
  if (value === undefined || value === null || value === "") return "";
  const note = String(value).trim();
  if (note.length > MAX_FEEDBACK_NOTE_LENGTH) {
    fail("INVALID_FEEDBACK_NOTE", `补充说明不能超过 ${MAX_FEEDBACK_NOTE_LENGTH} 个字符。`);
  }
  if (DANGEROUS_CONTENT.test(note)) {
    fail("INVALID_FEEDBACK_NOTE", "补充说明包含不支持的内容。");
  }
  return note;
}

function evaluateFeedbackResolution(newPlan, oldPlan, feedbackTypes, goalProfile) {
  const resolvedTypes = [];
  const unresolvedTypes = [];
  const problems = [];

  const newActions = newPlan.days.flatMap((day) => day.actions);
  const oldActions = oldPlan.days.flatMap((day) => day.actions);

  const newPassiveCount = newActions.filter(
    (a) => PASSIVE_ACTION_TYPES.has(a.actionType) || PASSIVE_ACTION_WORDS.test(`${a.title}${a.description}`),
  ).length;
  const oldPassiveCount = oldActions.filter(
    (a) => PASSIVE_ACTION_TYPES.has(a.actionType) || PASSIVE_ACTION_WORDS.test(`${a.title}${a.description}`),
  ).length;
  const newPracticeCount = newActions.filter(
    (a) => PRACTICE_ACTION_TYPES.has(a.actionType) || PRACTICE_ACTION_WORDS.test(`${a.title}${a.description}${a.completionCriteria || ""}`),
  ).length;
  const oldPracticeCount = oldActions.filter(
    (a) => PRACTICE_ACTION_TYPES.has(a.actionType) || PRACTICE_ACTION_WORDS.test(`${a.title}${a.description}${a.completionCriteria || ""}`),
  ).length;

  const newActiveDays = newPlan.days.filter((d) => !d.isRestDay && d.actions.length > 0);
  const oldActiveDays = oldPlan.days.filter((d) => !d.isRestDay && d.actions.length > 0);
  const newAvgActionsPerDay = newActiveDays.length ? newActions.length / newActiveDays.length : 0;
  const oldAvgActionsPerDay = oldActiveDays.length ? oldActions.length / oldActiveDays.length : 0;
  const newAvgMinutes = newActiveDays.length
    ? Math.round(newActions.reduce((s, a) => s + a.estimatedMinutes, 0) / newActiveDays.length)
    : 0;
  const oldAvgMinutes = oldActiveDays.length
    ? Math.round(oldActions.reduce((s, a) => s + (a.estimatedMinutes || 0), 0) / oldActiveDays.length)
    : 0;

  for (const type of feedbackTypes) {
    let resolved = false;
    switch (type) {
      case "too_many_tasks":
        resolved = newAvgActionsPerDay < oldAvgActionsPerDay || newAvgMinutes < oldAvgMinutes;
        if (!resolved) problems.push("任务数量或时间未减少。");
        break;
      case "too_few_tasks":
        resolved = newActions.length >= oldActions.length;
        if (!resolved) problems.push("行动数量未增加。");
        break;
      case "too_difficult":
        resolved = newAvgMinutes <= oldAvgMinutes || newActions.length <= oldActions.length;
        break;
      case "too_easy":
        resolved = newPracticeCount >= oldPracticeCount;
        break;
      case "too_theoretical":
        resolved = newPassiveCount < oldPassiveCount || newPracticeCount > oldPracticeCount;
        if (!resolved) problems.push("实践行动比例未提高。");
        break;
      case "not_enough_practice":
        resolved = newPracticeCount > oldPracticeCount;
        if (!resolved) problems.push("实践类行动未增加。");
        break;
      case "time_unreasonable": {
        const dailyLimit = goalProfile.dailyMinutes || 60;
        const overBudgetDays = newPlan.days.filter(
          (d) => d.totalMinutes > Math.ceil(dailyLimit * 1.2),
        ).length;
        resolved = overBudgetDays === 0;
        if (!resolved) problems.push("仍存在每日时间超标。");
        break;
      }
      case "resource_unavailable": {
        const oldResources = new Set(oldActions.flatMap((a) => a.requiredResources || []));
        const newResources = new Set(newActions.flatMap((a) => a.requiredResources || []));
        const userResources = new Set((goalProfile.availableResources || []).map((r) => String(r)));
        const unresolvedResources = [];
        for (const res of newResources) {
          if (!userResources.has(res) && oldResources.has(res)) {
            unresolvedResources.push(res);
          }
        }
        resolved = unresolvedResources.length === 0;
        if (!resolved) problems.push(`仍依赖不可用资源：${unresolvedResources.slice(0, 3).join("、")}`);
        break;
      }
      case "direction_mismatch":
        resolved = newPlan.stage.focus !== oldPlan.stage.focus || newPlan.stage.title !== oldPlan.stage.title;
        break;
      case "too_repetitive": {
        const newUniqueTitles = new Set(newActions.map((a) => a.title.replace(/\s+/g, ""))).size;
        const oldUniqueTitles = new Set(oldActions.map((a) => a.title.replace(/\s+/g, ""))).size;
        resolved = newUniqueTitles >= oldUniqueTitles;
        break;
      }
      case "other":
        resolved = true;
        break;
      default:
        resolved = true;
    }
    if (resolved) {
      resolvedTypes.push(type);
    } else {
      unresolvedTypes.push(type);
    }
  }

  return {
    resolved: unresolvedTypes.length === 0,
    resolvedFeedbackTypes: resolvedTypes,
    unresolvedFeedbackTypes: unresolvedTypes,
    problems,
  };
}

module.exports = {
  GOAL_CATEGORIES,
  STAGE_DURATIONS,
  TARGET_DURATIONS,
  VALID_FEEDBACK_TYPES,
  fingerprintStageInput,
  GENERATED_STAGE_SCHEMA_VERSION,
  evaluateFeedbackResolution,
  parseStageAiJson,
  evaluateStagePlanQuality,
  validateFeedbackNote,
  validateFeedbackTypes,
  validateGeneratedStagePlan,
  validateStageGenerationInput,
  validateStagePlan,
  validateStageRequestId,
};
