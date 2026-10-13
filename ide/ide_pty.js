// ide_pty.js — HAQIQIY terminal (PTY) sessiyalari.
//
// Nega kerak: ilgari terminal `spawn` + quvur (pipe) edi — interaktiv TUI dasturlar
// (vim, top, ssh, less, python REPL) ishlamasdi, chunki ular o'zini terminal deb bilishi
// shart. Endi ConPTY orqali haqiqiy psevdo-terminal ochiladi va baytlar o'zgarishsiz
// oqadi; renderer tomonda xterm.js ularni ekranga chizadi.
//
// Diqqat (muhim qaror): bu modul **ixtiyoriy**. `node-pty` yuklanmasa (masalan, noto'g'ri
// platforma yoki chalkash ABI), IDE ishlashdan to'xtamaydi — `available: false` qaytaradi
// va renderer oddiy (quvur) terminal rejimiga tushadi. Shu sababli relizda hard-require yo'q.
import { ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CH = 'yide';

let ptyMod = null;
let ptyError = null;
let tried = false;

/**
 * node-pty ni bir marta yuklab ko'ramiz (xatoni yodda saqlaymiz, qayta urinmaymiz).
 *
 * MUHIM (paketlash): paketlangan ilovada native modul `app.asar.unpacked` ichida bo'ladi.
 * Uni asar ICHIDAN require qilsak `__dirname` asar ichidagi yo'lni ko'rsatadi va node-pty
 * o'zining ConPTY yordamchisini (`third_party/conpty/.../OpenConsole.exe`) ishga tushira
 * olmaydi — natijada PTY paketda JIMGINA ishlamay qoladi (o'lchandi: dev'da `isatty()` 
 * TTY_OK, paketda bo'sh chiqish). Shu sabab avval UNPACKED yo'lni sinaymiz.
 */
function loadPty() {
  if (tried) return ptyMod;
  tried = true;
  const candidates = [];
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch')
    : null;
  if (unpacked) candidates.push(unpacked);
  candidates.push('@homebridge/node-pty-prebuilt-multiarch', 'node-pty');
  for (const name of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require
      ptyMod = require(name);
      ptyError = null;
      return ptyMod;
    } catch (e) {
      ptyError = `${name}: ${String(e.message || e).split('\n')[0]}`;
    }
  }
  return null;
}

const sessions = new Map();
let sendFn = () => {};
let cwdFn = () => os.homedir();
let guardCwd = null;   // ish papkasi qamog'i (ide_host beradi)

const IS_WIN = process.platform === 'win32';

/** Sessiya identifikatori: qisqa va tartiblangan. */
function newId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Windows/Linux uchun standart qobiq. `shell` parametri bilan almashtirish mumkin. */
export function defaultShell(kind) {
  if (IS_WIN) {
    if (kind === 'powershell') return { file: 'powershell.exe', args: ['-NoLogo'] };
    if (kind === 'bash') return { file: 'bash.exe', args: ['-i'] };
    return { file: process.env.ComSpec || 'cmd.exe', args: [] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-i'] };
}

/**
 * Sessiya ochgan oynaning O'ZIGA yuboruvchi.
 * Nega kerak: yadroning umumiy `send()` funksiyasi faqat IDE oynasiga yuboradi, holbuki
 * PTY'ni asosiy ilovaning yon paneli ham ochadi — o'shanda `pty-data` IDE oynasiga ketib,
 * asosiy oynaning terminali BO'SH qolardi (E2E bilan o'lchandi). Shuning uchun so'rovni
 * yuborgan webContents'ni eslab qolamiz va ma'lumotni o'shanga qaytaramiz.
 */
function emitterFor(sender) {
  const alive = sender && !sender.isDestroyed();
  if (!alive) return (ch, payload) => sendFn(ch, payload);
  return (ch, payload) => {
    if (sender.isDestroyed()) { sendFn(ch, payload); return; }
    try { sender.send(ch, payload); } catch { /* oyna yopildi */ }
  };
}

function openSession({ cols = 80, rows = 24, cwd, shell, sender } = {}) {
  const emit = emitterFor(sender);
  const pty = loadPty();
  if (!pty) {
    return { error: 'PTY mavjud emas', available: false, reason: ptyError };
  }
  const dir = cwd && String(cwd).trim() ? path.resolve(String(cwd)) : cwdFn();
  const { file, args } = defaultShell(shell);
  let proc;
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(20, Math.min(500, Number(cols) || 80)),
      rows: Math.max(5, Math.min(200, Number(rows) || 24)),
      cwd: dir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        // Windows'da ba'zi dasturlar (git, node) ranglarni shu bilan yoqadi.
        FORCE_COLOR: '1',
      },
    });
  } catch (e) {
    return { error: `terminal ochilmadi: ${String(e.message || e)}`, available: false };
  }
  const id = newId();
  const session = { id, proc, shell: file, cwd: dir, started: Date.now() };
  sessions.set(id, session);
  proc.onData((chunk) => {
    // Baytlar o'zgarishsiz o'tadi — xterm.js ularni o'zi chizadi.
    emit(`${CH}:pty-data`, { id, chunk });
  });
  proc.onExit(({ exitCode }) => {
    sessions.delete(id);
    emit(`${CH}:pty-exit`, { id, code: exitCode });
  });
  proc.process?.on?.('error', (err) => {
    emit(`${CH}:pty-exit`, { id, code: -1, error: String(err.message || err) });
  });
  return { id, shell: file, cwd: dir, available: true };
}

/** Barcha PTY sessiyalarini yopadi (ilova yopilganda chaqiriladi). */
export function disposePty() {
  for (const s of sessions.values()) {
    try { s.proc.kill(); } catch { /* allaqachon o'lgan */ }
  }
  sessions.clear();
}

/**
 * PTY IPC handler'larini ro'yxatga oladi (idempotent).
 * @param {{ send: (channel: string, payload: unknown) => void, getWorkspace: () => string }} ctx
 */
export function registerPtyIpc(ctx = {}) {
  guardCwd = typeof ctx.guardCwd === 'function' ? ctx.guardCwd : null;
  sendFn = ctx.send || sendFn;
  cwdFn = ctx.getWorkspace || cwdFn;
  const pty = loadPty();

  ipcMain.handle(`${CH}:pty-info`, () => ({
    available: !!pty,
    reason: pty ? null : ptyError,
    platform: process.platform,
    shell: defaultShell().file,
  }));

  // Ish papkasi qamog'i: `cwd` berilgan bo'lsa ham u ish papkasi ICHIDA bo'lishi shart.
  // Ilgari `ptyOpen({cwd:'C:\\Windows'})` bilan shell istalgan joyda ochila olardi
  // (hujum sinovi bilan o'lchandi) — endi tashqariga chiqadigan cwd rad etiladi.
  ipcMain.handle(`${CH}:pty-open`, (e, opts = {}) => {
    const want = opts.cwd && String(opts.cwd).trim() ? String(opts.cwd) : '';
    let dir = cwdFn();
    if (want) {
      const ok = guardCwd ? guardCwd(want) : want;
      if (!ok) return { error: 'ish papkasidan tashqarida terminal ochilmaydi', available: true };
      dir = ok;
    }
    return openSession({ ...opts, cwd: dir, sender: e && e.sender });
  });

  ipcMain.handle(`${CH}:pty-write`, (_e, { id, data } = {}) => {
    const s = sessions.get(id);
    if (!s) return { error: 'sessiya topilmadi' };
    try { s.proc.write(String(data ?? '')); return { ok: true }; }
    catch (e) { return { error: String(e.message || e) }; }
  });

  ipcMain.handle(`${CH}:pty-resize`, (_e, { id, cols, rows } = {}) => {
    const s = sessions.get(id);
    if (!s) return { error: 'sessiya topilmadi' };
    try {
      s.proc.resize(Math.max(20, Math.min(500, Number(cols) || 80)), Math.max(5, Math.min(200, Number(rows) || 24)));
      return { ok: true };
    } catch (e) { return { error: String(e.message || e) }; }
  });

  ipcMain.handle(`${CH}:pty-close`, (_e, { id } = {}) => {
    const s = sessions.get(id);
    if (!s) return { ok: true };
    try { s.proc.kill(); } catch { /* o'lgan */ }
    sessions.delete(id);
    return { ok: true };
  });

  ipcMain.handle(`${CH}:pty-list`, () => [...sessions.values()].map((s) => ({ id: s.id, shell: s.shell, cwd: s.cwd, started: s.started })));
}
