// Reliz izohini (body) yangilash — faqat matn, assetlar tegilmaydi.
//   node scripts/release_notes.mjs --dry        # faqat ko‘rish (PATCH qilinmaydi)
//   GH_TOKEN=ghp_xxx node scripts/release_notes.mjs
//
// Nima uchun alohida skript: `publish_release.mjs` izohni ham yangilaydi, lekin u bilan
// birga 1,7 GB assetlarni qayta yuklaydi. Izohga keyin o‘lchov natijalari qo‘shilganda
// (masalan «o‘rnatilgan nusxada tasdiqlash») faqat shu skript kerak bo‘ladi.
//
// Izoh manbai: `docs/v<versiya>-chiqarish.md` (YANG_RELEASE_NOTES bilan almashtiriladi).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  for (const file of ['admin-config.json', '.gh-token']) {
    const p = path.join(ROOT, file);
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8').trim();
      const token = file.endsWith('.json') ? String((JSON.parse(raw) || {}).ghToken || '').trim() : raw;
      if (token) return token;
    } catch { /* keyingi manbaga o‘tamiz */ }
  }
  return '';
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const OWNER = process.env.GH_OWNER || 'bekhvloger-beep';
const REPO = process.env.GH_REPO || 'yang-ai';
const NOTES_FILE = process.env.YANG_RELEASE_NOTES || path.join(ROOT, 'docs', `${tag}-chiqarish.md`);

if (!fs.existsSync(NOTES_FILE)) {
  console.log(`Izoh fayli topilmadi: ${NOTES_FILE}`);
  process.exit(1);
}
const notes = fs.readFileSync(NOTES_FILE, 'utf8').trim();
if (!notes) {
  console.log(`Izoh fayli bo‘sh: ${NOTES_FILE}`);
  process.exit(1);
}
console.log(`✓ Izoh: ${path.relative(ROOT, NOTES_FILE)} (${notes.length} belgi, ${notes.split('\n').length} qator)`);
const headings = notes.split('\n').filter((l) => /^##\s/.test(l));
console.log(`  bo‘limlar: ${headings.length} — ${headings.map((h) => h.replace(/^##\s*/, '')).join(' | ').slice(0, 300)}`);

if (DRY) {
  console.log('--dry: GitHub’ga hech narsa yuborilmadi');
  process.exit(0);
}

const TOKEN = readToken();
if (!TOKEN) {
  console.log('Token topilmadi: GH_TOKEN, admin-config.json (ghToken) yoki .gh-token kerak.');
  process.exit(1);
}

const api = (p) => `https://api.github.com${p}`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'yang-release-notes',
  'content-type': 'application/json',
};

const found = await fetch(api(`/repos/${OWNER}/${REPO}/releases/tags/${tag}`), { headers });
if (found.status === 404) {
  console.log(`Reliz ${tag} topilmadi. Avval: node scripts/publish_release.mjs`);
  process.exit(1);
}
if (!found.ok) {
  console.log(`Relizni o‘qishda xato: ${found.status} ${(await found.text()).slice(0, 160)}`);
  process.exit(1);
}
const rel = await found.json();
console.log(`✓ Reliz ${tag} (id ${rel.id}, holat: ${rel.draft ? 'qoralama' : 'e’lon qilingan'}, asset ${rel.assets.length} ta)`);

const patch = await fetch(api(`/repos/${OWNER}/${REPO}/releases/${rel.id}`), {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ body: notes }),
});
const text = await patch.text();
if (patch.status !== 200) {
  console.log(`✗ Izohni yangilashda xato: ${patch.status} ${text.slice(0, 200)}`);
  process.exit(1);
}
const updated = JSON.parse(text);
console.log(`✓ Izoh yangilandi: ${(updated.body || '').length} belgi`);

// Qayta o‘qib tasdiqlaymiz — PATCH javobi bilan cheklanmaymiz.
const again = await (await fetch(api(`/repos/${OWNER}/${REPO}/releases/tags/${tag}`), { headers })).json();
const same = (again.body || '').trim() === notes;
console.log(`${same ? '✓' : '✗'} Qayta o‘qildi: ${same ? 'izoh manba fayl bilan AYNAN bir xil' : 'izoh mos kelmadi'}`);
console.log(`  https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`);
process.exit(same ? 0 : 1);
