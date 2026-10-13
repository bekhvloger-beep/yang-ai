// Release publisher: node scripts/publish_release.mjs  (GH_TOKEN env muhitida bo'lishi kerak)
// GH_TOKEN admin panelidan olinadi (admin-config.json -> ghToken), hech qachon chop etilmaydi.
// Creates GitHub release v<version> and uploads 4 asset:
//   YANG-AI-Setup-<v>.exe + .exe.blockmap + YANG-AI-Portable-<v>.exe + latest.yml
// Skript idempotent: reliz mavjud bo'lsa assetlar nomi bo'yicha o'chirilib, qayta yuklanadi.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || 'bekhvloger-beep';
const REPO = process.env.GH_REPO || 'yang-ai';

if (!TOKEN) {
  console.log('GH_TOKEN o‘rnatilmagan. Masalan: GH_TOKEN=ghp_xxx node scripts/publish_release.mjs');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const api = (p) => `https://api.github.com${p}`;

// Hajm izohi har relizda qo'lda yangilanmasin: qiymatlar qurilgan fayldan olinadi.
const sizeOf = (f) => (fs.existsSync(f) ? `${fs.statSync(f).size.toLocaleString('en-US').replace(/,/g, ' ')} B` : '—');
const setupBytes = sizeOf(path.join(ROOT, 'dist', `YANG-AI-Setup-${version}.exe`));
const portableBytes = sizeOf(path.join(ROOT, 'dist', `YANG-AI-Portable-${version}.exe`));

async function gh(method, url, body, isJson = true) {
  const res = await fetch(api(url), {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...(isJson && body ? { 'content-type': 'application/json' } : {}),
      ...(body && !isJson ? { 'content-type': 'application/octet-stream' } : {}),
    },
    body: isJson && body ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  return { status: res.status, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), text, headers: res.headers };
}

// 1. repo exists?
{
  const r = await gh('GET', `/repos/${OWNER}/${REPO}`);
  if (r.status === 404) {
    console.log(`Repo ${OWNER}/${REPO} topilmadi. GitHub'da yarating: https://github.com/new (nomi: yang-ai, Public)`);
    process.exit(1);
  }
  if (r.status !== 200) {
    console.log('Repo ochishda xato:', r.status, r.text.slice(0, 200));
    process.exit(1);
  }
  console.log(`✓ Repo topildi: ${OWNER}/${REPO}`);
}

// Chiqarish izohi (body): `docs/<tag>-chiqarish.md` bo'lsa o'shandan olinadi — shunda har
// versiyaning izohi alohida faylda yoziladi va skript ichidagi matn eskirib qolmaydi.
const NOTES_FILE = process.env.YANG_RELEASE_NOTES || path.join(ROOT, 'docs', `${tag}-chiqarish.md`);
const notes = fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE, 'utf8').trim() : null;
console.log(notes ? `✓ Izoh fayli: docs/${tag}-chiqarish.md (${notes.length} belgi)` : '⚠ Izoh fayli topilmadi — skript ichidagi zaxira matn ishlatiladi');

// 2. create release (idempotent)
let release;
{
  const existing = await gh('GET', `/repos/${OWNER}/${REPO}/releases/tags/${tag}`);
  if (existing.status === 200) {
    release = existing.json;
    console.log(`✓ Release ${tag} allaqachon bor — izoh yangilanadi, assetlar ustiga yoziladi`);
    // Izohni ham yangilaymiz: qayta yurishda eski matn qolib ketmasin.
    const patch = await gh('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.id}`, { body: notes || release.body });
    if (patch.status === 200) console.log('✓ Izoh yangilandi');
  } else {
    const r = await gh('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: tag,
      name: `YANG AI ${tag}`,
      body: notes || `YANG AI v${version} — aicomp.uz

Yangiliklar (v3.9.7):
- 🔍 Lokal skan kengaytirildi: Ollama / LM Studio modellari endi hajmi va taxminiy RAM ko‘rsatkichi bilan ko‘rinadi, bir bosishda asosiy AI qilib o‘rnatiladi
- 🔑 Lokal (localhost) serverlar API kalitsiz ulanadi — masofaviy provayderlar yana kalit talab qiladi
- 📊 7 ta kod topshiriqlar bilan qiyosiy sinov qilindi (natijalar repo ichida)

Yangiliklar (v3.9.6):
- ✂️ Lokal model «cho‘zilishi» tuzatildi: javob cheksiz yozilmaydi (matn guardi + token chegarasi + takrorlanish penaltisi). Ilgari 1.7B model tool’siz javobni 5341 token (≈9 daqiqa) yozib ketardi — endi qurish qadami ~3 daqiqada tugaydi
- 🛠 Lokal tool to‘plami kengaytirildi: **run_command** (yozgan faylni ishga tushirib tekshirish) va **create_image** (PNG chizish) — lokal model endi yasab, sinab ko‘rsatadi
- 🧩 Degeneratsiya himoyasi: bir xil tool chaqiruvi takrorlansa o‘tkazib yuboriladi; tool argumenti buzilsa (llama-server 500) model qisqa JSON yozishga qaytariladi; shundan keyin ham buzilsa — yozilgan fayllar asosida yakuniy javob beriladi (vazifa yo‘qolmaydi)
- 🤝 Jamoaviy rejim sinxronligi: har bir agent ishga tushishdan oldin «jamoa doskasi» oladi (kim nima qiladi + nima tugadi), planner fayllarni agentlar bo‘yicha taqsimlaydi, takroriy agent nomlari ajratiladi
- 👔 Jamoa rahbari (Lead) qadam chegarasiga urilsa ham yakuniy javob beriladi — avval butun jamoa natijasi xato bilan yo‘qolardi
- 🧪 Yangi sinov to‘plami: 100 xil reja + 100 xil vazifa (chat/fayl/ishga tushirish/rasm), jamoa sinxronligi (6 tekshiruv) va rasm yaratish (offline + lokal model + AI zanjiri) testlari

Yangiliklar (v3.9.5):
- ✅ Tuzatish endi doimiy testlar bilan qo‘riqlanadi: sovuq start kutish va pin/failover zanjiri avtomatik tekshiriladi (\`npm run test:pin\` — 7/7 PASS: pin ON da 1 juftlik, pin OFF da 4 juftlik, notislar va aniq xato; \`npm run test:ui\` — 5/5 PASS: pin tugmasi UI orqali yoqiladi/o‘chiriladi va qayta ishga tushgandan keyin holat tiklanadi)
- ⚙️ Ilova kodi 3.9.4 bilan bir xil: sovuq start tuzatishi va pin/failover mantiqi o‘zgarmagan — bu reliz o‘sha paketni yangi tekshiruvlar bilan qayta chiqaradi
- 🔍 3.9.4 paketi chiqqandan keyin ilova kodida (main.js, agent/**, renderer/**) birorta o‘zgarish topilmadi

Yangiliklar (v3.9.4):
- \u2744\ufe0f SOVUQ START TUZATILDI (kritik): yangi o'rnatishdan keyingi BIRINCHI xabar ko'p hollarda "Barcha provayderlar ishlamadi: Lokal AI (offline) \u00b7 fetch failed" bilan yiqilardi. Sabab: ilova lokal modelni fonda yuklaydi, engine esa tayyor bo'lishini kutmasdan so'rov yuborardi (o'lchov \u2014 model 2 141 ms da tayyor, so'rov esa 11 ms da yuborilardi). Endi ilova model tayyor bo'lishini kutadi (45 s gacha, 400 ms \u2192 2 s backoff), kutish davomida "\u23f3 Lokal model yuklanmoqda" notisi ko'rsatiladi, model umuman ko'tarilmasa zaxira provayderga o'tadi (pin rejimida aniq xato ko'rsatiladi)

Yangiliklar (v3.9.3):
- 🧠 Lokal AI endi ASOSIY rejim: ilova birinchi navbatda kompyuteringizdagi modeldan javob oladi (llama.cpp + Qwen3-1.7B, ilova ichida) — internet va API kaliti shart emas
- 🔑 Kilo kalitsiz zaxira: lokal model ishlamasa, kalit talab qilmaydigan Kilo gateway avtomatik ulanadi (oxirgi zaxira — Pollinations)
- 🔤 Tarjima tuzatishlari: NLLB lotin o'zbekcha chiqishiga kirill harflar aralashib qolishi ("анықlashish") tuzatildi — chiqish faqat lotin o'zbekcha, kod/yo'l/URL tokenlari tegilmaydi; tarjimon kutish vaqti haqiqiy o'lchovga tayinlandi (≈2.3 s sovuq start → 8 s chegara, 5 daq. "eslab qolish"), shuning uchun ilova bekorga kutmaydi
- 🔔 Notis mantiqi tuzatildi: "Lokal model: …" xabari faqat haqiqatan lokal model javob berganda ko'rsatiladi
- 📌 "Faqat shu modelni ishlatish" (pin) rejimi saqlanib qoldi: tanlangan modelga qotib, zaxiraga o'tmasdan aniq xato ko'rsatadi

Hajm va model (muhim):
- O'rnatuvchi hajmi ~1.7 GiB (Setup ${setupBytes}, Portable ${portableBytes}). Ichida: Qwen3-1.7B modeli (1.05 GiB), NLLB tarjimon (631 MB), llama.cpp runtime
- Nima uchun 4B model emas: NSIS o'rnatuvchi formati 2 GiB dan katta paketni yiga olmaydi — 4B model bilan paket 3.6 GB bo'lgan va build yiqilgan. Shuning uchun paketga 1.7B model kiritildi (har qanday zamonaviy PC'da ishlaydi); kompyuterda model-4b.gguf bo'lsa va RAM 8 GB+ bo'lsa, ilova avtomatik o'sha kattaroq modelni tanlaydi
- Windows 10/11 x64. Yangilanish ilova ichida o'zi aniqlanadi (avtomatik yangilanish faqat oldinga qarab ishlaydi \u2014 shu sabab 3.9.4 alohida versiya sifatida chiqarildi, 3.9.3 assetlari almashtirilmadi).

v3.9.3 va undan oldingi yangiliklar:

Yangiliklar (v3.9.2):
- 📌 "Faqat shu modelni ishlatish" rejimi — Sozlamalarda tanlangan modelga qotirish: boshqa model/provayderga avtomatik o'tish o'chiriladi, ishlamasa aniq xato ko'rsatiladi (agentlar jamoasi ham shu modelda ishlaydi)

v3.9.1:
- 🔴 KRITIK FIX: Lokal AI endi TO'G'RI ishlaydi — avvalgi versiyada kontekst kichikligi tufayli har doim xato berardi ("javob bermadi")
- 💻 Zaxira zanjiri endi chinakam to'liq: bulut limit bo'lsa lokal AI darhol javob beradi

v3.9.0:
- 🖥 Jonli faoliyat chizig'i — agent aynan nimani qilyotganini ko'rsatadi: qaysi papka/fayl ochilgani, qaysi buyruq bajarilayotgani, qaysi model javob berayotgani
- 💻 Lokal AI (llama.cpp + Qwen 0.5B) ilova ichida — internet va kalit bo'lmasa ham ishlaydi
- ⚡ Band server (524/503) ~4s ichida boshqa modelga o'tadi
- ⤓ "Modellar" tugmasi — serverdan mavjud modellar ro'yxatini olib, bosib tanlash mumkin

Avvaldan bor:
- Agentlar jamoasi (parallel, ko'p API), PDF/DOCX/XLSX/PNG, vision, o'zbekcha tarjimon, onlayn qo'llab-quvvatlash, avto-yangilanish`,
      draft: false,
      prerelease: false,
    });
    if (r.status !== 201) {
      console.log('Release yaratishda xato:', r.status, r.text.slice(0, 300));
      process.exit(1);
    }
    release = r.json;
    console.log(`✓ Release ${tag} yaratildi`);
  }
}

// 3. upload assets (stream orqali — katta fayllar uchun; ENOBUFS buffer xatosini oldini oladi)
const assets = [
  path.join(ROOT, 'dist', `YANG-AI-Setup-${version}.exe`),
  path.join(ROOT, 'dist', `YANG-AI-Setup-${version}.exe.blockmap`),
  path.join(ROOT, 'dist', `YANG-AI-Portable-${version}.exe`),
  path.join(ROOT, 'dist', 'latest.yml'),
];
// Qo'shimcha assetlar (masalan mustaqil IDE o'rnatuvchilari):
//   YANG_EXTRA_ASSETS="dist-ide/YANG-IDE-Setup-1.0.0.exe,dist-ide/YANG-IDE-Portable-1.0.0.exe"
// Diqqat: boshqa ilovaning latest.yml'ini bu yerga qo'shmang — u AI ilovasining
// avto-yangilanish faylini almashtirib qo'yadi.
for (const extra of String(process.env.YANG_EXTRA_ASSETS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  assets.push(path.isAbsolute(extra) ? extra : path.join(ROOT, extra));
}
const uploadUrl = release.upload_url.split('{')[0];

async function uploadOnce(file, name) {
  const size = (fs.statSync(file).size / 1e6).toFixed(1);
  // curl Content-Length ni aniq yuboradi (Node fetch stream chunked yuborib
  // GitHub'da "Bad Content-Length" 400 berardi) va RAM'ni bosmaydi.
  const out = execFileSync(
    'curl',
    [
      '-sS', '--fail-with-body', '--retry', '2', '--connect-timeout', '30', '--max-time', '1800',
      '-X', 'POST',
      '-H', `Authorization: Bearer ${TOKEN}`,
      '-H', 'Content-Type: application/octet-stream',
      '--data-binary', `@${file}`,
      `${uploadUrl}?name=${encodeURIComponent(name)}`,
    ],
    { encoding: 'utf8', timeout: 1900000 },
  );
  console.log(`✓ Yuklandi: ${name} (${size} MB)`);
  return true;
}

async function deleteAssetByName(name) {
  const cur = await gh('GET', `/repos/${OWNER}/${REPO}/releases/${release.id}`);
  for (const a of (cur.json && cur.json.assets) || []) {
    if (a.name === name) await gh('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${a.id}`);
  }
}

for (const file of assets) {
  if (!fs.existsSync(file)) {
    console.log('⚠ Topilmadi:', file);
    continue;
  }
  const name = path.basename(file);
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    if (attempt > 1) {
      console.log(`↻ Qayta urinish ${attempt}/3: ${name} (10s kutilmoqda)`);
      await new Promise((r) => setTimeout(r, 10000));
    }
    await deleteAssetByName(name);
    try {
      done = await uploadOnce(file, name);
    } catch (e) {
      console.log(`✗ ${name} urinish ${attempt}: ${e.message || e.cause?.code || e}`);
    }
  }
  if (!done) console.log(`⚠ YUKLANMADI: ${name} — keyinroq skriptni qayta ishga tushirish mumkin (idempotent)`);
}

console.log(`\nTayyor: https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`);
console.log('Foydalanuvchilarda ilova o‘zi yangi versiyani aniqlab o‘rnatadi.');
