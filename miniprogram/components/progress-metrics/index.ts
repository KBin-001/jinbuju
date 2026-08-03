Component({
  properties: {
    items: { type: Array, value: [] },
  },
  methods: {
    openHistory() { this.triggerEvent("history"); },
  },
});
