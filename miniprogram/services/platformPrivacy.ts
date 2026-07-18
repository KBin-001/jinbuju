export function requirePlatformPrivacyAuthorization(): Promise<void> {
  const requirePrivacyAuthorize = (wx as any).requirePrivacyAuthorize;
  if (typeof requirePrivacyAuthorize !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    requirePrivacyAuthorize({
      success: () => resolve(),
      fail: (error: { errMsg?: string }) => reject(Object.assign(
        new Error("请先同意微信隐私保护指引，再使用头像或手机号功能。"),
        { code: "PLATFORM_PRIVACY_REQUIRED", cause: error },
      )),
    });
  });
}
