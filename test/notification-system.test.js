const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const backendConfig = read("cloudfunctions/generatePlan/notification-config.js");
const backend = read("cloudfunctions/generatePlan/notification.js");
const router = read("cloudfunctions/generatePlan/index.js");
const schedulerWorker = read("cloudfunctions/notificationScheduler/index.js");
const { isTrustedSchedulerSource } = require("../cloudfunctions/generatePlan/scheduler-auth.js");
const scheduler = JSON.parse(read("cloudfunctions/notificationScheduler/config.json"));
const clientConfig = read("miniprogram/config/notification.ts");
const clientService = read("miniprogram/services/notification.ts");

for (const scene of ["daily_action_reminder", "ai_coach_advice", "team_activity"]) {
  assert.ok(backendConfig.includes(`"${scene}"`), `backend config missing ${scene}`);
  assert.ok(clientConfig.includes(`"${scene}"`), `client config missing ${scene}`);
}
assert.match(backendConfig, /NOTIFICATION_SERVICE_CATEGORY_CONFIRMED === "true"/);
assert.match(backendConfig, /process\.env\.NOTIFICATION_ENABLED === "true"/);
for (const templateId of [
  "4MFayQvC3ZykJyFFirrIlcDjnrFDDe34F4F9XvdFltU",
  "saJM8i1xbgv_oH6uTevI08_8F8u_1lFyLvvhxNEPLW8",
  "JVY6kbiobOrSxkFWn1mG075SL6axUA3Hz9ymABKXtP8",
]) {
  assert.ok(clientConfig.includes(templateId), `client config missing template ${templateId}`);
}
assert.match(backend, /payload: \{ date: generatedAt/);
assert.match(backend, /\\d\{4\}-\\d\{2\}-\\d\{2\}\|\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d/);
assert.match(clientService, /withSubscriptions:\s*true/);
assert.match(clientService, /wx\.requestSubscribeMessage/);
const authorizationStart = clientService.indexOf("export async function requestNotificationAuthorizationWithReceipt");
const authorizationEnd = clientService.indexOf("\nexport function upsertTaskReminder", authorizationStart);
const authorizationBody = clientService.slice(authorizationStart, authorizationEnd);
assert.ok(authorizationBody.indexOf("wx.requestSubscribeMessage") < authorizationBody.indexOf('await call("notification.subscribe"'), "native authorization must run before cloud calls");
assert.doesNotMatch(authorizationBody, /await getWechatSubscriptionSetting|await getNotificationPreference/);
assert.match(router, /isTrustedSchedulerSource\(context\.SOURCE\)/);
assert.equal(isTrustedSchedulerSource("wx_trigger,scf"), true);
assert.equal(isTrustedSchedulerSource("wx_trigger,scf,scf"), true);
assert.equal(isTrustedSchedulerSource("wx_trigger,wx_cloud_call"), true);
assert.equal(isTrustedSchedulerSource("wx_trigger"), false);
assert.equal(isTrustedSchedulerSource("wx_client,scf"), false);
assert.equal(isTrustedSchedulerSource("scf"), false);
assert.match(schedulerWorker, /payload\.success !== true/);
assert.match(schedulerWorker, /SCHEDULED_DISPATCH_FAILED/);
assert.doesNotMatch(router, /notification\.send/);
assert.match(backend, /new Set\(\[-1, 45009\]\)/);
assert.match(backend, /\[2000, 4000, 8000\]/);
assert.match(backend, /Number\(globalCount\.total \|\| 0\) >= 7/);
assert.match(backend, /Number\(recentCount\.total \|\| 0\) >= 2/);
assert.match(backend, /hour >= 22 \|\| hour < 8/);
assert.match(backend, /parts\.date === previousDay && parts\.hour < 22/);
assert.doesNotMatch(backend, /gray_disabled/);
assert.match(backend, /assertRequestObject\(event, "通知授权请求"\)/);
assert.match(backend, /retentionExpireAt/);
assert.match(backend, /task\.source !== "ai" \|\| task\.userId/);
assert.match(backend, /data: \{ userId, serverUpdatedAt: db\.serverDate\(\) \}/, "旧版 AI 任务缺少 userId 时应安全补齐提醒归属");
assert.match(read("cloudfunctions/generatePlan/manual-sync.js"), /existing && existing\.status !== "completed"/);
assert.match(read("cloudfunctions/generatePlan/manual-sync.js"), /recordManualCompletionEvent/);
assert.strictEqual(scheduler.triggers.length, 1);
assert.strictEqual(scheduler.triggers[0].config, "0 */5 * * * * *");

console.log("notification system contract tests passed");
