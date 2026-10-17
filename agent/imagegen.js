// imagegen.js — rasm yaratish: FAQAT LOKAL (stable-diffusion.cpp).
//
// Ilgari bu zanjir bulutga ham tushardi: lokal → Gemini → OpenAI → OpenRouter → Vercel.
// Natijada lokal dvigatel o‘rnatilmagan bo‘lsa rasm **API kaliti va kvota** bilan
// yaratilardi — foydalanuvchi talabiga ko‘ra bu YO‘Q QILINDI: rasm generatsiyasi API
// chaqirmaydi, internet talab qilmaydi va kalit ishlatmaydi.
//
// Dvigatel yoki model bo‘lmasa — aniq, bajariladigan xato qaytadi (jimgina bulutga
// o‘tish yo‘q). Rasmni faqat `Lokal AI menejeri` → «Rasm dvigateli» + «Rasm modellari»
// o‘rnatilgandan keyin yaratish mumkin.
import { generateLocalImage, resolveSdDirs, sdStatus } from './local_sd.js';

/** SD1.5/SD-Turbo 512 px da o‘rgatilgan: kattaroq o‘lcham sifatni buzadi va vaqtni oshiradi. */
function localSizeFor(size, fallback = '512x512') {
  const m = String(size || '').match(/^(\d{2,4})\s*[x×*]\s*(\d{2,4})$/);
  if (!m) return fallback;
  const w = Math.min(1024, Number(m[1]) || 512);
  const h = Math.min(1024, Number(m[2]) || 512);
  const side = Math.max(256, Math.min(512, Math.min(w, h)));
  return `${side}x${side}`;
}

/** Dvigatel holati — UI «Rasm yaratish» tugmasini oldindan tushuntirishi uchun. */
export function imageEngineStatus(dirs = []) {
  const st = sdStatus({ dirs: resolveSdDirs(dirs) });
  return {
    available: st.available,
    backend: st.backend || null,
    exe: st.exe || null,
    model: st.model ? st.model.file : null,
    reason: st.reason || '',
  };
}

function notReady(reason) {
  return new Error(
    'Rasm faqat LOKAL AI bilan yaratiladi (API va kalit ishlatilmaydi).\n' +
    `Sabab: ${reason || 'lokal rasm dvigateli topilmadi'}.\n` +
    'Nima qilish kerak: «Lokal AI» menyusi → «Lokal AI menejeri» → «Rasm dvigateli» ni ' +
    'o‘rnating (17–30 MB), so‘ng «Rasm modellari» dan model yuklang (2,1 GB).'
  );
}

/**
 * Matn → rasm. Faqat lokal; bulut zaxirasi YO‘Q.
 * @returns {Promise<{buffer: Buffer, mime: string, via: string, width: number, height: number, steps: number}>}
 */
export async function generateImage({ prompt, config, signal, size = '512x512' } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('prompt bo‘sh');

  const local = (config && config.imagegen) || {};
  const dirs = resolveSdDirs(local.dirs || []);
  const status = sdStatus({ dirs });
  if (!status.available) throw notReady(status.reason);

  const r = await generateLocalImage({
    prompt: text,
    negative: local.negative || '',
    size: local.size || localSizeFor(size),
    steps: local.steps,
    cfgScale: local.cfgScale,
    seed: local.seed ?? -1,
    vaeTiling: local.vaeTiling !== false,
    dirs,
    signal,
  });
  return {
    buffer: r.buffer,
    mime: r.mime,
    via: `${r.via} · ${r.width}×${r.height} · ${r.steps} qadam`,
    width: r.width,
    height: r.height,
    steps: r.steps,
  };
}
