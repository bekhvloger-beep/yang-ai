// ide/test_local_ai_models.cjs — «Lokal AI menejeri» mantiqini sinaydi (Electron ichida).
//
// Nega Electron: `ide/ide_models.js` haqiqiy `app.getPath('userData')` va `ipcMain` bilan
// ishlaydi (yuklab olingan modellar `%APPDATA%/yang-ai/models` ga tushadi, chunki paketdagi
// `Program Files` yozib bo'lmaydi). Shu sababli sinov ham Electron ichida yuradi:
//
//   npx electron ide/test_local_ai_models.cjs
//
// Tekshiriladi: apparat profili haqiqiy qiymatlar bilan o'lchanadi; katalog to'liq va har bir
// yozuvda minimal talablar bor; moslik bahosi (blocked/ok) to'g'ri ishlaydi; ilova bilan kelgan
// model va o'rnatilgan rasm dvigateli "bor" deb topiladi; kompyuterdagi tashqi AI (Ollama,
// HuggingFace keshi) skanerlanadi; HAQIQIY yuklab olish oqim bilan boradi (progress), arxiv
// ochiladi, o'chiriladi; bekor qilish yarim faylni QOLDIRMAYDI.
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
// Windows'da dinamik ESM import FAQAT file:// URL bilan ishlaydi (`import('D:\\...')`
// ERR_UNSUPPORTED_ESM_URL_SCHEME beradi) — bu IDE yadrosida ham hisobga olingan.
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
// Foydalanuvchining haqiqiy sozlamalariga tegilmasin: vaqtinchalik userData.
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-models-ud-'));
app.setPath('userData', UD);

let failed = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IPC handler'larini ushlab qolamiz — sinov HAQIQIY kanallarni chaqiradi (send() ham haqiqiy).
const handlers = new Map();
const origHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => { handlers.set(channel, fn); return origHandle(channel, () => {}); };

const progressEvents = [];
// «O‘lchash» yurishi hodisalari (progress + natija) — 12-14 tekshiruvlar shundan o‘qiydi.
const benchEvents = [];

(async () => {
  await app.whenReady();
  const mod = await import(pathToFileURL(path.join(ROOT, 'ide', 'ide_models.js')).href);
  mod.registerModelsIpc({
    send: (channel, payload) => {
      if (channel === 'yide:model-progress') progressEvents.push(payload);
      if (channel === 'yide:model-bench') benchEvents.push(payload);
    },
    saveSharedModel: async (p, m) => ({ provider: p, model: m }),
    getWorkspace: () => '',
    safePath: () => null,
  });
  const call = (channel, args) => handlers.get(channel)(null, args);

  console.log(`userData: ${UD}`);
  console.log(`modellar papkasi: ${mod.userModelsDir()}\n`);

  /* 1) Apparat profili — haqiqiy qiymatlar */
  const hw = await mod.hardwareProfile({ refresh: true });
  const ramGb = os.totalmem() / 1024 ** 3;
  check('1. Apparat profili haqiqiy o‘lchanadi (RAM, yadro, disk, daraja)',
    Math.abs(hw.ramGb - ramGb) < 0.5 && hw.cores === os.cpus().length
    && Number.isFinite(hw.diskFreeGb) && hw.diskFreeGb > 0
    && hw.textLevel >= 1 && hw.textLevel <= 5 && hw.imageLevel >= 1 && hw.imageLevel <= 5,
    `RAM ${hw.ramGb}/${ramGb.toFixed(1)} GB · ${hw.cores} yadro · disk ${hw.diskFreeGb} GB · GPU "${hw.gpu}" ${hw.vramGb} GB · matn ${hw.textLevel}★ · rasm ${hw.imageLevel}★`);

  /* 2) Katalog ko'rinishi — har bir yozuvda talablar, kuch va holat */
  const cat = await call('yide:models-catalog');
  const ids = (cat.items || []).map((x) => x.id);
  const badItems = (cat.items || []).filter((x) => !x.min.ramGb || !x.min.diskGb || !x.name
    || !Number.isFinite(x.bytes) || x.stars < 1 || !x.verdict || !x.verdict.fit);
  check('2. Katalog ko‘rinishi: har bir modelda talablar, kuch yulduzi va moslik bahosi bor',
    !cat.error && cat.items.length >= 8 && badItems.length === 0 && new Set(ids).size === ids.length,
    `${cat.items.length} model · muammoli=${badItems.length} · ${cat.error || 'xato yo‘q'}`);

  /* 3) SHU kompyuter uchun baho: yengil model mos, imkonsiz model «ishlamaydi».
     Baho QOIDASI mashinaning bugungi holatiga bog'lanib qolmasligi kerak: shuning uchun
     yetarli resursli sinov profili beriladi (qoida «mos» deyishi shart) va alohida —
     haqiqiy apparatdagi baho o'sha qoidadan chiqqanini tekshiramiz. Mashinada joy
     yetmasa baho «ishlamaydi» bo'lib, sababini aynan yetmagan resurs aytishi shart. */
  const light = cat.items.find((x) => x.id === 'text-qwen25-0_5b-q4km');
  const heavy = cat.items.find((x) => x.id === 'text-qwen25-coder-7b-q4km');
  const impossible = mod.verdictOf({ id: 'x', kind: 'text', file: 'x.gguf', min: { ramGb: 128, diskGb: 1 }, recommend: { ramGb: 256 }, strength: { code: 5 } }, hw);
  const roomy = { ...hw, ramGb: 32, ramFreeGb: 24, diskFreeGb: 500, vramGb: 8, gpu: 'sinov-gpu' };
  const heavyRule = mod.verdictOf(heavy, roomy);
  const heavyReasons = String((heavy.verdict.reasons || []).join(' '));
  const diskShort = Number.isFinite(hw.diskFreeGb) && hw.diskFreeGb < (heavy.min.diskGb || 0) * 1.1;
  const ramShort = hw.ramGb < (heavy.min.ramGb || 0) * 0.9;
  const heavyReal = (diskShort || ramShort)
    ? heavy.verdict.state === 'blocked' && (diskShort ? /diskda/.test(heavyReasons) : /RAM/.test(heavyReasons))
    : heavy.verdict.state === 'ok';
  check('3. Moslik qoidasi: resurs yetarli bo‘lsa 7B «mos», yetmasa sababi bilan «ishlamaydi», 128 GB — yo‘q',
    !!(light && light.verdict.state === 'ok') && heavyRule.state === 'ok' && heavyReal
    && impossible.state === 'blocked' && mod.machineStars({ kind: 'text', strength: { code: 5 } }, impossible) === 0,
    `0.5B=${light && light.verdict.fit} · 7B(qoida)=${heavyRule.fit} · 7B(shu mashina)=${heavy.verdict.fit}`
    + ` [${diskShort ? `disk ${hw.diskFreeGb} GB < ${((heavy.min.diskGb || 0) * 1.1).toFixed(1)} GB` : ramShort ? `RAM ${hw.ramGb} GB qisqa` : 'joy yetarli'}]`
    + ` · 128GB=${impossible.fit} (${impossible.reasons[0]})`);

  /* 4) O'rnatilgan holat: ilova bilan kelgan model va rasm dvigateli topiladi */
  const sdx = await call('yide:image-status');
  const bundled = cat.items.find((x) => x.id === 'text-qwen35-2b-q4km');
  check('4. O‘rnatilgan model va rasm dvigateli holati aniqlanadi',
    !!(bundled && bundled.installed) && sdx.available,
    `ilova ichidagi 2B=${bundled && bundled.installed} · rasm dvigateli=${sdx.available} (${sdx.backend}) · ${sdx.model || sdx.reason}`);

  /* 5) Kompyuterda allaqachon o'rnatilgan AI skani */
  const ext = await call('yide:models-external');
  const hfFound = (ext.hf || []).length;
  const ollama = ext.ollama;
  check('5. Kompyuterdagi tashqi AI topiladi (Ollama va/yoki HuggingFace keshi)',
    (!!ollama && ollama.installed) || hfFound > 0,
    `Ollama=${ollama ? `${ollama.installed ? 'o‘rnatilgan' : 'yo‘q'}${ollama.running ? `, server ishlayapti, ${ollama.models.length} model` : ', server o‘chiq'}` : 'topilmadi'} · HF keshi=${hfFound} repo · ilova papkalari=${(ext.localDirs || []).length}`);

  /* 6) HAQIQIY yuklab olish: kichik dvigatel (17 MB) — progress, arxiv ochish, o'rnatish */
  progressEvents.length = 0;
  const dl = await call('yide:models-download', { id: 'runtime-sd-cpu' });
  const jobId = 'runtime-sd-cpu';
  let waited = 0;
  while (waited < 180000) {
    const view = progressEvents.filter((e) => e.id === jobId).slice(-1)[0];
    if (view && (view.state === 'done' || view.state === 'error' || view.state === 'canceled')) break;
    await sleep(500);
    waited += 500;
  }
  const finalJob = progressEvents.filter((e) => e.id === jobId).slice(-1)[0] || {};
  const extracted = path.join(mod.userModelsDir(), 'sd', 'cpu', process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli');
  const grew = progressEvents.filter((e) => e.state === 'downloading' && e.received > 0).length;
  check('6. Yuklab olish oqim bilan boradi, arxiv ochiladi va fayl paydo bo‘ladi',
    !!(dl && dl.ok) && finalJob.state === 'done' && grew >= 1 && fs.existsSync(extracted),
    `holat=${finalJob.state} · ${grew} progress hodisasi · ${Math.round((finalJob.received || 0) / 1048576)} MB · ${extracted.replace(UD, '<userData>')} mavjud=${fs.existsSync(extracted)}`);

  /* 7) O'rnatilganini o'chirish (savatga) — papka yo'qoladi */
  const rm = await call('yide:models-remove', { id: 'runtime-sd-cpu' });
  await sleep(400);
  check('7. O‘rnatilgan modelni o‘chirish ishlaydi (savatga yuboriladi)',
    !!(rm && rm.ok) && !fs.existsSync(path.join(mod.userModelsDir(), 'sd', 'cpu', process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli')),
    rm && rm.error ? rm.error : `o‘chirildi: ${String(rm.removed || '').replace(UD, '<userData>')}`);

  /* 8) Bekor qilish yarim faylni QOLDIRMAYDI (491 MB li model ustida) */
  progressEvents.length = 0;
  const started = await call('yide:models-download', { id: 'text-qwen25-0_5b-q4km' });
  await sleep(3000);
  const cancel = await call('yide:models-cancel', { id: 'text-qwen25-0_5b-q4km' });
  await sleep(1200);
  const parts = [];
  try {
    for (const f of await fsp.readdir(mod.userModelsDir())) if (f.includes('.part')) parts.push(f);
  } catch { /* papka yo‘q */ }
  const partial = path.join(mod.userModelsDir(), 'model-qwen2.5-0.5b-instruct-q4_k_m.gguf');
  const doneMid = progressEvents.some((e) => e.received > 0);
  check('8. Yuklab olishni bekor qilish ishlaydi va yarim fayl qolmaydi',
    !!(started && started.ok) && !!(cancel && cancel.ok) && parts.length === 0 && !fs.existsSync(partial),
    `yuklangan bayt ko‘rindi=${doneMid} · qolgan .part=${parts.length} · to‘liq fayl yo‘q=${!fs.existsSync(partial)}`);

  /* 9) Rasm generatsiyasi: lokal, API'siz — kichik o'lchamda HAQIQIY tekshiriladi */
  const t0 = Date.now();
  const img = await call('yide:image-generate', { prompt: 'a green leaf on white background', size: '256x256', steps: 6, seed: 5 });
  const magic = img && img.dataUrl ? Buffer.from(String(img.dataUrl).split(',')[1], 'base64').subarray(0, 4).toString('hex') : '';
  check('9. Lokal rasm generatsiyasi ishlaydi (API va internetsiz, stable-diffusion.cpp)',
    !!(img && img.ok) && magic === '89504e47' && /Lokal/.test(img.via || ''),
    img && img.error ? img.error : `${img.seconds}s · ${img.via} · ${img.width}×${img.height} · magic=${magic}`);

  /* 10) Rasmni to'xtatish yo'li ham mavjud */
  const noStop = await call('yide:image-stop');
  check('10. Rasm yaratilmayotganda «To‘xtatish» xato bermaydi (holat xabar beriladi)',
    !!(noStop && noStop.ok === false && /yaratilmayapti/.test(noStop.note || '')), noStop && noStop.note);

  /* 12-14) «O‘lchash»: IPC → bola jarayon → hisobot → measured.json → katalog yangilanishi.
     Haqiqiy sinov 4 vazifa bilan ~5 daqiqa yuradi; bu yerda ZANJIR tekshiriladi — sinov
     skripti `YANG_IDE_BENCH_SCRIPT` bilan almashtiriladi va u xuddi shu formatda hisobot
     yozadi (4/4, o‘rtacha 50 s). Skriptning o‘zi alohida o‘lchandi va ishlaydi. */
  const fakeScript = path.join(UD, 'fake_bench.mjs');
  fs.writeFileSync(fakeScript, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'const out = process.env.YANG_IDE_BENCH_OUT;',
    "const model = String(process.env.YANG_IDE_BENCH_MODELS || '').replace(/^local:/, '');",
    "console.log('  server: 9.9s da tayyor (-c 8192)');",
    'await new Promise((r) => setTimeout(r, 2500));',
    "console.log('  PASS factorial   ide-loop  20s · qadam=1');",
    'fs.mkdirSync(out, { recursive: true });',
    "fs.writeFileSync(path.join(out, 'bench_raw.json'), JSON.stringify({ summary: { models: { ['local:' + model]: { ideLoop: { pass: 4, total: 4, avgSeconds: 50 }, oneShot: { pass: 2, total: 4 } } } } }, null, 2));",
  ].join('\n'), 'utf8');
  process.env.YANG_IDE_BENCH_SCRIPT = fakeScript;
  benchEvents.length = 0;
  const target = cat.items.find((x) => x.id === 'text-qwen35-2b-q4km');
  const bench = await call('yide:models-measure', { id: target.id });
  const busy = await call('yide:models-measure', { id: target.id });
  const sawRunning = benchEvents.some((e) => e.running === true && e.name);
  let done = null;
  for (let i = 0; i < 80 && !done; i += 1) {
    await sleep(500);
    done = benchEvents.map((e) => e.done).filter(Boolean).slice(-1)[0] || null;
  }
  delete process.env.YANG_IDE_BENCH_SCRIPT;
  check('12. «O‘lchash» yurishi boshlanadi, holat xabarlari keladi, ikkinchi urinish bloklanadi',
    !!(bench && bench.ok) && sawRunning && /allaqachon/.test(String((busy && busy.error) || ''))
    && !!(done && done.ok),
    `boshlandi=${!!(bench && bench.ok)} · holat hodisalari=${benchEvents.filter((e) => e.running).length} · ` +
    `ikkinchi urinish: "${(busy && busy.error) || ''}" · natija=${done ? (done.ok ? 'ok' : done.error) : 'kelmadi'}`);

  // Kalit — model FAYLI nomi (gguf). IPC ko‘rinishida `file` yuborilmaydi, shuning uchun
  // yozuvni nom bo‘yicha izlaymiz (ilova ichidagi 2B fayli shu nomda keladi).
  const storeFile = path.join(UD, 'models', 'measured.json');
  const store = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile, 'utf8')) : {};
  const savedKey = Object.keys(store).find((k) => /\.gguf$/.test(k) && /qwen3\.5-2b/.test(k)) || '';
  const saved = store[savedKey] || null;
  // 4/4 · 50 s · one-shot 2 → 40 + min(3, 60/50) + 0,2 = 41,4 (formula agent/bench_score.js da)
  check('13. O‘lchangan natija `measured.json` ga saqlanadi (ball FORMULA bo‘yicha)',
    !!saved && saved.idePass === 4 && saved.tasks === 4 && saved.score === 41.4
    && /shu kompyuterda/.test(saved.source || ''),
    saved ? `${saved.idePass}/${saved.tasks} · one-shot ${saved.oneShot} · ${saved.avgSeconds}s · ball ${saved.score} · ${savedKey} · ${path.basename(storeFile)}` : 'fayl yozilmadi yoki yozuv topilmadi');

  const cat2 = await call('yide:models-catalog');
  const updated = (cat2.items || []).find((x) => x.id === target.id) || {};
  check('14. Kuch reytingi O‘LCHANGAN ball bilan yangilanadi (yulduz, level va izoh)',
    !!(updated.measured && updated.measured.score === 41.4) && updated.stars === 4 && updated.level === 4
    && (updated.verdict.reasons || []).some((r) => /o‘lchandi/.test(r)),
    `★${updated.stars} (level ${updated.level}) · ball ${updated.measured && updated.measured.score} · ${(updated.verdict.reasons || [])[0] || ''}`);

  mod.disposeModels();
  const disposed = await call('yide:models-cancel', { id: 'text-qwen25-0_5b-q4km' });
  check('11. disposeModels() tozalaydi (bekor qilingan ish topilmaydi)', !!(disposed && disposed.error), disposed && disposed.error);

  console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  app.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('SINOV XATOSI:', e && e.stack || e);
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  app.exit(1);
});
