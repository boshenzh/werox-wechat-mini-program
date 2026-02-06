const crypto = require('crypto');
const express = require('express');

const app = express();
app.use(express.json({ limit: '512kb' }));

const TCB_ENV_ID = process.env.TCB_ENV_ID || process.env.ENV_ID || '';
const TCB_API_KEY = process.env.TCB_API_KEY || '';
const TCB_AUTH_CLIENT_ID = process.env.TCB_AUTH_CLIENT_ID || '';
const TCB_AUTH_CLIENT_SECRET = process.env.TCB_AUTH_CLIENT_SECRET || '';
const TCB_AUTH_PROVIDER_ID = process.env.TCB_AUTH_PROVIDER_ID || 'wechat';
const PORT = Number(process.env.PORT || 3000);

if (!TCB_ENV_ID) {
  // eslint-disable-next-line no-console
  console.warn('[werox-bff] Missing TCB_ENV_ID. API calls will fail until configured.');
}
if (!TCB_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[werox-bff] Missing TCB_API_KEY. DB operations will fail until configured.');
}

const CLOUD_BASE_URL = `https://${TCB_ENV_ID}.api.tcloudbasegateway.com`;
const DEFAULT_TIMEOUT_MS = 12000;

function jsonOk(res, data) {
  return res.json({ success: true, data });
}

function jsonFail(res, status, code, message, extra) {
  return res.status(status).json({
    success: false,
    code,
    message,
    ...(extra || {}),
  });
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function toEq(value) {
  return `eq.${String(value)}`;
}

function lowerHeaders(headers) {
  return Object.keys(headers || {}).reduce((acc, key) => {
    acc[key.toLowerCase()] = headers[key];
    return acc;
  }, {});
}

function parseJsonIfString(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags;
  if (typeof rawTags === 'string') {
    const parsed = parseJsonIfString(rawTags, null);
    if (Array.isArray(parsed)) return parsed;
    return rawTags
      .split(/,|，/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeUserProfile(row) {
  const safe = row || {};
  return {
    id: safe.id || null,
    user_id: safe.user_id || null,
    openid: safe.openid || '',
    nickname: safe.nickname || '',
    avatar_file_id: safe.avatar_file_id || '',
    sex: safe.sex || '',
    birth_year: safe.birth_year || null,
    role: safe.role || 'runner',
    hyrox_level: safe.hyrox_level || '',
    best_hyrox_time: safe.best_hyrox_time || '',
    races_completed: safe.races_completed || 0,
    preferred_division: safe.preferred_division || '',
    training_focus: safe.training_focus || '',
    weekly_training_hours: safe.weekly_training_hours || null,
    seeking_partner: !!safe.seeking_partner,
    preferred_partner_role: safe.preferred_partner_role || '',
    partner_note: safe.partner_note || '',
    mbti: safe.mbti || '',
    tags: parseTags(safe.tags),
    bio: safe.bio || '',
    wechat_id: safe.wechat_id || '',
    phone: safe.phone || '',
    created_at: safe.created_at || null,
    updated_at: safe.updated_at || null,
  };
}

function buildUrl(pathname, query) {
  const url = new URL(pathname, CLOUD_BASE_URL);
  Object.keys(query || {}).forEach((key) => {
    const value = query[key];
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function cloudbaseFetch(pathname, options = {}) {
  const {
    method = 'GET',
    headers = {},
    query = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!TCB_ENV_ID) {
    throw new Error('missing_env_id');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(pathname, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (err) {
      payload = text;
    }

    if (!response.ok) {
      const error = new Error('cloudbase_api_error');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function systemAuthHeader() {
  if (!TCB_API_KEY) {
    throw new Error('missing_tcb_api_key');
  }
  return `Bearer ${TCB_API_KEY}`;
}

function authClientHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (TCB_AUTH_CLIENT_ID && TCB_AUTH_CLIENT_SECRET) {
    const token = Buffer.from(`${TCB_AUTH_CLIENT_ID}:${TCB_AUTH_CLIENT_SECRET}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

async function rdbSelect(table, query = {}, authHeader) {
  return cloudbaseFetch(`/v1/rdb/rest/${table}`, {
    method: 'GET',
    query,
    headers: {
      Accept: 'application/json',
      Authorization: authHeader,
    },
  });
}

async function rdbInsert(table, body, authHeader) {
  return cloudbaseFetch(`/v1/rdb/rest/${table}`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      Authorization: authHeader,
    },
  });
}

async function rdbUpdate(table, query, body, authHeader) {
  return cloudbaseFetch(`/v1/rdb/rest/${table}`, {
    method: 'PATCH',
    query,
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      Authorization: authHeader,
    },
  });
}

async function storageGetDownloadInfo(cloudObjectIds = [], authHeader) {
  const items = (cloudObjectIds || [])
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => ({ cloudObjectId: item.trim() }));
  if (items.length === 0) return [];
  return cloudbaseFetch('/v1/storages/get-objects-download-info', {
    method: 'POST',
    body: items,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authHeader,
    },
  });
}

function isMissingTableOrColumn(error) {
  const text = JSON.stringify((error && error.payload) || error || {});
  return text.includes('RESOURCE_NOT_FOUND')
    || text.includes('column')
    || text.includes('does not exist')
    || text.includes('Unknown column');
}

async function ensureLegacyUser(openid, authHeader) {
  const existing = await rdbSelect('users', {
    select: '*',
    openid: toEq(openid),
    limit: 1,
  }, authHeader);

  if (existing && existing.length > 0) {
    return existing[0];
  }

  const inserted = await rdbInsert('users', {
    openid,
    _openid: openid,
    role: 'runner',
  }, authHeader);

  if (inserted && inserted.length > 0) {
    return inserted[0];
  }

  throw new Error('legacy_user_create_failed');
}

async function safeEnsureUserRow({ openid, userId, authHeader }) {
  if (!openid) return null;

  const existing = await rdbSelect('users', {
    select: '*',
    openid: toEq(openid),
    limit: 1,
  }, authHeader);

  if (existing && existing.length > 0) {
    const row = existing[0];
    if (userId && row.user_id !== userId) {
      try {
        await rdbUpdate('users', { id: toEq(row.id) }, { user_id: userId }, authHeader);
      } catch (error) {
        if (!isMissingTableOrColumn(error)) throw error;
      }
    }
    return row;
  }

  try {
    const inserted = await rdbInsert('users', {
      openid,
      _openid: openid,
      role: 'runner',
      ...(userId ? { user_id: userId } : {}),
    }, authHeader);
    if (inserted && inserted.length > 0) {
      return inserted[0];
    }
  } catch (error) {
    if (!isMissingTableOrColumn(error)) throw error;
    const fallback = await rdbInsert('users', {
      openid,
      _openid: openid,
      role: 'runner',
    }, authHeader);
    if (fallback && fallback.length > 0) {
      return fallback[0];
    }
  }

  return null;
}

async function ensureIdentityMapping({ provider, providerUid, unionid, appid, openid }) {
  const authHeader = systemAuthHeader();

  if (!provider || !providerUid) {
    throw new Error('missing_provider_identity');
  }

  try {
    let matchedLinks = await rdbSelect('identity_links', {
      select: '*',
      provider: toEq(provider),
      provider_uid: toEq(providerUid),
      limit: 1,
    }, authHeader);

    if ((!matchedLinks || matchedLinks.length === 0) && unionid) {
      matchedLinks = await rdbSelect('identity_links', {
        select: '*',
        unionid: toEq(unionid),
        limit: 1,
      }, authHeader);
    }

    let userId = matchedLinks && matchedLinks.length > 0 ? matchedLinks[0].user_id : null;

    if (!userId) {
      const createdUsers = await rdbInsert('app_users', {
        status: 'active',
        role: 'runner',
      }, authHeader);
      userId = createdUsers && createdUsers[0] ? createdUsers[0].id : null;
      if (!userId) throw new Error('create_app_user_failed');

      await rdbInsert('identity_links', {
        _openid: openid || '',
        user_id: userId,
        provider,
        provider_uid: providerUid,
        unionid: unionid || null,
        appid: appid || null,
      }, authHeader);
    } else {
      const exact = (matchedLinks || []).find(
        (item) => item.provider === provider && item.provider_uid === providerUid
      );
      if (!exact) {
        await rdbInsert('identity_links', {
          _openid: openid || '',
          user_id: userId,
          provider,
          provider_uid: providerUid,
          unionid: unionid || null,
          appid: appid || null,
        }, authHeader);
      }
    }

    const row = await safeEnsureUserRow({ openid, userId, authHeader });
    return {
      mode: 'identity',
      userId,
      openid: openid || '',
      unionid: unionid || '',
      appid: appid || '',
      row,
    };
  } catch (error) {
    if (!openid || !isMissingTableOrColumn(error)) {
      throw error;
    }

    const row = await ensureLegacyUser(openid, authHeader);
    return {
      mode: 'legacy',
      userId: row.id,
      openid,
      unionid: unionid || '',
      appid: appid || '',
      row,
    };
  }
}

function decodeCloudbaseContext(encoded) {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const data = JSON.parse(json);
    return data && typeof data === 'object' ? data : null;
  } catch (err) {
    return null;
  }
}

function pickHeaderValue(raw) {
  if (Array.isArray(raw)) return raw[0] || '';
  return raw || '';
}

async function getAuthProfile(token) {
  const data = await cloudbaseFetch('/auth/v1/user/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-device-id': randomId('device'),
    },
  });
  return data || {};
}

async function resolveIdentityFromRequest(req, options = {}) {
  const { requireMini = false } = options;
  const headers = lowerHeaders(req.headers || {});
  const openid = pickHeaderValue(headers['x-wx-openid']);
  const unionid = pickHeaderValue(headers['x-wx-unionid']);
  const appid = pickHeaderValue(headers['x-wx-appid']);
  const cloudCtx = decodeCloudbaseContext(pickHeaderValue(headers['x-cloudbase-context'])) || {};

  const finalOpenid = openid || cloudCtx.openId || cloudCtx.openid || '';
  const finalUnionid = unionid || cloudCtx.unionId || cloudCtx.unionid || '';
  const finalAppid = appid || cloudCtx.appId || cloudCtx.appid || '';

  if (finalOpenid) {
    return ensureIdentityMapping({
      provider: 'wechat_mini',
      providerUid: finalOpenid,
      unionid: finalUnionid,
      appid: finalAppid,
      openid: finalOpenid,
    });
  }

  if (requireMini) {
    throw new Error('mini_identity_required');
  }

  const authHeader = pickHeaderValue(headers.authorization || '');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('missing_identity');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('missing_identity');
  }

  const profile = await getAuthProfile(token);
  const sub = profile.sub || profile.user_id || '';
  if (!sub) {
    throw new Error('invalid_auth_profile');
  }

  const authOpenid = profile.open_id || profile.openid || `auth_sub_${sub}`;

  const mapped = await ensureIdentityMapping({
    provider: 'cloudbase_auth',
    providerUid: String(sub),
    unionid: '',
    appid: '',
    openid: authOpenid,
  });

  mapped.authProfile = profile;
  return mapped;
}

function computeScores(records) {
  const list = records || [];
  if (!list.length) {
    return { strength: 0, endurance: 0 };
  }

  let strengthSum = 0;
  let enduranceSum = 0;
  list.forEach((row) => {
    const baseStrength = Number(row.base_strength || 0);
    const baseEndurance = Number(row.base_endurance || 0);
    const adjustStrength = Number(row.coach_adjust_strength || 0);
    const adjustEndurance = Number(row.coach_adjust_endurance || 0);
    const finalStrength = Number(row.final_strength || baseStrength + adjustStrength);
    const finalEndurance = Number(row.final_endurance || baseEndurance + adjustEndurance);
    strengthSum += finalStrength;
    enduranceSum += finalEndurance;
  });

  return {
    strength: Number((strengthSum / list.length).toFixed(1)),
    endurance: Number((enduranceSum / list.length).toFixed(1)),
  };
}

async function getAttendanceRecords(identity) {
  const authHeader = systemAuthHeader();

  if (identity.userId) {
    try {
      const byUserId = await rdbSelect('event_participants', {
        select: '*',
        user_id: toEq(identity.userId),
        order: 'created_at.desc',
      }, authHeader);
      if (Array.isArray(byUserId) && byUserId.length > 0) {
        return byUserId;
      }
    } catch (error) {
      if (!isMissingTableOrColumn(error)) {
        throw error;
      }
    }
  }

  if (!identity.openid) return [];
  return rdbSelect('event_participants', {
    select: '*',
    user_openid: toEq(identity.openid),
    order: 'created_at.desc',
  }, authHeader);
}

function isPrivilegedUser(identity) {
  const role = identity && identity.row && identity.row.role
    ? String(identity.row.role).toLowerCase()
    : '';
  return role === 'admin' || role === 'organizer';
}

async function getEventById(eventId, authHeader) {
  const events = await rdbSelect('events', {
    select: 'id,title,status,event_date,event_time,location',
    id: toEq(eventId),
    limit: 1,
  }, authHeader);
  return events && events.length > 0 ? events[0] : null;
}

async function getEventParticipant(eventId, identity, authHeader) {
  if (!eventId) return null;

  if (identity && identity.userId) {
    try {
      const rows = await rdbSelect('event_participants', {
        select: 'id,event_id,user_id,user_openid',
        event_id: toEq(eventId),
        user_id: toEq(identity.userId),
        limit: 1,
      }, authHeader);
      if (rows && rows.length > 0) {
        return rows[0];
      }
    } catch (error) {
      if (!isMissingTableOrColumn(error)) throw error;
    }
  }

  if (!identity || !identity.openid) return null;

  const fallbackRows = await rdbSelect('event_participants', {
    select: 'id,event_id,user_id,user_openid',
    event_id: toEq(eventId),
    user_openid: toEq(identity.openid),
    limit: 1,
  }, authHeader);
  return fallbackRows && fallbackRows.length > 0 ? fallbackRows[0] : null;
}

function normalizeAlbumRow(row, identity, privileged) {
  const safe = row || {};
  const ownerByUserId = !!(
    identity
    && identity.userId
    && safe.uploader_user_id
    && Number(identity.userId) === Number(safe.uploader_user_id)
  );
  const ownerByOpenid = !!(
    identity
    && identity.openid
    && safe.uploader_openid
    && identity.openid === safe.uploader_openid
  );
  return {
    id: safe.id || null,
    event_id: safe.event_id || null,
    file_id: safe.file_id || '',
    thumb_file_id: safe.thumb_file_id || '',
    file_path: safe.file_path || '',
    mime_type: safe.mime_type || '',
    width: safe.width || null,
    height: safe.height || null,
    size_bytes: safe.size_bytes || null,
    shot_at: safe.shot_at || null,
    status: safe.status || 'active',
    created_at: safe.created_at || null,
    uploader_openid: safe.uploader_openid || '',
    can_delete: !!(privileged || ownerByUserId || ownerByOpenid),
  };
}

async function attachIdentity(req, res, next) {
  try {
    req.identity = await resolveIdentityFromRequest(req);
    next();
  } catch (error) {
    if (error.message === 'missing_identity') {
      return jsonFail(res, 401, 'UNAUTHORIZED', '未识别登录身份');
    }
    return jsonFail(res, 401, 'IDENTITY_RESOLVE_FAILED', '身份解析失败', {
      detail: error.message,
    });
  }
}

app.get('/health', (req, res) => {
  jsonOk(res, {
    service: 'werox-bff',
    env: TCB_ENV_ID || '',
    ts: Date.now(),
  });
});

app.post('/v1/auth/mini/resolve', async (req, res) => {
  try {
    const identity = await resolveIdentityFromRequest(req, { requireMini: true });
    jsonOk(res, {
      user_id: identity.userId || null,
      openid: identity.openid || '',
      unionid: identity.unionid || '',
      profile: normalizeUserProfile(identity.row),
      identity_mode: identity.mode,
    });
  } catch (error) {
    jsonFail(res, 401, 'MINI_IDENTITY_FAILED', '小程序身份解析失败', {
      detail: error.message,
    });
  }
});

app.post('/v1/auth/ios/wechat/signin', async (req, res) => {
  try {
    const body = req.body || {};
    const providerId = body.provider_id || TCB_AUTH_PROVIDER_ID || 'wechat';
    const deviceId = body.device_id || randomId('ios');

    let providerToken = body.provider_token || '';
    let providerProfile = null;

    if (!providerToken) {
      if (!body.provider_code) {
        return jsonFail(res, 400, 'INVALID_PARAMS', '缺少 provider_token 或 provider_code');
      }

      const grant = await cloudbaseFetch('/auth/v1/provider/token', {
        method: 'POST',
        query: TCB_AUTH_CLIENT_ID ? { client_id: TCB_AUTH_CLIENT_ID } : {},
        headers: authClientHeaders({ 'x-device-id': deviceId }),
        body: {
          provider_id: providerId,
          provider_code: body.provider_code,
          provider_redirect_uri: body.provider_redirect_uri || undefined,
        },
      });

      providerToken = grant && grant.provider_token ? String(grant.provider_token) : '';
      providerProfile = grant && grant.provider_profile ? grant.provider_profile : null;
      if (!providerToken) {
        return jsonFail(res, 401, 'PROVIDER_TOKEN_FAILED', '换取 provider_token 失败');
      }
    }

    const signInResult = await cloudbaseFetch('/auth/v1/signin/with/provider', {
      method: 'POST',
      query: TCB_AUTH_CLIENT_ID ? { client_id: TCB_AUTH_CLIENT_ID } : {},
      headers: authClientHeaders({ 'x-device-id': deviceId }),
      body: {
        provider_id: providerId,
        provider_token: providerToken,
        force_disable_sign_up: !!body.force_disable_sign_up,
        sync_profile: body.sync_profile !== false,
      },
    });

    const accessToken = signInResult && signInResult.access_token ? String(signInResult.access_token) : '';
    if (!accessToken) {
      return jsonFail(res, 401, 'IOS_SIGNIN_FAILED', 'iOS 登录失败');
    }

    const profile = await getAuthProfile(accessToken);
    const providerUid = String(
      body.provider_uid
      || (providerProfile && providerProfile.sub)
      || profile.open_id
      || profile.sub
      || ''
    );

    if (!providerUid) {
      return jsonFail(res, 500, 'IDENTITY_INCOMPLETE', '缺少可用身份标识');
    }

    const unionid = String(
      body.unionid
      || (providerProfile && providerProfile.unionid)
      || ((providerProfile && providerProfile.meta && providerProfile.meta.unionid) || '')
      || ''
    );

    const openid = String(body.openid || profile.open_id || '');

    const identity = await ensureIdentityMapping({
      provider: 'wechat_ios',
      providerUid,
      unionid,
      appid: '',
      openid: openid || `ios_${providerUid}`,
    });

    jsonOk(res, {
      token: signInResult,
      user_id: identity.userId || null,
      profile: normalizeUserProfile(identity.row),
      identity_mode: identity.mode,
    });
  } catch (error) {
    jsonFail(res, 500, 'IOS_SIGNIN_ERROR', 'iOS 登录处理失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.get('/v1/events', attachIdentity, async (req, res) => {
  try {
    const authHeader = systemAuthHeader();
    const events = await rdbSelect('events', {
      select: 'id,title,location,event_date,event_time,cover_url,status,base_strength,base_endurance,format_mode,event_type,latitude,longitude,max_participants',
      order: 'event_date.asc',
    }, authHeader);

    const participants = await rdbSelect('event_participants', {
      select: 'event_id,user_avatar_file_id',
      order: 'created_at.desc',
    }, authHeader).catch(() => []);

    const grouped = (participants || []).reduce((acc, item) => {
      const key = String(item.event_id || '');
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = {
          count: 0,
          avatar_file_ids: [],
        };
      }
      acc[key].count += 1;
      const avatar = item.user_avatar_file_id || '';
      if (avatar && acc[key].avatar_file_ids.length < 3 && !acc[key].avatar_file_ids.includes(avatar)) {
        acc[key].avatar_file_ids.push(avatar);
      }
      return acc;
    }, {});

    const mapped = (events || []).map((item) => {
      const meta = grouped[String(item.id)] || { count: 0, avatar_file_ids: [] };
      return {
        ...item,
        participant_count: meta.count,
        participant_avatar_file_ids: meta.avatar_file_ids,
      };
    });

    jsonOk(res, { events: mapped });
  } catch (error) {
    jsonFail(res, 500, 'EVENTS_QUERY_FAILED', '赛事查询失败', {
      detail: error.message,
    });
  }
});

app.get('/v1/events/:id', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const authHeader = systemAuthHeader();

    const events = await rdbSelect('events', {
      select: '*',
      id: toEq(eventId),
      limit: 1,
    }, authHeader);

    if (!events || events.length === 0) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const [stations, participants] = await Promise.all([
      rdbSelect('event_stations', {
        select: '*',
        event_id: toEq(eventId),
        order: 'station_order.asc',
      }, authHeader).catch(() => []),
      rdbSelect('event_participants', {
        select: '*',
        event_id: toEq(eventId),
        order: 'created_at.desc',
      }, authHeader).catch(() => []),
    ]);

    jsonOk(res, {
      event: events[0],
      stations: stations || [],
      participants: participants || [],
    });
  } catch (error) {
    jsonFail(res, 500, 'EVENT_DETAIL_FAILED', '赛事详情查询失败', {
      detail: error.message,
    });
  }
});

app.get('/v1/events/:id/registration/me', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;

    let rows = [];
    if (identity.userId) {
      try {
        rows = await rdbSelect('event_participants', {
          select: 'id,event_id,user_id,user_openid',
          event_id: toEq(eventId),
          user_id: toEq(identity.userId),
          limit: 1,
        }, authHeader);
      } catch (error) {
        if (!isMissingTableOrColumn(error)) throw error;
      }
    }

    if ((!rows || rows.length === 0) && identity.openid) {
      rows = await rdbSelect('event_participants', {
        select: 'id,event_id,user_id,user_openid',
        event_id: toEq(eventId),
        user_openid: toEq(identity.openid),
        limit: 1,
      }, authHeader);
    }

    jsonOk(res, {
      is_signed: !!(rows && rows.length > 0),
      registration: rows && rows.length > 0 ? rows[0] : null,
    });
  } catch (error) {
    jsonFail(res, 500, 'REGISTRATION_CHECK_FAILED', '报名状态查询失败', {
      detail: error.message,
    });
  }
});

app.post('/v1/events/:id/registrations', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const body = req.body || {};
    const division = String(body.division || '').trim();
    const teamName = String(body.team_name || '').trim();
    const note = String(body.note || '').trim();

    if (!division) {
      return jsonFail(res, 400, 'DIVISION_REQUIRED', '请选择报名组别');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;

    const events = await rdbSelect('events', {
      select: '*',
      id: toEq(eventId),
      limit: 1,
    }, authHeader);

    if (!events || events.length === 0) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const event = events[0];

    const existed = await rdbSelect('event_participants', {
      select: 'id',
      event_id: toEq(eventId),
      ...(identity.userId ? { user_id: toEq(identity.userId) } : { user_openid: toEq(identity.openid) }),
      limit: 1,
    }, authHeader).catch(async (error) => {
      if (!isMissingTableOrColumn(error)) throw error;
      return rdbSelect('event_participants', {
        select: 'id',
        event_id: toEq(eventId),
        user_openid: toEq(identity.openid),
        limit: 1,
      }, authHeader);
    });

    if (existed && existed.length > 0) {
      return jsonFail(res, 409, 'ALREADY_SIGNED', '你已报名过');
    }

    const allParticipants = await rdbSelect('event_participants', {
      select: 'id',
      event_id: toEq(eventId),
    }, authHeader);

    const maxParticipants = Number(event.max_participants || 0);
    if (maxParticipants > 0 && (allParticipants || []).length >= maxParticipants) {
      return jsonFail(res, 409, 'EVENT_FULL', '报名已满');
    }

    const profile = normalizeUserProfile(identity.row);
    const priceOpen = Number(event.price_open || 0);
    const priceDoubles = Number(event.price_doubles || 0);
    const priceRelay = Number(event.price_relay || 0);

    let paymentAmount = priceOpen;
    if (/Doubles/i.test(division)) paymentAmount = priceDoubles;
    if (/Relay/i.test(division)) paymentAmount = priceRelay;

    const payload = {
      _openid: identity.openid || '',
      event_id: eventId,
      ...(identity.userId ? { user_id: identity.userId } : {}),
      user_openid: identity.openid || '',
      division,
      team_name: teamName,
      note,
      event_title: event.title || '',
      event_date: event.event_date || '',
      event_location: event.location || '',
      user_nickname: profile.nickname || '',
      user_wechat_id: profile.wechat_id || '',
      user_sex: profile.sex || '',
      user_avatar_file_id: profile.avatar_file_id || '',
      payment_amount: paymentAmount,
      payment_status: 'pending',
      base_strength: Number(event.base_strength || 5),
      base_endurance: Number(event.base_endurance || 5),
      final_strength: Number(event.base_strength || 5),
      final_endurance: Number(event.base_endurance || 5),
    };

    const inserted = await rdbInsert('event_participants', payload, authHeader);
    jsonOk(res, {
      registration: inserted && inserted[0] ? inserted[0] : null,
    });
  } catch (error) {
    jsonFail(res, 500, 'REGISTRATION_CREATE_FAILED', '报名失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.get('/v1/events/:id/album/summary', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;
    const event = await getEventById(eventId, authHeader);
    if (!event) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const privileged = isPrivilegedUser(identity);
    const participant = await getEventParticipant(eventId, identity, authHeader).catch(() => null);
    const canView = !!(privileged || participant);
    const canUpload = canView;

    let totalPhotos = 0;
    try {
      const rows = await rdbSelect('event_album_photos', {
        select: 'id',
        event_id: toEq(eventId),
        status: toEq('active'),
      }, authHeader);
      totalPhotos = Array.isArray(rows) ? rows.length : 0;
    } catch (error) {
      if (!isMissingTableOrColumn(error)) throw error;
    }

    jsonOk(res, {
      event_id: eventId,
      total_photos: totalPhotos,
      can_view: canView,
      can_upload: canUpload,
    });
  } catch (error) {
    jsonFail(res, 500, 'ALBUM_SUMMARY_FAILED', '相册信息查询失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.get('/v1/events/:id/album', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const queryLimit = Number(req.query.limit || 20);
    const queryOffset = Number(req.query.offset || 0);
    const limit = Number.isFinite(queryLimit) ? Math.min(Math.max(queryLimit, 1), 50) : 20;
    const offset = Number.isFinite(queryOffset) ? Math.max(queryOffset, 0) : 0;

    const authHeader = systemAuthHeader();
    const identity = req.identity;

    const event = await getEventById(eventId, authHeader);
    if (!event) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const privileged = isPrivilegedUser(identity);
    const participant = await getEventParticipant(eventId, identity, authHeader);
    if (!privileged && !participant) {
      return jsonFail(res, 403, 'ALBUM_FORBIDDEN', '仅参赛者可查看相册');
    }

    const rows = await rdbSelect('event_album_photos', {
      select: 'id,event_id,file_id,thumb_file_id,file_path,mime_type,width,height,size_bytes,shot_at,status,created_at,uploader_openid,uploader_user_id',
      event_id: toEq(eventId),
      status: toEq('active'),
      order: 'created_at.desc,id.desc',
      offset,
      limit: limit + 1,
    }, authHeader).catch((error) => {
      if (isMissingTableOrColumn(error)) return [];
      throw error;
    });

    const hasMore = Array.isArray(rows) && rows.length > limit;
    const list = (rows || []).slice(0, limit).map((item) => normalizeAlbumRow(item, identity, privileged));

    jsonOk(res, {
      photos: list,
      pagination: {
        offset,
        limit,
        has_more: hasMore,
        next_offset: hasMore ? offset + limit : null,
      },
    });
  } catch (error) {
    jsonFail(res, 500, 'ALBUM_LIST_FAILED', '相册列表查询失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.post('/v1/events/:id/album/photos', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;
    const body = req.body || {};
    const fileId = String(body.file_id || '').trim();

    if (!fileId || !fileId.startsWith('cloud://')) {
      return jsonFail(res, 400, 'INVALID_FILE_ID', '缺少有效的文件ID');
    }

    const event = await getEventById(eventId, authHeader);
    if (!event) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const privileged = isPrivilegedUser(identity);
    const participant = await getEventParticipant(eventId, identity, authHeader);
    if (!privileged && !participant) {
      return jsonFail(res, 403, 'ALBUM_UPLOAD_FORBIDDEN', '仅参赛者可上传照片');
    }

    const payload = {
      _openid: identity.openid || '',
      event_id: eventId,
      uploader_openid: identity.openid || '',
      uploader_role: identity && identity.row && identity.row.role ? identity.row.role : 'runner',
      ...(identity.userId ? { uploader_user_id: identity.userId } : {}),
      file_id: fileId,
      thumb_file_id: String(body.thumb_file_id || '').trim() || null,
      file_path: String(body.file_path || '').trim() || null,
      mime_type: String(body.mime_type || '').trim() || null,
      width: body.width !== undefined && body.width !== null ? Number(body.width) : null,
      height: body.height !== undefined && body.height !== null ? Number(body.height) : null,
      size_bytes: body.size_bytes !== undefined && body.size_bytes !== null ? Number(body.size_bytes) : null,
      shot_at: body.shot_at ? String(body.shot_at) : null,
      status: 'active',
    };

    const inserted = await rdbInsert('event_album_photos', payload, authHeader);
    const row = inserted && inserted[0] ? inserted[0] : null;
    if (!row) {
      throw new Error('album_photo_create_failed');
    }

    jsonOk(res, {
      photo: normalizeAlbumRow(row, identity, privileged),
    });
  } catch (error) {
    jsonFail(res, 500, 'ALBUM_UPLOAD_FAILED', '照片上传登记失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.get('/v1/events/:id/album/photos/:photoId/download', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(eventId) || !Number.isFinite(photoId)) {
      return jsonFail(res, 400, 'INVALID_PARAMS', '参数不合法');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;
    const privileged = isPrivilegedUser(identity);
    const participant = await getEventParticipant(eventId, identity, authHeader);
    if (!privileged && !participant) {
      return jsonFail(res, 403, 'ALBUM_DOWNLOAD_FORBIDDEN', '仅参赛者可下载照片');
    }

    const rows = await rdbSelect('event_album_photos', {
      select: 'id,event_id,file_id,download_count,status',
      id: toEq(photoId),
      event_id: toEq(eventId),
      limit: 1,
    }, authHeader).catch((error) => {
      if (isMissingTableOrColumn(error)) return [];
      throw error;
    });

    if (!rows || rows.length === 0 || rows[0].status === 'deleted') {
      return jsonFail(res, 404, 'PHOTO_NOT_FOUND', '照片不存在');
    }

    const photo = rows[0];
    let downloadUrl = '';
    let downloadUrlEncoded = '';
    try {
      const downloadInfo = await storageGetDownloadInfo([photo.file_id], authHeader);
      const first = Array.isArray(downloadInfo) && downloadInfo.length > 0 ? downloadInfo[0] : null;
      if (first && !first.code && first.downloadUrl) {
        downloadUrl = first.downloadUrl;
        downloadUrlEncoded = first.downloadUrlEncoded || first.downloadUrl;
      }
    } catch (error) {
      // Fallback to file_id mode. Mini program can resolve temp URL after permission check.
      downloadUrl = '';
      downloadUrlEncoded = '';
    }

    const currentCount = Number(photo.download_count || 0);
    await rdbUpdate('event_album_photos', {
      id: toEq(photoId),
    }, {
      download_count: currentCount + 1,
    }, authHeader).catch(() => null);

    jsonOk(res, {
      photo_id: photoId,
      download_url: downloadUrl,
      download_url_encoded: downloadUrlEncoded,
      file_id: photo.file_id || '',
    });
  } catch (error) {
    jsonFail(res, 500, 'ALBUM_DOWNLOAD_FAILED', '照片下载失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.delete('/v1/events/:id/album/photos/:photoId', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(eventId) || !Number.isFinite(photoId)) {
      return jsonFail(res, 400, 'INVALID_PARAMS', '参数不合法');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;
    const privileged = isPrivilegedUser(identity);

    const rows = await rdbSelect('event_album_photos', {
      select: 'id,event_id,uploader_user_id,uploader_openid,status',
      id: toEq(photoId),
      event_id: toEq(eventId),
      limit: 1,
    }, authHeader).catch((error) => {
      if (isMissingTableOrColumn(error)) return [];
      throw error;
    });

    if (!rows || rows.length === 0) {
      return jsonFail(res, 404, 'PHOTO_NOT_FOUND', '照片不存在');
    }

    const photo = rows[0];
    const ownerByUserId = !!(
      identity.userId
      && photo.uploader_user_id
      && Number(identity.userId) === Number(photo.uploader_user_id)
    );
    const ownerByOpenid = !!(
      identity.openid
      && photo.uploader_openid
      && identity.openid === photo.uploader_openid
    );

    if (!privileged && !ownerByUserId && !ownerByOpenid) {
      return jsonFail(res, 403, 'ALBUM_DELETE_FORBIDDEN', '仅上传者或管理员可删除');
    }

    await rdbUpdate('event_album_photos', {
      id: toEq(photoId),
    }, {
      status: 'deleted',
    }, authHeader);

    jsonOk(res, {
      photo_id: photoId,
      deleted: true,
    });
  } catch (error) {
    jsonFail(res, 500, 'ALBUM_DELETE_FAILED', '删除照片失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.get('/v1/me', attachIdentity, async (req, res) => {
  try {
    const identity = req.identity;
    const attendance = await getAttendanceRecords(identity);
    const scores = computeScores(attendance || []);

    jsonOk(res, {
      user_id: identity.userId || null,
      openid: identity.openid || '',
      unionid: identity.unionid || '',
      identity_mode: identity.mode,
      profile: normalizeUserProfile(identity.row),
      attendance_records: attendance || [],
      scores,
    });
  } catch (error) {
    jsonFail(res, 500, 'ME_QUERY_FAILED', '获取个人信息失败', {
      detail: error.message,
    });
  }
});

app.patch('/v1/me/profile', attachIdentity, async (req, res) => {
  try {
    const identity = req.identity;
    const row = identity.row;
    if (!row || !row.id) {
      return jsonFail(res, 404, 'PROFILE_NOT_FOUND', '用户资料不存在');
    }

    const body = req.body || {};
    const tags = Array.isArray(body.tags)
      ? body.tags
      : parseTags(body.tags || '');

    const payload = {
      nickname: body.nickname !== undefined ? String(body.nickname || '') : row.nickname,
      birth_year: body.birth_year !== undefined && body.birth_year !== null && body.birth_year !== ''
        ? Number(body.birth_year)
        : null,
      bio: body.bio !== undefined ? String(body.bio || '') : row.bio,
      avatar_file_id: body.avatar_file_id !== undefined ? String(body.avatar_file_id || '') : row.avatar_file_id,
      wechat_id: body.wechat_id !== undefined ? String(body.wechat_id || '') : row.wechat_id,
      tags: JSON.stringify(tags),
      sex: body.sex !== undefined ? String(body.sex || '') : row.sex,
      training_focus: body.training_focus !== undefined ? String(body.training_focus || '') : row.training_focus,
      hyrox_level: body.hyrox_level !== undefined ? String(body.hyrox_level || '') : row.hyrox_level,
      preferred_partner_role: body.preferred_partner_role !== undefined
        ? String(body.preferred_partner_role || '')
        : row.preferred_partner_role,
      partner_note: body.partner_note !== undefined ? String(body.partner_note || '') : row.partner_note,
      mbti: body.mbti !== undefined ? String(body.mbti || '') : row.mbti,
    };

    const authHeader = systemAuthHeader();
    const updated = await rdbUpdate('users', {
      id: toEq(row.id),
    }, payload, authHeader);

    const profile = normalizeUserProfile(updated && updated[0] ? updated[0] : { ...row, ...payload, tags });
    jsonOk(res, { profile });
  } catch (error) {
    jsonFail(res, 500, 'PROFILE_UPDATE_FAILED', '资料更新失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

app.get('/v1/users/by-openid/:openid', attachIdentity, async (req, res) => {
  try {
    const openid = String(req.params.openid || '').trim();
    if (!openid) {
      return jsonFail(res, 400, 'INVALID_OPENID', 'openid 不能为空');
    }

    const authHeader = systemAuthHeader();
    const users = await rdbSelect('users', {
      select: '*',
      openid: toEq(openid),
      limit: 1,
    }, authHeader);

    if (!users || users.length === 0) {
      return jsonOk(res, {
        profile: null,
        attendance_records: [],
        scores: { strength: 0, endurance: 0 },
      });
    }

    const attendance = await rdbSelect('event_participants', {
      select: '*',
      user_openid: toEq(openid),
      order: 'created_at.desc',
    }, authHeader).catch(() => []);

    jsonOk(res, {
      profile: normalizeUserProfile(users[0]),
      attendance_records: attendance || [],
      scores: computeScores(attendance || []),
    });
  } catch (error) {
    jsonFail(res, 500, 'USER_QUERY_FAILED', '用户查询失败', {
      detail: error.message,
    });
  }
});

app.use((err, req, res, next) => {
  jsonFail(res, 500, 'INTERNAL_ERROR', '服务内部错误', {
    detail: err && err.message ? err.message : 'unknown_error',
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[werox-bff] listening on ${PORT}`);
});
