Status: ready-for-agent

# 内容安全检测韧性：msgSecCheck 瞬时故障不阻断 AI 对话

## Problem Statement

用户在使用 AI 教练对话时，每次发送消息都收到"内容安全检测暂不可用，请稍后重试。"，整个 AI 对话功能完全不可用。

根因：`generatePlan` 云函数在处理 `askProgressCoach` 请求时，会对用户输入文本和 AI 输出文本分别调用微信 `msgSecCheck` API 做内容安全检测。当 `msgSecCheck` API 调用抛出异常（网络故障、配额耗尽、服务不可用等），当前代码将所有非风险类错误（非 87014/87015）统一归为 `CONTENT_SECURITY_UNAVAILABLE` 并直接抛出，导致整个操作被阻断。

当前设计存在三个缺陷：

1. **无重试**：`msgSecCheck` 单次失败即彻底阻断，不区分瞬时故障和永久故障。网络抖动、短时限流等常见瞬时场景没有任何容错。
2. **无错误日志**：`contentSecurityError` 将底层异常附加到 `cause` 字段，但 `index.js` 的 `failure` 函数只记录 `error.code` 和 `error.message`，从不记录 `error.cause`。开发者无法从日志中得知 `msgSecCheck` 到底为什么失败（是 `TypeError`、超时、配额耗尽还是权限问题）。
3. **全量 fail-closed**：无论是用户输入还是 AI 输出，无论是 AI 对话还是创建任务，`msgSecCheck` 故障都会阻断整个操作。对于 AI 教练对话这种用户与个人教练私下交流的场景，内容风险远低于公开发布内容，fail-closed 过于激进。

**2026-07-25 修订**：原 spec 只对输入检测降级，AI 输出检测保持 fail-closed。实际运行发现这不足以解决问题：输入检测降级放行后，AI 成功生成回复，但 AI 输出检测仍然 fail-closed，导致 `askProgressCoach` 整体失败。用户能发消息但永远收不到回复，体验比完全不能对话更糟糕。因此 AI 输出检测也需要在 `askProgressCoach` 场景下降级放行。

**2026-07-25 修订 2**：发现 `callMsgSecCheck` 中非瞬时错误（TypeError、未知错误格式）直接抛出 `CONTENT_SECURITY_UNAVAILABLE`，不检查 `degradeOnUnavailable`。降级逻辑只在瞬时错误重试耗尽后生效。实际微信云环境中 `msgSecCheck` 抛出的错误可能没有标准 `errCode` 字段，被 `isTransientError` 判定为非瞬时，绕过降级。修复后非瞬时错误路径也检查 `degradeOnUnavailable`，并在 fail-closed 时记录 `console.error` 日志帮助诊断根因。

## Solution

在 `assertSafeText` 函数中增加三层韧性机制，使 `msgSecCheck` 的瞬时故障不再阻断 AI 对话，同时保持对真正风险内容的拦截能力。

**第一层：重试与退避**

对 `msgSecCheck` 调用增加有限次重试（默认 2 次，共 3 次尝试），每次重试之间有递增延迟（500ms、1000ms）。只对瞬时类错误重试：网络超时、连接重置、HTTP 5xx 等。对于明确的拒绝（87014/87015）或参数错误（4xxx），不重试，直接返回结果。

**第二层：底层错误日志**

在 `msgSecCheck` 抛出异常时，记录底层错误的 `errCode`、`errMsg` 和错误类型，使开发者能从云函数日志中诊断根因。日志级别为 `warn`（重试时）和 `error`（最终失败时），包含 `openid` 前缀（前 8 位）和 `scene` 参数。

**第三层：分级降级**

重试全部失败后，根据调用场景决定是否降级放行：

- **AI 教练对话（`askProgressCoach`）**：降级放行。AI 教练是用户与个人教练的私下对话，不产生公开内容；AI 模型本身有安全护栏；降级放行时记录 `warn` 日志，便于后续审计。
- **其他写入操作（创建任务、打卡、小队设置等）**：保持 fail-closed。这些操作会持久化用户输入内容，风险更高。
- **AI 输出检测（`askProgressCoach` 场景）**：降级放行。AI 输出内容由 AI 模型生成，模型本身有内容安全护栏；`msgSecCheck` 不可用是基础设施问题，不是内容问题；如果输入已降级放行但输出不降级，用户能发消息但收不到回复，体验更差。降级时记录 `warn` 日志，便于后续审计。
- **AI 输出检测（非 `askProgressCoach` 场景，如目标生成）**：保持 fail-closed。

降级策略通过 `assertSafeText` 的可选参数控制，默认 fail-closed。AI 对话的输入检测路径（`assertEventContentSafe`）和 AI 输出检测路径（`assertAiOutputSafe`）均显式传入降级标记。

## User Stories

1. 作为 AI 教练用户，我在与教练对话时，即使微信内容安全 API 出现短时波动，对话仍能正常进行，这样我不会因为基础设施故障而无法使用核心功能。
2. 作为 AI 教练用户，我在与教练对话时，如果内容安全 API 持续不可用，系统仍允许我继续对话，而不是反复提示"内容安全检测暂不可用"。
3. 作为 AI 教练用户，我输入的内容如果被检测为风险内容（真正被 `msgSecCheck` 拒绝），系统仍会拦截并提示我修改，这样内容安全底线不被突破。
4. 作为开发者，当 `msgSecCheck` 调用失败时，我能从云函数日志中看到具体的错误码和错误信息，这样我能快速定位是配额问题、权限问题还是网络问题。
5. 作为开发者，当 `msgSecCheck` 瞬时失败时，系统自动重试，大多数情况下用户无感知，这样减少了不必要的错误反馈。
6. 作为开发者，AI 对话的输入检测在 API 不可用时降级放行并记录日志，这样我可以在事后审查日志，同时不阻断用户使用。
7. 作为开发者，创建任务、打卡、小队设置等写入操作在 API 不可用时仍保持 fail-closed，这样持久化的用户输入内容始终经过安全检测。
8. 作为开发者，AI 生成的输出内容在 `askProgressCoach` 场景下，当 API 不可用时也降级放行并记录日志，这样用户不会因为基础设施故障而无法收到 AI 回复。非对话场景的 AI 输出检测仍保持 fail-closed。
9. 作为开发者，重试次数和退避间隔可通过环境变量配置，这样我可以在不同环境调整策略。
10. 作为开发者，降级策略是分级的——AI 对话输入降级放行、其他操作保持 fail-closed——这样安全与可用性之间取得合理平衡。
11. 作为开发者，重试只针对瞬时错误（网络故障、服务端错误），不针对明确的拒绝或参数错误，这样不会浪费 API 配额做无意义的重试。
12. 作为产品负责人，内容安全检测的降级策略只影响 AI 对话输入路径，不影响其他写入操作，这样合规风险可控。
13. 作为产品负责人，降级放行时记录的日志包含足够的信息用于事后审计（openid 前缀、时间、内容摘要长度），这样满足合规审查需求。
14. 作为 AI 教练用户，我在内容安全 API 恢复后继续对话时，不需要做任何额外操作，系统自动恢复正常检测流程。

## Implementation Decisions

### 修改的模块

- **`content-security.js`**：修改 `assertSafeText` 函数，增加重试、日志、降级能力。新增内部函数 `isTransientError` 判断错误是否值得重试。新增可选参数 `degradeOnUnavailable`（默认 `false`），调用方可显式传入 `true` 启用降级放行。
- **`ai.js`**：修改 `assertAiOutputSafe` 函数，接受 `dependencies.degradeOnUnavailable` 参数并透传给 `assertSafeText`。在 `generateMessagesWithMetadata` 和 `generateCoachActionIntent` 中对 AI 教练对话的输出检测传入 `degradeOnUnavailable: true`。`generateTextWithMetadata`（用于目标生成等非对话场景）保持 fail-closed。
- **`index.js`**：修改 `assertEventContentSafe` 调用，仅在 `askProgressCoach` action 时传入 `degradeOnUnavailable: true`。其他 action 保持默认 fail-closed。修改 `failure` 函数，在 `CONTENT_SECURITY_UNAVAILABLE` 错误时额外记录 `error.cause` 的信息。

### 接口变更

`assertSafeText` 函数签名从：

```
assertSafeText(openid, values, scene, securityApi)
```

变更为：

```
assertSafeText(openid, values, scene, securityApi, options)
```

其中 `options` 是可选对象：

```
{
  degradeOnUnavailable?: boolean,  // 默认 false。true 时 API 不可用后降级放行
  maxRetries?: number,             // 默认 2。瞬时错误的重试次数
  retryBaseDelayMs?: number,       // 默认 500。退避基准延迟
}
```

`assertEventContentSafe` 内部根据 action 决定是否传入 `degradeOnUnavailable`：

```
const degrade = action === "askProgressCoach";
await assertSafeText(openid, texts, scene, undefined, { degradeOnUnavailable: degrade });
```

### 重试策略

来自原型决策（非完整实现，表达判断逻辑）：

```
function isTransientError(error) {
  const code = Number(error?.errCode ?? error?.errcode ?? error?.code);
  // 87014/87015 是明确的内容风险拒绝，不重试
  if (code === 87014 || code === 87015) return false;
  // -1 是通用网络错误，值得重试
  if (code === -1) return true;
  // 4xxxx 是客户端错误（参数、权限），不重试
  if (code >= 40000 && code < 50000) return false;
  // 5xxxx 是服务端错误，值得重试
  if (code >= 50000) return true;
  // TypeError（securityApi 为 undefined 等）不重试
  if (error instanceof TypeError) return false;
  // 其他未知错误，保守不重试
  return false;
}
```

重试延迟：第 1 次重试等待 `retryBaseDelayMs`（500ms），第 2 次等待 `retryBaseDelayMs * 2`（1000ms）。

### 降级行为

当 `degradeOnUnavailable` 为 `true` 且所有重试都因瞬时错误失败时：
- 记录 `console.warn` 日志：`"content security check degraded"`，包含 `openid` 前 8 位、`scene`、错误码、内容长度。
- 不抛出异常，函数正常返回，等同于检测通过。
- 如果错误是 `CONTENT_SECURITY_REJECTED`（内容被明确拒绝），即使 `degradeOnUnavailable` 为 `true` 也不降级，仍然抛出异常。

### 日志增强

`index.js` 的 `failure` 函数在 `code === "CONTENT_SECURITY_UNAVAILABLE"` 时，额外记录：

```
console.error("content security unavailable", {
  cause: error.cause ? {
    errCode: error.cause.errCode ?? error.cause.errcode,
    errMsg: String(error.cause.errMsg || error.cause.message || "").slice(0, 200),
    errorType: error.cause.constructor?.name,
  } : null,
});
```

### 环境变量

- `CONTENT_SECURITY_MAX_RETRIES`：覆盖默认重试次数（默认 2）。
- `CONTENT_SECURITY_RETRY_BASE_DELAY_MS`：覆盖默认退避基准延迟（默认 500）。

这些环境变量是可选的，未设置时使用默认值。不需要修改 `config.json`。

## Testing Decisions

### 什么是一个好的测试

好的测试只验证外部行为，不验证实现细节。对于内容安全韧性，外部行为是：

- `msgSecCheck` 瞬时失败后重试成功时，函数正常返回（不抛异常）。
- `msgSecCheck` 重试全部失败且 `degradeOnUnavailable` 为 `true` 时，函数正常返回（不抛异常）。
- `msgSecCheck` 重试全部失败且 `degradeOnUnavailable` 为 `false` 时，函数抛出 `CONTENT_SECURITY_UNAVAILABLE`。
- `msgSecCheck` 返回 `suggest: "review"` 时，无论 `degradeOnUnavailable` 值，函数都抛出 `CONTENT_SECURITY_REJECTED`。
- `msgSecCheck` 抛出 87014 错误时，不重试，直接抛出 `CONTENT_SECURITY_REJECTED`。
- `msgSecCheck` 抛出 TypeError 时，不重试，直接抛出 `CONTENT_SECURITY_UNAVAILABLE`。

### 测试的模块

- `content-security.js` 的 `assertSafeText` 函数——通过 mock `securityApi` 测试重试、降级、拒绝行为。
- `index.js` 的 `assertEventContentSafe` 集成——验证 `askProgressCoach` action 启用降级、其他 action 不启用。

### 已有测试参考

- `content-security.test.js`：已有 `assertSafeText` 的 mock 测试模式，包括"API 不可用时 fail closed"的测试用例（第 50-57 行）。新测试可复用同样的 mock 模式，扩展为"瞬时错误重试成功"和"降级放行"场景。
- `ai-security.test.js`：已有 `assertAiOutputSafe` 的 mock 测试模式，验证 AI 输出检测行为。可扩展为"API 不可用时 fail closed 仍生效"的回归测试。

## Out of Scope

- 不修改 `msgSecCheck` 的调用参数（`version: 2`、`scene` 等）。API 参数的正确性是独立问题。
- 不修改 `imgSecCheck`（头像安全检测）的逻辑。头像检测频率低且不是 AI 对话路径，不在本次范围内。
- 不引入消息队列或异步检测机制。降级放行 + 日志审计已满足当前需求。
- 不修改前端错误提示文案。前端已有 `CONTENT_SECURITY_UNAVAILABLE` 的错误处理（`ai-coach/index.ts` 的 `errorMessage` 函数），降级放行后前端不会收到该错误。
- 不修改 `config.json` 的权限配置。`security.msgSecCheck` 权限已正确声明。
- 不修改 `assertSafeAvatar` 函数。头像安全检测不在 AI 对话路径上。

## Further Notes

- 本次问题的直接触发原因：`msgSecCheck` API 调用失败。具体失败原因（配额耗尽、网络故障、SDK 兼容性等）由于当前代码不记录底层错误而无法确认。本 spec 的第二层（错误日志）将使未来此类问题可在云函数日志中直接诊断。
- `msgSecCheck` 的 `version: 2` API 要求 `wx-server-sdk` 版本 >= 2.4.0，项目当前使用 `~2.4.0`，版本满足。但建议在日志增强后确认 SDK 版本是否实际支持 `version: 2` 的响应格式。
- 降级放行策略影响 `askProgressCoach` 的用户输入检测路径和 AI 输出检测路径。其他写入操作的内容安全检测和非对话场景的 AI 输出检测（如目标生成）始终保持 fail-closed，不会因降级而放宽安全底线。
- 重试逻辑会增加 `msgSecCheck` 的调用次数。在最坏情况下（3 次尝试全部失败），单次 AI 对话的输入检测会消耗 3 次 API 配额。如果配额本身是问题根因，重试会加速配额耗尽。但重试只针对瞬时错误，如果是配额耗尽（通常返回 4xxxx 错误码），`isTransientError` 会判定为不可重试，不会额外消耗配额。
