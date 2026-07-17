const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const registeredPages = [
  ...app.pages,
  ...(app.subpackages || []).flatMap((pkg) => (pkg.pages || []).map((page) => `${pkg.root}/${page}`)),
];
assert.ok(registeredPages.includes("pages/action-records/index"), "行动记录页面必须注册到 app.json 主包或分包");

for (const extension of ["ts", "wxml", "wxss", "json"]) {
  assert.ok(fs.existsSync(path.join(root, `pages/action-records/index.${extension}`)), `缺少行动记录页面 index.${extension}`);
}

const todaySource = fs.readFileSync(path.join(root, "pages/index/index.ts"), "utf8");
assert.doesNotMatch(todaySource, /title:\s*["']记录实际投入["']/, "完成行动不应强制弹出实际投入录入");
assert.match(todaySource, /openCustomDuration\(\)/, "预计投入必须支持自定义分钟数");

const planSource = fs.readFileSync(path.join(root, "pages/plan/index.ts"), "utf8");
assert.match(planSource, /openGrowthRecords\(\)/, "进度页必须提供独立成长记录入口");
assert.match(planSource, /pages\/growth-records\/index\?from=progress&goalId=/, "进度页应保留当前目标上下文进入成长记录页");

const quickAdd = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
assert.doesNotMatch(quickAdd, /补充说明/, "今日行动快捷添加不应展示补充说明");
for (const minutes of [30, 45, 60, 90, 120, 240]) {
  assert.match(todaySource, new RegExp(`value:\\s*${minutes}`), `预计投入必须兼容 ${minutes} 分钟`);
}
assert.match(todaySource, /QUICK_DURATION_VALUES = new Set\(\[30, 45, 60, 90, 120\]\)/, "120 分钟必须显示在快捷时长网格中");
assert.match(quickAdd, /quickAddMinutes !== 120/, "选择 120 分钟后不应误高亮更多时长");
assert.match(quickAdd, /更多时长/, "快捷添加必须保留更多时长入口");

console.log("action records tests passed");
