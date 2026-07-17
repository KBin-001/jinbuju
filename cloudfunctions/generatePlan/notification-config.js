const SCENES = Object.freeze({
  DAILY_ACTION: "daily_action_reminder",
  AI_COACH: "ai_coach_advice",
  TEAM_ACTIVITY: "team_activity",
});

const SCENE_VALUES = Object.freeze(Object.values(SCENES));

function envText(name) {
  return String(process.env[name] || "").trim();
}

function template(scene, options) {
  const templateId = envText(options.templateEnv);
  const dataKeys = Object.fromEntries(
    Object.entries(options.keyEnvs).map(([logicalKey, envName]) => [logicalKey, envText(envName)]),
  );
  const keywordKeys = Object.values(dataKeys);
  const configured = process.env.NOTIFICATION_SERVICE_CATEGORY_CONFIRMED === "true"
    && /^[A-Za-z0-9._-]{3,80}$/.test(envText("NOTIFICATION_CONFIG_VERSION"))
    && /^[A-Za-z0-9_-]{20,100}$/.test(templateId)
    && keywordKeys.every((key) => /^[a-z_]+\d+$/.test(key))
    && new Set(keywordKeys).size === keywordKeys.length;
  return Object.freeze({
    scene,
    enabled: process.env.NOTIFICATION_ENABLED === "true" && configured,
    configured,
    templateId,
    page: options.page,
    dataKeys: Object.freeze(dataKeys),
    dailyLimit: options.dailyLimit,
    maxLengths: Object.freeze(options.maxLengths),
    title: options.title,
  });
}

const TEMPLATES = Object.freeze({
  [SCENES.DAILY_ACTION]: template(SCENES.DAILY_ACTION, {
    templateEnv: "NOTIFICATION_TEMPLATE_DAILY_ACTION",
    keyEnvs: {
      date: "NOTIFICATION_N1_KEY_DATE",
      actionCount: "NOTIFICATION_N1_KEY_ACTION_COUNT",
      goalName: "NOTIFICATION_N1_KEY_GOAL_NAME",
      hint: "NOTIFICATION_N1_KEY_HINT",
    },
    page: "pages/index/index",
    dailyLimit: 1,
    maxLengths: { date: 20, actionCount: 20, goalName: 20, hint: 20 },
    title: "今日行动提醒",
  }),
  [SCENES.AI_COACH]: template(SCENES.AI_COACH, {
    templateEnv: "NOTIFICATION_TEMPLATE_AI_COACH",
    keyEnvs: {
      date: "NOTIFICATION_N2_KEY_DATE",
      adviceSummary: "NOTIFICATION_N2_KEY_ADVICE",
      goalName: "NOTIFICATION_N2_KEY_GOAL_NAME",
      detailText: "NOTIFICATION_N2_KEY_DETAIL",
    },
    page: "pages/daily-coach/index",
    dailyLimit: 1,
    maxLengths: { date: 20, adviceSummary: 20, goalName: 20, detailText: 20 },
    title: "AI 教练每日建议",
  }),
  [SCENES.TEAM_ACTIVITY]: template(SCENES.TEAM_ACTIVITY, {
    templateEnv: "NOTIFICATION_TEMPLATE_TEAM_ACTIVITY",
    keyEnvs: {
      memberName: "NOTIFICATION_N3_KEY_MEMBER_NAME",
      actionName: "NOTIFICATION_N3_KEY_ACTION_NAME",
      teamName: "NOTIFICATION_N3_KEY_TEAM_NAME",
      completedAt: "NOTIFICATION_N3_KEY_COMPLETED_AT",
    },
    page: "pages/team-activity/index",
    dailyLimit: 5,
    maxLengths: { memberName: 20, actionName: 20, teamName: 20, completedAt: 20 },
    title: "小队动态提醒",
  }),
});

const requestedState = envText("NOTIFICATION_MINIPROGRAM_STATE");
const MINIPROGRAM_STATE = ["developer", "trial", "formal"].includes(requestedState)
  ? requestedState
  : "formal";

const CONFIG_VERSION = envText("NOTIFICATION_CONFIG_VERSION") || "notification-unconfigured-v1";

function getTemplate(scene) {
  return TEMPLATES[String(scene || "")] || null;
}

function isScene(value) {
  return SCENE_VALUES.includes(String(value || ""));
}

module.exports = {
  CONFIG_VERSION,
  MINIPROGRAM_STATE,
  SCENES,
  SCENE_VALUES,
  TEMPLATES,
  getTemplate,
  isScene,
};
