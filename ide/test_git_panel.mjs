// ide/test_git_panel.mjs — Git paneli mantig'ini HAQIQIY git repo ustida sinaydi.
//   node ide/test_git_panel.mjs
//
// Nega oddiy node (electron emas): `ide/ide_git.js` mantiqi SOF funksiyalarda — git
// buyruqlari `spawnSync` bilan ishlaydi, electron faqat IPC qatlamida (dinamik `require`).
// Sinov vaqtinchalik papkada haqiqiy repo yaratadi va o'sha yerda status/stage/commit/diff
// ni o'lchaydi (fayl matnini emas, HAQIQIY git javobini o'qiydi). Natija
// `reports/ide_git_panel.log` ga ham yoziladi — keyin ko'rish uchun dalil bo'lib qoladi.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isRepo, gitStatus, gitDiff, gitStage, gitUnstage, gitCommit, gitLog } from './ide_git.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = [];
let failed = 0;
let total = 0;

function check(name, ok, evidence) {
  total += 1;
  if (!ok) failed += 1;
  const out = `${ok ? 'PASS' : 'FAIL'}  ${name}\n      → ${evidence}`;
  lines.push(out);
  console.log(out);
}

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-gitpanel-'));
const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'yang-gitpanel-plain-'));
let ok = true;

try {
  // --- Repo tayyorlash ---
  const init = git(work, ['init']);
  git(work, ['config', 'user.email', 'sinov@yang.ai']);
  git(work, ['config', 'user.name', 'YANG Sinov']);
  git(work, ['config', 'commit.gpgsign', 'false']);
  check('0. Vaqtinchalik git repo yaratildi', init.status === 0 && isRepo(work),
    `git init → ${init.status} · isRepo(${path.basename(work)}) = ${isRepo(work)}`);

  // --- A. Kuzatilmagan fayl ---
  fs.writeFileSync(path.join(work, 'birinchi.txt'), 'salom\n');
  let st = gitStatus(work);
  const untracked = st.files?.find((f) => f.path === 'birinchi.txt');
  check('A1. Yangi fayl `??` (kuzatilmagan) sifatida ko‘rinadi',
    !!untracked && untracked.untracked === true && untracked.staged === false && st.counts.untracked === 1,
    `fayllar=[${(st.files || []).map((f) => f.index + f.worktree + ':' + f.path).join(', ')}] · hisob=${JSON.stringify(st.counts)}`);

  // --- B. Stage ---
  const staged = gitStage(work, ['birinchi.txt']);
  const afterStage = (staged.files || []).find((f) => f.path === 'birinchi.txt');
  check('B1. `gitStage` faylni indeksga qo‘yadi (stage holati yangilanadi)',
    !!(staged && staged.ok) && !!afterStage && afterStage.staged === true && afterStage.index === 'A'
    && staged.counts.staged === 1 && staged.counts.untracked === 0,
    `ok=${!!(staged && staged.ok)} · index='${afterStage && afterStage.index}' · staged=${afterStage && afterStage.staged} · hisob=${JSON.stringify(staged.counts || null)}`);

  // --- C. Staged diff (commit'ga tayyor o'zgarish) ---
  const diffStaged = gitDiff(work, { path: 'birinchi.txt', staged: true });
  check('C1. Staged diff yangi fayl qatorlarini ko‘rsatadi (+)',
    !!(diffStaged && diffStaged.ok) && /\+salom/.test(diffStaged.diff || '') && diffStaged.truncated === false,
    `diff qatorlari=${String(diffStaged.diff || '').split('\n').length} · +salom=${/\+salom/.test(diffStaged.diff || '')} · truncated=${diffStaged.truncated}`);

  // --- D. Commit ---
  const commit = gitCommit(work, 'birinchi fayl qo‘shildi');
  const log = gitLog(work, 5);
  check('D1. `gitCommit` commit yaratadi va `gitLog` uni ko‘rsatadi',
    !!(commit && commit.ok) && /^[0-9a-f]{7,}$/.test(commit.hash || '')
    && (log.commits || [])[0]?.subject === 'birinchi fayl qo‘shildi'
    && commit.counts.staged === 0 && commit.counts.untracked === 0,
    `hash=${commit.hash} · log[0]="${(log.commits || [])[0]?.subject}" · muallif=${(log.commits || [])[0]?.author} · commit'dan keyingi hisob=${JSON.stringify(commit.counts)}`);

  // --- E. O'zgartirilgan fayl diff'i (unstaged) ---
  fs.writeFileSync(path.join(work, 'birinchi.txt'), 'salom\nxayr\n');
  const diffWork = gitDiff(work, { path: 'birinchi.txt' });
  st = gitStatus(work);
  const modified = (st.files || []).find((f) => f.path === 'birinchi.txt');
  check('E1. O‘zgargan fayl «M» va diff’da -/+ qatorlari bor',
    !!modified && modified.worktree === 'M' && modified.staged === false
    && /\+xayr/.test(diffWork.diff || '') && /-salom| salom/.test(diffWork.diff || ''),
    `worktree='${modified && modified.worktree}' · staged=${modified && modified.staged} · +xayr=${/\+xayr/.test(diffWork.diff || '')}`);

  // --- F. Unstage ---
  gitStage(work, ['birinchi.txt']);
  const unstaged = gitUnstage(work, ['birinchi.txt']);
  const afterUnstage = (unstaged.files || []).find((f) => f.path === 'birinchi.txt');
  check('F1. `gitUnstage` faylni indeksdan chiqaradi (o‘zgarish diskda qoladi)',
    !!(unstaged && unstaged.ok) && !!afterUnstage && afterUnstage.staged === false && afterUnstage.worktree === 'M'
    && fs.readFileSync(path.join(work, 'birinchi.txt'), 'utf8').includes('xayr'),
    `staged=${afterUnstage && afterUnstage.staged} · worktree='${afterUnstage && afterUnstage.worktree}' · diskda "xayr" bor=${fs.readFileSync(path.join(work, 'birinchi.txt'), 'utf8').includes('xayr')}`);

  // --- G. XAVFSIZLIK: ish papkasidan chiqish ---
  const escapes = [
    ['../birinchi.txt', gitStage(work, ['../birinchi.txt'])],
    ['../../etc/passwd', gitStage(work, ['../../etc/passwd'])],
    ['..\\..\\Windows\\win.ini', gitStage(work, ['..\\..\\Windows\\win.ini'])],
    ['C:\\Windows\\win.ini', gitStage(work, ['C:\\Windows\\win.ini'])],
    ['/etc/passwd (diff)', gitDiff(work, { path: '/etc/passwd' })],
  ];
  const allBlocked = escapes.every(([, r]) => !!(r && r.error));
  check('G1. Ish papkasidan chiqadigan har qanday yo‘l RAD etiladi (5 ta urinish)',
    allBlocked,
    escapes.map(([n, r]) => `${n}: ${(r && r.error) || 'O‘TDIII!'}`).join(' | '));

  // --- H. Xato holatlari: bo'sh xabar, commit'siz commit, repo bo'lmagan papka ---
  const emptyMsg = gitCommit(work, '   ');
  const nothing = gitCommit(work, 'bo‘sh commit');
  const notRepo = gitStatus(plain);
  check('H1. Bo‘sh xabar, o‘zgarishsiz commit va repo bo‘lmagan papka — aniq xato qaytadi',
    /commit xabari bo‘sh/.test((emptyMsg && emptyMsg.error) || '')
    && /o‘zgarish yo‘q/.test((nothing && nothing.error) || '')
    && /Git repozitori emas/.test((notRepo && notRepo.error) || ''),
    `bo‘sh xabar="${(emptyMsg && emptyMsg.error) || ''}" · o‘zgarishsiz="${(nothing && nothing.error) || ''}" · repo emas="${(notRepo && notRepo.error) || ''}"`);

  // --- I. Katta diff kesiladi (panel osilib qolmasin) ---
  fs.writeFileSync(path.join(work, 'katta.txt'), Array.from({ length: 3000 }, (_, i) => `qator-${i}`).join('\n') + '\n');
  gitStage(work, ['katta.txt']);
  gitCommit(work, 'katta fayl');
  fs.writeFileSync(path.join(work, 'katta.txt'), Array.from({ length: 3000 }, (_, i) => `qator-${i}-ozgardi`).join('\n') + '\n');
  const big = gitDiff(work, { path: 'katta.txt' });
  check('I1. 5000 qatordan katta diff kesiladi (`truncated: true`)',
    !!(big && big.ok) && big.truncated === true && String(big.diff).split('\n').length === 5000,
    `qatorlar=${String(big.diff).split('\n').length} · truncated=${big.truncated} · bayt=${String(big.diff).length}`);

  // --- J. Tarix chegarasi ---
  const capped = gitLog(work, 1000);
  check('J1. `gitLog` chegarasi (1..200) ushlab turiladi',
    !!(capped && capped.ok) && capped.commits.length === 2,
    `commits=${capped.commits.length} (limit=1000 → 200 ga cheklandi) · eng yangisi="${capped.commits[0]?.hash} ${capped.commits[0]?.subject}"`);
} catch (e) {
  ok = false;
  check('umumiy oqim', false, `kutilmagan xato: ${e && e.message}`);
} finally {
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* */ }
  try { fs.rmSync(plain, { recursive: true, force: true }); } catch { /* */ }
}

const summary = `\nXULOSA: ${total - failed}/${total} PASS${failed || !ok ? ' — YIQILDI' : ''}\n`;
lines.push(summary.trim());
console.log(summary);
try {
  const outDir = path.join(ROOT, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ide_git_panel.log'), `git paneli sinovi (haqiqiy repo)\n\n${lines.join('\n')}\n`);
} catch { /* jurnal yozilmasa ham sinov natijasi muhim */ }
if (failed || !ok) process.exitCode = 1;
