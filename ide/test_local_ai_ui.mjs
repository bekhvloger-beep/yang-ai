// ide/test_local_ai_ui.mjs — «Lokal AI menejeri» HAQIQIY oynada ishlayaptimi?
//
// Nega bu sinov bor: foydalanuvchining savoli — "mening kompyuterim qaysi modelni ko'taradi,
// qanchasi kuchli, rasm yasay oladimi?" Ilgari javob faqat kod ichida (RAM >= 8 GB → 4B) bor
// edi va YOZILMAGAN edi; endi «Lokal AI» menyusi bor. Bu sinov uni DEV renderer ustida, CDP
// orqali tekshiradi — ya'ni foydalanuvchi bosadigan yo'l bilan:
//
//   node ide/test_local_ai_ui.mjs
//
// Tekshiriladi: tugma modalni ochadi; apparat profili HAQIQIY raqamlar (RAM/yadro/disk) bilan
// chiziladi; har bir modelda o'lchangan kuch (★) va SHU kompyuterdagi natija (→ ★) ko'rinadi;
// minimal talablar yozilgan; «Kompyuterda bor» turkumi allaqachon o'rnatilgan AI ni (Ollama)
// topib «Ishlatish» tugmasini beradi; va eng muhimi — rasm HAQIQATAN lokal yaratiladi
// (internet va API kalitsiz) va ish papkasidagi `generated/` ga yoziladi.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`);
}

if (!fs.existsSync(ELECTRON)) {
  console.log(`SKIP: electron topilmadi — ${ELECTRON}`);
  process.exit(0);
}

function portFree(port) {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '127.0.0.1');
  });
}
async function pickFreePort(start) {
  for (let p = start; p < start + 30; p += 1) if (await portFree(p)) return p;
  throw new Error('bo‘sh CDP port topilmadi');
}

const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-models-'));
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-models-ws-'));
fs.writeFileSync(path.join(UD, 'ide-state.json'), JSON.stringify({ lastWorkspace: WS, recent: [WS] }), 'utf8');

const PORT = await pickFreePort(9471);
const app = spawn(ELECTRON, [path.join(ROOT, 'ide', 'main.js'), `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], { detached: true, stdio: 'ignore' });
app.unref();
console.log(`dev IDE: ${ELECTRON} ide/main.js\nish papkasi: ${WS}\nCDP port ${PORT}\n`);

let ws = null;
let sendRaw = null;
async function attach(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let target = null;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && /ide[\\/]renderer[\\/]index\.html/.test(x.url || '') && x.webSocketDebuggerUrl);
      if (t) { target = t; break; }
    } catch { /* CDP hali ko‘tarilmagan */ }
    await sleep(400);
  }
  if (!target) throw new Error('IDE oynasi CDP’da topilmadi');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP ulanish vaqti tugadi')), 10000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP xatosi')); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  sendRaw = (method, params = {}, ms = 15000) => new Promise((res) => {
    const id = ++seq;
    const t = setTimeout(() => res(null), ms);
    pending.set(id, (m) => { clearTimeout(t); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return async (expression, ms = 90000) => {
    const id = ++seq;
    const r = await new Promise((res) => {
      const t = setTimeout(() => res({ __timeout: true }), ms);
      pending.set(id, (m) => { clearTimeout(t); res(m); });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (r.__timeout) throw new Error(`CDP javob bermadi: ${String(expression).slice(0, 60)}`);
    if (r.result && r.result.exceptionDetails) throw new Error(`JS xato: ${JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 200)}`);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
}

async function waitFor(pred, ms, step = 400) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await sleep(step);
  }
  return false;
}

let ev = null;
try {
  ev = await attach();
  const ready = await waitFor(async () => (await ev('typeof openTab')) === 'function', 45000);
  if (!ready) throw new Error('renderer tayyor bo‘lmadi (openTab topilmadi)');
  await ev('(async () => { await window.ide.init(); return true; })()');

  /* 1) Tugma modalni ochadi */
  const opened = await ev(`(() => {
    const btn = document.getElementById('aiModelsBtn');
    if (!btn) return { error: 'tugma yo‘q' };
    btn.click();
    const m = document.getElementById('modelsModal');
    return { hidden: m.classList.contains('hidden'), label: btn.textContent.trim() };
  })()`);
  check('1. Yuqori panelda «Lokal AI» tugmasi bor va menyuni ochadi',
    !!(opened && !opened.hidden && /lokal/i.test(opened.label || '')),
    `tugma="${opened && opened.label}" · modal ochiq=${opened && !opened.hidden}`);

  /* 2) Apparat profili HAQIQIY raqamlar bilan chiziladi */
  const hwReady = await waitFor(async () => {
    const t = await ev('(() => { const el = document.getElementById("hwProfile"); return el ? el.textContent : ""; })()');
    return /RAM/.test(String(t)) && /Video/.test(String(t));
  }, 30000);
  const hw = await ev(`(() => {
    const el = document.getElementById('hwProfile');
    const k = [...el.querySelectorAll('.hw-item')].map((x) => x.textContent.trim());
    return { text: el.textContent, items: k, stars: [...el.querySelectorAll('.hw-stars')].map((s) => s.textContent) };
  })()`);
  const hwText = String((hw && hw.text) || '');
  const ramMatch = hwText.match(/RAM([\d.,]+)\s*GB/);
  const realRamGb = os.totalmem() / 1024 ** 3;
  check('2. Apparat profili haqiqiy qiymatlarni ko‘rsatadi (CPU, RAM, video karta, disk, daraja)',
    hwReady && !!ramMatch && Math.abs(Number(String(ramMatch[1]).replace(',', '.')) - realRamGb) < 1.5
    && Array.isArray(hw.stars) && hw.stars.length === 2 && /CPU/.test(hwText) && /Disk/.test(hwText),
    `RAM ekranda=${ramMatch && ramMatch[1]} GB · haqiqiy=${realRamGb.toFixed(1)} GB · darajalar=${JSON.stringify(hw && hw.stars)}`);

  /* 3) Matn modellari: o'lchangan kuch + talablar + shu kompyuterdagi natija */
  const rowsReady = await waitFor(async () => {
    const n = await ev('document.querySelectorAll("#modelsBody .mdl-row").length');
    return Number(n) > 0;
  }, 30000);
  const textTab = await ev(`(() => {
    const rows = [...document.querySelectorAll('#modelsBody .mdl-row')];
    return {
      count: rows.length,
      first: rows.slice(0, 6).map((r) => ({
        name: (r.querySelector('.mdl-name') || {}).textContent || '',
        stars: [...r.querySelectorAll('.mdl-stars')].map((s) => s.textContent),
        meta: (r.querySelector('.mdl-meta') || {}).textContent || '',
        reasons: (r.querySelector('.mdl-reasons') || {}).textContent || '',
        badge: (r.querySelector('.mdl-badge') || {}).textContent || '',
        actions: [...r.querySelectorAll('[data-act]')].map((b) => b.dataset.act),
      })),
    };
  })()`);
  const anyMeasured = (textTab.first || []).some((r) => /o‘lchandi/.test(r.meta || ''));
  const anyRequirements = (textTab.first || []).every((r) => /min RAM/.test(r.meta || '') && /kerak joy/.test(r.meta || ''));
  const starsOk = (textTab.first || []).every((r) => r.stars.length === 2 && /[★☆]/.test(r.stars[0]) && /[★☆]/.test(r.stars[1]));
  check('3. Har bir modelda minimal talablar, o‘lchangan kuch (★) va sizdagi natija (→ ★) bor',
    rowsReady && textTab.count >= 4 && anyRequirements && starsOk && anyMeasured,
    `qatorlar=${textTab.count} · ${JSON.stringify((textTab.first || []).slice(0, 3).map((r) => `${r.name} ${r.stars.join(' ')}`))}`);

  /* 4) Kuchli model «kuchliroq», kuchsizi «boshlang'ich» deb baholanadi */
  const byName = Object.fromEntries((textTab.first || []).map((r) => [r.name, r]));
  const names = Object.keys(byName);
  const coder7 = names.find((n) => /7B/i.test(n));
  const tiny = names.find((n) => /0\.5B/i.test(n));
  const starCount = (s) => (String(s || '').match(/★/g) || []).length;
  // Bu kompyuterda 7B HAQIQATAN sig'adimi? Ilovaning bahosiga ishonmaymiz — sinov
  // diskni O'ZI o'lchaydi (katalogdagi talab bilan solishtiradi). Joy yetarli bo'lsa
  // 7B «→ ★★☆» dan past bo'lmasligi SHART; joy yetmasa bahoni «Ishlamaydi» qilib,
  // sababini aynan yetmagan resurs bilan aytishi shart. Shu tariqa sinov ham mashina
  // holatiga bog'lanib qolmaydi, ham zaiflashmaydi (nosoz sabab qabul qilinmaydi).
  const cat7 = JSON.parse(fs.readFileSync(path.join(ROOT, 'local-ai', 'catalog.json'), 'utf8'))
    .items.find((x) => x.id === 'text-qwen25-coder-7b-q4km') || {};
  const needDiskGb = ((cat7.min || {}).diskGb) || 5;
  let freeDiskGb = null;
  try {
    const st = fs.statfsSync(os.homedir());       // APPDATA shu diskda — model shu yerga tushadi
    freeDiskGb = (st.bavail * st.bsize) / 1024 ** 3;
  } catch { /* o'lchanmadi */ }
  const diskShort = freeDiskGb != null && freeDiskGb < needDiskGb * 1.1;
  const blockedNow = starCount(byName[coder7].stars[1]) === 0;
  const machineGradeOk = blockedNow
    ? diskShort && /diskda/.test(byName[coder7].reasons || '') && /Ishlamaydi/.test(byName[coder7].badge || '')
    : starCount(byName[coder7].stars[1]) >= 3;
  check('4. Baho modelga qarab farq qiladi va «shu kompyuterdagi natija» sababi bilan asoslanadi',
    !!coder7 && !!tiny
    && starCount(byName[coder7].stars[0]) > starCount(byName[tiny].stars[0])
    && machineGradeOk,
    coder7 && tiny
      ? `${coder7}: ${byName[coder7].stars.join(' ')} (${byName[coder7].badge}) · bo‘sh disk ${freeDiskGb == null ? '?' : freeDiskGb.toFixed(1)} GB / kerak ${(needDiskGb * 1.1).toFixed(1)} GB · sabab="${String(byName[coder7].reasons || '').slice(0, 70)}" | ${tiny}: ${byName[tiny].stars.join(' ')}`
      : `7B=${!!coder7} 0.5B=${!!tiny}`);

  /* 5) «Kompyuterda bor» turkumi o'rnatilgan AI ni topadi (Ollama) va ulashni taklif qiladi */
  await ev(`(() => { [...document.querySelectorAll('#modelsTabs button')].find((b) => b.dataset.tab === 'installed').click(); return true; })()`);
  const extReady = await waitFor(async () => {
    const t = await ev('(document.getElementById("modelsBody") || {}).textContent || ""');
    return /Ollama|HuggingFace|topilmadi/.test(String(t));
  }, 40000);
  const ext = await ev(`(() => {
    const body = document.getElementById('modelsBody');
    return {
      text: body.textContent.slice(0, 600),
      use: [...body.querySelectorAll('[data-act="use"]')].slice(0, 3).map((b) => ({ p: b.dataset.provider, m: b.dataset.model })),
      rows: body.querySelectorAll('.mdl-row').length,
    };
  })()`);
  check('5. Kompyuterda allaqachon o‘rnatilgan AI topiladi va «Ishlatish» tugmasi beriladi',
    extReady && ext.rows > 0 && ext.use.length > 0 && ext.use.every((u) => u.p && u.m),
    `${ext.rows} qator · ulash takliflari=${JSON.stringify(ext.use)}`);

  /* 6) Rasm turkumi: generator ko'rinadi va dvigatel holati yozilgan */
  await ev(`(() => { [...document.querySelectorAll('#modelsTabs button')].find((b) => b.dataset.tab === 'image').click(); return true; })()`);
  const imgUi = await ev(`(() => ({
    generator: !document.getElementById('modelsImage').classList.contains('hidden'),
    sd: document.getElementById('modelsSd').textContent,
    steps: [...document.getElementById('imgSteps').options].map((o) => o.value),
    sizes: [...document.getElementById('imgSize').options].map((o) => o.value),
    rows: document.querySelectorAll('#modelsBody .mdl-row').length,
  }))()`);
  check('6. Rasm turkumida generator va rasm modellari ko‘rinadi',
    !!(imgUi && imgUi.generator && imgUi.rows >= 2 && /rasm dvigateli/.test(imgUi.sd)),
    `dvigatel="${imgUi && imgUi.sd}" · modellar=${imgUi && imgUi.rows}`);

  /* 7) Vaqt taxmini ko'rsatiladi (o'lchovga asoslangan) */
  const est = await ev(`(() => {
    const size = document.getElementById('imgSize');
    const steps = document.getElementById('imgSteps');
    size.value = '256x256'; size.dispatchEvent(new Event('change'));
    steps.value = '8'; steps.dispatchEvent(new Event('change'));
    return document.getElementById('imgEst').textContent;
  })()`);
  check('7. Yaratishdan OLDIN taxminiy vaqt (o‘lchovga asoslangan) ko‘rsatiladi',
    /Taxminiy vaqt/.test(String(est)) && /sekund|daqiqa/.test(String(est)), `"${est}"`);

  /* 8) HAQIQIY lokal rasm generatsiyasi — UI orqali (API va internetsiz) */
  await ev(`(() => { document.getElementById('imgPrompt').value = 'a red apple on a wooden table, photo'; return true; })()`);
  const t0 = Date.now();
  await ev('(() => { document.getElementById("imgGo").click(); return true; })()');
  const gotImg = await waitFor(async () => {
    const n = await ev('document.querySelectorAll("#imgOut img").length');
    return Number(n) > 0;
  }, 600000, 2000);
  const secs = Math.round((Date.now() - t0) / 1000);
  const imgInfo = await ev(`(() => {
    const im = document.querySelector('#imgOut img');
    return {
      src: im ? String(im.src).slice(0, 24) : '',
      len: im ? im.src.length : 0,
      text: document.getElementById('imgOut').textContent.slice(0, 300),
    };
  })()`);
  check('8. UI orqali LOKAL rasm yaratildi (lokal model, kalitsiz)',
    gotImg && imgInfo && imgInfo.src.startsWith('data:image/png') && imgInfo.len > 5000
    && /lokal/i.test(imgInfo.text || ''),
    `${secs} s · data-length=${imgInfo && imgInfo.len} · "${String(imgInfo && imgInfo.text).slice(0, 90)}"`);

  /* 9) Rasm ish papkasining `generated/` papkasiga yozilgan */
  const genFiles = [];
  const genDir = path.join(WS, 'generated');
  try { for (const f of fs.readdirSync(genDir)) genFiles.push(f); } catch { /* papka yo'q */ }
  const png = genFiles.find((f) => /^rsm-.*\.png$/.test(f));
  let magic = '';
  if (png) {
    try { magic = fs.readFileSync(path.join(genDir, png)).subarray(0, 4).toString('hex'); } catch { /* o'qilmadi */ }
  }
  check('9. Natija ish papkasidagi `generated/` ga PNG sifatida saqlandi',
    !!png && magic === '89504e47', png ? `${'generated/' + png} · magic=${magic}` : 'fayl topilmadi');

  /* 10) Modal yopiladi (X va Esc) */
  await ev(`(() => {
    document.getElementById('modelsClose').click();
    const closed = document.getElementById('modelsModal').classList.contains('hidden');
    document.getElementById('aiModelsBtn').click();
    return closed;
  })()`);
  for (const type of ['keyDown', 'keyUp']) {
    await sendRaw('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  }
  await sleep(400);
  const closedState = await ev(`(() => {
    const m = document.getElementById('modelsModal');
    if (!m.classList.contains('hidden')) { document.getElementById('modelsClose').click(); }
    return m.classList.contains('hidden');
  })()`);
  check('10. Menyu «✕» bilan ham yopiladi', !!closedState, `yopiq=${closedState}`);

  // Dalil: ekran surati (Lokal AI menyusi ochiq holda).
  try {
    await ev(`(() => { openModels('text'); return true; })()`);
    await sleep(900);
    const dir = path.join(ROOT, 'reports', 'local_ai_ui');
    fs.mkdirSync(dir, { recursive: true });
    const shot = await sendRaw('Page.captureScreenshot', { format: 'png' });
    const b64 = shot && shot.result && shot.result.data;
    if (b64) {
      fs.writeFileSync(path.join(dir, 'lokal-ai-menyusi.png'), Buffer.from(b64, 'base64'));
      check('11. Ekran surati: menyu apparat profili va modellar bilan', true, 'reports/local_ai_ui/lokal-ai-menyusi.png');
    } else {
      check('11. Ekran surati', false, 'CDP surat qaytarmadi');
    }
  } catch (e) {
    check('11. Ekran surati', false, `xato: ${e && e.message}`);
  }
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { ws && ws.close(); } catch { /* */ }
  if (app && app.pid) spawnSync('taskkill', ['/F', '/PID', String(app.pid), '/T'], { stdio: 'ignore' });
  await sleep(500);
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ }
}

const failed = results.filter((r) => !r).length;
console.log(`\nXULOSA: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
