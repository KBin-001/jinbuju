const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const pageLogic = read("miniprogram/pages/plan/index.ts");
const pageTemplate = read("miniprogram/pages/plan/index.wxml");
const goalTemplate = read("miniprogram/components/goal-overview/index.wxml");
const goalStyles = read("miniprogram/components/goal-overview/index.wxss");
const trendLogic = read("miniprogram/components/action-trend-chart/index.ts");

assert.match(
  pageLogic,
  /function getProgressHeaderLayout\(\)[\s\S]{0,320}headerHeight: layout\.headerHeight \+ 18/,
  "进度页标题与当前目标之间不应再额外增加 28px 空白",
);
assert.match(pageTemplate, /class="progress-subtitle">持续行动 · 长期成长<\/text>/, "进度标题下方应保留品牌副标题");

for (const label of ["成长期", "稳定期"]) {
  assert.match(goalTemplate, new RegExp(label), `阶段时间轴缺少${label}标注`);
}
assert.match(goalTemplate, /canvas-id="goalStageCanvas"/, "阶段时间轴应恢复持续向上的曲线");
assert.match(read("miniprogram/components/goal-overview/index.ts"), /function cubicCoordinate/);
assert.match(read("miniprogram/components/goal-overview/index.ts"), /\[0, 1 \/ 3, 2 \/ 3, 1\][\s\S]*pointAt\(progress\)/, "四个里程碑点必须由同一条贝塞尔曲线计算");
assert.match(read("miniprogram/components/goal-overview/index.ts"), /currentProgress[\s\S]*pointAt\(currentProgress\)/, "绿色当前节点必须复用同一曲线坐标函数");
assert.match(read("miniprogram/components/goal-overview/index.ts"), /arc\(current\.x, current\.y, 8\.5/, "绿色当前节点应保留清晰的高对比外环");

assert.match(trendLogic, /const nearTop = point\.y < top \+ 24;/, "趋势图应识别触顶数据点");
assert.match(trendLogic, /nearTop[\s\S]{0,120}point\.y \+ 22/, "触顶分钟标签应移到绿色点下方避免遮挡");

console.log("progress layout bug regression tests passed");
