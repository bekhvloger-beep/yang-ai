// bench_ide_assisted.mjs — lokal modelni "IDE qo'li bilan" sinash.
//
// Farqi: oddiy benchmark modeldan fayl yozishni so'raydi va natijani tekshiradi.
// Bu skript ikki rejimni taqqoslaydi:
//   A) one-shot  — model bir marta yozadi (IDE feedback yo'q).
//   B) ide-loop  — IDE kabi: fayl yozilgach tekshiruv ISHGA TUSHIRILADI va xato
//                  matni modelga qaytariladi; model tuzatadi (2 martagacha).
// Shu bilan "kuchsiz lokal model IDE bilan qo'l oyoqli bo'ladi" degan faraz
// o'lchanadi.
//
// Ishga tushirish:
//   node agent/bench_ide_assisted.mjs
// Env:
//   YANG_IDE_BENCH_MODELS=qwen2.5-coder:7b,llama3:8b
//   YANG_IDE_BENCH_TASKS=factorial,slugify,fizzbuzz,median_bug
//   YANG_IDE_BENCH_OUT=reports/local_ai
//   YANG_IDE_BENCH_TIMEOUT_MS=120000   YANG_IDE_BENCH_REPAIRS=2
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentEngine } from './engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = process.env.YANG_IDE_BENCH_OLLAMA || 'http://127.0.0.1:11434';
// Model yozuvi:  `model:tag` — Ollama'dan;  `local:model-x.gguf` — ilova ichidagi (bundled)
// llama.cpp bilan. Ikkalasi bir yurishda sinovdan o'tadi va bitta hisobotga tushadi.
const MODELS = (process.env.YANG_IDE_BENCH_MODELS || 'qwen2.5-coder:7b,local:model-qwen3-4b-2507.gguf')
  .split(',').map((s) => s.trim()).filter(Boolean);
const LOCAL_DIR = path.resolve(ROOT, 'local-ai');
const LOCAL_EXE = path.join(LOCAL_DIR, 'lc', 'llama-server.exe');
// 8082 — ilovaning o'zi ishlatadigan port; sinov uchun alohida port olamiz (to'qnashmasin).
const LOCAL_PORT = Number(process.env.YANG_IDE_BENCH_LOCAL_PORT) || 8085;
const LOCAL_BASE = `http://127.0.0.1:${LOCAL_PORT}/v1`;
const isLocalModel = (m) => String(m).startsWith('local:');
const localFile = (m) => String(m).slice('local:'.length);
// Parametr sonini fayl nomidan taxmin qilamiz (faqat hisobot uchun, o'lchovga ta'siri yo'q).
function guessParams(file) {
  const m = String(file).match(/(\d+(?:\.\d+)?)b/i);
  return m ? `${m[1]}B` : null;
}
let localServer = null;
let localServerCtx = null;

// Kontekst kattaligi xotiraga bog'liq: 8192 o'lchami 4B modelda ~1.15 GB KV kesh so'raydi va
// RAM band bo'lsa yuklash "failed to allocate buffer for kv cache" bilan yiqiladi
// (o'lchandi: 4B + 8192, bo'sh RAM 2.4 GB — yiqildi). Shu sababli kichraytirib qayta urinamiz.
const CTX_LADDER = [8192, 4096, 2048];

async function tryLocalServer(file, abs, ctx, logPath) {
  const logFd = fs.openSync(logPath, 'w');
  const child = spawn(LOCAL_EXE, ['-m', abs, '--alias', file, '--host', '127.0.0.1', '--port', String(LOCAL_PORT), '-c', String(ctx), '--reasoning', 'off', '--no-webui'], {
    cwd: LOCAL_DIR, stdio: ['ignore', logFd, logFd], windowsHide: true,
  });
  child.on('error', () => {});
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) { try { fs.closeSync(logFd); } catch {} return { ok: false, reason: `server ${ctx} kontekst bilan yiqildi (exit ${child.exitCode})` }; }
    if (Date.now() - started > 120000) { try { child.kill(); } catch {} try { fs.closeSync(logFd); } catch {} return { ok: false, reason: `${ctx} kontekstda 120 s ichida ko'tarilmadi` }; }
    try {
      const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/v1/models`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) break;
    } catch {}
    await sleep(600);
  }
  return { ok: true, child, logFd, ctx, readySeconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
}

async function startLocalServer(modelKey) {
  const file = localFile(modelKey);
  const abs = path.join(LOCAL_DIR, file);
  if (!fs.existsSync(LOCAL_EXE)) throw new Error(`llama-server.exe topilmadi: ${LOCAL_EXE}`);
  if (!fs.existsSync(abs)) throw new Error(`gguf topilmadi: ${abs}`);
  const logPath = path.join(OUT_DIR, `llama-${file}.log`);
  const reasons = [];
  for (const ctx of CTX_LADDER) {
    const attempt = await tryLocalServer(file, abs, ctx, logPath);
    if (attempt.ok) {
      localServer = attempt.child;
      localServer.on('exit', () => { if (localServer === attempt.child) localServer = null; });
      localServerCtx = ctx;
      return { readySeconds: attempt.readySeconds, ctx };
    }
    reasons.push(attempt.reason);
    await sleep(700);
  }
  throw new Error(`lokal server ko'tarilmadi: ${reasons.join('; ')}`);
}

function stopLocalServer() {
  if (!localServer) return;
  try { localServer.kill(); } catch {}
  localServer = null;
}
const TASK_FILTER = (process.env.YANG_IDE_BENCH_TASKS || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = path.resolve(ROOT, process.env.YANG_IDE_BENCH_OUT || 'reports/local_ai');
const TASK_TIMEOUT_MS = Math.max(20000, Number(process.env.YANG_IDE_BENCH_TIMEOUT_MS) || 120000);
const REPAIRS = Math.max(0, Math.min(3, Number(process.env.YANG_IDE_BENCH_REPAIRS) || 2));
const PYTHON = process.env.YANG_IDE_BENCH_PYTHON || 'python';
const NODE = process.env.YANG_IDE_BENCH_NODE || process.execPath;
const CHECK_TIMEOUT_MS = 20000;

const CHECK_FACTORIAL = `import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('m', pathlib.Path('factorial.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.factorial(0) == 1, 'factorial(0) = %r, kutilgan 1' % (m.factorial(0),)
assert m.factorial(1) == 1, m.factorial(1)
assert m.factorial(5) == 120, m.factorial(5)
assert m.factorial(8) == 40320, m.factorial(8)
print('OK')
`;
const CHECK_SLUGIFY = `import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('m', pathlib.Path('slugify.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
cases = [('Salom Dunyo! 2026', 'salom-dunyo-2026'), ('Hello,  World--Test', 'hello-world-test'), ('  AI  ', 'ai')]
for value, expected in cases:
    actual = m.slugify(value)
    assert actual == expected, 'slugify(%r) = %r, kutilgan %r' % (value, actual, expected)
print('OK')
`;
const CHECK_FIZZBUZZ = `import { fizzbuzz } from './fizzbuzz.mjs';
const got = fizzbuzz(5);
if (got !== '1 2 Fizz 4 Buzz') throw new Error('fizzbuzz(5) = ' + JSON.stringify(got));
const got15 = fizzbuzz(15).split(' ');
if (got15[14] !== 'FizzBuzz' || got15[2] !== 'Fizz' || got15[4] !== 'Buzz') throw new Error('fizzbuzz(15) oxiri xato: ' + got15.slice(12).join(' '));
console.log('OK');
`;
const CHECK_MEDIAN = `import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('m', pathlib.Path('median.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.median([3, 1, 2]) == 2, m.median([3, 1, 2])
assert m.median([1, 2, 3, 4]) == 2.5, 'median([1,2,3,4]) = %r, kutilgan 2.5' % (m.median([1, 2, 3, 4]),)
assert m.median([5]) == 5, m.median([5])
print('OK')
`;
// Buzuq boshlang'ich fayl: juft sonda o'rta ikki sonning o'rtachasini emas, yuqorisini qaytaradi.
const BUGGY_MEDIAN = `def median(values):
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid]
`;

const NO_EXTRA = 'Do not create any other file.';
const TASKS = [
  {
    name: 'factorial',
    file: 'factorial.py',
    prompt: `Create exactly one file named factorial.py. Define factorial(n) returning n! for an integer n, with 0! equal to 1. Use a for loop and an accumulator. No imports, no comments, no docstrings, no type hints. ${NO_EXTRA} Use the write_file tool.`,
    check: { lang: 'python', content: CHECK_FACTORIAL },
  },
  {
    name: 'slugify',
    file: 'slugify.py',
    prompt: `Create exactly one file named slugify.py. Define slugify(text) that lowercases the text, replaces every run of non-alphanumeric characters with a single "-", and strips leading/trailing "-". Examples: slugify("Salom Dunyo! 2026") is "salom-dunyo-2026"; slugify("Hello,  World--Test") is "hello-world-test"; slugify("  AI  ") is "ai". No imports other than "import re" if you need it. ${NO_EXTRA} Use the write_file tool.`,
    check: { lang: 'python', content: CHECK_SLUGIFY },
  },
  {
    name: 'fizzbuzz',
    file: 'fizzbuzz.mjs',
    prompt: `Create exactly one file named fizzbuzz.mjs. It must export a function fizzbuzz(n) that returns the numbers 1..n joined by a single space, where multiples of 3 become Fizz, multiples of 5 become Buzz and multiples of both become FizzBuzz. fizzbuzz(5) must return "1 2 Fizz 4 Buzz". ${NO_EXTRA} Use the write_file tool.`,
    check: { lang: 'node', content: CHECK_FIZZBUZZ },
  },
  {
    name: 'median_bug',
    file: 'median.py',
    prompt: `The file median.py in this folder contains a bug. The file check_median.py tests it. Fix median.py so that the test passes (for an even number of values the median is the average of the two middle values), keeping the function name and signature. Run the test with run_command to confirm. Do not modify check_median.py.`,
    check: { lang: 'python', content: CHECK_MEDIAN },
    seed: { file: 'median.py', content: BUGGY_MEDIAN },
  },
].filter((t) => !TASK_FILTER.length || TASK_FILTER.includes(t.name));

fs.mkdirSync(OUT_DIR, { recursive: true });
// LOCAL_DIR/OUT_DIR yuqorida ishlatiladi (server logi shu papkaga yoziladi).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonRequest(url, options = {}, timeout = 8000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function modelCatalog() {
  let catalog = {};
  try {
    const tags = await jsonRequest(`${OLLAMA}/api/tags`);
    catalog = Object.fromEntries((tags.models || []).map((m) => [m.name, {
      kind: 'ollama', sizeBytes: m.size, params: m.details?.parameter_size, quant: m.details?.quantization_level, context: m.details?.context_length,
    }]));
  } catch (e) {
    console.log(`[warn] Ollama /api/tags o‘qilmadi: ${e.message}`);
  }
  // Ilova ichidagi (bundled) gguf modellari — har biri disk hajmi bilan qayd etiladi.
  for (const key of MODELS.filter(isLocalModel)) {
    const abs = path.join(LOCAL_DIR, localFile(key));
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    catalog[key] = { kind: 'bundled', sizeBytes: size, params: guessParams(localFile(key)), quant: /q4/i.test(localFile(key)) ? 'Q4_K_M' : null, context: 8192 };
  }
  return catalog;
}

function engineConfig(model, base) {
  const id = 'benchLocal';
  return {
    provider: id, model, keys: { [id]: 'local' },
    customProviders: [{ id, name: 'Bench lokal', base: base || `${OLLAMA}/v1`, models: [model], key: 'local' }],
    autoApprove: true, providerHealth: {}, disabledProviders: [], pinMode: true,
    translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
  };
}

// Bitta engine yurishi; qaytadi: { seconds, error, toolCalls, wroteTarget }
async function engineRun({ model, workspace, prompt, maxSteps, base }) {
  const engine = new AgentEngine({ config: engineConfig(model, base), workspace, maxSteps });
  const events = [];
  engine.on('event', (event) => events.push(event));
  const started = Date.now();
  let error = null;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { try { engine.abort(); } catch {} reject(new Error(`task timeout ${TASK_TIMEOUT_MS}ms`)); }, TASK_TIMEOUT_MS);
    });
    const run = engine.run({ events: [], userText: prompt });
    await Promise.race([run, timeout]);
  } catch (caught) {
    error = String(caught.message || caught);
  } finally {
    clearTimeout(timer);
  }
  return {
    seconds: (Date.now() - started) / 1000,
    error,
    toolCalls: events.filter((e) => e.type === 'tool_start').map((e) => e.tool),
    wroteFiles: events.filter((e) => e.type === 'tool' && e.tool === 'write_file' && e.ok).map((e) => String(e.args?.path || '')),
  };
}

function runCheck(task, workspace) {
  const checkName = task.check.lang === 'node' ? `check_${task.name}.mjs` : `check_${task.name}.py`;
  fs.writeFileSync(path.join(workspace, checkName), task.check.content, 'utf8');
  const started = Date.now();
  const cmd = task.check.lang === 'node'
    ? [NODE, [checkName]]
    : [PYTHON, ['-I', '-B', checkName]];
  const res = spawnSync(cmd[0], cmd[1], { cwd: workspace, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, windowsHide: true });
  const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
  return { ok: res.status === 0, output: output.slice(0, 1200), seconds: (Date.now() - started) / 1000, checkName };
}

async function prepareWorkspace(task) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `yang-idebench-${task.name}-`));
  if (task.seed) fs.writeFileSync(path.join(workspace, task.seed.file), task.seed.content, 'utf8');
  return workspace;
}

async function runMode({ model, task, mode, base }) {
  const workspace = await prepareWorkspace(task);
  const rounds = [];
  let check = { ok: false, output: 'tekshiruv ishga tushmadi' };
  const maxSteps = mode === 'one-shot' ? 4 : 8;
  const first = await engineRun({ model, workspace, prompt: task.prompt, maxSteps, base });
  rounds.push(first);
  check = runCheck(task, workspace);
  if (mode === 'ide-loop') {
    let attempt = 0;
    while (!check.ok && attempt < REPAIRS) {
      attempt += 1;
      const targetExists = fs.existsSync(path.join(workspace, task.file));
      const feedback = [
        `The automatic check failed (${task.check.lang === 'node' ? 'node' : 'python'} check_${task.name}):`,
        check.output || '(output empty)',
        '',
        `Fix the code so the check passes. ${targetExists ? `Edit ${task.file}.` : `Create ${task.file} as instructed.`} Do not change check_${task.name}.`,
      ].join('\n');
      rounds.push(await engineRun({ model, workspace, prompt: feedback, maxSteps, base }));
      check = runCheck(task, workspace);
      if (!check.ok && attempt >= REPAIRS) break;
    }
  } else if (!check.ok) {
    // one-shot rejimida ham fayl holatini yozib qo'yamiz (tahlil uchun).
  }
  const checkFile = path.join(workspace, check.checkName);
  if (fs.existsSync(checkFile)) fs.rmSync(checkFile, { force: true });
  const files = fs.readdirSync(workspace).sort();
  const artifact = path.join(workspace, task.file);
  const artifactText = fs.existsSync(artifact) ? fs.readFileSync(artifact, 'utf8').slice(0, 4000) : null;
  const seconds = rounds.reduce((sum, r) => sum + r.seconds, 0);
  const row = {
    model, task: task.name, mode, ok: check.ok, seconds: Number(seconds.toFixed(1)),
    rounds: rounds.length,
    errors: rounds.map((r) => r.error).filter(Boolean),
    toolCalls: rounds.flatMap((r) => r.toolCalls),
    wroteFiles: rounds.flatMap((r) => r.wroteFiles),
    checkOutput: check.output.slice(0, 600),
    workspaceFiles: files.filter((f) => f !== check.checkName),
    artifact: artifactText,
  };
  return { row, workspace };
}

// --- sinovdan o'tkazish ---
const runStarted = Date.now();
const catalog = await modelCatalog();
const rows = [];
const workspaces = [];
let warmup = null;

const modelStartup = {};
for (const model of MODELS) {
  if (!catalog[model]) {
    console.log(`SKIP ${model} — topilmadi (ollama list / local-ai papkasini tekshiring)`);
    continue;
  }
  const bundled = catalog[model].kind === 'bundled';
  const base = bundled ? LOCAL_BASE : `${OLLAMA}/v1`;
  const apiModel = bundled ? localFile(model) : model;
  console.log(`\n=== ${model} (${catalog[model].params || '?'}, ${catalog[model].quant || '?'}, ${bundled ? 'ilova ichida' : 'Ollama'}) ===`);
  const t0 = Date.now();
  try {
    if (bundled) {
      const st = await startLocalServer(model);
      modelStartup[model] = st.readySeconds;
      console.log(`  server: ${st.readySeconds}s da tayyor (-c ${st.ctx})`);
    }
    await jsonRequest(`${base}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer local' },
      body: JSON.stringify({ model: apiModel, messages: [{ role: 'user', content: 'Reply with READY.' }], max_tokens: 8, temperature: 0 }),
    }, 240000);
    warmup = Number(((Date.now() - t0) / 1000).toFixed(1));
    console.log(`  warm-up: ${warmup}s`);
  } catch (e) {
    console.log(`  warm-up xato: ${e.message}`);
    if (bundled) { stopLocalServer(); continue; }
  }
  for (const task of TASKS) {
    for (const mode of ['one-shot', 'ide-loop']) {
      const { row, workspace } = await runMode({ model, task, mode, base });
      rows.push(row);
      workspaces.push(workspace);
      console.log(`  ${row.ok ? 'PASS' : 'FAIL'} ${task.name.padEnd(11)} ${mode.padEnd(9)} ${row.seconds}s · qadam=${row.rounds}${row.errors.length ? ` · xato=${row.errors[0].slice(0, 70)}` : ''}`);
    }
  }
  // Har modeldan keyin xotirani bo'shatamiz — keyingi model RAM bilan kurashmasin.
  if (bundled) {
    stopLocalServer();
    await sleep(2500);
  } else {
    try {
      await jsonRequest(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }, 30000);
    } catch {}
    await sleep(1500);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, totalRamMb: Number((os.totalmem() / 1024 ** 2).toFixed(1)) },
  ollama: OLLAMA,
  tasks: TASKS.map((t) => ({ name: t.name, file: t.file, lang: t.check.lang })),
  catalog, warmupSeconds: warmup, modelStartupSeconds: modelStartup,
  models: {},
  acceptance: 'PASS = tekshiruv skripti nol kod bilan tugadi (fayl mazmuni emas, HAQIQIY ishga tushirish natijasi).',
  wallSeconds: Number(((Date.now() - runStarted) / 1000).toFixed(1)),
};
for (const model of MODELS) {
  const mine = rows.filter((r) => r.model === model);
  if (!mine.length) continue;
  const pass = (mode) => mine.filter((r) => r.mode === mode && r.ok).length;
  const total = (mode) => mine.filter((r) => r.mode === mode).length;
  const avg = (mode) => {
    const list = mine.filter((r) => r.mode === mode);
    return list.length ? Number((list.reduce((s, r) => s + r.seconds, 0) / list.length).toFixed(1)) : 0;
  };
  summary.models[model] = {
    kind: catalog[model]?.kind || 'ollama',
    params: catalog[model]?.params || null,
    quant: catalog[model]?.quant || null,
    diskBytes: catalog[model]?.sizeBytes || null,
    startupSeconds: modelStartup[model] ?? null,
    context: catalog[model]?.context || null,
    oneShot: { pass: pass('one-shot'), total: total('one-shot'), avgSeconds: avg('one-shot') },
    ideLoop: { pass: pass('ide-loop'), total: total('ide-loop'), avgSeconds: avg('ide-loop') },
    repairsUsed: mine.filter((r) => r.mode === 'ide-loop').reduce((s, r) => s + (r.rounds - 1), 0),
    perTask: Object.fromEntries(TASKS.map((t) => [t.name, {
      oneShot: mine.find((r) => r.task === t.name && r.mode === 'one-shot')?.ok ?? null,
      ideLoop: mine.find((r) => r.task === t.name && r.mode === 'ide-loop')?.ok ?? null,
      checkOutput: mine.find((r) => r.task === t.name && r.mode === 'ide-loop' && !r.ok)?.checkOutput || null,
    }])),
  };
}

fs.writeFileSync(path.join(OUT_DIR, 'bench_raw.json'), JSON.stringify({ summary, rows }, null, 2));
const lines = ['# Lokal modellar: IDE bilan / IDE siz sinov', '', `Sana: ${summary.generatedAt}`, '', summary.acceptance, '', '| Model | Params | One-shot | IDE bilan | Tuzatish qadamlari | O‘rtacha (IDE) |', '|---|---|---:|---:|---:|---:|'];
for (const [model, s] of Object.entries(summary.models)) {
  lines.push(`| ${model} | ${s.params || '?'} | ${s.oneShot.pass}/${s.oneShot.total} | ${s.ideLoop.pass}/${s.ideLoop.total} | ${s.repairsUsed} | ${s.ideLoop.avgSeconds}s |`);
}
lines.push('', '## Vazifalar bo‘yicha', '', '| Model | Vazifa | One-shot | IDE bilan |', '|---|---|---|---|');
for (const [model, s] of Object.entries(summary.models)) {
  for (const [task, t] of Object.entries(s.perTask)) lines.push(`| ${model} | ${task} | ${t.oneShot ? 'PASS' : 'FAIL'} | ${t.ideLoop ? 'PASS' : 'FAIL'} |`);
}
lines.push('', `Umumiy vaqt: ${summary.wallSeconds}s · warm-up: ${summary.warmupSeconds}s`, '');
fs.writeFileSync(path.join(OUT_DIR, 'bench_summary.md'), lines.join('\n'));
console.log(`\n${lines.slice(6, 14).join('\n')}`);
console.log(`\nYozildi: ${path.join(OUT_DIR, 'bench_raw.json')} va bench_summary.md`);
for (const ws of workspaces) { try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} }
stopLocalServer();
