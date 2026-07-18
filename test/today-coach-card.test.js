const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const page = read("miniprogram/pages/index/index.ts");
const template = read("miniprogram/pages/index/index.wxml");
const styles = read("miniprogram/pages/index/index.wxss");

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
assert(!template.includes("ai-coach-shanshui-v1.jpg"), "今日建议不应继续使用已清理的强背景图");
assert(template.includes("coachStatus === 'loading'") && template.includes("coachStatus === 'error'") && template.includes("proactiveInsight.title"), "今日建议必须区分 AI 成功、加载和失败回退状态");
assert(template.includes("AI 成长教练 · 今日") && template.includes("查看完整建议与对话"), "今日入口标题和 CTA 必须与成长教练会话统一");
assert(!template.includes("today-coach-watercolor-v2.jpg"), "今日建议不应引用已清理的旧插画");
assert(template.includes("stats-grid") && template.includes("stats-column--done") && template.includes("stats-column--minutes"), "已完成和今日投入两栏必须保留原结构");
assert(template.includes("stats-value--done") && template.includes("stats-mini-bars"), "已完成和今日投入原有数据表达不得被改写");
assert(template.includes("today-progress-river.svg"), "今日进度缺少专用水流矢量资产");
assert(fs.existsSync(path.join(root, "miniprogram/assets/today-progress-river.svg")), "今日进度水流矢量资产不存在");
assert(template.includes("stats-flow-active") && template.includes("{{flowRemainingPercent}}%") && page.includes("flowRemainingPercent: 100 - completionPercent(summary)"), "水流必须使用整宽图层按真实进度裁切");
assert(!page.includes("riverMarkerTop"), "局部进度组件不应引入整卡曲线节点状态");
assert(template.includes("summary.completedCount") && template.includes("summary.actualMinutes"), "行动与投入数据必须来自真实今日统计");
assert(template.includes("今日达成") && template.includes("等待启程"), "今日进度必须覆盖完成与空状态反馈");
assert(!template.includes("stats-mountain-fill"), "今日进度不得保留生硬的山形进度条");
assert(!template.includes("stats-flow-shimmer") && !styles.includes("@keyframes stats-flow-current"), "小尺寸进度中不应出现晃动的白色高光");
assert(styles.includes("width: 100%") && styles.includes("transition: clip-path") && styles.includes("prefers-reduced-motion"), "100% 水流必须完整铺满并支持减少动态效果");
assert(!template.includes("stats-card-landscape-v2.jpg"), "今日成果卡不应引用已清理的旧背景");
assert(!template.includes("stats-progress-ring"), "今日成果卡不应继续使用圆环进度");
assert(!page.includes("drawSummaryRing"), "旧圆环绘制逻辑未清理");

console.log("今日页 AI 成功、失败与本地建议标签检查通过");
