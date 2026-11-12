<script setup>
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NEmpty } from 'naive-ui';
import { useServersStore } from '../stores/servers.js';
import { useActiveStore } from '../stores/active.js';
import ConfigPanel from '../components/ConfigPanel.vue';

/* Workspace shell: config column + (T4/T5) send/receive main area.
 * Route is the source of truth for the active server. */
const route = useRoute();
const router = useRouter();
const servers = useServersStore();
const active = useActiveStore();

const id = computed(() => String(route.params.id || ''));
const server = computed(() => servers.byId(id.value));

watch([id, () => servers.loaded], ([val, loaded]) => {
  if (!val || !loaded) return; // wait until the server list has arrived
  if (!servers.byId(val)) { router.replace('/'); return; }
  active.loadServer(val);
}, { immediate: true });
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
        <n-button v-if="active.isServerUp" quaternary type="warning" @click="active.disconnect()">
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
          {{ active.connBusy ? '连接中…' : '连接' }}
        </n-button>
      </div>
    </header>

    <div class="ws-grid">
      <ConfigPanel />
      <div class="ws-main">
        <n-empty
          class="ws-empty"
          :description="active.selectedTopics.length
            ? '勾选主题后可在此订阅并查看消息（发送/接收区 T4-T5 实现）'
            : '在左侧配置区勾选主题，然后连接并订阅'"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ws-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.ws-name { font-size: 19px; font-weight: 700; margin: 0; }
.ws-brokers { font-size: 12.5px; opacity: 0.55; }
.ws-actions { display: flex; align-items: center; gap: 10px; }
.ws-grid {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 960px) {
  .ws-grid { grid-template-columns: 1fr; }
}
.ws-main {
  min-height: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ws-empty { opacity: 0.7; }
</style>
