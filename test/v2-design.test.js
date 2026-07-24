const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function assert(condition, message) { if (!condition) throw new Error(message); }

const pages = [
  ["今日", "miniprogram/pages/index/index.wxml", "/assets/today-hero-mountain-v2.jpg"],
  ["进度", "miniprogram/pages/plan/index.wxml", "/assets/progress-mountain-path-v2.jpg"],
  ["小队", "miniprogram/pages/team/index.wxml", "/assets/team-header-watercolor-v2.jpg"],
  ["我的", "miniprogram/pages/profile/index.wxml", "/assets/profile/profile-header-mist-v2.jpg"],
];

for (const [name, file, asset] of pages) {
  const source = read(file);
  assert(source.includes(asset), `${name}页未使用指定山水品牌资源`);
  const local = path.join(root, "miniprogram", asset.replace(/^\//, ""));
  assert(fs.existsSync(local), `${name}页山水资源不存在`);
  assert(fs.statSync(local).size < 250_000, `${name}页山水资源超过轻量资源上限`);
}

const app = read("miniprogram/app.wxss");
const theme = read("miniprogram/styles/theme.wxss");
for (const color of ["#F7F3EA", "#FFFCF6", "#F1F4EE", "#245B4D", "#1B483D", "#7F9D91", "#C89B4A", "#24312D"]) {
  assert(app.includes(color) || theme.includes(color), `全局设计系统缺少 ${color}`);
}

console.log("四个主页面山水资源与统一色板检查通过");
