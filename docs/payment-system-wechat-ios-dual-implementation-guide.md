# 今日进度｜目标计划打卡 · 微信支付 + iOS IAP 双端接入指导文档

> 版本：v1.0  ·  日期：2026-07-16
> 适用项目：今日进度｜目标计划打卡（jinbuju）微信小程序
> 目标读者：本项目开发、产品、运营同学
> 关联文档：`AGENTS.md`、`docs/notification-system-implementation-guide.md`、`docs/上线前风险评估报告.md`

---

## 目录

1. [背景与核心规则](#1-背景与核心规则)
2. [资质开通清单](#2-资质开通清单)
3. [技术架构总览](#3-技术架构总览)
4. [微信支付接入详解](#4-微信支付接入详解)
5. [iOS IAP 接入详解](#5-ios-iap-接入详解)
6. [双端统一架构设计](#6-双端统一架构设计)
7. [数据模型设计](#7-数据模型设计)
8. [核心业务流程](#8-核心业务流程)
9. [安全与合规](#9-安全与合规)
10. [测试与上线](#10-测试与上线)
11. [实施路线图](#11-实施路线图)
12. [附录](#12-附录)

---

## 1. 背景与核心规则

### 1.1 为什么需要双端支付

今日进度｜目标计划打卡后续商业化路径包含增值服务（Pro 会员、小队扩容、深度复盘报告、AI 教练高级模式等），这些**全部属于虚拟商品**。微信小程序在 iOS 与安卓端对虚拟商品支付有**完全不同的规则**，必须双端分别接入：

| 端 | 虚拟商品支付通道 | 抽成 | 强制性 |
|---|---|---|---|
| 安卓 | 微信支付 | 0%（商户手续费 0.6%） | ✅ 必须用微信支付 |
| iOS | Apple IAP（In-App Purchase） | 30%（小企业 15%） | ✅ **必须**用 IAP，否则审核拒 |

### 1.2 苹果审核指南 3.1.1 详解

苹果 App Store Review Guideline **3.1.1 In-App Purchase** 规定：

> Apps may use in-app purchase to sell and sell services such as subscriptions, additional levels, etc. Apps may not use in-app purchase to sell physical goods or services that are consumed outside of the app.
> **If your app enables the purchase of digital goods or services to be used outside of the app, you must use Apple's In-App Purchase.**

微信小程序作为 iOS 上的"内嵌应用"，**同样受此规则约束**。这意味着：

- 今日进度｜目标计划打卡在 iOS 端**不能**直接调用 `wx.requestPayment` 卖 Pro 会员
- 必须使用 IAP，苹果会从销售额中抽 30%（年订阅满 1 年后降至 15%）
- 安卓端继续走微信支付，0% 抽成

### 1.3 哪些是"虚拟商品"

| 商品类型 | 是否虚拟商品 | 本项目是否涉及 |
|---|---|---|
| Pro 会员（解锁高级 AI 教练） | ✅ 是 | ✅ 计划做 |
| 小队扩容到 100 人 | ✅ 是 | ✅ 计划做 |
| 深度复盘报告解锁 | ✅ 是 | ✅ 计划做 |
| AI 教练高级模式 | ✅ 是 | ✅ 计划做 |
| 实物手账本 | ❌ 否（实物） | 暂不做 |
| 课程内容（视频/音频） | ✅ 是 | 暂不做 |
| 实体周边配送 | ❌ 否（实物） | 暂不做 |

**结论**：今日进度｜目标计划打卡 MVP 增值服务**全部是虚拟商品**，必须双端支付。

### 1.4 灰色操作的风险提示

部分小程序为绕开苹果抽成，在 iOS 端采用以下灰色操作，**今日进度｜目标计划打卡禁止使用**：

| 灰色操作 | 风险 |
|---|---|
| iOS 端跳转 H5 网页支付 | 苹果会下架，且微信审核也会拒 |
| iOS 端"联系客服"人工收款 | 苹果会下架 |
| 区分用户系统，安卓付费 iOS 免费 | 苹果会判定"破坏 IAP 公平性" |
| 仅在安卓端展示付费入口 | 苹果可能放过，但用户体验割裂，**不推荐** |

### 1.5 唯一合规路径

```
                    ┌─────────────────────────┐
                    │   用户点击"开通 Pro 会员"  │
                    └────────────┬────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │  检测设备平台（wx.getSystemInfoSync）│
                    └────────────┬────────────┘
                                 ↓
                ┌────────────────┴────────────────┐
                ↓                                  ↓
       ┌────────────────┐                ┌────────────────┐
       │   iOS 端        │                │   安卓端        │
       │   走 IAP         │                │   走微信支付    │
       │   苹果抽 30%     │                │   0% 抽成       │
       └────────────────┘                └────────────────┘
                ↓                                  ↓
                └────────────────┬────────────────┘
                                 ↓
                    ┌─────────────────────────┐
                    │  服务端校验票据/支付结果   │
                    │  发放权益（统一）          │
                    └─────────────────────────┘
```

**关键原则**：双端**支付通道不同**，但**权益发放统一**，用户在 iOS 买的会员和安卓买的会员功能完全一致。

---

## 2. 资质开通清单

### 2.1 微信侧资质

| 资质 | 费用 | 周期 | 必要性 | 申请入口 |
|---|---|---|---|---|
| 小程序微信认证 | 300 元/年 | 1-3 工作日 | 必须 | [mp.weixin.qq.com](https://mp.weixin.qq.com) → 设置 → 微信认证 |
| 微信支付商户号 | 免费 | 3-5 工作日 | 必须 | [pay.weixin.qq.com](https://pay.weixin.qq.com) → 商户进件 |
| 商户号绑定小程序 | 免费 | 即时 | 必须 | 商户平台 → 产品中心 → AppID 账户管理 |

**主体类型要求**：

| 主体 | 能否开通支付 | 备注 |
|---|---|---|
| 个人主体 | ❌ 不能 | 微信小程序个人主体不支持支付 |
| 个体工商户 | ✅ 可以 | 适合个人创业者 |
| 企业 | ✅ 可以 | 推荐路径 |
| 政府机关/事业单位 | ✅ 可以 | 不适用本项目 |

**今日进度｜目标计划打卡需要先确认**：当前小程序注册主体类型。如果是个人主体，必须先迁移到企业/个体工商户。

### 2.2 苹果侧资质

| 资质 | 费用 | 周期 | 必要性 |
|---|---|---|---|
| Apple Developer Program | $99/年 | 1-2 天 | 必须（注册 IAP 商品需要） |
| App Store Connect 配置 IAP 商品 | 免费 | 1-2 天审核 | 必须 |

**注意**：微信小程序本身不需要上架 App Store，但 IAP 商品必须通过 App Store Connect 注册。这里有一个微妙之处——微信小程序调用 IAP 时，用的是**微信主体的 App ID**，不是今日进度｜目标计划打卡自己的。所以实际上：

- 微信小程序在 iOS 上调用 IAP 时，使用的是**腾讯微信团队在 App Store 注册的 IAP 商品**
- 微信平台提供了 `wx.requestSubscribeMessage` 类似的 IAP 调用 API
- **今日进度｜目标计划打卡作为小程序开发者，不需要自己注册 Apple Developer 账号**
- 但需要在微信公众平台后台**配置商品信息**，由微信侧代为同步到 App Store

### 2.3 今日进度｜目标计划打卡实际需要做的事

| # | 任务 | 在哪里做 |
|---|---|---|
| 1 | 完成小程序微信认证 | 微信公众平台 |
| 2 | 申请微信支付商户号 | 微信支付平台 |
| 3 | 商户号绑定到小程序 | 微信支付平台 |
| 4 | 在小程序后台开通"虚拟支付"（仅 iOS 需要） | 微信公众平台 → 支付 |
| 5 | 配置 IAP 商品（productId、价格档位） | 微信公众平台 → 支付 → iOS 虚拟商品 |
| 6 | 配置微信支付商品 | 微信公众平台 → 支付 → 微信支付 |
| 7 | 服务端接入云开发支付接口 | 项目代码 |

---

## 3. 技术架构总览

### 3.1 双端支付统一架构图

```
┌──────────────────────────────────────────────────────────────┐
│                     小程序前端（统一入口）                       │
│  pages/membership/  ← 用户看到的购买页面（不区分平台）             │
│         │                                                     │
│         ↓                                                     │
│  services/payment.ts  ← 统一支付服务层                          │
│         │                                                     │
│         ├─→ detectPlatform() 检测 iOS / 安卓                   │
│         │                                                     │
│         ├─→ iOS：调 wx.requestPayment (虚拟支付)                │
│         │                                                     │
│         └─→ 安卓：调 wx.requestPayment (微信支付)               │
└─────────────────────────┬────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│              云函数 generatePlan（统一 action 路由）             │
│                                                              │
│  action=payment.createOrder      创建订单（统一）                │
│  action=payment.verifyWechatPay  微信支付回调校验                │
│  action=payment.verifyIAP        iOS IAP 票据校验               │
│  action=payment.grantBenefit     发放权益（统一）                │
│  action=payment.queryOrder       查询订单状态                   │
│  action=payment.refund           退款                          │
│  action=payment.queryMembership  查询用户会员状态                │
└─────────────────────────┬────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│                    云数据库（统一存储）                          │
│                                                              │
│  payment_products      商品表（双端价格、productId 映射）         │
│  payment_orders        订单表（双端订单统一存储）                │
│  payment_receipts      票据表（IAP 票据 / 微信支付凭证）         │
│  payment_memberships   会员权益表（统一权益状态）                │
│  payment_refunds       退款记录表                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 与项目现有架构对齐

基于项目勘察结果：

| 现状 | 双端支付集成方式 |
|---|---|
| 云函数统一入口 `generatePlan` + action 路由 | ✅ 新增 `payment.*` 系列 action，与现有范式一致 |
| 服务层 `services/*.ts`（21 个文件） | ✅ 新增 `services/payment.ts`，与现有范式一致 |
| 已有云开发环境 `ai-d3g9qsay37da6a3cc` | ✅ 复用，无需新建环境 |
| 已有 `subscription_ledger` 类云数据库范式 | ✅ 复用，新增 payment 系列集合 |
| TypeScript 全栈 | ✅ 新代码全部 TS |
| `AGENTS.md` 第 3 节工程约束 | ✅ 遵循，不引入大型支付 SDK |

### 3.3 关键技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 微信支付模式 | **云开发模式**（`cloud.openapi.unifiedOrder` 等） | 与项目架构一致，无需管理证书/密钥 |
| IAP 票据校验 | 服务端调用 Apple verifyReceipt | 前端校验不可信 |
| 权益发放 | 服务端统一发放，前端只查询状态 | 防止前端伪造 |
| 订单号生成 | 云函数生成（前缀 + 时间戳 + 随机数） | 全局唯一、可读 |
| 退款流程 | 服务端发起，人工审核 | 避免自动退款被滥用 |

---

## 4. 微信支付接入详解

### 4.1 云开发模式 vs 传统模式

| 模式 | 证书/密钥管理 | 调用方式 | 与本项目契合 |
|---|---|---|---|
| 云开发模式 | 云开发自动管理 | 云函数内 `cloud.openapi.unifiedOrder` 等 | ✅ **采用** |
| 传统模式 | 自行下载证书、配置 API 密钥 | 调用 `api.mch.weixin.qq.com` | ❌ 不采用 |

**采用云开发模式的理由**：

1. 项目已全面云开发，所有业务通过云函数承载
2. 云开发模式**无需管理商户证书**，避免证书过期导致支付故障
3. 与 `generatePlan` + action 路由范式完全一致
4. 支付回调天然走云函数，无需配置 notify_url

### 4.2 微信支付完整流程

```
用户点击"开通 Pro 会员"
  ↓
前端 services/payment.ts 调用 action=payment.createOrder
  ↓
云函数创建订单（payment_orders 集合，状态=pending）
  ↓
云函数调用 cloud.openapi.unifiedOrder 生成预支付订单
  ↓
返回 prepay_id 等参数给前端
  ↓
前端调 wx.requestPayment（传入 prepay_id、签名等）
  ↓
用户输入密码/指纹完成支付
  ↓
微信侧异步回调云函数（payment callback action）
  ↓
云函数校验签名、金额、订单号
  ↓
更新订单状态为 paid
  ↓
调用 grantBenefit 发放权益
  ↓
前端轮询 action=payment.queryOrder 拿到 paid 状态，展示成功
```

### 4.3 关键参数与签名

云开发模式下，云函数调用 `cloud.openapi.unifiedOrder` 所需参数：

| 参数 | 说明 | 来源 |
|---|---|---|
| body | 商品描述（如"今日进度｜目标计划打卡 Pro 会员-月度"） | 商品表 |
| outTradeNo | 商户订单号（项目侧生成） | 云函数生成 |
| totalFee | 金额（分），如 1900 = 19.00 元 | 商品表 |
| spbillCreateIp | 用户 IP | `cloud.getWXContext()` |
| openid | 用户 openid | `cloud.getWXContext()` |
| tradeType | 固定 `JSAPI` | - |

**返回给前端的参数**（前端调 `wx.requestPayment` 用）：

- `timeStamp`：时间戳
- `nonceStr`：随机字符串
- `package`：`prepay_id=xxx`
- `signType`：`RSA`
- `paySign`：签名

**云开发模式的关键优势**：签名由云开发 SDK 自动生成，无需手动实现签名算法。

### 4.4 支付回调处理

云函数需要监听微信支付异步通知。云开发模式下，通过**云函数支付回调触发器**实现：

1. 在云函数配置中添加 `cloud-pay` 触发器
2. 微信侧支付成功后，自动调用该云函数
3. 云函数内通过 `cloud.getWXContext()` 获取支付信息
4. 校验订单号、金额、状态
5. 更新订单状态、发放权益

**关键校验点**（防止伪造回调）：

| 校验项 | 说明 |
|---|---|
| 订单号匹配 | 回调中的 outTradeNo 必须在 payment_orders 中存在 |
| 金额匹配 | 回调中的 totalFee 必须与订单金额一致 |
| openid 匹配 | 回调中的 openid 必须与订单创建者一致 |
| 状态校验 | 订单当前状态必须为 pending，避免重复处理 |
| 签名校验 | 云开发 SDK 自动校验，无需手动实现 |

### 4.5 退款流程

```
用户在小程序申请退款
  ↓
前端调 action=payment.refund
  ↓
云函数记录退款申请（payment_refunds，状态=pending）
  ↓
人工审核（运营在管理后台审核）
  ↓
审核通过后，云函数调用 cloud.openapi.refund
  ↓
微信侧处理退款，原路退回
  ↓
异步回调云函数
  ↓
更新退款记录状态、撤销权益
```

**注意**：退款必须**先撤销权益**再退款，避免用户退款后仍享受会员权益。

---

## 5. iOS IAP 接入详解

### 5.1 IAP 工作机制

iOS IAP 是苹果的内购系统，用户支付时**直接与 Apple 交互**，开发者不接触支付凭证。流程：

```
用户点击"开通 Pro 会员"（iOS 端）
  ↓
前端调用 wx.requestPayment（虚拟支付模式）
  ↓
微信小程序底层调用 StoreKit
  ↓
用户使用 Apple ID 支付（Face ID / Touch ID）
  ↓
Apple 服务器处理支付
  ↓
返回交易凭证（transactionReceipt）
  ↓
前端将凭证上传到云函数
  ↓
云函数调用 Apple verifyReceipt 校验
  ↓
校验通过，发放权益
  ↓
前端告知 StoreKit 交易完成（finishTransaction）
```

### 5.2 IAP 商品配置

**在微信公众平台后台配置**（不需要去 App Store Connect）：

| 配置项 | 说明 | 示例 |
|---|---|---|
| productId | 苹果侧商品标识 | `com.jinbuju.pro.monthly` |
| 商品名称 | 用户看到的名称 | Pro 会员月度 |
| 价格档位 | 苹果预设价格档位 | Tier 3 = ¥18 |
| 商品类型 | 消耗型 / 非消耗型 / 自动续期订阅 / 非续期订阅 | 见 5.3 |
| 商品描述 | App Store 展示描述 | 解锁高级 AI 教练 |

**苹果价格档位**：苹果不允许自定义价格，只能从预设档位中选择。例如 Tier 1 = ¥6，Tier 3 = ¥18，Tier 5 = ¥30，Tier 10 = ¥68 等。

### 5.3 IAP 商品类型选择

| 类型 | 适用场景 | 今日进度｜目标计划打卡适用 |
|---|---|---|
| 消耗型（Consumable） | 游戏金币、一次性代币 | ❌ 不适用 |
| 非消耗型（Non-Consumable） | 一次购买永久解锁 | ✅ 可用于"终身会员" |
| 自动续期订阅 | 月度/年度会员，自动扣款 | ✅ **推荐用于 Pro 会员** |
| 非续期订阅 | 固定期限，到期不自动续费 | ✅ 可用于"季度会员" |

**今日进度｜目标计划打卡建议**：

- Pro 会员月度 → 自动续期订阅
- Pro 会员年度 → 自动续期订阅
- 终身会员 → 非消耗型
- 深度复盘报告单次解锁 → 非消耗型

### 5.4 票据校验（关键）

**前端校验不可信**，必须服务端校验。流程：

1. 前端拿到 `transactionReceipt`（base64 编码的票据）
2. 调用 `action=payment.verifyIAP`，传票据到云函数
3. 云函数调用 Apple 校验接口：

```
Sandbox 测试：    https://sandbox.itunes.apple.com/verifyReceipt
Production 正式： https://buy.itunes.apple.com/verifyReceipt
```

4. **双环境校验策略**（苹果官方推荐）：

```
先请求 Production 接口
  ↓
如果返回 status=21007（票据是 sandbox 的）
  ↓
再请求 Sandbox 接口
```

5. 校验返回的 `in_app` 数组，匹配 productId、transactionId
6. 写入 payment_receipts 集合
7. 发放权益

### 5.5 自动续期订阅的特殊处理

自动续期订阅有以下额外事件需要处理：

| 事件 | 处理方式 |
|---|---|
| 首次订阅 | 发放权益，记录到期时间 |
| 自动续费成功 | 延长权益到期时间 |
| 用户取消订阅 | 不立即撤销权益，到期后撤销 |
| 订阅过期 | 撤销权益 |
| 退款 | 立即撤销权益 |
| 升级（月度→年度） | 处理 proration，调整到期时间 |
| 降级（年度→月度） | 当前周期结束才生效 |

**苹果的 Server Notification**：苹果提供服务器通知，当订阅状态变化时主动推送。云函数需要配置一个 HTTP 接口接收通知（云开发支持 HTTP 触发器）。

### 5.6 iOS 端"恢复购买"

苹果审核要求**所有非消耗型商品和订阅商品必须提供"恢复购买"按钮**。

实现方式：

```
用户点击"恢复购买"
  ↓
前端调用 wx.requestPayment（恢复模式）
  ↓
StoreKit 拉取用户 Apple ID 下的所有历史交易
  ↓
将所有交易凭证上传到云函数
  ↓
云函数逐个校验，恢复有效权益
  ↓
前端展示"已恢复 X 项购买"
```

**注意**：如果没有"恢复购买"按钮，**苹果会拒绝审核**。

---

## 6. 双端统一架构设计

### 6.1 商品中心

商品表（payment_products）统一管理双端商品：

| 字段 | 说明 | 示例 |
|---|---|---|
| `productId` | 项目侧商品 ID | `pro_monthly` |
| `name` | 统一商品名称 | Pro 会员月度 |
| `type` | 商品类型 | `subscription` / `lifetime` / `consumable` |
| `benefits` | 权益列表（JSON） | `["ai_coach_pro", "team_size_100"]` |
| `durationDays` | 权益时长（天） | 30 |
| `wechatPayPrice` | 安卓端价格（分） | 1900 |
| `iapProductId` | iOS IAP 商品 ID | `com.jinbuju.pro.monthly` |
| `iapPriceTier` | iOS 价格档位 | 3 |
| `status` | 上架/下架 | `active` / `inactive` |

**关键设计**：同一个商品在双端有不同的"支付身份"，但**权益一致**。

### 6.2 订单中心

订单表（payment_orders）统一存储双端订单：

| 字段 | 说明 | 示例 |
|---|---|---|
| `orderId` | 项目侧订单号 | `JBJ_20260716_xxxxxxxx` |
| `openid` | 用户 openid | - |
| `productId` | 商品 ID | `pro_monthly` |
| `platform` | 支付平台 | `wechat_pay` / `iap` |
| `amount` | 金额（分） | 1900 |
| `currency` | 货币 | `CNY` |
| `status` | 订单状态 | `pending` / `paid` / `failed` / `refunded` |
| `externalOrderId` | 外部订单号 | 微信交易号 / Apple transactionId |
| `createdAt` | 创建时间 | - |
| `paidAt` | 支付时间 | - |

### 6.3 支付路由（前端）

`services/payment.ts` 统一封装：

```
async function purchase(productId: string): Promise<PurchaseResult> {
  // 1. 调用 action=payment.createOrder 创建订单
  const order = await callCloud('payment.createOrder', { productId });

  // 2. 检测平台
  const platform = detectPlatform();  // 'ios' / 'android'

  // 3. 平台路由
  if (platform === 'ios') {
    // 调用 wx.requestPayment（虚拟支付模式）
    // 微信小程序底层会调用 StoreKit
    return await payWithIAP(order);
  } else {
    // 调用 wx.requestPayment（微信支付模式）
    return await payWithWechatPay(order);
  }

  // 4. 支付完成后，前端轮询订单状态
  // 服务端在回调/校验中发放权益
}
```

**关键**：前端**不直接发放权益**，只触发支付流程。权益发放全部在服务端。

### 6.4 权益发放统一

无论用户从哪个端购买，权益表（payment_memberships）统一存储：

| 字段 | 说明 |
|---|---|
| `openid` | 用户 openid |
| `productId` | 商品 ID |
| `orderId` | 关联订单号 |
| `benefits` | 权益快照（JSON） |
| `startTime` | 权益开始时间 |
| `expireTime` | 权益到期时间（终身会员为 null） |
| `status` | `active` / `expired` / `revoked` |
| `source` | `wechat_pay` / `iap` |
| `autoRenew` | 是否自动续费（仅订阅类） |

**用户在任意端查询会员状态**：

```
前端调用 action=payment.queryMembership
  ↓
云函数查询 payment_memberships，返回当前有效权益
  ↓
前端根据权益状态展示 Pro 标识、解锁功能
```

---

## 7. 数据模型设计

### 7.1 集合清单

新增 5 个云数据库集合：

```
cloud database
├── payment_products       # 商品表
├── payment_orders         # 订单表
├── payment_receipts       # 票据表（IAP 票据 + 微信支付凭证）
├── payment_memberships    # 会员权益表
└── payment_refunds        # 退款记录表
```

### 7.2 集合字段详解

#### 7.2.1 payment_products（商品表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 自动生成 |
| `productId` | string | 项目侧商品 ID（唯一索引） |
| `name` | string | 商品名称 |
| `description` | string | 商品描述 |
| `type` | string | `subscription` / `lifetime` / `consumable` |
| `benefits` | object | 权益配置，如 `{ aiCoachPro: true, teamSize: 100 }` |
| `durationDays` | number \| null | 权益时长（天），终身会员为 null |
| `wechatPayPrice` | number | 安卓端价格（分） |
| `iapProductId` | string | iOS IAP 商品 ID |
| `iapPriceTier` | number | iOS 价格档位 |
| `status` | string | `active` / `inactive` |
| `sortOrder` | number | 展示排序 |
| `createdAt` | date | 创建时间 |
| `updatedAt` | date | 更新时间 |

#### 7.2.2 payment_orders（订单表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 自动生成 |
| `_openid` | string | 用户 openid（云开发自动写入） |
| `orderId` | string | 项目侧订单号（唯一索引） |
| `productId` | string | 商品 ID |
| `productName` | string | 商品名称快照 |
| `platform` | string | `wechat_pay` / `iap` |
| `amount` | number | 金额（分） |
| `currency` | string | `CNY` |
| `status` | string | `pending` / `paid` / `failed` / `refunded` / `closed` |
| `externalOrderId` | string \| null | 微信交易号 / Apple transactionId |
| `prepayId` | string \| null | 微信预支付 ID |
| `clientInfo` | object | 客户端信息（平台、版本、IP） |
| `expireAt` | date | 订单过期时间（30 分钟未支付自动关闭） |
| `createdAt` | date | 创建时间 |
| `paidAt` | date \| null | 支付时间 |
| `closedAt` | date \| null | 关闭时间 |

**索引建议**：
- 组合索引：`(_openid, status, createdAt)` —— 用户订单查询
- 单字段索引：`orderId`（唯一） / `externalOrderId` / `expireAt`

#### 7.2.3 payment_receipts（票据表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 自动生成 |
| `_openid` | string | 用户 openid |
| `orderId` | string | 关联订单号 |
| `platform` | string | `wechat_pay` / `iap` |
| `receiptData` | string | 票据原始数据（base64） |
| `verifyResult` | object | 校验返回结果 |
| `verifiedAt` | date | 校验时间 |
| `status` | string | `valid` / `invalid` / `pending` |

**注意**：票据数据较大（IAP 票据可达几 KB），建议**只存校验结果关键字段**，原始票据可存对象存储。

#### 7.2.4 payment_memberships（会员权益表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 自动生成 |
| `_openid` | string | 用户 openid |
| `productId` | string | 商品 ID |
| `orderId` | string | 关联订单号 |
| `benefits` | object | 权益快照 |
| `startTime` | date | 权益开始时间 |
| `expireTime` | date \| null | 到期时间（终身会员为 null） |
| `status` | string | `active` / `expired` / `revoked` |
| `source` | string | `wechat_pay` / `iap` |
| `autoRenew` | boolean | 是否自动续费 |
| `originalTransactionId` | string \| null | Apple 原始交易 ID（用于续费匹配） |
| `createdAt` | date | 创建时间 |
| `updatedAt` | date | 更新时间 |

**索引建议**：
- 组合索引：`(_openid, status, expireTime)` —— 查询用户当前有效权益
- 单字段索引：`originalTransactionId` —— Apple 续费通知匹配

#### 7.2.5 payment_refunds（退款记录表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 自动生成 |
| `_openid` | string | 用户 openid |
| `orderId` | string | 关联订单号 |
| `refundId` | string | 退款单号 |
| `amount` | number | 退款金额（分） |
| `reason` | string | 退款原因 |
| `status` | string | `pending` / `approved` / `rejected` / `refunded` / `failed` |
| `operator` | string | 审核人 |
| `externalRefundId` | string \| null | 微信退款单号 |
| `createdAt` | date | 申请时间 |
| `processedAt` | date \| null | 处理时间 |

### 7.3 数据安全规则

| 集合 | 读权限 | 写权限 |
|---|---|---|
| payment_products | 所有用户可读（仅 active 商品） | 仅云函数 |
| payment_orders | 仅创建者读自己的订单 | 仅云函数 |
| payment_receipts | 仅创建者读自己的票据 | 仅云函数 |
| payment_memberships | 仅创建者读自己的权益 | 仅云函数 |
| payment_refunds | 仅创建者读自己的退款 | 仅云函数 |

**关键**：前端**禁止**直接写任何 payment 集合，所有写入必须通过云函数，否则用户可伪造会员权益。

---

## 8. 核心业务流程

### 8.1 购买流程（双端统一）

```
Step 1  用户进入会员页 pages/membership
        ↓
Step 2  前端调 action=payment.queryMembership 查询当前权益
        ↓
Step 3  展示商品列表（从 payment_products 读取，仅 active）
        ↓
Step 4  用户点击"开通"→ 前端调 action=payment.createOrder
        ↓
Step 5  云函数创建订单（status=pending），返回订单信息
        ↓
Step 6  前端 detectPlatform()
        ├─ iOS：调 wx.requestPayment（虚拟支付），传 iapProductId
        │       ↓ 微信底层调 StoreKit → 用户支付 → 拿到 transactionReceipt
        │       ↓ 前端调 action=payment.verifyIAP，传 receipt
        │       ↓ 云函数校验 → 发放权益 → 更新订单 status=paid
        │
        └─ 安卓：云函数调 cloud.openapi.unifiedOrder 拿 prepay_id
                ↓ 前端调 wx.requestPayment，传 prepay 参数
                ↓ 用户支付完成
                ↓ 微信异步回调云函数
                ↓ 云函数校验 → 发放权益 → 更新订单 status=paid
        ↓
Step 7  前端轮询 action=payment.queryOrder（每 2 秒，最多 30 秒）
        ↓
Step 8  拿到 paid 状态 → 展示成功页 → 引导用户开始使用 Pro 功能
```

### 8.2 续费流程

**安卓端**（微信支付）：

- 自动续费需用户在小程序内签约（委托代扣）
- 签约后每月自动扣款，回调云函数处理

**iOS 端**（IAP 自动续期订阅）：

- 用户首次订阅即同意自动续费
- 苹果每月自动扣款，并通过 Server Notification 通知云函数
- 云函数延长 expireTime

### 8.3 退款流程

```
用户在会员页点击"申请退款"
  ↓
前端展示退款原因选项（必选）
  ↓
调 action=payment.refund.create，记录退款申请
  ↓
运营在管理后台审核
  ├─ 拒绝 → 通知用户，结案
  └─ 通过 → 调 action=payment.refund.process
        ↓
        云函数根据 source 调用对应退款接口：
        ├─ wechat_pay：调 cloud.openapi.refund
        └─ iap：调 Apple refund API（需 App Store Server API）
        ↓
        退款成功后，立即撤销权益（status=revoked）
        ↓
        通知用户退款已处理
```

### 8.4 跨端用户身份对齐

**关键问题**：同一用户的微信 openid 在 iOS 和安卓端是**相同的**（都是同一微信账号），所以**不需要额外身份对齐**。

但如果未来扩展到 App 端（非小程序），则涉及 UnionID 体系：

- 小程序用户：openid（小程序唯一）+ UnionID（开发者主体唯一）
- App 用户：openid（App 唯一）+ UnionID
- 通过 UnionID 对齐身份，权益跨端共享

**当前阶段**：仅小程序，无需考虑此问题。

---

## 9. 安全与合规

### 9.1 防伪造攻击

| 攻击方式 | 防御措施 |
|---|---|
| 伪造支付回调 | 云开发 SDK 自动校验签名；订单号、金额、openid 三重校验 |
| 伪造 IAP 票据 | 服务端调用 Apple verifyReceipt，不信任前端数据 |
| 重放攻击 | 票据表唯一约束，同一 transactionId 只能发放一次权益 |
| 越权查询他人订单 | 安全规则限制 `_openid` 匹配 |
| 篡改商品价格 | 商品价格在云函数侧从 payment_products 读取，不信任前端传入 |
| 伪造会员权益 | 权益表仅云函数写入，前端只读 |

### 9.2 苹果审核应对

| 审核风险 | 应对 |
|---|---|
| iOS 端用了微信支付卖虚拟商品 | 严格按平台路由，iOS 必走 IAP |
| 缺少"恢复购买"按钮 | 必须实现，且放在会员页显眼位置 |
| IAP 商品信息不完整 | 商品名称、描述、截图都按要求填写 |
| 价格与安卓不一致 | 苹果价格档位有限，可能与安卓定价不完全一致，需在描述中说明 |
| 自动续期订阅未说明条款 | 必须在购买前展示订阅条款、自动续费规则、取消方式 |

### 9.3 隐私合规

依据 `AGENTS.md` 第 5.3、11 节：

| 合规项 | 处理 |
|---|---|
| 隐私协议更新 | 在 `pages/legal/privacy` 新增"会员服务"章节 |
| 支付信息收集说明 | 说明收集 openid、订单信息、票据的用途 |
| 不收集信用卡信息 | 微信支付/IAP 都不接触卡号，由微信/苹果处理 |
| 数据存储位置 | 云开发数据库，符合 PIPL 要求 |
| 退款政策公示 | 在会员页和法律条款页公示退款政策 |
| 自动续费提醒 | iOS 订阅页面必须展示续费规则 |

### 9.4 财务合规

| 项 | 处理 |
|---|---|
| 发票 | 提供"申请发票"入口，记录发票申请 |
| 对账 | 每日对账任务，比对订单表与微信/Apple 后台账单 |
| 税务 | 收入按"信息技术服务费"申报，iOS 收入需注意代扣代缴 |

---

## 10. 测试与上线

### 10.1 测试环境

| 环境 | 微信支付 | iOS IAP |
|---|---|---|
| 开发版 | 微信支付沙箱 | Apple Sandbox |
| 体验版 | 微信支付沙箱 | Apple Sandbox |
| 正式版 | 真实微信支付 | 真实 Apple IAP |

### 10.2 微信支付沙箱测试

1. 在微信支付商户平台开通"沙箱功能"
2. 使用沙箱版微信（微信支付提供的特殊版本）测试
3. 沙箱支付金额固定，不会真实扣款
4. 沙箱回调地址需单独配置

### 10.3 Apple Sandbox 测试

1. 在 App Store Connect 创建"沙箱测试员"账号
2. 在 iOS 设备登录该沙箱账号
3. 小程序内购买时，会走 Sandbox 路径
4. Sandbox 票据校验地址：`https://sandbox.itunes.apple.com/verifyReceipt`

### 10.4 测试矩阵

| 测试维度 | 测试点 | 验证方法 |
|---|---|---|
| 微信支付（安卓） | 正常支付 / 取消支付 / 余额不足 / 回调失败 | 沙箱测试 |
| IAP（iOS） | 正常购买 / 取消 / 恢复购买 / 续费 / 退款 | Sandbox 测试 |
| 订单状态机 | pending → paid / pending → closed / paid → refunded | 单元测试 |
| 权益发放 | 即时发放 / 到期自动撤销 / 退款撤销 | 集成测试 |
| 并发 | 重复支付 / 重复回调 / 重复校验 | 压力测试 |
| 跨端 | iOS 买会员，安卓登录查看权益 | 真机测试 |
| 异常 | 网络中断 / 票据过期 / 金额不匹配 | 故障注入 |

### 10.5 灰度上线

| 阶段 | 范围 | 时长 | 关注指标 |
|---|---|---|---|
| Alpha | 内部 5 人 | 3 天 | 链路打通、无致命 bug |
| Beta | 100 人白名单 | 7 天 | 支付成功率、权益发放准确性 |
| GA 10% | 10% 用户 | 7 天 | 转化率、退款率、客诉 |
| GA 50% | 50% 用户 | 7 天 | 同上 |
| GA 100% | 全量 | - | 持续监控 |

**灰度机制**：在 payment_products 增加 `grayEnabled` 字段，云函数控制是否对该用户展示商品。

### 10.6 监控指标

| 指标 | 目标值 | 告警阈值 |
|---|---|---|
| 支付成功率 | ≥ 99% | < 95% 告警 |
| 权益发放成功率 | 100% | < 99.9% 紧急告警 |
| IAP 票据校验耗时 | < 3 秒 | > 5 秒告警 |
| 退款处理时长 | < 24 小时 | > 48 小时告警 |
| 订单对账差异 | 0 | > 0 紧急告警 |
| 会员转化率 | ≥ 5% | < 2% 告警（产品问题） |
| 30 天续费率 | ≥ 60% | < 40% 告警 |

---

## 11. 实施路线图

### 11.1 阶段一：资质与配置（1 周）

| 任务 | 负责方 | 周期 |
|---|---|---|
| 完成小程序微信认证 | 运营 | 1-3 工作日 |
| 申请微信支付商户号 | 运营 | 3-5 工作日 |
| 商户号绑定小程序 | 运营 | 即时 |
| 开通 iOS 虚拟支付 | 运营 | 1-2 工作日 |
| 配置 3 个 MVP 商品（Pro 月度、年度、终身） | 运营 + 产品 | 1 天 |
| 商品价格档位确认 | 产品 | 1 天 |

### 11.2 阶段二：服务端开发（2 周）

| 周次 | 任务 | 产出 |
|---|---|---|
| W1 | 云数据库集合建立 + 商品/订单/权益数据模型 | 5 个集合就绪 |
| W1 | `payment.*` 系列 action（createOrder、verifyWechatPay、verifyIAP、grantBenefit、queryOrder、queryMembership） | 6 个 action 可调 |
| W2 | 退款流程 + 自动续费处理 + Server Notification 接收 | 完整支付闭环 |
| W2 | 对账任务 + 监控埋点 | 运维就绪 |

### 11.3 阶段三：前端开发（1.5 周）

| 周次 | 任务 | 产出 |
|---|---|---|
| W1 | `services/payment.ts` + 平台检测 + 双端支付调用 | 支付服务可调 |
| W1 | `pages/membership`（会员购买页） | UI 完成 |
| W2 | `pages/membership` 恢复购买、退款申请、订阅管理 | 完整会员中心 |
| W2 | 与隐私中心、个人主页集成 | 入口就绪 |

### 11.4 阶段四：测试与灰度（1 周）

| 任务 | 周期 |
|---|---|
| 微信支付沙箱测试 | 2 天 |
| Apple Sandbox 测试 | 2 天 |
| Alpha 内测 | 3 天 |

### 11.5 阶段五：上线（持续）

| 任务 | 周期 |
|---|---|
| Beta 100 人白名单 | 7 天 |
| GA 10% → 50% → 100% | 21 天 |

**总周期**：约 5.5 周（含资质审核等待时间）。

---

## 12. 附录

### 12.1 关键文件清单（实施完成后）

```
miniprogram/
├── config/
│   └── payment.ts                              # 【新增】商品 ID、价格档位配置
├── services/
│   └── payment.ts                              # 【新增】统一支付服务
├── utils/
│   └── platform.ts                             # 【新增】平台检测工具
└── pages/
    └── membership/                             # 【新增】会员中心
        ├── index.ts
        ├── index.wxml
        ├── index.wxss
        └── index.json

cloudfunctions/
├── generatePlan/
│   ├── actions/
│   │   ├── paymentCreateOrder.ts               # 【新增】创建订单
│   │   ├── paymentVerifyWechatPay.ts           # 【新增】微信支付校验
│   │   ├── paymentVerifyIAP.ts                 # 【新增】IAP 票据校验
│   │   ├── paymentGrantBenefit.ts              # 【新增】发放权益
│   │   ├── paymentQueryOrder.ts                # 【新增】查询订单
│   │   ├── paymentQueryMembership.ts           # 【新增】查询会员
│   │   ├── paymentRefund.ts                    # 【新增】退款
│   │   └── paymentRestorePurchase.ts           # 【新增】恢复购买
│   └── libs/
│       ├── appleVerify.ts                      # 【新增】Apple 票据校验
│       └── orderNumber.ts                      # 【新增】订单号生成
└── paymentCallback/                            # 【新增】微信支付回调触发器
    └── index.js

# Apple Server Notification 接收（HTTP 触发器）
└── appleServerNotification/                    # 【新增】Apple 订阅状态通知
    └── index.js
```

### 12.2 错误码对照表

#### 微信支付错误码

| errcode | 含义 | 处理 |
|---|---|---|
| 0 | 成功 | 发放权益 |
| -1 | 系统繁忙 | 重试 |
| 40001 | AppID 不正确 | 检查配置 |
| 40003 | openid 不正确 | 检查用户登录 |
| 40013 | AppID 无效 | 检查商户号绑定 |
| 50001 | 商户号未开通 | 联系运营 |

#### Apple IAP 错误码（verifyReceipt status）

| status | 含义 | 处理 |
|---|---|---|
| 0 | 校验成功 | 发放权益 |
| 21000 | App Store 无法解析 JSON | 检查请求格式 |
| 21002 | receipt 数据格式错误 | 前端重新获取 |
| 21003 | 无法验证 | 检查共享密钥 |
| 21004 | 共享密钥错误 | 检查配置 |
| 21005 | receipt 服务器不可用 | 重试 |
| 21006 | 订阅已过期（自动续期） | 撤销权益 |
| 21007 | 沙箱票据发到生产环境 | 切换到沙箱接口重试 |
| 21008 | 生产票据发到沙箱环境 | 切换到生产接口重试 |

### 12.3 价格档位参考

#### 苹果 IAP 价格档位（部分）

| Tier | 人民币 | 美元 |
|---|---|---|
| 1 | ¥6 | $0.99 |
| 3 | ¥18 | $2.99 |
| 5 | ¥30 | $4.99 |
| 10 | ¥68 | $9.99 |
| 20 | ¥128 | $19.99 |
| 50 | ¥328 | $49.99 |
| 100 | ¥648 | $99.99 |

**今日进度｜目标计划打卡 MVP 商品定价建议**：

| 商品 | 安卓定价 | iOS 档位 | 说明 |
|---|---|---|---|
| Pro 月度 | ¥19 | Tier 3（¥18） | 接近一致 |
| Pro 年度 | ¥168 | Tier 20（¥128） | iOS 略低（苹果档位限制） |
| 终身会员 | ¥388 | Tier 50（¥328） | iOS 略低 |

**注意**：iOS 价格受档位限制，可能与安卓不完全一致。需在商品描述中说明，避免用户投诉。

### 12.4 与 `AGENTS.md` 对齐检查表

- [ ] 第 3 节：未引入大型支付 SDK，复用云开发能力
- [ ] 第 5 节：未破坏现有业务功能
- [ ] 第 6 节：会员页 UI 复用项目设计令牌（米白底色、墨绿主色、克制金色）
- [ ] 第 8 节：文案规范，使用"开通会员""恢复购买""申请退款"等动作词
- [ ] 第 9 节：重构流程完整，每阶段可编译
- [ ] 第 10 节：金额、时间统一格式化函数处理
- [ ] 第 11 节：会员页可访问性，按钮点击区域足够
- [ ] 第 12 节：四个主 Tab 不受影响
- [ ] 第 13 节：Git 安全，分阶段提交
- [ ] 第 14 节：数据正确性优先于视觉

### 12.5 关键合规清单

- [ ] 隐私协议新增"会员服务"章节
- [ ] 退款政策公示
- [ ] 自动续费规则说明
- [ ] iOS 端"恢复购买"按钮存在
- [ ] 商品描述准确，无诱导话术
- [ ] 不强制付费才能使用核心功能（免费基础版可用）
- [ ] 发票申请入口
- [ ] 客服联系方式

### 12.6 参考资料

- 微信支付小程序云开发模式：https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/pay/
- Apple In-App Purchase：https://developer.apple.com/in-app-purchase/
- Apple App Store Server API：https://developer.apple.com/documentation/appstoreserverapi
- 苹果审核指南 3.1.1：https://developer.apple.com/app-store/review/guidelines/
- 苹果订阅最佳实践：https://developer.apple.com/app-store/subscriptions/

---

## 文档维护

- **作者**：小程达（微信小程序开发者）
- **维护原则**：随微信/苹果平台政策更新与项目迭代同步修订
- **下次复核**：MVP 上线后 2 周，根据真实数据调整定价与流程
- **重要提醒**：苹果 IAP 政策每年有微调，上线前需再次核对最新审核指南
