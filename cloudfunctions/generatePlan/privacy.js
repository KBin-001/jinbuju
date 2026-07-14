const cloud = require("wx-server-sdk");
const { resolveAccount } = require("./account");
const { POLICY_TYPES, POLICY_VERSIONS } = require("./legal-constants");
const { stableId } = require("./repository");

const db = cloud.database();

function privacyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeTypes(event) {
  const values = Array.isArray(event && event.types) ? event.types : [event && event.type];
  const types = Array.from(new Set(values.map((value) => String(value || ""))));
  if (!types.length || types.some((type) => !POLICY_TYPES.includes(type))) {
    throw privacyError("CONSENT_INVALID", "协议类型无效。");
  }
  return types;
}

function consentId(userId, type, version) {
  return stableId("consent", `${userId}:${type}:${version}`);
}

async function getConsentStatus(openid) {
  const resolved = await resolveAccount(openid, true);
  const result = await db.collection("user_consents").where({ userId: resolved.userId }).limit(100).get();
  const records = result.data || [];
  const consents = {};
  for (const type of POLICY_TYPES) {
    const version = POLICY_VERSIONS[type];
    const record = records.find((item) => item.type === type && item.version === version);
    consents[type] = {
      type,
      version,
      agreed: Boolean(record && record.agreed && !record.withdrawnAt),
      agreedAt: String(record && record.agreedAt || ""),
      withdrawnAt: String(record && record.withdrawnAt || ""),
    };
  }
  return { versions: POLICY_VERSIONS, consents };
}

async function recordConsent(openid, event) {
  const resolved = await resolveAccount(openid, true);
  const types = normalizeTypes(event);
  const source = ["welcome", "settings", "phone_bind"].includes(String(event && event.source || ""))
    ? String(event.source)
    : "settings";
  const now = db.serverDate();
  await db.runTransaction(async (transaction) => {
    for (const type of types) {
      const version = POLICY_VERSIONS[type];
      const id = consentId(resolved.userId, type, version);
      const found = await transaction.collection("user_consents").doc(id).get().catch(() => null);
      await transaction.collection("user_consents").doc(id).set({
        data: {
          userId: resolved.userId,
          type,
          version,
          contentHash: stableId("policy", `${type}:${version}`),
          agreed: true,
          agreedAt: now,
          withdrawnAt: "",
          source,
          platform: "wechat_miniprogram",
          createdAt: found && found.data ? found.data.createdAt : now,
          updatedAt: now,
        },
      });
    }
  });
  return getConsentStatus(openid);
}

async function withdrawConsent(openid, event) {
  const resolved = await resolveAccount(openid, true);
  const type = String(event && event.type || "");
  if (!POLICY_TYPES.includes(type)) throw privacyError("CONSENT_INVALID", "协议类型无效。");
  const version = POLICY_VERSIONS[type];
  const id = consentId(resolved.userId, type, version);
  const found = await db.collection("user_consents").doc(id).get().catch(() => null);
  if (!found || !found.data) return getConsentStatus(openid);
  await db.collection("user_consents").doc(id).update({
    data: { agreed: false, withdrawnAt: db.serverDate(), updatedAt: db.serverDate() },
  });
  return getConsentStatus(openid);
}

module.exports = { getConsentStatus, recordConsent, withdrawConsent };
