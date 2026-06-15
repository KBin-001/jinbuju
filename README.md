# 进步局

“进步局”是一款长期目标行动和轻量陪跑小程序。用户创建长期目标后，由 AI 分阶段拆解为每天可完成的小行动，并通过每日记录、阶段复盘和轻量小队持续推进。

## 技术栈

- 微信原生小程序
- TypeScript / WXML / WXSS
- 腾讯云开发 CloudBase
- 云数据库 / 云函数
- CloudBase AI 或腾讯混元

## 当前进度

当前已完成：

- 首次启动引导页与长期目标示例
- 四步长期目标创建、本地草稿和逐步校验
- AI 生成第一个行动阶段、服务端预览、有限重新生成和模板兜底
- 阶段确认后事务保存目标、阶段、每日行动及用户当前目标
- 今日行动、记录今日行动、阶段进度、阶段复盘和下一阶段生成
- 四个底部 Tab：今日、进度、小队、我的
- 全局主题样式与通用页面状态
- CloudBase 客户端初始化
- TypeScript 编译配置

## 目录结构

```text
cloudfunctions/          云函数
  generatePlan/          阶段生成、校验、确认、复盘及其他可信业务
miniprogram/
  config/                客户端配置
  images/                图片与 Tab 图标
  pages/
    goal-create/         长期目标创建
    plan-preview/        行动阶段生成与预览
    stage-review/        阶段复盘与下一阶段入口
    index/               今日
    plan/                进度（保留历史目录名）
    team/                小队
    profile/             我的
    legal/               隐私政策与用户协议
    data-management/     用户数据清除
    about/               产品说明
  typings/               项目类型声明
  app.ts                 小程序入口
  app.json               页面与 Tab 配置
  app.wxss               全局主题
project.config.json      微信开发者工具配置
AGENTS.md                项目协作与开发约束
```

## 本地运行

1. 使用微信开发者工具导入本目录。
2. 确认项目 AppID 与实际小程序一致。
3. 在云开发控制台创建或关联环境。
4. 如需指定环境，在 `miniprogram/config/cloud.ts` 填写 `CLOUD_ENV_ID`；留空时使用当前小程序关联的默认环境。
5. 上传并部署 `cloudfunctions/generatePlan`，选择“云端安装依赖”。
6. 点击“编译”，从首次启动页进入目标创建流程。

## 云数据库

云函数首次调用时会幂等创建以下集合，也可以提前在控制台手动创建：

- `users`
- `goals`
- `plans`
- `tasks`
- `plan_generation_requests`
- `checkins`
- `teams`
- `team_members`
- `encouragements`
- `community_config`
- `stage_generation_requests`
- `stage_previews`
- `stage_reviews`

建议索引：

- `goals`：`_openid + status`
- `tasks`：`_openid + taskDate`
- `plan_generation_requests`：`_openid + createdAt`
- `checkins`：`_openid + businessDate`
- `team_members`：`userKey + status`
- `encouragements`：`teamId + receiverUserKey`
- `stage_generation_requests`：`_openid + inputFingerprint + stageNumber + status`
- `stage_generation_requests`：`_openid + createdAt`
- `stage_reviews`：`_openid + stageId`

所有业务写入均由 `generatePlan` 云函数完成。客户端不需要集合写权限。

## AI 配置

`generatePlan` 使用 `@cloudbase/node-sdk >= 3.16.0`，AI 调用只发生在云函数中。

云函数环境变量：

```text
CLOUDBASE_AI_MODEL=hy3-preview
CLOUDBASE_ENV=你的云开发环境 ID
```

- 默认会调用 CloudBase AI；只有显式设置 `CLOUDBASE_AI_ENABLED=false` 时才禁用 AI 并使用推荐模板。
- `hy3-preview` 是“小程序成长计划”提供免费额度的混元体验模型，不需要额外 API Key。
- `CLOUDBASE_AI_MODEL` 可省略，默认使用 `hy3-preview`。
- `CLOUDBASE_AI_PROVIDER` 可省略，默认使用 SDK 推荐的 `cloudbase` 路由。
- 如改用 `deepseek-v4-flash` 等模型，需要另外购买 CloudBase Token 资源包并在控制台开启对应模型。
- 不要在小程序前端、Git 或日志中保存任何 AI 密钥。
- 云函数建议使用 Node.js 18 或更高运行时。
- `generatePlan` 包含 AI 调用，必须在云函数配置中将执行超时设置为 `60 秒`，内存建议 `256 MB` 或以上。

## 长期目标与行动阶段流程

1. 用户填写长期目标、期望结果、每日投入时间和目标周期。
2. 前端调用 `generateStagePlan`，AI 仅在云函数中运行。
3. 云函数校验输入和固定 JSON；失败时自动使用同结构模板。
4. 校验后的预览保存到 `stage_previews`，本地只缓存预览标识和展示数据。
5. 用户确认时仅提交 `previewId`。
6. 云函数事务写入 `goals`、历史集合 `plans`、`tasks` 和 `users.currentGoalId`。
7. 阶段结束后，服务端计算完成率、行动天数和连续天数。
8. 用户提交难度与下一阶段偏好，AI 据此生成下一阶段预览。
9. 下一阶段确认后，旧阶段标记完成，新阶段设为 active，长期目标保持唯一 active。

## 长期目标阶段生成

阶段生成能力复用 `generatePlan` 云函数，通过
`generateStagePlan`、`getStagePreview`、`confirmStagePlan`、
`getStageReview` 和 `submitStageReview` 等 action 完成。

- 输入使用长期目标字段：目标名称、分类、期望结果、每日时间和目标周期。
- 阶段默认 7 天，数据结构同时支持 10 天和 14 天。
- AI 只在云函数中调用，先进行一次正常生成和最多一次格式修复。
- AI 连续失败后使用考试、技能、求职或通用模板降级。
- 所有 AI 输出经过严格字段、长度、天数、行动数量、重复内容和时间校验。
- 生成结果保存到 `stage_previews`，前端确认阶段时只提交 `previewId`。
- 同一请求或页面刷新会复用已有预览；主动重新生成最多允许 2 次。
- 阶段统计和下一阶段上下文由服务端生成，客户端不能提交完成率或连续天数。

相关集合：

- `stage_generation_requests`：阶段生成状态、限流和幂等记录。
- `stage_previews`：24 小时有效的服务端阶段预览。
- `stage_reviews`：服务端统计结果、用户复盘选择和下一阶段预览关联。

`plans` 与 `tasks` 暂时保留为历史集合名称。新业务代码使用
`Stage` 和 `Action` 语义，正式集合迁移不在本模块中自动执行。

## 测试

云函数模板与校验测试：

```powershell
cd cloudfunctions/generatePlan
npm test
```

微信开发者工具正常流程：

1. 清除缓存并重新编译。
2. 点击“创建长期目标”。
3. 完成四步表单并生成第一个行动阶段。
4. 检查阶段标题、重点、每日行动数量和预计时间。
5. 点击“确认开始”，确认跳转今日页。
6. 在数据库核对目标、阶段、每日行动和用户当前目标。
7. 将测试阶段结束日期调整到当前业务日期，进入进度页完成阶段复盘。
8. 检查下一阶段预览，确认后核对旧阶段完成状态和新阶段关联。

兜底流程：

1. 将 `CLOUDBASE_AI_ENABLED` 设为 `false`。
2. 重新生成行动阶段。
3. 页面应显示基础行动方案提示，仍可正常确认和保存。

本地缓存：

- `GOAL_DRAFT_V1`：未完成的目标草稿。
- `PLAN_PREVIEW_V1`：校验后的计划预览，24 小时过期。
- `LONG_TERM_GOAL_DRAFT_V1`：未完成的长期目标草稿。
- `STAGE_PREVIEW_V1`：行动阶段展示缓存，24 小时过期；正式保存仍以服务端预览为准。

## 我的页面与社群配置

“我的”页面通过 `generatePlan` 的 `getProfileData` 动作聚合当前用户的目标、任务、打卡、阶段和小队数据。统计、徽章与社群资格均在云函数中计算，客户端不提交统计值或身份字段。

社群入口使用 `community_config/default` 文档，示例字段：

```json
{
  "status": "active",
  "title": "加入微信陪跑群",
  "description": "扫码加入陪跑群，一起稳步行动。",
  "imageFileId": "cloud://环境/社群二维码文件",
  "minimumCheckinDays": 1,
  "minimumStreakDays": 3,
  "requiresActiveGoal": true
}
```

`imageFileId` 应指向云存储文件，不要在客户端硬编码公开二维码地址。未配置或配置过期时，页面会显示稳定的不可用提示。

数据清除通过 `deleteUserData` 动作执行，按当前 `OPENID` 删除用户资料、目标、计划、任务、打卡、小队关系、鼓励和生成请求，并清理本地缓存。

## 开发原则

- AI 调用只允许通过云函数发起，前端不得保存密钥。
- AI 响应必须采用固定 JSON 结构并进行运行时校验。
- 数据库写操作必须在云函数中校验当前用户身份。
- 所有页面必须覆盖加载、空数据、失败和重试状态。
- V1 仅支持一个进行中的目标。

## V1 暂不实现

- 私聊与实时聊天
- 多目标并行
- 复杂历史目标管理
- 付费与课程商城
