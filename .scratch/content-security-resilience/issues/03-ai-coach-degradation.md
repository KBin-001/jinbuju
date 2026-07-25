# 03 — AI 教练对话分级降级

**What to build:** 让 AI 教练对话的用户输入检测在 `msgSecCheck` 重试全部失败后降级放行，而非阻断整个对话。降级仅在 `askProgressCoach` action 的输入检测路径启用；其他写入操作（创建任务、打卡、小队设置等）和 AI 输出检测（`assertAiOutputSafe`）保持 fail-closed 不变。降级放行时记录 `console.warn` 审计日志。同时在云函数入口的 `failure` 函数中，当错误码为 `CONTENT_SECURITY_UNAVAILABLE` 时额外记录 `error.cause` 的底层错误信息，使所有内容安全不可用错误都能在日志中追溯根因。完成后，用户在 AI 教练对话中遇到 `msgSecCheck` 故障时可以正常对话，而不是反复收到"内容安全检测暂不可用"。

**Blocked by:** 02 — 重试与退避 + 底层错误日志

**Status:** ready-for-agent

- [ ] `assertEventContentSafe` 仅在 `askProgressCoach` action 时传入 `degradeOnUnavailable: true`
- [ ] 其他 action（createManualTask、submitCheckin、updateTeamSettings 等）保持默认 `degradeOnUnavailable: false`
- [ ] `assertAiOutputSafe`（AI 输出检测）保持 fail-closed，不传入降级标记
- [ ] `degradeOnUnavailable` 为 true 且重试全部因瞬时错误失败时，函数正常返回（不抛异常）
- [ ] 降级放行时记录 `console.warn` 日志：`"content security check degraded"`，包含 openid 前 8 位、scene、错误码、内容长度
- [ ] `degradeOnUnavailable` 为 true 但错误是 `CONTENT_SECURITY_REJECTED`（内容被明确拒绝）时，仍抛出异常，不降级
- [ ] `index.js` 的 `failure` 函数在 `CONTENT_SECURITY_UNAVAILABLE` 时额外记录 `error.cause` 信息（errCode、errMsg、错误类型）
- [ ] 新增测试：mock `msgSecCheck` 全部失败，`degradeOnUnavailable: true` → 函数正常返回，不抛异常
- [ ] 新增测试：mock `msgSecCheck` 返回 `suggest: "review"`，`degradeOnUnavailable: true` → 仍抛出 `CONTENT_SECURITY_REJECTED`
- [ ] 新增测试：mock `msgSecCheck` 全部失败，`degradeOnUnavailable: false` → 仍抛出 `CONTENT_SECURITY_UNAVAILABLE`
- [ ] 现有测试全部通过
