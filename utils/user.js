/**
 * User profile utilities
 * Backend-first implementation for unified Mini Program + iOS architecture.
 */

const { resolveMiniIdentity, getMe, getMyRole } = require('./api');

/**
 * Default profile template for new users
 */
const DEFAULT_PROFILE = {
  nickname: '',
  avatar_file_id: '',
  sex: '',
  birth_year: null,
  role: 'runner',
  hyrox_level: '',
  best_hyrox_time: '',
  races_completed: 0,
  preferred_division: '',
  training_focus: '',
  weekly_training_hours: null,
  seeking_partner: false,
  preferred_partner_role: '',
  partner_note: '',
  mbti: '',
  tags: [],
  bio: '',
  wechat_id: '',
  phone: '',
};

/**
 * Get current user's openid via backend identity resolve.
 */
async function getCurrentOpenid() {
  const identity = await resolveMiniIdentity();
  const openid = identity && identity.openid ? identity.openid : '';
  if (!openid) {
    throw new Error('Failed to resolve openid');
  }
  return openid;
}

/**
 * Get current user's profile from backend.
 */
async function getOrCreateProfile(openid) {
  const me = await getMe();
  const profile = me && me.profile ? me.profile : null;
  if (profile) return profile;

  return {
    ...DEFAULT_PROFILE,
    openid: openid || (me && me.openid ? me.openid : ''),
  };
}

/**
 * Get user role from backend.
 * Uses lightweight /v1/me/role endpoint to avoid fetching full profile + attendance records.
 * Falls back to full getMe() if the lightweight endpoint is unavailable.
 */
async function getUserRole() {
  try {
    // Try lightweight endpoint first (avoids fetching attendance records + computing scores)
    const app = getApp();
    const cachedRole = app && app.globalData ? app.globalData._cachedRole : null;
    if (cachedRole) return cachedRole;

    const role = await getMyRole();
    if (app && app.globalData) {
      app.globalData._cachedRole = role;
    }
    return role;
  } catch (err) {
    console.error('Failed to get user role:', err);
    return 'runner';
  }
}

/**
 * Invalidate cached role (call after role changes).
 */
function clearRoleCache() {
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData._cachedRole = null;
    }
  } catch (err) {
    // ignore
  }
}

module.exports = {
  DEFAULT_PROFILE,
  getOrCreateProfile,
  getCurrentOpenid,
  getUserRole,
  clearRoleCache,
};
