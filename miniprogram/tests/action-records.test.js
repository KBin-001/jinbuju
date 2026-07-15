const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
assert.ok(app.pages.includes("pages/action-records/index"), "行动记录页面必须注册到 app.json");

for (const extension of ["ts", "wxml", "wxss", "json"]) {
  assert.ok(fs.existsSync(path.join(root, `pages/action-records/index.${extension}`)), `缺少行动记录页面 index.${extension}`);
}

const todaySource = fs.readFileSync(path.join(root, "pages/index/index.ts"), "utf8");
assert.doesNotMatch(todaySource, /title:\s*["']记录实际投入["']/, "完成行动不应强制弹出实际投入录入");
assert.match(todaySource, /openCustomDuration\(\)/, "预计投入必须支持自定义分钟数");

const planSource = fs.readFileSync(path.join(root, "pages/plan/index.ts"), "utf8");
assert.match(planSource, /openActionRecords\(\)/, "进度页必须提供查看全部行动入口");

const quickAdd = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
assert.doesNotMatch(quickAdd, /补充说明/, "今日行动快捷添加不应展示补充说明");
for (const minutes of [30, 45, 60, 90, 120, 240]) {
  assert.match(todaySource, new RegExp(`value:\\s*${minutes}`), `预计投入必须兼容 ${minutes} 分钟`);
}
assert.match(quickAdd, /更多时长/, "快捷添加必须保留更多时长入口");

console.log("action records tests passed");
