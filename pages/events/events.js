const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    events: [],
    photosByEvent: {},
    loading: false,
  },

  onLoad() {
    this.loadEvents();
  },

  async onPullDownRefresh() {
    await this.loadEvents();
    wx.stopPullDownRefresh();
  },

  async loadEvents() {
    this.setData({ loading: true });
    try {
      const res = await db.collection('events').orderBy('date', 'asc').get();
      let events = [];
      if (res.data && res.data.length > 0) {
        events = res.data.map((event) => ({
          id: event._id,
          title: event.title || '未命名赛事',
          location: event.location || '待定',
          dateText: event.date || event.dateText || '待定',
          coverUrl: event.coverUrl || '',
          description: event.description || '赛事信息待更新。',
          statusText: event.statusText || '即将开始',
          baseStrength: event.baseStrength || 0,
          baseEndurance: event.baseEndurance || 0,
        }));
      }

      const photosByEvent = {};
      events.forEach((event) => {
        photosByEvent[event.id] = [];
      });

      this.setData({ events, photosByEvent });
    } catch (err) {
      console.error('Load events failed', err);
      this.setData({ events: [], photosByEvent: {} });
      wx.showToast({ title: '赛事加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goDetail(e) {
    const eventId = e.currentTarget.dataset.eventId;
    if (!eventId) return;
    const event = this.data.events.find((item) => item.id === eventId);
    if (event) {
      app.globalData.currentEvent = event;
    }
    wx.navigateTo({ url: `/pages/event-detail/event-detail?id=${eventId}` });
  },

  previewPhoto(e) {
    const eventId = e.currentTarget.dataset.eventId;
    const current = e.currentTarget.dataset.url;
    const photos = this.data.photosByEvent[eventId] || [];
    const urls = photos.map((photo) => photo.fileID);

    if (urls.length === 0) return;
    wx.previewImage({ current, urls });
  },

});
