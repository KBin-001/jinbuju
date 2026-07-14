import { APP_VERSION } from "../../config/app";
import { withAppTheme } from "../../services/theme";

Page(withAppTheme({
  data: {
    version: APP_VERSION,
  },

  openPrivacy() {
    wx.navigateTo({ url: "/pages/legal/privacy/index" });
  },

  openTerms() {
    wx.navigateTo({ url: "/pages/legal/terms/index" });
  },
}));
