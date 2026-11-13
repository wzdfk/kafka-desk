/* localStorage helpers. Keys keep the legacy `kafka-desk-*` namespace so the
 * Vue frontend reads/writes the same data as the old one. */

export const storageKeys = {
  theme: 'kafka-desk-theme',
  prefs: 'kafka-desk-prefs',
  syslog: 'kafka-desk-syslog',
  updateCheck: 'kafka-desk-update-check',
  openTabs: 'kafka-desk-open-tabs',
  cfgSections: 'kafka-desk-cfg-sections',
  splitter: 'kafka-desk-splitter',
  draft: (id) => `kafka-desk-draft.${id}`,
  messages: (id) => `kafka-desk-messages.${id}`,
  topicFilter: (id) => `kafka-desk-topic-filter.${id}`,
  auto: (id) => `kafka-desk-auto.${id}`,
};

/* Pre-Vue keys (no per-server namespace) migrated on first broker add. */
export const LEGACY_KEYS = ['kafka-desk-config', 'kafka-desk-draft', 'kafka-desk-messages'];

const PERSISTED_KEYS = [storageKeys.theme, storageKeys.prefs, storageKeys.syslog];

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

export function removeKey(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function debounce(fn, ms) {
  let timer = null;
  let pendingArgs = null;
  const wrapped = (...args) => {
    pendingArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const run = pendingArgs;
      pendingArgs = null;
      fn(...run);
    }, ms);
  };
  wrapped.flush = () => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
    const run = pendingArgs;
    pendingArgs = null;
    fn(...run);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  return wrapped;
}

/* Bytes used by all kafka-desk keys; matches the legacy (k+v)*2 formula. */
export function storageUsage() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('kafka-desk')) total += (k.length + (localStorage.getItem(k) || '').length) * 2;
    }
  } catch { /* ignore */ }
  return total;
}

/* Wipe all kafka-desk keys except theme/prefs/syslog. Returns removed count. */
export function clearLocalCache(keep = PERSISTED_KEYS) {
  const doomed = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('kafka-desk') && !keep.includes(k)) doomed.push(k);
    }
  } catch { /* ignore */ }
  doomed.forEach(removeKey);
  return doomed.length;
}

export function removeServerLocal(id) {
  [storageKeys.draft(id), storageKeys.messages(id), storageKeys.topicFilter(id), storageKeys.auto(id)]
    .forEach(removeKey);
}
