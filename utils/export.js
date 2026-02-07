const { getCurrentOpenid, getUserRole } = require('./user');

const EXPORT_ROLES = ['coach', 'admin', 'organizer'];

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsvContent(headers, rows) {
  const lines = [];
  lines.push(headers.map(escapeCsvCell).join(','));
  rows.forEach((row) => {
    lines.push(row.map(escapeCsvCell).join(','));
  });
  // Prefix with UTF-8 BOM so Excel can display Chinese correctly
  return `\uFEFF${lines.join('\n')}`;
}

function writeFile(filePath, content) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: content,
      encoding: 'utf8',
      success: resolve,
      fail: reject,
    });
  });
}

function openDocument(filePath) {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      showMenu: true,
      success: resolve,
      fail: reject,
    });
  });
}

function setClipboardData(data) {
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data,
      success: resolve,
      fail: reject,
    });
  });
}

async function openDocumentWithFallback(filePath, content) {
  try {
    await openDocument(filePath);
    return { mode: 'open_document', filePath };
  } catch (err) {
    // Some platforms don't support previewing CSV/TXT via `wx.openDocument`.
    // For these formats we fall back to clipboard even if the error message
    // varies by platform/language.
    const ext = String(filePath || '').split('.').pop().toLowerCase();
    const likelyUnsupportedByType = ext === 'csv' || ext === 'txt';

    const errMsg = err && err.errMsg ? String(err.errMsg) : '';
    const errText = errMsg.toLowerCase();
    const unsupportedByMessage = errText.includes('filetype not supported')
      || errText.includes('file type not supported')
      || errText.includes('unsupported file type')
      || errMsg.includes('文件类型')
      || errMsg.includes('不支持');

    if (!likelyUnsupportedByType && !unsupportedByMessage) throw err;

    // CSV (and txt) are not supported by openDocument on some platforms (e.g. Windows DevTools).
    // Fallback: copy CSV content to clipboard so admin can paste into Excel/Sheets.
    await setClipboardData(content);
    return { mode: 'clipboard', filePath };
  }
}

async function checkExportPermission() {
  const openid = await getCurrentOpenid();
  const role = await getUserRole(openid);
  return {
    openid,
    role,
    allowed: EXPORT_ROLES.includes(role),
  };
}

async function exportEventParticipantsCsv({ eventId, eventTitle = '' }) {
  if (!eventId) {
    throw new Error('missing_event_id');
  }

  const permission = await checkExportPermission();
  if (!permission.allowed) {
    const err = new Error('permission_denied');
    err.code = 'permission_denied';
    throw err;
  }

  const db = await getApp().globalData.getDB();
  const { data: participants, error } = await db
    .from('event_participants')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message || 'load_participants_failed');
  }

  const list = participants || [];
  const headers = [
    '报名ID',
    '用户OpenID',
    '昵称',
    '微信号',
    '性别',
    '报名组别',
    '队伍名称',
    '备注',
    '支付金额(分)',
    '支付状态',
    '报名时间',
  ];

  const rows = list.map((item) => [
    item.id || '',
    item.user_openid || item._openid || '',
    item.user_nickname || '',
    item.user_wechat_id || '',
    item.user_sex || '',
    item.division || '',
    item.team_name || '',
    item.note || '',
    item.payment_amount || 0,
    item.payment_status || '',
    item.created_at || '',
  ]);

  const content = toCsvContent(headers, rows);
  const safeName = (eventTitle || `event_${eventId}`)
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 32);
  const filePath = `${wx.env.USER_DATA_PATH}/${safeName}_${Date.now()}.csv`;

  await writeFile(filePath, content);
  const openResult = await openDocumentWithFallback(filePath, content);

  return {
    count: list.length,
    filePath: openResult.filePath,
    mode: openResult.mode,
    role: permission.role,
  };
}

module.exports = {
  EXPORT_ROLES,
  checkExportPermission,
  exportEventParticipantsCsv,
};
