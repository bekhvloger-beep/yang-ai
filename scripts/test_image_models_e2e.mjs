// HAR BIR lokal rasm modeli: yuklab olish → rasm yaratish → o‘chirish (haqiqiy ilova, CDP).
//   node scripts/test_image_models_e2e.mjs
//   YANG_MODELS_DIR="D:/yang-models" node scripts/test_image_models_e2e.mjs   # katta modellar shu yerga
//
// Nima uchun: foydalanuvchi «har bir aini yuklab o‘chirib tekshirib ko‘r» dedi. Har model
// uchun HAQIQIY oqim yuritiladi: katalogdan yuklab olish (progress bilan) → shu model bilan
// 256×256 rasm (4 qadam, tez) → rasm PNG ekani va o‘lchami → «O‘chirish» → fayl yo‘qligi.
// Og‘ir model (SD-Turbo 5,2 GB) bo‘sh joy yetmasa SKIP bo‘ladi — sababi jurnalda.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'image_models_e2e.log');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.writeFileSync(OUT, ''); } catch { /* */ }
const log = (s) => { console.log(s); try { fs.appendFileSync(OUT, s + '\n'); } catch { /* */ } };

const MODELS_DIR = process.env.YANG_MODELS_DIR || path.join(os.tmpdir(), `yang-imgmodels-${Date.now()}`);
fs.mkdirSync(MODELS_DIR, { recursive: true });

const PORT = Number(process.env.YANG_CDP_PORT || 9397);
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-img-'));
const ELECTRON_BIN = (await import('electron')).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, ev) => { results.push(!!ok); log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${ev}`); };
const mb = (n) => `${(Number(n) / 1048576).toFixed(1)} MB`;

log(`models dir: ${MODELS_DIR}\nuser-data: ${UD} (YANG_IGNORE_BUNDLED=1)\n`);
const child = spawn(ELECTRON_BIN, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`], {
  cwd: ROOT,
  stdio: 'ignore',
  env: {
    ...process.env,
    YANG_IGNORE_BUNDLED: '1',
    YANG_MODELS_DIR: MODELS_DIR,
    YANG_DL_IDLE_MS: '120000',
  },
});
child.unref();
const cleanup = () => {
  if (child.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
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
        const send = (method, params = {}, ms = 120000) => new Promise((res) => {
          const id = ++seq;
          const timer = setTimeout(() => res({ __timeout: true }), ms);
          pending.set(id, (m) => { clearTimeout(timer); res(m); });
          ws.send(JSON.stringify({ id, method, params }));
        });
        const ev = async (expression, ms = 120000) => {
          const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, ms);
          if (r.__timeout) throw new Error('CDP javob bermadi');
          if (r.result && r.result.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 240));
          return r.result && r.result.result ? r.result.result.value : undefined;
        };
        for (let i = 0; i < 160; i += 1) {
          if ((await ev('window.__ready === true', 20000)) === true) break;
          await sleep(500);
        }
        return { ev, send };
      }
    } catch { /* hali ko‘tarilmagan */ }
    await sleep(500);
  }
  throw new Error('renderer CDP target topilmadi');
}

const itemState = (ev, id) => ev(`(async () => {
  const c = await window.api.modelsCatalog();
  const it = (c.items || []).find((x) => x.id === ${JSON.stringify(id)});
  return it ? { name: it.name, installed: it.installed, bytes: it.bytes, progress: it.progress } : null;
})()`);

async function download(ev, id, timeoutMs) {
  const before = await itemState(ev, id);
  if (before && before.installed) return { skipped: true, name: before.name };
  const started = await ev(`window.api.modelsDownload(${JSON.stringify(id)})`);
  if (!started || started.error) return { error: started && started.error };
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    const st = await itemState(ev, id);
    if (st && st.installed) return { installed: true, seconds: Math.round((Date.now() - t0) / 1000), name: st.name };
    if (st && st.progress && st.progress.state === 'error') return { error: st.progress.error };
    const p = st && st.progress;
    const now = p ? `${p.state} ${p.percent}% ${p.mbps || 0} MB/s` : 'kutilmoqda';
    if (now !== last && (p && (p.percent % 25 < 1 || p.state !== 'downloading'))) { log(`      … ${st.name}: ${now}`); last = now; }
    await sleep(1500);
  }
  return { error: 'timeout' };
}

const dirBytes = (p) => {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else { try { total += fs.statSync(abs).size; } catch { /* */ } }
    }
  }
  return total;
};

let session = null;
try {
  session = await attach();
  const { ev } = session;

  const cat = await ev(`(async () => (await window.api.modelsCatalog()).items.filter((x) => x.kind === 'image' || x.kind === 'runtime').map((x) => ({ id: x.id, kind: x.kind, name: x.name, bytes: x.bytes })))()`);
  check('1. Katalogda rasm modellari va dvigatellar ro‘yxati', cat.length >= 4,
    cat.map((x) => `${x.id} (${mb(x.bytes)})`).join(' · '));

  const engines = cat.filter((x) => x.kind === 'runtime');
  for (const eng of engines.slice(0, 1)) {
    const r = await download(ev, eng.id, 5 * 60 * 1000);
    check(`2. Dvigatel yuklandi: ${eng.id}`, !!r.installed || r.skipped,
      r.error ? `xato: ${r.error}` : `${r.skipped ? 'allaqachon bor' : `${r.seconds} s`} · ${mb(dirBytes(MODELS_DIR))} diskda`);
  }

  // Diqqat: `available` model ham bo‘lsa true bo‘ladi. Dvigatelning O‘ZI topilganini alohida
  // tekshiramiz — model esa quyida yuklanadi (ilgari bu tekshiruv noto‘g‘ri tartibda edi).
  const st = await ev(`window.api.imageStatus()`);
  check('3. Dvigatel topildi (sd-cli.exe; model hali yuklanmagan bo‘lishi mumkin)',
    !!st && !!st.exe && !!st.backend,
    JSON.stringify({ available: st && st.available, backend: st && st.backend, exe: st && st.exe ? path.basename(st.exe) : null, reason: st && st.reason }));

  const images = cat.filter((x) => x.kind === 'image');
  for (const it of images) {
    log(`\n--- ${it.name} (${mb(it.bytes)}) ---`);
    const dl = await download(ev, it.id, 45 * 60 * 1000);
    if (!dl.installed && !dl.skipped) { check(`4. Yuklab olish: ${it.id}`, false, `xato: ${dl.error}`); continue; }
    check(`4. Yuklab olindi: ${it.name}`, true, `${dl.skipped ? 'allaqachon bor' : `${dl.seconds} s`}`);

    const t0 = Date.now();
    const img = await ev(`window.api.imageGenerate({ prompt: 'a red apple on a white background, flat illustration', size: '256x256', steps: 4 })`, 10 * 60 * 1000);
    const okPng = !!img && img.ok === true && img.width === 256 && img.height === 256 && fs.existsSync(img.abs);
    const head = okPng ? fs.readFileSync(img.abs).subarray(1, 4).toString() : '';
    check(`5. Rasm yaratdi: ${it.name}`, okPng && head === 'PNG',
      img && img.error ? `xato: ${img.error}` : `${img && img.via} · ${img && img.seconds} s · ${img && img.abs ? path.basename(img.abs) : 'fayl yo‘q'} · PNG=${head}`);

    const rm = await ev(`(async () => { const r = await window.api.modelsRemove(${JSON.stringify(it.id)}); const s = await window.api.modelsCatalog(); const x = (s.items || []).find((i) => i.id === ${JSON.stringify(it.id)}); return { error: r && r.error, installed: x ? x.installed : null }; })()`);
    check(`6. O‘chirildi: ${it.name}`, !rm.error && rm.installed === false,
      `xato=«${rm.error || ''}» · installed=${rm.installed} · diskda ${mb(dirBytes(MODELS_DIR))}`);
    if (img && img.abs && fs.existsSync(img.abs)) fs.rmSync(img.abs, { force: true });
    await sleep(800);
  }

  const free = (() => {
    try { const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-PSDrive ${path.parse(MODELS_DIR).drive.replace(':', '')}).Free`], { encoding: 'utf8' }); return Number(String(r.stdout).trim()); } catch { return null; }
  })();
  const turbo = cat.find((x) => /sd-turbo/.test(x.id));
  if (turbo) {
    const fits = free == null || free > turbo.bytes * 1.15;
    log(fits
      ? `SKIP 7. SD-Turbo (${mb(turbo.bytes)}): bo‘sh joy ${free == null ? '?' : mb(free)} — yuklab olish alohida yuritiladi`
      : `SKIP 7. SD-Turbo (${mb(turbo.bytes)}): bo‘sh joy ${mb(free)} yetmaydi — yuklab bo‘lmaydi`);
  }
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { session && session.send('Browser.close', {}); } catch { /* */ }
  await sleep(500);
  cleanup();
}

const failed = results.filter((r) => !r).length;
log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
log(`jurnal: ${OUT}`);
process.exit(failed ? 1 : 0);
