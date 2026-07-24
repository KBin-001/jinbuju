const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("miniprogram/pages/index/index.wxml");
const logic = read("miniprogram/pages/index/index.ts");
const actionList = read("miniprogram/components/today-action-list/index.wxml");
const timerBar = read("miniprogram/components/active-timer-bar/index.wxml");
const timerService = read("miniprogram/services/actionSession.ts");

assert.match(page, /<today-action-list/);
assert.match(page, /<daily-progress/);
assert.match(page, /<ai-coach-tip/);
assert.match(page, /<active-timer-bar/);
assert.doesNotMatch(page, /focus-action-panel|stats-card|today-progress-trend|自由计时/);
assert.match(actionList, /primaryActionLabel/);
assert.match(actionList, /action-mark--\{\{item\.primaryActionTone\}\}/);
assert.match(actionList, /primaryActionShortLabel \|\| item\.primaryActionLabel \|\| '开始'/);
assert.match(actionList, /t-icon name="\{\{item\.primaryActionIcon \|\| 'play-circle'\}\}"/);
assert.match(actionList, /catchtap="openMenu"/);
assert.match(actionList, /activeTaskId === item\.id/);
assert.match(page, /按习惯推荐/);
assert.match(page, /执行偏好/);
assert.match(page, /bind:primary="handleTaskPrimary"/);
assert.match(logic, /primaryActionLabel: "开始专注"/);
assert.match(logic, /itemList: \["直接完成", "开始专注"\]/);
assert.match(logic, /updateTaskExecutionMode/);
assert.match(timerBar, /wx:if="\{\{visible\}\}"/);
assert.match(timerBar, /暂停/);
assert.match(timerBar, /继续/);
assert.match(timerBar, /结束计时/);
assert.match(logic, /cancelText: "仅结束计时"/);
assert.match(logic, /confirmText: "标记完成"/);
assert.match(logic, /finishActionSession\(this\.data\.activeSessionId, markTaskCompleted\)/);
assert.match(timerService, /markTaskCompleted \? "completed" : "partially_completed"/);

console.log("今日页商业化任务列表、轻量进度与独立计时结束契约检查通过");
