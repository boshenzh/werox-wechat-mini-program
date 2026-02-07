/**
 * Registration routes: check my registration, create registration.
 */

const express = require('express');
const router = express.Router();

const { attachIdentity } = require('../middleware/auth');
const { systemAuthHeader, rdbSelect, rdbInsert } = require('../lib/cloudbase');
const {
  jsonOk,
  jsonFail,
  toEq,
  normalizeUserProfile,
  isMissingTableOrColumn,
  sanitizeRegistrationInput,
} = require('../lib/helpers');

router.get('/v1/events/:id/registration/me', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;

    let rows = [];
    if (identity.userId) {
      try {
        rows = await rdbSelect('event_participants', {
          select: 'id,event_id,user_id,user_openid',
          event_id: toEq(eventId),
          user_id: toEq(identity.userId),
          limit: 1,
        }, authHeader);
      } catch (error) {
        if (!isMissingTableOrColumn(error)) throw error;
      }
    }

    if ((!rows || rows.length === 0) && identity.openid) {
      rows = await rdbSelect('event_participants', {
        select: 'id,event_id,user_id,user_openid',
        event_id: toEq(eventId),
        user_openid: toEq(identity.openid),
        limit: 1,
      }, authHeader);
    }

    jsonOk(res, {
      is_signed: !!(rows && rows.length > 0),
      registration: rows && rows.length > 0 ? rows[0] : null,
    });
  } catch (error) {
    jsonFail(res, 500, 'REGISTRATION_CHECK_FAILED', '报名状态查询失败', {
      detail: error.message,
    });
  }
});

router.post('/v1/events/:id/registrations', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    // Input validation & sanitization
    const { division, team_name: teamName, note } = sanitizeRegistrationInput(req.body || {});

    if (!division) {
      return jsonFail(res, 400, 'DIVISION_REQUIRED', '请选择报名组别');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;

    const events = await rdbSelect('events', {
      select: 'id,title,event_date,location,max_participants,price_open,price_doubles,price_relay,base_strength,base_endurance,status',
      id: toEq(eventId),
      limit: 1,
    }, authHeader);

    if (!events || events.length === 0) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const event = events[0];

    // Check capacity
    const allParticipants = await rdbSelect('event_participants', {
      select: 'id',
      event_id: toEq(eventId),
    }, authHeader);

    const maxParticipants = Number(event.max_participants || 0);
    if (maxParticipants > 0 && (allParticipants || []).length >= maxParticipants) {
      return jsonFail(res, 409, 'EVENT_FULL', '报名已满');
    }

    const profile = normalizeUserProfile(identity.row);
    const priceOpen = Number(event.price_open || 0);
    const priceDoubles = Number(event.price_doubles || 0);
    const priceRelay = Number(event.price_relay || 0);

    let paymentAmount = priceOpen;
    if (/Doubles/i.test(division)) paymentAmount = priceDoubles;
    if (/Relay/i.test(division)) paymentAmount = priceRelay;

    const payload = {
      _openid: identity.openid || '',
      event_id: eventId,
      ...(identity.userId ? { user_id: identity.userId } : {}),
      user_openid: identity.openid || '',
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
    };

    try {
      const inserted = await rdbInsert('event_participants', payload, authHeader);
      jsonOk(res, {
        registration: inserted && inserted[0] ? inserted[0] : null,
      });
    } catch (insertError) {
      // Handle duplicate key error from uk_event_user_openid unique constraint
      const errText = JSON.stringify(insertError && insertError.payload || insertError || {});
      if (errText.includes('Duplicate') || errText.includes('duplicate') || errText.includes('UNIQUE') || errText.includes('unique')) {
        return jsonFail(res, 409, 'ALREADY_SIGNED', '你已报名过');
      }
      throw insertError;
    }
  } catch (error) {
    jsonFail(res, 500, 'REGISTRATION_CREATE_FAILED', '报名失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

module.exports = router;
