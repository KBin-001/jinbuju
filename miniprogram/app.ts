import { CLOUD_ENV_ID, initCloud } from "./config/cloud";
import { applyGlobalTheme } from "./services/theme";
import { bootstrapAccount } from "./services/account";

App<IAppOption>({
  globalData: {
    cloudEnvId: CLOUD_ENV_ID,
  },

  onLaunch() {
    initCloud();
    bootstrapAccount().catch((error) => {
      console.error("[account] bootstrap failed", { code: error?.code || "NETWORK_ERROR" });
    });
    // 启动时应用本地存储中的主题（同步导航栏颜色等）
    applyGlobalTheme();
  },
});
