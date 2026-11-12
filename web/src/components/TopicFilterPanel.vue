<script setup>
import { computed } from 'vue';
import { ChevronDownOutline } from '@vicons/ionicons5';
import { NButton, NCheckbox, NIcon, NPopover } from 'naive-ui';
import { useActiveStore } from '../stores/active.js';
import { useMessagesStore } from '../stores/messages.js';

/* Legacy "按主题筛选 · 可多选" popover: checkbox grid over the full catalog
 * (∪ seen ∪ selected), with 全选 / 清除 actions and the hint footer. */
const active = useActiveStore();
const store = useMessagesStore();

const allTopics = computed(() => [...new Set([
  ...active.filteredTopics,
  ...store.seenTopics,
  ...store.topicFilters,
])]);

const selectedCount = computed(() => store.topicFilters.length);

function toggle(topic, checked) {
  const next = checked
    ? [...store.topicFilters, topic]
    : store.topicFilters.filter((t) => t !== topic);
  store.setTopicFilters(next);
}

function selectAll() {
  store.setTopicFilters([...allTopics.value]);
}

function clearAll() {
  store.setTopicFilters([]);
}
</script>

<template>
  <n-popover trigger="click" placement="bottom-end" :width="640" scrollable>
    <template #trigger>
      <n-button size="small" secondary>
        {{ selectedCount ? `已选 ${selectedCount} 主题` : '全部主题' }}
        <template #icon>
          <n-icon :component="ChevronDownOutline" :size="13" />
        </template>
      </n-button>
    </template>

    <div class="tfp">
      <div class="tfp-head">
        <span class="tfp-title">按主题筛选 · 可多选</span>
        <span class="tfp-meta">{{ allTopics.length }}个主题 · 已选 {{ selectedCount }}</span>
        <span class="tfp-actions">
          <n-button text size="tiny" @click="selectAll">全选</n-button>
          <n-button text size="tiny" @click="clearAll">清除</n-button>
        </span>
      </div>
      <div class="tfp-grid">
        <n-checkbox
          v-for="t in allTopics"
          :key="t"
          class="tfp-item"
          :checked="store.topicFilters.includes(t)"
          :title="t"
          @update:checked="(c) => toggle(t, c)"
        >
          <span class="tfp-name" :class="{ dim: !active.filteredTopics.includes(t) }">{{ t }}</span>
        </n-checkbox>
      </div>
      <div class="tfp-foot">
        不勾选=显示全部主题；勾选部分则只显示勾选的主题（含之后新出现的同类主题）。
      </div>
    </div>
  </n-popover>
</template>

<style scoped>
.tfp { display: flex; flex-direction: column; gap: 8px; }
.tfp-head { display: flex; align-items: center; gap: 8px; }
.tfp-title { font-size: 13px; font-weight: 600; }
.tfp-meta { font-size: 12px; opacity: 0.55; flex: 1; }
.tfp-actions { display: flex; gap: 4px; }
.tfp-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  max-height: 260px;
  overflow-y: auto;
  padding: 2px;
}
.tfp-item { max-width: 280px; }
.tfp-name {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  max-width: 240px;
  vertical-align: middle;
}
.tfp-name.dim { opacity: 0.45; }
.tfp-foot { font-size: 11.5px; opacity: 0.5; line-height: 1.5; }
</style>
