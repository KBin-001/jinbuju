const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const planLogic = read("miniprogram/pages/plan/index.ts");
const planView = read("miniprogram/pages/plan/index.wxml");
const planConfig = read("miniprogram/pages/plan/index.json");
const editorLogic = read("miniprogram/components/completed-record-editor/index.ts");
const editorView = read("miniprogram/components/completed-record-editor/index.wxml");

assert.match(planConfig, /completed-record-editor/, "进度页应使用完成记录专用编辑器");
assert.match(planView, /<completed-record-editor/, "最近完成应打开完成记录专用编辑器");
assert.doesNotMatch(planLogic, /openRecentTask[\s\S]{0,700}pages\/action-edit/, "最近完成任务不得进入任务配置页");
assert.match(editorView, />行动内容</, "编辑器仅保留行动内容");
assert.match(editorView, />实际投入</, "编辑器仅保留实际投入");
assert.match(editorView, />完成时间</, "编辑器仅保留完成时间");
assert.match(planLogic, /updateCompletedActionRecord/, "保存必须使用完成记录专用更新入口");

for (const forbidden of ["行动图标", "预计投入", "重要程度", "完成情况", "今日感受", "AI 教练", "删除记录", "提醒我", "executionMode", "importance", "reflection", "status"]) {
  assert.doesNotMatch(editorView + editorLogic, new RegExp(forbidden), `完成记录编辑器不应包含：${forbidden}`);
}

console.log("progress completed record editor contract tests passed");
