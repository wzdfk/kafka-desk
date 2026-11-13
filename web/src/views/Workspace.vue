<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NIcon, useThemeVars } from 'naive-ui';
import { LinkOutline, UnlinkOutline } from '@vicons/ionicons5';
import { useServersStore } from '../stores/servers.js';
import { useActiveStore } from '../stores/active.js';
import { readJson, storageKeys, writeJson } from '../utils/storage.js';
import ConfigPanel from '../components/ConfigPanel.vue';
import SendPanel from '../components/SendPanel.vue';
import ReceiveArea from '../components/ReceiveArea.vue';
import Splitter from '../components/Splitter.vue';

/* Workspace shell: config column | splitter | (send panel / splitter / receive).
 * Route is the source of truth for the active server. */
const route = useRoute();
const router = useRouter();
const servers = useServersStore();
const active = useActiveStore();

const id = computed(() => String(route.params.id || ''));
const server = computed(() => servers.byId(id.value));

/* 断开按钮：warning 橙底实心，文字色随主题（暗色→白 / 亮色→黑） */
// const themeVars = useThemeVars();
// const disconnectStyle = computed(() => ({
//   '--n-color': themeVars.value.warningColor,
//   '--n-color-hover': themeVars.value.warningColor,
//   '--n-color-pressed': themeVars.value.warningColor,
//   '--n-color-focus': themeVars.value.warningColor,
//   '--n-text-color': themeVars.value.textColorBase,
//   '--n-text-color-hover': themeVars.value.textColorBase,
//   '--n-text-color-pressed': themeVars.value.textColorBase,
//   '--n-text-color-focus': themeVars.value.textColorBase,
//   '--n-border-color': 'transparent',
//   '--n-border-color-hover': 'transparent',
//   '--n-border-color-pressed': 'transparent',
//   '--n-border-color-focus': 'transparent',
// }));

/* ---- splitter state: left column width (px) + send area share (%) ---- */
const saved = readJson(storageKeys.splitter, {}) || {};
const cfgW = ref(clampNum(saved.cfgW, 280, 560, 360));
const sendPct = ref(clampNum(saved.sendPct, 18, 75, 40));
const gridEl = ref(null);
const mainEl = ref(null);
const narrow = ref(typeof window !== 'undefined' ? window.innerWidth <= 960 : false);

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function persistSplit() {
  writeJson(storageKeys.splitter, { cfgW: cfgW.value, sendPct: sendPct.value });
}

const gridStyle = computed(() => (narrow.value
  ? {}
  : { gridTemplateColumns: `${cfgW.value}px 7px minmax(0, 1fr)` }));
const sendStyle = computed(() => ({ flex: `0 0 ${sendPct.value}%` }));

function onCfgDrag(ev) {
  const rect = gridEl.value?.getBoundingClientRect();
  if (!rect) return;
  cfgW.value = clampNum(ev.clientX - rect.left, 280, 560, cfgW.value);
  persistSplit();
}

function onSendDrag(ev) {
  const rect = mainEl.value?.getBoundingClientRect();
  if (!rect || !rect.height) return;
  sendPct.value = clampNum(((ev.clientY - rect.top) / rect.height) * 100, 18, 75, sendPct.value);
  persistSplit();
}

/* Collapse to a single column on narrow screens (splitter is hidden then). */
const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)') : null;
function onMq(e) { narrow.value = e.matches; }
onMounted(() => mq && mq.addEventListener('change', onMq));
onBeforeUnmount(() => mq && mq.removeEventListener('change', onMq));

watch([id, () => servers.loaded], ([val, loaded]) => {
  if (!val || !loaded) return; // wait until the server list has arrived
  if (!servers.byId(val)) { router.replace('/'); return; }
  active.loadServer(val);
}, { immediate: true });

/* Global Ctrl/Cmd+Enter send (legacy payload keydown, promoted to window). */
function onGlobalKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    active.send();
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));
</script>

<template>
  <section class="workspace">
    <header class="ws-head">
      <div class="ws-title">
        <h1 class="ws-name">{{ server?.name || '服务器' }}</h1>
        <span class="ws-brokers" :title="(server?.brokers || []).join('\n')">
          {{ (server?.brokers || []).join(', ') }}
        </span>
      </div>
      <div class="ws-actions">
        <n-button
          v-if="active.isServerUp"
          type="warning"
          round
          title="断开当前 Broker 连接"
          @click="active.disconnect()"
        >
          <template #icon>
            <n-icon :component="UnlinkOutline" />
          </template>
          断开
        </n-button>
        <n-button
          v-else
          type="primary"
          round
          :loading="active.connBusy"
          :disabled="!server"
          title="保存当前配置并连接 Broker"
          @click="active.connect()"
        >
          <template #icon>
            <n-icon :component="LinkOutline" />
          </template>
          {{ active.connBusy ? '连接中…' : '连接' }}
        </n-button>
      </div>
    </header>

    <div ref="gridEl" class="ws-grid" :style="gridStyle">
      <ConfigPanel />
      <Splitter v-if="!narrow" @drag="onCfgDrag" />
      <div ref="mainEl" class="ws-main">
        <SendPanel :style="sendStyle" />
        <Splitter horizontal @drag="onSendDrag" />
        <ReceiveArea />
      </div>
    </div>
  </section>
</template>

<style scoped>
.workspace {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ws-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: -6px;
  margin-bottom: 6px;
}
/* 标题行不换行：名称与地址同一行，超长各自省略号截断 */
.ws-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
}
.ws-name {
  font-size: 19px;
  font-weight: 700;
  margin: 0;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-brokers {
  font-size: 12.5px;
  opacity: 0.55;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-actions { display: flex; align-items: center; gap: 10px; }
.ws-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  column-gap: 0;
}
.ws-grid > :deep(.config-card) { height: 100%; min-height: 0; }
@media (max-width: 960px) {
  .ws-grid { grid-template-columns: 1fr; }
}
.ws-main {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  min-height: 0;
}
/* 发送区/接收区由 Splitter 调节（默认 4:6），各自内部滚动 */
.ws-main > :deep(.send-panel) { min-height: 0; }
.ws-main > :deep(.receive) { flex: 1 1 0; min-height: 0; }
</style>
