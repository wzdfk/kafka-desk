<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  NCheckbox, NIcon, NInput, NSelect,
} from 'naive-ui';
import {
  ArrowBackOutline, ColorPaletteOutline, DownloadOutline, InformationCircleOutline,
  LayersOutline, TerminalOutline, TrashOutline,
} from '@vicons/ionicons5';
import IconBtn from '../components/IconBtn.vue';
import { usePrefsStore, PREF_CACHE_LIMIT, PREF_MAX_MESSAGES } from '../stores/prefs.js';
import { useSyslogStore } from '../stores/syslog.js';
import { useServersStore } from '../stores/servers.js';
import { clearLocalCache, storageUsage } from '../utils/storage.js';
import { toast } from '../utils/toast.js';
import { confirmDialog } from '../utils/dialog.js';
import { MODE_LABEL, setThemeMode, themeMode, themeResolved } from '../theme/index.js';

/* 系统设置：外观主题 / 消息与缓存 / 系统日志 / 关于（legacy index.html:301-512）。 */
const APP_VERSION = '1.0.0';

const router = useRouter();
const prefs = usePrefsStore();
const syslog = useSyslogStore();
const servers = useServersStore();

const PANES = [
  {
    key: 'appearance',
    icon: ColorPaletteOutline,
    label: '外观主题',
    title: '外观主题',
    desc: '选择界面配色方案，改动立即生效，不需要重启。',
  },
  {
    key: 'messages',
    icon: LayersOutline,
    label: '消息与缓存',
    title: '消息与缓存',
    desc: '接收区上限与本地缓存策略，对整个客户端生效。',
  },
  {
    key: 'logs',
    icon: TerminalOutline,
    label: '系统日志',
    title: '系统日志',
    desc: '客户端与本地服务的事件流水，可按级别筛选并导出。',
  },
  {
    key: 'about',
    icon: InformationCircleOutline,
    label: '关于',
    title: '关于',
    desc: '版本信息、运行模式与本机数据占用。',
  },
];

const pane = ref('appearance');
const meta = computed(() => PANES.find((p) => p.key === pane.value) || PANES[0]);

function switchPane(key) {
  pane.value = key;
  if (key === 'messages' || key === 'about') usage.value = storageUsage();
  if (key === 'logs') nextTick(scrollLogToEnd);
}

/* ---- 外观 ---- */
const THEME_OPTS = [
  { value: 'light', label: '明亮', desc: '浅色背景，适合白天与投屏' },
  { value: 'dark', label: '幽暗', desc: '深色界面，长时间盯消息更省眼' },
  { value: 'system', label: '跟随系统', desc: '随 Windows 的浅色 / 深色自动切换' },
];
const themeNowLabel = computed(() => (themeMode.value === 'system'
  ? `跟随系统 · 当前${MODE_LABEL[themeResolved.value]}`
  : MODE_LABEL[themeMode.value]));

/* ---- 消息与缓存 ---- */
const maxMsgOptions = PREF_MAX_MESSAGES.map((v) => ({ label: `${v} 条`, value: v }));
const cacheOptions = PREF_CACHE_LIMIT.map((v) => ({ label: `${v} 条`, value: v }));

const usage = ref(0);
const usageText = computed(() => {
  const n = usage.value;
  if (n >= 1048576) return `本机占用 ${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `本机占用 ${(n / 1024).toFixed(1)} KB`;
  return `本机占用 ${n} B`;
});

function onMaxMessages(v) {
  prefs.setMaxMessages(v);
  syslog.add({ level: 'info', src: '设置', text: `接收区保留上限调整为 ${v} 条` });
}

function onCacheLimit(v) {
  prefs.setCacheLimit(v);
  syslog.add({ level: 'info', src: '设置', text: `本地缓存条数调整为 ${v} 条/服务器` });
}

function clearCache() {
  confirmDialog({
    title: '清理本机缓存',
    content: '将清空所有服务器缓存的接收消息、发送草稿与筛选记录；服务器配置保存在服务端，不受影响。',
    positiveText: '清理',
    onPositiveClick: () => {
      const n = clearLocalCache();
      usage.value = storageUsage();
      syslog.add({ level: 'info', src: '设置', text: `本机缓存已清理（${n} 项）` });
      toast('本机缓存已清理', 'success');
    },
  });
}

/* ---- 系统日志 ---- */
const LEVELS = [
  { value: 'all', label: '全部' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
];
const logLevel = ref('all');
const logQuery = ref('');
const logFollow = ref(true);
const logListEl = ref(null);

const shownLogs = computed(() => {
  const q = logQuery.value.trim().toLowerCase();
  return syslog.entries.filter((e) => {
    if (logLevel.value !== 'all' && e.level !== logLevel.value) return false;
    if (!q) return true;
    return String(e.text).toLowerCase().includes(q)
      || String(e.src || '').toLowerCase().includes(q);
  });
});

const logCountText = computed(() => {
  const total = syslog.entries.length;
  const shown = shownLogs.value.length;
  return shown === total ? `共 ${total} 条` : `显示 ${shown} / 共 ${total} 条`;
});

const pad = (n) => String(n).padStart(2, '0');
function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function scrollLogToEnd() {
  const el = logListEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/* New entries while the logs pane is open: keep the tail in view. */
watch(() => syslog.entries.length, () => {
  if (pane.value === 'logs' && logFollow.value) nextTick(scrollLogToEnd);
});

function clearLogs() {
  if (!syslog.entries.length) { toast('日志已经是空的'); return; }
  confirmDialog({
    title: '清空系统日志',
    content: `确定清空 ${syslog.entries.length} 条系统日志？`,
    positiveText: '清空',
    onPositiveClick: () => {
      syslog.clear();
      syslog.add({ level: 'info', src: '设置', text: '系统日志已清空' });
    },
  });
}

function exportLogs() {
  if (!syslog.exportLog()) toast('暂无可导出的日志', 'error');
}

/* ---- 关于 ---- */
const endpoint = typeof window !== 'undefined' ? window.location.origin : '—';
const modeText = computed(() => (servers.demo ? '演示模式（本地模拟）' : '真实 Kafka'));
const serverCount = computed(() => `${servers.list.length} 台`);

onMounted(() => {
  usage.value = storageUsage();
});

function back() {
  if (window.history.length > 1) router.back();
  else router.push('/');
}
</script>

<template>
  <div class="set-view">
    <aside class="set-nav">
      <div class="nav-head">
        <span class="nav-title">系统设置</span>
        <span class="nav-ver">v{{ APP_VERSION }}</span>
      </div>
      <button
        v-for="p in PANES"
        :key="p.key"
        type="button"
        class="nav-item"
        :class="{ 'is-active': pane === p.key }"
        @click="switchPane(p.key)"
      >
        <n-icon :component="p.icon" :size="16" />
        <span>{{ p.label }}</span>
      </button>
      <div class="nav-foot">设置保存在本地<br /></div>
    </aside>

    <div class="set-main">
      <header class="set-head">
        <div>
          <h1>{{ meta.title }}</h1>
          <p>{{ meta.desc }}</p>
        </div>
        <IconBtn :icon="ArrowBackOutline" title="返回上一页" @click="back" />
      </header>

      <div class="set-scroll">
        <!-- 外观主题 -->
        <section v-show="pane === 'appearance'" class="pane">
          <div class="card">
            <div class="card-head">
              <h3>主题模式</h3>
              <span class="card-meta">{{ themeNowLabel }}</span>
            </div>
            <div class="theme-opts">
              <button
                v-for="opt in THEME_OPTS"
                :key="opt.value"
                type="button"
                class="theme-opt"
                :class="{ 'is-on': themeMode === opt.value }"
                @click="setThemeMode(opt.value)"
              >
                <span class="tp" :class="`tp-${opt.value}`">
                  <span class="tp-top" />
                  <span class="tp-body">
                    <span class="tp-side" />
                    <span class="tp-lines"><i /><i /><i /></span>
                  </span>
                </span>
                <span class="theme-body">
                  <b>{{ opt.label }}</b>
                  <small>{{ opt.desc }}</small>
                </span>
                <span class="theme-check">✓</span>
              </button>
            </div>
            <p class="note">
              顶部右侧的 ☀ / ☾ 按钮可在三种模式间快速循环切换（明亮 → 幽暗 → 跟随系统），无需进入本页。
              系统切换深浅色时，若处于「跟随系统」，界面会自动跟随。
            </p>
          </div>
        </section>

        <!-- 消息与缓存 -->
        <section v-show="pane === 'messages'" class="pane">
          <div class="card">
            <div class="card-head">
              <h3>接收区</h3>
              <span class="card-meta">全局 · 所有服务器共用</span>
            </div>
            <div class="row">
              <div class="row-main">
                <div class="row-title">界面最多保留消息</div>
                <div class="row-desc">
                  超出后自动移除最早的消息节点，不影响 Kafka 里的数据。消息洪水时调低更流畅。
                </div>
              </div>
              <div class="row-ctl">
                <n-select
                  :value="prefs.maxMessages"
                  :options="maxMsgOptions"
                  size="small"
                  style="width: 120px"
                  @update:value="onMaxMessages"
                />
              </div>
            </div>
            <div class="row">
              <div class="row-main">
                <div class="row-title">本地缓存条数</div>
                <div class="row-desc">
                  每台服务器在浏览器里留存最近多少条消息，下次打开自动恢复。调大可回看更多历史，占用更多本地空间。
                </div>
              </div>
              <div class="row-ctl">
                <n-select
                  :value="prefs.cacheLimit"
                  :options="cacheOptions"
                  size="small"
                  style="width: 120px"
                  @update:value="onCacheLimit"
                />
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>本地数据</h3>
              <span class="card-meta">{{ usageText }}</span>
            </div>
            <div class="row">
              <div class="row-main">
                <div class="row-title">清理本机缓存</div>
                <div class="row-desc">
                  清除所有服务器缓存的接收消息、发送草稿、筛选条件等本地记录。服务器配置保存在服务端，不受影响。
                </div>
              </div>
              <div class="row-ctl">
                <IconBtn :icon="TrashOutline" title="清理本机缓存" @click="clearCache" />
              </div>
            </div>
            <p class="note">「清理」不会退出当前订阅，也不会影响已经发出去的消息。</p>
          </div>
        </section>

        <!-- 系统日志 -->
        <section v-show="pane === 'logs'" class="pane">
          <div class="card card-log">
            <div class="log-toolbar">
              <div class="levels">
                <button
                  v-for="lv in LEVELS"
                  :key="lv.value"
                  type="button"
                  class="lv"
                  :class="{ 'is-on': logLevel === lv.value }"
                  @click="logLevel = lv.value"
                >
                  {{ lv.label }}
                </button>
              </div>
              <n-input
                v-model:value="logQuery"
                class="log-search"
                size="small"
                clearable
                placeholder="搜索日志 / 服务器…"
              />
              <n-checkbox v-model:checked="logFollow">自动滚动</n-checkbox>
              <span class="spacer" />
              <IconBtn :icon="DownloadOutline" title="导出日志" @click="exportLogs" />
              <IconBtn :icon="TrashOutline" title="清空日志" @click="clearLogs" />
            </div>

            <div ref="logListEl" class="log-list">
              <div v-if="!shownLogs.length" class="log-empty">
                {{ syslog.entries.length ? '没有匹配当前筛选条件的日志' : '暂无日志' }}
              </div>
              <div
                v-for="(e, i) in shownLogs"
                :key="`${e.ts}-${i}`"
                class="log-line"
                :class="`lv-${e.level}`"
              >
                <span class="t" :title="new Date(e.ts).toLocaleString()">{{ clock(e.ts) }}</span>
                <span class="lv-tag">{{ e.level === 'error' ? 'ERR' : e.level === 'warn' ? 'WARN' : 'INFO' }}</span>
                <span class="src" :title="e.src || ''">{{ e.src || '—' }}</span>
                <span class="txt" :title="e.text">{{ e.text }}</span>
              </div>
            </div>

            <div class="log-foot">
              <span>{{ logCountText }}</span>
              <span>含本地服务事件 · 最多保留 400 条 · 存于本机</span>
            </div>
          </div>
        </section>

        <!-- 关于 -->
        <section v-show="pane === 'about'" class="pane">
          <div class="card about-card">
            <img src="/logo.png" alt="KafkaDesk" width="64" height="64" class="about-logo" />
            <div class="about-body">
              <h2>KafkaDesk <span class="about-ver">v{{ APP_VERSION }}</span></h2>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h3>运行信息</h3>
              <span class="card-meta">实时</span>
            </div>
            <dl class="kv">
              <dt>本地服务</dt><dd>{{ endpoint }}</dd>
              <dt>运行模式</dt><dd>{{ modeText }}</dd>
              <dt>已配置服务器</dt><dd>{{ serverCount }}</dd>
              <dt>界面版本</dt><dd>v{{ APP_VERSION }}</dd>
            </dl>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.set-view {
  height: 100%;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 20px;
  min-height: 0;
}
@media (max-width: 860px) {
  .set-view { grid-template-columns: 1fr; }
  .set-nav { display: none; }
}
.set-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}
.nav-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 2px 10px 10px;
}
.nav-title { font-size: 13.5px; font-weight: 600; }
.nav-ver { font-size: 11.5px; opacity: 0.45; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  opacity: 0.72;
}
.nav-item:hover { opacity: 1; background: var(--kd-hover); }
.nav-item.is-active {
  opacity: 1;
  font-weight: 600;
  background: rgba(0, 113, 227, 0.12);
  color: var(--kd-accent);
}
.nav-foot {
  margin-top: auto;
  padding: 10px;
  font-size: 11.5px;
  opacity: 0.42;
  line-height: 1.6;
}
.set-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.set-head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.set-head h1 { margin: 0; font-size: 18px; font-weight: 700; }
.set-head p { margin: 4px 0 0; font-size: 12.5px; opacity: 0.55; }
.set-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}
.pane { display: flex; flex-direction: column; gap: 12px; }
.card {
  background: var(--kd-card-bg);
  border: 1px solid var(--kd-card-border);
  border-radius: var(--kd-radius-card);
  box-shadow: var(--kd-card-shadow);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-head { display: flex; align-items: baseline; gap: 10px; }
.card-head h3 { margin: 0; font-size: 13.5px; font-weight: 600; }
.card-meta { font-size: 12px; opacity: 0.5; margin-left: auto; }
.note { font-size: 11.5px; opacity: 0.5; margin: 0; line-height: 1.6; }

/* theme cards */
.theme-opts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 720px) { .theme-opts { grid-template-columns: 1fr; } }
.theme-opt {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 12px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.theme-opt:hover { border-color: rgba(0, 122, 255, 0.4); }
.theme-opt.is-on { border-color: var(--kd-accent); box-shadow: 0 0 0 1px var(--kd-accent) inset; }
.tp {
  display: block;
  height: 62px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.18);
}
.tp-top { display: block; height: 12px; background: #e9e9eb; }
.tp-body { display: flex; height: calc(100% - 12px); background: #f7f7f8; }
.tp-side { width: 22%; background: #ffffff; border-right: 1px solid rgba(0, 0, 0, 0.06); }
.tp-lines { display: flex; flex-direction: column; gap: 4px; padding: 7px; flex: 1; }
.tp-lines i { height: 5px; border-radius: 3px; background: rgba(0, 0, 0, 0.1); }
.tp-dark .tp-top { background: #1c1c1e; }
.tp-dark .tp-body { background: #121214; }
.tp-dark .tp-side { background: #1c1c1e; border-right-color: rgba(255, 255, 255, 0.06); }
.tp-dark .tp-lines i { background: rgba(255, 255, 255, 0.16); }
.tp-system .tp-top { background: linear-gradient(90deg, #e9e9eb 50%, #1c1c1e 50%); }
.tp-system .tp-body { background: linear-gradient(90deg, #f7f7f8 50%, #121214 50%); }
.tp-system .tp-side {
  background: linear-gradient(90deg, #ffffff 50%, #1c1c1e 50%);
  border-right-color: rgba(128, 128, 128, 0.2);
}
.theme-body { display: flex; flex-direction: column; gap: 2px; }
.theme-body b { font-size: 13px; }
.theme-body small { font-size: 11.5px; opacity: 0.55; line-height: 1.45; }
.theme-check {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 12px;
  color: var(--kd-accent);
  opacity: 0;
}
.theme-opt.is-on .theme-check { opacity: 1; }

/* rows */
.row { display: flex; align-items: flex-start; gap: 16px; }
.row-main { flex: 1; min-width: 0; }
.row-title { font-size: 13px; font-weight: 500; }
.row-desc { font-size: 12px; opacity: 0.55; line-height: 1.55; margin-top: 3px; }
.row-ctl { flex: 0 0 auto; }

/* logs */
.card-log { padding: 0; overflow: hidden; }
.log-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--kd-divider);
  flex-wrap: wrap;
}
.levels { display: flex; gap: 2px; }
.lv {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
  opacity: 0.6;
}
.lv:hover { opacity: 1; }
.lv.is-on { opacity: 1; background: var(--kd-hover); font-weight: 600; }
.log-search { width: 220px; }
.spacer { flex: 1; }
.log-list {
  height: 420px;
  max-height: 52vh;
  overflow-y: auto;
  padding: 6px 0;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}
.log-line {
  display: flex;
  gap: 10px;
  padding: 3px 12px;
  font-size: 12px;
  line-height: 1.5;
}
.log-line:hover { background: rgba(128, 128, 128, 0.07); }
.log-line .t { opacity: 0.45; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.log-line .lv-tag { flex: 0 0 38px; font-weight: 600; opacity: 0.7; }
.log-line.lv-warn .lv-tag { color: var(--kd-orange); opacity: 1; }
.log-line.lv-error .lv-tag { color: var(--kd-red); opacity: 1; }
.log-line .src {
  flex: 0 0 110px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-line .txt { flex: 1; word-break: break-all; opacity: 0.85; }
.log-empty { padding: 24px 12px; text-align: center; font-size: 12.5px; opacity: 0.45; }
.log-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--kd-divider);
  font-size: 11.5px;
  opacity: 0.5;
}

/* about */
.about-card { flex-direction: row; align-items: center; gap: 16px; }
.about-logo { border-radius: 14px; }
.about-body h2 { margin: 0; font-size: 17px; display: flex; align-items: baseline; gap: 8px; }
.about-ver { font-size: 12px; opacity: 0.5; font-weight: 400; }
.about-body p { margin: 5px 0 0; font-size: 12.5px; opacity: 0.6; }
.kv { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 12.5px; }
.kv dt { opacity: 0.55; }
.kv dd { margin: 0; word-break: break-all; }
</style>
