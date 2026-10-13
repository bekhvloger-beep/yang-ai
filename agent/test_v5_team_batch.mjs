// YANG AI — jamoaviy rejim (TeamRunner) ommaviy o'zbekcha sinovi.
//   100 xil o'zbekcha vazifa (20 mavzu × 5 shablon), har biri real jamoa orqali bajariladi.
// Ishlatish:
//   YANG_TEST_MODEL=model-coder-7b.gguf YANG_TEST_OUT=D:/tmp/yang-team node agent/test_v5_team_batch.mjs
//   node agent/test_v5_team_batch.mjs --tasks 5        # qisqa tekshiruv
//   node agent/test_v5_team_batch.mjs --resume         # jsonl dagi natijalarni saqlab davom ettirish
// Natijalar: OUT/team-tasks.jsonl, OUT/team-summary.md, OUT/team-summary.json.
// Shart: 127.0.0.1:8082 bo'sh bo'lishi kerak (skript llama-server'ni o'zi ko'taradi).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TeamRunner } from './team.js';
import { localServerUp } from './providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.YANG_TEST_OUT || path.join(os.tmpdir(), 'yang-team');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};
const RESUME = process.argv.includes('--resume');
const N = arg('--tasks', 100);
const TASK_TIMEOUT_MS = arg('--timeout', 1200) * 1000;

const config = {
  provider: 'localmini', model: 'qwen3-instruct', keys: {}, customProviders: [],
  autoApprove: true, providerHealth: {}, disabledProviders: [], pinMode: true,
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};

// 20 mavzu × 5 shablon = 100 xil vazifa. Har shablon aniq fayl nomini talab qiladi.
const SUBJECTS = ['kalkulyator', 'to-do ro‘yxati', 'ob-havo paneli', 'soat', 'taymer', 'daftar', 'kalendar', 'chat oynasi', 'rasm galereyasi', 'savol-javob o‘yini', 'budjet hisoblagich', 'dars jadvali', 'test veb-sayti', 'portfolio sahifasi', 'login formasi', 'qidiruv sahifasi', 'ranglar palitrasi', 'hisob mashinasi', 'til o‘rganish kartalari', 'ish rejalashtiruvchi'];
const TEMPLATES = [
  { file: 'index.html', text: (s) => `Menga ${s} uchun HTML sahifa yarating va index.html fayliga saqlang` },
  { file: 'app.py', text: (s) => `Menga ${s} uchun Python skript yozing va app.py fayliga saqlang` },
  { file: 'matn.txt', text: (s) => `Menga ${s} haqida qisqa matn yozing va matn.txt fayliga saqlang` },
  { file: 'style.css', text: (s) => `Menga ${s} uchun CSS uslub yarating va style.css fayliga saqlang` },
  { file: 'script.js', text: (s) => `Menga ${s} uchun JavaScript fayl yarating va script.js fayliga saqlang` },
];
const TASKS = [];
for (const t of TEMPLATES) for (const s of SUBJECTS) TASKS.push({ file: t.file, prompt: t.text(s) });

const resultFile = path.join(OUT, 'team-tasks.jsonl');
const readAll = () => (fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = RESUME ? new Set(readAll().map((r) => r.index)) : new Set();

if (await localServerUp(config)) {
  console.log('SKIP: 127.0.0.1:8082 allaqachon band — sinov sovuq holat talab qiladi.');
  process.exit(2);
}
const serverLog = path.join(OUT, 'llama-server.log');
const logFd = fs.openSync(serverLog, 'w');
const model = process.env.YANG_TEST_MODEL || 'model-1.7b.gguf';
const server = spawn(path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe'),
  ['-m', model, '--host', '127.0.0.1', '--port', '8082', '-c', '8192', '--reasoning', 'off', '--no-webui'],
  { cwd: path.join(ROOT, 'local-ai'), detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
server.unref();
let ready = false;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch('http://127.0.0.1:8082/v1/models', { signal: AbortSignal.timeout(2000) }); if (r.ok) { ready = true; break; } } catch {}
  await sleep(1000);
}
console.log(`model=${model} · lokal server tayyor: ${ready}\n`);
if (!ready) { spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' }); process.exit(3); }

const tasksRoot = path.join(OUT, 'workspaces');
const t0 = Date.now();
console.log(`--- JAMOA VAZIFALARI: ${N} ta (${done.size} ta avvaldan bor) ---`);
for (let i = 0; i < N && i < TASKS.length; i++) {
  if (done.has(i)) continue;
  const t = TASKS[i];
  const ws = path.join(tasksRoot, `task_${String(i + 1).padStart(3, '0')}`);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  const runner = new TeamRunner({ config, workspace: ws });
  const ev = [];
  runner.on('event', (e) => ev.push(e));
  const st = Date.now();
  let rec;
  try {
    const timeout = new Promise((_, rej) => { setTimeout(() => { try { runner.abort(); } catch {} rej(new Error(`timeout ${TASK_TIMEOUT_MS} ms`)); }, TASK_TIMEOUT_MS); });
    const res = await Promise.race([runner.run({ task: t.prompt }), timeout]);
    const fp = path.join(ws, t.file);
    const size = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
    const doneEv = ev.find((e) => e.type === 'team_done');
    const summary = String((doneEv && doneEv.summary) || (res && res.content) || '');
    const agents = ((ev.find((e) => e.type === 'team_plan') || {}).agents || []).length;
    const ok = size > 0 && !!doneEv && summary.length > 20;
    rec = { index: i, file: t.file, prompt: t.prompt, ok, sec: (Date.now() - st) / 1000, agents, bytes: size, note: `${t.file}=${size} B · agentlar=${agents} · javob=${summary.length} belgi` };
  } catch (e) {
    rec = { index: i, file: t.file, prompt: t.prompt, ok: false, sec: (Date.now() - st) / 1000, agents: 0, bytes: 0, note: String(e.message).slice(0, 100) };
  }
  fs.appendFileSync(resultFile, JSON.stringify(rec) + '\n');
  console.log(`${rec.ok ? 'PASS' : 'FAIL'} vazifa ${i + 1}/${N} · ${rec.sec.toFixed(0)} s · ${rec.note}`);
}
console.log(`--- tugadi: ${Math.round((Date.now() - t0) / 1000)} s ---`);
spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });

const rows = [...new Map(readAll().map((r) => [r.index, r])).values()].filter((r) => r.index < N);
const pass = rows.filter((r) => r.ok).length;
const summary = { model, at: new Date().toISOString(), total: rows.length, pass, fail: rows.length - pass, avgSec: rows.length ? Math.round(rows.reduce((a, r) => a + r.sec, 0) / rows.length) : 0, failed: rows.filter((r) => !r.ok).map((r) => ({ index: r.index + 1, prompt: r.prompt, note: r.note })) };
fs.writeFileSync(path.join(OUT, 'team-summary.json'), JSON.stringify(summary, null, 2));
const md = [`# Jamoaviy rejim o'zbekcha sinov (${model})`, '', `- Jami: ${summary.total} · PASS: ${pass} · FAIL: ${summary.fail} · o'rtacha: ${summary.avgSec} s`, '', '## Yiqilganlar', ...summary.failed.map((f) => `- #${f.index}: ${f.prompt} — ${f.note}`)].join('\n');
fs.writeFileSync(path.join(OUT, 'team-summary.md'), md);
console.log(md);
