// translate.js — lokal NLLB tarjimon servisi (translator/server.py) bilan aloqa. Pure Node.
// Servis o'chiq bo'lsa ham agent ishlashda davom etadi — tarjima shunchaki o'tkazib yuboriladi.

const HEALTH_TTL = 15000;
let cache = { ts: 0, up: false };

export function translateSettings(config) {
  const t = (config && config.translate) || {};
  return {
    enabled: t.enabled !== false,
    url: t.url || 'http://127.0.0.1:8788',
    target: t.target || 'uzn_Latn',
  };
}

// fresh=true — keshni chetlab o'tib hozir tekshiradi (tarjimon kutishda kerak:
// birinchi muvaffaqiyatsiz probe 15 s davomida "o'chiq" bo'lib keshlanardi).
export async function translatorUp(config, { fresh = false } = {}) {
  const s = translateSettings(config);
  if (!s.enabled) return false;
  if (!fresh && Date.now() - cache.ts < HEALTH_TTL) return cache.up;
  try {
    const res = await fetch(s.url + '/health', { signal: AbortSignal.timeout(2500) });
    cache = { ts: Date.now(), up: res.ok };
  } catch {
    cache = { ts: Date.now(), up: false };
  }
  return cache.up;
}

// Sovuq start kutish: ilova ishlatadigan bundled python (translator/runtime/python +
// translator/model) bilan o'lchandi: 2258 ms va 3110 ms (2 o'lchov, 2026-10-07).
// 8 s = o'lchovning ~2.5 barobari — sekin disk/antivirus uchun zaxira, lekin 20 s kabi
// uzoq "osilib" qolmaydi.
const TRANSLATOR_COLD_START_MS = 8000;
// Bir marta kutib bo'lmay qolsa keyingi 5 daqiqada qayta kutmaymiz — tarjimon umuman
// ko'tarilmasa, har bir xabar kutish bilan boshlanmasin.
const TRANSLATOR_FAIL_MEMO_MS = 5 * 60 * 1000;
let waitFailedAt = 0;

// Tarjimon tayyor bo'lishini kutadi (fon rejimida ko'tariladi). Tayyor bo'lmasa false.
export async function waitTranslatorReady(config) {
  if (Date.now() - waitFailedAt < TRANSLATOR_FAIL_MEMO_MS) return translatorUp(config);
  const started = Date.now();
  let delay = 250;
  for (;;) {
    if (await translatorUp(config, { fresh: true })) return true;
    if (Date.now() - started >= TRANSLATOR_COLD_START_MS) {
      waitFailedAt = Date.now();
      return false;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.6), 1500);
  }
}

// target: NLLB til kodi ('uzn_Latn' | 'eng_Latn'). source 'auto' — servis o'zi aniqlaydi.
// Muvaffaqiyatsizlikda null qaytaradi (chaqiruvchi asl matnni ishlatadi).
export async function translateText(config, text, { target } = {}) {
  const s = translateSettings(config);
  if (!s.enabled || !text || !text.trim()) return null;
  try {
    const res = await fetch(s.url + '/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, target: target || s.target, source: 'auto' }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.translated === 'string' && j.translated.trim() ? j.translated : null;
  } catch {
    return null;
  }
}
