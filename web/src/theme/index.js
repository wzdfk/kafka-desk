import { computed, ref } from 'vue';
import { darkTheme } from 'naive-ui';
import { darkOverrides, lightOverrides } from './overrides.js';

/* Three-state theme (light / dark / system), same storage key as the legacy
 * frontend so users keep their choice across the old and new UI. */
const KEY = 'kafka-desk-theme';

export const themeMode = ref('system'); // user selection
export const themeResolved = ref('light'); // effective value

function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function apply() {
  themeResolved.value = themeMode.value === 'system'
    ? (systemPrefersDark() ? 'dark' : 'light')
    : themeMode.value;
  const root = document.documentElement;
  root.setAttribute('data-theme-mode', themeMode.value);
  root.setAttribute('data-theme', themeResolved.value);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeResolved.value === 'dark' ? '#111112' : '#ffffff');
}

export function initTheme() {
  try { themeMode.value = localStorage.getItem(KEY) || 'system'; } catch { /* keep default */ }
  apply();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeMode.value === 'system') apply();
  });
}

export function setThemeMode(mode) {
  themeMode.value = mode;
  try { localStorage.setItem(KEY, mode); } catch { /* private mode */ }
  apply();
}

export function cycleTheme() {
  setThemeMode(themeMode.value === 'light' ? 'dark' : themeMode.value === 'dark' ? 'system' : 'light');
}

export const MODE_LABEL = { light: '明亮', dark: '幽暗', system: '跟随系统' };
export const EFFECTIVE_LABEL = { light: '明亮', dark: '幽暗' };

export const themeTitle = computed(() => {
  const base = `主题：${MODE_LABEL[themeMode.value] || themeMode.value}`;
  return themeMode.value === 'system'
    ? `${base} · 当前${EFFECTIVE_LABEL[themeResolved.value]}`
    : base;
});

export const naiveTheme = computed(() => (themeResolved.value === 'dark' ? darkTheme : null));
export const themeOverrides = computed(() => (themeResolved.value === 'dark' ? darkOverrides : lightOverrides));
