import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentEngine } from './engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = process.env.YANG_COMPARE_PYTHON || 'python';
const LOCAL_BASE = 'http://127.0.0.1:8082/v1';
const OLLAMA_BASE = process.env.YANG_COMPARE_OLLAMA_BASE || 'http://127.0.0.1:11434';
const MODEL_7B = process.env.YANG_COMPARE_7B_MODEL || 'qwen2.5-coder:7b';
const TASK_TIMEOUT_MS = Math.max(30000, Math.min(180000, Number(process.env.YANG_COMPARE_TASK_TIMEOUT_MS) || 120000));
const CASE_FILTER = (process.env.YANG_COMPARE_CASES || '').split(',').map((name) => name.trim()).filter(Boolean);
const OUTPUT_DIR = process.env.YANG_COMPARE_OUT || path.join(ROOT, 'agent');
const RESULT_STEM = CASE_FILTER.length ? `bench_local_comparison_${CASE_FILTER.join('_')}` : 'bench_local_comparison';
const RESULT_JSON = path.join(OUTPUT_DIR, `${RESULT_STEM}.json`);
const RESULT_MD = path.join(OUTPUT_DIR, `${RESULT_STEM}.md`);
const SERVER_LOG = path.join(os.tmpdir(), 'yang-compare-llama-server.log');
const OLLAMA_ROOT_PIDS = new Set();
let processTreeSamplingAvailable = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CASES = [
  {
    name: 'twice',
    file: 'twice.py',
    args: ['n'],
    tests: [[[-7], -14], [[0], 0], [[13], 26]],
    prompt: 'Create exactly one file named twice.py. Define twice(n), returning n multiplied by 2. No imports, comments, docstrings, type hints, or extra files. Use write_file. The function must handle negative integers and zero.',
  },
  {
    name: 'sum_to_n',
    file: 'sum_to_n.py',
    args: ['n'],
    tests: [[[0], 0], [[1], 1], [[10], 55], [[1000], 500500]],
    prompt: 'Create exactly one file named sum_to_n.py. Its only top-level statement is the function sum_to_n(n), which returns the inclusive sum 1+2+...+n and 0 for n=0. Use the formula n*(n+1)//2. No imports, comments, docstrings, type hints, or other top-level statements. Use write_file.',
  },
  {
    name: 'clamp',
    file: 'clamp.py',
    args: ['value', 'lower', 'upper'],
    tests: [[[-5, 0, 10], 0], [[0, 0, 10], 0], [[4, 0, 10], 4], [[10, 0, 10], 10], [[15, 0, 10], 10], [[-3, -8, 2], -3]],
    prompt: 'Create exactly one file named clamp.py. Define clamp(value, lower, upper), returning lower if value is below lower, upper if above upper, otherwise value. No imports, comments, docstrings, type hints, or extra files. Use write_file. Assume lower <= upper.',
  },
  {
    name: 'is_even',
    file: 'is_even.py',
    args: ['n'],
    tests: [[[-4], true], [[0], true], [[7], false], [[18], true]],
    prompt: 'Create exactly one file named is_even.py. Define is_even(n), returning the boolean True exactly when integer n is even and False otherwise. No imports, comments, docstrings, type hints, or extra files. Use write_file.',
  },
  {
    name: 'factorial',
    file: 'factorial.py',
    args: ['n'],
    tests: [[[0], 1], [[1], 1], [[5], 120], [[8], 40320]],
    prompt: 'Create exactly one file named factorial.py. Define factorial(n), which returns n! for integer n from 0 through 8. Use a for loop and accumulator. No imports, comments, docstrings, type hints, or extra files. Use write_file.',
  },

  {
    name: 'shipping_fee', file: 'shipping_fee.py', args: ['weight'],
    tests: [[[0], 0], [[1], 5], [[2], 5], [[3], 10], [[10], 10], [[11], 20]],
    prompt: 'Create exactly one file named shipping_fee.py. Define shipping_fee(weight): return 0 for weight <= 0, 5 for weight <= 2, 10 for weight <= 10, and 20 otherwise. No imports, comments, docstrings, type hints, or extra files. Use write_file.',
  },
  {
    name: 'letter_grade', file: 'letter_grade.py', args: ['score'],
    tests: [[[100], 'A'], [[90], 'A'], [[89], 'B'], [[80], 'B'], [[79], 'C'], [[70], 'C'], [[69], 'D'], [[60], 'D'], [[59], 'F'], [[0], 'F']],
    prompt: 'Create exactly one file named letter_grade.py. Define letter_grade(score): return A for scores >=90, B for >=80, C for >=70, D for >=60, else F. No imports, comments, docstrings, type hints, or extra files. Use write_file.',
  },
];

const UNKNOWN_CASES = CASE_FILTER.filter((name) => !CASES.some((item) => item.name === name));
assert.equal(UNKNOWN_CASES.length, 0, `Unknown benchmark case(s): ${UNKNOWN_CASES.join(', ')}`);
const BENCH_CASES = CASE_FILTER.length ? CASES.filter((item) => CASE_FILTER.includes(item.name)) : CASES;
assert.ok(BENCH_CASES.length > 0, 'At least one benchmark case must be selected.');

const AST_VALIDATOR = String.raw`
import ast,json,pathlib,sys
file=pathlib.Path(sys.argv[1]); spec=json.loads(sys.argv[2]); source=file.read_text(encoding='utf-8')
source='\n'.join(line for line in source.splitlines() if not line.lstrip().startswith('#')); tree=ast.parse(source)
allowed={ast.Module,ast.FunctionDef,ast.arguments,ast.arg,ast.Return,ast.If,ast.IfExp,ast.BinOp,ast.UnaryOp,ast.Compare,ast.BoolOp,ast.And,ast.Or,ast.Not,ast.Tuple,ast.USub,ast.UAdd,ast.Add,ast.Sub,ast.Mult,ast.Pow,ast.FloorDiv,ast.Div,ast.Mod,ast.Eq,ast.NotEq,ast.Lt,ast.LtE,ast.Gt,ast.GtE,ast.In,ast.NotIn,ast.BitAnd,ast.Name,ast.Load,ast.Store,ast.Constant,ast.Assign,ast.AugAssign,ast.Expr,ast.Pass,ast.For,ast.Call}
if len(tree.body)!=1 or not isinstance(tree.body[0],ast.FunctionDef): raise SystemExit('expected one top-level function and no other statements')
fn=tree.body[0]
if fn.name!=spec['name'] or [a.arg for a in fn.args.args]!=spec['args'] or fn.args.vararg or fn.args.kwarg or fn.args.kwonlyargs or fn.args.defaults or fn.decorator_list or fn.returns: raise SystemExit('function name/signature/decorators do not match')
if any(a.annotation for a in fn.args.args): raise SystemExit('type annotations are outside this benchmark subset')
local_names=set(spec['args'])
for node in ast.walk(fn):
 if type(node) not in allowed: raise SystemExit('blocked syntax: '+type(node).__name__)
 if isinstance(node,ast.Expr) and isinstance(node.value,ast.Constant) and isinstance(node.value.value,str): continue
 if isinstance(node,ast.Constant) and (type(node.value) not in (int,str,bool,type(None)) or (type(node.value) is int and abs(node.value)>10000)): raise SystemExit('blocked constant')
 if isinstance(node,ast.Call) and (not isinstance(node.func,ast.Name) or node.func.id not in {'range','sum'} or node.keywords): raise SystemExit('only range() and sum() calls are allowed')
 if isinstance(node,ast.Assign):
  if len(node.targets)!=1 or not isinstance(node.targets[0],ast.Name): raise SystemExit('blocked assignment target')
  local_names.add(node.targets[0].id)
 if isinstance(node,ast.AugAssign):
  if not isinstance(node.target,ast.Name): raise SystemExit('blocked augmented assignment target')
  local_names.add(node.target.id)
 if isinstance(node,ast.For):
  if not isinstance(node.target,ast.Name): raise SystemExit('blocked loop target')
  local_names.add(node.target.id)
 if isinstance(node,ast.Name) and node.id not in local_names|{'range','sum'}: raise SystemExit('unknown name: '+node.id)
 if isinstance(node,ast.Call) and node.func.id=='range':
  for arg in node.args:
   if not isinstance(arg,(ast.Name,ast.Constant,ast.BinOp)): raise SystemExit('range arguments must be simple expressions')
namespace={'__builtins__':{'range':range,'sum':sum}}
exec(compile(tree,str(file),'exec'),namespace,namespace)
fn=namespace[spec['name']]
for args,expected in spec['tests']:
 actual=fn(*args)
 if type(actual) is not type(expected) or actual!=expected: raise SystemExit('wrong result for '+repr(args)+': '+repr(actual)+' != '+repr(expected))
print('PASS '+spec['name']+' '+str(len(spec['tests']))+' cases')
`;

function pythonAvailable() {
  const result = spawnSync(PYTHON, ['-c', 'import ast'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(result.status, 0, `Python is required for isolated behavior checks: ${result.stderr || result.error || 'not available'}`);
}

async function jsonRequest(url, options = {}, timeout = 5000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${text.slice(0, 400)}`);
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error(`${url} returned invalid JSON`); }
}

async function unloadOllama(model) {
  await jsonRequest(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }, 20000);
  for (let i = 0; i < 20; i++) {
    const status = await jsonRequest(`${OLLAMA_BASE}/api/ps`);
    if (!(status.models || []).some((item) => item.name === model || item.model === model)) return;
    await delay(500);
  }
  throw new Error(`Could not unload ${model} from Ollama; the Ollama service remains running.`);
}

async function warmup(base, model) {
  const started = Date.now();
  const response = await jsonRequest(`${base}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer local' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with READY.' }], max_tokens: 8, temperature: 0 }),
  }, 180000);
  assert.ok(response.choices?.[0]?.message?.content?.trim(), `${model} warm-up returned no text`);
  return (Date.now() - started) / 1000;
}

function startMemorySampler(rootPids) {
  const samplerScript = String.raw`
import json,psutil,sys,time
roots=[int(x) for x in sys.argv[1:] if x.isdigit()]
while True:
 rss=0
 for pid in roots:
  try:
   root = psutil.Process(pid)
   rss += root.memory_info().rss
   for child in root.children(recursive=True):
    try: rss += child.memory_info().rss
    except (psutil.Error,ProcessLookupError): pass
  except (psutil.Error,ProcessLookupError): pass
 print(json.dumps({'rss':rss,'available':psutil.virtual_memory().available}),flush=True)
 time.sleep(.5)
`;
  if (!processTreeSamplingAvailable || rootPids.length === 0) return { stop: async () => ({ available: false, note: processTreeSamplingAvailable ? 'model process not available for sampling' : 'Python psutil unavailable' }) };
  const child = spawn(PYTHON, ['-u', '-c', samplerScript, ...rootPids.map(String)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const metrics = { available: true, samples: 0, peakProcessTreeRssMb: 0, minSystemAvailableRamMb: null };
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      try {
        const sample = JSON.parse(line);
        metrics.samples++;
        metrics.peakProcessTreeRssMb = Math.max(metrics.peakProcessTreeRssMb, sample.rss / 1024 ** 2);
        const availableMb = sample.available / 1024 ** 2;
        metrics.minSystemAvailableRamMb = metrics.minSystemAvailableRamMb === null ? availableMb : Math.min(metrics.minSystemAvailableRamMb, availableMb);
      } catch {}
    }
  });
  return {
    stop: async () => {
      if (child.exitCode === null) child.kill();
      await new Promise((resolve) => child.once('close', resolve));
      metrics.peakProcessTreeRssMb = Number(metrics.peakProcessTreeRssMb.toFixed(1));
      if (metrics.minSystemAvailableRamMb !== null) metrics.minSystemAvailableRamMb = Number(metrics.minSystemAvailableRamMb.toFixed(1));
      return metrics;
    },
  };
}

function processInfo() {
  const script = String.raw`import json,psutil; out={'psutil':True,'ollama':[],'children':[]};
for p in psutil.process_iter(['pid','name']):
 n=(p.info['name'] or '').lower()
 if n=='ollama.exe':
  out['ollama'].append(p.pid)
  try: out['children'].extend({'pid':c.pid,'name':c.name()} for c in p.children(recursive=True))
  except psutil.Error: pass
print(json.dumps(out))`;
  const result = spawnSync(PYTHON, ['-c', script], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (result.status === 0) {
    try { return JSON.parse(result.stdout.trim()); } catch {}
  }
  const powershell = String.raw`$ids = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'ollama.exe' } | ForEach-Object { $_.ProcessId }); $children = @(Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { @{pid=$_.ProcessId;name=$_.Name} }); @{psutil=$false;ollama=$ids;children=$children} | ConvertTo-Json -Compress`;
  const fallback = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershell], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (fallback.status !== 0) return { psutil: false, ollama: [], children: [] };
  try { return JSON.parse(fallback.stdout.trim()); } catch { return { psutil: false, ollama: [], children: [] }; }
}

function engineConfig(kind) {
  if (kind === 'bundled-1.7b') return {
    provider: 'localmini', model: 'qwen3-instruct', keys: {}, customProviders: [], autoApprove: true,
    providerHealth: {}, disabledProviders: [], pinMode: true, translate: { enabled: false },
  };
  const id = 'compareOllama';
  return {
    provider: id, model: MODEL_7B, keys: { [id]: 'local' },
    customProviders: [{ id, name: 'Ollama Qwen2.5-Coder', base: `${OLLAMA_BASE}/v1`, models: [MODEL_7B], key: 'local' }],
    autoApprove: true, providerHealth: {}, disabledProviders: [], pinMode: true, translate: { enabled: false },
  };
}

async function runCase(kind, spec, base, pids) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `yang-compare-${kind}-${spec.name}-`));
  const engine = new AgentEngine({ config: engineConfig(kind), workspace, maxSteps: 5 });
  const events = [];
  engine.on('event', (event) => events.push(event));
  const sampler = startMemorySampler(pids);
  const started = Date.now();
  let timer;
  let error = null;
  let timedOut = false;
  try {
    const timed = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        engine.abort();
        reject(new Error(`task timeout ${TASK_TIMEOUT_MS}ms`));
      }, TASK_TIMEOUT_MS);
    });
    const running = engine.run({ events: [], userText: spec.prompt });
    await Promise.race([running, timed]);
  } catch (caught) {
    error = String(caught.message || caught);
  } finally {
    clearTimeout(timer);
  }
  const modelSeconds = (Date.now() - started) / 1000;
  const memory = await sampler.stop();
  let verification;
  const filePath = path.join(workspace, spec.file);
  const workspaceFiles = fs.readdirSync(workspace).sort();
  const writeEvents = events.filter((event) => event.type === 'tool' && event.tool === 'write_file');
  const pathMatched = writeEvents.some((event) => typeof event.args?.path === 'string' && path.resolve(workspace, event.args.path) === filePath && event.ok);
  if (!error && pathMatched && fs.existsSync(filePath)) {
    const checked = spawnSync(PYTHON, ['-I', '-B', '-c', AST_VALIDATOR, filePath, JSON.stringify(spec)], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    verification = { ok: checked.status === 0, output: (checked.stdout || checked.stderr || checked.error?.message || '').trim().slice(0, 300) };
  } else {
    verification = { ok: false, output: error || (pathMatched ? 'target file missing' : 'successful write_file event for exact requested path missing') };
  }
  const tokens = [...events].reverse().find((event) => event.type === 'usage');
  const row = {
    case: spec.name, file: spec.file,
    pass: !error && pathMatched && workspaceFiles.length === 1 && workspaceFiles[0] === spec.file && verification.ok,
    seconds: Number(modelSeconds.toFixed(2)), timedOut,
    toolCalls: events.filter((event) => event.type === 'tool').length,
    successfulWrites: writeEvents.filter((event) => event.ok).length,
    exactRequestedPathWritten: pathMatched,
    onlyExpectedFile: workspaceFiles.length === 1 && workspaceFiles[0] === spec.file,
    outputTokens: tokens?.output ?? null,
    inputTokens: tokens?.input ?? null,
    verification,
    resources: memory,
    error,
  };
  fs.rmSync(workspace, { recursive: true, force: true });
  return row;
}

async function waitReady(base, modelId, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const models = await jsonRequest(`${base}/models`, {}, 3000);
      if ((models.data || []).some((item) => item.id === modelId)) return (Date.now() - started) / 1000;
    } catch {}
    await delay(500);
  }
  throw new Error(`Local llama-server did not become ready: ${base}/models`);
}

function summarize(kind, warmupSeconds, rows) {
  const values = rows.map((row) => row.seconds).sort((a, b) => a - b);
  return {
    model: kind === 'bundled-1.7b' ? 'Qwen3-1.7B (bundled GGUF)' : MODEL_7B,
    pass: rows.filter((row) => row.pass).length,
    total: rows.length,
    passRate: rows.length ? rows.filter((row) => row.pass).length / rows.length : 0,
    meanSeconds: values.length ? Number((values.reduce((sum, x) => sum + x, 0) / values.length).toFixed(2)) : null,
    medianSeconds: values.length ? Number(values[Math.floor(values.length / 2)].toFixed(2)) : null,
    warmupSeconds: Number(warmupSeconds.toFixed(2)),
    rows,
  };
}

let localServer = null;
let localLogFd = null;
let ollamaWasLoaded = false;
let report;
try {
  pythonAvailable();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const hostInfo = processInfo();
  processTreeSamplingAvailable = hostInfo.psutil;
  if (!processTreeSamplingAvailable) console.log('NOTE: Python psutil missing; per-model RSS sampling will be unavailable.');
  for (const pid of hostInfo.ollama) OLLAMA_ROOT_PIDS.add(pid);
  const tagged = await jsonRequest(`${OLLAMA_BASE}/api/tags`);
  assert.ok((tagged.models || []).some((item) => item.name === MODEL_7B), `Ollama model is not installed: ${MODEL_7B}`);
  const occupied = await fetch(`${LOCAL_BASE}/models`, { signal: AbortSignal.timeout(1000) }).then((response) => response.ok).catch(() => false);
  assert.ok(!occupied, 'Port 8082 is already serving; refusing to terminate or interfere with an existing local server.');
  const runningServers = processInfo();
  assert.ok(runningServers.ollama.length, 'Could not identify the already-running Ollama process; benchmark stopped to avoid changing an untracked service.');
  // Ollama normally runs each loaded model in a child llama-server process. Do not kill that
  // child: unload only through the Ollama API below, then let the benchmark reload the model.
  const modelStatus = await jsonRequest(`${OLLAMA_BASE}/api/ps`);
  ollamaWasLoaded = (modelStatus.models || []).some((item) => item.name === MODEL_7B || item.model === MODEL_7B);
  if (ollamaWasLoaded) {
    console.log(`Unloading ${MODEL_7B} from Ollama memory for a fair, sequential bundled-model run (Ollama service stays up).`);
    await unloadOllama(MODEL_7B);
  }

  const binary = path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe');
  const modelFile = path.join(ROOT, 'local-ai', 'model-1.7b.gguf');
  assert.ok(fs.existsSync(binary) && fs.existsSync(modelFile), 'Bundled llama-server.exe or model-1.7b.gguf is missing.');
  localLogFd = fs.openSync(SERVER_LOG, 'w');
  localServer = spawn(binary, ['-m', modelFile, '--alias', 'qwen3-instruct', '--host', '127.0.0.1', '--port', '8082', '-c', '8192', '--reasoning', 'off', '--no-webui'], {
    cwd: path.dirname(modelFile), stdio: ['ignore', localLogFd, localLogFd], windowsHide: true,
  });
  const readySeconds = await waitReady(LOCAL_BASE, 'qwen3-instruct');
  const bundledWarmup = await warmup(LOCAL_BASE, 'qwen3-instruct');
  console.log(`Bundled 1.7B ready in ${readySeconds.toFixed(1)}s; warm-up ${bundledWarmup.toFixed(1)}s.`);
  const bundledRows = [];
  for (const spec of BENCH_CASES) {
    const row = await runCase('bundled-1.7b', spec, LOCAL_BASE, [localServer.pid]);
    bundledRows.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} Qwen3-1.7B · ${spec.name} · ${row.seconds}s · tools=${row.toolCalls} · ${row.verification.output}`);
  }      const bundledSummary = summarize('bundled-1.7b', bundledWarmup, bundledRows);
  const partialReport = {
    generatedAt: new Date().toISOString(),
    caseSelection: BENCH_CASES.map((item) => item.name),
    benchmark: `${BENCH_CASES.length} identical deterministic Python tasks. This partial report records the bundled-model run; Ollama results are still pending.`,
    environment: { platform: process.platform, arch: process.arch, cpuCount: os.cpus().length, totalSystemRamMb: Number((os.totalmem() / 1024 ** 2).toFixed(1)), gpuMemoryMeasured: false, bundledStartupSeconds: Number(readySeconds.toFixed(2)) },
    models: [bundledSummary],
    caseSelection: BENCH_CASES.map((item) => item.name),
    limitations: ['Ollama 7B results are pending in this partial report.', 'GPU VRAM is not measured.'],
  };
  fs.writeFileSync(RESULT_JSON, JSON.stringify(partialReport, null, 2));
  fs.writeFileSync(RESULT_MD, ['# Local coding model comparison — partial', '', `Generated: ${partialReport.generatedAt}`, '', `Bundled Qwen3-1.7B results (${BENCH_CASES.length} tasks): ${bundledSummary.pass}/${bundledSummary.total} pass.`, '', '| Task | Result | Seconds | Verification |', '|---|---:|---:|---|', ...bundledRows.map((row) => `| ${row.case} | ${row.pass ? 'PASS' : 'FAIL'} | ${row.seconds} | ${row.verification.output} |`), '', 'Ollama 7B run is pending.', ''].join('\\n'));
  const bundledFailures = bundledRows.filter((row) => !row.pass);
  if (bundledFailures.length) console.error(`BUNDLED_FAILURES: ${bundledFailures.map((row) => row.case).join(', ')}`);

  localServer.kill();
  await new Promise((resolve) => localServer.once('close', resolve));
  localServer = null;
  if (localLogFd !== null) { fs.closeSync(localLogFd); localLogFd = null; }

  const pids = [...OLLAMA_ROOT_PIDS];
  assert.ok(OLLAMA_ROOT_PIDS.size, 'Could not identify the already-running Ollama process to restore its model residency safely.');
  const ollamaWarmup = await warmup(`${OLLAMA_BASE}/v1`, MODEL_7B);
  console.log(`Ollama ${MODEL_7B} warm-up ${ollamaWarmup.toFixed(1)}s.`);
  const coderRows = [];
  for (const spec of BENCH_CASES) {
    const row = await runCase('ollama-7b', spec, `${OLLAMA_BASE}/v1`, pids);
    coderRows.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${MODEL_7B} · ${spec.name} · ${row.seconds}s · tools=${row.toolCalls} · ${row.verification.output}`);
  }
  const coderSummary = summarize('ollama-7b', ollamaWarmup, coderRows);
  const ollamaStatus = await jsonRequest(`${OLLAMA_BASE}/api/ps`);
  const loaded7b = (ollamaStatus.models || []).find((item) => item.name === MODEL_7B || item.model === MODEL_7B) || null;
  report = {
    generatedAt: new Date().toISOString(),
    benchmark: `${BENCH_CASES.length} selected deterministic Python coding tasks (see caseSelection); each passes only if a successful write_file targeted the requested file, that is the only workspace artifact, and a restricted-AST Python harness validates and executes every expected behavior case.`,
    caseSelection: BENCH_CASES.map((item) => item.name),
    environment: {
      platform: process.platform, arch: process.arch, cpuCount: os.cpus().length,
      totalSystemRamMb: Number((os.totalmem() / 1024 ** 2).toFixed(1)),
      gpuMemoryMeasured: false,
      ollamaServicePids: [...OLLAMA_ROOT_PIDS],
      notes: ['Models were run sequentially and warmed before timed tasks.', 'Peak process-tree RSS and minimum available host RAM are sampled when Python psutil is installed; GPU VRAM is not measured.', 'Ollama service stays running; if its model was already loaded it is unloaded temporarily before the bundled model and is loaded again for its benchmark.'],
      bundledStartupSeconds: Number(readySeconds.toFixed(2)),
      ollamaLoadedAfterBenchmark: loaded7b ? { name: loaded7b.name || loaded7b.model, sizeBytes: loaded7b.size ?? null, vramBytes: loaded7b.size_vram ?? null } : null,
    },
    models: [bundledSummary, coderSummary],
    limitations: [`${BENCH_CASES.length} deterministic, small Python tasks are still a synthetic sample, not a broad coding-quality estimate.`, 'Warm inference latency is reported separately from each model warm-up.', 'Memory sampling does not measure dedicated GPU VRAM.'],
  };
  fs.writeFileSync(RESULT_JSON, JSON.stringify(report, null, 2));
  const lines = [
    '# Local coding model comparison', '',
    `Generated: ${report.generatedAt}`, '',
    `Both models ran the same ${BENCH_CASES.length} selected Python tasks sequentially after a warm-up request; see the JSON caseSelection for the exact subset. The complete task library spans arithmetic and control-flow patterns. A case counts as a pass only when the agent successfully calls write_file on the exact requested path, creates no extra workspace file, and the restricted-AST harness runs all expected behavior cases successfully.`, '',
    '| Model | Pass rate | Mean task time | Median task time | Warm-up |',
    '|---|---:|---:|---:|---:|',
    ...report.models.map((model) => `| ${model.model} | ${model.pass}/${model.total} (${(model.passRate * 100).toFixed(0)}%) | ${model.meanSeconds}s | ${model.medianSeconds}s | ${model.warmupSeconds}s |`),
    '', '## Per-task results',
    ...report.models.flatMap((model) => ['', `### ${model.model}`, '', '| Task | Result | Seconds | Tool calls | Peak process RSS | Min available RAM | Verification |', '|---|---:|---:|---:|---:|---:|---|', ...model.rows.map((row) => `| ${row.case} | ${row.pass ? 'PASS' : 'FAIL'} | ${row.seconds} | ${row.toolCalls} | ${row.resources.peakProcessTreeRssMb ?? 'n/a'} MB | ${row.resources.minSystemAvailableRamMb ?? 'n/a'} MB | ${row.verification.output.replace(/\|/g, '\\|')} |`)]),
    '', '## Measurement notes',
    `- Host: ${report.environment.platform}/${report.environment.arch}, ${report.environment.cpuCount} logical CPUs, ${report.environment.totalSystemRamMb} MB RAM.`,
    `- Bundled model server startup: ${report.environment.bundledStartupSeconds}s.`,
    '- Timed tasks exclude model/server startup and the separate warm-up request.',
    '- GPU VRAM is not measured; RSS is the sampled process-tree resident memory and host RAM is a system-wide available-memory low-water mark.',
    `- This ${BENCH_CASES.length}-task comparison is still small and synthetic; it does not estimate broad coding accuracy.`,
  ];
  fs.writeFileSync(RESULT_MD, lines.join('\n') + '\n');
  const failures = report.models.flatMap((model) => model.rows.filter((row) => !row.pass).map((row) => `${model.model}/${row.case}`));
  console.log(`\nReports: ${RESULT_MD}\n${JSON.stringify(report.models.map(({ model, pass, total, meanSeconds, medianSeconds }) => ({ model, pass, total, meanSeconds, medianSeconds })), null, 2)}`);
  if (failures.length) {
    console.error(`BENCHMARK_FAILURES: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`BENCHMARK_ABORTED: ${error.stack || error}`);
  console.error(`If startup failed, inspect ${SERVER_LOG}`);
  process.exitCode = 1;
} finally {
  if (localServer && localServer.exitCode === null) {
    localServer.kill();
    await new Promise((resolve) => localServer.once('close', resolve));
  }
  if (localLogFd !== null) fs.closeSync(localLogFd);
  // Restore the user's original persistent Ollama model residency if this run was interrupted
  // before its benchmark request naturally loaded the model again.
  if (ollamaWasLoaded) {
    try {
      await jsonRequest(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL_7B, prompt: ' ', keep_alive: -1, stream: false, options: { num_predict: 1 } }),
      }, 180000);
    } catch (error) {
      console.error(`Ollama model residency restore note: ${String(error.message || error).slice(0, 200)}`);
    }
  }
}
