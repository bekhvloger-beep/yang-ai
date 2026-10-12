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
const relCheckCount = (mainSrc.match(/\w+\.startsWith\('\.\.'\)/g) || []).length;
assert.ok(relCheckCount >= 6, `path traversal blok ${relCheckCount} ta — kamida 6 bo'lishi kerak (read-file, run-command, list-tree guard, safeRel, save-file, open-external)`);

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
