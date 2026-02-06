const DEFAULT_SERVICE_NAME = 'werox-bff';

function getEnvId() {
  const app = getApp();
  return app && app.globalData ? app.globalData.cloudEnv : '';
}

function getServiceName() {
  const app = getApp();
  const fromGlobal = app && app.globalData ? app.globalData.backendServiceName : '';
  return fromGlobal || DEFAULT_SERVICE_NAME;
}

function normalizeError(err, fallbackMessage) {
  if (!err) return new Error(fallbackMessage || '请求失败');
  if (err instanceof Error) return err;
  const message = err.message || fallbackMessage || '请求失败';
  const wrapped = new Error(message);
  wrapped.raw = err;
  return wrapped;
}

async function callBackend({ path, method = 'GET', data }) {
  if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
    throw new Error('当前基础库不支持云托管调用，请升级后重试');
  }

  const env = getEnvId();
  if (!env) {
    throw new Error('缺少云环境配置');
  }

  const header = {
    'Content-Type': 'application/json',
    'X-WX-SERVICE': getServiceName(),
  };

  const res = await wx.cloud.callContainer({
    config: { env },
    path,
    method,
    header,
    data: data || {},
  }).catch((err) => {
    throw normalizeError(err, '后端服务不可用');
  });

  const statusCode = Number(res && res.statusCode ? res.statusCode : 0);
  const payload = res && Object.prototype.hasOwnProperty.call(res, 'data') ? res.data : null;

  if (statusCode >= 400) {
    const msg = payload && payload.message ? payload.message : '请求失败';
    const error = new Error(msg);
    error.statusCode = statusCode;
    error.payload = payload;
    throw error;
  }

  if (payload && payload.success === false) {
    const error = new Error(payload.message || '请求失败');
    error.code = payload.code;
    error.payload = payload;
    throw error;
  }

  return payload && Object.prototype.hasOwnProperty.call(payload, 'data')
    ? payload.data
    : payload;
}

module.exports = {
  callBackend,
};
