import {
  CloudFunctionResult,
  JoinTeamInput,
  JoinTeamResult,
  SendEncouragementInput,
  SendEncouragementResult,
  TeamPageData,
} from "../types/team";

const READ_TIMEOUT = 12000;
const WRITE_TIMEOUT = 15000;

interface CloudCallResponse<T> {
  result?: CloudFunctionResult<T>;
}

export interface TeamServiceError extends Error {
  code?: string;
}

function createError(code: string, message: string): TeamServiceError {
  const error = new Error(message) as TeamServiceError;
  error.code = code;
  return error;
}

function rawMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { errMsg?: unknown; message?: unknown };
  return String(value.errMsg || value.message || "");
}

function callTeamFunction<T>(
  data: Record<string, unknown>,
  timeoutMilliseconds: number,
): Promise<T> {
  return new Promise<CloudCallResponse<T>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(createError("REQUEST_TIMEOUT", "请求时间有点久，请稍后重试。"));
    }, timeoutMilliseconds);
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
  })
    .then((response) => {
      const result = response.result;
      if (!result || !result.success || !result.data) {
        throw createError(
          result?.error?.code || "INTERNAL_ERROR",
          result?.error?.message || "小队服务暂时不可用。",
        );
      }
      return result.data;
    })
    .catch((error: unknown) => {
      if (error instanceof Error && (error as TeamServiceError).code) {
        throw error;
      }
      const message = rawMessage(error);
      if (message.includes("FUNCTION_NOT_FOUND") || message.includes("FunctionName")) {
        throw createError("FUNCTION_NOT_FOUND", "请先重新部署 generatePlan 云函数。");
      }
      if (message.includes("Environment not found")) {
        throw createError("ENVIRONMENT_NOT_FOUND", "未找到云开发环境。");
      }
      if (message.includes("TIMEOUT") || message.includes("超时")) {
        throw createError("REQUEST_TIMEOUT", "请求时间有点久，请稍后重试。");
      }
      throw createError("NETWORK_ERROR", "网络连接不稳定，请检查后重试。");
    });
}

export function getMyTeam(): Promise<TeamPageData> {
  return callTeamFunction<TeamPageData>({ action: "getMyTeam" }, READ_TIMEOUT);
}

export function joinTeam(_input: JoinTeamInput = {}): Promise<JoinTeamResult> {
  return callTeamFunction<JoinTeamResult>({ action: "joinTeam" }, WRITE_TIMEOUT);
}

export function sendEncouragement(
  input: SendEncouragementInput,
): Promise<SendEncouragementResult> {
  return callTeamFunction<SendEncouragementResult>(
    {
      action: "sendEncouragement",
      memberId: input.memberId,
      type: input.type,
    },
    WRITE_TIMEOUT,
  );
}
