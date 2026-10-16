// agent/test_coding_mode.mjs — «Kod AI» (kodlash rejimi) sinovi.
//
// Ikki qatlam:
//   1) DETERMINISTIK: `buildSystemExtra()` reja rejimi, tasdiqlangan reja va Kodlash
//      rejimini TO'G'RI birlashtiradimi (model kerak emas) — shu tarzda sozlamadagi
//      belgi haqiqatan system promptga yetib borishi isbotlanadi.
//   2) HAQIQIY: Ollama'dagi kichik kod modeli bilan bitta vazifa YOQILGAN kod rejimida
//      bajariladi va natija FAYL MATNI emas, `node` bilan ishga tushirib baholanadi.
//      Ollama yo'q bo'lsa — SKIP (muvaffaqiyat emas, o'tkazib yuborilgan deb yoziladi).
//
//   node agent/test_coding_mode.mjs
//   YANG_CODE_MODEL=qwen2.5-coder:3b node agent/test_coding_mode.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemExtra, CODING_MODE_EXTRA } from './engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.YANG_CODE_MODEL || 'qwen2.5-coder:3b';

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}

/* ---------------------------------------------------- 1) deterministik qatlam */
check('Kodlash rejimi system promptga qo‘shiladi (sozlama → prompt)',
  !!buildSystemExtra({ codingMode: true })
  && /KODLASH REJIMI/.test(buildSystemExtra({ codingMode: true }))
  && /run_command/.test(buildSystemExtra({ codingMode: true })),
  `${String(buildSystemExtra({ codingMode: true })).length} belgi · birinchi qator: "${String(buildSystemExtra({ codingMode: true })).split('\n')[0].slice(0, 60)}"`);

check('O‘chiq bo‘lsa umuman qo‘shilmaydi (odatiy xatti-harakat o‘zgarmaydi)',
  buildSystemExtra({ codingMode: false }) === null
  && buildSystemExtra({}) === null
  && !/KODLASH REJIMI/.test(String(buildSystemExtra({ systemExtra: 'Rol: planner' }))));

check('Reja rejimi / tasdiqlangan reja bilan birga ishlaydi (bloklar yo‘qolmaydi)',
  (() => {
    const both = buildSystemExtra({ planMode: true, codingMode: true, approvedPlan: '1) fayl yoz' });
    return /REJA REJIMI/.test(both) && /KODLASH REJIMI/.test(both) && /fayl yoz/.test(both);
  })());

check('Kod rejimi qoidalari o‘lchangan xatolarga qarshi (fayl, tekshirish, minimal, halol xato)',
  /FAYL sifatida yoziladi/.test(CODING_MODE_EXTRA)
  && /TEKSHIR/.test(CODING_MODE_EXTRA)
  && /MINIMAL/.test(CODING_MODE_EXTRA)
  && /yashirma/.test(CODING_MODE_EXTRA)
  && /read_file/.test(CODING_MODE_EXTRA));

/* ------------------------------------------------------- 2) haqiqiy yurish */
async function ollamaModels() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch { return null; }
}

function runArtifact(ws) {
  if (!fs.existsSync(path.join(ws, 'clamp.js'))) return { ok: false, why: 'clamp.js yozilmagan' };
  const r = spawnSync(process.execPath, ['clamp.js'], { cwd: ws, encoding: 'utf8', timeout: 60000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { ok: r.status === 0 && /KOD_AI_OK/.test(out), code: r.status, out: out.trim().slice(-200) };
}

const TASK = [
  'Ish papkasida `clamp.js` faylini yarat va uni O‘ZING ishga tushirib tekshir:',
  '- `export function clamp(n, min, max)` — n ni [min, max] oralig‘iga qaytaradi;',
  '  min > max bo‘lsa xato (throw) tashlaydi; n son bo‘lmasa ham throw.',
  '- Faylning oxiriga o‘z-o‘zini tekshirish qo‘y: clamp(5,1,3)===3, clamp(-2,0,10)===0,',
  '  clamp(7,0,10)===7, clamp(0,0,0)===0; min>max va matn kirishi throw berishini sinab ko‘r.',
  '  Hammasi to‘g‘ri bo‘lsa `console.log("KOD_AI_OK")` chiqar, aks holda throw qil.',
  'Test `node clamp.js` bilan ishlashi kerak (ESM, package.json kerak emas).',
].join('\n');

async function realRun(model) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-codeai-'));
  const config = {
    provider: 'local', model, keys: {}, pinMode: true, autoApprove: true, codingMode: true,
    customProviders: [{ id: 'local', name: 'Ollama (lokal)', base: 'http://127.0.0.1:11434/v1', models: [model], key: 'local', local: true }],
    translate: { enabled: false },
  };
  const { AgentEngine } = await import('./engine.js');
  const engine = new AgentEngine({ config, workspace: ws, maxSteps: 12 });
  const events = [];
  engine.on('event', (e) => events.push(e));
  const started = Date.now();
  try {
    await engine.run({ events: [], userText: TASK });
  } catch (e) {
    check('Kod rejimida vazifa xatosiz tugadi', false, `xato: ${String(e && e.message).slice(0, 160)}`);
    return;
  }
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const wrote = events.filter((e) => e.type === 'tool' && e.tool === 'write_file' && e.ok).length;
  const ran = events.filter((e) => e.type === 'tool' && e.tool === 'run_command' && e.ok).length;
  check('Kod rejimida fayl yozildi va ishga tushirib tekshirildi',
    wrote >= 1 && ran >= 1,
    `write_file=${wrote} · run_command=${ran} · ${seconds}s`);
  const run = runArtifact(ws);
  check('Natija HAQIQATDA ishlaydi (`node clamp.js` → 0 + «KOD_AI_OK»)',
    run.ok, run.ok ? `exit=${run.code}` : `sabab: ${run.why || `exit=${run.code}`} · chiqish=${JSON.stringify(run.out)}`);
}

const models = await ollamaModels();
if (!models) {
  console.log('SKIP: Ollama ishlamayapti (http://127.0.0.1:11434) — haqiqiy yurish o‘tkazib yuborildi.');
} else {
  const model = models.find((m) => m === MODEL) || models.find((m) => m.startsWith(MODEL.split(':')[0]));
  if (!model) {
    console.log(`SKIP: Ollama’da «${MODEL}» yo‘q — haqiqiy yurish o‘tkazib yuborildi.`);
  } else {
    console.log(`haqiqiy yurish: ${model} · kodlash rejimi YOQILGAN`);
    await realRun(model);
    console.log(`  (o‘lchov papkasi: ${ROOT} yonida emas — /tmp da, tekshirish uchun qoldirildi)`);
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
