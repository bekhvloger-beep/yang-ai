// ide_host.js — YANG IDE yadrosi: oyna, IPC, fayl tizimi, terminal va AI qatlami.
//
// Bitta manba, ikki rejim:
//   1) MUSTAQIL dastur — `ide/main.js` (o'z jarayoni, alohida o'rnatuvchi);
//   2) YANG AI ICHIDA — `main.js` IDE oynasini shu modul orqali ochadi, ya'ni
//      IDE asosiy ilova o'rnatuvchisi bilan birga keladi (alohida exe shart emas).
// Shu sabab bu yerda `app.whenReady()`, `Menu.setApplicationMenu()` yoki
// `window-all-closed` kabi hayot-aylanish qarorlari YO'Q — ularni chaqiruvchi
// tomon (ide/main.js yoki YANG AI main.js) boshqaradi.
//
// Arxitektura (haqiqiy IDE'lardagidek qatlamlarga bo'lingan, lekin ixcham):
//   1. GUI qobig'i        — Electron (Chromium + Node), xuddi VS Code/Cursor kabi.
//   2. Muharrir dvigateli — renderer'dagi o'z dvigatelimiz (qator raqamlari, sintaksis
//                           bo'yash, autocomplete, qavs juftligi) + fayl saqlash.
//   3. Til xizmati (lite-LSP) — main'dagi diagnostika: Python compile(), Node --check,
//                           JSON.parse, natija {line, message} ko'rinishida (LSP o'rniga
//                           yengil alternativa; to'liq LSP server ulanmagan).
//   4. I/O va OS          — fs + fs.watch (fayl o'zgarish kuzatuvchisi) + shell.trashItem.
//   5. Terminal           — child_process spawn, oqim (streaming) bilan; PTY emas, shuning
//                           uchun interaktiv TUI (vim/less) ishlamaydi — bu cheklov.
//   6. Debug lite         — faylni ishga tushirib, traceback'ni fayl:qator havolalariga
//                           ajratadi (qadamlab debugger emas).
//   7. AI qatlami         — YANG AI konfiguratsiyasi (kalitlar/provayderlar) bilan ishlaydigan
//                           agent dvigateli: fayl o'qish/yozish + buyruq ishga tushirish.
//
// Xavfsizlik: barcha fayl amallari fayl-tizim ildizidan (workspace) chiqishni bloklaydi,
// yo'l `path.relative` bilan tekshiriladi va symlink hollarida ham guard qo'llanadi.
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// IDE qobiliyatlari alohida modullarda (har biri ixtiyoriy — biri ishlamasa qolganlari ishlaydi):
//   ide_pty.js    — haqiqiy terminal (PTY + ConPTY), interaktiv TUI
//   ide_lsp.js    — til xizmati (tsserver): semantik xato, ta'rif, havolalar, hover
//   ide_debug.js  — qadamlab debugger (CDP: nuqtalar, stack, o'zgaruvchilar)
//   ide_runner.js — ishga tushirish + TARIX (log) + «sinab ko'r va tuzat» halqasi
import { registerPtyIpc, disposePty } from './ide_pty.js';
import { registerLspIpc, disposeLsp } from './ide_lsp.js';
import { registerDebugIpc, disposeDebug } from './ide_debug.js';
import { registerRunnerIpc, disposeRunner, runCaptured, lastFailure } from './ide_runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_APP = path.resolve(HERE, '..');

// IPC kanal prefiksi. YANG AI ichida o'zining `ide:*` kanallari bor (ilova ichidagi
// yengil IDE paneli), shuning uchun to'liq IDE `yide:*` da ishlaydi — ikki to'plam
// bir jarayonda to'qnashmaydi va `ipcMain.handle` ikki marta ro'yxatga olinmaydi.
const CH = 'yide';

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.html', '.htm', '.css', '.scss', '.yml', '.yaml', '.toml', '.ini', '.env', '.sh', '.bat', '.ps1', '.sql', '.csv', '.xml', '.svg', '.log', '.gitignore', '.c', '.h', '.cpp', '.java', '.go', '.rs', '.php', '.rb', '.vue', '.svelte']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico']);
const BINARY_SKIP = new Set(['.exe', '.dll', '.zip', '.7z', '.rar', '.tar', '.gz', '.pdf', '.docx', '.xlsx', '.mp3', '.mp4', '.mov', '.avi', '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.bin', '.gguf', '.node']);
// TAHRIR CHEGARASI YO'Q — ilgari 2 MB dan katta fayl umuman ochilmasdi.
// Endi yagona chegara — xotira himoyasi: 512 MB dan katta fayl brauzer textarea'sini ham,
// jarayonni ham o'ldiradi, shuning uchun u tashqi ilovada ochiladi va aniq xabar beriladi.
const HARD_FILE_CEILING = 512 * 1024 * 1024;   // 512 MB — faqat xotira himoyasi
const BIG_FILE_NOTICE = 8 * 1024 * 1024;       // 8 MB — «katta fayl» rejimi (sintaksis bo'yash o'chadi)
const BACKUP_MAX = 32 * 1024 * 1024;           // .bak nusxa faqat shu hajmgacha olinadi

let ideWin = null;
let workspace = '';
let termCwd = '';
let aiEngine = null;
let aiTeam = null;
let standaloneMode = false;
const runningCommands = new Map();
let watcher = null;
let watchTimer = null;
let ipcRegistered = false;

// `app.getPath(...)` faqat ready'dan keyin ishonchli — shuning uchun yo'llar funksiya.
const stateFile = () => path.join(app.getPath('userData'), 'ide-state.json');
// YANG AI bilan BIR XIL sozlamalar papkasi: kalitlar, provayderlar, tanlangan model.
// `YANG_AI_CONFIG_DIR` — sinov va ko'p nusxali ish uchun (masalan, boshqa model bilan
// sinash kerak bo'lganda foydalanuvchining haqiqiy sozlamalari tegilmaydi).
const sharedConfigDir = () => process.env.YANG_AI_CONFIG_DIR || app.getPath('userData');

/* ---------------------------------------------------------------- helpers */
function send(channel, payload) {
  if (ideWin && !ideWin.isDestroyed()) ideWin.webContents.send(channel, payload);
}

// Workspace ichidagi yo'lni xavfsiz absolut yo'lga aylantiradi. Tashqariga chiqsa null.
function realOf(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/**
 * Ish papkasidan chiqishni HAQIQIY yo'l bilan bloklaydi.
 * Nega kerak: `path.relative` havolani (junction/symlink) ko'rmaydi. Hujum sinovi
 * (`agent/test_security_attacks.mjs`) ish papkasi ichida `link/` → `C:\Windows` havolasini
 * yaratib, `link/win.ini` ni o'qib ketdi. Shuning uchun ikkala tomonni ham `realpath`
 * orqali haqiqiy yo'lga keltiramiz; yangi (hali yo'q) fayl uchun eng yaqin mavjud
 * ota-papkaning haqiqiy yo'lini olamiz.
 */
function realInside(wsRoot, abs) {
  const realRoot = realOf(wsRoot) || path.resolve(wsRoot);
  let target = realOf(abs);
  if (!target) {
    const parent = realOf(path.dirname(abs));
    if (!parent) return null;                       // ota-papka ham yo'q — ishonchsiz yo'l
    target = path.join(parent, path.basename(abs));
  }
  const r = path.relative(realRoot, target);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return target;
}

function safePath(rel, { allowRoot = false } = {}) {
  if (!workspace) return null;
  const root = path.resolve(workspace);
  const abs = path.resolve(root, String(rel ?? '.'));
  const r = path.relative(root, abs);
  if (!allowRoot && r === '') return null;
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  const real = realInside(root, abs);
  if (!real) return null;
  return { abs: real, rel: path.relative(realOf(root) || root, real).replace(/\\/g, '/') || '.' };
}

function toRel(p) {
  const r = path.relative(path.resolve(workspace), p).replace(/\\/g, '/');
  return r || '.';
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readState() {
  try { return JSON.parse(await fsp.readFile(stateFile(), 'utf8')); } catch { return {}; }
}
async function writeState(patch) {
  const next = { ...(await readState()), ...patch };
  const file = stateFile();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/* ------------------------------------------------------------- window */
function createWindow() {
  ideWin = new BrowserWindow({
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
  ideWin.loadFile(path.join(HERE, 'renderer', 'index.html'));
  ideWin.on('closed', () => { ideWin = null; stopWatcher(); });
  return ideWin;
}

/**
 * IDE oynasini ochadi (yoki mavjudini oldinga chiqaradi).
 * @param {{ workspace?: string, parent?: import('electron').BrowserWindow }} [opts]
 */
export async function openIdeWindow(opts = {}) {
  if (ideWin && !ideWin.isDestroyed()) {
    ideWin.show();
    ideWin.focus();
    if (opts.workspace) await setWorkspace(opts.workspace, { persist: true }).catch(() => {});
    return ideWin;
  }
  createWindow();
  const wanted = opts.workspace || (await readState()).lastWorkspace;
  if (wanted && (await exists(wanted))) await setWorkspace(wanted, { persist: false }).catch(() => {});
  return ideWin;
}

/** IDE oynasi ochiqmi? */
export function ideWindow() {
  return ideWin && !ideWin.isDestroyed() ? ideWin : null;
}

/** Yopilishda: kuzatuvchi, terminal/PTY, debugger, yurishlar va AI halqasini to'xtatadi. */
export function disposeIde() {
  stopWatcher();
  for (const child of runningCommands.values()) { try { child.kill(); } catch {} }
  runningCommands.clear();
  try { disposePty(); } catch { /* PTY yo'q */ }
  try { disposeDebug(); } catch { /* debugger yo'q */ }
  try { disposeRunner(); } catch { /* yurish yo'q */ }
  try { disposeLsp(); } catch { /* til xizmati yo'q */ }
  const target = aiEngine || aiTeam;
  if (target) { try { target.abort(); } catch {} }
  aiEngine = null;
  aiTeam = null;
}

// Oxirgi diagnostika (AI tuzatish halqasi va «Xatoni tuzat» uchun log konteksti).
let lastDiagPath = '';
const diagCache = new Map();
function rememberDiagnostics(rel, items) {
  if (!rel) return;
  lastDiagPath = rel;
  diagCache.set(rel, items || []);
}
// AI ga beriladigan diagnostika: oxirgi muvaffaqiyatsiz yurish fayli bo'lsa — o'shaniki.
function diagnosticsForFix() {
  try {
    const fail = lastFailure();
    const p = (fail && fail.path) || lastDiagPath;
    return diagCache.get(p) || diagCache.get(lastDiagPath) || [];
  } catch { return []; }
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
      watchTimer = setTimeout(() => send(`${CH}:fs-changed`, { path: rel }), 300);
    });
  } catch (e) {
    send(`${CH}:notice`, { text: `Fayl kuzatuvchisi ishga tushmadi: ${e.message}` });
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
    // `ELECTRON_RUN_AS_NODE` bo'lmasa electron.exe `--check` ni tushunmaydi: o'rniga App
    // ochishga urinib "App threw an error during load" beradi (o'lchandi). Ya'ni sintaksis
    // tekshiruvi soxta xato ko'rsatardi — endi exe oddiy Node kabi ishlaydi.
    const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
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
    const r = spawnSync(process.execPath, ['-e', 'try{JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch(e){console.error(e.message);process.exit(1)}', abs], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
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

function runCommand(command, cwdRel, extraEnv = {}) {
  const base = cwdRel ? safePath(cwdRel, { allowRoot: true }) : { abs: termCwd };
  if (!base) return { error: 'cwd tashqarida' };
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const isWin = process.platform === 'win32';
  const env = { ...process.env, FORCE_COLOR: '0', ...extraEnv };
  // Windows'da `cmd /d /s /c` dan foydalanishning O'Z qoidasi bor: tashqi qo'shtirnoq
  // juftligi olib tashlanadi, shuning uchun BUTUN buyruq qo'shtirnoqqa olinadi va argumentlar
  // "verbatim" (o'zgartirilmasin) yuboriladi — Node'ning o'zi ham shell rejimida aynan shunday
  // qiladi. Aks holda qo'shtirnoq bilan boshlanadigan buyruq yiqilardi (o'lchandi:
  // `"…electron.exe" "hello.js"` → "is not recognized as an internal or external command").
  const child = isWin
    ? spawn('cmd.exe', ['/d', '/s', '/c', `"${command}"`], { cwd: base.abs, windowsHide: true, env, windowsVerbatimArguments: true })
    : spawn('/bin/sh', ['-c', command], { cwd: base.abs, env });
  runningCommands.set(id, child);
  send(`${CH}:term-data`, { id, chunk: `\u001b[90m$ ${command}\u001b[0m\r\n` });
  const forward = (stream) => stream.on('data', (buf) => send(`${CH}:term-data`, { id, chunk: String(buf) }));
  forward(child.stdout);
  forward(child.stderr);
  child.on('error', (err) => send(`${CH}:term-data`, { id, chunk: `\r\n[ishga tushmadi: ${err.message}]\r\n` }));
  child.on('close', (code) => {
    runningCommands.delete(id);
    send(`${CH}:term-exit`, { id, code, cwd: termCwd });
  });
  return { id, cwd: base.abs };
}

// Faylni ishga tushirish buyrug'i. Qaytaradi: { command, env } yoki null (tashqi ilovada ochiladi).
//
// Faylni ishga tushirish mantig'i (interpretator tanlash) `ide_runner.js` da — u yerda
// yurish TARIXGA yoziladi va «sinab ko'r + tuzat» halqasi ham o'sha tarixdan oziqlanadi.

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
  const { config } = await mod.loadConfig(sharedConfigDir());
  return { mod, config };
}

// ---- Ilova ichidagi (bundled) lokal model ----
// YANG AI bilan bir xil mantiq: llama-server.exe ni fon rejimida ko'taradi, model RAM
// bo'yicha tanlanadi. YANG AI allaqachon ko'tarib qo'ygan bo'lsa — qayta ko'tarmaymiz.
let localServerStarted = false;
let localServerInfo = null;

/** Lokal modelni fonda tayyorlab qo'yadi (mustaqil IDE ishga tushganda chaqiriladi). */
export async function warmLocalModel() {
  try {
    const { config } = await loadSharedConfig();
    await ensureLocalServer(config);
  } catch { /* lokal AI yo'q — bulut ishlatiladi */ }
}

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
    send(`${CH}:notice`, { text: 'Lokal model fayllari topilmadi — bulut provaydér ishlatiladi' });
    return null;
  }
  // Model tanlash — O'LCHOVGA asoslangan (reports/local_ai/local-ai-hisobot.md):
  //   qwen3.5-2B q4_k_m (1.28 GB) — bir xil 4 vazifada 3/4 (one-shot) va eng tez
  //   → 1.7B (YANG AI bilan birga keladi, 3/4) → 4B (RAM >= 8 GB bo'lsa; sekin CPU'da
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
    send(`${CH}:notice`, { text: 'Lokal model fayli topilmadi (gguf) — bulut ishlatiladi' });
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
      send(`${CH}:notice`, { text: `Lokal model yuklanmoqda: ${modelFile} (kontekst ${ctx})` });
      const attempt = await startLlamaServer({ exe, dir, modelFile, host, port, ctx });
      if (attempt.ok) {
        localServerStarted = true;
        localServerInfo = { host, port, base, model: modelFile, ctx };
        send(`${CH}:notice`, { text: `Lokal model tayyor: ${modelFile} (${attempt.seconds}s)` });
        return localServerInfo;
      }
      reasons.push(attempt.reason);
      await new Promise((r) => setTimeout(r, 700));
    }
    send(`${CH}:notice`, { text: `Lokal model ko'tarilmadi: ${reasons.join('; ')}` });
    return null;
  } catch (e) {
    send(`${CH}:notice`, { text: `Lokal model xatosi: ${e.message}` });
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
    return { provider: config.provider, model: config.model, providers: list, sharedConfig: sharedConfigDir() };
  } catch (e) {
    return { error: e.message };
  }
}

async function aiSetModel(provider, model) {
  const { mod, config } = await loadSharedConfig();
  config.provider = provider || config.provider;
  config.model = model || config.model;
  await mod.saveConfig(sharedConfigDir(), config);
  return { provider: config.provider, model: config.model };
}

async function aiRun({ prompt, team = false, maxSteps } = {}) {
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
      aiTeam.on('event', (e) => send(`${CH}:ai-event`, e));
      const res = await aiTeam.run({ task: text });
      send(`${CH}:ai-event`, { type: 'done', content: res?.content ?? '' });
      return { ok: true, content: String(res?.content || '') };
    }
    const { AgentEngine } = await agentModule('engine.js');
    // Qadam chegarasi chaqiruvchi tomonidan qisqartirilishi mumkin (tuzatish halqasi shunday
    // qiladi): lokal model aylanib qolsa, 30 qadam behuda 15 daqiqa yeb qo'yardi.
    const steps = Math.min(Math.max(Number(maxSteps) || 30, 3), 40);
    aiEngine = new AgentEngine({ config, workspace, maxSteps: steps });
    aiEngine.on('event', (e) => send(`${CH}:ai-event`, e));
    const res = await aiEngine.run({ events: [], userText: `${prelude}\n\nVazifa: ${text}` });
    // Yakuniy matn tuzatish halqasiga ham kerak ("oldingi urinishda nima qilindi").
    return { ok: true, content: String((res && (res.content || res.text)) || '') };
  } catch (e) {
    send(`${CH}:ai-event`, { type: 'error', message: String(e.message || e) });
    return { error: String(e.message || e) };
  } finally {
    aiEngine = null;
    aiTeam = null;
    send(`${CH}:ai-event`, { type: 'run_finished' });
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
/**
 * IDE IPC handler'larini ro'yxatga oladi (idempotent).
 * @param {{ standalone?: boolean }} [opts] standalone — mustaqil dastur rejimi (hisobot uchun).
 */
export function registerIdeIpc(opts = {}) {
  standaloneMode = !!opts.standalone;
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle(`${CH}:pick-folder`, async () => {
    const res = await dialog.showOpenDialog(ideWin || undefined, { properties: ['openDirectory'], title: 'Papka tanlang' });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const info = await setWorkspace(res.filePaths[0]);
    return { ...info, recent: (await readState()).recent || [] };
  });

  ipcMain.handle(`${CH}:open-folder`, async (_e, { path: p }) => {
    const info = await setWorkspace(p);
    return { ...info, recent: (await readState()).recent || [] };
  });

  ipcMain.handle(`${CH}:init`, async () => {
    const state = await readState();
    if (state.lastWorkspace && await exists(state.lastWorkspace)) await setWorkspace(state.lastWorkspace, { persist: false });
    return { workspace: workspace ? { path: workspace, name: path.basename(workspace) } : null, recent: state.recent || [], tabs: state.tabs || [] };
  });

  ipcMain.handle(`${CH}:list-tree`, async (_e, { rel = '.', depth = 3 } = {}) => listTree(rel, Math.max(1, Math.min(8, Number(depth) || 3))));

  ipcMain.handle(`${CH}:read-file`, async (_e, { path: p, maxBytes } = {}) => {
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
      if (st.size > HARD_FILE_CEILING) {
        const openErr = await shell.openPath(t.abs);
        return { error: `fayl juda katta (${(st.size / 1048576).toFixed(0)} MB) — xotira himoyasi uchun tashqi ilovada ochildi`, opened: !openErr };
      }
      // maxBytes faqat chaqiruvchi ANIQ cheklamoqchi bo'lsa ishlatiladi (standart: butun fayl).
      const limit = Math.max(Number(maxBytes) || HARD_FILE_CEILING, 1000);
      const buf = await fsp.readFile(t.abs);
      const text = buf.subarray(0, limit).toString('utf8');
      return { text, size: st.size, truncated: buf.length > limit, big: st.size > BIG_FILE_NOTICE, path: t.rel };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle(`${CH}:write-file`, async (_e, { path: p, content } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida' };
    if (typeof content !== 'string') return { error: 'mazmun matn bo‘lishi kerak' };
    if (Buffer.byteLength(content, 'utf8') > HARD_FILE_CEILING) {
      return { error: `mazmun juda katta (${(Buffer.byteLength(content, 'utf8') / 1048576).toFixed(0)} MB) — 512 MB xotira chegarasi` };
    }
    try {
      const existed = await exists(t.abs);
      const oldSize = existed ? (await fsp.stat(t.abs).catch(() => ({ size: 0 }))).size : 0;
      if (existed && oldSize <= BACKUP_MAX) {
        const bak = `${t.abs}.bak`;
        if (!(await exists(bak))) await fsp.copyFile(t.abs, bak);
      } else {
        await fsp.mkdir(path.dirname(t.abs), { recursive: true });
      }
      await fsp.writeFile(t.abs, content, 'utf8');
      const st = await fsp.stat(t.abs);
      return { ok: true, path: t.rel, size: st.size, big: st.size > BIG_FILE_NOTICE };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle(`${CH}:create`, async (_e, { path: p, dir = false } = {}) => {
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

  ipcMain.handle(`${CH}:rename`, async (_e, { from, to } = {}) => {
    const a = safePath(from);
    const b = safePath(to);
    if (!a || !b) return { error: 'yo‘l tashqarida' };
    try {
      if (await exists(b.abs)) return { error: 'maqsad mavjud' };
      await fsp.rename(a.abs, b.abs);
      return { ok: true, path: b.rel };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle(`${CH}:delete`, async (_e, { path: p } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida' };
    try {
      // O'chirmasdan savatga (trash) yuboramiz — qaytarib olish mumkin.
      await shell.trashItem(t.abs);
      return { ok: true, path: t.rel };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle(`${CH}:search`, async (_e, { query, caseSensitive } = {}) => searchWorkspace(query, { caseSensitive }));

  ipcMain.handle(`${CH}:open-external`, async (_e, { path: p } = {}) => {
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

  ipcMain.handle(`${CH}:diagnostics`, async (_e, { path: p } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida', items: [] };
    const ext = path.extname(t.abs).toLowerCase();
    const res = diagnosticsSync(t.abs, ext);
    // Diagnostika AI tuzatish halqasiga ham beriladi (log konteksti).
    rememberDiagnostics(t.rel, res.items || []);
    return res;
  });

  ipcMain.handle(`${CH}:run-command`, async (_e, { command, cwd } = {}) => {
    if (!workspace) return { error: 'papka tanlanmagan' };
    const resolved = resolveShellCommand(command);
    if (resolved.error) return { error: resolved.error };
    if (resolved.cd) return { cd: resolved.cd, cwd: termCwd };
    return runCommand(resolved.command, cwd);
  });

  // Faylni ishga tushirish: endi CAPTURED yurish (chiqish oqim bilan keladi, oxiri va
  // chiqish kodi tarixga yoziladi — shu asosda AI tuzatish halqasi ishlaydi).
  ipcMain.handle(`${CH}:run-file`, async (_e, { path: p } = {}) => {
    const t = safePath(p);
    if (!t) return { error: 'yo‘l tashqarida' };
    const run = await runCaptured({ rel: t.rel, label: 'run' });
    return run.error ? { error: run.error } : { ok: true, id: 'captured', command: run.command, code: run.code, seconds: run.seconds };
  });

  ipcMain.handle(`${CH}:kill-command`, async (_e, { id } = {}) => {
    const child = runningCommands.get(id);
    if (!child) return { error: 'buyruq topilmadi' };
    try { child.kill(); } catch {}
    return { ok: true };
  });

  ipcMain.handle(`${CH}:error-links`, async (_e, { text } = {}) => ({ links: parseErrorLinks(String(text || '')) }));

  ipcMain.handle(`${CH}:save-tabs`, async (_e, { tabs } = {}) => {
    await writeState({ tabs: Array.isArray(tabs) ? tabs.slice(0, 30) : [] });
    return { ok: true };
  });

  ipcMain.handle(`${CH}:ai-status`, aiStatus);
  ipcMain.handle(`${CH}:ai-set-model`, (_e, args) => aiSetModel(args?.provider, args?.model));
  ipcMain.handle(`${CH}:ai-run`, (_e, args) => aiRun(args || {}));
  ipcMain.handle(`${CH}:ai-stop`, () => aiStop());

  ipcMain.handle(`${CH}:sys-info`, () => ({
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
    cpus: os.cpus().length,
    ramMb: Math.round(os.totalmem() / 1024 ** 2),
    version: app.getVersion(),
    localModel: localServerInfo ? localServerInfo.model : null,
    localStarted: localServerStarted,
    embedded: !standaloneMode,
  }));

  /* -------------------------------------------------------------------------
     Ixtiyoriy qobiliyatlar — har biri o'z modulida. Har biri o'z ishini mustaqil
     bajaradi va yuklanmasa IDE qolgan imkoniyatlar bilan ishlashda davom etadi
     (masalan, PTY yo'q bo'lsa terminal oddiy rejimga tushadi).
     ------------------------------------------------------------------------- */
  registerPtyIpc({
    send,
    getWorkspace: () => workspace,
    // Terminal faqat ish papkasi ichida ochiladi (havola orqali chiqish ham bloklanadi).
    guardCwd: (p) => { const t = safePath(p, { allowRoot: true }); return t ? t.abs : null; },
  });
  registerLspIpc({ safePath, getWorkspace: () => workspace });
  registerDebugIpc({ safePath, getWorkspace: () => workspace, send });
  registerRunnerIpc({
    safePath,
    getWorkspace: () => workspace,
    send,
    aiRun: (args) => aiRun(args || {}),
    getDiagnostics: diagnosticsForFix,
    readState,
    writeState,
  });
}

/** Ish papkasi o'zgarganda PTY sessiyalarini yangilash kerakligini aytadi. */
export function currentWorkspace() {
  return workspace;
}
