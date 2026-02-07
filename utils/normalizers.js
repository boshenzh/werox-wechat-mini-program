/**
 * Shared normalizer functions used by both the mini program frontend (utils/api.js)
 * and the BFF backend (cloudrun/werox-bff/lib/helpers.js).
 *
 * This is the canonical source of truth. The BFF keeps a copy in lib/helpers.js
 * that should stay in sync with these definitions.
 */

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags;
  if (typeof rawTags === 'string') {
    try {
      const parsed = JSON.parse(rawTags);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      // fall through to comma split
    }
    return rawTags
      .split(/,|，/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeProfile(row) {
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
    races_completed: Number(safe.races_completed || 0),
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

function normalizeAlbumPhoto(row, identity, privileged) {
  identity = identity || {};
  const safe = row || {};
  const ownerByUserId = !!(
    identity.user_id
    && safe.uploader_user_id
    && Number(identity.user_id) === Number(safe.uploader_user_id)
  );
  const ownerByOpenid = !!(
    identity.openid
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

function isPrivilegedRole(role) {
  const safeRole = String(role || '').toLowerCase();
  return safeRole === 'admin' || safeRole === 'organizer';
}

module.exports = {
  parseTags,
  normalizeProfile,
  computeScores,
  normalizeAlbumPhoto,
  isPrivilegedRole,
};
