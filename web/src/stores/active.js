import { computed, reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/api.js';
import { debounce, readJson, storageKeys, writeJson } from '../utils/storage.js';
import { toast } from '../utils/toast.js';
import { useServersStore } from './servers.js';

export const CFG_SEC_DEFAULTS = { topic: true, misc: true, log: false };
const RUN_LOG_MAX = 200;
const TOPIC_NAME_RE = /^[A-Za-z0-9._-]+$/;
const SAVE_HINT_MS = 2200;
const DRAFT_DEBOUNCE_MS = 300;

export const SAMPLE = {
  hello: 'kafka',
  source: 'KafkaDesk',
  ts: Date.now(),
  nested: { ok: true, items: [1, 2, 3] },
};

const textEncoder = new TextEncoder();
/* UTF-8 byte length (CJK counts 3 bytes), matches the legacy byteLen. */
export function byteLen(str) {
  return textEncoder.encode(String(str || '')).length;
}

/* JSON validity for the editor footer; also reused by the message cards. */
export function checkJson(raw) {
  if (!String(raw || '').trim()) return { state: 'empty', message: '等待输入' };
  try {
    JSON.parse(raw);
    return { state: 'ok', message: '合法 JSON' };
  } catch (err) {
    return { state: 'bad', message: `JSON 错误：${err.message}` };
  }
}

function unique(arr) {
  return [...new Set(arr)];
}

function clockNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* Config identity for the auto-save dedupe (legacy sameConfig). */
export function sameConfig(a, b) {
  if (!a || !b) return false;
  return a.sendTopic === b.sendTopic
    && a.groupId === b.groupId
    && !!a.fromBeginning === !!b.fromBeginning
    && JSON.stringify(a.recvTopics || []) === JSON.stringify(b.recvTopics || []);
}

export const useActiveStore = defineStore('active', () => {
  const servers = useServersStore();

  const serverId = ref('');
  const selectedTopics = ref([]); // UI selection; becomes config.recvTopics on save
  const catalog = ref([]); // broker topics + selected + subscribed, deduped
  const topicSearch = ref('');
  const customInput = ref('');
  const busyTopics = reactive(new Set()); // per-topic subscribe/unsubscribe in flight
  const runLogs = ref([]); // {ts, level, text} capped at RUN_LOG_MAX
  const connBusy = ref(false);
  const savedConfig = ref(null); // last config acked by the server (auto-save dedupe)
  const config = ref({ sendTopic: '', groupId: '', fromBeginning: false });
  const saveState = ref('idle'); // idle | busy | ok | err
  const saveStateText = ref('');

  /* ---- send area (T4) ---- */
  const draft = ref({ payload: '', key: '' });
  const draftState = ref('idle'); // idle | saving | saved | error
  const draftStateText = ref('');
  const sendBusy = ref(false);
  const lastReceipt = ref(null); // {topic, partition, offset, bytes, ts}

  const cfgSections = ref({ ...CFG_SEC_DEFAULTS });

  const server = computed(() => servers.byId(serverId.value));
  /* Subscriptions keep a consumer alive even without a producer (legacy isServerUp). */
  const isServerUp = computed(() => !!(server.value
    && (server.value.connected || (server.value.subscribedTopics || []).length)));

  function loadCfgSections() {
    const saved = readJson(storageKeys.cfgSections, {});
    const out = { ...CFG_SEC_DEFAULTS };
    for (const k of Object.keys(out)) if (typeof saved[k] === 'boolean') out[k] = saved[k];
    cfgSections.value = out;
  }

  function toggleSection(key) {
    if (!(key in CFG_SEC_DEFAULTS)) return;
    cfgSections.value = { ...cfgSections.value, [key]: !cfgSections.value[key] };
    writeJson(storageKeys.cfgSections, cfgSections.value);
  }

  function pushRunLog({ ts = Date.now(), level = 'info', text = '' }) {
    if (!text) return;
    runLogs.value.push({ ts, level, text });
    if (runLogs.value.length > RUN_LOG_MAX) {
      runLogs.value.splice(0, runLogs.value.length - RUN_LOG_MAX);
    }
  }

  function clearRunLog() {
    runLogs.value = [];
  }

  /* Enter a workspace: fresh working copy from the server status payload.
   * Returns the (awaitable) silent catalog fetch for tests / eager callers. */
  async function loadServer(id) {
    persistDraft.flush(); // land the pending draft on the server we're leaving
    persistSave.cancel();
    serverId.value = id || '';
    const s = id ? servers.byId(id) : null;
    config.value = {
      sendTopic: (s?.config?.sendTopic) || '',
      groupId: (s?.config?.groupId) || '',
      fromBeginning: !!(s?.config?.fromBeginning),
    };
    selectedTopics.value = [...((s?.config?.recvTopics) || [])];
    savedConfig.value = {
      ...config.value,
      recvTopics: [...selectedTopics.value],
    };
    catalog.value = [];
    topicSearch.value = '';
    customInput.value = '';
    runLogs.value = [];
    busyTopics.clear();
    connBusy.value = false;
    saveState.value = 'idle';
    saveStateText.value = '';
    sendBusy.value = false;
    lastReceipt.value = null;
    restoreDraft(id);
    if (id) await loadCatalog(id, false);
  }

  /* ---- draft persistence (300ms debounce, {payload, key, ts}) ---- */
  function restoreDraft(id) {
    const saved = id ? readJson(storageKeys.draft(id), null) : null;
    if (saved && typeof saved.payload === 'string') {
      draft.value = { payload: saved.payload, key: typeof saved.key === 'string' ? saved.key : '' };
    } else {
      draft.value = { payload: JSON.stringify(SAMPLE, null, 2), key: '' };
    }
    draftState.value = 'idle';
    draftStateText.value = '';
  }

  function saveDraftNow() {
    const id = serverId.value;
    if (!id) return;
    try {
      writeJson(storageKeys.draft(id), {
        payload: draft.value.payload,
        key: draft.value.key,
        ts: Date.now(),
      });
      draftState.value = 'saved';
      draftStateText.value = '草稿已自动缓存';
    } catch {
      draftState.value = 'error';
      draftStateText.value = '草稿缓存不可用';
    }
  }

  const persistDraft = debounce(saveDraftNow, DRAFT_DEBOUNCE_MS);

  function scheduleDraftSave() {
    draftState.value = 'saving';
    draftStateText.value = '缓存中…';
    persistDraft();
  }

  function setPayload(v) { draft.value.payload = v; scheduleDraftSave(); }
  function setKey(v) { draft.value.key = v; scheduleDraftSave(); }

  const jsonState = computed(() => checkJson(draft.value.payload));
  const payloadBytes = computed(() => byteLen(draft.value.payload));
  const canSend = computed(() => jsonState.value.state === 'ok' && !!serverId.value);

  function loadSample() {
    setPayload(JSON.stringify(SAMPLE, null, 2));
  }

  function formatPayload() {
    const raw = draft.value.payload;
    if (!raw.trim()) return;
    try {
      setPayload(JSON.stringify(JSON.parse(raw), null, 2));
    } catch (err) {
      toast(`JSON 错误：${err.message}`, 'error');
    }
  }

  function clearPayload() {
    setPayload('');
    draftStateText.value = '';
    draftState.value = 'idle';
  }

  async function send() {
    if (sendBusy.value || !canSend.value) return null;
    sendBusy.value = true;
    try {
      await saveConfig(); // send always runs against the saved config
      const res = await api.send(serverId.value, {
        key: (draft.value.key || '').trim(),
        payload: draft.value.payload,
      });
      const md = res?.metadata || {};
      lastReceipt.value = {
        topic: res?.topic || md.topicName || '',
        partition: md.partition,
        offset: md.baseOffset,
        bytes: res?.bytes,
        ts: Date.now(),
      };
      toast('消息已发送', 'success');
      return res;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    } finally {
      sendBusy.value = false;
    }
  }

  function readConfigBody() {
    return {
      sendTopic: (config.value.sendTopic || '').trim(),
      recvTopics: [...selectedTopics.value],
      groupId: (config.value.groupId || '').trim(),
      fromBeginning: !!config.value.fromBeginning,
    };
  }

  async function saveConfig() {
    const id = serverId.value;
    if (!id) return null;
    const body = readConfigBody();
    if (sameConfig(savedConfig.value, body)) return null; // dedupe round-trips
    saveState.value = 'busy';
    saveStateText.value = '保存中…';
    try {
      const d = await api.saveConfig(id, body);
      savedConfig.value = { ...body };
      if (d && d.server) servers.applyServerUpdate(d.server);
      saveState.value = 'ok';
      saveStateText.value = `已自动保存 ${clockNow()}`;
      setTimeout(() => {
        if (saveState.value === 'ok') { saveState.value = 'idle'; saveStateText.value = ''; }
      }, SAVE_HINT_MS);
      return d;
    } catch (err) {
      saveState.value = 'err';
      saveStateText.value = '保存失败，改动未提交';
      throw err;
    }
  }

  const persistSave = debounce(() => {
    saveConfig().catch((err) => toast(err.message, 'error'));
  }, 500);

  function scheduleConfigSave() {
    persistSave();
  }

  /* catalog = broker topics ∪ selected ∪ subscribed (legacy merge rule) */
  async function loadCatalog(id, notify = false) {
    if (!id) return;
    try {
      const d = await api.topics(id);
      if (serverId.value !== id) return; // switched away mid-flight
      catalog.value = unique([
        ...(d.topics || []),
        ...selectedTopics.value,
        ...((servers.byId(id)?.subscribedTopics) || []),
      ]);
      if (notify) toast(`读取到 ${(d.topics || []).length} 个主题`, 'success');
    } catch (err) {
      if (serverId.value !== id) return;
      const msg = `读取主题列表失败：${err.message}（可直接在下方添加自定义主题）`;
      if (notify) toast(msg, 'error');
      else pushRunLog({ level: 'warn', text: msg });
    }
  }

  async function unsubscribeTopics(topics) {
    if (!serverId.value || !topics.length) return;
    try {
      const d = await api.unsubscribe(serverId.value, topics);
      if (d && d.server) servers.applyServerUpdate(d.server);
      toast(`已取消订阅 ${topics.length} 个主题`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggleTopicSubscription(topic) {
    if (!serverId.value || busyTopics.has(topic)) return;
    const subs = server.value?.subscribedTopics || [];
    const on = subs.includes(topic);
    busyTopics.add(topic);
    try {
      const d = on
        ? await api.unsubscribe(serverId.value, [topic])
        : await api.subscribe(serverId.value, [topic]);
      if (d && d.server) servers.applyServerUpdate(d.server);
      toast(on ? `已取消订阅 ${topic}` : `已订阅 ${topic}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busyTopics.delete(topic);
    }
  }

  async function toggleAllTopics() {
    const subs = server.value?.subscribedTopics || [];
    const allOn = selectedTopics.value.length > 0 && selectedTopics.value.every((t) => subs.includes(t));
    const topics = allOn
      ? [...selectedTopics.value]
      : selectedTopics.value.filter((t) => !subs.includes(t));
    if (!serverId.value || !topics.length) return;
    topics.forEach((t) => busyTopics.add(t));
    try {
      const d = allOn
        ? await api.unsubscribe(serverId.value, topics)
        : await api.subscribe(serverId.value, topics);
      if (d && d.server) servers.applyServerUpdate(d.server);
      toast(allOn ? '已取消全部订阅' : `已订阅 ${topics.length} 个主题`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      topics.forEach((t) => busyTopics.delete(t));
    }
  }

  function onTopicToggle(topic, checked) {
    if (checked) {
      if (!selectedTopics.value.includes(topic)) selectedTopics.value.push(topic);
    } else {
      selectedTopics.value = selectedTopics.value.filter((t) => t !== topic);
      // Deselecting must also stop a live consumer or messages keep flowing.
      if ((server.value?.subscribedTopics || []).includes(topic)) unsubscribeTopics([topic]);
    }
    scheduleConfigSave();
  }

  function addCustomTopic() {
    const t = customInput.value.trim();
    if (!t) return;
    if (!TOPIC_NAME_RE.test(t)) {
      toast('主题名只允许字母、数字、点、下划线、连字符', 'error');
      return;
    }
    catalog.value = unique([...catalog.value, t]);
    if (!selectedTopics.value.includes(t)) selectedTopics.value.push(t);
    customInput.value = '';
    scheduleConfigSave();
    toast(`已添加主题 ${t}`, 'success');
  }

  async function connect() {
    if (connBusy.value || !serverId.value || isServerUp.value) return;
    connBusy.value = true;
    try {
      await saveConfig(); // 连接前先把配置落库
      const d = await api.connect(serverId.value);
      if (d && d.server) servers.applyServerUpdate(d.server);
      toast('连接成功', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      connBusy.value = false;
    }
  }

  async function disconnect() {
    if (!serverId.value) return;
    try {
      const d = await api.disconnect(serverId.value);
      if (d && d.server) servers.applyServerUpdate(d.server);
      toast('已断开连接', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const filteredTopics = computed(() => {
    const all = unique([
      ...catalog.value,
      ...selectedTopics.value,
      ...(server.value?.subscribedTopics || []),
    ]);
    const q = topicSearch.value.trim().toLowerCase();
    return q ? all.filter((t) => t.toLowerCase().includes(q)) : all;
  });

  /* Auto-save: any working-copy change schedules a debounced save. loadServer
   * refreshes savedConfig first, so the initial fill dedupes to a no-op. */
  watch(
    [() => config.value.sendTopic, () => config.value.groupId, () => config.value.fromBeginning, selectedTopics],
    () => { if (serverId.value) scheduleConfigSave(); },
  );

  loadCfgSections();

  return {
    serverId, server, isServerUp,
    config, savedConfig, selectedTopics, catalog, filteredTopics, topicSearch, customInput,
    busyTopics, runLogs, connBusy, saveState, saveStateText, cfgSections,
    draft, draftState, draftStateText, sendBusy, lastReceipt,
    jsonState, payloadBytes, canSend,
    loadServer, toggleSection, pushRunLog, clearRunLog,
    saveConfig, scheduleConfigSave, loadCatalog,
    onTopicToggle, addCustomTopic,
    toggleTopicSubscription, toggleAllTopics, unsubscribeTopics,
    connect, disconnect,
    setPayload, setKey, loadSample, formatPayload, clearPayload, send, saveDraftNow,
  };
});
