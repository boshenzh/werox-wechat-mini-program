const { callBackend } = require('./backend');
const {
  parseTags,
  normalizeProfile,
  computeScores,
  normalizeAlbumPhoto,
  isPrivilegedRole,
} = require('./normalizers');

const BACKEND_UNAVAILABLE_PATTERNS = [
  'INVALID_HOST',
  'Invalid host',
  'SERVICE_NOT_FOUND',
  'SERVICE_ENDPOINT_NOT_FOUND',
  'SERVICE_FORBIDDEN',
  'SERVICE_VERSION_NOT_FOUND',
  'SERVICE_NOT_READY',
  'SERVICE_LB_STATUS_ABNORMAL',
  'IDENTITY_RESOLVE_FAILED',
  'MINI_IDENTITY_FAILED',
  'UNAUTHORIZED',
  'ME_QUERY_FAILED',
  'ME_ROLE_FAILED',
  'EVENTS_QUERY_FAILED',
  'EVENT_DETAIL_FAILED',
];

function stringifyError(err) {
  if (!err) return '';
  try {
    return JSON.stringify(err);
  } catch (jsonErr) {
    return String(err);
  }
}

function isBackendUnavailableError(err) {
  // Treat certain backend misconfigurations as "unavailable" so core pages can
  // fall back to the local DB path instead of hard-failing.
  //
  // Typical case: CloudRun is online, but missing required env vars (e.g.
  // `TCB_API_KEY`) so every request fails with 401/5xx.
  const payload = err && err.payload && typeof err.payload === 'object' ? err.payload : null;
  if (payload) {
    const code = String(payload.code || err.code || '');
    const detail = String(payload.detail || '');
    if (code === 'MISSING_TCB_API_KEY') return true;
    if (code === 'TCB_API_KEY_INVALID') return true;
    // When API key is missing, BFF may wrap it in different route-level error codes.
    // Use `detail` as a stable signal.
    if (detail.includes('missing_tcb_api_key')) return true;
    if (detail.toLowerCase().includes('missing') && detail.toLowerCase().includes('tcb_api_key')) return true;
    if (code === 'IDENTITY_RESOLVE_FAILED' && detail.includes('missing_tcb_api_key')) return true;
  }
  // Treat HTTP 401 (identity failure) and 503 (service unavailable) as backend-down
  // so that core pages fall back to local DB queries instead of hard-failing.
  const statusCode = Number(err && err.statusCode ? err.statusCode : 0);
  if (statusCode === 401 || statusCode === 503) return true;

  const text = `${err && err.message ? err.message : ''} ${stringifyError(err && err.payload ? err.payload : err)}`;
  return BACKEND_UNAVAILABLE_PATTERNS.some((item) => text.includes(item));
}

async function withFallback(remoteAction, localAction, actionName) {
  try {
    return await remoteAction();
  } catch (err) {
    if (!isBackendUnavailableError(err)) throw err;
    console.warn(`[api] ${actionName} fallback to local mode:`, err && err.message ? err.message : err);
    return localAction();
  }
}

async function getDB() {
  const app = getApp();
  if (!app || !app.globalData || typeof app.globalData.getDB !== 'function') {
    throw new Error('数据库未初始化');
  }
  return app.globalData.getDB();
}

function ensureResultOk(result, message) {
  if (result && result.error) {
    const errMsg = result.error.message || message || '数据库操作失败';
    const error = new Error(errMsg);
    error.payload = result.error;
    throw error;
  }
}

async function getOpenidByFunction() {
  const res = await wx.cloud.callFunction({ name: 'getOpenId' });
  const openid = res && res.result ? res.result.openid : '';
  if (!openid) {
    throw new Error('获取 openid 失败，请确认 getOpenId 云函数已部署');
  }
  return openid;
}

async function ensureUserByOpenid(db, openid) {
  const queryResult = await db
    .from('users')
    .select('*')
    .eq('openid', openid)
    .limit(1);
  ensureResultOk(queryResult, '查询用户失败');

  const existing = queryResult && Array.isArray(queryResult.data) ? queryResult.data[0] : null;
  if (existing) return existing;

  const insertResult = await db
    .from('users')
    .insert({
      openid,
      _openid: openid,
      role: 'runner',
    })
    .select()
    .single();
  ensureResultOk(insertResult, '创建用户失败');
  return insertResult.data || null;
}

async function localResolveMiniIdentity() {
  const db = await getDB();
  const openid = await getOpenidByFunction();
  const row = await ensureUserByOpenid(db, openid);
  return {
    user_id: row && row.user_id ? row.user_id : (row && row.id ? row.id : null),
    openid,
    unionid: '',
    profile: normalizeProfile(row),
    identity_mode: 'local_fallback',
  };
}

async function localGetMe() {
  const db = await getDB();
  const openid = await getOpenidByFunction();
  const row = await ensureUserByOpenid(db, openid);

  const attendanceResult = await db
    .from('event_participants')
    .select('*')
    .eq('user_openid', openid)
    .order('created_at', { ascending: false });
  ensureResultOk(attendanceResult, '查询报名记录失败');

  const attendance = (attendanceResult && attendanceResult.data) || [];
  return {
    user_id: row && row.user_id ? row.user_id : (row && row.id ? row.id : null),
    openid,
    unionid: '',
    identity_mode: 'local_fallback',
    profile: normalizeProfile(row),
    attendance_records: attendance,
    scores: computeScores(attendance),
  };
}

async function localGetUserByOpenid(openid) {
  const db = await getDB();
  const safeOpenid = String(openid || '').trim();
  if (!safeOpenid) {
    return {
      profile: null,
      attendance_records: [],
      scores: { strength: 0, endurance: 0 },
    };
  }

  const userResult = await db
    .from('users')
    .select('*')
    .eq('openid', safeOpenid)
    .limit(1);
  ensureResultOk(userResult, '查询用户失败');
  const user = userResult && Array.isArray(userResult.data) ? userResult.data[0] : null;
  if (!user) {
    return {
      profile: null,
      attendance_records: [],
      scores: { strength: 0, endurance: 0 },
    };
  }

  const attendanceResult = await db
    .from('event_participants')
    .select('*')
    .eq('user_openid', safeOpenid)
    .order('created_at', { ascending: false });
  ensureResultOk(attendanceResult, '查询报名记录失败');
  const attendance = (attendanceResult && attendanceResult.data) || [];
  return {
    profile: normalizeProfile(user),
    attendance_records: attendance,
    scores: computeScores(attendance),
  };
}

async function localUpdateMyProfile(payload) {
  const db = await getDB();
  const openid = await getOpenidByFunction();
  const row = await ensureUserByOpenid(db, openid);

  const tags = Array.isArray(payload && payload.tags)
    ? payload.tags
    : parseTags(payload && payload.tags ? payload.tags : row.tags);

  const nextPayload = {
    ...(payload || {}),
    tags: JSON.stringify(tags),
  };
  if (Object.prototype.hasOwnProperty.call(nextPayload, 'user_id')) {
    delete nextPayload.user_id;
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, 'id')) {
    delete nextPayload.id;
  }

  const updateResult = await db
    .from('users')
    .update(nextPayload)
    .eq('id', row.id)
    .select()
    .single();
  ensureResultOk(updateResult, '更新用户资料失败');
  return {
    profile: normalizeProfile(updateResult.data || { ...row, ...nextPayload }),
  };
}

async function localListEvents() {
  const db = await getDB();
  const eventsResult = await db
    .from('events')
    .select('id,title,location,event_date,event_time,cover_url,status,base_strength,base_endurance,format_mode,event_type,latitude,longitude,max_participants')
    .order('event_date', { ascending: true });
  ensureResultOk(eventsResult, '查询赛事失败');

  const participantsResult = await db
    .from('event_participants')
    .select('event_id,user_avatar_file_id')
    .order('created_at', { ascending: false });
  ensureResultOk(participantsResult, '查询报名数据失败');

  const participantRows = (participantsResult && participantsResult.data) || [];
  const grouped = participantRows.reduce((acc, item) => {
    const eventId = item && item.event_id ? String(item.event_id) : '';
    if (!eventId) return acc;
    if (!acc[eventId]) {
      acc[eventId] = { count: 0, avatarFileIds: [] };
    }
    acc[eventId].count += 1;
    const avatarFileId = item.user_avatar_file_id || '';
    if (avatarFileId && acc[eventId].avatarFileIds.length < 3 && !acc[eventId].avatarFileIds.includes(avatarFileId)) {
      acc[eventId].avatarFileIds.push(avatarFileId);
    }
    return acc;
  }, {});

  const events = ((eventsResult && eventsResult.data) || []).map((item) => {
    const meta = grouped[String(item.id)] || { count: 0, avatarFileIds: [] };
    return {
      ...item,
      participant_count: meta.count,
      participant_avatar_file_ids: meta.avatarFileIds,
    };
  });
  return { events };
}

async function localGetEventDetail(eventId) {
  const db = await getDB();
  const safeEventId = Number(eventId);
  if (!Number.isFinite(safeEventId)) {
    throw new Error('赛事ID不合法');
  }

  const eventResult = await db
    .from('events')
    .select('*')
    .eq('id', safeEventId)
    .limit(1);
  ensureResultOk(eventResult, '查询赛事失败');

  const event = eventResult && Array.isArray(eventResult.data) ? eventResult.data[0] : null;
  if (!event) {
    throw new Error('赛事不存在');
  }

  const stationsResult = await db
    .from('event_stations')
    .select('*')
    .eq('event_id', safeEventId)
    .order('station_order', { ascending: true });
  ensureResultOk(stationsResult, '查询站点失败');

  const participantsResult = await db
    .from('event_participants')
    .select('*')
    .eq('event_id', safeEventId)
    .order('created_at', { ascending: false });
  ensureResultOk(participantsResult, '查询报名失败');

  return {
    event,
    stations: (stationsResult && stationsResult.data) || [],
    participants: (participantsResult && participantsResult.data) || [],
  };
}

async function localGetMyRegistration(eventId) {
  const db = await getDB();
  const openid = await getOpenidByFunction();
  const safeEventId = Number(eventId);
  if (!Number.isFinite(safeEventId)) {
    throw new Error('赛事ID不合法');
  }

  const result = await db
    .from('event_participants')
    .select('id,event_id,user_id,user_openid')
    .eq('event_id', safeEventId)
    .eq('user_openid', openid)
    .limit(1);
  ensureResultOk(result, '查询报名状态失败');

  const registration = result && Array.isArray(result.data) ? result.data[0] : null;
  return {
    is_signed: !!registration,
    registration: registration || null,
  };
}

async function localCreateRegistration(eventId, payload) {
  const db = await getDB();
  const safeEventId = Number(eventId);
  if (!Number.isFinite(safeEventId)) {
    throw new Error('赛事ID不合法');
  }

  const me = await localGetMe();
  const openid = me.openid || '';
  const profile = me.profile || {};

  const eventResult = await db
    .from('events')
    .select('*')
    .eq('id', safeEventId)
    .limit(1);
  ensureResultOk(eventResult, '查询赛事失败');
  const event = eventResult && Array.isArray(eventResult.data) ? eventResult.data[0] : null;
  if (!event) {
    throw new Error('赛事不存在');
  }

  const existedResult = await db
    .from('event_participants')
    .select('id')
    .eq('event_id', safeEventId)
    .eq('user_openid', openid)
    .limit(1);
  ensureResultOk(existedResult, '查询报名状态失败');
  if (existedResult && Array.isArray(existedResult.data) && existedResult.data.length > 0) {
    throw new Error('你已报名过');
  }

  const allResult = await db
    .from('event_participants')
    .select('id')
    .eq('event_id', safeEventId);
  ensureResultOk(allResult, '查询报名人数失败');

  const maxParticipants = Number(event.max_participants || 0);
  const allParticipants = (allResult && allResult.data) || [];
  if (maxParticipants > 0 && allParticipants.length >= maxParticipants) {
    throw new Error('报名已满');
  }

  const division = String(payload && payload.division ? payload.division : '').trim();
  if (!division) {
    throw new Error('请选择组别');
  }
  const teamName = String(payload && payload.team_name ? payload.team_name : '').trim();
  const note = String(payload && payload.note ? payload.note : '').trim();

  const priceOpen = Number(event.price_open || 0);
  const priceDoubles = Number(event.price_doubles || 0);
  const priceRelay = Number(event.price_relay || 0);
  let paymentAmount = priceOpen;
  if (/Doubles/i.test(division)) paymentAmount = priceDoubles;
  if (/Relay/i.test(division)) paymentAmount = priceRelay;

  const insertPayload = {
    _openid: openid,
    event_id: safeEventId,
    user_openid: openid,
    division,
    team_name: teamName,
    note,
    event_title: event.title || '',
    event_date: event.event_date || '',
    event_location: event.location || '',
    user_nickname: profile.nickname || '',
    user_wechat_id: profile.wechat_id || '',
    user_sex: profile.sex || '',
    user_avatar_file_id: profile.avatar_file_id || '',
    payment_amount: paymentAmount,
    payment_status: 'pending',
    base_strength: Number(event.base_strength || 5),
    base_endurance: Number(event.base_endurance || 5),
    final_strength: Number(event.base_strength || 5),
    final_endurance: Number(event.base_endurance || 5),
    user_id: me.user_id || null,
  };

  let insertResult = await db
    .from('event_participants')
    .insert(insertPayload)
    .select()
    .single();

  if (insertResult && insertResult.error && String(insertResult.error.message || '').includes('Unknown column')) {
    const retryPayload = { ...insertPayload };
    delete retryPayload.user_id;
    insertResult = await db
      .from('event_participants')
      .insert(retryPayload)
      .select()
      .single();
  }
  ensureResultOk(insertResult, '报名失败');

  return {
    registration: insertResult.data || null,
  };
}

async function localGetAlbumAccess(eventId) {
  const db = await getDB();
  const safeEventId = Number(eventId);
  if (!Number.isFinite(safeEventId)) {
    throw new Error('赛事ID不合法');
  }

  const openid = await getOpenidByFunction();
  const userRow = await ensureUserByOpenid(db, openid);
  const userId = userRow && userRow.user_id ? userRow.user_id : null;
  const privileged = isPrivilegedRole(userRow && userRow.role ? userRow.role : '');

  let participantRow = null;
  if (userId) {
    const resultByUserId = await db
      .from('event_participants')
      .select('id,user_id,user_openid')
      .eq('event_id', safeEventId)
      .eq('user_id', userId)
      .limit(1);
    if (!resultByUserId.error && resultByUserId.data && resultByUserId.data[0]) {
      participantRow = resultByUserId.data[0];
    }
  }

  if (!participantRow) {
    const resultByOpenid = await db
      .from('event_participants')
      .select('id,user_id,user_openid')
      .eq('event_id', safeEventId)
      .eq('user_openid', openid)
      .limit(1);
    ensureResultOk(resultByOpenid, '查询赛事参与状态失败');
    participantRow = resultByOpenid && resultByOpenid.data ? resultByOpenid.data[0] : null;
  }

  const canView = !!(privileged || participantRow);
  const canUpload = canView;
  return {
    eventId: safeEventId,
    openid,
    user_id: userId,
    role: userRow && userRow.role ? userRow.role : 'runner',
    privileged,
    canView,
    canUpload,
  };
}

async function localGetEventAlbumSummary(eventId) {
  const db = await getDB();
  const access = await localGetAlbumAccess(eventId);
  const result = await db
    .from('event_album_photos')
    .select('id')
    .eq('event_id', access.eventId)
    .eq('status', 'active');
  ensureResultOk(result, '查询相册信息失败');

  return {
    event_id: access.eventId,
    total_photos: Array.isArray(result.data) ? result.data.length : 0,
    can_view: access.canView,
    can_upload: access.canUpload,
  };
}

async function localGetEventAlbum(eventId, options = {}) {
  const db = await getDB();
  const access = await localGetAlbumAccess(eventId);
  if (!access.canView) {
    throw new Error('仅参赛者可查看相册');
  }

  const safeLimit = Number.isFinite(Number(options.limit))
    ? Math.min(Math.max(Number(options.limit), 1), 50)
    : 20;
  const safeOffset = Number.isFinite(Number(options.offset))
    ? Math.max(Number(options.offset), 0)
    : 0;

  const result = await db
    .from('event_album_photos')
    .select('id,event_id,file_id,thumb_file_id,file_path,mime_type,width,height,size_bytes,shot_at,status,created_at,uploader_openid,uploader_user_id')
    .eq('event_id', access.eventId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit);
  ensureResultOk(result, '查询相册失败');

  const rows = (result && result.data) || [];
  const hasMore = rows.length > safeLimit;
  const photos = rows
    .slice(0, safeLimit)
    .map((item) => normalizeAlbumPhoto(item, access, access.privileged));

  return {
    photos,
    pagination: {
      offset: safeOffset,
      limit: safeLimit,
      has_more: hasMore,
      next_offset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

async function localCreateEventAlbumPhoto(eventId, payload = {}) {
  const db = await getDB();
  const access = await localGetAlbumAccess(eventId);
  if (!access.canUpload) {
    throw new Error('仅参赛者可上传照片');
  }

  const fileId = String(payload.file_id || '').trim();
  if (!fileId || !fileId.startsWith('cloud://')) {
    throw new Error('缺少有效文件ID');
  }

  const insertResult = await db
    .from('event_album_photos')
    .insert({
      _openid: access.openid,
      event_id: access.eventId,
      uploader_user_id: access.user_id || null,
      uploader_openid: access.openid,
      uploader_role: access.role || 'runner',
      file_id: fileId,
      thumb_file_id: payload.thumb_file_id ? String(payload.thumb_file_id) : null,
      file_path: payload.file_path ? String(payload.file_path) : null,
      mime_type: payload.mime_type ? String(payload.mime_type) : null,
      width: payload.width !== undefined && payload.width !== null ? Number(payload.width) : null,
      height: payload.height !== undefined && payload.height !== null ? Number(payload.height) : null,
      size_bytes: payload.size_bytes !== undefined && payload.size_bytes !== null ? Number(payload.size_bytes) : null,
      shot_at: payload.shot_at ? String(payload.shot_at) : null,
      status: 'active',
    })
    .select()
    .single();
  ensureResultOk(insertResult, '保存照片失败');

  return {
    photo: normalizeAlbumPhoto(insertResult.data || {}, access, access.privileged),
  };
}

async function localGetEventAlbumPhotoDownloadUrl(eventId, photoId) {
  const db = await getDB();
  const access = await localGetAlbumAccess(eventId);
  if (!access.canView) {
    throw new Error('仅参赛者可下载照片');
  }

  const safePhotoId = Number(photoId);
  if (!Number.isFinite(safePhotoId)) {
    throw new Error('照片ID不合法');
  }

  const photoResult = await db
    .from('event_album_photos')
    .select('id,file_id,status,event_id')
    .eq('id', safePhotoId)
    .eq('event_id', access.eventId)
    .limit(1);
  ensureResultOk(photoResult, '查询照片失败');

  const row = photoResult && Array.isArray(photoResult.data) ? photoResult.data[0] : null;
  if (!row || row.status === 'deleted') {
    throw new Error('照片不存在');
  }

  let downloadUrl = row.file_id;
  if (wx.cloud && typeof wx.cloud.getTempFileURL === 'function' && row.file_id) {
    const urlRes = await wx.cloud.getTempFileURL({ fileList: [row.file_id] });
    const fileList = (urlRes && urlRes.fileList) || [];
    const first = fileList[0] || {};
    if (first.tempFileURL) {
      downloadUrl = first.tempFileURL;
    }
  }

  return {
    photo_id: safePhotoId,
    download_url: downloadUrl,
    download_url_encoded: downloadUrl,
  };
}

async function localDeleteEventAlbumPhoto(eventId, photoId) {
  const db = await getDB();
  const access = await localGetAlbumAccess(eventId);
  const safePhotoId = Number(photoId);
  if (!Number.isFinite(safePhotoId)) {
    throw new Error('照片ID不合法');
  }

  const photoResult = await db
    .from('event_album_photos')
    .select('id,uploader_user_id,uploader_openid,status,event_id')
    .eq('id', safePhotoId)
    .eq('event_id', access.eventId)
    .limit(1);
  ensureResultOk(photoResult, '查询照片失败');
  const row = photoResult && Array.isArray(photoResult.data) ? photoResult.data[0] : null;
  if (!row) {
    throw new Error('照片不存在');
  }

  const ownerByUserId = !!(access.user_id && row.uploader_user_id && Number(access.user_id) === Number(row.uploader_user_id));
  const ownerByOpenid = !!(access.openid && row.uploader_openid && access.openid === row.uploader_openid);
  if (!access.privileged && !ownerByUserId && !ownerByOpenid) {
    throw new Error('仅上传者或管理员可删除');
  }

  const updateResult = await db
    .from('event_album_photos')
    .update({ status: 'deleted' })
    .eq('id', safePhotoId);
  ensureResultOk(updateResult, '删除照片失败');
  return {
    photo_id: safePhotoId,
    deleted: true,
  };
}

async function resolveMiniIdentity() {
  return withFallback(
    () => callBackend({
      path: '/v1/auth/mini/resolve',
      method: 'POST',
      data: {},
    }),
    () => localResolveMiniIdentity(),
    'resolveMiniIdentity'
  );
}

async function getMe() {
  return withFallback(
    () => callBackend({ path: '/v1/me', method: 'GET' }),
    () => localGetMe(),
    'getMe'
  );
}

async function updateMyProfile(payload) {
  return withFallback(
    () => callBackend({ path: '/v1/me/profile', method: 'PATCH', data: payload }),
    () => localUpdateMyProfile(payload),
    'updateMyProfile'
  );
}

async function listEvents() {
  return withFallback(
    () => callBackend({ path: '/v1/events', method: 'GET' }),
    () => localListEvents(),
    'listEvents'
  );
}

async function getEventDetail(eventId) {
  return withFallback(
    () => callBackend({ path: `/v1/events/${eventId}`, method: 'GET' }),
    () => localGetEventDetail(eventId),
    'getEventDetail'
  );
}

async function getMyRegistration(eventId) {
  return withFallback(
    () => callBackend({ path: `/v1/events/${eventId}/registration/me`, method: 'GET' }),
    () => localGetMyRegistration(eventId),
    'getMyRegistration'
  );
}

async function createRegistration(eventId, payload) {
  return withFallback(
    () => callBackend({
      path: `/v1/events/${eventId}/registrations`,
      method: 'POST',
      data: payload,
    }),
    () => localCreateRegistration(eventId, payload),
    'createRegistration'
  );
}

async function getUserByOpenid(openid) {
  const safe = encodeURIComponent(openid || '');
  return withFallback(
    () => callBackend({ path: `/v1/users/by-openid/${safe}`, method: 'GET' }),
    () => localGetUserByOpenid(openid),
    'getUserByOpenid'
  );
}

async function getEventAlbumSummary(eventId) {
  try {
    return await callBackend({ path: `/v1/events/${eventId}/album/summary`, method: 'GET' });
  } catch (err) {
    if (!isBackendUnavailableError(err)) throw err;
    const local = await localGetEventAlbumSummary(eventId);
    return {
      ...local,
      can_upload: false,
      backend_unavailable: true,
    };
  }
}

async function getEventAlbum(eventId, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 20;
  const offset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;
  return withFallback(
    () => callBackend({
      path: `/v1/events/${eventId}/album?offset=${offset}&limit=${limit}`,
      method: 'GET',
    }),
    () => localGetEventAlbum(eventId, { offset, limit }),
    'getEventAlbum'
  );
}

async function createEventAlbumPhoto(eventId, payload) {
  try {
    return await callBackend({
      path: `/v1/events/${eventId}/album/photos`,
      method: 'POST',
      data: payload || {},
    });
  } catch (err) {
    if (isBackendUnavailableError(err)) {
      throw new Error('上传服务暂不可用，请先部署云托管服务');
    }
    throw err;
  }
}

async function getEventAlbumPhotoDownloadUrl(eventId, photoId) {
  return withFallback(
    () => callBackend({
      path: `/v1/events/${eventId}/album/photos/${photoId}/download`,
      method: 'GET',
    }),
    () => localGetEventAlbumPhotoDownloadUrl(eventId, photoId),
    'getEventAlbumPhotoDownloadUrl'
  );
}

async function deleteEventAlbumPhoto(eventId, photoId) {
  try {
    return await callBackend({
      path: `/v1/events/${eventId}/album/photos/${photoId}`,
      method: 'DELETE',
    });
  } catch (err) {
    if (isBackendUnavailableError(err)) {
      throw new Error('删除服务暂不可用，请先部署云托管服务');
    }
    throw err;
  }
}

// --- Admin User Management ---

async function listUsers(options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 20;
  const offset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;
  const search = String(options.search || '').trim();
  let path = `/v1/users?offset=${offset}&limit=${limit}`;
  if (search) {
    path += `&search=${encodeURIComponent(search)}`;
  }
  return callBackend({ path, method: 'GET' });
}

async function updateUserRole(userId, role) {
  return callBackend({
    path: `/v1/users/${userId}/role`,
    method: 'PATCH',
    data: { role },
  });
}

// --- Lightweight role endpoint ---

async function getMyRole() {
  try {
    const result = await callBackend({ path: '/v1/me/role', method: 'GET' });
    return result && result.role ? result.role : 'runner';
  } catch (err) {
    // fallback: extract from cached getMe
    console.warn('[api] getMyRole fallback:', err && err.message);
    try {
      const me = await getMe();
      return me && me.profile && me.profile.role ? me.profile.role : 'runner';
    } catch (fallbackErr) {
      return 'runner';
    }
  }
}

module.exports = {
  resolveMiniIdentity,
  getMe,
  getMyRole,
  updateMyProfile,
  listEvents,
  getEventDetail,
  getMyRegistration,
  createRegistration,
  getUserByOpenid,
  getEventAlbumSummary,
  getEventAlbum,
  createEventAlbumPhoto,
  getEventAlbumPhotoDownloadUrl,
  deleteEventAlbumPhoto,
  listUsers,
  updateUserRole,
};
