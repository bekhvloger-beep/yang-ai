// admin-desk/renderer/app.js
const $ = (i) => document.getElementById(i);
let cfgObj = null; // GitHub'dagi app-config.json (tahrirlanadigan nusxa)
let inbox = [];
let answerTarget = null; // {installId, chatId, updateId}

/* ---------- tabs ---------- */
document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.nav-btn').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  $('tab-' + b.dataset.tab).classList.add('active');
  // Lokal AI bo'limi birinchi ochilganda katalogni GitHub'dan olamiz (bekorga so'rov yo'q).
  if (b.dataset.tab === 'models' && modelsCatalog === null) loadModels();
}));

/* ---------- setup ---------- */
(async function loadSetup() {
  const s = await api.getSetup();
  $('botToken').placeholder = s.hasBot ? 'saqlangan ✓ (qayta yozish uchun kiriting)' : '123456:ABC-...';
  $('ghToken').placeholder = s.hasGh ? 'saqlangan ✓ (qayta yozish uchun kiriting)' : 'ghp_...';
  $('adminChatId').value = s.adminChatId || '';
  $('ghOwner').value = s.owner || '';
  $('ghRepo').value = s.repo || '';
  $('ghBranch').value = s.branch || '';
})();

$('saveSetupBtn').addEventListener('click', async () => {
  $('setupStatus').textContent = 'saqlanmoqda…';
  await api.saveSetup({
    botToken: $('botToken').value.trim(),
    adminChatId: $('adminChatId').value.trim(),
    ghToken: $('ghToken').value.trim(),
    owner: $('ghOwner').value.trim() || 'bekhvloger-beep',
    repo: $('ghRepo').value.trim() || 'yang-ai',
    branch: $('ghBranch').value.trim() || 'main',
  });
  $('botToken').value = '';
  $('ghToken').value = '';
  $('setupStatus').textContent = '✓ Saqlandi';
  setTimeout(() => ($('setupStatus').textContent = ''), 2500);
});

$('discoverChatBtn').addEventListener('click', async () => {
  $('discoverStatus').textContent = 'tekshirilmoqda… botga xabar yozganingizni tekshiraman';
  const r = await api.discoverChat();
  if (r.ok && r.chatIds && r.chatIds.length) {
    const last = String(r.chatIds[r.chatIds.length - 1]);
    if (!$('adminChatId').value) $('adminChatId').value = last;
    $('discoverStatus').textContent = `✓ ${r.added} yangi xabar. Chat ID lar: ${r.chatIds.join(', ')} — eng oxirigi kiritildi`;
  } else {
    $('discoverStatus').textContent = r.error || 'xabar topilmadi — botga bir marta xabar yozib, qayta bosing';
  }
});

/* ---------- Reliz holati: tekshiruv + e'lon nashri ---------- */
const fmtDate = (s) => (s ? new Date(s).toLocaleString('uz-UZ') : '—');

$('releaseStatusBtn')?.addEventListener('click', async () => {
  $('releaseStatus').textContent = 'tekshirilmoqda…';
  $('relSummary').textContent = '…';
  $('relExpected').innerHTML = '';
  $('releaseAssets').textContent = '—';
  const r = await api.releaseVerify();
  // Yaroqsiz token — xato emas, lekin ogohlantirish: o'qish tokensiz bajarilgan, nashr ishlamaydi.
  const authWarn = r.authProblem
    ? '<div class="warn">⚠ GitHub tokeni yaroqsiz (Bad credentials) — ma’lumot TOKENSIZ o‘qildi. «Sozlash» bo‘limida yangi token kiriting, aks holda nashr qilish va o‘zgarish yuborish ishlamaydi.</div>'
    : '';

  // 1) Versiya manbalari: har biri alohida ko'rsatiladi. Qiymat o'qilmasa «aniqlanmadi»
  //    deb yozamiz — taxminiy raqam bilan operatorni chalg'itmaymiz.
  const verBlock = '<div class="dim" style="margin-top:8px">Versiya manbalari:</div>'
    + `<div>repo package.json: <b>${r.repoVersion ? 'v' + escapeHtml(r.repoVersion) : '<span class="dim">aniqlanmadi</span>'}</b></div>`
    + `<div>lokal nusxa: <b>${r.localVersion ? 'v' + escapeHtml(r.localVersion) : '<span class="dim">aniqlanmadi</span>'}</b></div>`
    + `<div>yig‘ilgan paket nomi: <b>${r.artifactVersion ? 'v' + escapeHtml(r.artifactVersion) : '<span class="dim">yo‘q</span>'}</b></div>`
    + (r.versionSource && r.expectedVersion
      ? `<div class="dim">hisoblangan versiya: <b>v${escapeHtml(r.expectedVersion)}</b> · manba: ${escapeHtml(r.versionSource)}</div>`
      : '<div class="err">versiyani hech qaysi manbadan o‘qib bo‘lmadi (token/taqdimot tekshirilsin)</div>');

  // 2) Mahalliy yig‘ilgan paketlar (dist/ va dist-ide/) — reliz hali yuklanmagan bo‘lsa ham ko'rinadi.
  const local = r.localArtifacts || [];
  const localBlock = local.length
    ? '<div class="dim" style="margin-top:8px">Mahalliy yig‘ilgan paketlar:</div>'
      + local.map((a) => `<div><code>${escapeHtml(a.name)}</code> — ${a.sizeMb} MB · ${fmtDate(new Date(a.mtime).toISOString())} · <span class="dim">${escapeHtml(a.dir)}/</span></div>`).join('')
    : '<div class="dim" style="margin-top:8px">Mahalliy yig‘ilgan paket topilmadi (dist/ bo‘sh).</div>';

  if (!r.ok) {
    $('releaseStatus').textContent = r.noRelease ? 'reliz yo‘q' : 'xato';
    $('relSummary').innerHTML = authWarn + `<span class="err">${escapeHtml(r.error || 'xato')}</span>` + verBlock + localBlock;
    $('relExpected').innerHTML = ((r.required || []).length)
      ? '<b>Majburiy fayllar (reliz yo‘q):</b>' + r.required.map((e) => `<div>✗ <code>${escapeHtml(e.name)}</code></div>`).join('')
      : '';
    $('releaseAssets').innerHTML = local.length
      ? local.map((a) => `<div>${escapeHtml(a.name)} — ${a.sizeMb} MB</div>`).join('')
      : '<span class="dim">fayl yo‘q</span>';
    return;
  }

  $('releaseStatus').innerHTML = `<a href="#" id="relUrl" style="text-decoration:underline">${escapeHtml(r.tag || '—')}</a> — ${fmtDate(r.publishedAt)}`;
  $('relUrl').addEventListener('click', (e) => { e.preventDefault(); api.openExternal(r.url); });
  const match = r.upToDate === true
    ? `<span class="ok-chip">✓ teg repo versiyasiga mos (${escapeHtml(r.tagVersion || '')})</span>`
    : r.upToDate === false
      ? `<span class="err">✗ teg (${escapeHtml(r.tagVersion || '—')}) repo versiyasiga (v${escapeHtml(r.repoVersion || r.localVersion || '—')}) mos emas</span>`
      : '<span class="dim">teg bilan solishtirib bo‘lmadi (versiya aniqlanmadi)</span>';
  $('relSummary').innerHTML = authWarn + `<div><b>${escapeHtml(r.tag || '—')}</b> · ${fmtDate(r.publishedAt)}</div>`
    + `<div style="margin-top:6px">${match}</div>`
    + verBlock + localBlock
    + `<div class="dim" style="margin-top:8px">${r.authorized ? 'GitHub token bilan so‘raldi' : 'tokensiz so‘raldi (60 so‘rov/soat)'}</div>`;

  // 3) Majburiy uchlik (avto-yangilanish) va qo'shimcha fayllar — alohida ko'rsatiladi,
  //    chunki Portable/zip `YANG_ASSETS` rejimida umuman bo'lmasligi mumkin.
  $('relExpected').innerHTML = '<b>Majburiy (avto-yangilanish):</b>'
    + (r.required || []).map((e) => `<div>${e.present ? '✓' : '✗'} <code>${escapeHtml(e.name)}</code></div>`).join('')
    + ((r.requiredMissing || []).length
      ? (r.hasDistribution
        ? `<div class="err" style="margin-top:6px">Yetishmayapti: ${r.requiredMissing.length} ta — avto-yangilanish ishlamasligi mumkin</div>`
        : '<div class="dim" style="margin-top:6px">Relizda o‘rnatuvchi/portable/zip umuman yo‘q (masalan faqat manba kod) — «yetishmayapti» deb hisoblanmaydi</div>')
      : '<div class="ok-chip" style="margin-top:6px">Hammasi joyida</div>')
    + (((r.optional || []).length)
      ? '<div class="dim" style="margin-top:8px">Qo‘shimcha (majburiy emas):</div>'
        + r.optional.map((e) => `<div>${e.present ? '✓' : '—'} <code>${escapeHtml(e.name)}</code></div>`).join('')
      : '');

  const dist = (r.distribution || []).length ? r.distribution : (r.assets || []);
  $('releaseAssets').innerHTML = dist.length
    ? dist.map((a) => `<div>${escapeHtml(a.name)} — ${a.sizeMb} MB · ${a.downloads} yuklab olingan</div>`).join('')
    : '<span class="dim">fayl yo‘q</span>';
});

// Mahalliy app-config.json ni ko'rish (nashrdan oldin operator tekshiradi).
$('localCfgPreviewBtn')?.addEventListener('click', async () => {
  $('localCfgStatus').textContent = 'o‘qilmoqda…';
  const r = await api.localCfgPreview();
  if (!r.ok) { $('localCfgStatus').textContent = 'xato: ' + (r.error || ''); return; }
  $('localCfgBranch').textContent = r.branch || 'main';
  const el = $('localCfgPreview');
  el.textContent = r.text;
  el.style.display = 'block';
  $('localCfgStatus').textContent = `${r.path} · ${r.bytes} B · ${r.valid ? '✓ JSON to‘g‘ri' : '✗ JSON buzuq: ' + r.jsonError}`
    + (r.noticeId ? ` · e’lon ID: ${r.noticeId}` : '');
});

// Mahalliy faylni nashr qilish (commit SHA qaytadi).
$('localCfgPushBtn')?.addEventListener('click', async () => {
  const r0 = await api.localCfgPreview();
  if (!r0.ok) { $('localCfgStatus').textContent = 'xato: ' + (r0.error || ''); return; }
  if (!r0.valid) { $('localCfgStatus').textContent = 'JSON buzuq — nashr qilinmadi'; return; }
  if (!confirm(`app-config.json → ${r0.owner}/${r0.repo} (${r0.branch}) shoxobchasiga nashr qilinsinmi?`)) return;
  $('localCfgPushBtn').disabled = true;
  $('localCfgStatus').textContent = 'nashr qilinmoqda…';
  const r = await api.pushLocalConfig('app-config.json yangilandi (YANG Admin Desk)');
  $('localCfgPushBtn').disabled = false;
  $('localCfgStatus').textContent = r.ok
    ? `✓ nashr qilindi · commit ${String(r.commit || '').slice(0, 10)} · ${r.bytes} B · ${r.branch}`
    : 'xato: ' + (r.error || '');
});

/* ---------- inbox ---------- */
async function pollInbox() {
  $('pollStatus').textContent = 'yangilanmoqda…';
  const r = await api.pollInbox();
  $('pollStatus').textContent = '';
  if (!r.ok) {
    $('inboxList').innerHTML = `<div class="err">${r.error || 'xato'}</div>`;
    return;
  }
  inbox = r.inbox || [];
  renderInbox();
}

function renderInbox() {
  const list = $('inboxList');
  if (!inbox.length) {
    list.innerHTML = '<div class="dim empty-hint">Hozircha xabar yo\'q. Ilovalar «Sozlamalar → Qo\'llab-quvvatlash»dan savol yozorganda shu yerda chiqadi.</div>';
    return;
  }
  list.innerHTML = '';
  for (const m of inbox.slice(0, 80)) {
    const div = document.createElement('div');
    div.className = 'msg' + (m.kind === 'question' ? ' question' : '') + (m.answered ? ' answered' : '') + (m.own ? ' own' : '');
    const when = new Date(m.ts).toLocaleString('uz-UZ');
    const idLabel = m.installId ? `<span class="id-chip" title="Installatsiya ID (bloklash uchun)">${m.installId}</span>` : '';
    div.innerHTML = `
      <div class="msg-head">
        <b>${m.own ? '✎ Sizning xabaringiz' : m.kind === 'question' ? '📨 Ilova savoli' : m.kind === 'stat' ? '📊 Start' : '💬 Telegram xabari'}</b>
        <span class="dim">${m.from} · ${when}</span>
        ${idLabel}
        ${m.answered ? '<span class="ok-chip">✓ javob berilgan</span>' : ''}
      </div>
      <div class="msg-text">${escapeHtml(m.text).replace(/\n/g, '<br>')}${m.relayMessageId ? '<div class="dim" style="margin-top:6px">↩️ Telegram\'da shu xabarga reply qilsangiz, javob foydalanuvchiga boradi</div>' : ''}${m.relaying ? `<div class="ok-chip">${m.relaying}</div>` : ''}</div>`;
    if (!m.own) {
      const row = document.createElement('div');
      row.className = 'msg-actions';
      const ansBtn = document.createElement('button');
      ansBtn.className = 'btn btn-primary small';
      const direct = !m.installId && m.chatId; // Telegram'dan o'zi yozgan foydalanuvchi
      ansBtn.innerHTML = direct
        ? '📩 Telegram orqali javob'
        : (m.answered ? '↻ Qayta javob berish' : '📩 Javob berish (ilovada ko\'rinadi)');
      ansBtn.addEventListener('click', () => openAnswer(m, direct ? 'tg' : 'app'));
      if (m.installId) {
        const blockBtn = document.createElement('button');
        blockBtn.className = 'btn btn-danger small';
        blockBtn.textContent = '⛔ Bloklash';
        blockBtn.addEventListener('click', async () => {
          if (!confirm(`Bu foydalanuvchini bloklash?\nID: ${m.installId}`)) return;
          const r = await api.blockToggle(m.installId, true);
          blockBtn.textContent = r.ok ? '✓ bloklandi' : 'xato: ' + (r.error || '');
          if (r.ok && cfgObj) { (cfgObj.blocked = cfgObj.blocked || []).push(m.installId); renderBlocked(); }
        });
        row.appendChild(blockBtn);
      }
      row.appendChild(ansBtn);
      div.appendChild(row);
    }
    list.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let answerMode = 'app';
function openAnswer(m, mode) {
  answerTarget = m;
  answerMode = mode || (m.installId ? 'app' : 'tg');
  $('answerTo').textContent = answerMode === 'tg'
    ? `Telegram javob: ${m.from}`
    : `Javob (ilova ichida ko'rinadi): ${m.installId || 'ID yo\'q'}`;
  $('answerText').value = '';
  $('answerBox').classList.remove('hidden');
  $('answerText').focus();
}

$('answerCancelBtn').addEventListener('click', () => $('answerBox').classList.add('hidden'));
$('answerSendBtn').addEventListener('click', async () => {
  if (!answerTarget) return;
  const text = $('answerText').value.trim();
  if (!text) { $('answerStatus').textContent = 'Javob bo\'sh'; return; }
  $('answerSendBtn').disabled = true;
  $('answerStatus').textContent = 'yuborilmoqda…';
  let r;
  if (answerMode === 'tg') {
    r = await api.tgReply(answerTarget.chatId, text);
    if (r.ok) $('answerStatus').textContent = '✓ Telegram orqali yuborildi';
  } else {
    if (!answerTarget.installId) { $('answerSendBtn').disabled = false; $('answerStatus').textContent = 'Installatsiya ID yo\'q'; return; }
    r = await api.answerSend(answerTarget.installId, answerTarget.chatId, text);
    if (r.ok) {
      $('answerStatus').textContent = `✓ Javob nashr qilindi${r.notified ? ' + Telegram bildirishnomasi' : ''}`;
      await api.markAnswered(answerTarget.update_id);
      answerTarget.answered = true;
      renderInbox();
    }
  }
  $('answerSendBtn').disabled = false;
  if (r && r.ok) setTimeout(() => { $('answerBox').classList.add('hidden'); $('answerStatus').textContent = ''; }, 2000);
  else if (r) $('answerStatus').textContent = 'xato: ' + (r.error || 'noma\'lum');
});

$('pollBtn').addEventListener('click', pollInbox);

/* ---------- config (ads/notice/blocked/minver/support) ---------- */
// Holat yozuvi: MODAL oyna (alert) ishlatilmaydi — u butun panelni to'sib qo'yardi va
// ilova ochilishida avtomatik chaqirilganda operator hech narsa qila olmasdi.
function cfgStatus(text, kind = '') {
  const el = $('cfgStatus');
  if (!el) return;
  el.className = 'dim ' + kind;
  el.textContent = text || '';
}

async function pullCfg() {
  cfgStatus('GitHub\'dan olinmoqda…');
  const r = await api.pullConfig();
  if (!r.ok) {
    cfgStatus('GitHub\'dan olib bo\'lmadi: ' + (r.error || 'noma\'lum'), 'err');
    return;
  }
  // Token yaroqsiz bo'lsa ham o'qish tokensiz bajarilgan — operator buni bilishi kerak
  // (nashr qilish uchun esa yaroqli token shart).
  cfgStatus(r.authProblem
    ? '⚠ GitHub tokeni yaroqsiz — o\'qish tokensiz bajarildi, nashr qilish uchun «Sozlash»da yangilang'
    : 'GitHub\'dan olindi', r.authProblem ? 'warn' : '');
  cfgObj = r.config;
  const ad = cfgObj.ad || {};
  $('adEnabled').checked = ad.enabled !== false && !!ad.title;
  $('adTitle').value = ad.title || '';
  $('adBody').value = ad.body || '';
  $('adLink').value = ad.link || '';
  $('adImage').value = ad.imageUrl || '';
  const n = cfgObj.notice || {};
  $('noticeEnabled').checked = n.enabled !== false && !!n.text;
  $('noticeText').value = n.text || '';
  $('noticeId').value = n.id || '';
  $('noticeLink').value = n.link || '';
  $('minVerInput').value = cfgObj.minVersion || '';
  $('relayUrlInput').value = cfgObj.relayUrl || '';
  renderBlocked();
}

function renderBlocked() {
  const list = (cfgObj && cfgObj.blocked) || [];
  const el = $('blockedList');
  el.innerHTML = '';
  if (!list.length) { el.innerHTML = '<span class="dim">bloklangan yo\'q</span>'; return; }
  for (const id of list) {
    const row = document.createElement('div');
    row.className = 'blocked-row';
    const code = document.createElement('code');
    code.textContent = id;
    const un = document.createElement('button');
    un.className = 'btn btn-ghost small';
    un.textContent = '✓ Ochirish';
    un.addEventListener('click', async () => {
      const r = await api.blockToggle(id, false);
      if (r.ok) { cfgObj.blocked = cfgObj.blocked.filter((x) => x !== id); renderBlocked(); }
      else alert('xato: ' + (r.error || ''));
    });
    row.appendChild(code);
    row.appendChild(un);
    el.appendChild(row);
  }
}

$('pullCfgBtn').addEventListener('click', pullCfg);

$('pushCfgBtn').addEventListener('click', async () => {
  if (!cfgObj) { alert('Avval «GitHub\'dan olish»ni bosing'); return; }
  cfgObj.ad = {
    enabled: $('adEnabled').checked,
    title: $('adTitle').value.trim(),
    body: $('adBody').value.trim(),
    link: $('adLink').value.trim(),
    linkText: 'Batafsil',
    imageUrl: $('adImage').value.trim(),
  };
  const noticeText = $('noticeText').value.trim();
  cfgObj.notice = {
    enabled: $('noticeEnabled').checked && !!noticeText,
    id: $('noticeId').value.trim() || 'news-1',
    text: noticeText,
    link: $('noticeLink').value.trim(),
  };
  cfgObj.minVersion = $('minVerInput').value.trim() || null;
  $('pushCfgBtn').disabled = true;
  const r = await api.pushConfig(cfgObj, 'Update content (YANG Admin Desk)');
  $('pushCfgBtn').disabled = false;
  alert(r.ok ? '✓ Nashr qilindi! Ilovalar 30 daqiqada oladi (yoki qayta ochilganda).' : 'Xato: ' + (r.error || ''));
});

$('blockAddBtn').addEventListener('click', async () => {
  const id = $('blockInput').value.trim();
  if (!id) return;
  const r = await api.blockToggle(id, true);
  if (r.ok) {
    $('blockInput').value = '';
    if (cfgObj) { (cfgObj.blocked = cfgObj.blocked || []).push(id); renderBlocked(); }
    else alert('✓ Bloklandi (royxat yangilanishi uchun «GitHub\'dan olish»ni bosing)');
  } else alert('xato: ' + (r.error || ''));
});

$('publishSupportBtn').addEventListener('click', async () => {
  const r = await api.publishSupport('tg', '');
  alert(r.ok ? '✓ Onlayn yordam yoqildi (obfuscated bot kanali).' : 'Xato: ' + (r.error || ''));
});
$('publishRelayBtn').addEventListener('click', async () => {
  const url = $('relayUrlInput').value.trim();
  if (!url.startsWith('https://')) { alert('Relay URL https:// bilan boshlanishi kerak'); return; }
  const r = await api.publishSupport('relay', url);
  alert(r.ok ? '✓ Relay kanali yoqildi.' : 'Xato: ' + (r.error || ''));
});

// Reklama uchun rasm yuklash: fayl -> GitHub repo (ads/) -> raw URL
$('adImageUploadBtn').addEventListener('click', async () => {
  const f = $('adImageFile').files && $('adImageFile').files[0];
  if (!f) { alert('Avval rasm faylini tanlang'); return; }
  if (f.size > 3 * 1024 * 1024) { alert('Rasm 3MB dan kichik bo\'lsin'); return; }
  const btn = $('adImageUploadBtn');
  btn.disabled = true;
  btn.textContent = 'yuklanmoqda…';
  try {
    const dataB64 = await new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result).split(',')[1]);
      rd.onerror = reject;
      rd.readAsDataURL(f);
    });
    const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const name = `banner-${Date.now()}.${ext}`;
    const r = await api.uploadImage(name, dataB64);
    if (r.ok) {
      $('adImage').value = r.url;
      alert('✓ Rasm GitHub\'ga yuklandi va URL to\'ldirildi. Endi «Nashr qilish»ni bosing.');
    } else {
      alert('xato: ' + (r.error || ''));
    }
  } catch (e) {
    alert('xato: ' + (e.message || e));
  }
  btn.disabled = false;
  btn.textContent = '⤓ Yuklash';
});

/* ---------- stats ---------- */
$('statsBtn').addEventListener('click', async () => {
  const r = await api.stats();
  if (!r.ok) return;
  $('stInstalls').textContent = r.installs;
  $('stQuestions').textContent = r.questions;
  $('stUnanswered').textContent = r.unanswered;
  const v = Object.entries(r.versions || {}).map(([ver, n]) => `v${ver}: ${n}`).join(' · ') || '—';
  $('stVersions').textContent = v + (r.blocked && r.blocked.length ? ` · ⛔ blokda: ${r.blocked.length}` : '');
});

// Yon paneldagi yorliq: Desk versiyasi va lokal ilova versiyasi HAQIQIY manbadan olinadi
// (index.html dagi qattiq yozilgan raqam eskirib qolmasin).
(async function loadDeskInfo() {
  try {
    const d = await api.deskInfo();
    const el = $('deskVersion');
    if (!el) return;
    const desk = d.deskVersion ? 'Desk v' + d.deskVersion : 'Desk';
    const app = d.localVersion ? ' · ilova v' + d.localVersion : '';
    el.textContent = `${desk}${app} · ${d.owner || ''}/${d.repo || ''} (${d.branch || 'main'})`;
  } catch { /* yorliq eski matnda qoladi */ }
})();

// Poll: faqat Savollar tabida emas — doim ishlaydi (Telegram reply'lar uslublanmasin)
pullCfg();
pollInbox();
setInterval(pollInbox, 60 * 1000);

// Ochilishda reliz holatini ko'rsatib qo'yamiz (operator birinchi bo'lib shuni ko'radi).
$('releaseStatusBtn')?.click();

/* =====================================================================================
   🧠 LOKAL AI KATALOGI (local-ai/catalog.json) — qo'shish / tahrirlash / o'chirish / nashr
   Har bir karta katalogdagi BITTA yozuv. O'zgarish darhol `modelsCatalog.items[i]` ga
   yoziladi, lekin ilovalarga faqat «Nashr qilish» bosilgach yetib boradi.
   ===================================================================================== */
let modelsCatalog = null;   // GitHub'dan olingan yoki tahrirlanayotgan katalog

const MODELS_KINDS = [
  ['text', 'matn'],
  ['image', 'rasm'],
  ['runtime', 'dvigatel'],
  ['voice', 'ovoz'],
];

function modelsStatus(text, kind = '') {
  const el = $('modelsStatus');
  if (!el) return;
  el.className = 'dim ' + kind;
  el.textContent = text || '';
}

function modelNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function renderModels() {
  const list = $('modelsList');
  if (!list) return;
  if (!modelsCatalog || !Array.isArray(modelsCatalog.items) || !modelsCatalog.items.length) {
    list.innerHTML = '<div class="dim empty-hint">Katalog bo\'sh — «GitHub\'dan olish»ni bosing.</div>';
    return;
  }
  list.innerHTML = '';
  modelsCatalog.items.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.idx = String(idx);
    const strength = it.strength || {};
    const min = it.min || {};
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <h3>${escapeHtml(it.name || it.id || '—')} <span class="dim" style="font-weight:400">· ${escapeHtml(it.id || '')}</span></h3>
        <button class="btn btn-danger small" data-act="remove">🗑 O'chirish</button>
      </div>
      <div class="grid-2">
        <label class="field"><span>Nomi</span><input data-field="name" value="${escapeHtml(it.name || '')}" /></label>
        <label class="field"><span>Turkum</span><select data-field="kind">
          ${MODELS_KINDS.map(([v, t]) => `<option value="${v}"${it.kind === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select></label>
        <label class="field"><span>Fayl nomi</span><input data-field="file" value="${escapeHtml(it.file || '')}" /></label>
        <label class="field"><span>Hajm (bayt)</span><input type="number" data-field="bytes" value="${modelNum(it.bytes)}" /></label>
        <label class="field"><span>Yuklab olish havolasi (url)</span><input data-field="url" value="${escapeHtml(it.url || '')}" /></label>
        <label class="field"><span>Tillar / qamrov (vergul bilan)</span><input data-field="langs" value="${escapeHtml((it.langs || []).join(', '))}" /></label>
        <label class="field"><span>Kuch darajasi (level 1–5)</span><input type="number" min="1" max="5" data-field="level" value="${modelNum(it.level, 3)}" /></label>
        <label class="field"><span>Kod kuchi (strength.code 1–5)</span><input type="number" min="1" max="5" data-field="strength.code" value="${modelNum(strength.code, 3)}" /></label>
        <label class="field"><span>Minimal RAM (GB)</span><input type="number" data-field="min.ramGb" value="${modelNum(min.ramGb, 4)}" /></label>
        <label class="field"><span>Kerak disk (GB)</span><input type="number" data-field="min.diskGb" value="${modelNum(min.diskGb, 1)}" /></label>
      </div>
      <label class="chk"><input type="checkbox" data-field="bundled"${it.bundled ? ' checked' : ''} /> Ilova ichida keladi (yuklab olish shart emas)</label>
      <label class="field"><span>Tavsif (izoh — foydalanuvchiga shu matn ko'rinadi)</span><textarea rows="3" data-field="notes">${escapeHtml(it.notes || '')}</textarea></label>
    `;
    card.querySelector('[data-act="remove"]').addEventListener('click', () => {
      if (!confirm(`«${it.name || it.id}» katalogdan olib tashlansinmi? (nashr qilmaguningizcha ilovalarga ta'sir qilmaydi)`)) return;
      modelsCatalog.items.splice(idx, 1);
      renderModels();
      modelsStatus(`olib tashlandi: ${it.name || it.id} — saqlash uchun «Nashr qilish»ni bosing`, 'warn');
    });
    for (const el of card.querySelectorAll('[data-field]')) {
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const path = el.dataset.field.split('.');
        let obj = it;
        for (let i = 0; i < path.length - 1; i++) { obj[path[i]] = obj[path[i]] || {}; obj = obj[path[i]]; }
        const key = path[path.length - 1];
        if (el.type === 'checkbox') obj[key] = el.checked;
        else if (el.type === 'number') obj[key] = modelNum(el.value, 0);
        else if (key === 'langs') obj[key] = el.value.split(',').map((s) => s.trim()).filter(Boolean);
        else obj[key] = el.value;
      });
    }
    list.appendChild(card);
  });
}

async function loadModels() {
  modelsStatus('GitHub\'dan olinmoqda…');
  const r = await api.catalogPull();
  if (!r.ok) {
    modelsStatus('GitHub\'dan olib bo\'lmadi: ' + (r.error || 'noma\'lum'), 'err');
    return;
  }
  modelsCatalog = r.catalog;
  renderModels();
  modelsStatus(r.authProblem
    ? '⚠ GitHub tokeni yaroqsiz — o\'qish tokensiz bajarildi, nashr uchun token yangilang'
    : `olindi · ${(modelsCatalog.items || []).length} model`, r.authProblem ? 'warn' : '');
}

$('modelsPullBtn')?.addEventListener('click', loadModels);

$('modelsAddBtn')?.addEventListener('click', () => {
  if (!modelsCatalog) { modelsStatus('Avval «GitHub\'dan olish»ni bosing', 'err'); return; }
  modelsCatalog.items = modelsCatalog.items || [];
  modelsCatalog.items.push({
    id: 'yangi-model-' + Date.now(),
    kind: 'text',
    name: 'Yangi model',
    file: 'model.gguf',
    bytes: 0,
    url: '',
    backend: 'llama.cpp',
    min: { ramGb: 4, diskGb: 1 },
    recommend: { ramGb: 6, vramGb: 0 },
    measured: null,
    strength: { code: 3, general: 3, speed: 3, uzbek: 3 },
    level: 3,
    langs: [],
    notes: '',
  });
  renderModels();
  modelsStatus('yangi model qo\'shildi — maydonlarni to\'ldirib «Nashr qilish»ni bosing');
});

$('modelsLocalBtn')?.addEventListener('click', async () => {
  const r = await api.catalogLocal();
  const pre = $('modelsPreview');
  if (!r.ok) { modelsStatus('xato: ' + (r.error || ''), 'err'); return; }
  pre.textContent = r.text;
  pre.style.display = 'block';
  modelsStatus(`${r.path} · ${r.bytes} B · ${r.valid ? '✓ JSON to\'g\'ri' : '✗ JSON buzuq: ' + r.jsonError}`);
});

$('modelsPushBtn')?.addEventListener('click', async () => {
  if (!modelsCatalog) { modelsStatus('Avval «GitHub\'dan olish»ni bosing', 'err'); return; }
  if (!confirm(`local-ai/catalog.json → GitHub shoxobchasiga nashr qilinsinmi? (${(modelsCatalog.items || []).length} model)`)) return;
  const btn = $('modelsPushBtn');
  btn.disabled = true;
  modelsStatus('nashr qilinmoqda…');
  const r = await api.catalogPush(modelsCatalog);
  btn.disabled = false;
  modelsStatus(r.ok
    ? `✓ nashr qilindi · commit ${String(r.commit || '').slice(0, 10)} · ${r.bytes} B${r.localSaved ? ' · lokal nusxa ham yangilandi' : ''}`
    : 'xato: ' + (r.error || ''), r.ok ? '' : 'err');
});
