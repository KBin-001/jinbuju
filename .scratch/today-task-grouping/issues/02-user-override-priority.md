# 02 — 用户手动覆盖分组（priorityOverride）

**What to build:** 用户在任务的"···"菜单中看到"设为今日重点""移到快速推进""稍后安排"和"清除分组覆盖"四个选项。点击后任务立即跳到对应分组并持久化在 `priorityOverride` 字段上，退出再进入仍保留。"今日重点"已满 2 项时尝试再设为今日重点会被提示"今日重点最多 2 项，请先移出再设置"而非静默拒绝或超限。清除覆盖后任务回到系统自动评分分组。

**Blocked by:** 01 — 优先级评分工具函数 + 分组重命名 + 页面委托

**Status:** ready-for-agent

- [ ] 在 `services/manualTask.ts` 中新增 `updateTaskPriorityOverride(taskId, override)` 函数，遵循现有服务层模式（读取存储 → 更新 `priorityOverride` 字段 → `updatedAt` → 写回存储）
- [ ] `groupTasksByPriority` 中 `priorityOverride` 非 `null` 的任务直接进入对应分组（工单 01 已预留分支，此处确保与服务层持久化数据打通）
- [ ] 在 `openTaskMenu`（`pages/index/index.ts`）中，为未完成任务新增四个菜单项："设为今日重点"（`override = "focus"`）、"移到快速推进"（`override = "quick"`）、"稍后安排"（`override = "later"`）、"清除分组覆盖"（仅当 `priorityOverride` 非 `null` 时显示，清除为 `null`）
- [ ] 菜单项位置：放在"设置执行方式"之后、"顺延到明天"之前，保持操作分组的逻辑连贯
- [ ] 设为"今日重点"时检查当前"今日重点"分组中已有几个任务（排除当前任务自身的覆盖）；若已达 2 个，`wx.showToast` 提示"今日重点最多 2 项，请先移出再设置"，不执行覆盖
- [ ] 手动调整后立即调用 `applyTaskPatch` 或 `load` 刷新 `visibleTaskGroups`，列表即时重排
- [ ] 扩展 `tests/task-priority.test.js`：`priorityOverride = "focus"` 的任务直接进入"今日重点"分组；`priorityOverride = "quick"` 直接进入"快速推进"；`priorityOverride = "later"` 直接进入"稍后安排"；清除覆盖（`null`）后回到自动评分
- [ ] 扩展 `tests/task-priority.test.js`："今日重点"已有 2 个覆盖任务时，第三个设为 focus 时不超限（由上层菜单逻辑拦截，函数层面应正确处理 3 个 focus 覆盖的情况——超额时不丢失任务，降级到后续分组）
- [ ] 新建或扩展 `tests/today-grouping-contract.test.js`，断言 `openTaskMenu` 函数体包含"设为今日重点""移到快速推进""稍后安排""清除分组覆盖"字符串
