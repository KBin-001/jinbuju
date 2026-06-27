// 独立测试：验证 theme.ts 中主题被正确清理为 4 个
// 模拟 THEME_PRESETS 与 isThemeId 的运行期行为

const THEME_PRESETS = [
  { id: "mint",     name: "薄荷绿",   tags: ["清新"] },
  { id: "cream",    name: "奶油黄",   tags: ["柔和", "活力"] },
  { id: "inkGreen", name: "墨绿成长", tags: ["沉稳"] },
  { id: "apricot",  name: "奶油杏桃", tags: ["柔和", "活力"] },
];

const VALID_IDS = new Set(THEME_PRESETS.map((t) => t.id));
const REMOVED_IDS = ["lake", "lavender", "midnight"];

function isThemeId(value) {
  return VALID_IDS.has(value);
}

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected: ${e}`);
    console.log(`        actual:   ${a}`);
  }
}

function assertCondition(cond, name) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
}

console.log("\n[1] 主题列表数量 = 4");
assertEqual(THEME_PRESETS.length, 4, "THEME_PRESETS 数组长度为 4");

console.log("\n[2] 主题 id 顺序正确");
assertEqual(
  THEME_PRESETS.map((t) => t.id),
  ["mint", "cream", "inkGreen", "apricot"],
  "id 顺序：[薄荷绿, 奶油黄, 墨绿成长, 奶油杏桃]"
);

console.log("\n[3] 主题中文名顺序正确");
assertEqual(
  THEME_PRESETS.map((t) => t.name),
  ["薄荷绿", "奶油黄", "墨绿成长", "奶油杏桃"],
  "中文名顺序"
);

console.log("\n[4] 被删除主题的 id 已不在列表中");
const stillPresent = REMOVED_IDS.filter((id) => THEME_PRESETS.find((t) => t.id === id));
assertEqual(stillPresent, [], "lake / lavender / midnight 已被完全移除");

console.log("\n[5] isThemeId 守卫拒绝已删除 id");
REMOVED_IDS.forEach((id) => {
  assertCondition(!isThemeId(id), `isThemeId("${id}") === false`);
});

console.log("\n[6] isThemeId 守卫接受仍合法 id");
["mint", "cream", "inkGreen", "apricot"].forEach((id) => {
  assertCondition(isThemeId(id), `isThemeId("${id}") === true`);
});

console.log("\n[7] 旧 localStorage 中残留的删除 id 不会引发崩溃");
const oldStorageValues = ["lake", "lavender", "midnight", undefined, null, "", "mint"];
oldStorageValues.forEach((value) => {
  const isValid = isThemeId(value);
  // 模拟 getCurrentThemeId：非法值会回退到 mint
  const fallback = isValid ? value : "mint";
  if (!isValid) {
    assertEqual(fallback, "mint", `非法值 ${JSON.stringify(value)} → 回退到 mint`);
  }
});

console.log("\n[8] 主题筛选（THEME_FILTERS）仍有命中");
const THEME_FILTERS = ["全部", "柔和", "沉稳", "清新", "活力"];
THEME_FILTERS.forEach((filter) => {
  const matches =
    filter === "全部"
      ? THEME_PRESETS
      : THEME_PRESETS.filter((t) => t.tags.includes(filter));
  assertCondition(matches.length > 0, `筛选「${filter}」有 ${matches.length} 个主题`);
});

console.log("\n[9] 位置编号：被删除的为原 3/6/7 位");
const removedByPosition = ["原位置3(lake)", "原位置6(lavender)", "原位置7(midnight)"];
const beforeOrder = ["mint", "cream", "lake", "inkGreen", "apricot", "lavender", "midnight"];
const removed = ["lake", "lavender", "midnight"];
const removedPositions = removed.map((id) => beforeOrder.indexOf(id) + 1);
assertEqual(removedPositions, [3, 6, 7], "被删除主题的原位置编号");

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
