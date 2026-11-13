import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { PREF_CACHE_LIMIT, PREF_MAX_MESSAGES, usePrefsStore } from '../src/stores/prefs.js';
import { useSyslogStore } from '../src/stores/syslog.js';
import { useMessagesStore, MAX_MESSAGES } from '../src/stores/messages.js';
import { useActiveStore } from '../src/stores/active.js';
import { useServersStore } from '../src/stores/servers.js';
import { clearLocalCache, storageKeys, storageUsage, writeJson } from '../src/utils/storage.js';


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

const routes = {
  'GET /api/servers': () => ({ body: { demo: false, servers: [{ id: 's1', name: '一', brokers: ['h:9092'], config: { sendTopic: 't0', recvTopics: [] }, subscribedTopics: [] }] } }),
  'GET /api/servers/s1/topics': () => ({ body: { topics: [] } }),
  'GET /api/servers/s1/messages': () => ({ body: { messages: [] } }),
};

function fresh() {
  globalThis.localStorage = new LSShim();
  setActivePinia(createPinia());
  return globalThis.localStorage;
}

test('prefs 默认值与持久化：非法值被忽略', () => {
  const ls = fresh();
  const prefs = usePrefsStore();
  prefs.init();
  assert.equal(prefs.maxMessages, 500);
  assert.equal(prefs.cacheLimit, 50);

  prefs.setMaxMessages(2000);
  prefs.setCacheLimit(200);
  assert.deepEqual(JSON.parse(ls.getItem(storageKeys.prefs)), { maxMessages: 2000, cacheLimit: 200 });

  prefs.setMaxMessages(333); // 不在白名单
  prefs.setCacheLimit(1);
  assert.equal(prefs.maxMessages, 2000);
  assert.equal(prefs.cacheLimit, 200);
  assert.deepEqual(JSON.parse(ls.getItem(storageKeys.prefs)), { maxMessages: 2000, cacheLimit: 200 });

  // 重开：从 localStorage 恢复
  setActivePinia(createPinia());
  const again = usePrefsStore();
  again.init();
  assert.equal(again.maxMessages, 2000);
  assert.equal(again.cacheLimit, 200);
  assert.deepEqual(PREF_MAX_MESSAGES, [200, 500, 1000, 2000]);
  assert.deepEqual(PREF_CACHE_LIMIT, [20, 50, 100, 200, 500]);
});

test('接收区上限随设置生效：渲染上限与已渲染列表同步裁剪', async () => {
  globalThis.localStorage = new LSShim();
  setActivePinia(createPinia());
  mockFetch(routes);
  const servers = useServersStore();
  await servers.refresh();
  const active = useActiveStore();
  await active.loadServer('s1');
  const prefs = usePrefsStore();
  prefs.init();
  const messages = useMessagesStore();

  const mk = (i) => ({ serverId: 's1', ts: Date.now(), topic: 't0', partition: 0, offset: String(i), key: null, value: '{}' });

  // 默认上限 500（常量兜底）
  messages.enqueue(Array.from({ length: 600 }, (_, i) => mk(i)));
  messages.flushAll();
  assert.equal(messages.msgs.length, MAX_MESSAGES);

  // 调到 200 → 立即裁剪已渲染列表
  prefs.setMaxMessages(200);
  await Promise.resolve();
  assert.equal(messages.msgs.length, 200, '降低上限后当前列表被裁剪');

  messages.enqueue(Array.from({ length: 300 }, (_, i) => mk(i)));
  messages.flushAll();
  assert.equal(messages.msgs.length, 200, '新消息仍按新上限截断');
});

test('本地缓存条数随设置生效（落盘条数 = cacheLimit）', async () => {
  const ls = fresh();
  mockFetch(routes);
  const servers = useServersStore();
  await servers.refresh();
  const active = useActiveStore();
  await active.loadServer('s1');
  const prefs = usePrefsStore();
  prefs.init();
  prefs.setCacheLimit(20);
  const messages = useMessagesStore();
  messages.enqueue(Array.from({ length: 30 }, (_, i) => ({
    serverId: 's1', ts: Date.now(), topic: 't0', partition: 0, offset: String(i), key: null, value: '{"a":1}',
  })));
  messages.flushAll();
  messages.flushCache();
  const cached = JSON.parse(ls.getItem(storageKeys.messages('s1')));
  assert.equal(cached.length, 20, '仅保留最近 20 条');
  assert.equal(cached.at(-1).offset, '29', '保留的是最新的一段');

  // 超长 value 被截断（8000 字符）
  const longVal = 'x'.repeat(9000);
  messages.enqueue([{ serverId: 's1', ts: Date.now(), topic: 't0', partition: 0, offset: '999', key: null, value: longVal }]);
  messages.flushAll();
  messages.flushCache();
  const cached2 = JSON.parse(ls.getItem(storageKeys.messages('s1')));
  assert.equal(cached2.at(-1).value.length, 8000);
});

test('清理本机缓存：保留主题/偏好/系统日志，清掉草稿与消息缓存', () => {
  const ls = fresh();
  ls.setItem(storageKeys.theme, 'dark'); // 主题以裸字符串保存
  writeJson(storageKeys.prefs, { maxMessages: 200, cacheLimit: 20 });
  writeJson(storageKeys.syslog, [{ ts: 1, level: 'info', src: 'x', text: 'y' }]);
  writeJson(storageKeys.draft('s1'), { payload: '{}', key: '' });
  writeJson(storageKeys.messages('s1'), [{ offset: '1' }]);
  writeJson(storageKeys.topicFilter('s1'), ['t0']);
  writeJson(storageKeys.auto('s1'), { total: 5 });

  assert.ok(storageUsage() > 0);
  const removed = clearLocalCache();
  assert.equal(removed, 4, '草稿 / 消息 / 筛选 / 自动化 共 4 个键被清理');

  assert.ok(ls.getItem(storageKeys.theme), '主题保留');
  assert.ok(ls.getItem(storageKeys.prefs), '偏好保留');
  assert.ok(ls.getItem(storageKeys.syslog), '系统日志保留');
  assert.equal(ls.getItem(storageKeys.draft('s1')), null);
  assert.equal(ls.getItem(storageKeys.messages('s1')), null);
  assert.equal(ls.getItem(storageKeys.topicFilter('s1')), null);
  assert.equal(ls.getItem(storageKeys.auto('s1')), null);
});

test('系统日志：级别去重、清空、无 DOM 时导出返回 false', () => {
  const ls = fresh();
  const syslog = useSyslogStore();
  syslog.init();
  syslog.add({ level: 'info', src: '服务', text: '连接成功', ts: 1000 });
  syslog.add({ level: 'info', src: '服务', text: '连接成功', ts: 1200 }); // 1.5s 内同文案去重
  assert.equal(syslog.entries.length, 1);
  syslog.add({ level: 'error', src: '服务', text: '连接失败', ts: 2000 });
  assert.equal(syslog.entries.length, 2);
  assert.equal(syslog.entries[1].level, 'error');

  assert.equal(syslog.exportLog(), false, 'Node 环境无 DOM：返回 false 由页面提示');
  syslog.clear();
  assert.equal(syslog.entries.length, 0);
  assert.deepEqual(JSON.parse(ls.getItem(storageKeys.syslog)), []);
});
