const cloud = require('wx-server-sdk');
const XLSX = require('xlsx');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// Admin openids for permission check (should match utils/roles.js)
const ADMIN_OPENIDS = [
  'ozE5v3Two0JZBRbEMq22vgcgz-Es',
  'ozE5v3eJi7NnBfMvw0Arc6Ye1iQo',
];

exports.main = async (event, context) => {
  const { eventId } = event || {};
  if (!eventId) {
    return { success: false, error: 'eventId required' };
  }

  const db = cloud.database();
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  // Check permission: either from database role or hardcoded admin list
  const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data.length ? userRes.data[0] : null;
  const isAdmin = (user && user.role === 'admin') || ADMIN_OPENIDS.includes(openid);

  if (!isAdmin) {
    return { success: false, error: 'permission denied' };
  }

  let eventDoc;
  try {
    const eventRes = await db.collection('events').doc(eventId).get();
    eventDoc = eventRes.data;
  } catch (err) {
    return { success: false, error: 'event not found' };
  }

  if (!eventDoc) {
    return { success: false, error: 'event not found' };
  }

  const participantsRes = await db
    .collection('event_participants')
    .where({ eventId })
    .get();
  const participants = participantsRes.data || [];

  const eventSheet = [
    ['赛事ID', eventDoc._id],
    ['名称', eventDoc.title || ''],
    ['日期', eventDoc.date || eventDoc.dateText || ''],
    ['地点', eventDoc.location || ''],
    ['主办方', eventDoc.host || ''],
    ['人数上限', eventDoc.maxParticipants || '不限'],
    ['报名费用', eventDoc.price || 0],
    ['状态', eventDoc.statusText || ''],
    ['导出时间', new Date().toISOString()],
  ];

  const headers = [
    '报名ID',
    'OpenID',
    '昵称',
    '微信号',
    '性别',
    '训练方向',
    'HYROX经验',
    '搭档角色',
    '搭档须知',
    'MBTI',
    '标签',
    '报名组别',
    '搭档姓名',
    '报名备注',
    '报名时间',
  ];

  const rows = participants.map((item) => {
    const snapshot = item.profileSnapshot || {};
    const form = item.eventForm || {};
    return [
      item._id || '',
      item._openid || '',
      snapshot.nickname || '',
      snapshot.wechatId || '',
      snapshot.sex || '',
      snapshot.trainingFocus || '',
      snapshot.hyroxExperience || '',
      snapshot.partnerRole || '',
      snapshot.partnerNote || '',
      snapshot.mbti || '',
      Array.isArray(snapshot.tags) ? snapshot.tags.join('，') : '',
      form.groupType || '',
      form.partnerName || '',
      form.note || '',
      item.createdAt ? new Date(item.createdAt).toISOString() : '',
    ];
  });

  const wb = XLSX.utils.book_new();
  const eventWs = XLSX.utils.aoa_to_sheet(eventSheet);
  const participantWs = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  XLSX.utils.book_append_sheet(wb, eventWs, 'event');
  XLSX.utils.book_append_sheet(wb, participantWs, 'participants');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const cloudPath = `exports/event_${eventId}_${Date.now()}.xlsx`;
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });

  return { success: true, fileID: uploadRes.fileID, count: participants.length };
};
