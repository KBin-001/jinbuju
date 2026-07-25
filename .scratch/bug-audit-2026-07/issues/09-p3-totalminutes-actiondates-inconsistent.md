# Bug 9 (P3)：getProgressSummary totalActualMinutes 与 actionDates 数据源不一致

## 问题描述

`manualStats.ts` 中 `totalActualMinutes` 使用 `allTasks`（含 rescheduled-partial），但 `actionDates` 使用过滤后的 `tasks`（不含）。导致累计投入可能包含某日期的投入，但该日期不计为行动天数。

## 修复方案

修复 Bug 1 后，`actionDates` 将纳入这些任务的 `activityDate`，数据源将一致。

## 验收标准

- `totalActualMinutes > 0` 的每个日期都被 `actionDates` 包含。
