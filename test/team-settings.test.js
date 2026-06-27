const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("../miniprogram/node_modules/typescript");

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
};

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadTeamService() {
  const filename = path.resolve(__dirname, "../miniprogram/services/team.ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => {
    if (request === "../utils/date") {
      return {
        addDays(date, amount) {
          const result = new Date(date);
          result.setDate(result.getDate() + amount);
          return result;
        },
        formatDate,
        getTodayBusinessDate(date = new Date()) {
          return formatDate(date);
        },
      };
    }
    if (request === "./profile") return { getLocalUserProfile: () => null };
    return require(request);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    storage.clear();
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const service = loadTeamService();

test("创建小队时生成稳定且不可编辑的 6 位房间号", () => {
  const created = service.createTeam();
  const roomCode = created.team.roomCode;
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode), `房间号格式错误: ${roomCode}`);
  const updated = service.updateTeamSettings({
    name: "晨光行动小队",
    avatar: "wxfile://team-avatar.png",
    visibility: "public",
    allowAnonymous: false,
    actionDetailVisibility: "admins_only",
  });
  assert(updated.team.roomCode === roomCode, "修改设置后房间号发生变化");
});

test("创建者可持久化头像、名称、房间状态和隐私设置", () => {
  service.createTeam();
  service.updateTeamSettings({
    name: "  稳稳向前  ",
    avatar: "wxfile://team-avatar.png",
    visibility: "public",
    allowAnonymous: false,
    actionDetailVisibility: "hidden",
  });
  const team = service.getMyTeam().team;
  assert(team.name === "稳稳向前", "名称未规范化保存");
  assert(team.avatar === "wxfile://team-avatar.png", "头像未保存");
  assert(team.visibility === "public", "房间状态未保存");
  assert(team.allowAnonymous === false, "匿名参与设置未保存");
  assert(team.actionDetailVisibility === "hidden", "详情可见范围未保存");
});

test("无效小队名称会被拒绝", () => {
  service.createTeam();
  let code = "";
  try {
    service.updateTeamSettings({
      name: "A",
      visibility: "private",
      allowAnonymous: true,
      actionDetailVisibility: "all_members",
    });
  } catch (error) {
    code = error.code;
  }
  assert(code === "INVALID_TEAM_NAME", `预期 INVALID_TEAM_NAME，实际 ${code}`);
});

test("通过房间号加入的成员不能修改小队管理设置", () => {
  const joined = service.joinRoom({ roomCode: "ABC234" });
  assert(service.canManageTeam(joined.team) === false, "加入者被错误识别为创建者");
  let code = "";
  try {
    service.updateTeamSettings({
      name: "越权修改",
      visibility: "public",
      allowAnonymous: true,
      actionDetailVisibility: "all_members",
    });
  } catch (error) {
    code = error.code;
  }
  assert(code === "TEAM_PERMISSION_DENIED", `预期权限错误，实际 ${code}`);
});

test("关闭匿名参与后服务层拒绝匿名展示方式", () => {
  service.createTeam();
  service.updateTeamSettings({
    name: "稳稳向前",
    visibility: "private",
    allowAnonymous: false,
    actionDetailVisibility: "all_members",
  });
  let code = "";
  try {
    service.updateSelfDisplayMode("anonymous");
  } catch (error) {
    code = error.code;
  }
  assert(code === "ANONYMOUS_NOT_ALLOWED", `预期匿名参与限制，实际 ${code}`);
});

test("旧版缓存可自动补齐新设置字段", () => {
  const created = service.createTeam();
  const legacyTeam = { ...created.team };
  delete legacyTeam.ownerId;
  delete legacyTeam.visibility;
  delete legacyTeam.allowAnonymous;
  delete legacyTeam.actionDetailVisibility;
  storage.set("JINBUJU_LOCAL_TEAM_V1", {
    version: 1,
    currentTeam: legacyTeam,
    teamMembers: created.members,
    teamDailyStats: created.dailyStats,
    teamRoomCode: legacyTeam.roomCode,
  });
  const migrated = service.getMyTeam().team;
  assert(migrated.ownerId === "local_user", "旧缓存未补齐创建者");
  assert(migrated.visibility === "public", "旧缓存未补齐房间状态");
  assert(migrated.allowAnonymous === true, "旧缓存未补齐匿名设置");
  assert(migrated.actionDetailVisibility === "all_members", "旧缓存未补齐详情范围");
});

console.log(`\n========== 小队设置：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
