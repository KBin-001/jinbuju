Component({
  properties: {
    messages: { type: Array, value: [] },
    quickQuestions: { type: Array, value: [] },
    asking: { type: Boolean, value: false },
    errorMessage: { type: String, value: "" },
    executingProposalId: { type: String, value: "" },
    title: { type: String, value: "继续问教练" },
    userAvatarUrl: {
      type: String,
      value: "",
      observer() { this.setData({ avatarFailed: false }); },
    },
  },

  data: { question: "", avatarFailed: false },

  methods: {
    inputQuestion(event: { detail: { value?: string } }) {
      this.setData({ question: String(event.detail.value || "").slice(0, 1000) });
    },

    sendQuestion() {
      if (this.properties.asking) return;
      const question = String(this.data.question || "").trim();
      if (!question) {
        wx.showToast({ title: "先写下你想问的问题", icon: "none" });
        return;
      }
      this.setData({ question: "" });
      this.triggerEvent("send", { question });
    },

    sendQuickQuestion(event: { currentTarget: { dataset: { question?: string } } }) {
      if (this.properties.asking) return;
      const question = String(event.currentTarget.dataset.question || "").slice(0, 1000);
      if (question) this.triggerEvent("send", { question });
    },

    retry() { if (!this.properties.asking) this.triggerEvent("retry"); },

    avatarError() { this.setData({ avatarFailed: true }); },

    confirmProposal(event: { currentTarget: { dataset: { proposalId?: string } } }) {
      const proposalId = String(event.currentTarget.dataset.proposalId || "");
      if (proposalId && !this.properties.executingProposalId) this.triggerEvent("confirmproposal", { proposalId });
    },
  },
});
