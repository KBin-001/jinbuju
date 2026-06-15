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
const STAGE_DURATIONS = [7, 10, 14, 21, 30];
const DIFFICULTIES = ["easy", "suitable", "hard"];
const NEXT_PREFERENCES = ["lighter", "same", "stronger", "change_focus"];
const VAGUE_ACTION =
  /^(努力|努力学习|坚持|加油|继续努力|认真学习|保持坚持|提升自己|了解相关内容|学习一下)$/;

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
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.trim().length <= maximum &&
    !DANGEROUS_CONTENT.test(value)
  );
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
    !safeText(input.focusAdjustment, 2, 50)
  ) {
    fail("INVALID_ARGUMENT", "重点调整需为 2～50 个字符。");
  }
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
    fail("INVALID_ARGUMENT", "阶段周期暂只支持 7、10 或 14 天。");
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
    !hasExactKeys(input, ["stage", "days"])
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段方案结构无效。");
  }
  if (
    !input.stage ||
    typeof input.stage !== "object" ||
    !hasExactKeys(input.stage, [
      "title",
      "summary",
      "focus",
      "durationDays",
    ])
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段信息结构无效。");
  }
  if (!safeText(input.stage.title, 2, 30)) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "阶段标题无效。");
  }
  if (!safeText(input.stage.summary, 5, 150)) {
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
      !hasExactKeys(day, ["dayIndex", "theme", "actions"])
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
    const activeDays = {
      3: [1, 3, 5],
      5: [1, 2, 3, 5, 6],
      7: [1, 2, 3, 4, 5, 6, 7],
    }[generationInput.weeklyDays || 7];
    const shouldRest = !activeDays.includes(weekDay);
    const minimumActions = generationInput.templateId ? 1 : 1;
    const maximumActions = generationInput.templateId ? 1 : 4;
    if (
      !Array.isArray(day.actions) ||
      (shouldRest
        ? day.actions.length !== 0
        : day.actions.length < minimumActions || day.actions.length > maximumActions)
    ) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每天需包含 1～4 个行动。");
    }

    let totalMinutes = 0;
    const actions = day.actions.map((action) => {
      if (
        !action ||
        typeof action !== "object" ||
        !hasExactKeys(action, ["title", "description", "estimatedMinutes"])
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
        title: action.title.trim(),
        description: action.description.trim(),
        estimatedMinutes: action.estimatedMinutes,
      };
    });
    if (totalMinutes > generationInput.dailyMinutes) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "每日行动总时长超出设置。");
    }
    return {
      dayIndex: day.dayIndex,
      theme: day.theme.trim(),
      totalMinutes,
      actions,
    };
  });

  return {
    stage: {
      title: input.stage.title.trim(),
      summary: input.stage.summary.trim(),
      focus: input.stage.focus.trim(),
      durationDays: input.stage.durationDays,
    },
    days,
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

module.exports = {
  GOAL_CATEGORIES,
  STAGE_DURATIONS,
  TARGET_DURATIONS,
  fingerprintStageInput,
  parseStageAiJson,
  validateStageGenerationInput,
  validateStagePlan,
  validateStageRequestId,
};
