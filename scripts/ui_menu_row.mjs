// «Lokal AI» MENYU QATORI — asosiy jarayon inspektori orqali (o‘rnatilgan nusxa yoki paket).
//   node scripts/ui_menu_row.mjs
//   YANG_APP_EXE="dist/win-unpacked/YANG AI.exe" node scripts/ui_menu_row.mjs
//   YANG_DEV=1 node scripts/ui_menu_row.mjs      # o‘rnatilgan nusxa bo‘lsa ham manbadan
//
// Nishon tanlash: `YANG_APP_EXE` → o‘rnatilgan nusxa → `electron .` (dev). O‘rnatilgan nusxa
// bo‘lmasa (CI) sinov SKIP qilinmaydi — manba koddan ko‘tariladi, chunki menyu asosiy
// jarayonda quriladi va inspektor orqali tekshiruv baribir haqiqiy.
//
// Nega alohida sinov: renderer CDP native menyuni KO‘RMAYDI, shuning uchun menyu qatori
// (v5.6 da qo‘shilgan «Lokal AI» bo‘limi) faqat `--inspect` orqali tekshiriladi:
//   Menu.getApplicationMenu() → «Lokal AI» → bandni HAQIQIY click qilish
// va renderer tomonda modal ochilganini (kerakli turkum bilan) o‘lchash.
// Qo‘shimcha: o‘rnatilgan nusxa GitHub katalogini tortib olganini asosiy jarayon
// jurnalidan tasdiqlaymiz va «cheklov yo‘q» talabini (warn, lekin tugma o‘chiq emas) tekshiramiz.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'ui_menu_row.log');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.writeFileSync(OUT, ''); } catch { /* jurnal yozilmasa ham sinov yuradi */ }
const log = (s) => {
  console.log(s);
  try { fs.appendFileSync(OUT, s + '\n'); } catch { /* */ }
};

const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YANG AI', 'YANG AI.exe');
const EXE = process.env.YANG_APP_EXE || INSTALLED;
// O‘rnatilgan nusxa bo‘lmasa (masalan CI’da) manba koddan `electron .` ko‘tariladi — menyu
// asosiy jarayonda quriladi, shuning uchun inspektor orqali tekshiruv baribir HAQIQIY.
const FORCE_DEV = process.env.YANG_DEV === '1';
const useExe = !FORCE_DEV && fs.existsSync(EXE);
const ELECTRON_BIN = useExe ? null : (await import('electron')).default;
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-menu-'));
const RP = Number(process.env.YANG_CDP_PORT || 9364);
const IP = Number(process.env.YANG_INSPECT_PORT || 9374);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, ev) => {
  results.push(!!ok);
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${ev}`);
};

log(`nishon: ${useExe ? EXE : 'dev rejim (electron .)'}\nuser-data: ${UD}\n`);

// Asosiy jarayonda `await import()` ishlamaydi (inspektor kontekstida dinamik import
// callback yo‘q), shuning uchun `electron` modulini bir necha yo‘l bilan olamiz.
const HELPER = `
function __electronMenu() {
  const diag = { require: typeof require, getBuiltinModule: typeof process.getBuiltinModule, mainModule: typeof process.mainModule };
  let el = null;
  try { if (typeof require === 'function') el = require('electron'); } catch (e) { diag.e1 = e.message; }
  if (!el && typeof process.getBuiltinModule === 'function') {
    try { el = process.getBuiltinModule('module').createRequire(process.execPath)('electron'); } catch (e) { diag.e2 = e.message; }
  }
  if (!el && process.mainModule) { try { el = process.mainModule.require('electron'); } catch (e) { diag.e3 = e.message; } }
  if (!el) return { diag, Menu: null };
  return { diag, Menu: el.Menu };
}
`;

// Oldingi nusxa hali yopilayotgan bo‘lsa, yangi jarayon singleton qulfi tufayli darhol
// chiqib ketadi — shuning uchun avval tozalab, tugashini kutamiz. Dev rejimda esa
// foydalanuvchining ochiq ilovasini o‘ldirmaymiz (user-data papkasi alohida — qulf yo‘q).
if (useExe) {
  spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i += 1) {
    const alive = spawnSync('tasklist', ['/FI', 'IMAGENAME eq YANG AI.exe'], { encoding: 'utf8' }).stdout.includes('YANG AI.exe');
    if (!alive) break;
    await sleep(250);
  }
  await sleep(1200);
}

let out = '';
const args = [`--remote-debugging-port=${RP}`, `--inspect=${IP}`, `--user-data-dir=${UD}`];
const child = useExe
  ? spawn(EXE, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn(ELECTRON_BIN, ['.', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => { out += String(d); });
child.stderr.on('data', (d) => { out += String(d); });

const cleanup = () => {
  // Dev rejimda jarayon nomi electron.exe — faqat o‘zimiz ko‘targan daraxtni yopamiz.
  if (useExe) spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  else if (child.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
};

async function pick(port, pred, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1200) })).json();
      const t = l.find(pred);
      if (t && t.webSocketDebuggerUrl) return t;
    } catch { /* hali ko‘tarilmagan */ }
    await sleep(400);
  }
  throw new Error(`${port} da nishon topilmadi`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('WS ulanmadi (8 s)')), 8000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('WS xato')); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}, ms = 20000) => new Promise((res) => {
    const id = ++seq;
    const t = setTimeout(() => res({ __timeout: true }), ms);
    pending.set(id, (m) => { clearTimeout(t); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.__timeout) throw new Error('evaluate javob bermadi: ' + String(expression).slice(0, 60));
    const res = r.result || {};
    if (res.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails).slice(0, 300));
    return res.result ? res.result.value : undefined;
  };
  await send('Runtime.enable');
  return { ev, send, ws };
}

let renderer = null;
try {
  const tPage = await pick(RP, (x) => x.type === 'page' && /renderer[\\/]index\.html/.test(x.url || ''));
  renderer = await connect(tPage.webSocketDebuggerUrl);
  for (let i = 0; i < 120; i += 1) {
    if ((await renderer.ev('window.__ready === true')) === true) break;
    await sleep(500);
  }

  const tMain = await pick(IP, (x) => /node/i.test(x.description || '') || x.type === 'node', 30000);
  const main = await connect(tMain.webSocketDebuggerUrl);

  const menu = await main.ev(`(function () { ${HELPER}
    const h = __electronMenu();
    if (!h.Menu) return { menu: false, diag: h.diag };
    const m = h.Menu.getApplicationMenu();
    if (!m) return { menu: false, diag: h.diag };
    const it = m.items.find((i) => i.label === 'Lokal AI');
    return {
      menu: true,
      diag: h.diag,
      top: m.items.map((i) => i.label),
      la: it && it.submenu ? it.submenu.items.map((s) => ({ label: s.label, acc: s.accelerator || null, type: s.type })) : null,
    };
  })()`);
  const laItems = (menu.la || []).filter((x) => x.type !== 'separator');
  check('1. Menyu qatorida «Lokal AI» bor va 5 band ko‘rinadi (Ctrl+Shift+M bilan)',
    menu.menu === true && laItems.length === 5
    && laItems.some((x) => /menejeri/.test(x.label) && x.acc === 'CmdOrCtrl+Shift+M'),
    `yuqori qatorlar=[${(menu.top || []).join(' | ')}] · bandlar=[${laItems.map((x) => x.label).join(' | ')}]`);

  // Menyu bandini HAQIQIY click bilan bosamiz (accelerator emas — handlerning o‘zi).
  const clicked = await main.ev(`(function () { ${HELPER}
    const h = __electronMenu();
    const m = h.Menu.getApplicationMenu();
    const la = m.items.find((i) => i.label === 'Lokal AI');
    const it = la.submenu.items.find((s) => /menejeri/.test(s.label));
    it.click();
    return { label: it.label, enabled: it.enabled, visible: it.visible };
  })()`);
  let opened = null;
  for (let i = 0; i < 40; i += 1) {
    opened = await renderer.ev(`(() => {
      const m = document.getElementById('modelsModal');
      if (!m) return { modal: false };
      const active = document.querySelector('#modelsTabs button.active');
      return { modal: true, open: !m.classList.contains('hidden'), tab: active ? active.dataset.tab : null };
    })()`);
    if (opened.open === true) break;
    await sleep(300);
  }
  check('2. «Lokal AI menejeri» bandini bosish modalni AYNAN matn turkumida ochadi',
    clicked.enabled === true && clicked.visible !== false && opened.open === true && opened.tab === 'text',
    `band=«${clicked.label}» · enabled=${clicked.enabled} · modal ochiq=${opened.open} · faol tab=${opened.tab}`);

  const clicked2 = await main.ev(`(function () { ${HELPER}
    const h = __electronMenu();
    const m = h.Menu.getApplicationMenu();
    const la = m.items.find((i) => i.label === 'Lokal AI');
    const it = la.submenu.items.find((s) => /Kompyuterda bor/.test(s.label));
    it.click();
    return it.label;
  })()`);
  let tab2 = null;
  for (let i = 0; i < 40; i += 1) {
    tab2 = await renderer.ev(`(() => {
      const m = document.getElementById('modelsModal');
      const a = document.querySelector('#modelsTabs button.active');
      return { open: !m.classList.contains('hidden'), tab: a ? a.dataset.tab : null };
    })()`);
    if (tab2.tab === 'installed') break;
    await sleep(300);
  }
  check('3. «Kompyuterda bor AI» bandi menejerni «Kompyuterda bor» turkumi bilan ochadi',
    tab2.open === true && tab2.tab === 'installed', `band=«${clicked2}» · faol tab=${tab2.tab}`);

  const cat = await renderer.ev('(async () => { const c = await window.api.modelsCatalog(); return { n: (c.items || []).length, updated: c.updated || "", err: c.error || "" }; })()');
  check('4. Katalog to‘liq o‘qiladi (12 yozuv) va xatosiz',
    cat.n === 12 && !cat.err, `yozuvlar=${cat.n} · updated=${cat.updated} · xato=«${cat.err}»`);

  // GitHub katalogi haqiqatan tortib olinib, paket ustiga qo‘yilganini jurnaldan tasdiqlaymiz.
  const RE = /lokal AI katalogi admin nusxasi bilan yangilandi \((\d+) yozuv\)/;
  let merged = false;
  for (let i = 0; i < 40 && !merged; i += 1) {
    merged = RE.test(out);
    if (!merged) await sleep(500);
  }
  const mm = out.match(RE);
  check('5. Ishga tushganda GitHub’dagi admin katalogi tortilib, paket ustiga qo‘yiladi',
    merged, merged ? `jurnal: «${mm[0]}»` : 'jurnalda tasdiq topilmadi (tarmoq?)');

  // «Cheklov yo‘q» talabi: resurs yetmasa «Ogohlantirish», lekin tugma o‘chirilmagan.
  const cat2 = await renderer.ev(`(async () => {
    const c = await window.api.modelsCatalog();
    const w = (c.items || []).filter((x) => x.verdict && x.verdict.state === 'warn');
    const bad = (c.items || []).filter((x) => x.verdict && /Ishlamaydi/i.test(String(x.verdict.fit || '')));
    return { n: (c.items || []).length, warn: w.length, sample: w.slice(0, 2).map((x) => ({ name: x.name, fit: x.verdict.fit })), blocked: bad.length };
  })()`);
  check('6. Katalogda «Ishlamaydi» holati YO‘Q, resurs yetmasa faqat «Ogohlantirish» beriladi',
    cat2.blocked === 0 && cat2.warn >= 1,
    `yozuvlar=${cat2.n} · warn=${cat2.warn} · «Ishlamaydi»=${cat2.blocked} · namuna=${JSON.stringify(cat2.sample)}`);

  // Ogohlantirish holati qaysi turkumda bo‘lsa (matn, rasm, dvigatel yoki ovoz — bu shu
  // kompyuterdagi bo‘sh joy/RAM ga bog‘liq), AYNAN o‘sha turkumni ochib tekshiramiz.
  const dom = await renderer.ev(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const c = await window.api.modelsCatalog();
    const warnItem = (c.items || []).find((x) => x.verdict && x.verdict.state === 'warn');
    const rowsIn = (tab) => {
      const b = [...document.querySelectorAll('#modelsTabs button')].find((x) => x.dataset.tab === tab);
      if (b) b.click();
      return [...document.querySelectorAll('#modelsBody .mdl-row')];
    };
    const canClick = (r) => {
      const btn = r.querySelector('[data-act="download"],[data-act="reveal"],[data-act="cancel"],[data-act="attach"],[data-act="use"]');
      return !!btn && btn.disabled !== true;
    };
    const tabs = ['text', 'image', 'runtime', 'voice'];
    let warnRow = null;
    let allRows = 0;
    let blockedText = 0;
    let disabled = 0;
    for (const t of tabs) {
      const rows = rowsIn(t);
      await wait(300);
      allRows += rows.length;
      blockedText += rows.filter((r) => /Ishlamaydi/.test(r.textContent || '')).length;
      disabled += rows.filter((r) => !canClick(r)).length;
      if (warnItem && !warnRow) {
        const hit = rows.find((r) => /Ogohlantirish/.test(r.textContent || '')
          && (r.textContent || '').includes(String(warnItem.name).slice(0, 12)));
        if (hit) warnRow = { tab: t, ok: canClick(hit), text: (hit.textContent || '').replace(/\\s+/g, ' ').slice(0, 170) };
      }
    }
    return { allRows, warnItem: warnItem ? { name: warnItem.name, fit: warnItem.verdict.fit } : null, warnRow, blockedText, disabled };
  })()`);
  check('7. Ogohlantirilgan qatorda ham tugma BOR va o‘chirilmagan (yuklab olish bloklanmaydi)',
    dom.blockedText === 0 && dom.disabled === 0 && (!dom.warnItem || (dom.warnRow && dom.warnRow.ok === true)),
    `qatorlar=${dom.allRows} · warn yozuv=${dom.warnItem ? `«${dom.warnItem.name}» (${dom.warnItem.fit})` : 'bu kompyuterda yo‘q'} · ogohlantirish qatori=${dom.warnRow ? `${dom.warnRow.tab}: tugma faol=${dom.warnRow.ok}` : 'yo‘q'} · «Ishlamaydi» matni=${dom.blockedText} · tugmasiz/o‘chiq qator=${dom.disabled}${dom.warnRow ? ` · «${dom.warnRow.text}»` : ''}`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
  log('--- ilova jurnali (oxiri) ---');
  log(out.split(/\r?\n/).slice(-12).join('\n'));
} finally {
  try { renderer && renderer.send('Browser.close', {}); } catch { /* */ }
  await sleep(800);
  cleanup();
}

const failed = results.filter((r) => !r).length;
log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
log(`jurnal: ${OUT}`);
process.exit(failed ? 1 : 0);
