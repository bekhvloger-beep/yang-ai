# Lokal modellar: IDE bilan / IDE siz sinov

Sana: 2026-10-13T01:43:28.974Z

PASS = tekshiruv skripti nol kod bilan tugadi (fayl mazmuni emas, HAQIQIY ishga tushirish natijasi).

| Model | Params | One-shot | IDE bilan | Tuzatish qadamlari | O‘rtacha (IDE) |
|---|---|---:|---:|---:|---:|
| local:model-qwen3.5-2b-q4_k_m.gguf | 2B | 3/4 | 3/4 | 3 | 99.6s |

## Vazifalar bo‘yicha

| Model | Vazifa | One-shot | IDE bilan |
|---|---|---|---|
| local:model-qwen3.5-2b-q4_k_m.gguf | factorial | PASS | PASS |
| local:model-qwen3.5-2b-q4_k_m.gguf | slugify | PASS | PASS |
| local:model-qwen3.5-2b-q4_k_m.gguf | fizzbuzz | PASS | FAIL |
| local:model-qwen3.5-2b-q4_k_m.gguf | median_bug | FAIL | PASS |

Umumiy vaqt: 556.3s · warm-up: 5.8s
