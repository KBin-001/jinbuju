# 01 — 主题层：更新字体族变量与字重令牌

**What to build:** 更新 `theme.wxss` 中三个字体族 CSS 变量的值为设计要求的优先栈，新增标题与数字的字重令牌，并更新 `app.wxss` 全局默认字体引用。这是排版体系统一的基础层——只改变量定义和全局默认值，不触碰各页面的硬编码字体（留给 issue 03）。本 issue 完成后，所有已使用 `var(--font-family-*)` 变量的位置自动获得新字体；硬编码位置仍需 issue 03 处理。

具体修改：

1. `theme.wxss` Typography 区块：
   - `--font-family-brand` 更新为：`"Source Han Serif SC", "思源宋体", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", serif`
   - `--font-family-sans` 保持不变（已包含 `"PingFang SC"` 和 `"HarmonyOS Sans SC"`）
   - `--font-family-numeric` 更新为：`"Inter", "DIN Alternate", "Avenir Next", "Helvetica Neue", Arial, sans-serif`
   - 新增 `--font-weight-title: 500`（思源宋体 Medium）
   - 新增 `--font-weight-numeric: 600`（Inter SemiBold）

2. `app.wxss` 全局默认：
   - `page` 选择器的 `font-family` 从硬编码 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif` 改为 `var(--font-family-sans)`
   - `.tab-header__title` 的 `font-family` 从硬编码 `"Songti SC", "STSong", SimSun, serif` 改为 `var(--font-family-brand)`
   - `.tab-header__title` 的 `font-weight` 从 `700` 改为 `var(--font-weight-title)`
   - `.page-title` 补充 `font-family: var(--font-family-brand)`，`font-weight` 从 `700` 改为 `var(--font-weight-title)`

**Blocked by:** 无 — 可立即开始

**Status:** done

- [x] `--font-family-brand` 包含 `"Source Han Serif SC"` 或 `"思源宋体"`，并回退到 `"Songti SC"`
- [x] `--font-family-sans` 包含 `"PingFang SC"` 和 `"HarmonyOS Sans SC"`（值不变，确认未被误改）
- [x] `--font-family-numeric` 包含 `"Inter"`，并回退到 `"DIN Alternate"`
- [x] `theme.wxss` 新增 `--font-weight-title: 500`
- [x] `theme.wxss` 新增 `--font-weight-numeric: 600`
- [x] `app.wxss` 的 `page` 选择器使用 `var(--font-family-sans)` 而非硬编码字体栈
- [x] `app.wxss` 的 `.tab-header__title` 使用 `var(--font-family-brand)` 而非硬编码 `"Songti SC"`
- [x] `app.wxss` 的 `.tab-header__title` 使用 `var(--font-weight-title)` 而非 `700`
- [x] `app.wxss` 的 `.page-title` 使用 `var(--font-family-brand)` 和 `var(--font-weight-title)`
- [x] 不修改任何页面级或组件级 WXSS 文件的 `font-family` 声明（留给 issue 03）
- [x] 不修改任何业务逻辑、数据结构或页面交互
