/**
 * Album routes: summary, list, upload, download, delete.
 */

const express = require('express');
const router = express.Router();

const { attachIdentity } = require('../middleware/auth');
const { systemAuthHeader, rdbSelect, rdbInsert, rdbUpdate, storageGetDownloadInfo } = require('../lib/cloudbase');
const {
  jsonOk,
  jsonFail,
  toEq,
  normalizeAlbumRow,
  isPrivilegedUser,
  isMissingTableOrColumn,
} = require('../lib/helpers');

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

router.get('/v1/events/:id/album/summary', attachIdentity, async (req, res) => {
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

router.get('/v1/events/:id/album', attachIdentity, async (req, res) => {
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

router.post('/v1/events/:id/album/photos', attachIdentity, async (req, res) => {
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

router.get('/v1/events/:id/album/photos/:photoId/download', attachIdentity, async (req, res) => {
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

    // -- KNOWN_LIMITATION: Non-atomic download count increment.
    // The CloudBase REST API does not support SQL expressions in PATCH (e.g. `download_count = download_count + 1`).
    // This read-then-write approach has a minor race condition under concurrent downloads, which may
    // cause the count to be slightly inaccurate. Acceptable for analytics-grade counters.
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

router.delete('/v1/events/:id/album/photos/:photoId', attachIdentity, async (req, res) => {
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

module.exports = router;
