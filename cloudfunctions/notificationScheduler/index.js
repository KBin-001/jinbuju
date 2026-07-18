const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const context = cloud.getWXContext();
  if (context.SOURCE !== "wx_trigger") {
    throw new Error("notificationScheduler only accepts CloudBase timer triggers");
  }
  const result = await cloud.callFunction({
    name: "generatePlan",
    data: { action: "notification.runScheduled" },
  });
  const payload = result && result.result;
  if (!payload || payload.success !== true) {
    const error = new Error(payload && payload.error && payload.error.message || "Scheduled notification dispatch failed");
    error.code = payload && payload.error && payload.error.code || "SCHEDULED_DISPATCH_FAILED";
    throw error;
  }
  return payload;
};
