# 全局语义字号一致性实施映射

## Notes

本轮按 01 → 02/03/04/05 → 06 → 07 的依赖顺序完成了语义字号迁移。业务数据、路由、登录、云函数和第三方组件源码未因字号重构而修改。

## Decisions-so-far

- 01 建立 `theme.wxss` 的页面标题、分区标题、卡片标题、强调正文、正文、说明、元信息、标签和核心数据令牌，并保留品牌字、英雄数据、计时器、日历、图标、长文和小屏降级令牌。
- 02–05 通过页面/组件末端语义覆盖收敛进度、今日与行动、小队和我的流程；旧变量继续通过兼容别名工作。
- 06 将 AI 教练、欢迎、目标、历史、分享、计划预览、打卡、阶段复盘、今日数据、行动记录、法律长文和共享对话组件接入同一套令牌。
- 07 新增 `test/type-scale-contract.test.js`，扫描产品 WXSS、组件和自定义导航，排除 `node_modules/miniprogram_npm`；主题文件中的裸字号仅作为令牌定义保留。
- 静态 TypeScript 检查通过。当前环境没有微信开发者工具命令，`miniprogram/package.json` 也没有 npm build 脚本，因此微信 IDE 编译、npm 构建和真实设备截图对比需在开发者工具环境补做。

## Context pointers

- [01 — 语义字号基础](issues/01-semantic-type-scale-foundation.md)
- [02 — 进度页字号](issues/02-progress-page-type-scale.md)
- [03 — 今日与行动字号](issues/03-today-and-action-type-scale.md)
- [04 — 小队字号](issues/04-team-type-scale.md)
- [05 — 我的字号](issues/05-profile-type-scale.md)
- [06 — 剩余界面字号](issues/06-remaining-surfaces-type-scale.md)
- [07 — 契约与视觉 QA](issues/07-contract-and-visual-qa.md)
