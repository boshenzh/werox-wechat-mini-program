const db = wx.cloud.database();
const { getRoleByOpenid } = require('../../utils/roles');

Page({
  data: {
    openid: '',
    profileId: '',
    profile: {
      nickname: '',
      age: '',
      heartRate: '',
      bio: '',
      avatarFileId: '',
      wechatId: '',
      tags: [],
      role: 'user',
    },
    tagText: '',
    loading: true,
  },

  onLoad() {
    this.initProfile();
  },

  async initProfile() {
    this.setData({ loading: true });
    try {
      const { result } = await wx.cloud.callFunction({ name: 'getOpenId' });
      const openid = result && result.openid ? result.openid : '';
      if (!openid) {
        throw new Error('Missing openid');
      }
      this.setData({ openid });
      await this.loadProfile(openid);
    } catch (err) {
      console.error('Failed to load profile', err);
      wx.showToast({ title: '资料加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadProfile(openid) {
    const res = await db.collection('users').where({ _openid: openid }).get();
    if (res.data && res.data.length > 0) {
      const doc = res.data[0];
      const tags = doc.tags || [];
      this.setData({
        profileId: doc._id,
        profile: {
          nickname: doc.nickname || '',
          age: doc.age || '',
          heartRate: doc.heartRate || '',
          bio: doc.bio || '',
          avatarFileId: doc.avatarFileId || '',
          wechatId: doc.wechatId || '',
          tags,
          role: doc.role || getRoleByOpenid(openid),
        },
        tagText: tags.join('，'),
      });
      return;
    }

    const role = getRoleByOpenid(openid);
    const newProfile = {
      nickname: '',
      age: '',
      heartRate: '',
      bio: '',
      avatarFileId: '',
      wechatId: '',
      tags: [],
      role,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const addRes = await db.collection('users').add({ data: newProfile });
    this.setData({ profileId: addRes._id, profile: newProfile, tagText: '' });
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    if (field === 'tags') {
      this.setData({ tagText: value });
      return;
    }
    const key = `profile.${field}`;
    this.setData({ [key]: value });
  },

  async uploadAvatar() {
    try {
      const res = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });

      const filePath = res.tempFilePaths[0];
      if (!filePath) return;

      wx.showLoading({ title: '上传中...' });
      const cloudPath = `users/${this.data.openid}/avatar_${Date.now()}.jpg`;
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });

      const key = 'profile.avatarFileId';
      this.setData({ [key]: uploadRes.fileID });
    } catch (err) {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) {
        return;
      }
      console.error('Avatar upload failed', err);
      wx.showToast({ title: '上传失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async saveProfile() {
    const { profileId, profile, tagText, openid } = this.data;
    if (!profileId) return;

    const tags = tagText
      .split(/,|，/)
      .map((item) => item.trim())
      .filter((item) => item);

    const payload = {
      nickname: profile.nickname,
      age: profile.age ? Number(profile.age) : '',
      heartRate: profile.heartRate ? Number(profile.heartRate) : '',
      bio: profile.bio,
      avatarFileId: profile.avatarFileId,
      wechatId: profile.wechatId,
      tags,
      role: profile.role || getRoleByOpenid(openid),
      updatedAt: Date.now(),
    };

    try {
      await db.collection('users').doc(profileId).update({ data: payload });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 400);
    } catch (err) {
      console.error('Failed to save profile', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

});
