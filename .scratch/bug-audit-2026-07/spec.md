Status: ready-for-agent

# 全项目 Bug 审查：数据一致性与统计口径修复

## Problem Statement

对小程序全项目代码进行系统审查后，发现多个影响数据准确性和用户体验的 Bug。这些问题分布在统计服务、计时会话、页面数据映射和团队同步等核心模块中，导致不同页面之间的数据口径不一致、用户操作产生非预期的数据丢失、以及成就解锁条件不可靠。

`BUG_20260707.MD` 中记录的 18 个历史 Bug 均已修复，本次审查发现的是全新问题，不与历史 Bug 重复。已有的 `.scratch/` specs（content-security-resilience、timer-session-reliability、typography-system、cloud-function-syntax-guard）覆盖了各自领域，本次审查发现的问题不在这些 spec 的范围内。

## Solution

将所有发现的 Bug 按优先级 P0-P3 分类修复。核心原则是**统一数据口径**：所有页面和服务的统计逻辑必须基于同一套规则——"完成一部分后顺延"的原行动仍属于历史真实推进，其 `activityDate` 应被用于统计归属，其投入时间应被计入累计和连续天数。

## User Stories

1. 作为今日页用户，我看到"连续行动 N 天"的数字与"我的"页显示的连续天数一致，不会出现进度页显示 3 天而我的页显示 5 天的矛盾。
2. 作为今日页用户，我将一个昨天未完成的行动在今天完成后，进度页热力图在今天的位置显示完成标记，而不是在昨天的位置显示。
3. 作为今日页用户，我将一个过去日期的行动标记为"完成一部分"后顺延到明天，我的连续行动天数不会因为顺延操作而中断。
4. 作为今日页用户，我使用专注计时结束后选择"仅结束计时"，行动进入"完成一部分"状态，之前设置的完成原因（如"时间不够"）不会被清除。
5. 作为进度页用户，我看到"今日完成"和"今日总数"与今日页的行动列表一致，包含了从过去顺延到今天并已完成的行动。
6. 作为小队页用户，我查看成员今日行动详情时，实际投入时间（actualMinutes）正确显示，而非仅显示 growthMinutes 字段。
7. 作为今日数据详情页用户，我查看某天的完成率时，"今天不做"（skipped）的行动不计入完成率分母，不会拉低我的完成率。
8. 作为今日页用户，"待开始"状态的行动不显示绿色（success）标签，避免我误以为它已经完成。
9. 作为用户，我的连续行动成就（如"三天不断""一周稳住"）基于正确的连续天数计算，不会因为顺延操作而无法解锁。
10. 作为进度页用户，我看到"累计投入时间"包含所有真实投入（包括完成一部分后顺延的原行动），且这些投入对应的日期也被计入行动天数。
11. 作为开发者，`finishActionSession` 和 `completeActionSession` 两个计时结束入口对 `issueReason` 的处理保持一致，不会因入口不同而产生不同的数据状态。
12. 作为今日数据详情页用户，我查看月视图分布时，跨月的行动不会因为日期范围拼接错误而丢失或重复统计。
13. 作为进度页用户，我看到近 7 天摘要中每一天的完成数量和总数与实际行动记录一致，不会把今天完成的顺延行动错误地归到原计划日期。
14. 作为今日页用户，我看到"DAY N"标签中的行动天数与我的页显示的行动天数一致。
15. 作为小队页用户，今日行动榜中我的投入时间与今日页和进度页显示的投入时间一致。

## Implementation Decisions

### Bug 1 (P0)：`getProgressSummary` 连续天数/行动天数排除"完成一部分后顺延"的原行动

**位置：** `miniprogram/services/manualStats.ts`

`getProgressSummary` 在第 8 行过滤掉所有 `rescheduled` 状态的任务：
```
const tasks = allTasks.filter((task) => task.status !== "rescheduled" && task.status !== "skipped");
```

随后 `actionDates`（第 17-18 行）和 `streakDates`（第 20 行）都基于这个过滤后的 `tasks` 计算。但"完成一部分后顺延"的原行动状态为 `rescheduled`，`statusBeforeReschedule` 为 `partially_completed`，它包含真实的 `actualMinutes` 和 `activityDate`。

而 `profileGrowth.ts` 的 `hasRealProgress` 函数正确地将这类任务视为真实推进：
```
function hasRealProgress(task: ActionTask): boolean {
  return task.status === "completed"
    || task.status === "partially_completed"
    || (task.status === "rescheduled" && task.statusBeforeReschedule === "partially_completed");
}
```

**修复方案：** 在 `actionDates`/`streakDates` 计算中纳入 `rescheduled` 且 `statusBeforeReschedule === "partially_completed"` 的任务，使用 `task.activityDate` 作为行动归属日期。`totalActualMinutes` 已经正确纳入（通过 `allTasks`），但 `actionDates` 未纳入，需统一。

### Bug 2 (P0)：`getProgressSummary` 热力图和近 7 天摘要使用 `currentDate` 而非 `activityDate`

**位置：** `miniprogram/services/manualStats.ts`

热力图（第 46-62 行）和 `recentDays`（第 11-15 行）都通过 `task.currentDate === date` 筛选当天任务。但行动完成时 `activityDate` 被设置为实际完成日期（`getTodayBusinessDate()`），`currentDate` 仍为原计划日期。如果用户今天完成了一个昨天计划的顺延行动，热力图会在昨天的格子显示完成，而不是今天。

进度页的趋势图（`plan/index.ts`）已正确使用 `taskBusinessDate(task) = task.activityDate || task.currentDate`，但 `getProgressSummary` 未对齐。

**修复方案：** 热力图和 `recentDays` 中，对 `completed` 和 `partially_completed` 状态的任务使用 `task.activityDate || task.currentDate` 作为归属日期；对 `pending` 和 `skipped` 状态的任务仍使用 `currentDate`（因为它们还没有实际发生日期）。

### Bug 3 (P1)：`finishActionSession` 无条件清除 `issueReason`

**位置：** `miniprogram/services/actionSession.ts:134`

```
task.issueReason = undefined;
```

`finishActionSession` 在结束计时时无条件将 `issueReason` 设为 `undefined`。当用户选择"仅结束计时"（`markTaskCompleted = false`），任务进入 `partially_completed` 状态，但如果该任务之前已有 `issueReason`（例如用户之前通过菜单选择了"完成一部分 - 时间不够"），该原因会被清除。

而 `completeActionSession`（第 168-173 行）不会修改 `issueReason`，两个入口行为不一致。

**修复方案：** `finishActionSession` 在 `markTaskCompleted = false` 时保留原有 `issueReason`；仅在 `markTaskCompleted = true`（标记完成）时清除 `issueReason`，与 `updateTaskStatus` 的逻辑对齐。

### Bug 4 (P1)：`getProgressSummary` `todayCompleted`/`todayTotal` 按 `currentDate` 统计

**位置：** `miniprogram/services/manualStats.ts:9`

```
const todayTasks = tasks.filter((task) => task.currentDate === today);
```

今日页的摘要（`calculateTodaySummary`）通过 `getTodayPageTasks` 获取任务，包含了从过去顺延到今天并已完成的行动。但 `getProgressSummary` 的 `todayCompleted`/`todayTotal` 只统计 `currentDate === today` 的任务，不包含今天实际完成的顺延行动。导致进度页的"今日完成"数字可能少于今日页。

**修复方案：** `todayTasks` 改为按 `activityDate`（对已完成/部分完成）或 `currentDate`（对待开始）筛选今天的任务，与 `recordDailyCheckin` 的 `effectiveDate` 逻辑保持一致。

### Bug 5 (P1)：小队页 `buildActivitySnapshot` 未设置 `actualMinutes`

**位置：** `miniprogram/pages/team/index.ts:182-188`

```
todayActionDetails: tasks.map((task) => ({
  id: task.id,
  title: task.title,
  status: taskStatusToMemberStatus(task.status),
  estimatedMinutes: task.estimatedMinutes,
  growthMinutes: task.actualMinutes || 0,
})),
```

`TeamMemberActionDetail` 类型有 `actualMinutes?: number` 字段，但此处未设置。`BUG_20260707.MD` 的 Bug #10 声称已修复此问题，但当前代码仅设置了 `growthMinutes`，未设置 `actualMinutes`。UI 可能依赖 `actualMinutes` 显示实际投入时间，导致显示为空或不正确。

**修复方案：** 在 `buildActivitySnapshot` 的 `todayActionDetails` 中显式设置 `actualMinutes: task.actualMinutes || 0`。

### Bug 6 (P1)：`todayDetails.ts` `metricsFor` 将 `skipped` 任务计入完成率分母

**位置：** `miniprogram/services/todayDetails.ts:55-63`

`getTasksByGoal` 不过滤 `skipped` 状态的任务，`metricsFor` 使用这些任务计算 `focusRate`：
```
focusRate: dayTasks.length ? Math.round((completed / dayTasks.length) * 100) : 0,
```

`skipped`（今天不做）的任务被计入 `dayTasks.length`（分母），但永远不会计入 `completed`（分子），拉低了完成率。而 `calculateTodaySummary` 在 `manualTask.ts` 中正确地排除了 `skipped`：
```
const eligibleTasks = tasks.filter((task) => !task.deletedAt && task.status !== "rescheduled" && task.status !== "skipped");
```

**修复方案：** `metricsFor` 在计算 `total` 和 `focusRate` 时排除 `skipped` 状态的任务，与 `calculateTodaySummary` 的口径一致。

### Bug 7 (P2)："待开始"状态使用 `success` 主题色（回归）

**位置：** `miniprogram/utils/taskStatus.ts:107`

```
return { text: "待开始", tone: "success" };
```

`BUG_20260707.MD` 的 Bug #12 声称已将 "待开始" 的 tone 从 `success` 改为 `neutral`，但当前代码仍为 `success`。这可能是后续修改导致的回归。"待开始"表示未完成，使用绿色（success）可能误导用户以为该行动已完成。

**修复方案：** 将 "待开始" 的 tone 改为 `neutral`。

### Bug 8 (P2)：连续行动成就基于不正确的 `currentStreakDays`

**位置：** `miniprogram/services/manualStats.ts:74-78`

```
{ key: "streak_3", title: "三天不断", ..., unlocked: currentStreakDays >= 3, ... },
{ key: "streak_7", title: "一周稳住", ..., unlocked: currentStreakDays >= 7, ... },
```

`getProgressSummary` 中的 `badges` 使用 `currentStreakDays` 判断是否解锁，但 `currentStreakDays` 的计算存在 Bug 1 的问题（排除"完成一部分后顺延"的原行动）。同时，`achievement.ts` 的 `buildSnapshot` 使用自己独立的 `longestStreak` 计算，口径与 `getProgressSummary` 不同。虽然 `achievement.ts` 的计算可能更准确（它使用 `isEffective` 函数包含了部分完成），但 `getProgressSummary` 的 `badges` 字段仍会展示错误的解锁状态。

**修复方案：** 修复 Bug 1 后，`currentStreakDays` 将正确计算，badges 的解锁条件也会随之正确。同时确认 `getProgressSummary` 的 `badges` 与 `achievement.ts` 的 `ACHIEVEMENT_DEFINITIONS` 口径一致。

### Bug 9 (P3)：`getProgressSummary` `totalActualMinutes` 与 `actionDates` 数据源不一致

**位置：** `miniprogram/services/manualStats.ts`

`totalActualMinutes`（第 22-27 行）使用 `allTasks`，包含了 `rescheduled` 且 `statusBeforeReschedule === "partially_completed"` 的任务投入。但 `actionDates`（第 17-18 行）使用过滤后的 `tasks`，不包含这些任务。这导致"累计投入时间"可能包含某个日期的投入，但该日期不被计为"行动天数"。

**修复方案：** 修复 Bug 1 后，`actionDates` 将纳入这些任务的 `activityDate`，数据源将一致。

### Bug 10 (P3)：`completeActionSession` 与 `finishActionSession` 的 `issueReason` 处理不一致

**位置：** `miniprogram/services/actionSession.ts`

- `finishActionSession`（第 134 行）：无条件清除 `issueReason = undefined`
- `completeActionSession`（第 168-173 行）：不修改 `issueReason`

两个计时结束入口对同一字段的处理不一致。修复 Bug 3 后，`finishActionSession` 的行为会与 `completeActionSession` 对齐（仅标记完成时清除）。

**修复方案：** 修复 Bug 3 后自然解决。同时在 `completeActionSession` 中，当 `partial = true` 时保留原有 `issueReason`，当 `partial = false`（标记完成）时清除 `issueReason`。

### Bug 11 (P3)：`todayDetails.ts` 月视图分布图跨月边界风险

**位置：** `miniprogram/services/todayDetails.ts:103-107`

月视图的日期范围分组在 `dateRange` 函数中生成（第 78-83 行），所有范围都在同一月内。但 `buildBars` 的月视图筛选使用字符串比较：
```
tasks.filter((task) => task.currentDate >= startDate && task.currentDate <= endDate)
```

`startDate` 是范围起始日（如 "2026-01-26"），`endDate` 通过 `startDate.slice(0, 7)` 取月份再拼接日期构造。由于所有范围都在同一月内，当前逻辑不会出错。但如果未来 `dateRange` 支持跨月范围，字符串比较可能产生错误结果。

**修复方案：** 不需要立即修改，但在 `dateRange` 函数和 `buildBars` 月视图分支添加注释说明"当前设计仅支持单月内范围"，防止未来扩展时引入错误。或者在 `buildBars` 月视图中改用 `isValidBusinessDate` + `differenceInBusinessDays` 做范围判断，彻底消除字符串比较的脆弱性。

## Testing Decisions

### 什么是一个好的测试

好的测试只验证外部行为，不验证实现细节。对于本次 Bug 修复，外部行为是：
- 给定包含"完成一部分后顺延"的任务数据，`getProgressSummary` 返回的 `currentStreakDays`、`totalActionDays`、`actionDates` 包含该任务的 `activityDate`。
- 给定一个 `currentDate` 在过去但 `activityDate` 在今天的已完成任务，`getProgressSummary` 的热力图和 `recentDays` 在今天的位置显示该任务的完成数据。
- `finishActionSession` 在 `markTaskCompleted = false` 时保留原有 `issueReason`。
- `buildActivitySnapshot` 返回的 `todayActionDetails` 每项都包含 `actualMinutes` 字段。
- `metricsFor` 排除 `skipped` 任务后的 `focusRate` 与 `calculateTodaySummary` 的 `completionPercent` 一致。

### 测试接缝

#### Seam 1（主，行为）— 服务层

扩展现有的服务层行为测试。项目已有 `tests/` 目录下的纯 `node` + `node:assert` 测试文件，通过 TypeScript 转译 shim + 最小 `wx` 存储 mock，真实 `require()` 服务模块并断言返回值与状态。

新增断言覆盖：
- `getProgressSummary`：包含"完成一部分后顺延"任务时，`currentStreakDays` 和 `totalActionDays` 正确计入该任务的 `activityDate`。
- `getProgressSummary`：热力图和 `recentDays` 中，已完成顺延任务的完成数据出现在 `activityDate` 对应的日期，而非 `currentDate`。
- `getProgressSummary`：`todayCompleted`/`todayTotal` 包含今天实际完成的顺延行动。
- `finishActionSession`：`markTaskCompleted = false` 时保留原有 `issueReason`；`markTaskCompleted = true` 时清除。
- `buildActivitySnapshot`（team 页函数）：返回的 `todayActionDetails` 每项包含 `actualMinutes` 字段且值正确。
- `metricsFor`（todayDetails）：`skipped` 任务不计入 `total` 和 `focusRate` 分母。

#### Seam 2（护栏，契约）— 页面接线

扩展现有的页面契约测试，断言关键绑定串存在：
- `taskStatus.ts` 中 "待开始" 的 tone 为 `neutral` 而非 `success`。
- `team/index.ts` 的 `buildActivitySnapshot` 中 `todayActionDetails` 包含 `actualMinutes` 字段。

### 既有先验

项目已有多个测试文件（如 `tests/manual-task-behavior.test.js`、`tests/action-session-behavior.test.js`、`tests/today-page-timer-contract.test.js`），均采用 `node:assert/strict` + `fs.readFileSync` + mock 模式。本次测试完全复用该模式，无需引入新测试框架。

## Out of Scope

- 不重构 `getProgressSummary` 的整体结构，仅修复数据口径问题。
- 不修改 `achievement.ts` 的成就定义和计算逻辑（Bug 8 随 Bug 1 修复后自然解决）。
- 不修改 `profileGrowth.ts`（它的计算已经是正确的，作为修复的对齐基准）。
- 不修改云函数代码（所有 Bug 均在前端服务层和页面）。
- 不修改 UI 布局、样式或交互流程。
- 不修改数据同步逻辑（`manualSync.ts` 的 merge 逻辑正确）。
- 不修改 `todayDetails.ts` 月视图的 `dateRange` 函数结构（Bug 11 仅添加注释或改用更安全的比较方式）。
- 不修改 `manualStore.ts` 的存储和持久化逻辑。
- 不修改计时会话的状态机（running/paused/completed/abandoned 转换逻辑保持不变）。

## Further Notes

- 本次审查覆盖了 `services/`、`pages/`、`utils/`、`types/` 下的所有核心文件，以及 `BUG_20260707.MD` 中记录的历史修复，确认不重复。
- 已有的 `.scratch/` specs 不覆盖本次发现的问题：`content-security-resilience` 关注 msgSecCheck 韧性；`timer-session-reliability` 关注悬浮计时条可见性；`typography-system` 关注字体；`cloud-function-syntax-guard` 关注部署语法检查。
- Bug 1 和 Bug 2 是最高优先级，因为它们影响用户可见的核心数据（连续天数、热力图、今日完成数），且在用户使用"顺延"功能后立即触发。
- Bug 3 在用户交替使用"菜单完成一部分"和"专注计时"时触发，属于较常见的操作路径。
- Bug 7 是 `BUG_20260707.MD` 中 Bug #12 的回归，可能是后续修改 `taskStatus.ts` 时覆盖了修复。
- 修复 Bug 1 后，建议对比 `getProgressSummary` 与 `profileGrowth.ts` 的 `buildProfileGrowthSummary` 的输出，确认两者在同一数据集下返回相同的 `currentStreakDays` 和 `totalActionDays`。
- 修复 Bug 2 时，需注意热力图的语义：热力图展示的是"每天的完成情况"，不是"每天计划的任务完成率"。修改后，已完成行动的完成数据应出现在 `activityDate` 对应的格子，而待开始行动的计划数据仍出现在 `currentDate` 对应的格子。
- 修复 Bug 6 时，需确认 `today-data` 页面的 UI 是否依赖 `skipped` 任务出现在列表中。如果 UI 单独展示"今天不做"的任务，可以在 `metricsFor` 中排除 `skipped` 的同时保留 UI 列表中的展示。
