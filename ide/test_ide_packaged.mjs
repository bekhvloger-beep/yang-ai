// ide/test_ide_packaged.mjs — PAKETLANGAN (asar) YANG IDE nusxasini sinash.
//
// Nima uchun kerak: `ide/test_boot.cjs` repozitoriydagi `electron` bilan yuritiladi, ya'ni u
// manba kodni o‘lchaydi. Paketda esa hamma narsa `app.asar` ichidan o‘qiladi va ba’zi qatlamlar
// boshqacha ishlaydi (dinamik `import()`, native `conpty.node`, `tsserver` yo‘li). Ilgari
// paketlangan IDE umuman sinalmagan edi — bu skript aynan shuni yopadi:
//
//   node ide/test_ide_packaged.mjs                       # dist-ide/win-unpacked/YANG IDE.exe
//   YANG_IDE_EXE="dist-ide/win-unpacked/YANG IDE.exe" node ide/test_ide_packaged.mjs
//
// Tekshiriladi: oyna ochilishi, fayl daraxti/o‘qish/yozish, haqiqiy PTY (`isatty`), til xizmati
// (semantik xato), ko‘p ildizli workspace (chip + qo‘shimcha papkadagi fayl) va AI qatlami
// (agent modullari asar ichidan dinamik import bo‘ladimi).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.resolve(ROOT, process.env.YANG_IDE_EXE || path.join('dist-ide', 'win-unpacked', 'YANG IDE.exe'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}

if (!fs.existsSync(EXE)) {
  console.log(`SKIP: paket topilmadi — ${EXE}\n      Avval: npm run dist:ide`);
  process.exit(0);
}

function portFree(port) {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '127.0.0.1');
  });
}
async function pickFreePort(start) {
  for (let p = start; p < start + 30; p += 1) if (await portFree(p)) return p;
  throw new Error('bo‘sh CDP port topilmadi');
}

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ide-pkg-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ide-pkg-ws-'));
const EXTRA = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ide-pkg-extra-'));
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ extraRoots: [EXTRA] }, null, 2), 'utf8');
fs.writeFileSync(path.join(UD, 'ide-state.json'), JSON.stringify({ lastWorkspace: WS, recent: [WS] }), 'utf8');
// Buzuq havola (`yoqFunksiya`) — til xizmati sinovi uchun matn bir joyda saqlanadi: fayl
// boshqa tekshiruvlarda qayta yoziladi, shuning uchun matnni fayldan QAYTA o‘qib bo‘lmaydi.
const BAD_TEXT = "function salomlash(nom) {\n  return 'Salom, ' + nom;\n}\nconsole.log(salomlash('paket'));\nconst x = yoqFunksiya(1);\n";
fs.writeFileSync(path.join(WS, 'salom.js'), BAD_TEXT, 'utf8');
fs.writeFileSync(path.join(EXTRA, 'qoshimcha.js'), 'export const qiymat = 42;\n', 'utf8');

const PORT = await pickFreePort(9331);
const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], { detached: true, stdio: 'ignore' });
app.unref();
console.log(`nishon: ${EXE}\nuser-data: ${UD}\nish papkasi: ${WS}\nqo‘shimcha papka: ${EXTRA}\nCDP port ${PORT}`);

let ws = null;
let target = null;
let sendRaw = null;                 // CDP’ga xom buyruq (masalan `Page.captureScreenshot`)
async function attach(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && /ide[\\/]renderer[\\/]index\.html/.test(x.url || '') && x.webSocketDebuggerUrl);
      if (t) { target = t; break; }
    } catch { /* CDP hali ko‘tarilmagan */ }
    await sleep(500);
  }
  if (!target) throw new Error('IDE oynasi CDP’da topilmadi (paket ochilmadi?)');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP ulanish vaqti tugadi')), 10000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP xatosi')); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  // Xom CDP buyruqi (surat uchun): javob `Runtime.evaluate` shaklida emas, shuning uchun alohida.
  sendRaw = (method, params = {}, ms = 8000) => new Promise((res) => {
    const id = ++seq;
    const t = setTimeout(() => res(null), ms);
    pending.set(id, (m) => { clearTimeout(t); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return async (expression, ms = 60000) => {
    const id = ++seq;
    const r = await new Promise((res) => {
      const t = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(t); res(m); });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (r.__timeout) throw new Error(`CDP javob bermadi: ${String(expression).slice(0, 60)}`);
    if (r.result && r.result.exceptionDetails) throw new Error(`JS xato: ${JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 180)}`);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
}

let ev = null;
try {
  ev = await attach();
  const boot = await ev('(async () => { const i = await window.ide.init(); return { hasIde: typeof window.ide === "object", ws: i && i.workspace, roots: (i && i.roots) || [] }; })()');
  check('1. Paketlangan IDE ochiladi va ish papkasini tiklaydi',
    !!(boot && boot.hasIde && boot.ws && boot.ws.path), `ish papkasi=${boot && boot.ws && boot.ws.path} · ildizlar=${(boot && boot.roots || []).map((r) => r.name).join(', ')}`);

  // Mustaqil IDE paketining O‘Z versiyasi bor (paketdagi `package.json` → `yang-ide`), u ilova
  // versiyasidan (5.x) farq qiladi — shu sabab kutilgan qiymat paketdagi fayldan olinadi.
  // Paket ikki ko‘rinishda bo‘lishi mumkin: `app.asar` ichida (asar: true) yoki ochiq papkada
  // (asar: false) — ikkalasidan ham o‘qiy olamiz, shunda sinov paketlash usuliga bog‘lanmaydi.
  function readPackagedIdePkg() {
    const resources = path.join(path.dirname(EXE), 'resources');
    const plain = path.join(resources, 'app', 'package.json');
    if (fs.existsSync(plain)) return { src: 'resources/app/package.json', pkg: JSON.parse(fs.readFileSync(plain, 'utf8')) };
    const asarPath = path.join(resources, 'app.asar');
    if (fs.existsSync(asarPath)) {
      const { extractFile } = require('@electron/asar');
      return { src: 'resources/app.asar → package.json', pkg: JSON.parse(extractFile(asarPath, 'package.json').toString('utf8')) };
    }
    return null;
  }
  const packaged = readPackagedIdePkg();
  const idePkg = packaged && packaged.pkg;
  const sys = await ev('window.ide.sysInfo()');
  check('2. Mustaqil rejim (embedded=false) va versiya paketdan olinadi',
    !!(idePkg && sys && sys.embedded === false && sys.version === idePkg.version),
    `embedded=${sys && sys.embedded} · versiya=${sys && sys.version} (paketda: ${idePkg ? idePkg.version : '—'}, manba: ${packaged ? packaged.src : 'topilmadi'}) · electron=${sys && sys.electron}`);

  const tree = await ev('window.ide.listTree(".", 2)');
  const names = ((tree && tree.entries) || []).map((e) => e.rel || e.path);
  const readBack = await ev("window.ide.readFile('salom.js')");
  const writeBack = await ev("window.ide.writeFile('salom.js', 'console.log(\"paket yozdi\");\\n')");
  const onDisk = fs.readFileSync(path.join(WS, 'salom.js'), 'utf8');
  check('3. Fayl tizimi asar ichida ishlaydi: daraxt, o‘qish, yozish',
    !!(tree && !tree.error) && names.includes('salom.js') && !!(readBack && !readBack.error) && /salomlash/.test(String(readBack.text || ''))
      && !!(writeBack && !writeBack.error) && /paket yozdi/.test(onDisk),
    `daraxt=[${names.slice(0, 5).join(', ')}] · o‘qish=${readBack && !readBack.error ? `${String(readBack.text).length} belgi` : `xato: ${readBack && readBack.error}`} · diskda="${onDisk.trim().slice(0, 40)}"`);

  // Haqiqiy PTY: native `conpty.node` asar ichidan topilishi kerak (dev’da ishlaydi, paketda
  // tushib qolsa jim ishlamay qolardi).
  const ptyInfo = await ev('window.ide.ptyInfo()');
  let ttyText = '';
  if (ptyInfo && ptyInfo.available) {
    const session = await ev(`window.ide.ptyOpen({ cols: 100, rows: 30, cwd: ${JSON.stringify(WS)} })`);
    if (session && session.id) {
      await ev('(() => { window.__pty = ""; window.ide.onPtyData((d) => { if (d.chunk) window.__pty += d.chunk; }); return true; })()');
      await ev(`window.ide.ptyWrite(${JSON.stringify(session.id)}, 'python -c "import sys; print(\\'PKG_TTY_OK\\' if sys.stdout.isatty() else \\'PIPE\\')"' + String.fromCharCode(13, 10))`);
      for (let i = 0; i < 40; i++) {
        ttyText = (await ev('window.__pty')) || '';
        if (ttyText.includes('PKG_TTY_OK') || ttyText.includes('PIPE')) break;
        await sleep(400);
      }
      await ev(`window.ide.ptyClose(${JSON.stringify(session.id)})`);
    }
  }
  check('4. Haqiqiy terminal paketda ham ishlaydi (native conpty topildi, isatty=true)',
    !!(ptyInfo && ptyInfo.available) && ttyText.includes('PKG_TTY_OK'),
    ptyInfo && ptyInfo.available ? `shell=${ptyInfo.shell} · isatty=${ttyText.includes('PKG_TTY_OK') ? 'PKG_TTY_OK' : JSON.stringify(ttyText.slice(-60))}` : `PTY yo‘q: ${ptyInfo && ptyInfo.reason}`);

  const lspStatus = await ev('window.ide.lspStatus()');
  fs.writeFileSync(path.join(WS, 'salom.js'), BAD_TEXT, 'utf8');
  const diag = await ev(`window.ide.lspDiagnostics('salom.js', ${JSON.stringify(BAD_TEXT)})`);
  const hit = ((diag && diag.items) || []).find((d) => /yoqFunksiya/.test(d.message));
  check('5. Til xizmati (tsserver) paketda ishlaydi: semantik xato topiladi',
    !!(lspStatus && lspStatus.available) && !(diag && diag.error) && !!hit,
    `tsserver=${lspStatus && lspStatus.available}${lspStatus && !lspStatus.available ? ` (${lspStatus.reason})` : ''} · xato=${hit ? `Ln ${hit.line}: ${hit.message}` : `YO‘Q${diag && diag.error ? ` (${diag.error})` : ''}`} · javob=${JSON.stringify(diag).slice(0, 160)}`);

  // Ko'p ildizli workspace: `config.json → extraRoots` o'qilishi va chip ko'rinishi.
  const roots = await ev('window.ide.rootsList()');
  const rootNames = ((roots && roots.roots) || []).map((r) => r.name);
  const extraRead = await ev(`window.ide.readFile(${JSON.stringify(path.join(EXTRA, 'qoshimcha.js'))})`);
  check('6. Ko‘p ildizli workspace paketda ham ishlaydi (qo‘shimcha papka + undagi fayl)',
    rootNames.includes(path.basename(EXTRA)) && !!(extraRead && !extraRead.error && /qiymat = 42/.test(String(extraRead.text || ''))),
    `ildizlar=[${rootNames.join(', ')}] · qo‘shimcha fayl=${extraRead && extraRead.error ? `xato: ${extraRead.error}` : 'o‘qildi'}`);

  const ai = await ev('window.ide.aiStatus()');
  check('7. AI qatlami paketdan dinamik import bo‘ladi',
    !!(ai && !ai.error && Array.isArray(ai.providers)), ai && ai.error ? `xato: ${ai.error}` : `${ai.providers.length} provayder · ${ai.provider || '—'}`);

  const fixApi = await ev('typeof window.ide.fixRun === "function" && typeof window.ide.runLog === "function"');
  check('8. «Sinab ko‘r + tuzat» API’si paketda mavjud (tarix + halqa)',
    fixApi === true, `fixRun/runLog=${fixApi}`);

  // Dalil: ekran surati — ko‘p ildizli tasma (chip + «✕») va daraxt ko‘rinishi saqlanadi,
  // shunda «o‘lchandi» degan gapni ko‘z bilan ham tekshirish mumkin bo‘ladi.
  try {
    const shotDir = path.join(ROOT, 'reports', 'ide_packaged');
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = await sendRaw('Page.captureScreenshot', { format: 'png' });
    const b64 = shot && shot.result && shot.result.data;
    if (b64) {
      fs.writeFileSync(path.join(shotDir, 'ide-packaged-v55.png'), Buffer.from(b64, 'base64'));
      check('9. Ekran surati saqlandi (ko‘p ildizli tasma ko‘rinadi)', true, `reports/ide_packaged/ide-packaged-v55.png`);
    } else {
      check('9. Ekran surati saqlandi (ko‘p ildizli tasma ko‘rinadi)', false, 'CDP surat qaytarmadi');
    }
  } catch (e) {
    check('9. Ekran surati saqlandi (ko‘p ildizli tasma ko‘rinadi)', false, `xato: ${e && e.message}`);
  }
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { ws && ws.close(); } catch { /* */ }
  const pid = app && app.pid;
  if (pid) spawnSync('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(EXTRA, { recursive: true, force: true }); } catch { /* */ }
}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
