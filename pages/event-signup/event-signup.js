const db = wx.cloud.database();

Page({
  data: {
    eventId: '',
    openid: '',
    event: null,
    profile: null,
    form: {
      groupType: '',
      partnerName: '',
      note: '',
    },
    groupOptions: ['未选择', '单人', '双人', '接力'],
    groupIndex: 0,
    loading: true,
    submitting: false,
    isSigned: false,
  },

  onLoad(query) {
    const eventId = query && query.id ? query.id : '';
    this.setData({ eventId });
    this.initPage();
  },

  async initPage() {
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'getOpenId' });
      const openid = result && result.openid ? result.openid : '';
      if (!openid) throw new Error('Missing openid');
      this.setData({ openid });

      await Promise.all([
        this.loadEvent(this.data.eventId),
        this.loadProfile(openid),
        this.checkSigned(openid),
      ]);
    } catch (err) {
      console.error('Init signup failed', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadEvent(eventId) {
    if (!eventId) return;
    const res = await db.collection('events').doc(eventId).get();
    const event = res.data || null;
    if (event) {
      this.setData({
        event: {
          id: event._id,
          title: event.title || '未命名赛事',
          dateText: event.date || event.dateText || '待定',
          location: event.location || '待定',
          price: event.price || 0,
          maxParticipants: event.maxParticipants || null,
        },
      });
    }
  },

  async loadProfile(openid) {
    const res = await db.collection('users').where({ _openid: openid }).get();
    if (res.data && res.data.length > 0) {
      this.setData({ profile: res.data[0] });
      return;
    }

    // Double-check to prevent race condition duplicates
    const recheck = await db.collection('users').where({ _openid: openid }).get();
    if (recheck.data && recheck.data.length > 0) {
      this.setData({ profile: recheck.data[0] });
      return;
    }

    const newProfile = {
      nickname: '',
      age: '',
      heartRate: '',
      bio: '',
      avatarFileId: '',
      wechatId: '',
      tags: [],
      sex: '',
      trainingFocus: '',
      hyroxExperience: '',
      partnerRole: '',
      partnerNote: '',
      mbti: '',
      role: 'user',
      _openid: openid, // Explicitly set _openid for consistency
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const addRes = await db.collection('users').add({ data: newProfile });
    this.setData({ profile: { ...newProfile, _id: addRes._id, _openid: openid } });
  },

  async checkSigned(openid) {
    if (!this.data.eventId) return;
    const res = await db
      .collection('event_participants')
      .where({ eventId: this.data.eventId, _openid: openid })
      .limit(1)
      .get();
    if (res.data && res.data.length > 0) {
      this.setData({ isSigned: true });
    }
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    const key = `form.${field}`;
    this.setData({ [key]: value });
  },

  handleGroupChange(e) {
    const index = Number(e.detail.value);
    const picked = this.data.groupOptions[index] || '';
    this.setData({
      groupIndex: index,
      'form.groupType': picked === '未选择' ? '' : picked,
    });
  },

  async handleSubmit() {
    if (this.data.submitting || this.data.isSigned) return;
    if (!this.data.event || !this.data.eventId) {
      wx.showToast({ title: '赛事不存在', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const countRes = await db
        .collection('event_participants')
        .where({ eventId: this.data.eventId })
        .count();
      const total = countRes.total || 0;
      if (this.data.event.maxParticipants && total >= Number(this.data.event.maxParticipants)) {
        wx.showToast({ title: '报名已满', icon: 'none' });
        return;
      }

      const dupRes = await db
        .collection('event_participants')
        .where({ eventId: this.data.eventId, _openid: this.data.openid })
        .limit(1)
        .get();
      if (dupRes.data && dupRes.data.length > 0) {
        wx.showToast({ title: '你已报名过', icon: 'none' });
        this.setData({ isSigned: true });
        return;
      }

      const profile = this.data.profile || {};
      const profileSnapshot = {
        nickname: profile.nickname || '',
        wechatId: profile.wechatId || '',
        sex: profile.sex || '',
        trainingFocus: profile.trainingFocus || '',
        hyroxExperience: profile.hyroxExperience || '',
        partnerRole: profile.partnerRole || '',
        partnerNote: profile.partnerNote || '',
        mbti: profile.mbti || '',
        avatarFileId: profile.avatarFileId || '',
        tags: profile.tags || [],
      };

      const payload = {
        eventId: this.data.eventId,
        eventTitle: this.data.event.title,
        eventDate: this.data.event.dateText,
        eventLocation: this.data.event.location,
        price: this.data.event.price || 0,
        maxParticipants: this.data.event.maxParticipants || null,
        profileSnapshot,
        eventForm: {
          groupType: this.data.form.groupType || '',
          partnerName: this.data.form.partnerName || '',
          note: this.data.form.note || '',
        },
        createdAt: Date.now(),
      };

      await db.collection('event_participants').add({ data: payload });
      wx.showToast({ title: '报名成功', icon: 'success' });
      this.setData({ isSigned: true });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      console.error('Signup failed', err);
      wx.showToast({ title: '报名失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
