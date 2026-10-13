/* YANG IDE — renderer mantiqi (mustaqil muharrir).
   Faqat window.ide ko'prigi orqali tizimga murojaat qiladi. Kutubxona yo'q. */

/* ------------------------------------------------------------------ yordamchi */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const state = {
  workspace: null,
  treeRoot: null,
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
function buildTreeModel(entries) {
  const root = { name: '', path: '', dir: true, children: [], byPath: new Map() };
  root.byPath.set('', root);
  for (const e of entries || []) {
    const parts = String(e.path).split('/').filter(Boolean);
    let node = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      const isLast = i === parts.length - 1;
      let child = node.byPath.get(acc);
      if (!child) {
        child = { name: parts[i], path: acc, dir: isLast ? !!e.dir : true, size: isLast ? e.size : 0, children: [], byPath: new Map() };
        node.children.push(child);
        node.byPath.set(acc, child);
      }
      if (isLast) { child.dir = !!e.dir; child.size = e.size || 0; }
      node = child;
    }
  }
  return root;
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
      const row = document.createElement('div');
      row.className = 'tree-row' + (child.dir ? ' dir' : '');
      if (child.path === state.active) row.classList.add('sel');
      row.style.paddingLeft = `${6 + depth * 12}px`;
      const arrow = child.dir ? (state.collapsed.has(child.path) ? '▸ ' : '▾ ') : '· ';
      row.textContent = `${arrow}${child.name}`;
      row.dataset.path = child.path;
      row.dataset.dir = child.dir ? '1' : '0';
      row.addEventListener('click', () => {
        if (child.dir) {
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
      if (child.dir && !state.collapsed.has(child.path)) walk(child, depth + 1);
    }
  };
  walk(state.treeRoot, 0);
}

function treeCtxItems(node) {
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
  if (!state.workspace) { state.treeRoot = null; renderTree(); return; }
  const r = await safe(() => window.ide.listTree('.', 3));
  if (r && r.entries) {
    state.treeRoot = buildTreeModel(r.entries);
    renderTree();
  }
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
  hl.innerHTML = tokenize(area.value, lang);
  const count = linesOf(area.value).length;
  const { line: curLine } = lineOfIndex(area.value, area.selectionStart);
  let inner = gutter.firstElementChild;
  if (!inner) {
    inner = document.createElement('div');
    inner.id = 'gutterLines';
    gutter.innerHTML = '';
    gutter.appendChild(inner);
  }
  if (forceText || Number(gutter.dataset.count) !== count) {
    let html = '';
    for (let i = 1; i <= count; i++) html += `<div class="gline">${i}</div>`;
    inner.innerHTML = html;
    gutter.dataset.count = String(count);
  }
  const cur = inner.children[curLine - 1];
  if (cur && !cur.classList.contains('gutter-cur')) {
    for (const child of inner.children) child.classList.remove('gutter-cur');
    cur.classList.add('gutter-cur');
  }
  syncScroll();
}

function syncScroll() {
  const area = $('editorArea'), hl = $('highlight'), gutter = $('gutter');
  if (!area || !hl) return;
  hl.scrollTop = area.scrollTop;
  hl.scrollLeft = area.scrollLeft;
  if (gutter && gutter.firstElementChild) {
    gutter.firstElementChild.style.transform = `translateY(${-area.scrollTop}px)`;
  }
}

function updateCursor() {
  const area = $('editorArea');
  if (!area) return;
  const { line, col } = lineOfIndex(area.value, area.selectionStart);
  if ($('cursorPos')) $('cursorPos').textContent = `Ln ${line}, Col ${col}`;
  const tab = activeTab();
  if ($('langLabel')) $('langLabel').textContent = tab ? LANG_NAME[langKeyFor(tab.path)] || 'Text' : '';
  const gutter = $('gutter');
  const inner = gutter && gutter.firstElementChild;
  if (inner) {
    for (const child of inner.children) child.classList.remove('gutter-cur');
    const cur = inner.children[line - 1];
    if (cur) cur.classList.add('gutter-cur');
  }
}

function updateDirty() {
  const tab = activeTab();
  if ($('dirtyLabel')) $('dirtyLabel').textContent = tab ? (tab.dirty ? 'o‘zgartirilgan' : 'saqlangan') : '';
}

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
  renderProblems(r.items || [], r.note || null, tab.path);
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
    row.className = 'problem-row error';
    row.textContent = `Ln ${item.line}: ${item.message}`;
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
  state.teamDoneSeen = false;
  if (team) aiLine('tool', '👥 Jamoa rejimi yoqilgan — planner, agentlar, reviewer va lead ishlaydi');
  aiLine('user', prompt);
  const r = await safe(() => window.ide.aiRun(prompt, !!team));
  if (!r || r.error) state.aiBusy = false;
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
    } else if (ev.type === 'done' || ev.type === 'run_finished') {
      // Yakuniy javob: jamoa bo'lsa team_done allaqachon chiqargan, oddiy rejimda shu yerda.
      if (ev.type === 'done' && ev.content && !state.teamDoneSeen) aiLine('', String(ev.content));
      if (ev.type === 'done') aiLine('tool', 'tayyor');
      state.aiBusy = false;
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
  const probs = tab ? (state.problems[tab.path] || []).slice(0, 3).map((p) => `Ln ${p.line}: ${p.message}`) : [];
  const parts = [
    'Terminaldagi xatoni topib tuzatib ber va ishga tushirib tasdiqla.',
    `Faol fayl: ${tab ? tab.path : '(ochiq fayl yo‘q)'}`,
    probs.length ? `Muammolar:\n${probs.join('\n')}` : '',
    `Terminal chiqishi (oxirgi qism):\n${state.termBuffer.slice(-4000) || '(bo‘sh)'}`,
  ].filter(Boolean);
  await runAi(parts.join('\n\n'), false);
}

/* ------------------------------------------------------------------- boot */
function wireUi() {
  const on = (id, ev, fn) => {
    const el = $(id);
    if (el) el.addEventListener(ev, fn);
  };

  on('openFolderBtn', 'click', () => pickFolder().catch((e) => catchLog('papka ochish', e)));
  on('runBtn', 'click', () => runActiveFile().catch((e) => catchLog('ishga tushirish', e)));
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
  on('aiStop', 'click', () => { window.ide.aiStop(); state.aiBusy = false; aiLine('tool', 'to‘xtatildi'); });
  on('aiFix', 'click', () => aiFixFromContext().catch((e) => catchLog('AI tuzatish', e)));
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
  const files = $('filesView'), search = $('searchView');
  if (files) files.classList.toggle('hidden', which !== 'files');
  if (search) search.classList.toggle('hidden', which !== 'search');
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
  if (e.key === 'F12') { e.preventDefault(); goToDefinition().catch((err) => catchLog('ta’rifga o‘tish', err)); return; }
  if (e.key === '`' && e.ctrlKey) {
    e.preventDefault();
    $('bottomPanel')?.classList.toggle('hidden');
    showPanel('terminal');
    return;
  }
  if (e.key === 'Escape') {
    hideAutocomplete();
    closeCtx();
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
  const r = await safe(() => window.ide.runFile(tab.path));
  if (r && r.opened) { toast('Tashqi ilovada ochildi'); return; }
  if (r && r.command) activity(`▶ running ${tab.path}`, 'ok');
}

async function pickFolder() {
  const r = await safe(() => window.ide.pickFolder());
  if (!r || r.canceled || r.error) return;
  await enterWorkspace(r);
}

async function enterWorkspace(info) {
  state.workspace = { path: info.path, name: info.name };
  state.collapsed.clear();
  state.filter = '';
  if ($('fileFilter')) $('fileFilter').value = '';
  if ($('wsName')) $('wsName').textContent = info.name || info.path;
  activity(`📂 papka ochildi: ${info.path}`);
  await refreshTree();
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

  window.ide.onTermData((d) => { try { if (d && d.chunk) pushTerminal(d.chunk); } catch (e) { catchLog('terminal oqimi', e); } });
  window.ide.onTermExit(async (d) => {
    try {
      const code = d ? d.code : null;
      pushTerminal(`\r\n\u001b[90m[tugadi — kod ${code}]\u001b[0m\r\n`);
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

  const init = await safe(() => window.ide.init());
  if (init && init.workspace) {
    state.workspace = init.workspace;
    if ($('wsName')) $('wsName').textContent = init.workspace.name;
    await refreshTree();
  } else {
    showEmpty();
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

boot().catch((e) => catchLog('ishga tushirish', e));
