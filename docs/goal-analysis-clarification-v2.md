# V2 AI 目标分析与动态澄清

## 新调用链

修改前：

```text
目标标题 -> 直接生成计划
```

修改后：

```text
目标分析 -> 动态澄清 -> GoalProfile -> 生成计划
```

高歧义目标不会直接进入 7 天计划生成。以“练出搏击”为例，系统会先确认目标结果、训练经验、每周频率、是否可接受正规指导、运动限制等关键信息。

## 云函数 action

### analyzeGoal

客户端提交：

```ts
{
  action: "analyzeGoal",
  requestId: string,
  input: {
    title: string,
    description?: string,
    dailyMinutes?: number,
    durationDays?: number,
    currentLevel?: string,
    intensity?: string,
    deadline?: string
  }
}
```

服务端通过 `cloud.getWXContext()` 获取身份，创建 `goal_analysis_drafts` 临时草稿。AI 失败时不会直接跳过澄清，而是返回通用 fallback 问题。

### submitGoalClarification

客户端只提交：

```ts
{
  action: "submitGoalClarification",
  analysisId: string,
  answers: Array<{
    questionId: string,
    value: string | number | boolean | string[]
  }>
}
```

服务端根据数据库保存的问题定义验证答案，不信任客户端回传的问题正文、选项、类型或 GoalProfile。

### createStagePreview

新流程优先提交：

```ts
{
  action: "createStagePreview",
  requestId: string,
  analysisId: string
}
```

服务端读取已完成的 GoalProfile 后再进入阶段方案生成。旧 `input` 参数保留为兼容入口。

## Prompt

新增：

```js
GOAL_ANALYSIS_PROMPT_VERSION = "goal-analysis-v1"
```

Prompt 要求 AI 只做目标理解和信息充分性判断，不生成每日计划、不输出任务安排、不输出 Markdown 或隐藏推理。

## Schema 与 fallback

`validateGoalAnalysisResult()` 检查：

- `categoryGroup`
- `goalType`
- `ambiguityScore`
- `confidenceScore`
- `needsClarification`
- `questions`
- `safetyContext`

问题数量限制为 0～5。选择题必须有选项，数字题必须有合理范围，问题不得询问手机号、微信号、身份证等敏感身份信息。

AI 分析失败时：

```text
AI分析 -> 修复一次 -> fallback澄清问题
```

fallback 不伪装成 AI 成功，返回 `analysisSource: "fallback"`。

## GoalProfile

GoalProfile 由服务端合成：

```text
原始用户输入
+ 用户已选时间、强度、水平
+ AI目标分析
+ 用户澄清答案
```

客户端不能提交或修改最终 `categoryGroup`、`safetyContext`、`GoalProfile`。

## 幂等

`analyzeGoal` 使用当前用户和 `requestId` 生成固定 `analysisId`。重复点击：

- `analyzing`：返回分析中状态
- `needs_clarification`：返回已有问题
- `ready`：返回已有结果
- `consumed`：阶段生成时复用已关联预览

`submitGoalClarification` 对 ready/consumed 重复提交返回已有结果，不重复生成 GoalProfile。

## 页面

澄清流程内嵌在 `goal-create` 第三步：

- 展示规范目标
- 展示最多 5 个动态问题
- 根据类型展示选择、数字、文本和布尔控件
- 必填未答不能提交
- 提交期间禁用重复点击
- 本地只缓存 `analysisId` 和答案草稿
