// "Faqat shu modelni ishlatish" (pin) tugmasi UI aylanmasi — real renderer + CDP.
//   node scripts/ui_pin_test.mjs
// Tekshiradi: (1) Sozlamalar ochilganda saqlangan holat o'qiladi, (2) ON+Saqlash → config.json pinMode=true,
// (3) yopib qayta ochganda checked, (4) OFF+Saqlash → pinMode=false, (5) ilova qayta ishga tushganda holat saqlangan.
// Ilova: YANG_APP_EXE env yoki o'rnatilgan nusxa; topilmasa dev rejimda `npx electron .`.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CDP portini socket bilan sinab tanlaymiz: o‘ldirilgan nusxa qoldirgan o‘lik socket
// band ko‘rinadi-yu javob bermaydi — o‘shanda test sababsiz osilib qolardi.
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
let PORT = Number(process.env.YANG_CDP_PORT || 9333);
const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YANG AI', 'YANG AI.exe');
const EXE = process.env.YANG_APP_EXE || INSTALLED;
const useExe = fs.existsSync(EXE);
// Windows'da `.cmd` faylni shell'siz spawn qilib bo'lmaydi (Node 20+ EINVAL beradi),
// shuning uchun dev rejimda to'g'ridan-to'g'ri electron exe ni ishga tushiramiz.
const ELECTRON_BIN = useExe ? EXE : (await import('electron')).default;
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-pin-ui-'));
const cfgPath = path.join(UD, 'config.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Ilova config.json ni writeFile bilan yozadi (atomar emas) — o'qish paytida yarim yozilgan
// faylga tushib qolmaslik uchun xato bo'lsa null qaytaramiz.
const readCfgRaw = () => {
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return null;
  }
};
const readCfg = () => readCfgRaw() || {};
const results = [];
const check = (name, ok, evidence) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};

fs.writeFileSync(
  cfgPath,
  JSON.stringify({ provider: 'localmini', model: 'qwen3-instruct', pinMode: false, autoApprove: true, translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' } }, null, 2),
  'utf8',
);
console.log(`nishon: ${useExe ? EXE : 'dev rejim (npx electron .)'}`);
console.log(`user-data: ${UD} · boshlang'ich pinMode=${readCfg().pinMode} · CDP port ${PORT}`);

// Ilova o'zi lokal AI ni (llama-server) fonda ko'taradi — testdan oldin u ishlamayotgan bo'lsa,
// testdan keyin uni to'xtatib, dastlabki holatni tiklaymiz.
const hadLlama = spawnSync('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe'], { encoding: 'utf8' }).stdout.includes('llama-server.exe');

// Portni egallab turgan eski nusxani yopamiz: aks holda yangi nusxa CDP serverini
// ocholmaydi, test esa eski oynaga ulanib qolib, sababsiz "osilib" qoladi.
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
  const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`];
  const child = useExe
    ? spawn(EXE, args, { detached: true, stdio: 'ignore' })
    : spawn(ELECTRON_BIN, ['.', ...args], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

// excludeId — oldingi nusxaning sahifasiga qayta ulanib qolmaslik uchun (qayta ishga tushirish sinovi).
async function pageTarget(excludeId) {
  for (let i = 0; i < 120; i++) {
    try {
      // Chegara bilan: o'lik socket (o'ldirilgan nusxa qoldirgan port) ulanishni
      // javobsiz osib qo'yishi mumkin — o'shanda skript sababsiz kutar edi.
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && /renderer[\\/]index\.html/.test(x.url || '') && x.id !== excludeId);
      if (t && t.webSocketDebuggerUrl) return t;
    } catch {}
    await sleep(500);
  }
  throw new Error('renderer CDP target topilmadi');
}

async function attach(excludeId) {
  const target = await pageTarget(excludeId);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  // Handshake uchun chegara: eskirgan target'ga ulanib qolsak, sababsiz osilib qolmasin.
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`CDP WebSocket ${target.id.slice(0, 8)} javob bermadi (6 s)`)), 6000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error(`CDP WebSocket ${target.id.slice(0, 8)} xato`)); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  // Har bir CDP so'rovi chegaralangan kutish bilan — javob kelmasa osilib qolmaymiz.
  const send = (method, params, ms = 20000) => {
    const id = ++seq;
    return new Promise((res) => {
      const timer = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => {
        clearTimeout(timer);
        res(m);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.__timeout) throw new Error('CDP javob bermadi (20 s): ' + String(expression).slice(0, 60));
    if (r.result && r.result.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  for (let i = 0; i < 120; i++) {
    if ((await ev('window.__ready === true')) === true) break;
    await sleep(500);
  }
  // Sahifa tirikmi? Bo'sh (eskirgan) sahifaga ulanib qolmaganimizga ishonch hosil qilamiz:
  // yangi jarayonda timeOrigin juda yaqin bo'ladi.
  const age = await ev('Date.now() - performance.timeOrigin');
  if (typeof age !== 'number' || age > 120000) throw new Error(`eskirgan sahifa (yoshi ${age} ms) — target ${target.id}`);
  return { send, ev, target };
}

async function waitCfg(expected, ms = 5000) {
  const t0 = Date.now();
  let v;
  for (;;) {
    const c = readCfgRaw();
    if (c) v = c.pinMode;
    if (v === expected || Date.now() - t0 > ms) return { value: v, waitedMs: Date.now() - t0 };
    await sleep(120);
  }
}

const appAlive = () => spawnSync('tasklist', ['/FI', 'IMAGENAME eq YANG AI.exe'], { encoding: 'utf8' }).stdout.includes('YANG AI.exe');
const MARK = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const watchdog = setTimeout(() => {
  console.log('FAIL  umumiy: 300 s ichida tugamadi');
  spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  process.exit(1);
}, 300000);

const freed = freePort(PORT);
if (freed.length) console.log(`eski CDP jarayoni yopildi (port ${PORT}): ${freed.join(', ')}`);
PORT = await pickFreePort(PORT);
let session = null;
const app = launch();
try {
  MARK('ilova ishga tushirildi (1-nusxa)');
  session = await attach();
  MARK(`CDP ulandi · window.__ready=${await session.ev('window.__ready')}`);
  const { ev } = session;

  const s1 = await ev(`(() => {
    document.querySelector('#settingsBtn').click();
    const m = document.querySelector('#settingsModal'); const t = document.querySelector('#pinModelToggle');
    return { modalOpen: !m.classList.contains('hidden'), pinChecked: t.checked, disabled: t.disabled };
  })()`);
  check('1. Sozlamalar ochilganda pinModelToggle saqlangan holatni o‘qiydi', s1.modalOpen === true && s1.pinChecked === false,
    `modal ochiq=${s1.modalOpen}, toggle.checked=${s1.pinChecked}, disabled=${s1.disabled}; config.json.pinMode=false`);

  const s2a = await ev(`(() => { const t = document.querySelector('#pinModelToggle'); t.click(); return t.checked; })()`);
  await ev(`(() => { document.querySelector('#settingsSave').click(); return true; })()`);
  const w2 = await waitCfg(true);
  const s2b = await ev(`document.querySelector('#settingsModal').classList.contains('hidden')`);
  check('2. ON + Saqlash → config.json da pinMode === true', s2a === true && w2.value === true,
    `toggle.click() → checked=${s2a}; saqlash → modal yopildi=${s2b}; config.json.pinMode=${w2.value} (${w2.waitedMs} ms)`);

  const s3 = await ev(`(() => {
    const m = document.querySelector('#settingsModal'); m.classList.add('hidden');
    const closed = m.classList.contains('hidden');
    document.querySelector('#settingsBtn').click();
    return { closed, reopened: !m.classList.contains('hidden'), pinChecked: document.querySelector('#pinModelToggle').checked };
  })()`);
  check('3. Yopib qayta ochganda tugma checked ko‘rinadi', s3.closed && s3.reopened && s3.pinChecked === true,
    `yopildi=${s3.closed} → qayta ochildi=${s3.reopened}, toggle.checked=${s3.pinChecked}`);

  // 4-qadamdan oldin holatni yana ON ga qaytaramiz (qayta ishga tushish sinovi uchun), keyin OFF sinovi.
  const s4a = await ev(`(() => { const t = document.querySelector('#pinModelToggle'); t.click(); return t.checked; })()`);
  await ev(`(() => { document.querySelector('#settingsSave').click(); return true; })()`);
  const w4 = await waitCfg(false);
  const s4b = await ev(`(() => { document.querySelector('#settingsModal').classList.add('hidden'); document.querySelector('#settingsBtn').click(); return document.querySelector('#pinModelToggle').checked; })()`);
  check('4. OFF + Saqlash → config.json da pinMode === false', s4a === false && w4.value === false && s4b === false,
    `toggle.click() → checked=${s4a}; saqlash → pinMode=${w4.value} (${w4.waitedMs} ms); qayta ochilganda checked=${s4b}`);

  // 5-qadam: ON qilib saqlab, ilovani qayta ishga tushirib tekshiramiz (diskka yozilgan holat tiklanadimi).
  await ev(`(() => { document.querySelector('#pinModelToggle').click(); document.querySelector('#settingsSave').click(); return true; })()`);
  const w5 = await waitCfg(true);
  MARK(`5-qadam uchun pinMode=${w5.value} saqlandi — ilova qayta ishga tushiriladi`);
  try { session.send('Browser.close', {}); } catch {}
  // Ilova chindan yopilishini kutamiz; 25 s ichida yopilmasa majburan to'xtatamiz.
  for (let i = 0; i < 50 && appAlive(); i++) await sleep(500);
  if (appAlive()) {
    spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
    await sleep(1000);
  }
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(700) });
    } catch {
      break;
    }
    await sleep(300);
  }
  const firstTargetId = session.target.id;
  // Qayta ishga tushirishda AYNI portni qayta ishlatmaymiz: yopilgan nusxa o‘rnida
  // "o‘lik" socket qolib, yangi nusxa CDP serverini ocholmay qolishi mumkin
  // (o‘lchandi: shu sabab bilan 5-qadam "renderer CDP target topilmadi" bo‘lgan).
  PORT = await pickFreePort(PORT + 1);
  MARK(`1-nusxa yopildi; 2-nusxa ishga tushiriladi (eski target ${String(firstTargetId).slice(0, 8)} chetlab o‘tiladi, yangi port ${PORT})`);
  launch();
  session = await attach(firstTargetId);
  MARK(`2-nusxa CDP: target=${String(session.target.id).slice(0, 8)} · ready=${await session.ev('window.__ready')} · sahifa yoshi ${Math.round(await session.ev('Date.now() - performance.timeOrigin'))} ms`);
  const step5Expr = `(() => { document.querySelector('#settingsBtn').click(); return document.querySelector('#pinModelToggle').checked; })()`;
  let s5;
  try {
    s5 = await session.ev(step5Expr);
  } catch (e) {
    MARK(`5-qadam 1-urinish muvaffaqiyatsiz (${e.message.slice(0, 60)}) — qayta urinish`);
    await sleep(2000);
    s5 = await session.ev(step5Expr);
  }
  check('5. Ilova qayta ishga tushganda pin holati saqlangan (checked)', w5.value === true && s5 === true,
    `saglashdan oldin pinMode=${w5.value}; qayta ishga tushgach toggle.checked=${s5}`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
  try { if (session) await session.ev('window.__ready'); } catch {}
} finally {
  clearTimeout(watchdog);
  try { session && session.send('Browser.close', {}); } catch {}
  for (let i = 0; i < 20 && appAlive(); i++) await sleep(500);
  if (appAlive()) spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  // Dev rejimda o'zimiz ishga tushirgan electron daraxtini ham yopamiz.
  if (!useExe && app && app.pid) spawnSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' });
  if (!hadLlama) {
    spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  } else {
    console.log('eslatma: llama-server testdan oldin ham ishlayotgan edi — to‘xtatilmadi');
  }
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
