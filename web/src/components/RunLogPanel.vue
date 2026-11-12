<script setup>
import { nextTick, ref, watch } from 'vue';
import { useActiveStore } from '../stores/active.js';

/* Per-server runtime log (SSE `log` events), capped at 200 entries. */
const store = useActiveStore();
const listEl = ref(null);

const pad = (n) => String(n).padStart(2, '0');
function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

watch(() => store.runLogs.length, async () => {
  if (!store.cfgSections.log) return;
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
});
</script>

<template>
  <div class="runlog">
    <div ref="listEl" class="runlog-list">
      <div v-if="!store.runLogs.length" class="runlog-empty">暂无运行日志</div>
      <div v-for="(e, i) in store.runLogs" :key="`${e.ts}-${i}`" class="runlog-row" :data-level="e.level">
        <span class="runlog-time">{{ clock(e.ts) }}</span>
        <span class="runlog-text">{{ e.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.runlog { display: flex; flex-direction: column; gap: 6px; }
.runlog-list {
  height: 240px;
  min-height: 50%;
  overflow-y: auto;
  background: var(--kd-surface);
  border: 1px solid var(--kd-card-border);
  border-radius: var(--kd-radius-inner);
  padding: 8px 10px;
  margin-top: 6px;
  font-size: 12px;
  font-family: var(--kd-mono);
  font-variant-numeric: tabular-nums;
}
.runlog-empty { opacity: 0.45; text-align: center; padding-top: 90px; }
.runlog-row { display: flex; gap: 8px; padding: 1.5px 0; line-height: 1.5; }
.runlog-time { opacity: 0.45; flex-shrink: 0; }
.runlog-text { word-break: break-all; }
.runlog-row[data-level='error'] .runlog-text { color: var(--kd-red); }
.runlog-row[data-level='warn'] .runlog-text { color: var(--kd-orange); }
</style>
