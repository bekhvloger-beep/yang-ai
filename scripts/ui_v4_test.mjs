// YANG AI v4 — UI sinovi (2/3/4-bosqichlar): real renderer + CDP.
//   node scripts/ui_v4_test.mjs
// Tekshiradi:
//   1. Ilova ochiladi, renderer xatosiz yuklanadi (Runtime.exceptionThrown/konsol xatolari).
//   2. Premium karkas: hexagon logo, tepada agent + aylana limit, pastda model/team bar.
//   3. O'ng faoliyat paneli: yig'iladi/ochiladi (dockToggle) va Interfeys sozlamasi bilan boshqariladi.
//   4. Sozlamalar bo'limlari (provayder/model/tarjima/interfeys/tizim) — tab almashinuvi ishlaydi,
//      #pinModelToggle va #settingsSave joyida (ui_pin_test.mjs bilan moslik).
//   5. Pastdagi model chipi tanlash popup'i.
//   6. Faoliyat oqimi kartalari: 💭 thinking, 📖/🌐/🐍 kartalar, mini brauzer, 📋 reja + «Qurishni boshlash».
//   7. Ikonka ustiga bosilganda to'liq tafsilot (So'rov/Natija/Fayl).
//   8. Tepadagi agent nomi+ikonkasi va aylana limit progressi.
//   9. Skrinshotlar: _shots/ui_*.png
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.YANG_CDP_PORT || 9444);
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-v4-ui-'));
const SHOTS = path.join(ROOT, '_shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(
  path.join(UD, 'config.json'),
  JSON.stringify({
    provider: 'localmini',
    model: 'qwen3-instruct',
    pinMode: false,
    autoApprove: true,
    translate: { enabled: false, url: 'http://127.0.0.1:8788', target: 'uzn_Latn' },
    // Kalitli maxsus provayder — birinchi ishga tushish gidi (wizard) chiqmasligi uchun
    // (gid butun ekranni qoplab, tugmalar bosilishini to'sadi).
    customProviders: [{ id: 'custom_test', name: 'Test Local', base: 'http://127.0.0.1:9/v1', models: ['test-model'], vision: false, key: 'test-key' }],
  }, null, 2),
  'utf8',
);

const results = [];
const check = (name, ok, evidence) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};

let appChild = null;
// Dev rejim: npx emas, to'g'ridan-to'g'ri node_modules/electron/dist/electron.exe ishga tushiriladi
// (Node 24 Windows'da .cmd fayllarni shell'siz spawn qilishni rad etadi).
function launch() {
  const localExe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const cmd = fs.existsSync(localExe) ? localExe : 'electron';
  appChild = spawn(cmd, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`], { cwd: ROOT, detached: true, stdio: 'ignore' });
  appChild.unref();
  return appChild;
}
// Faqat o'zimiz ishga tushirgan jarayon daraxtini to'xtatamiz (keng taskkill ishlatilmaydi).
function stopApp() {
  if (!appChild || !appChild.pid) return;
  spawnSync('taskkill', ['/F', '/T', '/PID', String(appChild.pid)], { stdio: 'ignore' });
}
async function cdpGone() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) });
    return false;
  } catch {
    return true;
  }
}

async function pageTarget() {
  for (let i = 0; i < 160; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && /renderer[\\/]index\.html/.test(x.url || ''));
      if (t && t.webSocketDebuggerUrl) return t;
    } catch {}
    await sleep(500);
  }
  throw new Error('renderer CDP target topilmadi');
}

async function attach() {
  const target = await pageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      errors.push('exception: ' + ((d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || '?'));
    }
    if (m.method === 'Log.entryAdded' && m.params && m.params.entry && m.params.entry.level === 'error') {
      errors.push('log: ' + String(m.params.entry.text).slice(0, 200));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
      errors.push('console: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
    }
  });
  const send = (method, params, ms = 25000) => {
    const id = ++seq;
    return new Promise((res) => {
      const timer = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(timer); res(m); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.__timeout) throw new Error('CDP javob bermadi: ' + String(expression).slice(0, 70));
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('JS xato: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await send('Page.enable', {});
  for (let i = 0; i < 160; i++) {
    if ((await ev('window.__ready === true')) === true) break;
    await sleep(500);
  }
  // Gid (kalitsiz holat) butun ekranni qoplaydi — sinov uchun yopamiz.
  await ev(`(() => { const w = document.getElementById('wizard'); if (w) w.remove(); return true; })()`);
  return { send, ev, errors, target };
}

async function shot(session, name) {
  const r = await session.send('Page.captureScreenshot', { format: 'png' });
  const data = r && r.result && r.result.data;
  if (!data) return null;
  const file = path.join(SHOTS, `ui_${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

const MARK = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const watchdog = setTimeout(() => {
  console.log('FAIL  umumiy: 300 s ichida tugamadi');
  stopApp();
  process.exit(1);
}, 300000);

let session = null;
launch();
try {
  MARK('ilova ishga tushirildi (dev, CDP)');
  session = await attach();
  const { ev } = session;
  MARK(`CDP ulandi · window.__ready=${await ev('window.__ready')}`);

  // 1. Karkas elementlari
  const s1 = await ev(`(() => {
    const q = (x) => !!document.querySelector(x);
    const vis = (x) => { const el = document.querySelector(x); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      logo: q('.logo-hex svg'),
      dock: q('#dock') && vis('#dock'),
      bottomBar: q('.bottom-bar') && vis('#bbModel'),
      agentNow: vis('#agentNow') && q('#ringFg'),
      plan: q('#planBtn'), build: q('#buildBtn'),
      modeBtns: vis('#planBtn') && vis('#buildBtn'),
    };
  })()`);
  check('1. Premium karkas: hexagon logo + o‘ng panel + pastki bar + agent/limit aylanasi',
    s1.logo && s1.dock && s1.bottomBar && s1.agentNow && s1.modeBtns,
    JSON.stringify(s1));
  await shot(session, '01_main');

  // 2. Panel yig'ilishi/ochilishi
  const s2 = await ev(`(() => {
    const dock = document.querySelector('#dock');
    const before = dock.classList.contains('collapsed');
    document.querySelector('#dockToggle').click();
    const after = dock.classList.contains('collapsed');
    document.querySelector('#dockToggle').click();
    const back = dock.classList.contains('collapsed');
    return { before, after, back, hasFeed: !!document.querySelector('#dockFeed') };
  })()`);
  check('2. Faoliyat paneli yig‘iladi/ochiladi (dockToggle)',
    s2.before === false && s2.after === true && s2.back === false && s2.hasFeed,
    JSON.stringify(s2));

  // 3. Sozlamalar bo'limlari (tablar)
  const s3 = await ev(`(() => {
    document.querySelector('#settingsBtn').click();
    const modalOpen = !document.querySelector('#settingsModal').classList.contains('hidden');
    const tabs = [...document.querySelectorAll('.set-tab')].map((t) => t.dataset.tab);
    const panes = [...document.querySelectorAll('.set-pane')].map((p) => p.dataset.pane);
    const visible0 = [...document.querySelectorAll('.set-pane')].filter((p) => !p.classList.contains('hidden')).map((p) => p.dataset.pane);
    document.querySelector('.set-tab[data-tab="ui"]').click();
    const visibleUi = [...document.querySelectorAll('.set-pane')].filter((p) => !p.classList.contains('hidden')).map((p) => p.dataset.pane);
    return {
      modalOpen, tabs, panes, visible0, visibleUi,
      pin: !!document.querySelector('#pinModelToggle'), save: !!document.querySelector('#settingsSave'),
      trans: !!document.querySelector('#transEnabled'), uiToggle: !!document.querySelector('#uiPanelToggle'),
    };
  })()`);
  check('3. Sozlamalar bo‘limlarga ajratilgan (provayder/model/tarjima/interfeys/tizim)',
    s3.modalOpen && s3.tabs.join(',') === 'provider,model,translate,ui,system' && s3.panes.length === 5 &&
    s3.visible0.join(',') === 'provider' && s3.visibleUi.join(',') === 'ui' && s3.pin && s3.save && s3.trans && s3.uiToggle,
    JSON.stringify(s3));
  await shot(session, '02_settings_ui');

  // 4. Interfeys sozlamasi panelni boshqaradi + saqlash modalni yopadi
  const s4 = await ev(`(() => {
    const t = document.querySelector('#uiPanelToggle');
    t.click(); // OFF
    const off = document.querySelector('#dock').classList.contains('collapsed');
    t.click(); // ON
    const on = document.querySelector('#dock').classList.contains('collapsed');
    const stored = localStorage.getItem('yang_ui_panel');
    document.querySelector('#settingsSave').click();
    return { off, on, stored };
  })()`);
  await sleep(1000); // saqlash IPC asinxron — modal yopilishini kutamiz
  s4.closed = await ev(`document.querySelector('#settingsModal').classList.contains('hidden')`);
  check('4. «O‘ng faoliyat paneli» sozlamasi ishlaydi, saqlanadi va Saqlash modalni yopadi',
    s4.off === true && s4.on === false && s4.stored === '1' && s4.closed === true,
    JSON.stringify(s4));

  // 5. Model popup (pastdagi chip)
  const s5 = await ev(`(() => {
    document.querySelector('#bbModel').click();
    const pop = document.querySelector('#modelPop');
    const open = !pop.classList.contains('hidden');
    const items = pop.querySelectorAll('.mp-item').length;
    const heads = [...pop.querySelectorAll('.mp-head')].map((h) => h.textContent);
    document.body.click();
    const closed = pop.classList.contains('hidden');
    return { open, items, heads: heads.slice(0, 3), closed };
  })()`);
  check('5. Pastdagi model chipi tanlash popup‘ini ochadi',
    s5.open && s5.items >= 1 && s5.closed, JSON.stringify(s5));

  // 6. Faoliyat oqimi kartalari (haqiqiy renderer funksiyalari orqali)
  const s6 = await ev(`(() => {
    const h = window.__uiHook;
    if (!h) return { hook: false };
    const NL = String.fromCharCode(10);
    document.querySelector('#messages').innerHTML = '';
    h.startThinkingCard({ label: 'Vazifani tahlil qilyapman…' });
    h.closeThinkingCard();
    h.simulateToolCard({ id: 't1', tool: 'read_file', args: { path: 'index.html' }, result: '1  <!doctype html>', ok: true, agent: 'Coder', ms: 42, files: [] });
    h.simulateToolCard({
      id: 't2', tool: 'web_search', args: { query: 'YANG AI nima' }, ok: true, agent: 'Researcher', ms: 120, files: [],
      result: ['🔎 "YANG AI nima" — 2 natija (DuckDuckGo):', '1. YANG AI — https://aicomp.uz/', '   Desktop agentic yordamchi', '2. YANG AI haqida — https://example.com/yang', '   Malumot'].join(NL),
    });
    h.simulateToolCard({ id: 't3', tool: 'run_command', args: { command: 'python yasash.py' }, result: 'OK', ok: true, agent: 'Coder', ms: 900, files: ['ikonka.png'] });
    h.addPlanCard({ steps: ['Fayl tuzilishini tekshirish', 'HTML va CSS yozish', 'localStorage bilan JS yozish'], text: '', task: 'Todo App yarat' });
    h.dockPush({ id: 'x1', icon: '💭', title: 'Tahlil', agent: 'YANG AI', state: 'ok' });
    const kinds = [...document.querySelectorAll('.tool-card')].map((el) => el.className.replace('tool-card ', ''));
    return {
      hook: true,
      thinking: document.querySelectorAll('.step-card').length,
      toolCards: document.querySelectorAll('.tool-card').length,
      kinds,
      browsers: document.querySelectorAll('.mini-browser').length,
      results: document.querySelectorAll('.mb-result').length,
      plan: document.querySelectorAll('.plan-card').length,
      buildBtn: !!document.querySelector('.plan-card .plan-actions .btn-primary'),
      dockItems: document.querySelectorAll('#dockFeed .dock-item').length,
    };
  })()`);
  check('6. Faoliyat oqimi: 💭 thinking, 📖/🌐/🐍 kartalar, mini brauzer, 📋 reja + «Qurishni boshlash»',
    s6.hook && s6.thinking === 1 && s6.toolCards === 3 && s6.browsers === 1 && s6.results >= 2 && s6.plan === 1 && s6.buildBtn && s6.dockItems >= 1,
    JSON.stringify({ thinking: s6.thinking, toolCards: s6.toolCards, browsers: s6.browsers, results: s6.results, plan: s6.plan, dockItems: s6.dockItems, kinds: s6.kinds }));
  await shot(session, '03_activity');

  // 7. Tool kartasi tafsiloti (bosilganda to'liq ma'lumot)
  const s7 = await ev(`(() => {
    const card = document.querySelector('.tool-card');
    card.querySelector('.tool-head').click();
    const open = card.classList.contains('open');
    const labels = [...card.querySelectorAll('.lbl')].map((l) => l.textContent);
    return { open, labels, hasArgs: !!card.querySelector('.tool-body pre'), tool: card.dataset.tool };
  })()`);
  check('7. Ikonka ustiga bosilganda to‘liq tafsilot ochiladi (So‘rov + Natija)',
    s7.open === true && s7.hasArgs === true && s7.labels.includes('So‘rov') && s7.labels.includes('Natija'),
    JSON.stringify(s7));

  // 8. Tepadagi aylana limit + agent nomi
  const s8 = await ev(`(() => {
    const h = window.__uiHook;
    h.setQuotaRing({ percent: 42, text: '42%', title: 'test' });
    const ring = document.querySelector('#ringFg').style.strokeDashoffset;
    h.setCurrentAgent('🧪', 'Tester', 'ishlayapti…');
    const name = document.querySelector('#agentNameNow').textContent;
    const avatar = document.querySelector('#agentAvatar').textContent;
    h.resetCurrentAgent();
    return { ring, name, avatar, reset: document.querySelector('#agentNameNow').textContent };
  })()`);
  check('8. Tepada agent nomi+ikonkasi va aylana limit progressi ishlaydi',
    s8.name === 'Tester' && s8.avatar === '🧪' && parseFloat(s8.ring) > 50 && s8.reset === 'YANG AI',
    JSON.stringify(s8));

  // 9. Rasm natijasi ochib ko'rsatiladi (🐍/🖼 — python yaratgan ikonka kabi)
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const imgPath = path.join(UD, 'natija-test.png');
  fs.writeFileSync(imgPath, Buffer.from(png1x1, 'base64'));
  await ev(`(() => {
    const h = window.__uiHook;
    document.querySelector('#messages').innerHTML = '';
    h.simulateToolCard({ id: 'img1', tool: 'create_image', args: { path: ${JSON.stringify(imgPath)}, width: 1, height: 1 }, result: 'PNG yaratildi: natija-test.png', ok: true, agent: 'Coder', ms: 210, files: [${JSON.stringify(imgPath)}] });
    const card = document.querySelector('.tool-card');
    card.querySelector('.tool-head').click();
    return true;
  })()`);
  await sleep(600); // data-URL asinxron o'qiladi
  const s9 = await ev(`(() => {
    const img = document.querySelector('.file-preview img');
    const card = document.querySelector('.tool-card');
    return {
      preview: !!img,
      previews: document.querySelectorAll('.file-preview').length,
      dataUrl: !!(img && String(img.src).startsWith('data:image/')),
      btns: card ? card.querySelectorAll('.file-actions .btn').length : 0,
      labels: card ? [...card.querySelectorAll('.lbl')].map((l) => l.textContent) : [],
    };
  })()`);
  check('9. 🖼/🐍 natijasi (yaratilgan rasm) kartada ochib ko‘rsatiladi va ochish tugmalari bor',
    s9.preview && s9.previews === 1 && s9.dataUrl && s9.btns >= 2 && s9.labels.includes('Yaratilgan/o‘zgargan fayllar'),
    JSON.stringify(s9));

  // 10. Tepadagi reklama banneri (kreativ, dynamik)
  const s10 = await ev(`(() => {
    window.__uiHook.renderAdDrop({ title: 'YANG AI Pro', body: 'Yangi imkoniyatlar: jamoa rejimi va internet', link: 'https://aicomp.uz', linkText: 'Batafsil →' });
    const drop = document.getElementById('rcAdDrop');
    const out = {
      exists: !!drop,
      showing: !!(drop && drop.classList.contains('show')),
      cta: !!(drop && drop.querySelector('.rc-ad-cta')),
      title: drop ? (drop.querySelector('.rc-ad-copy b') || {}).textContent : '',
    };
    if (drop) drop.remove();
    return out;
  })()`);
  check('10. Tepadan tushadigan kreativ reklama banneri chiziladi',
    s10.exists && s10.showing && s10.cta && s10.title === 'YANG AI Pro', JSON.stringify(s10));

  // 11. Plan/Build tugmalari bo'sh so'rovda ogohlantiradi (agent ishga tushmaydi)
  const s11 = await ev(`(() => {
    document.querySelector('#input').value = '';
    document.querySelector('#planBtn').click();
    const notice = [...document.querySelectorAll('.msg-notice')].map((n) => n.textContent).join(' | ');
    return { notice, busy: document.querySelector('#sendBtn').disabled, stopHidden: document.querySelector('#stopBtn').classList.contains('hidden') };
  })()`);
  check('11. 📋 Plan bo‘sh so‘rovda ogohlantiradi, agent ishga tushmaydi',
    /Avval vazifani yozing/.test(s11.notice) && s11.busy === false && s11.stopHidden === true, JSON.stringify(s11));
  await shot(session, '04_image_ad');

  // 12. Pin rejimi (ui_pin_test.mjs oqimi) yangi sozlamalar modalida ham ishlaydi
  await ev(`(() => { document.querySelector('#settingsBtn').click(); return true; })()`);
  await sleep(300);
  const s12a = await ev(`(() => { const t = document.querySelector('#pinModelToggle'); const before = t.checked; t.click(); return { before, after: t.checked }; })()`);
  await ev(`(() => { document.querySelector('#settingsSave').click(); return true; })()`);
  await sleep(1200);
  let cfgNow = {};
  try { cfgNow = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')); } catch {}
  check('12. «Faqat shu modelni ishlatish» togglesi yangi interfeysda ham config.json ga saqlanadi',
    s12a.after === true && cfgNow.pinMode === true,
    `toggle ${s12a.before} → ${s12a.after}; config.json.pinMode=${cfgNow.pinMode}`);

  // 13. Renderer xatolari
  check('13. Renderer konsolida xato yo‘q', session.errors.length === 0,
    session.errors.length ? session.errors.slice(0, 4).join(' | ') : 'Runtime.exceptionThrown/console.error yo‘q');
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  clearTimeout(watchdog);
  try { session && session.send('Browser.close', {}); } catch {}
  for (let i = 0; i < 20; i++) { if (await cdpGone()) break; await sleep(500); }
  stopApp();
  // Ilova o'zi lokal AI serverini fonda ko'taradi — sinovdan keyin to'xtatamiz.
  spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS · skrinshotlar: ${SHOTS}`);
process.exit(failed ? 1 : 0);
