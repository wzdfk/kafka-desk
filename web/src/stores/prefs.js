import { ref } from 'vue';
import { defineStore } from 'pinia';
import { readJson, storageKeys, writeJson } from '../utils/storage.js';

export const PREF_MAX_MESSAGES = [200, 500, 1000, 2000];
export const PREF_CACHE_LIMIT = [20, 50, 100, 200, 500];

export const usePrefsStore = defineStore('prefs', () => {
  const maxMessages = ref(500);
  const cacheLimit = ref(50);

  function init() {
    const saved = readJson(storageKeys.prefs, {});
    if (PREF_MAX_MESSAGES.includes(saved.maxMessages)) maxMessages.value = saved.maxMessages;
    if (PREF_CACHE_LIMIT.includes(saved.cacheLimit)) cacheLimit.value = saved.cacheLimit;
  }

  function persist() {
    writeJson(storageKeys.prefs, { maxMessages: maxMessages.value, cacheLimit: cacheLimit.value });
  }

  function setMaxMessages(v) {
    if (!PREF_MAX_MESSAGES.includes(v) || v === maxMessages.value) return;
    maxMessages.value = v;
    persist();
  }

  function setCacheLimit(v) {
    if (!PREF_CACHE_LIMIT.includes(v) || v === cacheLimit.value) return;
    cacheLimit.value = v;
    persist();
  }

  return { maxMessages, cacheLimit, init, setMaxMessages, setCacheLimit };
});
