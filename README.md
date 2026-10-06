# YANG AI

**Professional desktop agentic assistant** — aicomp.uz

YANG AI — foydalanuvchi kompyuterida ishlaydigan ZCode/Codex-uslubidagi agentic yordamchi:

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

- O'rnatuvchi hajmi **~1.65 GiB** (Setup: 1 773 392 365 B; Portable: 1 773 131 943 B). Ichida: Qwen3-1.7B modeli (1.05 GiB), NLLB tarjimon (631 MB) va llama.cpp runtime.
- **Nima uchun 4B emas:** NSIS o'rnatuvchi formati 2 GiB dan katta paketni yiga olmaydi — 4B model bilan paket 3.6 GB bo'lib, build yiqilgan. Shuning uchun paketga 1.7B model kiritildi (har qanday zamonaviy PC'da ishlaydi). Kompyuterda `model-4b.gguf` bo'lsa va RAM 8 GB+ bo'lsa, ilova avtomatik o'sha kattaroq modelni tanlaydi.
- Windows 10/11 x64.

---
© AICOMP.UZ — barcha huquqlar himoyalangan.
