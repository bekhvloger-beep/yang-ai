// YANG AI site — 3 tilla (uz/ru/en) + smooth scroll
const I18N = {
  uz: {
    nav_features: 'Imkoniyatlar', nav_how: 'Qanday ishlaydi', nav_download: 'Yuklab olish', nav_support: 'Yordam',
    hero_badge: '⬡ 100% AI tomonidan yaratilgan dastur',
    hero_title: 'Kompyuteringiz uchun<br><span class="grad">professional AI yordamchi</span>',
    hero_sub: 'YANG AI — kod yozadi, hujjat yaratadi (PDF/DOCX/XLSX), rasm tahlil qiladi, buyruqlarni bajaradi. Katta loyihalar uchun parallel agentlar jamoasi. Offline o\'zbekcha tarjimon bilan.',
    hero_cta1: '⬇ Windows uchun yuklab olish', hero_cta2: 'Qanday ishlaydi →',
    stat1: 'professional vositalar', stat2: 'o\'zingizning bepul kalitlaringiz', stat3: 'to\'liq o\'zbekcha interfeys', stat4: 'obuna, to\'lov yo\'q',
    feat_title: 'Imkoniyatlar',
    feat_sub: 'ZCode/Codex darajasidagi agentic qobiliyatlar — lekin sizning kompyuteringizda, sizning shartlaringizda.',
    f1_t: 'Parallel agentlar jamoasi', f1_d: 'Planner vazifani bo\'ladi, 2-5 mutaxassis agent parallel ishlaydi, Reviewer tekshiradi. Katta loyihalar bir buyruqda.',
    f2_t: 'Offline o\'zbekcha tarjimon', f2_d: 'Ilova ichida NLLB tarjimon: agentlar inglizcha fikrlaydi, javob toza o\'zbekchada chiqadi. Internet shart emas.',
    f3_t: 'Hujjatlar va fayllar', f3_d: 'PDF, DOCX, XLSX, CSV yaratish va o\'qish. Kod yozish, tahlil qilish, avtomatlashtirish — hammasi.',
    f4_t: 'Rasm tahlili (vision)', f4_d: 'Skrinshot tashlang — xatoni tahlil qiladi, dizaynni ko\'rib kod yozadi, hujjatni tushuntiradi.',
    f5_t: 'Bepul AI — o\'zingiz boshqarasiz', f5_d: 'O\'zingizning bepul API kalitlaringiz (Groq, HuggingFace, Gemini — karta shart emas). Obuna yo\'q, limitlaringiz sizniki.',
    f6_t: 'Avtomatik yangilanish', f6_d: 'Yangi versiya chiqsa — ilova o\'zi aniqlaydi, bitta bosish bilan yangilanadi. GitHub Releases orqali.',
    how_title: 'Qanday ishlaydi',
    s1_t: 'Yuklab oling', s1_d: 'Setup.exe ni o\'rnatib qo\'ying yoki Portable versiyadan foydalaning.',
    s2_t: 'Bepul kalit oling', s2_d: 'console.groq.com/keys yoki huggingface.co/settings/tokens — karta shart emas, 2 daqiqa. Kalitsiz ham sinab ko\'rish mumkin.',
    s3_t: 'Ishga tushiring', s3_d: 'Vazifani o\'zbekcha yozing — agentlar bajaradi, javob toza o\'zbekchada chiqadi.',
    dl_title: 'Yuklab olish', dl_sub: 'Windows 10/11 (64-bit). O\'rnatuvchi ~641MB — offline o\'zbekcha tarjimon bilan.',
    dl1_d: 'O\'rnatuvchi: Start menyusi, ish stoli yorlig\'i, to\'liq o\'chirish imkoni.', dl1_btn: 'Setup .exe — so\'nggi versiya',
    dl2_d: 'O\'rnatmasdan ishga tushirish — bitta exe fayl (USB\'dan ham ishlaydi).', dl2_btn: 'Portable .exe — so\'nggi versiya',
    dl_note: 'Birinchi ochilishda Windows SmartScreen ogohlantirishi mumkin: «More info → Run anyway». Dastur ochiq tarqatiladi — GitHub Releases orqali.',
    sup_title: 'Qo\'llab-quvvatlash va hamkorlik',
    sup1_d: 'Telegram bot orqali yozing — admin tez orada javob beradi. Ilova ichidagi «Sozlamalar → Qo\'llab-quvvatlash» bo\'limidan ham bevosita yozish mumkin.',
    sup2_d: 'Reklama joylash, hamkorlik va takliflar uchun to\'g\'ridan-to\'g\'ri admin bilan bog\'laning.',
    q1: 'Dastur pullikmi?', a1: 'Yo\'q. Dastur mutlaqo bepul — obuna yo\'q. AI uchun o\'zingizning bepul API kalitlaringizdan foydalanasiz (Groq/HuggingFace karta so\'ramaydi).',
    q2: 'Kompyuterni boshqarish ruxsatnomasi so\'raladimi?', a2: 'Windows admin huquqi talab qilinmaydi. Buyruq bajarishdan oldin ilova ichida ruxsat kartasi chiqadi — faqat Siz «Ha» desangiz bajariladi.',
    q3: 'O\'zbekcha tarjimon qanday ishlaydi?', a3: 'NLLB tarjimon ilova ichida o\'rnatilgan — agentlar inglizcha ishlaydi, javob offline holda toza o\'zbekchaga aylanadi.',
    q4: 'Bu dastur kim tomonidan yaratilgan?', a4: 'YANG AI 100% AI tomonidan yaratilgan (AICOMP.UZ loyihasi) — kod, dizayn va tarjimon hammasi sun\'iy intellekt yordamida.',
    footer_ai: '100% AI tomonidan yaratilgan 🤖',
  },
  ru: {
    nav_features: 'Возможности', nav_how: 'Как работает', nav_download: 'Скачать', nav_support: 'Поддержка',
    hero_badge: '⬡ Приложение, созданное на 100% ИИ',
    hero_title: 'Профессиональный ИИ-ассистент<br><span class="grad">для вашего компьютера</span>',
    hero_sub: 'YANG AI — пишет код, создаёт документы (PDF/DOCX/XLSX), анализирует изображения, выполняет команды. Параллельная команда агентов для больших проектов. С офлайн узбекским переводчиком.',
    hero_cta1: '⬇ Скачать для Windows', hero_cta2: 'Как работает →',
    stat1: 'профессиональных инструментов', stat2: 'ваши бесплатные ключи', stat3: 'полностью узбекский интерфейс', stat4: 'без подписки и платежей',
    feat_title: 'Возможности',
    feat_sub: 'Агентные возможности уровня ZCode/Codex — но на вашем компьютере и на ваших условиях.',
    f1_t: 'Параллельная команда агентов', f1_d: 'Планировщик делит задачу, 2-5 специалистов работают параллельно, Reviewer проверяет. Большие проекты одной командой.',
    f2_t: 'Офлайн узбекский переводчик', f2_d: 'Встроенный NLLB-переводчик: агенты думают на английском, ответ приходит на чистом узбекском. Интернет не нужен.',
    f3_t: 'Документы и файлы', f3_d: 'Создание и чтение PDF, DOCX, XLSX, CSV. Написание кода, анализ, автоматизация — всё есть.',
    f4_t: 'Анализ изображений (vision)', f4_d: 'Бросьте скриншот — найдёт ошибку, напишет код по макету, объяснит документ.',
    f5_t: 'Бесплатный ИИ — под вашим контролем', f5_d: 'Ваши собственные бесплатные API-ключи (Groq, HuggingFace, Gemini — без карты). Без подписки, лимиты — ваши.',
    f6_t: 'Автообновление', f6_d: 'Новая версия — приложение само её находит и обновляется одним кликом. Через GitHub Releases.',
    how_title: 'Как работает',
    s1_t: 'Скачайте', s1_d: 'Установите Setup.exe или используйте Portable-версию.',
    s2_t: 'Получите бесплатный ключ', s2_d: 'console.groq.com/keys или huggingface.co/settings/tokens — без карты, 2 минуты. Можно попробовать и без ключа.',
    s3_t: 'Начните работу', s3_d: 'Напишите задачу на узбекском — агенты выполнят, ответ придёт на чистом узбекском.',
    dl_title: 'Скачать', dl_sub: 'Windows 10/11 (64-bit). Установщик ~641MB — с офлайн узбекским переводчиком.',
    dl1_d: 'Установщик: меню «Пуск», ярлык на рабочем столе, полная деинсталляция.', dl1_btn: 'Setup .exe — последняя версия',
    dl2_d: 'Запуск без установки — один exe-файл (работает даже с USB).', dl2_btn: 'Portable .exe — последняя версия',
    dl_note: 'При первом запуске Windows SmartScreen может предупредить: «More info → Run anyway». Приложение распространяется через GitHub Releases.',
    sup_title: 'Поддержка и сотрудничество',
    sup1_d: 'Напишите через Telegram-бота — админ быстро ответит. Также можно писать прямо из приложения: «Настройки → Поддержка».',
    sup2_d: 'Для рекламы, сотрудничества и предложений свяжитесь с админом напрямую.',
    q1: 'Приложение платное?', a1: 'Нет. Оно полностью бесплатное — без подписки. Для ИИ используются ваши собственные бесплатные API-ключи (Groq/HuggingFace — без карты).',
    q2: 'Запрашивается ли разрешение на управление компьютером?', a2: 'Права администратора Windows не нужны. Перед выполнением команды появляется карточка подтверждения внутри приложения — выполняется только после вашего «Да».',
    q3: 'Как работает узбекский переводчик?', a3: 'NLLB-переводчик встроен в приложение — агенты работают на английском, ответ офлайн переводится на чистый узбекский.',
    q4: 'Кто создал это приложение?', a4: 'YANG AI создан на 100% ИИ (проект AICOMP.UZ) — код, дизайн и переводчик созданы с помощью искусственного интеллекта.',
    footer_ai: 'Создано на 100% ИИ 🤖',
  },
  en: {
    nav_features: 'Features', nav_how: 'How it works', nav_download: 'Download', nav_support: 'Support',
    hero_badge: '⬡ 100% AI-built application',
    hero_title: 'A professional AI assistant<br><span class="grad">for your computer</span>',
    hero_sub: 'YANG AI — writes code, creates documents (PDF/DOCX/XLSX), analyzes images, runs commands. A parallel agent team for big projects. With an offline Uzbek translator.',
    hero_cta1: '⬇ Download for Windows', hero_cta2: 'How it works →',
    stat1: 'professional tools', stat2: 'your own free API keys', stat3: 'fully Uzbek interface', stat4: 'no subscription, no payments',
    feat_title: 'Features',
    feat_sub: 'ZCode/Codex-level agentic capabilities — on your machine, on your terms.',
    f1_t: 'Parallel agent team', f1_d: 'A planner splits the task, 2-5 specialist agents work in parallel, a Reviewer checks results. Big projects in one command.',
    f2_t: 'Offline Uzbek translator', f2_d: 'Built-in NLLB translator: agents think in English, the answer comes back in clean Uzbek. No internet needed.',
    f3_t: 'Documents & files', f3_d: 'Create and read PDF, DOCX, XLSX, CSV. Writing code, analysis, automation — all included.',
    f4_t: 'Image analysis (vision)', f4_d: 'Drop a screenshot — it finds bugs, writes code from mockups, explains documents.',
    f5_t: 'Free AI — you stay in control', f5_d: 'Use your own free API keys (Groq, HuggingFace, Gemini — no card required). No subscription, your limits.',
    f6_t: 'Automatic updates', f6_d: 'When a new version ships, the app detects it and updates in one click. Via GitHub Releases.',
    how_title: 'How it works',
    s1_t: 'Download', s1_d: 'Install Setup.exe or use the Portable version.',
    s2_t: 'Get a free key', s2_d: 'console.groq.com/keys or huggingface.co/settings/tokens — no card, 2 minutes. You can even try without a key.',
    s3_t: 'Start working', s3_d: 'Write the task in Uzbek — agents do the work, the answer comes back in clean Uzbek.',
    dl_title: 'Download', dl_sub: 'Windows 10/11 (64-bit). Installer ~641MB — includes the offline Uzbek translator.',
    dl1_d: 'Installer: Start menu, desktop shortcut, full uninstall.', dl1_btn: 'Setup .exe — latest version',
    dl2_d: 'Run without installing — a single exe file (works from USB too).', dl2_btn: 'Portable .exe — latest version',
    dl_note: 'Windows SmartScreen may warn on first launch: «More info → Run anyway». The app is distributed openly via GitHub Releases.',
    sup_title: 'Support & partnership',
    sup1_d: 'Write via the Telegram bot — the admin replies quickly. You can also write right from the app: «Settings → Support».',
    sup2_d: 'For advertising, partnership and suggestions, contact the admin directly.',
    q1: 'Is the app paid?', a1: 'No. It is completely free — no subscription. For AI you use your own free API keys (Groq/HuggingFace — no card required).',
    q2: 'Does it ask for permission to control the computer?', a2: 'No Windows admin rights are needed. Before running a command, an approval card appears inside the app — it runs only after you click «Yes».',
    q3: 'How does the Uzbek translator work?', a3: 'The NLLB translator is built into the app — agents work in English, and the answer is translated offline into clean Uzbek.',
    q4: 'Who created this app?', a4: 'YANG AI was built 100% by AI (the AICOMP.UZ project) — the code, the design and the translator were all made with artificial intelligence.',
    footer_ai: 'Built 100% by AI 🤖',
  },
};

const langSwitch = document.getElementById('langSwitch');
function setLang(lang) {
  const dict = I18N[lang] || I18N.uz;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (dict[k]) el.textContent = dict[k];
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const k = el.getAttribute('data-i18n-html');
    if (dict[k]) el.innerHTML = dict[k];
  });
  document.documentElement.lang = lang;
  langSwitch.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('yang_lang', lang);
}
langSwitch.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lang]');
  if (b) setLang(b.dataset.lang);
});
setLang(localStorage.getItem('yang_lang') || 'uz');
