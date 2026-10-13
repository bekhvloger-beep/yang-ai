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
| Til xizmati (sintaksis) | `ide/ide_host.js` → `diagnosticsSync()` | Python: `compile()`, JS: `node --check`, JSON: `JSON.parse` — tezkor zaxira qatlami (til xizmati ishlamasa ham xato topiladi) |
| Haqiqiy terminal | `ide/ide_pty.js` + `ide/vendor/xterm.js` | ConPTY orqali psevdo-terminal + xterm.js ekrani. `vim`, `top`, `ssh`, REPL ishlaydi (`isatty()` → True). PTY yuklanmasa eski quvur rejimi |
| Debugger | `ide/ide_debug.js` | Node inspector (CDP): nuqtalar, qadamlar, chaqiruvlar, o'zgaruvchilar. `--inspect-brk` kirish to'xtashi avtomatik o'tkazib yuboriladi |
| Yurish + Tarix + AI tuzatish | `ide/ide_runner.js` | Har yurish logga yoziladi; «Sinab ko'r + tuzat» xato bo'lsa modelga TARIX + diagnostika berib qayta yuritadi |
| I/O va OS | `ide/ide_host.js` → `fs`, `fs.watch`, `shell.trashItem` | Fayl o'qish/yozish, papka kuzatuvchisi (tashqaridan o'zgargan fayl ochiq tabda yangilanadi), o'chirish savatga. Barcha yo'llar ish papkasiga qamalgan |
| Terminal | `ide/ide_host.js` → `spawn` | Buyruqlar oqim (stream) bilan, ANSI ranglar renderer'da `span`ga aylanadi. `cd` terminal sessiyasi cwd'ini o'zgartiradi. Windows'da buyruq `cmd.exe /d /s /c "…"` ko'rinishida yuboriladi (`windowsVerbatimArguments`) — qo'shtirnoqli yo'llar ham ishlaydi |
| Faylni ishga tushirish | `ide/ide_host.js` → `runtimeFor()` | `.js/.mjs/.cjs` → electron.exe **Node rejimida** (`ELECTRON_RUN_AS_NODE=1`), `.py` → python, `.ps1`/`.bat`/`.sh` → mos qobiq, `.html` → brauzer |
| Xato havolalari | `ide/ide_host.js` → `parseErrorLinks()` | Xato chiqishidan `fayl:qator` havolalarini ajratib beradi — bosilsa o'sha qatorga o'tadi (qadamlab debugger esa alohida, `ide/ide_debug.js` da) |
| AI qatlami | `ide/ide_host.js` → `agent/engine.js`, `agent/team.js` | YANG AI dvigateli: fayl o'qish/yozish, buyruq ishga tushirish, jamoa rejimi (planner → agentlar → reviewer → fixer → lead) |
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
Tanlash tartibi `ide/ide_host.js` da: qwen3.5-2B → 1.7B → 4B (RAM ≥ 8 GB) → 0.5B zaxira.

## Xavfsizlik

- Barcha fayl amallari **workspace ildiziga qamalgan**: yo'l `path.relative` bilan tekshiriladi,
  `..` yoki absolyut yo'l rad etiladi.
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
npm run test:ide                     # statik kontrakt (8 guruh, 44 tekshiruv)
YANG_APP_EXE=dev node ide/test_embedded_e2e.mjs   # YANG AI ichida haqiqiy E2E (14 tekshiruv, CDP)
YANG_APP_EXE="dist/win-unpacked/YANG AI.exe" node ide/test_embedded_e2e.mjs  # paket (asar) ustida
node ide/test_fix_loop_live.mjs      # jonli: buzuq faylni lokal model bilan tuzatish (Ollama)
npx electron ide/test_boot.cjs       # mustaqil oyna: 24 tekshiruv + skrinshot
npm run start:ide                    # IDE'ni mustaqil ochish
npm run dist:ide                     # (ixtiyoriy) YANG-IDE-Setup-*.exe + Portable
```

`npx electron ide/test_boot.cjs` haqiqiy Electron oynasini ochadi, test faylini yuklaydi,
muharrir geometriyasini o'lchaydi (kod qator raqamlari ostida qolmasligi, `<pre>` va `<textarea>`
bir nuqtadan boshlanishi) va `reports/ide_boot/ide-boot.png` skrinshotini yozadi.
