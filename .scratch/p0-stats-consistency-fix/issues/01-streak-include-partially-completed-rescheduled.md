# 01 — 修复 getProgressSummary 连续天数排除"完成一部分后顺延"的原行动

**Parent:** `.scratch/bug-audit-2026-07/issues/01-p0-streak-excludes-rescheduled-partial.md`

**What to build:**

用户将一个行动标记为"完成一部分"后顺延到明天时，原行动仍属于历史真实推进——它的 `activityDate` 和 `actualMinutes` 应被计入连续行动天数和行动天数。修复后，进度页（`getProgressSummary`）的 `currentStreakDays`、`totalActionDays` 与"我的"页（`buildProfileGrowthSummary`）完全一致，用户不再看到两个页面显示矛盾的连续天数。

此修复同时解决 Bug 8（连续天数成就基于错误 `currentStreakDays`）和 Bug 9（`totalActualMinutes` 与 `actionDates` 数据源不一致），因为二者都是 Bug 1 的下游后果。

**Blocked by:** None — 可立即开始

**Status:** done

- [x] `getProgressSummary` 的 `tasks` 过滤器纳入 `rescheduled && statusBeforeReschedule === "partially_completed"` 的任务，与 `profileGrowth.ts` 的 `hasRealProgress` 口径一致。
- [x] `actionDates` 包含该任务的 `activityDate`（通过已有的 `actionDateOf = task.activityDate || task.currentDate`）。
- [x] `streakDates` 随 `actionDates` 一致更新。
- [x] `totalActionDays` 包含该任务的 `activityDate` 对应的日期。
- [x] `currentStreakDays` 在包含该任务的数据集下，与 `buildProfileGrowthSummary` 返回值一致。
- [x] 连续天数成就（`streak_3`、`streak_7`）的 `unlocked` 判断基于修复后的 `currentStreakDays`。
- [x] 现有测试 `tests/manual-services.test.js` 全部通过，不引入回归。
- [x] 新增测试断言：构造一个 `partially_completed` 后顺延的任务，验证 `currentStreakDays` 和 `totalActionDays` 正确计入其 `activityDate`。
