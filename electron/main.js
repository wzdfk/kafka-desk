'use strict';

/**
 * KafkaDesk desktop shell.
 * ------------------------
 * The Express backend (server.js) is reused verbatim and runs inside the main
 * process on a random loopback port; the renderer is a plain BrowserWindow
 * pointed at that URL. Keeping HTTP instead of file:// means the existing
 * relative `/api/...` fetches and the SSE stream work untouched.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const {
  sha256File, parseChecksum, isTrustedDownload, resolveTarget, buildRunnerScript,
} = require('./update');

const APP_TITLE = 'KafkaDesk';
const IS_DEV = !app.isPackaged;

// Writable data dir: app.asar is read-only, so registries live in userData.
process.env.KAFKA_DESK_DATA =
  process.env.KAFKA_DESK_DATA || path.join(app.getPath('userData'), 'data');

// Serve the Vue3 frontend (web/dist, T9). Works from the source tree and from
// inside app.asar; if the dir is missing, server.js falls back to legacy public/.
process.env.KAFKA_DESK_STATIC =
  process.env.KAFKA_DESK_STATIC || path.join(__dirname, '..', 'web', 'dist');

const { startServer } = require('../server');

/* electron-builder portable 启动器注入的变量指向用户实际运行的外层 exe；
 * process.execPath 指向临时解压副本，绝不能当更新目标。 */
function portableTarget() {
  return process.env.PORTABLE_EXECUTABLE_FILE || null;
}

/* 一次性诊断：打包态把解析结果写到 userData，供 tools/verify-update.js 读取。
 * 探针拿不到变量时，自动更新会降级为「下载后手动替换」。 */
function writePortableProbe() {
  if (!app.isPackaged) return;
  try {
    const out = path.join(app.getPath('userData'), 'portable-probe.json');
    fs.writeFileSync(out, JSON.stringify({
      at: new Date().toISOString(),
      target: portableTarget(),
      execPath: process.execPath,
      version: app.getVersion(),
    }, null, 2));
  } catch { /* userData 不可写时忽略 */ }
}

let mainWindow = null;
let httpServer = null;
let activeDownload = null;

function updatesDir() {
  const dir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:progress', payload);
  }
}

/* 通过 Electron 的下载事件跟踪进度；目标文件写到 userData/updates（asar 只读，不写安装目录）。 */
function downloadExe(url, file) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error('no-window'));
    const ses = mainWindow.webContents.session;
    const handler = (_event, item) => {
      item.setSavePath(file);
      activeDownload = item;
      item.on('updated', (_e, state) => {
        if (state !== 'progressing' || item.isPaused()) return;
        const total = item.getTotalBytes() || 0;
        const received = item.getReceivedBytes();
        sendProgress({
          phase: 'downloading', received, total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
        });
      });
      item.once('done', (_e, state) => {
        ses.removeListener('will-download', handler);
        activeDownload = null;
        if (state === 'completed') resolve(file);
        else reject(new Error(state));
      });
    };
    ses.on('will-download', handler);
    mainWindow.webContents.downloadURL(url);
  });
}

async function verifyChecksum(file, sha256Url) {
  if (!sha256Url || !isTrustedDownload(sha256Url)) return 'checksum-missing';
  sendProgress({ phase: 'verifying', received: 0, total: 0, percent: 100 });
  try {
    const res = await fetch(sha256Url, { headers: { 'User-Agent': 'KafkaDesk-UpdateCheck' } });
    if (!res.ok) return 'checksum-download-failed';
    const expected = parseChecksum(await res.text());
    if (!expected) return 'checksum-invalid';
    return sha256File(file) === expected ? '' : 'checksum-mismatch';
  } catch {
    return 'checksum-download-failed';
  }
}

/* IPC 契约见 electron/preload.js。所有外部 URL 都先过白名单。 */
function registerUpdateIpc() {
  ipcMain.handle('update:capabilities', () => resolveTarget({ isPackaged: app.isPackaged }));

  ipcMain.handle('update:cancel', () => {
    if (activeDownload) activeDownload.cancel();
    return true;
  });

  ipcMain.handle('update:download', async (_event, p) => {
    const url = p && p.url;
    const version = String((p && p.version) || '').replace(/[^\w.\-]/g, '');
    if (!isTrustedDownload(url) || !version) return { ok: false, reason: 'invalid-request' };
    const cap = resolveTarget({ isPackaged: app.isPackaged });
    const file = path.join(updatesDir(), `KafkaDesk-${version}-portable.exe`);
    try {
      try { fs.unlinkSync(file); } catch { /* 首次下载 */ }
      await downloadExe(url, file);
      const bad = await verifyChecksum(file, p.sha256Url);
      if (bad) {
        try { fs.unlinkSync(file); } catch { /* ignore */ }
        return { ok: false, reason: bad };
      }
      return { ok: true, file, degraded: !cap.ok, reason: cap.ok ? '' : cap.reason };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || 'download-failed') };
    }
  });

  ipcMain.handle('update:apply', async (_event, p) => {
    const file = p && p.file;
    const dir = updatesDir();
    if (!file || !path.resolve(file).startsWith(path.resolve(dir))) {
      return { ok: false, reason: 'invalid-file' };
    }
    const cap = resolveTarget({ isPackaged: app.isPackaged });
    if (!cap.ok) return { ok: false, reason: cap.reason };
    if (!fs.existsSync(file)) return { ok: false, reason: 'file-missing' };
    try {
      const backup = `${cap.target}.previous.exe`;
      const script = buildRunnerScript({ target: cap.target, staged: file, backup });
      const scriptPath = path.join(os.tmpdir(), `kafkadesk-update-${Date.now()}.cmd`);
      fs.writeFileSync(scriptPath, script, 'utf8');
      const child = spawn('cmd.exe', ['/c', scriptPath], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
      // 单实例锁：必须等旧进程彻底退出，runner 才会启动新 exe（Q7 场景）。
      setTimeout(() => app.exit(0), 150);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || 'apply-failed') };
    }
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_TITLE,
    backgroundColor: '#0f1319',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
    webPreferences: {
      // The renderer only talks to the local HTTP API; it needs no Node access.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // External links open in the system browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target) && !target.startsWith(url)) {
      shell.openExternal(target);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    }
  });

  mainWindow.loadURL(url);

  if (IS_DEV && process.env.KAFKA_DESK_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

async function boot() {
  const { server, url } = await startServer({ port: 0 });
  httpServer = server;
  createWindow(url);
}

// One app instance == one backend; a second launch focuses the existing window
// (this replaces the /api/status probe that start.bat performs).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    writePortableProbe();
    registerUpdateIpc();
    Menu.setApplicationMenu(null);
    boot().catch((err) => {
      dialog.showErrorBox('KafkaDesk 启动失败', String((err && err.message) || err));
      app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        boot().catch(() => app.quit());
      }
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    if (!httpServer) return;
    if (typeof httpServer.closeAllConnections === 'function') {
      httpServer.closeAllConnections(); // drop live SSE sockets so close() resolves
    }
    httpServer.close();
    httpServer = null;
  });
}
