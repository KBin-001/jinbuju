Component({
  properties: {
    insight: { type: Object, value: null },
  },
  methods: {
    openCoach() { this.triggerEvent("open"); },
  },
});
