# 01 — 服务层：活跃会话上下文解析器

**What to build:** 新增一个服务层函数（工作名 `getActiveActionSessionContext`），返回全局唯一的活跃会话及其关联任务，作为页面解析计时条数据的唯一入口。会话来自现有的全局活跃会话查询（第一个 running 或 paused）；任务按会话持有的 `taskId` 直接从数据存储解析，不经过目标作用域过滤，因此 `rescheduled` 和跨目标的任务仍能解析。任务被软删除时返回 `task: null`（孤儿），交由页面决定恢复态展示。该函数不接收也不依赖「选中日期」参数——活跃会话是全局概念。这是纯增量 prefactor：不改任何页面行为，CI 保持绿色。

返回结构（来自原型，表达决策而非完整实现）：

```
type ActiveActionSessionContext =
  | { session: ActionSession; task: ActionTask }      // 正常：会话及其任务均存在
  | { session: ActionSession; task: null }            // 孤儿：任务已被软删除
  | null;                                             // 无活跃会话
```

**Blocked by:** 无 — 可立即开始

**Status:** done

- [x] `getActiveActionSessionContext` 函数存在于行动会话服务中，返回上述联合类型
- [x] 活跃会话存在且任务为 `rescheduled` 时，上下文返回会话 + 该任务（验证顺延不丢失）
- [x] 活跃会话的任务属于非当前激活目标时，上下文仍返回会话 + 该任务（验证跨目标不丢失）
- [x] 活跃会话存在但任务被软删除时，上下文返回 `{ session, task: null }`（验证孤儿可识别）
- [x] 无活跃会话时返回 `null`
- [x] 全局单活跃会话不变式：已有 running 会话时，对其他任务调用 `startActionSession` 抛错
- [x] 顺延任务的会话经 `finishActionSession` 结束后，任务按 `markTaskCompleted` 进入 `partially_completed` 或 `completed`，投入正确累计（回归现有行为在新解析路径下仍成立）
- [x] 服务层行为测试全部通过（扩展已有服务层测试文件，不新建测试文件）
- [x] 不修改 `ActionSession` / `ActionTask` 的字段定义
- [x] 不改变现有 `getActiveActionSession`、`startActionSession` 等函数的签名与行为
