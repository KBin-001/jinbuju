# Bug 8 (P2)：连续行动成就基于不正确的 currentStreakDays

## 问题描述

`manualStats.ts` 第 74-78 行的 badges 使用 `currentStreakDays` 判断解锁，但该值存在 Bug 1 的问题。`achievement.ts` 的 `buildSnapshot` 使用独立的 `isEffective` 函数计算，口径不同。

## 修复方案

修复 Bug 1 后，`currentStreakDays` 将正确计算。同时确认 `getProgressSummary` 的 badges 与 `achievement.ts` 口径一致。

## 验收标准

- "完成一部分后顺延"的当天，连续天数正确，相应成就正常解锁。
- `getProgressSummary` 的 `currentStreakDays` 与 `achievement.ts` 的 `longestStreak` 在同一数据集下一致。
