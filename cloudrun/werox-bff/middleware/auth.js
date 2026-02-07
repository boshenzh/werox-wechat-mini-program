/**
 * Express middleware for identity resolution.
 */

const { resolveIdentityFromRequest } = require('../lib/identity');
const { jsonFail } = require('../lib/helpers');

async function attachIdentity(req, res, next) {
  try {
    req.identity = await resolveIdentityFromRequest(req);
    next();
  } catch (error) {
    if (error.message === 'missing_tcb_api_key') {
      return jsonFail(res, 503, 'MISSING_TCB_API_KEY', '后端缺少 TCB_API_KEY，请先在云托管环境变量中配置服务端 API Key', {
        detail: error.message,
      });
    }
    if (error.message === 'missing_identity') {
      return jsonFail(res, 401, 'UNAUTHORIZED', '未识别登录身份');
    }
    return jsonFail(res, 401, 'IDENTITY_RESOLVE_FAILED', '身份解析失败', {
      detail: error.message,
    });
  }
}

module.exports = { attachIdentity };
