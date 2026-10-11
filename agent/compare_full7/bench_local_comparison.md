# Local coding model comparison

Generated: 2026-10-11T17:59:30.192Z

Both models ran the same 7 selected Python tasks sequentially after a warm-up request; see the JSON caseSelection for the exact subset. The complete task library spans arithmetic and control-flow patterns. A case counts as a pass only when the agent successfully calls write_file on the exact requested path, creates no extra workspace file, and the restricted-AST harness runs all expected behavior cases successfully.

| Model | Pass rate | Mean task time | Median task time | Warm-up |
|---|---:|---:|---:|---:|
| Qwen3-1.7B (bundled GGUF) | 6/7 (86%) | 41.95s | 42.39s | 0.41s |
| qwen2.5-coder:7b | 6/7 (86%) | 26.71s | 25.09s | 35.03s |

## Per-task results

### Qwen3-1.7B (bundled GGUF)

| Task | Result | Seconds | Tool calls | Peak process RSS | Min available RAM | Verification |
|---|---:|---:|---:|---:|---:|---|
| twice | PASS | 33.88 | 1 | 2730.7 MB | 2202.8 MB | PASS twice 3 cases |
| sum_to_n | PASS | 42.39 | 1 | 3009.1 MB | 1948 MB | PASS sum_to_n 4 cases |
| clamp | PASS | 51.93 | 1 | 2684.5 MB | 2232.3 MB | PASS clamp 6 cases |
| is_even | PASS | 36.86 | 1 | 2973.9 MB | 1820 MB | PASS is_even 4 cases |
| factorial | FAIL | 36.93 | 1 | 3246.3 MB | 1533.9 MB | wrong result for [0]: 0 != 1 |
| shipping_fee | PASS | 48.01 | 1 | 3524.5 MB | 1255.7 MB | PASS shipping_fee 6 cases |
| letter_grade | PASS | 43.64 | 1 | 3813.6 MB | 974.7 MB | PASS letter_grade 10 cases |

### qwen2.5-coder:7b

| Task | Result | Seconds | Tool calls | Peak process RSS | Min available RAM | Verification |
|---|---:|---:|---:|---:|---:|---|
| twice | PASS | 24.1 | 1 | 4987.6 MB | 600.5 MB | PASS twice 3 cases |
| sum_to_n | PASS | 24.93 | 1 | 5109.9 MB | 355.1 MB | PASS sum_to_n 4 cases |
| clamp | PASS | 25.09 | 1 | 5233.9 MB | 242.9 MB | PASS clamp 6 cases |
| is_even | PASS | 23.2 | 1 | 5356.3 MB | 494.5 MB | PASS is_even 4 cases |
| factorial | FAIL | 32.91 | 1 | 5477.4 MB | 391.2 MB | expected one top-level function and no other statements |
| shipping_fee | PASS | 27.52 | 1 | 5592.1 MB | 429.1 MB | PASS shipping_fee 6 cases |
| letter_grade | PASS | 29.23 | 1 | 5715.6 MB | 419 MB | PASS letter_grade 10 cases |

## Measurement notes
- Host: win32/x64, 6 logical CPUs, 12214.7 MB RAM.
- Bundled model server startup: 5.13s.
- Timed tasks exclude model/server startup and the separate warm-up request.
- GPU VRAM is not measured; RSS is the sampled process-tree resident memory and host RAM is a system-wide available-memory low-water mark.
- This 7-task comparison is still small and synthetic; it does not estimate broad coding accuracy.
