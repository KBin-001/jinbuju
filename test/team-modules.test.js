const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));
const rules = require("../cloudfunctions/generatePlan/team-rules");

assert.equal(rules.ROOM_CODE_PATTERN.test("2486"), true, "新建小队房间号必须为 4 位数字");
assert.equal(rules.ROOM_CODE_PATTERN.test("248"), false, "新建小队房间号不能少于 4 位");
assert.equal(rules.ROOM_CODE_PATTERN.test("TQLR23"), false, "新建小队房间号不能再使用字母数字混合格式");
assert.equal(rules.normalizeRoomCode("2486"), "2486", "4 位数字房间号应可加入");
assert.equal(rules.normalizeRoomCode("TQLR23"), "TQLR23", "已有 6 位房间号应继续兼容");

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
const registeredPages = [
  ...(app.pages || []),
  ...(app.subpackages || []).flatMap((subpackage) =>
    (subpackage.pages || []).map((page) => `${subpackage.root}/${page}`)),
];
assert(registeredPages.includes("pages/team-invite/index"), "邀请页必须注册为小程序页面或分包页面");
const invite = read("miniprogram/pages/team-invite/index.ts");
const inviteTemplate = read("miniprogram/pages/team-invite/index.wxml");
assert.match(invite, /onShareAppMessage\s*\(/, "邀请页必须提供小程序分享回调");
assert.match(invite, /pages\/team\/index\?roomCode=/, "分享路径必须携带房间号并回到小队页");
assert.doesNotMatch(invite, /openid|OPENID|goalTitle|actionDetail/i, "分享负载不得携带身份或行动隐私");
assert.match(inviteTemplate, /open-type="share"/, "邀请页必须使用微信原生分享能力");
assert.match(inviteTemplate, /二维码/);
assert.match(inviteTemplate, /邀请海报/);

const teamPage = read("miniprogram/pages/team/index.ts");
const teamTemplate = read("miniprogram/pages/team/index.wxml");
assert.match(teamPage, /memberDataInconsistent/, "成员计数冲突或本人缺失时必须阻止单双人误判");
assert.match(teamPage, /小队成员数据暂时不同步，请重新加载/, "成员数据异常必须提供可重试提示");
assert.doesNotMatch(teamPage, /dailyStats\?\.completionRate/, "成员完成比例不得混用行动平均完成率");
assert.match(teamTemplate, /teamViewMode === 'solo'/, "小队首页必须有独立单人态");
assert.match(teamTemplate, /teamViewMode === 'group'/, "小队首页必须有独立多人态");
assert.match(teamTemplate, /邀请第一位伙伴/, "单人态必须提供真实邀请入口");

console.log("Team runtime contract、邀请页注册与隐私安全分享契约测试通过");
