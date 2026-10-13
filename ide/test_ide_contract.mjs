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
const MAIN_MODULES = ['main.js', 'ide_host.js', 'ide_pty.js', 'ide_lsp.js', 'ide_debug.js', 'ide_runner.js'];
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
function check(label, cond, detail = '') {
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

console.log(failed ? `\n${failed} tekshiruv YIQILDI` : '\nHammasi o‘tdi (44 tekshiruv · 8 guruh)');
if (failed) process.exitCode = 1;
