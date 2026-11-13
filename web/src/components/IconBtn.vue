<script setup>
import { NButton, NIcon, NTooltip } from 'naive-ui';

/* Text-free icon button with a tooltip — the standard for all tool buttons (R4).
 * `spin` continuously rotates the icon (running-state semantics). */
defineProps({
  icon: { type: [Object, Function], required: true },
  title: { type: String, default: '' },
  size: { type: String, default: 'small' },
  type: { type: String, default: 'default' },
  iconSize: { type: Number, default: 18 },
  spin: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
});
defineEmits(['click']);
</script>

<template>
  <!-- Disabled buttons get no tooltip: nothing actionable to explain. -->
  <n-tooltip v-if="title && !disabled" trigger="hover" placement="bottom">
    <template #trigger>
      <n-button
        quaternary
        circle
        :size="size"
        :type="type"
        :aria-label="title"
        :loading="loading"
        @click="$emit('click')"
      >
        <n-icon :component="icon" :size="iconSize" :class="{ spin }" />
      </n-button>
    </template>
    {{ title }}
  </n-tooltip>
  <n-button
    v-else
    quaternary
    circle
    :size="size"
    :type="type"
    :aria-label="title"
    :disabled="disabled"
    :loading="loading"
    @click="$emit('click')"
  >
    <n-icon :component="icon" :size="iconSize" :class="{ spin }" />
  </n-button>
</template>

<style scoped>
.spin { animation: icon-spin 1.1s linear infinite; }
@keyframes icon-spin { to { transform: rotate(360deg); } }
</style>
