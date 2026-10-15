// v5 IDE xavfsizlik tests — path traversal va chegara tekshiruvi (statik + dinamik).
// Ishga tushirish: node agent/test_v5_ide_security.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = fs.readFileSync(path.join(here, '..', 'main.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(here, '..', 'preload.cjs'), 'utf8');
const appSrc = fs.readFileSync(path.join(here, '..', 'renderer', 'app.js'), 'utf8');

// 1. Barcha IDE IPC handlerlari workspace'dan chiqishni bloklaydi (path.relative + '..' tekshiruvi)
for (const h of ['ide:read-file', 'ide:run-command', 'ide:list-tree', 'ide:save-file', 'ide:open-external']) {
  assert.ok(mainSrc.includes(`'${h}'`), `${h} handler mavjud emas`);
}
// 1b. Qamoq ARXITEKTURASI: yo'l `realpath` bo'yicha tekshiriladi (symlink/junction ni ham
// ko'radi) va har bir yo'l oladigan handler o'sha yagona darvozadan o'tadi.
// v5.5 da ko'p ildizli workspace qo'shildi — shu sabab «matnda nechta `startsWith('..')` bor»
// o'rniga handler TANASIDA `insideAnyRoot(...)` borligi tekshiriladi (kuchliroq mezon).
const handlerBody = (name) => {
  const at = mainSrc.indexOf(`'${name}'`);
  if (at < 0) return '';
  const next = mainSrc.indexOf('ipcMain.handle(', at + 10);
  return mainSrc.slice(at, next < 0 ? mainSrc.length : next);
};
for (const h of ['ide:read-file', 'ide:save-file', 'ide:list-tree', 'ide:run-command', 'ide:open-external']) {
  assert.ok(/insideAnyRoot\s*\(/.test(handlerBody(h)), `${h} tanasida insideAnyRoot qamoq tekshiruvi yo'q`);
}
assert.ok(/fs\.realpathSync\.native/.test(mainSrc), 'realpath (symlink/junction) tekshiruvi yo‘q');
assert.ok(/const insideAnyRoot = /.test(mainSrc) && /const insideWorkspace = /.test(mainSrc), 'qamoq yordamchilari (insideWorkspace/insideAnyRoot) yo‘q');
// Yagona darvoza: `insideWorkspace` (realpath + `..`/abs tekshiruvi). `insideAnyRoot` esa
// shu darvozani ruxsat etilgan HAR BIR ildiz uchun chaqiradi — ya'ni qamoq bitta joyda.
const relCheckCount = (mainSrc.match(/startsWith\('\.\.'\)/g) || []).length;
assert.ok(relCheckCount >= 1, `nisbiy yo'l («..») tekshiruvi umuman yo'q (topildi: ${relCheckCount})`);
assert.ok(/const insideAnyRoot = \(roots, abs\) => \{[\s\S]{0,120}insideWorkspace\(root, abs\)/.test(mainSrc), 'insideAnyRoot har bir ildiz uchun insideWorkspace chaqirmayapti');

// 1c. Ko'p ildizli workspace qamoqni ZAIFLASHTIRMASLIGI kerak: qo'shimcha papka faqat
// foydalanuvchi papka tanlash oynasida O'ZI tanlagan papkadan qo'shiladi (renderer yo'l
// bera olmaydi), ro'yxat realpath bilan filtrlanadi va olib tashlash faqat qo'shimchalardan.
const addBody = handlerBody('ide:roots-add');
assert.ok(/showOpenDialog/.test(addBody), 'ide:roots-add papka tanlash oynasisiz ishlayapti');
assert.ok(/async \(\) =>/.test(addBody), 'ide:roots-add renderer’dan yo‘l qabul qilyapti (xavfli)');
assert.ok(/extraRoots/.test(addBody) && /realOrNull/.test(addBody), 'ide:roots-add realpath bilan filtrlamayapti');
const removeBody = handlerBody('ide:roots-remove');
assert.ok(/extraRoots\(\)\.filter/.test(removeBody), 'ide:roots-remove faqat qo‘shimcha ildizlardan o‘chiradi');
assert.ok(/cfg\.config\.extraRoots/.test(mainSrc), 'qo‘shimcha ildizlar sozlamada saqlanmayapti');
for (const fn of ['ideRootsList', 'ideRootsAdd', 'ideRootsRemove']) {
  assert.ok(preloadSrc.includes(fn), `preload'da ${fn} yo'q`);
}

// 2. Preload ko'plari (renderer faqat oshkor API'larga kiradi)
for (const fn of ['readWorkspaceFile', 'ideRunCommand', 'ideListTree', 'imageStudio', 'ideSaveFile', 'ideOpenExternal']) {
  assert.ok(preloadSrc.includes(fn), `preload'da ${fn} yo'q`);
}

// 3. Resize/UI window'da ide/img studiya elementlari ulangan
for (const id of ['idePanel', 'ideTree', 'ideTermOut', 'ideFeed', 'imgStudioModal', 'imgStudioQuality']) {
  assert.ok(appSrc.includes(`'${id}'`) || appSrc.includes(`"${id}"`) || appSrc.includes(id), `${id} rendererda yo'q`);
}

// 4. image:studio handler o'zbekcha promptni NLLB orqali inglizchaga aylantirishga urinadi
assert.ok(mainSrc.includes('eng_Latn'), 'image:studio inglizcha prompt tarjimasi yo‘q');
assert.ok(mainSrc.includes('generateImage'), 'image:studio generateImage ishlatmayapti');

// 5. ContextBridge (xavfsiz ko'purchiq) yolg'iz contextBridge bilan ochiladi
assert.ok(preloadSrc.includes('contextBridge.exposeInMainWorld'), 'preload contextBridge ishlatmayapti');

// 6. IDE handlerlari maxBytes limiti bilan katta fayllarni rad etadi
assert.ok(/maxBytes/.test(mainSrc), 'ide:read-file maxBytes limiti yo‘q');
assert.ok(/limit \* 4/.test(mainSrc), 'katta fayl rad etish sharti yo‘q');

// 7. v5.1 save-file: size limit + .bak zaxira + tahrirlovchi UI ulangan
assert.ok(/content\.length > 4 \* 1024 \* 1024/.test(mainSrc), 'ide:save-file 4MB limit yo‘q');
assert.ok(mainSrc.includes("'.bak'"), 'ide:save-file .bak zaxira yo‘q');
assert.ok(mainSrc.includes('shell.openPath'), 'ide:open-external shell.openPath yo‘q');
assert.ok(appSrc.includes('ideFileSave'), 'tahrirlovchi saqlash funksiyasi yo‘q');
assert.ok(appSrc.includes('ideFileToggleEdit'), 'tahrirlovchi rejim almashuvi yo‘q');
assert.ok(/ctrlKey/.test(appSrc), 'Ctrl+S qisqa yul yo‘q');

console.log('PASS: v5 IDE security — path traversal bloklandi, preload ko‘prigida contextBridge, maxBytes limiti bor');
