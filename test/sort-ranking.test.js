// 独立测试：验证 team-members 排序逻辑
// 该脚本模拟 index.ts 中的 sortByFocus / applyFilter / computeTop3

function sortByFocus(members) {
  return members.slice().sort((a, b) => {
    if (b.weeklyFocusMinutes !== a.weeklyFocusMinutes) {
      return b.weeklyFocusMinutes - a.weeklyFocusMinutes;
    }
    return a.id.localeCompare(b.id);
  });
}

function applyFilter(members, filter, keyword) {
  const trimmed = (keyword || "").trim();
  let list = members;
  if (trimmed) {
    list = list.filter((member) => member.nickname.toLowerCase().includes(trimmed.toLowerCase()));
  }
  switch (filter) {
    case "active":
      list = list.filter((member) => member.status === "checked" || member.status === "active");
      break;
    case "admin":
      list = list.filter((member) => member.role === "leader" || member.role === "admin");
      break;
    case "weekly":
    case "all":
    default:
      break;
  }
  return sortByFocus(list);
}

function computeTop3(members) {
  return sortByFocus(members).slice(0, 3);
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

function assertCondition(condition, name) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
}

const baseMembers = [
  { id: "u1", nickname: "我",   role: "leader", roleText: "队长",   status: "active",    statusText: "活跃",       weeklyFocusMinutes: 120, streakDays: 3, isSelf: true },
  { id: "u2", nickname: "阿岚", role: "admin",  roleText: "管理员", status: "checked",   statusText: "今日已打卡", weeklyFocusMinutes: 134, streakDays: 5, isSelf: false },
  { id: "u3", nickname: "林溪", role: "member", roleText: "成员",   status: "checked",   statusText: "今日已打卡", weeklyFocusMinutes: 130, streakDays: 5, isSelf: false },
  { id: "u4", nickname: "沐辰", role: "member", roleText: "成员",   status: "checked",   statusText: "今日已打卡", weeklyFocusMinutes: 128, streakDays: 3, isSelf: false },
];

console.log("\n[1] sortByFocus 核心排序");
{
  const result = sortByFocus(baseMembers).map((m) => m.weeklyFocusMinutes);
  assertEqual(result, [134, 130, 128, 120], "按时长降序：134 > 130 > 128 > 120");
}

console.log("\n[2] applyFilter(all) — 修复后用户不再是第一");
{
  const result = applyFilter(baseMembers, "all", "");
  const focusValues = result.map((m) => m.weeklyFocusMinutes);
  assertEqual(focusValues, [134, 130, 128, 120], "all 视图按时长降序");
  const myRank = result.findIndex((m) => m.isSelf) + 1;
  assertEqual(myRank, 4, "我（120 分）排名 = 4");
  assertEqual(result[0].nickname, "阿岚", "第一名是 阿岚（134 分）");
  assertEqual(result[1].nickname, "林溪", "第二名是 林溪（130 分）");
  assertEqual(result[2].nickname, "沐辰", "第三名是 沐辰（128 分）");
}

console.log("\n[3] applyFilter(weekly) — 与 all 顺序一致");
{
  const result = applyFilter(baseMembers, "weekly", "");
  const focusValues = result.map((m) => m.weeklyFocusMinutes);
  assertEqual(focusValues, [134, 130, 128, 120], "weekly 视图按时长降序");
}

console.log("\n[4] applyFilter(active) — 过滤后再排序");
{
  const input = [
    { id: "u1", nickname: "A", role: "member", status: "checked",   weeklyFocusMinutes: 100 },
    { id: "u2", nickname: "B", role: "member", status: "active",    weeklyFocusMinutes: 150 },
    { id: "u3", nickname: "C", role: "member", status: "normal",    weeklyFocusMinutes: 120 },
    { id: "u4", nickname: "D", role: "member", status: "unchecked", weeklyFocusMinutes: 130 },
  ];
  const result = applyFilter(input, "active", "");
  const ids = result.map((m) => m.id);
  assertEqual(ids, ["u2", "u1"], "active 过滤：checked/active 留下，且按降序");
}

console.log("\n[5] applyFilter(admin) — 过滤后再排序");
{
  const input = [
    { id: "u1", nickname: "A", role: "leader", weeklyFocusMinutes: 100 },
    { id: "u2", nickname: "B", role: "admin",  weeklyFocusMinutes: 150 },
    { id: "u3", nickname: "C", role: "member", weeklyFocusMinutes: 120 },
    { id: "u4", nickname: "D", role: "admin",  weeklyFocusMinutes: 130 },
  ];
  const result = applyFilter(input, "admin", "");
  const ids = result.map((m) => m.id);
  assertEqual(ids, ["u2", "u4", "u1"], "admin 过滤：leader/admin 留下，按降序为 u2(150) > u4(130) > u1(100)");
}

console.log("\n[6] 关键词搜索 + 排序");
{
  const result = applyFilter(baseMembers, "all", "林");
  assertEqual(result.length, 1, "搜索'林'命中 1 个");
  assertEqual(result[0].nickname, "林溪", "搜索'林'命中 林溪");
}

console.log("\n[7] tie-breaker 稳定排序");
{
  const input = [
    { id: "u3", nickname: "C", weeklyFocusMinutes: 100 },
    { id: "u1", nickname: "A", weeklyFocusMinutes: 100 },
    { id: "u2", nickname: "B", weeklyFocusMinutes: 100 },
  ];
  const result = sortByFocus(input).map((m) => m.id);
  assertEqual(result, ["u1", "u2", "u3"], "时长相同时按 id 升序（稳定）");
}

console.log("\n[8] 边界：空列表 / 单成员");
{
  assertEqual(applyFilter([], "all", ""), [], "空列表返回空");
  const single = [{ id: "u1", nickname: "我", role: "member", status: "checked", weeklyFocusMinutes: 50 }];
  const result = applyFilter(single, "all", "");
  assertEqual(result.length, 1, "单成员返回原列表");
  assertEqual(result[0].nickname, "我", "单成员保持原样");
}

console.log("\n[9] computeTop3 — 取前三名");
{
  const top3 = computeTop3(baseMembers);
  const focusValues = top3.map((m) => m.weeklyFocusMinutes);
  assertEqual(focusValues, [134, 130, 128], "Top3 = [阿岚 134, 林溪 130, 沐辰 128]");
  assertCondition(!top3.find((m) => m.nickname === "我"), "Top3 不包含'我'（120 分）");
}

console.log("\n[10] 大量数据性能与正确性");
{
  const big = Array.from({ length: 50 }, (_, i) => ({
    id: `u${i}`,
    nickname: `成员${i}`,
    role: "member",
    status: "checked",
    weeklyFocusMinutes: Math.floor(Math.random() * 300),
  }));
  const result = applyFilter(big, "all", "");
  let isSorted = true;
  for (let i = 1; i < result.length; i += 1) {
    if (result[i - 1].weeklyFocusMinutes < result[i].weeklyFocusMinutes) {
      isSorted = false;
      break;
    }
  }
  assertCondition(isSorted, "50 人数据全部按时长降序");
  assertEqual(result.length, 50, "数量完整保留");
}

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
