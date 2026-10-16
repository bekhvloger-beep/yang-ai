// Uzoq suhbat smoke testi — HAQIQIY 8192-kontekstli lokal model bilan, 20+ navbat.
//   node agent/test_long_chat.mjs
//
// Nega kerak: `agent/test_context_fit.mjs` bitta KATTA so'rovni tekshiradi (8/8 PASS).
// Lekin foydalanuvchi ilovada uzoq suhbat olib boradi: har navbatda tarix o'sadi va
// bir nuqtadan keyin u kontekstdan katta bo'ladi. Ilgari aynan shu holatda
//   «Barcha provayderlar ishlamadi: Lokal AI (offline) · qwen3-instruct:
//    HTTP 400: request (13835 tokens) exceeds the available context size (8192 tokens)»
// xatosi chiqardi va pin rejimda butun suhbat to'xtardi. Bu skript o'sha yo'lni
// NAVBATMA-NAVBAT yurib tekshiradi.
//
// O'lchov HAQIQIY: har navbatda modelga YUBORILGAN so'rov tanasi ushlanadi (fetch
// o'raladi) va token soni ikkala manbadan olinadi —
//   (a) llama-serverning o'zi qaytargan `usage.prompt_tokens` (eng ishonchli),
//   (b) serverning tokenizatori `/tokenize` (mustaqil tasdiq).
// Taxmin (`estimateTokens`) faqat ilova qarori uchun; bu yerda u tekshirilmaydi.
//
// Tekshiriladi:
//   A. Server 8192 kontekst bilan ko'tarildi; kontekst /props dan o'qildi.
//   B. Har navbat QABUL QILINDI: HTTP 400 «exceeds the available context size» yo'q,
//      model javob berdi (matn yoki tool chaqiruvi).
//   C. Yuborilgan so'rov HAJMI kontekstdan oshmadi (a + b o'lchovlari).
//   D. Tarix kontekstdan KATTA bo'lib qoldi va ilova uni qisqartirdi (notis chiqdi) —
//      ya'ni qisqartirish haqiqatan ishlayapti, tasodifan sig'ib qolgani yo'q.
//   E. Suhbat oxirigacha ishladi: model kamida bitta fayl YOZDI.
//
// Env:
//   YANG_LONGCHAT_TURNS=22          navbatlar soni
//   YANG_LONGCHAT_MODEL=model-1.7b.gguf
//   YANG_LONGCHAT_PORT=8082
//   YANG_LONGCHAT_OUT=reports/local_ai/long_chat
//   YANG_LONGCHAT_MAX_STEPS=2       har navbatdagi model qadamlari
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentEngine, eventsToMessages } from './engine.js';
import { localServerUp, localContextSize, CTX_SAFETY_TOKENS } from './providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.YANG_LONGCHAT_PORT) || 8082;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const TURNS = Math.max(4, Number(process.env.YANG_LONGCHAT_TURNS) || 22);
const MAX_STEPS = Math.max(1, Number(process.env.YANG_LONGCHAT_MAX_STEPS) || 2);
const OUT_DIR = path.resolve(ROOT, process.env.YANG_LONGCHAT_OUT || 'reports/local_ai/long_chat');
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

// ---------- Yuborilgan so'rovni ushlash (o'lchovning asosi) ----------
// `streamChat` ichida `fetch` chaqiriladi; biz global fetch'ni o'rab, modelga ketgan
// HAQIQIY tanani saqlaymiz. Boshqa so'rovlarga (`/props`, `/tokenize`) tegmaymiz.
const sent = []; // { n, body }
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (init && typeof init.body === 'string' && u.includes('/chat/completions')) {
    try {
      sent.push({ n: sent.length + 1, body: JSON.parse(init.body) });
    } catch { /* buzilgan tana — hisobga olinmaydi */ }
  }
  return realFetch(url, init);
};

/** So'rovning HAQIQIY token soni — server tokenizatori orqali (mustaqil tasdiq). */
async function serverTokens(text) {
  try {
    const res = await realFetch(`http://127.0.0.1:${PORT}/tokenize`, {
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
const flat = (messages) => (messages || [])
  .map((m) => {
    const c = m.content;
    if (typeof c === 'string') return `${m.role}: ${c}`;
    if (Array.isArray(c)) return `${m.role}: ${c.map((p) => p.text || '').join(' ')}`;
    return `${m.role}:`;
  })
  .join('\n');

// ---------- Tarixni o'stiruvchi haqiqiy yuklamalar ----------
// Ilovada har navbatda fayl yoziladi/o'qiladi va natija tarixga tushadi. Shu sababli
// sinov ham xuddi shunday: model javobidan keyin navbat tool natijasi bilan to'ldiriladi
// (matn HAQIQIY — kod ko'rinishida, shuning uchun arzon tokenlanmaydi).
function payload(label, lines = 90) {
  const out = [`${label}:`];
  for (let i = 0; i < lines; i += 1) {
    out.push(`def qadam_${i}(qiymat):  # ${i}-qator`);
    out.push(`    natija = qiymat * ${i + 2} + len(str(qiymat))`);
    out.push('    return natija');
  }
  return out.join('\n');
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-longchat-'));
fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`workspace: ${workspace}\nnavbatlar: ${TURNS} · port: ${PORT}\n`);

let ownServer = null;
const cleanup = () => {
  if (ownServer) {
    try { ownServer.kill(); } catch { /* allaqachon to'xtagan */ }
    spawnSync('taskkill', ['/F', '/PID', String(ownServer.pid)], { stdio: 'ignore' });
  }
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* */ }
};

const turns = [];      // navbat bo'yicha o'lchovlar
let ctx = null;
let fitNotice = null;
let wroteFiles = [];

try {
  // ---------- Serverni ko'tarish ----------
  let model = 'mavjud server';
  if (!(await localServerUp(config))) {
    const exe = path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe');
    const wanted = process.env.YANG_LONGCHAT_MODEL || 'model-1.7b.gguf';
    model = fs.existsSync(path.join(ROOT, 'local-ai', wanted)) ? wanted : 'model.gguf';
    if (!fs.existsSync(exe)) throw new Error(`llama-server.exe topilmadi: ${exe}`);
    if (!fs.existsSync(path.join(ROOT, 'local-ai', model))) throw new Error(`gguf topilmadi: local-ai/${model}`);
    const logPath = path.join(OUT_DIR, `llama-${model}.log`);
    const fd = fs.openSync(logPath, 'w');
    ownServer = spawn(exe, ['-m', model, '--host', '127.0.0.1', '--port', String(PORT), '-c', '8192', '--reasoning', 'off', '--no-webui'], {
      cwd: path.join(ROOT, 'local-ai'), detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
    });
    ownServer.unref();
    console.log(`llama-server jurnali: ${logPath}`);
    for (let i = 0; i < 120 && !(await localServerUp(config)); i += 1) await sleep(1000);
  }
  if (!(await localServerUp(config))) throw new Error('lokal server ko‘tarilmadi');
  console.log(`lokal server: ${model}\n`);

  ctx = await localContextSize(BASE);
  check('A1. 🧭 Server HAQIQIY kontekst bilan ko‘tarildi (/props → n_ctx)',
    ctx >= 2048,
    `n_ctx = ${ctx} token (${model})`);

  // ---------- Suhbat: navbatma-navbat ----------
  const events = [];
  const engine = new AgentEngine({ config, workspace, translateOutput: false, translateInput: false, maxSteps: MAX_STEPS });
  const notices = [];
  const created = [];
  engine.on('event', (e) => {
    if (e.type === 'notice') notices.push(String(e.text || ''));
    if (e.type === 'files_created') created.push(...(e.paths || []));
  });

  // Ilova `usage` hodisasini `{ input, output }` ko'rinishida beradi; `input` — modelga
  // yuborilgan prompt tokenlarining YIG'INDISI (serverning o'zi hisoblagan, taxmin emas).
  let serverPromptTokens = null;
  engine.on('usage', (u) => {
    const p = Number(u && u.input);
    if (Number.isFinite(p) && p > 0) serverPromptTokens = p;
  });

  for (let i = 1; i <= TURNS; i += 1) {
    // Vazifalar navbatma-navbat: fayl yozish (tool) va qisqa savol (matn).
    const writing = i % 3 !== 0;
    const userText = writing
      ? `Faqat bitta fayl yoz: modul_${i}.py — ichida funksiya qadam_${i}(x) bo‘lsin, x*${i} qaytarsin. Ortiqcha izoh yozma.`
      : `Qisqa javob ber: ${i}-navbatdami? Faqat «ha» yoki «yo‘q» yoz.`;

    let err = '';
    let streamed = '';
    let toolCalls = [];
    serverPromptTokens = null;
    const onStream = (e) => { if (e.type === 'stream') streamed += e.text || ''; };
    const onTool = (e) => { if (e.type === 'tool_start') toolCalls.push({ id: e.id || `t${toolCalls.length + 1}`, tool: e.tool, args: e.args || {} }); };
    engine.on('event', onStream);
    engine.on('event', onTool);
    const before = sent.length;
    const t0 = Date.now();
    try {
      await engine.run({ events, userText });
    } catch (e) {
      err = String(e && e.message || e);
    }
    const seconds = (Date.now() - t0) / 1000;
    engine.off('event', onStream);
    engine.off('event', onTool);

    const turnSent = sent.slice(before);
    // (b) tokenizator bilan mustaqil o'lchov (eng katta yuborilgan so'rov)
    let measured = null;
    if (turnSent.length) {
      const biggest = turnSent.reduce((a, b2) => (JSON.stringify(a.body).length > JSON.stringify(b2.body).length ? a : b2), turnSent[0]);
      measured = await serverTokens(flat(biggest.body.messages));
    }
    const overflow = turnSent.some((s) => measured !== null && measured > ctx);
    const answered = streamed.trim().length > 0 || toolCalls.length > 0;
    const badError = /exceeds the available context size|HTTP 400/i.test(err + ' ' + notices.slice(-3).join(' '));

    turns.push({
      turn: i, kind: writing ? 'yozish' : 'savol', seconds: Number(seconds.toFixed(1)),
      calls: turnSent.length, usagePromptTokens: serverPromptTokens, measuredTokens: measured,
      error: err || null, answered, toolCalls: toolCalls.map((t) => t.tool),
    });
    const mark = (!err && answered && !overflow) ? '✓' : '✗';
    console.log(`  ${mark} ${String(i).padStart(2)}-navbat ${writing ? 'yozish' : 'savol '} · ${seconds.toFixed(1)}s · so‘rov ${turnSent.length} ta · o‘lchandi ${measured ?? '?'} token${serverPromptTokens ? ` (server: ${serverPromptTokens})` : ''}${toolCalls.length ? ` · tool: ${toolCalls.map((t) => t.tool).join(',')}` : ''}${err ? ` · XATO: ${err.slice(0, 90)}` : ''}`);

    // Tarixni haqiqiy suhbat kabi o'stiramiz (keyingi navbat shu tarixni ko'radi).
    events.push({ type: 'user', text: userText });
    events.push({ type: 'assistant', text: streamed, toolCalls });
    if (toolCalls.length) {
      for (const t of toolCalls) {
        const target = String((t.args && (t.args.path || t.args.command)) || `modul_${i}.py`);
        events.push({ type: 'tool', id: t.id, result: payload(`${t.tool} → ${target} bajarildi`, 40) });
      }
    } else if (!writing) {
      // Savol navbatida ilova odatda faylni o'qiydi/muharrirga oladi — shunday natija qo'shamiz.
      events.push({ type: 'assistant', text: '', toolCalls: [{ id: `r${i}`, tool: 'read_file', args: { path: `modul_${i}.py` } }] });
      events.push({ type: 'tool', id: `r${i}`, result: payload(`read_file → modul_${i}.py (${i}-navbat)`, 120) });
    }
    if (!writing) {
      // Har uchinchi navbatda kattaroq yuklama (real loyihada fayl o'qish natijasi).
      events.push({ type: 'assistant', text: '', toolCalls: [{ id: `b${i}`, tool: 'read_file', args: { path: 'loyiha.py' } }] });
      events.push({ type: 'tool', id: `b${i}`, result: payload(`read_file → loyiha.py (${i}-navbat, katta fayl)`, 220) });
    }
  }

  const okTurns = turns.filter((t) => !t.error && t.answered && t.measuredTokens !== null && t.measuredTokens <= ctx);
  const errored = turns.filter((t) => t.error);
  const overflowTurns = turns.filter((t) => t.measuredTokens !== null && t.measuredTokens > ctx);
  const unanswered = turns.filter((t) => !t.error && !t.answered);

  check('B1. 🧵 Har navbat QABUL QILINDI — HTTP 400 «exceeds the available context size» yo‘q',
    errored.length === 0,
    errored.length
      ? `${errored.length}/${TURNS} navbat xato: ${errored.slice(0, 3).map((t) => `${t.turn}: ${String(t.error).slice(0, 80)}`).join(' | ')}`
      : `${TURNS}/${TURNS} navbat xatosiz (pin rejim — zaxira provayder yo‘q edi)`);
  check('B2. 💬 Har navbatda model javob berdi (matn yoki tool chaqiruvi)',
    unanswered.length === 0,
    unanswered.length ? `javobsiz: ${unanswered.map((t) => t.turn).join(', ')}` : `barcha ${TURNS} navbatda javob bor`);
  check('C1. 📏 Yuborilgan so‘rov hajmi kontekstdan OSHMADI (server /tokenize bilan o‘lchandi)',
    overflowTurns.length === 0 && turns.every((t) => t.measuredTokens !== null),
    overflowTurns.length
      ? `oshib ketgan: ${overflowTurns.map((t) => `${t.turn}-navbat ${t.measuredTokens} token`).join(', ')} (kontekst ${ctx})`
      : `eng katta so‘rov: ${Math.max(...turns.map((t) => t.measuredTokens || 0))} token · kontekst ${ctx}`);

  // Tarix (qisqartirilmagan) kontekstdan KATTA bo'ldimi? Bo'lmasa sinov yuklama bermagan.
  const rawTokens = await serverTokens(flat(eventsToMessages(events)));
  fitNotice = notices.find((t) => /sig‘dirildi|qisqartir/i.test(t)) || null;
  check('D1. 📚 Suhbat tarixi kontekstdan KATTA bo‘ldi (sinov haqiqiy yuklama berdi)',
    rawTokens !== null && rawTokens > ctx,
    `tarix (qisqartirilmagan) = ${rawTokens} token · kontekst ${ctx} — ${rawTokens > ctx ? `${(rawTokens / ctx).toFixed(1)}× katta` : 'SIG‘DI (yuklama kam!)'}`);
  check('D2. ✂️ Ilova tarixni qisqartirdi va bu foydalanuvchiga AYTILDI',
    !!fitNotice,
    fitNotice ? `notis: "${fitNotice.slice(0, 110)}"` : 'qisqartirish notisi chiqmadi (tarix sig‘ib ketgan bo‘lishi mumkin)');

  wroteFiles = [...new Set([
    ...created,
    ...fs.readdirSync(workspace).filter((f) => f.endsWith('.py')),
  ])];
  check('E1. 📄 Suhbat oxirigacha ISHLADI — model fayl yozdi',
    wroteFiles.length > 0,
    wroteFiles.length ? `yozilgan fayllar: ${wroteFiles.join(', ')} (${wroteFiles.length} ta)` : 'hech qanday fayl yozilmadi');

  const total = turns.reduce((s, t) => s + t.seconds, 0);
  const avg = total / turns.length;
  check('F1. ⏱️ Vaqt o‘lchandi (har navbat o‘rtacha)',
    Number.isFinite(avg) && avg > 0,
    `${TURNS} navbat · jami ${(total / 60).toFixed(1)} daqiqa · o‘rtacha ${avg.toFixed(1)} s/navbat · eng sekin ${Math.max(...turns.map((t) => t.seconds))} s`);
} catch (e) {
  check('umumiy oqim', false, `kutilmagan xato: ${e && e.message}`);
} finally {
  cleanup();
}

// ---------- Hisobot ----------
const failed = results.filter((r) => !r.ok).length;
const summary = {
  generatedAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, totalRamMb: Number((os.totalmem() / 1024 ** 2).toFixed(0)) },
  turns: TURNS, maxSteps: MAX_STEPS, contextTokens: ctx, safetyTokens: CTX_SAFETY_TOKENS,
  wroteFiles, fitNotice, perTurn: turns,
  totals: {
    seconds: Number(turns.reduce((s, t) => s + t.seconds, 0).toFixed(1)),
    requests: turns.reduce((s, t) => s + t.calls, 0),
    errors: turns.filter((t) => t.error).length,
    maxMeasuredTokens: turns.length ? Math.max(...turns.map((t) => t.measuredTokens || 0)) : null,
    maxUsagePromptTokens: turns.length ? Math.max(...turns.map((t) => t.usagePromptTokens || 0)) : null,
  },
  checks: results,
  verdict: failed ? `${results.length - failed}/${results.length} PASS` : `${results.length}/${results.length} PASS`,
};
try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'long_chat.json'), JSON.stringify(summary, null, 2), 'utf8');
  const lines = [
    '# Uzoq suhbat smoke testi (lokal model, 8192 kontekst)', '',
    `Sana: ${summary.generatedAt}`, '',
    `Kontekst: ${ctx} token · navbatlar: ${TURNS} · har navbatda qadam: ${MAX_STEPS} · o‘lchov: server /tokenize + usage.prompt_tokens`, '',
    '| # | Tur | Soniyalar | Yuborilgan so‘rovlar | O‘lchangan token | Server hisobi | Tool | Xato |',
    '|---|---|---:|---:|---:|---:|---|---|',
    ...turns.map((t) => `| ${t.turn} | ${t.kind} | ${t.seconds} | ${t.calls} | ${t.measuredTokens ?? '—'} | ${t.usagePromptTokens ?? '—'} | ${t.toolCalls.join(', ') || '—'} | ${t.error ? String(t.error).slice(0, 60) : '—'} |`),
    '',
    `Eng katta yuborilgan so‘rov: ${summary.totals.maxMeasuredTokens} token (kontekst ${ctx})`,
    `Jami: ${(summary.totals.seconds / 60).toFixed(1)} daqiqa · ${summary.totals.requests} so‘rov · xatolar: ${summary.totals.errors}`,
    `Yozilgan fayllar: ${wroteFiles.join(', ') || '—'}`,
    '',
    `XULOSA: ${summary.verdict}`, '',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'long_chat.md'), lines.join('\n'), 'utf8');
  console.log(`\nHisobot: ${path.relative(ROOT, path.join(OUT_DIR, 'long_chat.md'))}`);
} catch (e) {
  console.log(`⚠ hisobotni yozib bo‘lmadi: ${e.message}`);
}

console.log(`\nXULOSA: ${summary.verdict}`);
process.exit(failed ? 1 : 0);
