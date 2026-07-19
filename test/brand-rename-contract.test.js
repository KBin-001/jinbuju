const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const brandName = "今日进度｜目标计划打卡";
const slogan = "记录今日行动，看见目标进度。";
const legacyBrandName = "进步" + "局";

const appConfig = JSON.parse(read("miniprogram/app.json"));
const projectConfig = JSON.parse(read("project.config.json"));
const welcomeView = read("miniprogram/pages/welcome/index.wxml");
const welcomeStyles = read("miniprogram/pages/welcome/index.wxss");
const aboutView = read("miniprogram/pages/about/index.wxml");
const aboutConfig = JSON.parse(read("miniprogram/pages/about/index.json"));
const teamInvite = read("miniprogram/pages/team-invite/index.ts");
const coachPrompt = read("cloudfunctions/generatePlan/progress-coach.js");
const designWelcome = read("jinbuju-mobile-ui/pages/welcome.html");

assert(appConfig.window.navigationBarTitleText === brandName, "全局导航标题必须使用新小程序名称");
assert(projectConfig.projectname === "今日进度-目标计划打卡", "开发者工具项目名称必须同步新品牌");
assert(welcomeView.includes("今日进度") && welcomeView.includes("目标计划打卡"), "欢迎页必须完整展示新名称");
assert(welcomeView.includes(slogan) && aboutView.includes(slogan), "欢迎页和关于页必须展示新宣传语");
assert(welcomeStyles.includes(".brand-subname") && welcomeStyles.includes("@media (max-width: 350px)"), "长名称必须具备分层和小屏适配");
assert(aboutConfig.navigationBarTitleText.includes(brandName), "关于页标题必须使用新名称");
assert(teamInvite.includes(brandName), "小队邀请文案必须使用新名称");
assert(coachPrompt.includes(`“${brandName}”`), "AI 教练身份提示必须使用新名称");
assert(designWelcome.includes("今日进度") && designWelcome.includes("目标计划打卡") && designWelcome.includes(slogan), "前端设计稿必须同步新名称和宣传语");

const brandFacingFiles = [
  "miniprogram/app.json",
  "miniprogram/pages/welcome/index.wxml",
  "miniprogram/pages/about/index.wxml",
  "miniprogram/pages/legal/privacy/index.wxml",
  "miniprogram/pages/legal/terms/index.wxml",
  "miniprogram/pages/profile/index.wxml",
  "miniprogram/pages/team-invite/index.ts",
  "miniprogram/pages/team/index.ts",
  "cloudfunctions/generatePlan/progress-coach.js",
  "jinbuju-mobile-ui/pages/welcome.html",
  "jinbuju-mobile-ui/pages/profile.html",
];

for (const file of brandFacingFiles) {
  assert(!read(file).includes(legacyBrandName), `${file} 不得残留旧品牌名`);
}

console.log("小程序名称、宣传语与前端设计稿品牌合同检查通过");
