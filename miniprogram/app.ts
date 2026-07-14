import { CLOUD_ENV_ID, initCloud } from "./config/cloud";
import { applyGlobalTheme } from "./services/theme";
import "./services/syncStatus";

App<IAppOption>({
  globalData: {
    cloudEnvId: CLOUD_ENV_ID,
  },

  onLaunch() {
    initCloud();
    // 启动时应用本地存储中的主题（同步导航栏颜色等）
    applyGlobalTheme();
  },
});
