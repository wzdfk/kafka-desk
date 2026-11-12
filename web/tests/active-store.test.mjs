import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { sameConfig, useActiveStore } from '../src/stores/active.js';
import { useServersStore } from '../src/stores/servers.js';

/* localStorage 桩 */
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
  globalThis.fetch = async (path, init = {}) => {
    const key = `${init.method || 'GET'} ${path.split('?')[0]}`;
    const responder = routes[key];
    if (!responder) return new Response(JSON.stringify({ error: `未模拟: ${key}` }), { status: 404 });
    const { status = 200, body } = responder(init);
    return new Response(JSON.stringify(body), { status });
  };
}

function baseRoutes(extra = {}) {
  return {
    'GET /api/servers': () => ({
      body: {
        demo: false,
        servers: [{ id: 's1', name: '一', brokers: ['h:9092'], config: { sendTopic: 't0', recvTopics: ['a'], groupId: 'g0', fromBeginning: false }, subscribedTopics: ['a'] }],
      },
    }),
    ...extra,
  };
}

async function setup(routes) {
  globalThis.localStorage = new LSShim();
  setActivePinia(createPinia());
  const servers = useServersStore();
  mockFetch(routes);
  await servers.refresh();
  const active = useActiveStore();
  await active.loadServer('s1');
  return { servers, active };
}

test('sameConfig 四字段等值判断', () => {
  const a = { sendTopic: 't', recvTopics: ['x'], groupId: 'g', fromBeginning: false };
  assert.ok(sameConfig(a, { ...a }));
  assert.ok(!sameConfig(a, null));
  assert.ok(!sameConfig(null, a));
  assert.ok(!sameConfig(a, { ...a, fromBeginning: true }));
  assert.ok(!sameConfig(a, { ...a, recvTopics: ['x', 'y'] }));
  assert.ok(!sameConfig(a, { ...a, groupId: '' }));
});

test('loadServer：从服务端视图建立工作副本并静默拉取主题', async () => {
  const { active } = await setup({
    ...baseRoutes(),
    'GET /api/servers/s1/topics': () => ({ body: { topics: ['t1', 't2', 'a'] } }),
  });
  assert.equal(active.config.sendTopic, 't0');
  assert.deepEqual(active.selectedTopics, ['a']);
  // catalog = broker ∪ selected ∪ subscribed（发送主题不进 catalog，只在发送下拉临时合并）
  assert.deepEqual([...active.catalog].sort(), ['a', 't1', 't2']);
  assert.equal(active.serverId, 's1');
});

test('saveConfig：去重——相同内容不发请求，变更后才 POST', async () => {
  let posts = 0;
  const { active, servers } = await setup(baseRoutes({
    'POST /api/servers/s1/config': (init) => {
      posts += 1;
      return { body: { server: { id: 's1', config: JSON.parse(init.body) } } };
    },
  }));
  await active.saveConfig();
  assert.equal(posts, 0, 'loadServer 后未改动，不应发请求');
  active.config.groupId = 'changed';
  await active.saveConfig();
  assert.equal(posts, 1);
  await active.saveConfig();
  assert.equal(posts, 1, '已保存内容再次调用仍去重');
  assert.equal(servers.byId('s1').config.groupId, 'changed', 'ack 已并回服务器列表');
});

test('运行日志上限 200 条', async () => {
  const { active } = await setup(baseRoutes());
  for (let i = 0; i < 230; i += 1) active.pushRunLog({ ts: 1000 + i, level: 'info', text: `m${i}` });
  assert.equal(active.runLogs.length, 200);
  assert.equal(active.runLogs[0].text, 'm30', '丢的是最旧的');
  assert.equal(active.runLogs[199].text, 'm229');
  active.clearRunLog();
  assert.equal(active.runLogs.length, 0);
});

test('catalog 切换服务器后丢弃迟到响应', async () => {
  const { active, servers } = await setup(baseRoutes());
  // 模拟慢响应：先切走再到达
  let resolveTopics;
  globalThis.fetch = async (path) => {
    if (path.includes('/topics')) {
      return new Promise((resolve) => { resolveTopics = () => resolve(new Response(JSON.stringify({ topics: ['late'] }), { status: 200 })); });
    }
    return new Response(JSON.stringify({ demo: false, servers: servers.list }), { status: 200 });
  };
  const p = active.loadCatalog('s1', false);
  active.serverId = 's2'; // 已切走
  resolveTopics();
  await p;
  assert.equal(active.catalog.includes('late'), false, '切换后迟到的主题列表不应合入');
  globalThis.fetch = realFetch;
});
