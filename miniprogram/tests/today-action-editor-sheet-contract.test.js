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
assert.match(template, /直接完成[\s\S]*专注计时/, "执行方式应保留直接完成和专注计时");
assert.match(template, /quick-settings-group--segmented[\s\S]*直接完成[\s\S]*专注计时/, "执行方式应使用横向双列标签");
assert.match(template, /quick-settings-group--segmented[\s\S]*正常推进[\s\S]*必须完成/, "重要程度应使用横向双列标签");
assert.doesNotMatch(template, /每次询问/, "执行方式不应继续展示每次询问");
assert.match(template, /bindscrolltoupper="onQuickDurationReachStart"/, "时间尺应能准确到达 5 分钟下限");
assert.match(template, /bindscrolltolower="onQuickDurationReachEnd"/, "时间尺应能准确到达 360 分钟上限");
assert.match(template, /正常推进[\s\S]*必须完成/, "重要程度应保留两种状态");
assert.match(template, /行动日期[\s\S]*提醒我[\s\S]*阻塞其他任务/, "安排区应保留日期、提醒和依赖设置");
assert.match(template, /quickAddMode === 'edit'[\s\S]*删除行动/, "编辑态应提供删除入口");
assert.match(template, /quickAddMode === 'edit' \? '保存修改' : '添加任务'/, "底部主按钮应区分新增与编辑");

assert.match(logic, /openQuickAddEditor\(task\?: ViewTask\)/, "今日页应提供统一行动编辑器入口");
assert.match(logic, /const task = isEdit \? updateTask\(input\) : createTask\(input\)/, "保存逻辑应按模式新增或更新");
assert.match(logic, /deleteQuickAddTask\(\)/, "统一编辑器应保留删除逻辑");
assert.match(logic, /ACTION_DURATION_MAX_MINUTES/, "预计投入应复用统一的 360 分钟上限");
assert.match(logic, /QUICK_DURATION_MARK_INTERVAL_MINUTES\s*=\s*15/, "时间尺应使用稀疏可视刻度避免产生过多节点");
assert.match(logic, /QUICK_DURATION_SUBSTEP_RPX\s*=\s*QUICK_DURATION_TICK_RPX\s*\/\s*\(QUICK_DURATION_MARK_INTERVAL_MINUTES\s*\/\s*QUICK_DURATION_STEP_MINUTES\)/, "滚动换算应继续保持 5 分钟精度");
assert.match(logic, /length:\s*QUICK_DURATION_MAX_MINUTES\s*\/\s*QUICK_DURATION_MARK_INTERVAL_MINUTES\s*\+\s*1/, "360 分钟时间尺的可视节点数应受控");
assert.doesNotMatch(logic, /wx\.navigateTo\(\{ url: `\/pages\/action-edit\/index\?id=\$\{task\.id\}` \}\)/, "今日页编辑不应再跳转旧全屏页面");

assert.match(style, /\.quick-add-panel\s*\{[^}]*height:\s*78vh/s, "编辑器应保持半屏悬浮结构");
assert.match(style, /\.quick-time-ruler\s*\{[^}]*white-space:\s*nowrap/s, "时间尺应为横向连续布局");
assert.match(style, /\.quick-settings-group--segmented\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s, "双选项应使用等宽横向布局");
assert.match(style, /env\(safe-area-inset-bottom\)/, "底部操作区应适配安全区");
assert.match(style, /quick-sheet-panel-in/, "半屏应保留上移动画");

console.log("today action editor sheet contract tests passed");
