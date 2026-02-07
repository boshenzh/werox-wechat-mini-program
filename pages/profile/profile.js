const { getCurrentOpenid, DEFAULT_PROFILE } = require('../../utils/user');
const { getMe, getUserByOpenid, updateMyProfile, listEvents } = require('../../utils/api');
const { track } = require('../../utils/analytics');

const PROFILE_REFRESH_INTERVAL_MS = 30 * 1000;

const OPTION_MAP = {
  sex: 'sexOptions',
  training_focus: 'trainingOptions',
  hyrox_level: 'hyroxOptions',
  preferred_partner_role: 'partnerRoleOptions',
};

const INDEX_MAP = {
  sex: 'sexIndex',
  training_focus: 'trainingIndex',
  hyrox_level: 'hyroxIndex',
  preferred_partner_role: 'partnerRoleIndex',
};

const PREDEFINED_TAGS = [
  '#PACER（心肺担当）',
  'Ranger（六边形）',
  'Support（战术辅助）',
  'TANK（力量担当）',
];

Page({
  data: {
    openid: '',
    viewOpenid: '',
    odId: null, // SQL record ID
    profile: { ...DEFAULT_PROFILE },
    tagText: '',
    selectedTag: '',
    tagOptions: PREDEFINED_TAGS,
    isEditing: false,
    backupProfile: null,
    backupTagText: '',
    backupSelectedTag: '',
    canManageEvents: false,
    isAdmin: false,
    isSelf: true,
    attendanceRecords: [],
    loading: true,
    roleLabel: '用户',
    syncingWechatId: false,
    authLoading: false,
    showAuthPrompt: false,
    sexOptions: ['未选择', '男', '女'],
    trainingOptions: ['未选择', 'HYROX', 'CrossFit', '综合训练', '跑步'],
    hyroxOptions: ['未选择', '新手', '完赛过', '多次参赛', 'Pro选手'],
    partnerRoleOptions: ['未选择', '力量担当', '耐力担当', '节奏控场', '全能搭档'],
    sexIndex: 0,
    trainingIndex: 0,
    hyroxIndex: 0,
    partnerRoleIndex: 0,
  },

  onLoad(query) {
    const targetOpenid = query && query.openid ? decodeURIComponent(query.openid) : '';
    this.setData({ viewOpenid: targetOpenid || '' });
  },

  onShow() {
    this.initProfile({ forceRefresh: false });
  },

  onPullDownRefresh() {
    // Pull-to-refresh should always force reload and stop the native spinner.
    this.initProfile({ forceRefresh: true, stopPullDown: true });
  },

  shouldRefresh(forceRefresh) {
    if (forceRefresh) return true;
    if (!this.lastLoadedAt) return true;
    return Date.now() - this.lastLoadedAt > PROFILE_REFRESH_INTERVAL_MS;
  },

  async initProfile(options = {}) {
    const { forceRefresh = false, stopPullDown = false } = options;
    if (this._initPromise) return this._initPromise;
    if (!this.shouldRefresh(forceRefresh)) {
      if (stopPullDown) wx.stopPullDownRefresh();
      return null;
    }

    this.setData({ loading: true });
    this._eventLookupCache = null;
    try {
      this._initPromise = (async () => {
        const openid = await getCurrentOpenid();
        const viewOpenid = this.data.viewOpenid || '';
        const targetOpenid = viewOpenid || openid;
        const isSelf = !viewOpenid || viewOpenid === openid;

        this.setData({
          openid,
          viewOpenid: targetOpenid,
          isSelf,
          isEditing: false,
          showAuthPrompt: false,
        });

        await this.loadBundle(targetOpenid, { allowCreate: isSelf, isSelf });
        this.lastLoadedAt = Date.now();
        return true;
      })();

      return await this._initPromise;
    } catch (err) {
      console.error('Failed to load profile', err);
      wx.showToast({ title: '资料加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      this._initPromise = null;
      if (stopPullDown) wx.stopPullDownRefresh();
    }
    return null;
  },

  parseTags(rawTags) {
    if (Array.isArray(rawTags)) return rawTags;
    if (typeof rawTags === 'string') {
      try {
        const parsed = JSON.parse(rawTags);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return rawTags
          .split(/,|，/)
          .map((item) => item.trim())
          .filter((item) => item);
      }
    }
    return [];
  },

  async loadBundle(openid, options = {}) {
    const { allowCreate = true, isSelf = true } = options;
    const response = isSelf ? await getMe() : await getUserByOpenid(openid);
    const doc = response && response.profile ? response.profile : null;
    const records = response && Array.isArray(response.attendance_records)
      ? response.attendance_records
      : [];

    if (!doc) {
      if (!allowCreate) {
        const emptyProfile = { ...DEFAULT_PROFILE, role: 'runner' };
        this.setData({
          odId: null,
          profile: emptyProfile,
          tagText: '',
          selectedTag: '',
          canManageEvents: false,
          isEditing: false,
          roleLabel: '用户',
          showAuthPrompt: false,
          attendanceRecords: [],
        });
        this.syncPickerIndexes(emptyProfile);
        return;
      }

      const emptySelfProfile = { ...DEFAULT_PROFILE, role: 'runner' };
      this.setData({
        odId: null,
        profile: emptySelfProfile,
        tagText: '',
        selectedTag: '',
        canManageEvents: false,
        isEditing: false,
        roleLabel: '用户',
        attendanceRecords: [],
      });
      this.syncPickerIndexes(emptySelfProfile);
      this.maybePromptProfileAuth(emptySelfProfile);
      return;
    }

    const role = doc.role || 'runner';
    const tags = this.parseTags(doc.tags);
    const canManageEvents = isSelf && this.hasEventManageAccess(role);
    const isAdmin = isSelf && String(role).toLowerCase() === 'admin';
    const roleLabel = this.getRoleLabel(role);

    const nextProfile = {
      nickname: doc.nickname || '',
      birth_year: doc.birth_year || null,
      bio: doc.bio || '',
      avatar_file_id: doc.avatar_file_id || '',
      wechat_id: doc.wechat_id || '',
      tags,
      sex: doc.sex || '',
      training_focus: doc.training_focus || '',
      hyrox_level: doc.hyrox_level || '',
      preferred_partner_role: doc.preferred_partner_role || '',
      partner_note: doc.partner_note || '',
      mbti: doc.mbti || '',
      role,
    };
    const selectedTag = tags.find((item) => PREDEFINED_TAGS.includes(item)) || '';

    this.setData({
      odId: doc.id || null,
      profile: nextProfile,
      tagText: Array.isArray(tags) ? tags.join('，') : '',
      selectedTag,
      canManageEvents,
      isAdmin,
      isEditing: false,
      roleLabel,
    });

    this.syncPickerIndexes(nextProfile);
    if (isSelf) {
      this.maybePromptProfileAuth(nextProfile);
    } else {
      this.setData({ showAuthPrompt: false });
    }

    await this.applyAttendanceRecords(records);
  },

  async applyAttendanceRecords(records) {
    let mappedRecords = (records || []).map((record) => {
      const eventId = this.normalizeEventId(
        record && (
          record.event_id
          || record.eventId
          || record.eventID
        )
      );
      const eventName = record.event_title || '赛事记录';
      const eventDate = record.event_date || '';
      const eventLocation = record.event_location || '';
      const gymName = eventLocation || '未填写场馆';
      return {
        ...record,
        eventId,
        eventName,
        eventDate,
        eventLocation,
        gymName,
      };
    });

    if (mappedRecords.some((item) => !item.eventId)) {
      mappedRecords = await this.fillMissingEventIds(mappedRecords);
    }

    this.setData({
      attendanceRecords: mappedRecords,
    });
  },

  getRoleLabel(role) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (normalizedRole === 'admin') return '管理员';
    if (normalizedRole === 'coach') return '教练';
    if (normalizedRole === 'organizer') return '组织者';
    return '用户';
  },

  hasEventManageAccess(role) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    return normalizedRole === 'admin'
      || normalizedRole === 'coach'
      || normalizedRole === 'organizer';
  },

  normalizeEventId(value) {
    if (value === undefined || value === null) return '';
    const text = String(value).trim();
    if (!text || text === 'null' || text === 'undefined') return '';
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : '';
  },

  normalizeLookupText(value) {
    return String(value || '').trim().toLowerCase();
  },

  buildEventLookup(events) {
    const byExact = new Map();
    const byTitleDate = new Map();
    const byTitle = new Map();

    (events || []).forEach((event) => {
      const eventId = this.normalizeEventId(event && event.id);
      if (!eventId) return;

      const title = this.normalizeLookupText(event && event.title);
      const date = this.normalizeLookupText(event && event.event_date);
      const location = this.normalizeLookupText(event && event.location);
      if (!title) return;

      byExact.set(`${title}|${date}|${location}`, eventId);
      if (!byTitleDate.has(`${title}|${date}`)) {
        byTitleDate.set(`${title}|${date}`, eventId);
      }
      if (!byTitle.has(title)) {
        byTitle.set(title, eventId);
      }
    });

    return { byExact, byTitleDate, byTitle };
  },

  resolveEventIdByMeta(meta, lookup) {
    const title = this.normalizeLookupText(meta && meta.eventName);
    const date = this.normalizeLookupText(meta && meta.eventDate);
    const location = this.normalizeLookupText(meta && meta.eventLocation);
    if (!title || !lookup) return '';

    return lookup.byExact.get(`${title}|${date}|${location}`)
      || lookup.byTitleDate.get(`${title}|${date}`)
      || lookup.byTitle.get(title)
      || '';
  },

  async getEventLookup() {
    if (this._eventLookupCache) {
      return this._eventLookupCache;
    }
    const response = await listEvents();
    const events = response && Array.isArray(response.events) ? response.events : [];
    this._eventLookupCache = this.buildEventLookup(events);
    return this._eventLookupCache;
  },

  async fillMissingEventIds(records) {
    try {
      const lookup = await this.getEventLookup();
      return (records || []).map((record) => {
        if (record.eventId) return record;
        const resolvedId = this.resolveEventIdByMeta(record, lookup);
        return resolvedId ? { ...record, eventId: resolvedId } : record;
      });
    } catch (err) {
      console.warn('Resolve attendance event ids failed', err);
      return records;
    }
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    if (field === 'tags') {
      this.setData({ tagText: value });
      return;
    }
    this.setData({ [`profile.${field}`]: value });
  },

  handleTagSelect(e) {
    const tag = e.currentTarget.dataset.tag || '';
    if (!tag) return;
    this.setData({
      selectedTag: this.data.selectedTag === tag ? '' : tag,
    });
  },

  maybePromptProfileAuth(profile) {
    const needsAuth = !(profile.nickname && profile.avatar_file_id);
    this.setData({ showAuthPrompt: needsAuth });
  },

  handleAuthDismiss() {
    this.setData({ showAuthPrompt: false });
  },

  async onChooseAvatar(e) {
    const tempFilePath = e.detail.avatarUrl;
    if (!tempFilePath) {
      wx.showToast({ title: '未选择头像', icon: 'none' });
      return;
    }

    this.setData({ authLoading: true });
    wx.showLoading({ title: '上传中...' });

    try {
      const cloudPath = `avatars/${this.data.openid}_${Date.now()}.jpg`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
      });
      const avatar_file_id = uploadRes.fileID;

      const updatedProfile = {
        ...this.data.profile,
        avatar_file_id,
      };

      this.setData({
        profile: updatedProfile,
        showAuthPrompt: !(updatedProfile.nickname && updatedProfile.avatar_file_id),
      });

      await updateMyProfile({ avatar_file_id });

      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Avatar upload failed', err);
      wx.showToast({ title: '头像上传失败', icon: 'none' });
    } finally {
      this.setData({ authLoading: false });
    }
  },

  onNicknameChange(e) {
    const nickname = (e.detail.value || '').trim();
    if (!nickname) return;

    const updatedProfile = {
      ...this.data.profile,
      nickname,
    };

    this.setData({
      profile: updatedProfile,
      showAuthPrompt: !(updatedProfile.nickname && updatedProfile.avatar_file_id),
    });

    this.saveNickname(nickname);
  },

  async onNicknameInput(e) {
    const nickname = (e.detail.value || '').trim();
    if (!nickname) return;

    const updatedProfile = {
      ...this.data.profile,
      nickname,
    };

    this.setData({
      profile: updatedProfile,
      showAuthPrompt: !(updatedProfile.nickname && updatedProfile.avatar_file_id),
    });

    await this.saveNickname(nickname);
  },

  async saveNickname(nickname) {
    if (!nickname) return;

    try {
      await updateMyProfile({ nickname });
    } catch (err) {
      console.error('Nickname update failed', err);
    }
  },

  handleAuthConfirm() {
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
    const wechat_id = (e.detail.value || '').trim();
    if (!wechat_id || !this.data.openid) return;
    await this.trySyncWechatProfile(wechat_id);
  },

  handleEditAction() {
    if (!this.data.isEditing) {
      const backupProfile = JSON.parse(JSON.stringify(this.data.profile));
      this.setData({
        isEditing: true,
        backupProfile,
        backupTagText: this.data.tagText,
        backupSelectedTag: this.data.selectedTag,
      });
      track('profile_edit_start', { is_self: this.data.isSelf ? 1 : 0 });
      return;
    }
    this.saveProfile();
  },

  async trySyncWechatProfile(wechat_id) {
    if (!wechat_id) return;
    wx.showToast({ title: '自动同步将在后续版本开放', icon: 'none' });
  },

  cancelEdit() {
    const restoredProfile = this.data.backupProfile || this.data.profile;
    this.setData({
      isEditing: false,
      profile: restoredProfile,
      tagText: this.data.backupTagText || '',
      selectedTag: this.data.backupSelectedTag || '',
      backupProfile: null,
      backupTagText: '',
      backupSelectedTag: '',
    });
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
    const { profile, selectedTag } = this.data;

    wx.showLoading({ title: '保存中...' });

    const tags = selectedTag ? [selectedTag] : [];

    // Fix: send tags as array only, not JSON.stringify then re-override.
    // The BFF/local fallback handles serialization.
    const payload = {
      nickname: profile.nickname,
      birth_year: profile.birth_year ? Number(profile.birth_year) : null,
      bio: profile.bio,
      avatar_file_id: profile.avatar_file_id,
      wechat_id: profile.wechat_id,
      tags,
      sex: profile.sex,
      training_focus: profile.training_focus,
      hyrox_level: profile.hyrox_level,
      preferred_partner_role: profile.preferred_partner_role,
      partner_note: profile.partner_note,
      mbti: profile.mbti,
    };

    try {
      track('profile_save_submit', {
        has_nickname: profile.nickname ? 1 : 0,
        has_avatar: profile.avatar_file_id ? 1 : 0,
        has_tag: selectedTag ? 1 : 0,
      });
      await updateMyProfile(payload);

      wx.hideLoading();
      this.setData({
        isEditing: false,
        profile: { ...profile, tags },
        tagText: tags.join('，'),
        selectedTag: tags[0] || '',
        backupProfile: null,
        backupTagText: '',
        backupSelectedTag: '',
      });
      this.maybePromptProfileAuth({ ...profile, tags });
      track('profile_save_success', {});
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Failed to save profile', err);
      track('profile_save_fail', { reason: (err && err.message) || '' });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  goAdminEvents() {
    wx.navigateTo({ url: '/pages/admin-events/admin-events' });
  },

  goAdminUsers() {
    wx.navigateTo({ url: '/pages/admin-users/admin-users' });
  },

  async handleAttendanceTap(e) {
    const eventIdRaw = e.currentTarget.dataset.eventId;
    const eventId = this.normalizeEventId(eventIdRaw);
    if (eventId) {
      wx.navigateTo({
        url: `/pages/event-detail/event-detail?id=${encodeURIComponent(eventId)}`,
      });
      return;
    }

    const title = (e.currentTarget.dataset.eventName || '').trim();
    const date = (e.currentTarget.dataset.eventDate || '').trim();
    const location = (e.currentTarget.dataset.eventLocation || '').trim();

    try {
      const lookup = await this.getEventLookup();
      const resolvedId = this.resolveEventIdByMeta({
        eventName: title,
        eventDate: date,
        eventLocation: location,
      }, lookup);
      if (resolvedId) {
        wx.navigateTo({
          url: `/pages/event-detail/event-detail?id=${encodeURIComponent(resolvedId)}`,
        });
        return;
      }
    } catch (err) {
      console.warn('Resolve attendance event id on tap failed', err);
    }

    if (!title) {
      wx.showToast({ title: '该记录缺少赛事信息', icon: 'none' });
      return;
    }

    // Fallback: let event-detail resolve by meta (title/date/location).
    wx.navigateTo({
      url: `/pages/event-detail/event-detail?title=${encodeURIComponent(title)}&date=${encodeURIComponent(date)}&location=${encodeURIComponent(location)}`,
    });
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
