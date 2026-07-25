# 01 — Prefactor：错误分类 + 扩展 assertSafeText 签名

**What to build:** 在内容安全检测模块中新增 `isTransientError` 内部函数，用于区分 `msgSecCheck` 的瞬时错误（网络故障、服务端 5xx）和不可重试错误（内容拒绝 87014/87015、客户端 4xxxx、TypeError）。同时扩展 `assertSafeText` 的函数签名，增加可选的 `options` 参数（`degradeOnUnavailable`、`maxRetries`、`retryBaseDelayMs`），但默认值使行为与当前完全一致——不重试、不降级、保持 fail-closed。这是纯 prefactor，不改变任何外部行为，为后续重试和降级 ticket 铺路。

**Blocked by:** 无 — 可立即开始

**Status:** ready-for-agent

- [ ] 新增内部函数 `isTransientError`，正确区分可重试错误（-1 网络错误、5xxxx 服务端错误）和不可重试错误（87014/87015 拒绝、4xxxx 客户端错误、TypeError、其他未知错误）
- [ ] `assertSafeText` 签名扩展为接受可选 `options` 参数，包含 `degradeOnUnavailable`（默认 false）、`maxRetries`（默认 2）、`retryBaseDelayMs`（默认 500）
- [ ] 默认参数下 `assertSafeText` 行为与当前完全一致——单次调用、fail-closed、不重试、不降级
- [ ] `assertEventContentSafe` 调用 `assertSafeText` 时不传 `options`（使用默认值），行为不变
- [ ] `assertAiOutputSafe` 调用 `assertSafeText` 时不传 `options`（使用默认值），行为不变
- [ ] `isTransientError` 导出供测试直接验证
- [ ] 现有测试全部通过（`content-security.test.js`、`ai-security.test.js`），无行为变更
- [ ] 新增测试验证 `isTransientError` 对各类错误码的判断（87014 → false、-1 → true、40001 → false、50001 → true、TypeError → false）
