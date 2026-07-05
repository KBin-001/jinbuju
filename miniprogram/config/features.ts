export const FEATURE_FLAGS = {
  ENABLE_AI_PLANNER: false,
  ENABLE_AI_PROGRESS_COACH: true,
  ENABLE_TEAM: true,
  /**
   * 主题换肤功能开关（宏定义）
   * - false：禁用主题换肤，系统强制使用默认主题（inkGreen 墨绿成长），
   *          不会读取/写入主题 storage，不广播主题变更事件。
   * - true ：启用主题换肤，用户可在「我的 → 主题皮肤」中切换主题。
   *
   * 启用方式：将本字段改为 true，并取消 profile 页面中已被注释的
   * 主题换肤相关代码即可恢复完整换肤能力。
   */
  ENABLE_THEME_SWITCHING: false,
  /**
   * 进度页投入趋势折线开关（宏定义）
   * - false：关闭折线绘制，不渲染折线 canvas、不展示「完成项数」折线图例，
   *          drawTrendLine 直接返回。柱状图等其余内容不受影响。
   * - true ：恢复折线绘制与图例展示。
   *
   * 启用方式：将本字段改为 true 即可。
   */
  ENABLE_TREND_LINE: false,
} as const;

