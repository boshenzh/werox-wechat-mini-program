/**
 * WeChat Subscribe Message Sender
 *
 * Non-blocking helper – every public function logs errors internally
 * and never throws, so callers can fire-and-forget without try/catch.
 *
 * Env vars:
 *   WX_APPID                          – Mini Program appid
 *   WX_APP_SECRET                     – Mini Program secret
 *   WX_SUBSCRIBE_TPL_WAITLIST_PROMOTED – Template ID for waitlist-promoted notice
 */

const TAG = '[wechat-msg]';

// ── In-memory access_token cache ────────────────────────────────────────────

let tokenCache = {
  token: null,
  expiresAt: 0, // epoch ms
};

/**
 * Obtain a valid access_token, using a cached value when possible.
 * WeChat tokens are valid for 7200 s; we refresh 5 min early to be safe.
 *
 * @returns {Promise<string|null>} access_token or null on failure
 */
async function getAccessToken() {
  const now = Date.now();

  if (tokenCache.token && now < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const appid = process.env.WX_APPID;
  const secret = process.env.WX_APP_SECRET;

  if (!appid || !secret) {
    console.warn(TAG, 'WX_APPID or WX_APP_SECRET not configured – skipping token fetch');
    return null;
  }

  try {
    const url =
      'https://api.weixin.qq.com/cgi-bin/token' +
      `?grant_type=client_credential&appid=${appid}&secret=${secret}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.errcode) {
      console.error(TAG, 'token fetch error:', data.errcode, data.errmsg);
      return null;
    }

    const expiresIn = data.expires_in || 7200;
    // Cache with 5-minute safety margin
    tokenCache = {
      token: data.access_token,
      expiresAt: now + (expiresIn - 300) * 1000,
    };

    console.log(TAG, 'access_token refreshed, expires_in', expiresIn, 's');
    return tokenCache.token;
  } catch (err) {
    console.error(TAG, 'token fetch exception:', err.message || err);
    return null;
  }
}

// ── Low-level send helper ───────────────────────────────────────────────────

/**
 * Call subscribeMessage.send.
 *
 * @param {string} accessToken
 * @param {object} payload  – full request body per WeChat API spec
 * @returns {Promise<boolean>} true if WeChat returned errcode 0
 */
async function sendSubscribeMessage(accessToken, payload) {
  const url =
    `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (data.errcode !== 0) {
    // errcode 43101 = user refused this template – expected, not a bug
    console.warn(TAG, 'subscribe send non-zero:', data.errcode, data.errmsg, '| touser:', payload.touser);
    return false;
  }

  console.log(TAG, 'subscribe message sent to', payload.touser);
  return true;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Notify a user that they have been promoted from the waitlist.
 *
 * Fire-and-forget: never throws.
 *
 * Template data fields (adjust keys if your template differs):
 *   thing1  – 赛事名称 (event title)
 *   date2   – 赛事时间 (event date)
 *   thing3  – 备注 (remark)
 *
 * @param {string} openid     – target user's openid
 * @param {string} eventTitle – event name (≤20 chars recommended)
 * @param {string} eventDate  – human-readable date string, e.g. "2026-03-15"
 */
async function sendWaitlistPromotedNotice(openid, eventTitle, eventDate) {
  try {
    if (!openid) {
      console.warn(TAG, 'sendWaitlistPromotedNotice: missing openid – skipped');
      return;
    }

    const templateId = process.env.WX_SUBSCRIBE_TPL_WAITLIST_PROMOTED;
    if (!templateId) {
      console.warn(TAG, 'WX_SUBSCRIBE_TPL_WAITLIST_PROMOTED not set – skipped');
      return;
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return; // error already logged
    }

    const payload = {
      touser: openid,
      template_id: templateId,
      // page: optional – landing page when user taps the notification
      page: '',
      miniprogram_state: process.env.NODE_ENV === 'production' ? 'formal' : 'trial',
      lang: 'zh_CN',
      data: {
        thing1: { value: (eventTitle || '').slice(0, 20) || '赛事' },
        date2:  { value: eventDate || '待定' },
        thing3: { value: '你已从候补名单晋级，请尽快确认报名信息' },
      },
    };

    await sendSubscribeMessage(accessToken, payload);
  } catch (err) {
    // Non-blocking: swallow all errors
    console.error(TAG, 'sendWaitlistPromotedNotice error:', err.message || err);
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  sendWaitlistPromotedNotice,
};
