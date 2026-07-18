const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const component = fs.readFileSync(path.join(root, "components/coach-chat/index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "components/coach-chat/index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(root, "components/coach-chat/index.wxss"), "utf8");
const service = fs.readFileSync(path.join(root, "services/progressCoach.ts"), "utf8");
const daily = fs.readFileSync(path.join(root, "pages/daily-coach/index.wxml"), "utf8");
const overall = fs.readFileSync(path.join(root, "pages/ai-coach/index.wxml"), "utf8");
const appConfig = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));

assert.match(component, /slice\(0, 1000\)/);
assert.match(template, /maxlength="1000"/);
assert.match(template, /<textarea[^>]*auto-height[^>]*fixed/);
assert.match(template, /coach-chat__answer">\{\{item\.content\}\}<\/view>/);
assert.match(template, /userAvatarUrl/);
assert.match(template, /item\.presentation\.metrics/);
assert.match(template, /item\.presentation\.priorities/);
assert.match(template, /coach-chat__avatar/);
assert.match(styles, /\.coach-chat__answer[^}]*white-space:\s*pre-wrap/s);
assert.match(styles, /overflow-wrap:\s*anywhere/);
assert.match(styles, /coach-chat__metric-fill/);
assert.match(styles, /\.coach-chat__input-dock\s*\{[^}]*position:\s*fixed/s);
assert.doesNotMatch(styles, /(^|[,{]\s*)(?:button|view|text|image|textarea|input|scroll-view)(?:\s|:|\{|,)/m, "组件 WXSS 不得使用标签选择器");
assert.doesNotMatch(styles, /\.[A-Za-z0-9_-]+\[[^\]]+\]/, "组件 WXSS 不得使用属性选择器");
assert.doesNotMatch(template, /rich-text|markdown|item\.(?:summary|advice|insights)|展开完整回复/);
assert.match(service, /action:\s*"getCoachConversation"/);
assert.match(service, /limit:\s*Math\.max\(1, Math\.min\(50/);
assert.match(daily, /<coach-chat/);
assert.match(overall, /<coach-chat/);
assert.equal(appConfig.usingComponents["coach-chat"], "/components/coach-chat/index");

console.log("coach chat contract tests passed");
