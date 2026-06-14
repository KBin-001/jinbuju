const CATEGORIES = ["exam", "skill", "career"];
const LEVELS = ["zero", "basic", "intermediate", "experienced", "improve"];
const INTENSITIES = ["light", "normal", "intensive"];
const DAILY_MINUTES = [15, 30, 45, 60, 90, 120];
const DANGEROUS_CONTENT = /<\s*\/?\s*(script|iframe|object|embed|style)|javascript:|on\w+\s*=/i;

module.exports = {
  CATEGORIES,
  LEVELS,
  INTENSITIES,
  DAILY_MINUTES,
  DANGEROUS_CONTENT,
};
