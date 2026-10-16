# YANG IDE — YANG AI ichidagi to‘liq kod muharriri

Bu hujjat YANG IDE ichida nima borligini va u qanday qatlamlardan yig‘ilganini tushuntiradi.

**Ikki rejim, bitta yadro** (`ide/ide_host.js`):

| Rejim | Qanday ochiladi | Jarayon |
|---|---|---|
| **YANG AI ichida (asosiy)** | Yon paneldagi **«YANG IDE»** tugmasi yoki **Fayl → YANG IDE oynasi** (`Ctrl+Shift+I`) | YANG AI ning o‘z jarayoni (`embedded: true`) — alohida o‘rnatuvchi kerak emas |
| Mustaqil dastur (ixtiyoriy) | `npm run start:ide` / `YANG-IDE-Setup-*.exe` (`npm run dist:ide`) | O‘z jarayoni (`embedded: false`) |

Ikkala rejim ham YANG AI bilan **bitta sozlamalar papkasini** (`%APPDATA%/yang-ai`) bo‘lishadi:
API kalitlar, provayderlar va tanlangan model bir xil.

To‘liq hisobot (nima qila oladi, nima uchun kerak, lokal AI integratsiyasi, o‘lchovlar,
cheklovlar): [`docs/YANG-IDE-hisobot.md`](../docs/YANG-IDE-hisobot.md).

## Qatlamlar

| Qatlam | Fayl | Nima qiladi |
|---|---|---|
| GUI qobig'i | `ide/ide_host.js` + `ide/renderer/*` | Oyna, panel, tablar — Chromium + Node, xuddi VS Code/Cursor kabi |
| Muharrir dvigateli | `ide/renderer/app.js` | Qator raqamlari, sintaksis bo'yash (`<pre>` + shaffof `<textarea>` qatlami), avtomatik to'ldirish, qavs juftligi, Tab/Shift+Tab, Ctrl+/ izoh, topish/almashtirish |
| Til xizmati (semantik) | `ide/ide_lsp.js` | TypeScript serveri (`tsserver`): yo'q funksiya/noto'g'ri tur kabi **semantik xatolar**, `F12` haqiqiy ta'rif, `Shift+F12` barcha havolalar, `hover` (tur/imzo). Ilovaning o'z exe'si `ELECTRON_RUN_AS_NODE` rejimida yuritadi — foydalanuvchida Node bo'lmasa ham ishlaydi |
| Python tip tekshiruvi | `ide/ide_lsp.js` → `pythonLint()` | Zinapoya: **pyright** → **mypy** → **pyflakes** → yo'q (sintaksis rejimi). Tur xatolari ham ko'rinadi (`natija: str = ikki(2)` → `Incompatible types in assignment … [assignment]`). Tanlov `detectPyEngine()` da bir marta o'lchanadi. Yo'l kerak bo'lsa: `YANG_IDE_PYTHON`, `YANG_IDE_PYRIGHT`, `YANG_IDE_MYPY`. `mypy` keshi tizim vaqt papkasiga yoziladi (Program Files'da ham ishlaydi) |
| Ko'p ildizli ish papkasi | `main.js` + `ide/ide_host.js` | Asosiy papkadan tashqari qo'shimcha papkalar (`config.json → extraRoots`, ikki oyna uchun bitta manba). Yon panelda «+ papka», IDE yon ustunida chip + ✕. **Qamoq o'zgarmaydi**: har bir yo'l `realpath` bo'yicha ruxsat etilgan ildizlar ichida tekshiriladi |
| Til xizmati (sintaksis) | `ide/ide_host.js` → `diagnosticsSync()` | Python: `compile()`, JS: `node --check`, JSON: `JSON.parse` — tezkor zaxira qatlami (til xizmati ishlamasa ham xato topiladi) |
| Haqiqiy terminal | `ide/ide_pty.js` + `ide/vendor/xterm.js` | ConPTY orqali psevdo-terminal + xterm.js ekrani. `vim`, `top`, `ssh`, REPL ishlaydi (`isatty()` → True). PTY yuklanmasa eski quvur rejimi |
| Debugger | `ide/ide_debug.js` | Node inspector (CDP): nuqtalar, qadamlar, chaqiruvlar, o'zgaruvchilar. `--inspect-brk` kirish to'xtashi avtomatik o'tkazib yuboriladi |
| Yurish + Tarix + AI tuzatish | `ide/ide_runner.js` | Har yurish logga yoziladi; «Sinab ko'r + tuzat» xato bo'lsa modelga TARIX + diagnostika berib qayta yuritadi |
| I/O va OS | `ide/ide_host.js` → `fs`, `fs.watch`, `shell.trashItem` | Fayl o'qish/yozish, papka kuzatuvchisi (tashqaridan o'zgargan fayl ochiq tabda yangilanadi), o'chirish savatga. Barcha yo'llar ish papkasiga qamalgan |
| Terminal | `ide/ide_host.js` → `spawn` | Buyruqlar oqim (stream) bilan, ANSI ranglar renderer'da `span`ga aylanadi. `cd` terminal sessiyasi cwd'ini o'zgartiradi. Windows'da buyruq `cmd.exe /d /s /c "…"` ko'rinishida yuboriladi (`windowsVerbatimArguments`) — qo'shtirnoqli yo'llar ham ishlaydi |
| Faylni ishga tushirish | `ide/ide_host.js` → `runtimeFor()` | `.js/.mjs/.cjs` → electron.exe **Node rejimida** (`ELECTRON_RUN_AS_NODE=1`), `.py` → python, `.ps1`/`.bat`/`.sh` → mos qobiq, `.html` → brauzer |
| Xato havolalari | `ide/ide_host.js` → `parseErrorLinks()` | Xato chiqishidan `fayl:qator` havolalarini ajratib beradi — bosilsa o'sha qatorga o'tadi (qadamlab debugger esa alohida, `ide/ide_debug.js` da) |
| AI qatlami | `ide/ide_host.js` → `agent/engine.js`, `agent/team.js` | YANG AI dvigateli: fayl o'qish/yozish, buyruq ishga tushirish, jamoa rejimi (planner → agentlar → reviewer → fixer → lead) |
| **Lokal AI menejeri** | `ide/ide_models.js` + `local-ai/catalog.json` | Yuqori paneldagi **«Lokal AI»** tugmasi: apparat profili (RAM/VRAM/disk/CPU va umumiy daraja), model katalogi (hajm, **minimal talablar**, **o'lchangan kuch** ★, **shu kompyuterdagi natija** → ★), oqim bilan **yuklab olish** (progress, bekor qilish, hajm tekshiruvi, arxivni ochish), kompyuterda **allaqachon bor AI** ni topish (Ollama / LM Studio / HuggingFace keshi) va bir bosishda ulash |
| **Lokal rasm (API emas)** | `agent/local_sd.js` → `local-ai/sd/lc-vulkan/sd-cli.exe` | `stable-diffusion.cpp` + SD 1.5 (2.1 GB): matn → rasm internet, API kaliti va kvotasiz. Vaqt taxmini yaratishdan **oldin** ko'rsatiladi (o'lchandi: 256×256 · 6 qadam = 9.5 s; 512×512 · 20 qadam = 168 s, Radeon RX 580/Vulkan). `agent/imagegen.js` endi birinchi navbatda LOKAL ni sinaydi, bulut zanjiri zaxira |
| **«To'xtatish» tugmasi** | `ide/renderer/app.js` → `stopAll()` | Ishlab turgan dastur, AI vazifasi yoki tuzatish halqasi bitta tugma (va Esc) bilan to'xtaydi — nima ishlayotgani tugmada yozib turadi |
| Lokal model | `ide/ide_host.js` → `ensureLocalServer()` / `startLlamaServer()` | Ilova ichidagi `llama-server.exe` + gguf ko'tariladi, port javob berguncha kutiladi. YANG AI allaqachon ko'targan bo'lsa **qayta ko'tarilmaydi**. Kontekst zinapoyasi 8192 → 4096 → 2048: RAM band bo'lib KV kesh ajratilmasa, keyingi kichikroq o'lcham sinaladi |

## Qaysi lokal model (o‘lchovga asoslangan)

Ilova ichida **Qwen3.5-2B Q4_K_M** (`local-ai/model-qwen3.5-2b-q4_k_m.gguf`, 1.2 GB) keladi.
Tanlov tasodifiy emas — `agent/bench_ide_assisted.mjs` to'rt vazifada (factorial, slugify, fizzbuzz,
median_bug) har modelni ikki rejimda sinaydi: `one-shot` (bir marta yozadi) va `ide-loop`
(tekshiruv ishga tushadi, xato modelga qaytariladi, u tuzatadi).

| Model | Hajm | One-shot | IDE halqasi bilan | O‘rtacha (IDE) |
|---|---|---:|---:|---:|
| qwen2.5:7b (Ollama) | 4.4 GB | 4/4 | **4/4** | 71s |
| qwen2.5-coder:7b (Ollama) | 4.4 GB | 2/4 | **4/4** | 75s |
| **qwen3.5-2B q4_k_m (ilova ichida)** | **1.2 GB** | **3/4** | **3/4** | 100s |
| qwen2.5-coder:3b (Ollama) | 1.8 GB | 2/4 | 3/4 | 93s |
| qwen3-4B (ilova ichida) | 2.3 GB | 2/4 | 3/4 | 133s |
| qwen2.5:0.5b (Ollama) | 0.4 GB | 0/4 | 0/4 | — |
| llama3:8b (Ollama) | 4.3 GB | 0/4 | 0/4 | — |

To‘liq jadval, xato chiqishlari va tavsiya: `reports/local_ai/local-ai-hisobot.md`.

### v5.6 — menejer hamma joyda, cheklovsiz va admin boshqaradi

| Nima | Qayerda |
|---|---|
| Menejerni ochish | Menyu qatori **«Lokal AI»** → «Lokal AI menejeri» (**Ctrl+Shift+M**), «Kompyuterda bor AI», «Lokal rasm modellari», «Ovoz modeli»; **Sozlamalar → Lokal AI** bo‘limi; yon paneldagi «Lokal AI» tugmasi |
| Cheklov | **«Ishlamaydi» holati OLIB TASHLANDI**: resurs yetmasa `warn` + «baribir yuklab olish mumkin», moslik yulduzi kamida 1 (`ide/ide_models.js`) |
| Kod rejimi (Kod AI) | Sozlamalar → Lokal AI, pastdagi **«Kod»** tugmasi yoki menyu belgisi → `agent/engine.js` `CODING_MODE_EXTRA` (to‘liq fayl, ishga tushirib tekshirish, minimal o‘zgarish) |
| Model tavsifi (relizsiz) | Admin Desk → **«🧠 Lokal AI»** → model qo‘shish/o‘chirish/tahrirlash → **⬆ Nashr qilish**; ilova 30 daqiqada GitHub’dagi `local-ai/catalog.json` ni olib, paketdagi katalog **ustiga** qo‘yadi (`agent/remote_catalog.js`) |
| Model tavsifi MAHALLIY | Har bir yozuvdagi `notes`/`strength`/`measured` — `local-ai/catalog.json` da; «O‘lchash» tugmasi o‘lchangan natijani `%APPDATA%/yang-ai/models/measured.json` ga yozadi |

**Tanlash tartibi `ide/ide_host.js` da (v5.5.1 da o‘zgardi).** Ilgari qattiq ro‘yxat bor edi
(qwen3.5-2B → 1.7B → 4B → 0.5B) va foydalanuvchi «Lokal AI» menyusidan 7B yuklab olsa ham u
**ishlatilmasdan** qolardi — ro‘yxatning birinchi (kichik) fayli topilardi. Endi mavjud
**hamma** gguf ballanadi (katalogdagi o‘lchangan ball, aks holda hajm) va RAM ga sig‘adiganlar
ichidan **eng yuqori ballisi** tanlanadi: `fayl hajmi ≤ RAM × 0,45` (model + KV kesh + OS).
Hech biri sig‘masa — eng kichigi + ogohlantirish.

## Lokal AI: nima yuklab olinadi va qancha joy kerak

Katalog — `local-ai/catalog.json` (kod, commit qilinadi). Har bir yozuvda hajm, minimal
RAM/VRAM/disk, o'lchangan kuch va manba bor. Yuklangan modellar **`%APPDATA%/yang-ai/models`**
(paketdagi `Program Files` yozib bo'lmaydi), ilova bilan kelgani `resources/local-ai` da qoladi;
qidiruv ikkalasini ko'radi. Og'ir binarlar (`local-ai/sd/`, `local-ai/lc/`, `*.gguf`) git'ga
kirmaydi — `.gitignore` da.

| Nima | Hajm | Minimal | Kuch (o'lchov) |
|---|---|---|---|
| Rasm dvigateli (stable-diffusion.cpp, Vulkan) | 30 MB | 2 GB RAM | CUDA kerak emas — AMD/Intel/NVIDIA |
| Rasm dvigateli (CPU zaxira) | 17 MB | 2 GB RAM | har qanday kompyuterda, sekin |
| SD 1.5 fp16 (eng kichik ishonchli) | 2.1 GB | 6 GB RAM · 2 GB VRAM | 20 qadam, sifat o'rtacha |
| DreamShaper 8 (bir xil hajm, sifatliroq) | 2.1 GB | 6 GB RAM · 2 GB VRAM | 25 qadam |
| SD-Turbo (1–4 qadam) | 5.2 GB | 8 GB RAM · 3 GB VRAM | juda tez, fayl katta |
| Qwen3.5 2B (ilova ichida bor) | 1.2 GB | 4 GB RAM | 3/4 vazifa · 99.6 s |
| Qwen2.5-Coder 7B (eng kuchli kod) | 4.4 GB | 8 GB RAM | **4/4 vazifa** · 75 s |
| Qwen2.5-Coder 3B | 2.0 GB | 6 GB RAM | 3/4 vazifa · 93.4 s |
| Qwen2.5 0.5B | 0.5 GB | 2 GB RAM | 0/4 — faqat suhbat/izoh |

Rasm vaqtining o'lchovi (Radeon RX 580 4 GB / Vulkan, shu loyihada o'lchandi):
**256×256 · 6 qadam = 9.5 s**, **512×512 · 20 qadam = 168 s** (7.4 s/qadam — 4 GB VRAM to'lgani
uchun o'sish chiziqli emas). Menyu shu ikki nuqtadan taxminiy vaqtni oldindan ko'rsatadi.

## Xavfsizlik

- Barcha fayl amallari **ruxsat etilgan ildizlarga qamalgan**: yo'l `insideWorkspace()` +
  `insideAnyRoot()` (asosiy papka va foydalanuvchi qo'shgan qo'shimcha papkalar) orqali tekshiriladi;
  `..` yoki ruxsat etilmagan absolyut yo'l rad etiladi. Qo'shimcha papka **faqat papka tanlash
  oynasida tanlanadi** (renderer yo'l bera olmaydi) va `realpath` bilan filtrlanadi.
- Havola (junction/symlink) orqali chetga chiqish ham yopilgan: `main.js` dagi `insideWorkspace()`
  ikkala tomonni `fs.realpathSync.native` bilan haqiqiy yo'lga keltiradi — ish papkasi ichidagi
  havola `C:\Windows\win.ini` kabi faylni ko'rsata olmaydi (daraxtda ko'rinmaydi, `walk` ham kirmaydi).
  Terminal (PTY) ish papkasi ham xuddi shu tekshiruvdan o'tadi. Sinov: `node agent/test_security_attacks.mjs`
  (**14 hujum** — absolyut yo'l, `..`, `%2e%2e`, UNC, junction, o'z-o'ziga havola, PTY `cwd`,
  debugger/LSP yo'li, chetga yozish/yaratish/qayta nomlash/o'chirish, **qo'shimcha ildizdan chiqish**
  va **ro'yxatdan begona yo'l bilan olib tashlash**).
- Renderer'da `nodeIntegration: false`, `contextIsolation: true`; faqat `preload.cjs` oshkor
  qilgan 61 ta metod mavjud (`window.ide.*`).
- O'chirish `shell.trashItem` (savat) orqali — qaytarib olish mumkin.
- `ide/test_ide_contract.mjs` har bir `window.ide.*` chaqiruvi, IPC kanali va DOM `id` mavjudligini
  tekshiradi (ikkita parallel muallif bir-biriga zid kod yozsa, test ushlaydi). U 7-guruhda
  YANG AI tomonidagi birlashtirish shartnomasini ham qo'riqlaydi (import, tugma, `ide/**` paketda).
- Asosiy ilovada yadro `yide:*` kanallarida ishlaydi, yengil panel esa `ide:*` da — bir
  jarayonda `ipcMain.handle` ikki marta ro'yxatga olinmaydi.

## Tekshiruv

```bash
npm run test:ide                     # statik kontrakt (9 guruh) — shu jumladan Lokal AI guruhi
npm run test:ide:models              # Lokal AI menejeri: apparat, katalog, yuklab olish, rasm — 11/11
npm run test:ide:modelsui            # HAQIQIY oyna (CDP): menyu + lokal rasm — 11/11 + skrinshot
node ide/test_stop_button.mjs        # «To'xtatish» tugmasi ishlayaptimi — 6/6
YANG_APP_EXE=dev node ide/test_embedded_e2e.mjs   # YANG AI ichida haqiqiy E2E (16 tekshiruv, CDP)
YANG_APP_EXE="dist/win-unpacked/YANG AI.exe" node ide/test_embedded_e2e.mjs  # paket (asar) ustida
npm run test:ide:pytypes             # Python to'liq tip tekshiruvi — 6 tekshiruv (mypy/pyright)
YANG_TYPES_MODE=degraded YANG_IDE_PYTHON=yoq npm run test:ide:pytypes  # vosita yo'q rejimi — 3 tekshiruv
npm run test:ide:pydebug             # Python qadamlab debug (DAP, debugpy) — 6 tekshiruv
node agent/test_security_attacks.mjs  # tashqi buzish urinishlari — 14 hujum
node agent/test_modes_complex.mjs     # yakka + jamoa rejimida murakkab vazifa (Ollama)
npm run test:ide:pkg                 # PAKETLANGAN mustaqil IDE (asar ichida) — 9 tekshiruv + skrinshot
node ide/bench_ide_boot.mjs           # paket qancha vaqtda ochiladi (cdp + ide.init, median)
npm run test:desk                     # Admin Desk ishlayaptimi? (CDP orqali 8 tekshiruv)
node ide/test_fix_loop_live.mjs      # jonli: buzuq faylni lokal model bilan tuzatish (Ollama)
npx electron ide/test_boot.cjs       # mustaqil oyna: 24 tekshiruv + skrinshot
npm run start:ide                    # IDE'ni mustaqil ochish
npm run dist:ide                     # (ixtiyoriy) YANG-IDE-Setup-*.exe + Portable
npm run dist:release                 # qurish + paket sinovi + nashr (bo'sh commit/disk tekshiruvi bilan)
```

Diqqat (o‘lchandi): `makensis` payload’ni xotiraga xaritalaydi, ya’ni o‘rnatuvchi yig‘ishdan oldin
bo‘sh **commit** payload’dan kam bo‘lmasligi kerak — aks holda
`Internal compiler error #12345: error creating mmap the size of …` chiqadi va bu ilova kodiga
aloqasi yo‘q (yetim model-serverlar to‘xtatilsa o‘sha payload yig‘ilaveradi). Tafsilot:
[`docs/YANG-IDE-hisobot.md`](../docs/YANG-IDE-hisobot.md).

Bu tekshiruv endi qo‘lda emas: `node scripts/build_and_release.mjs` qurishdan OLDIN bo‘sh commit va
bo‘sh diskni o‘lchab, yetmasa **aniq raqamlar bilan to‘xtaydi** (va nashrni ham o‘zi bajaradi).

## Paketlash (asar)

- Mustaqil IDE `app.asar` ichida yig‘iladi (`electron-builder.ide.json` → `asar: true`).
- `asarUnpack` faqat `@homebridge/node-pty-prebuilt-multiarch` uchun: native `conpty.node` va
  `OpenConsole.exe` fayl sifatida kerak (`ide/ide_pty.js` ularni `app.asar.unpacked` dan qidiradi,
  `resourcesPath` yo‘q bo‘lsa oddiy `require` ga tushadi).
- `llama-server.exe` va gguf model **asar tashqarisida** (`extraResources` → `resources/local-ai`) —
  bajariladigan faylni asar ichidan ishga tushirib bo‘lmaydi. `local-ai/catalog.json` ham
  `extraResources` da (katalog ham, model ham paketda; rasm dvigateli va rasm modellari esa
  foydalanuvchi «Lokal AI» menyusidan yuklaydi → `%APPDATA%/yang-ai/models`).
- `tsserver` asar ichidan ishlaydi: u ilovaning o‘z exe’si bilan `ELECTRON_RUN_AS_NODE=1` da
  yuritiladi va Electron’ning asar qatlami o‘sha rejimda ham o‘qishni ta’minlaydi (paket sinovi
  buni har safar tekshiradi).

`npx electron ide/test_boot.cjs` haqiqiy Electron oynasini ochadi, test faylini yuklaydi,
muharrir geometriyasini o'lchaydi (kod qator raqamlari ostida qolmasligi, `<pre>` va `<textarea>`
bir nuqtadan boshlanishi) va `reports/ide_boot/ide-boot.png` skrinshotini yozadi.
