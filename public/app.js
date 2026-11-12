'use strict';

const $ = (sel) => document.querySelector(sel);
const APP_VERSION = '1.0.0';
let MAX_MESSAGES = 500;        // DOM nodes kept (settings: 消息与缓存)
const MAX_PENDING = 2000;      // queued, not yet rendered
const BATCH_MESSAGES = 40;     // rendered per animation frame
const BATCH_LOGS = 20;
const MAX_LOGS = 200;
const MAX_PREVIEW = 20000;
let CACHE_LIMIT = 50;          // messages cached per server across sessions
const CACHE_VALUE_LIMIT = 8000;
const SAMPLE = {
  hello: 'kafka',
  source: 'KafkaDesk',
  ts: Date.now(),
  nested: { ok: true, items: [1, 2, 3] },
};

// Every server owns its own localStorage namespace -> full isolation.
const draftKey = (id) => `kafka-desk-draft.${id}`;
const msgKey = (id) => `kafka-desk-messages.${id}`;
const filterKey = (id) => `kafka-desk-topic-filter.${id}`;
const autoKey = (id) => `kafka-desk-auto.${id}`;

/* The receive-area filter used to be a single-select stored as a plain topic
 * name. Accept both that legacy value and the new JSON array. */
function loadFilterSelection(id) {
  let raw = '';
  try { raw = localStorage.getItem(filterKey(id)) || ''; } catch (_) { return []; }
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    if (Array.isArray(d)) return d.filter((t) => typeof t === 'string' && t);
    if (typeof d === 'string') return d ? [d] : [];
  } catch (_) { return raw ? [raw] : []; }   // legacy: bare topic name
  return [];
}
function persistTopicFilter() {
  if (!state.serverId) return;
  try { localStorage.setItem(filterKey(state.serverId), JSON.stringify(state.topicFilters)); }
  catch (_) { /* ignore quota / privacy mode */ }
}

const el = {
  homeView: $('#homeView'),
  appView: $('#appView'),
  backHome: $('#backHome'),
  serverTabs: $('#serverTabs'),
  demoBadge: $('#demoBadge'),
  sseBadge: $('#sseBadge'),
  statusBadge: $('#statusBadge'),
  homeCount: $('#homeCount'),
  addServer: $('#addServer'),
  serverGrid: $('#serverGrid'),

  sendTopic: $('#sendTopic'),
  sendTopicSelect: $('#sendTopicSelect'),
  refreshTopics: $('#refreshTopics'),
  topicSearch: $('#topicSearch'),
  topicChecks: $('#topicChecks'),
  pickedCount: $('#pickedCount'),
  customTopic: $('#customTopic'),
  addCustomTopic: $('#addCustomTopic'),
  groupId: $('#groupId'),
  fromBeginning: $('#fromBeginning'),
  saveHint: $('#cfgSaveHint'),
  connToggle: $('#connToggle'),
  clearLog: $('#clearLog'),
  logList: $('#logList'),

  sendTargetLabel: $('#sendTargetLabel'),
  sendKey: $('#sendKey'),
  payload: $('#payload'),
  jsonState: $('#jsonState'),
  byteCount: $('#byteCount'),
  draftState: $('#draftState'),
  sampleBtn: $('#sampleBtn'),
  formatBtn: $('#formatBtn'),
  clearPayload: $('#clearPayload'),
  sendBtn: $('#sendBtn'),

  msgCount: $('#msgCount'),
  msgRate: $('#msgRate'),
  dropHint: $('#dropHint'),
  topicButtons: $('#topicButtons'),
  toggleAllTopics: $('#toggleAllTopics'),
  filter: $('#filter'),
  topicFilterBtn: $('#topicFilterBtn'),
  topicFilterLabel: $('#topicFilterLabel'),
  topicFilterPanel: $('#topicFilterPanel'),
  topicFilterCount: $('#topicFilterCount'),
  topicFilterChecks: $('#topicFilterChecks'),
  topicFilterAll: $('#topicFilterAll'),
  topicFilterPickAll: $('#topicFilterPickAll'),
  autoScroll: $('#autoScroll'),
  pauseDisplay: $('#pauseDisplay'),
  clearMessages: $('#clearMessages'),
  messageList: $('#messageList'),
  emptyState: $('#emptyState'),
  emptyTitle: $('#emptyTitle'),
  emptyHint: $('#emptyHint'),
  recvFootInfo: $('#recvFootInfo'),

  serverModal: $('#serverModal'),
  modalTitle: $('#modalTitle'),
  modalName: $('#modalName'),
  modalBrokers: $('#modalBrokers'),
  modalError: $('#modalError'),
  modalClose: $('#modalClose'),
  modalCancel: $('#modalCancel'),
  modalSave: $('#modalSave'),

  autoModeBadge: $('#autoModeBadge'),
  autoReceipt: $('#autoReceipt'),
  autoRandBar: $('#autoRandBar'),
  autoRandomId: $('#autoRandomId'),
  autoRandField: $('#autoRandField'),
  autoRandLast: $('#autoRandLast'),
  autoTestBtn: $('#autoTestBtn'),
  autoStopQuick: $('#autoStopQuick'),
  autoRunBadge: $('#autoRunBadge'),
  autoRunText: $('#autoRunText'),
  autoModal: $('#autoModal'),
  autoModalClose: $('#autoModalClose'),
  autoModalDone: $('#autoModalDone'),
  autoCountPane: $('#autoCountPane'),
  autoTimedPane: $('#autoTimedPane'),
  autoTopic: $('#autoTopic'),
  autoPayloadState: $('#autoPayloadState'),
  autoTotal: $('#autoTotal'),
  autoCountInterval: $('#autoCountInterval'),
  autoTimedInterval: $('#autoTimedInterval'),
  autoTimedRate: $('#autoTimedRate'),
  autoCountStart: $('#autoCountStart'),
  autoCountStop: $('#autoCountStop'),
  autoTimedStart: $('#autoTimedStart'),
  autoTimedStop: $('#autoTimedStop'),
  autoCountBar: $('#autoCountBar'),
  autoCountProgressText: $('#autoCountProgressText'),
  autoStatusMode: $('#autoStatusMode'),
  autoStatusSent: $('#autoStatusSent'),
  autoStatusFailed: $('#autoStatusFailed'),
  autoStatusElapsed: $('#autoStatusElapsed'),
  autoStatusHint: $('#autoStatusHint'),
  autoError: $('#autoError'),
  toast: $('#toast'),

  settingsView: $('#settingsView'),
  settingsBtn: $('#settingsBtn'),
  settingsBack: $('#settingsBack'),
  setTitle: $('#setTitle'),
  setDesc: $('#setDesc'),
  setVersion: $('#setVersion'),
  themeQuick: $('#themeQuick'),
  themeNowLabel: $('#themeNowLabel'),
  prefMaxMessages: $('#prefMaxMessages'),
  prefCacheLimit: $('#prefCacheLimit'),
  storageSize: $('#storageSize'),
  clearLocalCache: $('#clearLocalCache'),
  sysLogSearch: $('#sysLogSearch'),
  sysLogLevels: $('#sysLogLevels'),
  sysLogFollow: $('#sysLogFollow'),
  sysLogList: $('#sysLogList'),
  sysLogCount: $('#sysLogCount'),
  sysLogExport: $('#sysLogExport'),
  sysLogClear: $('#sysLogClear'),
  aboutEndpoint: $('#aboutEndpoint'),
  aboutMode: $('#aboutMode'),
  aboutServers: $('#aboutServers'),
  aboutVersion: $('#aboutVersion'),
  aboutVersion2: $('#aboutVersion2'),
};

/* ------------------------------------------------------------------ *
 * Local preferences — global (not per server), persisted on this machine.
 * ------------------------------------------------------------------ */
const PREFS_KEY = 'kafka-desk-prefs';
const PREF_MAX_MESSAGES = [200, 500, 1000, 2000];
const PREF_CACHE_LIMIT = [20, 50, 100, 200, 500];
const prefs = loadPrefs();

function loadPrefs() {
  const out = { maxMessages: 500, cacheLimit: 50 };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (PREF_MAX_MESSAGES.includes(Number(raw.maxMessages))) out.maxMessages = Number(raw.maxMessages);
      if (PREF_CACHE_LIMIT.includes(Number(raw.cacheLimit))) out.cacheLimit = Number(raw.cacheLimit);
    }
  } catch (_) { /* broken storage -> defaults */ }
  MAX_MESSAGES = out.maxMessages;
  CACHE_LIMIT = out.cacheLimit;
  return out;
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* ignore */ }
  MAX_MESSAGES = prefs.maxMessages;
  CACHE_LIMIT = prefs.cacheLimit;
  updateFootInfo();
}

/* ------------------------------------------------------------------ *
 * Theme — light / dark / follow-system, resolved before first paint by an
 * inline script in index.html; this keeps it in sync afterwards.
 * ------------------------------------------------------------------ */
const THEME_KEY = 'kafka-desk-theme';
const THEME_MODES = ['light', 'dark', 'system'];
const THEME_LABEL = { light: '明亮', dark: '幽暗', system: '跟随系统' };
const themeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let themeMode = readThemeMode();

function readThemeMode() {
  try {
    const m = localStorage.getItem(THEME_KEY);
    if (THEME_MODES.includes(m)) return m;
  } catch (_) { /* ignore */ }
  return 'system';
}
function osDark() { return !!(themeQuery && themeQuery.matches); }
function effectiveTheme(mode) {
  return mode === 'system' ? (osDark() ? 'dark' : 'light') : (mode === 'dark' ? 'dark' : 'light');
}
function applyTheme(mode, options = {}) {
  const next = THEME_MODES.includes(mode) ? mode : 'system';
  themeMode = next;
  const eff = effectiveTheme(next);
  const root = document.documentElement;
  root.setAttribute('data-theme', eff);
  root.setAttribute('data-theme-mode', next);
  if (options.persist !== false) {
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignore */ }
  }
  paintThemeUI(eff);
  if (options.log) {
    sysLog('info', next === 'system' ? `主题切换为跟随系统（当前${THEME_LABEL[eff]}）` : `主题切换为${THEME_LABEL[next]}`, '设置');
  }
}
function paintThemeUI(eff) {
  if (el.themeQuick) {
    const nextLabel = THEME_LABEL[THEME_MODES[(THEME_MODES.indexOf(themeMode) + 1) % THEME_MODES.length]];
    el.themeQuick.dataset.mode = themeMode;
    el.themeQuick.title = `主题：${THEME_LABEL[themeMode]}${themeMode === 'system' ? `（当前显示${THEME_LABEL[eff]}）` : ''} · 点击切换到${nextLabel}`;
    el.themeQuick.setAttribute('aria-label', `切换主题，当前${THEME_LABEL[themeMode]}`);
  }
  document.querySelectorAll('[data-theme-opt]').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.themeOpt === themeMode);
    btn.setAttribute('aria-pressed', btn.dataset.themeOpt === themeMode ? 'true' : 'false');
  });
  if (el.themeNowLabel) {
    el.themeNowLabel.textContent = themeMode === 'system'
      ? `跟随系统 · 当前${THEME_LABEL[eff]}`
      : THEME_LABEL[themeMode];
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', eff === 'dark' ? '#161b23' : '#ffffff');
}
function cycleTheme() {
  const i = THEME_MODES.indexOf(themeMode);
  applyTheme(THEME_MODES[(i + 1) % THEME_MODES.length], { log: true });
}

/* ------------------------------------------------------------------ *
 * System log — client events plus every server's runtime log, kept on this
 * machine so a restart does not lose the last session.
 * ------------------------------------------------------------------ */
const SYSLOG_KEY = 'kafka-desk-syslog';
const SYSLOG_MAX = 400;
const SYSLOG_PERSIST = 200;
const sysLogs = [];
const sysLogView = { level: 'all', q: '' };
let sysLogFollow = true;
let sysLogTimer = null;
let activePane = 'appearance';

function normLevel(level) {
  return level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
}
function loadSysLogs() {
  try {
    const arr = JSON.parse(localStorage.getItem(SYSLOG_KEY) || '[]');
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
      if (!e || !e.text) continue;
      sysLogs.push({
        ts: Number(e.ts) || Date.now(),
        level: normLevel(e.level),
        src: typeof e.src === 'string' ? e.src.slice(0, 40) : '',
        text: String(e.text).slice(0, 600),
      });
    }
    if (sysLogs.length > SYSLOG_MAX) sysLogs.splice(0, sysLogs.length - SYSLOG_MAX);
  } catch (_) { /* ignore broken storage */ }
}
function persistSysLogs() {
  sysLogTimer = null;
  try { localStorage.setItem(SYSLOG_KEY, JSON.stringify(sysLogs.slice(-SYSLOG_PERSIST))); }
  catch (_) { /* quota: keep in memory only */ }
}
function scheduleSysPersist() {
  if (sysLogTimer) return;
  sysLogTimer = setTimeout(persistSysLogs, 900);
}
function sysLogMatch(e) {
  if (sysLogView.level !== 'all' && e.level !== sysLogView.level) return false;
  if (!sysLogView.q) return true;
  return e.text.toLowerCase().includes(sysLogView.q) || (e.src || '').toLowerCase().includes(sysLogView.q);
}
function buildSysLogNode(e) {
  const row = document.createElement('div');
  row.className = `sys-log-line lv-${e.level}`;
  const ts = span('sys-log-ts', timeLabel(e.ts));
  ts.title = new Date(e.ts).toLocaleString();
  const lv = span('sys-log-lv', e.level === 'error' ? 'ERR' : e.level === 'warn' ? 'WARN' : 'INFO');
  const src = span('sys-log-src', e.src || '—');
  src.title = e.src || '';
  const txt = span('sys-log-txt', e.text);
  txt.title = e.text;
  row.append(ts, lv, src, txt);
  return row;
}
function renderSysLogCount() {
  if (!el.sysLogCount) return;
  const shown = sysLogs.reduce((n, e) => n + (sysLogMatch(e) ? 1 : 0), 0);
  el.sysLogCount.textContent = shown === sysLogs.length
    ? `共 ${sysLogs.length} 条`
    : `显示 ${shown} / 共 ${sysLogs.length} 条`;
}
function renderSysLog() {
  const list = el.sysLogList;
  if (!list) return;
  list.innerHTML = '';
  const rows = sysLogs.filter(sysLogMatch);
  if (!rows.length) {
    list.appendChild(span('sys-log-empty', sysLogs.length ? '没有匹配当前筛选条件的日志' : '暂无日志'));
  } else {
    const frag = document.createDocumentFragment();
    for (const e of rows) frag.appendChild(buildSysLogNode(e));
    list.appendChild(frag);
  }
  renderSysLogCount();
  if (sysLogFollow) list.scrollTop = list.scrollHeight;
}
function appendSysLogNode(entry) {
  const list = el.sysLogList;
  if (!list) return;
  const empty = list.querySelector('.sys-log-empty');
  if (empty) empty.remove();
  list.appendChild(buildSysLogNode(entry));
  while (list.childElementCount > SYSLOG_MAX) list.firstElementChild.remove();
}
function sysLogPaneVisible() {
  return state.view === 'settings' && activePane === 'logs'
    && !el.settingsView.classList.contains('hidden');
}
function sysLog(level, text, src = '客户端') {
  const msg = String(text == null ? '' : text).trim();
  if (!msg) return;
  const lv = normLevel(level);
  const ts = Date.now();
  // A backend failure shows up twice (log event + app-error); collapse it.
  const last = sysLogs[sysLogs.length - 1];
  if (last && last.level === lv && last.text === msg && ts - last.ts < 1500) return;
  const entry = { ts, level: lv, src: String(src).slice(0, 40), text: msg.slice(0, 600) };
  sysLogs.push(entry);
  if (sysLogs.length > SYSLOG_MAX) sysLogs.splice(0, sysLogs.length - SYSLOG_MAX);
  scheduleSysPersist();
  if (!sysLogPaneVisible()) return;
  if (sysLogMatch(entry)) appendSysLogNode(entry);
  if (sysLogFollow) el.sysLogList.scrollTop = el.sysLogList.scrollHeight;
  renderSysLogCount();
}
function clearSysLog() {
  sysLogs.length = 0;
  renderSysLog();
  try { localStorage.removeItem(SYSLOG_KEY); } catch (_) { /* ignore */ }
}
function exportSysLog() {
  if (!sysLogs.length) { toast('暂无可导出的日志', 'error'); return; }
  const rows = sysLogs.map((e) => `${new Date(e.ts).toISOString()}\t${e.level.toUpperCase()}\t${e.src || '-'}\t${e.text}`);
  const blob = new Blob([`# KafkaDesk 系统日志 · ${new Date().toLocaleString()}\r\n` + rows.join('\r\n')], { type: 'text/plain;charset=utf-8' });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `KafkaDesk-log-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.log`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`已导出 ${sysLogs.length} 条日志`, 'success');
}
function localUsage() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('kafka-desk') !== 0) continue;
      bytes += (k.length + String(localStorage.getItem(k) || '').length) * 2;
    }
  } catch (_) { /* ignore */ }
  return bytes;
}
function fmtBytes(n) {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

const state = {
  view: 'home',          // 'home' | 'server' | 'settings'
  servers: [],
  demo: false,
  serverId: null,
  config: { sendTopic: '', recvTopics: [], groupId: '', fromBeginning: false },
  savedConfig: null,     // last config acked by the server (auto-save dedupe)
  catalog: [],           // topics known from broker + custom
  seenTopics: [],        // topics observed in messages (for the topic filter)
  selectedTopics: [],    // checkbox-checked candidates -> topic buttons
  subscribedTopics: [],  // actually running subscriptions
  topicSearch: '',
  filter: '',
  topicFilters: [],       // selected topics in receive-area filter; [] = show all
  autoScroll: true,
  paused: false,
  count: 0,
  dropped: 0,
  rateCount: 0,
  restoredCount: 0,
  busyTopics: new Set(),
  modalEditId: null,
  connBusy: null,        // serverId currently opening a connection
};

/* ------------------------------------------------------------------ *
 * top navigation tabs — servers the user has opened, persisted globally.
 * Tabs are only a shortcut: the registry (data/servers.json) stays the
 * source of truth, so a deleted server simply disappears from the strip.
 * ------------------------------------------------------------------ */
const TABS_KEY = 'kafka-desk-open-tabs';
const MAX_TABS = 20;          // 位置按打开顺序固定，多了就横向滚动
let tabIds = loadOpenTabs();
let lastTabsSig = '';
let lastActiveTabId = '';

function loadOpenTabs() {
  try {
    const d = JSON.parse(localStorage.getItem(TABS_KEY) || '[]');
    if (!Array.isArray(d)) return [];
    return [...new Set(d.filter((x) => typeof x === 'string' && x))].slice(-MAX_TABS);
  } catch (_) { return []; }
}
function saveOpenTabs() {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(tabIds)); }
  catch (_) { /* ignore quota / privacy mode */ }
}
function touchTab(id) {
  if (!id) return;
  // 选项卡位置 = 打开先后顺序，切换激活不重排（点击谁就只是激活谁）。
  if (tabIds.includes(id)) return;
  tabIds.push(id);
  if (tabIds.length > MAX_TABS) {
    // 超过上限时丢最早打开的那一项，但绝不丢掉当前正在看的服务器
    const keep = state.serverId || route().id;
    const drop = tabIds.find((x) => x !== keep && x !== id);
    if (drop) tabIds = tabIds.filter((x) => x !== drop);
  }
  saveOpenTabs();
}
function removeTab(id) {
  tabIds = tabIds.filter((x) => x !== id);
  lastTabsSig = '';
  saveOpenTabs();
}
function pruneTabs() {
  // Keep the server currently addressed by the URL even if the registry
  // snapshot has not arrived yet (deep link / freshly created server).
  const keep = state.serverId || route().id;
  const alive = tabIds.filter((id) => id === keep || state.servers.some((s) => s.id === id));
  if (alive.length !== tabIds.length) { tabIds = alive; saveOpenTabs(); }
  return alive;
}
function tabDotClass(s) {
  const subs = (s && s.subscribedTopics) || [];
  if (s && s.lastError && !s.connected && !subs.length) return 'is-err';
  if (subs.length) return 'is-sub';
  if (s && s.connected) return 'is-on';
  return '';
}
/* Scroll the strip horizontally only as far as needed. Using
 * scrollIntoView() here would also scroll the page in some layouts. */
function scrollTabIntoView(target) {
  if (!target || !el.serverTabs) return;
  const strip = el.serverTabs;
  const left = Number(target.offsetLeft);
  const width = Number(target.offsetWidth);
  const viewLeft = Number(strip.scrollLeft) || 0;
  const viewWidth = Number(strip.clientWidth);
  if (!Number.isFinite(left) || !Number.isFinite(width) || !Number.isFinite(viewWidth) || viewWidth <= 0) return;
  const pad = 8;
  if (left - pad < viewLeft) strip.scrollLeft = Math.max(0, left - pad);
  else if (left + width + pad > viewLeft + viewWidth) {
    strip.scrollLeft = left + width + pad - viewWidth;
  }
}
function tabsSignature(ids) {
  // Status events fire on every single send; skip DOM work when nothing
  // about the tab strip has changed (same guard as renderTopicBar).
  return JSON.stringify([
    state.view,
    state.serverId || '',
    ids,
    ids.map((id) => {
      const s = state.servers.find((x) => x.id === id);
      if (!s) return null;
      return [s.name, !!s.connected, (s.subscribedTopics || []).length, !!s.lastError];
    }),
  ]);
}
function renderTabs(force = false) {
  const ids = pruneTabs();
  const sig = tabsSignature(ids);
  if (!force && sig === lastTabsSig) return;
  lastTabsSig = sig;

  // Re-appending the static home tab keeps its bound click listener.
  el.serverTabs.innerHTML = '';
  el.backHome.classList.toggle('is-active', state.view === 'home');
  el.serverTabs.appendChild(el.backHome);
  let activeTabEl = null;

  for (const id of ids) {
    const s = state.servers.find((x) => x.id === id) || { id, name: id, brokers: [] };
    const subs = s.subscribedTopics || [];
    const active = state.view === 'server' && state.serverId === id;
    const brokers = (s.brokers || []).join(', ');

    const tab = document.createElement('div');
    tab.className = `nav-tab nav-tab-server${active ? ' is-active' : ''}`;
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'nav-tab-main';
    main.title = `${s.name}\n${brokers || '（无 Broker 地址）'}\n${active ? '当前服务器' : '点击切换到此服务器'}`;
    const dot = document.createElement('span');
    dot.className = `nav-dot ${tabDotClass(s)}`;
    const name = document.createElement('span');
    name.className = 'nav-tab-name';
    name.textContent = s.name;
    main.append(dot, name);
    if (subs.length) main.append(span('nav-tab-badge', String(subs.length)));
    main.addEventListener('click', () => { if (state.serverId !== id) goServer(id); });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'nav-tab-close';
    close.textContent = '×';
    close.title = '从选项卡移除（不会删除服务器）';
    close.addEventListener('click', () => {
      removeTab(id);
      if (state.serverId === id) goHome();
      else renderTabs(true);
    });

    tab.append(main, close);
    el.serverTabs.appendChild(tab);
    if (active) activeTabEl = tab;
  }
  if (!ids.length) {
    el.serverTabs.appendChild(span('tabs-hint', '打开服务器后，会在这里生成选项卡，点击即可切换'));
  }
  // Only scroll when the active server actually changes; a mere status update
  // must not yank the strip away from wherever the user scrolled it.
  const activeId = state.serverId || '';
  if (activeId !== lastActiveTabId) {
    lastActiveTabId = activeId;
    scrollTabIntoView(activeTabEl || el.backHome);
  }
}

const auto = {
  running: false,
  starting: false,     // config save in flight, before the first tick
  paused: false,       // running === true, but ticking is halted
  mode: null,          // 'count' | 'timed'
  gen: 0,              // invalidates in-flight ticks after stop / resume
  timer: null,
  total: 0,
  interval: 0,
  attempts: 0,
  sent: 0,
  failed: 0,
  consecutiveFail: 0,
  startedAt: 0,
  elapsedMs: 0,        // accumulated elapsed time (excluding paused periods)
  inFlight: false,     // a send request is currently awaiting the backend
  lastRender: 0,
  lastError: '',
  lastReceipt: null,   // { topic, partition, offset, bytes, ts, demo }
  lastSummary: '',     // shown as idle hint after a run ends
  randSeq: 0,          // keeps generated request ids unique within one ms
  lastRandId: '',      // last generated id, kept as delivery evidence after stop
  lastRandField: '',   // name of the field that was replaced
};

const pendingMessages = [];
const pendingLogs = [];
const msgNodes = [];
const cacheQueue = [];
let lastTopicBarSig = '';
let rafId = null;
let toastTimer = null;
let draftTimer = null;
let cacheTimer = null;
let configTimer = null;
let saveHintTimer = null;
const SAVE_HINT_IDLE = '配置改动会自动保存，无需手动提交';

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
function unique(list) {
  return [...new Set((list || []).filter((x) => typeof x === 'string' && x.trim()))];
}
function toast(message, type = '') {
  el.toast.textContent = message;
  el.toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
  if (type === 'error') sysLog('error', message, '客户端');
}
function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}
async function call(url, options = {}, timeoutMs = 35000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      ...options,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s），请检查 Broker 地址或网络`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const get = (url, timeout) => call(url, {}, timeout);
const post = (url, body = {}) => call(url, { method: 'POST', body: JSON.stringify(body) });
const put = (url, body = {}) => call(url, { method: 'PUT', body: JSON.stringify(body) });
const del = (url) => call(url, { method: 'DELETE' });

const byteLen = (s) => new TextEncoder().encode(s).length;
function timeLabel(ts) {
  const d = new Date(ts || Date.now());
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function validJson(text) {
  try { JSON.parse(text); return true; } catch (_) { return false; }
}
function pretty(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch (_) { return text; }
}
function activeServer() {
  return state.servers.find((s) => s.id === state.serverId) || null;
}
async function action(fn, okMessage) {
  try {
    const result = await fn();
    if (okMessage) toast(okMessage, 'success');
    return result;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}
function setBadge(cls, text) {
  const badge = el.statusBadge;
  badge.className = cls;
  badge.innerHTML = '<i class="dot"></i>';
  badge.appendChild(span('', text));
}

/* ------------------------------------------------------------------ *
 * routing
 * ------------------------------------------------------------------ */
function route() {
  if ((location.hash || '') === '#/settings') return { view: 'settings', id: null };
  const m = /^#\/server\/([A-Za-z0-9_-]+)$/.exec(location.hash || '');
  return m ? { view: 'server', id: m[1] } : { view: 'home', id: null };
}
function goHome() {
  if (location.hash === '#/home') renderRoute();
  else location.hash = '#/home';
}
function goServer(id) {
  const h = `#/server/${id}`;
  if (location.hash === h) renderRoute();
  else location.hash = h;
}
/* Settings is a route, not a modal: the workspace keeps running behind it,
 * so a subscription or an automated send is never interrupted by opening it. */
let settingsReturnHash = '#/home';
function goSettings() {
  const from = location.hash || '';
  if (from && from !== '#/settings') settingsReturnHash = from;
  if (location.hash === '#/settings') renderRoute();
  else location.hash = '#/settings';
}
function leaveSettings() {
  const back = settingsReturnHash && settingsReturnHash !== '#/settings' ? settingsReturnHash : '#/home';
  if (location.hash === back) renderRoute();
  else location.hash = back;
}
function flushLocalState() {
  if (!state.serverId) return;
  clearTimeout(configTimer);
  saveDraftNow();
  saveMessageCache();
}
async function fetchServer(id) {
  try {
    const d = await get(`/api/servers/${id}`, 8000);
    return d.server || null;
  } catch (_) { return null; }
}
async function renderRoute() {
  const r = route();
  if (r.view === 'settings') {
    showSettings();
    return;
  }
  if (r.view === 'home') {
    flushLocalState();
    showHome();
    return;
  }
  let s = state.servers.find((x) => x.id === r.id) || await fetchServer(r.id);
  if (!s) {
    toast('服务器不存在或已被删除', 'error');
    goHome();
    return;
  }
  // A deep link may resolve before the registry snapshot arrives.
  if (!state.servers.some((x) => x.id === s.id)) state.servers.push(s);
  if (state.serverId !== r.id) flushLocalState();
  showServer(s);
}
function showHome() {
  if (auto.running || auto.starting) { stopAuto('已返回首页，自动化发送已停止', true); auto.lastSummary = ''; }
  state.serverId = null;
  state.view = 'home';
  el.homeView.classList.remove('hidden');
  el.appView.classList.add('hidden');
  el.settingsView.classList.add('hidden');
  el.settingsBtn.classList.remove('is-active');
  setBadge('chip chip-off', '未连接');
  renderTabs(true);
  renderHomeCards();
}
function showServer(s) {
  if ((auto.running || auto.starting) && state.serverId && state.serverId !== s.id) {
    stopAuto('已切换服务器，自动化发送已停止', true);
    auto.lastSummary = '';   // never leak one server's summary into another
  }
  state.serverId = s.id;
  state.view = 'server';
  el.homeView.classList.add('hidden');
  el.appView.classList.remove('hidden');
  el.settingsView.classList.add('hidden');
  el.settingsBtn.classList.remove('is-active');
  touchTab(s.id);
  renderTabs(true);

  state.config = {
    sendTopic: (s.config && s.config.sendTopic) || '',
    recvTopics: [...((s.config && s.config.recvTopics) || [])],
    groupId: (s.config && s.config.groupId) || '',
    fromBeginning: !!(s.config && s.config.fromBeginning),
  };
  state.selectedTopics = [...state.config.recvTopics];
  state.subscribedTopics = [...(s.subscribedTopics || [])];
  state.catalog = unique([...state.selectedTopics, ...state.subscribedTopics]);
  state.savedConfig = { ...state.config };
  state.connBusy = null;
  flashSaveHint(SAVE_HINT_IDLE);

  resetMessageView();
  el.sendTopic.value = state.config.sendTopic;
  el.groupId.value = state.config.groupId;
  el.fromBeginning.checked = state.config.fromBeginning;
  el.sendTargetLabel.textContent = state.config.sendTopic || '（在左侧配置区设置）';
  renderSendTopicSelect();
  el.topicSearch.value = '';
  state.topicSearch = '';
  state.filter = '';
  el.filter.value = '';
  closeTopicFilterPanel();
  state.topicFilters = loadFilterSelection(s.id);
  state.autoScroll = true;
  el.autoScroll.checked = true;
  state.paused = false;
  el.pauseDisplay.checked = false;
  state.busyTopics = new Set();

  restoreDraftFor(s.id);
  validateJson();
  renderTopicChecks();
  renderTopicBar();
  renderTopicFilter();
  applyServerStatus(s, true);
  autoLoadSettings(s.id);
  renderAuto(true);
  loadHistory(s.id);
  loadTopics(s.id);
}

/* ------------------------------------------------------------------ *
 * settings view
 * ------------------------------------------------------------------ */
const PANE_META = {
  appearance: ['外观主题', '选择界面配色方案，改动立即生效，不需要重启。'],
  messages: ['消息与缓存', '接收区上限与本地缓存策略，对整个客户端生效。'],
  logs: ['系统日志', '客户端与本地服务的事件流水，可按级别筛选并导出。'],
  about: ['关于', '版本信息、运行模式与本机数据占用。'],
};

function showSettings() {
  state.view = 'settings';
  el.homeView.classList.add('hidden');
  el.appView.classList.add('hidden');
  el.settingsView.classList.remove('hidden');
  el.settingsBtn.classList.add('is-active');
  renderTabs(true);
  renderSettings();
  switchPane(activePane);
}
function switchPane(pane) {
  if (!PANE_META[pane]) pane = 'appearance';
  activePane = pane;
  document.querySelectorAll('.set-nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.pane === pane);
  });
  document.querySelectorAll('.set-pane').forEach((section) => {
    section.classList.toggle('is-on', section.dataset.pane === pane);
  });
  const meta = PANE_META[pane];
  el.setTitle.textContent = meta[0];
  el.setDesc.textContent = meta[1];
  if (pane === 'logs') renderSysLog();
  if (pane === 'messages' || pane === 'about') renderSettingsValues();
}
function renderSettings() {
  renderSettingsValues();
  paintThemeUI(effectiveTheme(themeMode));
}
function renderSettingsValues() {
  if (el.prefMaxMessages) el.prefMaxMessages.value = String(prefs.maxMessages);
  if (el.prefCacheLimit) el.prefCacheLimit.value = String(prefs.cacheLimit);
  if (el.storageSize) el.storageSize.textContent = `本机占用 ${fmtBytes(localUsage())}`;
  if (el.setVersion) el.setVersion.textContent = `v${APP_VERSION}`;
  if (el.aboutVersion) el.aboutVersion.textContent = `v${APP_VERSION}`;
  if (el.aboutVersion2) el.aboutVersion2.textContent = `v${APP_VERSION}`;
  if (el.aboutEndpoint) el.aboutEndpoint.textContent = location.origin;
  if (el.aboutMode) el.aboutMode.textContent = state.demo ? '演示模式（本地模拟）' : '真实 Kafka';
  if (el.aboutServers) el.aboutServers.textContent = `${state.servers.length} 台`;
}

/* ------------------------------------------------------------------ *
 * home cards
 * ------------------------------------------------------------------ */
function buildServerCard(s) {
  const card = document.createElement('article');
  card.className = 'server-card';

  const top = document.createElement('div');
  top.className = 'server-card-top';
  const icon = document.createElement('div');
  icon.className = 'server-icon';
  icon.textContent = 'K';
  const subs = (s.subscribedTopics || []).length;
  let stateCls = 'state-off';
  let stateText = '未连接';
  if (s.lastError && !s.connected && !subs) { stateCls = 'state-err'; stateText = '连接异常'; }
  else if (subs) { stateCls = 'state-sub'; stateText = `订阅中 ${subs}`; }
  else if (s.connected) { stateCls = 'state-on'; stateText = '已连接'; }
  top.append(icon, span(`server-state ${stateCls}`, stateText));

  const name = document.createElement('div');
  name.className = 'server-name';
  name.textContent = s.name;
  name.title = s.name;
  const brokers = document.createElement('div');
  brokers.className = 'server-brokers';
  brokers.textContent = (s.brokers || []).join(', ');
  brokers.title = (s.brokers || []).join('\n');

  const meta = document.createElement('div');
  meta.className = 'server-meta';
  const cfg = s.config || {};
  meta.textContent = `发送 ${cfg.sendTopic || '未设置'} · 候选主题 ${(cfg.recvTopics || []).length} · 消息 ${s.msgCount || 0}`;

  const actions = document.createElement('div');
  actions.className = 'server-actions';
  const enter = document.createElement('button');
  enter.type = 'button';
  enter.className = 'btn btn-primary btn-sm btn-enter';
  enter.textContent = '进入';
  enter.addEventListener('click', (e) => { e.stopPropagation(); goServer(s.id); });
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn btn-ghost btn-sm';
  edit.textContent = '编辑';
  edit.addEventListener('click', (e) => { e.stopPropagation(); openModal(s); });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-ghost btn-sm';
  remove.textContent = '删除';
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!window.confirm(`删除服务器「${s.name}」？\n该服务器的配置、订阅与本地缓存会一并移除。`)) return;
    const ok = await action(() => del(`/api/servers/${s.id}`), '服务器已删除');
    if (!ok) return;
    try { localStorage.removeItem(msgKey(s.id)); localStorage.removeItem(draftKey(s.id)); } catch (_) {}
    removeTab(s.id);
    if (state.serverId === s.id) { state.serverId = null; goHome(); }
    await refreshServers();
    renderTabs(true);
  });
  actions.append(enter, edit, remove);

  card.append(top, name, brokers, meta, actions);
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    goServer(s.id);
  });
  return card;
}
function renderHomeCards() {
  el.homeCount.textContent = `${state.servers.length} 台服务器`;
  el.serverGrid.innerHTML = '';
  for (const s of state.servers) el.serverGrid.appendChild(buildServerCard(s));

  const add = document.createElement('div');
  add.className = 'server-add-card';
  add.setAttribute('role', 'button');
  add.append(
    Object.assign(document.createElement('div'), { className: 'add-plus', textContent: '+' }),
    Object.assign(document.createElement('div'), { className: 'add-label', textContent: '添加 Broker' }),
    Object.assign(document.createElement('div'), { className: 'add-hint', textContent: 'Bootstrap Server 地址' })
  );
  add.addEventListener('click', () => openModal(null));
  el.serverGrid.appendChild(add);
}

/* ------------------------------------------------------------------ *
 * add / edit server modal
 * ------------------------------------------------------------------ */
function openModal(server) {
  state.modalEditId = server ? server.id : null;
  el.modalTitle.textContent = server ? '编辑 Broker' : '添加 Broker';
  el.modalName.value = server ? server.name : '';
  let defaultBrokers = '127.0.0.1:9092';
  if (!server && state.servers.length === 0) {
    try {
      const legacy = JSON.parse(localStorage.getItem('kafka-desk-config') || 'null');
      if (legacy && legacy.brokers) defaultBrokers = String(legacy.brokers).replace(/[,;]+/g, '\n');
    } catch (_) { /* ignore broken storage */ }
  }
  el.modalBrokers.value = server ? (server.brokers || []).join('\n') : defaultBrokers;
  el.modalError.classList.add('hidden');
  el.modalError.textContent = '';
  el.serverModal.classList.remove('hidden');
  setTimeout(() => el.modalName.focus(), 0);
}
function closeModal() {
  el.serverModal.classList.add('hidden');
  state.modalEditId = null;
}
function showModalError(message) {
  el.modalError.textContent = message;
  el.modalError.classList.remove('hidden');
}
async function saveModal() {
  const name = el.modalName.value.trim();
  const brokers = el.modalBrokers.value.trim();
  if (!brokers) { showModalError('Bootstrap Server 不能为空'); return; }
  el.modalSave.disabled = true;
  try {
    if (state.modalEditId) {
      await put(`/api/servers/${state.modalEditId}`, { name, brokers });
      closeModal();
      await refreshServers();
      toast('服务器信息已更新', 'success');
    } else {
      // First server: migrate the pre-multi-server localStorage data so that
      // the previous config / draft / message cache is not lost.
      let legacy = null;
      if (state.servers.length === 0) {
        try {
          const c = JSON.parse(localStorage.getItem('kafka-desk-config') || 'null');
          const one = c ? (c.recvTopic || c.topic || '') : '';
          legacy = {
            config: c ? {
              sendTopic: c.sendTopic || c.topic || '',
              recvTopics: c.recvTopics || (one ? [one] : []),
              groupId: c.groupId || '',
              fromBeginning: false,
            } : {},
            draft: localStorage.getItem('kafka-desk-draft'),
            messages: localStorage.getItem('kafka-desk-messages'),
          };
        } catch (_) { legacy = null; }
      }
      const d = await post('/api/servers', { name, brokers, config: legacy ? legacy.config : {} });
      if (legacy) {
        try {
          if (legacy.draft) localStorage.setItem(draftKey(d.server.id), legacy.draft);
          if (legacy.messages) localStorage.setItem(msgKey(d.server.id), legacy.messages);
          ['kafka-desk-config', 'kafka-desk-draft', 'kafka-desk-messages']
            .forEach((k) => localStorage.removeItem(k));
        } catch (_) { /* ignore quota / privacy mode */ }
      }
      closeModal();
      await refreshServers();
      goServer(d.server.id);
      toast('已添加服务器，已进入工作区', 'success');
    }
  } catch (err) {
    showModalError(err.message);
  } finally {
    el.modalSave.disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * status
 * ------------------------------------------------------------------ */
function applyStatus(data) {
  state.demo = !!data.demo;
  state.servers = Array.isArray(data.servers) ? data.servers : [];
  el.demoBadge.classList.toggle('hidden', !state.demo);
  if (state.serverId) {
    const s = activeServer();
    if (!s) { state.serverId = null; goHome(); return; }
    applyServerStatus(s);
  } else {
    setBadge('chip chip-off', '未连接');
  }
  // Status events fire on every send. Both renderers are signature-guarded /
  // visibility-guarded so automated high-rate sending stays responsive.
  renderTabs();
  if (!state.serverId) renderHomeCards();
  if (state.view === 'settings') {
    // keep the 关于 pane honest without re-scanning localStorage per message
    if (el.aboutServers) el.aboutServers.textContent = `${state.servers.length} 台`;
    if (el.aboutMode) el.aboutMode.textContent = state.demo ? '演示模式（本地模拟）' : '真实 Kafka';
  }
}
function isServerUp(s) {
  // Subscriptions keep a consumer alive even when the producer is gone, so the
  // button must read as "connected" whenever anything is still running.
  return !!(s && (s.connected || (s.subscribedTopics || []).length));
}
/* One button, two faces: idle shows 连接 (primary), live shows 断开 (outline). */
function renderConnToggle(s) {
  const btn = el.connToggle;
  if (!btn) return;
  if (state.connBusy && state.connBusy === state.serverId) {
    btn.disabled = true;
    btn.className = 'btn btn-ghost conn-toggle is-busy';
    btn.textContent = '连接中…';
    btn.title = '正在与 Broker 建立连接，请稍候';
    btn.dataset.state = 'busy';
    return;
  }
  const up = isServerUp(s);
  btn.disabled = !state.serverId;
  btn.className = `btn conn-toggle ${up ? 'btn-ghost is-on' : 'btn-primary'}`;
  btn.textContent = up ? '断开' : '连接';
  btn.title = up
    ? '断开与 Broker 的连接，同时停止所有订阅'
    : '保存当前配置并连接 Broker';
  btn.dataset.state = up ? 'up' : 'down';
}
function applyServerStatus(s, forceChecks = false) {
  const subs = s.subscribedTopics || [];
  const before = state.subscribedTopics.join('|');
  state.subscribedTopics = [...subs];

  if (s.lastError && !s.connected && !subs.length) setBadge('chip chip-err', '连接异常');
  else if (subs.length) setBadge('chip chip-sub', `订阅中 ${subs.length}`);
  else if (s.connected) setBadge('chip chip-on', '已连接');
  else setBadge('chip chip-off', '未连接');

  renderConnToggle(s);
  renderCfgMeta();
  el.emptyTitle.textContent = subs.length ? '已订阅，等待消息到达' : '在左侧勾选主题，然后点击顶部按钮订阅';
  el.emptyHint.textContent = subs.length
    ? '顶部主题按钮可单独订阅/取消；「全部主题」下拉可按 topic 查看内容'
    : '消息会实时显示在这里，点击标题栏可展开完整详情';
  if (forceChecks || before !== state.subscribedTopics.join('|')) renderTopicChecks();
  renderTopicBar();
}
function updateFromServer(s) {
  if (!s || s.id !== state.serverId) return;
  const idx = state.servers.findIndex((x) => x.id === s.id);
  if (idx >= 0) state.servers[idx] = s;
  else state.servers.push(s);
  applyServerStatus(s);
}
async function refreshServers() {
  try { applyStatus(await get('/api/servers', 8000)); }
  catch (err) { toast(err.message, 'error'); }
}

/* ------------------------------------------------------------------ *
 * topic picker / config
 * ------------------------------------------------------------------ */
function readConfig() {
  return {
    sendTopic: el.sendTopic.value.trim(),
    recvTopics: [...state.selectedTopics],
    groupId: el.groupId.value.trim(),
    fromBeginning: el.fromBeginning.checked,
  };
}
async function saveConfig(silent = true) {
  if (!state.serverId) return null;
  const body = readConfig();
  // Every edit already triggers a save on its own; skip the round-trip when
  // the debounced copy matches what the broker-side runtime already holds.
  // Compared against `savedConfig` (last acked), not `config` (live mirror
  // that the topic input updates on every keystroke).
  if (sameConfig(state.savedConfig, body)) return null;
  flashSaveHint('保存中…', 'is-busy');
  let d;
  try {
    d = await post(`/api/servers/${state.serverId}/config`, body);
  } catch (err) {
    flashSaveHint('保存失败，改动未提交', 'is-err');
    throw err;
  }
  state.savedConfig = { ...body };
  if (d && d.server) {
    const idx = state.servers.findIndex((x) => x.id === d.server.id);
    if (idx >= 0) state.servers[idx] = d.server;
  }
  if (!silent) toast('配置已保存', 'success');
  flashSaveHint(`已自动保存 ${clockNow()}`, 'is-ok');
  return d;
}
function sameConfig(a, b) {
  if (!a || !b) return false;
  return a.sendTopic === b.sendTopic
    && a.groupId === b.groupId
    && !!a.fromBeginning === !!b.fromBeginning
    && JSON.stringify(a.recvTopics || []) === JSON.stringify(b.recvTopics || []);
}
function clockNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/* The save button is gone on purpose: the hint line below the button row is
 * the only "did it stick?" feedback, so it briefly turns green on success. */
function flashSaveHint(text, cls) {
  if (!el.saveHint) return;
  el.saveHint.textContent = text;
  el.saveHint.className = `field-tip save-hint ${cls || ''}`.trim();
  clearTimeout(saveHintTimer);
  if (cls === 'is-ok' || cls === 'is-busy') {
    saveHintTimer = setTimeout(() => {
      el.saveHint.textContent = SAVE_HINT_IDLE;
      el.saveHint.className = 'field-tip save-hint';
    }, 2200);
  }
}
function scheduleConfigSave() {
  clearTimeout(configTimer);
  configTimer = setTimeout(() => {
    saveConfig(true).catch((err) => toast(err.message, 'error'));
  }, 500);
}
/* ------------------------------------------------------------------ *
 * 配置区折叠板块：主题配置 / 其他设置 / 运行日志
 * 展开状态写进 localStorage，重开窗口保持上次的布局。
 * ------------------------------------------------------------------ */
const CFG_SEC_KEY = 'kafka-desk-cfg-sections';
const CFG_SEC_DEFAULTS = { topic: true, misc: true, log: false };
let cfgSections = loadCfgSections();

function loadCfgSections() {
  const out = { ...CFG_SEC_DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(CFG_SEC_KEY) || '{}');
    for (const k of Object.keys(out)) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  } catch (_) { /* 存坏了就用默认值 */ }
  return out;
}
function applyCfgSections() {
  document.querySelectorAll('.acc').forEach((sec) => {
    const key = sec.dataset.sec;
    const open = !!cfgSections[key];
    sec.classList.toggle('is-open', open);
    const btn = sec.querySelector('.acc-toggle');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  });
  // 日志展开时吃满上面两块之外的全部剩余高度（CSS 里另有 min-height:50% 保底）
  const card = document.querySelector('.config-card');
  if (card) card.classList.toggle('log-open', !!cfgSections.log);
}
function toggleCfgSection(key) {
  if (!Object.prototype.hasOwnProperty.call(CFG_SEC_DEFAULTS, key)) return;
  cfgSections[key] = !cfgSections[key];
  applyCfgSections();
  try { localStorage.setItem(CFG_SEC_KEY, JSON.stringify(cfgSections)); } catch (_) { /* 无痕模式 */ }
  // 展开日志时直接落到最新一条，省得再手动往下滚
  if (key === 'log' && cfgSections.log && el.logList) el.logList.scrollTop = el.logList.scrollHeight;
}
function setAccMeta(key, text) {
  const node = document.querySelector(`.acc-meta[data-meta="${key}"]`);
  if (node && node.textContent !== text) node.textContent = text;
}
function renderCfgMeta() {
  setAccMeta('topic', `已选 ${state.selectedTopics.length}`);
  const gid = (el.groupId.value || '').trim();
  setAccMeta('misc', gid ? `消费组 ${gid}` : '消费组自动');
  if (el.logList) setAccMeta('log', `${el.logList.childElementCount} 条`);
}
function renderTopicChecks() {
  const q = state.topicSearch.trim().toLowerCase();
  const all = unique([...state.catalog, ...state.selectedTopics, ...state.subscribedTopics]);
  const shown = q ? all.filter((t) => t.toLowerCase().includes(q)) : all;
  el.topicChecks.innerHTML = '';
  if (!shown.length) {
    el.topicChecks.appendChild(Object.assign(document.createElement('div'), {
      className: 'topic-empty',
      textContent: all.length ? '没有匹配的主题' : '点击「刷新」读取主题，或在下方手动添加',
    }));
  }
  for (const t of shown) {
    const label = document.createElement('label');
    label.className = 'check-row topic-row';
    if (state.subscribedTopics.includes(t)) label.classList.add('is-subscribed');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedTopics.includes(t);
    cb.addEventListener('change', () => onTopicToggle(t, cb.checked));
    const dot = document.createElement('span');
    dot.className = 'sub-dot';
    const name = span('topic-row-name', t);
    name.title = t;
    label.append(cb, dot, name);
    el.topicChecks.appendChild(label);
  }
  el.pickedCount.textContent = `已选 ${state.selectedTopics.length}`;
  setAccMeta('topic', `已选 ${state.selectedTopics.length}`);
}
function onTopicToggle(topic, checked) {
  if (checked) {
    if (!state.selectedTopics.includes(topic)) state.selectedTopics.push(topic);
  } else {
    state.selectedTopics = state.selectedTopics.filter((t) => t !== topic);
    if (state.subscribedTopics.includes(topic)) unsubscribeTopics([topic]);
  }
  renderTopicChecks();
  renderTopicBar();
  renderTopicFilter();
  scheduleConfigSave();
}
function addCustomTopic() {
  const t = el.customTopic.value.trim();
  if (!t) return;
  if (!/^[A-Za-z0-9._-]+$/.test(t)) { toast('主题名只允许字母、数字、点、下划线、连字符', 'error'); return; }
  state.catalog = unique([...state.catalog, t]);
  if (!state.selectedTopics.includes(t)) state.selectedTopics.push(t);
  el.customTopic.value = '';
  renderTopicChecks();
  renderTopicBar();
  renderTopicFilter();
  renderSendTopicSelect();
  scheduleConfigSave();
  toast(`已添加主题 ${t}`, 'success');
}
async function loadTopics(id, notify = false) {
  if (!id) return;
  if (notify) el.refreshTopics.disabled = true;
  try {
    const d = await get(`/api/servers/${id}/topics`, 15000);
    if (state.serverId !== id) return;
    state.catalog = unique([...(d.topics || []), ...state.selectedTopics, ...state.subscribedTopics]);
    renderTopicChecks();
    renderTopicFilter();
    renderSendTopicSelect();
    if (notify) toast(`读取到 ${(d.topics || []).length} 个主题`, 'success');
  } catch (err) {
    if (state.serverId !== id) return;
    const msg = `读取主题列表失败：${err.message}（可直接在下方添加自定义主题）`;
    if (notify) toast(msg, 'error');
    else enqueueLog({ level: 'warn', text: msg, ts: Date.now() });
  } finally {
    if (notify) el.refreshTopics.disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * topic buttons in receive area
 * ------------------------------------------------------------------ */
function renderTopicBar(force = false) {
  // Status events arrive once per automated send; skip identical re-renders.
  const sig = JSON.stringify([
    state.selectedTopics,
    state.subscribedTopics,
    [...state.busyTopics].sort(),
  ]);
  if (!force && sig === lastTopicBarSig) return;
  lastTopicBarSig = sig;
  el.topicButtons.innerHTML = '';
  if (!state.selectedTopics.length) {
    el.topicButtons.appendChild(Object.assign(document.createElement('span'), {
      className: 'topic-bar-empty',
      textContent: '在左侧勾选主题后，这里会出现订阅按钮',
    }));
  } else {
    for (const t of state.selectedTopics) {
      const on = state.subscribedTopics.includes(t);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `topic-btn${on ? ' active' : ''}`;
      b.disabled = state.busyTopics.has(t);
      b.title = on ? `点击取消订阅 ${t}` : `点击订阅 ${t}`;
      const dot = span('t-dot', '');
      const name = span('t-name', t);
      const st = span('t-state', on ? '已订阅' : '订阅');
      b.append(dot, name, st);
      b.addEventListener('click', () => toggleTopicSubscription(t));
      el.topicButtons.appendChild(b);
    }
  }
  const total = state.selectedTopics.length;
  const allOn = total > 0 && state.selectedTopics.every((t) => state.subscribedTopics.includes(t));
  el.toggleAllTopics.textContent = allOn ? '取消全部订阅' : '全部订阅';
  el.toggleAllTopics.disabled = total === 0 || state.busyTopics.size > 0;
}
async function unsubscribeTopics(topics) {
  if (!state.serverId) return;
  await action(async () => {
    const d = await post(`/api/servers/${state.serverId}/unsubscribe`, { topics });
    updateFromServer(d.server);
  }, `已取消订阅 ${topics.length} 个主题`);
  renderTopicChecks();
}
async function toggleTopicSubscription(topic) {
  if (!state.serverId || state.busyTopics.has(topic)) return;
  const on = state.subscribedTopics.includes(topic);
  state.busyTopics.add(topic);
  renderTopicBar();
  await action(async () => {
    const d = on
      ? await post(`/api/servers/${state.serverId}/unsubscribe`, { topics: [topic] })
      : await post(`/api/servers/${state.serverId}/subscribe`, { topics: [topic] });
    updateFromServer(d.server);
  }, on ? `已取消订阅 ${topic}` : `已订阅 ${topic}`);
  state.busyTopics.delete(topic);
  renderTopicBar();
  renderTopicChecks();
}
async function toggleAllTopics() {
  if (!state.serverId || state.busyTopics.size || !state.selectedTopics.length) return;
  const allOn = state.selectedTopics.every((t) => state.subscribedTopics.includes(t));
  const topics = allOn
    ? [...state.selectedTopics]
    : state.selectedTopics.filter((t) => !state.subscribedTopics.includes(t));
  if (!topics.length) return;
  state.busyTopics = new Set(topics);
  renderTopicBar();
  await action(async () => {
    const d = allOn
      ? await post(`/api/servers/${state.serverId}/unsubscribe`, { topics })
      : await post(`/api/servers/${state.serverId}/subscribe`, { topics });
    updateFromServer(d.server);
  }, allOn ? '已取消全部订阅' : `已订阅 ${topics.length} 个主题`);
  state.busyTopics = new Set();
  renderTopicBar();
  renderTopicChecks();
}
/* ---------- send-topic single-select (still allows manual typing) ---------- */
function renderSendTopicSelect() {
  const cur = el.sendTopic.value.trim();
  const list = unique([...state.catalog, ...(cur ? [cur] : [])]).sort();
  el.sendTopicSelect.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = list.length ? '从主题列表选择…' : '点击「刷新」读取 Broker 主题';
  el.sendTopicSelect.appendChild(ph);
  for (const t of list) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    el.sendTopicSelect.appendChild(o);
  }
  el.sendTopicSelect.value = list.includes(cur) ? cur : '';
}

/* ---------- receive-area multi-select topic filter ---------- */
function filterTopicCatalog() {
  // Keep user-selected items even if they vanish from the broker list, so a
  // refresh never silently drops an active filter.
  return unique([
    ...state.catalog,          // every topic fetched from the broker by 刷新
    ...state.selectedTopics, ...state.subscribedTopics, ...state.seenTopics, ...state.topicFilters,
  ]).sort();
}
function renderTopicFilter() {
  const list = filterTopicCatalog();
  const total = list.length;
  const picked = list.filter((t) => state.topicFilters.includes(t));
  const n = picked.length;
  el.topicFilterLabel.textContent = n === 0 ? '全部主题'
    : n === 1 ? picked[0]
    : `已选 ${n} 个主题`;
  el.topicFilterBtn.classList.toggle('is-filtering', n > 0);
  el.topicFilterCount.textContent = n === 0 ? `共 ${total} 个主题 · 显示全部`
    : n >= total ? `已全选 ${n} / ${total}`
    : `已选 ${n} / ${total}`;

  // Keep both header actions honest: never leave a button that silently does
  // nothing. 全选 is pointless once everything is checked; 清除筛选 is pointless
  // when no filter is active (that state already means "show everything").
  const allPicked = total > 0 && n >= total;
  el.topicFilterPickAll.disabled = total === 0 || allPicked;
  el.topicFilterPickAll.title = total === 0 ? '暂无可选主题'
    : allPicked ? '已勾选全部主题，可直接点「清除筛选」恢复显示全部' : '勾选全部主题';
  el.topicFilterAll.disabled = n === 0;
  el.topicFilterAll.title = n === 0 ? '当前未启用筛选，已在显示全部消息' : '清除筛选，显示全部消息';

  el.topicFilterChecks.innerHTML = '';
  if (!total) {
    el.topicFilterChecks.appendChild(Object.assign(document.createElement('div'), {
      className: 'tfp-empty',
      textContent: '暂无主题：订阅主题或收到消息后会自动出现在这里',
    }));
    return;
  }
  for (const t of list) {
    const label = document.createElement('label');
    label.className = 'check-row topic-row tfp-row';
    const picked = state.topicFilters.includes(t);
    if (picked) label.classList.add('is-picked');
    if (state.subscribedTopics.includes(t)) label.classList.add('is-subscribed');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = picked;
    cb.addEventListener('change', () => setTopicFilter(t, cb.checked));
    const dot = document.createElement('span');
    dot.className = 'sub-dot';
    const name = span('topic-row-name tfp-name', t);
    name.title = t;
    label.append(cb, dot, name);
    el.topicFilterChecks.appendChild(label);
  }
}
function setTopicFilter(topic, on) {
  state.topicFilters = on
    ? unique([...state.topicFilters, topic])
    : state.topicFilters.filter((t) => t !== topic);
  persistTopicFilter();
  renderTopicFilter();
  applyFilterAll();
}
function setAllTopicFilters(on) {
  const list = filterTopicCatalog();
  if (on && !list.length) return;          // nothing to pick, keep the button harmless
  state.topicFilters = on ? list : [];
  persistTopicFilter();
  renderTopicFilter();
  applyFilterAll();
}
function toggleTopicFilterPanel() {
  const open = el.topicFilterPanel.classList.toggle('hidden') === false;
  el.topicFilterBtn.classList.toggle('is-open', open);
  if (open) renderTopicFilter();
}
function closeTopicFilterPanel() {
  el.topicFilterPanel.classList.add('hidden');
  el.topicFilterBtn.classList.remove('is-open');
}
function noteSeenTopic(topic) {
  if (!topic || state.seenTopics.includes(topic)) return;
  // 点过「全选」的人期望看到的是一切，所以新冒出来的主题必须自动纳入，
  // 否则它会被筛掉 —— 那是按主题过滤最容易踩的坑。
  const knownBefore = filterTopicCatalog().length;
  const coveredAll = state.topicFilters.length > 0 && state.topicFilters.length >= knownBefore;
  state.seenTopics.push(topic);
  if (coveredAll) {
    state.topicFilters = unique([...state.topicFilters, topic]);
    persistTopicFilter();
  }
  // Only rebuild when the panel is open (or the selection changed) and a
  // genuinely new topic appeared, so high-rate floods never thrash the DOM.
  if (coveredAll || !el.topicFilterPanel.classList.contains('hidden')) renderTopicFilter();
}

/* ------------------------------------------------------------------ *
 * local cache (per server)
 * ------------------------------------------------------------------ */
function updateFootInfo() {
  const n = Math.min(cacheQueue.length, CACHE_LIMIT);
  const restored = state.restoredCount ? `已加载上次 ${state.restoredCount} 条 · ` : '';
  el.recvFootInfo.textContent = `${restored}${n ? `本地缓存最近 ${n} 条 · ` : ''}固定滚动区（最多 ${MAX_MESSAGES} 条）`;
}
function saveMessageCache() {
  cacheTimer = null;
  if (!state.serverId) return;
  try {
    const slim = cacheQueue.slice(-CACHE_LIMIT).map((m) => ({
      ts: m.ts,
      topic: m.topic,
      partition: m.partition,
      offset: String(m.offset),
      key: m.key || null,
      value: String(m.value || '').slice(0, CACHE_VALUE_LIMIT),
      headers: m.headers || {},
      timestamp: m.timestamp || null,
      demo: !!m.demo,
      cached: true,
    }));
    localStorage.setItem(msgKey(state.serverId), JSON.stringify(slim));
    updateFootInfo();
  } catch (_) { /* quota exceeded: keep in-memory only */ }
}
function scheduleCacheSave() {
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(saveMessageCache, 1200);
}
function restoreMessageCacheFor(id) {
  try {
    const arr = JSON.parse(localStorage.getItem(msgKey(id)) || '[]');
    if (Array.isArray(arr) && arr.length) {
      enqueueMessages(arr);
      return arr.length;
    }
  } catch (_) { /* ignore broken storage */ }
  return 0;
}
function clearMessageCache() {
  cacheQueue.length = 0;
  if (!state.serverId) return;
  try { localStorage.removeItem(msgKey(state.serverId)); } catch (_) {}
}
function saveDraftNow() {
  if (!state.serverId) return;
  try {
    localStorage.setItem(draftKey(state.serverId), JSON.stringify({
      payload: el.payload.value,
      key: el.sendKey.value,
      ts: Date.now(),
    }));
    el.draftState.textContent = '草稿已自动缓存';
  } catch (_) {
    el.draftState.textContent = '草稿缓存不可用';
  }
}
function scheduleDraftSave() {
  el.draftState.textContent = '缓存中…';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 300);
}
function restoreDraftFor(id) {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(id)) || 'null');
    if (d && typeof d.payload === 'string') {
      el.payload.value = d.payload;
      el.sendKey.value = typeof d.key === 'string' ? d.key : '';
      return;
    }
  } catch (_) { /* ignore broken storage */ }
  el.payload.value = JSON.stringify(SAMPLE, null, 2);
  el.sendKey.value = '';
}
async function loadHistory(id) {
  let arr = [];
  try { const d = await get(`/api/servers/${id}/messages`, 8000); arr = d.messages || []; }
  catch (_) { /* service may be restarting */ }
  if (state.serverId !== id) return;
  if (arr.length) {
    state.restoredCount = arr.length;
    enqueueMessages(arr.map((m) => ({ ...m, cached: true })));
  } else {
    state.restoredCount = restoreMessageCacheFor(id);
  }
  updateFootInfo();
}

/* ------------------------------------------------------------------ *
 * batched rendering
 * ------------------------------------------------------------------ */
function scheduleFlush() {
  if (rafId === null) rafId = requestAnimationFrame(flushPending);
}
function flushPending() {
  rafId = null;
  if (pendingMessages.length) {
    const batch = pendingMessages.splice(0, BATCH_MESSAGES);
    const frag = document.createDocumentFragment();
    for (const m of batch) {
      const node = buildMessageNode(m);
      // noteSeenTopic first: it may widen a "全选" filter to include this new
      // topic, and the node has to be filtered with the final selection.
      noteSeenTopic(m.topic);
      applyFilterTo(node);
      msgNodes.push(node);
      cacheQueue.push(m);
      frag.appendChild(node);
    }
    if (cacheQueue.length > CACHE_LIMIT * 2) {
      cacheQueue.splice(0, cacheQueue.length - CACHE_LIMIT * 2);
    }
    el.messageList.appendChild(frag);
    while (msgNodes.length > MAX_MESSAGES) {
      const old = msgNodes.shift();
      if (old.parentNode) old.parentNode.removeChild(old);
    }
    state.count += batch.length;
    state.rateCount += batch.length;
    el.msgCount.textContent = String(state.count);
    el.emptyState.classList.add('hidden');
    if (state.autoScroll) el.messageList.scrollTop = el.messageList.scrollHeight;
    scheduleCacheSave();
  }
  if (pendingLogs.length) {
    const batch = pendingLogs.splice(0, BATCH_LOGS);
    const frag = document.createDocumentFragment();
    for (const entry of batch) {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.append(span('log-time', timeLabel(entry.ts)), span(`log-${entry.level}`, entry.text));
      frag.appendChild(line);
    }
    el.logList.appendChild(frag);
    while (el.logList.childElementCount > MAX_LOGS) el.logList.firstChild.remove();
    el.logList.scrollTop = el.logList.scrollHeight;
    setAccMeta('log', `${el.logList.childElementCount} 条`);
  }
  if (pendingMessages.length || pendingLogs.length) scheduleFlush();
}
function updateDropHint() {
  el.dropHint.textContent = `· 已省略 ${state.dropped}`;
  el.dropHint.classList.remove('hidden');
}
function enqueueMessages(list) {
  if (!Array.isArray(list) || !list.length || !state.serverId) return;
  if (state.paused) {
    state.dropped += list.length;
    updateDropHint();
    return;
  }
  for (const m of list) pendingMessages.push(m);
  const overflow = pendingMessages.length - MAX_PENDING;
  if (overflow > 0) {
    pendingMessages.splice(0, overflow);
    state.dropped += overflow;
    updateDropHint();
  }
  scheduleFlush();
}
function enqueueLog(entry) {
  pendingLogs.push(entry);
  scheduleFlush();
}
function resetMessageView() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  pendingMessages.length = 0;
  pendingLogs.length = 0;
  msgNodes.forEach((n) => n.remove());
  msgNodes.length = 0;
  cacheQueue.length = 0;
  el.messageList.querySelectorAll('.msg').forEach((n) => n.remove());
  el.logList.innerHTML = '';
  el.emptyState.classList.remove('hidden');
  state.count = 0;
  state.dropped = 0;
  state.rateCount = 0;
  state.restoredCount = 0;
  state.seenTopics = [];
  el.msgCount.textContent = '0';
  el.dropHint.classList.add('hidden');
  el.messageList.scrollTop = 0;
  updateFootInfo();
}

/* ------------------------------------------------------------------ *
 * JSON editor / messages
 * ------------------------------------------------------------------ */
function validateJson() {
  const raw = el.payload.value;
  el.byteCount.textContent = `${byteLen(raw)} B`;
  if (!raw.trim()) {
    el.jsonState.className = 'json-state empty';
    el.jsonState.textContent = '等待输入';
    el.sendBtn.disabled = true;
    return;
  }
  try {
    JSON.parse(raw);
    el.jsonState.className = 'json-state ok';
    el.jsonState.textContent = '合法 JSON';
    el.sendBtn.disabled = false;
  } catch (err) {
    el.jsonState.className = 'json-state bad';
    el.jsonState.textContent = `JSON 错误：${err.message}`;
    el.sendBtn.disabled = true;
  }
}
function toggleExpand(node) {
  const expanded = node.classList.toggle('expanded');
  if (!expanded) return;
  if (state.autoScroll) {
    state.autoScroll = false;
    el.autoScroll.checked = false;
    toast('已暂停自动滚动，便于查看展开内容');
  }
  node.scrollIntoView({ block: 'nearest' });
}
function buildMessageNode(m) {
  const node = document.createElement('article');
  node.className = 'msg';
  node.dataset.topic = m.topic || '';
  node.dataset.search = `${m.topic || ''} ${m.key || ''} ${m.value || ''}`.toLowerCase();

  const head = document.createElement('div');
  head.className = 'msg-head';
  head.append(
    span('msg-time', timeLabel(m.ts)),
    span('msg-topic', m.topic || '(无主题)'),
    span('msg-pos', `p${m.partition} / @${m.offset}`)
  );
  if (m.key) head.append(span('badge', `key: ${m.key}`));
  const isJson = validJson(m.value || '');
  head.append(span(`badge ${isJson ? 'badge-json' : 'badge-text'}`, isJson ? 'JSON' : 'TEXT'));
  if (m.demo) head.append(span('badge badge-demo', 'DEMO'));
  if (m.cached) head.append(span('badge badge-cached', '上次'));
  head.append(span('badge', `${byteLen(m.value || '')} B`));
  head.append(span('msg-toggle', '点击展开 / 收起'));

  const raw = String(m.value || '');
  const shown = raw.length > MAX_PREVIEW
    ? `${raw.slice(0, MAX_PREVIEW)}\n…（预览仅显示前 ${MAX_PREVIEW} 字符，完整内容见下方详情）`
    : raw;
  const body = document.createElement('pre');
  body.className = 'msg-body';
  body.textContent = pretty(shown);

  const headers = Object.keys(m.headers || {}).length
    ? JSON.stringify(m.headers, null, 2)
    : '(无)';
  const detail = document.createElement('pre');
  detail.className = 'msg-detail';
  detail.textContent = [
    `topic     : ${m.topic || ''}`,
    `partition : ${m.partition}`,
    `offset    : ${m.offset}`,
    `key       : ${m.key || '(无)'}`,
    `timestamp : ${m.timestamp || '(无)'}`,
    `headers   : ${headers}`,
    `value     : ${raw}`,
  ].join('\n');

  node.append(head, body, detail);
  head.addEventListener('click', () => toggleExpand(node));
  body.addEventListener('click', () => {
    if (!node.classList.contains('expanded')) toggleExpand(node);
  });
  return node;
}
function applyFilterTo(node) {
  const textOk = !state.filter || node.dataset.search.includes(state.filter);
  const topicOk = !state.topicFilters.length || state.topicFilters.includes(node.dataset.topic);
  node.classList.toggle('hidden', !(textOk && topicOk));
}
function applyFilterAll() {
  el.messageList.querySelectorAll('.msg').forEach(applyFilterTo);
}

/* ------------------------------------------------------------------ *
 * events
 * ------------------------------------------------------------------ */
function bindEvents() {
  // 配置区三个板块：点标题栏折叠 / 展开，状态上次什么样就什么样
  document.querySelectorAll('.acc-toggle').forEach((btn) => {
    btn.addEventListener('click', () => toggleCfgSection(btn.dataset.sec));
  });
  applyCfgSections();
  renderCfgMeta();

  el.backHome.addEventListener('click', goHome);
  el.addServer.addEventListener('click', () => openModal(null));
  el.modalClose.addEventListener('click', closeModal);
  el.modalCancel.addEventListener('click', closeModal);
  el.modalSave.addEventListener('click', saveModal);
  el.serverModal.addEventListener('click', (e) => {
    if (e.target === el.serverModal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.topicFilterPanel.classList.contains('hidden')) { closeTopicFilterPanel(); return; }
    if (!el.autoModal.classList.contains('hidden')) { closeAutoModal(); return; }
    if (!el.serverModal.classList.contains('hidden')) { closeModal(); return; }
    if (state.view === 'settings') leaveSettings();
  });

  /* ---- theme + settings ---- */
  el.themeQuick.addEventListener('click', cycleTheme);
  el.settingsBtn.addEventListener('click', () => {
    if (state.view === 'settings') leaveSettings();
    else goSettings();
  });
  el.settingsBack.addEventListener('click', leaveSettings);
  document.querySelectorAll('.set-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchPane(btn.dataset.pane));
  });
  document.querySelectorAll('[data-theme-opt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeOpt, { log: true });
      renderSettingsValues();
    });
  });
  el.prefMaxMessages.addEventListener('change', () => {
    const v = Number(el.prefMaxMessages.value);
    if (!PREF_MAX_MESSAGES.includes(v)) return;
    prefs.maxMessages = v;
    savePrefs();
    sysLog('info', `接收区最多保留消息调整为 ${v} 条`, '设置');
    renderSettingsValues();
  });
  el.prefCacheLimit.addEventListener('change', () => {
    const v = Number(el.prefCacheLimit.value);
    if (!PREF_CACHE_LIMIT.includes(v)) return;
    prefs.cacheLimit = v;
    savePrefs();
    if (state.serverId) saveMessageCache();
    sysLog('info', `本地缓存条数调整为 ${v} 条/服务器`, '设置');
    renderSettingsValues();
  });
  el.clearLocalCache.addEventListener('click', () => {
    if (!window.confirm('清理本机缓存？\n会清空所有服务器缓存的接收消息、发送草稿与筛选记录，服务器配置不受影响。')) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('kafka-desk') !== 0) continue;
        if (k === THEME_KEY || k === PREFS_KEY || k === SYSLOG_KEY) continue;
        keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (_) { /* ignore */ }
    sysLog('info', '已清理本机缓存数据', '设置');
    renderSettingsValues();
    toast('本机缓存已清理', 'success');
  });
  el.sysLogLevels.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-log-level]');
    if (!btn) return;
    sysLogView.level = btn.dataset.logLevel;
    el.sysLogLevels.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === btn));
    renderSysLog();
  });
  el.sysLogSearch.addEventListener('input', () => {
    sysLogView.q = el.sysLogSearch.value.trim().toLowerCase();
    renderSysLog();
  });
  el.sysLogFollow.addEventListener('change', () => {
    sysLogFollow = el.sysLogFollow.checked;
    if (sysLogFollow) el.sysLogList.scrollTop = el.sysLogList.scrollHeight;
  });
  el.sysLogExport.addEventListener('click', exportSysLog);
  el.sysLogClear.addEventListener('click', () => {
    if (!sysLogs.length) { toast('日志已经是空的'); return; }
    if (!window.confirm(`清空 ${sysLogs.length} 条系统日志？`)) return;
    clearSysLog();
    sysLog('info', '系统日志已清空', '设置');
  });

  el.autoTestBtn.addEventListener('click', openAutoModal);
  el.autoRunBadge.addEventListener('click', openAutoModal);
  el.autoModalClose.addEventListener('click', closeAutoModal);
  el.autoModalDone.addEventListener('click', closeAutoModal);
  el.autoModal.addEventListener('click', (e) => {
    if (e.target === el.autoModal) closeAutoModal();
  });
  el.autoStopQuick.addEventListener('click', () => stopAuto('已手动停止'));
  el.autoCountStart.addEventListener('click', () => toggleAuto('count'));
  el.autoCountStop.addEventListener('click', () => stopAuto('已手动停止'));
  el.autoTimedStart.addEventListener('click', () => toggleAuto('timed'));
  el.autoTimedStop.addEventListener('click', () => stopAuto('已手动停止'));
  [el.autoTotal, el.autoCountInterval, el.autoTimedInterval].forEach((input) => {
    input.addEventListener('input', () => { autoSaveSettings(); renderAuto(true); });
  });
  // Persist the choice immediately; the next tick reads it live, so toggling
  // mid-run takes effect on the very next message.
  el.autoRandomId.addEventListener('change', () => {
    autoSaveSettings();
    renderAuto(true);
  });

  el.sendTopic.addEventListener('input', () => {
    const t = el.sendTopic.value.trim();
    el.sendTargetLabel.textContent = t || '（在左侧配置区设置）';
    state.config.sendTopic = t;   // keep the automation readout in sync immediately
    el.sendTopicSelect.value = [...el.sendTopicSelect.options].some((o) => o.value === t) ? t : '';
    scheduleConfigSave();
    if (autoModalOpen()) renderAuto(true);
  });
  // Single-select: choosing an existing topic fills the editable input above.
  el.sendTopicSelect.addEventListener('change', () => {
    const t = el.sendTopicSelect.value;
    if (!t) return;
    el.sendTopic.value = t;
    el.sendTargetLabel.textContent = t;
    state.config.sendTopic = t;
    scheduleConfigSave();
    if (autoModalOpen()) renderAuto(true);
  });
  el.groupId.addEventListener('change', () => {
    renderCfgMeta();
    scheduleConfigSave();
  });
  el.fromBeginning.addEventListener('change', scheduleConfigSave);
  el.connToggle.addEventListener('click', () => action(async () => {
    const s = activeServer();
    if (!s || state.connBusy) return;
    if (isServerUp(s)) {
      const d = await post(`/api/servers/${state.serverId}/disconnect`);
      if (d && d.server) updateFromServer(d.server);
      toast('已断开连接', 'success');
      return;
    }
    state.connBusy = state.serverId;
    renderConnToggle(s);
    try {
      await saveConfig(true);
      const d = await post(`/api/servers/${state.serverId}/connect`);
      if (d && d.server) updateFromServer(d.server);
      toast('连接成功', 'success');
    } finally {
      state.connBusy = null;
      renderConnToggle(activeServer() || s);
    }
  }));
  el.refreshTopics.addEventListener('click', () => loadTopics(state.serverId, true));
  el.topicSearch.addEventListener('input', () => {
    state.topicSearch = el.topicSearch.value;
    renderTopicChecks();
  });
  el.addCustomTopic.addEventListener('click', addCustomTopic);
  el.customTopic.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomTopic(); }
  });
  el.clearLog.addEventListener('click', () => {
    el.logList.innerHTML = '';
    setAccMeta('log', '0 条');
  });

  el.payload.addEventListener('input', () => {
    validateJson();
    scheduleDraftSave();
    if (autoModalOpen()) renderAuto(true);
  });
  el.sendKey.addEventListener('input', scheduleDraftSave);
  el.payload.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  });
  el.sampleBtn.addEventListener('click', () => {
    el.payload.value = JSON.stringify(SAMPLE, null, 2);
    validateJson();
    scheduleDraftSave();
  });
  el.formatBtn.addEventListener('click', () => {
    const raw = el.payload.value;
    if (!raw.trim()) return;
    try { el.payload.value = JSON.stringify(JSON.parse(raw), null, 2); }
    catch (err) { toast(`JSON 错误：${err.message}`, 'error'); }
    validateJson();
    scheduleDraftSave();
  });
  el.clearPayload.addEventListener('click', () => {
    el.payload.value = '';
    validateJson();
    scheduleDraftSave();
    el.payload.focus();
  });
  el.sendBtn.addEventListener('click', send);

  el.toggleAllTopics.addEventListener('click', toggleAllTopics);
  el.filter.addEventListener('input', () => {
    state.filter = el.filter.value.trim().toLowerCase();
    applyFilterAll();
  });
  el.topicFilterBtn.addEventListener('click', toggleTopicFilterPanel);
  el.topicFilterAll.addEventListener('click', () => setAllTopicFilters(false));
  el.topicFilterPickAll.addEventListener('click', () => setAllTopicFilters(true));
  el.autoScroll.addEventListener('change', () => { state.autoScroll = el.autoScroll.checked; });
  el.pauseDisplay.addEventListener('change', () => {
    state.paused = el.pauseDisplay.checked;
    toast(state.paused ? '已暂停显示（仍在接收）' : '已恢复显示');
  });
  el.clearMessages.addEventListener('click', () => {
    msgNodes.forEach((n) => n.remove());
    msgNodes.length = 0;
    clearMessageCache();
    state.count = 0;
    state.dropped = 0;
    state.restoredCount = 0;
    el.msgCount.textContent = '0';
    el.dropHint.classList.add('hidden');
    el.emptyState.classList.remove('hidden');
    updateFootInfo();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target !== el.payload) {
      e.preventDefault(); send();
    }
  });
  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('beforeunload', () => {
    saveDraftNow();
    saveMessageCache();
    persistSysLogs();
  });
}
async function send() {
  if (el.sendBtn.disabled || !state.serverId) return;
  const res = await action(async () => {
    await saveConfig(true);
    return post(`/api/servers/${state.serverId}/send`, {
      key: el.sendKey.value.trim(),
      payload: el.payload.value,
    });
  }, '消息已发送');
  // Manual sends also leave a Broker receipt in the automation readout.
  if (res && res.ok) {
    recordReceipt(res);
    if (autoModalOpen()) renderAuto(true);
  }
}

/* ------------------------------------------------------------------ *
 * automated sending (topic + payload always come from outside this modal)
 * ------------------------------------------------------------------ */
function autoModalOpen() {
  return !el.autoModal.classList.contains('hidden');
}
/* Short lowercase-alphanumeric id (12 chars). The sequence counter keeps it
 * unique even when several messages are produced within the same millisecond. */
function genRequestId() {
  const t = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  const s = (++auto.randSeq % 1296).toString(36).padStart(2, '0');
  return `${t}${r}${s}`;
}
/* The "first field" only exists for a non-empty plain JSON object. Arrays and
 * scalars have no field to replace, so callers must refuse to start. */
function firstBodyField(raw) {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const keys = Object.keys(obj);
    return keys.length ? keys[0] : null;
  } catch (_) { return null; }
}
/* Build one delivery's payload: replace ONLY the first field's value, keep
 * every other field and the key order, and never touch the editor / draft. */
function autoPayloadForSend(raw) {
  const field = firstBodyField(raw);
  if (!field) return null;
  const obj = JSON.parse(raw);
  const id = genRequestId();
  obj[field] = id;
  return { payload: JSON.stringify(obj), field, id };
}
function autoLoadSettings(id) {
  // Reset first so a server without saved settings never inherits the
  // previous server's checkbox state.
  el.autoRandomId.checked = false;
  try {
    const d = JSON.parse(localStorage.getItem(autoKey(id)) || 'null');
    if (!d) return;
    if (Number.isFinite(d.total)) el.autoTotal.value = d.total;
    if (Number.isFinite(d.countInterval)) el.autoCountInterval.value = d.countInterval;
    if (Number.isFinite(d.timedInterval)) el.autoTimedInterval.value = d.timedInterval;
    if (typeof d.randomId === 'boolean') el.autoRandomId.checked = d.randomId;
  } catch (_) { /* ignore broken storage */ }
}
function autoSaveSettings() {
  if (!state.serverId) return;
  try {
    localStorage.setItem(autoKey(state.serverId), JSON.stringify({
      total: Number(el.autoTotal.value),
      countInterval: Number(el.autoCountInterval.value),
      timedInterval: Number(el.autoTimedInterval.value),
      randomId: !!el.autoRandomId.checked,
    }));
  } catch (_) { /* ignore quota / privacy mode */ }
}
function readPositive(input, label, min, max) {
  const n = Number(input.value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} 需为 ${min} ~ ${max} 的整数`);
  }
  return n;
}
function autoError(text) {
  el.autoError.textContent = text;
  el.autoError.classList.remove('hidden');
}
function autoClearError() {
  el.autoError.textContent = '';
  el.autoError.classList.add('hidden');
}
function openAutoModal() {
  if (!state.serverId) { toast('请先进入一台服务器', 'error'); return; }
  autoClearError();
  if (!auto.running) autoLoadSettings(state.serverId);
  el.autoModal.classList.remove('hidden');
  renderAuto(true);
}
function closeAutoModal() {
  el.autoModal.classList.add('hidden');
}
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function autoElapsed() {
  return auto.elapsedMs + (auto.running && !auto.paused ? Date.now() - auto.startedAt : 0);
}
function recordReceipt(res) {
  if (!res || !res.ok) return;
  const md = res.metadata || {};
  auto.lastReceipt = {
    topic: res.topic || md.topicName || '',
    partition: md.partition,
    offset: md.baseOffset,
    bytes: res.bytes,
    ts: Date.now(),
    demo: !!state.demo,
  };
}
function renderAuto(force = false) {
  const now = Date.now();
  if (!force && now - auto.lastRender < 100) return;
  auto.lastRender = now;

  const running = auto.running;
  const countActive = running && auto.mode === 'count';
  const timedActive = running && auto.mode === 'timed';
  const topic = state.config.sendTopic || '';
  const payload = el.payload.value;
  const jsonOk = !!payload.trim() && validJson(payload);

  el.autoTopic.textContent = topic || '（左侧配置区未设置）';
  el.autoTopic.classList.toggle('bad', !topic);
  el.autoPayloadState.textContent = jsonOk
    ? `合法 JSON · ${byteLen(payload)} B · Key ${el.sendKey.value.trim() || '(无)'}`
    : 'JSON 不合法或为空，无法发送';
  el.autoPayloadState.classList.toggle('bad', !jsonOk);

  // Random request_id option: show exactly which field will be replaced and
  // the most recently generated id, so the replacement is visible.
  const randOn = !!el.autoRandomId.checked;
  const firstField = firstBodyField(payload);
  el.autoRandBar.classList.toggle('is-on', randOn);
  el.autoRandField.textContent = firstField || '（无法定位 · 内容体需为非空 JSON 对象）';
  el.autoRandField.classList.toggle('bad', randOn && !firstField);
  el.autoRandLast.classList.remove('bad');
  if (!randOn) {
    el.autoRandLast.textContent = '未启用 · 按原样投递发送区内容';
    el.autoRandLast.classList.add('muted');
    el.autoRandLast.classList.remove('receipt');
  } else if (auto.lastRandId) {
    el.autoRandLast.textContent = `${auto.lastRandId} · 已替换字段「${auto.lastRandField}」· 每条重新生成`;
    el.autoRandLast.classList.remove('muted');
    el.autoRandLast.classList.add('receipt');
  } else {
    el.autoRandLast.textContent = firstField
      ? `已启用 · 将替换字段「${firstField}」· 启动后显示最近生成的 ID`
      : '内容体不是非空 JSON 对象，无法替换首个字段';
    el.autoRandLast.classList.add('muted');
    el.autoRandLast.classList.remove('receipt');
    el.autoRandLast.classList.toggle('bad', !firstField);
  }

  const demo = !!state.demo;
  el.autoModeBadge.textContent = demo ? '演示模式 · 仅回显，不写入 Broker' : '真实 Kafka · 每条写入 Broker';
  el.autoModeBadge.classList.toggle('demo', demo);
  const r = auto.lastReceipt;
  el.autoReceipt.textContent = r
    ? `${r.topic || '?'} · p${r.partition == null ? '?' : r.partition} / @${r.offset == null ? '?' : r.offset} · ${r.bytes == null ? '?' : r.bytes} B · ${timeLabel(r.ts)}${r.demo ? ' · 演示回显' : ' · Broker 返回'}`
    : '尚无投递回执 · 启动后这里会显示 Broker 返回的 partition / offset';
  el.autoReceipt.classList.toggle('muted', !r);
  el.autoReceipt.classList.toggle('receipt', !!r);

  el.autoCountPane.classList.toggle('is-active', countActive);
  el.autoTimedPane.classList.toggle('is-active', timedActive);
  el.autoCountPane.classList.toggle('is-idle', running && !countActive);
  el.autoTimedPane.classList.toggle('is-idle', running && !timedActive);
  el.autoCountPane.classList.toggle('is-paused', countActive && auto.paused);
  el.autoTimedPane.classList.toggle('is-paused', timedActive && auto.paused);

  // Progress bar belongs to the count mode only. A timed run never touches it,
  // and any stop resets it to `0 / total`.
  const total = countActive ? auto.total : (Number(el.autoTotal.value) || 0);
  const done = countActive ? auto.attempts : 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  el.autoCountBar.style.width = `${pct}%`;
  el.autoCountProgressText.textContent = `${done} / ${total || '—'}`;

  const timedInterval = Number(el.autoTimedInterval.value) || 1000;
  el.autoTimedRate.textContent = String(Math.round((1000 / Math.max(10, timedInterval)) * 100) / 100);

  el.autoStatusMode.textContent = !running ? '空闲'
    : auto.paused ? `${auto.mode === 'count' ? '总数制' : '时间制'} · 已暂停`
    : auto.mode === 'count' ? `总数制 · 目标 ${auto.total} 条` : '时间制 · 持续发送';
  el.autoStatusMode.classList.toggle('running', running && !auto.paused);
  el.autoStatusMode.classList.toggle('paused', running && auto.paused);
  el.autoStatusSent.textContent = String(auto.sent);
  el.autoStatusFailed.textContent = String(auto.failed);
  el.autoStatusElapsed.textContent = running ? fmtElapsed(autoElapsed()) : '0s';
  el.autoStatusHint.textContent = auto.paused
    ? '已暂停 · 点「继续发送」从当前进度恢复'
    : running ? `运行中 · 间隔 ${auto.interval}ms · 实时读取发送区内容`
    : (auto.lastSummary || '间隔低于 50ms 可能造成较大压力');

  const label = (active) => !active ? '开始发送' : (auto.paused ? '继续发送' : '暂停发送');
  el.autoCountStart.textContent = label(countActive);
  el.autoTimedStart.textContent = label(timedActive);
  el.autoCountStart.classList.toggle('auto-toggle', countActive);
  el.autoTimedStart.classList.toggle('auto-toggle', timedActive);
  el.autoCountStart.classList.toggle('auto-resume', countActive && auto.paused);
  el.autoTimedStart.classList.toggle('auto-resume', timedActive && auto.paused);
  // The running mode keeps its button enabled (pause / resume); the other mode is locked.
  el.autoCountStart.disabled = running && !countActive;
  el.autoTimedStart.disabled = running && !timedActive;
  el.autoCountStop.disabled = !countActive;
  el.autoTimedStop.disabled = !timedActive;
  [el.autoTotal, el.autoCountInterval, el.autoTimedInterval].forEach((i) => { i.disabled = running; });

  el.autoRunBadge.classList.toggle('hidden', !running);
  el.autoStopQuick.classList.toggle('hidden', !running);
  el.autoTestBtn.classList.toggle('is-running', running && !auto.paused);
  el.autoTestBtn.classList.toggle('is-paused', running && auto.paused);
  el.autoRunText.textContent = auto.paused
    ? `已暂停 · 已发 ${auto.sent}`
    : countActive ? `总数制 ${auto.attempts}/${auto.total}` : `时间制 已发 ${auto.sent}`;
}
async function startAuto(mode) {
  if (auto.running || auto.starting) return;
  autoClearError();
  if (!state.serverId) { autoError('请先进入一台服务器'); return; }
  if (!el.payload.value.trim() || !validJson(el.payload.value)) {
    autoError('发送区 JSON 不合法或为空，请先修正后再启动'); return;
  }
  if (el.autoRandomId.checked && !firstBodyField(el.payload.value)) {
    autoError('已勾选「使用随机 request_id」，但内容体不是非空 JSON 对象，无法定位第一个字段；请取消勾选或修改内容'); return;
  }
  if (!String(state.config.sendTopic || '').trim()) {
    autoError('请先在左侧配置区填写「发送主题」'); return;
  }
  let total = 0;
  let interval = 0;
  try {
    interval = readPositive(mode === 'count' ? el.autoCountInterval : el.autoTimedInterval,
      '发送间隔', 10, 600000);
    if (mode === 'count') total = readPositive(el.autoTotal, '发送总数', 1, 100000);
  } catch (err) { autoError(err.message); return; }

  // Bump the generation before the first await: a stop / server switch during
  // the config save must invalidate this pending start.
  const myGen = ++auto.gen;
  auto.starting = true;
  autoSaveSettings();
  try { await saveConfig(true); }
  catch (err) {
    auto.starting = false;
    autoError(`保存配置失败：${err.message}`); return;
  }
  if (myGen !== auto.gen) { auto.starting = false; return; }  // stopped while saving
  auto.starting = false;

  resetAutoCounters();
  auto.running = true;
  auto.paused = false;
  auto.mode = mode;
  auto.total = total;
  auto.interval = interval;
  auto.startedAt = Date.now();
  auto.lastSummary = '';
  auto.lastReceipt = null;
  auto.lastRandId = '';
  auto.lastRandField = '';
  renderAuto(true);
  const randNote = el.autoRandomId.checked
    ? ` · 随机 request_id → 字段「${firstBodyField(el.payload.value)}」` : '';
  enqueueLog({
    level: 'info',
    text: `自动化发送启动：${mode === 'count' ? `总数 ${total} 条` : '时间制持续'} · 间隔 ${interval}ms · ${state.demo ? '演示模式' : '真实 Kafka'}${randNote}`,
    ts: Date.now(),
  });
  autoTick();
}
function toggleAuto(mode) {
  if (!auto.running) { startAuto(mode); return; }
  if (auto.mode !== mode) return;       // other mode is disabled while running
  if (auto.paused) resumeAuto();
  else pauseAuto();
}
function pauseAuto() {
  if (!auto.running || auto.paused) return;
  if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
  auto.elapsedMs += Date.now() - auto.startedAt;
  auto.paused = true;
  renderAuto(true);
  enqueueLog({ level: 'info', text: `自动化发送已暂停：当前进度保留，已发 ${auto.sent} 条`, ts: Date.now() });
}
function resumeAuto() {
  if (!auto.running || !auto.paused) return;
  auto.paused = false;
  auto.startedAt = Date.now();
  renderAuto(true);
  enqueueLog({ level: 'info', text: '自动化发送已继续', ts: Date.now() });
  if (!auto.inFlight) autoTick();
}
async function autoTick() {
  if (!auto.running || auto.paused || auto.inFlight) return;
  const gen = auto.gen;
  const id = state.serverId;
  if (!id) { stopAuto('已离开工作区，自动化发送已停止', true); return; }
  const rawPayload = el.payload.value;
  if (!rawPayload.trim() || !validJson(rawPayload)) {
    stopAuto('发送区 JSON 变为非法或为空，已自动停止'); return;
  }
  // Generate a fresh id immediately before each delivery. Only the payload
  // sent to Kafka is rebuilt; the editor / cached draft stay untouched.
  let payload = rawPayload;
  let rid = '';
  if (el.autoRandomId.checked) {
    const built = autoPayloadForSend(rawPayload);
    if (!built) {
      stopAuto('内容体不是非空 JSON 对象，无法写入随机 request_id，已自动停止'); return;
    }
    payload = built.payload;
    rid = built.id;
    auto.lastRandId = built.id;
    auto.lastRandField = built.field;
  }
  auto.inFlight = true;
  let res = null;
  let errMsg = '';
  try {
    res = await post(`/api/servers/${id}/send`, { key: el.sendKey.value.trim(), payload });
  } catch (err) {
    errMsg = err.message;
  }
  auto.inFlight = false;
  // A stop / pause / mode switch happened while the request was in flight:
  // discard this result entirely so no stale progress can reappear.
  if (!auto.running || gen !== auto.gen) return;

  auto.attempts++;
  if (res) {
    auto.sent++;
    auto.consecutiveFail = 0;
    recordReceipt(res);
    // Server-side logs dedupe identical text within 800ms, so automated sends
    // (identical payload) would otherwise be invisible in the log panel.
    // Emit a unique local line per real delivery, including the Broker offset.
    const rc = auto.lastReceipt;
    enqueueLog({
      level: 'info',
      text: `自动化投递 #${auto.sent} → ${rc.topic} · p${rc.partition == null ? '?' : rc.partition} / @${rc.offset == null ? '?' : rc.offset} (${rc.bytes == null ? '?' : rc.bytes} B)${rid ? ` · rid=${rid}` : ''}`,
      ts: Date.now(),
    });
  } else {
    auto.failed++;
    auto.consecutiveFail++;
    auto.lastError = errMsg;
    enqueueLog({ level: 'error', text: `自动化发送失败 #${auto.attempts}：${errMsg}`, ts: Date.now() });
  }
  // Progress / stats must be exact on every tick, so bypass the 100ms render throttle.
  renderAuto(true);
  if (auto.consecutiveFail >= 5) {
    stopAuto(`连续 5 次发送失败，已自动停止：${auto.lastError}`);
    return;
  }
  if (auto.mode === 'count' && auto.attempts >= auto.total) {
    stopAuto(`总数制完成：尝试 ${auto.attempts} 条，成功 ${auto.sent} 条，失败 ${auto.failed} 条`);
    return;
  }
  if (auto.paused) return;   // paused mid-flight: resumeAuto() will kick the next tick
  auto.timer = setTimeout(autoTick, auto.interval);
}
function resetAutoCounters() {
  auto.total = 0;
  auto.interval = 0;
  auto.attempts = 0;
  auto.sent = 0;
  auto.failed = 0;
  auto.consecutiveFail = 0;
  auto.startedAt = 0;
  auto.elapsedMs = 0;
  auto.lastError = '';
  auto.inFlight = false;
}
function stopAuto(reason = '', silent = false) {
  if (auto.timer) { clearTimeout(auto.timer); auto.timer = null; }
  const wasRunning = auto.running;
  const lastSent = auto.sent;
  const lastFailed = auto.failed;
  auto.gen++;                 // invalidate any in-flight request
  auto.running = false;
  auto.starting = false;
  auto.paused = false;
  auto.mode = null;
  resetAutoCounters();        // stop = full reset, never leave a partial 3/10
  // The receipt is a delivery log (Broker partition / offset), not progress:
  // keep it so the last real delivery remains verifiable after stopping.
  auto.lastSummary = wasRunning
    ? `上轮：成功 ${lastSent} · 失败 ${lastFailed} · 进度已清空`
    : '';
  renderAuto(true);
  if (wasRunning && reason) {
    const bad = /失败|非法|超时|错误/.test(reason);
    enqueueLog({ level: bad ? 'error' : 'info', text: `自动化发送停止：${reason}`, ts: Date.now() });
    if (!silent) toast(reason, bad ? 'error' : 'success');
  }
}

/* ------------------------------------------------------------------ *
 * SSE
 * ------------------------------------------------------------------ */
function connectSse() {
  const es = new EventSource('/api/stream');
  es.addEventListener('status', (e) => {
    try { applyStatus(JSON.parse(e.data)); } catch (_) { /* noop */ }
  });
  es.addEventListener('log', (e) => {
    try {
      const d = JSON.parse(e.data);
      // The system log keeps every server's runtime log, not just the one on screen.
      const srv = state.servers.find((x) => x.id === d.serverId);
      sysLog(d.level, d.text, srv ? srv.name : '服务');
      if (state.serverId && d.serverId === state.serverId) enqueueLog(d);
    } catch (_) { /* noop */ }
  });
  es.addEventListener('kafka-messages', (e) => {
    try {
      const arr = JSON.parse(e.data);
      if (!state.serverId || !Array.isArray(arr)) return;
      const mine = arr.filter((m) => m.serverId === state.serverId);
      if (mine.length) enqueueMessages(mine);
    } catch (_) { /* noop */ }
  });
  es.addEventListener('app-error', (e) => {
    try {
      const d = JSON.parse(e.data);
      if (state.serverId && d.serverId === state.serverId) toast(d.message, 'error');
      else {
        const srv = state.servers.find((x) => x.id === d.serverId);
        sysLog('error', d.message, srv ? srv.name : '服务');
      }
    } catch (_) { /* noop */ }
  });
  es.onopen = () => {
    el.sseBadge.classList.add('hidden');
    sysLog('info', '本地服务已连接（SSE）', '服务');
  };
  es.onerror = () => {
    el.sseBadge.className = 'chip chip-err';
    el.sseBadge.textContent = '本地服务已断开';
    el.sseBadge.classList.remove('hidden');
    sysLog('warn', '本地服务连接中断，正在自动重连…', '服务');
  };
}

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */
setInterval(() => {
  el.msgRate.textContent = String(state.rateCount);
  state.rateCount = 0;
  if (auto.running && autoModalOpen()) renderAuto(true);
}, 1000);

async function init() {
  bindEvents();
  loadSysLogs();
  applyTheme(themeMode, { persist: false });
  if (themeQuery) {
    const followOs = () => { if (themeMode === 'system') applyTheme('system', { persist: false }); };
    if (themeQuery.addEventListener) themeQuery.addEventListener('change', followOs);
    else if (themeQuery.addListener) themeQuery.addListener(followOs);   // older Edge
  }
  if (el.sysLogFollow) el.sysLogFollow.checked = sysLogFollow;
  renderSettings();
  validateJson();
  connectSse();
  await refreshServers();
  renderRoute();
  sysLog('info', `KafkaDesk v${APP_VERSION} 已启动 · ${state.demo ? '演示模式' : '真实 Kafka'} · 主题 ${THEME_LABEL[themeMode]}`, '客户端');
}
init();
