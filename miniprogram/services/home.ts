import { CloudFunctionResult, HomeData } from "../types/home";

const HOME_REQUEST_TIMEOUT = 12000;

interface CloudCallResponse<T> {
  result?: CloudFunctionResult<T>;
}

export interface HomeServiceError extends Error {
  code?: string;
}

function createServiceError(code: string, message: string): HomeServiceError {
  const error = new Error(message) as HomeServiceError;
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

function callHomeFunction<T>(
  data: Record<string, unknown>,
  timeout: number,
): Promise<CloudCallResponse<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createServiceError("REQUEST_TIMEOUT", "加载时间有点久，请稍后重试。"));
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

export function getHomeData(): Promise<HomeData> {
  return callHomeFunction<HomeData>({ action: "getHomeData" }, HOME_REQUEST_TIMEOUT)
    .then((response) => {
      const result = response.result;
      if (!result || !result.success || !result.data) {
        throw createServiceError(
          result?.error?.code || "INTERNAL_ERROR",
          result?.error?.message || "今日数据暂时无法加载，请稍后重试。",
        );
      }
      return result.data;
    })
    .catch((rawError: unknown) => {
      if (rawError instanceof Error && (rawError as HomeServiceError).code) {
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
        throw createServiceError("REQUEST_TIMEOUT", "加载时间有点久，请稍后重试。");
      }
      throw createServiceError("NETWORK_ERROR", "网络连接不稳定，请检查后重试。");
    });
}

interface ToggleTaskResult {
  taskId: string;
  completed: boolean;
  status: string;
}

export function toggleTaskStatus(taskId: string, completed: boolean): Promise<ToggleTaskResult> {
  return callHomeFunction<ToggleTaskResult>(
    { action: "toggleTask", taskId, completed },
    8000,
  )
    .then((response) => {
      const result = response.result;
      if (!result || !result.success || !result.data) {
        throw createServiceError(
          result?.error?.code || "INTERNAL_ERROR",
          result?.error?.message || "行动状态更新失败，请稍后重试。",
        );
      }
      return result.data;
    })
    .catch((rawError: unknown) => {
      if (rawError instanceof Error && (rawError as HomeServiceError).code) {
        throw rawError;
      }

      const rawMessage = getRawErrorMessage(rawError);
      if (
        rawMessage.includes("TIMEOUT") ||
        rawMessage.includes("time limit") ||
        rawMessage.includes("超时")
      ) {
        throw createServiceError("REQUEST_TIMEOUT", "行动状态更新超时，请稍后重试。");
      }
      throw createServiceError("NETWORK_ERROR", "网络连接不稳定，行动状态可能未保存。");
    });
}
