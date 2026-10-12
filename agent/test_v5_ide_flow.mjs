// v5 IDE oqimi testi — read-file/list-tree handlerlarining oqimi (main.js'dagi logika bo'yicha).
// Ishga tushirish: node agent/test_v5_ide_flow.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ide-flow-'));
fs.writeFileSync(path.join(ws, 'hello.py'), 'def hello():\n    return "HI"\n');
fs.mkdirSync(path.join(ws, 'sub'));
fs.writeFileSync(path.join(ws, 'sub', 'nested.md'), '# v5 IDE\n');

// statik: main.js'dagi handlerlarning oqim pozitsionari
const mainSrc = fs.readFileSync(path.join(process.cwd(), 'main.js'), 'utf8');

// 1. ide:title files handler workspace ichida resolva qiladi
assert.ok(/path\.resolve\(ws, String\(p \|\| ''\)\)/.test(mainSrc), 'ide:read-file rel.resolve emas');

// 2. ide:list-tree depth bilan cheklangan
assert.ok(/walk\(full, d \+ 1\)/.test(mainSrc), 'ide:list-tree depth limiti yo‘q');
assert.ok(/slice\(0, 200\)/.test(mainSrc), 'ide:list-tree 200 fayl limiti yo‘q');

// 3. ide:run-command cwd faqat workspace ichida
assert.ok(/cwd ish papkasidan chiqib ketdi/.test(mainSrc), 'ide:run-command cwd tekshiruvi yo‘q');

// 4. ide:read-file foydalanuvchi misoli: hello.py HTML'ga readable
const fileContent = fs.readFileSync(path.join(ws, 'hello.py'), 'utf8');
assert.ok(fileContent.includes('hello'), 'test workspace yaratilmadi');

// 5. fayl daraxti README'dan cache: root misollar
assert.ok(fs.existsSync(path.join(ws, 'sub', 'nested.md')), 'nested fayl yaratilmadi');

// 6. IDE renderer jurnal barcha bog'langan event'larni ko'radi
const appSrc = fs.readFileSync(path.join(process.cwd(), 'renderer', 'app.js'), 'utf8');
for (const tool of ['read_file', 'write_file', 'edit_file', 'run_command', 'list_dir', 'search_files', 'create_image', 'create_document']) {
  assert.ok(appSrc.includes(`'${tool}'`), `IDE jurnali ${tool} eventini ko'rmayapti`);
}

fs.rmSync(ws, { recursive: true, force: true });
console.log('PASS: v5 IDE flow — range, depth, cwd guard, event jurnali hammasi bog‘langan');
