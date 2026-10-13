// agent/test_modes_complex.mjs — YAKKA va JAMOAVIY rejimlarda MURAKKAB vazifa sinovi.
//
// Nima uchun: mavjud sinovlar rejimlarni alohida tekshiradi (jamoa sinxronligi, router,
// bitta fayl yozish). Bu sinov esa AYNAN BIR murakkab vazifani ikki rejimda yuritadi va
// natijani FAYL MATNI emas, HAQIQIY ISHGA TUSHIRISH bilan baholaydi:
//
//   vazifa: `lib/` papkasida ikki modul + ularni ishlatadigan `index.js` yozilsin;
//           `index.js` o'zi natijani tekshirsin (xato bo'lsa nol bo'lmagan kod bilan chiqsin).
//   baho:   `node index.js` → chiqish kodi 0 VA kutilgan matn chiqishi.
//
// Ya'ni model "yozdim" desa ham, kod ishlamasa — FAIL. Shuning uchun natija halol.
//
//   node agent/test_modes_complex.mjs                # ikkala rejim
//   YANG_MODES_ONLY=solo node agent/test_modes_complex.mjs
//
// Model: Ollama'dagi `qwen2.5-coder:7b` (o'lchovda eng yaxshi lokal kod modeli).
// Ollama yo'q bo'lsa — SKIP (muvaffaqiyat emas, o'tkazib yuborilgan deb yoziladi).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = process.env.YANG_MODES_MODEL || 'qwen2.5-coder:7b';
const ONLY = process.env.YANG_MODES_ONLY || '';

const TASK = [
  'Ish papkasida kichik Node.js loyihasi yarat:',
  '1) `lib/ekub.js` — `export function ekub(a, b)` (eng katta umumiy bo‘luvchi, evklid algoritmi);',
  '2) `lib/ortacha.js` — `export function ortacha(arr)` (sonlar o‘rtachasi);',
  '3) `index.js` — ikkala modulni import qilib: ekub(48, 18) === 6 va ortacha([2, 4, 6]) === 4',
  '   ekanini tekshirsin; hammasi to‘g‘ri bo‘lsa `console.log("HAMMASI TOGRI")`,',
  '   aks holda xato bilan chiqsin (throw).',
  'Fayllar ish papkasiga yozilsin. Buyruq ishga tushirmang — faqat fayllarni yozing.',
].join('\n');

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}

async function ollamaModels() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch { return null; }
}

/** Rejim uchun config: lokal Ollama provayderi (pinMode — boshqa modelga o'tilmaydi). */
function configFor(model) {
  return {
    provider: 'local', model, keys: {}, pinMode: true, autoApprove: true,
    customProviders: [{ id: 'local', name: 'Ollama (lokal)', base: 'http://127.0.0.1:11434/v1', models: [model], key: 'local', local: true }],
    translate: { enabled: false },
  };
}

/** Natijani HAQIQATDA ishga tushirib baholaymiz. */
function runArtifact(ws) {
  if (!fs.existsSync(path.join(ws, 'index.js'))) return { ok: false, why: 'index.js yozilmagan' };
  const r = spawnSync(process.execPath, ['index.js'], { cwd: ws, encoding: 'utf8', timeout: 60000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { ok: r.status === 0 && /HAMMASI TOGRI/.test(out), code: r.status, out: out.trim().slice(-200) };
}

function filesOf(ws) {
  const out = [];
  const walk = (dir, base = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(path.join(dir, e.name), rel); } else out.push(rel);
    }
  };
  try { walk(ws); } catch { /* */ }
  return out.sort();
}

async function runMode(mode, model) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `yang-modes-${mode}-`));
  const config = configFor(model);
  const started = Date.now();
  const events = [];
  try {
    if (mode === 'team') {
      const { TeamRunner } = await import('./team.js');
      const runner = new TeamRunner({ config, workspace: ws });
      runner.on('event', (e) => events.push(e));
      await runner.run({ task: TASK });
    } else {
      const { AgentEngine } = await import('./engine.js');
      const engine = new AgentEngine({ config, workspace: ws, maxSteps: 14 });
      engine.on('event', (e) => events.push(e));
      await engine.run({ events: [], userText: TASK });
    }
  } catch (e) {
    check(`${mode.toUpperCase()} rejimi: vazifa xatosiz tugadi`, false, `xato: ${String(e && e.message).slice(0, 160)}`);
    return { ws, seconds: 0, ok: false };
  }
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const files = filesOf(ws);
  const wrote = events.filter((e) => e.type === 'tool' && e.tool === 'write_file' && e.ok).length;
  const agents = new Set(events.filter((e) => e.agent).map((e) => e.agent)).size;
  check(`${mode.toUpperCase()} rejimi: loyiha fayllari yozildi`,
    files.includes('index.js') && files.some((f) => f.startsWith('lib/')),
    `${files.length} fayl: [${files.slice(0, 8).join(', ')}] · write_file=${wrote} · agentlar=${agents} · ${seconds}s`);

  const run = runArtifact(ws);
  check(`${mode.toUpperCase()} rejimi: natija HAQIQATDA ishlaydi (\`node index.js\` → 0 + «HAMMASI TOGRI»)`,
    run.ok, run.ok ? `exit=${run.code}` : `sabab: ${run.why || `exit=${run.code}`} · chiqish=${JSON.stringify(run.out)}`);
  console.log(`      → ${mode.toUpperCase()} jami: ${seconds}s · fayllar=[${files.join(', ')}]`);
  return { ws, seconds, ok: run.ok, files };
}

/* ------------------------------------------------------------------ ishga */
const models = await ollamaModels();
if (!models) {
  console.log('SKIP: Ollama ishlamayapti (http://127.0.0.1:11434) — rejimlar sinovini o‘tkazib yubordim.');
  process.exit(0);
}
const model = models.find((m) => m === MODEL) || models.find((m) => m.startsWith(MODEL.split(':')[0])) || models[0];
if (!model) { console.log('SKIP: Ollama’da model yo‘q.'); process.exit(0); }
console.log(`model: ${model} · rejimlar: ${ONLY || 'solo + team'}`);

const modes = ONLY ? [ONLY] : ['solo', 'team'];
const summary = [];
for (const mode of modes) summary.push({ mode, ...(await runMode(mode, model)) });

console.log('\n--- xulosa ---');
for (const s of summary) console.log(`${s.mode.padEnd(6)} ${s.ok ? 'ISHLADI' : 'ISHLAMADI'} · ${s.seconds}s · ${(s.files || []).length} fayl`);
const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
// Vaziyat papkalari tekshirish uchun qoldiriladi (sabab ko'rinishi uchun), ular /tmp da.
process.exit(failed ? 1 : 0);
