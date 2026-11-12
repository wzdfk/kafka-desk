import { ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/api.js';
import { connectSse, updateSseHandlers } from '../api/sse.js';
import { LEGACY_KEYS, readJson, removeServerLocal, storageKeys, writeJson } from '../utils/storage.js';
import { toast } from '../utils/toast.js';
import { useSyslogStore } from './syslog.js';
import { useActiveStore } from './active.js';
import { useMessagesStore } from './messages.js';

const TABS_LIMIT = 20;

export const useServersStore = defineStore('servers', () => {
  const list = ref([]); // status payloads from /api/stream + /api/servers
  const demo = ref(false);
  const loaded = ref(false);
  const sseConnected = ref(false);
  const tabs = ref([]); // open workspace tabs (server ids, oldest first)
  const activeId = ref(''); // workspace route target, '' = home/settings

  const syslog = useSyslogStore();

  function byId(id) {
    return list.value.find((s) => s.id === id) || null;
  }

  function applyStatus(payload) {
    demo.value = !!payload.demo;
    list.value = Array.isArray(payload.servers) ? payload.servers : [];
    loaded.value = true;
    const ids = new Set(list.value.map((s) => s.id));
    const alive = tabs.value.filter((t) => ids.has(t));
    if (alive.length !== tabs.value.length) {
      tabs.value = alive;
      persistTabs();
    }
  }

  function persistTabs() {
    writeJson(storageKeys.openTabs, tabs.value);
  }

  /* Merge a single server view (config/connect/subscribe acks) into the list. */
  function applyServerUpdate(s) {
    if (!s || !s.id) return;
    const idx = list.value.findIndex((x) => x.id === s.id);
    if (idx >= 0) list.value[idx] = s;
    else list.value.push(s);
  }

  function openTab(id) {
    if (!id || tabs.value.includes(id)) return;
    tabs.value.push(id);
    while (tabs.value.length > TABS_LIMIT) tabs.value.shift();
    persistTabs();
  }

  function forgetTab(id) {
    tabs.value = tabs.value.filter((t) => t !== id);
    persistTabs();
  }

  function setActiveId(id) {
    activeId.value = id || '';
    if (id) openTab(id);
  }

  function handleAppError({ serverId, message: msg }) {
    const src = byId(serverId);
    if (serverId && serverId === activeId.value) {
      toast(msg, 'error');
      syslog.add({ level: 'error', text: msg, src: src ? src.name : '服务' });
    } else {
      syslog.add({ level: 'error', text: msg, src: src ? src.name : '服务' });
    }
  }

  async function refresh() {
    try {
      const data = await api.listServers();
      applyStatus({ demo: !!data.demo, servers: data.servers });
    } catch (err) {
      syslog.add({ level: 'error', text: `加载服务器列表失败: ${err.message}`, src: '应用' });
    }
    loaded.value = true;
  }

  function init() {
    const saved = readJson(storageKeys.openTabs, []);
    tabs.value = Array.isArray(saved) ? saved : [];
    refresh();
    connectSse({
      onStatus: applyStatus,
      onLog: ({ serverId, level, text, ts }) => {
        const server = byId(serverId);
        syslog.add({ level, text, ts, src: server ? server.name : '服务' });
        // Active workspace keeps its own run log (200 entries, capped).
        if (serverId && serverId === activeId.value) {
          useActiveStore().pushRunLog({ ts, level, text });
        }
      },
      onMessages: (arr) => { useMessagesStore().ingest(arr); },
      onAppError: handleAppError,
      onOpen: () => { sseConnected.value = true; },
      onError: () => {
        if (sseConnected.value) syslog.add({ level: 'warn', text: '本地服务连接已断开，正在重连…', src: '应用' });
        sseConnected.value = false;
      },
    });
  }

  /* Late-bound hooks for stores created after boot (workspace messages). */
  function bindSseHandlers(partial) {
    updateSseHandlers(partial);
  }

  /* First broker only: migrate the pre-multi-server localStorage data so the
   * previous config / draft / message cache is not lost (legacy parity). */
  function collectLegacy() {
    if (list.value.length !== 0) return null;
    try {
      const c = JSON.parse(localStorage.getItem('kafka-desk-config') || 'null');
      const one = c ? (c.recvTopic || c.topic || '') : '';
      return {
        config: c
          ? {
              sendTopic: c.sendTopic || c.topic || '',
              recvTopics: c.recvTopics || (one ? [one] : []),
              groupId: c.groupId || '',
              fromBeginning: false,
            }
          : {},
        draft: localStorage.getItem('kafka-desk-draft'),
        messages: localStorage.getItem('kafka-desk-messages'),
      };
    } catch {
      return null;
    }
  }

  async function addServer({ name, brokers }) {
    const legacy = collectLegacy();
    const data = await api.addServer({ name, brokers, config: legacy ? legacy.config : {} });
    const created = data.server;
    if (legacy) {
      try {
        if (legacy.draft) localStorage.setItem(storageKeys.draft(created.id), legacy.draft);
        if (legacy.messages) localStorage.setItem(storageKeys.messages(created.id), legacy.messages);
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
      } catch { /* quota / privacy mode */ }
    }
    await refresh();
    return created;
  }

  async function updateServer(id, payload) {
    const data = await api.updateServer(id, payload);
    await refresh();
    return data.server;
  }

  async function deleteServer(id) {
    const data = await api.deleteServer(id);
    forgetTab(id);
    removeServerLocal(id);
    await refresh();
    return data;
  }

  return {
    list, demo, loaded, sseConnected, tabs, activeId,
    byId, applyStatus, applyServerUpdate, refresh, init, bindSseHandlers,
    addServer, updateServer, deleteServer,
    openTab, forgetTab, setActiveId,
  };
});
