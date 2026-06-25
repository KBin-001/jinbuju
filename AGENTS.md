# AGENTS.md

## 1. 项目定位

本项目是微信原生小程序 **进步局**。

当前基础版定位：

> 目标 + 手动行动待办 + 时间记录 + 低压力成长进度。

进步局不是一个单纯的 AI 计划生成器，也不是普通待办清单。
它的核心目标是帮助用户把想做的事持续推进下去。

当前主流程：

```text
创建目标
→ 进入今日行动
→ 手动添加行动
→ 执行并记录状态
→ 记录预计时间 / 实际时间
→ 未完成可顺延
→ 进度页查看成长沉淀
```

核心产品文案：

```text
把想做的事，变成今天能完成的一小步。
```

当前阶段先做可用基础版，不依赖 AI 生成计划。

---

## 2. 当前开发方向

当前优先级：

```text
P0：今日页、进度页、小队页、我的页 UI 重设计
P1：手动行动待办闭环
P2：本地数据统计与顺延逻辑
P3：后续再接入 AI 分析能力
```

目前不要继续主打：

```text
AI 自动生成计划
AI 目标分析
AI 动态追问
AI 重新生成计划
固定 7 天计划
强制阶段复盘
强制下一阶段
```

AI 相关代码可以保留，但基础版默认不调用。

建议使用 feature flag：

```ts
export const FEATURE_FLAGS = {
  ENABLE_AI_PLANNER: false,
  ENABLE_TEAM: true,
}
```

当 `ENABLE_AI_PLANNER = false` 时：

```text
不显示 AI 生成计划入口
不调用 AI 云函数
不进入 AI 计划预览流程
创建目标后直接进入今日页
```

---

## 3. 视觉设计方向

用户已提供《全新升级设计方案》参考图。
后续 UI 开发必须参考该设计语言，但不要机械照抄。

整体视觉关键词：

```text
清晰
克制
柔和
现代
低压力
有成长感
有陪伴感
适合微信小程序
```

必须避免：

```text
Demo 感
后台表单感
强烈红色
杂乱彩色块
过重渐变
廉价游戏化
排行榜刺激
失败羞辱
信息密度过高
大面积粗暴深色块
按钮比例失衡
卡片尺寸不统一
```

---

## 4. 设计系统规范

### 4.1 颜色

主色：

```text
#356859
```

深绿强调色：

```text
#1F5B4A
```

页面背景：

```text
#F5F7F2
```

卡片背景：

```text
#FFFFFF
```

辅助浅绿：

```text
#EAF5EF
```

浅黄点缀：

```text
#F8D26A
```

文字主色：

```text
#233B34
```

文字次色：

```text
#71827A
```

分割线：

```text
#E6EEE9
```

不要大量使用红色。
错误状态也应使用柔和表达，不要制造失败感。

---

### 4.2 字体层级

页面大标题：

```text
40rpx / 48rpx / 700
```

模块标题：

```text
34rpx / 42rpx / 700
```

卡片标题：

```text
30rpx / 40rpx / 700
```

正文：

```text
26rpx / 36rpx / 400
```

辅助文字：

```text
24rpx / 34rpx / 400
```

数字强调：

```text
40rpx～56rpx / 800
```

不要在同一页面里随意混用字号。

---

### 4.3 卡片规范

所有主卡片统一：

```css
.card {
  background: #FFFFFF;
  border-radius: 28rpx;
  padding: 28rpx;
  box-shadow: 0 16rpx 40rpx rgba(31, 70, 58, 0.08);
}
```

页面内容区：

```css
.page-content {
  padding: 24rpx 32rpx 160rpx;
}
```

模块间距：

```text
36rpx
```

卡片间距：

```text
20rpx～24rpx
```

禁止出现：

```text
一页里卡片圆角不统一
一页里卡片宽度忽大忽小
窄卡漂浮在中间
按钮和卡片阴影风格不一致
```

---

### 4.4 按钮规范

主按钮：

```css
.primary-button {
  height: 88rpx;
  border-radius: 44rpx;
  background: #356859;
  color: #FFFFFF;
  font-size: 30rpx;
  font-weight: 700;
}
```

小按钮：

```css
.small-primary-button {
  height: 64rpx;
  padding: 0 32rpx;
  border-radius: 32rpx;
  background: #356859;
  color: #FFFFFF;
  font-size: 26rpx;
  font-weight: 600;
}
```

次按钮：

```css
.secondary-button {
  height: 80rpx;
  border-radius: 40rpx;
  border: 1rpx solid #D7E4DE;
  background: #FFFFFF;
  color: #356859;
}
```

“+ 添加”按钮不要横跨半屏，除非处于空状态主按钮。

---

### 4.5 状态标签

统一状态标签样式：

```css
.status-chip {
  height: 40rpx;
  padding: 0 18rpx;
  border-radius: 20rpx;
  font-size: 22rpx;
  display: inline-flex;
  align-items: center;
}
```

状态文案：

```text
待开始
未到日期
待继续
已完成
完成一部分
今天不做
已顺延
```

状态颜色原则：

```text
待开始：浅绿
已完成：浅绿
完成一部分：浅蓝
待继续：浅黄
未到日期：浅灰
今天不做：浅灰
已顺延：浅黄
```

禁止使用：

```text
失败
落后
拖延
断签
逾期
```

---

## 5. 页面设计规范

当前需要重点重设计四个页面：

```text
今日
进度
小队
我的
```

四个页面必须使用同一套视觉语言。

---

## 6. 今日页设计规范

今日页是最高优先级页面。

页面目标：

```text
让用户知道今天要做什么、完成到什么程度、下一步该怎么继续。
```

今日页推荐结构：

```text
顶部导航

目标 Hero 卡
- 今日行动
- 当前目标
- 今日日期
- 今日完成度
- 低压力提示语

今日数据
- 今日行动数
- 已完成数
- 实际投入时间

行动安排标题行
- 行动安排
- + 添加

今日行动列表
- 任务卡片
- 状态标签
- 预计时间 / 实际时间
- 日期标签
- 小圆形完成控件

底部操作
- 记录今日行动
```

### 6.1 今日页 Hero 卡

Hero 卡不要信息过载。

示例结构：

```text
TODAY · ACTION
今日行动

通过英语四六级
今天先完成眼前这几件事。

今日完成度 50%
```

Hero 卡可以使用深绿色背景，但不要过度堆叠装饰。

---

### 6.2 今日统计区

统计区建议使用统一 3 列结构：

```text
今日行动 3
已完成 2
投入 60min
```

统计卡片不要红、蓝、黄、绿混乱使用。
优先使用白卡 + 轻微浅色背景。

---

### 6.3 今日行动卡片

任务卡片必须统一全宽。

结构：

```text
┌────────────────────────┐
│ [待开始]                         ○ │
│ 看言语理解                         │
│ 预计 30 分钟 · 今天                │
└────────────────────────┘
```

已完成状态：

```text
┌────────────────────────┐
│ [已完成]                         ✓ │
│ 背 30 个单词                       │
│ 预计 30 分钟 · 实际 30 分钟 · 今天 │
└────────────────────────┘
```

禁止使用大号横向椭圆勾选按钮。

完成控件必须是小圆形：

```css
.task-check {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 2rpx solid #C9D8D1;
}
```

完成状态：

```css
.task-check--done {
  background: #356859;
  border-color: #356859;
  color: #FFFFFF;
}
```

---

### 6.4 任务操作

任务操作面板保留真正动作：

```text
标记完成
完成一部分
顺延到明天
今天不做
编辑
删除
```

不要新增“待开始”按钮。
“待开始”只是展示状态，不是用户操作。

---

## 7. 进度页设计规范

进度页目标：

```text
让用户看到自己的成长被记录，而不是只看到冷冰冰的数据。
```

页面结构：

```text
顶部导航

成长档案 Hero 卡
- 当前目标
- 累计完成率
- 当前状态

核心数据卡
- 已完成行动
- 行动天数
- 连续天数
- 投入分钟

贡献热力图 / 最近 7 天记录

成就收藏册

待继续行动
- 全宽任务卡片列表
```

### 7.1 成长档案 Hero

Hero 卡要更有“档案感”和“成长感”。

示例：

```text
GROWTH ARCHIVE
成长档案

通过英语四六级
累计行动完成率 50%
```

不要只是普通统计面板。

---

### 7.2 今日完成情况

进度条统一样式：

```css
.progress-bar {
  height: 16rpx;
  border-radius: 8rpx;
  background: #E8EFEA;
}

.progress-bar-inner {
  height: 100%;
  border-radius: 8rpx;
  background: #7DBB69;
}
```

---

### 7.3 待继续行动

待继续行动必须使用全宽卡片。

禁止中间窄卡漂浮。

正确结构：

```text
待继续行动          + 添加

┌────────────────────────┐
│ [待继续] 逻辑推理错题复盘    > │
│ 2026-06-22 · 预计 30 分钟     │
│ 尚未开始                     │
└────────────────────────┘
```

复用今日页任务卡片样式。

---

## 8. 小队页设计规范

小队页目标：

```text
提供轻量陪伴感，而不是复杂社交。
```

小队页结构：

```text
顶部导航

小队 Hero 卡
- 小队名称
- 成员数量
- 小队定位
- 今日整体进度

小队信息卡
- 房间号
- 邀请好友
- 复制房间号
- 小队设置

今日小队进度
- 已完成成员数
- 累计行动时间
- 小队完成率

小队成员列表
- 头像
- 昵称
- 今日状态
- 行动摘要
- 鼓励按钮
```

禁止做：

```text
群聊
私聊
排行榜
陌生人社交
附近的人
```

小队文案应强调：

```text
一起自律，各自成长
```

不要制造比较焦虑。

---

## 9. 我的页设计规范

我的页目标：

```text
让用户知道自己是谁、当前在推进什么、累计做了多少。
```

页面结构：

```text
顶部导航

个人 Hero 卡
- 头像
- 昵称
- 等级 / 标签
- 加入天数
- 编辑资料

当前目标卡
- 目标标题
- 当前状态
- 进度条
- 查看进度
- 更换目标 / 结束目标

成长数据
- 行动天数
- 完成行动
- 实际投入

管理入口
- 历史目标
- 数据设置
- 隐私政策
- 关于进步局
```

我的页不要只是设置页。
它应该有品牌感和成长感。

---

## 10. 任务状态逻辑

数据库状态与页面展示状态要区分。

数据库执行状态：

```ts
type ActionTaskStatus =
  | 'pending'
  | 'completed'
  | 'partially_completed'
  | 'skipped'
  | 'rescheduled'
```

页面展示状态由 `status + currentDate` 计算。

规则：

```text
今天 pending → 待开始
未来 pending → 未到日期
过去 pending → 待继续
completed → 已完成
partially_completed → 完成一部分
skipped → 今天不做
rescheduled → 已顺延
```

不要在数据库里新增 `waiting_to_start`。

---

## 11. 手动行动 MVP 数据结构

基础版核心类型：

```ts
type Goal = {
  id: string
  title: string
  category: GoalCategory
  description?: string
  status: 'active' | 'completed' | 'archived'
  createdAt: string
  updatedAt: string
}

type ActionTask = {
  id: string
  goalId: string
  title: string
  description?: string
  plannedDate: string
  currentDate: string
  estimatedMinutes: number
  actualMinutes?: number
  status:
    | 'pending'
    | 'completed'
    | 'partially_completed'
    | 'skipped'
    | 'rescheduled'
  source: 'manual' | 'ai'
  issueReason?: ActionIssueReason
  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

页面不要直接操作复杂数据。
统一通过 service。

---

## 12. 服务层规范

建议使用：

```text
miniprogram/services/manualGoal.ts
miniprogram/services/manualTask.ts
miniprogram/services/manualStats.ts
miniprogram/utils/date.ts
miniprogram/utils/taskStatus.ts
miniprogram/types/manual.ts
```

页面只负责展示和交互。
业务计算放 service 或 utils。

---

## 13. 禁止事项

当前基础版不要做：

```text
真实 AI API 调用
自动生成计划
AI 目标分析
AI 重新生成
复杂小队聊天
排行榜
付费
课程商城
附近的人
复杂后台
```

不要修改：

```text
AppID
CloudBase 环境 ID
project.private.config.json
AI Token
```

不要自动：

```text
push
部署云函数
写入线上数据库
```

---

## 14. 开发流程要求

每次修改前必须：

```bash
git status
```

如有未提交修改，先说明，不要覆盖。

修改前先说明计划。

完成后输出：

```text
修改文件
实现内容
测试方法
测试结果
未完成事项
```

不得声称完成了未实际执行的：

```text
真实 AI 调用
云函数部署
线上数据库写入
真机完整验证
远程 push
```

---

## 15. 测试要求

基础版必须验证以下流程。

### 场景 1：考公用户

目标：

```text
考公
```

今日行动：

```text
看言语理解
做一组逻辑推理题
晚上复盘错题
```

验证：

```text
创建目标成功
今日页展示目标
添加 3 个行动成功
标记第 1 个完成
第 2 个完成一部分
第 3 个顺延到明天
今日统计正确
进度页统计正确
```

### 场景 2：英语四六级用户

目标：

```text
英语四六级
```

行动：

```text
背30个单词
听一套听力
整理错题
```

验证同上。

### 场景 3：自定义目标

目标：

```text
完成个人博客
```

行动：

```text
完成首页布局
写一篇关于项目的文章
检查移动端适配
```

验证同上。

---

## 16. UI 验收标准

### 今日页

必须满足：

```text
Hero 卡清晰
统计卡统一
任务卡全宽统一
勾选控件为小圆形
没有巨大椭圆勾选按钮
状态标签统一
添加按钮不过宽
底部记录按钮不漂浮
```

### 进度页

必须满足：

```text
成长档案 Hero 有记忆点
数据卡统一
热力图或最近7天记录整齐
待继续行动为全宽列表
没有中间漂浮窄卡
```

### 小队页

必须满足：

```text
轻量陪伴感
不做复杂社交
成员卡片统一
鼓励按钮克制
```

### 我的页

必须满足：

```text
个人 Hero 有品牌感
当前目标清晰
成长数据明确
管理入口整齐
```

---

## 17. 总体目标

最终用户打开小程序后，应该能完整走通：

```text
进入今日页
→ 没有目标时看到清晰空状态
→ 创建目标
→ 回到今日页
→ 点击 + 添加行动
→ 查看今日行动
→ 标记完成 / 完成一部分 / 顺延
→ 记录实际投入时间
→ 进入进度页看到成长记录
```

这就是当前基础版 MVP 的核心闭环。
