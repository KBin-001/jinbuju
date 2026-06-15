import {
  getMyTeam,
  joinTeam as requestJoinTeam,
  sendEncouragement,
  TeamServiceError,
} from "../../services/team";
import {
  EncouragementType,
  TeamMemberSummary,
  TeamPageData,
  TeamSummary,
} from "../../types/team";

type PageStatus = "loading" | "empty" | "error" | "ready";

interface MemberActionEvent {
  currentTarget: {
    dataset: {
      memberId?: string;
    };
  };
}

interface EncouragementOption {
  type: EncouragementType;
  label: string;
}

interface TeamMemberView extends TeamMemberSummary {
  avatarDisplay: string;
  todayStatusText: string;
}

const DEFAULT_AVATAR = "/images/icons/usercenter.png";
const CATEGORY_LABELS: Record<string, string> = {
  exam: "考试备考",
  skill: "技能学习",
  career: "求职提升",
};
const ENCOURAGEMENT_OPTIONS: EncouragementOption[] = [
  { type: "keep_going", label: "今天也要加油" },
  { type: "very_stable", label: "你太稳了" },
  { type: "continue_tomorrow", label: "明天继续" },
  { type: "stay_together", label: "一起坚持" },
];

function formatDateRange(startDate: string, endDate: string): string {
  const format = (value: string): string => {
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
      return value;
    }
    return `${parts[1]} 月 ${parts[2]} 日`;
  };
  return `${format(startDate)} 至 ${format(endDate)}`;
}

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
    errorCode: "",
    team: null as TeamSummary | null,
    members: [] as TeamMemberView[],
    categoryLabel: "",
    stageDateRange: "",
    joining: false,
    encouragingMemberId: "",
  },

  onShow() {
    this.loadTeam();
  },

  loadTeam() {
    this.setData({
      status: "loading",
      errorMessage: "",
      errorCode: "",
    });
    getMyTeam()
      .then((data: TeamPageData) => {
        if (!data.team) {
          this.setData({
            status: "empty",
            team: null,
            members: [],
          });
          return;
        }
        const members = data.members.map((member) => ({
          ...member,
          avatarDisplay: member.avatarUrl || DEFAULT_AVATAR,
          todayStatusText: member.todayRest
            ? "今日休息"
            : member.todayCompleted
              ? "今天已完成"
              : "今天未记录",
        }));
        this.setData({
          status: "ready",
          team: data.team,
          members,
          categoryLabel: CATEGORY_LABELS[data.team.goalCategory] || "成长行动",
          stageDateRange: formatDateRange(
            data.team.stageStartDate,
            data.team.stageEndDate,
          ),
          joining: false,
          encouragingMemberId: "",
        });
      })
      .catch((error: Error) => {
        const serviceError = error as TeamServiceError;
        this.setData({
          status: "error",
          errorCode: serviceError.code || "INTERNAL_ERROR",
          errorMessage: serviceError.message || "小队信息加载失败，请稍后重试。",
          joining: false,
          encouragingMemberId: "",
        });
      });
  },

  retry() {
    if (this.data.status !== "loading") this.loadTeam();
  },

  joinTeam() {
    if (this.data.joining) return;
    this.setData({ joining: true });
    requestJoinTeam()
      .then(() => {
        wx.showToast({
          title: "已加入行动小队",
          icon: "success",
        });
        this.loadTeam();
      })
      .catch((error: Error) => {
        const serviceError = error as TeamServiceError;
        this.setData({ joining: false });
        wx.showModal({
          title: "暂时无法加入",
          content: serviceError.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },

  chooseEncouragement(event: MemberActionEvent) {
    const memberId = String(event.currentTarget.dataset.memberId || "");
    const member = this.data.members.find(
      (item: TeamMemberView) => item.id === memberId,
    );
    if (
      !member ||
      member.isSelf ||
      member.encouragedByMeToday ||
      this.data.encouragingMemberId
    ) {
      return;
    }

    wx.showActionSheet({
      itemList: ENCOURAGEMENT_OPTIONS.map((option) => option.label),
      success: (result: { tapIndex: number }) => {
        const option = ENCOURAGEMENT_OPTIONS[result.tapIndex];
        if (option) this.submitEncouragement(memberId, option.type);
      },
    });
  },

  submitEncouragement(memberId: string, type: EncouragementType) {
    if (this.data.encouragingMemberId) return;
    this.setData({ encouragingMemberId: memberId });
    sendEncouragement({ memberId, type })
      .then(() => {
        wx.showToast({
          title: "鼓励已送达",
          icon: "none",
        });
        this.loadTeam();
      })
      .catch((error: Error) => {
        const serviceError = error as TeamServiceError;
        if (serviceError.code === "ENCOURAGEMENT_ALREADY_SENT") {
          wx.showToast({
            title: "今天已经鼓励过了",
            icon: "none",
          });
          this.loadTeam();
          return;
        }
        this.setData({ encouragingMemberId: "" });
        wx.showModal({
          title: "鼓励没有送达",
          content: serviceError.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },
});
