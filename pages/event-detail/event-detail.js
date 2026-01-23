const app = getApp();

const FALLBACK_EVENT = {
  id: 'shenzhen-2026',
  title: 'Werox 深圳站',
  location: '深圳 · Werox 中心',
  dateText: '2026-01-27',
  coverUrl: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1200&q=60',
  description: '在 Werox 中心完成 Hyrox 标准赛制挑战，包含力量区与跑步轮换。',
  statusText: '即将开始',
  highlights: ['标准赛制 8 轮挑战', '观众区与补给区', '现场摄影师全程记录'],
};

Page({
  data: {
    event: FALLBACK_EVENT,
  },

  onLoad(query) {
    const globalEvent = app.globalData.currentEvent;
    const eventId = query && query.id ? query.id : '';
    if (globalEvent && (!eventId || globalEvent.id === eventId)) {
      this.setData({ event: { ...FALLBACK_EVENT, ...globalEvent } });
    }
  },

  handleRegister() {
    wx.showToast({ title: '报名入口开发中', icon: 'none' });
  },

  handleUpload() {
    wx.showToast({ title: '照片上传功能开发中', icon: 'none' });
  },
});
