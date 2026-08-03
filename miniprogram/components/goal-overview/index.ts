function cubicCoordinate(start: number, controlOne: number, controlTwo: number, end: number, progress: number): number {
  const inverse = 1 - progress;
  return inverse * inverse * inverse * start
    + 3 * inverse * inverse * progress * controlOne
    + 3 * inverse * progress * progress * controlTwo
    + progress * progress * progress * end;
}

Component({
  properties: {
    goal: { type: Object, value: null },
    period: { type: String, value: "" },
    switchLabel: { type: String, value: "切换目标" },
    stage: { type: Object, value: null },
  },
  observers: {
    "stage.progressPercent": function () {
      this.scheduleStageDraw();
    },
  },
  lifetimes: {
    attached() { this.scheduleStageDraw(); },
    ready() { this.scheduleStageDraw(); },
  },
  methods: {
    scheduleStageDraw() {
      wx.nextTick(() => this.drawStage());
    },
    drawStage() {
      this.createSelectorQuery().select(".goal-stage__canvas").fields({ size: true }).exec((result: any[]) => {
        const target = result?.[0];
        if (!target?.width || !target.height) return;
        const ctx = wx.createCanvasContext("goalStageCanvas", this);
        const width = target.width;
        const height = target.height;
        const startX = 8;
        const endX = width - 8;
        const span = endX - startX;
        const startY = height - 14;
        const controlOneY = startY;
        const controlTwoY = height * .65;
        const endY = 12;
        const pointAt = (progress: number) => ({
          x: startX + span * progress,
          y: cubicCoordinate(startY, controlOneY, controlTwoY, endY, progress),
        });

        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.setStrokeStyle("rgba(92,104,82,.72)");
        ctx.setLineWidth(1);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(startX + span / 3, startY, startX + span * 2 / 3, controlTwoY, endX, endY);
        ctx.stroke();
        ctx.restore();

        [0, 1 / 3, 2 / 3, 1].forEach((progress) => {
          const point = pointAt(progress);
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4.4, 0, Math.PI * 2);
          ctx.setFillStyle("#FFFAF1");
          ctx.fill();
          ctx.setLineWidth(1.5);
          ctx.setStrokeStyle("#B99145");
          ctx.stroke();
        });

        const currentProgress = Math.max(0, Math.min(1, Number(this.data.stage?.progressPercent || 0) / 100));
        const current = pointAt(currentProgress);
        ctx.beginPath();
        ctx.arc(current.x, current.y, 8.5, 0, Math.PI * 2);
        ctx.setFillStyle("rgba(255,253,248,.96)");
        ctx.fill();
        ctx.beginPath();
        ctx.arc(current.x, current.y, 5.5, 0, Math.PI * 2);
        ctx.setFillStyle("#17614F");
        ctx.fill();
        ctx.setLineWidth(1.2);
        ctx.setStrokeStyle("rgba(23,97,79,.28)");
        ctx.stroke();
        ctx.draw();
      });
    },
    handleSwitch() {
      this.triggerEvent("switch");
    },
  },
});
