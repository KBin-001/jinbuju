# Bug 3 (P1)：finishActionSession 无条件清除 issueReason

## 问题描述

`actionSession.ts` 第 134 行 `task.issueReason = undefined` 无条件清除完成原因。当用户选择"仅结束计时"（`markTaskCompleted = false`），任务进入 `partially_completed`，但之前设置的 `issueReason` 被清除。

`completeActionSession` 不修改 `issueReason`，两个入口行为不一致。

## 修复方案

`finishActionSession` 在 `markTaskCompleted = false` 时保留原有 `issueReason`；仅在 `markTaskCompleted = true` 时清除。

## 验收标准

- 设置了 `issueReason` 的任务，通过计时结束选择"仅结束"后，`issueReason` 保留。
- 通过计时结束选择"标记完成"后，`issueReason` 被清除。
