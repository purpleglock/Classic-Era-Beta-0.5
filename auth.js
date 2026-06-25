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
      const dbProf = allProfiles.find(p => p.email === user.email);
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
}
function getDisplayName() {
  if (!user) return '';
  return userProfile.display_name || user.email.split('@')[0];
}
async function loadProfiles() {
  try {
    const rows = await dbGet('profiles', 'select=email,display_name,avatar_url') || [];
    // дедуп по email (в таблице бывают дубли) — последняя запись побеждает
    const map = new Map();
    rows.forEach(r => { if (r && r.email) map.set(r.email, r); });
    allProfiles = [...map.values()];
    // БД — источник истины: синхронизируем профиль текущего пользователя из базы,
    // перетирая возможно устаревший localStorage-кэш (иначе ник расходится между
    // устройствами/сессиями — на каждом висит свой старый кэш).
    if (user) {
      const mine = map.get(user.email);
      if (mine) {
        userProfile.display_name = mine.display_name || '';
        userProfile.avatar_url = mine.avatar_url || '';
        try { localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile)); } catch(e) {}
      }
    }
  } catch(e) { allProfiles = []; }
}
function getProfileOf(email) {
  // для текущего пользователя — его актуальный профиль (минуя возможные дубли/устаревшие строки в таблице)
  if (user && email === user.email && (userProfile.display_name || userProfile.avatar_url)) {
    return { email, display_name: userProfile.display_name || '', avatar_url: userProfile.avatar_url || '' };
  }
  return allProfiles.find(x => x.email === email) || {};
}
function userLabel(email) {
  const prof = getProfileOf(email);
  if (prof.display_name?.trim()) return prof.display_name.trim();
  return (email||'').split('@')[0] || '—';
}
function getAvatarHtml(email, avatarUrl, displayName, size=28) {
  // Только настоящая ссылка — иначе мусор вроде "Хуй" уходил в <img src> и
  // браузер дёргал /Хуй -> 404. Невалидное значение игнорируем (рисуем инициалы).
  const _u = (avatarUrl || '').trim();
  const validUrl = /^(https?:\/\/|data:image\/)/i.test(_u);
  if (validUrl) return `<img src="${esc(_u)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1px solid rgba(100,180,220,.2)" loading="lazy" onerror="this.style.display='none'">`;
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
  const url = document.getElementById('prof-avatar')?.value?.trim() || '';
  const name = document.getElementById('prof-name')?.value?.trim() || getDisplayName();
  const prev = document.getElementById('prof-av-preview');
  if (!prev) return;
  prev.innerHTML = url
    ? `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='${esc(getAvatarHtml(user?.email||'','',(document.getElementById('prof-name')?.value||'').trim(),64))}'>`
    : getAvatarHtml(user?.email||'', '', name, 64);
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
  try { await sb.auth.updateUser({ data: { display_name: displayName, avatar_url: avatarUrl } }); } catch(e) {}
  const _si = allProfiles.findIndex(p => p.email === user.email);
  const _pd = { email: user.email, display_name: displayName, avatar_url: avatarUrl };
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
      if (_myFactionApproved) { try { buildNav(); } catch(e) {} }
    } catch(e) {}

    // Метаданные профиля — вторично, с таймаутом 4 с (не должны вешать роль/меню)
    try {
      const res = await Promise.race([ sb.auth.getUser(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)) ]);
      const mu = res?.data?.user;
      if (mu?.user_metadata?.display_name !== undefined) {
        userProfile.display_name = mu.user_metadata.display_name || '';
        userProfile.avatar_url   = mu.user_metadata.avatar_url   || '';
        localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile));
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

function showAuth(mode) {
  document.getElementById('auth-mo-t').textContent = mode==='login' ? 'ВХОД' : 'РЕГИСТРАЦИЯ';
  if (mode==='login') {
    document.getElementById('auth-form').innerHTML = `<div class="auth-box"><div class="auth-ey">${lang==='ru'?'ИДЕНТИФИКАЦИЯ':'SIGN IN'}</div><div class="fg"><label class="fl">Email</label><input class="fi" id="al-u" type="email" autocomplete="email"></div><div class="fg"><label class="fl">${lang==='ru'?'Пароль':'Password'}</label><input class="fi" id="al-p" type="password" autocomplete="current-password"></div><button class="btn btn-gd btn-fw" style="margin-top:6px" id="login-btn" onclick="subLogin()">${lang==='ru'?'Войти':'Sign In'}</button><div class="auth-sw">${lang==='ru'?'Нет аккаунта?':'No account?'} <a onclick="showAuth('register')">${lang==='ru'?'Зарегистрироваться':'Register'}</a></div></div>`;
    document.getElementById('al-p').addEventListener('keydown', e => { if(e.key==='Enter') subLogin(); });
  } else {
    document.getElementById('auth-form').innerHTML = `<div class="auth-box"><div class="auth-ey">${lang==='ru'?'НОВЫЙ АККАУНТ':'NEW ACCOUNT'}</div><div class="fg"><label class="fl">Email</label><input class="fi" id="ar-u" type="email" autocomplete="email"></div><div class="fg"><label class="fl">${lang==='ru'?'Пароль (мин. 8)':'Password (min. 8)'}</label><input class="fi" id="ar-p" type="password" autocomplete="new-password"></div><div class="fg"><label class="fl">${lang==='ru'?'Повторите пароль':'Confirm password'}</label><input class="fi" id="ar-p2" type="password" autocomplete="new-password"></div><button class="btn btn-gd btn-fw" style="margin-top:6px" id="reg-btn" onclick="subReg()">${lang==='ru'?'Зарегистрироваться':'Register'}</button><div class="auth-sw">${lang==='ru'?'Есть аккаунт?':'Have an account?'} <a onclick="showAuth('login')">${lang==='ru'?'Войти':'Sign In'}</a></div></div>`;
    document.getElementById('ar-p2').addEventListener('keydown', e => { if(e.key==='Enter') subReg(); });
  }
  om('mo-auth'); setTimeout(() => document.querySelector('#auth-form .fi')?.focus(), 60);
}

let _authBusy = false;
async function subLogin() {
  if (_authBusy) return;
  const email = document.getElementById('al-u')?.value?.trim()||'';
  const password = document.getElementById('al-p')?.value||'';
  if (!email||!password) { toast('Заполните все поля','err'); return; }
  const btn = document.getElementById('login-btn');
  _authBusy = true; if(btn) btn.disabled=true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // Вход удался — ЗАКРЫВАЕМ модалку и приветствуем СРАЗУ.
    // Раньше cm('mo-auth') стоял ПОСЛЕ await loadPgs/loadProfiles/… —
    // на медленном Supabase это держало окно входа открытым 10-30 с
    // и логин выглядел зависшим.
    cm('mo-auth');
    toast('Добро пожаловать!','ok');

    // Обновление UI/данных — в фоне, не блокирует вход (onAuthStateChange тоже подхватит)
    (async () => {
      try {
        await loadUserRole(data.user);
        loadProfile();
        updAuthUI();
        _pgCache.clear();
        await Promise.all([loadPgs(), loadProfiles(), loadHomePage()]);
        await loadHeroCoverFromDb();
        buildNav();
        if (curSlug==='home' || !curSlug) renderHome(); else go(curSlug, false);
      } catch(e2) {
        console.warn('[wiki] post-login refresh failed:', e2);
      }
    })();
  } catch(e) { toast(e.message||'Ошибка входа','err'); }
  finally { _authBusy=false; if(btn) btn.disabled=false; }
}

async function subReg() {
  if (_authBusy) return;
  const email = document.getElementById('ar-u')?.value?.trim()||'';
  const pass   = document.getElementById('ar-p')?.value||'';
  const pass2  = document.getElementById('ar-p2')?.value||'';
  if (!email||!pass) { toast('Заполните все поля','err'); return; }
  if (pass.length<8) { toast('Пароль минимум 8 символов','err'); return; }
  if (pass!==pass2)  { toast('Пароли не совпадают','err'); return; }
  const btn = document.getElementById('reg-btn');
  _authBusy=true; if(btn) btn.disabled=true;
  try {
    const { data, error } = await sb.auth.signUp({ email, password: pass });
    if (error) throw error;
    if (data.user && !data.session) { toast('Проверьте email для подтверждения','inf'); cm('mo-auth'); }
    else if (data.session) {
      // Закрываем модалку сразу, данные подтягиваем в фоне
      cm('mo-auth');
      toast('Аккаунт создан!','ok');
      (async () => {
        try { await loadUserRole(data.user); updAuthUI(); await loadPgs(); buildNav(); }
        catch(e2) { console.warn('[wiki] post-register refresh failed:', e2); }
      })();
    }
  } catch(e) { toast(e.message||'Ошибка','err'); }
  finally { _authBusy=false; if(btn) btn.disabled=false; }
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

function updAuthUI() {
  enforceBan();
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

