import { APP_VERSION } from "../../config/app";
import { withAppTheme } from "../../services/theme";

Page(withAppTheme({
  data: {
    version: APP_VERSION,
  },
}));
