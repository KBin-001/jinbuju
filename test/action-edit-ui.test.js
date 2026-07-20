const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const template = read("miniprogram/pages/action-edit/index.wxml");
const style = read("miniprogram/pages/action-edit/index.wxss");
const page = read("miniprogram/pages/action-edit/index.ts");
const config = JSON.parse(read("miniprogram/pages/action-edit/index.json"));

assert.equal(config.navigationBarTitleText, "", "系统导航不应与页面主标题重复");
assert.doesNotMatch(page, /setNavigationBarTitle/, "添加和编辑状态不应重新写入重复的系统标题");
assert.match(template, /class="form-section surface-card"/, "行动内容应使用独立轻量表单卡片");
assert.match(template, /class="form-section schedule-card surface-card"/, "日期与提醒应形成独立设置卡片");
assert.match(template, /block="\{\{true\}\}"[\s\S]*bindtap="save"/, "保存按钮必须使用 TDesign 块级按钮占满操作区");
assert.match(template, /自定义时长/);
assert.match(template, /isCustomDuration/, "自定义分钟数应有明确选中状态");
assert.match(page, /isCustomDuration: !\(ACTION_DURATION_VALUES as readonly number\[\]\)\.includes\(task\.estimatedMinutes\)/);
assert.match(template, /完成后可单独修改实际投入，不会覆盖预计时长/);
assert.match(style, /padding:\s*14rpx 32rpx calc\(18rpx \+ env\(safe-area-inset-bottom\)\)/, "底部操作区必须适配安全区");
assert.match(style, /@media \(max-width:350px\)/, "编辑表单需要覆盖小屏布局");

console.log("行动编辑页分组布局、块级保存按钮与小屏契约检查通过");
