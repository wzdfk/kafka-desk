<script setup>
import { ChevronDownOutline } from '@vicons/ionicons5';
import { NIcon } from 'naive-ui';

/* Collapsible section with a meta hint on the right (Apple-style row header). */
defineProps({
  title: { type: String, required: true },
  meta: { type: String, default: '' },
  open: { type: Boolean, default: false },
});
const emit = defineEmits(['update:open']);
</script>

<template>
  <section class="acc" :class="{ open }">
    <button
      type="button"
      class="acc-head"
      :aria-expanded="String(open)"
      @click="emit('update:open', !open)"
    >
      <span class="acc-title">{{ title }}</span>
      <span class="acc-meta">{{ meta }}</span>
      <n-icon class="acc-chev" :component="ChevronDownOutline" :size="15" />
    </button>
    <div v-show="open" class="acc-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.acc {
  border-bottom: 1px solid rgba(128, 128, 128, 0.16);
}
.acc:last-child { border-bottom: none; }
.acc-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  text-align: left;
}
.acc-title { font-size: 13.5px; font-weight: 600; }
.acc-meta { font-size: 12px; opacity: 0.5; flex: 1; text-align: right; }
.acc-chev { opacity: 0.45; transition: transform 0.18s ease; }
.acc.open .acc-chev { transform: rotate(180deg); }
.acc-body { padding: 2px 4px 14px; }
</style>
