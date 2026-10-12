// v5.0 qolgan assetlarni (Portable, blockmap, latest.yml) yuklaydi. GH_TOKEN kerak.
// Masalan: GH_TOKEN=ghp_xxx node scripts/upload_assets_v5.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'bekhvloger-beep';
const REPO = process.env.GH_REPO || 'yang-ai';
if (!TOKEN) { console.log('GH_TOKEN talab qilinadi.'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const FILES = [
  path.join(ROOT, 'dist', `YANG-AI-Portable-${version}.exe`),
  path.join(ROOT, 'dist', `YANG-AI-Setup-${version}.exe.blockmap`),
  path.join(ROOT, 'dist', 'latest.yml'),
];
if (!fs.existsSync(path.join(ROOT, 'dist', 'latest.yml'))) {
  // latest.yml yangi build'da versiyalangan bo'lishi mumkin
  const alt = path.join(ROOT, 'dist', `latest-${version}.yml`);
  if (fs.existsSync(alt)) FILES[FILES.length - 1] = alt;
}

const api = (p) => `https://api.github.com${p}`;
async function gh(method, p, body = null) {
  const res = await fetch(api(p), { method, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: null }; }
}

const rel = await gh('GET', `/repos/${OWNER}/${REPO}/releases/tags/v${version}`);
if (rel.status !== 200) { console.log('Release topilmadi:', rel.status); process.exit(1); }
const release = rel.json;

for (const FILE of FILES) {
  if (!fs.existsSync(FILE)) { console.log('⚠ topilmadi (o‘tkazib yuborildi):', FILE); continue; }
  const NAME = path.basename(FILE);
  for (const a of release.assets || []) {
    if (a.name === NAME) { console.log('allaqachon bor, o‘chirib qayta yuklaydi:', NAME); await gh('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${a.id}`); }
  }
  const uploadUrl = release.upload_url.split('{')[0] + `?name=${encodeURIComponent(NAME)}`;
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(fs.statSync(FILE).size) },
        body: Readable.toWeb(fs.createReadStream(FILE)),
        duplex: 'half',
        signal: AbortSignal.timeout(1800000),
      });
      await res.text();
      if (res.status === 201) { console.log(`✓ Yuklandi: ${NAME}`); done = true; continue; }
      console.log(`✗ (${attempt}) HTTP ${res.status} — ${NAME}`);
    } catch (e) { console.log(`✗ (${attempt}) ${NAME}: ${e.message || e}`); }
    await new Promise((r) => setTimeout(r, 10000));
  }
  if (!done) console.log(`⚠ YUKLANMADI: ${NAME}`);
}
console.log('Tayyor.');
