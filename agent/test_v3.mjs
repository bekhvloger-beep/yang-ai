// v3 tests: local scan, provider routing (each agent on its own API), parallel team.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { TeamRunner } from './team.js';
import { scanLocalProviders } from './providers.js';
import { importKeysFromEnv } from './config.js';

const root = path.resolve(import.meta.dirname, '..');
const { keys } = await importKeysFromEnv([path.join(root, '.env')]);
let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${extra ? ' — ' + String(extra).slice(0, 140).replace(/\n/g, ' ') : ''}`);
  if (!cond) failed++;
};

/* 1. Local scan (Ollama must be running on this machine) */
console.log('--- LOCAL SCAN ---');
{
  const found = await scanLocalProviders();
  check('lokal skan: server topildi', found.length >= 1, found.map((f) => `${f.kind}(${f.models.length})`).join(', '));
  if (found.length) {
    console.log('   modellar:', found[0].models.join(', '));
  }
}

/* 2. Parallel team with per-agent provider routing */
console.log('--- PARALLEL TEAM + ROUTING ---');
{
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'team-par-'));
  const runner = new TeamRunner({
    config: { provider: 'groq', model: 'openai/gpt-oss-120b', keys, autoApprove: true, customProviders: [] },
    workspace: ws,
  });
  const evts = [];
  runner.on('event', (e) => evts.push(e));
  runner.on('approval', (a) => a.respond(true));
  try {
    const t0 = Date.now();
    const res = await runner.run({
      task: "Kichik web loyiha: 1) index.html — 'Matematika Mashqi' sarlavhali sahifa, 2) style.css — qorong'u chiroyli dizayn, 3) app.js — 2 ta random sonli savol generatori, 4) README.md — qisqa tavsif. Har agent faqat o'z fayliga tegsin. Oxirda hamma fayllar mavjudligini tekshiring.",
    });
    const dt = Date.now() - t0;

    const plan = evts.find((e) => e.type === 'team_plan');
    const assigns = evts.filter((e) => e.type === 'team_assign');
    const begins = evts.filter((e) => e.type === 'agent_begin');

    check('team: reja (parallel)', !!plan && plan.agents.length >= 2, plan ? `${plan.agents.length} agent: ${plan.agents.map((a) => a.name).join(', ')}` : 'yo‘q');
    check('team: har agentga API biriktirildi', assigns.length >= 2, assigns.map((a) => `${a.agent}→${a.provider}`).join(', '));
    const uniqueProviders = new Set(assigns.map((a) => `${a.provider}::${a.model}`));
    console.log(`   taqsimot: ${assigns.map((a) => `${a.agent}→${a.provider}·${a.model}`).join(' | ')}`);
    check('team: agentlar turli API’larda', uniqueProviders.size >= 2, `${uniqueProviders.size} xil model`);

    // parallelism check: agent_begin timestamps overlap (events lack ts; use begin/end interleaving)
    const sequence = evts.filter((e) => e.type === 'agent_begin' || e.type === 'agent_end').map((e) => `${e.type === 'agent_begin' ? 'B' : 'E'}:${e.name}`);
    const hasOverlap = (() => {
      let open = 0, sawParallel = false;
      for (const s of sequence) {
        if (s.startsWith('B')) { if (open > 0) sawParallel = true; open++; }
        else open--;
      }
      return sawParallel;
    })();
    check('team: agentlar parallel ishladi', hasOverlap, sequence.join(' '));
    check('team: fayllar yaratildi', !!(await fsp.readFile(path.join(ws, 'index.html'), 'utf8').catch(() => null)) && !!(await fsp.readFile(path.join(ws, 'app.js'), 'utf8').catch(() => null)));
    check('team: team_done', evts.some((e) => e.type === 'team_done'), `${(dt / 1000).toFixed(0)}s`);
  } catch (e) {
    check('parallel team run', false, e.message);
  }
}

console.log(failed ? `\n=== V3 TESTS: ${failed} FAILED ===` : '\n=== V3 TESTS: ALL PASS ===');
process.exit(failed ? 1 : 0);
