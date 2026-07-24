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
  },
});
