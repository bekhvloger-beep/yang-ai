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

1. **Python debuggeri yo‘q** — qadamlab debug JS fayllar uchun (Node inspector). Python uchun
   hozircha sintaksis + (bo‘lsa) `pyflakes` tekshiruvi ishlaydi.
2. **Python tip tekshiruvi** shartli: `pyflakes` o‘rnatilgan bo‘lsa ishlaydi (pyright/mypy hali yo‘q).
3. **Bitta ish papkasi** — bir vaqtda bitta loyiha ochiladi (ko‘p ildizli workspace yo‘q).
4. **512 MB xotira himoyasi** — undan katta fayl tashqi ilovada ochiladi (ilova qotmasligi uchun).
5. **Lokal model sifati** — 2B model 4 vazifadan 3 tasini bajaradi; murakkab refaktoring uchun
   Ollama’dagi `qwen2.5-coder:7b` tavsiya etiladi (4/4).
6. **Windows’ga yo‘naltirilgan** paketlash (`nsis`/`portable`); macOS/Linux uchun yig‘ilmagan.

## 10. Keyingi qadamlar (taklif)

- `run_command` uchun PATH’ga ilova ichidagi node shim’ini qo‘shish — `node script.js` ham
  Node o‘rnatilmagan PC’da ishlashi uchun.
- Git paneli (status/diff/commit) — hozircha faqat tashqi terminal.
- Python uchun to‘liq til xizmati (`pyright`/`pylsp`) va qadamlab Python debuggeri.
- Ko‘p ildizli (multi-root) workspace — bir vaqtda bir nechta loyiha papkasi.

## 12. v5.4 — cheklovlarni tuzatish (o‘lchov bilan)

### 12.1 Nima qo‘shildi / o‘zgardi

| Qatlam | Fayl | Nima qiladi |
|---|---|---|
| Haqiqiy terminal | `ide/ide_pty.js` + `ide/vendor/xterm.js` | ConPTY orqali psevdo-terminal; baytlar o‘zgarishsiz oqadi, xterm.js ekranga chizadi. `vim`, `top`, `ssh`, REPL ishlaydi. PTY yuklanmasa — eski quvur rejimi (fallback) |
| Til xizmati | `ide/ide_lsp.js` | TypeScript serveri (`tsserver`) — semantik diagnostika, F12 ta’rif, Shift+F12 havolalar, hover. `ELECTRON_RUN_AS_NODE` bilan ilovaning o‘z exe’si orqali ishlaydi. Python: `pyflakes` bo‘lsa semantik, aks holda sintaksis |
| Debugger | `ide/ide_debug.js` | Node inspector (CDP): `--inspect-brk`, nuqtalar (`Debugger.setBreakpointByUrl`), qadamlar, chaqiruvlar, scope o‘zgaruvchilari, konsol ifodasi. Kirish to‘xtashi avtomatik o‘tkazib yuboriladi |
| Yurish + Tarix + AI tuzatish | `ide/ide_runner.js` | Har yurish tarixga yoziladi (buyruq, kod, vaqt, chiqish oxiri). «Sinab ko‘r + tuzat» halqasi: yurit → xato → modelga **muammoli fayl matni + butun tarix + diagnostika** bilan yubor → qayta yurit (3 martagacha). Bitta urinishga AI qadam chegarasi qo‘yilgan (10) — lokal model aylanib qolsa, vaqt behuda ketmaydi |
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
| `agent/engine.js`, `agent/team.js`, `agent/tools.js` | AI qatlami (IDE va chat bir xil dvigateldan foydalanadi) |
| `reports/local_ai/local-ai-hisobot.md` | Lokal modellar o‘lchovi (jadval, tavsiya) |
