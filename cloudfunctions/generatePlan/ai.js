const tcb = require("@cloudbase/node-sdk");

let app;

function getApp() {
  if (!app) {
    app = tcb.init({
      env: process.env.CLOUDBASE_ENV,
      timeout: 60000,
    });
  }
  return app;
}

async function generateText(prompt) {
  if (process.env.CLOUDBASE_AI_ENABLED !== "true") {
    const error = new Error("AI_NOT_CONFIGURED");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }

  const ai = getApp().ai();
  const model = ai.createModel("cloudbase");
  const result = await model.generateText({
    model: process.env.CLOUDBASE_AI_MODEL || "hy3-preview",
    messages: [{ role: "user", content: prompt }],
  });
  return result.text;
}

module.exports = { generateText };
