import { getCachedTeam } from "../../services/team";

interface InviteAvatar { id: string; avatar: string; extraText: string }

Page({
  data: {
    roomCode: "",
    teamName: "进步小队",
    memberCount: 0,
    maxMembers: 0,
    memberCapacityText: "0人",
    inviterMemberId: "",
    avatars: [] as InviteAvatar[],
  },

  onLoad(query: Record<string, string>) {
    const roomCode = String(query.roomCode || "").trim().toUpperCase();
    const inviterMemberId = String(query.inviterMemberId || "").trim().slice(0, 80);
    const cached = getCachedTeam();
    const team = cached.team && cached.team.roomCode === roomCode ? cached.team : null;
    const members = team ? cached.members : [];
    const avatars: InviteAvatar[] = members.slice(0, 4).map((member) => ({ id: member.id, avatar: member.avatar || "", extraText: "" }));
    if (members.length > 4) avatars.push({ id: "extra", avatar: "", extraText: `+${members.length - 4}` });
    const memberCount = team?.memberCount || members.length;
    const maxMembers = team?.maxMembers || 0;
    this.setData({
      roomCode,
      inviterMemberId,
      teamName: team?.name || "进步小队",
      memberCount,
      maxMembers,
      memberCapacityText: maxMembers ? `${memberCount}/${maxMembers}人` : `${memberCount}人`,
      avatars,
    });
  },

  onShareAppMessage() {
    return {
      title: `${this.data.teamName} 邀请你一起行动`,
      path: `/pages/team/index?roomCode=${encodeURIComponent(this.data.roomCode)}&from=invite&inviterMemberId=${encodeURIComponent(this.data.inviterMemberId)}`,
    };
  },

  copyRoomCode() {
    wx.setClipboardData({ data: this.data.roomCode, success: () => wx.showToast({ title: "房间号已复制", icon: "success" }) });
  },

  copyGroupText() {
    const text = `邀请你加入「${this.data.teamName}」\n房间号：${this.data.roomCode}\n打开进步局，在小队页输入房间号即可加入。`;
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: "群邀请文案已复制", icon: "success" }) });
  },

  onAvatarError(event: { currentTarget: { dataset: { index?: number } } }) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < this.data.avatars.length) {
      this.setData({ [`avatars[${index}].avatar`]: "" });
    }
  },

});
