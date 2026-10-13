// ide/test_python_debug.cjs — PYTHON qadamlab debuggerining HAQIQIY sinovi.
//
// Nega `.cjs`: bu sinov Electron'ning MAIN jarayonida yuritiladi (`ipcMain` kerak), va bu
// muhitda Electron `.mjs` ni main skript sifatida umuman ishga tushirmaydi (o'lchandi:
// minimal `.mjs` fayl ham jimgina osilib qoldi). Shu sababli fayl CommonJS, ESM modul esa
// dinamik `import()` bilan olinadi — repo ichidagi boshqa main-jarayon sinovi
// (`ide/test_boot.cjs`) ham shu sababdan `.cjs`.
//
//   ./node_modules/electron/dist/electron.exe ide/test_python_debug.cjs
//
// `ipcMain.handle` bir marta ushlab olinadi — ya'ni sinov IDE chaqiradigan AYNAN o'sha
// kanallarni chaqiradi va HAQIQIY `debugpy` ishga tushadi (soxta natija yo'q).
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HERE = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}
// Bosqichlar jurnali: biror qadam osilib qolsa, sinov "jimgina" qotib qolmasin —
// qaysi chaqiruvda to'xtaganini shu yozuvlardan ko'rish mumkin.
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
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-pydebug-'));
const SCRIPT = [
  'def ekub(a, b):',
  '    while b:',
  '        a, b = b, a % b',
  '    return a',
  '',
  'natija = ekub(48, 18)',
  'print("NATIJA", natija)',
  '',
].join('\n');
fs.writeFileSync(path.join(WS, 'ekub.py'), SCRIPT, 'utf8');

const events = [];
const safePath = (rel) => {
  if (!rel) return null;
  const abs = path.resolve(WS, String(rel));
  const r = path.relative(WS, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  return { abs, rel: abs.slice(WS.length + 1).split(path.sep).join('/') };
};

const pausedEvents = () => events.filter((e) => e.ch === 'yide:debug-paused').map((e) => e.data);
async function waitFor(fn, timeoutMs = 30000, stepMs = 200) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(stepMs);
  }
}

let debugModule = null;
let watchdog = null;
async function main() {
  debugModule = await import(pathToFileURL(path.join(HERE, 'ide_debug.js')).href);
  step('ide_debug.js yuklandi');
  debugModule.registerDebugIpc({ safePath, getWorkspace: () => WS, send: (ch, data) => events.push({ ch, data }) });
  step('IPC kanallari ushlandi');
  await app.whenReady();
  step('ilova tayyor — debug-start chaqirilyapti');

  // 1. Nuqta qo‘yib ishga tushirish — debugpy haqiqatan ko‘tarilishi kerak.
  const started = await call('yide:debug-start', { path: 'ekub.py', breakpoints: [{ path: 'ekub.py', line: 3 }], stopOnEntry: false });
  step(`debug-start qaytdi: ${JSON.stringify(started)}`);
  const first = await waitFor(() => pausedEvents()[0]);
  step(`to‘xtash ${first ? 'keldi' : 'KELMADI'}`);
  check('1. Python debugger ishga tushdi va nuqtada to‘xtadi',
    !!(started && started.ok) && started.language === 'python' && !!first,
    started && started.error
      ? `xato: ${started.error}`
      : `language=${started && started.language}; to‘xtash=${first ? `${first.path}:${first.line}` : 'YO‘Q'}`);

  // 2. To‘xtash joyi va chaqiruv zanjiri (stack).
  check('2. To‘xtash qatori va chaqiruv zanjiri to‘g‘ri',
    !!(first && first.line === 3 && (first.frames || []).length >= 1 && first.frames[0].path === 'ekub.py'),
    first ? `qator=${first.line}, chaqiruvlar=[${(first.frames || []).map((f) => `${f.name}@${f.line}`).join(', ')}]` : 'to‘xtash yo‘q');

  // 3. Lokal o‘zgaruvchilar: birinchi urinishda a=48, b=18 bo‘lishi shart.
  const vars = first ? (first.scopes || []).flatMap((s) => s.vars) : [];
  const a = vars.find((v) => v.name === 'a');
  const b = vars.find((v) => v.name === 'b');
  check('3. Lokal o‘zgaruvchilar ko‘rindi (a=48, b=18)',
    !!a && !!b && String(a.value).trim() === '48' && String(b.value).trim() === '18',
    `o‘zgaruvchilar=[${vars.map((v) => `${v.name}=${v.value}`).slice(0, 8).join(', ')}]`);

  // 4. Qadam (step over) — yangi to‘xtash kelishi kerak.
  const before = pausedEvents().length;
  const stepOver = await call('yide:debug-step', { kind: 'over' });
  const second = await waitFor(() => (pausedEvents().length > before ? pausedEvents()[pausedEvents().length - 1] : null), 20000);
  check('4. Qadam (step over) ishladi — yangi to‘xtash keldi',
    !!(stepOver && stepOver.ok) && !!second,
    stepOver && stepOver.error ? `xato: ${stepOver.error}` : `yangi to‘xtash: ${second ? `qator ${second.line}` : 'YO‘Q'}`);

  // 5. Ifodani baholash (evaluate) — to‘xtagan kontekstda.
  const ev = await call('yide:debug-eval', { expression: '1 + 1' });
  check('5. `evaluate` javob berdi', !!(ev && ev.ok && String(ev.value).trim() === '2'),
    ev && ev.error ? `xato: ${ev.error}` : `1 + 1 = ${ev && ev.value}`);

  // 6. To‘xtatish — sessiya yopilishi va jarayon qolib ketmasligi kerak.
  await call('yide:debug-stop', {});
  await sleep(1200);
  const st = await call('yide:debug-status', {});
  check('6. To‘xtatilgandan keyin sessiya yopildi', !!(st && st.running === false), `running=${st && st.running}`);
}

(async () => {
  watchdog = setTimeout(() => {
    console.log('\nWATCHDOG: test 150 s ichida tugamadi — majburan to‘xtatildi');
    process.exit(1);
  }, 150000);
  try {
    await main();
  } catch (e) {
    check('umumiy oqim', false, `xato: ${e && e.message}`);
  } finally {
    clearTimeout(watchdog);
    try { debugModule && debugModule.disposeDebug(); } catch { /* */ }
    await sleep(600);
    try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ }
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
  app.exit(failed ? 1 : 0);
})();
