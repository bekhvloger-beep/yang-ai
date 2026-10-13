// YANG IDE preload — renderer faqat shu oshkor API'lar orqali main bilan gaplashadi.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('ide', {
  // --- papka (workspace) ---
  init: () => ipcRenderer.invoke('ide:init'),
  pickFolder: () => ipcRenderer.invoke('ide:pick-folder'),
  openFolder: (path) => ipcRenderer.invoke('ide:open-folder', { path }),

  // --- fayllar ---
  listTree: (rel = '.', depth = 3) => ipcRenderer.invoke('ide:list-tree', { rel, depth }),
  readFile: (path, maxBytes) => ipcRenderer.invoke('ide:read-file', { path, maxBytes }),
  writeFile: (path, content) => ipcRenderer.invoke('ide:write-file', { path, content }),
  create: (path, dir = false) => ipcRenderer.invoke('ide:create', { path, dir }),
  rename: (from, to) => ipcRenderer.invoke('ide:rename', { from, to }),
  remove: (path) => ipcRenderer.invoke('ide:delete', { path }),
  search: (query, caseSensitive = false) => ipcRenderer.invoke('ide:search', { query, caseSensitive }),
  openExternal: (path) => ipcRenderer.invoke('ide:open-external', { path }),
  saveTabs: (tabs) => ipcRenderer.invoke('ide:save-tabs', { tabs }),

  // --- til xizmati / ishga tushirish ---
  diagnostics: (path) => ipcRenderer.invoke('ide:diagnostics', { path }),
  runCommand: (command, cwd) => ipcRenderer.invoke('ide:run-command', { command, cwd }),
  runFile: (path) => ipcRenderer.invoke('ide:run-file', { path }),
  killCommand: (id) => ipcRenderer.invoke('ide:kill-command', { id }),
  errorLinks: (text) => ipcRenderer.invoke('ide:error-links', { text }),

  // --- AI ---
  aiStatus: () => ipcRenderer.invoke('ide:ai-status'),
  aiSetModel: (provider, model) => ipcRenderer.invoke('ide:ai-set-model', { provider, model }),
  aiRun: (prompt, team = false) => ipcRenderer.invoke('ide:ai-run', { prompt, team }),
  aiStop: () => ipcRenderer.invoke('ide:ai-stop'),

  sysInfo: () => ipcRenderer.invoke('ide:sys-info'),

  // --- hodisalar ---
  onTermData: (cb) => on('ide:term-data', cb),
  onTermExit: (cb) => on('ide:term-exit', cb),
  onFsChanged: (cb) => on('ide:fs-changed', cb),
  onAiEvent: (cb) => on('ide:ai-event', cb),
  onNotice: (cb) => on('ide:notice', cb),
});
