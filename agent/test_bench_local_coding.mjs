import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentEngine } from './engine.js';
import { fetchModelList } from './providers.js';

const model = process.env.YANG_BENCH_MODEL || 'qwen2.5:0.5b';
const base = process.env.YANG_BENCH_BASE || 'http://127.0.0.1:11434/v1';
const output = process.env.YANG_BENCH_OUT || path.join(os.tmpdir(), 'yang-local-coding-100');
const timeoutMs = Number(process.env.YANG_BENCH_TASK_TIMEOUT_MS || 90000);
const taskCount = Math.max(1, Math.min(100, Math.floor(Number(process.env.YANG_BENCH_TASKS) || 100)));
const provider = 'benchOllama';

fs.mkdirSync(output, { recursive: true });
const availableModels = await fetchModelList(base, 'local');
if (!availableModels.includes(model)) throw new Error(`Model ${model} yo‘q. Topilganlar: ${availableModels.join(', ')}`);

const cases = [];
for (let i = 0; i < taskCount; i++) {
  const value = String(i + 1000);
  const file = `artifact_${String(i + 1).padStart(3, '0')}.txt`;
  const marker = `YANG_BENCH_${String(i + 1).padStart(3, '0')}_${value}`;
  cases.push({
    file,
    marker,
    prompt: `Create exactly one file named ${file}. Its entire UTF-8 content must be exactly ${marker}, with no other characters. Use the write_file tool. Do not create any other file.`,
  });
}

const config = {
  provider,
  model,
  keys: { [provider]: 'local' },
  customProviders: [{ id: provider, name: 'Ollama local benchmark', base, models: [model], key: 'local' }],
  autoApprove: true,
  providerHealth: {},
  disabledProviders: [],
  pinMode: true,
  translate: { enabled: false },
};

const taskFile = path.join(output, 'tasks.jsonl');
const existing = fs.existsSync(taskFile)
  ? fs.readFileSync(taskFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];
// Only reuse results for this model and generated case set; stale/partial rows from another
// benchmark configuration must never contaminate the score.
const matchingRows = existing.filter((row) =>
  row.model === model &&
  Number.isInteger(row.index) && row.index >= 0 && row.index < cases.length &&
  row.file === cases[row.index].file && row.marker === cases[row.index].marker
);
const done = new Map(matchingRows.map((row) => [row.index, row]));
const writeRows = () => {
  const rows = [...done.values()].sort((a, b) => a.index - b.index);
  fs.writeFileSync(taskFile, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
};
const started = Date.now();
const writeSummary = (wallSeconds = (Date.now() - started) / 1000) => {
  const rows = [...done.values()].sort((a, b) => a.index - b.index);
  const pass = rows.filter((row) => row.ok).length;
  const summary = {
    at: new Date().toISOString(), model, completed: rows.length, pass, fail: rows.length - pass,
    rate: rows.length ? pass / rows.length : 0,
    maxFinalRate: (pass + Math.max(0, cases.length - rows.length)) / cases.length,
    avgSeconds: rows.length ? rows.reduce((sum, row) => sum + row.seconds, 0) / rows.length : 0,
    wallSeconds,
    acceptance: 'PASS only when write_file tool args, exact on-disk UTF-8 bytes, and workspace file list all match expected output.',
  };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(output, 'summary.md'), [
    `# Strict local coding benchmark: ${model}`,
    '',
    `- Completed: ${summary.completed}/${cases.length}`,
    `- Pass: ${summary.pass}`,
    `- Fail: ${summary.fail}`,
    `- Rate: ${(summary.rate * 100).toFixed(1)}%`,
    `- Best possible final rate if all remaining tasks pass: ${(summary.maxFinalRate * 100).toFixed(1)}%`,
    `- Average/task: ${summary.avgSeconds.toFixed(1)} s`,
    `- Wall time: ${summary.wallSeconds.toFixed(1)} s`,
    '',
    summary.acceptance,
    '',
    '## Failures',
    ...rows.filter((row) => !row.ok).map((row) => `- #${row.index + 1} ${row.file}: timeout=${row.timeout}, tool=${row.toolOk}, exact=${row.contentExact}, only-file=${row.onlyExpectedFile}, toolArgsMatch=${row.toolArgsMatch}, contentExact=${row.contentExact}, workspaceFiles=${JSON.stringify(row.workspaceFiles)}, error=${row.error || 'none'}`),
  ].join('\n'));
  return summary;
};
const workspaces = path.join(output, 'workspaces');
fs.mkdirSync(workspaces, { recursive: true });
writeSummary();

for (let index = 0; index < cases.length; index++) {
  if (done.has(index)) continue;
  const task = cases[index];
  const workspace = path.join(workspaces, `task_${String(index + 1).padStart(3, '0')}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  const engine = new AgentEngine({ config, workspace, maxSteps: 5 });
  const events = [];
  engine.on('event', (event) => events.push(event));
  const time = Date.now();
  let timer;
  let error = null;
  let timedOut = false;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        engine.abort();
        reject(new Error(`timeout ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const run = engine.run({ events: [], userText: task.prompt });
    await Promise.race([run, timeout]);
    await run;
  } catch (caught) {
    error = String(caught.message || caught);
  } finally {
    clearTimeout(timer);
  }
  const requestedPath = path.join(workspace, task.file);
  const actual = fs.existsSync(requestedPath) ? fs.readFileSync(requestedPath, 'utf8') : null;
  const fileList = fs.readdirSync(workspace).sort();
  const writeEvents = events.filter((event) => event.type === 'tool' && event.tool === 'write_file' && event.ok);
  const toolArgsMatch = writeEvents.some((event) =>
    typeof event.args?.path === 'string' && path.basename(event.args.path) === task.file && event.args?.content === task.marker
  );
  const toolOk = toolArgsMatch;
  const expectedFileSet = fileList.length === 1 && fileList[0] === task.file;
  const ok = !error && toolOk && actual === task.marker && expectedFileSet;
  const row = {
    index, model, file: task.file, marker: task.marker, ok,
    seconds: (Date.now() - time) / 1000,
    timeout: timedOut,
    toolOk,
    toolArgsMatch,
    contentExact: actual === task.marker,
    onlyExpectedFile: expectedFileSet,
    workspaceFiles: fileList,
    toolCalls: writeEvents.map((event) => ({ path: event.args?.path, content: event.args?.content, ok: event.ok })),
    tools: events.filter((event) => event.type === 'tool_start').map((event) => event.tool),
    error,
  };
  done.set(index, row);
  writeRows();
  const pass = [...done.values()].filter((item) => item.ok).length;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${index + 1}/${cases.length} · ${(Date.now() - time) / 1000}s · ${task.file} · pass=${pass}/${done.size}${error ? ` · ${error.slice(0, 100)}` : ''}`);
  const summary = writeSummary((Date.now() - started) / 1000);
  if (summary.maxFinalRate < 0.9) {
    console.log(`BOUND_REACHED: 90% no longer attainable (best possible ${(summary.maxFinalRate * 100).toFixed(1)}%); stopping early.`);
    break;
  }
}

const summary = writeSummary((Date.now() - started) / 1000);
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.completed === cases.length && summary.rate >= 0.9 ? 0 : 1;
