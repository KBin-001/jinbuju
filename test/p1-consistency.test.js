const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const team = read("miniprogram/pages/team/index.ts");
const today = read("miniprogram/pages/index/index.ts");
const actionEdit = read("miniprogram/pages/action-edit/index.ts");
const durations = read("miniprogram/config/action.ts");

assert.match(team, /const cached = getCachedTeam\(\);[\s\S]*this\.applyTeamData\(cached\);/, "小队页应先展示本地缓存");
assert.match(team, /Promise\.all\(\[syncPromise, activityPromise\]\)/, "行动同步和动态预览应并行执行");
assert.match(team, /const originalTasks = snapshot\.tasks[\s\S]*originalById[\s\S]*writeManualStore\(store\)/, "一键完成失败时应恢复任务快照");

assert.match(durations, /15, 25, 30, 45, 60, 90, 120, 180, 240/, "统一时长选项应覆盖已支持值");
assert.match(today, /ACTION_DURATION_OPTIONS/, "今日页应复用统一时长选项");
assert.match(actionEdit, /ACTION_DURATION_VALUES/, "行动编辑页应复用统一时长选项");

const sourceRoots = [path.join(root, "miniprogram/pages"), path.join(root, "miniprogram/components")];
const tsFiles = [];
const collect = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.name.endsWith(".ts")) tsFiles.push(target);
  }
};
sourceRoots.forEach(collect);
for (const file of tsFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, /confirmColor:\s*["']#[0-9a-f]{6}["']/i, `${path.relative(root, file)} 不应硬编码 confirmColor`);
}

console.log("P1 team/performance/consistency regression tests passed");
