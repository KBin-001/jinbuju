import { CLOUD_ENV_ID, initCloud } from "./config/cloud";

App<IAppOption>({
  globalData: {
    cloudEnvId: CLOUD_ENV_ID,
  },

  onLaunch() {
    initCloud();
  },
});
