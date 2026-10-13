// admin-desk/main.js — YANG Admin Desk: savollar inbox'i, javob, bloklash,
// reklama/e'lon nashri (GitHub app-config.json orqali) va statistika.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = { owner: 'bekhvloger-beep', repo: 'yang-ai', branch: 'main', file: 'app-config.json' };
const RAW_URL = (s) => `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${s.branch}/${s.file}`;

let win = null;
let admin = { botToken: '', adminChatId: '', ghToken: '', owner: DEFAULT_REPO.owner, repo: DEFAULT_REPO.repo, branch: DEFAULT_REPO.branch };
let offset = 0;

async function loadAdmin() {
  const file = path.join(app.getPath('userData'), 'admin-config.json');
  try {
    const j = JSON.parse(await fsp.readFile(file, 'utf8'));
    admin = { ...admin, ...j };
    offset = j.offset || 0;
  } catch {}
  // Eski/dev papka (yang-admin-desk) — bo'sh maydonlarni undan to'ldirib olamiz.
  try {
    if (!admin.botToken || !admin.ghToken || !admin.adminChatId) {
      const legacy = path.join(app.getPath('appData'), 'yang-admin-desk', 'admin-config.json');
      const j2 = JSON.parse(await fsp.readFile(legacy, 'utf8'));
      for (const k of ['botToken', 'adminChatId', 'ghToken', 'owner', 'repo', 'branch']) {
        if (!admin[k] && j2[k]) admin[k] = j2[k];
      }
    }
  } catch {}
}
async function saveAdmin() {
  const file = path.join(app.getPath('userData'), 'admin-config.json');
  await fsp.writeFile(file, JSON.stringify({ ...admin, offset }), 'utf8');
}

async function inboxPath() {
  return path.join(app.getPath('userData'), 'inbox.json');
}
async function loadInbox() {
  try {
    return JSON.parse(await fsp.readFile(await inboxPath(), 'utf8'));
  } catch {
    return [];
  }
}
async function saveInbox(list) {
  await fsp.writeFile(await inboxPath(), JSON.stringify(list.slice(-500), null, 2), 'utf8');
}

// ---------- Telegram ----------
function tgCall(method, body) {
  return fetch(`https://api.telegram.org/bot${admin.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20000),
  }).then((r) => r.json());
}

async function tgNotify(text) {
  if (!admin.botToken || !admin.adminChatId) return false;
  try {
    const j = await tgCall('sendMessage', { chat_id: Number(admin.adminChatId), text: String(text).slice(0, 3500) });
    return !!j.ok;
  } catch {
    return false;
  }
}

function parseMessage(msg) {
  const text = String(msg.text || msg.caption || '');
  let kind = 'other';
  let installId = null;
  const idm = text.match(/^ID:\s*(\S+)/m);
  if (text.startsWith('📨')) kind = 'question';
  else if (text.startsWith('📊') || text.startsWith('🆕')) kind = 'stat';
  if (idm) installId = idm[1];
  return {
    update_id: msg.update_id,
    ts: (msg.date || Math.floor(Date.now() / 1000)) * 1000,
    chatId: msg.chat && msg.chat.id,
    fromId: msg.from && msg.from.id,
    from: (msg.from && (msg.from.username ? '@' + msg.from.username : msg.from.first_name)) || '—',
    own: !!(msg.from && admin.adminChatId && String(msg.from.id) === String(admin.adminChatId)),
    kind,
    installId,
    messageId: msg.message_id,
    text: text.slice(0, 1500),
    answered: false,
  };
}

async function pollTelegram() {
  if (!admin.botToken) return { ok: false, error: 'botToken yo\u2018q' };
  const j = await tgCall('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
  if (!j.ok) return { ok: false, error: j.description || 'getUpdates xato' };
  const inbox = await loadInbox();
  let added = 0;
  for (const u of j.result || []) {
    offset = Math.max(offset, u.update_id + 1);
    if (!u.message) continue;
    const m = parseMessage(u.message);

    // 1) ADMIN'NING TELEGRAM REPLY'I — javobni yetkazamiz
    if (m.own && u.message.reply_to_message) {
      const rt = u.message.reply_to_message;
      const rid = rt.message_id;
      // a) relay qilingan xabarlarga reply (relayMessageId orqali)
      let orig = inbox.find((x) => x.relayMessageId === rid && !x.own);
      // b) ilova savoli (bot xabari) — reply_to_message MATNIDAN installId o'qiymiz
      if (!orig) {
        const rtText = String(rt.text || '');
        const ridm = rtText.match(/^ID:\s*(\S+)/m);
        if (ridm && rtText.startsWith('📨')) orig = { installId: ridm[1], kind: 'question' };
      }
      if (!orig) orig = inbox.find((x) => x.messageId === rid && !x.own);
      if (orig && !orig.own) {
        const r = await forwardReply(orig, m.text);
        orig.answered = true;
        orig.replySent = r.ok;
        if (!inbox.some((x) => x.update_id === m.update_id)) {
          inbox.push({ ...m, answered: true, relaying: `↳ javob (${r.via || 'xato'})` });
          added++;
        }
        await saveInbox(inbox);
        await saveAdmin();
        continue;
      }
    }

    // 2) ODDIY INGEST
    if (m.kind !== 'other' || (m.text && !m.text.startsWith('/'))) {
      if (!inbox.some((x) => x.update_id === m.update_id)) {
        // 3) Foydalanuvchi botga to'g'ridan-to'g'ri yozgan bo'lsa — admin chatga relay qilamiz
        //    (admin Telegram'da shu xabarga reply qilib javob berishi uchun)
        if (!m.own && m.kind === 'other' && m.chatId && String(m.chatId) !== String(admin.adminChatId)) {
          const relay = await tgCall('sendMessage', {
            chat_id: Number(admin.adminChatId),
            text: `💬 ${m.from} (Telegram)\n\n${m.text}\n\n↩️ Javob berish uchun SHU xabarga reply qiling`,
          });
          if (relay.ok) m.relayMessageId = relay.result.message_id;
        }
        inbox.push(m);
        added++;
      }
    }
  }
  await saveInbox(inbox);
  await saveAdmin();
  return { ok: true, added, total: inbox.length };
}

// ---------- GitHub (app-config.json nashri) ----------
async function ghGet(file) {
  const url = `https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/${file}?ref=${admin.branch}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${admin.ghToken}`, accept: 'application/vnd.github+json', 'user-agent': 'yang-admin-desk' },
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json();
  if (!res.ok) return { sha: null, content: null, error: j.message || `HTTP ${res.status}` };
  return { sha: j.sha, content: Buffer.from(j.content || '', 'base64').toString('utf8') };
}

async function ghPut(file, contentJson, message) {
  const cur = await ghGet(file);
  const url = `https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/${file}`;
  const body = {
    message: message || 'Update app-config.json (via YANG Admin Desk)',
    content: Buffer.from(contentJson, 'utf8').toString('base64'),
    branch: admin.branch,
    sha: cur.sha || undefined,
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${admin.ghToken}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'yang-admin-desk' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  return res.ok
    ? { ok: true, sha: (j.commit && j.commit.sha) || null, url: (j.commit && j.commit.html_url) || null }
    : { ok: false, error: j.message || `HTTP ${res.status}` };
}

/* ---------- Reliz tekshiruvi ----------
 * `scripts/publish_release.mjs` har relizga aynan to'rt faylni yuklaydi. Ro'yxat shu yerda:
 * reliz chala bo'lsa (`latest.yml` yoki `.blockmap` tushib qolsa avto-yangilanish ishlamaydi)
 * operator buni bir qarashda ko'radi. */
const expectedAssets = (version) => [
  `YANG-AI-Setup-${version}.exe`,
  `YANG-AI-Setup-${version}.exe.blockmap`,
  `YANG-AI-Portable-${version}.exe`,
  'latest.yml',
];

/** Relizdagi fayllar orasidan nom bo'yicha qidirish (katta/kichik harfga sezgir emas). */
const hasAsset = (list, name) => (list || []).some((a) => String(a.name || '').toLowerCase() === name.toLowerCase());

/** Loyiha ildizidagi app-config.json (dev rejimda ham, `process.cwd()` da ham izlanadi). */
function localConfigPath() {
  const candidates = [
    path.join(__dirname, '..', 'app-config.json'),
    path.join(process.cwd(), 'app-config.json'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* o'qilmadi — keyingisini sinaymiz */ }
  }
  return null;
}

/** Oxirgi reliz. Token bo'lmasa ham ishlaydi (GitHub anonim so'rovga ruxsat beradi). */
async function fetchLatestRelease() {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'yang-admin-desk' };
  if (admin.ghToken) headers.authorization = `Bearer ${admin.ghToken}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${admin.owner}/${admin.repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 404) {
      return {
        ok: false,
        noRelease: true,
        authorized: !!admin.ghToken,
        error: `${admin.owner}/${admin.repo} da hali reliz yo‘q — «npm run release» bilan birinchi relizni yuklang.`,
      };
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, authorized: !!admin.ghToken, error: j.message || `HTTP ${res.status}` };
    return { ok: true, authorized: !!admin.ghToken, raw: j, assets: j.assets || [] };
  } catch (e) {
    return { ok: false, authorized: !!admin.ghToken, error: e.message };
  }
}

/** Repo'dagi (sozlangan branch) ilova versiyasi — reliz teg bilan solishtirish uchun. */
async function branchAppVersion() {
  const r = await ghGet('package.json');
  if (r.error || !r.content) return null;
  try { return JSON.parse(r.content).version || null; } catch { return null; }
}

function registerIpc() {
  ipcMain.handle('setup:get', () => ({ ...admin, botToken: admin.botToken ? admin.botToken.slice(0, 8) + '…' : '', ghToken: admin.ghToken ? admin.ghToken.slice(0, 6) + '…' : '', hasBot: !!admin.botToken, hasGh: !!admin.ghToken }));
  ipcMain.handle('setup:save', async (_e, patch) => {
    for (const k of ['botToken', 'adminChatId', 'ghToken', 'owner', 'repo', 'branch']) {
      const v = String(patch[k] || '').trim();
      // "…" bilan kesilgan ko'rsatma — saqlanishga yaramaydi, eskisini saqlaymiz
      if (v && !v.endsWith('…')) admin[k] = v;
    }
    await saveAdmin();
    return { ok: true };
  });

  ipcMain.handle('tg:discover', async () => {
    const r = await pollTelegram();
    const inbox = await loadInbox();
    const chatIds = [...new Set(inbox.map((m) => m.chatId).filter(Boolean))];
    return { ...r, chatIds, adminChatId: admin.adminChatId };
  });

  ipcMain.handle('inbox:poll', async () => {
    const r = await pollTelegram();
    const inbox = await loadInbox();
    return { ...r, inbox: inbox.slice(-100).reverse() };
  });

  ipcMain.handle('inbox:markAnswered', async (_e, updateId) => {
    const inbox = await loadInbox();
    const m = inbox.find((x) => x.update_id === updateId);
    if (m) m.answered = true;
    await saveInbox(inbox);
    return { ok: true };
  });

  // Admin Telegram'da reply qilganda javobni to'g'ri joynaga yetkazish:
  //  - to'g'ridan-to'g'ri Telegram foydalanuvchisi -> bot sendMessage(userChatId)
  //  - ilova savoli (📨 installId) -> app-config.json answers[installId] push
  async function forwardReply(orig, replyText) {
    if (orig.installId) {
      const r = await ghGet(DEFAULT_REPO.file);
      if (r.error) return { ok: false, error: r.error };
      let cfgObj = {};
      try { cfgObj = JSON.parse(r.content); } catch { cfgObj = {}; }
      cfgObj.answers = cfgObj.answers || {};
      cfgObj.answers[orig.installId] = { text: String(replyText).slice(0, 1000), at: Date.now() };
      const put = await ghPut(DEFAULT_REPO.file, JSON.stringify(cfgObj, null, 2) + '\n', 'Answer app user (Telegram reply)');
      return { ...put, via: 'app' };
    }
    if (orig.chatId) {
      try {
        const j = await tgCall('sendMessage', { chat_id: orig.chatId, text: String(replyText).slice(0, 3500) });
        return j.ok ? { ok: true, via: 'tg' } : { ok: false, error: j.description || 'sendMessage xato' };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    return { ok: false, error: 'original xabarda manzil yo\u2018q' };
  }

  // Reklama banneri uchun rasmni bevosita GitHub repoga yuklash (raw URL qaytadi)
  ipcMain.handle('gh:upload-image', async (_e, { name, dataB64 }) => {
    if (!admin.ghToken) return { ok: false, error: 'GitHub token kiritilmagan' };
    const safe = String(name || 'banner.png').replace(/[^\w.-]/g, '_');
    const filePath = `ads/${safe}`;
    try {
      const cur = await ghGet(filePath);
      const res = await fetch(`https://api.github.com/repos/${admin.owner}/${admin.repo}/contents/${filePath}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin.ghToken}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'yang-admin-desk' },
        body: JSON.stringify({ message: `Add banner image ${safe}`, content: dataB64, branch: admin.branch, sha: cur.sha || undefined }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      return { ok: true, url: `https://raw.githubusercontent.com/${admin.owner}/${admin.repo}/${admin.branch}/${filePath}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Foydalanuvchiga to'g'ridan-to'g'ri Telegram javob (u botga o'zi yozgan bo'lsa).
  ipcMain.handle('tg:reply', async (_e, { chatId, text }) => {
    if (!admin.botToken) return { ok: false, error: 'Bot token yo\u2018q' };
    try {
      const j = await tgCall('sendMessage', { chat_id: Number(chatId), text: String(text).slice(0, 3500) });
      return j.ok ? { ok: true } : { ok: false, error: j.description || 'sendMessage xato' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('cfg:pull', async () => {
    const r = await ghGet(DEFAULT_REPO.file);
    if (r.error) return { ok: false, error: r.error, config: null };
    try {
      return { ok: true, config: JSON.parse(r.content) };
    } catch (e) {
      return { ok: false, error: 'JSON o\u2018qilmadi: ' + e.message, config: null };
    }
  });

  ipcMain.handle('cfg:push', async (_e, { config, message }) => {
    if (!admin.ghToken) return { ok: false, error: 'GitHub token kiritilmagan (Sozlash bo\u2018limi)' };
    return ghPut(DEFAULT_REPO.file, JSON.stringify(config, null, 2) + '\n', message);
  });

  // Onlayn yordamni yoqish: bot token + chatId ni obfuscated qilib config'ga yozadi.
  ipcMain.handle('support:publish', async (_e, { mode, relayUrl }) => {
    if (!admin.ghToken) return { ok: false, error: 'GitHub token kiritilmagan' };
    const r = await ghGet(DEFAULT_REPO.file);
    if (r.error) return { ok: false, error: r.error };
    let cfgObj = {};
    try { cfgObj = JSON.parse(r.content); } catch { cfgObj = {}; }
    delete cfgObj.botToken;
    delete cfgObj.adminChatId;
    if (mode === 'relay') {
      if (!/^https:\/\//i.test(String(relayUrl || ''))) return { ok: false, error: 'Relay URL noto\u2018g\u2018ri (https kerak)' };
      cfgObj.relayUrl = relayUrl;
      delete cfgObj.tg;
    } else {
      if (!admin.botToken || !admin.adminChatId) return { ok: false, error: 'Bot token / Chat ID yo\u2018q — Sozlash bo\u2018limini to\u2018ldiring' };
      cfgObj.tg = Buffer.from(`${admin.botToken}:${admin.adminChatId}`).toString('base64');
      delete cfgObj.relayUrl;
    }
    return ghPut(DEFAULT_REPO.file, JSON.stringify(cfgObj, null, 2) + '\n', 'Enable online support (YANG Admin Desk)');
  });

  // Foydalanuvchiga javob: config.answers[id] + Telegram bildirishnomasi.
  ipcMain.handle('answer:send', async (_e, { installId, chatId, text }) => {
    if (!admin.ghToken) return { ok: false, error: 'GitHub token kiritilmagan' };
    const r = await ghGet(DEFAULT_REPO.file);
    if (r.error) return { ok: false, error: r.error };
    let cfgObj = {};
    try { cfgObj = JSON.parse(r.content); } catch { cfgObj = {}; }
    cfgObj.answers = cfgObj.answers || {};
    cfgObj.answers[String(installId)] = { text: String(text).slice(0, 1000), at: Date.now() };
    // Eski javoblarni tozalash (30 kundan eskirganlari)
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    for (const [k, v] of Object.entries(cfgObj.answers)) {
      if (!v || !v.at || v.at < cutoff) delete cfgObj.answers[k];
    }
    const put = await ghPut(DEFAULT_REPO.file, JSON.stringify(cfgObj, null, 2) + '\n', 'Answer user (YANG Admin Desk)');
    let notified = false;
    if (chatId) notified = await tgNotify(`💬 YANG AI javobi:\n\n${String(text).slice(0, 1000)}`);
    return { ...put, notified };
  });

  ipcMain.handle('block:toggle', async (_e, { installId, blocked }) => {
    if (!admin.ghToken) return { ok: false, error: 'GitHub token kiritilmagan' };
    const r = await ghGet(DEFAULT_REPO.file);
    if (r.error) return { ok: false, error: r.error };
    let cfgObj = {};
    try { cfgObj = JSON.parse(r.content); } catch { cfgObj = {}; }
    const list = new Set(cfgObj.blocked || []);
    if (blocked) list.add(String(installId));
    else list.delete(String(installId));
    cfgObj.blocked = [...list];
    return ghPut(DEFAULT_REPO.file, JSON.stringify(cfgObj, null, 2) + '\n', `${blocked ? 'Block' : 'Unblock'} user (YANG Admin Desk)`);
  });

  ipcMain.handle('stats:summary', async () => {
    const inbox = await loadInbox();
    const stats = inbox.filter((m) => m.kind === 'stat');
    const ids = new Set(stats.map((m) => m.installId || m.chatId).filter(Boolean));
    const versions = {};
    for (const s of stats) {
      const v = (s.text.match(/Ver:\s*v?([\d.]+)/) || [])[1] || '?';
      versions[v] = (versions[v] || 0) + 1;
    }
    let blocked = [];
    const r = await ghGet(DEFAULT_REPO.file);
    if (r.content) {
      try { blocked = JSON.parse(r.content).blocked || []; } catch {}
    }
    return {
      ok: true,
      installs: ids.size,
      questions: inbox.filter((m) => m.kind === 'question').length,
      unanswered: inbox.filter((m) => m.kind === 'question' && !m.answered).length,
      versions,
      blocked,
    };
  });

  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) return shell.openExternal(url).catch(() => {});
    return false;
  });

  // GitHub'dagi oxirgi release holati (yangi versiya chiqqanini tekshirish)
  ipcMain.handle('release:status', async () => {
    const r = await fetchLatestRelease();
    if (!r.ok) return { ok: false, error: r.error, noRelease: !!r.noRelease, authorized: r.authorized };
    const j = r.raw;
    return {
      ok: true,
      authorized: r.authorized,
      tag: j.tag_name,
      name: j.name,
      publishedAt: j.published_at,
      url: j.html_url,
      assets: (j.assets || []).map((a) => ({ name: a.name, sizeMb: +(a.size / 1e6).toFixed(1), downloads: a.download_count })),
    };
  });

  // TO‘LIQ tekshiruv: reliz tegi ↔ repo versiyasi va to‘rt kutilgan asset bormi.
  ipcMain.handle('release:verify', async () => {
    const repoVersion = await branchAppVersion().catch(() => null);
    const want = expectedAssets(repoVersion || 'x.y.z');
    const r = await fetchLatestRelease();
    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        noRelease: !!r.noRelease,
        authorized: r.authorized,
        repoVersion,
        expected: want.map((n) => ({ name: n, present: false })),
        missing: want,
      };
    }
    const j = r.raw;
    const assets = r.assets;
    const expected = want.map((n) => ({ name: n, present: hasAsset(assets, n) }));
    const tagVersion = String(j.tag_name || '').replace(/^v/, '');
    return {
      ok: true,
      authorized: r.authorized,
      repoVersion,
      tag: j.tag_name,
      tagVersion,
      upToDate: !!repoVersion && tagVersion === repoVersion,
      publishedAt: j.published_at,
      url: j.html_url,
      expected,
      missing: expected.filter((e) => !e.present).map((e) => e.name),
      assets: assets.map((a) => ({ name: a.name, sizeMb: +(a.size / 1e6).toFixed(1), downloads: a.download_count })),
    };
  });

  // Mahalliy app-config.json: nashr qilishdan OLDIN operator ko‘rib chiqadi.
  ipcMain.handle('cfg:local-preview', async () => {
    const p = localConfigPath();
    if (!p) return { ok: false, error: 'app-config.json topilmadi (loyiha ildizida bo‘lishi kerak)' };
    try {
      const text = await fsp.readFile(p, 'utf8');
      let valid = true;
      let jsonError = null;
      let noticeId = null;
      try {
        const parsed = JSON.parse(text);
        noticeId = (parsed.notice && parsed.notice.id) || null;
      } catch (e) { valid = false; jsonError = e.message; }
      return {
        ok: true,
        path: p,
        text,
        bytes: Buffer.byteLength(text, 'utf8'),
        valid,
        jsonError,
        noticeId,
        owner: admin.owner,
        repo: admin.repo,
        branch: admin.branch,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Mahalliy faylni to‘g‘ridan-to‘g‘ri nashr qilish — commit SHA qaytadi.
  ipcMain.handle('cfg:push-local', async (_e, { message } = {}) => {
    if (!admin.ghToken) return { ok: false, error: 'GitHub token kiritilmagan (Sozlash bo‘limi)' };
    const p = localConfigPath();
    if (!p) return { ok: false, error: 'app-config.json topilmadi (loyiha ildizida bo‘lishi kerak)' };
    let text;
    try {
      text = await fsp.readFile(p, 'utf8');
    } catch (e) {
      return { ok: false, error: 'o‘qilmadi: ' + e.message };
    }
    // Buzuq JSON nashr qilinmasin — aks holda barcha ilovalar e'lonni o‘qiy olmay qoladi.
    try { JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON buzuq — nashr qilinmadi: ' + e.message }; }
    const put = await ghPut(DEFAULT_REPO.file, text, String(message || '').slice(0, 200) || 'app-config.json: 5.4 reliz e’loni (YANG Admin Desk)');
    if (!put.ok) return put;
    return {
      ok: true,
      commit: put.sha || null,
      commitUrl: put.url || null,
      branch: admin.branch,
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    backgroundColor: '#0c0e15',
    title: 'YANG Admin Desk',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await loadAdmin();
  registerIpc();
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
