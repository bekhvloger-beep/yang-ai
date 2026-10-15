// ide_git.js — IDE ichidagi Git paneli: status · diff · stage/unstage · commit · log.
//
// Nega alohida modul: git buyruqlari `spawnSync` bilan sinxron chaqiriladi va natija
// renderer'ga SOF ma'lumot sifatida uzatiladi (tayyor HTML emas, xom obyekt). Shu tufayli
// hamma mantiq electron'siz — oddiy node'da HAQIQIY git repo ustida sinovdan o'tadi
// (`ide/test_git_panel.mjs`). Electron faqat IPC qatlamida kerak, u ham dinamik
// `require` bilan olinadi — modulni node'da import qilish yiqilmaydi.
//
// XAVFSIZLIK (loyihadagi boshqa modullar bilan bir xil qoida):
//   • har bir yo'l ish papkasi (workspace) ICHIDA bo'lishi shart — absolyut yo'l,
//     `..` bilan chiqish, boshqa ildizdagi fayl RAD etiladi;
//   • `safePath` berilgan bo'lsa (IDE'ning ildizlar ro'yxati bilan ishlaydigan
//     tekshiruvi) qo'shimcha ravishda undan ham o'tadi — ikki qavat himoya;
//   • buyruqlar SHELLSIZ chaqiriladi (`shell: false`, argumentlar massivi) — fayl
//     nomi ichidagi `;`, `&`, bo'shliq hech qachon buyruqqa aylanmaydi;
//   • commit xabari argument sifatida beriladi (`-m` dan keyin), bo'sh xabar rad etiladi.
//
// O'lchov/holat izohlari: `git diff` juda katta bo'lsa (5000 qatordan ko'p) kesiladi va
// `truncated: true` qaytadi — muzlab qolmaslik uchun. Sinxron chaqiruvga `timeout` ham
// qo'yilgan (15 s status/diff, 30 s commit): osilib qolgan git butun oynani bloklamasin.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const CH = 'yide';
const MAX_DIFF_LINES = 5000;
const MAX_COMMIT_MESSAGE = 2000;
const MAX_BUFFER = 8 * 1024 * 1024; // 8 MB — katta diff ham sig'adi (5120 qator ≈ 400 KB)

const requireCjs = createRequire(import.meta.url);

/** git buyrug'ini ishlatadi. `shell: false` — argumentlar massiv, matn buyruq emas. */
function run(cwd, args, { timeout = 15000 } = {}) {
  if (!cwd) return { error: 'ish papkasi ko‘rsatilmagan' };
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: MAX_BUFFER, timeout,
  });
  if (r.error) {
    // ENOENT — git umuman o'rnatilmagan (yoki PATH da yo'q).
    return { error: r.error.code === 'ENOENT' ? 'git topilmadi (o‘rnatilganini va PATH ni tekshiring)' : `git ishga tushmadi: ${r.error.message}` };
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const firstLine = (s) => String(s || '').trim().split(/\r?\n/)[0] || '';

/** Papka git repozitori ichidami (git o'zi aytadi, taxmin qilmaymiz). */
export function isRepo(cwd) {
  const r = run(cwd, ['rev-parse', '--is-inside-work-tree']);
  return !r.error && r.status === 0 && String(r.stdout).trim() === 'true';
}

/**
 * Berilgan yo'l ildiz ICHIDA ekanini tekshiradi.
 * @returns {{ rel: string, abs: string } | { error: string }}
 */
function guardPath(root, rel, { allowRoot = false } = {}) {
  const raw = String(rel ?? '').trim();
  if (!raw) {
    if (allowRoot) return { rel: '', abs: path.resolve(root) };
    return { error: 'yo‘l ko‘rsatilmagan' };
  }
  // Absolyut yo'l (Windows `D:\...` ham, `/` ham) — hech qachon qabul qilinmaydi.
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) return { error: `absolyut yo‘l ruxsat etilmaydi: ${raw}` };
  const abs = path.resolve(root, raw);
  const relOut = path.relative(path.resolve(root), abs);
  if (relOut === '') return allowRoot ? { rel: '', abs } : { error: `yo‘l fayl emas: ${raw}` };
  if (relOut.startsWith('..') || path.isAbsolute(relOut)) return { error: `yo‘l ish papkasi ichida emas: ${raw}` };
  return { rel: relOut.split(path.sep).join('/'), abs };
}

/**
 * `git status --porcelain=v1 -z` natijasini o'qib, fayllar ro'yxatini qaytaradi.
 * Har bir yozuv: `{ path, origPath, index, worktree, staged, untracked }`.
 * (Qayta nomlashda `-z` rejimi nomdan KEYIN eski nomni beradi — o'sha ham olinadi.)
 */
export function gitStatus(cwd) {
  if (!cwd) return { error: 'ish papkasi ko‘rsatilmagan' };
  if (!isRepo(cwd)) return { error: 'bu papka Git repozitori emas' };
  const r = run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (r.error) return { error: r.error };
  if (r.status !== 0) return { error: `git status xato: ${firstLine(r.stderr)}` };

  const parts = String(r.stdout).split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (!entry) continue;
    const index = entry[0] || ' ';
    const worktree = entry[1] || ' ';
    let origPath = null;
    if (index === 'R' || index === 'C') {
      origPath = parts[i + 1] || null; // eski nom — keyingi NUL bo'lagi
      i += 1;
    }
    const p = entry.slice(3);
    if (!p) continue;
    files.push({
      path: p,
      origPath,
      index,
      worktree,
      staged: index !== ' ' && index !== '?',
      untracked: index === '?' && worktree === '?',
    });
  }

  const branchR = run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = !branchR.error && branchR.status === 0 ? String(branchR.stdout).trim() : '';
  const counts = {
    staged: files.filter((f) => f.staged).length,
    unstaged: files.filter((f) => f.worktree !== ' ' && !f.untracked).length,
    untracked: files.filter((f) => f.untracked).length,
  };
  return { ok: true, branch, files, counts, clean: files.length === 0 };
}

/**
 * Diff matni. `staged: true` — indeksdagi (commit'ga tayyor) o'zgarishlar.
 * Katta diff kesiladi (`truncated: true`) — panel osilib qolmasin.
 */
export function gitDiff(cwd, { path: rel = '', staged = false } = {}) {
  if (!cwd) return { error: 'ish papkasi ko‘rsatilmagan' };
  if (!isRepo(cwd)) return { error: 'bu papka Git repozitori emas' };
  const g = guardPath(cwd, rel, { allowRoot: true });
  if (g.error) return g;

  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (staged) args.push('--cached');
  args.push('--', g.rel || '.');
  const r = run(cwd, args);
  if (r.error) return { error: r.error };
  if (r.status !== 0) return { error: `git diff xato: ${firstLine(r.stderr)}` };

  const all = String(r.stdout).split('\n');
  const truncated = all.length > MAX_DIFF_LINES;
  const diff = truncated ? all.slice(0, MAX_DIFF_LINES).join('\n') : all.join('\n');
  // Yangi (kuzatilmagan) fayl uchun `git diff` bo'sh chiqadi — UI shuni bilib tursin.
  const untracked = !diff.trim() && !!g.rel && gitStatus(cwd).files?.some((f) => f.path === g.rel && f.untracked);
  return { ok: true, path: g.rel, staged: !!staged, diff, truncated, untracked: !!untracked };
}

/** Yo'llar to'plamini tekshiradi (har biri ildiz ichida bo'lishi shart). */
function guardPaths(cwd, paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((p) => String(p ?? '')).filter((p) => p.trim());
  if (!list.length) return { error: 'fayl tanlanmagan' };
  const out = [];
  for (const p of list) {
    const g = guardPath(cwd, p);
    if (g.error) return g;
    out.push(g.rel);
  }
  return { rels: out };
}

/** Fayllarni indeksga qo'shadi (commit'ga tayyorlaydi) va yangi holatni qaytaradi. */
export function gitStage(cwd, paths) {
  if (!cwd) return { error: 'ish papkasi ko‘rsatilmagan' };
  if (!isRepo(cwd)) return { error: 'bu papka Git repozitori emas' };
  const g = guardPaths(cwd, paths);
  if (g.error) return g;
  const r = run(cwd, ['add', '--', ...g.rels]);
  if (r.error) return { error: r.error };
  if (r.status !== 0) return { error: `git add xato: ${firstLine(r.stderr)}` };
  const st = gitStatus(cwd);
  return { ok: true, staged: g.rels, files: st.files || [], counts: st.counts || null };
}

/** Faylni indeksdan chiqaradi (o'zgarish diskda qoladi). */
export function gitUnstage(cwd, paths) {
  if (!cwd) return { error: 'ish papkasi ko‘rsatilmagan' };
  if (!isRepo(cwd)) return { error: 'bu papka Git repozitori emas' };
  const g = guardPaths(cwd, paths);
  if (g.error) return g;
  // `git restore --staged` — 2.23+; eski git uchun `reset` zaxira yo'li.
  let r = run(cwd, ['restore', '--staged', '--', ...g.rels]);
  if (r.error || r.status !== 0) {
    const r2 = run(cwd, ['reset', '-q', 'HEAD', '--', ...g.rels]);
    if (r2.error) return { error: r2.error };
    // Bitta commit ham bo'lmasa `reset HEAD` yiqiladi — sababi ochiq aytiladi.
    if (r2.status !== 0) return { error: `git indeksdan chiqarmadi: ${firstLine((r2.stderr || r.stderr) || 'xato')}` };
    r = r2;
  }
  const st = gitStatus(cwd);
  return { ok: true, unstaged: g.rels, files: st.files || [], counts: st.counts || null };
}

/** Commit: xabar bo'sh bo'lmasin, uzunligi cheklangan. Staged o'zgarish yo'q bo'lsa — aniq xato. */
export function gitCommit(cwd, message) {
  if (!cwd) return { error: 'ish papkasi ko‘rsatilmagan' };
  if (!isRepo(cwd)) return { error: 'bu papka Git repozitori emas' };
  const msg = String(message ?? '').trim();
  if (!msg) return { error: 'commit xabari bo‘sh' };
  if (msg.length > MAX_COMMIT_MESSAGE) return { error: `commit xabari juda uzun (${msg.length} > ${MAX_COMMIT_MESSAGE} belgi)` };

  const r = run(cwd, ['commit', '-m', msg], { timeout: 30000 });
  if (r.error) return { error: r.error };
  if (r.status !== 0) {
    const all = `${r.stdout}\n${r.stderr}`;
    if (/nothing to commit|nothing added to commit|no changes added/i.test(all)) {
      return { error: 'commit uchun o‘zgarish yo‘q (avval fayllarni belgilang)' };
    }
    if (/Please tell me who you are|user\.email/i.test(all)) {
      return { error: 'git foydalanuvchisi sozlanmagan (user.name / user.email)' };
    }
    return { error: `git commit xato: ${firstLine(all)}` };
  }
  const head = run(cwd, ['log', '-1', '--pretty=format:%h|%s']);
  const [hash, summary] = !head.error && head.status === 0 ? String(head.stdout).split('|') : ['', ''];
  const st = gitStatus(cwd);
  return { ok: true, hash: hash || '', summary: summary || msg, files: st.files || [], counts: st.counts || null };
}

/** Oxirgi commitlar (panel tarixi uchun). */
export function gitLog(cwd, limit = 20) {
  if (!cwd) return { error: 'ish papkasi ko‘rsatilmagan' };
  if (!isRepo(cwd)) return { error: 'bu papka Git repozitori emas' };
  const n = Math.max(1, Math.min(200, Number(limit) || 20));
  const r = run(cwd, ['log', `-n`, String(n), '--pretty=format:%h|%an|%ad|%s', '--date=short']);
  if (r.error) return { error: r.error };
  // Commit umuman yo'q bo'lsa git xato beradi — bu xato emas, bo'sh tarix.
  if (r.status !== 0 && /does not have any commits|unknown revision|bad default revision/i.test(r.stderr)) {
    return { ok: true, commits: [], empty: true };
  }
  if (r.status !== 0) return { error: `git log xato: ${firstLine(r.stderr)}` };
  const commits = String(r.stdout).split('\n').filter(Boolean).map((line) => {
    const [hash, author, date, ...rest] = line.split('|');
    return { hash, author, date, subject: rest.join('|') };
  });
  return { ok: true, commits };
}

/* ------------------------------------------------------------------------ IPC */
let ipcRegistered = false;

/**
 * Git kanallarini ulaydi. `getWorkspace` — joriy ish papkasi, `safePath` — IDE'ning
 * ildizlar ro'yxati tekshiruvi (ixtiyoriy; berilmasa modul o'zi tekshiradi).
 * Kanallar: yide:git-status · git-diff · git-stage · git-unstage · git-commit · git-log.
 */
export function registerGitIpc({ getWorkspace = () => '', safePath = null } = {}) {
  if (ipcRegistered) return;
  ipcRegistered = true;
  // Dinamik `require`: modul oddiy node'da (testda) import qilinadigan bo'lib qolsin.
  const { ipcMain } = requireCjs('electron');
  const cwd = () => String(getWorkspace() || '');

  // `safePath` bilan qo'shimcha tekshiruv: yo'l ildizlar ro'yxati ichida bo'lishi shart.
  const guard = (p, { allowRoot = false } = {}) => {
    if (typeof safePath !== 'function') return { rel: String(p ?? '') };
    const t = safePath(p, { allowRoot });
    if (!t) return { error: `yo‘l ish papkasi ichida emas: ${String(p ?? '')}` };
    return { rel: t.rel };
  };

  ipcMain.handle(`${CH}:git-status`, () => gitStatus(cwd()));
  ipcMain.handle(`${CH}:git-diff`, (_e, args = {}) => {
    const g = guard(args.path || '', { allowRoot: true });
    if (g.error) return g;
    return gitDiff(cwd(), { path: g.rel, staged: !!args.staged });
  });
  ipcMain.handle(`${CH}:git-stage`, (_e, args = {}) => {
    const list = Array.isArray(args.paths) ? args.paths : [args.path];
    for (const p of list) { const g = guard(p); if (g.error) return g; }
    return gitStage(cwd(), list);
  });
  ipcMain.handle(`${CH}:git-unstage`, (_e, args = {}) => {
    const list = Array.isArray(args.paths) ? args.paths : [args.path];
    for (const p of list) { const g = guard(p); if (g.error) return g; }
    return gitUnstage(cwd(), list);
  });
  ipcMain.handle(`${CH}:git-commit`, (_e, args = {}) => gitCommit(cwd(), args.message));
  ipcMain.handle(`${CH}:git-log`, (_e, args = {}) => gitLog(cwd(), args.limit));
}

/**
 * Modulda fon jarayoni yo'q (hamma git chaqiruvi `spawnSync` va o'zi tugaydi), shuning
 * uchun tozalash ishi faqat holat bayrog'ini qaytaradi — boshqa modullar bilan bir xil API.
 */
export function disposeGit() {
  ipcRegistered = false;
  return { ok: true };
}
