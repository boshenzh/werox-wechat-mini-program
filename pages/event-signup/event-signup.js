const { getMe, getEventDetail, getMyRegistration, createRegistration } = require('../../utils/api');
const { track } = require('../../utils/analytics');

Page({
  data: {
    eventId: null,
    event: null,
    profile: null,
    form: {
      division: '',
      teamName: '',
      note: '',
    },
    divisionOptions: ['未选择'],
    divisionIndex: 0,
    loading: true,
    submitting: false,
    isSigned: false,
  },

  onLoad(query) {
    const eventId = query && query.id ? Number(query.id) : null;
    this.setData({ eventId });
    track('signup_page_open', { event_id: Number.isFinite(eventId) ? String(eventId) : '' });
    this.initPage();
  },

  async initPage() {
    this.setData({ loading: true });
    try {
      await Promise.all([
        this.loadEvent(this.data.eventId),
        this.loadProfile(),
        this.checkSigned(),
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
    try {
      const detail = await getEventDetail(eventId);
      const event = detail && detail.event ? detail.event : null;
      if (!event) return;

      let divisions = event.available_divisions || [];
      if (typeof divisions === 'string') {
        try {
          divisions = JSON.parse(divisions);
        } catch (e) {
          divisions = [];
        }
      }

      const divisionOptions = ['未选择', ...divisions];

      this.setData({
        event: {
          id: event.id,
          title: event.title || '未命名赛事',
          dateText: event.event_date || '待定',
          location: event.location || '待定',
          priceOpen: event.price_open || 0,
          priceDoubles: event.price_doubles || 0,
          priceRelay: event.price_relay || 0,
          maxParticipants: event.max_participants || null,
          formatMode: event.format_mode || 'for_time',
        },
        divisionOptions,
      });
    } catch (err) {
      console.error('Load event failed', err);
    }
  },

  async loadProfile() {
    try {
      const me = await getMe();
      this.setData({ profile: me && me.profile ? me.profile : null });
    } catch (err) {
      console.error('Load profile failed', err);
    }
  },

  async checkSigned() {
    if (!this.data.eventId) return;
    try {
      const result = await getMyRegistration(this.data.eventId);
      this.setData({ isSigned: !!(result && result.is_signed) });
    } catch (err) {
      console.error('Check signed failed', err);
    }
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    const key = `form.${field}`;
    this.setData({ [key]: value });
  },

  handleDivisionChange(e) {
    const index = Number(e.detail.value);
    const picked = this.data.divisionOptions[index] || '';
    this.setData({
      divisionIndex: index,
      'form.division': picked === '未选择' ? '' : picked,
    });
  },

  async handleSubmit() {
    if (this.data.submitting || this.data.isSigned) return;
    if (!this.data.event || !this.data.eventId) {
      wx.showToast({ title: '赛事不存在', icon: 'none' });
      return;
    }

    if (!this.data.form.division) {
      wx.showToast({ title: '请选择组别', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    track('signup_submit', {
      event_id: String(this.data.eventId),
      division: this.data.form.division || '',
    });

    try {
      await createRegistration(this.data.eventId, {
        division: this.data.form.division,
        team_name: this.data.form.teamName || '',
        note: this.data.form.note || '',
      });

      wx.showToast({ title: '报名成功', icon: 'success' });
      this.setData({ isSigned: true });
      track('signup_success', {
        event_id: String(this.data.eventId),
        division: this.data.form.division || '',
      });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      console.error('Signup failed', err);
      track('signup_fail', {
        event_id: String(this.data.eventId),
        reason: (err && err.message) || '',
      });
      wx.showToast({ title: err.message || '报名失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
