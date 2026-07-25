Status: done

# 排版字体体系统一：思源宋体标题 / 苹方正文 / Inter 数字

## Problem Statement

项目的排版字体长期处于不一致状态。`theme.wxss` 虽然定义了三个字体族 CSS 变量（`--font-family-brand`、`--font-family-sans`、`--font-family-numeric`），但绝大多数页面和组件直接硬编码 `font-family` 值——标题用 `"Songti SC"`，数字用 `Georgia`，正文用内联 sans-serif 栈。这导致：

1. 想调整字体需要逐个修改 26+ 个文件，而非改一个变量。
2. 当前品牌衬线字体（"Songti SC"）和数字字体（"DIN Alternate"）不符合设计方向——"Songti SC" 仅 iOS 可用且字形偏粗硬，"DIN Alternate" 同样仅 iOS 可用，Android 端完全回退到系统默认。
3. 没有任何网络字体加载机制（`wx.loadFontFace`），无法使用设计要求的 Inter 等非系统字体。
4. 标题统一使用 `font-weight: 700`（粗体），与设计要求的思源宋体 Medium（500）不一致，视觉过重。

用户希望将全项目排版统一为：页面标题用思源宋体 Medium、所有功能文字用苹方 / HarmonyOS Sans SC、所有核心数字用 Inter SemiBold。

## Solution

将所有排版收敛到 `theme.wxss` 中既有的三个 CSS 变量，把项目中每一处硬编码 `font-family` 替换为对应变量，新增标题与数字的字重令牌，并通过 `wx.loadFontFace` 加载 Inter 网络字体供数字使用。具体：

- **页面标题**：更新 `--font-family-brand` 为思源宋体优先栈（`"Source Han Serif SC", "思源宋体", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", serif`），新增 `--font-weight-title: 500`（Medium），将所有标题的 `font-weight` 从 700 调整为 500。
- **功能文字**：`--font-family-sans` 已包含 `"PingFang SC"` 和 `"HarmonyOS Sans SC"`，无需修改栈本身；将所有硬编码 sans-serif 替换为 `var(--font-family-sans)`。
- **核心数字**：更新 `--font-family-numeric` 为 Inter 优先栈（`"Inter", "DIN Alternate", "Avenir Next", "Helvetica Neue", Arial, sans-serif`），新增 `--font-weight-numeric: 600`（SemiBold），在 `app.ts` 启动时通过 `wx.loadFontFace` 加载 Inter SemiBold。
- **消除硬编码**：全局扫描所有 WXSS 文件，将 `"Songti SC"`、`Georgia`、内联 sans-serif 栈等硬编码值替换为对应变量引用。

## User Stories

1. 作为产品负责人，我希望全项目的页面标题统一使用思源宋体 Medium，这样标题具有东方气质但不显粗硬，与现代东方山水风格一致。
2. 作为产品负责人，我希望全项目的功能文字统一使用苹方 / HarmonyOS Sans SC，这样正文在不同设备上都有清晰、现代的无衬线阅读体验。
3. 作为产品负责人，我希望全项目的核心数字统一使用 Inter SemiBold，这样数据展示具有专业感和一致性，不再因设备差异而字形跳变。
4. 作为开发者，我希望所有字体族只通过 `theme.wxss` 中的 CSS 变量控制，这样未来调整字体只需改一处，而非搜索 26+ 个文件。
5. 作为开发者，我希望所有标题字重通过 `--font-weight-title` 变量控制，这样可以统一调整标题粗细，不必逐页修改。
6. 作为开发者，我希望所有数字字重通过 `--font-weight-numeric` 变量控制，这样数字的视觉权重可统一管理。
7. 作为今日页用户，我看到页面顶部标题以思源宋体 Medium 呈现，视觉温润而不厚重，与山水背景和谐共存。
8. 作为今日页用户，我看到行动列表的任务名称、状态标签、按钮文字以苹方 / HarmonyOS Sans SC 呈现，在不同手机上均清晰可读。
9. 作为今日页用户，我看到今日投入时间、完成数量等核心数字以 Inter SemiBold 呈现，数字等宽对齐，专业感强。
10. 作为进度页用户，我看到当前目标标题以思源宋体 Medium 呈现，累计投入与完成行动数等核心数据以 Inter SemiBold 呈现。
11. 作为进度页用户，我看到趋势图的坐标轴数字以 Inter SemiBold 呈现，刻度等宽对齐，不会因数字宽度不同而错位。
12. 作为小队页用户，我看到小队名称以思源宋体 Medium 呈现，成员榜单的投入时间以 Inter SemiBold 呈现。
13. 作为小队页用户，我看到房间号以 Inter SemiBold 呈现，数字清晰醒目，便于识别和复制。
14. 作为我的页用户，我看到个人资料区的名称以思源宋体 Medium 呈现，本周摘要的数据以 Inter SemiBold 呈现。
15. 作为欢迎页用户，我看到品牌名称与主标题以思源宋体 Medium 呈现，首次进入即建立东方山水的品牌印象。
16. 作为设置类页面用户，我看到页面标题以思源宋体 Medium 呈现，正文以苹方呈现，与主 Tab 页面风格一致。
17. 作为使用 Android 手机的用户，我看到标题在思源宋体不可用时回退到 Noto Serif CJK SC 或系统衬线字体，而不是直接变成无衬线。
18. 作为使用 iOS 手机的用户，我看到标题在思源宋体不可用时回退到 Songti SC（宋体），保持衬线风格一致。
19. 作为使用 HarmonyOS 设备的用户，我看到功能文字使用 HarmonyOS Sans SC 呈现，与系统字体一致。
20. 作为用户，我在网络较差时仍能看到数字以系统字体回退呈现（DIN Alternate / Avenir Next），不会因 Inter 加载失败而出现空白或破图。
21. 作为用户，Inter 字体加载成功后数字自动切换为 Inter SemiBold，加载过程中不影响阅读，不会出现明显的字体闪烁。
22. 作为开发者，我希望 Inter 字体通过 `wx.loadFontFace` 在应用启动时加载一次，全局生效，而非每个页面重复加载。
23. 作为开发者，我希望 Inter 加载失败时静默回退到系统字体，不弹出错误提示，不影响用户使用。
24. 作为开发者，我希望法律页面（隐私政策、用户协议）的排版也遵循统一字体体系，不遗留独立的硬编码字体。
25. 作为开发者，我希望自定义 TabBar 的字体也使用 `--font-family-sans` 变量，不硬编码字体栈。
26. 作为开发者，我希望有一个契约测试能自动检测是否有 WXSS 文件重新硬编码了字体族，这样未来回归时 CI 能立即发现。
27. 作为开发者，我希望契约测试能验证 `theme.wxss` 中三个字体族变量的值包含正确的字体名称，防止误改。
28. 作为开发者，我希望契约测试能验证 `app.ts` 中存在 Inter 字体加载逻辑，防止被误删。
29. 作为开发者，我希望所有使用数字字体的元素同时声明 `font-variant-numeric: tabular-nums`，这样数字等宽对齐，不会跳动。
30. 作为用户，我在系统字体放大设置下，标题与正文仍保持合理的字重比例，不会因标题过粗而压迫正文。

## Implementation Decisions

### 1. 更新 `theme.wxss` 字体族变量

将三个字体族变量更新为设计要求的优先栈：

- `--font-family-brand`：`"Source Han Serif SC", "思源宋体", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", serif` — 思源宋体优先，iOS 回退 Songti SC，Android 回退 Noto Serif CJK SC，Windows 回退 SimSun。
- `--font-family-sans`：保持不变 — `-apple-system, BlinkMacSystemFont, "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif`（已包含苹方与 HarmonyOS Sans SC）。
- `--font-family-numeric`：`"Inter", "DIN Alternate", "Avenir Next", "Helvetica Neue", Arial, sans-serif` — Inter 优先，iOS 回退 DIN Alternate，其他设备回退 Avenir Next / Helvetica Neue。

### 2. 新增字重令牌

在 `theme.wxss` Typography 区块新增：

- `--font-weight-title: 500` — 思源宋体 Medium，用于所有页面标题。
- `--font-weight-numeric: 600` — Inter SemiBold，用于所有核心数字。

### 3. 更新 `app.wxss` 全局默认

- `page` 选择器的 `font-family` 从硬编码改为 `var(--font-family-sans)`。
- `.tab-header__title` 的 `font-family` 从硬编码 `"Songti SC"` 改为 `var(--font-family-brand)`，`font-weight` 从 `700` 改为 `var(--font-weight-title)`。
- `.page-title` 的 `font-family` 补充 `var(--font-family-brand)`，`font-weight` 从 `700` 改为 `var(--font-weight-title)`。

### 4. 加载 Inter 网络字体

在 `app.ts` 的 `onLaunch` 中调用 `wx.loadFontFace` 加载 Inter SemiBold（weight 600）：

- 字体来源使用 HTTPS 远程 URL（woff2 格式，从可靠 CDN 加载）。
- `global: true` 使字体全局生效（所有页面）。
- 加载失败时静默处理（`catch` 吞错），回退到 `--font-family-numeric` 中的系统字体。
- Inter 是纯拉丁字体，文件体积小（woff2 约 100-300KB），适合小程序网络加载。

### 5. 全局替换硬编码 `font-family`

扫描所有页面与组件的 WXSS 文件，将硬编码值替换为变量引用：

- 所有 `"Songti SC", "STSong", ...`（标题用）→ `var(--font-family-brand)`，并将对应 `font-weight: 700` 调整为 `var(--font-weight-title)`。
- 所有 `Georgia, "Times New Roman", serif`（数字用）→ `var(--font-family-numeric)`，并补充 `font-variant-numeric: tabular-nums`（若缺失）和 `font-weight: var(--font-weight-numeric)`。
- 所有 `-apple-system, BlinkMacSystemFont, "PingFang SC", ...`（正文用）→ `var(--font-family-sans)`。
- `styles/legal.wxss` 中的 `"Songti SC"` 同样替换为 `var(--font-family-brand)`。
- `custom-tab-bar/index.wxss` 中的内联字体栈替换为 `var(--font-family-sans)`。

涉及的文件包括（但不限于）：`app.wxss`、`styles/theme.wxss`、`styles/legal.wxss`、`custom-tab-bar/index.wxss`，以及 `pages/` 和 `components/` 下所有包含 `font-family` 声明的 WXSS 文件。

### 6. 不引入新依赖、不改变设计令牌体系

- 不引入新的 CSS 框架或字体加载库。
- 不建立第二套字体变量；只更新既有三个变量的值。
- 不修改 TDesign 组件内部的字体声明（TDesign 组件通过 `--td-*` 变量桥接，已继承页面字体）。
- 不修改任何业务逻辑、数据结构或页面交互。

### 7. 思源宋体不通过网络字体加载

思源宋体（Source Han Serif / Noto Serif CJK SC）是 CJK 字体，完整文件超过 10MB，在小程序中通过网络加载不现实。因此采用字体族栈优先声明 + 系统回退策略：设备已安装思源宋体或 Noto Serif CJK SC 时自动使用，否则回退到 iOS Songti SC 或系统衬线字体。这与 AGENTS.md 第 6.3 节「标题可少量使用具有东方气质的字体表达」一致。

## Testing Decisions

### 什么算好测试

只测外部行为与契约约定，不测 CSS 渲染结果。对于排版系统，「外部行为」即：主题文件定义了正确的变量值、页面文件不硬编码应使用变量的字体族、Inter 加载逻辑存在。这些都可以通过「读取文件文本 + 正则断言」来验证，与项目既有的契约测试模式一致。

### Seam 1（唯一 seam，契约）— 排版契约测试

新建一个契约测试文件（`tests/typography-contract.test.js`），遵循项目既有的 `node` + `node:assert` + 文件文本读取模式。断言覆盖：

- `theme.wxss` 中 `--font-family-brand` 包含 `"Source Han Serif SC"` 或 `"思源宋体"`。
- `theme.wxss` 中 `--font-family-sans` 包含 `"PingFang SC"` 和 `"HarmonyOS Sans SC"`。
- `theme.wxss` 中 `--font-family-numeric` 包含 `"Inter"`。
- `theme.wxss` 中存在 `--font-weight-title: 500` 和 `--font-weight-numeric: 600`。
- `app.ts` 中存在 `wx.loadFontFace` 调用且引用 Inter。
- `app.wxss` 中 `page` 选择器的 `font-family` 使用 `var(--font-family-sans)` 而非硬编码。
- `app.wxss` 中 `.tab-header__title` 使用 `var(--font-family-brand)` 而非硬编码 `"Songti SC"`。
- 扫描所有页面与组件 WXSS 文件，不得出现硬编码的 `"Songti SC"`、`Georgia`、`STSong`（`theme.wxss` 变量声明本身除外）。

### 既有先验

项目已有多个契约测试文件（如 `performance-resource-contract.test.js`、`coach-chat-contract.test.js`），均采用 `node:assert/strict` + `fs.readFileSync` + 正则匹配的模式，读取 WXSS/WXML/TS 文件文本并断言关键模式存在或不存在。本测试完全复用该模式，无需引入新测试框架（项目无 jest，测试以纯 `node` 运行）。

## Out of Scope

- 不修改任何业务逻辑、数据结构、页面交互或云函数。
- 不为思源宋体加载网络字体（CJK 字体体积过大，不现实）。
- 不修改 TDesign 组件库内部的字体声明。
- 不引入新的 CSS 框架、动画库或字体加载库。
- 不调整字号令牌（`--font-page-title`、`--font-body` 等保持不变）。
- 不修改 `scripts/patch-tdesign-icon-font.js`（该脚本处理 TDesign 图标字体，与排版字体无关）。
- 不调整字母间距（letter-spacing）令牌——各页面既有的 letter-spacing 保持不变。
- 不为 Inter 字体做本地打包（使用远程 CDN 加载，避免增大包体）。

## Further Notes

- 本特性是纯样式体系统一，不涉及数据正确性或用户隐私，风险低。
- Inter 字体加载为异步过程，加载完成前数字使用系统回退字体（DIN Alternate / Avenir Next），加载完成后自动切换。`wx.loadFontFace` 的 `global: true` 选项确保一次加载全局生效。
- 思源宋体在 iOS 上回退到 Songti SC，二者字形接近但非完全相同。Songti SC 支持 `font-weight: 500`（Medium），视觉效果与思源宋体 Medium 接近。
- Android 设备若安装了 Noto Serif CJK SC（许多 Android 设备默认安装），将自动使用该字体，与思源宋体同源同设计。
- 标题 `font-weight` 从 700 降至 500 后，视觉上会更轻盈。这与 AGENTS.md「现代、年轻、安静、有品质」的风格定位一致——过粗的标题会显得沉重。
- 替换硬编码字体时需注意：部分文件中 `Georgia` 用于非数字场景（如装饰性序号、印章效果），需逐处判断是否应改为 `--font-family-numeric` 还是保留为 `--font-family-brand`。
- `legal.wxss` 中有两处 `"Songti SC"` 用于法律文档标题，应替换为 `var(--font-family-brand)` 以保持一致。
- 风险点：`wx.loadFontFace` 的 CDN URL 需选择稳定可靠的服务源，避免因 CDN 不可达导致 Inter 永久无法加载（虽有系统回退，但会影响数字视觉一致性）。
