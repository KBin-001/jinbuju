const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const wxml = read("miniprogram/pages/team/index.wxml");
const wxss = read("miniprogram/pages/team/index.wxss");
const ts = read("miniprogram/pages/team/index.ts");

assert.match(wxml, /progress-goal-mountains-v1\.jpg/, "小队 Hero 必须复用进度页山水素材");
assert.match(wxml, /canvas-id="teamJourneyCanvas"/, "小队 Hero 必须保留真实进度驱动的山势路径");
assert.match(ts, /createCanvasContext\("teamJourneyCanvas"/, "山势路径必须使用小程序 Canvas 绘制");
assert.match(ts, /this\.data\.teamStats\.todayCompletionRate\s*\/\s*100/, "山势路径必须由真实完成率绘制");
assert.match(wxml, /teamJourneyPoint\.left/, "当前节点必须绑定真实完成率计算的位置");

for (const binding of [
  "displayTeamName",
  "displayRoomCode",
  "team.memberCount",
  "team.maxMembers",
  "teamStats.completedMembers",
  "teamStats.totalMembers",
  "teamStats.startedMembers",
  "teamStats.totalGrowthMinutes",
  "teamDays",
]) {
  assert(wxml.includes(`{{${binding}}}`), `小队视觉稿缺少真实数据绑定 ${binding}`);
}

assert.match(wxml, /class="hero-invite"[^>]*bindtap="inviteFriends"/, "邀请好友必须是独立真实入口");
assert.match(wxml, /class="hero-settings"[^>]*bindtap="openTeamSettings"/, "小队设置必须是独立真实入口");
assert.match(wxml, /class="hero-room"[^>]*bindtap="copyRoomCode"/, "房间号必须支持真实复制");
assert.match(wxml, /class="companion-card"/, "多人态必须保留纵向行动榜");
assert.match(wxml, /class="activity-card"/, "多人态必须保留高价值动态预览");
assert.doesNotMatch(wxml, /class="companion-card paper-card"|class="activity-card paper-card"/, "榜单与动态不得恢复独立卡片感");

assert.match(wxss, /\.team-hero\.paper-card[\s\S]{0,260}border:\s*0;[\s\S]{0,120}background:\s*transparent;/, "顶部必须呈现连续宣纸画布");
assert.match(wxss, /\.team-hero\.paper-card\s*\{[\s\S]{0,140}min-height:\s*650rpx;/, "小队主视觉不得用过高容器把今日行动榜推离首屏");
assert.match(wxss, /\.companion-card,[\s\S]{0,180}padding:\s*20rpx 8rpx 0;/, "今日行动榜应紧接小队真实统计，减少无效留白");
assert.match(wxss, /@media \(max-width: 350px\)/, "小屏设备必须具备专项布局约束");

console.log("小队第三稿连续画布、山势进度与真实事件链契约测试通过");
