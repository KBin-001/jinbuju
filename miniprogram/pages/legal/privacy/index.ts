import { withAppTheme } from "../../../services/theme";

/** 隐私政策页面展示数据 */
interface PrivacyPageData {
  version: string;
  effectiveDate: string;
  updatedAt: string;
  operator: string;
  contactEmail: string;
  dpoName: string;
  securityLogRetentionDays: number;
  showPendingNotice: boolean;
}

/**
 * 隐私政策元数据
 *
 * 上线前必须替换以下占位字段，并完成法务审核：
 * - operator：运营主体全称（与小程序备案一致）
 * - contactEmail：个人信息保护联系邮箱
 * - dpoName：个人信息保护负责人（可填岗位或姓名）
 * - effectiveDate / updatedAt：生效与更新日期
 * - version：语义化版本号，重大变更必须递增
 *
 * 占位字段使用方括号包裹以便通过全文检索快速定位。
 */
const PRIVACY_META: PrivacyPageData = {
  version: "privacy-2.0.0",
  effectiveDate: "【上线前请填写生效日期，如 2026-08-01】",
  updatedAt: "【上线前请填写更新日期】",
  operator: "【运营主体全称，与小程序备案一致】",
  contactEmail: "privacy@jinbuju.example",
  dpoName: "个人信息保护负责人",
  securityLogRetentionDays: 90,
  showPendingNotice: true,
};

Page(
  withAppTheme({
    data: PRIVACY_META,

    copyEmail() {
      wx.setClipboardData({
        data: PRIVACY_META.contactEmail,
        success: () => {
          wx.showToast({ title: "邮箱已复制", icon: "success" });
        },
      });
    },
  })
);
