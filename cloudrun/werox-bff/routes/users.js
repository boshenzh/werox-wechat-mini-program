/**
 * User management routes: list users (admin), update user role (admin),
 * get user by openid.
 */

const express = require('express');
const router = express.Router();

const { attachIdentity } = require('../middleware/auth');
const { systemAuthHeader, rdbSelect, rdbUpdate } = require('../lib/cloudbase');
const { VALID_ROLES } = require('../lib/config');
const { USER_SELECT_COLUMNS, getAttendanceRecords } = require('../lib/identity');
const {
  jsonOk,
  jsonFail,
  toEq,
  normalizeUserProfile,
  computeScores,
  isAdminUser,
} = require('../lib/helpers');

// GET /v1/users — admin-only, list users with optional search
router.get('/v1/users', attachIdentity, async (req, res) => {
  try {
    const identity = req.identity;
    if (!isAdminUser(identity)) {
      return jsonFail(res, 403, 'FORBIDDEN', '仅管理员可查看用户列表');
    }

    const authHeader = systemAuthHeader();
    const queryLimit = Number(req.query.limit || 20);
    const queryOffset = Number(req.query.offset || 0);
    const limit = Number.isFinite(queryLimit) ? Math.min(Math.max(queryLimit, 1), 100) : 20;
    const offset = Number.isFinite(queryOffset) ? Math.max(queryOffset, 0) : 0;
    const search = String(req.query.search || '').trim();

    const query = {
      select: 'id,nickname,avatar_file_id,role,openid,created_at',
      order: 'created_at.desc',
      limit: limit + 1,
      offset,
    };

    // Nickname substring search via CloudBase REST API `like` operator
    if (search) {
      query.nickname = `like.%${search}%`;
    }

    const rows = await rdbSelect('users', query, authHeader);
    const hasMore = Array.isArray(rows) && rows.length > limit;
    const users = (rows || []).slice(0, limit).map((row) => ({
      id: row.id || null,
      nickname: row.nickname || '',
      avatar_file_id: row.avatar_file_id || '',
      role: row.role || 'runner',
      openid: row.openid || '',
      created_at: row.created_at || null,
    }));

    jsonOk(res, {
      users,
      pagination: {
        offset,
        limit,
        has_more: hasMore,
        next_offset: hasMore ? offset + limit : null,
      },
    });
  } catch (error) {
    jsonFail(res, 500, 'USERS_LIST_FAILED', '用户列表查询失败', {
      detail: error.message,
    });
  }
});

// PATCH /v1/users/:id/role — admin-only, update user role
router.patch('/v1/users/:id/role', attachIdentity, async (req, res) => {
  try {
    const identity = req.identity;
    if (!isAdminUser(identity)) {
      return jsonFail(res, 403, 'FORBIDDEN', '仅管理员可修改用户角色');
    }

    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return jsonFail(res, 400, 'INVALID_USER_ID', '用户ID不合法');
    }

    const body = req.body || {};
    const role = String(body.role || '').trim().toLowerCase();
    if (!VALID_ROLES.includes(role)) {
      return jsonFail(res, 400, 'INVALID_ROLE', `角色无效，可选值: ${VALID_ROLES.join(', ')}`);
    }

    const authHeader = systemAuthHeader();

    // Verify user exists
    const existing = await rdbSelect('users', {
      select: 'id,nickname,role',
      id: toEq(userId),
      limit: 1,
    }, authHeader);

    if (!existing || existing.length === 0) {
      return jsonFail(res, 404, 'USER_NOT_FOUND', '用户不存在');
    }

    const updated = await rdbUpdate('users', {
      id: toEq(userId),
    }, {
      role,
    }, authHeader);

    const updatedRow = updated && updated[0] ? updated[0] : { ...existing[0], role };
    jsonOk(res, {
      user: {
        id: updatedRow.id,
        nickname: updatedRow.nickname || '',
        avatar_file_id: updatedRow.avatar_file_id || '',
        role: updatedRow.role || role,
        openid: updatedRow.openid || '',
      },
    });
  } catch (error) {
    jsonFail(res, 500, 'USER_ROLE_UPDATE_FAILED', '角色更新失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

// GET /v1/users/by-openid/:openid — get user by openid (authenticated)
router.get('/v1/users/by-openid/:openid', attachIdentity, async (req, res) => {
  try {
    const openid = String(req.params.openid || '').trim();
    if (!openid) {
      return jsonFail(res, 400, 'INVALID_OPENID', 'openid 不能为空');
    }

    const authHeader = systemAuthHeader();
    const users = await rdbSelect('users', {
      select: USER_SELECT_COLUMNS,
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

    const participantColumns = 'id,event_id,user_id,user_openid,user_nickname,user_avatar_file_id,division,team_name,event_title,event_date,event_location,base_strength,base_endurance,coach_adjust_strength,coach_adjust_endurance,final_strength,final_endurance,created_at';
    const attendance = await rdbSelect('event_participants', {
      select: participantColumns,
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

module.exports = router;
