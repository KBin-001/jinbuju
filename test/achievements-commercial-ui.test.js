const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const template = read("miniprogram/pages/achievements/index.wxml");
const source = read("miniprogram/pages/achievements/index.ts");
const styles = read("miniprogram/pages/achievements/index.wxss");
const service = read("miniprogram/services/achievement.ts");
const pageCopy = `${source}\n${template}`;

for (const copy of [
  "成长收藏", "成长阶段", "刚刚收藏", "下一枚收藏", "全部", "已收藏", "待解锁",
  "生成成长纪念卡", "把真实坚持保存下来",
]) {
  assert(pageCopy.includes(copy), `商业化成长收藏页缺少“${copy}”`);
}

assert.match(source, /getAchievementCollection\(\)/, "收藏页必须继续使用真实成就事实源");
assert.match(source, /collection\.newlyUnlocked/, "新收藏庆祝必须来自真实新解锁记录");
assert.match(source, /latestAchievement/, "页面必须呈现最近获得的成长收藏");
assert.match(source, /nextAchievement/, "页面必须呈现最接近解锁的下一枚收藏");
assert.match(source, /\/pages\/share-card\/index\?mode=streak/, "成长纪念卡入口必须连接现有可运行分享能力");
assert.match(source, /wx\.switchTab\(\{ url: "\/pages\/index\/index" \}\)/, "继续行动必须返回今日页");
assert.match(template, /bindtap="openAchievement"/, "收藏项目必须能够打开真实详情");
assert.match(template, /bindtap="changeFilter"/, "全部、已收藏、待解锁筛选必须可用");
assert.match(template, /status === 'loading'/);
assert.match(template, /status === 'error'/);
assert.match(template, /visibleCategories\.length === 0/);
assert.match(template, /collection-hero-landscape-v1\.jpg/, "Hero 必须使用正式低对比山水资源");
assert.doesNotMatch(template, /(?:11|18|17\/30|2639\/3000)(?![a-zA-Z_])/, "页面不得把设计稿示例数据写死在 WXML 中");
assert.match(styles, /\.achievement-focus-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.86fr\)\s+minmax\(0,\s*1\.14fr\)/s, "必须忠实复刻设计稿左窄右宽的双列焦点卡");
assert.match(styles, /\.achievement-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s, "必须忠实复刻设计稿的三列收藏展柜");
assert.match(template, /collection-signature-medallion\.svg/, "顶部必须使用设计稿对应的独立圆形品牌徽章");
assert.match(template, /category\.iconPath/, "收藏分组必须使用独立品牌 SVG 图标");
assert.doesNotMatch(styles, /backdrop-filter|filter:\s*blur/, "页面不得依赖玻璃拟态或模糊特效");

for (const id of ["action_1", "streak_30", "minutes_3000", "reflection_30"]) {
  assert(service.includes(`id: "${id}"`), `不得因视觉重构删除真实成就 ${id}`);
}

const heroAsset = path.join(root, "miniprogram/assets/achievements/collection-hero-landscape-v1.jpg");
assert(fs.existsSync(heroAsset), "成长收藏 Hero 山水资源缺失");
assert(fs.statSync(heroAsset).size < 120 * 1024, "成长收藏 Hero 资源需控制在 120KB 内");

console.log("成长收藏商业化布局、真实状态与交互闭环检查通过");
