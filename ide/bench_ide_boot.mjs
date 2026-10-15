// ide/bench_ide_boot.mjs — paketlangan YANG IDE qancha vaqtda ochilishini o'lchaydi.
//
// Nima uchun kerak: `asar: false` (fayllar alohida) va `asar: true` (bitta app.asar) paketlari
// hajm bo'yicha ham, ochilish tezligi bo'yicha ham farq qiladi. Bu skript ikkalasini ham
// bir xil sharoitda o'lchaydi — taxmin qilmaslik uchun:
//
//   node ide/bench_ide_boot.mjs                          # dist-ide/win-unpacked/YANG IDE.exe
//   YANG_IDE_EXE="dist-ide/win-unpacked/YANG IDE.exe" YANG_BENCH_RUNS=5 node ide/bench_ide_boot.mjs
//   YANG_BENCH_LABEL="asar: true" node ide/bench_ide_boot.mjs
//
// Ikki nuqta o'lchanadi (har biri spawn paytidan, ms):
//   1. `cdp`   — DevTools protokoli IDE oynasini ko'rsatdi (renderer hujjati yuklandi);
//   2. `init`  — `window.ide.init()` hal bo'ldi (ish papkasi tiklandi, UI tayyor).
// Har yurishda YANGI `--user-data-dir` beriladi (sovuq profil), lekin fayl keshi yuriшlar
// orasida iliq qoladi — shuning uchun barcha yurishlar ham, median ham chop etiladi.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.resolve(ROOT, process.env.YANG_IDE_EXE || path.join('dist-ide', 'win-unpacked', 'YANG IDE.exe'));
const RUNS = Number(process.env.YANG_BENCH_RUNS || 3);
const LABEL = process.env.YANG_BENCH_LABEL || '(belgilanmagan)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (let p = start; p < start + 40; p += 1) if (await portFree(p)) return p;
  throw new Error('bo‘sh CDP port topilmadi');
}

// Bitta yurish: { cdp, init } — ms yoki null (o'lchanmadi).
async function runOnce(i) {
  const UD = fs.mkdtempSync(path.join(os.tmpdir(), `yang-ide-boot-${i}-`));
  const PORT = await pickFreePort(9401 + i * 60);
  const t0 = Date.now();
  const app = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], { detached: true, stdio: 'ignore' });
  app.unref();

  let ws = null;
  let cdp = null;
  let init = null;
  let notes = '';
  try {
    // 1. CDP oynani ko'rgunicha.
    const deadline = Date.now() + 90000;
    let target = null;
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
        const t = list.find((x) => x.type === 'page' && /ide[\\/]renderer[\\/]index\.html/.test(x.url || '') && x.webSocketDebuggerUrl);
        if (t) { target = t; break; }
      } catch { /* CDP hali ko'tarilmagan */ }
      await sleep(50);
    }
    if (!target) throw new Error('IDE oynasi CDP’da topilmadi');
    cdp = Date.now() - t0;

    // 2. `window.ide.init()` hal bo'lguncha.
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP ulanish vaqti tugadi')), 15000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP xatosi')); }, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const ev = (expression, ms = 90000) => new Promise((res) => {
      const id = ++seq;
      const t = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(t); res(m); });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    const r = await ev('(async () => { const i = await window.ide.init(); return { ws: i && i.workspace && i.workspace.path }; })()');
    if (r && r.__timeout) throw new Error('ide.init() javob bermadi');
    init = Date.now() - t0;
    notes = (r && r.result && r.result.result && r.result.result.value && r.result.result.value.ws) || '';
  } catch (e) {
    notes = `xato: ${e && e.message}`;
  } finally {
    try { ws && ws.close(); } catch { /* */ }
    if (app && app.pid) spawnSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' });
    // Yozuvchi jarayonlar qo'yib yuborilishi uchun qisqa pauza (keyingi yurish toza boshlansin).
    await sleep(600);
    try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  }
  return { cdp, init, notes };
}

function median(xs) {
  const a = xs.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

const exeBytes = fs.statSync(EXE).size;
console.log(`nishon: ${EXE}`);
console.log(`belgi:  ${LABEL} · exe hajmi: ${exeBytes} B · yurishlar: ${RUNS}`);
console.log('');

const rows = [];
for (let i = 1; i <= RUNS; i += 1) {
  const r = await runOnce(i);
  rows.push(r);
  console.log(`yurish ${i}: cdp=${r.cdp ?? '—'} ms · init=${r.init ?? '—'} ms${r.notes ? ` · ${r.notes}` : ''}`);
}

const mCdp = median(rows.map((r) => r.cdp));
const mInit = median(rows.map((r) => r.init));
console.log('');
console.log(`MEDIAN  ${LABEL}  cdp=${mCdp} ms · init=${mInit} ms`);
console.log(`JSON ${JSON.stringify({ label: LABEL, exe: path.relative(ROOT, EXE), exeBytes, runs: rows.map((r) => ({ cdp: r.cdp, init: r.init })), median: { cdp: mCdp, init: mInit } })}`);

const failed = rows.filter((r) => typeof r.init !== 'number').length;
process.exit(failed ? 1 : 0);
