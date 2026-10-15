// ide_lsp.js — haqiqiy TIL XIZMATI (semantik tahlil).
//
// Ilgari faqat sintaksis tekshiruvi bor edi (`node --check`, `python compile()`): u
// "qavs yopilmagan" ni topadi, lekin "yo'q funksiya chaqirilgan", "noto'g'ri tur",
// "ishlatilmagan o'zgaruvchi" ni topa olmaydi va F12 faqat so'z bo'yicha qidirardi.
//
// Endi TypeScript'ning o'z serveri (tsserver) ishlatiladi — bu VS Code ichida ishlaydigan
// aynan o'sha dvigatel:
//   • semantik diagnostika (JS/JSX/TS/TSX, checkJs bilan JS ham),
//   • F12 — HAQIQIY ta'rif (fayl:qator, o'zgaruvchi/funksiya qayerda e'lon qilingan),
//   • Shift+F12 — BARCHA havolalar (butun loyiha bo'yicha),
//   • hover — tur va imzo (`function salomlash(nom: string): string`).
//
// Muhim: server `ELECTRON_RUN_AS_NODE=1` bilan ILOVANING O'Z exe'si orqali yuritiladi —
// shuning uchun paketlangan nusxada ham ishlaydi (foydalanuvchida Node o'rnatilmagan
// bo'lsa ham). Python uchun kuch-quvvat zinapoyasi ishlatiladi:
//   pyright (tip xatolari, Pylance bilan bir dvigatel) → mypy (tip tekshiruvining
//   klassikasi) → pyflakes (yengil: aniqlanmagan nom/ishlatilmagan import) → hech narsa
//   (shunda eski sintaksis tekshiruvi qoladi). Uchtasi ham FOYDALANUVCHI o'rnatadigan
//   vositalar — topilmasa IDE ishdan to'xtamaydi, zinapoyadan pastga tushadi.
import { ipcMain } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';

const CH = 'yide';
const require = createRequire(import.meta.url);

const LANG_TS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);

let ctx = { safePath: () => null, getWorkspace: () => '' };
let server = null;
let serverRoot = '';
let seq = 0;
let outBuf = Buffer.alloc(0);
const pending = new Map();
let tsPath = null;
let tsError = null;
let pyflakesOk = null; // null = hali sinanmagan

/* --------------------------------------------------------------- tsserver joyi */
function resolveTsServer() {
  if (tsPath || tsError) return tsPath;
  const candidates = [];
  try {
    candidates.push(require.resolve('typescript/lib/tsserver.js'));
  } catch { /* eksport xaritasi to'sgan bo'lishi mumkin */ }
  try {
    // `require.resolve('typescript')` → lib/typescript.js
    candidates.push(path.join(path.dirname(require.resolve('typescript')), 'tsserver.js'));
  } catch { /* paket yo'q */ }
  for (const c of candidates) {
    try {
      if (c && require('node:fs').existsSync(c)) { tsPath = c; return tsPath; }
    } catch { /* davom */ }
  }
  tsError = 'typescript paketi topilmadi (npm install typescript@5)';
  return null;
}

/* ------------------------------------------------------------------- server */
function onStdout(chunk) {
  outBuf = Buffer.concat([outBuf, chunk]);
  for (;;) {
    const headerEnd = outBuf.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = outBuf.slice(0, headerEnd).toString('utf8');
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) { outBuf = outBuf.slice(headerEnd + 4); continue; }   // buzilgan ramka — tashlab yuboramiz
    const len = Number(m[1]);
    const bodyStart = headerEnd + 4;
    if (outBuf.length < bodyStart + len) break;                  // qolgani keyingi chunk'da
    const body = outBuf.slice(bodyStart, bodyStart + len).toString('utf8');
    outBuf = outBuf.slice(bodyStart + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    if (msg.type === 'response' && pending.has(msg.request_seq)) {
      const { resolve, timer } = pending.get(msg.request_seq);
      clearTimeout(timer);
      pending.delete(msg.request_seq);
      resolve(msg.success === false ? { __error: msg.message || 'tsserver xatosi' } : msg.body);
    }
  }
}

function stopServer() {
  if (server) { try { server.kill(); } catch { /* o'lgan */ } }
  server = null;
  serverRoot = '';
  outBuf = Buffer.alloc(0);
  for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ __error: 'server yopildi' }); }
  pending.clear();
}

function ensureServer(root) {
  const exe = resolveTsServer();
  if (!exe) return null;
  if (server && serverRoot === root && !server.killed) return server;
  stopServer();
  serverRoot = root;
  // Muhim: `ELECTRON_RUN_AS_NODE` — ilovaning o'z exe'si oddiy Node kabi ishlaydi.
  server = spawn(process.execPath, [exe, '--useInferredProjectPerProjectRoot', '--disableAutomaticTypingAcquisition'], {
    cwd: root || undefined,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  server.stdout.on('data', onStdout);
  server.stderr.on('data', () => { /* tsserver shovqini — kerak emas */ });
  server.on('exit', () => { server = null; serverRoot = ''; });
  // JS fayllar uchun "checkJs" — yo'q funksiya/noto'g'ri tur shu bilan topiladi.
  request('compilerOptionsForInferredProjects', {
    options: {
      allowJs: true, checkJs: true, jsx: 'react', allowNonTsExtensions: true,
      target: 'es2022', module: 'commonjs', moduleResolution: 'node',
      strict: false, noEmit: true,
    },
  }).catch(() => {});
  return server;
}

function request(command, args, timeoutMs = 8000) {
  if (!server) return Promise.resolve({ __error: 'til xizmati ishga tushmagan' });
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ __error: 'javob kutish vaqti tugadi' }); }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      // tsserver KIRISHNI satr-delsk JSON kutadi (chiqishi esa Content-Length ramkali).
      server.stdin.write(JSON.stringify({ seq: id, type: 'request', command, arguments: args }) + '\n');
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ __error: String(e.message || e) });
    }
  });
}

/* ------------------------------------------------------------------ yordamchi */
async function absOf(rel) {
  const t = ctx.safePath(rel);
  return t ? t.abs : null;
}

function tsRel(abs) {
  const root = path.resolve(ctx.getWorkspace() || '.');
  const r = path.relative(root, abs).replace(/\\/g, '/');
  return r.startsWith('..') ? abs.replace(/\\/g, '/') : r;
}

/** Fayl matnini serverga sinxronlaydi (buffer diskdagidan farq qilsa ham to'g'ri tahlil). */
async function syncFile(abs, text) {
  let content = text;
  if (typeof content !== 'string') content = await fsp.readFile(abs, 'utf8').catch(() => null);
  if (content == null) return false;
  await request('updateOpen', {
    openFiles: [{ file: abs, fileContent: content, projectRootPath: path.resolve(ctx.getWorkspace() || path.dirname(abs)) }],
    changedFiles: [], closedFiles: [],
  });
  return true;
}

function normDiag(d) {
  const start = d.startLocation || {};
  const end = d.endLocation || {};
  return {
    line: Number(start.line) || Number(d.start && d.start.line) || 1,
    col: Number(start.offset) || 1,
    endLine: Number(end.line) || undefined,
    endCol: Number(end.offset) || undefined,
    message: String(d.message || d.messageText || '').replace(/\s+/g, ' ').trim(),
    severity: d.category === 'warning' ? 'warning' : d.category === 'suggestion' ? 'info' : 'error',
    code: d.code || null,
    source: 'ts',
  };
}

function normLoc(loc) {
  if (!loc) return null;
  const file = String(loc.file || '');
  const start = loc.start || {};
  const end = loc.end || {};
  return {
    path: file ? (path.isAbsolute(file) ? tsRel(file) : file.replace(/\\/g, '/')) : null,
    absPath: path.isAbsolute(file) ? file : null,
    line: Number(start.line) || 1,
    col: Number(start.offset) || 1,
    endLine: Number(end.line) || undefined,
    endCol: Number(end.offset) || undefined,
    name: loc.name || '',
  };
}

/* -------------------------------------------------------------------- python */
// Nega bir necha vosita: pyright ham, mypy ham foydalanuvchi tomonida o'rnatilishi shart
// bo'lgan paketlar (`pip install pyright` / `mypy`). Shuning uchun tanlov BIR MARTA
// o'lchanadi va yodda saqlanadi — har tahrirda qayta sinab IDE sekinlashmasin.
// Muhim: modul formasi (`python -m pyright`) afzal — global `.cmd` shim kerak emas.
let pyEngine = null; // null = hali sinanmagan, false = birortasi ham yo'q

/** Eng kuchlidan boshlab zinapoya: kuchli vosita topilsa pastdagilari sinalmaydi. */
function pySteps() {
  const py = process.env.YANG_IDE_PYTHON || 'python';
  return [
    { engine: 'pyright', cmd: py, args: ['-m', 'pyright'], probe: ['--version'] },
    { engine: 'pyright', cmd: process.env.YANG_IDE_PYRIGHT || 'pyright', args: [], probe: ['--version'] },
    { engine: 'mypy', cmd: py, args: ['-m', 'mypy'], probe: ['--version'] },
    { engine: 'mypy', cmd: process.env.YANG_IDE_MYPY || 'mypy', args: [], probe: ['--version'] },
    // pyflakes'da `--version` bo'lmasligi mumkin — import bilan sinaymiz.
    { engine: 'pyflakes', cmd: py, args: ['-m', 'pyflakes'], probe: ['-c', 'import pyflakes'] },
  ];
}

function pyRun(cmd, args, timeoutMs, opts = {}) {
  try {
    return spawnSync(cmd, args, {
      encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      // Ish papkasi — faylning o'zi: mypy/pyright loyiha konfiguratsiyasini (mypy.ini,
      // pyrightconfig.json) o'sha yerdan qidiradi va ilovaning ish papkasini iflos qilmaydi.
      cwd: opts.cwd,
    });
  } catch { return null; }
}

/**
 * mypy keshi foydalanuvchi loyihasida ham, ilova papkasida ham yaratilmasin.
 * Paketlangan nusxada o'rnatish papkasi faqat o'qish uchun bo'ladi (Program Files),
 * shuning uchun kesh tizim vaqt papkasiga yoziladi.
 */
const pyCacheDir = () => path.join(os.tmpdir(), 'yang-ide-mypy-cache');

/** Vosita ko'tariladimi? Chiqishi bo'lsa — ha; «modul topilmadi» bo'lsa — yo'q. */
function pyProbe(cmd, args) {
  const r = pyRun(cmd, args, 10000);
  if (!r || r.error) return false;
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (!out) return false;
  // Windows'dagi "is not recognized", Python'ning "No module named" — ikkisi ham yo'q degani.
  if (/no module named|not recognized|not found|cannot find/i.test(out)) return false;
  return true;
}

function detectPyEngine() {
  if (pyEngine !== null) return pyEngine;
  pyEngine = false; // topilmasa qayta urinmaymiz (foydalanuvchi keyin o'rnatsa — ilova qayta ochiladi)
  for (const step of pySteps()) {
    if (pyProbe(step.cmd, [...step.args, ...step.probe])) { pyEngine = step; return pyEngine; }
  }
  return pyEngine;
}

/** pyright `--outputjson` — 0-asosli qator/ustun; bizning shakl 1-asosli. */
function pyrightLint(step, abs) {
  const r = pyRun(step.cmd, [...step.args, '--outputjson', abs], 20000, { cwd: path.dirname(abs) });
  if (!r) return null;
  const out = `${r.stdout || ''}`;
  const at = out.indexOf('{');
  if (at < 0) return null;
  let data = null;
  try { data = JSON.parse(out.slice(at)); } catch { return null; }
  if (!data || !Array.isArray(data.generalDiagnostics)) return null;
  const want = path.resolve(abs).toLowerCase();
  const items = [];
  for (const d of data.generalDiagnostics) {
    // Faqat shu fayl: import qilingan modullarning xatolari foydalanuvchini chalg'itmasin.
    if (String(d.file || '') && path.resolve(String(d.file)).toLowerCase() !== want) continue;
    const start = (d.range && d.range.start) || {};
    const msg = String(d.message || '').replace(/\s+/g, ' ').trim();
    items.push({
      line: (Number(start.line) || 0) + 1,
      col: (Number(start.character) || 0) + 1,
      message: d.rule ? `${msg} (${d.rule})` : msg,
      severity: d.severity === 'warning' ? 'warning' : d.severity === 'information' ? 'info' : 'error',
      source: 'pyright',
    });
  }
  return items;
}

/** mypy matn chiqishi: `fayl.py:3:5: error: nom aniqlanmagan` (ustun ixtiyoriy). */
function mypyLint(step, abs) {
  const r = pyRun(
    step.cmd,
    [...step.args, '--hide-error-context', '--no-color-output', '--no-error-summary', '--cache-dir', pyCacheDir(), abs],
    20000,
    { cwd: path.dirname(abs) },
  );
  if (!r) return null;
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // Argumentlar eski mypy'da tanilmasa — sintaksis tekshiruviga qaytamiz (yolg'on xato ko'rsatmaymiz).
  if (/usage: mypy|unrecognized arguments/i.test(out) && !/:\d+:/.test(out)) return null;
  const want = path.resolve(abs).toLowerCase();
  const items = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(.+?):(\d+):(?:(\d+):)?\s*(error|warning):\s*(.*)$/);
    if (!m) continue;
    // mypy nomni fayl argumentiga qarab NISBIY chiqarishi mumkin (biz uni o'z papkasidan
    // `cwd` bilan yuritamiz), shu sabab yo'lni ikki nuqtadan ham hisoblaymiz.
    const rel = m[1].trim();
    const cand = [path.resolve(rel), path.resolve(path.dirname(abs), rel)].map((s) => s.toLowerCase());
    if (!cand.includes(want)) continue;
    items.push({
      line: Number(m[2]) || 1,
      col: Number(m[3]) || 1,
      message: m[5].replace(/\s+/g, ' ').trim(),
      severity: m[4] === 'warning' ? 'warning' : 'error',
      source: 'mypy',
    });
  }
  return items;
}

function pyflakesLint(abs) {
  const r = pyRun(process.env.YANG_IDE_PYTHON || 'python', ['-m', 'pyflakes', abs], 15000);
  if (!r) return null;
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const items = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(.+?):(\d+):(\d+)?\s*(.*)$/);
    if (!m) continue;
    items.push({ line: Number(m[2]) || 1, col: Number(m[3]) || 1, message: m[4].trim(), severity: 'error', source: 'pyflakes' });
  }
  return items;
}

/** pyflakes alohida so'raladi (holat qatorida ko'rsatiladi) — natija yodda saqlanadi. */
function pyflakesAvailable() {
  if (pyflakesOk !== null) return pyflakesOk;
  try {
    const r = spawnSync(process.env.YANG_IDE_PYTHON || 'python', ['-c', 'import pyflakes'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    pyflakesOk = r.status === 0;
  } catch { pyflakesOk = false; }
  return pyflakesOk;
}

/**
 * Python faylini semantik tekshiradi — eng yaxshi mavjud vosita bilan.
 * @returns {{items: Array<{line:number,col:number,message:string,severity:string,source:string}>, engine: string} | null}
 *          null — birorta vosita yo'q yoki u yiqildi (chaqiruvchi sintaksis rejimiga tushadi).
 */
function pythonLint(abs) {
  const step = detectPyEngine();
  if (!step) return null;
  const items = step.engine === 'pyright' ? pyrightLint(step, abs)
    : step.engine === 'mypy' ? mypyLint(step, abs)
      : pyflakesLint(abs);
  if (!items) return null;
  return { items, engine: step.engine };
}

/* ---------------------------------------------------------------------- IPC */
export function disposeLsp() {
  stopServer();
}

/**
 * Til xizmati IPC'larini ro'yxatga oladi (idempotent).
 * @param {{ safePath: (rel: string) => {abs: string, rel: string} | null, getWorkspace: () => string }} c
 */
export function registerLspIpc(c) {
  ctx = { ...ctx, ...c };

  ipcMain.handle(`${CH}:lsp-status`, () => {
    const exe = resolveTsServer();
    return {
      available: !!exe,
      reason: exe ? null : tsError,
      server: exe ? path.basename(path.dirname(path.dirname(exe))) : null,
      python: { pyflakes: pyflakesAvailable(), engine: (detectPyEngine() || {}).engine || null },
    };
  });

  /** Semantik diagnostika. `text` berilsa — hali saqlanmagan buffer tahlil qilinadi. */
  ipcMain.handle(`${CH}:lsp-diagnostics`, async (_e, { path: p, text } = {}) => {
    const abs = await absOf(p);
    if (!abs) return { error: 'yo‘l tashqarida', items: [] };
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.py') {
      const py = pythonLint(abs);
      if (py) return { items: py.items, engine: py.engine };
      return { items: [], engine: null, note: 'Python uchun semantik tekshiruv yo‘q (pyright/mypy/pyflakes o‘rnatilmagan) — sintaksis tekshiruvi ishlaydi' };
    }
    if (!LANG_TS.has(ext)) return { items: [], engine: null };
    const root = path.resolve(ctx.getWorkspace() || path.dirname(abs));
    if (!ensureServer(root)) return { error: tsError, items: [] };
    if (!(await syncFile(abs, text))) return { error: 'fayl o‘qilmadi', items: [] };
    const [syn, sem] = await Promise.all([
      request('syntacticDiagnosticsSync', { file: abs, includeLinePosition: true }),
      request('semanticDiagnosticsSync', { file: abs, includeLinePosition: true }),
    ]);
    const items = [];
    for (const part of [syn, sem]) {
      if (Array.isArray(part)) items.push(...part.map(normDiag));
    }
    // Bir xil xato ikki marta kelmasin (sintaktik + semantik).
    const seen = new Set();
    const unique = items.filter((d) => {
      const k = `${d.line}:${d.col}:${d.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { items: unique, engine: 'tsserver' };
  });

  ipcMain.handle(`${CH}:lsp-definition`, async (_e, { path: p, line, col, text } = {}) => {
    const abs = await absOf(p);
    if (!abs) return { error: 'yo‘l tashqarida', items: [] };
    const root = path.resolve(ctx.getWorkspace() || path.dirname(abs));
    if (!ensureServer(root)) return { error: tsError, items: [] };
    await syncFile(abs, text);
    const r = await request('definitionAndBoundSpan', { file: abs, line: Number(line) || 1, offset: Number(col) || 1 });
    if (!r || r.__error) return { error: r && r.__error, items: [] };
    const defs = Array.isArray(r.definitions) ? r.definitions : [];
    return { items: defs.map(normLoc).filter(Boolean), engine: 'tsserver' };
  });

  ipcMain.handle(`${CH}:lsp-references`, async (_e, { path: p, line, col, text } = {}) => {
    const abs = await absOf(p);
    if (!abs) return { error: 'yo‘l tashqarida', items: [] };
    const root = path.resolve(ctx.getWorkspace() || path.dirname(abs));
    if (!ensureServer(root)) return { error: tsError, items: [] };
    await syncFile(abs, text);
    const r = await request('references', { file: abs, line: Number(line) || 1, offset: Number(col) || 1 });
    if (!r || r.__error) return { error: r && r.__error, items: [] };
    const refs = Array.isArray(r.refs) ? r.refs : [];
    return { items: refs.map(normLoc).filter(Boolean), engine: 'tsserver' };
  });

  ipcMain.handle(`${CH}:lsp-hover`, async (_e, { path: p, line, col, text } = {}) => {
    const abs = await absOf(p);
    if (!abs) return { error: 'yo‘l tashqarida' };
    const root = path.resolve(ctx.getWorkspace() || path.dirname(abs));
    if (!ensureServer(root)) return { error: tsError };
    await syncFile(abs, text);
    const r = await request('quickinfo', { file: abs, line: Number(line) || 1, offset: Number(col) || 1 });
    if (!r || r.__error || !r.displayString) return { text: '' };
    const doc = String(r.documentation || '').trim();
    return { text: r.displayString + (doc ? `\n\n${doc}` : ''), engine: 'tsserver' };
  });
}
