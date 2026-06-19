Page({
  data: {
    qrcodeUrl: "",
    loading: true,
  },

  onLoad() {
    this.loadLocalImage();
  },

  loadLocalImage() {
    wx.getImageInfo({
      src: "/images/community-qrcode.jpg",
      success: (res) => {
        this.setData({
          qrcodeUrl: res.path,
          loading: false,
        });
      },
      fail: () => {
        wx.showToast({
          title: "图片加载失败",
          icon: "none",
        });
        this.setData({ loading: false });
      },
    });
  },

  previewQrcode() {
    if (!this.data.qrcodeUrl) return;
    wx.previewImage({
      urls: [this.data.qrcodeUrl],
      current: this.data.qrcodeUrl,
    });
  },

  saveToAlbum() {
    if (!this.data.qrcodeUrl) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.qrcodeUrl,
      success: () => {
        wx.showToast({
          title: "已保存到相册",
          icon: "success",
        });
      },
      fail: () => {
        wx.showToast({
          title: "保存失败",
          icon: "none",
        });
      },
    });
  },
});
