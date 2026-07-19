export const FEATURE_FLAGS = {
  ENABLE_AI_PLANNER: false,
  ENABLE_AI_PROGRESS_COACH: true,
  ENABLE_TEAM: true,
  /**
   * 手机号绑定前端入口开关（宏定义）。
   * 当前阶段不展示绑定、解绑、手机号处理同意及绑定状态；不删除已有云端数据。
   * 后续仅将此项改为 true，即可恢复前端入口。
   */
  ENABLE_PHONE_BINDING: false,
  /**
   * 进度页投入趋势折线开关（宏定义）
   * - false：关闭折线绘制，不渲染折线 canvas、不展示「完成项数」折线图例，
   *          drawTrendLine 直接返回。柱状图等其余内容不受影响。
   * - true ：恢复折线绘制与图例展示。
   *
   * 启用方式：将本字段改为 true 即可。
   */
  ENABLE_TREND_LINE: true,
} as const;
