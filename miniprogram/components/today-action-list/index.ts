function presentTask(task: any, activeTaskId: string, activeMinutes: number, activeStatus: string, activeDisplay: string) {
  const isActive = activeTaskId === task.id;
  const isActiveRunning = isActive && activeStatus === "running";
  const isActivePaused = isActive && activeStatus === "paused";
  const focusedMinutes = isActive ? activeMinutes : Math.max(0, Number(task.actualMinutes || 0));
  const isContinuable = isActive || task.status === "partially_completed";
  const isCompleted = task.status === "completed";
  const estimatedMinutes = Math.max(0, Number(task.estimatedMinutes || 0));
  const progressPercent = estimatedMinutes > 0 ? Math.min(100, Math.round(focusedMinutes / estimatedMinutes * 100)) : 0;
  return {
    ...task,
    actionButtonLabel: isCompleted ? "已完成" : isActiveRunning ? "专注中" : isContinuable ? "继续" : task.primaryAction === "complete" ? "标记完成" : "开始",
    actionButtonTone: isCompleted ? "done" : isActiveRunning ? "timing" : isContinuable ? "continue" : task.primaryAction === "complete" ? "complete" : "start",
    actionMetaText: isCompleted
      ? focusedMinutes > 0 ? `已完成 · 实际 ${focusedMinutes} 分钟` : "已完成"
      : isActiveRunning ? `专注中 · 本次 ${activeDisplay} · 预计 ${estimatedMinutes} 分钟`
        : isActivePaused ? `已暂停 · 本次 ${activeDisplay} · 预计 ${estimatedMinutes} 分钟`
          : isContinuable ? `已专注 ${focusedMinutes} 分钟 · 预计 ${estimatedMinutes} 分钟` : task.actionTimeText,
    showProgress: isContinuable && estimatedMinutes > 0,
    progressPercent,
  };
}

Component({
  properties: {
    taskGroups: { type: Array, value: [] },
    tasks: { type: Array, value: [] },
    activeTaskId: { type: String, value: "" },
    activeStatus: { type: String, value: "" },
    activeMinutes: { type: Number, value: 0 },
    activeDisplay: { type: String, value: "00:00" },
    activeTotalMinutes: { type: Number, value: 0 },
  },
  data: {
    renderGroups: [] as any[],
  },
  observers: {
    "taskGroups,tasks,activeTaskId,activeMinutes,activeStatus,activeDisplay": function (taskGroups: any[], tasks: any[], activeTaskId: string, activeMinutes: number, activeStatus: string, activeDisplay: string) {
      const rawGroups = Array.isArray(taskGroups) ? taskGroups.filter((group) => Array.isArray(group?.tasks) && group.tasks.length) : [];
      const fallbackTasks = Array.isArray(tasks) ? tasks : [];
      const groups = rawGroups.map((group) => ({
        ...group,
        brushAsset: group.tone === "muted"
          ? "/assets/today-action-brush-gray-v1.png"
          : group.tone === "done"
            ? "/assets/today-action-brush-gold-v1.png"
            : "/assets/today-action-brush-green-v1.png",
        count: group.tasks.length,
        tasks: group.tasks.map((task: any) => presentTask(task, activeTaskId, activeMinutes, activeStatus, activeDisplay)),
      }));
      this.setData({
        renderGroups: groups.length ? groups : fallbackTasks.length ? [{
          key: "later",
          title: "稍后安排",
          hint: "已为你安排到专注时段",
          icon: "time",
          tone: "muted",
          brushAsset: "/assets/today-action-brush-gray-v1.png",
          count: fallbackTasks.length,
          tasks: fallbackTasks.map((task) => presentTask({ ...task, priorityReasons: task.priorityReasons || [] }, activeTaskId, activeMinutes, activeStatus, activeDisplay)),
        }] : [],
      });
    },
  },
  methods: {
    openTask(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent("open", { id: String(event.currentTarget.dataset.id || "") });
    },
    primaryAction(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent("primary", { id: String(event.currentTarget.dataset.id || "") });
    },
    openMenu(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent("menu", { id: String(event.currentTarget.dataset.id || "") });
    },
  },
});
