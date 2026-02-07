/**
 * Environment variables and constants for the werox-bff service.
 */

const TCB_ENV_ID = process.env.TCB_ENV_ID || process.env.ENV_ID || '';
const TCB_API_KEY = process.env.TCB_API_KEY || '';
const TCB_AUTH_CLIENT_ID = process.env.TCB_AUTH_CLIENT_ID || '';
const TCB_AUTH_CLIENT_SECRET = process.env.TCB_AUTH_CLIENT_SECRET || '';
const TCB_AUTH_PROVIDER_ID = process.env.TCB_AUTH_PROVIDER_ID || 'wechat';
const PORT = Number(process.env.PORT || 3000);

const CLOUD_BASE_URL = `https://${TCB_ENV_ID}.api.tcloudbasegateway.com`;
const DEFAULT_TIMEOUT_MS = 12000;

// Allowed roles for user role assignment
const VALID_ROLES = ['runner', 'coach', 'organizer', 'admin'];

// Input validation limits
const LIMITS = {
  division: 64,
  team_name: 128,
  note: 512,
  nickname: 64,
  bio: 1000,
  wechat_id: 64,
  mbti: 16,
  partner_note: 512,
  training_focus: 64,
  hyrox_level: 64,
  preferred_partner_role: 64,
};

if (!TCB_ENV_ID) {
  console.warn('[werox-bff] Missing TCB_ENV_ID. API calls will fail until configured.');
}
if (!TCB_API_KEY) {
  console.warn('[werox-bff] Missing TCB_API_KEY. DB operations will fail until configured.');
}

module.exports = {
  TCB_ENV_ID,
  TCB_API_KEY,
  TCB_AUTH_CLIENT_ID,
  TCB_AUTH_CLIENT_SECRET,
  TCB_AUTH_PROVIDER_ID,
  PORT,
  CLOUD_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  VALID_ROLES,
  LIMITS,
};
