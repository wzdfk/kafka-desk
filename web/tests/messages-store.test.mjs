import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { MAX_MESSAGES, MAX_PENDING, BATCH_MESSAGES, CACHE_LIMIT, CACHE_VALUE_LIMIT, MAX_PREVIEW, pretty, previewText, useMessagesStore } from '../src/stores/messages.js';
import { useActiveStore } from '../src/stores/active.js';
import { useServersStore } from '../src/stores/servers.js';
import { storageKeys } from '../src/utils/storage.js';

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
        servers: [{ id: 's1', name: '一', brokers: ['h:9092'], config: { sendTopic: 't0', recvTopics: ['a', 'b'], groupId: 'g0', fromBeginning: false }, subscribedTopics: [] }],
      },
    }),
    'GET /api/servers/s1/topics': () => ({ body: { topics: ['a', 'b'] } }),
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
  const messages = useMessagesStore();
  return { servers, active, messages };
}

const msg = (i, topic = 'a', value = `{"i":${i}}`) => ({
  ts: 1700000000000 + i, topic, partition: 0, offset: String(i),
  key: null, value, headers: {}, serverId: 's1',
});

test('pretty / previewText', () => {
  assert.equal(pretty('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(pretty('plain text'), 'plain text');
  assert.equal(pretty(null), '');
  const big = previewText('x'.repeat(MAX_PREVIEW + 5));
  assert.ok(big.includes('预览仅显示前'), '超长预览带省略提示');
  assert.equal(previewText('x'.repeat(10)), 'x'.repeat(10), '短内容原样');
});

test('合批：一次入队 103 条 → flushAll 分批渲染，队列清空', async () => {
  const { messages } = await setup(baseRoutes());
  messages.enqueue(Array.from({ length: 103 }, (_, i) => msg(i)));
  messages.flushAll();
  assert.equal(messages.msgs.length, 103);
  assert.equal(messages.count, 103);
  assert.equal(messages.seenTopics.includes('a'), true);
});

test('DOM 上限 500：超出丢弃最旧', async () => {
  const { messages } = await setup(baseRoutes());
  messages.enqueue(Array.from({ length: MAX_MESSAGES + 100 }, (_, i) => msg(i)));
  messages.flushAll();
  assert.equal(messages.msgs.length, MAX_MESSAGES);
  assert.equal(messages.msgs[0].offset, '100', '最旧的 100 条被裁掉');
  assert.equal(messages.msgs.at(-1).offset, String(MAX_MESSAGES + 99));
});

test('队列上限 2000：溢出计入 dropped', async () => {
  const { messages } = await setup(baseRoutes());
  const big = Array.from({ length: MAX_PENDING + 500 }, (_, i) => msg(i));
  messages.enqueue(big);
  assert.equal(messages.dropped, 500, '溢出立即计入 dropped');
  messages.flushAll();
  assert.equal(messages.msgs.length, MAX_MESSAGES);
});

test('暂停显示：仍在接收但不渲染，恢复后继续', async () => {
  const { messages } = await setup(baseRoutes());
  messages.togglePause();
  assert.equal(messages.paused, true);
  messages.enqueue([msg(1), msg(2)]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.msgs.length, 0, '暂停时不渲染');
  assert.equal(messages.dropped, 2);
  messages.togglePause();
  messages.enqueue([msg(3)]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.msgs.length, 1);
});

test('双过滤：文本 ∧ 主题多选', async () => {
  const { messages } = await setup(baseRoutes());
  messages.enqueue([msg(1, 'a', '{"v":"hello"}'), msg(2, 'b', '{"v":"world"}'), msg(3, 'a', 'plain-xyz')]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.filteredMsgs.length, 3);
  messages.setTextFilter('hello');
  assert.equal(messages.filteredMsgs.length, 1);
  messages.setTextFilter('');
  messages.setTopicFilters(['a']);
  assert.equal(messages.filteredMsgs.length, 2);
  assert.equal(localStorage.getItem(storageKeys.topicFilter('s1')), JSON.stringify(['a']));
  messages.setTopicFilters([]);
  messages.setTextFilter('plain');
  assert.equal(messages.filteredMsgs.length, 1);
});

test('ingest：按 serverId 过滤，非当前服务器的消息丢弃', async () => {
  const { messages } = await setup(baseRoutes());
  messages.ingest([{ ...msg(1), serverId: 's1' }, { ...msg(2), serverId: 'other' }, null]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.msgs.length, 1);
  assert.equal(messages.msgs[0].offset, '1');
});

test('缓存：1200ms 防抖落盘、字段瘦身、恢复打 cached 标', async () => {
  const { messages } = await setup(baseRoutes({
    'GET /api/servers/s1/messages': () => ({ body: { messages: [] } }),
  }));
  const bigValue = JSON.stringify({ pad: 'y'.repeat(CACHE_VALUE_LIMIT + 100) });
  messages.enqueue([msg(1, 'a', bigValue), msg(2), msg(3)]);
  await new Promise((r) => setTimeout(r, 1400));
  const cached = JSON.parse(localStorage.getItem(storageKeys.messages('s1')));
  assert.equal(cached.length, 3);
  assert.equal(cached.every((m) => m.cached === true), true);
  assert.ok(cached[0].value.length <= CACHE_VALUE_LIMIT + 10, 'value 已按上限截断');
  assert.equal(cached[0].offset, '1');

  // 重新进入（broker buffer 为空）→ 从本地缓存恢复
  const active = useActiveStore();
  await active.loadServer('s1');
  const messages2 = useMessagesStore();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(messages2.msgs.length, 3);
  assert.equal(messages2.msgs.every((m) => m.cached), true);
  assert.equal(messages2.restoredCount, 3);
});

test('clearMessages：清列表并删除本地缓存', async () => {
  const { messages } = await setup(baseRoutes({
    'GET /api/servers/s1/messages': () => ({ body: { messages: [msg(9)] } }),
  }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.msgs.length, 1);
  messages.clearMessages();
  assert.equal(messages.msgs.length, 0);
  assert.equal(messages.count, 0);
  assert.equal(messages.restoredCount, 0);
  assert.equal(localStorage.getItem(storageKeys.messages('s1')), null);
});

test('全选覆盖：过滤非空且覆盖全部时，新主题自动纳入选择', async () => {
  const { active, messages } = await setup(baseRoutes());
  messages.setTopicFilters(['a', 'b']); // 覆盖 catalog 全部 2 个
  messages.ingest([{ ...msg(1, 'brand-new') }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.topicFilters.includes('brand-new'), true, '新主题被纳入「全选」');
  assert.equal(messages.filteredMsgs.length, 1);

  // 只选了部分时，新主题不应自动纳入
  messages.setTopicFilters(['a']);
  messages.ingest([{ ...msg(2, 'another') }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.topicFilters.includes('another'), false);
  assert.equal(active.serverId, 's1');
});

test('切换服务器：flush 旧缓存并重置视图', async () => {
  const { active, messages } = await setup(baseRoutes({
    'GET /api/servers/s2/status': () => ({ body: { demo: false, servers: [] } }),
  }));
  messages.enqueue([msg(1), msg(2)]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(messages.msgs.length, 2);
  // 模拟切走：messages.setServer('') 会 flush 缓存并清空
  await messages.setServer('');
  assert.equal(messages.msgs.length, 0);
  assert.equal(messages.serverId, '');
  const cached = JSON.parse(localStorage.getItem(storageKeys.messages('s1')));
  assert.equal(cached.length, 2, '切走前已 flush 到 s1 的缓存');
});
