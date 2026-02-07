/**
 * CloudBase API client utilities: fetch, RDB CRUD, storage helpers.
 */

const {
  TCB_ENV_ID,
  TCB_API_KEY,
  TCB_AUTH_CLIENT_ID,
  TCB_AUTH_CLIENT_SECRET,
  CLOUD_BASE_URL,
  DEFAULT_TIMEOUT_MS,
} = require('./config');

function buildUrl(pathname, query) {
  const url = new URL(pathname, CLOUD_BASE_URL);
  Object.keys(query || {}).forEach((key) => {
    const value = query[key];
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function cloudbaseFetch(pathname, options = {}) {
  const {
    method = 'GET',
    headers = {},
    query = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (!TCB_ENV_ID) {
    throw new Error('missing_env_id');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(pathname, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (err) {
      payload = text;
    }

    if (!response.ok) {
      const error = new Error('cloudbase_api_error');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function systemAuthHeader() {
  if (!TCB_API_KEY) {
    throw new Error('missing_tcb_api_key');
  }
  return `Bearer ${TCB_API_KEY}`;
}

function authClientHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (TCB_AUTH_CLIENT_ID && TCB_AUTH_CLIENT_SECRET) {
    const token = Buffer.from(`${TCB_AUTH_CLIENT_ID}:${TCB_AUTH_CLIENT_SECRET}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

async function rdbSelect(table, query = {}, authHeader) {
  return cloudbaseFetch(`/v1/rdb/rest/${table}`, {
    method: 'GET',
    query,
    headers: {
      Accept: 'application/json',
      Authorization: authHeader,
    },
  });
}

async function rdbInsert(table, body, authHeader) {
  return cloudbaseFetch(`/v1/rdb/rest/${table}`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      Authorization: authHeader,
    },
  });
}

async function rdbUpdate(table, query, body, authHeader) {
  return cloudbaseFetch(`/v1/rdb/rest/${table}`, {
    method: 'PATCH',
    query,
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      Authorization: authHeader,
    },
  });
}

async function storageGetDownloadInfo(cloudObjectIds = [], authHeader) {
  const items = (cloudObjectIds || [])
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => ({ cloudObjectId: item.trim() }));
  if (items.length === 0) return [];
  return cloudbaseFetch('/v1/storages/get-objects-download-info', {
    method: 'POST',
    body: items,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authHeader,
    },
  });
}

module.exports = {
  cloudbaseFetch,
  systemAuthHeader,
  authClientHeaders,
  rdbSelect,
  rdbInsert,
  rdbUpdate,
  storageGetDownloadInfo,
};
