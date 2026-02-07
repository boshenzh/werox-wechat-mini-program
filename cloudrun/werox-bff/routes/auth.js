/**
 * Auth routes: mini program identity resolve, iOS WeChat sign-in.
 */

const express = require('express');
const router = express.Router();

const { TCB_AUTH_CLIENT_ID, TCB_AUTH_PROVIDER_ID } = require('../lib/config');
const { cloudbaseFetch, authClientHeaders } = require('../lib/cloudbase');
const { resolveIdentityFromRequest, ensureIdentityMapping, getAuthProfile } = require('../lib/identity');
const { jsonOk, jsonFail, randomId, normalizeUserProfile } = require('../lib/helpers');

router.post('/v1/auth/mini/resolve', async (req, res) => {
  try {
    const identity = await resolveIdentityFromRequest(req, { requireMini: true });
    jsonOk(res, {
      user_id: identity.userId || null,
      openid: identity.openid || '',
      unionid: identity.unionid || '',
      profile: normalizeUserProfile(identity.row),
      identity_mode: identity.mode,
    });
  } catch (error) {
    jsonFail(res, 401, 'MINI_IDENTITY_FAILED', '小程序身份解析失败', {
      detail: error.message,
    });
  }
});

router.post('/v1/auth/ios/wechat/signin', async (req, res) => {
  try {
    const body = req.body || {};
    const providerId = body.provider_id || TCB_AUTH_PROVIDER_ID || 'wechat';
    const deviceId = body.device_id || randomId('ios');

    let providerToken = body.provider_token || '';
    let providerProfile = null;

    if (!providerToken) {
      if (!body.provider_code) {
        return jsonFail(res, 400, 'INVALID_PARAMS', '缺少 provider_token 或 provider_code');
      }

      const grant = await cloudbaseFetch('/auth/v1/provider/token', {
        method: 'POST',
        query: TCB_AUTH_CLIENT_ID ? { client_id: TCB_AUTH_CLIENT_ID } : {},
        headers: authClientHeaders({ 'x-device-id': deviceId }),
        body: {
          provider_id: providerId,
          provider_code: body.provider_code,
          provider_redirect_uri: body.provider_redirect_uri || undefined,
        },
      });

      providerToken = grant && grant.provider_token ? String(grant.provider_token) : '';
      providerProfile = grant && grant.provider_profile ? grant.provider_profile : null;
      if (!providerToken) {
        return jsonFail(res, 401, 'PROVIDER_TOKEN_FAILED', '换取 provider_token 失败');
      }
    }

    const signInResult = await cloudbaseFetch('/auth/v1/signin/with/provider', {
      method: 'POST',
      query: TCB_AUTH_CLIENT_ID ? { client_id: TCB_AUTH_CLIENT_ID } : {},
      headers: authClientHeaders({ 'x-device-id': deviceId }),
      body: {
        provider_id: providerId,
        provider_token: providerToken,
        force_disable_sign_up: !!body.force_disable_sign_up,
        sync_profile: body.sync_profile !== false,
      },
    });

    const accessToken = signInResult && signInResult.access_token ? String(signInResult.access_token) : '';
    if (!accessToken) {
      return jsonFail(res, 401, 'IOS_SIGNIN_FAILED', 'iOS 登录失败');
    }

    const profile = await getAuthProfile(accessToken);
    const providerUid = String(
      body.provider_uid
      || (providerProfile && providerProfile.sub)
      || profile.open_id
      || profile.sub
      || ''
    );

    if (!providerUid) {
      return jsonFail(res, 500, 'IDENTITY_INCOMPLETE', '缺少可用身份标识');
    }

    const unionid = String(
      body.unionid
      || (providerProfile && providerProfile.unionid)
      || ((providerProfile && providerProfile.meta && providerProfile.meta.unionid) || '')
      || ''
    );

    const openid = String(body.openid || profile.open_id || '');

    const identity = await ensureIdentityMapping({
      provider: 'wechat_ios',
      providerUid,
      unionid,
      appid: '',
      openid: openid || `ios_${providerUid}`,
    });

    jsonOk(res, {
      token: signInResult,
      user_id: identity.userId || null,
      profile: normalizeUserProfile(identity.row),
      identity_mode: identity.mode,
    });
  } catch (error) {
    jsonFail(res, 500, 'IOS_SIGNIN_ERROR', 'iOS 登录处理失败', {
      detail: error.message,
      payload: error.payload || null,
    });
  }
});

module.exports = router;
