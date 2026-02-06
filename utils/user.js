/**
 * User profile utilities
 * Backend-first implementation for unified Mini Program + iOS architecture.
 */

const { resolveMiniIdentity, getMe } = require('./api');

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
 * Get user role from backend profile.
 */
async function getUserRole() {
  try {
    const me = await getMe();
    const role = me && me.profile && me.profile.role ? me.profile.role : '';
    return role || 'runner';
  } catch (err) {
    console.error('Failed to get user role:', err);
    return 'runner';
  }
}

module.exports = {
  DEFAULT_PROFILE,
  getOrCreateProfile,
  getCurrentOpenid,
  getUserRole,
};
