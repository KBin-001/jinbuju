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

// ── Issue 01: theme.wxss font-family variables ──────────────────────────────

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

// ── Issue 01: theme.wxss font-weight tokens ─────────────────────────────────

assert.match(theme, /--font-weight-title:\s*500/, "theme.wxss 必须定义 --font-weight-title: 500");
assert.match(theme, /--font-weight-numeric:\s*600/, "theme.wxss 必须定义 --font-weight-numeric: 600");

// ── Issue 01: app.wxss page selector ────────────────────────────────────────

const pageRule = extractRule(appStyles, "page");
assert.ok(
  /font-family:\s*var\(--font-family-sans\)/.test(pageRule),
  "app.wxss 的 page 选择器必须使用 var(--font-family-sans) 而非硬编码字体栈",
);
assert.ok(
  !/font-family:\s*-apple-system/.test(pageRule),
  "app.wxss 的 page 选择器不得残留硬编码 -apple-system 字体栈",
);

// ── Issue 01: app.wxss .tab-header__title ───────────────────────────────────

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

// ── Issue 01: app.wxss .page-title ──────────────────────────────────────────

const pageTitleRule = extractRule(appStyles, ".page-title");
assert.ok(
  /font-family:\s*var\(--font-family-brand\)/.test(pageTitleRule),
  ".page-title 必须声明 font-family: var(--font-family-brand)",
);
assert.ok(
  /font-weight:\s*var\(--font-weight-title\)/.test(pageTitleRule),
  ".page-title 必须使用 var(--font-weight-title) 而非硬编码 700",
);

// ── Issue 02: app.ts Inter webfont loading ──────────────────────────────────

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

// ── Issue 02: existing onLaunch calls preserved ─────────────────────────────

assert.match(appTs, /initCloud\s*\(/, "onLaunch 必须保留 initCloud() 调用");
assert.match(appTs, /bootstrapAccount\s*\(/, "onLaunch 必须保留 bootstrapAccount() 调用");
assert.match(appTs, /applyGlobalTheme\s*\(/, "onLaunch 必须保留 applyGlobalTheme() 调用");

// ── Issue 03: no hardcoded font-family in pages/ WXSS files ──────────────────

const pagesDir = path.join(root, "miniprogram", "pages");
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

const pageWxssFiles = listWxss(pagesDir);
const violations = [];
for (const file of pageWxssFiles) {
  const content = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replace(/\\/g, "/");
  for (const { re, label } of hardcodedFontPatterns) {
    if (re.test(content)) {
      violations.push(`${rel}: 残留硬编码 ${label}`);
    }
  }
}
assert.equal(
  violations.length,
  0,
  `pages/ 下 WXSS 文件不得残留硬编码字体族:\n${violations.join("\n")}`,
);

// ── Issue 04: no hardcoded font-family in components/ + styles/ + custom-tab-bar/ ─

const issue04Dirs = [
  path.join(root, "miniprogram", "components"),
  path.join(root, "miniprogram", "styles"),
  path.join(root, "miniprogram", "custom-tab-bar"),
];
const issue04Exempt = ["miniprogram/styles/theme.wxss"]; // 变量定义处允许硬编码

const issue04Files = [];
for (const dir of issue04Dirs) {
  issue04Files.push(...listWxss(dir));
}
const issue04Violations = [];
for (const file of issue04Files) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (issue04Exempt.includes(rel)) continue;
  const content = fs.readFileSync(file, "utf8");
  for (const { re, label } of hardcodedFontPatterns) {
    if (re.test(content)) {
      issue04Violations.push(`${rel}: 残留硬编码 ${label}`);
    }
  }
}
assert.equal(
  issue04Violations.length,
  0,
  `components/ + styles/ + custom-tab-bar/ 下 WXSS 文件不得残留硬编码字体族:\n${issue04Violations.join("\n")}`,
);

console.log("typography contract tests passed (issues 01, 02, 03 & 04)");
