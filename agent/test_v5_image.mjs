// YANG AI v4 — 5-bosqich: rasm yaratish funksiyasi sinovi.
//   node agent/test_v5_image.mjs
// A. create_image (offline, model kerak emas) — haqiqiy PNG.
// B. Lokal model «rasm yarating» so'rovini create_image bilan bajaradi (kengaytirilgan lokal tool).
// C. generate_image (haqiqiy AI rasm) — foydalanuvchi kaliti bo'lsa (gemini/openai/openrouter).
// Shart: 127.0.0.1:8082 bo'sh (skript llama-server'ni o'zi ko'taradi va oxirida to'xtatadi).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentEngine } from './engine.js';
import { createToolContext } from './tools.js';
import { generateImage } from './imagegen.js';
import { localServerUp } from './providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, evidence) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`); };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function pngInfo(file) {
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || !buf.subarray(0, 4).equals(PNG_SIG)) {
    return { size: buf.length, png: false };
  }
  return { size: buf.length, png: true, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Foydalanuvchi kalitlari (qiymat hech qachon chop etilmaydi).
let userKeys = {};
try {
  const j = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'yang-ai', 'config.json'), 'utf8'));
  userKeys = j.keys || {};
} catch {}

const config = {
  provider: 'localmini', model: 'qwen3-instruct', keys: userKeys, customProviders: [],
  autoApprove: true, providerHealth: {}, disabledProviders: [], pinMode: true,
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-v5-image-'));
console.log(`workspace: ${workspace}\n`);

// ---------- A. Offline create_image ----------
try {
  const ctx = createToolContext({ workspace, config, registerChild: () => {} });
  const out = await ctx.execute('create_image', {
    path: 'offline.png', width: 240, height: 160, background: '#ffffff',
    ops: [{ op: 'rect', x: 20, y: 20, w: 100, h: 60, color: '#ff0000', fill: true }, { op: 'circle', cx: 170, cy: 80, r: 30, color: '#0000ff', fill: true }],
  });
  const info = pngInfo(path.join(workspace, 'offline.png'));
  check('A1. 🖼 create_image offline haqiqiy PNG yaratadi (model kerak emas)', !!info && info.png && info.w === 240 && info.h === 160,
    `${out} · ${JSON.stringify(info)}`);
} catch (e) {
  check('A. create_image offline', false, 'xato: ' + e.message);
}

// ---------- Lokal serverni ko'tarish (B uchun) ----------
if (await localServerUp(config)) {
  console.log('SKIP: 127.0.0.1:8082 band — B qismi sovuq holat talab qiladi.');
  process.exit(2);
}
const serverLog = path.join(os.tmpdir(), 'yang-v5-image-llama.log');
const logFd = fs.openSync(serverLog, 'w');
const server = spawn(path.join(ROOT, 'local-ai', 'lc', 'llama-server.exe'),
  ['-m', 'model-1.7b.gguf', '--host', '127.0.0.1', '--port', '8082', '-c', '8192', '--reasoning', 'off', '--no-webui'],
  { cwd: path.join(ROOT, 'local-ai'), detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
server.unref();
let ready = false;
for (let i = 0; i < 90; i++) {
  try { const r = await fetch('http://127.0.0.1:8082/v1/models', { signal: AbortSignal.timeout(2000) }); if (r.ok) { ready = true; break; } } catch {}
  await sleep(1000);
}
console.log(`lokal server tayyor: ${ready} · jurnal: ${serverLog}\n`);

try {
  if (!ready) throw new Error('lokal server ko‘tarilmadi');
  // ---------- B. Lokal model rasm so'rovini bajaradi ----------
  const ev = [];
  const engine = new AgentEngine({ config, workspace, translateOutput: false, translateInput: false, maxSteps: 6 });
  engine.on('event', (e) => ev.push(e));
  const t0 = Date.now();
  const timeout = new Promise((_, rej) => { setTimeout(() => { try { engine.abort(); } catch {} rej(new Error('timeout (8 daqiqa)')); }, 480000); });
  await Promise.race([
    engine.run({ events: [], userText: 'Rasm yarating (200x200) va bayroq.png fayliga saqlang: uchta gorizontal chiziq — ko‘k, oq, yashil.' }),
    timeout,
  ]);
  const tools = ev.filter((e) => e.type === 'tool_start').map((e) => e.tool);
  const info = pngInfo(path.join(workspace, 'bayroq.png'));
  const created = ev.filter((e) => e.type === 'files_created').flatMap((e) => e.paths || []);
  const imgCall = ev.find((e) => e.type === 'tool_start' && e.tool === 'create_image');
  const opsN = (imgCall && imgCall.args && Array.isArray(imgCall.args.ops) && imgCall.args.ops.length) || 0;
  const wrote = ev.filter((e) => e.type === 'tool' && e.tool === 'create_image').map((e) => String(e.result || ''))[0] || '';
  check('B1. 🤖 Lokal model create_image chaqirib so‘ralgan o‘lchamda PNG yaratadi',
    !!info && info.png && info.w === 200 && info.h === 200 && info.size > 100 && tools.includes('create_image'),
    `tool'lar=[${tools.join(', ')}] · ${opsN} amal · ${JSON.stringify(info)} · "${wrote.slice(0, 60)}" · ${Math.round((Date.now() - t0) / 1000)} s`);
  check('B2. 📄 files_created hodisasi rasm yo‘lini beradi (UI preview uchun)', created.some((p) => /bayroq\.png/.test(p)),
    `files_created=[${created.join(', ')}]`);
} catch (e) {
  check('B. Lokal model bilan rasm', false, `xato: ${e && e.message}`);
}

// ---------- C. AI rasm (haqiqiy kalit bo'lsa) ----------
const hasKey = !!(userKeys.gemini || userKeys.openai || userKeys.openrouter || userKeys.vercel);
if (!hasKey) {
  console.log('SKIP C. generate_image — AI rasm kaliti topilmadi (gemini/openai/openrouter).');
} else {
  try {
    // ---------- C0. Zanjirni to'g'ridan-to'g'ri sinash (agent ishtirokisiz) ----------
    // Gemini → OpenAI → OpenRouter → Vercel zanjiri haqiqiy rasm qaytaradimi?
    let direct = null;
    let directErr = '';
    try {
      direct = await generateImage({
        prompt: 'A red apple on a white background, simple flat illustration',
        config,
        signal: AbortSignal.timeout(150000),
      });
    } catch (e) {
      directErr = e && e.message;
    }
    // Kvota/limit tugagan bo'lsa — bu kod xatosi emas, hisob holati: SKIP (sababi bilan).
    const quotaSkip = !direct && /429|quota|exceeded|credit|Insufficient|rate limit/i.test(String(directErr));
    if (quotaSkip) {
      console.log(`SKIP C. AI rasm (generate_image) — provayder kvotasi/limit tugagan:\n      → ${String(directErr).slice(0, 200).replace(/\n/g, ' ')}`);
    } else {
      const b = direct && direct.buffer;
      const isPng = !!b && b.subarray(0, 4).equals(PNG_SIG);
      const isJpg = !!b && b[0] === 0xff && b[1] === 0xd8;
      const dw = isPng ? b.readUInt32BE(16) : 0;
      const dh = isPng ? b.readUInt32BE(20) : 0;
      check('C0. 🔌 AI rasm zanjiri to‘g‘ridan-to‘g‘ri ishlaydi (generateImage)',
        !!b && (isPng || isJpg) && b.length > 500 && (!isPng || (dw >= 256 && dh >= 256)),
        b ? `${b.length} B · via=${direct.via} · png=${isPng} ${dw}x${dh}${isJpg ? ' jpg' : ''}` : `xato: ${String(directErr).slice(0, 140)}`);

      // ---------- C1. Agent tool orqali (generate_image) ----------
      const ev = [];
      const engine = new AgentEngine({ config: { ...config, provider: 'gemini', model: 'models/gemini-3.5-flash' }, workspace, translateOutput: false, translateInput: false, maxSteps: 4 });
      engine.on('event', (e) => ev.push(e));
      const t0 = Date.now();
      const timeout = new Promise((_, rej) => { setTimeout(() => { try { engine.abort(); } catch {} rej(new Error('timeout (3 daqiqa)')); }, 180000); });
      await Promise.race([
        engine.run({ events: [], userText: 'generate_image (AI rasm) tool’ini ishlating — create_image EMAS. Olma rasmini yarating va olma.png fayliga saqlang. Prompt inglizcha yozing.' }),
        timeout,
      ]);
      const tools = ev.filter((e) => e.type === 'tool_start').map((e) => e.tool);
      const info = pngInfo(path.join(workspace, 'olma.png'));
      const jpgOk = fs.existsSync(path.join(workspace, 'olma.png')) && !info?.png && info?.size > 500;
      check('C1. 🎨 Agent generate_image tool’i bilan haqiqiy rasm yaratadi',
        tools.includes('generate_image') && ((info?.png && info.w >= 256 && info.h >= 256) || jpgOk),
        `${info ? `${info.size} B · ${info.png ? `${info.w}x${info.h}` : 'png emas'}` : 'fayl yo‘q'} · tools=[${tools.join(', ')}] · ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  } catch (e) {
    check('C. AI generate_image', false, `xato: ${e && e.message}`);
  }
}

function done() {
  spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}

done();
