import { readManualStore } from "./manualStore";
import { addDays, formatDate, getTodayBusinessDate } from "../utils/date";
import { CoachRange, ProgressCoachAnalysis, ProgressCoachAnswer, ProgressCoachChatMessage } from "../types/progressCoach";

interface CloudFunctionResult<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

interface PrepareResult {
  prepared: boolean;
  unchanged: boolean;
  scope: CoachRange;
  goalId: string;
  sourceUpdatedAt: string;
}

const preparedFingerprints = new Map<string, string>();
const pendingPreparations = new Map<string, Promise<PrepareResult>>();

function callProgressCoach<T>(data: Record<string, unknown>, timeoutMilliseconds = 30000): Promise<T> {
  return new Promise<{ result?: CloudFunctionResult<T> }>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("AI 服务请求超时，请稍后重试。") as Error & { code?: string };
      error.code = "FUNCTION_TIMEOUT";
      reject(error);
    }, timeoutMilliseconds);
    wx.cloud.callFunction({ name: "generatePlan", data }).then(
      (response: any) => { clearTimeout(timer); resolve(response); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  }).then((response) => {
    const result = response.result;
    if (!result || !result.success || result.data === undefined) {
      const error = new Error(result?.error?.message || "AI 服务暂时不可用，请稍后重试。") as Error & { code?: string };
      error.code = result?.error?.code || "INTERNAL_ERROR";
      throw error;
    }
    return result.data;
  }).catch((rawError: any) => {
    if (rawError?.code && !String(rawError.message || "").includes("cloud.callFunction")) throw rawError;
    const rawMessage = String(rawError?.errMsg || rawError?.message || "");
    const error = new Error("云端 AI 服务暂时不可用，请稍后重试。") as Error & { code?: string };
    if (rawMessage.includes("FUNCTION_NOT_FOUND") || rawMessage.includes("FunctionName")) {
      error.code = "FUNCTION_NOT_FOUND";
      error.message = "AI 服务尚未部署，请先上传 generatePlan 云函数。";
    } else if (rawMessage.includes("Environment not found") || rawMessage.includes("ENVIRONMENT_NOT_FOUND")) {
      error.code = "ENVIRONMENT_NOT_FOUND";
      error.message = "未找到云开发环境，请检查当前环境配置。";
    } else if (rawMessage.includes("TIMEOUT") || rawMessage.includes("超时")) {
      error.code = "FUNCTION_TIMEOUT";
      error.message = "AI 服务请求超时，请稍后重试。";
    } else {
      error.code = "NETWORK_ERROR";
    }
    throw error;
  });
}

function rangeStart(scope: CoachRange, today: string): string | undefined {
  const todayDate = new Date(`${today}T00:00:00`);
  if (scope === "week") return formatDate(addDays(todayDate, -6));
  if (scope === "month") {
    const day = todayDate.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return formatDate(addDays(todayDate, mondayOffset - 28));
  }
  return undefined;
}

function buildSnapshot(scope: CoachRange, requestedGoalId?: string) {
  const store = readManualStore();
  const goals = scope === "overall"
    ? store.goals.filter((goal) => goal.status === "active")
    : store.goals.filter((goal) => goal.id === requestedGoalId && goal.status === "active");
  if (!goals.length) throw new Error("当前没有可以分析的目标。");
  const goalIds = new Set(goals.map((goal) => goal.id));
  const today = getTodayBusinessDate();
  const start = rangeStart(scope, today);
  const inRange = (date: string) => !start || (date >= start && date <= today);
  const tasks = store.tasks.filter((task) => goalIds.has(task.goalId) && inRange(task.currentDate));
  const checkins = store.checkins.filter((item) => goalIds.has(item.goalId) && inRange(item.businessDate));
  const normalizedGoals = goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    category: goal.category,
    status: goal.status,
    createdAt: goal.createdAt,
    startedAt: goal.startedAt,
  }));
  return {
    goals: normalizedGoals,
    tasks: tasks.map((task) => ({
      id: task.id,
      goalId: task.goalId,
      title: task.title,
      plannedDate: task.plannedDate,
      currentDate: task.currentDate,
      status: task.status,
      estimatedMinutes: task.estimatedMinutes,
      actualMinutes: task.actualMinutes,
      issueReason: task.issueReason,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    checkins: checkins.map((item) => ({
      id: item.id,
      goalId: item.goalId,
      businessDate: item.businessDate,
      completedCount: item.completedCount,
      partialCount: item.partialCount,
      actualMinutes: item.actualMinutes,
    })),
  };
}

function snapshotFingerprint(snapshot: ReturnType<typeof buildSnapshot>): string {
  const goalPart = snapshot.goals.map((goal) => `${goal.id}:${goal.status}:${goal.createdAt}`).join("|");
  const taskPart = snapshot.tasks.map((task) => `${task.id}:${task.updatedAt}:${task.status}:${task.actualMinutes || 0}`).join("|");
  const checkinPart = snapshot.checkins.map((item) => `${item.id}:${item.businessDate}:${item.actualMinutes}`).join("|");
  return `${goalPart}#${taskPart}#${checkinPart}`;
}

export function prepareProgressCoach(scope: CoachRange, goalId?: string, force = false): Promise<PrepareResult> {
  const snapshot = buildSnapshot(scope, goalId);
  const key = `${scope}:${scope === "overall" ? "overall" : goalId || ""}`;
  const fingerprint = snapshotFingerprint(snapshot);
  if (!force && preparedFingerprints.get(key) === fingerprint) {
    return Promise.resolve({ prepared: true, unchanged: true, scope, goalId: scope === "overall" ? "overall" : goalId || "", sourceUpdatedAt: "" });
  }
  const pending = pendingPreparations.get(key);
  if (pending && !force) return pending;
  const request = callProgressCoach<PrepareResult>({
    action: "prepareProgressCoach",
    scope,
    goalId: scope === "overall" ? undefined : goalId,
    snapshot,
  }, 12000).then((result) => {
    preparedFingerprints.set(key, fingerprint);
    pendingPreparations.delete(key);
    return result;
  }, (error) => {
    pendingPreparations.delete(key);
    throw error;
  });
  pendingPreparations.set(key, request);
  return request;
}

export function analyzeProgress(goalId: string, scope: CoachRange): Promise<ProgressCoachAnalysis> {
  const snapshot = buildSnapshot(scope, goalId);
  return callProgressCoach<ProgressCoachAnalysis>({ action: "analyzeProgress", goalId, scope, snapshot });
}

export async function askProgressCoach(
  scope: CoachRange,
  goalId: string | undefined,
  question: string,
  history: ProgressCoachChatMessage[],
): Promise<ProgressCoachAnswer> {
  await prepareProgressCoach(scope, goalId);
  return callProgressCoach<ProgressCoachAnswer>({
    action: "askProgressCoach",
    scope,
    goalId: scope === "overall" ? undefined : goalId,
    question: question.trim(),
    history: history.slice(-12),
  });
}
