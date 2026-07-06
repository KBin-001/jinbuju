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
assert(cloudIndex.includes("requestId"), "云函数日志缺少 requestId");
assert(cloudActions.includes('stage = "proposal_lookup"'), "执行日志缺少 proposal 查询阶段");
assert(cloudActions.includes('stage = "goal_validation"'), "执行日志缺少目标校验阶段");
assert(cloudActions.includes('stage = "task_write"'), "执行日志缺少任务写入阶段");
assert(cloudActions.includes('stage = "proposal_commit"'), "执行日志缺少 proposal 回写阶段");

console.log("AI 教练运行时与日志检查通过");
