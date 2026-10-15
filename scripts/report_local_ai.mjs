// report_local_ai.mjs — lokal model benchmarki natijasidan tayyor hisobot yasaydi.
//
// Kirish:  reports/local_ai/bench_raw.json                (birinchi yurish)
//          reports/local_ai/run-*/bench_raw.json          (har bir keyingi yurish)
//   agent/bench_ide_assisted.mjs yozadi. Bir nechta yurish bo'lsa hammasi bitta
//   jadvalga qo'shiladi (bir xil model+vazifa+rejim uchun eng yangisi ustun).
// Chiqish: reports/local_ai/local-ai-hisobot.md
//          reports/local_ai/local-ai-ranking.json
//
// Ishga tushirish:
//   node scripts/report_local_ai.mjs
// Env bilan almashtirish mumkin:
//   YANG_REPORT_IN=a.json,b.json   (vergul bilan ro'yxat)   YANG_REPORT_OUT_DIR=<papka>
//
// Sof Node: yangi kutubxona yo'q. Bir xil kirish uchun bir xil chiqish (deterministik):
// sana vaqtni FAQAT kirish faylidagi summary.generatedAt dan olamiz, Date.now() ishlatilmaydi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchScore } from '../agent/bench_score.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH_DIR = path.join(ROOT, 'reports', 'local_ai');
// Barcha yurishlarni topamiz: asosiy fayl + run-*/ ichidagilar. YANG_REPORT_IN berilsa — faqat o'sha.
function discoverInputs() {
  if (process.env.YANG_REPORT_IN) {
    return process.env.YANG_REPORT_IN.split(',').map((s) => path.resolve(ROOT, s.trim())).filter(Boolean);
  }
  const found = [];
  const legacy = path.join(BENCH_DIR, 'bench_raw.json');
  if (fs.existsSync(legacy)) found.push(legacy);
  if (fs.existsSync(BENCH_DIR)) {
    for (const entry of fs.readdirSync(BENCH_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(BENCH_DIR, entry.name, 'bench_raw.json');
      if (fs.existsSync(file)) found.push(file);
    }
  }
  return found.sort();
}
const IN_FILES = discoverInputs();
const IN_FILE = path.resolve(process.env.YANG_REPORT_IN || path.join(BENCH_DIR, 'bench_raw.json'));
const OUT_DIR = path.resolve(process.env.YANG_REPORT_OUT_DIR || path.join(ROOT, 'reports', 'local_ai'));
const MD_FILE = path.join(OUT_DIR, 'local-ai-hisobot.md');
const RANK_FILE = path.join(OUT_DIR, 'local-ai-ranking.json');

/* ------------------------------------------------------------------ yordamchi */
const sec = (n) => (Number.isFinite(Number(n)) ? `${Number(n).toFixed(1)}s` : '—');

function fmtBytes(b) {
  const n = Number(b);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Markdown jadval hujayrasi: | va yangi qatorni zararsizlantiramiz.
function cell(v, max = 120) {
  const s = String(v == null ? '—' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : (s || '—');
}

const pass = (b) => (b === true ? 'PASS' : b === false ? 'FAIL' : '—');

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* -------------------------------------------------------------------- o'qish */
function readOne(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { data: null, reason: 'fayl JSON obyekt emas' };
    return { data: parsed, reason: null };
  } catch (e) {
    return { data: null, reason: e.code === 'ENOENT' ? 'fayl topilmadi' : `o‘qilmadi: ${e.message}` };
  }
}

// Bir nechta yurishni bitta kirishga qo'shamiz.
//   • rows — model+vazifa+rejim kaliti bo'yicha: keyingi (yangi) fayl ustun turadi.
//   • catalog — barcha fayllardan birlashtiriladi.
//   • summary — eng yangi generatedAt'li fayldan olinadi, vaqtlar yig'indisi qo'shiladi.
function readInput() {
  const files = IN_FILES.length ? IN_FILES : [IN_FILE];
  const rows = [];
  const index = new Map();
  const catalog = {};
  const taskNames = [];
  let summary = {};
  let read = 0;
  let lastReason = null;

  for (const file of files) {
    const { data, reason } = readOne(file);
    if (!data) { lastReason = reason; continue; }
    read += 1;
    const s = data.summary && typeof data.summary === 'object' ? data.summary : {};
    // Qaysi yurish yangi? generatedAt ISO satr — satr taqqoslash yetarli.
    const newer = !summary.generatedAt || String(s.generatedAt || '') >= String(summary.generatedAt);
    if (newer) summary = { ...s, generatedAt: s.generatedAt || summary.generatedAt };
    summary.wallSeconds = Number((Number(summary.wallSeconds || 0) + Number(s.wallSeconds || 0)).toFixed(1));
    summary.warmupSeconds = Number((Number(summary.warmupSeconds || 0) + Number(s.warmupSeconds || 0)).toFixed(1));
    Object.assign(catalog, s.catalog && typeof s.catalog === 'object' ? s.catalog : {});
    for (const t of (Array.isArray(s.tasks) ? s.tasks : [])) {
      if (t?.name && !taskNames.some((x) => x.name === t.name)) taskNames.push(t);
    }
    for (const r of (Array.isArray(data.rows) ? data.rows : [])) {
      const key = `${r.model}|${r.task}|${r.mode}`;
      if (index.has(key)) rows[index.get(key)] = r;
      else { index.set(key, rows.length); rows.push(r); }
    }
  }

  if (!read) return { data: null, reason: lastReason || 'fayl topilmadi' };
  summary.catalog = catalog;
  summary.tasks = taskNames;
  summary.runs = read;
  summary.inputs = files.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
  return { data: { rows, summary }, reason: null };
}

// summary.models to'ldirilmagan bo'lsa ham rows'dan hisoblab beramiz (qismiy fayl holati).
function deriveModels(rows, catalog, tasks) {
  const names = [...new Set(rows.map((r) => r.model))].filter(Boolean).sort();
  const out = {};
  for (const model of names) {
    const mine = rows.filter((r) => r.model === model);
    const stats = (mode) => {
      const list = mine.filter((r) => r.mode === mode);
      return {
        pass: list.filter((r) => r.ok).length,
        total: list.length,
        avgSeconds: list.length ? Number((list.reduce((s, r) => s + Number(r.seconds || 0), 0) / list.length).toFixed(1)) : 0,
      };
    };
    // Vazifa nomlarini ham rows'dan olamiz — tasks bo'sh bo'lsa ham ishlaydi.
    const taskNames = [...new Set([...tasks.map((t) => t.name), ...mine.map((r) => r.task)])];
    out[model] = {
      params: catalog[model]?.params || null,
      context: catalog[model]?.context || null,
      quant: catalog[model]?.quant || null,
      sizeBytes: catalog[model]?.sizeBytes || null,
      oneShot: stats('one-shot'),
      ideLoop: stats('ide-loop'),
      repairsUsed: mine.filter((r) => r.mode === 'ide-loop').reduce((s, r) => s + Math.max(0, Number(r.rounds || 1) - 1), 0),
      perTask: Object.fromEntries(taskNames.map((name) => {
        const os = mine.find((r) => r.task === name && r.mode === 'one-shot');
        const il = mine.find((r) => r.task === name && r.mode === 'ide-loop');
        const failedIde = il && !il.ok ? il : null;
        return [name, {
          oneShot: os ? !!os.ok : null,
          ideLoop: il ? !!il.ok : null,
          checkOutput: failedIde ? (failedIde.checkOutput || failedIde.errors?.[0] || null) : null,
        }];
      })),
    };
  }
  return out;
}

/* ---------------------------------------------------------------------- ball */
// Formula `agent/bench_score.js` da — IDE dagi «O‘lchash» tugmasi ham AYNAN shu
// formuladan foydalanadi (ikki nusxa vaqt o‘tib ajralib ketmasligi uchun).
function scoreOf(s) {
  return benchScore({
    idePass: Number(s.ideLoop?.pass || 0),
    oneShotPass: Number(s.oneShot?.pass || 0),
    avgIdeSeconds: Number(s.ideLoop?.avgSeconds || 0),
  });
}

function verdictOf(idePass, total) {
  if (!total) return 'o‘lchanmadi';
  if (idePass === total) return 'IDE bilan to‘liq yaroqli';
  if (idePass >= Math.ceil(total / 2)) return 'qisman yaroqli';
  if (idePass > 0) return 'ehtiyotkorlik bilan ishlatsa bo‘ladi';
  return 'kodlash uchun yaroqsiz';
}

function buildRanking(models) {
  const ranked = Object.entries(models).map(([model, s]) => {
    const totalTasks = Math.max(Number(s.ideLoop?.total || 0), Number(s.oneShot?.total || 0), Object.keys(s.perTask || {}).length);
    const idePass = Number(s.ideLoop?.pass || 0);
    return {
      model,
      params: s.params || null,
      diskBytes: Number.isFinite(Number(s.sizeBytes)) ? Number(s.sizeBytes) : null,
      score: scoreOf(s),
      idePass,
      oneShotPass: Number(s.oneShot?.pass || 0),
      totalTasks,
      avgSeconds: Number(s.ideLoop?.avgSeconds || 0),
      verdict: verdictOf(idePass, totalTasks),
    };
  });
  // Tartib: ball ↓, keyin o'rtacha vaqt ↑ (tezrog'i oldinda), keyin nom.
  ranked.sort((a, b) => (b.score - a.score) || (a.avgSeconds - b.avgSeconds) || a.model.localeCompare(b.model));
  return ranked.map((r, i) => ({ rank: i + 1, ...r }));
}

/* ------------------------------------------------------------------- hisobot */
function notFinishedReport(reason) {
  return [
    '# YANG AI / YANG IDE — lokal modellar hisoboti',
    '',
    '> ⏳ **Benchmark hali tugamagan.**',
    '',
    `Sabab: \`${path.relative(ROOT, IN_FILE).replace(/\\/g, '/')}\` ${reason}.`,
    '',
    'Hisobot to‘liq bo‘lishi uchun avval o‘lchovni ishga tushiring:',
    '',
    '```bash',
    'node agent/bench_ide_assisted.mjs',
    'node scripts/report_local_ai.mjs',
    '```',
    '',
    'Bu skript benchmark natijasini kutmaydi — fayl paydo bo‘lgach qayta ishga tushiring.',
    '',
  ].join('\n');
}

function buildReport({ summary, models, catalog, tasks }) {
  const L = [];
  const measured = Object.keys(models);
  const totalTasks = Math.max(tasks.length, ...Object.values(models).map((s) => Object.keys(s.perTask || {}).length), 0);

  L.push('# YANG AI / YANG IDE — lokal modellar hisoboti');
  L.push('');
  L.push(`Sana: ${summary.generatedAt || '—'}`);
  L.push('');
  L.push('## Asosiy savol');
  L.push('');
  L.push('Qaysi **ixcham lokal model** IDE yordamisiz ham, IDE halqasi (yozdi → tekshiruv ishga tushdi → xato qaytdi → tuzatdi) bilan ham kodlashga yaroqli?');
  L.push('');
  L.push(`Mezon: **${summary.acceptance || 'PASS = tekshiruv skripti nol kod bilan tugadi.'}**`);
  L.push('');

  L.push('## Muhit');
  L.push('');
  L.push('| Parametr | Qiymat |');
  L.push('|---|---|');
  L.push(`| Sana | ${cell(summary.generatedAt)} |`);
  L.push(`| Platforma | ${cell(summary.host?.platform)} / ${cell(summary.host?.arch)} |`);
  L.push(`| CPU yadro | ${cell(summary.host?.cpus)} |`);
  L.push(`| RAM | ${cell(summary.host?.totalRamMb)} MB |`);
  L.push(`| Ollama | ${cell(summary.ollama)} |`);
  L.push(`| Model yuklanishi (warm-up) | ${sec(summary.warmupSeconds)} |`);
  L.push(`| Umumiy o‘lchov vaqti | ${sec(summary.wallSeconds)} |`);
  L.push(`| Vazifalar | ${totalTasks} ta${tasks.length ? ` (${tasks.map((t) => t.name).join(', ')})` : ''} |`);
  L.push(`| O‘lchov yurishlari | ${cell(summary.runs || 1)} ta |`);
  L.push('');

  L.push('## Asosiy natija');
  L.push('');
  L.push('| Model | Manba | Params | Quant | Disk | One-shot | IDE bilan | Tuzatish qadamlari | O‘rtacha vaqt (IDE) |');
  L.push('|---|---|---|---|---|---:|---:|---:|---:|');
  if (!measured.length) {
    L.push('| — | — | — | — | — | — | — | — | — |');
  }
  for (const model of measured) {
    const s = models[model];
    const kind = (s.kind || catalog[model]?.kind) === 'bundled' ? 'ilova ichida' : 'Ollama';
    L.push([
      `| ${cell(model)}`,
      `${kind}`,
      `${cell(s.params || catalog[model]?.params)}`,
      `${cell(s.quant || catalog[model]?.quant)}`,
      `${fmtBytes(s.sizeBytes ?? catalog[model]?.sizeBytes)}`,
      `${Number(s.oneShot?.pass || 0)}/${Number(s.oneShot?.total || 0)}`,
      `**${Number(s.ideLoop?.pass || 0)}/${Number(s.ideLoop?.total || 0)}**`,
      `${Number(s.repairsUsed || 0)}`,
      `${sec(s.ideLoop?.avgSeconds)} |`,
    ].join(' | '));
  }
  L.push('');

  L.push('## Vazifalar bo‘yicha');
  L.push('');
  const taskNames = [...new Set([...tasks.map((t) => t.name), ...Object.values(models).flatMap((s) => Object.keys(s.perTask || {}))])];
  // Diqqat: map(cell) EMAS — map indeksni ikkinchi argument (max) qilib uzatadi.
  L.push(`| Model | ${taskNames.map((t) => cell(t)).join(' | ')} |`);
  L.push(`|---|${taskNames.map(() => '---').join('|')}|`);
  for (const model of measured) {
    const s = models[model];
    L.push(`| ${cell(model)} | ${taskNames.map((t) => pass(s.perTask?.[t]?.ideLoop)).join(' | ')} |`);
  }
  L.push('');
  L.push('_(jadvaldagi qiymatlar — **IDE halqasi** rejimining natijasi)_');
  L.push('');

  L.push('## IDE halqasi nima beradi');
  L.push('');
  L.push('`one-shot` — model bir marta yozadi, tekshiruv natijasi unga qaytarilmaydi. `ide-loop` — yozilgan fayl darhol ishga tushiriladi, xato matni modelga qaytariladi va u tuzatadi (2 martagacha).');
  L.push('');
  L.push('| Model | One-shot PASS | IDE bilan PASS | IDE qo‘shgan foyda |');
  L.push('|---|---:|---:|---:|');
  for (const model of measured) {
    const s = models[model];
    const o = Number(s.oneShot?.pass || 0);
    const i = Number(s.ideLoop?.pass || 0);
    L.push(`| ${cell(model)} | ${o} | ${i} | ${i - o > 0 ? `+${i - o}` : String(i - o)} |`);
  }
  L.push('');

  const fails = [];
  for (const model of measured) {
    for (const [task, t] of Object.entries(models[model].perTask || {})) {
      if (t.ideLoop === false) fails.push({ model, task, reason: t.checkOutput });
    }
  }
  L.push('## Tuzatib bo‘lmagan xatolar');
  L.push('');
  if (!fails.length) {
    L.push('Barcha o‘lchangan model IDE halqasi bilan barcha vazifalarni o‘tdi.');
  } else {
    L.push('| Model | Vazifa | Tekshiruv chiqishi (qisqartirilgan) |');
    L.push('|---|---|---|');
    for (const f of fails) L.push(`| ${cell(f.model)} | ${cell(f.task)} | ${cell(f.reason, 160)} |`);
  }
  L.push('');

  const skipped = Object.keys(catalog || {}).filter((m) => !measured.includes(m));
  if (skipped.length) {
    L.push('## O‘lchanmagan modellar');
    L.push('');
    L.push('Bu modellar Ollama katalogida bor, lekin ular uchun natija yozuvi yo‘q (o‘lchovda o‘tkazib yuborilgan yoki hali navbatda).');
    L.push('');
    L.push('| Model | Params | Quant | Disk |');
    L.push('|---|---|---|---|');
    for (const m of skipped) {
      const c = catalog[m] || {};
      L.push(`| ${cell(m)} | ${cell(c.params)} | ${cell(c.quant)} | ${fmtBytes(c.sizeBytes)} |`);
    }
    L.push('');
  }

  const ranking = buildRanking(models);
  L.push('## Xulosa');
  L.push('');
  if (!ranking.length) {
    L.push('Xulosa chiqarish uchun natija yo‘q.');
  } else {
    const best = ranking[0];
    L.push(`Ball formulasi: \`idePass × 10 + min(3, 60 / avgVaqt) + oneShotPass × 0.1\` — ya'ni **avval IDE bilan nechta vazifa o‘tdi**, keyin tezlik (3 ball bilan cheklangan), oxirida mustaqillik.`);
    L.push('');
    for (const r of ranking) {
      L.push(`${r.rank}. **${r.model}** — ball ${r.score} · IDE bilan ${r.idePass}/${r.totalTasks} · one-shot ${r.oneShotPass}/${r.totalTasks} · o‘rtacha ${sec(r.avgSeconds)} · ${r.verdict}`);
    }
    L.push('');
    L.push(`### Tavsiya: \`${best.model}\``);
    L.push('');
    L.push(`${best.model} — ${best.params || 'parametr noma’lum'}, ${best.verdict.toLowerCase()}; IDE bilan ${best.idePass}/${best.totalTasks} vazifa o‘tdi, o‘rtacha ${sec(best.avgSeconds)}, ball ${best.score}.`);
    const alt = ranking[1];
    if (alt) L.push(`Zaxira variant: \`${alt.model}\` (ball ${alt.score}, IDE bilan ${alt.idePass}/${alt.totalTasks}).`);
    L.push('');
    L.push('**Cheklov:** bu o‘lchov kichik sun’iy vazifalar to‘plami (bir fayl, funksiya + tekshiruv) ustida o‘tkazilgan. Katta loyihada xulosa bir xil bo‘lishi shart emas — modelni IDE ichida haqiqiy fayllar bilan sinab ko‘ring.');
  }
  L.push('');
  const inputs = Array.isArray(summary.inputs) && summary.inputs.length
    ? summary.inputs.map((f) => `\`${f}\``).join(', ')
    : `\`${path.relative(ROOT, IN_FILE).replace(/\\/g, '/')}\``;
  L.push(`_Xom ma'lumot (${summary.runs || 1} yurish): ${inputs} · generator: \`scripts/report_local_ai.mjs\`_`);
  L.push('');
  return { text: L.join('\n'), ranking };
}

/* --------------------------------------------------------------------- main */
function main() {
  mkdirp(OUT_DIR);
  const { data, reason } = readInput();

  if (!data || (typeof data !== 'object')) {
    fs.writeFileSync(MD_FILE, notFinishedReport(reason || 'bo‘sh'), 'utf8');
    console.log(`⏳ Hisobot yozildi (benchmark tugamagan): ${path.relative(ROOT, MD_FILE)}`);
    console.log(`Sabab: ${reason || 'bo‘sh fayl'}`);
    return 0;
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
  const catalog = summary.catalog && typeof summary.catalog === 'object' ? summary.catalog : {};
  const tasks = Array.isArray(summary.tasks) ? summary.tasks : [];

  if (!rows.length) {
    fs.writeFileSync(MD_FILE, notFinishedReport('bor, lekin unda birorta ham natija qatori yo‘q'), 'utf8');
    console.log(`⏳ Hisobot yozildi (natija qatorlari yo‘q): ${path.relative(ROOT, MD_FILE)}`);
    return 0;
  }

  // summary.models bo'sh/qismiy bo'lsa rows'dan to'ldiramiz — hisobot baribir to'liq bo'lsin.
  // O'lchov HAQIQATI — rows. summary.models esa eskirgan bo'lishi mumkin (bench fayli
  // yurishlar bo'yicha qo'shilib boradi), shuning uchun undan faqat tavsif maydonlarini olamiz.
  const derived = deriveModels(rows, catalog, tasks);
  const models = { ...derived };
  for (const [model, s] of Object.entries(derived)) {
    const given = summary.models?.[model];
    if (!given) continue;
    models[model] = { ...s, quant: given.quant || s.quant, sizeBytes: given.sizeBytes || s.sizeBytes, params: s.params || given.params };
  }
  // Rows'da umuman uchramagan, lekin summary'da bor modellar (juda eski yurishlar).
  for (const [model, s] of Object.entries(summary.models || {})) if (!models[model]) models[model] = s;

  const { text, ranking } = buildReport({ summary, models, catalog, tasks });
  fs.writeFileSync(MD_FILE, text, 'utf8');
  fs.writeFileSync(RANK_FILE, JSON.stringify({
    generatedAt: summary.generatedAt || null,
    formula: 'score = idePass * 10 + min(3, 60 / avgIdeSeconds) + oneShotPass * 0.1',
    source: (summary.inputs || [path.relative(ROOT, IN_FILE).replace(/\\/g, '/')]),
    ranking,
  }, null, 2), 'utf8');

  console.log(`✅ Hisobot: ${path.relative(ROOT, MD_FILE)}`);
  console.log(`✅ Reyting: ${path.relative(ROOT, RANK_FILE)}`);
  for (const r of ranking) console.log(`   #${r.rank} ${r.model} — ball ${r.score} · IDE ${r.idePass}/${r.totalTasks} · ${r.verdict}`);
  return 0;
}

process.exitCode = main();
