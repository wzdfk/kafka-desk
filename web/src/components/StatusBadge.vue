<script setup>
import { computed } from 'vue';
import { NTag } from 'naive-ui';

/* Pill badge with a status dot: off / ok / busy / error. */
const props = defineProps({
  kind: { type: String, default: 'off' }, // off | ok | busy | error | info
  text: { type: String, default: '' },
});

const TAG_TYPE = { off: 'default', ok: 'success', busy: 'info', error: 'error', info: 'info' };
const tagType = computed(() => TAG_TYPE[props.kind] || 'default');
</script>

<template>
  <n-tag round size="small" :type="tagType" :bordered="false" class="status-badge">
    <span class="dot" />
    <span>{{ text }}</span>
  </n-tag>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.9;
}
.status-badge[data-kind='off'] .dot { opacity: 0.45; }
</style>
