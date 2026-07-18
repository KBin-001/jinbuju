import { withAppTheme } from "../../../services/theme";

/** 用户协议页面展示数据 */
interface TermsPageData {
  version: string;
  effectiveDate: string;
  updatedAt: string;
  operator: string;
  contactEmail: string;
  showPendingNotice: boolean;
}

/**
 * 用户协议元数据
 *
 * 上线前必须替换以下占位字段，并完成专业法律审核：
 * - operator：运营主体全称（与小程序备案一致，决定管辖法院）
 * - contactEmail：用户联系邮箱
 * - effectiveDate / updatedAt：生效与更新日期
 * - version：语义化版本号，重大变更必须递增
 *
 * 占位字段使用方括号包裹以便通过全文检索快速定位。
 */
const TERMS_META: TermsPageData = {
  version: "terms-2.0.0",
  effectiveDate: "【上线前请填写生效日期，如 2026-08-01】",
  updatedAt: "【上线前请填写更新日期】",
  operator: "【运营主体全称，与小程序备案一致】",
  contactEmail: "support@jinbuju.example",
  showPendingNotice: true,
};

Page(
  withAppTheme({
    data: TERMS_META,

    copyEmail() {
      wx.setClipboardData({
        data: TERMS_META.contactEmail,
        success: () => {
          wx.showToast({ title: "邮箱已复制", icon: "success" });
        },
      });
    },
  })
);
