// YANG AI v4 — 5-bosqich: jamoaviy rejim sinxronligi sinovi (real TeamRunner + lokal model).
//   node agent/test_v5_team.mjs
// Tekshiradi: planner taqsimoti, har bir agentga "jamoa doskasi" berilishi (sinxronlik),
// agentlar natijalari, reviewer → lead (yakuniy javob faqat Lead'da) tartibi.
// Shart: 127.0.0.1:8082 bo'sh (skript llama-server'ni o'zi ko'taradi va oxirida to'xtatadi).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TeamRunner } from './team.js';
import { localServerUp } from './providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, evidence) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};

const config = {
  provider: 'localmini', model: 'qwen3-instruct', keys: {}, customProviders: [],
  autoApprove: true, providerHealth: {}, disabledProviders: [], pinMode: true,
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-v5-team-'));
console.log(`workspace: ${workspace}\n`);

if (await localServerUp(config)) {
  console.log('SKIP: 127.0.0.1:8082 band — sinov sovuq holat talab qiladi.');
  process.exit(2);
}
const serverLog = path.join(os.tmpdir(), 'yang-v5-team-llama.log');
const logFd = fs.openSync(serverLog, 'w');
const server = spawn(path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe'),
  ['-m', process.env.YANG_TEST_MODEL || 'model-1.7b.gguf', '--host', '127.0.0.1', '--port', '8082', '-c', '8192', '--reasoning', 'off', '--no-webui'],
  { cwd: path.join(ROOT, 'local-ai'), detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
server.unref();
let ready = false;
for (let i = 0; i < 90; i++) {
  try { const r = await fetch('http://127.0.0.1:8082/v1/models', { signal: AbortSignal.timeout(2000) }); if (r.ok) { ready = true; break; } } catch {}
  await sleep(1000);
}
console.log(`lokal server tayyor: ${ready} · jurnal: ${serverLog}\n`);

const boards = new Map(); // agent nomi → unga berilgan jamoa doskasi
try {
  if (!ready) throw new Error('lokal server ko‘tarilmadi');
  const runner = new TeamRunner({ config, workspace });
  const ev = [];
  runner.on('event', (e) => ev.push(e));
  const origRunAgent = runner.runAgent.bind(runner);
  runner.runAgent = async (args) => { boards.set(args.name, args.teamBoard || ''); return origRunAgent(args); };

  const task = 'Ikkita kichik fayl yarating: salom.txt ichida «Salom YANG AI» yozuvi, raqamlar.txt ichida «1 2 3» raqamlari bo‘lsin.';
  const t0 = Date.now();
  const timeout = new Promise((_, rej) => { setTimeout(() => { try { runner.abort(); } catch {} rej(new Error('umumiy timeout (15 daqiqa)')); }, 900000); });
  const res = await Promise.race([runner.run({ task }), timeout]);
  const secs = Math.round((Date.now() - t0) / 1000);

  const planEv = ev.filter((e) => e.type === 'team_plan');
  const agents = (planEv[0] && planEv[0].agents) || [];
  const names = agents.map((a) => a.name);
  check('T1. 🧠 Planner agentlar taqsimotini beradi (nomlar xil, vazifalar aniq)',
    agents.length >= 1 && new Set(names).size === names.length && agents.every((a) => (a.task || '').length > 3),
    `${agents.length} agent: ${names.join(', ')} · ${agents.map((a) => `[${a.role}]`).join(' ')}`);

  const boardList = agents.map((a) => boards.get(a.name) || '');
  const boardOk = boardList.length > 0 && boardList.every((b) => b.includes('JAMOA DOSKASI') && b.includes('Loyiha ishlari taqsimoti'));
  const crossTalk = agents.length < 2 || agents.some((a) => boardList.some((b) => b.includes(a.name)));
  check('T2. 🤝 Har bir agent «jamoa doskasi» oladi (sinxronlik manbasi)',
    boardOk && crossTalk,
    `doska=${boardList.filter((b) => b.includes('JAMOA DOSKASI')).length}/${agents.length} · boshqa agent nomi ko‘rinadi=${crossTalk}`);

  const assigns = ev.filter((e) => e.type === 'team_assign');
  check('T3. 🔌 Har bir agentga provayder/model tayinlanadi', assigns.length === agents.length,
    `${assigns.length} ta: ${assigns.slice(0, 3).map((a) => a.agent + '→' + a.model).join(' | ')}`);

  const endEvents = ev.filter((e) => e.type === 'agent_end');
  const expected = ['salom.txt', 'raqamlar.txt'].filter((f) => fs.existsSync(path.join(workspace, f)));
  const contents = expected.map((f) => `${f}=${JSON.stringify(fs.readFileSync(path.join(workspace, f), 'utf8').slice(0, 40))}`);
  check('T4. 🛠 Agentlar ishni bajaradi (kamida bitta fayl yaratiladi)', expected.length >= 1,
    `fayllar=[${expected.join(', ')}] · ${contents.join(' · ')} · ${secs} s`);

  const reviewerEnds = endEvents.filter((e) => e.name === 'Reviewer');
  const agentEnds = endEvents.filter((e) => e.name !== 'Reviewer');
  // Review→fix tsikli ba’zan 2 marta ishlashi mumkin (dizayn bo'yicha): birinchi
  // Reviewer dastlabki agentlar tugagach ishga tushishi shart.
  const initialEnds = agentEnds.filter((e) => e.name !== 'Fixer').slice(0, agents.length);
  const orderOk = reviewerEnds.length >= 1 && initialEnds.length >= agents.length &&
    endEvents.indexOf(reviewerEnds[0]) > endEvents.indexOf(initialEnds[initialEnds.length - 1]);
  check('T5. 🔍 Reviewer avtomatik ishlaydi va agentlardan keyin yakunlaydi', orderOk,
    `agent_end=${agentEnds.length}, reviewer_end=${reviewerEnds.length} (review→fix tsikli), tartib OK=${orderOk}`);

  const doneEv = ev.filter((e) => e.type === 'team_done');
  const summary = String((doneEv[0] && doneEv[0].summary) || (res && res.content) || '');
  check('T6. 📣 Yakuniy javob faqat Lead orqali, matn to‘liq', doneEv.length === 1 && summary.length > 20,
    `${summary.length} belgi: "${summary.replace(/\n/g, ' ').slice(0, 80)}"`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
