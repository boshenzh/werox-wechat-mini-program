/**
 * Shared helper/utility functions for the BFF.
 * Normalizer functions here mirror utils/normalizers.js (the canonical source).
 */

const crypto = require('crypto');
const { LIMITS } = require('./config');

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

function isMissingTableOrColumn(error) {
  const text = JSON.stringify((error && error.payload) || error || {});
  return text.includes('RESOURCE_NOT_FOUND')
    || text.includes('column')
    || text.includes('does not exist')
    || text.includes('Unknown column');
}

function isCloudbaseAuthError(error) {
  if (!error) return false;
  if (error.message !== 'cloudbase_api_error') return false;
  const status = Number(error.status || 0);
  return status === 401 || status === 403;
}

function isPrivilegedUser(identity) {
  const role = identity && identity.row && identity.row.role
    ? String(identity.row.role).toLowerCase()
    : '';
  return role === 'admin' || role === 'organizer';
}

function isAdminUser(identity) {
  const role = identity && identity.row && identity.row.role
    ? String(identity.row.role).toLowerCase()
    : '';
  return role === 'admin';
}

function pickHeaderValue(raw) {
  if (Array.isArray(raw)) return raw[0] || '';
  return raw || '';
}

/**
 * Truncate a string field to the configured max length.
 */
function truncateField(value, field) {
  const maxLen = LIMITS[field];
  if (!maxLen) return value;
  const str = String(value || '');
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

/**
 * Validate and sanitize registration input fields.
 */
function sanitizeRegistrationInput(body) {
  return {
    division: truncateField(String(body.division || '').trim(), 'division'),
    team_name: truncateField(String(body.team_name || '').trim(), 'team_name'),
    note: truncateField(String(body.note || '').trim(), 'note'),
  };
}

/**
 * Validate and sanitize profile update input fields.
 */
function sanitizeProfileInput(body, existing) {
  const result = {};
  if (body.nickname !== undefined) result.nickname = truncateField(body.nickname, 'nickname');
  else result.nickname = existing.nickname;

  if (body.bio !== undefined) result.bio = truncateField(body.bio, 'bio');
  else result.bio = existing.bio;

  if (body.wechat_id !== undefined) result.wechat_id = truncateField(body.wechat_id, 'wechat_id');
  else result.wechat_id = existing.wechat_id;

  if (body.mbti !== undefined) result.mbti = truncateField(body.mbti, 'mbti');
  else result.mbti = existing.mbti;

  if (body.partner_note !== undefined) result.partner_note = truncateField(body.partner_note, 'partner_note');
  else result.partner_note = existing.partner_note;

  if (body.training_focus !== undefined) result.training_focus = truncateField(body.training_focus, 'training_focus');
  else result.training_focus = existing.training_focus;

  if (body.hyrox_level !== undefined) result.hyrox_level = truncateField(body.hyrox_level, 'hyrox_level');
  else result.hyrox_level = existing.hyrox_level;

  if (body.preferred_partner_role !== undefined) result.preferred_partner_role = truncateField(body.preferred_partner_role, 'preferred_partner_role');
  else result.preferred_partner_role = existing.preferred_partner_role;

  return result;
}

module.exports = {
  jsonOk,
  jsonFail,
  randomId,
  toEq,
  lowerHeaders,
  parseJsonIfString,
  parseTags,
  normalizeUserProfile,
  normalizeAlbumRow,
  computeScores,
  isMissingTableOrColumn,
  isCloudbaseAuthError,
  isPrivilegedUser,
  isAdminUser,
  pickHeaderValue,
  truncateField,
  sanitizeRegistrationInput,
  sanitizeProfileInput,
};
