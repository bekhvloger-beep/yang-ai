// engine.js — the agentic loop with provider failover, vision input and agent identities.
import { EventEmitter } from 'node:events';
import { streamChat, getAllProviders, getProviderKey, isProviderHealthy, suspendProvider, RateLimitError, isProviderEnabled, isBundledLocalProvider, localEndpoint, localServerUp, waitLocalServerReady, localContextSize, fitMessagesToContext, isContextOverflowError, CTX_SAFETY_TOKENS } from './providers.js';
import { translateText, translatorUp, translateSettings, waitTranslatorReady } from './translate.js';
import { TOOL_SPECS, createToolContext, TOOLS_NEEDING_APPROVAL } from './tools.js';

const MAX_STEPS = 40;
const MAX_TOOL_RESULT = 12000;
const FILE_CREATING_TOOLS = new Set(['write_file', 'create_document', 'create_image', 'generate_image']);

// Lokal kichik model (0.5B/4B) uchun tool ro'yxati va system prompt qisqartiriladi:
// 10 ta tool spec + uzun prompt modelni chalkashtirib, bir xil/juqari javob berishiga olib kelardi.
// 1-bosqich (qolgan band): lokal to'plam kengaytirildi — endi lokal model
// "qurib, ishga tushirib ko'rsata" oladi (run_command) va rasm chizadi (create_image).
const LOCAL_TOOL_NAMES = new Set(['list_dir', 'read_file', 'write_file', 'run_command', 'create_image', 'web_search', 'fetch_url']);
export const LOCAL_TOOL_SPECS = TOOL_SPECS.filter((t) => LOCAL_TOOL_NAMES.has(t.function.name));

// Lokal modelni qisqa va aniq tutadigan system prompt (lokal provayder uchun).
// Kichik model uchun eng muhim qoida: "yasab ber / qil / yoz / qur" — bu VAZIFA,
// darhol write_file bilan fayl yoziladi. Ilgari model bunday so'rovni oddiy savol deb
// hisoblab, "salom, nima yordam?" deb javob berardi (kutilgan xatti-harakat: fayl yozish).
const LOCAL_TASK_WORDS = [
  'yasab', 'yasa', 'yasang', 'qilib ber', 'qil', 'qur', 'quring', 'yarat', 'yaratib',
  'yoz', 'yozib', 'tuz', 'tuzib', 'ishla', 'tayyorla', 'generate', 'create', 'build', 'make',
];

// Lokal 1.7B modelda takrorlanish (degeneratsiya) halqasini kamaytiradi: 100 vazifa
// sinovida 11 ta HTTP 500 aynan takroriy matn tufayli chiqdi — model write_file
// argumentida bir xil gapni yuz marta yozib, JSON satrini yopa olmagan.
const BUNDLED_SAMPLING = {
  repeat_penalty: 1.15,
  frequency_penalty: 0.2,
  // DRY — takrorlanuvchi ketma-ketliklarni jazolovchi sampler (llama.cpp).
  // Lokal 1.7B model degeneratsiya halqasiga tushib, tool JSON'ini buzishi
  // (llama-server 500) shu bilan sezilarli kamayadi.
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2,
  dry_penalty_last_n: 512,
};

// Degeneratsiya halqasi himoyasi: lokal model bir xil tool'ni bir xil argumentlar
// bilan qayta-qayta chaqirib, oxir-oqibat tool JSON'ini buzadi (100 vazifa sinovida
// 10+ HTTP 500, v4flow C qadamida ham). Har bir tool uchun bir xil chaqiruv necha
// marta BAJARILISHI mumkinligi:
//   write_file/create_image/generate_image — 1 (ikkinchi bir xil yozuv keraksiz);
//   run_command — 2 (xatoni tuzatib qayta ishga tushirish odatiy hol);
//   qolganlar (o'qish/qidiruv) — 3 (tekshirish uchun takror o'qish mumkin).
const REPEAT_LIMITS = { write_file: 1, create_image: 1, generate_image: 1, run_command: 2 };
const DEFAULT_REPEAT_LIMIT = 3;
const safeJson = (v) => { try { return JSON.stringify(v) ?? ''; } catch { return ''; } };

// Kichik koder modellar tool chaqiruvini strukturali tool_calls o‘rniga matn ichida
// JSON ko‘rinishida yozadi: ```json {"name":"write_file","arguments":{...}}```.
// Shunda fayl yozilmasdi. Bu yerda faqat MA’LUM tool nomlari va argumentli obyektlar
// qabul qilinadi (ixtiyoriy matn tool sifatida bajarilmaydi).
function extractTextToolCalls(content) {
  if (!content || typeof content !== 'string') return [];
  const cands = [];
  for (const m of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) cands.push(m[1]);
  // Some instruct models emit executable-looking JSON tool syntax instead of
  // either API tool_calls or {"name":...,"arguments":...}. Only parse an
  // allowlisted name followed by one complete JSON object in parentheses.
  const callPattern = new RegExp(`\\b(${[...LOCAL_TOOL_NAMES].join('|')})\\s*\\(`, 'g');
  let callMatch;
  while ((callMatch = callPattern.exec(content))) {
    let depth = 1;
    let inString = false;
    let escaped = false;
    const argsStart = callPattern.lastIndex;
    for (let i = argsStart; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '(') depth++;
      else if (char === ')' && --depth === 0) {
        try {
          const args = JSON.parse(content.slice(argsStart, i).trim());
          if (args && typeof args === 'object' && !Array.isArray(args)) {
            cands.push(JSON.stringify({ name: callMatch[1], arguments: args }));
          }
        } catch {}
        callPattern.lastIndex = i + 1;
        break;
      }
    }
  }
  // Models sometimes append a sentence after a valid JSON tool request. Extract
  // complete balanced objects rather than requiring the entire response to parse.
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (start < 0) {
      if (char === '{') { start = i; depth = 1; inString = false; escaped = false; }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      cands.push(content.slice(start, i + 1));
      start = -1;
    }
  }
  const out = [];
  const seen = new Set();
  for (const c of cands) {
    let obj;
    try { obj = JSON.parse(c.trim()); } catch { continue; }
    const list = Array.isArray(obj) ? obj : [obj];
    for (const o of list) {
      if (!o || typeof o !== 'object' || !LOCAL_TOOL_NAMES.has(o.name)) continue;
      const args = o.arguments ?? o.args ?? {};
      if (!args || typeof args !== 'object') continue;
      const signature = `${o.name}|${safeJson(args)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push({ id: `txt_${out.length}_${Date.now()}`, type: 'function', function: { name: o.name, arguments: JSON.stringify(args) } });
    }
  }
  return out;
}

// Plan rejimi (4-bosqich): foydalanuvchi faqat reja so'raydi — tool chaqirilmaydi.
const PLAN_MODE_EXTRA = `REJA REJIMI yoqilgan: foydalanuvchi HOZIR faqat REJA so'rayapti.
- Tool chaqirmang, fayl yozmang, buyruq bajarmang — hozircha hech narsa qurilmaydi.
- Javobni raqamlangan aniq qadamlar bilan yozing (1., 2., 3., …). Har qadamda: nima qilinadi, qaysi fayl/papka yaratiladi.
- Reja 3-8 qadam bo'lsin, aniq va o'lchanadigan bo'lsin.
- Oxirida bitta qatorda: "Tayyor bo'lsa — «Qurishni boshlash» tugmasini bosing." deb yozing.`;

// Kodlash rejimi («Kod AI») — YANG AI ni kodlash uchun maxsus tayyorlaydi.
// Yoqilganda system promptga qo'shiladi (`config.codingMode`). Qoidalar o'lchangan
// xatolarga qarshi: (1) model kodni chatda ko'rsatib faylga yozmaydi, (2) yozgach
// ishga tushirmaydi, (3) mavjud bo'lmagan API/funksiyani o'ylab topadi, (4) keraksiz
// katta o'zgarish kiritadi. Har biri aniq talab bilan yopiladi.
export const CODING_MODE_EXTRA = `KODLASH REJIMI (Kod AI) — sen senior dasturchisan. Quyidagilarga QAT'IY amal qil:
- Har qanday kod o'zgarishi FAYL sifatida yoziladi (write_file). Chatda kod ko'rsatib qo'yish — bajarilmagan ish.
- Avval mavjud holatni o'qi: list_dir/read_file bilan fayl va uslubni ko'r, keyin yoz. Fayl mazmunini o'ylab topma.
- O'zgarish MINIMAL bo'lsin: faqat vazifaga kerakli qatorlarga teg. Butun faylni qayta yozishdan saqlan (agar fayl kichik bo'lmasa).
- Loyihaning mavjud uslubi, nomlash va tuzilishiga amal qil. Yangi kutubxona qo'shishdan oldin u loyihada BORLIGINI tekshir.
- Mavjud bo'lmagan funksiya/API/argumentni "taxminan" yozma: read_file yoki web_search bilan tasdiqla.
- Fayl TO'LIQ bo'lsin: bo'sh joy, "...", TODO, "<qolgani o'zgarmaydi>" qoldirilmaydi.
- Yozgach TEKSHIR: run_command bilan ishga tushir (test, build, linter yoki oddiy import). Xato bo'lsa — xato matnini o'qib TUZAT va qayta ishga tushir; tuzatmaguningcha tugatilgan deb hisoblama.
- Xato matnini yashirma va jim o'tkazma: nima yiqilganini ayt va tuzat.
- Yozgan kodning chekka holatlarini (bo'sh kirish, 0, takrorlar, katta kirish) hisobga ol.
- Yakunda qisqa xulosa: qaysi fayl(lar) o'zgardi, nima tekshirildi, natija (o'tdi/yiqildi).
- Foydalanuvchi tilida javob ber; kod, identifikator va buyruqlar inglizcha qoladi.`;

/**
 * System qatlamiga qo'shiladigan «extra» bloklarni yig'adi — YAGONA joy.
 * Sof funksiya: reja rejimi, tasdiqlangan reja va Kodlash rejimi (Kod AI) shu yerda
 * birlashtiriladi. `agent/test_coding_mode.mjs` shu funksiyani bevosita sinaydi.
 */
export function buildSystemExtra({ systemExtra = null, planMode = false, approvedPlan = null, codingMode = false } = {}) {
  const parts = [systemExtra];
  if (planMode) parts.push(PLAN_MODE_EXTRA);
  if (approvedPlan) parts.push(approvedPlanExtra(approvedPlan));
  if (codingMode) parts.push(CODING_MODE_EXTRA);
  return parts.filter(Boolean).join('\n\n') || null;
}

// Tasdiqlangan reja bilan qurish (4-bosqich: "Qurishni boshlash" bosilganda).
function approvedPlanExtra(plan) {
  return `Foydalanuvchi quyidagi rejani TASDIQLADI — uni aynan bajar:
${String(plan || '').slice(0, 4000)}
Reja qadamlarini tool'lar orqali amalda bajaring (fayllarni yozing, kerak bo'lsa buyruq bilan tekshiring) va yakunda qisqa xulosa bering.
MUHIM: har bir faylni faqat BIR MARTA yozing — aynan o'sha faylni qayta yozmang. Barcha ish tugagach, tool chaqirmasdan yakuniy xulosa yozing.`;
}

// Reja matnidan qadamlarni ajratib oladi (UI "Qurishni boshlash" kartasi uchun).
function parsePlanSteps(text) {
  const steps = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.+)$/);
    if (!m) continue;
    const s = m[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (s.length < 3) continue;
    steps.push(s.slice(0, 300));
  }
  return steps.slice(0, 12);
}

// Vazifa so'ralgan-u, fayl yozilmagan, javobda kod bloki bo'lsa — true.
function needsFileNudge(userText, content) {
  const t = String(userText || '').toLowerCase();
  const isTask = LOCAL_TASK_WORDS.some((w) => t.includes(w));
  if (!isTask) return false;
  const c = String(content || '');
  return /```/.test(c) || c.length > 700;
}

function compactSystemPrompt(workspace, platform, extra, answerInEnglish, userText) {
  const isTask = LOCAL_TASK_WORDS.some((w) => String(userText || '').toLowerCase().includes(w));
  return [
    `Siz "YANG AI" — foydalanuvchi kompyuterida ishlaydigan agentic yordamchisiz.`,
    `Workspace: ${workspace}. Platforma: ${platform}.`,
    ``,
    `ENG MUHIM QOIDA:`,
    `- Foydalanuvchi biror narsani yasashni/qurishni/yozishni/yaratishni so'rasa — bu VAZIFA.`,
    `  Reja yozmang va savol bermang: darhol write_file tool'i bilan TO'LIQ, ishlaydigan faylni yozing.`,
    `- Bunday vazifada faqat salomlashish yoki "nima yordam?" deb javob berish TAQIQLANADI.`,
    isTask
      ? `- DIQQAT: joriy so'rov aynan shunday VAZIFA. Hoziroq write_file chaqiring (path + to'liq content), keyin bir qatorda nima qilganingizni yozing.`
      : `- Savol yoki suhbat bo'lsa: qisqa, aniq va foydali javob bering (ortiqcha reja yozmang).`,
    `- Mavjud holatni bilish kerak bo'lsa list_dir/read_file ishlatiladi.`,
    `- Joriy hujjat, kutubxona API si yoki yangi ma'lumot kerak bo'lsa web_search bilan qidiring, kerakli ishonchli havolani fetch_url bilan oching. Topilmani tekshirib, uydirma manba keltirmang.`,
    `- Tool chaqiruvi strukturali kelishi kerak; agar faqat JSON matn sifatida chiqarsa, uni to'liq yozing. Tool bajargach natijasini baholab, agar so'ralgan bo'lsa run_command bilan ishga tushiring va xatoni tuzating.`,
    `  Kodni chat oynasida ko'rsatish bilan cheklanmang — fayl sifatida saqlanmaguncha vazifa tugamaydi.`,
    `- Yozilgan ishni iloji bo'lsa TEKSHIRING: python skript bo'lsa run_command bilan ishga tushiring (masalan "python fayl.py") va natijani ko'rsating.`,
    `- Diagramma/chizma/grafika so'ralsa create_image tool'i bilan PNG chizing (oddiy shakllar va yozuvlar).`,
    `- Javobni cho'zib yubormang: qisqa fikr + tool chaqiruvi + qisqa xulosa. Uzun matn o'rniga ishni bajaring.`,
    `- Yoziladigan fayl to'liq bo'lsin: bo'sh joy, "...", TODO qoldirmang. Kod ishlashi kerak.`,
    `- Fayl nomini foydalanuvchi aytgandek AYNAN ishlating (masalan "chiziq.png" deyilsa — chiziq.png;`,
    `  o'zingizdan boshqa nom o'ylab topmang).`,
    `- Python skript yozsangiz: funksiyani albatta CHAQIRING va natijani print qiling — funksiya yozib,`,
    `  chaqirmay qo'yish yoki print qilmaslik xato (skript ishga tushganda natija ko'rinishi shart).`,
    `- Oddiy suhbat/savol bo'lsa (masalan "Salom, qandaysan?"): qisqa va do'stona javob bering,`,
    `  masalan: "Salom! Men YANG AI man — fayllar, kod va hujjatlar bilan ishlayman. Nima qilamiz?"`,
    `  Bu qoidalarni o'zingizga takrorlab javob bermang, faqat ishni bajaring.`,
    `- Til: ${answerInEnglish ? `javobni SODDA INGLIZ tilida yozing — ilova uni o'zbekchaga tarjima qiladi. Fayl mazmuni esa foydalanuvchi tilida bo'lsin.` : `foydalanuvchi tilida (odatda o'zbekcha) javob bering.`}`,
    ``,
    `Misol:`,
    `Foydalanuvchi: "Menga kalkulyator yasab ber"`,
    `To'g'ri harakat: write_file({"path":"<fayl nomi>","content":"<to'liq fayl mazmuni>"}) — so'ng qisqa bir qatorda nima qilganingizni yozing (yaratgan fayl nomini aynan ko'rsating).`,
    `Bu misol FAQAT harakat namunasi: undagi fayl nomini va javob matnini NUSXALAMANG — aynan foydalanuvchi so'ragan vazifani bajaring.`,
    `Rasm/chizma so‘ralsa: create_image({"path":"rasm.png","width":200,"height":200,"ops":[{"op":"rect","x":20,"y":20,"w":160,"h":160,"color":"#ff0000","fill":true}]}) — ops ro‘yxatini bo‘sh qoldirmang.`,
    `Ishga tushirish so‘ralsa: faylni yozgach run_command({"command":"python <fayl>"}) bilan natijani ko‘rsating.`,
    extra ? `Roling: ${extra}` : '',
  ].filter(Boolean).join('\n');
}

export function systemPrompt(workspace, platform, extra, answerInEnglish, userLangSample, compact) {
  if (compact) return compactSystemPrompt(workspace, platform, extra, answerInEnglish, userLangSample);
  return [
    `Siz "ChatDev Agent" — foydalanuvchi kompyuterida ishlaydigan agentic yordamchisiz (ZCode/Codex uslubida).`,
    `Joriy ish maydoni (workspace): ${workspace}`,
    `Platforma: ${platform}.`,
    ``,
    `Qoidalar:`,
    `- MUHIM: faqat reja tuzib javob bermang. Har qanday fayl yaratish, kod yozish, buyruq bajarish vazifasini O‘ZINGIZ darhol tools orqali bajaring va tugallang.`,
    `- Tool chaqiruvi matnda bo'lsa, uni darhol yakuniy javob deb qabul qilmang; avval ko'rsatilgan toolni bajaring.`,
    `- Tool chaqiruvi matnda bo'lsa, uni darhol yakuniy javob deb qabul qilmang; avval ko'rsatilgan toolni bajaring.`,
    `- Agar savol FAQAT ma'lumot, tavsiya yoki tushuntirish bo'lsa (fayl yaratish kerak emas) — tools ochmasdan, to'g'ridan-to'g'ri aniq va to'liq javob bering: ro'yxat, qiyosiy jadval, aniq nomlar va havolalar. Mavzudan chetlanmang.`,
    `- Til: ${
      answerInEnglish
        ? `your CHAT REPLIES must be in simple English — the app auto-translates them to the user's language. Keep code, file paths, commands and SMOKE_PASSED-style markers verbatim.
  FILE CONTENT LANGUAGE: when the task asks you to create a file (document, letter, essay, README, presentation, report...), write the human-readable content of that file in the SAME LANGUAGE the user used. The user's original request was: «${String(userLangSample || '').slice(0, 300)}». File contents are NOT auto-translated, so the file itself must already be in the user's language. Code keywords/identifiers stay in English, but comments, prose and document text follow the user's language.`
        : `foydalanuvchi qaysi tilda yozsa — o‘sha tilda javob bering (o‘zbek, rus, ingliz, turk, koreys — ixtiyoriy til). Agar til aniq bo‘lmasa, o‘zbekcha javob bering.`
    }`,
    `- Foydalanuvchi rasm/skrinshot yuborsa — uni diqqat bilan tahlil qiling va tavsifida aniq bo‘ling.`,
    `- Fayllar bilan ishlashdan oldin avval list_dir/read_file bilan haqiqiy holatni ko‘ring. Fayl mazmunini o‘ylab topmang.`,
    `- Hujjat formatlari uchun: create_document (pdf/docx/xlsx/csv) va create_image (png) tool’laridan foydalaning; tayyor matnni read_file qilib bo‘lmaydigan formatlarni extract_file bilan o‘qing.`,
    `- Kod yozishda loyihaning mavjud uslubi va tuzilishiga amal qiling.`,
    `- Ko‘p qadamli vazifalarni mustaqil bajarib boring: yozing, run_command bilan tekshiring (test/build), xatoni tuzating.`,
    `- run_command uchun doim ruxsat so‘raladi — foydalanuvchi rad etsa, boshqa yo‘l bilan davom eting yoki tushuntiring.`,
    `- Katta fayllarni read_file(offset/limit) bilan qismlarga bo‘lib o‘qing.`,
    `- Yakunda nima qilinganini qisqacha xulosa qilib bering.`,
    extra ? `\nSening roling:\n${extra}` : '',
  ].filter(Boolean).join('\n');
}

// Build the API `messages` array from UI events (single source of truth).
export function eventsToMessages(events) {
  const msgs = [];
  for (const e of events) {
    if (e.type === 'user') {
      if (e.images && e.images.length) {
        const parts = [{ type: 'text', text: e.text }];
        for (const url of e.images) parts.push({ type: 'image_url', image_url: { url } });
        msgs.push({ role: 'user', content: parts });
      } else {
        msgs.push({ role: 'user', content: e.text });
      }
    } else if (e.type === 'assistant') {
      const m = { role: 'assistant', content: e.text || '' };
      if (e.toolCalls && e.toolCalls.length) {
        // extra_content (Gemini thought_signature) saqlanadi va qaytariladi — aks holda Gemini 400 beradi.
        m.tool_calls = e.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.tool, arguments: JSON.stringify(t.args) },
          ...(t.extra_content ? { extra_content: t.extra_content } : {}),
        }));
        if (!m.content) m.content = null;
      }
      msgs.push(m);
    } else if (e.type === 'tool') {
      msgs.push({ role: 'tool', tool_call_id: e.id, content: String(e.result ?? '').slice(0, MAX_TOOL_RESULT) });
    }
  }
  return msgs;
}

// Trim long histories: drop whole oldest exchanges past maxCount, shorten old tool results.
function trimMessages(messages, maxCount = 30, oldToolLimit = 2000) {
  let msgs = messages.slice();
  while (msgs.length > maxCount) {
    const firstUser = msgs.findIndex((m) => m.role === 'user');
    if (firstUser < 0) break;
    let nextUser = msgs.findIndex((m, i) => i > firstUser && m.role === 'user');
    if (nextUser < 0) break;
    msgs = msgs.slice(nextUser);
  }
  const cutoff = msgs.length - 12;
  return msgs.map((m, i) => {
    if (i < cutoff && m.role === 'tool' && typeof m.content === 'string' && m.content.length > oldToolLimit) {
      return { ...m, content: m.content.slice(0, oldToolLimit) + '\n...[eski natija qisqartirildi]' };
    }
    return m;
  });
}

function messageHasImages(messages) {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
}

export class AgentEngine extends EventEmitter {
  constructor({ config, workspace, agentName, systemExtra, maxSteps, translateOutput, translateInput }) {
    super();
    this.config = config;
    this.workspace = workspace;
    this.agentName = agentName || null;
    this.systemExtra = systemExtra || null;
    this.maxSteps = maxSteps || MAX_STEPS;
    // Tarjimon faqat foydalanuvchiga ko'rinadigan oqimlarda yoqiladi (chat, Lead xulosasi).
    this.translateOutput = !!translateOutput;
    this.translateInput = !!translateInput;
    this.child = null;
    this.lastGood = null;
  }

  emit(type, data) {
    super.emit('event', { type, ...(this.agentName ? { agent: this.agentName } : {}), ...data });
  }

  abort() {
    this.aborted = true;
    if (this.ctrl) this.ctrl.abort(new Error('Foydalanuvchi to‘xtatdi'));
    if (this.child) {
      try {
        this.child.kill();
      } catch {}
    }
  }

  buildChain(hasImages) {
    const provs = getAllProviders(this.config);
    const pairs = [];
    // Faqat shu modelni ishlatish (pinMode): boshqa provayder/modelga o'tish TAQIQLANADI.
    // Pin rejimda health (suspend) tekshiruvi ham o'tkazilmaydi — o'lik bo'lsa aniq xato ko'rsatamiz.
    if (this.config.pinMode) {
      const cur = provs[this.config.provider];
      if (!cur || !cur.base) return [];
      // Pin rejimda aynan foydalanuvchi tanlagan model ishlatiladi — visionModel
      // bilan almashtirish ham taqiqlangan (no substitution).
      const model = this.config.model || '';
      if (!model) return [];
      return [{ id: this.config.provider, model, def: cur, key: getProviderKey(this.config, this.config.provider) }];
    }
    const seen = new Set();
    const dead = (id) => !isProviderHealthy(this.config, id);
    const push = (id, model) => {
      const def = provs[id];
      const key = getProviderKey(this.config, id);
      // keyless provayderlar (masalan Pollinations) kalitsiz ham zanjirga kiradi.
      if (!def || (!key && !def.keyless) || !def.base || !model) return;
      if (dead(id)) return;
      if (!isProviderEnabled(this.config, id)) return;
      const k = `${id}::${model}`;
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push({ id, model, def, key });
    };
    const cur = this.config.provider;
    if (hasImages) {
      push(cur, (this.config.visionModel) || (provs[cur] && provs[cur].visionModels && provs[cur].visionModels[0]));
      for (const [id, def] of Object.entries(provs)) for (const vm of def.visionModels || []) push(id, vm);
      // last resort: text models that might accept images anyway
      for (const [id, def] of Object.entries(provs)) {
        const key = getProviderKey(this.config, id);
        if (key && def.base && !(def.visionModels || []).length) push(id, (def.models || [])[0]);
      }
    } else {
      push(cur, this.config.model);
      for (const m of (provs[cur] && provs[cur].models) || []) push(cur, m);
      // Boshqa provayderlardan faqat bittadan zaxira model — har qadamda model
      // rouletkasi o'zbekcha javob sifatini buzmasligi uchun zanjir qisqa.
      for (const [id, def] of Object.entries(provs)) {
        if (id === cur) continue;
        for (const m of (def.models || []).slice(0, 1)) push(id, m);
      }
    }
    if (!pairs.length) {
      // everything suspended — ignore health and try anyway rather than failing outright
      this.config.providerHealth = {};
      return this.buildChain(hasImages);
    }
    return pairs;
  }

  async callWithFailover(messages, onDelta, getStreamedText) {
    const hasImages = messageHasImages(messages);
    const chain = this.buildChain(hasImages);
    if (!chain.length) {
      if (this.config.pinMode) {
        throw new Error(`Pinned model topilmadi: ${this.config.provider} · ${this.config.model}. Model nomini yoki provayderni tekshiring.`);
      }
      const need = hasImages ? 'vision (rasm tahlili)' : 'matn';
      throw new Error(`Hech qanday ${need} uchun mos provayder topilmadi. Sozlamalarda API kalit kiriting.`);
    }
    const ordered = this.lastGood
      ? [this.lastGood, ...chain.filter((p) => !(p.id === this.lastGood.id && p.model === this.lastGood.model))]
      : chain;
    const errors = [];
    const blocked = new Set(); // bu run ichida limitga urilgan provayderlarning qolgan modellarini sinamaymiz
    for (const pair of ordered) {
      if (this.aborted) throw Object.assign(new Error('To‘xtatildi'), { aborted: true });
      if (blocked.has(pair.id)) continue;
      // Ilova ichidagi lokal kichik modelga 10 ta tool og'ir — 7 tasi beriladi.
      // Reja rejimida tool umuman berilmaydi — model faqat reja yozadi.
      // Qadam chegarasidagi yakuniy so'rovda ham tool yo'q (matn majburiy).
      const toolsForPair = this._finalOnly || this.planMode ? [] : pair.def.local ? LOCAL_TOOL_SPECS : TOOL_SPECS;
      // Reja rejimida javob qisqa bo'lishi kerak (0.9k token). Bundan tashqari,
      // lokal kichik model oddiy rejimda ham tool chaqirmasdan cheksiz matn yozib
      // ketgan (o'lchov: 5341 token ≈ 9 daqiqa). Shu sababli lokal provayder uchun
      // (a) token chegarasi, (b) matn uzunligi guard'i qo'yiladi — guard tool
      // chaqiruviga tegmaydi (u alohida delta).
      const extraBody = this.planMode
        ? { max_tokens: 900, ...(pair.def.bundled ? BUNDLED_SAMPLING : pair.def.local ? { temperature: 0.2 } : {}) }
        : pair.def.bundled
          ? { max_tokens: 2048, ...BUNDLED_SAMPLING }
          : pair.def.local
            ? { max_tokens: 2048, temperature: 0.2 }
            : undefined;
      // ---- kontekst byudjeti (lokal model) ----
      // llama-server 8192 token kontekst bilan ko'tariladi; undan katta so'rov HTTP 400
      // «exceeds the available context size» oladi (o'lchov: 13 835 tokenli so'rov) va
      // pin rejimda zaxira provayder yo'q — vazifa butunlay bajarilmay qolardi. Endi
      // haqiqiy kontekst serverdan (/props → n_ctx) o'qiladi, so'rov unga sig'diriladi
      // va baribir yetmasa — kichikroq byudjet bilan qayta urinamiz.
      const local = !!pair.def.local || !!pair.def.bundled;
      const ctxTokens = local ? await localContextSize(pair.def.base) : 0;
      const outTokens = Number(extraBody && extraBody.max_tokens) || 2048;
      let budget = local ? Math.max(512, ctxTokens - outTokens - CTX_SAFETY_TOKENS) : 0;
      try {
        let r;
        for (let attempt = 0; ; attempt++) {
          let sendMessages = messages;
          if (local) {
            const fit = fitMessagesToContext(messages, toolsForPair, budget, { stripImages: !!pair.def.bundled });
            sendMessages = fit.messages;
            if (fit.trimmed && !this._ctxNoticeShown) {
              this._ctxNoticeShown = true;
              this.emit('notice', {
                text: `✂️ So‘rov lokal model kontekstiga (${ctxTokens} token) sig‘dirildi — eski tarix qisqartirildi`,
              });
            }
          }
          try {
            r = await streamChat({
              base: pair.def.base,
              key: pair.key,
              model: pair.model,
              messages: sendMessages,
              tools: toolsForPair,
              signal: this.ctrl.signal,
              onDelta,
              extraHeaders: pair.def.extraHeaders,
              providerId: pair.id,
              extraBody,
              guardChars: pair.def.local ? (this.planMode ? 4000 : 2600) : undefined,
              // Tool argument JSON'i buzilib qaytsa (llama-server 500) — bir marta qayta urinamiz.
              retryOn500: !!pair.def.bundled,
            });
            break;
          } catch (e2) {
            if (e2.aborted || this.aborted) throw e2;
            if (local && attempt < 2 && isContextOverflowError(e2)) {
              budget = Math.max(512, Math.floor(budget / 2));
              this.emit('notice', { text: `✂️ Kontekst yetmadi — yana qisqartirib urinaman (${budget} token)` });
              continue;
            }
            throw e2;
          }
        }
        // Bo'sh javob (content ham, toolCalls ham yo'q) — muvaffaqiyat deb hisoblanmaydi:
        // zanjir keyingi provayderga o'tadi.
        if (!(r.toolCalls && r.toolCalls.length) && !((r.content || (getStreamedText ? getStreamedText() : '') || '').trim())) {
          this.emit('notice', { text: `${pair.def.name} · ${pair.model} bo‘sh javob qaytardi — boshqa modelga o‘taman…` });
          throw new Error('model bo‘sh javob qaytardi');
        }
        this.lastGood = pair;
        // Lokal model haqidagi xabar FAQAT lokal provayder haqiqatan javob berganda
        // chiqadi — aks holda zanjir Kilo'ga o'tgan bo'lsa ham "lokal model ishlatilmoqda"
        // deb yolg'on ma'lumot ko'rsatilardi.
        if (pair.def.bundled) {
          const lm = await this.localModelName();
          this.emit('notice', {
            text: `Lokal model: ${lm || pair.def.name}${this._trUp ? ' · tarjima uz↔en yoqilgan' : this._trNeeded ? ' · TARJIMASIZ' : ''}`,
          });
          if (this._trNeeded && !this._trUp) {
            this.emit('notice', { text: '⚠️ Tarjimon tayyor emas — lokal model o‘zbekchani tushunmasligi mumkin' });
          }
        }
        this.emit('provider_used', { provider: pair.def.name, model: pair.model });
        if (r.quota) this.emit('quota', { provider: pair.id, providerName: pair.def.name, model: pair.model, ...r.quota });
        return r;
      } catch (e) {
        if (e.aborted || this.aborted) throw e;
        if (e instanceof RateLimitError || e.rateLimited) {
          // 429 — provayder band: qolgan modellarini ham sinamaymiz, 2 daqiqaga tinchlantiramiz.
          blocked.add(pair.id);
          suspendProvider(this.config, pair.id, 2);
          this.emit('notice', { text: `${pair.def.name} limitga yetdi — 2 daqiqaga navbatdan chiqdi` });
        } else if (/HTTP 40[123]|Insufficient|quota|credit/i.test(e.message || '')) {
          // kalit/balans muammosi — 24 soatga o'chiramiz (60 daqiqa emas, spam kamayishi uchun).
          blocked.add(pair.id);
          suspendProvider(this.config, pair.id, 1440);
          this.emit('notice', { text: `${pair.def.name} ishlamaydi (kalit/balans) — 1 kunga o‘chirildi` });
        } else if (this.config.pinMode) {
          this.emit('notice', { text: `${pair.def.name} · ${pair.model} javob bermadi (pin rejim — zaxira yo‘q)` });
        } else {
          this.emit('notice', { text: `${pair.def.name} · ${pair.model} javob bermadi — boshqa modelga o‘taman…` });
        }
        errors.push(`${pair.def.name} · ${pair.model}: ${String(e.message).slice(0, 160)}`);
      }
    }
    throw new Error('Barcha provayderlar ishlamadi:\n' + errors.join('\n'));
  }

  // Toolsiz yakuniy javob: qadam chegarasi tugaganda yoki model tool argumentini
  // buzganda ishlatiladi (vazifani butunlay yo'qotmaslik uchun). Muvaffaqiyatsiz — null.
  async finalTextAnswer(messages, totalUsage, tr, trUp) {
    try {
      this._finalOnly = true;
      let lastText = '';
      const doneList = this.createdFiles && this.createdFiles.length
        ? `Yaratilgan fayllar: ${this.createdFiles.join(', ')}.`
        : 'Fayl yaratilmagan bo‘lishi mumkin.';
      // MUHIM: ilgari bu so'rov muvaffaqiyatsiz suhbatning davomi bo'lardi. Lokal
      // llama-server tool parse xatosidan keyin o'sha uzun prefiks bilan kelgan
      // so'rovga LAHZADA xuddi shu xatoni qaytarardi. Shuning uchun endi MUSTAQIL
      // (prefikssiz) qisqa prompt yuboramiz — model yangidan, toza holatda javob beradi.
      const tail = [
        {
          role: 'system',
          content: 'Sen yordamchi agentsan. Faqat qisqa, aniq yakuniy javobni o‘zbek tilida yozasan.',
        },
        {
          role: 'user',
          content:
            `Vazifa: ${this.userText.slice(0, 600)}\n\n${doneList}\n\n` +
            'Yuqoridagi vazifa bo‘yicha nima bajarilganini qisqa matn qilib yozing (qaysi fayl yaratildi, nima qilindi).',
        },
      ];
      const r2 = await this.callWithFailover(tail, (d) => { if (d.text) { lastText += d.text; this.emit('stream', { text: d.text }); } }, () => lastText);
      const text = (r2.content || lastText || '').trim();
      if (!text) return null;
      const out = this.translateOutput && trUp ? await this.maybeTranslate(text, tr) : text;
      this.emit('stream_flush', { text: out });
      if (this.createdFiles && this.createdFiles.length) this.emit('files_created', { paths: this.createdFiles.slice() });
      this.emit('assistant', { text: out });
      this.emit('done', { usage: totalUsage, content: out });
      return out;
    } catch (e) {
      if (e.aborted || this.aborted) throw e;
      return null;
    } finally {
      this._finalOnly = false;
    }
  }

  // Yakuniy javobni foydalanuvchi tiliga tarjima qiladi; servis o'chiq bo'lsa xomaki qoladi.
  trackCreatedFile(args) {
    try {
      const p = args && args.path;
      if (p && !this.createdFiles.includes(p)) this.createdFiles.push(p);
    } catch {}
  }

  // llama-server yuklagan model nomi (masalan model-1.7b.gguf) — foydalanuvchiga ko'rsatish uchun.
  // Manzil providers.js dagi yagona manbadan olinadi (port o'zgarsa faqat o'sha joy o'zgaradi).
  async localModelName() {
    if (this._localModel !== undefined) return this._localModel;
    try {
      const res = await fetch(localEndpoint(this.config).base + '/models', { signal: AbortSignal.timeout(2500) });
      const j = await res.json();
      this._localModel = (j.data && j.data[0] && j.data[0].id) || '';
    } catch {
      this._localModel = '';
    }
    return this._localModel;
  }

  async maybeTranslate(text, settings) {
    try {
      const t = await translateText(this.config, text, { target: settings.target });
      if (t && t.trim()) return t;
    } catch {}
    if (!this._trFailNoted) {
      this._trFailNoted = true;
      this.emit('notice', { text: 'Tarjimon javob bermadi — javob tarjimasiz qoldirildi' });
    }
    return text;
  }

  async run({ events, userText, images, planFirst, planText }) {
    this.aborted = false;
    this.ctrl = new AbortController();
    this.createdFiles = [];
    // Bir xil tool chaqiruvlari hisobi (degeneratsiya halqasini to'sish uchun).
    this.callSigs = new Map();
    // 4-bosqich: "Plan" tugmasi — faqat reja; "Qurishni boshlash" — tasdiqlangan reja bilan qurish.
    this.planMode = !!planFirst;
    this.approvedPlan = typeof planText === 'string' ? planText : '';

    // Tarjimon holati: ishlayaptimi va qaysi yo'nalishlarda kerak.
    const tr = translateSettings(this.config);
    const trNeeded = tr.enabled && (this.translateOutput || this.translateInput);
    // O'z ilovasi ko'targan llama-server va foydalanuvchi ulagan lokal endpoint
    // ikkalasi ham ixcham prompt/tool set oladi; readiness kutish esa faqat bundled'ga kerak.
    const localPrimary = isBundledLocalProvider(this.config, this.config.provider);
    const localProvider = !!getAllProviders(this.config)[this.config.provider]?.local;
    // Kichik lokal model ba'zan kodni chatda ko'rsatib, faylga yozmay qo'yadi.
    // Bunday holatda bir marta "endi write_file chaqir" deb qayta so'raymiz.
    this.nudgeLeft = localProvider ? 1 : 0;
    // 5-bosqich sinovi (100 vazifa): 13 holatda lokal model skriptnı yozgan, lekin
    // run_command bilan ishga tushirmagan edi — bir marta "ishga tushir" deb eslatiladi.
    this.runNudgeLeft = localProvider && /ishga tushir|ishlatib ko|tekshir|sinab ko|bajarib ko|\brun\b/i.test(String(userText || '')) ? 1 : 0;
    this.ranCommand = false;
    // Vazifa matni — toolsiz yakuniy javobda ham kerak (mustaqil prompt uchun).
    this.userText = String(userText || '');
    this._trNeeded = trNeeded;
    this._trUp = false;
    // Lokal model asosiy bo'lsa, tarjimon tayyor bo'lishini kutamiz (uz→en→model→uz).
    // Bir marta tekshirish xato edi: NLLB hali ko'tarilmagan bo'lsa xom o'zbekcha
    // kichik modelga tushib, "xato tushunish / bir xil javob" berardi.
    const trUp = trNeeded && (localProvider ? await waitTranslatorReady(this.config) : await translatorUp(this.config));
    this._trUp = trUp;
    // "Faqat shu modelni ishlatish" (pin) yoqilgan bo'lsa foydalanuvchi tanlovi ko'rinib turadi.
    if (this.config.pinMode) {
      this.emit('notice', { text: `🔒 Faqat tanlangan model: ${this.config.provider} · ${this.config.model} — zaxiraga o‘tilmaydi` });
    }
    // Lokal provayder ishlatilganda qaysi model va tarjima holati ko'rinib turadi (jim qolmasin).
    // "lokal model ishlatilmoqda" xabari callWithFailover ichida, haqiqiy javobdan keyin chiqadi.
    // Muhim: ilova lokal serverni fonda o'zi ko'taradi va model yuklanishi vaqt oladi
    // (~2.1 s issiq keshda, yangi o'rnatishda ancha uzoq). Ilgari tayyor bo'lishini kutmasdan
    // so'rov yuborilardi — "fetch failed", pin rejimda esa birinchi xabar butunlay yiqilardi
    // (o'lchov: engine 11 ms da topshirar, server 2141 ms da tayyor bo'lardi).
    if (localPrimary) {
      if (!(await localServerUp(this.config))) {
        this.emit('notice', { text: '⏳ Lokal model yuklanmoqda — tayyor bo‘lishini kutyapman…' });
      }
      if (!(await waitLocalServerReady(this.config, { shouldStop: () => this.aborted }))) {
        this.emit('notice', {
          text: this.config.pinMode
            ? 'Lokal AI serveri javob bermayapti — pin rejim yoqilgani uchun zaxiraga o‘tilmaydi'
            : 'Lokal AI serveri javob bermayapti — zaxira provayderga o‘taman…',
        });
      }
    }

    const toolCtx = createToolContext({
      workspace: this.workspace,
      config: this.config,
      registerChild: (c) => (this.child = c),
    });

    const history = eventsToMessages(events);
    // Tarjimon ishlayotganda foydalanuvchi matni inglizchaga o'giriladi — model
    // inglizcha fikrlaydi, yakuniy javob yana o'zbekchaga tarjima qilinadi.
    let effectiveUserText = userText;
    if (this.translateInput && trUp && userText) {
      const t = await translateText(this.config, userText, { target: 'eng_Latn' });
      if (t && t.trim()) effectiveUserText = t;
    }
    let userMsg;
    if (images && images.length) {
      userMsg = { role: 'user', content: [{ type: 'text', text: effectiveUserText }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] };
    } else {
      userMsg = { role: 'user', content: effectiveUserText };
    }
    // Reja rejimi / tasdiqlangan reja — system qatlamiga qo'shiladi.
    const systemExtra = buildSystemExtra({
      systemExtra: this.systemExtra,
      planMode: this.planMode,
      approvedPlan: this.approvedPlan,
      // Kodlash rejimi (Kod AI): sozlamada yoqilgan bo'lsa — har so'rovga qo'shiladi.
      codingMode: !!(this.config && this.config.codingMode),
    });

    const messages = [
      { role: 'system', content: systemPrompt(this.workspace, process.platform, systemExtra, trUp && this.translateOutput, userText, localProvider) },
      ...trimMessages(history),
      userMsg,
    ];

    let totalUsage = null;
    try {
      for (let step = 0; step < this.maxSteps; step++) {
        if (this.aborted) throw Object.assign(new Error('To‘xtatildi'), { aborted: true });

        // 2-bosqich (faoliyat oqimi): "fikrlash" bosqichi — model javob qaytarguncha UI'da ko'rinadi.
        this.emit('thinking', {
          step: step + 1,
          label: step === 0
            ? (this.planMode ? 'Vazifani tahlil qilib reja tuzayapman…' : 'Vazifani tahlil qilyapman…')
            : 'Natijani ko‘rib, keyingi qadamni tanlayapman…',
          at: Date.now(),
        });

        let turnText = '';
        const onDelta = (d) => {
          if (d.notice) {
            this.emit('notice', { text: d.notice });
            return;
          }
          if (d.text) {
            turnText += d.text;
            this.emit('stream', { text: d.text });
          }
        };

        let result;
        try {
          result = await this.callWithFailover(messages, onDelta, () => turnText);
        } catch (e) {
          if (e.aborted || this.aborted) throw e;
          // Lokal kichik model ba'zan tool argumenti JSON'ini buzadi (llama-server 500)
          // va qayta urinishlar ham qutqarmaydi. Agar biror fayl allaqachon yozilgan
          // bo'lsa — butun vazifani yo'qotmaymiz: toolsiz yakuniy javob olamiz.
          // (v4flow C qadamida aynan shu holat butun oqimni yiqitgan edi.)
          const degenerated = /Failed to parse tool call|HTTP 500|bo‘sh javob/i.test(String(e.message || ''));
          if (degenerated && this.createdFiles && this.createdFiles.length) {
            this.emit('notice', { text: '⚠ Model tool argumentini buzdi — yozilgan fayllar asosida yakuniy javobni olaman…' });
            const out = await this.finalTextAnswer(messages, totalUsage, tr, trUp);
            if (out !== null) return { content: out, usage: totalUsage };
          }
          throw e;
        }
        if (result.truncated) {
          this.emit('notice', { text: '✂️ Javob juda cho‘zilib ketdi — oqim cheklandi (lokal model guard)' });
        }

        if (result.usage) {
          totalUsage = totalUsage || { input: 0, output: 0 };
          totalUsage.input += result.usage.prompt_tokens || 0;
          totalUsage.output += result.usage.completion_tokens || 0;
          this.emit('usage', { input: totalUsage.input, output: totalUsage.output });
        }

        const content = result.content || turnText;
        // Some coder models return a tool request as JSON text instead of the
        // OpenAI `tool_calls` field. Parse it before deciding this is a final turn,
        // otherwise the engine returns the JSON to the user without running it.
        if (!result.toolCalls || !result.toolCalls.length) {
          const textCalls = extractTextToolCalls(content);
          if (textCalls.length) {
            result.toolCalls = textCalls;
            this.emit('notice', { text: `🔧 Matndagi tool chaqiruvi qabul qilindi: ${textCalls.map((c) => c.function.name).join(', ')}` });
          }
        }
        const isFinalStep = !(result.toolCalls && result.toolCalls.length);

        // "Kodni chatda qoldirib ketdi" holati: vazifa so'ralgan, hech qanday fayl
        // yozilmagan, javobda esa kod bloki bor — modelni fayl yozishga bir marta qaytaramiz.
        if (
          !this.planMode &&
          isFinalStep &&
          this.nudgeLeft > 0 &&
          needsFileNudge(userText, content) &&
          !(this.createdFiles && this.createdFiles.length)
        ) {
          this.nudgeLeft -= 1;
          this.emit('notice', { text: '↻ Kodni fayl sifatida yozishni so‘rayapman…' });
          messages.push({ role: 'assistant', content: content || '' });
          messages.push({
            role: 'system',
            content:
              'Siz kodni chat oynasida ko‘rsatdingiz, lekin fayl yaratmadingiz. Endi o‘sha kodni ' +
              'write_file tool’i bilan to‘liq yozing (path + content). Kodni qayta yozib chiqmang — faqat tool chaqiring.',
          });
          continue;
        }
        // "Fayl yozildi-u ishga tushirilmadi" holati: vazifa tekshirishni so'ragan bo'lsa,
        // lokal modelni bir marta run_command'ga chorlaymiz (5-bosqich sinovida topilgan).
        if (
          !this.planMode &&
          isFinalStep &&
          this.runNudgeLeft > 0 &&
          !this.ranCommand &&
          this.createdFiles &&
          this.createdFiles.length
        ) {
          this.runNudgeLeft -= 1;
          this.emit('notice', { text: '↻ Yozilgan faylni ishga tushirib tekshirishni so‘rayapman…' });
          messages.push({ role: 'assistant', content: content || '' });
          messages.push({
            role: 'system',
            content:
              'Fayl yozildi, lekin ishga tushirilmadi. Endi run_command tool’i bilan uni ishga tushiring ' +
              '(masalan "python <fayl>") va natijani foydalanuvchiga ko‘rsating. Faylni qayta yozmang.',
          });
          continue;
        }
        const finalContent =
          isFinalStep && this.translateOutput && trUp && content ? await this.maybeTranslate(content, tr) : content;
        if (finalContent) this.emit('stream_flush', { text: finalContent });

        // Tool chaqiruvlarini faqat tasdiqlangan model tool nomlari va args bilan JSON parser qabul qiladi.
        if (result.toolCalls && result.toolCalls.length) {
          const calls = result.toolCalls.map((tc) => {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments || '{}');
            } catch {}
            return { id: tc.id, tool: tc.function.name, args, ...(tc.extra_content ? { extra_content: tc.extra_content } : {}) };
          });
          this.emit('assistant', { text: content, toolCalls: calls });
          messages.push({ role: 'assistant', content: content || null, tool_calls: result.toolCalls });

          for (const call of calls) {
            if (this.aborted) throw Object.assign(new Error('To‘xtatildi'), { aborted: true });

            let approved = true;
            if (TOOLS_NEEDING_APPROVAL.has(call.tool) && !this.config.autoApprove) {
              approved = await new Promise((resolve) => super.emit('approval', { id: call.id, tool: call.tool, args: call.args, agent: this.agentName, respond: resolve }));
            }

            let resultText;
            let ok = true;
            if (!approved) {
              resultText = 'Foydalanuvchi bu buyruqni rad etdi. Boshqa yondashuv bilan davom eting yoki foydalanuvchidan ma’lumot so‘rang.';
              ok = false;
              this.emit('tool', { id: call.id, tool: call.tool, args: call.args, result: '(rad etildi)', ok: false, denied: true });
            } else {
              // Degeneratsiya halqasi himoyasi: bir xil (tool + argumentlar) allaqachon
              // bajarilgan bo'lsa, qayta bajarmaymiz — modelga "keyingi qadamga o't"
              // deb aytamiz. Busiz lokal model aynan bir faylni qayta-qayta yozib,
              // oxir-oqibat tool JSON'ini buzardi (HTTP 500).
              const sig = `${call.tool}|${safeJson(call.args)}`;
              const doneTimes = this.callSigs.get(sig) || 0;
              const limit = REPEAT_LIMITS[call.tool] ?? DEFAULT_REPEAT_LIMIT;
              if (doneTimes >= limit) {
                resultText =
                  'DIQQAT: bu amal yuqorida allaqachon bajarilgan (bir xil argumentlar bilan). ' +
                  'Uni qayta bajarmang — keyingi qadamga o‘ting yoki bajarilgan ish haqida qisqa yakuniy javob yozing.';
                ok = false;
                this.emit('notice', { text: `♻️ Takroriy ${call.tool} chaqiruvi o‘tkazib yuborildi (bu amal bajarilgan)` });
                this.emit('tool', { id: call.id, tool: call.tool, args: call.args, result: '(takror — o‘tkazib yuborildi)', ok: false, repeat: true });
              } else {
                const toolStartedAt = Date.now();
                this.emit('tool_start', { id: call.id, tool: call.tool, args: call.args, at: toolStartedAt });
                try {
                  resultText = await toolCtx.execute(call.tool, call.args);
                } catch (e) {
                  ok = false;
                  resultText = 'Xatolik: ' + (e && e.message ? e.message : String(e));
                }
                // Tool yon ta'siri: yaratilgan/o'zgargan fayllar — UI ularni darhol ochib ko'rsatadi.
                const madeFiles = toolCtx.takeCreatedFiles ? toolCtx.takeCreatedFiles() : [];
                this.emit('tool', {
                  id: call.id,
                  tool: call.tool,
                  args: call.args,
                  result: String(resultText).slice(0, 4000),
                  ok,
                  ms: Date.now() - toolStartedAt,
                  files: madeFiles,
                  at: toolStartedAt,
                });
                if (ok && FILE_CREATING_TOOLS.has(call.tool)) this.trackCreatedFile(call.args);
                if (ok && call.tool === 'run_command') this.ranCommand = true;
                if (ok) this.callSigs.set(sig, doneTimes + 1);
              }
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: String(resultText).slice(0, MAX_TOOL_RESULT) });
          }
          continue;
        }

        if (this.createdFiles && this.createdFiles.length) {
          this.emit('files_created', { paths: this.createdFiles.slice() });
        }
        this.emit('assistant', { text: finalContent });
        // 4-bosqich: reja rejimida qadamlar ro'yxati alohida hodisa sifatida ham yuboriladi
        // (UI reja kartasi + "Qurishni boshlash" tugmasini chizadi).
        if (this.planMode) this.emit('plan', { steps: parsePlanSteps(finalContent), text: finalContent, task: userText });
        this.emit('done', { usage: totalUsage, content: finalContent });
        return { content: finalContent, usage: totalUsage };
      }
      // Qadamlar tugadi, lekin model yakuniy matn yozmadi (masalan Lead yoki lokal
      // kichik model tool'larga urilib qoldi). Qattiq xato berish o'rniga oxirgi
      // marta TOOLSIZ so'raymiz — foydalanuvchi bajarilgan ish haqida xulosa oladi.
      // (Ilgari team rejimida Lead 3 qadamda tugamasa butun jamoa natijasi yo'qolardi.)
      this.emit('notice', { text: `↻ ${this.maxSteps} qadam tugadi — yakuniy javobni toolsiz so‘rayapman…` });
      const out = await this.finalTextAnswer(messages, totalUsage, tr, trUp);
      if (out !== null) return { content: out, usage: totalUsage };
      throw new Error(`Agent ${this.maxSteps} qadamdan oshib ketdi — vazifani kichikroq bo‘laklarga bo‘ling.`);
    } finally {
      this.child = null;
    }
  }
}
