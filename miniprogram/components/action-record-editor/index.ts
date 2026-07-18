import { ActionTask, ActionTaskStatus } from "../../types/manual";
import { MODAL_CONFIRM_COLORS } from "../../services/theme";

type EditableStatus = Extract<ActionTaskStatus, "completed" | "partially_completed" | "pending">;

Component({
  properties: {
    visible: { type: Boolean, value: false },
    task: { type: Object, value: null },
    saving: { type: Boolean, value: false },
    deleting: { type: Boolean, value: false },
  },
  data: {
    title: "",
    recordDate: "",
    recordTime: "00:00",
    actualMinutesText: "0",
    status: "completed" as EditableStatus,
    reflection: "",
    dirty: false,
  },
  observers: {
    "visible, task": function (visible: boolean, task: ActionTask | null) {
      if (!visible || !task?.id) return;
      const timestamp = new Date(task.completedAt || task.updatedAt || task.createdAt);
      const validTime = !Number.isNaN(timestamp.getTime());
      this.setData({
        title: task.title || "",
        recordDate: task.activityDate || task.currentDate || "",
        recordTime: validTime ? `${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}` : "00:00",
        actualMinutesText: String(Math.max(0, Number(task.actualMinutes || 0))),
        status: (["completed", "partially_completed", "pending"].includes(task.status) ? task.status : "pending") as EditableStatus,
        reflection: task.reflection || "",
        dirty: false,
      });
    },
  },
  methods: {
    noop() {},
    close() {
      if (this.data.saving || this.data.deleting) return;
      if (!this.data.dirty) {
        this.triggerEvent("close");
        return;
      }
      wx.showModal({
        title: "放弃本次修改？",
        content: "尚未保存的行动记录将不会保留。",
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
    changeDate(event: { detail: { value?: string } }) {
      this.setData({ recordDate: String(event.detail.value || ""), dirty: true });
    },
    changeTime(event: { detail: { value?: string } }) {
      this.setData({ recordTime: String(event.detail.value || ""), dirty: true });
    },
    inputMinutes(event: { detail: { value?: string } }) {
      this.setData({ actualMinutesText: String(event.detail.value || "").replace(/\D/g, "").slice(0, 3), dirty: true });
    },
    chooseStatus(event: WechatMiniprogram.TouchEvent) {
      if (this.data.saving || this.data.deleting) return;
      const status = String(event.currentTarget.dataset.status || "") as EditableStatus;
      if (["completed", "partially_completed", "pending"].includes(status)) this.setData({ status, dirty: true });
    },
    inputReflection(event: { detail: { value?: string } }) {
      this.setData({ reflection: String(event.detail.value || "").slice(0, 200), dirty: true });
    },
    save() {
      if (this.data.saving || this.data.deleting) return;
      this.triggerEvent("save", {
        title: this.data.title,
        businessDate: this.data.recordDate,
        time: this.data.recordTime,
        actualMinutes: Number(this.data.actualMinutesText || 0),
        status: this.data.status,
        reflection: this.data.reflection,
      });
    },
    remove() {
      if (this.data.saving || this.data.deleting) return;
      this.triggerEvent("delete");
    },
  },
});
