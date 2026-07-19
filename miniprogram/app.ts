import { CLOUD_ENV_ID, initCloud } from "./config/cloud";
import { applyGlobalTheme } from "./services/theme";
import "./services/syncStatus";

App<IAppOption>({
  globalData: {
    cloudEnvId: CLOUD_ENV_ID,
  },

  onLaunch() {
    initCloud();
    // 同步发布版唯一配色到系统导航栏与 TabBar。
    applyGlobalTheme();
  },
});
