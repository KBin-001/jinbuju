const { generateText, generateTextWithMetadata } = require("./ai");

class CloudBaseStagePlanProvider {
  generateStagePlan(prompt, timeoutMilliseconds) {
    return generateText(prompt, timeoutMilliseconds);
  }

  generateStagePlanWithMetadata(prompt, timeoutMilliseconds, logContext) {
    return generateTextWithMetadata(prompt, timeoutMilliseconds, logContext);
  }
}

function createStagePlanProvider() {
  return new CloudBaseStagePlanProvider();
}

module.exports = {
  CloudBaseStagePlanProvider,
  createStagePlanProvider,
};
