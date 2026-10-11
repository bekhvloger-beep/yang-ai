// providers.js — OpenAI-compatible chat providers with SSE streaming, tool-call deltas,
// rate-limit (quota) capture, and support for user-defined custom providers.
// Pure Node (no electron imports).

export const BUILTIN_PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    models: [
      'nvidia/nemotron-3-super-120b-a12b:free',
      'qwen/qwen3.8-27b:free',
      'thinkingmachines/inkling:free',
      'google/gemma-4-31b-it:free',
      'cohere/north-mini-code:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemini-2.5-flash',
    ],
    visionModels: ['google/gemini-2.5-flash'],
    quota: 'credits',
    extraHeaders: { 'HTTP-Referer': 'https://chatdev.agent', 'X-Title': 'ChatDev Agent' },
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini (direct)',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // Faqat bepul tier'da ishlaydigan modellar — Pro/preview va eski 2.5 modellar 429/404 beradi.
    // Aniq ro'yxat: Sozlamalarda provayder qatoridagi «⤓» tugmasi bilan oling.
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    visionModels: ['gemini-3.8-flash'],
    quota: null,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
    visionModels: [],
    quota: 'headers',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    models: ['gpt-oss-120b', 'qwen-3.8-27b'],
    visionModels: [],
    quota: null,
  },
  huggingface: {
    id: 'huggingface',
    name: 'HuggingFace Router',
    base: 'https://router.huggingface.co/v1',
    models: [
      'zai-org/GLM-5.3-Flash',
      'openai/gpt-oss-120b',
      'Qwen/Qwen3.8-27B',
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'meta-llama/Llama-3.3-70B-Instruct',
      'google/gemma-4-31B-it',
    ],
    visionModels: ['google/gemma-4-31B-it'],
    quota: null,
    extraHeaders: {},
  },
  together: {
    id: 'together',
    name: 'Together AI',
    base: 'https://api.together.xyz/v1',
    models: ['openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    visionModels: [],
    quota: null,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-5.2'],
    visionModels: ['gpt-4o', 'gpt-4o-mini'],
    quota: null,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    // Anthropic OpenAI-mos qatlam: /v1/chat/completions
    base: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
    visionModels: ['claude-sonnet-4-5', 'claude-opus-4-1'],
    quota: null,
  },
  // OFFLINE lokal AI — exe ichida llama.cpp + model. Internet/kalit bo'lmasa ham ishlaydi.
  // RAM bo'yicha model tanlanadi (model-1.7b.gguf / model-4b.gguf / model.gguf).
  // bundled: true — shu provayderni ilovaning O'ZI ko'taradi (main.js), ya'ni
  // "ilova ichidagi lokal AI" tushunchasining yagona manbasi shu def.
  localmini: {
    id: 'localmini',
    name: 'Lokal AI (offline)',
    base: 'http://127.0.0.1:8082/v1',
    models: ['qwen3-instruct', 'qwen2.5-0.5b-instruct'],
    visionModels: [],
    quota: null,
    keyless: true,
    local: true,
    bundled: true,
  },
  // Kalitsiz bepul gateway — lokal AI ishlamasa birinchi zaxira (tez, tool calling bor).
  kilo: {
    id: 'kilo',
    name: 'Kilo (kalitsiz)',
    base: 'https://api.kilo.ai/api/gateway',
    models: ['kilo-auto/free', 'nvidia/nemotron-3-super-120b-a12b:free'],
    visionModels: [],
    quota: null,
    keyless: true,
  },
  // Kalitsiz oxirgi zaxira — anonim tier. Serverlari tez-tez ishlamaydi (ENOSPC/524),
  // shuning uchun zanjirning eng oxirida turadi.
  pollinations: {
    id: 'pollinations',
    name: 'Pollinations (kalitsiz)',
    base: 'https://text.pollinations.ai/openai',
    models: ['openai-fast'],
    visionModels: [],
    quota: null,
    keyless: true,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    visionModels: [],
    quota: 'balance',
  },
  vercel: {
    id: 'vercel',
    name: 'Vercel AI Gateway',
    base: 'https://ai-gateway.vercel.sh/v1',
    models: ['alibaba/qwen3-coder', 'alibaba/qwen-3-235b', 'deepseek/deepseek-v3.2', 'google/gemini-2.5-flash'],
    visionModels: [],
    quota: null,
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    base: 'https://api.cohere.ai/compatibility/v1',
    models: ['command-a-03-2025', 'command-a-reasoning-08-2025', 'c4ai-aya-expanse-32b'],
    visionModels: ['command-a-vision-07-2025', 'c4ai-aya-vision-32b'],
    quota: null,
  },
  sambanova: {
    id: 'sambanova',
    name: 'SambaNova',
    base: 'https://api.sambanova.ai/v1',
    models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-V3.2', 'gpt-oss-120b', 'gemma-4-31B-it'],
    visionModels: [],
    quota: null,
  },
};

// Free API presets shown in the "add provider" dialog (user only pastes a key).
export const PROVIDER_PRESETS = [
  { id: 'kilo', name: 'Kilo Gateway', base: 'https://api.kilo.ai/api/gateway', keyUrl: '', hint: 'Kalit SO\'RAMAYDI — kuchli bepul gateway (nemotron/qwen), tool chaqiruv bilan' },
  { id: 'pollinations', name: 'Pollinations', base: 'https://text.pollinations.ai/openai', keyUrl: '', hint: 'Kalit SO\'RAMAYDI — oxirgi zaxira; serverlari tez-tez javob bermaydi' },
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', hint: 'Pullik (karta + $5 prepaid), juda kuchli. ⤓ Modellar bilan ro\'yxatni yangilang' },
  { id: 'anthropic', name: 'Anthropic (Claude)', base: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys', hint: 'Pullik (karta kerak), Claude — kuchli kod va tahlil. ⤓ Modellar bilan yangilang' },
  { id: 'cerebras', name: 'Cerebras', base: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai', hint: 'Bepul ~1M token/kun, juda tez (gpt-oss-120b) — karta shart emas' },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', hint: 'Eng tez va saxiy bepul (gpt-oss-120b) — tavsiya etiladi' },
  { id: 'cohere', name: 'Cohere', base: 'https://api.cohere.ai/compatibility/v1', keyUrl: 'https://dashboard.cohere.com/api-keys', hint: 'Trial kalit bepul: ~1000 chaqiruv/oy, karta SHART emas' },
  { id: 'dashscope', name: 'Qwen (DashScope)', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.alibabacloud.com', hint: 'Yangi hisobga bepul kvota — qwen3-coder kuchli kod modeli' },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai', hint: 'Free tarif default yoqilgan, karta SHART emas' },
  { id: 'sambanova', name: 'SambaNova', base: 'https://api.sambanova.ai/v1', keyUrl: 'https://cloud.sambanova.ai', hint: 'Tez Llama modellar, free tarif' },
  { id: 'zai', name: 'Z.ai (GLM)', base: 'https://api.z.ai/api/paas/v4', keyUrl: 'https://z.ai/model-api', hint: 'GLM modellar — kod va general uchun kuchli' },
  { id: 'nvidia', name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', keyUrl: 'https://build.nvidia.com', hint: 'Bepul kreditlar, 100+ model' },
  { id: 'together', name: 'Together AI', base: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys', hint: 'Boshlanish krediti, Llama/Qwen/DeepSeek' },
  { id: 'huggingface', name: 'HuggingFace Router', base: 'https://router.huggingface.co/v1', keyUrl: 'https://huggingface.co/settings/tokens', hint: 'Oylik bepul kredit, 100+ ochiq model' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys', hint: 'Kreditingiz bo‘lmasa ham :free modellar ishlaydi' },
  { id: 'vercel', name: 'Vercel AI Gateway', base: 'https://ai-gateway.vercel.sh/v1', keyUrl: 'https://vercel.com/dashboard', hint: '406+ model — lekin hisobga karta ulanishi SHART' },
  { id: 'local', name: 'Ollama (lokal)', base: 'http://localhost:11434/v1', keyUrl: '', hint: 'Kompyuterdagi lokal modellar — offline va bepul, “Lokal skan” tugmasi bilan toping', local: true },
  { id: 'lmstudio', name: 'LM Studio (lokal)', base: 'http://localhost:1234/v1', keyUrl: '', hint: 'LM Studio server — lokal, offline', local: true },
];

// Specialty strengths used by the team router to spread agents across providers.
const S = {
  cerebras: { 'gpt-oss-120b': ['reasoning', 'general', 'coding'], 'qwen-3.8-27b': ['coding', 'fast'] },
  openai: { 'gpt-4o-mini': ['fast', 'general', 'vision'], 'gpt-4o': ['general', 'vision', 'reasoning'], 'gpt-5.2': ['reasoning', 'hard', 'general'] },
  anthropic: { 'claude-sonnet-4-5': ['reasoning', 'coding', 'hard', 'vision'], 'claude-haiku-4-5': ['fast', 'coding'], 'claude-opus-4-1': ['reasoning', 'hard', 'coding', 'vision'] },
  localmini: {
    'qwen3-instruct': ['general', 'coding', 'multilingual', 'offline', 'free'],
    'qwen2.5-0.5b-instruct': ['fast', 'general', 'offline', 'free'],
  },
  kilo: {
    'kilo-auto/free': ['fast', 'general', 'coding', 'multilingual', 'free'],
    'nvidia/nemotron-3-super-120b-a12b:free': ['reasoning', 'general', 'coding', 'free'],
  },
  pollinations: { 'openai-fast': ['fast', 'general', 'coding', 'multilingual'] },
  huggingface: {
    'zai-org/GLM-5.3-Flash': ['reasoning', 'general', 'coding', 'multilingual'],
    'openai/gpt-oss-120b': ['reasoning', 'general', 'coding'],
    'Qwen/Qwen3.8-27B': ['coding', 'general'],
    'deepseek-ai/DeepSeek-V4.1-Flash': ['coding', 'fast'],
    'meta-llama/Llama-3.3-70B-Instruct': ['general'],
    'google/gemma-4-31B-it': ['multilingual', 'vision', 'general'],
  },
  groq: { 'openai/gpt-oss-120b': ['reasoning', 'general', 'coding'], 'qwen/qwen3.8-27b': ['coding', 'fast'] },
  gemini: { 'gemini-3.8-flash': ['vision', 'fast', 'general'], 'gemini-3.5-flash-lite': ['fast', 'general'], 'gemini-3.1-flash-lite': ['fast', 'general', 'multilingual'] },
  openrouter: {
    'nvidia/nemotron-3-super-120b-a12b:free': ['reasoning', 'general'],
    'nvidia/nemotron-3-ultra-550b-a55b:free': ['reasoning', 'hard'],
    'qwen/qwen3.8-27b:free': ['coding', 'general'],
    'thinkingmachines/inkling:free': ['general', 'research'],
    'google/gemma-4-31b-it:free': ['multilingual', 'general'],
    'cohere/north-mini-code:free': ['coding'],
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': ['vision', 'omni'],
    'google/gemini-2.5-flash': ['vision', 'fast'],
  },
  deepseek: { 'deepseek-chat': ['coding', 'general'], 'deepseek-reasoner': ['reasoning', 'hard'] },
  cohere: {
    'command-a-03-2025': ['general', 'reasoning'],
    'command-a-reasoning-08-2025': ['reasoning', 'hard'],
    'c4ai-aya-expanse-32b': ['multilingual', 'general'],
    'command-a-vision-07-2025': ['vision'],
    'c4ai-aya-vision-32b': ['vision', 'multilingual'],
  },
  sambanova: {
    'Meta-Llama-3.3-70B-Instruct': ['general'],
    'DeepSeek-V3.2': ['coding', 'general'],
    'gpt-oss-120b': ['reasoning', 'coding'],
    'gemma-4-31B-it': ['multilingual', 'general'],
  },
};

// Providers suspended due to auth/balance failures; health: {id: {until: epochMs}}
export function isProviderHealthy(config, id) {
  const h = (config && config.providerHealth) || {};
  return !(h[id] && h[id].until && h[id].until > Date.now());
}

export function suspendProvider(config, id, minutes = 60) {
  if (!config.providerHealth) config.providerHealth = {};
  config.providerHealth[id] = { until: Date.now() + minutes * 60000 };
}

// Balansi tugagan / kaliti o'lik provayderlar — rotatsiyadan chiqariladi
// (sozlamalarda qayta yoqish mumkin: config.disabledProviders dan o'chirish).
export const DEFAULT_DISABLED_PROVIDERS = ['deepseek', 'vercel', 'sambanova'];

export function isProviderEnabled(config, id) {
  const list = (config && config.disabledProviders) || DEFAULT_DISABLED_PROVIDERS;
  return !list.includes(id);
}

// ---------- client-side rate limiter (bepul tier'lar uchun) ----------
// Har provayderga so'rovlar oralig'ini va parallel oqimlar sonini cheklaydi,
// 429 yomg'irini ildizidan quritadi.
const RATE_LIMITS = {
  groq: { minIntervalMs: 3200, concurrency: 1 },      // free: ~30 req/min
  cerebras: { minIntervalMs: 12000, concurrency: 1 }, // free: ~5 req/min
  gemini: { minIntervalMs: 4500, concurrency: 1 },    // free: ~10-15 req/min
  openrouter: { minIntervalMs: 3500, concurrency: 1 },// :free: ~20 req/min, 50/kun
  cohere: { minIntervalMs: 8000, concurrency: 1 },    // trial: ~1000/oy
  huggingface: { minIntervalMs: 4000, concurrency: 1 },// bepul oylik kredit — tez yonmasin
  together: { minIntervalMs: 1500, concurrency: 2 },
  pollinations: { minIntervalMs: 2500, concurrency: 1 },// anonymous tier — tez javob, yumshoq cheklov
  kilo: { minIntervalMs: 1500, concurrency: 1 },        // kalitsiz gateway — ~200 soatiga
};
const slots = new Map();

function trySchedule(id) {
  const s = slots.get(id);
  const lim = RATE_LIMITS[id];
  if (!s || !lim) return;
  while (s.waiters.length && s.waiters[0].dead) s.waiters.shift();
  if (s.active >= lim.concurrency || !s.waiters.length) return;
  const w = s.waiters.shift();
  s.active++;
  const delay = Math.max(0, s.nextStart - Date.now());
  s.nextStart = Date.now() + lim.minIntervalMs;
  setTimeout(() => {
    if (w.dead) { s.active--; trySchedule(id); return; }
    w.resolve();
  }, delay);
}

async function acquireSlot(providerId, signal) {
  const lim = RATE_LIMITS[providerId];
  if (!lim) return () => {};
  let s = slots.get(providerId);
  if (!s) {
    s = { active: 0, waiters: [], nextStart: 0 };
    slots.set(providerId, s);
  }
  await new Promise((resolve, reject) => {
    const w = { resolve, dead: false };
    s.waiters.push(w);
    trySchedule(providerId);
    if (signal) signal.addEventListener('abort', () => {
      w.dead = true;
      reject(Object.assign(new Error('To‘xtatildi'), { aborted: true }));
    }, { once: true });
  });
  return () => {
    s.active = Math.max(0, s.active - 1);
    trySchedule(providerId);
  };
}

// 429 uchun maxsus xato — engine buni qisqa muddatli "band" sifatida ko'radi.
export class RateLimitError extends Error {
  constructor(message, retryAfterMs = 0) {
    super(message);
    this.name = 'RateLimitError';
    this.rateLimited = true;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(header) {
  if (!header) return 0;
  const n = Number(header);
  if (!Number.isNaN(n)) return Math.max(0, n * 1000);
  const d = Date.parse(header);
  return Number.isNaN(d) ? 0 : Math.max(0, d - Date.now());
}

export function modelStrengths(providerId, model, def) {
  if (S[providerId] && S[providerId][model]) return S[providerId][model];
  if (def && def.custom) {
    const m = String(model).toLowerCase();
    const out = [];
    if (/coder|code/.test(m)) out.push('coding');
    if (/r1|reason|think/.test(m)) out.push('reasoning');
    if (/vision|vl|omni|llava|multimodal/.test(m)) out.push('vision');
    if (/gemma|qwen|aya/.test(m)) out.push('multilingual');
    if (def.local) out.push('offline', 'free');
    return out.length ? out : ['general', 'offline', 'free'];
  }
  return ['general'];
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  const octets = host.split('.');
  return octets.length === 4 && octets[0] === '127' && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function isLocalProviderBase(base) {
  try {
    const url = new URL(base);
    return url.protocol === 'http:' && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

// Merge builtin + user custom providers. Custom: {id, name, base, models:[], vision:bool, key}
export function getAllProviders(config) {
  const out = {};
  for (const [id, p] of Object.entries(BUILTIN_PROVIDERS)) out[id] = { ...p };
  for (const c of (config && config.customProviders) || []) {
    out[c.id] = {
      id: c.id,
      name: c.name || c.id,
      base: c.base,
      models: c.models || [],
      visionModels: c.vision ? (c.models || []) : [],
      quota: null,
      custom: true,
      local: isLocalProviderBase(c.base),
      keyless: isLocalProviderBase(c.base),
      inlineKey: c.key || '',
    };
  }
  return out;
}

// ---- "ilova ichidagi lokal AI" uchun yagona manba ----
// Provayder id'sini, manzilini (host/port) va model nomini so'rash yo'lini bitta joydan
// beradi: port, nom yoki model fayli o'zgarsa faqat shu fayl o'zgaradi.
export function isBundledLocalProvider(config, id) {
  const def = getAllProviders(config)[id];
  return !!(def && def.bundled);
}

export function localEndpoint(config) {
  const def = getAllProviders(config || {})['localmini'] || BUILTIN_PROVIDERS.localmini;
  const raw = String((def && def.base) || 'http://127.0.0.1:8082/v1');
  try {
    const u = new URL(raw);
    const fallbackPort = u.protocol === 'https:' ? 443 : 80;
    return { host: u.hostname, port: Number(u.port) || fallbackPort, base: raw.replace(/\/+$/, '') };
  } catch {
    return { host: '127.0.0.1', port: 8082, base: 'http://127.0.0.1:8082/v1' };
  }
}

// ---- lokal server tayyorligini kutish ----
// Ilova ishga tushganda lokal serverni FONDA o'zi ko'taradi; model yuklanguncha port javob
// bermaydi. O'lchov (1.7B bundle, issiq kesh): ~2.1 s; yangi o'rnatishda (sovuq disk) undan
// ancha uzoq. Ilgari birinchi xabar darhol yuborilsa "fetch failed" bo'lardi — pin rejimda
// zaxira yo'q, shuning uchun butun run xato bilan tugardi.
const LOCAL_READY_TIMEOUT_MS = 45000;
const LOCAL_READY_FAIL_MEMO_MS = 5 * 60 * 1000;
let localWaitFailedAt = 0;

export async function localServerUp(config) {
  const { base } = localEndpoint(config);
  try {
    const res = await fetch(base + '/models', { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Lokal server tayyor bo'lishini kutadi (fonda ko'tarilayotganini hisobga olib).
// shouldStop — foydalanuvchi "To'xtatish" bosgan bo'lsa kutishni tashlab ketadi.
export async function waitLocalServerReady(config, { shouldStop } = {}) {
  if (await localServerUp(config)) return true;
  // Bir marta kutib bo'lmay qolsa, keyingi 5 daqiqada qayta uzoq kutmamiz.
  if (Date.now() - localWaitFailedAt < LOCAL_READY_FAIL_MEMO_MS) return false;
  const started = Date.now();
  let delay = 400;
  for (;;) {
    if (shouldStop && shouldStop()) return false;
    if (Date.now() - started >= LOCAL_READY_TIMEOUT_MS) {
      localWaitFailedAt = Date.now();
      return false;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.4), 2000);
    if (await localServerUp(config)) return true;
  }
}

// Kalitsiz provayderlar (Pollinations/Kilo/lokal) uchun uzoqroq 5xx backoff ishlatiladi.
function isKeylessProvider(id) {
  const def = BUILTIN_PROVIDERS[id];
  return !!(def && def.keyless);
}

// Fetch the /models list from any OpenAI-compatible endpoint (for the add-provider dialog).
export async function fetchModelList(base, key) {
  const res = await fetch(base.replace(/\/$/, '') + '/models', {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — modellarni olib bo‘lmadi`);
  const j = await res.json();
  return (j.data || []).map((m) => m.id).filter(Boolean);
}

// Lazily estimate how much RAM a model of roughly `sizeBytes` on disk needs at
// inference; GGUF Q4-class quantized weights typically need ~1.15x disk plus a
// small KV/context overhead. Conservative on purpose — never understates.
export function estimateModelRamGb(sizeBytes, contextHint) {
  const bytes = Number(sizeBytes) || 0;
  if (bytes <= 0) return null;
  const factor = Number.isFinite(Number(contextHint)) && Number(contextHint) > 4096 ? 1.35 : 1.15;
  return (bytes * factor) / 1024 ** 3;
}

// Probe common local AI servers (Ollama, LM Studio) and report each model's
// on-disk size, so users can pick a small model when RAM is tight.
export async function scanLocalProviders() {
  const found = [];
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const j = await res.json();
      const models = (j.models || []).map((m) => ({
        name: m.name,
        sizeBytes: Number(m.size) || null,
        ramGb: estimateModelRamGb(m.size, m.details?.context_length),
      })).filter((m) => m.name);
      if (models.length) found.push({ kind: 'Ollama', base: 'http://localhost:11434/v1', models });
    }
  } catch {}
  try {
    const res = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const j = await res.json();
      const models = (j.data || []).map((m) => ({
        name: m.id,
        sizeBytes: Number(m.size_bytes || m.size) || null,
        ramGb: estimateModelRamGb(m.size_bytes || m.size),
      })).filter((m) => m.name);
      if (models.length) found.push({ kind: 'LM Studio', base: 'http://localhost:1234/v1', models });
    }
  } catch {}
  return found;
}

export function getProviderKey(config, providerId) {
  return (config.keys && config.keys[providerId]) || (getAllProviders(config)[providerId] || {}).inlineKey || '';
}

const STALL_TIMEOUT_MS = 180000;
const MAX_TOKENS = 8192;
const RETRY_DELAYS = [1500, 4000]; // tezkor: 524/band serverda uzoq kutmasdan keyingi modelga o'tamiz

async function sleep(ms, signal) {
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('To‘xtatildi')); }, { once: true });
  });
}

function sseLines(onData) {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  };
}

function readQuotaHeaders(res) {
  const h = res.headers;
  const g = (n) => h.get(n);
  const out = {};
  if (g('x-ratelimit-remaining-requests') != null) out.remainingRequests = +g('x-ratelimit-remaining-requests');
  if (g('x-ratelimit-limit-requests') != null) out.limitRequests = +g('x-ratelimit-limit-requests');
  if (g('x-ratelimit-remaining-tokens') != null) out.remainingTokens = +g('x-ratelimit-remaining-tokens');
  if (g('x-ratelimit-limit-tokens') != null) out.limitTokens = +g('x-ratelimit-limit-tokens');
  if (g('x-ratelimit-reset-tokens')) out.resetTokens = g('x-ratelimit-reset-tokens');
  return Object.keys(out).length ? out : null;
}

/**
 * Stream a chat completion with tools. Returns:
 * { content, toolCalls, finishReason, usage, quota, provider, model }
 */
export async function streamChat({ base, key, model, messages, tools, signal, onDelta, extraHeaders, providerId, extraBody, guardChars, retryOn500 }) {
  const body = { model, messages, stream: true, max_tokens: MAX_TOKENS, ...(extraBody || {}) };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const release = await acquireSlot(providerId, signal);
  let res;
  try {
    res = await streamChatInner({ base, key, model, messages, tools, signal, onDelta, extraHeaders, providerId, body, guardChars, retryOn500 });
  } finally {
    release();
  }
  return res;
}

// Kalitsiz Pollinations serveri ko'p vaqt band bo'ladi (524) — boshqa provayder
// qolmasa uzoqroq kutishga arziydi.
const KEYLESS_RETRY_DELAYS = [2000, 5000]; // kalitsiz ham tez topshiramiz — lokal AI zaxira turibdi

async function streamChatInner({ base, key, model, messages, tools, signal, onDelta, extraHeaders, providerId, body, guardChars, retryOn500 }) {
  let res;
  const keyless = isKeylessProvider(providerId);
  const delays = keyless ? KEYLESS_RETRY_DELAYS : RETRY_DELAYS;
  for (let attempt = 0; ; attempt++) {
    let attemptRes;
    try {
      attemptRes = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...(extraHeaders || {}) },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('To‘xtatildi'), { aborted: true });
      throw e;
    }
    if (attemptRes.ok) {
      res = attemptRes;
      break;
    }
    const errText = await attemptRes.text().catch(() => '');
    let errMsg = `HTTP ${attemptRes.status}`;
    try {
      const j = JSON.parse(errText);
      errMsg += ': ' + (j.error?.message || errText.slice(0, 300));
    } catch {
      errMsg += ': ' + errText.slice(0, 300);
    }
    if (attemptRes.status === 429) {
      const retryAfterMs = parseRetryAfter(attemptRes.headers.get('retry-after'));
      if (attempt === 0) {
        const wait = Math.min(Math.max(retryAfterMs, 3000), 60000);
        if (onDelta) onDelta({ notice: `${model}: limitga yetdi (HTTP 429) — ${Math.round(wait / 1000)}s kutaman...` });
        await sleep(wait, signal);
        continue;
      }
      throw new RateLimitError(`HTTP 429 — limit`, retryAfterMs);
    }
    // Lokal model tool argumenti ichida takrorlanib ketsa yoki uzun JSON yozib token
    // chegarasiga urilsa, llama-server tool JSON'ini parslay olmay 500 qaytaradi
    // (o'lchov: bitta 2048-tokenlik degeneratsiya, v4flow C qadami). Ikki marta tez
    // qayta urinamiz; ikkinchisidan oldin modeldan QISQA tool JSON so'raymiz — uzun
    // content chegarada uzilib qolgan bo'lishi mumkin. Uchinchisida ham buzilsa —
    // takrorlanuvchi degeneratsiya, ortiqcha kutmasdan xato beramiz.
    if (attemptRes.status === 500 && retryOn500 && /Failed to parse tool call/i.test(errText)) {
      if (attempt <= 1) {
        if (attempt === 0) {
          if (onDelta) onDelta({ notice: `${model}: tool argumenti buzildi (HTTP 500) — qayta urinaman...` });
          await sleep(700, signal);
        } else {
          if (onDelta) onDelta({ notice: `${model}: yana buzildi — qisqa tool chaqiruvi bilan qayta urinaman...` });
          // Model uzun JSON yozib chegaraga urilgan bo'lishi mumkin — qisqa yozishga o'tamiz.
          body.messages = [
            ...body.messages,
            {
              role: 'system',
              content:
                'Oldingi urinishda tool argumenti (JSON) yarim qolib ketdi. Endi BITTA tool chaqiruvini ' +
                "yozing va content'ni qisqa saqlang (1500 belgidan oshirmang) — JSON to'liq yopilsin.",
            },
          ];
          await sleep(1200, signal);
        }
        continue;
      }
      throw new Error(errMsg);
    }
    if (attemptRes.status >= 500 && attempt < delays.length) {
      if (onDelta) onDelta({ notice: `${model}: server band (HTTP ${attemptRes.status}) — ${Math.round(delays[attempt] / 1000)}s dan keyin qayta urinaman...` });
      await sleep(delays[attempt], signal);
      continue;
    }
    throw new Error(errMsg);
  }

  const quota = readQuotaHeaders(res);

  // Stall guard
  let stall = setTimeout(() => signal?.abort(new Error('Model javobi uzoq vaqt davomida kelmadi (stall timeout)')), STALL_TIMEOUT_MS);
  const bump = () => {
    clearTimeout(stall);
    stall = setTimeout(() => signal?.abort(new Error('Model javobi uzoq vaqt davomida kelmadi (stall timeout)')), STALL_TIMEOUT_MS);
  };

  const contentParts = [];
  const toolAcc = new Map();
  let finishReason = null;
  let usage = null;
  let contentChars = 0;
  let guardTripped = false;

  const handlePayload = (payload) => {
    if (guardTripped) return;
    if (payload === '[DONE]') return;
    let j;
    try {
      j = JSON.parse(payload);
    } catch {
      return;
    }
    if (j.usage) usage = j.usage;
    const choice = j.choices && j.choices[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content) {
      contentParts.push(delta.content);
      contentChars += delta.content.length;
      if (onDelta) onDelta({ text: delta.content });
      // Guard: lokal kichik model tool chaqirmasdan cheksiz matn yozishi mumkin
      // (o'lchov: 5341 token — javob 9 daqiqaga cho'zilgan). Matn `guardChars`
      // chegarasidan oshsa va hali bitta ham tool chaqiruvi ko'rinmasa — oqim
      // to'xtatiladi (finish_reason: 'guard'). Tool args alohida delta bo'lgani
      // uchun bu chegara write_file mazmuniga tegmaydi.
      if (guardChars && toolAcc.size === 0 && contentChars >= guardChars) {
        guardTripped = true;
        finishReason = finishReason || 'guard';
      }
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const i = typeof tc.index === 'number' ? tc.index : 0;
        if (!toolAcc.has(i)) toolAcc.set(i, { id: '', name: '', args: '', extraContent: null });
        const acc = toolAcc.get(i);
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        // Gemini 3 tool chaqiruvida "thought_signature" qaytaradi — uni keyingi
        // so'rovda qaytarmasak, Gemini HTTP 400 beradi (funksiya ishlamaydi).
        if (tc.extra_content) acc.extraContent = tc.extra_content;
        if (onDelta) {
          onDelta({ toolIndex: i, toolId: acc.id || undefined, toolName: acc.name || undefined, toolArgsDelta: tc.function?.arguments || undefined });
        }
      }
    }
  };

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const feed = sseLines((d) => {
      bump();
      handlePayload(d);
    });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
      if (guardTripped) {
        try { await reader.cancel(); } catch {}
        break;
      }
    }
    feed(decoder.decode());
  } catch (e) {
    clearTimeout(stall);
    if (signal?.aborted) {
      if (!contentParts.length && toolAcc.size === 0) throw Object.assign(new Error('To‘xtatildi'), { aborted: true });
    } else throw e;
  }
  clearTimeout(stall);

  const toolCalls = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id || `call_${v.name}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: { name: v.name, arguments: v.args || '{}' },
      ...(v.extraContent ? { extra_content: v.extraContent } : {}),
    }));

  return {
    content: contentParts.join(''),
    toolCalls: toolCalls.length ? toolCalls : null,
    finishReason,
    usage,
    quota,
    provider: providerId,
    model,
    truncated: guardTripped,
  };
}

/* ---------- quota checks (for the UI) ---------- */
export async function fetchQuota(config, providerId) {
  const def = getAllProviders(config)[providerId];
  const key = getProviderKey(config, providerId);
  if (!def || (!key && !def.keyless) || !def.base) return { provider: providerId, available: false, text: 'kalit yo‘q' };
  if (def.keyless) return { provider: providerId, available: true, text: 'kalitsiz bepul (juda yumshoq limit)' };
  try {
    if (def.quota === 'credits') {
      const res = await fetch(def.base + '/credits', { headers: { authorization: `Bearer ${key}`, ...(def.extraHeaders || {}) } });
      if (res.ok) {
        const j = await res.json();
        const d = j.data || {};
        const total = Number(d.total_credits ?? 0);
        const used = Number(d.usage ?? 0);
        if (total > 0) return { provider: providerId, available: true, text: `$${(total - used).toFixed(3)} / $${total.toFixed(2)} kredit` };
        return { provider: providerId, available: true, text: 'bepul tarif (kundalik limit)' };
      }
      return { provider: providerId, available: true, text: `HTTP ${res.status}` };
    }
    if (def.quota === 'balance') {
      const res = await fetch(def.base.replace(/\/v1$/, '') + '/user/balance', { headers: { authorization: `Bearer ${key}` } });
      if (res.ok) {
        const j = await res.json();
        const b = j.balance_infos?.[0];
        return { provider: providerId, available: j.is_available !== false, text: b ? `${b.total_balance} ${b.currency}` : 'balans noma’lum' };
      }
      return { provider: providerId, available: true, text: `HTTP ${res.status}` };
    }
    if (def.quota === 'headers') {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(def.base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: def.models[0] || 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const q = readQuotaHeaders(res);
      await res.text().catch(() => '');
      if (q) {
        const parts = [];
        if (q.remainingRequests != null) parts.push(`${q.remainingRequests} req`);
        if (q.remainingTokens != null) parts.push(`${Math.max(0, Math.round(q.remainingTokens / 100) / 10)}k tok/min`);
        return { provider: providerId, available: res.ok || !!q, text: parts.join(' · ') || 'limit noma’lum', reset: q.resetTokens };
      }
      return { provider: providerId, available: res.ok, text: res.ok ? 'ulandi' : `HTTP ${res.status}` };
    }
    return { provider: providerId, available: true, text: 'ulandi (limit noma’lum)' };
  } catch (e) {
    return { provider: providerId, available: false, text: e.message };
  }
}
