const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const wxml = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxss"), "utf8");
const script = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.ts"), "utf8");
const actionListWxml = fs.readFileSync(path.join(root, "miniprogram/components/today-action-list/index.wxml"), "utf8");
const actionListWxss = fs.readFileSync(path.join(root, "miniprogram/components/today-action-list/index.wxss"), "utf8");

assert.equal(wxml.includes("更多操作"), false, "任务卡不应继续展示更多操作文案");
assert.equal(wxss.includes(".task-more"), false, "应同步清理更多操作样式");
assert.match(wxml, /<today-action-list/);
assert.match(actionListWxml, /data-id="\{\{item\.id\}\}"[\s\S]*bindtap="openTask"/, "点击任务行仍应打开行动详情");
assert.match(actionListWxml, /catchtap="primaryAction"/, "单一主操作按钮必须拦截冒泡并独立处理");
assert.match(actionListWxml, /catchtap="openMenu"/, "任务更多菜单必须拥有独立点击入口");
assert.doesNotMatch(actionListWxml, /<button[\s>]/, "任务主操作不应继续使用带默认样式的原生长按钮");
assert.match(actionListWxml, /class="action-mark__disc"/, "任务主操作必须使用独立动作按钮");
assert.match(actionListWxml, /class="action-mark__label"/, "行动印记必须提供独立可见文字");
assert.match(actionListWxml, /aria-disabled=/, "不可执行状态必须提供无障碍禁用说明");
assert.match(actionListWxss, /\.action-mark\s*\{[\s\S]*width:\s*132rpx;[\s\S]*height:\s*54rpx;/, "横向动作按钮点击区域尺寸必须可靠");
assert.match(actionListWxss, /\.action-mark__disc\s*\{[\s\S]*width:\s*132rpx;[\s\S]*height:\s*54rpx;/, "横向动作按钮必须保持紧凑比例");
assert.match(actionListWxss, /var\(--color-primary/, "动作按钮应复用现有主题变量");
assert.match(actionListWxml, /wx:for="\{\{renderGroups\}\}"/, "今日行动必须渲染带安全回退的展示分组");
assert.match(actionListWxml, /action-group__rail/, "展示分组必须保留时间轴结构");
assert.doesNotMatch(actionListWxml, /action-control__minutes/, "主操作按钮下方不应重复展示预计投入时间");
assert.doesNotMatch(actionListWxss, /\.task-primary/, "应完全移除旧的白色长胶囊按钮样式");
assert.match(script, /updateTaskStatus\(task\.id,\s*"completed"\);/, "完成行动时应由服务层采用预计时长作为默认实际投入");
assert.doesNotMatch(script, /updateTaskStatus\(task\.id,\s*"completed",\s*task\.actualMinutes\s*\?\?\s*0\)/, "完成行动不应再写入 0 分钟");
assert.match(script, /recordDailyCheckin\(updated\.goalId, updated\.activityDate \|\| updated\.currentDate\)/, "完成行动后必须同步刷新每日打卡快照");
assert.match(script, /shouldRevealCompleted/, "完成后应保持记录可见，避免排序折叠造成数据丢失错觉");
assert.match(actionListWxml, /wx:if="\{\{item\.rescheduled\}\}" class="carry-badge">顺延任务</, "顺延任务必须提供清晰来源标记");
assert.match(actionListWxss, /\.carry-badge/, "顺延任务标记必须有独立的轻量样式");
assert.match(script, /const summaryTasks = selectedDate === today \? sourceTasks : selectedTasks/, "今天的统计必须包含页面正在展示的待继续任务");
assert.match(script, /primaryActionShortLabel:\s*primaryAction === "complete"\s*\?\s*"完成"\s*:\s*"专注"/, "待执行状态必须映射“完成／专注”短标签");
assert.match(script, /primaryActionShortLabel:\s*"继续"/, "暂停或部分完成状态必须显示“继续”");
assert.match(script, /primaryActionShortLabel:\s*"记录"/, "已完成状态必须显示“记录”");
assert.match(script, /primaryActionIcon:\s*"check-circle"/, "打卡状态必须使用勾选图标");
assert.match(script, /primaryActionIcon:\s*"play-circle"/, "专注状态必须使用播放图标");
assert.match(script, /function markRecommendedAction/, "推荐行动必须只在页面展示层派生");
assert.match(script, /!recommendationAssigned/, "同一列表只能分配一个推荐行动");

for (const action of ["开始专注", "标记完成", "跳过今天", "编辑任务", "删除任务"]) {
  assert.equal(script.includes(action), true, `操作菜单缺少“${action}”`);
}
assert.equal(script.includes("每次询问"), false, "执行方式入口不应再包含每次询问");

console.log("today task action entry tests passed");
