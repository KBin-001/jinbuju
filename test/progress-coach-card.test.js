const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}: ${error.message}`);
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

const page = read("miniprogram/pages/plan/index.ts");
const template = read("miniprogram/pages/plan/index.wxml");
const styles = read("miniprogram/pages/plan/index.wxss");
const coachSource = page.slice(page.indexOf("function buildAiCoachView"), page.indexOf("function buildGoalOptions"));

test("进度页教练卡只展示一句教练提示", () => {
  assert(template.includes("{{aiCoach.message}}"), "未绑定单一教练文案");
  assert(!template.includes("{{aiCoach.summary}} {{aiCoach.suggestion}}"), "仍在拼接统计总结和建议");
  assert(!coachSource.includes("累计完成"), "教练文案仍在报告累计统计");
});

test("无数据时引导完成一次小行动", () => {
  assert(coachSource.includes("完成一次小行动"), "缺少无数据引导");
  assert(coachSource.includes("成长记录会从这一步慢慢清晰起来"), "缺少成长感表达");
});

test("节奏上升、放慢和平稳时使用低压力行动提示", () => {
  assert(coachSource.includes('compareTone === "up"'), "未覆盖上升节奏");
  assert(coachSource.includes('compareTone === "down"'), "未覆盖放慢节奏");
  assert(coachSource.includes("节奏偶尔放慢没关系"), "缺少低压力表达");
  assert(coachSource.includes("保持现在的节奏"), "缺少平稳节奏提示");
});

test("标题和入口使用教练口吻", () => {
  assert(page.includes('"AI 教练 · 本周一句话"'), "缺少本周教练标题");
  assert(page.includes('"AI 教练 · 本月一句话"'), "缺少本月教练标题");
  assert(page.includes('"AI 教练 · 年度一句话"'), "缺少年度教练标题");
  assert(template.includes("和教练聊聊"), "入口仍是分析报告口吻");
  assert(template.includes('bindtap="openAiCoach"'), "教练详情入口丢失");
});

test("教练文案允许完整换行", () => {
  const copyRule = styles.slice(styles.indexOf(".conclusion-copy"), styles.indexOf(".conclusion-action"));
  assert(copyRule.includes("white-space: normal"), "正文未允许自然换行");
  assert(!copyRule.includes("line-clamp"), "正文仍存在行数截断");
  assert(!copyRule.includes("text-overflow: ellipsis"), "正文仍显示省略号");
});

console.log(`\n========== 进度页 AI 教练卡：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
