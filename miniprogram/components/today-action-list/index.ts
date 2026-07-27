Component({
  properties: {
    taskGroups: { type: Array, value: [] },
    tasks: { type: Array, value: [] },
    activeTaskId: { type: String, value: "" },
    activeStatus: { type: String, value: "" },
    activeMinutes: { type: Number, value: 0 },
  },
  data: {
    renderGroups: [] as any[],
  },
  observers: {
    "taskGroups,tasks": function (taskGroups: any[], tasks: any[]) {
      const groups = Array.isArray(taskGroups) ? taskGroups.filter((group) => Array.isArray(group?.tasks) && group.tasks.length) : [];
      const fallbackTasks = Array.isArray(tasks) ? tasks : [];
      this.setData({
        renderGroups: groups.length ? groups : fallbackTasks.length ? [{
          key: "later",
          title: "稍后安排",
          hint: "已为你安排到专注时段",
          icon: "time",
          tone: "muted",
          tasks: fallbackTasks.map((task) => ({ ...task, priorityReasons: task.priorityReasons || [] })),
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
