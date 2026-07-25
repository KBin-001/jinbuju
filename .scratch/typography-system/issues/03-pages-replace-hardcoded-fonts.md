# 03 — 批量替换：pages/ 目录消除硬编码 font-family

**What to build:** 扫描 `pages/` 目录下所有 WXSS 文件，将每一处硬编码的 `font-family` 声明替换为对应的 CSS 变量引用。这是排版体系统一批量替换层的第一批——issue 01 已更新变量值，本 issue 确保所有页面级 WXSS 都通过变量引用而非硬编码值。完成后，所有页面标题自动使用思源宋体优先栈，数字使用 Inter 优先栈，正文使用苹方 / HarmonyOS Sans SC 栈。

替换规则：

| 硬编码模式 | 替换为 | 说明 |
|---|---|---|
| `"Songti SC", "STSong", ...`（标题用） | `var(--font-family-brand)` | 同时将对应 `font-weight: 700` 调整为 `var(--font-weight-title)` |
| `Georgia, "Times New Roman", serif`（数字用） | `var(--font-family-numeric)` | 同时补充 `font-variant-numeric: tabular-nums`（若缺失）和 `font-weight: var(--font-weight-numeric)` |
| `-apple-system, BlinkMacSystemFont, "PingFang SC", ...`（正文用） | `var(--font-family-sans)` | |
| `Georgia, serif`（数字用，简写） | `var(--font-family-numeric)` | 同上 |

涉及文件（基于全项目扫描，可能不完全）：

- `pages/welcome/index.wxss` — `"Songti SC"` + `Georgia`
- `pages/team/index.wxss` — 多处 `"Songti SC"` + `Georgia`
- `pages/team-members/index.wxss` — 多处 `"Songti SC"` + `Georgia`
- `pages/team-invite/index.wxss` — `"Songti SC"` + `Georgia`
- `pages/team-activity/index.wxss` — 多处 `"Songti SC"`
- `pages/index/index.wxss` — 多处 `"Songti SC"` + `Georgia`
- `pages/profile/index.wxss` — 多处 `"Songti SC"`
- `pages/growth-records/index.wxss` — `"Songti SC"` + `Georgia`
- `pages/goal-review/index.wxss` — 多处 `"Songti SC"`
- `pages/goal-manage/index.wxss` — `"Songti SC"`
- `pages/goal-detail/index.wxss` — `"Songti SC"`
- `pages/goal-create/index.wxss` — `"Songti SC"`
- `pages/daily-coach/index.wxss` — `Georgia`
- `pages/ai-coach/index.wxss` — `Georgia`
- `pages/today-data/index.wxss` — `"Songti SC"`
- `pages/data-sync/index.wxss` — `"Songti SC"`
- `pages/action-records/index.wxss` — `"Songti SC"`
- `pages/action-edit/index.wxss` — `"Songti SC"`
- `pages/account-security/index.wxss` — `"Songti SC"`
- `pages/privacy-center/index.wxss` — `"Songti SC"`
- `pages/about/index.wxss` — `"Songti SC"`
- `pages/stage-review/index.wxss` — `"Songti SC"`
- `pages/share-card/index.wxss` — `"Songti SC"`

注意事项：

- 部分文件中 `Georgia` 用于装饰性序号或印章效果（如 `.empty-seal`、`.state-seal`），这些场景应改为 `var(--font-family-brand)` 而非 `var(--font-family-numeric)`，因为它们是装饰性文字而非数据数字。需逐处判断。
- `theme.wxss` 中的变量声明本身保留硬编码值（这是变量定义处），不替换。

**Blocked by:** 01 — 主题层：更新字体族变量与字重令牌

**Status:** done

- [x] `pages/` 下所有 WXSS 文件中不存在硬编码的 `"Songti SC"`、`STSong`、`SimSun`
- [x] `pages/` 下所有 WXSS 文件中不存在硬编码的 `Georgia`、`"Times New Roman"`
- [x] `pages/` 下所有 WXSS 文件中不存在硬编码的 `-apple-system, BlinkMacSystemFont` 内联栈
- [x] 原本使用 `"Songti SC"` 的标题元素已改为 `var(--font-family-brand)`，且 `font-weight` 调整为 `var(--font-weight-title)`
- [x] 原本使用 `Georgia` 的数字元素已改为 `var(--font-family-numeric)`，且补充 `font-variant-numeric: tabular-nums` 和 `font-weight: var(--font-weight-numeric)`
- [x] 装饰性印章/序号文字（如 `.empty-seal`、`.state-seal`）改用 `var(--font-family-brand)` 而非 `var(--font-family-numeric)`
- [x] 不修改任何业务逻辑、数据结构或页面交互
