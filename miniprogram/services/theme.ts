/**
 * 进步局 · 主题皮肤服务
 * ------------------------------------------------
 * 提供 3 套低压力主题：薄荷绿（默认）/ 奶油黄 / 湖水蓝
 * - 当前主题持久化到本地 storage
 * - 通过 eventBus 广播 "theme:change" 事件，便于其它页面在 onShow 时同步
 * - themeToProfileCssVars() 生成可绑定到页面根节点 style 的 CSS 变量字符串
 */

import { emit, on, off } from "../utils/eventBus";

export type ThemeId = "mint" | "cream" | "lake" | "inkGreen" | "apricot" | "lavender" | "midnight";

export interface ThemePreset {
  id: ThemeId;
  name: string;
  desc: string;
  /** 主色（按钮 / 强调） */
  primary: string;
  /** 深色（标题 / 重点数字） */
  primaryDeep: string;
  /** 浅色（进度条 / 图表） */
  primaryLight: string;
  /** 极浅底（标签 / 按钮底） */
  primarySoft: string;
  /** 成长强调色 */
  accent: string;
  /** 页面背景 */
  bg: string;
  /** 次级卡片底 */
  cardSoft: string;
  /** Hero 卡渐变 */
  heroGradient: string;
  /** 进度条渐变 */
  progressGradient: string;
  /** 卡片阴影 */
  shadow: string;
  /** 风格标签，用于主题弹窗筛选 */
  tags: string[];
}

export const THEME_EVENT = "theme:change";
const THEME_STORAGE_KEY = "APP_THEME_V1";
export const DEFAULT_THEME_ID: ThemeId = "mint";

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "mint",
    name: "薄荷绿",
    desc: "默认 · 清新成长感",
    primary: "#3F8F72",
    primaryDeep: "#24584A",
    primaryLight: "#7CC6A0",
    primarySoft: "#E6F4EC",
    accent: "#7CC6A0",
    bg: "#F6FAF7",
    cardSoft: "#EFF8F3",
    heroGradient: "linear-gradient(135deg, #E6F4EC 0%, #F7FBF8 60%, #FFFFFF 100%)",
    progressGradient: "linear-gradient(90deg, #7CC6A0 0%, #3F8F72 100%)",
    shadow: "0 8rpx 28rpx rgba(36, 88, 74, 0.08)",
    tags: ["清新"],
  },
  {
    id: "cream",
    name: "奶油黄",
    desc: "暖色 · 温柔陪伴感",
    primary: "#B58A2E",
    primaryDeep: "#6B4F12",
    primaryLight: "#E6C062",
    primarySoft: "#FFF4D8",
    accent: "#F4C95D",
    bg: "#FFF9EE",
    cardSoft: "#FFF6DC",
    heroGradient: "linear-gradient(135deg, #FFF4D8 0%, #FFFBF0 60%, #FFFFFF 100%)",
    progressGradient: "linear-gradient(90deg, #F4C95D 0%, #B58A2E 100%)",
    shadow: "0 8rpx 28rpx rgba(107, 79, 18, 0.08)",
    tags: ["柔和", "活力"],
  },
  {
    id: "lake",
    name: "湖水蓝",
    desc: "冷静 · 专注沉浸感",
    primary: "#3D83A8",
    primaryDeep: "#24516B",
    primaryLight: "#8AB8D4",
    primarySoft: "#E8F1FB",
    accent: "#6FA8DC",
    bg: "#F4F8FB",
    cardSoft: "#EAF2FA",
    heroGradient: "linear-gradient(135deg, #E8F1FB 0%, #F4F8FB 60%, #FFFFFF 100%)",
    progressGradient: "linear-gradient(90deg, #6FA8DC 0%, #3D83A8 100%)",
    shadow: "0 8rpx 28rpx rgba(36, 81, 107, 0.08)",
    tags: ["沉稳", "清新"],
  },
  {
    id: "inkGreen",
    name: "墨绿成长",
    desc: "沉静 · 自律成长感",
    primary: "#356859",
    primaryDeep: "#1F5B4A",
    primaryLight: "#7FAA91",
    primarySoft: "#EAF5EF",
    accent: "#356859",
    bg: "#F5F7F2",
    cardSoft: "#F0F5F1",
    heroGradient: "linear-gradient(135deg, #1F5B4A 0%, #356859 58%, #4C806E 100%)",
    progressGradient: "linear-gradient(90deg, #7FAA91 0%, #356859 100%)",
    shadow: "0 12rpx 32rpx rgba(31, 91, 74, 0.10)",
    tags: ["沉稳"],
  },
  {
    id: "apricot",
    name: "奶油杏桃",
    desc: "温暖 · 轻盈治愈感",
    primary: "#E08A6B",
    primaryDeep: "#B5634A",
    primaryLight: "#F0B49A",
    primarySoft: "#FCEEE6",
    accent: "#F4A87E",
    bg: "#FFF7F3",
    cardSoft: "#FBEFE8",
    heroGradient: "linear-gradient(135deg, #FCEEE6 0%, #FFF7F3 60%, #FFFFFF 100%)",
    progressGradient: "linear-gradient(90deg, #F4A87E 0%, #E08A6B 100%)",
    shadow: "0 8rpx 28rpx rgba(181, 99, 74, 0.08)",
    tags: ["柔和", "活力"],
  },
  {
    id: "lavender",
    name: "雾灰紫",
    desc: "优雅 · 平衡柔和感",
    primary: "#8B7AA8",
    primaryDeep: "#5F4F78",
    primaryLight: "#B6A8CC",
    primarySoft: "#EFEAF6",
    accent: "#A99BC0",
    bg: "#F7F5FB",
    cardSoft: "#F1EDF7",
    heroGradient: "linear-gradient(135deg, #EFEAF6 0%, #F7F5FB 60%, #FFFFFF 100%)",
    progressGradient: "linear-gradient(90deg, #B6A8CC 0%, #8B7AA8 100%)",
    shadow: "0 8rpx 28rpx rgba(95, 79, 120, 0.08)",
    tags: ["柔和", "沉稳"],
  },
  {
    id: "midnight",
    name: "夜幕蓝绿",
    desc: "深邃 · 专注静谧感",
    primary: "#2E7376",
    primaryDeep: "#194548",
    primaryLight: "#5FA0A3",
    primarySoft: "#E1EDEE",
    accent: "#5FA0A3",
    bg: "#F2F6F6",
    cardSoft: "#E8EFEF",
    heroGradient: "linear-gradient(135deg, #E1EDEE 0%, #F2F6F6 60%, #FFFFFF 100%)",
    progressGradient: "linear-gradient(90deg, #5FA0A3 0%, #2E7376 100%)",
    shadow: "0 10rpx 30rpx rgba(25, 69, 72, 0.10)",
    tags: ["沉稳"],
  },
];

const THEME_MAP: Record<ThemeId, ThemePreset> = THEME_PRESETS.reduce(
  (acc, theme) => {
    acc[theme.id] = theme;
    return acc;
  },
  {} as Record<ThemeId, ThemePreset>
);

function isThemeId(value: unknown): value is ThemeId {
  return (
    value === "mint" ||
    value === "cream" ||
    value === "lake" ||
    value === "inkGreen" ||
    value === "apricot" ||
    value === "lavender" ||
    value === "midnight"
  );
}

export function getThemeById(id: ThemeId): ThemePreset {
  return THEME_MAP[id] || THEME_MAP[DEFAULT_THEME_ID];
}

export function getCurrentThemeId(): ThemeId {
  const value = wx.getStorageSync(THEME_STORAGE_KEY);
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function getCurrentTheme(): ThemePreset {
  return getThemeById(getCurrentThemeId());
}

/** 保存当前主题到 storage，并广播变更事件，全局生效 */
export function setCurrentTheme(id: ThemeId): ThemePreset {
  const theme = getThemeById(id);
  wx.setStorageSync(THEME_STORAGE_KEY, id);
  // 同步全局可见区（导航栏 / 后续可扩展为 page data-theme）
  try {
    wx.setNavigationBarColor({
      frontColor: "#000000",
      backgroundColor: theme.bg,
      animation: { duration: 200, timingFunc: "easeIn" },
    });
  } catch (e) {
    // 忽略导航栏同步失败
  }
  syncTabBar(theme);
  emit(THEME_EVENT, id);
  return theme;
}

/**
 * 生成绑定到「我的」页面根节点 style 的 CSS 变量字符串。
 * 通过覆盖 --profile-* 变量，使 Hero 卡 / 按钮 / 进度条 / 统计等实时跟随主题。
 */
export function themeToProfileCssVars(theme: ThemePreset): string {
  return [
    `--profile-primary: ${theme.primary}`,
    `--profile-deep: ${theme.primaryDeep}`,
    `--profile-primary-soft: ${theme.primarySoft}`,
    `--profile-primary-light: ${theme.primaryLight}`,
    `--profile-accent: ${theme.accent}`,
    `--profile-growth: ${theme.accent}`,
    `--profile-soft: ${theme.cardSoft}`,
    `--profile-bg: ${theme.bg}`,
    `--profile-shadow: ${theme.shadow}`,
    `--profile-hero-gradient: ${theme.heroGradient}`,
    `--profile-progress-gradient: ${theme.progressGradient}`,
  ].join(";");
}

/** 监听主题变更（返回取消函数） */
export function onThemeChange(handler: (id: ThemeId) => void): () => void {
  on(THEME_EVENT, handler as (payload?: any) => void);
  return () => off(THEME_EVENT, handler as (payload?: any) => void);
}

/**
 * 将当前主题应用到全局可见区域：
 *  - 同步导航栏背景色与文字色
 *  - 同步 app.json window.backgroundColor（运行期）
 *  - 触发 theme:change 事件，profile 等页面会自动响应
 *
 * 建议在 app.ts onLaunch 中调用一次以应用启动时的主题。
 */
export function applyGlobalTheme(id?: ThemeId): ThemeId {
  const themeId = id || getCurrentThemeId();
  const theme = getThemeById(themeId);
  try {
    // 1. 同步导航栏颜色
    wx.setNavigationBarColor({
      frontColor: theme.id === "cream" ? "#000000" : "#000000",
      backgroundColor: theme.bg,
      animation: { duration: 200, timingFunc: "easeIn" },
    });
  } catch (e) {
    // 忽略导航栏同步失败
  }
  syncTabBar(theme);
  return themeId;
}

function syncTabBar(theme: ThemePreset) {
  try {
    wx.setTabBarStyle({
      color: theme.id === "inkGreen" ? "#71827A" : "#9AA8A3",
      selectedColor: theme.primary,
      backgroundColor: "#FFFFFF",
      borderStyle: "white",
    });
  } catch (e) {
    // 非 tabBar 页面或基础库不支持时无需阻断主题切换
  }
}

type ThemedPageOptions = Record<string, any> & {
  data?: Record<string, any>;
  onLoad?: (...args: any[]) => any;
  onShow?: (...args: any[]) => any;
  onUnload?: (...args: any[]) => any;
};

/**
 * 为页面统一注入 appTheme，并在主题切换、页面返回时自动同步。
 * 页面根节点只需绑定 data-theme="{{appTheme}}"，不再各自维护主题逻辑。
 */
export function withAppTheme<T extends ThemedPageOptions>(options: T): T {
  const originalOnLoad = options.onLoad;
  const originalOnShow = options.onShow;
  const originalOnUnload = options.onUnload;

  return {
    ...options,
    data: {
      ...(options.data || {}),
      appTheme: getCurrentThemeId(),
    },
    onLoad(this: any, ...args: any[]) {
      if (this.__offAppTheme) this.__offAppTheme();
      this.__offAppTheme = onThemeChange((themeId) => {
        this.setData({ appTheme: themeId });
      });
      this.setData({ appTheme: getCurrentThemeId() });
      return originalOnLoad && originalOnLoad.apply(this, args);
    },
    onShow(this: any, ...args: any[]) {
      const themeId = getCurrentThemeId();
      this.setData({ appTheme: themeId });
      applyGlobalTheme(themeId);
      return originalOnShow && originalOnShow.apply(this, args);
    },
    onUnload(this: any, ...args: any[]) {
      if (this.__offAppTheme) {
        this.__offAppTheme();
        this.__offAppTheme = null;
      }
      return originalOnUnload && originalOnUnload.apply(this, args);
    },
  } as T;
}
