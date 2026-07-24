export type NotificationScene = "daily_action_reminder" | "ai_coach_advice" | "team_activity";

export interface NotificationClientDefinition {
  scene: NotificationScene;
  templateId: string;
  page: string;
  title: string;
  serviceCategoryConfirmed: boolean;
}

// 模板已于 2026-07-17 在微信公众平台添加；云端关键词键仍由环境变量管理。
export const NOTIFICATION_DEFINITIONS: Record<NotificationScene, NotificationClientDefinition> = {
  daily_action_reminder: {
    scene: "daily_action_reminder",
    templateId: "4MFayQvC3ZykJyFFirrIlcDjnrFDDe34F4F9XvdFltU",
    page: "/pages/index/index",
    title: "每日行动提醒",
    serviceCategoryConfirmed: true,
  },
  ai_coach_advice: {
    scene: "ai_coach_advice",
    templateId: "saJM8i1xbgv_oH6uTevI08_8F8u_1lFyLvvhxNEPLW8",
    page: "/pages/ai-coach/index?scope=day",
    title: "AI 教练建议",
    serviceCategoryConfirmed: true,
  },
  team_activity: {
    scene: "team_activity",
    templateId: "JVY6kbiobOrSxkFWn1mG075SL6axUA3Hz9ymABKXtP8",
    page: "/pages/team/index",
    title: "小队动态",
    serviceCategoryConfirmed: true,
  },
};

export function isNotificationConfigured(scene: NotificationScene): boolean {
  const definition = NOTIFICATION_DEFINITIONS[scene];
  return definition.serviceCategoryConfirmed && /^[A-Za-z0-9_-]{20,100}$/.test(definition.templateId.trim());
}
