// Round 4: verify vision-capable models on Groq + OpenRouter free vision, with image + tools combined.
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

// 1x1 red PNG
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'set_color',
    description: 'Report the dominant color of the image',
    parameters: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] },
  },
}];

async function visionTest(label, url, key, model, extra = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extra },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What color is this image? Use the set_color tool to answer.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${pngB64}` } },
          ],
        }],
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 2048,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    clearTimeout(t);
    if (res.status !== 200) {
      console.log(`[FAIL] ${label} (${model}) HTTP ${res.status}: ${text.slice(0, 140).replace(/\n/g, ' ')}`);
      return;
    }
    const msg = JSON.parse(text).choices[0].message;
    const tc = msg.tool_calls?.[0];
    console.log(tc ? `[PASS] ${label} (${model}) -> ${tc.function.name}(${String(tc.function.arguments).slice(0, 50)})` : `[WARN] ${label} (${model}) no tool call: ${String(msg.content).slice(0, 80)}`);
  } catch (e) {
    clearTimeout(t);
    console.log(`[FAIL] ${label} (${model}) ${e.name}: ${String(e.message).slice(0, 100)}`);
  }
}

await visionTest('Groq', 'https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, 'meta-llama/llama-4-scout-17b-16e-instruct');
await visionTest('Groq', 'https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, 'meta-llama/llama-4-maverick-17b-128e-instruct');

// list groq models again for exact vision ids
{
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${env.GROQ_API_KEY}` } });
  if (res.ok) {
    const j = await res.json();
    const vision = j.data.map((m) => m.id).filter((id) => /scout|maverick|vision|vl/i.test(id));
    console.log('Groq vision-capable ids:', vision.join(', ') || '(none)');
  }
}

// OpenRouter: any free vision models left?
{
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (res.ok) {
    const j = await res.json();
    const free = j.data.filter((m) => m.id.endsWith(':free') && /vl|vision|scout|maverick|gemini/i.test(m.id)).map((m) => m.id);
    console.log('OpenRouter free vision models:', free.slice(0, 12).join(', ') || '(none)');
  }
}
