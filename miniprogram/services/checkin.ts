import {
  CheckinStatusData,
  CloudFunctionResult,
  SubmitCheckinParams,
  SubmitCheckinResult,
} from "../types/home";

const SUBMIT_TIMEOUT = 15000;
const STATUS_TIMEOUT = 12000;

interface CloudCallResponse<T> {
  result?: CloudFunctionResult<T>;
}

export interface CheckinServiceError extends Error {
  code?: string;
}

function createServiceError(code: string, message: string): CheckinServiceError {
  const error = new Error(message) as CheckinServiceError;
  error.code = code;
  return error;
}

function getRawErrorMessage(rawError: unknown): string {
  if (!rawError || typeof rawError !== "object") {
    return "";
  }
  const candidate = rawError as { errMsg?: unknown; message?: unknown };
  return String(candidate.errMsg || candidate.message || "");
}

function callCheckinFunction<T>(
  data: Record<string, unknown>,
  timeout: number,
): Promise<CloudCallResponse<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createServiceError("REQUEST_TIMEOUT", "请求时间有点久，请稍后重试。"));
    }, timeout);

    (wx.cloud.callFunction({
      name: "generatePlan",
      data,
    }) as Promise<CloudCallResponse<T>>).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function handleCloudError(rawError: unknown): never {
  if (rawError instanceof Error && (rawError as CheckinServiceError).code) {
    throw rawError;
  }

  const rawMessage = getRawErrorMessage(rawError);
  if (rawMessage.includes("FUNCTION_NOT_FOUND") || rawMessage.includes("FunctionName")) {
    throw createServiceError(
      "FUNCTION_NOT_FOUND",
      "计划服务尚未部署，请先上传 generatePlan 云函数。",
    );
  }
  if (rawMessage.includes("Environment not found")) {
    throw createServiceError("ENVIRONMENT_NOT_FOUND", "未找到云开发环境，请检查环境配置。");
  }
  if (
    rawMessage.includes("TIMEOUT") ||
    rawMessage.includes("time limit") ||
    rawMessage.includes("超时")
  ) {
    throw createServiceError("REQUEST_TIMEOUT", "请求时间有点久，请稍后重试。");
  }
  throw createServiceError("NETWORK_ERROR", "网络连接不稳定，请检查后重试。");
}

export function submitCheckin(params: SubmitCheckinParams): Promise<SubmitCheckinResult> {
  return callCheckinFunction<SubmitCheckinResult>(
    {
      action: "submitCheckin",
      goalId: params.goalId,
      planId: params.planId,
      completedTaskIds: params.completedTaskIds,
      feeling: params.feeling,
      note: params.note || "",
    },
    SUBMIT_TIMEOUT,
  )
    .then((response) => {
      const result = response.result;
      if (!result || !result.success || !result.data) {
        throw createServiceError(
          result?.error?.code || "INTERNAL_ERROR",
          result?.error?.message || "打卡提交失败，请稍后重试。",
        );
      }
      return result.data;
    })
    .catch(handleCloudError);
}

export function getTodayCheckinStatus(): Promise<CheckinStatusData> {
  return callCheckinFunction<CheckinStatusData>(
    { action: "getCheckinStatus" },
    STATUS_TIMEOUT,
  )
    .then((response) => {
      const result = response.result;
      if (!result || !result.success || !result.data) {
        throw createServiceError(
          result?.error?.code || "INTERNAL_ERROR",
          "打卡状态暂时无法获取，请稍后重试。",
        );
      }
      return result.data;
    })
    .catch(handleCloudError);
}
