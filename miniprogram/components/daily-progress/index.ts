Component({
  properties: {
    targetMinutes: { type: Number, value: 0 },
    actualMinutes: { type: Number, value: 0 },
    percent: { type: Number, value: 0 },
  },
  methods: {
    openDetails() { this.triggerEvent("open"); },
  },
});
