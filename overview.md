# Bug 专项复查 - 概览

## 任务
对进步局小程序做上线前 Bug 专项复查，聚焦可复现逻辑 Bug 与运行时崩溃风险，不改代码。

## 交付物
- **主报告**：`docs/Bug复查报告.md`（42 个 Bug，含文件路径、行号、代码片段、复现条件、修复建议）

## 核心发现（共 42 个 Bug）

### P0 严重（5 项，上线必须修复）
1. `date.js` TEST_REVIEW_OFFSET_DAYS=8 未归零 → 复盘入口提前 8 天解锁（1 行修复）
2. v2 userId 不一致，checkin 用 legacy id 写 users 表 → streakDays 写错文档
3. where().remove() 20 条限制 → 级联删除残留孤儿数据
4. deleteUserData 不清理 v2 team_members → 注销后残留小队成员
5. displayTaskTitle 纯数字标题替换示例文案 → 用户看到假标题（1 行修复）

### P1 高（8 项）
- getHomeData 读操作有副作用+竞态（rolloverCount 重复+1）
- submitStageReview 三次写入无事务 → 部分失败死锁
- shouldReplace 时间戳相等无法恢复删除
- deleteCurrentPlan 非事务级联
- scheduleCloudPersist 忽略云端合并响应
- 本地操作后未取消云端订阅提醒
- decodeURIComponent 非法 URI 白屏
- 打卡失败清空草稿 / 小队乐观更新无回滚（上轮已知）

### P2 中（21 项）/ P3 低（8 项）
见主报告第四节、第五节。

## 关键结论
- P0-1 和 P0-5 是"开发态遗留进生产"，各改 1 行代码但影响面大
- P0-2/3/4 是 v2 账号迁移不彻底，需系统性修复
- 云函数侧问题（31个）多于前端（11个），集中在小队和同步逻辑

## 后续建议
优先修 5 个 P0（其中 2 个只需改 1 行），再处理 P1 中的事务/回滚问题。
