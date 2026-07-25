# Bug 6 (P1)：todayDetails metricsFor 将 skipped 任务计入完成率分母

## 问题描述

`todayDetails.ts` 的 `metricsFor` 使用 `getTasksByGoal` 的结果（不过滤 `skipped`）计算 `focusRate`：`completed / dayTasks.length`。`skipped` 任务被计入分母但不计入分子，拉低完成率。`calculateTodaySummary`（`manualTask.ts`）正确排除了 `skipped`。

## 修复方案

`metricsFor` 在计算 `total` 和 `focusRate` 时排除 `skipped` 状态的任务。

## 验收标准

- 包含 `skipped` 任务时，`metricsFor` 的 `focusRate` 与 `calculateTodaySummary` 的 `completionPercent` 一致。
