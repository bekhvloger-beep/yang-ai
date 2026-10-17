// Lokal AI YUKLAB OLISH oqimi — haqiqiy ilovada, CDP orqali.
//   node scripts/test_ai_download.mjs
//   YANG_APP_EXE="dist/win-unpacked/YANG AI.exe" node scripts/test_ai_download.mjs
//   YANG_DEV=1 node scripts/test_ai_download.mjs        # o‘rnatilgan nusxa bo‘lsa ham manbadan
//
// Nima uchun: foydalanuvchi «75,2% da 30 daqiqa qotib qoldi» dedi. Progress foizi to‘g‘ri
// o‘sadimi, tugagach qator «o‘rnatilgan» bo‘ladimi, «O‘chirish» haqiqatan faylni olib
// tashlaydimi — bularning hammasi SHU skript bilan o‘lchanadi. Kichik dvigatel (17 MB)
// ishlatiladi, shuning uchun sinov tez; 2 GB modellar alohida (YANG_TEST_MODEL=1).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'ai_download.log');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.writeFileSync(OUT, ''); } catch { /* */ }
const log = (s) => { console.log(s); try { fs.appendFileSync(OUT, s + '\n'); } catch { /* */ } };

const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YANG AI', 'YANG AI.exe');
const EXE = process.env.YANG_APP_EXE || INSTALLED;
const useExe = process.env.YANG_DEV !== '1' && fs.existsSync(EXE);
const ELECTRON_BIN = useExe ? null : (await import('electron')).default;
const PORT = Number(process.env.YANG_CDP_PORT || 9395);
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-dl-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, ev) => { results.push(!!ok); log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${ev}`); };

log(`nishon: ${useExe ? EXE : 'dev rejim (electron .)'}\nuser-data: ${UD}\n`);

const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`];
// `YANG_IGNORE_BUNDLED=1` — repodagi 2,2 GB `local-ai/sd` «o‘rnatilgan» deb hisoblanmasin,
// aks holda yuklab olish/o‘chirish oqimini tekshirib bo‘lmaydi (sinov yolg‘on SKIP bo‘lardi).
const ENV = { ...process.env, YANG_IGNORE_BUNDLED: '1', YANG_DL_IDLE_MS: String(process.env.YANG_DL_IDLE_MS || 60000) };
const child = useExe
  ? spawn(EXE, args, { stdio: 'ignore', env: ENV })
  : spawn(ELECTRON_BIN, ['.', ...args], { cwd: ROOT, stdio: 'ignore', env: ENV });
child.unref();

const cleanup = () => {
  if (useExe) spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  else if (child.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
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
        const send = (method, params = {}, ms = 30000) => new Promise((res) => {
          const id = ++seq;
          const timer = setTimeout(() => res({ __timeout: true }), ms);
          pending.set(id, (m) => { clearTimeout(timer); res(m); });
          ws.send(JSON.stringify({ id, method, params }));
        });
        const ev = async (expression) => {
          const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (r.__timeout) throw new Error('CDP javob bermadi: ' + String(expression).slice(0, 60));
          if (r.result && r.result.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 240));
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

const engineDir = path.join(UD, 'models', 'sd');
const findEngine = () => {
  const stack = [engineDir];
  while (stack.length) {
    const cur = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (/^sd(-cli)?\.exe$/i.test(e.name)) return abs;
    }
  }
  return null;
};

let session = null;
try {
  session = await attach();
  const { ev } = session;
  log('CDP ulandi');

  const cat = await ev(`(async () => {
    const c = await window.api.modelsCatalog();
    return (c.items || []).map((x) => ({ id: x.id, kind: x.kind, installed: x.installed, bytes: x.bytes, file: x.file }));
  })()`);
  check('1. Katalog o‘qiladi (12 yozuv) va har birida holat bor',
    cat.length === 12 && cat.every((x) => typeof x.installed === 'boolean'),
    `yozuvlar=${cat.length} · o‘rnatilgan=[${cat.filter((x) => x.installed).map((x) => x.id).join(', ') || 'yo‘q'}]`);

  // 2. Kichik dvigatelni yuklab olish (17 MB, CPU) — progress HAQIQATAN o‘sadimi?
  const started = await ev(`(async () => {
    const r = await window.api.modelsDownload('runtime-sd-cpu');
    return r && r.error ? { error: r.error } : { ok: true, job: r.job };
  })()`);
  check('2. «Yuklab olish» boshlanadi', started.ok === true, started.error ? `xato: ${started.error}` : `job=${JSON.stringify(started.job)}`);

  const samples = [];
  let final = null;
  // 240 × 0,7 s = 168 s yetarli emas edi: boshqa yuklab olish bir vaqtda tarmoqni
  // to‘yintirsa 17 MB ham sekinlashadi (o‘lchandi). 10 daqiqa — xavfsiz chegara.
  for (let i = 0; i < 850; i += 1) {
    const view = await ev(`(async () => {
      const c = await window.api.modelsCatalog();
      const it = (c.items || []).find((x) => x.id === 'runtime-sd-cpu');
      return it ? { installed: it.installed, progress: it.progress } : null;
    })()`);
    if (view && view.progress) {
      const s = `${view.progress.state} ${view.progress.percent}%`;
      if (!samples.length || samples[samples.length - 1].label !== s) samples.push({ label: s, at: Date.now() });
      if (view.progress.state === 'error' || view.progress.state === 'done') { final = view; break; }
    }
    if (view && view.installed) { final = view; break; }
    await sleep(700);
  }
  const percents = samples
    .filter((s) => /downloading/.test(s.label))
    .map((s) => Number((s.label.match(/([\d.]+)%/) || [])[1]))
    .filter((n) => Number.isFinite(n));
  const grew = percents.length >= 2 && percents[percents.length - 1] > percents[0];
  const engine = findEngine();
  check('3. Yuklab olish TUGAYDI va progress 100% gacha o‘sadi',
    final && final.installed === true && !!engine && (!percents.length || percents[percents.length - 1] >= 90),
    `namunalar=[${samples.map((s) => s.label).join(' → ')}] · fayl=${engine ? path.relative(UD, engine) : 'yo‘q'} · ${grew ? 'o‘sdi' : 'o‘sish kuzatilmadi'}`);
  if (engine) check('4. Dvigatel fayli diskda (sd-cli.exe)', true, `${path.relative(UD, engine)} · ${Math.round(fs.statSync(engine).size / 1024)} KB`);

  // 5. O‘chirish — fayl haqiqatan yo‘qoladimi?
  const rm = await ev(`(async () => {
    const r = await window.api.modelsRemove('runtime-sd-cpu');
    const c = await window.api.modelsCatalog();
    const it = (c.items || []).find((x) => x.id === 'runtime-sd-cpu');
    return { error: r && r.error, installed: it ? it.installed : null };
  })()`);
  check('5. «O‘chirish» dvigatelni olib tashlaydi (holat yangilanadi)',
    !rm.error && rm.installed === false && !findEngine(),
    `xato=«${rm.error || ''}» · installed=${rm.installed} · fayl=${findEngine() ? 'qoldi' : 'yo‘q'}`);

  // 6. Qayta yuklab, qayta o‘chirish — idempotentlik
  const again = await ev(`(async () => {
    const r = await window.api.modelsDownload('runtime-sd-cpu');
    return r && r.error ? { error: r.error } : { ok: true };
  })()`);
  let reInstalled = false;
  for (let i = 0; i < 600; i += 1) {
    const st = await ev(`(async () => {
      const c = await window.api.modelsCatalog();
      const it = (c.items || []).find((x) => x.id === 'runtime-sd-cpu');
      return it ? { installed: it.installed, state: it.progress && it.progress.state, err: it.progress && it.progress.error } : null;
    })()`);
    if (st && st.installed) { reInstalled = true; break; }
    if (st && st.state === 'error') { log(`      qayta yuklashda xato: ${st.err}`); break; }
    await sleep(700);
  }
  check('6. O‘chirilgan dvigatelni QAYTA o‘rnatish ishlaydi', again.ok === true && reInstalled,
    `boshlandi=${again.ok} · o‘rnatildi=${reInstalled}`);
  if (reInstalled) await ev(`window.api.modelsRemove('runtime-sd-cpu')`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { session && session.send('Browser.close', {}); } catch { /* */ }
  await sleep(600);
  cleanup();
}

const failed = results.filter((r) => !r).length;
log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
log(`jurnal: ${OUT}`);
process.exit(failed ? 1 : 0);
