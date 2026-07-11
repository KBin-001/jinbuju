const assert = require("assert");
const { compareRank, MAX_TEAM_MEMBERS } = require("../cloudfunctions/generatePlan/team-rules");

assert.strictEqual(MAX_TEAM_MEMBERS, 50);

const members = [
  { id: "m4", completionRate: 80, growthMinutes: 70, completedAt: "2026-07-11T10:00:00.000Z" },
  { id: "m2", completionRate: 100, growthMinutes: 30, completedAt: "2026-07-11T09:00:00.000Z" },
  { id: "m3", completionRate: 80, growthMinutes: 70, completedAt: "2026-07-11T08:00:00.000Z" },
  { id: "m1", completionRate: 80, growthMinutes: 90, completedAt: "2026-07-11T11:00:00.000Z" },
  { id: "m5", completionRate: 80, growthMinutes: 70, completedAt: "2026-07-11T08:00:00.000Z" },
];

assert.deepStrictEqual(members.slice().sort(compareRank).map((item) => item.id), ["m2", "m1", "m3", "m5", "m4"]);
assert.deepStrictEqual(members.slice().reverse().sort(compareRank).map((item) => item.id), ["m2", "m1", "m3", "m5", "m4"], "稳定排序不应依赖输入顺序");

console.log("50 人上限与四级稳定排名规则检查通过");
