# 02 — 应用层：加载 Inter 网络字体

**What to build:** 在 `app.ts` 的 `onLaunch` 中调用 `wx.loadFontFace` 加载 Inter SemiBold（weight 600），使全项目数字可以使用 Inter 字体。Inter 是纯拉丁字体，文件体积小（woff2 约 100-300KB），适合小程序网络加载。加载失败时静默回退到 `--font-family-numeric` 中的系统字体（DIN Alternate / Avenir Next），不影响用户使用。

实现要点：

- 在 `app.ts` 的 `onLaunch` 中，`initCloud()` 之后、`applyGlobalTheme()` 附近，新增 `wx.loadFontFace` 调用。
- 字体来源使用 HTTPS 远程 URL，格式为 woff2。推荐使用 jsDelivr 或类似 CDN 上 Inter 字体的 SemiBold（600）字重文件。
- 设置 `global: true` 使字体一次加载、全局生效（所有页面）。
- 设置 `scope: 'global'`（微信基础库 2.10.0+ 支持）。
- 加载失败时 `catch` 吞错，不弹出错误提示，不阻断启动流程。
- 可选：在 `complete` 或 `fail` 回调中不做任何操作，确保静默回退。

**Blocked by:** 无 — 可与 issue 01 并行开始

**Status:** done

- [x] `app.ts` 的 `onLaunch` 中存在 `wx.loadFontFace` 调用
- [x] `wx.loadFontFace` 的 `family` 参数为 `"Inter"`
- [x] `wx.loadFontFace` 的 `source` 参数为 HTTPS URL，指向 woff2 格式的 Inter SemiBold 字体文件
- [x] `wx.loadFontFace` 设置 `global: true`（或等效的全局生效配置）
- [x] 加载失败时有 `catch` 或 `fail` 回调处理，不弹出错误提示，不阻断启动
- [x] 不修改 `onLaunch` 中既有的 `initCloud()`、`bootstrapAccount()`、`applyGlobalTheme()` 调用
- [x] 不引入新的 npm 依赖
- [x] 不修改任何 WXSS 文件（字体族变量更新由 issue 01 完成）
