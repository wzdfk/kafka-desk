import { ref } from 'vue';
import { defineStore } from 'pinia';
import { debounce, readJson, storageKeys, writeJson } from '../utils/storage.js';

const MEMORY_LIMIT = 400; // in-memory ring
const PERSIST_LIMIT = 200; // localStorage keeps the most recent slice
const FLUSH_MS = 900;
const DEDUP_MS = 1500;

export const useSyslogStore = defineStore('syslog', () => {
  const entries = ref([]); // {ts, level, src, text}

  const persist = debounce(() => {
    writeJson(storageKeys.syslog, entries.value.slice(-PERSIST_LIMIT));
  }, FLUSH_MS);

  function init() {
    const saved = readJson(storageKeys.syslog, []);
    entries.value = Array.isArray(saved) ? saved : [];
  }

  function add({ level = 'info', text = '', src = '应用', ts = Date.now() }) {
    if (!text) return;
    const list = entries.value;
    const last = list[list.length - 1];
    if (last && last.text === text && ts - last.ts < DEDUP_MS) return;
    list.push({ ts, level, src, text });
    if (list.length > MEMORY_LIMIT) list.splice(0, list.length - MEMORY_LIMIT);
    persist();
  }

  function clear() {
    entries.value = [];
    persist.flush();
    writeJson(storageKeys.syslog, []);
  }

  /* Returns false when there is nothing to export (or no DOM to download in). */
  function exportLog() {
    if (!entries.value.length) return false;
    if (typeof document === 'undefined') return false; // Node tests / SSR
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const lines = entries.value.map((e) => `[${new Date(e.ts).toISOString()}][${e.level}][${e.src}] ${e.text}`);
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kafkadesk-${stamp}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    return true;
  }

  return { entries, init, add, clear, exportLog };
});
