Component({
  properties: {
    status: { type: String, value: "idle" },
    text: { type: String, value: "" },
  },
  methods: {
    openCoach() { this.triggerEvent("open"); },
  },
});
