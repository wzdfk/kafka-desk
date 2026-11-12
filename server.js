'use strict';

/**
 * KafkaDesk backend
 * -----------------
 * Multiple broker servers are kept isolated: each server owns its own KafkaJS
 * client, producer, one consumer per subscribed topic, config and message buffer.
 * The browser receives SSE events tagged with `serverId` and only renders the
 * server currently open.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Kafka, logLevel } = require('kafkajs');

const HOST = '127.0.0.1';
const PORT = Number(process.env.KAFKA_DESK_PORT || 18761);
const DEMO = process.env.KAFKA_DESK_DEMO === '1';
const DATA_DIR = path.join(__dirname, 'data');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const MAX_BUFFER = 200;       // per-server in-memory history
const FLUSH_MS = 50;          // SSE batching window
const TOPIC_LIMIT = 100;

const app = express();
app.use(express.json({ limit: '4mb' }));

// Input/validation problems: report to the caller without poisoning status.
class ClientError extends Error {}

/* ------------------------------------------------------------------ *
 * Server registry (persisted to data/servers.json)
 * ------------------------------------------------------------------ */

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
function cleanStr(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function parseBrokers(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/:\d+$/.test(s) ? s : `${s}:9092`));
  return [...new Set(parts)].slice(0, 30);
}
function normalizeConfig(input = {}) {
  const rawTopics = Array.isArray(input.recvTopics)
    ? input.recvTopics
    : [input.recvTopic || input.topic || ''];
  return {
    sendTopic: cleanStr(input.sendTopic || input.topic),
    recvTopics: [
      ...new Set(rawTopics.map((t) => cleanStr(t)).filter(Boolean)),
    ].slice(0, TOPIC_LIMIT),
    groupId: cleanStr(input.groupId, 120),
    fromBeginning: input.fromBeginning === true,
  };
}
function normalizeServer(s) {
  const brokers = parseBrokers(s.brokers || s.bootstrap || '');
  return {
    id: cleanStr(s.id, 40) || newId(),
    name: cleanStr(s.name, 60) || brokers[0] || 'Kafka Server',
    brokers,
    config: normalizeConfig(s.config || {}),
    createdAt: Number(s.createdAt) || Date.now(),
  };
}

let registry = [];
const runtimes = new Map();

function ensureRuntime(server) {
  let rt = runtimes.get(server.id);
  if (rt) {
    rt.server = server;
    return rt;
  }
  rt = {
    server,
    kafka: null,
    producer: null,
    admin: null,
    connected: false,
    consumers: new Map(), // topic -> KafkaJS consumer | { demo: true }
    lastError: '',
    buffer: [],
    demoSeq: 0,
  };
  runtimes.set(server.id, rt);
  return rt;
}

function loadRegistry() {
  registry = [];
  try {
    const arr = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
    if (Array.isArray(arr)) {
      registry = arr
        .filter((x) => x && (x.id || x.brokers || x.bootstrap))
        .map(normalizeServer)
        .filter((s) => s.brokers.length);
    }
  } catch (_) { /* first run / broken file */ }
  for (const s of registry) ensureRuntime(s);
}
function saveRegistry() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(registry, null, 2), 'utf8');
  } catch (err) {
    console.error(`[ERROR] 无法保存服务器列表: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * SSE / logging / status
 * ------------------------------------------------------------------ */

const sseClients = new Set();
function emit(type, data) {
  const chunk = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    if (res._blocked) continue; // socket backpressure: skip until drain
    try {
      const ok = res.write(chunk);
      if (!ok) {
        res._blocked = true;
        res.once('drain', () => { res._blocked = false; });
      }
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

const recentLogs = new Map();
function writeLog(rt, level, text) {
  const now = Date.now();
  const key = `${rt.server.id}|${level}|${text}`;
  if (now - (recentLogs.get(key) || 0) < 800) return;
  recentLogs.set(key, now);
  if (recentLogs.size > 300) recentLogs.clear();
  emit('log', { serverId: rt.server.id, level, text, ts: now });
  console.log(`[${rt.server.name}] [${level.toUpperCase().padEnd(5)}] ${text}`);
}

function serverView(rt) {
  return {
    id: rt.server.id,
    name: rt.server.name,
    brokers: rt.server.brokers,
    config: rt.server.config,
    connected: rt.connected,
    subscribedTopics: [...rt.consumers.keys()],
    lastError: rt.lastError,
    msgCount: rt.buffer.length,
    createdAt: rt.server.createdAt,
  };
}
function pushStatus() {
  emit('status', {
    demo: DEMO,
    servers: registry.map((s) => serverView(ensureRuntime(s))),
  });
}
function fail(rt, text) {
  rt.lastError = text;
  writeLog(rt, 'error', text);
  emit('app-error', { serverId: rt.server.id, message: text });
  pushStatus();
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------ *
 * Message batching (one SSE event per 50ms, bounded buffer)
 * ------------------------------------------------------------------ */

let seq = 0;
let messageBuffer = [];
let flushTimer = null;
let droppedMessages = 0;
let lastDropNotice = 0;

function queueMessage(rt, raw) {
  const m = { ...raw, id: ++seq, serverId: rt.server.id };
  rt.buffer.push(m);
  if (rt.buffer.length > MAX_BUFFER) rt.buffer.shift();
  if (messageBuffer.length >= MAX_BUFFER) {
    droppedMessages += 1;
    const now = Date.now();
    if (now - lastDropNotice > 2000) {
      lastDropNotice = now;
      writeLog(rt, 'warn', `消息速率过高，界面已省略 ${droppedMessages} 条（Kafka 数据不受影响；建议取消部分主题订阅或关闭「从最早开始」）`);
    }
    return;
  }
  messageBuffer.push(m);
  if (!flushTimer) flushTimer = setTimeout(flushMessages, FLUSH_MS);
}
function flushMessages() {
  flushTimer = null;
  if (!messageBuffer.length) return;
  const batch = messageBuffer;
  messageBuffer = [];
  emit('kafka-messages', batch);
}

function kafkaMessageToJson({ topic, partition, message }) {
  const headers = {};
  for (const [k, v] of Object.entries(message.headers || {})) {
    headers[k] = Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
  }
  return {
    ts: Date.now(),
    topic,
    partition,
    offset: String(message.offset),
    key: message.key == null ? null : message.key.toString('utf8'),
    value: message.value == null ? '' : message.value.toString('utf8'),
    headers,
    timestamp: message.timestamp ? String(message.timestamp) : null,
  };
}
function demoMessage(rt, topic, value) {
  return {
    ts: Date.now(),
    topic,
    partition: 0,
    offset: String(rt.demoSeq++),
    key: null,
    value,
    headers: { source: 'kafka-desk-demo' },
    timestamp: String(Date.now()),
    demo: true,
  };
}

/* ------------------------------------------------------------------ *
 * Per-server Kafka runtime
 * ------------------------------------------------------------------ */

function getKafka(rt) {
  if (rt.kafka) return rt.kafka;
  rt.kafka = new Kafka({
    clientId: `kafka-desk-${rt.server.id}`,
    brokers: rt.server.brokers,
    connectionTimeout: 8000,
    requestTimeout: 20000,
    retry: { initialRetryTime: 300, retries: 3 },
    logLevel: logLevel.ERROR,
    logCreator: () => (entry) => {
      if (entry.level <= logLevel.WARN) {
        writeLog(rt, entry.level === logLevel.ERROR ? 'error' : 'warn',
          `[${entry.namespace}] ${entry.log.message}`);
      }
    },
  });
  return rt.kafka;
}

async function ensureProducer(rt) {
  if (rt.connected && rt.producer) return rt.producer;
  if (DEMO) {
    rt.connected = true;
    pushStatus();
    return null;
  }
  const next = getKafka(rt).producer();
  try {
    await withTimeout(next.connect(), 15000, '连接 Broker 超时（15s），请检查地址与网络');
  } catch (err) {
    await next.disconnect().catch(() => {});
    throw err;
  }
  rt.producer = next;
  rt.connected = true;
  writeLog(rt, 'info', `已连接 Broker: ${rt.server.brokers.join(', ')}`);
  pushStatus();
  return next;
}

function buildGroupId(rt, topic) {
  const base = rt.server.config.groupId || 'kafka-desk';
  const safe = topic.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return `${base}-${rt.server.id.slice(0, 6)}-${safe}`.slice(0, 200);
}

async function unsubscribeTopics(rt, topics) {
  const removed = [];
  for (const topic of topics) {
    const c = rt.consumers.get(topic);
    if (!c) continue;
    rt.consumers.delete(topic); // marks the run() error as intentional
    if (!c.demo) await c.disconnect().catch(() => {});
    removed.push(topic);
  }
  if (removed.length) {
    flushMessages();
    writeLog(rt, 'info', `已取消订阅: ${removed.join(', ')}`);
    pushStatus();
  }
  return removed;
}

async function subscribeTopics(rt, topics) {
  const added = [];
  for (const topic of topics) {
    if (!topic || rt.consumers.has(topic)) continue;
    if (DEMO) {
      rt.consumers.set(topic, { demo: true });
      queueMessage(rt, demoMessage(rt, topic,
        JSON.stringify({ event: 'subscribed', topic, server: rt.server.name })));
      added.push(topic);
      writeLog(rt, 'info', `演示模式：已"订阅" ${topic}，会持续推送模拟消息`);
      continue;
    }
    const groupId = buildGroupId(rt, topic);
    const c = getKafka(rt).consumer({ groupId, sessionTimeout: 30000 });
    try {
      await withTimeout(c.connect(), 15000, `订阅 ${topic} 超时：连接 Broker 超过 15s`);
      await withTimeout(
        c.subscribe({ topic, fromBeginning: rt.server.config.fromBeginning }),
        15000,
        `订阅 ${topic} 超时：加入消费组超过 15s`
      );
    } catch (err) {
      await c.disconnect().catch(() => {});
      throw err;
    }
    rt.consumers.set(topic, c);
    added.push(topic);
    writeLog(rt, 'info', `订阅开始: ${topic} | group=${groupId} | fromBeginning=${rt.server.config.fromBeginning}`);
    // run() resolves only when the consumer stops: never await it here.
    c.run({
      eachMessage: async (payload) => {
        queueMessage(rt, kafkaMessageToJson(payload));
        // Yield so HTTP requests stay responsive under message floods.
        await new Promise((resolve) => setImmediate(resolve));
      },
    }).catch((err) => {
      if (rt.consumers.get(topic) !== c) return; // intentionally stopped
      rt.consumers.delete(topic);
      fail(rt, `订阅中断 [${topic}]: ${err.message || err}`);
    });
  }
  if (added.length) {
    if (rt.server.config.fromBeginning) {
      writeLog(rt, 'warn', `「从最早开始」已开启，订阅 ${added.join(', ')} 将读取全部历史消息；大主题可能产生大量消息`);
    }
    pushStatus();
  }
  return added;
}

async function teardown(rt) {
  await unsubscribeTopics(rt, [...rt.consumers.keys()]);
  const jobs = [];
  if (rt.producer && typeof rt.producer.disconnect === 'function') {
    jobs.push(rt.producer.disconnect().catch(() => {}));
  }
  if (rt.admin && typeof rt.admin.disconnect === 'function') {
    jobs.push(rt.admin.disconnect().catch(() => {}));
  }
  rt.producer = null;
  rt.admin = null;
  rt.kafka = null;
  rt.connected = false;
  await Promise.all(jobs);
  flushMessages();
  pushStatus();
}

async function listTopics(rt) {
  if (DEMO) {
    const extra = rt.server.config.recvTopics;
    return [...new Set([
      'order.created', 'order.paid', 'order.shipped',
      'user.events', 'notify.sms', 'demo-topic', ...extra,
    ])].sort();
  }
  const a = getKafka(rt).admin();
  rt.admin = a;
  try {
    await withTimeout(a.connect(), 12000, '读取主题超时：连接 Broker 超过 12s');
    const topics = await withTimeout(a.listTopics(), 12000, '读取主题超时：Broker 响应超过 12s');
    return [...new Set([...topics, ...rt.server.config.recvTopics])].sort();
  } finally {
    await a.disconnect().catch(() => {});
    if (rt.admin === a) rt.admin = null;
  }
}

/* ------------------------------------------------------------------ *
 * HTTP API
 * ------------------------------------------------------------------ */

const api = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((err) => {
      const message = err && err.message ? err.message : String(err);
      if (err instanceof ClientError) {
        if (req.rt) writeLog(req.rt, 'warn', message);
        else console.log(`[WARN ] ${message}`);
        return res.status(400).json({ error: message });
      }
      if (req.rt) fail(req.rt, message);
      else console.error(`[ERROR] ${message}`);
      if (!res.headersSent) res.status(500).json({ error: message });
    });

app.param('id', (req, res, next, value) => {
  const rt = runtimes.get(String(value));
  if (!rt) return res.status(404).json({ error: '服务器不存在或已被删除' });
  req.rt = rt;
  next();
});

// Readiness probe used by start.bat.
app.get('/api/status', (req, res) => res.json({
  ok: true,
  demo: DEMO,
  servers: registry.length,
}));

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  sseClients.add(res);
  res.write(`event: status\ndata: ${JSON.stringify({
    demo: DEMO,
    servers: registry.map((s) => serverView(ensureRuntime(s))),
  })}\n\n`);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { /* client gone */ }
  }, 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

/* ---- server registry ---- */

app.get('/api/servers', (req, res) => res.json({
  demo: DEMO,
  servers: registry.map((s) => serverView(ensureRuntime(s))),
}));

app.post('/api/servers', api(async (req, res) => {
  const brokers = parseBrokers(req.body.brokers);
  if (!brokers.length) throw new ClientError('Bootstrap Server 不能为空');
  const name = cleanStr(req.body.name, 60) || brokers[0];
  const server = {
    id: newId(),
    name,
    brokers,
    config: normalizeConfig(req.body.config || {}),
    createdAt: Date.now(),
  };
  registry.push(server);
  const rt = ensureRuntime(server);
  saveRegistry();
  writeLog(rt, 'info', `已添加服务器: ${name} (${brokers.join(', ')})`);
  pushStatus();
  res.json({ server: serverView(rt) });
}));

app.get('/api/servers/:id', api(async (req, res) => {
  res.json({ server: serverView(req.rt), demo: DEMO });
}));

app.put('/api/servers/:id', api(async (req, res) => {
  const rt = req.rt;
  const server = rt.server;
  let brokers = server.brokers;
  if (req.body.brokers !== undefined) {
    brokers = parseBrokers(req.body.brokers);
    if (!brokers.length) throw new ClientError('Bootstrap Server 不能为空');
  }
  const changed = JSON.stringify(brokers) !== JSON.stringify(server.brokers);
  if (changed) await teardown(rt);
  server.brokers = brokers;
  if (req.body.name !== undefined) {
    server.name = cleanStr(req.body.name, 60) || brokers[0];
  }
  if (changed) rt.kafka = null;
  saveRegistry();
  writeLog(rt, 'info', `服务器信息已更新: ${server.name} (${brokers.join(', ')})`);
  pushStatus();
  res.json({ server: serverView(rt) });
}));

app.delete('/api/servers/:id', api(async (req, res) => {
  const rt = req.rt;
  await teardown(rt);
  registry = registry.filter((s) => s.id !== rt.server.id);
  runtimes.delete(rt.server.id);
  saveRegistry();
  pushStatus();
  res.json({ ok: true });
}));

/* ---- per-server config / connection ---- */

app.post('/api/servers/:id/config', api(async (req, res) => {
  const rt = req.rt;
  const prev = rt.server.config;
  const next = normalizeConfig(req.body || {});
  const restart = prev.groupId !== next.groupId || prev.fromBeginning !== next.fromBeginning;
  const active = restart ? [...rt.consumers.keys()] : [];
  if (active.length) await unsubscribeTopics(rt, active);
  rt.server.config = next;
  rt.lastError = '';
  saveRegistry();
  writeLog(rt, 'info', `配置已保存: 发送=${next.sendTopic || '(未设置)'} | 订阅候选=${next.recvTopics.length} 个`);
  pushStatus();
  // Re-attach subscriptions that had to be torn down by the config change.
  if (active.length) {
    subscribeTopics(rt, active).catch((err) => fail(rt, `重新订阅失败: ${err.message || err}`));
  }
  res.json({ server: serverView(rt), resubscribed: active });
}));

app.post('/api/servers/:id/connect', api(async (req, res) => {
  const rt = req.rt;
  rt.lastError = '';
  await ensureProducer(rt);
  writeLog(rt, 'info', DEMO ? '演示模式：模拟连接成功（不连接真实 Kafka）' : '连接成功');
  pushStatus();
  res.json({ server: serverView(rt) });
}));

app.post('/api/servers/:id/disconnect', api(async (req, res) => {
  await teardown(req.rt);
  writeLog(req.rt, 'info', '已断开连接');
  res.json({ server: serverView(req.rt) });
}));

app.get('/api/servers/:id/topics', api(async (req, res) => {
  const topics = await listTopics(req.rt);
  res.json({ topics });
}));

app.get('/api/servers/:id/messages', api(async (req, res) => {
  res.json({ messages: req.rt.buffer });
}));

app.post('/api/servers/:id/send', api(async (req, res) => {
  const rt = req.rt;
  const { key, payload } = req.body || {};
  const target = rt.server.config.sendTopic;
  if (!target) throw new ClientError('请先在左侧配置区填写「发送主题」');
  if (typeof payload !== 'string' || !payload.trim()) throw new ClientError('消息内容不能为空');

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    throw new ClientError(`仅允许发送 JSON：${err.message}`);
  }
  const value = JSON.stringify(parsed);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > 1024 * 1024) throw new ClientError('消息超过 1 MB，可能被 Broker 拒绝');

  const producer = await ensureProducer(rt);
  let metadata;
  if (producer) {
    const result = await producer.send({
      topic: target,
      messages: [{ key: key ? String(key) : null, value }],
    });
    metadata = result[0] || null;
  } else {
    metadata = { topicName: target, partition: 0, baseOffset: String(rt.demoSeq++) };
    const echo = demoMessage(rt, target, value);
    if (key) echo.key = String(key);
    queueMessage(rt, echo);
  }
  writeLog(rt, 'info', `已发送 → ${target}${key ? ` [key=${key}]` : ''} (${bytes} B)`);
  rt.lastError = '';
  pushStatus();
  res.json({ ok: true, topic: target, metadata, bytes });
}));

function topicListFrom(body) {
  const raw = body && body.all === true
    ? null
    : (Array.isArray(body && body.topics) ? body.topics : [body && body.topic]);
  return raw === null
    ? null
    : raw.map((t) => cleanStr(t)).filter(Boolean).slice(0, TOPIC_LIMIT);
}

app.post('/api/servers/:id/subscribe', api(async (req, res) => {
  const topics = topicListFrom(req.body);
  if (!topics || !topics.length) throw new ClientError('请先在左侧勾选要订阅的主题');
  const added = await subscribeTopics(req.rt, topics);
  res.json({ server: serverView(req.rt), added });
}));

app.post('/api/servers/:id/unsubscribe', api(async (req, res) => {
  const rt = req.rt;
  const topics = topicListFrom(req.body) || [...rt.consumers.keys()];
  const removed = await unsubscribeTopics(rt, topics);
  res.json({ server: serverView(rt), removed });
}));

/* ------------------------------------------------------------------ *
 * Static files + error handling + boot
 * ------------------------------------------------------------------ */

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  const message = err && err.type === 'entity.parse.failed'
    ? '请求体不是合法 JSON'
    : (err && err.message) || '请求错误';
  if (!res.headersSent) res.status(400).json({ error: message });
});

loadRegistry();

// Demo mode emits a low-rate sample message per subscribed topic so that
// multi-topic filtering can be exercised without a real broker.
if (DEMO) {
  setInterval(() => {
    for (const rt of runtimes.values()) {
      for (const topic of rt.consumers.keys()) {
        queueMessage(rt, demoMessage(rt, topic, JSON.stringify({
          event: 'demo.tick',
          topic,
          server: rt.server.name,
          at: new Date().toISOString(),
        })));
      }
    }
  }, 6000);
}

app.listen(PORT, HOST, () => {
  console.log(`KafkaDesk running at http://${HOST}:${PORT}${DEMO ? ' (DEMO mode)' : ''} | servers=${registry.length}`);
});
