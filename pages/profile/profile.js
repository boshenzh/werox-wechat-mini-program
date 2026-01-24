const db = wx.cloud.database();
const { getRoleByOpenid } = require('../../utils/roles');

const OPTION_MAP = {
  sex: 'sexOptions',
  trainingFocus: 'trainingOptions',
  hyroxExperience: 'hyroxOptions',
  partnerRole: 'partnerRoleOptions',
};

const INDEX_MAP = {
  sex: 'sexIndex',
  trainingFocus: 'trainingIndex',
  hyroxExperience: 'hyroxIndex',
  partnerRole: 'partnerRoleIndex',
};

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
      sex: '',
      trainingFocus: '',
      hyroxExperience: '',
      partnerRole: '',
      partnerNote: '',
      mbti: '',
      role: 'user',
    },
    tagText: '',
    isEditing: false,
    backupProfile: null,
    backupTagText: '',
    isAdmin: false,
    isSelf: true,
    strengthScore: 0,
    enduranceScore: 0,
    attendanceRecords: [],
    loading: true,
    roleLabel: '用户',
    syncingWechatId: false,
    authLoading: false,
    showAuthPrompt: false,
    sexOptions: ['未选择', '男', '女', '其他'],
    trainingOptions: ['未选择', 'HYROX', 'CrossFit', '综合训练'],
    hyroxOptions: ['未选择', '无参赛经验', '有参赛经验'],
    partnerRoleOptions: ['未选择', '力量担当', '耐力担当', '节奏控场', '全能搭档'],
    sexIndex: 0,
    trainingIndex: 0,
    hyroxIndex: 0,
    partnerRoleIndex: 0,
  },

  onShow() {
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

      console.log('openid', openid);
      this.setData({ openid });
      await this.loadProfile(openid);
      await this.loadAttendance(openid);
    } catch (err) {
      console.error('Failed to load profile', err);
      wx.showToast({ title: '资料加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadProfile(openid) {
    const res = await db.collection('users').where({ _openid: openid }).get();
    const role = getRoleByOpenid(openid);
    if (res.data && res.data.length > 0) {
      const doc = res.data[0];
      const finalRole = doc.role || role;
      const tags = doc.tags || [];
      const isAdmin = finalRole === 'admin';
      const roleLabel = this.getRoleLabel(finalRole);
      const nextProfile = {
        nickname: doc.nickname || '',
        age: doc.age || '',
        heartRate: doc.heartRate || '',
        bio: doc.bio || '',
        avatarFileId: doc.avatarFileId || '',
        wechatId: doc.wechatId || '',
        tags,
        sex: doc.sex || '',
        trainingFocus: doc.trainingFocus || '',
        hyroxExperience: doc.hyroxExperience || '',
        partnerRole: doc.partnerRole || '',
        partnerNote: doc.partnerNote || '',
        mbti: doc.mbti || '',
        role: finalRole,
      };
      this.setData({
        profileId: doc._id,
        profile: nextProfile,
        tagText: tags.join('，'),
        isAdmin,
        isSelf: true,
        isEditing: false,
        roleLabel,
      });
      this.syncPickerIndexes(nextProfile);
      this.maybePromptProfileAuth(nextProfile);
      if (doc.role !== role && (role === 'admin' || role === 'coach')) {
        await db.collection('users').doc(doc._id).update({ data: { role } });
      }
      return;
    }

    // Double-check to prevent race condition duplicates
    const recheck = await db.collection('users').where({ _openid: openid }).get();
    if (recheck.data && recheck.data.length > 0) {
      // Another process created the user, use that record
      return this.loadProfile(openid);
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
      role,
      _openid: openid, // Explicitly set _openid for consistency
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const addRes = await db.collection('users').add({ data: newProfile });
    this.setData({
      profileId: addRes._id,
      profile: newProfile,
      tagText: '',
      isAdmin: role === 'admin',
      isSelf: true,
      isEditing: false,
      roleLabel: this.getRoleLabel(role),
    });
    this.syncPickerIndexes(newProfile);
    this.maybePromptProfileAuth(newProfile);
  },

  async loadAttendance(openid) {
    // Use event_participants as the single source of truth (merged with event_attendance)
    try {
      const res = await db
        .collection('event_participants')
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .get();

      const records = (res.data || []).map((record) => {
        // Map event_participants fields to display format
        const eventName = record.eventTitle || record.eventName || '赛事记录';
        const gymName = record.eventLocation || record.gymName || '未填写场馆';
        const baseStrength = Number(record.baseStrength || 0);
        const baseEndurance = Number(record.baseEndurance || 0);
        const adjustStrength = Number(record.coachAdjustStrength || 0);
        const adjustEndurance = Number(record.coachAdjustEndurance || 0);
        const finalStrength = Number(record.finalStrength || baseStrength + adjustStrength);
        const finalEndurance = Number(record.finalEndurance || baseEndurance + adjustEndurance);
        return { ...record, eventName, gymName, finalStrength, finalEndurance };
      });
      const scores = this.calculateScores(records);

      this.setData({
        attendanceRecords: records,
        strengthScore: scores.strength,
        enduranceScore: scores.endurance,
      });
    } catch (err) {
      // Handle case where collection doesn't exist yet
      console.log('No attendance records or collection not exists', err.message);
      this.setData({
        attendanceRecords: [],
        strengthScore: 0,
        enduranceScore: 0,
      });
    }
  },

  calculateScores(records) {
    if (!records.length) {
      return { strength: 0, endurance: 0 };
    }

    let strengthSum = 0;
    let enduranceSum = 0;
    let count = 0;

    records.forEach((record) => {
      const finalStrength = Number(record.finalStrength || 0);
      const finalEndurance = Number(record.finalEndurance || 0);
      strengthSum += finalStrength;
      enduranceSum += finalEndurance;
      count += 1;
    });

    return {
      strength: Number((strengthSum / count).toFixed(1)),
      endurance: Number((enduranceSum / count).toFixed(1)),
    };
  },

  getRoleLabel(role) {
    if (role === 'admin') return '管理员';
    if (role === 'coach') return '教练';
    return '用户';
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

  maybePromptProfileAuth(profile) {
    const needsAuth = !(profile.nickname && profile.avatarFileId);
    this.setData({ showAuthPrompt: needsAuth });
  },

  handleAuthDismiss() {
    this.setData({ showAuthPrompt: false });
  },

  // New avatar selection handler (replaces deprecated wx.getUserProfile)
  async onChooseAvatar(e) {
    console.log('onChooseAvatar triggered', e.detail);
    const tempFilePath = e.detail.avatarUrl;
    if (!tempFilePath) {
      wx.showToast({ title: '未选择头像', icon: 'none' });
      return;
    }

    this.setData({ authLoading: true });
    wx.showLoading({ title: '上传中...' });

    try {
      // Upload to cloud storage
      const cloudPath = `avatars/${this.data.openid}_${Date.now()}.jpg`;
      console.log('Uploading avatar to:', cloudPath);
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
      });
      const avatarFileId = uploadRes.fileID;
      console.log('Avatar uploaded:', avatarFileId);

      const profileId = this.data.profileId;
      const updatedProfile = {
        ...this.data.profile,
        avatarFileId,
      };

      this.setData({
        profile: updatedProfile,
        showAuthPrompt: !(updatedProfile.nickname && updatedProfile.avatarFileId),
      });

      if (profileId) {
        console.log('Saving avatar to profile:', profileId);
        await db.collection('users').doc(profileId).update({
          data: {
            avatarFileId,
            updatedAt: Date.now(),
          },
        });
      }

      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Avatar upload failed', err);
      const errMsg = err.errMsg || err.message || '头像上传失败';
      if (errMsg.includes('permission') || errMsg.includes('PERMISSION_DENIED')) {
        wx.showModal({
          title: '权限不足',
          content: '请检查云存储或数据库权限设置。',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: '头像上传失败', icon: 'none' });
      }
    } finally {
      this.setData({ authLoading: false });
    }
  },

  // New nickname input handler (replaces deprecated wx.getUserProfile)
  async onNicknameInput(e) {
    const nickname = (e.detail.value || '').trim();
    if (!nickname) return;

    const profileId = this.data.profileId;
    const updatedProfile = {
      ...this.data.profile,
      nickname,
    };

    this.setData({
      profile: updatedProfile,
      showAuthPrompt: !(updatedProfile.nickname && updatedProfile.avatarFileId),
    });

    if (profileId) {
      try {
        await db.collection('users').doc(profileId).update({
          data: {
            nickname,
            updatedAt: Date.now(),
          },
        });
      } catch (err) {
        console.error('Nickname update failed', err);
      }
    }
  },

  handleAuthConfirm() {
    // Close the auth prompt - user will use the avatar button and nickname input
    this.setData({ showAuthPrompt: false });
  },

  handlePickerChange(e) {
    const field = e.currentTarget.dataset.field;
    const index = Number(e.detail.value);
    const optionKey = OPTION_MAP[field];
    const indexKey = INDEX_MAP[field];
    if (!optionKey || !indexKey) return;
    const options = this.data[optionKey] || [];
    const picked = options[index] || '';
    const value = picked === '未选择' ? '' : picked;
    this.setData({
      [indexKey]: index,
      [`profile.${field}`]: value,
    });
  },

  async handleWechatIdBlur(e) {
    const wechatId = (e.detail.value || '').trim();
    if (!wechatId || !this.data.openid) {
      return;
    }
    await this.trySyncWechatProfile(wechatId);
  },

  handleEditAction() {
    if (!this.data.isEditing) {
      const backupProfile = JSON.parse(JSON.stringify(this.data.profile));
      this.setData({
        isEditing: true,
        backupProfile,
        backupTagText: this.data.tagText,
      });
      return;
    }

    this.saveProfile();
  },

  async trySyncWechatProfile(wechatId) {
    if (this.data.syncingWechatId) return;
    this.setData({ syncingWechatId: true });
    try {
      const res = await db.collection('users').where({ wechatId }).get();
      const list = res.data || [];
      const matched = list.find((doc) => doc._openid && doc._openid !== this.data.openid) || list[0];
      if (!matched || (matched._openid && matched._openid === this.data.openid)) {
        return;
      }

      const confirmRes = await new Promise((resolve) => {
        wx.showModal({
          title: '发现已有资料',
          content: '是否同步已预录的资料到当前账号？',
          confirmText: '同步',
          cancelText: '稍后',
          success: resolve,
          fail: () => resolve({ confirm: false }),
        });
      });

      if (!confirmRes.confirm) return;

      const current = { ...this.data.profile };
      const merged = {
        ...current,
        nickname: current.nickname || matched.nickname || '',
        age: current.age || matched.age || '',
        heartRate: current.heartRate || matched.heartRate || '',
        bio: current.bio || matched.bio || '',
        avatarFileId: current.avatarFileId || matched.avatarFileId || '',
        tags: (current.tags && current.tags.length ? current.tags : matched.tags) || [],
        sex: current.sex || matched.sex || '',
        trainingFocus: current.trainingFocus || matched.trainingFocus || '',
        hyroxExperience: current.hyroxExperience || matched.hyroxExperience || '',
        partnerRole: current.partnerRole || matched.partnerRole || '',
        partnerNote: current.partnerNote || matched.partnerNote || '',
        mbti: current.mbti || matched.mbti || '',
      };

      this.setData({
        profile: merged,
        tagText: (merged.tags || []).join('，'),
      });
      this.syncPickerIndexes(merged);
      wx.showToast({ title: '已同步资料', icon: 'success' });
    } catch (err) {
      console.error('Sync profile failed', err);
      wx.showToast({ title: '同步失败', icon: 'none' });
    } finally {
      this.setData({ syncingWechatId: false });
    }
  },

  cancelEdit() {
    const restoredProfile = this.data.backupProfile || this.data.profile;
    this.setData({
      isEditing: false,
      profile: restoredProfile,
      tagText: this.data.backupTagText || '',
      backupProfile: null,
      backupTagText: '',
    });
    // Sync picker indexes to restored profile values
    this.syncPickerIndexes(restoredProfile);
  },

  copyOpenId() {
    if (!this.data.openid) {
      wx.showToast({ title: 'OpenID 为空', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.openid,
      success: () => {
        wx.showToast({ title: '已复制 OpenID', icon: 'success' });
      },
    });
  },

  async saveProfile() {
    const { profileId, profile, tagText, openid } = this.data;
    if (!profileId) {
      console.error('saveProfile: No profileId found');
      wx.showToast({ title: '请先完成注册', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });

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
      sex: profile.sex,
      trainingFocus: profile.trainingFocus,
      hyroxExperience: profile.hyroxExperience,
      partnerRole: profile.partnerRole,
      partnerNote: profile.partnerNote,
      mbti: profile.mbti,
      role: profile.role || getRoleByOpenid(openid),
      updatedAt: Date.now(),
    };

    console.log('saveProfile: Saving payload', profileId, payload);

    try {
      await db.collection('users').doc(profileId).update({ data: payload });
      console.log('saveProfile: Success');
      wx.hideLoading();
      this.setData({
        isEditing: false,
        profile: { ...profile, tags },
        tagText: tags.join('，'),
        backupProfile: null,
        backupTagText: '',
      });
      this.maybePromptProfileAuth({ ...profile, tags });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Failed to save profile', err);
      const errMsg = err.errMsg || err.message || '保存失败';
      if (errMsg.includes('permission') || errMsg.includes('PERMISSION_DENIED')) {
        wx.showModal({
          title: '权限不足',
          content: '请在 CloudBase 控制台设置 users 集合的安全规则，允许用户更新自己的记录。',
          showCancel: false,
        });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    }
  },

  goAdminEvents() {
    wx.navigateTo({ url: '/pages/admin-events/admin-events' });
  },

  syncPickerIndexes(profile) {
    const next = {};
    Object.keys(OPTION_MAP).forEach((field) => {
      const optionKey = OPTION_MAP[field];
      const indexKey = INDEX_MAP[field];
      const options = this.data[optionKey] || [];
      const currentValue = profile[field] || '';
      let index = options.indexOf(currentValue);
      if (index < 0) index = 0;
      next[indexKey] = index;
    });
    if (Object.keys(next).length) {
      this.setData(next);
    }
  },
});
