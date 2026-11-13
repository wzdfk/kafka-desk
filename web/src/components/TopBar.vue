<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ContrastOutline, GridOutline, MoonOutline, SettingsOutline, SunnyOutline } from '@vicons/ionicons5';
import { NButton } from 'naive-ui';
import { useServersStore } from '../stores/servers';
import { cycleTheme, themeMode, themeTitle } from '../theme';
import IconBtn from './IconBtn.vue';
import StatusBadge from './StatusBadge.vue';

const route = useRoute();
const router = useRouter();
const store = useServersStore();

const tabs = computed(() => [
  { id: '', label: '服务器列表' },
  ...store.tabs.map((id) => ({ id, label: store.byId(id)?.name || id })),
]);
const activeTab = computed(() => (route.name === 'workspace' ? String(route.params.id) : ''));
const sseBadge = computed(() => (store.sseConnected
  ? { kind: 'info', text: '本地服务已连接' }
  : { kind: 'off', text: '本地服务连接中' }));

/* Connection badge: mirrors legacy isServerUp logic (subscribed counts as up). */
const serverBadge = computed(() => {
  const s = store.byId(store.activeId);
  if (!s) return { kind: 'off', text: '未连接' };
  const subs = s.subscribedTopics?.length || 0;
  if (s.lastError && !s.connected && !subs) return { kind: 'error', text: '连接异常' };
  if (subs) return { kind: 'busy', text: `订阅中 ${subs}` };
  if (s.connected) return { kind: 'ok', text: '已连接' };
  return { kind: 'off', text: '未连接' };
});

const themeIcon = computed(() => (themeMode.value === 'light'
  ? SunnyOutline
  : themeMode.value === 'dark' ? MoonOutline : ContrastOutline));

function go(tab) {
  router.push(tab.id ? `/server/${tab.id}` : '/');
}
</script>

<template>
  <header class="topbar">
    <div class="brand" role="button" tabindex="0" @click="router.push('/')">
      <img class="brand-logo" src="/logo.png" alt="KafkaDesk" width="28" height="28" />
      <div class="brand-text">
        <div class="brand-name">KafkaDesk</div>
      </div>
    </div>

    <nav class="tabs" aria-label="服务器选项卡">
      <button
        v-for="tab in tabs"
        :key="tab.id || 'home'"
        class="tab"
        :class="{ active: tab.id === activeTab }"
        type="button"
        @click="go(tab)"
      >
        <n-icon v-if="!tab.id" :component="GridOutline" :size="15" />
        <span class="tab-label">{{ tab.label }}</span>
      </button>
    </nav>

    <div class="right">
      <StatusBadge v-if="store.demo" kind="warning" text="演示模式" />
      <StatusBadge :kind="sseBadge.kind" :text="sseBadge.text" />
      <StatusBadge :kind="serverBadge.kind" :text="serverBadge.text" />
      <IconBtn :icon="themeIcon" :title="themeTitle" @click="cycleTheme" />
      <IconBtn :icon="SettingsOutline" title="系统设置" @click="router.push('/settings')" />
    </div>
  </header>
</template>

<style scoped>
/* macOS-style frosted bar: translucent fill, 20px blur, hairline separator. */
.topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 52px;
  padding: 0 20px;
  background: var(--kd-topbar-bg);
  border-bottom: 1px solid var(--kd-topbar-border);
  backdrop-filter: saturate(180%) blur(20px);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.brand-logo { border-radius: 7px; }
.brand-name { font-size: 15px; font-weight: 700; letter-spacing: 0.2px; }
.brand-sub { font-size: 11px; opacity: 0.55; }
.tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow-x: auto;
  min-width: 0;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: inherit;
  opacity: 0.72;
  white-space: nowrap;
  transition: background 0.18s var(--kd-ease), opacity 0.18s var(--kd-ease);
}
.tab:hover { opacity: 1; background: var(--kd-hover); }
.tab.active {
  opacity: 1;
  font-weight: 600;
  background: var(--kd-hover);
}
.tab-label { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
</style>
