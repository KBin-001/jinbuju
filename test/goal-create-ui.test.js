const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "miniprogram", "pages", "goal-create");
const logic = fs.readFileSync(path.join(root, "index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "index.wxml"), "utf8");
const style = fs.readFileSync(path.join(root, "index.wxss"), "utf8");

const expectedLabels = ["考研", "考公", "专升本", "教师资格证", "英语四六级", "自定义"];
let lastIndex = -1;
expectedLabels.forEach((label) => {
  const nextIndex = logic.indexOf(`label: "${label}"`);
  assert.ok(nextIndex > lastIndex, `目标方向缺失或顺序错误：${label}`);
  lastIndex = nextIndex;
});

assert.equal((logic.match(/label: "/g) || []).length, 6, "创建页应只展示六个目标方向");
assert.doesNotMatch(logic, /label: "AI 学习"/, "旧 AI 学习分类不应继续出现在新建入口");
assert.match(logic, /undergraduate_upgrade/, "专升本应使用独立的可同步分类");

assert.doesNotMatch(template, /t-textarea|简单说明|目标创建后直接开始行动/, "页面不应保留已删除的说明区和引导卡");
assert.match(template, /创建目标并进入学习/, "主操作文案应指向创建后进入学习");
assert.match(template, /direction-grid/, "六个方向应使用紧凑选择矩阵");
assert.match(template, /goal-create-hero-v3\.jpg/, "创建页应使用专属低对比品牌山水背景");
assert.match(style, /grid-template-columns:\s*repeat\(2/, "方向矩阵应为两列布局");
assert.match(style, /--color-gold|var\(--color-gold\)/, "商业化视觉应复用现有金色设计令牌");

console.log("goal create ui contract tests passed");
