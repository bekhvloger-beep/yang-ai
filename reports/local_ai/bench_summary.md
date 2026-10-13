# Lokal modellar: IDE bilan / IDE siz sinov

Sana: 2026-10-12T21:51:36.480Z

PASS = tekshiruv skripti nol kod bilan tugadi (fayl mazmuni emas, HAQIQIY ishga tushirish natijasi).

| Model | Params | One-shot | IDE bilan | Tuzatish qadamlari | O‘rtacha (IDE) |
|---|---|---:|---:|---:|---:|
| qwen2.5-coder:7b | 7.6B | 2/4 | 4/4 | 1 | 75s |
| qwen2.5:latest | 7.6B | 4/4 | 4/4 | 0 | 70.8s |
| llama3:latest | 8.0B | 0/4 | 0/4 | 8 | 0.1s |
| qwen2.5:0.5b | 494.03M | 0/4 | 0/4 | 8 | 26.6s |
| local:model-qwen3-4b-2507.gguf | 4B | 2/4 | 3/4 | 2 | 132.7s |
| local:model-1.7b.gguf | 1.7B | 2/4 | 3/4 | 3 | 91.4s |

## Vazifalar bo‘yicha

| Model | Vazifa | One-shot | IDE bilan |
|---|---|---|---|
| qwen2.5-coder:7b | factorial | PASS | PASS |
| qwen2.5-coder:7b | slugify | FAIL | PASS |
| qwen2.5-coder:7b | fizzbuzz | FAIL | PASS |
| qwen2.5-coder:7b | median_bug | PASS | PASS |
| qwen2.5:latest | factorial | PASS | PASS |
| qwen2.5:latest | slugify | PASS | PASS |
| qwen2.5:latest | fizzbuzz | PASS | PASS |
| qwen2.5:latest | median_bug | PASS | PASS |
| llama3:latest | factorial | FAIL | FAIL |
| llama3:latest | slugify | FAIL | FAIL |
| llama3:latest | fizzbuzz | FAIL | FAIL |
| llama3:latest | median_bug | FAIL | FAIL |
| qwen2.5:0.5b | factorial | FAIL | FAIL |
| qwen2.5:0.5b | slugify | FAIL | FAIL |
| qwen2.5:0.5b | fizzbuzz | FAIL | FAIL |
| qwen2.5:0.5b | median_bug | FAIL | FAIL |
| local:model-qwen3-4b-2507.gguf | factorial | PASS | PASS |
| local:model-qwen3-4b-2507.gguf | slugify | FAIL | FAIL |
| local:model-qwen3-4b-2507.gguf | fizzbuzz | FAIL | PASS |
| local:model-qwen3-4b-2507.gguf | median_bug | PASS | PASS |
| local:model-1.7b.gguf | factorial | PASS | PASS |
| local:model-1.7b.gguf | slugify | PASS | PASS |
| local:model-1.7b.gguf | fizzbuzz | FAIL | FAIL |
| local:model-1.7b.gguf | median_bug | FAIL | PASS |

Umumiy vaqt: 2722.4s · warm-up: 5.4s
