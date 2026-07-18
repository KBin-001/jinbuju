// 客户端不绑定具体环境 ID，由微信开发者工具/发布版本所关联的默认云环境决定。
// 这样开发、体验与生产版本不会因源码常量而误连同一个环境。
export const CLOUD_ENV_ID = "";

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
