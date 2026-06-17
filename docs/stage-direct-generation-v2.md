# V2 阶段直接生成链路

## 主链路

修改前：

```text
模板生成 -> AI 可选润色 -> 用户采用优化
```

修改后：

```text
目标输入 -> AI 完整生成 -> JSON 解析 -> Schema 校验 -> 质量检查 -> AI 修复一次 -> 保存预览
```

仅当 AI 请求失败、超时、返回空内容、JSON 解析失败、Schema 校验失败、质量检查失败且修复仍失败时，才使用 `buildBaseStagePlan()` 模板兜底。

## GoalProfile

服务端根据 `CreateStagePreviewInput` 构建内部 `GoalProfile`，包含：

- `title`
- `desiredOutcome`
- `domainLabel`
- `goalType`
- `categoryGroup`
- `currentLevel`
- `intensity`
- `dailyMinutes`
- `durationDays`
- `deadline`
- `weeklyFrequency`
- `constraints`
- `availableResources`
- `preferences`

前端尚未提供的 `constraints`、`availableResources`、`preferences` 使用空数组安全默认值。

## Prompt

新增直接生成 Prompt 版本：

```js
DIRECT_STAGE_PROMPT_VERSION = "stage-direct-v1"
```

Prompt 要求 AI 作为长期目标行动规划助手输出完整阶段方案，不再只优化固定任务槽位。对搏击、格斗等可能受伤目标，会附加安全、正规指导、不得输出伤害技术的约束。

## Schema

新增生成结果结构：

```ts
GeneratedStagePlan = {
  stage: {
    title: string
    objective: string
    focus: string
    durationDays: number
    successMetrics: string[]
    assumptions: string[]
  }
  days: Array<{
    dayIndex: number
    theme: string
    isRestDay: boolean
    actions: GeneratedAction[]
  }>
}
```

保存前会转换为当前页面兼容结构：

- `stage.objective` 同步到旧字段 `stage.summary`
- action 保留 `title`、`description`、`estimatedMinutes`
- action 扩展保留 `actionType`、`completionCriteria`、`requiredResources`、`safetyNotes`

旧模板预览缺少扩展字段时，页面不显示空区域。

## 质量检查

`evaluateStagePlanQuality()` 使用确定性规则，不额外调用 AI 评审。当前检查：

- 行动是否过于笔记化
- 实践型目标是否缺少实践行动
- 是否缺少完成标准或成功指标
- 是否多天高度重复
- 是否每日时间明显超标
- 是否包含不安全行为
- 搏击类目标是否缺少正规指导和安全提醒

质量不合格时最多 AI 修复一次。

## 元数据

预览记录安全元数据：

- `generatedBy`
- `modelId`
- `providerGroup`
- `promptVersion`
- `schemaVersion`
- `generationDurationMs`
- `repairAttempted`
- `fallbackReason`

不记录 AI Token、完整 OPENID、完整 Prompt、环境变量或原始错误堆栈。

## 前端

`plan-preview` 不再进入页面后自动调用 `optimizeStagePreview`。新预览默认已经是完整方案。模板兜底时显示：

```text
已为你生成一份基础行动方案，AI 生成暂时不可用，你可以继续调整。
```

任务卡片可选展示行动类型、完成标准、所需资源和安全提醒。
