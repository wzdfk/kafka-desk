'use strict';

/* 最小桥接层：渲染进程 sandbox:true / contextIsolation:true，只允许这 5 个能力。
 * 版本检查仍由渲染进程直接 fetch GitHub（Q2），不经过 IPC。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopUpdate', {
  isDesktop: true,
  capabilities: () => ipcRenderer.invoke('update:capabilities'),
  onProgress(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  download: (payload) => ipcRenderer.invoke('update:download', payload),
  cancel: () => ipcRenderer.invoke('update:cancel'),
  apply: (payload) => ipcRenderer.invoke('update:apply', payload),
});
