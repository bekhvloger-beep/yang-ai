// Yuklab olish UZILISHI — jim qotib qolish va davom ettirish (resume) sinovi.
//   node scripts/test_download_stall.mjs
//
// Nima uchun: foydalanuvchi «75% da 30 daqiqa qotib qoldi, xato ham bermadi» dedi. Sabab —
// CDN socketni yopmasa oqim abadiy osilib qolardi. Endi:
//   1) ma’lumot kelmasa IDLE (standart 60 s) ichida ANIQ xato beriladi va `.part` SAQLANADI;
//   2) qayta boshlaganda HTTP Range bilan o‘sha yerdan davom etadi.
// Sinov mahalliy HTTP server bilan ishlaydi: 3 MB fayl, 1 MB dan keyin jim qotadi.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'ai_download_stall.log');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.writeFileSync(OUT, ''); } catch { /* */ }
const log = (s) => { console.log(s); try { fs.appendFileSync(OUT, s + '\n'); } catch { /* */ } };

const TOTAL = 3 * 1024 * 1024;
const STALL_AT = 1 * 1024 * 1024;
const payload = Buffer.alloc(TOTAL, 7);
const IDLE_MS = 15000;                  // kod eng kami 15 s (YANG_DL_IDLE_MS)
let mode = 'stall';                      // 'stall' | 'ok'
const requests = [];
let stalledSockets = 0;

const server = http.createServer((req, res) => {
  const range = String(req.headers.range || '');
  const m = range.match(/bytes=(\d+)-/);
  const from = m ? Number(m[1]) : 0;
  requests.push({ range: range || null, mode });
  const body = payload.subarray(from);
  res.writeHead(m ? 206 : 200, {
    'content-length': String(body.length),
    'content-type': 'application/octet-stream',
    ...(m ? { 'content-range': `bytes ${from}-${TOTAL - 1}/${TOTAL}` } : {}),
  });
  if (mode === 'stall') {
    res.write(body.subarray(0, STALL_AT));
    stalledSockets += 1;
    return;                              // socketni YOPMAYMIZ: jim qotish (haqiqiy holat)
  }
  res.end(body);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL = `http://127.0.0.1:${port}/model.bin`;

const CAT = path.join(os.tmpdir(), `yang-catalog-stall-${Date.now()}.json`);
fs.writeFileSync(CAT, JSON.stringify({
  version: 1,
  updated: '2026-10-17',
  items: [{
    id: 'test-stall-model', kind: 'text', name: 'Uzilish sinovi modeli',
    file: 'stall-model.bin', bytes: TOTAL, url: URL, strength: { code: 3 },
    min: { ramGb: 1, diskGb: 1 }, notes: 'sinov', langs: [],
  }],
}, null, 2));

const PORT = Number(process.env.YANG_CDP_PORT || 9396);
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-stall-'));
const ELECTRON_BIN = (await import('electron')).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, ev) => { results.push(!!ok); log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${ev}`); };

log(`server: ${URL}\nkatalog: ${CAT}\nuser-data: ${UD}\n`);
const child = spawn(ELECTRON_BIN, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`], {
  cwd: ROOT,
  stdio: 'ignore',
  env: {
    ...process.env,
    YANG_IGNORE_BUNDLED: '1',
    YANG_CATALOG_FILE: CAT,
    YANG_DL_IDLE_MS: String(IDLE_MS),
  },
});
child.unref();
const cleanup = () => {
  if (child.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(CAT, { force: true }); } catch { /* */ }
  try { server.close(); } catch { /* */ }
};

async function attach(timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && /renderer[\\/]index\.html/.test(x.url || ''));
      if (t && t.webSocketDebuggerUrl) {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error('CDP WS javob bermadi')), 8000);
          ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
          ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('CDP WS xato')); }, { once: true });
        });
        let seq = 0;
        const pending = new Map();
        ws.addEventListener('message', (e) => {
          const m = JSON.parse(e.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}, ms = 30000) => new Promise((res) => {
          const id = ++seq;
          const timer = setTimeout(() => res({ __timeout: true }), ms);
          pending.set(id, (m) => { clearTimeout(timer); res(m); });
          ws.send(JSON.stringify({ id, method, params }));
        });
        const ev = async (expression) => {
          const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (r.__timeout) throw new Error('CDP javob bermadi');
          if (r.result && r.result.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 200));
          return r.result && r.result.result ? r.result.result.value : undefined;
        };
        for (let i = 0; i < 120; i += 1) {
          if ((await ev('window.__ready === true')) === true) break;
          await sleep(500);
        }
        return { ev, send };
      }
    } catch { /* hali ko‘tarilmagan */ }
    await sleep(500);
  }
  throw new Error('renderer CDP target topilmadi');
}

const state = (ev) => ev(`(async () => {
  const c = await window.api.modelsCatalog();
  const it = (c.items || []).find((x) => x.id === 'test-stall-model');
  return it ? { installed: it.installed, progress: it.progress } : null;
})()`);
const partPath = path.join(UD, 'models', 'stall-model.bin.part');
const destPath = path.join(UD, 'models', 'stall-model.bin');

let session = null;
try {
  session = await attach();
  const { ev } = session;
  await ev(`window.api.modelsDownload('test-stall-model')`);

  let stalled = null;
  const t0 = Date.now();
  while (Date.now() - t0 < IDLE_MS + 20000) {
    const st = await state(ev);
    if (st && st.progress && (st.progress.state === 'error' || st.progress.state === 'done')) { stalled = st; break; }
    await sleep(500);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const partBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
  check('1. Jim qotish ANIQLANADI: xato beriladi (abadiy osilib qolmaydi)',
    !!stalled && stalled.progress.state === 'error' && /to‘xtab qoldi/.test(stalled.progress.error || ''),
    `holat=${stalled && stalled.progress ? stalled.progress.state : 'yo‘q'} · ${elapsed} s · xato=«${stalled && stalled.progress ? stalled.progress.error : ''}»`);
  check('2. Qotishda `.part` SAQLANADI (yuklangan qism yo‘qolmaydi)',
    partBytes > 0 && partBytes < TOTAL && !fs.existsSync(destPath),
    `part=${Math.round(partBytes / 1024)} KB · yakuniy fayl=${fs.existsSync(destPath) ? 'bor' : 'yo‘q'}`);

  // 3. Server tuzaladi — qayta urinish Range bilan davom etishi kerak.
  mode = 'ok';
  const before = partBytes;
  requests.length = 0;
  await ev(`window.api.modelsDownload('test-stall-model')`);
  let done = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    const st = await state(ev);
    if (st && st.installed) { done = st; break; }
    if (st && st.progress && st.progress.state === 'error') { done = st; break; }
    await sleep(400);
  }
  const rangeReq = requests.find((r) => r.mode === 'ok' && r.range);
  check('3. Qayta urinishda HTTP Range bilan DAVOM etadi (noldan emas)',
    !!rangeReq && Number((rangeReq.range.match(/bytes=(\d+)-/) || [])[1]) >= before * 0.9,
    `so‘rov=${rangeReq ? rangeReq.range : 'Range yo‘q'} · oldingi part=${Math.round(before / 1024)} KB`);
  check('4. Davom ettirib yuklab olish TUGAYDI va fayl to‘liq',
    !!done && done.installed === true && fs.existsSync(destPath) && fs.statSync(destPath).size === TOTAL,
    `holat=${done && done.progress ? done.progress.state : '?'} · hajm=${fs.existsSync(destPath) ? fs.statSync(destPath).size : 0} / ${TOTAL}`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { session && session.send('Browser.close', {}); } catch { /* */ }
  await sleep(500);
  cleanup();
}

const failed = results.filter((r) => !r).length;
log(`\nXULOSA: ${results.length - failed}/${results.length} PASS · qotgan socket=${stalledSockets}`);
log(`jurnal: ${OUT}`);
process.exit(failed ? 1 : 0);
