# 02 — 重试与退避 + 底层错误日志

**What to build:** 让 `msgSecCheck` 遇到瞬时错误时自动重试（默认 2 次，退避 500ms→1000ms），使网络抖动等常见瞬时故障不再直接阻断操作。重试只针对 `isTransientError` 判定为 true 的错误；内容拒绝（87014/87015）、客户端错误（4xxxx）、TypeError 等不重试。在重试和最终失败时记录底层错误的 errCode、errMsg 和错误类型，使开发者能从云函数日志诊断 `msgSecCheck` 失败根因。重试全部耗尽后仍保持 fail-closed（抛出 `CONTENT_SECURITY_UNAVAILABLE`），降级放行在下一个 ticket 实现。支持 `CONTENT_SECURITY_MAX_RETRIES` 和 `CONTENT_SECURITY_RETRY_BASE_DELAY_MS` 环境变量覆盖默认值。

**Blocked by:** 01 — Prefactor：错误分类 + 扩展 assertSafeText 签名

**Status:** ready-for-agent

- [ ] `msgSecCheck` 抛出瞬时错误时自动重试，重试之间有递增延迟（第 1 次 500ms，第 2 次 1000ms）
- [ ] `msgSecCheck` 抛出非瞬时错误时不重试，直接抛出对应错误（REJECTED 或 UNAVAILABLE）
- [ ] 重试时记录 `console.warn` 日志，包含 openid 前 8 位、scene、错误码、重试次数
- [ ] 最终失败时记录 `console.error` 日志，包含底层错误的 errCode、errMsg、错误类型
- [ ] 重试全部耗尽且 `degradeOnUnavailable` 为 false（默认）时，仍抛出 `CONTENT_SECURITY_UNAVAILABLE`
- [ ] 支持 `CONTENT_SECURITY_MAX_RETRIES` 环境变量覆盖默认重试次数
- [ ] 支持 `CONTENT_SECURITY_RETRY_BASE_DELAY_MS` 环境变量覆盖默认退避基准延迟
- [ ] 新增测试：mock `msgSecCheck` 第 1 次抛出瞬时错误（errCode -1）、第 2 次返回 pass → 函数正常返回，不抛异常
- [ ] 新增测试：mock `msgSecCheck` 全部抛出瞬时错误 → 函数抛出 `CONTENT_SECURITY_UNAVAILABLE`，重试次数等于 maxRetries+1
- [ ] 新增测试：mock `msgSecCheck` 抛出 87014 → 不重试，直接抛出 `CONTENT_SECURITY_REJECTED`
- [ ] 新增测试：mock `msgSecCheck` 抛出 TypeError → 不重试，直接抛出 `CONTENT_SECURITY_UNAVAILABLE`
- [ ] 现有测试全部通过（`content-security.test.js` 中的 "API 不可用时 fail closed" 用例需适配重试后的行为）
