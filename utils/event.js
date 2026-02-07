const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeParseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function parseDateTime(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  // Compatible with JSCore parsing in mini program runtime
  const normalized = raw
    .replace('T', ' ')
    .replace(/\.(\d{1,6})Z$/, 'Z')
    .replace(/-/g, '/');

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return null;
}

function combineDateTime(dateText, timeText) {
  if (!dateText) return null;
  const safeTime = (timeText && String(timeText).trim()) || '00:00';
  const normalized = `${String(dateText).replace(/-/g, '/')} ${safeTime}:00`;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function toDateTimeString(dateText, timeText) {
  if (!dateText) return '';
  const safeTime = (timeText && String(timeText).trim()) || '00:00';
  return `${dateText} ${safeTime}:00`;
}

function formatDateToYMD(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateToHM(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const hour = String(dateObj.getHours()).padStart(2, '0');
  const minute = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

function resolveEventWindow(eventData) {
  const start = parseDateTime(eventData && eventData.start_at)
    || combineDateTime(eventData && eventData.event_date, eventData && eventData.event_time);

  let end = parseDateTime(eventData && eventData.end_at);
  if (!end && start) {
    end = new Date(start.getTime() + DEFAULT_DURATION_MS);
  }

  return {
    startAt: start,
    endAt: end,
    startAtTs: start ? start.getTime() : null,
    endAtTs: end ? end.getTime() : null,
  };
}

function deriveEventStatus(eventData, nowTs = Date.now()) {
  const windowInfo = resolveEventWindow(eventData || {});
  const { startAtTs, endAtTs } = windowInfo;

  if (!startAtTs) {
    return {
      status: 'upcoming',
      statusText: '即将开始',
      signupOpen: true,
      ...windowInfo,
    };
  }

  if (nowTs < startAtTs) {
    return {
      status: 'upcoming',
      statusText: '即将开始',
      signupOpen: true,
      ...windowInfo,
    };
  }

  if (!endAtTs || nowTs < endAtTs) {
    return {
      status: 'ongoing',
      statusText: '进行中',
      signupOpen: false,
      ...windowInfo,
    };
  }

  return {
    status: 'ended',
    statusText: '已结束',
    signupOpen: false,
    ...windowInfo,
  };
}

function normalizeDivisions(rawValue, fallbackTemplate = 'werox_casual') {
  const parsed = safeParseJson(rawValue, Array.isArray(rawValue) ? rawValue : []);
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.filter(Boolean);
  }

  if (fallbackTemplate === 'hyrox_official') {
    return ['Open男', 'Open女', 'Doubles混双'];
  }
  return ['个人体验组', '双人同伴组', '团队接力组'];
}

function normalizeDetailBlocks(rawValue, posterUrl = '') {
  const parsed = safeParseJson(rawValue, []);
  if (Array.isArray(parsed)) {
    const list = parsed
      .map((item) => {
        const title = item && item.title ? String(item.title) : '';
        const content = item && item.content ? String(item.content) : '';
        const imageListRaw = (
          (item && Array.isArray(item.image_urls) && item.image_urls)
          || (item && Array.isArray(item.images) && item.images)
          || []
        );
        const imageUrls = imageListRaw
          .map((val) => (val === null || val === undefined ? '' : String(val)))
          .map((val) => val.trim())
          .filter(Boolean);

        const legacy = item && item.image_url ? String(item.image_url).trim() : '';
        if (legacy && !imageUrls.includes(legacy)) imageUrls.unshift(legacy);

        return {
          title,
          content,
          image_urls: imageUrls,
          // Keep legacy key for compatibility (first image).
          image_url: imageUrls[0] || '',
        };
      })
      .filter((item) => item.title || item.content || (item.image_urls && item.image_urls.length));

    if (list.length > 0) return list;
  }

  if (posterUrl) {
    return [{
      title: '赛事视觉',
      content: '',
      image_urls: [posterUrl],
      image_url: posterUrl,
    }];
  }

  return [];
}

module.exports = {
  DEFAULT_DURATION_MS,
  safeNumber,
  safeParseJson,
  parseDateTime,
  combineDateTime,
  toDateTimeString,
  formatDateToYMD,
  formatDateToHM,
  resolveEventWindow,
  deriveEventStatus,
  normalizeDivisions,
  normalizeDetailBlocks,
};
