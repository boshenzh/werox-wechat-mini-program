const db = wx.cloud.database();
const { getRoleByOpenid } = require('../../utils/roles');

Page({
  data: {
    openid: '',
    role: 'user',
    isAllowed: false,
    form: {
      title: '',
      date: '',
      location: '',
      host: '',
      coverUrl: '',
      description: '',
      statusText: '即将开始',
      baseStrength: '',
      baseEndurance: '',
    },
  },

  onLoad() {
    this.initRole();
  },

  async initRole() {
    try {
      const { result } = await wx.cloud.callFunction({ name: 'getOpenId' });
      const openid = result && result.openid ? result.openid : '';
      if (!openid) {
        throw new Error('Missing openid');
      }
      const role = await this.resolveRole(openid);
      const isAllowed = role === 'admin';
      this.setData({ openid, role, isAllowed });
      if (!isAllowed) {
        wx.showToast({ title: '无权限操作', icon: 'none' });
      }
    } catch (err) {
      console.error('Role check failed', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async resolveRole(openid) {
    const res = await db.collection('users').where({ _openid: openid }).get();
    if (res.data && res.data.length > 0) {
      return res.data[0].role || getRoleByOpenid(openid);
    }
    return getRoleByOpenid(openid);
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    const key = `form.${field}`;
    this.setData({ [key]: value });
  },

  async seedEvents() {
    if (!this.data.isAllowed) {
      wx.showToast({ title: '无权限操作', icon: 'none' });
      return;
    }

    try {
      const { result } = await wx.cloud.callFunction({ name: 'importEventsStub' });
      wx.showToast({
        title: `赛事导入完成 (${result && result.inserted ? result.inserted : 0})`,
        icon: 'success',
      });
    } catch (err) {
      console.error('Seed events failed', err);
      wx.showToast({ title: '初始化失败', icon: 'none' });
    }
  },

  async importUsersStub() {
    if (!this.data.isAllowed) {
      wx.showToast({ title: '无权限操作', icon: 'none' });
      return;
    }
    try {
      const { result } = await wx.cloud.callFunction({ name: 'importUsersStub' });
      const inserted = result && typeof result.inserted === 'number' ? result.inserted : 0;
      const updated = result && typeof result.updated === 'number' ? result.updated : 0;
      wx.showToast({ title: `用户导入 ${inserted} 新增/${updated} 更新`, icon: 'success' });
    } catch (err) {
      console.error('Import users failed', err);
      wx.showToast({ title: '导入失败', icon: 'none' });
    }
  },

  async saveEvent() {
    if (!this.data.isAllowed) {
      wx.showToast({ title: '无权限操作', icon: 'none' });
      return;
    }

    const form = this.data.form;
    const payload = {
      title: form.title,
      date: form.date,
      location: form.location,
      host: form.host,
      coverUrl: form.coverUrl,
      description: form.description,
      statusText: form.statusText,
      baseStrength: Number(form.baseStrength || 0),
      baseEndurance: Number(form.baseEndurance || 0),
      createdAt: Date.now(),
    };

    try {
      await db.collection('events').add({ data: payload });
      wx.showToast({ title: '已发布', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    } catch (err) {
      console.error('Save event failed', err);
      wx.showToast({ title: '发布失败', icon: 'none' });
    }
  },

});
