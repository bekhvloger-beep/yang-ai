// YANG IDE kontrakt testi — renderer, preload va main uch bayonoti bir-biriga mos keladimi.
//
// Nima uchun kerak: IDE qobig'i (index.html/style.css), mantiq (renderer/app.js) va
// ko'prik (preload.cjs + main.js) alohida bo'laklarda yoziladi. Ular kelishib olgan
// nomlardan biri adashsa, dastur ishga tushganda jimgina buziladi: yo'q id'ga
// addEventListener, yo'q IPC kanaliga invoke, yoki satr raqamlari bilan kod bir-biriga
// surilib ketadi. Bu test o'sha uch sinfni haqiqiy fayllardan o'qib tekshiradi.
//
// Ishga tushirish: node ide/test_ide_contract.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');

const html = read('renderer/index.html');
const appSrc = read('renderer/app.js');
const cssSrc = read('renderer/style.css');
const preloadSrc = read('preload.cjs');
// IDE mantiqi ikki faylda: `main.js` (mustaqil hayot aylanishi) + `ide_host.js` (yadro,
// YANG AI ham ishlatadi). Kanal nomlari `${CH}:…` shablonida yoziladi — test uchun
// ularni haqiqiy matnga aylantiramiz, aks holda tekshiruv bo'sh o'tib ketardi.
// IDE mantiqi endi bir necha modulda (yadro + PTY + til xizmati + debugger + yurish/tarix).
// Test ularning HAMMASINI o'qiydi, aks holda yangi kanallar "handlersiz" ko'rinadi.
const MAIN_MODULES = ['main.js', 'ide_host.js', 'ide_pty.js', 'ide_lsp.js', 'ide_debug.js', 'ide_runner.js', 'ide_models.js', 'ide_git.js', 'ide_voice.js'];
const mainSrc = MAIN_MODULES
  .filter((f) => fs.existsSync(path.join(HERE, f)))
  .map((f) => read(f))
  .join('\n')
  .replace(/\$\{CH\}/g, 'yide')
  .replace(/`/g, "'");
const appMainSrc = read(path.join('..', 'main.js'));
const appPreloadSrc = read(path.join('..', 'preload.cjs'));
const pkg = JSON.parse(read(path.join('..', 'package.json')));

let failed = 0;
let total = 0;
function check(label, cond, detail = '') {
  total += 1;
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
const unique = (list) => [...new Set(list)];
const matchAll = (src, re) => unique([...src.matchAll(re)].map((m) => m[1]));

console.log('YANG IDE kontrakt testi');

/* 1) DOM id'lari — renderer ishlatgan har bir id index.html'da bor bo'lishi kerak. */
// app.js o'zi yasaydigan ikki element (test ruxsat ro'yxati).
const RUNTIME_IDS = ['gutterLines', 'findCount'];
const htmlIds = new Set(matchAll(html, /\bid="([^"]+)"/g));
const usedIds = unique([
  ...matchAll(appSrc, /\$\(\s*['"]([A-Za-z][\w-]*)['"]\s*\)/g), // $( 'id' )
  ...matchAll(appSrc, /\bon\(\s*'([A-Za-z][\w-]*)'\s*,\s*'/g),  // on('id', 'event', ...)
]);
const missingIds = usedIds.filter((id) => !htmlIds.has(id) && !RUNTIME_IDS.includes(id));
check(`DOM: ${usedIds.length} id ishlatilgan, hammasi index.html'da bor`, missingIds.length === 0, `yo'q: ${missingIds.join(', ')}`);

/* 2) Preload yuzasi — window.ide.<nom> preload'da mavjud bo'lishi kerak. */
const bridgeBlock = preloadSrc.slice(preloadSrc.indexOf("exposeInMainWorld('ide'"), preloadSrc.lastIndexOf('});'));
const preloadKeys = new Set(matchAll(bridgeBlock, /([A-Za-z_$][\w$]*)\s*:\s*(?:\(|on\(|ipcRenderer)/g));
const usedBridge = unique(matchAll(appSrc, /window\.ide\.([A-Za-z_$][\w$]*)/g));
const missingBridge = usedBridge.filter((name) => !preloadKeys.has(name));
check(`Ko'prik: ${usedBridge.length} window.ide.* chaqiruv, hammasi preload'da bor`, missingBridge.length === 0, `yo'q: ${missingBridge.join(', ')}`);

/* 3) IPC kanallari — preload chaqirgan kanal main'da handler bo'lishi kerak. */
const invoked = unique(matchAll(preloadSrc, /ipcRenderer\.invoke\(\s*'([^']+)'/g));
const handled = unique(matchAll(mainSrc, /ipcMain\.handle\(\s*'([^']+)'/g));
const noHandler = invoked.filter((ch) => !handled.includes(ch));
check(`IPC invoke: ${invoked.length} kanal, hammasiga main'da handler bor`, noHandler.length === 0, `handlersiz: ${noHandler.join(', ')}`);
const orphanHandlers = handled.filter((ch) => !invoked.includes(ch));
if (orphanHandlers.length) console.log(`  WARN  main'da preload chaqirmaydigan handler: ${orphanHandlers.join(', ')}`);

// main -> renderer hodisalari: yuborilgan kanal preload'da tinglanadi.
const sent = unique(matchAll(mainSrc, /\bsend\(\s*'([^']+)'/g));
const listened = new Set(matchAll(preloadSrc, /\bon\(\s*'(yide:[^']+)'/g));
const unheard = sent.filter((ch) => !listened.has(ch));
check(`IPC hodisa: ${sent.length} kanal yuboriladi, hammasi preload'da tinglanadi`, unheard.length === 0, `tinglanmaydi: ${unheard.join(', ')}`);

/* 4) Geometriya — muharrir matematikasi (app.js) va CSS bir xil bo'lishi kerak.
      Mos kelmasa kursor bir joyda, bo'yalgan matn boshqa joyda turadi. */
const lineHMatch = appSrc.match(/const LINE_H\s*=\s*([\d.]+)\s*\*\s*([\d.]+)/);
const lineH = lineHMatch ? Number(lineHMatch[1]) * Number(lineHMatch[2]) : NaN;
const topPad = Number((appSrc.match(/const TOP_PAD\s*=\s*(\d+)/) || [])[1]);
const cssVar = (name) => (cssSrc.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();
const rule = (selector) => {
  const re = new RegExp(`${selector.replace(/[.#*+?^$()|[\]{}\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  return (cssSrc.match(re) || [])[1] || '';
};

const editorRule = rule('.editor-hl, #editorArea');
const gutterRule = rule('#gutter');
const lhRaw = cssVar('lh');
const lhPx = lhRaw ? (lhRaw.endsWith('px') ? parseFloat(lhRaw) : 13 * parseFloat(lhRaw)) : NaN;

check('CSS: .editor-hl/#editorArea qoidasi topildi', editorRule.length > 0);
check('CSS: #gutter qoidasi topildi', gutterRule.length > 0);
check(`Satr balandligi mos: CSS ${lhPx}px = app.js ${lineH}px`, Number.isFinite(lhPx) && Math.abs(lhPx - lineH) < 0.01, `hl=${lhRaw} vs LINE_H=${lineH}`);
const padTop = parseFloat((editorRule.match(/padding:\s*(\d+)px/) || [])[1]);
check(`Yuqori padding mos: CSS ${padTop}px = app.js ${topPad}px`, padTop === topPad, `padding: ${(editorRule.match(/padding:[^;]*/) || [''])[0]}`);
check('Gutter kengligi va muharrir chap surilishi bir o\'zgaruvchidan', /left:\s*var\(--gutter-w\)/.test(editorRule) && /width:\s*var\(--gutter-w\)/.test(gutterRule), 'ikkalasi ham var(--gutter-w) bo\'lishi kerak');
check('Shrift o\'lchami CSS va app.js\'da bir xil (13px)', /font:\s*13px/.test(editorRule) && /=\s*13\s*\*/.test(appSrc));

/* 5) Renderer o'z layout CSS'ini kiritmasligi kerak — uslub bitta manbada (style.css). */
check('app.js o\'zi <style> kiritmaydi', !/createElement\(\s*'style'\s*\)/.test(appSrc));

/* 6) YANG AI integratsiyasi — IDE asosiy ilova o'rnatuvchisi ICHIDA keladi.
      Bu blok "exe ichida IDE" shartini ushlab turadi: paketga `ide/**` qo'shilgan,
      asosiy main.js yadroni yuklaydi va kanal prefiksi to'qnashmaydi. */
const CHANNEL_COLLISION = ['ide:read-file', 'ide:save-file', 'ide:run-command', 'ide:list-tree', 'ide:open-external'];
check('asosiy main.js IDE yadrosini yuklaydi (./ide/ide_host.js)',
  /from\s+'\.\/ide\/ide_host\.js'/.test(appMainSrc));
check('asosiy main.js `ide:open-window` kanalini ro\'yxatga oladi',
  /ipcMain\.handle\(\s*'ide:open-window'/.test(appMainSrc));
check('asosiy preload.cjs `openIde` ko\'prigini beradi',
  /openIde\s*:\s*\(/.test(appPreloadSrc));
const buildFiles = (pkg.build && pkg.build.files) || [];
check('package.json: `ide/**/*` paketga kiritilgan',
  buildFiles.some((f) => String(f).startsWith('ide/')));
check('package.json: IDE test fayllari paketdan chiqarilgan',
  buildFiles.some((f) => String(f).includes('!ide/')));
const ideHandlers = handled; // yadro handler'lari (prefiks allaqachon haqiqiy matn)
const clash = ideHandlers.filter((ch) => CHANNEL_COLLISION.includes(ch));
check(`Kanal to'qnashuvi yo'q: yadro ${CHANNEL_COLLISION.length} ta ilova kanalini egallamaydi`,
  clash.length === 0, clash.join(', '));
check('Yadro kanallari `yide:` prefiksida',
  ideHandlers.every((ch) => ch.startsWith('yide:')) && ideHandlers.length >= 20, `${ideHandlers.length} kanal`);

/* 7) TO'LIQ BIRLASHTIRISH — YANG AI ilovasi IDE ni o'zi bilan birga olib keladimi?
      IDE endi alohida exe emas: asosiy ilova (YANG AI) ichida `ide/ide_host.js` orqali
      ochiladi. Bu guruh aynan shu "birlashtirish" shartnomasini qo'riqlaydi — aks holda
      paketga `ide/` qo'shilmagan yoki tugma IPC'ga ulanmagan bo'lsa, foydalanuvchi IDE ni
      umuman topa olmaydi (aynan shu holat bo'lgan edi). */
const readUp = (rel) => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');
const appMain = readUp('main.js');
const appPreload = readUp('preload.cjs');
const appHtml = readUp('renderer/index.html');
const appJs = readUp('renderer/app.js');
const hostSrc = read('ide_host.js');

check('ide_host.js: openIdeWindow/registerIdeIpc/disposeIde eksport qilinadi',
  /export async function openIdeWindow/.test(hostSrc) && /export function registerIdeIpc/.test(hostSrc) && /export function disposeIde/.test(hostSrc));
check('ide_host.js: IPC kanallari yide:* prefiksida (ilovaning ide:* kanallari bilan to‘qnashmaydi)',
  /const CH = 'yide'/.test(hostSrc) && !/ipcMain\.handle\(\s*'ide:/.test(hostSrc));

check('YANG AI main.js: IDE yadrosi import qilinadi',
  /from '\.\/ide\/ide_host\.js'/.test(appMain));
check('YANG AI main.js: registerIdeIpc() chaqiriladi (IDE o‘sha jarayonda ishlaydi)',
  /registerIdeIpc\(\)/.test(appMain));
check('YANG AI main.js: IDE oynasi ochiladi + menyu yozuvi bor',
  /openIdeWindow\(/.test(appMain) && /Menu\.setApplicationMenu/.test(appMain) && /YANG IDE oynasi/.test(appMain));
check('YANG AI main.js: chiqishda disposeIde() (kuzatuvchi/terminal to‘xtaydi)',
  /before-quit'\s*,\s*\(\)\s*=>\s*disposeIde\(\)/.test(appMain));
check('YANG AI main.js: ish papkasi haqiqiy manbadan olinadi (yo‘q `chats` Map yo‘q)',
  /async function activeWorkspace\(\)/.test(appMain) && !/chats\.get\(/.test(appMain));

check('YANG AI preload.cjs: openIde -> ide:open-window',
  /openIde:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('ide:open-window'\)/.test(appPreload));
check('YANG AI main.js: ide:open-window handler ro‘yxatga olingan',
  /ipcMain\.handle\('ide:open-window'/.test(appMain));
check('YANG AI renderer: «YANG IDE» tugmasi bor va ulangan',
  /id="openIdeBtn"/.test(appHtml) && appJs.includes('openIdeBtn') && /window\.api\.openIde\(\)/.test(appJs));
check('YANG AI package.json: `ide/**` o‘rnatuvchi tarkibida (versiya 5.3.0+)',
  (pkg.build?.files || []).includes('ide/**/*') && (pkg.build?.files || []).includes('!ide/test_*')
  && Number(String(pkg.version).split('.')[0] + '.' + String(pkg.version).split('.')[1]) >= 5.3,
  `files=${JSON.stringify(pkg.build?.files)} version=${pkg.version}`);

/* 8) "CHEKLOVSIZ" QATLAMI — haqiqiy terminal, til xizmati, debugger, tarix va chegarasiz tahrir.
      Bu guruh ilgari hisobotda "cheklov" deb yozilgan narsalar HAQIQATAN tuzatilganini
      ushlab turadi: aks holda funksiya jimgina yo'qolib, hisobot yolg'on bo'lib qolardi. */
const vendorDir = path.join(HERE, 'vendor');
check('Haqiqiy terminal: xterm.js vendor qilingan (ide/vendor/xterm.js)',
  fs.existsSync(path.join(vendorDir, 'xterm.js')) && fs.existsSync(path.join(vendorDir, 'xterm.css')));
check('Terminal moduli PTY (node-pty) ni ixtiyoriy yuklaydi va fallback beradi',
  /@homebridge\/node-pty-prebuilt-multiarch/.test(mainSrc) && /available: false/.test(mainSrc));
check('Terminal IPC to‘plami to‘liq: open/write/resize/close + data/exit hodisalari',
  ['yide:pty-info', 'yide:pty-open', 'yide:pty-write', 'yide:pty-resize', 'yide:pty-close'].every((c) => handled.includes(c))
  && ['yide:pty-data', 'yide:pty-exit'].every((c) => listened.has(c)),
  `handled=${handled.filter((h) => h.includes('pty')).join(',')}`);
check('Renderer xterm mount qiladi va PTY oqimini ulaydi',
  /new window\.Terminal\(/.test(appSrc) && /onPtyData/.test(appSrc) && /ptyWrite\(/.test(appSrc) && /ptyResize\(/.test(appSrc));

check('Til xizmati: tsserver (typescript) ishlatiladi — semantik xato uchun',
  /tsserver\.js/.test(mainSrc) && (pkg.dependencies || {}).typescript
  && Number(String((pkg.dependencies || {}).typescript).charAt(0)) >= 5,
  `typescript=${(pkg.dependencies || {}).typescript}`);
check('Til xizmati IPC: status/diagnostics/definition/references/hover',
  ['yide:lsp-status', 'yide:lsp-diagnostics', 'yide:lsp-definition', 'yide:lsp-references', 'yide:lsp-hover'].every((c) => handled.includes(c)));
check('F12 haqiqiy ta’rifga o‘tadi, Shift+F12 barcha havolalarni qidiradi',
  /lspDefinition/.test(appSrc) && /findReferences/.test(appSrc) && /e\.shiftKey\) findReferences/.test(appSrc));
check('Hover (tur/imzo) ko‘rsatiladi', /lspHover/.test(appSrc) && /hoverTip/.test(html));

check('Debugger: CDP orqali nuqtalar, qadam, stack va o‘zgaruvchilar',
  ['yide:debug-start', 'yide:debug-breakpoints', 'yide:debug-resume', 'yide:debug-step', 'yide:debug-stop'].every((c) => handled.includes(c))
  && /--inspect-brk/.test(mainSrc) && /ELECTRON_RUN_AS_NODE/.test(mainSrc));
check('Debugger UI: nuqta qatlami, panel va boshqaruv tugmalari mavjud',
  /breakGutter/.test(html) && /dbgStack/.test(html) && /dbgVars/.test(html) && /break-dot/.test(cssSrc)
  && /onDebugPaused/.test(appSrc) && /'yide:debug-paused'/.test(preloadSrc) && /toggleBreak/.test(appSrc));

check('TARIX (log): har yurish buyruq/kod/chiqish bilan saqlanadi',
  ['yide:run-log', 'yide:run-logged', 'yide:run-finished'].every((c) => handled.includes(c) || listened.has(c))
  && /TAIL_CHARS/.test(mainSrc) && /hist-row/.test(cssSrc));
check('AI tuzatish halqasi: ishga tushirib, xato bo‘lsa log bilan qayta tuzatadi',
  ['yide:fix-run', 'yide:fix-stop', 'yide:fix-busy'].every((c) => handled.includes(c))
  && /buildPrompt/.test(mainSrc) && /OLDINGI|oldingi/i.test(mainSrc) && /fix-event/.test(mainSrc)
  && /runFixLoop/.test(appSrc));
// O‘lchov: fayl matni berilmaganda lokal model bir xil buyruqni qayta-qayta chaqirib
// 15 daqiqa behuda ketgan edi. Endi fayl matni promptga qo‘shiladi va qadamlar cheklanadi.
check('Tuzatish halqasi fayl matnini o‘zi beradi va AI qadamlarini cheklaydi',
  /inlineFile\(/.test(mainSrc) && /FILE_INLINE_MAX/.test(mainSrc)
  && /maxSteps: AI_STEPS_PER_FIX/.test(mainSrc) && /maxSteps: steps/.test(mainSrc),
  'ide_runner.js: inlineFile + AI_STEPS_PER_FIX; ide_host.js: maxSteps: steps');
check('Tahrir chegarasi olib tashlandi (2 MB yo‘q, faqat 512 MB xotira himoyasi)',
  !/MAX_EDIT_BYTES/.test(mainSrc) && /HARD_FILE_CEILING/.test(mainSrc) && !/2 MB dan oshdi/.test(mainSrc),
  'ide_host.js da MAX_EDIT_BYTES qolmasligi kerak');
check('Katta fayl rejimi: qator raqamlari oynalanadi, sintaksis bo‘yash o‘chadi (qotmaslik uchun)',
  /paintGutter/.test(appSrc) && /HIGHLIGHT_MAX/.test(appSrc) && /bigNote/.test(html));

/* 9) LOKAL AI MENEJERI — apparat talablari, kuch reytingi va yuklab olish.
      Bu guruh "foydalanuvchi modelni tanlay oladimi" shartini ushlab turadi: katalog
      fayli mavjud, katalogdagi har bir yozuvda minimal talablar va kuch bor, apparat
      profili haqiqiy qiymatlardan o‘lchanadi, yuklab olish esa qamoq ichidagi
      `%APPDATA%/yang-ai/models` ga yozadi (Program Files yozib bo‘lmaydi). */
const catalogPath = path.join(HERE, '..', 'local-ai', 'catalog.json');
check('Lokal AI katalogi mavjud (local-ai/catalog.json)', fs.existsSync(catalogPath));
let cat = null;
if (fs.existsSync(catalogPath)) { try { cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); } catch { cat = null; } }
check('Katalog JSON sifatida o‘qiladi va ichida `items` massivi bor', !!(cat && Array.isArray(cat.items) && cat.items.length >= 5),
  cat ? `${(cat.items || []).length} yozuv` : 'o‘qilmadi');
if (cat && Array.isArray(cat.items)) {
  const bad = [];
  for (const it of cat.items) {
    const miss = ['id', 'kind', 'name', 'file', 'backend', 'min'].filter((k) => it[k] === undefined || it[k] === '');
    if (miss.length) bad.push(`${it.id || '?'}: ${miss.join('/')}`);
    if (!it.min || !it.min.ramGb || !it.min.diskGb) bad.push(`${it.id}: min.ramGb/min.diskGb yo‘q`);
    if (it.kind !== 'text' && typeof it.strength !== 'object') bad.push(`${it.id}: strength yo‘q`);
    if (!it.bundled && !it.url) bad.push(`${it.id}: url yo‘q (yuklab olish mumkin emas)`);
    if (it.url && !/^https:\/\//.test(it.url)) bad.push(`${it.id}: url http(s) emas`);
  }
  const ids = cat.items.map((x) => x.id);
  if (unique(ids).length !== ids.length) bad.push('takrorlanuvchi id bor');
  check(`Katalogda ${cat.items.length} yozuv: har birida talablar, kuch va yuklab olish manbasi`, bad.length === 0, bad.slice(0, 4).join(' | '));
  const kinds = unique(cat.items.map((x) => x.kind));
  check('Katalogda matn, rasm va rasm dvigateli turkumlari bor',
    kinds.includes('text') && kinds.includes('image') && kinds.includes('runtime'), kinds.join(','));
  const measured = cat.items.filter((x) => x.measured && typeof x.measured.idePass === 'number');
  check('Kuch reytingi O‘LCHOVGA tayanadi (kamida 2 modelda measured.idePass bor)', measured.length >= 2, `${measured.length} model`);
}
const modelsSrc = fs.existsSync(path.join(HERE, 'ide_models.js')) ? read('ide_models.js') : '';
check('ide_models.js: apparat profili, moslik bahosi va tashqi AI skani mavjud',
  /export async function hardwareProfile/.test(modelsSrc) && /function verdictFor/.test(modelsSrc)
  && /export async function externalScan/.test(modelsSrc) && /export function machineStars/.test(modelsSrc));
check('Yuklab olish: oqim (progress), bekor qilish va hajm tekshiruvi bor',
  /function startDownload/.test(modelsSrc) && /model-progress/.test(modelsSrc)
  && /controller\.abort/.test(modelsSrc) && /hajm mos emas/.test(modelsSrc));
check('Modellar yozsa bo‘ladigan papkaga tushadi (userData/models), ilova nusxasi saqlanadi',
  /app\.getPath\('userData'\), 'models'/.test(modelsSrc) && /export function modelDirs/.test(modelsSrc)
  && /resourcesPath, 'local-ai'/.test(modelsSrc));
check('Lokal rasm generatsiyasi API EMAS (stable-diffusion.cpp) va IDE ga ulangan',
  fs.existsSync(path.join(HERE, '..', 'agent', 'local_sd.js'))
  && /sd-cli\.exe/.test(fs.readFileSync(path.join(HERE, '..', 'agent', 'local_sd.js'), 'utf8'))
  && /\$\{CH\}:image-generate/.test(modelsSrc) && /imageGenerate/.test(appSrc) && /imgPrompt/.test(html));
check('«Lokal AI» menyusi UI da bor (tugma + modal + progress hodisasi)',
  /id="aiModelsBtn"/.test(html) && /id="modelsModal"/.test(html) && /id="hwProfile"/.test(html)
  && /aiModelsBtn/.test(appSrc) && /modelsCatalog/.test(preloadSrc) && /onModelProgress/.test(preloadSrc)
  && /\.mdl-bar-fill/.test(cssSrc));
// «O‘lchash»: yuklangan model 4 haqiqiy vazifa bilan sinab, kuch reytingi O‘LCHANGAN ball
// bilan yangilanadi. Uch qatlam bir xil nomda bo‘lishi shart: tugma (renderer) → kanal
// (preload) → ishlovchi (main, `ide_models.js`) va yozib qo‘yish joyi (measured.json).
check('«O‘lchash» tugmasi: haqiqiy 4 vazifa bilan ball yangilanadi (tugma → kanal → ishlovchi)',
  /data-act="measure"/.test(appSrc) && /modelsMeasure/.test(preloadSrc) && /onModelBench/.test(preloadSrc)
  && /models-measure/.test(mainSrc) && /function measureModel/.test(modelsSrc)
  && /bench_ide_assisted\.mjs/.test(modelsSrc) && /measured\.json/.test(modelsSrc)
  && /applyMeasuredResults/.test(modelsSrc) && /function finishMeasure/.test(modelsSrc));
check('Ball va yulduz formulasi YAGONA joyda (agent/bench_score.js) — hisobot ham shundan oladi',
  fs.existsSync(path.join(HERE, '..', 'agent', 'bench_score.js'))
  && /export function benchScore/.test(fs.readFileSync(path.join(HERE, '..', 'agent', 'bench_score.js'), 'utf8'))
  && /benchScore/.test(fs.readFileSync(path.join(HERE, '..', 'scripts', 'report_local_ai.mjs'), 'utf8'))
  && /benchStars/.test(modelsSrc));
check('Sinov skripti paketga kiradi va asar ichidan chiqariladi (node bola jarayon)',
  (() => { const b = JSON.parse(read(path.join('..', 'electron-builder.ide.json')));
    return (b.asarUnpack || []).some((p) => /bench_ide_assisted/.test(p))
      && (b.files || []).some((p) => /bench_ide_assisted/.test(p))
      && (b.files || []).some((p) => /bench_score\.js/.test(p)); })());
// Git paneli: tugma → kanal (preload) → ishlovchi (ide_git.js + ide_host.js) zanjiri.
check('Git paneli: status/farq/belgilash/commit bir zanjirda (tugma → kanal → `git` CLI)',
  /id="gitBtn"/.test(html) && /id="gitModal"/.test(html) && /id="gitCommit"/.test(html)
  && /gitStatus/.test(preloadSrc) && /gitCommit/.test(preloadSrc) && /gitDiff/.test(preloadSrc)
  && /registerGitIpc/.test(mainSrc) && /yide:git-commit/.test(mainSrc)
  && fs.existsSync(path.join(HERE, 'ide_git.js'))
  && /gitCommit/.test(appSrc));
check('Git paneli: o‘zgargan fayllar, belgilash va diff ko‘rsatiladi',
  /gitFiles/.test(html) && /gitDiff/.test(html) && /gitLog/.test(html)
  && /data-act="\$\{act\}"|"stage"|"unstage"/.test(appSrc) && /\.git-row/.test(cssSrc));
// Lokal ovozli buyruqlar: mikrofon → rubaistt (whisper.cpp) → FAQAT allowlist buyruq.
check('Ovozli buyruq: mikrofon tugmasi → transkripsiya → allowlist buyruq',
  /id="voiceBtn"/.test(html) && /id="voiceBar"/.test(html) && /id="voiceText"/.test(html)
  && /voiceTranscribe/.test(preloadSrc) && /voiceCommand/.test(preloadSrc)
  && /yide:voice-transcribe/.test(mainSrc) && /registerVoiceIpc/.test(mainSrc)
  && /getUserMedia/.test(appSrc) && /16|sampleRate/.test(appSrc));
check('Ovoz: XAVFSIZLIK — tanilgan matn shellga uzatilmaydi (faqat buyruq ID si)',
  fs.existsSync(path.join(HERE, '..', 'agent', 'local_voice.js'))
  && (() => { const src = fs.readFileSync(path.join(HERE, '..', 'agent', 'local_voice.js'), 'utf8');
    return !/\bexecSync\b/.test(src) && !/shell:\s*true/.test(src) && /XAVFSIZLIK/.test(src) && /RAW_ALLOWED/.test(src); })()
  && /voiceRunCommand/.test(appSrc));
check('Ovoz modeli katalogda (rubaistt, whisper.cpp) va «Ovoz modeli» turkumi UI da',
  (() => { const cat = JSON.parse(read(path.join('..', 'local-ai', 'catalog.json')));
    const v = cat.items.find((x) => x.id === 'voice-rubaistt-medium-q5');
    return !!v && v.kind === 'voice' && v.bytes === 539212484 && /rubaistt/.test(v.url) && /q5_0/.test(v.file); })()
  && /data-tab="voice"/.test(html));
check('Katta modellar boshqa diskka ko‘chiriladi (`YANG_MODELS_DIR`)',
  /YANG_MODELS_DIR/.test(modelsSrc) && /process\.env\.YANG_MODELS_DIR/.test(modelsSrc));
check('Kompyuterda o‘rnatilgan AI ni bir bosishda ulash (Ollama/LM Studio)',
  /ollama/i.test(modelsSrc) && /lmstudio/i.test(modelsSrc) && /models-attach/.test(modelsSrc)
  && /data-act="use"|"use"/.test(appSrc));
check('Apparat profili VRAM ni o‘lchaydi va WMI cheklovini ochiq aytadi',
  /Win32_VideoController/.test(modelsSrc) && /WMI 4 GB/.test(modelsSrc));
// Program Files'dagi nusxa (`resources/local-ai`) O'CHIRILMAYDI: aks holda offline model va rasm
// dvigateli butunlay yo'qolib, ularni faqat qayta yuklab tiklash mumkin bo'lardi.
check('Ilova bilan kelgan nusxa o‘chirishdan himoyalangan (readonly)',
  /readonly/.test(modelsSrc) && /o‘chirilmaydi/.test(modelsSrc) && /readonly/.test(appSrc)
  && /inst\.readonly/.test(modelsSrc));

/* ---------------- v5.6: cheklovsiz lokal AI, menyu qatori, Kod AI ---------------- */
// Asosiy ilovaning o'z fayllari (bu test IDE papkasidan ishlaydi).
const mainHtml = read(path.join('..', 'renderer', 'index.html'));
const mainAppJs = read(path.join('..', 'renderer', 'app.js'));
const engineSrc = read(path.join('..', 'agent', 'engine.js'));
const remoteCatSrc = fs.existsSync(path.join(HERE, '..', 'agent', 'remote_catalog.js'))
  ? read(path.join('..', 'agent', 'remote_catalog.js'))
  : '';
const deskRHtml = read(path.join('..', 'admin-desk', 'renderer', 'index.html'));
const deskMainSrc = read(path.join('..', 'admin-desk', 'main.js'));

// Cheklov olib tashlandi: resurs yetmasa ham model YUKLAB OLINADI va ishlatiladi.
check('Cheklov olib tashlandi: menejerda «Ishlamaydi» holati yo‘q (faqat ogohlantirish)',
  !/blocked: 'Ishlamaydi'/.test(modelsSrc) && /warn: 'Ogohlantirish'/.test(modelsSrc)
  && !/state = 'blocked'/.test(modelsSrc) && /machineStars/.test(modelsSrc));
check('Lokal AI menyu qatoridan ham ochiladi (asosiy ilova menyusi + ko‘prik)',
  /label: 'Lokal AI'/.test(appMainSrc) && /openModelsUi/.test(appMainSrc) && /ui:open-models/.test(appMainSrc)
  && /onOpenModels/.test(appPreloadSrc) && /onOpenModels/.test(mainAppJs));
check('Sozlamalarda «Lokal AI» bo‘limi ko‘rinadi (tab + panel + Kod rejimi tugmasi)',
  /data-tab="localai"/.test(mainHtml) && /data-pane="localai"/.test(mainHtml)
  && /setOpenModels/.test(mainAppJs) && /id="codeBtn"/.test(mainHtml));
check('Admin Desk tahrirlagan katalog ilovada ustuvor (remote merge, relizsiz)',
  !!remoteCatSrc && /export function mergeCatalog/.test(remoteCatSrc) && /mergeCatalog\(raw\)/.test(modelsSrc)
  && /REMOTE_CATALOG_URL/.test(appMainSrc) && /fetchRemoteCatalog/.test(appMainSrc));
check('YANG AI kodlash uchun maxsus rejim beradi (Kod AI system prompti)',
  /export const CODING_MODE_EXTRA/.test(engineSrc) && /config\.codingMode/.test(engineSrc)
  && /CODING_MODE_EXTRA/.test(engineSrc) && /id="codingModeToggle"/.test(mainHtml)
  && /Kodlash rejimi/.test(appMainSrc));
check('Admin Desk: lokal AI qo‘shish / o‘chirish / tahrirlash va nashr bo‘limi',
  /data-tab="models"/.test(deskRHtml) && /catalog-push/.test(deskMainSrc) && /catalog-pull/.test(deskMainSrc));

// Sanoq HAQIQIY: matn qo‘lda yozilgan raqam bilan yuritilmaydi (u eskirib qolgan edi).
console.log(failed ? `\n${failed}/${total} tekshiruv YIQILDI` : `\nHammasi o‘tdi (${total} tekshiruv · 9 guruh)`);
if (failed) process.exitCode = 1;
