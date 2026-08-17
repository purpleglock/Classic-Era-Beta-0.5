// ════════════════════════════════════════════════════════════
// ДОЗВЁЗДНЫЕ · ДОСЬЕ ДЕРЖАВЫ (этап 5 §20, lore/precursor_memory.md)
//
// Рисует то, что считает precursor_sim.js: русло, крючки, силы, календарь
// чёрных седмиц, двухслойную нужду, лестницу ПОКОЙ→РИТМ→СЛОВО и летопись
// с умолчаниями. Решения уходят в precursor_commit(), запреты приходят из
// precursor_can() — кнопка серая и в ней написано, почему именно (§8).
//
// ПРАВИЛ ЗДЕСЬ НЕТ НИ СТРОКИ. Всё «как это работает» живёт в GB_TOPICS
// (guide.js) и открывается окном по значку «?» — иначе досье снова станет
// стеной текста, а не разворотом книги.
//
// Эмодзи запрещены: значки — контурный SVG на currentColor.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const num = v => Math.round(Number(v) || 0).toLocaleString('ru-RU');
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ── значки: один каркас, разный путь ──────────────────────
  const S = (d, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 1.6}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICO = {
    q:      S('<path d="M9.2 9.3a2.9 2.9 0 1 1 3.6 2.8c-.6.2-.9.7-.9 1.3v.6"/><path d="M12 17.2h.01"/>', 1.8),
    lock:   S('<rect x="5" y="10.5" width="14" height="9.5" rx="1.6"/><path d="M8.4 10.5V7.8a3.6 3.6 0 0 1 7.2 0v2.7"/>'),
    // крючки (§4.3) — каждый читается буквально
    'небо':      S('<path d="M4 15.5h16"/><path d="M7.5 15.5 12 5l4.5 10.5"/><path d="M9 19.5h6"/>'),
    'голод':     S('<path d="M12 20V9"/><path d="M12 9c0-2.6-1.6-4.6-4-5 0 2.7 1.5 4.6 4 5z"/><path d="M12 11c0-2.6 1.6-4.6 4-5 0 2.7-1.5 4.6-4 5z"/>'),
    'увод':      S('<circle cx="9" cy="7.5" r="2.6"/><path d="M4.5 19.5c0-2.8 2-4.6 4.5-4.6 1 0 1.9.3 2.6.8"/><path d="M15 12.5h5"/><path d="M17.5 10l2.5 2.5-2.5 2.5"/>'),
    'чужой':     S('<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5c-2.2 2-3.3 4.5-3.3 7.5s1.1 5.5 3.3 7.5c2.2-2 3.3-4.5 3.3-7.5S14.2 6.5 12 4.5z"/><path d="M4.8 12h14.4"/>'),
    'мор':       S('<circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.4 6.4l2.1 2.1M15.5 15.5l2.1 2.1M17.6 6.4l-2.1 2.1M8.5 15.5l-2.1 2.1"/>'),
    'раскол':    S('<path d="M13.5 3.5 10 11h4l-3.5 9.5"/><path d="M5 4.5v15M19 4.5v15"/>'),
    'земля':     S('<path d="M3.5 16.5h17"/><path d="M6 16.5 9.5 9l3 4.5L15 6l4 10.5"/>'),
    'святилище': S('<path d="M12 3.5 5.5 8v11.5h13V8z"/><path d="M9.5 19.5v-5.2a2.5 2.5 0 0 1 5 0v5.2"/>'),
    'слово':     S('<path d="M4.5 5.5h15v10h-9l-4 3.5z"/><path d="M8 9.5h8M8 12.5h5"/>'),
    'тишина':    S('<path d="M4.5 5.5h15v10h-9l-4 3.5z"/><path d="M9 10.4l6 4.2M15 10.4l-6 4.2"/>'),
    'седмица':   S('<rect x="4" y="5.5" width="16" height="14" rx="1.6"/><path d="M4 9.5h16M9 3.5v4M15 3.5v4"/><rect x="12.5" y="12.5" width="3.5" height="3.5" rx=".6" fill="currentColor" stroke="none"/>'),
    // образы появления (§7.1)
    'знамение':  S('<path d="M12 3v5M12 16v5M3 12h5M16 12h5"/><circle cx="12" cy="12" r="3.4"/>'),
    'их словом': S('<path d="M4.5 5.5h15v10h-9l-4 3.5z"/><path d="M8.5 10.5h7"/>'),
    'тихо':      S('<path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z"/><path d="M4 4l16 16"/>'),
  };
  const ico = k => ICO[k] || '';

  // ── справка: только окном, только из руководства ──────────
  function q(topic) {
    return `<button class="pcs-q" type="button" title="Как это работает"
      onclick="event.stopPropagation();gbHelpOpen('${topic}')">${ICO.q}</button>`;
  }
  function hd(title, topic, right) {
    return `<div class="pcs-hd"><b>${esc(title)}</b>${right ? `<span>${right}</span>` : ''}
      <span class="pcs-hd-sp"></span>${topic ? q(topic) : ''}</div>`;
  }

  // ══════════════════════════════════════════════════════════
  // СОСТОЯНИЕ: сводим якорь и журнал в state(t)
  // ══════════════════════════════════════════════════════════
  function calc(c) {
    if (!window.PrecursorSim || !c || !c.anchor) return null;
    const spawn = Date.parse(c.spawn_at || c.created_at || 0) || Date.now();
    const day = Math.max(0, Math.floor((Date.now() - spawn) / 86400000));
    const anchorDay = c.anchor_at
      ? Math.max(0, Math.floor((Date.parse(c.anchor_at) - spawn) / 86400000)) : 0;
    const journal = (c.journal || []).map(e => ({ d: +e.d || 0, act: e.act, reg: e.reg, wound: e.wound }));
    try {
      // opts.from — то же правило, что у сервера в _pc_calm: до якоря не судим
      return window.PrecursorSim.state(c, journal, day, {
        anchor: JSON.parse(JSON.stringify(c.anchor)),
        cards: (window.Precursors || {}).CARDS,
        from: anchorDay,
      });
    } catch (e) { console.warn('sim:', e); return null; }
  }

  // ══════════════════════════════════════════════════════════
  // РУСЛО (§5)
  // ══════════════════════════════════════════════════════════
  const BAND_TXT = {
    'чрезвычайщина': 'войны, чистки, крепости, вожди',
    'русло': 'торг, ремесло, любопытство, дети',
    'застой': 'обряд без смысла, запрет на новое',
  };
  // Ключи полос приходят из модели и трогать их нельзя; игроку показываем
  // человеческие названия, а не внутренние слова.
  const BAND_NM = {
    'чрезвычайщина': 'Тревожные годы',
    'русло': 'Обычные годы',
    'застой': 'Годы без перемен',
  };
  function flowBlock(st) {
    const band = b => `<div class="pcs-band pcs-band-${b === 'чрезвычайщина' ? 'emerg' : b === 'застой' ? 'stall' : 'flow'}${
      st.band === b ? ' on' : ''}">
      <div class="pcs-band-nm">${esc(BAND_NM[b] || b)}</div>
      <div class="pcs-band-txt">${esc(BAND_TXT[b])}</div>
      ${st.band === b ? '<span class="pcs-here"><i></i>они здесь</span>' : ''}</div>`;
    const val = (k, v, cls, max) => `<div class="pcs-val">
      <span class="pcs-val-k">${esc(k)}</span>
      <span class="pcs-val-n">${v}</span>
      <span class="pcs-bar${cls ? ' ' + cls : ''}"><i style="width:${clamp(100 * v / (max || 100), 0, 100)}%"></i></span>
    </div>`;
    return `<section>
      ${hd('Куда идёт держава', 'pc_flow')}
      <div class="pcs-flow">${band('чрезвычайщина')}${band('русло')}${band('застой')}</div>
      <div class="pcs-vals" style="margin-top:10px">
        ${val('Набат', st.alarm, st.alarm >= 50 ? 'hot' : '')}
        ${val('Устой', st.stead)}
        ${val('Прочность', st.grit, 'grit', 60)}
      </div>
    </section>`;
  }

  // ══════════════════════════════════════════════════════════
  // КРЮЧКИ (§4.3) — то, чего у мира нельзя касаться
  // ══════════════════════════════════════════════════════════
  function hooksBlock(st) {
    const HOOKS = window.PrecursorSim.HOOKS;
    const by = {};
    (st.wounds || []).forEach(w => {
      const k = w.hook;
      if (!by[k] || Math.abs(w.weight) > Math.abs(by[k].weight)) by[k] = w;
    });
    const chips = HOOKS.filter(h => h !== 'седмица').map(h => {
      const w = by[h];
      const cls = !w ? '' : w.state === 'вскрытый' ? ' on open' : w.state === 'изжитый' ? ' on lived' : ' on';
      const tip = !w ? 'у них тут ничего не болит'
        : w.state === 'вскрытый' ? 'разбережено сейчас: держава живёт тем годом'
        : w.state === 'изжитый' ? 'пережито: стало сильной стороной'
        : w.state === 'переписанный' ? 'закрыто вашей версией'
        : 'не зажило: лежит в укладе и распоряжается им';
      return `<span class="pcs-hook${cls}" title="${esc(h + ' — ' + tip)}">
        ${ico(h)}${esc(h)}${w ? `<span class="pcs-hook-w">${Math.abs(w.weight)}</span>` : ''}</span>`;
    }).join('');
    const openN = (st.wounds || []).filter(w => w.state === 'вскрытый').length;
    return `<section>
      ${hd('Чего нельзя касаться', 'pc_wound', openN
        ? `<span style="color:hsl(var(--hue-red) 45% 62%)">разбережено: ${openN}</span>`
        : 'сейчас ничего не болит')}
      <div class="pcs-hooks">${chips}</div>
    </section>`;
  }

  // ══════════════════════════════════════════════════════════
  // СИЛЫ ДЕРЖАВЫ (§9) и НЕБО (§7.4)
  // ══════════════════════════════════════════════════════════
  const SKY_NM = {
    'опора': 'Опора', 'далёкое': 'Далёкое небо', 'капризное': 'Капризное небо',
    'двуликое': 'Двуликое', 'нет': 'Вас для них нет',
  };
  function forcesBlock(st) {
    const f = st.forces;
    const row = (k, nm, v) => `<div class="pcs-force pcs-force-${k}">
      <span class="pcs-force-k">${esc(nm)}</span>
      <span class="pcs-bar"><i style="width:${clamp(v, 0, 100)}%"></i></span>
      <span class="pcs-force-n">${v}</span></div>`;
    return `<section>
      ${hd('Силы державы', 'pc_forces', st.accordance ? '<span style="color:var(--color-accent)">Согласие</span>' : '')}
      <div class="pcs-forces">
        ${row('keep', 'Хранители', f.keep)}
        ${row('cast', 'Отверженные', f.cast)}
        ${row('riot', 'Смутьяны', f.riot)}
      </div>
      <div class="pcs-accord">${esc(SKY_NM[st.sky] || '—')} · уговор ${st.accord} из ${st.sky_cap}</div>
    </section>`;
  }

  // ══════════════════════════════════════════════════════════
  // ЧЁРНЫЕ СЕДМИЦЫ (§4.4) — их календарь, а не наш
  // ══════════════════════════════════════════════════════════
  function yearBlock(c, st) {
    const day = st.day, week = Math.floor(day / 7) % 52;
    const known = day >= 365;              // видны только после прожитого с миром года
    const weeks = new Set(known ? (st.weeks || []) : []);
    const cells = Array.from({ length: 52 }, (_, i) =>
      `<i class="pcs-week${i === week ? ' now' : weeks.has(i) ? ' black' : !known ? ' hidden' : ''}"
        title="${esc('неделя ' + (i + 1) + (weeks.has(i) ? ' — годовщина беды' : i === week ? ' — сейчас' : ''))}"></i>`).join('');
    return `<section>
      ${hd('Их год', 'pc_week', known
        ? `тяжёлых недель: ${(st.weeks || []).length}`
        : `замечено ${Math.floor(day / 7)} недель из 52`)}
      <div class="pcs-year">
        <div class="pcs-weeks">${cells}</div>
        <div class="pcs-year-txt">${known
          ? 'На эти недели приходятся годовщины: старая беда поднимается сама, без всякого повода извне.'
          : 'Их календарь читается только прожитым временем. Разведкой его не купить.'}</div>
      </div>
    </section>`;
  }

  // ══════════════════════════════════════════════════════════
  // НУЖДА В ДВУХ СЛОЯХ (§6)
  // ══════════════════════════════════════════════════════════
  function needBlock(st) {
    const n = st.need;
    if (!n) return '';
    return `<section>
      ${hd('Чего просят', 'pc_need')}
      <div class="pcs-need">
        <div class="pcs-need-said">Просят <b>${esc(n.said)}</b></div>
        ${n.real
          ? `<div class="pcs-need-real">На деле недостаёт: <b>${esc(n.real)}</b></div>`
          : `<div class="pcs-need-real locked">${ICO.lock}Что им нужно на самом деле, вслух не скажут. Уговор ${st.accord} из 40</div>`}
      </div>
    </section>`;
  }

  // ══════════════════════════════════════════════════════════
  // ЛЕСТНИЦА (§8): покой → ритм → слово, и тёмный путь рядом
  // ══════════════════════════════════════════════════════════
  const ACTS = {
    'покой': [
      ['hush', 'Тишина в небе', 'обязательство: боевого флота у их звезды не будет'],
      ['ward', 'Отвод беды', 'перехватить то, что идёт к ним'],
      ['abstain', 'Карантин находки', 'не изучать и не выкачивать'],
      ['ack', 'Признать пропуск', 'вернуться и назвать своё молчание молчанием'],
      ['leave', 'Уйти совсем', 'признать, что крючок — вы сами'],
    ],
    'ритм': [
      ['answer2', 'Ответить на настоящее', 'закрыть то, чего недостаёт, а не то, о чём просят'],
      ['answer', 'Ответить на сказанное', 'дать ровно то, что просили вслух'],
      ['year', 'Круг года', 'календарь, севооборот, запруда'],
      ['work', 'Общее дело', 'стройка или страда на весь мир'],
      ['feast', 'Праздник', 'хор, шествие, поминовение'],
      ['gift', 'Дар', 'то, чего они не куют'],
      ['order', 'Устроение', 'хранилище на чёрный год, чин совета, письменность'],
    ],
    'слово': [
      ['trial', 'Суд памяти', 'дать назвать это самим и пережить названное'],
      ['record', 'Внести в летопись', 'записать отверженных поимённо'],
      ['vira', 'Вира', 'не плата, а недостающее событие'],
      ['forge', 'Подложная летопись', 'закрыть умолчание своей версией'],
    ],
    'тёмное': [
      ['numb', 'Тихая мера', 'снять волнение, не трогая причину'],
      ['breach', 'Вскрыть святилища', 'ихор сегодня, одним решением'],
    ],
  };
  const STEP_N = { 'покой': 1, 'ритм': 2, 'слово': 3, 'тёмное': '—' };

  function actRow(c, step, a, gate) {
    const [id, nm, hint] = a;
    // Ответа сервера ещё нет — это не запрет. Показывать «нельзя» до проверки
    // значит соврать игроку на полсекунды в каждой строке.
    const pending = !gate[id];
    const g = gate[id] || {};
    const off = pending || !g.ok;
    const cost = +g.gc || 0;
    const needW = ['trial', 'record', 'vira'].indexOf(id) >= 0;
    return `<div class="pcs-act${off ? ' off' : ''}${step === 'тёмное' ? ' pcs-act-dark' : ''}">
      <span class="pcs-act-nm">${esc(nm)}<i>${esc(hint)}</i>
        ${!pending && off && g.why ? `<span class="pcs-act-why">${esc(g.why)}</span>` : ''}</span>
      <span class="pcs-act-r">
        ${cost ? `<span class="pcs-act-cost">${num(cost)} ГС</span>` : ''}
        <button class="hp-vn-btn${off ? ' hp-vn-back' : ''}" type="button" ${off ? 'disabled' : ''}
          onclick="event.stopPropagation();pcsDo('${esc(c.system_id)}',${+c.pid},'${id}',${needW ? 'true' : 'false'})">${
            pending ? '…' : off ? 'нельзя' : 'Решить'}</button>
      </span>
    </div>`;
  }

  function ladderBlock(c, st, gate) {
    const reg = window._pcsReg || 'их словом';
    const regs = ['знамение', 'их словом', 'тихо'].map(r =>
      `<button class="pcs-reg${r === reg ? ' on' : ''}" type="button"
        onclick="event.stopPropagation();pcsReg('${r}')">${ico(r)}<b>${esc(r)}</b></button>`).join('');
    const steps = ['покой', 'ритм', 'слово', 'тёмное'].map(step => {
      const rows = ACTS[step].map(a => actRow(c, step, a, gate)).join('');
      const anyOpen = ACTS[step].some(a => (gate[a[0]] || {}).ok);
      const known = ACTS[step].some(a => gate[a[0]]);
      const why = known && step === 'слово' && !anyOpen ? (gate.trial || gate.record || {}).why || '' : '';
      return `<div class="pcs-step${anyOpen ? ' open' : ''}">
        <div class="pcs-step-hd">
          <span class="pcs-step-n">${STEP_N[step]}</span>
          <span class="pcs-step-nm">${esc(step)}</span>
          ${why ? `<span class="pcs-step-why">${esc(why)}</span>` : ''}
        </div>
        <div class="pcs-acts">${rows}</div>
      </div>`;
    }).join('');
    return `<section>
      ${hd('Ступени', 'pc_ladder')}
      <div class="pcs-regs" style="margin-bottom:10px">${regs}</div>
      <div class="pcs-steps">${steps}</div>
    </section>`;
  }

  // ══════════════════════════════════════════════════════════
  // ЛЕТОПИСЬ С УМОЛЧАНИЯМИ (§10)
  // ══════════════════════════════════════════════════════════
  function chronBlock(c, st) {
    let rec = [];
    try { rec = window.PrecursorSim.chronicleOf(c, c.anchor); } catch (e) { rec = c.chronicle || []; }
    const rows = rec.slice().reverse().map(e => `<div class="pcs-rec${
      e.mute ? ' pcs-rec-mute' : e.open ? ' pcs-rec-open' : e.filled ? ' pcs-rec-filled' : ''}">
      <span class="pcs-rec-ph">${esc(e.ph || '')}</span>
      <span class="pcs-rec-tx">${esc(e.text || '')}</span></div>`).join('');
    const mutes = rec.filter(e => e.mute).length;
    return `<section>
      ${hd('Летопись', 'pc_chron', mutes ? `умолчаний: ${mutes}` : '')}
      <div class="pcs-chron">${rows}</div>
    </section>`;
  }

  // ══════════════════════════════════════════════════════════
  // СБОРКА
  // ══════════════════════════════════════════════════════════
  const _gateCache = {};
  function key(c) { return c.system_id + ':' + c.pid; }

  // Досье отдаётся КУСКАМИ, а не одним полотном. Раньше эти семь блоков шли
  // подряд, а карточка мира ставила сверху свои: паспорт, узы, эпоху, беду,
  // решения и летопись. Выходила лента из десяти панелей в один столбец, где
  // «беда» и «летопись» встречались дважды. Куски позволяют карточке разложить
  // их по вкладкам и не показывать всё разом.
  function parts(c) {
    if (!c || !c.anchor) return null;
    const st = calc(c);
    if (!st) return null;
    const gate = _gateCache[key(c)] || {};
    return {
      // Приборы: куда идёт держава, чего нельзя касаться, силы, календарь.
      приборы: `<div class="pcs">${flowBlock(st)}${hooksBlock(st)}${forcesBlock(st)}${yearBlock(c, st)}</div>`,
      беда: `<div class="pcs">${needBlock(st)}</div>`,
      лестница: `<div class="pcs">${ladderBlock(c, st, gate)}</div>`,
      летопись: `<div class="pcs">${chronBlock(c, st)}</div>`,
    };
  }

  // Целиком — для тех, кто зовёт досье вне карточки (стенды, админка).
  function render(c) {
    const p = parts(c);
    if (!p) return '';
    return p['приборы'] + p['беда'] + p['лестница'] + p['летопись'];
  }

  // Запреты спрашиваем у сервера одним заходом: причина отказа — часть правил,
  // и придумывать её на клиенте значит однажды соврать.
  // Запросы уже сделаны? Иначе перерисовка после ответа дёрнет их снова, и
  // карточка уйдёт в бесконечный круг «спросил — перерисовал — спросил».
  function hasGates(c) { return !!_gateCache[key(c)]; }
  function dropGates(c) { delete _gateCache[key(c)]; }

  // Старые решения спрашиваем тем же заходом: с этапа 9 они ходят той же
  // дверью (precursor_commit), значит и запреты у них те же и оттуда же.
  const LEGACY = ['study', 'boon', 'envoy', 'miracle', 'covenant', 'uplift',
                  'protect', 'harvest', 'enslave', 'convert', 'purge', 'lesson', 'rite'];

  async function loadGates(c) {
    if (typeof ecRpc !== 'function') return {};
    const ids = [].concat(...Object.keys(ACTS).map(s => ACTS[s].map(a => a[0])), LEGACY);
    const out = {};
    const w = (c.anchor && (c.anchor.wounds || [])[0] || {}).src || null;
    const debt = ((c.anchor && c.anchor.wounds) || []).find(x => x.kind === 'долг');
    await Promise.all(ids.map(async id => {
      const wound = id === 'vira' ? (debt || {}).src || 'святилище'
        : (id === 'trial' || id === 'record') ? w : null;
      try {
        out[id] = await ecRpc('precursor_can', {
          p_system_id: c.system_id, p_pid: +c.pid, p_act: id, p_wound: wound,
        });
      } catch (e) { out[id] = { ok: false, why: 'проверка не прошла' }; }
    }));
    _gateCache[key(c)] = out;
    return out;
  }

  // ══════════════════════════════════════════════════════════
  // НЕДОИМКА: публичный реестр (§18)
  // ══════════════════════════════════════════════════════════
  // Главное здесь — не цифра, а ПОИМЁННО. Галактика видит, кто набрал, и это
  // работает раньше самого кризиса: реестр читают как повод для ультиматума.
  const ST_TXT = {
    'нет':          ['Счёт молчит', 'Вскрытых святилищ мало, и о них ещё не говорят.'],
    'слухи':        ['Слухи', 'Миры у вскрытых руин замолчали. Недоимка стала видна всем.'],
    'признаки':     ['Признаки', 'Миры под Заветом отдают ихор скупее — по всей галактике, всем.'],
    'сбор':         ['СБОР', 'Доли идут туда, откуда брали. Им нужен ихор, а не колонии.'],
    'полный сбор':  ['ПОЛНЫЙ СБОР', 'Взыскание идёт быстрее, сектора выпадают из хозяйства один за другим.'],
  };

  function arrears(reg) {
    if (!reg) return '';
    const stage = reg.stage || 'нет';
    const t = ST_TXT[stage] || ST_TXT['нет'];
    const hot = stage === 'сбор' || stage === 'полный сбор';
    const rows = reg.rows || [];
    const top = rows.length ? Math.max.apply(null, rows.map(r => +r.amount || 0)) : 0;
    const mine = reg.mine || null;
    const mult = +reg.mult || 1;

    const list = rows.length ? rows.map(r => `
      <div class="pcs-arr-row${r.mine ? ' me' : ''}">
        <span class="pcs-arr-nm">${esc(r.name)}${r.mine ? ' <i>вы</i>' : ''}</span>
        <span class="pcs-bar${hot ? ' hot' : ''}"><i style="width:${
          clamp(top > 0 ? (+r.amount / top) * 100 : 0, 0, 100).toFixed(1)}%"></i></span>
        <span class="pcs-arr-n">${num(r.amount)}</span>
        <span class="pcs-arr-sh">${Math.round((+r.share || 0) * 100)}%</span>
      </div>`).join('') : '';

    return `<div class="pcs pcs-arr${hot ? ' hot' : ''}">
      ${hd('Недоимка · ' + t[0], 'pc_arrears',
           reg.total != null ? num(reg.total) + (reg.next ? ' / ' + num(reg.next) : '') : 'счёт скрыт')}
      <div class="pcs-arr-lead">${esc(t[1])}${
        mult < 1 ? ' Ставка Завета — ' + Math.round(mult * 100) + '% от прежней.' : ''}</div>
      ${list ? `<div class="pcs-arr-list">${list}</div>` : ''}
      ${mine ? `<div class="pcs-arr-mine">Ваш счёт: <b>${num(mine.amount)}</b> · набрано за всё время ${
        num(mine.taken)} · возвращено ${num(mine.repaid)} · миров ${num(mine.worlds)}</div>` : ''}
    </div>`;
  }

  // Что ответил сервер про одно решение. `null` — ещё не спрашивали: это НЕ
  // «нельзя», и рисовать красную причину до ответа значит соврать.
  function gateOf(c, id) {
    const g = _gateCache[key(c)];
    return g ? (g[id] || null) : null;
  }

  window.PrecursorDossier = { render, parts, loadGates, hasGates, dropGates, gateOf, calc, arrears, ICO };

  // ── обработчики ───────────────────────────────────────────
  window.pcsReg = function (r) {
    window._pcsReg = r;
    document.querySelectorAll('.pcs-reg').forEach(b =>
      b.classList.toggle('on', (b.textContent || '').trim() === r));
  };

  window.pcsDo = async function (sysId, pid, act, needWound) {
    let wound = null;
    if (needWound) {
      const civ = (window._pcState && (window._pcState.civs || []).find(
        x => x.system_id === sysId && +x.pid === +pid)) || null;
      const ws = ((civ && civ.anchor && civ.anchor.wounds) || []);
      wound = act === 'vira'
        ? (ws.find(x => x.kind === 'долг') || { src: 'святилище' }).src
        : (ws.find(x => x.kind !== 'долг' && x.state !== 'изжитый') || ws[0] || {}).src;
    }
    try {
      const r = await ecRpc('precursor_commit', {
        p_system_id: sysId, p_pid: +pid, p_act: act,
        p_reg: window._pcsReg || 'их словом', p_wound: wound,
      });
      if (r && r.ok === false) { if (typeof toast === 'function') toast(r.why || 'Нельзя', 'err'); return; }
      if (typeof toast === 'function') {
        toast(r && r.ichor ? `Записано. Ихор: ${r.ichor}` : 'Записано в журнал', 'ok');
      }
      _gateCache[sysId + ':' + pid] = null; delete _gateCache[sysId + ':' + pid];
      if (typeof heroVNTamaRefresh === 'function') heroVNTamaRefresh();
    } catch (e) {
      if (typeof toast === 'function') toast(((e && e.message) || e) + '', 'err');
    }
  };
})();
