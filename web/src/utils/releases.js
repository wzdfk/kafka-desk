/* 版本检查：GitHub Releases 为唯一事实源（Q2）。
 * 全部为可注入依赖的纯函数，便于 node --test 离线运行（Q11 L1）。
 * 不复用 api.js：本地后端错误协议与 35s 超时都不适用于外部 API。 */
import { storageKeys } from './storage.js';

export const REPO = 'wzdfk/kafka-desk';
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export const SUCCESS_TTL = 24 * 60 * 60 * 1000;
export const FAIL_TTL = 30 * 60 * 1000;
export const MANUAL_THROTTLE = 60 * 1000;
export const REQUEST_TIMEOUT = 8000;

const EXE_RE = /^KafkaDesk-.+-portable\.exe$/i;

/* 只认 v?X.Y.Z；预发布 / 非法 tag 一律忽略（Q5）。 */
export function parseTag(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || '').trim());
  if (!m) return null;
  return {
    version: `${m[1]}.${m[2]}.${m[3]}`,
    major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]),
  };
}

export function compareSemver(a, b) {
  const x = parseTag(a);
  const y = parseTag(b);
  if (!x || !y) return 0;
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  }
  return 0;
}

/* 外链白名单：只放行本仓库的 HTTPS 页面 / 下载直链（Q7）。 */
export function assertGithubUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && u.hostname === 'github.com'
      && u.pathname.startsWith(`/${REPO}/`);
  } catch {
    return false;
  }
}

/* 下载资产额外限定为 release download 路径。 */
export function assertDownloadUrl(url) {
  return assertGithubUrl(url) && new URL(String(url)).pathname
    .startsWith(`/${REPO}/releases/download/`);
}

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

/* 草稿 Release / prerelease / 非法 tag 全部剔除；按 semver 倒序（Q5）。 */
export function normalizeReleases(raw, currentVersion) {
  if (!Array.isArray(raw)) throw new Error('bad-response');
  const out = [];
  for (const r of raw) {
    if (!r || r.draft || r.prerelease) continue;
    const parsed = parseTag(r.tag_name);
    if (!parsed) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const exe = assets.find((a) => a && EXE_RE.test(a.name || '') && assertDownloadUrl(a.browser_download_url));
    const sum = assets.find((a) => a && /\.sha256$/i.test(a.name || '') && assertDownloadUrl(a.browser_download_url));
    const notes = String(r.body || '').split('\n')
      .map((l) => l.replace(/^[#*\s]+/, '').trim())
      .find((l) => l && l.length > 2) || '';
    out.push({
      tag: r.tag_name,
      ...parsed,
      publishedAt: r.published_at || '',
      htmlUrl: r.html_url || RELEASES_PAGE,
      notes: notes.slice(0, 100),
      asset: exe ? { name: exe.name, url: exe.browser_download_url, size: exe.size || 0 } : null,
      sha256Url: sum ? sum.browser_download_url : '',
      relation: compareSemver(parsed.version, currentVersion) === 0
        ? 'current' : (compareSemver(parsed.version, currentVersion) > 0 ? 'newer' : 'older'),
    });
  }
  return out.sort((a, b) => compareSemver(b.version, a.version));
}

/* 最新版本 = 最大有效 semver，不取 API 第一条（Q5）。 */
export function selectLatest(releases, currentVersion) {
  const latest = releases[0] || null;
  const status = !latest ? 'empty'
    : (compareSemver(latest.version, currentVersion) > 0 ? 'available' : 'up-to-date');
  return { status, latest };
}

export function classifyError(err, res) {
  if (err && err.name === 'AbortError') return 'timeout';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (err && err.message === 'bad-response') return 'bad-response';
  if (res && res.status === 403) {
    const left = res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('X-RateLimit-Remaining') : null;
    if (left === '0') return 'rate-limited';
    return 'http-403';
  }
  if (res && !res.ok) return `http-${res.status}`;
  if (err instanceof TypeError) return 'offline';
  return err ? 'unknown' : 'unknown';
}

export function shouldCheck(cache, now = Date.now(), force = false) {
  if (!cache || !cache.checkedAt) return true;
  const age = now - cache.checkedAt;
  if (age < 0) return true;
  return force ? age >= MANUAL_THROTTLE : age >= (cache.ok ? SUCCESS_TTL : FAIL_TTL);
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function readCache(storage = defaultStorage()) {
  try {
    const raw = storage && storage.getItem(storageKeys.updateCheck);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function writeCache(data, storage = defaultStorage()) {
  try { if (storage) storage.setItem(storageKeys.updateCheck, JSON.stringify(data)); } catch { /* 隐私模式 */ }
}

/* 主流程：缓存节流 → 8s 超时请求 → 归一化 → 结果落盘；失败返回上次缓存。 */
export async function checkForUpdates({
  currentVersion,
  fetchImpl,
  storage = defaultStorage(),
  now = Date.now,
  force = false,
  timeout = REQUEST_TIMEOUT,
} = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const cache = readCache(storage);
  const cachedResult = (c) => ({
    ok: !!c?.ok,
    status: c?.status || 'error',
    releases: c?.releases || [],
    latest: c?.latest || null,
    checkedAt: c?.checkedAt || 0,
    fromCache: true,
    error: c?.error || null,
  });
  if (!shouldCheck(cache, now(), force)) return cachedResult(cache);

  if (!doFetch) {
    const out = { ok: false, status: 'error', error: 'offline', releases: [], latest: null, checkedAt: now(), fromCache: false };
    writeCache({ ...out, fromCache: undefined }, storage);
    return cache ? cachedResult(cache) : out;
  }

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await doFetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KafkaDesk-UpdateCheck' },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) {
      const error = classifyError(null, res);
      const out = { ok: false, status: 'error', error, releases: cache?.releases || [], latest: cache?.latest || null, checkedAt: now(), fromCache: false };
      writeCache({ ok: false, status: 'error', error, checkedAt: out.checkedAt, releases: out.releases, latest: out.latest }, storage);
      return out;
    }
    const releases = normalizeReleases(await res.json(), currentVersion);
    const { status, latest } = selectLatest(releases, currentVersion);
    const out = { ok: true, status, releases, latest, checkedAt: now(), fromCache: false, error: null };
    writeCache({ ok: true, status, releases, latest, checkedAt: out.checkedAt, error: null }, storage);
    return out;
  } catch (err) {
    const error = classifyError(err, null);
    const out = { ok: false, status: 'error', error, releases: cache?.releases || [], latest: cache?.latest || null, checkedAt: now(), fromCache: false };
    writeCache({ ok: false, status: 'error', error, checkedAt: out.checkedAt, releases: out.releases, latest: out.latest }, storage);
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* 由 preload 注入；网页端为 null（Q9）。 */
export function desktopBridge() {
  return typeof window !== 'undefined' ? (window.desktopUpdate || null) : null;
}

export function isDesktopApp() {
  return !!desktopBridge()?.isDesktop;
}

export function openExternal(url) {
  if (typeof window === 'undefined' || !assertGithubUrl(url)) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
