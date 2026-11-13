import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { autoPayloadForSend, firstBodyField, useAutomationStore } from '../src/stores/automation.js';
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

function mockFetch(routes) {
  globalThis.fetch = async (path, init = {}) => {
    const key = `${init.method || 'GET'} ${path.split('?')[0]}`;
    const responder = routes[key];
    if (!responder) return new Response(JSON.stringify({ error: `未模拟: ${key}` }), { status: 404 });
    const out = responder(init);
    return new Response(JSON.stringify(out.body ?? out), { status: out.status || 200 });
  };
}

function routes(sendImpl) {
  return {
    'GET /api/servers': () => ({
      body: {
        demo: false,
        servers: [{ id: 's1', name: '一', brokers: ['h:9092'], config: { sendTopic: 't0', recvTopics: [], groupId: 'g0', fromBeginning: false }, subscribedTopics: [] }],
      },
    }),
    'GET /api/servers/s1/topics': () => ({ body: { topics: [] } }),
    'GET /api/servers/s1/messages': () => ({ body: { messages: [] } }),
    'POST /api/servers/s1/config': (init) => ({ body: { server: { id: 's1', config: JSON.parse(init.body) } } }),
    'POST /api/servers/s1/send': sendImpl || (() => ({ body: { ok: true, topic: 't0', metadata: { partition: 1, baseOffset: '7' }, bytes: 9 } })),
  };
}

async function setup(sendImpl) {
  globalThis.localStorage = new LSShim();
  setActivePinia(createPinia());
  const servers = useServersStore();
  mockFetch(routes(sendImpl));
  await servers.refresh();
  const active = useActiveStore();
  await active.loadServer('s1');
  active.setPayload('{"message_id": "abc", "keep": 1}');
  active.setKey('k1');
  const auto = useAutomationStore();
  return { active, auto };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('firstBodyField / autoPayloadForSend：只替换首个字段并保留其余', () => {
  assert.equal(firstBodyField('{"a":1,"b":2}'), 'a');
  assert.equal(firstBodyField('[1,2]'), null, '数组无字段');
  assert.equal(firstBodyField('123'), null, '标量无字段');
  assert.equal(firstBodyField('{}'), null, '空对象无字段');
  assert.equal(firstBodyField('oops'), null);

  const built = autoPayloadForSend('{"a":"x","b":2}');
  assert.equal(built.field, 'a');
  assert.ok(built.id.length >= 10);
  const obj = JSON.parse(built.payload);
  assert.equal(obj.a, built.id, '首字段被替换为随机 id');
  assert.equal(obj.b, 2, '其余字段保留');
  assert.deepEqual(Object.keys(obj), ['a', 'b'], '字段顺序保留');
  // 两条 id 不同
  assert.notEqual(autoPayloadForSend('{"a":1}').id, autoPayloadForSend('{"a":1}').id);
});

test('start 校验：非法 JSON / 无发送主题 / 参数越界', async () => {
  const { active, auto } = await setup();
  active.setPayload('not json');
  await auto.start('count');
  assert.match(auto.error, /JSON 不合法/);
  assert.equal(auto.running, false);

  active.setPayload('{"a":1}');
  active.config.sendTopic = '';
  await auto.start('count');
  assert.match(auto.error, /发送主题/);

  active.config.sendTopic = 't0';
  auto.settings.total = 0;
  await auto.start('count');
  assert.match(auto.error, /发送总数/);
  auto.settings.total = 10;
  auto.settings.countInterval = 5;
  await auto.start('count');
  assert.match(auto.error, /发送间隔/);
  assert.equal(auto.running, false);
});

test('总数制：跑满总数自动停止并汇总', async () => {
  let sends = 0;
  const { auto } = await setup(() => {
    sends += 1;
    return { body: { ok: true, topic: 't0', metadata: { partition: 0, baseOffset: String(sends) }, bytes: 10 } };
  });
  auto.settings.total = 3;
  auto.settings.countInterval = 10;
  await auto.start('count');
  await wait(150);
  assert.equal(sends, 3, '发送 3 条');
  assert.equal(auto.running, false, '达到总数自动停止');
  assert.match(auto.lastSummary, /成功 3/);
  assert.equal(auto.lastReceipt.offset, '3', '回执保留最后一条');
});

test('随机 request_id：每条投递都替换首字段，且不改写发送区', async () => {
  const payloads = [];
  const { active, auto } = await setup((init) => {
    payloads.push(JSON.parse(init.body).payload);
    return { body: { ok: true, topic: 't0', metadata: { partition: 0, baseOffset: '1' }, bytes: 5 } };
  });
  auto.settings.randomId = true;
  auto.settings.total = 2;
  auto.settings.countInterval = 10;
  await auto.start('count');
  await wait(120);
  assert.equal(payloads.length, 2);
  const ids = payloads.map((p) => JSON.parse(p).message_id);
  assert.notEqual(ids[0], ids[1], 'id 每条不同');
  assert.equal(JSON.parse(payloads[0]).keep, 1, '其他字段不变');
  assert.equal(active.draft.payload, '{"message_id": "abc", "keep": 1}', '发送区内容未被改写');
});

test('连败 5 次自动熔断停止', async () => {
  const { auto } = await setup(() => ({ status: 500, body: { error: 'Broker 不可用' } }));
  auto.settings.total = 50;
  auto.settings.countInterval = 10;
  await auto.start('count');
  await wait(300);
  assert.equal(auto.running, false, '已熔断');
  assert.equal(auto.failed, 0, 'stop 后计数器清空（legacy 规则）');
  assert.match(auto.lastSummary, /失败 5/, '汇总保留失败数');
});

test('暂停保留进度、继续后接着跑', async () => {
  let sends = 0;
  const { auto } = await setup(() => {
    sends += 1;
    return { body: { ok: true, topic: 't0', metadata: { partition: 0, baseOffset: String(sends) }, bytes: 5 } };
  });
  auto.settings.total = 100;
  auto.settings.countInterval = 20;
  await auto.start('count');
  await wait(50);
  auto.pause();
  const frozen = auto.sent;
  assert.ok(frozen >= 1);
  await wait(80);
  assert.equal(auto.sent, frozen, '暂停后不再发送');
  auto.resume();
  await wait(60);
  assert.ok(auto.sent > frozen, '继续后恢复发送');
  auto.stop('已手动停止');
});

test('stop 全量重置但保留回执；配置按服务器记忆', async () => {
  const { auto } = await setup();
  auto.settings.total = 5;
  auto.settings.countInterval = 10;
  auto.settings.randomId = true;
  await auto.start('count');
  await wait(80);
  auto.stop('已手动停止');
  assert.equal(auto.running, false);
  assert.equal(auto.attempts, 0, '进度清空');
  assert.equal(auto.sent, 0);
  assert.ok(auto.lastReceipt, '回执保留');

  const saved = JSON.parse(localStorage.getItem(storageKeys.auto('s1')));
  assert.deepEqual(saved, { total: 5, countInterval: 10, timedInterval: 1000, randomId: true });
});

test('切换服务器会停止运行中的自动化', async () => {
  const { active, auto } = await setup();
  auto.settings.total = 100;
  auto.settings.countInterval = 30;
  await auto.start('count');
  assert.equal(auto.running, true);
  await active.loadServer('s1'); // 同服务器重进也会 stop
  assert.equal(auto.running, false);
});
