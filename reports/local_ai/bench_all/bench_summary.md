# Lokal modellar: IDE bilan / IDE siz sinov

Sana: 2026-10-16T23:03:18.440Z

PASS = tekshiruv skripti nol kod bilan tugadi (fayl mazmuni emas, HAQIQIY ishga tushirish natijasi).

| Model | Params | One-shot | IDE bilan | Tuzatish qadamlari | O‘rtacha (IDE) |
|---|---|---:|---:|---:|---:|
| local:model-1.7b.gguf | 1.7B | 2/4 | 3/4 | 2 | 64.6s |
| local:model-qwen3-4b-2507.gguf | 4B | 3/4 | 4/4 | 1 | 136.3s |
| local:model-qwen3.5-2b-q4_k_m.gguf | 2B | 2/4 | 3/4 | 3 | 73.8s |
| local:model.gguf | ? | 0/4 | 0/4 | 8 | 68.7s |
| qwen2.5-coder:3b | 3.1B | 3/4 | 3/4 | 2 | 66.6s |
| qwen2.5-coder:7b | 7.6B | 4/4 | 4/4 | 0 | 36.9s |
| qwen2.5:latest | 7.6B | 4/4 | 4/4 | 0 | 79.8s |
| qwen2.5:0.5b | 494.03M | 0/4 | 0/4 | 8 | 35.9s |
| deepseek-r1:8b | 8.2B | 0/4 | 0/4 | 8 | 349.7s |

## Vazifalar bo‘yicha

| Model | Vazifa | One-shot | IDE bilan |
|---|---|---|---|
| local:model-1.7b.gguf | factorial | PASS | PASS |
| local:model-1.7b.gguf | slugify | PASS | PASS |
| local:model-1.7b.gguf | fizzbuzz | FAIL | PASS |
| local:model-1.7b.gguf | median_bug | FAIL | FAIL |
| local:model-qwen3-4b-2507.gguf | factorial | PASS | PASS |
| local:model-qwen3-4b-2507.gguf | slugify | FAIL | PASS |
| local:model-qwen3-4b-2507.gguf | fizzbuzz | PASS | PASS |
| local:model-qwen3-4b-2507.gguf | median_bug | PASS | PASS |
| local:model-qwen3.5-2b-q4_k_m.gguf | factorial | PASS | PASS |
| local:model-qwen3.5-2b-q4_k_m.gguf | slugify | PASS | PASS |
| local:model-qwen3.5-2b-q4_k_m.gguf | fizzbuzz | FAIL | FAIL |
| local:model-qwen3.5-2b-q4_k_m.gguf | median_bug | FAIL | PASS |
| local:model.gguf | factorial | FAIL | FAIL |
| local:model.gguf | slugify | FAIL | FAIL |
| local:model.gguf | fizzbuzz | FAIL | FAIL |
| local:model.gguf | median_bug | FAIL | FAIL |
| qwen2.5-coder:3b | factorial | PASS | PASS |
| qwen2.5-coder:3b | slugify | PASS | PASS |
| qwen2.5-coder:3b | fizzbuzz | PASS | PASS |
| qwen2.5-coder:3b | median_bug | FAIL | FAIL |
| qwen2.5-coder:7b | factorial | PASS | PASS |
| qwen2.5-coder:7b | slugify | PASS | PASS |
| qwen2.5-coder:7b | fizzbuzz | PASS | PASS |
| qwen2.5-coder:7b | median_bug | PASS | PASS |
| qwen2.5:latest | factorial | PASS | PASS |
| qwen2.5:latest | slugify | PASS | PASS |
| qwen2.5:latest | fizzbuzz | PASS | PASS |
| qwen2.5:latest | median_bug | PASS | PASS |
| qwen2.5:0.5b | factorial | FAIL | FAIL |
| qwen2.5:0.5b | slugify | FAIL | FAIL |
| qwen2.5:0.5b | fizzbuzz | FAIL | FAIL |
| qwen2.5:0.5b | median_bug | FAIL | FAIL |
| deepseek-r1:8b | factorial | FAIL | FAIL |
| deepseek-r1:8b | slugify | FAIL | FAIL |
| deepseek-r1:8b | fizzbuzz | FAIL | FAIL |
| deepseek-r1:8b | median_bug | FAIL | FAIL |

Umumiy vaqt: 5746.1s · warm-up: 28s
