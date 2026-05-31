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
  // loadUserRole() ходит в сеть сырым fetch — без гонки с таймаутом
  // «спящий» сервер вешал бы инициализацию насмерть.
  try {
    await Promise.race([
      restoreSession(),
      new Promise(res => setTimeout(res, 10000)),
    ]);
  } catch(e) { console.warn('restoreSession failed:', e); }

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

  setInterval(() => { sb.auth.refreshSession().catch(() => {}); }, 4 * 60 * 1000);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden' || editMode) return;
    try { await Promise.all([loadSecs(), loadPgs()]); buildNav(); } catch(e) {}
  });

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (_authBusy) return;
    if (event === 'SIGNED_IN' && session) {
      await loadUserRole(session.user); loadProfile(); updAuthUI(); _pgCache.clear();
      await Promise.all([loadPgs(), loadProfiles(), loadHomePage()]);
      buildNav();
      if (curSlug && curSlug !== 'home') go(curSlug, false); else await renderHome();
    } else if (event === 'TOKEN_REFRESHED' && session) {
      await loadUserRole(session.user); updAuthUI();
    } else if (event === 'SIGNED_OUT') {
      user = null; userProfile = { display_name:'', avatar_url:'' }; _pgCache.clear();
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
  if (avatarUrl) return `<img src="${esc(avatarUrl)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1px solid rgba(100,180,220,.2)" loading="lazy">`;
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
  const _COOLDOWN = 7 * 24 * 60 * 60 * 1000;
  const _lastChanged = parseInt(localStorage.getItem('wk_profile_changed_' + user.id) || '0');
  if (Date.now() - _lastChanged < _COOLDOWN) {
    const _daysLeft = Math.ceil((_COOLDOWN - (Date.now() - _lastChanged)) / 86400000);
    toast(`Изменить профиль можно через ${_daysLeft} дн.`, 'err'); return;
  }
  const displayName = document.getElementById('prof-name')?.value?.trim() || '';
  const avatarUrl   = document.getElementById('prof-avatar')?.value?.trim() || '';
  userProfile = { display_name: displayName, avatar_url: avatarUrl };
  localStorage.setItem('wk_profile_' + user.id, JSON.stringify(userProfile));
  try {
    await apiFetch('profiles', { method: 'POST', body: JSON.stringify({ email: user.email, display_name: displayName, avatar_url: avatarUrl }), headers2: { 'Prefer': 'resolution=merge-duplicates' } });
  } catch(e) {}
  try { await sb.auth.updateUser({ data: { display_name: displayName, avatar_url: avatarUrl } }); } catch(e) {}
  const _si = allProfiles.findIndex(p => p.email === user.email);
  const _pd = { email: user.email, display_name: displayName, avatar_url: avatarUrl };
  if (_si >= 0) allProfiles[_si] = _pd; else allProfiles.push(_pd);
  localStorage.setItem('wk_profile_changed_' + user.id, String(Date.now()));
  cm('mo-profile'); updAuthUI(); await renderHome(); toast('Профиль сохранён!', 'ok');
}

async function loadUserRole(authUser) {
  if (!authUser?.id) { user = null; return; }
  try {
    const token = await getTokenFresh();
    const url = `${SB_URL}/rest/v1/user_roles?user_id=eq.${authUser.id}&select=role,is_banned`;

    const r = await fetch(url, { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token } });

    let rows = [];
    if (r.ok) { rows = await r.json(); }

    // Fallback 1: запрос без фильтра — вдруг сравнение по user_id ломается
    if (!rows.length) {
      try {
        const r2 = await fetch(`${SB_URL}/rest/v1/user_roles?select=user_id,role,is_banned`, { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token } });
        if (r2.ok) {
          const all = await r2.json();

          const mine = all.find(x => String(x.user_id).toLowerCase() === String(authUser.id).toLowerCase());
          if (mine) rows = [mine];
        }
      } catch(e) {}
    }

    let rawRole = rows[0]?.role;
    // Маппинг старых названий ролей
    const roleAlias = { admin: 'superadmin', super: 'superadmin', editor: 'editor', mod: 'moderator', moderator: 'moderator' };
    if (rawRole && roleAlias[String(rawRole).toLowerCase()]) rawRole = roleAlias[String(rawRole).toLowerCase()];

    const role = VALID_ROLES.includes(rawRole) ? rawRole : 'viewer';

    user = { id:authUser.id, email:authUser.email, role, is_banned:!!rows[0]?.is_banned };
    try {
      const { data: { user: mu } } = await sb.auth.getUser();
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
    else if (data.session) { await loadUserRole(data.user); cm('mo-auth'); updAuthUI(); await loadPgs(); buildNav(); toast('Аккаунт создан!','ok'); }
  } catch(e) { toast(e.message||'Ошибка','err'); if(btn) btn.disabled=false; }
  finally { _authBusy=false; }
}

// ВАЖНО: Разлочили кнопку Выхода. Мы больше не ждем ответа от зависшего SDK.
async function doLogout() {
  if (_authBusy) return;
  _authBusy = true;
  try {
    if (editMode) exitEdit(false);
    closeAp();
    localStorage.removeItem('wk12_session'); 
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

function updAuthUI() {
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

