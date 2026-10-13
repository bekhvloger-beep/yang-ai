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
  const r = await api.releaseVerify();
  if (!r.ok) {
    $('releaseStatus').textContent = r.noRelease ? 'reliz yo‘q' : 'xato';
    $('relSummary').innerHTML = `<span class="err">${escapeHtml(r.error || 'xato')}</span>`
      + (r.repoVersion ? `<div class="dim" style="margin-top:6px">Repo versiyasi: <b>${escapeHtml(r.repoVersion)}</b></div>` : '');
    $('relExpected').innerHTML = ((r.expected || []).length)
      ? '<b>Kutilgan fayllar:</b>' + r.expected.map((e) => `<div>✗ <code>${escapeHtml(e.name)}</code></div>`).join('')
      : '';
    $('releaseAssets').textContent = '—';
    return;
  }
  $('releaseStatus').innerHTML = `<a href="#" id="relUrl" style="text-decoration:underline">${escapeHtml(r.tag || '—')}</a> — ${fmtDate(r.publishedAt)}`;
  $('relUrl').addEventListener('click', (e) => { e.preventDefault(); api.openExternal(r.url); });
  const match = r.upToDate
    ? `<span class="ok-chip">✓ teg repo versiyasiga mos (${escapeHtml(r.tagVersion || '')})</span>`
    : `<span class="err">✗ teg (${escapeHtml(r.tagVersion || '—')}) repo versiyasiga (${escapeHtml(r.repoVersion || '—')}) mos emas</span>`;
  $('relSummary').innerHTML = `<div><b>${escapeHtml(r.tag || '—')}</b> · ${fmtDate(r.publishedAt)}</div>`
    + `<div style="margin-top:6px">${match}</div>`
    + `<div class="dim" style="margin-top:6px">${r.authorized ? 'GitHub token bilan so‘raldi' : 'tokensiz so‘raldi (60 so‘rov/soat)'}</div>`;
  $('relExpected').innerHTML = '<b>Majburiy fayllar:</b>'
    + r.expected.map((e) => `<div>${e.present ? '✓' : '✗'} <code>${escapeHtml(e.name)}</code></div>`).join('')
    + ((r.missing || []).length
      ? `<div class="err" style="margin-top:6px">Yetishmayapti: ${r.missing.length} ta — avto-yangilanish ishlamasligi mumkin</div>`
      : '<div class="ok-chip" style="margin-top:6px">Hammasi joyida</div>');
  $('releaseAssets').innerHTML = (r.assets || []).length
    ? r.assets.map((a) => `<div>${escapeHtml(a.name)} — ${a.sizeMb} MB · ${a.downloads} yuklab olingan</div>`).join('')
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
  const r = await api.pushLocalConfig('app-config.json: 5.4 reliz e’loni (YANG Admin Desk)');
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
async function pullCfg() {
  const r = await api.pullConfig();
  if (!r.ok) { alert('GitHub\'dan olib bo\'lmadi: ' + r.error); return; }
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

// Poll: faqat Savollar tabida emas — doim ishlaydi (Telegram reply'lar uslublanmasin)
pullCfg();
pollInbox();
setInterval(pollInbox, 60 * 1000);

// Ochilishda reliz holatini ko'rsatib qo'yamiz (operator birinchi bo'lib shuni ko'radi).
$('releaseStatusBtn')?.click();
