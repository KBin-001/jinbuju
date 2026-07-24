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

// === 孤儿会话恢复态（规格 03）===
// 活跃会话存在但任务被软删除时，悬浮计时条进入恢复态而非隐藏。
const timerBarTs = fs.readFileSync(path.join(root, "components/active-timer-bar/index.ts"), "utf8");
const timerBarWxml = fs.readFileSync(path.join(root, "components/active-timer-bar/index.wxml"), "utf8");
assert.match(timerBarTs, /orphan:\s*\{\s*type:\s*Boolean,\s*value:\s*false\s*\}/, "计时条组件应声明 orphan 属性");
assert.match(timerBarTs, /cleanupOrphan\(\)/, "计时条组件应提供 cleanupOrphan 事件触发");
assert.match(timerBarWxml, /timer-bar--orphan/, "恢复态应有独立样式类");
assert.match(timerBarWxml, /catchtap="cleanupOrphan"/, "恢复态应绑定 cleanupOrphan 操作");
assert.match(quickAdd, /orphan="\{\{activeSessionOrphan\}\}"/, "今日页应向计时条传递 orphan 状态");
assert.match(quickAdd, /行动已删除/, "恢复态应显示「行动已删除」提示");
assert.match(quickAdd, /bind:cleanup="cleanupOrphanSession"/, "今日页应绑定 cleanup 事件到 cleanupOrphanSession");
assert.match(todaySource, /cleanupOrphanSession\(\)/, "今日页应实现 cleanupOrphanSession 方法");
assert.match(todaySource, /abandonActionSession\(sessionId,\s*false\)/, "清理孤儿会话应调用 abandonActionSession(keepTime=false)");
assert.match(todaySource, /activeSessionOrphan/, "今日页应维护 activeSessionOrphan 状态");

// === 结束计时永不静默失败（规格 04）===
// requestFinishTimer / finishActiveTimer 在会话引用缺失时从全局重新获取，而非静默 return。
assert.match(todaySource, /requestFinishTimer\(\)/, "今日页应实现 requestFinishTimer");
assert.doesNotMatch(todaySource, /if \(!this\.data\.activeSessionId \|\| this\.data\.timerSubmitting\) return;\s*\n\s*try \{\s*\n\s*if \(this\.data\.activeSessionStatus === "running"\) pauseActionSession\(this\.data\.activeSessionId\);/, "requestFinishTimer 不应直接 return");
assert.match(todaySource, /let sessionId = this\.data\.activeSessionId;\s*\n\s*if \(!sessionId\) \{[\s\S]*getActiveActionSessionContext/, "requestFinishTimer 应在会话引用缺失时从全局重新获取");
assert.match(todaySource, /当前没有进行中的计时/, "无活跃会话时应给出明确反馈");
assert.match(todaySource, /正在保存，请稍候/, "timerSubmitting 守卫拦截时应给出反馈");

// === 订阅会话变更事件（规格 05）===
// 今日页 onLoad 订阅 action-session:update，onUnload 取消订阅。
assert.match(todaySource, /on\("action-session:update",\s*this\.sessionUpdateHandler\)/, "onLoad 应订阅 action-session:update 事件");
assert.match(todaySource, /off\("action-session:update",\s*this\.sessionUpdateHandler\)/, "onUnload 应取消订阅 action-session:update 事件");
assert.match(todaySource, /this\.sessionUpdateHandler = \(\) => this\.refreshActiveSession\(\)/, "事件回调应调用 refreshActiveSession 刷新活跃会话状态");

console.log("action records tests passed");
