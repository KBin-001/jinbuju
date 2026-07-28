Component({
  properties: {
    visible: { type: Boolean, value: false },
    taskTitle: { type: String, value: "" },
    iconAsset: { type: String, value: "" },
    status: { type: String, value: "running" },
    displayTime: { type: String, value: "00:00" },
    progressPercent: { type: Number, value: 0 },
    orphan: { type: Boolean, value: false },
  },
  methods: {
    openSession() { this.triggerEvent("open"); },
    toggleTimer() { this.triggerEvent("toggle"); },
    finishTimer() { this.triggerEvent("finish"); },
    cleanupOrphan() { this.triggerEvent("cleanup"); },
  },
});
