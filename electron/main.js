'use strict';

/**
 * KafkaDesk desktop shell.
 * ------------------------
 * The Express backend (server.js) is reused verbatim and runs inside the main
 * process on a random loopback port; the renderer is a plain BrowserWindow
 * pointed at that URL. Keeping HTTP instead of file:// means the existing
 * relative `/api/...` fetches and the SSE stream work untouched.
 */

const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');

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

let mainWindow = null;
let httpServer = null;

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
