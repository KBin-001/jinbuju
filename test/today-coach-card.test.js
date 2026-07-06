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

const page = read("miniprogram/pages/index/index.ts");
const template = read("miniprogram/pages/index/index.wxml");
const styles = read("miniprogram/pages/index/index.wxss");
const nudgeSource = page.slice(page.indexOf("function dailyNudge"), page.indexOf("function buildWeekDays"));
const subtitleRule = styles.slice(
  styles.indexOf(".today-page[data-theme] .reference-coach-subtitle"),
  styles.indexOf(".today-page[data-theme] .reference-coach-arrow"),
);

test("待开始和部分完成使用具体行动的一句话提示", () => {
  assert(nudgeSource.includes('task.status === "pending" || task.status === "partially_completed"'), "未覆盖待开始和部分完成状态");
  assert(nudgeSource.includes('先从“${nextTask.displayTitle}”开始'), "未指向具体行动");
  assert(nudgeSource.includes("专注 10 分钟"), "缺少可执行的开始建议");
  assert(!nudgeSource.includes("${remaining.length}"), "仍在报告剩余行动数量");
});

test("全部完成使用简短复盘提示", () => {
  assert(nudgeSource.includes('tasks.every((task) => task.status === "completed")'), "未覆盖全部完成状态");
  assert(nudgeSource.includes("花 2 分钟记下最有效的做法吧"), "缺少完成后的轻量复盘提示");
});

test("跳过或顺延使用低压力重新开始提示", () => {
  assert(nudgeSource.includes("先照顾好自己的节奏"), "缺少低压力表达");
  assert(nudgeSource.includes("从一件最小的事重新开始"), "缺少重新开始建议");
});

test("无行动时引导添加 15 到 30 分钟的小事", () => {
  assert(nudgeSource.includes("先添加一件 15～30 分钟能完成的小事"), "无行动提示不符合预期");
  assert(page.includes('dailyNudge: "先添加一件 15～30 分钟能完成的小事，让今天轻轻开个头。"'), "初始文案未同步");
});

test("教练卡标题、完整展示和点击入口保持正确", () => {
  assert(template.includes("<text>AI 教练</text>"), "卡片标题不是 AI 教练");
  assert(template.includes('bindtap="openDailyCoach"'), "每日教练点击入口丢失");
  assert(subtitleRule.includes("white-space: normal"), "正文未允许自然换行");
  assert(!subtitleRule.includes("line-clamp"), "正文仍存在行数截断");
  assert(!subtitleRule.includes("text-overflow: ellipsis"), "正文仍显示省略号");
});

console.log(`\n========== 今日 AI 教练卡：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
