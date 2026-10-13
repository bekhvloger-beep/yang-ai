// YANG AI ICHIDAGI IDE — haqiqiy oqim sinovi (CDP orqali).
//
// Nima uchun kerak: kontrakt testi (ide/test_ide_contract.mjs) faqat fayllar bir-biriga
// mos ekanini o'qiydi. U "IDE ilova ichida chindan ochiladimi?" degan savolga javob
// bermaydi — buni faqat haqiqiy jarayon ko'rsatadi. Bu skript YANG AI ni ishga tushiradi,
// yon paneldagi «YANG IDE» tugmasini bosadi va ochilgan IDE oynasini CDP orqali tekshiradi:
// fayl tizimi, terminal, diagnostika, AI qatlami (dinamik ESM import) va xavfsizlik.
//
// Ishga tushirish:
//   YANG_APP_EXE=dev node ide/test_embedded_e2e.mjs      # dev rejim (electron ., lokal kod)
//   YANG_APP_EXE="dist/win-unpacked/YANG AI.exe" node ide/test_embedded_e2e.mjs   # paket (asar)
//
// Paketlangan nusxada bu sinov MUHIM: `ide/ide_host.js` agent modullarini dinamik
// `import()` qiladi, app.asar ichida bu ishlashi alohida tekshirilishi kerak.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '127.0.0.1');
  });
}
async function pickFreePort(start) {
  for (let p = start; p < start + 20; p += 1) if (await portFree(p)) return p;
  throw new Error(`bo‘sh CDP port topilmadi (${start}…${start + 19})`);
}

let PORT = Number(process.env.YANG_CDP_PORT || 9345);
const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YANG AI', 'YANG AI.exe');
// YANG_APP_EXE=dev → majburan dev rejim (o'rnatilgan eski nusxa bilan adashmaslik uchun).
const EXE = process.env.YANG_APP_EXE === 'dev' ? '' : (process.env.YANG_APP_EXE || INSTALLED);
const useExe = !!EXE && fs.existsSync(EXE);
const ELECTRON_BIN = useExe ? EXE : (await import('electron')).default;
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ide-e2e-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ide-ws-'));
const cfgPath = path.join(UD, 'config.json');

fs.writeFileSync(cfgPath, JSON.stringify({
  provider: 'groq', model: '', keys: {}, autoApprove: true, pinMode: false,
  // Tarjimon (NLLB/python) va lokal model sinov uchun shart emas — fon ishlarini o'chiramiz.
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
}, null, 2), 'utf8');

// Sinov ish papkasi: bitta matn fayl, bitta ishga tushadigan fayl, bitta buzuq JS.
fs.writeFileSync(path.join(WS, 'hello.txt'), 'salom yang ide\n', 'utf8');
fs.writeFileSync(path.join(WS, 'hello.js'), "console.log('IDE_TERM_OK');\n", 'utf8');
fs.writeFileSync(path.join(WS, 'bad.js'), 'function ( {\n', 'utf8');

// Yordamchi: tarixda "oxirgi xato" bo'lishi kerak (u AI tuzatish halqasiga uzatiladi).
const lastRunHint = (log) => !!(log && log.lastFailure && log.lastFailure.code !== 0);

const results = [];
const check = (name, ok, evidence) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};
const MARK = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

console.log(`nishon: ${useExe ? EXE : 'dev rejim (npx electron .)'}`);
console.log(`user-data: ${UD}\nish papkasi: ${WS}\nCDP port ${PORT}`);

const hadLlama = spawnSync('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe'], { encoding: 'utf8' }).stdout.includes('llama-server.exe');
// Diqqat: foydalanuvchining o'zi ishga tushirgan ilovasini O'LDIRMAYMIZ — faqat biz
// ko'targan PID daraxtini to'xtatamiz (nom bo'yicha `taskkill /IM` begona nusxalarni ham
// o'chirib qo'yardi).
const pidAlive = (pid) => {
  const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`], { encoding: 'utf8' }).stdout || '';
  return out.includes(String(pid));
};

function freePort(port) {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    if (!new RegExp(`[:.]${port}\\s`).test(line)) continue;
    const m = line.trim().match(/(\d+)$/);
    if (m) pids.add(m[1]);
  }
  for (const pid of pids) spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { stdio: 'ignore' });
  return [...pids];
}

function launch() {
  // `--disable-gpu`: sinov muhitida Electron GPU jarayoni ba'zan yiqilib, renderer javob
  // bermay qolardi ("GPU process exited unexpectedly: exit_code=34") — sinov yolg'on
  // sabab bilan qizil bo'lmasin. Dastur mantig'iga ta'siri yo'q.
  const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'];
  const child = useExe
    ? spawn(EXE, args, { detached: true, stdio: 'ignore' })
    : spawn(ELECTRON_BIN, ['.', ...args], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

// CDP target izlash: asosiy ilova (`renderer/index.html`) va IDE oynasi (`ide/renderer/index.html`).
const MAIN_URL = /renderer[\\/]index\.html/;
const IDE_URL = /ide[\\/]renderer[\\/]index\.html/;
const isMain = (u) => MAIN_URL.test(u) && !IDE_URL.test(u);
const isIde = (u) => IDE_URL.test(u);

async function targetFor(match, excludeId) {
  for (let i = 0; i < 160; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && match(x.url || '') && x.id !== excludeId);
      if (t && t.webSocketDebuggerUrl) return t;
    } catch { /* CDP hali ko'tarilmagan */ }
    await sleep(500);
  }
  throw new Error('CDP target topilmadi');
}

async function attach(match, { excludeId, readyFlag = 'window.__ready', timeoutMs = 90000 } = {}) {
  const target = await targetFor(match, excludeId);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`CDP WebSocket ${target.id.slice(0, 8)} javob bermadi (6 s)`)), 6000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error(`CDP WebSocket ${target.id.slice(0, 8)} xato`)); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params, ms = 30000) => {
    const id = ++seq;
    return new Promise((res) => {
      const timer = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(timer); res(m); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.__timeout) throw new Error('CDP javob bermadi: ' + String(expression).slice(0, 70));
    if (r.result && r.result.exceptionDetails) {
      throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await ev(readyFlag).catch(() => undefined)) === true) break;
    await sleep(400);
  }
  return { send, ev, target };
}

const watchdog = setTimeout(() => {
  console.log('FAIL  umumiy: 360 s ichida tugamadi');
  spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  process.exit(1);
}, 360000);

freePort(PORT);
PORT = await pickFreePort(PORT);
let main = null;
let ide = null;
let mainTitleBefore = null;
const app = launch();
try {
  MARK('YANG AI ishga tushirildi');
  main = await attach(isMain);
  mainTitleBefore = await main.ev('document.title').catch(() => null);
  MARK(`asosiy oyna CDP'da · __ready=${await main.ev('window.__ready')} · sarlavha="${mainTitleBefore}"`);

  // 1. Tugma bormi (foydalanuvchi IDE ni shu yerdan topadi).
  const btn = await main.ev(`(() => {
    const b = document.getElementById('openIdeBtn');
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    return { found: true, text: b.textContent.trim(), visible: r.width > 0 && r.height > 0, api: typeof window.api.openIde };
  })()`);
  check('1. Asosiy oynada «YANG IDE» tugmasi ko‘rinadi va ko‘prik ulangan',
    !!btn.found && btn.visible === true && btn.api === 'function',
    `matn="${btn.text}", ko'rinadi=${btn.visible}, window.api.openIde=${btn.api}`);

  // 2. Bosilganda haqiqiy IDE oynasi ochiladi (renderer → preload → main → yangi oyna).
  await main.ev(`(() => { document.getElementById('openIdeBtn').click(); return true; })()`);
  MARK('tugma bosildi — IDE oynasi kutilmoqda');
  ide = await attach(isIde, { readyFlag: 'typeof window.ide === "object" && !!document.getElementById("fileTree")' });
  const dom = await ide.ev(`({
    title: document.title,
    hasEditor: !!document.getElementById('editorArea'),
    hasTerm: !!document.getElementById('termOut'),
    hasAi: !!document.getElementById('aiInput'),
  })`);
  check('2. «YANG IDE» tugmasi IDE oynasini ochadi (alohida oyna, o‘z renderer’i)',
    dom.title === 'YANG IDE' && dom.hasEditor && dom.hasTerm && dom.hasAi,
    `sarlavha="${dom.title}", muharrir=${dom.hasEditor}, terminal=${dom.hasTerm}, AI panel=${dom.hasAi}`);

  // 3. Yadro AYNAN YANG AI jarayonida ishlayapti (alohida exe emas).
  const sys = await ide.ev('window.ide.sysInfo()');
  check('3. IDE yadrosi YANG AI jarayonida ishlaydi (embedded=true)',
    !!sys && sys.embedded === true && !!sys.version,
    `embedded=${sys && sys.embedded}, versiya=${sys && sys.version}, electron=${sys && sys.electron}, ram=${sys && sys.ramMb} MB`);

  // 4. Ish papkasi + fayl tizimi (o'qish/saqlash).
  const opened = await ide.ev(`window.ide.openFolder(${JSON.stringify(WS)})`);
  const tree = await ide.ev('window.ide.listTree(".", 2)');
  const read = await ide.ev('window.ide.readFile("hello.txt")');
  const wrote = await ide.ev('window.ide.writeFile("hello.txt", "salom yang ide\\nyangi qator\\n")');
  const readBack = await ide.ev('window.ide.readFile("hello.txt")');
  const names = (tree.entries || []).map((e) => e.path).sort();
  check('4. Fayl tizimi: papka ochish, daraxt, o‘qish va saqlash',
    opened.path === WS && names.includes('hello.txt') && String(read.text).includes('salom yang ide')
    && wrote.ok === true && String(readBack.text).includes('yangi qator'),
    `papka=${path.basename(opened.path || '')}, daraxt=[${names.join(', ')}], saqlandi=${wrote.ok}, qayta o‘qildi=${String(readBack.text || '').trim().split('\n').pop()}`);

  // 5. Xavfsizlik: ish papkasidan tashqariga chiqish rad etiladi.
  const escape = await ide.ev('window.ide.readFile("../tashqari.txt")');
  const abs = await ide.ev('window.ide.readFile("C:/Windows/win.ini")');
  check('5. Xavfsizlik: `..` va absolyut yo‘l rad etiladi',
    !!escape.error && !!abs.error,
    `"../" → ${escape.error}; absolyut → ${abs.error}`);

  // 6. Terminal: faylni ishga tushirib, chiqishi renderer'gacha oqib keladi.
  await ide.ev(`(() => { window.__e2eExit = null; window.ide.onTermExit((d) => { window.__e2eExit = d; }); return true; })()`);
  const run = await ide.ev('window.ide.runFile("hello.js")');
  let termText = '';
  let exitInfo = null;
  for (let i = 0; i < 60; i++) {
    termText = (await ide.ev('document.getElementById("termOut").textContent')) || '';
    exitInfo = await ide.ev('window.__e2eExit');
    if (termText.includes('IDE_TERM_OK') && exitInfo) break;
    await sleep(500);
  }
  check('6. Terminal: faylni ishga tushirib chiqishini ko‘rsatadi',
    termText.includes('IDE_TERM_OK') && !!exitInfo,
    `buyruq="${run.command || run.error}"; chiqishda "IDE_TERM_OK" ${termText.includes('IDE_TERM_OK') ? 'bor' : 'YO\'Q'}; chiqish hodisasi=${exitInfo ? 'code ' + exitInfo.code : 'kuzatilmadi'}`);

  // 7. Diagnostika (lite-LSP): buzuq JS fayl qator raqami bilan xato beradi.
  const diag = await ide.ev('window.ide.diagnostics("bad.js")');
  const diagMsg = String((diag.items && diag.items[0] && diag.items[0].message) || '');
  check('7. Diagnostika: buzuq `bad.js` uchun qator raqamli sintaksis xatosi',
    !!diag.items && diag.items.length > 0 && Number.isFinite(diag.items[0].line) && diag.items[0].line >= 1
    && /SyntaxError|Unexpected/i.test(diagMsg),
    diag.items && diag.items.length
      ? `${diag.items[0].line}-qator: ${diagMsg.slice(0, 80)}`
      : `xato qaytmadi (izoh: ${diag.note || '—'})`);

  // 8. AI qatlami: YANG AI sozlamalari dinamik import bilan yuklanadi.
  //    (asar ichida bu ishlamasa — paketda AI, fayl yozish va buyruq bajarish yo'qoladi.)
  const ai = await ide.ev('window.ide.aiStatus()');
  const aiOk = !!ai && !ai.error && typeof ai.provider === 'string' && Array.isArray(ai.providers);
  check('8. AI qatlami: agent modullari dinamik import bo‘ladi (paketda ham)',
    aiOk,
    aiOk ? `provayder=${ai.provider || '—'} model=${ai.model || '—'} · ${ai.providers.length} provayder · sozlamalar=${ai.sharedConfig}`
      : `xato: ${ai && ai.error}`);

  // 9. HAQIQIY TERMINAL (PTY): interaktiv dastur o'zini terminal deb biladimi?
  const ptyInfo = await ide.ev('window.ide.ptyInfo()');
  let ttyOut = '';
  if (ptyInfo && ptyInfo.available) {
    const session = await ide.ev(`window.ide.ptyOpen({ cols: 100, rows: 30, cwd: ${JSON.stringify(WS)} })`);
    if (session && session.id) {
      await ide.ev(`(() => { window.__pty = ''; window.ide.onPtyData((d) => { if (d.chunk) window.__pty += d.chunk; }); return true; })()`);
      // Isatty: quvur (pipe) rejimida False, haqiqiy PTY da True bo'ladi.
      const ttyCmd = 'python -c "import sys; print(\'TTY_OK\' if sys.stdout.isatty() else \'PIPE\')"\r';
      await ide.ev(`window.ide.ptyWrite(${JSON.stringify(session.id)}, ${JSON.stringify(ttyCmd)})`);
      for (let i = 0; i < 40; i++) {
        ttyOut = (await ide.ev('window.__pty')) || '';
        if (ttyOut.includes('TTY_OK') || ttyOut.includes('PIPE')) break;
        await sleep(400);
      }
      await ide.ev(`window.ide.ptyClose(${JSON.stringify(session.id)})`);
    }
  }
  check('9. Haqiqiy terminal (PTY): interaktiv dastur isatty=true ko‘radi (vim/top/ssh mumkin)',
    !!(ptyInfo && ptyInfo.available) && ttyOut.includes('TTY_OK'),
    ptyInfo && ptyInfo.available
      ? `shell=${ptyInfo.shell}; isatty natijasi=${ttyOut.includes('TTY_OK') ? 'TTY_OK (haqiqiy psevdo-terminal)' : JSON.stringify(ttyOut.slice(-60))}`
      : `PTY mavjud emas: ${ptyInfo && ptyInfo.reason}`);

  // 10. TIL XIZMATI (tsserver): semantik xato, haqiqiy ta'rif, havolalar, hover.
  const lspText = 'function salomlash(nom) {\n  return "Salom, " + nom;\n}\nconst x = yoqFunksiya(1);\nsalomlash("dunyo");\nsalomlash(5);\n';
  fs.writeFileSync(path.join(WS, 'lsp.js'), lspText, 'utf8');
  const lspStatus = await ide.ev('window.ide.lspStatus()');
  const lspDiag = await ide.ev(`window.ide.lspDiagnostics('lsp.js', ${JSON.stringify(lspText)})`);
  const diagHit = ((lspDiag && lspDiag.items) || []).find((d) => /yoqFunksiya/.test(d.message));
  const lspDef = await ide.ev(`window.ide.lspDefinition('lsp.js', 5, 3, ${JSON.stringify(lspText)})`);
  const def = ((lspDef && lspDef.items) || [])[0];
  const lspRefs = await ide.ev(`window.ide.lspReferences('lsp.js', 1, 11, ${JSON.stringify(lspText)})`);
  const lspHover = await ide.ev(`window.ide.lspHover('lsp.js', 1, 11, ${JSON.stringify(lspText)})`);
  check('10. Til xizmati: semantik xato + haqiqiy ta’rif + havolalar + hover',
    !!(lspStatus && lspStatus.available) && !!diagHit && !!(def && def.path) && ((lspRefs.items || []).length >= 2)
    && !!(lspHover && lspHover.text),
    `tsserver=${lspStatus && lspStatus.available}; semantik xato: ${diagHit ? `Ln ${diagHit.line}: ${diagHit.message}` : 'YO\'Q'}; `
    + `F12 → ${def ? `${def.path}:${def.line}` : 'yo\'q'}; Shift+F12 → ${(lspRefs.items || []).length} havola; hover="${String((lspHover && lspHover.text) || '').split('\n')[0].slice(0, 40)}"`);

  // 11. QADAMLAB DEBUGGER: nuqta qo'yib to'xtash, stack va o'zgaruvchilarni ko'rish.
  fs.writeFileSync(path.join(WS, 'dbg.js'),
    'function qosh(a, b) {\n  const natija = a + b;\n  return natija;\n}\nconsole.log("NATIJA", qosh(2, 3));\n', 'utf8');
  await ide.ev(`(() => { window.__dbg = null; window.ide.onDebugPaused((d) => { window.__dbg = d; }); return true; })()`);
  const dbgStart = await ide.ev(`window.ide.debugStart('dbg.js', [{ path: 'dbg.js', line: 2 }], false)`);
  let paused = null;
  for (let i = 0; i < 40; i++) {
    paused = await ide.ev('window.__dbg');
    if (paused) break;
    await sleep(500);
  }
  const varNames = ((paused && paused.scopes) || []).flatMap((s) => s.vars.map((v) => v.name));
  const frames = (paused && paused.frames) || [];
  await ide.ev('window.ide.debugStop()');
  check('11. Debugger: nuqtada to‘xtadi, chaqiruv zanjiri va o‘zgaruvchilar ko‘rindi',
    !!(dbgStart && dbgStart.ok) && !!paused && paused.line === 2 && frames.length >= 2 && varNames.includes('a') && varNames.includes('b'),
    `start=${dbgStart && (dbgStart.ok ? `port ${dbgStart.port}` : dbgStart.error)}; to‘xtadi: ${paused ? `${paused.path}:${paused.line}` : 'YO\'Q'}; `
    + `chaqiruvlar=${frames.length}; o‘zgaruvchilar=[${varNames.slice(0, 6).join(', ')}]`);

  // 12. TARIX (log): har yurish yozib boriladi va xato kodi saqlanadi.
  fs.writeFileSync(path.join(WS, 'buzuq.js'), 'console.log("ISHLAYDI");\nthrow new Error("ataylab xato");\n', 'utf8');
  const badRun = await ide.ev("window.ide.runCaptured('buzuq.js')");
  const log = await ide.ev('window.ide.runLog()');
  const logged = ((log && log.runs) || []).find((r) => r.path === 'buzuq.js');
  check('12. Tarix (log): yurish buyruq/chiqish kodi bilan saqlanadi (AI tuzatishi uchun asos)',
    !!(badRun && badRun.code !== 0) && !!logged && logged.code === badRun.code && /ataylab xato/.test(String(logged.output || ''))
    && !!lastRunHint(log),
    `kod=${badRun && badRun.code}; logda: ${logged ? `kod ${logged.code}, ${String(logged.output || '').trim().split('\n').pop().slice(0, 60)}` : 'YO\'Q'}; oxirgi xato=${(log && log.lastFailure && log.lastFailure.path) || '—'}`);

  // 13. TAHRIR CHEGARASI YO‘Q: 3 MB dan katta fayl ochiladi, muharrirga tushadi, tahrir
  //     qilinadi va saqlanadi. Ilgari 2 MB dan katta fayl UMUMAN ochilmasdi — bu aynan
  //     tuzatilgan cheklov, shuning uchun uni matn emas, HAQIQIY o‘qish/yozish bilan tekshiramiz.
  const bigLine = 'QATOR-' + 'A'.repeat(58) + '\n';                 // 65 bayt
  const bigText = bigLine.repeat(Math.ceil((3 * 1024 * 1024) / 65) + 1);
  fs.writeFileSync(path.join(WS, 'katta.txt'), bigText, 'utf8');
  const bigDisk = fs.statSync(path.join(WS, 'katta.txt')).size;
  const bigRead = await ide.ev("window.ide.readFile('katta.txt')");
  // Muharrir haqiqatan ko‘tara oladimi: daraxtdan bosib ochamiz.
  let bigInEditor = 0;
  for (let i = 0; i < 20; i++) {
    bigInEditor = await ide.ev(`(async () => {
      const row = [...document.querySelectorAll('#fileTree .tree-row')].find((r) => r.textContent.includes('katta.txt'));
      if (!row) return 0;
      row.click();
      await new Promise((r) => setTimeout(r, 600));
      return document.getElementById('editorArea').value.length;
    })()`);
    if (bigInEditor >= bigText.length) break;
    await sleep(500);
  }
  const editedBig = `${bigText}Tahrir qilindi\n`;
  const bigWrite = await ide.ev(`window.ide.writeFile('katta.txt', ${JSON.stringify(editedBig)})`);
  const afterBig = fs.statSync(path.join(WS, 'katta.txt')).size;
  check('13. Tahrir chegarasi yo‘q: 3 MB fayl ochiladi, muharrirga tushadi, tahrir qilinadi va saqlanadi',
    !!(bigRead && !bigRead.error && !bigRead.truncated) && bigRead.text.length === bigText.length
    && bigInEditor >= bigText.length
    && !!(bigWrite && !bigWrite.error) && afterBig === Buffer.byteLength(editedBig, 'utf8') && afterBig > bigDisk,
    `diskda=${(bigDisk / 1048576).toFixed(2)} MB · o‘qildi=${((bigRead && bigRead.text) || '').length} belgi (truncated=${bigRead && bigRead.truncated}) · `
    + `muharrirda=${bigInEditor} belgi · saqlangandan keyin=${(afterBig / 1048576).toFixed(2)} MB`);

  // 14. IDE oynasi yopilganda asosiy ilova yashab qoladi.
  try { await ide.send('Target.closeTarget', { targetId: ide.target.id }); } catch {}
  await sleep(2000);
  let stillAlive = await main.ev('document.title').catch(() => null);
  if (stillAlive !== mainTitleBefore) {
    // Ba'zi muhitlarda closeTarget ishlamasligi mumkin — oynaning o'zi yopsin.
    try { await ide.ev('window.close(); true'); } catch {}
    await sleep(1500);
    stillAlive = await main.ev('document.title').catch(() => null);
  }
  const ideGone = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.json()).then((l) => !l.some((x) => isIde(x.url || ''))).catch(() => null);
  check('14. IDE oynasi yopilsa asosiy ilova ishlashda davom etadi',
    stillAlive === mainTitleBefore && ideGone !== false,
    `asosiy oyna sarlavhasi="${stillAlive}" (kutilgan "${mainTitleBefore}"), IDE target yopildi=${ideGone}`);

  // 15. ASOSIY ILOVANING YON PANELI — o'zining haqiqiy terminali (xterm + PTY).
  //     Bu IDE oynasidan ALOHIDA yo'l: asosiy renderer → preload → main → ConPTY.
  const sidePtyInfo = await main.ev('typeof window.api.ptyInfo === "function" ? window.api.ptyInfo() : null');
  await main.ev('(() => { const b = document.getElementById("ideToggle"); if (b) b.click(); return true; })()');
  let xtermMounted = false;
  let sideSessions = [];
  for (let i = 0; i < 30; i++) {
    xtermMounted = await main.ev('!!document.querySelector("#ideXtermHost .xterm")').catch(() => false);
    sideSessions = (await main.ev('window.api.ptyList()').catch(() => [])) || [];
    if (xtermMounted && sideSessions.length) break;
    await sleep(500);
  }
  let sideEcho = '';
  if (sideSessions.length && sideSessions[0] && sideSessions[0].id) {
    await main.ev('(() => { window.__ptyCap = ""; window.api.onPtyData((d) => { if (d && d.chunk) window.__ptyCap += d.chunk; }); return true; })()');
    // `String.fromCharCode(13,10)` — Enter. Bu yerda escape bilan yozilgan `\r\n`
    // sahifa ifodasida haqiqiy satr uzilishiga aylanib, SyntaxError berardi (o‘lchandi).
    await main.ev(`window.api.ptyWrite(${JSON.stringify(sideSessions[0].id)}, "echo SIDE_TTY_OK" + String.fromCharCode(13, 10))`);
    for (let i = 0; i < 30; i++) {
      sideEcho = (await main.ev('window.__ptyCap').catch(() => '')) || '';
      if (sideEcho.includes('SIDE_TTY_OK')) break;
      await sleep(400);
    }
  }
  check('15. Asosiy oynaning yon paneli: haqiqiy terminal (xterm + PTY) buyruqni bajaradi',
    !!(sidePtyInfo && sidePtyInfo.available) && xtermMounted && sideSessions.length >= 1 && sideEcho.includes('SIDE_TTY_OK'),
    `ptyInfo.available=${sidePtyInfo && sidePtyInfo.available}; xterm o‘rnatildi=${xtermMounted}; sessiyalar=${sideSessions.length}; `
    + `echo=${sideEcho.includes('SIDE_TTY_OK') ? 'SIDE_TTY_OK' : JSON.stringify(String(sideEcho).slice(-70))}`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  clearTimeout(watchdog);
  try { main && main.send('Browser.close', {}); } catch {}
  const pid = app && app.pid;
  for (let i = 0; i < 20 && pid && pidAlive(pid); i++) await sleep(500);
  if (pid && pidAlive(pid)) {
    spawnSync('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore' });
    await sleep(800);
  }
  if (!hadLlama) spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
