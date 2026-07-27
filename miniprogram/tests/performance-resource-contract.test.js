const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const miniRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(miniRoot, "..");
const appConfig = JSON.parse(fs.readFileSync(path.join(miniRoot, "app.json"), "utf8"));
const packageRoots = new Set(appConfig.subpackages.map((item) => item.root));

const expectedPreloads = {
  "pages/index/index": ["pages/action-edit", "pages/daily-coach", "pages/ai-coach", "pages/today-data"],
  "pages/plan/index": ["pages/ai-coach", "pages/growth-records", "pages/goal-detail"],
  "pages/team/index": ["pages/team-members", "pages/team-activity", "pages/team-invite"],
  "pages/profile/index": ["pages/account-security", "pages/privacy-center", "pages/data-sync"],
};

Object.entries(expectedPreloads).forEach(([page, packages]) => {
  const rule = appConfig.preloadRule?.[page];
  assert.ok(rule, `${page} 必须配置后台分包预加载`);
  assert.equal(rule.network, "all");
  packages.forEach((packageRoot) => {
    assert.equal(packageRoots.has(packageRoot), true, `预加载分包不存在: ${packageRoot}`);
    assert.equal(rule.packages.includes(packageRoot), true, `${page} 未预加载 ${packageRoot}`);
  });
});
Object.values(appConfig.preloadRule).forEach((rule) => {
  rule.packages.forEach((packageRoot) => assert.equal(packageRoots.has(packageRoot), true, `预加载分包不存在: ${packageRoot}`));
});

const themeService = fs.readFileSync(path.join(miniRoot, "services/theme.ts"), "utf8");
const themeStyles = fs.readFileSync(path.join(miniRoot, "styles/theme.wxss"), "utf8");
const featureFlags = fs.readFileSync(path.join(miniRoot, "config/features.ts"), "utf8");
assert.match(themeService, /ThemeId = "inkGreen"/);
assert.doesNotMatch(themeService, /THEME_PRESETS|APP_THEME|setCurrentTheme|onThemeChange|"mint"|"cream"|"apricot"/);
assert.doesNotMatch(themeStyles, /data-theme="(?:mint|cream|apricot)"/);
assert.doesNotMatch(featureFlags, /ENABLE_THEME_SWITCHING/);

[
  "assets/ai-coach/mountain-bg.svg",
  "assets/ai-coach-shanshui-v1.jpg",
  "tsc_output.txt",
].forEach((relative) => assert.equal(fs.existsSync(path.join(miniRoot, relative)), false, `冗余文件仍存在: ${relative}`));
[
  ".preview/stats_card.svg",
  "docs/previews/v2-color-preview.html",
  "docs/previews/v2-color-preview.png",
  "docs/team-inkgreen-before.png",
].forEach((relative) => assert.equal(fs.existsSync(path.join(repoRoot, relative)), false, `旧预览仍存在: ${relative}`));

const resourceExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp3", ".aac", ".wav", ".m4a"]);
const ignoredFolders = new Set(["node_modules", "tests", "typings"]);
const resourceFiles = [];

function collectResourceFiles(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (ignoredFolders.has(entry.name)) return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectResourceFiles(fullPath);
      return;
    }
    if (resourceExtensions.has(path.extname(entry.name).toLowerCase())) {
      resourceFiles.push(fullPath);
    }
  });
}

collectResourceFiles(miniRoot);
const resourceTotalBytes = resourceFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
assert.ok(
  resourceTotalBytes <= 200 * 1024,
  `????????????? 200KB???? ${(resourceTotalBytes / 1024).toFixed(1)}KB`,
);

const phoneFeature = fs.readFileSync(path.join(miniRoot, "pages/account-security/index.wxml"), "utf8");
const phoneService = fs.readFileSync(path.join(miniRoot, "services/account.ts"), "utf8");
const cloudAccount = fs.readFileSync(path.join(repoRoot, "cloudfunctions/generatePlan/account.js"), "utf8");
assert.match(featureFlags, /ENABLE_PHONE_BINDING:\s*false/);
assert.match(phoneFeature, /open-type="getPhoneNumber"/);
assert.match(phoneService, /"bindPhone"[\s\S]*"unbindPhone"/);
assert.match(cloudAccount, /async function bindPhone[\s\S]*async function unbindPhone/);

// Bug 5 (P1) 契约：team/index.ts buildActivitySnapshot 的 todayActionDetails 必须包含 actualMinutes 字段
const teamIndex = fs.readFileSync(path.join(miniRoot, "pages/team/index.ts"), "utf8");
assert.match(teamIndex, /todayActionDetails[\s\S]*actualMinutes[\s\S]*\}\)/, "Bug 5: buildActivitySnapshot 的 todayActionDetails 必须包含 actualMinutes 字段");

console.log("performance and resource cleanup contract tests passed");
