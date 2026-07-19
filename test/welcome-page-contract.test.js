const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const view = read("miniprogram/pages/welcome/index.wxml");
const styles = read("miniprogram/pages/welcome/index.wxss");
const logic = read("miniprogram/pages/welcome/index.ts");
const config = JSON.parse(read("miniprogram/pages/welcome/index.json"));

assert.match(view, /今日进度/);
assert.match(view, /把长期目标/);
assert.match(view, /示例目标与任务进度|界面示例 · 数据仅作功能演示/);
assert.match(view, /长期目标管理/);
assert.match(view, /每日行动打卡/);
assert.match(view, /真实投入记录/);
assert.doesNotMatch(view, /适合正在努力的你|用户反馈|真实反馈将在获得授权后展示/);
assert.match(view, /example-sheet-layer/);
assert.match(view, /把目标拆成今天能完成的行动/);
assert.match(view, /bindchange="onConsentChange"/);
assert.match(view, /bindtap="startPlanning"/);
assert.match(view, /bindtap="toggleExample"/);
assert.match(view, /<button class="start-button"/);
assert.match(view, /<button class="example-button"/);
assert.doesNotMatch(view, /<t-button class="start-button"/);
assert.match(view, /catchtap="openPrivacy"/);
assert.match(view, /catchtap="openTerms"/);
assert.match(logic, /recordConsents\(\["privacy", "terms"\], "welcome"\)/);
assert.match(logic, /completeCloudOnboarding/);
assert.match(styles, /@media \(max-width: 350px\)/);
assert.match(styles, /\.brand \{ width: 300rpx;/);
assert.match(styles, /\.task-demo-card[^}]*padding: 22rpx 18rpx 22rpx 42rpx;/);
assert.match(styles, /\.goal-demo-card, \.task-demo-card \{ box-sizing: border-box;/);
assert.match(styles, /\.action-button-shell \{ width: 100%; display: block;/);
assert.doesNotMatch(view, /<br\s*\/?\s*>/i);
assert.match(styles, /\.welcome-page \{ height: 100vh; min-height: 0; overflow: hidden;/);
assert.match(styles, /\.capability-grid \{ margin-top: auto;/);
assert.match(styles, /\.start-button\[disabled\][^}]*color: rgba\(255,255,255,\.96\) !important;/);
assert.equal(config.disableScroll, true, "欢迎页必须保持单屏且禁止页面滚动");

console.log("welcome page contract test passed");
