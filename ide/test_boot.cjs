// ide/test_boot.cjs — IDE oynasini haqiqiy Electron'da ochib tekshiradi.
//
// Nima uchun: statik kontrakt testi (ide/test_ide_contract.mjs) faqat matn mosligini
// tekshiradi. Bu test haqiqiy renderer'ni yuklaydi va HAQIQIY fayl ochib, to'ldirilgan
// muharrir geometriyasini o'lchaydi:
//   1) sahifa xatosiz yuklanadimi (preload ko'prigi ishlayaptimi),
//   2) muharrir nolga teng emasmi va qator raqamlari kod ustiga tushmayaptimi,
//   3) <pre> qatlami <textarea> bilan bir nuqtadan boshlanadimi (kursor surilmaydimi),
//   4) skrinshot odam ko'zi bilan ko'rish uchun faylga yoziladi.
//
// MPI muhim: bu test haqiqiy ide/main.js ni ko'tarmaydi (aks holda oyna ko'rsatilishi va
// fayl tizimiga tegishi kerak bo'lardi). Shuning uchun kanallarga STUB handler qo'yiladi.
// Handler'lar haqiqatan mavjudligini alohida `ide/test_ide_contract.mjs` tekshiradi.
//
// Ishga tushirish:  npx electron ide/test_boot.cjs
// Natija:           reports/ide_boot/ide-boot.png  + konsolga PASS/FAIL.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HERE = __dirname;
const OUT_DIR = path.resolve(HERE, '..', 'reports', 'ide_boot');
const RESULTS = [];
const errors = [];

function check(label, ok, detail = '') {
  RESULTS.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------- sinov maydoni
const SAMPLE = [
  'def factorial(n):',
  '    """n! ni qaytaradi."""',
  '    acc = 1',
  '    for i in range(1, n + 1):',
  '        acc *= i',
  '    return acc',
  '',
  'print(factorial(5))',
  '',
].join('\n');

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-ide-boot-'));
  fs.writeFileSync(path.join(dir, 'sample.py'), SAMPLE, 'utf8');
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Sarlavha\n\nMatn.\n', 'utf8');
  return dir;
}

const workspace = makeWorkspace();

function registerStubs() {
  ipcMain.handle('yide:init', () => ({
    workspace: { path: workspace, name: path.basename(workspace) },
    recent: [workspace],
    tabs: ['sample.py'],
  }));
  ipcMain.handle('yide:sys-info', () => ({
    platform: process.platform, electron: process.versions.electron, node: process.versions.node,
    cpus: os.cpus().length, ramMb: Math.round(os.totalmem() / 1024 ** 2), version: 'test', localModel: null, localStarted: false,
  }));
  ipcMain.handle('yide:list-tree', () => ({
    entries: [
      { path: 'notes.md', dir: false, size: 18 },
      { path: 'sample.py', dir: false, size: SAMPLE.length },
    ],
  }));
  ipcMain.handle('yide:read-file', (_e, { path: p } = {}) => {
    const abs = path.join(workspace, String(p || ''));
    if (!fs.existsSync(abs)) return { error: 'topilmadi' };
    const text = fs.readFileSync(abs, 'utf8');
    return { text, size: text.length, truncated: false, path: p };
  });
  ipcMain.handle('yide:diagnostics', () => ({ items: [], note: null }));
  ipcMain.handle('yide:ai-status', () => ({ provider: 'localmini', model: 'qwen3-instruct', providers: [{ id: 'localmini', name: 'Lokal', models: ['qwen3-instruct'] }] }));
  ipcMain.handle('yide:save-tabs', () => ({ ok: true }));
  ipcMain.handle('yide:error-links', () => ({ links: [] }));
  ipcMain.handle('yide:search', () => ({ results: [] }));
  ipcMain.handle('yide:write-file', () => ({ ok: true }));
  ipcMain.handle('yide:ai-set-model', () => ({ ok: true }));
  ipcMain.handle('yide:pick-folder', () => ({ canceled: true }));
  ipcMain.handle('yide:open-folder', () => ({ path: workspace, name: path.basename(workspace) }));
  ipcMain.handle('yide:create', () => ({ ok: true }));
  ipcMain.handle('yide:rename', () => ({ ok: true }));
  ipcMain.handle('yide:delete', () => ({ ok: true }));
  ipcMain.handle('yide:open-external', () => ({ ok: true }));
  ipcMain.handle('yide:run-command', () => ({ id: 'stub', cwd: workspace }));
  ipcMain.handle('yide:run-file', () => ({ id: 'stub', cwd: workspace, command: 'echo' }));
  ipcMain.handle('yide:kill-command', () => ({ ok: true }));
  ipcMain.handle('yide:ai-run', () => ({ ok: true }));
  ipcMain.handle('yide:ai-stop', () => ({ ok: true }));

  // --- cheklovlarsiz qatlam (PTY, til xizmati, debugger, yurish tarixi) ---
  // Renderer ishga tushishda shu kanallarni ham chaqiradi. Stub'lar qo'lda yozilgani
  // uchun ular orqada qolib, konsolda "No handler registered for 'yide:pty-info'"
  // kabi xatolar chiqardi ("konsol xatolari yo'q" tekshiruvi shu sababdan yiqilardi).
  ipcMain.handle('yide:pty-info', () => ({ available: false, reason: 'sinov stubi' }));
  ipcMain.handle('yide:pty-open', () => ({ error: 'sinov stubi' }));
  ipcMain.handle('yide:lsp-status', () => ({ available: false, reason: 'sinov stubi' }));
  ipcMain.handle('yide:run-log', () => ({ runs: [], lastFailure: null }));
  ipcMain.handle('yide:debug-status', () => ({ running: false }));
  ipcMain.handle('yide:fix-busy', () => ({ busy: false }));

  // Qolgan kanallar preload'dan o'qib olinadi — yangi kanal qo'shilsa, test o'zi
  // qoplaydi va yana "handler yo'q" xatosi bilan yiqilmaydi.
  const preloadSrc = fs.readFileSync(path.join(HERE, 'preload.cjs'), 'utf8');
  const channels = [...preloadSrc.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]);
  let auto = 0;
  for (const ch of channels) {
    try { ipcMain.handle(ch, () => ({})); auto += 1; } catch { /* allaqachon qo'yilgan */ }
  }
  console.log(`  ${auto} ta kanal uchun zaxira (bo'sh) stub qo'yildi — preload'dan o'qildi`);
}

app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  registerStubs();
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false, backgroundColor: '#0b0d12',
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`renderer gone: ${d.reason}`));

  // Qo'riqchi: biror bosqich osilib qolsa, test abadiy qotib qolmasin.
const watchdog = setTimeout(() => {
  console.log('\nWATCHDOG: test 90 s ichida tugamadi — majburan to‘xtatildi');
  process.exit(1);
}, 90000);
watchdog.unref?.();

console.log('YANG IDE boot testi');
  try {
    await win.loadFile(path.join(HERE, 'renderer', 'index.html'));
  } catch (e) {
    check('Sahifa yuklandi', false, e.message);
  }
  // boot(): init → listTree → openTab → paint. Kechikish bilan kutamiz.
  await new Promise((r) => setTimeout(r, 2500));

  const probe = await win.webContents.executeJavaScript(`(() => {
    const q = (id) => document.getElementById(id);
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const area = q('editorArea'), hl = q('highlight'), gutter = q('gutter'), pane = q('editorPane');
    const cs = (el) => { const s = getComputedStyle(el); return { font: s.fontFamily, size: s.fontSize, lh: s.lineHeight, pt: s.paddingTop, pos: s.position, color: s.color }; };
    return {
      title: document.title,
      bridge: typeof window.ide === 'object' && window.ide !== null,
      bridgeKeys: window.ide ? Object.keys(window.ide).length : 0,
      hasStyleSheet: [...document.styleSheets].some((s) => (s.href || '').includes('style.css')),
      injectedStyles: document.querySelectorAll('style').length,
      paneVisible: !!pane && !pane.classList.contains('hidden'),
      body: rect(document.body),
      pane: pane ? rect(pane) : null,
      area: area ? rect(area) : null,
      hl: hl ? rect(hl) : null,
      gutter: gutter ? rect(gutter) : null,
      areaCss: area ? cs(area) : null,
      hlCss: hl ? cs(hl) : null,
      areaValue: area ? area.value.slice(0, 30) : null,
      hlHtml: hl ? hl.innerHTML.slice(0, 120) : null,
      gutterLines: gutter ? gutter.querySelectorAll('.gline').length : 0,
      gutterText: gutter ? gutter.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30) : '',
      tabCount: q('tabs') ? q('tabs').children.length : 0,
      treeRows: q('fileTree') ? q('fileTree').querySelectorAll('.tree-row').length : 0,
      status: q('statusLeft') ? q('statusLeft').textContent : '',
      cursor: q('cursorPos') ? q('cursorPos').textContent : '',
      lang: q('langLabel') ? q('langLabel').textContent : '',
      panels: ['titlebar','sidebar','editorWrap','bottomPanel','statusBar'].filter((id) => q(id)).length,
    };
  })()`);

  check('Sahifa yuklandi va title to‘g‘ri', probe.title === 'YANG IDE', probe.title);
  check('preload ko‘prigi (window.ide) mavjud', probe.bridge, `${probe.bridgeKeys} ta metod`);
  check('tashqi CSS fayl ulangan', probe.hasStyleSheet);
  check('renderer o‘z <style> blokini kiritmaydi', probe.injectedStyles === 0, `style soni: ${probe.injectedStyles}`);
  check('asosiy panellar mavjud (5/5)', probe.panels === 5, `${probe.panels}/5`);
  check('oyna o‘lchami mantiqiy', probe.body.w >= 1000 && probe.body.h >= 600, `${Math.round(probe.body.w)}×${Math.round(probe.body.h)}`);
  check('fayl daraxti chizildi', probe.treeRows >= 2, `${probe.treeRows} qator`);
  check('saqlangan tab tiklandi', probe.tabCount === 1, `${probe.tabCount} tab`);
  check('muharrir ochiq va fayl yuklangan', probe.paneVisible && /def factorial/.test(String(probe.areaValue)), String(probe.areaValue || '').slice(0, 24));
  check('qator raqamlari chizildi', probe.gutterLines >= 8, `${probe.gutterLines} qator raqami`);
  check('sintaksis bo‘yalishi ishlaydi (.tk-* tokenlar)', /class="tk-/.test(String(probe.hlHtml)), String(probe.hlHtml || '').slice(0, 60));
  check('holat qatori kursor/tilni ko‘rsatadi', /Ln \d+/.test(String(probe.cursor)) && String(probe.lang) === 'Python', `${probe.cursor} · ${probe.lang}`);

  if (probe.area && probe.hl && probe.gutter) {
    check('muharrir va qatlamlar nolga teng emas', probe.area.w > 100 && probe.area.h > 100,
      `editor ${Math.round(probe.area.w)}×${Math.round(probe.area.h)}`);
    check('kod qator raqamlari ostida qolmaydi (gutter chapda)',
      probe.area.x >= probe.gutter.x + probe.gutter.w - 1,
      `gutter ${Math.round(probe.gutter.x)}..${Math.round(probe.gutter.x + probe.gutter.w)} → editor x=${Math.round(probe.area.x)}`);
    check('bo‘yalgan qatlam <pre> textarea bilan bir nuqtadan boshlanadi',
      Math.abs(probe.hl.x - probe.area.x) < 0.6 && Math.abs(probe.hl.y - probe.area.y) < 0.6,
      `pre ${probe.hl.x.toFixed(1)},${probe.hl.y.toFixed(1)} vs area ${probe.area.x.toFixed(1)},${probe.area.y.toFixed(1)}`);
    check('matn metrikasi bir xil (shrift / o‘lcham / satr balandligi)',
      probe.hlCss.font === probe.areaCss.font && probe.hlCss.size === probe.areaCss.size && probe.hlCss.lh === probe.areaCss.lh,
      `${probe.areaCss.size} / lh ${probe.areaCss.lh}`);
    check('yuqori padding mos (bo‘yalgan matn surilmaydi)',
      probe.hlCss.pt === probe.areaCss.pt, `pre ${probe.hlCss.pt} = area ${probe.areaCss.pt}`);
  } else {
    check('muharrir elementlari mavjud', false, 'editorArea/highlight/gutter topilmadi');
  }

  // ---- JAMOA REJIMI UI: haqiqiy renderer team hodisalarini ko‘rsatadimi ----
  await win.webContents.executeJavaScript(`document.getElementById('aiToggleBtn').click(); true;`);
  win.webContents.send('yide:ai-event', { type: 'team_plan', agents: [
    { name: 'Coder', role: 'dasturchi', icon: '👨‍💻', task: 'app.py yozish' },
    { name: 'QA', role: 'tester', icon: '🧪', task: 'testlarni yozish' },
  ] });
  win.webContents.send('yide:ai-event', { type: 'team_assign', agent: 'Coder', provider: 'Lokal', model: 'qwen3-instruct' });
  win.webContents.send('yide:ai-event', { type: 'agent_begin', name: 'Coder', role: 'dasturchi', icon: '👨‍💻', model: 'Lokal · qwen3-instruct' });
  win.webContents.send('yide:ai-event', { type: 'agent_end', name: 'Coder', role: 'dasturchi', icon: '👨‍💻', summary: 'app.py tayyor' });
  win.webContents.send('yide:ai-event', { type: 'team_done', summary: 'Jamoa yakunladi: 2 fayl.' });
  win.webContents.send('yide:ai-event', { type: 'done', content: 'Jamoa yakunladi: 2 fayl.' });
  win.webContents.send('yide:ai-event', { type: 'run_finished' });
  await new Promise((r) => setTimeout(r, 600));

  const teamProbe = await win.webContents.executeJavaScript(`(() => {
    const log = document.getElementById('aiLog');
    const text = log ? log.textContent : '';
    return {
      panelOpen: !document.getElementById('aiPanel').classList.contains('hidden'),
      hasPlan: text.includes('Jamoa tuzildi') && text.includes('Coder'),
      hasAssign: text.includes('Coder → Lokal'),
      hasBegin: text.includes('▶'),
      hasEnd: text.includes('Coder tugatdi'),
      hasDone: text.includes('Jamoa yakunladi'),
      doneCount: (text.match(/Jamoa yakunladi/g) || []).length,
      busyCleared: document.getElementById('statusLeft') !== null,
    };
  })()`);

  check('AI paneli ochiladi', teamProbe.panelOpen);
  check('team_plan: jamoa tarkibi ko‘rinadi', teamProbe.hasPlan);
  check('team_assign: agent → model ko‘rinadi', teamProbe.hasAssign);
  check('agent_begin: agent boshlanishi ko‘rinadi', teamProbe.hasBegin);
  check('agent_end: agent yakuni va hisoboti ko‘rinadi', teamProbe.hasEnd);
  check('team_done: yakuniy xulosa BIR MARTA chiqadi', teamProbe.hasDone && teamProbe.doneCount === 1, `${teamProbe.doneCount} marta`);

  check('konsol xatolari yo‘q', errors.length === 0, errors.slice(0, 3).join(' | '));

  // Yashirin oynada capturePage() osilib qolishi mumkin — ko'rinmas tarzda ko'rsatamiz.
  try {
    win.showInactive();
    await new Promise((r) => setTimeout(r, 700));
    const shot = await Promise.race([
      win.webContents.capturePage(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('capturePage timeout')), 15000)),
    ]);
    fs.writeFileSync(path.join(OUT_DIR, 'ide-boot.png'), shot.toPNG());
    console.log(`  skrinshot: ${path.join(OUT_DIR, 'ide-boot.png')}`);
  } catch (e) {
    console.log(`  skrinshot olinmadi: ${e.message}`);
  }

  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}

  const failed = RESULTS.filter((r) => !r.ok);
  console.log(`\n${RESULTS.length - failed.length}/${RESULTS.length} tekshiruv o‘tdi`);
  if (failed.length) console.log(`YIQILDI: ${failed.map((f) => f.label).join('; ')}`);
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => app.quit(), 200);
});

app.on('window-all-closed', () => app.quit());
