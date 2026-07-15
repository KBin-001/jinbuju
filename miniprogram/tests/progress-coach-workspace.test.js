const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "pages/ai-coach/index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "pages/ai-coach/index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(root, "pages/ai-coach/index.wxss"), "utf8");

assert.doesNotMatch(styles, /daily-coach\/index\.wxss/, "进度 AI 页面不能再依赖每日教练页面样式");
assert.doesNotMatch(template, /jinbuju-ai-robot|coach-robot/, "成长洞察不应继续展示卡通机器人");
assert.match(source, /getMenuButtonBoundingClientRect/, "成长洞察自定义导航必须避让系统胶囊");
assert.match(template, /AI 成长洞察/);
assert.match(template, /完成行动/);
assert.match(template, /行动完成率/);
assert.match(template, /教练观察/);
assert.match(template, /继续问教练/);
assert.match(template, /class="send-control/);

console.log("progress coach workspace tests passed");
