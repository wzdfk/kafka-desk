import test from 'node:test';
import assert from 'node:assert/strict';
import { sortTopicsBySelection } from '../src/stores/active.js';

test('已勾选主题置顶，且组内保持原顺序', () => {
  const topics = ['t1', 'a', 't2', 'b', 't3'];
  assert.deepEqual(sortTopicsBySelection(topics, ['b', 'a']), ['a', 'b', 't1', 't2', 't3']);
});

test('无勾选或输入为空时不改变列表', () => {
  const topics = ['t1', 't2'];
  assert.deepEqual(sortTopicsBySelection(topics, []), topics);
  assert.deepEqual(sortTopicsBySelection(topics, null), topics);
  assert.deepEqual(sortTopicsBySelection(null, ['t1']), []);
});

test('搜索结果中命中的已勾选主题仍置顶', () => {
  const filtered = ['alpha', 'apple', 'beta'];
  assert.deepEqual(sortTopicsBySelection(filtered, ['apple']), ['apple', 'alpha', 'beta']);
});
