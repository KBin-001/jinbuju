Component({
  properties: {
    insight: { type: Object, value: null },
    actionTitle: { type: String, value: "提前安排明日首项任务" },
    scopeLabel: { type: String, value: "本周" },
  },
  methods: {
    openCoach() { this.triggerEvent("open"); },
    handleAction() { this.triggerEvent("action"); },
  },
});
