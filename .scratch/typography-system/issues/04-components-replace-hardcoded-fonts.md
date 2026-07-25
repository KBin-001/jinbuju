# 04 — 批量替换：components/ + styles/ + custom-tab-bar/ 消除硬编码 font-family

**What to build:** 扫描 `components/`、`styles/`、`custom-tab-bar/` 目录下所有 WXSS 文件，将每一处硬编码的 `font-family` 声明替换为对应的 CSS 变量引用。这是排版体系统一批量替换层的第二批，与 issue 03（pages/ 目录）独立并行。完成后，组件、法律页面和自定义 TabBar 的字体也统一通过变量控制，全项目不再有硬编码字体族（`theme.wxss` 变量声明除外）。

替换规则：

| 硬编码模式 | 替换为 | 说明 |
|---|---|---|
| `"Songti SC", "STSong", ...`（标题用） | `var(--font-family-brand)` | 同时将对应 `font-weight: 700` 调整为 `var(--font-weight-title)` |
| `Georgia, "Times New Roman", serif`（数字用） | `var(--font-family-numeric)` | 同时补充 `font-variant-numeric: tabular-nums`（若缺失）和 `font-weight: var(--font-weight-numeric)` |
| `-apple-system, BlinkMacSystemFont, "PingFang SC", ...`（正文用） | `var(--font-family-sans)` | |
| 内联 sans-serif 栈 | `var(--font-family-sans)` | custom-tab-bar 使用 |

涉及文件（约 6 个）：

- `components/today-action-list/index.wxss` — 内联 numeric 栈
- `components/daily-progress/index.wxss` — `"Songti SC"` + `Georgia`
- `components/ai-coach-tip/index.wxss` — `"Songti SC"`
- `components/active-timer-bar/index.wxss` — `"Songti SC"` + `Georgia`
- `styles/legal.wxss` — 2 处 `"Songti SC"`
- `custom-tab-bar/index.wxss` — 1 处内联 sans-serif 栈

注意事项：

- `styles/legal.wxss` 中有两处 `"Songti SC"` 用于法律文档标题，应替换为 `var(--font-family-brand)`。
- `custom-tab-bar/index.wxss` 中的内联字体栈替换为 `var(--font-family-sans)`。
- `theme.wxss` 中的变量声明本身保留硬编码值（这是变量定义处），不替换。
- `scripts/patch-tdesign-icon-font.js` 中的 `font-family:t` 是 TDesign 图标字体的内部处理，不替换。

**Blocked by:** 01 — 主题层：更新字体族变量与字重令牌

**Status:** done

- [x] `components/` 下所有 WXSS 文件中不存在硬编码的 `"Songti SC"`、`Georgia`、`STSong`
- [x] `styles/legal.wxss` 中的 `"Songti SC"` 已替换为 `var(--font-family-brand)`
- [x] `custom-tab-bar/index.wxss` 中的内联字体栈已替换为 `var(--font-family-sans)`
- [x] 原本使用 `"Songti SC"` 的标题元素已改为 `var(--font-family-brand)`，且 `font-weight` 调整为 `var(--font-weight-title)`
- [x] 原本使用 `Georgia` 的数字元素已改为 `var(--font-family-numeric)`，且补充 `font-variant-numeric: tabular-nums` 和 `font-weight: var(--font-weight-numeric)`
- [x] `scripts/patch-tdesign-icon-font.js` 不修改
- [x] 不修改任何业务逻辑、数据结构或页面交互
