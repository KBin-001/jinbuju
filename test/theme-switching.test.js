const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const themeService = read("miniprogram/services/theme.ts");
const themeStyles = read("miniprogram/styles/theme.wxss");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(themeService.includes('DEFAULT_THEME_ID: ThemeId = "inkGreen"'), "默认主题应保持 inkGreen 兼容值");
for (const id of ["mint", "cream", "inkGreen", "apricot"]) {
  assert(themeStyles.includes(`[data-theme="${id}"]`), `缺少历史主题 ${id} 的兼容选择器`);
}
assert(themeStyles.indexOf('[data-theme="mint"]') < themeStyles.indexOf("--color-primary: #245B4D"), "历史主题应共享同一品牌令牌块");
assert(!/\[data-theme="inkGreen"\][\s\S]*?--color-primary:\s*#356859/.test(themeStyles), "不应保留 inkGreen 的旧色板覆盖");

for (const file of [
  "miniprogram/pages/index/index.wxml",
  "miniprogram/pages/plan/index.wxml",
  "miniprogram/pages/team/index.wxml",
]) {
  assert(read(file).includes('data-theme="{{appTheme}}"'), `${file} 未绑定统一主题`);
}
assert(read("miniprogram/pages/profile/index.wxss").toUpperCase().includes("#F7F3EA"), "我的页未采用统一暖米白背景");

console.log("主题兼容与单一品牌色板检查通过");
