// Round 3: find a reliable FREE provider+model with working tool calls.
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const TOOLS = [{
  type: 'function',
  function: {
    name: 'calc',
    description: 'Calculate an arithmetic expression',
    parameters: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] },
  },
}];

async function call(url, key, body, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extra },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    clearTimeout(t);
    return { status: res.status, text };
  } catch (e) {
    clearTimeout(t);
    return { status: -1, text: `${e.name}: ${e.message}` };
  }
}

function checkToolCall(r, label) {
  if (r.status !== 200) {
    console.log(`[FAIL] ${label} HTTP ${r.status}: ${r.text.slice(0, 150).replace(/\n/g, ' ')}`);
    return false;
  }
  try {
    const msg = JSON.parse(r.text).choices[0].message;
    const tc = msg.tool_calls?.[0];
    if (tc) {
      console.log(`[PASS] ${label} tool-call -> ${tc.function.name}(${String(tc.function.arguments).slice(0, 40)})`);
      return true;
    }
    console.log(`[WARN] ${label} no tool_call, content: ${String(msg.content).slice(0, 80)}`);
    return false;
  } catch (e) {
    console.log(`[FAIL] ${label} parse: ${e.message} | ${r.text.slice(0, 120)}`);
    return false;
  }
}

// Groq: completion + tool calling
{
  const body = { model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'What is 2+2? Use the calc tool.' }], tools: TOOLS, tool_choice: 'auto', max_tokens: 4096 };
  const r = await call('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, body);
  checkToolCall(r, 'Groq gpt-oss-120b');
}
{
  const body = { model: 'qwen/qwen3.8-27b', messages: [{ role: 'user', content: 'What is 2+2? Use the calc tool.' }], tools: TOOLS, tool_choice: 'auto', max_tokens: 4096 };
  const r = await call('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, body);
  checkToolCall(r, 'Groq qwen3.8-27b');
}

// OpenRouter: list free models
{
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: ctrl.signal });
  clearTimeout(t);
  if (res.ok) {
    const j = await res.json();
    const free = j.data.filter((m) => m.id.endsWith(':free') && /deepseek|gemini|llama|qwen|kimi|gpt-oss|glm|mistral/i.test(m.id)).map((m) => m.id);
    console.log('OpenRouter free models (sample):', free.slice(0, 30).join(', '));
  }
}

// Test the most promising free ones for tool calling
for (const model of ['deepseek/deepseek-chat-v3-0324:free', 'google/gemini-2.5-flash:free', 'qwen/qwen3-coder:free']) {
  const body = { model, messages: [{ role: 'user', content: 'What is 2+2? Use the calc tool.' }], tools: TOOLS, tool_choice: 'auto', max_tokens: 2048 };
  const r = await call('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, body, { 'HTTP-Referer': 'https://chatdev.agent', 'X-Title': 'ChatDev Agent' });
  checkToolCall(r, `OpenRouter ${model}`);
}
