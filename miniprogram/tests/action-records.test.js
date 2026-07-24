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
const durationConfig = fs.readFileSync(path.join(root, "config/action.ts"), "utf8");
assert.doesNotMatch(quickAdd, /补充说明/, "今日行动快捷添加不应展示补充说明");
for (const minutes of [30, 45, 60, 90, 120, 240]) {
  assert.match(durationConfig, new RegExp(`(?:^|[\\s,\\[])${minutes}(?:[\\s,\\]])`), `预计投入必须兼容 ${minutes} 分钟`);
}
assert.match(todaySource, /ACTION_DURATION_OPTIONS/, "今日页应使用统一时长配置");
assert.match(todaySource, /QUICK_DURATION_VALUES = new Set\(\[30, 45, 60, 90, 120\]\)/, "120 分钟必须显示在快捷时长网格中");
assert.match(quickAdd, /quickAddMinutes !== 120/, "选择 120 分钟后不应误高亮更多时长");
assert.match(quickAdd, /更多时长/, "快捷添加必须保留更多时长入口");

// === 悬浮计时条与日期、目标作用域解耦（规格 02）===
// 活跃会话是全局概念：不依赖选中日期，也不经过目标作用域过滤。
assert.match(todaySource, /getActiveActionSessionContext/, "今日页应通过 getActiveActionSessionContext 解析活跃会话任务");
assert.doesNotMatch(todaySource, /selectedDate === today \? getActiveActionSession/, "活跃会话读取不应受 selectedDate === today 门控");
assert.doesNotMatch(todaySource, /goalTasks\.find\(\(task\) => task\.id === activeSession\.taskId\)/, "活跃会话任务不应通过目标作用域列表 find 查找");
// 悬浮计时条 visible 只取决于「是否存在活跃会话」，不要求 activeSessionTask 同时非空。
assert.match(quickAdd, /visible="\{\{\!\!activeSessionId\}\}"/, "悬浮计时条 visible 应归结为存在活跃会话");
assert.doesNotMatch(quickAdd, /visible="\{\{\!\!activeSessionId && \!\!activeSessionTask\}\}"/, "悬浮计时条 visible 不应同时要求 activeSessionTask 非空");
// 非今日日期下今日摘要不误叠加活跃会话的进行中投入。
assert.match(todaySource, /selectedDate === today \? activeMinutes : 0/, "非今日日期下今日摘要不应叠加活跃会话进行中投入");

console.log("action records tests passed");
