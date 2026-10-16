// «Lokal AI menejeri» — ASOSIY YANG AI oynasidagi UI aylanmasi (haqiqiy renderer + CDP).
//   node scripts/ui_models_manager.mjs
//
// Nima uchun bu sinov: menejer IDE da bor edi, lekin asosiy oynada YO‘Q edi. Endi u
// shu oynada ham bor — va u IDE bilan UMUMIY mantiqni (`ide/ide_models.js`) ishlatadi.
// Sinov HAQIQIY oynada tekshiradi: tugma → modal → apparat profili → model qatorlari →
// tablar → lokal rasm turkumi → «Yuklab olish» tugmasi borligi → API ko‘prigi → konsol
// xatolari yo‘qligi. Yuklab olishni BOSH-LAMAYDI (tarmoq va ulkan fayl kerak emas).
//
// Ilova: YANG_APP_EXE env yoki o‘rnatilgan nusxa; topilmasa dev rejimda `electron .`.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports', 'ui_models_manager.log');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.writeFileSync(OUT, ''); } catch { /* jurnal yozilmasa ham sinov yuradi */ }
const log = (s) => {
  console.log(s);
  try { fs.appendFileSync(OUT, s + '\n'); } catch { /* */ }
};

function portFree(port) {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '127.0.0.1');
  });
}
async function pickFreePort(start) {
  for (let p = start; p < start + 20; p += 1) if (await portFree(p)) return p;
  throw new Error(`bo‘sh CDP port topilmadi (${start}…${start + 19})`);
}

const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YANG AI', 'YANG AI.exe');
const EXE = process.env.YANG_APP_EXE || INSTALLED;
const useExe = fs.existsSync(EXE);
const ELECTRON_BIN = useExe ? EXE : (await import('electron')).default;
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-models-ui-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, evidence) => {
  results.push(!!ok);
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`);
};

let PORT = Number(process.env.YANG_CDP_PORT || 9345);
function freePort(port) {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    if (!new RegExp(`[:.]${port}\\s`).test(line)) continue;
    const m = line.trim().match(/(\d+)$/);
    if (m) pids.add(m[1]);
  }
  for (const pid of pids) spawnSync('taskkill', ['/F', '/PID', pid, '/T'], { stdio: 'ignore' });
  return [...pids];
}

function launch() {
  const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`];
  const child = useExe
    ? spawn(EXE, args, { detached: true, stdio: 'ignore' })
    : spawn(ELECTRON_BIN, ['.', ...args], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

async function pageTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
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
    const t = setTimeout(() => rej(new Error(`CDP WebSocket ${target.id.slice(0, 8)} javob bermadi (6 s)`)), 6000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error(`CDP WebSocket ${target.id.slice(0, 8)} xato`)); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      const text = (d && (d.exception && d.exception.description || d.text)) || 'noma’lum xato';
      jsErrors.push(String(text).slice(0, 200));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params, ms = 20000) => {
    const id = ++seq;
    return new Promise((res) => {
      const timer = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(timer); res(m); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.__timeout) throw new Error('CDP javob bermadi (20 s): ' + String(expression).slice(0, 60));
    if (r.result && r.result.exceptionDetails) throw new Error('JS xato: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  for (let i = 0; i < 120; i++) {
    if ((await ev('window.__ready === true')) === true) break;
    await sleep(500);
  }
  return { send, ev, target, jsErrors };
}

const appAlive = () => spawnSync('tasklist', ['/FI', 'IMAGENAME eq YANG AI.exe'], { encoding: 'utf8' }).stdout.includes('YANG AI.exe');
const watchdog = setTimeout(() => {
  log('FAIL  umumiy: 240 s ichida tugamadi');
  spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  process.exit(1);
}, 240000);

log(`nishon: ${useExe ? EXE : 'dev rejim (electron .)'}`);
// O‘RNATILGAN nusxa manba koddan ESKI bo‘lishi mumkin. U holda preload ko‘prigi va oqim shunchaki
// yo‘q bo‘ladi va sinov «menejer ishlamaydi» degan NOTO‘G‘RI taassurot beradi (o‘lchandi: shunday
// bo‘lgan). Shuning uchun nishonni manba bilan solishtirib, ochiq ogohlantiramiz.
if (useExe && !process.env.YANG_APP_EXE) {
  const srcNewest = ['main.js', 'preload.cjs', 'renderer/app.js', 'agent/engine.js']
    .map((f) => { try { return fs.statSync(path.join(ROOT, f)).mtimeMs; } catch { return 0; } })
    .reduce((a, b) => Math.max(a, b), 0);
  const exeMs = (() => { try { return fs.statSync(EXE).mtimeMs; } catch { return 0; } })();
  if (srcNewest && exeMs && srcNewest > exeMs) {
    const days = ((srcNewest - exeMs) / 86400000).toFixed(1);
    log(`⚠️  O‘RNATILGAN nusxa manba koddan ${days} kun eski`
      + ` (${new Date(exeMs).toISOString().slice(0, 10)} < ${new Date(srcNewest).toISOString().slice(0, 10)})`);
    log('    Yangi paketni tekshirish kerak: YANG_APP_EXE="dist/win-unpacked/YANG AI.exe" bering'
      + ' yoki yangi o‘rnatuvchini o‘rnating — aks holda quyidagi natijalar ESKI nusxaga tegishli.');
  }
}
log(`user-data: ${UD}`);
const hadLlama = spawnSync('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe'], { encoding: 'utf8' }).stdout.includes('llama-server.exe');

const freed = freePort(PORT);
if (freed.length) log(`eski CDP jarayoni yopildi (port ${PORT}): ${freed.join(', ')}`);
PORT = await pickFreePort(PORT);
let session = null;
const app = launch();
try {
  session = await attach();
  const { ev } = session;
  log(`CDP ulandi · __ready=${await ev('window.__ready')}`);

  // 1. Ko'prik: preload API nomlari IDE bilan bir xil bo'lishi shart.
  const api = await ev(`(() => {
    const need = ['hardware','modelsCatalog','modelsDownload','modelsCancel','modelsRemove','modelsReveal','modelsExternal','modelsAttach','modelsMeasure','modelsBenchState','imageStatus','imageGenerate','imageStop'];
    const have = need.filter((k) => typeof (window.api && window.api[k]) === 'function');
    return { have: have.length, need: need.length, missing: need.filter((k) => !have.includes(k)) };
  })()`);
  check('1. preload ko‘prigi: menejer API si to‘liq (13 nom, IDE bilan bir xil)', api.have === api.need,
    `${api.have}/${api.need} · yetishmaydi=[${api.missing.join(', ')}]`);

  // 2. Sidebar tugmasi modalni ochadi.
  const open = await ev(`(() => {
    const b = document.getElementById('aiModelsBtn');
    if (!b) return { btn: false };
    b.click();
    const m = document.getElementById('modelsModal');
    return { btn: true, open: !m.classList.contains('hidden') };
  })()`);
  check('2. Yon paneldagi «Lokal AI» tugmasi menejerni ochadi', open.btn === true && open.open === true,
    `tugma=${open.btn} · modal ochiq=${open.open}`);

  // 3. Apparat profili haqiqiy qiymatlar bilan (RAM/yadro/disk + daraja yulduzlari).
  let hw = null;
  for (let i = 0; i < 40; i += 1) {
    hw = await ev(`(() => {
      const t = (document.getElementById('hwProfile') || {}).textContent || '';
      return { text: t.trim(), stars: (document.querySelectorAll('#hwProfile .hw-stars') || []).length };
    })()`);
    if (/RAM/.test(hw.text) && /yadro/.test(hw.text)) break;
    await sleep(400);
  }
  check('3. Apparat profili o‘lchanadi (CPU/RAM/video/disk + 2 daraja)', /RAM/.test(hw.text) && /yadro/.test(hw.text) && /GB/.test(hw.text) && hw.stars === 2,
    `«${hw.text.replace(/\s+/g, ' ').slice(0, 150)}» · yulduz bloklari=${hw.stars}`);

  // 4. Model ro'yxati: katalogdagi BARCHA matn modellari (hozir 5 ta), yulduz + talablar bilan.
  let list = null;
  for (let i = 0; i < 40; i += 1) {
    list = await ev(`(() => {
      const rows = document.querySelectorAll('#modelsBody .mdl-row');
      return { rows: rows.length, stars: document.querySelectorAll('#modelsBody .mdl-stars').length, meta: document.querySelectorAll('#modelsBody .mdl-meta').length };
    })()`);
    if (list.rows >= 5) break;
    await sleep(400);
  }
  check('4. Matn modellari ro‘yxati katalogdan chiziladi (har birida 2 yulduz bloki + talablar)',
    list.rows >= 5 && list.stars >= list.rows * 2 && list.meta >= list.rows,
    `qatorlar=${list.rows} · yulduz bloklari=${list.stars} (kutilgan ≥${list.rows * 2}) · talab bloklari=${list.meta}`);

  // 5. Yuklab olish tugmasi AYNAN shu oynadagi modalda bor (runtime turkumida — eng yengili).
  const dl = await ev(`(() => {
    const tabs = [...document.querySelectorAll('#modelsTabs button')];
    const rt = tabs.find((b) => b.dataset.tab === 'runtime');
    rt.click();
    const rows = document.querySelectorAll('#modelsBody .mdl-row').length;
    const btn = document.querySelectorAll('#modelsBody [data-act="download"]').length;
    const name = (document.querySelector('#modelsBody .mdl-name') || {}).textContent || '';
    return { rows, btn, name, active: (document.querySelector('#modelsTabs button.active') || {}).dataset?.tab };
  })()`);
  // Diqqat: shu mashinada rasm dvigateli allaqachon o‘rnatilgan bo‘lishi mumkin (o‘lchandi:
  // `sd-cli.exe` vulkan nusxasi bor). O‘rnatilgan yozuv «Yuklab olish» o‘rniga
  // «Papkada ko‘rsatish» tugmasini beradi — ikkalasi ham to‘g‘ri holat, shuning uchun
  // tekshiruv «yuklab olish YOKI o‘rnatilgan» mantiqida (yolg‘on FAIL bo‘lmasin).
  const dlInstalled = await ev(`(() => {
    const rows = [...document.querySelectorAll('#modelsBody .mdl-row')];
    const installed = rows.filter((r) => (r.textContent || '').includes('o\u2018rnatilgan')).length;
    const reveal = document.querySelectorAll('#modelsBody [data-act="reveal"]').length;
    return { installed, reveal };
  })()`);
  check('5. «Rasm dvigateli» turkumi: har qatorda yuklab olish YOKI o‘rnatilgan holati bor',
    dl.rows >= 1 && dl.active === 'runtime' && (dl.btn >= 1 || dlInstalled.installed >= 1)
    && (dl.btn >= 1 || dlInstalled.reveal >= 1),
    `qatorlar=${dl.rows} · download tugmalari=${dl.btn} · o‘rnatilgan qator=${dlInstalled.installed} · «papkada ko‘rsatish»=${dlInstalled.reveal} · birinchi: «${String(dl.name).slice(0, 40)}» · faol tab=${dl.active}`);

  // 6. Tablar almashinadi (har bir turkum bo'sh bo'lmagan mazmun beradi).
  const tabs = await ev(`(() => {
    const out = {};
    for (const b of document.querySelectorAll('#modelsTabs button')) {
      b.click();
      out[b.dataset.tab] = {
        active: b.classList.contains('active'),
        rows: document.querySelectorAll('#modelsBody .mdl-row').length,
        text: (document.getElementById('modelsBody').textContent || '').trim().length,
      };
    }
    return out;
  })()`);
  const tabNames = Object.keys(tabs);
  // `installed` — ASYNC skan: u bir zumda «O‘qilmoqda…» ko‘rsatadi (mazmunini 7-tekshiruv
  // kutib o‘lchaydi), shuning uchun matn uzunligi talabi unga qo‘yilmaydi.
  const tabOk = tabNames.length === 5
    && tabNames.every((t) => tabs[t].active && (t === 'installed' || tabs[t].text > 20));
  // Katalogda 5 matn + 3 rasm + 2 dvigatel + 1 ovoz = 11 yozuv; TURKUM tablari ularni
  // to‘liq qamrashi kerak. «Kompyuterda bor» — turkum emas, HAQIQIY skan (uni 7-tekshiruv
  // alohida o‘lchaydi), shuning uchun qamrov hisobiga kirmaydi.
  const catalogRows = (tabs.text.rows || 0) + (tabs.image.rows || 0) + (tabs.runtime.rows || 0) + (tabs.voice.rows || 0);
  check('6. Barcha 5 turkum almashinadi va katalogdagi 11 yozuv to‘liq ko‘rinadi',
    tabOk && catalogRows === 11,
    `${tabNames.map((t) => `${t}:${tabs[t].rows} qator / ${tabs[t].text} belgi`).join(' · ')} · jami=${catalogRows}`);

  // 7. «Kompyuterda bor» turkumi HAQIQIY skanni ko'rsatadi (Ollama va/yoki HF keshi).
  const inst = await ev(`(() => {
    const b = [...document.querySelectorAll('#modelsTabs button')].find((x) => x.dataset.tab === 'installed');
    b.click();
    return { text: (document.getElementById('modelsBody').textContent || '').replace(/\\s+/g, ' ').trim() };
  })()`);
  for (let i = 0; i < 40 && inst.text.length < 40; i += 1) {
    await sleep(400);
    inst.text = await ev(`(document.getElementById('modelsBody').textContent || '').replace(/\\s+/g,' ').trim()`);
  }
  check('7. Kompyuterda bor AI skani ishlaydi (Ollama / LM Studio / HF keshi / model papkalari)',
    /Ollama|LM Studio|HuggingFace|model papkalari/i.test(inst.text),
    `«${inst.text.slice(0, 160)}»`);

  // 8. Lokal rasm turkumi: o'lchovga asoslangan vaqt taxmini ko'rinadi.
  const img = await ev(`(() => {
    const b = [...document.querySelectorAll('#modelsTabs button')].find((x) => x.dataset.tab === 'image');
    b.click();
    document.getElementById('imgSteps').value = '30';
    document.getElementById('imgSteps').dispatchEvent(new Event('change'));
    return {
      shown: !document.getElementById('modelsImage').classList.contains('hidden'),
      est: (document.getElementById('imgEst').textContent || '').trim(),
    };
  })()`);
  check('8. Lokal rasm bo‘limi ko‘rinadi va vaqt taxmini o‘lchovga tayanadi',
    img.shown === true && /Taxminiy vaqt/.test(img.est) && /qadam/.test(img.est),
    `ko‘rinadi=${img.shown} · «${img.est.slice(0, 140)}»`);

  // 9. Modal yopiladi (✕ va fon bosilishi).
  const closed = await ev(`(() => {
    document.getElementById('modelsClose').click();
    const hidden = document.getElementById('modelsModal').classList.contains('hidden');
    const state = window.__modelsHook ? window.__modelsHook.state().open : null;
    return { hidden, state };
  })()`);
  check('9. «✕» modalni yopadi (holat ham yangilanadi)', closed.hidden === true && closed.state === false,
    `yopiq=${closed.hidden} · modelsMgr.open=${closed.state}`);

  // 10. Renderer tomonda JS xatosi yo'q (CDP istisnolari).
  check('10. Konsol/renderer xatolari yo‘q', session.jsErrors.length === 0,
    session.jsErrors.length ? session.jsErrors.slice(0, 2).join(' | ') : 'istisno qayd etilmadi');
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  clearTimeout(watchdog);
  try { session && session.send('Browser.close', {}); } catch {}
  for (let i = 0; i < 20 && appAlive(); i += 1) await sleep(500);
  if (appAlive()) spawnSync('taskkill', ['/F', '/IM', 'YANG AI.exe'], { stdio: 'ignore' });
  if (!useExe && app && app.pid) spawnSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' });
  if (!hadLlama) spawnSync('taskkill', ['/F', '/IM', 'llama-server.exe'], { stdio: 'ignore' });
  else log('eslatma: llama-server testdan oldin ham ishlayotgan edi — to‘xtatilmadi');
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r).length;
log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
log(`jurnal: ${OUT}`);
process.exit(failed ? 1 : 0);
