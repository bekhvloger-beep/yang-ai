// Test the vck_ token from .env (user says it's Vercel) against Vercel AI Gateway.
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const vck = (raw.match(/\bvck_[A-Za-z0-9]+\b/) || [])[0];
if (!vck) { console.log('vck_ token topilmadi'); process.exit(0); }
console.log('vck_ token topildi (uzunligi ' + vck.length + ')');

const BASES = ['https://ai-gateway.vercel.sh/v1', 'https://api.vercel.ai/v1'];

for (const base of BASES) {
  try {
    const res = await fetch(base + '/models', {
      headers: { authorization: `Bearer ${vck}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const j = await res.json();
      const ids = (j.data || []).map((m) => m.id);
      console.log(`\n[OK] ${base}/models -> ${ids.length} model`);
      const interesting = ids.filter((i) => /free|gemini|gpt-4o-mini|deepseek|qwen|llama|image/i.test(i)).slice(0, 25);
      console.log('  namuna:', interesting.join(', '));
      // tiny completion
      const use = ids.find((i) => /gpt-4o-mini|gemini-2.0-flash|flash|mini/i.test(i)) || ids[0];
      const c = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${vck}` },
        body: JSON.stringify({ model: use, messages: [{ role: 'user', content: 'Reply: OK' }], max_tokens: 500 }),
        signal: AbortSignal.timeout(30000),
      });
      const ct = await c.text();
      console.log(`  chat (${use}): HTTP ${c.status} — ${c.status === 200 ? String(JSON.parse(ct).choices?.[0]?.message?.content).slice(0, 40) : ct.slice(0, 140)}`);
    } else {
      console.log(`[${res.status}] ${base}/models — ${(await res.text()).slice(0, 140)}`);
    }
  } catch (e) {
    console.log(`[ERR] ${base} — ${e.name}: ${String(e.message).slice(0, 100)}`);
  }
}

// Gemini native image generation check (their key lists image models)
const gemKey = (raw.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m) || [])[1];
if (gemKey) {
  console.log('\n=== Gemini image generation (gemini-2.5-flash-image) ===');
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': gemKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Generate a simple image: a blue hexagon on white background' }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
      signal: AbortSignal.timeout(90000),
    });
    const t = await res.text();
    if (res.ok) {
      const j = JSON.parse(t);
      const parts = j.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData || p.inline_data);
      console.log(img ? `[OK] image generated (${((img.inlineData?.data || img.inline_data?.data || '').length / 1024).toFixed(0)} KB base64, mime: ${img.inlineData?.mimeType || img.inline_data?.mime_type})` : `[WARN] image yo'q, parts: ${JSON.stringify(parts).slice(0, 200)}`);
    } else {
      console.log(`[FAIL] HTTP ${res.status}: ${t.slice(0, 180)}`);
    }
  } catch (e) {
    console.log('[ERR]', e.message);
  }
}
