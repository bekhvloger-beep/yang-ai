// HAQIQIY «SINAB KO‘R + TUZAT» HALQASI — jonli sinov (haqiqiy lokal model bilan).
//
// Nima tekshiriladi: foydalanuvchi qanday ishlatadi, xuddi shunday — IDE oynasida fayl
// ochiladi, «Sinab ko‘r + tuzat» tugmasi bosiladi, fayl ishga tushadi, xato chiqadi,
// model TARIXNI ko‘rib tuzatadi va halqa faylni qayta ishga tushiradi.
//
// Model: Ollama'dagi `qwen2.5-coder:7b` (o'lchovda 4/4 — `reports/local_ai/local-ai-hisobot.md`).
// Ollama ishlamasa yoki model bo'lmasa — sinov SKIP bo'ladi (muvaffaqiyat emas, o'tkazib
// yuborilgan deb hisoblanadi va shu aytiladi).
//
//   node ide/test_fix_loop_live.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = process.env.YANG_FIX_MODEL || 'qwen2.5-coder:7b';
const MAX_WAIT_MS = Number(process.env.YANG_FIX_WAIT_MS || 900000);   // 15 daqiqa

/* ------------------------------------------------------------- Ollama bor-yo'qligi */
async function ollamaModels() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch { return null; }
}

const models = await ollamaModels();
if (!models) {
  console.log('SKIP: Ollama ishlamayapti (http://127.0.0.1:11434) — jonli halqa sinovini o‘tkazib yubordim.');
  console.log('     Modelni ishga tushirish: ollama serve');
  process.exit(0);
}
const model = models.find((m) => m === MODEL) || models.find((m) => m.startsWith(MODEL.split(':')[0])) || models[0];
if (!model) {
  console.log('SKIP: Ollama’da hech qanday model yo‘q (ollama pull qwen2.5-coder:7b).');
  process.exit(0);
}
console.log(`model: ${model} (Ollama’dagi modellar: ${models.join(', ')})`);

/* ------------------------------------------------------------------ muhit */
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
  throw new Error('bo‘sh port topilmadi');
}

let PORT = await pickFreePort(9361);
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-fix-e2e-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-fix-ws-'));
// Diqqat: `local` — preset (Ollama), ya'ni u `customProviders` ro'yxatida bo'lishi shart.
// Ilgari bu yozuv yo'q edi va halqa "Pinned model topilmadi: local · …" bilan to'xtardi —
// ya'ni sinov ilovaning haqiqiy yo'lini emas, chala sozlamani sinayotgan edi.
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({
  provider: 'local', model, keys: {}, autoApprove: true, pinMode: true,
  customProviders: [{ id: 'local', name: 'Ollama (lokal)', base: 'http://127.0.0.1:11434/v1', models: [model], key: 'local', local: true }],
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
}, null, 2), 'utf8');

// Ataylab buzuq fayl: EKUB noto'g'ri yozilgan, ichida o'z-o'zini tekshiruv bor.
const FIX_FILE = path.join(WS, 'ekub.js');
const BUGGY = [
  '// Ikki sonning eng katta umumiy bo‘luvchisi (EKUB).',
  'function ekub(a, b) {',
  '  return a / b;   // BU YERDA XATO: bo‘lish emas, EKUB algoritmi kerak',
  '}',
  '',
  'const natija = ekub(48, 18);',
  "if (natija !== 6) throw new Error('ekub(48, 18) = ' + natija + ' — 6 kutilgan');",
  "console.log('TOGRI', natija);",
  '',
].join('\n');

const results = [];
const check = (name, ok, evidence) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};
const MARK = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const ELECTRON_BIN = (await import('electron')).default;
// Ilova kundaligi faylga yoziladi: biror narsa yiqilsa sabab ko'rinadi (avval `ignore` edi va
// muammo sababsiz "jimgina" qolardi).
const APP_LOG = path.join(ROOT, 'reports', 'ide_fix_loop_app.log');
const appLog = fs.openSync(APP_LOG, 'w');
// `--disable-gpu`: sinov muhitida Electron GPU jarayoni vaqti-vaqti bilan yiqilardi
// ("GPU process exited unexpectedly: exit_code=34"), shundan keyin renderer javob bermay
// qolardi va sinov sababsiz "IDE sahifasi topilmadi" deb qolardi. Dastur mantig'iga
// ta'siri yo'q — faqat chizish dasturiy (software) rejimda bo'ladi.
const app = spawn(ELECTRON_BIN, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], {
  cwd: ROOT, detached: true, stdio: ['ignore', appLog, appLog],
  env: {
    ...process.env,
    // IDE o'z AI sozlamalarini shu papkadan oladi (foydalanuvchining haqiqiy sozlamalari tegilmaydi).
    YANG_AI_CONFIG_DIR: UD,
  },
});
app.unref();

const IDE_URL = /ide[\\/]renderer[\\/]index\.html/;
async function attach(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let target = null;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      target = list.find((x) => x.type === 'page' && IDE_URL.test(x.url || ''));
      if (target) break;
    } catch { /* CDP ko'tarilmagan */ }
    await sleep(500);
  }
  if (!target) throw new Error('IDE sahifasi topilmadi');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP ulanish vaqti tugadi')), 8000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP xatosi')); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const ev = async (expression) => {
    const id = ++seq;
    const r = await new Promise((res) => {
      const timer = setTimeout(() => res({ __timeout: true }), 60000);
      pending.set(id, (m) => { clearTimeout(timer); res(m); });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (r.__timeout) throw new Error('CDP javob bermadi: ' + String(expression).slice(0, 60));
    if (r.result && r.result.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await ev('1');
  return { ev };
}

/*
 * Asosiy oynadagi «YANG IDE» tugmasini bosamiz.
 * Muammo (topilgan va tuzatilgan): test ilgari IDE oynasi O'ZI paydo bo'ladi deb kutardi,
 * lekin asosiy ilova uni faqat tugma/klavish orqali ochadi — shu sababli sinov
 * "IDE sahifasi topilmadi" bilan yiqilardi. Endi foydalanuvchi qiladigan ishni qilamiz.
 */
async function clickOpenIde(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('asosiy oynaga CDP ulanmadi')), 8000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('asosiy oyna CDP xatosi')); }, { once: true });
  });
  const evaluate = (expression) => new Promise((res) => {
    const id = Math.floor(Math.random() * 1e9);
    // Kutish chegarasi: CDP javob bermasa sinov noaniq holatda qotib qolmasin.
    const timer = setTimeout(() => { ws.removeEventListener('message', onMsg); res(null); }, 10000);
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      res(m);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  // Muhim: asosiy oyna tayyor bo'lmasidan (UI ulanmasidan) tugma bosilsa — bosish
  // hech narsa qilmaydi va IDE oynasi ochilmay qoladi (o'lchandi: sinov shu sababdan
  // "IDE sahifasi topilmadi" bilan yiqilardi). Shu sabab `window.__ready` ni kutamiz.
  const value = (m) => (m && m.result && m.result.result ? m.result.result.value : undefined);
  const readyDeadline = Date.now() + 60000;
  while (Date.now() < readyDeadline) {
    if (value(await evaluate('window.__ready === true')) === true) break;
    await sleep(400);
  }
  // Renderer hali javob bermasa (masalan birinchi kadr chizilmoqda) — qayta urinamiz.
  for (let i = 0; i < 5; i++) {
    const r = await evaluate(`(() => {
      if (typeof window.openIde !== 'function' && !(window.api && window.api.openIde) && !document.getElementById('openIdeBtn')) return null;
      const b = document.getElementById('openIdeBtn');
      if (b) { b.click(); return 'tugma bosildi'; }
      if (window.api && window.api.openIde) { window.api.openIde(); return 'ko‘prik chaqirildi'; }
      return 'IDE ochish yo‘li topilmadi';
    })()`);
    const got = value(r);
    if (typeof got === 'string' && got) {
      try { ws.close(); } catch { /* */ }
      return got;
    }
    await sleep(2500);
  }
  try { ws.close(); } catch { /* */ }
  return '—';
}

let session = null;
try {
  // 1) Asosiy oynadan IDE ni ochamiz (foydalanuvchi yo'li).
  let mainTarget = null;
  for (let i = 0; i < 120 && !mainTarget; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      mainTarget = list.find((x) => x.type === 'page' && /renderer[\\/]index\.html/.test(x.url || '') && !IDE_URL.test(x.url || ''));
    } catch { /* kutamiz */ }
    if (!mainTarget) await sleep(500);
  }
  MARK('ilova ishga tushdi — asosiy oyna tayyor');
  if (!mainTarget) throw new Error("asosiy oyna CDP'da topilmadi");
  const via = await clickOpenIde(mainTarget);
  MARK(`IDE oynasi so‘raldi (${via}) — IDE sahifasi kutilmoqda`);
  session = await attach();
  await session.ev('window.ide.openFolder(' + JSON.stringify(WS) + ')');
  await session.ev(`(() => { window.__fixLog = []; window.ide.onFixEvent((d) => window.__fixLog.push(d)); return true; })()`);
  // AI hodisalari (tool chaqiruvlari) ham yozib olinadi: halqa "nima uchun tuzatmadi"
  // degan savolga javob faqat shu yerda ko'rinadi.
  await session.ev(`(() => { window.__aiEvents = []; window.ide.onAiEvent((d) => window.__aiEvents.push(d)); return true; })()`);
  // Faylni papka ochilgandan keyin yozamiz: kuzatuvchi ishga tushib daraxtni yangilaydi.
  fs.writeFileSync(FIX_FILE, BUGGY, 'utf8');
  MARK('buzuq fayl tayyor — daraxt yangilanishi kutilmoqda');
  let opened = false;
  for (let i = 0; i < 40; i++) {
    opened = await session.ev(`(async () => {
      const rows = [...document.querySelectorAll('#fileTree .tree-row')];
      const row = rows.find((r) => r.textContent.includes('ekub.js'));
      if (!row) return false;
      row.click();
      await new Promise((r) => setTimeout(r, 400));
      return !!document.querySelector('#editorArea').value.includes('ekub');
    })()`);
    if (opened) break;
    await sleep(500);
  }
  check('1. IDE’da fayl ochildi (daraxtdan bosib)', opened, `ekub.js muharrirda: ${opened}`);

  // 2) «Sinab ko‘r + tuzat» tugmasini bosamiz — halqa AI bilan ishlaydi.
  const before = fs.readFileSync(FIX_FILE, 'utf8');
  await session.ev(`(() => { const b = document.getElementById('runFixBtn'); b.click(); return true; })()`);
  MARK('«Sinab ko‘r + tuzat» bosildi — model ishlayapti (bir necha daqiqa bo‘lishi mumkin)');

  const started = Date.now();
  let fixLog = [];
  let log = null;
  let done = false;
  let tick = 0;
  let lastAi = '';
  while (Date.now() - started < MAX_WAIT_MS) {
    fixLog = (await session.ev('window.__fixLog')) || [];
    log = await session.ev('window.ide.runLog()');
    // Har ~30 soniyada holatni yozib boramiz — uzoq model javobini kutish ko'r bo'lmasin.
    tick += 1;
    if (tick % 8 === 0) {
      const ai = String(await session.ev('document.getElementById("aiLog").textContent')).slice(-160).replace(/\s+/g, ' ');
      if (ai !== lastAi) { lastAi = ai; MARK(`holat: ${fixLog.map((f) => `${f.phase}#${f.attempt}`).join(' → ') || '—'} · ${ai.slice(-110)}`); }
    }
    const last = fixLog[fixLog.length - 1];
    if (last && (last.phase === 'done' || last.phase === 'give-up' || last.phase === 'error')) { done = true; break; }
    const busy = await session.ev('document.getElementById("runFixBtn").disabled');
    if (busy === false && fixLog.length) { done = true; break; }
    await sleep(4000);
  }
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const runs = ((log && log.runs) || []).filter((r) => r.path === 'ekub.js');
  const passed = runs.filter((r) => r.code === 0);
  const failed = runs.filter((r) => r.code !== 0);
  const after = fs.readFileSync(FIX_FILE, 'utf8');
  const changed = after !== before;
  const phases = fixLog.map((f) => `${f.phase}#${f.attempt}`).join(' → ');
  // Har bir bosqichning IZOHI ham chiqadi — xato bo'lsa sabab shu yerda ko'rinadi.
  const events = fixLog.map((f) => `        · ${f.phase}#${f.attempt}: ${String(f.text || '').replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');

  check('2. Halqa TARIXNI ko‘rib tuzatdi: xato → AI → qayta yurish → muvaffaqiyat',
    done && runs.length >= 2 && failed.length >= 1 && passed.length >= 1 && changed,
    `${seconds}s ichida ${runs.length} yurish: ${runs.map((r) => `kod ${r.code}`).join(', ')} · bosqichlar: ${phases || '—'}`);
  if (events) console.log(events);
  const aiEvents = (await session.ev('window.__aiEvents')) || [];
  const toolEvents = aiEvents.filter((e) => e.type === 'tool');
  console.log(`      → AI hodisalari: ${aiEvents.length} ta, shundan tool chaqiruvi ${toolEvents.length} ta`);
  for (const t of toolEvents.slice(0, 10)) {
    console.log(`        · tool ${t.tool} ok=${t.ok} ${JSON.stringify(t.args || {}).replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  const errs = aiEvents.filter((e) => e.type === 'error').slice(0, 3);
  for (const e of errs) console.log(`        · ai xato: ${String(e.message || '').slice(0, 200)}`);

  // 3. Natija HAQIQIY — ikki dalil bilan:
  //    (a) tuzatilgan fayl o'zi xatosiz tugaydi;
  //    (b) EKUB(48,18) HAQIQATDA 6 — buni modelning yozib qoldirgan `console.log`iga
  //        tayanmasdan, tekshiramiz. Model faylni to'liq qayta yozganda log qatori
  //        o'chib ketishi mumkin (kuzatildi), shuning uchun chaqiruvni O'ZIMIZ qo'shib
  //        ishga tushiramiz: e'lon qilingan `ekub` funksiyasi shu qamrovda ko'rinadi.
  let out = '';
  let code = null;
  try {
    const r = spawnSync(ELECTRON_BIN, [FIX_FILE], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    out = `${r.stdout || ''}${r.stderr || ''}`;
    code = r.status;
  } catch (e) { out = String(e.message || e); }
  const probeFile = path.join(WS, '__probe_ekub.mjs');
  fs.writeFileSync(probeFile, `${after}\nconsole.log('EKUB(48,18) =', ekub(48, 18));\n`, 'utf8');
  let probeOut = '';
  let probeCode = null;
  try {
    const r = spawnSync(ELECTRON_BIN, [probeFile], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    probeOut = `${r.stdout || ''}${r.stderr || ''}`;
    probeCode = r.status;
  } catch (e) { probeOut = String(e.message || e); }
  const probeValue = (probeOut.match(/EKUB\(48,18\) = (-?\d+)/) || [])[1];
  check('3. Tuzatilgan fayl mustaqil ishga tushganda ham to‘g‘ri natija beradi (EKUB(48,18)=6)',
    code === 0 && probeCode === 0 && probeValue === '6',
    `fayl exit=${code} · mustaqil chaqiruv: ekub(48,18) = ${probeValue || probeOut.trim().slice(-60) || '—'}`);

  console.log('\n--- tuzatilgan fayl ---');
  console.log(after.trim());
  console.log('-----------------------');
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { session && session.ev('window.close(); true'); } catch { /* */ }
  await sleep(500);
  if (app && app.pid) spawnSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ }
}

const failedCount = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failedCount}/${results.length} PASS`);
process.exit(failedCount ? 1 : 0);
