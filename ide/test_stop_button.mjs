// ide/test_stop_button.mjs — «To'xtatish» tugmasi HAQIQATAN ishlayaptimi?
//
// Nega bu sinov bor: yadroda to'xtatish yo'li bor edi (`yide:run-stop`, `yide:fix-stop`,
// `aiStop`) va engine'da `AbortController` ham bor edi, LEKIN UI'da ushlab turgan dasturni
// yoki tuzatish halqasini to'xtatadigan tugma yo'q edi — foydalanuvchi «Sinab ko'r + tuzat»
// bosib, keyin faqat kutishi mumkin edi. Endi yuqori panelda «■ To'xtatish» tugmasi va Esc
// bor; bu sinov ularni HAQIQIY oyna ustida, CDP orqali tekshiradi (dev renderer, ya'ni
// repozitoriyadagi kod):
//
//   node ide/test_stop_button.mjs
//
// Tekshiriladi: uzoq ishlaydigan dastur ishga tushganda tugma ko'rinadi va «dastur» deb
// yozadi; tugma bosilganda jarayon HAQIQATAN o'ladi (60 s kutmasdan) va tugma yashirinadi;
// Esc ham xuddi shunday to'xtatadi.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}

if (!fs.existsSync(ELECTRON)) {
  console.log(`SKIP: electron topilmadi — ${ELECTRON}`);
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

// 60 soniya «ishlaydigan» dastur: agar to'xtatish ishlamasa, sinov kutib qoladi (va o'sha payt
// tugma ko'rinib turadi) — shu sabab natija aniq bo'ladi.
const SCRIPT_TEXT = [
  "console.log('stop-test boshlandi');",
  'setTimeout(() => console.log("stop-test tugadi"), 60000);',
  '',
].join('\n');

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-stop-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-stop-ws-'));
fs.writeFileSync(path.join(UD, 'ide-state.json'), JSON.stringify({ lastWorkspace: WS, recent: [WS] }), 'utf8');
fs.writeFileSync(path.join(WS, 'uzoq.js'), SCRIPT_TEXT, 'utf8');

const PORT = await pickFreePort(9361);
const app = spawn(ELECTRON, [path.join(ROOT, 'ide', 'main.js'), `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], { detached: true, stdio: 'ignore' });
app.unref();
console.log(`dev IDE: ${ELECTRON} ide/main.js\nish papkasi: ${WS}\nCDP port ${PORT}\n`);

let ws = null;
let sendRaw = null;
async function attach(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let target = null;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && /ide[\\/]renderer[\\/]index\.html/.test(x.url || '') && x.webSocketDebuggerUrl);
      if (t) { target = t; break; }
    } catch { /* CDP hali ko‘tarilmagan */ }
    await sleep(400);
  }
  if (!target) throw new Error('IDE oynasi CDP’da topilmadi');
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
    if (r.result && r.result.exceptionDetails) throw new Error(`JS xato: ${JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 200)}`);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
}

const btnState = `(() => { const b = document.getElementById('stopAllBtn'); return b ? { hidden: b.classList.contains('hidden'), text: b.textContent } : null; })()`;

async function waitFor(pred, ms, step = 300) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await sleep(step);
  }
  return false;
}

let ev = null;
try {
  ev = await attach();
  // CDP maqsad oyna navigatsiya BOSHIDA ham ko'rinadi: `window.ide` (preload) darhol tayyor
  // bo'ladi, renderer skripti esa biroz keyin bajariladi — shuning uchun uning tayyorligini
  // kutamiz (aks holda `openTab is not defined` xatosi chiqadi).
  const ready = await waitFor(async () => (await ev('typeof openTab')) === 'function', 45000, 400);
  if (!ready) throw new Error('renderer tayyor bo‘lmadi (openTab topilmadi)');
  await ev('(async () => { await window.ide.init(); return true; })()');
  // Faylni tabda ochamiz (u bo'lmasa F5 hech narsa qilmaydi) va ishga tushuramiz.
  await ev('(async () => { openTab("uzoq.js"); await new Promise(r => setTimeout(r, 1200)); return true; })()');
  const before = await ev(btnState);
  check('1. Vazifa yo‘q paytda «To‘xtatish» tugmasi ko‘rinmaydi',
    !!(before && before.hidden), `holat=${JSON.stringify(before)}`);

  const t0 = Date.now();
  await ev('(() => { document.getElementById("runBtn").click(); return true; })()');
  const showed = await waitFor(async () => {
    const s = await ev(btnState);
    return !!(s && !s.hidden);
  }, 20000);
  const s1 = await ev(btnState);
  check('2. Dastur ishga tushganda tugma ko‘rinadi va nima ishlayotganini yozadi',
    showed && /\bdastur\b/.test(String(s1 && s1.text)),
    `matn="${s1 && s1.text}" · ko‘rindi=${Date.now() - t0} ms`);

  // Tugmani bosamiz — jarayon 60 s kutmasdan o'lishi kerak.
  const tStop = Date.now();
  await ev('(() => { document.getElementById("stopAllBtn").click(); return true; })()');
  const hid = await waitFor(async () => {
    const s = await ev(btnState);
    return !!(s && s.hidden);
  }, 15000);
  const stopMs = Date.now() - tStop;
  check('3. Tugma bosilganda jarayon to‘xtaydi (60 s kutmaydi) va tugma yashirinadi',
    hid && stopMs < 15000, `to‘xtash ${stopMs} ms`);

  const log1 = await ev('(async () => { const r = await window.ide.runLog(); return (r && r.runs) || []; })()');
  const last1 = log1 && log1.length ? log1[log1.length - 1] : null;
  check('4. To‘xtatilgan yurish TARIXGA yoziladi (noldan boshqa kod bilan)',
    !!(last1 && (last1.code !== 0 || last1.timedOut)),
    last1 ? `kod=${last1.code} · ${last1.seconds}s · ${String(last1.command || '').slice(0, 60)}` : 'tarix bo‘sh');

  // Esc ham to'xtatishi kerak.
  const runsBefore = (log1 || []).length;
  await ev('(() => { document.getElementById("runBtn").click(); return true; })()');
  const showed2 = await waitFor(async () => {
    const s = await ev(btnState);
    return !!(s && !s.hidden);
  }, 20000);
  for (const type of ['keyDown', 'keyUp']) {
    await sendRaw('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  }
  const hid2 = await waitFor(async () => {
    const s = await ev(btnState);
    return !!(s && s.hidden);
  }, 15000);
  const log2 = await ev('(async () => { const r = await window.ide.runLog(); return (r && r.runs) || []; })()');
  check('5. Esc ham ishlayotgan dasturni to‘xtatadi',
    showed2 && hid2 && (log2 || []).length > runsBefore,
    `ko‘rindi=${showed2} · yashirindi=${hid2} · tarix ${runsBefore} → ${(log2 || []).length}`);

  // Dalil: ekran surati (tugma ko'rinib turgan holatda).
  try {
    await ev('(() => { document.getElementById("runBtn").click(); return true; })()');
    await waitFor(async () => { const s = await ev(btnState); return !!(s && !s.hidden); }, 20000);
    const dir = path.join(ROOT, 'reports', 'ide_stop');
    fs.mkdirSync(dir, { recursive: true });
    const shot = await sendRaw('Page.captureScreenshot', { format: 'png' });
    const b64 = shot && shot.result && shot.result.data;
    if (b64) {
      fs.writeFileSync(path.join(dir, 'ide-stop-button.png'), Buffer.from(b64, 'base64'));
      check('6. Ekran surati: tugma ishlab turgan vazifa bilan ko‘rinadi', true, 'reports/ide_stop/ide-stop-button.png');
    } else {
      check('6. Ekran surati', false, 'CDP surat qaytarmadi');
    }
    await ev('(() => { document.getElementById("stopAllBtn").click(); return true; })()');
  } catch (e) {
    check('6. Ekran surati', false, `xato: ${e && e.message}`);
  }
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { ws && ws.close(); } catch { /* */ }
  if (app && app.pid) spawnSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' });
  await sleep(500);
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ }
}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
