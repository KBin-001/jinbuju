const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sources = {
  aiCoach: read("miniprogram/pages/ai-coach/index.ts"),
  dailyCoach: read("miniprogram/pages/daily-coach/index.ts"),
  actionRecords: read("miniprogram/pages/action-records/index.ts"),
  todayData: read("miniprogram/pages/today-data/index.ts"),
  goalDetail: read("miniprogram/pages/goal-detail/index.ts"),
  progress: read("miniprogram/pages/plan/index.ts"),
  today: read("miniprogram/pages/index/index.ts"),
  navigation: read("miniprogram/utils/todayActionEditor.ts"),
};

const routeSources = Object.values(sources).join("\n");
const appConfig = JSON.parse(read("miniprogram/app.json"));

assert.equal(
  fs.existsSync(path.join(root, "miniprogram/pages/action-edit")),
  false,
  "旧全屏行动编辑页不应继续存在",
);
assert.doesNotMatch(JSON.stringify(appConfig), /pages\/action-edit/, "应用配置不应注册旧行动编辑页");
assert.doesNotMatch(routeSources, /pages\/action-edit/, "运行时入口不应硬编码旧行动编辑页路径");

assert.match(sources.aiCoach, /openReviewItem[\s\S]*openTodayActionEditor\(\{ mode: "edit", taskId \}\)/, "AI 教练行动查看应进入统一编辑半屏");
assert.match(sources.dailyCoach, /openTask[\s\S]*openTodayActionEditor\(\{ mode: "edit", taskId \}\)/, "每日教练行动查看应进入统一编辑半屏");
assert.match(sources.dailyCoach, /addTodayAction[\s\S]*openTodayActionEditor\(\{ mode: "create", goalId: this\.data\.analysis\.goalId, date:/, "每日教练新增应保留目标和日期");
assert.match(sources.actionRecords, /openRecord[\s\S]*openTodayActionEditor\(\{ mode: "edit", taskId: task\.id \}\)/, "行动记录中的未完成行动应进入统一编辑半屏");
assert.match(sources.actionRecords, /addAction[\s\S]*openTodayActionEditor\(\{ mode: "create", goalId, date:/, "行动记录新增应保留目标和日期");
assert.match(sources.todayData, /goAddAction[\s\S]*openTodayActionEditor\(\{ mode: "create", goalId: this\.data\.goalId, date: this\.data\.date \}\)/, "今日数据新增应保留当前查看日期");
assert.match(sources.goalDetail, /addAction[\s\S]*openTodayActionEditor\(\{ mode: "create", goalId: goal\.id, date:/, "目标详情新增应保留目标关联");

assert.match(sources.actionRecords, /if \(task\.status === "completed" \|\| task\.status === "partially_completed"\)[\s\S]*recordEditorVisible: true/, "完成或部分完成记录应保留专用记录编辑器");
assert.match(sources.actionRecords, /if \(task\.status === "completed" \|\| task\.status === "partially_completed"\)[\s\S]*return;[\s\S]*openTodayActionEditor/, "完成记录分支不应落入行动配置编辑器");
assert.match(sources.progress, /openRecentTask[\s\S]*task\.status !== "completed"[\s\S]*recordEditorVisible: true/, "进度页最近完成记录应保留专用记录编辑器");
assert.match(sources.today, /openPendingTodayActionEditor[\s\S]*getTask\(request\.taskId\)[\s\S]*getGoal\(task\.goalId\)/, "今日页应按真实行动和目标解析编辑请求");

assert.match(sources.actionRecords, /if \(!task(?:\s*\|\| task\.deletedAt)?\) \{[\s\S]*wx\.showToast/, "行动记录失效行动应给出明确反馈");
assert.match(sources.aiCoach, /if \(!item\)[\s\S]*wx\.showToast/, "AI 教练失效行动应给出明确反馈");
assert.match(sources.todayData, /openRecordEditor[\s\S]*if \(!task(?:\s*\|\| task\.deletedAt)?\) \{[\s\S]*wx\.showToast/, "今日数据失效记录应给出明确反馈");
assert.match(sources.goalDetail, /addAction[\s\S]*if \(!goal\) \{[\s\S]*wx\.showToast/, "目标详情失效目标应给出明确反馈");

console.log("action editor migration contract tests passed");
