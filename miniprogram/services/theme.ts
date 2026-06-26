/**
 * 进步局 · 主题皮肤服务
 * ------------------------------------------------
 * 提供 3 套低压力主题：薄荷绿（默认）/ 奶油黄 / 湖水蓝
 * - 当前主题持久化到本地 storage
 * - 通过 eventBus 广播 "theme:change" 事件，便于其它页面在 onShow 时同步
 * - themeToProfileCssVars() 生成可绑定到页面根节点 style 的 CSS 变量字符串
 */

import { emit, on, off } from "../utils/eventBus";

export type ThemeId = "mint" | "cream" | "lake";

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
  return value === "mint" || value === "cream" || value === "lake";
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
