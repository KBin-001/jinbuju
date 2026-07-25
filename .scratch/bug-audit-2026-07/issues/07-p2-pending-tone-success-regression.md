# Bug 7 (P2)："待开始"状态使用 success 主题色（回归）

## 问题描述

`taskStatus.ts` 第 107 行 `return { text: "待开始", tone: "success" }`。"待开始"表示未完成，使用绿色可能误导用户。`BUG_20260707.MD` Bug #12 声称已改为 `neutral`，但当前代码仍为 `success`，属于回归。

## 修复方案

将 "待开始" 的 tone 改为 `neutral`。

## 验收标准

- `getActionTaskDisplayStatus` 对 pending + today 状态返回 `tone: "neutral"`。
