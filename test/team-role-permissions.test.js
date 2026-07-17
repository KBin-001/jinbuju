const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const homeTs = read("miniprogram/pages/team/index.ts");
const homeWxml = read("miniprogram/pages/team/index.wxml");
const membersTs = read("miniprogram/pages/team-members/index.ts");
const membersWxml = read("miniprogram/pages/team-members/index.wxml");
const service = read("miniprogram/services/team.ts");
const types = read("miniprogram/types/team.ts");
const cloud = read("cloudfunctions/generatePlan/team.js");

// Owner 与 member 使用同一主页及公共信息，不维护两套容易漂移的页面。
assert.strictEqual((homeWxml.match(/class="team-hero paper-card"/g) || []).length, 1,
  "owner/member 必须复用同一小队主页 Hero");
for (const publicField of ["displayTeamName", "displayRoomCode", "team.memberCount", "teamStats.totalGrowthMinutes"]) {
  assert(homeWxml.includes(`{{${publicField}}}`), `主页缺少公共信息 ${publicField}`);
}

// 动态权限：队长可管理，成员保留只读信息与退出路径。
assert.match(homeWxml, /wx:if="{{settingsCanEditTeam}}"[^>]*hero-settings[^>]*bindtap="openTeamSettings"[\s\S]*wx:else[^>]*hero-settings[^>]*bindtap="openTeamInfo"/,
  "只有当前 live runtime 允许管理时显示设置，其他状态显示只读信息");
assert.match(homeWxml, /wx:if="{{!isOwner}}"[^>]*class="self-detail-action self-detail-action--danger"[^>]*bindtap="confirmLeaveOrDissolve"/,
  "普通成员必须可从自己的资料退出小队");
assert.match(homeTs, /if \(isOwner\) await dissolveTeam\(\); else await leaveTeam\(\);/,
  "危险操作必须按 owner/member 角色分流");
assert.match(cloud, /if \(membership\.role === "owner"\) fail\("OWNER_TRANSFER_REQUIRED"/,
  "队长不得绕过客户端直接退出小队");

for (const action of ["transferToSelectedMember", "removeSelectedMember", "dissolveCurrentTeam"]) {
  assert(membersTs.includes(`${action}()`), `成员管理缺少 ${action}`);
}
assert.match(membersWxml, /wx:if="{{canManage[^}]*}}"[\s\S]*转让队长[\s\S]*移出小队/,
  "转让与移除入口必须只对队长显示");
assert.match(membersWxml, /wx:if="{{canManage[^}]*}}"[\s\S]*解散小队/,
  "解散入口必须只对队长显示");
assert.match(homeTs, /匿名参与/,
  "本人资料必须提供匿名展示方式");

// 邀请权限：队长始终可邀请，成员由 allowMemberInvite 控制。
assert.match(types, /allowMemberInvite\??:\s*boolean/,
  "Team 类型缺少 allowMemberInvite");
assert.match(cloud, /allowMemberInvite/,
  "云端响应必须返回成员邀请策略");
assert.match(homeTs, /runtime\?\.capabilities\.canInvite/,
  "邀请可见性必须使用当前 runtime 计算后的能力");
assert.match(homeWxml, /wx:if="{{canInviteFriends[^}]*}}"[^>]*hero-invite[^>]*bindtap="inviteFriends"/,
  "邀请入口必须使用动态权限而非对所有成员常驻");

// 顶部价值层级：真实同行进度与个人行动优先，房间号仅保留轻量复制入口。
for (const field of ["teamStats.completedMembers", "teamStats.totalMembers", "teamStats.totalGrowthMinutes", "teamStats.startedMembers", "selfActionPrompt.text", "selfActionPrompt.buttonText"]) {
  assert(homeWxml.includes(`{{${field}}}`), `今日同行面板缺少真实字段 ${field}`);
}
assert.match(homeWxml, /wx:if="{{teamViewMode === 'solo'}}"[\s\S]*class="hero-primary[^>]*bindtap="goToday"/,
  "单人态必须保留回到今日行动的真实 CTA");
assert.match(homeWxml, /wx:if="{{teamViewMode === 'group'}}"[^>]*class="companion-card[\s\S]*class="self-prompt-button"[^>]*bindtap="goToday"/,
  "多人态必须只在榜单下保留一个今日行动 CTA");
assert.match(homeWxml, /wx:if="{{teamViewMode === 'group'}}"[^>]*class="activity-card/,
  "单人态不得展示没有队友价值的榜单与动态");
assert.doesNotMatch(homeTs, /function buildActivityList/,
  "首页动态不得从榜单成员状态合成");
assert.match(types, /selfMember\??:\s*TeamMember\s*\|\s*null/,
  "分页响应必须独立返回当前访问者成员投影");
assert.match(cloud, /selfMember:\s*members\.find\(\(member\) => member\.isSelf\)/,
  "云端分页必须独立返回 selfMember，避免本人不在当前页时丢失权限");
assert.doesNotMatch(homeWxml, /class="room-landscape/,
  "房间号不应继续占用独立大卡片");
assert.match(homeTs, /startedMembers[\s\S]{0,300}todayStatus === "completed"[\s\S]{0,120}todayStatus === "partial"|todayStatus === "completed"[\s\S]{0,120}todayStatus === "partial"[\s\S]{0,300}startedMembers/,
  "已开始人数必须来自真实完成或部分完成状态");

// 云端是隐私裁剪边界；排行榜和动态不得依赖客户端二次隐藏。
assert.match(cloud, /user\.useProfileInTeam\s*!==\s*false/,
  "非匿名展示必须尊重 useProfileInTeam");
assert.match(cloud, /function anonymousNameFor[\s\S]{0,300}同行者[^\n]*padStart/,
  "匿名排行榜必须输出稳定的同行者编号，而非真实昵称");
assert.match(cloud, /name:\s*canShowName\s*\?[^:]+:\s*anonymousNameFor/,
  "匿名身份名称必须由服务端统一投影");
assert.match(cloud, /avatar:\s*canShowAvatar\s*\?[^:]+:\s*""/,
  "匿名模式不得返回真实头像");
const activityHandler = cloud.slice(cloud.indexOf("async function getTeamActivityFeed"), cloud.indexOf("async function removeMemberRecord"));
assert.match(cloud, /memberMode\s*!==\s*"anonymous"/,
  "个人匿名选择必须参与服务端隐私裁决");
assert.match(activityHandler, /publicIdentity\s*\(\s*context\.team/,
  "动态流必须与排行榜共用服务端匿名投影");
assert.doesNotMatch(cloud, /return\s*\{[^}]*openid/i,
  "任何 Team 公共响应不得返回 openid");
assert.doesNotMatch(service, /console\.(log|info|debug)\([^\n]*(openid|OPENID)/i,
  "客户端日志不得输出 openid");

console.log("Team owner/member 动态权限、邀请策略与匿名隐私契约测试通过");
