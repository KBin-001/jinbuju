const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const page = read("miniprogram/pages/share-card/index.wxml");
const style = read("miniprogram/pages/share-card/index.wxss");
const logic = read("miniprogram/pages/share-card/index.ts");

assert.match(style, /background:\s*#f7f3ea/i, "分享页主体应使用暖米纸张底色");
assert.match(page, /today-hero-calendar-v4\.jpg/, "分享卡应复用正式山水背景资源");
assert.match(page, /share-save-brush-v1\.png/, "保存按钮应使用真实墨刷图片资源");
assert.match(page, /wx:key="value"/, "模板切换必须使用稳定 key");
assert.match(page, /wx:key="id"/, "完成行动必须使用稳定唯一 key");
assert.match(page, /\{\{heroValue\}\}[\s\S]*\{\{heroUnit\}\}/, "主数据与单位必须由真实状态动态输出");
assert.match(logic, /calculateTodaySummary\(todayTasks\)/, "今日完成与投入必须沿用真实统计逻辑");
assert.match(logic, /getProgressSummary\(goal\.id, today\)/, "目标进度必须沿用真实统计逻辑");
assert.match(logic, /today-hero-calendar-v4\.jpg/, "Canvas 导出层应使用与预览一致的山水资源");
assert.match(logic, /canvasToTempFilePath/, "保存图片事件链必须保留 Canvas 导出");

assert.equal(exists("miniprogram/assets/today-hero-calendar-v4.jpg"), true, "缺少山水背景资源");
assert.equal(exists("miniprogram/assets/share-save-brush-v1.png"), true, "缺少墨刷按钮资源");

console.log("share card visual fidelity contract tests passed");
