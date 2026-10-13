# Local coding model comparison

Generated: 2026-10-11T11:58:13.371Z

Both models ran the same 2 Python tasks sequentially after a warm-up request. The task set covers arithmetic, conditionals, boolean logic, and classification rules. A case counts as a pass only when the agent successfully calls write_file on the exact requested path, creates no extra workspace file, and the restricted-AST harness runs all expected behavior cases successfully.

| Model | Pass rate | Mean task time | Median task time | Warm-up |
|---|---:|---:|---:|---:|
| Qwen3-1.7B (bundled GGUF) | 2/2 (100%) | 30.88s | 33.81s | 0.4s |
| qwen2.5-coder:7b | 1/2 (50%) | 35.7s | 47.85s | 27.93s |

## Per-task results

### Qwen3-1.7B (bundled GGUF)

| Task | Result | Seconds | Tool calls | Peak process RSS | Min available RAM | Verification |
|---|---:|---:|---:|---:|---:|---|
| twice | PASS | 33.81 | 1 | 2730.7 MB | 4245.2 MB | PASS twice 3 cases |
| factorial | PASS | 27.94 | 1 | 3019.6 MB | 3916.8 MB | PASS factorial 4 cases |

### qwen2.5-coder:7b

| Task | Result | Seconds | Tool calls | Peak process RSS | Min available RAM | Verification |
|---|---:|---:|---:|---:|---:|---|
| twice | PASS | 23.55 | 1 | 4987.8 MB | 2033.6 MB | PASS twice 3 cases |
| factorial | FAIL | 47.85 | 2 | 5111.9 MB | 1906.4 MB | expected one top-level function and no other statements |

## Measurement notes
- Host: win32/x64, 6 logical CPUs, 12214.7 MB RAM.
- Bundled model server startup: 5.61s.
- Timed tasks exclude model/server startup and the separate warm-up request.
- GPU VRAM is not measured; RSS is the sampled process-tree resident memory and host RAM is a system-wide available-memory low-water mark.
- This 2-task comparison is still small and synthetic; it does not estimate broad coding accuracy.
