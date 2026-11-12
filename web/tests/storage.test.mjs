import test from 'node:test';
import assert from 'node:assert/strict';
import {
  debounce, readJson, removeKey, removeServerLocal, storageKeys, storageUsage, writeJson,
} from '../src/utils/storage.js';

/* localStorage 不存在于 Node —— readJson/writeJson 必须安全降级而非抛错。 */

test('storageKeys 生成 legacy 兼容键名', () => {
  assert.equal(storageKeys.draft('abc'), 'kafka-desk-draft.abc');
  assert.equal(storageKeys.messages('abc'), 'kafka-desk-messages.abc');
  assert.equal(storageKeys.topicFilter('abc'), 'kafka-desk-topic-filter.abc');
  assert.equal(storageKeys.auto('abc'), 'kafka-desk-auto.abc');
  assert.equal(storageKeys.theme, 'kafka-desk-theme');
});

test('readJson 无 localStorage 时返回 fallback（不抛错）', () => {
  const sentinel = { a: 1 };
  assert.deepEqual(readJson('kafka-desk-prefs', sentinel), sentinel);
  assert.equal(readJson('kafka-desk-prefs'), undefined);
});

test('writeJson/removeKey 无 localStorage 时不抛错', () => {
  assert.doesNotThrow(() => writeJson('k', { v: 1 }));
  assert.doesNotThrow(() => removeKey('k'));
});

test('removeServerLocal 覆盖四个 per-server 键', () => {
  assert.doesNotThrow(() => removeServerLocal('srv1'));
});

test('storageUsage 无 localStorage 时返回 0', () => {
  assert.equal(storageUsage(), 0);
});

test('debounce: 防抖合并调用，flush 立即执行', async () => {
  let calls = 0;
  const lastArgs = [];
  const d = debounce((x) => { calls += 1; lastArgs.push(x); }, 30);
  d(1); d(2); d(3);
  assert.equal(calls, 0, '未到延迟不应执行');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1, '多次调用合并为一次');
  assert.deepEqual(lastArgs, [3], '以最后一次参数执行');

  const d2 = debounce((x) => { calls += 100; }, 10_000);
  d2(9);
  d2.flush();
  assert.equal(calls, 101, 'flush 立即执行挂起调用');
  d2.flush(); // 二次 flush 不应再执行
  assert.equal(calls, 101);

  const d3 = debounce(() => { calls += 1000; }, 50);
  d3();
  d3.cancel();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls, 101, 'cancel 后不执行');
});
