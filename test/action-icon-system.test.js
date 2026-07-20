const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require(path.resolve(__dirname, "../miniprogram/node_modules/typescript"));

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const iconSource = read("miniprogram/utils/actionIcon.ts");
const compiled = ts.transpileModule(iconSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const iconModule = { exports: {} };
new Function("exports", "module", compiled)(iconModule.exports, iconModule);
const { ACTION_ICON_OPTIONS, inferActionIconKey, resolveActionIcon } = iconModule.exports;

assert.equal(ACTION_ICON_OPTIONS.length, 12, "行动图标应覆盖足够丰富的常见类别");
assert.equal(new Set(ACTION_ICON_OPTIONS.map((item) => item.key)).size, ACTION_ICON_OPTIONS.length, "图标 key 必须唯一");
for (const option of ACTION_ICON_OPTIONS) {
  const assetPath = path.join(root, "miniprogram", option.asset.replace(/^\//, ""));
  assert.ok(fs.existsSync(assetPath), `${option.label}图标资源必须真实存在`);
  assert.match(fs.readFileSync(assetPath, "utf8"), /<svg[\s\S]*viewBox="0 0 32 32"/, `${option.label}图标必须是统一画布的 SVG`);
}
assert.equal(inferActionIconKey("背英语单词"), "study");
assert.equal(inferActionIconKey("完成行测真题"), "exam");
assert.equal(inferActionIconKey("晚上跑步五公里"), "exercise");
assert.equal(inferActionIconKey("看英语电影"), "movie");
assert.equal(inferActionIconKey("修复前端 bug"), "coding");
assert.equal(resolveActionIcon("跑步", "", "reading").key, "reading", "用户手选图标必须覆盖自动映射");

const typeSource = read("miniprogram/types/manual.ts");
const service = read("miniprogram/services/manualTask.ts");
const editPage = read("miniprogram/pages/action-edit/index.ts");
const editTemplate = read("miniprogram/pages/action-edit/index.wxml");
const todayPage = read("miniprogram/pages/index/index.ts");
const todayTemplate = read("miniprogram/pages/index/index.wxml");
const cloudSync = read("cloudfunctions/generatePlan/manual-sync.js");

assert.match(typeSource, /iconKey\?: ActionIconKey/);
assert.match(typeSource, /iconManual\?: boolean/);
assert.match(service, /iconManual: Boolean\(input\.iconManual\)/);
assert.match(service, /inferActionIconKey\(input\.title, input\.description\)/, "未手选时保存应继续按标题映射");
assert.match(editTemplate, /wx:for="\{\{actionIconOptions\}\}"/);
assert.match(editTemplate, /bindtap="selectActionIcon"/);
assert.match(editTemplate, /bindtap="useAutomaticActionIcon"/);
assert.match(editTemplate, /<image src="\{\{item\.asset\}\}"/, "图标选择器必须使用本地 SVG 实体资源");
assert.doesNotMatch(editTemplate, /<t-icon name="\{\{item\.icon\}\}"/, "图标选择器不得依赖被裁剪的动态图标字体");
assert.match(editPage, /selectedIconKey: this\.data\.iconManual \? this\.data\.selectedIconKey : inferActionIconKey/);
assert.match(todayPage, /resolveActionIcon\(task\.title, task\.description, task\.iconManual \? task\.iconKey : undefined\)/);
assert.match(todayTemplate, /<image src="\{\{task\.actionIconAsset\}\}"/);
assert.doesNotMatch(todayTemplate, /task\.actionIconName/, "任务分类图标不得再依赖运行时动态图标字体");
assert.doesNotMatch(todayTemplate, /icon-book\.svg|icon-headphone\.svg|icon-doc\.svg/, "今日任务不应继续使用旧的三图标占位方案");
assert.match(cloudSync, /ACTION_ICON_KEYS/);
assert.match(cloudSync, /行动图标无效/);

console.log("行动图标多类别映射、手动覆盖、自动恢复与云同步契约检查通过");
