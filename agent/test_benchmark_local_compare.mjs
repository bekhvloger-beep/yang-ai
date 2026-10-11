import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const benchmark = fs.readFileSync(path.join(here, 'benchmark_local_compare.mjs'), 'utf8');
const validator = benchmark.match(/const AST_VALIDATOR = String\.raw`([\s\S]*?)`;/)?.[1];
assert.ok(validator, 'benchmark should contain a strict Python behavior validator');
const pyAvailable = spawnSync('python', ['-c', 'import ast'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
if (pyAvailable.status !== 0) {
  console.log('SKIP: Python is unavailable for the benchmark validator tests');
} else {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-compare-validator-'));
  try {
    const spec = { name: 'twice', args: ['n'], tests: [[[-7], -14], [[0], 0], [[13], 26]] };
    const source = path.join(workspace, 'candidate.py');
    fs.writeFileSync(source, 'def twice(n):\n    return n * 2\n');
    let result = spawnSync('python', ['-I', '-B', '-c', validator, source, JSON.stringify(spec)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || 'valid implementation was rejected');
    assert.match(result.stdout, /PASS twice 3 cases/);

    fs.writeFileSync(source, 'def twice(n):\n    return n + 2\n');
    result = spawnSync('python', ['-I', '-B', '-c', validator, source, JSON.stringify(spec)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.notEqual(result.status, 0, 'incorrect behavior must fail the harness');

    fs.writeFileSync(source, 'def twice(n):\n    return sum(range(n + 1))\n');
    result = spawnSync('python', ['-I', '-B', '-c', validator, source, JSON.stringify(spec)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.notEqual(result.status, 0, 'valid-but-wrong behavior must fail');

    fs.writeFileSync(source, 'def twice(n):\n    import os\n    os.remove("important.txt")\n    return n * 2\n');
    result = spawnSync('python', ['-I', '-B', '-c', validator, source, JSON.stringify(spec)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.notEqual(result.status, 0, 'imports and side-effecting code must be rejected');
    assert.match(result.stderr, /blocked syntax: Import/);

    const factorialSpec = { name: 'factorial', args: ['n'], tests: [[[0], 1], [[1], 1], [[5], 120]] };
    fs.writeFileSync(source, 'def factorial(n):\n    # Start with the empty product.\n    result = 1\n    for i in range(1, n + 1):\n        result *= i\n    return result\n');
    result = spawnSync('python', ['-I', '-B', '-c', validator, source, JSON.stringify(factorialSpec)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || 'correct loop implementation with a comment should pass');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  console.log('PASS: benchmark harness accepts correct code and rejects wrong results/import side effects');
}

for (const required of ['twice', 'sum_to_n', 'clamp', 'is_even', 'factorial', 'shipping_fee', 'letter_grade']) assert.ok(benchmark.includes(`name: '${required}'`));
assert.match(benchmark, /CASES\.length/);
assert.match(benchmark, /YANG_COMPARE_CASES/);
assert.match(benchmark, /CASE_FILTER\.join\('_'\)/);
assert.match(validator, /ast\.For/);
assert.match(validator, /ast\.Mod/);
assert.match(benchmark, /OLLAMA_ROOT_PIDS/);
assert.match(benchmark, /localServer\.kill\(\)/);
assert.match(benchmark, /assert\.ok\(!occupied/);
assert.match(benchmark, /gpuMemoryMeasured: false/);
const focusedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-compare-focused-'));
const runsScript = (source, spec, label) => {
  const candidate = path.join(focusedWorkspace, `${label}.py`);
  fs.writeFileSync(candidate, source);
  const check = spawnSync('python', ['-I', '-B', '-c', validator, candidate, JSON.stringify(spec)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  return check;
};
if (pyAvailable.status === 0) {
  const quarter = runsScript('def quarter_from_month(month):\n    if month <= 0 or month > 12:\n        return 0\n    elif month <= 3:\n        return 1\n    elif month <= 6:\n        return 2\n    elif month <= 9:\n        return 3\n    return 4\n', { name: 'quarter_from_month', args: ['month'], tests: [[[3], 1], [[4], 2], [[12], 4], [[13], 0]] }, 'quarter');
  assert.equal(quarter.status, 0, quarter.stderr || 'correct quarter implementation should pass');
  const prime = runsScript('def is_prime(n):\n    if n < 2:\n        return False\n    for divisor in range(2, n):\n        if n % divisor == 0:\n            return False\n    return True\n', { name: 'is_prime', args: ['n'], tests: [[[1], false], [[2], true], [[9], false], [[17], true]] }, 'prime');
  assert.equal(prime.status, 0, prime.stderr || 'correct prime implementation should pass');
}
fs.rmSync(focusedWorkspace, { recursive: true, force: true });
console.log('PASS: expanded benchmark validator accepts safe loop, modulo and conditional implementations');
console.log('PASS: comparison benchmark includes an expanded task suite, supports focused selections, and guards the existing Ollama service');
