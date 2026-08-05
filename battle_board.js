// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════
// ДОСКА БОЯ — пошаговое сражение флотов (тактика: дальность + огневые
// группы + ландшафт + сигнатуры). Зеркало _war_battle.sql +
// _war_battle_rework.sql + _war_battle_tactics.sql + _battle_no_arcs.sql.
//
// ХОД СТОРОНЫ = 6 АКТИВАЦИЙ. Ход кораблём — это МАРШРУТ по гексам: любой
// шаг в свободный соседний гекс, лимит один — скорость. Ракурса нет: курс
// корабля только разворачивает спрайт. Огонь решает ДАЛЬНОСТЬ — отрабатывают
// все ОГНЕВЫЕ ГРУППЫ, чья дальность накрывает дистанцию, поэтому сближение
// прямо добавляет залпов. Чужой корабль без захвата радаром —
// «неопознанный контакт»: точка на доске, огонь вести нельзя.
//
// Доска — ГЕКСЫ flat-top в odd-q offset. Рендер — canvas с камерой
// (зум/панорама). Задник — чистая тьма без звёзд, корабли ПЛАВНО скользят
// между гексами при перемещении (и своём, и чужом — видно, чем занят враг), а
// выстрелы дают трассеры/вспышки/разлёт обломков. Далёкие пустые гексы у
// краёв гаснут во тьму — доска не «обрывается» голой сеткой.
// СМЕНА ХОДА: при переходе хода — вспышка-баннер «Ход противника»/«Ваш ход»,
// а камера сама доворачивается к действиям врага (и обратно к своим на своём
// ходу), чтобы чужой манёвр/залп не оставался за кадром.
// Все панели — В НИЖНЕМ ДОКЕ под доской (сворачивается), сбоку пусто.
// ════════════════════════════════════════════════════════════════════

const BB = {
  id: null,          // id боя
  st: null,          // ответ battle_state
  cv: null, ctx: null,
  R: 34,             // радиус гекса в МИРОВЫХ px (зум поверх)
  dpr: 1,
  vw: 0, vh: 0,      // размер вьюпорта канваса (CSS px)
  zoom: 1, camX: 0, camY: 0,   // камера
  camReady: false,   // камера один раз центрируется на своей зоне
  // Покрытие радаров — состояние по умолчанию ВКЛЮЧЕНО: без него не читается
  // оперативная обстановка. Раньше флаг ставился только при закрытии доски,
  // и первый бой за сессию открывался без слоя.
  fog: (function () { try { return localStorage.getItem('bb_fog') !== '0'; } catch (e) { return true; } })(),
  sel: null,         // выбранный свой корабль (id)
  heal: false,       // режим ремонта: следующий клик по СОЮЗНОМУ кораблю = нано-рой
  hover: null,       // {x,y} гекс под курсором
  pick: null,        // фаза расстановки: выбранный проект из резерва
  spec: null,        // фаза расстановки: чьи полные ТТХ открыты шторкой (unit_id)
  place: [],         // фаза расстановки: [{unit_id, unit_name, cls, x, y}]
  q: '',             // фаза расстановки: строка поиска по резерву
  traySL: 0,         // и позиция прокрутки ленты бортов
  poll: null,        // таймер опроса (ход противника)
  busy: false,
  spr: {},           // кэш спрайтов кораблей
  tex: {},           // кэш текстур корпуса
  sheet: null,       // открытая шторка: 'log' | 'reinf' | 'unit'
  deployUI: false,   // открыт отдельный экран фазы расстановки?
  shipDrag: null,    // расстановка: тащим уже стоящий борт {i, cell}
  fac: {},           // fid → {name, color, herald} — гербы держав в бою
  terr: null,        // Map "x:y" → 'ast'|'neb'|'grv'|'deb'
  reach: null,       // Map "x:y" → {steps, path} для выбранного корабля
  ptrs: new Map(),
  drag: null,
  pinch: null,
  glOn: false,       // доска рисуется трёхмерной сценой (battle_gl.js)
  glCv: null,        // её канвас: переживает пересборку разметки, см. bbMount
  glOff: false,      // WebGL не завёлся — больше не пробуем, сидим на 2D
  glWait: false,     // 3D ещё собирается: доска под завесой, 2D не показываем
  glTmo: 0,          // сторож завесы: 3D не доехал за отведённое время → 2D
  anim: { move: new Map(), fx: [], raf: 0 },   // движение кораблей + эффекты боя
  prevU: null,       // снимок юнитов прошлого кадра (для диффа перемещений/потерь)
  prevTurn: null,    // чей был ход в прошлом кадре ('me'|'foe'|side) — для баннера передачи хода
  camAnim: null,     // плавный доворот камеры к действиям противника {x0,y0,x1,y1,t0,dur}
  moveHint: new Map(), // id → реальный маршрут своего хода [{x,y,f}] (для анимации по гексам)
};

const BB_SQ3 = Math.sqrt(3);

const BB_C = {
  bg:     '#05070d',
  hex:    'rgba(90,200,230,0.14)',
  hexIn:  'rgba(90,200,230,0.03)',
  mine:   '90,220,240',
  foe:    '255,60,130',
  move:   'rgba(90,220,240,0.18)',
  fire:   'rgba(255,60,130,0.22)',
  fireEdge: 'rgba(255,60,130,0.30)',
  heal:   '120,255,190',                  // луч ремонтного нано-роя
  healZone: 'rgba(120,255,190,0.20)',     // подсветка союзников в режиме ремонта
};

// ── Открыть / закрыть ───────────────────────────────────────
async function bbOpen(battleId, spectate, botFoe) {
  BB.id = battleId; BB.sel = null; BB.pick = null; BB.place = []; BB.spec = null;
  BB.traySL = 0;              // позиция ленты бортов живёт в пределах одного боя
  BB.spectate = !!spectate;   // зритель дуэли клуба: полное зрение, без действий
  BB.botFoe = !!botFoe;       // админ-тест против ботов: боты ходят сами, автоматически
  BB.camReady = false; BB.reach = null;
  // Библиотеку 3D тянем СРАЗУ, параллельно снимку боя: к моменту, когда доска
  // появится в разметке, она обычно уже доехала — и завеса снимается почти
  // мгновенно, а не после отдельного круга загрузки.
  BB.glWait = !BB.glOff && typeof bgLoadThree === 'function';
  if (BB.glWait) try { bgLoadThree(); } catch (e) { BB.glWait = false; }
  let ov = document.getElementById('bb-ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'bb-ov'; ov.className = 'bb-ov';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="bb-load">Связь с полем боя…</div>`;
  ov.classList.add('show');
  document.body.style.overflow = 'hidden';
  const facs = bbLoadFacs();       // справочник гербов — параллельно со снимком боя
  await bbReload();
  // герб доехал позже снимка — перерисовать доску с ним (DOM + 3D-подписи)
  facs.then(() => { if (BB.id && BB.st) bbRender(); });
  bbStartPoll();
}

// ── ГЕРБЫ ДЕРЖАВ ────────────────────────────────────────────
// В бою на одной стороне бывает не одна держава: дуэли клуба, боты,
// союзники в общей свалке. Имя борта об этом молчит, поэтому рядом с
// именем идёт герб владельца — тот же, что на карте: картинка из анкеты
// (faction_applications.herald_url), а без неё — щиток цветом фракции с
// инициалами. Справочник грузится ОДИН раз на открытие боя: держав
// десятки, это дешевле, чем тянуть герб на каждый борт.
async function bbLoadFacs() {
  try {
    const [facs, apps] = await Promise.all([
      dbGet('map_factions', 'select=id,name,color').catch(() => []),
      dbGet('faction_applications', 'status=eq.approved&select=faction_id,name,herald_url').catch(() => []),
    ]);
    const reg = {};
    (facs || []).forEach(f => {
      if (f && f.id) reg[f.id] = { name: f.name || '', color: f.color || '', herald: '' };
    });
    (apps || []).forEach(a => {
      if (!a || !a.faction_id) return;
      const r = reg[a.faction_id] || (reg[a.faction_id] = { name: '', color: '', herald: '' });
      r.herald = (a.herald_url || '').trim();      // в анкете бывает пустая строка, а не null
      if (!r.name) r.name = a.name || '';
    });
    BB.fac = reg;
  } catch (e) { /* герб — украшение: без справочника доска работает как раньше */ }
}

// Держава борта: fid приходит в battle_state/fc_watch_state вместе с именем
// державы (fname) — справочник нужен только ради герба и цвета.
// У «неопознанного контакта» fid нет: чей он — как раз то, что скрыто.
function bbFacOf(u) {
  const fid = u && u.fid; if (!fid) return null;
  const r = (BB.fac || {})[fid] || {};
  return { fid, name: r.name || u.fname || '', color: r.color || '', herald: r.herald || '' };
}
// Цвет фракции идёт с карты полупрозрачным (заливка территории) — на щитке
// герба он превратился бы в грязь, поэтому альфу выкидываем.
function bbFacCol(c) {
  const m = String(c || '').match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? `rgb(${m[1]},${m[2]},${m[3]})` : '#33506a';
}
function bbFacIni(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}
// Значок державы для разметки (карточка борта, полоска выбранного, шторка)
function bbFacIco(u) {
  const f = bbFacOf(u); if (!f) return '';
  const ttl = esc(f.name || 'держава');
  return f.herald
    ? `<img class="bb-fac-ico" src="${esc(f.herald)}" alt="" title="${ttl}" loading="lazy">`
    : `<span class="bb-fac-ico bb-fac-ph" title="${ttl}" style="background:${bbFacCol(f.color)}">${esc(bbFacIni(f.name))}</span>`;
}
function bbClose() {
  if (typeof bbWheelClose === 'function') bbWheelClose();   // колесо живёт только внутри боя
  bbStopPoll();
  if (BB.glOn && typeof bgDispose === 'function') try { bgDispose(); } catch (e) {}
  BB.glOn = false; BB.glWait = false;
  if (BB.glTmo) { clearTimeout(BB.glTmo); BB.glTmo = 0; }
  if (BB.glCv) { BB.glCv.remove(); BB.glCv = null; }
  const ov = document.getElementById('bb-ov');
  if (ov) ov.classList.remove('show');
  document.body.style.overflow = '';
  BB.id = null; BB.st = null; BB.cv = null; BB.ctx = null;
  BB.terr = null; BB.reach = null; BB.cov = null; BB.prevU = null;
  try { BB.fog = localStorage.getItem('bb_fog') !== '0'; } catch (e) { BB.fog = true; }
  BB.prevTurn = null; BB.camAnim = null; BB.moveHint.clear();
  BB.q = ''; BB.traySL = 0;          // строка поиска по резерву — своя на каждый бой
  if (BB.anim.raf) cancelAnimationFrame(BB.anim.raf);
  BB.anim = { move: new Map(), fx: [], raf: 0 };
  BB.ptrs.clear(); BB.drag = null; BB.pinch = null;
  if (typeof ecReload === 'function') ecReload();
}

function bbStartPoll() {
  bbStopPoll();
  BB.poll = setInterval(() => {
    if (!BB.id || !BB.st) return;
    if (BB.st.status === 'done') { bbStopPoll(); return; }
    if (BB.st.my_turn) return;
    bbReload();
  }, 15000);
}
function bbStopPoll() { if (BB.poll) { clearInterval(BB.poll); BB.poll = null; } }

async function bbReload() {
  if (!BB.id) return;
  const prev = BB.prevU;                 // снимок кораблей до обновления
  let next;
  try {
    next = await ecRpc(BB.spectate ? 'fc_watch_state' : 'battle_state', { p_battle: BB.id });
  } catch (e) {
    if (bbGone(e)) { bbShowGone(); return; }   // и опрос глушим, иначе тикает в пустоту
    const ov = document.getElementById('bb-ov');
    if (ov) ov.innerHTML = `<div class="bb-load">Бой недоступен: ${esc(e.message || e)}<br><button class="btn btn-gh btn-sm" style="margin-top:12px" onclick="bbClose()">Закрыть</button></div>`;
    return;
  }
  BB.st = next;
  // ландшафт → быстрый Map для проверок и рендера.
  // Две формы хранения: объект {"x:y":"ast"} у боёв с зонированием
  // (_bt_arena_zoning.sql) и массив [{x,y,t}] у боёв до него.
  BB.terr = new Map();
  const _tr = BB.st.terrain;
  if (Array.isArray(_tr)) _tr.forEach(e => BB.terr.set(e.x + ':' + e.y, e.t));
  else if (_tr && typeof _tr === 'object') for (const k in _tr) BB.terr.set(k, _tr[k]);
  BB.reach = null; BB.cov = null;   // состояние сменилось — покрытие пересчитать
  bbRender();
  bbDiffAnimate(prev, BB.st.units || []);   // раньше баннера: дифф решает, магнитить ли к врагу
  bbTurnHandover();                         // баннер «Ход противника»/«Ваш ход» + возврат к своим
  // снимок для следующего диффа
  BB.prevU = (BB.st.units || []).map(u => ({ id: u.id, x: u.x, y: u.y, hp: u.hp, facing: u.facing, contact: u.contact, mine: u.mine, side: u.side }));
  bbMaybeBotTurn();
}

// Ключ «чей сейчас ход» для сравнения кадров. Для участника — свой/чужой,
// для зрителя дуэли — конкретная сторона.
function bbTurnKey(s) {
  if (!s || s.status !== 'active') return null;
  if (s.my_side === 'spectator') return 'side:' + (s.side_to_move || '');
  return s.my_turn ? 'me' : 'foe';
}
// Баннер передачи хода: короткая вспышка поверх доски при переходе хода
// от одной стороны к другой. Так виден сам факт «ход перешёл», а не только
// сменившийся текст в полосе состояния.
function bbTurnHandover() {
  const s = BB.st; if (!s) return;
  const key = bbTurnKey(s);
  const prev = BB.prevTurn;
  BB.prevTurn = key;
  if (key == null || prev == null || key === prev) return;
  let txt, cls;
  if (s.my_side === 'spectator') {
    const att = s.side_to_move === 'attacker';
    txt = 'Ходит: ' + esc(att ? (s.attacker_name || 'нападающий') : (s.defender_name || 'обороняющийся'));
    cls = att ? 'bb-tf-me' : 'bb-tf-foe';
  } else if (key === 'me') {
    txt = 'Ваш ход'; cls = 'bb-tf-me';
    // вернуть обзор к своим кораблям — но НЕ перебивая только что наведённый
    // магнит к действиям врага (тогда сначала показываем чужой залп).
    const mine = (s.units || []).filter(u => u.mine);
    if (mine.length && !BB.drag && !BB.foeActed) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      mine.forEach(u => { const c = bbHexCenter(u.x, u.y);
        minx = Math.min(minx, c.px); maxx = Math.max(maxx, c.px);
        miny = Math.min(miny, c.py); maxy = Math.max(maxy, c.py); });
      const pad = BB.R * 8;
      let z = Math.min(BB.vw / ((maxx - minx) + pad), BB.vh / ((maxy - miny) + pad));
      z = Math.max(0.6, Math.min(z, 1.3));
      bbCamFocus((minx + maxx) / 2, (miny + maxy) / 2, z, 650);
    }
  } else {
    txt = 'Ход противника'; cls = 'bb-tf-foe';
  }
  bbShowTurnFlash(txt, cls);
}
function bbShowTurnFlash(txt, cls) {
  const host = document.querySelector('.bb-cvw'); if (!host) return;
  const old = host.querySelector('.bb-turn-flash'); if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'bb-turn-flash ' + cls;
  el.innerHTML = `<span class="bb-tf-bar"></span><span class="bb-tf-t">${txt}</span><span class="bb-tf-bar"></span>`;
  host.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// Дифф старого и нового состава: кто сдвинулся — плавно едет; кто потерял
// корпус — вспышка попадания; кто исчез — разлёт обломков. Так на доске
// видно И свой ход, И то, чем занят противник между опросами.
function bbDiffAnimate(prev, cur) {
  if (!Array.isArray(prev) || !prev.length) return;   // первый кадр — без анимации
  const pm = new Map(prev.map(u => [u.id, u]));
  const seen = new Set();
  const foeAct = [];   // точки действий противника — камера доворачивается к ним
  const spec = BB.st && BB.st.my_side === 'spectator';
  const now = performance.now();
  const shots = [];    // урон/потери — собираем, чтобы разложить залп во времени
  cur.forEach(u => {
    seen.add(u.id);
    const p = pm.get(u.id);
    if (!p) return;
    // перемещение — по гексам маршрута, а не по прямой
    if ((p.x !== u.x || p.y !== u.y) && !u.contact && !p.contact) {
      const mv = bbBuildMove(p, u);
      if (mv) BB.anim.move.set(u.id, mv);
      if (!u.mine) { const c = bbHexCenter(u.x, u.y); foeAct.push(c); }
    }
    // попадание: корпус просел, но корабль жив
    if (p.hp != null && u.hp != null && u.hp < p.hp - 0.01) {
      shots.push({ x: u.x, y: u.y, mine: u.mine, side: u.side, kind: 'hit',
                   dmg: p.hp - u.hp,      // величину урона знает только дифф снимков
                   col: u.mine ? BB_C.mine : BB_C.foe, foe: spec || !!u.mine });
      // Камеру тянем ТОЛЬКО к чужой работе. Попадание по врагу — это наш
      // собственный выстрел: игрок уже смотрит куда надо, и увозить кадр
      // к цели (а при нескольких залпах — в середину между ними) незачем.
      if (spec || u.mine) foeAct.push(bbHexCenter(u.x, u.y));
    }
  });
  // потери: были в прошлом кадре, пропали — взрыв на прежнем месте
  prev.forEach(p => {
    if (seen.has(p.id) || p.contact) return;
    shots.push({ x: p.x, y: p.y, mine: p.mine, side: p.side, kind: 'boom',
                 col: '255,150,60', foe: spec || !!p.mine });
    if (spec || p.mine) foeAct.push(bbHexCenter(p.x, p.y));   // свой добитый враг камеру не двигает
  });
  // Раскладываем урон во времени. Залпы ПО НАМ (или всё, если зритель) — это
  // ход противника: показываем чередой, с трассером и дульной вспышкой у
  // стрелка, чтобы сам ход врага читался. Наши подтверждённые попадания
  // (трассер уже нарисован по клику) — сразу, без повторной линии.
  let seq = 0;
  shots.forEach(ev => {
    const c = bbHexCenter(ev.x, ev.y);
    const dur = ev.kind === 'boom' ? 950 : 600;
    if (ev.foe) {
      const start = now + seq * 150; seq++;
      const sh = bbNearestShooter(ev, cur);
      if (sh) {
        const a = bbHexCenter(sh.x, sh.y), col = bbShooterCol(sh);
        foeAct.push(a);
        bbFxAdd({ kind: 'flash', px: a.px, py: a.py, t0: start, dur: 240, col });
        bbFxAdd({ kind: 'beam', x0: a.px, y0: a.py, x1: c.px, y1: c.py,
                  t0: start, dur: 380, col, head: true });
        bbFxAdd({ kind: ev.kind, px: c.px, py: c.py, t0: start + 300, dur, col: ev.col, dmg: ev.dmg });
      } else {
        bbFxAdd({ kind: ev.kind, px: c.px, py: c.py, t0: start, dur, col: ev.col, dmg: ev.dmg });
      }
    } else {
      bbFxAdd({ kind: ev.kind, px: c.px, py: c.py, t0: now, dur, col: ev.col, dmg: ev.dmg });
    }
  });
  // Камера магнитится к действиям противника: наводится на них И зумит,
  // чтобы кадрировать залп/манёвр. Гейта «сейчас чужой ход» тут быть НЕ
  // должно — снимок приходит опросом, когда ход УЖЕ вернулся к нам, но
  // foeAct содержит только чужие действия, так что этого достаточно.
  BB.foeActed = foeAct.length > 0;   // подсказка для bbTurnHandover: не тянуть камеру домой
  if (foeAct.length && !BB.drag) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    foeAct.forEach(c => {
      minx = Math.min(minx, c.px); maxx = Math.max(maxx, c.px);
      miny = Math.min(miny, c.py); maxy = Math.max(maxy, c.py);
    });
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    // подгоняем зум под охват действий + запас, но в разумных пределах
    const pad = BB.R * 7;
    const bw = (maxx - minx) + pad, bh = (maxy - miny) + pad;
    let z = Math.min(BB.vw / bw, BB.vh / bh);
    z = Math.max(0.7, Math.min(z, 1.45));
    bbCamFocus(cx, cy, z, 700);
  }
  bbAnimKick();
}

// Ближайший вражеский корабль-стрелок для восстановления трассера: снимок
// не говорит, КТО выстрелил, — берём ближайший корабль из другого лагеря.
function bbNearestShooter(ev, cur) {
  let best = null, bd = Infinity;
  for (const u of cur) {
    if (u.contact) continue;
    if (ev.side ? u.side === ev.side : (!!u.mine === !!ev.mine)) continue;  // стрелок — из другого лагеря
    if (u.x === ev.x && u.y === ev.y) continue;
    const d = bbDist({ x: u.x, y: u.y }, { x: ev.x, y: ev.y });
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
// Цвет трассера/вспышки по стороне стрелка: мои — бирюза, чужие — малина;
// для зрителя — по лагерю (нападающий/обороняющийся).
function bbShooterCol(sh) {
  if (sh.mine) return BB_C.mine;
  if (BB.st && BB.st.my_side === 'spectator')
    return sh.side === 'attacker' ? BB_C.mine : BB_C.foe;
  return BB_C.foe;
}

// Плавный доворот+зум камеры: мировая точка (px,py) уезжает в центр вьюпорта,
// а зум тянется к zoom. Интерполируем именно ЦЕНТР обзора, чтобы точка держалась
// в кадре на всём протяжении. Не дёргает, если и так почти на месте.
function bbCamFocus(px, py, zoom, dur) {
  // В 3D «зум» — это дистанция камеры; охват кадра пересчитываем из того же
  // множителя, каким доска кадрировала бы залп на плоскости.
  if (BB.glOn) { bgCamFocus(px, py, BB.vw / Math.max(0.2, zoom || BB.zoom), dur); return; }
  const z0 = BB.zoom;
  const cx0 = BB.camX + BB.vw / z0 / 2, cy0 = BB.camY + BB.vh / z0 / 2;
  const z1 = Math.max(0.2, Math.min(3, zoom || z0));
  if (Math.hypot(px - cx0, py - cy0) < BB.R * 0.5 && Math.abs(z1 - z0) < 0.03) return;
  BB.camAnim = { cx0, cy0, cx1: px, cy1: py, z0, z1, t0: performance.now(), dur: dur || 700 };
  bbAnimKick();
}

// Бой с ботами (админ-тест): когда наступает ход стороны-ботов — прогоняем его
// автоматически, чтобы не бегать в админку жать «Ход ботов». Боты не могут
// ходить сами через RPC (нет auth), поэтому их ход инициирует клиент админа.
function bbIsStaff() {
  return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor'].includes(user.role));
}
async function bbMaybeBotTurn() {
  const s = BB.st;
  if (BB.botRunning || !s || BB.spectate) return;
  // Пробуем прогнать за ботов, если: это помеченный бот-бой ЛИБО ты — стафф
  // (тогда сервер сам решит — «это не бой с ботами» просто проглотим).
  if (!BB.botFoe && !bbIsStaff()) return;
  if (s.status !== 'active') return;
  // не мой ход = ход стороны-ботов (я — участник, боты — противник)
  if (s.my_turn) return;
  BB.botRunning = true;
  try {
    await ecRpc('admin_bot_turn', { p_battle: BB.id });
  } catch (e) {
    BB.botRunning = false;
    if (bbGone(e)) { bbShowGone(); return; }
    // «сейчас ход игрока» и т.п. — тихо игнорируем, доска просто останется как есть
    if (e && e.message && !/ход игрока|не бой с ботами/i.test(e.message))
      toast(e.message, 'err');
    return;
  }
  BB.botRunning = false;
  await bbReload();   // покажем результат и, если снова ход ботов, прогоним ещё
}

// ── Каркас экрана: КАРТА НА ВЕСЬ ЭКРАН, всё прочее — накладки ────
// Панели больше не отжимают доску вниз (на телефоне из-за этого доски не было
// видно вовсе): карточка корабля, подкрепление и журнал живут в шторке,
// которая открывается кнопкой и закрывается тапом по карте.
function bbRender() {
  const s = BB.st; if (!s) return;
  const ov = document.getElementById('bb-ov'); if (!ov) return;
  const spec = s.my_side === 'spectator';   // зритель дуэли клуба
  // Расстановка — ОТДЕЛЬНАЯ ФАЗА со своим экраном.
  if (s.status === 'forming' && !spec) { bbRenderDeploy(s); return; }
  BB.deployUI = false;

  const foeName = (spec || s.my_side === 'attacker') ? s.defender_name : s.attacker_name;
  const myName  = (spec || s.my_side === 'attacker') ? s.attacker_name : s.defender_name;
  const done = s.status === 'done';
  const mv = s.my_turn;
  const actsMax = s.acts_max || 6;
  const sel = (s.units || []).find(u => u.id === BB.sel);

  // ── HUD: чей ход и сколько активаций осталось ──
  const turnLbl = done ? 'бой окончен'
    : (spec ? (s.side_to_move === 'attacker' ? esc(s.attacker_name || 'нападающий') : esc(s.defender_name || 'обороняющийся'))
            : (mv ? 'ваш ход' : 'ход противника'));
  const hud = `
    <div class="bbf-hud${mv && !done ? ' bbf-hud-my' : ''}">
      <span class="bbf-hud-t">${turnLbl}</span>
      ${!done && mv ? `<span class="bbf-hud-a">${'◆'.repeat(Math.max(0, s.acts_left || 0))}${'◇'.repeat(Math.max(0, actsMax - (s.acts_left || 0)))}</span>` : ''}
      <span class="bbf-hud-vs">${esc(myName)} · ${esc(foeName)}</span>
    </div>`;

  // ── Шторка: журнал / подкрепление ──
  let sheet = '';
  if (BB.sheet === 'log') {
    const log = Array.isArray(s.log) ? s.log.slice(-40).reverse() : [];
    sheet = `<div class="bbf-sheet"><div class="bbf-sheet-h">Журнал
        <button onclick="bbSheet(null)">✕</button></div>
      <div class="bbf-sheet-b">${log.length
        ? log.map(l => `<div class="bb-log-l">${esc(l.m || '')}</div>`).join('')
        : '<div class="bb-empty">Пока пусто.</div>'}</div></div>`;
  } else if (BB.sheet === 'reinf') {
    sheet = `<div class="bbf-sheet"><div class="bbf-sheet-h">Подкрепление
        <button onclick="bbSheet(null)">✕</button></div>
      <div class="bbf-sheet-b">${bbReinfPanel(s) || '<div class="bb-empty">Резерв пуст.</div>'}</div></div>`;
  } else if (BB.sheet === 'kit' && sel) {
    sheet = `<div class="bbf-sheet"><div class="bbf-sheet-h">Снаряжение · ${esc(sel.name)}
        <button onclick="bbSheet(null)">✕</button></div>
      <div class="bbf-sheet-b">${bbKitPanel(s, sel)}</div></div>`;
  } else if (BB.sheet === 'unit' && sel) {
    sheet = `<div class="bbf-sheet"><div class="bbf-sheet-h"><span class="bbf-sheet-n">${bbFacIco(sel)}${esc(sel.name)}</span>
        <button onclick="bbSheet(null)">✕</button></div>
      <div class="bbf-sheet-b">${bbUnitPanel(s)}</div></div>`;
  }

  // ── Полоска выбранного корабля: коротко и всегда на виду ──
  // Ремонт нано-роем — единственное действие, которого НЕ сделать кликом по
  // доске (по союзнику огня нет, нужен режим). Внутри шторки «ТТХ» его просто
  // не находили: борт выбран, лечить некому. Поэтому кнопка живёт здесь.
  // Колесо действий — рядом с остальными командами, а не в шторке ТТХ:
  // в полноэкранном бою панель корабля открывается лишним кликом, и кнопку там не находят.
  const wheelBtn = (sel && sel.mine && s.status === 'active')
    ? `<button class="bbd-ic bbd-ic-gd" onclick="bbWheelOpen('${jsq(sel.id)}')"
         title="Что делать этим ходом: манёвр / залп / щит (клавиша У)">🎯</button>`
    : '';
  const healBtn = (sel && sel.mine && s.my_turn && bbHasHeal(sel) && bbCanFire(sel))
    ? `<button class="bbd-ic${BB.heal ? ' bbd-ic-on' : ''}" onclick="bbHealMode()"
         title="${BB.heal ? 'Выберите союзника для ремонта (ещё раз — отмена)' : 'Ремонт нано-роем по союзному кораблю'}">🛠</button>`
    : '';
  // Снаряжение: кнопка есть только у борта, где оно вообще стоит. Цифра —
  // сколько модулей готово прямо сейчас: чтобы не открывать список впустую.
  const kitReady = (sel && Array.isArray(sel.acts))
    ? sel.acts.filter(a => bbKitCd(sel, a.k) === 0).length : 0;
  const kitBtn = (sel && sel.mine && s.status === 'active' && Array.isArray(sel.acts) && sel.acts.length)
    ? `<button class="bbd-ic${BB.mod ? ' bbd-ic-on' : ''}" onclick="bbSheet('kit')"
         title="Активное снаряжение: ${kitReady} из ${sel.acts.length} готово">🧰${
           kitReady ? `<b>${kitReady}</b>` : ''}</button>`
    : '';
  const bar = sel ? `<div class="bbf-sel" onclick="bbSheet('unit')">
      <span class="bbf-sel-n">${bbFacIco(sel)}${esc(sel.name)}</span>
      <span class="bbf-sel-more">ТТХ ▸</span>
      <span class="bbf-sel-hp"><i style="width:${Math.max(0, Math.min(100, sel.hp / sel.max_hp * 100))}%"></i></span>
      ${bbTpBar(sel)}${bbStanceChip(sel)}
      <span class="bbf-sel-s">${sel.hp}/${sel.max_hp} · до ${sel.rng} гекс${
        bbHasHeal(sel) ? ` · рой +${sel.wpn.filter(bbIsHeal).reduce((a, g) => a + (+g.dmg || 0), 0)} до ${Math.max(...sel.wpn.filter(bbIsHeal).map(g => +g.rng || 0))}` : ''}</span>
    </div>` : '';

  const poolLeft = Array.isArray(s.pool) && s.pool.length && mv && !done;

  ov.innerHTML = `
    <div class="bbd bbf">
      <canvas id="bb-cv" class="bb-cv"></canvas>
      <button class="bbd-back" onclick="bbClose()" title="Выйти на сайт">←</button>
      ${hud}
      ${done ? `<div class="bbf-done ${s.winner === s.my_fid ? 'bbf-won' : (spec ? '' : 'bbf-lost')}">
          <b>${spec ? 'Победа: ' + esc((s.winner === s.attacker ? s.attacker_name : s.defender_name) || '?')
                    : (s.winner === s.my_fid ? 'Победа' : 'Поражение')}</b>
          <button class="bbd-fire" onclick="bbClose()">закрыть</button>
        </div>` : ''}
      ${bar}
      ${sheet}
      <div class="bbd-cmd">
        <button class="bbd-ic" onclick="bbSheet('log')" title="Журнал боя">▤</button>
        ${poolLeft ? `<button class="bbd-ic" onclick="bbSheet('reinf')" title="Подкрепление">⊕</button>` : ''}
        ${s.can_force ? `<button class="bbd-ic" onclick="bbForce()" title="Прожать просроченный ход">⏱</button>` : ''}
        ${wheelBtn}
        ${kitBtn}
        <button class="bbd-ic${BB.fog ? ' bbd-ic-on' : ''}" onclick="bbFogToggle()"
          title="Покрытие радаров: тьма — куда сенсоры не достают, штриховка — сектор под РЭБ. Слева легенда">📡</button>
        ${healBtn}
        ${bbOrbitBtns()}
        <button class="bbd-ic" onclick="bbZoomBtn(1/1.3)" title="Отдалить">−</button>
        <button class="bbd-ic" onclick="bbZoomBtn(1.3)" title="Приблизить">+</button>
        <button class="bbd-ic" onclick="bbCamHome()" title="К своим кораблям">⌂</button>
        ${!done && mv ? `<button class="bbd-fire" onclick="bbEndTurn()">завершить ход</button>`
                      : `<span class="bbf-wait">${done ? '' : bbDeadline(s)}</span>`}
      </div>
    </div>`;

  bbMount();
}

// ── Врезка доски в свежую разметку ──────────────────────────
// bbRender пересобирает ov.innerHTML на каждый чих (шторка, клик, новый
// снимок), и канвас каждый раз новый. Для 2D это даром, а для WebGL — потеря
// контекста и переподъём всей сцены. Поэтому 3D-канвас создаётся ОДИН раз и
// при пересборке ПЕРЕНОСИТСЯ в новый слой карты: перенос узла контекст не рвёт.
function bbMount() {
  BB.cv = document.getElementById('bb-cv');
  if (!BB.cv) return;
  BB.ctx = BB.cv.getContext('2d');
  if (BB.glCv && BB.glOn) {
    BB.cv.parentElement.insertBefore(BB.glCv, BB.cv.nextSibling);
    BB.cv.style.display = 'none';
  }
  bbCmdH();
  bbFit();
  bbBindCanvas();
  bbPaint();
  if (BB.glOn) { bbVeil(false); bgRefresh(); }
  else { bbVeil(BB.glWait); bbTry3D(); }
}

// ── Завеса на время сборки 3D ───────────────────────────────
// Плоская доска — аварийный запас, а не первый кадр. Раньше её показывали
// сразу: игрок видел пустое поле, ставил вслепую, а через секунду сцена
// подменялась под руками (и приходилось закрывать-открывать бой). Теперь до
// готовности 3D канвасы скрыты, а поверх лежит надпись о сборке. 2D при этом
// живёт под завесой в полную силу — если 3D не сложится, его просто открывают.
function bbVeil(on) {
  const host = BB.cv && BB.cv.parentElement; if (!host) return;
  let el = host.querySelector('.bb-veil');
  if (on) {
    if (BB.cv) BB.cv.style.visibility = 'hidden';
    if (!el) {
      el = document.createElement('div');
      el.className = 'bb-veil';
      el.innerHTML = `<span class="bb-veil-t">Собираем поле боя…</span>`;
      host.appendChild(el);
    }
    // Сторож: библиотека может не доехать вовсе (сеть, блокировщик). Держать
    // игрока перед завесой бесконечно нельзя — открываем плоскую доску.
    if (!BB.glTmo) BB.glTmo = setTimeout(() => {
      BB.glTmo = 0;
      if (!BB.glWait || BB.glOn) return;
      console.warn('[bb] 3D не собралась за 15 с — открываем плоскую доску');
      BB.glWait = false; BB.glOff = true;
      bbVeil(false);
    }, 15000);
  } else {
    if (BB.glTmo) { clearTimeout(BB.glTmo); BB.glTmo = 0; }
    if (el) el.remove();
    if (BB.cv) BB.cv.style.visibility = '';
  }
}

// Попытка поднять 3D. Асинхронная и необязательная: доска уже работает на 2D,
// а 3D включается, только если библиотека доехала и контекст создался. Любой
// сбой на этом пути значит ровно одно — игрок остаётся на 2D-доске.
function bbTry3D() {
  if (BB.glOff || BB.glOn || BB.glCv) return;
  if (typeof bgLoadThree !== 'function') return;
  const host = BB.cv && BB.cv.parentElement;
  if (!host) return;
  bgLoadThree().then(ok => {
    if (!ok) { BB.glOff = true; BB.glWait = false; bbVeil(false); return; }
    if (!BB.id || !BB.cv || !BB.cv.parentElement) { BB.glWait = false; return; }   // доску успели закрыть
    const cv = document.createElement('canvas');
    cv.className = 'bb-cv';
    BB.cv.parentElement.insertBefore(cv, BB.cv.nextSibling);
    if (!bgAttach(cv)) { cv.remove(); BB.glOff = true; BB.glWait = false; bbVeil(false); return; }
    // ПОКАЗЫВАЕМ 3D ТОЛЬКО СОБРАННУЮ. Раньше плоскую доску прятали сразу, до
    // первой синхронизации: если сцена не собиралась (сбой синхронизатора,
    // незнакомый класс корабля), игрок получал пустое поле со звёздами вместо
    // рабочей 2D-доски и «ничего не ставится». Теперь сначала собираем сцену
    // на скрытом канвасе, сверяем, что борта в ней есть, и лишь потом
    // переключаемся. Не сошлось — молча остаёмся на 2D.
    BB.glCv = cv; BB.glOn = true;
    cv.style.visibility = 'hidden';
    if (BB.deployUI) bgCamDeploy();
    bgRefresh();
    const want = ((BB.st && BB.st.units) || []).length;
    const built = (typeof BG !== 'undefined' && BG.units) ? BG.units.size : 0;
    const broke = (typeof BG !== 'undefined' && BG._failed && BG._failed.size) ? true : false;
    if (broke || built < want) {
      console.warn('[bb] 3D-сцена не собралась (борта ' + built + ' из ' + want + ') — остаёмся на 2D');
      cv.style.visibility = '';
      BB.glWait = false;
      bbFallback2D();
      return;
    }
    cv.style.visibility = '';
    BB.cv.style.display = 'none';
    BB.glWait = false;
    bbVeil(false);
    bbRender();          // кнопки камеры (вращение) есть только у 3D-доски
  });
}

// Возврат на 2D: контекст потерян или сцена сломалась. Разметку не трогаем —
// просто снимаем 3D-канвас и показываем обратно тот, что всё это время лежал
// под ним. Доска продолжает работать, игрок не остаётся без боя.
function bbFallback2D() {
  BB.glOn = false; BB.glOff = true; BB.glWait = false;
  bbVeil(false);
  if (typeof bgDispose === 'function') try { bgDispose(); } catch (e) {}
  if (BB.glCv) { BB.glCv.remove(); BB.glCv = null; }
  if (BB.cv) { BB.cv.style.display = ''; BB.camReady = false; bbFit(); bbPaint(); }
  if (typeof toast === 'function') toast('Трёхмерная доска недоступна — вернулись к плоской', 'err');
}

// Шторка: журнал / подкрепление / ТТХ / снаряжение выбранного борта.
function bbSheet(k) { BB.sheet = (BB.sheet === k ? null : k); bbRender(); }

// ════════════════════════════════════════════════════════════
// АКТИВНОЕ СНАРЯЖЕНИЕ — зеркало _bt_modules.sql
// Модулей у большого борта бывает много, поэтому это СПИСОК в шторке, а не
// сегменты колеса: в кольцо влезает пять штук, дальше оно нечитаемо.
// ════════════════════════════════════════════════════════════
var BBK = {
  siege:     { ico: '\u{1F3F9}', name: 'Осадная платформа',   need: null,   cost: 2.0 },
  salvo:     { ico: '\u{1F680}', name: 'Ракетный залп',        need: 'foe',  cost: 2.0 },
  broadside: { ico: '\u{1F4A5}', name: 'Бортовой залп',        need: 'foe',  cost: 2.5 },
  blink:     { ico: '\u{2728}',  name: 'Прыжок',               need: 'hex',  cost: 0.0 },
  cloak:     { ico: '\u{1F32B}', name: 'Маскировка',           need: null,   cost: 1.0 },
  amp:       { ico: '\u{26A1}',  name: 'Усилитель контура',    need: null,   cost: 1.0 },
  drones:    { ico: '\u{1F41D}', name: 'Ремонтные дроны',      need: 'ally', cost: 1.5 },
  // ── пакет 2 ──
  torpedo:   { ico: '\u{1F4A3}', name: 'Торпеда «Голиаф»',     need: 'foe',  cost: 2.5 },
  storm:     { ico: '\u{1F327}', name: 'Ракеты «Шквал»',       need: 'foe',  cost: 2.0 },
  ram:       { ico: '\u{1F411}', name: 'Плазменный таран',     need: 'foe',  cost: 2.0 },
  rupture:   { ico: '\u{1F5E1}', name: 'Разрывной таран',      need: 'foe',  cost: 2.0 },
  drain:     { ico: '\u{1FAAB}', name: 'Торпеда-иссушитель',   need: 'foe',  cost: 1.5 },
  wbreak:    { ico: '\u{1F528}', name: 'Ракета «Ломовик»',     need: 'foe',  cost: 1.5 },
  disrupt:   { ico: '\u{1F6AB}', name: 'Ракета-подавитель',    need: 'foe',  cost: 1.5 },
  wboost:    { ico: '\u{1F53A}', name: 'Ракета-усилитель',     need: 'ally', cost: 1.0 },
  pboost:    { ico: '\u{1F4E3}', name: 'Импульс «Хорал»',      need: null,   cost: 1.5 },
  hell:      { ico: '\u{1F525}', name: 'Адские лазеры',        need: null,   cost: 2.0 },
  blind:     { ico: '\u{1F4FA}', name: 'Скремблер-импульс',    need: null,   cost: 1.0 },
  pdup:      { ico: '\u{2602}',  name: 'Противоракетные лазеры', need: null, cost: 1.0 },
  stasis:    { ico: '\u{1F9CA}', name: 'Стазис-лучи',          need: null,   cost: 1.5 },
  aboost:    { ico: '\u{1F6E1}', name: 'Импульс брони',        need: null,   cost: 1.5 },
  tractor:   { ico: '\u{1F9F2}', name: 'Тяговый луч',          need: 'foe',  cost: 1.5 },
  nuke:      { ico: '\u{2622}',  name: 'Ядерная ракета',       need: 'foe',  cost: 3.0 },
  tartarus:  { ico: '\u{1F573}', name: 'Ракета «Тартар»',      need: 'foe',  cost: 2.0 },
  sammo:     { ico: '\u{1F9CA}', name: 'Стазис-боеприпас',     need: null,   cost: 1.0 },
  hard:      { ico: '\u{1F512}', name: 'Броневой замок',       need: null,   cost: 1.0 },
  reboot:    { ico: '\u{1F504}', name: 'Перезапуск снаряжения', need: null,  cost: 1.0 },
  rapid:     { ico: '\u{1F3AF}', name: 'Беглый огонь',         need: null,   cost: 1.0 },
  energy:    { ico: '\u{1F50B}', name: 'Энергогенератор',      need: null,   cost: 0.0 },
};
// Дебаффы, которые могут висеть на борту. Зеркало _bt_deb_ru.
var BBK_DEB = {
  stasis:  'вязкое поле — шаг вдвое дороже',
  disrupt: 'шина заглушена — модули не работают',
  wbreak:  'наведение сбито — урон вполовину',
  soft:    'обшивка вспорота — входящий урон выше',
};
function bbKitDesc(a) {
  const d = +a.dmg || 0, r = +a.rng || 0, v = +a.val || 0;
  switch (a.k) {
    case 'siege':     return `урон ×${BBW_SIEGE_DMG}, рубеж ×${BBW_SIEGE_RNG} — но с места ни шагу`;
    case 'salvo':     return `${bbNum(d)} урона по цели до ${r} гекс. · ракеты, ПРО режет`;
    case 'broadside': return `${bbNum(d)} по цели и половина по соседям, до ${r} гекс.`;
    case 'blink':     return `прыжок до ${r} гекс. в пустой гекс, секунд не тратит`;
    case 'cloak':     return `+${v} к скрытности до своего следующего хода`;
    case 'amp':       return `+${Math.round(v * 100)}% урона всем залпам до конца хода`;
    case 'drones':    return `+${bbNum(v)} корпуса союзнику до ${r} гекс.`;
    case 'torpedo':   return `${bbNum(d)} по цели и половина по всем рядом, до ${r} гекс. — задевает своих`;
    case 'storm':     return `${bbNum(d)} по цели до ${r} гекс. · в упор работает, мёртвой зоны нет`;
    case 'ram':       return `${bbNum(d)} вплотную, СКВОЗЬ щит`;
    case 'rupture':   return `${bbNum(d)} вплотную сквозь щит + вспарывает броню на ход`;
    case 'drain':     return `−${v} c из следующего пула цели, до ${r} гекс.`;
    case 'wbreak':    return `цель бьёт вполовину слабее весь свой ход, до ${r} гекс.`;
    case 'disrupt':   return `цель не может жать модули весь свой ход, до ${r} гекс.`;
    case 'wboost':    return `союзнику +${Math.round(v * 100)}% урона, до ${r} гекс.`;
    case 'pboost':    return `+${Math.round(v * 100)}% урона себе и своим в радиусе ${r}`;
    case 'hell':      return `${bbNum(d)} КАЖДОМУ врагу в радиусе ${r}`;
    case 'blind':     return `−${v} к сенсорам всем врагам в радиусе ${r}`;
    case 'pdup':      return `+${Math.round(v * 100)}% к перехвату ракет себе и своим в радиусе ${r}`;
    case 'stasis':    return `врагам в радиусе ${r} следующий ход вдвое дороже`;
    case 'aboost':    return `−${Math.round(v * 100)}% входящего урона себе и своим в радиусе ${r}`;
    case 'tractor':   return `подтягивает вражеский борт на ${v} гекс. к себе, до ${r} гекс.`;
    case 'nuke':      return `${bbNum(d)} по цели и 60% по всем рядом, до ${r} гекс.`;
    case 'tartarus':  return `стазис + высаженный пул + глухая шина разом, до ${r} гекс.`;
    case 'sammo':     return 'до конца хода ваши залпы сажают цель в стазис';
    case 'hard':      return `−${Math.round(v * 100)}% входящего урона до своего следующего хода`;
    case 'reboot':    return `−${v} ход(а) со ВСЕХ остальных кулдаунов`;
    case 'rapid':     return 'залп стоит вдвое меньше секунд до конца хода';
    case 'energy':    return `+${v} c к текущему ходу`;
    default:          return '';
  }
}
// Что сейчас висит на борту чужими стараниями. Без этой строки игрок не поймёт,
// почему его залп бьёт вполсилы, а шаг стоит вдвое.
function bbDebLine(u) {
  const d = u && u.deb;
  if (!d) return '';
  const ks = Object.keys(d).filter(k => +d[k] > 0);
  if (!ks.length) return '';
  return `<div class="bb-deb">⚠ ${ks.map(k => esc(BBK_DEB[k] || k)).join(' · ')}</div>`;
}
// Сколько ходов ещё ждать (0 — готово).
function bbKitCd(u, k) { return Math.max(0, +((u.mcd || {})[k]) || 0); }

function bbKitPanel(s, u) {
  const acts = Array.isArray(u.acts) ? u.acts : [];
  if (!acts.length) {
    return '<div class="bb-empty">На этом борту нет активного снаряжения. Оно ставится в конструкторе — модули с кнопкой: осадная платформа, ракетный блок, прыжковый ускоритель, маскировка, усилитель контура, ремонтные дроны.</div>';
  }
  const canAct = u.acted || (s.acts_left > 0);
  const jam = u.deb && +u.deb.disrupt > 0;      // подавитель глушит всю панель
  return bbDebLine(u) + acts.map(a => {
    const meta = BBK[a.k] || { ico: '\u{2699}', name: a.k, cost: 1 };
    const cd = bbKitCd(u, a.k);
    const cost = meta.cost;
    // Осада — единственное, что переключается туда-обратно: разложенной
    // платформе кнопка меняет смысл на «свернуть».
    const isSiegeOff = a.k === 'siege' && u.stance === 'siege';
    const busyStance = a.k === 'siege' && !isSiegeOff && u.stance !== 'off';
    let why = '';
    if (!s.my_turn) why = 'Сейчас ход противника.';
    else if (jam) why = 'Шина снаряжения заглушена подавителем — в этом ходу модули не работают.';
    else if (cd > 0) why = `Перезарядка: ещё ${cd} ход(ов).`;
    else if (!canAct) why = `Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей.`;
    else if (+u.tp + 1e-9 < cost) why = `Нужно ${cost.toFixed(1)} c, осталось ${(+u.tp).toFixed(1)} c.`;
    else if (busyStance) why = 'Мощность уже направлена в этом ходу.';
    const ok = !why;
    const lbl = isSiegeOff ? 'Свернуть' : (meta.need ? 'Навести' : 'Включить');
    const arm = BB.mod === a.k;
    return `<div class="bb-kit${ok ? '' : ' bb-kit-off'}${arm ? ' bb-kit-arm' : ''}">
        <div class="bb-kit-h"><span class="bb-kit-i">${meta.ico}</span>
          <b>${esc(meta.name)}</b>
          <span class="bb-kit-c">${cd > 0 ? `⟳ ${cd}` : (cost > 0 ? `${cost.toFixed(1)} c` : 'без секунд')}</span></div>
        <div class="bb-kit-d">${esc(bbKitDesc(a))}</div>
        ${why ? `<div class="bb-kit-w">${esc(why)}</div>` : ''}
        <button class="btn btn-sm${arm ? ' btn-gd' : ''}" ${ok ? '' : 'disabled'}
          onclick="bbKitUse('${jsq(a.k)}')">${arm ? 'Отмена — кликните ещё раз' : esc(lbl)}</button>
      </div>`;
  }).join('');
}

// Нажатие модуля. Что можно решить сразу — шлём сразу; чему нужна цель —
// взводим режим наведения и ждём клика по доске (как у нано-роя).
function bbKitUse(key) {
  const s = BB.st, u = (s.units || []).find(x => x.id === BB.sel);
  if (!u) return;
  if (BB.mod === key) { BB.mod = null; bbRender(); return; }   // повторный тап = отмена
  if (key === 'siege') {
    BB.mod = null;
    bbAct('battle_stance', { p_battle: BB.id, p_unit: u.id,
                             p_mode: u.stance === 'siege' ? 'off' : 'siege' });
    return;
  }
  const meta = BBK[key] || {};
  if (!meta.need) {
    BB.mod = null;
    bbAct('battle_module', { p_battle: BB.id, p_unit: u.id, p_key: key });
    return;
  }
  BB.mod = key;                       // ждём клик по доске
  BB.heal = false;
  BB.sheet = null;                    // шторка закрывается, иначе доски не видно
  toast(meta.need === 'hex' ? 'Кликните по пустому гексу — туда уйдёт прыжок'
      : meta.need === 'ally' ? 'Кликните по союзному борту'
      : 'Кликните по вражескому борту', 'ok');
  bbRender();
}

// ════════════════════════════════════════════════════════════
// ФАЗА РАССТАНОВКИ — отдельный экран (в т.ч. телефон)
// Три яруса: счётчики лимитов сверху (борта / бюджет — крупно, с полосами),
// доска-«стапель» в середине (камера сама наведена на СВОЮ зону спавна),
// ростер-док снизу: карточки под палец со степперами ＋/− и авто-посадкой.
// Гексы кликом тоже работают: выбран борт → тап по подсвеченной зоне.
// ════════════════════════════════════════════════════════════

// Русское склонение по числу: 1 борт, 2 борта, 5 бортов.
function bbPlural(n, one, few, many) {
  n = Math.abs(Math.round(n)) % 100;
  if (n > 10 && n < 20) return many;
  const d = n % 10;
  return d === 1 ? one : (d >= 2 && d <= 4 ? few : many);
}
// Сводка лимитов расстановки: сколько бортов и денег уже потрачено.
function bbDeployLim(s) {
  // s.cap — лимит бортов на доску от сервера (_bt_cap). Если сервер его не
  // прислал, НЕ запираем расстановку нулём: иначе экран мёртвый, ни один
  // корабль не поставить и причина игроку не видна.
  const cap = Number(s.cap) > 0 ? Math.floor(Number(s.cap)) : 12;
  // Уже подтверждённые борта тоже занимают места: после «в бой» BB.place
  // очищается, и без этого слагаемого счётчик врал «0/6, ещё 6 мест», пока
  // игрок ждёт врага.
  const fixed = (s.units || []).filter(u => u.mine).length;
  const used = fixed + BB.place.length;
  const budget = Number(s.duel_budget) || 0;
  const spent = bbDuelSpent(s);
  return { cap, used, slots: Math.max(0, cap - used), budget, spent,
           over: budget > 0 && spent > budget, left: budget > 0 ? budget - spent : 0 };
}
// Свободные гексы своей зоны в порядке «от своего края, от центра к краям»:
// авто-посадка выстраивает флот аккуратной стенкой, а не как попало.
function bbZoneCells(s) {
  const busy = new Set([].concat(
    (s.units || []).map(u => u.x + ':' + u.y),
    BB.place.map(p => p.x + ':' + p.y)));
  const free = (x, y) => !busy.has(x + ':' + y) && bbTerra(x, y) !== 'ast';   // в камнях борт не ставим
  const a = bbMySpawn();

  if (a) {
    // сектор подхода: от якоря наружу — флот собирается плотным кулаком
    const out = [];
    for (let x = Math.max(0, a.x - a.r); x <= Math.min(s.w - 1, a.x + a.r); x++) {
      for (let y = Math.max(0, a.y - a.r - 1); y <= Math.min(s.h - 1, a.y + a.r + 1); y++) {
        if (!bbInMyZone(x, y) || !free(x, y)) continue;
        out.push({ x, y, d: bbDist({ x, y }, { x: a.x, y: a.y }) });
      }
    }
    out.sort((p, q) => p.d - q.d || p.x - q.x || p.y - q.y);
    return out.map(p => ({ x: p.x, y: p.y }));
  }

  // легаси-бой без секторов: прежние колонки у своего края
  const z = s.zone || 3;
  const cols = [];
  for (let i = 0; i < z; i++) cols.push(s.my_side === 'attacker' ? i : s.w - 1 - i);
  const mid = (s.h - 1) / 2;
  const rows = [];
  for (let y = 0; y < s.h; y++) rows.push(y);
  rows.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
  const out = [];
  cols.forEach(x => rows.forEach(y => { if (free(x, y)) out.push({ x, y }); }));
  return out;
}
// Можно ли добавить ещё один борт этого проекта: место, резерв, бюджет.
function bbCanAdd(s, p) {
  // состав уже утверждён — трогать нечего
  if (s.my_side === 'attacker' ? s.att_ready : s.def_ready) return 'Состав утверждён — расстановку не изменить';
  const L = bbDeployLim(s);
  const used = BB.place.filter(q => q.unit_id === p.unit_id).length;
  if (used >= (p.free || 0)) return 'В резерве больше таких кораблей нет';
  if (L.slots <= 0) return `На доску больше ${L.cap} кораблей не вывести`;
  if (L.budget > 0 && L.spent + (Number(p.cost) || 0) > L.budget)
    return `Не хватает бюджета: борт стоит ${bbNum(p.cost)} ГС, осталось ${bbNum(L.left)} ГС`;
  return null;
}
// ＋ на карточке: посадить борт на ближайшее свободное место своей зоны.
function bbAddOne(uid) {
  const s = BB.st; if (!s) return;
  const p = (s.pool || []).find(q => q.unit_id === uid); if (!p) return;
  const why = bbCanAdd(s, p);
  if (why) { toast(why, 'err'); return; }
  const cell = bbZoneCells(s)[0];
  if (!cell) { toast('В зоне разворачивания не осталось свободных гексов', 'err'); return; }
  BB.place.push({ unit_id: p.unit_id, unit_name: p.unit_name, cls: p.cls, x: cell.x, y: cell.y });
  BB.pick = uid;
  bbRender();
}
// − на карточке: снять последний выставленный борт этого проекта.
function bbDelOne(uid) {
  for (let i = BB.place.length - 1; i >= 0; i--) {
    if (BB.place[i].unit_id === uid) { BB.place.splice(i, 1); bbRender(); return; }
  }
}
// Авто-состав: набить доску по порядку резерва, пока хватает мест и денег.
function bbAutoPlace() {
  const s = BB.st; if (!s) return;
  const pool = Array.isArray(s.pool) ? s.pool : [];
  let added = 0, guard = 0;
  for (;;) {
    if (guard++ > 400) break;
    const p = pool.find(q => !bbCanAdd(s, q));
    if (!p) break;
    const cell = bbZoneCells(s)[0];
    if (!cell) break;
    BB.place.push({ unit_id: p.unit_id, unit_name: p.unit_name, cls: p.cls, x: cell.x, y: cell.y });
    added++;
  }
  if (!added) toast('Добавить больше нечего: упёрлись в резерв, места или бюджет', 'err');
  bbRender();
}
function bbClearPlace() {
  if (!BB.place.length) return;
  BB.place = []; BB.pick = null; bbRender();
}
// ── ЛЕНТА БОРТОВ: ЛИСТАНИЕ ──────────────────────────────────
// Полоса прокрутки у ленты скрыта (на телефоне она уродует док), и на
// мыши листать было НЕЧЕМ: колесо крутит по вертикали, а лента едет по
// горизонтали. Отсюда стрелки ‹ › по краям и колесо, переложенное в
// горизонтальный скролл. Пальцем лента как листалась, так и листается.
function bbTrayScroll(dir) {
  const el = document.getElementById('bbd-tray'); if (!el) return;
  // шаг = видимая ширина без одной карточки, чтобы край оставался виден
  const step = Math.max(160, el.clientWidth - 184);
  el.scrollBy({ left: dir * step, behavior: 'smooth' });
}
// Колесо над лентой листает её, а не проваливается в доску под ней.
function bbBindTray() {
  const el = document.getElementById('bbd-tray'); if (!el) return;
  el.onscroll = () => { BB.traySL = el.scrollLeft; };
  el.onwheel = ev => {
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    if (!d) return;
    el.scrollLeft += d;
    ev.preventDefault(); ev.stopPropagation();
  };
}

// ── Поиск по резерву ────────────────────────────────────────
// В бою с ботами резерв = ВЕСЬ опубликованный парк (под сотню бортов), и
// пролистать его лентой нереально. Ищем по имени, классу и снаряжению:
// «ноксий», «крейсер», «торпеда» — всё это одна и та же строка поиска.
function bbPoolHay(p) {
  const acts = Array.isArray(p.acts) ? p.acts : [];
  return [p.unit_name, bbClsName(p.cls), p.cls,
          ...acts.map(a => (BBK[a.k] || {}).name || a.k)]
    .join(' ').toLowerCase();
}
function bbPoolList(s) {
  const pool = Array.isArray(s.pool) ? s.pool : [];
  const q = (BB.q || '').trim().toLowerCase();
  if (!q) return pool;
  return pool.filter(p => bbPoolHay(p).includes(q));
}
// Ввод в строку поиска. Перерисовываем ТОЛЬКО ленту: полная пересборка
// разметки убила бы фокус и каретку на первом же символе.
function bbFind(v) {
  BB.q = v || '';
  BB.traySL = 0;
  const tray = document.getElementById('bbd-tray');
  if (tray) { tray.innerHTML = bbTrayChips(BB.st); tray.scrollLeft = 0; }
  const nfo = document.getElementById('bbd-find-n');
  if (nfo) nfo.textContent = bbFindNote(BB.st);
  const wrap = document.getElementById('bbd-find');
  if (wrap) wrap.classList.toggle('bbd-find-on', !!BB.q.trim());
}
function bbFindClear() {
  const inp = document.getElementById('bbd-find-i');
  if (inp) { inp.value = ''; inp.focus(); }
  bbFind('');
}
function bbFindNote(s) {
  const all = (Array.isArray(s && s.pool) ? s.pool : []).length;
  const n = bbPoolList(s || {}).length;
  return (BB.q || '').trim() ? `${n} из ${all}` : String(all);
}

// Карточки ленты. Вынесены из bbRenderDeploy отдельно: поиск перерисовывает
// только их, не трогая строку ввода (иначе фокус слетает на каждом символе).
// Перетаскивания на гекс НЕТ: гексы мелкие, а «тяни пальцем» вдобавок убивало
// скролл самой ленты. ＋ сажает борт сам, − снимает, тап по карточке выбирает
// борт для ручной посадки тапом по гексу.
function bbTrayChips(s) {
  if (!s) return '';
  const cnt = {};
  BB.place.forEach(p => { cnt[p.unit_id] = (cnt[p.unit_id] || 0) + 1; });
  const list = bbPoolList(s);
  if (!list.length) {
    return `<div class="bbd-none">${(BB.q || '').trim()
      ? `По запросу «${esc(BB.q.trim())}» бортов нет` : 'Резерв пуст'}</div>`;
  }
  return list.map(p => {
    const n = cnt[p.unit_id] || 0;
    const free = Math.max(0, Number(p.free) || 0);
    const why = bbCanAdd(s, p);
    const on = BB.pick === p.unit_id;
    const acts = Array.isArray(p.acts) ? p.acts : [];
    return `<div class="bbd-s${on ? ' bbd-s-on' : ''}${why ? ' bbd-s-off' : ''}"
        onclick="bbPick('${jsq(p.unit_id)}')">
        <span class="bbd-s-n">${esc(p.unit_name)}</span>
        <span class="bbd-s-i">${bbNum(p.hp)} корп · ${bbNum(p.dmg)} урон · ${p.rng} гекс${Number(p.cost) > 0 ? ` · ${bbNum(p.cost)}` : ''}</span>
        <span class="bbd-s-w">${acts.length
          ? `🧰 ${acts.map(a => (BBK[a.k] || {}).name || a.k).join(' · ')}`
          : (why ? esc(why) : `в резерве ${free - n} из ${free}`)}</span>
        <span class="bbd-s-q">${n}/${free}</span>
        <span class="bbd-s-btn">
          <button class="bbd-s-a bbd-s-spec" title="Полные ТТХ"
            onclick="event.stopPropagation();bbSpec('${jsq(p.unit_id)}')">ⓘ</button>
          <button class="bbd-s-a" ${n ? '' : 'disabled'} title="Снять борт"
            onclick="event.stopPropagation();bbDelOne('${jsq(p.unit_id)}')">−</button>
          <button class="bbd-s-a" ${why ? 'disabled' : ''} title="${why ? esc(why) : 'Поставить борт'}"
            onclick="event.stopPropagation();bbAddOne('${jsq(p.unit_id)}')">+</button>
        </span>
      </div>`;
  }).join('');
}

function bbRenderDeploy(s) {
  const ov = document.getElementById('bb-ov'); if (!ov) return;
  BB.deployUI = true;
  const mine = s.my_side === 'attacker' ? s.att_ready : s.def_ready;
  const foe  = s.my_side === 'attacker' ? s.def_ready : s.att_ready;
  const L = bbDeployLim(s);
  const pool = Array.isArray(s.pool) ? s.pool : [];

  ov.innerHTML = `
    <div class="bbd">
      <canvas id="bb-cv" class="bb-cv"></canvas>

      <button class="bbd-back" onclick="bbClose()" title="Выйти на сайт">←</button>

      <div class="bbd-hud${L.over ? ' bbd-hud-over' : ''}">
        <span class="bbd-hud-r">
          <span class="bbd-hud-n"><b>${L.used}</b>/${L.cap}</span>
          <span class="bbd-hud-l">${L.slots > 0
            ? `бортов · ещё ${L.slots}`
            : 'бортов · предел'}</span>
        </span>
        ${L.budget > 0 ? `<span class="bbd-hud-r">
          <span class="bbd-hud-n"><b>${bbNum(L.spent)}</b>/${bbNum(L.budget)}</span>
          <span class="bbd-hud-l">${L.over ? 'ГС · перебор' : `ГС · ост. ${bbNum(L.left)}`}</span>
        </span>` : ''}
        <span class="bbd-hud-foe">${foe ? '● враг готов' : '○ враг ставит'}</span>
      </div>

      ${bbSpecSheet(s)}

      <div class="bbd-tray-wrap">
        ${pool.length > 6 ? `<div class="bbd-find${(BB.q || '').trim() ? ' bbd-find-on' : ''}" id="bbd-find">
          <span class="bbd-find-ic">🔍</span>
          <input id="bbd-find-i" class="bbd-find-i" type="search" inputmode="search"
            autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="Поиск борта: имя, класс, снаряжение"
            value="${esc(BB.q || '')}" oninput="bbFind(this.value)">
          <button class="bbd-find-x" onclick="bbFindClear()" title="Очистить">✕</button>
          <span class="bbd-find-n" id="bbd-find-n">${bbFindNote(s)}</span>
        </div>` : ''}
        <div class="bbd-tray-row">
          <button class="bbd-tray-nav bbd-tray-l" onclick="bbTrayScroll(-1)" title="Предыдущие борта">‹</button>
          <div class="bbd-tray" id="bbd-tray">${bbTrayChips(s)}</div>
          <button class="bbd-tray-nav bbd-tray-r" onclick="bbTrayScroll(1)" title="Следующие борта">›</button>
        </div>
      </div>

      <div class="bbd-cmd">
        <button class="bbd-ic" ${mine ? 'disabled' : ''} onclick="bbAutoPlace()" title="Расставить автоматически">⚡</button>
        <button class="bbd-ic" ${mine || !BB.place.length ? 'disabled' : ''} onclick="bbClearPlace()" title="Снять всех">✕</button>
        ${bbOrbitBtns()}
        <button class="bbd-ic" onclick="bbZoomBtn(1/1.3)" title="Отдалить">−</button>
        <button class="bbd-ic" onclick="bbZoomBtn(1.3)" title="Приблизить">+</button>
        <button class="bbd-ic" onclick="bbCamDeploy(1)" title="К своей зоне">⌂</button>
        <button class="bbd-fire" ${mine || !BB.place.length || L.over ? 'disabled' : ''} onclick="bbConfirmDeploy()">
          ${mine ? 'ждём врага' : (L.over ? 'перебор' : 'в бой')}
        </button>
      </div>
    </div>`;

  // Лента пересобирается целиком на каждый рендер (а рендер идёт на каждый
  // тап по карточке), и браузер честно отматывает свежий контейнер в ноль —
  // выбрал борт в конце списка, а лента прыгнула в начало. Держим позицию
  // сами и возвращаем её сразу после вставки, до первой отрисовки кадра.
  const tray = document.getElementById('bbd-tray');
  if (tray && BB.traySL) tray.scrollLeft = BB.traySL;

  bbMount();
  bbBindTray();
}

// Занят ли гекс (кроме перетаскиваемого борта с индексом skip).
function bbCellBusy(x, y, skip) {
  const s = BB.st;
  if ((s.units || []).some(u => u.x === x && u.y === y)) return true;
  return BB.place.some((p, i) => i !== skip && p.x === x && p.y === y);
}

// Камера расстановки: показать СВОЙ сектор подхода целиком.
// Сектор теперь может оказаться где угодно на кромке арены, поэтому камера
// целится в его якорь, а не в левый/правый торец доски.
function bbCamDeploy(force) {
  const s = BB.st; if (!s || !BB.vw) return;
  const { W, H } = bbWorldSize();
  const a = bbMySpawn();
  let cx, cy, span;
  if (a) {
    const c = bbHexCenter(a.x, a.y);
    span = (a.r + 2.5) * BB.R * 2 * 1.5;         // диаметр сектора с полями
    cx = c.px; cy = c.py;
  } else {
    const z = s.zone || 3;
    span = (z + 2.5) * BB.R * 1.5;
    cx = s.my_side === 'attacker' ? span / 2 : W - span / 2;
    cy = H / 2;
  }
  BB.zoom = Math.min(1.5, Math.max(0.28, Math.min(BB.vh / span, BB.vw / span)));
  BB.camX = cx - BB.vw / BB.zoom / 2;
  BB.camY = cy - BB.vh / BB.zoom / 2;
  bbCamClamp();
  if (BB.glOn) { bgCamDeploy(); return; }
  if (force && BB.ctx) bbPaint();
}

function bbDeadline(s) {
  if (!s.deadline_at) return '';
  const ms = new Date(s.deadline_at) - new Date();
  if (ms <= 0) return 'Срок хода вышел.';
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
  return `Срок хода: ${h ? h + ' ч ' : ''}${m} мин.`;
}

// ── ПОЛНЫЕ ТТХ БОРТА ИЗ РЕЗЕРВА (шторка расстановки) ────────
// В карточке ленты помещается три числа, а решать, кого ставить, приходится
// по всему паспорту: щит, броня, сенсор, скрытность, РЭБ и — главное —
// раскладка огневых групп (чем бьёт, сколько стволов, на какую дальность).
// Раньше это было видно только когда корабль уже стоит на доске: на телефоне
// игрок ставил вслепую. Кнопка «ⓘ» на карточке открывает тот же список
// строк, что и панель корабля в бою.
function bbSpec(uid) { BB.spec = (BB.spec === uid ? null : uid); bbRender(); }

function bbSpecSheet(s) {
  const p = (Array.isArray(s.pool) ? s.pool : []).find(x => x.unit_id === BB.spec);
  if (!p) return '';
  const row = (k, v) => `<div class="bb-stat"><span>${k}</span><b>${v}</b></div>`;
  const out = [];
  out.push(row('Класс', esc(bbClsName(p.cls))));
  out.push(row('Корпус', bbNum(p.hp)));
  if (+p.shield > 0) out.push(row('Щит', bbNum(p.shield)));
  out.push(row('Броня', bbNum(p.armor)));
  out.push(row('Ход', `${p.speed} гекс.`));
  out.push(row('Сенсор / скрытность', `${bbNum(p.sensor)} / ${bbNum(p.stealth)}`));
  if (+p.pd > 0)    out.push(row('ПРО', `сбивает ${Math.round(p.pd * 100)}% ракет`));
  if (+p.jam > 0)   out.push(row('РЭБ', `−${p.jam} к сенсорам врага (радиус 5)`));
  if (+p.dejam > 0) out.push(row('Контр-РЭБ', `снимает до ${p.dejam} помех со своих`));
  if (+p.eccm > 0)  out.push(row('Помехозащищённость', `−${p.eccm} к вражескому глушению`));
  if (+p.wings > 0) out.push(row('Авиакрылья в ангарах', bbNum(p.wings)));
  if (+p.crew > 0)  out.push(row('Экипаж', bbNum(p.crew)));
  if (+p.cargo > 0) out.push(row('Грузоподъёмность', bbNum(p.cargo)));
  if (p.interdict)  out.push(row('Интердикция', 'враг не вызывает подкрепления'));
  if (p.stabil)     out.push(row('Стабилизация', 'интердикция врага не действует'));
  if (p.ftl)        out.push(row('FTL-гипердвигатель', 'прыжок сквозь интердикцию'));
  if (+p.cost > 0)  out.push(row('Цена в бюджете дуэли', `${bbNum(p.cost)} ГС`));
  // Огневые группы. Если сервер их не прислал (старая battle_pool до
  // _battle_pool_wpn.sql), показываем хотя бы сводный урон — пусто быть не должно.
  const wpn = Array.isArray(p.wpn) && p.wpn.length ? p.wpn : [{ rng: p.rng, dmg: p.dmg }];
  const guns = wpn.slice().sort((a, b) => (b.rng || 0) - (a.rng || 0))
    .map(g => row(`${bbGroupLabel(g)}${g.shots > 1 && !bbIsHeal(g) ? ` · залп ×${g.shots}` : ''}`,
                  `${bbIsHeal(g) ? `+${g.dmg} HP союзнику` : g.dmg} · до ${g.rng} гекс.${bbGrpBandTxt(g)}`)).join('');

  // Во весь экран, а не полоской над лентой: на телефоне ленте бортов и панели
  // команд остаётся ~160 px, паспорт корабля в них не влезает и упирается в
  // собственный скролл. Закрывается ✕ — доска под ней никуда не девается.
  // Активное снаряжение — то же, что покажет 🧰 в бою. Без него на экране
  // расстановки нельзя было отличить корвет с ядерной ракетой от пустого.
  const acts = Array.isArray(p.acts) ? p.acts : [];
  const kit = acts.map(a => row(
    `${(BBK[a.k] || {}).ico || '🧰'} ${(BBK[a.k] || {}).name || a.k}`,
    `${bbKitDesc(a)} · перезарядка ${+a.cd || 0} ход.`)).join('');

  return `<div class="bbf-sheet bbf-spec"><div class="bbf-sheet-h">
      <span class="bbf-sheet-n">${esc(p.unit_name)}</span>
      <button onclick="bbSpec(null)">✕</button></div>
    <div class="bbf-sheet-b"><div class="bb-panel">
      ${out.join('')}
      <div class="bb-panel-t" style="margin-top:10px">Огневые группы</div>
      ${guns}
      ${kit ? `<div class="bb-panel-t" style="margin-top:10px">Активное снаряжение</div>${kit}` : ''}
    </div></div></div>`;
}

// Компактное число для карточек резерва
function bbNum(v) { v = +v || 0; return v >= 1000 ? Math.round(v).toLocaleString('ru') : String(Math.round(v)); }
// Сумма стоимости выставленных бортов (для бюджета драфта дуэли).
// Цена берётся из карточки пула по unit_id.
function bbDuelSpent(s) {
  const cost = {};
  (Array.isArray(s.pool) ? s.pool : []).forEach(p => { cost[p.unit_id] = Number(p.cost) || 0; });
  // Как и по местам: уже утверждённые борта продолжают тратить бюджет.
  const fixed = (s.units || []).filter(u => u.mine)
    .reduce((sum, u) => sum + (cost[u.unit_id] || 0), 0);
  return fixed + BB.place.reduce((sum, p) => sum + (cost[p.unit_id] || 0), 0);
}
// Развёрнутые ТТХ корабля из резерва/подкрепления (класс, корпус, урон, ход,
// дальность + важные детали: щит/броня, грузоподъёмность, экипаж, боевые модули).
function bbPoolDetail(p) {
  const bits = [bbClsName(p.cls), `${bbNum(p.hp)} HP`, `${bbNum(p.dmg)} урон`, `ход ${p.speed}`, `бьёт до ${p.rng}`];
  if (+p.shield > 0) bits.push(`щит ${bbNum(p.shield)}`);
  if (+p.armor > 0) bits.push(`броня ${bbNum(p.armor)}`);
  if (+p.cargo > 0) bits.push(`грузоподъёмность ${bbNum(p.cargo)}`);
  if (+p.crew > 0) bits.push(`экипаж ${bbNum(p.crew)}`);
  if (+p.pd > 0) bits.push(`ПРО ${Math.round(p.pd * 100)}%`);
  if (+p.jam > 0) bits.push(`РЭБ −${p.jam}`);
  if (+p.dejam > 0) bits.push(`контр-РЭБ ${p.dejam}`);
  if (+p.wings > 0) bits.push(`авиакрыльев ${p.wings}`);
  if (p.interdict) bits.push('⛔ интердикция');
  if (p.stabil) bits.push('⚓ стабилизатор');
  if (p.ftl) bits.push('⇢ FTL-прыжок');
  return bits.join(' · ');
}

function bbPick(uid) { BB.pick = (BB.pick === uid ? null : uid); bbRender(); }

// ── Панель выбранного корабля / резерва в бою ───────────────
const BB_KIND = { kinetic: 'кинетик', energy: 'лазер', missile: 'ракеты', repair: 'ремонтный рой' };
// Ремонтная группа (нанотехнологии): бьёт не по врагу, а латает СОЮЗНЫЙ корабль.
function bbIsHeal(g) { return g && g.k === 'repair'; }
function bbKindLabel(k) { return BB_KIND[k] || k; }
// Имя огневой группы: ручная батарея игрока — буквой, авто — по каналу.
// Тир залпа (shots) идёт отдельной пометкой: 1 = один тяжёлый удар, 6 = рой.
function bbGroupLabel(g) {
  const kind = g.k ? bbKindLabel(g.k) : 'орудия';
  return g.bat ? `Группа ${esc(g.bat)} · ${kind}` : kind.charAt(0).toUpperCase() + kind.slice(1);
}
// Модель урона группы по дистанции — словами. Плоский профиль (арта, ракеты)
// молчит: писать «спада нет» значит засорять паспорт строкой ни о чём.
function bbGrpBandTxt(g) {
  if (bbIsHeal(g)) return '';
  const rng = Math.max(1, +g.rng || 1);
  const opt = Math.max(1, Math.floor(rng * (g.opt != null ? +g.opt
              : (BBW_OPT[g.k] != null ? BBW_OPT[g.k] : 1))));
  const far = g.far != null ? +g.far : (BBW_FAR[g.k] != null ? BBW_FAR[g.k] : 1);
  const dmin = bbGrpDmin(g);
  let s = '';
  if (dmin > 1) s += ` · не бьёт ближе ${dmin}`;
  if (opt < rng) s += ` · полный урон до ${opt}, к краю ${Math.round(far * 100)}%`;
  return s;
}
// Тестовый бой против ботов: у врага синтетический fid 'bot' (см. admin_bot_battle)
function bbAdminBot(s) { return !!s && (s.defender === 'bot' || s.attacker === 'bot'); }
function bbReinfPanel(s) {
  const pool = Array.isArray(s.pool) ? s.pool : [];
  if (!s.my_turn || !pool.length) return '';
  const admin = bbAdminBot(s);
  const fresh = admin || (s.acts_left || 0) >= (s.acts_max || 6);
  const help = admin
    ? `Тестовый режим: подкрепление можно вызывать <b>в любой момент хода</b>, оно <b>не тратит ход</b>, а корабль прибывает к своему краю доски <b>сразу готовым действовать</b>.`
    : `Вызов стоит <b>целого хода</b> и делается только <b>свежим ходом</b> — пока ни один корабль не активирован. Корабль прибудет к своему краю доски и вступит в дело со следующего хода.${fresh ? '' : ' <b>Сейчас ход уже начат — вызов недоступен.</b>'}`;
  return `<div class="bb-panel">
      <div class="bb-panel-t">Подкрепление</div>
      <div class="bb-panel-h">${help}${s.interdicted ? ' <b style="color:#ff5c8a">FTL-заградитель врага блокирует подкрепления — уничтожьте его носителя, выведите «Альтаан» или вызывайте корабли с собственным FTL-гипердвигателем (⇢).</b>' : ''}</div>
      ${pool.map(p => {
        const canJump = fresh && (!s.interdicted || p.ftl);
        return `<button class="bb-pool" ${canJump ? '' : 'disabled'} onclick="bbReinforce('${jsq(p.unit_id)}')">
          <span class="bb-pool-cls">${bbClsIco(p.cls)}</span>
          <span class="bb-pool-n">${esc(p.unit_name)}${s.interdicted && p.ftl ? ' <b style="color:#7cf">⇢ прыжок сквозь заграждение</b>' : ''}<i>${bbPoolDetail(p)}</i></span>
          <span class="bb-pool-q">×${p.free}</span>
        </button>`;
      }).join('')}
    </div>`;
}
function bbUnitPanel(s) {
  const u = (s.units || []).find(x => x.id === BB.sel);
  const reinf = bbReinfPanel(s);
  if (!u) return `<div class="bb-panel">
      <div class="bb-panel-t">Корабль не выбран</div>
      <div class="bb-panel-h">${s.my_turn ? `Кликните по своему кораблю: подсветятся гексы хода и цели в зоне поражения. За ход можно активировать ${s.acts_max || 6} кораблей.` : 'Сейчас ходит противник. Доска обновится сама.'}</div>
      <div class="bb-panel-h" style="margin-bottom:0">
        <b>Поле:</b> ⬢ астероиды режут линию огня, стоянка в них −10% корпуса за ход ·
        ▒ туманность гасит щиты и рассеивает залпы ·
        ◎ грав. колодец тянет корабли к центру ·
        ⣿ обломки: −1 к ходу, −15% входящего урона.<br>
        <b>Радар:</b> тусклая точка — неопознанный контакт. Вблизи (до 3 гексов) видно всех;
        дальше цель ловит радар на дистанции ≈ сенсор − половина скрытности.
        Выстрел раскрывает стрелявшего до его следующего хода.</div>
    </div>${reinf}`;
  const pct = v => Math.max(0, Math.min(100, v));
  const wpn = (u.wpn && u.wpn.length ? u.wpn : [{ rng: u.rng, dmg: u.dmg }])
    .slice().sort((a, b) => (b.rng || 0) - (a.rng || 0))
    .map(g => `<div class="bb-stat"><span>${bbGroupLabel(g)}${g.shots > 1 && !bbIsHeal(g) ? ` · залп ×${g.shots}` : ''}</span><b>${bbIsHeal(g) ? `+${g.dmg} HP союзнику` : g.dmg} · до ${g.rng} гекс.${bbGrpBandTxt(g)}</b></div>`).join('');
  return `<div class="bb-panel">
      <div class="bb-panel-t">${bbFacIco(u)}${esc(u.name)}</div>
      <div class="bb-panel-h">${bbFacOf(u) ? esc(bbFacOf(u).name || 'держава') + ' · ' : ''}${bbClsName(u.cls)}${u.mine && u.acted ? ' · <b>активирован</b>' : ''}${u.flash ? ' · <b style="color:#ff5c8a">позиция раскрыта выстрелом</b>' : ''}</div>
      <div class="bb-stat"><span>Корпус</span><b>${u.hp} / ${u.max_hp}</b></div>
      <div class="bb-bar-hp"><i style="width:${pct(u.hp / u.max_hp * 100)}%"></i></div>
      <div class="bb-stat"><span>Ход</span><b></b></div>
      ${bbTpBar(u, true)}
      <div class="bb-stat"><span>Щит</span><b>${(+u.shield) > 0 ? '' : 'опущен'}</b></div>
      ${bbShieldBar(u) || `<div class="bb-hint-s">поднимается через колесо (У): гасит ${bbNum(u.mitig)} урона/с, снимает ${Math.round(u.reduc * 100)}%</div>`}
      <div class="bb-stat"><span>Броня</span><b>${u.armor}</b></div>
      <div class="bb-stat"><span>Мощность</span><b>${u.stance && u.stance !== 'off'
        ? (u.stance === 'eng' ? '⚙ в двигателях — шаг вдвое дешевле'
         : u.stance === 'wpn' ? '⚔ в орудиях — урон ×1.3, перезарядка быстрее'
         : u.stance === 'siege' ? `\u{1F3F9} осадная платформа — урон ×${BBW_SIEGE_DMG}, рубеж ×${BBW_SIEGE_RNG}, хода нет`
         : '🛡 в щите — поле держит ход противника')
        : 'не распределена (колесо — клавиша У)'}</b></div>
      <div class="bb-stat"><span>Сенсор / скрытность</span><b>${u.sensor} / ${u.stealth}</b></div>
      ${u.pd > 0 ? `<div class="bb-stat"><span>ПРО</span><b>сбивает ${Math.round(u.pd * 100)}% ракет</b></div>` : ''}
      ${u.jam > 0 ? `<div class="bb-stat"><span>РЭБ</span><b>−${u.jam} к сенсорам врага (радиус 5)</b></div>` : ''}
      ${u.dejam > 0 ? `<div class="bb-stat"><span>Контр-РЭБ</span><b>снимает до ${u.dejam} помех со своих (радиус 5)</b></div>` : ''}
      ${u.eccm > 0 ? `<div class="bb-stat"><span>Помехозащищённость</span><b>−${u.eccm} к вражескому глушению</b></div>` : ''}
      ${u.interdict ? `<div class="bb-stat"><span>Интердикция</span><b>враг не вызывает подкрепления</b></div>` : ''}
      ${u.stabil ? `<div class="bb-stat"><span>Стабилизация</span><b>интердикция врага не действует</b></div>` : ''}
      ${u.ftl ? `<div class="bb-stat"><span>FTL-гипердвигатель</span><b>прыгает подкреплением сквозь вражескую интердикцию</b></div>` : ''}
      ${u.wings > 0 ? `<div class="bb-stat"><span>Авиакрылья в ангарах</span><b>${u.wings}</b></div>` : ''}
      ${wpn}
      ${u.mine && s.status === 'active' ? `<button class="btn btn-gd btn-sm" style="margin-top:8px;width:100%" onclick="bbWheelOpen('${jsq(u.id)}')">🎯 Что делать этим ходом (колесо, клавиша У)</button>` : ''}
      ${u.mine && s.my_turn && u.wings > 0 && !u.acted && s.acts_left > 0 ? `<button class="btn btn-gd btn-sm" style="margin-top:8px;width:100%" onclick="bbLaunch('${jsq(u.id)}')">🛩 Поднять авиакрыло (1 активация)</button>` : ''}
      ${u.mine && s.my_turn && bbHasHeal(u) && bbCanFire(u) ? `<button class="btn btn-sm ${BB.heal ? 'btn-gd' : ''}" style="margin-top:8px;width:100%" onclick="bbHealMode()">🛠 ${BB.heal ? 'Выберите союзника для ремонта (отмена — ещё раз)' : 'Ремонт нано-роем (по союзному кораблю)'}</button>` : ''}
      ${u.mine && s.my_turn ? `<div class="bb-panel-h" style="margin-top:8px">${(+u.tp) <= 0.05 ? 'Корабль израсходовал все секунды хода.' : (!u.acted && !(s.acts_left > 0) ? 'Активации кончились — этот корабль в этом ходу не действует.' : 'Клик по подсвеченному гексу — лететь по маршруту, по цели в зоне поражения — огонь. Кольца на доске = дальности огневых групп: чем ближе подойдёте, тем больше групп отработает по цели.')}</div>` : ''}
    </div>${bbReinfPanel(s)}`;
}

// ── Журнал боя ──────────────────────────────────────────────
function bbLogPanel(s) {
  const log = Array.isArray(s.log) ? s.log.slice(-40).reverse() : [];
  if (!log.length) return '';
  return `<div class="bb-panel bb-log">
      <div class="bb-panel-t">Журнал</div>
      <div class="bb-log-sc">
        ${log.map(l => `<div class="bb-log-l">${esc(l.m || '')}</div>`).join('')}
      </div>
    </div>`;
}

// ── Классы кораблей ─────────────────────────────────────────
const BB_CLS = {
  corvette:   'Корвет', frigate: 'Фрегат', destroyer: 'Эсминец',
  cruiser:    'Крейсер', battleship: 'Линкор', dreadnought: 'Дредноут',
  supportCarrier: 'Носитель поддержки', mediumCruiser: 'Средний крейсер',
  hyperCruiser: 'Факельщик', multiroleCarrier: 'Многоцелевой носитель', ss13: 'Станция',
  wing: 'Авиакрыло'
};
function bbClsName(c) { return BB_CLS[c] || 'Корабль'; }
function bbClsIco(c) {
  const n = { corvette: '▸', frigate: '▶', destroyer: '◆', cruiser: '⬢', battleship: '⬣', dreadnought: '⬟',
              supportCarrier: '⬨', mediumCruiser: '⬢', hyperCruiser: '⬡', multiroleCarrier: '⬨', ss13: '✦', wing: '𐊾' };
  return n[c] || '▸';
}
// Относительный размер корпуса на доске (0..1) — СТРОГО по возрастанию массы/роли
// класса, чтобы флот читался «от мелочи к громадам». Масштаб см. в bbShip.
//   wing(МЛА) < corvette < supportCarrier < frigate < destroyer < hyperCruiser
//   < cruiser < multiroleCarrier < mediumCruiser < battleship < ss13 < dreadnought
function bbClsSize(c) {
  return ({
    wing: 0.28,
    corvette: 0.40,
    supportCarrier: 0.46,
    frigate: 0.50,
    destroyer: 0.56,
    hyperCruiser: 0.64,
    cruiser: 0.68,
    multiroleCarrier: 0.72,
    mediumCruiser: 0.76,
    battleship: 0.86,
    ss13: 0.92,
    dreadnought: 1.00,
  })[c] || 0.55;
}

// ── ГЕКС-ГЕОМЕТРИЯ (flat-top, odd-q; зеркала _bt_dist/_bt_step/_bt_dirof) ──
const BB_DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];   // axial dq,dr; угол = 30°+60°·i
function bbHexCenter(x, y) {
  const R = BB.R;
  return { px: R + x * R * 1.5, py: R * BB_SQ3 * (y + 0.5 * (x & 1)) + R * BB_SQ3 / 2 };
}
function bbWorldSize() {
  const s = BB.st, R = BB.R;
  return { W: R * 1.5 * (s.w - 1) + 2 * R, H: R * BB_SQ3 * (s.h + 0.5) };
}
function bbDist(a, b) {
  const r1 = a.y - ((a.x - (a.x & 1)) >> 1), r2 = b.y - ((b.x - (b.x & 1)) >> 1);
  const dq = a.x - b.x, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
function bbStep(x, y, d) {
  const q = x, r = y - ((x - (x & 1)) >> 1);
  const q2 = q + BB_DIRS[d][0], r2 = r + BB_DIRS[d][1];
  return { x: q2, y: r2 + ((q2 - (q2 & 1)) >> 1) };
}
// Ближайшее из 6 направлений от гекса a к гексу b
function bbDirOf(a, b) {
  const r1 = a.y - ((a.x - (a.x & 1)) >> 1), r2 = b.y - ((b.x - (b.x & 1)) >> 1);
  const dq = b.x - a.x, dr = r2 - r1;
  if (!dq && !dr) return 0;
  const deg = Math.atan2(BB_SQ3 * (dr + dq / 2), 1.5 * dq) * 180 / Math.PI;
  return ((Math.round((deg - 30) / 60) % 6) + 6) % 6;
}
function bbDirAngle(f) { return (30 + 60 * f) * Math.PI / 180; }
// Маршрут гексами от a к b: каждый шаг — в ближайшем из 6 направлений к цели.
// Для чужого хода точного пути нет (виден лишь старт/финиш), но так корабль
// едет вдоль сетки, а не режет по диагонали. Возвращает [{x,y,f}] без старта.
function bbHexLine(a, b) {
  const out = [];
  let cur = { x: a.x, y: a.y }, guard = 0;
  while ((cur.x !== b.x || cur.y !== b.y) && guard++ < 60) {
    const d = bbDirOf(cur, b);
    const nx = bbStep(cur.x, cur.y, d);
    out.push({ x: nx.x, y: nx.y, f: d });
    cur = nx;
  }
  return out;
}
function bbTerra(x, y) { return BB.terr ? (BB.terr.get(x + ':' + y) || null) : null; }

// ── ФОРМА АРЕНЫ ─────────────────────────────────────────────
// Зеркало серверного _bt_in_arena (_bt_arena_shape.sql). Арена — не
// прямоугольник: линза, рваная долька, кольцо, песочные часы, полумесяц.
// Форма НЕ приходит списком клеток (это положило бы ход бота в таймаут) —
// приходят несколько чисел, а принадлежность считает та же арифметика.
// shape === null у старых боёв: тогда доска прямоугольная целиком.
function bbNorm(sh, x, y) {
  const w = sh.w, h = sh.h;
  return [w > 1 ? (x / (w - 1)) * 2 - 1 : 0,
          h > 1 ? ((y + 0.5 * (x & 1)) / (h - 1)) * 2 - 1 : 0];
}
function bbInArena(x, y) {
  const s = BB.st, sh = s && s.shape;
  if (!s) return false;
  if (x < 0 || x >= s.w || y < 0 || y >= s.h) return false;
  if (!sh || !sh.w || !sh.h || sh.k === 'rect') return true;
  const [u, v] = bbNorm(sh, x, y);
  if (sh.k === 'hour') {
    const waist = sh.waist != null ? +sh.waist : 0.6;
    return Math.abs(v) <= 1 - waist * (1 - u * u);
  }
  const r = Math.hypot(u, v), th = Math.atan2(v, u);
  const amp = +sh.amp || 0, m = sh.m != null ? +sh.m : 3, ph = +sh.ph || 0;
  if (r > 1 - amp * (1 - Math.cos(m * th + ph)) / 2) return false;
  if (sh.k === 'ring') return r >= (sh.hole != null ? +sh.hole : 0.32);
  if (sh.k === 'cres') {
    const ox = sh.ox != null ? +sh.ox : 0.55, oy = +sh.oy || 0;
    return Math.hypot(u - ox, v - oy) >= (sh.hr != null ? +sh.hr : 0.6);
  }
  return true;
}
// Сектор подхода стороны: {x,y,r} — якорь на кромке и радиус.
// sd — 'att'/'def' либо 'attacker'/'defender'.
function bbSpawnOf(sd) {
  const sp = BB.st && BB.st.spawn; if (!sp) return null;
  return sp[(sd === 'attacker' || sd === 'att') ? 'att' : 'def'] || null;
}
function bbMySpawn() { return bbSpawnOf(BB.st && BB.st.my_side); }
function bbInSpawn(sd, x, y) {
  const a = bbSpawnOf(sd);
  if (!a) return null;                        // легаси-бой: секторов нет
  return bbDist({ x, y }, { x: a.x, y: a.y }) <= (a.r || 0);
}

function bbHexFromWorld(wx, wy) {
  const s = BB.st, R = BB.R;
  const cx = Math.round((wx - R) / (R * 1.5));
  let best = null, bd = Infinity;
  for (let x = cx - 1; x <= cx + 1; x++) {
    if (x < 0 || x >= s.w) continue;
    const ry = Math.round((wy - R * BB_SQ3 / 2) / (R * BB_SQ3) - 0.5 * (x & 1));
    for (let y = ry - 1; y <= ry + 1; y++) {
      if (y < 0 || y >= s.h) continue;
      const c = bbHexCenter(x, y);
      const d = (c.px - wx) ** 2 + (c.py - wy) ** 2;
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  if (best && bd <= (R * 0.98) ** 2 && bbInArena(best.x, best.y)) return best;
  return null;      // мимо арены — пустота, там ни навести, ни кликнуть
}
function bbHexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i;
    const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
function bbUnitAt(x, y) {
  const s = BB.st;
  return (s.units || []).find(u => u.x === x && u.y === y)
      || BB.place.find(p => p.x === x && p.y === y) || null;
}
// Своя зона разворачивания = сектор подхода своей стороны (внутри арены).
// Легаси-бои без spawn падают на прежнее правило колонок у края.
function bbInMyZone(x, y) {
  const s = BB.st;
  if (!bbInArena(x, y)) return false;
  const inSp = bbInSpawn(s.my_side, x, y);
  if (inSp !== null) return inSp;
  const z = s.zone || 3;
  return s.my_side === 'attacker' ? x < z : x >= s.w - z;
}

// Линия огня: астероиды между гексами глушат выстрел (зеркало _bt_los_clear)
function bbLosClear(a, b) {
  const n = bbDist(a, b);
  if (n <= 1) return true;
  const q1 = a.x, r1 = a.y - ((a.x - (a.x & 1)) >> 1);
  const q2 = b.x, r2 = b.y - ((b.x - (b.x & 1)) >> 1);
  for (let i = 1; i < n; i++) {
    const fq = q1 + (q2 - q1) * i / n, fr = r1 + (r2 - r1) * i / n, fs = -fq - fr;
    let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
    const dq = Math.abs(rq - fq), dr = Math.abs(rr - fr), ds = Math.abs(rs - fs);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    const hx = rq, hy = rr + ((rq - (rq & 1)) >> 1);
    if (bbTerra(hx, hy) === 'ast') return false;
  }
  return true;
}

// ── ДОСЯГАЕМОСТЬ: обычный BFS по свободным гексам (зеркало battle_move) ──
// Инерции поворота больше нет: состояние = только гекс, курс ни на что не влияет.



// ════════════════════════════════════════════════════════════
// ПОКРЫТИЕ: радары, РЭБ и тьма за их краем
// ────────────────────────────────────────────────────────────
// Всё это уже работало на сервере, но было невидимым: игрок не понимал,
// почему одну цель он «видит», а другую — нет, и зачем вообще доворачивать нос.
// Рисуем ровно ту механику, что считает _bt_detected / _bt_ecm, без выдумок:
//   • круг 3 гекса вокруг своего борта — визуальный контакт, помехами не глушится;
//   • ПЕРЕДНИЙ СЕКТОР ±60° по курсу до max(4, сенсор − помехи + eccm) — радар;
//   • круг 5 вокруг вражеской глушилки — там наш сенсор просажен;
//   • круг 5 вокруг своей контр-РЭБ — там помеха снимается обратно.
// Всё остальное — тьма: туда мы просто не смотрим.
// Анимации нет намеренно: это карта покрытия, а не светомузыка.
// ════════════════════════════════════════════════════════════

// Помеха в точке (зеркало _bt_ecm): максимум вражеского jam в радиусе 5
// минус максимум своего dejam там же. Считаем по тому, что клиент ЗНАЕТ —
// невидимую глушилку не нарисуем, и это честно.
function bbEcmAt(x, y) {
  const s = BB.st; if (!s) return 0;
  let jam = 0, de = 0;
  (s.units || []).forEach(u => {
    if (!u.locked && !u.mine) return;
    const d = bbDist({ x, y }, { x: u.x, y: u.y });
    if (d > 5) return;
    if (u.side !== s.my_side && (u.jam || 0) > jam) jam = u.jam;
    if (u.side === s.my_side && (u.dejam || 0) > de) de = u.dejam;
  });
  return Math.max(0, jam - de);
}

// Радиус радара конкретного борта с учётом помех на ЕГО гексе.
function bbRadarR(u) {
  const eff = Math.max(0, (u.sensor || 0) - Math.max(0, bbEcmAt(u.x, u.y) - (u.eccm || 0)));
  return Math.max(4, eff);
}

// Карта покрытия стороны. Кэш держим до следующего обновления состояния.
function bbCoverage() {
  const s = BB.st;
  if (!s || !s.units) return null;
  if (BB.cov) return BB.cov;
  const lit = new Set(), jam = new Set(), dejam = new Set();
  const mine = (s.units || []).filter(u => u.mine || u.side === s.my_side);

  mine.forEach(u => {
    const R = bbRadarR(u);
    // квадрат-обёртка вокруг борта, внутри режем гекс-дистанцией
    for (let x = Math.max(0, u.x - R); x <= Math.min(s.w - 1, u.x + R); x++) {
      for (let y = Math.max(0, u.y - R - 1); y <= Math.min(s.h - 1, u.y + R + 1); y++) {
        if (!bbInArena(x, y)) continue;
        const d = bbDist({ x, y }, { x: u.x, y: u.y });
        if (d > R) continue;
        if (d <= 3) { lit.add(x + ':' + y); continue; }          // визуал
        const rel = ((bbDirOfXY(u.x, u.y, x, y) - (u.facing || 0)) % 6 + 6) % 6;
        if (rel === 0 || rel === 1 || rel === 5) lit.add(x + ':' + y);   // передний сектор
      }
    }
    if ((u.dejam || 0) > 0) bbDiskInto(dejam, u.x, u.y, 5);
  });

  (s.units || []).forEach(u => {
    if (u.side === s.my_side || (!u.locked && !u.mine)) return;
    if ((u.jam || 0) > 0) bbDiskInto(jam, u.x, u.y, 5);
  });

  BB.cov = { lit, jam, dejam };
  return BB.cov;
}

function bbDiskInto(set, cx, cy, r) {
  const s = BB.st;
  for (let x = Math.max(0, cx - r); x <= Math.min(s.w - 1, cx + r); x++) {
    for (let y = Math.max(0, cy - r - 1); y <= Math.min(s.h - 1, cy + r + 1); y++) {
      if (bbInArena(x, y) && bbDist({ x, y }, { x: cx, y: cy }) <= r) set.add(x + ':' + y);
    }
  }
}

// Направление от гекса к гексу (зеркало _bt_dirof) — нужен для сектора радара.
// ⚠ ИМЯ. Рядом живёт bbDirOf(a, b) — тот же расчёт, но по ДВУМ ТОЧКАМ, и
// именно им ходит bbHexLine. Пока эта функция звалась так же, объявление
// перетирало ту: bbHexLine получала NaN, BB_DIRS[NaN] падал «reading '0'», и
// ход бота обрывался на анимации — бот «заступал и стоял».
function bbDirOfXY(x1, y1, x2, y2) {
  const dq = x2 - x1;
  const dr = (y2 - ((x2 - (x2 & 1)) >> 1)) - (y1 - ((x1 - (x1 & 1)) >> 1));
  if (dq === 0 && dr === 0) return 0;
  const fx = 1.5 * dq, fy = Math.sqrt(3) * (dr + dq / 2);
  const deg = Math.atan2(fy, fx) * 180 / Math.PI;
  return ((Math.round((deg - 30) / 60) % 6) + 6) % 6;
}

// Переключатель слоя: не всем и не всегда он нужен.
function bbFogToggle() {
  BB.fog = !BB.fog;
  try { localStorage.setItem('bb_fog', BB.fog ? '1' : '0'); } catch (e) {}
  BB.cov = null;
  bbRender();
  toast(BB.fog ? 'Покрытие радаров включено: тьма — куда мы не смотрим'
               : 'Покрытие радаров выключено', 'ok');
}

// ── ЦЕННИК У КУРСОРА ────────────────────────────────────────
// Решение принимается там, где курсор, — значит и цена должна быть там же.
// Наводишь на гекс: сколько шагов, сколько секунд, что останется. Наводишь
// на врага: цена залпа и хватит ли на него. Не по карману — ценник краснеет
// и прямо пишет, чего не хватает.
var BBTIP = null;
function bbTipEl() {
  if (!BBTIP) {
    BBTIP = document.createElement('div');
    BBTIP.className = 'bbtip';
    document.body.appendChild(BBTIP);
  }
  return BBTIP;
}
function bbTipHide() { if (BBTIP) BBTIP.style.display = 'none'; }

// Что произойдёт, если кликнуть по этому гексу выбранным кораблём.
function bbTipPlan(sel, hx, hy) {
  const s = BB.st;
  if (!sel || !sel.mine || !s || s.status !== 'active' || !s.my_turn) return null;
  const tp = +sel.tp || 0;
  const foe = (s.units || []).find(u => u.x === hx && u.y === hy && !u.mine && u.side !== s.my_side);

  if (foe) {
    const hit = bbCanHit(sel, foe);
    const c = bbFireCost(sel);
    if (!hit.ok) return { ico: '⚔', t: 'Залп невозможен', s: hit.why, bad: true };
    if (tp + 1e-9 < c) return { ico: '⚔', t: `Залп — ${c.toFixed(1)} с`, cost: c,
      s: `осталось ${tp.toFixed(1)} с — не хватает ${(c - tp).toFixed(1)} с`, bad: true };
    // Спад по дистанции показываем ТОЛЬКО когда он есть: иначе строка шумит.
    const fade = hit.fade < 0.98 ? ` · с этой дистанции ${Math.round(hit.fade * 100)}% урона` : '';
    return { ico: '⚔', t: `Залп — ${c.toFixed(1)} с`, cost: c,
      s: `останется ${(tp - c).toFixed(1)} с`
         + (sel.stance === 'wpn' ? ` · форсаж ×${BBW_WPN_DMG}` : '')
         + (sel.stance === 'siege' ? ` · осада ×${BBW_SIEGE_DMG}` : '')
         + fade };
  }

  if (!BB.reach) BB.reach = bbComputeReach(sel);
  const r = BB.reach.get(hx + ':' + hy);
  if (!r) {
    if (sel.stance === 'siege') return { ico: '\u{1F3F9}', t: 'Платформа разложена',
      s: 'в осадном режиме корабль прикован к месту до конца хода', bad: true };
    if (bbSteps(sel) < 1) return { ico: '➤', t: 'Секунд на манёвр нет', s: `осталось ${tp.toFixed(1)} с`, bad: true };
    return null;                     // просто далеко — молчим, чтобы не мельтешить
  }
  // Цена — сумма по клеткам маршрута, а не «шаг × длина»: путь сквозь пояс
  // дороже такого же по длине в пустоте, и это должно быть видно ДО клика.
  const cost = r.cost, base = bbStepCost(sel);
  const rough = cost > base * r.steps * 1.05;   // маршрут идёт по тяжёлым клеткам
  return { ico: '➤', t: `${r.steps} гекс · ${cost.toFixed(1)} с`, cost: cost,
    s: `останется ${Math.max(0, tp - cost).toFixed(1)} с`
       + (rough ? ' · путь по камням' : '')
       + (sel.stance === 'eng' ? ' · форсаж двигателей' : '') };
}


// Деления в ценнике: жёлтые уйдут на это действие, синие останутся.
// Цифра рядом остаётся, но «хватит или нет» видно, не читая.
function bbTipScale(u, cost) {
  if (!(cost > 0)) return '';
  const max = Math.max(1, Math.round(+u.tp_max || 6));
  const tp = Math.max(0, +u.tp || 0);
  let out = '';
  for (let i = 0; i < max; i++) {
    const seg = i + 1;
    let cls = '';
    if (seg <= Math.ceil(tp - cost)) cls = 'left';
    else if (seg <= Math.ceil(tp)) cls = 'use';
    out += `<i class="${cls}"></i>`;
  }
  return `<span class="bbtip-sc">${out}</span>`;
}

function bbTipMove(ev) {
  const s = BB.st;
  const sel = s && (s.units || []).find(u => u.id === BB.sel);
  const c = BB.hover;
  const plan = (sel && c) ? bbTipPlan(sel, c.x, c.y) : null;
  if (!plan) { bbTipHide(); return; }
  const el = bbTipEl();
  el.className = 'bbtip' + (plan.bad ? ' bbtip-bad' : '');
  el.innerHTML = `<span class="bbtip-i">${plan.ico}</span>` +
    `<span class="bbtip-x"><b>${esc(plan.t)}</b><i>${esc(plan.s)}</i>` +
    bbTipScale(sel, plan.cost) + `</span>`;
  el.style.display = 'flex';
  // держим ценник в окне: у правого/нижнего края разворачиваем к курсору
  const w = el.offsetWidth || 160, h = el.offsetHeight || 38;
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 12;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 12;
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
document.addEventListener('pointermove', function (ev) {
  if (ev.pointerType !== 'mouse') return;
  if (!BB.st || BB.st.status !== 'active' || !document.querySelector('.bb-ov')) { bbTipHide(); return; }
  if (typeof BBW !== 'undefined' && BBW.open) { bbTipHide(); return; }   // под колесом ценнику делать нечего
  bbTipMove(ev);
}, true);

// ── ШКАЛА ХОДА: секунды видно, а не читаешь ─────────────────
// Пул режется на деления по 1 секунде. Заполненные — ещё есть, тусклые —
// потрачены, синие — ушли в щит. Под ними мелкие метки: во что упрётся
// следующий шаг и следующий залп, чтобы «хватит/не хватит» читалось глазом.
function bbTpBar(u, big) {
  const max = Math.max(1, Math.round(+u.tp_max || 6));
  const tp = Math.max(0, +u.tp || 0), sh = Math.max(0, +u.shield || 0);
  const step = bbStepCost(u), fire = bbFireCost(u);
  let pips = '';
  for (let i = 0; i < max; i++) {
    const from = i, to = i + 1;
    let cls = 'bbtp-e';                                    // потрачено
    if (tp >= to - 0.001) cls = 'bbtp-f';                   // целое деление в запасе
    else if (tp > from) cls = 'bbtp-p';                     // початое
    if (sh > 0 && i >= max - Math.ceil(sh)) cls = 'bbtp-s'; // ушло в поле
    pips += `<i class="${cls}"></i>`;
  }
  const marks = `<span class="bbtp-m">шаг ${step.toFixed(1)}с</span>` +
                `<span class="bbtp-m">залп ${fire.toFixed(1)}с</span>`;
  return `<span class="bbtp${big ? ' bbtp-big' : ''}" title="Ход: ${tp.toFixed(1)} из ${max} c">
      <span class="bbtp-p-row">${pips}</span>
      <span class="bbtp-n">${tp.toFixed(1)}<b>с</b></span>
      ${big ? `<span class="bbtp-marks">${marks}</span>` : ''}
    </span>`;
}

// Значок режима: иконка + что он даёт. Пусто — мощность не распределена.
function bbStanceChip(u) {
  const m = { eng: ['⚙', 'двигатели', 'шаг ×0.5'],
              wpn: ['⚔', 'орудия', 'урон ×1.3'],
              siege: ['\u{1F3F9}', 'осадный режим', `урон ×${BBW_SIEGE_DMG}`],
              shd: ['🛡', 'щит', ''] }[u && u.stance];
  if (!m) return '';
  const extra = u.stance === 'shd' ? `${(+u.shield).toFixed(1)}с поля` : m[2];
  return `<span class="bbst bbst-${u.stance}" title="Мощность направлена в ${m[1]}">${m[0]}<b>${extra}</b></span>`;
}

// Полоска щита цели: сколько поля осталось и что оно снимает.
function bbShieldBar(u) {
  const sh = Math.max(0, +u.shield || 0), max = Math.max(1, +u.tp_max || 6);
  if (sh <= 0) return '';
  return `<span class="bbsh" title="Поле держит ход противника: гасит ${bbNum(u.mitig)} урона/с, снимает ${Math.round(u.reduc * 100)}%">
      <i style="width:${Math.min(100, sh / max * 100)}%"></i>
      <b>${sh.toFixed(1)}с · −${Math.round(u.reduc * 100)}%</b></span>`;
}

// Множители режимов — зеркало _bt_stance.sql (цена режима и бонусы).
var BBW_ENG = 0.5, BBW_WPN_DMG = 1.3, BBW_WPN_CST = 0.8, BBW_COST = 1.0;
// ЗЕРКАЛО _bt_weapon_model.sql: осадный режим факельщика.
// Осада больше НЕ привилегия класса: её даёт модуль «Осадная платформа «Кряж»».
// Кто может её включить — видно по u.acts, а не по u.cls (см. BBK/bbKitPanel).
var BBW_SIEGE_DMG = 2.0, BBW_SIEGE_RNG = 1.25;

// ЗЕРКАЛО _bt_weapon_model.sql: модель урона по дистанции. До opt·rng группа
// бьёт в полную силу, дальше урон линейно падает до far. У ракет — мёртвая
// зона dmin (вплотную не наводятся), у арты профиль плоский.
var BBW_OPT = { kinetic: 0.40, energy: 0.60, missile: 1.00 };
var BBW_FAR = { kinetic: 0.25, energy: 0.60, missile: 1.00 };
function bbGrpRng(g, sel) {
  const r = Math.max(1, +g.rng || 1);
  return sel && sel.stance === 'siege' ? Math.ceil(r * BBW_SIEGE_RNG) : r;
}
function bbGrpDmin(g) {
  const d = +g.dmin;
  return d > 0 ? d : (g.k === 'missile' ? 2 : 1);
}
// Доля урона группы на дистанции L (0 — не достаёт вовсе).
function bbFalloff(g, L, sel) {
  const rng = bbGrpRng(g, sel);
  if (L < bbGrpDmin(g) || L > rng) return 0;
  const opt = Math.max(1, Math.floor(rng * (g.opt != null ? +g.opt : (BBW_OPT[g.k] != null ? BBW_OPT[g.k] : 1))));
  const far = g.far != null ? +g.far : (BBW_FAR[g.k] != null ? BBW_FAR[g.k] : 1);
  if (L <= opt || rng <= opt) return 1;
  return Math.max(0.05, Math.min(1, 1 - (1 - far) * (L - opt) / (rng - opt)));
}

// Шагов по карману в остатке хода (зеркало battle_move: tp / step_cost).
// ЗЕРКАЛО _bt_stance.sql: без этих множителей доска рисовала прежний радиус,
// сервер бонус давал, а на глаз «форсаж ничего не поменял».
// ЗЕРКАЛО _bt_terra_mult (_bt_terrain_cost.sql): цена платится за ВХОД в
// гекс, по его ландшафту. Пояс не пролетают — сквозь него продавливаются.
var BBW_TERRA = { ast: 2.2, deb: 1.5, neb: 1.25 };
function bbTerraMult(x, y) { return BBW_TERRA[bbTerra(x, y)] || 1; }

// Базовая цена шага — по чистому гексу. Ландшафт домножает её на входе.
function bbStepCost(sel) {
  let cost = +sel.step_cost || 1;
  if (sel.stance === 'eng') cost *= BBW_ENG;          // форсаж двигателей
  return cost;
}
function bbFireCost(sel) {
  return (+sel.fire_cost || 0) * (sel.stance === 'wpn' ? BBW_WPN_CST : 1);
}
function bbSteps(sel) { return Math.floor((+sel.tp + 1e-9) / bbStepCost(sel)); }
function bbCanFire(sel) { return (+sel.tp + 1e-9) >= bbFireCost(sel); }

// Досягаемость — ДЕЙКСТРА ПО СЕКУНДАМ, а не волна по шагам: с платным
// ландшафтом равное число шагов больше не значит равную цену, и обход вокруг
// гряды часто дешевле, чем напрямик сквозь неё. Зеркало _bt_do_move: тот же
// бюджет, те же множители — что доска подсветила, то сервер и пропустит.
function bbComputeReach(sel) {
  const s = BB.st;
  const base = bbStepCost(sel), tp = +sel.tp || 0;
  // Разложенная осадная платформа не ходит вовсе — доска не должна предлагать
  // маршрут, который сервер всё равно отобьёт.
  if (sel.stance === 'siege') return new Map();
  if (tp + 1e-9 < base) return new Map();
  const occ = new Set((s.units || []).filter(u => u.id !== sel.id).map(u => u.x + ':' + u.y));
  const reach = new Map();
  const best = new Map([[sel.x + ':' + sel.y, 0]]);
  // «Ведро» на каждый шаг: путей за ход мало, полноценная очередь с
  // приоритетом тут только усложнила бы код без выигрыша.
  let q = [{ x: sel.x, y: sel.y, cost: 0, path: [] }];
  while (q.length) {
    const nq = [];
    for (const c of q) {
      for (let d = 0; d < 6; d++) {
        const p = bbStep(c.x, c.y, d);
        if (p.x < 0 || p.x >= s.w || p.y < 0 || p.y >= s.h) continue;
        if (!bbInArena(p.x, p.y)) continue;        // в пустоту за кромкой не летают
        const key = p.x + ':' + p.y;
        if (occ.has(key)) continue;
        const cost = c.cost + base * bbTerraMult(p.x, p.y);
        if (cost > tp + 1e-9) continue;
        if (best.has(key) && best.get(key) <= cost + 1e-9) continue;
        best.set(key, cost);
        const path = c.path.concat([{ x: p.x, y: p.y, f: d }]);
        reach.set(key, { steps: path.length, cost, path, f: d });
        nq.push({ x: p.x, y: p.y, cost, path });
      }
    }
    q = nq;
  }
  return reach;
}

// Можно ли выбранным попасть по цели (зеркало battle_fire, для UX).
// Решает только дальность: отрабатывают все группы, что достают.
function bbCanHit(sel, tgt) {
  if (tgt.contact || !tgt.locked) return { ok: false, why: 'цель не захвачена: подведите корабль с радаром ближе (визуал — 3 гекса) или выбейте РЭБ врага' };
  const L = bbDist(sel, tgt);
  const gs = (sel.wpn && sel.wpn.length) ? sel.wpn : [{ rng: sel.rng, dmg: sel.dmg }];
  let dmg = 0, groups = 0, full = 0, close = 0;
  for (const g of gs) {
    if (bbIsHeal(g)) continue;                 // ремонтный рой врага не бьёт
    const f = bbFalloff(g, L, sel);
    if (f > 0) { dmg += (+g.dmg || 0) * f; full += (+g.dmg || 0); groups++; }
    else if (L >= 1 && L < bbGrpDmin(g)) close++;
  }
  if (!groups && close) return { ok: false,
    why: `дистанция ${L} — ракетам не хватает разгона на захват, отойдите дальше` };
  if (!groups) return { ok: false, why: `дистанция ${L} — дальше, чем бьют огневые группы` };
  if (!bbLosClear(sel, tgt)) return { ok: false, why: 'линию огня перекрывают астероиды' };
  // fade — во сколько раз дистанция съедает залп. Нужен подсказке: «бьёшь, но
  // вполсилы — подойди ближе» это другое решение, чем «не достаёшь».
  return { ok: true, dmg: Math.round(dmg), groups,
           fade: full > 0 ? dmg / full : 1 };
}
// Можно ли выбранным отремонтировать союзника (зеркало ветки ремонта в battle_fire).
function bbCanHeal(sel, tgt) {
  const gs = (sel.wpn && sel.wpn.length) ? sel.wpn : [];
  if (!gs.some(bbIsHeal)) return { ok: false, why: 'на этом корабле нет ремонтных нано-роёв' };
  if (tgt.id === sel.id) return { ok: false, why: 'рой чинит только ДРУГОЙ корабль — себя латать нечем' };
  if (tgt.hp >= tgt.max_hp) return { ok: false, why: `«${tgt.name}» и так цел` };
  const L = bbDist(sel, tgt);
  let heal = 0, groups = 0;
  for (const g of gs) if (bbIsHeal(g) && L >= 1 && L <= g.rng) { heal += g.dmg; groups++; }
  if (!groups) return { ok: false, why: `дистанция ${L} — дальше, чем добрасывает ремонтный рой` };
  if (!bbLosClear(sel, tgt)) return { ok: false, why: 'путь рою перекрывают астероиды' };
  return { ok: true, heal: Math.round(heal), groups };
}
// Есть ли у корабля ремонтные группы (для подсветки союзников как целей).
function bbHasHeal(u) { return !!(u && u.wpn && u.wpn.some(bbIsHeal)); }

// ── Высота нижней командной строки → --bbcmd ────────────────
// Полоска выбранного борта, лента и шторка висели на ЗАХАРДКОЖЕННОМ отступе
// снизу (68/120 px). Реальная высота .bbd-cmd плавает: на телефоне иконки
// переносятся на вторую строку, «завершить ход» уезжает своей строкой, снизу
// добавляется safe-area. Отсюда и провал: панель пряталась под командной
// строкой. Меряем её и отдаём в CSS-переменную, панели считают отступ от неё.
function bbCmdH() {
  const host = document.querySelector('#bb-ov .bbd'); if (!host) return;
  const cmd = host.querySelector('.bbd-cmd');
  const h = cmd ? Math.round(cmd.getBoundingClientRect().height) : 0;
  host.style.setProperty('--bbcmd', (h || 60) + 'px');
  // Перенос строк меняется при повороте и смене состава кнопок — следим.
  if (cmd && !BB.cmdRO && window.ResizeObserver) {
    BB.cmdRO = new ResizeObserver(() => {
      const c = document.querySelector('#bb-ov .bbd .bbd-cmd');
      const p = c && c.parentElement;
      if (c && p) p.style.setProperty('--bbcmd', Math.round(c.getBoundingClientRect().height) + 'px');
    });
  }
  if (BB.cmdRO && cmd) { BB.cmdRO.disconnect(); BB.cmdRO.observe(cmd); }
}

// ── КАМЕРА ──────────────────────────────────────────────────
function bbFit() {
  const s = BB.st; if (!s || !BB.cv) return;
  // Оба экрана боя — карта во весь вьюпорт; панели лежат накладками поверх.
  // Размер берём у РОДИТЕЛЯ канваса: он и есть слой карты, поэтому канвас
  // всегда точно совпадает с ним, без чёрных полей снизу.
  const box = BB.cv.parentElement.getBoundingClientRect();
  BB.vw = Math.max(240, Math.round(box.width) || window.innerWidth);
  BB.vh = Math.max(260, Math.round(box.height) || window.innerHeight);
  BB.dpr = Math.min(2, window.devicePixelRatio || 1);
  BB.cv.style.width = BB.vw + 'px'; BB.cv.style.height = BB.vh + 'px';
  BB.cv.width = Math.round(BB.vw * BB.dpr); BB.cv.height = Math.round(BB.vh * BB.dpr);
  if (!BB.camReady) { if (BB.deployUI) bbCamDeploy(); else bbCamHome(); BB.camReady = true; }
  bbCamClamp();
  if (BB.glOn) bgResize();      // 3D берёт размер у того же слоя карты
}
function bbCamHome() {
  const s = BB.st; if (!s) return;
  const { W, H } = bbWorldSize();
  BB.zoom = Math.max(Math.min(BB.vh / H, BB.vw / W), 22 / (BB.R * BB_SQ3));
  BB.zoom = Math.min(BB.zoom, 1.6);
  const meAtt = s.my_side === 'attacker';
  const mine = (s.units || []).filter(u => u.mine);
  let fx;
  if (mine.length) fx = mine.reduce((a, u) => a + bbHexCenter(u.x, u.y).px, 0) / mine.length;
  else fx = meAtt ? BB.R * 4 : W - BB.R * 4;
  BB.camX = fx - BB.vw / BB.zoom / 2;
  BB.camY = H / 2 - BB.vh / BB.zoom / 2;
  bbCamClamp();
  if (BB.glOn) { bgCamHome(); return; }
  if (BB.ctx) bbPaint();
}
function bbCamClamp() {
  const s = BB.st; if (!s) return;
  const { W, H } = bbWorldSize();
  const pad = BB.R * 2;
  const vwW = BB.vw / BB.zoom, vwH = BB.vh / BB.zoom;
  BB.camX = Math.max(-pad - Math.max(0, vwW - W - pad), Math.min(W + pad - vwW, BB.camX));
  BB.camY = Math.max(-pad - Math.max(0, vwH - H - pad), Math.min(H + pad - vwH, BB.camY));
  if (vwW >= W + pad * 2) BB.camX = (W - vwW) / 2;
  if (vwH >= H + pad * 2) BB.camY = (H - vwH) / 2;
}
function bbZoomAt(f, sx, sy) {
  const z0 = BB.zoom;
  const z1 = Math.max(0.2, Math.min(3, z0 * f));
  if (z1 === z0) return;
  BB.camX += sx / z0 - sx / z1;
  BB.camY += sy / z0 - sy / z1;
  BB.zoom = z1;
  bbCamClamp();
  bbPaint();
}
function bbZoomBtn(f) {
  if (BB.glOn) { bgZoom(f); return; }          // в 3D «приблизить» — это подъехать
  bbZoomAt(f, BB.vw / 2, BB.vh / 2);
}

// ── ВРАЩЕНИЕ КАМЕРЫ (3D) ────────────────────────────────────
// Кнопки-стрелки на четверть оборота — И ВСЁ. Режим обзора («палец вращает
// камеру») выпилен: он был лишним состоянием, из которого игрок не всегда
// выбирался, и спорил с щипком. Управление теперь без режимов: палец тянет
// поле, два пальца — зум и доворот, стрелки — точный поворот.
function bbOrbitBtns() {
  if (!BB.glOn || typeof bgOrbitStep !== 'function') return '';
  return `<button class="bbd-ic" onclick="bbOrbitStep(-1)" title="Повернуть камеру влево">↺</button>
    <button class="bbd-ic" onclick="bbOrbitStep(1)" title="Повернуть камеру вправо">↻</button>`;
}
function bbOrbitStep(dir) {
  if (BB.glOn && typeof bgOrbitStep === 'function') bgOrbitStep(dir);
}

// ── Ввод: пан/пинч/клик/ховер ───────────────────────────────
function bbScreenXY(ev) {
  const r = BB.cv.getBoundingClientRect();
  return { sx: ev.clientX - r.left, sy: ev.clientY - r.top };
}
function bbHexAt(ev) {
  const { sx, sy } = bbScreenXY(ev);
  return bbHexFromWorld(sx / BB.zoom + BB.camX, sy / BB.zoom + BB.camY);
}
function bbBindCanvas() {
  const cv = BB.cv;
  cv.style.touchAction = 'none';

  cv.onpointerdown = ev => {
    cv.setPointerCapture(ev.pointerId);
    BB.ptrs.set(ev.pointerId, bbScreenXY(ev));
    if (BB.ptrs.size === 1) {
      const p = bbScreenXY(ev);
      // РАССТАНОВКА: палец лёг на уже стоящий борт — тащим ЕГО, а не камеру.
      const c = BB.deployUI ? bbHexAt(ev) : null;
      const i = c ? BB.place.findIndex(q => q.x === c.x && q.y === c.y) : -1;
      if (i >= 0) {
        BB.shipDrag = { i, cell: c, moved: false, sx: p.sx, sy: p.sy };
        BB.drag = null; BB.pinch = null;
        bbPaint();
        ev.preventDefault();
        return;
      }
      BB.drag = { sx: p.sx, sy: p.sy, camX: BB.camX, camY: BB.camY, moved: false };
      BB.pinch = null;
      BB.camAnim = null;   // ручной пан отменяет авто-доворот камеры
    } else if (BB.ptrs.size === 2) {
      const [a, b] = [...BB.ptrs.values()];
      BB.pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), zoom: BB.zoom };
      BB.drag = null;
    }
    ev.preventDefault();
  };
  cv.onpointermove = ev => {
    const p = bbScreenXY(ev);
    if (BB.ptrs.has(ev.pointerId)) BB.ptrs.set(ev.pointerId, p);
    // тянем борт по доске — он едет за пальцем, гекс-приёмник подсвечен
    if (BB.shipDrag) {
      if (Math.abs(p.sx - BB.shipDrag.sx) + Math.abs(p.sy - BB.shipDrag.sy) > 5) BB.shipDrag.moved = true;
      BB.shipDrag.cell = bbHexAt(ev);
      bbPaint();
      return;
    }
    if (BB.pinch && BB.ptrs.size >= 2) {
      const [a, b] = [...BB.ptrs.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      if (d > 4 && BB.pinch.d > 4) {
        const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        const target = Math.max(0.2, Math.min(3, BB.pinch.zoom * d / BB.pinch.d));
        bbZoomAt(target / BB.zoom, mx, my);
      }
      return;
    }
    if (BB.drag && BB.ptrs.size === 1) {
      const dx = p.sx - BB.drag.sx, dy = p.sy - BB.drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) BB.drag.moved = true;
      if (BB.drag.moved) {
        BB.camX = BB.drag.camX - dx / BB.zoom;
        BB.camY = BB.drag.camY - dy / BB.zoom;
        bbCamClamp();
        bbPaint();
      }
      return;
    }
    if (ev.pointerType === 'mouse' && !BB.drag) {
      const c = bbHexAt(ev);
      const same = BB.hover && c && BB.hover.x === c.x && BB.hover.y === c.y;
      if (!same) { BB.hover = c; bbPaint(); }
    }
  };
  cv.onpointerup = ev => {
    // отпустили борт: в свою зону — переставить, мимо зоны — снять с доски
    if (BB.shipDrag) {
      const d = BB.shipDrag; BB.shipDrag = null;
      BB.ptrs.delete(ev.pointerId);
      const ship = BB.place[d.i];
      const c = bbHexAt(ev);
      if (!d.moved) { BB.pick = ship ? ship.unit_id : BB.pick; bbRender(); return; }
      if (!ship) { bbRender(); return; }
      if (!c || !bbInMyZone(c.x, c.y)) {
        BB.place.splice(d.i, 1);
        toast(`«${ship.unit_name}» снят с доски`, 'ok');
      } else if (bbCellBusy(c.x, c.y, d.i)) {
        toast('Гекс занят — тащите на свободный', 'err');
      } else {
        ship.x = c.x; ship.y = c.y;
      }
      bbRender();
      return;
    }
    const wasDrag = BB.drag && BB.drag.moved;
    const wasPinch = !!BB.pinch;
    BB.ptrs.delete(ev.pointerId);
    if (BB.ptrs.size < 2) BB.pinch = null;
    if (BB.ptrs.size === 0) {
      const d = BB.drag; BB.drag = null;
      if (!wasDrag && !wasPinch && d) {
        const c = bbHexAt(ev);
        if (c) bbClick(c.x, c.y);
      }
    }
  };
  cv.onpointercancel = ev => { BB.ptrs.delete(ev.pointerId); BB.drag = null; BB.shipDrag = null; if (BB.ptrs.size < 2) BB.pinch = null; };
  cv.onpointerleave = () => { if (!BB.drag) { BB.hover = null; bbPaint(); } };
  cv.onwheel = ev => {
    ev.preventDefault();
    const { sx, sy } = bbScreenXY(ev);
    bbZoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, sx, sy);
  };
  window.onresize = () => { if (BB.id && BB.cv) { bbFit(); bbPaint(); } };
}

function bbClick(x, y) {
  const s = BB.st; if (!s || BB.busy) return;

  // ── фаза расстановки ──
  if (s.status === 'forming') {
    const hit = BB.place.findIndex(p => p.x === x && p.y === y);
    if (hit >= 0) { BB.place.splice(hit, 1); bbRender(); return; }
    if (!BB.pick) { toast('Сначала выберите корабль в ростере', 'err'); return; }
    if (!bbInMyZone(x, y)) { toast(bbInArena(x, y) ? "Ставить можно только в свой сектор подхода — подсвеченные гексы" : "Там пустота за кромкой арены", "err"); return; }
    const p = (s.pool || []).find(q => q.unit_id === BB.pick);
    if (!p) return;
    const why = bbCanAdd(s, p);
    if (why) { toast(why, 'err'); return; }
    BB.place.push({ unit_id: p.unit_id, unit_name: p.unit_name, cls: p.cls, x, y });
    bbRender();
    return;
  }

  if (s.status !== 'active' || !s.my_turn) return;

  const tgt = (s.units || []).find(u => u.x === x && u.y === y);
  const sel = (s.units || []).find(u => u.id === BB.sel);

  // режим наведения модуля: снаряжению нужна цель или гекс. Разбираем ДО
  // остальных веток — иначе клик по врагу уйдёт в обычный залп.
  if (BB.mod && sel) {
    const key = BB.mod, meta = BBK[key] || {};
    const done = () => { BB.mod = null; bbRender(); };
    if (meta.need === 'hex') {
      if (tgt) { toast('Гекс занят — прыжок только в пустой', 'err'); return; }
      // Дальность берём из самого модуля, а не из константы: у тира она своя.
      const act = (sel.acts || []).find(a => a.k === key) || {};
      const max = +act.rng || 5, L = bbDist(sel, { x, y });
      if (L < 1 || L > max) { toast(`Прыжок бьёт на ${max} гексов, а до цели ${L}`, 'err'); return; }
      done();
      bbAct('battle_module', { p_battle: BB.id, p_unit: sel.id, p_key: key, p_x: x, p_y: y });
      return;
    }
    if (!tgt) { toast('Нужно кликнуть по кораблю', 'err'); return; }
    if (meta.need === 'ally' && tgt.side !== s.my_side) { toast('Дроны чинят только своих', 'err'); return; }
    if (meta.need === 'foe' && tgt.side === s.my_side) { toast('Это союзник — по своим не бьём', 'err'); return; }
    done();
    bbAct('battle_module', { p_battle: BB.id, p_unit: sel.id, p_key: key, p_target: tgt.id });
    return;
  }

  // режим ремонта: клик по СОЮЗНОМУ кораблю (своему или союзника по стороне) —
  // нано-рой латает ему корпус. Тратит выстрел и активацию, как обычный залп.
  if (BB.heal && sel && tgt && tgt.side === s.my_side) {
    if (!bbCanFire(sel)) { toast('Секунд на ремонтный залп не осталось', 'err'); return; }
    if (!sel.acted && !(s.acts_left > 0)) { toast(`Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей`, 'err'); return; }
    const r = bbCanHeal(sel, tgt);
    if (!r.ok) { toast(r.why, 'err'); return; }
    const a = bbHexCenter(sel.x, sel.y), b = bbHexCenter(tgt.x, tgt.y);
    const t0 = performance.now();
    bbFxAdd({ kind: 'beam', x0: a.px, y0: a.py, x1: b.px, y1: b.py, t0, dur: 520, col: BB_C.heal });
    bbAnimKick();
    BB.heal = false;
    bbFire(sel.id, tgt.id);
    return;
  }

  // клик по своему кораблю — выбрать
  if (tgt && tgt.mine) {
    BB.sel = (BB.sel === tgt.id ? null : tgt.id);
    BB.heal = false;
    BB.mod = null;
    BB.reach = null;
    bbRender();
    return;
  }
  if (!sel) return;
  // союзный корабль (та же сторона, чужая фракция) вне режима ремонта — не цель
  if (tgt && tgt.side === s.my_side) {
    toast(bbHasHeal(sel) ? 'Это союзник. Нажмите «🛠 Ремонт нано-роем», потом кликните по нему' : 'Это союзник — по своим не стреляем', 'err');
    return;
  }

  const noActs = !sel.acted && !(s.acts_left > 0);

  // клик по врагу — огонь (дальность/линию огня/захват проверяем до сервера)
  if (tgt && !tgt.mine) {
    if (!bbCanFire(sel)) { toast(`На залп нужно ${(+sel.fire_cost).toFixed(1)} c, а у «${sel.name}» осталось ${(+sel.tp).toFixed(1)} c`, 'err'); return; }
    if (noActs) { toast(`Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей`, 'err'); return; }
    const h = bbCanHit(sel, tgt);
    if (!h.ok) { toast(h.why, 'err'); return; }
    const a = bbHexCenter(sel.x, sel.y), b = bbHexCenter(tgt.x, tgt.y);
    const t0 = performance.now();
    bbFxAdd({ kind: 'flash', px: a.px, py: a.py, t0, dur: 240, col: BB_C.mine });
    bbFxAdd({ kind: 'beam', x0: a.px, y0: a.py, x1: b.px, y1: b.py,
              t0, dur: 380, col: BB_C.mine, head: true });
    bbAnimKick();
    bbFire(sel.id, tgt.id);
    return;
  }
  // клик по пустому гексу — лететь по маршруту из BFS
  if (!tgt) {
    if (bbSteps(sel) < 1) { toast(`У «${sel.name}» не осталось секунд на манёвр`, 'err'); return; }
    if (noActs) { toast(`Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей`, 'err'); return; }
    if (!BB.reach) BB.reach = bbComputeReach(sel);
    const r = BB.reach.get(x + ':' + y);
    // Про «= N гекс» больше не пишем: длина хода зависит от того, ЧЕРЕЗ ЧТО
    // идти — по чистому полю дальше, сквозь пояс и обломки заметно ближе.
    if (!r) { toast(`«${sel.name}» туда не долетит: осталось ${(+sel.tp).toFixed(1)} c, а путь дороже`, 'err'); return; }
    bbMove(sel.id, r.path);
  }
}

// ── Действия ────────────────────────────────────────────────
// Бой снесли под тобой: новый драфт клуба и новый бот-бой УДАЛЯЮТ предыдущий
// (_fight_club.sql, _bot_roster_faction.sql). Открытая доска этого не знает и
// сыпала тостом «no such battle» на каждый клик. Ловим и гасим доску разом.
function bbGone(e) {
  const m = (e && e.message) ? String(e.message) : '';
  return /no such battle|бой не найден/i.test(m);
}
function bbShowGone() {
  bbStopPoll();
  BB.busy = false;
  const ov = document.getElementById('bb-ov');
  if (ov) ov.innerHTML = `<div class="bb-load">Этого боя больше нет — его сменил новый.`
    + `<br><button class="btn btn-gh btn-sm" style="margin-top:12px" onclick="bbClose()">Закрыть</button></div>`;
}

async function bbAct(fn, body, okMsg) {
  if (BB.busy) return;
  BB.busy = true;
  try {
    await ecRpc(fn, body);
    if (okMsg) toast(okMsg, 'ok');
    await bbReload();
  } catch (e) {
    if (bbGone(e)) { bbShowGone(); return; }
    toast((e && e.message) ? e.message : 'Не вышло', 'err');
  } finally { BB.busy = false; }
}
function bbMove(id, path) {
  // запомним точный маршрут — чтобы корабль анимировался ПО ГЕКСАМ, а не
  // по прямой из точки А в точку Б (диффу иначе виден только старт/финиш).
  if (Array.isArray(path) && path.length) BB.moveHint.set(id, { path: path.slice(), t: Date.now() });
  return bbAct('battle_move', { p_battle: BB.id, p_unit: id, p_path: path });
}
function bbLaunch(id) { return bbAct('battle_launch', { p_battle: BB.id, p_unit: id }, 'Авиакрыло в воздухе — вступит со следующего хода'); }
function bbFire(id, tid) { return bbAct('battle_fire', { p_battle: BB.id, p_unit: id, p_target: tid }); }
// Режим ремонта: следующий клик по союзному кораблю уйдёт нано-роем, а не в выбор.
function bbHealMode() { BB.heal = !BB.heal; bbRender(); }
function bbEndTurn() {
  if (!confirm('Завершить ход? Неиспользованные активации сгорят. Корабли в астероидах получат −10% корпуса, грав. колодцы подтянут ближние корабли.')) return;
  BB.sel = null; BB.reach = null;
  return bbAct('battle_end_turn', { p_battle: BB.id }, 'Ход передан противнику');
}
function bbForce() {
  if (!confirm('Прожать просроченный ход противника? Его ход сгорит, корабли не будут действовать.')) return;
  return bbAct('battle_force_turn', { p_battle: BB.id }, 'Ход противника сгорел');
}
function bbReinforce(uid) {
  const s = BB.st;
  const admin = bbAdminBot(s);
  if (!admin) {
    if (s && (s.acts_left || 0) < (s.acts_max || 6)) {
      toast('Подкрепление вызывается только свежим ходом — часть активаций уже потрачена', 'err');
      return;
    }
    if (!confirm('Вызвать подкрепление? Это потратит ВЕСЬ ваш ход — корабли в этом ходу не действуют.')) return;
  }
  BB.sel = null; BB.reach = null;
  return bbAct('battle_reinforce', { p_battle: BB.id, p_unit_id: uid, p_y: null }, 'Подкрепление вышло на позицию');
}
// Подрезать расстановку под свежий резерв. Сервер (battle_pool) — источник
// правды по «сколько кораблей реально есть»; если открытая доска отстала и в
// BB.place набито больше, чем во флоте осталось, лишние (самые поздние по
// порядку) снимаем и уведомляем игрока, чтобы «В бой» дальше шёл по факту.
function bbReconcilePlace() {
  const pool = Array.isArray(BB.st && BB.st.pool) ? BB.st.pool : [];
  const cap = {};
  pool.forEach(p => { cap[p.unit_id] = Math.max(0, Number(p.free) || 0); });
  const seen = {};
  const dropped = [];
  BB.place = BB.place.filter(p => {
    // корабль, которого в свежем резерве нет вовсе, — тоже под нож
    const limit = cap.hasOwnProperty(p.unit_id) ? cap[p.unit_id] : 0;
    const n = (seen[p.unit_id] = (seen[p.unit_id] || 0) + 1);
    if (n > limit) { dropped.push(p.unit_name || 'борт'); return false; }
    return true;
  });
  if (dropped.length) {
    if (BB.pick && !cap[BB.pick]) BB.pick = null;
    // Именно ЭТО раньше выглядело как «корабли уничтожило»: доска молча теряла
    // борта. Теперь честно называем, кого сняли и почему — сами корабли целы,
    // они остаются во флоте, снята только их метка на доске.
    toast(`Во флоте меньше кораблей, чем расставлено. С доски сняты (сами корабли целы): ${dropped.join(', ')}`, 'err');
  }
}
async function bbConfirmDeploy() {
  if (BB.busy) return;                    // защита от второго нажатия
  if (!BB.place.length) { toast('Выведите на доску хотя бы один корабль', 'err'); return; }
  const L = bbDeployLim(BB.st);
  if (L.used > L.cap) { toast(`На доску можно вывести не больше ${L.cap} кораблей, у вас ${L.used}`, 'err'); return; }
  if (L.over) { toast(`Перебор по бюджету: ${bbNum(L.spent)} из ${bbNum(L.budget)} ГС`, 'err'); return; }
  if (!confirm(`Утвердить состав из ${BB.place.length} кораблей? После подтверждения расстановку не изменить.`)) return;
  BB.busy = true;
  bbRender();                             // кнопка сразу гаснет — экран не «немой»
  try {
    await ecRpc('battle_deploy', { p_battle: BB.id, p_units: BB.place.map(p => ({ unit_id: p.unit_id, unit_name: p.unit_name, x: p.x, y: p.y })) });
    await ecRpc('battle_ready', { p_battle: BB.id });
    toast('Состав утверждён', 'ok');
    BB.place = []; BB.pick = null;
    BB.camReady = false;         // из зоны спавна камера вернётся к своим бортам
    await bbReload();
  } catch (e) {
    toast((e && e.message) ? e.message : 'Не вышло', 'err');
    // Частая причина отказа — устаревший резерв: доска висела открытой, а
    // состав флота тем временем уменьшился (потери в параллельном бою,
    // роспуск/редакт флота, второй таб). Сервер пересчитал free по свежему
    // составу и отбил лишние корабли. Перечитываем состояние и подрезаем
    // расстановку под реальный резерв, чтобы клиент не остался со старыми
    // числами и следующая попытка «В бой» шла по актуальным данным.
    await bbReload().catch(() => {});
    bbReconcilePlace();
  } finally {
    // Снимаем busy ДО перерисовки и делаем это в finally по любому исходу:
    // пока BB.busy true, bbClick не принимает ни одного клика — именно так
    // экран и «зависал», если запрос отваливался не по-человечески.
    BB.busy = false;
    bbRender();
  }
}

// ════════════════════════════════════════════════════════════
// АНИМАЦИЯ: скольжение кораблей между гексами + эффекты боя.
// Кадр рисуется обычным bbPaint(); пока есть активные твины/эффекты —
// крутим rAF-цикл, по завершении отрисовываем финальный статичный кадр.
// ════════════════════════════════════════════════════════════
function bbEase(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function bbLerp(a, b, t) { return a + (b - a) * t; }
// Кратчайшая интерполяция угла (курс поворачивает в «ближнюю» сторону)
function bbLerpAng(a, b, t) {
  let d = ((b - a) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}
function bbFxAdd(fx) {
  // искры/обломки для взрыва/попадания — заранее, чтобы разлёт был детерминирован
  if (fx.kind === 'boom' || fx.kind === 'hit') {
    const boom = fx.kind === 'boom';
    const n = boom ? 20 : 8;
    fx.spark = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832, sp = (boom ? 1.2 : 0.7) * (0.35 + Math.random());
      fx.spark.push({ a, sp, r: 0.35 + Math.random() * 0.6, hot: Math.random() < 0.5 });
    }
    if (boom) {
      // тяжёлые обломки — летят дальше, кувыркаются и гаснут медленнее искр
      fx.debris = [];
      const dn = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < dn; i++)
        fx.debris.push({ a: Math.random() * 6.2832, sp: 0.5 + Math.random() * 0.9,
                         r: 0.5 + Math.random() * 0.7, rot: Math.random() * 6.2832,
                         spin: (Math.random() - 0.5) * 0.6 });
    }
  }
  BB.anim.fx.push(fx);
}
function bbAnimKick() {
  if (BB.anim.raf) return;
  BB.anim.raf = requestAnimationFrame(bbAnimTick);
}
function bbAnimTick() {
  BB.anim.raf = 0;
  const now = performance.now();
  // снять завершённые перемещения
  BB.anim.move.forEach((m, id) => { if (now - m.t0 >= m.dur) BB.anim.move.delete(id); });
  // снять погасшие эффекты
  BB.anim.fx = BB.anim.fx.filter(f => now - f.t0 < f.dur);
  // доворот+зум камеры к действиям противника (интерполируем центр обзора)
  const ca = BB.camAnim;
  if (ca) {
    const t = bbEase(Math.min(1, (now - ca.t0) / ca.dur));
    const z = bbLerp(ca.z0, ca.z1, t);
    const cx = bbLerp(ca.cx0, ca.cx1, t), cy = bbLerp(ca.cy0, ca.cy1, t);
    BB.zoom = z;
    BB.camX = cx - BB.vw / z / 2;
    BB.camY = cy - BB.vh / z / 2;
    bbCamClamp();
    if (t >= 1) BB.camAnim = null;
  }
  bbPaint();
  if (BB.anim.move.size || BB.anim.fx.length || BB.camAnim) bbAnimKick();
}
// Собрать твин перемещения ПО МАРШРУТУ: список гексов (свой ход — точный из
// moveHint, чужой — реконструкция bbHexLine), из них — ломаная центров, длины
// сегментов (для равномерной скорости) и курс на каждой вершине (плавный
// доворот носа в поворотах).
function bbBuildMove(p, u) {
  let hexes = null;
  const hint = BB.moveHint.get(u.id);
  if (hint && Array.isArray(hint.path) && hint.path.length && Date.now() - hint.t < 20000) {
    const last = hint.path[hint.path.length - 1];
    if (last && last.x === u.x && last.y === u.y) hexes = hint.path;
  }
  BB.moveHint.delete(u.id);
  if (!hexes) hexes = bbHexLine(p, u);
  if (!hexes.length) return null;
  // вершины ломаной: старт + все гексы маршрута
  const verts = [{ x: p.x, y: p.y }].concat(hexes.map(h => ({ x: h.x, y: h.y })));
  const pts = verts.map(v => bbHexCenter(v.x, v.y));
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].px - pts[i].px, dy = pts[i + 1].py - pts[i].py;
    const len = Math.hypot(dx, dy) || 1;
    seg.push({ len, ang: Math.atan2(dy, dx) });
    total += len;
  }
  // курс на вершинах: старт — куда поедет, повороты — среднее соседних сегментов,
  // финиш — итоговый facing с сервера
  const angs = new Array(pts.length);
  angs[0] = seg[0].ang;
  for (let i = 1; i < seg.length; i++) angs[i] = bbLerpAng(seg[i - 1].ang, seg[i].ang, 0.5);
  angs[pts.length - 1] = bbDirAngle(u.facing || 0);
  const n = seg.length;
  return { pts, seg, angs, total, t0: performance.now(),
           dur: Math.min(1100, 240 + 170 * n) };
}
// Экранный (мировой) центр корабля с учётом активного перемещения.
function bbUnitCenter(u) {
  const m = u.id != null ? BB.anim.move.get(u.id) : null;
  if (!m) { const c = bbHexCenter(u.x, u.y); return { px: c.px, py: c.py, ang: bbDirAngle(u.facing || 0) }; }
  // старый формат (прямой лерп) — на случай незавершённых твинов
  if (m.pts) {
    const t = bbEase(Math.min(1, (performance.now() - m.t0) / m.dur));
    const target = t * m.total;
    let acc = 0, i = 0;
    while (i < m.seg.length - 1 && acc + m.seg[i].len < target) { acc += m.seg[i].len; i++; }
    const segT = m.seg[i].len ? (target - acc) / m.seg[i].len : 0;
    const A = m.pts[i], B = m.pts[i + 1];
    return { px: bbLerp(A.px, B.px, segT), py: bbLerp(A.py, B.py, segT),
             ang: bbLerpAng(m.angs[i], m.angs[i + 1], segT) };
  }
  const t = bbEase(Math.min(1, (performance.now() - m.t0) / m.dur));
  const a = bbHexCenter(m.x0, m.y0), b = bbHexCenter(m.x1, m.y1);
  return { px: bbLerp(a.px, b.px, t), py: bbLerp(a.py, b.py, t),
           ang: bbLerpAng(bbDirAngle(m.f0), bbDirAngle(m.f1), t) };
}

// Эффекты боя поверх кораблей (в мировых координатах).
function bbPaintFx(ctx) {
  const now = performance.now(), R = BB.R, iz = 1 / BB.zoom;
  BB.anim.fx.forEach(f => {
    const raw = (now - f.t0) / f.dur;
    if (raw < 0) return;                 // отложенный эффект ещё не начался
    const t = Math.min(1, raw), a = 1 - t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    if (f.kind === 'beam') {
      // трассер: широкое свечение + яркое ядро + добела раскалённая нить,
      // и летящая «болванка» с коротким хвостом — виден сам выстрел, не мазок.
      ctx.strokeStyle = `rgba(${f.col},${0.18 * a})`;
      ctx.lineWidth = Math.max(3, 7 * iz);
      ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
      ctx.strokeStyle = `rgba(${f.col},${0.9 * a})`;
      ctx.lineWidth = Math.max(1.4, (2 + 2 * a) * iz);
      ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * a})`;
      ctx.lineWidth = Math.max(0.5, iz);
      ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
      if (f.head) {
        const ht = Math.min(1, t * 1.25);        // снаряд добегает чуть раньше угасания
        const hx = bbLerp(f.x0, f.x1, ht), hy = bbLerp(f.y0, f.y1, ht);
        const bt = Math.max(0, ht - 0.12);
        const tx = bbLerp(f.x0, f.x1, bt), ty = bbLerp(f.y0, f.y1, bt);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(1.5, 3 * iz);
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.32);
        hg.addColorStop(0, 'rgba(255,255,255,0.95)');
        hg.addColorStop(0.5, `rgba(${f.col},0.6)`);
        hg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(hx, hy, R * 0.32, 0, 6.2832); ctx.fill();
      }
    } else if (f.kind === 'flash') {
      // дульная вспышка у стрелка: яркое ядро + быстрое кольцо
      const gr = R * (0.2 + t * 0.55);
      const g = ctx.createRadialGradient(f.px, f.py, 0, f.px, f.py, gr);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * a})`);
      g.addColorStop(0.4, `rgba(${f.col},${0.5 * a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.px, f.py, gr, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = `rgba(${f.col},${0.5 * a})`;
      ctx.lineWidth = Math.max(0.5, 1.2 * a * iz);
      ctx.beginPath(); ctx.arc(f.px, f.py, gr * 0.9, 0, 6.2832); ctx.stroke();
    } else {
      // hit / boom: добела раскалённое ядро → огненный шар, ударные волны,
      // веер искр и (у взрыва) кувыркающиеся обломки.
      const boom = f.kind === 'boom';
      const grow = boom ? R * (0.5 + t * 1.35) : R * (0.28 + t * 0.6);
      const g = ctx.createRadialGradient(f.px, f.py, 0, f.px, f.py, grow);
      g.addColorStop(0, `rgba(255,255,255,${(boom ? 0.75 : 0.6) * a})`);
      g.addColorStop(0.3, `rgba(${f.col},${0.5 * a})`);
      g.addColorStop(0.7, `rgba(${f.col},${0.18 * a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.px, f.py, grow, 0, 6.2832); ctx.fill();
      if (boom) {
        ctx.strokeStyle = `rgba(255,240,200,${0.7 * a})`;
        ctx.lineWidth = Math.max(0.6, 2 * a * iz);
        ctx.beginPath(); ctx.arc(f.px, f.py, grow * 0.95, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = `rgba(255,180,120,${0.4 * a})`;
        ctx.lineWidth = Math.max(0.4, 1.2 * a * iz);
        ctx.beginPath(); ctx.arc(f.px, f.py, R * (0.3 + t * 1.9), 0, 6.2832); ctx.stroke();
      }
      // искры (аддитивно)
      (f.spark || []).forEach(s => {
        const d = grow * (0.5 + s.sp * t);
        const sx = f.px + Math.cos(s.a) * d, sy = f.py + Math.sin(s.a) * d;
        ctx.fillStyle = s.hot ? `rgba(255,255,235,${a})` : `rgba(255,205,150,${a})`;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.6, s.r * R * 0.14 * a), 0, 6.2832); ctx.fill();
      });
      // обломки — твёрдые тёмные осколки (обычным режимом, поверх свечения)
      if (boom && f.debris) {
        ctx.globalCompositeOperation = 'source-over';
        f.debris.forEach(d => {
          const dist = grow * (0.6 + d.sp * t);
          const dx = f.px + Math.cos(d.a) * dist, dy = f.py + Math.sin(d.a) * dist;
          const sz = Math.max(0.8, d.r * R * 0.16) * (1 - 0.4 * t);
          ctx.save();
          ctx.translate(dx, dy); ctx.rotate(d.rot + d.spin * t * 6);
          ctx.fillStyle = `rgba(66,70,80,${0.85 * a})`;
          ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
          ctx.strokeStyle = `rgba(200,150,110,${0.5 * a})`;
          ctx.lineWidth = Math.max(0.3, 0.5 * iz);
          ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        });
      }
    }
    ctx.restore();
  });
}

// ════════════════════════════════════════════════════════════
// РЕНДЕР: статичный кадр (поверх — активные твины/эффекты боя)
// ════════════════════════════════════════════════════════════
function bbPaint() {
  // Кадр собирает 3D-сцена — она уже стоит, ей достаточно пометки «перерисовать».
  if (BB.glOn) { bgPaint(); return; }
  const s = BB.st, ctx = BB.ctx; if (!s || !ctx) return;

  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);
  ctx.clearRect(0, 0, BB.vw, BB.vh);
  bbPaintSpace(ctx, s, BB.vw, BB.vh);

  const z = BB.zoom;
  ctx.setTransform(BB.dpr * z, 0, 0, BB.dpr * z, -BB.camX * BB.dpr * z, -BB.camY * BB.dpr * z);
  bbPaintHexes(ctx, s);
  bbPaintTerrain(ctx, s);
  bbPaintHighlights(ctx, s);
  bbPaintUnits(ctx, s);
  bbPaintFx(ctx);

  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);
  bbPaintScan(ctx, BB.vw, BB.vh);
  bbPaintSeam(ctx, s);
}

// ── «Шов» цели: при наведении на вражеский борт показываем стойкости брони
// по каналам урона и подсвечиваем самый слабый — куда нести правильный лом.
// Броня видна лишь когда контакт захвачен радаром (сервер даёт u.resist).
// Если выбран свой корабль — отмечаем каналы, по которым твои орудия бьют.
const BB_SEAM_ORD = ['kinetic', 'energy', 'missile'];
function bbSeamOwnKinds(s) {
  const sel = s && s.units && BB.sel != null ? s.units.find(u => u.id === BB.sel && u.mine) : null;
  if (!sel || !sel.wpn) return null;
  const set = new Set();
  sel.wpn.forEach(g => set.add(g.k || 'kinetic'));
  return set;
}
function bbPaintSeam(ctx, s) {
  if (!BB.hover || !s || !s.units) return;
  // захваченный радаром вражеский борт (у него в state есть броня/стойкости)
  const t = s.units.find(u => u.x === BB.hover.x && u.y === BB.hover.y && !u.mine && u.locked);
  if (!t) return;
  const rs = t.resist || {};
  // каналы показываем всегда (даже когда стойкостей нет — тогда по 0%)
  const rows = BB_SEAM_ORD.map(k => ({ k, v: +(rs[k] || 0) }));
  const seam = rows.reduce((a, b) => (b.v < a.v ? b : a));            // самый слабый канал
  const own = bbSeamOwnKinds(s);

  // обычная броня цели (плоское гашение урона) — показываем всегда, чтобы
  // окошко не читалось как «брони нет», когда нули лишь у ТИПОВЫХ стойкостей.
  const armor = Math.max(0, Math.round(+t.armor || 0));

  const { px, py } = bbHexCenter(t.x, t.y);
  const sx = (px - BB.camX) * BB.zoom, sy = (py - BB.camY) * BB.zoom;
  const pad = 8, lh = 17, fs = 12;
  const w = 150, h = pad * 2 + 16 + lh + rows.length * lh;
  let x = sx + BB.R * BB.zoom * 0.6, y = sy - h / 2;
  x = Math.max(6, Math.min(BB.vw - w - 6, x));
  y = Math.max(6, Math.min(BB.vh - h - 6, y));

  ctx.save();
  ctx.fillStyle = 'rgba(6,10,18,0.94)';
  ctx.strokeStyle = 'rgba(90,200,230,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.font = `${fs}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = `rgba(${BB_C.foe},0.9)`;
  ctx.fillText('Броня цели', x + pad, y + pad + 8);
  // строка обычной брони
  const ay = y + pad + 16 + lh / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(230,240,250,0.92)';
  ctx.fillText('броня', x + pad, ay);
  ctx.textAlign = 'right';
  ctx.fillStyle = armor > 0 ? 'rgba(230,240,250,0.92)' : 'rgba(150,165,180,0.6)';
  ctx.fillText(armor.toLocaleString('ru-RU'), x + w - pad, ay);
  // ниже — типовые стойкости сплава (в % по каналам урона)
  rows.forEach((r, i) => {
    const ry = y + pad + 16 + lh + i * lh + lh / 2;
    const hit = own && own.has(r.k);
    const isSeam = r.k === seam.k;
    // канал: подсвечен если это шов; тускло если твои пушки по нему не бьют
    ctx.fillStyle = isSeam ? '#ffd15c' : (hit ? 'rgba(230,240,250,0.92)' : 'rgba(150,165,180,0.6)');
    ctx.textAlign = 'left';
    ctx.fillText((hit ? '▸ ' : '  ') + bbKindLabel(r.k), x + pad, ry);
    // значение стойкости: <0 = уязвим (зелёный бонус), >0 = держит (красный)
    ctx.textAlign = 'right';
    ctx.fillStyle = r.v < 0 ? '#6be27a' : (r.v > 0 ? `rgba(${BB_C.foe},0.85)` : 'rgba(200,210,220,0.7)');
    const pv = (r.v > 0 ? '+' : '') + Math.round(r.v * 100) + '%';
    ctx.fillText(pv, x + w - pad, ry);
  });
  ctx.restore();
}

function bbVisibleCells(s) {
  const R = BB.R;
  const x0 = Math.max(0, Math.floor((BB.camX - 2 * R) / (R * 1.5)));
  const x1 = Math.min(s.w - 1, Math.ceil((BB.camX + BB.vw / BB.zoom) / (R * 1.5)));
  const y0 = Math.max(0, Math.floor((BB.camY - 2 * R) / (R * BB_SQ3)) - 1);
  const y1 = Math.min(s.h - 1, Math.ceil((BB.camY + BB.vh / BB.zoom) / (R * BB_SQ3)) + 1);
  return { x0, x1, y0, y1 };
}

// ── КОСМОС: чистая пустота — тёмный задник без звёзд, доска важнее ──
function bbPaintSpace(ctx, s, W, H) {
  ctx.fillStyle = '#020409'; ctx.fillRect(0, 0, W, H);
  // лёгкий провал глубины к центру — объём без «звёздного неба»
  const d = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  d.addColorStop(0, 'rgba(12,20,32,0.55)'); d.addColorStop(1, 'rgba(2,4,9,0)');
  ctx.fillStyle = d; ctx.fillRect(0, 0, W, H);
  // виньетка — прижимает края
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ── СОТЫ ────────────────────────────────────────────────────
function bbPaintHexes(ctx, s) {
  const R = BB.R, { x0, x1, y0, y1 } = bbVisibleCells(s);
  const meAtt = s.my_side === 'attacker';
  const z = s.zone || 3;
  const lw = Math.max(0.6, 1 / BB.zoom);
  const hasSp = !!(s.spawn);
  for (let x = x0; x <= x1; x++) {
    // легаси-бой (секторов нет) красит зоны колонками, как раньше
    const colZone = hasSp ? null : (x < z ? 'att' : (x >= s.w - z ? 'def' : null));
    for (let y = y0; y <= y1; y++) {
      if (!bbInArena(x, y)) continue;          // за кромкой арены сот нет
      const zoneCol = hasSp
        ? (bbInSpawn('att', x, y) ? 'att' : (bbInSpawn('def', x, y) ? 'def' : null))
        : colZone;
      const zoneRgb = zoneCol ? (zoneCol === 'att' ? (meAtt ? BB_C.mine : BB_C.foe) : (meAtt ? BB_C.foe : BB_C.mine)) : null;
      const c = bbHexCenter(x, y);
      bbHexPath(ctx, c.px, c.py, R * 0.96);
      ctx.fillStyle = zoneRgb ? `rgba(${zoneRgb},0.06)` : BB_C.hexIn;
      ctx.fill();
      ctx.strokeStyle = zoneRgb ? `rgba(${zoneRgb},0.28)` : BB_C.hex;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }
  if (BB.hover) {
    const c = bbHexCenter(BB.hover.x, BB.hover.y);
    bbHexPath(ctx, c.px, c.py, R * 0.92);
    ctx.strokeStyle = 'rgba(140,240,255,0.6)'; ctx.lineWidth = lw * 1.8;
    ctx.stroke();
  }
}

// ── ЛАНДШАФТ: астероиды / туманности / колодцы / обломки ────
function bbPaintTerrain(ctx, s) {
  const R = BB.R, { x0, x1, y0, y1 } = bbVisibleCells(s);
  BB.terr && BB.terr.forEach((t, key) => {
    const [x, y] = key.split(':').map(Number);
    if (x < x0 || x > x1 || y < y0 || y > y1) return;
    const c = bbHexCenter(x, y);
    // детермин. «случайность» от координат — рисунок не мигает между кадрами
    const rnd = k => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5; return v - Math.floor(v); };
    if (t === 'ast') {
      // Россыпь каменных глыб — как пояс на карте: серый камень со светотенью,
      // неправильная форма, тёмная теневая сторона, тонкий рим-свет сверху.
      const rocks = 5 + Math.floor(rnd(20) * 2);
      for (let i = 0; i < rocks; i++) {
        const ax = c.px + (rnd(i) - 0.5) * R * 1.15, ay = c.py + (rnd(i + 9) - 0.5) * R * 1.15;
        const ar = R * (0.14 + rnd(i + 4) * 0.2);
        const sh = 0.62 + rnd(i + 5) * 0.35;    // тон камня
        // неправильный многоугольник
        ctx.beginPath();
        const segs = 7;
        for (let j = 0; j <= segs; j++) {
          const a = (j / segs) * 6.2832;
          const rr = ar * (0.72 + rnd(i * 13 + j) * 0.5);
          const px = ax + Math.cos(a) * rr, py = ay + Math.sin(a) * rr;
          j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        const g = ctx.createRadialGradient(ax - ar * 0.4, ay - ar * 0.5, ar * 0.1, ax, ay, ar * 1.3);
        const lum = k => Math.round(k * (120 * sh));
        g.addColorStop(0, `rgb(${lum(1.35)},${lum(1.42)},${lum(1.5)})`);
        g.addColorStop(0.6, `rgb(${lum(0.9)},${lum(0.95)},${lum(1.02)})`);
        g.addColorStop(1, `rgb(${lum(0.4)},${lum(0.42)},${lum(0.48)})`);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = Math.max(0.4, 0.7 / BB.zoom); ctx.stroke();
        // рим-свет по верхней кромке
        ctx.strokeStyle = 'rgba(200,214,226,0.3)'; ctx.lineWidth = Math.max(0.3, 0.5 / BB.zoom);
        ctx.beginPath(); ctx.arc(ax, ay, ar * 0.85, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
      }
    } else if (t === 'neb') {
      const g = ctx.createRadialGradient(c.px, c.py, 0, c.px, c.py, R * 1.15);
      g.addColorStop(0, 'rgba(150,90,220,0.28)'); g.addColorStop(1, 'rgba(150,90,220,0.02)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.px, c.py, R * 1.15, 0, 6.2832); ctx.fill();
    } else if (t === 'grv') {
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.arc(c.px, c.py, R * 0.28 * i, 0, 6.2832);
        ctx.strokeStyle = `rgba(140,220,255,${0.4 - i * 0.1})`;
        ctx.lineWidth = Math.max(0.5, 1 / BB.zoom);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(c.px, c.py, R * 0.14, 0, 6.2832);
      ctx.fillStyle = 'rgba(10,14,22,0.95)'; ctx.fill();
      ctx.strokeStyle = 'rgba(140,220,255,0.8)'; ctx.lineWidth = Math.max(0.5, 1 / BB.zoom); ctx.stroke();
    } else if (t === 'deb') {
      // Поле обломков: угловатые куски корпусной обшивки — тёмный металл
      // с холодным кромочным бликом, редкие искры-заклёпки.
      for (let i = 0; i < 5; i++) {
        const ax = c.px + (rnd(i) - 0.5) * R * 1.25, ay = c.py + (rnd(i + 7) - 0.5) * R * 1.25;
        const rot = rnd(i + 3) * 6.2832, sz = R * (0.12 + rnd(i + 4) * 0.14);
        const co = Math.cos(rot), si = Math.sin(rot);
        // рваный четырёхугольник обшивки
        const pts = [[-1, -0.5], [1.1, -0.35], [0.7, 0.6], [-0.9, 0.45]];
        ctx.beginPath();
        pts.forEach((p, j) => {
          const px = ax + (p[0] * co - p[1] * si) * sz, py = ay + (p[0] * si + p[1] * co) * sz;
          j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath();
        const g = ctx.createLinearGradient(ax - sz, ay - sz, ax + sz, ay + sz);
        g.addColorStop(0, 'rgba(88,100,112,0.9)'); g.addColorStop(1, 'rgba(26,32,40,0.9)');
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(150,190,210,0.5)'; ctx.lineWidth = Math.max(0.4, 0.7 / BB.zoom); ctx.stroke();
      }
      // искры-осколки
      for (let i = 0; i < 3; i++) {
        const ax = c.px + (rnd(i + 11) - 0.5) * R * 1.4, ay = c.py + (rnd(i + 15) - 0.5) * R * 1.4;
        ctx.fillStyle = 'rgba(180,200,215,0.5)';
        ctx.beginPath(); ctx.arc(ax, ay, Math.max(0.5, R * 0.03), 0, 6.2832); ctx.fill();
      }
    }
  });
}

// ── Подсветка: маршруты BFS + цели по дальности огневых групп ──
// 2D-фолбэк рисует тот же слой покрытия, что и 3D: механика одна, вид один.
// Клеточных плашек тут больше нет: покрытие пишется в маленький буфер (пиксель
// на гекс) и растягивается на доску с размытием — тьма получается облаком, а не
// мозаикой. Буфер держим до следующего снимка: пересобирать его на каждый
// сдвиг курсора незачем.
function bbCovBuf(s, cov) {
  const c = BB._covBuf;
  if (c && c.cov === cov && c.w === s.w && c.h === s.h) return c;
  const cv = document.createElement('canvas');
  cv.width = s.w; cv.height = s.h;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(s.w, s.h);
  for (let x = 0; x < s.w; x++) {
    for (let y = 0; y < s.h; y++) {
      const i = (y * s.w + x) * 4;
      if (!bbInArena(x, y)) continue;
      const k = x + ':' + y;
      // контр-РЭБ своим цветом не рисуем — она просто снимает помеху
      if (!cov.lit.has(k)) { img.data[i] = 3; img.data[i + 1] = 5; img.data[i + 2] = 11; img.data[i + 3] = 190; }
      else if (cov.jam.has(k) && !cov.dejam.has(k)) { img.data[i] = 216; img.data[i + 1] = 82; img.data[i + 2] = 128; img.data[i + 3] = 30; }
    }
  }
  cx.putImageData(img, 0, 0);
  return (BB._covBuf = { cov, w: s.w, h: s.h, cv });
}

function bbPaintCoverage(ctx, s) {
  if (!BB.fog || s.status === 'forming') return;
  const cov = bbCoverage(); if (!cov) return;
  const R = BB.R, buf = bbCovBuf(s, cov);
  // буфер кладём по сетке центров: первый пиксель = центр клетки (0,0)
  const x0 = R * 0.25, y0 = 0;
  const w = R * 1.5 * s.w, h = R * BB_SQ3 * s.h;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // размытие canvas-фильтра считается в экранных пикселях — множим на зум
  try { ctx.filter = 'blur(' + Math.min(24, Math.max(1, R * 0.45 * (BB.zoom || 1))) + 'px)'; } catch (e) {}
  ctx.drawImage(buf.cv, x0, y0, w, h);
  ctx.restore();

  // Шкалы дальности своих сенсоров — то же, что рисует шейдер в 3D: без них
  // затемнение читается ландшафтом, а не зоной радаров.
  // Только у ВЫБРАННОГО борта: кольца всех своих разом сливались в месиво.
  const su = (s.units || []).find(u => u.id === BB.sel && (u.mine || u.side === s.my_side));
  if (su) {
    ctx.save();
    ctx.lineWidth = Math.max(0.5, 1 / BB.zoom);
    // одно пунктирное кольцо предела, зелёным — цианом оно спорило с кольцами орудий
    ctx.strokeStyle = 'rgba(150,235,120,.42)';
    ctx.setLineDash([6 / BB.zoom, 5 / BB.zoom]);
    const c = bbHexCenter(su.x, su.y), rng = bbRadarR(su) * R * 1.5;
    ctx.beginPath(); ctx.arc(c.px, c.py, rng, 0, 6.2832); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function bbPaintHighlights(ctx, s) {
  if (s.status === 'forming') return;
  bbPaintCoverage(ctx, s);
  const sel = (s.units || []).find(u => u.id === BB.sel);
  if (!sel || !s.my_turn) return;
  const R = BB.R;
  const canAct = sel.acted || s.acts_left > 0;

  // кольца дальностей выбранного корабля — видно, с какой дистанции что бьёт
  bbPaintArcs(ctx, sel);

  // гексы хода — досягаемость по скорости
  if (bbSteps(sel) > 0 && canAct) {
    if (!BB.reach) BB.reach = bbComputeReach(sel);
    BB.reach.forEach((r, key) => {
      const [x, y] = key.split(':').map(Number);
      const c = bbHexCenter(x, y);
      bbHexPath(ctx, c.px, c.py, R * 0.82);
      ctx.fillStyle = BB_C.move; ctx.fill();
    });
    // превью манёвра: наведён гекс маршрута — рисуем путь
    if (BB.hover) {
      const r = BB.reach.get(BB.hover.x + ':' + BB.hover.y);
      if (r) bbPaintMovePreview(ctx, sel, r);
    }
  }
  // цели: полные данные + достаёт ли хоть одна группа + линия огня
  if (bbCanFire(sel) && canAct) {
    (s.units || []).forEach(u => {
      if (u.mine || u.side === s.my_side) return;
      const h = bbCanHit(sel, u);
      if (!h.ok) return;
      const c = bbHexCenter(u.x, u.y);
      bbHexPath(ctx, c.px, c.py, R * 0.9);
      ctx.fillStyle = BB_C.fire; ctx.fill();
      bbHexPath(ctx, c.px, c.py, R * 0.9);
      ctx.strokeStyle = BB_C.fireEdge; ctx.lineWidth = Math.max(0.6, 1.4 / BB.zoom);
      ctx.stroke();
    });
  }
  // режим ремонта: подсвечиваем СОЮЗНИКОВ, до которых добрасывает нано-рой
  if (BB.heal && bbCanFire(sel) && canAct) {
    (s.units || []).forEach(u => {
      if (u.side !== s.my_side || !bbCanHeal(sel, u).ok) return;
      const c = bbHexCenter(u.x, u.y);
      bbHexPath(ctx, c.px, c.py, R * 0.9);
      ctx.fillStyle = BB_C.healZone; ctx.fill();
      bbHexPath(ctx, c.px, c.py, R * 0.9);
      ctx.strokeStyle = 'rgba(' + BB_C.heal + ',0.55)'; ctx.lineWidth = Math.max(0.6, 1.4 / BB.zoom);
      ctx.stroke();
    });
  }
}

// Дальности огневых групп: по кольцу на каждую отдельную дальность.
// Читается сразу: пересёк кольцо — включилась ещё одна группа. Самое
// ближнее кольцо ярче — там отрабатывает весь борт.
// Радиус ≈ дальность в гексах (шаг гекса ≈ R·1.5).
function bbPaintArcs(ctx, sel) {
  const R = BB.R;
  const gs = (sel.wpn && sel.wpn.length) ? sel.wpn : [{ rng: sel.rng, dmg: sel.dmg }];
  const rings = [...new Set(gs.map(g => bbGrpRng(g, sel)))].sort((a, b) => a - b);
  if (!rings.length) return;
  // Рубеж полного урона: за ним залп начинает слабеть. Пунктиром, чтобы не
  // спутать с границей досягаемости — сплошная линия по-прежнему «дальше никак».
  const opts = [...new Set(gs.filter(g => !bbIsHeal(g)).map(g => {
    const rng = bbGrpRng(g, sel);
    const o = Math.max(1, Math.floor(rng * (g.opt != null ? +g.opt
                : (BBW_OPT[g.k] != null ? BBW_OPT[g.k] : 1))));
    return o < rng ? o : 0;                    // плоский профиль рубежа не имеет
  }).filter(Boolean))];
  const { px: cx, py: cy } = bbHexCenter(sel.x, sel.y);
  ctx.save();
  ctx.lineWidth = Math.max(0.6, 1 / BB.zoom);
  rings.forEach((rng, i) => {
    const inner = i === 0;
    ctx.beginPath();
    ctx.arc(cx, cy, rng * R * 1.5, 0, 6.2832);
    if (inner) { ctx.fillStyle = 'rgba(150,240,255,0.05)'; ctx.fill(); }
    ctx.strokeStyle = `rgba(150,240,255,${inner ? 0.32 : 0.16})`;
    ctx.stroke();
  });
  ctx.setLineDash([4 / BB.zoom, 4 / BB.zoom]);
  ctx.strokeStyle = 'rgba(255,210,140,0.30)';
  opts.forEach(o => {
    ctx.beginPath();
    ctx.arc(cx, cy, o * R * 1.5, 0, 6.2832);
    ctx.stroke();
  });
  ctx.restore();
}

// Превью манёвра: линия маршрута и точки шагов. Курс на правила не влияет,
// поэтому финальный «нос» больше не рисуем.
function bbPaintMovePreview(ctx, sel, r) {
  const R = BB.R, col = BB_C.mine;
  const pts = [{ x: sel.x, y: sel.y }].concat(r.path || []);
  // линия маршрута
  ctx.save();
  ctx.strokeStyle = `rgba(${col},0.85)`;
  ctx.lineWidth = Math.max(1.4, 2.4 / BB.zoom);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.setLineDash([6 / BB.zoom, 5 / BB.zoom]);
  ctx.beginPath();
  pts.forEach((p, i) => { const c = bbHexCenter(p.x, p.y); i ? ctx.lineTo(c.px, c.py) : ctx.moveTo(c.px, c.py); });
  ctx.stroke();
  ctx.setLineDash([]);
  // узловые точки поворота
  ctx.fillStyle = `rgba(${col},0.7)`;
  pts.forEach((p, i) => {
    if (!i) return;
    const c = bbHexCenter(p.x, p.y);
    ctx.beginPath(); ctx.arc(c.px, c.py, Math.max(1.6, 2.2 / BB.zoom), 0, 6.2832); ctx.fill();
  });
  // гекс назначения — кольцо, чтобы конец маршрута читался
  const d = bbHexCenter(BB.hover.x, BB.hover.y);
  ctx.beginPath();
  ctx.arc(d.px, d.py, R * 0.5, 0, 6.2832);
  ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = Math.max(1, 1.8 / BB.zoom);
  ctx.stroke();
  ctx.restore();
}

// Курс по стороне: нападающий пришёл слева → смотрит вправо (0), защитник
// справа → влево (3). На расстановке никто ещё не маневрировал, поэтому курс
// однозначно задаётся стороной — не полагаемся на facing с сервера.
function bbSideFacing(side) { return side === 'defender' ? 3 : 0; }
function bbPaintUnits(ctx, s) {
  const forming = s.status === 'forming';
  if (forming) {
    const defFacing = bbSideFacing(s.my_side);
    BB.place.forEach(p => bbShip(ctx, { x: p.x, y: p.y, cls: p.cls, name: p.unit_name, mine: true, facing: defFacing, hp: 1, max_hp: 1, shield: 0, max_shield: 0 }, 0.55));
  }
  (s.units || []).forEach(u => {
    if (u.contact) { bbContact(ctx, u); return; }
    const spent = u.mine && s.my_turn && ((+u.tp) <= 0.05 || (!u.acted && !(s.acts_left > 0)));
    // Курс по стороне форсируем для ВСЕХ бортов, которые ещё НЕ маневрировали
    // (вся расстановка + свежевыведенные в бой корабли): флоты смотрят навстречу,
    // даже если сервер проставил facing в другую сторону. Как только корабль
    // реально сходил (u.moved) — доверяем настоящему курсу с сервера.
    const uu = (forming || !u.moved) ? Object.assign({}, u, { facing: bbSideFacing(u.side) }) : u;
    bbShip(ctx, uu, spent ? 0.5 : 1);
  });
}

// Неопознанный контакт: тусклый ромб-отметка на радаре, без ТТХ.
function bbContact(ctx, u) {
  const { px: cx, py: cy } = bbHexCenter(u.x, u.y);
  const r = BB.R * 0.34;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fillStyle = `rgba(${BB_C.foe},0.14)`; ctx.fill();
  ctx.strokeStyle = `rgba(${BB_C.foe},0.65)`; ctx.lineWidth = Math.max(0.8, 1.4 / BB.zoom);
  ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = `rgba(${BB_C.foe},0.85)`;
  ctx.font = `${Math.round(BB.R * 0.5)}px monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy + 1);
  ctx.restore();
}

// ── Спрайт корабля (кэш-офскрин, как раньше) ────────────────
const BB_SPL = 240;
// KV-класс → ключ силуэта в CN_SHIP_GEO. У части классов свой корпус лежит под
// другим именем (carrier/assault/cruiser/hypercruiser/station), иначе они
// сваливались в фолбэк «destroyer» и рисовались эсминцами. Зеркало CN_KV_HULL
// (+ авиакрыло wing → истребитель-дельта mla).
const BB_HULL = {
  supportCarrier: 'carrier', multiroleCarrier: 'assault',
  mediumCruiser: 'cruiser', hyperCruiser: 'hypercruiser', ss13: 'station',
  wing: 'mla',
};
function bbGeo(cls) {
  if (typeof CN_SHIP_GEO !== 'undefined') {
    const hull = BB_HULL[cls] || cls;
    if (CN_SHIP_GEO[hull]) return CN_SHIP_GEO[hull];
    if (CN_SHIP_GEO[cls]) return CN_SHIP_GEO[cls];
    if (CN_SHIP_GEO.destroyer) return CN_SHIP_GEO.destroyer;
  }
  return { st: [[0, 0], [40, 16], [170, 40], [250, 30], [300, 20]], engine: [160, 300], maxHW: 40 };
}
function bbImg(path) {
  if (path in BB.tex) return BB.tex[path];
  BB.tex[path] = null;
  const img = new Image();
  img.onload = () => { BB.tex[path] = img; BB.spr = {}; if (BB.ctx) bbPaint(); };
  img.onerror = () => { BB.tex[path] = false; };
  img.src = path;
  return null;
}
function bbFirstImg(paths) {
  let pending = false;
  for (const p of paths) { const r = bbImg(p); if (r) return r; if (r === null) pending = true; }
  return pending ? null : false;
}
function bbDesignOf(name, cls) {
  const ds = (typeof EC !== 'undefined' && EC.designs) || [];
  const clsOf = d => d && d.data && d.data.class;
  return ds.find(d => d && d.category === 'ship' && d.name === name && (clsOf(d) === cls || !cls))
      || ds.find(d => d && d.category === 'ship' && d.name === name) || null;
}
function bbShipKey(cls, tIdx, side) { return cls + '.' + (tIdx == null ? '-' : tIdx) + '.' + side; }

function bbSprite(cls, tIdx, side) {
  const key = bbShipKey(cls, tIdx, side);
  const col = side === 'mine' ? BB_C.mine : BB_C.foe;
  const G = 'assets/constructors/';
  const gen = kind => G + 'ship_' + kind + '.webp';
  const cp = (kind, a, b) => G + 'ship_' + kind + '_' + a + (b != null ? '_' + b : '') + '.webp';
  const body  = bbFirstImg([tIdx != null ? cp('type', cls, tIdx) : null, cp('class', cls), gen('class')].filter(Boolean));
  const armor = bbFirstImg([cp('armortex', cls), gen('armortex')]);
  const decor = bbFirstImg([tIdx != null ? cp('decor', cls, tIdx) : null, cp('decor', cls), gen('decor')].filter(Boolean));
  const ready = body !== null && armor !== null && decor !== null;
  if (ready && BB.spr[key]) return BB.spr[key];

  const H = bbGeo(cls);
  const tip = Math.min(...H.st.map(p => p[0]));
  const stern = H.engine ? H.engine[1] : Math.max(...H.st.map(p => p[0]));
  const L = stern - tip, halfB = H.maxHW || Math.max(...H.st.map(p => p[1]));
  const padL = 30, padR = 10, padY = 8;
  const k = BB_SPL / L;
  const SW = Math.round(padL + BB_SPL + padR);
  const SH = Math.round(halfB * 2 * k + padY * 2);
  const cyS = SH / 2;
  const cv = document.createElement('canvas');
  cv.width = Math.round(SW * BB.dpr); cv.height = Math.round(SH * BB.dpr);
  cv._geo = { padL, SW, SH, hullW: BB_SPL };
  const x = cv.getContext('2d');

  const outline = wf => {
    const R2 = H.st.map(p => [160 + p[1] * wf, p[0]]), L2 = H.st.slice().reverse().map(p => [160 - p[1] * wf, p[0]]);
    return 'M' + R2.concat(L2).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
  };
  const path = new Path2D(outline(1));
  const belt = new Path2D(outline(1) + ' ' + outline(0.55));
  const T = () => { x.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0); x.transform(0, k, -k, 0, padL + stern * k, cyS - 160 * k); };
  const R = () => x.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);

  // Статичный факел дюз у кормы (запечён в спрайт — без пульса)
  R();
  [[0, 1], [-0.6, 0.72], [0.6, 0.72]].forEach(([oy, sc2]) => {
    const yj = cyS + oy * halfB * k * 0.5, fl = 24 * sc2;
    const fg = x.createLinearGradient(padL + 2, 0, padL - fl, 0);
    fg.addColorStop(0, `rgba(${col},0.7)`); fg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = fg;
    x.beginPath();
    x.moveTo(padL + 2, yj - 3 * sc2); x.lineTo(padL + 2, yj + 3 * sc2); x.lineTo(padL - fl, yj);
    x.closePath(); x.fill();
  });

  T();
  x.save(); x.shadowColor = 'rgba(0,0,0,0.7)'; x.shadowBlur = 10; x.fillStyle = '#0a0f16'; x.fill(path); x.restore();

  x.save(); T(); x.clip(path);
  R();
  const bx0 = padL, by0 = cyS - halfB * k, bw = BB_SPL, bh = halfB * 2 * k;
  x.fillStyle = '#10161d'; x.fillRect(bx0 - 2, by0 - 2, bw + 4, bh + 4);
  if (body)  x.drawImage(body,  bx0, by0, bw, bh);
  if (!body && !armor) {
    const g = x.createLinearGradient(0, by0, 0, by0 + bh);
    g.addColorStop(0, `rgba(${col},0.40)`); g.addColorStop(0.5, `rgba(${col},0.18)`); g.addColorStop(1, 'rgba(6,10,16,0.9)');
    x.fillStyle = g; x.fillRect(bx0, by0, bw, bh);
  }
  x.fillStyle = `rgba(${col},0.06)`; x.fillRect(bx0, by0, bw, bh);
  const lg = x.createLinearGradient(0, by0, 0, by0 + bh);
  lg.addColorStop(0, 'rgba(255,255,255,0.14)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.45)');
  x.fillStyle = lg; x.fillRect(bx0, by0, bw, bh);
  x.restore();

  if (armor) {
    x.save(); T(); x.clip(belt, 'evenodd');
    R();
    x.globalAlpha = 0.85; x.drawImage(armor, bx0, by0, bw, bh); x.globalAlpha = 1;
    x.restore();
  }
  if (decor) {
    x.save(); T(); x.clip(path);
    R();
    x.drawImage(decor, bx0, by0, bw, bh);
    x.restore();
  }

  T();
  x.lineJoin = 'round';
  x.strokeStyle = `rgba(${col},0.30)`; x.lineWidth = 4.5 / k; x.stroke(path);
  x.strokeStyle = 'rgba(207,214,221,0.85)'; x.lineWidth = 1.4 / k; x.stroke(path);
  R();

  if (ready) BB.spr[key] = cv;
  return cv;
}

// Рисуем корабль: спрайт ПОВЁРНУТ по курсу (facing 0..5), шеврон курса,
// полоски HP/щита горизонтальны под гексом.
function bbShip(ctx, u, alpha) {
  const uc = bbUnitCenter(u);
  const cx = uc.px, cy = uc.py, ang = uc.ang;
  const moving = u.id != null && BB.anim.move.has(u.id);
  const C = BB.R * 1.72;
  const col = u.mine ? BB_C.mine : BB_C.foe;
  const dsn = bbDesignOf(u.name, u.cls);
  const tIdx = dsn && dsn.data && dsn.data.type != null ? dsn.data.type : null;
  const spr = bbSprite(u.cls, tIdx, u.mine ? 'mine' : 'foe');
  const g = spr._geo;
  const len = C * (0.42 + bbClsSize(u.cls) * 0.72);   // разброс шире: мелочь ≈1 гекс, дредноут ≈2
  const sc = len / g.hullW, dw = g.SW * sc, dh = g.SH * sc;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (u.id && u.id === BB.sel) {
    bbHexPath(ctx, cx, cy, BB.R * 0.9);
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = Math.max(1, 2 / BB.zoom);
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // шеврон курса на кромке гекса — курс виден даже на мелком зуме
  const chx = cx + Math.cos(ang) * BB.R * 0.86, chy = cy + Math.sin(ang) * BB.R * 0.86;
  ctx.beginPath();
  ctx.moveTo(chx + Math.cos(ang) * BB.R * 0.13, chy + Math.sin(ang) * BB.R * 0.13);
  ctx.lineTo(chx + Math.cos(ang + 2.5) * BB.R * 0.13, chy + Math.sin(ang + 2.5) * BB.R * 0.13);
  ctx.lineTo(chx + Math.cos(ang - 2.5) * BB.R * 0.13, chy + Math.sin(ang - 2.5) * BB.R * 0.13);
  ctx.closePath();
  ctx.fillStyle = `rgba(${col},0.85)`; ctx.fill();

  // выхлопной след при скольжении между гексами — видно, что корабль в движении
  if (moving) {
    const tl = BB.R * 1.5;
    const tx = cx - Math.cos(ang) * tl, ty = cy - Math.sin(ang) * tl;
    const tg = ctx.createLinearGradient(cx, cy, tx, ty);
    tg.addColorStop(0, `rgba(${col},0.5)`); tg.addColorStop(1, `rgba(${col},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = tg; ctx.lineWidth = Math.max(1.5, BB.R * 0.22); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.restore();
  }

  // спрайт корпуса: нос смотрит вправо → поворот на угол курса
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.drawImage(spr, -(g.padL + g.hullW / 2) * sc, -dh / 2, dw, dh);
  ctx.rotate(-ang);
  ctx.translate(-cx, -cy);

  // полоски состояния под гексом
  const bw = BB.R * 1.15, bx = cx - bw / 2, by = cy + BB.R * 0.92;
  const hpFrac = (u.max_hp > 0) ? u.hp / u.max_hp : 1;
  // щит = поднятые СЕКУНДЫ, меряем их долей от пула хода (6 c = полная полоса)
  const shFrac = (u.tp_max > 0) ? (u.shield || 0) / u.tp_max : 0;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by, bw, 3);
  ctx.fillStyle = hpFrac > 0.5 ? `rgba(${col},0.95)` : hpFrac > 0.25 ? 'rgba(255,190,70,0.95)' : 'rgba(255,70,70,0.95)';
  ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, hpFrac)), 3);
  if (shFrac > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(bx, by - 4, bw * Math.max(0, Math.min(1, shFrac)), 2);
  }
  ctx.restore();
}

// Сканлайны — статичная киберпанк-подложка.
function bbPaintScan(ctx, W, H) {
  ctx.save();
  ctx.globalAlpha = 0.05; ctx.fillStyle = '#8ff';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════
// ☄ ГОРЯЧИЕ ТОЧКИ — страница сайдменю: все бои фракции одним списком.
// ════════════════════════════════════════════════════════════════════
async function renderHotspots() {
  const head = `<div class="cn-wrap"><div class="cn-head">
      <div class="cn-eyebrow">◈ СВОДКА</div>
      <h1>Горячие точки</h1>
    </div>`;
  if (typeof ecCanAccess !== 'function' || !ecCanAccess()) {
    setPg(head + `<div class="hs-empty">Доступно игрокам с одобренной анкетой.</div></div>`);
    return;
  }
  setPg(head + `<div class="sload"><div class="pulse-loader"></div></div></div>`);
  let battles = [], err = null;
  try { battles = await ecRpc('battles_mine', {}); } catch (e) { battles = null; err = e; }
  if (typeof curSlug !== 'undefined' && curSlug !== 'hotspots') return;
  if (!Array.isArray(battles)) {
    let msg = (err && err.message) || 'сервер не ответил';
    try { const j = JSON.parse(msg); if (j && j.message) msg = j.message; } catch (e) {}
    setPg(head + `<div class="hs-empty">Сводка недоступна.<br>
      <span class="hs-hint" style="color:var(--t3)">${esc(msg)}</span><br>
      <button class="btn btn-gh btn-sm" style="margin-top:10px" onclick="renderHotspots()">↺ Повторить</button></div></div>`);
    return;
  }
  hsNavBadge(battles.length);
  if (!battles.length) {
    setPg(head + `<div class="hs-empty"><div class="hs-empty-ic">🕊</div>Сейчас ваши флоты не скованы боем.<br>
      <span class="hs-hint">Бой завязывается при встрече с врагом или перехвате на трассе — тогда точка появится здесь.</span></div></div>`);
    return;
  }
  const rows = battles.map(b => {
    const forming = b.status === 'forming';
    const fleets = (b.my_fleets || []).map(f => esc(f.name || 'Флот')).join(', ') || '—';
    return `<div class="hs-card${forming ? '' : ' hs-card-hot'}">
        <div class="hs-card-top">
          <span class="hs-kind">${b.kind === 'duel' ? '🥊 дуэль Бойцовского клуба' : b.kind === 'intercept' ? '🛑 перехват на трассе' : '⚔ встреча флотов'}</span>
          <span class="hs-st${forming ? '' : ' hs-st-hot'}">${forming ? 'расстановка' : 'идёт бой'}</span>
        </div>
        <div class="hs-card-t">${esc(b.system_name || b.system_id)}</div>
        <div class="hs-card-foe">против <b>${esc(b.foe_name || '?')}</b> · вы — ${b.my_side === 'attacker' ? 'нападающие' : 'обороняющиеся'}</div>
        <div class="hs-card-fl">Скованы боем: ${fleets}</div>
        <button class="btn btn-gd" onclick="bbOpen('${jsq(b.id)}')">${forming ? 'Расставить флот' : 'К доске боя'}</button>
      </div>`;
  }).join('');
  setPg(head + `<div class="hs-grid">${rows}</div>
    <div class="hs-hint" style="margin-top:14px">Скованный боем флот никуда не уйдёт, пока сражение не окончено. Система под боем не оккупируется — сначала надо победить.</div></div>`);
}

// Бейдж на сайдменю «Горячие точки» — число активных боёв.
function hsNavBadge(n) {
  const a = document.getElementById('ntl-hot'); if (!a) return;
  let b = a.querySelector('.hs-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'hs-badge'; a.appendChild(b); }
    b.textContent = n;
  } else if (b) b.remove();
}

// ════════════════════════════════════════════════════════════
// КОЛЕСО ДЕЙСТВИЙ (клавиша «У» или кнопка в плашке корабля)
// ────────────────────────────────────────────────────────────
// Ход корабля — это ПУЛ СЕКУНД, и колесо показывает, на что их хватает.
// Кольцо режется на сегменты по числу доступных действий; наводишься —
// в центре появляется объяснение и цена в секундах, клик подтверждает.
// Сегмент не по карману гаснет и прямо пишет, чего не хватает.
// Аим — по УГЛУ курсора от центра: на телефоне это палец, на десктопе мышь.
// ════════════════════════════════════════════════════════════
var BBW = { open: false, unit: null, segs: [], aim: -1, el: null };

// Короткая подпись включённого режима — видно прямо в полоске корабля,
// иначе «почему я вдруг хожу дальше» остаётся загадкой.
function bbStanceLbl(u) {
  if (!u || !u.stance || u.stance === 'off') return '';
  return u.stance === 'eng' ? ' · ⚙ форсаж двигателей'
       : u.stance === 'wpn' ? ' · ⚔ форсаж орудий'
       : u.stance === 'siege' ? ' · \u{1F3F9} осадный режим — с места ни шагу'
       : ` · 🛡 щит ${(+u.shield).toFixed(1)} c`;
}

// Куда направить мощность в этом ходу. Это НЕ меню действий: ходить и стрелять
// можно кликом по доске и без колеса. Режим даёт БОНУС и стоит секунд.
// Числа считаем от самого борта, чтобы человек видел «16 вместо 10», а не «×0.5».


// Сравнение в колесе: две полосы «сейчас» и «с режимом». Цифры оставляем,
// но решение принимается ГЛАЗОМ — видно, насколько длиннее станет полоса.
function bbWheelCmp(seg) {
  if (!seg.cmp) return '';
  const mx = Math.max(seg.cmp.now, seg.cmp.up, 1);
  const row = (cls, lbl, v, txt) =>
    `<div class="bbw-cmp-r ${cls}"><span class="bbw-cmp-l">${esc(lbl)}</span>` +
    `<span class="bbw-cmp-b"><i style="width:${Math.max(3, v / mx * 100)}%"></i></span>` +
    `<span class="bbw-cmp-v">${esc(txt)}</span></div>`;
  return `<div class="bbw-cmp">${row('now', 'сейчас', seg.cmp.now, seg.cmp.nowT)}` +
         `${row('up', 'с режимом', seg.cmp.up, seg.cmp.upT)}</div>`;
}

function bbWheelSegs(u) {
  const s = BB.st;
  const acts = u.acted || (s.acts_left > 0);
  const tp = +u.tp, step = +u.step_cost || 1, fire = +u.fire_cost || 1;
  const after = tp - BBW_COST;
  const set = u.stance && u.stance !== 'off';
  const busy = set ? `Мощность уже направлена в ${
    u.stance === 'eng' ? 'двигатели' : u.stance === 'wpn' ? 'орудия'
    : u.stance === 'siege' ? 'осадную платформу' : 'щит'
  } — переиграть можно только следующим ходом.` : null;

  const hexNow  = Math.floor((tp + 1e-9) / step);
  const hexEng  = Math.max(0, Math.floor((after + 1e-9) / (step * BBW_ENG)));
  const salNow  = Math.floor((tp + 1e-9) / fire);
  const salWpn  = Math.max(0, Math.floor((after + 1e-9) / (fire * BBW_WPN_CST)));

  return [
    { key: 'eng', ico: '⚙', name: 'Двигатели',
      cost: `${BBW_COST.toFixed(1)} c → ${hexEng} гекс`,
      ok: !set && acts && after >= 0 && u.cls !== 'ss13' && u.speed > 0,
      why: busy || (after < 0 ? `На переброс мощности нужно ${BBW_COST.toFixed(1)} c, осталось ${tp.toFixed(1)} c.`
        : `Шаг дешевеет вдвое: пройдёте ${hexEng} гекс(ов) вместо ${hexNow}. Это дальше, чем корабль ходит обычно.`),
      cmp: { now: hexNow, up: hexEng, nowT: hexNow + ' гекс', upT: hexEng + ' гекс' },
      hint: 'Дальше — значит можно обойти врага с кормы или разорвать дистанцию за один ход.' },

    { key: 'wpn', ico: '⚔', name: 'Орудия',
      cost: `${BBW_COST.toFixed(1)} c → урон ×${BBW_WPN_DMG}`,
      ok: !set && acts && after >= 0,
      why: busy || (after < 0 ? `На переброс мощности нужно ${BBW_COST.toFixed(1)} c, осталось ${tp.toFixed(1)} c.`
        : `Каждый залп бьёт в ${BBW_WPN_DMG} раза сильнее, а перезарядка на 20% быстрее: ${salWpn} залп(а) вместо ${salNow} обычных.`),
      cmp: { now: salNow, up: salWpn * BBW_WPN_DMG,
             nowT: salNow + ' зал.', upT: salWpn + ' зал. ×' + BBW_WPN_DMG },
      hint: 'Берут, когда цель уже в прицеле и ход тратится на добивание.' },

    { key: 'shd', ico: '\u{1F6E1}', name: 'Щит',
      cost: `весь остаток — ${Math.max(0, tp).toFixed(1)} c`,
      ok: !set && acts && tp > 0.05 && bbTerra(u.x, u.y) !== 'neb',
      why: busy || (bbTerra(u.x, u.y) === 'neb' ? 'В туманности защитное поле не держится.'
        : `Поле держится ВЕСЬ ХОД ПРОТИВНИКА и опускается только в начале вашего следующего хода — оно для того и нужно, чтобы пережить чужой залп. Гасит ${bbNum(u.mitig)} урона в секунду и снимает ${Math.round(u.reduc * 100)}% с накрытого.`),
      cmp: { now: 0, up: Math.max(0, tp), nowT: 'без поля', upT: Math.max(0, tp).toFixed(1) + ' c поля' },
      hint: 'Манёвр роняет поле: подняли — стоим.' }
  ].concat(bbKitSeg(u, acts)).concat(bbWheelKit(u, acts));
}

// Снаряжение в колесо НЕ раскладываем: модулей у большого борта до семи, в
// кольцо они не влезают. Один сегмент-дверь — он открывает список-шторку.
function bbKitSeg(u, acts) {
  if (!Array.isArray(u.acts) || !u.acts.length) return [];
  const ready = u.acts.filter(a => bbKitCd(u, a.k) === 0).length;
  return [{
    key: 'kit', ico: '\u{1F9F0}', name: 'Снаряжение',
    cost: `${ready} из ${u.acts.length} готово`,
    ok: acts && ready > 0,
    act: function () { bbSheet('kit'); },
    why: !ready ? 'Всё снаряжение на перезарядке — ждём следующего хода.'
       : !acts ? 'Активации на этот ход кончились.'
       : `Активные модули борта: ${u.acts.map(a => (BBK[a.k] || {}).name || a.k).join(', ')}. Откроется список — там же написано, что каждый делает и когда перезарядится.`,
    cmp: { now: u.acts.length, up: ready, nowT: 'всего ' + u.acts.length, upT: 'готово ' + ready },
    hint: 'Снаряжение тратит активацию борта, но не залп: можно ударить модулем и выстрелить в тот же ход.'
  }];
}

// Не всякий борт умеет только «мощность»: у ремонтника есть нано-рой, у
// носителя — ангары. Эти кнопки жили в плашке корабля, а на телефоне плашка
// закрыта шторкой — сегмент в колесе им нужнее. Показываем ТОЛЬКО тем, у кого
// снаряжение есть: пустых заглушек в кольце быть не должно.
function bbWheelKit(u, acts) {
  const s = BB.st, out = [];

  if (bbHasHeal(u)) {
    const gs = (u.wpn || []).filter(bbIsHeal);
    const hp = gs.reduce((a, g) => a + (+g.dmg || 0), 0);
    const rng = Math.max.apply(null, gs.map(g => +g.rng || 0));
    const ok = acts && bbCanFire(u) && !BB.heal;
    out.push({
      key: 'heal', ico: '\u{1F6E0}', name: 'Нано-рой',
      cost: `+${bbNum(hp)} HP · до ${rng} гекс.`,
      ok,
      act: bbHealMode,
      why: BB.heal ? 'Режим ремонта уже включён — кликните по союзнику на доске.'
         : !bbCanFire(u) ? 'Орудия и рой в этом ходу уже отработали.'
         : !acts ? 'Активации на этот ход кончились.'
         : `Рой чинит СОЮЗНЫЙ борт на ${bbNum(hp)} HP в радиусе ${rng} гекс. Выбор сегмента включает режим ремонта — следующий клик по союзнику пустит рой.`,
      hint: 'Ремонт тратит тот же залп, что и стрельба: чинить или бить — выбор одного хода.' });
  }

  if (+u.wings > 0) {
    const ok = acts && !u.acted && s.acts_left > 0;
    out.push({
      key: 'air', ico: '\u{1F6E9}', name: 'Авиакрыло',
      cost: `в ангарах ${bbNum(u.wings)} · 1 активация`,
      ok,
      act: () => bbLaunch(u.id),
      why: !ok ? 'На подъём нужна целая активация, а она уже потрачена.'
        : `Поднимаем звено из ангара: в бой оно вступит со следующего хода. В ангарах ещё ${bbNum(u.wings)}.`,
      hint: 'Крыло живёт отдельным бортом — носителю после подъёма лучше отойти.' });
  }

  return out;
}

function bbWheelOpen(id) {
  const s = BB.st;
  // НИ ОДНОГО молчаливого выхода: «нажал и ничего не произошло» — худший из отказов.
  if (!s) { toast('Бой ещё не загружен', 'err'); return; }
  if (s.status === 'forming') { toast('Идёт расстановка — колесо действий включится, когда бой начнётся', 'err'); return; }
  if (s.status !== 'active') { toast('Бой завершён — действовать нечем', 'err'); return; }
  const u = (s.units || []).find(q => q.id === (id || BB.sel));
  if (!u) { toast('Сначала выберите корабль на доске', 'err'); return; }
  if (!u.mine) { toast(`«${u.name}» — не ваш корабль`, 'err'); return; }
  if (!s.my_turn) { toast('Сейчас ход противника — свои секунды потратите на своём', 'err'); return; }
  if (u.tp == null) { toast('Сервер не прислал секунды хода: обновите страницу (Ctrl+F5)', 'err'); return; }
  BBW.unit = u; BBW.segs = bbWheelSegs(u); BBW.aim = -1; BBW.open = true;
  bbWheelPaint();
}
function bbWheelClose() {
  BBW.open = false; BBW.unit = null;
  if (BBW.el) { BBW.el.remove(); BBW.el = null; }
}

function bbWheelPaint() {
  if (!BBW.open) return;
  if (!BBW.el) {
    BBW.el = document.createElement('div');
    BBW.el.className = 'bbw-wrap';
    BBW.el.addEventListener('pointermove', bbWheelAim);
    BBW.el.addEventListener('pointerdown', bbWheelAim);
    BBW.el.addEventListener('pointerup', bbWheelPick);
    document.body.appendChild(BBW.el);
  }
  const n = BBW.segs.length, a = BBW.aim >= 0 ? BBW.segs[BBW.aim] : null, u = BBW.unit;
  const R = 140, r = 72, cx = 160, cy = 160;
  let arcs = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.03;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.03;
    const P = (rad, ang) => (cx + rad * Math.cos(ang)).toFixed(1) + ',' + (cy + rad * Math.sin(ang)).toFixed(1);
    const big = (a1 - a0) > Math.PI ? 1 : 0;
    const d = 'M ' + P(r, a0) + ' L ' + P(R, a0) + ' A ' + R + ' ' + R + ' 0 ' + big + ' 1 ' + P(R, a1) +
              ' L ' + P(r, a1) + ' A ' + r + ' ' + r + ' 0 ' + big + ' 0 ' + P(r, a0) + ' Z';
    const seg = BBW.segs[i];
    const cls = 'bbw-seg' + (seg.ok ? '' : ' off') + (BBW.aim === i ? ' aim' : '');
    const mid = (a0 + a1) / 2, lr = (R + r) / 2;
    const lx = (cx + lr * Math.cos(mid)).toFixed(1), ly = cy + lr * Math.sin(mid);
    arcs += '<path class="' + cls + '" d="' + d + '" data-i="' + i + '"></path>' +
      '<text class="bbw-ico" x="' + lx + '" y="' + (ly - 4).toFixed(1) + '">' + seg.ico + '</text>' +
      '<text class="bbw-nm" x="' + lx + '" y="' + (ly + 16).toFixed(1) + '">' + esc(seg.name) + '</text>';
  }
  BBW.el.innerHTML =
    '<div class="bbw-card">' +
      '<div class="bbw-top">«' + esc(u.name) + '» · осталось <b>' + (+u.tp).toFixed(1) +
        ' c</b> из ' + (+u.tp_max).toFixed(0) + '</div>' +
      '<svg class="bbw-svg" viewBox="0 0 320 320">' + arcs +
        '<circle class="bbw-hub" cx="' + cx + '" cy="' + cy + '" r="' + (r - 6) + '"></circle>' +
        '<text class="bbw-hub-t" x="' + cx + '" y="' + (cy - 6) + '">' + (a ? esc(a.name) : 'Мощность') + '</text>' +
        '<text class="bbw-hub-s" x="' + cx + '" y="' + (cy + 14) + '">' + (a ? esc(a.cost) : 'центр — закрыть') + '</text>' +
      '</svg>' +
      // Слоты ФИКСИРОВАННОЙ высоты: описания у режимов разной длины, и без
      // этого кольцо прыгало вверх-вниз при каждом наведении.
      '<div class="bbw-why">' + (a ? esc(a.why) + (a.ok ? ' ' + esc(a.hint) : '')
        : 'Куда направить мощность в этом ходу. Ходить и стрелять можно и без режима — режим даёт прибавку за секунды. Клик в центр — закрыть.') + '</div>' +
      '<div class="bbw-cmp-slot">' + (a ? bbWheelCmp(a) : '') + '</div>' +
      '<div class="bbw-esc">Клик по сегменту — выбрать · Esc или «У» — закрыть</div>' +
    '</div>';
}

// Наведение по УГЛУ от центра кольца — палец/мышь просто «показывает» сегмент.
function bbWheelAim(ev) {
  if (!BBW.open || !BBW.el) return;
  const svg = BBW.el.querySelector('.bbw-svg'); if (!svg) return;
  const b = svg.getBoundingClientRect();
  const dx = ev.clientX - (b.left + b.width / 2), dy = ev.clientY - (b.top + b.height / 2);
  const dist = Math.hypot(dx, dy) / (b.width / 320);
  const n = BBW.segs.length;
  let i = -1;
  if (dist > 66 && dist < 152) {
    let ang = Math.atan2(dy, dx) + Math.PI / 2;
    while (ang < 0) ang += Math.PI * 2;
    i = Math.floor((ang / (Math.PI * 2)) * n) % n;
  }
  if (i !== BBW.aim) { BBW.aim = i; bbWheelPaint(); }
}

function bbWheelPick() {
  if (!BBW.open) return;
  if (BBW.aim < 0) { bbWheelClose(); return; }        // клик в центр = закрыть
  const seg = BBW.segs[BBW.aim], u = BBW.unit;
  if (!seg.ok) { toast(seg.why, 'err'); return; }
  BB.sel = u.id;
  bbWheelClose();
  // Снаряжение борта (рой, ангары) ходит своими путями — у такого сегмента
  // есть act. Остальные сегменты — режимы мощности, это ОДИН вызов сервера:
  // дальше играем как обычно, кликами по доске, только по новым правилам —
  // шаг дешевле / залп сильнее / поле поднято.
  if (seg.act) { seg.act(); return; }
  bbAct('battle_stance', { p_battle: BB.id, p_unit: u.id, p_mode: seg.key });
}

// «У» (и латинская U на той же клавише) открывает/закрывает колесо.
document.addEventListener('keydown', function (ev) {
  if (typeof BB === 'undefined' || !BB.st) return;
  const t = ev.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
  const k = (ev.key || '').toLowerCase();
  if (k === 'escape' && BBW.open) { bbWheelClose(); ev.preventDefault(); return; }
  // ev.code — это ФИЗИЧЕСКАЯ кнопка, она одна и та же в любой раскладке.
  // KeyE = «У» по-русски, KeyU = «U» по-английски: жмите привычную, сработают обе.
  const code = ev.code || '';
  if (code === 'KeyU' || code === 'KeyE' || k === 'у' || k === 'u') {
    if (BBW.open) bbWheelClose(); else bbWheelOpen(BB.sel);
    ev.preventDefault();
  }
});
