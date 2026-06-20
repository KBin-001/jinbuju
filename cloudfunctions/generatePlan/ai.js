const tcb = require("@cloudbase/node-sdk");

let app;
const DEFAULT_ENV_ID = "ai-d3g9qsay37da6a3cc";

function getApp() {
  if (!app) {
    app = tcb.init({
      env:
        process.env.CLOUDBASE_ENV ||
        process.env.TCB_ENV ||
        process.env.SCF_NAMESPACE ||
        DEFAULT_ENV_ID,
      timeout: 210000,
    });
  }
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

async function generateText(prompt, timeoutMilliseconds = 18000, logContext = {}) {
  const result = await generateTextWithMetadata(prompt, timeoutMilliseconds, logContext);
  return result.text;
}

module.exports = { generateText, generateTextWithMetadata };
