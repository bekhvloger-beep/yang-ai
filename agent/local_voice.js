// local_voice.js — LOKAL ovozli buyruqlar: o'zbek nutqini matnga aylantirish (rubaistt).
//
// Bu yerda HECH QANDAY API chaqirilmaydi va internetga chiqilmaydi. Model — `rubaistt_v2_medium`:
// Whisper-medium ning o'zbekcha uchun o'qitilgan varianti (HuggingFace: `islomov/rubaistt_v2_medium`,
// muallif bahosi ≈17% WER / 5.5% CER). Ilova uni **whisper.cpp** GGML nusxasida ishlatadi:
//   https://huggingface.co/azimxxm/rubaistt-v2-medium-ggml/resolve/main/ggml-rubaistt-medium-q5_0.bin
// (~516 MB, Q5_0). Ishlash tartibi (whisper.cpp `whisper-cli`):
//   whisper-cli.exe -m ggml-rubaistt-medium-q5_0.bin -f <16kHz mono wav> -l uz -nt
//
// MUHIM: `-l uz` MAJBURIY. Whisper tilni o'zi taxmin qiladi va o'zbek nutqini ko'p hollarda
// boshqa tilga o'girib yuboradi (model kartochkasi ham shuni aytadi) — shuning uchun til
// kodda qat'iy belgilangan, foydalanuvchi sozlamasiga tashlanmaydi.
//
// XAVFSIZLIK (asosiy qoida, o'zgarmaydi): tanilgan matn HECH QACHON shell buyrug'i sifatida
// bajarilmaydi. `parseCommand()` faqat `COMMANDS` ro'yxatidagi tayyor `id` larni qaytaradi;
// argument ham faqat ish papkasi ichidagi oddiy fayl nomi bo'lishi mumkin (aks holda `null`).
// Ya'ni "rm -rf /" deb aytilsa — bu shunchaki tanilmagan matn bo'lib qoladi.
//
// Modul ataylab "toza Node": papkalarni Electron beradi (`configureVoice`), testlar esa
// Electron'siz ishlaydi (uslub `agent/local_sd.js` bilan bir xil).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Ishlab chiqish (repo) rejimi uchun zaxira yo'l: <repo>/local-ai/voice
const DEV_FALLBACK = path.resolve(HERE, '..', 'local-ai', 'voice');

const EXE_NAMES = ['whisper-cli.exe', 'whisper.exe', 'main.exe', 'whisper-cli', 'whisper', 'main'];
// 'Release' ham bor: whisper.cpp ning Windows relizi (whisper-bin-x64.zip) fayllarni
// `Release/whisper-cli.exe` ko‘rinishida ochadi — ilgari bu subpapka izlanmasdi.
const EXE_SUBDIRS = ['', 'voice', 'lc', 'bin', 'Release', 'whisper.cpp', path.join('build', 'bin'), path.join('Release', 'bin')];
const MODEL_SUBDIRS = ['', 'voice', 'models', 'whisper'];
const MODEL_MIN_BYTES = 1024 * 1024;   // 1 MB dan kichigi model emas

let configuredDirs = [];
let configuredBin = '';

/** Ilova ishga tushganda haqiqiy papkalarni beradi (Electron: userData + resources). */
export function configureVoice({ dirs = [], bin = '' } = {}) {
  configuredDirs = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
  configuredBin = String(bin || '');
}

/**
 * Model va `whisper-cli` izlanadigan papkalar.
 * Standart joylar (Electron `configureVoice` orqali beradi): `<userData>/models/voice`,
 * ilova bilan kelgan `resources/local-ai/voice` va `lc`, hozirgi papka.
 */
export function voiceDirs(extra = []) {
  const out = [];
  const push = (d) => { if (d && !out.includes(d)) out.push(d); };
  if (process.env.YANG_VOICE_DIR) push(process.env.YANG_VOICE_DIR);
  configuredDirs.forEach(push);
  (Array.isArray(extra) ? extra : [extra]).forEach(push);
  push(DEV_FALLBACK);
  push(path.resolve(HERE, '..', 'local-ai', 'lc'));
  push(process.cwd());
  return out;
}

/** `whisper-cli.exe` ni izlaydi (env `YANG_WHISPER_EXE` ustuvor). Topilmasa null. */
export function findWhisperBinary(dirs = voiceDirs()) {
  if (configuredBin && fs.existsSync(configuredBin)) return { exe: configuredBin, dir: path.dirname(configuredBin) };
  if (process.env.YANG_WHISPER_EXE && fs.existsSync(process.env.YANG_WHISPER_EXE)) {
    return { exe: process.env.YANG_WHISPER_EXE, dir: path.dirname(process.env.YANG_WHISPER_EXE) };
  }
  for (const d of dirs) {
    for (const sub of EXE_SUBDIRS) {
      for (const name of EXE_NAMES) {
        const p = path.join(d, sub, name);
        try { if (fs.statSync(p).isFile()) return { exe: p, dir: path.dirname(p) }; } catch { /* yo'q */ }
      }
    }
  }
  return null;
}

/** rubaistt modelini izlaydi (`ggml-rubaistt*.bin` afzal, keyin boshqa `*.bin`). */
export function findVoiceModel(dirs = voiceDirs()) {
  // Qo'lda ko'rsatilgan model (masalan, boshqa diskdagi nusxa) — izlashdan ustuvor.
  const forced = String(process.env.YANG_VOICE_MODEL || '');
  if (forced) {
    try {
      const st = fs.statSync(forced);
      if (st.isFile() && st.size >= MODEL_MIN_BYTES) {
        return { abs: forced, file: path.basename(forced), bytes: st.size, dir: path.dirname(forced), rubaistt: /rubaistt/i.test(forced) };
      }
    } catch { /* yo'l noto'g'ri — izlashga o'tamiz */ }
  }
  const found = [];
  for (const d of dirs) {
    for (const sub of MODEL_SUBDIRS) {
      const dir = path.join(d, sub);
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const f of entries) {
        if (path.extname(f).toLowerCase() !== '.bin') continue;
        const abs = path.join(dir, f);
        let st; try { st = fs.statSync(abs); } catch { continue; }
        if (!st.isFile() || st.size < MODEL_MIN_BYTES) continue;
        if (found.some((x) => x.abs === abs)) continue;
        found.push({ abs, file: f, bytes: st.size, dir, rubaistt: /rubaistt/i.test(f) });
      }
    }
  }
  if (!found.length) return null;
  // rubaistt afzal; qolganlari orasida eng kattasi (whisper uchun to'liqroq model).
  found.sort((a, b) => (Number(b.rubaistt) - Number(a.rubaistt)) || (b.bytes - a.bytes));
  return found[0];
}

/**
 * Lokal ovoz holati.
 * @returns {{ available: boolean, exe: string|null, bin: string|null, binDir: string|null,
 *             model: string|null, modelPath: string|null, dirs: string[], reason: string,
 *             languages: string[] }}
 */
export function voiceStatus() {
  const dirs = voiceDirs();
  const bin = findWhisperBinary(dirs);
  const model = bin ? findVoiceModel(dirs) : null;
  let reason = '';
  if (!bin) {
    reason = 'whisper-cli topilmadi — whisper.cpp ikkilik fayli kerak (YANG_WHISPER_EXE bilan yo‘l ko‘rsatiladi)';
  } else if (!model) {
    reason = 'rubaistt modeli topilmadi — `ggml-rubaistt-medium-q5_0.bin` kerak (yuklab olish mumkin)';
  }
  return {
    available: !!(bin && model),
    exe: bin ? bin.exe : null,
    bin: bin ? bin.exe : null,
    binDir: bin ? bin.dir : null,
    model: model ? model.file : null,
    modelPath: model ? model.abs : null,
    dirs,
    reason,
    languages: ['uz'],   // boshqa til ataylab qo'shilmagan: model o'zbekcha uchun
  };
}

/* ------------------------------------------------------------------ transkripsiya */

/** Windows'da `.cmd`/`.bat` shim ni to'g'ri (qo'shtirnoq bilan) ishga tushirish. */
function spawnVoice(exe, args, opts = {}) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    // O'LCHANDI: qo'lda qo'shtirnoq yasash (""path" arg"" yoki "path" arg) `cmd.exe` da
    // «not recognized» beradi; ishlaydigan shakl — yo'lni ALOHIDA argument sifatida berish:
    //   spawn(ComSpec, ['/d','/s','/c', shimPath, ...args])
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', exe, ...args], { ...opts, windowsHide: true });
  }
  return spawn(exe, args, { ...opts, windowsHide: true });
}

/** whisper chiqishini tozalash: log qatorlari, vaqt belgilari va ortiqcha bo'shliqlar. */
function cleanTranscript(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(whisper_|ggml_|system_info|main:|load_|decode_|encode_)[^\n]*/i, ''))
    .map((l) => l.replace(/\[[\d:.,\s\->]+\]/g, ' '))   // [00:00:00.000 --> 00:00:01.000]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * WAV faylni matnga aylantiradi (16 kHz mono bo'lishi kerak — whisper.cpp shuni kutadi).
 * @returns {Promise<{ ok: true, text: string, seconds: number, raw: string } | { error: string }>}
 */
export async function transcribeFile(wavPath, { timeoutMs = 120000 } = {}) {
  const wav = String(wavPath || '');
  if (!wav || !fs.existsSync(wav)) return { error: `wav fayl topilmadi: ${wav || '(bo‘sh yo‘l)'}` };
  const st = voiceStatus();
  if (!st.available) return { error: `lokal ovoz tayyor emas — ${st.reason}` };

  const args = ['-m', st.modelPath, '-f', wav, '-l', 'uz', '-nt'];
  const startedAt = Date.now();
  const out = [];
  const err = [];
  try {
    await new Promise((resolve, reject) => {
      const child = spawnVoice(st.exe, args, { cwd: path.dirname(st.exe), stdio: ['ignore', 'pipe', 'pipe'] });
      let settled = false;
      const finish = (e) => { if (settled) return; settled = true; clearTimeout(timer); if (e) reject(e); else resolve(); };
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* o'lgan */ }
        finish(new Error(`whisper ${Math.round(timeoutMs / 1000)} s ichida tugamadi`));
      }, Math.max(5000, Number(timeoutMs) || 120000));
      child.stdout?.on('data', (b) => out.push(String(b)));
      child.stderr?.on('data', (b) => err.push(String(b)));
      child.on('error', (e) => finish(new Error(`whisper-cli ishga tushmadi: ${e.message}`)));
      child.on('exit', (code) => {
        if (code !== 0) {
          const tail = (err.join('') || out.join('')).trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 400);
          finish(new Error(`whisper-cli ${code} kodi bilan tugadi${tail ? ` — ${tail}` : ''}`));
        } else finish();
      });
    });
  } catch (e) {
    return { error: e.message };
  }
  const stdout = out.join('');
  const raw = (stdout.trim() ? stdout : err.join('')).trim();
  return {
    ok: true,
    text: cleanTranscript(stdout.trim() ? stdout : ''),
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    raw: raw.slice(0, 4000),
    language: 'uz',
  };
}

/** WAV baytlarini (renderer'dan kelgan bufer) vaqtinchalik faylga yozib transkripsiya qiladi. */
export async function transcribeBuffer(buffer, opts = {}) {
  if (!buffer || !buffer.length) return { error: 'ovoz buferi bo‘sh' };
  const tmp = path.join(os.tmpdir(), `yang-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
  try {
    await fsp.writeFile(tmp, buffer);
    return await transcribeFile(tmp, opts);
  } finally {
    fsp.unlink(tmp).catch(() => {});
  }
}

/**
 * Mikrofonni yozib olish. Windows'da Node'ning o'zida ishonchli yo'l YO'Q (NAudio/WASAPI kerak),
 * shuning uchun bu yerda yolg'on `ok` qaytarilmaydi: renderer Web Audio API bilan yozib, WAV
 * buferini `transcribeBuffer()` ga beradi (ilovada shunday qilinadi).
 */
export async function recordWav() {
  return {
    error: 'yozib olish bu muhitda qo‘llab-quvvatlanmaydi — renderer mikrofonni WAV qilib yuboradi (transcribeBuffer)',
  };
}

/* --------------------------------------------------------------- ovozli buyruqlar */
// ALLOWLIST: faqat shu ro'yxatdagi buyruqlar taniladi. Ro'yxatdan tashqari matn `null` bo'ladi
// va hech qanday amal bajarilmaydi. Har bir buyruq IDE dagi aniq amalga (`id`) bog'langan.
export const COMMANDS = [
  { id: 'run-file', label: 'Faylni ishga tushirish', needsArg: false, phrases: ['faylni ishga tushir', 'ishga tushir', 'kodni ishga tushir', 'run file', 'run'] },
  { id: 'save-file', label: 'Faylni saqlash', needsArg: false, phrases: ['faylni saqlash', 'saqlash', 'kontseptsiyani saqlash', 'save file', 'save'] },
  { id: 'new-chat', label: 'Yangi chat', needsArg: false, phrases: ['yangi chat', 'yangi suhbat', 'new chat'] },
  { id: 'stop', label: 'To‘xtatish', needsArg: false, phrases: ['toxtat', 'to‘xtat', 'bekor qil', 'stop', 'cancel'] },
  { id: 'debug', label: 'Debug qilish', needsArg: false, phrases: ['debug', 'debug qil', 'nosozlikni top'] },
  { id: 'run-tests', label: 'Testlarni ishga tushirish', needsArg: false, phrases: ['testni ishga tushir', 'testlarni ishga tushir', 'test', 'sinov'] },
  { id: 'git-status', label: 'Git holati', needsArg: false, phrases: ['git status', 'git holati', 'holatni ko‘rsat'] },
  { id: 'git-diff', label: 'Git farqi (diff)', needsArg: false, phrases: ['git diff', 'farqni ko‘rsat', 'o‘zgarishlarni ko‘rsat'] },
  { id: 'git-commit', label: 'Git commit', needsArg: true, phrases: ['git commit', 'commit qil', 'kommit', 'commit'] },
  { id: 'open-file', label: 'Faylni ochish', needsArg: true, phrases: ['faylni ochish', 'ochish', 'och', 'open'] },
];

/** Apostrof variantlarini bir xillashtirish (o‘zbekcha `ʻ ‘ ’ ' ` va kirill `ъ`). */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’ʻ`´]/g, "'")
    .replace(/[^\p{L}\p{N}.'\-\s/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Argument XAVFSIZmi: faqat ish papkasi ichidagi oddiy yo'l (shell belgilari yo'q). */
function safeArg(arg) {
  const a = String(arg || '').trim().replace(/^["'`]|["'`]$/g, '');
  if (!a) return '';
  if (a.length > 200) return null;
  if (/[;&|$><`"*?]/.test(a)) return null;          // shell belgilari — rad
  if (/^[a-zA-Z]:/.test(a) || a.startsWith('/') || a.startsWith('\\')) return null;   // absolyut yo'l — rad
  if (a.split(/[\\/]/).some((p) => p === '..')) return null;                            // tashqariga chiqish — rad
  return a;
}

/**
 * Ovozdan tanilgan matnni buyruqqa aylantiradi.
 * @returns {{ command: string, label: string, needsArg: boolean, arg: string, args: string[], text: string } | null}
 *          Tanilmagan matn yoki xavfli argument uchun `null` (hech qachon shell buyrug'i emas).
 */
// XOM MATN FILTRI (xatolik yopiq tomonga): `normalize()` ko'rinmas belgilarni BO'SH JOYGA
// aylantirgani uchun xavfli qator undan keyin «toza» ko'rinardi — o'lchandi: «ochish test; rm -rf /»
// buyruq deb tan olindi, «ochish C:\Windows\system32\cmd.exe» va «..\..\config.json» ham o'tib
// ketdi (chunki `;` `\` `:` belgilari normalize ichida yo'qolgan edi). Shuning uchun avval XOM
// matn qat'iy belgilar to'plamiga solishtiriladi; bitta begona belgi bo'lsa — buyruq YO'Q.
// O‘zbekcha apostrofning HAMMA ko‘rinishlari ruxsat etiladi: ‘ (U+2018), ’ (U+2019),
// ʻ (U+02BB), ʼ (U+02BC), ` va oddiy '.
const RAW_ALLOWED = /^[\p{L}\p{N}\s.'‘’ʻʼ`´\-_/]+$/u;

export function parseCommand(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!RAW_ALLOWED.test(raw)) return null;
  const norm = normalize(text);
  if (!norm) return null;
  // Eng uzun ibora ustuvor: «faylni ishga tushir» «ishga tushir» dan oldin topiladi.
  const all = [];
  for (const cmd of COMMANDS) for (const p of cmd.phrases) all.push({ cmd, phrase: normalize(p) });
  all.sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { cmd, phrase } of all) {
    if (norm === phrase || norm.startsWith(phrase + ' ')) {
      const rest = norm.slice(phrase.length).trim();
      if (!cmd.needsArg) {
        return { command: cmd.id, label: cmd.label, needsArg: false, arg: '', args: [], text: norm };
      }
      const arg = safeArg(rest);
      if (arg === null) return null;                 // xavfli argument — buyruq bajarilmaydi
      if (!arg) {
        // Argumenti yo'q: buyruq tanildi, lekin bajarish uchun argument kerak.
        return { command: cmd.id, label: cmd.label, needsArg: true, arg: '', args: [], text: norm, missingArg: true };
      }
      return { command: cmd.id, label: cmd.label, needsArg: true, arg, args: [arg], text: norm };
    }
  }
  return null;
}
