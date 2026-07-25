# Bug 4 (P1)：getProgressSummary todayCompleted/todayTotal 按 currentDate 统计

## 问题描述

`getProgressSummary` 第 9 行 `const todayTasks = tasks.filter((task) => task.currentDate === today)` 只统计 `currentDate === today` 的任务。今天实际完成的顺延行动（`currentDate` 在过去，`activityDate` 在今天）不被计入。

## 修复方案

`todayTasks` 改为按 `activityDate`（对已完成/部分完成）或 `currentDate`（对待开始）筛选今天的任务。

## 验收标准

- 今天完成的顺延行动被计入 `todayCompleted` 和 `todayTotal`。
- 与今日页的 `summary.completedCount` 和 `summary.totalCount` 一致。
