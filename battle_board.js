// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════
// ДОСКА БОЯ — пошаговое сражение флотов (война, срез 5)
// Написана С НУЛЯ. Зеркало _war_battle.sql.
//
// ХОД = ход СТОРОНЫ: каждый живой корабль может один раз сдвинуться и
// один раз выстрелить, потом ход уходит противнику. 6 ходов на сторону.
// Ход можно целиком разменять на вызов одного корабля из резерва.
//
// Фазы:
//   forming — расстановка: тянем корабли из резерва в свою зону;
//   active  — бой: клик по своему кораблю → подсветка хода и целей;
//   done    — итог.
//
// Рендер — canvas в мировых координатах клеток (BB.cell пикселей на клетку),
// без внешних зависимостей. Один акцент на сторону: свои — циан, чужие —
// маджента (правила UI: 1-2 акцента, никакого радужного салата).
// ════════════════════════════════════════════════════════════════════

const BB = {
  id: null,          // id боя
  st: null,          // ответ battle_state
  cv: null, ctx: null,
  cell: 34, dpr: 1,
  sel: null,         // выбранный свой корабль (id)
  hover: null,       // {x,y} под курсором
  pick: null,        // фаза расстановки: выбранный проект из резерва
  place: [],         // фаза расстановки: [{unit_id, unit_name, cls, x, y}]
  poll: null,        // таймер опроса (ход противника)
  busy: false,
  spr: {},           // кэш спрайтов кораблей: cls_side → canvas
  tex: {},           // кэш текстур корпуса: cls → Image|null (null = грузится/нет)
  stars: null,       // офскрин-звёздное небо (пересобирается при ресайзе)
  raf: null,         // цикл анимации (дрейф звёзд, пульс дюз)
};

// Палитра: держим в одном месте, чтобы доска не расползлась по цветам.
const BB_C = {
  bg:     '#05070d',
  grid:   'rgba(90,200,230,0.10)',
  gridHi: 'rgba(90,200,230,0.22)',
  mine:   '90,220,240',    // циан — свои
  foe:    '255,60,130',    // маджента — чужие
  grid2:  'rgba(90,200,230,0.05)',   // сетка в космосе — едва заметная разметка тактического сканера
  move:   'rgba(90,220,240,0.16)',
  fire:   'rgba(255,60,130,0.20)',
  zoneA:  'rgba(90,220,240,0.07)',
  zoneD:  'rgba(255,60,130,0.07)',
};

// ── Открыть / закрыть ───────────────────────────────────────
async function bbOpen(battleId) {
  BB.id = battleId; BB.sel = null; BB.pick = null; BB.place = [];
  let ov = document.getElementById('bb-ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'bb-ov'; ov.className = 'bb-ov';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="bb-load">Связь с полем боя…</div>`;
  ov.classList.add('show');
  document.body.style.overflow = 'hidden';
  await bbReload();
  bbStartPoll();
}
function bbClose() {
  bbStopPoll();
  const ov = document.getElementById('bb-ov');
  if (ov) ov.classList.remove('show');
  document.body.style.overflow = '';
  if (BB.raf) { cancelAnimationFrame(BB.raf); BB.raf = null; }
  BB.id = null; BB.st = null; BB.cv = null; BB.ctx = null; BB.stars = null;
  // состав флотов мог измениться (потери) — обновим кабинет
  if (typeof ecReload === 'function') ecReload();
}

// Опрос: пока ход противника, состояние тянем сами. Свой ход не опрашиваем —
// доска и так перерисовывается после каждого действия, лишний трафик ни к чему.
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
  try {
    BB.st = await ecRpc('battle_state', { p_battle: BB.id });
  } catch (e) {
    const ov = document.getElementById('bb-ov');
    if (ov) ov.innerHTML = `<div class="bb-load">Бой недоступен: ${esc(e.message || e)}<br><button class="btn btn-gh btn-sm" style="margin-top:12px" onclick="bbClose()">Закрыть</button></div>`;
    return;
  }
  bbRender();
}

// ── Каркас экрана ───────────────────────────────────────────
function bbRender() {
  const s = BB.st; if (!s) return;
  const ov = document.getElementById('bb-ov'); if (!ov) return;
  const foeName = s.my_side === 'attacker' ? s.defender_name : s.attacker_name;
  const myName  = s.my_side === 'attacker' ? s.attacker_name : s.defender_name;
  const myLeft  = s.my_side === 'attacker' ? s.att_turns_left : s.def_turns_left;
  const foeLeft = s.my_side === 'attacker' ? s.def_turns_left : s.att_turns_left;

  ov.innerHTML = `
    <div class="bb-wrap">
      <div class="bb-top">
        <div class="bb-ttl">
          <span class="bb-ttl-ic">⚔</span>
          <span class="bb-ttl-t">${esc(s.system_name || s.system_id)}</span>
          <span class="bb-ttl-sub">${s.kind === 'intercept' ? 'перехват на трассе' : 'встреча флотов'}</span>
        </div>
        <div class="bb-vs">
          <span class="bb-vs-me">${esc(myName)}</span>
          <span class="bb-vs-x">против</span>
          <span class="bb-vs-foe">${esc(foeName)}</span>
        </div>
        <button class="bb-x" title="Свернуть доску" onclick="bbClose()">✕</button>
      </div>
      <div class="bb-body">
        <div class="bb-boardw">
          <div class="bb-cvw"><canvas id="bb-cv" class="bb-cv"></canvas></div>
          <div class="bb-scroll-hint" id="bb-scroll-hint">⇄ доску можно листать пальцем</div>
          ${bbPhaseBar(s, myLeft, foeLeft)}
        </div>
        <aside class="bb-side">
          ${s.status === 'forming' ? bbDeployPanel(s) : bbUnitPanel(s)}
          ${bbLogPanel(s)}
        </aside>
      </div>
    </div>`;

  BB.cv = document.getElementById('bb-cv');
  BB.ctx = BB.cv.getContext('2d');
  bbFit();
  bbBindCanvas();
  bbPaint();
}

// Полоса состояния: чей ход, сколько ходов осталось, срок явки.
function bbPhaseBar(s, myLeft, foeLeft) {
  if (s.status === 'done') {
    const won = s.winner === s.my_fid;
    return `<div class="bb-bar ${won ? 'bb-bar-won' : 'bb-bar-lost'}">
        <b>${won ? '⚑ Победа' : '⚑ Поражение'}</b>
        <span class="bb-bar-sub">Бой окончен. Потери списаны с флотов.</span>
        <button class="btn btn-gd btn-sm" onclick="bbClose()">Закрыть</button>
      </div>`;
  }
  if (s.status === 'forming') {
    const mine = s.my_side === 'attacker' ? s.att_ready : s.def_ready;
    const foe  = s.my_side === 'attacker' ? s.def_ready : s.att_ready;
    return `<div class="bb-bar">
        <b>Расстановка</b>
        <span class="bb-bar-sub">${mine ? 'Ваш состав утверждён.' : 'Вытащите корабли из резерва в свою зону.'} ${foe ? 'Противник готов.' : 'Противник ещё расставляет.'}</span>
        ${mine ? '' : `<button class="btn btn-gd btn-sm" ${BB.place.length ? '' : 'disabled'} onclick="bbConfirmDeploy()">В бой (${BB.place.length})</button>`}
      </div>`;
  }
  const mv = s.my_turn;
  return `<div class="bb-bar ${mv ? 'bb-bar-my' : 'bb-bar-foe'}">
      <b>${mv ? 'Ваш ход' : 'Ход противника'}</b>
      <span class="bb-bar-sub">Ходов осталось: у вас ${myLeft}, у врага ${foeLeft}. ${bbDeadline(s)}</span>
      ${mv ? `<button class="btn btn-gd btn-sm" onclick="bbEndTurn()">Завершить ход</button>` : ''}
      ${s.can_force ? `<button class="btn btn-gh btn-sm" onclick="bbForce()">Прожать просроченный ход</button>` : ''}
    </div>`;
}
function bbDeadline(s) {
  if (!s.deadline_at) return '';
  const ms = new Date(s.deadline_at) - new Date();
  if (ms <= 0) return 'Срок хода вышел.';
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
  return `Срок хода: ${h ? h + ' ч ' : ''}${m} мин.`;
}

// ── Панель расстановки ──────────────────────────────────────
function bbDeployPanel(s) {
  const pool = Array.isArray(s.pool) ? s.pool : [];
  // сколько каждого проекта уже поставлено на доску в этой сессии
  const used = {};
  BB.place.forEach(p => { used[p.unit_id] = (used[p.unit_id] || 0) + 1; });
  const rows = pool.map(p => {
    const free = (p.free || 0) - (used[p.unit_id] || 0);
    const on = BB.pick === p.unit_id;
    return `<button class="bb-pool${on ? ' bb-pool-on' : ''}" ${free <= 0 ? 'disabled' : ''}
        onclick="bbPick('${jsq(p.unit_id)}')">
        <span class="bb-pool-cls">${bbClsIco(p.cls)}</span>
        <span class="bb-pool-n">${esc(p.unit_name)}
          <i>${bbClsName(p.cls)} · ${p.hp} HP · ${p.dmg} урон · ход ${p.speed} · бьёт ${p.rng}</i></span>
        <span class="bb-pool-q">×${free}</span>
      </button>`;
  }).join('');
  return `<div class="bb-panel">
      <div class="bb-panel-t">Резерв на поле боя</div>
      <div class="bb-panel-h">Выберите корабль, затем клик по своей зоне. Максимум ${s.cap} на доске. Клик по уже поставленному — снять.</div>
      ${rows || '<div class="bb-empty">Резерв пуст: в скованных боем флотах кораблей нет.</div>'}
    </div>`;
}
function bbPick(uid) { BB.pick = (BB.pick === uid ? null : uid); bbRender(); }

// ── Панель выбранного корабля / резерва в бою ───────────────
function bbUnitPanel(s) {
  const u = (s.units || []).find(x => x.id === BB.sel);
  const pool = Array.isArray(s.pool) ? s.pool : [];
  const reinf = (s.my_turn && pool.length) ? `<div class="bb-panel">
      <div class="bb-panel-t">Подкрепление</div>
      <div class="bb-panel-h">Вызов стоит <b>целого хода</b>: корабль прибудет к краю доски и вступит в дело со следующего хода.</div>
      ${pool.map(p => `<button class="bb-pool" onclick="bbReinforce('${jsq(p.unit_id)}')">
          <span class="bb-pool-cls">${bbClsIco(p.cls)}</span>
          <span class="bb-pool-n">${esc(p.unit_name)}<i>${bbClsName(p.cls)} · ${p.hp} HP</i></span>
          <span class="bb-pool-q">×${p.free}</span>
        </button>`).join('')}
    </div>` : '';
  if (!u) return `<div class="bb-panel">
      <div class="bb-panel-t">Корабль не выбран</div>
      <div class="bb-panel-h">${s.my_turn ? 'Кликните по своему кораблю: подсветятся клетки хода и цели в зоне поражения.' : 'Сейчас ходит противник. Доска обновится сама.'}</div>
    </div>${reinf}`;
  const pct = v => Math.max(0, Math.min(100, v));
  return `<div class="bb-panel">
      <div class="bb-panel-t">${esc(u.name)}</div>
      <div class="bb-panel-h">${bbClsName(u.cls)}</div>
      <div class="bb-stat"><span>Корпус</span><b>${u.hp} / ${u.max_hp}</b></div>
      <div class="bb-bar-hp"><i style="width:${pct(u.hp / u.max_hp * 100)}%"></i></div>
      ${u.max_shield > 0 ? `<div class="bb-stat"><span>Щит</span><b>${u.shield} / ${u.max_shield}</b></div>
        <div class="bb-bar-sh"><i style="width:${pct(u.shield / u.max_shield * 100)}%"></i></div>` : ''}
      <div class="bb-stat"><span>Броня</span><b>${u.armor}</b></div>
      <div class="bb-stat"><span>Залп</span><b>${u.dmg}</b></div>
      <div class="bb-stat"><span>Ход</span><b>${u.speed} клет. ${u.moved ? '— израсходован' : ''}</b></div>
      <div class="bb-stat"><span>Дальность</span><b>${u.rng} клет. ${u.fired ? '— уже стрелял' : ''}</b></div>
      ${u.mine && s.my_turn ? `<div class="bb-panel-h" style="margin-top:8px">${u.moved && u.fired ? 'Корабль отработал этот ход.' : 'Клик по подсвеченной клетке — идти, по цели в зоне поражения — огонь.'}</div>` : ''}
    </div>${reinf}`;
}

// ── Журнал боя ──────────────────────────────────────────────
function bbLogPanel(s) {
  const log = Array.isArray(s.log) ? s.log.slice(-40).reverse() : [];
  if (!log.length) return '';
  return `<div class="bb-panel bb-log">
      <div class="bb-panel-t">Журнал</div>
      ${log.map(l => `<div class="bb-log-l">${esc(l.m || '')}</div>`).join('')}
    </div>`;
}

// ── Классы кораблей: имя и значок ───────────────────────────
const BB_CLS = {
  corvette:   'Корвет', frigate: 'Фрегат', destroyer: 'Эсминец',
  cruiser:    'Крейсер', battleship: 'Линкор', dreadnought: 'Дредноут'
};
function bbClsName(c) { return BB_CLS[c] || 'Корабль'; }
function bbClsIco(c) {
  const n = { corvette: '▸', frigate: '▶', destroyer: '◆', cruiser: '⬢', battleship: '⬣', dreadnought: '⬟' };
  return n[c] || '▸';
}
// Размер силуэта в долях клетки — класс читается по габариту, а не по подписи.
function bbClsSize(c) {
  return ({ corvette: 0.42, frigate: 0.52, destroyer: 0.60, cruiser: 0.68, battleship: 0.80, dreadnought: 0.92 })[c] || 0.55;
}

// ── Геометрия ───────────────────────────────────────────────
function bbFit() {
  const s = BB.st; if (!s || !BB.cv) return;
  // Ширину считаем от ВСЕГО тела экрана минус правая колонка, а не от
  // wrap.clientWidth: канвас меряется раньше, чем флекс отдаст место панели,
  // и «съедает» её ширину — панель уезжала за край экрана.
  const body = BB.cv.closest('.bb-body');
  const side = body ? body.querySelector('.bb-side') : null;
  const wide = window.innerWidth > 900;
  const bodyW = body ? body.clientWidth : (BB.cv.parentElement.clientWidth || 600);
  const sideW = (wide && side) ? (side.offsetWidth || 300) + 16 : 0;
  const availW = Math.max(200, bodyW - sideW - 4);
  const availH = Math.max(240, window.innerHeight - (wide ? 190 : 320));
  // Доска целиком влезает в экран (без скролла), но клетка не мельче минимума —
  // иначе корпуса превращаются в мух. На телефоне минимум держим 26px (цель под
  // палец): доска шире экрана и листается внутри .bb-cvw. Верхний кап, чтобы на
  // большой доске клетки не раздувались до почтовых марок с гигантскими зазорами.
  const minCell = wide ? 30 : 26;
  const fit = Math.floor(Math.min(availW / s.w, availH / s.h));
  BB.cell = Math.max(minCell, Math.min(Math.max(fit, 1), 54));
  const hint = document.getElementById('bb-scroll-hint');
  if (hint) hint.style.display = (!wide && BB.cell * s.w > availW) ? 'block' : 'none';
  BB.dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = BB.cell * s.w, H = BB.cell * s.h;
  BB.cv.style.width = W + 'px'; BB.cv.style.height = H + 'px';
  BB.cv.width = Math.round(W * BB.dpr); BB.cv.height = Math.round(H * BB.dpr);
  BB.stars = null;   // небо пересобирается под новый размер
}
function bbCellAt(ev) {
  const r = BB.cv.getBoundingClientRect();
  // Канвас может быть визуально сжат CSS'ом (max-width на телефоне) —
  // пересчитываем клик из экранных px в мировые, иначе тапы едут мимо клеток.
  const k = r.width ? (BB.cv.width / BB.dpr) / r.width : 1;
  const x = Math.floor((ev.clientX - r.left) * k / BB.cell);
  const y = Math.floor((ev.clientY - r.top) * k / BB.cell);
  const s = BB.st;
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return null;
  return { x, y };
}
function bbDist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function bbUnitAt(x, y) {
  const s = BB.st;
  return (s.units || []).find(u => u.x === x && u.y === y)
      || BB.place.find(p => p.x === x && p.y === y) || null;
}
// Моя зона разворачивания: три колонки со своего края.
function bbInMyZone(x) {
  const s = BB.st;
  return s.my_side === 'attacker' ? x <= 2 : x >= s.w - 3;
}

// ── Ввод ────────────────────────────────────────────────────
function bbBindCanvas() {
  BB.cv.onmousemove = ev => {
    const c = bbCellAt(ev);
    const same = BB.hover && c && BB.hover.x === c.x && BB.hover.y === c.y;
    if (!same) { BB.hover = c; bbPaint(); }
  };
  BB.cv.onmouseleave = () => { BB.hover = null; bbPaint(); };
  BB.cv.onclick = ev => { const c = bbCellAt(ev); if (c) bbClick(c.x, c.y); };
  window.onresize = () => { if (BB.id && BB.cv) { bbFit(); bbPaint(); } };
}

function bbClick(x, y) {
  const s = BB.st; if (!s || BB.busy) return;

  // ── фаза расстановки ──
  if (s.status === 'forming') {
    const hit = BB.place.findIndex(p => p.x === x && p.y === y);
    if (hit >= 0) { BB.place.splice(hit, 1); bbRender(); return; }   // снять с доски
    if (!BB.pick) { toast('Сначала выберите корабль в резерве', 'err'); return; }
    if (!bbInMyZone(x)) { toast('Ставить можно только в свою зону разворачивания', 'err'); return; }
    if (BB.place.length >= s.cap) { toast(`Больше ${s.cap} кораблей в бой не вывести`, 'err'); return; }
    const p = (s.pool || []).find(q => q.unit_id === BB.pick);
    if (!p) return;
    const used = BB.place.filter(q => q.unit_id === p.unit_id).length;
    if (used >= p.free) { toast('Таких кораблей в резерве больше нет', 'err'); return; }
    BB.place.push({ unit_id: p.unit_id, unit_name: p.unit_name, cls: p.cls, x, y });
    bbRender();
    return;
  }

  if (s.status !== 'active' || !s.my_turn) return;

  const tgt = (s.units || []).find(u => u.x === x && u.y === y);
  const sel = (s.units || []).find(u => u.id === BB.sel);

  // клик по своему кораблю — выбрать
  if (tgt && tgt.mine) { BB.sel = (BB.sel === tgt.id ? null : tgt.id); bbRender(); return; }
  if (!sel) return;

  // клик по врагу в зоне поражения — огонь
  if (tgt && !tgt.mine) {
    if (sel.fired) { toast('Этот корабль уже стрелял в этом ходу', 'err'); return; }
    if (bbDist(sel, tgt) > sel.rng) { toast(`До цели ${bbDist(sel, tgt)} клет., «${sel.name}» бьёт на ${sel.rng}`, 'err'); return; }
    bbFire(sel.id, tgt.id);
    return;
  }
  // клик по пустой клетке в радиусе хода — идти
  if (!tgt) {
    if (sel.moved) { toast('Этот корабль уже ходил', 'err'); return; }
    const d = bbDist(sel, { x, y });
    if (d > sel.speed) { toast(`«${sel.name}» проходит ${sel.speed} клет. за ход, а до цели ${d}`, 'err'); return; }
    bbMove(sel.id, x, y);
  }
}

// ── Действия (сервер — истина, после каждого перечитываем состояние) ──
async function bbAct(fn, body, okMsg) {
  if (BB.busy) return;
  BB.busy = true;
  try {
    await ecRpc(fn, body);
    if (okMsg) toast(okMsg, 'ok');
    await bbReload();
  } catch (e) {
    toast((e && e.message) ? e.message : 'Не вышло', 'err');
  } finally { BB.busy = false; }
}
function bbMove(id, x, y) { return bbAct('battle_move', { p_battle: BB.id, p_unit: id, p_x: x, p_y: y }); }
function bbFire(id, tid) { return bbAct('battle_fire', { p_battle: BB.id, p_unit: id, p_target: tid }); }
function bbEndTurn() {
  if (!confirm('Завершить ход? Корабли, которые не двигались и не стреляли, простоят этот ход.')) return;
  BB.sel = null;
  return bbAct('battle_end_turn', { p_battle: BB.id }, 'Ход передан противнику');
}
function bbForce() {
  if (!confirm('Прожать просроченный ход противника? Его ход сгорит, корабли не будут действовать.')) return;
  return bbAct('battle_force_turn', { p_battle: BB.id }, 'Ход противника сгорел');
}
function bbReinforce(uid) {
  if (!confirm('Вызвать подкрепление? Это потратит ВЕСЬ ваш ход — корабли в этом ходу не действуют.')) return;
  BB.sel = null;
  return bbAct('battle_reinforce', { p_battle: BB.id, p_unit_id: uid, p_y: null }, 'Подкрепление вышло на позицию');
}
async function bbConfirmDeploy() {
  if (!BB.place.length) { toast('Выведите на доску хотя бы один корабль', 'err'); return; }
  if (!confirm(`Утвердить состав из ${BB.place.length} кораблей? После подтверждения расстановку не изменить.`)) return;
  BB.busy = true;
  try {
    await ecRpc('battle_deploy', { p_battle: BB.id, p_units: BB.place.map(p => ({ unit_id: p.unit_id, unit_name: p.unit_name, x: p.x, y: p.y })) });
    await ecRpc('battle_ready', { p_battle: BB.id });
    toast('Состав утверждён', 'ok');
    BB.place = []; BB.pick = null;
    await bbReload();
  } catch (e) { toast((e && e.message) ? e.message : 'Не вышло', 'err'); }
  finally { BB.busy = false; }
}

// ════════════════════════════════════════════════════════════
// РЕНДЕР
// ════════════════════════════════════════════════════════════
function bbPaint(t) {
  const s = BB.st, ctx = BB.ctx; if (!s || !ctx) return;
  const C = BB.cell, W = s.w * C, H = s.h * C;
  t = t || performance.now();
  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  bbPaintSpace(ctx, s, C, W, H, t);
  bbPaintZones(ctx, s, C, W, H);
  bbPaintGrid(ctx, s, C, W, H);
  bbPaintHighlights(ctx, s, C);
  bbPaintUnits(ctx, s, C, t);
  bbPaintScan(ctx, W, H);

  // цикл анимации: медленный дрейф звёзд + пульс дюз. Один rAF на доску,
  // гасится в bbClose. Троттлим до ~24 к/с — плавно и дёшево.
  if (!BB.raf) {
    let last = 0;
    const loop = ts => {
      BB.raf = null;
      if (!BB.id || !BB.cv) return;
      if (ts - last > 40) { last = ts; bbPaint(ts); }
      else BB.raf = requestAnimationFrame(loop);
    };
    BB.raf = requestAnimationFrame(loop);
  }
}

// ── КОСМОС: глубокий фон, два слоя звёзд с параллакс-дрейфом, туманности ──
// Звёзды генерируются один раз в офскрин (шире доски), дрейф — сдвигом drawImage.
function bbPaintSpace(ctx, s, C, W, H, t) {
  ctx.fillStyle = '#020409'; ctx.fillRect(0, 0, W, H);
  if (!BB.stars || BB.stars.W !== W || BB.stars.H !== H) bbBuildStars(W, H);
  const st = BB.stars;
  // дальний слой ползёт медленнее ближнего — параллакс даёт глубину
  const o1 = (t * 0.0016) % st.far.width, o2 = (t * 0.004) % st.near.width;
  ctx.drawImage(st.far, -o1, 0); ctx.drawImage(st.far, st.far.width - o1, 0);
  ctx.drawImage(st.near, -o2, 0); ctx.drawImage(st.near, st.near.width - o2, 0);
  // туманности: холодная у зоны циана, тёплая у зоны мадженты + ядро по центру
  const meAtt = s.my_side === 'attacker';
  const neb = (x, y, r, rgb, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  neb(W * 0.12, H * 0.7, H * 0.9, meAtt ? BB_C.mine : BB_C.foe, 0.05);
  neb(W * 0.88, H * 0.25, H * 0.9, meAtt ? BB_C.foe : BB_C.mine, 0.05);
  neb(W * 0.5, H * 0.5, H * 0.75, '80,60,160', 0.05);
  // виньетка — прижимает края
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function bbBuildStars(W, H) {
  // Офскрины строим в CSS-размере: drawImage идёт поверх setTransform(dpr),
  // так что 1px офскрина = 1 CSS-px доски. Дальнему плану лёгкая мягкость к лицу.
  const mkCss = (n, rMax, aMax) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      const r = Math.random() * rMax + 0.3, a = Math.random() * aMax + 0.1;
      // холодная гамма с редкими тёплыми звёздами — живее, но без салата
      const col = Math.random() < 0.12 ? '255,214,170' : Math.random() < 0.4 ? '160,220,255' : '225,238,248';
      x.fillStyle = `rgba(${col},${a})`;
      x.beginPath(); x.arc(Math.random() * W, Math.random() * H, r, 0, 6.2832); x.fill();
    }
    return c;
  };
  const density = W * H / 1000;
  BB.stars = { W, H, far: mkCss(Math.round(density * 0.9), 0.8, 0.35), near: mkCss(Math.round(density * 0.25), 1.5, 0.7) };
}

// Зоны разворачивания — градиент от края + светящаяся кромка, а не плоский прямоугольник.
function bbPaintZones(ctx, s, C, W, H) {
  const meAtt = s.my_side === 'attacker';
  const zone = (x0, wpx, rgb, flip) => {
    const g = ctx.createLinearGradient(flip ? x0 + wpx : x0, 0, flip ? x0 : x0 + wpx, 0);
    g.addColorStop(0, `rgba(${rgb},0.10)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x0, 0, wpx, H);
    const ex = flip ? x0 : x0 + wpx;   // кромка зоны — тонкая неоновая линия
    ctx.strokeStyle = `rgba(${rgb},0.35)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ex + 0.5, 0); ctx.lineTo(ex + 0.5, H); ctx.stroke();
  };
  zone(0, C * 3, meAtt ? BB_C.mine : BB_C.foe, false);
  zone(W - C * 3, C * 3, meAtt ? BB_C.foe : BB_C.mine, true);
}

function bbPaintGrid(ctx, s, C, W, H) {
  // Сетка — разметка тактического сканера, не таблица: тонкая, каждая третья чуть ярче.
  ctx.lineWidth = 1;
  for (let x = 0; x <= s.w; x++) {
    ctx.strokeStyle = (x % 3 === 0) ? BB_C.grid : BB_C.grid2;
    ctx.beginPath(); ctx.moveTo(x * C + 0.5, 0); ctx.lineTo(x * C + 0.5, H); ctx.stroke();
  }
  for (let y = 0; y <= s.h; y++) {
    ctx.strokeStyle = (y % 3 === 0) ? BB_C.grid : BB_C.grid2;
    ctx.beginPath(); ctx.moveTo(0, y * C + 0.5); ctx.lineTo(W, y * C + 0.5); ctx.stroke();
  }
  // клетка под курсором
  if (BB.hover) {
    ctx.strokeStyle = 'rgba(140,240,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(BB.hover.x * C + 1, BB.hover.y * C + 1, C - 2, C - 2);
  }
}

// Подсветка: куда может пойти выбранный корабль и кого достаёт.
function bbPaintHighlights(ctx, s, C) {
  if (s.status === 'forming') return;
  const sel = (s.units || []).find(u => u.id === BB.sel);
  if (!sel || !s.my_turn) return;

  if (!sel.moved) {
    ctx.fillStyle = BB_C.move;
    for (let dx = -sel.speed; dx <= sel.speed; dx++) {
      const rest = sel.speed - Math.abs(dx);
      for (let dy = -rest; dy <= rest; dy++) {
        const x = sel.x + dx, y = sel.y + dy;
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        if (dx === 0 && dy === 0) continue;
        if (bbUnitAt(x, y)) continue;
        ctx.fillRect(x * C + 2, y * C + 2, C - 4, C - 4);
      }
    }
  }
  if (!sel.fired) {
    // кольцо дальности — контур ромба, чтобы не заливать полдоски
    ctx.strokeStyle = 'rgba(255,60,130,0.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    const cx = sel.x * C + C / 2, cy = sel.y * C + C / 2, r = (sel.rng + 0.5) * C;
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
    ctx.closePath(); ctx.stroke();
    // цели в зоне поражения
    ctx.fillStyle = BB_C.fire;
    (s.units || []).forEach(u => {
      if (u.mine || bbDist(sel, u) > sel.rng) return;
      ctx.fillRect(u.x * C + 2, u.y * C + 2, C - 4, C - 4);
    });
  }
}

function bbPaintUnits(ctx, s, C, t) {
  // расставляемые (ещё не на сервере) — полупрозрачные
  if (s.status === 'forming') {
    BB.place.forEach(p => bbShip(ctx, C, p.x, p.y, p.cls, p.unit_name, true, 1, 0, false, 0.55, t));
  }
  (s.units || []).forEach(u => {
    const done = u.mine && s.my_turn && u.moved && u.fired;
    bbShip(ctx, C, u.x, u.y, u.cls, u.name, u.mine, u.hp / u.max_hp,
           u.max_shield > 0 ? u.shield / u.max_shield : 0, u.id === BB.sel, done ? 0.5 : 1, t);
  });
}

// ── Спрайт корабля: настоящий корпус из конструктора ────────────────
// Силуэт класса (CN_HULL_PROFILES) + текстура обшивки (ship_class/ship_armortex),
// неоновый кант стороны, дюзовое свечение. Рисуется ОДИН раз в офскрин на класс×
// сторону×наличие-текстуры и кэшируется — в кадре только drawImage + живые дюзы.
const BB_SPL = 240;   // px корпуса вдоль оси в спрайте (до dpr); нос смотрит вправо
// Геометрия корпуса — ТА ЖЕ, что на верфи: станции CN_SHIP_GEO[cls].st ([y, полуширина]
// нос→корма, ось x=160). Пропорции не искажаем — корабль длинный и узкий, как в конструкторе.
function bbGeo(cls) {
  if (typeof CN_SHIP_GEO !== 'undefined') {
    if (CN_SHIP_GEO[cls]) return CN_SHIP_GEO[cls];
    if (CN_SHIP_GEO.destroyer) return CN_SHIP_GEO.destroyer;
  }
  // конструктор не загружен — простой клин с теми же пропорциями
  return { st: [[0, 0], [40, 16], [170, 40], [250, 30], [300, 20]], engine: [160, 300], maxHW: 40 };
}
// Универсальный загрузчик картинки: null = грузится, false = нет файла, Image = готово.
// Как только картинка приходит — сбрасываем кэш спрайтов (пересоберутся с текстурой).
function bbImg(path) {
  if (path in BB.tex) return BB.tex[path];
  BB.tex[path] = null;
  const img = new Image();
  img.onload = () => { BB.tex[path] = img; BB.spr = {}; };
  img.onerror = () => { BB.tex[path] = false; };
  img.src = path;
  return null;
}
// Первая готовая из списка путей (как cnFirstImg в конструкторе). null пока грузятся.
function bbFirstImg(paths) {
  let pending = false;
  for (const p of paths) { const r = bbImg(p); if (r) return r; if (r === null) pending = true; }
  return pending ? null : false;
}
// Подобрать сохранённый проект под боевой юнит (по имени) → узнаём подкласс/декор,
// чтобы взять ТУ ЖЕ текстуру, что в конструкторе. EC.designs может быть не загружен — тогда null.
function bbDesignOf(name, cls) {
  const ds = (typeof EC !== 'undefined' && EC.designs) || [];
  const clsOf = d => d && d.data && d.data.class;
  return ds.find(d => d && d.category === 'ship' && d.name === name && (clsOf(d) === cls || !cls))
      || ds.find(d => d && d.category === 'ship' && d.name === name) || null;
}
// Ключ спрайта: класс + подкласс + сторона. Один спрайт на связку, кэшируется.
function bbShipKey(cls, tIdx, side) { return cls + '.' + (tIdx == null ? '-' : tIdx) + '.' + side; }

// Спрайт корпуса: силуэт класса + ПОЛНЫЙ стек текстур конструктора
// (тело ship_type/ship_class, обшивка ship_armortex, декор ship_decor) + неон стороны.
function bbSprite(cls, tIdx, side) {
  const key = bbShipKey(cls, tIdx, side);
  const col = side === 'mine' ? BB_C.mine : BB_C.foe;
  const G = 'assets/constructors/';
  const gen = kind => G + 'ship_' + kind + '.webp';
  const cp = (kind, a, b) => G + 'ship_' + kind + '_' + a + (b != null ? '_' + b : '') + '.webp';
  // те же приоритеты файлов, что в cnDrawShip: подкласс → класс → общий
  const body  = bbFirstImg([tIdx != null ? cp('type', cls, tIdx) : null, cp('class', cls), gen('class')].filter(Boolean));
  const armor = bbFirstImg([cp('armortex', cls), gen('armortex')]);
  const decor = bbFirstImg([tIdx != null ? cp('decor', cls, tIdx) : null, cp('decor', cls), gen('decor')].filter(Boolean));
  // Пока текстуры грузятся — отдаём временный спрайт без кэша (пересоберётся, когда придут).
  const ready = body !== null && armor !== null && decor !== null;
  if (ready && BB.spr[key]) return BB.spr[key];

  const H = bbGeo(cls);
  const tip = Math.min(...H.st.map(p => p[0]));
  const stern = H.engine ? H.engine[1] : Math.max(...H.st.map(p => p[0]));
  const L = stern - tip, halfB = H.maxHW || Math.max(...H.st.map(p => p[1]));
  const padL = 30, padR = 10, padY = 8;          // слева запас под факел дюз
  const k = BB_SPL / L;                           // констр.единицы → px спрайта
  const SW = Math.round(padL + BB_SPL + padR);
  const SH = Math.round(halfB * 2 * k + padY * 2);
  const cyS = SH / 2;
  const cv = document.createElement('canvas');
  cv.width = Math.round(SW * BB.dpr); cv.height = Math.round(SH * BB.dpr);
  cv._geo = { padL, SW, SH, hullW: BB_SPL };      // для позиционирования на доске
  const x = cv.getContext('2d');

  // Силуэт по станциям (как cnStPath на верфи), в координатах конструктора (нос вверх).
  const outline = wf => {
    const R2 = H.st.map(p => [160 + p[1] * wf, p[0]]), L2 = H.st.slice().reverse().map(p => [160 - p[1] * wf, p[0]]);
    return 'M' + R2.concat(L2).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
  };
  const path = new Path2D(outline(1));
  // пояс брони: кольцо силуэт ↔ внутренний контур 0.55 (как cnBeltClip на верфи)
  const belt = new Path2D(outline(1) + ' ' + outline(0.55));
  // Конструктор (нос вверх) → спрайт (нос вправо): sx = padL+(stern−y)·k, sy = cyS+(xc−160)·k
  const T = () => { x.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0); x.transform(0, k, -k, 0, padL + stern * k, cyS - 160 * k); };
  const R = () => x.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);   // обычные px спрайта

  // ФАКЕЛ ДЮЗ у кормы — клинья, как на верфи (запекаем; живой пульс добавляется поверх)
  R();
  [[0, 1], [-0.6, 0.72], [0.6, 0.72]].forEach(([oy, sc2]) => {
    const yj = cyS + oy * halfB * k * 0.5, fl = 24 * sc2;
    const fg = x.createLinearGradient(padL + 2, 0, padL - fl, 0);
    fg.addColorStop(0, `rgba(${col},0.8)`); fg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = fg;
    x.beginPath();
    x.moveTo(padL + 2, yj - 3 * sc2); x.lineTo(padL + 2, yj + 3 * sc2); x.lineTo(padL - fl, yj);
    x.closePath(); x.fill();
  });

  // тень-подложка (отрывает корабль от космоса)
  T();
  x.save(); x.shadowColor = 'rgba(0,0,0,0.7)'; x.shadowBlur = 10; x.fillStyle = '#0a0f16'; x.fill(path); x.restore();

  // ТЕЛО: стек текстур конструктора, обрезанный по силуэту. Текстуры кладутся
  // горизонтально (нос вправо) на полный габарит корпуса — как на верфи.
  x.save(); T(); x.clip(path);
  R();
  const bx0 = padL, by0 = cyS - halfB * k, bw = BB_SPL, bh = halfB * 2 * k;
  x.fillStyle = '#10161d'; x.fillRect(bx0 - 2, by0 - 2, bw + 4, bh + 4);   // база под полупрозрачные текстуры
  if (body)  x.drawImage(body,  bx0, by0, bw, bh);
  if (!body && !armor) {                                                    // совсем нет файлов — графит
    const g = x.createLinearGradient(0, by0, 0, by0 + bh);
    g.addColorStop(0, `rgba(${col},0.40)`); g.addColorStop(0.5, `rgba(${col},0.18)`); g.addColorStop(1, 'rgba(6,10,16,0.9)');
    x.fillStyle = g; x.fillRect(bx0, by0, bw, bh);
  }
  x.fillStyle = `rgba(${col},0.06)`; x.fillRect(bx0, by0, bw, bh);          // едва заметный оттенок стороны
  // объём цилиндра: свет по верхнему борту, тень по нижнему
  const lg = x.createLinearGradient(0, by0, 0, by0 + bh);
  lg.addColorStop(0, 'rgba(255,255,255,0.14)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.45)');
  x.fillStyle = lg; x.fillRect(bx0, by0, bw, bh);
  x.restore();

  // ПОЯС БРОНИ: обшивка лежит ТОЛЬКО по бортам (кольцо силуэт↔внутренний контур),
  // палуба в центре остаётся тёмной — ровно как на верфи (cnBeltClip, evenodd).
  if (armor) {
    x.save(); T(); x.clip(belt, 'evenodd');
    R();
    x.globalAlpha = 0.85; x.drawImage(armor, bx0, by0, bw, bh); x.globalAlpha = 1;
    x.restore();
  }
  // ДЕКОР (эмблемы/полосы/надписи — «декали») — поверх всего корпуса, в клипе силуэта
  if (decor) {
    x.save(); T(); x.clip(path);
    R();
    x.drawImage(decor, bx0, by0, bw, bh);
    x.restore();
  }

  // Кромка как на верфи (серый контур) + неон-гало цвета стороны для опознания
  T();
  x.lineJoin = 'round';
  x.strokeStyle = `rgba(${col},0.30)`; x.lineWidth = 4.5 / k; x.stroke(path);
  x.strokeStyle = 'rgba(207,214,221,0.85)'; x.lineWidth = 1.4 / k; x.stroke(path);
  R();

  if (ready) BB.spr[key] = cv;
  return cv;
}

// Рисуем корабль в клетке: живые дюзы под кораблём, затем спрайт, кольцо выбора, полоски HP/щита.
function bbShip(ctx, C, gx, gy, cls, name, isMine, hpFrac, shFrac, selected, alpha, t) {
  const s = BB.st;
  const cx = gx * C + C / 2, cy = gy * C + C / 2;
  const col = isMine ? BB_C.mine : BB_C.foe;
  // свои смотрят к врагу (нападающий всегда слева)
  const dir = isMine === (s.my_side === 'attacker') ? 1 : -1;
  // подкласс из сохранённого проекта (если EC.designs под рукой) — для той же текстуры
  const dsn = bbDesignOf(name, cls);
  const tIdx = dsn && dsn.data && dsn.data.type != null ? dsn.data.type : null;
  const spr = bbSprite(cls, tIdx, isMine ? 'mine' : 'foe');
  const g = spr._geo;
  // длина корпуса в клетках растёт с классом; пропорции — верфевые (узкий и длинный)
  const len = C * (0.92 + bbClsSize(cls) * 0.75);
  const sc = len / g.hullW, dw = g.SW * sc, dh = g.SH * sc;

  ctx.save();
  ctx.globalAlpha = alpha;

  // ДЮЗЫ: живой пульс у кормы поверх запечённого факела.
  const pulse = 0.55 + 0.45 * Math.sin((t || 0) * 0.006 + gx * 1.3 + gy * 0.7);
  const stern = cx - dir * len * 0.5, fr = C * (0.09 + 0.07 * pulse);
  const fg = ctx.createRadialGradient(stern, cy, 0, stern, cy, fr * 2.4);
  fg.addColorStop(0, `rgba(${col},${0.5 * pulse})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(stern, cy, fr * 2.4, 0, 6.2832); ctx.fill();

  if (selected) {   // кольцо выбора
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]); ctx.lineDashOffset = -(t || 0) * 0.02;
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.48, 0, 6.2832); ctx.stroke();
    ctx.setLineDash([]);
  }

  // спрайт корпуса (нос вправо → зеркалим для смотрящих влево)
  ctx.translate(cx, cy);
  if (dir < 0) ctx.scale(-1, 1);
  ctx.drawImage(spr, -(g.padL + g.hullW / 2) * sc, -dh / 2, dw, dh);
  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);   // сброс зеркала перед полосками

  // полоски состояния под корпусом
  const bw = C * 0.68, bx = cx - bw / 2, by = cy + Math.max(C * 0.30, dh / 2 + 5);
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

// Сканлайны — тонкая киберпанк-подложка, дёшево и не мешает читать доску.
function bbPaintScan(ctx, W, H) {
  ctx.save();
  ctx.globalAlpha = 0.05; ctx.fillStyle = '#8ff';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════
// ☄ ГОРЯЧИЕ ТОЧКИ — страница сайдменю: все бои, в которых участвует
// фракция, одним списком. Раньше вход в бой был закопан во вкладке
// «⚔ Война» кабинета — игроки его не находили. Данные — battles_mine
// (тот же RPC, что кормит кабинет), страница самодостаточна: работает
// даже если кабинет ещё не открывали.
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
  if (typeof curSlug !== 'undefined' && curSlug !== 'hotspots') return;   // ушли со страницы, пока грузилось
  if (!Array.isArray(battles)) {
    // Причину показываем целиком: RPC может падать из-за ненакаченного SQL
    // (battles_mine/_fleet_settle) — без текста это не продиагностировать.
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
          <span class="hs-kind">${b.kind === 'intercept' ? '🛑 перехват на трассе' : '⚔ встреча флотов'}</span>
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

// Бейдж на  сайдменю «Горячие точки» — число активных боёв.
function hsNavBadge(n) {
  const a = document.getElementById('ntl-hot'); if (!a) return;
  let b = a.querySelector('.hs-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'hs-badge'; a.appendChild(b); }
    b.textContent = n;
  } else if (b) b.remove();
}
