// YANG-AI-Setup-<version>.exe faylini GitHub release'ga (idempotent) yuklaydi.
// GH_TOKEN muhitida bo'lishi kerak. Masalan: GH_TOKEN=ghp_xxx node scripts/upload_setup.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'bekhvloger-beep';
const REPO = process.env.GH_REPO || 'yang-ai';
if (!TOKEN) { console.log('GH_TOKEN o‘rnatilmagan.'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const NAME = `YANG-AI-Setup-${version}.exe`;
const FILE = path.join(ROOT, 'dist', NAME);
const api = (p) => `https://api.github.com${p}`;

async function gh(method, p, body = null) {
  const res = await fetch(api(p), {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: null }; }
}

const rel = await gh('GET', `/repos/${OWNER}/${REPO}/releases/tags/v${version}`);
if (rel.status !== 200) { console.log('Release topilmadi:', rel.status); process.exit(1); }
const release = rel.json;

// eski nusxani o'chirish
for (const a of release.assets || []) {
  if (a.name === NAME) {
    console.log('Eski asset o‘chirilmoqda:', NAME);
    await gh('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${a.id}`);
  }
}

const uploadUrl = release.upload_url.split('{')[0] + `?name=${encodeURIComponent(NAME)}`;
for (let attempt = 1; attempt <= 3; attempt++) {
  console.log(`Yuklanmoqda ${attempt}/3: ${NAME} (${(fs.statSync(FILE).size / 1e6).toFixed(1)} MB)`);
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(fs.statSync(FILE).size) },
      body: Readable.toWeb(fs.createReadStream(FILE)),
      duplex: 'half',
      signal: AbortSignal.timeout(1800000),
    }).then(async (r) => {
      console.log('fetch ok:', r.status);
      return r;
    });
    const text = await res.text();
    if (res.status === 201) { console.log(`✓ Yuklandi: ${NAME}`); process.exit(0); }
    console.log(`✗ (${attempt}) HTTP ${res.status}: ${text.slice(0, 300)}`);
  } catch (e) { console.log(`✗ (${attempt}) ${e.message || e.cause?.code || e}`); }
  await new Promise((r) => setTimeout(r, 10000));
}
console.log('⚠ Yuklanmadi — keyinroq qayta urinib ko‘ring.');
process.exit(1);
