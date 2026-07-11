const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { stableId } = require("./repository");

const db = cloud.database();

function accountError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const wechatBindingId = (openid) => stableId("binding", `wechat:${openid}`);
const phoneBindingId = (phone) => stableId("binding", `phone:${phone}`);
const maskPhone = (phone) => String(phone || "").replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");

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
      data: { userId, provider: "wechat", providerKey: openid, createdAt: now, updatedAt: now },
    });
  });
  const found = await db.collection("users").doc(userId).get();
  return { userId, user: found.data };
}

function publicAccount(userId, user) {
  return { userId, status: user.status || "active", phoneBound: Boolean(user.phoneMasked), phoneMasked: String(user.phoneMasked || "") };
}

async function bootstrapAccount(openid) {
  const resolved = await resolveAccount(openid, true);
  return {
    account: publicAccount(resolved.userId, resolved.user),
    profile: publicProfile(resolved.user),
    migrationCompleted: resolved.user.legacyMigrationCompleted === true,
  };
}

async function updateCloudProfile(openid, event) {
  const resolved = await resolveAccount(openid, true);
  const input = event && event.profile || {};
  const nickname = String(input.nickname || "").trim().slice(0, 16);
  if (!nickname) throw accountError("PROFILE_INVALID", "请输入展示名称。");
  const data = {
    nickname,
    avatarUrl: String(input.avatarUrl || "").slice(0, 500),
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
  const response = await cloud.openapi.phonenumber.getPhoneNumber({ code }).catch(() => null);
  const info = response && response.phoneInfo;
  const phone = String(info && (info.purePhoneNumber || info.phoneNumber) || "");
  if (!phone) throw accountError("PHONE_AUTH_FAILED", "未能获取手机号，请重新授权。");
  const resolved = await resolveAccount(openid, true);
  const bindingId = phoneBindingId(phone);
  const now = db.serverDate();
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.collection("account_bindings").doc(bindingId).get().catch(() => null);
    if (existing && existing.data && existing.data.userId !== resolved.userId) {
      throw accountError("PHONE_ALREADY_BOUND", "该手机号已绑定其他账号，暂不能自动合并。");
    }
    await transaction.collection("account_bindings").doc(bindingId).set({
      data: { userId: resolved.userId, provider: "phone", providerKey: phone, createdAt: existing && existing.data ? existing.data.createdAt : now, updatedAt: now },
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

async function importLegacyProfile(openid, event) {
  const resolved = await resolveAccount(openid, true);
  if (resolved.user.legacyProfileMigrated === true) return { imported: false };
  const profile = event && event.profile;
  const data = { legacyProfileMigrated: true, updatedAt: db.serverDate() };
  if (profile && typeof profile === "object") {
    const nickname = String(profile.nickname || "").trim().slice(0, 16);
    if (nickname) data.nickname = nickname;
    data.avatarUrl = String(profile.avatarUrl || "").slice(0, 500);
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
  "spark_checkins", "coach_action_proposals", "team_members", "team_events", "team_join_requests",
];

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
  });
}

async function deleteCloudAccount(openid, event) {
  if (String(event && event.confirmation || "") !== "DELETE") throw accountError("CONFIRMATION_REQUIRED", "请输入确认文字后再注销账号。");
  const resolved = await resolveAccount(openid, false);
  if (!resolved) return { deleted: true };
  await leaveTeamBeforeAccountDeletion(resolved.userId);
  for (const name of OWNED_COLLECTIONS) {
    const collection = db.collection(name);
    await collection.where({ _openid: openid }).remove().catch(() => null);
    await collection.where({ userId: resolved.userId }).remove().catch(() => null);
  }
  await db.collection("encouragements").where({ senderUserId: resolved.userId }).remove().catch(() => null);
  await db.collection("encouragements").where({ receiverUserId: resolved.userId }).remove().catch(() => null);
  await db.collection("account_bindings").where({ userId: resolved.userId }).remove().catch(() => null);
  await db.collection("users").doc(resolved.userId).remove().catch(() => null);
  return { deleted: true };
}

module.exports = { bindPhone, bootstrapAccount, deleteCloudAccount, importLegacyProfile, resolveAccount, updateCloudProfile };
