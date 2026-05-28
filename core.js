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
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnbmdra2lpb3B5bXZyY296dnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MzU5MjgsImV4cCI6MjA5NTUxMTkyOH0.ejFOy6cDNsAj9yCnWOVub0L2tunm9l32BfkgBI_mZFk';

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// localStorage — сессия живёт между обновлениями страницы
// ────────────────────────────────────────────────────────────────────────────────────────────────────
const sb = supabase.createClient(SB_URL, SB_ANON, {
  auth: {
    persistSession: true,
    storageKey: 'wk12_session',
    storage: window.localStorage,
    lock: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  }
});

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
  const r = await fetch(SB_URL + '/rest/v1/' + path, { ...opts, headers });
  if (r.status === 204) return null;
  const d = await r.json();
  if (!r.ok) throw new Error(d?.message || d?.error || 'HTTP ' + r.status);
  return d;
}
const dbGet  = (t, q='')    => apiFetch(`${t}?${q}`);
const dbPost = (t, b)       => apiFetch(t,       { method:'POST',  body: JSON.stringify(b) });
const dbPatch= (t, q, b)    => apiFetch(`${t}?${q}`, { method:'PATCH', body: JSON.stringify(b) });
const dbDel  = (t, q)       => apiFetch(`${t}?${q}`, { method:'DELETE' });

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
const VALID_ROLES = ['superadmin','editor','moderator','viewer'];
const MOS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

let userProfile = { display_name: '', avatar_url: '' };
let allProfiles = [];
let _heroCoverUrl = localStorage.getItem('wk_hero_cover') || '';

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// I18N
// ────────────────────────────────────────────────────────────────────────────────────────────────────
const I18N = {
  ru:{home:'Главная',search:'Поиск...',articles:'статей',noArticles:'Нет статей',noContent:'Нет содержимого.',recentChanges:'История изменений',draft:'ЧЕРНОВИК',new_tag:'НОВОЕ',edit_tag:'ПРАВКА',editHome:'Редактировать главную',other:'Разное',login:'Войти',loading:'Загрузка...',notFound:'Страница не найдена',saveOk:'Сохранено!',saveErr:'Ошибка:',cancel:'Отмена',save:'Сохранить',delete:'Удалить',create:'Создать',close:'Закрыть',logout:'Выйти',edit:'Редактировать',editBtn:'✎ Редактировать',pages:'Страницы',sections:'Разделы',users:'Пользователи',newPage:'+ Новая страница',newSection:'+ Новый раздел',published:'Опубликован',draft_status:'Черновик',logoName:'Вики',logoSub:'новой эры',coefSystemSettings:'⚙ НАСТРОЙКИ СИСТЕМЫ',coefTitle:'КОЭФФИЦИЕНТЫ',coefSubtitle:'Редактирование параметров всех систем вики',coefHowHpWorks:'📖 КАК РАБОТАЕТ СИСТЕМА HP',coefArmorHp:'🛡 HP БРОНИ',coefCharHp:'👤 HP ПЕРСОНАЖА',coefExample:'Пример:',coefImportant:'Важно:',coefNote:'Ресурсы (чермет/руда/кристаллы/старвис) НЕ влияют на HP. HP зависит ТОЛЬКО от РП-очков (плотность/прочность/термостойкость).',coefSaveAll:'💾 Сохранить всё',coefResetAll:'↺ Сбросить всё',coefPreview:'Превью расчетов',coefFooterNote:'Изменения сохраняются в таблице coefficients в Supabase.',coefBaseHpFromRp:'Базовое HP от РП-очков:',coefMatMultiplier:'Множитель материала:',coefFinalArmorHp:'Итоговое HP брони:',coefHpOnUnit:'HP на персонаже:',coefHpPerLevel:'HP за уровень:',coefFinalHp:'Итоговое HP:',coefModifier:'Модификатор',coefMax:'Максимум:',coefUnitGabrit:'Габарит юнита обычно = 1',coefCharLevel:'Персонаж',coefLevel:'уровня с ТЕЛ',coefArmorWith:'Броня с',coefDensity:'плотности',coefTensile:'прочности',coefThermal:'термостойкости',contributors:'УЧАСТНИКИ'},
  en:{home:'Home',search:'Search...',articles:'articles',noArticles:'No articles',noContent:'No content.',recentChanges:'Recent changes',draft:'DRAFT',new_tag:'NEW',edit_tag:'EDIT',editHome:'Edit home',other:'Other',login:'Sign in',loading:'Loading...',notFound:'Page not found',saveOk:'Saved!',saveErr:'Error:',cancel:'Cancel',save:'Save',delete:'Delete',create:'Create',close:'Close',logout:'Log out',edit:'Edit',editBtn:'✎ Edit',pages:'Pages',sections:'Sections',users:'Users',newPage:'+ New page',newSection:'+ New section',published:'Published',draft_status:'Draft',logoName:'Wiki',logoSub:'of the New Era',coefSystemSettings:'⚙ SYSTEM SETTINGS',coefTitle:'COEFFICIENTS',coefSubtitle:'Editing parameters of all wiki systems',coefHowHpWorks:'📖 HOW HP SYSTEM WORKS',coefArmorHp:'🛡 ARMOR HP',coefCharHp:'👤 CHARACTER HP',coefExample:'Example:',coefImportant:'Important:',coefNote:'Resources (scrap/ore/crystals/starvite) do NOT affect HP. HP depends ONLY on RP points (density/tensile/thermal).',coefSaveAll:'💾 Save all',coefResetAll:'↺ Reset all',coefPreview:'Calculation preview',coefFooterNote:'Changes are saved to coefficients table in Supabase.',coefBaseHpFromRp:'Base HP from RP points:',coefMatMultiplier:'Material multiplier:',coefFinalArmorHp:'Final armor HP:',coefHpOnUnit:'HP on character:',coefHpPerLevel:'HP per level:',coefFinalHp:'Final HP:',coefModifier:'Modifier',coefMax:'Maximum:',coefUnitGabrit:'Unit gabrit usually = 1',coefCharLevel:'Character',coefLevel:'level with CON',coefArmorWith:'Armor with',coefDensity:'density',coefTensile:'tensile',coefThermal:'thermal',contributors:'CONTRIBUTORS'},
};
const T = k => I18N[lang]?.[k] ?? I18N.ru[k] ?? k;
const pT = p => lang==='en' ? (p.title_ru?.trim()||p.title||'') : (p.title?.trim()||p.title_ru||'');
const pC = p => lang==='en' ? (p.content_ru?.trim()||p.content||'') : (p.content?.trim()||p.content_ru||'');
const sN = s => lang==='en' ? (s.name_en?.trim()||s.name_ru||'') : (s.name_ru?.trim()||s.name_en||'');
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const escId = s => String(s??'').replace(/[^a-zA-Z0-9_-]/g,'');
const isVisiblePage = p => !p.slug?.startsWith('_');
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
      if (s.key === 'wk_background_url' && s.value) {
        localStorage.setItem('wk_background_url_cache', s.value);
        document.body.style.setProperty('--bg-image', `url('${s.value}')`);
      }
    });
  } catch(e) {
    console.warn('Failed to load site settings:', e);
  }
}

// Загружаем настройки при старте
loadSiteSettings();
