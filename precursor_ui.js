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
    : action === 'convert' ? 340000 + 130000 * tier : 0;
  // 'lesson' бесплатен: платит флот. 'rite' бесплатен: платит вера.
}
// Добрая воля дорожает с каждым разом — зеркало серверного _pc_gift_cost.
function pcGiftCost(action, tier, gifts) {
  const base = action === 'gift' ? 120000 + 40000 * tier
    : action === 'envoy' ? 60000 + 20000 * tier
    : action === 'miracle' ? 200000 + 60000 * tier : 0;
  return Math.round(base * (1 + 0.35 * Math.min(6, Math.max(0, gifts || 0))));
}
const PC_GOODWILL = ['gift', 'envoy', 'miracle'];
// Завет — зеркало _pc_covenant_cost. Ритуал на весь мир, а не подарок вождю.
function pcCovenantCost(tier) { return 1500000 + 250000 * Math.max(0, tier || 0); }
// Зеркала _pc_cap / _pc_loyalty (_precursor_bonds.sql). Сервер считает то же
// самое; здесь это нужно, чтобы объяснить игроку, ВО ЧТО он упёрся.
function pcCap(c) {
  return Math.max(0, Math.min(100, 40 + 6 * Math.max(0, Math.min(11, +c.phase || 0)))
    - Math.max(0, +c.grudge || 0) - Math.max(0, (+c.dependency || 0) - 40));
}
function pcLoy(c) {
  if (c.loyalty != null) return +c.loyalty;
  return Math.min(pcCap(c), Math.round(0.45 * (+c.attitude || 0) + 0.55 * (+c.trust || 0)));
}
// Почему потолок именно такой — по пунктам, самым больным вперёд.
function pcCapWhy(c) {
  const out = [];
  const ph = 40 + 6 * Math.max(0, Math.min(11, +c.phase || 0));
  if (ph < 100) out.push(`эпоха E${+c.phase || 0} держит потолок на ${Math.min(100, ph)}: они ещё не мыслят вас как силу, которой можно быть верным`);
  if (+c.grudge > 0) out.push(`память обид −${+c.grudge}`);
  if (+c.dependency > 40) out.push(`зависимость от подачек −${(+c.dependency) - 40}`);
  return out.join(' · ');
}
const PC_NEED_NM = {
  famine: 'Голод', plague: 'Мор', beast: 'Зверь', drought: 'Засуха', war: 'Война царств',
  schism: 'Раскол веры', flood: 'Потоп', collapse: 'Крах хозяйства', reactor: 'Реактор',
};
// Что закрыто укладом державы (сервер: _pc_forbidden). Список приходит с данными.
function pcForbidden(action) {
  const list = (_pcState && _pcState.forbidden) || [];
  return list.indexOf(action) >= 0;
}
// Есть ли беда СЕЙЧАС (не просроченная) — используется и карточкой, и списком.
function pcActiveNeed(c) {
  return c.needs && (!c.needs.until || Date.parse(c.needs.until) > Date.now()) ? c.needs : null;
}
// ── ГОЛОС МИРА ───────────────────────────────────────────
// Досье было таблицей цифр: юзер открывал её и не понимал, во что смотрит и
// чем управляет. Добавляем то же, что уже есть у наводчицы Длани (см. лор
// doom-aim-novel) — шапка-арт с репликой ПЕРЕД таблицей. Цифры остаются (они
// объясняют МЕХАНИКУ), реплика объясняет, ЧТО это значит здесь и сейчас.
// Настроение решает сервер (числа), мы только читаем их и выбираем тон.
// Порядок проверок важен: беда и Завет перекрывают обычную арифметику отношения.
function pcMood(c, need) {
  if (c.status === 'dead' || c.status === 'spacefaring') return 'legacy';
  if (need) return 'plea';
  if (c.status === 'covenant') return 'covenant';
  const att = +c.attitude || 0, tr = +c.trust || 0, gr = +c.grudge || 0, dep = +c.dependency || 0;
  if (gr >= 25 || att <= -30) return 'hostile';
  if (dep >= 55) return 'craven';
  if (tr >= 55 && att >= 15) return 'devoted';
  if (tr >= 25 && att >= 10) return 'warm';
  return 'wary';
}
// Детерминированный выбор из банка — стабильно для мира между перерисовками,
// но разное у разных миров (сид = система+планета+настроение).
function pcPick(seed, bank) {
  if (!bank || !bank.length) return bank;
  const h = (typeof ecHash === 'function') ? ecHash(seed) : 0;
  return bank[h % bank.length];
}
const PC_SPEECH = {
  hostile: [
    ['Опять вы.', 'Мы помним, чьих рук это дело — небо для нас теперь не пусто, оно занято вами.'],
    ['Уходите.', 'Каждый ваш дар нам дороже обходится, чем вы думаете.'],
    ['Ничего не просим.', 'Просто держитесь подальше от наших костров.'],
  ],
  craven: [
    ['Что вы принесли на этот раз?', 'Без вас мы уже не помним, как это делалось раньше — своими руками.'],
    ['Ждём с неба.', 'Дайте ещё, и мы забудем, зачем нам свои кузни.'],
  ],
  warm: [
    ['Вы снова здесь.', 'Небо к вам благосклонно, и мы понемногу учимся вам верить.'],
    ['Костры горят спокойнее с тех пор, как вы рядом.', 'Ещё не свои — но уже не чужие.'],
  ],
  devoted: [
    ['Мы вас ждали.', 'Кем бы вы ни были там, среди звёзд, — здесь вам верят без вопросов.'],
    ['Наши дети растут, зная ваше имя.', 'Что бы вы ни попросили — мы услышим.'],
  ],
  covenant: [
    ['Мы отказались от собственного неба.', 'Не потому, что вы велели, — потому что здесь лежит то, что важнее наших кораблей.'],
    ['Святилища открыты.', 'Мы храним чужое наследство и отдаём его вам, пока вы остаётесь теми, кому мы поверили.'],
  ],
  wary: [
    ['Небо было пустым. Теперь в нём вы.', 'Мы ещё не решили, что это значит.'],
    ['Смотрим на вас издалека.', 'Пока — только смотрим.'],
  ],
};
function pcSpeech(c, need, mood) {
  if (mood === 'plea') return [String(need.text || '').trim()];
  if (mood === 'legacy') return c.status === 'dead'
    ? ['Здесь больше некому говорить.']
    : ['Мы помним, с чего начинали.', 'Теперь у нас свой голос среди звёзд — и своя история, которую пишем сами.'];
  return pcPick(c.system_id + '|' + c.pid + '|' + mood, PC_SPEECH[mood] || PC_SPEECH.wary);
}
// Шапка-арт (assets/precursor/mood_<ключ>.webp) + реплика поверх — тот же
// паттерн пропавшей картинки → цветной градиент, что у Длани (нет арта, пока
// админ не залил — не беда, фон уже несёт настроение).
function pcBanner(c, need, mood) {
  // Кто говорит — сам мир, а не выдуманный титул: сочинять «голос трона» по
  // строке уклада было враньём (у мира E4 нет никакого трона).
  const who = mood === 'plea' ? 'Перехват с поверхности'
    : mood === 'legacy' && c.status === 'dead' ? 'Эфир пуст'
    : mood === 'legacy' ? (c.state_name || c.self_name)
    : c.self_name;
  const lines = pcSpeech(c, need, mood).filter(Boolean);
  return `<div class="pc-vn-banner pc-vn-mood-${esc(mood)}">
    <img class="pc-vn-banner-img" src="${PC_ART_DIR}/mood_${esc(mood)}.webp" alt="" loading="lazy"
      onload="this.classList.add('ok')" onerror="this.remove()">
    <div class="pc-vn-banner-scrim"></div>
    <div class="pc-vn-say">
      <div class="pc-vn-say-who">${esc(who)}</div>
      ${lines.map(l => `<p class="pc-vn-say-l">${esc(l)}</p>`).join('')}
    </div>
  </div>`;
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
  answer: 'ПМЩ', covenant: 'ЗВТ', rite: 'ОБР',
  st_wild: 'ДИК', st_uplifted: 'ВОЗ', st_protectorate: 'ПРТ', st_drained: 'ВЫП', st_covenant: 'ЗВТ',
  st_dead: 'МРТ', st_spacefaring: 'ЗВД', world: 'МИР', star: 'ЗВД',
};
// Тон иконки = цена решения, а не просто «фирменный цвет вкладки». Дар и
// геноцид одним цветом — враньё интерфейсу: по строке должно быть видно, что
// именно ты собираешься сделать, ещё до того как прочитана подпись.
//   ok   — сталь: наблюдение и нейтральные статусы, Фонд не возражает;
//   good — зелёный: помощь, дары, возвышение;
//   take — янтарь: они живы, но вы их доите (протекторат, выкачка, вера);
//   evil — кровь: рабство, карательный урок, истребление, мёртвый мир.
const PC_TONE = {
  study: 'ok', world: 'ok', star: 'ok', st_wild: 'ok', st_spacefaring: 'ok',
  gift: 'good', envoy: 'good', miracle: 'good', uplift: 'good', st_uplifted: 'good',
  answer: 'good', covenant: 'good', st_covenant: 'good',
  protect: 'take', harvest: 'take', convert: 'take', st_protectorate: 'take', st_drained: 'take',
  enslave: 'evil', purge: 'evil', lesson: 'evil', st_dead: 'evil', rite: 'evil',
};
function pcIco(key, cls) {
  const code = PC_ICO[key] || '·';
  const tone = PC_TONE[key] || 'ok';
  return `<span class="pc-ico pc-t-${tone}${cls ? ' ' + cls : ''}" data-code="${esc(code)}">`
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
function heroVNTamaReturn() { heroVNBack('tama'); }
function _pcHead(en) {
  const rep = _pcState ? (+_pcState.rep || 0) : 0;
  const repTxt = rep >= 0 ? 'Фонд: претензий нет' : `Фонд: досье ${rep}`;
  return `<div class="hp-vn-col-head">
    <span class="hp-vn-col-title">${en ? 'FPNI · Foundation for Protection from Non-Interference'
                                       : 'FPNI · Фонд по защите от невмешательства'}</span>
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
    const why = (e && (e.message || e.hint || e.details)) || String(e || '');
    el.innerHTML = _pcHead(en) + _pcMsg('Сеть наблюдения молчит: ' + esc(why));
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
  parts.push(`<div class="fc-rule">Лояльность не покупается. Она складывается из мнения о вас и из <b>доверия</b>, и упирается в потолок: эпоха мира, память его обид и его же зависимость от ваших подачек. Дары поднимают мнение и тут же поднимают зависимость — три подряд, и вы построили себе карго-культ с крышей. Настоящий рычаг один: <b>приходить на их беду</b>.<br>
    Лояльность 90 открывает <b>Завет</b>: мир отказывается от собственного звёздного полёта и остаётся при вас. Если под ним лежат руины Даллерианцев — каждые сутки он отдаёт <b>ихор</b>, которого нет больше нигде.${
      _pcState && +_pcState.ichor > 0 ? ' Ихора на складе: <b>' + (+_pcState.ichor).toFixed(1) + '</b>.' : ''}</div>`);
  if (!civs.length) {
    parts.push(`<div class="hp-vn-col-empty" style="padding:8px">Ни одного дозвёздного мира рядом. Их видно только там, где у державы есть колония в системе.</div></div>`);
    return parts.join('');
  }
  const now = _pcState && _pcState.now;
  const live = civs.filter(c => c.status !== 'dead' && c.status !== 'spacefaring');
  const risen = civs.filter(c => c.status === 'spacefaring');
  const gone = civs.filter(c => c.status === 'dead');
  const row = c => {
    const st = c.status === 'spacefaring' ? 'держава' : c.status === 'covenant' ? 'Завет'
      : c.status === 'protectorate' ? 'протекторат'
      : c.status === 'uplifted' ? 'возвышены' : c.status === 'drained' ? 'выпиты досуха'
      : c.status === 'dead' ? 'мертвы'
      : (c.contacted_by || c.contacted_at || +c.acts > 0) ? 'контакт есть' : 'без контакта';
    const mood = c.status === 'spacefaring' ? '#9fc7ff'
      : c.attitude >= 25 ? '#7fd18a' : c.attitude <= -25 ? '#e0736a' : '#d8c07a';
    const clock = c.status === 'spacefaring' || c.status === 'dead' ? ''
      : ` · шаг ${pcWhen(c.next_step_at, now)}`;
    const needFlag = pcActiveNeed(c) ? ' · <b style="color:#e0b45f">взывают о помощи</b>' : '';
    return `<div class="sn-row">
      <span class="sn-row-nm" style="color:${mood}">${pcIco(c.status === 'spacefaring' ? 'star' : 'world', 'pc-ico-sm')} ${esc(c.status === 'spacefaring' ? (c.state_name || c.self_name) : c.self_name)}
        <i>${esc(c.planet_name || '?')} · ${esc(PC_TIER[c.visible_tier] || '?')} · ${esc((c.races || [])[0] || '')} · ${esc(st)}${clock}${needFlag}</i></span>
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
  const need = pcActiveNeed(c);
  const mood = pcMood(c, need);
  const act = (id, label, hint) => {
    const good = PC_GOODWILL.indexOf(id) >= 0;
    const cost = id === 'answer' ? (need ? +need.ask || 0 : 0)
      : id === 'covenant' ? pcCovenantCost(c.tier)
      : good ? pcGiftCost(id, c.tier, gifts) : pcCost(id, c.tier);
    const ban = pcForbidden(id);
    // Помощь в беде и Завет своих часов не занимают: беда не ждёт кулдауна.
    const cd = id === 'study' ? cdStudy : (id === 'answer' || id === 'covenant') ? 0 : good ? cdGift : cdAct;
    const poor = !ban && cost > gc;
    // «Урок» — единственное решение, которому мало колонии: нужен флот на месте
    const noFleet = id === 'lesson' && !c.fleet;
    // Завет: то, что не покупается — сначала лояльность, потом деньги
    const covBlock = id !== 'covenant' ? '' :
        (pcLoy(c) < 90 ? `лояльность ${pcLoy(c)} из 90 (потолок ${pcCap(c)})`
       : (+c.phase || 0) < 8 ? 'слишком рано: Завет заключают не с дикарями, а с народом, который умеет договариваться'
       : (+c.grudge || 0) > 10 ? `они помнят слишком много: память обид ${+c.grudge} при допустимых 10`
       : (+c.dependency || 0) > 45 ? `они не партнёры, а просители: зависимость ${+c.dependency} при допустимых 45` : '');
    const off = ban || poor || cd > 0 || noFleet || !!covBlock;
    const why = ban ? 'закрыто укладом державы'
      : covBlock ? covBlock
      : noFleet ? 'в системе нет вашего флота — подведите корабли к их звезде'
      : cd > 0 ? `${good ? 'корабль с дарами вернётся' : id === 'study' ? 'пост занят наблюдением' : 'руки заняты'} — ещё ${pcCdTxt(cd)}`
      : poor ? `не хватает ${pcNum(cost - gc)} ГС из ${pcNum(cost)}` : '';
    // Тон и арт живут на всей строке: подложка справа и цвет полосы слева —
    // это то же решение, что и в иконке, только читается периферийным зрением.
    return `<div class="pc-act pc-t-${PC_TONE[id] || 'ok'}${off ? ' pc-act-off' : ''}${good ? ' pc-act-good' : ''}">
      <img class="pc-act-bg" src="${PC_ART_DIR}/${esc(id)}.webp" alt="" loading="lazy" onerror="this.remove()">
      <span class="pc-act-nm">${esc(label)}
        <i>${esc(hint)}</i>
        ${why ? `<u>${esc(why)}</u>` : ''}</span>
      <span class="pc-act-r">
        ${cost ? `<span class="pc-act-cost${poor ? ' pc-act-poor' : ''}">${pcNum(cost)} ГС</span>` : ''}
        <button class="hp-vn-btn${off ? ' hp-vn-back' : ''}" type="button" ${off ? 'disabled' : ''}
          onclick="event.stopPropagation();heroVNTamaAct('${jsq(c.system_id)}',${+c.pid},'${id}')">${
            ban ? '—' : covBlock ? 'рано' : noFleet ? 'нет флота' : cd > 0 ? 'ждать'
            : id === 'answer' ? 'Помочь' : id === 'covenant' ? 'Заключить' : 'Решить'}</button>
      </span>
    </div>`;
  };
  const parts = ['<div class="sn-col">'];
  parts.push(`<button class="hp-vn-btn hp-vn-back" type="button" style="align-self:flex-start;margin-bottom:10px"
    onclick="event.stopPropagation();heroVNTamaBack()">← к списку</button>`);
  parts.push(pcBanner(c, need, mood));
  // «Контакта не было» врало: status остаётся 'wild' и после даров, проповеди
  // и десятка записей в летописи. Правда о контакте — contacted_by/acts.
  const touched = !!(c.contacted_by || c.contacted_at || +c.acts > 0);
  const statusTxt = dead ? 'мертвы' : risen ? 'держава'
    : c.status === 'covenant' ? 'в Завете'
    : c.status === 'protectorate' ? 'протекторат' : c.status === 'uplifted' ? 'возвышены'
    : c.status === 'drained' ? 'выпиты досуха'
    : touched ? 'контакт установлен' : 'контакта не было';
  const stKey = 'st_' + (dead ? 'dead' : risen ? 'spacefaring'
    : c.status === 'covenant' ? 'covenant'
    : c.status === 'protectorate' ? 'protectorate' : c.status === 'uplifted' ? 'uplifted'
    : c.status === 'drained' ? 'drained' : 'wild');
  const chipCls = dead ? ' pc-chip-dead' : touched || risen ? '' : ' pc-chip-cold';
  const att = +c.attitude || 0;
  parts.push(`<div class="pc-hero">
    <div class="pc-hero-nm">${pcIco(risen ? 'star' : 'world', 'pc-ico-lg')} ${esc(risen ? (c.state_name || c.self_name) : c.self_name)}
      <span class="pc-chip${chipCls}">${pcIco(stKey, 'pc-ico-sm')} ${esc(statusTxt)}</span></div>
    <div class="pc-hero-sub">${esc(c.planet_name || '?')} · система ${esc(c.system_name || c.system_id)}${
      c.env ? ' · ' + esc(c.env) : ''}</div>
    <button class="pc-ask${_pcAsk ? ' on' : ''}" type="button"
      onclick="event.stopPropagation();heroVNTamaAsk()">${_pcAsk ? '× Свернуть сводку' : '? У вас всё хорошо'}</button>
  </div>`);
  parts.push(_pcObserver(c));

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

  // ── УЗЫ ──────────────────────────────────────────────────
  // Одна цифра «отношение» врала: её покупали. Здесь видно, из чего она
  // складывается и во что упирается — и почему деньгами это не чинится.
  if (!dead && !risen) {
    const loy = pcLoy(c), cap = pcCap(c), why = pcCapWhy(c);
    parts.push(`<div class="sn-sec">Узы</div>`);
    parts.push(`<div class="pc-grid">
      ${pcFact('Лояльность', `<span class="pc-fact-n">${loy}</span> из ${cap} ${pcMeter(Math.max(0, loy), loy >= 90 ? 'pc-m-ok' : loy >= 40 ? 'pc-m-mid' : 'pc-m-bad')}`,
        'Итог всего: 0.45 от мнения о вас плюс 0.55 от доверия, срезанные потолком. 90 открывает Завет.')}
      ${pcFact('Доверие', `<span class="pc-fact-n">${+c.trust || 0}</span> ${pcMeter(+c.trust || 0, 'pc-m-ok')}`,
        'Связь, а не симпатия. Растёт почти только от закрытых бед; тает от молчания дольше десяти суток и от подачек тому, кто уже сидит на вашей руке.')}
      ${pcFact('Зависимость', `<span class="pc-fact-n">${+c.dependency || 0}</span> ${pcMeter(+c.dependency || 0, (+c.dependency || 0) > 40 ? 'pc-m-bad' : 'pc-m-mid')}`,
        'Сколько в их жизни вашего. Выше 40 съедает потолок лояльности, выше 55 глушит их же ремёсла: карго-культ вместо народа. Тает сама на 2 за недельный ход.')}
      ${pcFact('Память обид', `<span class="pc-fact-n">${+c.grudge || 0}</span> ${pcMeter(+c.grudge || 0, 'pc-m-bad')}`,
        'Выкачивание, рабство, удар с орбиты. Деньгами не снимается: −1 за каждую закрытую беду, и всё.')}
      ${pcFact('Бед закрыто', `<span class="pc-fact-n">${+c.needs_done || 0}</span>${
        +c.needs_missed ? ` <i>· пропущено ${+c.needs_missed}</i>` : ''}`,
        'Каждая закрытая беда — +10 доверия и −1 к памяти обид. Каждая пропущенная — −5 доверия и +3 к обидам.')}
      ${pcFact('Потолок', cap >= 100 ? 'снят' : `${cap}`, why || 'Ничто не мешает: потолок держит только эпоха.')}
    </div>`);
    if (why) parts.push(`<div class="fc-rule">Выше ${cap} их не поднять, пока: ${esc(why)}.</div>`);
  }

  // ── БЕДА ─────────────────────────────────────────────────
  if (need) {
    const left = Math.max(0, Math.ceil((Date.parse(need.until) - Date.now()) / 3600000));
    parts.push(`<div class="sn-sec">У них беда · ${esc(PC_NEED_NM[need.kind] || '—')}</div>`);
    parts.push(`<div class="fc-rule"><b>Осталось ${left} ч.</b> Это единственный быстрый путь к доверию — и единственное, что снимает память обид. Промолчите — они это тоже запишут.</div>`);
    parts.push(act('answer', 'Ответить на беду', 'прийти тогда, когда нужно, и не просить ничего взамен: +10 доверия, −1 к обидам, +9 благополучия; −3 к досье Фонда'));
    parts.push(`<button class="hp-vn-btn hp-vn-back" type="button" style="margin-top:2px"
      onclick="event.stopPropagation();heroVNTamaBack()">Оставить без ответа</button>`);
  }
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
    // Завет — вершина мирного пути и единственный источник ихора в игре.
    if (c.status !== 'covenant') {
      parts.push(`<div class="pc-sub">Завет</div>`);
      parts.push(act('covenant', 'Заключить Завет',
        (c.ruins === 'Даллерианцы'
          ? 'под ними лежат Даллерианцы: мир откроет святилища и будет отдавать ихор каждые сутки'
          : 'руин предтеч под ними нет — ихора здесь не будет, только верность')
        + '; они откажутся от собственного звёздного полёта и останутся при вас; −10 к досье Фонда'));
    } else {
      parts.push(`<div class="pc-sub">Завет заключён${c.covenant_at ? ' · ' + esc(pcStamp(c.covenant_at)) : ''}</div>`);
      parts.push(`<div class="fc-rule">${c.ruins === 'Даллерианцы'
        ? `Святилища вскрыты: ихор идёт на ваш склад каждые сутки, всего отдано <b>${(+c.ichor_total || 0).toFixed(1)}</b>. Ставка падает до нуля, если лояльность просядет ниже 85, и Завет рвётся в тот день, когда вы возьмётесь за выкачивание, рабство или орудия.`
        : 'Руин предтеч под ними нет: Завет держит их дома и даёт верность, но ихора отсюда не будет.'}</div>`);
    }
    parts.push(`<div class="pc-sub">Вмешательство</div>`);
    parts.push(c.phase < 11
      ? act('uplift', 'Возвысить', 'эпоха вперёд — на шаг ближе к звёздам; они запомнят покровителя; −15 к досье Фонда')
      : act('uplift', 'Дать им звёзды', 'вытолкнуть с порога в космос: держава родится сегодня и под вашей рукой; −15 к досье Фонда'));
    if (c.status !== 'protectorate') parts.push(act('protect', 'Протекторат', 'может не выйти — у них бывает мнение; −35'));
    if (c.status !== 'drained') parts.push(act('harvest', 'Выкачивать', 'деньги в обмен на их благополучие; −20'));
    parts.push(c.faith_fid
      ? `<div class="pc-act pc-t-take pc-act-off">
          <img class="pc-act-bg" src="${PC_ART_DIR}/convert.webp" alt="" loading="lazy" onerror="this.remove()">
          <span class="pc-act-nm">Обратить в веру
          <i>${c.faith_fid === (_pcState && _pcState.fid) ? 'этот мир уже поёт ваше имя' : 'мир уже принял чужую веру'}</i></span></div>`
      : act('convert', 'Обратить в веру', (_pcState && _pcState.faith
          ? 'целая планета адептов «' + _pcState.faith + '»: +25% к ставке ваших храмов (потолок ×2); может не выйти; −25'
          : 'нужна своя религия — без неё проповедовать нечего') + ''));
    parts.push(act('enslave', 'Увести в рабство', 'не убить, а вывезти: невольники вливаются в пул рабочих; −45'));
    // Обряд — изнанка проповеди: та же вера, но мир идёт не в паству, а в сырьё.
    // Второй и последний источник ихора помимо Завета, и единственный разовый.
    parts.push(_pcRiteBlock(c, act));
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

// ── НАБЛЮДАТЕЛЬ ──────────────────────────────────────────
// «Как это всё работает и как я на это влияю?» — на этот вопрос карточка не
// отвечала: она показывала тринадцать цифр и молчала. Здесь сидит учёный,
// который эти же цифры читает вслух: что с миром сейчас, что случится дальше
// и когда, и во что упрётся игрок, если ничего не делать. Новых данных не
// запрашиваем — весь разбор строится на том, что уже пришло в precursor_get.
let _pcAsk = false;
function heroVNTamaAsk() { _pcAsk = !_pcAsk; heroVNTamaRefresh(); }

// Один пункт сводки: тон (ok/warn/bad/note), заголовок, текст.
function _pcNote(tone, head, txt) {
  return `<div class="pc-obs-l pc-obs-${tone}"><b>${esc(head)}</b><span>${txt}</span></div>`;
}
function pcObserverLines(c) {
  const out = [];
  const ph = Math.max(0, Math.min(11, +c.phase || 0));
  const PH = (window.Precursors && window.Precursors.PHASES) || [];
  const wb = +c.wellbeing || 0, tr = +c.trust || 0, dep = +c.dependency || 0, gr = +c.grudge || 0;
  const cap = pcCap(c), loy = pcLoy(c);
  const need = pcActiveNeed(c);
  const risen = c.status === 'spacefaring', dead = c.status === 'dead';

  if (dead) {
    out.push(_pcNote('bad', 'Наблюдать нечего', 'Мир мёртв. Пост снят, летопись закрыта.'));
    return out;
  }
  if (risen) {
    out.push(_pcNote('note', 'Они нас переросли',
      'Это уже держава на карте, а не находка. Решения по дозвёздным к ним неприменимы — только внешняя политика.'));
    return out;
  }

  // 1. Где они на лестнице и когда следующий шаг
  const when = pcWhen(c.next_step_at, _pcState && _pcState.now) || 'не назначен';
  const left = c.steps_left != null ? +c.steps_left : null;
  out.push(_pcNote('note', 'Сейчас',
    `Эпоха <b>E${ph} · ${esc(c.phase_name || (PH[ph] && PH[ph].name) || '?')}</b>. Историю они двигают сами: раз в неделю мир делает шаг по своей летописи. Следующий — <b>${esc(when)}</b>.`
    + (left != null ? ` До звёздного полёта таких шагов ещё <b>${left}</b> — после него они станут державой, и распоряжаться ими будет нельзя.` : '')));

  // 2. Благополучие — главный стопор истории
  if (wb < 8) out.push(_pcNote('bad', 'История встала',
    `Благополучие ${wb}. Ниже 8 неделя уходит на выживание, а не на развитие: шаги по летописи не идут. Поднять можно даром с неба или ответом на беду.`));
  else if (wb < 30) out.push(_pcNote('warn', 'Живут туго',
    `Благополучие ${wb}. До остановки истории недалеко: ещё один неурожай или выкачивание — и они встанут.`));

  // 3. Беда — единственный быстрый рычаг, о нём говорим первым делом
  if (need) {
    const h = Math.max(0, Math.ceil((Date.parse(need.until) - Date.now()) / 3600000));
    out.push(_pcNote('warn', 'Прямо сейчас у них беда',
      `${esc(PC_NEED_NM[need.kind] || 'Беда')}, осталось <b>${h} ч</b>. Придёте — <b>+10 доверия и −1 к обидам</b>: другого такого быстрого пути нет, деньгами это не покупается. Промолчите — <b>−5 доверия и +3 к обидам</b>, и они это запомнят.`));
  } else {
    out.push(_pcNote('ok', 'Беды сейчас нет',
      `Беды приходят сами, примерно раз в 5 суток, и висят пять дней. Это ваш главный рычаг: <b>закрытых бед — ${+c.needs_done || 0}</b>${
        +c.needs_missed ? `, пропущено ${+c.needs_missed}` : ''}. Ждать их стоит: без них доверие почти не растёт.`));
  }

  // 4. Диагноз уз — что именно держит лояльность
  if (dep > 55) out.push(_pcNote('bad', 'Вы вырастили карго-культ',
    `Зависимость ${dep}. Выше 55 у них глохнут собственные ремёсла, и каждый ход они теряют доверие. Дары теперь делают хуже, а не лучше — перестаньте дарить, зависимость сама тает на 2 за недельный ход.`));
  else if (dep > 40) out.push(_pcNote('warn', 'Слишком много подачек',
    `Зависимость ${dep}. Всё, что выше 40, срезает потолок лояльности один в один: сейчас −${dep - 40}. Ещё пара даров — и получите карго-культ.`));

  if (gr >= 25) out.push(_pcNote('bad', 'Они помнят',
    `Память обид ${gr} — столько же снято с потолка. Обиды не закрываются деньгами вообще: только <b>−1 за каждую закрытую беду</b>. Это годы.`));
  else if (gr > 0) out.push(_pcNote('warn', 'Есть счёт к вам',
    `Память обид ${gr}, и она срезает потолок. Снимается по единице за закрытую беду.`));

  // 5. Потолок — почему «влил денег и не растёт»
  const phCap = 40 + 6 * ph;
  if (loy >= cap && cap < 100) out.push(_pcNote('warn', 'Уперлись в потолок',
    `Лояльность ${loy} при потолке ${cap} — выше не пойдёт, сколько ни вкладывай. ${
      phCap < 100 ? `Главное ограничение — эпоха: E${ph} держит потолок на ${Math.min(100, phCap)}, потому что они ещё не мыслят вас как силу, которой можно быть верным. Потолок поднимется сам, когда они шагнут дальше.` : 'Разберитесь с обидами и зависимостью — потолок держат они.'}`));
  else if (cap < 100) out.push(_pcNote('note', 'Куда можно вырасти',
    `Лояльность ${loy}, потолок ${cap}. ${esc(pcCapWhy(c) || 'Держит только эпоха.')}`));

  // 6. Завет — конечная точка мирного пути, о ней надо знать заранее
  if (c.status === 'covenant') {
    out.push(_pcNote('ok', 'Завет в силе',
      c.ruins === 'Даллерианцы'
        ? `Святилища вскрыты, ихор идёт каждые сутки (всего отдано ${(+c.ichor_total || 0).toFixed(1)}). Ставка гаснет, если лояльность просядет ниже 85, и Завет порвётся в тот день, когда вы возьмётесь за выкачивание, рабство или орудия.`
        : 'Руин предтеч под ними нет: Завет даёт верность и держит их дома, но ихора отсюда не будет.'));
  } else if (loy >= 90) {
    out.push(_pcNote('ok', 'Готовы к Завету',
      `Лояльность ${loy} — порог взят. ${c.ruins === 'Даллерианцы'
        ? 'И под ними лежат Даллерианцы: этот мир будет отдавать ихор каждые сутки. Таких единицы.'
        : 'Руин предтеч под ними нет, так что ихора не будет — только верность и отказ от их собственного звёздного полёта.'}`));
  } else {
    out.push(_pcNote('note', 'До Завета',
      `Нужна лояльность 90 (сейчас ${loy}), эпоха от E8 (сейчас E${ph}), обиды не выше 10 (${gr}) и зависимость не выше 45 (${dep}). ${
        c.ruins === 'Даллерианцы'
          ? '<b>Под ними Даллерианцы</b> — этот мир стоит того: в Завете он даёт ихор, которого нет больше нигде.'
          : 'Руин предтеч под ними нет — ихора Завет здесь не даст.'}`));
  }

  // 7. Чем это кончится, если не вмешиваться
  if (left != null && left <= 2) out.push(_pcNote('warn', 'Скоро уйдут сами',
    `Шагов до звёздного полёта: ${left}. Как только они поднимутся, решать за них будет поздно — ни Завета, ни возвышения, ни обряда.`));

  return out;
}
function _pcObserver(c) {
  if (!_pcAsk) return '';
  return `<div class="pc-obs">
    <div class="pc-obs-who">Наблюдательный пост · дежурный ксенолог</div>
    ${pcObserverLines(c).join('')}
  </div>`;
}

// ── ОККУЛЬТНЫЙ ОБРЯД ─────────────────────────────────────
// Счёт жертвы — зеркало серверного _pc_rite_ichor: 500 их жизней = 1 ихор.
function pcRiteIchor(pop) { return Math.round((Math.max(0, +pop || 0) / 100) * 10) / 10; }
// Клеймо «Мразь» на вере: сервер отдаёт число обрядов (faith_stigma).
function pcStigma() { return _pcState ? (+_pcState.faith_stigma || 0) : 0; }
function pcStigmaChip() {
  const n = pcStigma();
  if (!n) return '';
  return `<span class="pc-stigma" title="Клеймо не снимается ничем. Его видит всякий, кто спросит о вашей вере.">Мразь${
    n > 1 ? ' ×' + n : ''}</span>`;
}
// Отдельный блок, а не строка в общем списке: обряд — это не «ещё одно решение
// на −60», это разовая сделка, после которой мира нет, а на вере пятно.
function _pcRiteBlock(c, act) {
  const faith = _pcState && _pcState.faith;
  const amt = pcRiteIchor(c.pop);
  const head = `<div class="pc-sub">Обряд ${pcStigmaChip()}</div>`;
  if (!faith) {
    return head + `<div class="fc-rule">Обряд служат вере, а своей веры у державы нет. Пока её нет — жертвовать некому.</div>`;
  }
  // Ставка на весы, а не в простыню текста: слева жизни, справа ихор. Так
  // видно, что обряд — это обмен по курсу, а не «ещё одно решение на −80».
  return head
    + `<div class="pc-deal">
        <div class="pc-deal-side"><span class="pc-deal-n">${pcNum(c.pop)}</span><span class="pc-deal-k">жизней</span></div>
        <div class="pc-deal-arrow">100 : 1</div>
        <div class="pc-deal-side pc-deal-get"><span class="pc-deal-n">${amt.toFixed(1)}</span><span class="pc-deal-k">ихора разом</span></div>
      </div>`
    + `<div class="fc-rule">Изнанка проповеди: мир идёт не в паству, а в сырьё — планета вычищается целиком и навсегда. Денег обряд не стоит, платит вера «${esc(faith)}»: на ней останется клеймо, видное всей галактике.<br>
      Иначе ихор идёт только из Завета, по капле в сутки и только там, где под ногами Даллерианцы. Завет отдаёт годами и оставляет мир живым — обряд отдаёт сразу и не оставляет ничего.</div>`
    + act('rite', 'Оккультный обряд', `мир не восстановится; клеймо на вере навсегда; −80 к досье Фонда`);
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
  covenant: 'Заключить Завет? Мир навсегда откажется от собственного звёздного полёта и останется при вас хранителем того, что лежит под его городами. Завет рвётся в тот день, когда вы возьмётесь за выкачивание, рабство или орудия — и второй раз его уже не предложат.',
  convert: 'Отдать им вашу веру? Если примут — целый мир будет петь ваше имя, и храмы державы станут вдвое звонче.',
  rite: 'Отдать этот мир обряду? Их не победят и не увезут — их израсходуют, всех и за одну ночь, а из-под опустевших городов поднимется ихор. Планета не восстановится никогда. На вашей вере встанет клеймо, которое не снимается ничем и которое увидит вся галактика.',
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
      : m.includes('no need') ? 'Беды у них сейчас нет — помогать не в чем.'
      : m.includes('need expired') ? 'Поздно: они пережили это сами.'
      : m.includes('loyalty too low') ? 'Лояльности мало: Завет заключают с 90, и деньгами это место не закрывается.'
      : m.includes('too primitive for covenant') ? 'Слишком рано: с этими ещё не о чем договариваться.'
      : m.includes('they remember too much') ? 'Они помнят слишком много. Сначала годы закрытых бед, потом разговоры о Завете.'
      : m.includes('they only beg') ? 'Они вам не партнёры, а просители: сначала пусть отвыкнут от подачек.'
      : m.includes('already covenant') ? 'Завет с ними уже заключён.'
      : m.includes('no faith of your own') ? 'Сначала своя религия: и проповедь, и обряд служат вере, а её у державы нет.'
      : m.includes('already converted') ? 'Этот мир уже нашёл себе небо.'
      : 'Ошибка: ' + m;
    if (typeof toast === 'function') toast(nice, 'err');
  }
  if (typeof ecReloadPaint === 'function') { try { await ecReloadPaint(); } catch (e) {} }
  await heroVNTamaRefresh();
}
