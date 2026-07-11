const crypto = require("crypto");

const ENCOURAGEMENT_TYPES = [
  "keep_going",
  "very_stable",
  "continue_tomorrow",
  "stay_together",
];
const MAX_TEAM_MEMBERS = 50;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const TEAM_ROLES = ["owner", "member"];

function stablePublicId(prefix, value) {
  return `${prefix}_${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 24)}`;
}

function publicMemberId(teamId, userKey) {
  return stablePublicId("member", `${teamId}:${userKey}`);
}

function isValidEncouragementType(value) {
  return ENCOURAGEMENT_TYPES.includes(value);
}

function compareRank(left, right) {
  const progress = Number(right.completionRate || 0) - Number(left.completionRate || 0);
  if (progress) return progress;
  const minutes = Number(right.growthMinutes || 0) - Number(left.growthMinutes || 0);
  if (minutes) return minutes;
  const leftCompleted = left.completedAt ? Date.parse(left.completedAt) : Number.MAX_SAFE_INTEGER;
  const rightCompleted = right.completedAt ? Date.parse(right.completedAt) : Number.MAX_SAFE_INTEGER;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  return String(left.id).localeCompare(String(right.id));
}

function normalizeRoomCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return ROOM_CODE_PATTERN.test(code) ? code : "";
}

module.exports = {
  ENCOURAGEMENT_TYPES,
  MAX_TEAM_MEMBERS,
  ROOM_CODE_PATTERN,
  TEAM_ROLES,
  compareRank,
  isValidEncouragementType,
  normalizeRoomCode,
  publicMemberId,
};
