const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const page = read("miniprogram/pages/index/index.wxml");
const pageStyle = read("miniprogram/pages/index/index.wxss");
const list = read("miniprogram/components/today-action-list/index.wxml");
const listLogic = read("miniprogram/components/today-action-list/index.ts");

assert.match(pageStyle, /page\s*\{[^}]*background:\s*#f8f4ed/i, "今日页应使用设计稿的暖米金底色");
assert.match(page, /today-action-seal-v1\.png/, "今日行动标题应展示朱红印记资源");
assert.match(page, /task-section-count[\s\S]*visibleTasks\.length/, "今日行动数量必须来自当前可见行动");
assert.match(list, /class="action-group__brush"[\s\S]*group\.brushAsset/, "行动分组应使用真实墨迹图片资源");
assert.match(list, /wx:key="key"/, "行动分组必须使用稳定 key");
assert.match(list, /wx:key="id"/, "行动项必须使用稳定唯一 key");
assert.match(listLogic, /today-action-brush-green-v1\.png/);
assert.match(listLogic, /today-action-brush-gray-v1\.png/);
assert.match(listLogic, /today-action-brush-gold-v1\.png/);

for (const asset of [
  "miniprogram/assets/today-action-seal-v1.png",
  "miniprogram/assets/today-action-brush-green-v1.png",
  "miniprogram/assets/today-action-brush-gray-v1.png",
  "miniprogram/assets/today-action-brush-gold-v1.png",
]) {
  assert.equal(exists(asset), true, `缺少今日页视觉资源：${asset}`);
}

console.log("today visual fidelity contract tests passed");
