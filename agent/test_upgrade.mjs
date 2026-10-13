// LLM upgrade tests: vision input, provider failover, multi-agent team.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { AgentEngine } from './engine.js';
import { TeamRunner } from './team.js';
import { createToolContext } from './tools.js';
import { importKeysFromEnv } from './config.js';
import { createPng } from './formats.js';

const root = path.resolve(import.meta.dirname, '..');
const { keys } = await importKeysFromEnv([path.join(root, '.env')]);
let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${extra ? ' — ' + String(extra).slice(0, 120).replace(/\n/g, ' ') : ''}`);
  if (!cond) failed++;
};

const collect = (emitter) => {
  const evts = [];
  emitter.on('event', (e) => evts.push(e));
  return evts;
};

/* ---------- 1. VISION ---------- */
const only = process.argv[2] || 'all';
const runSection = (name) => only === 'all' || only === name;
console.log('--- VISION TEST ---');
if (runSection('vision')) {
  const png = createPng({
    width: 420, height: 240, background: '#ffffff',
    ops: [
      { op: 'text', x: 20, y: 20, text: 'SALES 2026', color: '#111111', scale: 4 },
      { op: 'rect', x: 30, y: 120, w: 70, h: 90, color: '#2a6ef5' },
      { op: 'circle', cx: 250, cy: 165, r: 45, color: '#2a9d5e' },
    ],
  });
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'vis-test-'));
  const engine = new AgentEngine({
    config: { provider: 'groq', model: 'openai/gpt-oss-120b', keys, autoApprove: true, customProviders: [] },
    workspace: ws,
  });
  const evts = collect(engine);
  try {
    const res = await engine.run({
      events: [],
      userText: 'Rasmda nima yozilgan? Qanday geometrik shakllar bor va ular qanday rangda? Javobingda matnni aniq yozib ber.',
      images: [`data:image/png;base64,${png.toString('base64')}`],
    });
    const c = res.content || '';
    check('vision: matnni o‘qidi', /SALES|2026/i.test(c), c);
    check('vision: shakl/rang taniydi', /ko.?k|moviy|binafsha|blue|yashil|green/i.test(c), '');
    check('quota/provider event keldi', evts.some((e) => e.type === 'quota') || evts.some((e) => e.type === 'provider_used'), evts.filter((e) => e.type === 'provider_used' || e.type === 'quota').map((e) => e.providerName || e.provider).join(','));
  } catch (e) {
    check('vision run', false, e.message);
  }
}

/* ---------- 2. FAILOVER ---------- */
console.log('--- FAILOVER TEST ---');
if (runSection('failover')) {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'fail-test-'));
  const engine = new AgentEngine({
    config: {
      provider: 'custom_broken',
      model: 'broken-model',
      keys: { ...keys, custom_broken: 'x' },
      autoApprove: true,
      customProviders: [{ id: 'custom_broken', name: 'Broken', base: 'http://127.0.0.1:9/v1', models: ['broken-model'], vision: false, key: 'x' }],
    },
    workspace: ws,
  });
  const evts = collect(engine);
  try {
    const res = await engine.run({ events: [], userText: 'Faqat bitta so‘z bilan javob ber: TAYYOR' });
    check('failover: javob oldi', /TAYYOR/i.test(res.content || ''), res.content);
    check('failover: switch notice', evts.some((e) => e.type === 'notice' && /o‘taman|bermadi/.test(e.text || '')), evts.filter((e) => e.type === 'notice').length + ' ta notice');
  } catch (e) {
    check('failover run', false, e.message);
  }
}

/* ---------- 3. TEAM (katta loyiha) ---------- */
console.log('--- TEAM TEST ---');
if (runSection('team')) {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'team-test-'));
  const runner = new TeamRunner({
    config: { provider: 'groq', model: 'openai/gpt-oss-120b', keys, autoApprove: true, customProviders: [] },
    workspace: ws,
  });
  const evts = collect(runner);
  runner.on('approval', (a) => a.respond(true));
  try {
    const res = await runner.run({
      task: 'Kichik loyiha: fizzbuzz.js yarating — fizzBuzz(n) funksiyasi 1..n uchun fizz/buzz/fizzbuzz qaytaradi (3 ga bo‘linsa Fizz, 5 ga Buzz, ikkalasiga FizzBuzz, aks holda son). Keyin test.js yarating — fizzbuzz.js ni import qilib 3 ta tekshiruv qiladi (console.log TEST_PASS yoki xato). Oxiri node test.js bilan ishga tushirib natijani tasdiqlang.',
    });
    const plan = evts.find((e) => e.type === 'team_plan');
    const begins = evts.filter((e) => e.type === 'agent_begin');
    const done = evts.find((e) => e.type === 'team_done');
    check('team: reja tuzildi', !!plan && plan.agents.length >= 2, plan ? plan.agents.map((a) => a.name).join(', ') : 'yo‘q');
    check('team: ko‘p agent ishladi', begins.length >= 2, `${begins.length} agent`);
    const fz = await fsp.readFile(path.join(ws, 'fizzbuzz.js'), 'utf8').catch(() => null);
    const ts = await fsp.readFile(path.join(ws, 'test.js'), 'utf8').catch(() => null);
    check('team: fayllar yaratildi', !!fz && !!ts, `${fz ? 'fizzbuzz.js' : '—'} ${ts ? 'test.js' : '—'}`);
    check('team: team_done', !!done, done ? String(done.summary).slice(0, 80) : '');
    // verify the produced test actually passes
    const { execSync } = await import('node:child_process');
    let testOut = '';
    try {
      testOut = execSync('node test.js', { cwd: ws, encoding: 'utf8', timeout: 60000 });
    } catch (e) {
      testOut = 'TEST FAILED: ' + (e.stdout || e.message);
    }
    check('team: agent testlari o‘tdi', /TEST_PASS|pass|✓|OK/i.test(testOut) && !/failed/i.test(testOut), testOut.slice(0, 100).replace(/\n/g, ' '));
  } catch (e) {
    check('team run', false, e.message);
  }
}

console.log(failed ? `\n=== UPGRADE TESTS: ${failed} FAILED ===` : '\n=== UPGRADE TESTS: ALL PASS ===');
process.exit(failed ? 1 : 0);
