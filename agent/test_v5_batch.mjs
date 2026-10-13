// YANG AI v4 — 5-bosqich: ommaviy o'zbekcha sinov.
//   100 xil reja tuzdirish + 100 xil vazifa bajarish (real engine + real lokal model).
// Ishlatish:
//   node agent/test_v5_batch.mjs                  # 100 + 100 (to'liq)
//   node agent/test_v5_batch.mjs --plans 5 --tasks 5
//   node agent/test_v5_batch.mjs --resume         # JSONL'dagi natijalarni saqlab, qolganini davom ettirish
// Natijalar: %TEMP%/yang-v5/plans.jsonl, tasks.jsonl, summary.json, summary.md
// Shart: 127.0.0.1:8082 bo'sh bo'lishi kerak (skript llama-server'ni o'zi ko'taradi).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentEngine } from './engine.js';
import { localServerUp } from './providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.YANG_TEST_OUT || path.join(os.tmpdir(), 'yang-v5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const RESUME = process.argv.includes('--resume');
const ONLY_FAILED = process.argv.includes('--only-failed'); // faqat avval yaroqsiz bo'lganlar
const N_PLANS = arg('--plans', 100);
const N_TASKS = arg('--tasks', 100);

const config = {
  provider: 'localmini', model: 'qwen3-instruct', keys: {}, customProviders: [],
  autoApprove: true, providerHealth: {}, disabledProviders: [], pinMode: true,
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};

// ---------- 100 xil reja so'rovi (20 mavzu × 5 maqsad) ----------
const PLAN_SUBJECTS = ['kalkulyator', 'to-do ro‘yxati', 'ob-havo paneli', 'soat', 'taymer', 'daftar', 'kalendar', 'chat oynasi', 'rasm galereyasi', 'savol-javob o‘yini', 'budjet hisoblagich', 'dars jadvali', 'test veb-sayti', 'portfolio sahifasi', 'login formasi', 'qidiruv sahifasi', 'ranglar palitrasi', 'hisob mashinasi', 'til o‘rganish kartalari', 'ish rejalashtiruvchi'];
const PLAN_GOALS = ['HTML sahifa qilib yasab ber', 'Python skript qilib yozib ber', 'bitta faylli veb-ilova qilib yasab ber', 'qadamma-qadam tayyorlab ber', 'oddiy prototip qilib yasab ber'];
const planPrompts = [];
for (const s of PLAN_SUBJECTS) for (const g of PLAN_GOALS) planPrompts.push(`Menga ${s} ${g}`);

// ---------- 100 xil vazifa ----------
const CHAT_Q = ['Salom, qandaysan?', '2+2 nechchi?', '10 dan 4 ni ayirsak nechchi bo‘ladi?', 'O‘zbekiston poytaxti qaysi shahar?', 'Bir haftada necha kun bor?', 'Eng katta okean qaysi?', '3 ta olma va 2 ta nok jami nechta meva?', 'Yilning birinchi oyi qaysi?', 'Quyosh qaysi tomondan chiqadi?', '100 ni 5 ga bo‘lsak nechchi?', 'Dunyodagi eng baland cho‘qqi nomi nima?', 'Suv qanday haroratda qaynaydi?', 'Bir soatda necha daqiqa bor?', 'Cho‘lda qanday hayvonlar yashaydi?', 'Kitob o‘qishning foydasi nima?', 'Kompyuter nima uchun kerak?', 'Sport bilan shug‘ullanishning foydasi nima?', 'Nonushta qilish nima uchun muhim?', 'Daraxtlar nima uchun kerak?', 'Suvni tejash nima uchun kerak?', 'Ingliz tilini o‘rganish nima beradi?', 'Mevalar nima uchun foydali?', 'Telefonda vaqtni qanday tejash mumkin?', 'Ertalab erta turishning foydasi nima?', 'Kitob o‘qish yoki film ko‘rish qaysi biri foydali?'];
const FILE_TOPICS = ['kitob', 'olma', 'maktab', 'quyosh', 'suv', 'non', 'gul', 'qush', 'baliq', 'tog‘', 'daryo', 'bulut', 'yomg‘ir', 'qor', 'shamol', 'oy', 'yulduz', 'daraxt', 'asal', 'sut', 'choy', 'palov', 'do‘stlik', 'oila', 'mehnat', 'bilim', 'sog‘liq', 'sport', 'musiqa', 'rasm', 'teatr', 'kino', 'sayohat', 'temiryo‘l', 'avtomobil', 'kompyuter', 'telefon', 'robot', 'chorva', 'bog‘bonchilik'];
const RUN_NS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const IMG_TASKS = [
  { file: 'kvadrat.png', desc: 'oq fonda qizil kvadrat' },
  { file: 'doira.png', desc: 'ko‘k doira' },
  { file: 'uchburchak.png', desc: 'yashil uchburchak' },
  { file: 'tortburchak.png', desc: 'sariq to‘rtburchak' },
  { file: 'chiziq.png', desc: 'oq fonda qora chiziq' },
  { file: 'qizil_fon.png', desc: 'butunlay qizil fon' },
  { file: 'bayroq.png', desc: 'uchta gorizontal chiziq: ko‘k, oq, yashil' },
  { file: 'svetofor.png', desc: 'svetofor: qizil, sariq, yashil doiralar' },
  { file: 'quyosh.png', desc: 'sariq doira va uning atrofida chiziqlar' },
  { file: 'uy.png', desc: 'kvadrat uy va uchburchak tom' },
  { file: 'ranglar.png', desc: '2x2 to‘rt xil rangli kvadratlar' },
  { file: 'diagramma.png', desc: '3 ta turli balandlikdagi ustun (diagramma)' },
  { file: 'nishon.png', desc: 'oq doira ichida qizil doira' },
  { file: 'kitob.png', desc: 'to‘rtburchak kitob va uning ustida chiziq' },
  { file: 'quti.png', desc: 'kvadrat va uning diagonallari' },
];

const tasks = [];
for (let i = 0; i < 25; i++) tasks.push({ kind: 'chat', prompt: CHAT_Q[i] });
for (let i = 0; i < 40; i++) {
  const f = `malumot_${String(i + 1).padStart(2, '0')}.${i % 2 === 0 ? 'md' : 'txt'}`;
  tasks.push({
    kind: 'file', file: f,
    prompt: i % 2 === 0
      ? `Fayl yarating: ${f} — ${FILE_TOPICS[i]} haqida 3-4 qatordan iborat qisqa ma’lumot yozing.`
      : `Yangi fayl oching (${f}) va unga ${FILE_TOPICS[i]} mavzusida 2 ta foydali maslahat yozing.`,
  });
}
for (let i = 0; i < 20; i++) {
  const n = RUN_NS[i];
  tasks.push({
    kind: 'run', file: `summa_${n}.py`, expect: n * (n + 1) / 2,
    prompt: `python summa_${n}.py faylini yozing: 1 dan ${n} gacha sonlar yig‘indisini hisoblab ekranga chiqaradigan skript. Keyin uni run_command bilan ishga tushirib tekshiring.`,
  });
}
for (let i = 0; i < 15; i++) tasks.push({ kind: 'image', file: IMG_TASKS[i].file, prompt: `Rasm yarating (200x200) va ${IMG_TASKS[i].file} fayliga saqlang: ${IMG_TASKS[i].desc}.` });

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const hasCjk = (s) => /[\u3000-\u9fff\uac00-\ud7af\u0600-\u06ff]/.test(String(s || ''));

function verifyTask(t, ws, ev, res) {
  const tools = ev.filter((e) => e.type === 'tool_start').map((e) => e.tool);
  const content = String((res && res.content) || '');
  const toolOut = ev.filter((e) => e.type === 'tool').map((e) => String(e.result || '')).join('\n');
  if (t.kind === 'chat') {
    return { ok: content.trim().length > 1 && !hasCjk(content), note: content.trim().slice(0, 60).replace(/\n/g, ' ') };
  }
  const fp = t.file ? path.join(ws, t.file) : null;
  const exists = fp && fs.existsSync(fp) && fs.statSync(fp).size > 0;
  if (t.kind === 'file') return { ok: !!exists && fs.statSync(fp).size > 40, note: exists ? `${fs.statSync(fp).size} B` : 'fayl yo‘q' };
  if (t.kind === 'run') {
    const ran = tools.includes('run_command');
    const okOut = new RegExp(`summa\\s*=?\\s*${t.expect}`).test(toolOut) || new RegExp(`\\b${t.expect}\\b`).test(toolOut);
    return { ok: !!exists && ran && okOut, note: `fayl=${!!exists} run=${ran} natija=${okOut}` };
  }
  if (t.kind === 'image') {
    if (!exists) return { ok: false, note: 'rasm yo‘q' };
    // Haqiqiy PNG: signature + IHDR o‘lchamlari o‘qiladi. Ilgari faqat size>300
    // tekshirilardi — tekis rangli 200x200 rasm 195 B bo‘lib, noto‘g‘ri FAIL berardi
    // (rasm baribir haqiqiy). Endi o‘lcham va signature asosiy mezon.
    const buf = fs.readFileSync(fp);
    const okPng = buf.length > 24 && buf.subarray(0, 4).equals(PNG_SIG);
    const w = okPng ? buf.readUInt32BE(16) : 0;
    const h = okPng ? buf.readUInt32BE(20) : 0;
    const ok = okPng && w >= 64 && h >= 64 && buf.length > 100;
    return { ok, note: `${buf.length} B png=${okPng} ${w}x${h} tools=[${tools.join(',')}]` };
  }
  return { ok: false, note: 'noma’lum tur' };
}

const readAll = (file) => {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    try { const j = JSON.parse(line); if (j && typeof j.index === 'number') rows.push(j); } catch {}
  }
  return rows;
};
const lastByIndex = (rows) => { const m = new Map(); for (const r of rows) m.set(r.index, r); return m; };
const firstByIndex = (rows) => { const m = new Map(); for (const r of rows) if (!m.has(r.index)) m.set(r.index, r); return m; };
// --resume: oldingi natijalari bor indekslar o'tkazib yuboriladi.
// --only-failed: "bajarilgan" hisobi EMAS — faqat oxirgi natijasi yaroqsiz
// bo'lganlar qayta uriniladi (planSkip/taskSkip ro'yxati hal qiladi).
const readDone = (file) => (RESUME && !ONLY_FAILED ? lastByIndex(readAll(file)) : new Map());
const append = (file, obj) => fs.appendFileSync(file, JSON.stringify(obj) + '\n');

// ---------- lokal serverni ko'tarish ----------
if (await localServerUp(config)) {
  console.log('SKIP: 127.0.0.1:8082 allaqachon band — sinov sovuq holat talab qiladi.');
  process.exit(2);
}
const serverLog = path.join(os.tmpdir(), 'yang-v5-llama.log');
const logFd = fs.openSync(serverLog, 'w');
const server = spawn(path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe'),
  ['-m', process.env.YANG_TEST_MODEL || 'model-1.7b.gguf', '--host', '127.0.0.1', '--port', '8082', '-c', '8192', '--reasoning', 'off', '--no-webui'],
  { cwd: path.join(ROOT, 'local-ai'), detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
server.unref();
console.log(`llama-server jurnali: ${serverLog}`);
let ready = false;
for (let i = 0; i < 90; i++) {
  try { const r = await fetch('http://127.0.0.1:8082/v1/models', { signal: AbortSignal.timeout(2000) }); if (r.ok) { ready = true; break; } } catch {}
  await sleep(1000);
}
console.log(`lokal server tayyor: ${ready}\n`);
if (!ready) { spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' }); process.exit(3); }

const plansWs = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-v5-plans-'));
const tasksRoot = path.join(OUT, 'tasks');
fs.mkdirSync(tasksRoot, { recursive: true });
const planFile = path.join(OUT, 'plans.jsonl');
const taskFile = path.join(OUT, 'tasks.jsonl');

async function runWithTimeout(engine, opts, ms) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => { try { engine.abort(); } catch {} rej(new Error(`timeout ${ms} ms`)); }, ms);
  });
  try { return await Promise.race([engine.run(opts), timeout]); } finally { clearTimeout(timer); }
}

// ---------- 1) REJALAR ----------
const donePlans = readDone(planFile);
const planSkip = ONLY_FAILED
  ? new Set([...lastByIndex(readAll(planFile)).values()].filter((r) => !r.ok).map((r) => r.index))
  : null;
console.log(`--- REJALAR: ${ONLY_FAILED ? planSkip.size + ' ta yaroqsiz qayta urinish' : N_PLANS + ' ta'} (${donePlans.size} ta avvaldan bor) ---`);
const t0 = Date.now();
for (let i = 0; i < N_PLANS; i++) {
  if (donePlans.has(i) || (ONLY_FAILED && !planSkip.has(i))) continue;
  const prompt = planPrompts[i];
  const ev = [];
  const engine = new AgentEngine({ config, workspace: plansWs, translateOutput: false, translateInput: false });
  engine.on('event', (e) => ev.push(e));
  const st = Date.now();
  let rec;
  try {
    const res = await runWithTimeout(engine, { events: [], userText: prompt, planFirst: true }, 240000);
    const plan = ev.find((e) => e.type === 'plan');
    const steps = (plan && plan.steps) || [];
    const truncated = ev.some((e) => e.type === 'notice' && /✂/.test(e.text || ''));
    const ok = steps.length >= 2 && String(res.content || '').length > 40 && !hasCjk(res.content);
    rec = { index: i, prompt, ok, steps: steps.length, sec: (Date.now() - st) / 1000, truncated, note: steps.slice(0, 2).join(' | ').slice(0, 120) };
  } catch (e) {
    rec = { index: i, prompt, ok: false, steps: 0, sec: (Date.now() - st) / 1000, error: String(e.message).slice(0, 120) };
  }
  append(planFile, rec);
  console.log(`${rec.ok ? 'PASS' : 'FAIL'} reja ${i + 1}/${N_PLANS} · ${rec.steps} qadam · ${rec.sec.toFixed(1)} s · "${prompt.slice(0, 45)}"`);
}
console.log(`--- rejalar tugadi: ${Math.round((Date.now() - t0) / 1000)} s ---\n`);

// ---------- 2) VAZIFALAR ----------
const doneTasks = readDone(taskFile);
const taskSkip = ONLY_FAILED
  ? new Set([...lastByIndex(readAll(taskFile)).values()].filter((r) => !r.ok).map((r) => r.index))
  : null;
console.log(`--- VAZIFALAR: ${ONLY_FAILED ? taskSkip.size + ' ta yaroqsiz qayta urinish' : N_TASKS + ' ta'} (${doneTasks.size} ta avvaldan bor) ---`);
const t1 = Date.now();
for (let i = 0; i < N_TASKS; i++) {
  if (doneTasks.has(i) || (ONLY_FAILED && !taskSkip.has(i))) continue;
  const t = tasks[i];
  const ws = path.join(tasksRoot, `task_${String(i + 1).padStart(3, '0')}`);
  // Qayta urinishda eski workspace tozalanadi — aks holda o'tgan urinishdagi
  // qolib ketgan fayl tekshiruvni yolg'on PASS qilishi mumkin edi.
  if (ONLY_FAILED) fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  const ev = [];
  const engine = new AgentEngine({ config, workspace: ws, translateOutput: false, translateInput: false, maxSteps: 8 });
  engine.on('event', (e) => ev.push(e));
  const st = Date.now();
  let rec;
  try {
    const res = await runWithTimeout(engine, { events: [], userText: t.prompt }, 300000);
    const v = verifyTask(t, ws, ev, res);
    rec = { index: i, kind: t.kind, prompt: t.prompt, ok: v.ok, sec: (Date.now() - st) / 1000, note: v.note, truncated: ev.some((e) => e.type === 'notice' && /✂/.test(e.text || '')), tools: ev.filter((e) => e.type === 'tool_start').map((e) => e.tool) };
  } catch (e) {
    const v = verifyTask(t, ws, ev, null);
    rec = { index: i, kind: t.kind, prompt: t.prompt, ok: false, sec: (Date.now() - st) / 1000, note: `${String(e.message).slice(0, 80)} · ${v.note}`, tools: ev.filter((e) => e.type === 'tool_start').map((e) => e.tool) };
  }
  append(taskFile, rec);
  console.log(`${rec.ok ? 'PASS' : 'FAIL'} vazifa ${i + 1}/${N_TASKS} [${t.kind}] ${rec.sec.toFixed(1)} s · ${rec.note}`);
}
console.log(`--- vazifalar tugadi: ${Math.round((Date.now() - t1) / 1000)} s ---\n`);

spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });

// ---------- 3) XULOSA ----------
const sumOf = (rows) => {
  const pass = rows.filter((r) => r.ok).length;
  const secs = rows.reduce((a, r) => a + (r.sec || 0), 0);
  const kinds = {};
  for (const r of rows) { const k = r.kind || 'plan'; kinds[k] = kinds[k] || { n: 0, pass: 0 }; kinds[k].n++; if (r.ok) kinds[k].pass++; }
  return { total: rows.length, pass, fail: rows.length - pass, sec: Math.round(secs), kinds };
};
// Yakuniy holat: har bir indeks uchun OXIRGI natija (qayta urinish avvalgisini almashtiradi).
const sum = (file, n) => sumOf([...lastByIndex(readAll(file)).values()].filter((r) => r.index < n));
// Qayta urinish hisoboti: birinchi o'tishdagi yaroqsizlar → hozirgi holat.
const retryReport = (file, n, label) => {
  const first = firstByIndex(readAll(file));
  const last = lastByIndex(readAll(file));
  const idx = [...first.values()].filter((r) => !r.ok && r.index < n).map((r) => r.index);
  if (!idx.length) return `${label}: yaroqsiz yo‘q — qayta urinish shart emas`;
  const nowOk = idx.filter((i) => last.get(i) && last.get(i).ok).length;
  return `${label}: ${idx.length} ta yaroqsiz edi → qayta urinishdan keyin ${nowOk} ta PASS, ${idx.length - nowOk} ta FAIL`;
};
const summary = { at: new Date().toISOString(), plans: sum(planFile, N_PLANS), tasks: sum(taskFile, N_TASKS) };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
const md = [
  `# YANG AI v5 ommaviy sinov (${summary.at})`,
  ``,
  `| Bo'lim | Jami | PASS | FAIL | O'rtacha vaqt |`,
  `|---|---|---|---|---|`,
  `| Rejalar (100 xil) | ${summary.plans.total} | ${summary.plans.pass} | ${summary.plans.fail} | ${(summary.plans.sec / Math.max(1, summary.plans.total)).toFixed(1)} s |`,
  `| Vazifalar (100 xil) | ${summary.tasks.total} | ${summary.tasks.pass} | ${summary.tasks.fail} | ${(summary.tasks.sec / Math.max(1, summary.tasks.total)).toFixed(1)} s |`,
  ``,
  `## Vazifalar turlari bo'yicha`,
  ...Object.entries(summary.tasks.kinds).map(([k, v]) => `- ${k}: ${v.pass}/${v.n}`),
  ``,
  `## Qayta urinish (faqat yaroqsizlar)`,
  `- ${retryReport(planFile, N_PLANS, 'Rejalar')}`,
  `- ${retryReport(taskFile, N_TASKS, 'Vazifalar')}`,
].join('\n');
fs.writeFileSync(path.join(OUT, 'summary.md'), md);
console.log(md);
try { fs.rmSync(plansWs, { recursive: true, force: true }); } catch {}
process.exit(summary.plans.fail || summary.tasks.fail ? 1 : 0);
