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
const { abandonActionSession, completeActionSession, finishActionSession, getActionSession, getActiveActionSession, getActiveActionSessionContext, pauseActionSession, resumeActionSession, startActionSession } = require("../services/actionSession.ts");

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

// === 活跃会话上下文解析器 getActiveActionSessionContext（规格 01）===
// 服务层把「活跃会话 + 其任务」的解析下沉为单一职责：不经过目标作用域过滤，
// 顺延/跨目标任务仍能锚定，孤儿会话可识别，且不依赖「选中日期」。

// 5. 无活跃会话时返回 null
assert.equal(getActiveActionSessionContext(), null, "无活跃会话时应返回 null");

const contextGoal = createGoal({ title: "会话上下文解析", category: "custom" });
const contextOtherGoal = createGoal({ title: "跨目标验证", category: "custom" });

// 1 & 2. 正常：活跃会话及其任务均存在，按 taskId 直接解析，已耗时物化
const ctxNormalTask = createTask({ goalId: contextGoal.id, title: "解析正常会话", currentDate: today, estimatedMinutes: 30 });
const ctxNormalSession = startActionSession(ctxNormalTask.id, "countdown", new Date("2026-06-21T13:00:00+08:00"));
const normalContext = getActiveActionSessionContext(new Date("2026-06-21T13:00:30+08:00"));
assert.equal(normalContext !== null, true, "活跃会话存在时应返回上下文");
assert.equal(normalContext.session.id, ctxNormalSession.id, "上下文会话应为当前全局活跃会话");
assert.equal(normalContext.task.id, ctxNormalTask.id, "上下文任务应按会话 taskId 直接解析");
assert.equal(normalContext.task.goalId, contextGoal.id, "任务应携带原始 goalId，不经过目标过滤");
assert.equal(normalContext.session.elapsedSeconds, 30, "上下文会话应已物化已耗时");

// 6. 全局单活跃会话不变式：已有 running 会话时，对其他任务调用 startActionSession 抛错
const ctxOtherTask = createTask({ goalId: contextGoal.id, title: "另一项行动", currentDate: today, estimatedMinutes: 30 });
assert.throws(() => startActionSession(ctxOtherTask.id, "countdown", new Date("2026-06-21T13:00:35+08:00")), /已有一项行动正在进行/, "已有活跃会话时对其他任务开始应抛错");
// 同一任务重复开始应返回同一会话（幂等，不变式允许继续当前计时）
assert.equal(startActionSession(ctxNormalTask.id, "countdown", new Date("2026-06-21T13:00:36+08:00")).id, ctxNormalSession.id, "同一任务重复开始应返回原会话");

// 3. 顺延：会话关联的任务被顺延后，上下文仍返回该任务（不丢失）
finishActionSession(ctxNormalSession.id, false, new Date("2026-06-21T13:02:00+08:00"));
const ctxRolloverTask = createTask({ goalId: contextGoal.id, title: "将被顺延的计时任务", currentDate: today, estimatedMinutes: 45 });
const ctxRolloverSession = startActionSession(ctxRolloverTask.id, "countdown", new Date("2026-06-21T14:00:00+08:00"));
rescheduleTask(ctxRolloverTask.id, today);
assert.equal(getTask(ctxRolloverTask.id).status, "rescheduled", "顺延后原任务状态应为 rescheduled");
const rolloverContext = getActiveActionSessionContext(new Date("2026-06-21T14:00:10+08:00"));
assert.equal(rolloverContext.task.id, ctxRolloverTask.id, "任务被顺延后上下文仍应返回该任务");
assert.equal(rolloverContext.task.status, "rescheduled", "上下文返回的应是顺延后的原任务");

// 7. 顺延任务的会话经 finishActionSession 结束后，任务进入 partially_completed/completed，投入正确累计
finishActionSession(ctxRolloverSession.id, false, new Date("2026-06-21T14:01:00+08:00"));
const rolloverFinished = getTask(ctxRolloverTask.id);
assert.equal(rolloverFinished.status, "partially_completed", "仅结束计时应保留为完成一部分");
assert.equal(rolloverFinished.actualMinutes, 1, "投入应按会话已耗时取整累计（1 分钟）");

// 3.b 跨目标：会话关联的任务属于非当前激活目标时，上下文仍返回会话 + 该任务
const ctxCrossTask = createTask({ goalId: contextOtherGoal.id, title: "跨目标计时任务", currentDate: today, estimatedMinutes: 30 });
const ctxCrossSession = startActionSession(ctxCrossTask.id, "countdown", new Date("2026-06-21T15:00:00+08:00"));
// 把激活目标切到 contextGoal，使会话任务处于「非当前激活目标」
assert.equal(setCurrentGoal(contextGoal.id).id, contextGoal.id, "切换激活目标到 contextGoal");
const crossContext = getActiveActionSessionContext(new Date("2026-06-21T15:00:20+08:00"));
assert.equal(crossContext.task.id, ctxCrossTask.id, "跨目标任务仍应被上下文返回");
assert.equal(crossContext.task.goalId, contextOtherGoal.id, "任务应保留原 goalId，不被激活目标过滤");
// 切回以便后续清理
setCurrentGoal(contextOtherGoal.id);
finishActionSession(ctxCrossSession.id, true, new Date("2026-06-21T15:01:00+08:00"));
assert.equal(getTask(ctxCrossTask.id).status, "completed", "标记完成后跨目标任务应进入 completed");

// 4. 孤儿：会话关联的任务被软删除后，上下文返回 { session, task: null }
const ctxOrphanTask = createTask({ goalId: contextGoal.id, title: "将被删除的计时任务", currentDate: today, estimatedMinutes: 30 });
const ctxOrphanSession = startActionSession(ctxOrphanTask.id, "countdown", new Date("2026-06-21T16:00:00+08:00"));
deleteTask(ctxOrphanTask.id);
const orphanContext = getActiveActionSessionContext(new Date("2026-06-21T16:00:10+08:00"));
assert.equal(orphanContext.session.id, ctxOrphanSession.id, "孤儿会话仍应返回会话");
assert.equal(orphanContext.task, null, "任务软删除后上下文应返回 task: null（孤儿可识别）");
// 恢复态：用 abandonActionSession(keepTime=false) 清除残留会话，消除死锁
abandonActionSession(ctxOrphanSession.id, false, new Date("2026-06-21T16:00:15+08:00"));
assert.equal(getActiveActionSessionContext(), null, "清理孤儿会话后应无活跃会话");

// === Bug 1 (P0) 回归：完成一部分后顺延的原行动应计入行动天数和连续天数 ===
// 修复前 getProgressSummary 过滤掉所有 rescheduled 任务，导致"完成一部分后顺延"的原行动
// （status=rescheduled, statusBeforeReschedule=partially_completed）被排除，与 profileGrowth.ts 口径不一致。
const streakFixGoal = createGoal({ title: "顺延口径修复验证", category: "custom" });
const streakToday = getTodayBusinessDate();
const streakDayMinus2 = addBusinessDays(streakToday, -2);
const streakDayMinus1 = addBusinessDays(streakToday, -1);

// Day -2: 任务 A 完成
const streakTaskA = createTask({ goalId: streakFixGoal.id, title: "前天完成", currentDate: streakDayMinus2, estimatedMinutes: 30 });
updateTaskStatus(streakTaskA.id, "completed", 30);

// Day -1: 任务 B 完成一部分后顺延（原行动应计入行动天数和连续天数）
const streakTaskB = createTask({ goalId: streakFixGoal.id, title: "昨天部分完成后顺延", currentDate: streakDayMinus1, estimatedMinutes: 45 });
updateTaskStatus(streakTaskB.id, "partially_completed", 15, "not_enough_time");
rescheduleTask(streakTaskB.id, streakDayMinus1);

// Day 0 (today): 任务 C 完成
const streakTaskC = createTask({ goalId: streakFixGoal.id, title: "今天完成", currentDate: streakToday, estimatedMinutes: 30 });
updateTaskStatus(streakTaskC.id, "completed", 25);

// 修正历史任务的 activityDate（updateTaskStatus 统一设为今天，需还原为实际发生日期）
const streakFixStore = readManualStore();
const fixTaskA = streakFixStore.tasks.find((task) => task.id === streakTaskA.id);
fixTaskA.activityDate = streakDayMinus2;
const fixTaskB = streakFixStore.tasks.find((task) => task.id === streakTaskB.id);
fixTaskB.activityDate = streakDayMinus1;
writeManualStore(streakFixStore);

const streakFixSummary = getProgressSummary(streakFixGoal.id, streakToday);
// actionDates 应包含 Day -2（A）、Day -1（B 顺延原行动）、Day 0（C）
assert.equal(streakFixSummary.totalActionDays, 3, "Bug 1: 完成一部分后顺延的原行动应计入行动天数");
assert.equal(streakFixSummary.currentStreakDays, 3, "Bug 1: 完成一部分后顺延的原行动应维持连续天数");
// 累计投入包含 B 的 15 分钟
assert.equal(streakFixSummary.totalActualMinutes, 70, "Bug 1: 累计投入应包含完成一部分后顺延的原行动投入");
// 连续天数成就基于修复后的 currentStreakDays
const streakBadge3 = streakFixSummary.badges.find((badge) => badge.key === "streak_3");
assert.equal(streakBadge3.unlocked, true, "Bug 1: 连续 3 天成就应基于修复后的 currentStreakDays 解锁");
// 顺延的原行动仍处于 rescheduled 状态，确认数据完整性
const rolloverOrigin = getTask(streakTaskB.id);
assert.equal(rolloverOrigin.status, "rescheduled", "Bug 1: 顺延原行动状态应为 rescheduled");
assert.equal(rolloverOrigin.statusBeforeReschedule, "partially_completed", "Bug 1: 顺延原行动应保留 statusBeforeReschedule");
assert.equal(rolloverOrigin.actualMinutes, 15, "Bug 1: 顺延原行动应保留实际投入");

// === Bug 2 (P0) 回归：热力图和近 7 天使用 activityDate 而非 currentDate ===
// 修复前 recentDays 和 heatmapDays 通过 task.currentDate 筛选，导致今天完成的顺延行动
// 错误地出现在原计划日期的格子里。修复后已完成任务按 activityDate 归属，待开始仍按 currentDate。
const heatmapFixGoal = createGoal({ title: "热力图日期归属验证", category: "custom" });
const heatmapToday = getTodayBusinessDate();
const heatmapYesterday = addBusinessDays(heatmapToday, -1);

// 昨天计划的任务，今天完成（updateTaskStatus 设置 activityDate = today, currentDate 仍为 yesterday）
const carryoverCompleted = createTask({ goalId: heatmapFixGoal.id, title: "昨天计划今天完成", currentDate: heatmapYesterday, estimatedMinutes: 30 });
updateTaskStatus(carryoverCompleted.id, "completed", 25);
// 昨天的待开始任务（仍按 currentDate 归属到昨天）
const pendingYesterday = createTask({ goalId: heatmapFixGoal.id, title: "昨天待开始", currentDate: heatmapYesterday, estimatedMinutes: 20 });

const heatmapFixSummary = getProgressSummary(heatmapFixGoal.id, heatmapToday);

// recentDays 中今天应包含已完成的顺延行动
const todayRecent = heatmapFixSummary.recentDays.find((day) => day.isToday);
assert.equal(todayRecent.completedCount, 1, "Bug 2: 今天完成的顺延行动应在 recentDays 今天的 completedCount 中");
assert.equal(todayRecent.totalCount, 1, "Bug 2: 今天完成的顺延行动应在 recentDays 今天的 totalCount 中");
// recentDays 中昨天应包含待开始任务，但不含已完成的顺延行动
const yesterdayRecent = heatmapFixSummary.recentDays.find((day) => day.date === heatmapYesterday);
assert.equal(yesterdayRecent.completedCount, 0, "Bug 2: 昨天计划今天完成的行动不应在昨天的 completedCount 中");
assert.equal(yesterdayRecent.totalCount, 1, "Bug 2: 昨天的待开始任务应仍在昨天的 totalCount 中");
// 热力图今天的位置应显示完成标记
const todayHeatmap = heatmapFixSummary.heatmapWeeks.flat().find((day) => day.isToday);
assert.equal(todayHeatmap.completedCount, 1, "Bug 2: 今天完成的顺延行动应在热力图今天的 completedCount 中");
assert.equal(todayHeatmap.level, 3, "Bug 2: 今天完成的顺延行动应在热力图今天显示完成标记");
// 热力图昨天的位置应包含待开始任务，但不含已完成的顺延行动
const yesterdayHeatmap = heatmapFixSummary.heatmapWeeks.flat().find((day) => day.date === heatmapYesterday);
assert.equal(yesterdayHeatmap.completedCount, 0, "Bug 2: 昨天计划今天完成的行动不应在热力图昨天的 completedCount 中");
assert.equal(yesterdayHeatmap.totalCount, 1, "Bug 2: 昨天的待开始任务应仍在热力图昨天的 totalCount 中");

// === Bug 3 (P1) 回归：finishActionSession 仅结束计时时保留 issueReason ===
// 修复前 finishActionSession 无条件清除 issueReason，导致用户之前设置的完成原因丢失。
const issueReasonGoal = createGoal({ title: "计时结束保留原因验证", category: "custom" });
const issueReasonToday = getTodayBusinessDate();
const issueReasonTask = createTask({ goalId: issueReasonGoal.id, title: "先标记完成一部分", currentDate: issueReasonToday, estimatedMinutes: 30 });
// 通过菜单标记完成一部分并设置原因
updateTaskStatus(issueReasonTask.id, "partially_completed", 10, "not_enough_time");
assert.equal(getTask(issueReasonTask.id).issueReason, "not_enough_time", "Bug 3 前置: 应已设置 issueReason");
// 开始计时后仅结束计时（不标记完成）
const issueReasonSession = startActionSession(issueReasonTask.id, "countdown", new Date("2026-06-21T09:00:00+08:00"));
finishActionSession(issueReasonSession.id, false, new Date("2026-06-21T09:02:00+08:00"));
assert.equal(getTask(issueReasonTask.id).status, "partially_completed", "Bug 3: 仅结束计时后状态应为 partially_completed");
assert.equal(getTask(issueReasonTask.id).issueReason, "not_enough_time", "Bug 3: 仅结束计时应保留原有 issueReason");
// 再次计时并标记完成 — 此时 issueReason 应被清除
const issueReasonSession2 = startActionSession(issueReasonTask.id, "countdown", new Date("2026-06-21T09:05:00+08:00"));
finishActionSession(issueReasonSession2.id, true, new Date("2026-06-21T09:08:00+08:00"));
assert.equal(getTask(issueReasonTask.id).status, "completed", "Bug 3: 标记完成后状态应为 completed");
assert.equal(getTask(issueReasonTask.id).issueReason, undefined, "Bug 3: 标记完成时应清除 issueReason");

// === Bug 4 (P1) 回归：todayCompleted/todayTotal 包含今天实际完成的顺延行动 ===
const todayStatsGoal = createGoal({ title: "今日统计口径验证", category: "custom" });
const todayStatsToday = getTodayBusinessDate();
const todayStatsYesterday = addBusinessDays(todayStatsToday, -1);
// 昨天计划、今天完成的任务
const carryoverToday = createTask({ goalId: todayStatsGoal.id, title: "昨天计划今天完成", currentDate: todayStatsYesterday, estimatedMinutes: 30 });
updateTaskStatus(carryoverToday.id, "completed", 25);
// 今天计划、今天完成的任务
const todayCompleted = createTask({ goalId: todayStatsGoal.id, title: "今天完成", currentDate: todayStatsToday, estimatedMinutes: 20 });
updateTaskStatus(todayCompleted.id, "completed", 20);
const todayStatsSummary = getProgressSummary(todayStatsGoal.id, todayStatsToday);
// todayCompleted 应包含今天完成的顺延行动 + 今天计划完成的 = 2
assert.equal(todayStatsSummary.todayCompleted, 2, "Bug 4: todayCompleted 应包含今天实际完成的顺延行动");
assert.equal(todayStatsSummary.todayTotal, 2, "Bug 4: todayTotal 应包含今天实际完成的顺延行动");

// === Bug 8 (P2) 验证：连续天数成就基于修复后的 currentStreakDays ===
// 已随 Bug 1 修复。验证 badges 的 streak_7 也能正确解锁。
const streak7Goal = createGoal({ title: "连续七天成就验证", category: "custom" });
const streak7Today = getTodayBusinessDate();
for (let i = 6; i >= 0; i -= 1) {
  const date = addBusinessDays(streak7Today, -i);
  const task = createTask({ goalId: streak7Goal.id, title: `第${7 - i}天`, currentDate: date, estimatedMinutes: 30 });
  updateTaskStatus(task.id, "completed", 30);
  // 还原 activityDate 到实际日期（updateTaskStatus 统一设为今天）
  const s = readManualStore();
  s.tasks.find((t) => t.id === task.id).activityDate = date;
  writeManualStore(s);
}
const streak7Summary = getProgressSummary(streak7Goal.id, streak7Today);
assert.equal(streak7Summary.currentStreakDays, 7, "Bug 8: 连续 7 天应正确计算");
const streak7Badge = streak7Summary.badges.find((badge) => badge.key === "streak_7");
assert.equal(streak7Badge.unlocked, true, "Bug 8: 连续 7 天成就应基于修复后的 currentStreakDays 解锁");

// === Bug 9 (P3) 验证：totalActualMinutes 与 actionDates 数据源一致 ===
// 已随 Bug 1 修复。验证有投入的每个日期都被计为行动天数。
const consistencyGoal = createGoal({ title: "数据源一致性验证", category: "custom" });
const consistencyToday = getTodayBusinessDate();
const consistencyDay1 = addBusinessDays(consistencyToday, -1);
// Day -1: 完成一部分后顺延（原行动有 actualMinutes 和 activityDate）
const cpTask = createTask({ goalId: consistencyGoal.id, title: "部分完成后顺延", currentDate: consistencyDay1, estimatedMinutes: 30 });
updateTaskStatus(cpTask.id, "partially_completed", 12, "not_enough_time");
rescheduleTask(cpTask.id, consistencyDay1);
// Day 0: 正常完成
const ctTask = createTask({ goalId: consistencyGoal.id, title: "今天完成", currentDate: consistencyToday, estimatedMinutes: 20 });
updateTaskStatus(ctTask.id, "completed", 20);
// 还原 activityDate
const cs = readManualStore();
cs.tasks.find((t) => t.id === cpTask.id).activityDate = consistencyDay1;
writeManualStore(cs);
const consistencySummary = getProgressSummary(consistencyGoal.id, consistencyToday);
// totalActualMinutes 包含两天的投入（12 + 20 = 32），totalActionDays 应为 2（两天都有投入）
assert.equal(consistencySummary.totalActualMinutes, 32, "Bug 9: 累计投入应包含顺延原行动的投入");
assert.equal(consistencySummary.totalActionDays, 2, "Bug 9: 有投入的每个日期都应被计为行动天数");

// === Bug 10 (P3) 验证：completeActionSession 与 finishActionSession 的 issueReason 处理一致 ===
// 已随 Bug 3 修复。验证 completeActionSession 在 partial=true 时保留 issueReason，partial=false 时清除。
const bug10Goal = createGoal({ title: "计时入口一致性验证", category: "custom" });
const bug10Today = getTodayBusinessDate();
// 场景 1：completeActionSession partial=true 应保留 issueReason
const bug10TaskA = createTask({ goalId: bug10Goal.id, title: "completeActionSession 部分完成", currentDate: bug10Today, estimatedMinutes: 30 });
updateTaskStatus(bug10TaskA.id, "partially_completed", 5, "too_difficult");
const bug10SessionA = startActionSession(bug10TaskA.id, "countdown", new Date("2026-06-21T10:00:00+08:00"));
completeActionSession(bug10SessionA.id, 10, "", true, new Date("2026-06-21T10:05:00+08:00"));
assert.equal(getTask(bug10TaskA.id).status, "partially_completed", "Bug 10: completeActionSession partial=true 状态应为 partially_completed");
assert.equal(getTask(bug10TaskA.id).issueReason, "too_difficult", "Bug 10: completeActionSession partial=true 应保留 issueReason");
// 场景 2：completeActionSession partial=false 应清除 issueReason
const bug10TaskB = createTask({ goalId: bug10Goal.id, title: "completeActionSession 标记完成", currentDate: bug10Today, estimatedMinutes: 30 });
updateTaskStatus(bug10TaskB.id, "partially_completed", 5, "resource_unavailable");
const bug10SessionB = startActionSession(bug10TaskB.id, "countdown", new Date("2026-06-21T11:00:00+08:00"));
completeActionSession(bug10SessionB.id, 10, "", false, new Date("2026-06-21T11:05:00+08:00"));
assert.equal(getTask(bug10TaskB.id).status, "completed", "Bug 10: completeActionSession partial=false 状态应为 completed");
assert.equal(getTask(bug10TaskB.id).issueReason, undefined, "Bug 10: completeActionSession partial=false 应清除 issueReason");

console.log("manual service tests passed");
