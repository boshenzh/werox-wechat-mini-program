/**
 * "Me" routes: get current user profile, update profile.
 */

const express = require('express');
const router = express.Router();

const { attachIdentity } = require('../middleware/auth');
const { systemAuthHeader, rdbUpdate } = require('../lib/cloudbase');
const { getAttendanceRecords } = require('../lib/identity');
const {
  jsonOk,
  jsonFail,
  toEq,
  parseTags,
  normalizeUserProfile,
  computeScores,
  sanitizeProfileInput,
} = require('../lib/helpers');

router.get('/v1/me', attachIdentity, async (req, res) => {
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

// Lightweight role-only endpoint to avoid fetching full profile + attendance
router.get('/v1/me/role', attachIdentity, async (req, res) => {
  try {
    const identity = req.identity;
    const role = identity && identity.row && identity.row.role
      ? String(identity.row.role)
      : 'runner';
    jsonOk(res, { role });
  } catch (error) {
    jsonFail(res, 500, 'ME_ROLE_FAILED', '获取角色失败', {
      detail: error.message,
    });
  }
});

router.patch('/v1/me/profile', attachIdentity, async (req, res) => {
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

    // Sanitize string fields with length limits
    const sanitized = sanitizeProfileInput(body, row);

    const payload = {
      ...sanitized,
      birth_year: body.birth_year !== undefined && body.birth_year !== null && body.birth_year !== ''
        ? Number(body.birth_year)
        : null,
      avatar_file_id: body.avatar_file_id !== undefined ? String(body.avatar_file_id || '') : row.avatar_file_id,
      tags: JSON.stringify(tags),
      sex: body.sex !== undefined ? String(body.sex || '') : row.sex,
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

module.exports = router;
