# Bug 5 (P1)：小队页 buildActivitySnapshot 未设置 actualMinutes

## 问题描述

`team/index.ts` 第 182-188 行的 `todayActionDetails` 仅设置 `growthMinutes`，未设置 `actualMinutes`。`TeamMemberActionDetail` 类型有 `actualMinutes?: number` 字段，但未赋值。`BUG_20260707.MD` Bug #10 声称已修复，但当前代码仍缺失。

## 修复方案

在 `buildActivitySnapshot` 的 `todayActionDetails` 中显式设置 `actualMinutes: task.actualMinutes || 0`。

## 验收标准

- `buildActivitySnapshot` 返回的 `todayActionDetails` 每项包含 `actualMinutes` 字段且值正确。
