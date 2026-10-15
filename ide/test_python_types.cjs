// ide/test_python_types.cjs — PYTHON TO‘LIQ TIP TEKSHIRUVI sinovi.
//
// Ilgari Python uchun faqat `pyflakes` (aniqlanmagan nom / ishlatilmagan import) bor edi —
// TUR xatosi (`natija: str = ikki(2)`) umuman ko‘rinmasdi. Endi `ide_lsp.js` zinapoya
// ishlatadi: pyright → mypy → pyflakes → yo‘q. Bu sinov zinapoyaning HAQIQIY ishlashini
// o‘lchaydi, faqat kodni o‘qib «bor» demaydi.
//
// Nega `.cjs`: sinov Electron’ning MAIN jarayonida yuritiladi (`ipcMain` kerak) va bu
// muhitda Electron `.mjs` ni main skript sifatida ishga tushirmaydi — `ide/test_boot.cjs`
// va `ide/test_python_debug.cjs` ham shu sababdan CommonJS.
//
// Ikki rejim:
//   YANG_TYPES_MODE=full      (sukut) — kuchli vosita (mypy/pyright) bor deb kutiladi;
//   YANG_TYPES_MODE=degraded  — vosita YO‘Q deb kutiladi: IDE yiqilmasligi va yolg‘on xato
//                               ko‘rsatmasligi shart (bu holat `YANG_IDE_PYTHON` bilan
//                               soxtalashtiriladi, ya’ni mavjud mypy ham ko‘rinmaydi).
//
//   ./node_modules/electron/dist/electron.exe ide/test_python_types.cjs
//
// Chiqish: `XULOSA: N/N PASS` va exit code 0/1 — shu asosda CI yoki qo‘lda tekshiriladi.
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HERE = __dirname;
const MODE = String(process.env.YANG_TYPES_MODE || 'full').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}
const T0 = Date.now();
const step = (s) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);

/* ------------------------------- IPC handler'larni ushlab olamiz */
const handlers = new Map();
const realHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => {
  handlers.set(channel, fn);
  return realHandle(channel, fn);
};
const call = (channel, args = {}) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`${channel} handler topilmadi`);
  return fn({ sender: null }, args);
};

/* ------------------------------------------------------- sinov maydoni */
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-pytypes-'));

// 1. TUR XATOSI + aniqlanmagan nom bir faylda.
const BAD = [
  'def ikki(x: int) -> int:',
  '    return x * 2',
  '',
  '',
  'natija: str = ikki(2)',
  'yoqFunksiya()',
  '',
].join('\n');
// 2. To‘g‘ri fayl — yolg‘on xato chiqmasligi kerak.
const GOOD = [
  'def ikki(x: int) -> int:',
  '    return x * 2',
  '',
  '',
  'natija: int = ikki(2)',
  'print(natija)',
  '',
].join('\n');
fs.writeFileSync(path.join(WS, 'buzuq.py'), BAD, 'utf8');
fs.writeFileSync(path.join(WS, 'togri.py'), GOOD, 'utf8');

// `ide_host.js` uzatadigan ko‘rinishdagi guard (bu sinovda bitta ildiz yetarli).
const safePath = (rel) => {
  if (!rel) return null;
  const abs = path.resolve(WS, String(rel));
  const r = path.relative(WS, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  return { abs, rel: r.split(path.sep).join('/'), root: WS };
};

let lspModule = null;
let watchdog = null;
async function main() {
  lspModule = await import(pathToFileURL(path.join(HERE, 'ide_lsp.js')).href);
  step('ide_lsp.js yuklandi');
  lspModule.registerLspIpc({ safePath, getWorkspace: () => WS });
  step('LSP IPC kanallari ushlandi');
  await app.whenReady();
  step(`ilova tayyor — rejim: ${MODE}`);

  const status = await call('yide:lsp-status');
  const engine = (status && status.python && status.python.engine) || null;
  step(`status.python.engine=${engine} · pyflakes=${status && status.python && status.python.pyflakes}`);

  if (MODE === 'degraded') {
    check('1. Vosita yo‘q bo‘lsa holat buni ANIQ aytadi (engine=null)',
      engine === null && !!(status && status.python && status.python.pyflakes === false),
      `engine=${engine}, pyflakes=${status && status.python && status.python.pyflakes}`);
    const bad = await call('yide:lsp-diagnostics', { path: 'buzuq.py', text: BAD });
    check('2. Vosita yo‘q bo‘lsa IDE yiqilmaydi va yolg‘on xato ko‘rsatmaydi',
      !!(bad && Array.isArray(bad.items) && bad.items.length === 0 && bad.engine === null && typeof bad.note === 'string' && bad.note.length > 0),
      `items=${bad && bad.items && bad.items.length}, engine=${bad && bad.engine}, note="${(bad && bad.note) || ''}"`);
    const good = await call('yide:lsp-diagnostics', { path: 'togri.py', text: GOOD });
    check('3. To‘g‘ri fayl ham xatosiz qoladi (sintaksis rejimi)',
      !!(good && Array.isArray(good.items) && good.items.length === 0),
      `items=${good && good.items && good.items.length}`);
    return;
  }

  check('1. Til xizmati kuchli Python dvigatelini tanladi (mypy yoki pyright)',
    engine === 'mypy' || engine === 'pyright',
    engine ? `engine=${engine}` : 'engine=null — pyright/mypy o‘rnatilmagan (pip install mypy yoki pip install pyright)');

  const t1 = Date.now();
  const bad = await call('yide:lsp-diagnostics', { path: 'buzuq.py', text: BAD });
  const took = ((Date.now() - t1) / 1000).toFixed(1);
  const items = (bad && bad.items) || [];
  step(`buzuq.py tahlil qilindi: ${items.length} ta muammo (${took}s)`);
  for (const it of items.slice(0, 6)) console.log(`        · ${it.line}:${it.col} [${it.source}] ${it.message}`);

  check('2. Diagnostika dvigateli holat bilan bir xil',
    !!(bad && bad.engine === engine), `diagnostika engine=${bad && bad.engine}, status engine=${engine}`);

  const typeErr = items.find((d) => d.line === 5 && /str|int|Incompatible|assignment/i.test(d.message));
  check('3. TUR XATOSI topildi (`natija: str = ikki(2)` — int→str)',
    !!typeErr, typeErr ? `${typeErr.line}:${typeErr.col} ${typeErr.message}` : `topilmadi: ${JSON.stringify(items.map((d) => `${d.line}: ${d.message}`)).slice(0, 400)}`);

  const nameErr = items.find((d) => /yoqFunksiya|not defined|name-defined|Name "/i.test(d.message));
  check('4. Aniqlanmagan nom ham topildi (pyflakes buni ham topardi — zinapoya pasaymadi)',
    !!nameErr, nameErr ? `${nameErr.line}:${nameErr.col} ${nameErr.message}` : 'topilmadi');

  const linesOk = items.length > 0 && items.every((d) => d.line >= 1 && d.line <= 6 && d.col >= 1);
  const sources = [...new Set(items.map((d) => d.source))];
  check('5. Qator/ustun raqamlari 1-asosli, fayl ichida va manba belgilangan',
    linesOk && sources.length === 1 && sources[0] === engine,
    `qatorlar=[${items.map((d) => `${d.line}:${d.col}`).join(', ')}], manba=[${sources.join(', ')}]`);

  const good = await call('yide:lsp-diagnostics', { path: 'togri.py', text: GOOD });
  check('6. To‘g‘ri fayl uchun YOLG‘ON xato chiqmaydi',
    !!(good && Array.isArray(good.items) && good.items.length === 0),
    `items=${good && good.items && good.items.length}${good && good.items && good.items.length ? ` (${good.items.map((d) => d.message).join(' | ').slice(0, 200)})` : ''}`);
}

(async () => {
  watchdog = setTimeout(() => {
    console.log('\nWATCHDOG: sinov 240 s ichida tugamadi — majburan to‘xtatildi');
    process.exit(1);
  }, 240000);
  try {
    await main();
  } catch (e) {
    check('umumiy oqim', false, `xato: ${e && e.message}`);
  } finally {
    clearTimeout(watchdog);
    try { lspModule && lspModule.disposeLsp(); } catch { /* */ }
    await sleep(400);
    try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ }
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS (rejim: ${MODE})`);
  app.exit(failed ? 1 : 0);
})();
