// Lokal model kontekstiga sig'dirish sinovi (real engine + real llama-server + real model).
//   node agent/test_context_fit.mjs
//
// Nima uchun: foydalanuvchi ilovada bir xil xatoni olardi —
//   «Barcha provayderlar ishlamadi: Lokal AI (offline) · qwen3-instruct:
//    HTTP 400: request (13835 tokens) exceeds the available context size (8192 tokens)»
// (pin rejim yoqilgani uchun zaxira provayderga ham o'tilmasdi).
//
// Tekshiradi:
//   A. Kontekst hajmi serverning o'zidan o'qiladi (/props → n_ctx = 8192), so'rov hajmi
//      serverning HAQIQIY tokenizatori bilan o'lchanadi (/tokenize).
//   B. O'LCHOV (nazorat): qisqartirilmagan katta so'rov haqiqatan HTTP 400 oladi — bug reproduktsiya.
//   C. O'sha so'rov engine orqali (qisqartirish bilan) ISHLAYDI: fayl yoziladi, xato yo'q.
//   D. Jamoa/planner yo'li ham (streamChatFitted) sig'diradi: rasm olib tashlanadi, 400 yo'q.
//
// Shart: 127.0.0.1:8082 bo'sh bo'lsa skript serverni o'zi ko'taradi va oxirida to'xtatadi;
// band bo'lsa (ilova ishlab turgan bo'lsa) mavjud server ishlatiladi va TEGILMAYDI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentEngine, eventsToMessages } from './engine.js';
import {
  localServerUp,
  localContextSize,
  estimateTokens,
  fitMessagesToContext,
  CTX_SAFETY_TOKENS,
  streamChat,
  streamChatFitted,
} from './providers.js';
import { LOCAL_TOOL_SPECS } from './engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, evidence) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};

const config = {
  provider: 'localmini',
  model: 'qwen3-instruct',
  keys: {},
  customProviders: [],
  autoApprove: true,
  providerHealth: {},
  disabledProviders: [],
  pinMode: true, // foydalanuvchi skrinshotidagi holat: zaxira provayder yo'q
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};
const BASE = 'http://127.0.0.1:8082/v1';
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ctxfit-'));
console.log(`workspace: ${workspace}\n`);

// ---------- Katta tarix (skrinshotdagi 13 835 tokenga o'xshash yuk) ----------
// MUHIM (o'lchov saboqi): takrorlangan «xxxx…» matni BPE da juda ARZON tokenlanadi
// (9000 belgi ≈ 1000 token), shuning uchun eski variant haqiqiy yuklamani bermasdi va
// nazorat (B1) «yiqilmadi». Endi matn so'z aralashmasidan yasaladi va HAQIQIY token soni
// serverning o'z tokenizatoridan (/tokenize) o'qiladi — taxmin emas.
const WORDS = ['hisoblagich', 'fayl', 'natija', 'qiymat', 'funksiya', 'xato', 'satr', 'royxat', 'kod', 'model', 'lokal', 'kontekst', 'tekshiruv', 'qadam', 'javob'];
function big(label, tokens = 3200) {
  const out = [label];
  let n = 0;
  while (n < tokens) {
    const chunk = [];
    for (let i = 0; i < 24; i += 1) chunk.push(WORDS[(n + i) % WORDS.length] + (i % 7 === 0 ? ` ${n % 977}` : ''));
    out.push(chunk.join(' '));
    n += 24;
  }
  return out.join(' ');
}

/** So'rovning HAQIQIY token soni — llama-server tokenizatoridan (/tokenize). */
async function serverTokens(text) {
  try {
    const res = await fetch(BASE.replace(/\/v1\/?$/, '') + '/tokenize', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text }), signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j.tokens) ? j.tokens.length : null;
  } catch {
    return null;
  }
}

const flatText = (msgs) => msgs.map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(' '))).join('\n');
const events = [
  { type: 'user', text: 'Menga hisoblagich.py faylini yozib ber' },
  { type: 'assistant', text: 'Yozyapman', toolCalls: [{ id: 'c1', tool: 'write_file', args: { path: 'hisoblagich.py', content: 'print(1)' } }] },
  { type: 'tool', id: 'c1', result: big('hisoblagich.py yozildi') },
  { type: 'user', text: 'ishga tushirib ko‘r' },
  { type: 'assistant', text: '', toolCalls: [{ id: 'c2', tool: 'run_command', args: { command: 'python hisoblagich.py' } }] },
  { type: 'tool', id: 'c2', result: big('STDOUT: 1') },
  { type: 'user', text: 'xatoni tuzat' },
  { type: 'assistant', text: '', toolCalls: [{ id: 'c3', tool: 'read_file', args: { path: 'hisoblagich.py' } }] },
  { type: 'tool', id: 'c3', result: big('fayl mazmuni') },
];
const userText = 'Endi kalkulyator2.py faylini yozib ber va ishga tushirib natijani ko‘rsat.';
const history = eventsToMessages(events);
const rawMessages = [{ role: 'system', content: 's'.repeat(2600) }, ...history, { role: 'user', content: userText }];

let ownServer = null;
const cleanup = () => {
  if (ownServer) spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
};

try {
  // ---------- Serverni tayyorlash ----------
  let model = 'mavjud server';
  if (!(await localServerUp(config))) {
    const exe = path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe');
    model = fs.existsSync(path.join(ROOT, 'local-ai', 'model-1.7b.gguf')) ? 'model-1.7b.gguf' : 'model.gguf';
    if (!fs.existsSync(exe)) throw new Error(`llama-server.exe topilmadi: ${exe}`);
    const logPath = path.join(os.tmpdir(), 'yang-ctxfit-llama.log');
    const fd = fs.openSync(logPath, 'w');
    ownServer = spawn(exe, ['-m', model, '--host', '127.0.0.1', '--port', '8082', '-c', '8192', '--reasoning', 'off', '--no-webui'], {
      cwd: path.join(ROOT, 'local-ai'), detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
    });
    ownServer.unref();
    console.log(`llama-server jurnali: ${logPath}`);
    for (let i = 0; i < 120 && !(await localServerUp(config)); i++) await sleep(1000);
  }
  if (!(await localServerUp(config))) throw new Error('lokal server ko‘tarilmadi');
  console.log(`lokal server: ${model}\n`);

  // ---------- A. Kontekst hajmi serverdan ----------
  const ctx = await localContextSize(BASE);
  check('A1. 🧭 Kontekst hajmi serverdan o‘qiladi (/props → n_ctx)',
    ctx === 8192 || (ctx >= 2048 && ctx !== 8192),
    `/props n_ctx = ${ctx} token (ilova shu hajmga sig‘diradi, taxmin emas)`);

  const ctxTools = LOCAL_TOOL_SPECS;
  const budget = ctx - 2048 - CTX_SAFETY_TOKENS;
  const realTokens = await serverTokens(flatText(rawMessages));
  const estTokens = estimateTokens(rawMessages, ctxTools);
  check('A2. 📏 Katta so‘rov hajmi HAQIQIY tokenizator bilan o‘lchandi (skrinshotdagi holat)',
    realTokens != null && realTokens > ctx,
    `server /tokenize: ${realTokens} token (taxmin: ${estTokens}) · kontekst ${ctx} · byudjet ${budget} — sig‘maydi`);

  // ---------- B. Nazorat: qisqartirilmagan so'rov 400 oladi ----------
  let controlErr = '';
  try {
    await streamChat({
      base: BASE, key: '', model: 'qwen3-instruct', messages: rawMessages, tools: [], signal: new AbortController().signal,
      providerId: 'localmini', extraBody: { max_tokens: 64 }, onDelta: () => {},
    });
  } catch (e) {
    controlErr = String(e.message || e);
  }
  check('B1. 🔬 Nazorat: qisqartirilmagan so‘rov haqiqatan yiqiladi (bug reproduktsiyasi)',
    /exceeds the available context size|context/i.test(controlErr),
    controlErr ? `xato: ${controlErr.slice(0, 130)}` : `XATO YO‘Q — so‘rov ${realTokens} token bilan ham o‘tdi (server kontekstni o‘zi surib yubordi?)`);

  // ---------- C. Tuzatilgan yo'l: engine o'zi sig'diradi ----------
  const engine = new AgentEngine({ config, workspace, translateOutput: false, translateInput: false, maxSteps: 4 });
  const ev = [];
  engine.on('event', (e) => {
    ev.push(e);
    if (e.type === 'tool_start') console.log(`      · ${e.tool} ${JSON.stringify(e.args || {}).slice(0, 80)}`);
  });
  const t0 = Date.now();
  let runErr = '';
  try {
    await engine.run({ events, userText });
  } catch (e) {
    runErr = String(e.message || e);
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  const fitNotice = ev.find((e) => e.type === 'notice' && /sig‘dirildi|qisqartir/i.test(e.text || ''));
  const files = ev.filter((e) => e.type === 'files_created').flatMap((e) => e.paths || []);
  const wrote = fs.existsSync(path.join(workspace, 'kalkulyator2.py'));
  const fit = fitMessagesToContext([{ role: 'system', content: 's'.repeat(2600) }, ...history, { role: 'user', content: userText }], ctxTools, budget);

  check('C1. ✂️ Engine so‘rovni kontekstga sig‘dirdi (foydalanuvchiga xabar berildi)',
    !!fitNotice && fit.tokens <= budget,
    `notis: "${String((fitNotice || {}).text || '').slice(0, 90)}" · ${estTokens} → ${fit.tokens} token (byudjet ${budget})`);
  const streamed = ev.filter((e) => e.type === 'stream').map((e) => e.text || '').join('');
  const errText = runErr + JSON.stringify(ev.filter((e) => e.type === 'error' || e.type === 'notice').map((e) => e.text || ''));
  check('C2. ✅ O‘sha so‘rov endi HTTP 400 olmadi — model javob berdi',
    !runErr && !/exceeds the available context size/.test(errText) && (streamed.length > 0 || ev.some((e) => e.type === 'tool_start')),
    runErr ? `xato: ${runErr.slice(0, 140)}` : `${sec} s · javob ${streamed.length} belgi · tool'lar=[${ev.filter((e) => e.type === 'tool_start').map((e) => e.tool).join(', ')}]`);
  check('C3. 📄 Vazifa oxirigacha bajarildi (fayl yozildi)',
    wrote,
    `kalkulyator2.py: ${wrote ? 'yozildi' : 'YOZILMADI'} · fayllar=[${files.join(', ')}]`);

  // ---------- D. JAMOA (planner) yo'li: team.js ham shu sig'dirishdan o'tadimi ----------
  // Ilgari `team.js` streamChat'ni to'g'ridan-to'g'ri chaqirardi — Jamoa rejimida ayni
  // shu so'rov 400 olib, butun jamoa to'xtardi. Endi ikkalasi ham streamChatFitted ishlatadi.
  const defLocal = { base: BASE, local: true, bundled: true, name: 'Lokal AI (offline)' };
  const imgUrl = 'data:image/png;base64,' + 'A'.repeat(6000);
  const plannerMsgs = [
    { role: 'system', content: 'Texnik lead siz. Reja tuzing. '.repeat(90) },
    { role: 'user', content: [{ type: 'text', text: 'Vazifa: ' + big('reja tuzish', 2600) }, { type: 'image_url', image_url: { url: imgUrl } }] },
  ];
  let planErr = '';
  let planRes = null;
  const t1 = Date.now();
  try {
    planRes = await streamChatFitted({
      base: BASE, key: '', model: 'qwen3-instruct', messages: plannerMsgs, tools: [],
      signal: new AbortController().signal, providerId: 'localmini',
      extraBody: { max_tokens: 1200 }, guardChars: 5000, def: defLocal,
    });
  } catch (e) {
    planErr = String(e.message || e);
  }
  const planSec = Math.round((Date.now() - t1) / 1000);
  const planCtx = await serverTokens(flatText(plannerMsgs));
  check('D1. 🧩 Jamoa (planner) yo‘li ham kontekstga sig‘dirdi — 400 yo‘q',
    !planErr && !!planRes && planRes.fit.tokens <= planRes.budget,
    planErr
      ? `xato: ${planErr.slice(0, 140)}`
      : `so‘rov ${planCtx} token → ${planRes.fit.tokens} token (byudjet ${planRes.budget}, kontekst ${planRes.ctx}) · urinish ${planRes.attempts}`);
  check('D2. 🖼️ Rasm olib tashlandi (ilova ichidagi model uni ko‘ra olmaydi) va model javob berdi',
    !!planRes && planRes.fit.images >= 1 && String(planRes.result.content || '').length > 0,
    planRes
      ? `rasm qismi: ${planRes.fit.images} · ${planSec} s · javob ${String(planRes.result.content || '').length} belgi`
      : `o‘lchanmadi (${planErr.slice(0, 80)})`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  cleanup();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
