import { ActionTask } from "../../types/manual";
import { MODAL_CONFIRM_COLORS } from "../../services/theme";

Component({
  properties: {
    visible: { type: Boolean, value: false },
    task: { type: Object, value: null },
    saving: { type: Boolean, value: false },
  },
  data: {
    title: "",
    completedDate: "",
    completedTime: "00:00",
    actualMinutesText: "0",
    dirty: false,
  },
  observers: {
    "visible, task": function (visible: boolean, task: ActionTask | null) {
      if (!visible || !task?.id) return;
      const timestamp = new Date(task.completedAt || task.updatedAt || task.createdAt);
      const validTime = !Number.isNaN(timestamp.getTime());
      this.setData({
        title: task.title || "",
        completedDate: task.activityDate || task.currentDate || "",
        completedTime: validTime ? `${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}` : "00:00",
        actualMinutesText: String(Math.max(0, Number(task.actualMinutes || 0))),
        dirty: false,
      });
    },
  },
  methods: {
    noop() {},
    close() {
      if (this.data.saving) return;
      if (!this.data.dirty) {
        this.triggerEvent("close");
        return;
      }
      wx.showModal({
        title: "放弃本次修改？",
        content: "尚未保存的完成记录将不会保留。",
        confirmText: "放弃修改",
        confirmColor: MODAL_CONFIRM_COLORS.danger,
        success: (result) => {
          if (result.confirm) this.triggerEvent("close");
        },
      });
    },
    inputTitle(event: { detail: { value?: string } }) {
      this.setData({ title: String(event.detail.value || "").slice(0, 40), dirty: true });
    },
    inputMinutes(event: { detail: { value?: string } }) {
      this.setData({ actualMinutesText: String(event.detail.value || "").replace(/\D/g, "").slice(0, 3), dirty: true });
    },
    changeDate(event: { detail: { value?: string } }) {
      this.setData({ completedDate: String(event.detail.value || ""), dirty: true });
    },
    changeTime(event: { detail: { value?: string } }) {
      this.setData({ completedTime: String(event.detail.value || ""), dirty: true });
    },
    save() {
      if (this.data.saving) return;
      this.triggerEvent("save", {
        title: this.data.title,
        businessDate: this.data.completedDate,
        time: this.data.completedTime,
        actualMinutes: Number(this.data.actualMinutesText || 0),
      });
    },
  },
});
