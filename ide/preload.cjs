// YANG IDE preload — renderer faqat shu oshkor API'lar orqali main bilan gaplashadi.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('ide', {
  // --- papka (workspace) ---
  init: () => ipcRenderer.invoke('yide:init'),
  pickFolder: () => ipcRenderer.invoke('yide:pick-folder'),
  openFolder: (path) => ipcRenderer.invoke('yide:open-folder', { path }),

  // --- fayllar ---
  listTree: (rel = '.', depth = 3) => ipcRenderer.invoke('yide:list-tree', { rel, depth }),
  readFile: (path, maxBytes) => ipcRenderer.invoke('yide:read-file', { path, maxBytes }),
  writeFile: (path, content) => ipcRenderer.invoke('yide:write-file', { path, content }),
  create: (path, dir = false) => ipcRenderer.invoke('yide:create', { path, dir }),
  rename: (from, to) => ipcRenderer.invoke('yide:rename', { from, to }),
  remove: (path) => ipcRenderer.invoke('yide:delete', { path }),
  search: (query, caseSensitive = false) => ipcRenderer.invoke('yide:search', { query, caseSensitive }),
  openExternal: (path) => ipcRenderer.invoke('yide:open-external', { path }),
  saveTabs: (tabs) => ipcRenderer.invoke('yide:save-tabs', { tabs }),

  // --- til xizmati / ishga tushirish ---
  diagnostics: (path) => ipcRenderer.invoke('yide:diagnostics', { path }),
  runCommand: (command, cwd) => ipcRenderer.invoke('yide:run-command', { command, cwd }),
  runFile: (path) => ipcRenderer.invoke('yide:run-file', { path }),
  killCommand: (id) => ipcRenderer.invoke('yide:kill-command', { id }),
  errorLinks: (text) => ipcRenderer.invoke('yide:error-links', { text }),

  // --- AI ---
  aiStatus: () => ipcRenderer.invoke('yide:ai-status'),
  aiSetModel: (provider, model) => ipcRenderer.invoke('yide:ai-set-model', { provider, model }),
  aiRun: (prompt, team = false) => ipcRenderer.invoke('yide:ai-run', { prompt, team }),
  aiStop: () => ipcRenderer.invoke('yide:ai-stop'),

  sysInfo: () => ipcRenderer.invoke('yide:sys-info'),

  // --- HAQIQIY terminal (PTY): vim/top/ssh kabi interaktiv dasturlar ishlaydi ---
  ptyInfo: () => ipcRenderer.invoke('yide:pty-info'),
  ptyOpen: (opts = {}) => ipcRenderer.invoke('yide:pty-open', opts),
  ptyWrite: (id, data) => ipcRenderer.invoke('yide:pty-write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.invoke('yide:pty-resize', { id, cols, rows }),
  ptyClose: (id) => ipcRenderer.invoke('yide:pty-close', { id }),
  ptyList: () => ipcRenderer.invoke('yide:pty-list'),

  // --- Til xizmati (tsserver): semantik xato, ta'rif, havolalar, hover ---
  lspStatus: () => ipcRenderer.invoke('yide:lsp-status'),
  lspDiagnostics: (path, text) => ipcRenderer.invoke('yide:lsp-diagnostics', { path, text }),
  lspDefinition: (path, line, col, text) => ipcRenderer.invoke('yide:lsp-definition', { path, line, col, text }),
  lspReferences: (path, line, col, text) => ipcRenderer.invoke('yide:lsp-references', { path, line, col, text }),
  lspHover: (path, line, col, text) => ipcRenderer.invoke('yide:lsp-hover', { path, line, col, text }),

  // --- Qadamlab debugger (nuqtalar, stack, o'zgaruvchilar) ---
  debugStatus: () => ipcRenderer.invoke('yide:debug-status'),
  debugStart: (path, breakpoints, stopOnEntry) => ipcRenderer.invoke('yide:debug-start', { path, breakpoints, stopOnEntry }),
  debugSetBreakpoints: (breakpoints) => ipcRenderer.invoke('yide:debug-breakpoints', { breakpoints }),
  debugResume: () => ipcRenderer.invoke('yide:debug-resume'),
  debugPause: () => ipcRenderer.invoke('yide:debug-pause'),
  debugStep: (kind) => ipcRenderer.invoke('yide:debug-step', { kind }),
  debugStop: () => ipcRenderer.invoke('yide:debug-stop'),
  debugEval: (expression, callFrameId) => ipcRenderer.invoke('yide:debug-eval', { expression, callFrameId }),

  // --- Ishga tushirish + TARIX (log) + «sinab ko'r va tuzat» halqasi ---
  runCaptured: (path, cwd) => ipcRenderer.invoke('yide:run-captured', { path, cwd }),
  runLog: () => ipcRenderer.invoke('yide:run-log'),
  runStop: (id) => ipcRenderer.invoke('yide:run-stop', { id }),
  fixRun: (path, maxAttempts) => ipcRenderer.invoke('yide:fix-run', { path, maxAttempts }),
  fixStop: () => ipcRenderer.invoke('yide:fix-stop'),
  fixBusy: () => ipcRenderer.invoke('yide:fix-busy'),

  // --- hodisalar ---
  onTermData: (cb) => on('yide:term-data', cb),
  onTermExit: (cb) => on('yide:term-exit', cb),
  onPtyData: (cb) => on('yide:pty-data', cb),
  onPtyExit: (cb) => on('yide:pty-exit', cb),
  onDebugPaused: (cb) => on('yide:debug-paused', cb),
  onDebugResumed: (cb) => on('yide:debug-resumed', cb),
  onDebugOutput: (cb) => on('yide:debug-output', cb),
  onDebugExit: (cb) => on('yide:debug-exit', cb),
  onRunFinished: (cb) => on('yide:run-finished', cb),
  onRunLogged: (cb) => on('yide:run-logged', cb),
  onFixEvent: (cb) => on('yide:fix-event', cb),
  onFsChanged: (cb) => on('yide:fs-changed', cb),
  onAiEvent: (cb) => on('yide:ai-event', cb),
  onNotice: (cb) => on('yide:notice', cb),
});
