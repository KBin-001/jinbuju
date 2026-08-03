const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const page = read("miniprogram/pages/action-session/index.wxml");
const style = read("miniprogram/pages/action-session/index.wxss");
const todayListLogic = read("miniprogram/components/today-action-list/index.ts");

assert.match(page, /class="task-heading"/, "行动标题与品牌印记应组成独立标题行");
assert.match(page, /today-action-seal-v1\.png/, "行动标题旁应展示真实品牌印记资源");
assert.match(page, /bindtap="pause"/, "暂停计时交互必须保留");
assert.match(page, /bindtap="resume"/, "继续计时交互必须保留");
assert.match(page, /bindtap="prepareComplete"/, "提前完成交互必须保留");
assert.match(page, /bindtap="abandon"/, "放弃行动交互必须保留");
assert.match(style, /--td-progress-circle-width:\s*446rpx/, "计时圆环应匹配选定稿的主体比例");
assert.match(style, /\.timer-value\s*\{[\s\S]*font-size:\s*var\(--font-timer\)/, "计时数字应使用受控计时字号令牌");
assert.match(style, /margin-bottom:\s*64rpx/, "底部操作区应上提并为安全区保留舒展留白");
assert.match(style, /background:\s*#35685b/i, "完成按钮应使用低饱和墨绿色");
assert.match(todayListLogic, /isActiveRunning\s*\?\s*"专注中"/, "正在计时的任务必须显示专注中而不是继续");
assert.match(todayListLogic, /本次 \$\{activeDisplay\}/, "正在计时的任务应展示秒级投入时间");
assert.equal(exists("miniprogram/pages/action-session/assets/mountains-v1.jpg"), true, "缺少行动分包山水背景资源");
assert.equal(exists("miniprogram/assets/action-session-mountains-v1.png"), false, "行动分包专用大图不得继续占用主包");
assert.equal(exists("miniprogram/pages/action-session/assets/mountains-v1.png"), false, "行动分包不得保留超过 200KB 的旧 PNG");
assert.ok(fs.statSync(path.join(root, "miniprogram/pages/action-session/assets/mountains-v1.jpg")).size <= 200 * 1024, "行动页图片必须小于 200KB");
assert.match(page, /\/pages\/action-session\/assets\/mountains-v1\.jpg/, "行动页必须从自身分包加载山水背景");
assert.equal(exists("miniprogram/assets/today-action-seal-v1.png"), true, "缺少行动页品牌印记资源");

console.log("action session visual fidelity contract tests passed");
