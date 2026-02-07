const MAX_KEYS = 10;
const MAX_STR_LEN = 128;

function truncateString(value, maxLen) {
  const text = String(value == null ? '' : value);
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function sanitizeProps(props) {
  if (!props || typeof props !== 'object') return {};

  const out = {};
  const keys = Object.keys(props).slice(0, MAX_KEYS);
  keys.forEach((key) => {
    // Keep param keys stable and simple for WeChat Custom Analysis configuration.
    if (!key || typeof key !== 'string') return;
    const safeKey = key.trim();
    if (!safeKey) return;

    const v = props[key];
    if (v === undefined) return;
    if (v === null) {
      out[safeKey] = '';
      return;
    }
    if (typeof v === 'number') {
      out[safeKey] = Number.isFinite(v) ? v : 0;
      return;
    }
    if (typeof v === 'boolean') {
      out[safeKey] = v ? 1 : 0;
      return;
    }

    out[safeKey] = truncateString(v, MAX_STR_LEN);
  });

  return out;
}

function isEnabled() {
  try {
    const app = getApp && getApp();
    if (!app || !app.globalData) return true;
    if (Object.prototype.hasOwnProperty.call(app.globalData, 'analyticsEnabled')) {
      return !!app.globalData.analyticsEnabled;
    }
    return true;
  } catch (err) {
    return true;
  }
}

function report(eventId, props) {
  if (!eventId) return;
  if (!isEnabled()) return;
  const data = sanitizeProps(props);

  // Prefer the newer API if available, fallback for older base libraries.
  if (wx && typeof wx.reportEvent === 'function') {
    wx.reportEvent(String(eventId), data);
    return;
  }
  if (wx && typeof wx.reportAnalytics === 'function') {
    wx.reportAnalytics(String(eventId), data);
  }
}

function track(eventId, props) {
  try {
    report(eventId, props);
  } catch (err) {
    // Analytics must never break user flows.
  }
}

module.exports = {
  track,
  sanitizeProps,
};

