import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { useServersStore } from '../src/stores/servers.js';
import { LEGACY_KEYS } from '../src/utils/storage.js';

/* 最小 localStorage 桩（servers store 的 legacy 迁移依赖它） */
class LSShim {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

const realFetch = globalThis.fetch;

function mockFetch(routes) {
  // routes: { 'GET /api/servers': {...}, 'POST /api/servers': {...} }
  globalThis.fetch = async (path, init = {}) => {
    const key = `${init.method || 'GET'} ${path.split('?')[0]}`;
    const responder = routes[key];
    if (!responder) return new Response(JSON.stringify({ error: `未模拟: ${key}` }), { status: 404 });
    const { status = 200, body } = responder(init);
    return new Response(JSON.stringify(body), { status });
  };
}

test('addServer：非首台时不做 legacy 迁移', async () => {
  globalThis.localStorage = new LSShim();
  setActivePinia(createPinia());
  const store = useServersStore();
  let postBody = null;
  mockFetch({
    'GET /api/servers': () => ({ body: { demo: false, servers: [{ id: 'old1', name: '旧' }] } }),
    'POST /api/servers': (init) => { postBody = JSON.parse(init.body); return { body: { server: { id: 'new1', name: '新' } } } },
  });
  const created = await store.addServer({ name: '新', brokers: 'h1:9092' });
  assert.equal(created.id, 'new1');
  assert.deepEqual(postBody.config, {}, '非首台：config 为空对象');
  assert.equal(store.list.length, 1, 'refresh 后列表来自 GET');
});

test('addServer：首台时迁移 legacy 配置/草稿/缓存并清理旧键', async () => {
  const ls = new LSShim();
  globalThis.localStorage = ls;
  ls.setItem('kafka-desk-config', JSON.stringify({ sendTopic: 'send-1', recvTopics: ['a', 'b'], groupId: 'g1' }));
  ls.setItem('kafka-desk-draft', 'RAW-DRAFT');
  ls.setItem('kafka-desk-messages', 'RAW-MSGS');
  setActivePinia(createPinia());
  const store = useServersStore();
  let postBody = null;
  mockFetch({
    'GET /api/servers': () => ({ body: { demo: false, servers: [] } }),
    'POST /api/servers': (init) => { postBody = JSON.parse(init.body); return { body: { server: { id: 's1', name: 'x' } } } },
  });
  await store.addServer({ name: 'x', brokers: 'h1:9092' });
  assert.equal(postBody.config.sendTopic, 'send-1');
  assert.deepEqual(postBody.config.recvTopics, ['a', 'b']);
  assert.equal(postBody.config.groupId, 'g1');
  assert.equal(postBody.config.fromBeginning, false);
  assert.equal(ls.getItem('kafka-desk-draft.s1'), 'RAW-DRAFT', '草稿已迁到 per-server 键');
  assert.equal(ls.getItem('kafka-desk-messages.s1'), 'RAW-MSGS', '缓存已迁到 per-server 键');
  LEGACY_KEYS.forEach((k) => assert.equal(ls.getItem(k), null, `旧键 ${k} 已删除`));
});

test('deleteServer：清理 tabs 与本地键', async () => {
  const ls = new LSShim();
  globalThis.localStorage = ls;
  setActivePinia(createPinia());
  const store = useServersStore();
  ls.setItem('kafka-desk-draft.s9', '{}');
  ls.setItem('kafka-desk-messages.s9', '[]');
  mockFetch({
    'GET /api/servers': () => ({ body: { demo: false, servers: [{ id: 's9', name: '九' }] } }),
    'DELETE /api/servers/s9': () => ({ body: { ok: true } }),
  });
  await store.refresh();
  store.setActiveId('s9'); // afterEach 的等效动作：进 tabs
  assert.deepEqual(store.tabs, ['s9']);
  await store.deleteServer('s9');
  assert.deepEqual(store.tabs, [], 'tab 已移除');
  assert.equal(ls.getItem('kafka-desk-draft.s9'), null, '草稿键已清理');
  assert.equal(ls.getItem('kafka-desk-messages.s9'), null, '缓存键已清理');
  globalThis.fetch = realFetch;
});
