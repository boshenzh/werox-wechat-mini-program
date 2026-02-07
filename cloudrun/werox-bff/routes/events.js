/**
 * Event routes: list events, get event detail.
 * These are public endpoints — no identity required.
 */

const express = require('express');
const router = express.Router();

const { systemAuthHeader, rdbSelect } = require('../lib/cloudbase');
const { jsonOk, jsonFail, toEq, isCloudbaseAuthError } = require('../lib/helpers');

// Explicit column list for event listing (no select('*'))
const EVENT_LIST_COLUMNS = 'id,title,location,event_date,event_time,cover_url,status,base_strength,base_endurance,format_mode,event_type,latitude,longitude,max_participants';

// Explicit column list for event detail
const EVENT_DETAIL_COLUMNS = 'id,title,location,event_date,event_time,cover_url,status,base_strength,base_endurance,format_mode,event_type,latitude,longitude,max_participants,description,detail_blocks,price_open,price_doubles,price_relay,poster_url,created_at,updated_at';

// Explicit column list for participants in detail view
const PARTICIPANT_DETAIL_COLUMNS = 'id,user_nickname,user_avatar_file_id,division,user_sex,user_openid,event_id,user_id,team_name,note,event_title,event_date,event_location,payment_amount,payment_status,created_at';

router.get('/v1/events', async (req, res) => {
  try {
    let authHeader = '';
    try {
      authHeader = systemAuthHeader();
    } catch (err) {
      if (err && err.message === 'missing_tcb_api_key') {
        return jsonFail(res, 503, 'MISSING_TCB_API_KEY', '后端缺少 TCB_API_KEY，请先在云托管环境变量中配置服务端 API Key');
      }
      throw err;
    }

    // Pagination support
    const queryLimit = Number(req.query.limit || 50);
    const queryOffset = Number(req.query.offset || 0);
    const limit = Number.isFinite(queryLimit) ? Math.min(Math.max(queryLimit, 1), 100) : 50;
    const offset = Number.isFinite(queryOffset) ? Math.max(queryOffset, 0) : 0;

    const events = await rdbSelect('events', {
      select: EVENT_LIST_COLUMNS,
      order: 'event_date.asc',
      limit,
      offset,
    }, authHeader);

    // Build event_id IN-clause for participant query (fix: no longer fetches ALL participants)
    const eventIds = (events || []).map((e) => e.id).filter(Boolean);
    let participants = [];
    if (eventIds.length > 0) {
      const inClause = `in.(${eventIds.join(',')})`;
      participants = await rdbSelect('event_participants', {
        select: 'event_id,user_avatar_file_id',
        event_id: inClause,
        order: 'created_at.desc',
        limit: 500, // cap to avoid huge payloads
      }, authHeader).catch(() => []);
    }

    const grouped = (participants || []).reduce((acc, item) => {
      const key = String(item.event_id || '');
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = {
          count: 0,
          avatar_file_ids: [],
        };
      }
      acc[key].count += 1;
      const avatar = item.user_avatar_file_id || '';
      if (avatar && acc[key].avatar_file_ids.length < 3 && !acc[key].avatar_file_ids.includes(avatar)) {
        acc[key].avatar_file_ids.push(avatar);
      }
      return acc;
    }, {});

    const mapped = (events || []).map((item) => {
      const meta = grouped[String(item.id)] || { count: 0, avatar_file_ids: [] };
      return {
        ...item,
        participant_count: meta.count,
        participant_avatar_file_ids: meta.avatar_file_ids,
      };
    });

    jsonOk(res, {
      events: mapped,
      pagination: {
        offset,
        limit,
        count: mapped.length,
      },
    });
  } catch (error) {
    if (isCloudbaseAuthError(error)) {
      return jsonFail(res, 503, 'TCB_API_KEY_INVALID', '后端鉴权失败，请检查 TCB_API_KEY 是否为"服务端 API Key"且未过期', {
        detail: error.payload || null,
      });
    }
    jsonFail(res, 500, 'EVENTS_QUERY_FAILED', '赛事查询失败', {
      detail: error.message,
    });
  }
});

router.get('/v1/events/:id', async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    let authHeader = '';
    try {
      authHeader = systemAuthHeader();
    } catch (err) {
      if (err && err.message === 'missing_tcb_api_key') {
        return jsonFail(res, 503, 'MISSING_TCB_API_KEY', '后端缺少 TCB_API_KEY，请先在云托管环境变量中配置服务端 API Key');
      }
      throw err;
    }

    // Fix: use explicit columns instead of select('*')
    const events = await rdbSelect('events', {
      select: EVENT_DETAIL_COLUMNS,
      id: toEq(eventId),
      limit: 1,
    }, authHeader);

    if (!events || events.length === 0) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const [stations, participants] = await Promise.all([
      rdbSelect('event_stations', {
        select: 'id,event_id,station_order,station_name,station_type,description',
        event_id: toEq(eventId),
        order: 'station_order.asc',
      }, authHeader).catch(() => []),
      // Fix: use explicit columns instead of select('*')
      rdbSelect('event_participants', {
        select: PARTICIPANT_DETAIL_COLUMNS,
        event_id: toEq(eventId),
        order: 'created_at.desc',
      }, authHeader).catch(() => []),
    ]);

    jsonOk(res, {
      event: events[0],
      stations: stations || [],
      participants: participants || [],
    });
  } catch (error) {
    if (isCloudbaseAuthError(error)) {
      return jsonFail(res, 503, 'TCB_API_KEY_INVALID', '后端鉴权失败，请检查 TCB_API_KEY 是否为"服务端 API Key"且未过期', {
        detail: error.payload || null,
      });
    }
    jsonFail(res, 500, 'EVENT_DETAIL_FAILED', '赛事详情查询失败', {
      detail: error.message,
    });
  }
});

module.exports = router;
