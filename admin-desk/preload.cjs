// admin-desk/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSetup: () => ipcRenderer.invoke('setup:get'),
  saveSetup: (patch) => ipcRenderer.invoke('setup:save', patch),
  discoverChat: () => ipcRenderer.invoke('tg:discover'),
  pollInbox: () => ipcRenderer.invoke('inbox:poll'),
  markAnswered: (updateId) => ipcRenderer.invoke('inbox:markAnswered', updateId),
  pullConfig: () => ipcRenderer.invoke('cfg:pull'),
  pushConfig: (config, message) => ipcRenderer.invoke('cfg:push', { config, message }),
  publishSupport: (mode, relayUrl) => ipcRenderer.invoke('support:publish', { mode, relayUrl }),
  tgReply: (chatId, text) => ipcRenderer.invoke('tg:reply', { chatId, text }),
  uploadImage: (name, dataB64) => ipcRenderer.invoke('gh:upload-image', { name, dataB64 }),
  answerSend: (installId, chatId, text) => ipcRenderer.invoke('answer:send', { installId, chatId, text }),
  blockToggle: (installId, blocked) => ipcRenderer.invoke('block:toggle', { installId, blocked }),
  stats: () => ipcRenderer.invoke('stats:summary'),
  releaseStatus: () => ipcRenderer.invoke('release:status'),
  // Reliz tekshiruvi: versiya manbalari (repo/lokal/paket) ↔ reliz tegi ↔ majburiy fayllar.
  releaseVerify: () => ipcRenderer.invoke('release:verify'),
  // Yon panel uchun: Desk versiyasi va lokal ilova versiyasi (qattiq yozilmaydi).
  deskInfo: () => ipcRenderer.invoke('desk:info'),
  // Mahalliy app-config.json: ko'rish va to'g'ridan-to'g'ri nashr qilish.
  localCfgPreview: () => ipcRenderer.invoke('cfg:local-preview'),
  pushLocalConfig: (message) => ipcRenderer.invoke('cfg:push-local', { message }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
