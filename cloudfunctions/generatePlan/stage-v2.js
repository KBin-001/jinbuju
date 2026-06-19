const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { createStagePlanProvider } = require("./stage-ai");
const { addBusinessDays, formatBusinessDate } = require("./date");
const { stableId } = require("./repository");
const { DANGEROUS_CONTENT } = require("./constants");
const { getOwnedAnalysis } = require("./goal-analysis");
const {
  GENERATED_STAGE_SCHEMA_VERSION,
  evaluateFeedbackResolution,
  evaluateStagePlanQuality,
  validateFeedbackNote,
  validateFeedbackTypes,
  validateGeneratedStagePlan,
  validateStageRequestId,
} = require("./stage-validate");
const {
  DIRECT_STAGE_PROMPT_VERSION,
  STAGE_REGENERATION_PROMPT_VERSION,
  buildCurrentPlanSummary,
  buildDirectStageGenerationPrompt,
  buildDirectStageRepairPrompt,
  buildStageRegenerationPrompt,
  buildStageRegenerationRepairPrompt,
} = require("./stage-prompt");

const db = cloud.database();
const PLAN_DURATIONS = [1, 2, 3, 4, 5, 6, 7];
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
const MAX_STAGE_REGENERATIONS = 2;
const STAGE_GENERATION_TIMEOUT_MS = 45000;
const STAGE_REPAIR_TIMEOUT_MS = 30000;
const DEFAULT_MODEL_ID = process.env.CLOUDBASE_AI_MODEL || "hy3-preview";
const DEFAULT_PROVIDER_GROUP = process.env.CLOUDBASE_AI_PROVIDER || "cloudbase";

function shortError(error) {
  return {
    code: error && error.code ? String(error.code).slice(0, 80) : "UNKNOWN",
    errCode: error && error.errCode !== undefined ? String(error.errCode).slice(0, 80) : "",
    errMsg: error && error.errMsg ? String(error.errMsg).slice(0, 200) : "",
    message: error && error.message ? String(error.message).slice(0, 200) : "",
  };
}

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
        ? `根据用户目标“${customGoalTitle}”完成第一个可验证的行动阶段`
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

function goalTypeFromInput(input) {
  if (["python", "ai_tools", "video_editing"].includes(input.templateId)) return "skill";
  if (["resume", "interview"].includes(input.templateId)) return "project";
  if (["cet4", "teacher_exam"].includes(input.templateId)) return "outcome";
  if (/习惯|作息|阅读/.test(input.goalTitle)) return "habit";
  if (/博客|小程序|项目|制作|完成/.test(input.goalTitle)) return "project";
  if (/学|练|摄影|烹饪|驱动|搏击|技能/.test(input.goalTitle)) return "skill";
  return "outcome";
}

function categoryGroupFromInput(input) {
  const title = input.goalTitle;
  if (input.category === "exam" || /四级|考试|备考|教师资格|考研/.test(title)) return "learning";
  if (input.category === "career" || /求职|简历|面试|岗位/.test(title)) return "career";
  if (/作息|健康|运动|搏击|体能|睡眠/.test(title)) return "health";
  if (/习惯|阅读/.test(title)) return "habit";
  if (/摄影|写作|视频|创作/.test(title)) return "creative";
  if (/博客|小程序|项目|Android|驱动/.test(title)) return "project";
  if (/烹饪|生活|整理/.test(title)) return "life";
  if (input.category === "skill") return "learning";
  return "other";
}

function buildGoalProfile(input) {
  return {
    title: input.goalTitle,
    desiredOutcome: input.desiredResult,
    domainLabel: GOAL_TEMPLATES[input.templateId]?.title || input.goalTitle,
    goalType: goalTypeFromInput(input),
    categoryGroup: categoryGroupFromInput(input),
    currentLevel: input.currentLevel,
    intensity: input.intensity,
    dailyMinutes: input.dailyMinutes,
    durationDays: input.durationDays,
    deadline: input.deadline || "",
    weeklyFrequency: input.weeklyDays,
    constraints: [],
    availableResources: [],
    preferences: [],
  };
}

function inputFromGoalProfile(profile) {
  return {
    templateId: "",
    customGoalTitle: profile.title,
    goalTitle: profile.title,
    category:
      profile.categoryGroup === "career"
        ? "career"
        : profile.categoryGroup === "health"
          ? "fitness"
          : profile.categoryGroup === "habit"
            ? "habit"
            : "skill",
    desiredResult: profile.desiredOutcome || profile.title,
    currentLevel: profile.currentLevel || "zero",
    dailyMinutes: Number(profile.dailyMinutes || 30),
    weeklyDays: Number(profile.weeklyFrequency || 5),
    intensity: profile.intensity || "normal",
    durationDays: Number(profile.durationDays || 7),
    deadline: profile.deadline || "",
    targetDuration: "long_term",
    stageNumber: 1,
  };
}

function isExecutionDay(dayIndex, weeklyDays, durationDays) {
  if (durationDays <= 7) return true;
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
    if (!isExecutionDay(dayIndex, input.weeklyDays, input.durationDays)) {
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
      summary: input.durationDays <= 7
        ? `每天约 ${minutes} 分钟推进，先从容易开始的小行动建立节奏。`
        : `按每周 ${input.weeklyDays} 天、每天约 ${minutes} 分钟推进，先从容易开始的小行动建立节奏。`,
      focus: input.desiredResult.slice(0, 50),
      durationDays: input.durationDays,
    },
    days,
  };
}

function publicPreview(preview, reused = true) {
  const generatedBy = ["ai", "ai_repaired", "template", "regenerated_ai", "regenerated_ai_repaired"].includes(preview.generatedBy)
    ? preview.generatedBy
    : "template";
  return {
    previewId: String(preview._id),
    requestId: String(preview.requestId),
    stageNumber: Number(preview.stageNumber || 1),
    generatedBy,
    generationSource: generatedBy,
    stagePlan: preview.stagePlan,
    reused,
    revision: Number(preview.revision || 1),
    editedSlotIds: Array.isArray(preview.editedSlotIds) ? preview.editedSlotIds : [],
    optimizationStatus: preview.optimizationStatus || "idle",
    optimizationAttempts: Number(preview.optimizationAttempts || 0),
    fallbackReason: preview.fallbackReason || "",
    currentVersion: Number(preview.currentVersion || 1),
    regenerationCount: Number(preview.regenerationCount || 0),
    maxRegenerationCount: Number(preview.maxRegenerationCount || MAX_STAGE_REGENERATIONS),
    generationStatus: preview.generationStatus || "ready",
    lastFeedback: preview.lastFeedback || null,
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
  let analysisRecord = null;
  let input;
  let goalProfile;
  if (event && event.analysisId) {
    analysisRecord = await getOwnedAnalysis(openid, event.analysisId);
    if (analysisRecord.status === "consumed" && analysisRecord.previewId) {
      const existingPreview = await getOwnedPreview(openid, analysisRecord.previewId).catch(() => null);
      if (existingPreview) return publicPreview(existingPreview, true);
    }
    if (analysisRecord.status !== "ready" || !analysisRecord.goalProfile) {
      fail("INVALID_ARGUMENT", "请先完成目标澄清。");
    }
    goalProfile = analysisRecord.goalProfile;
    input = inputFromGoalProfile(goalProfile);
  } else {
    input = validateCreateStagePreviewInput(event && event.input);
    goalProfile = buildGoalProfile(input);
  }
  const previewId = stableId("stage_preview", `${openid}:${requestId}`);
  const existingRecord = await db.collection("stage_previews").doc(previewId).get().catch(() => null);
  const existing = existingRecord && existingRecord.data;
  if (existing && existing._openid === openid) {
    if (existing.status === "generating") {
      fail("STAGE_GENERATION_IN_PROGRESS", "AI 正在生成当前阶段。");
    }
    if (existing.status === "preview" || existing.status === "confirmed") {
      return publicPreview(existing, true);
    }
  }

  const activeGoalResult = await db
    .collection("goals")
    .where({ _openid: openid, status: "active" })
    .limit(1)
    .get();
  if (activeGoalResult.data.length) {
    fail("ACTIVE_GOAL_ALREADY_EXISTS", "你已经有一个进行中的目标。");
  }

  await db.collection("stage_previews").doc(previewId).set({
    data: {
      _openid: openid,
      requestId,
      stageNumber: 1,
      generationInput: input,
      status: "generating",
      generationStatus: "generating",
      revision: 1,
      editedSlotIds: [],
      lastMutationId: "",
      optimizationStatus: "idle",
      optimizationAttempts: 0,
      optimizationPlan: null,
      currentVersion: 1,
      regenerationCount: 0,
      maxRegenerationCount: MAX_STAGE_REGENERATIONS,
      lastFeedback: null,
      expiresAt: new Date(Date.now() + PREVIEW_LIFETIME_MILLISECONDS),
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  const generationStartedAt = Date.now();
  let stagePlan = null;
  let generatedBy = "template";
  let repairAttempted = false;
  let fallbackReason = "";
  let modelId = DEFAULT_MODEL_ID;
  let providerGroup = DEFAULT_PROVIDER_GROUP;
  let totalTokens = 0;
  if (!event.forceFallback) {
    const provider = createStagePlanProvider();
    const inputFieldNames = Object.keys(goalProfile);
    let firstOutput = "";
    let firstProblems = [];
    try {
      const prompt = buildDirectStageGenerationPrompt(goalProfile);
      const result = await provider.generateStagePlanWithMetadata(
        prompt,
        STAGE_GENERATION_TIMEOUT_MS,
        {
          action: "createStagePreview",
          promptVersion: DIRECT_STAGE_PROMPT_VERSION,
          schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
          inputFieldNames,
          durationDays: input.durationDays,
          dailyMinutes: input.dailyMinutes,
          repairAttempted: false,
        },
      );
      firstOutput = result.text;
      modelId = result.metadata.modelId || modelId;
      providerGroup = result.metadata.providerGroup || providerGroup;
      totalTokens += Number(result.metadata.totalTokens || 0);
      const parsed = parseAiJson(firstOutput);
      const candidate = validateGeneratedStagePlan(parsed, goalProfile);
      const quality = evaluateStagePlanQuality(candidate, goalProfile);
      if (quality.shouldRepair) {
        firstProblems = quality.problems;
        const error = new Error("QUALITY_REPAIR_REQUIRED");
        error.code = "QUALITY_REPAIR_REQUIRED";
        throw error;
      }
      stagePlan = candidate;
      generatedBy = "ai";
      console.info("stage direct generation accepted", {
        action: "createStagePreview",
        providerGroup,
        modelId,
        promptVersion: DIRECT_STAGE_PROMPT_VERSION,
        schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
        durationDays: input.durationDays,
        dailyMinutes: input.dailyMinutes,
        generationDurationMs: Date.now() - generationStartedAt,
        parseSucceeded: true,
        schemaSucceeded: true,
        qualityPassed: true,
        repairAttempted: false,
        generationSource: "ai",
        totalTokens,
      });
    } catch (firstError) {
      fallbackReason = firstError.code || "AI_REQUEST_FAILED";
      firstProblems = firstProblems.length ? firstProblems : [fallbackReason];
      console.warn("stage direct generation needs repair", {
        action: "createStagePreview",
        code: fallbackReason,
        error: shortError(firstError),
        firstProblems,
        promptVersion: DIRECT_STAGE_PROMPT_VERSION,
        schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
        durationDays: input.durationDays,
        dailyMinutes: input.dailyMinutes,
      });
      try {
        if (firstError.code === "AI_REQUEST_TIMEOUT" && !firstOutput) {
          const timeoutError = new Error("AI_REQUEST_TIMEOUT");
          timeoutError.code = "AI_REQUEST_TIMEOUT";
          throw timeoutError;
        }
        repairAttempted = true;
        const repairPrompt = buildDirectStageRepairPrompt(goalProfile, firstOutput, firstProblems);
        const repaired = await provider.generateStagePlanWithMetadata(
          repairPrompt,
          STAGE_REPAIR_TIMEOUT_MS,
          {
            action: "createStagePreviewRepair",
            promptVersion: DIRECT_STAGE_PROMPT_VERSION,
            schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
            inputFieldNames,
            durationDays: input.durationDays,
            dailyMinutes: input.dailyMinutes,
            repairAttempted: true,
          },
        );
        modelId = repaired.metadata.modelId || modelId;
        providerGroup = repaired.metadata.providerGroup || providerGroup;
        totalTokens += Number(repaired.metadata.totalTokens || 0);
        const repairedPlan = validateGeneratedStagePlan(parseAiJson(repaired.text), goalProfile);
        const repairedQuality = evaluateStagePlanQuality(repairedPlan, goalProfile);
        if (repairedQuality.shouldRepair) {
          const error = new Error("QUALITY_REPAIR_FAILED");
          error.code = "QUALITY_REPAIR_FAILED";
          error.problems = repairedQuality.problems;
          throw error;
        }
        stagePlan = repairedPlan;
        generatedBy = "ai_repaired";
        fallbackReason = "";
      } catch (repairError) {
        fallbackReason = repairError.code || fallbackReason || "AI_REQUEST_FAILED";
        console.warn("stage direct generation using template fallback", {
          action: "createStagePreview",
          code: fallbackReason,
          firstFailure: shortError(firstError),
          repairFailure: shortError(repairError),
          repairProblems: Array.isArray(repairError.problems) ? repairError.problems : [],
          firstProblems,
          promptVersion: DIRECT_STAGE_PROMPT_VERSION,
          schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
          durationDays: input.durationDays,
          dailyMinutes: input.dailyMinutes,
          repairAttempted,
          generationSource: "template",
        });
      }
    }
  } else {
    fallbackReason = "FORCE_FALLBACK";
  }

  if (!stagePlan) {
    stagePlan = buildBaseStagePlan(input);
    generatedBy = "template";
  }

  await db.collection("stage_previews").doc(previewId).set({
    data: {
      _openid: openid,
      requestId,
      stageNumber: 1,
      generationInput: input,
      stagePlan,
      goalProfile,
      analysisId: analysisRecord ? analysisRecord._id : "",
      generatedBy,
      status: "preview",
      generationStatus: "ready",
      modelId,
      providerGroup,
      promptVersion: DIRECT_STAGE_PROMPT_VERSION,
      schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
      generationDurationMs: Date.now() - generationStartedAt,
      repairAttempted,
      fallbackReason,
      revision: 1,
      editedSlotIds: [],
      lastMutationId: "",
      optimizationStatus: "idle",
      optimizationAttempts: 0,
      optimizationPlan: null,
      currentVersion: 1,
      regenerationCount: 0,
      maxRegenerationCount: MAX_STAGE_REGENERATIONS,
      lastFeedback: null,
      expiresAt: new Date(Date.now() + PREVIEW_LIFETIME_MILLISECONDS),
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  if (analysisRecord) {
    await db.collection("goal_analysis_drafts").doc(analysisRecord._id).update({
      data: {
        status: "consumed",
        previewId,
        updatedAt: db.serverDate(),
      },
    }).catch((error) => {
      console.warn("goal analysis consume mark failed", {
        analysisIdSuffix: String(analysisRecord._id || "").slice(-8),
        code: error && error.code ? String(error.code).slice(0, 80) : "UNKNOWN",
        errCode: error && error.errCode !== undefined ? String(error.errCode).slice(0, 80) : "",
        errMsg: error && error.errMsg ? String(error.errMsg).slice(0, 160) : "",
      });
    });
  }
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
    !/^slot_day_\d{1,2}(?:_\d{1,2})?$/.test(slotId) ||
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

async function regenerateStagePreview(openid, event) {
  const previewId = String((event && event.previewId) || "");
  const feedbackTypes = validateFeedbackTypes(event && event.feedbackTypes);
  const feedbackNote = validateFeedbackNote(event && event.feedbackNote);
  validateStageRequestId(event && event.requestId);

  const preview = await getOwnedPreview(openid, previewId);

  if (preview.status !== "preview") {
    fail("PREVIEW_ALREADY_CONFIRMED", "当前计划已经确认。");
  }

  if (preview.generationStatus === "regenerating") {
    const updatedAt =
      preview.updatedAt instanceof Date
        ? preview.updatedAt.getTime()
        : preview.updatedAt && preview.updatedAt.$date
          ? new Date(preview.updatedAt.$date).getTime()
          : new Date(preview.updatedAt || 0).getTime();
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < 2 * 60 * 1000) {
      fail("PREVIEW_REGENERATION_IN_PROGRESS", "AI 正在重新生成方案。");
    }
  }

  const currentCount = Number(preview.regenerationCount || 0);
  if (currentCount >= MAX_STAGE_REGENERATIONS) {
    fail("STAGE_REGENERATION_LIMIT_REACHED", "重新生成次数已用完。");
  }

  const goalProfile = preview.goalProfile;
  if (!goalProfile) {
    fail("INTERNAL_ERROR", "目标资料不存在。");
  }
  const currentPlan = preview.stagePlan;
  if (!currentPlan) {
    fail("INTERNAL_ERROR", "当前方案不存在。");
  }

  await db.collection("stage_previews").doc(previewId).update({
    data: {
      generationStatus: "regenerating",
      updatedAt: db.serverDate(),
    },
  });

  const currentPlanSummary = buildCurrentPlanSummary(currentPlan);
  const previousQualityProblems = [];
  const context = {
    goalProfile,
    currentPlanSummary,
    feedback: { types: feedbackTypes, note: feedbackNote },
    previousQualityProblems,
    regenerationAttempt: currentCount + 1,
  };

  const generationStartedAt = Date.now();
  let newStagePlan = null;
  let generatedBy = "template";
  let modelId = preview.modelId || DEFAULT_MODEL_ID;
  let providerGroup = preview.providerGroup || DEFAULT_PROVIDER_GROUP;
  let totalTokens = 0;
  let firstOutput = "";
  let firstProblems = [];

  try {
    const provider = createStagePlanProvider();
    const prompt = buildStageRegenerationPrompt(context);
    const result = await provider.generateStagePlanWithMetadata(prompt, 22000, {
      action: "regenerateStagePreview",
      promptVersion: STAGE_REGENERATION_PROMPT_VERSION,
      schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
      durationDays: goalProfile.durationDays,
      dailyMinutes: goalProfile.dailyMinutes,
      repairAttempted: false,
    });
    firstOutput = result.text;
    modelId = result.metadata.modelId || modelId;
    providerGroup = result.metadata.providerGroup || providerGroup;
    totalTokens += Number(result.metadata.totalTokens || 0);

    const parsed = parseAiJson(firstOutput);
    const candidate = validateGeneratedStagePlan(parsed, goalProfile);
    const quality = evaluateStagePlanQuality(candidate, goalProfile);
    if (quality.shouldRepair) {
      firstProblems = quality.problems;
      const error = new Error("QUALITY_REPAIR_REQUIRED");
      error.code = "QUALITY_REPAIR_REQUIRED";
      throw error;
    }

    const resolution = evaluateFeedbackResolution(candidate, currentPlan, feedbackTypes, goalProfile);
    if (!resolution.resolved) {
      firstProblems.push(...resolution.problems);
      const error = new Error("FEEDBACK_NOT_RESOLVED");
      error.code = "FEEDBACK_NOT_RESOLVED";
      throw error;
    }

    newStagePlan = candidate;
    generatedBy = "regenerated_ai";
    console.info("stage regeneration accepted", {
      action: "regenerateStagePreview",
      providerGroup,
      modelId,
      promptVersion: STAGE_REGENERATION_PROMPT_VERSION,
      durationDays: goalProfile.durationDays,
      dailyMinutes: goalProfile.dailyMinutes,
      generationDurationMs: Date.now() - generationStartedAt,
      generationSource: "regenerated_ai",
      feedbackTypes,
      totalTokens,
    });
  } catch (firstError) {
    firstProblems = firstProblems.length ? firstProblems : [firstError.code || "AI_REQUEST_FAILED"];
    console.warn("stage regeneration needs repair", {
      action: "regenerateStagePreview",
      code: firstError.code || "AI_REQUEST_FAILED",
      promptVersion: STAGE_REGENERATION_PROMPT_VERSION,
    });
    try {
      const provider = createStagePlanProvider();
      const repairPrompt = buildStageRegenerationRepairPrompt(context, firstOutput, firstProblems);
      const repaired = await provider.generateStagePlanWithMetadata(repairPrompt, 18000, {
        action: "regenerateStagePreviewRepair",
        promptVersion: STAGE_REGENERATION_PROMPT_VERSION,
        schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
        durationDays: goalProfile.durationDays,
        dailyMinutes: goalProfile.dailyMinutes,
        repairAttempted: true,
      });
      modelId = repaired.metadata.modelId || modelId;
      providerGroup = repaired.metadata.providerGroup || providerGroup;
      totalTokens += Number(repaired.metadata.totalTokens || 0);

      const repairedPlan = validateGeneratedStagePlan(parseAiJson(repaired.text), goalProfile);
      const repairedQuality = evaluateStagePlanQuality(repairedPlan, goalProfile);
      if (repairedQuality.shouldRepair) {
        const error = new Error("QUALITY_REPAIR_FAILED");
        error.code = "QUALITY_REPAIR_FAILED";
        error.problems = repairedQuality.problems;
        throw error;
      }

      const repairedResolution = evaluateFeedbackResolution(
        repairedPlan, currentPlan, feedbackTypes, goalProfile,
      );
      if (!repairedResolution.resolved) {
        console.warn("regeneration repair passed quality but not all feedback resolved", {
          unresolvedTypes: repairedResolution.unresolvedFeedbackTypes,
        });
      }

      newStagePlan = repairedPlan;
      generatedBy = "regenerated_ai_repaired";
    } catch (repairError) {
      console.warn("stage regeneration failed, keeping old plan", {
        code: repairError.code || "AI_REQUEST_FAILED",
        repairProblems: Array.isArray(repairError.problems) ? repairError.problems : [],
      });
    }
  }

  const aiCompleted = Boolean(newStagePlan);
  const newRegenerationCount = aiCompleted ? currentCount + 1 : currentCount;
  const newVersion = aiCompleted
    ? Number(preview.currentVersion || 1) + 1
    : Number(preview.currentVersion || 1);

  if (aiCompleted) {
    const versionDocId = `${previewId}_v${newVersion}`;
    await db
      .collection("stage_preview_versions")
      .doc(versionDocId)
      .set({
        data: {
          _openid: openid,
          previewId,
          version: newVersion,
          source: generatedBy,
          plan: newStagePlan,
          feedback: { types: feedbackTypes, note: feedbackNote },
          promptVersion: STAGE_REGENERATION_PROMPT_VERSION,
          schemaVersion: GENERATED_STAGE_SCHEMA_VERSION,
          modelId,
          providerGroup,
          generationDurationMs: Date.now() - generationStartedAt,
          totalTokens,
          createdAt: db.serverDate(),
        },
      });
  }

  const updateData = {
    generationStatus: aiCompleted ? "ready" : "failed",
    regenerationCount: newRegenerationCount,
    updatedAt: db.serverDate(),
  };
  if (aiCompleted) {
    updateData.stagePlan = newStagePlan;
    updateData.generatedBy = generatedBy;
    updateData.currentVersion = newVersion;
    updateData.modelId = modelId;
    updateData.providerGroup = providerGroup;
    updateData.generationDurationMs = Date.now() - generationStartedAt;
    updateData.revision = Number(preview.revision || 1) + 1;
    updateData.editedSlotIds = [];
    updateData.lastFeedback = { types: feedbackTypes, note: feedbackNote };
    updateData.optimizationStatus = "idle";
    updateData.optimizationPlan = null;
  }
  await db.collection("stage_previews").doc(previewId).update({ data: updateData });

  const updatedPreview = await getOwnedPreview(openid, previewId);
  return publicPreview(updatedPreview, false);
}

module.exports = {
  ACTIVE_WEEK_DAYS,
  GOAL_TEMPLATES,
  MAX_STAGE_REGENERATIONS,
  PLAN_DURATIONS,
  applyStageOptimization,
  buildBaseStagePlan,
  buildGoalProfile,
  createStagePreview,
  isExecutionDay,
  mergeOptimizationPlan,
  optimizeStagePreview,
  publicPreview,
  regenerateStagePreview,
  updateStagePreviewTask,
  validateCreateStagePreviewInput,
  validateOptimizedPlan,
};
