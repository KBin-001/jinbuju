const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "pages/ai-coach/index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "pages/ai-coach/index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(root, "pages/ai-coach/index.wxss"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "pages/ai-coach/index.json"), "utf8"));
const chatTemplate = fs.readFileSync(path.join(root, "components/coach-chat/index.wxml"), "utf8");

assert.doesNotMatch(styles, /daily-coach\/index\.wxss/, "进度 AI 页面不能再依赖每日教练页面样式");
assert.doesNotMatch(template, /jinbuju-ai-robot|coach-robot/, "成长洞察不应继续展示卡通机器人");
assert.match(source, /getMenuButtonBoundingClientRect/, "成长洞察自定义导航必须避让系统胶囊");
assert.match(template, /AI 成长教练/);
assert.match(template, /完成行动/);
assert.match(template, /行动完成率/);
assert.match(template, /教练观察/);
assert.match(template, /继续问教练/);
assert.match(template, /<coach-chat/);
assert.doesNotMatch(source, /getCoachConversation|loadConversation/, "成长教练重新进入时不得恢复历史会话");
assert.match(source, /messages:\s*\[\],\s*conversationId:\s*""/, "每次进入成长教练页都应开始新会话");
assert.match(source, /this\.data\.conversationId \|\| undefined/, "当前页面内应保留多轮上下文");
assert.match(chatTemplate, /\{\{item\.content\}\}/, "旧云函数或无模板回复必须保留正文降级展示");
assert.doesNotMatch(chatTemplate, /展开完整回复|reply-full|assistant-summary/);
assert.equal(config.navigationBarTitleText, "AI 成长教练");
  assert.equal(config.usingComponents["coach-chat"], undefined, "分包页面应继承主包全局聊天组件，避免按需打包漏载");

console.log("progress coach workspace tests passed");
