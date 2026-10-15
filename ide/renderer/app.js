/* YANG IDE — renderer mantiqi (mustaqil muharrir).
   Faqat window.ide ko'prigi orqali tizimga murojaat qiladi. Kutubxona yo'q. */

/* ------------------------------------------------------------------ yordamchi */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Katta fayl rejimi: shu belgidan katta matnda sintaksis bo'yash O'CHADI (terish tez qoladi),
// lekin fayl baribir to'liq ochiladi va saqlanadi — tahrir chegarasi yo'q.
const HIGHLIGHT_MAX = 2 * 1024 * 1024;

const state = {
  workspace: null,
  treeRoot: null,
  roots: [],            // [asosiy papka, ...qo'shimcha papkalar] — har biri { path, name, primary }
  openRoots: new Set(), // qo'shimcha papkalardan qaysilari daraxtda ochiq turibdi
  collapsed: new Set(),
  filter: '',
  tabs: [],
  active: null,
  problems: {},
  termBuffer: '',
  termHistory: [],
  termIdx: -1,
  quickMode: false,
  aiBusy: false,
  // Yangi qatlamlar (5.4): til xizmati, yurish tarixi, katta fayl rejimi.
  problemSets: {},      // path -> { lite: [], lsp: [] } (sintaksis + semantik birlashtirilgan)
  runLog: [],           // yurishlar tarixi (main'dagi log nusxasi)
  lsp: null,            // { available, info }
  bigMode: false,       // katta fayl: sintaksis bo'yash o'chirilgan
  gutterFirst: null,    // qator raqamlari oynasining boshlanishi
};

function toast(text, ms = 2600) {
  const el = $('toast');
  if (!el) return;
  el.textContent = String(text);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function activity(text, kind = '') {
  const box = $('activityPanel');
  if (!box) return;
  const line = document.createElement('div');
  line.className = 'act-line' + (kind ? ' ' + kind : '');
  line.textContent = `${new Date().toLocaleTimeString()} · ${text}`;
  box.appendChild(line);
  while (box.childElementCount > 300) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function catchLog(where, err) {
  console.error(`[IDE] ${where}:`, err);
  toast(`${where}: ${(err && err.message) || err}`);
}

/* ------------------------------------------------------------------ o'lcham */
// Muharrir geometriyasi style.css bilan BITTA manbadan: 13px × 1.55 satr balandligi,
// 10px yuqori padding. Ranglar/tokenlar ham style.css'da (.tk-*).
const LINE_H = 13 * 1.55;
const TOP_PAD = 10;

/* --------------------------------------------------------------- tarjimonlar */
const LANG_BY_EXT = {
  py: 'py', pyw: 'py', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js',
  html: 'html', htm: 'html', css: 'css', scss: 'css', json: 'json', md: 'md', markdown: 'md',
};
const LANG_NAME = { py: 'Python', js: 'JS/TS', html: 'HTML', css: 'CSS', json: 'JSON', md: 'Markdown', txt: 'Text' };

const RULES = {
  py: [
    { cls: 'tk-com', re: '#[^\\n]*' },
    { cls: 'tk-str', re: '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'' },
    { cls: 'tk-num', re: '\\b\\d[\\d_]*(?:\\.\\d+)?\\b' },
    { cls: 'tk-kw', re: '\\b(?:def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|try|except|finally|with|lambda|None|True|False|pass|break|continue|global|nonlocal|yield|raise|assert|del|is|async|await|match|case)\\b' },
    { cls: 'tk-fn', re: '\\b[A-Za-z_]\\w*(?=\\s*\\()' },
    { cls: 'tk-op', re: '[+\\-*/%=<>!&|^~]+|[:@]' },
  ],
  js: [
    { cls: 'tk-com', re: '//[^\\n]*|/\\*[\\s\\S]*?\\*/' },
    { cls: 'tk-str', re: '`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'' },
    { cls: 'tk-num', re: '\\b\\d[\\d_]*(?:\\.\\d+)?\\b' },
    { cls: 'tk-kw', re: '\\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|default|break|continue|new|class|extends|super|this|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false|import|export|from|async|await|yield|delete|void|static|get|set|interface|type|enum|implements|public|private|protected|readonly)\\b' },
    { cls: 'tk-fn', re: '\\b[A-Za-z_$]\\w*(?=\\s*\\()' },
    { cls: 'tk-op', re: '=>|===|!==|[+\\-*/%=<>!&|^~?:]' },
  ],
  html: [
    { cls: 'tk-com', re: '<!--[\\s\\S]*?-->' },
    { cls: 'tk-str', re: '"[^"]*"|\'[^\']*\'' },
    { cls: 'tk-tag', re: '</?[A-Za-z][\\w:-]*' },
    { cls: 'tk-attr', re: '\\b[A-Za-z-]+(?==)' },
    { cls: 'tk-op', re: '/?>' },
  ],
  css: [
    { cls: 'tk-com', re: '/\\*[\\s\\S]*?\\*/' },
    { cls: 'tk-str', re: '"[^"]*"|\'[^\']*\'' },
    { cls: 'tk-prop', re: '\\b[-a-zA-Z]+(?=\\s*:)' },
    { cls: 'tk-num', re: '#[0-9a-fA-F]{3,8}|\\b\\d+(?:\\.\\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\\b' },
    { cls: 'tk-kw', re: '@[a-zA-Z-]+' },
    { cls: 'tk-op', re: '[{};:,]' },
  ],
  json: [
    { cls: 'tk-prop', re: '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)' },
    { cls: 'tk-str', re: '"(?:\\\\.|[^"\\\\])*"' },
    { cls: 'tk-kw', re: '\\b(?:true|false|null)\\b' },
    { cls: 'tk-num', re: '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b' },
    { cls: 'tk-op', re: '[{}\\[\\],:]' },
  ],
  md: [
    { cls: 'tk-com', re: '```[\\s\\S]*?```' },
    { cls: 'tk-kw', re: '^#{1,6}[^\\n]*' },
    { cls: 'tk-str', re: '`[^`\\n]*`' },
    { cls: 'tk-fn', re: '\\*\\*[^*\\n]+\\*\\*' },
    { cls: 'tk-op', re: '^\\s*(?:[-*+]|\\d+\\.)\\s' },
  ],
  txt: [],
};
const KEYWORDS = {
  py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'lambda', 'None', 'True', 'False', 'pass', 'break', 'continue', 'yield', 'raise', 'self', 'len', 'print', 'range'],
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'super', 'this', 'try', 'catch', 'finally', 'throw', 'typeof', 'null', 'undefined', 'true', 'false', 'import', 'export', 'from', 'async', 'await', 'console', 'require'],
  html: ['html', 'head', 'body', 'div', 'span', 'script', 'style', 'link', 'meta', 'class', 'id', 'href', 'src'],
  css: ['display', 'color', 'background', 'margin', 'padding', 'font-size', 'flex', 'grid', 'position', 'border'],
  json: ['true', 'false', 'null'],
  md: ['#', '##', '###', '-', '*'],
  txt: [],
};

const _regexCache = new Map();
function langRegex(key) {
  if (_regexCache.has(key)) return _regexCache.get(key);
  const rules = RULES[key] || [];
  const re = rules.length ? new RegExp(rules.map((r, i) => `(?<k${i}>${r.re})`).join('|'), 'gm') : null;
  _regexCache.set(key, { re, rules });
  return _regexCache.get(key);
}

function tokenize(text, langKey) {
  const { re, rules } = langRegex(langKey);
  if (!re) return esc(text);
  let out = '';
  let last = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out += esc(text.slice(last, m.index));
    let cls = '';
    const groups = m.groups || {};
    for (let i = 0; i < rules.length; i++) {
      if (groups['k' + i] !== undefined) { cls = rules[i].cls; break; }
    }
    out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  out += esc(text.slice(last));
  return out;
}

/* ------------------------------------------------------------------ dialog */
function askText(title, value = '') {
  return new Promise((resolve) => {
    const modal = $('dlgModal'), input = $('dlgInput'), ok = $('dlgOk'), cancel = $('dlgCancel'), titleEl = $('dlgTitle');
    if (!modal || !input || !ok || !cancel) { resolve(null); return; }
    titleEl.textContent = title;
    input.value = value;
    modal.classList.remove('hidden');
    input.focus();
    input.select();
    const finish = (v) => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      modal.classList.add('hidden');
      resolve(v);
    };
    const onOk = () => finish(input.value.trim() || null);
    const onCancel = () => finish(null);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

/* -------------------------------------------------------------- kontekst menyu */
function closeCtx() {
  const menu = $('ctxMenu');
  if (menu) menu.classList.add('hidden');
}

function openCtx(x, y, items) {
  const menu = $('ctxMenu');
  if (!menu) return;
  menu.innerHTML = '';
  for (const item of items) {
    if (item.sep) {
      const hr = document.createElement('div');
      hr.className = 'sep';
      menu.appendChild(hr);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctx-item';
    btn.textContent = item.label;
    btn.addEventListener('click', (e) => { e.stopPropagation(); closeCtx(); item.run(); });
    menu.appendChild(btn);
  }
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');
}

/* ------------------------------------------------------------------ daraxt */
function insertInto(rootNode, relPath, e) {
  const parts = String(relPath).split('/').filter(Boolean);
  let node = rootNode;
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    const isLast = i === parts.length - 1;
    let child = node.byPath.get(acc);
    if (!child) {
      child = {
        name: parts[i],
        path: node.path ? `${node.path}/${acc}` : acc,
        dir: isLast ? !!e.dir : true,
        size: isLast ? e.size : 0,
        children: [],
        byPath: new Map(),
      };
      node.children.push(child);
      node.byPath.set(acc, child);
    }
    if (isLast) { child.dir = !!e.dir; child.size = e.size || 0; }
    node = child;
  }
}

/**
 * Yozuvlarni BITTA daraxt modeliga yig'amiz.
 * Qo'shimcha papkalar (`external`) tepada alohida tugun bo'ladi: ularning ichidagi fayllar
 * absolyut yo'l bilan keladi (`D:/umumiy/lib.js`), shuning uchun ular drayv harfi bo'yicha
 * bo'linmaydi — aks holda daraxtda sun'iy `D:` → `umumiy` qatlami paydo bo'lardi.
 */
function buildTreeModel(entries) {
  const root = { name: '', path: '', dir: true, children: [], byPath: new Map(), roots: [] };
  root.byPath.set('', root);
  const list = entries || [];
  // 1) Qo'shimcha ildizlar — tepada turgan alohida tugunlar.
  for (const e of list) {
    if (!e || !e.external || !e.path) continue;
    const node = {
      name: e.name || String(e.path).split('/').pop() || e.path,
      path: String(e.path),
      dir: true,
      external: true,
      root: e.root || e.path,
      children: [],
      byPath: new Map(),
    };
    root.children.push(node);
    root.roots.push(node);
  }
  // 2) Qolgan yozuvlar: qaysi ildizga tegishli bo'lsa o'shanga, aks holda asosiy daraxtga.
  for (const e of list) {
    if (!e || e.external || !e.path) continue;
    const p = String(e.path);
    const owner = root.roots.find((r) => p === r.path || p.startsWith(`${r.path}/`));
    if (owner) {
      insertInto(owner, p.slice(owner.path.length).replace(/^\//, ''), e);
      continue;
    }
    insertInto(root, p, e);
  }
  return root;
}

/* ------------------------------------------------- ko'p ildizli workspace */
function isRootOpen(path) { return !!(state.openRoots && state.openRoots.has(path)); }

/** Qo'shimcha papkani daraxtda ochish/yopish (ichi faqat ochilganda so'raladi). */
function toggleRoot(path) {
  state.openRoots = state.openRoots || new Set();
  if (state.openRoots.has(path)) state.openRoots.delete(path);
  else state.openRoots.add(path);
  refreshTree().catch((e) => catchLog('qo‘shimcha papka', e));
}

/** Ildizlar tasmasi: asosiy papka va qo'shimcha papkalar (bir bosishda olib tashlanadi). */
function renderRoots() {
  const host = $('ideRoots');
  const pad = $('rootsPad');
  if (!host) return;
  const roots = state.roots || [];
  if (pad) pad.classList.toggle('hidden', !state.workspace || !roots.length);
  host.innerHTML = '';
  if (!state.workspace || !roots.length) return;
  for (const r of roots) {
    const chip = document.createElement('div');
    chip.className = 'root-chip' + (r.primary ? ' primary' : '');
    chip.title = r.primary ? `asosiy papka: ${r.path}` : r.path;
    const name = document.createElement('span');
    name.className = 'root-name';
    name.textContent = r.name || r.path;
    chip.appendChild(name);
    if (!r.primary) {
      name.style.cursor = 'pointer';
      name.title = 'Fayl daraxtida ochish/yopish';
      name.addEventListener('click', () => toggleRoot(r.path));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'root-x';
      x.textContent = '✕';
      x.title = 'Ro‘yxatdan olib tashlash';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await safe(() => window.ide.rootsRemove(r.path));
        if (!res || !res.roots) return;
        state.roots = res.roots;
        if (state.openRoots) state.openRoots.delete(r.path);
        await refreshTree();
        toast(`Ro‘yxatdan olindi: ${r.name || r.path}`);
      });
      chip.appendChild(x);
    }
    host.appendChild(chip);
  }
}

/** Qo'shimcha papka qo'shish (bir nechtasini birdan tanlash mumkin). */
async function addRoot() {
  const r = await safe(() => window.ide.rootsAdd());
  if (!r) return;
  if (r.canceled) return;
  if (r.roots) state.roots = r.roots;
  const set = (state.openRoots = state.openRoots || new Set());
  for (const root of state.roots || []) if (!root.primary) set.add(root.path);
  await refreshTree();
  if (Array.isArray(r.roots) && r.roots.length > 1) toast('Qo‘shimcha papka qo‘shildi');
}

function matchesFilter(node) {
  if (!state.filter) return true;
  const f = state.filter.toLowerCase();
  if (node.path.toLowerCase().includes(f)) return true;
  return node.children.some(matchesFilter);
}

function renderTree() {
  const host = $('fileTree');
  if (!host) return;
  host.innerHTML = '';
  if (!state.treeRoot) {
    host.innerHTML = '<div class="dim">Papka tanlanmagan</div>';
    return;
  }
  const walk = (node, depth) => {
    for (const child of node.children) {
      if (!matchesFilter(child)) continue;
      const isExternal = !!child.external;
      const expanded = isExternal ? isRootOpen(child.path) : !state.collapsed.has(child.path);
      const row = document.createElement('div');
      row.className = 'tree-row' + (child.dir ? ' dir' : '') + (isExternal ? ' root' : '');
      if (child.path === state.active) row.classList.add('sel');
      row.style.paddingLeft = `${6 + depth * 12}px`;
      const arrow = child.dir ? (expanded ? '▾ ' : '▸ ') : '· ';
      row.textContent = `${arrow}${child.name}`;
      row.dataset.path = child.path;
      row.dataset.dir = child.dir ? '1' : '0';
      if (isExternal) row.title = `${child.path} — qo‘shimcha papka (asosiy papkadan tashqari)`;
      row.addEventListener('click', () => {
        if (child.dir) {
          if (isExternal) { toggleRoot(child.path); return; }
          if (state.collapsed.has(child.path)) state.collapsed.delete(child.path);
          else state.collapsed.add(child.path);
          renderTree();
        } else {
          openTab(child.path);
        }
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCtx(e.clientX, e.clientY, treeCtxItems(child));
      });
      host.appendChild(row);
      if (child.dir && expanded) walk(child, depth + 1);
    }
  };
  walk(state.treeRoot, 0);
}

function treeCtxItems(node) {
  // Qo'shimcha papkaning O'ZIGA fayl amallari taklif qilinmaydi (qamoq ildizning o'zini
  // yozish/o'chirishga ruxsat bermaydi) — faqat ro'yxatdan olib tashlash.
  if (node.external) {
    return [{
      label: 'Ro‘yxatdan olib tashlash',
      run: async () => {
        const r = await safe(() => window.ide.rootsRemove(node.path));
        if (!r || !r.roots) return;
        state.roots = r.roots;
        if (state.openRoots) state.openRoots.delete(node.path);
        await refreshTree();
        toast('Papka ro‘yxatdan olindi');
      },
    }];
  }
  const parentDir = node.dir ? node.path : node.path.split('/').slice(0, -1).join('/');
  const items = [];
  if (!node.dir) items.push({ label: 'Ochish', run: () => openTab(node.path) });
  items.push({
    label: 'Yangi fayl',
    run: async () => {
      const name = await askText('Yangi fayl nomi', 'yangi.txt');
      if (!name) return;
      const target = parentDir ? `${parentDir}/${name}` : name;
      const r = await safe(() => window.ide.create(target, false));
      if (r && r.ok) { toast(`Yaratildi: ${r.path}`); activity(`📝 yaratildi ${r.path}`, 'ok'); await refreshTree(); openTab(r.path); }
    },
  });
  items.push({
    label: 'Yangi papka',
    run: async () => {
      const name = await askText('Yangi papka nomi', 'papka');
      if (!name) return;
      const target = parentDir ? `${parentDir}/${name}` : name;
      const r = await safe(() => window.ide.create(target, true));
      if (r && r.ok) { toast(`Yaratildi: ${r.path}`); activity(`📁 papka ${r.path}`, 'ok'); await refreshTree(); }
    },
  });
  items.push({
    label: 'Nomini o‘zgartirish',
    run: async () => {
      const next = await askText('Yangi nom', node.path);
      if (!next || next === node.path) return;
      const r = await safe(() => window.ide.rename(node.path, next));
      if (r && r.ok) {
        toast(`Nomlandi: ${r.path}`);
        activity(`↻ ${node.path} → ${r.path}`, 'ok');
        const tab = state.tabs.find((t) => t.path === node.path);
        if (tab) tab.path = r.path;
        await refreshTree();
        renderTabs();
      }
    },
  });
  if (!node.dir) items.push({ label: 'Tashqi ilovada ochish', run: () => window.ide.openExternal(node.path) });
  items.push({ sep: true });
  items.push({
    label: 'O‘chirish',
    run: async () => {
      if (!window.confirm(`O‘chirilsinmi (savatga)?\n${node.path}`)) return;
      const r = await safe(() => window.ide.remove(node.path));
      if (r && r.ok) {
        toast(`Savatga: ${r.path}`);
        activity(`🗑 ${r.path}`, 'bad');
        const idx = state.tabs.findIndex((t) => t.path === node.path);
        if (idx >= 0) closeTabFile(state.tabs[idx]);
        await refreshTree();
      }
    },
  });
  return items;
}

async function safe(fn) {
  try {
    const r = await fn();
    if (r && r.error) { toast(r.error); return r; }
    return r;
  } catch (e) {
    catchLog('amal', e);
    return { error: String((e && e.message) || e) };
  }
}

async function refreshTree() {
  if (!state.workspace) { state.treeRoot = null; renderTree(); renderRoots(); return; }
  const r = await safe(() => window.ide.listTree('.', 3));
  if (!r || !r.entries) return;
  if (Array.isArray(r.roots) && r.roots.length) state.roots = r.roots;
  const entries = r.entries.slice();
  // Ochiq turgan qo'shimcha papkalar ichini ham SHU modelga qo'shamiz — shunda daraxt
  // yagona bo'lib qoladi (filtr, qidiruv va tez ochish ham ularni ko'radi).
  const primaryPath = (state.roots[0] || {}).path || '';
  for (const p of state.openRoots || []) {
    if (!p || p === primaryPath) continue;
    const rr = await safe(() => window.ide.listTree(p, 3));
    if (rr && rr.entries) entries.push(...rr.entries);
  }
  state.treeRoot = buildTreeModel(entries);
  renderTree();
  renderRoots();
}

function flatFiles() {
  const out = [];
  const walk = (node) => {
    for (const c of node.children) {
      if (c.dir) walk(c);
      else out.push(c.path);
    }
  };
  if (state.treeRoot) walk(state.treeRoot);
  return out;
}

/* ------------------------------------------------------------------- tablar */
function activeTab() {
  return state.tabs.find((t) => t.path === state.active) || null;
}

function langKeyFor(p) {
  const ext = String(p).split('.').pop().toLowerCase();
  return LANG_BY_EXT[ext] || 'txt';
}

function renderTabs() {
  const host = $('tabs');
  if (!host) return;
  host.innerHTML = '';
  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.path === state.active ? ' active' : '');
    el.title = tab.path;
    const name = document.createElement('span');
    name.textContent = tab.path.split('/').pop();
    el.appendChild(name);
    if (tab.dirty) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      el.appendChild(dot);
    }
    const close = document.createElement('span');
    close.textContent = ' ✕';
    close.style.cursor = 'pointer';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTabFile(tab); });
    el.appendChild(close);
    el.addEventListener('click', () => activateTab(tab.path));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTabFile(tab); } });
    host.appendChild(el);
  }
  const paths = state.tabs.map((t) => t.path);
  window.ide.saveTabs(paths).catch(() => {});
}

async function openTab(path, { activate = true, line = null } = {}) {
  const existing = state.tabs.find((t) => t.path === path);
  if (existing) {
    if (activate) activateTab(path);
    if (line) gotoLine(line);
    return;
  }
  const r = await safe(() => window.ide.readFile(path));
  if (!r || r.error || r.image) {
    if (r && r.image) toast('Rasm fayli — tashqi ilovada oching');
    return;
  }
  const tab = { path: r.path || path, text: r.text || '', saved: r.text || '', dirty: false, truncated: !!r.truncated };
  state.tabs.push(tab);
  activity(`📂 opened ${tab.path}`);
  renderTabs();
  if (activate) activateTab(tab.path);
  if (line) gotoLine(line);
  const ext = tab.path.split('.').pop().toLowerCase();
  if (['js', 'mjs', 'cjs', 'py', 'json'].includes(ext)) runDiagnostics(tab);
}

function activateTab(path) {
  if (state.active) {
    const prev = activeTab();
    if (prev) prev.scrollTop = $('editorArea') ? $('editorArea').scrollTop : 0;
  }
  state.active = path;
  const tab = activeTab();
  const pane = $('editorPane'), empty = $('emptyState');
  if (!tab) {
    if (pane) pane.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    renderTabs();
    if ($('dirtyLabel')) $('dirtyLabel').textContent = '';
    return;
  }
  if (empty) empty.classList.add('hidden');
  if (pane) pane.classList.remove('hidden');
  const area = $('editorArea');
  if (area) {
    area.value = tab.text;
    area.scrollTop = tab.scrollTop || 0;
  }
  hideAutocomplete();
  paint(true);
  renderTabs();
  updateDirty();
  updateCursor();
}

async function closeTabFile(tab) {
  if (tab.dirty && !window.confirm(`Saqlanmagan o‘zgarishlar bor: ${tab.path}\nYopilsinmi?`)) return;
  const idx = state.tabs.indexOf(tab);
  state.tabs.splice(idx, 1);
  if (state.active === tab.path) state.active = state.tabs[Math.min(idx, state.tabs.length - 1)]?.path || null;
  activateTab(state.active);
  renderTabs();
}

async function saveActive() {
  const tab = activeTab();
  if (!tab) { toast('Ochiq fayl yo‘q'); return; }
  const area = $('editorArea');
  const text = area ? area.value : tab.text;
  const r = await safe(() => window.ide.writeFile(tab.path, text));
  if (!r || !r.ok) return;
  tab.text = text;
  tab.saved = text;
  tab.dirty = false;
  toast(`Saqlangan: ${r.path}`);
  activity(`💾 saved ${r.path}`, 'ok');
  renderTabs();
  updateDirty();
  await runDiagnostics(tab);
}

/* ------------------------------------------------------------- muharrir dvigateli */
let charWidth = 7.8;

function measureChar() {
  const area = $('editorArea');
  if (!area) return;
  const cs = window.getComputedStyle(area);
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
  const w = ctx.measureText('MMMMMMMMMM').width / 10;
  if (w > 2) charWidth = w;
}

function linesOf(text) {
  return String(text).split('\n');
}

function lineOfIndex(text, index) {
  const upto = String(text).slice(0, index);
  const parts = upto.split('\n');
  return { line: parts.length, col: parts[parts.length - 1].length + 1 };
}

function indexOfLine(text, line) {
  const lines = String(text).split('\n');
  let idx = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) idx += lines[i].length + 1;
  return idx;
}

function paint(forceText = false) {
  const area = $('editorArea'), hl = $('highlight'), gutter = $('gutter');
  if (!area || !hl || !gutter) return;
  const tab = activeTab();
  const lang = tab ? langKeyFor(tab.path) : 'txt';
  const text = area.value;
  const big = text.length > HIGHLIGHT_MAX;
  // Katta faylda butun matnni tokenlash har bosishda sekundlab vaqt oladi — bo'yashni
  // o'chiramiz (matn textarea'da baribir ko'rinadi). Shu bilan chegarasiz tahrir + tez terish.
  hl.innerHTML = big ? '' : tokenize(text, lang);
  if (big !== state.bigMode) {
    state.bigMode = big;
    if ($('bigNote')) $('bigNote').textContent = big ? 'katta fayl: sintaksis bo‘yash o‘chirildi' : '';
  }
  const { line: curLine } = lineOfIndex(text, area.selectionStart);
  paintGutter(text, curLine, forceText);
  syncScroll();
}

// Qator raqamlari endi FAQAT ko'rinib turgan oyna uchun chiziladi (ilgari butun fayl uchun
// yasalardi — 100 000 qatorli faylda brauzer qotardi).
function paintGutter(text, curLine, forceText = false) {
  const area = $('editorArea'), gutter = $('gutter');
  if (!area || !gutter) return;
  let inner = gutter.firstElementChild;
  if (!inner || inner.id !== 'gutterLines') {
    inner = document.createElement('div');
    inner.id = 'gutterLines';
    gutter.innerHTML = '';
    gutter.appendChild(inner);
  }
  const count = linesOf(text).length;
  const viewH = area.clientHeight || 400;
  const visible = Math.ceil(viewH / LINE_H) + 2;
  const first = clamp(Math.floor(area.scrollTop / LINE_H) + 1, 1, Math.max(1, count));
  const last = Math.min(count, first + visible);
  const same = !forceText && Number(inner.dataset.from) === first
    && Number(inner.dataset.to) === last && Number(inner.dataset.count) === count;
  if (!same) {
    let html = '';
    for (let i = first; i <= last; i++) html += `<div class="gline">${i}</div>`;
    inner.innerHTML = html;
    inner.dataset.from = String(first);
    inner.dataset.to = String(last);
    inner.dataset.count = String(count);
    // Oyna suradi: konteyner butun hujjat ichida o'z o'rnida tursin.
    inner.style.paddingTop = `${(first - 1) * LINE_H}px`;
  }
  const cur = inner.children[curLine - first];
  if (cur && !cur.classList.contains('gutter-cur')) {
    for (const child of inner.children) child.classList.remove('gutter-cur');
    cur.classList.add('gutter-cur');
  } else if (cur) {
    // allaqachon shu qatorda — qolganlarini tozalash shart emas
  }
  state.gutterFirst = first;
}

function syncScroll() {
  const area = $('editorArea'), hl = $('highlight'), gutter = $('gutter');
  if (!area || !hl) return;
  hl.scrollTop = area.scrollTop;
  hl.scrollLeft = area.scrollLeft;
  const inner = gutter && gutter.firstElementChild;
  if (inner) inner.style.transform = `translateY(${-area.scrollTop}px)`;
  renderBreakDots();
  // Scroll paytida qator raqamlari oynasi siljiydi (cheksizlikda ham yengil qoladi).
  if (inner && (state.gutterFirst == null || Math.floor(area.scrollTop / LINE_H) + 1 !== state.gutterFirst)) {
    const { line } = lineOfIndex(area.value, area.selectionStart);
    paintGutter(area.value, line);
  }
}

function updateCursor() {
  const area = $('editorArea');
  if (!area) return;
  const { line, col } = lineOfIndex(area.value, area.selectionStart);
  if ($('cursorPos')) $('cursorPos').textContent = `Ln ${line}, Col ${col}`;
  scheduleHover();
  scheduleLspDiagnostics();
  const tab = activeTab();
  if ($('langLabel')) $('langLabel').textContent = tab ? LANG_NAME[langKeyFor(tab.path)] || 'Text' : '';
  const gutter = $('gutter');
  const inner = gutter && gutter.firstElementChild;
  if (inner) {
    const first = Number(inner.dataset.from) || 1;
    const cur = inner.children[line - first];
    if (cur && !cur.classList.contains('gutter-cur')) {
      for (const child of inner.children) child.classList.remove('gutter-cur');
      cur.classList.add('gutter-cur');
    }
    // Kursor oynadan tashqariga chiqsa oyna suriladi.
    if (line < first || line > (Number(inner.dataset.to) || first)) paintGutter(area.value, line);
  }
}

function updateDirty() {
  const tab = activeTab();
  if ($('dirtyLabel')) $('dirtyLabel').textContent = tab ? (tab.dirty ? 'o‘zgartirilgan' : 'saqlangan') : '';
}

/* Til xizmati (tsserver) uchun kechiktirilgan chaqiruvlar — pastda to'ldiriladi. */
let hoverTimer = null;
let lspTimer = null;
function scheduleHover() { if (typeof scheduleHoverImpl === 'function') scheduleHoverImpl(); }
function scheduleLspDiagnostics() { if (typeof scheduleLspDiagnosticsImpl === 'function') scheduleLspDiagnosticsImpl(); }

function markDirtyFromArea() {
  const tab = activeTab();
  const area = $('editorArea');
  if (!tab || !area) return;
  const dirty = area.value !== tab.saved;
  if (dirty !== tab.dirty) { tab.dirty = dirty; renderTabs(); updateDirty(); }
}

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

function handleEditorKey(e) {
  const area = $('editorArea');
  const tab = activeTab();
  if (!area || !tab) return;
  const start = area.selectionStart, end = area.selectionEnd;
  const value = area.value;
  const acOpen = $('autocomplete') && !$('autocomplete').classList.contains('hidden');

  if (acOpen && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
    if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
    const accepted = moveAutocomplete(e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, e.key === 'Enter' || e.key === 'Tab');
    if (accepted || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); return; }
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineText = value.slice(lineStart, end);
      const removed = lineText.replace(/^ {1,4}/gm, '');
      const diff = lineText.length - removed.length;
      area.value = value.slice(0, lineStart) + removed + value.slice(end);
      area.selectionStart = area.selectionEnd = Math.max(lineStart, start - diff);
    } else {
      area.value = value.slice(0, start) + '    ' + value.slice(end);
      area.selectionStart = area.selectionEnd = start + 4;
    }
    afterEdit();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const currentLine = value.slice(lineStart, start);
    const indentMatch = currentLine.match(/^[ \t]*/);
    let indent = indentMatch ? indentMatch[0] : '';
    const trimmed = currentLine.trimEnd();
    const lang = langKeyFor(tab.path);
    const opensBlock = lang === 'py' ? /[:([]$/.test(trimmed) : /[{([\]]$/.test(trimmed);
    if (opensBlock) {
      indent += '    ';
    } else if (lang === 'py' && /^\s*(return|pass|break|continue)\b/.test(trimmed) && indent.length >= 4) {
      indent = indent.slice(0, -4);
    }
    const insert = `\n${indent}`;
    area.value = value.slice(0, start) + insert + value.slice(end);
    area.selectionStart = area.selectionEnd = start + insert.length;
    afterEdit();
    return;
  }

  if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === '/' || e.key === '?' || e.code === 'Slash')) {
    e.preventDefault();
    toggleComment();
    return;
  }

  if (PAIRS[e.key] && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const nextChar = value[start];
    if (e.key === '"' || e.key === "'" || e.key === '`') {
      if (start === end && nextChar === e.key) {
        e.preventDefault();
        area.selectionStart = area.selectionEnd = start + 1;
        updateCursor();
        return;
      }
    }
    if (start === end) {
      e.preventDefault();
      const close = PAIRS[e.key];
      area.value = value.slice(0, start) + e.key + close + value.slice(end);
      area.selectionStart = area.selectionEnd = start + 1;
      afterEdit();
      return;
    }
  }

  if ([')', ']', '}', '"', "'", '`'].includes(e.key) && start === end) {
    const nextChar = value[start];
    if (nextChar === e.key) {
      e.preventDefault();
      area.selectionStart = area.selectionEnd = start + 1;
      updateCursor();
      return;
    }
  }

  if (e.key === 'Backspace' && start === end && start > 0) {
    const before = value[start - 1], after = value[start];
    if (PAIRS[before] && PAIRS[before] === after) {
      e.preventDefault();
      area.value = value.slice(0, start - 1) + value.slice(start + 1);
      area.selectionStart = area.selectionEnd = start - 1;
      afterEdit();
    }
  }
}

function toggleComment() {
  const area = $('editorArea');
  const tab = activeTab();
  if (!area || !tab) return;
  const lang = langKeyFor(tab.path);
  const marker = lang === 'py' ? '#' : '//';
  const value = area.value;
  const start = area.selectionStart, end = area.selectionEnd;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allCommented = lines.every((l) => !l.trim() || l.trimStart().startsWith(marker));
  const next = lines.map((l) => {
    if (allCommented) return l.replace(new RegExp(`^(\\s*)${marker === '#' ? '#' : '\\/\\/'}\\s?`), '$1');
    return l.replace(/^(\s*)/, `$1${marker} `);
  }).join('\n');
  area.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
  area.selectionStart = lineStart;
  area.selectionEnd = lineStart + next.length;
  afterEdit();
}

function afterEdit() {
  const tab = activeTab();
  const area = $('editorArea');
  if (!tab || !area) return;
  tab.text = area.value;
  markDirtyFromArea();
  paint();
  updateCursor();
  scheduleDiagnostics(tab);
  scheduleAutocomplete();
}

let diagTimer = null;
function scheduleDiagnostics(tab) {
  clearTimeout(diagTimer);
  diagTimer = setTimeout(() => runDiagnostics(tab), 900);
}

async function runDiagnostics(tab) {
  const r = await safe(() => window.ide.diagnostics(tab.path));
  if (!r) return;
  // Sintaksis natijasi semantik (tsserver/pyflakes) natijasi bilan BIRLASHTIRILADI.
  mergeProblems(tab.path, 'lite', r.items || [], r.note || null);
}

function renderProblems(items, note, tabPath) {
  const box = $('problemsPanel');
  const countEl = $('problemsCount');
  const tab = activeTab();
  if (tabPath) state.problems[tabPath] = items;
  if (tabPath && tab && tab.path !== tabPath) return;
  if (countEl) countEl.textContent = String(items.length);
  if (!box) return;
  box.innerHTML = '';
  if (note) {
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.textContent = note;
    box.appendChild(dim);
  }
  if (!items.length && !note) {
    const ok = document.createElement('div');
    ok.className = 'dim';
    ok.textContent = 'Muammo topilmadi';
    box.appendChild(ok);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    // Semantik xatolar (tsserver/pyflakes) alohida belgilanadi — manba ko'rinsin.
    row.className = `problem-row ${item.source && item.source !== 'lite' ? 'semantic' : 'error'}`;
    const tag = item.source === 'tsserver' ? '[ts] ' : item.source === 'pyflakes' ? '[py] ' : '';
    row.textContent = `Ln ${item.line}: ${tag}${item.message}`;
    row.title = item.source ? `manba: ${item.source}${item.code ? ` · kod ${item.code}` : ''}` : '';
    row.addEventListener('click', () => gotoLine(item.line));
    box.appendChild(row);
  }
}

function gotoLine(line) {
  const area = $('editorArea');
  if (!area || !line) return;
  const idx = indexOfLine(area.value, line);
  const lineEnd = area.value.indexOf('\n', idx);
  area.focus();
  area.selectionStart = idx;
  area.selectionEnd = lineEnd === -1 ? area.value.length : lineEnd;
  const target = clamp((line - 2) * LINE_H, 0, Math.max(0, area.scrollHeight));
  area.scrollTop = target;
  paint();
  updateCursor();
}

/* ------------------------------------------------------------ avto to'ldirish */
let acTimer = null;
let acItems = [];
let acIndex = 0;

function scheduleAutocomplete() {
  clearTimeout(acTimer);
  acTimer = setTimeout(showAutocomplete, 180);
}

function currentWord(area) {
  const value = area.value;
  let i = area.selectionStart;
  let start = i;
  while (start > 0 && /[A-Za-z0-9_$]/.test(value[start - 1])) start--;
  return { partial: value.slice(start, i), start, end: i };
}

function showAutocomplete() {
  const area = $('editorArea');
  const box = $('autocomplete');
  const tab = activeTab();
  if (!area || !box || !tab) return;
  const { partial, start, end } = currentWord(area);
  if (end !== area.selectionEnd || partial.length < 2) { hideAutocomplete(); return; }
  const lang = langKeyFor(tab.path);
  const found = new Map();
  const re = /[A-Za-z_$][A-Za-z0-9_$]{1,}/g;
  let m;
  while ((m = re.exec(area.value))) {
    if (m[0].startsWith(partial) && m[0] !== partial) found.set(m[0], (found.get(m[0]) || 0) + 1);
  }
  for (const kw of KEYWORDS[lang] || []) {
    if (kw.startsWith(partial) && kw !== partial) found.set(kw, (found.get(kw) || 0) + 5);
  }
  const list = [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  if (!list.length) { hideAutocomplete(); return; }
  acItems = list.map(([word]) => word);
  acIndex = 0;
  box.innerHTML = '';
  acItems.forEach((word, i) => {
    const row = document.createElement('div');
    row.className = 'ac-item' + (i === 0 ? ' sel' : '');
    row.textContent = word;
    row.addEventListener('mousedown', (e) => { e.preventDefault(); acceptAutocomplete(word, start, end); });
    box.appendChild(row);
  });
  const { line, col } = lineOfIndex(area.value, area.selectionStart);
  const left = clamp(12 + (col - 1) * charWidth - area.scrollLeft, 6, 400);
  const top = clamp(TOP_PAD + line * LINE_H - area.scrollTop, 6, 320);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.classList.remove('hidden');
}

function hideAutocomplete() {
  const box = $('autocomplete');
  if (box) box.classList.add('hidden');
  acItems = [];
}

function moveAutocomplete(delta, accept) {
  const box = $('autocomplete');
  if (!box || box.classList.contains('hidden') || !acItems.length) return false;
  if (accept) {
    const area = $('editorArea');
    const { start, end } = currentWord(area);
    acceptAutocomplete(acItems[acIndex], start, end);
    return true;
  }
  acIndex = (acIndex + delta + acItems.length) % acItems.length;
  [...box.children].forEach((row, i) => row.classList.toggle('sel', i === acIndex));
  return false;
}

function acceptAutocomplete(word, start, end) {
  const area = $('editorArea');
  if (!area) return;
  area.value = area.value.slice(0, start) + word + area.value.slice(end);
  area.selectionStart = area.selectionEnd = start + word.length;
  hideAutocomplete();
  afterEdit();
}

/* ------------------------------------------------------------------ terminal */
const ANSI_COLORS = {
  30: '#6b7280', 31: '#f87171', 32: '#6ee7a8', 33: '#fbbf24', 34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e5e7eb',
  90: '#6b7280', 91: '#fca5a5', 92: '#86efac', 93: '#fde68a', 94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#f9fafb',
};

function ansiToHtml(raw) {
  const cleaned = String(raw).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, (m) => (m.endsWith('m') ? m : ''));
  const parts = cleaned.split(/\x1b\[([0-9;]*)m/);
  let color = null;
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      const text = esc(parts[i]);
      out += color ? `<span style="color:${color}">${text}</span>` : text;
    } else {
      const codes = parts[i].split(';').filter((c) => c !== '').map(Number);
      if (!codes.length || codes.includes(0)) { color = null; continue; }
      const hit = codes.find((c) => ANSI_COLORS[c]);
      color = hit ? ANSI_COLORS[hit] : null;
    }
  }
  return out;
}

function renderTerminal() {
  const out = $('termOut');
  if (!out) return;
  out.innerHTML = ansiToHtml(state.termBuffer);
  out.scrollTop = out.scrollHeight;
}

function pushTerminal(chunk) {
  state.termBuffer += String(chunk);
  if (state.termBuffer.length > 200000) state.termBuffer = state.termBuffer.slice(-200000);
  renderTerminal();
}

async function runTermCommand(cmd) {
  const text = String(cmd || '').trim();
  if (!text) return;
  state.termHistory.push(text);
  state.termIdx = state.termHistory.length;
  const r = await safe(() => window.ide.runCommand(text, undefined));
  if (r && r.cd) {
    pushTerminal(`\u001b[90m${r.cd}\u001b[0m\r\n`);
    if ($('statusLeft')) $('statusLeft').textContent = `cwd: ${r.cd}`;
  }
}

function showPanel(which) {
  const bottom = $('bottomPanel');
  if (bottom) bottom.classList.remove('hidden');
  const map = { terminal: 'terminalPanel', problems: 'problemsPanel', activity: 'activityPanel' };
  for (const [key, id] of Object.entries(map)) {
    const el = $(id);
    if (el) el.classList.toggle('hidden', key !== which);
  }
  const tabs = document.querySelectorAll('#panelTabs button[data-panel]');
  tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.panel === which));
}

/* ------------------------------------------------------------------ qidiruv */
async function runSearch() {
  const input = $('searchInput');
  const box = $('searchResults');
  if (!input || !box) return;
  const q = input.value.trim();
  box.innerHTML = '';
  if (!q) return;
  const r = await safe(() => window.ide.search(q, false));
  if (!r || !r.results) return;
  if (!r.results.length) {
    box.innerHTML = '<div class="dim">Topilmadi</div>';
    return;
  }
  for (const hit of r.results) {
    const row = document.createElement('div');
    row.className = 'problem-row';
    row.textContent = `${hit.path}:${hit.line}  ${hit.text}`;
    row.addEventListener('click', async () => { await openTab(hit.path, { line: hit.line }); });
    box.appendChild(row);
  }
}

function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastHit = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += lastHit === i - 1 ? 3 : 1;
      lastHit = i;
      qi++;
    }
  }
  if (qi < q.length) return -1;
  return score - text.length * 0.01;
}

function renderQuickOpen() {
  const input = $('searchInput');
  const box = $('searchResults');
  if (!input || !box) return;
  const q = input.value.trim();
  box.innerHTML = '';
  const files = flatFiles();
  const ranked = files
    .map((f) => ({ f, s: q ? fuzzyScore(q, f) : 1 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 40);
  if (!ranked.length) { box.innerHTML = '<div class="dim">Fayl topilmadi</div>'; return; }
  ranked.forEach(({ f }, i) => {
    const row = document.createElement('div');
    row.className = 'problem-row' + (i === 0 ? ' sel' : '');
    row.textContent = f;
    row.addEventListener('click', () => openTab(f));
    box.appendChild(row);
  });
}

/* ------------------------------------------------- ta'rifga o'tish (lite-LSP) */
// Kursor ostidagi so'z nomidan kelib chiqib, workspace ichidan ta'rifni qidiradi:
//   Python/JS: `def foo` / `class Foo` / `function foo` / `const foo =`
// Bu to'liq LSP emas, lekin lite-LSP qatlamining mantiqiy davomi — mavjud
// `ide:search` IPC'sidan foydalanadi, yangi kanal qo'shmaydi.
async function goToDefinition() {
  const area = $('editorArea');
  const tab = activeTab();
  if (!area || !tab) { toast('Avval fayl oching'); return; }
  const value = area.value;
  let start = area.selectionStart;
  let end = area.selectionEnd;
  // Kursor so'z o'rtasida bo'lsa ham so'zni to'liq olamiz (yoki tanlovni).
  if (start === end) {
    while (start > 0 && /[A-Za-z0-9_$]/.test(value[start - 1])) start--;
    while (end < value.length && /[A-Za-z0-9_$]/.test(value[end])) end++;
  }
  const word = value.slice(start, end);
  if (!word || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(word)) { toast('So‘z ustiga kursor qo‘ying'); return; }
  // 1) Haqiqiy til xizmati (tsserver): qayerda e'lon qilinganini aniq biladi.
  if (lspEligible(tab.path)) {
    const pos = lineOfIndex(value, area.selectionStart);
    const def = await safe(() => window.ide.lspDefinition(tab.path, pos.line, pos.col, value));
    const first = def && def.items && def.items[0];
    if (first && first.path) {
      await openTab(first.path, { line: first.line });
      gotoLine(first.line);
      activity(`⌖ ${word} → ${first.path}:${first.line} (tsserver)`, 'ok');
      return;
    }
  }
  // 2) Til xizmati topmasa — zaxira: matn bo‘yicha qidiruv (eski lite usul).
  const r = await safe(() => window.ide.search(word, true));
  if (!r || !r.results || !r.results.length) { toast(`Ta'rif topilmadi: ${word}`); return; }
  // Ta'rif qatorini afzal ko'ramiz (def/class/function/const), keyin birinchi mos.
  const re = new RegExp(`(?:^|\\s)(?:def|class|function|const|let|var|func|type|interface)\\s+${word}\\b`);
  const hit = r.results.find((x) => re.test(String(x.text))) || r.results[0];
  await openTab(hit.path, { line: hit.line });
  activity(`⌖ ${word} → ${hit.path}:${hit.line}`);
}

function quickOpenFirst() {
  const box = $('searchResults');
  if (!box) return;
  const first = box.querySelector('.problem-row');
  if (first) openTab(first.textContent);
}

/* --------------------------------------------------------------- topish paneli */
function findTarget() {
  const area = $('editorArea');
  return area && !$('editorPane')?.classList.contains('hidden') ? area : null;
}

function findMatches(area, needle) {
  if (!needle) return [];
  const text = area.value;
  const out = [];
  let idx = text.indexOf(needle);
  while (idx !== -1 && out.length < 500) {
    out.push(idx);
    idx = text.indexOf(needle, idx + needle.length);
  }
  return out;
}

function updateFindCount() {
  const bar = $('findBar');
  const input = $('findInput');
  const area = findTarget();
  if (!bar || !input || !area) return;
  let span = $('findCount');
  if (!span) {
    span = document.createElement('span');
    span.id = 'findCount';
    bar.appendChild(span);
  }
  const n = findMatches(area, input.value).length;
  span.textContent = input.value ? `${n} ta mos` : '';
}

function findStep(dir) {
  const input = $('findInput');
  const area = findTarget();
  if (!input || !area || !input.value) return;
  const matches = findMatches(area, input.value);
  if (!matches.length) return;
  const from = dir > 0 ? area.selectionEnd : area.selectionStart - 1;
  let target = matches.find((m) => (dir > 0 ? m >= from : m < from));
  if (target === undefined) target = dir > 0 ? matches[0] : matches[matches.length - 1];
  area.focus();
  area.selectionStart = target;
  area.selectionEnd = target + input.value.length;
  const { line } = lineOfIndex(area.value, target);
  area.scrollTop = Math.max(0, (line - 3) * LINE_H);
  paint();
  updateCursor();
  updateFindCount();
}

function replaceOne() {
  const area = findTarget();
  const f = $('findInput'), r = $('replaceInput');
  if (!area || !f || !r || !f.value) return;
  const sel = area.value.slice(area.selectionStart, area.selectionEnd);
  if (sel === f.value) {
    area.value = area.value.slice(0, area.selectionStart) + r.value + area.value.slice(area.selectionEnd);
    area.selectionStart = area.selectionEnd = area.selectionStart + r.value.length;
    afterEdit();
  }
  findStep(1);
}

function replaceAll() {
  const area = findTarget();
  const f = $('findInput'), r = $('replaceInput');
  if (!area || !f || !r || !f.value) return;
  const count = findMatches(area, f.value).length;
  area.value = area.value.split(f.value).join(r.value);
  afterEdit();
  updateFindCount();
  toast(`${count} ta almashtirildi`);
}

/* --------------------------------------------------------------------- AI */
function aiLine(cls, text) {
  const log = $('aiLog');
  if (!log) return;
  const el = document.createElement('div');
  el.className = `ai-msg ${cls}`;
  el.innerHTML = esc(text).replace(/\n/g, '<br>');
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function toolSummary(ev) {
  const args = ev.args || {};
  const what = args.path || args.command || args.query || args.pattern || '';
  return `${ev.tool || 'tool'} ${String(what).slice(0, 160)}`;
}

async function runAi(prompt, team) {
  if (state.aiBusy) { toast('AI band — avval to‘xtating'); return; }
  state.aiBusy = true;
  stopAllVisible();
  state.teamDoneSeen = false;
  if (team) aiLine('tool', '👥 Jamoa rejimi yoqilgan — planner, agentlar, reviewer va lead ishlaydi');
  aiLine('user', prompt);
  const r = await safe(() => window.ide.aiRun(prompt, !!team));
  if (!r || r.error) { state.aiBusy = false; stopAllVisible(); }
}

async function initAi() {
  const st = await safe(() => window.ide.aiStatus());
  const sel = $('aiModelSelect');
  if (!st || st.error || !sel) {
    activity(`AI: ${(st && st.error) || 'holat olinmadi'}`, 'bad');
    return;
  }
  sel.innerHTML = '';
  for (const p of st.providers || []) {
    for (const model of p.models || []) {
      const opt = document.createElement('option');
      opt.value = `${p.id}|${model}`;
      opt.textContent = `${p.name} · ${model}`;
      if (p.id === st.provider && model === st.model) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  sel.addEventListener('change', async () => {
    const [pid, mid] = String(sel.value).split('|');
    const r = await safe(() => window.ide.aiSetModel(pid, mid));
    if (r && !r.error) toast(`Model: ${mid}`);
  });
  activity(`AI tayyor: ${st.provider} · ${st.model}`);
}

function onAiEvent(ev) {
  if (!ev || !ev.type) return;
  try {
    // ---- JAMOA REJIMI: TeamRunner hodisalari ----
    if (ev.type === 'team_plan') {
      const agents = Array.isArray(ev.agents) ? ev.agents : [];
      aiLine('tool', `👥 Jamoa tuzildi: ${agents.length} agent`);
      for (const a of agents) aiLine('tool', `   ${a.icon || '•'} ${a.name} (${a.role}) — ${String(a.task || '').slice(0, 120)}`);
      activity(`👥 jamoa: ${agents.map((a) => a.name).join(', ')}`);
    } else if (ev.type === 'team_assign') {
      aiLine('tool', `   🔌 ${ev.agent} → ${ev.provider} · ${ev.model}`);
    } else if (ev.type === 'agent_begin') {
      aiLine('tool', `▶ ${ev.icon || ''} ${ev.name} (${ev.role})${ev.model ? ` · ${ev.model}` : ''}`);
    } else if (ev.type === 'agent_end') {
      const head = `✓ ${ev.icon || ''} ${ev.name} tugatdi`;
      aiLine('tool', ev.summary ? `${head}\n${String(ev.summary).slice(0, 700)}` : head);
      activity(`✅ ${ev.name} — tugatildi`, 'ok');
    } else if (ev.type === 'team_audit') {
      const arts = Array.isArray(ev.artifacts) ? ev.artifacts : [];
      const missing = Array.isArray(ev.outstanding) ? ev.outstanding.length : 0;
      if (arts.length) aiLine('tool', `🔍 tekshiruv${ev.stage ? ` (${ev.stage})` : ''}: ${arts.length} fayl${missing ? ` · ${missing} ta kam` : ' · to‘liq'}`);
    } else if (ev.type === 'team_done') {
      state.teamDoneSeen = true;
      aiLine('', String(ev.summary || 'jamoa yakunladi'));
      activity('🏁 jamoa ishini yakunladi', ev.complete === false ? 'bad' : 'ok');
    } else if (ev.type === 'provider_used') {
      activity(`🤖 ${ev.provider} · ${ev.model}`);
    } else if (ev.type === 'tools') {
      // e'tiborsiz: TOOL_SPECS ro'yxati
    } else if (ev.type === 'tool_start') {
      aiLine('tool', `▸ ${toolSummary(ev)}`);
      activity(`🤖 AI: ${toolSummary(ev)}`);
    } else if (ev.type === 'tool') {
      const cls = ev.ok === false ? 'err' : 'tool';
      const files = Array.isArray(ev.files) && ev.files.length ? ` → ${ev.files.slice(0, 4).join(', ')}` : '';
      aiLine(cls, `${ev.ok === false ? '✖' : '✓'} ${ev.tool}${files}`);
      if (Array.isArray(ev.files)) {
        for (const f of ev.files.slice(0, 5)) activity(`${ev.ok === false ? '✖' : '✅'} ${f} — tugatildi`, ev.ok === false ? 'bad' : 'ok');
      }
    } else if (ev.type === 'assistant' && ev.text) {
      aiLine('', ev.text);
    } else if (ev.type === 'notice' && ev.text) {
      aiLine('tool', ev.text);
    } else if (ev.type === 'error') {
      aiLine('err', `xato: ${ev.message || ''}`);
      activity(`🤖 AI xato: ${String(ev.message || '').slice(0, 120)}`, 'bad');
      state.aiBusy = false;
      stopAllVisible();
    } else if (ev.type === 'done' || ev.type === 'run_finished') {
      // Yakuniy javob: jamoa bo'lsa team_done allaqachon chiqargan, oddiy rejimda shu yerda.
      if (ev.type === 'done' && ev.content && !state.teamDoneSeen) aiLine('', String(ev.content));
      if (ev.type === 'done') aiLine('tool', 'tayyor');
      state.aiBusy = false;
      stopAllVisible();
      refreshTree();
      reloadCleanTabs();
    }
  } catch (e) {
    catchLog('AI hodisasi', e);
  }
}

async function reloadCleanTabs() {
  for (const tab of [...state.tabs]) {
    if (tab.dirty) continue;
    const r = await safe(() => window.ide.readFile(tab.path));
    if (r && typeof r.text === 'string' && r.text !== tab.saved) {
      tab.text = r.text;
      tab.saved = r.text;
      if (tab.path === state.active) {
        const area = $('editorArea');
        if (area) { area.value = r.text; paint(true); }
      }
      activity(`♻ yangilandi ${tab.path}`);
    }
  }
}

async function aiFixFromContext() {
  const tab = activeTab();
  const probs = tab ? (state.problems[tab.path] || []).slice(0, 5).map((p) => `Ln ${p.line}: ${p.message}`) : [];
  // TARIX ham kontekstga kiradi: model oldingi urinishlar natijasini ko'radi (shu sabab
  // bir xil xatoni qayta urinmaydi) — "o'zi logni ko'rib tuzatadimi?" savolining javobi.
  const hist = (state.runLog || []).slice(-4).map((r) => `- ${r.path || ''} → kod ${r.code}${r.timedOut ? ' (vaqt tugadi)' : ''}\n  chiqish oxiri: ${String(r.output || '').split('\n').slice(-6).join(' | ').slice(0, 400)}`);
  const parts = [
    'Terminaldagi xatoni topib tuzatib ber va ishga tushirib tasdiqla.',
    `Faol fayl: ${tab ? tab.path : '(ochiq fayl yo‘q)'}`,
    probs.length ? `Muammolar:\n${probs.join('\n')}` : '',
    hist.length ? `Yurishlar TARIXI (oxirgisi eng yangi):\n${hist.join('\n')}` : '',
    `Terminal chiqishi (oxirgi qism):\n${state.termBuffer.slice(-4000) || '(bo‘sh)'}`,
  ].filter(Boolean);
  await runAi(parts.join('\n\n'), false);
}

/* =====================================================================================
   HAQIQIY TERMINAL (PTY + xterm.js)
   Ilgari terminal `spawn` + quvur edi: buyruq chiqishi kelardi, lekin interaktiv dasturlar
   (vim, top, ssh, python REPL) ishlamasdi. Endi ConPTY orqali haqiqiy psevdo-terminal
   ochiladi va xterm.js uni ekranga chizadi — ya'ni bu CHINAKAM terminal.
   PTY yuklanmasa IDE o'sha eski (quvur) rejimga tushadi — hech narsa buzilmaydi.
   ===================================================================================== */
const term = { mode: 'pipe', x: null, fit: null, id: null, resizeObserver: null };

function setTermNote(text) {
  if ($('termNote')) $('termNote').textContent = text || '';
}

async function initTerminal() {
  const host = $('xtermHost');
  if (!host || term.x) return;
  const info = await safe(() => window.ide.ptyInfo());
  if (!info || !info.available) {
    term.mode = 'pipe';
    setTermNote(`oddiy rejim (PTY yo‘q${info && info.reason ? `: ${String(info.reason).slice(0, 50)}` : ''})`);
    return;
  }
  if (typeof window.Terminal !== 'function') {
    term.mode = 'pipe';
    setTermNote('oddiy rejim (xterm.js topilmadi — npm run vendor:ide)');
    return;
  }
  const x = new window.Terminal({
    fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    fontSize: 12.5,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 8000,
    allowProposedApi: true,
    theme: {
      background: '#0b0d12', foreground: '#d7dbe6', cursor: '#8aa2ff',
      selectionBackground: 'rgba(108,140,255,0.32)',
      black: '#1b1f2a', red: '#f87171', green: '#6ee7a8', yellow: '#fbbf24',
      blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e5e7eb',
    },
  });
  try {
    const fit = new window.FitAddon.FitAddon();
    x.loadAddon(fit);
    term.fit = fit;
  } catch { term.fit = null; }
  x.open(host);
  host.classList.remove('hidden');
  $('termOut')?.classList.add('hidden');
  $('termFallbackRow')?.classList.add('hidden');
  term.x = x;
  term.mode = 'pty';
  x.onData((data) => { if (term.id) window.ide.ptyWrite(term.id, data); });
  ptyFit();
  await openPtySession();

  window.ide.onPtyData((d) => {
    try { if (d && d.id === term.id && term.x) term.x.write(d.chunk); } catch (e) { catchLog('PTY oqimi', e); }
  });
  window.ide.onPtyExit((d) => {
    if (!d || d.id !== term.id) return;
    term.id = null;
    if (term.x) term.x.write(`\r\n\u001b[90m[sessiya tugadi — kod ${d.code}]\u001b[0m\r\n`);
    setTermNote(`sessiya yopildi (kod ${d.code})`);
    activity(`⌨ terminal sessiyasi tugadi (kod ${d.code})`);
  });
  // Panel o'lchami o'zgarsa PTY ham o'sha o'lchamga o'tadi (vim kabi TUI lar to'g'ri chiziladi).
  if (window.ResizeObserver) {
    term.resizeObserver = new ResizeObserver(() => { clearTimeout(term._rt); term._rt = setTimeout(ptyFit, 120); });
    term.resizeObserver.observe(host);
  }
}

async function openPtySession() {
  if (term.mode !== 'pty' || term.id) return;
  const cols = term.x ? term.x.cols : 100;
  const rows = term.x ? term.x.rows : 24;
  const cwd = state.workspace ? state.workspace.path : undefined;
  const r = await safe(() => window.ide.ptyOpen({ cols, rows, cwd }));
  if (!r || r.error) {
    term.mode = 'pipe';
    setTermNote(`terminal ochilmadi: ${(r && r.error) || 'xato'} — oddiy rejim`);
    $('xtermHost')?.classList.add('hidden');
    $('termOut')?.classList.remove('hidden');
    $('termFallbackRow')?.classList.remove('hidden');
    renderTerminal();
    return;
  }
  term.id = r.id;
  const shellName = String(r.shell || '').split(/[\\/]/).pop();
  setTermNote(`PTY · ${shellName} · ${r.cwd}`);
  if (term.x) term.x.focus();
}

function ptyFit() {
  if (term.mode !== 'pty') return;
  try { term.fit && term.fit.fit(); } catch { /* o'lcham hali yo'q */ }
  if (term.id && term.x) window.ide.ptyResize(term.id, term.x.cols, term.x.rows);
}

/** Terminalga yozish: PTY bo'lsa xterm'ga, baribir tarix uchun buferga ham. */
function termWrite(text) {
  const s = String(text == null ? '' : text);
  if (term.mode === 'pty' && term.x) {
    // Quvur rejimidagi chiqish ANSI ranglar bilan keladi — xterm ularni o'zi tushunadi.
    term.x.write(s.replace(/\n/g, '\r\n'));
  }
  pushTerminal(s);
}

function restartPty() {
  if (term.mode !== 'pty') return;
  if (term.id) { window.ide.ptyClose(term.id); term.id = null; }
  openPtySession();
}

/* =====================================================================================
   TARIX (log) — har bir yurish: buyruq, chiqish kodi, vaqt, chiqish oxiri.
   AI tuzatish halqasi ham, «Xatoni tuzat» ham shu tarixdan oziqlanadi.
   ===================================================================================== */
async function loadHistory() {
  const r = await safe(() => window.ide.runLog());
  state.runLog = (r && r.runs) || [];
  renderHistory(state.runLog);
}

function renderHistory(runs) {
  const box = $('historyPanel');
  if (!box) return;
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'dim';
  head.textContent = runs && runs.length
    ? `${runs.length} yurish saqlangan · qatorni bosing — chiqish ko‘rinadi`
    : 'Hali yurish bo‘lmagan. F5 yoki «Sinab ko‘r + tuzat» bilan sinab ko‘ring.';
  box.appendChild(head);
  for (const run of [...(runs || [])].reverse()) {
    const row = document.createElement('div');
    row.className = `hist-row ${run.code === 0 ? 'ok' : 'bad'}`;
    const time = new Date(run.ts).toLocaleTimeString();
    row.textContent = `${run.code === 0 ? '✓' : '✖'} ${time} · ${run.path || '(buyruq)'} · kod ${run.code}${run.seconds ? ` · ${run.seconds}s` : ''}`;
    row.title = 'Chiqishni ko‘rish/yashirish';
    row.addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('hist-out')) { next.remove(); return; }
      const pre = document.createElement('pre');
      pre.className = 'hist-out';
      pre.textContent = `$ ${run.command || ''}\n${run.output || '(chiqish bo‘sh)'}`;
      row.after(pre);
    });
    box.appendChild(row);
  }
}

let fixBusy = false;
let runBusy = false;          // dastur ishga tushirilgan va hali tugamagan

/**
 * «■ To‘xtatish» tugmasi faqat ish borligida ko‘rinadi. Ilgari bu tugma umuman yo‘q edi:
 * yadroda `fix-stop`/`run-stop` va `abort()` bor edi, lekin UI ularni hech qachon chaqirmasdi
 * — «Sinab ko‘r + tuzat» bosilgach faqat «Sinab ko‘rilyapti…» bo‘lib qolardi va vazifani
 * to‘xtatishning yo‘li yo‘q edi.
 */
function stopAllVisible() {
  const btn = $('stopAllBtn');
  if (!btn) return;
  const what = state.aiBusy ? 'AI' : fixBusy ? 'tuzatish halqasi' : runBusy ? 'dastur' : '';
  btn.textContent = what ? `■ To‘xtatish (${what})` : '■ To‘xtatish';
  btn.classList.toggle('hidden', !what);
}

/** Ishlayotgan hamma narsani to‘xtatadi: AI so‘rovi, yurish, tuzatish halqasi, debugger. */
async function stopAll() {
  const wasBusy = !!(state.aiBusy || fixBusy || runBusy);
  state.aiBusy = false;
  fixBusy = false;
  runBusy = false;
  await safe(() => window.ide.aiStop());
  await safe(() => window.ide.fixStop());
  await safe(() => window.ide.runStop());
  await safe(() => window.ide.debugStop());
  if ($('runFixBtn')) { $('runFixBtn').disabled = false; $('runFixBtn').textContent = 'Sinab ko‘r + tuzat'; }
  stopAllVisible();
  if (wasBusy) { activity('⏹ to‘xtatildi', 'bad'); toast('To‘xtatildi'); }
}

async function runFixLoop() {
  const tab = activeTab();
  if (!tab) { toast('Avval faylni oching'); return; }
  if (fixBusy) { toast('Tuzatish halqasi allaqachon ishlayapti'); return; }
  if (tab.dirty) await saveActive();
  fixBusy = true;
  showPanel('history');
  if ($('runFixBtn')) { $('runFixBtn').disabled = true; $('runFixBtn').textContent = 'Sinab ko‘rilyapti…'; }
  stopAllVisible();
  activity(`🛠 sinab ko‘rish + tuzatish: ${tab.path}`, 'ok');
  const r = await safe(() => window.ide.fixRun(tab.path, 3));
  fixBusy = false;
  stopAllVisible();
  if ($('runFixBtn')) { $('runFixBtn').disabled = false; $('runFixBtn').textContent = 'Sinab ko‘r + tuzat'; }
  if (r && r.ok) {
    toast(`✅ ${r.attempts} urinishda muvaffaqiyatli tugadi`);
    activity(`✅ tuzatildi (${r.attempts} urinish)`, 'ok');
  } else {
    toast(`❌ halqa tuzata olmadi (${(r && r.error) || 'xato'}) — Tarix panelini ko‘ring`);
    activity(`❌ tuzatilmadi: ${(r && r.error) || 'xato'}`, 'bad');
  }
  await loadHistory();
  await reloadCleanTabs();
}

/* =====================================================================================
   TIL XIZMATI (tsserver): semantik xato, haqiqiy ta'rif, barcha havolalar, hover.
   ===================================================================================== */
const LSP_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'py']);
function lspEligible(p) { return LSP_EXT.has(String(p || '').split('.').pop().toLowerCase()); }

async function initLsp() {
  const info = await safe(() => window.ide.lspStatus());
  const ok = !!(info && info.available);
  if ($('tsNote')) $('tsNote').textContent = ok ? `til xizmati: tsserver ${info.server || ''}`.trim() : 'til xizmati: faqat sintaksis';
  state.lsp = { available: ok, info };
}

/** Diagnostikani birlashtirish: sintaksis (lite) + semantik (tsserver/pyflakes). */
function mergeProblems(path, kind, items, note) {
  if (!path) return;
  const set = (state.problemSets[path] = state.problemSets[path] || { lite: [], lsp: [] });
  set[kind] = items || [];
  set[kind + 'Note'] = note || null;
  const merged = [...(set.lsp || []), ...(set.lite || [])];
  renderProblems(merged, set.lspNote || set.liteNote || null, path);
}

function scheduleLspDiagnosticsImpl() {
  clearTimeout(lspTimer);
  const tab = activeTab();
  if (!tab || !lspEligible(tab.path)) return;
  lspTimer = setTimeout(() => runLspDiagnostics(tab), 700);
}

async function runLspDiagnostics(tab) {
  const area = $('editorArea');
  const text = area && tab.path === state.active ? area.value : tab.text;
  if (typeof text === 'string' && text.length > 2 * 1024 * 1024) return;   // juda katta fayl — til xizmatisiz
  const r = await safe(() => window.ide.lspDiagnostics(tab.path, text));
  if (!r) return;
  const note = r.note || (r.engine ? `manba: ${r.engine}` : null);
  mergeProblems(tab.path, 'lsp', r.items || [], note);
}

function scheduleHoverImpl() {
  clearTimeout(hoverTimer);
  const tab = activeTab();
  if (!tab || !lspEligible(tab.path)) return;
  hoverTimer = setTimeout(() => showHover(tab), 700);
}

async function showHover(tab) {
  const area = $('editorArea');
  const tip = $('hoverTip');
  if (!area || !tip || tab.path !== state.active) return;
  const pos = lineOfIndex(area.value, area.selectionStart);
  const r = await safe(() => window.ide.lspHover(tab.path, pos.line, pos.col, area.value));
  if (!r || !r.text) { tip.classList.add('hidden'); return; }
  tip.textContent = r.text;
  tip.classList.remove('hidden');
}

/** Shift+F12 — barcha havolalar (haqiqiy semantik izlash). */
async function findReferences() {
  const area = $('editorArea');
  const tab = activeTab();
  if (!area || !tab) { toast('Avval faylni oching'); return; }
  if (!lspEligible(tab.path)) { toast('Havolalar qidiruvi JS/TS/Python uchun'); return; }
  const pos = lineOfIndex(area.value, area.selectionStart);
  showView('refs');
  const box = $('refsResults');
  if ($('refsHint')) $('refsHint').textContent = 'qidirilmoqda…';
  const r = await safe(() => window.ide.lspReferences(tab.path, pos.line, pos.col, area.value));
  const items = (r && r.items) || [];
  if (box) box.innerHTML = '';
  if ($('refsHint')) $('refsHint').textContent = items.length
    ? `${items.length} ta havola — ${tab.path}:${pos.line}:${pos.col}`
    : (r && r.error ? `xato: ${r.error}` : 'havola topilmadi (kursor belgi ustida bo‘lsin)');
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'problem-row';
    row.textContent = `${it.path}:${it.line}:${it.col}`;
    row.addEventListener('click', async () => { await openTab(it.path, { line: it.line }); gotoLine(it.line); });
    box?.appendChild(row);
  }
  activity(`⇄ ${items.length} ta havola topildi`, items.length ? 'ok' : '');
}

/* =====================================================================================
   QADAMLAB DEBUGGER (nuqtalar, chaqiruvlar, o'zgaruvchilar)
   ===================================================================================== */
const dbg = { breaks: [], running: false, paused: false, frames: [], file: null, current: null };

function setDbgStatus(text) { if ($('dbgStatus')) $('dbgStatus').textContent = text; }

/** Nuqta qo'yish/olib tashlash — qator raqamlari ustida bosiladi. */
function toggleBreak(line) {
  const tab = activeTab();
  if (!tab || !line) return;
  if (!['.js', '.mjs', '.cjs'].includes(`.${String(tab.path).split('.').pop()}`)) {
    toast('Nuqtalar hozircha JS fayllar uchun');
    return;
  }
  const idx = dbg.breaks.findIndex((b) => b.path === tab.path && b.line === line);
  if (idx >= 0) dbg.breaks.splice(idx, 1);
  else dbg.breaks.push({ path: tab.path, line });
  renderBreakDots();
  if (dbg.running) window.ide.debugSetBreakpoints(dbg.breaks);
}

function renderBreakDots() {
  const host = $('breakGutter');
  const area = $('editorArea');
  if (!host || !area) return;
  const tab = activeTab();
  host.innerHTML = '';
  const mine = dbg.breaks.filter((b) => tab && b.path === tab.path);
  for (const b of mine) {
    const dot = document.createElement('div');
    dot.className = 'break-dot';
    dot.style.top = `${(b.line - 1) * LINE_H + TOP_PAD}px`;
    host.appendChild(dot);
  }
  if (dbg.current && tab && dbg.current.path === tab.path) {
    const cur = document.createElement('div');
    cur.className = 'dbg-cur';
    cur.style.top = `${(dbg.current.line - 1) * LINE_H + TOP_PAD}px`;
    host.appendChild(cur);
  }
  // Scroll bilan birga siljiydi (boshqa qatlamlar kabi).
  host.style.transform = `translateY(${-area.scrollTop}px)`;
}

async function debugStartOrContinue() {
  const tab = activeTab();
  if (!tab) { toast('Avval faylni oching'); return; }
  showPanel('debug');
  if (dbg.running) {
    const r = await safe(() => window.ide.debugResume());
    setDbgStatus(r && r.error ? `xato: ${r.error}` : 'davom etdi');
    return;
  }
  if (tab.dirty) await saveActive();
  const r = await safe(() => window.ide.debugStart(tab.path, dbg.breaks, false));
  if (!r || r.error) { toast(`Debug ishga tushmadi: ${(r && r.error) || 'xato'}`); setDbgStatus('ishga tushmadi'); return; }
  dbg.running = true;
  dbg.file = r.file;
  setDbgStatus(`ishga tushdi (port ${r.port}) — nuqtalar kutilyapti`);
  activity(`🐞 debug boshlandi: ${r.file}`, 'ok');
}

async function debugStep(kind) {
  if (!dbg.running) { toast('Avval debug boshlang'); return; }
  const r = await safe(() => window.ide.debugStep(kind));
  if (r && r.error) setDbgStatus(`xato: ${r.error}`);
}

async function debugStop() {
  await safe(() => window.ide.debugStop());
  dbg.running = false;
  dbg.paused = false;
  dbg.current = null;
  renderBreakDots();
  setDbgStatus('to‘xtatildi');
}

function renderDbgStack(frames, scopes) {
  const stack = $('dbgStack');
  const vars = $('dbgVars');
  if (stack) {
    stack.innerHTML = '';
    for (const f of frames || []) {
      const row = document.createElement('div');
      row.className = 'dbg-row';
      row.textContent = `${f.name} · ${f.path || '?'}:${f.line}`;
      row.addEventListener('click', async () => { if (f.path) { await openTab(f.path, { line: f.line }); gotoLine(f.line); } });
      stack.appendChild(row);
    }
    if (!(frames || []).length) stack.innerHTML = '<div class="dim">chaqiruv yo‘q</div>';
  }
  if (vars) {
    vars.innerHTML = '';
    for (const sc of scopes || []) {
      const head = document.createElement('div');
      head.className = 'dbg-scope';
      head.textContent = sc.type;
      vars.appendChild(head);
      for (const v of sc.vars || []) {
        const row = document.createElement('div');
        row.className = 'dbg-row';
        row.textContent = `${v.name} = ${v.value}`;
        vars.appendChild(row);
      }
    }
    if (!(scopes || []).length) vars.innerHTML = '<div class="dim">o‘zgaruvchi yo‘q</div>';
  }
}

function renderDbgBreakpoints(list) {
  const box = $('dbgBreaks');
  if (!box) return;
  box.innerHTML = '';
  const rows = list && list.length ? list : dbg.breaks;
  for (const b of rows) {
    const row = document.createElement('div');
    row.className = 'dbg-row';
    row.textContent = `${b.resolved === false ? '○' : '●'} ${b.path}:${b.line}`;
    row.addEventListener('click', async () => { await openTab(b.path, { line: b.line }); gotoLine(b.line); });
    box.appendChild(row);
  }
  if (!rows.length) box.innerHTML = '<div class="dim">nuqta yo‘q — qator raqami ustida bosing yoki F9</div>';
}

/* ------------------------------------------------------------------- boot */
function wireUi() {
  const on = (id, ev, fn) => {
    const el = $(id);
    if (el) el.addEventListener(ev, fn);
  };

  on('openFolderBtn', 'click', () => pickFolder().catch((e) => catchLog('papka ochish', e)));
  on('ideRootAdd', 'click', () => addRoot().catch((e) => catchLog('papka qo‘shish', e)));
  on('runBtn', 'click', () => runActiveFile().catch((e) => catchLog('ishga tushirish', e)));
  on('runFixBtn', 'click', () => runFixLoop().catch((e) => catchLog('tuzatish halqasi', e)));
  on('dbgRunBtn', 'click', () => debugStartOrContinue().catch((e) => catchLog('debug', e)));
  on('dbgContinue', 'click', () => debugStartOrContinue().catch((e) => catchLog('debug davom', e)));
  on('dbgStepOver', 'click', () => debugStep('over'));
  on('dbgStepInto', 'click', () => debugStep('into'));
  on('dbgStepOut', 'click', () => debugStep('out'));
  on('dbgStop', 'click', () => debugStop());

  // Nuqta qo'yish: qator raqamlari ustidagi shaffof qatlam bosiladi.
  on('breakGutter', 'click', (e) => {
    const area = $('editorArea');
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const y = e.clientY - rect.top + area.scrollTop - TOP_PAD;
    const line = Math.floor(y / LINE_H) + 1;
    toggleBreak(Math.max(1, line));
  });
  on('saveBtn', 'click', () => saveActive().catch((e) => catchLog('saqlash', e)));
  on('termToggleBtn', 'click', () => {
    const bottom = $('bottomPanel');
    if (!bottom) return;
    bottom.classList.toggle('hidden');
    if (!bottom.classList.contains('hidden')) showPanel('terminal');
  });
  on('aiToggleBtn', 'click', () => {
    const panel = $('aiPanel');
    if (panel) panel.classList.toggle('hidden');
  });
  on('aiClose', 'click', () => $('aiPanel')?.classList.add('hidden'));
  on('aiSend', 'click', () => {
    const input = $('aiInput');
    const check = $('aiTeamCheck');
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    runAi(text, check ? check.checked : false);
  });
  on('aiStop', 'click', () => stopAll());
  on('stopAllBtn', 'click', () => stopAll());
  on('aiFix', 'click', () => aiFixFromContext().catch((e) => catchLog('AI tuzatish', e)));

  // ---- LOKAL AI menejeri (model bozori) ----
  // Model qatorlari dinamik yasaladi, shuning uchun tugmalar DELEGATSIYA bilan
  // ulanadi (CSP `script-src 'self'` inline `onclick` ni bloklaydi).
  on('aiModelsBtn', 'click', () => openModels().catch((e) => catchLog('lokal AI', e)));
  on('modelsClose', 'click', closeModels);
  on('modelsModal', 'click', (e) => { if (e.target && e.target.id === 'modelsModal') closeModels(); });
  on('modelsRefresh', 'click', async () => {
    await safe(() => window.ide.hardware(true));
    await refreshModels(true);
    toast('Apparat va modellar qayta skanerlandi');
  });
  on('modelsTabs', 'click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-tab]') : null;
    if (!btn) return;
    models.tab = btn.dataset.tab;
    for (const b of $('modelsTabs').querySelectorAll('button')) b.classList.toggle('active', b === btn);
    renderModels();
    // «Kompyuterda bor» turkumi skanni TALAB QILADI: ilgari bu yerda faqat chizish
    // chaqirilardi va ro'yxat «skanerdan o'tkazilmoqda…» da qotib qolardi.
    if (models.tab === 'installed' && !models.external) refreshModels().catch((e) => catchLog('tashqi AI skani', e));
  });
  on('modelsBody', 'click', (e) => onModelsClick(e).catch((err) => catchLog('model amali', err)));
  on('imgGo', 'click', () => generateImageLocal().catch((e) => catchLog('lokal rasm', e)));
  on('imgSize', 'change', updateImageEstimate);
  on('imgSteps', 'change', updateImageEstimate);
  on('imgStop', 'click', async () => {
    const r = await safe(() => window.ide.imageStop());
    toast(r && r.ok ? 'Rasm yaratish to‘xtatilmoqda…' : 'Rasm yaratilmayapti');
  });
  on('aiInput', 'keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('aiSend').click();
    }
  });

  on('termInput', 'keydown', (e) => {
    const input = e.target;
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = input.value;
      input.value = '';
      runTermCommand(cmd).catch((err) => catchLog('terminal', err));
    } else if (e.key === 'ArrowUp') {
      if (!state.termHistory.length) return;
      e.preventDefault();
      state.termIdx = Math.max(0, state.termIdx - 1);
      input.value = state.termHistory[state.termIdx] || '';
    } else if (e.key === 'ArrowDown') {
      if (!state.termHistory.length) return;
      e.preventDefault();
      state.termIdx = Math.min(state.termHistory.length, state.termIdx + 1);
      input.value = state.termHistory[state.termIdx] || '';
    }
  });

  on('fileFilter', 'input', (e) => { state.filter = e.target.value.trim(); renderTree(); });
  on('searchInput', 'input', () => {
    if (state.quickMode) renderQuickOpen();
    else runSearch().catch((e) => catchLog('qidiruv', e));
  });
  on('searchInput', 'keydown', (e) => {
    if (e.key === 'Enter' && state.quickMode) { e.preventDefault(); quickOpenFirst(); }
    if (e.key === 'Escape') { e.preventDefault(); state.quickMode = false; showView('files'); }
  });

  const viewButtons = document.querySelectorAll('#sidebarTabs button[data-view]');
  viewButtons.forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));

  const panelButtons = document.querySelectorAll('#panelTabs button[data-panel]');
  panelButtons.forEach((btn) => btn.addEventListener('click', () => showPanel(btn.dataset.panel)));
  on('panelClose', 'click', () => $('bottomPanel')?.classList.add('hidden'));

  const area = $('editorArea');
  if (area) {
    area.addEventListener('keydown', handleEditorKey);
    area.addEventListener('input', () => { afterEdit(); });
    area.addEventListener('scroll', syncScroll);
    area.addEventListener('click', () => { hideAutocomplete(); updateCursor(); });
    area.addEventListener('keyup', () => { if (!$('autocomplete')?.classList.contains('hidden')) return; updateCursor(); });
    area.addEventListener('blur', () => setTimeout(hideAutocomplete, 150));
  }

  on('findClose', 'click', () => $('findBar')?.classList.add('hidden'));
  on('findNext', 'click', () => findStep(1));
  on('findPrev', 'click', () => findStep(-1));
  on('replaceOne', 'click', replaceOne);
  on('replaceAll', 'click', replaceAll);
  on('findInput', 'input', updateFindCount);
  on('findInput', 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); $('findBar')?.classList.add('hidden'); }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctxMenu')) closeCtx();
  });
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('#fileTree')) closeCtx();
  });
  document.addEventListener('keydown', onGlobalKey);
  window.addEventListener('resize', () => { measureChar(); paint(); });
}

function showView(which) {
  const files = $('filesView'), search = $('searchView'), refs = $('refsView');
  if (files) files.classList.toggle('hidden', which !== 'files');
  if (search) search.classList.toggle('hidden', which !== 'search');
  if (refs) refs.classList.toggle('hidden', which !== 'refs');
  document.querySelectorAll('#sidebarTabs button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === which));
  if (which === 'search') $('searchInput')?.focus();
}

function onGlobalKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (e.shiftKey) saveAsActive().catch((err) => catchLog('save-as', err));
    else saveActive().catch((err) => catchLog('saqlash', err));
    return;
  }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFolder(); return; }
  if (mod && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    state.quickMode = true;
    showView('search');
    const input = $('searchInput');
    if (input) { input.value = ''; input.placeholder = 'Fayl nomi…'; }
    renderQuickOpen();
    return;
  }
  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('findBar')?.classList.remove('hidden');
    $('findInput')?.focus();
    updateFindCount();
    return;
  }
  if (mod && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    $('findBar')?.classList.remove('hidden');
    $('replaceInput')?.focus();
    return;
  }
  if (e.key === 'F5') { e.preventDefault(); runActiveFile(); return; }
  if (e.key === 'F12') {
    e.preventDefault();
    if (e.shiftKey) findReferences().catch((err) => catchLog('havolalar', err));
    else goToDefinition().catch((err) => catchLog('ta’rifga o‘tish', err));
    return;
  }
  if (e.key === 'F9') { e.preventDefault(); const area2 = $('editorArea'); if (area2) toggleBreak(lineOfIndex(area2.value, area2.selectionStart).line); return; }
  if (dbg.running && (e.key === 'F10' || e.key === 'F11')) {
    e.preventDefault();
    debugStep(e.key === 'F10' ? 'over' : 'into');
    return;
  }
  if (e.key === '`' && e.ctrlKey) {
    e.preventDefault();
    $('bottomPanel')?.classList.toggle('hidden');
    showPanel('terminal');
    return;
  }
  if (e.key === 'Escape') {
    hideAutocomplete();
    closeCtx();
    // Ishlayotgan vazifa bo‘lsa — Esc uni to‘xtatadi (kutish o‘rniga).
    if (state.aiBusy || fixBusy || runBusy) { e.preventDefault(); stopAll(); }
  }
}

async function saveAsActive() {
  const tab = activeTab();
  if (!tab) { toast('Ochiq fayl yo‘q'); return; }
  const dest = await askText('Nomi bilan saqlash (nisbiy yo‘l)', tab.path);
  if (!dest || dest === tab.path) return;
  const area = $('editorArea');
  const text = area ? area.value : tab.text;
  const rn = await safe(() => window.ide.rename(tab.path, dest));
  if (!rn || !rn.ok) return;
  tab.path = rn.path;
  state.active = rn.path;
  const w = await safe(() => window.ide.writeFile(tab.path, text));
  if (w && w.ok) {
    tab.saved = text;
    tab.dirty = false;
    toast(`Saqlangan: ${tab.path}`);
    activity(`💾 saved ${tab.path}`, 'ok');
    await refreshTree();
    renderTabs();
    updateDirty();
  }
}

async function runActiveFile() {
  const tab = activeTab();
  if (!tab) { toast('Ishga tushirish uchun fayl oching yoki papka tanlang'); return; }
  if (tab.dirty) await saveActive();
  showPanel('terminal');
  // Yurish endi CAPTURED: chiqish oqim bilan keladi (terminalda ko'rinadi), oxiri va
  // chiqish kodi TARIXGA yoziladi — shu asosda AI tuzatish halqasi ishlaydi.
  runBusy = true;
  stopAllVisible();
  let r;
  try {
    r = await safe(() => window.ide.runFile(tab.path));
  } finally {
    runBusy = false;
    stopAllVisible();
  }
  if (r && r.opened) { toast('Tashqi ilovada ochildi'); return; }
  if (r && r.error) { toast(`Ishga tushmadi: ${r.error}`); return; }
  if (r && r.command) activity(`▶ ${tab.path} (kod ${r.code}, ${r.seconds}s)`, r.code === 0 ? 'ok' : 'bad');
  await loadHistory();
}

async function pickFolder() {
  const r = await safe(() => window.ide.pickFolder());
  if (!r || r.canceled || r.error) return;
  await enterWorkspace(r);
}

async function enterWorkspace(info) {
  state.workspace = { path: info.path, name: info.name };
  if (Array.isArray(info.roots) && info.roots.length) state.roots = info.roots;
  state.openRoots = new Set();
  state.collapsed.clear();
  state.filter = '';
  state.problemSets = {};
  if ($('fileFilter')) $('fileFilter').value = '';
  if ($('wsName')) $('wsName').textContent = info.name || info.path;
  activity(`📂 papka ochildi: ${info.path}`);
  await refreshTree();
  // Yangi papkada: terminal sessiyasi o'sha papkada ochilsin, nuqtalar tozalansin.
  dbg.breaks = [];
  renderBreakDots();
  renderDbgBreakpoints();
  restartPty();
  toast(`Papka ochildi: ${info.name || info.path}`);
}

function showEmpty() {
  const empty = $('emptyState');
  if (empty) {
    empty.classList.remove('hidden');
    empty.innerHTML = 'Papka ochilmagan.<br><span class="dim">Ctrl+O yoki "Papka ochish" tugmasi bilan loyihani tanlang.</span>';
  }
  $('editorPane')?.classList.add('hidden');
}

async function boot() {
  $('aiPanel')?.classList.add('hidden');
  $('modelsModal')?.classList.add('hidden');
  $('findBar')?.classList.add('hidden');
  $('autocomplete')?.classList.add('hidden');
  $('ctxMenu')?.classList.add('hidden');
  $('dlgModal')?.classList.add('hidden');
  showPanel('terminal');

  wireUi();
  measureChar();

  const info = await safe(() => window.ide.sysInfo());
  if (info && !info.error && $('statusLeft')) {
    $('statusLeft').textContent = `YANG IDE v${info.version} · ${info.platform} · ${info.cpus} CPU · ${info.ramMb} MB RAM`;
  }

  // Yangi qatlamlar: haqiqiy terminal, til xizmati, yurish tarixi, debugger.
  try { await initTerminal(); } catch (e) { catchLog('terminal (PTY)', e); }
  try { await initLsp(); } catch (e) { catchLog('til xizmati', e); }
  try { await loadHistory(); } catch (e) { catchLog('tarix', e); }

  window.ide.onRunLogged((d) => {
    try {
      if (d && d.runs) { state.runLog = d.runs; renderHistory(d.runs); }
    } catch (e) { catchLog('tarix yangilandi', e); }
  });
  // Model yuklab olish progressi — qator ichidagi chiziqni yangilaydi.
  window.ide.onModelProgress((job) => {
    try {
      if (!job) return;
      if (job.state !== 'downloading' && job.state !== 'extracting') {
        if (models.open) refreshModels().catch(() => {});
        if (job.state === 'done') toast('✅ Yuklab olindi va o‘rnatildi');
        else if (job.state === 'error') toast(`❌ Yuklab olish xatosi: ${job.error || 'sabab noma’lum'}`);
        else if (job.state === 'canceled') toast('Yuklab olish bekor qilindi');
        return;
      }
      const holder = document.querySelector(`#modelsBody [data-bar="${job.id}"]`);
      if (!holder) return;
      const fill = holder.querySelector('.mdl-bar-fill');
      const pct = holder.querySelector('.mdl-pct');
      if (fill) fill.style.width = `${job.percent || 0}%`;
      if (pct) {
        pct.textContent = job.state === 'extracting'
          ? 'arxiv ochilmoqda…'
          : `${job.percent != null ? job.percent : 0}% · ${fmtSize(job.received)}${job.mbps ? ` · ${job.mbps} MB/s` : ''}`;
      }
    } catch (e) { catchLog('model progressi', e); }
  });
  // «O‘lchash» yurishi: model 4 haqiqiy vazifa bilan sinab ko‘riladi va kuch reytingi
  // o‘lchangan ball bilan yangilanadi (nima ko‘rinadi: qadam, foiz, vaqt; oxirida ball).
  window.ide.onModelBench((s) => {
    try {
      if (!s) return;
      const note = $('modelsNote');
      if (s.running) {
        const text = `⏱ O‘lchov: ${s.name} · ${s.percent || 0}% · ${s.seconds || 0}s — ${s.line || ''}`;
        if (note && models.open) note.textContent = text;
        return;
      }
      const d = s.done;
      if (!d) return;
      if (d.ok) {
        const m = d.measured;
        if (note) note.textContent = `✅ ${d.name}: ${m.idePass}/${m.tasks} vazifa · o‘rtacha ${m.avgSeconds}s · ball ${m.score} → ★${d.stars}`;
        toast(`✅ ${d.name} o‘lchandi: ball ${m.score} (${m.idePass}/${m.tasks} vazifa)`);
        activity(`📊 ${d.name} o‘lchandi: ball ${m.score} · ${m.idePass}/${m.tasks} · ${m.avgSeconds}s`, 'ok');
      } else {
        if (note) note.textContent = `❌ ${d.name}: ${d.error || 'natija o‘qilmadi'}`;
        toast(`❌ O‘lchov tugamadi: ${d.error || 'sabab noma’lum'}`);
      }
      if (models.open) refreshModels().catch(() => {});
    } catch (e) { catchLog('o‘lchov holati', e); }
  });
  window.ide.onRunFinished((d) => {
    try {
      const run = d && d.run;
      if (!run) return;
      activity(`${run.code === 0 ? '✓' : '✖'} ${run.path} tugadi (kod ${run.code}, ${run.seconds}s)`, run.code === 0 ? 'ok' : 'bad');
      if (run.code !== 0) {
        toast(`Kod ${run.code} — «Sinab ko‘r + tuzat» yoki Tarix panelini ko‘ring`);
        showPanel('history');
      }
    } catch (e) { catchLog('yurish tugadi', e); }
  });
  window.ide.onFixEvent((d) => {
    try {
      if (!d || !d.text) return;
      const kind = d.phase === 'error' || d.phase === 'give-up' ? 'bad' : d.phase === 'done' ? 'ok' : '';
      activity(d.text, kind);
      if (d.phase === 'done' || d.phase === 'give-up') toast(d.text);
    } catch (e) { catchLog('tuzatish hodisasi', e); }
  });
  window.ide.onDebugPaused(async (d) => {
    try {
      if (!d) return;
      dbg.paused = true;
      dbg.running = true;
      dbg.current = { path: d.path, line: d.line };
      setDbgStatus(`to‘xtadi: ${d.path}:${d.line} (${d.reason})`);
      renderDbgStack(d.frames, d.scopes);
      if (d.path) {
        await openTab(d.path, { line: d.line });
        gotoLine(d.line);
      }
      renderBreakDots();
      showPanel('debug');
      activity(`🐞 to‘xtadi ${d.path}:${d.line}`, 'ok');
    } catch (e) { catchLog('debug to‘xtashi', e); }
  });
  window.ide.onDebugResumed(() => { setDbgStatus('davom etmoqda…'); });
  window.ide.onDebugOutput((d) => { try { if (d && d.chunk) termWrite(d.chunk); } catch (e) { catchLog('debug chiqishi', e); } });
  window.ide.onDebugExit((d) => {
    dbg.running = false;
    dbg.paused = false;
    dbg.current = null;
    renderBreakDots();
    setDbgStatus(d && d.code != null ? `tugadi (kod ${d.code})` : 'to‘xtatildi');
  });

  window.ide.onTermData((d) => { try { if (d && d.chunk) termWrite(d.chunk); } catch (e) { catchLog('terminal oqimi', e); } });
  window.ide.onTermExit(async (d) => {
    try {
      const code = d ? d.code : null;
      termWrite(`\r\n\u001b[90m[tugadi — kod ${code}]\u001b[0m\r\n`);
      if (code && code !== 0) {
        const tail = state.termBuffer.slice(-4000);
        const r = await window.ide.errorLinks(tail);
        const links = (r && r.links) || [];
        for (const link of links.slice(0, 8)) {
          const row = document.createElement('div');
          row.className = 'problem-row error';
          row.textContent = `stack: ${link.path}:${link.line}`;
          row.addEventListener('click', async () => { await openTab(link.path, { line: link.line }); showPanel('problems'); });
          $('problemsPanel')?.appendChild(row);
        }
        if ($('problemsCount')) $('problemsCount').textContent = String((links.length || 0));
        activity(`✖ buyruq xato bilan tugadi (kod ${code})`, 'bad');
        showPanel('problems');
      }
    } catch (e) {
      catchLog('terminal tugashi', e);
    }
  });
  window.ide.onFsChanged(async (d) => {
    try {
      if (!d || !d.path) return;
      activity(`♻ tashqaridan o‘zgardi: ${d.path}`);
      await refreshTree();
      const tab = state.tabs.find((t) => t.path === d.path);
      if (tab && !tab.dirty) {
        const r = await window.ide.readFile(tab.path);
        if (r && typeof r.text === 'string' && r.text !== tab.saved) {
          tab.text = r.text;
          tab.saved = r.text;
          if (tab.path === state.active) {
            const area = $('editorArea');
            if (area) { area.value = r.text; paint(true); }
          }
          activity(`♻ yangilandi ${tab.path}`);
        }
      }
    } catch (e) {
      catchLog('fayl kuzatuvchisi', e);
    }
  });
  window.ide.onAiEvent((ev) => onAiEvent(ev));
  window.ide.onNotice((n) => { if (n && n.text) { activity(n.text, 'bad'); toast(n.text); } });
  // Ildizlar boshqa oynada (YANG AI paneli) o'zgargan bo'lsa — daraxtni yangilaymiz.
  if (window.ide.onRootsChanged) {
    window.ide.onRootsChanged((d) => {
      try {
        if (d && Array.isArray(d.roots)) { state.roots = d.roots; renderRoots(); refreshTree(); }
      } catch (e) { catchLog('ildizlar yangilandi', e); }
    });
  }
  // Ish papkasi keyinroq qo'yilgan/o'zgargan bo'lsa (masalan asosiy oynadan boshqa chat
  // ochilganda yoki oyna ochilishida ulgurmagan bo'lsa) — shu yerda qabul qilamiz.
  if (window.ide.onWorkspaceChanged) {
    window.ide.onWorkspaceChanged((d) => {
      try {
        if (d && Array.isArray(d.roots)) { state.roots = d.roots; renderRoots(); }
        if (d && d.workspace && d.workspace.path) {
          const changed = !state.workspace || state.workspace.path !== d.workspace.path;
          state.workspace = d.workspace;
          if ($('wsName')) $('wsName').textContent = d.workspace.name || d.workspace.path;
          if (changed) {
            // Boshqa loyihaga o'tildi: eski tablar boshqa papkaga tegishli — ularni yopamiz.
            // Saqlanmagan tahriri bor tab TEGILMAYDI (jimgina yo'qotib qo'ymaymiz).
            for (const t of [...state.tabs]) { if (!t.dirty) closeTabFile(t); }
            state.openRoots = new Set();
            state.collapsed = new Set();
          }
          refreshTree();
        }
      } catch (e) { catchLog('ish papkasi yangilandi', e); }
    });
  }

  const init = await safe(() => window.ide.init());
  if (init && init.roots && init.roots.length) state.roots = init.roots;
  if (init && init.workspace) {
    state.workspace = init.workspace;
    if ($('wsName')) $('wsName').textContent = init.workspace.name;
    await refreshTree();
  } else {
    showEmpty();
    renderRoots();
  }

  initAi().catch((e) => catchLog('AI holati', e));

  if (init && Array.isArray(init.tabs) && init.tabs.length) {
    for (const p of init.tabs.slice(0, 12)) await openTab(p, { activate: false });
    const first = init.tabs[0];
    if (state.tabs.some((t) => t.path === first)) activateTab(first);
  } else if (!state.tabs.length) {
    showEmpty();
  }
  updateFindCount();
  activity('IDE tayyor');
}

/* =====================================================================================
   LOKAL AI MENEJERI — model bozori, apparat talablari, kuch reytingi va lokal rasm.
   Maqsad: foydalanuvchi "qaysi modelni yuklay olaman, qanchasi kuchli, mening
   kompyuterimda ishlaydimi?" degan savolga bir oynada javob olsin. Apparat profili,
   moslik bahosi va yuklab olish mantiqi main jarayonda (`ide/ide_models.js`),
   bu yerda faqat ko'rsatish va tugmalar.
   ===================================================================================== */
const models = {
  open: false,
  tab: 'text',
  data: null,        // { hardware, sd, items, levels, error }
  external: null,    // kompyuterda allaqachon bor AI lar (Ollama / HF keshi / ...)
};

const starsOf = (n) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, n))));
const fmtSize = (bytes) => {
  const b = Number(bytes) || 0;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1048576)} MB`;
  return `${Math.round(b / 1024)} KB`;
};
const LEVEL_WORD = { 1: 'Boshlang‘ich', 2: 'Yaxshi', 3: 'Kuchli', 4: 'Juda kuchli', 5: 'Eng kuchli' };

async function openModels(tab) {
  const modal = $('modelsModal');
  if (!modal) return;
  if (tab) models.tab = tab;
  modal.classList.remove('hidden');
  models.open = true;
  updateImageEstimate();
  for (const b of ($('modelsTabs') || { querySelectorAll: () => [] }).querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.tab === models.tab);
  }
  await refreshModels();
}

function closeModels() {
  models.open = false;
  $('modelsModal')?.classList.add('hidden');
}

async function refreshModels(hard = false) {
  if (hard) models.external = null;
  const body = $('modelsBody');
  if (body) body.innerHTML = '<div class="mdl-note dim">O‘qilmoqda…</div>';
  const data = await safe(() => window.ide.modelsCatalog());
  if (!data || data.error === undefined && !data.items) {
    if (body) body.innerHTML = '<div class="mdl-note" style="color:var(--danger)">Katalog o‘qilmadi — `local-ai/catalog.json` paketda bormi?</div>';
    return;
  }
  models.data = data;
  if (models.tab === 'installed') {
    models.external = await safe(() => window.ide.modelsExternal());
  }
  renderModels();
}

function renderHardware() {
  const hw = models.data && models.data.hardware;
  const box = $('hwProfile');
  if (!box) return;
  if (!hw) { box.textContent = '—'; return; }
  const item = (k, v, title = '') => `<span class="hw-item"${title ? ` title="${esc(title)}"` : ''}><span class="hw-key">${esc(k)}</span><span class="hw-val">${esc(v)}</span></span>`;
  box.innerHTML = [
    item('CPU', `${hw.cpu} · ${hw.cores} yadro`),
    item('RAM', `${hw.ramGb} GB (bo‘sh ${hw.ramFreeGb} GB)`),
    item('Video', `${hw.gpu || 'aniqlanmadi'} · ${hw.vramGb} GB VRAM`, hw.gpuNote || ''),
    item('Disk', hw.diskFreeGb != null ? `${hw.diskFreeGb} GB bo‘sh` : '—'),
    `<span class="hw-level">` +
      `<span class="hw-item"><span class="hw-key">Matn darajasi</span><span class="hw-stars">${starsOf(hw.textLevel)}</span></span>` +
      `<span class="hw-item"><span class="hw-key">Rasm darajasi</span><span class="hw-stars">${starsOf(hw.imageLevel)}</span></span>` +
    '</span>',
  ].join('');
}

function modelRow(it) {
  const inst = it.installed;
  const p = it.progress;
  const active = p && (p.state === 'downloading' || p.state === 'extracting');
  const cls = ['mdl-row', inst ? 'installed' : '', it.verdict.state === 'blocked' ? 'blocked' : ''].filter(Boolean).join(' ');
  const badge = inst
    ? `<span class="mdl-badge on">o‘rnatilgan</span>`
    : `<span class="mdl-badge ${it.verdict.state}">${esc(it.verdict.fit)}</span>`;
  const meta = [
    `Hajm: ${fmtSize(it.bytes)}`,
    `min RAM: ${it.min.ramGb || 1} GB`,
    it.min.vramGb ? `min VRAM: ${it.min.vramGb} GB` : '',
    `kerak joy: ${it.min.diskGb || 1} GB`,
    it.measured ? `o‘lchandi: ${it.measured.idePass}/${it.measured.tasks} · ${it.measured.avgSeconds}s` : 'o‘lchanmagan',
    it.backend,
  ].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');

  let actions = '';
  if (active) {
    actions = `<div class="mdl-actions" data-bar="${esc(it.id)}">` +
      `<div class="mdl-bar"><div class="mdl-bar-fill" style="width:${p.percent || 0}%"></div></div>` +
      `<span class="mdl-pct">${p.state === 'extracting' ? 'arxiv ochilmoqda…' : `${p.percent || 0}%`}</span>` +
      `<button class="btn" data-act="cancel" data-id="${esc(it.id)}">Bekor</button></div>`;
  } else if (inst) {
    // Ilova bilan kelgan nusxa (Program Files) O'CHIRILMAYDI — aks holda offline model
    // yo'qolib, uni faqat qayta yuklab tiklash mumkin bo'lardi.
    actions = '<div class="mdl-actions">' +
      `<button class="btn" data-act="reveal" data-id="${esc(it.id)}">Papkada ko‘rsatish</button>` +
      // «O‘lchash» — reyting taxmin emas, SHU kompyuterda o‘lchangan ball bo‘lsin:
      // model 4 haqiqiy vazifani bajaradi, natija `measured.json` ga yoziladi.
      (it.kind === 'text'
        ? `<button class="btn btn-primary" data-act="measure" data-id="${esc(it.id)}">${it.measured ? 'Qayta o‘lchash' : 'O‘lchash (4 vazifa)'}</button>`
        : '') +
      (it.readonly
        ? '<span class="dim">ilova ichida kelgan nusxa — o‘chirilmaydi</span>'
        : `<button class="btn" data-act="remove" data-id="${esc(it.id)}">O‘chirish</button>`) + '</div>';
  } else if (it.kind === 'text') {
    actions = '<div class="mdl-actions">' +
      (it.bundled ? '<span class="dim">Ilova ichida bor — yuklab olish shart emas</span>' : `<button class="btn btn-primary" data-act="download" data-id="${esc(it.id)}">Yuklab olish</button>`) +
      `<button class="btn" data-act="use" data-id="${esc(it.id)}">Ishlatish (lokal AI)</button></div>`;
  } else {
    actions = '<div class="mdl-actions">' +
      `<button class="btn btn-primary" data-act="download" data-id="${esc(it.id)}">O‘rnatish</button></div>`;
  }

  const reasons = (it.verdict.reasons || []).map((r) => `<span>• ${esc(r)}</span>`).join('');
  return `<div class="${cls}">` +
    `<div class="mdl-top"><span class="mdl-name">${esc(it.name)}</span>` +
    `<span class="mdl-stars" title="Modelning o‘z kuchi (o‘lchovga asoslangan)">${starsOf(it.stars)}</span>` +
    `<span class="mdl-stars" title="SHU kompyuteringizda kutiladigan natija">→ ${starsOf(it.machineStars)}</span>` +
    badge + '</div>' +
    `<div class="mdl-meta">${meta}</div>` +
    `<div class="mdl-note">${esc(it.notes)}</div>` +
    `<div class="mdl-reasons">${reasons}</div>` +
    actions + '</div>';
}

function externalRow(name, bytes, sub, providerToUse, modelToUse) {
  const use = providerToUse
    ? `<button class="btn btn-primary" data-act="use" data-provider="${esc(providerToUse)}" data-model="${esc(modelToUse)}">Ishlatish</button>`
    : '';
  return '<div class="mdl-row installed">' +
    `<div class="mdl-top"><span class="mdl-name">${esc(name)}</span>` +
    `<span class="mdl-badge on">bor</span></div>` +
    `<div class="mdl-meta"><span>${esc(sub)}</span>${bytes ? `<span>${fmtSize(bytes)}</span>` : ''}</div>` +
    (use ? `<div class="mdl-actions">${use}</div>` : '') + '</div>';
}

function renderModels() {
  if (!models.data) return;
  renderHardware();
  const sd = models.data.sd || {};
  if ($('modelsSd')) {
    $('modelsSd').textContent = sd.available
      ? `rasm dvigateli tayyor (${sd.backend})`
      : 'rasm dvigateli o‘rnatilmagan';
  }
  const body = $('modelsBody');
  if (!body) return;
  const imgBox = $('modelsImage');
  if (imgBox) imgBox.classList.toggle('hidden', models.tab !== 'image');

  if (models.tab === 'installed') { renderModels_installedTab(body); return; }

  const kind = models.tab;   // text | image | runtime
  const items = (models.data.items || []).filter((x) => x.kind === kind);
  items.sort((a, b) => (Number(b.installed) - Number(a.installed)) || (b.machineStars - a.machineStars) || (a.bytes - b.bytes));
  if (!items.length) {
    body.innerHTML = '<div class="mdl-note dim">Bu turkumda model yo‘q — `local-ai/catalog.json` ni tekshiring.</div>';
    return;
  }
  const head = models.tab === 'image'
    ? '<div class="mdl-note dim" style="margin-bottom:6px">Rasm modellari <b>stable-diffusion.cpp</b> orqali ishlaydi — avval «Rasm dvigateli» turkumidan dvigatelni o‘rnating, keyin modelni.</div>'
    : models.tab === 'voice'
      ? '<div class="mdl-note dim" style="margin-bottom:6px">Ovoz modeli — mikrofon orqali o‘zbekcha buyruq uchun (rubaistt + whisper.cpp). Model yuklangandan keyin <code>whisper-cli.exe</code> ni <code>%APPDATA%/yang-ai/models/voice/</code> ga tashlang (yoki <code>YANG_WHISPER_EXE</code> bilan ko‘rsating) — 🎤 tugmasi shundan keyin ishlaydi.</div>'
    : models.tab === 'runtime'
      ? '<div class="mdl-note dim" style="margin-bottom:6px">Bittasini o‘rnating. Vulkan — video karta orqali (tez), CPU — har qanday kompyuterda (sekin).</div>'
      : '<div class="mdl-note dim" style="margin-bottom:6px">★ — modelning o‘z kuchi · → ★ — shu kompyuteringizda kutiladigan natija. «Ishlatish» tugmasi modelni AI panelida tanlangan qilib qo‘yadi.</div>';
  body.innerHTML = head + items.map(modelRow).join('');
}

function renderModels_installedTab(body) {
  const ex = models.external;
  if (!ex) { body.innerHTML = '<div class="mdl-note dim">Kompyuter skanerdan o‘tkazilmoqda…</div>'; return; }
  const out = [];
  out.push(`<div class="mdl-note dim" style="margin-bottom:6px">Yuklab olish SHART EMAS: bu yerda kompyuteringizda allaqachon bor AI lar. «Ishlatish» tugmasi ularni IDE ga ulaydi (yuklab olish yo‘q, kalit yo‘q).</div>`);

  if (ex.ollama && ex.ollama.installed) {
    out.push(`<div class="mdl-note"><b>Ollama</b>${ex.ollama.exe ? ` — ${esc(ex.ollama.exe)}` : ''}</div>`);
    if (!ex.ollama.models.length) out.push('<div class="mdl-reasons"><span>• server ishlamayapti — `ollama serve` ishga tushiring, keyin ↻ bosing</span></div>');
    for (const m of ex.ollama.models) {
      out.push(externalRow(`${m.name}`, m.bytes, `Ollama · ${m.params || '?'} · ${m.quant || ''}`, 'local', m.name));
    }
  } else {
    out.push('<div class="mdl-note dim">Ollama topilmadi.</div>');
  }

  if (ex.lmstudio && ex.lmstudio.models.length) {
    out.push('<div class="mdl-note"><b>LM Studio</b> (server ishlayapti)</div>');
    for (const m of ex.lmstudio.models) out.push(externalRow(m.name, m.bytes, 'LM Studio', 'lmstudio', m.name));
  }

  if (ex.hf && ex.hf.length) {
    out.push('<div class="mdl-note"><b>HuggingFace keshi</b> (Python/diffusers yuklagan modellar)</div>');
    for (const h of ex.hf.slice(0, 14)) out.push(externalRow(h.repo, h.bytes, `kesh${h.approximate ? ' (taxminiy hajm)' : ''} · ${h.dir}`, '', ''));
  }

  if (ex.localDirs && ex.localDirs.length) {
    out.push('<div class="mdl-note"><b>Ilovaning model papkalari</b></div>');
    for (const l of ex.localDirs) out.push(externalRow(l.file, l.bytes, l.root, '', ''));
  }

  out.push(`<div class="mdl-note dim" style="margin-top:8px">Yuklab olingan modellar papkasi: <code>${esc((models.data.hardware && models.data.hardware.modelsDir) || '')}</code> (o‘chirilganda ilova bilan kelgan nusxa saqlanib qoladi).</div>`);
  body.innerHTML = out.join('');
}

async function onModelsClick(e) {
  const btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id || '';
  if (act === 'download') {
    btn.disabled = true;
    const r = await safe(() => window.ide.modelsDownload(id));
    if (!r || r.error) { btn.disabled = false; toast(`Yuklab olinmadi: ${(r && r.error) || 'xato'}`); return; }
    toast('Yuklab olish boshlandi…');
    await refreshModels();
    return;
  }
  if (act === 'cancel') { await safe(() => window.ide.modelsCancel(id)); toast('Bekor qilindi'); await refreshModels(); return; }
  if (act === 'remove') {
    const r = await safe(() => window.ide.modelsRemove(id));
    if (r && r.error) { toast(r.error); return; }
    toast('Savatga yuborildi');
    await refreshModels();
    return;
  }
  if (act === 'reveal') { const r = await safe(() => window.ide.modelsReveal(id)); if (r && r.error) toast(r.error); return; }
  if (act === 'measure') {
    btn.disabled = true;
    const r = await safe(() => window.ide.modelsMeasure(id));
    if (!r || r.error) {
      btn.disabled = false;
      toast(`O‘lchov boshlanmadi: ${(r && r.error) || 'xato'}`);
      return;
    }
    const note = $('modelsNote');
    if (note) note.textContent = `⏱ O‘lchov boshlandi: ${r.model || ''} — 4 vazifa (bir necha daqiqa)…`;
    toast('⏱ O‘lchov boshlandi — 4 vazifa, tarmoq va kalitsiz');
    activity(`⏱ O‘lchov boshlandi: ${r.model || id}`, 'info');
    return;
  }
  if (act === 'use') {
    const provider = btn.dataset.provider || 'localmini';
    const model = btn.dataset.model || 'qwen3-instruct';
    const r = await safe(() => window.ide.modelsAttach(provider, model));
    if (!r || r.error) { toast(`Ulanmadi: ${(r && r.error) || 'xato'}`); return; }
    toast(`✅ Ishlatiladi: ${model} (${provider})`);
    activity(`Lokal AI tanlandi: ${provider} · ${model}`, 'ok');
    await initAi().catch(() => {});
    return;
  }
}

/* ---- Lokal rasm generatsiyasi (API emas — stable-diffusion.cpp) ---- */
// Vaqt O'LCHOVGA asoslanadi (shu mashinada stable-diffusion.cpp, Radeon RX 580 / Vulkan):
//   256×256  → 0.78 s/qadam  ·  512×512 → 7.4 s/qadam (4 GB VRAM to‘lib qoladi, shuning uchun
//   o‘sish chiziqli emas). Pastdagi formula shu ikki nuqtadan olingan (daraja 1.62).
const SD_SEC_PER_STEP_256 = 0.78;
function sdEstimateSeconds(w, h, steps) {
  const scale = Math.pow((w * h) / (256 * 256), 1.62);
  return Math.round(SD_SEC_PER_STEP_256 * scale * steps);
}
function updateImageEstimate() {
  const el = $('imgEst');
  if (!el) return;
  const size = (($('imgSize') && $('imgSize').value) || '512x512').split('x');
  const steps = Number(($('imgSteps') && $('imgSteps').value) || 20);
  const secs = sdEstimateSeconds(Number(size[0]) || 512, Number(size[1]) || 512, steps);
  const human = secs >= 60 ? `${Math.round(secs / 6) / 10} daqiqa` : `${secs} sekund`;
  el.textContent = `Taxminiy vaqt: ${human} (${size[0]}×${size[1]} · ${steps} qadam) — o‘lchovga asoslangan, video karta va bo‘sh RAM ga qarab o‘zgaradi.`;
  el.classList.toggle('warn', secs > 240);
}

async function generateImageLocal() {
  const prompt = ($('imgPrompt') && $('imgPrompt').value.trim()) || '';
  if (!prompt) { toast('Rasm tavsifini yozing'); return; }
  const size = ($('imgSize') && $('imgSize').value) || '512x512';
  const steps = Number(($('imgSteps') && $('imgSteps').value) || 20);
  const out = $('imgOut');
  const go = $('imgGo');
  if (out) out.textContent = 'Yaratilmoqda… (lokal model, internet va kalitsiz) — To‘xtatish bilan bekor qilish mumkin';
  if (go) go.disabled = true;
  try {
    const r = await safe(() => window.ide.imageGenerate({ prompt, size, steps }));
    if (!r || r.error) {
      if (out) out.textContent = `Xato: ${(r && r.error) || 'noma’lum'} — «Rasm dvigateli» va «Rasm modellari» turkumlarida o‘rnatilganini tekshiring.`;
      return;
    }
    if (out) {
      out.textContent = '';
      const img = document.createElement('img');
      img.src = r.dataUrl;   // data: URL (CSP img-src data: ruxsat etilgan)
      img.alt = 'Lokal yaratilgan rasm';
      const meta = document.createElement('div');
      meta.textContent = `${r.via} · ${r.seconds}s · ${r.width}×${r.height} · ${r.steps} qadam`;
      out.appendChild(img);
      out.appendChild(meta);
      if (r.rel) {
        const p = document.createElement('div');
        p.textContent = `Ish papkasiga saqlandi: ${r.rel} (Fayllar panelida «generated» papkasi) — yangi faylni avtomatik ochish uchun pastdagi havolani bosing.`;
        const open = document.createElement('button');
        open.className = 'btn';
        open.textContent = 'Faylni ochish';
        open.addEventListener('click', () => openTab(r.rel).catch((e) => catchLog('rasmni ochish', e)));
        p.appendChild(open);
        out.appendChild(p);
      }
    }
    activity(`🖼 lokal rasm yaratildi (${r.seconds}s, ${r.via})`, 'ok');
    if (r.rel) await refreshTree().catch(() => {});
  } finally {
    if (go) go.disabled = false;
  }
}

/* =====================================================================================
   GIT PANELI — status, farq (diff), belgilash va commit.
   Maqsad: foydalanuvchi terminalga o'tmasin. Barcha amal `git` CLI orqali IDE main
   jarayonida bajariladi (`ide/ide_git.js`), yo'llar workspace ichida tekshiriladi.
   ===================================================================================== */
const gitPanel = { open: false, files: [], selected: '' };

function gitFileState(f) {
  if (f.untracked) return 'yangi (kuzatilmaydi)';
  if (f.staged && f.worktree !== ' ') return 'belgilangan + o‘zgargan';
  if (f.staged) return 'belgilangan (commit uchun tayyor)';
  return 'o‘zgargan (belgilanmagan)';
}

function renderGitFiles(counts) {
  const box = $('gitFiles');
  if (!box) return;
  if (!gitPanel.files.length) {
    box.innerHTML = '<div class="git-note dim">O‘zgarish yo‘q — ish daraxti toza.</div>';
    return;
  }
  const rows = gitPanel.files.map((f) => {
    const act = f.staged ? 'unstage' : 'stage';
    const btn = `<button class="btn small" data-act="${act}" data-path="${esc(f.path)}">${f.staged ? 'Bekor' : 'Belgilash'}</button>`;
    return `<div class="git-row${gitPanel.selected === f.path ? ' active' : ''}" data-path="${esc(f.path)}">` +
      `<span class="git-path" title="${esc(f.path)}">${esc(f.path)}</span>` +
      `<span class="git-state dim">${esc(gitFileState(f))}</span>` + btn + '</div>';
  });
  const c = counts || {};
  box.innerHTML = `<div class="git-note dim">belgilangan: ${c.staged || 0} · belgilanmagan: ${c.unstaged || 0} · yangi: ${c.untracked || 0}</div>` + rows.join('');
}

async function gitLoad(statusOnly = false) {
  const branch = $('gitBranch');
  const diffBox = $('gitDiff');
  const r = await safe(() => window.ide.gitStatus());
  if (!r || r.error) {
    if (branch) branch.textContent = (r && r.error) || 'git holati o‘qilmadi';
    if ($('gitFiles')) $('gitFiles').innerHTML = '<div class="git-note" style="color:var(--danger)">' + esc((r && r.error) || 'git holati o‘qilmadi') + '</div>';
    return;
  }
  gitPanel.files = r.files || [];
  if (branch) {
    const c = r.counts || {};
    branch.textContent = `branch: ${r.branch || '—'}${r.clean ? ' · toza' : ` · ${(c.staged || 0) + (c.unstaged || 0) + (c.untracked || 0)} o‘zgarish`}`;
  }
  renderGitFiles(r.counts);
  if (!statusOnly && diffBox && !gitPanel.selected) diffBox.textContent = 'Faylni tanlang — farqi shu yerda ko‘rinadi.';
}

async function gitOpenDiff(relPath) {
  gitPanel.selected = relPath;
  renderGitFiles();
  const box = $('gitDiff');
  if (!box) return;
  box.textContent = 'O‘qilmoqda…';
  const file = gitPanel.files.find((f) => f.path === relPath) || {};
  const r = await safe(() => window.ide.gitDiff(relPath, !!file.staged));
  if (!r || r.error) { box.textContent = `Xato: ${(r && r.error) || 'diff o‘qilmadi'}`; return; }
  box.textContent = (r.diff || '(farq yo‘q — fayl yangi yoki faqat rejim o‘zgargan)') + (r.truncated ? '\n\n… (diff juda katta — kesildi)' : '');
}

async function gitLoadLog() {
  const box = $('gitLog');
  if (!box) return;
  const r = await safe(() => window.ide.gitLog(10));
  if (!r || r.error || !Array.isArray(r.commits)) { box.innerHTML = ''; return; }
  box.innerHTML = r.commits.length
    ? '<div class="git-note dim">Oxirgi commitlar:</div>' + r.commits.map((c) => `<div class="git-commit-row"><span class="dim">${esc(c.hash)}</span> <span title="${esc(c.author)} · ${esc(c.date)}">${esc(c.subject)}</span></div>`).join('')
    : '<div class="git-note dim">Hali commit yo‘q.</div>';
}

async function openGitPanel() {
  const modal = $('gitModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  gitPanel.open = true;
  gitPanel.selected = '';
  await gitLoad();
  await gitLoadLog();
}

function closeGitPanel() {
  gitPanel.open = false;
  $('gitModal')?.classList.add('hidden');
}

async function onGitClick(e) {
  const btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (btn) {
    const p = btn.dataset.path || '';
    const act = btn.dataset.act;
    const r = await safe(() => (act === 'stage' ? window.ide.gitStage([p]) : window.ide.gitUnstage([p])));
    if (!r || r.error) { toast(`Git: ${(r && r.error) || 'amal bajarilmadi'}`); return; }
    await gitLoad(true);
    if (gitPanel.selected === p) await gitOpenDiff(p);
    return;
  }
  const row = e.target && e.target.closest ? e.target.closest('.git-row') : null;
  if (row && row.dataset.path) await gitOpenDiff(row.dataset.path);
}

/* =====================================================================================
   LOKAL OVOZLI BUYRUQLAR — mikrofon (Web Audio) → 16 kHz mono WAV → rubaistt (whisper.cpp)
   → allowlist buyruq. Tanilmagan matn HECH NARSA bajarmaydi; matn hech qachon shell'ga
   uzatilmaydi (main jarayon faqat buyruq ID sini qaytaradi).
   ===================================================================================== */
const voice = { recording: false, ctx: null, stream: null, node: null, chunks: [], sampleRate: 16000 };

function voiceShow(text, state = '🎤') {
  const bar = $('voiceBar');
  if (bar) bar.classList.remove('hidden');
  if ($('voiceState')) $('voiceState').textContent = state;
  if ($('voiceText')) $('voiceText').textContent = text;
}

function floatToWav(chunks, inputRate) {
  // 16 kHz mono 16-bit PCM WAV — whisper.cpp aynan shuni kutadi.
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  const ratio = inputRate / voice.sampleRate;
  const outLen = Math.floor(merged.length / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const s = Math.max(-1, Math.min(1, merged[Math.floor(i * ratio)] || 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const str = (o, s) => { for (let i = 0; i < s.length; i += 1) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.byteLength, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, voice.sampleRate, true);
  dv.setUint32(28, voice.sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, pcm.byteLength, true);
  const bytes = new Uint8Array(header.byteLength + pcm.byteLength);
  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(pcm.buffer), 44);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function voiceStart() {
  const st = await safe(() => window.ide.voiceStatus());
  if (!st || st.available === false) {
    voiceShow(`Ovoz modeli tayyor emas: ${(st && st.reason) || 'sabab noma’lum'}`, '⚠️');
    toast('Ovoz modeli o‘rnatilmagan — «Lokal AI» dan rubaistt modelini yuklang');
    return;
  }
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const msg = String((e && e.name) || '') === 'NotAllowedError' ? 'mikrofon ruxsati berilmagan' : `mikrofon ochilmadi: ${(e && e.message) || e}`;
    voiceShow(msg, '⚠️');
    toast(msg);
    return;
  }
  voice.ctx = new AudioContext();
  const src = voice.ctx.createMediaStreamSource(voice.stream);
  const node = voice.ctx.createScriptProcessor(4096, 1, 1);
  voice.chunks = [];
  node.onaudioprocess = (ev) => { voice.chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); };
  src.connect(node);
  node.connect(voice.ctx.destination);   // ba'zi brauzerlar usiz ishlamaydi
  voice.node = node;
  voice.recording = true;
  voiceShow('Gapiring… (tugmani yana bosing — yozish to‘xtaydi)', '🔴');
}

async function voiceStopAndTranscribe() {
  voice.recording = false;
  try { voice.node && voice.node.disconnect(); } catch { /* */ }
  try { voice.stream && voice.stream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
  const rate = (voice.ctx && voice.ctx.sampleRate) || 48000;
  try { voice.ctx && await voice.ctx.close(); } catch { /* */ }
  if (!voice.chunks.length) { voiceShow('Ovoz eshitilmadi — qaytadan urinib ko‘ring', '⚠️'); return; }
  const b64 = floatToWav(voice.chunks, rate);
  voiceShow('Matnga aylantirilmoqda…', '⏳');
  const r = await safe(() => window.ide.voiceTranscribe(b64));
  if (!r || r.error) { voiceShow(`Xato: ${(r && r.error) || 'transkripsiya ishlamadi'}`, '⚠️'); return; }
  const text = String(r.text || '').trim();
  if (!text) { voiceShow('Ovozda matn topilmadi', '⚠️'); return; }
  voiceShow(`${text}  ·  ${r.seconds}s`, '🗣');
  activity(`🎤 ovozli buyruq: „${text.slice(0, 60)}“`);
  const cmd = await safe(() => window.ide.voiceCommand(text));
  if (!cmd || !cmd.ok) {
    voiceShow(`${text}  ·  buyruq ro‘yxatda yo‘q (hech narsa bajarilmadi)`, '🗣');
    return;
  }
  await voiceRunCommand(cmd.command);
}

/** Allowlist buyruqni MAVJUD UI amaliga ulaydi (yangi bajarish yo‘li yaratilmaydi). */
async function voiceRunCommand(c) {
  if (!c) return;
  if (c.missingArg && (c.id === 'open-file' || c.id === 'git-commit')) {
    toast(`«${c.label}» uchun argument kerak — hech narsa bajarilmadi`);
    return;
  }
  if (c.id === 'run-file') { await runActiveFile(); return; }
  if (c.id === 'save-file') { await saveActive(); return; }
  if (c.id === 'stop') { await stopAll(); return; }
  if (c.id === 'git-status') { await openGitPanel(); return; }
  if (c.id === 'open-file') { await openTab(c.arg); return; }
  if (c.id === 'git-commit') {
    await openGitPanel();
    if ($('gitMsg')) { $('gitMsg').value = c.arg || ''; toast('Xabar tayyor — «Commit» tugmasini bosing'); }
    return;
  }
  if (c.id === 'new-chat') { $('aiToggleBtn')?.click(); return; }
  if (c.id === 'debug') { $('dbgRunBtn')?.click(); return; }
  if (c.id === 'run-tests') { $('runBtn')?.click(); return; }
  toast(`«${c.label}» amali bu oynada hali ulanmagan`);
}

/* ------------------------------------------------------------------ hodisalarni ulash */
// Diqqat: `boot()` ichidagi `on()` shu blokdan ko‘rinmaydi (u lokal), shuning uchun
// shu yerda o‘zimizning ingichka bog‘lovchi ishlatiladi.
const bindClick = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
bindClick('gitBtn', () => openGitPanel().catch((e) => catchLog('git paneli', e)));
bindClick('gitClose', closeGitPanel);
bindClick('gitRefresh', () => gitLoad().then(gitLoadLog).catch((e) => catchLog('git yangilash', e)));
bindClick('gitModal', (e) => { if (e.target && e.target.id === 'gitModal') closeGitPanel(); });
bindClick('gitFiles', (e) => onGitClick(e).catch((err) => catchLog('git amali', err)));
bindClick('gitCommit', async () => {
  const msg = (($('gitMsg') && $('gitMsg').value) || '').trim();
  if (!msg) { toast('Commit xabarini yozing'); return; }
  const r = await safe(() => window.ide.gitCommit(msg));
  if (!r || r.error) { toast(`Commit bo‘lmadi: ${(r && r.error) || 'xato'}`); return; }
  toast(`✅ Commit: ${r.hash || ''} ${r.summary || ''}`.trim());
  activity(`git commit: ${r.summary || msg}`, 'ok');
  if ($('gitMsg')) $('gitMsg').value = '';
  gitPanel.selected = '';
  await gitLoad();
  await gitLoadLog();
});
$('gitMsg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('gitCommit')?.click(); } });
bindClick('voiceBtn', async () => {
  if (voice.recording) await voiceStopAndTranscribe();
  else await voiceStart();
});
bindClick('voiceAgain', () => voiceStart().catch((e) => catchLog('ovoz', e)));
bindClick('voiceClose', () => $('voiceBar')?.classList.add('hidden'));

boot().catch((e) => catchLog('ishga tushirish', e));
