const cloud = require("wx-server-sdk");
const { formatBusinessDate } = require("./date");
const { stableId } = require("./repository");
const {
  CONFIG_VERSION,
  MINIPROGRAM_STATE,
  SCENES,
  SCENE_VALUES,
  getTemplate,
  isScene,
} = require("./notification-config");

const db = cloud.database();
const command = db.command;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEDGER_TTL_MS = 7 * DAY_MS;
const RETENTION_MS = 30 * DAY_MS;
const TASK_REMINDER_LEAD_MS = 10 * 60 * 1000;
const TASK_REMINDER_LATE_MS = 15 * 60 * 1000;
const TASK_REMINDER_DAILY_LIMIT = 3;
const CLIENT_SCENES = new Set(["today_completion", "daily_coach", "team_join", "team_page", "privacy_center", "task_reminder"]);
const AUTH_RESULTS = new Set(["accept", "reject", "ban", "filter"]);
const RETRYABLE_CODES = new Set([-1, 45009]);
const TERMINAL_TEMPLATE_CODES = new Set([40037, 41030, 47003]);
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertRequestObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("NOTIFICATION_INVALID", `${label}格式无效。`);
  }
}

function publicDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value.$date) return new Date(value.$date).toISOString();
  return "";
}

function cleanText(value, max = 200) {
  return Array.from(String(value || "").trim().replace(/\s+/g, " ")).slice(0, max).join("");
}

function shanghaiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  return { date: `${map.year}-${map.month}-${map.day}`, hour, minute: Number(map.minute) };
}

function startOfShanghaiDay(now = new Date()) {
  const { date } = shanghaiParts(now);
  return new Date(`${date}T00:00:00+08:00`);
}

function notificationErrorCode(error) {
  return Number(error && (error.errCode ?? error.errcode ?? error.code)) || 0;
}

function notificationErrorMessage(error) {
  return cleanText(error && (error.errMsg || error.errmsg || error.message || error), 200);
}

function validateRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(requestId)) fail("NOTIFICATION_INVALID", "通知请求标识无效。");
  return requestId;
}

function validateScene(value) {
  const scene = String(value || "");
  if (!isScene(scene)) fail("NOTIFICATION_INVALID", "通知场景无效。");
  return scene;
}

function validateTaskId(value) {
  const taskId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(taskId)) fail("NOTIFICATION_INVALID", "task id invalid");
  return taskId;
}

function reminderDocId(openid, taskId) {
  return stableId("task_reminder", `${openid}:${taskId}`);
}

function taskDocId(openid, taskId) {
  return stableId("manual_tasks", `${openid}:${taskId}`);
}

function goalDocId(openid, goalId) {
  return stableId("manual_goals", `${openid}:${goalId}`);
}

function reminderRequestId(openid, taskId, remindAt) {
  return stableId("task_reminder_delivery", `${openid}:${taskId}:${remindAt}`);
}

function validateReminderAt(value, now = new Date()) {
  const raw = String(value || "").trim();
  const remindAt = new Date(raw);
  if (!raw || Number.isNaN(remindAt.getTime())) fail("NOTIFICATION_INVALID", "remindAt invalid");
  if (remindAt.getTime() < now.getTime() + TASK_REMINDER_LEAD_MS) fail("NOTIFICATION_INVALID", "remindAt too early");
  if (remindAt.getTime() > now.getTime() + LEDGER_TTL_MS) fail("NOTIFICATION_INVALID", "remindAt exceeds quota ttl");
  const parts = shanghaiParts(remindAt);
  if (parts.minute % 5 !== 0) fail("NOTIFICATION_INVALID", "remindAt must use five minute granularity");
  return {
    remindAt,
    businessDate: parts.date,
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

async function getManualTask(openid, taskId) {
  const found = await db.collection("manual_tasks").doc(taskDocId(openid, taskId)).get().catch(() => null);
  return found && found.data || null;
}

async function getManualGoal(openid, goalId) {
  const found = await db.collection("manual_goals").doc(goalDocId(openid, goalId)).get().catch(() => null);
  return found && found.data || null;
}

function preferenceId(userId) {
  return stableId("notification_preference", userId);
}

function defaultScenePreference() {
  return { enabled: false, lastAuthorizationResult: "", lastAuthorizedAt: "" };
}

function normalizeScenePreferences(record) {
  const source = record && record.scenes && typeof record.scenes === "object" ? record.scenes : {};
  return Object.fromEntries(SCENE_VALUES.map((scene) => [scene, { ...defaultScenePreference(), ...(source[scene] || {}) }]));
}

async function getPreferenceRecord(openid, userId, create = false) {
  const id = preferenceId(userId);
  const found = await db.collection("notification_preference").doc(id).get().catch(() => null);
  if (found && found.data && found.data._openid === openid) return found.data;
  if (!create) return null;
  const now = db.serverDate();
  const data = {
    _openid: openid,
    userId,
    scenes: normalizeScenePreferences(null),
    grayEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection("notification_preference").doc(id).set({ data });
  return data;
}

async function saveScenePreference(openid, userId, scene, patch) {
  const current = await getPreferenceRecord(openid, userId, true);
  const scenes = normalizeScenePreferences(current);
  scenes[scene] = { ...scenes[scene], ...patch };
  await db.collection("notification_preference").doc(preferenceId(userId)).update({
    data: { scenes, updatedAt: db.serverDate() },
  });
  return { ...current, scenes };
}

async function countActiveQuota(openid, scene, templateId, now = new Date()) {
  if (!templateId) return 0;
  const result = await db.collection("subscription_ledger").where({
    _openid: openid,
    scene,
    templateId,
    status: command.in(["active", "scheduled"]),
    quota: command.gt(0),
    expireAt: command.gt(now),
  }).count();
  return Number(result.total || 0);
}

async function subscribe(openid, userId, event) {
  assertRequestObject(event, "通知授权请求");
  const requestId = validateRequestId(event && event.requestId);
  const clientScene = String(event && event.clientScene || "");
  if (!CLIENT_SCENES.has(clientScene)) fail("NOTIFICATION_INVALID", "通知授权来源无效。");
  const results = Array.isArray(event && event.results) ? event.results : [];
  await getPreferenceRecord(openid, userId, true);
  if (!results.length || results.length > 3) fail("NOTIFICATION_INVALID", "通知授权结果无效。");
  const response = [];
  for (const item of results) {
    assertRequestObject(item, "通知授权结果");
    const scene = validateScene(item && item.scene);
    const result = String(item && item.result || "");
    const config = getTemplate(scene);
    if (!AUTH_RESULTS.has(result)) fail("NOTIFICATION_INVALID", "通知授权状态无效。");
    if (!config || !config.configured || !config.enabled) fail("NOTIFICATION_NOT_CONFIGURED", "通知模板尚未配置完成。");
    if (String(item && item.templateId || "") !== config.templateId) fail("NOTIFICATION_INVALID", "通知模板不匹配。");
    const now = new Date();
    if (result === "accept") {
      const id = stableId("subscription_ledger", `${openid}:${scene}:${requestId}`);
      const existing = await db.collection("subscription_ledger").doc(id).get().catch(() => null);
      if (!existing || !existing.data) {
        await db.collection("subscription_ledger").doc(id).set({
          data: {
            _openid: openid,
            userId,
            templateId: config.templateId,
            scene,
            quota: 1,
            status: "active",
            authorizedAt: db.serverDate(),
            expireAt: new Date(now.getTime() + LEDGER_TTL_MS),
            consumedAt: null,
            clientScene,
            authorizationRequestId: requestId,
            reservationId: "",
            reservedAt: null,
            retentionExpireAt: null,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate(),
          },
        });
      }
      await saveScenePreference(openid, userId, scene, {
        enabled: true,
        lastAuthorizationResult: result,
        lastAuthorizedAt: now.toISOString(),
      });
    } else {
      await saveScenePreference(openid, userId, scene, { lastAuthorizationResult: result });
    }
    response.push({ scene, result, accepted: result === "accept" });
  }
  return { requestId, results: response };
}

async function getPreference(openid, userId) {
  const record = await getPreferenceRecord(openid, userId, true);
  const scenes = normalizeScenePreferences(record);
  const data = {};
  for (const scene of SCENE_VALUES) {
    const config = getTemplate(scene);
    const remainingQuota = config ? await countActiveQuota(openid, scene, config.templateId) : 0;
    data[scene] = {
      enabled: Boolean(scenes[scene].enabled),
      configured: Boolean(config && config.configured && config.enabled),
      templateId: config && config.configured && config.enabled ? config.templateId : "",
      remainingQuota,
      needsAuthorization: Boolean(scenes[scene].enabled) && remainingQuota === 0,
      lastAuthorizationResult: String(scenes[scene].lastAuthorizationResult || ""),
      lastAuthorizedAt: String(scenes[scene].lastAuthorizedAt || ""),
    };
  }
  return { scenes: data, grayEnabled: true, configVersion: CONFIG_VERSION };
}

async function expireSceneLedgers(openid, scene) {
  await db.collection("subscription_ledger").where({ _openid: openid, scene, status: command.in(["active", "scheduled"]) }).update({
    data: { status: "expired", quota: 0, reservationId: "", reservedAt: null, retentionExpireAt: new Date(Date.now() + RETENTION_MS), updatedAt: db.serverDate() },
  });
  if (scene === SCENES.DAILY_ACTION) {
    await db.collection("task_reminders").where({ _openid: openid, status: command.in(["scheduled", "sending"]) }).update({
      data: { status: "cancelled", cancelledAt: db.serverDate(), retentionExpireAt: new Date(Date.now() + RETENTION_MS), updatedAt: db.serverDate() },
    }).catch(() => undefined);
  }
}

async function unsubscribe(openid, userId, event) {
  assertRequestObject(event, "通知退订请求");
  const scene = validateScene(event && event.scene);
  await Promise.all([
    saveScenePreference(openid, userId, scene, { enabled: false }),
    expireSceneLedgers(openid, scene),
  ]);
  return { scene, enabled: false, remainingQuota: 0 };
}

async function updatePreference(openid, userId, event) {
  assertRequestObject(event, "通知偏好请求");
  const scene = validateScene(event && event.scene);
  if (typeof event.enabled !== "boolean") fail("NOTIFICATION_INVALID", "通知偏好状态无效。");
  if (!event.enabled) return unsubscribe(openid, userId, { scene });
  await saveScenePreference(openid, userId, scene, { enabled: true });
  const config = getTemplate(scene);
  const remainingQuota = config ? await countActiveQuota(openid, scene, config.templateId) : 0;
  return { scene, enabled: true, remainingQuota, needsAuthorization: remainingQuota === 0 };
}

async function createInAppMessage(openid, userId, input) {
  const id = stableId("in_app_message", `${openid}:${input.sourceEventId}:${input.scene}`);
  const existing = await db.collection("in_app_messages").doc(id).get().catch(() => null);
  if (existing && existing.data) return existing.data;
  const now = new Date();
  const data = {
    _openid: openid,
    userId,
    scene: input.scene,
    title: cleanText(input.title, 40),
    body: cleanText(input.body, 120),
    page: cleanText(input.page, 200),
    sourceEventId: cleanText(input.sourceEventId, 100),
    status: "unread",
    createdAt: db.serverDate(),
    readAt: null,
    expireAt: new Date(now.getTime() + RETENTION_MS),
  };
  await db.collection("in_app_messages").doc(id).set({ data });
  return { _id: id, ...data };
}

async function listInAppMessages(openid, event) {
  assertRequestObject(event, "站内消息列表请求");
  const limit = Math.min(10, Math.max(1, Number(event && event.limit || 5)));
  const result = await db.collection("in_app_messages").where({
    _openid: openid,
    status: "unread",
    expireAt: command.gt(new Date()),
  }).orderBy("createdAt", "desc").limit(limit).get();
  return {
    list: (result.data || []).map((item) => ({
      id: item._id,
      scene: item.scene,
      title: item.title,
      body: item.body,
      page: item.page,
      createdAt: publicDate(item.createdAt),
    })),
  };
}

async function readInAppMessage(openid, event) {
  assertRequestObject(event, "站内消息读取请求");
  const messageId = String(event && event.messageId || "");
  if (!/^in_app_message_[a-f0-9]{24}$/.test(messageId)) fail("NOTIFICATION_INVALID", "站内消息标识无效。");
  const found = await db.collection("in_app_messages").doc(messageId).get().catch(() => null);
  if (!found || !found.data || found.data._openid !== openid) fail("NOTIFICATION_NOT_FOUND", "站内消息不存在。");
  await db.collection("in_app_messages").doc(messageId).update({
    data: { status: "read", readAt: db.serverDate() },
  });
  return { messageId, read: true };
}

async function releaseTaskReminderLedger(ledgerId, reminderId, now = new Date()) {
  if (!ledgerId) return;
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("subscription_ledger").doc(ledgerId);
    const found = await ref.get().catch(() => null);
    const ledger = found && found.data;
    if (!ledger || ledger.reminderId !== reminderId || ledger.status !== "scheduled") return;
    const expired = Date.parse(publicDate(ledger.expireAt)) <= now.getTime();
    await ref.update({
      data: expired
        ? { status: "expired", quota: 0, reservationId: "", reservedAt: null, retentionExpireAt: new Date(now.getTime() + RETENTION_MS), updatedAt: db.serverDate() }
        : { status: "active", quota: 1, reminderId: "", reservationId: "", reservedAt: null, updatedAt: db.serverDate() },
    });
  });
}

async function cancelTaskReminderById(openid, userId, taskId, nextStatus = "cancelled") {
  const reminderId = reminderDocId(openid, taskId);
  const found = await db.collection("task_reminders").doc(reminderId).get().catch(() => null);
  const reminder = found && found.data;
  if (!reminder || reminder._openid !== openid || (userId && reminder.userId !== userId)) return { status: "not_found" };
  if (["sent", "cancelled", "expired"].includes(reminder.status)) return { status: reminder.status };
  await releaseTaskReminderLedger(reminder.ledgerId, reminderId);
  await db.collection("task_reminders").doc(reminderId).update({
    data: {
      status: nextStatus,
      cancelledAt: nextStatus === "cancelled" ? db.serverDate() : reminder.cancelledAt || null,
      expiredAt: nextStatus === "expired" ? db.serverDate() : reminder.expiredAt || null,
      retentionExpireAt: new Date(Date.now() + RETENTION_MS),
      updatedAt: db.serverDate(),
    },
  });
  return { status: nextStatus };
}

async function reserveTaskReminderLedger(openid, userId, scene, authorizationRequestId, reminderId, remindAt) {
  const config = getTemplate(scene);
  if (!config || !config.configured || !config.enabled) fail("NOTIFICATION_NOT_CONFIGURED", "notification template not configured");
  const ledgerId = stableId("subscription_ledger", `${openid}:${scene}:${authorizationRequestId}`);
  const found = await db.collection("subscription_ledger").doc(ledgerId).get().catch(() => null);
  const ledger = found && found.data;
  if (!ledger || ledger._openid !== openid || ledger.userId !== userId || ledger.scene !== scene || ledger.templateId !== config.templateId) {
    fail("NOTIFICATION_INVALID", "authorization quota not found");
  }
  const expiresAt = Date.parse(publicDate(ledger.expireAt));
  if (ledger.status !== "active" || Number(ledger.quota || 0) < 1 || !Number.isFinite(expiresAt) || expiresAt <= remindAt.getTime()) {
    fail("NOTIFICATION_INVALID", "authorization quota unavailable");
  }
  await db.collection("subscription_ledger").doc(ledgerId).update({
    data: { status: "scheduled", reminderId, reservationId: "", reservedAt: null, updatedAt: db.serverDate() },
  });
  return ledgerId;
}

async function upsertTaskReminder(openid, userId, event) {
  assertRequestObject(event, "task reminder request");
  validateRequestId(event && event.requestId);
  const taskId = validateTaskId(event && event.taskId);
  const { remindAt, businessDate, time } = validateReminderAt(event && event.remindAt);
  const task = await getManualTask(openid, taskId);
  if (!task || task._openid !== openid || task.deletedAt) fail("NOTIFICATION_NOT_FOUND", "task not found");
  if (task.userId !== userId) {
    if (task.source !== "ai" || task.userId) fail("NOTIFICATION_NOT_FOUND", "task not found");
    await db.collection("manual_tasks").doc(taskDocId(openid, taskId)).update({
      data: { userId, serverUpdatedAt: db.serverDate() },
    });
    task.userId = userId;
  }
  if (!["pending", "partially_completed"].includes(task.status)) fail("NOTIFICATION_INVALID", "task is not remindable");
  if (task.currentDate !== businessDate) fail("NOTIFICATION_INVALID", "reminder date must match task date");
  const preference = await preferenceAllows(openid, userId, SCENES.DAILY_ACTION);
  if (!preference.allowed) fail("NOTIFICATION_INVALID", "notification preference disabled");

  const reminderId = reminderDocId(openid, taskId);
  const sameDay = await db.collection("task_reminders").where({
    _openid: openid,
    businessDate,
    status: command.in(["scheduled", "sending"]),
  }).limit(10).get();
  const activeSameDay = (sameDay.data || []).filter((item) => item._id !== reminderId);
  if (activeSameDay.length >= TASK_REMINDER_DAILY_LIMIT) fail("NOTIFICATION_LIMITED", "daily task reminder limit reached");

  const existingResult = await db.collection("task_reminders").doc(reminderId).get().catch(() => null);
  const existing = existingResult && existingResult.data;
  let ledgerId = existing && existing.status === "scheduled" ? String(existing.ledgerId || "") : "";
  if (ledgerId) {
    const ledgerResult = await db.collection("subscription_ledger").doc(ledgerId).get().catch(() => null);
    const ledger = ledgerResult && ledgerResult.data;
    const expiresAt = Date.parse(publicDate(ledger && ledger.expireAt));
    if (!ledger || ledger.status !== "scheduled" || ledger.reminderId !== reminderId || !Number.isFinite(expiresAt) || expiresAt <= remindAt.getTime()) {
      ledgerId = "";
    }
  }
  if (!ledgerId) {
    const authorizationRequestId = validateRequestId(event && event.authorizationRequestId);
    ledgerId = await reserveTaskReminderLedger(openid, userId, SCENES.DAILY_ACTION, authorizationRequestId, reminderId, remindAt);
  }

  const data = {
    _openid: openid,
    userId,
    taskId,
    goalId: task.goalId,
    businessDate,
    remindAt,
    time,
    timezone: "Asia/Shanghai",
    status: "scheduled",
    ledgerId,
    requestId: reminderRequestId(openid, taskId, remindAt.toISOString()),
    createdAt: existing && existing.createdAt || db.serverDate(),
    sentAt: null,
    cancelledAt: null,
    expiredAt: null,
    retentionExpireAt: null,
    updatedAt: db.serverDate(),
  };
  await db.collection("task_reminders").doc(reminderId).set({ data });
  return { status: "scheduled", remindAt: remindAt.toISOString(), businessDate, time };
}

async function cancelTaskReminder(openid, userId, event) {
  assertRequestObject(event, "task reminder cancel request");
  validateRequestId(event && event.requestId);
  return cancelTaskReminderById(openid, userId, validateTaskId(event && event.taskId), "cancelled");
}

async function preferenceAllows(openid, userId, scene) {
  const record = await getPreferenceRecord(openid, userId, false);
  if (!record) return { allowed: false, reason: "preference_disabled" };
  const scenes = normalizeScenePreferences(record);
  if (!scenes[scene].enabled) return { allowed: false, reason: "preference_disabled" };
  return { allowed: true, record };
}

async function writeSentLog(openid, userId, input) {
  const id = stableId("notification_sent", `${openid}:${input.requestId}`);
  const existing = await db.collection("notification_sent_log").doc(id).get().catch(() => null);
  const createdAt = existing && existing.data ? existing.data.createdAt : db.serverDate();
  await db.collection("notification_sent_log").doc(id).set({
    data: {
      _openid: openid,
      userId,
      scene: input.scene,
      templateId: input.templateId || "",
      status: input.status,
      errcode: input.errcode || null,
      errmsg: cleanText(input.errmsg, 200) || null,
      requestId: input.requestId,
      actorUserId: input.actorUserId || "",
      deliveryType: input.deliveryType || "scene",
      attemptCount: Number(input.attemptCount || 0),
      configVersion: CONFIG_VERSION,
      terminalConfigError: Boolean(input.terminalConfigError),
      sentAt: db.serverDate(),
      createdAt,
      updatedAt: db.serverDate(),
    },
  });
}

async function alreadyDelivered(openid, requestId) {
  const id = stableId("notification_sent", `${openid}:${requestId}`);
  const found = await db.collection("notification_sent_log").doc(id).get().catch(() => null);
  return Boolean(found && found.data && found.data.status === "success");
}

async function claimDelivery(openid, userId, input, now = new Date()) {
  const id = stableId("notification_sent", `${openid}:${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection("notification_sent_log").doc(id);
    const found = await ref.get().catch(() => null);
    const current = found && found.data;
    const currentTime = Date.parse(publicDate(current && current.updatedAt));
    const activeClaim = current && current.status === "sending"
      && Number.isFinite(currentTime)
      && currentTime > now.getTime() - 10 * 60 * 1000;
    if (current && (current.status === "success" || activeClaim)) return false;
    const createdAt = current && current.createdAt || db.serverDate();
    await ref.set({ data: {
      _openid: openid,
      userId,
      scene: input.scene,
      templateId: input.templateId,
      status: "sending",
      errcode: null,
      errmsg: null,
      requestId: input.requestId,
      actorUserId: input.actorUserId || "",
      deliveryType: input.deliveryType || "scene",
      attemptCount: 0,
      configVersion: CONFIG_VERSION,
      terminalConfigError: false,
      sentAt: null,
      createdAt,
      updatedAt: db.serverDate(),
    } });
    return true;
  });
}

async function withinLimits(openid, scene, config, actorUserId, now = new Date(), deliveryType = "scene") {
  const dayStart = startOfShanghaiDay(now);
  const deliveredStatuses = command.in(["success", "failed"]);
  const [sceneCount, globalCount, recentCount] = await Promise.all([
    db.collection("notification_sent_log").where({ _openid: openid, scene, status: deliveredStatuses, sentAt: command.gte(dayStart) }).count(),
    db.collection("notification_sent_log").where({ _openid: openid, status: deliveredStatuses, sentAt: command.gte(dayStart) }).count(),
    db.collection("notification_sent_log").where({ _openid: openid, status: deliveredStatuses, sentAt: command.gte(new Date(now.getTime() - 30 * 60 * 1000)) }).count(),
  ]);
  if (Number(sceneCount.total || 0) >= config.dailyLimit) return false;
  if (Number(globalCount.total || 0) >= 7 || Number(recentCount.total || 0) >= 2) return false;
  if (deliveryType === "task_reminder") {
    const taskReminderCount = await db.collection("notification_sent_log").where({
      _openid: openid,
      deliveryType: "task_reminder",
      status: deliveredStatuses,
      sentAt: command.gte(dayStart),
    }).count();
    if (Number(taskReminderCount.total || 0) >= TASK_REMINDER_DAILY_LIMIT) return false;
  }
  if (scene === SCENES.TEAM_ACTIVITY && actorUserId) {
    const actorCount = await db.collection("notification_sent_log").where({
      _openid: openid,
      scene,
      actorUserId,
      status: deliveredStatuses,
      sentAt: command.gte(new Date(now.getTime() - 30 * 60 * 1000)),
    }).count();
    if (Number(actorCount.total || 0) > 0) return false;
  }
  return true;
}

async function templateCircuitOpen(config) {
  const result = await db.collection("notification_sent_log").where({
    templateId: config.templateId,
    configVersion: CONFIG_VERSION,
    terminalConfigError: true,
  }).limit(1).get();
  return Boolean(result.data && result.data.length);
}

async function reserveLedger(openid, scene, templateId, requestId, now = new Date(), options = {}) {
  if (options.ledgerId) {
    const reserved = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection("subscription_ledger").doc(options.ledgerId);
      const found = await ref.get().catch(() => null);
      const current = found && found.data;
      const expiresAt = Date.parse(publicDate(current && current.expireAt));
      const staleReservation = current && current.reservedAt
        && Date.parse(publicDate(current.reservedAt)) < now.getTime() - 5 * 60 * 1000;
      if (!current || current._openid !== openid || current.scene !== scene || current.templateId !== templateId) return false;
      if (current.status !== "scheduled" || current.reminderId !== options.reminderId || Number(current.quota || 0) < 1) return false;
      if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
      if (current.reservationId && !staleReservation) return false;
      await ref.update({ data: { reservationId: requestId, reservedAt: db.serverDate(), updatedAt: db.serverDate() } });
      return true;
    });
    return reserved ? options.ledgerId : "";
  }
  const candidates = await db.collection("subscription_ledger").where({
    _openid: openid,
    scene,
    templateId,
    status: "active",
    quota: command.gt(0),
    expireAt: command.gt(now),
  }).orderBy("authorizedAt", "asc").limit(5).get();
  for (const item of candidates.data || []) {
    const reserved = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection("subscription_ledger").doc(item._id);
      const found = await ref.get().catch(() => null);
      const current = found && found.data;
      const staleReservation = current && current.reservedAt
        && Date.parse(publicDate(current.reservedAt)) < now.getTime() - 5 * 60 * 1000;
      if (!current || current.status !== "active" || Number(current.quota || 0) < 1) return false;
      if (current.reservationId && !staleReservation) return false;
      await ref.update({ data: { reservationId: requestId, reservedAt: db.serverDate(), updatedAt: db.serverDate() } });
      return true;
    });
    if (reserved) return item._id;
  }
  return "";
}

async function finishLedger(ledgerId, requestId, success, terminal) {
  if (!ledgerId) return;
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection("subscription_ledger").doc(ledgerId);
    const found = await ref.get().catch(() => null);
    const current = found && found.data;
    if (!current || current.reservationId !== requestId) return;
    if (success) {
      await ref.update({ data: { status: "consumed", quota: 0, consumedAt: db.serverDate(), reservationId: "", reservedAt: null, retentionExpireAt: new Date(Date.now() + RETENTION_MS), updatedAt: db.serverDate() } });
    } else if (terminal) {
      await ref.update({ data: { status: "expired", quota: 0, reservationId: "", reservedAt: null, retentionExpireAt: new Date(Date.now() + RETENTION_MS), updatedAt: db.serverDate() } });
    } else {
      await ref.update({ data: { reservationId: "", reservedAt: null, updatedAt: db.serverDate() } });
    }
  });
}

function buildTemplateData(config, payload) {
  const data = {};
  for (const [logicalKey, templateKey] of Object.entries(config.dataKeys)) {
    const keywordType = String(templateKey).replace(/\d+$/, "");
    const typeMaxLength = { thing: 20, phrase: 5, name: 10, character_string: 32 }[keywordType] || 100;
    const value = cleanText(payload[logicalKey], Math.min(config.maxLengths[logicalKey] || 20, typeMaxLength));
    if (!value) fail("NOTIFICATION_INVALID", `通知字段 ${logicalKey} 为空。`);
    if (keywordType === "number" && !/^\d+(?:\.\d+)?$/.test(value)) {
      fail("NOTIFICATION_INVALID", `通知字段 ${logicalKey} 不是有效数字。`);
    }
    // 微信公共模板“打卡提醒”的“打卡时间”实际键为 date2，但平台示例值为 HH:mm。
    // 因此 date 类型同时接受标准日期和该审核模板要求的时分格式。
    if (keywordType === "date" && !/^(?:\d{4}-\d{2}-\d{2}|(?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) {
      fail("NOTIFICATION_INVALID", `通知字段 ${logicalKey} 不是有效日期。`);
    }
    if (keywordType === "time" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      fail("NOTIFICATION_INVALID", `通知字段 ${logicalKey} 不是有效时间。`);
    }
    if (keywordType === "character_string" && !/^[A-Za-z0-9_-]{1,32}$/.test(value)) {
      fail("NOTIFICATION_INVALID", `通知字段 ${logicalKey} 不符合字符格式。`);
    }
    data[templateKey] = { value };
  }
  return data;
}

async function callSubscribeMessage(openid, config, page, data) {
  let lastError;
  let attemptCount = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    attemptCount = attempt + 1;
    try {
      const result = await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: config.templateId,
        page,
        miniprogramState: MINIPROGRAM_STATE,
        lang: "zh_CN",
        data,
      });
      return { result, attemptCount: attempt + 1 };
    } catch (error) {
      lastError = error;
      const code = notificationErrorCode(error);
      if (!RETRYABLE_CODES.has(code) || attempt >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, [2000, 4000, 8000][attempt]));
    }
  }
  throw Object.assign(lastError || new Error("subscribeMessage.send failed"), { attemptCount });
}

async function sendNotification(input) {
  const scene = validateScene(input.scene);
  const requestId = validateRequestId(input.requestId);
  const config = getTemplate(scene);
  if (!config || !config.configured || !config.enabled) return { sent: false, reason: "not_configured" };
  if (await alreadyDelivered(input.openid, requestId)) return { sent: true, duplicate: true };
  const preference = await preferenceAllows(input.openid, input.userId, scene);
  if (!preference.allowed) return { sent: false, reason: preference.reason };
  if (await templateCircuitOpen(config)) return { sent: false, reason: "template_circuit_open" };
  if (!await withinLimits(input.openid, scene, config, input.actorUserId, new Date(), input.deliveryType || "scene")) return { sent: false, reason: "rate_limited" };
  const ledgerId = await reserveLedger(input.openid, scene, config.templateId, requestId, new Date(), {
    ledgerId: input.ledgerId,
    reminderId: input.reminderId,
  });
  if (!ledgerId) return { sent: false, reason: "no_quota" };
  const claimed = await claimDelivery(input.openid, input.userId, {
    scene,
    templateId: config.templateId,
    requestId,
    actorUserId: input.actorUserId,
    deliveryType: input.deliveryType || "scene",
  });
  if (!claimed) {
    await finishLedger(ledgerId, requestId, false, false);
    return { sent: await alreadyDelivered(input.openid, requestId), duplicate: true };
  }
  let attemptCount = 0;
  try {
    const data = buildTemplateData(config, input.payload);
    const response = await callSubscribeMessage(input.openid, config, input.page || config.page, data);
    attemptCount = response.attemptCount;
    await finishLedger(ledgerId, requestId, true, false);
    await writeSentLog(input.openid, input.userId, {
      scene,
      templateId: config.templateId,
      status: "success",
      requestId,
      actorUserId: input.actorUserId,
      attemptCount,
      deliveryType: input.deliveryType || "scene",
    });
    return { sent: true };
  } catch (error) {
    const errcode = notificationErrorCode(error);
    attemptCount = Number(error && error.attemptCount || attemptCount || 1);
    const terminal = errcode === 43101;
    await finishLedger(ledgerId, requestId, false, terminal);
    await writeSentLog(input.openid, input.userId, {
      scene,
      templateId: config.templateId,
      status: "failed",
      errcode,
      errmsg: notificationErrorMessage(error),
      requestId,
      actorUserId: input.actorUserId,
      attemptCount,
      terminalConfigError: TERMINAL_TEMPLATE_CODES.has(errcode),
      deliveryType: input.deliveryType || "scene",
    });
    const fallbackPreference = input.inApp
      ? await preferenceAllows(input.openid, input.userId, scene)
      : { allowed: false };
    if (input.inApp && fallbackPreference.allowed) {
      await createInAppMessage(input.openid, input.userId, {
        ...input.inApp,
        scene,
        sourceEventId: input.inApp.sourceEventId || requestId,
      });
    }
    return { sent: false, reason: "send_failed", errcode };
  }
}

async function listSceneSubscribers(scene, ledgerFilter = () => true) {
  const config = getTemplate(scene);
  if (!config || !config.configured || !config.enabled) return [];
  const result = await db.collection("subscription_ledger").where({
    scene,
    templateId: config.templateId,
    status: "active",
    quota: command.gt(0),
    expireAt: command.gt(new Date()),
  }).limit(1000).get();
  const unique = new Map();
  for (const item of result.data || []) {
    if (ledgerFilter(item) && item._openid && item.userId && !unique.has(item._openid)) {
      unique.set(item._openid, { openid: item._openid, userId: item.userId });
    }
  }
  return Array.from(unique.values());
}

async function listEligibleSceneSubscribers(scene, ledgerFilter) {
  const subscribers = await listSceneSubscribers(scene, ledgerFilter);
  const eligibility = await Promise.all(subscribers.map(async (subscriber) => ({
    subscriber,
    allowed: (await preferenceAllows(subscriber.openid, subscriber.userId, scene)).allowed,
  })));
  return eligibility.filter((item) => item.allowed).map((item) => item.subscriber);
}

async function getActiveManualGoal(openid) {
  const result = await db.collection("manual_goals").where({ _openid: openid, status: "active" }).limit(1).get();
  return result.data && result.data[0] || null;
}

async function dispatchDailyActions(now = new Date()) {
  const businessDate = formatBusinessDate(now);
  const previousDay = formatBusinessDate(new Date(startOfShanghaiDay(now).getTime() - DAY_MS));
  const subscribers = await listEligibleSceneSubscribers(SCENES.DAILY_ACTION, (ledger) => {
    const authorizedAt = new Date(publicDate(ledger.authorizedAt));
    if (Number.isNaN(authorizedAt.getTime())) return false;
    const parts = shanghaiParts(authorizedAt);
    return parts.date === previousDay && parts.hour < 22;
  });
  const results = await Promise.allSettled(subscribers.map(async ({ openid, userId }) => {
    const goal = await getActiveManualGoal(openid);
    if (!goal) return { sent: false, reason: "no_goal" };
    const taskResult = await db.collection("manual_tasks").where({ _openid: openid, goalId: goal.id, currentDate: businessDate }).limit(100).get();
    const pending = (taskResult.data || []).filter((task) => !task.deletedAt && ["pending", "partially_completed"].includes(task.status));
    if (!pending.length) return { sent: false, reason: "no_pending_action" };
    return sendNotification({
      openid,
      userId,
      scene: SCENES.DAILY_ACTION,
      requestId: `n1:${businessDate}:${userId}`,
      payload: {
        date: businessDate,
        actionCount: `${pending.length}项行动待完成`,
        goalName: goal.title,
        hint: "打开小程序开始今日行动",
      },
      inApp: { title: "今日行动待开始", body: `今天还有 ${pending.length} 项行动待推进。`, page: "/pages/index/index" },
    });
  }));
  return { scene: SCENES.DAILY_ACTION, total: subscribers.length, completed: results.length };
}

function notificationSnapshot(goal, tasks, checkins, businessDate) {
  return {
    goalId: goal.id,
    range: "day",
    goal: { id: goal.id, title: goal.title, category: goal.category, status: goal.status, createdAt: goal.createdAt || "", startedAt: goal.startedAt || "" },
    goals: [{ id: goal.id, title: goal.title, category: goal.category, status: goal.status, createdAt: goal.createdAt || "", startedAt: goal.startedAt || "" }],
    tasks: tasks.map((task) => ({
      id: task.id,
      goalId: task.goalId,
      title: task.title,
      plannedDate: task.plannedDate || task.currentDate,
      currentDate: task.currentDate,
      status: task.status,
      estimatedMinutes: Number(task.estimatedMinutes || 0),
      actualMinutes: Number(task.actualMinutes || 0),
      issueReason: task.issueReason || "",
      reflection: task.reflection || "",
      createdAt: task.createdAt || "",
      updatedAt: task.updatedAt || "",
    })),
    checkins: checkins.map((item) => ({
      id: item.id,
      goalId: item.goalId,
      businessDate: item.businessDate,
      completedCount: Number(item.completedCount || 0),
      partialCount: Number(item.partialCount || 0),
      actualMinutes: Number(item.actualMinutes || 0),
    })),
    sourceUpdatedAt: tasks.map((item) => item.updatedAt || item.createdAt || "").sort().pop() || goal.updatedAt || goal.createdAt || new Date().toISOString(),
    referenceDate: businessDate,
  };
}

async function dispatchAiCoach(now = new Date()) {
  // 延迟加载，避免 progress-coach -> manual-sync -> notification 的循环依赖。
  const { analyzeSnapshot } = require("./progress-coach");
  const businessDate = formatBusinessDate(now);
  const notificationTime = shanghaiParts(now);
  const generatedAt = `${String(notificationTime.hour).padStart(2, "0")}:${String(notificationTime.minute).padStart(2, "0")}`;
  const subscribers = await listEligibleSceneSubscribers(SCENES.AI_COACH);
  const results = await Promise.allSettled(subscribers.map(async ({ openid, userId }) => {
    try {
      const goal = await getActiveManualGoal(openid);
      if (!goal) return { sent: false, reason: "no_goal" };
      const [taskResult, checkinResult] = await Promise.all([
        db.collection("manual_tasks").where({ _openid: openid, goalId: goal.id, currentDate: businessDate }).limit(100).get(),
        db.collection("manual_checkins").where({ _openid: openid, goalId: goal.id, businessDate }).limit(20).get(),
      ]);
      const tasks = (taskResult.data || []).filter((task) => !task.deletedAt);
      if (!tasks.length) return { sent: false, reason: "no_action_data" };
      const snapshot = notificationSnapshot(goal, tasks, checkinResult.data || [], businessDate);
      const analysis = await analyzeSnapshot(snapshot, businessDate);
      const advice = cleanText(analysis.nextSuggestions && analysis.nextSuggestions[0] || analysis.summary, 20);
      if (!advice) return { sent: false, reason: "empty_advice" };
      const page = `/pages/daily-coach/index?date=${encodeURIComponent(businessDate)}&goalId=${encodeURIComponent(goal.id)}`;
      return sendNotification({
        openid,
        userId,
        scene: SCENES.AI_COACH,
        requestId: `n2:${businessDate}:${userId}`,
        page,
        payload: { date: generatedAt, adviceSummary: advice, goalName: goal.title, detailText: "每日教练建议" },
        inApp: { title: "AI 教练建议已生成", body: advice, page },
      });
    } catch (error) {
      console.error("notification AI dispatch failed", { userIdSuffix: String(userId).slice(-8), code: error && error.code || "AI_FAILED" });
      return { sent: false, reason: "ai_failed" };
    }
  }));
  return { scene: SCENES.AI_COACH, total: subscribers.length, completed: results.length };
}

async function claimTaskReminder(reminder, now = new Date()) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection("task_reminders").doc(reminder._id);
    const found = await ref.get().catch(() => null);
    const current = found && found.data;
    if (!current || current.status !== "scheduled") return null;
    const dueTime = Date.parse(publicDate(current.remindAt));
    if (!Number.isFinite(dueTime) || dueTime > now.getTime()) return null;
    await ref.update({ data: { status: "sending", claimedAt: db.serverDate(), updatedAt: db.serverDate() } });
    return { _id: reminder._id, ...current };
  });
}

async function expireClaimedTaskReminder(reminder, now = new Date()) {
  await releaseTaskReminderLedger(reminder.ledgerId, reminder._id, now);
  await db.collection("task_reminders").doc(reminder._id).update({
    data: { status: "expired", expiredAt: db.serverDate(), retentionExpireAt: new Date(now.getTime() + RETENTION_MS), updatedAt: db.serverDate() },
  });
}

async function failClaimedTaskReminder(reminder) {
  await releaseTaskReminderLedger(reminder.ledgerId, reminder._id);
  await db.collection("task_reminders").doc(reminder._id).update({
    data: { status: "failed", failedAt: db.serverDate(), retentionExpireAt: new Date(Date.now() + RETENTION_MS), updatedAt: db.serverDate() },
  });
}

async function markTaskReminderSent(reminder) {
  await db.collection("task_reminders").doc(reminder._id).update({
    data: { status: "sent", sentAt: db.serverDate(), retentionExpireAt: new Date(Date.now() + RETENTION_MS), updatedAt: db.serverDate() },
  });
}

async function dispatchTaskReminder(reminder, now = new Date()) {
  const remindAtTime = Date.parse(publicDate(reminder.remindAt));
  if (!Number.isFinite(remindAtTime) || remindAtTime < now.getTime() - TASK_REMINDER_LATE_MS) {
    await expireClaimedTaskReminder(reminder, now);
    return { sent: false, reason: "expired" };
  }
  const task = await getManualTask(reminder._openid, reminder.taskId);
  if (!task || task.deletedAt || !["pending", "partially_completed"].includes(task.status) || task.currentDate !== reminder.businessDate) {
    await cancelTaskReminderById(reminder._openid, reminder.userId, reminder.taskId, "cancelled");
    return { sent: false, reason: "task_not_remindable" };
  }
  const goal = await getManualGoal(reminder._openid, task.goalId);
  if (!goal || goal.status !== "active") {
    await cancelTaskReminderById(reminder._openid, reminder.userId, reminder.taskId, "cancelled");
    return { sent: false, reason: "goal_inactive" };
  }
  const result = await sendNotification({
    openid: reminder._openid,
    userId: reminder.userId,
    scene: SCENES.DAILY_ACTION,
    requestId: reminder.requestId,
    page: "/pages/index/index",
    payload: {
      date: reminder.businessDate,
      actionCount: task.title,
      goalName: goal.title,
      hint: `${reminder.time || "00:00"} 开始这项行动`,
    },
    inApp: {
      title: "行动提醒",
      body: cleanText(task.title, 40),
      page: "/pages/index/index",
      sourceEventId: reminder._id,
    },
    deliveryType: "task_reminder",
    ledgerId: reminder.ledgerId,
    reminderId: reminder._id,
  });
  if (result.sent) {
    await markTaskReminderSent(reminder);
  } else if (["no_quota", "rate_limited", "preference_disabled", "template_circuit_open", "not_configured", "send_failed"].includes(result.reason)) {
    await failClaimedTaskReminder(reminder);
  }
  return result;
}

async function dispatchTaskReminders(now = new Date()) {
  const due = await db.collection("task_reminders").where({
    status: "scheduled",
    remindAt: command.lte(now),
  }).orderBy("remindAt", "asc").limit(100).get();
  const results = [];
  for (const item of due.data || []) {
    const reminder = await claimTaskReminder(item, now);
    if (!reminder) continue;
    try {
      results.push(await dispatchTaskReminder(reminder, now));
    } catch (error) {
      await failClaimedTaskReminder(reminder).catch(() => undefined);
      results.push({ sent: false, reason: "dispatch_failed", code: error && (error.code || error.errCode) || "UNKNOWN" });
    }
  }
  return { scene: "task_reminder", total: due.data ? due.data.length : 0, completed: results.length, sent: results.filter((item) => item.sent).length };
}

async function cleanupNotificationData(now = new Date()) {
  await Promise.all([
    db.collection("subscription_ledger").where({ status: command.in(["active", "scheduled"]), expireAt: command.lte(now) }).update({ data: { status: "expired", quota: 0, reservationId: "", reservedAt: null, retentionExpireAt: new Date(now.getTime() + RETENTION_MS), updatedAt: db.serverDate() } }),
    db.collection("subscription_ledger").where({ status: command.in(["consumed", "expired"]), retentionExpireAt: command.lte(now) }).remove(),
    db.collection("notification_sent_log").where({ sentAt: command.lte(new Date(now.getTime() - RETENTION_MS)) }).remove(),
    db.collection("in_app_messages").where({ expireAt: command.lte(now) }).remove(),
    db.collection("task_reminders").where({ status: "sending", claimedAt: command.lte(new Date(now.getTime() - 10 * 60 * 1000)) }).update({ data: { status: "scheduled", updatedAt: db.serverDate() } }),
    db.collection("task_reminders").where({ status: command.in(["sent", "cancelled", "expired", "failed"]), retentionExpireAt: command.lte(now) }).remove(),
  ]).catch((error) => console.warn("notification cleanup failed", { code: error && (error.code || error.errCode) }));
}

async function runScheduled(now = new Date()) {
  const { hour, minute } = shanghaiParts(now);
  await cleanupNotificationData(now);
  const taskReminders = await dispatchTaskReminders(now);
  const scheduled = [taskReminders];
  if (hour === 8 && minute === 0) scheduled.push(await dispatchDailyActions(now));
  if (hour === 12 && minute === 0) scheduled.push(await dispatchAiCoach(now));
  return { completed: scheduled };
}

function anonymousName(teamId, userId) {
  const number = parseInt(stableId("anonymous", `${teamId}:${userId}`).slice(-8), 16) % 100;
  return `同行者 ${String(number).padStart(2, "0")}`;
}

async function notifyTeamActionCompleted(input) {
  const config = getTemplate(SCENES.TEAM_ACTIVITY);
  if (!config || !config.configured || !config.enabled || !input.completedTasks || !input.completedTasks.length) return { notified: 0 };
  const memberResult = await db.collection("team_members").where({ userId: input.userId, status: "active" }).limit(1).get();
  const actorMembership = memberResult.data && memberResult.data[0];
  if (!actorMembership) return { notified: 0 };
  const teamResult = await db.collection("teams").doc(actorMembership.teamId).get().catch(() => null);
  const team = teamResult && teamResult.data;
  if (!team || team.status !== "active") return { notified: 0 };
  const [actorResult, membersResult] = await Promise.all([
    db.collection("users").doc(input.userId).get().catch(() => null),
    db.collection("team_members").where({ teamId: team._id, status: "active" }).limit(50).get(),
  ]);
  const actor = actorResult && actorResult.data || {};
  const publicTeam = team.anonymityMode === "public";
  const nameVisible = publicTeam && actor.useProfileInTeam !== false && actorMembership.displayMode !== "anonymous";
  const actionVisible = nameVisible && actorMembership.displayMode === "public" && actorMembership.taskDetailVisible === true;
  const memberName = nameVisible ? cleanText(actor.nickname || "行动伙伴", 20) : anonymousName(team._id, input.userId);
  const firstTask = input.completedTasks[0];
  const actionName = actionVisible
    ? cleanText(input.completedTasks.length > 1 ? `${firstTask.title}等${input.completedTasks.length}项` : firstTask.title, 20)
    : "完成了今日行动";
  const completionTime = shanghaiParts();
  const { hour } = completionTime;
  const quiet = hour >= 22 || hour < 8;
  const recipients = [];
  for (const membership of membersResult.data || []) {
    if (membership.userId === input.userId) continue;
    const preferenceResult = await db.collection("notification_preference").doc(preferenceId(membership.userId)).get().catch(() => null);
    const recipientPreference = preferenceResult && preferenceResult.data;
    const recipientOpenid = String(recipientPreference && recipientPreference._openid || "");
    if (!recipientOpenid) continue;
    const allowed = await preferenceAllows(recipientOpenid, membership.userId, SCENES.TEAM_ACTIVITY);
    if (!allowed.allowed) continue;
    const requestId = `n3:${input.eventId}:${membership.userId}`.slice(0, 100);
    const page = "/pages/team-activity/index";
    const inApp = {
      title: "小队伙伴完成了行动",
      body: `${memberName} ${actionName}`,
      page,
      sourceEventId: input.eventId,
    };
    if (quiet) {
      await createInAppMessage(recipientOpenid, membership.userId, { ...inApp, scene: SCENES.TEAM_ACTIVITY });
      recipients.push({ sent: false, reason: "quiet_hours" });
      continue;
    }
    recipients.push(await sendNotification({
      openid: recipientOpenid,
      userId: membership.userId,
      actorUserId: input.userId,
      scene: SCENES.TEAM_ACTIVITY,
      requestId,
      payload: {
        memberName,
        actionName,
        teamName: cleanText(team.name || "我的小队", 20),
        completedAt: `${String(completionTime.hour).padStart(2, "0")}:${String(completionTime.minute).padStart(2, "0")}`,
      },
      inApp,
    }));
  }
  return { notified: recipients.filter((item) => item.sent).length, attempted: recipients.length };
}

module.exports = {
  AUTH_RESULTS,
  CLIENT_SCENES,
  RETRYABLE_CODES,
  SCENES,
  assertRequestObject,
  buildTemplateData,
  cleanupNotificationData,
  cancelTaskReminder,
  cancelTaskReminderById,
  createInAppMessage,
  dispatchAiCoach,
  dispatchDailyActions,
  dispatchTaskReminders,
  getPreference,
  listInAppMessages,
  notifyTeamActionCompleted,
  readInAppMessage,
  runScheduled,
  sendNotification,
  shanghaiParts,
  subscribe,
  unsubscribe,
  updatePreference,
  upsertTaskReminder,
  validateRequestId,
};
