<script setup>
import { DocumentTextOutline, SparklesOutline, TrashOutline } from '@vicons/ionicons5';
import { NButton, NInput } from 'naive-ui';
import { useActiveStore } from '../stores/active.js';
import IconBtn from './IconBtn.vue';

/* Send editor: JSON validation footer, byte count, draft autosave (300ms),
 * sample / format / clear, receipt of the last delivery. */
const store = useActiveStore();

const jsonClass = () => ({
  empty: 'is-empty',
  ok: 'is-ok',
  bad: 'is-bad',
}[store.jsonState.state]);

const pad = (n) => String(n).padStart(2, '0');
function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
</script>

<template>
  <section class="send-panel">
    <div class="send-head">
      <span class="send-title">发送区</span>
      <div class="send-tools">
        <IconBtn :icon="DocumentTextOutline" title="填充示例" @click="store.loadSample()" />
        <IconBtn :icon="SparklesOutline" title="格式化 JSON" @click="store.formatPayload()" />
        <IconBtn :icon="TrashOutline" title="清空" @click="store.clearPayload()" />
      </div>
    </div>

    <n-input
      class="key-input"
      :value="store.draft.key"
      size="small"
      placeholder="消息 Key（可选，相同 Key 落同一分区）"
      @update:value="store.setKey"
    />

    <n-input
      class="payload-input"
      type="textarea"
      :value="store.draft.payload"
      placeholder='{"hello": "kafka"}'
      :autosize="false"
      @update:value="store.setPayload"
    />

    <div class="send-foot">
      <span class="json-state" :class="jsonClass()">{{ store.jsonState.message }}</span>
      <span class="byte-count">{{ store.payloadBytes }} B</span>
      <span class="draft-state" :class="`is-${store.draftState}`">{{ store.draftStateText || '　' }}</span>
      <n-button
        type="primary"
        size="small"
        round
        :disabled="!store.jsonState.state || store.jsonState.state !== 'ok'"
        :loading="store.sendBusy"
        title="发送到发送主题（Ctrl+Enter）"
        @click="store.send()"
      >
        发送
      </n-button>
    </div>

    <div v-if="store.lastReceipt" class="receipt">
      回执 {{ clock(store.lastReceipt.ts) }} → {{ store.lastReceipt.topic }}
      · p{{ store.lastReceipt.partition }} @{{ store.lastReceipt.offset }}
      · {{ store.lastReceipt.bytes }} B
    </div>
  </section>
</template>

<style scoped>
.send-panel {
  background: rgba(128, 128, 128, 0.05);
  border: 1px solid rgba(128, 128, 128, 0.14);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.send-head { display: flex; align-items: center; justify-content: space-between; }
.send-title { font-size: 13.5px; font-weight: 600; }
.send-tools { display: flex; gap: 2px; }
.key-input { font-variant-numeric: tabular-nums; }
/* textarea 填满发送区剩余高度，随 40% 基准伸缩 */
.payload-input {
  flex: 1;
  min-height: 0;
}
.payload-input :deep(.n-input__textarea-el),
.payload-input :deep(textarea) {
  height: 100%;
  resize: none;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.55;
}
.send-foot { flex: 0 0 auto; }
.send-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.json-state.is-empty { opacity: 0.45; }
.json-state.is-ok { color: #34c759; }
.json-state.is-bad { color: #ff3b30; }
.byte-count { opacity: 0.55; font-variant-numeric: tabular-nums; }
.draft-state { flex: 1; text-align: right; opacity: 0.5; }
.draft-state.is-error { color: #ff9500; opacity: 1; }
.receipt { font-size: 12px; opacity: 0.6; font-variant-numeric: tabular-nums; }
</style>
