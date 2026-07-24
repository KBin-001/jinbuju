Component({
  properties: {
    tasks: { type: Array, value: [] },
    activeTaskId: { type: String, value: "" },
    activeStatus: { type: String, value: "" },
    activeMinutes: { type: Number, value: 0 },
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
