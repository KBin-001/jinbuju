# 03 — 创建/编辑任务新增重要程度与阻塞标记

**What to build:** 用户在快速添加面板看到"重要程度"选择器（默认"普通任务"）和"是否阻塞其他任务"开关（默认关闭），在行动编辑页也能修改这两个字段。二者均为可选，不填不影响保存。保存后字段持久化在任务上，影响后续优先级评分。

**Blocked by:** 01 — 优先级评分工具函数 + 分组重命名 + 页面委托

**Status:** ready-for-agent

- [ ] 在快速添加面板（`pages/index/index.ts` 的 `quickAdd` 相关 data 和 WXML）中新增"重要程度"选择器：两个选项"普通任务"和"必须完成"，默认选中"普通任务"
- [ ] 在快速添加面板新增"是否阻塞其他任务"开关（`t-switch`），默认关闭
- [ ] `saveQuickAdd` 中将 `importance` 和 `blocksOthers` 传入 `createTask` 的 `SaveTaskInput`
- [ ] 在行动编辑页（`pages/action-edit/index.ts` 和 WXML）中同步新增这两个字段的编辑入口，`onLoad` 读取任务已有的 `importance` 和 `blocksOthers`，`save` 中传入 `updateTask`
- [ ] 确保不填时默认值正确：`importance` 默认 `"normal"`，`blocksOthers` 默认 `false`，与工单 01 的类型定义一致
- [ ] 扩展 `tests/today-grouping-contract.test.js`：快速添加面板 WXML 包含"重要程度"选择器数据绑定（如 `quickAddImportance` 或类似变量名）；行动编辑页 WXML 包含"重要程度"编辑入口
- [ ] 扩展 `tests/manual-services.test.js`：`createTask` 传入 `importance: "required"` 后任务对象上该字段正确持久化；`updateTask` 修改 `blocksOthers` 后字段更新生效
- [ ] 扩展 `tests/task-priority.test.js`：`importance = "required"` 的任务优先分高于 `importance = "normal"` 的同条件任务（如工单 01 已覆盖此断言则确认不回归）
