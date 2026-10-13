# YANG IDE — mustaqil ish stoli IDE: nima qilindi, nima o‘lchandi

Sana: 2026-10-13 · Mashina: Windows x64, 6 yadro, 12 GB RAM (CPU inference, GPU yo‘q)

---

## 1. Topshirilgan artefaktlar

| Fayl | Hajm | Nima |
|---|---:|---|
| `dist-ide/YANG-IDE-Setup-1.0.0.exe` | 1.36 GB | NSIS o‘rnatuvchi (papkani tanlash mumkin, ish stoli yorlig‘i) |
| `dist-ide/YANG-IDE-Portable-1.0.0.exe` | 1.36 GB | O‘rnatmasdan ishlaydigan bitta fayl |
| `dist-ide/win-unpacked/` | 1.6 GB | Paket ochilgan ko‘rinishi (smoke-test shu yerda o‘tkazildi) |
| `dist-ide/latest.yml` + `.blockmap` | — | Avtomatik yangilanish uchun metama’lumot |

Qurish buyrug‘i: `npm run dist:ide` → `electron-builder --config electron-builder.ide.json`.

Paket ichida tekshirildi (ro‘yxat bilan):

```
resources/local-ai/model-qwen3.5-2b-q4_k_m.gguf   1 280 835 840 B   ← ilova ichidagi model
resources/local-ai/lc/llama-server.exe                                ← llama.cpp server
resources/app/ide/{main.js, preload.cjs, renderer/}                   ← IDE qobig‘i
resources/app/{agent/, renderer/icon.ico, node_modules/, package.json}
```

`ide/test_*` fayllari paketga **kirmaydi** (konfiguratsiyada filtr bor).

**Cheklov:** bu yerda faqat Windows artefakti qurildi. `.app`/`.dmg` uchun macOS (yoki mac CI)
kerak — electron-builder boshqa platforma uchun imzo/bundle yasamaydi.

---

## 2. “Bitta .exe” aslida nima — qatlamlar

Siz sanab bergan to‘laqonli IDE qismlari YANG IDE’da qanday amalga oshgan:

| Qism | Sizning ta’rifingiz | YANG IDE’da |
|---|---|---|
| GUI qobig‘i | Electron/Tauri; HTML+CSS+JS | **Electron 34** — `ide/main.js` + `ide/renderer/*` (HTML/CSS/JS), Chromium + Node |
| Muharrir dvigateli | Monaco kabi matn renderi | `ide/renderer/app.js` — qator raqamlari, sintaksis bo‘yash (`<pre>` + shaffof `<textarea>`), avto-to‘ldirish, qavs juftligi, Tab/Shift+Tab, Ctrl+/, topish-almashtirish |
| Til serverlari (LSP) | pyright/pylsp alohida jarayon | **Lite-LSP** — `diagnosticsSync()`: Python `compile()` (AST), JS `node --check`, JSON `JSON.parse`. Natija LSP shaklida (`{line,col,message,severity}`), lekin **to‘liq pyright emas** |
| I/O va OS | psutil, fayl kuzatuvchilar | `fs`, `fs.watch` (tashqaridan o‘zgargan fayl ochiq tabda yangilanadi), `shell.trashItem` (o‘chirish savatga) |
| Terminal emulyatori | xterm.js → OS shell | `spawn` + oqim (stream) → ANSI ranglar renderer’da `span`ga aylantiriladi; `cd` sessiya cwd’ini o‘zgartiradi |
| Debugger (DAP) | debugpy + adapter | **Lite-debug** — xato chiqishidan `fayl:qator` havolalari ajratiladi va bosilsa o‘sha qatorga olib boradi. Qadamlab debugger (breakpoint/variable inspector) **yo‘q** |
| AI qatlami | — | `agent/engine.js` (fayl o‘qish/yozish, buyruq ishga tushirish), `agent/team.js` (planner → agentlar → reviewer → fixer → lead) |
| Lokal model | — | `local-ai/lc/llama-server.exe` + gguf, port javob berguncha kutish va kontekst zinapoyasi 8192 → 4096 → 2048 |

Batafsil: [`ide/README.md`](../ide/README.md).

---

## 3. Tekshiruvlar (dalillar)

| Tekshiruv | Buyruq | Natija |
|---|---|---|
| Kontrakt testi (DOM id ↔ preload ↔ IPC ↔ geometriya) | `node ide/test_ide_contract.mjs` | **5/5 guruh PASS** |
| Haqiqiy Electron oynasi + 24 tekshiruv + skrinshot | `npx electron ide/test_boot.cjs` | **24/24 PASS** · `reports/ide_boot/ide-boot.png` |
| Jamoa rejimi UI oqimi (`team_plan`/`team_assign`/`agent_begin`/`agent_end`/`team_done`) | test_boot ichtida | PASS (yakuniy xulosa **bir marta** chiqadi) |
| Paketlangan ilova | `dist-ide/win-unpacked/YANG IDE.exe` | 4 jarayon (main + renderer + GPU + utility) ko‘tarildi, keyin to‘xtatildi |
| Jamoa rejimi + lokal model (end-to-end) | `YANG_TEAM_MODEL=qwen2.5-coder:7b node agent/test_team_ollama_smoke.mjs` | **PASS** — 61.6 s, `sum_to_n.py` yaratildi, ishga tushdi (`55`, `1`), `team_done` chiqdi |

Skrinshotdagi holat: qator raqamlari chapda, kod ulardan keyin boshlanadi (avval kod raqamlar
ostiga surilib ketardi — tuzatildi), sintaksis bo‘yalgan, holat qatori `Ln 9, Col 1 · Python`.

---

## 4. Lokal AI: ro‘yxat, natijalar, tavsiya

To‘liq jadval va xato chiqishlari: [`reports/local_ai/local-ai-hisobot.md`](local_ai/local-ai-hisobot.md)
(xom ma’lumot: `reports/local_ai/bench_raw.json`, `run-2b/`, `run-coder3b/`).

Mezon: **PASS = tekshiruv skripti nol kod bilan tugadi** (fayl mazmuni emas, haqiqiy ishga tushirish).
Ikki rejim: `one-shot` (model bir marta yozadi) va `ide-loop` (yozilgan fayl darhol ishga tushadi,
xato matni modelga qaytariladi, u tuzatadi — 2 martagacha).

Kichraytirilgan jadval (ball ↓: avval IDE bilan nechta vazifa o‘tdi, keyin tezlik):

| Model | Hajm | Manba | One-shot | IDE halqasi | O‘rtacha (IDE) |
|---|---:|---|---:|---:|---:|
| **qwen2.5-coder:7b** | 4.4 GB | Ollama | 2/4 | **4/4** | 75 s |
| qwen2.5:7b | 4.4 GB | Ollama | **4/4** | **4/4** | 71 s |
| **qwen3.5-2B Q4_K_M** | 1.2 GB | **ilova ichida** | **3/4** | **3/4** | 100 s |
| qwen2.5-coder:3b | 1.8 GB | Ollama | 2/4 | 3/4 | 93 s |
| qwen3-4B (qwen3-4b-2507) | 2.3 GB | ilova ichida | 2/4 | 3/4 | 133 s |
| llama-1.7B (ilovadagi hozirgi) | 1.0 GB | ilova ichida | 2/4 | 3/4 | 91 s |
| qwen2.5:0.5b | 0.4 GB | Ollama | 0/4 | 0/4 | — |
| llama3:8b | 4.3 GB | Ollama | 0/4 | 0/4 | — |

**Eng muhim topilma — «IDE qo‘li» haqiqatan ishlaydi.** Kuchsiz modellar IDE halqasi bilan
qo‘l oyoqli bo‘ladi: `qwen2.5-coder:7b` 2/4 → **4/4**, `qwen2.5-coder:3b` 2/4 → **3/4**,
1.7B va 4B 2/4 → **3/4**. Ya’ni “coder bo‘la turib tizimdan foydalana olmaydigan” model ham
IDE ichida ish bitiradi — chunki xatoni model emas, **IDE** topib beradi.

**Yaroqsiz chiqqanlar:** `llama3:8b` (0/4, hatto `run_command` bilan ham) va `qwen2.5:0.5b` (0/4).
Ular topshiriq formatini ham bajarmadi — ro‘yxatdan chiqarish tavsiya etiladi.

### Tavsiya (variantlar)

1. **Kuchli ish stoli uchun (tavsiya):** Ollama + **`qwen2.5-coder:7b`** — 4.4 GB, IDE bilan 4/4,
   o‘rtacha ~75 s/vazifa (6 yadro, CPU). Kodga ixtisoslashgan, IDE uni model ro‘yxatida o‘zi topadi.
   (Avtomatik reytingda `qwen2.5:7b` atigi 0.25 ball oldinda — bu farq faqat *one-shot* qo‘shimcha
   ballidan; **ikkalasi ham IDE halqasi bilan 4/4**, kod uchun ixtisoslashgani tanlandi.)
2. **Hech narsa o‘rnatmasdan, offline:** ilova ichidagi **Qwen3.5-2B Q4_K_M** (1.2 GB) — kichikligiga
   qaraganda eng yaxshi natija (3/4, one-shot ham 3/4). **Standart variant sifatida shu tanlandi.**
3. **Eng ixcham “coder”:** Ollama + **`qwen2.5-coder:3b`** — 1.8 GB, 3/4. 7B ni ko‘tarmaydigan
   mashina uchun muvozanat.
4. **Yo‘q:** `llama3:8b`, `qwen2.5:0.5b`.

### Tekshiruvning cheklovlari (halol ro‘yxat)

- 4 ta kichik sun’iy vazifa (bitta fayl + tekshiruv). Katta loyihada reyting boshqacha bo‘lishi mumkin.
- CPU inference, GPU yo‘q; 2B/3B yurishlari paketlash jarayoni bilan bir vaqtda o‘tgani uchun
  ularning **vaqtlari biroz shishgan** (ball tartibi baribir o‘zgarmaydi: asosiy mezon — o‘tgan vazifalar).
- `fizzbuzz` ajratuvchi vazifa bo‘ldi: topshiriqda `fizzbuzz(5)` natijasi aniq yozilgan
  (`"1 2 Fizz 4 Buzz"`), lekin kuchsiz modellar songa so‘zni qo‘shib yubordi (`"1 2 Fizz 3 4 Buzz 5"`).

---

## 5. IDE’da jamoa (team) rejimi

- Renderer endi `team_plan` → `team_assign` → `agent_begin` → `team_audit` → `agent_end` →
  `team_done` hodisalarini ko‘rsatadi (avval faqat `tool`/`assistant` chizilardi — jamoa ko‘rinmasdi).
- `AI` panelida **jamoa** katagi bor; ishlab turgan ishni **To‘xtatish** tugmasi `abort()` qiladi.
- Skrinshotda: “👥 Jamoa tuzildi: 2 agent → Coder (dasturchi) → QA (tester) → model tayinlandi →
  Coder tugadi · app.py tayyor → Jamoa yakunlandi: 2 fayl”.
- **Lokal model bilan end-to-end natija:** `qwen2.5-coder:7b` da jamoa oqimi **PASS** — 61.6 s,
  faqat `sum_to_n.py` yaratildi, `python sum_to_n.py` ishga tushdi va `55`/`1` chiqardi,
  yakunda bitta `team_done` hodisasi keldi. Ya’ni “jamoaviy rejim lokal model bilan ishlaydi”.
- Zaifroq modelda (`qwen2.5-coder:3b`) xuddi shu test **yiqildi**: bir fayl so‘ralgan joyda
  qo‘shimcha fayllar (`result.txt`, `summary.txt`, `final_output.txt`) yasab tashladi. Bu IDE
  xatosi emas, model intizomi — jamoa rejimini ~7B va undan kattaroq lokal model bilan
  ishlatish tavsiya etiladi.

---

## 6. Interfeys: premium va sodda

- Bitta aksent rang, tekis to‘q fon, ingichka ramkalar; panel/tab/menyu bir xil metrikada.
- Tuzatilgan nuqson: muharrirda kod **qator raqamlari ostiga** surilib ketardi (CSS `--gutter-w`
  bilan qatlamlar moslandi; endi test buni `<pre>` va `<textarea>` koordinatalarini o‘lchab tekshiradi).
- Holat qatori: `YANG IDE · test · win32 · 6 CPU · 12215 MB RAM` + o‘ng tomonda `Ln, Col, til, saqlangan`.
- Dalil: `reports/ide_boot/ide-boot.png`.
