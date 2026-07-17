const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { stableId } = require("./repository");
const { POLICY_VERSIONS } = require("./legal-constants");
const { assertSafeAvatar } = require("./content-security");

const db = cloud.database();

function accountError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const wechatBindingId = (openid) => stableId("binding", `wechat:${openid}`);
const phoneBindingId = (phone) => stableId("binding", `phone:${phone}`);
const maskPhone = (phone) => String(phone || "").replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
const displayId = (userId) => `JB-${stableId("display", userId).slice(-8).toUpperCase()}`;

function publicProfile(user) {
  const joinedAt = user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt || "");
  return {
    nickname: String(user.nickname || "行动伙伴"),
    avatarUrl: String(user.avatarUrl || ""),
    profileSource: user.profileSource === "wechat" ? "wechat" : "custom",
    useProfileInTeam: user.useProfileInTeam !== false,
    themeId: String(user.themeId || ""),
    welcomeCompleted: user.welcomeCompleted === true,
    joinedAt,
    updatedAt: user.profileUpdatedAt || user.updatedAt || "",
  };
}

async function resolveAccount(openid, create = true) {
  const bindingId = wechatBindingId(openid);
  const binding = await db.collection("account_bindings").doc(bindingId).get().catch(() => null);
  if (binding && binding.data) {
    const found = await db.collection("users").doc(binding.data.userId).get().catch(() => null);
    if (found && found.data) return { userId: binding.data.userId, user: found.data };
  }
  if (!create) return null;

  const legacyUserId = stableId("user", openid);
  const legacy = await db.collection("users").doc(legacyUserId).get().catch(() => null);
  const userId = legacy && legacy.data ? legacyUserId : `user_${crypto.randomBytes(16).toString("hex")}`;
  const now = db.serverDate();
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.collection("account_bindings").doc(bindingId).get().catch(() => null);
    if (existing && existing.data) return;
    const current = await transaction.collection("users").doc(userId).get().catch(() => null);
    if (!current || !current.data) {
      await transaction.collection("users").doc(userId).set({
        data: { userId, status: "active", nickname: "行动伙伴", avatarUrl: "", useProfileInTeam: true, createdAt: now, updatedAt: now },
      });
    } else {
      await transaction.collection("users").doc(userId).update({ data: { userId, status: "active", updatedAt: now } });
    }
    await transaction.collection("account_bindings").doc(bindingId).set({
      data: { userId, provider: "wechat", providerKeyHash: bindingId, createdAt: now, updatedAt: now },
    });
  });
  const found = await db.collection("users").doc(userId).get();
  return { userId, user: found.data };
}

function publicAccount(userId, user) {
  return {
    userId,
    displayId: displayId(userId),
    status: user.status || "active",
    phoneBound: Boolean(user.phoneMasked),
    phoneMasked: String(user.phoneMasked || ""),
  };
}

async function bootstrapAccount(openid) {
  const resolved = await resolveAccount(openid, true);
  return {
    account: publicAccount(resolved.userId, resolved.user),
    profile: publicProfile(resolved.user),
    migrationCompleted: resolved.user.legacyMigrationCompleted === true,
    sync: {
      lastSuccessfulAt: String(resolved.user.lastManualSyncAt || ""),
      migrationVersion: Math.max(0, Number(resolved.user.migrationVersion || (resolved.user.legacyMigrationCompleted ? 1 : 0))),
    },
  };
}

async function updateCloudProfile(openid, event) {
  const resolved = await resolveAccount(openid, true);
  const input = event && event.profile || {};
  const nickname = String(input.nickname || "").trim().slice(0, 16);
  if (!nickname) throw accountError("PROFILE_INVALID", "请输入展示名称。");
  const avatarUrl = String(input.avatarUrl || "").slice(0, 500);
  if (avatarUrl.startsWith("cloud://")) {
    await assertSafeAvatar(openid, avatarUrl, { expectedPath: `user-avatars/${resolved.userId}/` });
  } else if (avatarUrl && avatarUrl !== String(resolved.user.avatarUrl || "")) {
    throw accountError("PROFILE_INVALID", "头像来源无效，请重新选择。");
  }
  const data = {
    nickname,
    avatarUrl,
    profileSource: input.profileSource === "wechat" ? "wechat" : "custom",
    useProfileInTeam: input.useProfileInTeam !== false,
    profileUpdatedAt: new Date().toISOString(),
    updatedAt: db.serverDate(),
  };
  await db.collection("users").doc(resolved.userId).update({ data });
  return publicProfile({ ...resolved.user, ...data });
}

async function bindPhone(openid, event) {
  const code = String(event && event.code || "");
  if (!code) throw accountError("PHONE_CODE_INVALID", "手机号授权已失效，请重新授权。");
  const resolved = await resolveAccount(openid, true);
  const phoneConsentId = stableId("consent", `${resolved.userId}:phone_binding:${POLICY_VERSIONS.phone_binding}`);
  const phoneConsent = await db.collection("user_consents").doc(phoneConsentId).get().catch(() => null);
  if (!phoneConsent || !phoneConsent.data || phoneConsent.data.agreed !== true || phoneConsent.data.withdrawnAt) {
    throw accountError("PHONE_CONSENT_REQUIRED", "请先阅读并同意手机号绑定说明。");
  }
  const response = await cloud.openapi.phonenumber.getPhoneNumber({ code }).catch(() => null);
  const info = response && response.phoneInfo;
  const phone = String(info && (info.purePhoneNumber || info.phoneNumber) || "");
  if (!phone) throw accountError("PHONE_AUTH_FAILED", "未能获取手机号，请重新授权。");
  const bindingId = phoneBindingId(phone);
  const now = db.serverDate();
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.collection("account_bindings").doc(bindingId).get().catch(() => null);
    if (existing && existing.data && existing.data.userId !== resolved.userId) {
      throw accountError("PHONE_ALREADY_BOUND", "该手机号已绑定其他账号，暂不能自动合并。");
    }
    await transaction.collection("account_bindings").doc(bindingId).set({
      data: { userId: resolved.userId, provider: "phone", providerKeyHash: bindingId, createdAt: existing && existing.data ? existing.data.createdAt : now, updatedAt: now },
    });
    const previousId = resolved.user.phoneBindingId;
    if (previousId && previousId !== bindingId) {
      const previous = await transaction.collection("account_bindings").doc(previousId).get().catch(() => null);
      if (previous && previous.data && previous.data.userId === resolved.userId) await transaction.collection("account_bindings").doc(previousId).remove();
    }
    await transaction.collection("users").doc(resolved.userId).update({ data: { phoneMasked: maskPhone(phone), phoneBindingId: bindingId, updatedAt: now } });
  });
  return { ...publicAccount(resolved.userId, resolved.user), phoneBound: true, phoneMasked: maskPhone(phone) };
}

async function unbindPhone(openid) {
  const resolved = await resolveAccount(openid, true);
  const bindingId = String(resolved.user.phoneBindingId || "");
  if (!bindingId) return { ...publicAccount(resolved.userId, resolved.user), phoneBound: false, phoneMasked: "" };
  await db.runTransaction(async (transaction) => {
    const binding = await transaction.collection("account_bindings").doc(bindingId).get().catch(() => null);
    if (binding && binding.data && binding.data.userId === resolved.userId) {
      await transaction.collection("account_bindings").doc(bindingId).remove();
    }
    await transaction.collection("users").doc(resolved.userId).update({
      data: { phoneMasked: "", phoneBindingId: "", updatedAt: db.serverDate() },
    });
  });
  return { ...publicAccount(resolved.userId, resolved.user), phoneBound: false, phoneMasked: "" };
}

async function importLegacyProfile(openid, event) {
  const resolved = await resolveAccount(openid, true);
  if (resolved.user.legacyProfileMigrated === true) return { imported: false };
  const profile = event && event.profile;
  const data = { legacyProfileMigrated: true, updatedAt: db.serverDate() };
  if (profile && typeof profile === "object") {
    const nickname = String(profile.nickname || "").trim().slice(0, 16);
    if (nickname) data.nickname = nickname;
    const avatarUrl = String(profile.avatarUrl || "").slice(0, 500);
    if (avatarUrl.startsWith("cloud://")) {
      await assertSafeAvatar(openid, avatarUrl, { expectedPath: `user-avatars/${resolved.userId}/` });
      data.avatarUrl = avatarUrl;
    } else if (/^https:\/\/(thirdwx\.qlogo\.cn|wx\.qlogo\.cn)\//i.test(avatarUrl)) {
      data.avatarUrl = avatarUrl;
    } else {
      data.avatarUrl = "";
    }
    data.profileSource = profile.profileSource === "wechat" ? "wechat" : "custom";
    data.useProfileInTeam = profile.useProfileInTeam !== false;
  }
  await db.collection("users").doc(resolved.userId).update({ data });
  return { imported: Boolean(profile) };
}

const OWNED_COLLECTIONS = [
  "goals", "plans", "tasks", "checkins", "stage_reviews", "stage_previews", "plan_generation_requests",
  "stage_generation_requests", "goal_analysis_drafts", "stage_preview_versions", "progress_ai_snapshots",
  "manual_goals", "manual_tasks", "manual_checkins", "manual_archived_goals", "achievement_unlocks",
  "spark_checkins", "coach_action_proposals", "team_members", "team_user_memberships", "team_member_daily", "team_events", "team_join_requests",
  "user_consents", "subscription_ledger", "notification_preference", "notification_sent_log", "in_app_messages",
];

const BUSINESS_COLLECTIONS = [
  "goals", "plans", "tasks", "checkins", "stage_reviews", "stage_previews", "plan_generation_requests",
  "stage_generation_requests", "goal_analysis_drafts", "stage_preview_versions", "progress_ai_snapshots",
  "manual_goals", "manual_tasks", "manual_checkins", "manual_archived_goals", "achievement_unlocks",
  "spark_checkins", "coach_action_proposals", "subscription_ledger", "notification_preference", "notification_sent_log", "in_app_messages",
];

async function removeOwnedRecords(name, openid, userId) {
  const collection = db.collection(name);
  await collection.where({ _openid: openid }).remove();
  await collection.where({ userId }).remove();
}

async function countOwned(name, openid) {
  const result = await db.collection(name).where({ _openid: openid }).count();
  return Math.max(0, Number(result && result.total || 0));
}

async function getDataOverview(openid) {
  const resolved = await resolveAccount(openid, true);
  const [activeGoals, historicalGoals, actions, checkins, achievements] = await Promise.all([
    db.collection("manual_goals").where({ _openid: openid, status: "active" }).count().then((result) => Number(result.total || 0)),
    countOwned("manual_archived_goals", openid),
    countOwned("manual_tasks", openid),
    countOwned("manual_checkins", openid),
    countOwned("achievement_unlocks", openid),
  ]);
  return {
    accountStatus: resolved.user.status || "active",
    profileUpdatedAt: String(resolved.user.profileUpdatedAt || resolved.user.updatedAt || ""),
    lastSuccessfulAt: String(resolved.user.lastManualSyncAt || ""),
    migrationVersion: Math.max(0, Number(resolved.user.migrationVersion || 0)),
    counts: { activeGoals, historicalGoals, actions, checkins, achievements },
  };
}

async function completeOnboarding(openid) {
  const resolved = await resolveAccount(openid, true);
  await db.collection("users").doc(resolved.userId).update({
    data: { welcomeCompleted: true, updatedAt: db.serverDate() },
  });
  return { completed: true };
}

async function clearUserBusinessData(openid, event) {
  if (String(event && event.confirmation || "") !== "CLEAR_BUSINESS_DATA") {
    throw accountError("CONFIRMATION_REQUIRED", "请完成二次确认后再删除云端成长数据。");
  }
  const resolved = await resolveAccount(openid, true);
  for (const name of BUSINESS_COLLECTIONS) await removeOwnedRecords(name, openid, resolved.userId);
  await db.collection("encouragements").where({ senderUserId: resolved.userId }).remove();
  await db.collection("encouragements").where({ receiverUserId: resolved.userId }).remove();
  await db.collection("users").doc(resolved.userId).update({
    data: {
      lastManualSyncAt: new Date().toISOString(),
      updatedAt: db.serverDate(),
    },
  });
  return { cleared: true };
}

async function leaveTeamBeforeAccountDeletion(userId) {
  const membershipResult = await db.collection("team_members").where({ userId, status: "active" }).limit(1).get().catch(() => null);
  const membership = membershipResult && membershipResult.data && membershipResult.data[0];
  if (!membership) return;
  if (membership.role === "owner") {
    throw accountError("OWNER_TRANSFER_REQUIRED", "请先转让或解散你管理的小队，再注销账号。");
  }
  await db.runTransaction(async (transaction) => {
    const teamResult = await transaction.collection("teams").doc(membership.teamId).get().catch(() => null);
    const team = teamResult && teamResult.data;
    if (team && team.status === "active") {
      await transaction.collection("teams").doc(membership.teamId).update({
        data: {
          memberCount: Math.max(0, Number(team.memberCount || 1) - 1),
          version: db.command.inc(1),
          updatedAt: db.serverDate(),
        },
      });
    }
    await transaction.collection("team_members").doc(membership._id).update({
      data: { status: "left", leftAt: db.serverDate(), updatedAt: db.serverDate() },
    });
    const lockRef = transaction.collection("team_user_memberships").doc(stableId("team_user_membership", userId));
    const lock = await lockRef.get().catch(() => null);
    if (lock && lock.data) {
      await lockRef.update({
        data: { status: "left", updatedAt: db.serverDate() },
      });
    }
  });
}

async function deleteCloudAccount(openid, event) {
  if (String(event && event.confirmation || "") !== "DELETE") throw accountError("CONFIRMATION_REQUIRED", "请输入确认文字后再注销账号。");
  const operationId = stableId("account_operation", openid);
  const previousOperation = await db.collection("account_operations").doc(operationId).get().catch(() => null);
  const resolved = await resolveAccount(openid, false);
  const userId = resolved && resolved.userId || previousOperation && previousOperation.data && previousOperation.data.userId;
  if (!userId) return { deleted: true };
  const userResult = resolved ? { data: resolved.user } : await db.collection("users").doc(userId).get().catch(() => null);
  const user = userResult && userResult.data || {};
  await db.collection("account_operations").doc(operationId).set({
    data: { userId, operationType: "account_deletion", status: "running", requestedAt: previousOperation && previousOperation.data && previousOperation.data.requestedAt || db.serverDate(), updatedAt: db.serverDate() },
  });
  try {
    await leaveTeamBeforeAccountDeletion(userId);
    for (const name of OWNED_COLLECTIONS) await removeOwnedRecords(name, openid, userId);
    await db.collection("encouragements").where({ senderUserId: userId }).remove();
    await db.collection("encouragements").where({ receiverUserId: userId }).remove();
    if (String(user.avatarUrl || "").startsWith("cloud://")) {
      await cloud.deleteFile({ fileList: [String(user.avatarUrl)] });
    }
    await db.collection("account_bindings").where({ userId }).remove();
    await db.collection("users").doc(userId).remove();
    await db.collection("account_operations").doc(operationId).remove();
    return { deleted: true };
  } catch (error) {
    await db.collection("account_operations").doc(operationId).update({
      data: { status: "failed", errorCode: String(error && error.code || "DELETE_FAILED").slice(0, 80), updatedAt: db.serverDate() },
    }).catch(() => null);
    throw accountError(error && error.code || "ACCOUNT_DELETE_FAILED", error && error.message || "账号注销未完成，请稍后重试。");
  }
}

module.exports = {
  bindPhone,
  bootstrapAccount,
  clearUserBusinessData,
  completeOnboarding,
  deleteCloudAccount,
  getDataOverview,
  importLegacyProfile,
  resolveAccount,
  updateCloudProfile,
  unbindPhone,
};
