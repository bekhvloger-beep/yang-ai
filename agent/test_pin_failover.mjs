// Pin rejim ("Faqat shu modelni ishlatish") zaxira bloklanishini tekshiradi.
// Real engine (agent/engine.js) ishlatiladi. Shart: lokal server (127.0.0.1:8082) O'CHIQ bo'lishi kerak.
//   node agent/test_pin_failover.mjs
// Kutilgan xatti-harakat:
//   pinMode=true  → zanjirda faqat pin qilingan juftlik; lokal model javob bermasa zaxiraga O'TILMAYDI,
//                   aniq pin-notislari + "Barcha provayderlar ishlamadi" xatosi.
//   pinMode=false → zanjirda zaxira provayderlar bor; birinchi juftlik yiqilganda "boshqa modelga o'taman" notisi.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentEngine } from './engine.js';
import { localServerUp } from './providers.js';

const results = [];
const check = (name, ok, evidence) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};

const base = {
  provider: 'localmini',
  model: 'qwen3-instruct',
  keys: {},
  customProviders: [],
  autoApprove: true,
  providerHealth: {},
  disabledProviders: [],
  translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
};

const cfgOn = { ...base, pinMode: true };
const cfgOff = { ...base, pinMode: false };

if (await localServerUp(cfgOn)) {
  console.log('SKIP: lokal server (8082) ishlayapti. Test sovuq holat talab qiladi — llama-server ni to‘xtatib, qayta urinib ko‘ring.');
  process.exit(2);
}
check('0. Sovuq holat: lokal server javob bermayapti', true, 'GET http://127.0.0.1:8082/v1/models → ECONNREFUSED');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-failover-'));
const t0 = Date.now();

// ---- A: pinMode = true → zaxira YO'Q ----
const engineOn = new AgentEngine({ config: cfgOn, workspace, translateOutput: false, translateInput: false });
const noticesOn = [];
let usedOn = null;
// AgentEngine.emit() hamma hodisani yagona 'event' kanaliga o'tkazadi (main.js ham shuni tinglaydi).
engineOn.on('event', (e) => {
  if (e.type === 'notice') noticesOn.push(e.text);
  if (e.type === 'provider_used') usedOn = e.provider;
});

const chainOn = engineOn.buildChain(false);
check(
  'A1. pinMode=true → zanjirda faqat pin qilingan model',
  chainOn.length === 1 && chainOn[0].id === 'localmini' && chainOn[0].model === cfgOn.model,
  `buildChain → ${chainOn.length} juftlik [${chainOn.map((p) => p.id + '::' + p.model).join(', ')}]`,
);

let errOn = null;
try {
  await engineOn.run({ events: [], userText: 'Salom' });
} catch (e) {
  errOn = e;
}
const runOnMs = Date.now() - t0;
const pinNotice1 = noticesOn.some((t) => /pin rejim yoqilgani uchun zaxiraga/.test(t));
const pinNotice2 = noticesOn.some((t) => /javob bermadi \(pin rejim/.test(t));
check('A2. Lokal model ishlamasa pin rejim zaxiraga o‘tmaydi (notislar)', pinNotice1 && pinNotice2,
  `notislar: ${JSON.stringify(noticesOn)}`);
check(
  'A3. Run aniq xato bilan tugadi va zaxira provayder sinab ko‘rilmadi',
  !!errOn && /Barcha provayderlar ishlamadi/.test(errOn.message || '') && !/Kilo|Pollinations/.test(errOn.message || '') && usedOn === null,
  `xato: ${JSON.stringify(String(errOn && errOn.message).replace(/\n/g, ' | ').slice(0, 160))} · provider_used=${usedOn} · ${runOnMs} ms`,
);

// ---- B: pinMode = false → zaxira ishlaydi ----
const engineOff = new AgentEngine({ config: cfgOff, workspace, translateOutput: false, translateInput: false });
const noticesOff = [];
let usedOff = null;
const chainOff = engineOff.buildChain(false);
check(
  'B1. pinMode=false → zanjirda zaxira provayderlar bor',
  chainOff.length > 1 && chainOff[0].id === 'localmini' && chainOff.some((p) => p.id !== 'localmini'),
  `buildChain → ${chainOff.length} juftlik [${chainOff.map((p) => p.id + '::' + p.model).join(', ')}]`,
);

// Zaxira provayderga o'tish notisi chiqishi bilan runni to'xtatamiz (tarmoq kutmasligi uchun).
engineOff.on('event', (e) => {
  if (e.type === 'notice') {
    noticesOff.push(e.text);
    if (/boshqa modelga/.test(e.text)) setTimeout(() => engineOff.abort(), 0);
  }
  if (e.type === 'provider_used') usedOff = e.provider;
});
const t1 = Date.now();
try {
  await engineOff.run({ events: [], userText: 'Salom' });
} catch { /* abort/to'xtatish kutilgan */ }
const switchNotice = noticesOff.some((t) => /boshqa modelga/.test(t));
const readyNoticeOff = noticesOff.some((t) => /zaxira provayderga/.test(t));
check('B2. Tayyorlik bloki pin OFF rejimida zaxiraga o‘tishni e’lon qiladi', readyNoticeOff,
  `notislar: ${JSON.stringify(noticesOff)}`);
check(
  'B3. Birinchi juftlik yiqilganda «boshqa modelga o‘taman» notisi chiqdi (zaxiraga o‘tish boshlandi)',
  switchNotice && usedOff !== 'Lokal AI (offline)',
  `switch notisi=${switchNotice} · provider_used=${usedOff} · ${Date.now() - t1} ms`,
);

try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS (${Date.now() - t0} ms)`);
process.exit(failed ? 1 : 0);
