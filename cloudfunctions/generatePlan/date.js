const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, "0");
}

function getShanghaiParts(date = new Date()) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatBusinessDate(date = new Date()) {
  const parts = getShanghaiParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function addBusinessDays(dateValue, days) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function businessDateDiff(from, to) {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toTime - fromTime) / (24 * 60 * 60 * 1000));
}

module.exports = {
  addBusinessDays,
  businessDateDiff,
  formatBusinessDate,
};
