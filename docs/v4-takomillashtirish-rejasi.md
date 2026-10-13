# YANG AI v4 — takomillashtirish rejasi

Foydalanuvchi talablari (2026-10-07) bo'yicha bosqichlarga bo'lingan ish rejasi.
Har bosqich oxirida: `node --check` + tegishli test + real ilovada qo'lda sinov.

## 1-bosqich — Lokal AI va rejimlar (funksional poydevor)
- [x] Sabab aniqlandi: lokal modelga faqat 3 tool beriladi va `compactSystemPrompt` juda zaif —
      vazifani oddiy savol deb hisoblab, "salom, nima yordam?" deb javob berardi.
- [x] `compactSystemPrompt` qayta yozildi: vazifa/savol ajratiladi, "yasab ber" so'zi aniqlandi,
      misol ko'rsatiladi, salomlashish taqiqlanadi, oddiy suhbat uchun namuna beriladi.
- [x] Engine'ga "nudge" qo'shildi: model kodni chatda qoldirib fayl yozmasa, bir marta
      "endi write_file chaqir" deb qaytariladi (`needsFileNudge`, `this.nudgeLeft`).
- [x] O'zbekcha real sinov (real engine + real lokal model): **3/3 PASS**
      (kalkulyator → `kalkulyator.html` 1516 B; python → `count_files.py` 442 B; suhbat → toolsiz toza javob).
- [x] Lokal tool to'plami kengaytirildi: `list_dir`/`read_file`/`write_file` + **`run_command`**
      (qurib, ishga tushirib tekshirish) + **`create_image`** (PNG chizish) — `agent/engine.js`
      `LOCAL_TOOL_NAMES`; `compactSystemPrompt` «yozgan ishni ishga tushirib tekshiring» qoidasini oldi.
      Real sinov (`agent/test_v4_flow.mjs`, C qadami): lokal model 6 ta tool chaqirdi —
      `[write_file, run_command, write_file, write_file, write_file, create_image]` → 4 fayl yaratildi.
- [x] Model almashtirish (switch) va pin rejimi barqarorligi — pastdagi model chipi + switch animatsiyasi,
      `npm run test:pin` 7/7 PASS (pin rejim o'zgarmadi).
- [x] Lokal model «cho‘zilishi» tuzatildi (o‘lchov: tool’siz javob 5341 token ≈ 9 daqiqaga ketardi):
      `agent/providers.js` `streamChat` ga **matn guard’i** (`guardChars`) qo‘shildi — lokal provayderda
      matn 2600 belgidan oshsa va bitta ham tool chaqiruvi ko‘rilmasa, oqim to‘xtatiladi
      (`truncated: true`, UI’da «✂️ … oqim cheklandi» notisi); qo‘shimcha `max_tokens: 2048` (oddiy rejim).
      Real sinov: tasdiqlangan reja bilan qurish **168 s da yakunlandi** (avval qo‘lda to‘xtatilar edi).
- [x] Jamoaviy rejim sinxronligi: har bir agent ishga tushishdan oldin **«jamoa doskasi»** oladi
      (kim nima qiladi + hozirgacha tugagan ishlar) — `agent/team.js` `teamBoard`; planner
      har bir agentning faylini task ichida aniq belgilaydi; bir xil nomli agentlar `-2` bilan ajratiladi
      (sinov topgan xato: `results` Map'i dublikat nom tufayli bitta agent natijasini yo'qotardi).
      Sinov: `node agent/test_v5_team.mjs` — **6/6 PASS**.

## 2-bosqich — Agent faoliyati oqimi (Activity feed)  ✅ bajarildi
- [x] Har qadam uchun ikonka: 💭 Thinking, 📖 Read, ✍️ Write, ⌨️ Run/Code,
      🌐 Internet/Browser, 🐍 Python, 🖼️ Image.
- [x] Ikonka ustiga bosilganda: nima o'qidi/yozdi/qidirdi, to'liq tafsilot.
- [x] Har harakat qaysi agentga tegishli ekani ko'rinadi (nom + ikon).
- [x] Internetdan ma'lumot olishda kichik brauzer oynasi (nima qidirayotgani ko'rinadi).
- [x] Python natijasi (masalan yaratilgan fayl/ikonka) ochib ko'rsatiladi.
      → `renderer/app.js`: ikonka/nom xaritasi, `step-card` (thinking), `mini-browser`,
        `file-preview` (rasm data-URL), o'ng paneldagi jonli oqim (`dockPush`/`dockUpdate`).
      → `agent/tools.js`: yangi `web_search` (DuckDuckGo + Wikipedia zaxira) va `fetch_url` tool'lari;
        `findRecentFiles` — `run_command` dan keyin yaratilgan/o'zgargan fayllar (🐍 natijasi).
      → Sinov: `node scripts/ui_v4_test.mjs` (CDP UI sinovi) va `node agent/test_v4_flow.mjs`.

## 3-bosqich — Premium interfeys  ✅ bajarildi
- [x] Logo uslubidagi dizayn: hexagon SVG logo, #101423 fon + hex naqsh, #6c8cff / #35c39a aksent
      (`renderer/index.html`, `renderer/style.css`).
- [x] O'ng burchakda suriladigan/yig'iladigan faoliyat paneli — `#dock`, `#dockToggle`/`#dockClose`,
      butunlay o'chirish: Sozlamalar → Interfeys → «O'ng faoliyat paneli» (localStorage'da saqlanadi).
- [x] Pastda model va jamoaviy rejim tanlash: `.bottom-bar` — model chipi (`#bbModel` + popup), 🤝 Jamoa, 📋 Reja.
- [x] Tepada agent nomi + ikonkasi (`#agentNow`) va limit aylana progressi (`#quotaRing`, SVG ring).
- [x] Model/provayder almashish animatsiyasi — `#switchFx` (hexagon spin + progress bar).
- [x] Sozlamalar bo'limlarga ajratildi: 🔌 Provayder / 🤖 Model / 🌐 Tarjima / 🎨 Interfeys / 🖥 Tizim
      (`.set-tabs`, `.set-pane`, tarjima sinovi IPC'lari bilan).
- [x] API provayder ulash oqimi: 3 qadam (tanlash → kalit → «Ulash va tekshirish») — model ro'yxati
      serverdan olinib tasdiqlanadi, kalit darhol saqlanadi.
- [x] Tepadan tushadigan kreativ reklama banneri (`.rc-ad-drop`, CTA, o'zi yig'iladi) +
      Interfeys bo'limida o'chirish imkoni; eski suriladigan variant `ad.style==='corner'` bilan saqlandi.
- [x] 1 AI javoblarni yig'ib, to'liq yakuniy javob yozadi: jamoa rejimida oraliq agentlar matni chatga emas,
      panelga yoziladi; yakuniy xulosani faqat Lead (bitta AI) yozadi (`agent/team.js`, `renderer/app.js`).

## 4-bosqich — Plan / Build tugmalari  ✅ bajarildi
- [x] "📋 Plan" tugmasi → faqat reja tuzadi (tool'siz rejim), reja ostida "🚀 Qurishni boshlash" tugmasi
      (`agent/engine.js` — `planFirst`, `PLAN_MODE_EXTRA`, `parsePlanSteps`, `plan` hodisasi).
- [x] "⚡ Build" tugmasi → darhol qurish (oddiy agent oqimi).
- [x] Plan natijasi bosilganda reja bo'yicha ish boshlanadi: karta bosilsa yoki «Qurishni boshlash»
      bosilsa, reja `planText` sifatida engine'ga uzatiladi (`startBuild` → `send({planText})`).
- [x] Real sinov: `node agent/test_v4_flow.mjs` — reja (tool'siz) va tasdiqlangan reja bilan qurish.

## 5-bosqich — Jamoaviy rejim sinovlari  ✅ bajarildi
- [x] O'zbekcha 100 xil reja tuzdirish va 100 xil vazifa bajarish sinovi — `agent/test_v5_batch.mjs`
      (20 mavzu × 5 maqsad; vazifalar: 25 chat, 40 fayl, 20 ishga-tushirish, 15 rasm; `--resume`/`--only-failed`).
      **Yakuniy natija: rejalar 100/100, vazifalar 100/100** (o'rtacha 34,5 s / 28,5 s).
      Chetlama qayta urinishlar: 1 reja + 36 vazifa; sabablar tahlil qilinib tuzatilgach ular ham PASS.
- [x] Agentlar sinxronligini tekshirish — `agent/test_v5_team.mjs` (**6/6 PASS**):"jamoa doskasi",
      planner taqsimoti, provayder tayinlash, fayllar, reviewer tartibi, yakuniy javob faqat Lead'da.
- [x] Rasm yaratish funksiyasi — `agent/test_v5_image.mjs`: `create_image` offline va lokal model bilan
      haqiqiy PNG (200x200); AI `generate_image` zanjiri hisob kvotasi tugagani uchun SKIP (sabab logda).
- [x] Lokal model degeneratsiyasi/«cho'zilishi» (C qadam) — matn guard'i + token chegarasi + **DRY sampler**,
      takroriy tool chaqiruvini to'sish, tool JSON buzilsa qisqa-JSON bilan qayta urinish va
      **toolsiz yakuniy javob**; `node agent/test_v4_flow.mjs` — **6/6 PASS** (208 s).
      Batafsil: [v4-5-bosqich-hisobot.md](v4-5-bosqich-hisobot.md).
