// Ball/yulduz formulasi va hisobotdan o‘qish sinovi (electron kerak emas, sof funksiyalar).
//   node agent/test_bench_score.mjs
//
// Nima uchun: IDE dagi «O‘lchash» tugmasi kuch reytingini SHU formuladan yenGilayDi va
// hisobot skripti ham xuddi shundan foydalanadi. Formula ikki joyda ajralib ketsa, bir xil
// sinov har xil ball beradi — bu test o‘sha kelishuvni o‘lchov bilan qotiradi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchScore, benchStars, measuredFromReport } from './bench_score.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, evidence) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};

// --- A. Formula katalogdagi MAVJUD ballarni aynan takrorlaydimi (regressiya qo'riqchisi) ---
// Bu uchlik `local-ai/catalog.json` da yozib qo‘yilgan haqiqiy o‘lchovlardan olingan.
const cases = [
  { name: 'Qwen3.5 2B', idePass: 3, oneShotPass: 3, avgIdeSeconds: 99.6, expect: 30.9, stars: 3 },
  { name: 'coder 7B', idePass: 4, oneShotPass: 2, avgIdeSeconds: 75.0, expect: 41.0, stars: 4 },
  { name: 'coder 3B', idePass: 3, oneShotPass: 2, avgIdeSeconds: 93.4, expect: 30.84, stars: 3 },
];
for (const c of cases) {
  const got = benchScore(c);
  const stars = benchStars(c.idePass, 4);
  check(`A. ${c.name}: ball ${c.expect} va ★${c.stars}`, got === c.expect && stars === c.stars,
    `hisoblandi: ball ${got} · ★${stars}`);
}

// --- B. Yulduz (1..5) chegaralari: 4/4 → ★4, 0/4 → ★1, bulut darajasi (5) lokal modelga berilmaydi ---
check('B. Yulduz chegaralari 0/4, 1/4, 2/4, 3/4, 4/4 → 1,1,2,3,4',
  [0, 1, 2, 3, 4].map((p) => benchStars(p, 4)).join(',') === '1,1,2,3,4',
  `natija: ${[0, 1, 2, 3, 4].map((p) => `${p}/4→★${benchStars(p, 4)}`).join(' · ')}`);

// --- C. Tezlik chegarasi (min(3, 60/avg)) va «darhol yiqilish» himoyasi ---
check('C. 0.1 s da yiqilgan model ballni shishirmaydi (tezlik 3 bilan cheklanadi)',
  benchScore({ idePass: 1, oneShotPass: 0, avgIdeSeconds: 0.1 }) === 13,
  `1/4 · 0.1 s → ${benchScore({ idePass: 1, oneShotPass: 0, avgIdeSeconds: 0.1 })} (3 + 10)`);

// --- D. Hisobotdan o‘qish: HAQIQIY bench_raw.json (mavjud bo‘lsa) va sintetik holatlar ---
const realPath = path.join(ROOT, 'reports', 'local_ai', 'bench_raw.json');
if (fs.existsSync(realPath)) {
  const raw = JSON.parse(fs.readFileSync(realPath, 'utf8'));
  const key = Object.keys(raw.summary.models)[0];
  const m = measuredFromReport(raw, key, 4);
  check('D. Haqiqiy hisobotdan o‘qildi (ball va vazifa soni hisobotga mos)',
    m.tasks === 4 && m.idePass >= 0 && m.score === benchScore({ idePass: m.idePass, oneShotPass: m.oneShot, avgIdeSeconds: m.avgSeconds }),
    `«${key}» → ${m.idePass}/${m.tasks} · one-shot ${m.oneShot} · ${m.avgSeconds}s · ball ${m.score}`);
} else {
  check('D. Hisobot topilmadi (sinov qisman o‘tdi)', false, realPath);
}
const synthetic = { summary: { models: { 'local:/tmp/abc-model.gguf': { ideLoop: { pass: 4, total: 4, avgSeconds: 50 }, oneShot: { pass: 2 } } } } };
const sm = measuredFromReport(synthetic, '/x/y/abc-model.gguf', 4);
check('D2. Absolyut yo‘l bo‘yicha ham to‘g‘ri model yozuvi topiladi (nomi bo‘yicha moslashtirish)',
  sm.idePass === 4 && sm.tasks === 4 && sm.score === 41.4, `ball ${sm.score} (4/4 · 50 s · one-shot 2 → 40 + min(3, 60/50) + 0,2)`);
let threw = '';
try { measuredFromReport({ summary: { models: {} } }, 'x.gguf', 4); } catch (e) { threw = e.message; }
check('D3. Natija yo‘q bo‘lsa — aniq xato qaytadi (jimgina yolg‘on ball yozilmaydi)',
  /topilmadi/.test(threw), `xato: ${threw}`);

console.log(`\nXULOSA: ${failed ? 'YIQILDI' : 'hammasi o‘tdi'} (${failed} xato)`);
if (failed) process.exitCode = 1;
