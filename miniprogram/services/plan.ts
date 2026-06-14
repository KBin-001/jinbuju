import {
  AdoptResult,
  CloudFunctionResult,
  CurrentPlan,
  DeletePlanResult,
  GoalDraft,
  PlanPreview,
} from "../types/goal";

interface GenerateResponse {
  requestId: string;
  plan: PlanPreview;
}

interface ActiveGoalResponse {
  hasActiveGoal: boolean;
}

function callGeneratePlan<T>(data: Record<string, unknown>): Promise<T> {
  return wx.cloud
    .callFunction({
      name: "generatePlan",
      data,
    })
    .then((response: any) => {
      const result = response.result as CloudFunctionResult<T>;
      if (!result || !result.success || !result.data) {
        const error = new Error(result?.error?.message || "服务暂时不可用，请稍后重试。") as Error & {
          code?: string;
        };
        error.code = result?.error?.code || "INTERNAL_ERROR";
        throw error;
      }
      return result.data;
    })
    .catch((rawError: any) => {
      if (rawError?.code && !String(rawError.message || "").includes("cloud.callFunction")) {
        throw rawError;
      }

      const rawMessage = String(rawError?.errMsg || rawError?.message || "");
      const error = new Error("云服务暂未部署完成，请稍后重试。") as Error & {
        code?: string;
      };

      if (rawMessage.includes("FUNCTION_NOT_FOUND") || rawMessage.includes("FunctionName")) {
        error.code = "FUNCTION_NOT_FOUND";
        error.message = "计划服务尚未部署，请先上传 generatePlan 云函数。";
      } else if (rawMessage.includes("Environment not found")) {
        error.code = "ENVIRONMENT_NOT_FOUND";
        error.message = "未找到云开发环境，请检查环境 ID。";
      } else if (
        rawMessage.includes("TIMEOUT") ||
        rawMessage.includes("time limit") ||
        rawMessage.includes("超时")
      ) {
        error.code = "FUNCTION_TIMEOUT";
        error.message = "计划生成超时，请将 generatePlan 云函数超时设置为 60 秒后重试。";
      } else {
        error.code = "NETWORK_ERROR";
        error.message = "云函数调用失败，请检查 generatePlan 日志和运行配置。";
      }

      throw error;
    });
}

export function generatePlan(
  goal: GoalDraft,
  requestId: string,
  forceFallback = false,
): Promise<GenerateResponse> {
  return callGeneratePlan<GenerateResponse>({
    action: "generate",
    goal,
    requestId,
    forceFallback,
  });
}

export function adoptPlan(
  goal: GoalDraft,
  plan: PlanPreview,
  requestId: string,
): Promise<AdoptResult> {
  return callGeneratePlan<AdoptResult>({
    action: "adopt",
    goal,
    plan,
    requestId,
  });
}

export function createRequestId(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function checkActiveGoal(): Promise<boolean> {
  return callGeneratePlan<ActiveGoalResponse>({
    action: "checkActive",
  }).then((result) => result.hasActiveGoal);
}

export function getCurrentPlan(): Promise<CurrentPlan | null> {
  return callGeneratePlan<{ currentPlan: CurrentPlan | null }>({
    action: "getCurrent",
  }).then((result) => result.currentPlan);
}

export function deleteCurrentPlan(): Promise<DeletePlanResult> {
  return callGeneratePlan<DeletePlanResult>({
    action: "deleteCurrent",
  });
}
