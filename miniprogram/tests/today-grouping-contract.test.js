const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexLogic = fs.readFileSync(path.join(root, "pages/index/index.ts"), "utf8");
const indexWxml = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
const indexStyle = fs.readFileSync(path.join(root, "pages/index/index.wxss"), "utf8");
const manualTask = fs.readFileSync(path.join(root, "services/manualTask.ts"), "utf8");
const typesManual = fs.readFileSync(path.join(root, "types/manual.ts"), "utf8");
const taskPriority = fs.readFileSync(path.join(root, "utils/taskPriority.ts"), "utf8");
const actionListLogic = fs.readFileSync(path.join(root, "components/today-action-list/index.ts"), "utf8");

// Issue 01: ActionPresentationGroup key renamed to "focus"
assert.match(indexLogic, /key:\s*"focus"\s*\|\s*"quick"\s*\|\s*"later"/, "ActionPresentationGroup key 应包含 focus");

// Issue 01: Group titles are "今日重点""快速推进""稍后安排"
assert.match(indexLogic, /今日重点/, "分组标题应包含'今日重点'");
assert.match(indexLogic, /快速推进/, "分组标题应包含'快速推进'");
assert.match(indexLogic, /稍后安排/, "分组标题应包含'稍后安排'");
assert.match(indexLogic, /groups = groupTasksByPriority\(incompleteTasks, context\)/, "页面应只对未完成行动使用正常优先级分组结果");
assert.match(indexLogic, /groups\.length \? groups : incompleteTasks\.length \? \[\{[\s\S]*key: "later"[\s\S]*tasks: incompleteTasks\.map/, "未完成行动非空但优先级分组为空时应提供不丢任务的安全回退");
assert.match(actionListLogic, /renderGroups: groups\.length \? groups : fallbackTasks\.length/, "组件收到非空任务但空分组时仍应渲染安全分组");

// Issue 02: openTaskMenu contains priority override menu items
assert.match(indexLogic, /设为今日重点/, "openTaskMenu 应包含'设为今日重点'菜单项");
assert.match(indexLogic, /移到快速推进/, "openTaskMenu 应包含'移到快速推进'菜单项");
assert.match(indexLogic, /稍后安排/, "openTaskMenu 应包含'稍后安排'菜单项");
assert.match(indexLogic, /清除分组覆盖/, "openTaskMenu 应包含'清除分组覆盖'菜单项");

// Issue 02: setTaskPriorityOverride method exists
assert.match(indexLogic, /setTaskPriorityOverride\s*\(/, "应存在 setTaskPriorityOverride 方法");
assert.match(indexLogic, /今日重点最多 2 项，请先移出再设置/, "设为今日重点时应检查容量并提示");

// Issue 02: updateTaskPriorityOverride exported from manualTask
assert.match(manualTask, /export function updateTaskPriorityOverride/, "services/manualTask.ts 应导出 updateTaskPriorityOverride 函数");

// Issue 03: ActionTask type contains current priority fields
assert.match(typesManual, /importance\?:\s*"required"\s*\|\s*"normal"/, "ActionTask 应包含 importance 字段");
assert.doesNotMatch(typesManual, /blocksOthers/, "ActionTask 不应继续暴露已移除的 blocksOthers 字段");
assert.match(typesManual, /priorityOverride\?:\s*"focus"\s*\|\s*"quick"\s*\|\s*"later"\s*\|\s*null/, "ActionTask 应包含 priorityOverride 字段");

// Issue 03: Quick-add panel has importance selector data binding
assert.match(indexWxml, /quickAddImportance/, "快速添加面板 WXML 应包含 quickAddImportance 数据绑定");
assert.match(indexWxml, /selectQuickAddImportance/, "快速添加面板 WXML 应包含 selectQuickAddImportance 事件");
assert.doesNotMatch(indexWxml, /quickAddBlocksOthers|阻塞其他任务/, "快速添加面板不应保留阻塞其他任务设置");

// Issue 03: saveQuickAdd passes importance without removed dependency field
assert.match(indexLogic, /importance:\s*this\.data\.quickAddImportance/, "saveQuickAdd 应传入 importance");
assert.doesNotMatch(indexLogic, /quickAddBlocksOthers|toggleQuickAddBlocksOthers/, "今日页逻辑不应保留 blocksOthers 状态与事件");

assert.doesNotMatch(manualTask, /blocksOthers/, "行动服务不应读写 blocksOthers");
assert.doesNotMatch(taskPriority, /blocks_others|阻塞其他任务|blocksOthers/, "优先级评分不应继续使用依赖阻塞维度");

// Issue 01: utils/taskPriority.ts exports groupTasksByPriority
assert.match(taskPriority, /export function groupTasksByPriority/, "utils/taskPriority.ts 应导出 groupTasksByPriority 函数");

// Issue 01: groupTasksByPriority returns focus/quick/later groups
assert.match(taskPriority, /focus.*今日重点.*推进核心目标/s, "groupTasksByPriority 应定义 focus 分组");
assert.match(taskPriority, /quick.*快速推进.*适合现在开始/s, "groupTasksByPriority 应定义 quick 分组");
assert.match(taskPriority, /later.*稍后安排.*已为你安排到专注时段/s, "groupTasksByPriority 应定义 later 分组");

// Issue 02: priorityOverride reason is "手动置顶"
assert.match(taskPriority, /手动置顶/, "priorityOverride 任务理由应为'手动置顶'");

// Issue 04: today-action-list WXML contains priorityReasons data binding
const actionListWxml = fs.readFileSync(path.join(root, "components/today-action-list/index.wxml"), "utf8");
assert.match(actionListWxml, /wx:for="\{\{renderGroups\}\}"/, "today-action-list 应渲染经过兜底的分组数据");
assert.match(actionListWxml, /priorityReasons/, "today-action-list WXML 应包含 priorityReasons 数据绑定");
assert.match(actionListWxml, /reason-tag/, "today-action-list WXML 应包含 reason-tag 样式类");

// Issue 04: 用户已移除手动排序入口，页面不得残留 UI 与切换逻辑
assert.doesNotMatch(indexWxml, /habit-recommend|openSortOptions|>排序</, "今日页不应继续展示排序入口");
assert.doesNotMatch(indexLogic, /taskSortMode|openSortOptions\s*\(|openRecommendInfo\s*\(/, "今日页不应残留手动排序状态与弹层逻辑");

// Issue 05: 顶部全宽视觉层必须受视口约束，防止页面被横向拖动
assert.match(indexStyle, /page\s*\{[^}]*overflow-x:\s*hidden/s, "今日页应禁止横向溢出");
assert.match(indexStyle, /\.today-page\s*\{[^}]*width:\s*100%[^}]*overflow-x:\s*hidden[^}]*box-sizing:\s*border-box/s, "今日页容器应锁定在视口宽度内");
assert.match(indexStyle, /\.today-atmosphere\s*\{[^}]*left:\s*0[^}]*width:\s*100%/s, "顶部背景不得再使用负偏移扩展宽度");
assert.match(indexWxml, /today-hero-calendar-v4\.jpg/, "今日页应使用延伸至日历区域的山水背景资产");
assert.match(indexWxml, /today-brand-lockup-v3\.png/, "今日页应使用选定设计稿的品牌标识资产");
assert.match(indexWxml, /class="today-coach"/, "AI 成长教练应具有独立可见层级类名");
assert.match(indexStyle, /\.today-coach[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/, "AI 成长教练必须位于顶部背景之上");
assert.match(indexLogic, /partitionTodayTasksByCompletion/, "今日页展示分组必须先把完成行动从执行分组中分离");
assert.match(indexLogic, /key:\s*"completed"[\s\S]*title:\s*"已完成"/, "完成行动必须进入列表末尾的独立已完成分组");

// Issue 04: reason label max 2 (trimReasons function exists)
assert.match(taskPriority, /trimReasons/, "taskPriority.ts 应包含 trimReasons 函数限制理由数量");
assert.match(taskPriority, /MAX_DISPLAY_REASONS/, "taskPriority.ts 应定义 MAX_DISPLAY_REASONS 常量");

console.log("today grouping contract tests passed");
