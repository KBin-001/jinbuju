# AGENTS.md

## 项目目标

这是微信原生小程序 **“进步局”**。

产品定位：

> 帮助用户把长期目标变成每天可以完成的小行动，通过 AI 拆解、每日行动、打卡反馈、阶段复盘和轻量陪伴持续推进。

V1 聚焦以下核心闭环：

1. 用户创建一个长期成长目标。
2. AI 先理解目标，必要时动态澄清关键信息。
3. 系统形成可信的 `GoalProfile`。
4. AI 根据 `GoalProfile` 生成当前行动阶段。
5. V1 默认阶段周期为 7 天，但数据结构不得写死为只能 7 天。
6. 用户预览 AI 行动方案。
7. 用户可以反馈方案问题，并让 AI 完整重新生成阶段。
8. 用户确认阶段后进入今日行动。
9. 用户每天完成行动并记录打卡。
10. 系统反馈连续行动天数、阶段完成率和近 7 天行动情况。
11. 阶段结束后进入阶段复盘。
12. 用户可加入 3～5 人轻量小队，查看必要的成员进度并发送固定鼓励。
13. 达到指定条件后展示社群入口。

开发时优先保证：

* 核心流程完整
* 数据安全
* AI 生成质量
* 页面可用
* 可测试
* 可上线

不得为了展示效果增加与 V1 主闭环无关的复杂功能。

---

## 产品语义约定

本项目不是单纯的：

```text
AI 生成 7 天计划的小程序
```

而是：

```text
长期目标行动工具
```

正确产品链路是：

```text
长期目标
→ AI 目标理解
→ 必要时动态澄清
→ GoalProfile
→ 当前行动阶段
→ 今日行动
→ 每日打卡
→ 阶段进度
→ 阶段复盘
→ 下一阶段
```

页面和代码中应优先使用以下语义：

```text
长期目标
当前阶段
本周重点
今日行动
行动进度
阶段复盘
下一阶段
行动记录
```

避免继续强化以下旧语义：

```text
AI 7 天计划
我的 7 天计划
计划任务
第几天 / 共 7 天
重新生成 7 天计划
```

允许 V1 默认阶段为 7 天，但必须使用：

```ts
durationDays: number
```

不得在新逻辑中写死：

```ts
totalDays: 7
```

---

## 技术栈

* 微信原生小程序
* TypeScript
* WXML
* WXSS
* 微信云开发 CloudBase
* 云数据库
* 云函数
* 云存储
* AI 模型通过云函数调用

优先使用微信和 CloudBase 原生能力。

新增依赖前必须说明：

* 依赖用途
* 是否可以使用原生能力替代
* 对包体积的影响
* 是否需要构建 npm
* 是否会影响微信基础库兼容性
* 是否需要额外维护

---

## 项目检查

修改代码前必须先检查：

1. 当前 Git 状态。
2. 当前目录结构。
3. `project.config.json` 中的 `miniprogramRoot` 和 `cloudfunctionRoot`。
4. 当前基础库版本。
5. 当前是否启用 npm 构建。
6. 已存在的页面、组件、工具函数和全局样式。
7. 是否存在其他开发者尚未提交的修改。

不得覆盖、删除或回退其他开发者的未提交修改。

不得擅自修改：

* 小程序 AppID
* CloudBase 环境 ID
* `project.private.config.json`
* 用户本地开发工具配置
* 线上环境变量
* AI 密钥
* 云开发计费配置

确实需要修改项目配置时，必须先说明原因和影响范围。

---

## V1 功能范围

### 必须实现

* 用户初始化
* 创建单个长期目标
* 编辑当前目标的基础信息
* AI 目标分析
* 必要时动态澄清目标信息
* 形成服务端可信 `GoalProfile`
* AI 生成当前行动阶段
* 阶段预览
* 用户反馈方案问题
* AI 根据反馈完整重新生成阶段方案
* AI 计划确认与保存
* 今日行动展示
* 行动完成状态
* 每日打卡
* 连续行动天数
* 本周或当前阶段完成进度
* 进度页
* 阶段复盘入口
* 3～5 人小队
* 小队成员必要进度展示
* 固定鼓励文案
* 社群二维码入口
* 个人数据统计
* 隐私政策
* 用户协议
* 用户数据删除
* 加载、空数据、失败和重试状态
* 上线前 UI 统一和视觉升级

### 禁止实现

* 私聊
* 实时聊天
* 评论区
* 用户自定义聊天内容
* 同城定位
* 附近的人
* 图片动态
* 公开广场
* 课程商城
* 支付功能
* 会员系统
* 多目标并行
* 无限 AI 对话
* 复杂管理后台
* 与 V1 核心闭环无关的功能

发现需求超出 V1 范围时，不直接实现，应在结果中标记为后续版本建议。

---

## 页面职责

页面只负责：

* 数据展示
* 用户交互
* 页面状态管理
* 调用 service 层
* 展示加载、空状态、失败状态和重试入口

页面中不得直接编写：

* 数据库写入逻辑
* OPENID 判断逻辑
* AI 请求逻辑
* 密钥读取逻辑
* 复杂业务规则
* 可被 service 或云函数复用的业务代码

---

## 目录约定

* `miniprogram/pages`：页面，只处理展示和交互。
* `miniprogram/components`：可复用组件。
* `miniprogram/components/ui`：本地 UI Kit 组件。
* `miniprogram/config`：无密钥的客户端配置。
* `miniprogram/services`：云函数调用和客户端数据访问封装。
* `miniprogram/types`：公共 TypeScript 类型。
* `miniprogram/utils`：无业务状态的通用工具。
* `miniprogram/assets`：本地静态资源。
* `cloudfunctions`：可信业务逻辑、身份校验、数据库写入和 AI 调用。
* `cloudfunctions/shared/ai`：AI Provider、Prompt、Schema、校验、质量检查和降级逻辑。
* `docs`：数据结构、接口约定和测试说明。

不要在多个页面中重复实现相同的云函数调用和数据转换逻辑。

---

## TypeScript 约定

* 优先使用明确类型，不滥用 `any`。
* 云函数请求参数和返回结果必须定义类型。
* AI JSON 输出必须定义对应 TypeScript 类型。
* 公共业务类型放在统一类型文件中。
* 对可能为空的字段进行显式判断。
* 不使用未经判断的类型断言绕过错误。
* 异步调用必须处理成功、失败和超时情况。
* 不静默吞掉异常。

错误信息应区分：

* 用户输入错误
* 网络错误
* 云函数错误
* 权限错误
* AI 生成错误
* 数据不存在
* 系统内部错误

用户界面不得直接显示完整堆栈或内部异常信息。

---

## 数据库与身份安全

客户端只提交业务输入，不提交可信身份字段。

以下字段不得由客户端决定：

* `openid`
* `userId`
* `ownerId`
* `creatorId`
* `memberId`
* `createdAt`
* `updatedAt`
* 连续打卡天数
* 累计完成数量
* 小队成员身份
* 权限角色
* `GoalProfile`
* 当前预览版本
* AI 生成来源
* 重新生成次数
* 阶段完成率
* 统计数据

云函数必须通过：

```ts
const wxContext = cloud.getWXContext()
```

获取并校验调用者身份。

所有数据库写操作必须经过云函数。

客户端不得直接执行以下操作：

* 新增业务数据
* 修改业务数据
* 删除业务数据
* 更新统计数据
* 更新权限字段
* 更新小队成员关系
* 更新 AI 生成结果
* 更新阶段版本

集合权限遵循最小权限原则。敏感集合不允许客户端直接写入。

---

## 时间约定

数据库时间字段统一使用数据库服务端时间，例如：

```ts
db.serverDate()
```

不得使用客户端时间作为可信时间。

所有时间记录至少包含：

* `createdAt`
* `updatedAt`

业务日期统一按 `Asia/Shanghai` 计算。

每日打卡、连续天数和今日任务判断，必须基于统一生成的业务日期，例如：

```text
2026-06-14
```

不得仅依赖客户端本地日期，避免用户修改设备时间导致连续打卡计算错误。

---

## 幂等性约定

以下操作必须防止重复提交：

* 用户初始化
* 创建目标
* AI 目标分析
* 提交澄清答案
* AI 阶段生成
* AI 阶段重新生成
* AI 计划保存
* 每日打卡
* 加入小队
* 发送固定鼓励
* 删除用户数据

同一用户在同一业务日期只能存在一条有效打卡记录。

重复点击打卡按钮时，不得：

* 重复增加连续天数
* 重复增加统计数量
* 创建多条当天打卡记录

必要时使用唯一业务键、事务或云函数中的重复检查实现幂等。

按钮提交期间必须禁用重复点击。

---

## AI 调用约定

前端不得保存 AI 密钥。

前端不得直接调用需要密钥的 AI 接口。

所有 AI 请求必须经过云函数。

AI 密钥只能通过云函数环境变量读取，不得写入：

* 小程序代码
* Git 仓库
* 配置文件
* 日志
* 错误信息
* 返回给客户端的响应

AI 输入只包含生成计划所需要的最少数据。

AI 必须返回固定 JSON 结构，不接受自由文本直接写入数据库。

不得将模型能力限制为固定考试、考研、公务员或学习类目标。

AI 应支持开放目标，例如：

* 技能学习
* 考试提升
* 项目完成
* 求职准备
* 阅读写作
* 健康运动
* 习惯养成
* 创作输出
* 其他安全合法目标

限制的是：

```text
输出结构
安全边界
时间预算
每日行动数量
完成标准
Schema
```

不限制的是：

```text
目标领域
行动形式
阶段重点
任务类型
```

---

## AI 主链路

正确链路：

```text
analyzeGoal
→ 必要时 submitGoalClarification
→ GoalProfile
→ createStagePreview
→ AI 直接生成完整阶段
→ Schema 校验
→ 质量检查
→ 必要时修复一次
→ 阶段预览
→ 用户反馈
→ regenerateStagePreview
→ AI 完整重新生成
→ 再次校验
→ 用户确认
→ 保存正式阶段和今日行动
```

禁止新逻辑继续采用：

```text
模板生成
→ AI 润色 title / description / estimatedMinutes
```

模板只能作为 AI 连续失败后的兜底方案。

如果使用模板降级，必须记录：

```ts
generatedBy: 'template'
```

不得伪装成 AI 生成。

---

## GoalProfile 约定

服务端应形成可信 `GoalProfile`。

建议结构：

```ts
type GoalProfile = {
  title: string
  description: string
  desiredOutcome: string
  categoryGroup:
    | 'learning'
    | 'career'
    | 'health'
    | 'habit'
    | 'creative'
    | 'project'
    | 'life'
    | 'other'
  domainLabel: string
  goalType: 'skill' | 'habit' | 'outcome' | 'project'
  currentLevel: string
  targetHorizon: string
  dailyMinutes: number
  weeklyFrequency: number
  constraints: string[]
  availableResources: string[]
  preferences: string[]
  safetyContext: {
    riskLevel: 'low' | 'moderate' | 'high'
    requiresProfessionalGuidance: boolean
    boundaries: string[]
  }
}
```

`GoalProfile` 必须由服务端根据以下内容形成：

```text
原始用户输入
+ 已有表单字段
+ AI 目标分析
+ 用户澄清答案
```

客户端不得直接决定最终 `GoalProfile`。

---

## AI 阶段输出结构

建议结构：

```ts
type GeneratedAction = {
  title: string
  actionType:
    | 'practice'
    | 'learning'
    | 'preparation'
    | 'reflection'
    | 'recovery'
    | 'creation'
    | 'execution'
  description: string
  completionCriteria: string
  estimatedMinutes: number
  requiredResources: string[]
  safetyNotes: string[]
}

type GeneratedStagePlan = {
  stage: {
    title: string
    objective: string
    focus: string
    durationDays: number
    successMetrics: string[]
    assumptions: string[]
  }
  days: Array<{
    dayIndex: number
    theme: string
    isRestDay: boolean
    actions: GeneratedAction[]
  }>
}
```

云函数必须校验：

* 是否为合法 JSON
* 是否包含指定 `durationDays`
* `dayIndex` 是否连续
* 每天是否至少包含一个行动
* 行动标题是否为空
* 执行说明是否为空
* 完成标准是否为空
* 预计时间是否处于合理范围
* 每日总时间是否明显超出用户可投入时间
* 字符串长度是否超过限制
* 是否包含不允许字段
* 是否包含异常或不安全内容
* 是否大量重复
* 实践型目标是否被错误生成成纯阅读笔记

AI 调用必须具备：

* 超时处理
* 有限次数重试
* JSON 解析失败处理
* Schema 校验失败处理
* 质量检查
* 必要时 AI 修复一次
* 友好的客户端错误提示
* 模板降级方案

AI 失败后不得保存不完整计划。

---

## AI 重新生成约定

用户在阶段预览页反馈方案问题后，系统必须通过 `regenerateStagePreview` 完整重新生成阶段方案。

反馈类型建议：

```ts
type StageFeedbackType =
  | 'too_many_tasks'
  | 'too_few_tasks'
  | 'too_difficult'
  | 'too_easy'
  | 'too_theoretical'
  | 'not_enough_practice'
  | 'time_unreasonable'
  | 'resource_unavailable'
  | 'direction_mismatch'
  | 'too_repetitive'
  | 'other'
```

重新生成必须允许 AI 调整：

* 阶段标题
* 阶段目标
* 阶段重点
* 每天主题
* 每天行动数量
* 行动类型
* 时间分配
* 完成标准
* 所需资源
* 安全提示

不得只是修改旧任务的：

```text
title
description
estimatedMinutes
```

重新生成必须经过：

```text
JSON 解析
→ Schema 校验
→ 通用质量检查
→ 反馈解决检查
→ 必要时 AI 修复一次
```

每个阶段预览 V1 最多完整重新生成 2 次。

重新生成次数由服务端控制，客户端不可绕过。

重新生成失败时：

* 不删除当前可用预览
* 不覆盖当前版本
* 不创建正式阶段
* 页面继续展示旧方案
* 显示友好错误提示

---

## 云函数返回格式

云函数返回结构尽量保持统一：

```ts
type CloudFunctionResult<T> = {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}
```

客户端根据 `success` 判断结果，不依赖错误字符串做业务判断。

错误码应稳定、可识别，例如：

* `INVALID_ARGUMENT`
* `UNAUTHORIZED`
* `GOAL_ALREADY_EXISTS`
* `GOAL_NOT_FOUND`
* `PLAN_GENERATION_FAILED`
* `PLAN_SCHEMA_INVALID`
* `CHECKIN_ALREADY_EXISTS`
* `TEAM_FULL`
* `TEAM_NOT_FOUND`
* `NOT_TEAM_MEMBER`
* `RATE_LIMITED`
* `PREVIEW_NOT_FOUND`
* `PREVIEW_EXPIRED`
* `PREVIEW_ALREADY_CONFIRMED`
* `PREVIEW_REGENERATION_IN_PROGRESS`
* `STAGE_REGENERATION_LIMIT_REACHED`
* `PREVIEW_VERSION_MISMATCH`
* `INTERNAL_ERROR`

不得将数据库异常、AI 服务原始错误或完整堆栈直接返回客户端。

---

## 日志约定

日志不得记录：

* AI 密钥
* 完整 OPENID
* 手机号
* 完整用户隐私数据
* AI 输入全文
* 社群二维码原始存储地址
* 云开发环境密钥
* 数据库完整记录
* 完整 Prompt
* 完整 AI 原始返回

日志只记录排查问题所需的最少字段，例如：

* 请求类型
* 脱敏用户标识
* 请求结果
* 错误码
* 请求耗时
* AI 调用是否降级
* AI 使用模型
* Prompt 版本
* Schema 版本
* 业务日期

生产环境不得保留无意义的调试日志。

---

## 数据删除

用户发起数据删除后，需要覆盖：

* 用户资料
* 当前目标
* AI 目标分析草稿
* AI 生成阶段预览
* AI 生成计划
* 任务记录
* 打卡记录
* 统计数据
* 小队成员关系
* 固定鼓励记录
* 社群入口访问状态
* 与用户直接关联的其他业务数据

删除前必须验证当前调用者身份。

删除操作必须防止重复执行，并正确处理部分数据不存在的情况。

确实需要保留删除审计记录时，只允许保存最少必要信息，例如：

* 删除操作时间
* 删除结果
* 匿名操作编号
* 错误码

审计记录不得保留：

* OPENID
* 用户昵称
* 头像
* 目标内容
* AI 输入
* 打卡内容
* 可重新识别用户身份的数据

删除完成后，客户端应清理本地缓存并回到初始化状态。

---

## UI 约定

V1 上线前必须完成整体 UI 统一。

产品视觉方向：

```text
年轻
干净
高级
柔和
成长感
行动感
AI 轻陪伴
低压力
不土炮
```

基础色：

* 主色：`#356859`
* 背景色：`#F5F7F2`

建议扩展色：

```text
#1F4D42  深绿色
#DCEBE4  柔和绿色
#EFF7F2  浅绿色背景
#FFF8EC  暖白背景
#8BBF72  成长绿
#F3C76A  暖黄色
#F28C7E  珊瑚色
#7BA7C9  柔和蓝
#1F2D2A  主文本
#66736F  次文本
#9AA6A1  弱文本
```

新 UI 应统一：

* 页面背景
* 卡片
* 按钮
* 标签
* 进度条
* 空状态
* 加载状态
* 错误状态
* 弹窗
* 底部操作栏

不得只依靠颜色传递关键状态。

关键状态同时使用文字、图标或形状表达。

按钮需要明确显示：

* 正常
* 按下
* 禁用
* 加载

页面需要适配常见手机屏幕和安全区域。

长文本需要处理换行、截断或展开。

空数据页面必须提供明确下一步操作。

---

## UI 框架与组件约定

允许参考 Ant Design Mini 设计语言。

如果真实接入 `antd-mini`，必须先说明：

* 是否启用 npm 构建
* 当前基础库是否兼容
* 是否会影响包体积
* 需要引入哪些组件
* 是否有微信端适配风险

如果因基础库、`component2`、npm 构建或包体积原因无法安全接入 `antd-mini`，不得停止 UI 任务。

必须创建本地 Ant Design Mini 风格 UI Kit，例如：

```text
miniprogram/components/ui/am-button
miniprogram/components/ui/am-card
miniprogram/components/ui/am-tag
miniprogram/components/ui/am-progress
miniprogram/components/ui/am-empty
miniprogram/components/ui/am-loading
miniprogram/components/ui/am-action-card
miniprogram/components/ui/am-feedback-panel
```

如果不安装 `antd-mini`，必须通过本地组件和 WXSS 做出明显 UI 变化。

不得再次只输出兼容性评估而不改页面。

UI 改造至少覆盖以下页面：

1. 今日页
2. 阶段预览页
3. 目标创建页
4. 打卡页
5. 进度页

今日页应从普通任务列表升级成：

```text
今日行动驾驶舱
```

阶段预览页应体现：

```text
AI 行动方案预览
```

目标创建页应体现：

```text
创建长期目标
```

打卡页应体现：

```text
记录今日行动
```

进度页应体现：

```text
成长档案
```

---

## 页面状态

所有涉及异步数据的页面必须明确处理：

1. 初始加载状态
2. 加载成功状态
3. 空数据状态
4. 网络失败状态
5. 云函数失败状态
6. 权限失败状态
7. 重试状态
8. 提交中的防重复状态

不得让页面在请求失败后长期保持空白。

---

## 小队约定

小队是轻量陪跑，不是社交平台。

允许展示：

* 昵称
* 头像
* 今日是否完成
* 连续行动天数
* 本周完成率
* 固定鼓励次数

允许互动：

```text
今天也要加油
你太稳了
明天继续
一起坚持
```

禁止：

* 私聊
* 自定义评论
* 微信号展示
* 手机号展示
* 地理位置
* 用户搜索
* 排行榜羞辱
* 公开广场

固定鼓励文案不得允许用户输入任意内容，V1 只允许选择预设内容。

---

## 开发流程

1. 修改前检查现有结构和 Git 状态。
2. 开发前说明准备实现的功能、涉及文件和验证方法。
3. 每次只实现一个功能模块。
4. 不顺手重构无关代码。
5. 优先复用已有组件、样式和工具函数。
6. 修改数据结构时同步更新类型和文档。
7. 修改云函数接口时同步更新 service 层调用。
8. 完成后运行可执行的项目检查。
9. 检查通过后说明修改结果。
10. 不自动提交、不自动推送、不自动发布，除非用户明确要求。

---

## 完成标准

一个功能模块只有同时满足以下条件才算完成：

* 核心正常流程可用
* 输入参数经过校验
* 身份权限经过校验
* 重复提交得到处理
* 加载状态已实现
* 空数据状态已实现
* 失败状态已实现
* 重试入口已实现
* TypeScript 无明显类型错误
* 没有在前端暴露密钥
* 没有绕过云函数直接写数据库
* 没有修改无关文件
* 提供明确测试步骤

UI 模块只有同时满足以下条件才算完成：

* 至少 5 个核心页面有明显视觉变化
* 页面不能和修改前几乎一样
* 全局背景、卡片、按钮、标签、进度条统一
* 今日页有主视觉
* 阶段预览页有 AI 方案质感
* 目标创建页不再像普通表单
* 打卡页有行动记录感
* 进度页有成长档案感
* 不破坏已有业务逻辑
* 不出现页面白屏

---

## 测试要求

完成模块后至少验证：

### 正常场景

* 用户可以完成预期操作。
* 数据正确保存。
* 页面刷新后数据仍然正确。
* 返回上一页后状态正确。

### 异常场景

* 参数为空
* 参数格式错误
* 网络失败
* 云函数失败
* AI 返回非法 JSON
* AI 请求超时
* 数据不存在
* 重复点击
* 重复打卡
* 重复加入小队
* 小队人数已满
* 非小队成员访问小队详情
* 用户删除数据后重新进入

### 边界场景

* 超长目标名称
* 任务数量异常
* 连续跨天
* 月末跨天
* 用户修改设备时间
* AI 返回少于或多于阶段天数
* 云函数返回空数据
* 用户中途退出页面
* 旧数据缺少新增字段

---

## 每次任务完成后的输出格式

完成开发任务后必须说明：

### 修改文件

列出新增和修改的文件。

### 实现内容

说明实现了哪些功能和业务规则。

### 安全处理

说明身份校验、参数校验、权限控制和敏感信息处理方式。

### UI 处理

如果涉及 UI，说明：

* 是否接入第三方组件库
* 是否创建本地 UI Kit
* 改造了哪些页面
* 页面视觉变化
* 旧业务逻辑是否保留

### 测试方法

提供可以在微信开发者工具中执行的具体测试步骤。

### 检查结果

说明已运行哪些检查，以及检查是否通过。

### 已知问题

明确列出尚未解决的问题、限制和后续建议。

不得声称已经测试实际未执行的流程。
