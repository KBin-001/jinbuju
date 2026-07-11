const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const service = read("miniprogram/services/team.ts");
const cloud = read("cloudfunctions/generatePlan/team.js");
const index = read("cloudfunctions/generatePlan/index.js");

for (const action of [
  "createTeam", "joinTeamByRoomCode", "updateTeamSettings", "reviewTeamJoinRequest",
  "removeTeamMember", "leaveTeam", "transferTeamOwner", "dissolveTeam",
]) {
  assert(service.includes(`"${action}"`) || service.includes(`${action}(`), `客户端缺少 ${action} 接口`);
  assert(cloud.includes(action), `云端缺少 ${action} 实现`);
  assert(index.includes(action), `云函数路由缺少 ${action}`);
}

assert(cloud.includes("MAX_TEAM_MEMBERS"), "云端人数限制未复用统一规则");
assert(cloud.includes("db.runTransaction"), "成员与小队关系更新未使用事务");
assert(cloud.includes("assertOwner"), "队长与普通成员权限未区分");
assert(cloud.includes('status: "pending"'), "审批加入模式缺少 pending 申请");
assert(cloud.includes('fail("OWNER_TRANSFER_REQUIRED"'), "队长退出前未要求转让或解散");

console.log("真实小队管理接口、权限与事务检查通过");
