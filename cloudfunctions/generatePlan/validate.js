const {
  CATEGORIES,
  DAILY_MINUTES,
  DANGEROUS_CONTENT,
  INTENSITIES,
  LEVELS,
} = require("./constants");
const { addBusinessDays, businessDateDiff, formatBusinessDate } = require("./date");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isSafeText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength &&
    !DANGEROUS_CONTENT.test(value)
  );
}

function validateGoal(input) {
  if (!input || typeof input !== "object") fail("INVALID_ARGUMENT", "目标信息不完整。");
  if (!CATEGORIES.includes(input.category)) fail("INVALID_ARGUMENT", "目标类型无效。");
  if (!isSafeText(input.goalTitle, 30)) fail("INVALID_ARGUMENT", "具体目标需为 1～30 个字符。");
  if (!isSafeText(input.goalTemplate, 40)) fail("INVALID_ARGUMENT", "目标模板无效。");
  if (!LEVELS.includes(input.currentLevel)) fail("INVALID_ARGUMENT", "当前水平无效。");
  if (!INTENSITIES.includes(input.intensity)) fail("INVALID_ARGUMENT", "执行强度无效。");
  if (!Number.isInteger(input.weeklyDays) || input.weeklyDays < 3 || input.weeklyDays > 7) {
    fail("INVALID_ARGUMENT", "每周学习天数需为 3～7 天。");
  }
  if (!DAILY_MINUTES.includes(input.dailyMinutes)) {
    fail("INVALID_ARGUMENT", "每天投入时间无效。");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) {
    fail("INVALID_ARGUMENT", "截止日期格式无效。");
  }
  if (businessDateDiff(formatBusinessDate(), input.deadline) < 1) {
    fail("INVALID_ARGUMENT", "截止日期至少为明天。");
  }
  // Legacy goals only had a long-term deadline; keep their original 7-day default.
  const planDurationDays = Number(input.planDurationDays || input.durationDays || 7);
  if (!Number.isInteger(planDurationDays) || planDurationDays < 3 || planDurationDays > 90) {
    fail("INVALID_PLAN_DURATION", "计划周期需为 3～90 天。");
  }

  return {
    category: input.category,
    goalTitle: input.goalTitle.trim(),
    goalTemplate: input.goalTemplate.trim(),
    currentLevel: input.currentLevel,
    deadline: input.deadline,
    weeklyDays: input.weeklyDays,
    dailyMinutes: input.dailyMinutes,
    intensity: input.intensity,
    planDurationDays,
    status: "draft",
  };
}

function parseAiJson(text) {
  if (typeof text !== "string") fail("PLAN_SCHEMA_INVALID", "计划结构无效。");
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(normalized);
  } catch (error) {
    fail("PLAN_SCHEMA_INVALID", "计划结构无效。");
  }
}

function validatePlan(input, goal, requestedStartDate) {
  if (!input || typeof input !== "object") fail("PLAN_SCHEMA_INVALID", "计划结构无效。");
  if (!isSafeText(input.summary, 100)) fail("PLAN_SCHEMA_INVALID", "计划摘要无效。");
  if (!isSafeText(input.weeklyGoal, 100)) fail("PLAN_SCHEMA_INVALID", "本周目标无效。");
  if (!isSafeText(input.fallbackAdvice, 160)) fail("PLAN_SCHEMA_INVALID", "顺延建议无效。");
  const planDurationDays = Number(goal.planDurationDays || 7);
  if (!Array.isArray(input.days) || input.days.length !== planDurationDays) {
    fail("PLAN_SCHEMA_INVALID", `计划必须包含 ${planDurationDays} 天。`);
  }

  const dayNumbers = new Set();
  const startDate = requestedStartDate || formatBusinessDate();
  const days = input.days.map((day, index) => {
    if (!day || typeof day !== "object") fail("PLAN_SCHEMA_INVALID", "每日计划无效。");
    if (!Number.isInteger(day.day) || day.day < 1 || day.day > planDurationDays || dayNumbers.has(day.day)) {
      fail("PLAN_SCHEMA_INVALID", "计划日期序号无效。");
    }
    dayNumbers.add(day.day);
    if (!isSafeText(day.title, 60)) fail("PLAN_SCHEMA_INVALID", "每日主题无效。");
    if (typeof day.isStudyDay !== "boolean") fail("PLAN_SCHEMA_INVALID", "学习日状态无效。");
    if (!Array.isArray(day.tasks)) fail("PLAN_SCHEMA_INVALID", "任务列表无效。");
    if (day.isStudyDay && day.tasks.length < 1) {
      fail("PLAN_SCHEMA_INVALID", "学习日必须包含任务。");
    }
    if (!day.isStudyDay && day.tasks.length > 1) {
      fail("PLAN_SCHEMA_INVALID", "休息日任务过多。");
    }

    let totalMinutes = 0;
    const tasks = day.tasks.map((task) => {
      if (!task || !isSafeText(task.title, 80)) fail("PLAN_SCHEMA_INVALID", "任务标题无效。");
      if (!Number.isInteger(task.estimatedMinutes) || task.estimatedMinutes <= 0) {
        fail("PLAN_SCHEMA_INVALID", "任务时长无效。");
      }
      totalMinutes += task.estimatedMinutes;
      return {
        title: task.title.trim(),
        estimatedMinutes: task.estimatedMinutes,
      };
    });

    const maximumMinutes = Math.max(goal.dailyMinutes + 10, Math.ceil(goal.dailyMinutes * 1.2));
    if (day.isStudyDay && totalMinutes > maximumMinutes) {
      fail("PLAN_SCHEMA_INVALID", "每日任务总时长超出设置。");
    }

    return {
      day: day.day,
      date: addBusinessDays(startDate, index),
      title: day.title.trim(),
      isStudyDay: day.isStudyDay,
      tasks,
    };
  });

  days.sort((left, right) => left.day - right.day);
  days.forEach((day, index) => {
    day.date = addBusinessDays(startDate, index);
  });

  return {
    summary: input.summary.trim(),
    weeklyGoal: input.weeklyGoal.trim(),
    days,
    fallbackAdvice: input.fallbackAdvice.trim(),
    source: input.source === "fallback" ? "fallback" : "ai",
  };
}

function validateRequestId(value) {
  if (typeof value !== "string" || !/^plan_[a-zA-Z0-9_]{8,80}$/.test(value)) {
    fail("INVALID_ARGUMENT", "请求标识无效。");
  }
  return value;
}

module.exports = {
  fail,
  parseAiJson,
  validateGoal,
  validatePlan,
  validateRequestId,
};
