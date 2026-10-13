// YANG IDE — mustaqil ish stoli muharriri (Electron main jarayoni).
//
// Arxitektura (haqiqiy IDE'lardagidek qatlamlarga bo'lingan, lekin ixcham):
//   1. GUI qobig'i      — Electron (Chromium + Node), xuddi VS Code/Cursor kabi.
//   2. Muharrir dvigateli — renderer'dagi o'z dvigatelimiz (qator raqamlari, sintaksis
//                          bo'yash, autocomplete, qavs juftligi) + fayl saqlash.
//   3. Til xizmati (lite-LSP) — main'dagi diagnostika: Python compile(), Node --check,
//                          JSON.parse, natija {line, message} ko'rinishida (LSP o'rniga
//                          yengil alternativa; to'liq LSP server ulanmagan).
//   4. I/O va OS     — fs + fs.watch (fayl o'zgarish kuzatuvchisi) + shell.trashItem.
//   5. Terminal      — child_process spawn, oqim (streaming) bilan; PTY emas, shuning
//                       uchun interaktiv TUI (vim/less) ishlamaydi — bu cheklov.
//   6. Debug lite    — faylni ishga tushirib, traceback'ni fayl:qator havolalariga
//                       ajratadi (qadamlab debugger emas).
//   7. AI qatlami    — YANG AI konfiguratsiyasi (kalitlar/provayderlar) bilan ishlaydigan
//                       agent dvigateli: fayl o'qish/yozish + buyruq ishga tushirish.
//
// Xavfsizlik: barcha fayl amallari fayl-tizim ildizidan (workspace) chiqishni bloklaydi,
// yo'l `path.relative` bilan tekshiriladi va symlink hollarida ham guard qo'llanadi.
import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_APP = path.resolve(HERE, '..');
const SHARED_CONFIG_DIR = path.join(app.getPath('appData'), 'yang-ai');
const IDE_STATE_FILE = path.join(app.getPath('userData'), 'ide-state.json');

let win = null;
let workspace = '';
let termCwd = '';
let aiEngine = null;
let aiTeam = null;
const runningCommands = new Map();
let watcher = null;
let watchTimer = null;

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.html', '.htm', '.css', '.scss', '.yml', '.yaml', '.toml', '.ini', '.env', '.sh', '.bat', '.ps1', '.sql', '.csv', '.xml', '.svg', '.log', '.gitignore', '.c', '.h', '.cpp', '.java', '.go', '.rs', '.php', '.rb', '.vue', '.svelte']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico']);
const BINARY_SKIP = new Set(['.exe', '.dll', '.zip', '.7z', '.rar', '.tar', '.gz', '.pdf', '.docx', '.xlsx', '.mp3', '.mp4', '.mov', '.avi', '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.bin', '.gguf', '.node']);
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/* ---------------------------------------------------------------- helpers */
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Workspace ichidagi yo'lni xavfsiz absolut yo'lga aylantiradi. Tashqariga chiqsa null.
function safePath(rel, { allowRoot = false } = {}) {
  if (!workspace) return null;
  const root = path.resolve(workspace);
  const abs = path.resolve(root, String(rel ?? '.'));
  const r = path.relative(root, abs);
  if (!allowRoot && r === '') return null;
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return { abs, rel: r.replace(/\\/g, '/') };
}

function toRel(p) {
  const r = path.relative(path.resolve(workspace), p).replace(/\\/g, '/');
  return r || '.';
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readState() {
  try { return JSON.parse(await fsp.readFile(IDE_STATE_FILE, 'utf8')); } catch { return {}; }
}
async function writeState(patch) {
  const next = { ...(await readState()), ...patch };
  await fsp.mkdir(path.dirname(IDE_STATE_FILE), { recursive: true });
  await fsp.writeFile(IDE_STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/* ------------------------------------------------------------- window */
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'YANG IDE',
    icon: path.join(ROOT_APP, 'renderer', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(HERE, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  Menu.setApplicationMenu(null);
}

/* ------------------------------------------------------------ workspace */
async function setWorkspace(p, { persist = true } = {}) {
  const abs = path.resolve(String(p || ''));
  const st = await fsp.stat(abs).catch(() => null);
  if (!st || !st.isDirectory()) return { error: 'Papka topilmadi' };
  workspace = abs;
  termCwd = abs;
  if (persist) await writeState({ lastWorkspace: abs, recent: [abs, ...((await readState()).recent || []).filter((x) => x !== abs)].slice(0, 8) });
  startWatcher();
  return { path: abs, name: path.basename(abs) || abs };
}

function startWatcher() {
  stopWatcher();
  if (!workspace) return;
  try {
    watcher = fs.watch(workspace, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = String(filename).replace(/\\/g, '/');
      if (rel.includes('node_modules') || rel.startsWith('.git/')) return;
      // Ko'p hodisalar bir zumda keladi — 300 ms to'plab yuboramiz.
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => send('ide:fs-changed', { path: rel }), 300);
    });
  } catch (e) {
    send('ide:notice', { text: `Fayl kuzatuvchisi ishga tushmadi: ${e.message}` });
  }
}
function stopWatcher() {
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  clearTimeout(watchTimer);
}

/* -------------------------------------------------------------- tree/search */
async function listTree(rel, depth, counter = { n: 0 }) {
  const target = safePath(rel, { allowRoot: true });
  if (!target) return { error: 'yo‘l tashqarida' };
  const st = await fsp.stat(target.abs).catch(() => null);
  if (!st) return { error: 'topilmadi' };
  if (st.isFile()) return { entries: [{ path: target.rel, dir: false, size: st.size }] };
  const out = [];
  const walk = async (dir, d) => {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
      if (counter.n++ > 4000) return;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '__pycache__') continue;
      if (e.name.startsWith('.') && e.name !== '.env' && e.name !== '.gitignore') continue;
      const full = path.join(dir, e.name);
      const relPath = toRel(full);
      if (e.isDirectory()) {
        out.push({ path: relPath, dir: true });
        if (d < depth) await walk(full, d + 1);
      } else {
        let size = 0;
        try { size = (await fsp.stat(full)).size; } catch {}
        out.push({ path: relPath, dir: false, size });
      }
    }
  };
  await walk(target.abs, 0);
  return { entries: out };
}

async function searchWorkspace(query, { caseSensitive = false, limit = 200 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [] };
  const root = safePath('.', { allowRoot: true });
  if (!root) return { error: 'papka tanlanmagan' };
  const needle = caseSensitive ? q : q.toLowerCase();
  const results = [];
  let scanned = 0;
  const walk = async (dir) => {
    if (results.length >= limit || scanned > 6000) return;
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= limit || scanned > 6000) return;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '__pycache__' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (BINARY_SKIP.has(ext) || (!TEXT_EXT.has(ext) && ext !== '')) continue;
      scanned++;
      let text = '';
      try {
        const st = await fsp.stat(full);
        if (st.size > 1.5 * 1024 * 1024) continue;
        text = await fsp.readFile(full, 'utf8');
      } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
        if (hay.includes(needle)) {
          results.push({ path: toRel(full), line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (results.length >= limit) return;
        }
      }
    }
  };
  await walk(root.abs);
  return { results, scanned };
}

/* ------------------------------------------------------------ diagnostics */
const PY_DIAG = String.raw`
import json,sys,traceback
p=sys.argv[1]
try:
    src=open(p,encoding='utf-8').read()
except Exception as e:
    print(json.dumps([{'line':1,'col':1,'message':'o\u2018qilmadi: %s'%e,'severity':'error'}]));raise SystemExit(0)
try:
    compile(src,p,'exec')
    print(json.dumps([]))
except SyntaxError as e:
    print(json.dumps([{'line':e.lineno or 1,'col':e.offset or 1,'message':(e.msg or 'syntax error'),'severity':'error'}]))
except Exception as e:
    print(json.dumps([{'line':1,'col':1,'message':str(e),'severity':'error'}]))
`;
const PY_BIN = process.env.YANG_IDE_PYTHON || 'python';

function diagnosticsSync(abs, ext) {
  const items = [];
  if (ext === '.py') {
    const r = spawnSync(PY_BIN, ['-I', '-B', '-c', PY_DIAG, abs], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.error || (r.status !== 0 && !r.stdout)) {
      return { items: [], note: `Python topilmadi yoki ishlamadi (${r.error?.message || `exit ${r.status}`}) — Python diagnostikasi o‘chirildi` };
    }
    try { items.push(...JSON.parse(r.stdout.trim() || '[]')); } catch {}
    return { items };
  }
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status !== 0) {
      const text = `${r.stdout || ''}${r.stderr || ''}`;
      const m = text.match(/:(\d+)\s*$/m) || text.match(/:(\d+):(\d+)/);
      const line = m ? Number(m[1]) : 1;
      const msg = text.split('\n').find((l) => /Error|error/.test(l)) || 'sintaksis xatosi';
      items.push({ line, col: 1, message: msg.trim().slice(0, 200), severity: 'error' });
    }
    return { items };
  }
  if (ext === '.json') {
    const r = spawnSync(process.execPath, ['-e', 'try{JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch(e){console.error(e.message);process.exit(1)}', abs], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status !== 0) items.push({ line: 1, col: 1, message: (r.stderr || 'JSON xatosi').trim().slice(0, 200), severity: 'error' });
    return { items };
  }
  return { items, note: null };
}

/* --------------------------------------------------------------- terminal */
function resolveShellCommand(command) {
  // "cd <papka>" ni alohida ushlaymiz — terminal sessiyasi cwd'ini o'zgartiradi.
  const cdMatch = String(command).trim().match(/^cd(?:\s+(.+))?$/i);
  if (cdMatch) {
    const target = (cdMatch[1] || os.homedir()).trim().replace(/^["']|["']$/g, '');
    const abs = path.resolve(termCwd, target);
    if (!fs.existsSync(abs)) return { error: `papka topilmadi: ${abs}` };
    termCwd = abs;
    return { cd: abs };
  }
  return { command: String(command) };
}

function runCommand(command, cwdRel) {
  const base = cwdRel ? safePath(cwdRel, { allowRoot: true }) : { abs: termCwd };
  if (!base) return { error: 'cwd tashqarida' };
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: base.abs, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } })
    : spawn('/bin/sh', ['-c', command], { cwd: base.abs, env: { ...process.env, FORCE_COLOR: '0' } });
  runningCommands.set(id, child);
  send('ide:term-data', { id, chunk: `\u001b[90m$ ${command}\u001b[0m\r\n` });
  const forward = (stream) => stream.on('data', (buf) => send('ide:term-data', { id, chunk: String(buf) }));
  forward(child.stdout);
  forward(child.stderr);
  child.on('error', (err) => send('ide:term-data', { id, chunk: `\r\n[ishga tushmadi: ${err.message}]\r\n` }));
  child.on('close', (code) => {
    runningCommands.delete(id);
    send('ide:term-exit', { id, code, cwd: termCwd });
  });
  return { id, cwd: base.abs };
}

function runtimeFor(abs) {
  const ext = path.extname(abs).toLowerCase();
  const rel = path.basename(abs);
  const quoted = `"${abs}"`;
  if (ext === '.py') return `${PY_BIN} ${quoted}`;
  if (['.js', '.mjs', '.cjs'].includes(ext)) return `"${process.execPath}" ${quoted}`;
  if (ext === '.html' || ext === '.htm') return null;
  if (ext === '.sh') return `bash ${quoted}`;
  if (ext === '.bat' || ext === '.cmd') return `"${abs}"`;
  if (ext === '.ps1') return `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoted}`;
  if (rel === 'package.json') return 'npm start';
  return null;
}

// Traceback/stack ichidan "fayl:qator" havolalarini ajratib beradi (debug lite).
function parseErrorLinks(text) {
  const links = [];
  const patterns = [
    /File "([^"]+)", line (\d+)/g,          // Python traceback
    /at .*?\(?([A-Za-z]:[^:()]+|\/[^:()]+):(\d+):(\d+)\)?/g, // Node stack
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const file = m[1];
      if (!file) continue;
      const abs = path.isAbsolute(file) ? file : path.resolve(termCwd, file);
      const rel = toRel(abs);
      if (rel.startsWith('..')) continue;
      links.push({ path: rel, line: Number(m[2]) });
    }
  }
  return links.slice(0, 20);
}

/* --------------------------------------------------------------------- AI */
// Diqqat: Windows'da ESM dinamik import FAQAT file:// URL bilan ishlaydi —
// `import('C:\\...')` ERR_UNSUPPORTED_ESM_URL_SCHEME beradi.
const agentModule = (name) => import(pathToFileURL(path.join(ROOT_APP, 'agent', name)).href);

async function loadSharedConfig() {
  const mod = await agentModule('config.js');
  const { config } = await mod.loadConfig(SHARED_CONFIG_DIR);
  return { mod, config };
}

// ---- Ilova ichidagi (bundled) lokal model ----
// YANG AI bilan bir xil mantiq: llama-server.exe ni fon rejimida ko'taradi, model RAM
// bo'yicha tanlanadi. YANG AI allaqachon ko'tarib qo'ygan bo'lsa — qayta ko'tarmaymiz.
let localServerStarted = false;
let localServerInfo = null;
async function ensureLocalServer(config) {
  const providers = await agentModule('providers.js');
  if (!providers.isBundledLocalProvider(config, config.provider)) return null;
  const { host, port, base } = providers.localEndpoint(config);
  if (await providers.localServerUp(config)) {
    localServerStarted = true;
    return { host, port, base, already: true };
  }
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'local-ai') : path.join(ROOT_APP, 'local-ai');
  const exeDir = path.join(dir, 'lc');
  const exe = path.join(exeDir, 'llama-server.exe');
  if (!fs.existsSync(exe)) {
    send('ide:notice', { text: 'Lokal model fayllari topilmadi — bulut provaydér ishlatiladi' });
    return null;
  }
  // Model tanlash — O'LCHOVGA asoslangan (reports/local_ai/local-ai-hisobot.md):
  //   qwen3.5-2B q4_k_m (1.28 GB) — bir xil 4 vazifada 3/4 (one-shot) va eng tez
  //   → 1.7B (ilovaning o'zi bilan keladi, 3/4) → 4B (RAM >= 8 GB bo'lsa; sekin CPU'da
  //   2-3/4, shuning uchun oxirgi o'rinda) → 0.5B zaxira.
  // Ya'ni "ixcham, lekin kuchli" — 2B. 4B ni faqat foydalanuvchi qo'lda qo'shsa ishlatamiz.
  const gb = os.totalmem() / 1024 ** 3;
  const candidates = [
    ['model-qwen3.5-2b-q4_k_m.gguf', true],
    ['model-1.7b.gguf', true],
    ['model-qwen3-4b-2507.gguf', gb >= 8],
    ['model.gguf', true],
  ];
  const picked = candidates.find(([f, ok]) => ok && fs.existsSync(path.join(dir, f)));
  if (!picked) {
    send('ide:notice', { text: 'Lokal model fayli topilmadi (gguf) — bulut ishlatiladi' });
    return null;
  }
  const modelFile = picked[0];
  // Kontekst zinapoyasi: katta kontekst ko'proq KV kesh so'raydi va RAM band bo'lganda
  // llama-server "failed to allocate buffer for kv cache" bilan yiqiladi (o'lchandi:
  // 4B + 8192, bo'sh RAM 2.4 GB). Shuning uchun kichraytirib qayta urinamiz.
  const preferred = gb >= 6 ? 8192 : 4096;
  const ladder = [...new Set([preferred, 4096, 2048])].filter((c) => c <= preferred);
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      await new Promise((r) => setTimeout(r, 800));
    }
    const reasons = [];
    for (const ctx of ladder) {
      send('ide:notice', { text: `Lokal model yuklanmoqda: ${modelFile} (kontekst ${ctx})` });
      const attempt = await startLlamaServer({ exe, dir, modelFile, host, port, ctx });
      if (attempt.ok) {
        localServerStarted = true;
        localServerInfo = { host, port, base, model: modelFile, ctx };
        send('ide:notice', { text: `Lokal model tayyor: ${modelFile} (${attempt.seconds}s)` });
        return localServerInfo;
      }
      reasons.push(attempt.reason);
      await new Promise((r) => setTimeout(r, 700));
    }
    send('ide:notice', { text: `Lokal model ko'tarilmadi: ${reasons.join('; ')}` });
    return null;
  } catch (e) {
    send('ide:notice', { text: `Lokal model xatosi: ${e.message}` });
    return null;
  }
}

// llama-server ni ko'tarib, port javob berguncha kutamiz. Avvalgi kod darhol qaytardi:
// birinchi AI so'rovi hali yuklanmagan serverga urilib, javob o'rniga xato olardi.
async function startLlamaServer({ exe, dir, modelFile, host, port, ctx }) {
  const startedAt = Date.now();
  let died = false;
  const child = spawn(exe, ['-m', modelFile, '--alias', 'qwen3-instruct', '--host', host, '--port', String(port), '-c', String(ctx), '--reasoning', 'off', '--no-webui'], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => { died = true; });
  child.on('exit', () => { died = true; });
  child.unref();
  for (;;) {
    if (died) { try { child.kill(); } catch {} return { ok: false, reason: `${ctx} kontekst bilan yiqildi` }; }
    if (Date.now() - startedAt > 150000) { try { child.kill(); } catch {} return { ok: false, reason: `${ctx} kontekstda 150 s ichida ko'tarilmadi` }; }
    try {
      const res = await fetch(`http://${host}:${port}/v1/models`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return { ok: true, ctx, seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)) };
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
}

async function aiStatus() {
  try {
    const { config } = await loadSharedConfig();
    const providers = await agentModule('providers.js');
    const all = providers.getAllProviders(config);
    const list = Object.values(all).map((p) => ({ id: p.id, name: p.name, models: p.models || [], local: !!p.local }))
      .filter((p) => p.models.length);
    return { provider: config.provider, model: config.model, providers: list, sharedConfig: SHARED_CONFIG_DIR };
  } catch (e) {
    return { error: e.message };
  }
}

async function aiSetModel(provider, model) {
  const { mod, config } = await loadSharedConfig();
  config.provider = provider || config.provider;
  config.model = model || config.model;
  await mod.saveConfig(SHARED_CONFIG_DIR, config);
  return { provider: config.provider, model: config.model };
}

async function aiRun({ prompt, team = false }) {
  if (!workspace) return { error: 'Avval papka oching' };
  if (aiEngine || aiTeam) return { error: 'AI allaqachon ishlayapti' };
  const text = String(prompt || '').trim();
  if (!text) return { error: 'vazifa bo‘sh' };
  const { config } = await loadSharedConfig();
  // Lokal provaydér tanlangan bo'lsa serverni o'zimiz ko'taramiz (mustaqil exe uchun muhim).
  await ensureLocalServer(config).catch(() => {});
  const prelude = `Sen YANG IDE ichida ishlayapsan. Ochiq papka: ${workspace}\n` +
    'Fayllar shu papkaga nisbatan yoziladi. Ishni tugatgach qisqa xulosa yoz.';
  try {
    if (team) {
      const { TeamRunner } = await agentModule('team.js');
      aiTeam = new TeamRunner({ config, workspace });
      aiTeam.on('event', (e) => send('ide:ai-event', e));
      const res = await aiTeam.run({ task: text });
      send('ide:ai-event', { type: 'done', content: res?.content ?? '' });
      return { ok: true };
    }
    const { AgentEngine } = await agentModule('engine.js');
    aiEngine = new AgentEngine({ config, workspace, maxSteps: 30 });
    aiEngine.on('event', (e) => send('ide:ai-event', e));
    await aiEngine.run({ events: [], userText: `${prelude}\n\nVazifa: ${text}` });
    return { ok: true };
  } catch (e) {
    send('ide:ai-event', { type: 'error', message: String(e.message || e) });
    return { error: String(e.message || e) };
  } finally {
    aiEngine = null;
    aiTeam = null;
    send('ide:ai-event', { type: 'run_finished' });
  }
}

function aiStop() {
  const target = aiEngine || aiTeam;
  if (target) { try { target.abort(); } catch {} }
  aiEngine = null;
  aiTeam = null;
  return { ok: true };
}

/* ------------------------------------------------------------------- IPC */
function registerIpc() {
  ipcMain.handle('ide:pick-folder', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Papka tanlang' });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const info = await setWorkspace(res.filePaths[0]);
    return { ...info, recent: (await readState()).recent || [] };
  });

  ipcMain.handle('ide:open-folder', async (_e, { path: p }) => {
    const info = await setWorkspace(p);
    return { ...info, recent: (await readState()).recent || [] };
  });

  ipcMain.handle('ide:init', async () => {
    const state = await readState();
    if (state.lastWorkspace && await exists(state.lastWorkspace)) await setWorkspace(state.lastWorkspace, { persist: false });
    return { workspace: workspace ? { path: workspace, name: path.basename(workspace) } : null, recent: state.recent || [], tabs: state.tabs || [] };
  });

  ipcMain.handle('ide:list-tree', async (_e, { rel = '.', depth = 3 } = {}) => listTree(rel, Math.max(1, Math.min(8, Number(depth) || 3))));

  ipcMain.handle('ide:read-file', async (_e, { path: p, maxBytes } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida yoki papka tanlanmagan' };
    try {
      const st = await fsp.stat(t.abs);
      if (!st.isFile()) return { error: 'bu fayl emas' };
      const ext = path.extname(t.abs).toLowerCase();
      if (IMAGE_EXT.has(ext)) return { image: true, path: t.rel, size: st.size };
      if (BINARY_SKIP.has(ext)) {
        return { error: `binary fayl (${(st.size / 1024).toFixed(0)} KB) — tahrirlash mumkin emas, tashqi ilovada oching` };
      }
      const limit = Math.min(Math.max(Number(maxBytes) || 400000, 1000), MAX_EDIT_BYTES);
      const buf = await fsp.readFile(t.abs);
      const text = buf.subarray(0, limit).toString('utf8');
      return { text, size: st.size, truncated: buf.length > limit, path: t.rel };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('ide:write-file', async (_e, { path: p, content } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida' };
    if (typeof content !== 'string') return { error: 'mazmun matn bo‘lishi kerak' };
    if (content.length > MAX_EDIT_BYTES) return { error: 'fayl juda katta (2 MB dan oshdi)' };
    try {
      const existed = await exists(t.abs);
      if (existed) {
        const bak = `${t.abs}.bak`;
        if (!(await exists(bak))) await fsp.copyFile(t.abs, bak);
      } else {
        await fsp.mkdir(path.dirname(t.abs), { recursive: true });
      }
      await fsp.writeFile(t.abs, content, 'utf8');
      const st = await fsp.stat(t.abs);
      return { ok: true, path: t.rel, size: st.size };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('ide:create', async (_e, { path: p, dir = false } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida' };
    try {
      if (await exists(t.abs)) return { error: 'allaqachon mavjud' };
      if (dir) await fsp.mkdir(t.abs, { recursive: true });
      else {
        await fsp.mkdir(path.dirname(t.abs), { recursive: true });
        await fsp.writeFile(t.abs, '', 'utf8');
      }
      return { ok: true, path: t.rel };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('ide:rename', async (_e, { from, to } = {}) => {
    const a = safePath(from);
    const b = safePath(to);
    if (!a || !b) return { error: 'yo‘l tashqarida' };
    try {
      if (await exists(b.abs)) return { error: 'maqsad mavjud' };
      await fsp.rename(a.abs, b.abs);
      return { ok: true, path: b.rel };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('ide:delete', async (_e, { path: p } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida' };
    try {
      // O'chirmasdan savatga (trash) yuboramiz — qaytarib olish mumkin.
      await shell.trashItem(t.abs);
      return { ok: true, path: t.rel };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('ide:search', async (_e, { query, caseSensitive } = {}) => searchWorkspace(query, { caseSensitive }));

  ipcMain.handle('ide:open-external', async (_e, { path: p } = {}) => {
    let abs;
    if (p) {
      const t = safePath(p);
      if (!t) return { error: 'yo‘l tashqarida' };
      abs = t.abs;
    } else {
      if (!workspace) return { error: 'papka yo‘q' };
      abs = workspace;
    }
    const err = await shell.openPath(abs);
    return err ? { error: err } : { ok: true };
  });

  ipcMain.handle('ide:diagnostics', async (_e, { path: p } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida', items: [] };
    const ext = path.extname(t.abs).toLowerCase();
    return diagnosticsSync(t.abs, ext);
  });

  ipcMain.handle('ide:run-command', async (_e, { command, cwd } = {}) => {
    if (!workspace) return { error: 'papka tanlanmagan' };
    const resolved = resolveShellCommand(command);
    if (resolved.error) return { error: resolved.error };
    if (resolved.cd) return { cd: resolved.cd, cwd: termCwd };
    return runCommand(resolved.command, cwd);
  });

  ipcMain.handle('ide:run-file', async (_e, { path: p } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida' };
    const cmd = runtimeFor(t.abs);
    if (!cmd) {
      const err = await shell.openPath(t.abs);
      return err ? { error: err } : { opened: true };
    }
    const started = runCommand(cmd, path.dirname(t.rel));
    return { ...started, command: cmd };
  });

  ipcMain.handle('ide:kill-command', async (_e, { id } = {}) => {
    const child = runningCommands.get(id);
    if (!child) return { error: 'buyruq topilmadi' };
    try { child.kill(); } catch {}
    return { ok: true };
  });

  ipcMain.handle('ide:error-links', async (_e, { text } = {}) => ({ links: parseErrorLinks(String(text || '')) }));

  ipcMain.handle('ide:save-tabs', async (_e, { tabs } = {}) => {
    await writeState({ tabs: Array.isArray(tabs) ? tabs.slice(0, 30) : [] });
    return { ok: true };
  });

  ipcMain.handle('ide:ai-status', aiStatus);
  ipcMain.handle('ide:ai-set-model', (_e, args) => aiSetModel(args?.provider, args?.model));
  ipcMain.handle('ide:ai-run', (_e, args) => aiRun(args || {}));
  ipcMain.handle('ide:ai-stop', () => aiStop());

  ipcMain.handle('ide:sys-info', () => ({
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
    cpus: os.cpus().length,
    ramMb: Math.round(os.totalmem() / 1024 ** 2),
    version: app.getVersion(),
    localModel: localServerInfo ? localServerInfo.model : null,
    localStarted: localServerStarted,
  }));
}

/* ------------------------------------------------------------------ boot */
app.whenReady().then(async () => {
  registerIpc();
  createWindow();
  const state = await readState();
  if (state.lastWorkspace && await exists(state.lastWorkspace)) {
    await setWorkspace(state.lastWorkspace, { persist: false });
  }
  // Lokal modelni fonda ko'taramiz — foydalanuvchi AI'ni bosganda tayyor bo'lsin.
  loadSharedConfig().then(({ config }) => ensureLocalServer(config)).catch(() => {});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  stopWatcher();
  for (const child of runningCommands.values()) { try { child.kill(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});
