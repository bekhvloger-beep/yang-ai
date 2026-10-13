// ide_debug.js — QADAMLAB DEBUGGER (haqiqiy nuqtalar bilan).
//
// Ilgari faqat "debug-lite" bor edi: xato matnidan `fayl:qator` havolasini ajratib, o'sha
// qatorga olib borardi — lekin to'xtab, o'zgaruvchilarni ko'rish imkoni yo'q edi.
//
// Endi fayl Node'ning o'z inspector'i bilan ishga tushiriladi (`--inspect-brk`) va biz
// Chrome DevTools Protocol (CDP) orqali gaplashamiz — VS Code ichida ishlaydigan aynan
// o'sha mexanizm:
//   • qator raqami ustida bosib nuqta (breakpoint) qo'yish,
//   • to'xtaganda: chaqiruvlar (call stack), o'zgaruvchilar (scope), joriy qator,
//   • davom etish / qadam / ichiga kirish / tashqariga chiqish / to'xtatish,
//   • konsol ifodasini baholash (top frame kontekstida).
//
// Ishga tushirish `ELECTRON_RUN_AS_NODE=1` bilan ilovaning O'Z exe'si orqali — ya'ni
// foydalanuvchida Node o'rnatilmagan bo'lsa ham paketlangan ilovada ishlaydi.
//
// PYTHON ham xuddi shu panelda ishlaydi: `.py` fayl `debugpy` orqali DAP (Debug Adapter
// Protocol) bilan yuritiladi — ya'ni bir xil tugmalar, bir xil panel, bir xil hodisalar.
// Nega alohida protokol: Python'da Node inspector yo'q; debugpy esa VS Code ishlatadigan
// aynan o'sha dvigatel (nuqtalar, qadamlar, stack, o'zgaruvchilar, `evaluate`).
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CH = 'yide';
// Python interpretatori: `ide_runner.js` bilan bir xil o'zgaruvchi — bitta manba.
const PY_BIN = process.env.YANG_IDE_PYTHON || 'python';

let ctx = { safePath: () => null, getWorkspace: () => '', send: () => {} };
let session = null;   // { child, ws, id, port, file, scripts, breakpoints, seq, pending }
let wsModule = null;
let wsError = null;

function loadWs() {
  if (wsModule || wsError) return wsModule;
  try {
    // `ws` — Electron main jarayonida global WebSocket YO'Q (Node 20), shu sabab paket kerak.
    wsModule = require('ws');
  } catch (e) {
    wsError = String(e.message || e).split('\n')[0];
  }
  return wsModule;
}

function freePort() {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.on('error', () => res(0));
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => res(p));
    });
  });
}

const relOf = (abs) => {
  const root = path.resolve(ctx.getWorkspace() || '.');
  const r = path.relative(root, abs).replace(/\\/g, '/');
  return r.startsWith('..') ? abs.replace(/\\/g, '/') : r;
};

/** CDP bergan `file:///C:/...` manzilini haqiqiy yo'lga aylantiradi.
 *  Ilgari buni sodda `replace(/^file:\/\//,'')` qilardi va Windows'da "D:/C:/..."
 *  kabi buzuq yo'l chiqardi (o'lchandi) — endi bosh slash olib tashlanadi. */
function fileUrlToPath(url) {
  let p = String(url || '').replace(/^file:\/\//, '');
  try { p = decodeURIComponent(p); } catch { /* buzilgan foiz kodlash */ }
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p.replace(/\//g, path.sep);
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------- CDP */
function cdpSend(method, params = {}, timeoutMs = 10000) {
  if (!session || !session.ws || session.ws.readyState !== 1) return Promise.resolve({ __error: 'debugger ulanmagan' });
  const id = ++session.seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { session && session.pending.delete(id); resolve({ __error: `${method} javob bermadi` }); }, timeoutMs);
    session.pending.set(id, { resolve, timer });
    try {
      session.ws.send(JSON.stringify({ id, method, params }));
    } catch (e) {
      clearTimeout(timer);
      session.pending.delete(id);
      resolve({ __error: String(e.message || e) });
    }
  });
}

async function scopeVars(frame) {
  const out = [];
  for (const scope of (frame.scopeChain || []).slice(0, 4)) {
    if (!scope.object || !scope.object.objectId) continue;
    const r = await cdpSend('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true, generatePreview: true }, 5000);
    if (!r || r.__error || !Array.isArray(r.result)) continue;
    const vars = [];
    for (const prop of r.result.slice(0, 60)) {
      if (prop.name === 'this' && scope.type !== 'local') continue;
      const v = prop.value || {};
      let text = v.value !== undefined ? String(v.value) : (v.description || v.type || '');
      if (v.preview && Array.isArray(v.preview.properties)) {
        text = `${v.preview.description || v.className || 'obyekt'} { ${v.preview.properties.map((p) => `${p.name}: ${p.value}`).join(', ').slice(0, 160)} }`;
      } else if (v.objectId && !text) {
        text = v.className || 'obyekt';
      }
      vars.push({ name: prop.name, type: v.type || 'unknown', value: String(text).slice(0, 300) });
    }
    if (vars.length) out.push({ type: scope.type, name: scope.name || scope.type, vars });
  }
  return out;
}

async function onPaused(params) {
  // `--inspect-brk` dasturni BIRINCHI qatorda to'xtatadi. Foydalanuvchi nuqta qo'ygan
  // bo'lsa o'sha kirish to'xtashini avtomatik o'tkazib yuboramiz — aks holda u har doim
  // 1-qatorda to'xtab qolardi va nuqtaga yetib bormasdi (o'lchandi).
  if (session && session.skipEntry && (params.hitBreakpoints || []).length === 0) {
    session.skipEntry = false;
    cdpSend('Debugger.resume').catch(() => {});
    return;
  }
  const frame = (params.callFrames || [])[0] || {};
  const loc = frame.location || {};
  const url = (session && session.scripts.get(loc.scriptId)) || '';
  const file = url ? fileUrlToPath(url) : '';
  const rel = file ? relOf(file) : '';
  const scopes = await scopeVars(frame);
  const frames = (params.callFrames || []).slice(0, 30).map((f) => {
    const u = (session && session.scripts.get(f.location.scriptId)) || '';
    return {
      name: f.functionName || '(anonim)',
      path: u ? relOf(fileUrlToPath(u)) : '',
      line: (f.location.lineNumber || 0) + 1,
      col: (f.location.columnNumber || 0) + 1,
      callFrameId: f.callFrameId,
    };
  });
  ctx.send(`${CH}:debug-paused`, {
    reason: params.reason || 'other',
    path: rel,
    line: (loc.lineNumber || 0) + 1,
    col: (loc.columnNumber || 0) + 1,
    frames,
    scopes,
    hitBreakpoints: params.hitBreakpoints || [],
  });
  if (session) session.paused = true;
}

async function connect(port, timeoutMs = 15000) {
  const wsLib = loadWs();
  if (!wsLib) return { error: `ws paketi topilmadi (${wsError})` };
  const started = Date.now();
  let target = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(900) })).json();
      target = (list || []).find((t) => t.webSocketDebuggerUrl);
      if (target) break;
    } catch { /* inspector hali ko'tarilmagan */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!target) return { error: 'debugger porti javob bermadi' };
  const ws = new wsLib(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  const ready = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    ws.on('open', () => { clearTimeout(t); resolve(true); });
    ws.on('error', () => { clearTimeout(t); resolve(false); });
  });
  if (!ready) { try { ws.close(); } catch { /* */ } return { error: 'debugger websocket ulanmadi' }; }
  session.ws = ws;
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.id && session && session.pending.has(msg.id)) {
      const { resolve, timer } = session.pending.get(msg.id);
      clearTimeout(timer);
      session.pending.delete(msg.id);
      resolve(msg.error ? { __error: msg.error.message } : (msg.result || {}));
      return;
    }
    if (msg.method === 'Debugger.scriptParsed') {
      session.scripts.set(msg.params.scriptId, msg.params.url || '');
      return;
    }
    if (msg.method === 'Debugger.paused') { onPaused(msg.params).catch(() => {}); return; }
    if (msg.method === 'Debugger.resumed') {
      if (session) session.paused = false;
      ctx.send(`${CH}:debug-resumed`, {});
    }
  });
  await cdpSend('Runtime.enable');
  await cdpSend('Debugger.enable');
  return { ok: true };
}

/* ------------------------------------------------------------------- DAP */
// Python uchun ramka LSP bilan bir xil: `Content-Length: N\r\n\r\n{json}`.
const DAP_INIT = {
  clientID: 'yang-ide',
  clientName: 'YANG IDE',
  adapterID: 'debugpy',
  pathFormat: 'path',
  linesStartAt1: true,
  columnsStartAt1: true,
  supportsRunInTerminalRequest: false,
};

function dapFrame(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

/** Oqimdan DAP xabarlarini ajratib beradi (bir chaqiruvda bir nechta xabar kelishi mumkin). */
function dapReader(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const head = buf.subarray(0, sep).toString('utf8');
      const m = /content-length:\s*(\d+)/i.exec(head);
      if (!m) { buf = buf.subarray(sep + 4); continue; }   // sarlavhasiz shovqin (debugpy banneri)
      const len = Number(m[1]);
      if (buf.length < sep + 4 + len) return;               // xabar hali to'liq kelmagan
      const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
      buf = buf.subarray(sep + 4 + len);
      try { onMessage(JSON.parse(body)); } catch { /* buzilgan JSON — e'tiborsiz */ }
    }
  };
}

function dapSend(command, args = {}, timeoutMs = 15000) {
  if (!session || !session.dap || !session.dap.write) return Promise.resolve({ __error: 'debugger ulanmagan' });
  const id = ++session.seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { if (session) session.pending.delete(id); resolve({ __error: `${command} javob bermadi` }); }, timeoutMs);
    session.pending.set(id, { resolve, timer });
    try {
      session.dap.write(dapFrame({ seq: id, type: 'request', command, arguments: args }));
    } catch (e) {
      clearTimeout(timer);
      session.pending.delete(id);
      resolve({ __error: String(e.message || e) });
    }
  });
}

/** Javobsiz DAP so'rovi. Kerak, chunki debugpy ba'zi so'rovlarga (masalan `launch`) javobni
 *  faqat `configurationDone` dan KEYIN yuboradi — uni `await` qilish halqani abadiy osib
 *  qo'yardi (o'lchandi: sinov 150 s jimgina qotib qoldi). */
function dapNotify(command, args = {}) {
  if (!session || !session.dap || !session.dap.write) return;
  const id = ++session.seq;
  try { session.dap.write(dapFrame({ seq: id, type: 'request', command, arguments: args })); } catch { /* */ }
}

const isPySession = () => !!(session && session.kind === 'python');
const pyThreadId = () => (session && session.threadId) || 1;
const dapResult = (r) => (r.__error ? { error: r.__error } : { ok: true });

function dapOnMessage(msg) {
  if (!session || !msg) return;
  // DAP'da javob `request_seq` bilan bog'lanadi (CDP'da `id` bilan bo'lgani kabi).
  if (msg.type === 'response' && session.pending.has(msg.request_seq)) {
    const { resolve, timer } = session.pending.get(msg.request_seq);
    clearTimeout(timer);
    session.pending.delete(msg.request_seq);
    resolve(msg.success === false ? { __error: msg.message || 'DAP xatosi' } : (msg.body || {}));
    return;
  }
  if (msg.type !== 'event') return;
  if (msg.event === 'initialized') { onPythonInitialized().catch(() => {}); return; }
  if (msg.event === 'stopped') { onPythonStopped(msg.body || {}).catch(() => {}); return; }
  if (msg.event === 'continued') {
    if (session) session.paused = false;
    ctx.send(`${CH}:debug-resumed`, {});
    return;
  }
  if (msg.event === 'output') {
    const text = String((msg.body && msg.body.output) || '');
    if (text) ctx.send(`${CH}:debug-output`, { chunk: text });
    return;
  }
  if (msg.event === 'terminated' || msg.event === 'exited') {
    const code = msg.body && msg.body.exitCode != null ? msg.body.exitCode : null;
    if (session) session.paused = false;
    ctx.send(`${CH}:debug-exit`, { code });
  }
}

/** `initialized` hodisasi — adapter tayyor: nuqtalarni qo'yib, dasturni qo'yib yuboramiz.
 *  Bu DAP talab qilgan TARTIB (launch javobidan keyin, configurationDone'dan oldin). */
async function onPythonInitialized() {
  if (!isPySession()) return;
  const want = session.pendingBreakpoints || [];
  if (want.length) await pythonSetBreakpoints(want);
  await dapSend('configurationDone', {});
  // `stopOnEntry` debugpy'da har doim ham mavjud emas — so'ralgan bo'lsa urinib ko'ramiz,
  // ishlamasa jim o'tamiz (foydalanuvchi baribir nuqtaga qadar davom eta oladi).
  if (session && session.stopOnEntryRequested) dapNotify('pause', { threadId: 1 });
  // `start()` shu yergacha kutadi: nuqtalar qo'yildi, dastur yuborildi.
  if (session && session.readyResolve) { const r = session.readyResolve; session.readyResolve = null; r('ready'); }
}

async function pythonSetBreakpoints(list = []) {
  if (!isPySession()) return { error: 'sessiya yo‘q' };
  // Bitta fayl uchun bitta `setBreakpoints` so'rovi — DAP shuni kutadi (qatorlar massivi).
  const byFile = new Map();
  for (const bp of list.slice(0, 200)) {
    const t = ctx.safePath(bp.path);
    if (!t) continue;
    const line = Math.max(1, Number(bp.line) || 1);
    const arr = byFile.get(t.abs) || [];
    arr.push({ line, rel: relOf(t.abs) });
    byFile.set(t.abs, arr);
  }
  const result = [];
  for (const [file, items] of byFile) {
    const r = await dapSend('setBreakpoints', { source: { path: file }, breakpoints: items.map((i) => ({ line: i.line })) });
    const verified = Array.isArray(r.breakpoints) ? r.breakpoints : [];
    items.forEach((i, idx) => {
      const v = verified[idx] || {};
      result.push({ path: i.rel, line: i.line, id: v.id, resolved: v.verified !== false });
    });
  }
  session.breakpoints = result;
  session.pendingBreakpoints = result.map((b) => ({ path: b.path, line: b.line }));
  return { breakpoints: result };
}

async function pythonScopes(frame) {
  if (!frame) return [];
  const r = await dapSend('scopes', { frameId: frame.id });
  const out = [];
  for (const sc of (r.scopes || [])) {
    // `globals` yuzlab o'zgaruvchi beradi va panelni to'ldirib tashlaydi — o'tkazib yuboramiz.
    if (sc.expensive || /global/i.test(sc.name || '')) continue;
    const v = await dapSend('variables', { variablesReference: sc.variablesReference });
    const vars = (v.variables || []).slice(0, 60).map((x) => ({
      name: x.name,
      type: x.type || 'unknown',
      value: String(x.value == null ? '' : x.value).slice(0, 300),
    }));
    if (vars.length) out.push({ type: String(sc.name || '').toLowerCase(), name: sc.name || 'qamrov', vars });
  }
  return out;
}

async function onPythonStopped(body) {
  if (!isPySession()) return;
  const reason = body.reason || 'other';
  if (reason === 'entry' && session.skipEntry) {
    session.skipEntry = false;
    await dapSend('continue', { threadId: body.threadId || 1 });
    return;
  }
  const threads = await dapSend('threads', {});
  const threadId = body.threadId || ((threads.threads || [])[0] || {}).id || 1;
  session.threadId = threadId;
  const st = await dapSend('stackTrace', { threadId, startFrame: 0, levels: 30 });
  const raw = st.stackFrames || [];
  const frames = raw.slice(0, 30).map((f) => ({
    name: f.name || '(anonim)',
    path: f.source && f.source.path ? relOf(f.source.path) : '',
    line: f.line || 1,
    col: f.column || 1,
    callFrameId: String(f.id),
  }));
  const top = raw[0];
  session.topFrameId = top ? top.id : null;
  const scopes = await pythonScopes(top);
  const first = frames[0] || { path: '', line: 0, col: 0 };
  session.paused = true;
  ctx.send(`${CH}:debug-paused`, {
    reason,
    path: first.path,
    line: first.line,
    col: first.col,
    frames,
    scopes,
    hitBreakpoints: [],
    language: 'python',
  });
}

function newPythonSession(child, file, breakpoints, stopOnEntry) {
  return {
    kind: 'python', child, sock: null, ws: null, port: null, file, scripts: new Map(),
    breakpoints: [], pendingBreakpoints: (breakpoints || []).slice(0, 200),
    seq: 0, pending: new Map(), paused: false, skipEntry: !stopOnEntry,
    stopOnEntryRequested: !!stopOnEntry, threadId: null, topFrameId: null, dap: null,
  };
}

/** Python jarayonining hodisalari: stdout — DAP, stderr — foydalanuvchi uchun. */
function wirePythonChild(child) {
  const read = dapReader((m) => dapOnMessage(m));
  child.stdout.on('data', (b) => read(b));
  child.stderr.on('data', (b) => {
    const s = String(b);
    // debugpy bannerlari va DAP ramkalari foydalanuvchiga ko'rinmasin.
    if (/^Content-Length:/i.test(s) || /Debug adapter|debugpy\.adapter|waiting for client/i.test(s)) return;
    ctx.send(`${CH}:debug-output`, { chunk: s });
  });
  child.on('error', (e) => {
    ctx.send(`${CH}:debug-output`, { chunk: `[python debugger: ${e.message}]\n` });
    // Python yoki debugpy topilmasa `initialize` 20 s kutib qolmasin — darhol xato beramiz
    // va zaxira yo'l (server rejimi) shu zahoti sinaladi.
    if (session) {
      for (const { resolve, timer } of session.pending.values()) {
        clearTimeout(timer);
        resolve({ __error: `python debugger: ${e.message}` });
      }
      session.pending.clear();
    }
  });
  child.on('exit', (code) => {
    if (session) {
      // Kutayotgan so'rovlar 15 s kutib qolmasin — darhol xato bilan bo'shatamiz.
      for (const { resolve, timer } of session.pending.values()) {
        clearTimeout(timer);
        resolve({ __error: 'debugger to‘xtadi' });
      }
      session.pending.clear();
      try { session.sock && session.sock.destroy(); } catch { /* */ }
      session = null;
    }
    ctx.send(`${CH}:debug-exit`, { code });
  });
}

function connectTcp(port, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port });
      let done = false;
      sock.once('connect', () => { if (!done) { done = true; resolve(sock); } });
      sock.once('error', () => {
        if (done) return;
        done = true;
        try { sock.destroy(); } catch { /* */ }
        if (Date.now() > deadline) return resolve(null);
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

/** 1-yo'l (asosiy): `python -m debugpy.adapter` + `launch`.
 *  Nega birinchi shu: adapter dasturni O'ZI ko'taradi — qaysi interpretator va qaysi ish
 *  papkasi ishlatilishini aniq bilamiz, port ham kerak emas. */
async function startPythonViaAdapter(t, breakpoints, stopOnEntry, dir, env) {
  const child = spawn(PY_BIN, ['-m', 'debugpy.adapter'], { cwd: dir, windowsHide: true, env });
  session = newPythonSession(child, t.abs, breakpoints, stopOnEntry);
  session.dap = { mode: 'adapter', write: (s) => { try { child.stdin.write(s); } catch { /* */ } } };
  wirePythonChild(child);
  const init = await dapSend('initialize', DAP_INIT, 15000);
  if (init.__error) { await stop({ silent: true }); return { error: init.__error }; }
  // `launch` javobini KUTMAYMIZ (debugpy uni faqat configurationDone'dan keyin yuboradi).
  // O'rniga `initialized` hodisasini kutamiz: o'shanda nuqtalar qo'yiladi va dastur yuboriladi.
  session.ready = new Promise((r) => { session.readyResolve = r; });
  dapNotify('launch', { type: 'python', request: 'launch', program: t.abs, cwd: dir, justMyCode: false, console: 'internalConsole', redirectOutput: true });
  const ready = await Promise.race([
    session.ready,
    new Promise((r) => setTimeout(() => r('timeout'), 15000)),
  ]);
  if (ready === 'timeout') { await stop({ silent: true }); return { error: 'debugpy tayyor bo‘lmadi (initialized hodisasi kelmadi)' }; }
  return { ok: true, port: null, file: relOf(t.abs), language: 'python' };
}

/** 2-yo'l (zaxira): `debugpy --listen … --wait-for-client` + `attach`.
 *  Adapter ishlamay qolsa (masalan `debugpy.adapter` moduli yo'q bo'lsa) shu yo'l qoladi. */
async function startPythonViaServer(t, breakpoints, stopOnEntry, dir, env) {
  const port = await freePort();
  if (!port) return { error: 'bo‘sh port topilmadi' };
  const child = spawn(PY_BIN, ['-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client', t.abs], {
    cwd: dir, windowsHide: true, env,
  });
  session = newPythonSession(child, t.abs, breakpoints, stopOnEntry);
  session.port = port;
  wirePythonChild(child);
  const sock = await connectTcp(port, 20000);
  if (!sock) { await stop({ silent: true }); return { error: 'debugpy porti javob bermadi' }; }
  session.sock = sock;
  session.dap = { mode: 'server', write: (s) => { try { sock.write(s); } catch { /* */ } } };
  const read = dapReader((m) => dapOnMessage(m));
  sock.on('data', (b) => read(b));
  const init = await dapSend('initialize', DAP_INIT, 15000);
  if (init.__error) { await stop({ silent: true }); return { error: init.__error }; }
  const at = await dapSend('attach', { type: 'python', request: 'attach', justMyCode: false }, 15000);
  if (at.__error) { await stop({ silent: true }); return { error: at.__error }; }
  // Server rejimida debugpy `initialized` hodisasini YUBORMAYDI (o'lchandi) — shu sababli
  // nuqtalarni qo'yish va dasturni yuborish qadamini o'zimiz chaqiramiz, aks holda dastur
  // `--wait-for-client` da abadiy kutib qolardi.
  await onPythonInitialized();
  return { ok: true, port, file: relOf(t.abs), language: 'python' };
}

async function startPython(t, breakpoints, stopOnEntry) {
  const dir = path.dirname(t.abs);
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', FORCE_COLOR: '0' };
  const first = await startPythonViaAdapter(t, breakpoints, stopOnEntry, dir, env);
  if (!first.error) return first;
  const second = await startPythonViaServer(t, breakpoints, stopOnEntry, dir, env);
  if (!second.error) return second;
  return { error: `Python debugger ishga tushmadi (${first.error}; zaxira yo‘l: ${second.error})` };
}

/* --------------------------------------------------------------- sessiya */
async function start({ path: rel, breakpoints = [], stopOnEntry = false } = {}) {
  const t = ctx.safePath(rel);
  if (!t) return { error: 'yo‘l tashqarida' };
  await stop({ silent: true });
  const ext = path.extname(t.abs).toLowerCase();
  const isPy = ext === '.py';
  if (!isPy && !['.js', '.mjs', '.cjs'].includes(ext)) {
    return { error: `qadamlab debug JS (.js/.mjs/.cjs) va Python (.py) fayllar uchun (${ext || 'noma’lum'})` };
  }
  if (isPy) return startPython(t, breakpoints, stopOnEntry);
  const port = await freePort();
  const child = spawn(process.execPath, [`--inspect-brk=127.0.0.1:${port}`, t.abs], {
    cwd: path.dirname(t.abs),
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '0' },
  });
  session = {
    kind: 'node', child, ws: null, sock: null, port, file: t.abs, scripts: new Map(), breakpoints: [],
    seq: 0, pending: new Map(), paused: false, skipEntry: !stopOnEntry,
  };
  child.stdout.on('data', (b) => ctx.send(`${CH}:debug-output`, { chunk: String(b) }));
  child.stderr.on('data', (b) => {
    const s = String(b);
    // Inspector banner'ini foydalanuvchiga ko'rsatmaymiz.
    if (/Debugger listening on|For help, see/.test(s)) return;
    ctx.send(`${CH}:debug-output`, { chunk: s });
  });
  child.on('exit', (code) => {
    ctx.send(`${CH}:debug-exit`, { code });
    if (session) { try { session.ws && session.ws.close(); } catch { /* */ } session = null; }
  });
  const conn = await connect(port);
  if (conn.error) { try { child.kill(); } catch { /* */ } session = null; return { error: conn.error }; }
  if (breakpoints.length) await setBreakpoints(breakpoints);
  if (stopOnEntry) await cdpSend('Debugger.pause');
  // Inspector'ni qo'yib yuboramiz: dastur ishga tushadi va nuqtalarda to'xtaydi.
  await cdpSend('Runtime.runIfWaitingForDebugger');
  return { ok: true, port, file: relOf(t.abs) };
}

async function setBreakpoints(list = []) {
  if (!session) return { error: 'sessiya yo‘q' };
  if (isPySession()) return pythonSetBreakpoints(list);
  const result = [];
  for (const bp of list.slice(0, 200)) {
    const t = ctx.safePath(bp.path);
    if (!t) continue;
    const pattern = escRe(t.abs.replace(/\\/g, '/'));
    const r = await cdpSend('Debugger.setBreakpointByUrl', {
      urlRegex: pattern + '$',
      lineNumber: Math.max(0, (Number(bp.line) || 1) - 1),
      columnNumber: 0,
    });
    result.push({ path: relOf(t.abs), line: Number(bp.line) || 1, id: r && r.breakpointId, resolved: !!(r && r.locations && r.locations.length) });
  }
  session.breakpoints = result;
  return { breakpoints: result };
}

async function stop({ silent = false } = {}) {
  if (!session) return { ok: true };
  const s = session;
  session = null;
  try { s.ws && s.ws.close(); } catch { /* */ }
  // Python: avval DAP `disconnect` — adapter o'zi ko'targan debuggee'ni toza yopsin
  // (aks holda `child.kill()` faqat adapterni o'ldiradi va python jarayoni osilib qoladi).
  if (s.kind === 'python' && s.dap && s.dap.write && s.child && s.child.exitCode == null) {
    try { s.dap.write(dapFrame({ seq: ++s.seq, type: 'request', command: 'disconnect', arguments: { terminateDebuggee: true } })); } catch { /* */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  try { s.sock && s.sock.destroy(); } catch { /* */ }
  try { s.child.kill(); } catch { /* */ }
  if (!silent) ctx.send(`${CH}:debug-exit`, { code: null });
  return { ok: true };
}

function status() {
  return {
    available: !!loadWs() && !wsError,
    reason: wsError,
    running: !!session,
    language: session ? (session.kind || 'node') : null,
    paused: !!(session && session.paused),
    port: session && session.port ? session.port : null,
    file: session ? relOf(session.file) : null,
    breakpoints: session ? session.breakpoints : [],
  };
}

export function disposeDebug() {
  stop({ silent: true }).catch(() => {});
}

/**
 * Debugger IPC'larini ro'yxatga oladi (idempotent).
 * @param {{ safePath: Function, getWorkspace: () => string, send: Function }} c
 */
export function registerDebugIpc(c) {
  ctx = { ...ctx, ...c };

  ipcMain.handle(`${CH}:debug-status`, () => status());
  ipcMain.handle(`${CH}:debug-start`, (_e, opts = {}) => start(opts));
  ipcMain.handle(`${CH}:debug-breakpoints`, (_e, { breakpoints } = {}) => {
    if (!session) return { breakpoints: [], note: 'sessiya yo‘q — nuqtalar sessiya boshlanganda qo‘yiladi' };
    return setBreakpoints(breakpoints || []);
  });
  // Har bir boshqaruv AVVAL python sessiyasini tekshiradi; python bo'lmasa CDP (Node) yo'li.
  ipcMain.handle(`${CH}:debug-resume`, async () => {
    if (isPySession()) return dapResult(await dapSend('continue', { threadId: pyThreadId() }));
    const r = await cdpSend('Debugger.resume');
    return r.__error ? { error: r.__error } : { ok: true };
  });
  ipcMain.handle(`${CH}:debug-pause`, async () => {
    if (isPySession()) return dapResult(await dapSend('pause', { threadId: pyThreadId() }));
    const r = await cdpSend('Debugger.pause');
    return r.__error ? { error: r.__error } : { ok: true };
  });
  ipcMain.handle(`${CH}:debug-step`, async (_e, { kind = 'over' } = {}) => {
    const map = { over: 'Debugger.stepOver', into: 'Debugger.stepInto', out: 'Debugger.stepOut' };
    const dapMap = { over: 'next', into: 'stepIn', out: 'stepOut' };
    if (isPySession()) return dapResult(await dapSend(dapMap[kind] || 'next', { threadId: pyThreadId() }));
    const r = await cdpSend(map[kind] || 'Debugger.stepOver');
    return r.__error ? { error: r.__error } : { ok: true };
  });
  ipcMain.handle(`${CH}:debug-stop`, () => stop());
  ipcMain.handle(`${CH}:debug-eval`, async (_e, { expression, callFrameId } = {}) => {
    const text = String(expression || '').trim();
    if (!text) return { error: 'ifoda bo‘sh' };
    if (isPySession()) {
      const r = await dapSend('evaluate', { expression: text, frameId: session.topFrameId || undefined, context: 'repl' });
      if (r.__error) return { error: r.__error };
      return { ok: true, value: String(r.result == null ? '' : r.result), type: r.type };
    }
    const r = await cdpSend('Debugger.evaluateOnCallFrame', { callFrameId, expression: text, returnByValue: true, silent: true });
    if (r.__error) return { error: r.__error };
    const res = r.result || {};
    return { ok: true, value: res.value !== undefined ? String(res.value) : (res.description || res.type || ''), type: res.type };
  });
}
