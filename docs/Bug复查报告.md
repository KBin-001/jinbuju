# 今日进度｜目标计划打卡（jinbuju）小程序 Bug 专项复查报告

> **复查日期**：2026-07-18
> **复查方式**：静态代码审查（未修改任何代码），覆盖 `miniprogram/` 前端 + `cloudfunctions/generatePlan/` 云函数
> **复查范围**：本次聚焦"可复现的逻辑 Bug 与运行时崩溃风险"，不含安全/合规/性能（见上一轮风险评估报告）
> **与上轮区别**：已排除上轮记录的 7 个已知前端 Bug（打卡清草稿、小队无回滚、buckets[0]、inputMinutes NaN、goal-create submitting、team 硬编码房间号、deleteTask rescheduled），本轮聚焦**新发现**

---

## 一、执行摘要

本轮共发现 **42 个 Bug**（云函数 31 个 + 前端 11 个），分布如下：

| 等级 | 云函数 | 前端 | 合计 | 处理原则 |
|------|--------|------|------|----------|
| **严重 P0** | 4 | 1 | 5 | 上线前必须修复 |
| **高 P1** | 4 | 4 | 8 | 上线前尽量修复 |
| **中 P2** | 17 | 4 | 21 | 迭代修复 |
| **低 P3** | 6 | 2 | 8 | 技术债务 |

**核心结论**：

- **最危险的是一个测试常量没改回来**：`cloudfunctions/generatePlan/date.js` 的 `TEST_REVIEW_OFFSET_DAYS = 8`，注释写着"测试完务必改回 0"但当前是 8，导致所有用户的复盘入口提前 8 天解锁，一行代码修复。
- **v2 账号体系迁移不彻底**：checkin/stage-management/repository 仍用旧的 `stableId("user", openid)` 作为 userId 写 users 表，而 v2 新用户用的是 `user_${randomHex}`，导致打卡连续天数写入错误文档，profile 永远显示旧值。
- **级联删除有两处严重缺陷**：`where().remove()` 单次 20 条限制未分页 + `deleteUserData` 不清理 v2 schema 的 team_members，导致注销用户后残留孤儿数据和小队成员。
- **前端有一处开发态遗留**：`displayTaskTitle` 把纯数字标题替换成"背单词 30 个"等示例文案，用户如果行动标题是"100"会看到假标题。

---

## 二、严重 Bug（P0，上线前必须修复）

### P0-1. 测试常量 TEST_REVIEW_OFFSET_DAYS=8 未归零，复盘入口提前 8 天解锁

- **位置**：`cloudfunctions/generatePlan/date.js` 第 3-4 行、第 28-32 行
- **影响扩散**：`plan-management.js` 第 247-251 行、`stage-management.js` 第 524-529 行的 `canReview` / `reviewEligible` 判断
- **代码**：
  ```js
  // ⚠️ 测试用：设为 > 0 的天数可让复盘入口判断跳到未来，测试完务必改回 0
  const TEST_REVIEW_OFFSET_DAYS = 8;
  ```
- **复现**：用户创建 7 天计划（startDate=7月18日，plannedEndDate=7月24日），第 1 天 `formatReviewEligibleDate()` 返回 7月26日 ≥ 7月24日，复盘入口立即解锁。
- **后果**：用户在计划刚开始就能复盘并生成下一阶段，破坏阶段节奏；可能在未完成任何任务时就提交复盘。
- **修复**：`TEST_REVIEW_OFFSET_DAYS = 0`；建议改用环境变量控制避免再次遗忘。

### P0-2. v2 账号 userId 不一致，打卡 streakDays 写入错误文档

- **位置**：
  - `cloudfunctions/generatePlan/account.js` 第 43-45 行（v2 定义）
  - `cloudfunctions/generatePlan/checkin.js` 第 201 行、第 270-292 行（仍用 legacy id）
  - `cloudfunctions/generatePlan/stage-management.js` 第 169 行
  - `cloudfunctions/generatePlan/repository.js` 第 132 行、第 217-234 行
- **代码**：
  ```js
  // account.js (v2): 新用户 userId = user_${crypto.randomBytes(16).toString("hex")}
  // checkin.js line 201: 仍用 const userId = stableId("user", openid);  // legacy id
  ```
- **复现**：v2 新用户先 `bootstrapAccount`（创建 `user_xxx` 文档），再 `submitCheckin`，checkin 写入 `stableId("user", openid)` 即另一个 id 的文档。
- **后果**：
  1. profile 的 `streakDays` 永远不更新（写到错误文档）
  2. 小队 `getMemberProgress` 用 v2 userId 查 users 表读不到 checkin 写入的连续天数
  3. 跨页面显示不一致
- **修复**：所有写 users 表的地方统一用 `resolveAccount(openid).userId`，禁止再用 `stableId("user", openid)`。

### P0-3. where().remove() 单次 20 条限制导致级联删除残留孤儿数据

- **位置**：
  - `cloudfunctions/generatePlan/repository.js` 第 378-416 行（deleteCurrentPlan）
  - `cloudfunctions/generatePlan/account.js` 第 208-212 行（removeOwnedRecords）
  - `cloudfunctions/generatePlan/profile.js` 第 308-316 行（deleteUserData）
- **代码**：
  ```js
  await db.collection("tasks").where({ _openid: openid, goalId: goal._id }).remove();   // 最多删 20 条
  await db.collection("checkins").where({ _openid: openid, goalId: goal._id }).remove(); // 最多删 20 条
  ```
- **复现**：用户有超过 20 条 task/checkin 记录时调用 `deleteCurrentPlan` / `clearUserBusinessData` / `deleteCloudAccount`。
- **后果**：超出 20 条的记录不被删除，留下孤儿数据指向已删除的 goal/plan；`getProfileData`、`getHomeData` 仍查到这些孤儿，统计错误；注销后旧数据可能关联到重新注册的新账号。
- **修复**：写 `while` 循环 `where().limit(20).remove()` 直到 `count()` 为 0。

### P0-4. deleteUserData 不清理 v2 schema 的 team_members，注销后残留小队成员

- **位置**：`cloudfunctions/generatePlan/profile.js` 第 296-316 行
- **关联**：`cloudfunctions/generatePlan/profile-rules.js` 第 39-59 行（USER_OWNED_COLLECTIONS 不含 team_members）
- **代码**：
  ```js
  const userKey = stableId("user", openid);
  const memberships = await getMany("team_members", { userKey }); // v2 永远查不到
  await db.collection("team_members").where({ userKey }).remove(); // v2 永远删不掉
  ```
- **复现**：v2 schema 用户调用 `deleteUserData`（index.js 第 727 行仍暴露此 action）。
- **后果**：注销后 `team_members` 残留 active 成员，`team.memberCount` 不减，小队榜单仍显示该用户，队长无法判断该成员已退出。
- **修复**：`deleteUserData` 同时按 `userId` 清理 `team_members`、`team_user_memberships`、`team_member_daily`、`team_events`、`team_join_requests`、`encouragements`；或直接废弃 `deleteUserData` 统一走 `deleteCloudAccount`。

### P0-5. displayTaskTitle 把纯数字标题替换成示例文案（开发态遗留）

- **位置**：`miniprogram/pages/index/index.ts` 第 206-210 行
- **代码**：
  ```typescript
  const EXAMPLE_ACTION_TITLES = ["背单词 30 个", "阅读 30 分钟", "听力练习 20 分钟", "真题复盘 1 套"];
  function displayTaskTitle(task: ActionTask): string {
    if (!/^\d+$/.test(task.title.trim())) return task.title;
    const seed = task.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return EXAMPLE_ACTION_TITLES[seed % EXAMPLE_ACTION_TITLES.length];
  }
  ```
- **复现**：用户创建行动标题为纯数字（如"100"、"30"），首页显示"背单词 30 个"等示例文案而非真实标题。
- **后果**：用户看到与实际不符的假标题，严重误导；AI 教练和打卡记录仍用真实标题，造成首页与其他页面不一致。
- **修复**：删除 `displayTaskTitle` 函数，直接用 `task.title`。

---

## 三、高风险 Bug（P1，上线前尽量修复）

### P1-1. getHomeData 读操作有副作用+竞态，rolloverCount 重复 +1

- **位置**：`cloudfunctions/generatePlan/home.js` 第 131-157 行
- **代码**：读接口 `getHomeData` 内部对过期 pending 任务做 `update`（顺延到今天），无锁无事务。
- **复现**：用户双击首页刷新，或手机+电脑同时打开，两个 getHomeData 并发执行，同一过期任务 `rolloverCount` 被两次 +1。
- **后果**：rolloverCount 失真；违反读操作幂等；可能引发后续 `postponeTask` 的 `TASK_ALREADY_POSTPONED` 误判。
- **修复**：将顺延逻辑移到独立 action，前端显式触发；或用事务+条件更新保证幂等。

### P1-2. submitStageReview 三次独立写入无事务，部分失败导致死锁

- **位置**：`cloudfunctions/generatePlan/stage-management.js` 第 632-661 行
- **代码**：三次非事务写入：①关联 preview ②写复盘记录 ③更新 stage 状态为 reviewing。
- **复现**：第 3 步 `plans.update` 失败（网络抖动），stage_reviews 已写、preview 已关联，但 stage.status 仍是 active。
- **后果**：用户重试时 `buildReviewData` 检测到 reviewed=true 返回 preview，但 `confirmStagePlan` 校验 `previousStage.status !== "reviewing"` 报 `STAGE_REVIEW_NOT_ALLOWED`，用户陷入死锁——已生成新 preview 但无法 confirm。
- **修复**：三次写入包进 `db.runTransaction`；或在重试路径检测到 reviewed 但 status 未变时自动补上 plans.update。

### P1-3. shouldReplace 时间戳相等时无法恢复已删除任务

- **位置**：`cloudfunctions/generatePlan/manual-sync.js` 第 45-50 行
- **代码**：
  ```js
  return incomingTime > currentTime ||
         (incomingTime === currentTime && incoming.deletedAt && !existing.deletedAt);
  ```
- **复现**：A 端删除任务（deletedAt=时间T），B 端同秒修改任务（updatedAt=时间T，未删除）。同步时 `incomingTime === currentTime`，incoming 未删除、existing 已删除，shouldReplace 返回 false，B 端修改丢失，任务保持删除。
- **后果**：跨设备恢复任务失败，本地与云端数据不一致。
- **修复**：时间戳相等时优先未删除版本（恢复优先于删除）。

### P1-4. deleteCurrentPlan 非事务级联删除，部分失败留孤儿

- **位置**：`cloudfunctions/generatePlan/repository.js` 第 364-419 行
- **代码**：7 次独立 remove/update，无事务。
- **复现**：中间某步失败，如 goals 已删但 tasks 残留，或 tasks/checkins 删了但 goals 残留。
- **后果**：孤儿数据影响后续 `getProfileData`、`buildProfile` 统计；下次创建新目标时 `hasActiveGoal` 可能误判。
- **修复**：用 `db.runTransaction` 包住级联删除（注意事务大小限制，可能需分批）；或先软删除后台 cron 清理。

### P1-5. scheduleCloudPersist 忽略云端合并响应，跨设备数据延迟可见

- **位置**：`miniprogram/services/manualStore.ts` 第 43-49 行
- **代码**：
  ```typescript
  wx.cloud.callFunction({ name: "generatePlan", data: { action: "syncManualData", store: payload } })
    .then((response: any) => {
      if (!response?.result?.success) throw new Error(...);
      // ← 未处理 response.result.data（云端合并后的最新数据）
      emit("manual:cloud-saved", undefined);
    })
  ```
- **复现**：设备 A 写入数据并同步到云端，设备 B 同步时云端返回合并后的最新数据，但 B 忽略该响应，不合并到本地。
- **后果**：跨设备数据延迟可见，用户在 B 端看不到 A 端最新写入，直到 B 端下次冷启动重新拉取。
- **修复**：`.then` 中读取 `response.result.data`，与本地 store 合并后 `writeManualStore`（注意避免循环触发 scheduleCloudPersist）。

### P1-6. 本地完成/顺延/删除任务后未取消云端订阅提醒

- **位置**：`miniprogram/services/manualTask.ts` 第 126-127 行、第 192 行、第 239 行
- **代码**：
  ```typescript
  // updateTaskStatus (completed/skipped)
  if ([...].includes(status) && task.reminder && task.reminder.status === "scheduled") {
    task.reminder = { ...task.reminder, status: "cancelled" };  // 仅改本地状态
  }
  // rescheduleTask / deleteTask 同样只改本地
  ```
- **复现**：用户为任务设置了订阅提醒，之后删除/完成/顺延该任务。
- **后果**：本地标记 cancelled 了，但微信服务器上的订阅消息提醒仍按原计划发送，用户收到已删除任务的推送。
- **修复**：本地改 status 后同步调用 notification service 的取消订阅 API（`notification.unsubscribe` 或专门的 cancelTaskReminder）。

### P1-7. decodeURIComponent 对非法 URI 序列抛 URIError 导致成就页白屏

- **位置**：`miniprogram/pages/achievements/index.ts` 第 49 行
- **代码**：
  ```typescript
  onLoad(options: { achievementId?: string }) {
    this.pendingAchievementId = decodeURIComponent(String(options?.achievementId || ""));
  }
  ```
- **复现**：从分享链接进入成就页，链接中 achievementId 被截断或包含非法 URI 序列（如 `%E` 无后续字符）。
- **后果**：`decodeURIComponent` 抛 `URIError`，onLoad 报错，页面白屏无任何提示。
- **修复**：用 try/catch 包裹，失败时用原始值或空字符串。

### P1-8. 打卡提交失败清空草稿导致无法重试（上轮已知，仍需修复）

- **位置**：`miniprogram/pages/checkin/index.ts` 第 331-349 行
- **问题**：`.catch()` 中无条件 `clearTodayCheckinDraft()`，网络抖动失败后草稿被清，用户被迫返回重走整个流程。
- **修复**：仅在成功时清除草稿，catch 块移除 clearTodayCheckinDraft。

### P1-9. 小队"一键完成"乐观更新失败无回滚（上轮已知，仍需修复）

- **位置**：`miniprogram/pages/team/index.ts` 第 863-892 行
- **问题**：`markSelfCompleted` 先本地标记完成，云端失败时 catch 块仅 `setData({ markingComplete: false })`，未回滚本地状态。
- **修复**：try 开头保存原始状态快照，catch 恢复；或先云端成功后再更新本地。

---

## 四、中风险 Bug（P2，迭代修复）

### 云函数侧

| 编号 | 文件 | 行号 | 问题 | 后果 |
|------|------|------|------|------|
| P2-1 | `team.js` | 439-441 | sendEncouragement TOCTOU 竞态（先 get 检查再 set） | 鼓励去重失效，事件流重复 |
| P2-2 | `team.js` | 217,185 | buildTeamPage 读接口并发覆盖 50 个 daily 文档 | 50人小队并发访问云函数超时 |
| P2-3 | `team.js` | 511-526 | reviewTeamJoinRequest 批准失败时 request 卡 pending | 队长无法处理申请，申请者卡死 |
| P2-4 | `team.js` | 423-429 | syncTeamActivity dedupeKey=type 导致 partial→completed 事件重复 | 事件流重复显示 |
| P2-5 | `team.js` | 510 | dissolveTeam 事务内 50 成员更新可能超 60s | 解散失败或部分成功 |
| P2-6 | `team.js` | 138-217 | buildTeamPage 50 人 N+1 查询（250 次） | 云函数超时 |
| P2-7 | `stage-v2.js` | 533-575 | createStagePreview 并发覆盖 generating 状态 | AI 资源浪费，结果不确定 |
| P2-8 | `repository.js` | 102-127 | enforceRateLimit forceFallback 绕过 1 分钟限流 | 可无限次调用 fallback |
| P2-9 | `manual-sync.js` | 155-166 | persistCollectionChanges 部分成功部分失败 | 数据部分同步，不一致 |
| P2-10 | `manual-sync.js` | 173-190 | 关联校验整批拒绝（1 个无效致 99 个有效被拒） | 用户无法同步任何数据 |
| P2-11 | `checkin.js` | 184-193 | completionRate 分子分母不一致 | 统计偏差 |
| P2-12 | `checkin.js` | 137,215-235 | streakDays 跨目标延续 + 不自动衰减 | 连续天数语义错乱 |
| P2-13 | `notification.js` | 1066 | requestId 截断到 100 字符可能冲突 | 通知被误判重复跳过 |
| P2-14 | `progress-coach.js` | 560-565 | storageKey 依赖 analysisDate，跨日提问失效 | 每天首次提问需重新 prepare |
| P2-15 | `manual-sync.js` | 318-337 | executeCoachAction reconciled 绕过过期校验 | proposal 状态不准确 |
| P2-16 | `goal-analysis.js` | 414-431 | update 失败不重试，卡 analyzing 24h | 用户 24h 内无法用目标分析 |
| P2-17 | `stage-generation.js` | 137-150 | AI 超时后同 requestId 永远卡住 | 用户无法用同 requestId 重试 |

### 前端侧

| 编号 | 文件 | 行号 | 问题 | 后果 |
|------|------|------|------|------|
| P2-18 | `services/manualSync.ts` | 77-91 | syncManualData 响应合并后未刷新页面依赖数据 | 页面显示旧数据 |
| P2-19 | `services/team.ts` | 251-253 | persistTeam 开发态 mock 函数残留正式构建 | 审核质疑 |
| P2-20 | `pages/index/index.ts` | 344-351 | onShow 每次触发 syncManualData 无节流 | 频繁云函数调用 |
| P2-21 | `pages/profile/index.ts` | 208-219 | onShow 每次触发 bootstrapAccount 强制刷新 | 频繁云函数调用 |

---

## 五、低风险 Bug（P3，技术债务）

| 编号 | 位置 | 问题 |
|------|------|------|
| P3-1 | `cloudfunctions/generatePlan/team.js` 267-298 | createTeam 用 randomRoomCode 而非已定义的 uniqueRoomCode（功能正常，性能略差） |
| P3-2 | `cloudfunctions/generatePlan/validate.js` 38-43 | deadline 仅校验格式不校验有效性（2026-02-30 通过） |
| P3-3 | `cloudfunctions/generatePlan/home.js` 377-386 | normalizeManualTask taskDate/estimatedMinutes 校验不严 |
| P3-4 | `cloudfunctions/generatePlan/team.js` 404 | updateTeamSettings 校验风格不一致（无功能影响） |
| P3-5 | `cloudfunctions/generatePlan/stage-v2.js` 1001-1014 | validateTaskUpdate 上限与 AI 生成不一致 |
| P3-6 | `cloudfunctions/generatePlan/team.js` 533-536 | firstTask.currentDate 为空回退今天 |
| P3-7 | `miniprogram/pages/plan-preview/index.ts` 559-563 | 轮询达上限无用户提示 |
| P3-8 | `miniprogram/pages/goal-create/index.ts` 45-56 | 提交成功后未重置 submitting（上轮已知） |

---

## 六、上线前必修清单（按优先级）

### 必须立即修复（P0）

1. **P0-1**：`date.js` 的 `TEST_REVIEW_OFFSET_DAYS` 改回 0（1 行代码）
2. **P0-2**：checkin/stage-management/repository 统一用 `resolveAccount(openid).userId`
3. **P0-3**：where().remove() 改为 while 循环分页删除
4. **P0-4**：deleteUserData 补充清理 v2 team_members（或废弃该 action）
5. **P0-5**：删除 displayTaskTitle 函数，直接用 task.title

### 上线前尽量修复（P1）

6. **P1-1**：getHomeData 顺延逻辑移出读接口
7. **P1-2**：submitStageReview 三次写入包进事务
8. **P1-3**：shouldReplace 时间戳相等时优先未删除版本
9. **P1-4**：deleteCurrentPlan 级联删除加事务
10. **P1-5**：scheduleCloudPersist 合并云端返回数据
11. **P1-6**：本地操作后同步取消云端订阅提醒
12. **P1-7**：decodeURIComponent 加 try/catch
13. **P1-8**：打卡失败不清空草稿（上轮已知）
14. **P1-9**：小队乐观更新加回滚（上轮已知）

### 第一迭代修复（P2）

15-35. 见第四节表格，建议按"数据一致性 > 业务逻辑 > 性能"顺序处理。

---

## 七、风险分布

```
Bug 等级分布（共 42 项）
P0 严重 ██████████ 5 项（11.9%）   ← 阻塞上线
P1 高   █████████████████ 8 项（19.0%）  ← 上线前尽量修
P2 中   ██████████████████████████████████████ 21 项（50.0%）  ← 迭代修复
P3 低   ████████████████ 8 项（19.0%）  ← 技术债务

按位置分布：
云函数  ████████████████████████████████████████████████ 31 项
前端    █████████████████ 11 项
```

**关键判断**：P0-1（测试常量）和 P0-5（displayTaskTitle）是典型的"开发态遗留进生产"问题，各只需改 1 行代码，但影响面很大，必须立即处理。P0-2/P0-3/P0-4 是 v2 账号体系迁移不彻底的遗留，涉及数据一致性，需系统性修复。
