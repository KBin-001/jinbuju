# 进步局

“进步局”是一款微信原生小程序，帮助年轻人围绕考试、技能学习或求职目标，获得 AI 生成的 7 天执行计划，并通过每日打卡和轻量小队持续行动。

## 技术栈

- 微信原生小程序
- TypeScript / WXML / WXSS
- 腾讯云开发 CloudBase
- 云数据库 / 云函数
- CloudBase AI 或腾讯混元

## 当前进度

当前已完成：

- 首次启动引导页与计划示例预览
- 六步创建目标流程、本地草稿和逐步校验
- AI 生成 7 天计划、预览恢复、重新生成和推荐模板兜底
- 采用计划后保存目标、计划、任务及用户当前目标
- 四个底部 Tab：今日、计划、小队、我的
- 全局主题样式与通用页面状态
- CloudBase 客户端初始化
- TypeScript 编译配置

今日打卡、小队和个人统计仍为后续模块。

## 目录结构

```text
cloudfunctions/          云函数
  generatePlan/          AI 计划生成、校验、兜底和采用
miniprogram/
  config/                客户端配置
  images/                图片与 Tab 图标
  pages/
    goal-create/         六步创建目标
    plan-preview/        7 天计划生成与预览
    index/               今日
    plan/                计划
    team/                小队
    profile/             我的
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

建议索引：

- `goals`：`_openid + status`
- `tasks`：`_openid + taskDate`
- `plan_generation_requests`：`_openid + createdAt`

所有业务写入均由 `generatePlan` 云函数完成。客户端不需要集合写权限。

## AI 配置

`generatePlan` 使用 `@cloudbase/node-sdk >= 3.16.0`，AI 调用只发生在云函数中。

云函数环境变量：

```text
CLOUDBASE_AI_ENABLED=true
CLOUDBASE_AI_MODEL=hy3-preview
CLOUDBASE_ENV=你的云开发环境 ID
```

- 未设置 `CLOUDBASE_AI_ENABLED=true` 时，流程自动使用本地推荐模板。
- `hy3-preview` 是“小程序成长计划”提供免费额度的混元体验模型，不需要额外 API Key。
- `CLOUDBASE_AI_MODEL` 可省略，默认使用 `hy3-preview`。
- 如改用 `deepseek-v4-flash` 等模型，需要另外购买 CloudBase Token 资源包并在控制台开启对应模型。
- 不要在小程序前端、Git 或日志中保存任何 AI 密钥。
- 云函数建议使用 Node.js 18 或更高运行时，并将超时时间设为至少 30 秒。

## 目标与计划流程

1. 用户在六步内完成目标设置。
2. 前端调用 `generatePlan` 的 `generate` 动作。
3. 云函数校验目标、调用 AI、严格校验 JSON；失败时自动返回推荐模板。
4. 预览只在本地保存 24 小时，不写入业务集合。
5. 用户点击“采用这个计划”后，前端调用 `adopt`。
6. 云函数重新校验并使用事务写入 `goals`、`plans`、`tasks` 和 `users.currentGoalId`。
7. 同一 `requestId` 重复采用不会重复创建数据；已有 active 目标时拒绝新建。

## 测试

云函数模板与校验测试：

```powershell
cd cloudfunctions/generatePlan
npm test
```

微信开发者工具正常流程：

1. 清除缓存并重新编译。
2. 点击“开始制定计划”。
3. 完成六步表单并生成计划。
4. 检查 7 天日期、学习日数量、每日任务和时间。
5. 点击“采用这个计划”，确认跳转今日页。
6. 在数据库核对目标、计划、任务和用户当前目标。

兜底流程：

1. 将 `CLOUDBASE_AI_ENABLED` 删除或设为 `false`。
2. 重新生成计划。
3. 页面应显示推荐计划提示，仍可正常采用和保存。

本地缓存：

- `GOAL_DRAFT_V1`：未完成的目标草稿。
- `PLAN_PREVIEW_V1`：校验后的计划预览，24 小时过期。

## 开发原则

- AI 调用只允许通过云函数发起，前端不得保存密钥。
- AI 响应必须采用固定 JSON 结构并进行运行时校验。
- 数据库写操作必须在云函数中校验当前用户身份。
- 所有页面必须覆盖加载、空数据、失败和重试状态。
- V1 仅支持一个进行中的目标。

## 尚未实现

- 今日任务读取与打卡
- 连续打卡统计
- 小队和固定鼓励
- 社群入口、隐私政策与数据删除
