const cloud = require("wx-server-sdk");

const TEXT_CHUNK_LIMIT = 2000;
const IMAGE_SIZE_LIMIT = 2 * 1024 * 1024;
const CONTENT_FIELDS = new Set([
  "answer",
  "answers",
  "announcement",
  "content",
  "customGoalTitle",
  "description",
  "desiredResult",
  "feedback",
  "feedbackNote",
  "focusAdjustment",
  "goalTitle",
  "lastReviewSummary",
  "name",
  "nickname",
  "note",
  "question",
  "reflection",
  "reviewSummary",
  "skipReasonNote",
  "slogan",
  "summary",
  "tagName",
  "title",
  "todayActionTitle",
  "value",
]);

const ACTIONS_REQUIRING_TEXT_CHECK = new Set([
  "analyzeGoal",
  "adopt",
  "askProgressCoach",
  "createManualTask",
  "createStagePreview",
  "createTeam",
  "generate",
  "generateStagePlan",
  "importLegacyProfile",
  "regenerateStagePreview",
  "submitCheckin",
  "submitGoalClarification",
  "submitStageReview",
  "syncManualData",
  "updateCloudProfile",
  "updateStagePreviewTask",
  "updateTeamSettings",
]);

function contentSecurityError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function collectContentText(value, parentKey = "", output = [], seen = new Set()) {
  if (value === null || value === undefined) return output;
  if (typeof value === "string") {
    if (CONTENT_FIELDS.has(parentKey)) {
      const text = normalizeText(value);
      if (text) output.push(text);
    }
    return output;
  }
  if (typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectContentText(item, parentKey, output, seen);
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    collectContentText(item, key, output, seen);
  }
  return output;
}

function chunkTexts(values, limit = TEXT_CHUNK_LIMIT) {
  const chunks = [];
  let current = "";
  for (const raw of values) {
    let text = normalizeText(raw);
    while (text) {
      const separator = current ? "\n" : "";
      const remaining = limit - current.length - separator.length;
      if (remaining <= 0) {
        chunks.push(current);
        current = "";
        continue;
      }
      current += separator + text.slice(0, remaining);
      text = text.slice(remaining);
      if (current.length >= limit) {
        chunks.push(current);
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function responseSuggest(response) {
  return String(response && response.result && response.result.suggest || response && response.suggest || "").toLowerCase();
}

function responseErrorCode(response) {
  const raw = response && (response.errCode ?? response.errcode);
  return raw === undefined || raw === null ? 0 : Number(raw);
}

function isRiskyApiError(error) {
  const code = Number(error && (error.errCode ?? error.errcode ?? error.code));
  return code === 87014 || code === 87015;
}

// Classifies whether a `msgSecCheck` failure is transient (worth retrying) or
// permanent. Only network (-1) and server-side (5xxxx) errors are retryable.
// Content risk rejections (87014/87015), client errors (4xxxx), TypeError and
// any unknown error are not retried, so we never waste API quota.
function isTransientError(error) {
  const code = Number(error && (error.errCode ?? error.errcode ?? error.code));
  // 87014/87015 are explicit content risk rejections — never retry.
  if (code === 87014 || code === 87015) return false;
  // -1 is the generic network error used by wx-server-sdk — retry.
  if (code === -1) return true;
  // 4xxxx are client errors (params, permissions, quota) — do not retry.
  if (code >= 40000 && code < 50000) return false;
  // 5xxxx are server-side errors — retry.
  if (code >= 50000) return true;
  // TypeError (e.g. securityApi is undefined) — do not retry.
  if (error instanceof TypeError) return false;
  // Any other unknown error — conservatively do not retry.
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openidPrefix(openid) {
  return String(openid || "").slice(0, 8);
}

function underlyingErrorInfo(error) {
  if (!error) return null;
  return {
    errCode: error.errCode ?? error.errcode,
    errMsg: String(error.errMsg || error.message || "").slice(0, 200),
    errorType: error.constructor && error.constructor.name,
  };
}

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Calls `msgSecCheck` with retry and backoff for transient errors.
// Content risk rejections (87014/87015) and non-transient errors (TypeError,
// 4xxxx) are thrown immediately without retry. Only network (-1) and server-
// side (5xxxx) errors are retried. Logs a `warn` on each retry and an `error`
// when all retries are exhausted, so developers can diagnose root cause from
// cloud function logs.
async function callMsgSecCheck(securityApi, payload, config) {
  const { openid, scene, maxRetries, retryBaseDelayMs } = config;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await securityApi.msgSecCheck(payload);
    } catch (error) {
      lastError = error;
      // Content risk rejections are never retried.
      if (isRiskyApiError(error)) {
        throw contentSecurityError("CONTENT_SECURITY_REJECTED", "内容未通过安全检测，请修改后重试。", error);
      }
      // Non-transient errors are never retried.
      if (!isTransientError(error)) {
        throw contentSecurityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全检测暂不可用，请稍后重试。", error);
      }
      // Transient error: retry if attempts remain.
      if (attempt < maxRetries) {
        const retryNumber = attempt + 1;
        console.warn("content security check retrying", {
          openid: openidPrefix(openid),
          scene,
          errCode: error.errCode ?? error.errcode,
          retry: retryNumber,
        });
        await sleep(retryBaseDelayMs * retryNumber);
        continue;
      }
      // All retries exhausted — log the underlying cause for diagnosis.
      console.error("content security check unavailable", {
        openid: openidPrefix(openid),
        scene,
        cause: underlyingErrorInfo(error),
      });
      throw contentSecurityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全检测暂不可用，请稍后重试。", error);
    }
  }
  // Defensive fallback — should not be reached.
  throw contentSecurityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全检测暂不可用，请稍后重试。", lastError);
}

async function assertSafeText(openid, values, scene = 4, securityApi = cloud.openapi.security, options = {}) {
  // Retry and degradation config. Options take precedence over env vars,
  // which take precedence over built-in defaults.
  // Degradation (fail-open) is implemented in ticket 03; for now
  // degradeOnUnavailable is accepted but not yet acted upon.
  const degradeOnUnavailable = options.degradeOnUnavailable ?? false;
  const maxRetries = options.maxRetries ?? readEnvNumber("CONTENT_SECURITY_MAX_RETRIES", 2);
  const retryBaseDelayMs = options.retryBaseDelayMs ?? readEnvNumber("CONTENT_SECURITY_RETRY_BASE_DELAY_MS", 500);
  void degradeOnUnavailable;
  const unique = [...new Set((values || []).map(normalizeText).filter(Boolean))];
  for (const content of chunkTexts(unique)) {
    const response = await callMsgSecCheck(
      securityApi,
      { content, version: 2, scene, openid },
      { openid, scene, maxRetries, retryBaseDelayMs },
    );
    const suggest = responseSuggest(response);
    if (responseErrorCode(response) !== 0 || (suggest && suggest !== "pass")) {
      throw contentSecurityError("CONTENT_SECURITY_REJECTED", "内容未通过安全检测，请修改后重试。");
    }
    if (!suggest && !(response && (response.errCode === 0 || response.errcode === 0))) {
      throw contentSecurityError("CONTENT_SECURITY_UNAVAILABLE", "内容安全检测暂不可用，请稍后重试。");
    }
  }
}

function imageContentType(fileId) {
  const normalized = String(fileId || "").toLowerCase().split("?")[0];
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

function imageBufferContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return "";
}

async function assertSafeAvatar(openid, fileId, dependencies = {}) {
  const normalizedFileId = String(fileId || "").trim();
  const expectedPath = String(dependencies.expectedPath || "").replace(/^\/+/, "");
  if (!normalizedFileId || !normalizedFileId.startsWith("cloud://")) {
    if (expectedPath) {
      throw contentSecurityError("CONTENT_SECURITY_REJECTED", "头像文件来源无效，请重新选择。");
    }
    return;
  }
  const storagePath = normalizedFileId.replace(/^cloud:\/\/[^/]+\//, "");
  if (expectedPath && !storagePath.startsWith(expectedPath)) {
    throw contentSecurityError("CONTENT_SECURITY_REJECTED", "头像文件归属无效，请重新选择。");
  }
  const declaredContentType = imageContentType(normalizedFileId);
  if (!declaredContentType) {
    throw contentSecurityError("CONTENT_SECURITY_REJECTED", "头像仅支持 JPG 或 PNG 图片。");
  }
  const downloadFile = dependencies.downloadFile || cloud.downloadFile.bind(cloud);
  const securityApi = dependencies.securityApi || cloud.openapi.security;
  let buffer;
  try {
    const downloaded = await downloadFile({ fileID: normalizedFileId });
    buffer = downloaded && downloaded.fileContent;
  } catch (error) {
    throw contentSecurityError("CONTENT_SECURITY_UNAVAILABLE", "头像安全检测暂不可用，请稍后重试。", error);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > IMAGE_SIZE_LIMIT) {
    throw contentSecurityError("CONTENT_SECURITY_REJECTED", "头像图片无效或超过 2MB，请重新选择。");
  }
  const contentType = imageBufferContentType(buffer);
  if (!contentType || contentType !== declaredContentType) {
    throw contentSecurityError("CONTENT_SECURITY_REJECTED", "头像文件类型与内容不一致，请重新选择。");
  }
  try {
    const response = await securityApi.imgSecCheck({ media: { contentType, value: buffer } });
    if (responseErrorCode(response) !== 0 || (responseSuggest(response) && responseSuggest(response) !== "pass")) {
      throw contentSecurityError("CONTENT_SECURITY_REJECTED", "头像未通过安全检测，请重新选择。");
    }
  } catch (error) {
    if (error && error.code === "CONTENT_SECURITY_REJECTED") throw error;
    if (isRiskyApiError(error)) {
      throw contentSecurityError("CONTENT_SECURITY_REJECTED", "头像未通过安全检测，请重新选择。", error);
    }
    throw contentSecurityError("CONTENT_SECURITY_UNAVAILABLE", "头像安全检测暂不可用，请稍后重试。", error);
  }
  void openid;
}

async function assertEventContentSafe(openid, action, event) {
  if (!ACTIONS_REQUIRING_TEXT_CHECK.has(action)) return;
  const texts = collectContentText(event);
  const scene = action === "updateCloudProfile" || action === "importLegacyProfile" ? 1 : 4;
  await assertSafeText(openid, texts, scene);
}

module.exports = {
  ACTIONS_REQUIRING_TEXT_CHECK,
  IMAGE_SIZE_LIMIT,
  assertEventContentSafe,
  assertSafeAvatar,
  assertSafeText,
  chunkTexts,
  collectContentText,
  imageContentType,
  imageBufferContentType,
  isTransientError,
  responseErrorCode,
  responseSuggest,
};
