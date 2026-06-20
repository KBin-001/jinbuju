# 计划创建流程 V2

## 客户端输入

新建目标只提交以下业务字段，不提交用户身份、创建时间或统计字段：

```ts
type CreateStagePreviewInput = {
  templateId:
    | "cet"
    | "teacher_exam"
    | "postgraduate_exam"
    | "civil_service_exam"
    | "ai_learning"
    | "custom";
  customGoalTitle?: string;
  currentLevel: "zero" | "basic" | "intermediate";
  dailyMinutes: 30 | 60 | 90 | 120 | 180 | 360;
  weeklyDays: 3 | 5 | 7;
  intensity: "light" | "normal" | "intensive";
  durationDays: number;
  planDurationDays: 7 | 14 | 30 | 90; // 90 天在客户端显示为“长期”
  deadline?: string;
};
```

客户端新建入口只展示上述 6 个 key。云函数继续兼容历史 key：`cet4`、`python`、`ai_tools`、`video_editing`、`resume`、`interview`；历史目标和预览不会因入口精简失效。

长期截止日期是可选元数据，不参与当前计划起止日期计算，并且不得早于当前计划结束日期。

## 云函数接口

所有接口通过 `generatePlan` 云函数调用，并由 `cloud.getWXContext()` 获取调用者身份。

- `analyzeGoal`：理解目标，必要时返回动态澄清问题并形成服务端可信 `GoalProfile`。
- `createStagePreview`：按 `requestId` 幂等调用 AI 生成完整阶段；仅在 AI 连续失败后使用模板兜底并标记 `generatedBy: "template"`。
- `optimizeStagePreview`：生成 AI 候选方案，每份预览最多调用两轮。
- `updateStagePreviewTask`：按 `previewId + revision + mutationId` 更新单个任务槽位。
- `applyStageOptimization`：只替换未记录在 `editedSlotIds` 中的任务。
- `getStagePreview`：读取草案、revision 和 AI 优化状态。
- `confirmStagePlan`：通过事务创建目标、计划和任务。

稳定错误码包括：

- `INVALID_ARGUMENT`
- `ACTIVE_GOAL_ALREADY_EXISTS`
- `STAGE_PREVIEW_NOT_FOUND`
- `STAGE_PREVIEW_CONFLICT`
- `STAGE_OPTIMIZATION_IN_PROGRESS`
- `STAGE_OPTIMIZATION_LIMIT_REACHED`
- `STAGE_OPTIMIZATION_NOT_READY`
- `STAGE_ALREADY_CONFIRMED`

## 数据结构

`stage_previews` 的 V2 记录增加：

- `revision`
- `editedSlotIds`
- `lastMutationId`
- `optimizationStatus`
- `optimizationAttempts`
- `optimizationPlan`

每个执行日只有一个任务，使用 `slot_day_{dayIndex}` 作为稳定槽位。休息日的 `actions` 为空，不创建任务记录。

执行日按每个 7 天区间重复：

- 每周 3 天：第 1、3、5 天。
- 每周 5 天：第 1、2、3、5、6 天。
- 每周 7 天：每天。

## 微信开发者工具测试

1. 清除本地缓存并进入创建页，确认默认值为零基础、30 分钟、每周 5 天、7 天、普通强度。
2. 依次选择 30、60、90、120、180、360 分钟，确认单位可见且提交成功；选择“长期”后确认提交 `planDurationDays: 90`。
3. 按顺序验证英语四六级、教师资格证、考研、考公、AI学习、自定义目标 6 个入口；选择自定义目标时验证空值、纯空格和 31 字输入被拦截。
4. 创建 7、14、30 天和长期计划，确认预览的 `days` 覆盖完整周期，并按周折叠展示；长期计划应包含 90 天行动和 13 个递进路线区块。
5. 验证每周 3、5、7 天对应的执行日和休息日分布。
6. 编辑一个任务后等待 AI 完成，采用优化并确认该任务未被覆盖。
7. 在 AI 优化中或优化失败时直接确认，确认首页仍可正常开始任务。
8. 连续点击保存任务和确认按钮，确认按钮禁用且不会产生重复数据。
9. 在休息日查看首页、进度页和小队页，确认显示“休息日”而不是“未完成”。
10. 修改设备日期后重新请求数据，确认今日任务仍由服务端 `Asia/Shanghai` 业务日期决定。
11. 对已有 10/14 天阶段执行查看和复盘，确认旧数据仍可读取。
