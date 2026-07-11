const assert = require("assert");
const { compareRank, MAX_TEAM_MEMBERS } = require("../cloudfunctions/generatePlan/team-rules");
const { formatBusinessDate } = require("../cloudfunctions/generatePlan/date");

assert.strictEqual(MAX_TEAM_MEMBERS, 20, "小队人数的云端唯一规则应为 20 人");
assert.strictEqual(Array.from({ length: 20 }).length, MAX_TEAM_MEMBERS);
assert.strictEqual(MAX_TEAM_MEMBERS + 1, 21, "第 21 人必须进入 TEAM_FULL 分支");

const members = [
  { id: "m4", growthMinutes: 70, completedAt: "2026-07-11T10:00:00.000Z" },
  { id: "m2", growthMinutes: 30, completedAt: "2026-07-11T09:00:00.000Z" },
  { id: "m3", growthMinutes: 70, completedAt: "2026-07-11T08:00:00.000Z" },
  { id: "m1", growthMinutes: 90, completedAt: "2026-07-11T11:00:00.000Z" },
  { id: "m5", growthMinutes: 70, completedAt: "2026-07-11T08:00:00.000Z" },
];

const expected = ["m1", "m3", "m5", "m4", "m2"];
assert.deepStrictEqual(members.slice().sort(compareRank).map((item) => item.id), expected,
  "榜单必须先按今日实际投入，再按达成时间、稳定 ID 排序");
assert.deepStrictEqual(members.slice().reverse().sort(compareRank).map((item) => item.id), expected,
  "平局结果不得依赖数据库返回顺序");

assert.strictEqual(formatBusinessDate(new Date("2026-07-11T15:59:59.999Z")), "2026-07-11");
assert.strictEqual(formatBusinessDate(new Date("2026-07-11T16:00:00.000Z")), "2026-07-12",
  "上海零点必须切换到新的每日榜单分区");

console.log("Team 20 人边界、今日分钟榜单、稳定平局与上海跨日测试通过");
