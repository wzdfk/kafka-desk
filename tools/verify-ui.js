/* 本地可重复运行的界面自检（无浏览器环境时用）：
 * 手写一个够用的 DOM + fetch/EventSource 桩，用 vm 真跑 public/app.js，
 * 再对配置区的折叠板块、自动保存、连接按钮做断言。
 * 用法：node tools/verify-ui.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

/* ------------------------------ DOM ------------------------------ */
const VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'area']);
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  (${extra})`}`);
}

function parseSelector(sel) {
  const parts = { tag: null, classes: [], id: null, attrs: [] };
  const re = /([.#]?[\w-]+|\[[^\]]+\])/g;
  let m;
  while ((m = re.exec(sel))) {
    const t = m[1];
    if (t[0] === '.') parts.classes.push(t.slice(1));
    else if (t[0] === '#') parts.id = t.slice(1);
    else if (t[0] === '[') {
      const body = t.slice(1, -1);
      const eq = body.indexOf('=');
      if (eq < 0) parts.attrs.push([body, null]);
      else parts.attrs.push([body.slice(0, eq), body.slice(eq + 1).replace(/^["']|["']$/g, '')]);
    } else parts.tag = t.toLowerCase();
  }
  return parts;
}
function matches(el, sel) {
  const p = parseSelector(sel);
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.id && el.id !== p.id) return false;
  if (p.classes.some((c) => !el.classList.contains(c))) return false;
  return p.attrs.every(([k, v]) => {
    const have = el.getAttribute(k);
    return v === null ? have !== null : String(have) === v;
  });
}

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toLowerCase();
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this._text = '';
    this._handlers = {};
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.className = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientWidth = 0;
    this.offsetLeft = 0;
    this.offsetWidth = 0;
    this.hidden = false;
  }
  get classList() {
    const self = this;
    const list = () => String(self.className || '').split(/\s+/).filter(Boolean);
    return {
      add: (...c) => { const s = new Set(list()); c.forEach((x) => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { const s = new Set(list()); c.forEach((x) => s.delete(x)); self.className = [...s].join(' '); },
      toggle: (c, on) => {
        const has = list().includes(c);
        const want = on === undefined ? !has : !!on;
        if (want && !has) self.className = [...list(), c].join(' ');
        if (!want && has) self.className = list().filter((x) => x !== c).join(' ');
        return want;
      },
      contains: (c) => list().includes(c),
    };
  }
  set class(v) { this.className = v; }
  get class() { return this.className; }
  set id(v) { this.attrs.id = String(v); this._id = String(v); }
  get id() { return this._id || ''; }
  get textContent() {
    if (this.children.length) return `${this._text}${this.children.map((c) => c.textContent).join('')}`;
    return this._text;
  }
  set textContent(v) {
    this._text = v === null || v === undefined ? '' : String(v);
    this.children = [];
  }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) {
    this._html = String(v);
    if (!v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = ''; }
  }
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get options() { return this.children.filter((c) => c.tagName === 'option'); }
  appendChild(node) {
    if (!node) return node;
    if (node.tagName === '#fragment') {
      [...node.children].forEach((c) => this.appendChild(c));
      node.children = [];
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(typeof n === 'string' ? textNode(n) : n)); }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const i = this.children.indexOf(ref);
    node.parentNode = this;
    if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'id') this._id = String(v);
    else if (k === 'class') this.className = String(v);
    else if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  matches(sel) { return matches(this, sel); }
  closest(sel) {
    let n = this;
    while (n) { if (matches(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  _descendants(out) {
    for (const c of this.children) { out.push(c); c._descendants(out); }
    return out;
  }
  querySelectorAll(sel) { return this._descendants([]).filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); }
  dispatch(type, extra = {}) {
    let stopped = false;
    const evt = Object.assign({
      type, target: this, currentTarget: this,
      stopPropagation() { stopped = true; }, preventDefault() {},
      key: '', ctrlKey: false, metaKey: false,
    }, extra);
    let node = this;
    while (node) {
      evt.currentTarget = node;
      for (const fn of (node._handlers && node._handlers[type]) || []) fn.call(node, evt);
      if (stopped) break;
      node = node.parentNode;
    }
  }
  click() { this.dispatch('click'); }
  focus() { doc.activeElement = this; }
  blur() {} select() {} scrollTo() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
}
function textNode(t) {
  const n = new El('#text');
  n._text = String(t);
  return n;
}

function parseHtml(src) {
  const root = new El('#root');
  const stack = [root];
  const tagRe = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let last = 0;
  let m;
  const pushText = (txt) => {
    if (!txt) return;
    const t = txt.replace(/\s+/g, ' ');
    if (t) stack[stack.length - 1].appendChild(textNode(t));
  };
  while ((m = tagRe.exec(src))) {
    pushText(src.slice(last, m.index));
    last = tagRe.lastIndex;
    if (m[0].startsWith('<!')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag) { stack.length = i; break; }
      continue;
    }
    const tag = m[2].toLowerCase();
    const el = new El(tag);
    const attrRe = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[3] || ''))) {
      const val = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
      el.setAttribute(a[1], val);
    }
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3] || '')) stack.push(el);
  }
  pushText(src.slice(last));
  return root;
}

const docRoot = parseHtml(html);
const htmlEl = docRoot.querySelector('html') || docRoot;
const bodyEl = docRoot.querySelector('body') || docRoot;
const doc = {
  documentElement: htmlEl,
  body: bodyEl,
  head: docRoot.querySelector('head') || htmlEl,
  activeElement: null,
  hidden: false,
  visibilityState: 'visible',
  _h: {},
  addEventListener(t, fn) { this._h[t] = (this._h[t] || []).concat(fn); },
  dispatch(t, extra) {
    const evt = Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, extra);
    (this._h[t] || []).forEach((f) => f(evt));
  },
  createElement: (t) => new El(t),
  createTextNode: (t) => textNode(t),
  createDocumentFragment: () => new El('#fragment'),
  getElementById: (id) => docRoot.querySelector(`#${id}`),
  querySelector: (s) => docRoot.querySelector(s),
  querySelectorAll: (s) => docRoot.querySelectorAll(s),
};

/* ---------------------------- 存储 / 网络 ---------------------------- */
const store = new Map();
const localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const calls = [];
const server = {
  id: 'srv1',
  name: 'server252kafka',
  brokers: ['192.168.1.252:9092'],
  config: { sendTopic: 'face.stream.stop', recvTopics: ['FlowBreakWarning', 'FlowBurstWarning'], groupId: '', fromBeginning: false },
  connected: false,
  subscribedTopics: [],
  lastError: '',
  msgCount: 0,
  createdAt: Date.now(),
};
const view = () => JSON.parse(JSON.stringify(server));
const jsonResponse = (obj, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(obj) });

function mockFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);
  calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u === '/api/servers') return jsonResponse({ demo: false, servers: [view()] });
  if (/\/topics$/.test(u)) return jsonResponse({ topics: ['face.stream.stop', 'FlowBreakWarning', 'FlowBurstWarning'] });
  if (/\/messages$/.test(u)) return jsonResponse({ messages: [] });
  if (/\/config$/.test(u)) {
    const b = JSON.parse(opts.body || '{}');
    server.config = {
      sendTopic: b.sendTopic || '', recvTopics: b.recvTopics || [],
      groupId: b.groupId || '', fromBeginning: !!b.fromBeginning,
    };
    return jsonResponse({ server: view(), resubscribed: [] });
  }
  if (/\/connect$/.test(u)) { server.connected = true; return jsonResponse({ server: view() }); }
  if (/\/disconnect$/.test(u)) {
    server.connected = false; server.subscribedTopics = [];
    return jsonResponse({ server: view() });
  }
  return jsonResponse({});
}
class EventSourceMock {
  constructor(url) { this.url = url; this._h = {}; EventSourceMock.last = this; }
  addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); }
  emit(type, data) { (this._h[type] || []).forEach((f) => f({ data: JSON.stringify(data) })); }
  close() {}
}

const win = {
  location: { hash: '' },
  localStorage,
  addEventListener: (t, fn) => doc.addEventListener(t, fn),
  confirm: () => true,
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {}, media: '' }),
};
const ctx = vm.createContext({
  window: win, document: doc, localStorage, location: win.location,
  fetch: mockFetch, EventSource: EventSourceMock, AbortController,
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  matchMedia: win.matchMedia,
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  JSON, Math, Date, Object, Array, String, Number, Boolean, Promise, Set, Map, RegExp, Error,
  encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, TextEncoder, TextDecoder,
});
ctx.globalThis = ctx;
process.on('unhandledRejection', (e) => console.log('UNHANDLED:', e && (e.message || e)));

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const run = (code) => vm.runInContext(code, ctx);
const $ = (id) => doc.getElementById(id);
const cfgPosts = () => calls.filter((c) => /\/config$/.test(c.url)).length;

(async () => {
  const appSrc = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
  await tick(140);

  /* ---------- 结构 ---------- */
  check('配置区已移除「当前服务器」块', !$('cfgServerName') && !doc.querySelector('.server-info'));
  check('已移除「保存配置」按钮', !$('saveConfig'));
  check('已移除独立的「断开」按钮', !$('disconnect'));

  const secs = doc.querySelectorAll('.acc');
  check('配置区正好三个板块', secs.length === 3, `实际 ${secs.length}`);
  check('板块顺序为 主题 / 其他 / 日志',
    secs.map((s) => s.dataset.sec).join(',') === 'topic,misc,log',
    secs.map((s) => s.dataset.sec).join(','));
  const titles = doc.querySelectorAll('.acc-title').map((t) => t.textContent);
  check('板块标题正确', titles.join('/') === '主题配置/其他设置/运行日志', titles.join('/'));
  check('每个板块都有可点的标题栏', doc.querySelectorAll('.acc-head').length === 3);
  check('标题栏按钮独立于容器（右侧可放操作）', doc.querySelectorAll('.acc-toggle').length === 3);
  const clearEl = $('clearLog');
  let clearInHead = false;
  for (let n = clearEl.parentNode; n; n = n.parentNode) {
    if (n.classList && n.classList.contains('acc-head')) { clearInHead = true; break; }
    if (n.classList && n.classList.contains('acc-body')) break;
  }
  check('日志清空按钮位于标题栏内（折叠时可见）', clearInHead);

  /* 自动化发送按钮搬到发送卡片头部，图标为播放语义 */
  const autoBtn = $('autoTestBtn');
  const inCardHead = (() => {
    for (let n = autoBtn.parentNode; n; n = n.parentNode) {
      if (n.classList && n.classList.contains('card-head')) return true;
      if (n.classList && (n.classList.contains('send-foot') || n.classList.contains('send-body'))) return false;
    }
    return false;
  })();
  check('自动化按钮位于发送区卡片头部', inCardHead);
  check('自动化按钮不再占用发送栏底部', doc.querySelectorAll('.send-foot #autoTestBtn').length === 0);
  const playPath = autoBtn.querySelectorAll('path')[0];
  check('自动化按钮使用播放图标（三角 path，无齿轮）',
    !!playPath && /^M8\.\d 5\.6/.test(playPath.getAttribute('d') || '') && autoBtn.querySelectorAll('circle').length === 0,
    playPath ? (playPath.getAttribute('d') || '').slice(0, 24) : 'no path');
  check('清空按钮不再占用内容区', doc.querySelectorAll('.acc-body .link-btn').length === 0);

  /* ---------- 默认展开状态 ---------- */
  check('默认展开主题配置', secs[0].classList.contains('is-open'));
  check('默认展开其他设置', secs[1].classList.contains('is-open'));
  check('默认收起运行日志', !secs[2].classList.contains('is-open'));
  check('aria-expanded 与状态一致',
    secs.map((s) => s.querySelector('.acc-toggle').getAttribute('aria-expanded')).join(',') === 'true,true,false');

  /* ---------- 折叠 / 展开 ---------- */
  const logHead = secs[2].querySelector('.acc-toggle');
  logHead.click();
  check('点击标题栏可展开日志板块', secs[2].classList.contains('is-open'));
  check('展开后 aria-expanded=true', logHead.getAttribute('aria-expanded') === 'true');
  await tick(10);
  check('展开状态已持久化',
    JSON.parse(localStorage.getItem('kafka-desk-cfg-sections') || '{}').log === true,
    localStorage.getItem('kafka-desk-cfg-sections'));
  logHead.click();
  check('再点一次可收起', !secs[2].classList.contains('is-open'));

  secs[0].querySelector('.acc-toggle').click();
  check('主题配置可收起', !secs[0].classList.contains('is-open'));
  secs[0].querySelector('.acc-toggle').click();
  check('主题配置可重新展开', secs[0].classList.contains('is-open'));
  check('折叠状态可被新会话读取', run('loadCfgSections().misc') === true);

  /* ---------- 板块标题上的摘要 ---------- */
  const meta = (k) => doc.querySelector(`.acc-meta[data-meta="${k}"]`).textContent;
  check('主题板块摘要显示已选数量', meta('topic') === '已选 0', meta('topic'));
  check('其他板块摘要显示消费组状态', meta('misc') === '消费组自动', meta('misc'));
  check('日志板块摘要显示条数', /条$/.test(meta('log')), meta('log'));

  /* ---------- 进入服务器 ---------- */
  run("location.hash = '#/server/srv1'");
  doc.dispatch('hashchange');
  await tick(140);
  check('已进入工作台', !$('appView').classList.contains('hidden'));
  check('未连接时按钮显示「连接」', $('connToggle').textContent === '连接', $('connToggle').textContent);
  check('底部保存提示常驻', /自动保存/.test($('cfgSaveHint').textContent));

  /* ---------- 自动保存仍然生效 ---------- */
  calls.length = 0;
  run("onTopicToggle('FlowHistoryWarning', true)");
  await tick(650);
  check('勾选接收主题触发自动保存', cfgPosts() === 1, `${cfgPosts()} 次`);
  check('保存载荷包含新主题',
    (calls.find((c) => /\/config$/.test(c.url)) || {}).body.recvTopics.includes('FlowHistoryWarning'));
  check('主题板块摘要同步更新', meta('topic') === '已选 3', meta('topic'));

  calls.length = 0;
  $('groupId').value = 'desk-demo-group';
  $('groupId').dispatch('change');
  await tick(650);
  check('改消费组自动保存', cfgPosts() === 1);
  check('其他板块摘要显示消费组 ID', meta('misc') === '消费组 desk-demo-group', meta('misc'));

  /* ---------- 连接 / 断开 ---------- */
  calls.length = 0;
  $('connToggle').click();
  await tick(200);
  check('连接后按钮变「断开」', $('connToggle').textContent === '断开', $('connToggle').textContent);
  $('connToggle').click();
  await tick(200);
  check('断开后按钮回「连接」', $('connToggle').textContent === '连接', $('connToggle').textContent);

  /* ---------- 日志板块 ---------- */
  EventSourceMock.last.emit('log', { serverId: 'srv1', level: 'info', text: '配置已保存: 发送=face.stream.stop', ts: Date.now() });
  await tick(120);
  check('日志写入板块内列表', $('logList').childElementCount >= 1, String($('logList').childElementCount));
  check('日志板块摘要随条数变化', meta('log') === `${$('logList').childElementCount} 条`, meta('log'));
  $('clearLog').click();
  check('清空日志后摘要归零', meta('log') === '0 条', meta('log'));

  /* ---------- 折叠后不影响功能 ---------- */
  secs[0].querySelector('.acc-toggle').click();   // 收起主题配置
  calls.length = 0;
  $('sendTopic').value = 'face.stream.stop.v2';
  $('sendTopic').dispatch('input');
  await tick(650);
  check('日志收起时卡片不带 log-open', !doc.querySelector('.config-card').classList.contains('log-open'));
  secs[2].querySelector('.acc-toggle').click();
  await tick(2);
  check('日志展开时卡片标记 log-open（吃满剩余高度）',
    doc.querySelector('.config-card').classList.contains('log-open') === true);
  secs[2].querySelector('.acc-toggle').click();
  await tick(2);
  check('日志再次收起后移除 log-open',
    doc.querySelector('.config-card').classList.contains('log-open') === false);
  check('板块收起后自动保存仍工作', cfgPosts() === 1, `${cfgPosts()} 次`);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.log('FAILED:', e && (e.stack || e.message) || e);
  process.exit(1);
});
