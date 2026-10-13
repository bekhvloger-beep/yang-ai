# YANG AI v4 — 2/3/4-bosqichlar hisoboti (2026-10-08)

Reja: [v4-takomillashtirish-rejasi.md](v4-takomillashtirish-rejasi.md). Bu hujjat bajarilgan ish,
o'zgargan fayllar va sinov natijalarini qisqa bayon qiladi.

## Umumiy natija

| Sinov | Buyruq | Natija |
| --- | --- | --- |
| Pin / zaxira zanjiri | `npm run test:pin` | **7/7 PASS** (46.7 s) |
| UI sinovi (CDP, real renderer) | `node scripts/ui_v4_test.mjs` | **13/13 PASS** + 4 skrinshot |
| Oqim sinovi (real lokal model + internet) | `node agent/test_v4_flow.mjs` | **6/6 PASS** |
| Sovuq smoke (real agent oqimi) | `AGENT_SMOKE=1 …` | **PASS** (exit 0) |
| Paketlash | `npx electron-builder --win --dir` | **exit 0**, asar ichida yangi UI tasdiqlandi |

Skrinshotlar: `_shots/ui_01_main.png`, `ui_02_settings_ui.png`, `ui_03_activity.png`, `ui_04_image_ad.png`.

## 2-bosqich — Agent faoliyati oqimi

- `agent/tools.js`: ikkita yangi tool — **`web_search`** (DuckDuckGo HTML; natija bo'lmasa Wikipedia zaxira)
  va **`fetch_url`** (sahifani o'qiladigan matnga aylantiradi). Ikkalasi ham kalitsiz, sof Node `fetch`.
- `agent/tools.js`: `findRecentFiles()` — `run_command` dan keyin workspace'da o'zgargan fayllarni topadi
  (masalan python skript yaratgan ikonka) va `tool` hodisasida `files[]` sifatida qaytaradi.
- `agent/engine.js`: har qadam boshida **`thinking`** hodisasi (💭), `tool` hodisasiga `ms` (davomiylik),
  `files` (yaratilgan fayllar) va `at` qo'shildi.
- `renderer/app.js`: ikonka-kartalar (💭 Thinking · 📖 O'qish · ✍️ Yozish · ⌨️ Buyruq · 🐍 Python ·
  🌐 Internet · 🖼 Rasm · 📑 Hujjat), bosilganda to'liq tafsilot (So'rov / Natija / yozilgan fayl mazmuni /
  ochish tugmalari), agent badge (nom + ikonka), **mini brauzer** kartasi (qidiruv manzili, sarlavha,
  natijalar — bosilsa brauzerda ochiladi), rasm natijasi uchun **data-URL preview**.
- O'ng paneldagi jonli oqim (`dockPush`/`dockUpdate`): har harakat ikonka, agent va davomiylik bilan.

## 3-bosqich — Premium interfeys

- `renderer/index.html` + `renderer/style.css` to'liq qayta yozildi: **hexagon SVG logo**, `#101423` fon +
  hex naqsh, `#6c8cff` / `#35c39a` aksentlar, gradient karkas, yangi kartalar va animatsiyalar.
- **O'ng faoliyat paneli** (`#dock`): yig'iladi/ochiladi (`#dockToggle`, `#dockClose`), butunlay o'chirish
  — Sozlamalar → Interfeys (localStorage: `yang_ui_panel`, `yang_ui_steps`, `yang_ui_anim`, `yang_ui_ads`, `yang_ui_side`).
- **Pastdagi bar**: model chipi (`#bbModel` → popup: provayder + modellar, bosilsa darhol almashadi),
  🤝 Jamoa, 📋 Reja.
- **Tepadagi agent ko'rsatkichi** (`#agentNow`: nom + ikonka + rol) va **aylana limit progressi**
  (`#quotaRing`, javob sarlavhalaridagi limitdan foiz yoki sessiya tokenlari).
- **Almashtirish animatsiyasi** (`#switchFx`): hexagon spin + progress — model/provayder saqlanganda.
- **Sozlamalar bo'limlari**: 🔌 Provayder / 🤖 Model / 🌐 Tarjima / 🎨 Interfeys / 🖥 Tizim.
  - Provayder: 3 qadamli ulash oqimi («🔌 Ulash va tekshirish» — serverdan model ro'yxatini olib tasdiqlaydi,
    kalit darhol saqlanadi), limit holati, maxsus provayderlar.
  - Tarjima: yoqish/o'chirish, manzil, maqsad til, holat tekshiruvi va sinov tarjimasi
    (yangi IPC: `translate:status`, `translate:test`).
  - Interfeys: panelni yoqish/o'chirish, animatsiyalar, qadamlar chatda ko'rinishi, reklama bannerlari, panel joyi.
- **Tepadan tushadigan kreativ reklama banneri** (`.rc-ad-drop` — badge, sarlavha, CTA, o'zi yig'iladi);
  admin `app-config.json` da `ad.style: "corner"` bersa eski suriladigan variant ishlaydi.
- **1 AI yakuniy javob**: jamoa rejimida oraliq agentlar matni chatga yozilmaydi (faqat o'ng panelda),
  yakuniy javobni bitta AI — **Lead** yozadi (`agent/team.js` yo'riqnomasi kuchaytirildi).

## 4-bosqich — Plan / Build

- `agent/engine.js`: `planFirst` (faqat reja, tool berilmaydi), `planText` (tasdiqlangan reja bilan qurish),
  reja qadamlarini ajratuvchi `parsePlanSteps()` va yangi **`plan`** hodisasi (main.js uni chatga saqlaydi).
  Reja rejimida javob uzunligi cheklangan (`max_tokens: 900`) — kichik lokal model tool'siz rejimda
  cheksiz gapirib ketmasligi uchun (o'lchov: cheklovsiz reja 4500+ tokenga cho'zilib ketgan holat kuzatildi).
- `renderer/app.js`: **📋 Plan** va **⚡ Build** tugmalari, reja kartasi (qadamlar ro'yxati,
  **🚀 Qurishni boshlash** + nusxalash), karta bosilganda ham qurish boshlanadi (`startBuild`).

## Aniqlangan va tuzatilgan nozik xatolar

1. `agent/tools.js`: DuckDuckGo protokol-nisbiy havola (`//duckduckgo.com/l/?uddg=…`) qaytarardi —
   `normalizeUrl` ularni rad etib, qidiruv doim Wikipedia zaxirasiga tushib qolardi (tuzatildi).
2. `renderer/app.js`: rasm preview `body.innerHTML=''` dan keyin kechikib qo'shilib, karta ikki marta
   chizilardi — chizish tokeni (`dataset.fillToken`) bilan tuzatildi.
3. `agent/engine.js`: `compactSystemPrompt` misolidagi tayyor javob matni ("Kalkulyator tayyor: …")
   kichik model tomonidan nusxalanardi (boshqa vazifada ham aynan shu javob chiqardi) — misol umumlashtirildi
   va «nusxalamang» ogohlantirishi qo'shildi. Qayta sinovda javob to'g'ri bo'ldi.
4. `main.js` smoke testi: 1.7B model `SMOKE_PASSED` belgisini javob o'rniga faylga yozsa ham PASS bo'ladi
   (yaratilgan `test.txt` mazmuni tekshiriladi) — flaky natija yo'qoldi.

## Ma'lum cheklovlar

- 1.7B lokal model ba'zan uzun matn yozishga "cho'zilib" ketadi (o'lchov: `~10 tok/s`, bir javob
  8192 token chegarasigacha). Bu model sifati bilan bog'liq; bulutli provayderlarda bunday holat yo'q.
  Reja rejimi yuqoridagi token chegarasi bilan himoyalangan.
  *(2026-10-08 holati: «cho'zilish» va degeneratsiya qo'shimcha choralar bilan tuzatildi —
  [v4-5-bosqich-hisobot.md](v4-5-bosqich-hisobot.md).)*

## Yakuniy holat (2026-10-08 yangilandi)

- **Reliz chiqarildi**: **3.9.6** — `npm run dist` + `npm run release` bilan GitHub'ga joylandi
  (4 asset: Setup + blockmap + Portable + `latest.yml`), shu bilan bu hujjatdagi «reliz yo'q» cheklovi
  yopildi.
- 1-bosqichning qolgan bandlari (lokal tool to'plamini kengaytirish, jamoaviy rejim sinxronligi) va
  5-bosqich (100 xil sinov, rasm yaratish) — **bajarildi**: [v4-5-bosqich-hisobot.md](v4-5-bosqich-hisobot.md).
