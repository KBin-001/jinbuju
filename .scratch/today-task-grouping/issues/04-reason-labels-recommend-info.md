# 04 — 理由标签渲染 + "按习惯推荐"说明弹层

**What to build:** 用户在"今日重点"任务右侧看到推荐理由标签（"推进核心目标""今天截止""已连续行动 N 天""阻塞其他任务""手动置顶"）。点击页面顶部的"按习惯推荐"标签弹出轻量说明"根据截止时间、预计时长和你的行动习惯自动排序，你可以随时调整"。

**Blocked by:** 02 — 用户手动覆盖分组（priorityOverride）

**Status:** ready-for-agent

- [ ] `groupTasksByPriority` 返回的每个任务附带 `priorityReasons: PriorityReason[]` 数组，理由按触发条件生成：
  - `priorityOverride === "focus"` → `{ key: "manual_pin", label: "手动置顶" }`（需工单 02 的覆盖已生效）
  - `currentDate === today` → `{ key: "due_today", label: "今天截止" }`
  - `currentStreakDays >= 6` → `{ key: "streak", label: "已连续行动 N 天" }`（N 为实际天数）
  - `source === "ai"` 或标题与目标里程碑匹配 → `{ key: "core_goal", label: "推进核心目标" }`
  - `blocksOthers === true` → `{ key: "blocks_others", label: "阻塞其他任务" }`
- [ ] 理由标签数量限制：每个任务最多显示 2 个理由标签，按优先级取前 2 个（"手动置顶"始终优先，其次"今天截止"，再次"推进核心目标"）
- [ ] 在 `today-action-list` 组件 WXML 中，为 `group.key === "focus"` 的任务行新增理由标签渲染区域：小号文字标签紧跟任务标题或状态标签之后，使用克制金色或主色低透明度变体
- [ ] 在 `today-action-list` 组件 TS 中，`ViewTask` 或 `ActionPresentationGroup` 的 task 类型扩展 `priorityReasons` 属性，确保数据从页面传到组件
- [ ] 将 `pages/index/index.ts` WXML 中现有的 `<view class="habit-recommend">` 改为可点击元素，`catchtap` 绑定新方法（如 `openRecommendInfo`）
- [ ] `openRecommendInfo` 方法弹出轻量说明：使用 `t-dialog` 或 `wx.showModal` 展示文案"根据截止时间、预计时长和你的行动习惯自动排序，你可以随时调整"，确认按钮文案"知道了"
- [ ] 扩展 `tests/task-priority.test.js`：`currentDate === today` 且高分的任务理由包含"今天截止"；`currentStreakDays >= 6` 时理由包含"已连续行动 N 天"；`priorityOverride = "focus"` 的任务理由包含"手动置顶"；理由标签最多 2 个
- [ ] 新建或扩展 `tests/today-grouping-contract.test.js`：`today-action-list` 组件 WXML 包含 `priorityReasons` 数据绑定；`pages/index/index.ts` WXML 中"按习惯推荐"元素包含 `catchtap` 绑定；页面 TS 包含 `openRecommendInfo` 方法
