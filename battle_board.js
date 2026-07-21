// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════
// ДОСКА БОЯ — пошаговое сражение флотов (переработка: ГЕКСЫ + АКТИВАЦИИ)
// Зеркало _war_battle.sql + _war_battle_rework.sql.
//
// ХОД СТОРОНЫ = 6 АКТИВАЦИЙ кораблями: активируется корабль, когда впервые
// действует в этом ходу (ход и/или выстрел). Один корабль за ход — не больше
// одного перемещения и одного выстрела. Ход можно целиком разменять на вызов
// одного корабля из резерва.
//
// ТТХ — из конструктора (KV): подвижность = summary.speed («квадраты»),
// дальность огня = summary.rng (max dalnost орудий). Сервер — истина.
//
// Доска — ГЕКСЫ flat-top в odd-q offset (x = колонка, нечётные смещены вниз).
// Рендер — canvas с КАМЕРОЙ: зум (пинч/колесо/кнопки) и панорама (драг).
// Камера живёт в BB и НЕ сбрасывается при перерисовке — телефон больше не
// «скидывает» доску влево после каждого хода.
// ════════════════════════════════════════════════════════════════════

const BB = {
  id: null,          // id боя
  st: null,          // ответ battle_state
  cv: null, ctx: null,
  R: 34,             // радиус гекса в МИРОВЫХ px (зум поверх)
  dpr: 1,
  vw: 0, vh: 0,      // размер вьюпорта канваса (CSS px)
  zoom: 1, camX: 0, camY: 0,   // камера: масштаб и мировая точка в левом-верхнем углу
  camReady: false,   // камера один раз центрируется на своей зоне и дальше не трогается
  sel: null,         // выбранный свой корабль (id)
  hover: null,       // {x,y} гекс под курсором
  pick: null,        // фаза расстановки: выбранный проект из резерва
  place: [],         // фаза расстановки: [{unit_id, unit_name, cls, x, y}]
  poll: null,        // таймер опроса (ход противника)
  busy: false,
  spr: {},           // кэш спрайтов кораблей: cls_side → canvas
  tex: {},           // кэш текстур корпуса: cls → Image|null (null = грузится/нет)
  stars: null,       // офскрин-звёздное небо (пересобирается при ресайзе)
  raf: null,         // цикл анимации (дрейф звёзд, пульс дюз)
  ptrs: new Map(),   // активные пойнтеры (пан/пинч)
  drag: null,        // {sx, sy, camX, camY, moved}
  pinch: null,       // {d, zoom, mx, my}
};

const BB_SQ3 = Math.sqrt(3);

// Палитра: держим в одном месте, чтобы доска не расползлась по цветам.
const BB_C = {
  bg:     '#05070d',
  hex:    'rgba(90,200,230,0.14)',   // кант гекса
  hexIn:  'rgba(90,200,230,0.03)',   // едва заметная заливка сот
  mine:   '90,220,240',    // циан — свои
  foe:    '255,60,130',    // маджента — чужие
  move:   'rgba(90,220,240,0.18)',
  fire:   'rgba(255,60,130,0.22)',
  fireEdge: 'rgba(255,60,130,0.30)',
};

// ── Открыть / закрыть ───────────────────────────────────────
async function bbOpen(battleId) {
  BB.id = battleId; BB.sel = null; BB.pick = null; BB.place = [];
  BB.camReady = false;
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
  BB.ptrs.clear(); BB.drag = null; BB.pinch = null;
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
          <div class="bb-cvw">
            <canvas id="bb-cv" class="bb-cv"></canvas>
            <div class="bb-zoom">
              <button class="bb-zbtn" title="Приблизить" onclick="bbZoomBtn(1.3)">+</button>
              <button class="bb-zbtn" title="Отдалить" onclick="bbZoomBtn(1/1.3)">−</button>
              <button class="bb-zbtn" title="К своим кораблям" onclick="bbCamHome()">⌂</button>
            </div>
          </div>
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

// Полоса состояния: чей ход, активации, сколько ходов осталось, срок явки.
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
  const actsMax = s.acts_max || 6;
  const acts = mv ? `<span class="bb-acts" title="Активаций кораблями в этом ходу">
      ${'◆'.repeat(Math.max(0, s.acts_left || 0))}${'◇'.repeat(Math.max(0, actsMax - (s.acts_left || 0)))}
      <i>${s.acts_left || 0}/${actsMax}</i></span>` : '';
  return `<div class="bb-bar ${mv ? 'bb-bar-my' : 'bb-bar-foe'}">
      <b>${mv ? 'Ваш ход' : 'Ход противника'}</b>${acts}
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
      <div class="bb-panel-h">Выберите корабль, затем клик по своей зоне (подсвеченные гексы у вашего края). Максимум ${s.cap} на доске. Клик по уже поставленному — снять.</div>
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
      <div class="bb-panel-h">${s.my_turn ? `Кликните по своему кораблю: подсветятся гексы хода и цели в зоне поражения. За ход можно активировать ${s.acts_max || 6} кораблей.` : 'Сейчас ходит противник. Доска обновится сама.'}</div>
    </div>${reinf}`;
  const pct = v => Math.max(0, Math.min(100, v));
  return `<div class="bb-panel">
      <div class="bb-panel-t">${esc(u.name)}</div>
      <div class="bb-panel-h">${bbClsName(u.cls)}${u.mine && u.acted ? ' · <b>активирован</b>' : ''}</div>
      <div class="bb-stat"><span>Корпус</span><b>${u.hp} / ${u.max_hp}</b></div>
      <div class="bb-bar-hp"><i style="width:${pct(u.hp / u.max_hp * 100)}%"></i></div>
      ${u.max_shield > 0 ? `<div class="bb-stat"><span>Щит</span><b>${u.shield} / ${u.max_shield}</b></div>
        <div class="bb-bar-sh"><i style="width:${pct(u.shield / u.max_shield * 100)}%"></i></div>` : ''}
      <div class="bb-stat"><span>Броня</span><b>${u.armor}</b></div>
      <div class="bb-stat"><span>Залп</span><b>${u.dmg}</b></div>
      <div class="bb-stat"><span>Ход</span><b>${u.speed} гекс. ${u.moved ? '— израсходован' : ''}</b></div>
      <div class="bb-stat"><span>Дальность</span><b>${u.rng} гекс. ${u.fired ? '— уже стрелял' : ''}</b></div>
      ${u.mine && s.my_turn ? `<div class="bb-panel-h" style="margin-top:8px">${u.moved && u.fired ? 'Корабль отработал этот ход.' : (!u.acted && !(s.acts_left > 0) ? 'Активации кончились — этот корабль в этом ходу не действует.' : 'Клик по подсвеченному гексу — идти, по цели в зоне поражения — огонь.')}</div>` : ''}
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
  cruiser:    'Крейсер', battleship: 'Линкор', dreadnought: 'Дредноут',
  supportCarrier: 'Носитель поддержки', mediumCruiser: 'Средний крейсер',
  hyperCruiser: 'Гиперкрейсер', multiroleCarrier: 'Многоцелевой носитель', ss13: 'Станция'
};
function bbClsName(c) { return BB_CLS[c] || 'Корабль'; }
function bbClsIco(c) {
  const n = { corvette: '▸', frigate: '▶', destroyer: '◆', cruiser: '⬢', battleship: '⬣', dreadnought: '⬟',
              supportCarrier: '⬨', mediumCruiser: '⬢', hyperCruiser: '⬡', multiroleCarrier: '⬨', ss13: '✦' };
  return n[c] || '▸';
}
// Размер силуэта в долях гекса — класс читается по габариту, а не по подписи.
function bbClsSize(c) {
  return ({ corvette: 0.42, frigate: 0.52, destroyer: 0.60, cruiser: 0.68, battleship: 0.80, dreadnought: 0.92,
            supportCarrier: 0.66, mediumCruiser: 0.68, hyperCruiser: 0.76, multiroleCarrier: 0.78, ss13: 0.85 })[c] || 0.55;
}

// ── ГЕКС-ГЕОМЕТРИЯ (flat-top, odd-q offset; зеркало _bt_dist) ──
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
// Мировая точка → гекс: ближайший центр среди кандидатов вокруг оценённой колонки.
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
  if (best && bd <= (R * 0.98) ** 2) return best;
  return null;
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
// Моя зона разворачивания: s.zone колонок со своего края.
function bbInMyZone(x) {
  const s = BB.st, z = s.zone || 3;
  return s.my_side === 'attacker' ? x < z : x >= s.w - z;
}

// ── КАМЕРА ──────────────────────────────────────────────────
function bbFit() {
  const s = BB.st; if (!s || !BB.cv) return;
  const wrap = BB.cv.parentElement;   // .bb-cvw
  const wide = window.innerWidth > 900;
  BB.vw = Math.max(240, wrap.clientWidth || 320);
  BB.vh = Math.max(260, window.innerHeight - (wide ? 210 : 330));
  wrap.style.height = BB.vh + 'px';
  BB.dpr = Math.min(2, window.devicePixelRatio || 1);
  BB.cv.style.width = BB.vw + 'px'; BB.cv.style.height = BB.vh + 'px';
  BB.cv.width = Math.round(BB.vw * BB.dpr); BB.cv.height = Math.round(BB.vh * BB.dpr);
  BB.stars = null;   // небо пересобирается под новый размер
  if (!BB.camReady) { bbCamHome(); BB.camReady = true; }
  bbCamClamp();
}
// Камера домой: своя зона разворачивания в кадре (свой край доски).
function bbCamHome() {
  const s = BB.st; if (!s) return;
  const { W, H } = bbWorldSize();
  // стартовый зум: доска по высоте влезает целиком, но гексы не мельче ~22px
  BB.zoom = Math.max(Math.min(BB.vh / H, BB.vw / W) , 22 / (BB.R * BB_SQ3));
  BB.zoom = Math.min(BB.zoom, 1.6);
  const meAtt = s.my_side === 'attacker';
  // свои корабли (или своя зона) — в центр кадра
  const mine = (s.units || []).filter(u => u.mine);
  let fx;
  if (mine.length) fx = mine.reduce((a, u) => a + bbHexCenter(u.x, u.y).px, 0) / mine.length;
  else fx = meAtt ? BB.R * 4 : W - BB.R * 4;
  BB.camX = fx - BB.vw / BB.zoom / 2;
  BB.camY = H / 2 - BB.vh / BB.zoom / 2;
  bbCamClamp();
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
  // точка под курсором остаётся на месте
  BB.camX += sx / z0 - sx / z1;
  BB.camY += sy / z0 - sy / z1;
  BB.zoom = z1;
  bbCamClamp();
  bbPaint();
}
function bbZoomBtn(f) { bbZoomAt(f, BB.vw / 2, BB.vh / 2); }

// ── Ввод: пан/пинч/клик/ховер через pointer events ──────────
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
  cv.style.touchAction = 'none';   // жесты обрабатываем сами — страница не скроллится

  cv.onpointerdown = ev => {
    cv.setPointerCapture(ev.pointerId);
    BB.ptrs.set(ev.pointerId, bbScreenXY(ev));
    if (BB.ptrs.size === 1) {
      const p = bbScreenXY(ev);
      BB.drag = { sx: p.sx, sy: p.sy, camX: BB.camX, camY: BB.camY, moved: false };
      BB.pinch = null;
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
    // ховер (мышь без зажатия)
    if (ev.pointerType === 'mouse' && !BB.drag) {
      const c = bbHexAt(ev);
      const same = BB.hover && c && BB.hover.x === c.x && BB.hover.y === c.y;
      if (!same) { BB.hover = c; bbPaint(); }
    }
  };
  cv.onpointerup = ev => {
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
  cv.onpointercancel = ev => { BB.ptrs.delete(ev.pointerId); BB.drag = null; if (BB.ptrs.size < 2) BB.pinch = null; };
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

  // новый корабль без активаций — не пускаем зря на сервер
  const noActs = !sel.acted && !(s.acts_left > 0);

  // клик по врагу в зоне поражения — огонь
  if (tgt && !tgt.mine) {
    if (sel.fired) { toast('Этот корабль уже стрелял в этом ходу', 'err'); return; }
    if (noActs) { toast(`Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей`, 'err'); return; }
    if (bbDist(sel, tgt) > sel.rng) { toast(`До цели ${bbDist(sel, tgt)} гекс., «${sel.name}» бьёт на ${sel.rng}`, 'err'); return; }
    bbFire(sel.id, tgt.id);
    return;
  }
  // клик по пустому гексу в радиусе хода — идти
  if (!tgt) {
    if (sel.moved) { toast('Этот корабль уже ходил', 'err'); return; }
    if (noActs) { toast(`Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей`, 'err'); return; }
    const d = bbDist(sel, { x, y });
    if (d > sel.speed) { toast(`«${sel.name}» проходит ${sel.speed} гекс. за ход, а до цели ${d}`, 'err'); return; }
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
  if (!confirm('Завершить ход? Неиспользованные активации сгорят.')) return;
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
// РЕНДЕР: небо в экранных координатах, доска — через камеру
// ════════════════════════════════════════════════════════════
function bbPaint(t) {
  const s = BB.st, ctx = BB.ctx; if (!s || !ctx) return;
  t = t || performance.now();

  // фон-космос — в экранных координатах (не дёргается с камерой)
  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);
  ctx.clearRect(0, 0, BB.vw, BB.vh);
  bbPaintSpace(ctx, s, BB.vw, BB.vh, t);

  // мир: камера
  const z = BB.zoom;
  ctx.setTransform(BB.dpr * z, 0, 0, BB.dpr * z, -BB.camX * BB.dpr * z, -BB.camY * BB.dpr * z);
  bbPaintHexes(ctx, s, t);
  bbPaintHighlights(ctx, s);
  bbPaintUnits(ctx, s, t);

  // сканлайны — снова экранные
  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);
  bbPaintScan(ctx, BB.vw, BB.vh);

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

// Только видимые в кадре гексы: колонки/строки из мировых границ вьюпорта.
function bbVisibleCells(s) {
  const R = BB.R;
  const x0 = Math.max(0, Math.floor((BB.camX - 2 * R) / (R * 1.5)));
  const x1 = Math.min(s.w - 1, Math.ceil((BB.camX + BB.vw / BB.zoom) / (R * 1.5)));
  const y0 = Math.max(0, Math.floor((BB.camY - 2 * R) / (R * BB_SQ3)) - 1);
  const y1 = Math.min(s.h - 1, Math.ceil((BB.camY + BB.vh / BB.zoom) / (R * BB_SQ3)) + 1);
  return { x0, x1, y0, y1 };
}

// ── КОСМОС: глубокий фон, два слоя звёзд с параллакс-дрейфом, туманности ──
function bbPaintSpace(ctx, s, W, H, t) {
  ctx.fillStyle = '#020409'; ctx.fillRect(0, 0, W, H);
  if (!BB.stars || BB.stars.W !== W || BB.stars.H !== H) bbBuildStars(W, H);
  const st = BB.stars;
  // дрейф от времени + лёгкий параллакс от камеры — глубина
  const o1 = ((t * 0.0016 + BB.camX * 0.05 * BB.zoom) % st.far.width + st.far.width) % st.far.width;
  const o2 = ((t * 0.004 + BB.camX * 0.12 * BB.zoom) % st.near.width + st.near.width) % st.near.width;
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

// ── СОТЫ: стилизованные гексы + зоны разворачивания ─────────
function bbPaintHexes(ctx, s, t) {
  const R = BB.R, { x0, x1, y0, y1 } = bbVisibleCells(s);
  const meAtt = s.my_side === 'attacker';
  const z = s.zone || 3;
  const lw = Math.max(0.6, 1 / BB.zoom);
  for (let x = x0; x <= x1; x++) {
    const zoneCol = x < z ? 'att' : (x >= s.w - z ? 'def' : null);
    const zoneRgb = zoneCol ? (zoneCol === 'att' ? (meAtt ? BB_C.mine : BB_C.foe) : (meAtt ? BB_C.foe : BB_C.mine)) : null;
    for (let y = y0; y <= y1; y++) {
      const c = bbHexCenter(x, y);
      bbHexPath(ctx, c.px, c.py, R * 0.96);
      // соты сканера: едва заметная заливка, зона — оттенок стороны
      ctx.fillStyle = zoneRgb ? `rgba(${zoneRgb},0.06)` : BB_C.hexIn;
      ctx.fill();
      ctx.strokeStyle = zoneRgb ? `rgba(${zoneRgb},0.28)` : BB_C.hex;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }
  // гекс под курсором
  if (BB.hover) {
    const c = bbHexCenter(BB.hover.x, BB.hover.y);
    bbHexPath(ctx, c.px, c.py, R * 0.92);
    ctx.strokeStyle = 'rgba(140,240,255,0.6)'; ctx.lineWidth = lw * 1.8;
    ctx.stroke();
  }
}

// Подсветка: куда может пойти выбранный корабль и кого достаёт.
function bbPaintHighlights(ctx, s) {
  if (s.status === 'forming') return;
  const sel = (s.units || []).find(u => u.id === BB.sel);
  if (!sel || !s.my_turn) return;
  const R = BB.R, { x0, x1, y0, y1 } = bbVisibleCells(s);
  const canAct = sel.acted || s.acts_left > 0;

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const d = bbDist(sel, { x, y });
      if (d === 0) continue;
      const c = bbHexCenter(x, y);
      // гексы хода
      if (!sel.moved && canAct && d <= sel.speed && !bbUnitAt(x, y)) {
        bbHexPath(ctx, c.px, c.py, R * 0.82);
        ctx.fillStyle = BB_C.move; ctx.fill();
      }
      // кромка зоны поражения — кольцо на дистанции rng
      if (!sel.fired && d === sel.rng) {
        bbHexPath(ctx, c.px, c.py, R * 0.5);
        ctx.strokeStyle = BB_C.fireEdge; ctx.lineWidth = Math.max(0.6, 1 / BB.zoom);
        ctx.stroke();
      }
    }
  }
  // цели в зоне поражения
  if (!sel.fired && canAct) {
    (s.units || []).forEach(u => {
      if (u.mine || bbDist(sel, u) > sel.rng) return;
      const c = bbHexCenter(u.x, u.y);
      bbHexPath(ctx, c.px, c.py, R * 0.9);
      ctx.fillStyle = BB_C.fire; ctx.fill();
    });
  }
}

function bbPaintUnits(ctx, s, t) {
  // расставляемые (ещё не на сервере) — полупрозрачные
  if (s.status === 'forming') {
    BB.place.forEach(p => bbShip(ctx, p.x, p.y, p.cls, p.unit_name, true, 1, 0, false, 0.55, t));
  }
  (s.units || []).forEach(u => {
    const spent = u.mine && s.my_turn && ((u.moved && u.fired) || (!u.acted && !(s.acts_left > 0)));
    bbShip(ctx, u.x, u.y, u.cls, u.name, u.mine, u.hp / u.max_hp,
           u.max_shield > 0 ? u.shield / u.max_shield : 0, u.id === BB.sel, spent ? 0.5 : 1, t);
  });
}

// ── Спрайт корабля: настоящий корпус из конструктора ────────────────
// Силуэт класса (CN_SHIP_GEO) + текстуры обшивки, неоновый кант стороны,
// дюзовое свечение. Рисуется ОДИН раз в офскрин и кэшируется.
const BB_SPL = 240;   // px корпуса вдоль оси в спрайте (до dpr); нос смотрит вправо
function bbGeo(cls) {
  if (typeof CN_SHIP_GEO !== 'undefined') {
    if (CN_SHIP_GEO[cls]) return CN_SHIP_GEO[cls];
    if (CN_SHIP_GEO.destroyer) return CN_SHIP_GEO.destroyer;
  }
  // конструктор не загружен — простой клин с теми же пропорциями
  return { st: [[0, 0], [40, 16], [170, 40], [250, 30], [300, 20]], engine: [160, 300], maxHW: 40 };
}
// Универсальный загрузчик картинки: null = грузится, false = нет файла, Image = готово.
function bbImg(path) {
  if (path in BB.tex) return BB.tex[path];
  BB.tex[path] = null;
  const img = new Image();
  img.onload = () => { BB.tex[path] = img; BB.spr = {}; };
  img.onerror = () => { BB.tex[path] = false; };
  img.src = path;
  return null;
}
function bbFirstImg(paths) {
  let pending = false;
  for (const p of paths) { const r = bbImg(p); if (r) return r; if (r === null) pending = true; }
  return pending ? null : false;
}
// Подобрать сохранённый проект под боевой юнит (по имени) → узнаём подкласс/декор.
function bbDesignOf(name, cls) {
  const ds = (typeof EC !== 'undefined' && EC.designs) || [];
  const clsOf = d => d && d.data && d.data.class;
  return ds.find(d => d && d.category === 'ship' && d.name === name && (clsOf(d) === cls || !cls))
      || ds.find(d => d && d.category === 'ship' && d.name === name) || null;
}
function bbShipKey(cls, tIdx, side) { return cls + '.' + (tIdx == null ? '-' : tIdx) + '.' + side; }

// Спрайт корпуса: силуэт класса + ПОЛНЫЙ стек текстур конструктора + неон стороны.
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
  const padL = 30, padR = 10, padY = 8;          // слева запас под факел дюз
  const k = BB_SPL / L;                           // констр.единицы → px спрайта
  const SW = Math.round(padL + BB_SPL + padR);
  const SH = Math.round(halfB * 2 * k + padY * 2);
  const cyS = SH / 2;
  const cv = document.createElement('canvas');
  cv.width = Math.round(SW * BB.dpr); cv.height = Math.round(SH * BB.dpr);
  cv._geo = { padL, SW, SH, hullW: BB_SPL };      // для позиционирования на доске
  const x = cv.getContext('2d');

  const outline = wf => {
    const R2 = H.st.map(p => [160 + p[1] * wf, p[0]]), L2 = H.st.slice().reverse().map(p => [160 - p[1] * wf, p[0]]);
    return 'M' + R2.concat(L2).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
  };
  const path = new Path2D(outline(1));
  const belt = new Path2D(outline(1) + ' ' + outline(0.55));
  const T = () => { x.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0); x.transform(0, k, -k, 0, padL + stern * k, cyS - 160 * k); };
  const R = () => x.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);

  // ФАКЕЛ ДЮЗ у кормы (запекаем; живой пульс добавляется поверх)
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

  // ТЕЛО: стек текстур конструктора, обрезанный по силуэту.
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

  // ПОЯС БРОНИ: обшивка лежит ТОЛЬКО по бортам, палуба в центре тёмная.
  if (armor) {
    x.save(); T(); x.clip(belt, 'evenodd');
    R();
    x.globalAlpha = 0.85; x.drawImage(armor, bx0, by0, bw, bh); x.globalAlpha = 1;
    x.restore();
  }
  // ДЕКОР — поверх всего корпуса, в клипе силуэта
  if (decor) {
    x.save(); T(); x.clip(path);
    R();
    x.drawImage(decor, bx0, by0, bw, bh);
    x.restore();
  }

  // Кромка как на верфи (серый контур) + неон-гало цвета стороны
  T();
  x.lineJoin = 'round';
  x.strokeStyle = `rgba(${col},0.30)`; x.lineWidth = 4.5 / k; x.stroke(path);
  x.strokeStyle = 'rgba(207,214,221,0.85)'; x.lineWidth = 1.4 / k; x.stroke(path);
  R();

  if (ready) BB.spr[key] = cv;
  return cv;
}

// Рисуем корабль в гексе: живые дюзы, спрайт, кольцо выбора, полоски HP/щита.
function bbShip(ctx, gx, gy, cls, name, isMine, hpFrac, shFrac, selected, alpha, t) {
  const s = BB.st;
  const { px: cx, py: cy } = bbHexCenter(gx, gy);
  const C = BB.R * 1.72;   // «размер клетки» для габаритов силуэта
  const col = isMine ? BB_C.mine : BB_C.foe;
  // свои смотрят к врагу (нападающий всегда слева)
  const dir = isMine === (s.my_side === 'attacker') ? 1 : -1;
  const dsn = bbDesignOf(name, cls);
  const tIdx = dsn && dsn.data && dsn.data.type != null ? dsn.data.type : null;
  const spr = bbSprite(cls, tIdx, isMine ? 'mine' : 'foe');
  const g = spr._geo;
  const len = C * (0.62 + bbClsSize(cls) * 0.5);
  const sc = len / g.hullW, dw = g.SW * sc, dh = g.SH * sc;

  ctx.save();
  ctx.globalAlpha = alpha;

  // ДЮЗЫ: живой пульс у кормы поверх запечённого факела.
  const pulse = 0.55 + 0.45 * Math.sin((t || 0) * 0.006 + gx * 1.3 + gy * 0.7);
  const stern = cx - dir * len * 0.5, fr = C * (0.09 + 0.07 * pulse);
  const fg = ctx.createRadialGradient(stern, cy, 0, stern, cy, fr * 2.4);
  fg.addColorStop(0, `rgba(${col},${0.5 * pulse})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(stern, cy, fr * 2.4, 0, 6.2832); ctx.fill();

  if (selected) {   // кольцо выбора — гекс, не круг: доска-то сотовая
    bbHexPath(ctx, cx, cy, BB.R * 0.9);
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = Math.max(1, 2 / BB.zoom);
    ctx.setLineDash([4, 4]); ctx.lineDashOffset = -(t || 0) * 0.02;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // спрайт корпуса (нос вправо → зеркалим для смотрящих влево)
  ctx.translate(cx, cy);
  if (dir < 0) ctx.scale(-1, 1);
  ctx.drawImage(spr, -(g.padL + g.hullW / 2) * sc, -dh / 2, dw, dh);
  if (dir < 0) ctx.scale(-1, 1);
  ctx.translate(-cx, -cy);

  // полоски состояния под корпусом
  const bw = BB.R * 1.15, bx = cx - bw / 2, by = cy + Math.max(BB.R * 0.55, dh / 2 + 4);
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
// фракция, одним списком. Данные — battles_mine.
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
