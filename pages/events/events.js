const app = getApp();
const db = wx.cloud.database();

const STUB_EVENT = {
  id: 'shenzhen-2026',
  title: 'Werox 深圳站',
  location: '深圳 · Werox 中心',
  dateText: '2026-01-27',
  coverUrl: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=900&q=60',
  description: '在 Werox 中心完成 Hyrox 标准赛制挑战，欢迎拍照分享你的成绩。',
  statusText: '即将开始',
};

Page({
  data: {
    events: [],
    photosByEvent: {},
    loading: false,
    showWechatModal: false,
    wechatIdInput: '',
    modalLoading: false,
    modalEvent: null,
  },

  onLoad() {
    this.loadEvents();
  },

  async loadEvents() {
    this.setData({ loading: true });
    try {
      const res = await db.collection('events').orderBy('date', 'asc').get();
      let events = [];
      if (res.data && res.data.length > 0) {
        events = res.data.map((event) => ({
          id: event._id,
          title: event.title || STUB_EVENT.title,
          location: event.location || STUB_EVENT.location,
          dateText: event.date || event.dateText || STUB_EVENT.dateText,
          coverUrl: event.coverUrl || STUB_EVENT.coverUrl,
          description: event.description || STUB_EVENT.description,
          statusText: event.statusText || STUB_EVENT.statusText,
          baseStrength: event.baseStrength || 0,
          baseEndurance: event.baseEndurance || 0,
        }));
      } else {
        events = [STUB_EVENT];
      }

      const photosByEvent = {};
      events.forEach((event) => {
        photosByEvent[event.id] = [];
      });

      this.setData({ events, photosByEvent });
      this.maybeShowWechatModal(events);
    } catch (err) {
      console.error('Load events failed', err);
      this.setData({ events: [STUB_EVENT], photosByEvent: { [STUB_EVENT.id]: [] } });
      this.maybeShowWechatModal([STUB_EVENT]);
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

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  maybeShowWechatModal(events) {
    const dismissedAt = wx.getStorageSync('weroxWechatModalDismissed');
    const completedAt = wx.getStorageSync('weroxWechatModalCompleted');
    if (dismissedAt || completedAt) return;
    const event = events && events.length ? events[0] : null;
    if (!event || !this.isEventSoon(event.dateText)) return;
    this.setData({
      showWechatModal: true,
      modalEvent: {
        title: event.title,
        dateText: event.dateText,
        location: event.location,
      },
    });
  },

  isEventSoon(dateText) {
    if (!dateText) return true;
    const parts = String(dateText).split(/[-/]/);
    if (parts.length < 3) return true;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) return true;
    const eventDate = new Date(year, month - 1, day, 12);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const diffDays = Math.round((eventDate - today) / 86400000);
    return diffDays <= 7 && diffDays >= -1;
  },

  handleWechatInput(e) {
    this.setData({ wechatIdInput: e.detail.value });
  },

  handleWechatSkip() {
    wx.setStorageSync('weroxWechatModalDismissed', Date.now());
    this.setData({ showWechatModal: false });
  },

  async handleWechatConfirm() {
    const wechatId = (this.data.wechatIdInput || '').trim();
    if (!wechatId) {
      wx.showToast({ title: '请输入微信号', icon: 'none' });
      return;
    }
    if (this.data.modalLoading) return;
    this.setData({ modalLoading: true });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'getOpenId' });
      const openid = result && result.openid ? result.openid : '';
      if (!openid) {
        throw new Error('Missing openid');
      }

      const userRes = await db.collection('users').where({ _openid: openid }).get();
      let currentDoc = userRes.data && userRes.data.length ? userRes.data[0] : null;

      if (!currentDoc) {
        const newProfile = {
          nickname: '',
          age: '',
          heartRate: '',
          bio: '',
          avatarFileId: '',
          wechatId,
          tags: [],
          role: 'user',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const addRes = await db.collection('users').add({ data: newProfile });
        currentDoc = { _id: addRes._id, ...newProfile };
      }

      const matchRes = await db.collection('users').where({ wechatId }).get();
      const matches = matchRes.data || [];
      const matched =
        matches.find((doc) => doc._openid && doc._openid !== openid) ||
        matches.find((doc) => !doc._openid) ||
        matches[0];

      if (matched && matched._openid && matched._openid !== openid) {
        wx.showToast({ title: '该微信号已绑定', icon: 'none' });
        return;
      }

      const merged = {
        wechatId,
        updatedAt: Date.now(),
        nickname: currentDoc.nickname || (matched && matched.nickname) || '',
        age: currentDoc.age || (matched && matched.age) || '',
        heartRate: currentDoc.heartRate || (matched && matched.heartRate) || '',
        bio: currentDoc.bio || (matched && matched.bio) || '',
        avatarFileId: currentDoc.avatarFileId || (matched && matched.avatarFileId) || '',
        tags:
          currentDoc.tags && currentDoc.tags.length
            ? currentDoc.tags
            : (matched && matched.tags) || [],
      };

      await db.collection('users').doc(currentDoc._id).update({ data: merged });
      wx.setStorageSync('weroxWechatModalCompleted', Date.now());
      this.setData({ showWechatModal: false });
      wx.showToast({ title: '已绑定微信号', icon: 'success' });
    } catch (err) {
      console.error('Bind wechat id failed', err);
      wx.showToast({ title: '绑定失败', icon: 'none' });
    } finally {
      this.setData({ modalLoading: false });
    }
  },
});
