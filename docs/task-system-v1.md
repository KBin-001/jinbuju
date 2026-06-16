# V1 今日任务系统

## 产品定位

V1 首页以“今日任务”为核心。任务可以来自手动创建、计划生成、AI 计划或顺延，但都进入 `tasks` 集合，并使用同一套展示、完成和打卡流程。

## tasks 关键字段

```ts
type TaskSource = "manual" | "ai" | "template" | "carry_over";
type TimePeriod = "morning" | "afternoon" | "evening" | "anytime";
type TaskStatus = "pending" | "completed" | "partial" | "skipped";

type TaskRecord = {
  _id: string;
  _openid: string;
  title: string;
  description: string;
  taskDate: string;
  timePeriod: TimePeriod;
  estimatedMinutes: number;
  tagId: string | null;
  tagName?: string;
  planId: string | null;
  source: TaskSource;
  taskType: "required" | "optional";
  priority: "normal" | "important";
  repeatType: "none" | "daily" | "weekly" | "custom";
  status: TaskStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

## 云函数 action

### getHomeData

返回当前业务日期下调用者自己的全部任务，不再只返回当前计划任务。服务端按 `Asia/Shanghai` 生成 `businessDate`，按 `timePeriod` 分组，并返回来源汇总。

### createManualTask

客户端只提交业务输入：

```ts
{
  action: "createManualTask";
  requestId: string;
  title: string;
  description?: string;
  taskDate?: string;
  timePeriod: TimePeriod;
  estimatedMinutes: number;
  tagName?: string;
  planId?: string;
  repeatType: "none" | "daily" | "weekly" | "custom";
  priority: "normal" | "important";
  taskType: "required" | "optional";
}
```

服务端使用 `cloud.getWXContext()` 获取身份，使用 `requestId` 生成稳定任务 ID，重复提交返回同一 `taskId` 且 `created: false`，不重复创建任务。

## 已实现范围

- 无目标时也可以在首页添加今日任务。
- 今日页展示当天所有任务，按上午、下午、晚上、随时分组。
- 今日页展示任务来源和来源汇总。
- 手动任务可以在没有计划时标记完成。
- 有计划任务仍需校验计划属于当前用户且处于 `active` 状态。

## 后续待补

- 独立任务编辑页。
- 手动任务删除和顺延。
- 手动任务打卡记录，不依赖 `goalId` 和 `planId`。
- 重复任务的自动生成规则。
