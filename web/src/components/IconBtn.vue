<script setup>
import { NButton, NIcon, NTooltip } from 'naive-ui';

/* Text-free icon button with a tooltip — the standard for all tool buttons (R4).
 * `spin` continuously rotates the icon (running-state semantics). */
defineProps({
  icon: { type: [Object, Function], required: true },
  title: { type: String, default: '' },
  size: { type: String, default: 'small' },
  type: { type: String, default: 'default' },
  spin: { type: Boolean, default: false },
});
defineEmits(['click']);
</script>

<template>
  <n-tooltip v-if="title" trigger="hover" placement="bottom">
    <template #trigger>
      <n-button quaternary circle :size="size" :type="type" :aria-label="title" @click="$emit('click')">
        <n-icon :component="icon" :size="18" :class="{ spin }" />
      </n-button>
    </template>
    {{ title }}
  </n-tooltip>
  <n-button v-else quaternary circle :size="size" :type="type" :aria-label="title" @click="$emit('click')">
    <n-icon :component="icon" :size="18" :class="{ spin }" />
  </n-button>
</template>

<style scoped>
.spin { animation: icon-spin 1.1s linear infinite; }
@keyframes icon-spin { to { transform: rotate(360deg); } }
</style>
