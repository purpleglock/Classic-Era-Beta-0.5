const HVP_CITY_KIND = {                                   // btype → постройка сцены
  doomgun: 'arty', nemesis: 'station', starbase: 'station',      // это — на орбите
  abm: 'abm', flak: 'shield', shipyard: 'shipyard',
  airfield: 'spaceport', trade: 'spaceport',
  military_factory: 'factory', ballfab: 'factory', shellforge: 'factory',
  factory: 'factory', goodsfab: 'factory', warehouse: 'factory',
  training: 'factory', intel: 'factory',
  mining: 'mine', mining_deep: 'mine', mining_exotic: 'mine',
  science: 'reactor', sci_giant: 'reactor', sci_anomaly: 'reactor',
  temple: 'temple', wellhub: 'palace'
};
const HVP_CITY_ATMO = { terran: 'terra', ocean: 'ocean', ice: 'ice', lava: 'arid', gas: 'toxic', rock: 'void' };
// Сид от pid планеты: один и тот же мир обязан выглядеть одинаково при каждом
// заходе (та же логика, что у [[planet-pid-identity]]).
function _hvpCitySeed(c) {
  const s = String((c && (c.planet_pid || c.id)) || 'x');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function _hvpLook(c) {
  const p = { type: c.planet_type || '', zone: c.zone };
  if (typeof gmPlanetLook === 'function') return gmPlanetLook(p);
  const t = (p.type || '').toLowerCase();
  if (/газ|giant|gas/.test(t)) return 'gas';
  if (/океан|вод|ocean/.test(t)) return 'ocean';
  if (/лёд|лед|ice|мёрз|замёрз/.test(t)) return 'ice';
  if (/пуст|desert|выжж|лав|вулк/.test(t)) return 'lava';
  if (/земн|terran|сад|gaia|столич|жизн/.test(t)) return 'terran';
  return 'rock';
}
// Текстура-развёртка планеты (та же, что на карте и в регистрации) — наматывается
// на canvas-сферу с терминатором и атмосферой (frDrawSphere из faction_reg.js).
function vnPortHtml() {
  if (typeof EC === 'undefined' || !EC.app) return '';
  const a = EC.app;
  const col = (typeof ecReadable === 'function' ? ecReadable(a.color) : (a.color || '#3a9bdc'));
  const flag = (a.herald_url || a.image_url || '');
  const L = _vnPortLeader;
  // Комната: стены-пилоны по бокам и балка сверху превращают панораму столицы
  // в ВИД ИЗ ОКНА. На левом пилоне — знамя державы, под ним портрет главы.
  // Архитектура кабинета — ОДНИМ SVG в перспективе (потолок, боковые стены, пол,
  // переплёт панорамного окна). Растягивается по кадру: пропорции сцены заданы
  // жёстко (1200/520), так что искажение минимально, зато стены всегда упираются
  // в края. Текст и картинки в SVG не кладём — их бы растянуло: знамя, портрет и
  // табличка идут отдельным HTML-слоем поверх левой стены.
  // ⚠️ ПРОШЛАЯ ВЕРСИЯ ЧИТАЛАСЬ КАК ТРИ КОРИЧНЕВЫХ КОРОБКИ В ТЕМНОТЕ, и вот почему:
  // (1) окно было плоским переплётом из rect'ов БЕЗ стекла и БЕЗ откосов — панорама
  //     упиралась прямо в чёрные палки, стеклу не за что было зацепиться глазом;
  // (2) стены заливались почти чёрным (#05080d…#233040) — знамя и портрет висели
  //     не НА стене, а в пустоте, потому что стены на экране просто не было видно.
  // Теперь: стены светлее и с освещённым пилястром ровно под убранством, окно —
  // с коробом-откосом, мелким шагом стоек и слоем стекла (тонировка + косые блики),
  // на правой стене — рабочий экран. Материал появился, «пустота» исчезла.
  const room = `<svg class="vnport-svg" viewBox="0 0 1200 520" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="vnpCeil" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0b111a"/><stop offset="1" stop-color="#22303f"/>
      </linearGradient>
      <linearGradient id="vnpWl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#0c131c"/><stop offset=".72" stop-color="#22303f"/>
        <stop offset="1" stop-color="#324458"/>
      </linearGradient>
      <linearGradient id="vnpWr" x1="1" y1="0" x2="0" y2="0">
        <stop offset="0" stop-color="#0c131c"/><stop offset=".72" stop-color="#22303f"/>
        <stop offset="1" stop-color="#324458"/>
      </linearGradient>
      <linearGradient id="vnpPil" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#1a2532"/><stop offset=".55" stop-color="#2b3b4e"/>
        <stop offset="1" stop-color="#1c2734"/>
      </linearGradient>
      <linearGradient id="vnpFloor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#22303f"/><stop offset="1" stop-color="#080c12"/>
      </linearGradient>
      <linearGradient id="vnpLamp" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${esc(col)}" stop-opacity=".55"/>
        <stop offset="1" stop-color="${esc(col)}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="vnpSpill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#bfe2ff" stop-opacity=".2"/>
        <stop offset="1" stop-color="#bfe2ff" stop-opacity="0"/>
      </linearGradient>
      <!-- стекло: холодная тонировка сверху вниз, чтобы вид «ушёл за плоскость» -->
      <linearGradient id="vnpGlass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8fc4ff" stop-opacity=".16"/>
        <stop offset=".55" stop-color="#7fb6f0" stop-opacity=".05"/>
        <stop offset="1" stop-color="#0a1420" stop-opacity=".14"/>
      </linearGradient>
      <clipPath id="vnpPane"><rect x="236" y="128" width="728" height="314"/></clipPath>
    </defs>
    <!-- ── СТЕКЛО. Идёт ПЕРВЫМ: панорама живёт отдельным слоем ПОД этим svg, и всё,
         что здесь рисуется в проёме, ложится на неё как отражение в остеклении. -->
    <g clip-path="url(#vnpPane)">
      <rect x="236" y="128" width="728" height="314" fill="url(#vnpGlass)"/>
      <g fill="#dbeeff" opacity=".07">
        <polygon points="236,442 470,128 604,128 320,442"/>
        <polygon points="660,442 838,128 884,128 706,442"/>
      </g>
      <rect x="236" y="128" width="728" height="2" fill="#eaf6ff" opacity=".22"/>
    </g>
    <!-- потолок с утопленными световыми панелями и световым карнизом -->
    <polygon points="0,0 1200,0 1000,100 200,100" fill="url(#vnpCeil)"/>
    <polygon points="286,16 914,16 878,44 322,44" fill="#cfe9ff" opacity=".1"/>
    <polygon points="322,58 878,58 848,82 352,82" fill="#cfe9ff" opacity=".065"/>
    <polygon points="0,0 1200,0 1000,100 200,100" fill="url(#vnpLamp)" opacity=".5"/>
    <polygon points="200,94 1000,94 1000,100 200,100" fill="${esc(col)}" opacity=".38"/>
    <!-- боковые стены с панельной расшивкой -->
    <polygon points="0,0 200,100 200,470 0,520" fill="url(#vnpWl)"/>
    <polygon points="1200,0 1000,100 1000,470 1200,520" fill="url(#vnpWr)"/>
    <!-- ПИЛЯСТР ЛЕВОЙ СТЕНЫ: освещённая плоскость ровно там, где HTML-слой вешает
         знамя и портрет. Без неё убранство читалось как наклейка на пустоте. -->
    <polygon points="4,8 182,94 182,474 4,516" fill="url(#vnpPil)"/>
    <polygon points="4,8 182,94 182,102 4,17" fill="${esc(col)}" opacity=".3"/>
    <polygon points="4,507 182,466 182,474 4,516" fill="#000000" opacity=".45"/>
    <g stroke="#ffffff" stroke-opacity=".06" stroke-width="2" fill="none">
      <path d="M0,132 L200,168"/><path d="M0,300 L200,318"/>
      <path d="M1200,132 L1000,168"/><path d="M1200,300 L1000,318"/>
      <path d="M1104,52 L1104,496"/>
    </g>
    <!-- рабочий экран на правой стене: кабинет обязан чем-то работать -->
    <polygon points="1022,150 1160,84 1160,300 1022,352" fill="#060a10" opacity=".9"/>
    <polygon points="1030,157 1152,99 1152,292 1030,344" fill="${esc(col)}" opacity=".16"/>
    <g fill="${esc(col)}" opacity=".5">
      <polygon points="1040,300 1058,293 1058,332 1040,338"/>
      <polygon points="1066,282 1084,274 1084,323 1066,330"/>
      <polygon points="1092,258 1110,250 1110,313 1092,321"/>
      <polygon points="1118,236 1136,227 1136,304 1118,312"/>
    </g>
    <!-- свет из окна ложится на стены -->
    <polygon points="200,100 200,470 96,496 96,52" fill="url(#vnpSpill)"/>
    <polygon points="1000,100 1000,470 1104,496 1104,52" fill="url(#vnpSpill)"/>
    <!-- пол и его отблеск -->
    <polygon points="0,520 200,470 1000,470 1200,520" fill="url(#vnpFloor)"/>
    <polygon points="248,470 952,470 1080,520 120,520" fill="#bfe2ff" opacity=".06"/>
    <!-- ── ОКНО. Простенок вокруг проёма + откос (у остекления есть толщина) + мелкий
         шаг стоек. Раньше проём был во всю дальнюю стену и делился на три плиты —
         из-за этого кадр и выглядел как три коробки, а не как окно. -->
    <path d="M200,100 H1000 V470 H200 Z M236,128 H964 V442 H236 Z" fill="#101823" fill-rule="evenodd"/>
    <g fill="#7f97b0" opacity=".28">
      <rect x="236" y="128" width="728" height="3"/><rect x="236" y="439" width="728" height="3"/>
      <rect x="236" y="128" width="3" height="314"/><rect x="961" y="128" width="3" height="314"/>
    </g>
    <g fill="#0a0f16">
      <rect x="236" y="209" width="728" height="7"/>
      <rect x="378" y="128" width="6" height="314"/><rect x="524" y="128" width="6" height="314"/>
      <rect x="670" y="128" width="6" height="314"/><rect x="816" y="128" width="6" height="314"/>
    </g>
    <g fill="#a9c0d8" opacity=".2">
      <rect x="378" y="128" width="1.5" height="314"/><rect x="524" y="128" width="1.5" height="314"/>
      <rect x="670" y="128" width="1.5" height="314"/><rect x="816" y="128" width="1.5" height="314"/>
      <rect x="236" y="209" width="728" height="1.5"/>
    </g>
    <!-- отбойник под окном и бра на стенах -->
    <rect x="200" y="452" width="800" height="18" fill="#0d141d"/>
    <rect x="200" y="452" width="800" height="2" fill="${esc(col)}" opacity=".3"/>
    <g fill="${esc(col)}" opacity=".55">
      <polygon points="112,200 132,206 132,222 112,214"/>
      <polygon points="1088,200 1068,206 1068,222 1088,214"/>
    </g>
  </svg>`;
  return `<div class="vnport-in" style="--fac:${col}">
      ${room}
      <div class="vnport-console">
        <div class="vnport-banner">
          <span class="vnport-rod"></span>
          <span class="vnport-cloth${flag ? '' : ' vnport-nocloth'}"
            ${flag ? `style="background-image:url(&quot;${esc(flag)}&quot;)"` : ''}></span>
        </div>
        ${L && L.name ? `<div class="vnport-lead">
          <div class="vnport-leadin">
            ${L.img ? `<img class="vnport-face" src="${esc(L.img)}" alt="" loading="lazy">`
                    : `<span class="vnport-noface">${esc((L.name || '?').slice(0, 2)).toUpperCase()}</span>`}
          </div>
          <div class="vnport-plate">
            <span class="vnport-led">${esc(L.name)}</span>
            <span class="vnport-tit">${esc(L.title || '')}</span>
          </div>
        </div>` : ''}
        <div class="vnport-fac">${esc(a.name || '')}</div>
      </div>
    </div>`;
}
function _hvpCityOpts(c, extra) {
  // У псевдоколонии державы (§_vnFactionStub) своих построек нет — берём ВСЕ её.
  const blds = c._stub ? ((typeof EC !== 'undefined' && EC.buildings) || [])
    : ((typeof EC !== 'undefined' && EC.buildings) || []).filter(b => b.colony_id === c.id);
  const kinds = [];
  blds.forEach(b => { const k = HVP_CITY_KIND[b.btype]; if (k && kinds.indexOf(k) < 0) kinds.push(k); });
  if (c.is_capital && kinds.indexOf('palace') < 0) kinds.unshift('palace');
  // Население берём по системе (EC.spatial — единственный источник, где оно есть);
  // если пусто — оцениваем по числу построек, чтобы пустая колония не выглядела
  // мегаполисом.
  const sp = (typeof EC !== 'undefined' && EC.spatial && EC.spatial[c.system_id]) || null;
  const pop = c._stub && c._pop ? c._pop
    : (sp && +sp.pop ? +sp.pop : Math.max(0.5, blds.length * 6));
  const app = (typeof EC !== 'undefined' && EC.app) || null;
  return Object.assign({
    seed: _hvpCitySeed(c),
    atmo: HVP_CITY_ATMO[_hvpLook(c)] || 'crimson',
    pop: pop,
    built: kinds.slice(0, 6),
    flag: app && (app.color || app.herald_url)
      ? { a: app.color || '#c1121a', b: '#f2f2f0', href: app.herald_url || app.image_url || '' } : null,
    star: { dist: 0.55 },
    light: true                                             // фон под интерфейсом — лёгкий кадр
  }, extra || {});
}
function _hvpCityBg(c, cls, w, h, extra) {
  if (typeof CG === 'undefined' || !CG || typeof CG.scene !== 'function') return '';
  let svg = '';
  try { svg = CG.scene(_hvpCityOpts(c, Object.assign({ w: w || 1600, h: h || 620 }, extra || {}))); } catch (e) { return ''; }
  return `<div class="${cls} hvp-city" aria-hidden="true">${svg}</div>`;
}

// Столица державы для фона новеллы: помеченная колония, иначе самая застроенная.
function _vnCapital() {
  const cols = (typeof EC !== 'undefined' && EC.colonies) || [];
  if (!cols.length) return null;
  return cols.find(c => c.is_capital) || cols.slice().sort((a, b) =>
    ((EC.buildings || []).filter(x => x.colony_id === b.id).length)
    - ((EC.buildings || []).filter(x => x.colony_id === a.id).length))[0] || null;
}
// ⚠️ Колонии может не быть ВООБЩЕ: столицу снесли войной, игрок только вступил в
// державу, планеты ещё не заселены. Раньше в этом случае слой молча не строился и
// на главной вечно висела старая обложка. Теперь при отсутствии колонии кадр
// собирается по самой ДЕРЖАВЕ: сид от её id, население — сумма по системам,
// постройки — все, что у неё есть. Пусто — значит будет пустой город, но будет.
function _vnCityLayer() {
  const c = _vnCapital() || _vnFactionStub();
  if (!c) { _vnCityWhy = 'нет ни колонии, ни державы (EC.app)'; return ''; }
  // Столицы нет — значит её потеряли. Кадр показывает не пустоту, а ПЕПЕЛИЩЕ:
  // срезанные взрывом башни, столбы дыма, сорванный флаг (city_gen ruin) — и
  // поверх глитч, будто сигнал с планеты рвётся.
  const dead = !!c._stub;
  // ⚠️ ГОРИЗОНТ ЗАДАЁМ ЯВНО, ИНАЧЕ В ОКНЕ ОДНО НЕБО. По умолчанию сцена ставит
  // землю на 99.5% высоты (city_gen scene): весь город оказывается прижат к самому
  // низу кадра — а низ закрыт окном диалога, и сквозь остекление кабинета видна
  // только плоская заливка неба (та самая «коричневая коробка»). Стекло начинается
  // на ~19% кадра и обрывается коробкой примерно на 2/3 — значит линия земли
  // должна лечь ровно туда: тогда силуэт столицы занимает нижнюю половину
  // видимого стекла, а улица с прохожими уходит за окно диалога.
  const html = _hvpCityBg(c, 'hp-hero-img', 1600, 590,
    { charZone: [0.6, 0.9], ruin: dead ? 1 : 0, horizon: Math.round(590 * 0.66) });
  if (!html) { _vnCityWhy = 'city_gen.js не подключён или упал'; return ''; }
  _vnCityWhy = 'ок: ' + (dead ? 'пепелище (столицы нет)' : 'по столице ' + (c.planet_name || c.id));
  let out = html.replace('<div class="hp-hero-img', '<div id="hp-hero-city" class="hp-hero-img');
  if (!dead) return out;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  // Второй экземпляр той же картинки — «съехавший» канал: без копии RGB-разрыв
  // пришлось бы делать фильтром, а он мылит штрих и убивает всю графику.
  const svg = out.slice(out.indexOf('<svg'), out.lastIndexOf('</div>'));
  return out.replace('</div>',
      `<span class="vnq-slice" aria-hidden="true">${svg}</span>`
    + `<span class="vnq-scan" aria-hidden="true"></span>`
    + `<span class="vnq-cap">${en ? 'SIGNAL LOST · CAPITAL DESTROYED' : 'СИГНАЛ ПОТЕРЯН · СТОЛИЦА УНИЧТОЖЕНА'}</span></div>`)
    .replace('class="hp-hero-img hvp-city"', 'class="hp-hero-img hvp-city vnq"');
}
let _vnCityWhy = 'ещё не строился';
// Псевдоколония державы — когда своей планеты нет.
window._probe={room:vnPortHtml,city:_vnCityLayer};
