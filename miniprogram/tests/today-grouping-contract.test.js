const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexLogic = fs.readFileSync(path.join(root, "pages/index/index.ts"), "utf8");
const indexWxml = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
const editLogic = fs.readFileSync(path.join(root, "pages/action-edit/index.ts"), "utf8");
const editWxml = fs.readFileSync(path.join(root, "pages/action-edit/index.wxml"), "utf8");
const manualTask = fs.readFileSync(path.join(root, "services/manualTask.ts"), "utf8");
const typesManual = fs.readFileSync(path.join(root, "types/manual.ts"), "utf8");
const taskPriority = fs.readFileSync(path.join(root, "utils/taskPriority.ts"), "utf8");

// Issue 01: ActionPresentationGroup key renamed to "focus"
assert.match(indexLogic, /key:\s*"focus"\s*\|\s*"quick"\s*\|\s*"later"/, "ActionPresentationGroup key 应包含 focus");

// Issue 01: Group titles are "今日重点""快速推进""稍后安排"
assert.match(indexLogic, /今日重点/, "分组标题应包含'今日重点'");
assert.match(indexLogic, /快速推进/, "分组标题应包含'快速推进'");
assert.match(indexLogic, /稍后安排/, "分组标题应包含'稍后安排'");

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

// Issue 03: ActionTask type contains new fields
assert.match(typesManual, /importance\?:\s*"required"\s*\|\s*"normal"/, "ActionTask 应包含 importance 字段");
assert.match(typesManual, /blocksOthers\?:\s*boolean/, "ActionTask 应包含 blocksOthers 字段");
assert.match(typesManual, /priorityOverride\?:\s*"focus"\s*\|\s*"quick"\s*\|\s*"later"\s*\|\s*null/, "ActionTask 应包含 priorityOverride 字段");

// Issue 03: Quick-add panel has importance selector data binding
assert.match(indexWxml, /quickAddImportance/, "快速添加面板 WXML 应包含 quickAddImportance 数据绑定");
assert.match(indexWxml, /selectQuickAddImportance/, "快速添加面板 WXML 应包含 selectQuickAddImportance 事件");
assert.match(indexWxml, /quickAddBlocksOthers/, "快速添加面板 WXML 应包含 quickAddBlocksOthers 数据绑定");
assert.match(indexWxml, /toggleQuickAddBlocksOthers/, "快速添加面板 WXML 应包含 toggleQuickAddBlocksOthers 事件");

// Issue 03: Action-edit page has importance selector
assert.match(editWxml, /importance/, "行动编辑页 WXML 应包含 importance 数据绑定");
assert.match(editWxml, /selectImportance/, "行动编辑页 WXML 应包含 selectImportance 事件");
assert.match(editWxml, /blocksOthers/, "行动编辑页 WXML 应包含 blocksOthers 数据绑定");
assert.match(editWxml, /toggleBlocksOthers/, "行动编辑页 WXML 应包含 toggleBlocksOthers 事件");

// Issue 03: saveQuickAdd passes importance and blocksOthers to createTask
assert.match(indexLogic, /importance:\s*this\.data\.quickAddImportance/, "saveQuickAdd 应传入 importance");
assert.match(indexLogic, /blocksOthers:\s*this\.data\.quickAddBlocksOthers/, "saveQuickAdd 应传入 blocksOthers");

// Issue 03: action-edit save passes importance and blocksOthers
assert.match(editLogic, /importance:\s*this\.data\.importance/, "action-edit save 应传入 importance");
assert.match(editLogic, /blocksOthers:\s*this\.data\.blocksOthers/, "action-edit save 应传入 blocksOthers");

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
assert.match(actionListWxml, /priorityReasons/, "today-action-list WXML 应包含 priorityReasons 数据绑定");
assert.match(actionListWxml, /reason-tag/, "today-action-list WXML 应包含 reason-tag 样式类");

// Issue 04: habit-recommend element is clickable (catchtap)
assert.match(indexWxml, /habit-recommend[^>]*catchtap/, "按习惯推荐元素应包含 catchtap 绑定");

// Issue 04: openRecommendInfo method exists in page logic
assert.match(indexLogic, /openRecommendInfo\s*\(/, "页面应包含 openRecommendInfo 方法");
assert.match(indexLogic, /根据截止时间、预计时长和你的行动习惯自动排序/, "openRecommendInfo 应包含推荐说明文案");
assert.match(indexLogic, /知道了/, "openRecommendInfo 确认按钮文案应为'知道了'");

// Issue 04: reason label max 2 (trimReasons function exists)
assert.match(taskPriority, /trimReasons/, "taskPriority.ts 应包含 trimReasons 函数限制理由数量");
assert.match(taskPriority, /MAX_DISPLAY_REASONS/, "taskPriority.ts 应定义 MAX_DISPLAY_REASONS 常量");

console.log("today grouping contract tests passed");
