const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const theme = read("miniprogram/styles/theme.wxss");
const appStyles = read("miniprogram/app.wxss");
const appTs = read("miniprogram/app.ts");

/**
 * Extract the declaration body of a CSS rule (first match).
 * Handles simple non-nested blocks only, which is sufficient for theme.wxss / app.wxss.
 */
function extractRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + "\\s*\\{([^}]*)\\}");
  const m = css.match(re);
  return m ? m[1] : "";
}

// ── 1. 主题变量正确性（theme.wxss）─────────────────────────────────────────

assert.match(
  theme,
  /--font-family-brand:\s*"[^"]*Source Han Serif SC[^"]*"/,
  "--font-family-brand 必须包含 Source Han Serif SC",
);
assert.match(
  theme,
  /--font-family-brand:\s*[^;]*"Songti SC"/,
  "--font-family-brand 必须回退到 Songti SC",
);
assert.match(
  theme,
  /--font-family-sans:\s*[^;]*"PingFang SC"/,
  "--font-family-sans 必须包含 PingFang SC",
);
assert.match(
  theme,
  /--font-family-sans:\s*[^;]*"HarmonyOS Sans SC"/,
  "--font-family-sans 必须包含 HarmonyOS Sans SC",
);
assert.match(
  theme,
  /--font-family-numeric:\s*[^;]*"Inter"/,
  "--font-family-numeric 必须包含 Inter",
);
assert.match(
  theme,
  /--font-family-numeric:\s*[^;]*"DIN Alternate"/,
  "--font-family-numeric 必须回退到 DIN Alternate",
);
assert.match(theme, /--font-weight-title:\s*500/, "theme.wxss 必须定义 --font-weight-title: 500");
assert.match(theme, /--font-weight-numeric:\s*600/, "theme.wxss 必须定义 --font-weight-numeric: 600");

// ── 2. Inter 字体加载存在（app.ts）──────────────────────────────────────────

assert.ok(
  /wx\.loadFontFace\s*\(/.test(appTs),
  "app.ts 的 onLaunch 中必须调用 wx.loadFontFace",
);
assert.match(
  appTs,
  /family:\s*["']Inter["']/,
  "wx.loadFontFace 的 family 参数必须为 \"Inter\"",
);
assert.match(
  appTs,
  /source:\s*["']url\(["']?https:\/\/[^"')]*\.woff2["']?\)["']/,
  "wx.loadFontFace 的 source 必须是 HTTPS URL 且指向 woff2 格式",
);
assert.match(
  appTs,
  /global:\s*true/,
  "wx.loadFontFace 必须设置 global: true",
);
assert.ok(
  /\.catch\s*\(|fail:/.test(appTs),
  "wx.loadFontFace 必须有 catch 或 fail 回调处理失败，不阻断启动",
);
assert.match(appTs, /initCloud\s*\(/, "onLaunch 必须保留 initCloud() 调用");
assert.match(appTs, /bootstrapAccount\s*\(/, "onLaunch 必须保留 bootstrapAccount() 调用");
assert.match(appTs, /applyGlobalTheme\s*\(/, "onLaunch 必须保留 applyGlobalTheme() 调用");

// ── 3. 全局默认使用变量（app.wxss）──────────────────────────────────────────

const pageRule = extractRule(appStyles, "page");
assert.ok(
  /font-family:\s*var\(--font-family-sans\)/.test(pageRule),
  "app.wxss 的 page 选择器必须使用 var(--font-family-sans) 而非硬编码字体栈",
);
assert.ok(
  !/font-family:\s*-apple-system/.test(pageRule),
  "app.wxss 的 page 选择器不得残留硬编码 -apple-system 字体栈",
);

const tabTitleRule = extractRule(appStyles, ".tab-header__title");
assert.ok(
  /font-family:\s*var\(--font-family-brand\)/.test(tabTitleRule),
  ".tab-header__title 必须使用 var(--font-family-brand) 而非硬编码 Songti SC",
);
assert.ok(
  !/"Songti SC"/.test(tabTitleRule),
  ".tab-header__title 不得残留硬编码 \"Songti SC\"",
);
assert.ok(
  /font-weight:\s*var\(--font-weight-title\)/.test(tabTitleRule),
  ".tab-header__title 必须使用 var(--font-weight-title) 而非硬编码 700",
);

const pageTitleRule = extractRule(appStyles, ".page-title");
assert.ok(
  /font-family:\s*var\(--font-family-brand\)/.test(pageTitleRule),
  ".page-title 必须声明 font-family: var(--font-family-brand)",
);
assert.ok(
  /font-weight:\s*var\(--font-weight-title\)/.test(pageTitleRule),
  ".page-title 必须使用 var(--font-weight-title) 而非硬编码 700",
);

// ── 4. 无硬编码字体族回归（扫描所有页面与组件 WXSS）─────────────────────────

const hardcodedFontPatterns = [
  { re: /"Songti SC"/, label: '"Songti SC"' },
  { re: /STSong/, label: "STSong" },
  { re: /SimSun/, label: "SimSun" },
  { re: /\bGeorgia\b/, label: "Georgia" },
  { re: /"Times New Roman"/, label: '"Times New Roman"' },
  { re: /font-family:\s*-apple-system/, label: "-apple-system inline stack" },
];

function listWxss(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listWxss(full));
    } else if (entry.name.endsWith(".wxss")) {
      results.push(full);
    }
  }
  return results;
}

// 豁免列表：变量定义处允许硬编码字体族值
const exemptFiles = [
  "miniprogram/styles/theme.wxss", // CSS 变量定义处，必须包含硬编码字体名
];

// 扫描 pages/、components/、styles/、custom-tab-bar/ 下所有 WXSS 文件
const scanDirs = [
  path.join(root, "miniprogram", "pages"),
  path.join(root, "miniprogram", "components"),
  path.join(root, "miniprogram", "styles"),
  path.join(root, "miniprogram", "custom-tab-bar"),
];

const allWxssFiles = [];
for (const dir of scanDirs) {
  allWxssFiles.push(...listWxss(dir));
}

const scanViolations = [];
for (const file of allWxssFiles) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (exemptFiles.includes(rel)) continue;
  const content = fs.readFileSync(file, "utf8");
  for (const { re, label } of hardcodedFontPatterns) {
    if (re.test(content)) {
      scanViolations.push(`${rel}: 残留硬编码 ${label}`);
    }
  }
}
assert.equal(
  scanViolations.length,
  0,
  `页面与组件 WXSS 文件不得残留硬编码字体族:\n${scanViolations.join("\n")}`,
);

// 验证豁免文件确实存在且包含硬编码字体（确认豁免是有意义的，而非文件丢失）
assert.ok(
  fs.existsSync(path.join(root, "miniprogram/styles/theme.wxss")),
  "theme.wxss 必须存在（变量定义处）",
);
assert.ok(
  /--font-family-brand:\s*"Source Han Serif SC"/.test(theme),
  "theme.wxss 应包含硬编码字体名（这是变量定义处，允许硬编码）",
);

// scripts/patch-tdesign-icon-font.js 豁免：TDesign 图标字体内部处理，非排版字体
const patchScriptPath = path.join(root, "miniprogram/scripts/patch-tdesign-icon-font.js");
assert.ok(
  fs.existsSync(patchScriptPath),
  "scripts/patch-tdesign-icon-font.js 必须存在（TDesign 图标字体处理）",
);
const patchScript = fs.readFileSync(patchScriptPath, "utf8");
assert.ok(
  /font-family:\s*t\b/.test(patchScript),
  "patch-tdesign-icon-font.js 中的 font-family:t 是 TDesign 图标字体的内部处理，确认豁免",
);

console.log("typography contract tests passed (issues 01–05)");
