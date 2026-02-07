/**
 * Identity resolution and user management functions.
 */

const { rdbSelect, rdbInsert, rdbUpdate, cloudbaseFetch, systemAuthHeader } = require('./cloudbase');
const {
  toEq,
  lowerHeaders,
  pickHeaderValue,
  randomId,
  isMissingTableOrColumn,
} = require('./helpers');

const USER_SELECT_COLUMNS = 'id,user_id,openid,nickname,avatar_file_id,sex,birth_year,role,hyrox_level,best_hyrox_time,races_completed,preferred_division,training_focus,weekly_training_hours,seeking_partner,preferred_partner_role,partner_note,mbti,tags,bio,wechat_id,phone,created_at,updated_at';

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

async function ensureLegacyUser(openid, authHeader) {
  const existing = await rdbSelect('users', {
    select: USER_SELECT_COLUMNS,
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
    select: USER_SELECT_COLUMNS,
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
      select: 'id,user_id,provider,provider_uid,unionid',
      provider: toEq(provider),
      provider_uid: toEq(providerUid),
      limit: 1,
    }, authHeader);

    if ((!matchedLinks || matchedLinks.length === 0) && unionid) {
      matchedLinks = await rdbSelect('identity_links', {
        select: 'id,user_id,provider,provider_uid,unionid',
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

async function getAttendanceRecords(identity) {
  const authHeader = systemAuthHeader();
  const participantColumns = 'id,event_id,user_id,user_openid,user_nickname,user_avatar_file_id,division,team_name,event_title,event_date,event_location,base_strength,base_endurance,coach_adjust_strength,coach_adjust_endurance,final_strength,final_endurance,created_at';

  if (identity.userId) {
    try {
      const byUserId = await rdbSelect('event_participants', {
        select: participantColumns,
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
    select: participantColumns,
    user_openid: toEq(identity.openid),
    order: 'created_at.desc',
  }, authHeader);
}

module.exports = {
  resolveIdentityFromRequest,
  ensureIdentityMapping,
  ensureLegacyUser,
  safeEnsureUserRow,
  decodeCloudbaseContext,
  getAttendanceRecords,
  getAuthProfile,
  USER_SELECT_COLUMNS,
};
