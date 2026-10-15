// One-shot: create README.md in the repo (first commit) so releases can be tagged.
import fs from 'node:fs';

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'bekhvloger-beep';
const REPO = 'yang-ai';

const readme = `# YANG AI

**Professional desktop agentic assistant** — aicomp.uz

YANG AI — foydalanuvchi kompyuterida ishlaydigan ZCode/Codex-uslubidagi agentic yordamchi:

- ❄️ **Sovuq start tuzatildi (v3.9.4 / v3.9.5)** — yangi o'rnatishdan keyingi BIRINCHI xabar endi lokal model tayyor bo'lishini kutadi (45 s gacha); kutish davomida "⏳ Lokal model yuklanmoqda" notisi chiqadi. Ilgari birinchi xabar "fetch failed" bilan yiqilardi.
- ✅ **Doimiy testlar (v3.9.5)** — sovuq start kutish va pin/failover zanjiri avtomatik tekshiriladi (\`npm run test:pin\`, \`npm run test:ui\`).
- 🧠 **Lokal AI asosiy rejim** — ilova birinchi navbatda kompyuteringizdagi modeldan javob oladi (llama.cpp + Qwen3-1.7B, ilova ichida). Internet va API kaliti shart emas.
- 🔑 **Kilo kalitsiz zaxira** — lokal model ishlamasa, kalit talab qilmaydigan Kilo gateway avtomatik ulanadi (oxirgi zaxira — Pollinations).
- 📌 **"Faqat shu modelni ishlatish" (pin)** — Sozlamalarda tanlagan modelingizga qotib qo'yasiz: boshqa model/provayderga o'tilmaydi, ishlamasa aniq xato ko'rsatiladi.
- 🔤 **O'zbekcha tarjimon** — lokal NLLB (o'zbek ↔ ingliz); chiqish faqat lotin o'zbekcha (kirill harflar aralashmaydi).
- 🤖 **Agentlar jamoasi** — katta loyihalar uchun parallel agentlar, har biri o'z mutaxassis API'sida
- 📄 **Hujjat yaratish** — PDF, Word (DOCX), Excel (XLSX), CSV, PNG diagrammalar
- 👁 **Vision** — skrinshot va rasm tahlili
- 🔄 **Avtomatik yangilanish** — GitHub Releases orqali
- 🔒 **Xavfsizlik** — buyruqlar uchun ruxsat so'rovi (approval tizimi)

## O'rnatish

[Releases](../../releases) bo'limidan so'nggi **YANG AI Setup .exe** faylini yuklab oling va ishga tushiring.

**Kalit kerak emas** — ilova lokal AI bilan darhol ishlaydi. Xohlasangiz Sozlamalar → API kalitlar bo'limida Groq, Cohere, Gemini, OpenRouter kabi bepul bulut kalitlarini qo'shib, kuchliroq modellarni ulashingiz mumkin.

### Hajm va model haqida

- O'rnatuvchi hajmi **~1.7 GiB** (Setup: 1 773 392 758 B; Portable: 1 773 132 336 B). Ichida: Qwen3-1.7B modeli (1.05 GiB), NLLB tarjimon (631 MB) va llama.cpp runtime.
- **Nima uchun 4B emas:** NSIS o'rnatuvchi formati 2 GiB dan katta paketni yiga olmaydi — 4B model bilan paket 3.6 GB bo'lib, build yiqilgan. Shuning uchun paketga 1.7B model kiritildi (har qanday zamonaviy PC'da ishlaydi). Kompyuterda \`model-4b.gguf\` bo'lsa va RAM 8 GB+ bo'lsa, ilova avtomatik o'sha kattaroq modelni tanlaydi.
- Windows 10/11 x64.

---
© AICOMP.UZ — barcha huquqlar himoyalangan.
`;

const content = Buffer.from(readme, 'utf8').toString('base64');
// Upsert: mavjud README bo'lsa sha bilan yangilanadi, bo'lmasa yaratiladi.
const head = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/README.md`, {
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
});
const existing = head.status === 200 ? await head.json() : null;
const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/README.md`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', Accept: 'application/vnd.github+json' },
  body: JSON.stringify({
    message: existing ? `README: YANG AI v${JSON.parse(fs.readFileSync('package.json', 'utf8')).version} matni` : 'Initial commit: README',
    content,
    ...(existing ? { sha: existing.sha } : {}),
  }),
});
const text = await res.text();
const ok = res.status === 201 || res.status === 200;
console.log(ok ? `✓ README.md ${existing ? 'yangilandi' : 'yaratildi'} (birinchi commit)` : `✗ HTTP ${res.status}: ${text.slice(0, 200)}`);
process.exit(ok ? 0 : 1);
