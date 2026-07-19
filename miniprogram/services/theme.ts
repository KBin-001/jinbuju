/**
 * 发布版固定主题。
 *
 * 项目只保留当前“现代东方山水”配色，不再读取主题缓存、广播换肤事件
 * 或打包历史主题预设。withAppTheme 保留为页面兼容包装器，避免为了删除
 * 换肤功能而改动所有页面生命周期。
 */

export type ThemeId = "inkGreen";

export const DEFAULT_THEME_ID: ThemeId = "inkGreen";

export const MODAL_CONFIRM_COLORS = {
  confirm: "#245B4D",
  danger: "#B54A43",
} as const;

const CURRENT_THEME = {
  page: "#F7F3EA",
  card: "#FFFCF6",
  primary: "#245B4D",
  secondary: "#7F9D91",
} as const;

export function getCurrentThemeId(): ThemeId {
  return DEFAULT_THEME_ID;
}

export function applyGlobalTheme(_id?: ThemeId): ThemeId {
  try {
    wx.setNavigationBarColor({
      frontColor: "#000000",
      backgroundColor: CURRENT_THEME.page,
      animation: { duration: 0, timingFunc: "linear" },
    });
  } catch (_error) {
    // 自定义导航页或旧基础库无需阻断启动。
  }
  try {
    wx.setTabBarStyle({
      color: CURRENT_THEME.secondary,
      selectedColor: CURRENT_THEME.primary,
      backgroundColor: CURRENT_THEME.card,
      borderStyle: "white",
    });
  } catch (_error) {
    // 非 Tab 页面调用时保持静默。
  }
  return DEFAULT_THEME_ID;
}

type ThemedPageOptions = Record<string, any> & { data?: Record<string, any> };

/** 为现有页面注入唯一主题 id，不再为换肤包装或额外触发页面生命周期。 */
export function withAppTheme<T extends ThemedPageOptions>(options: T): T {
  return {
    ...options,
    data: { ...(options.data || {}), appTheme: DEFAULT_THEME_ID },
  } as T;
}
