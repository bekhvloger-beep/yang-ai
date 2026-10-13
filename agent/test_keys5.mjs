// Round 5: vision via Gemini direct + OpenRouter paid (credit check).
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function visionTest(label, url, key, model, maxTokens, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extra },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Say the dominant color of this image, one word.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${pngB64}` } }] }],
        max_tokens: maxTokens,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    clearTimeout(t);
    if (res.status !== 200) {
      console.log(`[FAIL] ${label} (${model}) HTTP ${res.status}: ${text.slice(0, 160).replace(/\n/g, ' ')}`);
      return;
    }
    const j = JSON.parse(text);
    console.log(`[PASS] ${label} (${model}) -> ${String(j.choices?.[0]?.message?.content).slice(0, 60).replace(/\n/g, ' ')}`);
  } catch (e) {
    clearTimeout(t);
    console.log(`[FAIL] ${label} (${model}) ${e.name}: ${String(e.message).slice(0, 100)}`);
  }
}

await visionTest('Gemini-direct', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env.GEMINI_API_KEY, 'gemini-3.8-flash', 1024);
await visionTest('Gemini-direct', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env.GEMINI_API_KEY, 'gemini-2.5-flash', 1024);
await visionTest('OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, 'google/gemini-2.5-flash', 512, { 'HTTP-Referer': 'https://chatdev.agent', 'X-Title': 'ChatDev Agent' });

// OpenRouter credits check
{
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', { headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}` } });
    if (res.ok) {
      const j = await res.json();
      const d = j.data || {};
      console.log(`OpenRouter credits: total=$${d.total_credits} used=$${d.usage} remaining=$${(d.total_credits - d.usage).toFixed(4)}`);
    } else console.log(`OpenRouter credits HTTP ${res.status}`);
  } catch (e) {
    console.log('OpenRouter credits failed:', e.message);
  }
}

// Groq quota headers snapshot
{
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${env.GROQ_API_KEY}` } });
  const h = res.headers;
  const get = (n) => h.get(n);
  console.log('Groq quota headers:', JSON.stringify({
    'x-ratelimit-limit-req': get('x-ratelimit-limit-requests'),
    'x-ratelimit-limit-tok': get('x-ratelimit-limit-tokens'),
    'x-ratelimit-remaining-req': get('x-ratelimit-remaining-requests'),
    'x-ratelimit-remaining-tok': get('x-ratelimit-remaining-tokens'),
    'x-ratelimit-reset-tokens': get('x-ratelimit-reset-tokens'),
  }));
}
