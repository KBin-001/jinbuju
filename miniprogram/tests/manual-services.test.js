const assert = require("node:assert/strict");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, filename);
};

const storage = new Map();
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
};

const {
  createGoal,
  endGoal,
  getActiveGoal,
  getActiveGoals,
  getArchivedGoals,
  getRecentlyDeletedGoals,
  purgeArchivedGoal,
  restoreArchivedGoal,
  setCurrentGoal,
  softDeleteArchivedGoal,
} = require("../services/manualGoal.ts");
const { readManualStore, writeManualStore } = require("../services/manualStore.ts");
const { createTask, deleteTask, getTask, getTaskHistoryByGoal, getTasksByDate, getTodayPageTasks, rescheduleTask, updateActionRecord, updateTaskStatus } = require("../services/manualTask.ts");
const { getProgressSummary, recordDailyCheckin } = require("../services/manualStats.ts");
const { addBusinessDays, getTodayBusinessDate } = require("../utils/date.ts");
const { getDailyCoachAnalysis } = require("../services/dailyCoach.ts");
const { abandonActionSession, completeActionSession, finishActionSession, getActionSession, getActiveActionSession, pauseActionSession, resumeActionSession, startActionSession } = require("../services/actionSession.ts");

const today = "2026-06-21";
const blogGoal = createGoal({ title: "完成个人博客", category: "custom" });
const cetGoal = createGoal({ title: "通过英语四六级", category: "cet" });

assert.equal(getActiveGoals().length, 2);
assert.equal(getActiveGoal().id, cetGoal.id);
assert.equal(setCurrentGoal(blogGoal.id).id, blogGoal.id);
assert.equal(getActiveGoal().id, blogGoal.id);
assert.equal(storage.has("JINBUJU_MANUAL_SNAPSHOT_V1"), true);

assert.throws(() => createTask({ goalId: blogGoal.id, title: "", currentDate: today, estimatedMinutes: 30 }));
assert.throws(() => createTask({ goalId: blogGoal.id, title: "无效时间", currentDate: today, estimatedMinutes: 4 }));

const completed = createTask({ goalId: blogGoal.id, title: "完成首页布局", currentDate: today, estimatedMinutes: 30 });
const partial = createTask({ goalId: blogGoal.id, title: "写一篇项目文章", currentDate: today, estimatedMinutes: 45 });
const pending = createTask({ goalId: blogGoal.id, title: "检查移动端适配", currentDate: today, estimatedMinutes: 20 });
createTask({ goalId: cetGoal.id, title: "背30个单词", currentDate: today, estimatedMinutes: 30 });

updateTaskStatus(completed.id, "completed", 35);
updateActionRecord({
  taskId: completed.id,
  title: "完成首页布局",
  businessDate: today,
  time: "20:15",
  actualMinutes: 35,
  status: "completed",
  reflection: "布局拆小后更容易推进",
});
assert.equal(getTask(completed.id).reflection, "布局拆小后更容易推进");
assert.equal(new Date(getTask(completed.id).completedAt).getHours(), 20);
updateTaskStatus(partial.id, "partially_completed", 20, "not_enough_time");
updateActionRecord({ taskId: partial.id, title: partial.title, businessDate: today, time: "20:30", actualMinutes: 20, status: "partially_completed", reflection: "资料准备不足，明天先列参考来源" });
assert.throws(() => updateTaskStatus(pending.id, "completed", 481));
const successor = rescheduleTask(pending.id, today);
assert.equal(successor.currentDate, "2026-06-22");
assert.equal(successor.originTaskId, pending.id);
assert.equal(rescheduleTask(pending.id, today).id, successor.id);

assert.equal(getTasksByDate(blogGoal.id, today).length, 2);
assert.equal(getTasksByDate(blogGoal.id, "2026-06-22").length, 1);
assert.equal(getTodayPageTasks(blogGoal.id, today).length, 2);
assert.equal(getTodayPageTasks(blogGoal.id, "2026-06-22").length, 2);
const firstCheckin = recordDailyCheckin(blogGoal.id, today);
const repeatedCheckin = recordDailyCheckin(blogGoal.id, today);
assert.equal(firstCheckin.id, repeatedCheckin.id);

const summary = getProgressSummary(blogGoal.id, today);
assert.equal(summary.totalTasks, 3);
assert.equal(summary.completedTasks, 1);
assert.equal(summary.totalActualMinutes, 55);
assert.equal(summary.totalActionDays, 1);
assert.equal(summary.todayCompleted, 1);
assert.equal(summary.todayTotal, 2);
assert.equal(summary.longestStreakDays, 1);

const deleted = createTask({ goalId: cetGoal.id, title: "临时行动", currentDate: today, estimatedMinutes: 30 });
deleteTask(deleted.id);
assert.equal(getTask(deleted.id), null);
assert.equal(getTasksByDate(cetGoal.id, today).some((task) => task.id === deleted.id), false);
const carriedPartial = createTask({ goalId: cetGoal.id, title: "完成一部分", currentDate: today, estimatedMinutes: 30 });
updateTaskStatus(carriedPartial.id, "partially_completed", 15, "not_enough_time");
rescheduleTask(carriedPartial.id, today);
assert.equal(getProgressSummary(cetGoal.id, today).totalActualMinutes, 15);
const cetHistory = getTaskHistoryByGoal(cetGoal.id);
assert.equal(cetHistory.some((task) => task.id === carriedPartial.id && task.status === "rescheduled" && task.actualMinutes === 15), true);
assert.equal(cetHistory.some((task) => task.id === deleted.id), false);

// 回归：顺延后继任务在第二天完成时，任务、默认实际投入和每日打卡快照都必须保留。
const realToday = getTodayBusinessDate();
const carryOriginDate = addBusinessDays(realToday, -1);
const carryOrigin = createTask({ goalId: cetGoal.id, title: "顺延后完成的行动", currentDate: carryOriginDate, estimatedMinutes: 40 });
const carrySuccessor = rescheduleTask(carryOrigin.id, carryOriginDate);
assert.equal(carrySuccessor.currentDate, realToday);
const completedCarry = updateTaskStatus(carrySuccessor.id, "completed");
assert.equal(completedCarry.actualMinutes, 40);
assert.equal(completedCarry.activityDate, realToday);
const carryCheckin = recordDailyCheckin(cetGoal.id, realToday);
assert.equal(carryCheckin.completedCount >= 1, true);
assert.equal(carryCheckin.actualMinutes >= 40, true);
assert.equal(getTask(carryOrigin.id).status, "rescheduled");
assert.equal(getTask(carrySuccessor.id).status, "completed");
const overdueForCoach = createTask({ goalId: cetGoal.id, title: "AI 应识别的待继续任务", currentDate: carryOriginDate, estimatedMinutes: 25 });
const dailyCoach = getDailyCoachAnalysis(realToday, cetGoal.id);
assert.equal(dailyCoach.pendingTasks.some((task) => task.id === overdueForCoach.id), true);
assert.equal(dailyCoach.totalCount >= 2, true);

const archivedGoal = endGoal(blogGoal.id);
assert.equal(archivedGoal.id, blogGoal.id);
assert.equal(archivedGoal.actions.length, 4);
assert.equal(archivedGoal.stats.completedActions, 1);
assert.equal(archivedGoal.stats.actualMinutes, 55);
assert.equal(archivedGoal.stats.completionRate, 33);
assert.equal(archivedGoal.actions.find((task) => task.id === completed.id).reflection, "布局拆小后更容易推进");
assert.equal(getActiveGoals().length, 1);
assert.equal(getActiveGoal().id, cetGoal.id);
assert.equal(getArchivedGoals()[0].id, blogGoal.id);

softDeleteArchivedGoal(blogGoal.id);
assert.equal(getArchivedGoals().some((goal) => goal.id === blogGoal.id), false);
assert.equal(getRecentlyDeletedGoals()[0].id, blogGoal.id);
const restoredGoal = restoreArchivedGoal(blogGoal.id);
assert.equal(restoredGoal.status, "active");
assert.equal(getRecentlyDeletedGoals().length, 0);

endGoal(cetGoal.id);
softDeleteArchivedGoal(cetGoal.id);
purgeArchivedGoal(cetGoal.id);
assert.equal(getRecentlyDeletedGoals().some((goal) => goal.id === cetGoal.id), false);
const purgedSnapshot = readManualStore().archivedGoals.find((goal) => goal.id === cetGoal.id);
assert.equal(Boolean(purgedSnapshot.purgedAt), true);
assert.equal(purgedSnapshot.actions.length, 0);

const metricGoal = createGoal({ title: "统计口径验证", category: "custom" });
const metricTasks = [
  { date: "2026-06-20", minutes: 5 },
  { date: "2026-06-20", minutes: 5 },
  { date: today, minutes: 5 },
  { date: today, minutes: 5 },
  { date: today, minutes: 10 },
].map((item, index) => createTask({
  goalId: metricGoal.id,
  title: `统计行动${index + 1}`,
  currentDate: item.date,
  estimatedMinutes: 30,
}));
metricTasks.forEach((task, index) => updateActionRecord({
  taskId: task.id,
  title: task.title,
  businessDate: index < 2 ? "2026-06-20" : today,
  time: "18:00",
  actualMinutes: [5, 5, 5, 5, 10][index],
  status: "completed",
}));
const metricSummary = getProgressSummary(metricGoal.id, today);
assert.equal(metricSummary.totalActionDays, 2);
assert.equal(metricSummary.completedTasks, 5);
assert.equal(metricSummary.totalActualMinutes, 30);
assert.equal(metricSummary.currentStreakDays, 2);
assert.equal(metricSummary.longestStreakDays, 2);

const durationGoal = createGoal({ title: "完成时长默认逻辑", category: "custom" });
const estimatedDurationCompletion = createTask({ goalId: durationGoal.id, title: "按预计时长完成", currentDate: today, estimatedMinutes: 40 });
updateTaskStatus(estimatedDurationCompletion.id, "completed");
assert.equal(getTask(estimatedDurationCompletion.id).actualMinutes, 40);

const recordedDurationCompletion = createTask({ goalId: durationGoal.id, title: "保留已记录时长", currentDate: today, estimatedMinutes: 45 });
updateTaskStatus(recordedDurationCompletion.id, "partially_completed", 18, "not_enough_time");
updateTaskStatus(recordedDurationCompletion.id, "completed");
assert.equal(getTask(recordedDurationCompletion.id).actualMinutes, 18);

const explicitDurationCompletion = createTask({ goalId: durationGoal.id, title: "使用明确实际时长", currentDate: today, estimatedMinutes: 30 });
updateTaskStatus(explicitDurationCompletion.id, "completed", 25);
assert.equal(getTask(explicitDurationCompletion.id).actualMinutes, 25);
assert.throws(() => updateTaskStatus(explicitDurationCompletion.id, "completed", 0));

const sessionGoal = createGoal({
  title: "完成行动计时闭环",
  category: "custom",
  targetDate: "2026-07-31",
  milestones: [{ id: "milestone_timer", title: "完成首轮验证", status: "pending" }],
  onboardingCompletedAt: "2026-06-21T00:00:00.000Z",
});
const timedTask = createTask({ goalId: sessionGoal.id, title: "专注实现计时功能", currentDate: today, estimatedMinutes: 45 });
const sessionStart = new Date("2026-06-21T10:00:00+08:00");
const session = startActionSession(timedTask.id, "countdown", sessionStart);
assert.equal(session.targetSeconds, 2700);
assert.equal(getActiveActionSession(new Date("2026-06-21T10:01:30+08:00")).elapsedSeconds, 90);
const pausedSession = pauseActionSession(session.id, new Date("2026-06-21T10:01:30+08:00"));
assert.equal(pausedSession.status, "paused");
assert.equal(pausedSession.elapsedSeconds, 90);
resumeActionSession(session.id, new Date("2026-06-21T10:03:00+08:00"));
completeActionSession(session.id, 3, "比预计更快进入状态", false, new Date("2026-06-21T10:04:00+08:00"));
assert.equal(getActionSession(session.id).status, "completed");
assert.equal(getTask(timedTask.id).status, "completed");
assert.equal(getTask(timedTask.id).actualMinutes, 3);
assert.equal(getTask(timedTask.id).reflection, "比预计更快进入状态");
completeActionSession(session.id, 3, "重复提交不会重复结算", false, new Date("2026-06-21T10:05:00+08:00"));
assert.equal(getTask(timedTask.id).reflection, "比预计更快进入状态");

const abandonedTask = createTask({ goalId: sessionGoal.id, title: "记录部分投入", currentDate: today, estimatedMinutes: 30 });
const abandonedSession = startActionSession(abandonedTask.id, "stopwatch", new Date("2026-06-21T11:00:00+08:00"));
abandonActionSession(abandonedSession.id, true, new Date("2026-06-21T11:02:00+08:00"));
assert.equal(getActionSession(abandonedSession.id).status, "abandoned");
assert.equal(getTask(abandonedTask.id).status, "partially_completed");
assert.equal(getTask(abandonedTask.id).actualMinutes, 2);

const lightweightTimerTask = createTask({ goalId: sessionGoal.id, title: "验证首页轻量计时", currentDate: today, estimatedMinutes: 30 });
const firstLightweightSession = startActionSession(lightweightTimerTask.id, "countdown", new Date("2026-06-21T12:00:00+08:00"));
finishActionSession(firstLightweightSession.id, false, new Date("2026-06-21T12:02:00+08:00"));
assert.equal(getTask(lightweightTimerTask.id).status, "partially_completed");
assert.equal(getTask(lightweightTimerTask.id).actualMinutes, 2);
assert.equal(getActiveActionSession(), null);
const secondLightweightSession = startActionSession(lightweightTimerTask.id, "countdown", new Date("2026-06-21T12:10:00+08:00"));
finishActionSession(secondLightweightSession.id, true, new Date("2026-06-21T12:13:00+08:00"));
assert.equal(getTask(lightweightTimerTask.id).status, "completed");
assert.equal(getTask(lightweightTimerTask.id).actualMinutes, 5);
finishActionSession(secondLightweightSession.id, true, new Date("2026-06-21T12:14:00+08:00"));
assert.equal(getTask(lightweightTimerTask.id).actualMinutes, 5, "重复结束不得重复累计投入");

const legacyDurationCompletion = createTask({ goalId: durationGoal.id, title: "兼容历史零时长", currentDate: today, estimatedMinutes: 60 });
const legacyStore = readManualStore();
const legacyTask = legacyStore.tasks.find((task) => task.id === legacyDurationCompletion.id);
legacyTask.status = "completed";
legacyTask.actualMinutes = 0;
writeManualStore(legacyStore);
assert.equal(getTask(legacyDurationCompletion.id).actualMinutes, 60);

console.log("manual service tests passed");
