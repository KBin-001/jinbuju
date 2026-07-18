const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const dailyPage = read("miniprogram/pages/daily-coach/index.ts");
const manualSync = read("miniprogram/services/manualSync.ts");
const progressCoach = read("miniprogram/services/progressCoach.ts");
const cloudIndex = read("cloudfunctions/generatePlan/index.js");
const cloudActions = read("cloudfunctions/generatePlan/manual-sync.js");

function assert(value, message) {
  if (!value) throw new Error(message);
}

const loadAnalysis = dailyPage.slice(dailyPage.indexOf("  loadAnalysis()"), dailyPage.indexOf("  goBack()"));
assert(!loadAnalysis.includes("this.askQuestion("), "进入每日 AI 教练仍会自动发起问答");
assert(loadAnalysis.includes('asking: false'), "本地分析完成后未复位 asking 状态");
assert(manualSync.includes('action: "getCoachRuntimeInfo"'), "缺少云端版本探针");
assert(manualSync.includes("EXPECTED_COACH_RUNTIME_VERSION"), "缺少客户端预期版本");
assert(progressCoach.includes("verifyCoachRuntime()"), "准备 AI 上下文前未校验云端版本");
assert(progressCoach.includes("requestId"), "AI 请求未携带 requestId");
assert(cloudIndex.includes('action === "getCoachRuntimeInfo"'), "云函数缺少只读版本探针");
assert(cloudIndex.includes('action === "getCoachActionStatus"'), "云函数缺少操作状态查询");
assert(cloudIndex.includes("requestId"), "云函数日志缺少 requestId");
assert(cloudActions.includes("db.runTransaction"), "任务和 proposal 未使用事务提交");
assert(cloudActions.includes('stage = "transaction_begin"'), "执行日志缺少事务开始阶段");
assert(cloudActions.includes('stage = "goal_validation"'), "执行日志缺少目标校验阶段");
assert(cloudActions.includes('stage = "task_write"'), "执行日志缺少任务写入阶段");
assert(cloudActions.includes('stage = "proposal_commit"'), "执行日志缺少 proposal 回写阶段");
assert(cloudActions.includes('stage = "transaction_committed"'), "执行日志缺少事务完成阶段");
assert(cloudActions.includes('logAction("task_reconciled"'), "缺少历史部分成功修复日志");
assert(cloudActions.includes('logAction("create_reconciled"'), "缺少新增行动事务失败后的幂等恢复日志");
assert(cloudActions.includes('logAction("status_reconcile_deferred"'), "状态查询缺少任务已写入后的 proposal 恢复路径");
assert(cloudActions.includes("executedProposalData(proposal, actionResult)"), "proposal 完成结果仍可能从 null 路径更新失败");
assert(cloudActions.includes("userId: account.userId"), "AI 新建任务缺少提醒归属 userId");
assert(cloudActions.includes("getCoachActionStatus"), "服务端缺少只读状态查询实现");
assert(manualSync.includes("getCoachActionStatus(proposalId)"), "客户端模糊失败后未查询实际状态");
assert(manualSync.includes('status.status === "executed"'), "客户端未处理实际已执行结果");
assert(manualSync.includes('status.status === "pending"'), "客户端未对仍为 pending 的确认操作进行安全重试");

console.log("AI 教练运行时与日志检查通过");
