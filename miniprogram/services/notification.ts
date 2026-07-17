import { isNotificationConfigured, NotificationScene, NOTIFICATION_DEFINITIONS } from "../config/notification";
import { createCloudRequestId } from "../utils/cloudRequest";
import { recordNotificationPrompt } from "../utils/notificationPreference";

export type NotificationAuthorizationResult = "accept" | "reject" | "ban" | "filter";
export type NotificationClientScene = "today_completion" | "daily_coach" | "team_join" | "privacy_center";

export interface NotificationScenePreference {
  enabled: boolean;
  configured: boolean;
  templateId: string;
  remainingQuota: number;
  needsAuthorization: boolean;
  lastAuthorizationResult: string;
  lastAuthorizedAt: string;
}

export interface NotificationPreference {
  scenes: Record<NotificationScene, NotificationScenePreference>;
  grayEnabled: boolean;
  configVersion: string;
}

export interface NotificationPreferenceUpdateResult {
  scene: NotificationScene;
  enabled: boolean;
  remainingQuota: number;
  needsAuthorization?: boolean;
}

export interface InAppMessage {
  id: string;
  scene: NotificationScene;
  title: string;
  body: string;
  page: string;
  createdAt: string;
}

interface CloudResult<T> { success: boolean; data?: T; error?: { code?: string; message?: string } }

function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return wx.cloud.callFunction({ name: "generatePlan", data: { action, ...data } }).then((response: any) => {
    const result = response.result as CloudResult<T> | undefined;
    if (!result?.success || result.data === undefined) {
      throw Object.assign(new Error(result?.error?.message || "通知服务暂时不可用，请稍后重试。"), {
        code: result?.error?.code || "NETWORK_ERROR",
      });
    }
    return result.data;
  });
}

export function getNotificationPreference(): Promise<NotificationPreference> {
  return call<NotificationPreference>("notification.preference");
}

export function updateNotificationPreference(scene: NotificationScene, enabled: boolean): Promise<NotificationPreferenceUpdateResult> {
  return enabled
    ? call<NotificationPreferenceUpdateResult>("notification.updatePreference", { scene, enabled: true })
    : call<NotificationPreferenceUpdateResult>("notification.unsubscribe", { scene });
}

export function listInAppMessages(limit = 5): Promise<{ list: InAppMessage[] }> {
  return call<{ list: InAppMessage[] }>("notification.inApp.list", { limit });
}

export function readInAppMessage(messageId: string): Promise<{ read: true }> {
  return call<{ read: true }>("notification.inApp.read", { messageId });
}

export function getWechatSubscriptionSetting(): Promise<{ mainSwitch: boolean; itemSettings: Record<string, string> }> {
  return new Promise((resolve) => {
    (wx.getSetting as any)({
      withSubscriptions: true,
      success: (result: any) => resolve({
        mainSwitch: result?.subscriptionsSetting?.mainSwitch !== false,
        itemSettings: result?.subscriptionsSetting?.itemSettings || {},
      }),
      fail: () => resolve({ mainSwitch: true, itemSettings: {} }),
    });
  });
}

export function openWechatNotificationSettings(): void {
  wx.openSetting({
    fail: () => wx.showToast({ title: "微信授权管理打开失败，请稍后重试", icon: "none" }),
  });
}

export async function requestNotificationAuthorization(
  scene: NotificationScene,
  clientScene: NotificationClientScene,
): Promise<NotificationAuthorizationResult> {
  const definition = NOTIFICATION_DEFINITIONS[scene];
  if (!isNotificationConfigured(scene)) {
    throw Object.assign(new Error("通知模板尚未完成审核，当前不会发起微信授权。"), { code: "NOTIFICATION_NOT_CONFIGURED" });
  }
  // 必须在用户点击事件的同步调用链中立即调起；授权前不能等待 getSetting 或云函数请求。
  recordNotificationPrompt(scene);
  const result = await new Promise<Record<string, string>>((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: [definition.templateId],
      success: (value: any) => resolve(value || {}),
      fail: (error: any) => reject(Object.assign(new Error(error?.errMsg || "微信订阅授权未完成。"), { code: "SUBSCRIBE_REQUEST_FAILED" })),
    });
  });
  const authorizationResult = String(result[definition.templateId] || "filter") as NotificationAuthorizationResult;
  if (!["accept", "reject", "ban", "filter"].includes(authorizationResult)) {
    throw Object.assign(new Error("微信返回了无法识别的授权状态。"), { code: "SUBSCRIBE_RESULT_INVALID" });
  }
  await call("notification.subscribe", {
    requestId: createCloudRequestId("notification_subscribe"),
    clientScene,
    results: [{ scene, templateId: definition.templateId, result: authorizationResult }],
  });
  return authorizationResult;
}
