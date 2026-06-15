const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { createStagePlanProvider } = require("./stage-ai");
const { addBusinessDays, formatBusinessDate } = require("./date");
const { stableId } = require("./repository");
const { DANGEROUS_CONTENT } = require("./constants");
const { validateStageRequestId } = require("./stage-validate");

const db = cloud.database();
const PLAN_DURATIONS = [7, 21, 30];
const WEEKLY_DAYS = [3, 5, 7];
const DAILY_MINUTES = [15, 30, 45, 60, 90];
const LEVELS = ["zero", "basic", "intermediate"];
const INTENSITIES = ["light", "normal", "intensive"];
const ACTIVE_WEEK_DAYS = {
  3: [1, 3, 5],
  5: [1, 2, 3, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};
const PREVIEW_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
const MAX_OPTIMIZATION_ATTEMPTS = 2;

const GOAL_TEMPLATES = {
  cet4: {
    title: "英语四级",
    category: "exam",
    desiredResult: "熟悉英语四级题型，稳定推进词汇、听力、阅读和写作练习",
    themes: ["了解题型", "积累词汇", "听力练习", "阅读训练", "写作表达"],
  },
  teacher_exam: {
    title: "教师资格证",
    category: "exam",
    desiredResult: "梳理教师资格证考试范围，完成核心知识学习和基础练习",
    themes: ["了解考情", "梳理知识", "记忆重点", "完成练习", "整理错题"],
  },
  python: {
    title: "Python 入门",
    category: "skill",
    desiredResult: "掌握 Python 基础语法，并能独立完成简单的小程序练习",
    themes: ["准备环境", "学习语法", "动手练习", "组合应用", "回顾代码"],
  },
  ai_tools: {
    title: "AI 工具学习",
    category: "skill",
    desiredResult: "掌握常用 AI 工具的基础用法，并用于解决实际学习或工作任务",
    themes: ["认识工具", "学习提示方法", "完成练习", "应用到任务", "整理方法"],
  },
  video_editing: {
    title: "视频剪辑",
    category: "skill",
    desiredResult: "掌握视频剪辑基础流程，并完成可回看的短视频练习",
    themes: ["整理素材", "学习剪辑", "处理声音", "添加字幕", "完成导出"],
  },
  resume: {
    title: "完善简历",
    category: "career",
    desiredResult: "完成一份重点清晰、内容真实并适合目标岗位的简历",
    themes: ["明确岗位", "梳理经历", "提炼成果", "优化表达", "检查排版"],
  },
  interview: {
    title: "面试准备",
    category: "career",
    desiredResult: "梳理常见面试问题，形成清晰回答并完成模拟练习",
    themes: ["了解岗位", "整理经历", "准备回答", "模拟表达", "复盘改进"],
  },
  custom: {
    title: "",
    category: "other",
    desiredResult: "",
    themes: ["明确起点", "完成基础行动", "继续练习", "形成成果", "简单复盘"],
  },
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function safeText(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.trim().length <= maximum &&
    !DANGEROUS_CONTENT.test(value)
  );
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validateCreateStagePreviewInput(value) {
  if (!value || typeof value !== "object") {
    fail("INVALID_ARGUMENT", "目标信息不完整。");
  }
  const allowedKeys = [
    "templateId",
    "customGoalTitle",
    "currentLevel",
    "dailyMinutes",
    "weeklyDays",
    "intensity",
    "durationDays",
    "deadline",
  ];
  if (!hasOnlyKeys(value, allowedKeys)) {
    fail("INVALID_ARGUMENT", "目标信息包含不支持的字段。");
  }
  const template = GOAL_TEMPLATES[value.templateId];
  if (!template) fail("INVALID_ARGUMENT", "目标模板无效。");
  const customGoalTitle = String(value.customGoalTitle || "").trim();
  if (value.templateId === "custom" && !safeText(customGoalTitle, 2, 30)) {
    fail("INVALID_ARGUMENT", "自定义目标需为 2～30 个字符。");
  }
  if (value.templateId !== "custom" && customGoalTitle) {
    fail("INVALID_ARGUMENT", "预设目标不需要自定义名称。");
  }
  if (!LEVELS.includes(value.currentLevel)) {
    fail("INVALID_ARGUMENT", "当前水平无效。");
  }
  if (!DAILY_MINUTES.includes(value.dailyMinutes)) {
    fail("INVALID_ARGUMENT", "每天投入时间无效。");
  }
  if (!WEEKLY_DAYS.includes(value.weeklyDays)) {
    fail("INVALID_ARGUMENT", "每周执行天数无效。");
  }
  if (!INTENSITIES.includes(value.intensity)) {
    fail("INVALID_ARGUMENT", "计划强度无效。");
  }
  if (!PLAN_DURATIONS.includes(value.durationDays)) {
    fail("INVALID_ARGUMENT", "计划周期无效。");
  }
  const deadline = String(value.deadline || "").trim();
  const parsedDeadline = deadline ? Date.parse(`${deadline}T00:00:00Z`) : 0;
  if (
    deadline &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
      !Number.isFinite(parsedDeadline) ||
      new Date(parsedDeadline).toISOString().slice(0, 10) !== deadline)
  ) {
    fail("INVALID_ARGUMENT", "长期截止日期格式无效。");
  }
  const minimumDeadline = addBusinessDays(formatBusinessDate(), value.durationDays - 1);
  if (deadline && deadline < minimumDeadline) {
    fail("INVALID_ARGUMENT", "长期截止日期不能早于当前计划结束日期。");
  }
  const goalTitle = value.templateId === "custom" ? customGoalTitle : template.title;
  return {
    templateId: value.templateId,
    customGoalTitle: value.templateId === "custom" ? customGoalTitle : "",
    goalTitle,
    category: template.category,
    desiredResult:
      value.templateId === "custom"
        ? `围绕“${customGoalTitle}”建立稳定行动节奏并形成阶段成果`
        : template.desiredResult,
    currentLevel: value.currentLevel,
    dailyMinutes: value.dailyMinutes,
    weeklyDays: value.weeklyDays,
    intensity: value.intensity,
    durationDays: value.durationDays,
    deadline,
    targetDuration: "long_term",
    stageNumber: 1,
  };
}

function isExecutionDay(dayIndex, weeklyDays) {
  const weekDay = ((dayIndex - 1) % 7) + 1;
  return ACTIVE_WEEK_DAYS[weeklyDays].includes(weekDay);
}

function taskMinutes(input) {
  return input.intensity === "light"
    ? Math.max(10, Math.round((input.dailyMinutes * 0.75) / 5) * 5)
    : input.dailyMinutes;
}

function levelLabel(level) {
  return {
    zero: "从基础认识开始",
    basic: "在已有了解上继续练习",
    intermediate: "通过综合任务巩固并提升",
  }[level];
}

function buildBaseStagePlan(input) {
  const template = GOAL_TEMPLATES[input.templateId] || GOAL_TEMPLATES.custom;
  const minutes = taskMinutes(input);
  const intensityCopy =
    input.intensity === "intensive" ? "完成一项带成果的进阶练习" : "完成一项可验证的小练习";
  const days = Array.from({ length: input.durationDays }, (_, index) => {
    const dayIndex = index + 1;
    if (!isExecutionDay(dayIndex, input.weeklyDays)) {
      return {
        dayIndex,
        theme: "休息与整理",
        totalMinutes: 0,
        actions: [],
      };
    }
    const theme = template.themes[index % template.themes.length];
    return {
      dayIndex,
      theme,
      totalMinutes: minutes,
      actions: [
        {
          slotId: `slot_day_${dayIndex}`,
          title: `${theme}：${intensityCopy}`,
          description: `${levelLabel(input.currentLevel)}，围绕“${input.goalTitle}”留下可以检查的结果。`,
          estimatedMinutes: minutes,
        },
      ],
    };
  });
  return {
    stage: {
      title: `${input.goalTitle} ${input.durationDays} 天行动计划`,
      summary: `按每周 ${input.weeklyDays} 天、每天约 ${minutes} 分钟推进，先从容易开始的小行动建立节奏。`,
      focus: input.desiredResult.slice(0, 50),
      durationDays: input.durationDays,
    },
    days,
  };
}

function publicPreview(preview, reused = true) {
  return {
    previewId: String(preview._id),
    requestId: String(preview.requestId),
    stageNumber: Number(preview.stageNumber || 1),
    generatedBy: preview.generatedBy === "ai" ? "ai" : "template",
    stagePlan: preview.stagePlan,
    reused,
    revision: Number(preview.revision || 1),
    editedSlotIds: Array.isArray(preview.editedSlotIds) ? preview.editedSlotIds : [],
    optimizationStatus: preview.optimizationStatus || "idle",
    optimizationAttempts: Number(preview.optimizationAttempts || 0),
  };
}

async function getOwnedPreview(openid, previewId) {
  const result = await db
    .collection("stage_previews")
    .doc(String(previewId || ""))
    .get()
    .catch(() => null);
  const preview = result && result.data;
  if (!preview || preview._openid !== openid) {
    fail("STAGE_PREVIEW_NOT_FOUND", "计划预览不存在。");
  }
  const expiresAt = new Date(preview.expiresAt || 0).getTime();
  if (
    preview.status === "preview" &&
    Number.isFinite(expiresAt) &&
    expiresAt <= Date.now()
  ) {
    fail("STAGE_PREVIEW_NOT_FOUND", "计划预览已过期。");
  }
  return preview;
}

async function createStagePreview(openid, event) {
  const requestId = validateStageRequestId(event && event.requestId);
  const input = validateCreateStagePreviewInput(event && event.input);
  const previewId = stableId("stage_preview", `${openid}:${requestId}`);
  const existing = await getOwnedPreview(openid, previewId).catch(() => null);
  if (existing) return publicPreview(existing, true);

  const activeGoalResult = await db
    .collection("goals")
    .where({ _openid: openid, status: "active" })
    .limit(1)
    .get();
  if (activeGoalResult.data.length) {
    fail("ACTIVE_GOAL_ALREADY_EXISTS", "你已经有一个进行中的目标。");
  }

  const stagePlan = buildBaseStagePlan(input);
  await db.collection("stage_previews").doc(previewId).set({
    data: {
      _openid: openid,
      requestId,
      stageNumber: 1,
      generationInput: input,
      stagePlan,
      generatedBy: "template",
      status: "preview",
      revision: 1,
      editedSlotIds: [],
      lastMutationId: "",
      optimizationStatus: "idle",
      optimizationAttempts: 0,
      optimizationPlan: null,
      expiresAt: new Date(Date.now() + PREVIEW_LIFETIME_MILLISECONDS),
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  return publicPreview(await getOwnedPreview(openid, previewId), false);
}

function buildOptimizationPrompt(input, basePlan) {
  const slots = basePlan.days
    .filter((day) => day.actions.length === 1)
    .map((day) => ({
      dayIndex: day.dayIndex,
      theme: day.theme,
      slotId: day.actions[0].slotId,
      estimatedMinutes: day.actions[0].estimatedMinutes,
    }));
  return `你是成长计划优化助手。只返回合法 JSON，不要返回 Markdown 或解释。

目标：${input.goalTitle}
期望结果：${input.desiredResult}
当前水平：${input.currentLevel}
计划强度：${input.intensity}
每天上限：${input.dailyMinutes} 分钟
计划周期：${input.durationDays} 天
长期截止日期：${input.deadline || "未设置"}

必须严格保留所有 dayIndex、休息日和 slotId。不得增加、删除或移动任务。每个执行日只能有一个任务，休息日 actions 必须为空。任务时长不得超过 ${input.dailyMinutes} 分钟。

任务槽位：
${JSON.stringify(slots)}

返回结构：
{
  "stage": {
    "title": "2～30字",
    "summary": "5～150字",
    "focus": "2～50字",
    "durationDays": ${input.durationDays}
  },
  "days": [
    {
      "dayIndex": 1,
      "theme": "2～40字",
      "actions": [
        {
          "slotId": "slot_day_1",
          "title": "2～40字",
          "description": "2～150字",
          "estimatedMinutes": 30
        }
      ]
    }
  ]
}`;
}

function parseAiJson(text) {
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

function validateOptimizedPlan(candidate, input, basePlan) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !hasExactKeys(candidate, ["stage", "days"]) ||
    !candidate.stage ||
    !hasExactKeys(candidate.stage, ["title", "summary", "focus", "durationDays"]) ||
    !Array.isArray(candidate.days)
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "AI 计划结构无效。");
  }
  if (
    !safeText(candidate.stage.title, 2, 30) ||
    !safeText(candidate.stage.summary, 5, 150) ||
    !safeText(candidate.stage.focus, 2, 50) ||
    candidate.stage.durationDays !== input.durationDays ||
    candidate.days.length !== basePlan.days.length
  ) {
    fail("AI_RESPONSE_SCHEMA_INVALID", "AI 阶段信息无效。");
  }

  const days = candidate.days.map((day, index) => {
    const baseDay = basePlan.days[index];
    if (
      !day ||
      !hasOnlyKeys(day, ["dayIndex", "theme", "actions", "totalMinutes"]) ||
      !["dayIndex", "theme", "actions"].every((key) =>
        Object.prototype.hasOwnProperty.call(day, key),
      ) ||
      day.dayIndex !== baseDay.dayIndex ||
      !safeText(day.theme, 2, 40) ||
      !Array.isArray(day.actions) ||
      day.actions.length !== baseDay.actions.length
    ) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "AI 改变了计划执行日。");
    }
    if (baseDay.actions.length === 0) {
      return { dayIndex: day.dayIndex, theme: day.theme.trim(), totalMinutes: 0, actions: [] };
    }
    const action = day.actions[0];
    const baseAction = baseDay.actions[0];
    if (
      !action ||
      !hasExactKeys(action, ["slotId", "title", "description", "estimatedMinutes"]) ||
      action.slotId !== baseAction.slotId ||
      !safeText(action.title, 2, 40) ||
      !safeText(action.description, 2, 150) ||
      !Number.isInteger(action.estimatedMinutes) ||
      action.estimatedMinutes < 5 ||
      action.estimatedMinutes > input.dailyMinutes
    ) {
      fail("AI_RESPONSE_SCHEMA_INVALID", "AI 任务内容无效。");
    }
    return {
      dayIndex: day.dayIndex,
      theme: day.theme.trim(),
      totalMinutes: action.estimatedMinutes,
      actions: [
        {
          slotId: action.slotId,
          title: action.title.trim(),
          description: action.description.trim(),
          estimatedMinutes: action.estimatedMinutes,
        },
      ],
    };
  });
  return {
    stage: {
      title: candidate.stage.title.trim(),
      summary: candidate.stage.summary.trim(),
      focus: candidate.stage.focus.trim(),
      durationDays: candidate.stage.durationDays,
    },
    days,
  };
}

async function optimizeStagePreview(openid, event) {
  const previewId = String((event && event.previewId) || "");
  const preview = await db.runTransaction(async (transaction) => {
    const record = await transaction
      .collection("stage_previews")
      .doc(previewId)
      .get()
      .catch(() => null);
    const current = record && record.data;
    if (!current || current._openid !== openid) {
      fail("STAGE_PREVIEW_NOT_FOUND", "计划预览不存在。");
    }
    if (current.status !== "preview") {
      fail("STAGE_ALREADY_CONFIRMED", "当前计划已经确认。");
    }
    if (current.optimizationStatus === "ready") return current;
    if (current.optimizationStatus === "processing") {
      const updatedAt =
        current.updatedAt instanceof Date
          ? current.updatedAt.getTime()
          : current.updatedAt && current.updatedAt.$date
            ? new Date(current.updatedAt.$date).getTime()
            : new Date(current.updatedAt || 0).getTime();
      if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < 55 * 1000) {
        fail("STAGE_OPTIMIZATION_IN_PROGRESS", "AI 正在优化当前计划。");
      }
    }
    if (Number(current.optimizationAttempts || 0) >= MAX_OPTIMIZATION_ATTEMPTS) {
      fail("STAGE_OPTIMIZATION_LIMIT_REACHED", "AI 优化次数已用完。");
    }
    const optimizationAttempts = Number(current.optimizationAttempts || 0) + 1;
    await transaction.collection("stage_previews").doc(previewId).update({
      data: {
        optimizationStatus: "processing",
        optimizationAttempts,
        updatedAt: db.serverDate(),
      },
    });
    return {
      ...current,
      optimizationStatus: "processing",
      optimizationAttempts,
    };
  });
  if (preview.optimizationStatus === "ready") return publicPreview(preview);
  const provider = createStagePlanProvider();
  const prompt = buildOptimizationPrompt(preview.generationInput, preview.stagePlan);
  let optimizedPlan = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = await provider.generateStagePlan(
        attempt === 0 ? prompt : `${prompt}\n上一份输出未通过校验，请重新返回完整 JSON。`,
        attempt === 0 ? 18000 : 16000,
      );
      optimizedPlan = validateOptimizedPlan(
        parseAiJson(output),
        preview.generationInput,
        preview.stagePlan,
      );
      break;
    } catch (error) {
      lastError = error;
      console.warn("stage V2 optimization attempt failed", {
        code: error.code || "AI_REQUEST_FAILED",
        attempt: attempt + 1,
      });
    }
  }

  await db.collection("stage_previews").doc(preview._id).update({
    data: optimizedPlan
      ? {
          optimizationStatus: "ready",
          optimizationPlan: optimizedPlan,
          updatedAt: db.serverDate(),
        }
      : {
          optimizationStatus: "failed",
          optimizationPlan: null,
          optimizationErrorCode: (lastError && lastError.code) || "AI_REQUEST_FAILED",
          updatedAt: db.serverDate(),
        },
  });
  return publicPreview(await getOwnedPreview(openid, preview._id));
}

function validateTaskUpdate(event, preview) {
  const revision = Number(event && event.revision);
  if (!Number.isInteger(revision) || revision !== Number(preview.revision || 1)) {
    fail("STAGE_PREVIEW_CONFLICT", "计划已发生变化，请刷新后重试。");
  }
  const mutationId = String((event && event.mutationId) || "");
  if (!/^edit_[a-zA-Z0-9_]{8,80}$/.test(mutationId)) {
    fail("INVALID_ARGUMENT", "编辑请求标识无效。");
  }
  const slotId = String((event && event.slotId) || "");
  const task = event && event.task;
  if (
    !/^slot_day_\d{1,2}$/.test(slotId) ||
    !task ||
    typeof task !== "object" ||
    !hasOnlyKeys(task, ["title", "description", "estimatedMinutes"]) ||
    !safeText(task.title, 2, 40) ||
    !safeText(task.description, 2, 150) ||
    !Number.isInteger(task.estimatedMinutes) ||
    task.estimatedMinutes < 5 ||
    task.estimatedMinutes > preview.generationInput.dailyMinutes
  ) {
    fail("INVALID_ARGUMENT", "任务内容无效。");
  }
  return {
    revision,
    mutationId,
    slotId,
    task: {
      slotId,
      title: task.title.trim(),
      description: task.description.trim(),
      estimatedMinutes: task.estimatedMinutes,
    },
  };
}

function mergeOptimizationPlan(stagePlan, optimizationPlan, editedSlotIds) {
  const edited = new Set(editedSlotIds || []);
  const currentBySlot = new Map();
  stagePlan.days.forEach((day) => {
    if (day.actions[0]) currentBySlot.set(day.actions[0].slotId, day.actions[0]);
  });
  const days = optimizationPlan.days.map((day) => {
    if (!day.actions[0]) return day;
    const optimizedAction = day.actions[0];
    const action = edited.has(optimizedAction.slotId)
      ? currentBySlot.get(optimizedAction.slotId)
      : optimizedAction;
    return {
      ...day,
      totalMinutes: action.estimatedMinutes,
      actions: [action],
    };
  });
  return {
    stage: optimizationPlan.stage,
    days,
  };
}

async function updateStagePreviewTask(openid, event) {
  const previewId = String((event && event.previewId) || "");
  const result = await db.runTransaction(async (transaction) => {
    const record = await transaction
      .collection("stage_previews")
      .doc(previewId)
      .get()
      .catch(() => null);
    const preview = record && record.data;
    if (!preview || preview._openid !== openid) {
      fail("STAGE_PREVIEW_NOT_FOUND", "计划预览不存在。");
    }
    if (preview.status !== "preview") {
      fail("STAGE_ALREADY_CONFIRMED", "当前计划已经确认。");
    }
    if (preview.lastMutationId && preview.lastMutationId === event.mutationId) {
      return preview;
    }
    const update = validateTaskUpdate(event, preview);
    let found = false;
    const stagePlan = {
      ...preview.stagePlan,
      days: preview.stagePlan.days.map((day) => {
        if (!day.actions.length || day.actions[0].slotId !== update.slotId) return day;
        found = true;
        return {
          ...day,
          totalMinutes: update.task.estimatedMinutes,
          actions: [update.task],
        };
      }),
    };
    if (!found) fail("INVALID_ARGUMENT", "任务槽位不存在。");
    const editedSlotIds = Array.from(
      new Set([...(preview.editedSlotIds || []), update.slotId]),
    );
    await transaction.collection("stage_previews").doc(previewId).update({
      data: {
        stagePlan,
        editedSlotIds,
        lastMutationId: update.mutationId,
        revision: update.revision + 1,
        updatedAt: db.serverDate(),
      },
    });
    return {
      ...preview,
      stagePlan,
      editedSlotIds,
      lastMutationId: update.mutationId,
      revision: update.revision + 1,
    };
  });
  return publicPreview(result);
}

async function applyStageOptimization(openid, event) {
  const previewId = String((event && event.previewId) || "");
  const revision = Number(event && event.revision);
  const result = await db.runTransaction(async (transaction) => {
    const record = await transaction
      .collection("stage_previews")
      .doc(previewId)
      .get()
      .catch(() => null);
    const preview = record && record.data;
    if (!preview || preview._openid !== openid) {
      fail("STAGE_PREVIEW_NOT_FOUND", "计划预览不存在。");
    }
    if (preview.status !== "preview") {
      fail("STAGE_ALREADY_CONFIRMED", "当前计划已经确认。");
    }
    if (revision !== Number(preview.revision || 1)) {
      fail("STAGE_PREVIEW_CONFLICT", "计划已发生变化，请刷新后重试。");
    }
    if (preview.optimizationStatus !== "ready" || !preview.optimizationPlan) {
      fail("STAGE_OPTIMIZATION_NOT_READY", "AI 优化结果尚未准备好。");
    }
    const stagePlan = mergeOptimizationPlan(
      preview.stagePlan,
      preview.optimizationPlan,
      preview.editedSlotIds,
    );
    await transaction.collection("stage_previews").doc(previewId).update({
      data: {
        stagePlan,
        generatedBy: "ai",
        optimizationStatus: "idle",
        optimizationPlan: null,
        revision: revision + 1,
        updatedAt: db.serverDate(),
      },
    });
    return {
      ...preview,
      stagePlan,
      generatedBy: "ai",
      optimizationStatus: "idle",
      optimizationPlan: null,
      revision: revision + 1,
    };
  });
  return publicPreview(result);
}

module.exports = {
  ACTIVE_WEEK_DAYS,
  GOAL_TEMPLATES,
  PLAN_DURATIONS,
  applyStageOptimization,
  buildBaseStagePlan,
  createStagePreview,
  isExecutionDay,
  mergeOptimizationPlan,
  optimizeStagePreview,
  publicPreview,
  updateStagePreviewTask,
  validateCreateStagePreviewInput,
  validateOptimizedPlan,
};
