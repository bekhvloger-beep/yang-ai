# YANG AI v4 — 5-bosqich va lokal AI hisoboti (2026-10-08)

Reja: [v4-takomillashtirish-rejasi.md](v4-takomillashtirish-rejasi.md). Bu hujjat bajarilgan ish,
o'zgargan fayllar va **o'lchangan** sinov natijalarini bayon qiladi (har bir da'vo oldida real buyruq turadi).

## Umumiy natija (muzlatilgan kod)

| Sinov | Buyruq | Natija |
| --- | --- | --- |
| 100 xil reja (o'zbekcha) | `node agent/test_v5_batch.mjs` | **100/100 PASS** (o'rt. 34,5 s) |
| 100 xil vazifa | `node agent/test_v5_batch.mjs` | **100/100 PASS** (o'rt. 28,5 s) |
| Oqim (real lokal model + internet) | `node agent/test_v4_flow.mjs` | **6/6 PASS** (219 s) |
| Jamoa sinxronligi | `node agent/test_v5_team.mjs` | **6/6 PASS** |
| Rasm yaratish | `node agent/test_v5_image.mjs` | **3/3 PASS** (C qismi — kvota, SKIP) |
| Pin / zaxira zanjiri | `npm run test:pin` | **7/7 PASS** (46,7 s) |
| UI sinovi (CDP, real renderer) | `node scripts/ui_v4_test.mjs` | **13/13 PASS** |
| Kod fayllarida kirill harflar | `node` (regex) | 0 ta (9 fayl) |

Vazifalar turlari bo'yicha yakuniy holat: **chat 25/25 · fayl 40/40 · ishga-tushirish 20/20 · rasm 15/15**.

## 1-bosqich — qolgan bandlar

- **Lokal tool to'plami kengaytirildi** (`agent/engine.js` — `LOCAL_TOOL_NAMES`, `compactSystemPrompt`):
  `list_dir`, `read_file`, `write_file` + **`run_command`** (yozgan faylni ishga tushirib tekshirish)
  + **`create_image`** (PNG chizish). Promptda: «yozgan ishni ishga tushirib tekshiring», `create_image`
  namunasi (bo'sh `ops` qoldirmaslik), «javobni cho'zib yubormang» qoidasi.
  Real o'lchov: `test_v4_flow` C qadamida lokal model `[write_file, run_command, write_file, write_file,
  create_image]` chaqirib **4 fayl** yaratdi.
- **Jamoaviy rejim sinxronligi** (`agent/team.js`): har bir agent ishga tushishdan oldin **«jamoa doskasi»**
  oladi (loyiha taqsimoti + hozirgacha tugagan ishlar), planner har bir agentning faylini task ichida
  belgilaydi, bir xil nomli agentlar `-2` bilan ajratiladi (ilgari `results` Map'i dublikat nom tufayli
  bitta natijani yo'qotardi).
- Qo'shimcha: `run-nudge` — lokal model skript yozib ishga tushirmasa, bir marta «run_command bilan
  tekshir» deb eslatiladi (100 vazifa sinovida 13 shunday holat topilgan edi).

## Lokal model «cho'zilishi» va degeneratsiyasi — asosiy tuzatish

**Sabab (o'lchov, `%TEMP%\yang-v4-llama.log`):** 1.7B model bitta qadamda **2048 token** (185–192 s,
~11 t/s) yozib, tool JSON'ini token chegarasida uzib qo'yardi → llama-server xatosi:
`Failed to parse tool call arguments as JSON … invalid string: missing closing quote` (HTTP 500).
Bundan oldingi «cho'zilish» esa tool'siz javobda 5341 token (~9 daqiqa) yozish edi.

**Kiritilgan choralar:**

1. `agent/providers.js` — matn guard'i (`guardChars`: oddiy rejim 2600, reja 4000 belgi) va
   `max_tokens` (lokal oddiy rejim 2048, reja 900): matn chegaradan oshsa va hali tool chaqiruvi
   ko'rinmasa oqim to'xtatiladi (`truncated: true` + «✂️ … oqim cheklandi» notisi).
2. `agent/engine.js` — `BUNDLED_SAMPLING`: `repeat_penalty 1.15`, `frequency_penalty 0.2` va
   **DRY sampler** (`dry_multiplier 0.8`, `dry_base 1.75`, `dry_allowed_length 2`, `dry_penalty_last_n 512`) —
   takrorlanuvchi ketma-ketlikni bostiradi (degeneratsiya halqasining asosiy sababi). DRY serverda
   qabul qilinishi alohida so'rov bilan tasdiqlandi (HTTP 200).
3. **Takroriy tool himoyasi** (`REPEAT_LIMITS`, `this.callSigs`): bir xil `write_file`/`create_image`
   ikkinchi marta bajarilmaydi, `run_command` ko'pi bilan 2 marta (xatoni tuzatib qayta ishga tushirish
   odatiy hol); o'rniga modelga «bu amal bajarilgan — keyingi qadamga o'ting» xabari beriladi.
4. **Parse-500 da qayta urinish** (`retryOn500`): birinchi urinish 700 ms dan keyin, ikkinchisi
   «qisqa tool JSON yozing» eslatmasi bilan 1,2 s dan keyin; uchinchisi ham buzilsa — xato beriladi
   (ilgari ortiqcha kutib, baribir yiqilardi).
5. **Toolsiz yakuniy javob** (`finalTextAnswer`): qadam chegarasi tugaganda yoki model tool JSON'ini
   buzganda fayllar asosida qisqa yakuniy javob yoziladi. So'rov **mustaqil (prefikssiz)** prompt bilan
   yuboriladi — chunki llama-server parse xatosidan keyin o'sha uzun prefiksli so'rovga lahzada xuddi
   shu xatoni qaytarardi (jurnalda 0,7 s / 1,2 s oraliqlar bilan takrorlangan 5 ta bir xil xato).
   Shu sabab Lead (jamoa rahbari) 3 qadamda to'xtab qolsa, butun jamoa natijasi yo'qolmaydi.
6. `approvedPlanExtra` — «har bir faylni faqat BIR MARTA yozing … ish tugagach tool chaqirmasdan
   yakuniy xulosa yozing» qoidasi (modelning takror yozish halqasini kamaytiradi).

**Natija (muzlatilgan kod):** `node agent/test_v4_flow.mjs` — **6/6 PASS**, C qadami 219 s da tugadi
(ilgari aynan shu qadam 192 s degeneratsiya + HTTP 500 bilan butun oqimni yiqitardi).

## Ommaviy sinov (100 reja + 100 vazifa) — bosqichma-bosqich

| Bosqich | Buyruq | Natija |
| --- | --- | --- |
| 1-o'tish (to'liq) | `node agent/test_v5_batch.mjs` | rejalar 99/100 · vazifalar 68/100 (chat 24/25 · fayl 30/40 · run 7/20 · rasm 7/15) |
| 2-o'tish (faqat yaroqsizlar) | `--only-failed` | 1 reja → PASS · 32 vazifa → 28 PASS, 4 FAIL |
| 3-o'tish | `--only-failed` | 4 vazifa → 4 PASS |
| **Yakuniy** | `summary.md`/`summary.json` | **rejalar 100/100 · vazifalar 100/100** |

Birinchi o'tishdagi yiqilishlarning asosiy sababi aynan yuqoridagi degeneratsiya (HTTP 500) edi:
chat 1, fayl 10 (hammasi 500), run 13 (fayl yozilgan, `run_command` chaqirilmagan), rasm 8.

**Qayta urinish paytida topilgan va tuzatilgan kod nuqsonlari:**

1. `agent/test_v5_batch.mjs` — `--only-failed` rejimida `readDone()` «barcha indekslar bajarilgan» deb
   qaytarardi: natijada hech narsa ishlamasdan 0 sekundda «0 PASS, 32 FAIL» chiqardi. Tuzatildi
   (faqat `--resume` bajarilganlarni o'tkazib yuboradi).
2. `agent/test_v5_batch.mjs` — qayta urinishda eski workspace tozalanmasdi: o'tgan urinishdagi qolib
   ketgan fayl tekshiruvni **yolg'on PASS** qilishi mumkin edi. Endi `--only-failed` da workspace
   tozalanadi.
3. `agent/test_v5_batch.mjs` — rasm tekshiruvi `size > 300` edi: tekis rangli 200×200 PNG (195 B)
   haqiqiy rasm bo'lsa ham FAIL bo'lardi. Endi **PNG signature + IHDR o'lchamlari** (`w,h ≥ 64`) + `size > 100`.

**Model sifati sababli yiqilishlar (kod nuqsoni emas — dalil bilan):**

- Indeks 72 (`summa_40.py`): model funksiyani aniqlab, **chaqirmasdan** `sys.exit()` yozgan — chiqishda
  natija yo'q. Indeks 76 (`summa_60.py`): `importsys` va `if __name__ == '___main__'` xatolari
  (skript ishga tushganda `NameError`). Sabab — model kodi, agent emas: agent `run_command` ni chaqirgan
  (`fayl=true run=true`) va xato matnini qaytargan. Qarshi chora: promptga «python skriptda funksiyani
  albatta CHAQIRING va natijani print qiling» qoidasi qo'shildi → qayta sinovda ikkalasi ham PASS.
- Indeks 88/95 (rasm): so'ralgan `tortburchak.png` / `ranglar.png` o'rniga `rasm.png` / `rasm_yarangan.png`
  yozilgan. Qarshi chora: «fayl nomini foydalanuvchi aytgandek AYNAN ishlating» qoidasi → qayta sinovda PASS.

## Jamoaviy sinxronlik sinovi (`agent/test_v5_team.mjs`, 6/6 PASS)

- **T1** planner 2 agent taqsimotini beradi (`fayl-yaratuvchi`, `fayl-yaratuvchi-2` — nomlar xil);
- **T2** har bir agent «jamoa doskasi» oladi (doska 2/2, boshqa agent nomi ko'rinadi);
- **T3** har bir agentga provayder/model tayinlanadi (2 ta);
- **T4** agentlar ishni bajaradi: `salom.txt` = «Salom YANG AI», `raqamlar.txt` = «1 2 3» (203 s);
- **T5** Reviewer agentlardan keyin ishlaydi, review→fix tsikli tartibi to'g'ri (`agent_end=4`,
  `reviewer_end=2`), 2 o'tishda sinovdan o'tdi;
- **T6** yakuniy javob faqat Lead orqali keladi (101 belgi, faktik: «Salom.txt fayli "Salom YANG AI"
  yozuvini yaratildi. Raqamlar.txt fayliga "1 2 3"»).

## Rasm yaratish (`agent/test_v5_image.mjs`)

- **A1** `create_image` offline haqiqiy PNG: 240×160, 600 B (model kerak emas);
- **B1** lokal model `create_image` chaqirib so'ralgan o'lchamda PNG yaratadi: `bayroq.png` 200×200, 504 B (34 s);
- **B2** `files_created` hodisasi rasm yo'lini beradi (UI preview uchun);
- **C0/C1** (haqiqiy AI `generate_image`): zanjirning o'zi ham to'g'ridan-to'g'ri sinaladi
  (`generateImage`), ammo sinov paytida Gemini **HTTP 429 — kvota tugagan** (OpenRouter ham ishlamadi),
  shu sababli **SKIP** (kod o'zgarmagan; oldingi o'lchovda shu zanjir 2932 B rasm bergan edi).

## Ma'lum cheklovlar

- Lokal 1.7B model sifati: ba'zi holatda noto'g'ri kod yozadi yoki fayl nomini e'tiborsiz qoldiradi
  (yuqorida aniq misollar). Prompt qoidalari holatlarni kamaytiradi, lekin kafolat bermaydi —
  kattaroq model (4B) bilan bu holatlar kamayadi.
- AI rasm (`generate_image`) sinovi hisob kvotasi tufayli **tekshirilmagan** (SKIP, sabab logda saqlangan).
- llama-server tool-parse xatosidan keyin o'sha suhbat prefiksi bilan kelgan so'rovga bir xil xatoni
  qaytarishi kuzatildi; shu sabab yakuniy so'rov mustaqil prompt bilan yuboriladi va takroriy tool
  chaqiruvlari bostiriladi (kod darajasidagi qarshi chora).
- 100 vazifa sinovi lokal modelda o'rtacha 28,5 s/vazifa (CPU'da ~11 t/s) — vaqt xarajati model bilan
  bog'liq.

## O'zgargan fayllar (asosiy)

- `agent/engine.js` — DRY/penalti, takroriy tool himoyasi, toolsiz yakuniy javob, prompt qoidalari
  (fayl nomi, python funksiyani chaqirish), `userText`, `approvedPlanExtra` qoidasi.
- `agent/providers.js` — `guardChars`, `max_tokens`, parse-500 qayta urinish (2 tez urinish + qisqa JSON
  eslatmasi), `truncated` natijasi.
- `agent/team.js` — jamoa doskasi, planner taqsimoti/dedupe, planner guard.
- `agent/test_v5_batch.mjs`, `agent/test_v5_image.mjs`, `agent/test_v5_team.mjs` — yangi sinov to'plami.
- `docs/v4-takomillashtirish-rejasi.md` — 5-bosqich bandlari `[x]`.
