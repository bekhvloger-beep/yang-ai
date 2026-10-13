// Benchmark: 3 complexity levels — measures time, tokens, tool steps, correctness.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { AgentEngine } from './engine.js';
import { importKeysFromEnv } from './config.js';

const root = path.resolve(import.meta.dirname, '..');
const { keys } = await importKeysFromEnv([path.join(root, '.env')]);

const TASKS = [
  {
    level: 'L1 — oddiy',
    task: "fizzbuzz.js faylini yarat: fizzBuzz(n) funksiyasi 1..n natijalar massivini qaytaradi (3 ga bo'linsa 'Fizz', 5 ga 'Buzz', ikkalasiga 'FizzBuzz', aks holda son string ko'rinishida). Keyin node bilan ishga tushirib 1..15 natijani tekshir.",
    verify: async (ws) => {
      const out = execSync('node -e "import(\'./fizzbuzz.js\').then(m=>console.log(JSON.stringify(m.fizzBuzz(15))))"', { cwd: ws, encoding: 'utf8', timeout: 30000 }).trim();
      const arr = JSON.parse(out);
      return { ok: arr.length === 15 && arr[2] === 'Fizz' && arr[4] === 'Buzz' && arr[14] === 'FizzBuzz', detail: `${arr.length} ta element` };
    },
  },
  {
    level: 'L2 — o‘rta (multi-fayl loyiha)',
    task: "notes-cli loyihasi: notes.js — CLI todo modul (add <matn>, list, delete <id>, JSON faylga saqlash, import/export funksiyalari); test.js — add/list/delete oqimini tekshiruvchi testlar va oxirida TEST_PASS yoki TEST_FAIL chop etadi. node test.js bilan ishga tushirib tasdiqlang.",
    verify: async (ws) => {
      try {
        const out = execSync('node test.js', { cwd: ws, encoding: 'utf8', timeout: 60000 });
        return { ok: /TEST_PASS|PASS|✓/i.test(out) && !/TEST_FAIL|FAIL/i.test(out), detail: out.slice(0, 90).replace(/\n/g, ' ') };
      } catch (e) {
        return { ok: false, detail: (e.stdout || e.message).slice(0, 90).replace(/\n/g, ' ') };
      }
    },
  },
  {
    level: 'L3 — murakkab (algoritm + stress)',
    task: "lru.mjs faylini yarat: LRUCache classi — O(1) get(key)/put(key,value) (LRU eviksiya bilan), has(), keys() (eski->yangi tartibda), capacity < 1 bo'lsa Error. Keyin uni O'ZINGIZ chuqur test qiling (eviksiya tartibi, recency yangilanishi, 5000+ random operatsiya stress, 100k op tezlik < 2s) va javob oxirida o'tkazilgan testlar sonini yozing.",
    verify: async (ws) => {
      try {
        const out = execSync('node ' + path.join(root, 'agent', 'lru_tests.mjs') + ' .', { cwd: ws, encoding: 'utf8', timeout: 120000 });
        const m = out.match(/(\d+)\/12 PASS/);
        return { ok: !!m && +m[1] >= 11, detail: out.trim().split('\n').pop() };
      } catch (e) {
        const m = String(e.stdout || '').match(/(\d+)\/12 PASS/);
        return { ok: !!m && +m[1] >= 11, detail: m ? m[0] : String(e.message).slice(0, 80) };
      }
    },
  },
];

const results = [];
for (const spec of TASKS) {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'bench-'));
  const engine = new AgentEngine({
    config: { provider: 'groq', model: 'openai/gpt-oss-120b', keys, autoApprove: true, customProviders: [] },
    workspace: ws,
  });
  let usage = { input: 0, output: 0 };
  let steps = 0;
  engine.on('event', (e) => {
    if (e.type === 'usage') { usage.input = e.input; usage.output = e.output; }
    if (e.type === 'tool') steps++;
  });
  const t0 = Date.now();
  let ok = false;
  let err = '';
  try {
    await engine.run({ events: [], userText: spec.task });
    const v = await spec.verify(ws);
    ok = v.ok;
    err = v.detail;
  } catch (e) {
    err = e.message.slice(0, 90);
  }
  const dt = (Date.now() - t0) / 1000;
  const totalTok = usage.input + usage.output;
  results.push({ level: spec.level, ok, dt, steps, tokens: totalTok, detail: err });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${spec.level}  ${dt.toFixed(0)}s  ${steps} tool  ${totalTok} tok  | ${err}`);
}

console.log('\n=== BENCHMARK SUMMARY ===');
for (const r of results) {
  console.log(`${r.level}: ${r.ok ? '✓' : '✗'} ${r.dt.toFixed(0)}s · ${r.tokens} token · ${r.steps} tool-chaqiruv`);
}
await fsp.writeFile(path.join(root, 'agent', 'bench_result.json'), JSON.stringify(results, null, 2));
