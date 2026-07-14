# 个人中心、账号与数据重构说明

## 1. 信息架构

- `我的`：真实身份与同步状态、这一程、当前目标、成长摘要、成长收藏、常用管理。
- `账号与安全`：展示标识、可选手机号绑定与解绑、数据管理入口。
- `数据与同步`：同步状态、最近成功时间、云端数据概览、手动同步、清缓存并恢复。
- `历史目标`：完成/终止/归档筛选、按年分组、最近删除、恢复、二次确认彻底删除。
- `隐私与协议`：当前版本和同意状态、个人信息与第三方清单、撤回可选手机号同意。
- `数据管理`：清设备缓存、删除成长数据、注销账号三类操作分离。

`这一程` 的加入天数来自云端 `users.createdAt/joinedAt`，回退到最早目标创建日；圆环来自当前目标真实完成率，没有当前目标时显示 0 和明确引导，不使用固定演示进度。

## 2. 云端与缓存数据流

```text
页面 -> account/manual/privacy service -> generatePlan 云函数 -> CloudBase 集合
          ^                                      |
          |--- 最近成功快照/失败重试缓存 <--------|
```

- 云端成功结果写入运行时状态与最近成功快照。
- 离线时允许读取最近成功快照，并明确标记“当前展示上次同步数据”。
- 本地旧数据仅在云端尚无对应数据时迁移；迁移请求携带 `migration=true`，成功后写入 `migrationVersion`。
- 普通同步只更新 `lastManualSyncAt`，不得冒充旧数据迁移完成。
- 清缓存先移除目标、小队、打卡草稿和临时预览缓存，再强制从云端恢复；恢复失败时明确告知用户。
- 页面历史写操作仍保留现有本地先写、立即云同步的兼容机制；云失败时只提示“已保存在本机，联网后重试”，不伪装成云端成功。要达到严格的云端唯一写入源，后续需把全部目标变更迁入服务端命令接口。

## 3. 新增云端能力

- `getDataOverview`：返回账号状态、同步时间、迁移版本和各类云端记录数量。
- `clearUserBusinessData`：删除成长业务数据，保留账号、资料、手机号绑定、协议记录和小队关系。
- `deleteCloudAccount`：记录幂等操作状态，删除账号归属数据；失败向客户端返回真实错误。
- `completeOnboarding`：云端记录首次引导完成状态。
- `unbindPhone`：解除可选手机号绑定。
- `getConsentStatus / recordConsent / withdrawConsent`：按类型与版本记录主动同意或撤回。

手机号绑定使用用户点击产生的 `getPhoneNumber` code，仅在云函数调用微信 OpenAPI；绑定集合只保存稳定哈希和用户关系，客户端只取得脱敏号码。

## 4. 集合与建议索引

新增/纳入初始化：

- `user_consents`：`userId, type, version, agreed, agreedAt, withdrawnAt, source, contentHash`。
- `account_operations`：`userId, operationType, status, requestedAt, completedAt, errorCode`。
- `manual_archived_goals`、`achievement_unlocks`、`spark_checkins` 纳入必需集合检查。

建议在 CloudBase 控制台创建：

1. `user_consents`: `userId + type + version` 唯一组合索引。
2. `account_operations`: `userId + operationType + requestedAt` 组合索引。
3. `manual_tasks`: `userId + currentDate` 组合索引。
4. `manual_archived_goals`: `userId + archivedAt` 组合索引。
5. `achievement_unlocks`: `userId + achievementKey` 唯一组合索引。

所有私人集合应禁止客户端直接跨用户读写；写操作统一由云函数从 `cloud.getWXContext().OPENID` 解析账号，不接受前端传入 ownerOpenId。

## 5. 删除语义

- 清除设备缓存：不删除云端数据，完成后尝试云端恢复。
- 删除历史目标：先写 `deletedAt` 进入最近删除，可恢复。
- 彻底删除历史目标：二次确认后脱敏为同步墓碑，内容、行动和复盘不可恢复。
- 删除成长数据：删除目标、行动、打卡、AI 快照、成长收藏；保留账号、协议、手机号绑定和小队关系。
- 注销账号：删除账号归属数据和绑定；队长需先转让或解散小队。

## 6. 隐私与协议

候选版本：

- `privacy-1.0-rc.1`
- `terms-1.0-rc.1`
- `phone-1.0-rc.1`

首次进入不默认勾选；用户主动同意后才创建/恢复云端账号并记录版本、来源和服务端时间。手机号有独立用途说明与独立同意记录，拒绝后核心功能继续可用。

官方与权威参考：

- 微信小程序获取手机号前端流程：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html
- 微信服务端获取手机号：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/phonenumber/phonenumber.getPhoneNumber.html
- 微信小程序隐私授权机制：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html
- 《中华人民共和国个人信息保护法》：https://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html
- 《网络数据安全管理条例》：https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm
- App 违法违规收集使用个人信息行为认定方法：https://www.cac.gov.cn/2019-12/27/c_1578986455686625.htm
- 《儿童个人信息网络保护规定》：https://www.cac.gov.cn/2019-08/23/c_1124913903.htm

## 7. 上线前人工配置与未完成项

- 在 CloudBase 创建集合和索引，配置只允许云函数可信访问的安全规则。
- 部署 `generatePlan` 云函数并在测试环境跑首次账号、老用户迁移、换设备、断网、重复提交、删除与注销用例。
- 在微信公众平台按实际接口填写《小程序用户隐私保护指引》，并核验 `getPhoneNumber` 资格与隐私授权配置。
- 确认 CloudBase AI 的实际模型、数据地域、日志和保存期限，补全第三方共享清单。
- 补齐运营主体、联系渠道、协议发布日期、生效日期、数据保存期限、未成年人机制和争议解决条款；当前 `rc.1` 只能作为候选稿。
- 微信开发者工具执行“构建 npm”与真机编译，验证 320/375/430 px、长昵称、系统字体放大、弱网、缓存恢复和安全区。
- 旧/新双集合仍同时存在，暂不删除旧集合；需在生产数据核验后制定独立迁移和退役计划。
