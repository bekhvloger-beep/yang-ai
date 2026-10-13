// v3.9.3 testlari: kalitsiz zanjir (localmini -> kilo -> pollinations), pin rejim va lokal+tarjima.
// Ishlatish:
//   node agent/test_v393_chain.mjs chain   # lokal server YO'Q: zanjir Kilo'ga o'tishi kerak
//   node agent/test_v393_chain.mjs local   # lokal server + tarjimon ISHLAYAPTI: tarjima zanjiri
//   node agent/test_v393_chain.mjs pin     # pin ON: faqat tanlangan model, zaxiraga o'tilmaydi
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const MODE = process.argv[2] || 'chain';
const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), `v393-${MODE}-`));
console.log(`=== TEST MODE: ${MODE} | workspace: ${workspace} ===`);

const { AgentEngine } = await import('./engine.js');

const baseTranslate = { enabled: true, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' };
const run = async (label, config, userText, expect = {}) => {
  const engine = new AgentEngine({ config, workspace, translateOutput: true, translateInput: true, maxSteps: 3 });
  engine.on('approval', (a) => a.respond(true));
  const events = [];
  const notices = [];
  engine.on('event', (e) => {
    events.push(e);
    if (e.type === 'notice') {
      notices.push(String(e.text));
      console.log(`  [notice] ${e.text}`);
    }
    if (e.type === 'provider_used') console.log(`  [provider_used] ${e.provider} · ${e.model}`);
    if (e.type === 'error') console.log(`  [error] ${e.message}`);
  });
  let result = null;
  let error = null;
  try {
    result = await engine.run({ events: [], userText });
  } catch (e) {
    error = e;
    console.log(`  [run failed] ${String(e.message).split('\n')[0]}`);
  }
  const used = events.filter((e) => e.type === 'provider_used');
  const text = (result && result.content) || '';
  console.log(`--- ${label} ---`);
  console.log('  providers used:', used.map((u) => `${u.provider} · ${u.model}`).join(' | ') || 'NONE');
  console.log('  answer (first 220):', text.slice(0, 220).replace(/\n/g, ' '));
  const checks = [];
  if (expect.providerIncludes) checks.push(['provider is ' + expect.providerIncludes, used.some((u) => u.provider.includes(expect.providerIncludes))]);
  if (expect.noFallback) checks.push(['zaxiraga o\'tilmadi (1 ta urinish)', used.length <= 1]);
  if (expect.answerNonEmpty) checks.push(['javob bo\'sh emas', text.trim().length > 0]);
  if (expect.failExpected) checks.push(['kutilgan xato berdi', !!error && /ishlamadi|topilmadi/i.test(error.message)]);
  if (expect.uzbekAnswer) checks.push(['o\'zbekcha javob', /[a-zA-Zʻʼ‘’]{4,}/.test(text) && /\b(men|siz|bu|va|uchun|bilan|javob|yaxshi|salom)\b/i.test(text)]);
  // Notis haqiqatga mosligi: "Lokal model: …" faqat lokal provayder javob berganda chiqadi.
  if (expect.noLocalNotice) checks.push(['lokal javob yo\'q → "Lokal model" notisi YO\'Q', !notices.some((n) => /Lokal model:/.test(n))]);
  if (expect.localNotice) checks.push(['lokal javob → "Lokal model" notisi BOR', notices.some((n) => /Lokal model:/.test(n))]);
  if (expect.localNoticeMatchesProvider) {
    const localAnswered = used.some((u) => u.provider.includes('Lokal'));
    const noticeSaysLocal = notices.some((n) => /Lokal model:/.test(n));
    checks.push(['notis ↔ provider_used mos', localAnswered === noticeSaysLocal]);
  }
  for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}`);
  return { events, text, error, ok: checks.every(([, ok]) => ok) };
};

const base = {
  keys: {},
  customProviders: [],
  autoApprove: true,
  providerHealth: {},
  disabledProviders: [],
  pinMode: false,
  customBaseUrl: '',
};

let allOk = true;
if (MODE === 'en') {
  // (a) inglizcha savol — tarjimasiz, to'g'ridan-to'g'ri lokal 4B modelga.
  const r = await run(
    'lokal: inglizcha savol (tarjimasiz)',
    { ...base, provider: 'localmini', model: 'qwen3-instruct', translate: { ...baseTranslate, enabled: false } },
    'In one short sentence: what are you and what can you do?',
    { providerIncludes: 'Lokal', answerNonEmpty: true, localNotice: true, localNoticeMatchesProvider: true },
  );
  allOk = r.ok;
} else if (MODE === 'kilo') {
  // Kilo kalitsiz gateway — o'zbekcha suhbat.
  const r = await run(
    'kilo: o‘zbekcha suhbat',
    { ...base, provider: 'kilo', model: 'kilo-auto/free', translate: { ...baseTranslate, enabled: false } },
    'Assalomu alaykum! O‘zbek tilida qisqa javob ber: sen qaysi model va nimalarni qila olasan?',
    { providerIncludes: 'Kilo', answerNonEmpty: true, uzbekAnswer: true },
  );
  allOk = r.ok;
} else if (MODE === 'chain') {
  // Lokal server ataylab o'chiq (8082), tarjima o'chirilgan: zanjir Kilo'ga o'tishi shart.
  const r1 = await run(
    'zanjir: localmini (o\'chiq) -> kilo',
    { ...base, provider: 'localmini', model: 'qwen3-instruct', translate: { ...baseTranslate, enabled: false } },
    'Salom! O‘zbek tilida qisqa javob ber: sen qaysi modelsan va nima qila olasan?',
    { providerIncludes: 'Kilo', answerNonEmpty: true, uzbekAnswer: true, noLocalNotice: true, localNoticeMatchesProvider: true },
  );
  allOk = allOk && r1.ok;
} else if (MODE === 'local') {
  const r1 = await run(
    'lokal + tarjima',
    { ...base, provider: 'localmini', model: 'qwen3-instruct', translate: baseTranslate },
    'O‘zbek tilida ikki gap bilan javob ber: sen qaysi modelsan va qanday vazifalarni bajarasan?',
    { providerIncludes: 'Lokal', answerNonEmpty: true, localNotice: true, localNoticeMatchesProvider: true },
  );
  allOk = allOk && r1.ok;
} else if (MODE === 'tools') {
  // Lokal 4B model tool chaqira oladimi (3 ta qisqartirilgan tool bilan).
  const engine = new AgentEngine({
    config: { ...base, provider: 'localmini', model: 'qwen3-instruct', translate: { ...baseTranslate, enabled: false } },
    workspace,
    translateOutput: true,
    translateInput: false,
    maxSteps: 6,
  });
  engine.on('approval', (a) => a.respond(true));
  const events = [];
  const notices = [];
  engine.on('event', (e) => {
    events.push(e);
    if (e.type === 'notice') {
      notices.push(String(e.text));
      console.log(`  [notice] ${e.text}`);
    }
    if (e.type === 'provider_used') console.log(`  [provider_used] ${e.provider} · ${e.model}`);
    if (e.type === 'tool') console.log(`  [tool] ${e.tool} -> ${String(e.result).slice(0, 70).replace(/\n/g, ' ')}`);
    if (e.type === 'error') console.log(`  [error] ${e.message}`);
  });
  let result = null;
  let error = null;
  try {
    result = await engine.run({ events: [], userText: 'Create a file named smoke_v393.txt with the single line LOCAL_TOOL_OK using your write_file tool, then read it back and confirm. End your reply with LOCAL_TOOL_OK.' });
  } catch (e) {
    error = e;
    console.log('  [run failed]', String(e.message).split('\n')[0]);
  }
  const toolCalls = events.filter((e) => e.type === 'tool');
  const content = (result && result.content) || '';
  let fileText = '';
  try {
    fileText = await fsp.readFile(path.join(workspace, 'smoke_v393.txt'), 'utf8');
  } catch {}
  console.log('--- lokal tool testi ---');
  console.log('  tool calls:', toolCalls.map((t) => t.tool).join(', ') || 'NONE');
  console.log('  file content:', JSON.stringify(fileText.slice(0, 80)));
  console.log('  answer (first 160):', content.slice(0, 160).replace(/\n/g, ' '));
  const checks = [
    ['write_file chaqirildi', toolCalls.some((t) => t.tool === 'write_file')],
    ['fayl yaratildi va LOCAL_TOOL_OK yozildi', fileText.includes('LOCAL_TOOL_OK')],
    ['xato yo\'q', !error],
  ];
  for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}`);
  allOk = checks.every(([, ok]) => ok);
} else if (MODE === 'pin') {
  // A) pin + kilo: faqat kilo ishlatiladi.
  const rA = await run(
    'pin ON: kilo',
    { ...base, provider: 'kilo', model: 'kilo-auto/free', pinMode: true, translate: { ...baseTranslate, enabled: false } },
    'Bir gap bilan javob ber: 2+2 nechchi?',
    { providerIncludes: 'Kilo', noFallback: true, answerNonEmpty: true, noLocalNotice: true, localNoticeMatchesProvider: true },
  );
  // B) pin + javob bermaydigan provayder: zaxiraga o'tmasdan aniq xato berishi kerak.
  // Jonli o'lik port ishlatiladi — test lokal server yoqilgan/o'chirilganiga bog'liq bo'lmasin.
  const rB = await run(
    'pin ON: o\'lik port (javob yo\'q) — zaxira TAQIQLANGAN',
    {
      ...base,
      provider: 'deadoffline',
      model: 'dead-model',
      pinMode: true,
      keys: { deadoffline: 'dummy' },
      customProviders: [{ id: 'deadoffline', name: 'Oflayn test', base: 'http://127.0.0.1:8099/v1', models: ['dead-model'], key: 'dummy' }],
      translate: { ...baseTranslate, enabled: false },
    },
    'Salom, javob ber.',
    { failExpected: true, noFallback: true, noLocalNotice: true, localNoticeMatchesProvider: true },
  );
  allOk = allOk && rA.ok && rB.ok;
} else {
  console.log('Noma’lum rejim:', MODE);
  process.exit(2);
}

console.log(allOk ? `\n=== ${MODE.toUpperCase()} TEST: PASS ===` : `\n=== ${MODE.toUpperCase()} TEST: FAIL (yuqoriga qara) ===`);
process.exit(allOk ? 0 : 1);
