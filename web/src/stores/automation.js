import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api/api.js';
import { readJson, storageKeys, writeJson } from '../utils/storage.js';
import { toast } from '../utils/toast.js';
import { checkJson, useActiveStore } from './active.js';

/* Automated sending (legacy app.js:2064-2450), faithfully ported:
 * count mode (auto-stop at total) / timed mode (until stopped), interval
 * 10-600000ms, optional random request_id replacing only the FIRST field of
 * the payload, 5 consecutive failures stop the run, pause keeps progress. */
const DEFAULTS = { total: 100, countInterval: 500, timedInterval: 1000, randomId: false };

let randSeq = 0;

function genRequestId() {
  const t = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  const s = (++randSeq % 1296).toString(36).padStart(2, '0');
  return `${t}${r}${s}`;
}

/* First key of a non-empty plain JSON object; arrays/scalars have none. */
export function firstBodyField(raw) {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const keys = Object.keys(obj);
    return keys.length ? keys[0] : null;
  } catch { return null; }
}

/* Rebuild one delivery payload: only the first field's value is replaced,
 * field order preserved; the editor / draft are never touched. */
export function autoPayloadForSend(raw) {
  const field = firstBodyField(raw);
  if (!field) return null;
  const obj = JSON.parse(raw);
  const id = genRequestId();
  obj[field] = id;
  return { payload: JSON.stringify(obj), field, id };
}

function readInt(v, label, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} 需为 ${min} ~ ${max} 的整数`);
  }
  return n;
}

export const useAutomationStore = defineStore('automation', () => {
  const settings = ref({ ...DEFAULTS });
  const running = ref(false);
  const paused = ref(false);
  const starting = ref(false);
  const mode = ref(null); // 'count' | 'timed' | null
  const total = ref(0);
  const interval = ref(0);
  const attempts = ref(0);
  const sent = ref(0);
  const failed = ref(0);
  const consecutiveFail = ref(0);
  const startedAt = ref(0);
  const elapsedMs = ref(0);
  const lastError = ref('');
  const lastReceipt = ref(null);
  const lastRandId = ref('');
  const lastRandField = ref('');
  const lastSummary = ref('');
  const error = ref('');

  let timer = null;
  let inFlight = false;
  let gen = 0;

  const active = useActiveStore();

  const countActive = computed(() => running.value && mode.value === 'count');
  const timedActive = computed(() => running.value && mode.value === 'timed');

  const payloadOk = computed(() => checkJson(active.draft.payload).state === 'ok');
  const targetTopic = computed(() => active.config.sendTopic || '');
  const firstField = computed(() => firstBodyField(active.draft.payload));
  const payloadBytes = computed(() => {
    const s = active.draft.payload || '';
    return new TextEncoder().encode(s).length;
  });

  const progress = computed(() => {
    const t = countActive.value ? total.value : (Number(settings.value.total) || 0);
    const done = countActive.value ? attempts.value : 0;
    return {
      total: t,
      done,
      pct: t > 0 ? Math.min(100, Math.round((done / t) * 100)) : 0,
    };
  });

  const elapsed = () => elapsedMs.value + (running.value && !paused.value ? Date.now() - startedAt.value : 0);

  /* One-line state shown next to the send-area trigger. */
  const headline = computed(() => {
    if (!running.value) return '';
    if (paused.value) return `已暂停 · 已发 ${sent.value}`;
    return countActive.value
      ? `总数制 ${attempts.value}/${total.value}`
      : `时间制 已发 ${sent.value}`;
  });

  const statusMode = computed(() => {
    if (!running.value) return '空闲';
    if (paused.value) return `${mode.value === 'count' ? '总数制' : '时间制'} · 已暂停`;
    return mode.value === 'count' ? `总数制 · 目标 ${total.value} 条` : '时间制 · 持续发送';
  });

  const statusHint = computed(() => {
    if (paused.value) return '已暂停 · 点「继续发送」从当前进度恢复';
    if (running.value) return `运行中 · 间隔 ${interval.value}ms · 实时读取发送区内容`;
    return lastSummary.value || '间隔低于 50ms 可能造成较大压力';
  });

  /* ---- settings (per server, loaded on entering a workspace) ---- */
  function loadSettings(id) {
    settings.value = { ...DEFAULTS }; // reset first: no inheritance across servers
    if (!id) return;
    const d = readJson(storageKeys.auto(id), null);
    if (!d) return;
    if (Number.isFinite(d.total)) settings.value.total = d.total;
    if (Number.isFinite(d.countInterval)) settings.value.countInterval = d.countInterval;
    if (Number.isFinite(d.timedInterval)) settings.value.timedInterval = d.timedInterval;
    if (typeof d.randomId === 'boolean') settings.value.randomId = d.randomId;
  }

  function saveSettings() {
    const id = active.serverId;
    if (!id) return;
    writeJson(storageKeys.auto(id), {
      total: Number(settings.value.total),
      countInterval: Number(settings.value.countInterval),
      timedInterval: Number(settings.value.timedInterval),
      randomId: !!settings.value.randomId,
    });
  }

  function resetCounters() {
    total.value = 0;
    interval.value = 0;
    attempts.value = 0;
    sent.value = 0;
    failed.value = 0;
    consecutiveFail.value = 0;
    startedAt.value = 0;
    elapsedMs.value = 0;
    lastError.value = '';
    inFlight = false;
  }

  function clearError() { error.value = ''; }

  async function start(m) {
    if (running.value || starting.value) return;
    clearError();
    if (!active.serverId) { error.value = '请先进入一台服务器'; return; }
    if (!payloadOk.value) {
      error.value = '发送消息JSON 不合法或为空，请先修正后再启动';
      return;
    }
    if (settings.value.randomId && !firstField.value) {
      error.value = '已勾选「使用随机 request_id」，但内容体不是非空 JSON 对象，无法定位第一个字段；请取消勾选或修改内容';
      return;
    }
    if (!String(targetTopic.value).trim()) {
      error.value = '请先在左侧配置区填写「发送主题」';
      return;
    }
    let t = 0;
    let iv = 0;
    try {
      iv = readInt(m === 'count' ? settings.value.countInterval : settings.value.timedInterval, '发送间隔', 10, 600000);
      if (m === 'count') t = readInt(settings.value.total, '发送总数', 1, 100000);
    } catch (err) {
      error.value = err.message;
      return;
    }

    // Bump the generation BEFORE the first await: a stop / server switch during
    // the config save must invalidate this pending start.
    const myGen = ++gen;
    starting.value = true;
    saveSettings();
    try {
      await active.saveConfig();
    } catch (err) {
      starting.value = false;
      error.value = `保存配置失败：${err.message}`;
      return;
    }
    if (myGen !== gen) { starting.value = false; return; } // stopped while saving
    starting.value = false;

    resetCounters();
    running.value = true;
    paused.value = false;
    mode.value = m;
    total.value = t;
    interval.value = iv;
    startedAt.value = Date.now();
    lastSummary.value = '';
    lastReceipt.value = null;
    lastRandId.value = '';
    lastRandField.value = '';

    const randNote = settings.value.randomId ? ` · 随机 request_id → 字段「${firstField.value}」` : '';
    active.pushRunLog({
      level: 'info',
      text: `自动化发送启动：${m === 'count' ? `总数 ${t} 条` : '时间制持续'} · 间隔 ${iv}ms${randNote}`,
    });
    tick();
  }

  function toggle(m) {
    if (!running.value) { start(m); return; }
    if (mode.value !== m) return; // the other mode is locked while running
    if (paused.value) resume();
    else pause();
  }

  function pause() {
    if (!running.value || paused.value) return;
    if (timer) { clearTimeout(timer); timer = null; }
    elapsedMs.value += Date.now() - startedAt.value;
    paused.value = true;
    active.pushRunLog({ level: 'info', text: `自动化发送已暂停：当前进度保留，已发 ${sent.value} 条` });
  }

  function resume() {
    if (!running.value || !paused.value) return;
    paused.value = false;
    startedAt.value = Date.now();
    active.pushRunLog({ level: 'info', text: '自动化发送已继续' });
    if (!inFlight) tick();
  }

  async function tick() {
    if (!running.value || paused.value || inFlight) return;
    const myGen = gen;
    const id = active.serverId;
    if (!id) { stop('已离开工作区，自动化发送已停止', true); return; }
    const raw = active.draft.payload;
    if (checkJson(raw).state !== 'ok') {
      stop('发送消息JSON 变为非法或为空，已自动停止');
      return;
    }
    let payload = raw;
    let rid = '';
    if (settings.value.randomId) {
      const built = autoPayloadForSend(raw);
      if (!built) {
        stop('内容体不是非空 JSON 对象，无法写入随机 request_id，已自动停止');
        return;
      }
      payload = built.payload;
      rid = built.id;
      lastRandId.value = built.id;
      lastRandField.value = built.field;
    }
    inFlight = true;
    let res = null;
    let errMsg = '';
    try {
      res = await api.send(id, { key: (active.draft.key || '').trim(), payload });
    } catch (err) {
      errMsg = err.message;
    }
    inFlight = false;
    // Stop / pause / switch happened while in flight: discard this result.
    if (!running.value || myGen !== gen) return;

    attempts.value += 1;
    if (res) {
      sent.value += 1;
      consecutiveFail.value = 0;
      const md = res.metadata || {};
      lastReceipt.value = {
        topic: res.topic || md.topicName || '',
        partition: md.partition,
        offset: md.baseOffset,
        bytes: res.bytes,
        ts: Date.now(),
      };
      const rc = lastReceipt.value;
      active.pushRunLog({
        level: 'info',
        text: `自动化投递 #${sent.value} → ${rc.topic} · p${rc.partition ?? '?'} / @${rc.offset ?? '?'} (${rc.bytes ?? '?'} B)${rid ? ` · rid=${rid}` : ''}`,
      });
    } else {
      failed.value += 1;
      consecutiveFail.value += 1;
      lastError.value = errMsg;
      active.pushRunLog({ level: 'error', text: `自动化发送失败 #${attempts.value}：${errMsg}` });
    }
    if (consecutiveFail.value >= 5) {
      stop(`连续 5 次发送失败，已自动停止：${lastError.value}`);
      return;
    }
    if (mode.value === 'count' && attempts.value >= total.value) {
      stop(`总数制完成：尝试 ${attempts.value} 条，成功 ${sent.value} 条，失败 ${failed.value} 条`);
      return;
    }
    if (paused.value) return; // resume() kicks the next tick
    timer = setTimeout(tick, interval.value);
  }

  function stop(reason = '', silent = false) {
    if (timer) { clearTimeout(timer); timer = null; }
    const wasRunning = running.value;
    const lastSent = sent.value;
    const lastFailed = failed.value;
    gen += 1; // invalidate any in-flight request
    running.value = false;
    starting.value = false;
    paused.value = false;
    mode.value = null;
    resetCounters(); // stop = full reset, never leave a partial 3/10
    // Receipt is a delivery log, not progress: keep the last real one.
    lastSummary.value = wasRunning
      ? `上轮：成功 ${lastSent} · 失败 ${lastFailed} · 进度已清空`
      : '';
    if (wasRunning && reason) {
      const bad = /失败|非法|超时|错误/.test(reason);
      active.pushRunLog({ level: bad ? 'error' : 'info', text: `自动化发送停止：${reason}` });
      if (!silent) toast(reason, bad ? 'error' : 'success');
    }
  }

  return {
    settings, running, paused, starting, mode, total, interval, attempts, sent, failed,
    consecutiveFail, elapsedMs, lastError, lastReceipt, lastRandId, lastRandField,
    lastSummary, error,
    countActive, timedActive, payloadOk, targetTopic, firstField, payloadBytes,
    progress, headline, statusMode, statusHint,
    elapsed, loadSettings, saveSettings, clearError,
    start, toggle, pause, resume, stop, tick,
  };
});
