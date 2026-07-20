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
const teamStyles = read("miniprogram/pages/team/index.wxss");
assert.match(teamPage, /memberDataInconsistent/, "成员计数冲突或本人缺失时必须阻止单双人误判");
assert.match(teamPage, /小队成员数据暂时不同步，请重新加载/, "成员数据异常必须提供可重试提示");
assert.doesNotMatch(teamPage, /dailyStats\?\.completionRate/, "成员完成比例不得混用行动平均完成率");
assert.match(teamTemplate, /teamViewMode === 'solo'/, "小队首页必须有独立单人态");
assert.match(teamTemplate, /teamViewMode === 'group'/, "小队首页必须有独立多人态");
assert.match(teamTemplate, /邀请第一位伙伴/, "单人态必须提供真实邀请入口");
assert.match(teamTemplate, /status === 'empty'[\s\S]*empty-community-card/, "未加入小队时必须展示成长社区入口");
assert.match(teamTemplate, /empty-team-hero[\s\S]*createLocalTeam[\s\S]*openJoinPopup/, "未加入小队主卡必须保留创建与房间号加入双入口");
assert.match(teamTemplate, /team-companions-hero\.jpg/, "未加入小队主卡必须保留同行人物插画层");
assert.match(teamTemplate, /已有多位用户加入/, "小队空状态只能使用克制且不虚构具体人数的加入提示");
assert.doesNotMatch(teamTemplate, /12,?000|3\.2w|今日新增活跃用户/, "小队空状态不得写入虚构用户规模或活跃数字");
assert.match(teamTemplate, /community-people\.jpg/, "小队社区入口必须使用真实接入的浅色同行人物插画");
assert.match(teamTemplate, /show-menu-by-longpress="\{\{true\}\}"/, "小队社区二维码必须支持长按识别");
assert.match(teamPage, /openGrowthCommunity\(\)/, "小队社区入口必须绑定真实打开事件");
assert.match(teamPage, /getCommunityEntry/, "小队社区入口必须读取当前社区配置");
assert.match(teamStyles, /\.empty-community-card/, "小队空状态社区入口必须具有独立卡片样式");
assert.match(teamStyles, /\.empty-team-benefits/, "小队空状态必须具备清晰的功能利益点布局");

console.log("Team runtime contract、邀请页注册与隐私安全分享契约测试通过");
