Component({
  properties: {
    status: { type: String, value: "idle" },
    text: { type: String, value: "" },
    title: { type: String, value: "" },
    body: { type: String, value: "" },
  },
  methods: {
    openCoach() { this.triggerEvent("open"); },
  },
});
