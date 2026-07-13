const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const page = read("miniprogram/pages/index/index.ts");
const template = read("miniprogram/pages/index/index.wxml");

assert(template.includes('bindtap="openDailyCoach"'), "教练详情入口缺失");
assert(template.includes("proactiveInsight.title"), "今日页 AI 卡缺少主动观察标题");
assert(template.includes("proactiveInsight.body"), "今日页 AI 卡缺少主动观察内容");
assert(page.includes("function buildProactiveInsight"), "今日页缺少主动观察规则");
assert(page.includes("streak >= 7"), "主动观察缺少连续行动提醒");
assert(page.includes("remaining === 1"), "主动观察缺少最后一项闭环提醒");
assert(!page.includes("title: analysis.summary"), "主动观察不应被长篇 AI 分析覆盖");
assert(page.includes("function buildAiPriorityInsight"), "今日页缺少 AI 优先级提炼");
assert(page.includes('label: "AI 优先级 1"'), "AI 建议未标注优先级");
assert(page.includes('prepareProgressCoach("day"'), "今日页未在后台准备 AI 分析");
assert(page.includes("analyzeProgress(goal.id, \"day\""), "今日页未在后台请求 AI 分析");
assert(!template.includes("value-strip"), "首页不应保留重复价值卡");
assert(!template.includes("reference-coach-title"), "首页不应保留重复 AI 教练标题");
assert(template.includes("progress-mountain-path-v2.jpg"), "主动观察应使用山水背景");
assert(!template.includes('src="/assets/today-coach-watercolor-v2.jpg" mode="aspectFill" />\n        <view'), "机器人插画不应处于启用状态");
assert(template.includes("stats-grid"), "今日成果卡缺少三列统计结构");
assert(template.includes("stats-value--done"), "今日成果卡缺少完成指标");
assert(template.includes("stats-mini-bars"), "今日投入缺少真实节奏微图");
assert(template.includes("stats-mountain-fill"), "今日成果卡缺少山形进度反馈");
assert(template.includes("全部完成") && template.includes("目标达成"), "全部完成时缺少正反馈文案");
assert(template.includes("stats-card-landscape-v2.jpg"), "今日成果卡缺少专用山水背景");
assert(!template.includes("stats-progress-ring"), "今日成果卡不应继续使用圆环进度");
assert(!page.includes("drawSummaryRing"), "旧圆环绘制逻辑未清理");

console.log("今日页 AI 成功、失败与本地建议标签检查通过");
