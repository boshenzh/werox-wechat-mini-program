const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// Admin openids for permission check (should match utils/roles.js)
const ADMIN_OPENIDS = [
  'ozE5v3Two0JZBRbEMq22vgcgz-Es',
  'ozE5v3eJi7NnBfMvw0Arc6Ye1iQo',
];

/**
 * Admin Event Operations Cloud Function
 * Handles create, update, delete for events collection
 *
 * @param {object} event
 * @param {string} event.action - 'create' | 'update' | 'delete'
 * @param {string} event.eventId - Required for update/delete
 * @param {object} event.data - Event data for create/update
 */
exports.main = async (event, context) => {
  const { action, eventId, data } = event || {};
  const db = cloud.database();
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  // Permission check
  const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data.length ? userRes.data[0] : null;
  const isAdmin = (user && user.role === 'admin') || ADMIN_OPENIDS.includes(openid);

  if (!isAdmin) {
    return { success: false, error: 'permission_denied', message: '仅管理员可操作' };
  }

  try {
    switch (action) {
      case 'create': {
        if (!data || !data.title) {
          return { success: false, error: 'invalid_data', message: '缺少活动名称' };
        }
        const payload = {
          ...data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: openid,
        };
        const result = await db.collection('events').add({ data: payload });
        return { success: true, eventId: result._id, message: '赛事已创建' };
      }

      case 'update': {
        if (!eventId) {
          return { success: false, error: 'invalid_data', message: '缺少赛事ID' };
        }
        const payload = {
          ...data,
          updatedAt: Date.now(),
          updatedBy: openid,
        };
        await db.collection('events').doc(eventId).update({ data: payload });
        return { success: true, eventId, message: '赛事已更新' };
      }

      case 'delete': {
        if (!eventId) {
          return { success: false, error: 'invalid_data', message: '缺少赛事ID' };
        }
        await db.collection('events').doc(eventId).remove();
        return { success: true, eventId, message: '赛事已删除' };
      }

      default:
        return { success: false, error: 'invalid_action', message: '无效操作' };
    }
  } catch (err) {
    console.error('Admin event operation failed:', action, err);
    return { success: false, error: 'server_error', message: err.message || '操作失败' };
  }
};
