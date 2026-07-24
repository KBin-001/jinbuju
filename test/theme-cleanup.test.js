const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const theme = read("miniprogram/styles/theme.wxss");
const appStyles = read("miniprogram/app.wxss");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const token of ["#F7F3EA", "#FFFCF6", "#F1F4EE", "#245B4D", "#1B483D", "#7F9D91", "#C89B4A", "#24312D"]) {
  assert(theme.includes(token), `统一主题缺少品牌色 ${token}`);
}

assert(!/data-theme="(?:mint|cream|apricot)"/.test(theme), "主题文件不应继续打包历史主题选择器");
assert((theme.match(/--color-primary:\s*#245B4D/g) || []).length >= 1, "品牌主色未收敛为深墨绿");
assert((theme.match(/--color-action-primary:\s*#245B4D/g) || []).length >= 1, "交互主色未收敛为品牌主色");
assert(!theme.includes("#557F75"), "主题文件仍包含旧版灰青主色");
assert(!theme.includes("#356859"), "主题文件仍包含旧版主绿色");
assert(appStyles.includes('@import "./styles/theme.wxss"'), "全局样式未引入统一主题");
assert(!appStyles.includes("antd-mini"), "不得重新引入 antd-mini");

console.log("V2 现代东方山水设计令牌检查通过");
