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
const mainSrc = read('main.js');

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
const listened = new Set(matchAll(preloadSrc, /\bon\(\s*'(ide:[^']+)'/g));
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

console.log(failed ? `\n${failed} tekshiruv YIQILDI` : '\nHammasi o‘tdi (5 guruh)');
if (failed) process.exitCode = 1;
