Component({
  properties: {
    goal: { type: Object, value: null },
    period: { type: String, value: "" },
    switchLabel: { type: String, value: "切换目标" },
    stage: { type: Object, value: null },
  },
  methods: {
    handleSwitch() {
      this.triggerEvent("switch");
    },
  },
});
