// ide_models.js — «Lokal AI» menejeri: apparat talablari, kuch reytingi, yuklab olish.
//
// Muammo: foydalanuvchi qaysi lokal modelni yuklab olishni bilmaydi — qaysi biri uning
// kompyuterida ishlaydi, qanchasi "kuchli", qancha joy kerak? Ilgari model tanlash
// `ensureLocalServer()` ichida yashirin darajada (RAM >= 8 GB → 4B) bo'lgan va
// foydalanuvchi buni KO'RMASDI, yuklab olish umuman yo'q edi.
//
// Bu modul uch narsani beradi:
//   1. `hardwareProfile()` — real apparat (RAM, VRAM, disk, CPU) va undan kelib chiqqan
//      umumiy daraja (matn uchun / rasm uchun alohida yulduz).
//   2. `catalogView()` — `local-ai/catalog.json` dagi har bir model uchun: o'lchangan kuch
//      reytingi, minimal talablar, SHU kompyuterda mos keladimi (`verdict`) va
//      "sizdagi natija" yulduzi (`stars`).
//   3. Haqiqiy yuklab olish: HuggingFace/GitHub dan oqim bilan (progress %), bekor qilish,
//      hajm tekshiruvi va arxiv bo'lsa ochish (rasm dvigateli).
//
// MUHIM (paketlash): dastur `Program Files` ga o'rnatiladi va u yer KARSHI BO'LMAYDI.
// Shuning uchun yuklab olingan hamma narsa `%APPDATA%/yang-ai/models` ga tushadi;
// ilova bilan kelgan model esa `resources/local-ai` da (faqat o'qish uchun). Qidiruv
// ikkalasini ham ko'radi — `modelDirs()`.
import { app, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { configureSd, sdStatus, findSdBinary, generateLocalImage } from '../agent/local_sd.js';
import { benchStars, measuredFromReport } from '../agent/bench_score.js';

const CH = 'yide';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_APP = path.resolve(HERE, '..');
const GIB = 1024 ** 3;
const round = (n, d = 1) => Number(n.toFixed(d));

/**
 * Yuklab olingan modellar (yozsa bo‘ladigan joy).
 *
 * `YANG_MODELS_DIR` bilan boshqa diskka ko‘chirish mumkin: `C:` to‘lib qolganda (o‘lchandi:
 * 0,9–2,9 GB bo‘sh) rasm/nutq modellari sig‘maydi, `D:` da esa o‘nlab GB bor. Ilova
 * `local-ai/catalog.json` dagi `subdir` larni shu ildiz ostida ochadi, ya'ni papkani
 * ko‘chirish kifoya — katalog o‘zgarmaydi.
 */
export function userModelsDir() {
  const override = String(process.env.YANG_MODELS_DIR || '').trim();
  if (override) return override;
  return path.join(app.getPath('userData'), 'models');
}

/** Ilova bilan kelgan modellar (faqat o'qish uchun — resources/local-ai). */
export function bundledModelsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'local-ai') : path.join(ROOT_APP, 'local-ai');
}

/** Model qidiriladigan papkalar: avval foydalanuvchiniki (yangiroq), keyin ilovaniki. */
export function modelDirs() {
  return [userModelsDir(), bundledModelsDir()];
}

/** `agent/local_sd.js` uchun rasm dvigateli papkalari. */
export function sdModelDirs() {
  return [path.join(userModelsDir(), 'sd'), path.join(bundledModelsDir(), 'sd')];
}

/* ------------------------------------------------------------------ katalog */
let catalogCache = null;
let catalogCacheAt = 0;

export function loadCatalog() {
  if (catalogCache && Date.now() - catalogCacheAt < 10000) return catalogCache;
  const file = path.join(bundledModelsDir(), 'catalog.json');
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    raw = { version: 0, items: [], error: `catalog.json o‘qilmadi (${path.basename(file)}): ${e.message}` };
  }
  if (!Array.isArray(raw.items)) raw.items = [];
  applyMeasuredResults(raw);
  catalogCache = raw;
  catalogCacheAt = Date.now();
  return raw;
}

/** Katalog keshi eskirdi (masalan, yangi o‘lchov yozilgandan keyin) — qayta o‘qiladi. */
export function invalidateCatalog() {
  catalogCache = null;
  catalogCacheAt = 0;
}

/* ------------------------------------------------- shu kompyuterda o‘lchangan ball */
// Katalog `Program Files` ichida (faqat o‘qish uchun) — unga yozib bo‘lmaydi. Shu sababli
// o‘lchov natijalari `%APPDATA%/yang-ai/models/measured.json` ga tushadi va katalog
// o‘qilganda birlashtiriladi. Kalit — model FAYLI nomi (bir xil gguf bir marta o‘lchanadi).

export function measuredStorePath() {
  return path.join(app.getPath('userData'), 'models', 'measured.json');
}

export function loadMeasuredResults() {
  try {
    const j = JSON.parse(fs.readFileSync(measuredStorePath(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function saveMeasuredResults(store) {
  const file = measuredStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}

/** O‘lchangan natijani katalog yozuviga qo‘llaydi: ball, yulduz va izoh yangilanadi. */
function applyMeasuredResults(raw) {
  const store = loadMeasuredResults();
  for (const item of raw.items) {
    const m = item.file ? store[item.file] : null;
    if (!m) continue;
    item.measured = { ...(item.measured || {}), ...m };
    const stars = benchStars(m.idePass, m.tasks);
    item.level = stars;
    item.strength = { ...(item.strength || {}), code: stars };
  }
  return raw;
}

/* --------------------------------------------------------------- o‘lchov yurishi */
// «O‘lchash» tugmasi: yuklangan modelni 4 haqiqiy vazifa bilan (IDE halqasi bilan) sinaydi
// va natijani yuqoridagi `measured.json` ga yozadi. Sinovning o‘zi `agent/bench_ide_assisted.mjs`
// — bir xil vazifalar, bir xil tekshiruvlar, IDE dagi ball formulasi (`agent/bench_score.js`).
let benchJob = null;

export function benchState() {
  if (!benchJob) return { running: false };
  return {
    running: true,
    id: benchJob.item.id,
    name: benchJob.item.name,
    seconds: round((Date.now() - benchJob.startedAt) / 1000),
    percent: benchJob.percent || 0,
    line: benchJob.line || '',
  };
}

function emitBench(state) {
  try { sendFn(`${CH}:model-bench`, { ...benchState(), ...state }); } catch { /* oyna yopilgan */ }
}

export function measureModel({ id, tasks } = {}) {
  if (benchJob) {
    return { error: `o‘lchov allaqachon ketmoqda: ${benchJob.item.name} (${Math.round((Date.now() - benchJob.startedAt) / 1000)} s)` };
  }
  const item = loadCatalog().items.find((x) => x.id === id);
  if (!item) return { error: 'model topilmadi' };
  if (item.kind !== 'text') return { error: 'o‘lchov faqat matn modeli uchun' };
  const inst = installedInfo(item);
  if (!inst.installed || !inst.abs) return { error: 'model o‘rnatilmagan — avval yuklab oling' };
  // Sinov skripti paketning bir qismi (electron-builder: asarUnpack) — paketlangan
  // ilovada ham `node` sifatida ishga tushadi.
  // `YANG_IDE_BENCH_SCRIPT` — sinov uchun tikuv (test haqiqiy 4 daqiqalik sinovni kutmasin).
  const script = process.env.YANG_IDE_BENCH_SCRIPT || (app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'agent', 'bench_ide_assisted.mjs')
    : path.join(ROOT_APP, 'agent', 'bench_ide_assisted.mjs'));
  // Sinov serveri: modelning o‘z papkasidagi `lc` (foydalanuvchi o‘rnatgan runtime),
  // bo‘lmasa ilova bilan kelgan nusxa.
  const serverExe = [
    path.join(inst.root, 'lc', 'llama-server.exe'),
    path.join(bundledModelsDir(), 'lc', 'llama-server.exe'),
  ].find((p) => fs.existsSync(p)) || '';
  // Har bir yurish o‘z papkasiga: eski hisobot yangisiga aralashmasin.
  const outDir = path.join(app.getPath('userData'), 'bench', item.id, String(Date.now()));
  fs.mkdirSync(outDir, { recursive: true });
  const modelDir = path.dirname(inst.abs);
  const taskList = (tasks || 'factorial,slugify,fizzbuzz,median_bug').split(',').map((s) => s.trim()).filter(Boolean);
  const job = {
    item,
    startedAt: Date.now(),
    percent: 0,
    line: 'sinov boshlanmoqda…',
    requestedTasks: taskList.length,
    child: null,
  };
  benchJob = job;
  emitBench({});
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    YANG_IDE_BENCH_MODELS: `local:${inst.abs}`,
    YANG_IDE_BENCH_TASKS: taskList.join(','),
    YANG_IDE_BENCH_OUT: outDir,
    YANG_IDE_BENCH_LOCAL_DIR: modelDir,
    YANG_IDE_BENCH_LOCAL_EXE: serverExe,
    YANG_IDE_BENCH_LOCAL_PORT: '8086',   // ilovaning 8082 si band — alohida port
  };
  let child;
  try {
    child = spawn(process.execPath, [script], { env, cwd: ROOT_APP, windowsHide: true });
  } catch (e) {
    benchJob = null;
    return { error: `sinov ishga tushmadi: ${e.message}` };
  }
  job.child = child;
  let tail = '';
  const onLine = (buf) => {
    tail += String(buf);
    const lines = tail.split(/\r?\n/);
    tail = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      job.line = t.slice(0, 160);
      // Server ko‘tarilishi, warm-up, har vazifa va har tuzatish qadami — bitta qator.
      const steps = (t.match(/\b(PASS|FAIL)\b|===|server:|warm-up|qadam/g) || []).length || 1;
      job.percent = Math.min(98, (job.percent || 0) + steps * 6);
      emitBench({});
    }
  };
  child.stdout?.on('data', onLine);
  child.stderr?.on('data', onLine);
  // `spawn` xatosi (masalan, fayl topilmadi) va chiqish — ikkalasi ham yurishni yopadi;
  // aks holda job «ishlayapti» holatida qotib qolardi va qayta o‘lchash bloklanardi.
  let settled = false;
  const settle = (code, err) => {
    if (settled) return;
    settled = true;
    if (benchJob === job) benchJob = null;
    if (err) {
      job.line = `xato: ${err.message}`;
      emitBench({ running: false, done: { id: item.id, name: item.name, ok: false, error: `sinov jarayoni ishlamadi: ${err.message}` } });
      return;
    }
    finishMeasure(job, code, outDir, inst);
  };
  child.on('error', (e) => settle(null, e));
  child.on('close', (code) => settle(code, null));
  return { ok: true, outDir, model: item.name };
}

/** Sinov tugadi: `bench_raw.json` o‘qiladi, ball/formula shu joyda qo‘llanadi, saqlanadi. */
function finishMeasure(job, code, outDir, inst) {
  const result = { id: job.item.id, name: job.item.name, model: inst.abs, seconds: round((Date.now() - job.startedAt) / 1000) };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(outDir, 'bench_raw.json'), 'utf8'));
    // Ball ham, yulduz ham — YAGONA formuladan (`agent/bench_score.js`), hisobot skripti
    // bilan bir xil; bu yerda faqat hisobotdan o‘qib olish qoladi.
    const m = measuredFromReport(raw, inst.abs, job.requestedTasks || 4);
    const measured = {
      source: 'shu kompyuterda o‘lchandi (4 vazifa · IDE halqasi)',
      ...m,
      at: new Date().toISOString(),
      report: outDir,
    };
    const store = loadMeasuredResults();
    store[job.item.file] = measured;
    saveMeasuredResults(store);
    invalidateCatalog();
    Object.assign(result, { ok: true, measured, stars: benchStars(m.idePass, m.tasks) });
  } catch (e) {
    Object.assign(result, { ok: false, error: `natija o‘qilmadi: ${e.message}`, exitCode: code });
  }
  emitBench({ running: false, done: result });
  return result;
}

/* ------------------------------------------------------------- apparat profili */
let hwCache = null;

function detectGpu() {
  const empty = { name: '', vramGb: 0, driver: '', note: '' };
  if (process.platform !== 'win32') return empty;
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object -First 4 Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 12000, windowsHide: true });
    if (r.status !== 0 || !r.stdout) return empty;
    let j = JSON.parse(r.stdout.trim());
    if (!Array.isArray(j)) j = [j];
    // Eng katta VRAM li kartani olamiz (integratsiya + diskret bo'lsa).
    j.sort((a, b) => (b.AdapterRAM || 0) - (a.AdapterRAM || 0));
    const g = j[0] || {};
    const ram = Number(g.AdapterRAM) || 0;
    // WMI cheklovi: 4 GB dan katta kartalar ham 4293918720 bayt (4095 MB) ko'rsatadi.
    const capped = ram >= 4293918720;
    return {
      name: String(g.Name || '').trim(),
      vramGb: capped ? 4 : round(ram / GIB, 1),
      driver: String(g.DriverVersion || ''),
      note: capped ? 'WMI 4 GB dan katta VRAM ni aniq ko‘rsatmaydi — haqiqiy hajm kattaroq bo‘lishi mumkin' : '',
      gpus: j.map((x) => String(x.Name || '').trim()).filter(Boolean),
    };
  } catch {
    return empty;
  }
}

async function freeDiskGb(dir) {
  let probe = dir;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(probe)) break;
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  try {
    const st = await fsp.statfs(probe);
    return round((st.bavail * st.bsize) / GIB, 1);
  } catch {
    try {
      const r = spawnSync('wmic', ['logicaldisk', 'get', 'DeviceID,FreeSpace', '/value'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      const line = String(r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('FreeSpace='));
      if (line) {
        const drive = path.parse(probe).root.slice(0, 2).toUpperCase();
        const rows = String(r.stdout || '').split(/DeviceID=/).slice(1);
        const hit = rows.find((x) => x.startsWith(drive));
        if (hit) return round(Number((hit.match(/FreeSpace=(\d+)/) || [])[1]) / GIB, 1);
        return round(Number(line.slice(10)) / GIB, 1);
      }
    } catch { /* o'lchanmadi */ }
    return null;
  }
}

function levelOf(score) {
  if (score >= 4.2) return 5;
  if (score >= 3.4) return 4;
  if (score >= 2.5) return 3;
  if (score >= 1.6) return 2;
  return 1;
}

/** Real apparat: RAM/VRAM/disk/CPU va ulardan kelib chiqqan umumiy daraja. */
export async function hardwareProfile({ refresh = false } = {}) {
  if (!refresh && hwCache && Date.now() - hwCache.at < 5 * 60 * 1000) return hwCache.value;
  const cpus = os.cpus();
  const ramGb = round(os.totalmem() / GIB, 1);
  const ramFreeGb = round(os.freemem() / GIB, 1);
  const gpu = detectGpu();
  const modelsDir = userModelsDir();
  const diskFreeGb = await freeDiskGb(modelsDir);

  // Matn darajasi: RAM hal qiladi (llama.cpp CPU'da ishlaydi), yadrolar tezlikni beradi.
  const ramScore = ramGb >= 32 ? 3.6 : ramGb >= 16 ? 3.2 : ramGb >= 12 ? 2.7 : ramGb >= 8 ? 2.1 : ramGb >= 6 ? 1.6 : 1.0;
  const coreScore = cpus.length >= 12 ? 1.2 : cpus.length >= 8 ? 1.0 : cpus.length >= 6 ? 0.8 : cpus.length >= 4 ? 0.6 : 0.3;
  // Rasm darajasi: VRAM hal qiladi, RAM zaxira (CPU rejimi).
  const vramScore = gpu.vramGb >= 12 ? 3.6 : gpu.vramGb >= 8 ? 3.2 : gpu.vramGb >= 6 ? 2.7 : gpu.vramGb >= 4 ? 2.2 : gpu.vramGb >= 2 ? 1.6 : 0.6;
  const imageScore = vramScore + Math.min(1.2, ramScore * 0.35);

  const value = {
    platform: process.platform,
    arch: process.arch,
    cpu: (cpus[0] && cpus[0].model || 'CPU').trim(),
    cores: cpus.length,
    ramGb,
    ramFreeGb,
    gpu: gpu.name,
    gpuAll: gpu.gpus || [],
    gpuNote: gpu.note || '',
    vramGb: gpu.vramGb,
    diskFreeGb,
    modelsDir,
    textLevel: levelOf(ramScore + coreScore),
    imageLevel: levelOf(imageScore),
    measured: false,
  };
  hwCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------- moslik bahosi va yulduz */
const FIT_LABEL = {
  ok: 'Mos keladi',
  borderline: 'Mos (chegarada)',
  heavy: 'Sekin ishlaydi',
  blocked: 'Ishlamaydi',
};

function verdictFor(item, hw, installed) {
  const reasons = [];
  const need = item.min || {};
  const rec = item.recommend || {};
  let state = 'ok';

  if (need.diskGb && hw.diskFreeGb != null && hw.diskFreeGb < need.diskGb * 1.1) {
    state = 'blocked';
    reasons.push(`diskda ${hw.diskFreeGb} GB bo‘sh, kerak ~${need.diskGb} GB`);
  }
  if (need.ramGb && hw.ramGb < need.ramGb * 0.9) {
    state = 'blocked';
    reasons.push(`RAM ${hw.ramGb} GB — kerak ${need.ramGb} GB`);
  } else if (rec.ramGb && hw.ramGb < rec.ramGb - 0.5) {
    // 0,5 GB bag'rikenglik: 11,9 GB li mashina «12 GB tavsiya» uchun chegarada emas —
    // o'lchov shuni ko'rsatdi (o'sha mashinada 7B 4/4 vazifa o'tdi).
    if (state === 'ok') state = 'borderline';
    reasons.push(`RAM ${hw.ramGb} GB — tavsiya ${rec.ramGb} GB (sekinroq javob beradi)`);
  } else if (rec.ramGb) {
    reasons.push(`RAM ${hw.ramGb} GB — yetarli (tavsiya ${rec.ramGb} GB)`);
  }

  if (need.vramGb) {
    if (hw.vramGb >= (rec.vramGb || need.vramGb)) {
      reasons.push(`video karta ${hw.vramGb} GB — GPU (${hw.gpu || 'gpu'}) rejimida ishlaydi`);
    } else if (hw.vramGb >= need.vramGb) {
      if (state === 'ok') state = 'borderline';
      reasons.push(`video karta ${hw.vramGb} GB — chegarada, sekinroq bo‘lishi mumkin`);
    } else {
      if (state === 'ok') state = 'heavy';
      reasons.push(`video karta ${hw.vramGb} GB (kerak ${need.vramGb} GB) — CPU rejimida ishlaydi, sekin`);
    }
  }
  if (need.ramGb && hw.ramFreeGb != null && hw.ramFreeGb < need.ramGb * 0.75) {
    reasons.push(`hozir bo‘sh RAM atigi ${hw.ramFreeGb} GB — ortiqcha dasturlarni yopsangiz tezroq`);
  }
  if (item.measured) {
    reasons.push(`o‘lchandi: IDE halqasi bilan ${item.measured.idePass}/${item.measured.tasks} vazifa, o‘rtacha ${item.measured.avgSeconds}s`);
  } else {
    reasons.push('bu model shu loyihada o‘lchanMAGAN — kuch bahosi oilaviy (tahminiy)');
  }
  if (installed && installed.installed) reasons.unshift('allaqachon o‘rnatilgan');

  return { state, fit: FIT_LABEL[state] || state, reasons };
}

/** Modelning O'Z kuchi (o'lchovga asoslangan yoki taxminiy) — 1..5. */
export function strengthStars(item) {
  const s = item.strength || {};
  const base = item.kind === 'image' ? (s.quality || 3) : (s.code || 3);
  return Math.max(1, Math.min(5, Math.round(base)));
}

/** SHU kompyuterda kutiladigan natija — model kuchi × moslik. */
export function machineStars(item, verdict) {
  if (verdict.state === 'blocked') return 0;
  const factor = verdict.state === 'ok' ? 1 : verdict.state === 'borderline' ? 0.8 : 0.5;
  return Math.max(1, Math.min(5, Math.round(strengthStars(item) * factor)));
}

/* ------------------------------------------------------------- o'rnatilgan holat */
function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/** Model (yoki runtime) o'rnatilganmi — ikki ildiz bo'ylab. */
export function installedInfo(item) {
  if (!item || (!item.file && item.kind !== 'runtime')) return { installed: false };
  const bundled = bundledModelsDir();
  if (item.kind === 'runtime') {
    const bin = findSdBinary(sdModelDirs());
    if (!bin) return { installed: false, kind: 'runtime' };
    const hasVulkan = fs.existsSync(path.join(bin.dir, 'ggml-vulkan.dll'));
    const wantsVulkan = item.id.endsWith('vulkan');
    // Ilova bilan kelgan nusxa O'CHIRILMAYDI (aks holda offline rasm dvigateli butunlay
    // yo'qoladi va uni faqat qayta yuklab tiklash mumkin) — `readonly` bayrog'i bilan.
    const readonly = path.resolve(bin.dir).toLowerCase().startsWith(path.resolve(bundled).toLowerCase());
    return {
      installed: wantsVulkan ? hasVulkan : true,
      kind: 'runtime',
      abs: bin.exe,
      bytes: statSafe(bin.exe)?.size || 0,
      partial: wantsVulkan && !hasVulkan,
      readonly,
      root: readonly ? bundled : userModelsDir(),
    };
  }
  for (const root of modelDirs()) {
    const abs = path.join(root, item.subdir || '', item.file);
    const st = statSafe(abs);
    if (!st || !st.isFile()) continue;
    const partial = !!(item.bytes && Math.abs(st.size - Number(item.bytes)) > Number(item.bytes) * 0.01);
    return {
      installed: !partial,
      partial,
      abs,
      bytes: st.size,
      root,
      readonly: path.resolve(root).toLowerCase() === path.resolve(bundled).toLowerCase(),
    };
  }
  return { installed: false };
}

/* ------------------------------------------------------------------ yuklab olish */
const downloads = new Map();      // id -> job
let sendFn = () => {};

function jobView(job) {
  return {
    id: job.item.id,
    state: job.state,
    received: job.received,
    total: job.total,
    percent: job.total ? Math.min(100, Math.round((job.received / job.total) * 1000) / 10) : null,
    mbps: job.mbps || 0,
    seconds: round((Date.now() - job.startedAt) / 1000, 1),
    error: job.error || '',
  };
}

function emitProgress(job) {
  try { sendFn(`${CH}:model-progress`, jobView(job)); } catch { /* oyna yopilgan */ }
}

function extractZip(zipPath, destDir) {
  try { fs.mkdirSync(destDir, { recursive: true }); } catch { /* bor */ }
  let r;
  if (process.platform === 'win32') {
    r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath "${zipPath.replace(/"/g, '""')}" -DestinationPath "${destDir.replace(/"/g, '""')}" -Force`],
    { encoding: 'utf8', timeout: 180000, windowsHide: true });
    if (r.status !== 0) {
      // PowerShell yo'q bo'lsa tar.exe (Windows 10+) zaxira.
      r = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { encoding: 'utf8', timeout: 180000, windowsHide: true });
    }
  } else {
    r = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { encoding: 'utf8', timeout: 180000 });
  }
  if (r && r.status !== 0) {
    throw new Error(`arxiv ochilmadi: ${String((r.stderr || r.stdout || '').trim()).slice(0, 200)}`);
  }
}

async function runDownload(job) {
  const { item } = job;
  const dir = path.join(userModelsDir(), item.subdir || '');
  await fsp.mkdir(dir, { recursive: true });
  job.dest = path.join(dir, item.file);
  job.part = `${job.dest}.part`;
  await fsp.rm(job.part, { force: true });

  const res = await fetch(item.url, { signal: job.controller.signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${item.url.slice(0, 80)}`);
  const total = Number(res.headers.get('content-length')) || Number(item.bytes) || 0;
  job.total = total;

  const startedAt = Date.now();
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      job.received += chunk.length;
      const now = Date.now();
      if (now - (job.lastEmit || 0) > 500) {
        job.lastEmit = now;
        const secs = (now - startedAt) / 1000;
        job.mbps = secs > 0.5 ? round(job.received / 1048576 / secs, 2) : 0;
        emitProgress(job);
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(job.part), { signal: job.controller.signal });

  if (job.total && Math.abs(job.received - job.total) > Math.max(4096, job.total * 0.005)) {
    throw new Error(`hajm mos emas: ${job.received} / ${job.total} bayt (yuklab olish to‘liq bo‘lmadi)`);
  }
  await fsp.rename(job.part, job.dest);

  if (item.extract) {
    job.state = 'extracting';
    emitProgress(job);
    const destDir = path.join(userModelsDir(), item.extractTo || item.subdir || 'sd');
    extractZip(job.dest, destDir);
    await fsp.rm(job.dest, { force: true });
    const bin = findSdBinary(sdModelDirs());
    if (!bin) throw new Error('arxiv ochildi, lekin sd-cli.exe topilmadi — arxiv tarkibini tekshiring');
  }
  job.state = 'done';
  job.percent = 100;
  emitProgress(job);
}

function startDownload(item) {
  if (downloads.has(item.id)) {
    const j = downloads.get(item.id);
    if (j.state === 'downloading' || j.state === 'extracting') return { ok: false, error: 'bu model allaqachon yuklanmoqda' };
  }
  if (!item.url) return { ok: false, error: 'bu model ilova ichida kelgan — yuklab olish shart emas' };
  const job = {
    item,
    state: 'downloading',
    controller: new AbortController(),
    startedAt: Date.now(),
    received: 0,
    total: Number(item.bytes) || 0,
    lastEmit: 0,
    mbps: 0,
    error: '',
  };
  downloads.set(item.id, job);
  emitProgress(job);
  runDownload(job).catch((e) => {
    job.state = job.controller.signal.aborted ? 'canceled' : 'error';
    job.error = String((e && e.message) || e);
    if (job.part) fsp.rm(job.part, { force: true }).catch(() => {});
    emitProgress(job);
  });
  return { ok: true, job: jobView(job) };
}

/* -------------------------------------------------------- tashqi (o'rnatilgan) AI */
async function boundedSize(dir, { maxEntries = 1500 } = {}) {
  let total = 0;
  let count = 0;
  const stack = [dir];
  while (stack.length && count < maxEntries) {
    const cur = stack.pop();
    let entries = [];
    try { entries = await fsp.readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (count >= maxEntries) break;
      count += 1;
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else {
        try { total += (await fsp.stat(abs)).size; } catch { /* o'qilmadi */ }
      }
    }
  }
  return { bytes: total, truncated: count >= maxEntries };
}

async function httpModels(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Kompyuterda ALLAQACHON o'rnatilgan lokal AI larni topadi: Ollama, LM Studio,
 * HuggingFace keshi va ilovaning o'z model papkalari. Yuklab olish shart emas —
 * topilganini bir bosishda ishlatish mumkin (`attach`).
 */
export async function externalScan() {
  const out = { ollama: null, lmstudio: null, hf: [], localDirs: [], scannedAt: Date.now() };

  // --- Ollama (server ishlamasa ham o'rnatilganini aytamiz) ---
  const tags = await httpModels('http://127.0.0.1:11434/api/tags');
  let ollamaExe = '';
  if (process.platform === 'win32') {
    const cand = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
    if (fs.existsSync(cand)) ollamaExe = cand;
  } else {
    const r = spawnSync('which', ['ollama'], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0) ollamaExe = String(r.stdout).trim();
  }
  if (tags && Array.isArray(tags.models)) {
    out.ollama = {
      running: true,
      installed: true,
      exe: ollamaExe,
      base: 'http://127.0.0.1:11434/v1',
      models: tags.models.map((m) => ({
        name: m.name || m.model,
        bytes: Number(m.size) || 0,
        params: (m.details && m.details.parameter_size) || '',
        quant: (m.details && m.details.quantization_level) || '',
        modified: m.modified_at || '',
      })).sort((a, b) => b.bytes - a.bytes),
    };
  } else if (ollamaExe || fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama'))) {
    out.ollama = { running: false, installed: true, exe: ollamaExe, base: 'http://127.0.0.1:11434/v1', models: [], note: 'Ollama o‘rnatilgan, lekin server ishlamayapti — `ollama serve` kerak' };
  }

  // --- LM Studio ---
  const lm = await httpModels('http://127.0.0.1:1234/v1/models');
  if (lm && Array.isArray(lm.data)) {
    out.lmstudio = {
      running: true,
      base: 'http://127.0.0.1:1234/v1',
      models: lm.data.map((m) => ({ name: m.id, bytes: 0, params: '', quant: '' })),
    };
  }

  // --- HuggingFace keshi (transformers/diffusers yuklagan modellar) ---
  const hubs = [];
  const pushHub = (p) => { if (p && !hubs.includes(p)) hubs.push(p); };
  if (process.env.HF_HOME) pushHub(path.join(process.env.HF_HOME, 'hub'));
  if (process.env.HUGGINGFACE_HUB_CACHE) pushHub(process.env.HUGGINGFACE_HUB_CACHE);
  pushHub(path.join(os.homedir(), '.cache', 'huggingface', 'hub'));
  if (process.platform === 'win32' && process.env.USERPROFILE) pushHub(path.join(process.env.USERPROFILE, '.cache', 'huggingface', 'hub'));
  for (const hub of hubs) {
    let entries = [];
    try { entries = await fsp.readdir(hub, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith('models--')) continue;
      const abs = path.join(hub, e.name);
      const repo = e.name.replace(/^models--/, '').replace(/--/g, '/');
      const sz = await boundedSize(abs);
      out.hf.push({ repo, dir: abs, bytes: sz.bytes, approximate: sz.truncated });
    }
    break;   // birinchi topilgan kesh yetarli
  }
  out.hf.sort((a, b) => b.bytes - a.bytes);

  // --- Ilovaning o'z papkalari (+ qo'lda tashlangan gguf lar) ---
  for (const root of modelDirs()) {
    let entries = [];
    try { entries = await fsp.readdir(root); } catch { continue; }
    for (const f of entries) {
      const abs = path.join(root, f);
      const st = statSafe(abs);
      if (!st) continue;
      if (st.isFile() && /\.(gguf|safetensors|ckpt)$/i.test(f)) {
        out.localDirs.push({ root, file: f, abs, bytes: st.size });
      }
    }
  }
  const sd = sdStatus({ dirs: sdModelDirs() });
  out.image = { available: sd.available, exe: sd.exe, model: sd.model ? sd.model.file : null, backend: sd.backend, reason: sd.reason };
  return out;
}

/* ------------------------------------------------------------------------ IPC */
let ipcRegistered = false;
let imageAbort = null;

export function registerModelsIpc({ send, saveSharedModel = null, getWorkspace = () => '', safePath = null } = {}) {
  sendFn = typeof send === 'function' ? send : sendFn;
  configureSd(sdModelDirs());
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle(`${CH}:hw-profile`, (_e, args) => hardwareProfile({ refresh: !!(args && args.refresh) }));

  ipcMain.handle(`${CH}:models-catalog`, async () => {
    const hw = await hardwareProfile();
    const cat = loadCatalog();
    const items = cat.items.map((item) => {
      const inst = installedInfo(item);
      const verdict = verdictFor(item, hw, inst);
      const job = downloads.get(item.id);
      return {
        id: item.id,
        kind: item.kind,
        name: item.name,
        bytes: Number(item.bytes) || 0,
        url: item.url || '',
        backend: item.backend || '',
        min: item.min || {},
        recommend: item.recommend || {},
        measured: item.measured || null,
        strength: item.strength || {},
        level: item.level || 3,
        langs: item.langs || [],
        notes: item.notes || '',
        bundled: !!item.bundled,
        installed: inst.installed,
        partial: !!inst.partial,
        readonly: !!inst.readonly,
        installedBytes: inst.bytes || 0,
        verdict,
        stars: strengthStars(item),
        machineStars: machineStars(item, verdict),
        progress: job ? jobView(job) : null,
      };
    });
    return {
      error: cat.error || '',
      updated: cat.updated || '',
      levels: cat.levels || {},
      hardware: hw,
      sd: (() => { const s = sdStatus({ dirs: sdModelDirs() }); return { available: s.available, backend: s.backend, exe: s.exe, model: s.model ? s.model.file : null, reason: s.reason }; })(),
      items,
    };
  });

  // --- «O‘lchash»: modelni 4 haqiqiy vazifa bilan sinab, kuch reytingini yangilash ---
  ipcMain.handle(`${CH}:models-measure`, (_e, { id, tasks } = {}) => measureModel({ id, tasks }));
  ipcMain.handle(`${CH}:models-bench-state`, () => benchState());

  ipcMain.handle(`${CH}:models-download`, (_e, { id } = {}) => {
    const item = loadCatalog().items.find((x) => x.id === id);
    if (!item) return { error: 'model topilmadi' };
    const r = startDownload(item);
    return r.ok ? { ok: true, job: r.job } : { error: r.error };
  });

  ipcMain.handle(`${CH}:models-cancel`, (_e, { id } = {}) => {
    const job = downloads.get(id);
    if (!job) return { error: 'yuklab olish topilmadi' };
    try { job.controller.abort(); } catch { /* allaqachon */ }
    job.state = 'canceled';
    emitProgress(job);
    return { ok: true };
  });

  ipcMain.handle(`${CH}:models-remove`, async (_e, { id } = {}) => {
    const item = loadCatalog().items.find((x) => x.id === id);
    if (!item) return { error: 'model topilmadi' };
    const inst = installedInfo(item);
    if (!inst.abs) return { error: 'o‘rnatilgan fayl topilmadi' };
    // Ilova bilan kelgan nusxa o‘chirilmaydi: u paketning bir qismi (Program Files),
    // aks holda offline model/dvigatel butunlay yo‘qoladi.
    if (inst.readonly) {
      return { error: 'bu nusxa ilova bilan kelgan — o‘chirilmaydi (yuklab olinganini o‘chirish mumkin)' };
    }
    try {
      if (inst.kind === 'runtime') {
        // Runtime — papka (dll'lar bilan birga). Uni ham savatga yuboramiz.
        await shell.trashItem(path.dirname(inst.abs));
      } else {
        await shell.trashItem(inst.abs);
      }
      return { ok: true, removed: inst.abs };
    } catch (e) {
      return { error: `o‘chirilmadi: ${e.message}` };
    }
  });

  ipcMain.handle(`${CH}:models-reveal`, async (_e, { id } = {}) => {
    const item = loadCatalog().items.find((x) => x.id === id);
    const inst = item ? installedInfo(item) : { abs: null };
    const target = (inst && inst.abs) || userModelsDir();
    try {
      if (statSafe(target)?.isFile()) shell.showItemInFolder(target);
      else await shell.openPath(target);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle(`${CH}:models-external`, () => externalScan());

  // Allaqachon o'rnatilgan modelni BIR BOSISHDA ishlatish (yuklab olish shart emas):
  // umumiy sozlamaga provayder + model yoziladi, IDE darhol shundan foydalanadi.
  ipcMain.handle(`${CH}:models-attach`, async (_e, { provider, model, base } = {}) => {
    if (!provider || !model) return { error: 'provayder yoki model ko‘rsatilmagan' };
    if (typeof saveSharedModel !== 'function') return { error: 'sozlamani saqlash mumkin emas' };
    try {
      const saved = await saveSharedModel(provider, model);
      return { ok: true, saved };
    } catch (e) { return { error: e.message }; }
  });

  /* ---- LOKAL rasm generatsiyasi (API emas) ---- */
  ipcMain.handle(`${CH}:image-status`, () => {
    const s = sdStatus({ dirs: sdModelDirs() });
    return { available: s.available, backend: s.backend, exe: s.exe, model: s.model ? s.model.file : null, reason: s.reason, dir: s.dir };
  });

  ipcMain.handle(`${CH}:image-generate`, async (_e, { prompt, size = '512x512', steps, cfgScale, seed, negative } = {}) => {
    const text = String(prompt || '').trim();
    if (!text) return { error: 'prompt bo‘sh' };
    if (imageAbort) return { error: 'rasm allaqachon yaratilmoqda' };
    imageAbort = new AbortController();
    try {
      configureSd(sdModelDirs());
      // Katalogdagi o'rnatilgan rasm modelini topamiz — undan QADAM va CFG olamiz.
      // Bu muhim: SD-Turbo 1–4 qadam va cfg 1.0 bilan ishlaydi, SD1.5 esa 20 qadam va
      // cfg 7.0 bilan. Ikkalasiga bir xil qiymat berilsa natija buziladi.
      const sdNow = sdStatus({ dirs: sdModelDirs() });
      const installedModel = sdNow.model ? sdNow.model.file : '';
      const meta = loadCatalog().items.find((x) => x.kind === 'image'
        && installedModel && String(x.file).toLowerCase() === installedModel.toLowerCase());
      const preset = (meta && meta.image) || {};
      const r = await generateLocalImage({
        prompt: text,
        negative: negative || '',
        size,
        steps: steps ?? preset.steps,
        cfgScale: cfgScale ?? preset.cfgScale,
        seed: seed ?? -1,
        dirs: sdModelDirs(),
        modelFile: installedModel || null,
        signal: imageAbort.signal,
        onLog: () => {},
      });
      // Rasm ish papkasidagi `generated/` ga yoziladi (qamoq tekshiruvi bilan).
      let rel = null;
      let abs = null;
      const ws = getWorkspace();
      if (ws && typeof safePath === 'function') {
        // Diqqat: `safePath('generated/rsm-….png')` ota-papka hali YO'Q bo'lsa null qaytaradi
        // (`realInside` mavjud bo'lmagan ota-papkani ishonchsiz deb hisoblaydi). Shuning uchun
        // avval papkani qamoq ichida yaratamiz, keyin fayl yo'lini so'raymiz.
        const dirT = safePath('generated');
        if (dirT) {
          await fsp.mkdir(dirT.abs, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const t = safePath(path.join('generated', `rsm-${stamp}.png`));
          if (t) {
            await fsp.writeFile(t.abs, r.buffer);
            rel = t.rel;
            abs = t.abs;
          }
        }
      }
      if (!abs) {
        await fsp.mkdir(userModelsDir(), { recursive: true });
        abs = path.join(userModelsDir(), `rsm-${Date.now()}.png`);
        await fsp.writeFile(abs, r.buffer);
      }
      return {
        ok: true,
        rel,
        abs,
        dataUrl: `data:image/png;base64,${r.buffer.toString('base64')}`,
        via: r.via,
        seconds: r.seconds,
        width: r.width,
        height: r.height,
        steps: r.steps,
      };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    } finally {
      imageAbort = null;
    }
  });

  ipcMain.handle(`${CH}:image-stop`, () => {
    if (imageAbort) { try { imageAbort.abort(); } catch { /* o'lgan */ } return { ok: true }; }
    return { ok: false, note: 'rasm yaratilmayapti' };
  });
}

export function disposeModels() {
  for (const job of downloads.values()) {
    try { job.controller.abort(); } catch { /* o'lgan */ }
  }
  downloads.clear();
  if (imageAbort) { try { imageAbort.abort(); } catch { /* o'lgan */ } imageAbort = null; }
}

/** Tashqi ishlatish uchun (test, hisobot): katalog elementining moslik xulosasi. */
export function verdictOf(item, hw) {
  return verdictFor(item, hw, installedInfo(item));
}
