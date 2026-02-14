/**
 * Registration routes: check my registration, create registration, cancel registration.
 */

const express = require('express');
const router = express.Router();

const { attachIdentity } = require('../middleware/auth');
const { systemAuthHeader, rdbSelect, rdbInsert, rdbUpdate } = require('../lib/cloudbase');
const {
  jsonOk,
  jsonFail,
  toEq,
  normalizeUserProfile,
  isMissingTableOrColumn,
  sanitizeRegistrationInput,
  isPrivilegedUser,
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
          select: 'id,event_id,user_id,user_openid,registration_status,waitlist_position',
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
        select: 'id,event_id,user_id,user_openid,registration_status,waitlist_position',
        event_id: toEq(eventId),
        user_openid: toEq(identity.openid),
        limit: 1,
      }, authHeader);
    }

    const hasRow = !!(rows && rows.length > 0);
    const row = hasRow ? rows[0] : null;
    const status = row ? (row.registration_status || 'confirmed') : null;

    jsonOk(res, {
      is_signed: hasRow && (status === 'confirmed' || status === 'waitlisted'),
      is_waitlisted: !!(hasRow && status === 'waitlisted'),
      registration_status: status,
      waitlist_position: hasRow ? (row.waitlist_position || null) : null,
      registration: row,
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
      select: 'id,title,event_date,location,max_participants,price_open,price_doubles,price_relay,base_strength,base_endurance,status,waitlist_enabled',
      id: toEq(eventId),
      limit: 1,
    }, authHeader);

    if (!events || events.length === 0) {
      return jsonFail(res, 404, 'EVENT_NOT_FOUND', '赛事不存在');
    }

    const event = events[0];

    // Check for existing row (including cancelled)
    let existingRows = [];
    if (identity.openid) {
      existingRows = await rdbSelect('event_participants', {
        select: 'id,registration_status',
        event_id: toEq(eventId),
        user_openid: toEq(identity.openid),
        limit: 1,
      }, authHeader);
    }
    const existingRow = existingRows && existingRows.length > 0 ? existingRows[0] : null;

    // If already active, reject
    if (existingRow && (existingRow.registration_status === 'confirmed' || existingRow.registration_status === 'waitlisted')) {
      return jsonFail(res, 409, 'ALREADY_SIGNED', '你已报名过');
    }

    // Check capacity (only count confirmed)
    const confirmedParticipants = await rdbSelect('event_participants', {
      select: 'id',
      event_id: toEq(eventId),
      registration_status: toEq('confirmed'),
    }, authHeader);
    const confirmedCount = (confirmedParticipants || []).length;
    const maxParticipants = Number(event.max_participants || 0);
    const isFull = maxParticipants > 0 && confirmedCount >= maxParticipants;

    if (isFull && !event.waitlist_enabled) {
      return jsonFail(res, 409, 'EVENT_FULL', '报名已满');
    }

    const registrationStatus = isFull ? 'waitlisted' : 'confirmed';
    let waitlistPosition = null;
    if (registrationStatus === 'waitlisted') {
      const waitlistedRows = await rdbSelect('event_participants', {
        select: 'id',
        event_id: toEq(eventId),
        registration_status: toEq('waitlisted'),
      }, authHeader);
      waitlistPosition = (waitlistedRows || []).length + 1;
    }

    const profile = normalizeUserProfile(identity.row);
    const priceOpen = Number(event.price_open || 0);
    const priceDoubles = Number(event.price_doubles || 0);
    const priceRelay = Number(event.price_relay || 0);

    let paymentAmount = priceOpen;
    if (/Doubles/i.test(division)) paymentAmount = priceDoubles;
    if (/Relay/i.test(division)) paymentAmount = priceRelay;

    // If there's a cancelled existing row, re-activate it
    if (existingRow && existingRow.registration_status === 'cancelled') {
      const updated = await rdbUpdate('event_participants',
        { id: toEq(existingRow.id) },
        {
          registration_status: registrationStatus,
          waitlist_position: waitlistPosition,
          cancelled_at: null,
          division,
          team_name: teamName,
          note,
          user_nickname: profile.nickname || '',
          user_wechat_id: profile.wechat_id || '',
          user_sex: profile.sex || '',
          user_avatar_file_id: profile.avatar_file_id || '',
          payment_amount: paymentAmount,
          payment_status: 'pending',
        },
        authHeader
      );
      return jsonOk(res, {
        registration: updated && updated[0] ? updated[0] : null,
        registration_status: registrationStatus,
        waitlist_position: waitlistPosition,
      });
    }

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
      registration_status: registrationStatus,
      waitlist_position: waitlistPosition,
    };

    try {
      const inserted = await rdbInsert('event_participants', payload, authHeader);
      jsonOk(res, {
        registration: inserted && inserted[0] ? inserted[0] : null,
        registration_status: registrationStatus,
        waitlist_position: waitlistPosition,
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

router.post('/v1/events/:id/registrations/me/cancel', attachIdentity, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return jsonFail(res, 400, 'INVALID_EVENT_ID', '赛事ID不合法');
    }

    const authHeader = systemAuthHeader();
    const identity = req.identity;

    // Find user's active registration
    let rows = [];
    if (identity.userId) {
      try {
        rows = await rdbSelect('event_participants', {
          select: 'id,event_id,user_id,user_openid,registration_status,division,event_title,event_date',
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
        select: 'id,event_id,user_id,user_openid,registration_status,division,event_title,event_date',
        event_id: toEq(eventId),
        user_openid: toEq(identity.openid),
        limit: 1,
      }, authHeader);
    }

    if (!rows || rows.length === 0) {
      return jsonFail(res, 404, 'NOT_REGISTERED', '未找到报名记录');
    }

    const registration = rows[0];
    const currentStatus = registration.registration_status || 'confirmed';

    if (currentStatus === 'cancelled') {
      return jsonFail(res, 409, 'ALREADY_CANCELLED', '已取消报名');
    }

    if (currentStatus !== 'confirmed' && currentStatus !== 'waitlisted') {
      return jsonFail(res, 409, 'INVALID_STATUS', '当前状态无法取消');
    }

    // Cancel the registration
    await rdbUpdate('event_participants',
      { id: toEq(registration.id) },
      { registration_status: 'cancelled', cancelled_at: new Date().toISOString() },
      authHeader
    );

    // If cancelled user was confirmed and event has waitlist, auto-promote
    if (currentStatus === 'confirmed') {
      try {
        const events = await rdbSelect('events', {
          select: 'id,waitlist_enabled,title,event_date',
          id: toEq(eventId),
          limit: 1,
        }, authHeader);
        const event = events && events[0];

        if (event && event.waitlist_enabled) {
          // Find first waitlisted person
          const waitlisted = await rdbSelect('event_participants', {
            select: 'id,user_openid,registration_status,waitlist_position',
            event_id: toEq(eventId),
            registration_status: toEq('waitlisted'),
            order: 'waitlist_position.asc,created_at.asc',
            limit: 1,
          }, authHeader);

          if (waitlisted && waitlisted.length > 0) {
            const promoted = waitlisted[0];
            // Race-safe: only update if still waitlisted
            await rdbUpdate('event_participants',
              { id: toEq(promoted.id), registration_status: toEq('waitlisted') },
              {
                registration_status: 'confirmed',
                promoted_at: new Date().toISOString(),
                waitlist_position: null,
              },
              authHeader
            );

            // Send notification (async, non-blocking)
            try {
              const { sendWaitlistPromotedNotice } = require('../lib/wechat-msg');
              sendWaitlistPromotedNotice(
                promoted.user_openid,
                event.title || '',
                event.event_date || ''
              ).catch((err) => console.warn('[cancel] notify promoted user failed:', err.message));
            } catch (notifyErr) {
              console.warn('[cancel] notify module error:', notifyErr.message);
            }
          }
        }
      } catch (promoteErr) {
        // Auto-promote failure should not block cancel success
        console.error('[cancel] auto-promote failed:', promoteErr.message);
      }
    }

    jsonOk(res, { cancelled: true, previous_status: currentStatus });
  } catch (error) {
    jsonFail(res, 500, 'CANCEL_FAILED', '取消报名失败', {
      detail: error.message,
    });
  }
});

module.exports = router;
