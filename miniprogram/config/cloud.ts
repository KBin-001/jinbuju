export const CLOUD_ENV_ID = "ai-d3g9qsay37da6a3cc";

export function initCloud(): void {
  if (!wx.cloud) {
    console.error("当前基础库不支持云开发，请升级至 2.2.3 或以上版本");
    return;
  }

  const options: { traceUser: boolean; env?: string } = {
    traceUser: true,
  };

  if (CLOUD_ENV_ID) {
    options.env = CLOUD_ENV_ID;
  }

  wx.cloud.init(options);

  if (!CLOUD_ENV_ID) {
    console.info("CloudBase 已使用当前小程序关联的默认环境初始化");
  }
}
