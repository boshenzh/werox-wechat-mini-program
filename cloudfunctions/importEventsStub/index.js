const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const STUB_EVENTS = [
  {
    slug: 'shenzhen-2026-01-27',
    title: 'Werox 深圳站',
    date: '2026-01-27',
    location: '深圳 · Werox 中心',
    host: 'Werox Lab',
    coverUrl: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1200&q=60',
    description: '在 Werox 中心完成 Hyrox 标准赛制挑战，欢迎记录你的成绩。',
    statusText: '即将开始',
    baseStrength: 7,
    baseEndurance: 7,
    highlights: ['标准赛制 8 轮挑战', '观众区与补给区', '现场摄影师全程记录'],
  },
];

exports.main = async () => {
  const db = cloud.database();
  const collection = db.collection('events');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of STUB_EVENTS) {
    const res = await collection.where({ slug: event.slug }).limit(1).get();
    if (res.data && res.data.length > 0) {
      const existing = res.data[0];
      await collection.doc(existing._id).update({
        data: {
          ...event,
          updatedAt: Date.now(),
        },
      });
      updated += 1;
      continue;
    }

    // fallback match by title + date
    const fallback = await collection
      .where({ title: event.title, date: event.date })
      .limit(1)
      .get();
    if (fallback.data && fallback.data.length > 0) {
      const existing = fallback.data[0];
      await collection.doc(existing._id).update({
        data: {
          ...event,
          updatedAt: Date.now(),
        },
      });
      updated += 1;
      continue;
    }

    await collection.add({
      data: {
        ...event,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    inserted += 1;
  }

  return {
    total: STUB_EVENTS.length,
    inserted,
    updated,
    skipped,
  };
};
