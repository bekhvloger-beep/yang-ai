// remote_catalog.js sinovi: admin tahrirlagan katalog PAKETDAGI katalog ustiga qanday
// qo'yilishini tekshiradi. Sof modul (electron yo'q) — shuning uchun oddiy node bilan ishlaydi.
//
//   node agent/test_remote_catalog.mjs
import assert from 'node:assert/strict';
import { setRemoteCatalog, mergeCatalog, getRemoteCatalog, clearRemoteCatalog } from './remote_catalog.js';

let pass = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${label}`);
  } catch (e) {
    console.log(`  FAIL  ${label} — ${e.message}`);
    process.exitCode = 1;
  }
}

const LOCAL = {
  version: 1,
  updated: '2026-10-01',
  levels: { 3: 'Kuchli' },
  items: [
    { id: 'a', kind: 'text', name: 'Model A', file: 'a.gguf', bytes: 100, url: 'https://x/a', min: { ramGb: 4, diskGb: 1 }, strength: { code: 3 }, level: 3, notes: 'eski tavsif' },
    { id: 'b', kind: 'text', name: 'Model B', file: 'b.gguf', bytes: 200, url: '', min: { ramGb: 8, diskGb: 5 }, strength: { code: 4 }, level: 4, notes: 'B tavsifi' },
  ],
};

check('remote yo‘q bo‘lsa — paketdagi katalog o‘zgarmaydi', () => {
  clearRemoteCatalog();
  const out = mergeCatalog(LOCAL);
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].notes, 'eski tavsif');
  assert.equal(out.remote, undefined);
  assert.equal(getRemoteCatalog(), null);
});

check('noto‘g‘ri shakl (items yo‘q) rad etiladi', () => {
  assert.equal(setRemoteCatalog({ version: 2 }), false);
  assert.equal(setRemoteCatalog(null), false);
  assert.equal(setRemoteCatalog({ items: [] }), true);
  clearRemoteCatalog();
});

check('mavjud modelning tavsifi, yulduzi va talablari yangilanadi', () => {
  setRemoteCatalog({
    updated: '2026-10-17',
    levels: { 4: 'Juda kuchli' },
    items: [
      { id: 'a', notes: 'admin yozgan yangi tavsif', strength: { code: 5, uzbek: 4 }, level: 4, min: { ramGb: 6, diskGb: 2 }, measured: { source: 'admin', idePass: 4, tasks: 4 } },
    ],
  });
  const out = mergeCatalog(LOCAL);
  const a = out.items.find((x) => x.id === 'a');
  assert.equal(a.notes, 'admin yozgan yangi tavsif');
  assert.deepEqual(a.strength, { code: 5, uzbek: 4 });
  assert.equal(a.level, 4);
  assert.deepEqual(a.min, { ramGb: 6, diskGb: 2 });
  assert.equal(a.measured.idePass, 4);
  // Admin tegmagan model o'z holicha qoladi.
  const b = out.items.find((x) => x.id === 'b');
  assert.equal(b.notes, 'B tavsifi');
  assert.equal(b.bytes, 200);
  assert.equal(out.remote, true);
  assert.equal(out.updated, '2026-10-17');
  assert.deepEqual(out.levels, { 4: 'Juda kuchli' });
});

check('admin qo‘shgan YANGI model ro‘yxatga kiradi (yuklab olish mumkin)', () => {
  setRemoteCatalog({
    items: [
      { id: 'a', notes: 'a yangilandi' },
      { id: 'yangi-coder', kind: 'text', name: 'Yangi Coder', file: 'yangi-coder.gguf', bytes: 900, url: 'https://x/y', min: { ramGb: 6, diskGb: 1 }, strength: { code: 5 }, notes: 'admin qo‘shgan model' },
    ],
  });
  const out = mergeCatalog(LOCAL);
  assert.equal(out.items.length, 3, `kutilgan 3, keldi ${out.items.length}`);
  const n = out.items.find((x) => x.id === 'yangi-coder');
  assert.ok(n, 'yangi model topilmadi');
  assert.equal(n.file, 'yangi-coder.gguf');
  assert.equal(n.notes, 'admin qo‘shgan model');
  // Mavjud yozuvlar joyida qoladi (tartib o‘zgarmaydi, olib tashlanmaydi).
  assert.equal(out.items[0].id, 'a');
  assert.ok(out.items.some((x) => x.id === 'b'));
  clearRemoteCatalog();
});

check('yaroqsiz yangi yozuv (id/file yo‘q) qo‘shilmaydi', () => {
  setRemoteCatalog({
    items: [
      { id: 'yangi', name: 'Yangi model', file: 'yangi.gguf', notes: 'yangi' },
      { id: 'buzuq1', name: 'Faysiz' },              // file yo‘q
      { id: '', name: 'IDsiz', file: 'z.gguf' },     // id yo‘q
      { id: 'a', notes: 'yana yangilandi' },         // mavjudni tahrirlash
    ],
  });
  const out = mergeCatalog(LOCAL);
  assert.equal(out.items.length, 3, `kutilgan 3, keldi ${out.items.length}`);
  assert.ok(out.items.some((x) => x.id === 'yangi' && x.file === 'yangi.gguf'));
  assert.ok(!out.items.some((x) => x.id === 'buzuq1' || x.id === ''));
  clearRemoteCatalog();
  assert.equal(mergeCatalog(LOCAL).items.length, 2);
});

console.log(`\n${pass}/5 PASS · EXIT=${process.exitCode ? 1 : 0}`);
