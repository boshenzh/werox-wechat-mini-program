const app = getApp();
const db = wx.cloud.database();

const MAX_DISPLAY_PARTICIPANTS = 5;

Page({
  data: {
    event: null,
    participants: [],
    displayParticipants: [],
    showAllParticipants: false,
    loading: true,
    isFull: false,
  },

  onLoad(query) {
    const eventId = query && query.id ? query.id : '';
    this.loadEvent(eventId);
  },

  async loadEvent(eventId) {
    this.setData({ loading: true });
    try {
      let eventData = null;
      if (eventId) {
        const res = await db.collection('events').doc(eventId).get();
        eventData = res.data || null;
      }

      if (!eventData) {
        const globalEvent = app.globalData.currentEvent;
        if (globalEvent) {
          eventData = globalEvent;
        }
      }

      if (!eventData) {
        this.setData({ event: null, participants: [], displayParticipants: [], loading: false, isFull: false });
        return;
      }

      const event = {
        id: eventData._id || eventData.id || '',
        title: eventData.title || '未命名赛事',
        location: eventData.location || '待定',
        dateText: eventData.date || eventData.dateText || '待定',
        coverUrl: eventData.coverUrl || '',
        posterUrl: eventData.posterUrl || '',
        description: eventData.description || '赛事信息待更新。',
        statusText: eventData.statusText || '即将开始',
        highlights: eventData.highlights || [],
        maxParticipants: eventData.maxParticipants || null,
        price: eventData.price || 0,
      };

      this.setData({ event });
      await this.loadParticipants(event.id, event.maxParticipants);
    } catch (err) {
      console.error('Load event failed', err);
      wx.showToast({ title: '赛事加载失败', icon: 'none' });
      this.setData({ event: null, participants: [], displayParticipants: [], loading: false, isFull: false });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadParticipants(eventId, maxParticipants) {
    if (!eventId) return;
    try {
      const res = await db
        .collection('event_participants')
        .where({ eventId })
        .orderBy('createdAt', 'desc')
        .get();
      const list = (res.data || []).map((item) => {
        const snapshot = item.profileSnapshot || {};
        return {
          _id: item._id,
          nickname: snapshot.nickname || '未命名选手',
          avatarFileId: snapshot.avatarFileId || '',
          trainingFocus: snapshot.trainingFocus || '',
          groupType: item.eventForm ? item.eventForm.groupType : '',
        };
      });
      const isFull = maxParticipants ? list.length >= Number(maxParticipants) : false;
      const displayParticipants = list.slice(0, MAX_DISPLAY_PARTICIPANTS);
      this.setData({ participants: list, displayParticipants, isFull, showAllParticipants: false });
    } catch (err) {
      console.error('Load participants failed', err);
      this.setData({ participants: [], displayParticipants: [], isFull: false });
    }
  },

  toggleParticipants() {
    this.setData({
      showAllParticipants: !this.data.showAllParticipants,
    });
  },

  handleRegister() {
    if (!this.data.event || !this.data.event.id) return;
    if (this.data.isFull) {
      wx.showToast({ title: '报名已满', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/event-signup/event-signup?id=${this.data.event.id}` });
  },

  handleUpload() {
    wx.showToast({ title: '照片上传功能开发中', icon: 'none' });
  },
});
