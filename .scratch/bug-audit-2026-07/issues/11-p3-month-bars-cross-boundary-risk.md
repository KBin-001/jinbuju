# Bug 11 (P3)：todayDetails 月视图分布图跨月边界风险

## 问题描述

`todayDetails.ts` 的 `buildBars` 月视图使用字符串比较筛选任务范围。当前 `dateRange` 生成的范围都在同一月内，不会出错。但如果未来扩展支持跨月范围，字符串比较可能产生错误。

## 修复方案

在 `dateRange` 和 `buildBars` 月视图分支添加注释说明"当前仅支持单月范围"。或改用 `isValidBusinessDate` + `differenceInBusinessDays` 做范围判断。

## 验收标准

- 当前月视图数据正确，未来扩展时不会因字符串比较产生错误。
