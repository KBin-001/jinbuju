const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const themeService = read("miniprogram/services/theme.ts");
const themeStyles = read("miniprogram/styles/theme.wxss");
const features = read("miniprogram/config/features.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(themeService.includes('ThemeId = "inkGreen"'), "发布版只应保留 inkGreen 兼容 id");
assert(!/THEME_PRESETS|setCurrentTheme|onThemeChange|APP_THEME/.test(themeService), "旧换肤运行时仍被打包");
assert(!/"mint"|"cream"|"apricot"/.test(themeService), "历史主题预设仍被打包");
assert(!/data-theme="(?:mint|cream|apricot)"/.test(themeStyles), "历史主题选择器仍被打包");
assert(!features.includes("ENABLE_THEME_SWITCHING"), "换肤功能开关不应继续存在");

for (const file of [
  "miniprogram/pages/index/index.wxml",
  "miniprogram/pages/plan/index.wxml",
  "miniprogram/pages/team/index.wxml",
]) {
  assert(read(file).includes('data-theme="{{appTheme}}"'), `${file} 未绑定固定发布主题`);
}
assert(read("miniprogram/pages/profile/index.wxss").toUpperCase().includes("#F7F3EA"), "我的页未采用统一暖米白背景");

console.log("单一发布主题检查通过");
