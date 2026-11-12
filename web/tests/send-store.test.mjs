import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { byteLen, checkJson, useActiveStore } from '../src/stores/active.js';
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
        servers: [{ id: 's1', name: '一', brokers: ['h:9092'], config: { sendTopic: 't0', recvTopics: ['a'], groupId: 'g0', fromBeginning: false }, subscribedTopics: [] }],
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

test('byteLen：UTF-8 字节数', () => {
  assert.equal(byteLen(''), 0);
  assert.equal(byteLen('abc'), 3);
  assert.equal(byteLen('中'), 3);
  assert.equal(byteLen('a中'), 4);
  assert.equal(byteLen(null), 0);
});

test('checkJson：empty/ok/bad 三态', () => {
  assert.deepEqual(checkJson(''), { state: 'empty', message: '等待输入' });
  assert.deepEqual(checkJson('   '), { state: 'empty', message: '等待输入' });
  assert.equal(checkJson('{"a":1}').state, 'ok');
  const bad = checkJson('{"a":');
  assert.equal(bad.state, 'bad');
  assert.ok(bad.message.startsWith('JSON 错误'));
});

test('草稿：300ms 防抖落盘、切服务器 flush、重进恢复', async () => {
  const { active } = await setup(baseRoutes());
  const ls = globalThis.localStorage;
  active.setPayload('{"x":1}');
  active.setKey('k1');
  assert.equal(active.draftState, 'saving');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(active.draftState, 'saved');
  const saved = JSON.parse(ls.getItem(storageKeys.draft('s1')));
  assert.equal(saved.payload, '{"x":1}');
  assert.equal(saved.key, 'k1');

  // 切换时 pending 的草稿应 flush 到旧服务器，而不是写到新键
  active.setPayload('{"x":2}');
  await active.loadServer('s1'); // 同服务器
  const saved2 = JSON.parse(ls.getItem(storageKeys.draft('s1')));
  assert.equal(saved2.payload, '{"x":2}', 'loadServer 前 flush 落盘');
});

test('无草稿时回填 SAMPLE', async () => {
  const { active } = await setup(baseRoutes());
  assert.ok(active.draft.payload.includes('"hello": "kafka"'));
  assert.equal(active.draft.key, '');
});

test('send：非法 JSON 拒发；成功后写回执；失败 toast 不抛', async () => {
  let sends = 0;
  const { active } = await setup(baseRoutes({
    'POST /api/servers/s1/send': () => {
      sends += 1;
      return { body: { ok: true, topic: 't0', metadata: { topicName: 't0', partition: 2, baseOffset: '42' }, bytes: 17 } };
    },
  }));
  active.setPayload('not json');
  assert.equal(await active.send(), null, '非法 JSON 不发请求');
  assert.equal(sends, 0);

  active.setPayload('{"ok":true}');
  active.setKey('  k9  ');
  const res = await active.send();
  assert.equal(sends, 1);
  assert.equal(res.ok, true);
  assert.deepEqual(active.lastReceipt, {
    topic: 't0', partition: 2, offset: '42', bytes: 17, ts: active.lastReceipt.ts,
  });

  mockFetch({
    ...baseRoutes(),
    'POST /api/servers/s1/send': () => ({ status: 400, body: { error: '消息超过 1 MB，可能被 Broker 拒绝' } }),
  });
  const res2 = await active.send();
  assert.equal(res2, null, '失败不抛出（内部 toast）');
  assert.equal(active.sendBusy, false, 'busy 状态复位');
});

test('formatPayload：非法 JSON 时保留原文并提示错误', async () => {
  const { active } = await setup(baseRoutes());
  active.setPayload('{"a":1,}');
  active.formatPayload();
  assert.equal(active.draft.payload, '{"a":1,}', '格式化失败不改内容');
  active.setPayload('{"a":1, }');
  // 用合法 JSON 再试
  active.draft.payload = '{"a": 1}';
  active.formatPayload();
  assert.equal(active.draft.payload, '{\n  "a": 1\n}');
});
