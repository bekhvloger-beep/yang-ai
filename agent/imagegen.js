// imagegen.js — AI image GENERATION.
//
// ZANJIR: LOKAL (stable-diffusion.cpp, API va kalitsiz) → Gemini native → OpenAI →
// OpenRouter → Vercel Gateway. Har bir provayder o'z urinishini oladi; birinchi
// muvaffaqiyat darhol qaytadi.
//
// Nega lokal birinchi: rasm generatsiyasi bulutda PUL/kvota talab qiladi va Gemini image
// bepul kvotasi tez tugaydi ("Rasm generatsiyasi hozircha hech bir provayderda mavjud emas"
// xatosi shundan edi). Endi kompyuterda `sd-cli.exe` + rasm modeli bo'lsa, rasm butunlay
// offline yaratiladi (o'lchandi: 512×512 · 20 qadam ≈ 168 s, Radeon RX 580).
import { generateLocalImage, resolveSdDirs } from './local_sd.js';

export const GEMINI_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];

/** Katalogdagi o'lchamlar: SD1.5/SD-Turbo 512 px da o'rgatilgan (1024 px da sifat buziladi). */
function localSizeFor(size, fallback = '512x512') {
  const m = String(size || '').match(/^(\d{2,4})\s*[x×*]\s*(\d{2,4})$/);
  if (!m) return fallback;
  const w = Math.min(1024, Number(m[1]) || 512);
  const h = Math.min(1024, Number(m[2]) || 512);
  const side = Math.max(256, Math.min(512, Math.min(w, h)));
  return `${side}x${side}`;
}

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
  const keys = (config && config.keys) || {};
  const local = (config && config.imagegen) || {};
  const errors = [];

  // 0) LOKAL — internet, API kaliti va kvota kerak emas (`local: false` bilan o'chirish mumkin).
  if (local.local !== false) {
    try {
      const r = await generateLocalImage({
        prompt,
        negative: local.negative || '',
        size: local.size || localSizeFor(size),
        steps: local.steps,
        cfgScale: local.cfgScale,
        seed: local.seed ?? -1,
        vaeTiling: local.vaeTiling !== false,
        dirs: resolveSdDirs(local.dirs || []),
        signal,
      });
      return { buffer: r.buffer, mime: r.mime, via: `${r.via} · ${r.width}×${r.height} · ${r.steps} qadam` };
    } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(`Lokal: ${String(e.message).slice(0, 140)}`);
    }
  }
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
    '(Gemini image free kvotasi tugagan — kunda yangilanadi; Vercel Gateway uchun vercel.com hisobiga karta ulang.\n' +
    'Eng ishonchli yo‘l — LOKAL rasm dvigatelini o‘rnatish: YANG IDE → «Lokal AI» menyusi → «Rasm dvigateli» + «Rasm modellari».)'
  );
}
