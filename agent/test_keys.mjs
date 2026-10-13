// Scratch: test which API keys from .env actually work. Never prints keys.
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');

function parseEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  // DeepSeek key is pasted as plain text: "DEEPSEEK\n\nsk-xxxxx"
  if (!out.DEEPSEEK_API_KEY) {
    const m = raw.match(/\bsk-(?!or-)[0-9a-f]{16,}\b/);
    if (m) out.DEEPSEEK_API_KEY = m[0];
  }
  return out;
}

const env = parseEnv(raw);
console.log('Keys found:', Object.keys(env).filter((k) => k.includes('KEY')).join(', '));

async function ping(name, url, key, model, extraHeaders = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 2000,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    if (res.ok) {
      let content = '';
      try {
        const j = JSON.parse(text);
        content = j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 120);
      } catch {
        content = text.slice(0, 120);
      }
      console.log(`[PASS] ${name} (${model}) -> ${String(content).slice(0, 60).replace(/\n/g, ' ')}`);
    } else {
      console.log(`[FAIL] ${name} (${model}) HTTP ${res.status}: ${text.slice(0, 200).replace(/\n/g, ' ')}`);
    }
  } catch (e) {
    console.log(`[FAIL] ${name} (${model}) ${e.name}: ${String(e.message).slice(0, 150)}`);
  }
}

const jobs = [];
if (env.GEMINI_API_KEY) jobs.push(() => ping('Gemini-direct', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env.GEMINI_API_KEY, 'gemini-2.5-flash'));
if (env.OPENROUTER_API_KEY) jobs.push(() => ping('OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, 'google/gemini-2.5-flash', { 'HTTP-Referer': 'http://localhost', 'X-Title': 'ChatDevAgent' }));
if (env.GROQ_API_KEY) jobs.push(() => ping('Groq', 'https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, 'llama-3.3-70b-versatile'));
if (env.DEEPSEEK_API_KEY) jobs.push(() => ping('DeepSeek', 'https://api.deepseek.com/v1/chat/completions', env.DEEPSEEK_API_KEY, 'deepseek-chat'));

for (const j of jobs) await j();
