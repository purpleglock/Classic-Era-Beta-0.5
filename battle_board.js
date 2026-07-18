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
};

// Палитра: держим в одном месте, чтобы доска не расползлась по цветам.
const BB_C = {
  bg:     '#05070d',
  grid:   'rgba(90,200,230,0.10)',
  gridHi: 'rgba(90,200,230,0.22)',
  mine:   '90,220,240',    // циан — свои
  foe:    '255,60,130',    // маджента — чужие
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
  BB.id = null; BB.st = null; BB.cv = null; BB.ctx = null;
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
          <canvas id="bb-cv" class="bb-cv"></canvas>
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
  const availH = Math.max(240, window.innerHeight - (wide ? 210 : 320));
  BB.cell = Math.max(16, Math.floor(Math.min(availW / s.w, availH / s.h)));
  BB.dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = BB.cell * s.w, H = BB.cell * s.h;
  BB.cv.style.width = W + 'px'; BB.cv.style.height = H + 'px';
  BB.cv.width = Math.round(W * BB.dpr); BB.cv.height = Math.round(H * BB.dpr);
}
function bbCellAt(ev) {
  const r = BB.cv.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / BB.cell);
  const y = Math.floor((ev.clientY - r.top) / BB.cell);
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
function bbPaint() {
  const s = BB.st, ctx = BB.ctx; if (!s || !ctx) return;
  const C = BB.cell, W = s.w * C, H = s.h * C;
  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // фон + виньетка
  ctx.fillStyle = BB_C.bg; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(30,80,110,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  bbPaintZones(ctx, s, C, W, H);
  bbPaintGrid(ctx, s, C, W, H);
  bbPaintHighlights(ctx, s, C);
  bbPaintUnits(ctx, s, C);
  bbPaintScan(ctx, W, H);
}

// Зоны разворачивания — заливка со стороны каждого края.
function bbPaintZones(ctx, s, C, W, H) {
  const meAtt = s.my_side === 'attacker';
  ctx.fillStyle = meAtt ? BB_C.zoneA : BB_C.zoneD;
  ctx.fillRect(0, 0, C * 3, H);
  ctx.fillStyle = meAtt ? BB_C.zoneD : BB_C.zoneA;
  ctx.fillRect(W - C * 3, 0, C * 3, H);
}

function bbPaintGrid(ctx, s, C, W, H) {
  ctx.lineWidth = 1;
  for (let x = 0; x <= s.w; x++) {
    ctx.strokeStyle = (x % 3 === 0) ? BB_C.gridHi : BB_C.grid;
    ctx.beginPath(); ctx.moveTo(x * C + 0.5, 0); ctx.lineTo(x * C + 0.5, H); ctx.stroke();
  }
  for (let y = 0; y <= s.h; y++) {
    ctx.strokeStyle = (y % 3 === 0) ? BB_C.gridHi : BB_C.grid;
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

function bbPaintUnits(ctx, s, C) {
  // расставляемые (ещё не на сервере) — полупрозрачные
  if (s.status === 'forming') {
    BB.place.forEach(p => bbShip(ctx, C, p.x, p.y, p.cls, BB_C.mine, 1, 1, false, 0.55));
  }
  (s.units || []).forEach(u => {
    const col = u.mine ? BB_C.mine : BB_C.foe;
    const done = u.mine && s.my_turn && u.moved && u.fired;
    bbShip(ctx, C, u.x, u.y, u.cls, col, u.hp / u.max_hp,
           u.max_shield > 0 ? u.shield / u.max_shield : 0, u.id === BB.sel, done ? 0.45 : 1);
  });
}

// Силуэт корабля: клин, повёрнутый к врагу. Габарит = класс.
// Никаких спрайтов — вектор, чтобы доска не зависела от картинок.
function bbShip(ctx, C, gx, gy, cls, col, hpFrac, shFrac, selected, alpha) {
  const s = BB.st;
  const cx = gx * C + C / 2, cy = gy * C + C / 2;
  const k = bbClsSize(cls) * C * 0.5;
  // свои смотрят вправо, чужие влево (нападающий всегда слева)
  const dir = (col === BB_C.mine) === (s.my_side === 'attacker') ? 1 : -1;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (selected) {   // кольцо выбора
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.46, 0, 6.2832); ctx.stroke();
  }

  // корпус
  ctx.beginPath();
  ctx.moveTo(cx + dir * k, cy);
  ctx.lineTo(cx - dir * k * 0.7, cy - k * 0.62);
  ctx.lineTo(cx - dir * k * 0.35, cy);
  ctx.lineTo(cx - dir * k * 0.7, cy + k * 0.62);
  ctx.closePath();
  ctx.fillStyle = `rgba(${col},0.18)`; ctx.fill();
  ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 1.6; ctx.stroke();
  // неон-гало
  ctx.globalAlpha = alpha * 0.22; ctx.lineWidth = 5; ctx.stroke();
  ctx.globalAlpha = alpha;

  // полоски состояния под корпусом
  const bw = C * 0.72, bx = cx - bw / 2, by = cy + C * 0.34;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, 3);
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
