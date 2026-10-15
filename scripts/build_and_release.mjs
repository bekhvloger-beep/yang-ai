// scripts/build_and_release.mjs — QURISH + TEKSHIRISH + NASHR qilishni bitta qadamda bajaradi.
//
// Nega kerak (o'lchangan sabab): 2026-10-14 da mustaqil IDE o'rnatuvchisi
//   Internal compiler error #12345: error creating mmap the size of 1 356 703 055
// bilan yiqildi. Bu ilova kodida emas edi: `makensis` NSIS payload'ini xotiraga XARITALAYDI (mmap)
// va Windows'dan shuncha **commit** so'raydi — mashinada bo'sh commit tugagan bo'lsa xarita
// yaratilmaydi. O'sha kuni commit'ni yetim `llama-server.exe` jarayonlari yeb turgan edi.
// Shu sababli qurishdan OLDIN quyidagilar tekshiriladi va yetmasa skript ANIQ raqamlar bilan
// to'xtaydi (yarim paket va yarim nashr qolib ketmasin):
//   • bo'sh commit  ≥ payload + 16 847 683 B (o'lchangan NSIS ustama) + zaxira;
//   • bo'sh disk    ≥ yoyilgan papka + ikkita o'rnatuvchi (chiqish va vaqtinchalik jildda);
//   • nashr uchun GitHub tokeni joyida.
//
// Yurish:
//   node scripts/build_and_release.mjs                      # qurish + sinov + nashr (hammasi)
//   node scripts/build_and_release.mjs --only=ide           # faqat mustaqil IDE
//   node scripts/build_and_release.mjs --dry-run            # faqat tekshiruv va reja
//   node scripts/build_and_release.mjs --no-publish         # qurib, sinab, nashr qilmasdan
//   node scripts/build_and_release.mjs --no-verify          # paket sinovlarini o'tkazib yuborish
//   node scripts/build_and_release.mjs --kill-orphans       # yetim model-serverlarni tozalab, davom etish
//   node scripts/build_and_release.mjs --force              # tekshiruv ogohlantirishini bilib turib chetlab o'tish
//
// O'lchovlar `reports/build_metrics.json` ga yoziladi va keyingi yurishlarda oldindan tekshiruv
// SHU HAQIQIY qiymatlardan foydalanadi (taxmin emas).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const METRICS_FILE = path.join(ROOT, 'reports', 'build_metrics.json');
const LOG_FILE = path.join(ROOT, 'reports', 'build_and_release.log');

// NSIS mmap ustamasi: ikkala build'da ham xarita aynan `payload + 16 847 683 B` bo'lgan (o'lchandi).
const NSIS_MMAP_OVERHEAD = 16_847_683;
// O'rnatuvchi ichidagi payload ≈ o'rnatuvchi hajmi − stub (bir necha yuz KB). Ehtiyot uchun 800 KB.
const INSTALLER_STUB = 800_000;
// Commit zaxirasi: qurish paytida electron/7z/signtool ham commit ishlatadi.
const COMMIT_MARGIN = 1.25;
// Disk zaxirasi: blockmap, vaqtinchalik fayllar, NSIS ishchi nusxalari.
const DISK_HEADROOM = 512 * 1024 * 1024;
// Yoyilgan papka hajmi bo'yicha zaxira nisbati (agar o'lchov yo'q bo'lsa).
const UNPACKED_RATIO = 1.3;

// Hech o'lchov bo'lmasa ishlatiladigan zaxira qiymatlar — 2026-10-14 dagi haqiqiy artefaktlardan.
const FALLBACK = {
  app: { installer: 1_773_131_060, unpacked: 2_253_772_498 },
  ide: { installer: 1_357_501_270, unpacked: 1_650_000_000 },
};

/* ------------------------------------------------------------------ bayroqlar */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const ONLY = valueOf('only', 'all');
const DRY = has('--dry-run');
const NO_PUBLISH = has('--no-publish');
const NO_VERIFY = has('--no-verify');
const KILL_ORPHANS = has('--kill-orphans');
const FORCE = has('--force');

if (!['all', 'ai', 'ide'].includes(ONLY)) {
  console.log(`Noma'lum --only=${ONLY} (mumkin: all, ai, ide)`);
  process.exit(2);
}

/* ------------------------------------------------------------------ yordamchilar */
const b = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${n.toLocaleString('en-US').replace(/,/g, ' ')} B (${(n / 1024 ** 3).toFixed(2)} GB)` : '—');
const logLines = [];
function log(msg = '') {
  console.log(msg);
  logLines.push(msg);
}
function fail(msg) {
  log(`\n✗ ${msg}`);
  process.exit(1);
}
// Buyruqni ASINXRON yurgizamiz (`execFileSync` emas): sinxron chaqiruv butun hodisalar aylanishini
// bloklaydi va payload kuzatuvchisi (setInterval) umuman ishlamay qoladi — o‘lchov yo‘qoladi.
function run(cmd, args, opts = {}) {
  log(`\n$ ${cmd} ${args.join(' ')}`);
  // Windows'da `npm` aslida `npm.cmd` — Node bunday faylni to'g'ridan-to'g'ri ishga tushirmaydi
  // (`EINVAL`). Shuning uchun uni `cmd.exe /d /s /c` orqali yurgizamiz: `shell: true` ham ishlardi,
  // lekin u argumentlarni ekranlamaydi va Node buni deprecation sifatida ogohlantiradi.
  const isCmd = process.platform === 'win32' && /\.cmd$/i.test(cmd);
  const file = isCmd ? process.env.ComSpec || 'cmd.exe' : cmd;
  const argv = isCmd ? ['/d', '/s', '/c', cmd, ...args] : args;
  return new Promise((resolve) => {
    const child = spawn(file, argv, { cwd: ROOT, stdio: 'inherit', ...opts });
    child.on('close', (code) => resolve(code === null ? 1 : code));
    child.on('error', (e) => {
      log(`   (ishga tushmadi: ${e.message})`);
      resolve(1);
    });
  });
}
function freeDiskBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { bytes: Number(s.bavail) * Number(s.bsize), path: dir };
  } catch (e) {
    return { bytes: null, path: dir, error: e.message };
  }
}
// Papka hajmi (baytlarda) — asar ham, ochiq papka ham, ikkalasi uchun ishlaydi.
function dirSize(dir) {
  let total = 0;
  const walk = (p) => {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(p, e.name);
      try {
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) total += fs.statSync(full).size;
      } catch { /* o'qilmadi — hisobga olinmaydi */ }
    }
  };
  walk(dir);
  return total;
}
// Bo'sh commit (Windows) — PowerShell orqali, MB butun sonlarda (til/lokal formatga bog'lanmasin).
function commitState() {
  if (process.platform !== 'win32') return null;
  const ps = [
    "$l=(Get-Counter '\\Memory\\Commit Limit').CounterSamples[0].CookedValue;",
    "$c=(Get-Counter '\\Memory\\Committed Bytes').CounterSamples[0].CookedValue;",
    "'{0} {1}' -f [int][math]::Round($l/1MB), [int][math]::Round($c/1MB)",
  ].join(' ');
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 30000 }).trim();
    const m = out.match(/(\d+)\s+(\d+)/);
    if (!m) return null;
    const limit = Number(m[1]) * 1024 * 1024;
    const committed = Number(m[2]) * 1024 * 1024;
    return { limit, committed, free: limit - committed };
  } catch {
    return null;
  }
}
// Yetim model-serverlar: commit'ni eng ko'p yeydigan jarayonlar (`PrivateMemorySize64` ≈ commit hissasi).
function llamaProcesses() {
  if (process.platform !== 'win32') return [];
  const ps = "Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object { '{0} {1}' -f $_.Id, [int]($_.PrivateMemorySize64/1MB) }";
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 30000 }).trim();
    return out
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)$/))
      .filter(Boolean)
      .map((m) => ({ pid: Number(m[1]), commitBytes: Number(m[2]) * 1024 * 1024 }));
  } catch {
    return [];
  }
}
function readJson(file, dflt) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; }
}
const metrics = readJson(METRICS_FILE, { targets: {} });
const estimateFor = (key) => {
  const m = (metrics.targets || {})[key] || {};
  const f = FALLBACK[key];
  return {
    installer: m.installer || m.portable || f.installer,
    unpacked: m.unpacked || Math.round((m.installer || f.installer) * UNPACKED_RATIO),
    measured: !!(m.installer || m.portable),
  };
};

/* ------------------------------------------------------------------ nishonlar */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pkg = readJson(path.join(ROOT, 'package.json'), {});
const ideCfg = readJson(path.join(ROOT, 'electron-builder.ide.json'), {});
const ideVersion = (ideCfg.extraMetadata || {}).version || '1.0.0';
const deskVersion = readJson(path.join(ROOT, 'admin-desk', 'package.json'), {}).version || '1.0.0';

const TARGETS = {
  app: {
    title: `YANG AI ${pkg.version}`,
    outDir: path.join(ROOT, 'dist'),
    unpackedDir: path.join(ROOT, 'dist', 'win-unpacked'),
    cmd: [NPM, 'run', 'dist'],
    artifacts: [`YANG-AI-Setup-${pkg.version}.exe`, `YANG-AI-Setup-${pkg.version}.exe.blockmap`, `YANG-AI-Portable-${pkg.version}.exe`, 'latest.yml'],
    verify: { cmd: 'node', args: ['ide/test_embedded_e2e.mjs'], env: { YANG_APP_EXE: path.join('dist', 'win-unpacked', 'YANG AI.exe') } },
  },
  ide: {
    title: `YANG IDE ${ideVersion}`,
    outDir: path.join(ROOT, 'dist-ide'),
    unpackedDir: path.join(ROOT, 'dist-ide', 'win-unpacked'),
    cmd: [NPM, 'run', 'dist:ide'],
    artifacts: [`YANG-IDE-Setup-${ideVersion}.exe`, `YANG-IDE-Setup-${ideVersion}.exe.blockmap`, `YANG-IDE-Portable-${ideVersion}.exe`],
    verify: { cmd: 'node', args: ['ide/test_ide_packaged.mjs'], env: {} },
  },
};

const selected = ONLY === 'all' ? ['app', 'ide'] : [ONLY === 'ai' ? 'app' : 'ide'];

// Relizga relizdan tashqari qo'shiladigan artefaktlar (asosiy ilova `publish_release.mjs` da).
function extraAssets() {
  const out = [];
  const ideDir = path.join(ROOT, 'dist-ide');
  for (const f of [`YANG-IDE-Setup-${ideVersion}.exe`, `YANG-IDE-Portable-${ideVersion}.exe`]) {
    const p = path.join(ideDir, f);
    if (fs.existsSync(p)) out.push(p);
  }
  const deskDir = path.join(ROOT, 'admin-desk', 'dist');
  for (const f of [`YANG Admin Desk ${deskVersion}.exe`, `YANG Admin Desk Setup ${deskVersion}.exe`]) {
    const p = path.join(deskDir, f);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

// Token manbai `publish_release.mjs` bilan bir xil: GH_TOKEN → admin-config.json → .gh-token.
function hasToken() {
  if (process.env.GH_TOKEN) return 'GH_TOKEN';
  const cfg = readJson(path.join(ROOT, 'admin-config.json'), null);
  if (cfg && cfg.ghToken) return 'admin-config.json';
  try {
    if (fs.readFileSync(path.join(ROOT, '.gh-token'), 'utf8').trim()) return '.gh-token';
  } catch { /* yo'q */ }
  return null;
}

/* ------------------------------------------------------------------ reja */
log('═'.repeat(72));
log(`QURISH + NASHR — ${new Date().toISOString()}`);
log(`nishonlar: ${selected.map((k) => TARGETS[k].title).join(', ')} · ${DRY ? 'DRY-RUN' : NO_PUBLISH ? 'qurish+sinov (nashrsiz)' : 'qurish+sinov+nashr'}${KILL_ORPHANS ? ' · yetimlar tozalanadi' : ''}${FORCE ? ' · --force' : ''}`);
log('═'.repeat(72));

/* ------------------------------------------------------------------ 1. oldindan tekshiruv */
log('\n1) Oldindan tekshiruv (commit, disk, token)');

if (KILL_ORPHANS) {
  const procs = llamaProcesses();
  if (procs.length) {
    log(`   • llama-server jarayonlari to'xtatiladi: ${procs.map((p) => `PID ${p.pid} (${(p.commitBytes / 1024 ** 3).toFixed(2)} GB)`).join(', ')}`);
    log("     Diqqat: bu OLLASI ham (Ollama yoki ochiq YANG AI ilovasining lokal modeli) — ochiq ilova bo'lsa model qayta yuklanadi.");
    if (!DRY) {
      try { execFileSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' }); } catch { /* allaqachon yo'q */ }
    }
  } else {
    log('   • llama-server topilmadi');
  }
}

const blockers = [];
const notes = [];

// 1a. Commit (NSIS mmap)
const commit = commitState();
const commitNeeds = [];
for (const key of selected) {
  const est = estimateFor(key);
  const payload = Math.max(0, est.installer - INSTALLER_STUB);
  const need = Math.ceil((payload + NSIS_MMAP_OVERHEAD) * COMMIT_MARGIN);
  commitNeeds.push({ key, est, payload, need });
}
const commitNeed = Math.max(...commitNeeds.map((c) => c.need));
if (commit) {
  log(`   • bo'sh commit: ${b(commit.free)} · kerak: ${b(commitNeed)} (eng katta nishon + ${Math.round((COMMIT_MARGIN - 1) * 100)}% zaxira)`);
  for (const c of commitNeeds) {
    log(`       - ${TARGETS[c.key].title}: payload ≈ ${b(c.payload)}${c.est.measured ? ' (o‘lchangan)' : ' (zaxira qiymat)'} → mmap kerak ≈ ${b(c.payload + NSIS_MMAP_OVERHEAD)}`);
  }
  if (commit.free < commitNeed) {
    const procs = llamaProcesses();
    const      detail = procs.length
      ? `hozir ${procs.length} ta llama-server ishlayapti (${procs.map((p) => `PID ${p.pid}: ${(p.commitBytes / 1024 ** 3).toFixed(2)} GB`).join(', ')}) — bular Ollama xizmati yoki ochiq turgan YANG AI ilovasidan bo‘lishi mumkin`
      : "llama-server topilmadi — commit'ni boshqa katta dasturlar (brauzer, virtual mashina) ushlab turgan bo‘lishi mumkin";
    blockers.push(
      `Bo'sh commit yetmaydi: ${b(commit.free)} bo'sh, ${b(commitNeed)} kerak.\n` +
      `      Sabab shu: makensis payload'ni mmap qiladi va "Internal compiler error #12345: error creating mmap the size of …" beradi.\n` +
      `      ${detail}.\n` +
      "      Yechim: kerakli dasturlarni yoping yoki `node scripts/build_and_release.mjs --kill-orphans` bilan yetim model-serverlarni tozalang.",
    );
  } else {
    notes.push(`commit zaxirasi: ${b(commit.free - commitNeed)}`);
  }
} else {
  notes.push("bo'sh commit o'lchanmadi (PowerShell yo'q yoki Windows emas) — bu tekshiruv o'tkazib yuborildi");
  log('   • bo‘sh commit: O‘LCHANMADI (PowerShell mavjud emas) — ogohlantirish');
}

// 1b. Disk (chiqish jildi + vaqtinchalik jild)
const tmp = os.tmpdir();
for (const key of commitNeeds) {
  const { est } = key;
  const need = Math.round(est.unpacked + 2 * est.installer + DISK_HEADROOM);
  const dir = TARGETS[key.key].outDir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
  const haveOut = freeDiskBytes(dir);
  const haveTmp = freeDiskBytes(tmp);
  const shown = `${b(haveOut.bytes)} / kerak ${b(need)} — ${haveOut.path}`;
  log(`   • disk (${TARGETS[key.key].title}): ${shown}`);
  log(`       vaqtinchalik jild ${haveTmp.path}: bo'sh ${b(haveTmp.bytes)} · kerak ${b(est.installer + DISK_HEADROOM)}`);
  if (haveOut.bytes !== null && haveOut.bytes < need) {
    blockers.push(`Disk yetmaydi (${haveOut.path}): ${b(haveOut.bytes)} bo'sh, ${b(need)} kerak (yoyilgan papka + 2 o'rnatuvchi + zaxira).`);
  }
  if (haveTmp.bytes !== null && haveTmp.bytes < est.installer + DISK_HEADROOM) {
    blockers.push(`Vaqtinchalik jildda joy yetmaydi (${haveTmp.path}): ${b(haveTmp.bytes)} bo'sh, ${b(est.installer + DISK_HEADROOM)} kerak.`);
  }
}

// 1c. Nashr tokeni
const tokenSrc = hasToken();
if (!NO_PUBLISH) {
  log(`   • GitHub tokeni: ${tokenSrc || 'TOPILMADI'}`);
  if (!tokenSrc) {
    blockers.push('Nashr uchun token yo‘q: GH_TOKEN muhit o‘zgaruvchisi, admin-config.json (ghToken) yoki .gh-token faylini bering (yoki --no-publish bilan quring).');
  }
} else {
  log('   • nashr o‘tkazib yuboriladi (--no-publish)');
}

// 1d. Reliz izohi (nashr bo'lsa)
if (!NO_PUBLISH) {
  const notesFile = path.join(ROOT, 'docs', `v${pkg.version}-chiqarish.md`);
  log(`   • reliz izohi: ${fs.existsSync(notesFile) ? `docs/v${pkg.version}-chiqarish.md (${fs.statSync(notesFile).size} belgi)` : `docs/v${pkg.version}-chiqarish.md TOPILMADI — zaxira matn ishlatiladi`}`);
}

if (blockers.length) {
  log('\n   ✗ TO‘XTATILDI — quyidagi shartlar bajarilmadi:');
  for (const x of blockers) log(`     - ${x}`);
  if (!FORCE) {
    log('\n   Bilib turib davom etish uchun: --force (ogohlantirishlar hisobga olinmaydi).');
    log('   Yetim model-serverlarni tozalash: --kill-orphans');
    try { fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8'); } catch { /* */ }
    process.exit(1);
  }
  log('\n   ⚠ --force: ogohlantirishlarga qaramay davom etiladi (build yiqilishi mumkin).');
} else {
  log('\n   ✓ Barcha tekshiruvlar o‘tdi.');
}
for (const n of notes) log(`   · ${n}`);

/* ------------------------------------------------------------------ 2. qurish */
const results = [];
for (const key of selected) {
  const t = TARGETS[key];
  if (DRY) {
    log(`\n2) [dry-run] ${t.title}: ${t.cmd.join(' ')} — qurilmaydi`);
    continue;
  }
  const t0 = Date.now();
  log(`\n2) Qurish: ${t.title}`);

  // Payload kuzatuvchisi: electron-builder `<output>/<nom>-x64.nsis.7z` ni yaratadi va makensis
  // AYNAN shu faylni xaritalaydi. Uning hajmini o'lchab, mmap talabini aniq hisoblaymiz va
  // shu lahzadagi bo'sh commit bilan solishtiramiz (keyingi yurishlar uchun o'lchov bo'ladi).
  let payloadSeen = 0;          // 7z ning eng katta ko'rilgan hajmi = haqiqiy payload
  let minFreeCommit = null;     // qurish davomida bo'sh commit eng pastga tushgan nuqta
  let ticks = 0;
  // 7z asta-sekin yoziladi, shuning uchun oraliq hajmlar chop etilmaydi (chalg'itadi):
  // haqiqiy payload va commit eng past nuqtasi qurish TUGAGACH bir marta xabar qilinadi.
  const watcher = setInterval(() => {
    let entries = [];
    try { entries = fs.readdirSync(t.outDir); } catch { return; }
    for (const f of entries) {
      if (!/\.nsis\.7z$/.test(f)) continue;
      try {
        const st = fs.statSync(path.join(t.outDir, f));
        if (st.mtimeMs < t0) continue; // oldingi yurishdan qolgan 7z hisobga olinmaydi
        if (st.size > payloadSeen) payloadSeen = st.size;
      } catch { /* fayl o'chib ketdi */ }
    }
    // Commit namunasi har ~6 s da (PowerShell qimmat, har 1,5 s da chaqirmaymiz).
    ticks += 1;
    if (payloadSeen && (ticks === 1 || ticks % 4 === 0)) {
      const cs = commitState();
      if (cs && (minFreeCommit === null || cs.free < minFreeCommit)) minFreeCommit = cs.free;
    }
  }, 1500);

  const code = await run(t.cmd[0], t.cmd.slice(1));
  clearInterval(watcher);
  if (payloadSeen) {
    const need = payloadSeen + NSIS_MMAP_OVERHEAD;
    log(`   · payload (o‘lchandi): ${b(payloadSeen)} → mmap kerak ≈ ${b(need)}`);
    if (minFreeCommit !== null) {
      const slack = minFreeCommit - need;
      log(`     qurish davomida bo‘sh commit eng kami: ${b(minFreeCommit)} → zaxira ${slack >= 0 ? '+' : '−'}${b(Math.abs(slack))}`);
      if (slack < 0) {
        log('     ⚠ OGOHLANTIRISH: bo‘sh commit mmap uchun yetmagan — makensis shu sabab bilan yiqilishi mumkin (yetimlarni --kill-orphans bilan tozalang).');
      }
    }
  }
  if (code !== 0) {
    log(`\n✗ ${t.title} qurilishi xato bilan tugadi (exit ${code}).`);
    log('   Agar sabab `Internal compiler error #12345: error creating mmap the size of …` bo‘lsa — bu commit yetishmovchiligi: --kill-orphans bilan yetim model-serverlarni tozalab, qayta urinib ko‘ring.');
  }
  if (code !== 0) {
    try { fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8'); } catch { /* */ }
    process.exit(code);
  }

  // Artefaktlar joyidami?
  const missing = t.artifacts.filter((f) => !fs.existsSync(path.join(t.outDir, f)));
  if (missing.length) fail(`${t.title}: artefaktlar topilmadi — ${missing.join(', ')}`);
  const installer = fs.statSync(path.join(t.outDir, t.artifacts[0])).size;
  const portable = t.artifacts[2] && fs.existsSync(path.join(t.outDir, t.artifacts[2])) ? fs.statSync(path.join(t.outDir, t.artifacts[2])).size : null;
  const unpacked = fs.existsSync(t.unpackedDir) ? dirSize(t.unpackedDir) : null;
  const durationMs = Date.now() - t0;
  log(`   ✓ ${t.title} tayyor: Setup ${b(installer)}${portable ? ` · Portable ${b(portable)}` : ''} · yoyilgan papka ${b(unpacked)} · ${(durationMs / 60000).toFixed(1)} daqiqa`);

  metrics.targets = metrics.targets || {};
  metrics.targets[key] = {
    installer,
    portable,
    payload: payloadSeen || Math.max(0, installer - INSTALLER_STUB),
    payloadMeasured: !!payloadSeen,
    unpacked,
    freeCommitBefore: commit ? commit.free : null,
    freeCommitMinDuringBuild: minFreeCommit,
    durationMs,
    builtAt: new Date().toISOString(),
  };
  results.push({ key, title: t.title, installer, portable, unpacked, durationMs, payload: metrics.targets[key].payload });

  // 3. Paket sinovi — nashrdan oldin (v5.4 paketi IDE'siz chiqib qolgan edi).
  if (!NO_VERIFY) {
    log(`\n3) Paket sinovi: ${t.verify.cmd} ${t.verify.args.join(' ')}`);
    const vcode = await run(t.verify.cmd, t.verify.args, { env: { ...process.env, ...t.verify.env } });
    if (vcode !== 0) fail(`${t.title}: paket sinovi yiqildi (exit ${vcode}) — nashr qilinmadi (log: ${LOG_FILE}).`);
    log(`   ✓ ${t.title} paket sinovi o‘tdi`);
  }
}

/* ------------------------------------------------------------------ 4. nashr */
if (DRY) {
  const extras = extraAssets();
  log('\n4) [dry-run] nashr qilinadigan artefaktlar:');
  for (const k of selected) {
    for (const f of TARGETS[k].artifacts) log(`   · ${path.relative(ROOT, path.join(TARGETS[k].outDir, f))}`);
  }
  for (const f of extras) log(`   · ${path.relative(ROOT, f)} (qo‘shimcha)`);
  log('\n   dry-run: hech narsa qurilmadi va nashr qilinmadi.');
} else if (NO_PUBLISH) {
  log('\n4) Nashr o‘tkazib yuborildi (--no-publish).');
} else {
  log('\n4) Nashr: scripts/publish_release.mjs');
  const extras = extraAssets();
  if (extras.length) log(`   qo‘shimcha assetlar: ${extras.map((f) => path.basename(f)).join(', ')}`);
  const pcode = await run(process.execPath, ['scripts/publish_release.mjs'], {
    env: { ...process.env, ...(extras.length ? { YANG_EXTRA_ASSETS: extras.join(',') } : {}) },
  });
  if (pcode !== 0) fail(`Nashr yiqildi (exit ${pcode}) — skript idempotent, qayta yuritish mumkin.`);
  log('   ✓ Nashr va sha256 tekshiruvi o‘tdi');
}

/* ------------------------------------------------------------------ 5. xulosa + o'lchov */
try {
  metrics.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
} catch (e) {
  log(`⚠ O'lchovlarni yozib bo'lmadi: ${e.message}`);
}

log('\n5) Xulosa');
log('   | nishon | Setup | Portable | yoyilgan | payload | daqiqa |');
log('   |---|---|---|---|---|---|');
for (const r of results) {
  log(`   | ${r.title} | ${b(r.installer)} | ${b(r.portable)} | ${b(r.unpacked)} | ${b(r.payload)} | ${(r.durationMs / 60000).toFixed(1)} |`);
}
const total = results.reduce((s, r) => s + (r.installer + (r.portable || 0)), 0);
if (total) log(`   jami nashr hajmi (Setup+Portable): ${b(total)}`);
log(`   reliz: https://github.com/${process.env.GH_OWNER || 'bekhvloger-beep'}/${process.env.GH_REPO || 'yang-ai'}/releases/tag/v${pkg.version}`);
log(`   o'lchovlar: ${path.relative(ROOT, METRICS_FILE)}`);

try { fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8'); } catch { /* */ }
log(`   log: ${path.relative(ROOT, LOG_FILE)}`);
