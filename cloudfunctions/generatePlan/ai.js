const tcb = require("@cloudbase/node-sdk");
const cloud = require("wx-server-sdk");
const { assertSafeText } = require("./content-security");

let app;

function resolveCloudEnv(environment = process.env) {
  const env = environment.CLOUDBASE_ENV || environment.TCB_ENV || environment.SCF_NAMESPACE;
  if (!env) {
    const error = new Error("CLOUDBASE_ENV_NOT_CONFIGURED");
    error.code = "CLOUDBASE_ENV_NOT_CONFIGURED";
    throw error;
  }
  return env;
}

async function assertAiOutputSafe(text, dependencies = {}) {
  const context = dependencies.context || cloud.getWXContext();
  if (!context || !context.OPENID) {
    const error = new Error("Missing OPENID for AI content security check");
    error.code = "UNAUTHORIZED";
    throw error;
  }
  await assertSafeText(context.OPENID, [String(text || "")], 4, dependencies.securityApi || cloud.openapi.security);
}

function getApp() {
  if (!app) {
    app = tcb.init({
      env: reso
  return app;
}

function withTimeout(promise, timeoutMilliseconds) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
        const error = new Error("AI_REQUEST_TIMEOUT");
        error.code = "AI_REQUEST_TIMEOUT";
        reject(error);
    }, timeoutMilliseconds);
  });

  return Promise.race([promise, timeoutPromise]).then(
    (result) => {
      clearTimeout(timeoutId);
      return result;
    },
    (error) => {
      clearTimeout(timeoutId);
      throw error;
    },
  );
}

function buildGenerationMetadata(provider, modelName, startedAt, result) {
  return {
    providerGroup: provider,
    modelId: modelName,
    generationDurationMs: Date.now() - startedAt,
    totalTokens: result && result.usage && result.usage.totalTokens,
  };
}

async function generateTextWithMetadata(prompt, timeoutMilliseconds = 18000, logContext = {}) {
  if (process.env.CLOUDBASE_AI_ENABLED === "false") {
    const error = new Error("AI_DISABLED");
    error.code = "AI_DISABLED";
    throw error;
  }

  const ai = getApp().ai();
  const provider = process.env.CLOUDBASE_AI_PROVIDER || "cloudbase";
  const modelName = process.env.CLOUDBASE_AI_MODEL || "hy3-preview";
  const model = ai.createModel(provider);
  const startedAt = Date.now();
  const result = await withTimeout(
    model.generateText({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
    }),
    timeoutMilliseconds,
  );
  await assertAiOutputSafe(result.text);
  console.info("CloudBase AI generation completed", {
    action: logContext.action,
    provider,
    providerGroup: provider,
    model: modelName,
    modelId: modelName,
    promptVersion: logContext.promptVersion,
    schemaVersion: logContext.schemaVersion,
    promptLength: typeof prompt === "string" ? prompt.length : 0,
    inputFieldNames: logContext.inputFieldNames,
    durationDays: logContext.durationDays,
    dailyMinutes: logContext.dailyMinutes,
    generationDurationMs: Date.now() - startedAt,
    parseSucceeded: logContext.parseSucceeded,
    schemaSucceeded: logContext.schemaSucceeded,
    qualityPassed: logContext.qualityPassed,
    repairAttempted: logContext.repairAttempted,
    generationSource: logContext.generationSource,
    fallbackReason: logContext.fallbackReason,
    totalTokens: result.usage && result.usage.totalTokens,
  });
  return {
    text: result.text,
    metadata: buildGenerationMetadata(provider, modelName, startedAt, result),
  };
}

async function generateMessagesWithMetadata(messages, timeoutMilliseconds = 18000, logContext = {}) {
  if (process.env.CLOUDBASE_AI_ENABLED === "false") {
    const error = new Error("AI_DISABLED");
    error.code = "AI_DISABLED";
    throw error;
  }
  if (!Array.isArray(messages) || !messages.length || messages.some((item) => (
    !item || !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string"
  ))) {
    const error = new Error("AI_MESSAGES_INVALID");
    error.code = "AI_MESSAGES_INVALID";
    throw error;
  }

  const provider = process.env.CLOUDBASE_AI_PROVIDER || "cloudbase";
  const modelName = process.env.CLOUDBASE_AI_MODEL || "hy3-preview";
  const model = getApp().ai().createModel(provider);
  const startedAt = Date.now();
  const result = await withTimeout(model.generateText({ model: modelName, messages }), timeoutMilliseconds);
  const text = result && result.text;
  if (typeof text !== "string" || !text.trim()) {
    const error = new Error("AI_RESPONSE_EMPTY");
    error.code = "AI_RESPONSE_EMPTY";
    throw error;
  }
  await assertAiOutputSafe(text);
  console.info("CloudBase AI conversation completed", {
    action: logContext.action,
    providerGroup: provider,
    modelId: modelName,
    promptVersion: logContext.promptVersion,
    schemaVersion: logContext.schemaVersion,
    messageCount: messages.length,
    inputLength: messages.reduce((sum, item) => sum + item.content.length, 0),
    generationDurationMs: Date.now() - startedAt,
    totalTokens: result.usage && result.usage.totalTokens,
  });
  return { text, metadata: buildGenerationMetadata(provider, modelName, startedAt, result) };
}

async function generateCoachActionIntent(messages, timeoutMilliseconds = 12000, logContext = {}) {
  if (process.env.CLOUDBASE_AI_ENABLED === "false") {
    const error = new Error("AI_DISABLED");
    error.code = "AI_DISABLED";
    throw error;
  }
  if (!Array.isArray(messages) || !messages.length) {
    const error = new Error("AI_MESSAGES_INVALID");
    error.code = "AI_MESSAGES_INVALID";
    throw error;
  }
  const provider = process.env.CLOUDBASE_AI_PROVIDER || "cloudbase";
  const modelName = process.env.CLOUDBASE_AI_MODEL || "hy3-preview";
  const model = getApp().ai().createModel(provider);
  const startedAt = Date.now();
  let capturedToolCall = null;
  const result = await withTimeout(model.generateText({
    model: modelName,
    messages,
    maxSteps: 1,
    toolChoice: "auto",
    tools: [{
      type: "function",
      function: {
        name: "propose_coach_action",
        description: "仅当用户明确要求新增行动或标记行动完成时，提取需要用户确认的结构化操作；普通咨询不要调用。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["operation"],
          properties: {
            operation: { type: "string", enum: ["create_task", "complete_task", "none"] },
            title: { type: "string", description: "纯行动名称，不包含日期、时钟、时长、口头填充词" },
            currentDate: { type: "string", description: "YYYY-MM-DD" },
            estimatedMinutes: { type: "integer", minimum: 5, maximum: 240 },
            reminderTime: { type: "string", description: "24小时 HH:mm；用户未提出具体时间时为空字符串" },
            taskTitle: { type: "string" },
            actualMinutes: { type: "integer", minimum: 1, maximum: 480 },
          },
        },
      },
    }],
    onStepFinish: ({ toolCall }) => { if (toolCall) capturedToolCall = toolCall; },
  }), timeoutMilliseconds);
  if (result && result.error) throw result.error;
  if (!capturedToolCall || capturedToolCall.function.name !== "propose_coach_action") return null;
  let intent;
  try {
    intent = JSON.parse(capturedToolCall.function.arguments || "{}");
  } catch (_error) {
    const error = new Error("AI_TOOL_ARGUMENTS_INVALID");
    error.code = "AI_TOOL_ARGUMENTS_INVALID";
    throw error;
  }
  await assertAiOutputSafe(JSON.stringify(intent));
  console.info("CloudBase AI coach action extracted", {
    action: logContext.action,
    providerGroup: provider,
    modelId: modelName,
    promptVersion: logContext.promptVersion,
    operation: typeof intent.operation === "string" ? intent.operation : "invalid",
    hasReminderTime: Boolean(intent.reminderTime),
    generationDurationMs: Date.now() - startedAt,
    totalTokens: result.usage && result.usage.totalTokens,
  });
  return intent;
}

async function generateText(prompt, timeoutMilliseconds = 18000, logContext = {}) {
  const result = await generateTextWithMetadata(prompt, timeoutMilliseconds, logContext);
  return result.text;
}

module.exports = { assertAiOutputSafe, generateCoachActionIntent, generateMessagesWithMetadata, generateText, generateTextWithMetadata, resolveCloudEnv };
