// ide_runner.js — ISHGA TUSHIRISH, TARIX (log) va "SINAB KO'R + TUZAT" halqasi.
//
// Uch vazifa bir joyda, chunki ular bir-biriga bog'liq:
//   1. Faylni ishga tushirish (`runtimeFor`) — to'g'ri interpretator tanlanadi;
//   2. TARIX — har bir yurish yozib boriladi (buyruq, chiqish kodi, chiqish oxiri);
//   3. AI TUZATISH HALQASI — xato chiqsa, modelga FAQAT xato matni emas, butun tarix
//      (oldingi urinishlar, nima o'zgargani, diagnostika) beriladi va u tuzatib qayta
//      ishga tushiradi. Bu — "o'zi logni ko'rib tuzatadimi?" savolining javobi: ha,
//      har urinish kontekst bilan qaytariladi.
//
// Nega `ELECTRON_RUN_AS_NODE`: ilova ichida `process.execPath` — bu Electron exe'si.
// Usiz u oddiy Node skriptini "App" sifatida ochib, xato bilan yiqilardi (o'lchandi).
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CH = 'yide';
const RUN_TIMEOUT_MS = 120000;      // bitta yurish uchun eng ko'p vaqt
const LOG_LIMIT = 40;               // tarixda saqlanadigan yurishlar soni
const TAIL_CHARS = 4000;            // har yurishdan saqlanadigan chiqish oxiri
const FILE_INLINE_MAX = 12000;      // modelga ko'rsatiladigan fayl matni chegarasi
const AI_STEPS_PER_FIX = 10;        // bitta tuzatish urinishiga AI qadamlar chegarasi

let ctx = {
  safePath: () => null,
  getWorkspace: () => '',
  send: () => {},
  aiRun: async () => ({ error: 'AI mavjud emas' }),
  getDiagnostics: () => [],
  writeState: async () => {},
  readState: async () => ({}),
};
const runs = [];                    // tarix (eng yangisi oxirida)
const running = new Map();          // id -> child (to'xtatish uchun)
let fixAbort = false;
let fixRunning = false;

const PY_BIN = process.env.YANG_IDE_PYTHON || 'python';

/**
 * Faylni ishga tushirish uchun buyruq. `env` — qo'shimcha muhit o'zgaruvchilari.
 * Qaytaradi: { command, env } yoki null (matn fayli — tashqi ilovada ochiladi).
 */
export function runtimeFor(abs) {
  const ext = path.extname(abs).toLowerCase();
  const base = path.basename(abs);
  const quoted = `"${abs}"`;
  if (ext === '.py') return { command: `${PY_BIN} ${quoted}`, env: {} };
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    return { command: `"${process.execPath}" ${quoted}`, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  if (ext === '.html' || ext === '.htm') return null;
  if (ext === '.sh') return { command: `bash ${quoted}`, env: {} };
  if (ext === '.bat' || ext === '.cmd') return { command: `"${abs}"`, env: {} };
  if (ext === '.ps1') return { command: `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoted}`, env: {} };
  if (base === 'package.json') return { command: 'npm start', env: {} };
  return null;
}

function relOf(abs) {
  const root = path.resolve(ctx.getWorkspace() || '.');
  const r = path.relative(root, abs).replace(/\\/g, '/');
  return r.startsWith('..') ? abs.replace(/\\/g, '/') : r;
}

/** Tarixga yozish + rendererga xabar berish. */
function logRun(entry) {
  const item = { ts: Date.now(), ...entry };
  runs.push(item);
  if (runs.length > LOG_LIMIT) runs.shift();
  ctx.send(`${CH}:run-logged`, { run: item, runs: runs.slice(-LOG_LIMIT) });
  ctx.writeState({ runLog: runs.slice(-20).map((r) => ({ ...r, output: (r.output || '').slice(-1200) })) }).catch(() => {});
  return item;
}

export function getRuns() {
  return runs.slice(-LOG_LIMIT);
}

/** Oxirgi muvaffaqiyatsiz yurish (AI tuzatishi uchun asos). */
export function lastFailure() {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].code !== 0 && runs[i].path) return runs[i];
  }
  return null;
}

/**
 * Faylni ishga tushirib, chiqishini OQIM bilan yuboradi va oxirini yodda saqlaydi.
 * @param {{ rel: string, cwd?: string, label?: string, timeoutMs?: number }} o
 */
export async function runCaptured({ rel, cwd, label = 'run', timeoutMs = RUN_TIMEOUT_MS }) {
  const t = ctx.safePath(rel);
  if (!t) return { error: 'yo‘l tashqarida' };
  const rt = runtimeFor(t.abs);
  if (!rt) {
    const { shell } = await import('electron');
    const err = await shell.openPath(t.abs);
    return err ? { error: err } : { opened: true };
  }
  const started = Date.now();
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const cwdAbs = cwd ? (ctx.safePath(cwd, { allowRoot: true })?.abs || ctx.getWorkspace()) : path.dirname(t.abs);
  const child = spawn(rt.command, { cwd: cwdAbs, windowsHide: true, shell: true, env: { ...process.env, FORCE_COLOR: '0', ...rt.env } });
  running.set(id, child);
  let out = '';
  let finished = false;
  const onData = (buf) => {
    const s = String(buf);
    out += s;
    if (out.length > 400000) out = out.slice(-400000);
    ctx.send(`${CH}:term-data`, { id, chunk: s });
  };
  ctx.send(`${CH}:term-data`, { id, chunk: `\u001b[90m$ ${path.basename(t.abs)} ishga tushirildi …\u001b[0m\r\n` });
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => onData(`\r\n[ishga tushmadi: ${e.message}]\r\n`));
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill(); } catch { /* o'lgan */ }
      ctx.send(`${CH}:term-data`, { id, chunk: `\r\n\u001b[91m[${timeoutMs / 1000} s ichida tugamadi — to‘xtatildi]\u001b[0m\r\n` });
      resolve({ code: 124, timedOut: true });
    }, timeoutMs);
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, timedOut: false });
    });
  });
  running.delete(id);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  ctx.send(`${CH}:term-exit`, { id, code: result.code, cwd: cwdAbs });
  const entry = logRun({
    kind: label,
    path: relOf(t.abs),
    command: rt.command,
    code: result.code,
    timedOut: !!result.timedOut,
    seconds,
    output: out.slice(-TAIL_CHARS),
  });
  ctx.send(`${CH}:run-finished`, { run: entry });
  return entry;
}

/* --------------------------------------------------- AI tuzatish halqasi */
/**
 * Muammoli fayl matni (modelga to'g'ridan-to'g'ri ko'rsatish uchun).
 * Nega: o'lchov shuni ko'rsatdi — fayl matni berilmasa lokal 7B model
 * «faylni o'qishim kerak» deb bir xil buyruqni qayta-qayta chaqirib, 15 daqiqa
 * behuda yoqib yubordi. Faylni qo'shib bersak, model to'g'ridan-to'g'ri
 * tuzatilgan to'liq faylni yozadi (write_file).
 */
async function inlineFile(rel) {
  try {
    const t = ctx.safePath(rel);
    if (!t) return '';
    const text = await fs.readFile(t.abs, 'utf8');
    if (text.length <= FILE_INLINE_MAX) return text;
    return `${text.slice(0, FILE_INLINE_MAX)}\n… (fayl qisqartirildi, to‘liq o‘qish uchun read_file ishlatilsin)`;
  } catch { return ''; }
}

async function buildPrompt({ rel, attempt, history }) {
  const ws = ctx.getWorkspace();
  const last = history[history.length - 1];
  const diags = ctx.getDiagnostics() || [];
  const diagText = diags.slice(0, 12).map((d) => `- ${d.line}:${d.col} ${d.message}`).join('\n');
  const hist = history.map((h) => `- ${h.attempt}-urinish: $ ${h.command}\n  chiqish kodi: ${h.code}\n  chiqish oxiri:\n${(h.output || '').split('\n').slice(-12).join('\n')}\n  model izohi: ${h.note || '(yo‘q)'}`).join('\n\n');
  const fileText = await inlineFile(rel);

  const head = [
    'Sen YANG IDE ichida ishlayapsan. Vazifa: faylni ishga tushirishda xato chiqdi — SABABINI topib tuzat va natijani tayyor qil.',
    `Ish papkasi: ${ws}`,
    `Muammoli fayl: ${rel}`,
    '',
    fileText ? `Faylning HOZIRGI mazmuni (${rel}):` : `Fayl mazmunini o‘zing o‘qi (read_file: ${rel}).`,
    fileText ? '```' : '',
    fileText,
    fileText ? '```' : '',
    '',
  ].join('\n');

  const tail = [
    `Hozirgi (${attempt}-urinish) natijasi:`,
    `$ ${last.command}`,
    '```',
    (last.output || '').slice(-2500) || '(chiqish bo‘sh)',
    '```',
    diagText ? `\nIDE diagnostikasi:\n${diagText}` : '',
    '\nFayl mazmuni yuqorida keltirilgan — uni qayta o‘qishga urinma.',
    `Tuzatilgan TO‘LIQ fayl matnini write_file bilan yoz (path: ${rel}).`,
    'Buyruqni o‘zing qayta ishga tushirishga hojat yo‘q — tuzatgandan keyin IDE faylni o‘zi ishga tushiradi.',
    attempt === 1
      ? 'Talab: faqat kerakli o‘zgarishlarni qil, so‘ng qisqa xulosa yoz (nima tuzatildi).'
      : 'Talab: avvalgi urinishlarni takrorlamang — xatoning ILDIZINI tuzating.',
  ].join('\n');

  const past = attempt === 1
    ? ''
    : [`Oldingi ${history.length} urinish TARIXI (buni hisobga ol — bir xil narsani qayta urinma):`, hist, ''].join('\n');

  return `${head}${past}${tail}`;
}

async function fixLoop({ rel, maxAttempts = 3 }) {
  if (fixRunning) return { error: 'tuzatish halqasi allaqachon ishlayapti' };
  fixRunning = true;
  fixAbort = false;
  const history = [];
  let finalRun = null;
  try {
    for (let attempt = 1; attempt <= Math.max(1, Math.min(5, Number(maxAttempts) || 3)); attempt++) {
      if (fixAbort) break;
      ctx.send(`${CH}:fix-event`, { phase: 'run', attempt, text: `${attempt}-urinish: ishga tushirilyapti…` });
      const run = await runCaptured({ rel, label: `fix-${attempt}` });
      if (run.error) { ctx.send(`${CH}:fix-event`, { phase: 'error', attempt, text: run.error }); history.push({ attempt, command: '', code: -1, output: run.error, note: '' }); continue; }
      finalRun = run;
      if (run.code === 0) {
        ctx.send(`${CH}:fix-event`, { phase: 'done', attempt, text: `✅ ${attempt}-urinishdayoq muvaffaqiyatli tugadi (${run.seconds}s)` });
        return { ok: true, attempts: attempt, run };
      }
      if (attempt === Math.max(1, Math.min(5, Number(maxAttempts) || 3)) || fixAbort) break;
      history.push({ attempt, command: run.command, code: run.code, output: run.output, note: '' });
      ctx.send(`${CH}:fix-event`, { phase: 'ai', attempt, text: `xato (kod ${run.code}) — model tuzatyapti…` });
      const res = await ctx.aiRun({ prompt: await buildPrompt({ rel, attempt: attempt + 1, history }), maxSteps: AI_STEPS_PER_FIX });
      if (history.length) history[history.length - 1].note = String((res && res.content) || '').slice(0, 400);
      if (res && res.error) {
        ctx.send(`${CH}:fix-event`, { phase: 'error', attempt, text: `model ishlamadi: ${res.error}` });
        return { error: res.error, attempts: attempt, run };
      }
    }
    const last = finalRun || lastFailure();
    ctx.send(`${CH}:fix-event`, { phase: 'give-up', attempt: history.length + 1, text: `❌ ${history.length + 1} urinishdan keyin ham xato qoldi` });
    return { ok: false, attempts: history.length + 1, run: last, error: 'urinishlar tugadi' };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally {
    fixRunning = false;
  }
}

/**
 * Runner IPC'larini ro'yxatga oladi (idempotent).
 * @param {{ safePath: Function, getWorkspace: Function, send: Function, aiRun: Function, getDiagnostics: Function, writeState: Function }} c
 */
export function registerRunnerIpc(c) {
  ctx = { ...ctx, ...c };
  // Oldingi sessiyadagi tarixni tiklaymiz (foydalanuvchi ilovani qayta ochsa log yo'qolmasin).
  if (c.readState) {
    c.readState()
      .then((s) => { if (Array.isArray(s && s.runLog) && !runs.length) runs.push(...s.runLog.slice(-LOG_LIMIT)); })
      .catch(() => {});
  }

  ipcMain.handle(`${CH}:run-captured`, (_e, { path: p, cwd } = {}) => (p ? runCaptured({ rel: p, cwd, label: 'run' }) : { error: 'fayl ko‘rsatilmagan' }));

  ipcMain.handle(`${CH}:run-log`, () => ({ runs: getRuns(), lastFailure: lastFailure() }));

  ipcMain.handle(`${CH}:run-stop`, (_e, { id } = {}) => {
    if (id && running.has(id)) {
      try { running.get(id).kill(); } catch { /* o'lgan */ }
      return { ok: true };
    }
    // id berilmasa — hammasini to'xtatamiz (Tarix panelidagi «To'xtatish»).
    for (const child of running.values()) { try { child.kill(); } catch { /* o'lgan */ } }
    return { ok: true };
  });

  ipcMain.handle(`${CH}:fix-run`, (_e, { path: p, maxAttempts } = {}) => {
    if (!p) return { error: 'fayl ko‘rsatilmagan' };
    return fixLoop({ rel: p, maxAttempts });
  });

  ipcMain.handle(`${CH}:fix-stop`, () => {
    fixAbort = true;
    for (const child of running.values()) { try { child.kill(); } catch { /* o'lgan */ } }
    return { ok: true, note: 'halqa to‘xtatiladi' };
  });

  ipcMain.handle(`${CH}:fix-busy`, () => ({ busy: fixRunning }));
}

export function disposeRunner() {
  fixAbort = true;
  for (const child of running.values()) { try { child.kill(); } catch { /* o'lgan */ } }
  running.clear();
}
