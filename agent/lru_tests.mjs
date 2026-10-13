// Neutral LRU test harness: `node lru_tests.mjs <targetDir>` — imports <targetDir>/lru.mjs
// and runs 12 correctness tests + stress vs naive reference + perf check.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.argv[2];
if (!dir) { console.log('USAGE: node lru_tests.mjs <dir>'); process.exit(2); }

let LRUCache;
try {
  ({ LRUCache } = await import(pathToFileURL(path.join(dir, 'lru.mjs')).href));
} catch (e) {
  console.log('IMPORT FAIL:', e.message.slice(0, 120));
  process.exit(1);
}

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: ${String(e.message).slice(0, 90)}`);
  }
};
const eq = (a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

// naive reference
class Naive {
  constructor(cap) {
    this.cap = cap;
    this.items = []; // [{key, value}] — 0 = eng eski
  }
  get(k) {
    const i = this.items.findIndex((x) => x.key === k);
    if (i < 0) return -1;
    const [it] = this.items.splice(i, 1);
    this.items.push(it);
    return it.value;
  }
  put(k, v) {
    const i = this.items.findIndex((x) => x.key === k);
    if (i >= 0) this.items.splice(i, 1);
    else if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ key: k, value: v });
  }
  keys() {
    return this.items.map((x) => x.key);
  }
}

t('1. basic put/get', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  eq(c.get('a'), 1);
});
t('2. miss returns -1', () => {
  const c = new LRUCache(2);
  eq(c.get('x'), -1);
});
t('3. eviction (LIFO emas, LRU)', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  c.put('b', 2);
  c.put('c', 3); // 'a' evicted
  eq(c.get('a'), -1);
  eq(c.get('b'), 2);
  eq(c.get('c'), 3);
});
t('4. get updates recency', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  c.put('b', 2);
  c.get('a'); // 'a' now newest
  c.put('c', 3); // 'b' evicted
  eq(c.get('b'), -1);
  eq(c.get('a'), 1);
});
t('5. put overwrite keeps position', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  c.put('b', 2);
  c.put('a', 9); // overwrite 'a' — 'b' is now oldest
  c.put('c', 3); // evict 'b'
  eq(c.get('b'), -1);
  eq(c.get('a'), 9);
});
t('6. capacity 1', () => {
  const c = new LRUCache(1);
  c.put('a', 1);
  c.put('b', 2);
  eq(c.get('a'), -1);
  eq(c.get('b'), 2);
});
t('7. zero/false values preserved', () => {
  const c = new LRUCache(3);
  c.put('z', 0);
  c.put('n', null);
  eq(c.get('z'), 0);
  eq(c.get('n'), null);
});
t('8. size never exceeds capacity', () => {
  const c = new LRUCache(3);
  for (let i = 0; i < 50; i++) c.put(`k${i}`, i);
  eq(c.keys().length, 3);
  eq(c.get('k0'), -1);
  eq(c.get('k49'), 49);
});
t('9. keys order (old -> new)', () => {
  const c = new LRUCache(3);
  c.put('a', 1);
  c.put('b', 2);
  c.put('c', 3);
  c.get('a');
  eq(c.keys(), ['b', 'c', 'a']);
});
t('10. invalid capacity rejected', () => {
  let threw = false;
  try {
    new LRUCache(0);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('capacity=0 uchun xato berilmadi');
});
t('11. stress 5000 ops vs naive', () => {
  const c = new LRUCache(7);
  const n = new Naive(7);
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 5000; i++) {
    const k = 'k' + Math.floor(rnd() * 12);
    if (rnd() < 0.5) {
      const v = Math.floor(rnd() * 100);
      c.put(k, v);
      n.put(k, v);
    } else {
      eq(c.get(k), n.get(k));
    }
    if (i % 500 === 0) eq(c.keys(), n.keys());
  }
  eq(c.keys(), n.keys());
});
t('12. perf: 100k ops < 2s', () => {
  const c = new LRUCache(1000);
  const t0 = Date.now();
  for (let i = 0; i < 100000; i++) c.put('k' + (i % 2000), i);
  for (let i = 0; i < 100000; i++) c.get('k' + (i % 2000));
  const dt = Date.now() - t0;
  if (dt > 2000) throw new Error(`juda sekin: ${dt}ms (O(n) bo'lishi mumkin)`);
});

console.log(`\n${dir}: ${pass}/12 PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
