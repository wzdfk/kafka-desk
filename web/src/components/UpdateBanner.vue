<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NIcon } from 'naive-ui';
import { CloseOutline, DownloadOutline } from '@vicons/ionicons5';
import { checkForUpdates, isUpdateAvailable } from '../utils/releases.js';

/* 应用启动时检查一次；发现新版本则在顶部居中提示，点击直达设置-关于。
 * 检查失败静默处理，避免打扰用户；关闭只影响当前会话，下次启动会再检查。 */
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const router = useRouter();
const visible = ref(false);
const version = ref('');
let disposed = false;

async function runStartupCheck() {
  try {
    const result = await checkForUpdates({ currentVersion: APP_VERSION, force: true });
    if (disposed || !isUpdateAvailable(result)) return;
    version.value = result.latest.version;
    visible.value = true;
  } catch {
    /* 启动检查失败不应阻塞界面，用户仍可在设置页手动重试。 */
  }
}

function goSettings() {
  visible.value = false;
  router.push({ path: '/settings', query: { pane: 'about' } });
}

function dismiss() {
  visible.value = false;
}

onMounted(runStartupCheck);
onBeforeUnmount(() => { disposed = true; });
</script>

<template>
  <transition name="kd-banner">
    <div
      v-if="visible"
      class="update-banner"
      role="status"
      aria-live="polite"
      tabindex="0"
      @click="goSettings"
      @keydown.enter.prevent="goSettings"
      @keydown.space.prevent="goSettings"
    >
      <n-icon :component="DownloadOutline" :size="16" />
      <span class="update-banner-text">发现新版本 v{{ version }}，点击前往设置更新</span>
      <button
        class="update-banner-close"
        type="button"
        aria-label="关闭更新提示"
        @click.stop="dismiss"
      >
        <n-icon :component="CloseOutline" :size="14" />
      </button>
    </div>
  </transition>
</template>

<style scoped>
.update-banner {
  position: fixed;
  top: 62px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 40px);
  padding: 9px 10px 9px 14px;
  border: 1px solid var(--kd-accent);
  border-radius: var(--kd-radius-pill);
  background: var(--kd-card-bg);
  box-shadow: var(--kd-card-shadow-hover);
  color: var(--kd-accent);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
}
.update-banner-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.update-banner-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}
.update-banner-close:hover { background: var(--kd-hover); opacity: 1; }
.kd-banner-enter-active,
.kd-banner-leave-active { transition: opacity 0.18s var(--kd-ease), transform 0.18s var(--kd-ease); }
.kd-banner-enter-from,
.kd-banner-leave-to { opacity: 0; transform: translate(-50%, -6px); }
</style>
