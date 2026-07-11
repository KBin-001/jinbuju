const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const page = read("miniprogram/pages/index/index.ts");
const template = read("miniprogram/pages/index/index.wxml");

assert(template.includes("coachStatus === 'ready' ? 'AI 教练' : '行动建议'"), "真实 AI 与本地行动建议的标题未区分");
assert(template.includes("AI 暂不可用"), "AI 失败状态缺少明确标签");
assert(template.includes("本地规则"), "本地规则建议未标注来源");
assert(template.includes("正在读取记录"), "AI 加载状态缺少反馈");
assert(template.includes('bindtap="openDailyCoach"'), "教练详情入口缺失");
assert(page.includes('coachStatus: "idle" as "idle" | "loading" | "ready" | "error"'), "今日页 AI 状态结构不完整");
assert(page.includes('coachStatus: "loading"'), "请求 AI 前未进入加载状态");
assert(page.includes('coachStatus: "ready"'), "AI 成功状态未落地");
assert(page.includes('coachStatus: "error"'), "AI 失败状态未落地");

console.log("今日页 AI 成功、失败与本地建议标签检查通过");
