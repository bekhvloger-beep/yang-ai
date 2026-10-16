// scripts/publish_catalog.mjs — admin tahrirlaydigan «jonli» fayllarni GitHub'ga yuklaydi.
//
// Nima uchun kerak: ilova ishga tushganda `local-ai/catalog.json` (lokal AI tavsiflari,
// yulduzlar, minimal talablar, yuklab olish havolalari) va `app-config.json` (e'lon,
// reklama) ni GitHub'dan tortadi. Ya'ni ulardagi o'zgarish YANGI RELIZ talab qilmaydi.
// YANG Admin Desk ham xuddi shu yo'lni ishlatadi (u yerda «🧠 Lokal AI → ⬆ Nashr qilish»
// va «Reliz holati → ⬆ Nashr qilish»); bu skript esa buyruq qatoridan bir xil ish qiladi.
//
// Yurish:
//   node scripts/publish_catalog.mjs                                  # local-ai/catalog.json
//   node scripts/publish_catalog.mjs local-ai/catalog.json app-config.json
//   YANG_BRANCH=main node scripts/publish_catalog.mjs                  # shoxobchani almashtirish
//
// Token manbai `publish_release.mjs` bilan AYNAN bir xil: GH_TOKEN → admin-config.json
// → `.gh-token` fayli. Token qiymati hech qachon chop etilmaydi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  for (const file of ['admin-config.json', '.gh-token']) {
    const p = path.join(ROOT, file);
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8').trim();
      const token = file.endsWith('.json') ? String((JSON.parse(raw) || {}).ghToken || '').trim() : raw;
      if (token) return token;
    } catch { /* keyingi manbaga o'tamiz */ }
  }
  return '';
}

const TOKEN = readToken();
const OWNER = process.env.GH_OWNER || 'bekhvloger-beep';
const REPO = process.env.GH_REPO || 'yang-ai';
const BRANCH = process.env.YANG_BRANCH || 'main';
const MESSAGE = (process.env.YANG_MESSAGE || '').trim();

// Sukut: lokal AI katalogi. Boshqa fayllar argument sifatida beriladi (repo ildiziga nisbatan).
const files = (process.argv.slice(2).length ? process.argv.slice(2) : ['local-ai/catalog.json'])
  .map((f) => f.replace(/\\/g, '/'));

if (!TOKEN) {
  console.log('Token topilmadi. Uch yo‘ldan biri: GH_TOKEN, admin-config.json (ghToken), .gh-token.');
  process.exit(1);
}

const api = (p) => `https://api.github.com${p}`;
const headers = { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'yang-ai' };

/** Bitta faylni shoxobchaga yozadi (avvalgi SHA bilan — ustiga yozish uchun). */
async function putFile(file) {
  const abs = path.join(ROOT, file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    console.log(`✗ ${file} — o‘qilmadi: ${e.message}`);
    return false;
  }
  // Buzuq JSON nashr qilinmasin: aks holda barcha ilovalar tavsifni/e'lonni o'qiy olmay qoladi.
  if (file.endsWith('.json')) {
    try { JSON.parse(text); } catch (e) {
      console.log(`✗ ${file} — JSON buzuq, nashr qilinmadi: ${e.message}`);
      return false;
    }
  }
  const cur = await fetch(api(`/repos/${OWNER}/${REPO}/contents/${file}?ref=${BRANCH}`), { headers, signal: AbortSignal.timeout(20000) });
  const curJson = await cur.json().catch(() => ({}));
  if (cur.status !== 200 && cur.status !== 404) {
    console.log(`✗ ${file} — o‘qib bo‘lmadi: HTTP ${cur.status} ${curJson.message || ''}`);
    return false;
  }
  const res = await fetch(api(`/repos/${OWNER}/${REPO}/contents/${file}`), {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: MESSAGE || `${file} yangilandi (5.6.0 · YANG Admin Desk yo‘li bilan)`,
      content: Buffer.from(text, 'utf8').toString('base64'),
      branch: BRANCH,
      sha: curJson.sha || undefined,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`✗ ${file} — HTTP ${res.status} ${(out.message || '').slice(0, 160)}`);
    return false;
  }
  const sha = (out.commit && out.commit.sha) || '';
  console.log(`✓ ${file} → ${OWNER}/${REPO}@${BRANCH} · commit ${sha.slice(0, 10)} · ${Buffer.byteLength(text, 'utf8')} B`);
  return true;
}

console.log(`Nashr: ${OWNER}/${REPO} (${BRANCH}) · ${files.length} fayl`);
let bad = 0;
for (const f of files) {
  const ok = await putFile(f);
  if (!ok) bad += 1;
}
console.log(bad === 0 ? `\nHammasi nashr qilindi (${files.length}/${files.length}).` : `\n${bad}/${files.length} fayl nashr qilinmadi.`);
if (bad) process.exitCode = 1;
