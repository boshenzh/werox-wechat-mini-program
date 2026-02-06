const app = getApp();
const { listEvents } = require('../../utils/api');
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const CARD_AVATAR_LIMIT = 3;
const EVENT_REFRESH_INTERVAL_MS = 30 * 1000;
const USER_LOCATION_CACHE_TTL_MS = 3 * 60 * 1000;

Page({
  data: {
    events: [],
    loading: false,
    lastLoadedAt: 0,
  },

  isCloudFileId(value) {
    return typeof value === 'string' && value.indexOf('cloud://') === 0;
  },

  async resolveFileUrlMap(fileIds = []) {
    const cloudIds = Array.from(new Set(
      (fileIds || []).filter((id) => this.isCloudFileId(id))
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
      console.error('Resolve file urls failed', err);
      return {};
    }
  },

  getUserLocationSafe() {
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          const latitude = Number(res.latitude);
          const longitude = Number(res.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            resolve(null);
            return;
          }
          resolve({ latitude, longitude });
        },
        fail: () => resolve(null),
      });
    });
  },

  async getUserLocationCached(forceRefresh = false) {
    const now = Date.now();
    const cache = app.globalData.userLocationCache || null;

    if (
      !forceRefresh
      && cache
      && Object.prototype.hasOwnProperty.call(cache, 'value')
      && Number.isFinite(cache.ts)
      && now - cache.ts < USER_LOCATION_CACHE_TTL_MS
    ) {
      return cache.value;
    }

    const location = await this.getUserLocationSafe();
    app.globalData.userLocationCache = {
      value: location,
      ts: now,
    };
    return location;
  },

  formatEventDate(rawDate) {
    if (!rawDate) return '日期待定';
    const source = String(rawDate);
    const parsed = new Date(source.replace(/-/g, '/'));

    if (Number.isNaN(parsed.getTime())) {
      const match = source.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (!match) return source;
      const month = String(match[2]).padStart(2, '0');
      const day = String(match[3]).padStart(2, '0');
      return `${month}-${day}`;
    }

    const weekday = WEEKDAY_LABELS[parsed.getDay()] || '';
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${weekday} ${month}-${day}`.trim();
  },

  deg2rad(deg) {
    return deg * (Math.PI / 180);
  },

  calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(this.deg2rad(lat1))
      * Math.cos(this.deg2rad(lat2))
      * Math.sin(dLon / 2)
      * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  formatDistance(userLocation, eventLatitude, eventLongitude) {
    const lat = Number(eventLatitude);
    const lon = Number(eventLongitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '距你 --';
    if (!userLocation) return '距你 --';

    const km = this.calculateDistanceKm(userLocation.latitude, userLocation.longitude, lat, lon);
    if (!Number.isFinite(km)) return '距你 --';
    if (km < 1) {
      const meters = Math.max(1, Math.round(km * 1000));
      return `距你 ${meters}m`;
    }
    const decimals = km < 10 ? 1 : 0;
    return `距你 ${km.toFixed(decimals)}km`;
  },

  onShow() {
    const now = Date.now();
    const shouldRefresh = !this.data.events.length
      || now - Number(this.data.lastLoadedAt || 0) > EVENT_REFRESH_INTERVAL_MS;

    if (shouldRefresh) {
      this.loadEvents();
    }
  },

  async onPullDownRefresh() {
    await this.loadEvents({ forceLocation: true, forceRefresh: true });
    wx.stopPullDownRefresh();
  },

  async loadEvents(options = {}) {
    const { forceLocation = false, forceRefresh = false } = options;

    if (this._loadingPromise && !forceRefresh) {
      return this._loadingPromise;
    }

    this._loadingPromise = this.doLoadEvents({ forceLocation }).finally(() => {
      this._loadingPromise = null;
    });

    return this._loadingPromise;
  },

  async doLoadEvents(options = {}) {
    const { forceLocation = false } = options;
    this.setData({ loading: true });
    try {
      const response = await listEvents();
      const eventsRaw = response && Array.isArray(response.events) ? response.events : [];
      const userLocation = await this.getUserLocationCached(forceLocation);

      const coverFileIds = Array.from(new Set(
        eventsRaw
          .map((item) => (item && (item.cover_url || item.coverUrl)) || '')
          .filter(Boolean)
      ));

      const avatarFileIds = eventsRaw.reduce((list, event) => {
        const avatars = Array.isArray(event.participant_avatar_file_ids)
          ? event.participant_avatar_file_ids
          : [];
        avatars
          .filter(Boolean)
          .slice(0, CARD_AVATAR_LIMIT)
          .forEach((item) => list.push(item));
        return list;
      }, []);

      const fileUrlMap = await this.resolveFileUrlMap([...coverFileIds, ...avatarFileIds]);

      const events = eventsRaw.map((event) => {
        const avatars = Array.isArray(event.participant_avatar_file_ids)
          ? event.participant_avatar_file_ids
          : [];
        const participantCount = Number(event.participant_count || 0);
        return {
          id: event.id,
          title: event.title || '未命名赛事',
          location: event.location || '待定',
          dateText: this.formatEventDate(event.event_date),
          coverUrl: fileUrlMap[event.cover_url || event.coverUrl] || event.cover_url || event.coverUrl || '',
          participantAvatars: avatars
            .slice(0, CARD_AVATAR_LIMIT)
            .map((fileId) => fileUrlMap[fileId] || fileId)
            .filter(Boolean),
          signupText: `${participantCount}人已报名`,
          distanceText: this.formatDistance(userLocation, event.latitude, event.longitude),
          statusText: this.getStatusText(event.status),
          status: event.status,
          baseStrength: event.base_strength || 0,
          baseEndurance: event.base_endurance || 0,
          formatMode: event.format_mode || 'for_time',
          eventType: event.event_type || 'simulation',
        };
      });

      this.setData({
        events,
        lastLoadedAt: Date.now(),
      });
    } catch (err) {
      console.error('Load events failed', err);
      this.setData({ events: [] });
      wx.showToast({ title: '赛事加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
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

  goDetail(e) {
    const eventId = e.currentTarget.dataset.eventId;
    if (!eventId) return;
    const event = this.data.events.find((item) => item.id === eventId);
    if (event) {
      app.globalData.currentEvent = event;
    }
    wx.navigateTo({ url: `/pages/event-detail/event-detail?id=${eventId}` });
  },
});
