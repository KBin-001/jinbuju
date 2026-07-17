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
  return result && result.result;
};
