const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const page = read("miniprogram/pages/index/index.ts");
const template = read("miniprogram/pages/index/index.wxml");
const styles = read("miniprogram/pages/index/index.wxss");
const coachTemplate = read("miniprogram/components/ai-coach-tip/index.wxml");
const coachStyles = read("miniprogram/components/ai-coach-tip/index.wxss");
const progressTemplate = read("miniprogram/components/daily-progress/index.wxml");

assert(template.includes('bind:open="openDailyCoach"'), "教练详情入口缺失");
assert(template.includes('text="{{coachTipText}}"'), "今日页 AI 建议缺少动态内容绑定");
assert(coachTemplate.includes('bindtap="openCoach"'), "轻量教练组件必须保留详情入口");
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
assert(!template.includes("ai-coach-shanshui-v1.jpg"), "今日建议不应继续使用已清理的强背景图");
assert(coachTemplate.includes("status === 'loading'") && coachTemplate.includes("status === 'error'"), "今日建议必须区分 AI 成功、加载和失败回退状态");
assert(coachTemplate.includes("AI 成长教练"), "今日入口标题必须与成长教练会话统一");
assert(!template.includes("today-coach-watercolor-v2.jpg"), "今日建议不应引用已清理的旧插画");
assert(template.includes("<daily-progress"), "今日投入应使用轻量进度组件");
assert(progressTemplate.includes("targetMinutes") && progressTemplate.includes("actualMinutes") && progressTemplate.includes("percent"), "轻量进度必须绑定目标、实际投入与百分比");
assert(!template.includes("stats-grid") && !template.includes('canvas type="2d"'), "今日页不应恢复厚重统计卡或装饰画布");
assert(page.includes("todayTargetMinutes") && page.includes("todayActualMinutes") && page.includes("todayMinuteProgress"), "今日目标进度必须由真实分钟数据计算");
assert(!page.includes("drawMinutesTrend") && !page.includes("drawProgressTrend"), "轻量进度不应继续维护趋势画布");
assert(coachStyles.includes("#a17630"), "AI 教练金色强调样式缺失");
assert(!template.includes("stats-card-landscape-v2.jpg"), "今日成果卡不应引用已清理的旧背景");
assert(!template.includes("stats-progress-ring"), "今日成果卡不应继续使用圆环进度");
assert(!page.includes("drawSummaryRing"), "旧圆环绘制逻辑未清理");

console.log("今日页 AI 成功、失败与本地建议标签检查通过");
