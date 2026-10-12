// Release tavsifini (body) githubsiz (API PATCH) orqali yangilaydigan yordamchi skript.
// GH_TOKEN talab qiladi. Masalan: GH_TOKEN=ghp_xxx node scripts/update_release_body.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'bekhvloger-beep';
const REPO = process.env.GH_REPO || 'yang-ai';
if (!TOKEN) { console.log('GH_TOKEN talab qilinadi.'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const body = `YANG AI v${version} — aicomp.uz

Yangiliklar (v${version}):
- 🔍 Lokal skan kengaytirildi: Ollama / LM Studio modellari hajmi va taxminiy RAM ko‘rsatkichi bilan ko‘rinadi, bir bosishda asosiy AI qilib o‘rnatiladi
- 🔑 Lokal (localhost) serverlar API kalitsiz ulanadi — masofaviy provayderlar yana kalit talab qiladi

Avvalgi versiyalar haqida — o‘rnatilgan ilova versiya tarixini ko‘ring.`;

const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/v${version}`, {
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
});
if (res.status !== 200) { console.log('Release topilmadi:', res.status); process.exit(1); }
const release = await res.json();

const patch = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ body }),
});
console.log('PATCH holat:', patch.status);
const j = await patch.json();
console.log('Yangi body:', j.body?.slice(0, 200) || '(bo‘sh)');
