import {
  CloudFunctionResult,
  CommunityEntry,
  DeleteUserDataResult,
  ProfilePageData,
  UserDisplayProfile,
} from "../types/profile";
import { emit } from "../utils/eventBus";
import { getAccountRuntime } from "./account";

const READ_TIMEOUT = 12000;
const WRITE_TIMEOUT = 30000;
const LOCAL_PROFILE_KEY = "JINBUJU_USER_DISPLAY_PROFILE_V1";

interface CloudCallResponse<T> {
  result?: CloudFunctionResult<T>;
}

export interface ProfileServiceError extends Error {
  code?: string;
}

function createError(code: string, message: string): ProfileServiceError {
  const error = new Error(message) as ProfileServiceError;
  error.code = code;
  return error;
}

function rawMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { errMsg?: unknown; message?: unknown };
  return String(value.errMsg || value.message || "");
}

function callProfileFunction<T>(
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
      if (!result || !result.success || result.data === undefined) {
        throw createError(
          result?.error?.code || "INTERNAL_ERROR",
          result?.error?.message || "个人数据服务暂时不可用。",
        );
      }
      return result.data;
    })
    .catch((error: unknown) => {
      if (error instanceof Error && (error as ProfileServiceError).code) {
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

export function getProfileData(): Promise<ProfilePageData> {
  return callProfileFunction<ProfilePageData>(
    { action: "getProfileData" },
    READ_TIMEOUT,
  );
}

export function getCommunityEntry(): Promise<CommunityEntry> {
  return callProfileFunction<CommunityEntry>(
    { action: "getCommunityEntry" },
    READ_TIMEOUT,
  );
}

export function deleteUserData(
  confirmation: string,
): Promise<DeleteUserDataResult> {
  return callProfileFunction<DeleteUserDataResult>(
    {
      action: "deleteUserData",
      confirmation,
    },
    WRITE_TIMEOUT,
  );
}

export function getLocalUserProfile(): UserDisplayProfile | null {
  return getAccountRuntime()?.profile || null;
}

export function clearLocalUserProfile(): void {
  wx.removeStorageSync(LOCAL_PROFILE_KEY);
  emit("profile:update", null);
}
