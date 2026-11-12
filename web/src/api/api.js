/* Thin fetch wrapper. Error protocol: non-2xx -> {error: "中文消息"}; surfaced
 * as ApiError so stores/views can toast err.message directly. */

export class ApiError extends Error {}

const DEFAULT_TIMEOUT = 35000;

async function request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new ApiError((data && data.error) || `请求失败 (${res.status})`);
    return data;
  } catch (err) {
    if (err && err.name === 'AbortError') throw new ApiError('请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  listServers: () => request('/api/servers'),
  getServer: (id) => request(`/api/servers/${id}`),
  addServer: (payload) => request('/api/servers', { method: 'POST', body: payload }),
  updateServer: (id, payload) => request(`/api/servers/${id}`, { method: 'PUT', body: payload }),
  deleteServer: (id) => request(`/api/servers/${id}`, { method: 'DELETE' }),
  saveConfig: (id, config) => request(`/api/servers/${id}/config`, { method: 'POST', body: config }),
  connect: (id) => request(`/api/servers/${id}/connect`, { method: 'POST' }),
  disconnect: (id) => request(`/api/servers/${id}/disconnect`, { method: 'POST' }),
  topics: (id) => request(`/api/servers/${id}/topics`, { timeout: 15000 }),
  bufferedMessages: (id) => request(`/api/servers/${id}/messages`),
  send: (id, payload) => request(`/api/servers/${id}/send`, { method: 'POST', body: payload }),
  subscribe: (id, topics) => request(`/api/servers/${id}/subscribe`, { method: 'POST', body: { topics } }),
  unsubscribe: (id, topics) => request(`/api/servers/${id}/unsubscribe`, { method: 'POST', body: { topics } }),
};
