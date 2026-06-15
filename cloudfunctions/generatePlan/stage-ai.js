const { generateText } = require("./ai");

class CloudBaseStagePlanProvider {
  generateStagePlan(prompt, timeoutMilliseconds) {
    return generateText(prompt, timeoutMilliseconds);
  }
}

function createStagePlanProvider() {
  return new CloudBaseStagePlanProvider();
}

module.exports = {
  CloudBaseStagePlanProvider,
  createStagePlanProvider,
};
