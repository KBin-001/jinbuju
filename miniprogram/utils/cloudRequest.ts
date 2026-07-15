export interface CloudRequestError extends Error {
  code?: string;
  requestId?: string;
}

export function createCloudRequestId(action: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${action}_${Date.now()}_${random}`;
}

export function logCloudRequest(action: string, requestId: string, startedAt: number, error?: CloudRequestError): void {
  if (!error) return;
  const detail = {
    action,
    requestId,
    durationMs: Date.now() - startedAt,
    code: error?.code || "",
    message: error?.message ? String(error.message).slice(0, 160) : "",
  };
  console.error("[cloud request] failed", detail);
}
