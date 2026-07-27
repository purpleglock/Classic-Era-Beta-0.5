// ════════════════════════════════════════════════════════════
// НОВЕЛЛА · «Дозвёздные» — найденные примитивные цивилизации и решения по ним.
// Сервер: _precursor_decisions.sql (precursor_get / precursor_act).
// Лор и правила: lore/precursor_civs.md. Каркас — тот же оверлей, что «Синли-бей».
//
// Видит держава только те миры, где у неё есть колония в системе (или уже был
// контакт). Тир показывается ВИДИМЫЙ: Розенкрейцеры и ушедшие в космос врут.
// ════════════════════════════════════════════════════════════
let _pcState = null, _pcOpenCiv = null;

const PC_TIER = ['племена', 'бронза', 'железо и вера', 'паруса и пар', 'атомный век', 'на пороге космоса'];
// Названия шрамов берём прямо из банка генератора (их около сотни) — держать
// вторую копию списка бессмысленно, она сразу разойдётся.
const PC_SCAR_FALLBACK = {
  forbidden: 'Запрещённые технологии', deathind: 'Индустрия смерти', mindctl: 'Манипуляция сознанием',
  earlynuke: 'Ранняя ядерная война', anthropo: 'Антропофаги', moralfall: 'Нравственное падение',
  hiddenarm: 'Тайное оружие', oversoul: 'Теория сверхсущества', rosicruc: 'Розенкрейцеры',
  synarchy: 'Синархия', stimul: 'Стимуляторы интеллекта', shaman: 'Древние традиции',
  exodus: 'Уход в космос', luddite: 'Неолуддизм', awakenai: 'Проснувшийся ИИ', mouse: 'Мышиный прогресс',
};
function pcScarName(id) {
  const bank = (window.Precursors && window.Precursors.CARDS) || [];
  const c = bank.find(x => x.id === id);
  return (c && c.name) || PC_SCAR_FALLBACK[id] || id;
}
// «через 3 дн.» / «сегодня» — недельные часы истории (§10 лора)
function pcWhen(iso, nowIso) {
  if (!iso) return '';
  const t = Date.parse(iso), now = nowIso ? Date.parse(nowIso) : Date.now();
  if (!t) return '';
  const d = Math.ceil((t - now) / 86400000);
  return d <= 0 ? 'вот-вот' : d === 1 ? 'завтра' : `через ${d} дн.`;
}
// Зеркало серверного _pc_cost — цены должны совпадать, иначе кнопка врёт.
function pcCost(action, tier) {
  return action === 'uplift' ? 500000 + 150000 * tier
    : action === 'protect' ? 300000 + 120000 * tier
    : action === 'purge' ? 220000 + 80000 * tier
    : action === 'enslave' ? 260000 + 110000 * tier
    : action === 'convert' ? 340000 + 130000 * tier : 0;   // 'lesson' бесплатен: платит флот
}
// Добрая воля дорожает с каждым разом — зеркало серверного _pc_gift_cost.
function pcGiftCost(action, tier, gifts) {
  const base = action === 'gift' ? 120000 + 40000 * tier
    : action === 'envoy' ? 60000 + 20000 * tier
    : action === 'miracle' ? 200000 + 60000 * tier : 0;
  return Math.round(base * (1 + 0.35 * Math.min(6, Math.max(0, gifts || 0))));
}
const PC_GOODWILL = ['gift', 'envoy', 'miracle'];
// Что закрыто укладом державы (сервер: _pc_forbidden). Список приходит с данными.
function pcForbidden(action) {
  const list = (_pcState && _pcState.forbidden) || [];
  return list.indexOf(action) >= 0;
}
function pcNum(v) { return Math.round(Number(v) || 0).toLocaleString('ru-RU'); }
// ── ИКОНКИ ───────────────────────────────────────────────
// Смайликов во вкладке нет: каждое решение и каждый статус — это арт из
// assets/precursor/<ключ>.webp, который заливает админка («Дозвёздные» →
// локальный аплоад-сервер, батник «Загрузка артов.bat»). Пока файла нет, на его
// месте стоит короткий буквенный код — не эмодзи и не пустое место.
const PC_ART_DIR = 'assets/precursor';
const PC_ICO = {
  study: 'НАБ', uplift: 'ВОЗ', protect: 'ПРТ', harvest: 'ВЫК', convert: 'ВЕР',
  enslave: 'РАБ', purge: 'ЗАЧ', gift: 'ДАР', envoy: 'МИС', miracle: 'ЗНМ', lesson: 'УРК',
  st_wild: 'ДИК', st_uplifted: 'ВОЗ', st_protectorate: 'ПРТ', st_drained: 'ВЫП',
  st_dead: 'МРТ', st_spacefaring: 'ЗВД', world: 'МИР', star: 'ЗВД',
};
function pcIco(key, cls) {
  const code = PC_ICO[key] || '·';
  return `<span class="pc-ico${cls ? ' ' + cls : ''}" data-code="${esc(code)}">`
       + `<img src="${PC_ART_DIR}/${esc(key)}.webp" alt="" loading="lazy" onerror="this.remove()"></span>`;
}
// Даты — ровно те же, что в новостях: звёздная дата (fnStardate, faction_news.js).
// Так датируется только то, что случилось при нас (см. _precursor_chron_dates.sql);
// их собственное прошлое идёт по их же годам — pcEraYear ниже.
function pcStamp(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (isNaN(+dt)) return '';
  if (typeof fnStardate === 'function') return fnStardate(iso);
  return `ЗВ.ДАТА ${3000 + (dt.getFullYear() - 2026)}`;
}
// ── ИХ ЛЕТОИСЧИСЛЕНИЕ ────────────────────────────────────
// Дописанное прошлое случилось до нас, нашей даты у него быть не может — но и
// «до контакта» на каждой строке читается как заглушка. Поэтому считаем ИХ год:
// сейчас 3000-й галактический, каждая эпоха занимает столько лет, сколько ниже.
const PC_ERA_YEARS = [1500, 900, 700, 600, 450, 400, 350, 300, 200, 120, 70, 40];
const PC_NOW_YEAR = 3000;
// Год окончания эпохи k для мира, который сейчас в фазе cur.
function pcEraYear(k, cur) {
  let back = 0;
  for (let i = Math.max(0, k) + 1; i <= cur; i++) back += PC_ERA_YEARS[i] || 0;
  return PC_NOW_YEAR - back;
}
// Разбираем метку записи: 'E6' → 6, всё прочее → null.
function pcEraOf(ph) {
  const m = /^E(\d+)$/.exec(String(ph || ''));
  return m ? Math.max(0, Math.min(11, +m[1])) : null;
}
// Что за руины и что они дают игроку — иначе строка «Руины: Даллерианцы»
// не значит ровным счётом ничего.
const PC_RUINS = {
  'Даллерианцы': ['предтечи', 'Планета помнит Даллерианцев — тех, кто правил галактикой десятки тысяч лет назад и рухнул. Их обломки лежат в земле у народа, который до них не дорос: изучение такого мира даёт вдвое больше науки, а выкачивание — разовую находку сверх обычного.'],
  'свои': ['их собственные', 'Они уже падали. Под их городами — руины их же прошлой цивилизации: та зашла дальше и не удержалась. Второй заход по той же лестнице.'],
  'предыдущая волна': ['чужие, безымянные', 'До них на этой планете жил кто-то ещё и не дожил. Кто именно — не знают ни они, ни вы.'],
};
function pcRuins(v) {
  const r = PC_RUINS[v];
  return r ? { short: `${v} — ${r[0]}`, hint: r[1] }
           : { short: 'нет', hint: 'Планета чистая: до них здесь никто не строил.' };
}
// Полоска 0..100 для благополучия и отношения (−100..+100 сжимаем в 0..100)
function pcMeter(val, cls) {
  const w = Math.max(0, Math.min(100, val));
  return `<span class="pc-meter"><i class="${cls}" style="width:${w}%"></i></span>`;
}
function pcFact(k, v, hint) {
  return `<div class="pc-fact"${hint ? ` title="${esc(hint)}"` : ''}>
    <span class="pc-fact-k">${esc(k)}</span><span class="pc-fact-v">${v}</span></div>`;
}
// Население — в тех же единицах, что у колоний державы (см. _precursor_pop_scale.sql).
function pcPop(v) { return pcNum(v); }
// Кулдаун решения: сервер даёт 20 часов на «действие» и отдельно на изучение.
const PC_CD_H = 20;
function pcCd(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!t) return 0;
  return Math.max(0, t + PC_CD_H * 3600000 - Date.now());
}
function pcCdTxt(ms) {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
}
// Заголовок блока решений: сразу видно, свободны ли руки.
function _pcActsHead(cdStudy, cdAct, cdGift) {
  const busy = [];
  if (cdStudy > 0) busy.push('наблюдение ' + pcCdTxt(cdStudy));
  if (cdAct > 0) busy.push('вмешательство ' + pcCdTxt(cdAct));
  if (cdGift > 0) busy.push('дары ' + pcCdTxt(cdGift));
  return `<div class="sn-sec">Решения${busy.length ? ' · занято: ' + esc(busy.join(' · ')) : ''}</div>`;
}

function heroVNTamaClose() {
  const el = document.getElementById('hp-vn-tama');
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '';
  _pcOpenCiv = null;
  if (typeof _heroVNView !== 'undefined' && _heroVNView === 'tama') _heroVNView = null;
}
function heroVNTamaReturn() { heroVNChoice('menu'); }
function _pcHead(en) {
  const rep = _pcState ? (+_pcState.rep || 0) : 0;
  const repTxt = rep >= 0 ? 'Фонд: претензий нет' : `Фонд: досье ${rep}`;
  return `<div class="hp-vn-col-head">
    <span class="hp-vn-col-title">${en ? 'Pre-stellar worlds' : 'Дозвёздные миры'}</span>
    <span class="hp-vnr-clr">${esc(repTxt)}</span>
    <button class="hp-vn-col-x" type="button" onclick="event.stopPropagation();heroVNTamaReturn()">↩ ${en ? 'back' : 'назад'}</button>
  </div>`;
}
function _pcMsg(t) { return `<div class="hp-vn-col-body hp-vn-sinli-body"><div class="hp-vn-col-empty">${esc(t)}</div></div>`; }

async function heroVNTamaOpen() {
  const el = document.getElementById('hp-vn-tama');
  if (!el) return;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
  _pcOpenCiv = null;
  el.innerHTML = _pcHead(en) + _pcMsg('Поднимаю сводки наблюдательных постов…');
  try {
    if (typeof ecLoadApp === 'function') await ecLoadApp();
    if (typeof EC === 'undefined' || !EC.app || !EC.app.faction_id) {
      el.innerHTML = _pcHead(en) + _pcMsg('Зарегистрируйте державу — без неё наблюдательных постов нет.');
      return;
    }
  } catch (e) {}
  await heroVNTamaRefresh();
}

async function heroVNTamaRefresh() {
  const el = document.getElementById('hp-vn-tama');
  if (!el || !el.classList.contains('show')) return;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  try { _pcState = await ecRpc('precursor_get'); }
  catch (e) {
    el.innerHTML = _pcHead(en) + _pcMsg('Сеть наблюдения молчит. Применён ли _precursor_decisions.sql?');
    return;
  }
  if (!el.classList.contains('show')) return;
  const civs = (_pcState && _pcState.civs) || [];
  if (_pcOpenCiv) {
    const c = civs.find(x => x.system_id === _pcOpenCiv.s && x.pid === _pcOpenCiv.p);
    if (c) { el.innerHTML = _pcHead(en) + `<div class="hp-vn-col-body hp-vn-sinli-body">${_pcCard(c)}</div>`; return; }
    _pcOpenCiv = null;
  }
  el.innerHTML = _pcHead(en) + `<div class="hp-vn-col-body hp-vn-sinli-body">${_pcList(civs)}</div>`;
}

function _pcList(civs) {
  const parts = ['<div class="sn-col">'];
  parts.push(`<div class="fc-rule">Мораторий Фонда по защите от невмешательства действует с 2986 года. Всё, что вы сделаете на этих страницах, — нарушение. Изучение Фонд терпит; остальное записывает.<br>
    <i>История этих миров идёт сама: раз в неделю каждый делает шаг по своей летописи. Дошедший до звёздного полёта перестаёт быть находкой и становится державой на карте.</i>
    ${_pcState && _pcState.enlightened ? '<br>Ваш уклад (демократия/эгалитаризм или пацифизм/ксенофилия) закрывает геноцид, рабство, выкачивание, протектораты и карательные удары. Наблюдать, возвышать и проповедовать — можно.' : ''}
    ${_pcState && +_pcState.faith_boost > 1 ? '<br>Обращённые миры разгоняют ваши храмы: ставка ×' + (+_pcState.faith_boost).toFixed(2) + '.' : ''}</div>`);
  if (!civs.length) {
    parts.push(`<div class="hp-vn-col-empty" style="padding:8px">Ни одного дозвёздного мира рядом. Их видно только там, где у державы есть колония в системе.</div></div>`);
    return parts.join('');
  }
  const now = _pcState && _pcState.now;
  const live = civs.filter(c => c.status !== 'dead' && c.status !== 'spacefaring');
  const risen = civs.filter(c => c.status === 'spacefaring');
  const gone = civs.filter(c => c.status === 'dead');
  const row = c => {
    const st = c.status === 'spacefaring' ? 'держава' : c.status === 'protectorate' ? 'протекторат'
      : c.status === 'uplifted' ? 'возвышены' : c.status === 'drained' ? 'выпиты досуха'
      : c.status === 'dead' ? 'мертвы' : 'без контакта';
    const mood = c.status === 'spacefaring' ? '#9fc7ff'
      : c.attitude >= 25 ? '#7fd18a' : c.attitude <= -25 ? '#e0736a' : '#d8c07a';
    const clock = c.status === 'spacefaring' || c.status === 'dead' ? ''
      : ` · шаг ${pcWhen(c.next_step_at, now)}`;
    return `<div class="sn-row">
      <span class="sn-row-nm" style="color:${mood}">${pcIco(c.status === 'spacefaring' ? 'star' : 'world', 'pc-ico-sm')} ${esc(c.status === 'spacefaring' ? (c.state_name || c.self_name) : c.self_name)}
        <i>${esc(c.planet_name || '?')} · ${esc(PC_TIER[c.visible_tier] || '?')} · ${esc((c.races || [])[0] || '')} · ${esc(st)}${clock}</i></span>
      <button class="hp-vn-btn" type="button" onclick="event.stopPropagation();heroVNTamaShow('${jsq(c.system_id)}',${+c.pid})">Досье</button>
    </div>`;
  };
  parts.push(`<div class="sn-sec">Наблюдаемые миры · ${live.length}</div>`);
  parts.push(live.map(row).join('') || `<div class="hp-vn-col-empty" style="padding:8px">Живых не осталось.</div>`);
  if (risen.length) {
    parts.push(`<div class="sn-sec">Вышли к звёздам · ${risen.length}</div>`);
    parts.push(risen.map(row).join(''));
  }
  if (gone.length) {
    parts.push(`<div class="sn-sec">Вычеркнуты · ${gone.length}</div>`);
    parts.push(gone.map(row).join(''));
  }
  parts.push('</div>');
  return parts.join('');
}

function _pcCard(c) {
  const gc = _pcState ? (+_pcState.gc || 0) : 0;
  const now = _pcState && _pcState.now;
  const scars = (c.scars || []).map(pcScarName);
  const dead = c.status === 'dead';
  const risen = c.status === 'spacefaring';
  // Летопись: у каждой строки своя дата. Живое (вмешательства, недельный ход)
  // — по нашему календарю, как в новостях. Дописанное прошлое — по ИХ годам.
  const cur = Math.max(0, Math.min(11, +c.phase || 0));
  const chron = (c.chronicle || []).map((l, i, all) => {
    const era = pcEraOf(l.ph);
    // строки без метки эпохи (пролог, '—') относим к эпохе ближайшей следующей
    let e2 = era;
    for (let k = i; e2 == null && k < all.length; k++) e2 = pcEraOf(all[k].ph);
    const stamp = pcStamp(l.at);
    const when = stamp ? (l.approx ? '≈ ' : '') + stamp
      : `ЗВ.ДАТА ${pcEraYear(e2 == null ? 0 : e2, cur)}`;
    const tip = stamp ? 'Случилось при нас — дата по галактическому календарю.'
      : 'Их собственная хроника: год по галактическому счёту, восстановлен по глубине культурного слоя.';
    return { when, tip, live: !!stamp, l };
  }).reverse().map(x => `<div class="pc-chr${x.l.scar ? ' pc-chr-scar' : ''}${x.live ? ' pc-chr-live' : ' pc-chr-era'}">
      <span class="pc-chr-when" title="${esc(x.tip)}">${esc(x.when)}</span>
      <span class="pc-chr-txt"><b>${esc(x.l.ph || '')}</b> ${esc(x.l.text || '')}${
        x.l.scar ? ` <i>(шрам: ${esc(pcScarName(x.l.scar))})</i>` : ''}</span>
    </div>`).join('');
  // Полоса истории: 12 фаз плюс звёздный полёт. Шаг — раз в неделю (§10 лора).
  const ph = Math.max(0, Math.min(11, +c.phase || 0));
  const PH = (window.Precursors && window.Precursors.PHASES) || [];
  const bar = Array.from({ length: 12 }, (_, k) => {
    const p = PH[k] || {};
    const cls = risen || k < ph ? 'pc-ph-done' : k === ph ? 'pc-ph-now' : '';
    return `<i class="pc-ph ${cls}" title="E${k} · ${esc(p.name || '')}${p.anchor ? ' — ' + esc(p.anchor) : ''}"></i>`;
  }).join('') + `<i class="pc-ph pc-ph-star${risen ? ' pc-ph-done' : ''}" title="Звёздный полёт: мир становится державой на карте">ЗВД</i>`;
  const ru = pcRuins(c.ruins);
  // Кулдаун считаем ЗДЕСЬ, а не ловим отказ сервера: кнопка, которую можно
  // нажать и получить «слишком рано», — это просто ловушка.
  const cdAct = pcCd(c.last_act_at), cdStudy = pcCd(c.last_study_at), cdGift = pcCd(c.last_gift_at);
  const gifts = +((c.flags || {}).gifts) || 0;
  const act = (id, label, hint) => {
    const good = PC_GOODWILL.indexOf(id) >= 0;
    const cost = good ? pcGiftCost(id, c.tier, gifts) : pcCost(id, c.tier);
    const ban = pcForbidden(id);
    const cd = id === 'study' ? cdStudy : good ? cdGift : cdAct;
    const poor = !ban && cost > gc;
    // «Урок» — единственное решение, которому мало колонии: нужен флот на месте
    const noFleet = id === 'lesson' && !c.fleet;
    const off = ban || poor || cd > 0 || noFleet;
    const why = ban ? 'закрыто укладом державы'
      : noFleet ? 'в системе нет вашего флота — подведите корабли к их звезде'
      : cd > 0 ? `${good ? 'корабль с дарами вернётся' : id === 'study' ? 'пост занят наблюдением' : 'руки заняты'} — ещё ${pcCdTxt(cd)}`
      : poor ? `не хватает ${pcNum(cost - gc)} ГС из ${pcNum(cost)}` : '';
    return `<div class="pc-act${off ? ' pc-act-off' : ''}${good ? ' pc-act-good' : ''}">
      ${pcIco(id, 'pc-ico-md')}
      <span class="pc-act-nm">${esc(label)}
        <i>${esc(hint)}</i>
        ${why ? `<u>${esc(why)}</u>` : ''}</span>
      <span class="pc-act-r">
        ${cost ? `<span class="pc-act-cost${poor ? ' pc-act-poor' : ''}">${pcNum(cost)} ГС</span>` : ''}
        <button class="hp-vn-btn${off ? ' hp-vn-back' : ''}" type="button" ${off ? 'disabled' : ''}
          onclick="event.stopPropagation();heroVNTamaAct('${jsq(c.system_id)}',${+c.pid},'${id}')">${
            ban ? '—' : noFleet ? 'нет флота' : cd > 0 ? 'ждать' : 'Решить'}</button>
      </span>
    </div>`;
  };
  const parts = ['<div class="sn-col">'];
  parts.push(`<button class="hp-vn-btn hp-vn-back" type="button" style="align-self:flex-start"
    onclick="event.stopPropagation();heroVNTamaBack()">← к списку</button>`);
  const statusTxt = dead ? 'мертвы' : risen ? 'держава'
    : c.status === 'protectorate' ? 'протекторат' : c.status === 'uplifted' ? 'возвышены'
    : c.status === 'drained' ? 'выпиты досуха' : 'контакта не было';
  const stKey = 'st_' + (dead ? 'dead' : risen ? 'spacefaring'
    : c.status === 'protectorate' ? 'protectorate' : c.status === 'uplifted' ? 'uplifted'
    : c.status === 'drained' ? 'drained' : 'wild');
  const att = +c.attitude || 0;
  parts.push(`<div class="pc-hero">
    <div class="pc-hero-nm">${pcIco(risen ? 'star' : 'world', 'pc-ico-lg')} ${esc(risen ? (c.state_name || c.self_name) : c.self_name)}
      <span class="pc-chip${dead ? ' pc-chip-dead' : ''}">${pcIco(stKey, 'pc-ico-sm')} ${esc(statusTxt)}</span></div>
    <div class="pc-hero-sub">${esc(c.planet_name || '?')} · система ${esc(c.system_name || c.system_id)}${
      c.env ? ' · ' + esc(c.env) : ''}</div>
  </div>`);

  parts.push(`<div class="pc-grid">
    ${pcFact('Народ', esc((c.races || []).join(' + ')) + (c.synergy ? ` <i>«${esc(c.synergy)}»</i>` : ''),
      'Раса задаёт темп истории и то, какие эпохи им вообще доступны.')}
    ${pcFact('Уклад', `${esc(c.gov || '—')} · ${esc(c.ideology || '—')}`,
      'Как они устроены внутри и во что верят. Идеология меняется от того, что с ними случается.')}
    ${pcFact('Развитие', `${esc(PC_TIER[c.visible_tier] || '?')}${
      c.visible_tier !== c.tier ? ' <i>(по данным разведки)</i>' : ''}`,
      'Уровень, который видит ваша разведка. Часть миров умеет казаться проще, чем есть.')}
    ${pcFact('Население', `<span class="pc-fact-n">${pcPop(c.pop)}</span>`,
      'В тех же единицах, что население ваших колоний. Растёт с каждой эпохой; войны и выкачивание его срезают.')}
    ${pcFact('Благополучие', `<span class="pc-fact-n">${+c.wellbeing}</span> ${pcMeter(+c.wellbeing, 'pc-m-wb')}`,
      'Сытость и порядок. Ниже 8 история встаёт: неделя уходит на выживание.')}
    ${pcFact('К гостям', `<span class="pc-fact-n">${att > 0 ? '+' : ''}${att}</span> ${pcMeter((att + 100) / 2, att >= 25 ? 'pc-m-ok' : att <= -25 ? 'pc-m-bad' : 'pc-m-mid')}`,
      'Отношение к пришедшим с неба. От него зависит, согласятся ли они на протекторат и вашу веру.')}
    ${pcFact('Руины', esc(ru.short), ru.hint)}
  </div>`);
  parts.push(`<div class="fc-rule">${esc(ru.hint)}${
    scars.length ? '<br>Шрамы истории: <b>' + esc(scars.join(', ')) + '</b> — следы того, что уже случилось с ними и осталось в характере.' : ''}${
    c.race_scar ? '<br><i>' + esc(c.race_scar) + '</i>' : ''}</div>`);

  // ── ход истории ──
  if (!dead) {
    parts.push(`<div class="sn-sec">Ход истории</div>`);
    parts.push(`<div class="pc-era">
      <div class="pc-era-bar">${bar}</div>
      ${risen
        ? `<div class="pc-era-txt"><b>${esc(c.state_name || c.self_name)}</b> — держава на карте с ${esc(pcStamp(c.sovereign_at) || String(c.sovereign_at || '').slice(0, 10))}. Дозвёздными решениями здесь больше не распоряжаются.</div>`
        : `<div class="pc-era-txt">Эпоха <b>E${ph} · ${esc(c.phase_name || (PH[ph] && PH[ph].name) || '?')}</b>${
            PH[ph] && PH[ph].anchor ? ` <i>(${esc(PH[ph].anchor)})</i>` : ''}<br>
            Следующий шаг ${esc(pcWhen(c.next_step_at, now) || 'не назначен')}${
              c.steps_left != null ? ` · до звёздного полёта шагов: <b>${+c.steps_left}</b>` : ''}. Раз в неделю мир делает шаг по своей летописи сам, без вас.${
            c.status === 'drained' ? '<br><i>Выпитый досуха мир не идёт вперёд: неделя уходит на то, чтобы отдышаться.</i>' : ''}</div>`}
    </div>`);
  }

  if (dead) {
    parts.push(`<div class="hp-vn-col-empty" style="padding:8px">Решать больше нечего.</div>`);
  } else if (risen) {
    parts.push(_pcActsHead(cdStudy, cdAct, cdGift));
    parts.push(act('study', 'Изучать', 'наблюдение за равными; Фонд не возражает'));
    parts.push(`<div class="hp-vn-col-empty" style="padding:8px">Остальное — уже не «решения по примитивам», а внешняя политика.</div>`);
  } else {
    parts.push(_pcActsHead(cdStudy, cdAct, cdGift));
    parts.push(act('study', 'Изучать', 'наука с их истории; Фонд не возражает'));
    // Добрая воля — единственный рычаг отношения, а от него зависят протекторат
    // и проповедь. Свои часы (last_gift_at), отдача падает с каждым разом.
    parts.push(`<div class="pc-sub">Добрая воля${gifts ? ` · знаков внимания: ${gifts}` : ''}</div>`);
    parts.push(act('gift', 'Дар с неба', 'зерно, лекарства и металл, каких они не куют: отношение и благополучие вверх; −5 к досье Фонда'));
    parts.push(act('envoy', 'Тихая миссия', 'без чудес: чинить колодцы, оставлять карты, слушать песни; дёшево и понемногу; −2'));
    parts.push(act('miracle', 'Знамение', 'ночь горящего неба: отношение прыгает разом, но мир уходит в спиритуализм; −10'));
    parts.push(`<div class="pc-sub">Вмешательство</div>`);
    parts.push(c.phase < 11
      ? act('uplift', 'Возвысить', 'эпоха вперёд — на шаг ближе к звёздам; они запомнят покровителя; −15 к досье Фонда')
      : act('uplift', 'Дать им звёзды', 'вытолкнуть с порога в космос: держава родится сегодня и под вашей рукой; −15 к досье Фонда'));
    if (c.status !== 'protectorate') parts.push(act('protect', 'Протекторат', 'может не выйти — у них бывает мнение; −35'));
    if (c.status !== 'drained') parts.push(act('harvest', 'Выкачивать', 'деньги в обмен на их благополучие; −20'));
    parts.push(c.faith_fid
      ? `<div class="pc-act pc-act-off">${pcIco('convert', 'pc-ico-md')}<span class="pc-act-nm">Обратить в веру
          <i>${c.faith_fid === (_pcState && _pcState.fid) ? 'этот мир уже поёт ваше имя' : 'мир уже принял чужую веру'}</i></span></div>`
      : act('convert', 'Обратить в веру', (_pcState && _pcState.faith
          ? 'целая планета адептов «' + _pcState.faith + '»: +25% к ставке ваших храмов (потолок ×2); может не выйти; −25'
          : 'нужна своя религия — без неё проповедовать нечего') + ''));
    parts.push(act('enslave', 'Увести в рабство', 'не убить, а вывезти: невольники вливаются в пул рабочих; −45'));
    parts.push(act('lesson', 'Урок будет усвоен', ph > 0
      ? `удар с орбиты, платить не за что: эпоху назад (E${ph} → E${ph - 1}), благополучие −35, население −четверть; ${
          c.fleet ? 'флот на месте' : 'нужен флот в системе'}; об этом узнает вся галактика; −50`
      : `откатывать некуда: ниже E0 эпох нет, и урок станет истреблением; ${
          c.fleet ? 'флот на месте' : 'нужен флот в системе'}; узнает вся галактика; −75`));
    parts.push(act('purge', 'Истребить', 'необратимо, планета освобождается; −60'));
  }
  parts.push(`<div class="sn-sec">Летопись · новое сверху</div>`);
  parts.push(chron
    ? `<div class="pc-chron">${chron}</div>`
    : `<div class="hp-vn-col-empty" style="padding:8px">Летопись не сохранилась.</div>`);
  parts.push('</div>');
  return parts.join('');
}

function heroVNTamaShow(sysId, pid) { _pcOpenCiv = { s: sysId, p: +pid }; heroVNTamaRefresh(); }
function heroVNTamaBack() { _pcOpenCiv = null; heroVNTamaRefresh(); }

const PC_CONFIRM = {
  uplift: 'Толкнуть их на целую эпоху вперёд? Обратно эту историю не отмотать. Если они уже на пороге — это отправит их к звёздам сегодня.',
  harvest: 'Забрать у них ресурсы и труд? Их благополучие просядет, а память — нет.',
  protect: 'Объявить протекторат? Если откажутся — деньги пропадут, а отношение испортится.',
  purge: 'Истребить цивилизацию целиком? Это необратимо, и Фонд узнает.',
  enslave: 'Увести часть населения в рабство? Планета останется жить — но уже без них.',
  miracle: 'Устроить им знамение? Отношение подскочит разом, но после такой ночи мир станет спиритуалистическим, и переубеждать его будет уже некому.',
  lesson: 'Дать урок? Флот сожжёт всё, что они построили: мир отбросит на целую эпоху назад, и подниматься по ней он будет заново. Об ударе узнает вся галактика — сводка уйдёт без адресата. Если откатывать уже некуда, урок станет истреблением.',
  convert: 'Отдать им вашу веру? Если примут — целый мир будет петь ваше имя, и храмы державы станут вдвое звонче.',
};
async function heroVNTamaAct(sysId, pid, action) {
  const en = (typeof lang !== 'undefined' && lang === 'en');
  if (PC_CONFIRM[action] && !confirm(PC_CONFIRM[action])) return;
  try {
    const r = await ecRpc('precursor_act', { p_system_id: sysId, p_pid: +pid, p_action: action });
    if (typeof toast === 'function') toast((r && r.txt) || 'Готово', r && r.ok === false ? 'err' : 'ok');
  } catch (e) {
    const m = ((e && e.message) || e) + '';
    const nice = m.includes('not enough gc') ? 'Не хватает ГС.'
      : m.includes('too soon') ? 'Слишком рано — до следующего захода ещё меньше суток.'
      : m.includes('no fleet in system') ? 'В их системе нет вашего флота. Урок дают корабли, а не донесения: подведите флот к звезде.'
      : m.includes('no presence') ? 'Нет колонии в этой системе — до них не дотянуться.'
      : m.includes('another patron') ? 'Этот мир уже под чужим покровительством.'
      : m.includes('belongs to another patron') ? 'Этот мир уже под чужим покровительством.'
      : m.includes('civ is gone') ? 'Там уже некого решать.'
      : m.includes('nothing left') ? 'Выкачивать больше нечего.'
      : m.includes('civ is sovereign') ? 'Это уже держава, а не находка: так с ними больше нельзя.'
      : m.includes('already at the threshold') ? 'Выше некуда — они уже на пороге космоса.'
      : m.includes('already a protectorate') ? 'Они и так под протекторатом.'
      : m.includes('forbidden by creed') ? 'Уклад вашей державы этого не допускает: ни геноцида, ни рабства, ни выкачивания, ни протекторатов, ни ударов по беззащитным.'
      : m.includes('no faith of your own') ? 'Сначала своя религия — проповедовать пока нечего.'
      : m.includes('already converted') ? 'Этот мир уже нашёл себе небо.'
      : 'Ошибка: ' + m;
    if (typeof toast === 'function') toast(nice, 'err');
  }
  if (typeof ecReloadPaint === 'function') { try { await ecReloadPaint(); } catch (e) {} }
  await heroVNTamaRefresh();
}
