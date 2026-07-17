const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const wxml = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.wxss"), "utf8");
const script = fs.readFileSync(path.join(root, "miniprogram/pages/index/index.ts"), "utf8");

assert.equal(wxml.includes("更多操作"), false, "任务卡不应继续展示更多操作文案");
assert.equal(wxss.includes(".task-more"), false, "应同步清理更多操作样式");
assert.match(wxml, /data-id="\{\{task\.id\}\}"\s+bindtap="openTask"/, "点击任务行仍应打开操作菜单");
assert.match(wxml, /catchtap="toggleTaskDone"/, "完成按钮必须拦截冒泡并独立处理");

for (const action of ["标记完成", "完成一部分", "顺延到明天", "今天不做", "编辑", "删除"]) {
  assert.equal(script.includes(action), true, `操作菜单缺少“${action}”`);
}

console.log("today task action entry tests passed");
