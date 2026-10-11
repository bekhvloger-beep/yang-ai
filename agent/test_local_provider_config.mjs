import assert from 'node:assert/strict';
import { getAllProviders, getProviderKey, isLocalProviderBase } from './providers.js';

for (const base of [
  'http://localhost:11434/v1',
  'http://127.0.0.1:1234/v1',
  'http://127.0.0.2:8000/v1',
  'http://[::1]:1234/v1',
]) {
  assert.equal(isLocalProviderBase(base), true, `${base} should be treated as a loopback endpoint`);
}
for (const base of [
  'https://localhost:11434/v1',
  'http://192.168.1.10:1234/v1',
  'http://127.0.0.1.example.com/v1',
  'not a URL',
]) {
  assert.equal(isLocalProviderBase(base), false, `${base} must not be treated as a keyless local endpoint`);
}

const config = {
  customProviders: [
    { id: 'ollama', name: 'Ollama', base: 'http://localhost:11434/v1', models: ['qwen2.5-coder:7b'] },
    { id: 'lmstudio', name: 'LM Studio', base: 'http://127.0.0.1:1234/v1', models: ['local-model'], key: '' },
    { id: 'remote', name: 'Remote', base: 'http://192.168.1.10:1234/v1', models: ['remote-model'] },
  ],
  keys: {},
};
const providers = getAllProviders(config);
assert.equal(providers.ollama.local, true);
assert.equal(providers.ollama.keyless, true);
assert.equal(getProviderKey(config, 'ollama'), '');
assert.equal(providers.lmstudio.keyless, true);
assert.equal(providers.remote.local, false);
assert.equal(providers.remote.keyless, false);

console.log('PASS: loopback local model endpoints are keyless and marked local');
console.log('PASS: remote and malformed endpoints do not bypass API-key requirements');
