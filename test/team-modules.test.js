const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const service = read("miniprogram/services/team.ts");
const cloud = read("cloudfunctions/generatePlan/team.js");
const page = read("miniprogram/pages/team/index.ts");
const template = read("miniprogram/pages/team/index.wxml");

assert(!service.includes("createDemo") && !service.includes("mockMembers") && !service.includes("fakeMembers"), "客户端仍包含演示成员生成器");
assert(!cloud.includes("mockMembers") && !cloud.includes("fakeMembers"), "云端仍包含虚假成员数据");
assert(service.includes("wx.cloud.callFunction"), "小队服务未从真实云端读取");
assert(cloud.includes('list("manual_tasks"'), "榜单未从真实行动记录计算");
assert(cloud.includes("compareRank"), "云端榜单未使用统一稳定排名规则");
assert(cloud.includes("slice(start, start + pageSize)"), "50 人榜单缺少分页");
assert(template.includes("房间号") && template.includes("复制"), "小队首页缺少房间号复制入口");
assert(template.includes("邀请好友") && template.includes("小队设置"), "邀请与设置未保持独立入口");
assert(page.includes("getTeamActivityFeed"), "小队动态未从云端分页读取");

console.log("真实小队数据源、分页榜单和首页入口检查通过");
