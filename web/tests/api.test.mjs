import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api/api.js';

const realFetch = globalThis.fetch;

test('2xx 返回解析后的 JSON', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, n: 3 }), { status: 200 });
  try {
    const data = await api.listServers();
    assert.deepEqual(data, { ok: true, n: 3 });
  } finally { globalThis.fetch = realFetch; }
});

test('非 2xx 携带 {error} 时抛 ApiError(error)', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Broker 地址不能为空' }), { status: 400 });
  try {
    await assert.rejects(() => api.addServer({}), (err) => err instanceof ApiError && err.message === 'Broker 地址不能为空');
  } finally { globalThis.fetch = realFetch; }
});

test('非 2xx 且无 JSON body 时给出状态码兜底文案', async () => {
  globalThis.fetch = async () => new Response('', { status: 502 });
  try {
    await assert.rejects(() => api.listServers(), (err) => err instanceof ApiError && err.message.includes('502'));
  } finally { globalThis.fetch = realFetch; }
});

test('网络中断（AbortError）转为「请求超时」', async () => {
  globalThis.fetch = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  try {
    await assert.rejects(() => api.listServers(), (err) => err instanceof ApiError && err.message === '请求超时');
  } finally { globalThis.fetch = realFetch; }
});

test('其他网络错误原样透出', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(() => api.listServers(), (err) => err instanceof TypeError && !(err instanceof ApiError));
  } finally { globalThis.fetch = realFetch; }
});

test('POST 请求携带 JSON 头与请求体', async () => {
  let seen = null;
  globalThis.fetch = async (path, init) => {
    seen = { path, init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await api.subscribe('srv1', ['t1']);
    assert.equal(seen.path, '/api/servers/srv1/subscribe');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(seen.init.body), { topics: ['t1'] });
  } finally { globalThis.fetch = realFetch; }
});
