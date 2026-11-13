<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NButton, NIcon, NPopover, NProgress, NTag } from 'naive-ui';
import {
  AlertCircleOutline, CheckmarkCircleOutline, ChevronDownOutline,
  DownloadOutline, OpenOutline, RefreshOutline,
} from '@vicons/ionicons5';
import IconBtn from './IconBtn.vue';
import {
  RELEASES_PAGE, assertGithubUrl, checkForUpdates, desktopBridge, formatBytes, isDesktopApp,
} from '../utils/releases.js';

/* 关于页「版本与更新」卡片（Q10）：检查更新 + 版本历史 + 桌面端一键更新。
 * active 由父组件传入（pane === 'about'）：设置页用 v-show，不能用 onMounted 触发。 */
const props = defineProps({ active: { type: Boolean, default: false } });
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

const status = ref('idle');
const releases = ref([]);
const latest = ref(null);
const error = ref(null);
const checkedAt = ref(0);
const fromCache = ref(false);
const progress = ref({ phase: '', received: 0, total: 0, percent: 0 });
const downloadedPath = ref('');
let unsubProgress = null;
let busy = false;

const desktop = isDesktopApp();
const canSelfUpdate = ref(true);
const capabilityReason = ref('');
const canUpdate = computed(() => desktop && canSelfUpdate.value
  && !!latest.value?.asset && status.value === 'available');

const ERROR_TEXT = {
  offline: '当前离线，无法连接 GitHub',
  'rate-limited': 'GitHub 接口限流，请稍后再试',
  timeout: '检查超时，请稍后再试',
  'bad-response': '返回数据格式异常',
  'http-403': 'GitHub 拒绝访问（403）',
  unknown: '检查失败，请稍后再试',
};

const statusText = computed(() => ({
  idle: '尚未检查更新',
  checking: '正在检查更新…',
  'up-to-date': `已是最新版本 v${APP_VERSION}`,
  available: `发现新版本 v${latest.value?.version || ''}`,
  empty: '暂无发布记录',
  error: ERROR_TEXT[error.value] || '暂时无法检查',
  downloading: '正在下载更新…',
  verifying: '正在校验安装包…',
  restarting: '即将重启以完成更新',
  degraded: '已下载，请退出程序后手动替换',
  cancelled: '下载已取消',
}[status.value]));

const checkedText = computed(() => {
  if (!checkedAt.value) return '';
  const d = new Date(checkedAt.value);
  const p = (n) => String(n).padStart(2, '0');
  return `${fromCache.value ? '缓存结果 · ' : ''}上次检查 ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
});

function applyResult(r) {
  releases.value = r.releases || [];
  latest.value = r.latest || null;
  error.value = r.error || null;
  checkedAt.value = r.checkedAt || 0;
  fromCache.value = !!r.fromCache;
  status.value = r.ok ? r.status : 'error';
}

async function check(force = false) {
  if (busy) return;
  busy = true;
  status.value = 'checking';
  try {
    applyResult(await checkForUpdates({ currentVersion: APP_VERSION, force }));
  } finally {
    busy = false;
  }
}

async function refreshCapabilities() {
  const bridge = desktopBridge();
  if (!bridge?.capabilities) return;
  try {
    const c = await bridge.capabilities();
    canSelfUpdate.value = !!c.ok;
    capabilityReason.value = c.ok ? '' : (c.reason || 'unavailable');
  } catch {
    canSelfUpdate.value = false;
    capabilityReason.value = 'unavailable';
  }
}

watch(() => props.active, (on) => {
  if (!on) return;
  check(false);
  refreshCapabilities();
}, { immediate: true });

function openPage(url = RELEASES_PAGE) {
  if (!assertGithubUrl(url) || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function releaseBadge(r) {
  if (r.relation === 'current') return { text: '当前版本', type: 'success' };
  if (r.relation === 'newer') return { text: '可更新', type: 'info' };
  return { text: '历史版本', type: 'default' };
}

function releaseDate(r) {
  const d = new Date(r.publishedAt);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN');
}

async function startUpdate() {
  const bridge = desktopBridge();
  if (!bridge || !latest.value?.asset) return;
  status.value = 'downloading';
  progress.value = { phase: 'downloading', received: 0, total: latest.value.asset.size || 0, percent: 0 };
  unsubProgress = bridge.onProgress((p) => {
    progress.value = p;
    if (p.phase === 'verifying' && status.value === 'downloading') status.value = 'verifying';
  });
  try {
    const r = await bridge.download({
      url: latest.value.asset.url,
      version: latest.value.version,
      sha256Url: latest.value.sha256Url,
    });
    if (!r || r.cancelled) { status.value = 'cancelled'; return; }
    if (!r.ok) {
      downloadedPath.value = r.file || '';
      status.value = r.degraded ? 'degraded' : 'error';
      error.value = r.reason || 'download-failed';
      return;
    }
    if (r.degraded) {
      downloadedPath.value = r.file || '';
      status.value = 'degraded';
      error.value = r.reason || 'cannot-replace';
      return;
    }
    downloadedPath.value = r.file || '';
    status.value = 'restarting';
    await bridge.apply({ file: r.file, version: latest.value.version });
  } catch (e) {
    status.value = 'error';
    error.value = e?.message || 'apply-failed';
  } finally {
    if (unsubProgress) { unsubProgress(); unsubProgress = null; }
  }
}

function cancelDownload() {
  desktopBridge()?.cancel();
}

onBeforeUnmount(() => { if (unsubProgress) unsubProgress(); });
</script>

<template>
  <div class="card um-card">
    <div class="card-head">
      <h3>版本与更新</h3>
      <span class="card-meta">当前 v{{ APP_VERSION }}</span>
    </div>

    <div class="um-status" :class="`is-${status}`">
      <n-icon
        :component="status === 'up-to-date' ? CheckmarkCircleOutline : (status === 'error' ? AlertCircleOutline : RefreshOutline)"
        :size="16"
        :class="{ spin: status === 'checking' || status === 'downloading' || status === 'verifying' }"
      />
      <span class="um-status-text">{{ statusText }}</span>
      <span class="um-actions">
        <n-popover trigger="click" placement="bottom-end" :width="440" scrollable>
          <template #trigger>
            <n-button size="small" secondary :disabled="!releases.length">
              版本历史
              <template #icon><n-icon :component="ChevronDownOutline" :size="13" /></template>
            </n-button>
          </template>
          <div class="um-hist">
            <div v-if="!releases.length" class="um-hist-empty">暂无发布记录</div>
            <div v-for="r in releases" :key="r.tag" class="um-hist-row">
              <div class="um-hist-main">
                <b>v{{ r.version }}</b>
                <n-tag size="tiny" round :bordered="false" :type="releaseBadge(r).type">
                  {{ releaseBadge(r).text }}
                </n-tag>
                <span class="um-hist-date">{{ releaseDate(r) }}</span>
              </div>
              <div class="um-hist-notes">{{ r.notes || '无更新说明' }}</div>
              <IconBtn :icon="OpenOutline" size="tiny" :icon-size="14" :title="`打开 v${r.version} 发布页`" @click="openPage(r.htmlUrl)" />
            </div>
          </div>
        </n-popover>
        <IconBtn :icon="RefreshOutline" title="立即检查更新" :disabled="busy" @click="check(true)" />
      </span>
    </div>

    <div v-if="latest && (status === 'available' || status === 'downloading')" class="um-latest">
      <div class="um-latest-info">
        <b>v{{ latest.version }}</b>
        <span>{{ latest.publishedAt ? releaseDate(latest) : '' }} · {{ formatBytes(latest.asset?.size || 0) }}</span>
        <p>{{ latest.notes || '无更新说明' }}</p>
      </div>
      <n-button v-if="canUpdate" type="primary" size="small" round @click="startUpdate">
        <template #icon><n-icon :component="DownloadOutline" /></template>
        更新到 v{{ latest.version }}
      </n-button>
      <n-button v-else size="small" round tertiary @click="openPage(latest.htmlUrl)">
        <template #icon><n-icon :component="OpenOutline" /></template>
        打开下载页
      </n-button>
    </div>

    <div v-if="['downloading', 'verifying'].includes(status)" class="um-progress">
      <n-progress type="line" :percentage="progress.percent" :height="8" :show-indicator="false" />
      <div class="um-progress-meta">
        <span>{{ status === 'verifying' ? '校验中…' : `${formatBytes(progress.received)} / ${formatBytes(progress.total)} · ${progress.percent}%` }}</span>
        <n-button v-if="status === 'downloading'" text size="tiny" @click="cancelDownload">取消</n-button>
      </div>
    </div>

    <div v-if="status === 'degraded'" class="um-degraded">
      无法自动替换（{{ error }}）。已下载到 {{ downloadedPath || '下载目录' }}，请先完全退出 KafkaDesk 再替换。
    </div>

    <p v-if="desktop && !canSelfUpdate" class="um-note">
      当前环境不支持自动替换（{{ capabilityReason }}），更新只能下载后手动替换。
    </p>

    <div class="um-foot">
      <span>{{ checkedText }}</span>
      <n-button text size="tiny" @click="openPage()">打开 Releases 页</n-button>
    </div>
  </div>
</template>

<style scoped>
.um-card { gap: 10px; }
.um-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--kd-radius-inner);
  background: var(--kd-surface);
  font-size: 13px;
}
.um-status.is-available { color: var(--kd-accent); }
.um-status.is-up-to-date { color: var(--kd-green); }
.um-status.is-error,
.um-status.is-degraded { color: var(--kd-orange); }
.um-status-text { flex: 1; min-width: 0; }
.um-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.spin { animation: um-spin 1.1s linear infinite; }
@keyframes um-spin { to { transform: rotate(360deg); } }

.um-latest {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--kd-card-border);
  border-radius: var(--kd-radius-inner);
}
.um-latest-info { flex: 1; min-width: 0; font-size: 12.5px; }
.um-latest-info b { font-size: 14px; margin-right: 8px; }
.um-latest-info span { opacity: 0.55; font-variant-numeric: tabular-nums; }
.um-latest-info p { margin: 4px 0 0; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.um-progress { display: flex; flex-direction: column; gap: 4px; }
.um-progress-meta { display: flex; justify-content: space-between; font-size: 12px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.um-degraded { font-size: 12px; color: var(--kd-orange); line-height: 1.6; }
.um-note { margin: 0; font-size: 11.5px; opacity: 0.55; line-height: 1.6; }
.um-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}

.um-hist { display: flex; flex-direction: column; gap: 6px; }
.um-hist-empty { font-size: 12px; opacity: 0.6; padding: 12px 4px; text-align: center; }
.um-hist-row {
  position: relative;
  padding: 7px 34px 7px 9px;
  border-radius: 8px;
  background: var(--kd-surface);
}
.um-hist-row :deep(.n-button) { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); }
.um-hist-main { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.um-hist-date { opacity: 0.5; font-size: 11.5px; }
.um-hist-notes { font-size: 11.5px; opacity: 0.65; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
