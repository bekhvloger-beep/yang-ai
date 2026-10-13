# YANG AI / YANG IDE — lokal modellar hisoboti

Sana: 2026-10-13T01:55:11.107Z

## Asosiy savol

Qaysi **ixcham lokal model** IDE yordamisiz ham, IDE halqasi (yozdi → tekshiruv ishga tushdi → xato qaytdi → tuzatdi) bilan ham kodlashga yaroqli?

Mezon: **PASS = tekshiruv skripti nol kod bilan tugadi (fayl mazmuni emas, HAQIQIY ishga tushirish natijasi).**

## Muhit

| Parametr | Qiymat |
|---|---|
| Sana | 2026-10-13T01:55:11.107Z |
| Platforma | win32 / x64 |
| CPU yadro | 6 |
| RAM | 12214.7 MB |
| Ollama | http://127.0.0.1:11434 |
| Model yuklanishi (warm-up) | 25.4s |
| Umumiy o‘lchov vaqti | 1126.4s |
| Vazifalar | 4 ta (factorial, slugify, fizzbuzz, median_bug) |
| O‘lchov yurishlari | 3 ta |

## Asosiy natija

| Model | Manba | Params | Quant | Disk | One-shot | IDE bilan | Tuzatish qadamlari | O‘rtacha vaqt (IDE) |
|---|---|---|---|---|---:|---:|---:|---:|
| llama3:latest | Ollama | 8.0B | Q4_0 | 4.3 GB | 0/4 | **0/4** | 8 | 0.1s |
| local:model-1.7b.gguf | ilova ichida | 1.7B | — | 1.0 GB | 2/4 | **3/4** | 3 | 91.4s |
| local:model-qwen3-4b-2507.gguf | ilova ichida | 4B | — | 2.3 GB | 2/4 | **3/4** | 2 | 132.7s |
| local:model-qwen3.5-2b-q4_k_m.gguf | ilova ichida | 2B | Q4_K_M | 1.2 GB | 3/4 | **3/4** | 3 | 99.6s |
| qwen2.5-coder:3b | Ollama | 3.1B | Q4_K_M | 1.8 GB | 2/4 | **3/4** | 2 | 93.4s |
| qwen2.5-coder:7b | Ollama | 7.6B | Q4_K_M | 4.4 GB | 2/4 | **4/4** | 1 | 75.0s |
| qwen2.5:0.5b | Ollama | 494.03M | Q4_K_M | 379 MB | 0/4 | **0/4** | 8 | 26.6s |
| qwen2.5:latest | Ollama | 7.6B | Q4_K_M | 4.4 GB | 4/4 | **4/4** | 0 | 70.8s |

## Vazifalar bo‘yicha

| Model | factorial | slugify | fizzbuzz | median_bug |
|---|---|---|---|---|
| llama3:latest | FAIL | FAIL | FAIL | FAIL |
| local:model-1.7b.gguf | PASS | PASS | FAIL | PASS |
| local:model-qwen3-4b-2507.gguf | PASS | FAIL | PASS | PASS |
| local:model-qwen3.5-2b-q4_k_m.gguf | PASS | PASS | FAIL | PASS |
| qwen2.5-coder:3b | PASS | PASS | PASS | FAIL |
| qwen2.5-coder:7b | PASS | PASS | PASS | PASS |
| qwen2.5:0.5b | FAIL | FAIL | FAIL | FAIL |
| qwen2.5:latest | PASS | PASS | PASS | PASS |

_(jadvaldagi qiymatlar — **IDE halqasi** rejimining natijasi)_

## IDE halqasi nima beradi

`one-shot` — model bir marta yozadi, tekshiruv natijasi unga qaytarilmaydi. `ide-loop` — yozilgan fayl darhol ishga tushiriladi, xato matni modelga qaytariladi va u tuzatadi (2 martagacha).

| Model | One-shot PASS | IDE bilan PASS | IDE qo‘shgan foyda |
|---|---:|---:|---:|
| llama3:latest | 0 | 0 | 0 |
| local:model-1.7b.gguf | 2 | 3 | +1 |
| local:model-qwen3-4b-2507.gguf | 2 | 3 | +1 |
| local:model-qwen3.5-2b-q4_k_m.gguf | 3 | 3 | 0 |
| qwen2.5-coder:3b | 2 | 3 | +1 |
| qwen2.5-coder:7b | 2 | 4 | +2 |
| qwen2.5:0.5b | 0 | 0 | 0 |
| qwen2.5:latest | 4 | 4 | 0 |

## Tuzatib bo‘lmagan xatolar

| Model | Vazifa | Tekshiruv chiqishi (qisqartirilgan) |
|---|---|---|
| llama3:latest | factorial | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-factorial-yrdkx6\check_factorial.py", line 4, in <module>     spec.l… |
| llama3:latest | slugify | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-slugify-0hAjj6\check_slugify.py", line 4, in <module>     spec.loade… |
| llama3:latest | fizzbuzz | node:internal/modules/esm/resolve:272     throw new ERR_MODULE_NOT_FOUND(           ^  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\behru\AppData… |
| llama3:latest | median_bug | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-median_bug-wn4MMU\check_median_bug.py", line 6, in <module>     asse… |
| local:model-1.7b.gguf | fizzbuzz | file:///C:/Users/behru/AppData/Local/Temp/yang-idebench-fizzbuzz-tsrVEq/check_fizzbuzz.mjs:1 import { fizzbuzz } from './fizzbuzz.mjs';          ^^^^^^^^ Synta… |
| local:model-qwen3-4b-2507.gguf | slugify | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-slugify-xAn5HP\check_slugify.py", line 4, in <module>     spec.loade… |
| local:model-qwen3.5-2b-q4_k_m.gguf | fizzbuzz | file:///C:/Users/behru/AppData/Local/Temp/yang-idebench-fizzbuzz-jkFLjD/check_fizzbuzz.mjs:3 if (got !== '1 2 Fizz 4 Buzz') throw new Error('fizzbuzz(5) = ' + … |
| qwen2.5-coder:3b | median_bug | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-median_bug-31OKJL\check_median_bug.py", line 5, in <module>     asse… |
| qwen2.5:0.5b | factorial | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-factorial-rqefYL\check_factorial.py", line 4, in <module>     spec.l… |
| qwen2.5:0.5b | slugify | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-slugify-7eZCLH\check_slugify.py", line 4, in <module>     spec.loade… |
| qwen2.5:0.5b | fizzbuzz | file:///C:/Users/behru/AppData/Local/Temp/yang-idebench-fizzbuzz-oJVdm6/check_fizzbuzz.mjs:3 if (got !== '1 2 Fizz 4 Buzz') throw new Error('fizzbuzz(5) = ' + … |
| qwen2.5:0.5b | median_bug | Traceback (most recent call last):   File "C:\Users\behru\AppData\Local\Temp\yang-idebench-median_bug-AUR6NG\check_median_bug.py", line 4, in <module>     spec… |

## O‘lchanmagan modellar

Bu modellar Ollama katalogida bor, lekin ular uchun natija yozuvi yo‘q (o‘lchovda o‘tkazib yuborilgan yoki hali navbatda).

| Model | Params | Quant | Disk |
|---|---|---|---|
| deepseek-r1:8b | 8.2B | Q4_K_M | 4.9 GB |

## Xulosa

Ball formulasi: `idePass × 10 + min(3, 60 / avgVaqt) + oneShotPass × 0.1` — ya'ni **avval IDE bilan nechta vazifa o‘tdi**, keyin tezlik (3 ball bilan cheklangan), oxirida mustaqillik.

1. **qwen2.5:latest** — ball 41.25 · IDE bilan 4/4 · one-shot 4/4 · o‘rtacha 70.8s · IDE bilan to‘liq yaroqli
2. **qwen2.5-coder:7b** — ball 41 · IDE bilan 4/4 · one-shot 2/4 · o‘rtacha 75.0s · IDE bilan to‘liq yaroqli
3. **local:model-qwen3.5-2b-q4_k_m.gguf** — ball 30.9 · IDE bilan 3/4 · one-shot 3/4 · o‘rtacha 99.6s · qisman yaroqli
4. **local:model-1.7b.gguf** — ball 30.86 · IDE bilan 3/4 · one-shot 2/4 · o‘rtacha 91.4s · qisman yaroqli
5. **qwen2.5-coder:3b** — ball 30.84 · IDE bilan 3/4 · one-shot 2/4 · o‘rtacha 93.4s · qisman yaroqli
6. **local:model-qwen3-4b-2507.gguf** — ball 30.65 · IDE bilan 3/4 · one-shot 2/4 · o‘rtacha 132.7s · qisman yaroqli
7. **llama3:latest** — ball 0 · IDE bilan 0/4 · one-shot 0/4 · o‘rtacha 0.1s · kodlash uchun yaroqsiz
8. **qwen2.5:0.5b** — ball 0 · IDE bilan 0/4 · one-shot 0/4 · o‘rtacha 26.6s · kodlash uchun yaroqsiz

### Tavsiya: `qwen2.5:latest`

qwen2.5:latest — 7.6B, ide bilan to‘liq yaroqli; IDE bilan 4/4 vazifa o‘tdi, o‘rtacha 70.8s, ball 41.25.
Zaxira variant: `qwen2.5-coder:7b` (ball 41, IDE bilan 4/4).

**Cheklov:** bu o‘lchov kichik sun’iy vazifalar to‘plami (bir fayl, funksiya + tekshiruv) ustida o‘tkazilgan. Katta loyihada xulosa bir xil bo‘lishi shart emas — modelni IDE ichida haqiqiy fayllar bilan sinab ko‘ring.

_Xom ma'lumot (3 yurish): `reports/local_ai/bench_raw.json`, `reports/local_ai/run-2b/bench_raw.json`, `reports/local_ai/run-coder3b/bench_raw.json` · generator: `scripts/report_local_ai.mjs`_
