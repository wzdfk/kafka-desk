<script setup>
import { computed, ref } from 'vue';
import { AddOutline, RefreshOutline, SearchOutline } from '@vicons/ionicons5';
import { TrashOutline } from '@vicons/ionicons5';
import { NCheckbox, NIcon, NInput, NSelect, NSwitch } from 'naive-ui';
import { useActiveStore } from '../stores/active.js';
import AccordionSection from './AccordionSection.vue';
import IconBtn from './IconBtn.vue';
import RunLogPanel from './RunLogPanel.vue';

/* Left column of the workspace: topic config / misc / run log, each with a
 * persisted collapse state and auto-saved inputs (500ms debounce + dedupe). */
const store = useActiveStore();

/* Send-topic dropdown: catalog ∪ current input (legacy renderSendTopicSelect). */
const sendOptions = computed(() => {
  const cur = (store.config.sendTopic || '').trim();
  const list = cur && !store.catalog.includes(cur) ? [...store.catalog, cur] : [...store.catalog];
  return [...new Set(list)].sort().map((t) => ({ label: t, value: t }));
});

const gidMeta = computed(() => {
  const gid = (store.config.groupId || '').trim();
  return gid ? `消费组 ${gid}` : '消费组自动';
});

const topicMeta = computed(() => `已选 ${store.selectedTopics.length}`);
const logMeta = computed(() => `${store.runLogs.length} 条`);

const refreshBusy = ref(false);

async function refreshTopics() {
  refreshBusy.value = true;
  try {
    await store.loadCatalog(store.serverId, true);
  } finally {
    refreshBusy.value = false;
  }
}

const saveHintClass = computed(() => ({
  idle: '',
  busy: 'is-busy',
  ok: 'is-ok',
  err: 'is-err',
}[store.saveState]));
</script>

<template>
  <aside class="config-card">
    <AccordionSection
      :open="store.cfgSections.topic"
      title="主题配置"
      :meta="topicMeta"
      @update:open="store.toggleSection('topic')"
    >
      <div class="field">
        <div class="field-label-row">
          <span class="field-label">发送主题</span>
          <IconBtn :icon="RefreshOutline" title="刷新主题列表" :loading="refreshBusy" @click="refreshTopics" />
        </div>
        <n-input
          :value="store.config.sendTopic"
          placeholder="如：user-events（可手输）"
          @update:value="(v) => { store.config.sendTopic = v; }"
        />
        <n-select
          class="send-select"
          :value="sendOptions.some((o) => o.value === store.config.sendTopic) ? store.config.sendTopic : null"
          :options="sendOptions"
          filterable
          clearable
          size="small"
          :placeholder="sendOptions.length ? '从主题列表选择…' : '点击「刷新」读取 Broker 主题'"
          @update:value="(v) => { if (v) store.config.sendTopic = v; }"
        />
      </div>

      <div class="field">
        <div class="field-label-row">
          <span class="field-label">接收主题（可多选）</span>
        </div>
        <n-input v-model:value="store.topicSearch" size="small" placeholder="搜索主题" clearable>
          <template #prefix>
            <n-icon :component="SearchOutline" :size="14" style="opacity: 0.45" />
          </template>
        </n-input>
        <div class="topic-list">
          <div v-if="!store.filteredTopics.length" class="topic-empty">
            {{ store.catalog.length || store.selectedTopics.length
              ? '没有匹配的主题' : '点击「刷新」读取主题，或在下方手动添加' }}
          </div>
          <label
            v-for="t in store.filteredTopics"
            :key="t"
            class="topic-row"
            :class="{ 'is-subscribed': (store.server?.subscribedTopics || []).includes(t) }"
            :title="t"
          >
            <n-checkbox
              :checked="store.selectedTopics.includes(t)"
              @update:checked="(c) => store.onTopicToggle(t, c)"
            />
            <span class="sub-dot" />
            <span class="topic-name">{{ t }}</span>
          </label>
        </div>
      </div>

      <div class="field">
        <div class="field-label-row">
          <span class="field-label">自定义主题</span>
        </div>
        <div class="custom-row">
          <n-input
            v-model:value="store.customInput"
            size="small"
            placeholder="字母/数字/点/下划线/连字符"
            @keydown.enter.prevent="store.addCustomTopic()"
          />
          <IconBtn :icon="AddOutline" title="添加自定义主题" @click="store.addCustomTopic()" />
        </div>
      </div>
    </AccordionSection>

    <AccordionSection
      :open="store.cfgSections.misc"
      title="其他设置"
      :meta="gidMeta"
      @update:open="store.toggleSection('misc')"
    >
      <div class="field">
        <span class="field-label">消费组 GroupId（留空自动生成）</span>
        <n-input
          :value="store.config.groupId"
          placeholder="自动"
          @update:value="(v) => { store.config.groupId = v; }"
        />
      </div>
      <div class="field switch-row">
        <span class="field-label">从头消费（fromBeginning）</span>
        <n-switch
          :value="store.config.fromBeginning"
          size="small"
          @update:value="(v) => { store.config.fromBeginning = v; }"
        />
      </div>
      <div class="save-hint" :class="saveHintClass">{{ store.saveStateText || '改动会自动保存' }}</div>
    </AccordionSection>

    <AccordionSection
      :open="store.cfgSections.log"
      title="运行日志"
      :meta="logMeta"
      @update:open="store.toggleSection('log')"
    >
      <template #actions>
        <IconBtn
          :icon="TrashOutline"
          title="清空运行日志"
          size="tiny"
          :icon-size="15"
          @click="store.clearRunLog()"
        />
      </template>
      <RunLogPanel />
    </AccordionSection>
  </aside>
</template>

<style scoped>
.config-card {
  background: var(--kd-card-bg);
  border: 1px solid var(--kd-card-border);
  border-radius: var(--kd-radius-card);
  box-shadow: var(--kd-card-shadow);
  padding: 4px 14px 6px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.field { margin-bottom: 14px; display: flex; flex-direction: column; gap: 6px; }
.field:last-child { margin-bottom: 4px; }
.field-label { font-size: 12.5px; opacity: 0.65; }
.field-label-row { display: flex; align-items: center; justify-content: space-between; }
.send-select { margin-top: 2px; }
.topic-list {
  max-height: 200px;
  overflow-y: auto;
  background: var(--kd-surface);
  border: 1px solid var(--kd-card-border);
  border-radius: var(--kd-radius-inner);
  padding: 4px;
}
.topic-empty { font-size: 12px; opacity: 0.5; padding: 16px 8px; text-align: center; }
.topic-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.topic-row { transition: background 0.16s var(--kd-ease); }
.topic-row:hover { background: var(--kd-hover); }
.topic-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-dot { width: 6px; height: 6px; border-radius: 50%; background: transparent; flex-shrink: 0; }
.topic-row.is-subscribed .sub-dot { background: var(--kd-green); }
.topic-row.is-subscribed .topic-name { color: var(--kd-green); }
.custom-row { display: flex; gap: 8px; }
.switch-row { flex-direction: row; align-items: center; justify-content: space-between; }
.save-hint { font-size: 12px; opacity: 0.5; min-height: 16px; transition: color 0.2s ease; }
.save-hint.is-busy { opacity: 0.7; }
.save-hint.is-ok { color: var(--kd-green); opacity: 1; }
.save-hint.is-err { color: var(--kd-red); opacity: 1; }
</style>
