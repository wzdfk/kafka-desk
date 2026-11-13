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
      <!-- 头部内嵌操作（如清空日志）：阻断冒泡，不触发展开/收起 -->
      <span v-if="$slots.actions" class="acc-actions" @click.stop>
        <slot name="actions" />
      </span>
      <n-icon class="acc-chev" :component="ChevronDownOutline" :size="15" />
    </button>
    <div v-show="open" class="acc-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.acc {
  padding: 3px 0; /* 模块间距：hover 高亮不与相邻模块贴边 */
  border-bottom: 1px solid var(--kd-divider);
}
.acc:last-child { border-bottom: none; }
.acc-head {
  /* calc + 负 margin 才能左右对称外扩：只写 width:100% + 负 margin 时
   * LTR 会忽略 margin-right，导致右侧反而缩进（之前的不对称就是它） */
  width: calc(100% + 12px);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 -6px;
  padding: 11px 10px;
  background: none;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  color: inherit;
  text-align: left;
  transition: background 0.16s var(--kd-ease);
}
.acc-head:hover { background: var(--kd-hover); }
.acc-title { font-size: 13.5px; font-weight: 600; }
.acc-meta { font-size: 12px; opacity: 0.5; flex: 1; text-align: right; }
.acc-actions { display: inline-flex; align-items: center; }
.acc-chev { opacity: 0.45; transition: transform 0.22s var(--kd-ease); }
.acc.open .acc-chev { transform: rotate(180deg); }
.acc-body {
  padding: 2px 4px 14px;
  animation: acc-in 0.2s var(--kd-ease);
}
@keyframes acc-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
</style>
