<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NEmpty, NIcon, NSpin, useThemeVars } from 'naive-ui';
import { AddCircleOutline, CreateOutline, EnterOutline, TrashOutline } from '@vicons/ionicons5';
import { useServersStore } from '../stores/servers';
import { confirmDialog } from '../utils/dialog';
import ServerModal from '../components/ServerModal.vue';
import StatusBadge from '../components/StatusBadge.vue';
import IconBtn from '../components/IconBtn.vue';

const router = useRouter();
const store = useServersStore();
const themeVars = useThemeVars();

const modalShow = ref(false);
const editTarget = ref(null);

const servers = computed(() => store.list);
const cardStyle = computed(() => ({
  background: themeVars.value.cardColor,
  borderColor: themeVars.value.dividerColor,
}));

function openCreate() {
  editTarget.value = null;
  modalShow.value = true;
}
function openEdit(s) {
  editTarget.value = s;
  modalShow.value = true;
}
function enter(s) {
  router.push(`/server/${s.id}`);
}

function stateOf(s) {
  const subs = (s.subscribedTopics || []).length;
  if (s.lastError && !s.connected && !subs) return { kind: 'error', text: '连接异常' };
  if (subs) return { kind: 'busy', text: `订阅中 ${subs}` };
  if (s.connected) return { kind: 'ok', text: '已连接' };
  return { kind: 'off', text: '未连接' };
}

function metaOf(s) {
  const cfg = s.config || {};
  return `发送 ${cfg.sendTopic || '未设置'} · 候选主题 ${(cfg.recvTopics || []).length} · 消息 ${s.msgCount || 0}`;
}

function remove(s) {
  confirmDialog({
    title: '删除服务器',
    content: `删除服务器「${s.name}」？\n该服务器的配置、订阅与本地缓存会一并移除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await store.deleteServer(s.id);
        if (store.activeId === s.id) router.push('/');
        toast('服务器已删除', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  });
}

function onCreated(server) {
  if (server?.id) router.push(`/server/${server.id}`);
}
</script>

<template>
  <section class="home">
    <div class="home-head">
      <div>
        <h1 class="home-title">服务器列表</h1>
        <div class="home-sub">{{ servers.length }} 台服务器</div>
      </div>
      <n-button type="primary" round @click="openCreate">
        <template #icon>
          <n-icon :component="AddCircleOutline" />
        </template>
        添加 Broker
      </n-button>
    </div>

    <n-spin :show="!store.loaded">
      <div class="grid">
        <article
          v-for="s in servers"
          :key="s.id"
          class="server-card"
          :style="cardStyle"
          role="button"
          tabindex="0"
          @click="enter(s)"
          @keydown.enter="enter(s)"
        >
          <div class="card-top">
            <div class="server-icon">K</div>
            <StatusBadge :kind="stateOf(s).kind" :text="stateOf(s).text" />
          </div>
          <div class="card-name" :title="s.name">{{ s.name }}</div>
          <div class="card-brokers" :title="(s.brokers || []).join('\n')">{{ (s.brokers || []).join(', ') }}</div>
          <div class="card-meta">{{ metaOf(s) }}</div>
          <div class="card-actions" @click.stop>
            <IconBtn :icon="EnterOutline" title="进入" @click="enter(s)" />
            <IconBtn :icon="CreateOutline" title="编辑" @click="openEdit(s)" />
            <IconBtn :icon="TrashOutline" title="删除" @click="remove(s)" />
          </div>
        </article>

        <div class="add-card" role="button" tabindex="0" @click="openCreate" @keydown.enter="openCreate">
          <n-icon :component="AddCircleOutline" :size="26" />
          <span>添加 Broker</span>
        </div>
      </div>

      <n-empty v-if="store.loaded && servers.length === 0" class="empty" description="还没有服务器，点击「添加 Broker」开始">
      </n-empty>
    </n-spin>

    <ServerModal v-model:show="modalShow" :edit-server="editTarget" @created="onCreated" />
  </section>
</template>

<style scoped>
.home-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 18px;
}
.home-title { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: 0.2px; }
.home-sub { font-size: 13px; opacity: 0.55; margin-top: 2px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.server-card {
  background: var(--card-bg, rgba(255, 255, 255, 0.9));
  border: 1px solid rgba(128, 128, 128, 0.16);
  border-radius: 14px;
  padding: 16px 18px;
  cursor: pointer;
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}
.server-card:hover {
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}
.card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.server-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(145deg, #0071e3, #0a84ff);
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card-name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-brokers { font-size: 12.5px; opacity: 0.72; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.card-meta { font-size: 12px; opacity: 0.5; margin-top: 8px; }
.card-actions { display: flex; justify-content: flex-end; gap: 2px; margin-top: 8px; }
.add-card {
  border: 1.5px dashed rgba(128, 128, 128, 0.35);
  border-radius: 14px;
  min-height: 132px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  opacity: 0.6;
  font-size: 13px;
  transition: opacity 0.15s ease;
}
.add-card:hover { opacity: 1; }
.empty { margin-top: 24px; }
</style>
