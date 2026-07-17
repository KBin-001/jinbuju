export interface TabHeaderLayout {
  menuTop: number;
  menuHeight: number;
  headerHeight: number;
}

/**
 * 四个主 Tab 共用同一套状态栏与微信胶囊避让规则。
 * 标题与胶囊垂直居中，Header 底部保留与胶囊顶部相近的呼吸空间。
 */
export function getTabHeaderLayout(): TabHeaderLayout {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || 0;
    const menuTop = Math.max(statusBarHeight, menu.top || 0);
    const menuHeight = menu.height || 32;
    const capsuleGap = Math.max(8, menuTop - statusBarHeight);

    return {
      menuTop,
      menuHeight,
      headerHeight: menuTop + menuHeight + capsuleGap,
    };
  } catch (_) {
    return { menuTop: 28, menuHeight: 32, headerHeight: 68 };
  }
}
