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
      timeout: 60000,
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

async function generateText(prompt, timeoutMilliseconds = 18000) {
  if (process.env.CLOUDBASE_AI_ENABLED === "false") {
    const error = new Error("AI_DISABLED");
    error.code = "AI_DISABLED";
    throw error;
  }

  const ai = getApp().ai();
  const provider = process.env.CLOUDBASE_AI_PROVIDER || "cloudbase";
  const modelName = process.env.CLOUDBASE_AI_MODEL || "hy3-preview";
  const model = ai.createModel(provider);
  const result = await withTimeout(
    model.generateText({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
    }),
    timeoutMilliseconds,
  );
  console.info("CloudBase AI generation completed", {
    provider,
    model: modelName,
    totalTokens: result.usage && result.usage.totalTokens,
  });
  return result.text;
}

module.exports = { generateText };
