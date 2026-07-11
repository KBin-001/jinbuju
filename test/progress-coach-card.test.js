const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const page = read("miniprogram/pages/plan/index.ts");
const template = read("miniprogram/pages/plan/index.wxml");

assert(template.includes("coachStatus === 'ready' ? 'AI 教练' : '行动总结'"), "进度页未区分真实 AI 与本地总结");
assert(template.includes("AI 暂不可用 · 本地规则建议"), "进度页 AI 失败时未标注本地规则来源");
assert(template.includes("AI 已读取真实行动记录"), "AI 成功状态未说明数据来源");
assert(template.includes("正在读取真实行动记录"), "AI 加载状态未说明正在读取真实数据");
assert(page.includes('coachStatus: "idle" as "idle" | "loading" | "ready" | "error"'), "进度页 AI 状态结构不完整");
assert(page.includes("function buildWeekBuckets") && page.includes("mondayOffset"), "周趋势未按自然周构建");
assert(page.includes("function buildMonthBuckets") && page.includes("monthStartDate"), "月趋势未按自然月构建");
assert(page.includes("function trendPeriodLabel"), "趋势页缺少自然周期范围文案");
assert(page.includes("rangeLabel"), "趋势数据未暴露统计范围标签");

console.log("进度页 AI 来源标签与自然周期入口检查通过");
