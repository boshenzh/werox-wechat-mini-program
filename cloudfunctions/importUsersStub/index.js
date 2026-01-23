const cloud = require('wx-server-sdk');
const users = require('./users.json');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function normalizeWechatId(value) {
  if (!value) return '';
  return String(value).trim();
}

exports.main = async () => {
  const db = cloud.database();
  const collection = db.collection('users');

  const seen = new Set();
  const payloads = [];

  users.forEach((item) => {
    const wechatId = normalizeWechatId(item.wechatId);
    if (!wechatId || seen.has(wechatId)) return;
    seen.add(wechatId);
    payloads.push({ ...item, wechatId });
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const record of payloads) {
    const wechatId = record.wechatId;
    const res = await collection.where({ wechatId }).limit(1).get();
    if (res.data && res.data.length > 0) {
      const existing = res.data[0];
      if (existing._openid) {
        skipped += 1;
        continue;
      }

      const updatePayload = { ...record, updatedAt: Date.now() };
      await collection.doc(existing._id).update({ data: updatePayload });
      updated += 1;
      continue;
    }

    const now = Date.now();
    await collection.add({
      data: {
        ...record,
        status: record.status || 'pending',
        role: record.role || 'user',
        createdAt: record.createdAt || now,
        updatedAt: now,
      },
    });
    inserted += 1;
  }

  return {
    total: payloads.length,
    inserted,
    updated,
    skipped,
  };
};
