// ════════════════════════════════════════════════════════════
// ДОЗВЁЗДНЫЕ · ХРОНИКИ — движок авторских новелл-кампаний (этап 10)
//
// Этапы 1–9 (lore/precursor_memory.md §20) собрали модель: надломы, русло,
// лестницу, ихор, недоимку, Сбор. Модель работала — но игрок видел приборы
// и ряд подписанных кнопок. Хроника рассказывает ту же модель историей:
// названные люди, главы и финал, где Сбор приходит по счёту, набранному
// самим игроком.
//
// Здесь только движок. Сами миры лежат по файлу на мир (saga_*.js) и
// заявляют о себе через PrecursorSaga.register — раса, эпохи, местность,
// люди и исходы принадлежат миру, а не движку. Оттого хроники и могут быть
// разными: вторая не обязана быть ни гуманоидной, ни приморской.
//
// Устройство мира: узлы (NODES) — сцена = фон + говорящий + реплики +
// развилка. Ветвление читает флаги, флаги ставит выбор игрока. Сервер
// (precursor_saga_*) хранит только «в каком мире, где я и что выбрал»;
// текст и правила — в файле мира, и у всех игроков они одни.
//
// ⚠ ГОЛОС (lore/precursor_memory.md §0): ни одного слова из клиники. Летописец
// и историк, а не наблюдатель за человеком: смута, застой, зарок, вира,
// умолчание, неоплаченный счёт. Проверка каждой строки — «так мог бы написать
// летописец, никогда не слышавший ни слова про психику?»
//
// Эмодзи запрещены: значки — контурный SVG на currentColor.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));


  // ══════════════════════════════════════════════════════════
  // РЕЕСТР МИРОВ
  //
  // Движок больше не знает ни одного мира наизусть. Каждая хроника — свой
  // файл (saga_*.js), который на загрузке заявляет о себе:
  //
  //   PrecursorSaga.register('kailat', {
  //     name, race, lead, first, WHO, NODES, ENDINGS, stand })
  //
  // Отсюда и разнообразие: раса, эпохи и сама местность живут в мире, а не в
  // движке, — второй мир не обязан быть ни гуманоидным, ни приморским.
  // Порядок в списке — порядок загрузки файлов в index.html.
  // ══════════════════════════════════════════════════════════
  const WORLDS = {};      // id → описание мира
  const ORDER  = [];      // порядок карточек на двери
  const ST     = {};      // id → след игрока в этом мире
  const _rows  = {};      // id → строка следа с сервера, ещё не разложенная
  let   _me    = null;    // ваша держава: раса и доктрина (их отдаёт сервер)

  // Пустой след: игрок в мир ещё не заходил.
  const blank = () => ({
    node: null, flags: {}, done: false, ending: null, readyAt: null,
    // Чаша мира: сумма весов решений. Копит её СЕРВЕР — здесь лежит то, что
    // он отдал. Считать её тут значило бы дать игроку назначить себе исход.
    scale: 0,
    // Ваш человек внизу, чужая память об этом мире и те, кто держал его до
    // вас. Приходит с сервера вместе со следом: клиент этого не считает —
    // иначе посланнику можно было бы назначить удобное состояние.
    посланник: null, память: [], доВас: null,
  });

  let W = null;           // мир, открытый сейчас
  let S = null;           // его след (S.* по всему движку — это он)
  let _skew   = 0;        // поправка на часы игрока: сервер прав
  let _loaded = false;    // след с сервера уже получен
  let _busy = false;      // шаг уже ушёл на сервер: второго клика не ждём

  function register(id, def) {
    if (!id || WORLDS[id]) return;
    WORLDS[id] = Object.assign({ id: id, first: 'p0', race: '' }, def);
    ORDER.push(id);
    ST[id] = blank();
    // След с сервера мог прийти РАНЬШЕ мира: миры из реестра заводятся только
    // после precursor_get, а следы приходят все разом и заранее. Без этого
    // игрок, читающий четвёртую главу, увидел бы на двери «Начать».
    if (_rows[id]) applyRow(_rows[id]);
  }

  // Разложить строку следа по миру. Отдельной функцией — потому что зовётся
  // из двух мест: при ответе сервера и при позднем заведении мира.
  function applyRow(row) {
    const st = ST[row.world], wd = WORLDS[row.world];
    if (!st || !wd) return;
    st.node = row.node || wd.first;
    st.flags = row.flags || {};
    st.done = !!row.done;
    st.ending = row.ending || null;
    st.readyAt = row.ready_at ? Date.parse(row.ready_at) : null;
    st.scale = +row.scale || 0;
    st.посланник = row.посланник || null;
    st.память = row.память || [];
    st.доВас = row.до_вас || null;
  }

  // Открыть мир = сделать его текущим. Возвращает false, если такого нет:
  // ссылка на мир может пережить свой файл, ронять этим вкладку нельзя.
  function setWorld(id) {
    if (!WORLDS[id]) return false;
    W = WORLDS[id];
    S = ST[id];
    return true;
  }

  // «через 2 дн. 4 ч» — срок называем словами, а не отсчётом до секунды:
  // это выдержка в истории, а не таймер в мобильной игре.
  function untilTxt(ms) {
    if (ms <= 0) return '';
    const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
    if (d >= 1) return `${d} дн. ${h - d * 24} ч`;
    if (h >= 1) return `${h} ч ${Math.floor((ms - h * 3600000) / 60000)} мин`;
    return `${Math.max(1, Math.floor(ms / 60000))} мин`;
  }
  // Срок считаем от серверных часов: свои у игрока могут врать в любую сторону.
  const untilOf = st => st && st.readyAt ? st.readyAt - (Date.now() + _skew) : 0;
  const untilMs = () => untilOf(S);

  const nodeOf = id => (W && W.NODES[id]) || null;
  // Переход может зависеть от всей истории, а не от последнего клика: финалы
  // расходятся по тому, как игрок вёл себя пять глав, а не по тому, какую
  // кнопку он нажал в последней сцене.
  const goOf = (n, f) => typeof n.go === 'function' ? n.go(f || S.flags) : n.go;
  // Реплика может быть функцией от флагов: одна и та же сцена помнит, что
  // игрок делал в третьей главе. Это и есть «последствие», а не строка в логе.
  const lineText = (l, f) => typeof l === 'function' ? String(l(f) || '') : String(l || '');

  function visibleLines(n) {
    return (n.t || []).map(l => lineText(l, S.flags)).filter(Boolean);
  }

  // ══════════════════════════════════════════════════════════
  // ЦЕНА
  //
  // Валют три и только три (конструктор): груз со склада, время державы,
  // чаша мира. Здесь — первые две; чашу двигает сервер.
  //
  //   a.cost = { груз: { id: 'Дейтерий', n: 13 }, срок: 2 }
  //
  // Ценник печатается СУХО и ДО нажатия, без подсказки «это хороший выбор»:
  // сколько отдаём и на сколько ходов занимаем слот. Ни одобрения, ни
  // предупреждения — счёт.
  // ══════════════════════════════════════════════════════════
  let _bag = {};                      // склад державы: пришёл вместе со следом

  function pcgCost(a) {
    const c = a && a.cost; if (!c) return '';
    const ч = [];
    if (c.груз && c.груз.id && c.груз.n) ч.push(c.груз.id + ' −' + c.груз.n);
    if (c.срок) ч.push('слот исследования занят ' + c.срок +
      (c.срок === 1 ? ' ход' : c.срок < 5 ? ' хода' : ' ходов'));
    return ч.join(' · ');
  }
  // Хватает ли на складе. Нет — вариант НЕ РИСУЕТСЯ вовсе: показать выбор,
  // который отобьётся отказом, значит соврать игроку кнопкой.
  function pcgAfford(a) {
    const г = a && a.cost && a.cost.груз;
    if (!г || !г.id || !г.n) return true;
    return (+_bag[г.id] || 0) >= +г.n;
  }
  function visibleAsks(n) {
    const по_ходу = (n.ask || []).filter(a => !a.if || a.if(S.flags));
    const по_складу = по_ходу.filter(pcgAfford);
    // ...но не до тупика: если платить нечем ВСЕМ вариантам, глава останется
    // без единого ответа и хроника встанет. Тогда показываем как есть — отказ
    // придёт от сервера и скажет, чего не хватило.
    return по_складу.length ? по_складу : по_ходу;
  }

  // ══════════════════════════════════════════════════════════
  // СЕРВЕР
  // ══════════════════════════════════════════════════════════
  // Сервер отдаёт след СРАЗУ ПО ВСЕМ хроникам: дверь рисует карточку на каждый
  // мир, и спрашивать по разу на мир значило бы платить запросом за строку.
  async function load() {
    // Манифест арта хроник нужен уже двери (своя карточка у каждой), поэтому
    // тянем его вместе со следом, а не при открытии сцены.
    if (window.PcArt) { PcArt.sagaLoad().catch(() => {}); }
    if (typeof ecRpc !== 'function') { _loaded = true; return; }
    try {
      const r = await ecRpc('precursor_saga_get', {});
      if (r && r.ok) {
        if (r.now) _skew = Date.parse(r.now) - Date.now();
        // Кто смотрит: раса, доктрина и форма правления ВАШЕЙ державы. Одна и
        // та же бухта, увиденная акватиком и литоидом, — две разные хроники,
        // и без этой строки стан собрал бы обе одинаково.
        if (r.me) _me = r.me;
        // Склад приходит вместе со следом: вариант, на который нечем платить,
        // не рисуется, и спрашивать про это отдельно на каждый кадр нечем.
        if (r['склад']) _bag = r['склад'];
        const rows = Array.isArray(r.rows) ? r.rows
          // Старый ответ (одна хроника, до нескольких миров) — это Кайлат.
          : r.node ? [Object.assign({ world: 'kailat' }, r)] : [];
        rows.forEach(row => {
          if (!row || !row.world) return;
          // След кладём ВСЕГДА, даже если мира ещё нет: миры из реестра
          // заводятся позже, по ответу precursor_get.
          _rows[row.world] = row;
          applyRow(row);
        });
      }
    } catch (e) { /* хроника не должна ронять вкладку: откроется с начала */ }
    _loaded = true;
  }

  // Шаг спрашивает сервер ПЕРВЫМ и только потом двигает сцену: срок выдержки
  // знает он, и опережать его картинкой значит показать игроку главу, которой
  // у него ещё нет.
  async function step(to, set, ending, a) {
    const cost = (a && a.cost) || null;
    const вес  = (a && +a.вес) || 0;
    const apply = () => {
      S.node = to; S.readyAt = null;
      if (set) Object.keys(set).forEach(k => { S.flags[k] = set[k]; });
      if (ending) { S.done = true; S.ending = ending; }
    };
    // Показ (тизер) идёт мимо сервера целиком: ни срока, ни исхода, ни выплаты —
    // на записи должна быть сцена, а не чужой след в базе.
    if (typeof ecRpc !== 'function') { apply(); return await tail(to); }
    let r = null;
    try {
      r = await ecRpc('precursor_saga_step', {
        p_world: W.id, p_node: to, p_flags: set || {}, p_ending: ending || null,
        p_cost: cost, p_weight: вес,
      });
    } catch (e) { apply(); return await tail(to); }
    if (r && r.ok === false && r.wait) {
      S.readyAt = r.ready_at ? Date.parse(r.ready_at) : null;
      return { ok: false, wait: true };
    }
    // Отказ по цене — тоже отказ: ни узла, ни флага. Списывает сервер, и если
    // он сказал «нет», склад не тронут.
    if (r && r.ok === false) return { ok: false, err: r.err };
    if (r && r.pay) S.pay = r.pay;      // чем исход отозвался на складе и в реестре
    // Что списано на самом деле — с ответа, а не с нашей записи цены: иначе
    // склад в кадре разойдётся со складом в казне на первом же расхождении.
    const с = r && r.cost && r.cost['груз'];
    if (с && с.id) _bag[с.id] = Math.max(0, (+_bag[с.id] || 0) - (+с.n || 0));
    if (r && r.scale != null) S.scale = +r.scale;
    apply();
    return await tail(to);
  }

  // Что делается сразу после прихода в узел, независимо от того, ответил
  // сервер или мы идём вслепую.
  async function tail(to) {
    const n = nodeOf(to);
    // Куда пришли — там может стоять своя выдержка. Узнаём её сразу, чтобы
    // «вернуться через…» было видно и на двери, и в самой сцене.
    if (n && n.wait && typeof ecRpc === 'function') {
      try { await load(); } catch (e) {}
    }
    // Развязка. Узел с `resolve` сам не показывается: мир смотрит на ВСЮ
    // хронику разом и говорит, каким концом она кончилась. Оттого финал и
    // расходится по тому, как игрок вёл себя пять глав, а не по последней
    // кнопке. Такой узел ровно один и ведёт только на конец — кольца не будет.
    if (n && n.resolve && W && typeof W.resolve === 'function') {
      let к = null;
      try { к = W.resolve(S.flags); } catch (e) {}
      const e = к && nodeOf(к);
      if (e) return await step(к, null, e.end);
    }
    return { ok: true };
  }

  // ══════════════════════════════════════════════════════════
  // ЧАША В КАДРЕ: полоска узлов
  //
  // Чаша мира не показывается ни числом, ни шкалой, ни подписью — иначе игрок
  // играет в шкалу, а не в мир. Внизу кадра стоят УЗЛЫ ЭТОГО МИРА: пристани,
  // забои, колодцы — столько, сколько в хронике мест, где что-то решают.
  // Метка меняется только после решения и только своя.
  //
  // Что с меткой делают — от местности (SagaWeave.ENVS): у воды зажигают огни,
  // в камне держат тепло, в суши открывают колодцы. Тултипа нет.
  // ══════════════════════════════════════════════════════════
  // Узлы мира = узлы, где есть выбор. Число их НЕ ЗАШИТО: у собранного мира
  // глав может быть больше, чем у рукописного, и полоска обязана это знать.
  function marksOf(wd) {
    const N = (wd && wd.NODES) || {};
    return Object.keys(N).filter(k => (N[k].ask || []).length);
  }
  function marksHtml(wd, st) {
    const ids = marksOf(wd);
    if (ids.length < 2) return '';
    const вид = (wd.E && wd.E['метка']) || 'огонь';
    const f = (st && st.flags) || {};
    return `<div class="pcg-marks pcg-m-${esc(вид)}">${ids.map(id => {
      const м = f['м:' + id];
      return `<i class="${м > 0 ? 'up' : м < 0 ? 'down' : м === 0 ? 'flat' : ''}"></i>`;
    }).join('')}</div>`;
  }

  // ══════════════════════════════════════════════════════════
  // ОТРИСОВКА
  // ══════════════════════════════════════════════════════════
  // Род сцены по имени узла. Знание одно: как сборка называет главы (saga_kit).
  // Промахнётся — вернёт null, и кадр уедет на сетку эпох, как и раньше.
  const SCENE = {
    p: 'мир', w: 'выдержка', k: 'встреча', u: 'умолчание',
    d: 'работа', r: 'раскол', f: 'счёт', z: 'исход', e: 'кризис',
  };
  function sceneTag(id) {
    if (!id) return null;
    return SCENE[String(id)[0]] || null;
  }

  // ══════════════════════════════════════════════════════════
  // ХРОНИКА ЖИВЁТ В КАРТОЧКЕ МИРА, А НЕ В СВОЁМ ОКНЕ
  //
  // Отдельного экрана у хроники больше нет — ни новеллы, ни «пульта». Причина
  // одна и та же в обоих случаях: пока у мира ДВА входа, работа с примитивами
  // разорвана надвое. В карточке лежали дары, Завет, возвышение, обряд и урок,
  // а в новелле — люди, беды и решения; и то и другое про один и тот же народ.
  // Игрок не может «читать мир» отдельно от того, что он с этим миром делает.
  //
  // Поэтому здесь остался ДВИЖОК и один кусок разметки: `block(c)` возвращает
  // секцию для карточки мира (precursor_ui.js) — что донесли снизу и какое
  // решение ждут. Решения рисуются теми же строками `pc-act`, что дар и урок:
  // для игрока это один список того, что он может сделать с этим народом, а
  // не «сюжет» сбоку от игры.
  //
  // Сюжет от этого не потерян ни строкой: узлы, флаги, чаша, выдержки, цена и
  // исходы — всё то же самое, что было в новелле. Изменилось только место, где
  // это показывают, и то, что между двумя решениями больше нет ни одного
  // нажатия «ради следующей фразы»: узел приходит целиком.
  // ══════════════════════════════════════════════════════════

  // Ключ хроники по строке мира из precursor_get. Тот же, что заводит
  // SagaWorlds.bind — иначе карточка искала бы несуществующий мир.
  const keyOf = c => c && ('civ:' + c.system_id + ':' + c.pid);

  // Род сцены человеческим словом: игрок должен видеть, ЧТО ему донесли,
  // не догадываясь по тексту.
  const ROD = {
    'мир': 'Что там видно', 'выдержка': 'Выдержка', 'встреча': 'Встреча',
    'умолчание': 'Умолчание', 'работа': 'Работа', 'раскол': 'Раскол',
    'счёт': 'Счёт', 'исход': 'Исход', 'кризис': 'Кризис',
  };

  // Кадр места. Ищется по убыванию точности, и всё решают ФАЙЛЫ:
  //   1. свой кадр узла  2. род сцены  3. кадр главы  4. сетка «раса × эпоха»
  // Файла нет — полосы просто нет: подделка под кадр хуже честной пустоты.
  function bgOf(n) {
    if (!window.PcArt || !n) return null;
    return PcArt.bg(W.id, S.node)
      || PcArt.bg(W.id, n.bg || sceneTag(S.node))
      || PcArt.bg(W.id, chapterNodeOf(W, S.node))
      || PcArt.pick(W.race, n.ep || W.ep0 || 'E8', S.node) || null;
  }

  // ── строка решения ─────────────────────────────────────────
  // Ровно та же разметка, что у «Дара с неба» и «Урока» в карточке (pc-act):
  // название, чем платим, кнопка. Решение хроники — не реплика героя, а такое
  // же распоряжение державы, как остальные, и выглядеть должно так же.
  function actRow(a, i) {
    const ц = pcgCost(a);
    return `<div class="pc-act pc-t-ok pcs-act">
      <span class="pc-act-nm">${esc(a.t)}${ц ? `<i>${esc(ц)}</i>` : ''}</span>
      <span class="pc-act-r">
        <button class="hp-vn-btn" type="button"
          onclick="event.stopPropagation();pcgPick(${i})">Решить</button>
      </span>
    </div>`;
  }

  // ── блок в карточке мира ───────────────────────────────────
  // Возвращает пустую строку, если хроники у мира нет: карточка от этого не
  // ломается, у неё и без хроники есть что показать.
  function block(c) {
    if (!setWorld(keyOf(c))) return '';
    if (!S.node) S.node = W.first;
    const n = nodeOf(S.node);
    if (!n) return '';

    const lines = visibleLines(n);
    const who = W.WHO[n.who] || W.WHO.obs || { name: '', tone: 'narr' };
    const asks = visibleAsks(n);
    const left = untilMs();
    const род = ROD[n.bg || sceneTag(S.node)] || 'Донесение';
    const глава = String(n.ch || chapterOf(W, S.node))
      .split(' · ').filter(ч => ч !== W.name).join(' · ');
    const bg = bgOf(n);
    const е = S['посланник'];

    const out = [];
    out.push(`<div class="sn-sec">${esc(род)}${глава ? ' · ' + esc(глава) : ''}</div>`);

    // Кто донёс. Посланник — ВАШ человек внизу, и врёт он тоже в ваших
    // отчётах: сказать про него надо ровно там, где читают его отчёт.
    if (е && е['имя']) {
      const ч = [];
      if (е['ходок']) ч.push('ходок ' + е['ходок']);
      if (е['прикипел']) ч.push('прикипел к миру');
      if (е['сломан']) ч.push('сломан');
      out.push(`<div class="pcs-envoy">Внизу за вас: <b>${esc(е['имя'])}</b>${
        е['пост'] ? ' · ' + esc(е['пост']) : ''}${
        ч.length ? ` <i>${esc(ч.join(' · '))}</i>` : ''}</div>`);
    }

    out.push(`<div class="pcs-disp">
      ${bg ? `<div class="pcs-strip" style="background-image:url('${esc(bg)}')"></div>` : ''}
      ${who.name ? `<div class="pcs-from pcs-t-${esc(who.tone)}">${esc(who.name)}</div>` : ''}
      ${lines.map(l => `<p>${esc(l)}</p>`).join('')}
    </div>`);

    // Чаша мира: по метке на каждое место, где что-то решали. Ни числа, ни
    // подписи — иначе игрок начнёт играть в шкалу, а не в мир.
    out.push(marksHtml(W, S));

    // Выдержка. Срок назван словами и объяснён; ускорить его нечем, и кнопки
    // «ускорить» здесь нет намеренно.
    if (left > 0) {
      out.push(`<div class="fc-rule pcs-wait"><b>Ждём срока: ${esc(untilTxt(left))}.</b>
        ${esc(W.waitLine || 'Держава не отвечает раньше своего дня — вернитесь позже.')}</div>`);
      return out.join('');
    }

    if (asks.length) {
      out.push(`<div class="pc-sub">Что решит держава</div>`);
      out.push(asks.map(actRow).join(''));
      return out.join('');
    }

    // Сервер сказал, что линия закрыта, — верим ЕМУ, а не разметке узла:
    // исход считается по всей хронике разом, и узел про это может не знать.
    const to = S.done ? null : goOf(n);
    if (to) {
      out.push(`<div class="pc-act pc-t-ok pcs-act">
        <span class="pc-act-nm">Дослушать донесение${(() => {
          const р = ROD[sceneTag(to)];
          return р ? `<i>дальше: ${esc(р.toLowerCase())}</i>` : '';
        })()}</span>
        <span class="pc-act-r">
          <button class="hp-vn-btn" type="button"
            onclick="event.stopPropagation();pcgNext()">Дальше</button>
        </span>
      </div>`);
      return out.join('');
    }

    // Хроника кончилась. Чем она отозвалась — сказано СЧЁТОМ, а не похвалой:
    // это и есть то, ради чего мир доводили до конца.
    const e = W.ENDINGS[S.ending];
    out.push(`<div class="fc-rule pcs-end">${e ? `<b>Исход: ${esc(e[0])}.</b> ${esc(e[1] || '')}`
      : 'Здесь эта линия кончилась.'}${
      S.pay && (S.pay.ichor || S.pay.arrears) ? `<br>${
        S.pay.ichor ? `Ихор <b>${S.pay.ichor > 0 ? '+' : ''}${(+S.pay.ichor).toFixed(1)}</b>. ` : ''}${
        S.pay.arrears ? `Недоимка <b>−${(+S.pay.arrears).toFixed(1)}</b>.` : ''}` : ''}</div>`);
    out.push(`<button class="hp-vn-btn hp-vn-back" type="button"
      onclick="event.stopPropagation();pcgReset('${esc(c.system_id)}',${+c.pid})">Начать линию заново</button>`);
    return out.join('');
  }

  // ── чужой след ─────────────────────────────────────────────
  // Мир помнит не только вас: сколько держав было здесь до вас, чем у них
  // кончилось и что мир записал про пришедших сверху. Отдельным куском, потому
  // что в карточке это стоит рядом с летописью, а не с донесением.
  function pastBlock(c) {
    if (!setWorld(keyOf(c))) return '';
    const d = S['доВас'];
    const мем = Array.isArray(S['память']) ? S['память'] : [];
    if ((!d || !d['держав']) && !мем.length) return '';
    const out = [`<div class="sn-sec">Чужой след</div>`];
    if (d && d['держав']) {
      out.push(`<div class="fc-rule">Держав до вас: <b>${+d['держав']}</b>, довели до конца: <b>${
        +d['дошли'] || 0}</b>.${d['встал'] ? ` Мир уже вставал сам: <b>${esc(d['встал'])}</b>.` : ''}</div>`);
    }
    if (мем.length) {
      out.push(`<div class="pcs-past">${мем.slice(-5).map(r => r ? `<div class="pcs-past-r">
        <i>${esc(r['кто'] || 'кто-то сверху')}</i>${esc(r['что'] || '')}</div>` : '').join('')}</div>`);
    }
    return out.join('');
  }

  // ── пометка в списке миров ─────────────────────────────────
  // Строка списка обязана отвечать на один вопрос: ЖДУТ ли от игрока чего-то
  // в этом мире. Без этого он открывает миры наугад.
  function mark(c) {
    const id = keyOf(c), wd = WORLDS[id], st = ST[id];
    if (!wd || !st || !_loaded) return '';
    if (st.done) {
      const e = wd.ENDINGS[st.ending];
      return e ? 'линия закрыта: ' + e[0] : 'линия закрыта';
    }
    const left = untilOf(st);
    if (left > 0) return 'ждут срока · ' + untilTxt(left);
    const n = wd.NODES[st.node] || wd.NODES[wd.first] || {};
    return (n.ask || []).length ? 'ждут решения' : 'новое донесение';
  }
  // Ждёт ли мир решения прямо сейчас — списку нужно, чтобы поднять такие
  // миры наверх и подсветить их.
  function pending(c) {
    const id = keyOf(c), wd = WORLDS[id], st = ST[id];
    if (!wd || !st || !_loaded || st.done || untilOf(st) > 0) return false;
    const n = wd.NODES[st.node] || wd.NODES[wd.first] || {};
    return !!(n.ask || []).length;
  }

  // ══════════════════════════════════════════════════════════
  // РЕШЕНИЯ
  //
  // Обе кнопки кончаются одним: сервер, потом перерисовка КАРТОЧКИ. Своего
  // окна у хроники нет, и рисовать ей нечего — она часть карточки мира.
  // ══════════════════════════════════════════════════════════
  const repaint = () => {
    if (typeof heroVNTamaRefresh === 'function') heroVNTamaRefresh();
  };

  window.pcgNext = async function () {
    const n = nodeOf(S && S.node); if (!n || _busy) return;
    const to = goOf(n);
    if (!to) return;
    _busy = true;
    const r = await step(to, null, (nodeOf(to) || {}).end);
    _busy = false;
    if (!r.ok && !r.wait && r.err && typeof toast === 'function') toast(r.err, 'err');
    repaint();
  };

  window.pcgPick = async function (i) {
    const n = nodeOf(S && S.node); if (!n) return;
    const a = visibleAsks(n)[i]; if (!a || _busy) return;
    const to = nodeOf(a.to);
    // Метка узла, на котором стояли. Кладём её во флаги, а не в отдельную
    // память: полоска должна пережить закрытую вкладку так же, как её
    // переживает сама хроника. Ставится ТОЛЬКО решением и только своего узла.
    const set = Object.assign({}, a.set);
    set['м:' + S.node] = +a.вес > 0 ? 1 : +a.вес < 0 ? -1 : 0;
    _busy = true;
    const r = await step(a.to, set, to && to.end, a);
    _busy = false;
    if (r.ok && a.tail && typeof toast === 'function') toast(a.tail, 'ok');
    else if (!r.ok && r.err && typeof toast === 'function') toast(r.err, 'err');
    repaint();
  };

  // Перечитать линию мира с начала. Сбрасывается ТОЛЬКО открытый мир: у
  // соседних свой след, и терять его — не то, о чём игрока спросили.
  window.pcgReset = async function (sys, pid) {
    if (!setWorld('civ:' + sys + ':' + pid)) return;
    if (!confirm('Начать линию этого мира заново? След прошлых решений будет утерян.')) return;
    if (typeof ecRpc === 'function') {
      try { await ecRpc('precursor_saga_reset', { p_world: W.id }); } catch (e) {}
    }
    ST[W.id] = blank();
    S = ST[W.id];
    S.node = W.first;
    repaint();
  };

  function chapterOf(wd, id) {
    // Заголовок ближайшей главы вверх по цепочке узлов.
    const order = Object.keys(wd.NODES);
    let i = order.indexOf(id);
    for (; i >= 0; i--) { const n = wd.NODES[order[i]]; if (n && n.ch) return n.ch; }
    return 'Пролог';
  }

  // Узел, с которого началась глава: к нему привязан кадр всей главы, чтобы
  // одного залитого файла хватало на подряд идущие сцены.
  function chapterNodeOf(wd, id) {
    const order = Object.keys(wd.NODES);
    let i = order.indexOf(id);
    for (; i >= 0; i--) { const n = wd.NODES[order[i]]; if (n && n.ch) return order[i]; }
    return order[0];
  }

  // Завести хроники по найденным мирам. Зовётся из досье, когда пришёл ответ
  // precursor_get: раньше списка миров заводить нечего, позже — дверь уже
  // нарисована пустой.
  function bindCivs(civs) {
    if (!window.SagaWorlds) return 0;
    return SagaWorlds.bind(civs, _me || {});
  }

  window.pcgCost = pcgCost;     // ценник варианта: и в кадре, и на стенде

  window.PrecursorSaga = {
    register, setWorld, load,
    // Хроника отдаёт КУСКИ КАРТОЧКИ, а не свой экран: своего экрана у неё нет.
    block, past: pastBlock, mark, pending, marksHtml, marks: marksOf,
    cost: pcgCost, afford: pcgAfford,
    get bag() { return _bag; },
    bindCivs, WORLDS, ORDER, ST,
    get me() { return _me; },
    get world() { return W; },
    get S() { return S; },
  };
})();
