const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const logic = fs.readFileSync(path.join(root, "pages/index/index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
const style = fs.readFileSync(path.join(root, "pages/index/index.wxss"), "utf8");

assert.match(template, /bindtap="openCustomDuration"/, "大号分钟数区域应可点击进入输入态");
assert.match(template, /type="number"[\s\S]*bindinput="inputCustomDuration"/, "输入态应使用原生数字键盘");
assert.match(template, /bindconfirm="confirmCustomDuration"/, "键盘完成操作应确认自定义时长");
assert.match(template, /bindblur="confirmCustomDuration"/, "失焦时应安全提交或回退输入");
assert.match(template, /5–360 分钟/, "默认态应以简洁文案展示合法范围");
assert.match(template, /name="edit"/, "默认态应提供克制的编辑图标作为输入暗示");
assert.match(template, /aria-label="左右滑动调整时间/, "时间尺应保留无障碍滑动提示");

assert.match(logic, /openCustomDuration\(\)/, "今日页应提供自定义时长入口");
assert.match(logic, /replace\(\/\\D\/g, ""\)\.slice\(0, 3\)/, "输入值应只保留三位以内数字");
assert.match(logic, /minutes < QUICK_DURATION_MINUTES \|\| minutes > QUICK_DURATION_MAX_MINUTES/, "自定义时长应复用统一范围");
assert.match(logic, /quickAddHourText: durationHourCopy\(minutes\)/, "确认后应同步更新小时换算");
assert.match(logic, /quickDurationScrollLeft: snap\.scrollLeft/, "确认后应同步定位时间尺");
assert.match(style, /\.quick-time-input\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s, "数字输入应保持稳定的等宽数字排版");
assert.match(style, /\.quick-time-editor\s*\{[^}]*background:\s*#f4f3ef/s, "时间输入应使用唯一的浅色表面建立焦点");
assert.match(style, /\.quick-settings-group\s*\{[^}]*border:\s*0/s, "下方选项应使用留白与分隔线而非卡片边框");

console.log("quick duration input tests passed");
