// YANG AI v4 — 2/4-bosqich oqimi sinovi (real engine + real lokal model + real internet).
//   node agent/test_v4_flow.mjs
// Tekshiradi:
//   A. 🌐 Internet tool'lari: web_search va fetch_url haqiqiy natija qaytaradi (model kerak emas).
//   B. 💭🧠 Plan rejimi (4-bosqich «Plan» tugmasi): engine 'thinking' + 'plan' hodisalarini beradi,
//      hech qanday tool chaqirilmaydi (reja faqat matn).
//   C. 🚀 «Qurishni boshlash»: tasdiqlangan reja (planText) bilan ishga tushganda agent tool ishlatib
//      fayl yozadi va 'tool' hodisasida yaratilgan fayllar ro'yxati keladi.
// Shart: 127.0.0.1:8082 bo'sh bo'lishi kerak (skript o'zi llama-server ko'taradi va oxirida to'xtatadi).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentEngine } from './engine.js';
import { createToolContext } from './tools.js';
import { localServerUp } from './providers.js';

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
  pinMode: true, // faqat lokal model — sinov barqaror bo'lsin
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-v4-flow-'));
console.log(`workspace: ${workspace}\n`);

// ---------- A. Internet tool'lari (model kerak emas) ----------
try {
  const ctx = createToolContext({ workspace, config, registerChild: () => {} });
  const search = await ctx.execute('web_search', { query: 'Termiz shahri', max_results: 3 });
  const okSearch = /🔎/.test(search) && /https?:\/\//.test(search);
  check('A1. 🌐 web_search haqiqiy natija qaytaradi', okSearch, String(search).split('\n').slice(0, 2).join(' | '));

  const firstUrl = (String(search).match(/https?:\/\/\S+/) || [])[0];
  let fetchOut = '(url topilmadi)';
  if (firstUrl) fetchOut = await ctx.execute('fetch_url', { url: firstUrl, max_chars: 1500 });
  const okFetch = /📄/.test(fetchOut) && String(fetchOut).length > 200;
  check('A2. 🌐 fetch_url sahifani matnga aylantirib beradi', okFetch,
    `${String(fetchOut).length} belgi · ${String(fetchOut).split('\n')[0].slice(0, 70)}`);
} catch (e) {
  check('A. Internet tool‘lari', false, 'xato: ' + e.message);
}

// ---------- Lokal AI serverni ko'tarish ----------
if (await localServerUp(config)) {
  console.log('SKIP: 127.0.0.1:8082 allaqachon band — sinov sovuq holat talab qiladi.');
  process.exit(2);
}
const exe = path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe');
const model = fs.existsSync(path.join(ROOT, 'local-ai', 'model-1.7b.gguf')) ? 'model-1.7b.gguf' : 'model.gguf';
// Server jurnalini faylga yozamiz — nosozlik bo'lsa sababi ko'rinadi.
const serverLog = path.join(os.tmpdir(), 'yang-v4-llama.log');
const logFd = fs.openSync(serverLog, 'w');
const server = spawn(exe, ['-m', model, '--host', '127.0.0.1', '--port', '8082', '-c', '8192', '--reasoning', 'off', '--no-webui'], {
  cwd: path.join(ROOT, 'local-ai'),
  detached: true,
  stdio: ['ignore', logFd, logFd],
  windowsHide: true,
});
server.unref();
console.log(`llama-server jurnali: ${serverLog}`);
let ready = false;
for (let i = 0; i < 90; i++) {
  try {
    const res = await fetch('http://127.0.0.1:8082/v1/models', { signal: AbortSignal.timeout(2000) });
    if (res.ok) { ready = true; break; }
  } catch {}
  await sleep(1000);
}
console.log(`lokal server tayyor: ${ready} (${model})\n`);

const collect = (engine) => {
  const ev = [];
  engine.on('event', (e) => ev.push(e));
  return ev;
};

try {
  if (!ready) throw new Error('lokal server ko‘tarilmadi');

  // ---------- B. Plan rejimi ----------
  const enginePlan = new AgentEngine({ config, workspace, translateOutput: false, translateInput: false });
  const evPlan = collect(enginePlan);
  const t0 = Date.now();
  const resPlan = await enginePlan.run({ events: [], userText: 'Menga kalkulyator yasab ber', planFirst: true });
  const planEvents = evPlan.filter((e) => e.type === 'plan');
  const toolStarts = evPlan.filter((e) => e.type === 'tool_start');
  const thinking = evPlan.filter((e) => e.type === 'thinking');
  const steps = (planEvents[0] && planEvents[0].steps) || [];
  check('B1. 💭 Plan rejimida thinking hodisasi keladi', thinking.length >= 1,
    `${thinking.length} ta thinking: "${String((thinking[0] || {}).label || '').slice(0, 60)}"`);
  check('B2. 📋 Plan hodisasi qadamlar bilan keladi (tool chaqirilmaydi)',
    planEvents.length === 1 && steps.length >= 2 && toolStarts.length === 0,
    `qadamlar=${steps.length} · tool_start=${toolStarts.length} · ${Math.round((Date.now() - t0) / 1000)} s · "${steps[0] || ''}"`);

  // ---------- C. Tasdiqlangan reja bilan qurish ----------
  const engineBuild = new AgentEngine({ config, workspace, translateOutput: false, translateInput: false, maxSteps: 8 });
  const evBuild = collect(engineBuild);
  const t1 = Date.now();
  engineBuild.on('event', (e) => {
    if (e.type === 'tool_start') console.log(`      · ${e.tool} ${JSON.stringify(e.args || {}).slice(0, 90)}`);
  });
  await engineBuild.run({
    events: [],
    userText: 'Menga kalkulyator yasab ber',
    planText: '1. kalkulyator.html faylini yaratish\n2. HTML+CSS+JS bilan to‘liq ishlaydigan kalkulyator yozish',
  });
  const tools = evBuild.filter((e) => e.type === 'tool_start').map((e) => e.tool);
  const files = evBuild.filter((e) => e.type === 'files_created').flatMap((e) => e.paths || []);
  const toolWithFiles = evBuild.filter((e) => e.type === 'tool' && Array.isArray(e.files) && e.files.length);
  const written = fs.existsSync(path.join(workspace, 'kalkulyator.html'));
  check('C1. 🚀 «Qurishni boshlash» tool bilan fayl yozadi', written && tools.includes('write_file'),
    `tool'lar=[${tools.join(', ')}] · fayllar=[${files.join(', ')}] · ${Math.round((Date.now() - t1) / 1000)} s`);
  check('C2. 🐍/📄 Tool hodisasida yaratilgan fayllar ro‘yxati keladi (python natijasi uchun)',
    toolWithFiles.length >= 1 || files.length >= 1,
    `files_created=[${files.join(', ')}] · tool.files hodisalari=${toolWithFiles.length}`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
