import { CLOUD_ENV_ID, initCloud } from "./config/cloud";
import { applyGlobalTheme } from "./services/theme";
import { bootstrapAccount } from "./services/account";
import "./services/syncStatus";

App<IAppOption>({
  globalData: {
    cloudEnvId: CLOUD_ENV_ID,
  },

  onLaunch() {
    initCloud();
    // 账号资料在应用启动时后台恢复；页面可先同步读取缓存，再接收云端刷新事件。
    bootstrapAccount().catch(() => undefined);
    // 同步发布版唯一配色到系统导航栏与 TabBar。
    applyGlobalTheme();
    // 加载 Inter SemiBold 网络字体供全项目数字排版使用；失败时静默回退到系统字体。
    wx.loadFontFace({
      family: "Inter",
      source: 'url("https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-600-normal.woff2")',
      global: true,
      scopes: ["webView"],
      fail: () => undefined,
    });
  },
});
