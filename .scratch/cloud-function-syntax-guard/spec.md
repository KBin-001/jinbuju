Status: ready-for-agent

# 云函数语法防线：部署前拦截 SyntaxError

## Problem Statement

用户在使用 AI 教练对话时，每次发送消息都收到 `cloud.callFunction:fail Error: errCode: -504002 functions execute fail | errMsg: SyntaxError: Unexpected token 'return'`。整个 `generatePlan` 云函数因为一个 JS 文件中 `getApp()` 函数的 `tcb.init({ env: reso` 被截断（缺少 `resolveCloudEnv()` 完整调用和闭合括号），导致模块加载阶段就抛出 SyntaxError。由于微信云开发的函数加载机制是在请求到达时才 `require` 入口文件，这个语法错误让 `generatePlan` 的所有 action 全部不可用——不只是 AI 对话，还包括打卡、目标管理、小队、通知等所有依赖该函数的能力。

根因：项目缺少一个在部署前对所有云函数 JS 文件做语法校验的环节。现有的 `npm test` 只运行运行时逻辑测试（`test.js`、`coach-upgrade.test.js`），无法捕获加载阶段的语法错误。开发者只能在上传云函数后通过实际调用才能发现此类问题，反馈链路过长。

## Solution

在项目 `scripts/` 目录下新增一个预部署语法校验脚本，对 `cloudfunctions/` 下每个云函数目录的所有 `.js` 文件执行 `node -c`（`--check`）语法检查。脚本在发现任何语法错误时以非零退出码终止，并输出出错的文件名和错误信息，使开发者在上传云函数之前就能拦截问题。

脚本设计原则：

- **零依赖**：仅使用 Node.js 内置能力（`child_process`、`fs`、`path`），不引入任何 npm 包。
- **全量覆盖**：递归扫描每个云函数目录下的所有 `.js` 文件，包括子目录（如 `generatePlan/scripts/`）。
- **清晰输出**：逐文件报告检查结果，失败时高亮显示文件路径和语法错误详情。
- **快速失败**：遇到第一个语法错误即停止并返回非零退出码，避免淹没开发者。
- **可集成**：脚本接受可选的云函数名参数，允许只检查指定函数；无参数时检查全部。

## User Stories

1. 作为开发者，我上传云函数之前运行一个命令就能检查所有云函数 JS 文件是否有语法错误，这样我不会把损坏的代码部署到云端。
2. 作为开发者，语法校验脚本告诉我具体是哪个文件的哪一行出了什么语法错误，这样我能快速定位和修复。
3. 作为开发者，我可以只检查某个云函数（例如 `generatePlan`）而不检查全部，这样在校验大型项目时更快。
4. 作为开发者，语法校验脚本不引入任何新的 npm 依赖，这样我不需要额外安装包。
5. 作为开发者，语法校验脚本的退出码可以被 CI/CD 或 shell 脚本捕获，这样我可以把它集成到自动化部署流程中。
6. 作为开发者，脚本递归检查云函数目录下的子目录（如 `generatePlan/scripts/`），这样不会遗漏任何文件。
7. 作为开发者，当所有文件都通过检查时，脚本输出简洁的成功信息并返回零退出码，这样我知道可以安全部署。
8. 作为开发者，当某个文件存在语法错误时，脚本立即停止并返回非零退出码，这样我不会忽略错误继续部署。
9. 作为产品负责人，语法校验脚本覆盖项目中所有云函数目录，而不只是 `generatePlan`，这样其他云函数（如 `loginInit`、`getHomeData` 等）也能被保护。
10. 作为开发者，脚本不检查 `node_modules/` 和 `miniprogram_npm/` 目录，这样不会误报第三方代码的语法问题。

## Implementation Decisions

- **脚本位置**：`scripts/check-cloudfunctions-syntax.js`，使用 Node.js 直接运行（`node scripts/check-cloudfunctions-syntax.js`）。
- **检查范围**：扫描 `cloudfunctions/` 目录下每个子目录（每个子目录是一个云函数），递归查找所有 `.js` 文件，跳过 `node_modules/` 和 `miniprogram_npm/` 目录。
- **检查方式**：对每个文件执行 `node --check <file>`（等同于 `node -c`），捕获 stdout/stderr 和退出码。`--check` 模式只解析不执行，安全且快速。
- **参数支持**：脚本接受可选的位置参数作为云函数名过滤器，例如 `node scripts/check-cloudfunctions-syntax.js generatePlan` 只检查 `generatePlan` 目录。无参数时检查全部云函数。
- **输出格式**：
  - 逐文件输出 `✓ <file>` 或 `✗ <file>`（使用纯文本 `OK` / `FAIL` 代替 emoji，遵循项目规范）。
  - 失败时在 `FAIL` 行下方输出 `node --check` 的完整错误信息。
  - 最终汇总：`All N files passed.` 或 `M of N files failed.`
- **退出码**：全部通过返回 `0`；有任一文件失败返回 `1`。
- **错误处理**：如果 `cloudfunctions/` 目录不存在，输出错误信息并返回 `1`。
- **不修改现有测试**：不改动 `cloudfunctions/generatePlan/package.json` 中的 `test` 脚本。语法校验是部署前步骤，与运行时测试职责不同。如未来需要集成，由开发者自行在部署脚本中串联。

## Testing Decisions

### 什么是一个好的测试

好的测试只验证外部行为，不验证实现细节。对于这个脚本，外部行为是：

- 给定一组有效的 JS 文件，脚本退出码为 `0`。
- 给定一个包含语法错误的 JS 文件，脚本退出码为 `1`，且输出中包含文件路径。
- 给定一个不存在的云函数名参数，脚本报错。
- 脚本跳过 `node_modules/` 目录中的文件。

### 测试模块

- `scripts/check-cloudfunctions-syntax.js` 本身——通过创建临时目录结构（包含有效和无效 JS 文件）来测试脚本的退出码和输出。

### 已有测试参考

项目中云函数的测试模式是在云函数目录下放置 `*.test.js` 文件并用 `node` 直接运行（参见 `cloudfunctions/generatePlan/test.js` 和 `cloudfunctions/generatePlan/package.json` 中的 `scripts.test`）。语法校验脚本的测试可以遵循同样的模式：在 `scripts/` 下放置 `check-cloudfunctions-syntax.test.js`，用 Node.js 内置能力创建临时目录、运行脚本、断言退出码和输出。

## Out of Scope

- 不修改任何现有云函数的业务逻辑代码（`ai.js` 的语法错误已在本次修复中单独处理）。
- 不引入 ESLint、Prettier 或其他 lint 工具——本脚本只做最低限度的 `node --check` 语法校验。Lint 工具的引入是独立的决策。
- 不修改微信开发者工具的上传流程或 hook。脚本需要开发者手动运行，或由开发者自行集成到 CI/CD。
- 不检查 TypeScript 编译——云函数使用纯 JavaScript，不涉及 TS 编译。
- 不检查 `miniprogram/` 目录下的小程序端代码——小程序有自己的编译检查机制。

## Further Notes

- 本次修复的直接原因：`cloudfunctions/generatePlan/ai.js` 的 `getApp()` 函数中 `tcb.init({ env: reso` 被截断，应为 `tcb.init({ env: resolveCloudEnv() })`。缺少闭合括号导致 `return app;` 被解析为对象字面量内部语句，触发 `SyntaxError: Unexpected token 'return'`。该问题已修复并通过 `node --check` 验证。
- 微信云开发的函数加载机制是在请求到达时才 `require` 入口文件及其依赖链，因此 SyntaxError 会导致该云函数的所有 action 全部失败，影响范围远大于单个功能。
- 修复后已对 `generatePlan` 目录下全部 47 个 JS 文件执行 `node --check`，全部通过。
