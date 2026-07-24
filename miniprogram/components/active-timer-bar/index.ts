Component({
  properties: {
    visible: { type: Boolean, value: false },
    taskTitle: { type: String, value: "" },
    iconAsset: { type: String, value: "" },
    status: { type: String, value: "running" },
    displayTime: { type: String, value: "00:00" },
    progressPercent: { type: Number, value: 0 },
  },
  methods: {
    toggleTimer() { this.triggerEvent("toggle"); },
    finishTimer() { this.triggerEvent("finish"); },
  },
});
