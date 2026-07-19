const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("miniprogram/pages/plan/index.ts");
const template = read("miniprogram/pages/plan/index.wxml");
const coachPage = read("miniprogram/pages/ai-coach/index.ts");
const coachService = read("miniprogram/services/progressCoach.ts");

assert.match(template, /还没有目标/);
assert.match(template, /先创建一个想推进的方向/);
assert.match(template, /当前目标累计/);
assert.match(template, /overviewStats/);
assert.match(template, /\{\{canSwitchGoal \? '切换目标' : '查看目标'\}\}/);
assert.match(page, /持续目标 · \$\{year\}年\$\{month\}月\$\{day\}日开始/);
assert.doesNotMatch(template, /goal\.description/, "顶部目标卡只保留目标与起始日期");
assert.doesNotMatch(template, /累计行动完成率|goal-progress|goalProgressPercent/);
assert.match(template, /class="growth-record-entry surface-card"/);
assert.match(template, /bindtap="openGrowthRecords"/);
assert.match(page, /pages\/growth-records\/index\?from=progress&goalId=/);
assert.doesNotMatch(template, /最近完成|待继续行动/, "完整成长记录流程应从进度页独立出去");
assert.match(template, /class="recent-tasks-card surface-card"/, "进度页底部应提供最近任务卡片");
assert.match(template, /最近任务/);
assert.match(template, /仅显示今日已完成，可修改实际投入/);
assert.match(template, /wx:for="\{\{recentCompletedTasks\}\}" wx:key="id"/, "今日完成任务需要使用稳定唯一 key 持续渲染");
assert.match(template, /bindtap="openRecentTask"/, "最近任务必须可以直接编辑实际投入");
assert.match(template, /<action-record-editor[\s\S]*bind:save="saveRecordEditor"/, "实际投入修改应复用半屏编辑器而非新增页面");
assert.match(page, /task\.status === "completed" && taskBusinessDate\(task\) === today/, "最近任务只允许今日已完成任务");
assert.match(page, /recentCompletedTasks: buildRecentCompletedTasks\(allTasks, today\)/);
assert.doesNotMatch(page, /buildRecentCompletedTasks\(allTasks, today\)\.slice/, "今日完成任务不得设置固定展示上限");
assert.match(page, /updateActionRecord\(\{ taskId: this\.data\.editingRecordId, \.\.\.event\.detail \}\)/, "保存后必须更新真实行动记录");
assert.match(template, /wx:if="\{\{hasTrendData\}\}" class="coach-card/);
assert.match(template, /AI 成长教练/);
assert.match(template, /\{\{coachScopeLabel\}\} · 真实行动记录/);
assert.match(template, /进入教练对话/);
assert.match(template, /trendSummary\.summaryText/);
assert.match(template, /完成行动（项）/);
assert.doesNotMatch(template, /<canvas/);
assert.doesNotMatch(template, /trendLine/);
assert.match(template, /添加今日行动/);
assert.match(template, /去今日页开始行动/);
assert(template.indexOf('class="trend-card') < template.indexOf('class="coach-card'), "行动趋势必须排在 AI 入口之前");
assert((template.match(/progress-mountain-path-v2\.jpg/g) || []).length >= 3, "进度页关键区域必须保留山水品牌层次");
assert.doesNotMatch(template, /ai-coach-shanshui-v1\.jpg/, "紧凑 AI 入口不应继续使用强背景图");

assert.doesNotMatch(page, /analyzeProgress\s*\(/, "进入进度页不得自动生成 AI 报告");
assert.doesNotMatch(page, /prepareProgressCoach\s*\(/, "进入进度页不得发起 AI 上下文网络请求");
assert.doesNotMatch(coachPage, /prepareProgressCoach\s*\(/, "打开 AI 面板不得自动发起上下文网络请求");
assert.match(coachService, /askProgressCoach[\s\S]*await verifyCoachRuntime\(\);[\s\S]*await syncManualData\(\);/, "只能在用户发送问题时同步可信数据并调用 AI");
assert.doesNotMatch(
  coachService.slice(coachService.indexOf("export async function askProgressCoach"), coachService.indexOf("export async function getCoachConversation")),
  /prepareProgressCoach\(/,
  "普通问答不应依赖旧快照或进行中目标",
);
assert.match(page, /task\.activityDate \|\| task\.currentDate/, "趋势必须使用真实行动业务日期");
assert.match(page, /task\.status === "rescheduled"[\s\S]*task\.statusBeforeReschedule === "partially_completed"[\s\S]*\(task\.actualMinutes \|\| 0\) > 0/, "顺延前真实投入必须保留");
assert.match(page, /getTaskHistoryByGoal/, "趋势必须使用包含顺延历史的分析专用查询");
assert.match(page, /on\("manual:sync"/);
assert.match(page, /off\("manual:sync"/);
assert.doesNotMatch(page, /超过了 \$\{percentile\}% 的用户/, "不得伪造用户分位比较");
assert.match(page, /const insufficient = checkinDays < 1/, "年度热力图只能在完全无记录时进入空状态");
assert.match(coachService, /!task\.deletedAt/, "AI 上下文必须排除软删除行动");
assert.match(page, /function buildWeekBuckets/);
assert.match(page, /function buildMonthBuckets/);
assert.match(page, /function trendPeriodLabel/);
assert.match(page, /pages\/today-data\/index/, "查看历史记录必须进入当前目标的每日记录闭环");
assert.doesNotMatch(page, /暂无历史复盘/, "当前目标历史入口不应错误依赖已归档目标");

console.log("进度页三态、真实统计与 AI 按需调用契约测试通过");
