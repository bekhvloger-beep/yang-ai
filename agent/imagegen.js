// imagegen.js — AI image GENERATION via provider chain (Gemini native -> OpenAI -> OpenRouter -> Vercel Gateway).
// Each provider gets its own shot; first success returns the image buffer.
export const GEMINI_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];

const OPENAI_IMAGE_MODELS = ['gpt-image-1', 'dall-e-3'];

async function openaiNative(prompt, key, signal, size = '1024x1024') {
  let lastErr;
  for (const model of OPENAI_IMAGE_MODELS) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json' }),
        signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      const j = JSON.parse(text);
      const b64 = j.data?.[0]?.b64_json;
      if (!b64) throw new Error('javobda rasm yo‘q');
      return { buffer: Buffer.from(b64, 'base64'), mime: 'image/png', via: `OpenAI · ${model}` };
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('OpenAI image ishlamadi');
}

async function geminiNative(prompt, key, signal) {
  let lastErr;
  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      const j = JSON.parse(text);
      const parts = j.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData || p.inline_data);
      if (!img) throw new Error('javobda rasm yo‘q');
      const d = img.inlineData || img.inline_data;
      return {
        buffer: Buffer.from(d.data, 'base64'),
        mime: d.mimeType || d.mime_type || 'image/png',
        via: `Gemini · ${model}`,
      };
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('Gemini image ishlamadi');
}

const OPENAI_STYLE_ATTEMPTS = [
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash-image', extra: { 'HTTP-Referer': 'https://aicomp.uz', 'X-Title': 'YANG AI' } },
  { id: 'vercel', name: 'Vercel Gateway', base: 'https://ai-gateway.vercel.sh/v1', model: 'google/gemini-2.5-flash-image', extra: {} },
];

export async function generateImage({ prompt, config, signal, size = '1024x1024' }) {
  const keys = config.keys || {};
  const errors = [];
  if (keys.gemini) {
    try {
      return await geminiNative(prompt, keys.gemini, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(`Gemini: ${String(e.message).slice(0, 120)}`);
    }
  }
  if (keys.openai) {
    try {
      return await openaiNative(prompt, keys.openai, signal, size);
    } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(`OpenAI: ${String(e.message).slice(0, 120)}`);
    }
  }
  for (const a of OPENAI_STYLE_ATTEMPTS) {
    if (!keys[a.id]) continue;
    try {
      const res = await fetch(a.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${keys[a.id]}`, ...(a.extra || {}) },
        body: JSON.stringify({ model: a.model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 }),
        signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      const msg = JSON.parse(text).choices?.[0]?.message || {};
      const imgUrl = msg.images?.[0]?.image_url?.url;
      if (!imgUrl) throw new Error('javobda rasm yo‘q');
      const m = String(imgUrl).match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) throw new Error('rasm formati tushunarsiz');
      return { buffer: Buffer.from(m[2], 'base64'), mime: m[1], via: `${a.name} · ${a.model}` };
    } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(`${a.name}: ${String(e.message).slice(0, 120)}`);
    }
  }
  throw new Error(
    'Rasm generatsiyasi hozircha hech bir provayderda mavjud emas:\n' +
    (errors.length ? errors.join('\n') + '\n' : '') +
    '(Gemini image free kvotasi tugagan — kunda yangilanadi; Vercel Gateway uchun vercel.com hisobiga karta ulang)'
  );
}
