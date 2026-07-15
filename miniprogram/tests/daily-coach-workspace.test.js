const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "pages/daily-coach/index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "pages/daily-coach/index.wxml"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "pages/daily-coach/index.json"), "utf8"));
const service = fs.readFileSync(path.join(root, "services/dailyCoach.ts"), "utf8");

assert.match(template, /今日结论/);
assert.match(template, /教练判断/);
assert.doesNotMatch(template, /下一步建议|next-step|runPrimaryAction|runSecondaryAction/);
assert.match(template, /继续和教练聊聊/);
assert.match(template, /今日行动完成率/);
assert.doesNotMatch(template, /jinbuju-ai-robot|coach-robot|帮我分析一下今天的完成情况<\/view>/, "页面不应伪造聊天或继续使用卡通机器人");
assert.match(page, /getDailyCoachAnalysis/);
assert.match(page, /askProgressCoach\("day"/);
assert.match(page, /executeCoachAction/);
assert.doesNotMatch(page, /updateActionRecord|action-record-editor|recordEditorVisible/);
assert.match(page, /slice\(-6\)/, "聊天区最多保留最近三组问答");
assert.match(page, /scope=week/, "最近一周必须进入真实周分析能力");
assert.match(page, /getMenuButtonBoundingClientRect/, "自定义导航必须避让微信右上角胶囊");
assert.match(template, /padding-right: \{\{menuRightInset\}\}px/, "导航未使用真实胶囊右侧占位");
assert.match(template, /class="send-button[^>]*><t-icon/, "发送入口必须保持独立圆形控件");
assert.doesNotMatch(template, /<button class="(?:nav-back|records-button|send-button|quick-question)/, "易被基础库拉伸的导航和快捷控件不应使用原生 button");
assert.match(service, /status !== "skipped"/, "每日教练完成率应与今日页排除“今天不做”的口径一致");
assert.equal(config.usingComponents["action-record-editor"], undefined);
assert.equal(config.usingComponents["t-icon"], "tdesign-miniprogram/icon/icon");

console.log("daily coach workspace tests passed");
