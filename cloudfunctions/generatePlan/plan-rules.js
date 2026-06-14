function getDayStatus(planStatus, date, businessDate, completedCount, totalCount) {
  if (totalCount > 0 && completedCount === totalCount) return "completed";
  if (planStatus === "paused") return "paused";
  if (date === businessDate) return "today";
  if (date > businessDate) return "future";
  if (totalCount === 0) return "completed";
  if (completedCount > 0) return "partial";
  return "missed";
}

function getTaskState(planStatus, task, businessDate) {
  if (task.status === "completed") return "completed";
  if (planStatus === "paused") return "paused";
  if (task.taskDate < businessDate) return "expired";
  if (task.postponed) return "postponed";
  return "pending";
}

module.exports = {
  getDayStatus,
  getTaskState,
};
