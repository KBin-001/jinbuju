const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const appConfig = JSON.parse(read("miniprogram/app.json"));
const todayLogic = read("miniprogram/pages/index/index.ts");
const todayTemplate = read("miniprogram/pages/index/index.wxml");
const navigation = read("miniprogram/utils/todayActionEditor.ts");
const routeSources = [
  "miniprogram/pages/plan/index.ts",
  "miniprogram/pages/goal-detail/index.ts",
  "miniprogram/pages/daily-coach/index.ts",
  "miniprogram/pages/ai-coach/index.ts",
  "miniprogram/pages/action-records/index.ts",
  "miniprogram/pages/today-data/index.ts",
].map(read).join("\n");

assert.equal(fs.existsSync(path.join(root, "miniprogram/pages/action-edit")), false, "旧全屏行动编辑页应被移除");
assert.equal(appConfig.subpackages.some((item) => item.root === "pages/action-edit"), false, "旧行动编辑分包不应继续注册");
assert.doesNotMatch(JSON.stringify(appConfig), /pages\/action-edit/, "应用配置不应保留旧行动编辑页引用");
assert.match(navigation, /wx\.switchTab\([\s\S]*\/pages\/index\/index/, "跨页面行动入口应切换到今日 Tab");
assert.match(navigation, /queueTodayActionEditor[\s\S]*consumeTodayActionEditor/, "行动编辑请求应通过一次性导航契约交接");
assert.match(routeSources, /openTodayActionEditor\(\{ mode: "create"/, "外部新增入口应使用今日行动编辑器");
assert.match(routeSources, /openTodayActionEditor\(\{ mode: "edit"/, "外部编辑入口应使用今日行动编辑器");
assert.doesNotMatch(routeSources, /pages\/action-edit/, "任何业务入口都不应再导航到旧页面");
assert.match(todayLogic, /openPendingTodayActionEditor\(\)/, "今日页显示时应消费待打开的行动编辑请求");
assert.match(todayLogic, /openQuickAddEditor\(task\?: ActionTask/, "新增与编辑应复用今日页统一半屏");
assert.match(todayTemplate, /quickAddMode === 'edit' \? '编辑行动' : '添加行动'/, "今日半屏应同时支持新增和编辑状态");

console.log("统一今日行动编辑入口契约检查通过");
