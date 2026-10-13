# Local coding model comparison

Generated: 2026-10-11T12:11:20.089Z

Both models ran the same 1 selected Python tasks sequentially after a warm-up request; see the JSON caseSelection for the exact subset. The complete task library spans arithmetic and control-flow patterns. A case counts as a pass only when the agent successfully calls write_file on the exact requested path, creates no extra workspace file, and the restricted-AST harness runs all expected behavior cases successfully.

| Model | Pass rate | Mean task time | Median task time | Warm-up |
|---|---:|---:|---:|---:|
| Qwen3-1.7B (bundled GGUF) | 1/1 (100%) | 24.05s | 24.05s | 0.3s |
| qwen2.5-coder:7b | 1/1 (100%) | 24.81s | 24.81s | 24.24s |

## Per-task results

### Qwen3-1.7B (bundled GGUF)

| Task | Result | Seconds | Tool calls | Peak process RSS | Min available RAM | Verification |
|---|---:|---:|---:|---:|---:|---|
| twice | PASS | 24.05 | 1 | 2730.9 MB | 4196.3 MB | PASS twice 3 cases |

### qwen2.5-coder:7b

| Task | Result | Seconds | Tool calls | Peak process RSS | Min available RAM | Verification |
|---|---:|---:|---:|---:|---:|---|
| twice | PASS | 24.81 | 1 | 4988 MB | 2019.9 MB | PASS twice 3 cases |

## Measurement notes
- Host: win32/x64, 6 logical CPUs, 12214.7 MB RAM.
- Bundled model server startup: 4.57s.
- Timed tasks exclude model/server startup and the separate warm-up request.
- GPU VRAM is not measured; RSS is the sampled process-tree resident memory and host RAM is a system-wide available-memory low-water mark.
- This 1-task comparison is still small and synthetic; it does not estimate broad coding accuracy.
