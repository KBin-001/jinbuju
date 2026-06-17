const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const { generateTextWithMetadata } = require("./ai");
const {
  GOAL_ANALYSIS_PROMPT_VERSION,
  buildGoalAnalysisPrompt,
  buildGoalAnalysisRepairPrompt,
} = require("./stage-prompt");
const { parseStageAiJson } = require("./stage-validate");

let dbInstance;
function getDb() {
  if (!dbInstance) dbInstance = cloud.database();
  return dbInstance;
}
const ANALYSIS_SCHEMA_VERSION = "goal-analysis-v1";
const EXPIRES_IN = 24 * 60 * 60 * 1000;
const CATEGORY_GROUPS = ["learning", "career", "health", "habit", "creative", "project", "life", "other"];
const GOAL_TYPES = ["skill", "habit", "outcome", "project"];
const QUESTION_TYPES = ["single_choice", "multiple_choice", "number", "short_text", "boolean"];
const DIMENSIONS = [
  "desired_outcome",
  "current_level",
  "target_horizon",
  "daily_time",
  "weekly_frequency",
  "available_resources",
  "constraints",
  "preferences",
  "environment",
  "safety",
];
const SENSITIVE_QUESTION = /手机号|电话|微信号|身份证|住址|真实姓名|银行卡|密码/i;

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function shortError(error) {
  return {
    code: error && error.code ? String(error.code).slice(0, 80) : "UNKNOWN",
    errCode: error && error.errCode !== undefined ? String(error.errCode).slice(0, 80) : "",
    errMsg: error && error.errMsg ? String(error.errMsg).slice(0, 200) : "",
    message: error && error.message ? String(error.message).slice(0, 200) : "",
  };
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function omitDocumentId(record) {
  const plain = toPlainJson(record || {});
  delete plain._id;
  return plain;
}

function text(value, min, max, label) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (normalized.length < min || normalized.length > max) fail("INVALID_ARGUMENT", `${label}无效。`);
  return normalized;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(Math.max(number, 0), 1);
}

function normalizeAnalyzeInput(value) {
  if (!value || typeof value !== "object") fail("INVALID_ARGUMENT", "目标信息不完整。");
  const allowed = ["title", "description", "dailyMinutes", "durationDays", "currentLevel", "intensity", "deadline"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    fail("INVALID_ARGUMENT", "目标信息包含不支持的字段。");
  }
  const input = {
    title: text(value.title, 2, 50, "目标标题"),
    description: value.description ? text(value.description, 0, 300, "目标描述") : "",
    dailyMinutes: Number.isInteger(value.dailyMinutes) ? value.dailyMinutes : 30,
    durationDays: Number.isInteger(value.durationDays) ? value.durationDays : 7,
    currentLevel: ["zero", "basic", "intermediate"].includes(value.currentLevel) ? value.currentLevel : "",
    intensity: ["light", "normal", "intensive"].includes(value.intensity) ? value.intensity : "normal",
    deadline: typeof value.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.deadline) ? value.deadline : "",
  };
  if (input.dailyMinutes < 10 || input.dailyMinutes > 180) fail("INVALID_ARGUMENT", "每日投入时间无效。");
  if (input.durationDays < 1 || input.durationDays > 7) fail("INVALID_ARGUMENT", "阶段天数无效。");
  return input;
}

function normalizeQuestion(raw, index) {
  if (!raw || typeof raw !== "object") fail("AI_RESPONSE_SCHEMA_INVALID", "澄清问题无效。");
  const id = String(raw.id || `q_${index + 1}`).trim().replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
  const dimension = DIMENSIONS.includes(raw.dimension) ? raw.dimension : "preferences";
  const type = QUESTION_TYPES.includes(raw.type) ? raw.type : "short_text";
  const question = text(raw.question, 4, 80, "问题");
  if (SENSITIVE_QUESTION.test(question)) fail("AI_RESPONSE_SCHEMA_INVALID", "问题包含敏感信息。");
  const result = {
    id: id || `q_${index + 1}`,
    dimension,
    question,
    type,
    required: raw.required !== false,
  };
  if (type === "single_choice" || type === "multiple_choice") {
    const options = Array.isArray(raw.options) ? raw.options.map((item) => String(item || "").trim()).filter(Boolean) : [];
    result.options = Array.from(new Set(options)).slice(0, type === "single_choice" ? 6 : 8);
    if (result.options.length < 2) fail("AI_RESPONSE_SCHEMA_INVALID", "选择题选项不足。");
  }
  if (type === "number") {
    result.min = Number.isFinite(Number(raw.min)) ? Number(raw.min) : 1;
    result.max = Number.isFinite(Number(raw.max)) ? Number(raw.max) : 7;
    if (result.min >= result.max || result.max > 365) fail("AI_RESPONSE_SCHEMA_INVALID", "数字题范围无效。");
  }
  if (type === "short_text") {
    result.maxLength = Math.min(Math.max(Number(raw.maxLength) || 80, 10), 200);
    result.placeholder = String(raw.placeholder || "").slice(0, 40);
  }
  return result;
}

function validateGoalAnalysisResult(raw, input) {
  if (!raw || typeof raw !== "object") fail("AI_RESPONSE_SCHEMA_INVALID", "目标分析结构无效。");
  const categoryGroup = CATEGORY_GROUPS.includes(raw.categoryGroup) ? raw.categoryGroup : "other";
  const goalType = GOAL_TYPES.includes(raw.goalType) ? raw.goalType : "outcome";
  const seenQuestions = new Set();
  const questions = [];
  for (const rawQuestion of Array.isArray(raw.questions) ? raw.questions : []) {
    const question = normalizeQuestion(rawQuestion, questions.length);
    if (!seenQuestions.has(question.question)) {
      seenQuestions.add(question.question);
      questions.push(question);
    }
    if (questions.length >= 5) break;
  }
  const needsClarification = Boolean(raw.needsClarification) && questions.length > 0;
  if (!needsClarification && questions.length > 0) questions.length = 0;
  if (needsClarification && questions.length < 1) fail("AI_RESPONSE_SCHEMA_INVALID", "需要澄清但没有问题。");
  const safety = raw.safetyContext && typeof raw.safetyContext === "object" ? raw.safetyContext : {};
  return {
    normalizedGoal: text(raw.normalizedGoal || input.title, 2, 80, "规范目标"),
    categoryGroup,
    domainLabel: text(raw.domainLabel || input.title, 2, 40, "目标领域"),
    goalType,
    ambiguityScore: clampScore(raw.ambiguityScore),
    confidenceScore: clampScore(raw.confidenceScore),
    needsClarification,
    missingDimensions: Array.isArray(raw.missingDimensions)
      ? raw.missingDimensions.filter((item) => DIMENSIONS.includes(item)).slice(0, 8)
      : [],
    questions,
    safetyContext: {
      riskLevel: ["low", "moderate", "high"].includes(safety.riskLevel) ? safety.riskLevel : "low",
      requiresProfessionalGuidance: Boolean(safety.requiresProfessionalGuidance),
      boundaries: Array.isArray(safety.boundaries)
        ? safety.boundaries.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
        : [],
    },
  };
}

function fallbackAnalysis(input) {
  const isCombat = /搏击|格斗|拳击|散打|武术|防身/.test(input.title);
  const questions = [
    {
      id: "q_desired_outcome",
      dimension: "desired_outcome",
      question: "你主要想达到什么结果？",
      type: "single_choice",
      required: true,
      options: isCombat
        ? ["提升体能和协调性", "系统学习某项搏击运动基础", "在正规场馆参加训练", "其他"]
        : ["完成一个可验证成果", "建立稳定习惯", "系统学习基础能力", "其他"],
    },
    {
      id: "q_current_level",
      dimension: "current_level",
      question: "你目前处于什么水平？",
      type: "single_choice",
      required: true,
      options: ["零基础", "有少量经验", "持续做过一段时间"],
    },
    {
      id: "q_weekly_frequency",
      dimension: "weekly_frequency",
      question: "每周大约可以安排几次？",
      type: "number",
      required: true,
      min: 1,
      max: 7,
    },
    {
      id: "q_resources",
      dimension: "available_resources",
      question: isCombat ? "目前是否可以前往正规场馆或接受教练指导？" : "你目前有哪些可用资源或条件？",
      type: isCombat ? "boolean" : "short_text",
      required: true,
      maxLength: 100,
    },
    {
      id: "q_constraints",
      dimension: "constraints",
      question: isCombat ? "是否有需要在安排运动时避开的身体限制？" : "是否存在需要避开的限制？",
      type: "short_text",
      required: false,
      maxLength: 100,
    },
  ];
  return {
    normalizedGoal: isCombat ? "在正规指导和安全环境中建立搏击运动基础并提升体能" : input.title,
    categoryGroup: isCombat ? "health" : inferCategory(input.title),
    domainLabel: isCombat ? "搏击运动基础" : input.title.slice(0, 20),
    goalType: /博客|网站|小程序|项目/.test(input.title) ? "project" : /习惯|作息|阅读/.test(input.title) ? "habit" : "skill",
    ambiguityScore: isCombat ? 0.9 : 0.75,
    confidenceScore: 0.55,
    needsClarification: true,
    missingDimensions: questions.map((item) => item.dimension),
    questions,
    safetyContext: {
      riskLevel: isCombat ? "high" : "low",
      requiresProfessionalGuidance: isCombat,
      boundaries: isCombat ? ["只安排安全基础训练和正规指导建议", "不生成伤害他人的技术指导"] : [],
    },
  };
}

function ensureClarificationForAmbiguousGoal(input, analysis) {
  const compactTitle = input.title.replace(/\s+/g, "");
  const highAmbiguity =
    !input.description &&
    /^(练出搏击|学习Python|提高英语|做一个网站|改善身体|找一份好工作)$/.test(compactTitle);
  if (!highAmbiguity || analysis.needsClarification) return analysis;
  const fallback = fallbackAnalysis(input);
  return {
    ...analysis,
    ambiguityScore: Math.max(analysis.ambiguityScore, fallback.ambiguityScore),
    needsClarification: true,
    missingDimensions: fallback.missingDimensions,
    questions: fallback.questions,
    safetyContext: fallback.safetyContext,
  };
}

function inferCategory(title) {
  if (/求职|简历|面试|工作/.test(title)) return "career";
  if (/身体|作息|运动|搏击|体能/.test(title)) return "health";
  if (/习惯|阅读/.test(title)) return "habit";
  if (/摄影|写作|创作/.test(title)) return "creative";
  if (/博客|网站|小程序|项目|CloudBase/.test(title)) return "project";
  if (/烹饪|生活/.test(title)) return "life";
  if (/英语|Python|学习|四级|考试/.test(title)) return "learning";
  return "other";
}

function buildGoalProfile(input, analysis, answers = []) {
  const byDimension = new Map();
  answers.forEach((answer) => {
    const question = analysis.questions.find((item) => item.id === answer.questionId);
    if (question) byDimension.set(question.dimension, answer.value);
  });
  const outcome = byDimension.get("desired_outcome");
  const currentLevel = byDimension.get("current_level");
  const weeklyFrequency = Number(byDimension.get("weekly_frequency") || input.weeklyDays || 0);
  const constraints = [byDimension.get("constraints")].flat().filter(Boolean).map(String);
  const resources = [byDimension.get("available_resources"), byDimension.get("environment")].flat().filter(Boolean).map(String);
  const preferences = [byDimension.get("preferences")].flat().filter(Boolean).map(String);
  return {
    title: analysis.normalizedGoal,
    description: input.description || "",
    desiredOutcome: String(outcome || analysis.normalizedGoal),
    categoryGroup: analysis.categoryGroup,
    domainLabel: analysis.domainLabel,
    goalType: analysis.goalType,
    currentLevel: String(currentLevel || input.currentLevel || "zero"),
    targetHorizon: input.deadline || `${input.durationDays} 天阶段`,
    dailyMinutes: input.dailyMinutes,
    durationDays: input.durationDays,
    intensity: input.intensity || "normal",
    deadline: input.deadline || "",
    weeklyFrequency: Number.isFinite(weeklyFrequency) && weeklyFrequency > 0 ? weeklyFrequency : 5,
    constraints,
    availableResources: resources,
    preferences,
    safetyContext: analysis.safetyContext,
  };
}

function publicAnalysis(record) {
  const analysisId = String(record._id || record.analysisId || "");
  if (record.status === "analyzing" || !record.analysis) {
    return {
      analysisId,
      normalizedGoal: "",
      categoryGroup: "other",
      domainLabel: "",
      goalType: "outcome",
      ambiguityScore: 0,
      confidenceScore: 0,
      needsClarification: false,
      missingDimensions: [],
      questions: [],
      safetyContext: {
        riskLevel: "low",
        requiresProfessionalGuidance: false,
        boundaries: [],
      },
      analysisSource: record.analysisSource || "fallback",
      status: record.status || "analyzing",
      expiresAt: record.expiresAt instanceof Date ? record.expiresAt.toISOString() : new Date(record.expiresAt).toISOString(),
    };
  }
  return {
    analysisId,
    normalizedGoal: record.analysis.normalizedGoal,
    categoryGroup: record.analysis.categoryGroup,
    domainLabel: record.analysis.domainLabel,
    goalType: record.analysis.goalType,
    ambiguityScore: record.analysis.ambiguityScore,
    confidenceScore: record.analysis.confidenceScore,
    needsClarification: record.status === "needs_clarification",
    missingDimensions: record.analysis.missingDimensions,
    questions: record.status === "needs_clarification" ? record.analysis.questions : [],
    safetyContext: record.analysis.safetyContext,
    analysisSource: record.analysisSource,
    status: record.status,
    expiresAt: record.expiresAt instanceof Date ? record.expiresAt.toISOString() : new Date(record.expiresAt).toISOString(),
  };
}

function validateAnalysisRequestId(value) {
  if (typeof value !== "string" || !/^analysis_[a-zA-Z0-9_]{8,80}$/.test(value)) {
    fail("INVALID_ARGUMENT", "目标分析请求标识无效。");
  }
  return value;
}

async function analyzeGoal(openid, event) {
  const db = getDb();
  const requestId = validateAnalysisRequestId(event && event.requestId);
  const input = normalizeAnalyzeInput(event && event.input);
  const analysisId = stableId("goal_analysis", `${openid}:${requestId}`);
  const existing = await db.collection("goal_analysis_drafts").doc(analysisId).get().catch(() => null);
  if (existing && existing.data && existing.data._openid === openid) return publicAnalysis(existing.data);

  const startedAt = Date.now();
  await db.collection("goal_analysis_drafts").doc(analysisId).set({
    data: {
      _openid: openid,
      requestId,
      originalInput: input,
      status: "analyzing",
      analysisSource: "fallback",
      promptVersion: GOAL_ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      expiresAt: new Date(Date.now() + EXPIRES_IN),
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  let analysis;
  let source = "fallback";
  let modelId = process.env.CLOUDBASE_AI_MODEL || "hy3-preview";
  let providerGroup = process.env.CLOUDBASE_AI_PROVIDER || "cloudbase";
  let repairAttempted = false;
  let firstOutput = "";
  try {
    const prompt = buildGoalAnalysisPrompt(input);
    const result = await generateTextWithMetadata(prompt, 16000, {
      action: "analyzeGoal",
      promptVersion: GOAL_ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      inputFieldNames: Object.keys(input),
    });
    firstOutput = result.text;
    modelId = result.metadata.modelId || modelId;
    providerGroup = result.metadata.providerGroup || providerGroup;
    analysis = ensureClarificationForAmbiguousGoal(
      input,
      validateGoalAnalysisResult(parseStageAiJson(firstOutput), input),
    );
    source = "ai";
  } catch (error) {
    try {
      repairAttempted = true;
      const repaired = await generateTextWithMetadata(buildGoalAnalysisRepairPrompt(input, firstOutput), 12000, {
        action: "analyzeGoalRepair",
        promptVersion: GOAL_ANALYSIS_PROMPT_VERSION,
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        inputFieldNames: Object.keys(input),
      });
      modelId = repaired.metadata.modelId || modelId;
      providerGroup = repaired.metadata.providerGroup || providerGroup;
      analysis = ensureClarificationForAmbiguousGoal(
        input,
        validateGoalAnalysisResult(parseStageAiJson(repaired.text), input),
      );
      source = "ai_repaired";
    } catch (repairError) {
      analysis = fallbackAnalysis(input);
      source = "fallback";
    }
  }
  const status = analysis.needsClarification ? "needs_clarification" : "ready";
  const goalProfile = status === "ready" ? buildGoalProfile(input, analysis, []) : null;
  const cleanAnalysis = toPlainJson(analysis);
  const cleanGoalProfile = goalProfile ? toPlainJson(goalProfile) : null;
  await db.collection("goal_analysis_drafts").doc(analysisId).update({
    data: {
      analysis: cleanAnalysis,
      answers: [],
      goalProfile: cleanGoalProfile,
      status,
      analysisSource: source,
      promptVersion: GOAL_ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      modelId,
      providerGroup,
      repairAttempted,
      analysisDurationMs: Date.now() - startedAt,
      expiresAt: new Date(Date.now() + EXPIRES_IN),
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  console.info("goal analysis completed", {
    action: "analyzeGoal",
    providerGroup,
    modelId,
    promptVersion: GOAL_ANALYSIS_PROMPT_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    inputFieldNames: Object.keys(input),
    titleLength: input.title.length,
    descriptionLength: input.description.length,
    ambiguityScore: cleanAnalysis.ambiguityScore,
    confidenceScore: cleanAnalysis.confidenceScore,
    needsClarification: cleanAnalysis.needsClarification,
    questionCount: cleanAnalysis.questions.length,
    analysisSource: source,
    repairAttempted,
    analysisDurationMs: Date.now() - startedAt,
  });
  const saved = await db.collection("goal_analysis_drafts").doc(analysisId).get();
  return publicAnalysis({ ...saved.data, _id: saved.data._id || analysisId });
}

async function getOwnedAnalysis(openid, analysisId) {
  const db = getDb();
  const normalizedAnalysisId = String(analysisId || "");
  const result = await db.collection("goal_analysis_drafts").doc(normalizedAnalysisId).get().catch(() => null);
  const record = result && result.data;
  if (!record || record._openid !== openid) fail("GOAL_ANALYSIS_NOT_FOUND", "目标分析已失效，请重新填写。");
  if (new Date(record.expiresAt || 0).getTime() <= Date.now()) fail("GOAL_ANALYSIS_EXPIRED", "目标分析已过期，请重新填写。");
  return { ...record, _id: record._id || normalizedAnalysisId };
}

function validateAnswers(questions, answers) {
  if (!Array.isArray(answers)) fail("INVALID_ARGUMENT", "澄清答案无效。");
  const seen = new Set();
  const normalized = [];
  for (const answer of answers) {
    const questionId = String(answer && answer.questionId || "");
    if (seen.has(questionId)) fail("INVALID_ARGUMENT", "请勿重复提交同一问题。");
    seen.add(questionId);
    const question = questions.find((item) => item.id === questionId);
    if (!question) fail("INVALID_ARGUMENT", "澄清问题不存在。");
    let value = answer.value;
    if (question.type === "single_choice") {
      if (!question.options.includes(value)) fail("INVALID_ARGUMENT", "请选择有效选项。");
    } else if (question.type === "multiple_choice") {
      if (!Array.isArray(value) || value.some((item) => !question.options.includes(item))) fail("INVALID_ARGUMENT", "请选择有效选项。");
      value = Array.from(new Set(value));
    } else if (question.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value) || value < question.min || value > question.max) fail("INVALID_ARGUMENT", "数字答案超出范围。");
    } else if (question.type === "boolean") {
      if (typeof value !== "boolean") fail("INVALID_ARGUMENT", "请选择是或否。");
    } else {
      value = String(value || "").trim();
      if (value.length > (question.maxLength || 100)) fail("INVALID_ARGUMENT", "文本答案过长。");
    }
    normalized.push({ questionId, value });
  }
  questions.forEach((question) => {
    if (question.required && !seen.has(question.id)) fail("INVALID_ARGUMENT", "请先回答必填问题。");
  });
  return normalized;
}

async function submitGoalClarification(openid, event) {
  const db = getDb();
  const analysisId = String(event && event.analysisId || "");
  const record = await getOwnedAnalysis(openid, analysisId);
  if (record.status === "ready" || record.status === "consumed") return publicAnalysis(record);
  if (record.status !== "needs_clarification") fail("INVALID_ARGUMENT", "当前目标不需要补充信息。");
  if (!record.analysis || !Array.isArray(record.analysis.questions)) {
    fail("GOAL_ANALYSIS_SCHEMA_INVALID", "目标分析已失效，请重新填写。");
  }
  if (!record.originalInput || typeof record.originalInput !== "object") {
    fail("GOAL_ANALYSIS_SCHEMA_INVALID", "目标分析信息不完整，请重新填写。");
  }
  const answers = validateAnswers(record.analysis.questions, event && event.answers);
  let goalProfile;
  try {
    goalProfile = buildGoalProfile(record.originalInput, record.analysis, answers);
  } catch (error) {
    console.error("goal clarification profile build failed", {
      analysisIdSuffix: (record._id || analysisId).slice(-8),
      ...shortError(error),
    });
    fail("GOAL_ANALYSIS_SCHEMA_INVALID", "目标分析信息不完整，请重新填写。");
  }
  const docId = record._id || analysisId;
  const cleanAnswers = toPlainJson(answers);
  const cleanGoalProfile = toPlainJson(goalProfile);
  console.info("goal clarification submit validated", {
    analysisIdSuffix: docId.slice(-8),
    questionCount: record.analysis.questions.length,
    answerCount: cleanAnswers.length,
    goalProfileFields: Object.keys(cleanGoalProfile),
  });
  try {
    await db.collection("goal_analysis_drafts").doc(docId).update({
      data: {
        answers: cleanAnswers,
        goalProfile: cleanGoalProfile,
        status: "ready",
        updatedAt: db.serverDate(),
      },
    });
  } catch (error) {
    console.error("goal clarification save failed", {
      analysisIdSuffix: docId.slice(-8),
      ...shortError(error),
    });
    try {
      await db.collection("goal_analysis_drafts").doc(docId).set({
        data: {
          ...omitDocumentId(record),
          answers: cleanAnswers,
          goalProfile: cleanGoalProfile,
          status: "ready",
          updatedAt: db.serverDate(),
        },
      });
      console.info("goal clarification save fallback succeeded", {
        analysisIdSuffix: docId.slice(-8),
      });
    } catch (fallbackError) {
      console.error("goal clarification save fallback failed", {
        analysisIdSuffix: docId.slice(-8),
        ...shortError(fallbackError),
      });
      fail("GOAL_ANALYSIS_SAVE_FAILED", "补充信息暂时无法保存，请稍后重试。");
    }
  }
  let updated;
  try {
    updated = await db.collection("goal_analysis_drafts").doc(docId).get();
  } catch (error) {
    console.error("goal clarification reload failed", {
      analysisIdSuffix: docId.slice(-8),
      ...shortError(error),
    });
    fail("GOAL_ANALYSIS_RELOAD_FAILED", "补充信息已提交，但结果暂时无法读取，请返回后重试。");
  }
  return publicAnalysis({ ...updated.data, _id: updated.data._id || docId });
}

module.exports = {
  analyzeGoal,
  buildGoalProfile,
  fallbackAnalysis,
  getOwnedAnalysis,
  submitGoalClarification,
  validateAnswers,
  validateGoalAnalysisResult,
};
