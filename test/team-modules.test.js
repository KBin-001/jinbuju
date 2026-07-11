const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));
const rules = require("../cloudfunctions/generatePlan/team-rules");

const requiredRuntimeActions = [
  "getTeamRuntimeInfo", "getMyTeam", "getTeamPage", "createTeam", "joinTeamByRoomCode",
  "getTeamActivityFeed", "updateTeamSettings", "updateTeamMemberPrivacy", "removeTeamMember",
  "leaveTeam", "transferTeamOwner", "dissolveTeam", "sendEncouragement", "syncTeamActivity",
];
assert.strictEqual(rules.TEAM_CONTRACT_VERSION, 2);
assert(Number.isInteger(rules.TEAM_SCHEMA_VERSION) && rules.TEAM_SCHEMA_VERSION >= 2);
assert(/^team-cloud-\d{4}-\d{2}-\d{2}\./.test(rules.TEAM_BUILD_ID));
for (const action of requiredRuntimeActions) {
  assert(rules.TEAM_SUPPORTED_ACTIONS.includes(action), `runtime contract 缺少 ${action}`);
}

const app = json("miniprogram/app.json");
assert(app.pages.includes("pages/team-invite/index"), "邀请页必须注册为小程序页面");
const invite = read("miniprogram/pages/team-invite/index.ts");
const inviteTemplate = read("miniprogram/pages/team-invite/index.wxml");
assert.match(invite, /onShareAppMessage\s*\(/, "邀请页必须提供小程序分享回调");
assert.match(invite, /pages\/team\/index\?roomCode=/, "分享路径必须携带房间号并回到小队页");
assert.doesNotMatch(invite, /openid|OPENID|goalTitle|actionDetail/i, "分享负载不得携带身份或行动隐私");
assert.match(inviteTemplate, /open-type="share"/, "邀请页必须使用微信原生分享能力");
assert.match(inviteTemplate, /二维码/);
assert.match(inviteTemplate, /邀请海报/);

console.log("Team runtime contract、邀请页注册与隐私安全分享契约测试通过");
