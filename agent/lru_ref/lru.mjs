// LRU Cache — O(1) get/put via Map insertion-order (GLM 5.3 reference solution)
export class LRUCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('capacity musbat butun son bo‘lishi kerak');
    }
    this.capacity = capacity;
    this.map = new Map(); // Map iteration order = insertion order (oldest first)
  }

  get(key) {
    if (!this.map.has(key)) return -1;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value); // refresh recency
    return value;
  }

  put(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      this.map.delete(this.map.keys().next().value); // evict oldest
    }
    this.map.set(key, value);
  }

  has(key) {
    return this.map.has(key);
  }

  keys() {
    return [...this.map.keys()];
  }

  get size() {
    return this.map.size;
  }
}
