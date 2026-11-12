<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NButton, NInputNumber, NModal, NProgress, NSwitch } from 'naive-ui';
import { useActiveStore } from '../stores/active.js';
import { useAutomationStore } from '../stores/automation.js';

/* 自动化测试弹窗（legacy app.js:2064-2450）：总数制 / 时间制 / 随机
 * request_id / 暂停继续 / 连败 5 次熔断 / Broker 回执。 */
const active = useActiveStore();
const auto = useAutomationStore();

const show = defineModel('show', { type: Boolean, default: false });

/* 用时读数：运行时每 500ms 刷新（legacy renderAuto 节流同频）。 */
const nowTick = ref(0);
let timer = null;
watch(() => auto.running, (running) => {
  clearInterval(timer);
  timer = null;
  if (running) timer = setInterval(() => { nowTick.value = Date.now(); }, 500);
}, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));

const elapsedText = computed(() => {
  void nowTick.value; // dependency
  const s = Math.floor(auto.elapsed() / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
});

const rate = computed(() => {
  const pct = (1000 / Math.max(10, Number(auto.settings.timedInterval) || 1000)) * 100;
  return Math.round(pct) / 100;
});

const pad = (n) => String(n).padStart(2, '0');
function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const receiptText = computed(() => {
  const r = auto.lastReceipt;
  if (!r) return '尚无投递回执 · 启动后这里会显示 Broker 返回的 partition / offset';
  return `${r.topic || '?'} · p${r.partition ?? '?'} / @${r.offset ?? '?'} · ${r.bytes ?? '?'} B · ${clock(r.ts)}`;
});

const randHint = computed(() => {
  if (!auto.settings.randomId) return '未启用 · 按原样投递发送区内容';
  if (auto.lastRandId) return `${auto.lastRandId} · 已替换字段「${auto.lastRandField}」· 每条重新生成`;
  return auto.firstField
    ? `已启用 · 将替换字段「${auto.firstField}」· 启动后显示最近生成的 ID`
    : '内容体不是非空 JSON 对象，无法替换首个字段';
});

const payloadText = computed(() => (auto.payloadOk
  ? `合法 JSON · ${auto.payloadBytes} B · Key ${(active.draft.key || '').trim() || '(无)'}`
  : 'JSON 不合法或为空，无法发送'));
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    class="auto-modal"
    :bordered="false"
    :style="{ width: '760px', maxWidth: '94vw' }"
    title="自动化测试"
  >
    <template #header>
      <div class="am-head">
        <span class="am-title">自动化测试</span>
        <span class="am-badge" :class="{ demo: active.server?.demo }">
          {{ active.server?.demo ? '演示模式 · 仅回显，不写入 Broker' : '真实 Kafka · 每条写入 Broker' }}
        </span>
      </div>
    </template>

    <label class="am-rand" :class="{ on: auto.settings.randomId }">
      <n-switch
        :value="auto.settings.randomId"
        size="small"
        @update:value="(v) => { auto.settings.randomId = v; auto.saveSettings(); }"
      />
      <span class="am-rand-body">
        <span class="am-rand-title">使用随机 request_id <em>按服务器记忆</em></span>
        <span class="am-rand-desc">
          每条消息投递前生成随机 ID，直接替换内容体第一个字段
          <b>{{ auto.firstField || '（无法定位 · 内容体需为非空 JSON 对象）' }}</b> 的值。
          不改写发送区内容，仅作用于自动化发送；运行中切换即时生效。
        </span>
      </span>
    </label>

    <div class="am-readout">
      <div class="am-row">
        <span class="k">目标主题</span>
        <span class="v" :class="{ bad: !auto.targetTopic }">{{ auto.targetTopic || '（左侧配置区未设置）' }}</span>
      </div>
      <div class="am-row">
        <span class="k">消息内容</span>
        <span class="v" :class="{ bad: !auto.payloadOk }">{{ payloadText }}</span>
      </div>
      <div class="am-row">
        <span class="k">随机 ID</span>
        <span class="v" :class="{ muted: !auto.settings.randomId }">{{ randHint }}</span>
      </div>
      <div class="am-row">
        <span class="k">投递回执</span>
        <span class="v" :class="auto.lastReceipt ? 'receipt' : 'muted'">{{ receiptText }}</span>
      </div>
      <p class="am-tip">
        主题与内容只由左侧配置区 / 发送区决定，此处仅设置发送节奏；每条发送时实时读取发送区当前的 JSON 与 Key。
      </p>
    </div>

    <div class="am-grid">
      <section class="am-pane" :class="{ active: auto.countActive, idle: auto.running && !auto.countActive }">
        <div class="pane-head">
          <h4>总数制</h4>
          <span class="pane-tag">发完自动停止</span>
        </div>
        <p class="pane-desc">按设定总数逐条发送，达到数量后自动结束。</p>
        <label class="field">
          <span class="field-label">发送总数 <em>必填</em></span>
          <n-input-number
            v-model:value="auto.settings.total"
            size="small"
            :min="1"
            :max="100000"
            :step="1"
            :disabled="auto.running"
            @update:value="auto.saveSettings()"
          />
        </label>
        <label class="field">
          <span class="field-label">每条间隔 <span class="optional">毫秒 ms</span></span>
          <n-input-number
            v-model:value="auto.settings.countInterval"
            size="small"
            :min="10"
            :max="600000"
            :step="10"
            :disabled="auto.running"
            @update:value="auto.saveSettings()"
          />
        </label>
        <div class="progress">
          <n-progress
            type="line"
            :percentage="auto.progress.pct"
            :height="8"
            :show-indicator="false"
            :status="auto.paused ? 'warning' : 'default'"
          />
          <span class="progress-text">{{ auto.progress.done }} / {{ auto.progress.total || '—' }}</span>
        </div>
        <div class="pane-actions">
          <n-button
            type="primary"
            size="small"
            round
            :disabled="auto.running && !auto.countActive"
            :loading="auto.starting && !auto.running"
            @click="auto.toggle('count')"
          >
            {{ !auto.countActive ? '开始发送' : (auto.paused ? '继续发送' : '暂停发送') }}
          </n-button>
          <n-button size="small" round tertiary :disabled="!auto.countActive" @click="auto.stop('已手动停止')">
            停止
          </n-button>
        </div>
      </section>

      <section class="am-pane" :class="{ active: auto.timedActive, idle: auto.running && !auto.timedActive }">
        <div class="pane-head">
          <h4>时间制</h4>
          <span class="pane-tag">手动停止</span>
        </div>
        <p class="pane-desc">按固定间隔持续发送，直到手动点击停止。</p>
        <label class="field">
          <span class="field-label">发送间隔 <span class="optional">毫秒 ms</span></span>
          <n-input-number
            v-model:value="auto.settings.timedInterval"
            size="small"
            :min="10"
            :max="600000"
            :step="10"
            :disabled="auto.running"
            @update:value="auto.saveSettings()"
          />
        </label>
        <div class="timed-note">预计速率 <b>{{ rate }}</b> 条/秒 · 持续发送无上限</div>
        <div class="pane-actions">
          <n-button
            type="primary"
            size="small"
            round
            :disabled="auto.running && !auto.timedActive"
            :loading="auto.starting && !auto.running"
            @click="auto.toggle('timed')"
          >
            {{ !auto.timedActive ? '开始发送' : (auto.paused ? '继续发送' : '暂停发送') }}
          </n-button>
          <n-button size="small" tertiary round :disabled="!auto.timedActive" @click="auto.stop('已手动停止')">
            停止
          </n-button>
        </div>
      </section>
    </div>

    <div class="am-status">
      <span class="mode" :class="{ running: auto.running && !auto.paused, paused: auto.running && auto.paused }">
        {{ auto.statusMode }}
      </span>
      <span>已发 <b>{{ auto.sent }}</b></span>
      <span>失败 <b>{{ auto.failed }}</b></span>
      <span>耗时 <b>{{ elapsedText }}</b></span>
      <span class="hint">{{ auto.statusHint }}</span>
    </div>

    <p v-if="auto.error" class="am-error">{{ auto.error }}</p>

    <template #footer>
      <div class="am-foot">
        <span>关闭窗口不会停止发送，可在发送栏点「停止」结束</span>
        <n-button size="small" round tertiary @click="show = false">关闭</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.am-head { display: flex; align-items: center; gap: 10px; }
.am-title { font-size: 15px; font-weight: 600; }
.am-badge {
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(52, 199, 89, 0.14);
  color: #34c759;
}
.am-badge.demo { background: rgba(175, 82, 222, 0.14); color: #af52de; }
.am-rand {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(128, 128, 128, 0.16);
  cursor: pointer;
}
.am-rand.on { border-color: rgba(0, 122, 255, 0.45); background: rgba(0, 122, 255, 0.06); }
.am-rand-body { display: flex; flex-direction: column; gap: 3px; }
.am-rand-title { font-size: 13px; font-weight: 600; }
.am-rand-title em { font-style: normal; font-size: 11px; opacity: 0.5; margin-left: 4px; }
.am-rand-desc { font-size: 12px; opacity: 0.62; line-height: 1.55; }
.am-readout { margin: 12px 0; display: flex; flex-direction: column; gap: 5px; }
.am-row { display: flex; gap: 10px; font-size: 12.5px; }
.am-row .k { width: 72px; opacity: 0.55; flex: 0 0 auto; }
.am-row .v { flex: 1; word-break: break-all; font-variant-numeric: tabular-nums; }
.am-row .v.bad { color: #ff3b30; }
.am-row .v.muted { opacity: 0.5; }
.am-row .v.receipt { color: #34c759; }
.am-tip { font-size: 11.5px; opacity: 0.5; margin: 4px 0 0; line-height: 1.55; }
.am-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 720px) { .am-grid { grid-template-columns: 1fr; } }
.am-pane {
  border: 1px solid rgba(128, 128, 128, 0.16);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.am-pane.active { border-color: rgba(0, 122, 255, 0.45); }
.am-pane.idle { opacity: 0.55; }
.pane-head { display: flex; align-items: baseline; gap: 8px; }
.pane-head h4 { margin: 0; font-size: 13.5px; }
.pane-tag { font-size: 11px; opacity: 0.5; }
.pane-desc { font-size: 12px; opacity: 0.6; margin: 0; line-height: 1.5; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 12px; opacity: 0.7; }
.field-label em { font-style: normal; color: #ff3b30; font-size: 11px; }
.field-label .optional { opacity: 0.6; font-size: 11px; }
.progress { display: flex; align-items: center; gap: 10px; }
.progress :deep(.n-progress) { flex: 1; }
.progress-text { font-size: 12px; opacity: 0.6; font-variant-numeric: tabular-nums; }
.timed-note { font-size: 12px; opacity: 0.6; }
.timed-note b { font-variant-numeric: tabular-nums; }
.pane-actions { display: flex; gap: 8px; margin-top: auto; }
.am-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.am-status .mode { font-weight: 600; opacity: 0.75; }
.am-status .mode.running { color: #34c759; opacity: 1; }
.am-status .mode.paused { color: #ff9500; opacity: 1; }
.am-status .hint { opacity: 0.5; margin-left: auto; }
.am-error {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: #ff3b30;
}
.am-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.am-foot span { font-size: 12px; opacity: 0.5; }
</style>
