const crypto = require("crypto");

const ENCOURAGEMENT_TYPES = [
  "keep_going",
  "very_stable",
  "continue_tomorrow",
  "stay_together",
];

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

module.exports = {
  ENCOURAGEMENT_TYPES,
  isValidEncouragementType,
  publicMemberId,
};
