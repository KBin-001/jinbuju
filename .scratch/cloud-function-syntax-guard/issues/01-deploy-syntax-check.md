# 01 — 预部署语法校验脚本

**What to build:** 在 `scripts/` 目录下新建 `check-cloudfunctions-syntax.js`，对 `cloudfunctions/` 下所有云函数目录的 `.js` 文件执行 `node --check` 语法校验。脚本零依赖（仅用 Node.js 内置模块），接受可选的云函数名参数做过滤，递归扫描子目录但跳过 `node_modules/` 和 `miniprogram_npm/`。遇到语法错误时输出文件路径和错误详情，以非零退出码终止。

**Blocked by:** 无 — 可立即开始

**Status:** ready-for-agent

- [ ] `scripts/check-cloudfunctions-syntax.js` 存在且可被 `node` 直接运行
- [ ] 无参数运行时，脚本扫描 `cloudfunctions/` 下所有子目录的 `.js` 文件
- [ ] 传入云函数名参数时（如 `node scripts/check-cloudfunctions-syntax.js generatePlan`），只检查指定目录
- [ ] 递归检查子目录（如 `generatePlan/scripts/`），但跳过 `node_modules/` 和 `miniprogram_npm/`
- [ ] 所有文件通过时退出码为 `0`，输出 `All N files passed.`
- [ ] 任一文件有语法错误时退出码为 `1`，输出包含出错文件路径和 `node --check` 的错误信息
- [ ] `cloudfunctions/` 目录不存在时退出码为 `1`，输出明确的错误信息
- [ ] 脚本不引入任何 npm 依赖（仅使用 `child_process`、`fs`、`path`）
- [ ] 脚本输出不使用 emoji（遵循项目文案规范）
- [ ] 在 `cloudfunctions/generatePlan/` 全部文件上运行通过（47 个文件全部 OK）
