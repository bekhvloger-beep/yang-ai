// bench_score.js — lokal model «kuch balli» formulasi. YAGONA manba.
//
// Nima uchun alohida modul: bir xil formulani ikki joy ishlatadi —
//   1. `scripts/report_local_ai.mjs` (bench_raw.json → reyting, hisobot);
//   2. IDE dagi «O‘lchash» tugmasi (`ide/ide_models.js`) — modelni SHU kompyuterda
//      4 haqiqiy vazifa bilan sinab, reytingni o‘lchangan ball bilan yangilaydi.
// Ikki nusxa bo‘lsa ular vaqt o‘tib bir-biridan ajralib ketadi va bir xil sinov
// har xil ball beradi — shuning uchun formulaning o‘zi shu yerda.
//
// BALL FORMULASI (audit uchun):
//   score = idePass * 10            — asosiy mezon: IDE halqasi bilan nechta vazifa o‘tdi
//         + min(3, 60 / avgIdeSec)  — ikkinchi daraja, tezlik; FAQAT idePass > 0 bo‘lsa
//         + oneShotPass * 0.1       — tenglikni buzuvchi: IDE'siz ham ishlagan model oldinda
// Natija 2 xona aniqlikda yumaloqlanadi.
// Nega tezlik cheklangan: «darhol yiqiladigan» model (0,1 s da xato qaytargan) avval
// 60/0,1 = 600 ball olib birinchi o‘ringa chiqib ketardi — o‘lchov ma’nosiz bo‘lardi.
//
// Tekshirilgan (katalogdagi mavjud ballar aynan shu formula bilan chiqadi):
//   Qwen3.5 2B    3/4 · 3 one-shot · 99.6 s → 30.90
//   coder 7B      4/4 · 2 one-shot · 75.0 s → 41.00
//   coder 3B      3/4 · 2 one-shot · 93.4 s → 30.84

/** Ball: IDE halqasi natijasi (asosiy) + tezlik (cheklangan) + one-shot ulushi. */
export function benchScore({ idePass = 0, oneShotPass = 0, avgIdeSeconds = 0 } = {}) {
  const pass = Number(idePass) || 0;
  const avg = Number(avgIdeSeconds) || 0;
  const speed = pass > 0 && avg > 0 ? Math.min(3, Number((60 / avg).toFixed(2))) : 0;
  return Number((pass * 10 + speed + (Number(oneShotPass) || 0) * 0.1).toFixed(2));
}

/**
 * `bench_ide_assisted.mjs` hisobotidan (`bench_raw.json`) model yozuvini topib, o‘lchangan
 * natijani chiqaradi. Sof funksiya (electron yo‘q) — shuning uchun oson sinovdan o‘tadi;
 * IDE («O‘lchash» tugmasi) ham, testlar ham shu funksiyani ishlatadi.
 *
 * @param raw              bench_raw.json mazmuni ({ summary: { models: {...} } })
 * @param modelFile        o‘lchanayotgan gguf nomi yoki absolyut yo‘li
 * @param requestedTasks   so‘ralgan vazifa soni (hisobotda kamroq bo‘lsa — o‘shandan olinadi)
 * @returns {{ idePass, tasks, oneShot, avgSeconds, score }}
 */
export function measuredFromReport(raw, modelFile, requestedTasks = 4) {
  const models = (raw && raw.summary && raw.summary.models) || {};
  const base = String(modelFile || '').split(/[\\/]/).pop();
  const keys = Object.keys(models);
  const key = keys.find((k) => k === base || k.includes(base)) || keys[0];
  const s = key ? models[key] : null;
  if (!s) throw new Error('model natijasi hisobotda topilmadi');
  const idePass = Number(s.ideLoop && s.ideLoop.pass) || 0;
  const oneShot = Number(s.oneShot && s.oneShot.pass) || 0;
  const avgSeconds = Number(s.ideLoop && s.ideLoop.avgSeconds) || 0;
  // Vazifa soni: hisobotdagi jami yoki so‘ralgani (yarim yurishda ham yulduz to‘g‘ri chiqsin).
  const tasks = Math.max(Number(s.ideLoop && s.ideLoop.total) || 0, Number(requestedTasks) || 0) || 4;
  return { idePass, tasks, oneShot, avgSeconds, score: benchScore({ idePass, oneShotPass: oneShot, avgIdeSeconds: avgSeconds }) };
}

/**
 * O‘lchangan natijadan kuch darajasi (1..5) — yulduz/level uchun.
 * 5 — bulut darajasi, lokal modelda uchramaydi (katalogdagi izoh bilan bir xil):
 * 4/4 → 4 · 3/4 → 3 · 2/4 → 2 · 1/4 → 1.
 */
export function benchStars(idePass, tasks) {
  const total = Number(tasks) || 4;
  const pass = Math.max(0, Math.min(total, Number(idePass) || 0));
  if (!pass) return 1;
  return Math.max(1, Math.min(4, Math.round((pass / total) * 4)));
}
