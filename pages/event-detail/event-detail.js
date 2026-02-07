const app = getApp();
const { getEventDetail, getEventAlbumSummary, getMyRegistration, listEvents } = require('../../utils/api');
const { normalizeDetailBlocks } = require('../../utils/event');
const { track } = require('../../utils/analytics');

const MAX_PREVIEW_PARTICIPANTS = 5;

Page({
  data: {
    event: null,
    stations: [],
    participants: [],
    participantPreview: [],
    detailBlocks: [],
    showParticipantSheet: false,
    loading: true,
    isFull: false,
    isSigned: false,
    albumSummary: {
      totalPhotos: 0,
      canView: false,
      canUpload: false,
    },
  },

  normalizeLookupText(value) {
    return String(value || '').trim().toLowerCase();
  },

  buildEventLookup(events = []) {
    const byExact = new Map();
    const byTitleDate = new Map();
    const byTitle = new Map();

    (events || []).forEach((event) => {
      const id = event && event.id;
      if (!id) return;
      const title = this.normalizeLookupText(event.title);
      if (!title) return;
      const date = this.normalizeLookupText(event.event_date);
      const location = this.normalizeLookupText(event.location);

      byExact.set(`${title}|${date}|${location}`, String(id));
      if (!byTitleDate.has(`${title}|${date}`)) {
        byTitleDate.set(`${title}|${date}`, String(id));
      }
      if (!byTitle.has(title)) {
        byTitle.set(title, String(id));
      }
    });

    return { byExact, byTitleDate, byTitle };
  },

  resolveEventIdByMeta(meta, lookup) {
    const title = this.normalizeLookupText(meta && meta.title);
    const date = this.normalizeLookupText(meta && meta.date);
    const location = this.normalizeLookupText(meta && meta.location);
    if (!title || !lookup) return '';

    return lookup.byExact.get(`${title}|${date}|${location}`)
      || lookup.byTitleDate.get(`${title}|${date}`)
      || lookup.byTitle.get(title)
      || '';
  },

  resolveEventIdFuzzy(meta, events = []) {
    const queryTitle = this.normalizeLookupText(meta && meta.title);
    const queryDate = this.normalizeLookupText(meta && meta.date);
    if (!queryTitle) return '';

    const candidates = (events || []).filter((event) => {
      const title = this.normalizeLookupText(event && event.title);
      if (!title) return false;
      return title.includes(queryTitle) || queryTitle.includes(title);
    });

    if (candidates.length === 0) return '';
    if (candidates.length === 1) return String(candidates[0].id);

    if (queryDate) {
      const exactDate = candidates.find((event) => this.normalizeLookupText(event.event_date) === queryDate);
      if (exactDate) return String(exactDate.id);
    }

    return String(candidates[0].id);
  },

  async loadEventByMeta(meta) {
    const title = String((meta && meta.title) || '').trim();
    const date = String((meta && meta.date) || '').trim();
    const location = String((meta && meta.location) || '').trim();
    if (!title) {
      this.setData({ loading: false, event: null });
      wx.showToast({ title: '该记录缺少赛事信息', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const response = await listEvents();
      const events = response && Array.isArray(response.events) ? response.events : [];
      const lookup = this.buildEventLookup(events);
      const resolved = this.resolveEventIdByMeta({ title, date, location }, lookup)
        || this.resolveEventIdFuzzy({ title, date, location }, events);

      if (resolved) {
        this.loadEvent(Number(resolved));
        return;
      }
    } catch (err) {
      console.warn('Resolve event meta failed', err);
    }

    this.setData({
      event: null,
      stations: [],
      participants: [],
      participantPreview: [],
      showParticipantSheet: false,
      loading: false,
      isFull: false,
      isSigned: false,
      detailBlocks: [],
      albumSummary: {
        totalPhotos: 0,
        canView: false,
        canUpload: false,
      },
    });

    wx.showToast({ title: '未找到对应赛事', icon: 'none' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/events/events' });
    }, 650);
  },

  isCloudFileId(value) {
    return typeof value === 'string' && value.indexOf('cloud://') === 0;
  },

  async resolveMediaUrls(fileIds = []) {
    const cloudIds = Array.from(new Set(
      (fileIds || []).filter((item) => this.isCloudFileId(item))
    ));
    if (cloudIds.length === 0) return {};

    try {
      const res = await wx.cloud.getTempFileURL({ fileList: cloudIds });
      const fileList = (res && res.fileList) || [];
      return fileList.reduce((acc, item) => {
        if (item && item.fileID) {
          acc[item.fileID] = item.tempFileURL || item.fileID;
        }
        return acc;
      }, {});
    } catch (err) {
      console.error('Resolve event media failed', err);
      return {};
    }
  },

  onLoad(query) {
    const eventId = query && query.id ? Number(query.id) : null;
    const title = query && query.title ? String(query.title) : '';
    const date = query && query.date ? String(query.date) : '';
    const location = query && query.location ? String(query.location) : '';

    track('event_detail_open', { event_id: Number.isFinite(eventId) ? String(eventId) : '' });

    if (Number.isFinite(eventId) && eventId) {
      this.loadEvent(eventId);
      return;
    }

    this.loadEventByMeta({ title, date, location });
  },

  mapStations(stations = []) {
    return (stations || []).map((s) => ({
      id: s.id,
      order: s.station_order,
      name: s.station_name,
      description: s.station_description || '',
      targetType: s.target_type,
      targetValue: s.target_value,
      targetUnit: s.target_unit || this.getDefaultUnit(s.target_type),
      weightMale: s.weight_male_kg,
      weightFemale: s.weight_female_kg,
      weightNote: s.weight_note || '',
      equipmentNote: s.equipment_note || '',
      restAfter: s.rest_after_seconds || 0,
    }));
  },

  async mapParticipants(participants = [], maxParticipants) {
    const baseList = (participants || []).map((item) => ({
      id: item.id,
      nickname: item.user_nickname || '未命名选手',
      avatarFileId: item.user_avatar_file_id || '',
      division: item.division || '',
      sex: item.user_sex || '',
      userOpenid: item.user_openid || item._openid || '',
    }));

    const avatarMap = await this.resolveMediaUrls(baseList.map((item) => item.avatarFileId));
    const list = baseList.map((item) => ({
      ...item,
      avatarFileId: avatarMap[item.avatarFileId] || item.avatarFileId,
    }));

    const isFull = maxParticipants ? list.length >= Number(maxParticipants) : false;
    return {
      list,
      preview: list.slice(0, MAX_PREVIEW_PARTICIPANTS),
      isFull,
    };
  },

  async loadEvent(eventId) {
    this.setData({ loading: true });
    try {
      let eventData = null;
      let stations = [];
      let participants = [];

      if (eventId) {
        const detail = await getEventDetail(eventId);
        eventData = detail && detail.event ? detail.event : null;
        stations = detail && Array.isArray(detail.stations) ? detail.stations : [];
        participants = detail && Array.isArray(detail.participants) ? detail.participants : [];
      }

      if (!eventData) {
        const globalEvent = app.globalData.currentEvent;
        if (globalEvent) {
          eventData = globalEvent;
        }
      }

      if (!eventData) {
        this.setData({
          event: null,
          stations: [],
          participants: [],
          participantPreview: [],
          showParticipantSheet: false,
          loading: false,
          isFull: false,
          albumSummary: {
            totalPhotos: 0,
            canView: false,
            canUpload: false,
          },
        });
        return;
      }

      const rawCoverUrl = eventData.cover_url || eventData.coverUrl || '';
      const rawPosterUrl = eventData.poster_url || eventData.posterUrl || '';
      const detailBlocksRaw = normalizeDetailBlocks(eventData.detail_blocks || '', '');
      const detailImageIds = (detailBlocksRaw || []).reduce((list, block) => {
        const images = block && Array.isArray(block.image_urls) ? block.image_urls : [];
        images.filter(Boolean).forEach((img) => list.push(img));
        return list;
      }, []);
      const mediaUrlMap = await this.resolveMediaUrls([rawCoverUrl, rawPosterUrl, ...detailImageIds]);

      const event = {
        id: eventData.id || eventData._id || '',
        title: eventData.title || '未命名赛事',
        location: eventData.location || '待定',
        latitude: eventData.latitude || null,
        longitude: eventData.longitude || null,
        venueName: eventData.venue_name || '',
        dateText: eventData.event_date || '待定',
        eventTime: eventData.event_time || '',
        coverUrl: mediaUrlMap[rawCoverUrl] || rawCoverUrl,
        posterUrl: mediaUrlMap[rawPosterUrl] || rawPosterUrl,
        description: eventData.description || '赛事信息待更新。',
        statusText: this.getStatusText(eventData.status),
        status: eventData.status,
        maxParticipants: eventData.max_participants || null,
        priceOpen: eventData.price_open || 0,
        priceDoubles: eventData.price_doubles || 0,
        priceRelay: eventData.price_relay || 0,
        formatMode: eventData.format_mode || 'for_time',
        formatModeText: this.getFormatModeText(eventData.format_mode),
        timeCapMinutes: eventData.time_cap_minutes || null,
        totalRounds: eventData.total_rounds || 1,
        useStandardHyrox: eventData.use_standard_hyrox || false,
        availableDivisions: eventData.available_divisions || [],
        eventType: eventData.event_type || 'simulation',
        eventTypeText: this.getEventTypeText(eventData.event_type),
        baseStrength: eventData.base_strength || 0,
        baseEndurance: eventData.base_endurance || 0,
        price: eventData.price_open ? eventData.price_open / 100 : 0,
        highlights: eventData.highlights || [],
      };

      const detailBlocks = (detailBlocksRaw || []).map((block) => {
        const images = block && Array.isArray(block.image_urls) ? block.image_urls : [];
        const resolvedImages = images.map((img) => mediaUrlMap[img] || img).filter(Boolean);
        return {
          ...block,
          image_urls: resolvedImages,
          image_url: resolvedImages[0] || '',
        };
      });

      const mappedStations = this.mapStations(stations);
      const participantInfo = await this.mapParticipants(participants, event.maxParticipants);

      this.setData({
        event,
        stations: mappedStations,
        participants: participantInfo.list,
        participantPreview: participantInfo.preview,
        isFull: participantInfo.isFull,
        isSigned: false,
        detailBlocks,
      });

      track('event_view', {
        event_id: String(event.id || ''),
        status: event.status || '',
        type: event.eventType || '',
      });

      await Promise.all([
        this.loadAlbumSummary(event.id),
        this.loadMyRegistration(event.id),
      ]);
    } catch (err) {
      console.error('Load event failed', err);
      wx.showToast({ title: '赛事加载失败', icon: 'none' });
      this.setData({
        event: null,
        stations: [],
        participants: [],
        participantPreview: [],
        showParticipantSheet: false,
        loading: false,
        isFull: false,
        isSigned: false,
        albumSummary: {
          totalPhotos: 0,
          canView: false,
          canUpload: false,
        },
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMyRegistration(eventId) {
    const safeEventId = Number(eventId);
    if (!Number.isFinite(safeEventId)) return;
    try {
      const result = await getMyRegistration(safeEventId);
      this.setData({ isSigned: !!(result && result.is_signed) });
    } catch (err) {
      // Treat errors as unsigned to avoid blocking normal signup flow.
      console.warn('Load my registration failed', err);
      this.setData({ isSigned: false });
    }
  },

  async loadAlbumSummary(eventId) {
    const safeEventId = Number(eventId);
    if (!Number.isFinite(safeEventId)) return;
    try {
      const result = await getEventAlbumSummary(safeEventId);
      this.setData({
        albumSummary: {
          totalPhotos: Number(result && result.total_photos ? result.total_photos : 0),
          canView: !!(result && result.can_view),
          canUpload: !!(result && result.can_upload),
        },
      });
    } catch (err) {
      console.warn('Load album summary failed', err);
      this.setData({
        albumSummary: {
          totalPhotos: 0,
          canView: false,
          canUpload: false,
        },
      });
    }
  },

  getStatusText(status) {
    const statusMap = {
      draft: '草稿',
      upcoming: '即将开始',
      open: '报名中',
      closed: '报名结束',
      ongoing: '进行中',
      ended: '已结束',
    };
    return statusMap[status] || '即将开始';
  },

  getFormatModeText(mode) {
    const modeMap = {
      for_time: '竞速完赛',
      time_cap: '限时完赛',
      amrap: 'AMRAP',
      emom: 'EMOM',
      rounds: '固定轮数',
    };
    return modeMap[mode] || '竞速完赛';
  },

  getEventTypeText(type) {
    const typeMap = {
      official: '官方赛事',
      simulation: '模拟赛',
      training: '训练赛',
      community: '社区活动',
    };
    return typeMap[type] || '模拟赛';
  },

  getDefaultUnit(targetType) {
    const unitMap = {
      distance: '米',
      reps: '次',
      time: '秒',
      calories: '卡',
    };
    return unitMap[targetType] || '';
  },

  openParticipantSheet() {
    this.setData({ showParticipantSheet: true });
  },

  closeParticipantSheet() {
    this.setData({ showParticipantSheet: false });
  },

  noop() {},

  previewDetailImage(e) {
    const blockIndex = Number(e.currentTarget.dataset.blockIndex);
    const imgIndex = Number(e.currentTarget.dataset.imgIndex);
    const blocks = Array.isArray(this.data.detailBlocks) ? this.data.detailBlocks : [];
    if (!Number.isFinite(blockIndex) || blockIndex < 0 || blockIndex >= blocks.length) return;
    const block = blocks[blockIndex];
    const urls = block && Array.isArray(block.image_urls) ? block.image_urls.filter(Boolean) : [];
    if (!urls.length) return;

    const current = (Number.isFinite(imgIndex) && urls[imgIndex]) ? urls[imgIndex] : urls[0];
    wx.previewImage({ current, urls });
  },

  goRunnerProfile(e) {
    const openid = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.openid
      : '';
    if (!openid) {
      wx.showToast({ title: '选手资料不可用', icon: 'none' });
      return;
    }
    this.closeParticipantSheet();
    wx.navigateTo({ url: `/pages/profile/profile?openid=${encodeURIComponent(openid)}` });
  },

  handleRegister() {
    if (!this.data.event || !this.data.event.id) return;
    if (this.data.isFull) {
      track('signup_blocked_full', { event_id: String(this.data.event.id) });
      wx.showToast({ title: '报名已满', icon: 'none' });
      return;
    }

    track('signup_start', {
      event_id: String(this.data.event.id),
      is_signed: this.data.isSigned ? 1 : 0,
    });
    wx.navigateTo({ url: `/pages/event-signup/event-signup?id=${this.data.event.id}` });
  },

  openAlbum() {
    const event = this.data.event;
    if (!event || !event.id) {
      wx.showToast({ title: '赛事信息不可用', icon: 'none' });
      return;
    }
    track('album_open', { event_id: String(event.id) });
    wx.navigateTo({ url: `/pages/event-album/event-album?id=${event.id}` });
  },

  openLocation() {
    const event = this.data.event;
    if (!event || !event.latitude || !event.longitude) {
      wx.showToast({ title: '位置信息不可用', icon: 'none' });
      return;
    }
    track('open_location', { event_id: String(event.id || '') });
    wx.openLocation({
      latitude: Number(event.latitude),
      longitude: Number(event.longitude),
      name: event.venueName || event.title,
      address: event.location || '',
      scale: 16,
    });
  },

  onShareAppMessage() {
    const event = this.data.event;
    if (!event || !event.id) {
      return {
        title: 'WeRox Lab',
        path: '/pages/events/events',
      };
    }
    return {
      title: event.title || 'WeRox 赛事',
      path: `/pages/event-detail/event-detail?id=${event.id}`,
    };
  },

  onShareTimeline() {
    const event = this.data.event;
    return {
      title: (event && event.title) || 'WeRox Lab',
      query: event && event.id ? `id=${event.id}` : '',
    };
  },
});
