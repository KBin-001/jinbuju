# 订阅通知 MVP 部署清单

客户端已写入 2026-07-17 在微信公众平台添加的三个真实模板。云端仍默认失败关闭；未完成环境变量、数据库和灰度配置时不会发送订阅消息。

## 1. 模板与服务类目

微信公众平台已确认 `工具 > 备忘录` 与 `工具 > 办公` 服务类目，并添加三个一次性订阅模板：

- N1 每日记录提醒：模板 `4MFayQvC3ZykJyFFirrIlcDjnrFDDe34F4F9XvdFltU`；`goalName=thing1`、`actionCount=thing2`、`date=date3`、`hint=thing4`。
- N2 报告生成通知：模板 `saJM8i1xbgv_oH6uTevI08_8F8u_1lFyLvvhxNEPLW8`；`detailText=thing1`、`date=time2`、`adviceSummary=thing3`、`goalName=thing5`。
- N3 打卡提醒：模板 `JVY6kbiobOrSxkFWn1mG075SL6axUA3Hz9ymABKXtP8`；`memberName=thing13`、`actionName=thing6`、`teamName=thing22`、`completedAt=date2`。

上述模板 ID 与服务类目确认状态已同步写入 `miniprogram/config/notification.ts`。还需配置：

- `generatePlan` 云函数环境变量：
  - 通用：`NOTIFICATION_ENABLED=true`、`NOTIFICATION_SERVICE_CATEGORY_CONFIRMED=true`、`NOTIFICATION_CONFIG_VERSION`、`NOTIFICATION_MINIPROGRAM_STATE`。
  - N1：`NOTIFICATION_TEMPLATE_DAILY_ACTION=4MFayQvC3ZykJyFFirrIlcDjnrFDDe34F4F9XvdFltU`、`NOTIFICATION_N1_KEY_DATE=date3`、`NOTIFICATION_N1_KEY_ACTION_COUNT=thing2`、`NOTIFICATION_N1_KEY_GOAL_NAME=thing1`、`NOTIFICATION_N1_KEY_HINT=thing4`。
  - N2：`NOTIFICATION_TEMPLATE_AI_COACH=saJM8i1xbgv_oH6uTevI08_8F8u_1lFyLvvhxNEPLW8`、`NOTIFICATION_N2_KEY_DATE=time2`、`NOTIFICATION_N2_KEY_ADVICE=thing3`、`NOTIFICATION_N2_KEY_GOAL_NAME=thing5`、`NOTIFICATION_N2_KEY_DETAIL=thing1`。
  - N3：`NOTIFICATION_TEMPLATE_TEAM_ACTIVITY=JVY6kbiobOrSxkFWn1mG075SL6axUA3Hz9ymABKXtP8`、`NOTIFICATION_N3_KEY_MEMBER_NAME=thing13`、`NOTIFICATION_N3_KEY_ACTION_NAME=thing6`、`NOTIFICATION_N3_KEY_TEAM_NAME=thing22`、`NOTIFICATION_N3_KEY_COMPLETED_AT=date2`。

`NOTIFICATION_MINIPROGRAM_STATE` 只允许 `developer`、`trial`、`formal`。模板版本或关键词发生变化时必须更新 `NOTIFICATION_CONFIG_VERSION`，以隔离旧版本熔断记录。

## 2. 数据库与权限

创建并限制为仅云函数可读写的集合：

- `subscription_ledger`
- `notification_preference`
- `notification_sent_log`
- `in_app_messages`

建议建立以下复合索引：

- `subscription_ledger`：`scene + templateId + status + quota + expireAt + authorizedAt`
- `subscription_ledger`：`status + retentionExpireAt`
- `notification_sent_log`：`_openid + scene + status + sentAt`
- `notification_sent_log`：`_openid + status + sentAt`
- `notification_sent_log`：`_openid + scene + actorUserId + status + sentAt`
- `notification_sent_log`：`templateId + configVersion + terminalConfigError`
- `in_app_messages`：`_openid + status + expireAt + createdAt`

客户端不得直接访问这些集合；所有身份归属均由 `generatePlan` 从可信微信上下文取得。通知不再设置用户灰度门槛，用户只需在业务页面主动触发微信订阅授权；`grayEnabled` 仅为兼容旧数据保留，不参与发送判断。

## 3. 云函数部署顺序

1. 上传并部署 `generatePlan`，确认 `subscribeMessage.send` 云调用权限生效。
2. 上传并部署 `notificationScheduler`，只保留一个 Cron：`0 0 8,12 * * * *`（UTC+8）。
3. 在体验版使用测试用户验证 N1 08:00、N2 12:00 与 N3 状态转换。
4. 核验模板跳转页、匿名小队文案、静默期站内消息以及 `developer/trial/formal` 切换后再扩大灰度。

定时触发可能重复执行，不能移除确定性请求 ID、发送日志抢占或额度事务。不要从客户端新增任意发送接口。
