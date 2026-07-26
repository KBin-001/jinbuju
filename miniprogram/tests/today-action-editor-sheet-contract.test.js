const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const logic = fs.readFileSync(path.join(root, "pages/index/index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
const style = fs.readFileSync(path.join(root, "pages/index/index.wxss"), "utf8");

assert.match(template, /quickAddMode === 'edit' \? '编辑行动' : '添加行动'/, "新增和编辑应复用同一个半屏标题");
assert.match(template, /role="dialog"/, "行动编辑半屏应提供对话框语义");
assert.match(template, /bindscroll="onQuickDurationScroll"/, "预计投入应通过横向滑动时间尺调整");
assert.match(template, /左右滑动调整时间/, "时间尺应提供明确的左右滑动提示");
assert.match(template, /quickDurationMarks/, "时间尺应渲染连续主次刻度");
assert.match(template, /直接完成[\s\S]*专注计时[\s\S]*每次询问/, "执行方式应保留现有三种业务模式");
assert.match(template, /正常推进[\s\S]*必须完成/, "重要程度应保留两种状态");
assert.match(template, /行动日期[\s\S]*提醒我[\s\S]*阻塞其他任务/, "安排区应保留日期、提醒和依赖设置");
assert.match(template, /quickAddMode === 'edit'[\s\S]*删除行动/, "编辑态应提供删除入口");
assert.match(template, /quickAddMode === 'edit' \? '保存修改' : '添加到今天'/, "底部主按钮应区分新增与编辑");

assert.match(logic, /openQuickAddEditor\(task\?: ViewTask\)/, "今日页应提供统一行动编辑器入口");
assert.match(logic, /const task = isEdit \? updateTask\(input\) : createTask\(input\)/, "保存逻辑应按模式新增或更新");
assert.match(logic, /deleteQuickAddTask\(\)/, "统一编辑器应保留删除逻辑");
assert.doesNotMatch(logic, /wx\.navigateTo\(\{ url: `\/pages\/action-edit\/index\?id=\$\{task\.id\}` \}\)/, "今日页编辑不应再跳转旧全屏页面");

assert.match(style, /\.quick-add-panel\s*\{[^}]*height:\s*78vh/s, "编辑器应保持半屏悬浮结构");
assert.match(style, /\.quick-time-ruler\s*\{[^}]*white-space:\s*nowrap/s, "时间尺应为横向连续布局");
assert.match(style, /env\(safe-area-inset-bottom\)/, "底部操作区应适配安全区");
assert.match(style, /quick-sheet-panel-in/, "半屏应保留上移动画");

console.log("today action editor sheet contract tests passed");
