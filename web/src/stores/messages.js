import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/api.js';
import { readJson, storageKeys, writeJson, removeKey } from '../utils/storage.js';
import { useActiveStore } from './active.js';
import { usePrefsStore } from './prefs.js';

/* Receive-area runtime state. The hot path mirrors the legacy renderer:
 * plain (non-reactive) pending queue -> rAF flush in batches of 40 into a
 * shallowRef array, so deep proxies never wrap thousands of messages. */
export const MAX_MESSAGES = 500; // kept in the DOM list (settings override later)
export const MAX_PENDING = 2000; // queued but not yet rendered
export const BATCH_MESSAGES = 40; // rendered per animation frame
export const CACHE_LIMIT = 50; // messages cached per server across sessions
export const CACHE_VALUE_LIMIT = 8000;
export const MAX_PREVIEW = 20000;

const raf = typeof window !== 'undefined' && window.requestAnimationFrame
  ? window.requestAnimationFrame.bind(window)
  : (fn) => setTimeout(() => fn(Date.now()), 16);
const caf = typeof window !== 'undefined' && window.cancelAnimationFrame
  ? window.cancelAnimationFrame.bind(window)
  : clearTimeout;

/* Pretty-print a value if it is valid JSON, otherwise show it verbatim. */
export function pretty(value) {
  const raw = String(value ?? '');
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

export function previewText(value) {
  const shown = pretty(value);
  return shown.length > MAX_PREVIEW
    ? `${shown.slice(0, MAX_PREVIEW)}\n…（预览仅显示前 ${MAX_PREVIEW} 字符，完整内容见下方详情）`
    : shown;
}

export const useMessagesStore = defineStore('messages', () => {
  const serverId = ref('');
  const msgs = shallowRef([]); // rendered, newest at the end
  const paused = ref(false);
  const autoScroll = ref(true);
  const textFilter = ref('');
  const topicFilters = ref([]); // persisted multi-select (legacy filterKey)
  const count = ref(0); // displayed this session
  const dropped = ref(0);
  const restoredCount = ref(0);
  const rateCount = ref(0);
  const seenTopics = ref([]);
  const filterPanelShow = ref(false);

  const active = useActiveStore();
  const prefs = usePrefsStore();

  /* Settings-driven caps (settings 页「消息与缓存」); constants are defaults. */
  const domLimit = computed(() => prefs.maxMessages || MAX_MESSAGES);
  const cacheLimit = computed(() => prefs.cacheLimit || CACHE_LIMIT);

  let pending = []; // plain array, not reactive
  let cacheQueue = []; // newest arrivals for the local cache
  let rafId = null;
  let cacheTimer = null;

  /* Lowering the retained-message cap applies to what is already rendered. */
  watch(domLimit, (n) => {
    if (msgs.value.length > n) msgs.value = msgs.value.slice(msgs.value.length - n);
  });

  const activeSubs = computed(() => active.server?.subscribedTopics || []);
  /* Empty-state copy follows the legacy applyServerStatus wording. */
  const emptyText = computed(() => (activeSubs.value.length
    ? '已订阅，等待消息到达'
    : '在左侧勾选主题，然后点击顶部按钮订阅'));

  /* text ∧ topic conjunction (legacy applyFilterTo). */
  const filteredMsgs = computed(() => {
    const q = textFilter.value.trim().toLowerCase();
    const tf = topicFilters.value;
    return msgs.value.filter((m) => {
      if (tf.length && !tf.includes(m.topic)) return false;
      if (q) {
        const hay = `${m.topic || ''} ${m.key || ''} ${m.value || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  function reset() {
    if (rafId !== null) { caf(rafId); rafId = null; }
    pending.length = 0;
    cacheQueue.length = 0;
    msgs.value = [];
    count.value = 0;
    dropped.value = 0;
    restoredCount.value = 0;
    rateCount.value = 0;
    seenTopics.value = [];
    textFilter.value = '';
    paused.value = false;
    filterPanelShow.value = false;
  }

  function loadTopicFilters(id) {
    // legacy filter key: JSON array; also accepts a bare topic name
    const d = readJson(storageKeys.topicFilter(id), null);
    if (Array.isArray(d)) topicFilters.value = d.filter((t) => typeof t === 'string' && t);
    else if (typeof d === 'string' && d) topicFilters.value = [d];
    else topicFilters.value = [];
  }

  function persistTopicFilters() {
    if (serverId.value) writeJson(storageKeys.topicFilter(serverId.value), topicFilters.value);
  }

  /* Enter a server: flush caches, reset state, restore history. */
  async function setServer(id) {
    if (serverId.value && serverId.value !== id) flushCache();
    reset();
    serverId.value = id || '';
    if (!id) return;
    loadTopicFilters(id);
    await loadHistory(id);
  }

  /* Broker buffer first; fall back to the local cache (legacy loadHistory). */
  async function loadHistory(id) {
    let arr = [];
    try {
      const d = await api.bufferedMessages(id);
      arr = d.messages || [];
    } catch { /* service may be restarting */ }
    if (serverId.value !== id) return;
    if (arr.length) {
      restoredCount.value = arr.length;
      enqueue(arr.map((m) => ({ ...m, cached: true })));
    } else {
      const cached = readJson(storageKeys.messages(id), []);
      if (Array.isArray(cached) && cached.length) {
        restoredCount.value = cached.length;
        enqueue(cached);
      }
    }
  }

  function noteSeenTopic(topic) {
    if (!topic || seenTopics.value.includes(topic)) return;
    // 「全选」的人期望看到一切：新冒出来的主题自动纳入选择
    const knownBefore = active.filteredTopics.length;
    const coveredAll = topicFilters.value.length > 0 && topicFilters.value.length >= knownBefore;
    seenTopics.value = [...seenTopics.value, topic];
    if (coveredAll) {
      topicFilters.value = [...new Set([...topicFilters.value, topic])];
      persistTopicFilters();
    }
  }

  function enqueue(list) {
    if (!Array.isArray(list) || !list.length || !serverId.value) return;
    if (paused.value) { // 暂停显示：仍在接收但不渲染（legacy 计入 dropped）
      dropped.value += list.length;
      return;
    }
    pending.push(...list);
    const overflow = pending.length - MAX_PENDING;
    if (overflow > 0) {
      pending.splice(0, overflow);
      dropped.value += overflow;
    }
    scheduleFlush();
  }

  /* SSE kafka-messages → per-server filter → queue. */
  function ingest(arr) {
    if (!Array.isArray(arr)) return;
    const mine = arr.filter((m) => m && m.serverId === serverId.value);
    if (mine.length) enqueue(mine);
  }

  function scheduleFlush() {
    if (rafId === null) rafId = raf(flushPending);
  }

  function flushPending() {
    rafId = null;
    if (!pending.length) return;
    const batch = pending.splice(0, BATCH_MESSAGES);
    for (const m of batch) {
      noteSeenTopic(m.topic);
      cacheQueue.push(m);
    }
    if (cacheQueue.length > cacheLimit.value * 2) {
      cacheQueue.splice(0, cacheQueue.length - cacheLimit.value * 2);
    }
    const next = [...msgs.value, ...batch];
    const cap = domLimit.value;
    msgs.value = next.length > cap ? next.slice(next.length - cap) : next;
    count.value += batch.length;
    rateCount.value += batch.length;
    scheduleCacheSave();
    if (pending.length) scheduleFlush();
  }

  /* Drain the whole queue synchronously (tests / cache flush on demand). */
  function flushAll() {
    while (pending.length) flushPending();
  }

  /* ---- local cache: slim fields, 1200ms debounce, flush on unload/switch ---- */
  function saveMessageCache() {
    cacheTimer = null;
    if (!serverId.value) return;
    try {
      const slim = cacheQueue.slice(-cacheLimit.value).map((m) => ({
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
      writeJson(storageKeys.messages(serverId.value), slim);
    } catch { /* quota exceeded: keep in-memory only */ }
  }

  function scheduleCacheSave() {
    if (cacheTimer) clearTimeout(cacheTimer);
    cacheTimer = setTimeout(saveMessageCache, 1200);
  }

  function flushCache() {
    if (cacheTimer) { clearTimeout(cacheTimer); cacheTimer = null; saveMessageCache(); }
  }

  function clearMessages() {
    if (rafId !== null) { caf(rafId); rafId = null; }
    pending.length = 0;
    cacheQueue.length = 0;
    msgs.value = [];
    count.value = 0;
    dropped.value = 0;
    restoredCount.value = 0;
    if (serverId.value) removeKey(storageKeys.messages(serverId.value));
  }

  function togglePause() {
    paused.value = !paused.value;
  }

  function setTextFilter(v) { textFilter.value = v; }

  function setTopicFilters(list) {
    topicFilters.value = [...list];
    persistTopicFilters();
  }

  function setAutoScroll(on) { autoScroll.value = !!on; }

  /* Register a beforeunload flush once (browser only). */
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushCache);
  }

  return {
    serverId, msgs, filteredMsgs, paused, autoScroll, textFilter, topicFilters,
    count, dropped, restoredCount, rateCount, seenTopics, filterPanelShow, emptyText,
    setServer, ingest, enqueue, flushPending, flushAll, clearMessages, togglePause,
    setTextFilter, setTopicFilters, setAutoScroll, persistTopicFilters,
    flushCache, loadHistory,
  };
});
