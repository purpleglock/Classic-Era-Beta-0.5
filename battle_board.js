// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════
// ДОСКА БОЯ — пошаговое сражение флотов (тактика: сектора + инерция +
// ландшафт + сигнатуры). Зеркало _war_battle.sql + _war_battle_rework.sql
// + _war_battle_tactics.sql.
//
// ХОД СТОРОНЫ = 6 АКТИВАЦИЙ. Ход кораблём — это МАРШРУТ по гексам:
// инерция не даёт повернуть на 60°, пока не пройдено N прямых гексов
// (корвет 1 … дредноут 4). Орудия бьют по секторам (нос/борта, корма
// слепая) и в своей полосе дальности (R−1..R). Чужой корабль без захвата
// радаром — «неопознанный контакт»: точка на доске, огонь вести нельзя.
//
// Доска — ГЕКСЫ flat-top в odd-q offset. Рендер — canvas с камерой
// (зум/панорама). Фон СТАТИЧЕН — никакой анимации, ничто не отвлекает.
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
  sel: null,         // выбранный свой корабль (id)
  hover: null,       // {x,y} гекс под курсором
  pick: null,        // фаза расстановки: выбранный проект из резерва
  place: [],         // фаза расстановки: [{unit_id, unit_name, cls, x, y}]
  poll: null,        // таймер опроса (ход противника)
  busy: false,
  spr: {},           // кэш спрайтов кораблей
  tex: {},           // кэш текстур корпуса
  stars: null,       // офскрин-звёздное небо (статичное)
  dock: true,        // нижний док с панелями развёрнут?
  terr: null,        // Map "x:y" → 'ast'|'neb'|'grv'|'deb'
  reach: null,       // Map "x:y" → {steps, path} для выбранного корабля
  ptrs: new Map(),
  drag: null,
  pinch: null,
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
};

// ── Открыть / закрыть ───────────────────────────────────────
async function bbOpen(battleId, spectate, botFoe) {
  BB.id = battleId; BB.sel = null; BB.pick = null; BB.place = [];
  BB.spectate = !!spectate;   // зритель дуэли клуба: полное зрение, без действий
  BB.botFoe = !!botFoe;       // админ-тест против ботов: боты ходят сами, автоматически
  BB.camReady = false; BB.reach = null;
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
  BB.id = null; BB.st = null; BB.cv = null; BB.ctx = null; BB.stars = null;
  BB.terr = null; BB.reach = null;
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
  try {
    BB.st = await ecRpc(BB.spectate ? 'fc_watch_state' : 'battle_state', { p_battle: BB.id });
  } catch (e) {
    const ov = document.getElementById('bb-ov');
    if (ov) ov.innerHTML = `<div class="bb-load">Бой недоступен: ${esc(e.message || e)}<br><button class="btn btn-gh btn-sm" style="margin-top:12px" onclick="bbClose()">Закрыть</button></div>`;
    return;
  }
  // ландшафт → быстрый Map для проверок и рендера
  BB.terr = new Map();
  (BB.st.terrain || []).forEach(e => BB.terr.set(e.x + ':' + e.y, e.t));
  BB.reach = null;
  bbRender();
  bbMaybeBotTurn();
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
    // «сейчас ход игрока» и т.п. — тихо игнорируем, доска просто останется как есть
    if (e && e.message && !/ход игрока|не бой с ботами/i.test(e.message))
      toast(e.message, 'err');
    BB.botRunning = false;
    return;
  }
  BB.botRunning = false;
  await bbReload();   // покажем результат и, если снова ход ботов, прогоним ещё
}

// ── Каркас экрана: доска сверху, ВСЕ панели в нижнем доке ────
function bbRender() {
  const s = BB.st; if (!s) return;
  const ov = document.getElementById('bb-ov'); if (!ov) return;
  const spec = s.my_side === 'spectator';   // зритель дуэли клуба
  const foeName = (spec || s.my_side === 'attacker') ? s.defender_name : s.attacker_name;
  const myName  = (spec || s.my_side === 'attacker') ? s.attacker_name : s.defender_name;
  const myLeft  = s.my_side === 'attacker' ? s.att_turns_left : s.def_turns_left;
  const foeLeft = s.my_side === 'attacker' ? s.def_turns_left : s.att_turns_left;

  ov.innerHTML = `
    <div class="bb-wrap">
      <div class="bb-top">
        <div class="bb-ttl">
          <span class="bb-ttl-ic">⚔</span>
          <span class="bb-ttl-t">${esc(s.system_name || s.system_id)}</span>
          <span class="bb-ttl-sub">${s.kind === 'duel' ? '🥊 дуэль Бойцовского клуба' : s.kind === 'intercept' ? 'перехват на трассе' : 'встреча флотов'}</span>
        </div>
        <div class="bb-vs">
          <span class="bb-vs-me">${esc(myName)}</span>
          <span class="bb-vs-x">против</span>
          <span class="bb-vs-foe">${esc(foeName)}</span>
        </div>
        <button class="bb-exit" title="Выйти из боя на сайт" onclick="bbClose()"><span class="bb-exit-a">←</span> На сайт</button>
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
        <aside class="bb-side${BB.dock ? ' bb-side-open' : ''}" id="bb-side">
          <button class="bb-side-h" onclick="bbDockToggle()" title="${BB.dock ? 'Свернуть панель' : 'Развернуть панель'}">
            <span class="bb-side-h-ar">${BB.dock ? '▸' : '◂'}</span>
            <span class="bb-side-h-t">${BB.dock ? 'Свернуть' : 'Панель'}</span>
          </button>
          <div class="bb-side-in">
            ${s.status === 'forming' ? bbDeployPanel(s) : bbUnitPanel(s)}
            ${bbLogPanel(s)}
          </div>
        </aside>
      </div>
    </div>`;

  BB.cv = document.getElementById('bb-cv');
  BB.ctx = BB.cv.getContext('2d');
  bbFit();
  bbBindCanvas();
  bbPaint();
}
function bbDockToggle() { BB.dock = !BB.dock; bbRender(); }

// Полоса состояния: чей ход, активации, срок явки + тумблер дока.
function bbPhaseBar(s, myLeft, foeLeft) {
  const dockBtn = `<button class="btn btn-gh btn-sm" onclick="bbDockToggle()">${BB.dock ? '▸ Скрыть панель' : '☰ Панель'}</button>`;
  if (s.status === 'done') {
    // Зритель дуэли: нейтральный вердикт вместо «вашей» победы/поражения.
    if (s.my_side === 'spectator') {
      const wn = s.winner === s.attacker ? s.attacker_name : s.defender_name;
      return `<div class="bb-bar bb-bar-won">
          <b>⚑ Победа: ${esc(wn || s.winner || '?')}</b>
          <span class="bb-bar-sub">Дуэль окончена. Кассы клуба считают выплаты.</span>
          <button class="btn btn-gd btn-sm" onclick="bbClose()">Закрыть</button>
        </div>`;
    }
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
        ${dockBtn}
        ${mine ? '' : `<button class="btn btn-gd btn-sm" ${BB.place.length ? '' : 'disabled'} onclick="bbConfirmDeploy()">В бой (${BB.place.length})</button>`}
      </div>`;
  }
  const mv = s.my_turn;
  const actsMax = s.acts_max || 6;
  const acts = mv ? `<span class="bb-acts" title="Активаций кораблями в этом ходу">
      ${'◆'.repeat(Math.max(0, s.acts_left || 0))}${'◇'.repeat(Math.max(0, actsMax - (s.acts_left || 0)))}
      <i>${s.acts_left || 0}/${actsMax}</i></span>` : '';
  const turnLbl = s.my_side === 'spectator'
    ? 'Ходит: ' + (s.side_to_move === 'attacker' ? (s.attacker_name || 'нападающий') : (s.defender_name || 'обороняющийся'))
    : (mv ? 'Ваш ход' : 'Ход противника');
  return `<div class="bb-bar ${mv ? 'bb-bar-my' : 'bb-bar-foe'}">
      <b>${esc(turnLbl)}</b>${acts}
      <span class="bb-bar-sub">Бой до полного уничтожения одной из сторон. ${bbDeadline(s)}</span>
      ${dockBtn}
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

// Компактное число для карточек резерва
function bbNum(v) { v = +v || 0; return v >= 1000 ? Math.round(v).toLocaleString('ru') : String(Math.round(v)); }
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

// ── Панель расстановки ──────────────────────────────────────
function bbDeployPanel(s) {
  const pool = Array.isArray(s.pool) ? s.pool : [];
  const used = {};
  BB.place.forEach(p => { used[p.unit_id] = (used[p.unit_id] || 0) + 1; });
  const rows = pool.map(p => {
    const free = (p.free || 0) - (used[p.unit_id] || 0);
    const on = BB.pick === p.unit_id;
    return `<button class="bb-pool${on ? ' bb-pool-on' : ''}" ${free <= 0 ? 'disabled' : ''}
        onclick="bbPick('${jsq(p.unit_id)}')">
        <span class="bb-pool-cls">${bbClsIco(p.cls)}</span>
        <span class="bb-pool-n">${esc(p.unit_name)}
          <i>${bbPoolDetail(p)}</i></span>
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
const BB_SECT = { nose: 'Нос', left: 'Левый борт', right: 'Правый борт', any: 'Турели' };
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
        <b>Радар:</b> тусклая точка — неопознанный контакт. Вблизи (до 3 гексов) видно всех в любую сторону;
        дальше цель ловит <b>радар — только в переднем секторе</b> (носом к цели), на дистанции ≈ сенсор − половина скрытности.
        Выстрел раскрывает стрелявшего до его следующего хода.</div>
    </div>${reinf}`;
  const pct = v => Math.max(0, Math.min(100, v));
  const need = bbTurnNeed(u.cls);
  const wpn = (u.wpn && u.wpn.length ? u.wpn : [{ s: 'any', rng: u.rng, dmg: u.dmg }])
    .map(g => `<div class="bb-stat"><span>${BB_SECT[g.s] || g.s}</span><b>${g.dmg} · до ${g.rng} гекс.</b></div>`).join('');
  return `<div class="bb-panel">
      <div class="bb-panel-t">${esc(u.name)}</div>
      <div class="bb-panel-h">${bbClsName(u.cls)}${u.mine && u.acted ? ' · <b>активирован</b>' : ''}${u.flash ? ' · <b style="color:#ff5c8a">позиция раскрыта выстрелом</b>' : ''}</div>
      <div class="bb-stat"><span>Корпус</span><b>${u.hp} / ${u.max_hp}</b></div>
      <div class="bb-bar-hp"><i style="width:${pct(u.hp / u.max_hp * 100)}%"></i></div>
      ${u.max_shield > 0 ? `<div class="bb-stat"><span>Щит</span><b>${u.shield} / ${u.max_shield}${bbTerra(u.x, u.y) === 'neb' ? ' (в туманности = 0)' : ''}</b></div>
        <div class="bb-bar-sh"><i style="width:${pct(u.shield / u.max_shield * 100)}%"></i></div>` : ''}
      <div class="bb-stat"><span>Броня</span><b>${u.armor}</b></div>
      <div class="bb-stat"><span>Ход</span><b>${u.speed} гекс. ${u.moved ? '— израсходован' : ''}</b></div>
      <div class="bb-stat"><span>Манёвр</span><b>поворот после ${need} прямых (пройдено ${Math.min(u.straight, need)})</b></div>
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
      ${u.mine && s.my_turn && u.wings > 0 && !u.acted && s.acts_left > 0 ? `<button class="btn btn-gd btn-sm" style="margin-top:8px;width:100%" onclick="bbLaunch('${jsq(u.id)}')">🛩 Поднять авиакрыло (1 активация)</button>` : ''}
      ${u.mine && s.my_turn ? `<div class="bb-panel-h" style="margin-top:8px">${u.moved && u.fired ? 'Корабль отработал этот ход.' : (!u.acted && !(s.acts_left > 0) ? 'Активации кончились — этот корабль в этом ходу не действует.' : 'Клик по подсвеченному гексу — лететь по маршруту (учтена инерция поворота), по цели в зоне поражения — огонь. Клины на доске = секторы и дальность орудий. В корму получают ×2.')}</div>` : ''}
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
  hyperCruiser: 'Гиперкрейсер', multiroleCarrier: 'Многоцелевой носитель', ss13: 'Станция',
  wing: 'Авиакрыло'
};
function bbClsName(c) { return BB_CLS[c] || 'Корабль'; }
function bbClsIco(c) {
  const n = { corvette: '▸', frigate: '▶', destroyer: '◆', cruiser: '⬢', battleship: '⬣', dreadnought: '⬟',
              supportCarrier: '⬨', mediumCruiser: '⬢', hyperCruiser: '⬡', multiroleCarrier: '⬨', ss13: '✦', wing: '𐊾' };
  return n[c] || '▸';
}
function bbClsSize(c) {
  return ({ corvette: 0.42, frigate: 0.52, destroyer: 0.60, cruiser: 0.68, battleship: 0.80, dreadnought: 0.92,
            supportCarrier: 0.66, mediumCruiser: 0.68, hyperCruiser: 0.76, multiroleCarrier: 0.78, ss13: 0.85,
            wing: 0.30 })[c] || 0.55;
}
// Инерция: сколько прямых гексов нужно классу перед поворотом (зеркало _bt_turnneed)
function bbTurnNeed(c) {
  return ({ corvette: 1, frigate: 1, ss13: 1, wing: 1, destroyer: 2, cruiser: 3, mediumCruiser: 3,
            supportCarrier: 3, battleship: 3, hyperCruiser: 3, multiroleCarrier: 3, dreadnought: 4 })[c] || 2;
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
function bbTerra(x, y) { return BB.terr ? (BB.terr.get(x + ':' + y) || null) : null; }

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
function bbInMyZone(x) {
  const s = BB.st, z = s.zone || 3;
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

// ── ДОСЯГАЕМОСТЬ: BFS с инерцией (состояние = гекс+курс+прямой пробег) ──
function bbComputeReach(sel) {
  const s = BB.st;
  const need = bbTurnNeed(sel.cls);
  const maxs = Math.max(1, sel.speed - (bbTerra(sel.x, sel.y) === 'deb' ? 1 : 0));
  const occ = new Set((s.units || []).filter(u => u.id !== sel.id).map(u => u.x + ':' + u.y));
  const reach = new Map();
  const seen = new Set();
  let q = [{ x: sel.x, y: sel.y, f: sel.facing, st: Math.min(sel.straight, need), path: [] }];
  seen.add(sel.x + ':' + sel.y + ':' + sel.facing + ':' + Math.min(sel.straight, need));
  for (let step = 1; step <= maxs && q.length; step++) {
    const nq = [];
    for (const c of q) {
      for (let d = 0; d < 6; d++) {
        const rel = ((d - c.f) % 6 + 6) % 6;
        let nf, ns;
        if (rel === 0) { nf = c.f; ns = Math.min(c.st + 1, need); }
        else if (rel === 1 || rel === 5) { if (c.st < need) continue; nf = d; ns = 1; }
        else continue;
        const p = bbStep(c.x, c.y, d);
        if (p.x < 0 || p.x >= s.w || p.y < 0 || p.y >= s.h) continue;
        if (occ.has(p.x + ':' + p.y)) continue;
        const key = p.x + ':' + p.y + ':' + nf + ':' + ns;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = c.path.concat([{ x: p.x, y: p.y, f: nf }]);
        if (!reach.has(p.x + ':' + p.y)) reach.set(p.x + ':' + p.y, { steps: step, path, f: nf });
        nq.push({ x: p.x, y: p.y, f: nf, st: ns, path });
      }
    }
    q = nq;
  }
  return reach;
}

// Можно ли выбранным попасть по цели (зеркало battle_fire, для UX)
function bbCanHit(sel, tgt) {
  if (tgt.contact || !tgt.locked) return { ok: false, why: 'цель не захвачена: наведите на неё нос корабля с радаром или подведите ближе (визуал — 3 гекса)' };
  const L = bbDist(sel, tgt);
  const rel = ((bbDirOf(sel, tgt) - sel.facing) % 6 + 6) % 6;
  const gs = (sel.wpn && sel.wpn.length) ? sel.wpn : [{ s: 'any', rng: sel.rng, dmg: sel.dmg }];
  let band = false, dmg = 0;
  for (const g of gs) {
    if (L >= 1 && L <= g.rng) {
      band = true;
      const m = g.s === 'any' ? 1
        : g.s === 'nose' ? ((rel === 5 || rel === 0 || rel === 1) ? 1 : null)
        : g.s === 'right' ? ((rel === 1 || rel === 2 || rel === 3) ? 0.9 : null)
        : ((rel === 3 || rel === 4 || rel === 5) ? 0.9 : null);
      if (m != null) dmg += g.dmg * m;
    }
  }
  if (!band) return { ok: false, why: `дистанция ${L} — дальше, чем бьют орудия` };
  if (!dmg) return { ok: false, why: 'цель вне секторов обстрела: нос бьёт вперёд, борта — вбок и назад, прямо в корму огня нет. Доверните корабль' };
  if (!bbLosClear(sel, tgt)) return { ok: false, why: 'линию огня перекрывают астероиды' };
  return { ok: true, dmg: Math.round(dmg) };
}

// ── КАМЕРА ──────────────────────────────────────────────────
function bbFit() {
  const s = BB.st; if (!s || !BB.cv) return;
  const wrap = BB.cv.parentElement;
  const wide = window.innerWidth > 900;
  BB.vw = Math.max(240, wrap.clientWidth || 320);
  BB.vh = Math.max(260, window.innerHeight - (wide ? 160 : 220));
  wrap.style.height = BB.vh + 'px';
  BB.dpr = Math.min(2, window.devicePixelRatio || 1);
  BB.cv.style.width = BB.vw + 'px'; BB.cv.style.height = BB.vh + 'px';
  BB.cv.width = Math.round(BB.vw * BB.dpr); BB.cv.height = Math.round(BB.vh * BB.dpr);
  BB.stars = null;
  if (!BB.camReady) { bbCamHome(); BB.camReady = true; }
  bbCamClamp();
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
function bbZoomBtn(f) { bbZoomAt(f, BB.vw / 2, BB.vh / 2); }

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
    if (hit >= 0) { BB.place.splice(hit, 1); bbRender(); return; }
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
  if (tgt && tgt.mine) {
    BB.sel = (BB.sel === tgt.id ? null : tgt.id);
    BB.reach = null;
    bbRender();
    return;
  }
  if (!sel) return;

  const noActs = !sel.acted && !(s.acts_left > 0);

  // клик по врагу — огонь (сектора/полосы/захват проверяем до сервера)
  if (tgt && !tgt.mine) {
    if (sel.fired) { toast('Этот корабль уже стрелял в этом ходу', 'err'); return; }
    if (noActs) { toast(`Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей`, 'err'); return; }
    const h = bbCanHit(sel, tgt);
    if (!h.ok) { toast(h.why, 'err'); return; }
    bbFire(sel.id, tgt.id);
    return;
  }
  // клик по пустому гексу — лететь по маршруту из BFS
  if (!tgt) {
    if (sel.moved) { toast('Этот корабль уже ходил', 'err'); return; }
    if (noActs) { toast(`Активации кончились: за ход действуют не больше ${s.acts_max || 6} кораблей`, 'err'); return; }
    if (!BB.reach) BB.reach = bbComputeReach(sel);
    const r = BB.reach.get(x + ':' + y);
    if (!r) { toast(`«${sel.name}» туда не долетит: скорость ${sel.speed}, поворот после ${bbTurnNeed(sel.cls)} прямых гексов`, 'err'); return; }
    bbMove(sel.id, r.path);
  }
}

// ── Действия ────────────────────────────────────────────────
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
function bbMove(id, path) { return bbAct('battle_move', { p_battle: BB.id, p_unit: id, p_path: path }); }
function bbLaunch(id) { return bbAct('battle_launch', { p_battle: BB.id, p_unit: id }, 'Авиакрыло в воздухе — вступит со следующего хода'); }
function bbFire(id, tid) { return bbAct('battle_fire', { p_battle: BB.id, p_unit: id, p_target: tid }); }
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
// РЕНДЕР: статичный кадр (никакой анимации — ничто не отвлекает)
// ════════════════════════════════════════════════════════════
function bbPaint() {
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

  ctx.setTransform(BB.dpr, 0, 0, BB.dpr, 0, 0);
  bbPaintScan(ctx, BB.vw, BB.vh);
}

function bbVisibleCells(s) {
  const R = BB.R;
  const x0 = Math.max(0, Math.floor((BB.camX - 2 * R) / (R * 1.5)));
  const x1 = Math.min(s.w - 1, Math.ceil((BB.camX + BB.vw / BB.zoom) / (R * 1.5)));
  const y0 = Math.max(0, Math.floor((BB.camY - 2 * R) / (R * BB_SQ3)) - 1);
  const y1 = Math.min(s.h - 1, Math.ceil((BB.camY + BB.vh / BB.zoom) / (R * BB_SQ3)) + 1);
  return { x0, x1, y0, y1 };
}

// ── КОСМОС: приглушённый статичный фон — доска важнее задника ──
function bbPaintSpace(ctx, s, W, H) {
  ctx.fillStyle = '#020409'; ctx.fillRect(0, 0, W, H);
  if (!BB.stars || BB.stars.W !== W || BB.stars.H !== H) bbBuildStars(W, H);
  ctx.drawImage(BB.stars.far, 0, 0);
  // виньетка — прижимает края
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function bbBuildStars(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const n = Math.round(W * H / 1400);
  for (let i = 0; i < n; i++) {
    const r = Math.random() * 0.8 + 0.3, a = Math.random() * 0.28 + 0.06;
    x.fillStyle = `rgba(225,238,248,${a})`;
    x.beginPath(); x.arc(Math.random() * W, Math.random() * H, r, 0, 6.2832); x.fill();
  }
  BB.stars = { W, H, far: c };
}

// ── СОТЫ ────────────────────────────────────────────────────
function bbPaintHexes(ctx, s) {
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
      bbHexPath(ctx, c.px, c.py, R * 0.9);
      ctx.fillStyle = 'rgba(120,110,100,0.10)'; ctx.fill();
      for (let i = 0; i < 4; i++) {
        const ax = c.px + (rnd(i) - 0.5) * R * 1.1, ay = c.py + (rnd(i + 9) - 0.5) * R * 1.1;
        const ar = R * (0.12 + rnd(i + 4) * 0.16);
        ctx.beginPath(); ctx.arc(ax, ay, ar, 0, 6.2832);
        ctx.fillStyle = `rgba(${120 + rnd(i + 2) * 40 | 0},${110 + rnd(i + 3) * 30 | 0},100,0.55)`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(0.5, 0.8 / BB.zoom); ctx.stroke();
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
      ctx.strokeStyle = 'rgba(170,180,190,0.45)';
      ctx.lineWidth = Math.max(0.5, 1 / BB.zoom);
      for (let i = 0; i < 5; i++) {
        const ax = c.px + (rnd(i) - 0.5) * R * 1.2, ay = c.py + (rnd(i + 7) - 0.5) * R * 1.2;
        const a = rnd(i + 3) * Math.PI, l = R * 0.14;
        ctx.beginPath();
        ctx.moveTo(ax - Math.cos(a) * l, ay - Math.sin(a) * l);
        ctx.lineTo(ax + Math.cos(a) * l, ay + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  });
}

// ── Подсветка: маршруты BFS + цели по секторам/полосам ──────
function bbPaintHighlights(ctx, s) {
  if (s.status === 'forming') return;
  const sel = (s.units || []).find(u => u.id === BB.sel);
  if (!sel || !s.my_turn) return;
  const R = BB.R;
  const canAct = sel.acted || s.acts_left > 0;

  // секторы и дальность орудий выбранного корабля — видно, куда и как далеко бьёт
  bbPaintArcs(ctx, sel);

  // гексы хода — настоящая досягаемость с инерцией
  if (!sel.moved && canAct) {
    if (!BB.reach) BB.reach = bbComputeReach(sel);
    BB.reach.forEach((r, key) => {
      const [x, y] = key.split(':').map(Number);
      const c = bbHexCenter(x, y);
      bbHexPath(ctx, c.px, c.py, R * 0.82);
      ctx.fillStyle = BB_C.move; ctx.fill();
    });
    // превью манёвра: наведён гекс маршрута — рисуем путь и КУДА встанет нос
    if (BB.hover) {
      const r = BB.reach.get(BB.hover.x + ':' + BB.hover.y);
      if (r) bbPaintMovePreview(ctx, sel, r);
    }
  }
  // цели: полные данные + попадает по сектору/полосе/линии огня
  if (!sel.fired && canAct) {
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
}

// Секторы обстрела: для каждой группы орудий — клин по её сектору на её
// дальность. Нос — передние 180°, борта — по 180° вбок-назад, турели — круг.
// Радиус клина ≈ дальность в гексах (шаг гекса ≈ R·1.5).
function bbPaintArcs(ctx, sel) {
  const R = BB.R;
  const gs = (sel.wpn && sel.wpn.length) ? sel.wpn : [{ s: 'any', rng: sel.rng, dmg: sel.dmg }];
  // худшее (макс) по каждому сектору
  const byS = {};
  gs.forEach(g => { byS[g.s] = Math.max(byS[g.s] || 0, g.rng || 1); });
  const { px: cx, py: cy } = bbHexCenter(sel.x, sel.y);
  const f = sel.facing || 0;
  const HALF = Math.PI / 2;                 // 90° в каждую сторону = сектор 180°
  const specs = {
    nose:  { a: bbDirAngle(f),     col: '90,220,240' },
    right: { a: bbDirAngle(f + 2), col: '120,235,255' },
    left:  { a: bbDirAngle(f + 4), col: '120,235,255' },
    any:   { a: 0,                 col: '150,240,255', full: true },
  };
  ctx.save();
  Object.keys(byS).forEach(sct => {
    const sp = specs[sct]; if (!sp) return;
    const rad = byS[sct] * R * 1.5;
    ctx.beginPath();
    if (sp.full) { ctx.arc(cx, cy, rad, 0, 6.2832); }
    else { ctx.moveTo(cx, cy); ctx.arc(cx, cy, rad, sp.a - HALF, sp.a + HALF); ctx.closePath(); }
    ctx.fillStyle = `rgba(${sp.col},0.05)`; ctx.fill();
    ctx.strokeStyle = `rgba(${sp.col},0.28)`; ctx.lineWidth = Math.max(0.6, 1 / BB.zoom);
    ctx.stroke();
  });
  ctx.restore();
}

// Превью манёвра: линия маршрута + куда встанет НОС в конце (учтена инерция).
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
  // финальный курс: крупная стрелка-нос на гексе назначения
  const d = bbHexCenter(BB.hover.x, BB.hover.y);
  const ang = bbDirAngle(r.f);
  const tip = R * 0.72, hw = R * 0.34, back = R * 0.18;
  const tx = d.px + Math.cos(ang) * tip, ty = d.py + Math.sin(ang) * tip;
  const bx = d.px - Math.cos(ang) * back, by = d.py - Math.sin(ang) * back;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx + Math.cos(ang + 2.5) * hw, by + Math.sin(ang + 2.5) * hw);
  ctx.lineTo(d.px - Math.cos(ang) * back * 0.3, d.py - Math.sin(ang) * back * 0.3);
  ctx.lineTo(bx + Math.cos(ang - 2.5) * hw, by + Math.sin(ang - 2.5) * hw);
  ctx.closePath();
  ctx.fillStyle = `rgba(${col},0.9)`; ctx.fill();
  ctx.strokeStyle = 'rgba(10,20,28,0.8)'; ctx.lineWidth = Math.max(0.6, 1 / BB.zoom); ctx.stroke();
  ctx.restore();
}

function bbPaintUnits(ctx, s) {
  const defFacing = s.my_side === 'attacker' ? 0 : 3;
  if (s.status === 'forming') {
    BB.place.forEach(p => bbShip(ctx, { x: p.x, y: p.y, cls: p.cls, name: p.unit_name, mine: true, facing: defFacing, hp: 1, max_hp: 1, shield: 0, max_shield: 0 }, 0.55));
  }
  (s.units || []).forEach(u => {
    if (u.contact) { bbContact(ctx, u); return; }
    const spent = u.mine && s.my_turn && ((u.moved && u.fired) || (!u.acted && !(s.acts_left > 0)));
    bbShip(ctx, u, spent ? 0.5 : 1);
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
function bbGeo(cls) {
  if (typeof CN_SHIP_GEO !== 'undefined') {
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
  const { px: cx, py: cy } = bbHexCenter(u.x, u.y);
  const C = BB.R * 1.72;
  const col = u.mine ? BB_C.mine : BB_C.foe;
  const ang = bbDirAngle(u.facing || 0);
  const dsn = bbDesignOf(u.name, u.cls);
  const tIdx = dsn && dsn.data && dsn.data.type != null ? dsn.data.type : null;
  const spr = bbSprite(u.cls, tIdx, u.mine ? 'mine' : 'foe');
  const g = spr._geo;
  const len = C * (0.62 + bbClsSize(u.cls) * 0.5);
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

  // спрайт корпуса: нос смотрит вправо → поворот на угол курса
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.drawImage(spr, -(g.padL + g.hullW / 2) * sc, -dh / 2, dw, dh);
  ctx.rotate(-ang);
  ctx.translate(-cx, -cy);

  // полоски состояния под гексом
  const bw = BB.R * 1.15, bx = cx - bw / 2, by = cy + BB.R * 0.92;
  const hpFrac = (u.max_hp > 0) ? u.hp / u.max_hp : 1;
  const shFrac = (u.max_shield > 0) ? u.shield / u.max_shield : 0;
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
