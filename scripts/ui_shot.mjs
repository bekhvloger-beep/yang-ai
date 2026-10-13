// ui_shot.mjs — ishlab turgan YANG AI oynasini CDP orqali suratga oladi va layout
// ko‘rsatkichlarini o‘lchaydi. Vizual regressiyalarni "ko‘z bilan" tekshirish uchun:
// skrinshot + haqiqiy o‘lchov (element koordinatalari, gorizontal toshish).
//
//   node scripts/ui_shot.mjs --out reports/ui/shot.png
//   node scripts/ui_shot.mjs --out reports/ui/shot.png --width 1600 --height 1000
//   node scripts/ui_shot.mjs --eval "document.body.scrollWidth"   # faqat o‘lchov
//
// Env:
//   YANG_APP_EXE    — o‘rnatilgan nusxa (bo‘lmasa dev: `npx electron .`)
//   YANG_CDP_PORT   — standart 9333
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Portni mavjud socket bilan sinab tanlaymiz: o‘ldirilgan nusxa qoldirgan “o‘lik”
// socket band ko‘rinadi, lekin javob bermaydi — u holda skript osilib qolardi.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const OUT = argOf('--out');
const EVAL = argOf('--eval');
// --log <fayl>: ilovaning o'z stdout/stderr'ini yozib olamiz (main-process xatolarini ko'rish).
const LOG = argOf('--log');
const WIDTH = Number(argOf('--width', '0')) || 0;
const HEIGHT = Number(argOf('--height', '0')) || 0;

const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YANG AI', 'YANG AI.exe');
const EXE = process.env.YANG_APP_EXE || INSTALLED;
// Diqqat: o'rnatilgan nusxa eski (yig'ilgan) rendererni ishlatadi — manba kodni
// tekshirish uchun `--dev` bilan ishga tushiring, aks holda o'zgarish ko'rinmaydi.
const useExe = !argv.includes('--dev') && fs.existsSync(EXE);
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-shot-'));
// Ilova lokal AI ni (llama-server) fonda ko'taradi — testdan oldin ishlab turgan bo'lsa tegmymiz.
const hadLlama = spawnSync('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe'], { encoding: 'utf8' }).stdout.includes('llama-server.exe');

// Windows'da `npx.cmd` ni shell'siz spawn qilib bo'lmaydi (EINVAL) — electron
// paketi o'z exe yo'lini beradi, shuni to'g'ridan-to'g'ri ishga tushiramiz.
async function launch() {
  const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`];
  let stdio = 'ignore';
  if (LOG) {
    fs.mkdirSync(path.dirname(path.resolve(ROOT, LOG)), { recursive: true });
    const fd = fs.openSync(path.resolve(ROOT, LOG), 'w');
    stdio = ['ignore', fd, fd];
  }
  const child = useExe
    ? spawn(EXE, args, { detached: true, stdio })
    : spawn((await import('electron')).default, ['.', ...args], { cwd: ROOT, detached: true, stdio });
  child.unref();
  return child;
}

// 9333 band bo‘lsa, yangi nusxa CDP serverini ocholmaydi va skript ESKI oynaga ulanib
// qoladi — o‘shanda skrinshot/o‘lchov yolg‘on bo‘ladi (tuzoq: bir marta shu hol yuz berdi).
// Shuning uchun portni egallab turgan jarayonni aniq PID bo‘yicha yopamiz.
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

async function pageTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && /renderer[\\/]index\.html/.test(x.url || ''));
      if (t && t.webSocketDebuggerUrl) return t;
    } catch {}
    await sleep(500);
  }
  throw new Error('renderer CDP target topilmadi');
}

async function attach() {
  const target = await pageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params, ms = 20000) => {
    const id = ++seq;
    return new Promise((res) => {
      const timer = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(timer); res(m); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.__timeout) throw new Error(`CDP javob bermadi: ${String(expression).slice(0, 60)}`);
    if (r.result?.exceptionDetails) throw new Error(`JS xato: ${JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails)}`);
    return r.result?.result?.value;
  };
  await send('Runtime.enable', {});
  await send('Page.enable', {});
  for (let i = 0; i < 120; i++) {
    if ((await ev('window.__ready === true')) === true) break;
    await sleep(500);
  }
  return { send, ev, target };
}

// Layout ko‘rsatkichlari: panel joylari + gorizontal toshish bormi.
const METRICS = `(() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const de = document.documentElement;
  return {
    viewport: { w: innerWidth, h: innerHeight },
    scroll: { w: de.scrollWidth, h: de.scrollHeight },
    overflowX: de.scrollWidth - innerWidth,
    sidebar: rect('#sidebar'), main: rect('#main'), topbar: rect('#topbar'),
    chat: rect('#chatWrap'), dock: rect('#dock'), composer: rect('#composer'),
    idePanel: rect('#idePanel'),
    mainSplitDir: getComputedStyle(document.querySelector('#mainSplit')).flexDirection,
    bodyDir: getComputedStyle(document.body).display,
  };
})()`;

const freed = freePort(PORT);
if (freed.length) {
  console.log(`eski CDP jarayoni yopildi (port ${PORT}): ${freed.join(', ')}`);
  await sleep(1500);
}
PORT = await pickFreePort(PORT);
console.log(`CDP port: ${PORT}`);
const app = await launch();
let session = null;
try {
  session = await attach();
  if (WIDTH && HEIGHT) {
    const win = await session.send('Browser.getWindowForTarget', { targetId: session.target.id });
    const windowId = win.result?.windowId;
    if (windowId) await session.send('Browser.setWindowBounds', { windowId, bounds: { width: WIDTH, height: HEIGHT, windowState: 'normal' } });
    await sleep(1200);
  }
  const metrics = await session.ev(METRICS);
  console.log(JSON.stringify(metrics, null, 2));
  if (EVAL) console.log(`EVAL → ${JSON.stringify(await session.ev(EVAL))}`);
  if (OUT) {
    const shot = await session.send('Page.captureScreenshot', { format: 'png' }, 30000);
    if (!shot.result?.data) throw new Error(`skrinshot olinmadi: ${JSON.stringify(shot).slice(0, 200)}`);
    fs.mkdirSync(path.dirname(path.resolve(ROOT, OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(ROOT, OUT), Buffer.from(shot.result.data, 'base64'));
    console.log(`skrinshot: ${path.resolve(ROOT, OUT)}`);
  }
} finally {
  try { session && (await session.send('Browser.close', {}, 5000)); } catch {}
  await sleep(1200);
  // O‘zimiz ishga tushirgan jarayon daraxtini yopamiz (dev rejimda ham) — aks holda
  // keyingi yurish 9333 portini band qilib qo‘yadi.
  if (app && app.pid) spawnSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' });
  if (useExe) spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  if (!hadLlama) spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch {}
}
