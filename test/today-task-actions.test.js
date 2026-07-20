const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const wxml = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxss"), "utf8");
const script = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.ts"), "utf8");

assert.equal(wxml.includes("更多操作"), false, "任务卡不应继续展示更多操作文案");
assert.equal(wxss.includes(".task-more"), false, "应同步清理更多操作样式");
assert.match(wxml, /data-id="\{\{task\.id\}\}"\s+bindtap="openTask"/, "点击任务行仍应打开操作菜单");
assert.match(wxml, /catchtap="toggleTaskDone"/, "完成按钮必须拦截冒泡并独立处理");
assert.match(script, /updateTaskStatus\(task\.id,\s*"completed"\);/, "完成行动时应由服务层采用预计时长作为默认实际投入");
assert.doesNotMatch(script, /updateTaskStatus\(task\.id,\s*"completed",\s*task\.actualMinutes\s*\?\?\s*0\)/, "完成行动不应再写入 0 分钟");
assert.match(script, /recordDailyCheckin\(updated\.goalId, updated\.activityDate \|\| updated\.currentDate\)/, "完成行动后必须同步刷新每日打卡快照");
assert.match(script, /shouldRevealCompleted/, "完成后应保持记录可见，避免排序折叠造成数据丢失错觉");
assert.match(wxml, /wx:if="\{\{task\.rescheduled\}\}" class="task-carry-badge">顺延任务</, "顺延任务必须提供清晰来源标记");
assert.match(wxss, /\.task-carry-badge/, "顺延任务标记必须有独立的轻量样式");
assert.match(script, /const summaryTasks = selectedDate === today \? sourceTasks : selectedTasks/, "今天的统计必须包含页面正在展示的待继续任务");

for (const action of ["标记完成", "完成一部分", "顺延到明天", "今天不做", "编辑", "删除"]) {
  assert.equal(script.includes(action), true, `操作菜单缺少“${action}”`);
}

console.log("today task action entry tests passed");
