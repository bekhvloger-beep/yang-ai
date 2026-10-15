// team.js — multi-agent team orchestration with PARALLEL execution and
// capability-based provider routing (each agent gets its own API when possible).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { AgentEngine } from './engine.js';
import { streamChatFitted, getAllProviders, getProviderKey, modelStrengths, isProviderHealthy, suspendProvider, isProviderEnabled } from './providers.js';

// Planner (reja) so'rovini lokal modelga yuboradi. Umumiy `streamChatFitted` ishlatiladi:
// lokal llama-server konteksti (8192) dan katta so'rov HTTP 400 qaytaradi va Jamoa rejimi
// butunlay to'xtardi (o'lchov: 13 835 tokenli so'rov). Rasm biriktirilgan bo'lsa, ilova
// ichidagi model uni baribir ko'ra olmaydi — qisqartirishda rasm olib tashlanadi.
async function plannerCall({ def, id, key, model, messages, signal, extraBody, guardChars, onNotice }) {
  const { result, fit } = await streamChatFitted({
    base: def.base, key, model, messages, tools: [], signal,
    extraHeaders: def.extraHeaders, providerId: id, extraBody, guardChars, def,
    onTrim: ({ ctx, fit: f }) => {
      if (!onNotice) return;
      onNotice(f.images
        ? '✂️ Reja so‘rovidagi rasm olib tashlandi — ilova ichidagi lokal matn modeli rasmni ko‘ra olmaydi'
        : `✂️ Reja so‘rovi lokal model kontekstiga (${ctx} token) sig‘dirildi`);
    },
  });
  return { content: result.content, quota: result.quota, fit };
}

const CONCURRENCY = 3;

function extractJson(text) {
  let t = String(text || '').replace(/```json/gi, '```').replace(/```/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

const AGENT_ICONS = ['🧠', '👨‍💻', '🧪', '🔍', '🎨', '📐', '⚙️', '📊', '🛠️', '📝'];
const SPECIALTIES = 'coding, research, docs, data, review, multilingual, vision, general';

function explicitFileTargets(task) {
  const extensions = '(?:py|pyi|js|jsx|mjs|cjs|ts|tsx|html|css|json|md|txt|java|go|rs|sh|ya?ml|toml|sql|vue|svelte|php|rb|cs|cpp|h|xml|svg)';
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:[\\p{L}\\p{N}._-]+[\\\\/])*[\\p{L}\\p{N}._-]+\\.${extensions}\\b`, 'giu');
  const seen = new Set();
  const text = String(task || '');
  return [...text.matchAll(pattern)]
    .filter((match) => {
      const prefix = text.slice(0, match.index);
      const tokenStart = Math.max(...[' ', '\n', '\t', '"', "'", '(', '`', '='].map((separator) => prefix.lastIndexOf(separator)));
      const pathPrefix = prefix.slice(tokenStart + 1);
      return !(/^[A-Za-z]:/.test(pathPrefix) || pathPrefix.startsWith('/') || pathPrefix.startsWith(String.fromCharCode(92)));
    })
    .map((match) => match[0])
    .filter((file) => {
      const key = file.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function routeExplicitFileTasks(task, agents) {
  const text = String(task || '');
  const hasMultiAgentIntent = /\b(?:two|three|multiple|several|agents?|collaborat|each agent|team of)\b|(?:jamoa|agentlar|agent|bir nechta|bir necha|ikkita|alohida)/iu.test(text);
  const hasFileWork = /\b(?:create|make|write|build|edit|update|change|fix|implement|add|generate|modify|refactor)\b|(?:yarat|yoz|qur|yas|o['‘’]?zgartir|tuzat|tahrir|qo['‘’]?sh)\p{L}*/iu.test(text);
  const files = explicitFileTargets(task);
  if (files.length < 2 || (!hasMultiAgentIntent && !hasFileWork)) return agents;
  return files.map((file, index) => ({
    name: `File-${index + 1}`,
    role: 'fayl bo‘yicha mutaxassis',
    specialty: 'coding',
    task: `Foydalanuvchining to‘liq talabi: ${task}\n\nSening aniq mas’uliyating: faqat "${file}" fayli ustida ishlash. Boshqa fayllarni yaratma yoki o‘zgartirma.`,
    icon: AGENT_ICONS[index % AGENT_ICONS.length],
  }));
}

function isSimpleFileTask(task) {
  const text = String(task || '');
  const hasFile = /(?:^|[^\p{L}\p{N}])(?:files?|fayl(?:lar)?(?:i|ini|ni|ga|da|dan)?)(?=$|[^\p{L}\p{N}])/iu.test(text);
  const hasCreateVerb = /(?:^|[^\p{L}\p{N}])(?:create|make|write|build)(?=$|[^\p{L}\p{N}])/iu.test(text) || /(?:yarat|yoz|qur|yas)\p{L}*/iu.test(text);
  const asksForMore = /\b(?:multiple|several|project|application|app|website|review|test suite|agents?|team|collaborat|each|separate|different)\b|(?:bir nechta|bir necha|ikkita|ko‘p|ko'p|loyiha|ilova|veb.?sayt|jamoa|platforma|agent|alohida|turli)/iu.test(text);
  return hasFile && hasCreateVerb && !asksForMore && explicitFileTargets(text).length < 2;
}

function isMultiAgentTask(task) {
  const text = String(task || '');
  return /\b(?:two|three|multiple|several|agents?|collaborat|separate files?|each agent|team of)\b|(?:jamoa|agentlar|agent|bir nechta|bir necha|ikkita|alohida fayl|turli fayl)/iu.test(text);
}

const FILE_WORK_WORDS = /\b(?:create|make|write|build|edit|update|change|fix|implement|add|generate|modify|refactor)\b|(?:yarat|yoz|qur|yas|o['‘’]?zgartir|tuzat|tahrir|qo['‘’]?sh)\p{L}*/iu;
const EXECUTION_WORDS = /\b(?:run|execute|test|verify|validate|check|build)\b|(?:ishga tushir|tekshir|sinab ko|bajarib ko|test qil)/iu;

export function auditRequestedArtifacts(task, workspace) {
  if (!FILE_WORK_WORDS.test(String(task || ''))) return [];
  const root = path.resolve(workspace);
  return explicitFileTargets(task).map((file) => {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    const contained = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    let exists = false;
    if (contained) {
      try {
        const actual = fs.realpathSync(absolute);
        const actualRelative = path.relative(root, actual);
        exists = actualRelative !== '..' && !actualRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(actualRelative) && fs.statSync(actual).isFile();
      } catch {}
    }
    return { path: file, exists, contained };
  });
}

function hasVerifiedExecution(audit, commandResults, workspace) {
  if (audit.some((file) => !file.exists || !file.contained)) return false;
  return commandResults.some((event) => {
    if (!event.ok || event.denied || event.repeat) return false;
    if (!audit.length) return true;
    if (!Number.isInteger(event.timelineIndex) || !Array.isArray(event.toolTimeline)) return false;
    const lastRelevantWrite = event.toolTimeline.reduce((last, entry, index) => {
      if (!entry.ok || !['write_file', 'edit_file', 'create_document'].includes(entry.tool)) return last;
      const writtenPath = entry.args?.path;
      if (!writtenPath) return last;
      return audit.some((file) => path.resolve(workspace, file.path) === path.resolve(workspace, writtenPath)) ? index : last;
    }, -1);
    const allArtifactsWritten = audit.every((file) => event.toolTimeline.some((entry) =>
      entry.ok && ['write_file', 'edit_file', 'create_document'].includes(entry.tool) && entry.args?.path &&
      path.resolve(workspace, file.path) === path.resolve(workspace, entry.args.path)));
    return allArtifactsWritten && event.timelineIndex > lastRelevantWrite;
  });
}

function outstandingArtifactRequirements(task, audit, commandResults, workspace) {
  const missing = audit.filter((file) => !file.exists).map((file) => `fayl yo‘q: ${file.path}`);
  if (audit.some((file) => !file.contained)) missing.push('workspace tashqarisidagi yo‘l xavfsiz deliverable sifatida qabul qilinmadi');
  const asksForExecution = EXECUTION_WORDS.test(String(task || ''));
  const successfulExecution = hasVerifiedExecution(audit, commandResults, workspace);
  if (asksForExecution && !successfulExecution) {
    missing.push('barcha so‘ralgan fayllar oxirgi marta yozilgandan keyingi muvaffaqiyatli run_command tasdig‘i yo‘q');
  }
  if (missing.length && !asksForExecution && !successfulExecution) {
    missing.push('yetishmovchilikdan keyin muvaffaqiyatli run_command bilan qayta tekshirish tasdig‘i yo‘q');
  }
  return missing;
}

function summarizeArtifactOutcome(task, audit, commandResults, outstanding, workspace) {
  const existing = audit.filter((file) => file.exists).map((file) => `\`${file.path}\``);
  const missing = audit.filter((file) => !file.exists).map((file) => `\`${file.path}\``);
  const lines = [];
  if (outstanding.length) lines.push('⚠️ Ish to‘liq tasdiqlanmadi.');
  else lines.push('✅ So‘ralgan fayllar mavjud va tekshirildi.');
  if (existing.length) lines.push(`Mavjud fayllar: ${existing.join(', ')}.`);
  if (missing.length) lines.push(`Hali topilmagan fayllar: ${missing.join(', ')}.`);
  if (outstanding.some((item) => /run_command tasdig‘i yo‘q/.test(item))) {
    lines.push('Ishga tushirish/tekshiruv muvaffaqiyati tasdiqlanmadi.');
  }
  const successful = [...commandResults].reverse().find((event) => hasVerifiedExecution(audit, [event], workspace));

  if (successful && hasVerifiedExecution(audit, [successful], workspace)) {
    const output = String(successful.result || '').trim().slice(0, 500);
    lines.push(`Buyruq muvaffaqiyatli: \`${successful.args?.command || '(buyruq nomi yo‘q)'}\`${output ? ` — ${output}` : '.'}`);
  } else if (commandResults.length) {
    const last = commandResults.at(-1);
    lines.push(`Oxirgi buyruq muvaffaqiyatsiz: \`${last.args?.command || '(buyruq nomi yo‘q)'}\`${last.result ? ` — ${String(last.result).trim().slice(0, 300)}` : '.'}`);
  }
  if (outstanding.length) lines.push(`Tugallanmagan talablar: ${outstanding.join('; ')}.`);
  return lines.join('\n\n');
}

// Pick the best unused provider:model pair for an agent specialty.
function assignProvider(config, specialty, usedPairs, needVision, suspended) {
  const provs = getAllProviders(config);
  const roster = [];
  for (const [id, def] of Object.entries(provs)) {
    const key = getProviderKey(config, id);
    if (!key && !def.keyless) continue;
    if (!def.base) continue;
    if (!isProviderEnabled(config, id)) continue;
    if (suspended && suspended.has(id)) continue;
    if (!isProviderHealthy(config, id)) continue;
    const models = needVision
      ? [...(def.visionModels || []), ...(def.models || [])]
      : [...(def.models || []), ...(def.visionModels || [])];
    for (const model of models.slice(0, 6)) {
      const strengths = modelStrengths(id, model, def);
      roster.push({ id, model, def, key, strengths, local: !!def.local });
    }
  }
  if (!roster.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const r of roster) {
    let score = 0;
    if (r.strengths.includes(specialty)) score += 5;
    if (r.strengths.includes('general')) score += 1;
    if (needVision && r.strengths.includes('vision')) score += 4;
    const uses = usedPairs.get(`${r.id}::${r.model}`) || 0;
    score -= uses * 6; // strongly prefer spreading across different APIs
    if (r.local) score -= 2; // local models are slow — use as last resort while cloud available
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  usedPairs.set(`${best.id}::${best.model}`, (usedPairs.get(`${best.id}::${best.model}`) || 0) + 1);
  return best;
}

export class TeamRunner extends EventEmitter {
  constructor({ config, workspace, onConfigChange }) {
    super();
    this.config = config;
    this.workspace = workspace;
    this.suspended = new Set(); // providers found dead during this team run (401/402/quota)
    this.activeEngines = new Set();
    this.onConfigChange = onConfigChange || null;
  }

  // "Faqat shu modelni ishlatish" (pinMode): barcha rollar (planner, agentlar,
  // reviewer, fixer, lead) faqat foydalanuvchi tanlagan provayder+model oladi.
  pickAssignment(specialty, usedPairs, needVision) {
    if (this.config.pinMode) {
      const provs = getAllProviders(this.config);
      const def = provs[this.config.provider];
      if (!def || !def.base) return null;
      if (!this._pinnedAssignment) {
        this._pinnedAssignment = { id: this.config.provider, model: this.config.model, def, key: getProviderKey(this.config, this.config.provider) };
      }
      return this._pinnedAssignment;
    }
    return assignProvider(this.config, specialty, usedPairs, needVision, this.suspended);
  }

  markDead(id) {
    this.suspended.add(id);
    if (!this.suspendedPersisted) this.suspendedPersisted = new Set();
    if (!this.suspendedPersisted.has(id)) {
      this.suspendedPersisted.add(id);
      suspendProvider(this.config, id, 1440); // kalit/balans o'lik — 1 kunga tekshirmaymiz
      if (this.onConfigChange) this.onConfigChange().catch(() => {});
    }
  }

  emitEvent(type, data) {
    this.emit('event', { type, ...data });
  }

  async planChainCall(messages, signal) {
    const provs = getAllProviders(this.config);
    const errors = [];
    // "Faqat shu modelni ishlatish" (pinMode): planner ham faqat tanlangan model bilan ishlaydi.
    if (this.config.pinMode) {
      const def = provs[this.config.provider];
      const key = getProviderKey(this.config, this.config.provider);
      if (!def || (!key && !def.keyless) || !def.base) {
        throw new Error(`Pinned model topilmadi: ${this.config.provider} · ${this.config.model}. Sozlamalarda tekshiring.`);
      }
      try {
        // Lokal planner ham cheksiz matn yozmasligi uchun token + matn guard'i.
        const r = await plannerCall({ def, id: this.config.provider, key, model: this.config.model, messages, signal, extraBody: { max_tokens: 1200 }, guardChars: 5000, onNotice: (text) => this.emitEvent('notice', { text }) });
        return r.content;
      } catch (e) {
        throw new Error(`Pinned model ishlamadi: ${this.config.provider} · ${this.config.model} — ${e.message}`);
      }
    }
    // Planner uchun ENG KUCHLI model birinchi: GLM-5.3-Flash (HuggingFace), keyin default, keyin qolganlar.
    const prefer = ['huggingface::zai-org/GLM-5.3-Flash', 'groq::openai/gpt-oss-120b'];
    const ids = Object.keys(provs).sort((a, b) => (a === this.config.provider ? -1 : b === this.config.provider ? 1 : 0));
    ids.sort((a, b) => {
      const ka = prefer.findIndex((p) => p.startsWith(a + '::'));
      const kb = prefer.findIndex((p) => p.startsWith(b + '::'));
      return (ka === -1 ? 99 : ka) - (kb === -1 ? 99 : kb);
    });
    for (const id of ids) {
      const def = provs[id];
      const key = getProviderKey(this.config, id);
      if (!key && !def.keyless) continue;
      if (!def.base) continue;
      if (!isProviderEnabled(this.config, id)) continue;
      if (!isProviderHealthy(this.config, id)) continue;
      // Afzal ko'rilgan provayderda faqat afzal modeldan boshlaymiz
      const models = prefer.some((p) => p.startsWith(id + '::'))
        ? (def.models || []).filter((m) => prefer.includes(`${id}::${m}`)).concat((def.models || []).filter((m) => !prefer.includes(`${id}::${m}`)))
        : (def.models || []).slice(0, 2);
      for (const model of models.slice(0, 2)) {
        if (signal && signal.aborted) throw new Error('To‘xtatildi');
        try {
          const r = await plannerCall({
            def, id, key, model, messages, signal,
            extraBody: { temperature: 0.3, max_tokens: 1200 }, // planner uchun barqaror va qisqa chiqish
            guardChars: def.bundled ? 5000 : undefined, // lokal planner cho'zilib ketmasin
            onNotice: (text) => this.emitEvent('notice', { text }),
          });
          this.emitEvent('quota', { provider: id, providerName: def.name, model, ...(r.quota || {}) });
          return r.content;
        } catch (e) {
          if (/To‘xtatildi|aborted/i.test(e.message)) throw e;
          errors.push(`${def.name}/${model}: ${String(e.message).slice(0, 120)}`);
        }
      }
    }
    throw new Error('Planner modeliga ulanib bo‘lmadi:\n' + errors.join('\n'));
  }

  async plan(task, images, signal) {
    const sys = `Texnik lead (planner) siz. Foydalanuvchi vazifasini agent o'rtasida bo'lib reja tuzasiz.
MUHIM QOIDA: agar vazifa FAQAT ma'lumot topish, tushuntirish, tavsiya berish yoki savolga javob bo'lsa (fayl yaratish talab qilinmasa) — faqat 1 ta "research" yoki "general" agent yarating. Agar foydalanuvchi bir nechta fayl, jamoaviy yoki hamkorlik ishini so'rasa — har agentga alohida fayl berib kamida 2 ta agent tayinlang. Katta kod/loyiha vazifalaridaagina 2-5 agent oching.
Har bir agent UCHUN bo'sh joy (parallel) da ishlaydi va bitta workspace'da turli fayllar ustida ish qiladi — agentlar bir xil faylni tahrirlamasligi kerak.
Har bir agentga specialty belgilang, faqat shulardan: ${SPECIALTIES}.
Faqat JSON qaytaring, izohsiz:
{"agents":[{"name":"qisqa-nom","role":"mutaxassislik nomi","specialty":"coding","task":"aniq vazifa"}]}
 alohida "review" agent QO'SHMA — tekshiruvchi tizim tomonidan avtomatik qo'shiladi.
Har bir agentning "task" maydoni foydalanuvchining ASL so'rovidan chetlamasligi kerak — aniq, o'lchanadigan vazifa yozing.
Har bir agent qaysi faylni yaratishini task ichida aniq ko'rsating (masalan: "index.html faylini yarat") — agentlar bir xil faylga tegmasligi uchun.
Javobingizni FAQAT o'zbek tilida yozing — boshqa tillarni aralashtirmang, koreys/arab/xitoy harflari ISHLATMANG.`;
    const userParts = [{ type: 'text', text: `Vazifa: ${task}\n\nAgentlar jamoasiga bo'lib reja tuz.` }];
    for (const url of images || []) userParts.push({ type: 'image_url', image_url: { url } });
    const text = await this.planChainCall([
      { role: 'system', content: sys },
      { role: 'user', content: userParts },
    ], signal);
    const j = extractJson(text);
    if (j && Array.isArray(j.agents) && j.agents.length) {
      // Nom to'qnashuvi (5-bosqich sinovida topilgan xato): kichik model ikki
      // agentga bir xil nom bergan va natijalar Map'i (nom bo'yicha) bittasini
      // yo'qotardi. Endi dublikat nomga -2/-3 qo'shiladi.
      const used = new Map();
      const agents = j.agents.slice(0, 6).map((a, i) => {
        let name = String(a.name || `Agent-${i + 1}`).slice(0, 30);
        const n = (used.get(name) || 0) + 1;
        used.set(name, n);
        if (n > 1) name = `${name}-${n}`;
        return {
          name,
          role: String(a.role || 'mutaxassis').slice(0, 80),
          specialty: String(a.specialty || 'general').toLowerCase().slice(0, 20),
          task: String(a.task || '').slice(0, 600),
          icon: AGENT_ICONS[i % AGENT_ICONS.length],
        };
      });
      return routeExplicitFileTasks(task, agents);
    }
    // Plan JSON bo'lmasa — vazifa turiga qarab aqlli zaxira: research bo'lsa 1 agent,
    // aks holda coder + reviewer. For a straightforward single-file edit/create,
    // skip the planner and run one coder; this avoids a duplicate full-context prompt.
    const simpleArtifactTask = isSimpleFileTask(task) && !isMultiAgentTask(task);
    if (simpleArtifactTask) {
      return [
        { name: 'Coder', role: 'dasturchi', specialty: 'coding', task, icon: '👨‍💻' },
      ];
    }
    if (/top|topib|tushuntir|ro['']yxat|qidir|reja|nima|qanday|ma['']lumot/i.test(task) && !/yarat|yarating|yoz|kod|fayl/i.test(task)) {
      return routeExplicitFileTasks(task, [
        { name: 'Researcher', role: 'tadqiqotchi', specialty: 'research', task, icon: '🔍' },
      ]);
    }
    return routeExplicitFileTasks(task, [
      { name: 'Coder', role: 'dasturchi', specialty: 'coding', task, icon: '👨‍💻' },
      { name: 'QA', role: 'tester', specialty: 'review', task: 'Natijalarni tekshirib, xatolarni tuzat va yakuniy hisobani yoz', icon: '🧪' },
    ]);
  }

  async runAgent({ name, role, specialty, instructions, task, images, maxSteps, assignment, teamBoard, signal }) {
    const agentConfig = assignment
      ? { ...this.config, provider: assignment.id, model: assignment.model }
      : this.config;
    const engine = new AgentEngine({
      config: agentConfig,
      workspace: this.workspace,
      agentName: name,
      systemExtra: `${role}. ${instructions}${teamBoard ? `\n\n${teamBoard}` : ''}`,
      maxSteps: maxSteps || 16,
    });
    engine.on('event', (evt) => this.emit('event', evt));
    engine.on('approval', (a) => this.emit('approval', a));
    if (assignment) {
      // if the assigned provider is dead (no balance / unauthorized), suspend it for the rest of the run
      engine.on('event', (evt) => {
        if (evt.type === 'notice' && /HTTP 40[123]|Insufficient|quota|credit/i.test(evt.text || '')) {
          this.markDead(assignment.id);
        }
      });
    }
    engine.on('event', (evt) => {
      if (evt.type !== 'tool') return;
      const timelineIndex = this.toolTimeline.length;
      this.toolTimeline.push(evt);
      if (evt.tool === 'run_command') this.commandResults.push({ ...evt, timelineIndex, toolTimeline: this.toolTimeline, reviewRounds: this.reviewRounds || 0 });
    });
    if (signal?.aborted) throw new Error('To‘xtatildi');
    const abortEngine = () => engine.abort();
    signal?.addEventListener('abort', abortEngine, { once: true });
    this.activeEngines.add(engine);
    try {
      const res = await engine.run({ events: [], userText: task, images });
      return res.content || '';
    } finally {
      signal?.removeEventListener('abort', abortEngine);
      this.activeEngines.delete(engine);
    }
  }

  async run({ task, images }) {
    this.ctrl = new AbortController();
    this.commandResults = [];
    this.toolTimeline = [];
    const signal = this.ctrl.signal;
    try {
      // 1. plan
      this.emitEvent('notice', { text: '🧠 Planner vazifani agentlar bo‘yicha taqsimlamoqda…' });
      let agents;
      if (!images?.length && isSimpleFileTask(task) && !isMultiAgentTask(task)) {
        agents = [{ name: 'Coder', role: 'dasturchi', specialty: 'coding', task, icon: '👨‍💻' }];
        this.emitEvent('notice', { text: '⚡ Bitta aniq fayl vazifasi: planner bosqichi o‘tkazildi.' });
      } else {
        agents = await this.plan(task, images, signal);

      }
      this.emitEvent('team_plan', { agents, task, parallel: true });

      // Jamoaviy sinxronlik (1/5-bosqich): har bir agent ishga tushishdan oldin
      // "jamoa doskasi"ni oladi — kim nima qilayotgani va hozirgacha nima tayyor
      // bo'lgani ko'rinadi. Shunda agentlar bir-birini tushunadi, parallel ishda
      // bir xil faylni buzmaydi va tugagan natijadan foydalana oladi.
      const board = agents.map((a) => `- ${a.name} (${a.role}): ${a.task}`).join('\n');

      // 2. capability-based provider assignment (spread agents across APIs)
      const usedPairs = new Map();
      for (const a of agents) {
        a.assignment = this.pickAssignment(a.specialty, usedPairs, a.specialty === 'vision' || /rasm|screenshot|image/i.test(a.task));
        if (a.assignment) {
          this.emitEvent('team_assign', { agent: a.name, provider: a.assignment.def.name, model: a.assignment.model });
        }
      }

      // 3. PARALLEL execution with concurrency limit
      const results = new Map();
      const queue = [...agents];
      const needsResearch = /(?:web_search|fetch_url|internet|qidir|joriy|eng so‘nggi|yangilik|narx|rasmiy hujjat|documentation|latest|current)/i.test(task);
      const simpleAgentPlan = agents.length === 1 && !images?.length && !needsResearch && !isMultiAgentTask(task);
      const hasNamedParallelFiles = explicitFileTargets(task).length > 1;
      const workers = [];
      const worker = async () => {
        while (queue.length) {
          if (signal.aborted) throw new Error('To‘xtatildi');
          const a = queue.shift();
          if (!a) break;
          this.emitEvent('agent_begin', { name: a.name, role: a.role, icon: a.icon, model: a.assignment ? `${a.assignment.def.name} · ${a.assignment.model}` : null });
          let summary = '';
          const doneNotes = [...results.values()].map((r) => `- ${r.name}: ${String(r.summary).slice(0, 400)}`).join('\n');
          const teamBoard = simpleAgentPlan
            ? ''
            : `JAMOA DOSKASI (sinxronlik):\nLoyiha ishlari taqsimoti:\n${board}\n` +
              `Hozirgacha tugagan ishlar:\n${doneNotes || '(hali yo‘q)'}\n` +
              `Qoidalar: (1) yuqoridagi taqsimotga qarab faqat O‘ZINGGA tegishli fayllar ustida ishla; ` +
              `(2) boshqa agent yozgan faylni o‘zgartirmang; (3) kerak bo‘lsa doskadagi tugagan natijadan foydalan.`;
          try {
            summary = await this.runAgent({
              name: a.name,
              role: a.role,
              specialty: a.specialty,
              teamBoard,
              instructions: `Sen jamoaning bir a'zosisisan. Faqat o'z vazifangdagi fayllarga teg, boshqa agentlarning fayllarini buzma. Vazifa tugaganda qisqacha hisobot ber.${hasNamedParallelFiles ? '\nBir nechta fayl parallel yozilmoqda: sening bosqichingda run_command/build/test bajarma; barcha coder-agentlar tugagach, Reviewer butun workspace’ni tekshiradi va testni o‘zi bajaradi.' : ''}
MUHIM: kutubxona/API yoki o'zgaruvchan ma'lumot kerak bo'lsa web_search va fetch_url tool'laridan foydalanib rasmiy manbani tekshiring. Uydirma havola/manba yozmang; topilmasa buni ochiq ayting.`,
              task: simpleAgentPlan ? task : `Umumiy loyiha: ${task}\n\nSening vazifang (${a.role}): ${a.task}`,
              images: a.specialty === 'vision' ? images : null,
              assignment: a.assignment,
              signal,
            });
          } catch (e) {
            if (/To‘xtatildi/.test(e.message)) throw e;
            summary = `(agent xatosi: ${e.message})`;
            this.emitEvent('notice', { text: `⚠ ${a.name}: ${e.message}` });
          }
          results.set(a.name, { name: a.name, summary });
          this.emitEvent('agent_end', { name: a.name, role: a.role, icon: a.icon, summary: String(summary).slice(0, 900) });
        }
      };
      for (let i = 0; i < Math.min(CONCURRENCY, agents.length); i++) workers.push(worker());
      await Promise.all(workers);

      const resultList = agents.map((a) => results.get(a.name)).filter(Boolean);
      const initialAudit = auditRequestedArtifacts(task, this.workspace);
      const initialOutstanding = outstandingArtifactRequirements(task, initialAudit, this.commandResults, this.workspace);
      const simpleSingleAgent = simpleAgentPlan && initialOutstanding.length === 0;
      this.reviewRounds = 0;
      if (initialAudit.length) this.emitEvent('team_audit', { artifacts: initialAudit, outstanding: initialOutstanding });

      // For a single-agent plan, skip a second generative pass only when the
      // requested outputs and any requested execution are already verified.
      // artifact already exists. The UI/API consumer still receives the Lead result;
      // complex parallel plans retain independent review and repair.
      if (simpleSingleAgent) this.emitEvent('notice', { text: '✓ Bitta agentli vazifa: reviewer/fixer aylanasini o‘tkazib, natijani yakunlayman.' });

      // 4. review + fix loop (max 2 rounds, sequential)
      for (let round = 0; !simpleSingleAgent && round < 2; round++) {
        if (signal.aborted) throw new Error('To‘xtatildi');
        this.reviewRounds = round + 1;
        const reviewAssignment = this.pickAssignment('review', usedPairs, false);
        this.emitEvent('agent_begin', { name: 'Reviewer', role: 'sifat nazorati', icon: '🔍', model: reviewAssignment ? `${reviewAssignment.def.name} · ${reviewAssignment.model}` : null });
        let review = '';
        try {
          review = await this.runAgent({
            name: 'Reviewer',
            role: 'qat‘iy senior reviewer',
            instructions: `Workspace fayllarini list_dir/read_file bilan mustaqil tekshiring. Foydalanuvchi run/test/build/verify so‘ragan bo‘lsa, barcha coder-agentlar tugaganidan keyin run_command bilan so‘ralgan tekshiruvni bajaring va natijani o‘qing. Barcha fayl talablari bajarilgan va tekshiruv muvaffaqiyatli bo‘lgandagina javob oxirida aynan REVIEW_OK yozing. Yetishmovchilik, test xatosi yoki tasdiqlay olmaslik bo‘lsa REVIEW_FIX va aniq sabab yozing.`,
            task: `Loyiha: ${task}\nAgentlar bajardi:\n${resultList.map((r) => `- ${r.name}: ${String(r.summary).slice(0, 500)}`).join('\n')}\n\nBarcha coder-agentlar tugadi. Endi yakuniy fayllarni tekshiring va so‘ralgan test/buyruqni bajarib natijani tasdiqlang.`,
            assignment: reviewAssignment,
            signal,
          });
        } catch (e) {
          if (/To‘xtatildi/.test(e.message)) throw e;
          review = `REVIEW_FIX: reviewer tekshiruvi xato bilan tugadi: ${String(e.message).slice(0, 500)}`;
        }
        const reviewAudit = auditRequestedArtifacts(task, this.workspace);
        const reviewOutstanding = outstandingArtifactRequirements(task, reviewAudit, this.commandResults, this.workspace);
        if (reviewAudit.length) this.emitEvent('team_audit', { stage: 'review', artifacts: reviewAudit, outstanding: reviewOutstanding });
        if (/REVIEW_OK/.test(review) && reviewOutstanding.length) {
          review = `REVIEW_FIX: mustaqil workspace/ijro auditi bajarilmagan talablarni topdi: ${reviewOutstanding.join('; ')}.`;
        }
        this.emitEvent('agent_end', { name: 'Reviewer', role: 'sifat nazorati', icon: '🔍', summary: String(review).slice(0, 900) });
        if (/REVIEW_OK/.test(review)) break;
        if (signal.aborted) throw new Error('To‘xtatildi');
        const fixAssignment = this.pickAssignment('coding', usedPairs, false);
        this.emitEvent('agent_begin', { name: 'Fixer', role: 'tuzatuvchi', icon: '🛠️', model: fixAssignment ? `${fixAssignment.def.name} · ${fixAssignment.model}` : null });
        try {
          const fix = await this.runAgent({
            name: 'Fixer',
            role: 'tuzatuvchi dasturchi',
            instructions: `Reviewer izohlaridagi kamchiliklarni to'liq tuzating va tekshirib tasdiqlang.`,
            task: `Loyiha: ${task}\nReviewer izohlari:\n${String(review).slice(0, 2500)}\n\nAniq yetishmayotgan talablar:\n${reviewOutstanding.map((item) => `- ${item}`).join('\n') || '- Reviewer qayd etgan kamchiliklarni tuzating'}\n\nMavjud ishni buzmasdan yetishmayotgan fayllarni yarating; agar run_command so‘ralgan bo‘lsa buyruqni ishga tushiring va xatoni tuzating.`,
            assignment: fixAssignment,
            signal,
          });
          resultList.push({ name: 'Fixer', summary: fix });
          this.emitEvent('agent_end', { name: 'Fixer', role: 'tuzatuvchi', icon: '🛠️', summary: String(fix).slice(0, 900) });
        } catch (e) {
          if (/To‘xtatildi/.test(e.message)) throw e;
          this.emitEvent('notice', { text: `⚠ Fixer: ${e.message}` });
        }
      }

      // Ko‘p-faylli kod ishida generativ Lead mavjud artifact/ijro holatini inkor
      // qilib qo‘yishi mumkin. Yakuniy holatni real disk va tool natijalaridan tuzamiz.
      const finalAudit = auditRequestedArtifacts(task, this.workspace);
      const finalOutstanding = outstandingArtifactRequirements(task, finalAudit, this.commandResults, this.workspace);
      if (finalAudit.length) this.emitEvent('team_audit', { stage: 'final', artifacts: finalAudit, outstanding: finalOutstanding });
      if (finalAudit.length) {
        const summary = summarizeArtifactOutcome(task, finalAudit, this.commandResults, finalOutstanding, this.workspace);
        this.emitEvent('team_done', { summary, audit: finalAudit, complete: finalOutstanding.length === 0 });
        return { content: summary };
      }

      // 5. lead summary
      // Single-agent plans already have one user-facing completion summary; pass it
      // through rather than spending another slow local-model generation.
      const simpleSummary = simpleSingleAgent ? resultList.map((r) => String(r.summary || '').trim()).filter(Boolean).join('\n\n') : '';
      if (simpleSummary) {
        this.emitEvent('team_done', { summary: simpleSummary });
        return { content: simpleSummary };
      }
      const leadAssignment = this.pickAssignment('general', usedPairs, false);
      const lead = new AgentEngine({
        config: leadAssignment ? { ...this.config, provider: leadAssignment.id, model: leadAssignment.model } : this.config,
        workspace: this.workspace, agentName: 'Lead',
        systemExtra: `Sen jamoa rahbari (yakuniy AI)san. Barcha agentlarning natijalari senga yig'ib beriladi —
foydalanuvchiga YAKUNIY va TO'LIQ javobni FAQAT SEN yozasan (oraliq agentlar javobi chatda ko'rsatilmaydi,
ular faoliyat panelida qoladi). Shu sababli javob boshqa birovning xulosasiga tayanmasin — o'zing to'liq yoz.
MUHIM: javobingiz TO'G'RIDAN-TO'G'RI foydalanuvchining asl savoliga javob bo'lishi shart.
Agentlar natijalarini birlashtir: nima yaratildi, qaysi fayl yo'lida, qanday ishga tushiriladi — hammasi bitta yaxlit javobda.
Agar savol "eng yaxshisini top/topib ber" turida bo'lsa — aniq ro'yxat ber: har biri nomi, nima uchun yaxshi, havolasi.
Mavzudan chetlanmang, agentlar ichki ishlarini tushuntirmang, faqat foydalanuvchi so'ragan narsani bering.`,
        maxSteps: 3,
        translateOutput: true, // Lead xulosasi foydalanuvchiga ko'rinadi — tarjimon orqali o'zbekchalashadi
      });
      lead.on('event', (evt) => {
        this.emit('event', evt);
        if (evt.type === 'tool') {
          const timelineIndex = this.toolTimeline.length;
          this.toolTimeline.push(evt);
          if (evt.tool === 'run_command') this.commandResults.push({ ...evt, timelineIndex, toolTimeline: this.toolTimeline, reviewRounds: this.reviewRounds || 0 });
        }
      });
      if (signal.aborted) throw new Error('To‘xtatildi');
      const abortLead = () => lead.abort();
      signal.addEventListener('abort', abortLead, { once: true });
      this.activeEngines.add(lead);
      try {
        const summary = await lead.run({
          events: [],
          userText: `Loyiha: ${task}\n\nJamoa ishi tugadi. Natijalar:\n${resultList.map((r) => `- ${r.name}: ${String(r.summary).slice(0, 600)}`).join('\n')}\n\nFoydalanuvchiga yakuniy xulosani yozing: nima yaratildi, qayerda, qanday ishga tushiriladi.`,
        });
        this.emitEvent('team_done', { summary: summary.content });
        return { content: summary.content };
      } finally {
        signal.removeEventListener('abort', abortLead);
        this.activeEngines.delete(lead);
      }
    } finally {
      // noop
    }
  }

  abort() {
    if (this.ctrl) this.ctrl.abort(new Error('To‘xtatildi'));
    for (const engine of this.activeEngines) engine.abort();
  }
}
