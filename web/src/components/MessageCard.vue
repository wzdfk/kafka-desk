<script setup>
import { computed, ref } from 'vue';
import { ChevronDownOutline } from '@vicons/ionicons5';
import { NIcon } from 'naive-ui';
import { byteLen } from '../stores/active.js';

/* One Kafka message: collapsed = badge row only, expand shows body + detail. */
const props = defineProps({
  m: { type: Object, required: true },
});
const emit = defineEmits(['expand']);

const expanded = ref(false);

const isJson = computed(() => {
  try { JSON.parse(props.m.value ?? ''); return true; } catch { return false; }
});

const pad = (n) => String(n).padStart(2, '0');
const time = computed(() => {
  const d = new Date(props.m.ts || Date.now());
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) emit('expand');
}
</script>

<template>
  <article
    class="msg"
    :class="{ expanded }"
    :data-topic="m.topic"
    :title="expanded ? '收起详情' : '展开完整内容与元数据'"
    @click="toggle"
  >
    <div class="msg-head">
      <span class="msg-time">{{ time }}</span>
      <span class="msg-topic" :title="m.topic">{{ m.topic || '(无主题)' }}</span>
      <span class="msg-pos">p{{ m.partition }} / @{{ m.offset }}</span>
      <span v-if="m.key" class="badge">key: {{ m.key }}</span>
      <span class="badge" :class="isJson ? 'badge-json' : 'badge-text'">{{ isJson ? 'JSON' : 'TEXT' }}</span>
      <span v-if="m.demo" class="badge badge-demo">DEMO</span>
      <span v-if="m.cached" class="badge badge-cached">上次</span>
      <span class="badge">{{ byteLen(m.value) }} B</span>
      <n-icon class="msg-chev" :component="ChevronDownOutline" :size="14" />
    </div>
    <pre v-if="expanded" class="msg-body">{{ m.value ?? '' }}</pre>
    <pre v-if="expanded" class="msg-detail">{{
      [
        `topic     : ${m.topic || ''}`,
        `partition : ${m.partition}`,
        `offset    : ${m.offset}`,
        `key       : ${m.key || '(无)'}`,
        `timestamp : ${m.timestamp || '(无)'}`,
        `headers   : ${Object.keys(m.headers || {}).length ? JSON.stringify(m.headers, null, 2) : '(无)'}`,
        `value     : ${m.value ?? ''}`,
      ].join('\n')
    }}</pre>
  </article>
</template>

<style scoped>
.msg {
  background: var(--kd-surface);
  border: 1px solid var(--kd-card-border);
  border-radius: var(--kd-radius-inner);
  padding: 8px 12px;
  cursor: pointer;
  user-select: text;
  transition: background 0.16s var(--kd-ease), border-color 0.16s var(--kd-ease);
}
.msg:hover { border-color: rgba(0, 113, 227, 0.35); }
.msg.expanded { background: var(--kd-card-bg); border-color: rgba(0, 113, 227, 0.35); }
.msg-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12.5px;
}
.msg-time { opacity: 0.5; font-variant-numeric: tabular-nums; }
.msg-topic { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.msg-pos { opacity: 0.5; font-variant-numeric: tabular-nums; }
.badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.14);
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
.badge-json { color: var(--kd-accent); }
.badge-text { color: #8e8e93; }
.badge-demo { color: #af52de; }
.badge-cached { color: var(--kd-orange); }
.msg-chev {
  margin-left: auto;
  opacity: 0.4;
  transition: transform 0.2s var(--kd-ease), opacity 0.2s var(--kd-ease);
}
.msg:hover .msg-chev { opacity: 0.75; }
.msg.expanded .msg-chev { transform: rotate(180deg); opacity: 0.75; }
.msg-body, .msg-detail {
  margin: 8px 0 0;
  font-family: var(--kd-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 240px;
  overflow-y: auto;
  animation: msg-in 0.18s var(--kd-ease);
}
.msg-detail {
  border-top: 1px dashed var(--kd-card-border);
  padding-top: 8px;
  opacity: 0.75;
  max-height: 320px;
}
@keyframes msg-in {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
}
</style>
