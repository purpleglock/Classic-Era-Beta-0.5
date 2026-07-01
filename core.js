// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// CORE — Supabase client, API helpers, state, i18n, utils
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// НОВАЯ ЭРА WIKI — v12 CLEAN REWRITE
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// ── Cached background already applied in HTML head ──

// ⚠️  ВСТАВЬ СВОИ ДАННЫЕ: Supabase Dashboard → Settings → API
//     SB_URL  = Project URL
//     SB_ANON = anon / public key
//     Подробности в SETUP.md
const SB_URL  = 'https://pgngkkiiopymvrcozvvr.supabase.co';
const SB_ANON = 'sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS';

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// localStorage — сессия живёт между обновлениями страницы
// ────────────────────────────────────────────────────────────────────────────────────────────────────
const sb = supabase.createClient(SB_URL, SB_ANON, {
  auth: {
    persistSession: true,
    storageKey: 'wk12_session',
    storage: window.localStorage,
    // no-op lock: отключает Web Locks (из-за reconnect-проблем), но остаётся
    // валидной функцией — иначе auth-методы падают с "this.lock is not a function".
    lock: (_name, _acquireTimeout, fn) => fn(),
    autoRefreshToken: true,
    detectSessionInUrl: false,
  }
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CLOUDFLARE R2 (картинки) — бесплатный egress, спасает от банов Supabase Storage
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// R2_PUBLIC — публичный URL бакета (R2 → бакет → Settings → Public access → r2.dev), БЕЗ слэша в конце
//             пример: 'https://pub-xxxxxxxx.r2.dev'
// R2_UPLOAD — URL воркера-загрузчика (Cloudflare Workers, *.workers.dev), БЕЗ слэша в конце
//             пример: 'https://ce-upload.твой-логин.workers.dev'
// Пока обе строки пустые → заливка идёт в Supabase Storage, как раньше (плавный переход).
const R2_PUBLIC = '';
const R2_UPLOAD = '';

// Плейсхолдер «КЭ» — инлайн-SVG, сети не требует, не ломается. Подменяет любую битую картинку.
const CE_IMG_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>" +
  "<rect width='100%' height='100%' fill='#0b0e18'/>" +
  "<rect x='1.5' y='1.5' width='397' height='297' fill='none' stroke='#1e2740' stroke-width='2'/>" +
  "<text x='50%' y='47%' fill='#4cb4ec' font-family='Georgia,serif' font-size='120' font-weight='bold' " +
  "text-anchor='middle' dominant-baseline='central' opacity='0.85'>КЭ</text>" +
  "<text x='50%' y='80%' fill='#3a4a66' font-family='Arial,sans-serif' font-size='18' " +
  "letter-spacing='3' text-anchor='middle'>НЕТ ИЗОБРАЖЕНИЯ</text></svg>"
);

// Глобальный перехватчик: любая <img>, которая не загрузилась, заменяется на плейсхолдер.
// capture=true — события error у картинок не всплывают, ловим на фазе погружения.
window.addEventListener('error', function (e) {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.dataset.cePh !== '1' && t.src !== CE_IMG_PLACEHOLDER) {
    t.dataset.cePh = '1';
    t.src = CE_IMG_PLACEHOLDER;
  }
}, true);

// Общий аплоадер картинок: пишет в R2 (если настроен), иначе — в Supabase Storage.
// Возвращает публичный URL загруженного файла. file уже должен быть сжат вызывающим кодом.
// Разрешённые типы/размер загрузки. ЭТО КЛИЕНТСКИЙ БАРЬЕР (UX + отсечь случайное):
// его легко обойти через консоль, поэтому НАСТОЯЩИЙ лимит обязан стоять в политике
// Supabase Storage (см. _security_hardening.sql). SVG сознательно НЕ разрешён —
// он может нести <script>/onload и выполнится при открытии картинки.
const CE_UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const CE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 МБ
async function ceUploadImage(file, token) {
  if (!file || !CE_UPLOAD_TYPES[file.type]) throw new Error('Недопустимый тип файла: разрешены JPEG, PNG, GIF, WEBP (SVG запрещён)');
  if (file.size > CE_UPLOAD_MAX_BYTES) throw new Error(`Файл слишком большой (${(file.size/1048576).toFixed(1)} МБ, максимум 10 МБ)`);
  const ext = CE_UPLOAD_TYPES[file.type] || 'jpg';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  if (R2_PUBLIC && R2_UPLOAD) {
    const r = await fetch(`${R2_UPLOAD}/${name}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': file.type },
      body: file
    });
    if (!r.ok) { let m = 'R2 HTTP ' + r.status; try { m += ': ' + (await r.text()); } catch {} throw new Error(m); }
    return `${R2_PUBLIC}/${name}`;
  }
  // Фолбэк — Supabase Storage (bucket wiki-images)
  const r = await fetch(`${SB_URL}/storage/v1/object/wiki-images/${name}`, {
    method: 'POST',
    headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': file.type, 'cache-control': 'max-age=31536000, immutable', 'x-upsert': 'true' },
    body: file
  });
  if (!r.ok) { let m = 'HTTP ' + r.status; try { const e = await r.json(); m = e?.error || e?.message || m; } catch {} throw new Error(m); }
  return `${SB_URL}/storage/v1/object/public/wiki-images/${name}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// REST HELPERS
// ────────────────────────────────────────────────────────────────────────────────────────────────────
function getToken() {
  try {
    const raw = localStorage.getItem('wk12_session');
    if (raw) {
      const p = JSON.parse(raw);
      const tok = p?.access_token || p?.session?.access_token || p?.currentSession?.access_token;
      const exp = p?.expires_at || p?.session?.expires_at;
      if (tok && (!exp || exp * 1000 > Date.now())) return tok;
    }
  } catch(e) {}
  return SB_ANON;
}

// ПОЛНОСТЬЮ ОБХОДИМ ЗАВИСАЮЩИЙ getSession() SDK
// Умное получение токена: быстрое и с защитой от зависания
async function getTokenFresh() {
    // 1. Сначала берем токен из localStorage — это моментально и не вешает вкладку
    let token = getToken();
    if (token && token !== SB_ANON) return token;
    
    // 2. Если локально токена нет, дергаем SDK, но с таймаутом 2 секунды, чтобы избежать вечного зависания Web Lock
    try {
      const res = await Promise.race([
        sb.auth.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]);
      if (res?.data?.session?.access_token) {
        return res.data.session.access_token;
      }
    } catch(e) { 
      console.warn('[wiki] Не удалось обновить токен для загрузки:', e.message); 
    }
    
    return SB_ANON;
  }

async function apiFetch(path, opts = {}) {
  const isMutation = opts.method === 'POST' || opts.method === 'PATCH' || opts.method === 'DELETE';
  const token = isMutation ? await getTokenFresh() : getToken();
  const extraHeaders = opts.headers2 || {};
  delete opts.headers2;
  const headers = {
    'apikey': SB_ANON,
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    ...(opts.method === 'POST' || opts.method === 'PATCH' ? { 'Prefer': 'return=representation' } : {}),
    ...extraHeaders,
  };
  // Таймаут 28 с — «холодный» старт Supabase (free-tier) занимает до ~25 с,
  // поэтому 12 с было мало: запрос обрывался ровно перед пробуждением базы.
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 28000);
  try {
    const r = await fetch(SB_URL + '/rest/v1/' + path, { ...opts, headers, signal: ctrl.signal });
    clearTimeout(tid);
    if (r.status === 204) return null;
    const d = await r.json();
    if (!r.ok) throw new Error(d?.message || d?.error || 'HTTP ' + r.status);
    return d;
  } catch (e) {
    clearTimeout(tid);
    if (e.name === 'AbortError') throw new Error('таймаут: сервер не ответил за 28 с');
    throw e;
  }
}
const dbGet  = (t, q='')    => apiFetch(`${t}?${q}`);
const dbPost = (t, b)       => apiFetch(t,       { method:'POST',  body: JSON.stringify(b) });
const dbPatch= (t, q, b)    => apiFetch(`${t}?${q}`, { method:'PATCH', body: JSON.stringify(b) });
const dbDel  = (t, q)       => apiFetch(`${t}?${q}`, { method:'DELETE' });

// ────────────────────────────────────────────────────────────────────────────
// ФИЛЬТР ИМЁН: ненормативная лексика + явно противоправное (законодательство РФ).
// Используется для имён профиля, фракций, планет. Серверная страховка — в SQL.
// ────────────────────────────────────────────────────────────────────────────
const BAD_WORD_ROOTS = [
  // ненормативная лексика — кириллица. Корни СПЕЦИФИЧНЫЕ, чтобы не ловить
  // нормальные имена (Себастьян, Аманда, Небула, Херсон): без широких «еба/ебу/хер/манда».
  'хуй','хуё','хую','хуи','пизд','ебло','ебля','выеб','наеб','уеб','подъеб','отъеб','въеб','съеб','доеб','заеб','ебат','ебал','ебуч','ебут',
  'бляд','блять','блядь','сука','суки','суко','мудак','мудил','залуп','гондон','гандон','пидор','пидар','пидр','педик',
  'жопа','жопу','говно','говн','дроч','долбоеб','долбоёб','залупа','херня','нахуй','похуй','нихуя','еблан','шлюх','блляд',
  // транслит-варианты (после нормализации латиницы в кириллицу)
  'хуи','хуй','блуад','блуа','блиад','пидор','пидар','педик','сука','суиа','ебат','ебал','еблан','уебат','мудак','наху','поху','залупа','гандон','гондон','мраз',
  // явно противоправное / экстремизм (базовый стоп-лист)
  'гитлер','рейх','зигхайл','хайльгитлер','нацизм','нацист','фашизм','фашист','свастик','зиги','игил','террор','ваххаб','скинхед','педофил','зоофил',
];
// Нормализация: lower → leet-цифры → ПОЛНАЯ транслитерация латиницы в кириллицу
// → удаление всего, кроме кириллицы. Ловит «х_у_й», «ху1», «xyй», «blyad», «пidor».
function _normName(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[@4]/g, 'а').replace(/3/g, 'е').replace(/0/g, 'о').replace(/[1!|]/g, 'и').replace(/[5$]/g, 'с').replace(/7/g, 'т')
    .replace(/a/g, 'а').replace(/b/g, 'б').replace(/c/g, 'с').replace(/d/g, 'д').replace(/e/g, 'е').replace(/f/g, 'ф')
    .replace(/g/g, 'г').replace(/h/g, 'х').replace(/i/g, 'и').replace(/j/g, 'й').replace(/k/g, 'к').replace(/l/g, 'л')
    .replace(/m/g, 'м').replace(/n/g, 'н').replace(/o/g, 'о').replace(/p/g, 'п').replace(/q/g, 'к').replace(/r/g, 'р')
    .replace(/s/g, 'с').replace(/t/g, 'т').replace(/u/g, 'у').replace(/v/g, 'в').replace(/w/g, 'в').replace(/x/g, 'х')
    .replace(/y/g, 'у').replace(/z/g, 'з').replace(/ё/g, 'е')
    .replace(/[^а-я]/g, '');
}
// true — имя содержит запрещённое и не должно сохраняться.
function badName(s) {
  const t = _normName(s);
  if (!t) return false;
  return BAD_WORD_ROOTS.some(root => t.includes(_normName(root)));
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────────────────────────────────────────────────────
let user     = null;   
let sections = [];
let pages    = [];
let curSlug  = null;
let lang     = localStorage.getItem('wk_lang') || 'ru';
let editMode = false, editData = null, editBlocks = [];
let apOpen   = false, apTab = 'pages';
let secSlugLk = false, npSlugLk2 = false;
let pickerInsertIdx = -1;
let _pickerCat = 'all', _pickerQ = '';
const _pgCache = new Map();  
const VALID_ROLES = ['superadmin','editor','moderator','player','viewer'];
// ── Доступ к локациям (форумные RP-страницы для игроков) ──
// «Игрок+»: вошёл, не забанен, и ЛИБО роль игрок/стафф, ЛИБО есть одобренное
// государство (роль 'player' могла не проставиться при одобрении — подстраховка).
let _myFactionApproved = (localStorage.getItem('wk_fac_approved') === '1');
function canSeeLocations() {
  if (typeof user === 'undefined' || !user || user.is_banned) return false;
  if (['superadmin','editor','moderator','player'].includes(user.role)) return true;
  return _myFactionApproved;
}
// «Голос локации»: администрация — может писать от имени локации и модерировать.
function isLocationStaff() {
  return !!(typeof user !== 'undefined' && user && !user.is_banned &&
    ['superadmin','editor','moderator'].includes(user.role));
}
const MOS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

let userProfile = { display_name: '', avatar_url: '' };
let allProfiles = [];
let _heroCoverUrl = localStorage.getItem('wk_hero_cover') || '';

// ── Визуальная новелла главной (спрайт + диалоговое окно) ──
// Конфиг хранится в site_settings (ключ wk_hero_vn) как JSON-строка:
//   { enabled, sprites:[{id,name,url}], dialogues:[{id,spriteId,speaker,lines:[...]}] }
// Кэшируется в localStorage для мгновенного рендера до загрузки из БД.
let _heroVN = (() => {
  try { return JSON.parse(localStorage.getItem('wk_hero_vn') || 'null') || null; } catch (e) { return null; }
})();
// Выбрать более СВЕЖИЙ конфиг новеллы (по метке _ts). Это снимает рассинхрон:
// если запись в общую БД не прошла, локальные правки (с бо́льшим _ts) побеждают.
function _vnPickNewer(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return ((b._ts || 0) > (a._ts || 0)) ? b : a;
}
async function loadHeroVN() {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/site_settings?key=eq.wk_hero_vn&select=value&limit=1`,
      { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() } }
    );
    if (!r.ok) return;
    const data = await r.json();
    const raw = data?.[0]?.value;
    let dbCfg = null;
    try { dbCfg = raw ? ((typeof raw === 'string') ? JSON.parse(raw) : raw) : null; } catch (e) {}
    let locCfg = null;
    try { locCfg = JSON.parse(localStorage.getItem('wk_hero_vn') || 'null'); } catch (e) {}
    const cfg = _vnPickNewer(dbCfg, locCfg);
    if (!cfg) return;                       // нигде ничего — дефолтные фразы в render
    // _heroVN уже засеян из localStorage (см. выше) — первый renderHome уже с новеллой.
    // Перерисовываем ТОЛЬКО если из БД пришёл более свежий конфиг, иначе лишний
    // повторный рендер перезапускает печать новеллы (визуальное «моргание» на старте).
    const prevTs = (_heroVN && _heroVN._ts) || 0;
    const changed = !_heroVN || ((cfg._ts || 0) > prevTs) || JSON.stringify(cfg) !== JSON.stringify(_heroVN);
    _heroVN = cfg;
    localStorage.setItem('wk_hero_vn', JSON.stringify(cfg));
    if (changed && typeof renderHome === 'function' && location.hash.replace('#','') === '' ) {
      try { renderHome(); } catch (e) {}
    }
  } catch (e) { /* нет таблицы/настройки — просто без новеллы */ }
}
loadHeroVN();

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// I18N
// ────────────────────────────────────────────────────────────────────────────────────────────────────
const I18N = {
  ru:{home:'Главная',search:'Поиск...',articles:'статей',noArticles:'Нет статей',noContent:'Нет содержимого.',recentChanges:'История изменений',draft:'ЧЕРНОВИК',new_tag:'НОВОЕ',edit_tag:'ПРАВКА',editHome:'Редактировать главную',other:'Разное',login:'Войти',loading:'Загрузка...',notFound:'Страница не найдена',saveOk:'Сохранено!',saveErr:'Ошибка:',cancel:'Отмена',save:'Сохранить',delete:'Удалить',create:'Создать',close:'Закрыть',logout:'Выйти',edit:'Редактировать',editBtn:'✎ Редактировать',pages:'Страницы',sections:'Разделы',users:'Пользователи',newPage:'+ Новая страница',newSection:'+ Новый раздел',published:'Опубликован',draft_status:'Черновик',logoName:'Вики',logoSub:'классической эры',coefSystemSettings:'⚙ НАСТРОЙКИ СИСТЕМЫ',coefTitle:'КОЭФФИЦИЕНТЫ',coefSubtitle:'Редактирование параметров всех систем вики',coefHowHpWorks:'📖 КАК РАБОТАЕТ СИСТЕМА HP',coefArmorHp:'🛡 HP БРОНИ',coefCharHp:'👤 HP ПЕРСОНАЖА',coefExample:'Пример:',coefImportant:'Важно:',coefNote:'Ресурсы (чермет/руда/кристаллы/старвис) НЕ влияют на HP. HP зависит ТОЛЬКО от РП-очков (плотность/прочность/термостойкость).',coefSaveAll:'💾 Сохранить всё',coefResetAll:'↺ Сбросить всё',coefPreview:'Превью расчетов',coefFooterNote:'Изменения сохраняются в таблице coefficients в Supabase.',coefBaseHpFromRp:'Базовое HP от РП-очков:',coefMatMultiplier:'Множитель материала:',coefFinalArmorHp:'Итоговое HP брони:',coefHpOnUnit:'HP на персонаже:',coefHpPerLevel:'HP за уровень:',coefFinalHp:'Итоговое HP:',coefModifier:'Модификатор',coefMax:'Максимум:',coefUnitGabrit:'Габарит юнита обычно = 1',coefCharLevel:'Персонаж',coefLevel:'уровня с ТЕЛ',coefArmorWith:'Броня с',coefDensity:'плотности',coefTensile:'прочности',coefThermal:'термостойкости',contributors:'УЧАСТНИКИ'},
  en:{home:'Home',search:'Search...',articles:'articles',noArticles:'No articles',noContent:'No content.',recentChanges:'Recent changes',draft:'DRAFT',new_tag:'NEW',edit_tag:'EDIT',editHome:'Edit home',other:'Other',login:'Sign in',loading:'Loading...',notFound:'Page not found',saveOk:'Saved!',saveErr:'Error:',cancel:'Cancel',save:'Save',delete:'Delete',create:'Create',close:'Close',logout:'Log out',edit:'Edit',editBtn:'✎ Edit',pages:'Pages',sections:'Sections',users:'Users',newPage:'+ New page',newSection:'+ New section',published:'Published',draft_status:'Draft',logoName:'Wiki',logoSub:'of the Classic Era',coefSystemSettings:'⚙ SYSTEM SETTINGS',coefTitle:'COEFFICIENTS',coefSubtitle:'Editing parameters of all wiki systems',coefHowHpWorks:'📖 HOW HP SYSTEM WORKS',coefArmorHp:'🛡 ARMOR HP',coefCharHp:'👤 CHARACTER HP',coefExample:'Example:',coefImportant:'Important:',coefNote:'Resources (scrap/ore/crystals/starvite) do NOT affect HP. HP depends ONLY on RP points (density/tensile/thermal).',coefSaveAll:'💾 Save all',coefResetAll:'↺ Reset all',coefPreview:'Calculation preview',coefFooterNote:'Changes are saved to coefficients table in Supabase.',coefBaseHpFromRp:'Base HP from RP points:',coefMatMultiplier:'Material multiplier:',coefFinalArmorHp:'Final armor HP:',coefHpOnUnit:'HP on character:',coefHpPerLevel:'HP per level:',coefFinalHp:'Final HP:',coefModifier:'Modifier',coefMax:'Maximum:',coefUnitGabrit:'Unit gabrit usually = 1',coefCharLevel:'Character',coefLevel:'level with CON',coefArmorWith:'Armor with',coefDensity:'density',coefTensile:'tensile',coefThermal:'thermal',contributors:'CONTRIBUTORS'},
};
const T = k => I18N[lang]?.[k] ?? I18N.ru[k] ?? k;
const pT = p => lang==='en' ? (p.title_ru?.trim()||p.title||'') : (p.title?.trim()||p.title_ru||'');
const pC = p => lang==='en' ? (p.content_ru?.trim()||p.content||'') : (p.content?.trim()||p.content_ru||'');
const sN = s => lang==='en' ? (s.name_en?.trim()||s.name_ru||'') : (s.name_ru?.trim()||s.name_en||'');
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const escId = s => String(s??'').replace(/[^a-zA-Z0-9_-]/g,'');
// jsq — экранирование строки для вставки ВНУТРЬ JS-строки, которая сама лежит
// в HTML-атрибуте, напр. onclick="fn('${jsq(x)}')".
// esc() тут НЕ спасает: браузер HTML-декодирует атрибут ДО запуска обработчика,
// превращая &#39; обратно в ' → значение выходит из JS-строки и исполняется как
// код (stored XSS). Мы кодируем каждый не-буквенно-цифровой символ в \uXXXX;
// движок JS декодирует их обратно в исходный текст в момент запуска, поэтому
// отображение (напр. подпись в лайтбоксе) остаётся правильным.
const jsq = s => String(s??'').replace(/[^0-9A-Za-z]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4,'0'));
const isVisiblePage = p => !p.slug?.startsWith('_') && !(p.page_type === 'location' && !canSeeLocations());
const fmtD = d => { if(!d) return '—'; const dt=new Date(d); return `${dt.getDate()} ${MOS[dt.getMonth()]} ${dt.getFullYear()}`; };
const uid  = () => Math.random().toString(36).slice(2,8);

const SAFE_VARIANTS_CALLOUT = new Set(['info','lore','warn']);
const SAFE_VARIANTS_ALERT   = new Set(['classified','secret','intel']);
const SAFE_LAYOUTS_IMGTEXT  = new Set(['l','r']);
const SAFE_STYLES_DIVIDER   = new Set(['ornament','stars','line']);
const SAFE_STYLES_HEADING   = new Set(['h-scan','h-gold','h-glitch','h-sub']);
const safeClass = (v,set,fb) => set.has(v) ? v : fb;
function safeUrl(u) {
  if (!u) return '#';
  const lo = u.trim().toLowerCase().replace(/\s/g,'');
  if (/^(javascript|data|vbscript|blob):/.test(lo)) return '#';
  return u;
}
// safeAvatar — валидатор URL аватара. Пропускает http(s) и data:image РАСТР
// (png/jpeg/gif/webp), но НЕ data:image/svg+xml: SVG может нести <script>/onload
// и исполнялся бы прямо в теге <img>. Всё прочее (javascript:, vbscript:, svg,
// произвольный текст) → '' (вызвавший код нарисует инициалы). Возвращает пустую
// строку, если URL небезопасен/некорректен.
function safeAvatar(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(s)) return s;
  return '';
}
// URL для CSS-контекста (background-image:url(...)). esc() здесь НЕ спасает: браузер
// HTML-декодирует &#39;/&quot; обратно в кавычки → выход из url('...') и CSS-инъекция.
// Пропускаем только чистый http(s)/относительный URL без символов разрыва.
function cssUrl(u) {
  u = String(safeUrl(u || ''));
  if (u === '#' || /["'()\\\s<>;]/.test(u)) return '';
  return u;
}

let _langBusy = false;
function setLang(l) {
  if (_langBusy) return; _langBusy = true;
  lang = l; localStorage.setItem('wk_lang', l);
  document.getElementById('lb-ru')?.classList.toggle('on', l==='ru');
  document.getElementById('lb-en')?.classList.toggle('on', l==='en');
  const sc = document.getElementById('sb-cnt');
  if (sc) sc.textContent = pages.length + (l==='en'?' pgs':' стр.');
  const sr = document.getElementById('srch');
  if (sr) { sr.placeholder = T('search'); sr.value = ''; }
  const logoName = document.getElementById('logo-name');
  const logoSub = document.getElementById('logo-sub');
  if (logoName) logoName.textContent = T('logoName');
  if (logoSub) logoSub.textContent = T('logoSub');
  const editBtnText = document.getElementById('edit-btn-text');
  if (editBtnText && !editMode) editBtnText.textContent = T('edit');
  buildNav();
  if (curSlug && !editMode) {
    if (curSlug==='home') renderHome().catch(()=>{});
    else if (curSlug.startsWith('sec:')) renderSectionPage(sections.find(s=>s.slug===curSlug.slice(4)));
    else if (_pgCache.has(curSlug)) renderPage(_pgCache.get(curSlug));
    else go(curSlug, false);
  }
  _langBusy = false;
}

function triggerHeroCoverUpload() {
    const urlInput = document.getElementById('cov-url');
    const preview = document.getElementById('hero-cov-preview');
    const previewImg = document.getElementById('hero-cov-preview-img');
    const fileInput = document.getElementById('hero-cov-file');
    const pcCtrl = document.getElementById('cov-pc-controls');

    if (urlInput) urlInput.value = _heroCoverUrl || '';
    if (fileInput) fileInput.value = '';
    if (preview && previewImg) {
      if (_heroCoverUrl) { previewImg.src = _heroCoverUrl; preview.style.display = 'block'; }
      else { preview.style.display = 'none'; }
    }
    if (pcCtrl) pcCtrl.style.display = 'none'; // home page has no height/position settings

    document.getElementById('cov-mo-title').textContent = lang==='ru'?'ОБЛОЖКА ГЛАВНОЙ':'HOME COVER';
    document.getElementById('cov-apply-btn').onclick = applyHeroCovFromModal;
    document.getElementById('cov-remove-btn').onclick = () => {
      document.getElementById('cov-url').value = '';
      applyHeroCovFromModal();
    };
    om('mo-cover');
  }
function heroCoverUrlPreview() {
  const url = document.getElementById('cov-url')?.value?.trim() || '';
  const preview = document.getElementById('hero-cov-preview');
  const previewImg = document.getElementById('hero-cov-preview-img');
  if (!preview || !previewImg) return;
  if (url) { previewImg.src = url; preview.style.display = 'block'; }
  else { preview.style.display = 'none'; }
}
async function heroCoverFileChange(input) {
  const file = input?.files?.[0];
  if (!file || !user) return;
  await handleImgUpload(file, url => {
    const urlInput = document.getElementById('cov-url');
    if (urlInput) urlInput.value = url;
    heroCoverUrlPreview();
  });
}
async function applyHeroCovFromModal() {
  const url = document.getElementById('cov-url')?.value?.trim() || '';
  _heroCoverUrl = url;
  localStorage.setItem('wk_hero_cover', _heroCoverUrl);
  saveHeroCoverToDb(_heroCoverUrl);
  cm('mo-cover');
  renderHome();
  toast(_heroCoverUrl ? 'Обложка обновлена' : 'Обложка удалена', 'ok');
}
async function saveHeroCoverToDb(url) {
  try {
    const homePg = _pgCache.get('home');
    if (!homePg?.id) return;
    await apiFetch('pages?id=eq.' + homePg.id, { method: 'PATCH', body: JSON.stringify({ image_url: url }) });
    const updated = { ..._pgCache.get('home'), image_url: url };
    _pgCache.set('home', updated);
  } catch(e) {}
}
async function loadHeroCoverFromDb() {
  const homePg = _pgCache.get('home');
  if (homePg?.image_url) { _heroCoverUrl = homePg.image_url; localStorage.setItem('wk_hero_cover', _heroCoverUrl); }
}

// Background is now loaded by loadSiteSettings() at startup


// ════════════════════════════════════════════════════════════
// LOADING QUOTES - рандомные цитаты вместо спиннера
// Структура: { text: 'цитата', author: 'автор' } или просто строка
// ════════════════════════════════════════════════════════════
const LOADING_QUOTES_RU = [
  { text: 'Увидимся в конце гиперпути', author: 'Капитан Юри' },
  { text: 'Попался, квестмастер!', author: 'Алексас Витаутас' },
  { text: 'Станя, что ты сделал?', author: 'Максимилиан Унгрен' },
  { text: 'Я не герой, я просто исполнитель...', author: 'Командующий обороной Акербо' },
  { text: 'Аугрусс не предавал', author: 'Аугрусс' },
  { text: 'Танер никого не убивал', author: 'Тот, кого не убивали' },
  { text: 'BIG SHOT!', author: 'Спамтон' },
  'Отписывайтесь и ставьте дизлайки!',
  { text: 'Ой, братишка, вернулся?', author: 'Пахом' },
  'Привет, Квантор!',
  { text: 'И помните: Саня Анякин приносит удачу!', author: 'Алексас Витаутас' },
  'САНЯ АНЯКИН ПРИНОСИТ УДАЧУ!',
  { text: 'Эту вики создал Пан-Пан', author: 'Автор вики' },
  { text: 'Странные сигналы доносятся из Коломора...', author: 'Фенгрик Малум' },
  { text: 'Саня, прикрой, там еще справа есть!', author: 'Неизвестный солдат СПО Азардана' },
  { text: 'Я снеговик Миша!', author: 'Максимилиан Унгрен' },
  { text: 'Вявявявявяввявя', author: 'Максимилиан Унгрен' },
  'Млекомеда 🤝 Объект Хога',
  { text: 'RIP НЭ', author: 'Евгения Краснова' },
  { text: 'Как простить тех, кто растоптал все то, что я когда-то так желал?', author: 'ИИ Т.Р.О.Н.' },
  { text: 'Автоматон всегда был мертв.', author: 'Автоматон Край' },
  { text: 'Прости меня, моё Акербо.', author: 'Командующий обороной Акербо' },
  'СИЯЙ!',
  { text: 'Данилов устал.', author: 'N.E.W.E.R.A.' },
  { text: 'Твои плечи несут все надежды галактики.', author: 'N.E.W.E.R.A.' },
  { text: 'Твой разум держит вес баланса всей вселенной.', author: 'N.E.W.E.R.A.' },
  'Текарус или Терминус?',
  { text: '... но в разгар торжества внезапный удар! Аугрусс восстал!', author: 'N.E.W.E.R.A.' },
  { text: 'Сирены взвыли в Имперской столице. Взывают к верным сыновьям отчизны.', author: 'N.E.W.E.R.A.' },
  { text: 'Битва за Текарусс рассудит всех.', author: 'Гал Радек' },
  { text: ' Я бы мог рассказать вам про последний поворот по эвольвенте...', author: 'Алан Сётис' },
  { text: 'Словно луч, я падаю, но не сияю. Как настоящий герой, что никогда не начнет сражение.', author: 'Алан Сётис' },
  'Альтан-тан-тан-тан-тан-тан-тан...',
  'А что Титов?',
  'Почему погиб Сатаст?',
  'Скажи, Альтаан...',
  { text: 'БОЛВЕРК, ПРЕДО МНОЙ СКЛОНИСЬ!', author: 'Адмирал альтаанского дредноута в битве за Болверк' },
  { text: 'ЗА РЕЙХСКЛИНГЕРА!', author: 'Адмирал альтаанского дредноута в битве за Болверк' },
  { text: '...их именами я пред вечностью клянусь. За каждого, кто в том огне канул в мрак, за дерзкий и отважный флот, за Вольный сегунат!', author: '2 кг межзвездной пыли Гильгамеш II' },
  { text: 'Клянусь я пронести сквозь Млекомеду и станций огни сказание о том, как сражались и пали они.', author: '2 кг межзвездной пыли Гильгамеш II' },
  { text: 'Каждая часть узла ненавидит узел свой.', author: 'Алан Сётис' },
  '...всех их перегрызи и подавись вселенной!',
  { text: 'И лазер не прожег броню, и плазма не согрела стали...', author: 'Неизвестный солдат ИПС в битве за Дур-Когольт' },
  { text: 'В битву, в вечный небосвод.', author: 'Малум Фенгрик' },
  'Эх, Азуми...',
  { text: 'Прости, Флавий, выжить должен я...', author: 'Алан Сётис' },
  'Тленный адмирал, тленный адмирал, что ж ты бедный заскучал?',
  { text: 'Гиперкрейсер, забери меня домой. Даже в подпространстве я чужой...', author: 'Алан Сётис' },
  'Меняются и время и мечты.',
  'Изменчивы под Солнцем все явления.',
  'Мне так хочется, чтоб стал ты здоровей...',
  'Он видно в ссоре с головою, видно сам себе он враг. Надо ж выдумать такое... Во дурак.',
  { text: 'Слава Бананоэре!', author: 'Слава! Слава! Слава!' },
  { text: 'Альтфальгар сверкает вдалеке...', author: 'Рейгсклингер' },
  'В краю магнолий плещет море...',
  'Годы КДВ в душе лелея...',
  { text: 'Я улечу от тебя даже без двигателей.', author: 'Наместник Фока' },
  'Ни о чем не сожалею, нельзя было пройти.',
  { text: 'Это я стал их смертью, ни трус, ни герой.', author: 'Адмирал Джейден' },
  { text: 'ДУХ АЗАРДАНА ИМ НЕ ПОБОРОТЬ!', author: 'Гал Радек' },
  'И Вирс возвратился на борт корабля...',
  { text: 'Внемли, галактика! Пробил твой час!', author: 'Аугрусс' },
  { text: 'ВЖизнь в новой эре коротка...', author: 'Аугрусс' },
  'Цель гармонистов проста',
  { text: 'Мертв Император, но кодекс живой.', author: 'Неизвестный коломорский поэт' },
  'Словно звездный мегалит...',
  'Империи великой мир един',
  { text: 'И Агон остыл, мор и тишина пришли за ним', author: 'Неизвестный кандерелианец' },
  { text: 'Я уже говорил тебе, что такое безумие?', author: 'Вас' },
  { text: 'Я последний рыцарь звезд, и мой удел предрешен.', author: 'Траюс' },
  { text: 'Лети вперед, эрлендийский эскадрон!', author: 'Капитан Юри' },
  { text: 'Вам Уравнитель покой принес!', author: 'Уравнитель несправедливости' },
  'От края и до края Млекомеды, за мною тенью ходят лишь беды...',
  'Расступись, межзвёздный странник!',
  { text: 'Связин - яд', author: 'Q84' },
  'Ты все так же прекрасна',
  { text: 'Вы укрываете у себя врагов святой ТНЭ, ведь так?', author: 'Александр Станиславский' },
  'Расслабься! Это всего лишь ракетостроение!',
  'Отдохни.',
  'Бро... У тебя всё получится и т.д.',
  'let\'s all love lain',
  { text: 'Если бы только Кирхайс был здесь...', author: 'Рейнхард фон Лоэнграмм' },
  'MIKU MIKU BEAM',
  { text: 'Ты агент Ахметова', author: 'Агент Ахметова' },
  { text: 'Космос должен быть мирным', author: 'Лорд Кекрон' },
  { text: 'Забудьте. Раскаяние самая бесполезная вещь на свете. ', author: 'Ремарк' },
  { text: 'Никогда матрос не бросит бескозырку насовсем', author: 'Шуудан' }
];

const LOADING_QUOTES_EN = [
  { text: 'See you at the end of the hyperpath', author: 'Queen Yuri' },
  'BIG SHOT!',
  'Unsubscribe and leave dislikes!',
  'Oh, bro, you\'re back?',
  'Hi, Quantor!',
  'And remember: Sanya Anyakin brings luck!',
  'SANYA ANYAKIN BRINGS LUCK!',
  'Sanya, cover me, there\'s more on the right!',
  'I am Misha the Snowman!',
  'Vyavyavyavyavyavya',
  'Setis rode through Setis...',
  'Milkomeda 🤝 Hoag\'s Object',
  'RIP NE',
  'SHINE!',
  'Tekarus or Terminus?',
  'Altan-tan-tan-tan-tan-tan-tan...',
  'And what about Titov?',
  'Why did Satast perish?',
  'Tell me, Altaan...',
  'Oh, Azumi...',
  'Gloomy admiral, gloomy admiral, why are you so bored, poor fellow?',
  'Both time and dreams change.',
  'All phenomena under the Sun are mutable.',
  'I want you to get healthier so badly...',
  'He must be out of his mind, clearly his own worst enemy. To invent such a thing... What a fool.',
  'In the land of magnolias, the sea splashes...',
  'Cherishing the KDV years in my soul...',
  'I regret nothing, there was no way through.',
  'And Veers returned aboard the ship...',
  'Life in the new era is short...',
  'The harmonists\' goal is simple',
  'Like a stellar megalith...',
  'The peace of the great Empire is whole',
  'Make way, interstellar wanderer!',
  'You are still as beautiful as ever',
  'Relax! It\'s just rocket science!',
  'Rest.',
  'Bro... You\'ll make it, etc.',
  'let\'s all love lain',
  'MIKU MIKU BEAM'
];

function getRandomQuote() {
  const quotes = lang === 'en' ? LOADING_QUOTES_EN : LOADING_QUOTES_RU;
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  
  // Если цитата - объект с автором, возвращаем HTML с красивым форматированием
  if (typeof quote === 'object' && quote.text) {
    return `<div class="quote-text">${esc(quote.text)}</div>${quote.author ? `<div class="quote-author">${esc(quote.author)}</div>` : ''}`;
  }
  
  // Иначе просто текст
  return esc(quote);
}

// ════════════════════════════════════════════════════════════
// LIGHTBOX для просмотра картинок
// ════════════════════════════════════════════════════════════
function openLightbox(imgSrc, imgAlt) {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  lightboxImg.src = imgSrc;
  lightboxImg.alt = imgAlt || '';
  lightbox.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  lightbox.classList.remove('show');
  document.body.style.overflow = '';
}

// Открыть модальное окно с картинкой из коллажа
function openCollageImageModal(imgUrl) {
  const modal = document.getElementById('mo-collage-img');
  const modalContent = modal?.querySelector('.mo');
  const img = document.getElementById('collage-modal-img');
  if (!modal || !img || !modalContent) return;
  
  // Сбрасываем размеры перед загрузкой
  modalContent.style.maxWidth = '90vw';
  modalContent.style.width = 'auto';
  img.src = imgUrl;
  
  // Подгоняем размер модального окна под картинку
  img.onload = () => {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const maxWidth = window.innerWidth * 0.9;
    const maxHeight = window.innerHeight * 0.85;
    
    let modalWidth;
    if (img.naturalWidth > maxWidth) {
      modalWidth = maxWidth;
    } else if (img.naturalHeight > maxHeight) {
      modalWidth = maxHeight * imgRatio;
    } else {
      modalWidth = img.naturalWidth;
    }
    
    modalContent.style.maxWidth = `${modalWidth}px`;
    modalContent.style.width = `${modalWidth}px`;
  };
  
  om('mo-collage-img');
}

// Обработчик кликов на картинки - максимально агрессивный перехват
document.addEventListener('click', function(e) {
  // Ищем картинку в цепочке клика
  let target = e.target;
  let img = null;
  
  // Если кликнули по картинке
  if (target.tagName === 'IMG') {
    img = target;
  }
  // Если кликнули по ссылке с картинкой внутри
  else if (target.tagName === 'A') {
    img = target.querySelector('img');
  }
  
  // Проверяем что это картинка в контенте
  if (img && (img.closest('.prose') || img.closest('.blk-image') || img.closest('.bim-i')) && !img.closest('.lightbox')) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openLightbox(img.src, img.alt);
    return false;
  }
}, true);

// Дополнительный перехват для ссылок с картинками
document.addEventListener('mousedown', function(e) {
  let target = e.target;
  if (target.tagName === 'IMG' && (target.closest('.prose') || target.closest('.blk-image') || target.closest('.bim-i'))) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}, true);

// Закрытие по Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeLightbox();
  }
});


// ════════════════════════════════════════════════════════════
// FAVICON & BACKGROUND LOADER FROM DATABASE
// ════════════════════════════════════════════════════════════

async function loadSiteSettings() {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/site_settings?key=in.(wk_favicon_url,wk_background_url)&select=key,value`,
      { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() } }
    );
    if (!r.ok) {
      console.warn('Settings table not found or not accessible');
      return;
    }
    const settings = await r.json();
    
    settings.forEach(s => {
      if (s.key === 'wk_favicon_url' && s.value) {
        localStorage.setItem('wk_favicon_url_cache', s.value);
        const favicon = document.getElementById('favicon');
        if (favicon) favicon.href = s.value;
      }
      // фон теперь локальный — wk_background_url игнорируем
    });
  } catch(e) {
    console.warn('Failed to load site settings:', e);
  }
}

// Загружаем настройки при старте
loadSiteSettings();


// ════════════════════════════════════════════════════════════

// АНТИ-МЕРЦАНИЕ ПРИ БРАУЗЕРНОМ ПИНЧ-ЗУМЕ

// При двупальцевом масштабировании страницы visualViewport.scale

// меняется, и браузер каждый кадр перерисовывает фиксированный blur-фон

// и сканлайны → стробоскоп. На время жеста вешаем .zooming на <html>

// (CSS в 21_perf.css гасит тяжёлые слои), снимаем через паузу после

// остановки жеста. Своя пинч-зум карты этим не затрагивается.

(function () {

  const vv = window.visualViewport;

  if (!vv) return;

  const root = document.documentElement;

  let lastScale = vv.scale, t = null, active = false;

  const stop = () => { active = false; root.classList.remove("zooming"); };

  vv.addEventListener("resize", () => {

    if (Math.abs(vv.scale - lastScale) <= 0.001) return; // не зум (ресайз/клавиатура)

    lastScale = vv.scale;

    if (!active && vv.scale !== 1) { active = true; root.classList.add("zooming"); }

    if (active) { clearTimeout(t); t = setTimeout(stop, 220); }

  });

})();

// ════════════════════════════════════════════════════════════
// MAP ZOOM & PAN MANAGER
// ════════════════════════════════════════════════════════════
const mapZoomState = {};
function mapZoomInit(viewportId) {
  const viewport = document.getElementById(viewportId);
  if (!viewport) return;
  mapZoomClean(viewportId);
  mapZoomState[viewportId] = { scale: 1, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0, listeners: {} };
  const s = mapZoomState[viewportId];
  s.listeners.wheel = (e) => mapZoomWheel(e, viewportId);
  s.listeners.mousedown = (e) => mapPanStart(e, viewportId);
  s.listeners.mousemove = (e) => mapPanMove(e, viewportId);
  s.listeners.mouseup = (e) => mapPanEnd(e, viewportId);
  s.listeners.mouseleave = (e) => mapPanEnd(e, viewportId);
  viewport.addEventListener('wheel', s.listeners.wheel, { passive: false });
  viewport.addEventListener('mousedown', s.listeners.mousedown);
  viewport.addEventListener('mousemove', s.listeners.mousemove);
  viewport.addEventListener('mouseup', s.listeners.mouseup);
  viewport.addEventListener('mouseleave', s.listeners.mouseleave);
}
function mapZoomClean(viewportId) {
  const state = mapZoomState[viewportId];
  if (!state || !state.listeners) return;
  const viewport = document.getElementById(viewportId);
  if (!viewport) return;
  const l = state.listeners;
  viewport.removeEventListener('wheel', l.wheel);
  viewport.removeEventListener('mousedown', l.mousedown);
  viewport.removeEventListener('mousemove', l.mousemove);
  viewport.removeEventListener('mouseup', l.mouseup);
  viewport.removeEventListener('mouseleave', l.mouseleave);
  delete mapZoomState[viewportId];
}
function mapZoomWheel(e, viewportId) {
  e.preventDefault();
  const state = mapZoomState[viewportId];
  if (!state) return;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  state.scale = Math.max(0.5, Math.min(4, state.scale * delta));
  mapZoomUpdate(viewportId);
}
function mapPanStart(e, viewportId) {
  if (e.button !== 0) return;
  const state = mapZoomState[viewportId];
  if (!state) return;
  state.dragging = true;
  state.startX = e.clientX;
  state.startY = e.clientY;
}
function mapPanMove(e, viewportId) {
  const state = mapZoomState[viewportId];
  if (!state || !state.dragging || state.scale <= 1) return;
  const dx = e.clientX - state.startX;
  const dy = e.clientY - state.startY;
  state.panX += dx;
  state.panY += dy;
  state.startX = e.clientX;
  state.startY = e.clientY;
  mapZoomUpdate(viewportId);
}
function mapPanEnd(e, viewportId) {
  const state = mapZoomState[viewportId];
  if (!state) return;
  state.dragging = false;
}
function mapZoomIn(viewportId) {
  const state = mapZoomState[viewportId];
  if (!state) return;
  state.scale = Math.min(4, state.scale * 1.2);
  mapZoomUpdate(viewportId);
}
function mapZoomOut(viewportId) {
  const state = mapZoomState[viewportId];
  if (!state) return;
  state.scale = Math.max(0.5, state.scale / 1.2);
  mapZoomUpdate(viewportId);
}
function mapZoomUpdate(viewportId) {
  const viewport = document.getElementById(viewportId);
  if (!viewport) return;
  const state = mapZoomState[viewportId];
  const svg = viewport.querySelector('svg');
  if (svg) svg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
}
