function isTrustedSchedulerSource(value) {
  const parts = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts[0] !== "wx_trigger") return false;
  return parts.slice(1).every((item) => item === "scf" || item === "wx_cloud_call");
}

module.exports = { isTrustedSchedulerSource };
