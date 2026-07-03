// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// AUTH — init, session, profile, auth UI
// ════════════════════════════════════════════════════════════
async function init() {
  setLang(lang);
  document.getElementById('np-t')?.addEventListener('input', autoNpSl);
  document.getElementById('np-sl')?.addEventListener('input', () => { npSlugLk2 = true; });
  document.getElementById('lb-ru')?.addEventListener('click', () => setLang('ru'));
  document.getElementById('lb-en')?.addEventListener('click', () => setLang('en'));
  document.querySelectorAll('.ov').forEach(ov => ov.addEventListener('click', e => { if(e.target===ov) cm(ov.id); }));
  const srchInput = document.getElementById('srch');
  const srchWrapper = document.querySelector('.sb-srch');
  if (srchInput && srchWrapper) {
    srchInput.dataset.inactive = 'true';
    srchInput.readOnly = true;
    srchWrapper.addEventListener('click', function() {
      if (srchInput.dataset.inactive === 'true') {
        srchInput.dataset.inactive = 'false';
        srchInput.readOnly = false;
        srchInput.focus();
      }
    });
    srchInput.addEventListener('input', e => buildNav(e.target.value));
    srchInput.addEventListener('blur', function() {
      if (!this.value.trim()) {
        this.dataset.inactive = 'true';
        this.readOnly = true;
        buildNav('');
      }
    });
  }

  // ── МГНОВЕННЫЙ ПЕРВЫЙ РЕНДЕР ИЗ КЕША (ДО любых сетевых вызовов!) ──
  // Критично: рисуем каркас из localStorage ПЕРЕД restoreSession/сетью,
  // иначе медленный auth-запрос вешает всю загрузку и не видно даже крошек.
  const hadCache = (typeof hydrateFromCache === 'function') ? hydrateFromCache() : false;
  window.addEventListener('hashchange', route);
  if (hadCache) {
    buildNav();
    updAuthUI();
    route();               // первый кадр из кеша — мгновенно, без ожидания сети
  }

  // ── Возврат с Google OAuth (PKCE): ?code= меняем на сессию ──
  // detectSessionInUrl выключен (хэш занят роутером), поэтому обмен делаем сами.
  try {
    // Ошибка может прийти и в query (?error=), и в хэше (#...&error=) — читаем оба.
    const _hq = new URLSearchParams((location.hash || '').replace(/^#\/?/, '').split('?').slice(1).join('?') || (location.hash || '').replace(/^#/, ''));
    const _oq = new URLSearchParams(location.search);
    const _err = _oq.get('error') || _hq.get('error');
    const _edesc = _oq.get('error_description') || _hq.get('error_description') || '';
    if (_err || _edesc) {
      // Всегда чистим URL и уводим на главную, чтобы не осталась «Страница не найдена».
      history.replaceState(null, '', location.pathname);
      const _isBan = /ban|block|заблок|forbidden|access[_ ]denied/i.test(_err + ' ' + _edesc);
      if (_isBan) {
        showLoginBlockedGate();
      } else {
        // Не показываем сырой SQL/технический текст — только по-человечески.
        toast('Не удалось войти через Google. Попробуйте ещё раз позже.', 'err');
      }
    } else if (_oq.get('code')) {
      const { error: _oerr } = await sb.auth.exchangeCodeForSession(_oq.get('code'));
      // Код одноразовый — сразу убираем из URL, чтобы обновление страницы не
      // запускало повторный обмен тем же ?code= (верификатор уже израсходован).
      history.replaceState(null, '', location.pathname + location.hash);
      if (_oerr) {
        // «PKCE code verifier not found» может быть БЕЗОБИДНЫМ: повторный обмен
        // тем же кодом, когда вход уже удался (init отработал дважды / перезагрузка
        // с кодом в URL). Если сессия при этом ЕСТЬ — вход состоялся, не пугаем.
        let _hasSess = false;
        try { const { data: _sd } = await sb.auth.getSession(); _hasSess = !!_sd?.session; } catch (e) {}
        if (_hasSess) {
          toast('Добро пожаловать!', 'ok');
        } else {
          // Реальная неудача (сессии нет): не показываем сырой технический текст —
          // почти всегда причина в том, что вход начали и завершили в разных
          // браузерах/на разных адресах (www ↔ без www), и хранилище пусто.
          toast(lang === 'ru'
            ? 'Не удалось завершить вход. Откройте страницу входа и попробуйте ещё раз в том же браузере.'
            : 'Sign-in could not be completed. Please try again in the same browser.', 'err');
        }
      } else {
        toast('Добро пожаловать!', 'ok');
      }
    }
  } catch(e) { console.warn('[wiki] oauth exchange failed:', e); }

  // ── Восстановление сессии (с жёстким таймаутом 10 с) ──
  // Когда роль реально подгрузится (даже позже таймаута) — обновляем навигацию
  // и ПЕРЕРИСОВЫВАЕМ текущую страницу: если это была стафф-страница
  // (#admin/#economy), показавшая «нет доступа»/пусто до загрузки роли,
  // теперь она отрисуется правильно.
  const _restoreDone = restoreSession().then(() => {
    try { if (typeof buildNav === 'function') buildNav(); } catch(e) {}
    try { if (typeof updAuthUI === 'function') updAuthUI(); } catch(e) {}
    try { if (user && curSlug && curSlug !== 'home' && !String(curSlug).startsWith('sec:')) route(); } catch(e) {}
  }).catch(() => {});
  await Promise.race([ _restoreDone, new Promise(res => setTimeout(res, 10000)) ]);

  // ── ФОНОВАЯ ЗАГРУЗКА СВЕЖИХ ДАННЫХ ──
  try {
    await Promise.all([loadSecs(), loadPgs(), loadHomePage(), loadProfiles()]);
  } catch(e) { console.warn('Initial data load failed:', e); }

  // Retry-цикл только если кеша НЕ было и сеть не ответила (первый визит на «спящий» сервер)
  if (!hadCache && !pages.length && !sections.length) {
    const retryEl = document.getElementById('initial-loader');
    const setMsg = (msg) => { if (retryEl) retryEl.innerHTML = msg; };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const waitSec = attempt === 1 ? 6 : 8;
      setMsg(`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--te,#3ec0d0);letter-spacing:.1em;text-align:center">
        <div>Сервер запускается</div>
        <div style="margin-top:4px;opacity:.6">попытка ${attempt} / 3 — ждём ${waitSec} с...</div>
      </div>`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      try { await Promise.all([loadSecs(), loadPgs(), loadHomePage()]); } catch(e) {}
      if (pages.length || sections.length) break;
    }
    if (!pages.length && !sections.length) {
      setMsg(`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--err,#e05050);letter-spacing:.1em;text-align:center">
        <div>Сервер не отвечает</div>
        <button onclick="location.reload()" style="margin-top:8px;padding:6px 16px;background:var(--gd,#2a7fc1);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;letter-spacing:.08em">↺ ОБНОВИТЬ</button>
      </div>`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Sync profile from DB if localStorage had nothing (e.g. fresh Vercel deploy)
  try {
    if (user && !userProfile.display_name && !userProfile.avatar_url) {
      const dbProf = allProfiles.find(p => p.user_id === user.id);
      if (dbProf) {
        userProfile.display_name = dbProf.display_name || '';
        userProfile.avatar_url = dbProf.avatar_url || '';
        localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile));
      }
    }
  } catch(e) {}

  try { await loadHeroCoverFromDb(); } catch(e) {}

  // Перерисовка свежими данными
  buildNav();
  updAuthUI();
  if (hadCache) {
    // Уже показали кадр из кеша → обновляем текущий вид свежими данными.
    // Для главной/раздела это дёшево; статьи свежий content тянут сами через go().
    if (curSlug === 'home' || !curSlug) renderHome();
    else route();
  } else {
    route(); // первый кадр (кеша не было)
  }

  // Страховочное обновление сессии. Клиент Supabase и так авто-обновляет токен
  // (autoRefreshToken:true, см. core.js), поэтому ручное держим РЕДКИМ: каждый
  // refreshSession() ротирует refresh-токен = запись в auth.refresh_tokens (самая
  // тяжёлая по индексам таблица). Было 4 мин (~15 записей/час/игрока) → 30 мин.
  // Токен живёт ~60 мин, так что запас есть. Если сессии стабильны — можно убрать совсем.
  setInterval(() => { sb.auth.refreshSession().catch(() => {}); }, 30 * 60 * 1000);

  let _lastVisSync = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden' || editMode) return;
    // throttle: не дёргать БД чаще раза в 2 минуты при переключении вкладок —
    // иначе частые фокусы создают шквал запросов (loadSecs+loadPgs+loadProfiles).
    if (Date.now() - _lastVisSync < 120000) return;
    _lastVisSync = Date.now();
    try {
      await Promise.all([loadSecs(), loadPgs(), loadProfiles()]); buildNav();
      if ((curSlug === 'home' || !curSlug) && typeof renderHome === 'function') renderHome();
      if (typeof updAuthUI === 'function') updAuthUI();
    } catch(e) {}
  });

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (_authBusy) return;
    if (event === 'SIGNED_IN' && session) {
      // Supabase повторно шлёт SIGNED_IN при возврате фокуса на вкладку и при
      // обновлении токена — НЕ только при реальном входе. Отличаем настоящий
      // вход (был разлогинен / сменился аккаунт) от повторного срабатывания
      // того же пользователя по id.
      const prevUid = user && user.id;
      await loadUserRole(session.user); loadProfile(); updAuthUI();
      const sameUser = prevUid && user && prevUid === user.id;
      if (sameUser) {
        // Тот же пользователь: тихо обновляем данные в фоне, но НЕ перерисовываем
        // текущую страницу — иначе теряется незавершённый ввод (анкета и т.п.).
        try { await Promise.all([loadPgs(), loadProfiles()]); buildNav(); } catch(e) {}
        return;
      }
      // Настоящий вход или смена аккаунта — полный рендер с актуальной ролью/данными.
      _pgCache.clear();
      await Promise.all([loadPgs(), loadProfiles(), loadHomePage()]);
      buildNav();
      if (curSlug && curSlug !== 'home') go(curSlug, false); else await renderHome();
    } else if (event === 'TOKEN_REFRESHED' && session) {
      await loadUserRole(session.user); updAuthUI();
    } else if (event === 'SIGNED_OUT') {
      user = null; userProfile = { display_name:'', avatar_url:'' }; _pgCache.clear(); _myFactionApproved = false;
      try { localStorage.removeItem('wk_fac_approved'); } catch(e) {}
      if (editMode) exitEdit(false);
      closeAp(); updAuthUI();
      await Promise.all([loadPgs(), loadProfiles(), loadHomePage()]);
      buildNav();
      go('home', false);
    }
  });
}

async function restoreSession() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) { await loadUserRole(session.user); loadProfile(); }
  } catch(e) {}
}

function loadProfile() {
  if (!user) { userProfile = { display_name:'', avatar_url:'' }; return; }
  const saved = localStorage.getItem('wk_profile_' + user.id);
  if (saved) { try { Object.assign(userProfile, JSON.parse(saved)); } catch {} }
  _cacheGreetName();
}
// Кэшируем отображаемое имя для новеллы, чтобы оно было готово на ПЕРВОМ кадре
// следующей загрузки (до сети) и новелла не перезапускалась из-за подгрузки имени.
function _cacheGreetName() {
  try {
    const dn = (userProfile && userProfile.display_name || '').trim();
    if (dn) localStorage.setItem('wk_greet_name', dn);
  } catch (e) {}
}
function getDisplayName() {
  if (!user) return '';
  return userProfile.display_name || user.email.split('@')[0];
}
async function loadProfiles() {
  try {
    // public_profiles — витрина БЕЗ email (см. _author_id_privacy.sql).
    // Ключ профиля теперь user_id (uuid), почта клиенту не приходит вовсе.
    const rows = await dbGet('public_profiles', 'select=user_id,display_name,avatar_url') || [];
    const map = new Map();
    rows.forEach(r => { if (r && r.user_id) map.set(r.user_id, r); });
    allProfiles = [...map.values()];
    // БД — источник истины: синхронизируем профиль текущего пользователя из базы,
    // перетирая возможно устаревший localStorage-кэш (иначе ник расходится между
    // устройствами/сессиями — на каждом висит свой старый кэш).
    if (user) {
      const mine = map.get(user.id);
      if (mine) {
        userProfile.display_name = mine.display_name || '';
        userProfile.avatar_url = mine.avatar_url || '';
        try { localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile)); } catch(e) {}
        _cacheGreetName();
      }
    }
  } catch(e) { allProfiles = []; }
}
// key = user_id (uuid); старые данные могли остаться с email-ключом — тоже принимаем
function getProfileOf(key) {
  // для текущего пользователя — его актуальный профиль (минуя устаревшие строки в таблице)
  if (user && (key === user.id || key === user.email) && (userProfile.display_name || userProfile.avatar_url)) {
    return { user_id: user.id, display_name: userProfile.display_name || '', avatar_url: userProfile.avatar_url || '' };
  }
  return allProfiles.find(x => x.user_id === key) || {};
}
function userLabel(key) {
  const prof = getProfileOf(key);
  if (prof.display_name?.trim()) return prof.display_name.trim();
  // без профиля: email-ключ (легаси) → префикс; uuid → нейтральное «Участник»
  const s = String(key || '');
  if (s.includes('@')) return s.split('@')[0];
  return s ? 'Участник' : '—';
}
function getAvatarHtml(email, avatarUrl, displayName, size=28) {
  // Только настоящая ссылка — иначе мусор вроде "Хуй" уходил в <img src> и
  // браузер дёргал /Хуй -> 404. Невалидное значение игнорируем (рисуем инициалы).
  const _u = safeAvatar(avatarUrl);
  if (_u) return `<img src="${esc(_u)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1px solid rgba(100,180,220,.2)" loading="lazy" onerror="this.style.display='none'">`;
  const name = displayName || (email||'').split('@')[0] || '?';
  const initials = name.slice(0,2).toUpperCase();
  const hue = [...(email||'')].reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
  return `<span style="width:${size}px;height:${size}px;border-radius:50%;background:hsl(${hue},35%,20%);border:1px solid hsl(${hue},45%,35%);display:inline-flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-size:${Math.round(size/3.2)}px;font-weight:700;color:hsl(${hue},60%,70%);flex-shrink:0">${esc(initials)}</span>`;
}
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'только что';
  if (m < 60) return `${m} мин. назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч. назад`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн. назад`;
  return fmtD(dateStr);
}

function openProfileModal() {
  if (!user) return;
  document.getElementById('prof-name').value = userProfile.display_name || '';
  document.getElementById('prof-avatar').value = userProfile.avatar_url || '';
  previewProfileAv();
  const uploadWrap = document.getElementById('prof-mo-upload-wrap');
  if (uploadWrap) uploadWrap.style.display = '';
  cm('mo-auth'); om('mo-profile');
}
function previewProfileAv() {
  const url = safeAvatar(document.getElementById('prof-avatar')?.value?.trim() || '');
  const name = document.getElementById('prof-name')?.value?.trim() || getDisplayName();
  const prev = document.getElementById('prof-av-preview');
  if (!prev) return;
  // При ошибке загрузки картинки просто прячем её и показываем инициалы —
  // без вставки готового HTML в onerror (тот вариант ломался на кавычках в имени).
  prev.innerHTML = getAvatarHtml(user?.id||'', '', name, 64)
    + (url ? `<img src="${esc(url)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.remove()">` : '');
  prev.style.position = 'relative';
}
async function uploadProfileAv(input) {
  const file = input?.files?.[0];
  if (!file || !user) return;
  await handleImgUpload(file, url => { document.getElementById('prof-avatar').value = url; previewProfileAv(); });
}
async function saveProfileFromForm() {
  if (!user) return;
  const displayName = document.getElementById('prof-name')?.value?.trim() || '';
  const avatarUrl   = document.getElementById('prof-avatar')?.value?.trim() || '';
  if (typeof badName === 'function' && badName(displayName)) { toast('Имя содержит недопустимые слова (мат или запрещённое) — выберите другое', 'err'); return; }
  // Пишем в БД через надёжный upsert по email; ошибку НЕ глотаем — иначе имя
  // «мигнёт» и откатится при следующей синхронизации с базой.
  try {
    await apiFetch('rpc/set_my_profile', { method: 'POST', body: JSON.stringify({ p_name: displayName, p_avatar: avatarUrl }) });
  } catch(e) { toast('Не удалось сохранить профиль: ' + e.message, 'err'); return; }
  userProfile = { display_name: displayName, avatar_url: avatarUrl };
  localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile));
  _cacheGreetName();
  try { await sb.auth.updateUser({ data: { display_name: displayName, avatar_url: avatarUrl } }); } catch(e) {}
  const _si = allProfiles.findIndex(p => p.user_id === user.id);
  const _pd = { user_id: user.id, display_name: displayName, avatar_url: avatarUrl };
  if (_si >= 0) allProfiles[_si] = _pd; else allProfiles.push(_pd);
  cm('mo-profile'); updAuthUI(); await renderHome(); toast('Профиль сохранён!', 'ok');
}

async function loadUserRole(authUser) {
  if (!authUser?.id) { user = null; return; }
  try {
    const token = await getTokenFresh();
    const hdr = { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token };
    // Запрос роли с таймаутом — раньше сырой fetch без отмены мог висеть,
    // из-за чего роль не подгружалась и стафф-пункты меню не появлялись.
    const getJSON = async (url, ms = 15000) => {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
      try { const r = await fetch(url, { headers: hdr, signal: c.signal }); clearTimeout(t); return r.ok ? await r.json() : []; }
      catch (e) { clearTimeout(t); return []; }
    };

    let rows = await getJSON(`${SB_URL}/rest/v1/user_roles?user_id=eq.${authUser.id}&select=role,is_banned`);
    // Fallback: запрос без фильтра — вдруг сравнение по user_id ломается
    if (!rows.length) {
      const all = await getJSON(`${SB_URL}/rest/v1/user_roles?select=user_id,role,is_banned`);
      const mine = (all || []).find(x => String(x.user_id).toLowerCase() === String(authUser.id).toLowerCase());
      if (mine) rows = [mine];
    }

    let rawRole = rows[0]?.role;
    const roleAlias = { admin: 'superadmin', super: 'superadmin', editor: 'editor', mod: 'moderator', moderator: 'moderator' };
    if (rawRole && roleAlias[String(rawRole).toLowerCase()]) rawRole = roleAlias[String(rawRole).toLowerCase()];

    const role = VALID_ROLES.includes(rawRole) ? rawRole : 'viewer';

    user = { id:authUser.id, email:authUser.email, role, is_banned:!!rows[0]?.is_banned };

    // Роль известна — СРАЗУ перестраиваем меню и шапку. Без этого пункт
    // «Управление» (и др. стафф-пункты) не появлялись на ПК, если ответ
    // о роли приходил уже после первичного рендера навигации (медленный канал).
    try { if (typeof buildNav === 'function') buildNav(); if (typeof updAuthUI === 'function') updAuthUI(); } catch(e) {}

    // Игрок = есть одобренная анкета государства (роль 'player' могла не проставиться
    // при одобрении). Даёт доступ к локациям даже без корректной роли в user_roles.
    try {
      const fr = await getJSON(`${SB_URL}/rest/v1/faction_applications?owner_id=eq.${authUser.id}&status=eq.approved&select=id&limit=1`);
      _myFactionApproved = Array.isArray(fr) && fr.length > 0;
      try { localStorage.setItem('wk_fac_approved', _myFactionApproved ? '1' : '0'); } catch(e) {}
      if (_myFactionApproved) { try { buildNav(); if (curSlug === 'home' || !curSlug) renderHome(); } catch(e) {} }
    } catch(e) {}

    // Метаданные профиля — вторично, с таймаутом 4 с (не должны вешать роль/меню)
    try {
      const res = await Promise.race([ sb.auth.getUser(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)) ]);
      const mu = res?.data?.user;
      if (mu?.user_metadata?.display_name !== undefined) {
        userProfile.display_name = mu.user_metadata.display_name || '';
        userProfile.avatar_url   = mu.user_metadata.avatar_url   || '';
        localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile));
        _cacheGreetName();
      } else { loadProfile(); }
    } catch { loadProfile(); }
  } catch(e) {
    if (!user) user = { id:authUser.id, email:authUser.email, role:'viewer', is_banned:false };
  }
}

function authClick() { user ? openAp() : showAuth('login'); }
function openMobSb() { document.getElementById('sb').classList.add('mob-open'); document.getElementById('sb-overlay').classList.add('show'); }
function closeMobSb() { document.getElementById('sb').classList.remove('mob-open'); document.getElementById('sb-overlay').classList.remove('show'); }

/* ─── Сворачиваемое боковое меню (десктоп) ─── */
var _sbUserPref = (function(){ try { return localStorage.getItem('wk_sb_collapsed') === '1'; } catch { return false; } })();

// После перехода (.3s) просим карту/виджеты пересчитать размеры под новую ширину #main
function _sbNotifyResize() {
  setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch {} }, 320);
}

// Ручное сворачивание/разворачивание (кнопка-шеврон или плавающая «☰»)
function toggleSb() {
  const app = document.getElementById('app');
  const collapsed = !app.classList.contains('sb-collapsed');
  app.classList.remove('sb-peek');
  app.classList.toggle('sb-collapsed', collapsed);
  _sbUserPref = collapsed;
  try { localStorage.setItem('wk_sb_collapsed', collapsed ? '1' : '0'); } catch {}
  _sbNotifyResize();
}

// Синхронизация состояния меню при переходе между страницами.
// На карте галактики прячем меню автоматически; на остальных — возвращаем к выбору игрока.
function _sbSyncForRoute(slug) {
  if (window.innerWidth <= 768) return; // на мобильных работает выдвижной drawer
  const app = document.getElementById('app');
  if (!app) return;
  const before = app.classList.contains('sb-collapsed');
  app.classList.remove('sb-peek');
  if (slug === 'map') app.classList.add('sb-collapsed');
  else app.classList.toggle('sb-collapsed', !!_sbUserPref);
  if (app.classList.contains('sb-collapsed') !== before) _sbNotifyResize();
}

// Подсматривание: наведение на левый край показывает меню поверх контента
(function _sbPeekInit(){
  function bind(){
    const edge = document.getElementById('sb-edge');
    const sb = document.getElementById('sb');
    if (edge) edge.addEventListener('mouseenter', () => {
      const app = document.getElementById('app');
      if (app && app.classList.contains('sb-collapsed')) app.classList.add('sb-peek');
    });
    if (sb) sb.addEventListener('mouseleave', () => {
      const app = document.getElementById('app');
      if (app) app.classList.remove('sb-peek');
    });
    // Когда сайдбар доехал — точно пересчитываем размеры карты/виджетов под новую ширину
    if (sb) sb.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'margin-left') { try { window.dispatchEvent(new Event('resize')); } catch {} }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true });
  else bind();
})();

// ── Правовые документы (Политика конфиденциальности / Соглашение) ──────────
// Версия документов. При существенном изменении текстов поднимите дату —
// тогда система попросит игроков принять новую редакцию.
const LEGAL_VERSION = '2026-06-30';
const LEGAL_DOCS = {
  privacy: { file: 'legal/PRIVACY.md', title: 'ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ' },
  terms:   { file: 'legal/TERMS.md',   title: 'ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ' }
};
const _legalCache = {};

async function openLegal(slug) {
  const doc = LEGAL_DOCS[slug]; if (!doc) return;
  const t = document.getElementById('legal-mo-t');
  const b = document.getElementById('legal-body');
  if (t) t.textContent = doc.title;
  if (b) b.innerHTML = '<div style="opacity:.6;padding:20px">Загрузка…</div>';
  om('mo-legal');
  try {
    if (!_legalCache[slug]) {
      const r = await fetch(doc.file + '?v=' + LEGAL_VERSION);
      if (!r.ok) throw new Error('not found');
      _legalCache[slug] = await r.text();
    }
    if (b) b.innerHTML = (typeof renderMd === 'function')
      ? renderMd(_legalCache[slug])
      : '<pre style="white-space:pre-wrap">' + _legalCache[slug].replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</pre>';
  } catch (e) {
    if (b) b.innerHTML = '<div style="padding:20px;color:#ff9a9a">Не удалось загрузить документ.</div>';
  }
}

// Зафиксировать согласие на сервере (вызывается после успешной регистрации)
async function recordLegalConsent() {
  try {
    await sb.rpc('legal_accept', { p_docs: [
      { slug: 'privacy', version: LEGAL_VERSION },
      { slug: 'terms',   version: LEGAL_VERSION }
    ]});
  } catch (e) { console.warn('[wiki] legal consent record failed:', e); }
}

// Единственный способ входа/регистрации — Google OAuth. Пароль-формы удалены:
// сайт не принимает и не хранит пароли, e-mail отдаёт только Google-провайдер.
function showAuth(_mode) {
  const ru = lang === 'ru';
  document.getElementById('auth-mo-t').textContent = ru ? 'ВХОД' : 'SIGN IN';
  document.getElementById('auth-form').innerHTML = `<div class="au">
    <div class="au-stars s1"></div>
    <div class="au-stars s2"></div>
    <div class="au-scan"></div>
    <div class="au-glow"></div>
    <div class="au-corner au-c-tl"></div><div class="au-corner au-c-tr"></div>
    <div class="au-corner au-c-bl"></div><div class="au-corner au-c-br"></div>
    <div class="au-seal" aria-hidden="true">
      <span class="au-radar"></span>
      <span class="au-ring au-ring-1"></span>
      <span class="au-ring au-ring-2"></span>
      <span class="au-core"></span>
      <img class="au-emblem" src="assets/wiki-emblem.png" alt=""
        onload="this.closest('.au-seal').classList.add('has-emblem')" onerror="this.remove()">
    </div>
    <div class="au-ey">${ru ? 'Защищённый канал · Классическая Эра' : 'Secure channel · Classic Era'}</div>
    <div class="au-title">${ru ? 'Идентификация' : 'Identification'}</div>
    <div class="au-div"></div>
    <div class="au-term" id="au-term">&nbsp;</div>
    <button class="au-gbtn" id="google-btn" onclick="signInWithGoogle()">
      <span class="au-gbtn-sheen"></span>
      <span class="au-gbtn-ic"><svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span>
      <span class="au-gbtn-t">${ru ? 'Войти через Google' : 'Continue with Google'}</span>
      <span class="au-gbtn-arr">▸</span>
    </button>
    <div class="au-legal">${ru
      ? `Продолжая, вы соглашаетесь с <a onclick="event.preventDefault();openLegal('terms')">Пользовательским соглашением</a> и <a onclick="event.preventDefault();openLegal('privacy')">Политикой конфиденциальности</a>.`
      : `By continuing you agree to the <a onclick="event.preventDefault();openLegal('terms')">Terms of Use</a> and <a onclick="event.preventDefault();openLegal('privacy')">Privacy Policy</a>.`}</div>
  </div>`;
  _auFxWire(ru);
  om('mo-auth');
}

// Живой слой окна входа: печатающийся терминал + параллакс за курсором
function _auFxWire(ru) {
  clearTimeout(window._auTt);
  const term = document.getElementById('au-term');
  const seq = ru
    ? ['установка защищённого канала…', 'канал установлен', 'подтвердите личность, командующий']
    : ['establishing secure link…', 'link established', 'confirm your identity, commander'];
  let li = 0;
  const type = () => {
    const s = seq[li]; let c = 0;
    const tick = () => {
      if (!document.body.contains(term)) return; // окно перерисовали/закрыли
      term.textContent = s.slice(0, ++c);
      if (c < s.length) window._auTt = setTimeout(tick, 20 + Math.random() * 38);
      else if (li < seq.length - 1) window._auTt = setTimeout(() => { li++; type(); }, li === 0 ? 500 : 650);
    };
    tick();
  };
  window._auTt = setTimeout(type, 400);

  const au = document.querySelector('#mo-auth .au');
  if (!au) return;
  au.addEventListener('mousemove', e => {
    const r = au.getBoundingClientRect();
    au.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    au.style.setProperty('--my', (e.clientY - r.top) + 'px');
    au.style.setProperty('--px', ((e.clientX - r.left) / r.width - .5).toFixed(3));
    au.style.setProperty('--py', ((e.clientY - r.top) / r.height - .5).toFixed(3));
  });
  au.addEventListener('mouseleave', () => {
    au.style.setProperty('--px', 0); au.style.setProperty('--py', 0);
  });
}

let _authBusy = false;
async function signInWithGoogle() {
  if (_authBusy) return;
  const btn = document.getElementById('google-btn');
  _authBusy = true;
  if (btn) {
    btn.disabled = true; btn.classList.add('busy');
    const t = btn.querySelector('.au-gbtn-t');
    if (t) t.textContent = lang === 'ru' ? 'Установка связи…' : 'Connecting…';
  }
  const tm = document.getElementById('au-term');
  if (tm) {
    clearTimeout(window._auTt);
    tm.textContent = lang === 'ru' ? 'перенаправление на защищённый узел Google…' : 'redirecting to Google secure node…';
  }
  try {
    // redirectTo должен быть в allowlist Supabase (Auth → URL Configuration)
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
    // страница сейчас уйдёт на accounts.google.com — состояние не сбрасываем
  } catch(e) {
    toast('Не удалось начать вход: ' + (e.message||e), 'err');
    _authBusy = false;
    if (btn) {
      btn.disabled = false; btn.classList.remove('busy');
      const t = btn.querySelector('.au-gbtn-t');
      if (t) t.textContent = lang === 'ru' ? 'Войти через Google' : 'Continue with Google';
    }
    const tm2 = document.getElementById('au-term');
    if (tm2) tm2.textContent = lang === 'ru' ? 'сбой соединения — попробуйте ещё раз' : 'connection failed — try again';
  }
}

// ВАЖНО: Разлочили кнопку Выхода. Мы больше не ждем ответа от зависшего SDK.
async function doLogout() {
  if (_authBusy) return;
  _authBusy = true;
  try {
    if (editMode) exitEdit(false);
    closeAp();
    localStorage.removeItem('wk12_session');
    try { localStorage.removeItem('wk_greet_name'); } catch(e){}   // сброс приветствия по имени
    sb.auth.signOut().catch(()=>{}); // Отправляем запрос, но не ждем его, чтобы UI не вис
    user = null; userProfile = { display_name:'', avatar_url:'' }; _pgCache.clear();
    updAuthUI();
    await Promise.all([loadPgs(), loadProfiles(), loadHomePage()]);
    buildNav();
    go('home', false);
    toast('Вы вышли','inf');
  } finally {
    _authBusy = false;
  }
}

// ── Блокировка забаненного аккаунта ─────────────────────────────
// Полноэкранный оверлей: перекрывает весь сайт, оставляет только «Выйти».
// Это UX-уровень (клиент). Реальную защиту данных даёт RLS на стороне БД.
function enforceBan() {
  const banned = !!(user && user.is_banned);
  let gate = document.getElementById('ban-gate');
  if (!banned) { if (gate) gate.remove(); document.body.style.overflow = ''; return; }
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'ban-gate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,10,14,.97);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px';
    gate.innerHTML = `
      <div style="max-width:440px;text-align:center;border:1px solid #a33;border-radius:14px;padding:34px 28px;background:linear-gradient(135deg,#1a1012,#120c10);box-shadow:0 20px 60px rgba(0,0,0,.6)">
        <div style="font-size:52px;line-height:1;margin-bottom:14px">⛔</div>
        <div style="font-family:Rajdhani,sans-serif;font-size:22px;font-weight:800;letter-spacing:1px;color:#ff7a7a;margin-bottom:10px">АККАУНТ ЗАБЛОКИРОВАН</div>
        <div style="font-size:13px;line-height:1.6;color:#c0ccd6;margin-bottom:8px">Доступ к вики ограничен администрацией.</div>
        <div id="ban-gate-email" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#6a7a88;margin-bottom:22px"></div>
        <button class="btn btn-gh" onclick="doLogout()" style="border-color:#a33;color:#ff9a9a">Выйти из аккаунта</button>
      </div>`;
    document.body.appendChild(gate);
  }
  const em = document.getElementById('ban-gate-email');
  if (em) em.textContent = user.email || '';
  document.body.style.overflow = 'hidden';
}

// ── Баннер «вход заблокирован» ──────────────────────────────────
// Для случая, когда забаненному GoTrue вообще не выдаёт сессию (banned_until):
// сессии нет → enforceBan() не сработает, поэтому показываем свой оверлей
// прямо по ошибке OAuth-колбэка. Визуально совпадает с enforceBan().
function showLoginBlockedGate() {
  if (document.getElementById('ban-gate')) return;
  const gate = document.createElement('div');
  gate.id = 'ban-gate';
  gate.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,10,14,.97);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px';
  gate.innerHTML = `
    <div style="max-width:440px;text-align:center;border:1px solid #a33;border-radius:14px;padding:34px 28px;background:linear-gradient(135deg,#1a1012,#120c10);box-shadow:0 20px 60px rgba(0,0,0,.6)">
      <div style="font-size:52px;line-height:1;margin-bottom:14px">⛔</div>
      <div style="font-family:Rajdhani,sans-serif;font-size:22px;font-weight:800;letter-spacing:1px;color:#ff7a7a;margin-bottom:10px">АККАУНТ ЗАБЛОКИРОВАН</div>
      <div style="font-size:13px;line-height:1.6;color:#c0ccd6;margin-bottom:22px">Вход ограничен администрацией.<br>Если считаете это ошибкой — свяжитесь с администрацией.</div>
      <button class="btn btn-gh" onclick="document.getElementById('ban-gate').remove();document.body.style.overflow=''" style="border-color:#a33;color:#ff9a9a">Закрыть</button>
    </div>`;
  document.body.appendChild(gate);
  document.body.style.overflow = 'hidden';
}

// ── Гейт согласия с документами (для УЖЕ зарегистрированных игроков) ─────────
// Если вошедший игрок ещё не принял актуальную версию документов —
// показываем блокирующее окно. Закрывает и приход новой редакции
// (поднимите LEGAL_VERSION — у всех снова попросит согласие).
let _legalOk = false, _legalChecking = false;

function _removeLegalGate() {
  const g = document.getElementById('legal-gate');
  if (g) g.remove();
  if (!document.getElementById('ban-gate')) document.body.style.overflow = '';
}

async function enforceLegalConsent() {
  if (!user) { _legalOk = false; _removeLegalGate(); return; }
  if (user.is_banned) { _removeLegalGate(); return; } // забаненному не до согласий
  if (_legalOk || _legalChecking) return;
  _legalChecking = true;
  try {
    const { data, error } = await sb
      .from('legal_consents').select('doc_slug').eq('doc_version', LEGAL_VERSION);
    if (error) return; // таблицы нет / ошибка — не блокируем вход
    const s = new Set((data || []).map(r => r.doc_slug));
    if (s.has('privacy') && s.has('terms')) { _legalOk = true; _removeLegalGate(); return; }
    _showLegalGate();
  } catch (e) { /* сеть — не блокируем */ }
  finally { _legalChecking = false; }
}

function _showLegalGate() {
  if (document.getElementById('legal-gate')) return;
  const g = document.createElement('div');
  g.id = 'legal-gate';
  g.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(8,10,14,.97);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px';
  g.innerHTML = `
    <div style="max-width:480px;border:1px solid #2a3340;border-radius:14px;padding:30px 28px;background:linear-gradient(135deg,#141a22,#0e131a);box-shadow:0 20px 60px rgba(0,0,0,.6)">
      <div style="font-family:Rajdhani,sans-serif;font-size:21px;font-weight:800;letter-spacing:.5px;color:#cdd8e2;margin-bottom:12px">Подтверждение документов</div>
      <div style="font-size:13px;line-height:1.6;color:#aebac6;margin-bottom:16px">Чтобы продолжить пользоваться проектом, ознакомьтесь и примите
        <a onclick="openLegal('terms')" style="color:#7fb0ff;text-decoration:underline;cursor:pointer">Пользовательское соглашение</a> и
        <a onclick="openLegal('privacy')" style="color:#7fb0ff;text-decoration:underline;cursor:pointer">Политику конфиденциальности</a>,
        включая согласие на обработку персональных данных.</div>
      <label style="display:flex;gap:9px;align-items:flex-start;font-size:12px;line-height:1.5;color:#aebac6;cursor:pointer;margin-bottom:18px">
        <input type="checkbox" id="legal-gate-cb" style="margin-top:2px;flex-shrink:0" onchange="var b=document.getElementById('legal-gate-ok');if(b)b.disabled=!this.checked">
        <span>Я ознакомлен(а) и принимаю указанные документы.</span></label>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-gh" onclick="doLogout()">Выйти</button>
        <button class="btn btn-gd" id="legal-gate-ok" disabled onclick="acceptLegalGate()">Принять и продолжить</button>
      </div>
    </div>`;
  document.body.appendChild(g);
  document.body.style.overflow = 'hidden';
}

async function acceptLegalGate() {
  const btn = document.getElementById('legal-gate-ok'); if (btn) btn.disabled = true;
  await recordLegalConsent();
  _legalOk = true;
  _removeLegalGate();
  try { toast('Спасибо! Документы приняты','ok'); } catch(e){}
}

function updAuthUI() {
  enforceBan();
  enforceLegalConsent();
  try { if (typeof tkUpdateVisibility === 'function') tkUpdateVisibility(); } catch (e) {}
  const btn = document.getElementById('auth-btn'); const dot = document.getElementById('adot'); const av = document.getElementById('auth-av'); const eb = document.getElementById('edit-btn');
  if (!btn) return;
  if (user) {
    btn.className = 'tbtn log-in';
    if (dot) dot.style.display = 'none';
    if (av) {
      av.style.display = 'inline-flex';
      if (userProfile.avatar_url) {
        av.innerHTML = `<img src="${esc(userProfile.avatar_url)}" loading="lazy">`;
      } else {
        const _nm = userProfile.display_name || user.email.split('@')[0] || '?';
        const _hue = [...user.email].reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
        av.innerHTML = `<span style="font-size:9px;font-weight:900;color:hsl(${_hue},60%,70%)">${esc(_nm.slice(0,2).toUpperCase())}</span>`;
      }
    }
    document.getElementById('auth-lbl').textContent = getDisplayName();
  } else {
    btn.className = 'tbtn';
    if (dot) dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:var(--t3);flex-shrink:0';
    if (av) av.style.display = 'none';
    document.getElementById('auth-lbl').textContent = T('login');
  }
  const canEdit = user && ['superadmin','editor'].includes(user.role);
  if (eb) {
    eb.style.display = (canEdit && curSlug && !curSlug.startsWith('sec:')) ? 'flex' : 'none';
    const editBtnText = document.getElementById('edit-btn-text');
    if (editBtnText && !editMode) editBtnText.textContent = T('edit');
  }
}

