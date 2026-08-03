const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pages = [
  "profile", "goal-manage", "history", "achievements", "data-sync", "account-security",
  "privacy-center", "about", "growth-records", "action-records", "goal-detail", "goal-create",
];
const files = pages.flatMap((page) => ["index.wxss", "index.wxml"].map((file) => path.join(root, "miniprogram/pages", page, file))).filter(fs.existsSync);
const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const theme = fs.readFileSync(path.join(root, "miniprogram/styles/theme.wxss"), "utf8");

assert.match(theme, /--color-primary:\s*#245B4D/);
assert.match(theme, /--color-action-primary:\s*#245B4D/);
assert.match(theme, /--td-button-primary-bg-color:\s*var\(--color-action-primary\)/);
assert.match(source, /var\(--color-action-primary\)/, "核心子页面按钮应复用统一交互玉色令牌");

console.log("我的页子页面按钮、选中态与功能图标统一玉色主题检查通过");
