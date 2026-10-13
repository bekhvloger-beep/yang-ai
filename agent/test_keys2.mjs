// Scratch round 2: find working models + verify tool calling on the primary provider.
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}
const deep = raw.match(/\bsk-(?!or-)[0-9a-f]{16,}\b/);
if (deep) env.DEEPSEEK_API_KEY = deep[0];

async function call(url, key, body, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extra },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
  clearTimeout(t);
  return { status: res.status, text: await res.text() };
}

// 1. Gemini direct with gemini-3.8-flash
{
  const r = await call('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env.GEMINI_API_KEY, { model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 2000 });
  console.log(r.status === 200 ? `[PASS] Gemini gemini-3.8-flash -> ${JSON.parse(r.text).choices[0].message.content.slice(0, 40)}` : `[FAIL] Gemini 3.8: HTTP ${r.status} ${r.text.slice(0, 160)}`);
}

// 2. Groq: list models
{
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${env.GROQ_API_KEY}` }, signal: ctrl.signal });
  clearTimeout(t);
  if (res.ok) {
    const j = await res.json();
    const ids = (j.data || []).map((m) => m.id).filter((id) => /tool|llama|qwen|gpt|kimi|glm/i.test(id)).slice(0, 40);
    console.log('Groq models sample:', ids.join(', '));
  } else console.log(`Groq list failed HTTP ${res.status}`);
}

// 3. OpenRouter: tool calling round-trip with gemini-2.5-flash
{
  const r = await call('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, {
    model: 'google/gemini-2.5-flash',
    messages: [{ role: 'user', content: 'What is 2+2? Use the calc tool.' }],
    tools: [{ type: 'function', function: { name: 'calc', description: 'Calculate an arithmetic expression', parameters: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] } } }],
    tool_choice: 'auto',
    max_tokens: 2000,
  }, { 'HTTP-Referer': 'http://localhost', 'X-Title': 'ChatDevAgent' });
  if (r.status === 200) {
    const msg = JSON.parse(r.text).choices[0].message;
    const tc = msg.tool_calls?.[0];
    console.log(tc ? `[PASS] OpenRouter tool-call -> ${tc.function.name}(${tc.function.arguments.slice(0, 60)})` : `[WARN] OpenRouter no tool_call: ${JSON.stringify(msg).slice(0, 120)}`);
  } else console.log(`[FAIL] OpenRouter tool-call HTTP ${r.status}: ${r.text.slice(0, 200)}`);
}

// 4. OpenRouter free/deepseek fallback check (cheap models for fallback list)
for (const model of ['deepseek/deepseek-chat-v3-0324', 'google/gemini-2.0-flash-001']) {
  const r = await call('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, { model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 1000 }, { 'HTTP-Referer': 'http://localhost', 'X-Title': 'ChatDevAgent' });
  console.log(r.status === 200 ? `[PASS] OpenRouter ${model}` : `[FAIL] OpenRouter ${model}: HTTP ${r.status} ${r.text.slice(0, 120)}`);
}
