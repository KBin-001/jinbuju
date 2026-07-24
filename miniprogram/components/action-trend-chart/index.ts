interface ChartBar {
  key: string;
  label: string;
  subLabel: string;
  minutes: number;
  actions: number;
  isToday: boolean;
  isFuture: boolean;
}

interface ChartData {
  bars: ChartBar[];
  maxValue: number;
  maxActions: number;
  axisLabels?: string[];
}

function smoothCurve(ctx: any, points: Array<{ x: number; y: number }>) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  const slopes = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    return (next.y - point.y) / Math.max(1, next.x - point.x);
  });
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];
    const left = slopes[index - 1];
    const right = slopes[index];
    return left * right <= 0 ? 0 : (left + right) / 2;
  });
  slopes.forEach((slope, index) => {
    if (Math.abs(slope) < 0.0001) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      return;
    }
    const a = tangents[index] / slope;
    const b = tangents[index + 1] / slope;
    const scale = a * a + b * b;
    if (scale > 9) {
      const ratio = 3 / Math.sqrt(scale);
      tangents[index] = ratio * a * slope;
      tangents[index + 1] = ratio * b * slope;
    }
  });
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const dx = next.x - current.x;
    ctx.bezierCurveTo(
      current.x + dx / 3,
      current.y + tangents[index] * dx / 3,
      next.x - dx / 3,
      next.y - tangents[index + 1] * dx / 3,
      next.x,
      next.y,
    );
  }
}

function setStrokeStyle(ctx: any, value: string) { if (ctx.setStrokeStyle) ctx.setStrokeStyle(value); else ctx.strokeStyle = value; }
function setFillStyle(ctx: any, value: string) { if (ctx.setFillStyle) ctx.setFillStyle(value); else ctx.fillStyle = value; }
function setLineWidth(ctx: any, value: number) { if (ctx.setLineWidth) ctx.setLineWidth(value); else ctx.lineWidth = value; }
function setLineCap(ctx: any, value: string) { if (ctx.setLineCap) ctx.setLineCap(value); else ctx.lineCap = value; }
function setLineJoin(ctx: any, value: string) { if (ctx.setLineJoin) ctx.setLineJoin(value); else ctx.lineJoin = value; }
function setTextAlign(ctx: any, value: string) { if (ctx.setTextAlign) ctx.setTextAlign(value); else ctx.textAlign = value; }
function setFontSize(ctx: any, value: number) { if (ctx.setFontSize) ctx.setFontSize(value); else ctx.font = `${value}px sans-serif`; }

Component({
  properties: {
    chart: { type: Object, value: null },
    summary: { type: Object, value: null },
    highlights: { type: Object, value: null },
    ranges: { type: Array, value: [] },
    periodLabel: { type: String, value: "" },
    completionEnabled: { type: Boolean, value: true },
    hasAnyTask: { type: Boolean, value: false },
  },
  data: {
    canvasWidth: 0,
  },
  observers: {
    "chart, completionEnabled": function () {
      this.scheduleDraw();
    },
  },
  lifetimes: {
    attached() {
      this.scheduleDraw();
    },
    ready() {
      this.scheduleDraw();
      setTimeout(() => this.drawChart(), 80);
    },
  },
  pageLifetimes: {
    show() {
      setTimeout(() => this.drawChart(), 60);
    },
  },
  methods: {
    refresh() {
      this.drawChart();
    },
    scheduleDraw() {
      if (!(this.data.chart as ChartData | null)?.bars?.length) return;
      wx.nextTick(() => this.drawChart());
    },
    drawChart() {
      const query = this.createSelectorQuery();
      query.select(".trend-canvas").fields({ size: true }).exec((result: any[]) => {
        const target = result?.[0];
        if (!target?.width || !target.height) return;
        const context = wx.createCanvasContext("trendCanvas", this);
        context.clearRect(0, 0, target.width, target.height);
        this.paint(context, target.width, target.height, this.data.chart as ChartData);
        context.draw();
        this.setData({ canvasWidth: target.width });
      });
    },
    paint(ctx: any, width: number, height: number, chart: ChartData) {
      const bars = chart.bars || [];
      if (!bars.length) return;
      const top = 34;
      const bottom = height - 30;
      const plotHeight = bottom - top;
      const sidePadding = 18;
      const availableWidth = Math.max(1, width - sidePadding * 2);
      const step = bars.length > 1 ? availableWidth / (bars.length - 1) : availableWidth;
      const maxMinutes = Math.max(1, Number(chart.maxValue || 1));
      const maxActions = Math.max(1, Number(chart.maxActions || 1));
      const minutePoints = bars.map((bar, index) => ({
        x: bars.length > 1 ? sidePadding + index * step : width / 2,
        y: bottom - Math.max(0, Number(bar.minutes || 0)) / maxMinutes * plotHeight,
      }));
      const actionPoints = bars.map((bar, index) => ({
        x: bars.length > 1 ? sidePadding + index * step : width / 2,
        y: bottom - Math.max(0, Number(bar.actions || 0)) / maxActions * plotHeight,
      }));
      const visibleMinutePoints = minutePoints.filter((_, index) => !bars[index].isFuture);
      const visibleActionPoints = actionPoints.filter((_, index) => !bars[index].isFuture);

      setLineWidth(ctx, 1);
      setStrokeStyle(ctx, "rgba(72,93,84,.075)");
      const gridDivisions = Math.max(1, (chart.axisLabels?.length || 5) - 1);
      Array.from({ length: gridDivisions + 1 }, (_, index) => index / gridDivisions).forEach((ratio) => {
        const y = top + plotHeight * ratio;
        ctx.beginPath(); ctx.moveTo(sidePadding, y); ctx.lineTo(width - sidePadding, y); ctx.stroke();
      });

      const todayIndex = bars.findIndex((bar) => bar.isToday);
      if (todayIndex >= 0) {
        const todayX = minutePoints[todayIndex].x;
        ctx.save(); ctx.setLineDash([3, 5]); setStrokeStyle(ctx, "rgba(196,148,50,.22)"); setLineWidth(ctx, 1);
        ctx.beginPath(); ctx.moveTo(todayX, top); ctx.lineTo(todayX, bottom); ctx.stroke(); ctx.restore();
      }

      const activeBars = bars.filter((bar) => !bar.isFuture && bar.minutes > 0);
      const average = activeBars.length ? activeBars.reduce((sum, bar) => sum + bar.minutes, 0) / activeBars.length : 0;
      if (average > 0) {
        const y = bottom - average / maxMinutes * plotHeight;
        const averageEndX = visibleMinutePoints[visibleMinutePoints.length - 1]?.x ?? width - sidePadding;
        ctx.save(); ctx.setLineDash([4, 5]); setStrokeStyle(ctx, "rgba(36,91,77,.28)"); setLineWidth(ctx, 1);
        ctx.beginPath(); ctx.moveTo(sidePadding, y); ctx.lineTo(averageEndX, y); ctx.stroke(); ctx.restore();
        setFillStyle(ctx, "#65716B"); setFontSize(ctx, 10); setTextAlign(ctx, "left");
        const averageLabelX = Math.min(width - sidePadding - 88, averageEndX + 7);
        ctx.fillText(`平均 ${Math.round(average)} 分钟`, averageLabelX, Math.max(top + 12, y - 7));
      }

      if (visibleMinutePoints.length) {
        ctx.beginPath(); smoothCurve(ctx, visibleMinutePoints);
        ctx.lineTo(visibleMinutePoints[visibleMinutePoints.length - 1].x, bottom);
        ctx.lineTo(visibleMinutePoints[0].x, bottom);
        ctx.closePath();
        setFillStyle(ctx, "rgba(23,97,79,.050)"); ctx.fill();
        ctx.beginPath(); smoothCurve(ctx, visibleMinutePoints); setStrokeStyle(ctx, "#17614F"); setLineWidth(ctx, 2.25); setLineCap(ctx, "round"); setLineJoin(ctx, "round"); ctx.stroke();
      }
      minutePoints.forEach((point, index) => {
        if (bars[index].isFuture) return;
        ctx.beginPath(); ctx.arc(point.x, point.y, bars[index].isToday ? 4.8 : 3.7, 0, Math.PI * 2);
        setFillStyle(ctx, "#17614F"); ctx.fill(); setLineWidth(ctx, 2); setStrokeStyle(ctx, "#FFFDF8"); ctx.stroke();
        if (bars[index].minutes > 0) {
          setFillStyle(ctx, "#27352F"); setFontSize(ctx, 10); setTextAlign(ctx, "center");
          ctx.fillText(String(bars[index].minutes), point.x, Math.max(14, point.y - 11));
        }
      });

      if (this.data.completionEnabled && visibleActionPoints.length) {
        ctx.beginPath(); smoothCurve(ctx, visibleActionPoints); setStrokeStyle(ctx, "rgba(197,150,62,.42)"); setLineWidth(ctx, 1.05); ctx.stroke();
        actionPoints.forEach((point, index) => {
          if (bars[index].isFuture) return;
          ctx.beginPath(); ctx.arc(point.x, point.y, bars[index].isToday ? 5 : 4, 0, Math.PI * 2);
          setFillStyle(ctx, "#FFFDF8"); ctx.fill(); setLineWidth(ctx, bars[index].isToday ? 2.4 : 2); setStrokeStyle(ctx, "#C5963E"); ctx.stroke();
          if (bars[index].actions > 0) {
            const minutePoint = minutePoints[index];
            const isCrowded = Math.abs(point.y - minutePoint.y) < 20;
            const labelY = isCrowded ? Math.min(bottom - 5, point.y + 16) : Math.max(top + 10, point.y - 10);
            setFillStyle(ctx, "#A97A25"); setFontSize(ctx, 9); setTextAlign(ctx, "center");
            ctx.fillText(String(bars[index].actions), point.x, labelY);
          }
        });
      }
    },
    changeRange(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent("rangechange", { key: String(event.currentTarget.dataset.key || "week") });
    },
    selectPoint(event: WechatMiniprogram.TouchEvent) {
      const bars = (this.data.chart as ChartData | null)?.bars || [];
      const width = Number(this.data.canvasWidth || 0);
      if (!bars.length || !width) return;
      const x = Number((event as any).detail?.x ?? (event as any).touches?.[0]?.x ?? 0);
      const index = Math.max(0, Math.min(bars.length - 1, Math.round(x / width * (bars.length - 1))));
      if (bars[index].isFuture) return;
      this.triggerEvent("select", { key: bars[index].key, index });
    },
    openHistory() { this.triggerEvent("history"); },
    handleEmptyAction() { this.triggerEvent("emptyaction"); },
  },
});
