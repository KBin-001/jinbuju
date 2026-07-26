const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// 反馈循环（diagnosing-bugs Phase 1）：复现「今日行动三个点点击无反应」。
// 根因候选：openTaskMenu 对未完成任务构建的菜单项超过 wx.showActionSheet 的 6 项上限，
// 且调用未提供 fail 回调，超限时静默失败 -> 用户看到「点了没反应」。
// 期望行为（绿）：三个点菜单必须可靠弹窗——
//   (A) 用 wx.showActionSheet 时，未完成菜单项数 <= 6 且有 fail 回调；或
//   (B) 改用自定义 action-sheet 组件（不受 6 项限制）。
// 当前代码两者都不满足 -> 红色。

const root = path.resolve(__dirname, "..");
const indexLogic = fs.readFileSync(path.join(root, "pages/index/index.ts"), "utf8");
const indexWxml = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
const indexWxss = fs.readFileSync(path.join(root, "pages/index/index.wxss"), "utf8");
const actionListWxml = fs.readFileSync(path.join(root, "components/today-action-list/index.wxml"), "utf8");
const iconPatch = fs.readFileSync(path.join(root, "scripts/patch-tdesign-icon-font.js"), "utf8");

// 契约：三个点按钮存在且绑定了菜单事件
assert.match(actionListWxml, /task-more/, "today-action-list 应包含三个点按钮 .task-more");
assert.match(actionListWxml, /catchtap="openMenu"/, "三个点按钮应绑定 catchtap=openMenu");
assert.match(indexWxml, /bind:menu="openTaskMenu"/, "今日页应监听 today-action-list 的 menu 事件");

// 提取 openTaskMenu 方法体（括号匹配）
function extractMethodBody(source, methodName) {
  const start = source.indexOf(methodName + "(");
  if (start === -1) throw new Error("未找到方法: " + methodName);
  let i = source.indexOf("{", start);
  if (i === -1) throw new Error(methodName + " 方法体未找到 {");
  let depth = 0;
  let bodyStart = -1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") { depth++; if (bodyStart === -1) bodyStart = i; }
    else if (ch === "}") { depth--; if (depth === 0) return source.slice(bodyStart, i + 1); }
  }
  throw new Error(methodName + " 括号不匹配");
}

const menuStart = indexLogic.indexOf("  openTaskMenu(");
const menuEnd = indexLogic.indexOf("\n  onTaskMenuItemTap(", menuStart);
assert.ok(menuStart >= 0 && menuEnd > menuStart, "应能提取 openTaskMenu 方法体");
const menuBody = indexLogic.slice(menuStart, menuEnd);

const usesWxActionSheet = /wx\.showActionSheet\(/.test(menuBody);
const usesCustomSheet = /t-action-sheet/.test(indexWxml) || /action-sheet/.test(indexWxml);

let reliable = false;
if (usesCustomSheet) {
  // 走自定义组件路径，不受 6 项限制
  reliable = true;
} else if (usesWxActionSheet) {
  // wx.showActionSheet 的 itemList 最大长度为 6，超限会 fail
  const pushCount = (menuBody.match(/push\("/g) || []).length;
  const hasFail = /fail\s*:/.test(menuBody);
  reliable = pushCount <= 6 && hasFail;
}

assert.ok(
  reliable,
  "今日页三个点菜单必须可靠弹窗：用 wx.showActionSheet 时未完成菜单项数需 <=6 且提供 fail 回调；或改用自定义 action-sheet 组件。当前实现点击后静默无反应。"
);

// 商业化弹窗结构与交互闭环：目标图中的标题、推荐信息、分组、危险项与取消区均为真实节点。
assert.match(indexWxml, /task-action-sheet__recommendation/, "弹窗应展示任务推荐分组及来源");
assert.match(indexWxml, /task-action-sheet__group-mark/, "分组标题应使用克制金色短线建立层级");
assert.match(indexWxml, /role="dialog"/, "弹窗面板应提供对话框语义");
assert.match(indexWxml, /aria-label="\{\{menuItem\.label \+ '，' \+ menuItem\.desc\}\}"/, "列表项应提供完整无障碍标签");
assert.match(indexWxml, /catchtap="onTaskMenuClose"/, "遮罩和取消入口必须可以关闭弹窗");
assert.match(indexWxss, /calc\(18rpx \+ env\(safe-area-inset-bottom\)\)/, "底部取消区必须避让安全区");
assert.match(indexWxss, /task-sheet-panel-in/, "弹窗打开必须保留上移动画");
assert.doesNotMatch(indexWxss, /task-action-sheet__mask[^}]*backdrop-filter/, "遮罩不应通过重模糊破坏背景层级");

for (const label of ["开始专注", "标记完成", "跳过今天", "设为今日重点", "调整推荐位置", "编辑任务", "删除任务"]) {
  assert.match(menuBody, new RegExp(label), `目标操作菜单缺少“${label}”`);
}
assert.match(indexLogic, /setTaskPriorityPosition\(task: ViewTask\)/, "调整推荐位置应拥有独立的分组调整逻辑");
assert.match(indexLogic, /\["focus", "quick", "later", null\]/, "推荐位置应覆盖三个分组和恢复系统推荐");
assert.match(iconPatch, /font-family:t-action,t!important/, "新增菜单图标必须进入本地字体回退链，避免离线空白");

console.log("today action menu contract tests passed");
