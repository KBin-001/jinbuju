const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("miniprogram/pages/plan/index.ts");
const template = read("miniprogram/pages/plan/index.wxml");
const coachPage = read("miniprogram/pages/ai-coach/index.ts");
const coachService = read("miniprogram/services/progressCoach.ts");

assert.match(template, /还没有目标/);
assert.match(template, /先创建一个想推进的方向/);
assert.match(template, /已经了解你的目标/);
assert.match(template, /添加第一条行动后，进度会开始记录/);
assert.match(template, /wx:if="\{\{hasActionData\}\}" class="growth-stats/);
assert.match(template, /wx:if="\{\{hasActionData\}\}" class="trend-card/);
assert.match(template, /最近完成/);
assert.match(template, /待继续行动/);
assert.match(template, /bindtap="openAiCoach"/);
assert.match(template, /完成行动（点）/);
assert.doesNotMatch(template, /<canvas/);
assert.doesNotMatch(template, /trendLine/);
assert.match(template, /growth-start-card/);
assert.match(template, /第一步，会让远山有了方向/);
assert((template.match(/progress-mountain-path-v2\.jpg/g) || []).length >= 3, "进度页关键区域必须保留山水品牌层次");
assert.match(template, /ai-coach-shanshui-v1\.jpg/, "成长教练应使用专用 AI 山水背景");
assert.match(template, /当前为数据观察/, "规则文案不得冒充 AI 自动生成结论");

assert.doesNotMatch(page, /analyzeProgress\s*\(/, "进入进度页不得自动生成 AI 报告");
assert.doesNotMatch(page, /prepareProgressCoach\s*\(/, "进入进度页不得发起 AI 上下文网络请求");
assert.doesNotMatch(coachPage, /prepareProgressCoach\s*\(/, "打开 AI 面板不得自动发起上下文网络请求");
assert.match(coachService, /askProgressCoach[\s\S]*await prepareProgressCoach/, "只能在用户发送问题时准备上下文并调用 AI");
assert.match(page, /task\.activityDate \|\| task\.currentDate/, "趋势必须使用真实行动业务日期");
assert.match(page, /task\.status === "rescheduled" && !\(task\.actualMinutes \|\| 0\)/, "顺延前真实投入必须保留");
assert.doesNotMatch(page, /超过了 \$\{percentile\}% 的用户/, "不得伪造用户分位比较");
assert.match(page, /const insufficient = checkinDays < 1/, "年度热力图只能在完全无记录时进入空状态");
assert.match(coachService, /!task\.deletedAt/, "AI 上下文必须排除软删除行动");
assert.match(page, /function buildWeekBuckets/);
assert.match(page, /function buildMonthBuckets/);
assert.match(page, /function trendPeriodLabel/);
assert.match(page, /pages\/today-data\/index/, "查看历史记录必须进入当前目标的每日记录闭环");
assert.doesNotMatch(page, /暂无历史复盘/, "当前目标历史入口不应错误依赖已归档目标");

console.log("进度页三态、真实统计与 AI 按需调用契约测试通过");
