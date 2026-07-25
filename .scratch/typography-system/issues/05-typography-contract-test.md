# 05 — 护栏：排版契约测试

**What to build:** 新建一个契约测试文件 `tests/typography-contract.test.js`，遵循项目既有的 `node` + `node:assert/strict` + `fs.readFileSync` + 正则匹配模式，自动验证排版体系的约定不被回归。这是本特性唯一的测试 seam——通过文件文本断言而非渲染结果断言，与项目已有的 `performance-resource-contract.test.js`、`coach-chat-contract.test.js` 等契约测试模式一致。

测试断言覆盖：

1. **主题变量正确性**（读取 `styles/theme.wxss`）：
   - `--font-family-brand` 包含 `"Source Han Serif SC"` 或 `"思源宋体"`
   - `--font-family-brand` 包含 `"Songti SC"`（回退）
   - `--font-family-sans` 包含 `"PingFang SC"` 和 `"HarmonyOS Sans SC"`
   - `--font-family-numeric` 包含 `"Inter"`
   - `--font-family-numeric` 包含 `"DIN Alternate"`（回退）
   - 存在 `--font-weight-title: 500`
   - 存在 `--font-weight-numeric: 600`

2. **Inter 字体加载存在**（读取 `app.ts`）：
   - 存在 `wx.loadFontFace` 调用
   - 调用参数中包含 `"Inter"`
   - 存在 `global: true` 或等效全局配置

3. **全局默认使用变量**（读取 `app.wxss`）：
   - `page` 选择器的 `font-family` 使用 `var(--font-family-sans)`，不硬编码 `-apple-system`
   - `.tab-header__title` 使用 `var(--font-family-brand)`，不硬编码 `"Songti SC"`

4. **无硬编码字体族回归**（扫描所有页面与组件 WXSS）：
   - 遍历 `pages/` 和 `components/` 下所有 `.wxss` 文件
   - 每个文件中不得出现 `"Songti SC"`、`Georgia`、`STSong`（硬编码值）
   - `styles/theme.wxss` 本身豁免（变量定义处允许硬编码）
   - `styles/legal.wxss` 不豁免（应使用变量）
   - `scripts/patch-tdesign-icon-font.js` 豁免（TDesign 图标字体内部处理，非排版字体）

**Blocked by:** 01, 02, 03, 04 — 需要前四项完成后测试才能通过

**Status:** done

- [x] `tests/typography-contract.test.js` 文件存在
- [x] 测试断言 `--font-family-brand` 包含思源宋体相关名称
- [x] 测试断言 `--font-family-sans` 包含苹方与 HarmonyOS Sans SC
- [x] 测试断言 `--font-family-numeric` 包含 Inter
- [x] 测试断言 `--font-weight-title: 500` 和 `--font-weight-numeric: 600` 存在
- [x] 测试断言 `app.ts` 中存在 `wx.loadFontFace` 且引用 Inter
- [x] 测试断言 `app.wxss` 的 `page` 和 `.tab-header__title` 使用变量而非硬编码
- [x] 测试扫描所有页面与组件 WXSS，断言无硬编码 `"Songti SC"`、`Georgia`、`STSong`
- [x] `theme.wxss` 和 `scripts/patch-tdesign-icon-font.js` 在扫描中被豁免
- [x] 测试以 `node tests/typography-contract.test.js` 运行通过
- [x] 测试文件遵循项目既有模式：`node:assert/strict` + `fs.readFileSync` + 正则匹配
