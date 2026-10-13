// Research: OpenRouter free models (deepseek?), Gemini direct status.
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

// 1. OpenRouter free models — full useful list
{
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const j = await res.json();
  const free = j.data.filter((m) => m.id.endsWith(':free'));
  console.log(`OpenRouter free models (${free.length}):`);
  for (const m of free) {
    const ctx = m.context_length ? `${Math.round(m.context_length / 1000)}k` : '?';
    console.log(`  ${m.id}  [ctx ${ctx}]`);
  }
  const ds = j.data.filter((m) => /deepseek/i.test(m.id));
  console.log(`\nDeepSeek on OpenRouter (${ds.length}):`);
  for (const m of ds.slice(0, 15)) console.log(`  ${m.id}  free=${m.id.endsWith(':free')}`);
}

// 2. Gemini direct — plain text call (fresh status today)
{
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GEMINI_API_KEY}` },
      body: JSON.stringify({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'Reply: OK' }], max_tokens: 1000 }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    console.log(`\nGemini direct (gemini-3.8-flash): HTTP ${res.status} — ${res.status === 200 ? 'OK ✅' : text.slice(0, 140).replace(/\n/g, ' ')}`);
  } catch (e) {
    console.log('\nGemini direct failed:', e.message);
  }
  // also list models available to this key
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    if (res.ok) {
      const j = await res.json();
      const names = (j.models || []).map((m) => m.name.replace('models/', '')).filter((n) => /flash|pro/i.test(n)).slice(0, 20);
      console.log('Gemini key model list sample:', names.join(', '));
    } else console.log(`Gemini model list: HTTP ${res.status}`);
  } catch (e) {
    console.log('Gemini list failed:', e.message.slice(0, 100));
  }
}
