# 进步局

进步局是一款以“现代东方山水”为品牌视觉的微信原生小程序，帮助用户把长期目标持续变成今天能完成的一小步。

核心闭环：

```text
创建目标 → 添加今日行动 → 记录完成状态与实际投入 → 查看成长趋势 → 获得 AI 教练建议 → 与小队伙伴轻量同行
```

## 当前产品能力

- 今日：周历、行动清单、预计/实际投入、完成/部分完成/休息/顺延，以及真实连续行动记录。
- 进度：自然周、自然月和自然年统计，投入趋势、完成趋势、年度热力图、历史目标与成长收藏。
- AI 教练：基于真实行动快照提供每日建议、阶段复盘和问答；不会静默修改行动。
- 小队：真实房间号、最多 50 人、加入审核、行动榜、鼓励、动态、成员隐私与队长管理。
- 我的：真实资料、当前目标、成长摘要、云端同步、数据管理、隐私与账号设置。

AI 自动计划生成目前通过功能开关关闭；创建目标后直接进入手动行动闭环。

## 技术栈

- 微信原生小程序、TypeScript、WXML、WXSS
- TDesign Mini Program 1.15.2
- 腾讯云开发 CloudBase、云数据库、云函数
- CloudBase AI / 腾讯混元（仅云函数调用）

## 目录结构

```text
cloudfunctions/generatePlan/   可信业务、同步、小队与 AI 教练云函数
miniprogram/config/            功能开关与云环境配置
miniprogram/pages/index/       今日
miniprogram/pages/plan/        进度（沿用历史目录名）
miniprogram/pages/team/        小队
miniprogram/pages/profile/     我的
miniprogram/services/          手动目标、行动、统计、同步、小队与教练服务
miniprogram/types/             业务类型
miniprogram/utils/             上海业务日期、状态与通用工具
docs/                          产品与视觉说明
```

## 本地运行

1. 使用微信开发者工具导入项目根目录。
2. 使用项目现有 AppID 与云环境配置；不要把私有配置或密钥提交到 Git。
3. 安装小程序依赖并构建 npm。
4. 编译小程序，先验证本地手动行动闭环。
5. 需要联调 AI 或小队时，由环境负责人将 `cloudfunctions/generatePlan` 部署到测试环境。

本仓库中的实现与测试不会自动部署云函数、写入线上数据库或执行远程 push。

## 关键功能开关

```ts
export const FEATURE_FLAGS = {
  ENABLE_AI_PLANNER: false,
  ENABLE_AI_PROGRESS_COACH: true,
  ENABLE_TEAM: true,
}
```

## 主要云集合

- 手动目标：`manual_goals`、`manual_tasks`、`manual_checkins`、`manual_archived_goals`
- AI 教练：`progress_ai_snapshots`、`coach_action_proposals`
- 小队：`teams`、`team_members`、`team_join_requests`、`team_events`、`encouragements`
- 账号：`users`、`account_bindings`

建议为 `manual_tasks` 的 `userId + currentDate`、`team_members` 的 `teamId + status`、`team_events` 的 `teamId + createdAtMs` 建立组合索引。客户端不提交榜单统计结果，排名和投入由云端读取真实行动计算。

## 验证

```powershell
cd miniprogram
npm exec tsc -- --noEmit

cd ..\cloudfunctions\generatePlan
npm test
```

同时需要在微信开发者工具中完成 npm 构建与编译，并验证 320、375、430 px 宽度、长昵称、长文本、空数据、网络失败和安全区表现。

## 发布边界

- 不包含私聊、排行榜刺激、陌生人社交、付费或课程商城。
- 小队榜只用于当天互相陪伴，文案避免失败、断签和羞辱表达。
- AI 输出必须来自真实快照；本地规则降级必须明确标注为“本地行动建议”。
- 法律页面中的运营主体、联系方式和生效日期需要在正式发布前由运营与法务补齐，代码中不编造。
