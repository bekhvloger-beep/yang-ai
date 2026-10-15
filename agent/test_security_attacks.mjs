// agent/test_security_attacks.mjs — TASHQARIDAN BUZISHGA URINISH sinovi.
//
// Nima uchun: `test_v5_ide_security.mjs` manba kodini MATN sifatida tekshiradi. Bu sinov esa
// ilovani HAQIQIY ishga tushirib, uning O'Z IPC yuzasidan (xuddi buzilgan/xavfli renderer
// qilgandek) hujum qiladi va har bir urinish RAD ETILISHINI talab qiladi.
//
// Hujum to'plami:
//   1. yo'l chiqishi (path traversal): `..`, `..\\`, absolyut yo'l, UNC, katta-kichik harf,
//      aralash ajratgich, URL-kodlangan nuqtalar;
//   2. havola (junction/symlink) orqali chiqish: ish papkasi ichida C:\Windows ga havola
//      yaratib, undan o'qishga urinish — `path.relative` havolani KUZATMAYDI;
//   3. yozish/o'chirish/qayta nomlash/o'chirish savatga tashlash yo'llari;
//   4. terminal ish papkasi (`pty-open` cwd) — ish papkasidan tashqariga chiqish;
//   5. debugger va til xizmati: yo'l chiqishi;
//   6. tashqi ilovada ochish (`open-external`) — ish papkasidan tashqari fayl;
//   7. juda uzun/bo'sh g'alati kirishlar (robustlik).
//
// Ishga tushirish:  YANG_APP_EXE=dev node agent/test_security_attacks.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXE = process.env.YANG_APP_EXE;
const useExe = !!EXE && EXE !== 'dev';
const ELECTRON_BIN = (await import('electron')).default;

/* --------------------------------------------------------- yordamchilar */
function portFree(port) {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '127.0.0.1');
  });
}
async function pickFreePort(start) {
  for (let p = start; p < start + 40; p += 1) if (await portFree(p)) return p;
  throw new Error('bo‘sh port topilmadi');
}

const results = [];
function check(name, blocked, detail = '') {
  results.push(!!blocked);
  console.log(`${blocked ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}

/** Javob "rad etildi"mi? Xato, error maydoni yoki `ok:false` — hammasi rad javobi. */
const refused = (r) => !r || r.error || r.ok === false || r.blocked === true;
const show = (r) => JSON.stringify(r).slice(0, 150);

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-attack-ws-'));
const OUTSIDE = path.join(WS, '..', 'yang-attack-outside.txt');
fs.writeFileSync(path.join(WS, 'normal.txt'), 'salom\n', 'utf8');
fs.writeFileSync(OUTSIDE, 'TASHQI MAXFIY MATN\n', 'utf8');
const SECRET = path.join(path.parse(process.execPath).root, 'Windows', 'win.ini');
const secretExists = fs.existsSync(SECRET);

// 2-hujum uchun: ish papkasi ichida TASHQARIGA havola (junction — admin huquqisiz ishlaydi).
const LINK = path.join(WS, 'link');
let linkMade = false;
if (process.platform === 'win32') {
  const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', LINK, path.dirname(SECRET)], { encoding: 'utf8' });
  linkMade = r.status === 0 && fs.existsSync(LINK);
}

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-attack-ud-'));
const APP_LOG = path.join(ROOT, 'reports', 'security_attacks_app.log');
const logFd = fs.openSync(APP_LOG, 'w');

// v5.5 KO‘P ILDIZLI WORKSPACE: qo‘shimcha papka ilova ichida papka tanlash oynasi orqali
// qo‘shiladi; oynani avtomatlashtirib bo‘lmagani uchun ro‘yxat OLDINDAN sozlamaga yoziladi
// (foydalanuvchi bir marta tanlagan holatning aynan o‘zi: `config.json → extraRoots`).
const EXTRA = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-attack-extra-'));
const EXTRA_FILE = path.join(EXTRA, 'umumiy.txt');
const EXTRA_OUTSIDE = path.join(EXTRA, '..', 'yang-attack-extra-outside.txt');
fs.writeFileSync(EXTRA_FILE, 'QO‘SHIMCHA PAPKADAGI MATN\n', 'utf8');
fs.writeFileSync(EXTRA_OUTSIDE, 'QO‘SHIMCHA PAPKADAN TASHQARI MAXFIY MATN\n', 'utf8');
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ extraRoots: [EXTRA] }, null, 2), 'utf8');

let PORT = await pickFreePort(9455);
const app = useExe
  ? spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], { detached: true, stdio: ['ignore', logFd, logFd] })
  : spawn(ELECTRON_BIN, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], {
    cwd: ROOT, detached: true, stdio: ['ignore', logFd, logFd],
  });
app.unref();

const MAIN_URL = /renderer[\\/]index\.html/;
const IDE_URL = /ide[\\/]renderer[\\/]index\.html/;
const isMain = (u) => MAIN_URL.test(u) && !IDE_URL.test(u);
const isIde = (u) => IDE_URL.test(u);

async function targetFor(match, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && match(x.url || ''));
      if (t && t.webSocketDebuggerUrl) return t;
    } catch { /* CDP ko'tarilmagan */ }
    await sleep(500);
  }
  throw new Error('CDP target topilmadi');
}

async function attach(match) {
  const target = await targetFor(match);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP ulanish vaqti tugadi')), 8000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP xatosi')); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const ev = async (expression, ms = 45000) => {
    const id = ++seq;
    const r = await new Promise((res) => {
      const t = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(t); res(m); });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (r.__timeout) throw new Error(`CDP javob bermadi: ${String(expression).slice(0, 60)}`);
    if (r.result && r.result.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await ev('1');
  return { ev, ws };
}

let main = null;
let ide = null;
try {
  console.log(`nishon: ${useExe ? EXE : 'dev rejim'} · ish papkasi: ${WS} · havola: ${linkMade ? 'yaratildi' : 'yo‘q'}`);
  main = await attach(isMain);
  await main.ev('1');

  /* ---------------- 1. IDE oynasini ochamiz (u yerda `window.ide` bor) ---------------- */
  await main.ev('(() => { const b = document.getElementById("ideToggle"); if (b) b.click(); return true; })()');
  await main.ev('window.api.openIde()');
  ide = await attach(isIde);
  await ide.ev('(async () => { await window.ide.openFolder(' + JSON.stringify(WS) + '); return true; })()');
  await sleep(600);

  /* ---------------- 2. Yo'l chiqishi: `window.ide` (to'liq IDE) ---------------- */
  const escapes = [
    '../' + path.basename(OUTSIDE),
    '..\\..\\..\\Windows\\win.ini',
    SECRET,
    SECRET.split('\\').join('/'),
    '\\\\?\\' + SECRET,
    '....//....//Windows/win.ini',
    '%2e%2e%2f%2e%2e%2fWindows%2fwin.ini',
    '.\\..\\..\\',
    '',
  ];
  const readResults = [];
  for (const rel of escapes) {
    const r = await ide.ev(`window.ide.readFile(${JSON.stringify(rel)})`);
    readResults.push({ rel, refused: refused(r), got: r && r.text ? String(r.text).length : null });
  }
  const readLeaks = readResults.filter((r) => !r.refused);
  check(`1. \`readFile\` yo‘l chiqishini rad etadi (${escapes.length} xil ko‘rinish)`, readLeaks.length === 0,
    readLeaks.length ? `SIZIB KETDI: ${readLeaks.map((l) => JSON.stringify(l.rel)).join(', ')}` : `hammasi rad etildi (shu jumladan absolyut, UNC, %2e%2e, «....//»)`);

  /* ---------------- 3. Havola (junction) orqali chiqish ---------------- */
  if (linkMade && secretExists) {
    const r = await ide.ev(`window.ide.readFile(${JSON.stringify('link/' + path.basename(SECRET))})`);
    check('2. Havola (junction) orqali ish papkasidan chiqish ham bloklanadi', refused(r),
      refused(r) ? `rad etildi: ${show(r)}` : `SIZIB KETDI: ${String((r && r.text) || '').length} belgi o‘qildi (${show(r)})`);
  } else {
    check('2. Havola (junction) orqali chiqish bloklanadi', true, 'SKIP: havola yaratilmadi (mklink) yoki tizim fayli yo‘q — bu tekshiruv O‘TKAZIB YUBORILDI');
  }

  /* ---------------- 4. Yozish / yaratish / qayta nomlash / o'chirish ---------------- */
  const writeOut = await ide.ev(`window.ide.writeFile(${JSON.stringify('../yang-attack-escape.txt')}, 'xato')`);
  const createOut = await ide.ev(`window.ide.create(${JSON.stringify(SECRET + '.new')})`);
  const renameIn = await ide.ev(`window.ide.rename('normal.txt', ${JSON.stringify('../yang-attack-renamed.txt')})`);
  const removeOut = await ide.ev(`window.ide.remove(${JSON.stringify('../yang-attack-outside.txt')})`);
  const normalStillThere = fs.existsSync(path.join(WS, 'normal.txt'));
  const outsideStillThere = fs.existsSync(OUTSIDE);
  check('3. Yozish/yaratish/qayta nomlash/o‘chirish ish papkasidan tashqariga chiqmaydi',
    refused(writeOut) && refused(createOut) && refused(renameIn) && refused(removeOut) && normalStillThere && outsideStillThere,
    `yozish=${refused(writeOut) ? 'rad' : 'O‘TDI'}, yaratish=${refused(createOut) ? 'rad' : 'O‘TDI'}, qayta nomlash=${refused(renameIn) ? 'rad' : 'O‘TDI'}, o‘chirish=${refused(removeOut) ? 'rad' : 'O‘TDI'}; normal.txt joyida=${normalStillThere}, tashqi fayl joyida=${outsideStillThere}`);

  /* ---------------- 5. Terminal ish papkasi (PTY cwd) ---------------- */
  const ptyOut = await ide.ev(`window.ide.ptyOpen({ cols: 90, rows: 24, cwd: ${JSON.stringify(path.dirname(SECRET))} })`);
  const ptyOutside = !!(ptyOut && ptyOut.id) && path.resolve(String(ptyOut.cwd || '')).toLowerCase().startsWith(path.dirname(SECRET).toLowerCase());
  if (ptyOut && ptyOut.id) await ide.ev(`window.ide.ptyClose(${JSON.stringify(ptyOut.id)})`);
  check('5. Terminal ish papkasidan tashqarida ham ochilmaydi', !ptyOutside,
    ptyOutside ? `SIZIB KETDI: shell cwd=${ptyOut.cwd}` : `rad etildi yoki ish papkasiga qaytarildi: cwd=${(ptyOut && ptyOut.cwd) || '—'}${ptyOut && ptyOut.error ? ` (${ptyOut.error})` : ''}`);

  /* ---------------- 6. Debugger / til xizmati yo'l chiqishi ---------------- */
  const dbgOut = await ide.ev(`window.ide.debugStart(${JSON.stringify('../evil.py')}, [], false)`);
  const lspOut = await ide.ev(`window.ide.lspDiagnostics(${JSON.stringify('../evil.js')}, 'x')`);
  check('6. Debugger va til xizmati tashqi yo‘lni rad etadi', refused(dbgOut) && refused(lspOut),
    `debug=${refused(dbgOut) ? 'rad' : 'O‘TDI'}, lsp=${refused(lspOut) ? 'rad' : 'O‘TDI'}`);

  /* ---------------- 7. `open-external` ish papkasidan tashqari faylni ochmaydi ---------------- */
  const openOut = await ide.ev(`window.ide.openExternal(${JSON.stringify(SECRET)})`);
  check('7. «Tashqi ilovada ochish» ish papkasidan tashqariga chiqmaydi', refused(openOut), show(openOut));

  /* ---------------- 8. Asosiy ilovaning yengil paneli (`window.api`) ---------------- */
  const liteRead = await main.ev(`window.api.readWorkspaceFile(${JSON.stringify('../yang-attack-outside.txt')})`);
  const liteList = await main.ev(`window.api.ideListTree('..', 3)`);
  check('8. Asosiy ilovaning yengil paneli ham tashqi yo‘lni rad etadi',
    refused(liteRead) && refused(liteList), `o‘qish=${refused(liteRead) ? 'rad' : 'O‘TDI'}, daraxt=${refused(liteList) ? 'rad' : 'O‘TDI'}`);

  /* ---------------- 9. Robustlik: g'alati kirishlar ilovani yiqitmaydi ---------------- */
  const weird = await ide.ev(`(async () => {
    const out = [];
    out.push(await window.ide.readFile(null));
    out.push(await window.ide.readFile('a'.repeat(5000)));
    out.push(await window.ide.readFile('\\u0000\\u0001'));
    out.push(await window.ide.listTree('.', 9999));
    out.push(await window.ide.search('(', false));
    return out.map((r) => (r && (r.error || r.ok === false)) ? 'rad' : 'javob');
  })()`);
  const alive = await main.ev('document.title');
  check('9. G‘alati kirishlarga o‘qiladigan javob (ilova yiqilmaydi)',
    Array.isArray(weird) && weird.length === 5 && !!alive, `javoblar=${JSON.stringify(weird)}; asosiy oyna="${alive}"`);

  /* ---------------- 10. Ko‘p ildizli workspace: ruxsat ko'paydi, qamoq o'zgarmadi ---------------- */
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const rootList = await ide.ev('window.ide.rootsList()');
  const roots = (rootList && rootList.roots) || [];
  const hasExtra = roots.some((r) => norm(r.path) === norm(EXTRA));
  check('10. Qo‘shimcha papka ruxsat etilgan ildizlar ro‘yxatida ko‘rinadi',
    hasExtra && roots.every((r) => !!r.path && !!r.name),
    `ildizlar=[${roots.map((r) => `${r.name}${r.primary ? ' (asosiy)' : ''}`).join(', ')}]`);

  /* ---------------- 11. Ijobiy nazorat: qo'shimcha papkadagi fayl HAQIQATAN ochiladi ---------------- */
  const extraRead = await ide.ev(`window.ide.readFile(${JSON.stringify(EXTRA_FILE)})`);
  check('11. Qo‘shimcha papkadagi fayl o‘qiladi (yangi ruxsat haqiqatan ishlaydi)',
    !!(extraRead && !extraRead.error && String(extraRead.text || '').includes('QO‘SHIMCHA')),
    extraRead && extraRead.error ? `xato: ${extraRead.error}` : `o‘qildi=${String((extraRead && extraRead.text) || '').length} belgi`);

  /* ---------------- 12. Qo'shimcha papkadan ham tashqariga chiqib bo'lmaydi ---------------- */
  const extraEscapes = [
    `${EXTRA}\\..\\${path.basename(EXTRA_OUTSIDE)}`,
    `${EXTRA}/../../Windows/win.ini`,
    `${EXTRA}/..`,
    `${EXTRA}/../..`,
  ];
  const extraOut = [];
  for (const p of extraEscapes) {
    const r = await ide.ev(`window.ide.readFile(${JSON.stringify(p)})`);
    extraOut.push(refused(r));
  }
  // Yengil panel (asosiy ilova) ham shu yerda sinaladi: uning asosiy papkasi bu sinovda
  // foydalanuvchi sozlamasidan keladi, shuning uchun UNDAN TASHQARIDAGI ma'lum yo'l
  // olinadi (`C:\Windows\win.ini`) — aks holda «rad etildi» soxta bo‘lardi.
  const liteEscape = await main.ev(`window.api.readWorkspaceFile(${JSON.stringify(SECRET)})`);
  const liteTreeEscape = await main.ev(`window.api.ideListTree(${JSON.stringify(path.dirname(SECRET))}, 1)`);
  check('12. Iqkinchi ildiz ham qamoqni ochmaydi: undan tashqariga chiqish bloklanadi',
    extraOut.every(Boolean) && refused(liteEscape) && refused(liteTreeEscape),
    `IDE (${extraEscapes.length} xil): ${extraOut.map((x) => (x ? 'rad' : 'O‘TDI')).join(', ')} · yengil panel: o‘qish=${refused(liteEscape) ? 'rad' : 'O‘TDI'}, daraxt=${refused(liteTreeEscape) ? 'rad' : 'O‘TDI'}`);

  /* ---------------- 13. Qo'shimcha papkadan tashqariga YOZISH ---------------- */
  // Oldingi yurishdan qolgan fayl bo'lsa tozalaymiz — aks holda «yaratilmadi» degan shart
  // eski artefakt tufayli soxta yiqilardi.
  const ESCAPE_FILES = [path.join(EXTRA, '..', 'yang-attack-extra-write.txt'), path.join(path.dirname(SECRET), 'yang-attack-lite.txt')];
  for (const f of ESCAPE_FILES) { try { fs.rmSync(f, { force: true }); } catch { /* */ } }
  const writeEscape = await ide.ev(`window.ide.writeFile(${JSON.stringify(`${EXTRA}/../yang-attack-extra-write.txt`)}, 'xato')`);
  const liteWriteEscape = await main.ev(`window.api.ideSaveFile(${JSON.stringify(path.join(path.dirname(SECRET), 'yang-attack-lite.txt'))}, 'xato')`);
  const outsideUntouched = fs.existsSync(EXTRA_OUTSIDE) && fs.readFileSync(EXTRA_OUTSIDE, 'utf8').includes('TASHQARI');
  const created = ESCAPE_FILES.filter((f) => fs.existsSync(f));
  check('13. Ikkinchi ildiz orqali tashqariga YOZISH ham bloklanadi (hech narsa yaratilmadi)',
    refused(writeEscape) && refused(liteWriteEscape) && outsideUntouched && created.length === 0,
    `IDE yozish=${refused(writeEscape) ? 'rad' : 'O‘TDI'}, yengil panel yozish=${refused(liteWriteEscape) ? 'rad' : 'O‘TDI'}, tashqi fayl joyida=${outsideUntouched}, yaratilgan fayl=${created.length ? created.join(', ') : 'yo‘q'}`);

  /* ---------------- 14. Ikkala oyna BIR MANBADAN o'qiydi ---------------- */
  const liteRoots = await main.ev('window.api.ideRootsList()');
  const liteRootsList = (liteRoots && liteRoots.roots) || [];
  const liteReadExtra = await main.ev(`window.api.readWorkspaceFile(${JSON.stringify(EXTRA_FILE)})`);
  const beforeCount = liteRootsList.length;
  check('14. Yengil panel ham o‘sha ro‘yxatni ko‘radi va qo‘shimcha papkani o‘qiy oladi',
    liteRootsList.some((r) => norm(r.path) === norm(EXTRA)) && !!(liteReadExtra && !liteReadExtra.error && String(liteReadExtra.text || '').includes('QO‘SHIMCHA')),
    `yengil panel ildizlari=[${liteRootsList.map((r) => r.name).join(', ')}] · o‘qish=${liteReadExtra && liteReadExtra.error ? `xato: ${liteReadExtra.error}` : 'ishladi'}`);

  /* ---------------- 15. Ro'yxatdan olib tashlash xavfsiz ---------------- */
  const bogusRemove = await main.ev(`window.api.ideRootsRemove(${JSON.stringify(SECRET)})`);
  const afterBogus = (bogusRemove && bogusRemove.roots) || [];
  const realRemove = await main.ev(`window.api.ideRootsRemove(${JSON.stringify(EXTRA)})`);
  const afterReal = (realRemove && realRemove.roots) || [];
  check('15. «Ro‘yxatdan olib tashlash» xavfsiz: begona yo‘l hech narsani olib tashlamaydi, haqiqiy yo‘l esa ro‘yxatdan chiqadi',
    afterBogus.length === beforeCount && afterReal.length === beforeCount - 1
      && !afterReal.some((r) => norm(r.path) === norm(EXTRA)),
    `begona yo‘ldan keyin=${afterBogus.length}, haqiqiy olib tashlashdan keyin=${afterReal.length} (avval ${beforeCount}), qolganlar=[${afterReal.map((r) => r.name).join(', ')}]`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { main && main.ws.close(); } catch { /* */ }
  try { ide && ide.ws.close(); } catch { /* */ }
  const pid = app && app.pid;
  if (pid) spawnSync('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  if (linkMade) { try { fs.rmdirSync(LINK); } catch { /* */ } }
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(OUTSIDE, { force: true }); } catch { /* */ }
  try { fs.rmSync(EXTRA, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(EXTRA_OUTSIDE, { force: true }); } catch { /* */ }
}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} hujum bloklandi`);
process.exit(failed ? 1 : 0);
