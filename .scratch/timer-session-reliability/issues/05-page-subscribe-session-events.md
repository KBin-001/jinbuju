# 05 — 页面：订阅会话变更事件实现即时同步

**What to build:** 今日页 `onLoad` 中新增对 `action-session:update` 事件的订阅，回调里刷新活跃会话状态（调用 `refreshActiveSession()` 轻量刷新或 `load()` 全量刷新，按变更影响面决定）。`onUnload` 中取消订阅，避免内存泄漏。这使得从专注计时页（独立页面）或后台同步改变会话状态后，返回今日页时计时条即时同步，而不只依赖 `onShow → load()` 的全量重载。

**Blocked by:** 02 — 页面：悬浮计时条与日期、目标作用域解耦

**Status:** done

- [x] 今日页 `onLoad` 订阅 `action-session:update` 事件
- [x] 今日页 `onUnload` 取消订阅 `action-session:update` 事件
- [x] 事件回调刷新活跃会话状态（计时条显示、耗时、状态文案同步更新）
- [x] 从专注计时页结束会话后返回今日页，计时条已消失，无需等待 `onShow` 全量刷新
- [x] 从专注计时页暂停会话后返回今日页，计时条显示暂停态
- [x] 后台同步改变会话状态后，今日页计时条同步更新
- [x] 取消订阅正确执行，无内存泄漏（`off` 与 `on` 配对）
- [x] 页面契约测试覆盖订阅与取消订阅的接线
- [x] 不影响现有的 `profile:update` 和 `goal:focus:update` 事件订阅
