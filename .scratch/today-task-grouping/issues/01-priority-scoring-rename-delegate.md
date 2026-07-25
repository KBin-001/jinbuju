# 01 — 优先级评分工具函数 + 分组重命名 + 页面委托

**What to build:** 用户打开今日页，看到三个分组已重命名为"今日重点""快速推进""稍后安排"，任务由新的优先级评分纯函数基于已有任务属性（截止日期、预计时长、AI 来源、顺延次数、连续天数）自动评分分组。新增 `ActionTask` 的三个可选字段（`importance`、`blocksOthers`、`priorityOverride`）到类型定义，服务层 `createTask`/`updateTask` 接受并持久化 `importance` 和 `blocksOthers`。行为测试覆盖评分规则、容量限制和空状态。

**Blocked by:** None — 可立即开始

**Status:** ready-for-agent

- [ ] `ActionTask` 接口新增 `importance?: "required" | "normal"`、`blocksOthers?: boolean`、`priorityOverride?: "focus" | "quick" | "later" | null` 三个可选字段，向后兼容（未填时默认 `"normal"` / `false` / `null`）
- [ ] `SaveTaskInput` 接口新增 `importance` 和 `blocksOthers` 可选参数；`createTask` 和 `updateTask` 持久化这两个字段
- [ ] 新建 `utils/taskPriority.ts`，导出纯函数 `groupTasksByPriority(tasks, context)`，按评分公式（重要程度 35% + 截止紧迫度 25% + 目标推动价值 20% + 连续行动与依赖 10% + 用户习惯 10%）返回三个分组
- [ ] 评分依据：`importance === "required"` 得满分；`currentDate === today` 截止紧迫度满分；`source === "ai"` 或标题与目标里程碑匹配得目标推动加分；`blocksOthers === true` 或 `rolloverCount > 0` 得依赖加分；`currentStreakDays` 用于理由标签
- [ ] 分组规则：高优先分入"今日重点"（最多 2 个，超出降级）；中等优先分且 `estimatedMinutes <= 40` 入"快速推进"（最多 3 个）；其余入"稍后安排"；依据不足时默认入"稍后安排"
- [ ] `priorityOverride` 非 `null` 的任务直接进入对应分组（本工单只需预留该逻辑分支，实际设置入口在工单 02 实现）
- [ ] `ActionPresentationGroup` 的 `key` 从 `"priority" | "quick" | "later"` 改为 `"focus" | "quick" | "later"`；`title` 改为"今日重点""快速推进""稍后安排"；`hint` 改为"推进核心目标""适合现在开始""已为你安排到专注时段"
- [ ] `buildActionPresentationGroups` 改为委托 `groupTasksByPriority`，传入任务列表和从 `getProgressSummary` 获取的上下文（`today`、`goalTargetDate`、`currentStreakDays`）
- [ ] `load()` 和 `applyTaskPatch()` 中调用 `buildActionPresentationGroups` 的位置不变
- [ ] 新建 `tests/task-priority.test.js`，遵循 `task-status.test.js` 的 `node:assert/strict` + TS 转译 shim 模式，断言覆盖：空列表返回空数组、单个任务只产生一个非空分组、`importance = "required"` 优先分更高、`currentDate === today` 排序靠前、`estimatedMinutes > 40` 不进"快速推进"、"今日重点"最多 2 个、"快速推进"最多 3 个、依据不足默认入"稍后安排"、`priorityOverride` 直接进入对应分组
