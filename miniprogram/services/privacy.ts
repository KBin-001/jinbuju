export type AgreementType = "privacy" | "terms" | "phone_binding";
export type ConsentSource = "welcome" | "settings" | "phone_bind";

export interface ConsentItem {
  type: AgreementType;
  version: string;
  agreed: boolean;
  agreedAt: string;
  withdrawnAt: string;
}

export interface ConsentStatus {
  versions: Record<AgreementType, string>;
  consents: Record<AgreementType, ConsentItem>;
}

interface CloudResult<T> { success: boolean; data?: T; error?: { code?: string; message?: string } }

function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return wx.cloud.callFunction({ name: "generatePlan", data: { action, ...data } }).then((response: any) => {
    const result = response.result as CloudResult<T> | undefined;
    if (!result?.success || result.data === undefined) {
      throw Object.assign(new Error(result?.error?.message || "隐私设置暂时不可用。"), {
        code: result?.error?.code || "NETWORK_ERROR",
      });
    }
    return result.data;
  });
}

export function getConsentStatus(): Promise<ConsentStatus> {
  return call<ConsentStatus>("getConsentStatus");
}

export function recordConsents(types: AgreementType[], source: ConsentSource): Promise<ConsentStatus> {
  return call<ConsentStatus>("recordConsent", { types, source });
}

export function withdrawConsent(type: AgreementType): Promise<ConsentStatus> {
  return call<ConsentStatus>("withdrawConsent", { type });
}
