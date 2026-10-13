/* app.js — renderer logic (vanilla JS, no build step) */
'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  chatList: $('chatList'), newChatBtn: $('newChatBtn'), settingsBtn: $('settingsBtn'),
  wsChip: $('wsChip'), wsName: $('wsName'), modelChip: $('modelChip'), modelName: $('modelName'),
  quotaChip: $('quotaChip'), quotaText: $('quotaText'),
  chatScroll: $('chatScroll'), messages: $('messages'), emptyState: $('emptyState'),
  input: $('input'), sendBtn: $('sendBtn'), stopBtn: $('stopBtn'), statusLine: $('statusLine'),
  attachBtn: $('attachBtn'), teamBtn: $('teamBtn'), attachRow: $('attachRow'), dragOverlay: $('dragOverlay'),
  settingsModal: $('settingsModal'), settingsClose: $('settingsClose'), settingsSave: $('settingsSave'),
  providerSelect: $('providerSelect'), modelInput: $('modelInput'), modelList: $('modelList'), modelFetchBtn: $('modelFetchBtn'), modelFetchResult: $('modelFetchResult'), pinModelToggle: $('pinModelToggle'),
  keyFields: $('keyFields'), importEnvBtn: $('importEnvBtn'), pickEnvBtn: $('pickEnvBtn'), importResult: $('importResult'),
  customProviderList: $('customProviderList'), npName: $('npName'), npBase: $('npBase'), npModels: $('npModels'), npKey: $('npKey'), npVision: $('npVision'), npAdd: $('npAdd'), npFetch: $('npFetch'), presetRow: $('presetRow'),
  quotaList: $('quotaList'), quotaCheckBtn: $('quotaCheckBtn'),
  customBaseUrl: $('customBaseUrl'), customUrlField: $('customUrlField'), autoApprove: $('autoApprove'),
  settingsWs: $('settingsWs'), settingsWsBtn: $('settingsWsBtn'),
  appVersion: $('appVersion'), updateStatus: $('updateStatus'), updateCheckBtn: $('updateCheckBtn'), updateInstallBtn: $('updateInstallBtn'),
  // ---- 3-bosqich: premium interfeys elementlari ----
  agentNow: $('agentNow'), agentAvatar: $('agentAvatar'), agentNameNow: $('agentNameNow'), agentRoleNow: $('agentRoleNow'),
  quotaRing: $('quotaRing'), ringFg: $('ringFg'), ringText: $('ringText'),
  dockToggle: $('dockToggle'), dock: $('dock'), dockFeed: $('dockFeed'), dockAgents: $('dockAgents'),
  dockClose: $('dockClose'), dockDisable: $('dockDisable'), dockLive: $('dockLive'),
  planBtn: $('planBtn'), buildBtn: $('buildBtn'),
  bbModel: $('bbModel'), bbModelName: $('bbModelName'), bbTeam: $('bbTeam'), bbMode: $('bbMode'), bbHint: $('bbHint'),
  modelPop: $('modelPop'), setTabs: $('setTabs'),
  connectTestBtn: $('connectTestBtn'), connectSaveBtn: $('connectSaveBtn'), connectResult: $('connectResult'),
  transEnabled: $('transEnabled'), transUrl: $('transUrl'), transTarget: $('transTarget'),
  transStatusBtn: $('transStatusBtn'), transTestBtn: $('transTestBtn'), transResult: $('transResult'),
  uiPanelToggle: $('uiPanelToggle'), uiAnimToggle: $('uiAnimToggle'), uiStepsToggle: $('uiStepsToggle'),
  uiAdToggle: $('uiAdToggle'), uiPanelSide: $('uiPanelSide'), quickModels: $('quickModels'),
  switchFx: $('switchFx'), fxLabel: $('fxLabel'), fxSub: $('fxSub'),
};

/* ---------------- UI sozlamalari (Interfeys bo'limi) ---------------- */
// Panelni yig'ish/o'chirish, animatsiyalar va qadam kartalari — localStorage'da saqlanadi.
const UI = {
  panel: localStorage.getItem('yang_ui_panel') !== '0',
  anim: localStorage.getItem('yang_ui_anim') !== '0',
  stepsInChat: localStorage.getItem('yang_ui_steps') !== '0',
  ads: localStorage.getItem('yang_ui_ads') !== '0',
  side: localStorage.getItem('yang_ui_side') || 'right',
};
function saveUiPref(key, val) {
  localStorage.setItem(key, val ? '1' : '0');
}
function applyUiPrefs() {
  if (!els.dock) return;
  els.dock.classList.toggle('collapsed', !UI.panel);
  els.dockToggle.classList.toggle('on', UI.panel);
  els.dock.style.order = UI.side === 'left' ? '-1' : '';
  if (els.uiPanelToggle) els.uiPanelToggle.checked = UI.panel;
  if (els.uiAnimToggle) els.uiAnimToggle.checked = UI.anim;
  if (els.uiStepsToggle) els.uiStepsToggle.checked = UI.stepsInChat;
  if (els.uiAdToggle) els.uiAdToggle.checked = UI.ads;
  if (els.uiPanelSide) els.uiPanelSide.value = UI.side;
  document.body.classList.toggle('no-anim', !UI.anim);
}

let cfg = null; // {config, providers}
let currentChat = null;
let appVersionStr = ''; // masofaviy minVersion taqqoslash uchun
let lastCreated = []; // agent oxirgi javobda yaratgan fayllari
let running = false;
let teamMode = false;
let pendingAttachments = []; // {name, kind:'image'|'doc'|'error', dataUrl?, text?}
let liveNode = null;
let liveText = '';
let toolCards = new Map();
let teamPipeline = null; // {el, agents:Map}
let teamActive = false;
let sessionUsage = { input: 0, output: 0 };
let pinned = true;
let currentAgent = { icon: '', name: 'YANG AI', role: 'tayyor' };
let agentIcons = new Map(); // jamoa rejimi: agent nomi → ikonka
let lastQuota = null; // tepadagi aylana progress uchun oxirgi limit holati
let lastTask = ''; // Plan → Qurishni boshlash uchun asl vazifa
let planPending = null; // tasdiqlangan reja matni (Build bosilganda uzatiladi)
let planMode = false; // Plan tugmasi tanlangan bo'lsa — keyingi so'rov reja tuzadi

window.__ready = false;
window.__openChat = openChat; // smoke-test uchun
window.__smokeState = () => ({
  assistantMessages: document.querySelectorAll('.msg-assistant').length,
  toolCards: document.querySelectorAll('.tool-card').length,
  userMessages: document.querySelectorAll('.msg-user').length,
  errors: document.querySelectorAll('.msg-error').length,
});
// Sinov ilgagi (CDP/smoke testlari) — faqat o'qish/ko'rsatish uchun sayoz API.
// Xatti-harakatga ta'sir qilmaydi; v4 UI sinovi (scripts/ui_v4_test.mjs) shundan foydalanadi.
window.__uiHook = {
  startThinkingCard, closeThinkingCard, makeToolCard, updateToolCard, addPlanCard,
  dockPush, setQuotaRing, setCurrentAgent, resetCurrentAgent, switchFx, renderAdDrop,
  // Hodisa oqimidagi tool kartasi yo'lini aynan takrorlaydi (CDP sinovi uchun).
  simulateToolCard: ({ id, tool, args, result, ok, ms, files, agent, at }) => {
    const card = makeToolCard({ id, tool, args, status: 'run', agent, at });
    toolCards.set(id, card);
    updateToolCard({ id, tool, args, result, ok, ms, files, agent });
  },
};

/* ---------------- utilities ---------------- */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMd(esc) {
  return esc
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}

function mdToHtml(src) {
  const lines = String(src).split('\n');
  const html = [];
  let list = null;
  let para = [];
  const flushList = () => {
    if (list) {
      html.push(`<${list.tag}>` + list.items.map((x) => `<li>${x}</li>`).join('') + `</${list.tag}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(inlineMd).join('<br />')}</p>`);
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*(\w*)\s*$/);
    if (fence) {
      flushPara(); flushList();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      html.push(`<pre><span class="code-lang">${escapeHtml(fence[1] || '')}</span><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const t = line.trim();
    if (!t) { flushPara(); flushList(); continue; }
    const esc = escapeHtml(t);
    const h = esc.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); flushList(); html.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`); continue; }
    if (/^[-*]\s+/.test(t)) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(inlineMd(esc.replace(/^[-*]\s+/, ''))); continue; }
    if (/^\d+\.\s+/.test(t)) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(inlineMd(esc.replace(/^\d+\.\s+/, ''))); continue; }
    flushList();
    para.push(esc);
  }
  flushPara(); flushList();
  return html.join('');
}

// 2-bosqich: har harakat uchun ikonka va o'qiladigan nom.
// Thinking · Read · Write · Run/Code · Internet · Python · Image
const TOOL_META = {
  run_command: { icon: '', label: 'Buyruq', kind: 'run' },
  write_file: { icon: '', label: 'Yozish', kind: 'write' },
  edit_file: { icon: '', label: 'Tahrir', kind: 'write' },
  read_file: { icon: '', label: 'O‘qish', kind: 'read' },
  list_dir: { icon: '', label: 'Papka', kind: 'read' },
  search_files: { icon: '', label: 'Qidiruv', kind: 'read' },
  extract_file: { icon: '', label: 'Ajratish', kind: 'read' },
  create_document: { icon: '', label: 'Hujjat', kind: 'doc' },
  create_image: { icon: '', label: 'Rasm', kind: 'image' },
  generate_image: { icon: '', label: 'AI rasm', kind: 'image' },
  web_search: { icon: '', label: 'Internet qidiruv', kind: 'web' },
  fetch_url: { icon: '', label: 'Sahifa ochish', kind: 'web' },
};
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;

// Python buyrug'ini aniqlash (Python kartasi uchun).
function isPythonCommand(cmd) {
  return /(^|[\s;&|])(python|python3|py)(\s|$)/i.test(String(cmd || '')) || /\.py(\s|$|")/i.test(String(cmd || ''));
}
function toolKind(tool, args) {
  const meta = TOOL_META[tool] || { icon: '', label: tool, kind: 'run' };
  if (tool === 'run_command' && isPythonCommand(args && args.command)) return 'python';
  return meta.kind || 'run';
}
function toolIcon(tool, args) {
  const kind = toolKind(tool, args);
  if (kind === 'python') return '';
  return (TOOL_META[tool] || { icon: '' }).icon;
}
function toolLabel(tool, args) {
  const kind = toolKind(tool, args);
  if (kind === 'python') return 'Python';
  return (TOOL_META[tool] || { label: tool }).label;
}
function toolSummary(tool, args) {
  const a = args || {};
  switch (tool) {
    case 'run_command': return a.command;
    case 'search_files': return a.pattern;
    case 'create_document': return a.path;
    case 'create_image': return `${a.path} ${a.width || '?'}x${a.height || '?'}`;
    case 'generate_image': return a.path || a.prompt;
    case 'web_search': return a.query;
    case 'fetch_url': return a.url;
    case 'list_dir': case 'read_file': case 'write_file': case 'edit_file': case 'extract_file': return a.path;
    default: return JSON.stringify(a).slice(0, 80);
  }
}
// Kartani bosganda nima ko'rinadi — "nima o'qidi / yozdi / qidirdi" to'liq tafsiloti.
function toolDetailItems(tool, args) {
  const a = args || {};
  const items = [];
  if (tool === 'write_file' || tool === 'edit_file') {
    const content = tool === 'write_file' ? a.content : a.new_string;
    if (typeof content === 'string') items.push({ kind: 'code', label: tool === 'write_file' ? `Fayl mazmuni (${content.length} belgi, ${content.split('\n').length} qator)` : 'Yangi matn', text: content.slice(0, 4000) });
    if (tool === 'edit_file' && typeof a.old_string === 'string') items.push({ kind: 'code', label: 'Almashtirilgan matn', text: a.old_string.slice(0, 2000) });
    if (a.path) items.push({ kind: 'file', path: a.path });
  }
  if (a.path && tool !== 'write_file' && tool !== 'edit_file') items.push({ kind: 'file', path: a.path });
  return items;
}

function agentBadgeClass(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 60%, 55%)`;
}
function agentBadge(name) {
  const color = agentBadgeClass(name);
  // Jamoa rejimida agent ikonkasi ham ko'rsatiladi (nom + ikon).
  const icon = agentIcons.get(name) || '';
  return `<span class="agent-badge" style="--ac:${color}">${icon} ${escapeHtml(name)}</span>`;
}

/* ---------------- jonli faoliyat chizig'i (Codebuff uslubida) ----------------
   Agent aynan nimani bajaryotganini — qaysi papka/fayl ochilgani, qaysi buyruq
   bajarilayotgani va qaysi model ishlayotganini status chizig'ida ko'rsatadi. */
function toolActivity(tool, args, done) {
  const mark = done === undefined ? '…' : (done ? ' ✓' : ' ✖');
  const a = args || {};
  switch (tool) {
    case 'list_dir': return `${a.path || '.'} papkasi ko‘rilmoqda${mark}`;
    case 'read_file': return `${a.path || ''} o‘qilmoqda${mark}`;
    case 'write_file': return `${a.path || ''} yozilmoqda${mark}`;
    case 'edit_file': return `${a.path || ''} tahrirlanmoqda${mark}`;
    case 'search_files': return `“${String(a.pattern || '').slice(0, 40)}” qidirilmoqda${mark}`;
    case 'run_command': return `${String(a.command || '').slice(0, 50)}${mark}`;
    case 'extract_file': return `${a.path || ''} matni ajratilmoqda${mark}`;
    case 'create_document': return `${a.path || ''} yaratilmoqda${mark}`;
    case 'create_image': return `${a.path || ''} chizilmoqda${mark}`;
    case 'generate_image': return `AI rasm yaratilmoqda${mark}`;
    default: return `${tool}${mark}`;
  }
}
function activityLine(icon, text) {
  els.statusLine.textContent = `${icon ? icon + ' ' : ''}${text}${usageLine()}`;
}

/* ---------------- tepadagi agent ko'rsatkichi ---------------- */
// Avatar — brend belgisi (hexagon). Agent nomi/roli yonidagi matnda ko'rinadi.
const HEX_AVATAR = '<svg class="ico ico-hex"><use href="#i-hex"></use></svg>';
function setCurrentAgent(icon, name, role) {    currentAgent = { icon: icon || '', name: name || 'YANG AI', role: role || '' };
  if (!els.agentAvatar) return;
  els.agentAvatar.innerHTML = HEX_AVATAR;
  els.agentNameNow.textContent = currentAgent.name;
  els.agentRoleNow.textContent = currentAgent.role || 'ishlamoqda…';
  els.agentNow.classList.add('working');
}
function resetCurrentAgent() {
  if (!els.agentAvatar) return;
  const prov = (cfg && cfg.providers && cfg.providers[cfg.config.provider]) || {};
  els.agentAvatar.innerHTML = HEX_AVATAR;
  els.agentNameNow.textContent = 'YANG AI';
  els.agentRoleNow.textContent = prov.name ? `${prov.name} · tayyor` : 'tayyor';
  els.agentNow.classList.remove('working');
}

/* ---------------- aylana limit progressi (tepadagi) ---------------- */
// Foiz ma'lum bo'lsa to'ldiramiz; faqat matn bo'lsa aylanani neytral ko'rsatamiz.
function setQuotaRing({ percent, text, title }) {
  if (!els.ringFg) return;
  const CIRC = 94.2;
  const p = typeof percent === 'number' && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  els.ringFg.style.strokeDashoffset = String(p == null ? CIRC : CIRC - (CIRC * p) / 100);
  els.ringText.textContent = text != null ? String(text).slice(0, 5) : (p == null ? '—' : `${Math.round(p)}%`);
  els.quotaRing.classList.toggle('low', p != null && p < 20);
  els.quotaRing.classList.toggle('mid', p != null && p >= 20 && p < 50);
  if (title) els.quotaRing.title = title;
}

/* ---------------- o'ng faoliyat paneli (3-bosqich) ---------------- */
// Har bir harakat shu panelga jonli tushadi: ikonka, nom, tafsilot, agent va davomiylik.
let dockSeq = 0;
const dockEls = new Map();

function dockPush({ id, icon, title, sub, agent, state, ms }) {
  if (!els.dockFeed) return null;
  const key = id || `d_${++dockSeq}`;
  let el = dockEls.get(key);
  if (!el) {
    el = document.createElement('div');
    el.className = 'dock-item';
    el.innerHTML = `<span class="di-icon"></span><div class="di-body"><div class="di-title"></div><div class="di-sub"></div><div class="di-meta"><span class="di-agent"></span><span class="di-time"></span></div></div>`;
    dockEls.set(key, el);
    els.dockFeed.appendChild(el);
    els.dockFeed.scrollTop = els.dockFeed.scrollHeight;
    while (els.dockFeed.children.length > 220) {
      const first = els.dockFeed.firstElementChild;
      if (!first) break;
      for (const [k, v] of dockEls) if (v === first) dockEls.delete(k);
      first.remove();
    }
  }
  el.querySelector('.di-icon').textContent = icon || '•';
  el.querySelector('.di-title').textContent = title || '';
  const subEl = el.querySelector('.di-sub');
  subEl.textContent = sub || '';
  subEl.style.display = sub ? '' : 'none';
  const agEl = el.querySelector('.di-agent');
  agEl.textContent = agent ? String(agent) : '';
  agEl.style.display = agent ? '' : 'none';
  el.querySelector('.di-time').textContent = ms != null ? `${ms} ms` : '';
  el.classList.remove('ok', 'bad', 'run');
  if (state) el.classList.add(state);
  return el;
}
function dockUpdate(id, patch) {
  const el = dockEls.get(id);
  if (!el) return;
  if (patch.state) {
    el.classList.remove('ok', 'bad', 'run');
    el.classList.add(patch.state);
  }
  if (patch.ms != null) el.querySelector('.di-time').textContent = `${patch.ms} ms`;
  if (patch.sub != null) {
    const subEl = el.querySelector('.di-sub');
    subEl.textContent = patch.sub;
    subEl.style.display = patch.sub ? '' : 'none';
  }
}
function dockClear() {
  if (!els.dockFeed) return;
  els.dockFeed.innerHTML = '';
  dockEls.clear();
}
// Jamoa rejimi: agentlar ro'yxati panelda (nomi + ikonkasi + modeli + holati).
const dockAgents = new Map();
function dockAgentUpsert(name, { icon, role, model, state } = {}) {
  if (!els.dockAgents) return null;
  let row = dockAgents.get(name);
  if (!row) {
    row = document.createElement('div');
    row.className = 'dock-agent';
    row.innerHTML = `<span class="da-icon"></span><span class="da-name"></span><span class="da-model"></span><span class="da-state">…</span>`;
    row.querySelector('.da-name').textContent = name;
    dockAgents.set(name, row);
    els.dockAgents.appendChild(row);
  }
  if (icon) row.querySelector('.da-icon').textContent = icon;
  if (role) row.title = role;
  if (model) row.querySelector('.da-model').textContent = model;
  if (state) row.querySelector('.da-state').textContent = state;
  return row;
}
function dockAgentState(name, state) {
  const row = dockAgents.get(name);
  if (!row) return;
  row.querySelector('.da-state').textContent = state;
  if (state === '✓') { row.classList.remove('active'); row.classList.add('done'); }
  if (state === '⚙') { row.classList.add('active'); row.classList.remove('done'); }
}
function dockAgentsClear() {
  if (els.dockAgents) els.dockAgents.innerHTML = '';
  dockAgents.clear();
}
function dockLive(text, busy) {
  if (!els.dockLive) return;
  els.dockLive.textContent = text || '';
  els.dockLive.classList.toggle('busy', !!busy);
}
// Agentning jonli matni (jamoa rejimida) — bitta element yangilanadi.
const agentStreams = new Map();
function agentStreamAppend(agent, text) {
  const name = agent || 'Agent';
  let buf = agentStreams.get(name) || '';
  buf += text;
  if (buf.length > 4000) buf = buf.slice(-4000);
  agentStreams.set(name, buf);
  const lastLine = buf.split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '…';
  dockPush({
    id: `agent_stream_${name}`,      icon: agentIcons.get(name) || '',
    title: `${name} yozmoqda…`,
    sub: lastLine.slice(0, 180),
    agent: name,
    state: 'run',
  });
}
function agentStreamDone(agent, chars) {
  const name = agent || 'Agent';
  dockUpdate(`agent_stream_${name}`, { state: 'ok', sub: `${chars || (agentStreams.get(name) || '').length} belgi javob` });
  agentStreams.delete(name);
}


function scrollPin() {
  if (pinned) els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
}
els.chatScroll.addEventListener('scroll', () => {
  const el = els.chatScroll;
  pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
});

/* ---------------- rendering ---------------- */
function addUserBubble(text, images) {
  els.emptyState.classList.add('hidden');
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  let html = escapeHtml(text).replace(/\n/g, '<br />');
  for (const img of images || []) html += `<div class="user-img"><img src="${img}" alt="biriktirilgan rasm" /></div>`;
  div.innerHTML = html;
  els.messages.appendChild(div);
  scrollPin();
}

function addAssistantNode(agent) {
  const div = document.createElement('div');
  div.className = 'msg msg-assistant';
  div.innerHTML = `<div class="who">${agent ? agentBadge(agent) : 'AGENT'}</div><div class="md"><span class="cursor"></span></div>`;
  els.messages.appendChild(div);
  liveNode = div;
  liveText = '';
  scrollPin();
  return div;
}

function setLiveText(text) {
  liveText = text || '';
  if (liveNode) {
    liveNode.querySelector('.md').innerHTML = mdToHtml(liveText) + '<span class="cursor"></span>';
    scrollPin();
  }
}

function finalizeAssistant(text, agent) {
  const finalText = text != null ? text : liveText;
  if (liveNode) {
    if (agent && !liveNode.dataset.agentSet) {
      liveNode.querySelector('.who').innerHTML = agentBadge(agent);
      liveNode.dataset.agentSet = '1';
    }
    // Diqqat: mdToHtml() HTML'ni ekranlaydi (escape) — shuning uchun bo'sh javob
    // o'rni belgisini unga uzatmaymiz, to'g'ridan-to'g'ri qo'yamiz.
    liveNode.querySelector('.md').innerHTML = finalText
      ? mdToHtml(finalText)
      : '<span class="dim">javob kutilmadi</span>';
  } else {
    const div = document.createElement('div');
    div.className = 'msg msg-assistant';
    div.innerHTML = `<div class="who">${agent ? agentBadge(agent) : 'AGENT'}</div><div class="md">${mdToHtml(finalText || '')}</div>`;
    els.messages.appendChild(div);
  }
  // Agent fayl yaratgan bo'lsa — ochish/papkada ko'rsatish tugmalari
  if (!teamActive && lastCreated.length) {
    const host = liveNode || els.messages.lastElementChild;
    if (host) {
      const row = document.createElement('div');
      row.className = 'file-actions';
      const ws = (currentChat && currentChat.workspace) || '';
      for (const p of lastCreated.slice(-6)) {
        const abs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') ? p : (ws ? ws.replace(/[\\/]+$/, '') + '\\' + p.replace(/[\\/]+$/, '') : p);
        const name = String(p).split(/[\\/]/).pop();
        const b1 = document.createElement('button');
        b1.className = 'btn btn-ghost small';
        b1.textContent = name;
        b1.title = 'Faylni ochish';
        b1.addEventListener('click', () => api.openPath(abs));
        const b2 = document.createElement('button');
        b2.className = 'btn btn-ghost small';
        b2.innerHTML = '<svg class="ico"><use href="#i-folder"></use></svg>';
        b2.title = 'Papkada ko\'rsatish';
        b2.addEventListener('click', () => api.showItem(abs));
        row.appendChild(b1);
        row.appendChild(b2);
      }
      host.appendChild(row);
    }
    lastCreated = [];
  }
  liveNode = null;
  liveText = '';
  scrollPin();
}

function addNotice(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-notice';
  div.textContent = 'ℹ ' + text;
  els.messages.appendChild(div);
  scrollPin();
}

function addError(message) {
  const div = document.createElement('div');
  div.className = 'msg msg-error';
  div.textContent = '✖ ' + message;
  els.messages.appendChild(div);
  scrollPin();
}

// Workspace ichidagi nisbiy yo'lni to'liq yo'lga aylantiradi (faylni ochish uchun).
function absPath(p) {
  if (!p) return '';
  const s = String(p);
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/')) return s;
  const ws = (currentChat && currentChat.workspace) || (cfg && cfg.config.lastWorkspace) || '';
  if (!ws) return s;
  return ws.replace(/[\\/]+$/, '') + '\\' + s.replace(/^[\\/]+/, '').replace(/\//g, '\\');
}

function fileButtons(host, paths, { preview = false, token = null } = {}) {
  const row = document.createElement('div');
  row.className = 'file-actions';
  for (const p of paths || []) {
    const abs = absPath(p);
    const name = String(p).split(/[\\/]/).pop();
    const b1 = document.createElement('button');
    b1.className = 'btn btn-ghost small';
    b1.textContent = name;
    b1.title = 'Faylni ochish';
    b1.addEventListener('click', () => api.openPath(abs));
    const b2 = document.createElement('button');
    b2.className = 'btn btn-ghost small';
    b2.innerHTML = '<svg class="ico"><use href="#i-folder"></use></svg>'; b2.title = 'Papkada ko‘rsatish';
    b2.addEventListener('click', () => api.showItem(abs));
    row.appendChild(b1); row.appendChild(b2);
    if (preview && IMAGE_EXT.test(name)) appendImagePreview(host, abs, name, token);
  }
  if (row.children.length) host.appendChild(row);
}

// Rasm natijasini to'g'ridan-to'g'ri ochib ko'rsatish (Python/rasm natijasi).
// token: karta qayta chizilgan bo'lsa (async o'qish kechiksa) ikkinchi nusxa qo'shilmasin.
async function appendImagePreview(host, abs, name, token = null) {
  try {
    const dataUrl = await api.readDataUrl(abs);
    if (!dataUrl) return;
    if (token != null && host.dataset.fillToken !== token) return;
    if (!host.isConnected) return;
    const wrap = document.createElement('div');
    wrap.className = 'file-preview';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = name;
    img.title = 'Ochish uchun bosing';
    img.addEventListener('click', () => api.openPath(abs));
    img.addEventListener('error', () => wrap.remove());
    img.style.cursor = 'pointer';
    const meta = document.createElement('div');
    meta.className = 'fp-meta';
    meta.innerHTML = `<span class="fp-name">${escapeHtml(name)}</span><span class="fp-hint">Natija — ochish uchun bosing</span>`;
    wrap.appendChild(img); wrap.appendChild(meta);
    host.appendChild(wrap);
  } catch {}
}

// Mini brauzer: internetdan ma'lumot olishda nima qidirayotgani ko'rinadi.
function miniBrowser({ url, query, results, text, loading, title }) {
  const box = document.createElement('div');
  box.className = 'mini-browser';
  const bar = document.createElement('div');
  bar.className = 'mb-bar';
  bar.innerHTML = `<span class="mb-dots"><i></i><i></i><i></i></span><span class="mb-url"></span><span class="mb-loading"></span>`;
  bar.querySelector('.mb-url').textContent = query ? String(query) : (url || 'about:blank');
  bar.querySelector('.mb-url').title = url || query || '';
  if (loading) bar.querySelector('.mb-loading').textContent = 'yuklanmoqda…';
  box.appendChild(bar);
  const body = document.createElement('div');
  body.className = 'mb-body';
  if (results && results.length) {
    for (const r of results.slice(0, 6)) {
      const a = document.createElement('a');
      a.className = 'mb-result';
      a.href = '#';
      a.innerHTML = `<span class="mb-title"></span><span class="mb-link"></span><span class="mb-snippet"></span>`;
      a.querySelector('.mb-title').textContent = r.title || r.url;
      a.querySelector('.mb-link').textContent = r.url;
      if (r.snippet) a.querySelector('.mb-snippet').textContent = r.snippet.slice(0, 220);
      a.addEventListener('click', (e) => { e.preventDefault(); api.openExternal(r.url); });
      body.appendChild(a);
    }
  } else if (text) {
    const t = document.createElement('div');
    t.className = 'mb-snippet';
    if (title) { const h = document.createElement('b'); h.textContent = title; body.appendChild(h); }
    t.textContent = text.slice(0, 1400);
    body.appendChild(t);
  } else if (!loading) {
    const d = document.createElement('div'); d.className = 'dim'; d.textContent = 'Natija yo‘q';
    body.appendChild(d);
  }
  box.appendChild(body);
  return box;
}

// Qidiruv natijasi matnidan ro'yxatni ajratib oladi (engine formati).
function parseSearchResults(result) {
  const out = [];
  let cur = null;
  for (const line of String(result || '').split('\n')) {
    const m = line.match(/^\s*\d+\.\s+(.+?)\s+—\s+(https?:\/\/\S+)\s*$/);
    if (m) { cur = { title: m[1], url: m[2], snippet: '' }; out.push(cur); continue; }
    if (cur && /^\s{2,}\S/.test(line)) cur.snippet = (cur.snippet ? cur.snippet + ' ' : '') + line.trim();
  }
  return out;
}
function parseFetchedPage(result) {
  const s = String(result || '');
  // Belgili sarlavha (eski format) yoki oddiy "Title:"/"Source:" — ikkisi ham qabul qilinadi,
  // shunda vosita chiqishi emoji'siz bo'lsa ham karta to'g'ri to'ladi.
  const title = (s.match(/^(?:📄|Title:)\s*(.*)$/m) || [])[1] || '';
  const url = (s.match(/^(?:🔗|Source:)\s*(\S+)\s*$/m) || [])[1] || '';
  const text = s.split(/^---$/m)[1] || '';
  return { title, url, text: text.trim() };
}

/* ---------------- Thinking kartasi (2-bosqich) ---------------- */
let thinkingCard = null;
function startThinkingCard({ label, agent, at }) {
  closeThinkingCard();
  if (!UI.stepsInChat) { dockPush({ id: 'thinking_live', icon: '', title: label || 'Fikrlayapman…', sub: '', agent, state: 'run' }); return; }
  const card = document.createElement('div');
  card.className = 'step-card';
  card.innerHTML = `
    <div class="step-head">
      <span class="sc-ico"></span>
      <span class="sc-label">Thinking</span>
      <span class="sc-sub"></span>
      ${agent ? agentBadge(agent) : ''}
      <span class="sc-state">fikrlayapti…</span>
    </div>
    <div class="step-body"></div>`;
  card.querySelector('.sc-sub').textContent = label || '';
  card.querySelector('.step-head').addEventListener('click', () => card.classList.toggle('open'));
  const body = card.querySelector('.step-body');
  body.innerHTML = `<div class="lbl">Model</div><pre>${escapeHtml((cfg && cfg.providers && cfg.providers[cfg.config.provider]) ? `${cfg.providers[cfg.config.provider].name} · ${cfg.config.model}` : cfg.config.model)}</pre><div class="lbl">Holat</div><pre>Kontekst yig‘ilmoqda — model javobi kutilmoqda…</pre>`;
  els.messages.appendChild(card);
  scrollPin();
  thinkingCard = { el: card, at: at || Date.now() };
}
function closeThinkingCard(ok = true) {
  if (!thinkingCard) { dockUpdate('thinking_live', { state: ok ? 'ok' : 'bad' }); return; }
  const { el, at } = thinkingCard;
  el.classList.add(ok ? 'final' : 'bad');
  el.querySelector('.sc-state').textContent = ok ? `✓ ${Date.now() - at} ms` : '✖ xato';
  thinkingCard = null;
}

function makeToolCard({ id, tool, args, status, agent, at }) {
  const kind = toolKind(tool, args);
  const card = document.createElement('div');
  card.className = `tool-card kind-${kind}` + (status === 'approval' ? ' approval' : '');
  card.dataset.toolCallId = id || '';
  card.dataset.tool = tool || '';
  card.dataset.at = String(at || Date.now());
  card.innerHTML = `
    <div class="tool-head">
      <span class="t-icon">${toolIcon(tool, args)}</span>
      <span class="t-name">${escapeHtml(toolLabel(tool, args))}</span>
      <span class="t-sum">${escapeHtml(toolSummary(tool, args) || '')}</span>
      ${agent ? agentBadge(agent) : ''}
      <span class="t-ms"></span>
      <span class="t-status ${status === 'ok' ? 'ok' : status === 'bad' ? 'bad' : 'run'}">${status === 'ok' ? '✓' : status === 'bad' ? '✖' : status === 'approval' ? '… ruxsat' : '…'}</span>
    </div>
    <div class="tool-body"></div>`;
  card.querySelector('.tool-head').addEventListener('click', () => card.classList.toggle('open'));
  fillToolBody(card, args, null, { files: [] });
  // Qadam kartalari chatda ko'rsatiladi (Interfeys sozlamasida o'chirilishi mumkin) —
  // panelda esa har doim ko'rinadi.
  if (UI.stepsInChat || status === 'approval') { els.messages.appendChild(card); scrollPin(); }
  return card;
}

function fillToolBody(card, args, result, opts = {}) {
  const body = card.querySelector('.tool-body');
  if (!body) return;
  const tool = card.dataset.tool || '';
  body.innerHTML = '';
  // Har chizishda yangi token — kechikkan async rasm preview eski nusxani qo'shmasligi uchun.
  const token = String(Date.now()) + Math.random().toString(36).slice(2, 6);
  body.dataset.fillToken = token;
  const addLbl = (t) => { const l = document.createElement('div'); l.className = 'lbl'; l.textContent = t; body.appendChild(l); };
  const addPre = (t) => { const p = document.createElement('pre'); p.textContent = t; body.appendChild(p); };
  if (args != null) {
    addLbl('So‘rov');
    addPre(JSON.stringify(args, null, 2).slice(0, 6000));
  }
  // Fayl/rasm natijasini ochib ko'rsatish (python, rasm, yozish).
  const madeFiles = Array.isArray(opts.files) ? opts.files.filter(Boolean) : [];
  const pathArg = args && args.path ? [String(args.path)] : [];
  const revealFiles = [...new Set([...madeFiles, ...(madeFiles.length ? [] : pathArg)])];
  if (result != null && tool === 'web_search') {
    addLbl('Internet natijalari (mini brauzer)');
    body.appendChild(miniBrowser({ query: args && args.query, results: parseSearchResults(result), text: result }));
  } else if (result != null && tool === 'fetch_url') {
    const page = parseFetchedPage(result);
    addLbl('Sahifa (mini brauzer)');
    body.appendChild(miniBrowser({ url: (args && args.url) || page.url, title: page.title, text: page.text, loading: false }));
  }
  if (result != null) {
    addLbl('Natija');
    addPre(String(result).slice(0, 6000));
  }
  // Yozilgan fayl mazmuni (nima yozdi — to'liq tafsilot).
  for (const d of toolDetailItems(tool, args)) {
    if (d.kind === 'code') { addLbl(d.label); addPre(d.text); }
  }
  if (revealFiles.length) {
    addLbl(madeFiles.length ? 'Yaratilgan/o‘zgargan fayllar' : 'Fayl');
    fileButtons(body, revealFiles, { preview: true, token });
  }
  // Faylni ochish tugmalari (o'qish/qidiruv natijalari uchun ham).
  if (!revealFiles.length && args && (args.path || args.sub_path)) {
    addLbl('Fayl');
    fileButtons(body, [args.path || args.sub_path], { preview: false, token });
  }
}

function updateToolCard({ id, tool, args, result, ok, denied, agent, ms, files }) {
  let card = toolCards.get(id);
  if (!card) card = makeToolCard({ id, tool, args, status: ok ? 'ok' : 'bad', agent });
  fillToolBody(card, args, result, { files });
  const st = card.querySelector('.t-status');
  if (denied) { st.textContent = 'rad etildi'; st.className = 't-status bad'; }
  else if (ok) { st.textContent = '✓'; st.className = 't-status ok'; }
  else { st.textContent = '✖ xato'; st.className = 't-status bad'; }
  if (ms != null) card.querySelector('.t-ms').textContent = `${ms} ms`;
  if (!ok) card.classList.add('bad');
  card.classList.add('final');
  toolCards.delete(id);
}

/* ---------------- 4-bosqich: reja kartasi ---------------- */
function addPlanCard({ steps, text, task }) {
  const div = document.createElement('div');
  div.className = 'plan-card clickable';
  const list = (steps && steps.length) ? steps : null;
  div.innerHTML = `
    <div class="plan-head"><span class="pl-tag">PLAN</span><span>Reja tayyor — tasdiqlang</span></div>
    <div class="plan-steps"></div>
    <div class="plan-actions"></div>`;
  const stepsHost = div.querySelector('.plan-steps');
  if (list) {
    list.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'plan-step';
      row.innerHTML = `<span class="ps-n">${i + 1}</span><span></span>`;
      row.querySelector('span:last-child').textContent = s;
      stepsHost.appendChild(row);
    });
  } else {
    const d = document.createElement('div'); d.className = 'dim'; d.textContent = String(text || '').slice(0, 400);
    stepsHost.appendChild(d);
  }
  const actions = div.querySelector('.plan-actions');
  const buildBtn = document.createElement('button');
  buildBtn.className = 'btn btn-primary';
  buildBtn.textContent = 'Qurishni boshlash';
  buildBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startBuild(list ? list.map((s, i) => `${i + 1}. ${s}`).join('\n') : String(text || ''), task);
  });
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost';
  editBtn.textContent = 'Rejani tahrirlash uchun nusxalash';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.input.value = list ? list.map((s, i) => `${i + 1}. ${s}`).join('\n') : String(text || '');
    autosize(); els.input.focus();
  });
  actions.appendChild(buildBtn);
  actions.appendChild(editBtn);
  div.addEventListener('click', () => startBuild(list ? list.map((s, i) => `${i + 1}. ${s}`).join('\n') : String(text || ''), task));
  els.messages.appendChild(div);
  scrollPin();
  return div;
}

// "Qurishni boshlash" — tasdiqlangan reja bilan darhol qurish.
async function startBuild(planText, task) {
  if (running) { addNotice('Agent band — avval joriy vazifa tugashini kuting.'); return; }
  const t = task || lastTask;
  if (!t) { addNotice('Reja uchun vazifa topilmadi — vazifani qayta yozing.'); return; }
  planPending = planText;
  els.input.value = t;
  autosize();
  await send({ planText: planText });
}

function addApprovalCard({ approvalId, tool, args, agent }) {
  const card = makeToolCard({ id: approvalId, tool, args, status: 'approval', agent });
  card.classList.add('open');
  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const yes = document.createElement('button');
  yes.className = 'btn btn-primary'; yes.textContent = '✓ Ruxsat berish';
  const no = document.createElement('button');
  no.className = 'btn btn-danger'; no.textContent = '✕ Rad etish';
  yes.addEventListener('click', async () => {
    actions.remove();
    const st = card.querySelector('.t-status'); st.textContent = '… bajarilmoqda'; st.className = 't-status run';
    await api.approve(approvalId, true);
  });
  no.addEventListener('click', async () => {
    actions.remove();
    const st = card.querySelector('.t-status'); st.textContent = 'rad etildi'; st.className = 't-status bad';
    await api.approve(approvalId, false);
  });
  actions.appendChild(yes); actions.appendChild(no);
  card.appendChild(actions);
  scrollPin();
}

/* team pipeline card */
function addTeamPlanCard(agents, task) {
  const div = document.createElement('div');
  div.className = 'team-card';
  div.innerHTML = `<div class="team-head">Agentlar jamoasi <span class="dim">parallel · ${(agents || []).length} agent</span></div>
    <div class="team-task">${escapeHtml(String(task || '').slice(0, 140))}</div>
    <div class="team-agents"></div>`;
  const wrap = div.querySelector('.team-agents');
  const map = new Map();
  for (const a of agents || []) {
    const row = document.createElement('div');
    row.className = 'team-agent';
    row.innerHTML = `<span class="ta-icon">${a.icon || ''}</span><span class="ta-name">${escapeHtml(a.name)}</span><span class="ta-role">${escapeHtml(a.role || '')}</span><span class="ta-model"></span><span class="ta-status">…</span>`;
    map.set(a.name, row);
    wrap.appendChild(row);
  }
  els.messages.appendChild(div);
  teamPipeline = { el: div, map };
  teamActive = true;
  scrollPin();
}
function setTeamAgentModel(agentName, providerName, model) {
  if (!teamPipeline) return;
  const row = teamPipeline.map.get(agentName);
  if (row) {
    row.querySelector('.ta-model').textContent = `${providerName} · ${model}`;
    row.querySelector('.ta-model').title = `${providerName} · ${model}`;
  }
}
function setTeamAgentActive(name, model) {
  if (!teamPipeline) return;
  const row = teamPipeline.map.get(name);
  if (row) {
    row.classList.add('active');
    row.querySelector('.ta-status').textContent = 'ishlayapti';
    if (model) row.querySelector('.ta-model').textContent = model;
  }
  const divider = document.createElement('div');
  divider.className = 'agent-divider';
  divider.innerHTML = agentBadge(name);
  els.messages.appendChild(divider);
  scrollPin();
}
function setTeamAgentDone(name, summary) {
  if (!teamPipeline) return;
  const row = teamPipeline.map.get(name);
  if (row) { row.classList.remove('active'); row.classList.add('done'); row.querySelector('.ta-status').textContent = '✓'; row.title = String(summary || '').slice(0, 400); }
}

function renderAllEvents(events) {
  els.messages.innerHTML = '';
  liveNode = null; liveText = ''; toolCards.clear(); teamPipeline = null; teamActive = false;
  if (!events || !events.length) { showEmpty(true); return; }
  showEmpty(false);
  for (const e of events) {
    if (e.type === 'user') addUserBubble(e.text, e.images);
    else if (e.type === 'assistant') { addAssistantNode(e.agent); finalizeAssistant(e.text, e.agent); }
    else if (e.type === 'team_plan') addTeamPlanCard(e.agents, e.task);
    else if (e.type === 'team_assign') setTeamAgentModel(e.agent, e.provider, e.model);
    else if (e.type === 'agent_begin') setTeamAgentActive(e.name, e.model);
    else if (e.type === 'agent_end') setTeamAgentDone(e.name, e.summary);
    else if (e.type === 'team_done') { teamActive = false; }
    else if (e.type === 'plan') addPlanCard({ steps: e.steps, text: e.text, task: e.task });
    else if (e.type === 'tool') updateToolCard({ id: e.id, tool: e.tool, args: e.args, result: e.result, ok: e.ok, denied: e.denied, agent: e.agent, ms: e.ms, files: e.files });
    else if (e.type === 'error') addError(e.message);
  }
  pinned = true;
  scrollPin();
}

function showEmpty(show) {
  els.emptyState.classList.toggle('hidden', !show);
}

/* ---------------- chat management ---------------- */
async function refreshChatList() {
  const chats = await api.listChats();
  els.chatList.innerHTML = '';
  for (const c of chats) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (currentChat && currentChat.id === c.id ? ' active' : '');
    item.innerHTML = `<svg class="ico ci"><use href="#i-chat"></use></svg><span class="t"></span><button class="del" title="O‘chirish"><svg class="ico"><use href="#i-trash"></use></svg></button>`;
    item.querySelector('.t').textContent = c.title;
    item.addEventListener('click', async () => {
      if (running) return;
      await openChat(c.id);
      refreshChatList();
    });
    item.querySelector('.del').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (running) return;
      await api.deleteChat(c.id);
      if (currentChat && currentChat.id === c.id) { currentChat = null; renderAllEvents([]); }
      refreshChatList();
    });
    els.chatList.appendChild(item);
  }
}

async function openChat(id) {
  currentChat = await api.loadChat(id);
  toolCards.clear();
  dockClear();
  dockAgentsClear();
  agentStreams.clear();
  agentIcons.clear();
  for (const e of currentChat.events || []) {
    if (e.type === 'team_plan') for (const a of e.agents || []) if (a && a.name && a.icon) agentIcons.set(a.name, a.icon);
  }
  renderAllEvents(currentChat.events);
  updateChips();
  resetCurrentAgent();
}

function updateChips() {
  const ws = (currentChat && currentChat.workspace) || (cfg.config.lastWorkspace) || '—';
  els.wsName.textContent = ws;
  els.wsName.title = ws;
  const prov = (cfg.providers && cfg.providers[cfg.config.provider]) || {};
  els.modelName.textContent = `${prov.name || cfg.config.provider} · ${cfg.config.model}`;
  updateBottomBar();
}

/* ---------------- attachments ---------------- */
function renderAttachRow() {
  els.attachRow.innerHTML = '';
  els.attachRow.classList.toggle('hidden', !pendingAttachments.length);
  pendingAttachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip' + (a.kind === 'error' ? ' err' : '');
    const chipIco = a.kind === 'image' ? '#i-image' : a.kind === 'error' ? '' : '#i-doc';
    chip.innerHTML = `${a.kind === 'error' ? '⚠' : `<svg class="ico"><use href="${chipIco}"></use></svg>`}<span>${escapeHtml(a.name)}</span><button class="rm">✕</button>`;
    chip.querySelector('.rm').addEventListener('click', () => {
      pendingAttachments.splice(i, 1);
      renderAttachRow();
    });
    if (a.kind === 'image' && a.dataUrl) chip.title = a.name;
    els.attachRow.appendChild(chip);
  });
}

async function addAttachmentFiles(paths) {
  const parsed = await api.parseAttachmentPaths(paths);
  for (const p of parsed) {
    if (p.kind === 'error') addNotice(`${p.name}: ${p.text}`);
    else pendingAttachments.push(p);
  }
  renderAttachRow();
}

els.attachBtn.addEventListener('click', async () => {
  const picked = await api.pickAttachments();
  for (const p of picked) {
    if (p.kind === 'error') addNotice(`${p.name}: ${p.text}`);
    else pendingAttachments.push(p);
  }
  renderAttachRow();
});

/* drag & drop */
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; els.dragOverlay.classList.remove('hidden'); });
document.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; els.dragOverlay.classList.add('hidden'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dragOverlay.classList.add('hidden');
  const paths = [...(e.dataTransfer.files || [])].map((f) => f.path).filter(Boolean);
  if (paths.length) await addAttachmentFiles(paths);
});

/* paste image */
document.addEventListener('paste', (e) => {
  const items = [...((e.clipboardData && e.clipboardData.items) || [])];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const blob = it.getAsFile();
      if (!blob) continue;
      const reader = new FileReader();
      reader.onload = () => {
        pendingAttachments.push({ name: 'clipboard-image.png', kind: 'image', mime: it.type, dataUrl: reader.result });
        renderAttachRow();
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
      return;
    }
  }
});

/* ---------------- send / run ---------------- */
function setRunningUI(on) {
  els.sendBtn.disabled = on;
  els.stopBtn.classList.toggle('hidden', !on);
  els.planBtn.disabled = on;
  els.buildBtn.disabled = on;
  els.statusLine.textContent = on ? (teamMode ? 'Jamoa ishlayapti…' : (planMode ? 'Reja tuzilmoqda…' : 'Agent ishlayapti…')) : '';
  dockLive(on ? (planMode ? 'reja tuzilmoqda…' : 'ishlayapti…') : 'tayyor', on);
  if (!on) {
    document.querySelectorAll('.tool-head .t-status.run, .step-card .sc-state').forEach((el) => {
      if (el.textContent === '…' || el.textContent === 'fikrlayapti…') el.textContent = '✓';
    });
  }
}

async function send(opts = {}) {
  if (running) return;
  let text = els.input.value.trim();
  const images = pendingAttachments.filter((a) => a.kind === 'image' && a.dataUrl).map((a) => a.dataUrl);
  const docs = pendingAttachments.filter((a) => a.kind === 'doc' && a.text);
  if (!text && !images.length && !docs.length) return;
  if (!currentChat) {
    currentChat = await api.newChat({ workspace: cfg.config.lastWorkspace });
    updateChips();
    refreshChatList();
  }
  // 4-bosqich: Plan rejimi (reja tuzadi) yoki Build (darhol bajaradi).
  const usePlan = opts.planFirst != null ? !!opts.planFirst : planMode;
  const approvedPlan = opts.planText || null;
  // doc attachments appended to the message text
  for (const d of docs) {
    text += `\n\nBiriktirilgan fayl: ${d.name}\n--- fayl mazmuni boshlanishi ---\n${d.text}\n--- fayl mazmuni tugashi ---`;
  }
  if (!text) text = images.length ? 'Rasmni tahlil qilib, nima ekanini va unda nima yozilganini batafsil tushuntir.' : '';
  const useTeam = teamMode && !usePlan;
  const displayName = els.input.value.trim() || `(${docs.length} fayl, ${images.length} rasm)`;
  lastTask = displayName;

  running = true;
  setRunningUI(true);
  if (useTeam) {
    teamActive = true;
    dockAgentsClear();
    agentStreams.clear();
    agentIcons.clear();
  }
  setCurrentAgent(usePlan ? '' : (useTeam ? '' : ''), usePlan ? 'Planner' : (useTeam ? 'Jamoa' : 'YANG AI'), usePlan ? 'reja tuzmoqda' : 'ishlamoqda');
  dockPush({ id: `task_${Date.now()}`, icon: usePlan ? '' : (useTeam ? '' : ''), title: displayName.slice(0, 160), sub: usePlan ? 'reja rejimi' : (useTeam ? 'jamoa rejimi' : 'agent'), state: 'run' });
  addUserBubble(displayName, images);
  els.input.value = '';
  autosize();
  pendingAttachments = [];
  renderAttachRow();
  addAssistantNode();
  try {
    await api.run(currentChat.id, text, {
      images: images.length ? images : undefined,
      team: useTeam,
      planFirst: usePlan || undefined,
      planText: approvedPlan || undefined,
    });
  } catch (e) {
    addError(e && e.message ? e.message : String(e));
    if (liveNode) finalizeAssistant('');
  } finally {
    running = false;
    setRunningUI(false);
    teamPipeline = null;
    planPending = null;
    closeThinkingCard();
    resetCurrentAgent();
    refreshChatList();
  }
}

/* ---------------- events from main ---------------- */
// Bo'sh (matnsiz) jonli javob tuguni qolib ketmasin — jamoa rejimida agent almashtirganda.
function dropLiveIfEmpty() {
  if (liveNode && !liveText.trim()) {
    liveNode.remove();
    liveNode = null;
    liveText = '';
  }
}

window.api.onEvent(({ chatId, event }) => {
  try { ideOnAgentEvent(event); } catch {}
  if (!currentChat || chatId !== currentChat.id) return;
  if (event.type !== 'run_finished') showEmpty(false);
  switch (event.type) {
    case 'stream': {
      // Jamoa rejimida oraliq agentlar matni chatga emas, o'ng paneldagi oqimga yoziladi.
      // Chatda faqat yakuniy sintez qilingan javob (1 AI · Lead) ko'rinadi.
      if (teamActive && (event.agent || '') !== 'Lead') agentStreamAppend(event.agent, event.text);
      else setLiveText(liveText + event.text);
      break;
    }
    case 'stream_flush':
      if (!teamActive || (event.agent || '') === 'Lead') setLiveText(event.text);
      else agentStreamAppend(event.agent, '');
      break;
    case 'thinking':
      closeThinkingCard();
      startThinkingCard({ label: event.label, agent: event.agent, at: event.at });
      dockLive(event.label || 'fikrlayapti…', true);
      break;
    case 'notice':
      addNotice(event.text);
      activityLine('', String(event.text).slice(0, 70));
      dockPush({ id: `notice_${++dockSeq}`, icon: '', title: String(event.text).slice(0, 180), agent: event.agent });
      break;
    case 'provider_used':
      activityLine('', `${event.provider} · ${event.model}`);
      dockPush({ id: `prov_${++dockSeq}`, icon: '', title: `${event.provider} · ${event.model}`, sub: 'provayder tanlandi', state: 'ok' });
      break;
    case 'quota': updateQuotaChip(event); break;
    case 'usage': addUsage(event); break;
    case 'assistant': {
      closeThinkingCard();
      if (teamActive && event.agent && event.agent !== 'Lead') {
        agentStreamDone(event.agent, (event.text || '').length);
        dockPush({ id: `agent_msg_${event.agent}_${++dockSeq}`, icon: agentIcons.get(event.agent) || '', title: `${event.agent} javobini yozdi`, sub: String(event.text || '').slice(0, 200), agent: event.agent, state: 'ok' });
        break;
      }
      finalizeAssistant(event.text, event.agent);
      break;
    }
    case 'files_created':
      lastCreated = (event.paths || []).slice();
      break;
    case 'plan':
      addPlanCard({ steps: event.steps, text: event.text, task: event.task });
      dockPush({ id: `plan_${++dockSeq}`, icon: '', title: `Reja tayyor — ${(event.steps || []).length} qadam`, sub: 'Qurishni boshlash tugmasi reja ostida', state: 'ok' });
      break;
    case 'team_plan':
      addTeamPlanCard(event.agents, event.task);
      dockAgentsClear();
      for (const a of event.agents || []) {
        if (a && a.name) {
          if (a.icon) agentIcons.set(a.name, a.icon);
          dockAgentUpsert(a.name, { icon: a.icon, role: a.role, state: '…' });
        }
      }
      break;
    case 'team_assign':
      setTeamAgentModel(event.agent, event.provider, event.model);
      dockAgentUpsert(event.agent, { model: `${event.provider} · ${event.model}` });
      break;
    case 'agent_begin':
      dropLiveIfEmpty();
      setTeamAgentActive(event.name, event.model);
      setCurrentAgent(event.icon || agentIcons.get(event.name) || '', event.name, 'ishlayapti…');
      dockAgentState(event.name, '⚙');
      dockAgentUpsert(event.name, { icon: event.icon, model: event.model });
      dockLive(`${event.name} ishlayapti…`, true);
      els.statusLine.textContent = `${event.name} ishlayapti…`;
      break;
    case 'agent_end':
      setTeamAgentDone(event.name, event.summary);
      dockAgentState(event.name, '✓');
      dockPush({ id: `agent_end_${event.name}_${++dockSeq}`, icon: event.icon || agentIcons.get(event.name) || '', title: `${event.name} tugaldi`, sub: String(event.summary || '').replace(/\s+/g, ' ').slice(0, 180), agent: event.name, state: 'ok' });
      break;
    case 'tool_start': {
      const card = makeToolCard({ id: event.id, tool: event.tool, args: event.args, status: 'run', agent: event.agent, at: event.at });
      toolCards.set(event.id, card);
      activityLine(teamMode || teamActive ? '' : '', toolActivity(event.tool, event.args));
      dockPush({
        id: `tool_${event.id}`,
        icon: toolIcon(event.tool, event.args),
        title: `${toolLabel(event.tool, event.args)}: ${String(toolSummary(event.tool, event.args) || '').slice(0, 120)}`,
        sub: 'bajarilmoqda…',
        agent: event.agent,
        state: 'run',
      });
      break;
    }
    case 'tool': {
      updateToolCard({ id: event.id, tool: event.tool, args: event.args, result: event.result, ok: event.ok, denied: event.denied, agent: event.agent, ms: event.ms, files: event.files });
      activityLine(teamMode || teamActive ? '' : '', toolActivity(event.tool, event.args, event.ok));
      dockUpdate(`tool_${event.id}`, {
        state: event.denied ? 'bad' : event.ok ? 'ok' : 'bad',
        ms: event.ms,
        sub: event.denied ? 'rad etildi' : String(event.result || '').replace(/\s+/g, ' ').slice(0, 160),
      });
      // Python/rasm natijasi panelda ham alohida ko'rinib turadi (yaratilgan fayllar bilan).
      if (Array.isArray(event.files) && event.files.length) {
        dockPush({
          id: `files_${event.id}`,
          icon: IMAGE_EXT.test(event.files[0]) ? '' : '',
          title: `Natija: ${event.files.slice(0, 3).join(', ')}`,
          sub: 'ochish uchun tool kartasini bosing',
          agent: event.agent,
          state: 'ok',
        });
      }
      break;
    }
    case 'approval_request':
      addApprovalCard({ approvalId: event.approvalId, tool: event.tool, args: event.args, agent: event.agent });
      break;
    case 'error':
      if (liveNode) finalizeAssistant('');
      closeThinkingCard(false);
      addError(event.message);
      dockPush({ id: `err_${++dockSeq}`, icon: '✖', title: String(event.message || '').slice(0, 200), agent: event.agent, state: 'bad' });
      break;
    case 'done':
      if (liveNode) finalizeAssistant('');
      break;
    case 'team_done':
      // Yakuniy javobni 1 AI (Lead) yozadi — uning xulosasi chatda qoladi.
      teamActive = false;
      dockAgentState('Lead', '✓');
      dockAgentUpsert('Lead', { icon: '', role: 'jamoa rahbari', state: '✓' });
      if (liveNode) finalizeAssistant(event.summary || '', 'Lead');
      dockPush({ id: `team_done_${++dockSeq}`, icon: '', title: 'Jamoa ishi tugadi — yakuniy javob yozildi', state: 'ok' });
      break;
    case 'run_finished':
      running = false;
      setRunningUI(false);
      teamPipeline = null;
      teamActive = false;
      closeThinkingCard();
      resetCurrentAgent();
      refreshChatList();
      break;
  }
});

/* ---------------- usage (token counter) ---------------- */
function fmtTokens(n) {
  return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n);
}
function usageLine() {
  const { input, output } = sessionUsage;
  if (!input && !output) return '';
  return ` ↕ ${fmtTokens(input + output)} tok`;
}
function addUsage(u) {
  if (!u) return;
  sessionUsage.input += u.input || 0;
  sessionUsage.output += u.output || 0;
  els.statusLine.textContent = (running ? (teamActive ? 'jamoa ishlayapti…' : 'agent ishlayapti…') : 'tayyor') + usageLine();
  // Tepadagi aylanada sessiya tokenlari (limit foizi ma'lum bo'lmasa) ko'rsatiladi.
  if (!lastQuota || lastQuota.percent == null) {
    setQuotaRing({ text: fmtTokens(sessionUsage.input + sessionUsage.output), title: `Sessiya: ${sessionUsage.input} kirish + ${sessionUsage.output} chiqish token` });
  }
}

/* ---------------- quota ---------------- */
function updateQuotaChip(q) {
  const parts = [];
  if (q.remainingRequests != null) parts.push(`${q.remainingRequests} req`);
  if (q.remainingTokens != null) parts.push(`${Math.max(0, Math.round(q.remainingTokens / 100) / 10)}k tok/min`);
  if (q.text) parts.push(q.text);
  // Chip ixtiyoriy (v4 interfeysida limit aylana progress bilan ko'rsatiladi).
  if (els.quotaChip && els.quotaText) {
    els.quotaChip.classList.remove('hidden');
    els.quotaText.textContent = `${q.providerName || q.provider}${parts.length ? ': ' + parts.join(' · ') : ''}`;
    els.quotaChip.title = `${q.providerName || q.provider} · ${q.model || ''} — qolgan limit`;
  }
  // Tepadagi aylana progress (3-bosqich): limit ma'lum bo'lsa foiz, aks holda qolgan son.
  let percent = null;
  if (q.remainingTokens != null && q.limitTokens) percent = (q.remainingTokens / q.limitTokens) * 100;
  else if (q.remainingRequests != null && q.limitRequests) percent = (q.remainingRequests / q.limitRequests) * 100;
  lastQuota = { percent };
  const ringText = percent != null
    ? `${Math.round(percent)}%`
    : (q.remainingRequests != null ? String(q.remainingRequests) : (/bepul|kalitsiz/i.test(q.text || '') ? '∞' : '—'));
  setQuotaRing({ percent, text: ringText, title: `${q.providerName || q.provider} · ${q.model || ''} — ${parts.join(' · ') || 'limit noma’lum'}` });
}

/* ---------------- masofaviy kontent (admin panel: GitHub app-config.json) ---------------- */
let myId = '';

function checkMyAnswer(rc) {
  if (!myId || !rc || !rc.answers) return;
  // Bloklangan bo'lsa — qat'iy eslatma
  if (Array.isArray(rc.blocked) && rc.blocked.includes(myId)) {
    const old = document.getElementById('rcBlocked');
    if (!old) makeBanner('rcBlocked', 'rc-notice', '<b>Ilova administrator tomonidan bloklangan.</b> Murojaat uchun: Sozlamalar → Qo‘llab-quvvatlash.');
    return;
  }
  const oldB = document.getElementById('rcBlocked');
  if (oldB) oldB.remove();
  const ans = rc.answers[myId];
  if (!ans || !ans.text) return;
  const key = `yang_answer_${ans.at}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  makeBanner('rcAnswer', 'rc-notice', `<b>Admin javobi:</b> ${String(ans.text).slice(0, 400)}`, true);
}

function verLt(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

function makeBanner(id, cls, html, dismissable) {
  let el = document.getElementById(id);
  if (el) el.remove();
  el = document.createElement('div');
  el.id = id;
  el.className = `rc-banner ${cls}`;
  el.innerHTML = html;
  document.body.appendChild(el);
  if (dismissable) {
    const x = document.createElement('button');
    x.className = 'rc-banner-close';
    x.textContent = '✕';
    x.title = 'Yopish';
    x.addEventListener('click', () => el.remove());
    el.appendChild(x);
  }
  return el;
}

// Banneri sichqoncha bilan SURISH (foydalanuvchi joyini tanlaydi, joy eslab qolinadi)
function makeDraggable(el, key) {
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  if (saved && Number.isFinite(saved.x)) {
    el.style.left = saved.x + 'px';
    el.style.top = saved.y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList && e.target.classList.contains('rc-banner-close')) return;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left; oy = r.top;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    const nx = Math.min(Math.max(0, ox + dx), window.innerWidth - el.offsetWidth);
    const ny = Math.min(Math.max(0, oy + dy), window.innerHeight - el.offsetHeight);
    el.style.left = nx + 'px';
    el.style.top = ny + 'px';
  });
  el.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (moved) localStorage.setItem(key, JSON.stringify({ x: parseInt(el.style.left, 10), y: parseInt(el.style.top, 10) }));
  });
  // Surilgan bo'lsa havola ochilmasin
  el.addEventListener('click', (e) => {
    if (moved) { e.stopImmediatePropagation(); moved = false; }
  }, true);
}

// 3-bosqich: tepadan tushadigan kreativ reklama banneri (hexagon fon, CTA, yopish).
function renderAdDrop(ad) {
  const old = document.getElementById('rcAdDrop');
  if (old) old.remove();
  const drop = document.createElement('div');
  drop.id = 'rcAdDrop';
  drop.className = 'rc-ad-drop show';
  const inner = document.createElement('div');
  inner.className = 'rc-ad-inner';
  if (ad.imageUrl) {
    const img = document.createElement('img');
    img.className = 'rc-ad-img';
    img.src = String(ad.imageUrl).slice(0, 500);
    inner.appendChild(img);
  }
  const badge = document.createElement('span');
  badge.className = 'rc-ad-badge';
  badge.textContent = String(ad.badge || 'YANG AI').slice(0, 18);
  const copy = document.createElement('div');
  copy.className = 'rc-ad-copy';
  const t = document.createElement('b');
  t.textContent = String(ad.title).slice(0, 120);
  copy.appendChild(t);
  if (ad.body) {
    const s = document.createElement('span');
    s.textContent = String(ad.body).slice(0, 200);
    copy.appendChild(s);
  }
  inner.appendChild(badge);
  inner.appendChild(copy);
  if (ad.link) {
    const cta = document.createElement('button');
    cta.className = 'rc-ad-cta';
    cta.textContent = String(ad.linkText || 'Batafsil →').slice(0, 26);
    cta.addEventListener('click', () => api.openExternal(ad.link));
    inner.appendChild(cta);
  }
  const close = document.createElement('button');
  close.className = 'rc-banner-close';
  close.textContent = '✕';
  close.title = 'Yopish';
  close.addEventListener('click', () => drop.remove());
  drop.appendChild(inner);
  drop.appendChild(close);
  document.body.appendChild(drop);
  // 14 soniyadan keyin o'zi yig'iladi (foydalanuvchi yopmasa).
  setTimeout(() => {
    if (!document.getElementById('rcAdDrop')) return;
    drop.classList.remove('show');
    drop.classList.add('hide');
    setTimeout(() => drop.remove(), 700);
  }, 14000);
}

function renderRemoteBanner(rc) {
  if (!rc || typeof rc !== 'object') return;
  // Reklama — admin GitHub'dan yoqadi/o'chiradi.
  // Standart: tepadan tushadigan kreativ banner; ad.style === 'corner' bo'lsa eski suriladigan usul.
  const ad = rc.ad;
  if (ad && ad.enabled !== false && ad.title && UI.ads) {
    if (ad.style === 'corner') {
      const b = makeBanner('rcAd', 'rc-ad', '');
      makeDraggable(b, 'yang_ad_pos');
      const body = document.createElement('div');
      body.className = 'rc-ad-body';
      if (ad.imageUrl) {
        const img = document.createElement('img');
        img.src = String(ad.imageUrl).slice(0, 500);
        body.appendChild(img);
      }
      const txt = document.createElement('div');
      txt.innerHTML = `<b>${String(ad.title).slice(0, 120)}</b>${ad.body ? '<br>' + String(ad.body).slice(0, 200) : ''}`;
      body.appendChild(txt);
      b.appendChild(body);
      if (ad.link) {
        b.style.cursor = 'pointer';
        b.title = ad.linkText || ad.link;
        b.addEventListener('click', (e) => {
          if (e.target.classList && e.target.classList.contains('rc-banner-close')) return;
          api.openExternal(ad.link);
        });
      }
    } else {
      renderAdDrop(ad);
    }
  } else {
    const old = document.getElementById('rcAd');
    if (old) old.remove();
    const oldDrop = document.getElementById('rcAdDrop');
    if (oldDrop) oldDrop.remove();
  }
  // E'lon — bir marta ko'rsatiladi (id bo'yicha eslab qolinadi)
  const n = rc.notice;
  if (n && n.text && n.id) {
    const key = `rc_notice_${n.id}`;
    if (!localStorage.getItem(key)) {
      const b = makeBanner('rcNotice', 'rc-notice', String(n.text).slice(0, 300), true);
      b.querySelector('.rc-banner-close').addEventListener('click', () => localStorage.setItem(key, '1'));
      if (n.link) {
        b.style.cursor = 'pointer';
        b.addEventListener('click', (e) => {
          if (e.target.classList && e.target.classList.contains('rc-banner-close')) return;
          api.openExternal(n.link);
        });
      }
    }
  }
  // Yangi versiya eslatmasi (masofaviy minVersion)
  if (rc.minVersion && appVersionStr && verLt(appVersionStr, rc.minVersion)) {
    const b = makeBanner('rcMinVer', 'rc-notice', `🆕 YANG AI v${rc.minVersion} chiqdi — ilovani yangilang (Sozlamalar → Yangilanishlar)`, true);
    if (rc.downloadUrl) {
      b.style.cursor = 'pointer';
      b.addEventListener('click', (e) => {
        if (e.target.classList && e.target.classList.contains('rc-banner-close')) return;
        api.openExternal(rc.downloadUrl);
      });
    }
  }
  checkMyAnswer(rc);
}

/* ---------------- birinchi ishga tushirish gidi ---------------- */
function hasAnyKey() {
  const keys = (cfg.config && cfg.config.keys) || {};
  if (Object.values(keys).some(Boolean)) return true;
  return ((cfg.config && cfg.config.customProviders) || []).some((c) => c.key);
}

function maybeShowWizard() {
  if (localStorage.getItem('yang_wizard_done') || hasAnyKey()) return;
  let ov = document.getElementById('wizard');
  if (ov) return;
  ov = document.createElement('div');
  ov.id = 'wizard';
  ov.className = 'rc-wizard';
  const done = () => {
    localStorage.setItem('yang_wizard_done', '1');
    ov.remove();
  };
  ov.innerHTML = `
    <div class="rc-wizard-card">
      <h2>YANG AI ga xush kelibsiz!</h2>
      <p>Ishlashi uchun <b>bitta bepul API kalit</b> yetarli (karta shart emas, ~2 daqiqa):</p>
      <ol>
        <li><b>Groq</b> (tavsiya) — <a href="#" data-url="https://console.groq.com/keys">console.groq.com/keys</a> → kalit nusxalash</li>
        <li>Yoki <b>HuggingFace</b> — <a href="#" data-url="https://huggingface.co/settings/tokens">huggingface.co/settings/tokens</a> → "Create token"</li>
        <li>Yoki <b>Gemini</b> — <a href="#" data-url="https://aistudio.google.com/apikey">aistudio.google.com/apikey</a></li>
      </ol>
      <p class="muted">Keyin Sozlamalar → Kalitlar bo'limiga joylashtirasiz. Kalitsiz ham sinab ko'rish mumkin — Pollinations bepul zaxira o'zi ulanadi.</p>
    </div>`;
  const btnRow = document.createElement('div');
  btnRow.className = 'rc-wizard-btns';
  const openBtn = document.createElement('button');
  openBtn.className = 'primary';
  openBtn.textContent = 'Sozlamalarni ochish';
  openBtn.addEventListener('click', () => { done(); openSettings(); });
  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Kalitsiz boshlash';
  skipBtn.addEventListener('click', done);
  btnRow.appendChild(openBtn);
  btnRow.appendChild(skipBtn);
  ov.querySelector('.rc-wizard-card').appendChild(btnRow);
  ov.querySelectorAll('a[data-url]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal(a.dataset.url);
  }));
  document.body.appendChild(ov);
}

/* ---------------- v5 IDE panel ---------------- */
const ide = {
  open: false,
  els: {},
  seq: 0,
  termHistory: [],
  // v5.4: yon panelning HAQIQIY terminali (xterm + PTY). `mode` — 'pty' yoki 'pipe'.
  term: { mode: 'pipe', x: null, id: null, fit: null, ro: null, wired: false, opening: false, _rt: null },
};

function ideInit() {
  ide.els = {
    panel: $('idePanel'), toggle: $('ideToggle'), close: $('ideClose'),
    tree: $('ideTree'), termOut: $('ideTermOut'), termIn: $('ideTermInput'), termRun: $('ideTermRun'),
    feed: $('ideFeed'), live: $('ideLive'),
    termHost: $('ideXtermHost'), termMode: $('ideTermMode'), termNote: $('ideTermNote'),
    fileModal: $('ideFileModal'), fileModalName: $('ideFileName'), fileModalContent: $('ideFileContent'), fileModalClose: $('ideFileClose'),
    fileEdit: $('ideFileEdit'), fileSave: $('ideFileSave'), fileExt: $('ideFileExt'), fileDirty: $('ideFileDirty'), fileEditArea: $('ideFileEditArea'),
  };
  if (ide.els.toggle) ide.els.toggle.addEventListener('click', () => ideToggle());
  if (ide.els.close) ide.els.close.addEventListener('click', () => ideToggle(false));
  if (ide.els.termRun) ide.els.termRun.addEventListener('click', () => ideRunTerm());
  if (ide.els.termIn) ide.els.termIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ideRunTerm(); } });
  if (ide.els.termMode) ide.els.termMode.addEventListener('click', () => ideTermSwitch());
  if (ide.els.fileModalClose) ide.els.fileModalClose.addEventListener('click', () => ideFileCloseModal());
  if (ide.els.fileEdit) ide.els.fileEdit.addEventListener('click', () => ideFileToggleEdit(true));
  if (ide.els.fileSave) ide.els.fileSave.addEventListener('click', () => ideFileSave());
  if (ide.els.fileExt) ide.els.fileExt.addEventListener('click', () => ideFileOpenExternal());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && ide.els.fileModal && !ide.els.fileModal.classList.contains('hidden')) {
      e.preventDefault();
      if (!ide.els.fileEditArea.classList.contains('hidden')) ideFileSave();
    }
  });
  ideOpen(false);
}

function ideToggle(force) {
  const want = force === undefined ? !ide.open : !!force;
  ide.open = want;
  ide.els.panel.classList.toggle('hidden', !want);
  if (want) { ideRefreshTree(); ideTermEnsure(); }
}

function ideOpen(v) { ideToggle(v); }

/* ---------------- v5.4: HAQIQIY terminal (xterm + PTY) ----------------
   Ilgari yon paneldagi terminal faqat buyruq maydoni edi: bitta buyruq yoziladi,
   chiqishi ko'rsatiladi — interaktiv dasturlar (vim, top, ssh, python REPL) ishlamasdi.
   Endi «haqiqiy» rejim ham bor: ConPTY ustidagi psevdo-terminal + xterm.js ekrani.
   Kanallar IDE yadrosi bilan bir xil (`yide:pty-*`) — ular main jarayonda allaqachon
   ro'yxatga olingan, shu sabab bu yerda ikkinchi manba ochilmaydi. PTY yoki xterm
   bo'lmasa panel jimgina eski buyruq maydoni rejimida qoladi. */
function ideTermNote(text) { if (ide.els.termNote) ide.els.termNote.textContent = String(text || ''); }

function ideTermSetMode(mode) {
  const t = ide.term;
  t.mode = mode;
  const pty = mode === 'pty';
  if (ide.els.termHost) ide.els.termHost.classList.toggle('hidden', !pty);
  if (ide.els.termOut) ide.els.termOut.classList.toggle('hidden', pty);
  if (ide.els.termIn) ide.els.termIn.classList.toggle('hidden', pty);
  if (ide.els.termMode) ide.els.termMode.textContent = pty ? 'haqiqiy' : 'buyruq';
}

function ideTermFit() {
  const t = ide.term;
  if (t.mode !== 'pty' || !t.x) return;
  try { if (t.fit) t.fit.fit(); } catch { /* o'lcham hali tayyor emas */ }
  if (t.id) { try { api.ptyResize(t.id, t.x.cols, t.x.rows); } catch { /* sessiya yopilgan */ } }
}

async function ideTermOpenSession() {
  const t = ide.term;
  if (t.mode !== 'pty' || t.id || !t.x) return;
  let r = null;
  try { r = await api.ptyOpen({ cols: t.x.cols || 100, rows: t.x.rows || 26 }); } catch (e) { r = { error: String((e && e.message) || e) }; }
  if (!r || r.error) {
    ideTermSetMode('pipe');
    ideTermNote(`terminal ochilmadi: ${(r && r.error) || 'xato'} — oddiy rejim`);
    return;
  }
  t.id = r.id;
  const shell = String(r.shell || '').split(/[\\/]/).pop();
  ideTermNote(`PTY · ${shell} · ${r.cwd || ''}`);
  try { t.x.focus(); } catch { /* fokus ixtiyoriy */ }
}

async function ideTermStart() {
  const t = ide.term;
  if (t.x || t.opening || !ide.els.termHost) return;
  if (typeof window.Terminal !== 'function') { ideTermNote('oddiy rejim (xterm.js topilmadi)'); return; }
  t.opening = true;
  try {
    let info = null;
    try { info = await api.ptyInfo(); } catch { info = null; }
    if (!info || !info.available) { ideTermNote('oddiy rejim (PTY yo\u2018q)'); return; }
    t.x = new window.Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
      fontSize: 12, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, allowProposedApi: true,
      theme: {
        background: '#0b0d12', foreground: '#d7dbe6', cursor: '#8aa2ff',
        selectionBackground: 'rgba(108,140,255,0.32)',
        black: '#1b1f2a', red: '#f87171', green: '#6ee7a8', yellow: '#fbbf24',
        blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e5e7eb',
      },
    });
    try { const fit = new window.FitAddon.FitAddon(); t.x.loadAddon(fit); t.fit = fit; } catch { t.fit = null; }
    t.x.open(ide.els.termHost);
    t.x.onData((d) => { if (t.id) { try { api.ptyWrite(t.id, d); } catch { /* yopilgan */ } } });
    api.onPtyData((d) => { try { if (d && d.id === t.id && t.x) t.x.write(d.chunk); } catch { /* chizish */ } });
    api.onPtyExit((d) => {
      if (!d || d.id !== t.id) return;
      t.id = null;
      try { if (t.x) t.x.write(`\r\n\u001b[90m[sessiya tugadi — kod ${d.code}]\u001b[0m\r\n`); } catch { /* */ }
      ideTermNote(`sessiya yopildi (kod ${d.code})`);
      ideFeedLine('⌨', `terminal sessiyasi tugadi (kod ${d.code})`);
    });
    ideTermSetMode('pty');
    ideTermFit();
    await ideTermOpenSession();
    if (ide.term.mode === 'pty') {
      ideFeedLine('⌨', 'haqiqiy terminal ochildi (PTY) — vim, top, ssh ishlaydi');
      if (window.ResizeObserver) {
        t.ro = new ResizeObserver(() => { clearTimeout(t._rt); t._rt = setTimeout(ideTermFit, 140); });
        t.ro.observe(ide.els.termHost);
      }
    }
  } finally {
    t.opening = false;
  }
}

/** Panel ochilganda bir marta sinaladi: imkon bo'lsa haqiqiy terminalga o'tadi. */
async function ideTermEnsure() {
  const t = ide.term;
  if (t.wired) return;
  t.wired = true;
  if (!ide.els.termHost || typeof window.Terminal !== 'function') { ideTermNote('buyruq maydoni'); return; }
  try { await ideTermStart(); } catch { /* xato bo'lsa eski rejim qoladi */ }
  if (ide.term.mode !== 'pty') {
    // Nega o'tilmadi — foydalanuvchi bilib tursin (xterm yoki PTY yo'q).
    let reason = '';
    try { const info = await api.ptyInfo(); reason = info && info.reason ? String(info.reason).slice(0, 60) : ''; } catch { /* */ }
    ideTermNote(reason ? `oddiy rejim (${reason})` : 'buyruq maydoni');
  }
}

/** «haqiqiy ↔ buyruq» almashinuvi. */
function ideTermSwitch() {
  const t = ide.term;
  if (t.mode === 'pty') {
    if (t.id) { try { api.ptyClose(t.id); } catch { /* */ } t.id = null; }
    ideTermSetMode('pipe');
    ideTermNote('buyruq maydoni');
    return;
  }
  ideTermSetMode('pty');
  if (!t.x) {
    ideTermSetMode('pipe');
    ideTermStart().then(() => { if (ide.term.mode === 'pty') ideTermFit(); else ideTermNote('haqiqiy terminal mavjud emas'); });
    return;
  }
  ideTermOpenSession().then(() => ideTermFit());
}

/* ---------------- v5: rasm studiyasi ---------------- */
let imgStudioQ = '1080';
function imgStudioInit() {
  const modal = $('imgStudioModal');
  if (!modal) return;
  $('imgStudioClose').addEventListener('click', () => modal.classList.add('hidden'));
  $('imgStudioGo').addEventListener('click', async () => {
    const prompt = ($('imgStudioPrompt').value || '').trim();
    const status = $('imgStudioStatus');
    if (!prompt) { status.textContent = '⚠ Prompt bo‘sh'; return; }
    $('imgStudioGo').disabled = true;
    status.textContent = '… tarjima + generatsiya… bir necha daqiqa olishi mumkin';
    const r = await api.imageStudio(prompt, imgStudioQ);
    $('imgStudioGo').disabled = false;
    if (r.error) {
      status.textContent = '⚠ ' + r.error + (r.promptEn ? '\n(natija prompti: ' + r.promptEn + ')' : '');
      return;
    }
    status.innerHTML = `rasm tayyor: ${r.path}\nProvayder: ${r.via} · ${r.size}\n(natija prompti: ${r.promptEn})`;
    // chatga ham yo'llab qo'yamiz (foydalanuvchi ko'rsin)
    try {
      const msg = document.createElement('div');
      msg.className = 'msg';
      msg.innerHTML = 'Rasm yaratildi — <b>fayl:</b> ';
      const b = document.createElement('button');
      b.className = 'btn btn-ghost small';
      b.textContent = r.path.split(/[\\/]/).pop();
      b.addEventListener('click', () => api.openPath(r.path));
      msg.appendChild(b);
      els.messages.appendChild(msg);
      scrollPin();
    } catch {}
  });
  document.querySelectorAll('#imgStudioQuality button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#imgStudioQuality button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      imgStudioQ = b.dataset.q || '1080';
    });
  });
}

function ideFeedLine(icon, text, { kind = '' } = {}) {
  if (!ide.els.feed) return;
  const el = document.createElement('div');
  el.className = 'ide-line ' + kind;
  el.innerHTML = `<span class="ide-line-i">${icon}</span><span class="ide-line-t"></span>`;
  el.querySelector('.ide-line-t').textContent = text;
  ide.els.feed.appendChild(el);
  ide.els.feed.scrollTop = ide.els.feed.scrollHeight;
  while (ide.els.feed.children.length > 300) ide.els.feed.firstElementChild.remove();
}

function ideLiveSet(text) { if (ide.els.live) ide.els.live.textContent = text; }

async function ideRefreshTree() {
  if (!ide.els.tree) return;
  const r = await api.ideListTree('.', 2);
  ide.els.tree.innerHTML = '';
  if (r.error) { ide.els.tree.innerHTML = `<div class="dim">${r.error}</div>`; return; }
  for (const it of (r.entries || [])) {
    const row = document.createElement('div');
    row.className = 'ide-tree-row';
    row.textContent = it.path;
    row.style.paddingLeft = (String(it.path).split('/').length - 1) * 12 + 6 + 'px';
    if (!it.dir) {
      row.addEventListener('click', () => ideOpenFile(it.path, it.size));
    }
    ide.els.tree.appendChild(row);
  }
}

async function ideOpenFile(relPath, size = 0) {
  ide.currentFile = { path: relPath, saved: null };
  // h2 ichida <small id="ideFileDirty"> bor — matnni birinchi child node orqali almashtiramiz.
  if (ide.els.fileModalName.firstChild) ide.els.fileModalName.firstChild.nodeValue = relPath;
  else ide.els.fileModalName.textContent = relPath;
  ideFileSetDirty(false);
  ide.els.fileModalContent.textContent = 'ochilyapti…';
  ide.els.fileModal.classList.remove('hidden');
  ideFileToggleEdit(false);
  if (size > 1200000) {
    ide.els.fileModalContent.textContent = `(fayl juda katta — ${(size / 1024).toFixed(0)} KB) — tizim ilovasida oching (↗)`;
    return;
  }
  const r = await api.readWorkspaceFile(relPath);
  if (r.error) { ide.els.fileModalContent.textContent = '⚠ ' + r.error; return; }
  ide.currentFile.saved = r.text;
  ide.els.fileModalContent.textContent = (r.truncated ? '(fayl kesildi — birinchi qism)\n\n' : '') + r.text;
}

/* ---------- v5.1: IDE fayl tahrirlovchi ---------- */
function ideFileSetDirty(dirty) {
  if (ide.els.fileDirty) ide.els.fileDirty.textContent = dirty ? ' • o‘zgartirildi' : '';
  if (ide.els.fileSave) ide.els.fileSave.classList.toggle('hidden', !dirty);
}

function ideFileToggleEdit(on, savedText) {
  ide.els.fileEditArea.classList.toggle('hidden', !on);
  ide.els.fileModalContent.classList.toggle('hidden', !!on);
  ide.els.fileEdit.classList.toggle('hidden', !!on);
  if (on) {
    ide.els.fileEditArea.value = savedText != null ? savedText : ide.currentFile?.saved ?? '';
    ide.els.fileEditArea.focus();
  }
}

async function ideFileSave() {
  if (!ide.currentFile || !ide.currentFile.path) return;
  const content = ide.els.fileEditArea.value;
  const r = await api.ideSaveFile(ide.currentFile.path, content);
  if (r.error) {
    ideFileSetDirty(true);
    ideFeedLine('✖', `save failed: ${ide.currentFile.path} — ${r.error}`, { kind: 'bad' });
    return;
  }
  ide.currentFile.saved = content;
  ideFileSetDirty(false);
  ide.els.fileModalContent.textContent = content;
  ideFeedLine('', `saved ${r.saved}`);
  ideRefreshTree();
}

async function ideFileOpenExternal() {
  if (!ide.currentFile || !ide.currentFile.path) return;
  // Tahrirlovchida saqlanmagan o‘zgarish bo‘lsa avval saqlaymiz.
  if (!ide.els.fileEditArea.classList.contains('hidden') && ide.els.fileEditArea.value !== ide.currentFile.saved) {
    await ideFileSave();
  }
  const r = await api.ideOpenExternal(ide.currentFile.path);
  if (r.error) ideFeedLine('✖', `external open failed: ${r.error}`, { kind: 'bad' });
  else ideFeedLine('↗', `opened externally ${ide.currentFile.path}`);
}

function ideFileCloseModal() {
  // Saqlanmagan o‘zgarish bo‘lsa — tasdiq so‘raymiz.
  if (!ide.els.fileEditArea.classList.contains('hidden') && ide.els.fileEditArea.value !== ide.currentFile?.saved) {
    const ok = window.confirm('Saqlanmagan o‘zgarishlar bor — saqlaymizmi?');
    if (ok) { ideFileSave(); }
  }
  ide.els.fileModal.classList.add('hidden');
}

// tahrirlovchi input eventini ulash (init'da emas — fileEditArea hozir mavjud bo'lishi kerak)
document.getElementById('ideFileEditArea')?.addEventListener('input', () => {
  const dirty = ide.els && ide.els.fileEditArea && ide.els.fileEditArea.value !== ide.currentFile?.saved;
  ideFileSetDirty(!!dirty);
});
document.getElementById('ideFileEditArea')?.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); const area = e.target; const s = area.selectionStart, en = area.selectionEnd; area.value = area.value.slice(0, s) + '  ' + area.value.slice(en); area.selectionStart = area.selectionEnd = s + 2; }
});

async function ideRunTerm() {
  const cmd = (ide.els.termIn.value || '').trim();
  if (!cmd) return;
  ide.els.termIn.value = '';    ide.els.termOut.innerHTML += `<div class="ide-line "><b>${cmd.replace(/</g, '&lt;')}</b></div>`;
  ide.els.termOut.scrollTop = ide.els.termOut.scrollHeight;    ideFeedLine('', `terminal: ${cmd.slice(0, 120)}`);
  const r = await api.ideRunCommand(cmd, '.');
  const out = r.error ? '⚠ ' + r.error : r.output || '(bo‘sh)';
  const div = document.createElement('div');
  div.className = 'ide-line ' + (r.failed ? 'bad' : 'ok');
  div.textContent = out.length > 12000 ? out.slice(0, 12000) + '\n…[kesildi]' : out;
  ide.els.termOut.appendChild(div);
  ide.els.termOut.scrollTop = ide.els.termOut.scrollHeight;
  ideFeedLine(r.failed ? '✖' : '✓', `terminal natijasi ${r.failed ? '(xato)' : '(OK)'}`);
  ideRefreshTree();
}

// agent eventlarini IDE jurnaliga yozish (tool/tool_start'da chaqiriladi)
function ideOnAgentEvent(event) {
  if (!ide || !ide.els || !ide.els.feed) return;
  if (event.type === 'tool_start') {
    const t = event.tool;
    const args = event.args || {};
    if (t === 'read_file') ideFeedLine('', `opened ${args.path || ''}`);
    else if (t === 'write_file') ideFeedLine('', `creating ${args.path || ''}`);
    else if (t === 'edit_file') ideFeedLine('', `editing ${args.path || ''}`);
    else if (t === 'run_command') ideFeedLine('', `terminal: ${String(args.command || '').slice(0, 120)}`);
    else if (t === 'list_dir') ideFeedLine('', `listing ${args.path || '.'}`);
    else if (t === 'search_files') ideFeedLine('', `searching ${args.pattern || args.query || ''}`);
    else if (t === 'create_image' || t === 'generate_image') ideFeedLine('', `drawing ${args.path || ''}`);
    else if (t === 'create_document') ideFeedLine('', `document ${args.path || ''}`);
    else ideFeedLine('', `${t} ${JSON.stringify(args).slice(0, 90)}`);
    ideLiveSet('ishlayapti…');
  } else if (event.type === 'tool') {
    if (Array.isArray(event.files) && event.files.length) {
      for (const f of event.files.slice(0, 5)) ideFeedLine('', `${f} — tugatildi`);
    }
    ideLiveSet('tayyor');
    if (ide.open) ideRefreshTree();
  } else if (event.type === 'done' || event.type === 'run_finished') {
    ideLiveSet('tayyor');
  } else if (event.type === 'error') {
    ideFeedLine('✖', String(event.message || '').slice(0, 200), { kind: 'bad' });
    ideLiveSet('xato');
  }
}

/* presets + local scan + model fetch */
let presets = [];
let scanBtn = null;
async function renderPresets() {
  if (!presets.length) {
    try {
      presets = await api.getProviderPresets();
    } catch {
      presets = [];
    }
  }
  els.presetRow.innerHTML = '';
  for (const p of presets) {
    const chip = document.createElement('button');
    chip.className = 'preset-chip';
    chip.title = `${p.hint}${p.keyUrl ? '\nKalit: ' + p.keyUrl : ''}`;
    chip.innerHTML = p.name;
    chip.addEventListener('click', () => {
      els.npName.value = p.name;
      els.npBase.value = p.base;
      if (!p.local) els.npKey.focus();
      else fetchLocalIntoForm();
    });
    els.presetRow.appendChild(chip);
  }
  scanBtn = document.createElement('button');
  scanBtn.className = 'preset-chip scan';
  scanBtn.innerHTML = 'Lokal skan';
  scanBtn.title = 'Kompyuterdagi Ollama / LM Studio serverlarini avtomatik topadi';
  scanBtn.addEventListener('click', fetchLocalIntoForm);
  els.presetRow.appendChild(scanBtn);
}

async function fetchLocalIntoForm() {
  if (!scanBtn) return;
  scanBtn.textContent = '… skan…';
  const found = await api.scanLocal();
  scanBtn.textContent = 'Lokal skan';
  if (!found.length) {
    els.importResult.textContent = '⚠ Lokal server topilmadi (Ollama: ollama serve / LM Studio: serverni yoqing)';
    return;
  }
  const fmt = (ramGb) => (ramGb ? `, ~${ramGb} GB RAM` : '');
  const first = found[0];
  els.npName.value = first.kind;
  els.npBase.value = first.base;
  els.npModels.value = first.models.map((m) => m.name).join(', ');
  if (found.length > 1) els.importResult.textContent = `✓ ${found.length} server topildi: ${found.map((f) => f.kind).join(', ')} — birinchi tanlandi`
    + `\n` + found.map((f) => `${f.kind}: ` + f.models.map((m) => `${m.name} — ${m.sizeBytes ? (m.sizeBytes / 1024 ** 3).toFixed(1) + 'GB' : '?'}${fmt(m.ramGb)}`).join(' / ')).join('\n');
  else els.importResult.textContent = `✓ ${first.kind}: ${first.models.length} ta lokal model topildi\n`
    + first.models.map((m) => `  ${m.name} — ${m.sizeBytes ? (m.sizeBytes / 1024 ** 3).toFixed(1) + 'GB' : '?'}${fmt(m.ramGb)}`).join('\n');
}

els.npFetch.addEventListener('click', async () => {
  const base = els.npBase.value.trim();
  if (!base) {
    els.importResult.textContent = '⚠ Avval Base URL yozing';
    return;
  }
  els.npFetch.textContent = '…';
  const r = await api.fetchProviderModels(base, els.npKey.value.trim());
  els.npFetch.textContent = '⤓ Modellar';
  if (r.error) {
    els.importResult.textContent = '⚠ ' + r.error;
    return;
  }
  if (r.models.length) {
    els.npModels.value = r.models.join(', ');
    els.importResult.textContent = `✓ ${r.models.length} ta model olindi`;
  } else {
    els.importResult.textContent = '⚠ Model topilmadi';
  }
});

/* ---------------- settings ---------------- */
function openSettings() {
  els.providerSelect.innerHTML = Object.values(cfg.providers).map((p) => `<option value="${p.id}">${p.name}${p.custom ? ' (maxsus)' : ''}</option>`).join('');
  els.providerSelect.value = cfg.config.provider;
  fillModelList();
  els.modelInput.value = cfg.config.model;
  els.customBaseUrl.value = cfg.config.customBaseUrl || '';
  els.customUrlField.classList.toggle('hidden', cfg.config.provider !== 'custom');
  els.autoApprove.checked = !!cfg.config.autoApprove;
  els.pinModelToggle.checked = !!cfg.config.pinMode;
  els.settingsWs.textContent = (currentChat && currentChat.workspace) || cfg.config.lastWorkspace || '—';
  renderKeyFields();
  renderCustomProviders();
  renderPresets();
  els.importResult.textContent = '';
  els.quotaList.innerHTML = '<span class="dim">“Tekshirish”ni bosing</span>';
  // 3-bosqich: bo'limlar (tablar) va yangi maydonlar
  renderQuickModels();
  const tr = cfg.config.translate || {};
  els.transEnabled.checked = tr.enabled !== false;
  els.transUrl.value = tr.url || 'http://127.0.0.1:8788';
  els.transTarget.value = tr.target || 'uzn_Latn';
  els.transResult.textContent = '';
  els.connectResult.textContent = '';
  openSetTab(currentSetTab);
  els.settingsModal.classList.remove('hidden');
}

/* sozlamalar bo'limlari (tablar) */
let currentSetTab = 'provider';
function openSetTab(name) {
  currentSetTab = name || 'provider';
  document.querySelectorAll('.set-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentSetTab));
  document.querySelectorAll('.set-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== currentSetTab));
}

/* Plan / Build (4-bosqich) */
async function sendPlan() {
  if (running) return;
  if (!els.input.value.trim() && !pendingAttachments.length) {
    addNotice('Avval vazifani yozing — Plan reja tuzadi.');
    els.input.focus();
    return;
  }
  await send({ planFirst: true });
}
async function sendBuild() {
  if (running) return;
  await send({ planFirst: false });
}
function setPlanMode(on) {
  planMode = !!on;
  els.planBtn.classList.toggle('on', planMode);
  els.bbMode.classList.toggle('on', planMode);
  els.bbHint.textContent = planMode ? 'Reja rejimi: Enter — reja tuzadi, «Qurishni boshlash» quradi' : 'Enter — yuborish · Shift+Enter — yangi qator';
}

/* pastdagi model/mode chipslari */
function updateBottomBar() {
  const prov = (cfg.providers && cfg.providers[cfg.config.provider]) || {};
  els.bbModelName.textContent = `${prov.name || cfg.config.provider} · ${cfg.config.model}`;
  els.bbTeam.classList.toggle('on', teamMode);
  els.bbMode.classList.toggle('on', planMode);
}
async function setModel(model, providerId) {
  if (!model) return;
  const patch = { model };
  if (providerId) patch.provider = providerId;
  cfg.config = { ...cfg.config, ...patch };
  try { await api.saveConfig(patch); } catch {}
  updateChips();
  updateBottomBar();
  renderQuickModels();
  if (els.modelInput) els.modelInput.value = model;
  const prov = cfg.providers[providerId || cfg.config.provider] || {};
  switchFx(`${prov.name || cfg.config.provider}`, model);
  dockPush({ id: `switch_${Date.now()}`, icon: '', title: `Model almashtirildi: ${model}`, sub: prov.name || cfg.config.provider, state: 'ok' });
}
function renderQuickModels(models) {
  if (!els.quickModels) return;
  const p = cfg.providers[cfg.config.provider] || {};
  const list = models && models.length ? models : [...(p.models || []), ...(p.visionModels || [])];
  els.quickModels.innerHTML = '';
  if (!list.length) {
    els.quickModels.innerHTML = '<span class="dim">Model ro‘yxati noma’lum — «⤓ Modellar» tugmasini bosing</span>';
    return;
  }
  for (const m of [...new Set(list)].slice(0, 40)) {
    const chip = document.createElement('button');
    chip.className = 'preset-chip' + (m === cfg.config.model ? ' on' : '');
    chip.textContent = m;
    chip.title = `${p.name || ''} · ${m}`;
    chip.addEventListener('click', () => setModel(m));
    els.quickModels.appendChild(chip);
  }
}

// Model almashtirish animatsiyasi (kreativ, "detski" emas) — hexagon spin + progress.
function switchFx(main, sub) {
  if (!UI.anim || !els.switchFx) return;
  els.fxLabel.textContent = main || 'YANG AI';
  els.fxSub.textContent = sub || '';
  els.switchFx.classList.remove('hidden');
  clearTimeout(switchFx._t);
  switchFx._t = setTimeout(() => els.switchFx.classList.add('hidden'), 1000);
}

/* model tanlash popup'i (pastdagi chip) */
function closeModelPop() { els.modelPop.classList.add('hidden'); }
async function toggleModelPop() {
  if (!els.modelPop.classList.contains('hidden')) { closeModelPop(); return; }
  els.modelPop.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'mp-head';
  head.textContent = 'Modelni tanlang — bosilganda darhol almashadi';
  els.modelPop.appendChild(head);
  const usable = Object.values(cfg.providers).filter((p) => {
    if (p.custom) return (cfg.config.customProviders || []).some((c) => c.id === p.id);
    return !!cfg.config.keys[p.id] || p.id === cfg.config.provider || p.id === 'localmini';
  });
  for (const p of usable) {
    const h = document.createElement('div');
    h.className = 'mp-head';
    h.textContent = p.name;
    els.modelPop.appendChild(h);
    const models = [...(p.models || []), ...(p.visionModels || [])];
    if (!models.length) {
      const d = document.createElement('div');
      d.className = 'mp-note';
      d.textContent = 'Model ro‘yxati noma’lum — Sozlamalar → Model bo‘limidan oling';
      els.modelPop.appendChild(d);
      continue;
    }
    for (const m of [...new Set(models)].slice(0, 14)) {
      const active = cfg.config.provider === p.id && cfg.config.model === m;
      const item = document.createElement('div');
      item.className = 'mp-item' + (active ? ' active' : '');
      item.innerHTML = `<span></span><span class="mp-name"></span><span class="mp-check">${active ? '✓' : ''}</span>`;
      item.querySelector('.mp-name').textContent = m;
      item.addEventListener('click', async () => { closeModelPop(); await setModel(m, p.id); });
      els.modelPop.appendChild(item);
    }
  }
  const note = document.createElement('div');
  note.className = 'mp-note';
  note.textContent = 'Boshqa provayderlar: Sozlamalar → Provayder bo‘limi.';
  els.modelPop.appendChild(note);
  els.modelPop.classList.remove('hidden');
}

/* Provayder ulash oqimi (3-bosqich: 1 tanlash → 2 kalit → 3 tekshirish) */
function keyInputFor(id) {
  return els.keyFields.querySelector(`input[data-key="${id}"]`);
}
function providerBase(id) {
  if (id === 'custom') return els.customBaseUrl.value.trim();
  const p = cfg.providers[id] || {};
  return p.base || '';
}

function renderKeyFields() {
  els.keyFields.innerHTML = '';
  for (const p of Object.values(cfg.providers)) {
    const row = document.createElement('div');
    row.className = 'key-row';
    const has = p.custom ? true : !!cfg.config.keys[p.id];
    const visionMark = (p.visionModels && p.visionModels.length) ? '<span class="vision-mark">vision</span>' : '';
    const val = p.custom ? '' : cfg.config.keys[p.id] || '';
    row.innerHTML = `<span class="k-name">${p.name}${visionMark}</span>
      <input type="password" data-key="${p.id}" placeholder="${p.custom ? 'kalit provayder ichida saqlangan' : 'API kalit'}" ${p.custom ? 'disabled' : ''} style="flex:1" value="${escapeHtml(val)}" />
      <span class="k-state ${has ? 'ok' : 'missing'}">${has ? '✓' : '—'}</span>`;
    if (!p.custom) {
      row.querySelector('input').addEventListener('input', (ev) => {
        row.querySelector('.k-state').textContent = ev.target.value ? '✓' : '—';
        row.querySelector('.k-state').className = 'k-state ' + (ev.target.value ? 'ok' : 'missing');
      });
    }
    els.keyFields.appendChild(row);
  }
}

function renderCustomProviders() {
  els.customProviderList.innerHTML = '';
  const customs = cfg.config.customProviders || [];
  if (!customs.length) {
    els.customProviderList.innerHTML = '<span class="dim">Hozircha yo‘q — quyidan qo‘shing</span>';
    return;
  }
  for (const c of customs) {
    const row = document.createElement('div');
    row.className = 'custom-prov-row';
    row.innerHTML = `<span class="cp-name">${escapeHtml(c.name)}</span><span class="cp-models">${escapeHtml((c.models || []).join(', '))}</span>${c.vision ? '<span class="vision-mark"></span>' : ''}<button class="btn btn-danger small">✕</button>`;
    row.querySelector('button').addEventListener('click', async () => {
      cfg.config.customProviders = (cfg.config.customProviders || []).filter((x) => x.id !== c.id);
      await api.saveConfig({ customProviders: cfg.config.customProviders });
      cfg = await api.getConfig();
      renderCustomProviders();
      renderKeyFields();
      els.providerSelect.innerHTML = Object.values(cfg.providers).map((p) => `<option value="${p.id}">${p.name}${p.custom ? ' (maxsus)' : ''}</option>`).join('');
      if (!cfg.providers[els.providerSelect.value]) els.providerSelect.value = cfg.config.provider;
    });
    els.customProviderList.appendChild(row);
  }
}

function isLocalProviderBase(base) {
  try {
    const url = new URL(base);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1');
  } catch {
    return false;
  }
}

els.npAdd.addEventListener('click', async () => {
  const name = els.npName.value.trim();
  const base = els.npBase.value.trim().replace(/\/+$/, '');
  const models = els.npModels.value.split(',').map((s) => s.trim()).filter(Boolean);
  const key = els.npKey.value.trim();
  const vision = els.npVision.checked;
  if (!name || !base || !models.length || (!key && !isLocalProviderBase(base))) {
    els.importResult.textContent = '⚠ Nom, URL va model kerak; lokal server uchun kalit shart emas, masofaviy server uchun kalit kiriting';
    return;
  }
  const id = `custom_${Date.now().toString(36)}`;
  cfg.config.customProviders = [...(cfg.config.customProviders || []), { id, name, base, models, vision, key }];
  await api.saveConfig({ customProviders: cfg.config.customProviders });
  cfg = await api.getConfig();
  els.npName.value = els.npBase.value = els.npModels.value = els.npKey.value = '';
  els.npVision.checked = false;
  els.importResult.textContent = `✓ ${name} qo‘shildi`;
  renderCustomProviders();
  els.providerSelect.innerHTML = Object.values(cfg.providers).map((p) => `<option value="${p.id}">${p.name}${p.custom ? ' (maxsus)' : ''}</option>`).join('');
  els.providerSelect.value = id;
  els.modelInput.value = models[0];
  fillModelList();
  updateChips();
});

els.quotaCheckBtn.addEventListener('click', async () => {
  els.quotaList.innerHTML = '<span class="dim">Tekshirilmoqda…</span>';
  try {
    const list = await api.checkQuota();
    if (!list.length) { els.quotaList.innerHTML = '<span class="dim">Kalit kiritilgan provayder yo‘q</span>'; return; }
    els.quotaList.innerHTML = list.map((q) => `<div class="quota-row"><span>${escapeHtml(q.name)}</span><span class="${q.available ? 'ok' : 'bad'}">${escapeHtml(q.text)}</span></div>`).join('');
  } catch (e) {
    els.quotaList.innerHTML = `<span class="bad">${escapeHtml(e.message)}</span>`;
  }
});

function fillModelList() {
  const p = cfg.providers[els.providerSelect.value];
  const models = [...((p && p.models) || []), ...((p && p.visionModels) || [])];
  els.modelList.innerHTML = [...new Set(models)].map((m) => `<option value="${m}"></option>`).join('');
}

els.providerSelect.addEventListener('change', () => {
  fillModelList();
  const p = cfg.providers[els.providerSelect.value];
  if (p && p.models && p.models.length) els.modelInput.value = p.models[0];
  els.customUrlField.classList.toggle('hidden', els.providerSelect.value !== 'custom');
  if (els.modelFetchResult) els.modelFetchResult.textContent = '';
});

// Tanlangan provayder serveridan mavjud modellarni olib, bosib tanlanadigan ro'yxatda ko'rsatish
els.modelFetchBtn?.addEventListener('click', async () => {
  const id = els.providerSelect.value;
  const p = cfg.providers[id];
  if (!p || !p.base) {
    els.modelFetchResult.textContent = '⚠ Provayder bazasi topilmadi';
    return;
  }
  const key = (cfg.config.keys && cfg.config.keys[id]) || '';
  els.modelFetchResult.textContent = '… Modellar olinmoqda…';
  try {
    const r = await api.fetchProviderModels(p.base, key);
    const list = (r && r.models) || [];
    if (!list.length) {
      els.modelFetchResult.textContent = '⚠ ' + ((r && r.error) || 'Model topilmadi (Base URL yoki kalitni tekshiring)');
      return;
    }
    els.modelList.innerHTML = list.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
    const shown = list.slice(0, 12);
    els.modelFetchResult.innerHTML =
      `✓ ${list.length} ta model (bosib tanlang): ` +
      shown.map((m) => `<a href="#" data-model="${escapeHtml(m)}" style="text-decoration:underline">${escapeHtml(m)}</a>`).join(' · ') +
      (list.length > shown.length ? ` … +${list.length - shown.length}` : '');
    els.modelFetchResult.querySelectorAll('a[data-model]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      els.modelInput.value = a.dataset.model;
    }));
  } catch (e) {
    els.modelFetchResult.textContent = '⚠ ' + e.message;
  }
});

els.settingsSave.addEventListener('click', async () => {
  const keys = {};
  for (const inp of els.keyFields.querySelectorAll('input[data-key]')) {
    if (!inp.disabled) keys[inp.dataset.key] = inp.value.trim();
  }
  const patch = {
    provider: els.providerSelect.value,
    model: els.modelInput.value.trim() || 'openai/gpt-oss-120b',
    keys,
    autoApprove: els.autoApprove.checked,
    pinMode: els.pinModelToggle.checked,
    customBaseUrl: els.customBaseUrl.value.trim(),
    // Tarjima bo'limi (3-bosqich)
    translate: {
      enabled: els.transEnabled.checked,
      url: els.transUrl.value.trim() || 'http://127.0.0.1:8788',
      target: els.transTarget.value || 'uzn_Latn',
    },
    lastWorkspace: (currentChat && currentChat.workspace) || cfg.config.lastWorkspace,
  };
  cfg.config = { ...cfg.config, ...patch, keys: { ...cfg.config.keys, ...keys } };
  await api.saveConfig(patch);
  updateChips();
  updateBottomBar();
  renderQuickModels();
  els.settingsModal.classList.add('hidden');
  const newProv = (cfg.providers[cfg.config.provider] || {}).name || cfg.config.provider;
  if (UI.anim) switchFx(newProv, cfg.config.model);
});

/* ---------- 3-bosqich: yangi bo'limlar va provayder ulash oqimi ---------- */
els.setTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.set-tab');
  if (b) openSetTab(b.dataset.tab);
});
els.connectTestBtn.addEventListener('click', async () => {
  const id = els.providerSelect.value;
  const p = cfg.providers[id] || {};
  const keyInp = keyInputFor(id);
  const key = keyInp && !keyInp.disabled ? keyInp.value.trim() : ((cfg.config.keys && cfg.config.keys[id]) || '');
  const base = providerBase(id);
  if (!base) { els.connectResult.textContent = '⚠ Bu provayder uchun Base URL yo‘q (maxsus provayderni qo‘shing).'; return; }
  els.connectResult.textContent = '… Ulanmoqda… model ro‘yxati olinmoqda…';
  const r = await api.fetchProviderModels(base, key);
  const list = (r && r.models) || [];
  if (!list.length) {
    els.connectResult.textContent = '⚠ ' + ((r && r.error) || 'Model topilmadi — kalit/URL ni tekshiring.');
    return;
  }
  // Kalitni darhol saqlaymiz — "ulandi" holati haqiqiy bo'lishi uchun.
  if (key && keyInp && !keyInp.disabled) {
    cfg.config.keys[id] = key;
    await api.saveConfig({ keys: { [id]: key } });
    const state = keyInp.parentElement && keyInp.parentElement.querySelector('.k-state');
    if (state) { state.textContent = '✓'; state.className = 'k-state ok'; }
  }
  els.connectResult.textContent = `✓ ${p.name || id} ulandi — ${list.length} model topildi`;
  els.modelInput.value = list[0];
  els.modelList.innerHTML = list.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
  renderQuickModels(list);
  switchFx(`✓ ${p.name || id}`, `${list.length} model · ${list[0]}`);
  dockPush({ id: `connect_${Date.now()}`, icon: '', title: `${p.name || id} ulandi`, sub: `${list.length} model topildi`, state: 'ok' });
});
els.connectSaveBtn.addEventListener('click', async () => {
  const id = els.providerSelect.value;
  const p = cfg.providers[id] || {};
  const keyInp = keyInputFor(id);
  const keys = {};
  if (keyInp && !keyInp.disabled && keyInp.value.trim()) keys[id] = keyInp.value.trim();
  const patch = { provider: id, model: els.modelInput.value.trim() || cfg.config.model, keys };
  cfg.config = { ...cfg.config, ...patch, keys: { ...cfg.config.keys, ...keys } };
  await api.saveConfig(patch);
  updateChips();
  updateBottomBar();
  renderQuickModels();
  els.connectResult.textContent = `✓ Saqlandi: ${p.name || id} · ${cfg.config.model}`;
  switchFx(p.name || id, cfg.config.model);
});

/* Tarjima bo'limi */
async function saveTranslate() {
  const patch = {
    translate: {
      enabled: els.transEnabled.checked,
      url: els.transUrl.value.trim() || 'http://127.0.0.1:8788',
      target: els.transTarget.value || 'uzn_Latn',
    },
  };
  cfg.config = { ...cfg.config, ...patch };
  await api.saveConfig(patch);
}
els.transStatusBtn.addEventListener('click', async () => {
  await saveTranslate();
  els.transResult.textContent = '… Tekshirilmoqda…';
  try {
    const s = await api.translateStatus();
    els.transResult.textContent = s.up
      ? `✓ Tarjimon ishlayapti (${s.url} · maqsad: ${s.target})`
      : `⚠ Tarjimon javob bermayapti (${s.url}) — ilova ishga tushganda fonda ko‘tariladi.`;
  } catch (e) {
    els.transResult.textContent = '⚠ ' + e.message;
  }
});
els.transTestBtn.addEventListener('click', async () => {
  await saveTranslate();
  els.transResult.textContent = '… Sinov tarjimasi…';
  try {
    const r = await api.translateTest('Bugun havo juda yaxshi, loyihani boshlaymiz.');
    els.transResult.textContent = r.ok ? `✓ ${r.ms} ms · “${String(r.text).slice(0, 180)}”` : '⚠ Tarjima bo‘lmadi (tarjimon hali ko‘tarilmagan bo‘lishi mumkin).';
  } catch (e) {
    els.transResult.textContent = '⚠ ' + e.message;
  }
});

/* Interfeys bo'limi — sozlamalar darhol qo'llanadi */
function wireUiPrefs() {
  const setPanel = (on) => { UI.panel = on; saveUiPref('yang_ui_panel', on); applyUiPrefs(); };
  els.uiPanelToggle.addEventListener('change', () => setPanel(els.uiPanelToggle.checked));
  els.uiAnimToggle.addEventListener('change', () => { UI.anim = els.uiAnimToggle.checked; saveUiPref('yang_ui_anim', UI.anim); applyUiPrefs(); });
  els.uiStepsToggle.addEventListener('change', () => { UI.stepsInChat = els.uiStepsToggle.checked; saveUiPref('yang_ui_steps', UI.stepsInChat); });
  els.uiAdToggle.addEventListener('change', () => {
    UI.ads = els.uiAdToggle.checked;
    saveUiPref('yang_ui_ads', UI.ads);
    if (!UI.ads) { const a = document.getElementById('rcAdDrop'); if (a) a.remove(); const b = document.getElementById('rcAd'); if (b) b.remove(); }
  });
  els.uiPanelSide.addEventListener('change', () => { UI.side = els.uiPanelSide.value; saveUiPref('yang_ui_side', UI.side); applyUiPrefs(); });
  els.dockToggle.addEventListener('click', () => setPanel(!UI.panel));
  els.dockClose.addEventListener('click', () => setPanel(false));
  els.dockDisable.addEventListener('click', () => { setPanel(false); addNotice('Faoliyat paneli o‘chirildi — Sozlamalar → Interfeys bo‘limida yana yoqish mumkin.'); });
}

/* ---------- pastdagi bar: model + jamoa + reja ---------- */
function wireBottomBar() {
  els.bbModel.addEventListener('click', () => toggleModelPop());
  els.bbTeam.addEventListener('click', () => { teamMode = !teamMode; els.teamBtn.classList.toggle('on', teamMode); updateBottomBar(); });
  els.bbMode.addEventListener('click', () => setPlanMode(!planMode));
  els.planBtn.addEventListener('click', sendPlan);
  els.buildBtn.addEventListener('click', sendBuild);
  document.addEventListener('click', (e) => {
    if (els.modelPop.classList.contains('hidden')) return;
    if (e.target.closest('#modelPop') || e.target.closest('#bbModel')) return;
    closeModelPop();
  });
}


els.settingsClose.addEventListener('click', () => els.settingsModal.classList.add('hidden'));
els.settingsBtn.addEventListener('click', openSettings);
els.modelChip.addEventListener('click', openSettings);
els.quotaRing.addEventListener('click', openSettings);

/* ---------------- v5.3: to‘liq YANG IDE oynasi ---------------- */
// Yon paneldagi kichik IDE panelidan farqi: bu yerda to'liq IDE oynasi ochiladi —
// fayl daraxti, tahrirlovchi, terminal, AI assistent. Oyna AYNAN shu ilova ichida
// ishlaydi, ya'ni alohida o'rnatuvchi kerak emas.
(function wireOpenIde() {
  const btn = document.getElementById('openIdeBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const r = await window.api.openIde();
      if (r && r.error) console.error('IDE ochilmadi:', r.error);
    } catch (e) {
      console.error('IDE ochilmadi:', e);
    } finally {
      btn.disabled = false;
    }
  });
})();

/* ---------------- qo'llab-quvvatlash (Telegram botga yo'naltirilgan) ---------------- */
(function wireSupport() {
  const $id = (i) => document.getElementById(i);
  $id('tgQuestionBtn')?.addEventListener('click', () => api.supportOpenTelegram());
  $id('tgAdBtn')?.addEventListener('click', () => api.openExternal('https://t.me/hideforu'));
  $id('siteLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal('https://bekhvloger-beep.github.io/yang-ai/');
  });
})();
els.importEnvBtn.addEventListener('click', async () => {
  els.importResult.textContent = 'Import qilinmoqda…';
  const r = await api.importEnv();
  cfg.config = (await api.getConfig()).config;
  renderKeyFields();
  els.importResult.textContent = r.imported.length ? 'Import qilindi: ' + r.imported.join(', ') : 'Kalit topilmadi';
});
els.pickEnvBtn.addEventListener('click', async () => {
  const r = await api.pickEnvFile();
  if (r) {
    cfg.config = (await api.getConfig()).config;
    renderKeyFields();
    els.importResult.textContent = r.imported.length ? 'Import qilindi: ' + r.imported.join(', ') : 'Kalit topilmadi';
  }
});
$('clearKeysBtn').addEventListener('click', async () => {
  if (!confirm('Barcha ulangan API kalitlari o\'chiriladi. Davom etamizmi?')) return;
  await api.clearKeys();
  cfg = await api.getConfig();
  renderKeyFields();
  updateChips();
  els.importResult.textContent = 'Barcha kalitlar tozalandi';
});

/* ---------------- workspace ---------------- */
els.wsChip.addEventListener('click', async () => {
  if (running) return;
  const ws = await api.pickWorkspace();
  if (!ws) return;
  cfg.config.lastWorkspace = ws;
  api.saveConfig({ lastWorkspace: ws });
  if (currentChat) {
    currentChat = await api.setChatWorkspace(currentChat.id, ws);
  }
  updateChips();
});

els.settingsWsBtn.addEventListener('click', async () => {
  const ws = await api.pickWorkspace();
  if (!ws) return;
  cfg.config.lastWorkspace = ws;
  els.settingsWs.textContent = ws;
  if (currentChat) currentChat = await api.setChatWorkspace(currentChat.id, ws);
  updateChips();
});

/* ---------------- composer ---------------- */
function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + 'px';
}
els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
els.sendBtn.addEventListener('click', send);
els.stopBtn.addEventListener('click', () => api.stop());
els.teamBtn.addEventListener('click', () => {
  teamMode = !teamMode;
  els.teamBtn.classList.toggle('on', teamMode);
  els.input.placeholder = teamMode
    ? 'Katta loyiha: Planner agentlar bo‘lib topshiradi…'
    : 'Vazifani yozing… rasm/skrinshot ham tashlashingiz mumkin (Enter — yuborish)';
  updateBottomBar();
});

// v5: rasm studiyasi tugmasi
const imgStudioBtnEl = $('imgStudioBtn');
if (imgStudioBtnEl) imgStudioBtnEl.addEventListener('click', () => $('imgStudioModal').classList.remove('hidden'));

els.newChatBtn.addEventListener('click', async () => {
  if (running) return;
  currentChat = await api.newChat({ workspace: cfg.config.lastWorkspace });
  renderAllEvents([]);
  updateChips();
  refreshChatList();
  els.input.focus();
});

document.querySelectorAll('.suggestion').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.team === '1') {
      teamMode = true;
      els.teamBtn.classList.add('on');
    }
    els.input.value = b.dataset.text;
    autosize();
    els.input.focus();
  });
});

/* code copy: click on <pre> copies code */
document.addEventListener('click', (e) => {
  const pre = e.target.closest && e.target.closest('pre');
  if (pre && !e.target.closest('.code-lang')) {
    const code = pre.querySelector('code');
    if (code) {
      navigator.clipboard.writeText(code.textContent).then(() => {
        const note = document.createElement('div');
        note.textContent = '✓ nusxalandi';
        note.style.cssText = 'position:fixed;top:14px;right:18px;background:#1b2130;border:1px solid #262d3f;padding:6px 12px;border-radius:8px;font-size:12px;z-index:99';
        document.body.appendChild(note);
        setTimeout(() => note.remove(), 1200);
      });
    }
  }
});

/* ---------------- updates ---------------- */
els.updateCheckBtn.addEventListener('click', async () => {
  els.updateStatus.textContent = 'tekshirilmoqda…';
  const r = await api.updateCheck();
  if (r.state === 'available') {
    els.updateStatus.textContent = `yangi versiya: ${r.version} — yuklab olish mumkin`;
    els.updateInstallBtn.classList.add('hidden');
    const d = await api.updateDownload();
    if (d.state === 'downloaded') {
      els.updateStatus.textContent = `v${r.version} yuklandi — o‘rnatish uchun bosing`;
      els.updateInstallBtn.classList.remove('hidden');
    } else if (d.state === 'error') {
      els.updateStatus.textContent = 'yuklab olishda xato: ' + (d.message || '');
    }
  } else if (r.state === 'none') {
    els.updateStatus.textContent = `eng so‘nggi versiya (${r.version})`;
  } else if (r.state === 'disabled') {
    els.updateStatus.textContent = 'dev rejim — avto-yangilanish o‘chirilgan';
  } else {
    els.updateStatus.textContent = r.message || 'xato';
  }
});
els.updateInstallBtn.addEventListener('click', () => api.updateInstall());
window.api.onUpdateEvent((u) => {
  if (u.state === 'available') {
    els.updateStatus.textContent = `yangi versiya ${u.version} mavjud (Sozlamalar → Yangilanishlar)`;
    makeBanner('rcUpdate', 'rc-notice', `<b>YANG AI v${u.version} chiqdi!</b> Yangilash: Sozlamalar → Yangilanishlar → Yuklab olish`, true);
  }
  else if (u.state === 'downloading') els.updateStatus.textContent = `yuklanmoqda… ${u.percent}%`;
  else if (u.state === 'downloaded') {
    els.updateStatus.textContent = `v${u.version} yuklandi — o‘rnatish uchun bosing`;
    els.updateInstallBtn.classList.remove('hidden');
    const b = document.getElementById('rcUpdate');
    if (b) b.remove();
  }
});

/* ---------------- boot ---------------- */
(async function boot() {
  cfg = await api.getConfig();
  try {
    const ver = await api.appVersion();
    if (ver) els.appVersion.textContent = `v${ver} · aicomp.uz`;
    appVersionStr = ver || '';
  } catch {}
  updateChips();
  // 3-bosqich: interfeys sozlamalari va pastdagi bar
  try { applyUiPrefs(); wireUiPrefs(); wireBottomBar(); } catch (e) { console.error('UI init', e); }
  // v5 IDE panel + rasm studiyasi
  try { ideInit(); imgStudioInit(); } catch (e) { console.error('IDE init', e); }
  // Ishga tushishda limit chipini darhol to'ldirish (default provayder bo'yicha)
  try {
    const qs = await api.checkQuota();
    const list = (qs || []).filter((q) => q.available);
    const def = list.find((q) => q.id === cfg.config.provider) || list[0];
    if (def) updateQuotaChip({ provider: def.id, providerName: def.name, text: def.text });
  } catch {}
  // Masofaviy kontent (reklama/e'lon — GitHub app-config.json)
  try {
    myId = (await api.getClientId()) || '';
    const rc = await api.getRemoteConfig();
    if (rc) renderRemoteBanner(rc);
  } catch {}
  api.onRemoteConfig((rc) => rc && renderRemoteBanner(rc));
  maybeShowWizard();
  const chats = await api.listChats();
  if (chats.length) {
    await openChat(chats[0].id);
  } else {
    currentChat = null;
    showEmpty(true);
  }
  await refreshChatList();
  autosize();
  els.input.focus();
  window.__ready = true;
})();
