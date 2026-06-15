import {
  CloudFunctionResult,
  StageGenerationResult,
  StagePlanGenerationInput,
  ConfirmStageResult,
  StageReviewData,
  StageReviewInput,
} from "../types/stage";

interface CloudCallResponse<T> {
  result?: CloudFunctionResult<T>;
}

export interface StageServiceError extends Error {
  code?: string;
}

function serviceError(code: string, message: string): StageServiceError {
  const error = new Error(message) as StageServiceError;
  error.code = code;
  return error;
}

function rawErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { errMsg?: unknown; message?: unknown };
  return String(value.errMsg || value.message || "");
}

function callStageFunction<T>(
  data: Record<string, unknown>,
  timeoutMilliseconds = 60000,
): Promise<T> {
  return new Promise<CloudCallResponse<T>>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(serviceError("REQUEST_TIMEOUT", "生成时间有点久，请稍后重试。")),
      timeoutMilliseconds,
    );
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
        throw serviceError(
          result?.error?.code || "INTERNAL_ERROR",
          result?.error?.message || "行动阶段暂时无法生成。",
        );
      }
      return result.data;
    })
    .catch((error: unknown) => {
      if (error instanceof Error && (error as StageServiceError).code) {
        throw error;
      }
      const message = rawErrorMessage(error);
      if (message.includes("FUNCTION_NOT_FOUND") || message.includes("FunctionName")) {
        throw serviceError("FUNCTION_NOT_FOUND", "请先重新部署 generatePlan 云函数。");
      }
      if (message.includes("Environment not found")) {
        throw serviceError("ENVIRONMENT_NOT_FOUND", "未找到云开发环境。");
      }
      throw serviceError("NETWORK_ERROR", "网络连接不稳定，请检查后重试。");
    });
}

export function createStageRequestId(): string {
  return `stage_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateStagePlan(
  input: StagePlanGenerationInput,
  requestId: string,
  forceFallback = false,
  regenerate = false,
): Promise<StageGenerationResult> {
  return callStageFunction<StageGenerationResult>({
    action: "generateStagePlan",
    input,
    requestId,
    forceFallback,
    regenerate,
  });
}

export function getStagePreview(previewId: string): Promise<StageGenerationResult> {
  return callStageFunction<StageGenerationResult>({
    action: "getStagePreview",
    previewId,
  }, 12000);
}

export function confirmStagePlan(previewId: string): Promise<ConfirmStageResult> {
  return callStageFunction<ConfirmStageResult>({
    action: "confirmStagePlan",
    previewId,
  }, 20000);
}

export function getStageReview(stageId: string): Promise<StageReviewData> {
  return callStageFunction<StageReviewData>({
    action: "getStageReview",
    stageId,
  }, 12000);
}

export function submitStageReview(
  input: StageReviewInput,
  requestId: string,
): Promise<StageGenerationResult> {
  return callStageFunction<StageGenerationResult>({
    action: "submitStageReview",
    ...input,
    requestId,
  });
}
