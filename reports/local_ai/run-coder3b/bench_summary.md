# Lokal modellar: IDE bilan / IDE siz sinov

Sana: 2026-10-13T01:55:11.107Z

PASS = tekshiruv skripti nol kod bilan tugadi (fayl mazmuni emas, HAQIQIY ishga tushirish natijasi).

| Model | Params | One-shot | IDE bilan | Tuzatish qadamlari | O‘rtacha (IDE) |
|---|---|---:|---:|---:|---:|
| qwen2.5-coder:3b | 3.1B | 2/4 | 3/4 | 2 | 93.4s |

## Vazifalar bo‘yicha

| Model | Vazifa | One-shot | IDE bilan |
|---|---|---|---|
| qwen2.5-coder:3b | factorial | PASS | PASS |
| qwen2.5-coder:3b | slugify | PASS | PASS |
| qwen2.5-coder:3b | fizzbuzz | FAIL | PASS |
| qwen2.5-coder:3b | median_bug | FAIL | FAIL |

Umumiy vaqt: 563.2s · warm-up: 12.7s
