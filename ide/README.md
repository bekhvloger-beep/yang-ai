# YANG IDE — mustaqil kod muharriri

Bu hujjat YANG IDE ichida nima borligini va u qanday qatlamlardan yig'ilganini tushuntiradi.
IDE — **alohida dastur** (`YANG-IDE-Setup-*.exe`), YANG AI chatidan mustaqil ishga tushadi,
lekin YANG AI bilan **bitta sozlamalar papkasini** (`%APPDATA%/yang-ai`) bo'lishadi: API
kalitlar, provayderlar va tanlangan model ikkala ilovada bir xil.

## Qatlamlar

| Qatlam | Fayl | Nima qiladi |
|---|---|---|
| GUI qobig'i | `ide/main.js` (Electron) + `ide/renderer/*` | Oyna, menyu, panel, tablar — Chromium + Node, xuddi VS Code/Cursor kabi |
| Muharrir dvigateli | `ide/renderer/app.js` | Qator raqamlari, sintaksis bo'yash (`<pre>` + shaffof `<textarea>` qatlami), avtomatik to'ldirish, qavs juftligi, Tab/Shift+Tab, Ctrl+/ izoh, topish/almashtirish |
| Til xizmati (lite-LSP) | `ide/main.js` → `diagnosticsSync()` | Python: `compile()` (AST orqali sintaksis), JS: `node --check`, JSON: `JSON.parse`. Natija LSP ko'rinishida: `{line, col, message, severity}` |
| I/O va OS | `ide/main.js` → `fs`, `fs.watch`, `shell.trashItem` | Fayl o'qish/yozish, papka kuzatuvchisi (tashqaridan o'zgargan fayl ochiq tabda yangilanadi), o'chirish savatga |
| Terminal | `ide/main.js` → `spawn` | Buyruqlar oqim (stream) bilan, ANSI ranglar renderer'da `span`ga aylanadi. `cd` terminal sessiyasi cwd'ini o'zgartiradi |
| Debug (lite) | `ide/main.js` → `parseErrorLinks()` | Xato chiqishidan `fayl:qator` havolalarini ajratib, bosilsa o'sha qatorga olib boradi. Qadamlab debugger emas |
| AI qatlami | `ide/main.js` → `agent/engine.js`, `agent/team.js` | YANG AI dvigateli: fayl o'qish/yozish, buyruq ishga tushirish, jamoa rejimi (planner → agentlar → reviewer → fixer → lead) |
| Lokal model | `ide/main.js` → `ensureLocalServer()` / `startLlamaServer()` | Ilova ichidagi `llama-server.exe` + gguf ko'tariladi, port javob berguncha kutiladi. Kontekst zinapoyasi 8192 → 4096 → 2048: RAM band bo'lib KV kesh ajratilmasa, keyingi kichikroq o'lcham sinaladi |

## Qaysi lokal model (o‘lchovga asoslangan)

Ilova ichida **Qwen3.5-2B Q4_K_M** (`local-ai/model-qwen3.5-2b-q4_k_m.gguf`, 1.2 GB) keladi.
Tanlov tasodifiy emas — `agent/bench_ide_assisted.mjs` to'rt vazifada (factorial, slugify, fizzbuzz,
median_bug) har modelni ikki rejimda sinaydi: `one-shot` (bir marta yozadi) va `ide-loop`
(tekshiruv ishga tushadi, xato modelga qaytariladi, u tuzatadi).

| Model | Hajm | One-shot | IDE halqasi bilan | O‘rtacha (IDE) |
|---|---|---:|---:|---:|
| qwen2.5-coder:7b (Ollama) | 4.4 GB | 2/4 | **4/4** | 75s |
| qwen2.5:7b (Ollama) | 4.4 GB | 4/4 | **4/4** | 71s |
| **qwen3.5-2B q4_k_m (ilova ichida)** | **1.2 GB** | **3/4** | **3/4** | 100s |
| qwen2.5-coder:3b (Ollama) | 1.8 GB | 2/4 | 3/4 | 93s |
| qwen3-4B (ilova ichida) | 2.3 GB | 2/4 | 3/4 | 133s |
| qwen2.5:0.5b (Ollama) | 0.4 GB | 0/4 | 0/4 | — |
| llama3:8b (Ollama) | 4.3 GB | 0/4 | 0/4 | — |

To‘liq jadval, xato chiqishlari va tavsiya: `reports/local_ai/local-ai-hisobot.md`.
Tanlash tartibi `ide/main.js` da: qwen3.5-2B → 1.7B → 4B (RAM ≥ 8 GB) → 0.5B zaxira.

## Xavfsizlik

- Barcha fayl amallari **workspace ildiziga qamalgan**: yo'l `path.relative` bilan tekshiriladi,
  `..` yoki absolyut yo'l rad etiladi.
- Renderer'da `nodeIntegration: false`, `contextIsolation: true`; faqat `preload.cjs` oshkor
  qilgan 27 ta metod mavjud (`window.ide.*`).
- O'chirish `shell.trashItem` (savat) orqali — qaytarib olish mumkin.
- `ide/test_ide_contract.mjs` har bir `window.ide.*` chaqiruvi, IPC kanali va DOM `id` mavjudligini
  tekshiradi (ikkita parallel muallif bir-biriga zid kod yozsa, test ushlaydi).

## Tekshiruv

```bash
npm run test:ide     # node ide/test_ide_contract.mjs  — statik kontrakt (5 guruh)
npx electron ide/test_boot.cjs   # haqiqiy oyna: 18 tekshiruv + skrinshot
npm run start:ide    # IDE'ni ochish
npm run dist:ide     # YANG-IDE-Setup-*.exe + Portable yig'ish
```

`npx electron ide/test_boot.cjs` haqiqiy Electron oynasini ochadi, test faylini yuklaydi,
muharrir geometriyasini o'lchaydi (kod qator raqamlari ostida qolmasligi, `<pre>` va `<textarea>`
bir nuqtadan boshlanishi) va `reports/ide_boot/ide-boot.png` skrinshotini yozadi.
