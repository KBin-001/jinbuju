# 04 — 页面：结束计时永不静默失败

**What to build:** 「结束计时」处理函数在页面丢失会话引用（`activeSessionId` 为空）时，先从 `getActiveActionSessionContext` 重新获取当前活跃会话再继续处理，而非静默 `return`。若确实无活跃会话，给出明确反馈（如 `wx.showToast`「当前没有进行中的计时」），保证按钮永远有响应。保留 `timerSubmitting` 防重复提交守卫，但其拦截也需有反馈。这使得任何情况下点击「结束计时」都不会出现毫无反应的情况。

**Blocked by:** 02 — 页面：悬浮计时条与日期、目标作用域解耦

**Status:** done

- [x] `requestFinishTimer` 在 `activeSessionId` 为空时，先调用 `getActiveActionSessionContext` 重新获取会话，而非直接 `return`
- [x] 重新获取到会话时，用其 id 继续正常的结束流程（弹 `wx.showModal` 确认）
- [x] 确实无活跃会话时，给出明确反馈（toast），而非静默返回
- [x] `finishActiveTimer` 同样在会话引用缺失时从全局重新获取
- [x] `timerSubmitting` 守卫拦截时给出反馈（如「正在保存，请稍候」），不静默返回
- [x] 点击「结束计时」在任何情况下都有可感知的响应
- [x] 页面契约测试覆盖重新获取会话的逻辑（断言存在从全局获取的逻辑而非直接 `return`）
- [x] 结束计时成功后悬浮条消失，投入正确累计（不回归现有 `finishActionSession` 行为）
