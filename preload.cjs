// preload.cjs — secure bridge between renderer and main.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  importEnv: () => ipcRenderer.invoke('config:import-env'),
  pickEnvFile: () => ipcRenderer.invoke('dialog:pick-env'),
  pickWorkspace: () => ipcRenderer.invoke('dialog:pick-workspace'),
  openPath: (p) => ipcRenderer.invoke('shell:open-path', p),
  showItem: (p) => ipcRenderer.invoke('shell:show-item', p),
  clearKeys: () => ipcRenderer.invoke('config:clear-keys'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  getRemoteConfig: () => ipcRenderer.invoke('config:remote'),
  getClientId: () => ipcRenderer.invoke('client:id'),
  supportSend: (text) => ipcRenderer.invoke('support:send', { text }),
  supportOpenTelegram: () => ipcRenderer.invoke('support:open-telegram'),

  listChats: () => ipcRenderer.invoke('chats:list'),
  newChat: (payload) => ipcRenderer.invoke('chats:new', payload),
  loadChat: (id) => ipcRenderer.invoke('chats:load', id),
  deleteChat: (id) => ipcRenderer.invoke('chats:delete', id),
  setChatWorkspace: (chatId, workspace) => ipcRenderer.invoke('chats:set-workspace', { chatId, workspace }),

  run: (chatId, text, opts) => ipcRenderer.invoke('run', { chatId, text, images: opts?.images, team: opts?.team, planFirst: opts?.planFirst, planText: opts?.planText }),
  approve: (approvalId, ok) => ipcRenderer.invoke('run:approve', { approvalId, ok }),
  stop: () => ipcRenderer.invoke('run:stop'),
  pickAttachments: () => ipcRenderer.invoke('attach:pick'),
  parseAttachmentPaths: (paths) => ipcRenderer.invoke('attach:parse-paths', paths),
  checkQuota: () => ipcRenderer.invoke('quota:check'),
  scanLocal: () => ipcRenderer.invoke('local:scan'),
  fetchProviderModels: (base, key) => ipcRenderer.invoke('providers:fetch-models', { base, key }),
  // Rasm faylini preview uchun data-URL qilib olish (tool kartasi va jamoa panelida).
  readDataUrl: (p) => ipcRenderer.invoke('file:data-url', p),
  // v5 IDE: fayl mazmunini to'g'ridan-to'g'ri o'qish (IDE ko'ruvchi).
  readWorkspaceFile: (p, maxBytes) => ipcRenderer.invoke('ide:read-file', { path: p, maxBytes }),
  // v5 IDE: terminal buyrug'ini bevosita bajarish (IDE terminal paneli).
  ideRunCommand: (command, cwd) => ipcRenderer.invoke('ide:run-command', { command, cwd }),
  // v5 IDE: workspace fayl daraxti. `rel` nisbiy (asosiy papkaga) yoki ABSOLYUT
  // (qo'shimcha papka ichidagi yo'l) bo'lishi mumkin — main jarayon baribir realpath
  // bo'yicha ruxsat etilgan ildizlar ichida ekanini tekshiradi.
  ideListTree: (rel, depth) => ipcRenderer.invoke('ide:list-tree', { rel, depth }),
  // v5.5 ko'p ildizli workspace: qo'shimcha papkalar ro'yxati / qo'shish / olib tashlash.
  ideRootsList: () => ipcRenderer.invoke('ide:roots-list'),
  ideRootsAdd: () => ipcRenderer.invoke('ide:roots-add'),
  ideRootsRemove: (p) => ipcRenderer.invoke('ide:roots-remove', { path: p }),
  // v5.1 IDE tahrirlovchi: workspace faylini saqlash + tashqari ilovada ochish.
  ideSaveFile: (p, content) => ipcRenderer.invoke('ide:save-file', { path: p, content }),
  ideOpenExternal: (p) => ipcRenderer.invoke('ide:open-external', { path: p }),
  // v5.3: to'liq YANG IDE oynasini ochish (asosiy ilova ichida ishlaydi).
  openIde: () => ipcRenderer.invoke('ide:open-window'),
  ideWindowOpen: () => ipcRenderer.invoke('ide:window-open'),
  // v5.4: yon panelning HAQIQIY terminali (xterm + ConPTY). Kanal nomlari IDE yadrosi
  // bilan bir xil (`yide:pty-*`): main jarayon ularni ide_host.js orqali allaqachon
  // ro'yxatga olgan, shu sabab bu yerda faqat ko'prik ochiladi — ikkinchi manba yo'q.
  ptyInfo: () => ipcRenderer.invoke('yide:pty-info'),
  ptyOpen: (opts = {}) => ipcRenderer.invoke('yide:pty-open', opts),
  ptyWrite: (id, data) => ipcRenderer.invoke('yide:pty-write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.invoke('yide:pty-resize', { id, cols, rows }),
  ptyClose: (id) => ipcRenderer.invoke('yide:pty-close', { id }),
  ptyList: () => ipcRenderer.invoke('yide:pty-list'),
  // ---------------------------------------------------------------- LOKAL AI menejeri (v5.6)
  // Model bozori, apparat profili, yuklab olish, kompyuterda bor AI skani, «O'lchash»
  // (4 haqiqiy vazifa) va lokal rasm generatsiyasi. Mantiq IDE bilan UMUMIY modulda
  // (`ide/ide_models.js`) va asosiy jarayonda allaqachon ro'yxatga olingan:
  // `main.js` → `registerIdeIpc()` → `registerModelsIpc(...)`. Shu sabab bu yerda faqat
  // ko'prik ochiladi va kanallar qayta e'lon QILINMAYDI (ikkinchi `handle` xato beradi).
  hardware: (refresh = false) => ipcRenderer.invoke('yide:hw-profile', { refresh }),
  modelsCatalog: () => ipcRenderer.invoke('yide:models-catalog'),
  modelsDownload: (id) => ipcRenderer.invoke('yide:models-download', { id }),
  modelsCancel: (id) => ipcRenderer.invoke('yide:models-cancel', { id }),
  modelsRemove: (id) => ipcRenderer.invoke('yide:models-remove', { id }),
  modelsReveal: (id) => ipcRenderer.invoke('yide:models-reveal', { id }),
  modelsExternal: () => ipcRenderer.invoke('yide:models-external'),
  modelsAttach: (provider, model, base) => ipcRenderer.invoke('yide:models-attach', { provider, model, base }),
  modelsMeasure: (id, tasks) => ipcRenderer.invoke('yide:models-measure', { id, tasks }),
  modelsBenchState: () => ipcRenderer.invoke('yide:models-bench-state'),
  imageStatus: () => ipcRenderer.invoke('yide:image-status'),
  imageGenerate: (opts) => ipcRenderer.invoke('yide:image-generate', opts || {}),
  imageStop: () => ipcRenderer.invoke('yide:image-stop'),
  // Progress hodisalari yadro tomonidan IDE oynasiga yuboriladi; asosiy oyna holatni
  // SO'ROV bilan (modelsCatalog/modelsBenchState) yangilaydi — lekin hodisa kelsa
  // ham qabul qilamiz (kelajakda yadro manzilni kengaytirsa, qo'shimcha o'zgarish kerak emas).
  onModelProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('yide:model-progress', listener);
    return () => ipcRenderer.removeListener('yide:model-progress', listener);
  },
  onModelBench: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('yide:model-bench', listener);
    return () => ipcRenderer.removeListener('yide:model-bench', listener);
  },

  // v5 rasm menyu: o'zbekcha prompt bo'lsa inglizchaga o'giriladi, so'ng rasm chiziladi.
  imageStudio: (promptUz, quality) => ipcRenderer.invoke('image:studio', { prompt: promptUz, quality }),
  translateStatus: () => ipcRenderer.invoke('translate:status'),
  translateTest: (text) => ipcRenderer.invoke('translate:test', text),
  getProviderPresets: () => ipcRenderer.invoke('provider-presets'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  },

  // v5.4: PTY oqimi (terminal chiqishi) va sessiya tugashi.
  onPtyData: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('yide:pty-data', listener);
    return () => ipcRenderer.removeListener('yide:pty-data', listener);
  },
  onPtyExit: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('yide:pty-exit', listener);
    return () => ipcRenderer.removeListener('yide:pty-exit', listener);
  },

  onEvent: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  onChatSaved: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('chat_saved', listener);
    return () => ipcRenderer.removeListener('chat_saved', listener);
  },
  onRemoteConfig: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('remote_config', listener);
    return () => ipcRenderer.removeListener('remote_config', listener);
  },
  // Menyudan («Lokal AI → Lokal AI menejeri») modal ochish buyrug'i.
  onOpenModels: (cb) => {
    const listener = (_e, data) => cb(data || {});
    ipcRenderer.on('ui:open-models', listener);
    return () => ipcRenderer.removeListener('ui:open-models', listener);
  },
  // Kodlash rejimi menyudan yoqilganda renderer holatni yangilaydi.
  onCodingMode: (cb) => {
    const listener = (_e, data) => cb(data || {});
    ipcRenderer.on('coding_mode', listener);
    return () => ipcRenderer.removeListener('coding_mode', listener);
  },
});
