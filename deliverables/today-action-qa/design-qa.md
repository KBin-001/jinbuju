# 今日行动与添加行动 UI QA（2026-07-26）

## 对照基准

- source visual truth（今日页）：`C:/Users/24786/AppData/Local/Temp/codex-clipboard-3e404977-3a6a-4fdb-ba61-f68e952cce11.png`
- source pixels：`941 × 1672`
- source visual truth（添加行动）：`C:/Users/24786/AppData/Local/Temp/codex-clipboard-232693ab-7ecd-4df1-a108-5a314ced1bc1.png`
- source pixels：`484 × 1049`
- route/state：`pages/index/index`，今日行动列表与添加/编辑行动弹层
- target viewport：微信开发者工具 iPhone 15 Pro Max 模拟器
- implementation screenshot：未生成；本轮开发者工具模拟器未能完成页面渲染

## 已落实的对照项

- 今日行动标题和区块纵向占用已收紧，任务列表卡片、组间距与行高同步压缩。
- 今日重点、快速推进、稍后安排分别使用旗帜、闪电、时钟图标，并建立独立左侧图标轨道。
- 三类说明改为金色、青绿色、暖灰色语义胶囊，提升可见性但不抢夺任务标题层级。
- 任务主按钮保持固定尺寸并在右侧操作区垂直居中；按钮下方重复分钟数已删除。
- 添加行动的预计投入范围统一为 `5–1440` 分钟，时间尺首尾事件会精确落到 5 分钟与 24 小时。
- 执行方式仅保留“直接完成”和“专注计时”；旧数据中的“每次询问”会安全迁移为“专注计时”。
- 客户端、云同步和 AI 计划校验均使用同一 24 小时上限，避免前后端口径不一致。

## 自动验证

- `node test/today-task-actions.test.js`：通过。
- `node miniprogram/tests/today-action-editor-sheet-contract.test.js`：通过。
- `node miniprogram/tests/today-grouping-contract.test.js`：通过。
- `node miniprogram/tests/task-priority.test.js`：通过。
- `node miniprogram/tests/manual-services.test.js`：通过。
- `node test/action-edit-ui.test.js`：通过。
- `node cloudfunctions/generatePlan/test.js`：通过。
- 微信开发者工具 `build-npm`：通过，无新增警告。
- `git diff --check`：通过；仅提示仓库既有的 LF/CRLF 转换信息。

## 阻塞项

- 微信开发者工具模拟器在重新编译后持续空白，并出现基础库内部异常：`TypeError: Cannot read property '__subPageFrameEndTime__' of null`，随后提示模拟器长时间无响应。
- 已重新打开项目并重新构建 npm，空白渲染仍复现。因此本轮无法生成实现截图、并排图，也不能诚实地判定 1:1 视觉验收通过。

final result: blocked
