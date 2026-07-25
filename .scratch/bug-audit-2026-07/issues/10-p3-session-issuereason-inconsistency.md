# Bug 10 (P3)：completeActionSession 与 finishActionSession issueReason 处理不一致

## 问题描述

`actionSession.ts` 中两个计时结束入口对 `issueReason` 处理不一致：`finishActionSession` 无条件清除，`completeActionSession` 不修改。修复 Bug 3 后需对齐。

## 修复方案

`completeActionSession` 在 `partial = false`（标记完成）时清除 `issueReason`；`partial = true` 时保留。

## 验收标准

- 两个入口在相同 `markTaskCompleted`/`partial` 参数下对 `issueReason` 的处理一致。
