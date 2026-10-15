// IDE vendor fayllarini nusxalash: xterm.js (haqiqiy terminal) va uning fit qo'shimchasi.
//
// Nega kerak: IDE renderer'i kutubxonasiz (bundler'siz) ishlaydi va faqat o'z papkasidagi
// fayllarni yuklay oladi (CSP: script-src 'self'). Shuning uchun npm paketlarining tayyor
// UMD nusxalari `ide/vendor/` ga ko'chiriladi — shunda ular asarga ham, mustaqil nusxaga ham
// bir xil tushadi.
//
// Ishga tushirish: node scripts/sync_ide_vendor.mjs   (npm run start/dist oldidan avtomatik)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'ide', 'vendor');

const FILES = [
  ['@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
];

fs.mkdirSync(OUT, { recursive: true });
let copied = 0;
const missing = [];
for (const [from, to] of FILES) {
  const src = path.join(ROOT, 'node_modules', ...from.split('/'));
  if (!fs.existsSync(src)) { missing.push(from); continue; }
  fs.copyFileSync(src, path.join(OUT, to));
  copied += 1;
  console.log(`✓ ${from} → ide/vendor/${to}`);
}
if (missing.length) {
  // Qattiq xato bermaymiz: PTY/xterm bo'lmasa IDE oddiy (fallback) terminal rejimida ishlaydi.
  console.log(`⚠ topilmadi (o‘tkazib yuborildi): ${missing.join(', ')}`);
  console.log('  Tuzatish: npm install @xterm/xterm @xterm/addon-fit');
}
console.log(`vendor: ${copied}/${FILES.length} fayl tayyor → ${path.relative(ROOT, OUT)}`);
