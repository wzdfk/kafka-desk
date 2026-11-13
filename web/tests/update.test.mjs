/* 版本检查纯逻辑离线单测（Q11 L1）。无 DOM / 无网络。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPO, assertDownloadUrl, assertGithubUrl, checkForUpdates, classifyError,
  compareSemver, formatBytes, normalizeReleases, parseTag, selectLatest, shouldCheck,
} from '../src/utils/releases.js';

class LSShim {
  constructor() { this.m = new Map(); }
  setItem(k, v) { this.m.set(k, String(v)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  removeItem(k) { this.m.delete(k); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

const EXE = `https://github.com/${REPO}/releases/download/v1.0.1/KafkaDesk-1.0.1-portable.exe`;
const SUM = `https://github.com/${REPO}/releases/download/v1.0.1/KafkaDesk-1.0.1-portable.exe.sha256`;

function release(tag, extra = {}) {
  return {
    tag_name: tag,
    published_at: '2026-11-13T00:00:00Z',
    body: '## What changed\n修复若干问题',
    html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    assets: [
      { name: `KafkaDesk-${tag.replace(/^v/, '')}-portable.exe`, browser_download_url: EXE, size: 1024 },
      { name: `KafkaDesk-${tag.replace(/^v/, '')}-portable.exe.sha256`, browser_download_url: SUM, size: 64 },
    ],
    draft: false,
    prerelease: false,
    ...extra,
  };
}

function okResponse(body) {
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

function errResponse(status, remaining = null) {
  return {
    ok: false, status,
    headers: { get: (k) => (k === 'X-RateLimit-Remaining' ? remaining : null) },
  };
}

test('parseTag：只认 v?X.Y.Z', () => {
  assert.deepEqual(parseTag('v1.2.3'), { version: '1.2.3', major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseTag('1.0.0'), { version: '1.0.0', major: 1, minor: 0, patch: 0 });
  assert.equal(parseTag('v1.0.0-beta.1'), null);
  assert.equal(parseTag('nightly'), null);
  assert.equal(parseTag('1.0'), null);
});

test('compareSemver：按数值比较，非字符串字典序', () => {
  assert.equal(compareSemver('1.0.10', '1.0.9') > 0, true);
  assert.equal(compareSemver('v2.0.0', '1.99.99') > 0, true);
  assert.equal(compareSemver('1.0.0', 'v1.0.0'), 0);
});

test('normalizeReleases：过滤 draft/prerelease/非法 tag，semver 倒序，资产与校验文件', () => {
  const list = normalizeReleases([
    release('v1.0.0'),
    release('v1.0.2', { prerelease: true }),
    release('nightly'),
    release('v1.0.1'),
    release('v0.9.0', { draft: true }),
  ], '1.0.0');
  assert.deepEqual(list.map((r) => r.version), ['1.0.1', '1.0.0']);
  assert.equal(list[0].asset.url, EXE);
  assert.equal(list[0].sha256Url, SUM);
  assert.equal(list[0].relation, 'newer');
  assert.equal(list[1].relation, 'current');
  assert.equal(list[0].notes, 'What changed');
});

test('normalizeReleases：无 exe 资产仍展示但不可下载', () => {
  const list = normalizeReleases([{ ...release('v1.0.1'), assets: [] }], '1.0.0');
  assert.equal(list.length, 1);
  assert.equal(list[0].asset, null);
});

test('selectLatest：取最大 semver，不取 API 第一条', () => {
  const list = normalizeReleases([release('v1.0.1'), release('v1.0.3'), release('v1.0.2')], '1.0.0');
  assert.equal(selectLatest(list, '1.0.0').latest.version, '1.0.3');
  assert.equal(selectLatest(list, '1.0.0').status, 'available');
  assert.equal(selectLatest(list, '1.0.3').status, 'up-to-date');
  assert.equal(selectLatest([], '1.0.0').status, 'empty');
});

test('外链白名单：仅本仓库 HTTPS 下载直链', () => {
  assert.equal(assertDownloadUrl(EXE), true);
  assert.equal(assertGithubUrl(`https://github.com/${REPO}/releases`), true);
  assert.equal(assertDownloadUrl(`http://github.com/${REPO}/releases/download/v1/x.exe`), false);
  assert.equal(assertDownloadUrl('https://evil.example/x.exe'), false);
  assert.equal(assertDownloadUrl(`https://github.com/other/repo/releases/download/v1/x.exe`), false);
});

test('classifyError：限流 / 超时 / 离线 / 格式异常', () => {
  assert.equal(classifyError(null, errResponse(403, '0')), 'rate-limited');
  assert.equal(classifyError(null, errResponse(403, '12')), 'http-403');
  assert.equal(classifyError({ name: 'AbortError' }, null), 'timeout');
  assert.equal(classifyError(new TypeError('fetch failed'), null), 'offline');
  assert.equal(classifyError(new Error('bad-response'), null), 'bad-response');
});

test('shouldCheck：成功 24h / 失败 30min / 手动 60s 节流', () => {
  const now = 1_000_000_000;
  const ok = { ok: true, checkedAt: now - 1000 };
  const fail = { ok: false, checkedAt: now - 1000 };
  assert.equal(shouldCheck(null, now), true);
  assert.equal(shouldCheck(ok, now), false);
  assert.equal(shouldCheck(ok, now + 24 * 3600 * 1000), true);
  assert.equal(shouldCheck(fail, now + 30 * 60 * 1000), true);
  assert.equal(shouldCheck(ok, now, true), false);
  assert.equal(shouldCheck(ok, now + 60 * 1000, true), true);
  assert.equal(shouldCheck({ ok: true, checkedAt: now + 9999 }, now), true);
});

test('checkForUpdates：成功写入缓存，24h 内复用，强制刷新 60s 生效', async () => {
  const ls = new LSShim();
  let calls = 0;
  let clock = 1_000_000_000;
  const fetchImpl = async () => { calls += 1; return okResponse([release('v1.0.1')]); };
  const opts = { currentVersion: '1.0.0', fetchImpl, storage: ls, now: () => clock };

  const first = await checkForUpdates(opts);
  assert.equal(first.status, 'available');
  assert.equal(first.latest.version, '1.0.1');
  assert.equal(first.fromCache, false);
  assert.equal(calls, 1);

  clock += 3600 * 1000;
  const cached = await checkForUpdates(opts);
  assert.equal(cached.fromCache, true);
  assert.equal(calls, 1);

  clock += 60 * 1000;
  const forced = await checkForUpdates({ ...opts, force: true });
  assert.equal(forced.fromCache, false);
  assert.equal(calls, 2);
});

test('checkForUpdates：403 限流时保留上次缓存结果并标记错误', async () => {
  const ls = new LSShim();
  let clock = 1_000_000_000;
  let mode = 'ok';
  const fetchImpl = async () => (mode === 'ok' ? okResponse([release('v1.0.1')]) : errResponse(403, '0'));
  const opts = { currentVersion: '1.0.0', fetchImpl, storage: ls, now: () => clock };
  await checkForUpdates(opts);
  mode = 'rate';
  clock += 25 * 3600 * 1000;
  const r = await checkForUpdates(opts);
  assert.equal(r.status, 'error');
  assert.equal(r.error, 'rate-limited');
  assert.equal(r.releases.length, 1, '上次成功解析的版本列表仍可展示');
});

test('checkForUpdates：非数组响应归类 bad-response', async () => {
  const ls = new LSShim();
  const r = await checkForUpdates({
    currentVersion: '1.0.0', storage: ls,
    fetchImpl: async () => okResponse({ message: 'not an array' }),
  });
  assert.equal(r.error, 'bad-response');
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});
