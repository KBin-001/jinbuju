const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const app = read("miniprogram/app.ts");
const account = read("miniprogram/services/account.ts");
const today = read("miniprogram/pages/index/index.ts");
const coach = read("miniprogram/pages/ai-coach/index.ts");
const dailyCoach = read("miniprogram/pages/daily-coach/index.ts");

assert(app.includes("bootstrapAccount().catch"), "应用启动时必须后台初始化账号资料");
assert(account.includes("hydrateAccountCache") && account.includes("runtime || hydrateAccountCache()"), "页面首次读取资料时必须同步恢复账号缓存");
assert(account.includes('emit("profile:update", value?.profile || null)'), "账号初始化完成后必须广播资料更新");
assert(account.includes("persistAccountCache(runtime)") && account.includes("profile: updated"), "资料修改后必须同步更新账号缓存");

for (const [name, page] of [["今日页", today], ["AI 教练页", coach], ["每日教练页", dailyCoach]]) {
  assert(page.includes("bootstrapAccount().catch"), `${name}必须能够独立启动账号资料`);
  assert(page.includes('on("profile:update"') && page.includes('off("profile:update"'), `${name}必须监听并清理资料更新事件`);
}

console.log("头像缓存恢复、账号启动与跨页面更新契约检查通过");
