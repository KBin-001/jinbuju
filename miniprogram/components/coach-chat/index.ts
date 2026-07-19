type CoachAnchorRect = { top?: number };
type CoachViewportOffset = { scrollTop?: number };

function formatCoachTime(value?: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

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

  data: {
    question: "",
    avatarFailed: false,
    displayMessages: [] as Array<Record<string, unknown>>,
    feedbackById: {} as Record<string, "up" | "down">,
    thinkingContent: { title: "正在分析", text: "结合你的真实记录整理回答" },
  },

  observers: {
    messages(messages: Array<Record<string, unknown>>) {
      const feedbackById = this.data.feedbackById as Record<string, "up" | "down">;
      this.setData({
        displayMessages: (messages || []).map((message, index) => {
          const id = String(message.id || `message_${index}`);
          return { ...message, id, timeLabel: formatCoachTime(message.sentAt), feedback: feedbackById[id] || "" };
        }),
      });
    },
  },

  methods: {
    inputQuestion(event: { detail: { value?: string } }) {
      this.setData({ question: String(event.detail.value || "").slice(0, 1000) });
    },

    sendQuestion() {
      this.submitQuestion(this.data.question);
    },

    submitQuestion(rawQuestion?: string) {
      if (this.properties.asking) return;
      const question = String(rawQuestion || "").trim().slice(0, 1000);
      if (!question) {
        wx.showToast({ title: "先写下你想问的问题", icon: "none" });
        return;
      }
      this.setData({ question: "" });
      this.triggerEvent("send", { question });
    },

    sendQuickQuestion(event: { currentTarget: { dataset: { question?: string } } }) {
      this.submitQuestion(event.currentTarget.dataset.question);
    },

    retry() {
      if (!this.properties.asking) this.triggerEvent("retry");
    },

    avatarError() {
      this.setData({ avatarFailed: true });
    },

    confirmProposal(event: { currentTarget: { dataset: { proposalId?: string } } }) {
      const proposalId = String(event.currentTarget.dataset.proposalId || "");
      if (proposalId && !this.properties.executingProposalId) {
        this.triggerEvent("confirmproposal", { proposalId });
      }
    },

    rateAnswer(event: { currentTarget: { dataset: { messageId?: string; rating?: "up" | "down" } } }) {
      const messageId = String(event.currentTarget.dataset.messageId || "");
      const rating = event.currentTarget.dataset.rating;
      if (!messageId || (rating !== "up" && rating !== "down")) return;
      const feedbackById = { ...(this.data.feedbackById as Record<string, "up" | "down">), [messageId]: rating };
      const messages = (this.properties.messages || []) as Array<Record<string, unknown>>;
      this.setData({
        feedbackById,
        displayMessages: messages.map((message, index) => {
          const id = String(message.id || `message_${index}`);
          return { ...message, id, timeLabel: formatCoachTime(message.sentAt), feedback: feedbackById[id] || "" };
        }),
      });
      wx.showToast({ title: rating === "up" ? "谢谢你的反馈" : "已记录，会继续改进", icon: "none" });
    },

    scrollToLatest() {
      wx.nextTick(() => {
        const query = this.createSelectorQuery();
        query.selectAll(".coach-chat__message").boundingClientRect();
        query.select(".coach-chat__thinking").boundingClientRect();
        query.select(".coach-chat__error").boundingClientRect();
        query.select(".coach-chat__composer").boundingClientRect();
        query.selectViewport().scrollOffset();
        query.exec((results) => {
          const messages = (results && results[0] || []) as CoachAnchorRect[];
          const thinking = results && results[1] as CoachAnchorRect | undefined;
          const error = results && results[2] as CoachAnchorRect | undefined;
          const composer = results && results[3] as CoachAnchorRect | undefined;
          const viewport = results && results[4] as CoachViewportOffset | undefined;
          const targetRect = error
            || (this.properties.asking ? thinking : undefined)
            || messages[messages.length - 1]
            || composer;
          if (!targetRect || !viewport) return;
          const target = Math.max(0, Number(viewport.scrollTop || 0) + Number(targetRect.top || 0) - 96);
          wx.pageScrollTo({ scrollTop: target, duration: 220 });
        });
      });
    },
  },
});
