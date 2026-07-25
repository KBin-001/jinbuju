# Bug 2 (P0)：getProgressSummary 热力图和近 7 天使用 currentDate 而非 activityDate

## 问题描述

热力图（`manualStats.ts` 第 46-62 行）和 `recentDays`（第 11-15 行）通过 `task.currentDate === date` 筛选当天任务。但行动完成时 `activityDate` 被设为实际完成日期，`currentDate` 仍为原计划日期。今天完成的顺延行动会在昨天的热力图格子显示完成标记。

进度页趋势图已正确使用 `task.activityDate || task.currentDate`。

## 修复方案

对 `completed` 和 `partially_completed` 状态的任务使用 `task.activityDate || task.currentDate` 作为归属日期；对 `pending` 和 `skipped` 仍使用 `currentDate`。

## 验收标准

- 今天完成的顺延行动在热力图今天的位置显示完成标记。
- `recentDays` 的今天数据包含今天实际完成的顺延行动。
