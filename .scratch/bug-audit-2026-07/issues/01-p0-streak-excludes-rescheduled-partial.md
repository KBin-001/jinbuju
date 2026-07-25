# Bug 1 (P0)：getProgressSummary 连续天数排除"完成一部分后顺延"的原行动

## 问题描述

`getProgressSummary`（`manualStats.ts`）在第 8 行过滤掉所有 `rescheduled` 状态的任务后计算 `actionDates` 和 `streakDates`。但"完成一部分后顺延"的原行动（`status: "rescheduled"`, `statusBeforeReschedule: "partially_completed"`）包含真实投入，应被计入行动天数和连续天数。

`profileGrowth.ts` 的 `hasRealProgress` 已正确纳入这类任务，导致进度页与"我的"页的连续天数不一致。

## 修复方案

在 `actionDates`/`streakDates` 计算中纳入 `rescheduled` 且 `statusBeforeReschedule === "partially_completed"` 的任务，使用 `task.activityDate` 作为行动归属日期。

## 验收标准

- 包含"完成一部分后顺延"任务时，`getProgressSummary` 的 `currentStreakDays` 与 `buildProfileGrowthSummary` 的 `currentStreakDays` 一致。
- `totalActionDays` 包含该任务的 `activityDate`。
