<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NCheckbox, NIcon, NInput } from 'naive-ui';
import { ChevronDownCircleOutline, ChevronUpCircleOutline, TrashOutline } from '@vicons/ionicons5';
import { useActiveStore } from '../stores/active.js';
import { useMessagesStore } from '../stores/messages.js';
import { toast } from '../utils/toast.js';
import MessageCard from './MessageCard.vue';
import IconBtn from './IconBtn.vue';
import TopicFilterPanel from './TopicFilterPanel.vue';

/* Receive area: topic subscription bar + text∧topic filters + the batched
 * message list with auto-scroll / pause / clear (legacy receive view). */
const active = useActiveStore();
const store = useMessagesStore();
const listEl = ref(null);

const activeSubs = computed(() => active.server?.subscribedTopics || []);

const allOn = computed(() => active.selectedTopics.length > 0
  && active.selectedTopics.every((t) => (active.server?.subscribedTopics || []).includes(t)));

async function toggleAll() {
  await active.toggleAllTopics();
}

/* Expanding a card suspends auto-scroll so the reader isn't yanked away. */
let scrollToastShown = false;
function onCardExpand() {
  if (store.autoScroll) {
    store.setAutoScroll(false);
    if (!scrollToastShown) {
      toast('已暂停自动滚动，便于查看展开内容');
      scrollToastShown = true;
    }
  }
}

watch(() => store.msgs.length, async () => {
  if (!store.autoScroll) return;
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
});

/* 1s rate readout (legacy setInterval). */
const rate = ref(0);
let rateTimer = null;
onMounted(() => {
  rateTimer = setInterval(() => {
    rate.value = store.rateCount;
    store.rateCount = 0;
  }, 1000);
});

onBeforeUnmount(() => clearInterval(rateTimer));
</script>

<template>
  <section class="receive">
    <div class="topic-bar">
      <span v-if="!active.selectedTopics.length" class="topic-bar-empty">
        在左侧勾选主题后，这里会出现订阅按钮
      </span>
      <button
        v-for="t in active.selectedTopics"
        :key="t"
        type="button"
        class="topic-btn"
        :class="{ active: (active.server?.subscribedTopics || []).includes(t) }"
        :disabled="active.busyTopics.has(t)"
        :title="(active.server?.subscribedTopics || []).includes(t) ? `点击取消订阅 ${t}` : `点击订阅 ${t}`"
        @click="active.toggleTopicSubscription(t)"
      >
        <span class="t-dot" />
        <span class="t-name">{{ t }}</span>
        <span class="t-state">{{ (active.server?.subscribedTopics || []).includes(t) ? '已订阅' : '订阅' }}</span>
      </button>
      <n-button
        size="tiny"
        tertiary
        :disabled="!active.selectedTopics.length || active.busyTopics.size > 0"
        @click="toggleAll"
      >
        <template #icon>
          <n-icon :component="allOn ? ChevronUpCircleOutline : ChevronDownCircleOutline" />
        </template>
        {{ allOn ? '取消全部订阅' : '全部订阅' }}
      </n-button>
    </div>

    <div class="filter-row">
      <n-input
        class="text-filter"
        :value="store.textFilter"
        size="small"
        clearable
        placeholder="过滤：topic / key / 内容"
        @update:value="store.setTextFilter"
      />
      <TopicFilterPanel />
      <label class="chk">
        <n-checkbox :checked="store.autoScroll" @update:checked="store.setAutoScroll" />
        自动滚动
      </label>
      <label class="chk">
        <n-checkbox
          :checked="store.paused"
          @update:checked="store.togglePause"
        >
          暂停显示
        </n-checkbox>
      </label>
      <IconBtn :icon="TrashOutline" title="清空消息" @click="store.clearMessages()" />
    </div>

    <div ref="listEl" class="msg-list">
      <div v-if="!store.msgs.length" class="msg-empty">
        <p class="empty-title">{{ store.emptyText }}</p>
        <p class="empty-hint">
          {{ activeSubs.length
            ? '顶部主题按钮可单独订阅/取消；下拉可按 topic 查看内容'
            : '消息会实时显示在这里，点击标题栏可展开完整详情' }}
        </p>
      </div>
      <MessageCard v-for="(m, i) in store.filteredMsgs" :key="`${m.ts}-${m.topic}-${m.offset}-${i}`" :m="m" @expand="onCardExpand" />
    </div>

    <div class="foot-info">
      <span>{{ store.count }} 条</span>
      <span v-if="store.restoredCount">· 已恢复 {{ store.restoredCount }}</span>
      <span v-if="store.dropped" class="drop-hint">· 已省略 {{ store.dropped }}</span>
      <span class="rate">速率 {{ rate }}/s</span>
      <span v-if="store.paused" class="paused-hint">已暂停显示（仍在接收）</span>
    </div>
  </section>
</template>

<style scoped>
.receive {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}
.topic-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.topic-bar-empty { font-size: 12.5px; opacity: 0.5; }
.topic-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  background: none;
  font-size: 12.5px;
  cursor: pointer;
  color: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.topic-btn:disabled { opacity: 0.55; cursor: wait; }
.topic-btn .t-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(128, 128, 128, 0.4); }
.topic-btn.active { border-color: #34c759; }
.topic-btn.active .t-dot { background: #34c759; }
.topic-btn.active .t-state { color: #34c759; }
.t-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-state { font-size: 11px; opacity: 0.65; }
.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.topic-filter { width: 220px; }
.text-filter { flex: 1; min-width: 160px; }
.chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
}
.msg-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}
.msg-empty { text-align: center; margin: auto; opacity: 0.6; }
.empty-title { font-size: 14px; margin: 0 0 6px; }
.empty-hint { font-size: 12px; margin: 0; opacity: 0.7; }
.foot-info {
  display: flex;
  gap: 8px;
  font-size: 12px;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}
.drop-hint { color: #ff9500; opacity: 1; }
.rate { margin-left: auto; }
.paused-hint { color: #007aff; opacity: 1; }
</style>
