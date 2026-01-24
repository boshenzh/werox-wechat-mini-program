const db = wx.cloud.database();
const { getRoleByOpenid } = require('../../utils/roles');

Page({
  data: {
    openid: '',
    role: 'user',
    isAllowed: false,
    events: [],
    editingId: '',
    statusOptions: ['即将开始', '报名中', '进行中', '已结束'],
    statusIndex: 0,
    form: {
      title: '',
      slug: '',
      date: '',
      location: '',
      host: '',
      coverUrl: '',
      posterUrl: '',
      description: '',
      statusText: '即将开始',
      baseStrength: 5,
      baseEndurance: 5,
      maxParticipants: '',
      price: '',
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
        return;
      }
      await this.loadEvents();
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

  handleDateChange(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  handleStatusChange(e) {
    const index = Number(e.detail.value);
    const status = this.data.statusOptions[index];
    this.setData({
      statusIndex: index,
      'form.statusText': status,
    });
  },

  handleSliderChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },

  async loadEvents() {
    try {
      const res = await db.collection('events').orderBy('date', 'asc').get();
      this.setData({ events: res.data || [] });
    } catch (err) {
      console.error('Load events failed', err);
      wx.showToast({ title: '赛事加载失败', icon: 'none' });
    }
  },

  startEdit(e) {
    const id = e.currentTarget.dataset.id;
    const event = this.data.events.find((item) => item._id === id);
    if (!event) return;

    // Find status index
    const statusIndex = this.data.statusOptions.indexOf(event.statusText || '即将开始');

    this.setData({
      editingId: id,
      statusIndex: statusIndex >= 0 ? statusIndex : 0,
      form: {
        title: event.title || '',
        slug: event.slug || '',
        date: event.date || event.dateText || '',
        location: event.location || '',
        host: event.host || '',
        coverUrl: event.coverUrl || '',
        posterUrl: event.posterUrl || '',
        description: event.description || '',
        statusText: event.statusText || '即将开始',
        baseStrength: event.baseStrength || 5,
        baseEndurance: event.baseEndurance || 5,
        maxParticipants: event.maxParticipants || '',
        price: event.price || '',
      },
    });
  },

  resetForm() {
    this.setData({
      editingId: '',
      statusIndex: 0,
      form: {
        title: '',
        slug: '',
        date: '',
        location: '',
        host: '',
        coverUrl: '',
        posterUrl: '',
        description: '',
        statusText: '即将开始',
        baseStrength: 5,
        baseEndurance: 5,
        maxParticipants: '',
        price: '',
      },
    });
  },

  // Generate slug from title and date for deduplication
  generateSlug(title, date) {
    const normalizedTitle = (title || '')
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const normalizedDate = (date || '').replace(/[^\d]/g, '');
    return `${normalizedTitle}-${normalizedDate}`;
  },

  async deleteEvent(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '删除赛事',
        content: '删除后不可恢复，是否继续？',
        confirmText: '删除',
        cancelText: '取消',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;

    wx.showLoading({ title: '删除中...' });

    try {
      console.log('Deleting event:', id);
      await db.collection('events').doc(id).remove();
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      if (this.data.editingId === id) {
        this.resetForm();
      }
      this.loadEvents();
    } catch (err) {
      wx.hideLoading();
      console.error('Delete event failed', err);
      // Show more detailed error message
      const errMsg = err.errMsg || err.message || '删除失败';
      if (errMsg.includes('permission') || errMsg.includes('Write permission')) {
        wx.showModal({
          title: '权限不足',
          content: '请在 CloudBase 控制台设置 events 集合的安全规则，允许管理员删除操作。',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: '删除失败', icon: 'none' });
      }
    }
  },

  async exportParticipants(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    try {
      wx.showLoading({ title: '生成中...' });
      const { result } = await wx.cloud.callFunction({
        name: 'exportEventParticipants',
        data: { eventId: id },
      });
      const fileID = result && result.fileID;
      if (!fileID) {
        wx.showToast({ title: '导出失败', icon: 'none' });
        return;
      }
      const tempRes = await wx.cloud.getTempFileURL({ fileList: [fileID] });
      const tempUrl = tempRes.fileList && tempRes.fileList[0] ? tempRes.fileList[0].tempFileURL : '';
      if (!tempUrl) {
        wx.showToast({ title: '导出失败', icon: 'none' });
        return;
      }
      const downloadRes = await wx.downloadFile({ url: tempUrl });
      if (downloadRes.statusCode !== 200) {
        wx.showToast({ title: '下载失败', icon: 'none' });
        return;
      }
      await wx.openDocument({ filePath: downloadRes.tempFilePath, showMenu: true });
    } catch (err) {
      console.error('Export participants failed', err);
      wx.showToast({ title: '导出失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async saveEvent() {
    if (!this.data.isAllowed) {
      wx.showToast({ title: '无权限操作', icon: 'none' });
      return;
    }

    const form = this.data.form;

    // Basic validation
    if (!form.title || !form.title.trim()) {
      wx.showToast({ title: '请填写赛事名称', icon: 'none' });
      return;
    }
    if (!form.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }

    // Auto-generate slug from title+date if not provided
    const slug = form.slug || this.generateSlug(form.title, form.date);
    const payload = {
      title: form.title.trim(),
      slug,
      date: form.date,
      location: form.location || '',
      host: form.host || '',
      coverUrl: form.coverUrl || '',
      posterUrl: form.posterUrl || '',
      description: form.description || '',
      statusText: form.statusText || '即将开始',
      baseStrength: Number(form.baseStrength || 5),
      baseEndurance: Number(form.baseEndurance || 5),
      maxParticipants: form.maxParticipants === '' ? null : Number(form.maxParticipants || 0),
      price: form.price === '' ? 0 : Number(form.price || 0),
      updatedAt: Date.now(),
    };

    wx.showLoading({ title: '保存中...' });

    try {
      if (this.data.editingId) {
        console.log('Updating event:', this.data.editingId, payload);
        await db.collection('events').doc(this.data.editingId).update({ data: payload });
        wx.hideLoading();
        wx.showToast({ title: '已更新', icon: 'success' });
      } else {
        console.log('Creating event:', payload);
        const result = await db.collection('events').add({ data: { ...payload, createdAt: Date.now() } });
        console.log('Event created:', result);
        wx.hideLoading();
        wx.showToast({ title: '已发布', icon: 'success' });
      }
      this.resetForm();
      this.loadEvents();
    } catch (err) {
      wx.hideLoading();
      console.error('Save event failed', err);
      // Show more detailed error message
      const errMsg = err.errMsg || err.message || '发布失败';
      if (errMsg.includes('permission') || errMsg.includes('PERMISSION_DENIED')) {
        wx.showModal({
          title: '权限不足',
          content: '请在 CloudBase 控制台设置 events 集合的安全规则，允许写入操作。',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: errMsg.substring(0, 20), icon: 'none' });
      }
    }
  },
});
