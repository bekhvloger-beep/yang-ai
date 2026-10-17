// local_sd.js — LOKAL rasm generatsiyasi: stable-diffusion.cpp (`sd-cli.exe`).
//
// Bu yerda HECH QANDAY API chaqirilmaydi: matn → rasm butunlay shu kompyuterda,
// internet va kalitsiz yaratiladi. `agent/imagegen.js` shu modulni bulut zanjiridan
// OLDIN sinaydi (lokal mavjud bo'lsa umuman internetga chiqmaydi).
//
// Nima uchun stable-diffusion.cpp: ggml/llama.cpp oilasidan — CUDA SHART EMAS.
// Vulkan build AMD Radeon, Intel va NVIDIA bilan ishlaydi, CPU build esa har qanday
// kompyuterda ishlaydi. Model bitta fayl (SD1.5 → `v1-5-pruned-emaonly-fp16.safetensors`,
// 2.1 GB), shuning uchun "eng kichik lekin kuchli" talabiga mos keladi.
//
// Ish tartibi (o'lchandi, `ide/test_local_ai_manager.mjs`):
//   sd-cli.exe -m <model> -p "<prompt>" -o out.png -W 512 -H 512 --steps 20 --cfg-scale 7
// Fayl nomi `sd-cli.exe` (yangi relizlar) yoki `sd.exe` (eski) bo'lishi mumkin — ikkalasi izlanadi.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Ishlab chiqish (repo) rejimi uchun zaxira yo'l: <repo>/local-ai/sd
const DEV_FALLBACK = path.resolve(HERE, '..', 'local-ai', 'sd');

const EXE_NAMES = ['sd-cli.exe', 'sd.exe', 'sd-cli', 'sd'];
const EXE_SUBDIRS = ['', 'lc-vulkan', 'lc-cpu', 'lc', 'bin', 'bin-vulkan', 'bin-cpu', 'vulkan', 'cpu'];
const MODEL_EXTS = ['.safetensors', '.ckpt', '.gguf'];
const MODEL_SUBDIRS = ['models', '', 'sd/models', 'vulkan', 'cpu'];

// Ilova ishga tushganda haqiqiy papkalarni beradi (Electron: userData + resources).
// Modul ataylab "toza Node" bo'lib qoladi — testlar Electron'siz ishlaydi.
let configuredDirs = [];
export function configureSd(dirs = []) {
  configuredDirs = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
}

export function resolveSdDirs(extra = []) {
  const out = [];
  const push = (d) => { if (d && !out.includes(d)) out.push(d); };
  if (process.env.YANG_SD_DIR) push(process.env.YANG_SD_DIR);
  configuredDirs.forEach(push);
  (Array.isArray(extra) ? extra : [extra]).forEach(push);
  // `YANG_SD_NO_DEV=1` — sinovda «dvigatel yo‘q» holatini tekshirish uchun repo zaxirasi
  // hisobga olinmaydi (aks holda dev muhitda u doim topilib, xato yo‘li sinalmaydi).
  if (process.env.YANG_SD_NO_DEV !== '1') push(DEV_FALLBACK);
  return out;
}

/** `sd-cli.exe` ni izlaydi. Topilmasa null. */
export function findSdBinary(dirs = resolveSdDirs()) {
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

/** Muayyan backend bo‘yicha binar: `vulkan` (ggml-vulkan.dll bor) yoki `cpu` (yo‘q).
 * 4 GB video kartada katta model sig‘masa, CPU nusxa bilan qayta urinish uchun kerak. */
export function findSdBinaryFor(dirs = resolveSdDirs(), backend = '') {
  const want = String(backend || '').toLowerCase();
  for (const d of dirs) {
    for (const sub of EXE_SUBDIRS) {
      const dir = path.join(d, sub);
      const hasVulkan = fs.existsSync(path.join(dir, 'ggml-vulkan.dll'));
      if (want === 'vulkan' && !hasVulkan) continue;
      if (want === 'cpu' && hasVulkan) continue;
      for (const name of EXE_NAMES) {
        const p = path.join(dir, name);
        try { if (fs.statSync(p).isFile()) return { exe: p, dir, backend: hasVulkan ? 'vulkan' : 'cpu' }; } catch { /* yo‘q */ }
      }
    }
  }
  return null;
}

/** Video xotirasi yetmaganini bildiruvchi sd-cli xabarlari. */
function isOutOfVram(message) {
  return /OutOfDeviceMemory|Device memory allocation of size .* failed|out of memory|backend buffer failed|failed during weight preparation/i.test(String(message || ''));
}

/** Rasm modelini izlaydi. `preferName` berilsa — avval o'sha. */
export function findSdModel(dirs = resolveSdDirs(), preferName = null) {
  const found = [];
  for (const d of dirs) {
    for (const sub of MODEL_SUBDIRS) {
      const dir = path.join(d, sub);
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const f of entries) {
        if (!MODEL_EXTS.includes(path.extname(f).toLowerCase())) continue;
        const abs = path.join(dir, f);
        let st; try { st = fs.statSync(abs); } catch { continue; }
        if (!st.isFile() || st.size < 64 * 1024 * 1024) continue;   // 64 MB dan kichigi model emas
        if (found.some((x) => x.abs === abs)) continue;
        found.push({ abs, file: f, bytes: st.size, dir });
      }
    }
  }
  if (preferName) {
    const exact = found.find((x) => x.file.toLowerCase() === String(preferName).toLowerCase());
    if (exact) return exact;
  }
  // Eng kattasi emas, eng MOS keladigani: kichik (tez) model afzal, lekin baribir model bo'lsin.
  found.sort((a, b) => a.bytes - b.bytes);
  return found[0] || null;
}

/**
 * Lokal rasm dvigateli holati.
 * @returns {{ available: boolean, exe: string|null, dir: string|null, model: object|null,
 *             backend: 'vulkan'|'cpu'|null, dirs: string[], reason: string }}
 */
export function sdStatus({ dirs = resolveSdDirs(), model = null } = {}) {
  const bin = findSdBinary(dirs);
  const mdl = bin ? findSdModel(dirs, model) : null;
  const backend = bin
    ? (fs.existsSync(path.join(bin.dir, 'ggml-vulkan.dll')) ? 'vulkan' : 'cpu')
    : null;
  let reason = '';
  if (!bin) reason = 'sd-cli.exe topilmadi (rasm dvigateli o‘rnatilmagan)';
  else if (!mdl) reason = 'rasm modeli (.safetensors) topilmadi';
  return { available: !!(bin && mdl), exe: bin ? bin.exe : null, dir: bin ? bin.dir : null, model: mdl, backend, dirs, reason };
}

/** `512x512` yoki `512` → { width, height }. */
function parseSize(size, fallback = 512) {
  const m = String(size || '').match(/^(\d{2,4})\s*[x×*]\s*(\d{2,4})$/);
  if (m) return { width: Number(m[1]), height: Number(m[2]) };
  const n = Number(size);
  if (Number.isFinite(n) && n >= 64 && n <= 2048) return { width: n, height: n };
  return { width: fallback, height: fallback };
}

/**
 * Bitta rasmni sinxron yaratadi (sd-cli tugaguncha kutadi).
 * @returns {Promise<{ buffer: Buffer, mime: string, seconds: number, path: string, via: string }>}
 */
export async function generateLocalImage({
  prompt,
  negative = '',
  size = 512,
  steps = null,
  cfgScale = null,
  seed = -1,
  threads = 0,
  vaeTiling = true,
  dirs = resolveSdDirs(),
  modelFile = null,
  timeoutMs = 600000,
  signal = null,
  onLog = null,
} = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('prompt bo‘sh');
  const st = sdStatus({ dirs, model: modelFile });
  if (!st.available) throw new Error(`lokal rasm dvigateli tayyor emas — ${st.reason}`);

  const { width, height } = parseSize(size);
  const useSteps = Math.max(1, Math.min(60, Number(steps) || 20));
  const useCfg = Number.isFinite(Number(cfgScale)) && cfgScale !== null ? Number(cfgScale) : 7.0;
  const outPath = path.join(os.tmpdir(), `yang-sd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);

  const args = [
    '-m', st.model.abs,
    '-p', text,
    '-o', outPath,
    '-W', String(width),
    '-H', String(height),
    '--steps', String(useSteps),
    '--cfg-scale', String(useCfg),
    '-s', String(Number.isFinite(Number(seed)) ? Number(seed) : -1),
  ];
  if (negative) args.push('-n', String(negative));
  if (vaeTiling) args.push('--vae-tiling');
  if (Number(threads) > 0) args.push('-t', String(threads));

  const startedAt = Date.now();

  const runOnce = (bin) => new Promise((resolve, reject) => {
    const log = [];
    const child = spawn(bin.exe, args, { cwd: bin.dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (err) reject(err); else resolve(log);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* o'lgan */ }
      finish(new Error(`lokal rasm ${Math.round(timeoutMs / 1000)} s ichida tugamadi`));
    }, Math.max(10000, Number(timeoutMs) || 600000));
    const onAbort = () => { try { child.kill(); } catch { /* o'lgan */ } finish(new Error('bekor qilindi')); };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const collect = (buf) => {
      const s = String(buf);
      for (const line of s.split(/\r?\n/)) if (line.trim()) log.push(line.trim());
      if (log.length > 400) log.splice(0, log.length - 400);
      if (typeof onLog === 'function') { try { onLog(s); } catch { /* jimgina */ } }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (e) => finish(new Error(`sd-cli ishga tushmadi: ${e.message}`)));
    child.on('exit', (code) => {
      if (code !== 0) {
        const tail = log.slice(-6).join(' | ').slice(0, 600);
        finish(new Error(`sd-cli ${code} kodi bilan tugadi${tail ? ` — ${tail}` : ''}`));
      } else finish();
    });
  });

  // `YANG_SD_BACKEND=cpu|vulkan` — backendni majburan tanlash (sinov va 4 GB VRAM holati).
  let bin = st;
  const forced = String(process.env.YANG_SD_BACKEND || '').toLowerCase();
  if (forced === 'cpu' || forced === 'vulkan') {
    const b = findSdBinaryFor(dirs, forced);
    if (b && path.resolve(b.exe) !== path.resolve(st.exe)) bin = { ...st, exe: b.exe, dir: b.dir, backend: b.backend };
  }

  let log = [];
  let usedCpuFallback = false;
  try {
    log = await runOnce(bin);
  } catch (e) {
    // 4 GB video karta + katta model (SD-Turbo fp32) → Vulkan OOM. CPU nusxa bo‘lsa,
    // o‘sha bilan bir marta qayta urinamiz — foydalanuvchi «neye ishlamayapti» deb
    // qolmasin, rasm baribir chiqadi (sekinroq).
    const cpu = bin.backend === 'vulkan' ? findSdBinaryFor(dirs, 'cpu') : null;
    if (!isOutOfVram(e.message) || !cpu || path.resolve(cpu.exe) === path.resolve(bin.exe)) throw e;
    usedCpuFallback = true;
    bin = { ...st, exe: cpu.exe, dir: cpu.dir, backend: 'cpu' };
    log = await runOnce(bin);
    log.push('video xotirasi yetmadi — CPU dvigatel bilan qayta urinildi');
  }

  let buffer;
  try {
    buffer = await fsp.readFile(outPath);
  } catch {
    throw new Error(`sd-cli rasm yozmadi (kutilgan fayl: ${outPath})`);
  } finally {
    fsp.unlink(outPath).catch(() => {});
  }
  if (!buffer || buffer.length < 1000) throw new Error('sd-cli bo‘sh rasm qaytardi');
  return {
    buffer,
    mime: 'image/png',
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    path: outPath,
    via: `Lokal · stable-diffusion.cpp (${bin.backend}${usedCpuFallback ? ', CPU zaxira' : ''}) · ${st.model.file}`,
    width,
    height,
    steps: useSteps,
    log: log.slice(-20),
  };
}

/** `generateImage()` uchun qulay qobiq: `size` "512x512" ko'rinishida ham keladi. */
export async function generateLocalImageQuick(opts = {}) {
  const { size, steps, cfgScale, seed, ...rest } = opts;
  const parsed = parseSize(size);
  return generateLocalImage({
    steps: steps ?? (parsed.width >= 768 ? 25 : 20),
    cfgScale: cfgScale ?? 7.0,
    seed: seed ?? -1,
    ...rest,
    size: `${parsed.width}x${parsed.height}`,
  });
}
