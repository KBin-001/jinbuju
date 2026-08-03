const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const progressPage = read("miniprogram/pages/plan/index.ts");
const todayPage = read("miniprogram/pages/index/index.ts");
const todayTemplate = read("miniprogram/pages/index/index.wxml");
const navigation = read("miniprogram/utils/todayActionEditor.ts");

assert.match(
  progressPage,
  /arrangeCoachAction\(\)[\s\S]*const goalId = this\.data\.goal\?\.id[\s\S]*const tomorrow = formatDate\(addDays\(toDate\(getTodayBusinessDate\(\)\), 1\)\)[\s\S]*openTodayActionEditor\(\{ mode: "create", goalId, date: tomorrow \}\)/,
  "进度教练的安排任务应带着当前目标和明日业务日期进入今日页",
);
assert.match(todayPage, /onShow\(\)[\s\S]*this\.load\(\);[\s\S]*this\.openPendingTodayActionEditor\(\);/, "今日页显示时应消费跨 Tab 请求");
assert.match(todayPage, /openPendingTodayActionEditor\(\)[\s\S]*const request = consumeTodayActionEditor\(\)/, "今日页应从统一交接契约读取请求");
assert.match(todayPage, /const openEditor = \(\) => this\.openQuickAddEditor\(task, \{ goalId: targetGoal\.id, date: initialDate \}\)[\s\S]*setCurrentGoal\(targetGoal\.id\)[\s\S]*this\.load\(openEditor\)/, "编辑请求切换目标后应等待今日页刷新再打开半屏");
assert.match(todayPage, /const goal = this\.data\.quickAddGoalId \? getGoal\(this\.data\.quickAddGoalId\) : this\.data\.goal/, "保存时应继续使用请求指定的目标，不能被旧页面状态覆盖");
assert.match(todayTemplate, /quickAddMode === 'edit' \? '编辑行动' : '添加行动'/, "今日页应打开统一新增/编辑半屏");
assert.match(todayTemplate, /picker[^>]*value="\{\{quickAddDate\}\}"[^>]*start="\{\{quickAddDateStart\}\}"[^>]*end="\{\{quickAddDateEnd\}\}"/, "教练建议日期应通过现有日期控件带入并允许调整");
assert.match(navigation, /isValidBusinessDate/, "跨页请求应校验真实业务日期而不只校验字符串格式");
assert.match(navigation, /finally\s*\{[\s\S]*removeStorageSync\(STORAGE_KEY\)/, "请求无论有效与否都应在消费后清除");

console.log("progress coach action entry contract tests passed");
