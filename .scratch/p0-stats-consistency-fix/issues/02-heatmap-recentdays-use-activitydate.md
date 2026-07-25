# 02 — 修复 getProgressSummary 热力图和近 7 天摘要使用 currentDate 而非 activityDate

**Parent:** `.scratch/bug-audit-2026-07/issues/02-p0-heatmap-uses-currentdate-not-activitydate.md`

**What to build:**

用户今天完成了一个昨天计划的顺延行动后，进度页热力图应在今天的位置显示完成标记，近 7 天摘要的今天数据也应包含该行动。当前 `recentDays` 和 `heatmapDays` 用 `task.currentDate`（原计划日期）筛选，导致完成数据错误地出现在原计划日期的格子里。修复后，已完成/部分完成的行动（含 Ticket 01 新纳入的"完成一部分后顺延"任务）按 `activityDate` 归属日期，待开始/跳过的行动仍按 `currentDate` 归属。

**Blocked by:** 01 — 修复 getProgressSummary 连续天数排除"完成一部分后顺延"的原行动

**Status:** done

- [x] `recentDays` 循环中对 `completed` 和 `partially_completed`（含 `rescheduled && statusBeforeReschedule === "partially_completed"`）状态的任务使用 `task.activityDate || task.currentDate` 作为归属日期；对 `pending` 仍使用 `currentDate`。
- [x] `heatmapDays` 循环同上。
- [x] 今天完成的顺延行动在热力图今天的位置（`isToday: true` 的格子）显示完成标记。
- [x] `recentDays` 中今天的 `completedCount` 包含今天实际完成的顺延行动。
- [x] 待开始行动的计划数据仍出现在其 `currentDate` 对应的格子里，不受影响。
- [x] 现有测试 `tests/manual-services.test.js` 全部通过，不引入回归。
- [x] 新增测试断言：构造一个 `currentDate` 在昨天、`activityDate` 在今天的已完成任务，验证热力图和 `recentDays` 在今天的位置包含该任务的完成数据。
