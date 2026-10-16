// admin-desk/test_admin_desk.mjs — ADMIN DESK HAQIQATAN ISHLAYAPTIMI? (CDP orqali)
//
// Nima uchun: Admin Desk alohida Electron ilovasi; uning kodini o‘qib «ishlaydi» deyish
// yetarli emas (reliz paneli GitHub’ga, Telegram’ga va mahalliy `dist/` papkasiga tayanadi).
// Bu sinov ilovani HAQIQIY ishga tushiradi va uning o‘z IPC yuzasidan javob oladi:
//   1. oyna ochiladi va ko‘prik (contextBridge) ulanadi;
//   2. `desk:info` HAQIQIY versiyalarni beradi (Desk versiyasi + ilova versiyasi);
//   3. `release:verify` kutilgan shaklda javob beradi va SOXTA nom yasamaydi
//      (eski xato: versiya noma’lum bo‘lsa ham `YANG-AI-Setup-x.y.z.exe` «yo‘q» deb yozardi);
//   4. yon paneldagi versiya yozuvi ham HAQIQIY manbadan to‘ldiriladi;
//   5. «🚀 Reliz holati» bo‘limi chiziladi (versiya manbalari + majburiy fayllar).
//
//   node admin-desk/test_admin_desk.mjs
//
// O‘lchov natijasi `reports/admin_desk_probe.log` ga ham yoziladi.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOG = path.join(ROOT, 'reports', 'admin_desk_probe.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      → ${detail}` : ''}`;
  console.log(line);
  try { fs.appendFileSync(LOG, `${line}\n`); } catch { /* */ }
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

const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-desk-probe-'));
const PORT = await pickFreePort(9411);

try { fs.writeFileSync(LOG, `Admin Desk probe · ${new Date().toISOString()}\n`); } catch { /* */ }

const app = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`, '--disable-gpu'], {
  cwd: HERE, detached: true, stdio: 'ignore',
});
app.unref();

let ws = null;
let target = null;
// Ochilgan modal oynalar (alert/confirm). Ilova ochilishida ular CHIQMASLIGI kerak:
// o‘lchandi — eskirgan GitHub tokeni bilan `pullCfg()` «Bad credentials» oynasini ochib,
// butun panelni to‘sib qo‘yardi (hech qanday tugma bosilmasdi).
const dialogs = [];
let sendCmd = () => {};
async function attach(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find((x) => x.type === 'page' && /index\.html/.test(x.url || '') && x.webSocketDebuggerUrl);
      if (t) { target = t; break; }
    } catch { /* CDP hali ko‘tarilmagan */ }
    await sleep(500);
  }
  if (!target) throw new Error('CDP target topilmadi (oyna ochilmadi?)');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP ulanish vaqti tugadi')), 8000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP xatosi')); }, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(`${m.params.type}: ${String(m.params.message || '').slice(0, 120)}`);
      // Sinov to‘xtab qolmasin: oynani darhol yopamiz (natija hisobotda ko‘rinadi).
      sendCmd('Page.handleJavaScriptDialog', { accept: true });
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  sendCmd = (method, params = {}) => { ws.send(JSON.stringify({ id: ++seq, method, params })); };
  sendCmd('Page.enable');
  sendCmd('Runtime.enable');
  return async (expression, ms = 60000) => {
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

let ev = null;
try {
  ev = await attach();
  const title = await ev('document.title');
  const bridge = await ev('typeof window.api === "object" && typeof window.api.deskInfo === "function"');
  const domReady = await ev('!!document.getElementById("app") && !!document.getElementById("deskVersion")');
  check('1. Admin Desk oynasi ochiladi va ko‘prik (contextBridge) ulanadi',
    domReady === true && bridge === true, `sarlavha="${title || '(bo‘sh)'}", #app/#deskVersion=${domReady}, window.api.deskInfo=${bridge}`);

  // 1b. MUHIM REGRESSIYA: ochilishda modal oyna chiqib panelni to‘smasligi va renderer
  //     javob berishi kerak (o‘lchov: sodda ifoda darhol bajariladi).
  const quick = await ev('1+1', 6000);
  check('1b. Ochilishda panelni to‘sadigan MODAL oyna chiqmaydi (renderer javob beradi)',
    dialogs.length === 0 && quick === 2,
    dialogs.length ? `modal oynalar: ${dialogs.join(' | ')}` : `modal oyna yo‘q · 1+1=${quick}`);

  const info = await ev('window.api.deskInfo()');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deskPkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
  check('2. `desk:info` haqiqiy versiyalarni beradi (qattiq yozilgan matn emas)',
    !!(info && !info.error) && info.deskVersion === deskPkg.version && info.localVersion === pkg.version,
    info && info.error ? `xato: ${info.error}` : `Desk=${info.deskVersion} (package.json: ${deskPkg.version}) · ilova=${info.localVersion} (package.json: ${pkg.version}) · ${info.owner}/${info.repo} (${info.branch})`);

  // GitHub bilan aloqa: avval yengilroq chaqiruv (reliz holati) — qaysi qadam osilib
  // qolsa, xato shu yerdan ko‘rinadi (o‘lchov: vaqt hisoblanadi).
  const t0 = Date.now();
  const status = await ev('window.api.releaseStatus()', 45000).catch((e) => ({ error: e.message }));
  const statusMs = Date.now() - t0;
  check('2b. GitHub bilan aloqa ishlaydi (reliz holati javob beradi)',
    !!(status && !status.error), `${statusMs} ms · ${status && status.error ? `xato: ${status.error}` : `teg=${status.tag} · fayllar=${(status.assets || []).length}`}`);

  const t1 = Date.now();
  const verify = await ev('window.api.releaseVerify()', 60000);
  const verifyMs = Date.now() - t1;
  const keys = Object.keys(verify || {});
  const hasShape = ['repoVersion', 'localVersion', 'artifactVersion', 'versionSource', 'upToDate', 'required', 'optional', 'localArtifacts']
    .every((k) => k in (verify || {}));
  check('3. `release:verify` kutilgan shaklda javob beradi (versiya manbalari ajratilgan)',
    !!(verify && !verify.error) && hasShape,
    (verify && verify.error ? `xato: ${verify.error}` : `repo=${verify.repoVersion} · lokal=${verify.localVersion} · paketlardan=${verify.artifactVersion} · manba=${verify.versionSource} · upToDate=${verify.upToDate} · majburiy=${(verify.required || []).length} · ixtiyoriy=${(verify.optional || []).length} · mahalliy fayllar=${(verify.localArtifacts || []).length} · kalitlar=[${keys.join(', ')}]`)
    + ` · ${verifyMs} ms`);

  const allNames = [...(verify.required || []), ...(verify.optional || []), ...(verify.localArtifacts || [])]
    .map((x) => (typeof x === 'string' ? x : x && x.name) || '');
  const fake = allNames.filter((n) => /x\.y\.z/.test(n));
  check('4. Versiya noma’lum bo‘lsa SOXTA fayl nomi yasalmaydi (eski xato tuzatilgan)',
    fake.length === 0 && !(verify.required || []).some((x) => (x && x.missing) === true && !verify.hasDistribution),
    fake.length ? `soxta nomlar: ${fake.join(', ')}` : `nomlar=[${allNames.slice(0, 6).join(', ') || '—'}]`);

  // Yon panel: versiya yozuvi haqiqiy manbadan to‘ldirilganmi?
  const sidebar = await ev('document.getElementById("deskVersion").textContent');
  check('5. Yon paneldagi versiya HAQIQIY manbadan (Desk + ilova versiyasi)',
    !!sidebar && sidebar.includes(deskPkg.version) && sidebar.includes(pkg.version),
    `yozuv="${String(sidebar).trim()}" (kutilgan: ${deskPkg.version} va ${pkg.version})`);

  // Reliz bo'limini ochib, chizilganini ko'ramiz (foydalanuvchi ko'radigan yuza).
  await ev('(() => { const b = [...document.querySelectorAll("#nav .nav-btn")].find((x) => x.dataset.tab === "release"); if (b) b.click(); return true; })()');
  await sleep(1200);
  const releaseText = await ev('document.getElementById("tab-release").innerText');
  check('6. «Reliz holati» bo‘limi chiziladi (versiya manbalari ko‘rinadi)',
    !!releaseText && releaseText.length > 60 && /versiya|Versiya|reliz|Reliz/i.test(releaseText),
    `bo‘lim matni (${String(releaseText || '').length} belgi): ${String(releaseText || '').replace(/\s+/g, ' ').slice(0, 220)}`);
  // v5.6: «Lokal AI» bo‘limi — katalog boshqaruvi (qo‘shish/o‘chirish/tahrirlash + nashr)
  // chiziladimi va mahalliy katalog HAQIQATAN o‘qiladimi (yangi IPC ishlayaptimi).
  await ev('(() => { const b = [...document.querySelectorAll("#nav .nav-btn")].find((x) => x.dataset.tab === "models"); if (b) b.click(); return true; })()');
  await sleep(1500);
  const modelsSec = await ev(`(() => {
    const sec = document.getElementById('tab-models');
    return {
      active: !!sec && sec.classList.contains('active'),
      list: !!document.getElementById('modelsList'),
      pull: !!document.getElementById('modelsPullBtn'),
      add: !!document.getElementById('modelsAddBtn'),
      push: !!document.getElementById('modelsPushBtn'),
      preview: !!document.getElementById('modelsPreview'),
      text: ((sec && sec.innerText) || '').replace(/\\s+/g, ' ').slice(0, 180),
    };
  })()`);
  const localCat = await ev('window.api.catalogLocal()', 20000).catch((e) => ({ error: e.message }));
  let catItems = -1;
  try { catItems = JSON.parse(localCat.text).items.length; } catch { /* o‘qilmadi */ }
  check('7. «Lokal AI» bo‘limi chiziladi va mahalliy katalogni haqiqatan o‘qiy oladi',
    !!(modelsSec && modelsSec.active && modelsSec.list && modelsSec.pull && modelsSec.add && modelsSec.push && modelsSec.preview)
    && !!(localCat && !localCat.error && localCat.valid && catItems > 0),
    `bo‘lim=${!!modelsSec.active} · ro‘yxat=${!!modelsSec.list} · tugmalar=${modelsSec.pull && modelsSec.add && modelsSec.push} · katalog yozuvlari=${catItems} (${localCat && localCat.valid ? 'JSON to‘g‘ri' : 'JSON XATO'})`);
} catch (e) {
  check('umumiy oqim', false, `xato: ${e && e.message}`);
} finally {
  try { ws && ws.close(); } catch { /* */ }
  const pid = app && app.pid;
  if (pid) spawnSync('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore' });
  try { fs.rmSync(UD, { recursive: true, force: true }); } catch { /* */ }
}

const failed = results.filter((r) => !r).length;
const summary = `\nXULOSA: ${results.length - failed}/${results.length} PASS`;
console.log(summary);
try { fs.appendFileSync(LOG, `${summary}\n`); } catch { /* */ }
process.exit(failed ? 1 : 0);
