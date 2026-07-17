const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("miniprogram/app.json"));
const registeredPages = [
  ...app.pages,
  ...(app.subpackages || []).flatMap((pkg) => (pkg.pages || []).map((page) => `${pkg.root}/${page}`)),
];

assert(registeredPages.includes("pages/growth-records/index"), "成长记录子页面必须注册到 app.json");
for (const extension of ["ts", "wxml", "wxss", "json"]) {
  assert(fs.existsSync(path.join(root, `miniprogram/pages/growth-records/index.${extension}`)), `成长记录页缺少 index.${extension}`);
}

const source = read("miniprogram/pages/growth-records/index.ts");
const template = read("miniprogram/pages/growth-records/index.wxml");
const config = JSON.parse(read("miniprogram/pages/growth-records/index.json"));
const profile = read("miniprogram/pages/profile/index.ts");
const progress = read("miniprogram/pages/plan/index.ts");

assert.match(source, /store\.tasks \|\| \[\]/, "成长记录必须以 tasks 作为唯一行动事实源");
assert.doesNotMatch(source, /goal\.actions \|\| \[\]/, "不得重复拼接归档快照 actions");
assert.match(source, /task\.activityDate \|\| task\.currentDate/, "成长记录必须优先使用真实行动日期");
assert.match(source, /statusBeforeReschedule === "partially_completed"/, "部分完成后顺延的真实投入必须保留");
assert.match(source, /hiddenGoalIds/);
assert.match(source, /Boolean\(goal\.deletedAt\).*goal\.restoredAt/);
assert.match(source, /!goal\?\.active \|\| rescheduled/, "归档与顺延历史记录必须只读");
assert.match(source, /updateActionRecord/);
assert.match(source, /deleteTask/);
assert.match(source, /PAGE_SIZE = 20/);
assert.match(source, /manual:sync/);
assert.match(source, /syncManualData\(\)/, "下拉刷新必须同步真实成长数据");

for (const copy of ["成长总览", "完成行动", "投入分钟", "行动天数", "连续天数", "全部目标", "全部记录", "部分完成", "历史目标"]) {
  assert(`${source}\n${template}`.includes(copy), `成长记录页面缺少“${copy}”`);
}
assert.match(template, /record\.reflection/, "成长过程应展示用户记录的真实感受");
assert.match(template, /status === 'loading'/);
assert.match(template, /status === 'error'/);
assert.match(template, /groups\.length === 0/);
assert.equal(config.usingComponents["action-record-editor"], "/components/action-record-editor/index");
assert.match(profile, /pages\/growth-records\/index\?from=profile/);
assert.match(progress, /pages\/growth-records\/index\?from=progress&goalId=/);

console.log("成长记录独立子页面、跨目标口径与导航契约检查通过");
