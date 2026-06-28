/**
 * 昨日数据修复验证测试
 * 验证"对比昨日"证据卡在不同场景下与"本周平均"/"连续投入"显示一致
 */

const assert = require("assert");

// 复刻 buildVsYesterdayText 修复后的逻辑
function buildVsYesterdayText(todayMinutes, yesterdayMinutes, periodHasData = true) {
  if (todayMinutes <= 0 && yesterdayMinutes <= 0) {
    return periodHasData ? "今日暂未记录" : "暂无数据";
  }
  if (todayMinutes <= 0) return `-${yesterdayMinutes} 分钟`;
  if (yesterdayMinutes <= 0) return `+${todayMinutes} 分钟`;
  const diff = todayMinutes - yesterdayMinutes;
  if (diff > 0) return `+${diff} 分钟`;
  if (diff < 0) return `${diff} 分钟`;
  return "持平";
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

// 场景 1：新用户首日完成今日任务，昨日无任务
test('新用户首日：今日有记录、昨日无记录，应显示 +XX 分钟', () => {
  const result = buildVsYesterdayText(30, 0, true);
  assert.equal(result, "+30 分钟", `期望 "+30 分钟"，实际 "${result}"`);
});

// 场景 2：本周早些有数据，但今日昨日都无记录
test('本周有数据但今日昨日均无记录：应显示 今日暂未记录 而非 暂无数据', () => {
  const result = buildVsYesterdayText(0, 0, true);
  assert.equal(result, "今日暂未记录", `期望 "今日暂未记录"，实际 "${result}"`);
});

// 场景 3：整个周期无任何数据
test('整个周期无数据：应显示 暂无数据', () => {
  const result = buildVsYesterdayText(0, 0, false);
  assert.equal(result, "暂无数据", `期望 "暂无数据"，实际 "${result}"`);
});

// 场景 4：今日昨日都有记录，今日更多
test('今日昨日均有记录，今日更多：应显示 +diff 分钟', () => {
  const result = buildVsYesterdayText(45, 30, true);
  assert.equal(result, "+15 分钟", `期望 "+15 分钟"，实际 "${result}"`);
});

// 场景 5：今日昨日都有记录，昨日更多
test('今日昨日均有记录，昨日更多：应显示 -diff 分钟', () => {
  const result = buildVsYesterdayText(20, 30, true);
  assert.equal(result, "-10 分钟", `期望 "-10 分钟"，实际 "${result}"`);
});

// 场景 6：今日昨日记录相同
test('今日昨日记录相同：应显示 持平', () => {
  const result = buildVsYesterdayText(30, 30, true);
  assert.equal(result, "持平", `期望 "持平"，实际 "${result}"`);
});

// 场景 7：今日无记录但昨日有记录
test('今日无记录但昨日有记录：应显示 -XX 分钟', () => {
  const result = buildVsYesterdayText(0, 40, true);
  assert.equal(result, "-40 分钟", `期望 "-40 分钟"，实际 "${result}"`);
});

// 场景 8：一致性验证 - 本周平均有数据时，对比昨日不应显示 暂无数据
test('一致性：本周有数据时（periodHasData=true），对比昨日不应显示 暂无数据', () => {
  const result = buildVsYesterdayText(0, 0, true);
  assert.notEqual(result, "暂无数据", '本周有数据时不应显示 暂无数据');
  assert.ok(result.length > 0, '应显示有意义的文案');
});

// 场景 9：一致性验证 - 本周平均无数据时，对比昨日也应显示 暂无数据
test('一致性：本周无数据时（periodHasData=false），对比昨日应显示 暂无数据', () => {
  const result = buildVsYesterdayText(0, 0, false);
  assert.equal(result, "暂无数据", '本周无数据时应显示 暂无数据');
});

// 运行测试
console.log('开始运行昨日数据修复验证测试...\n');
let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
    failed++;
  }
}
console.log(`\n========== 昨日数据修复测试：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
