// ⚠ КОПИЯ блока «КОЛЕСО ДЕЙСТВИЙ» из battle_board.js — только для _bbwheel_harness.html.
// Боевой код живёт в battle_board.js; правите там — обновите и здесь, иначе стенд врёт.

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

// Из чего колесо этого корабля: только то, что он физически может.
function bbWheelSegs(u) {
  const s = BB.st, steps = bbSteps(u), fc = +u.fire_cost || 0;
  const acts = u.acted || (s.acts_left > 0);
  const out = [];
  out.push({
    key: 'move', ico: '➤', name: 'Манёвр',
    cost: steps > 0 ? (+u.step_cost).toFixed(1) + ' c за гекс' : '—',
    ok: steps > 0 && acts && u.cls !== 'ss13' && u.speed > 0,
    why: steps > 0
      ? 'Хватит на ' + steps + ' гекс(ов). Каждый шаг снимает ' + (+u.step_cost).toFixed(1) + ' c с хода.'
      : 'Секунд на манёвр не осталось.',
    hint: 'Колесо закроется — кликните по подсвеченному гексу, корабль пойдёт по маршруту.'
  });
  out.push({
    key: 'fire', ico: '⚔', name: 'Залп',
    cost: fc.toFixed(1) + ' c',
    ok: bbCanFire(u) && acts,
    why: bbCanFire(u)
      ? 'Один залп забирает ' + fc.toFixed(1) + ' c из ' + (+u.tp).toFixed(1) + ' c остатка.'
      : 'На залп нужно ' + fc.toFixed(1) + ' c, а осталось ' + (+u.tp).toFixed(1) + ' c.',
    hint: 'Кликните по подсвеченному врагу. Отработают все группы, достающие с этой дистанции.'
  });
  out.push({
    key: 'shield', ico: '\u{1F6E1}', name: 'Щит',
    cost: (+u.tp).toFixed(1) + ' c',
    ok: (+u.tp) > 0.05 && acts && bbTerra(u.x, u.y) !== 'neb',
    why: bbTerra(u.x, u.y) === 'neb'
      ? 'В туманности защитное поле не держится.'
      : 'Весь остаток хода — ' + (+u.tp).toFixed(1) + ' c — уходит в поле. Оно гасит ' +
        bbNum(u.mitig) + ' урона за секунду и снимает ' + Math.round(u.reduc * 100) +
        '% с накрытого, пока секунды не выйдут.',
    hint: 'Щит прикроет ровно ход противника и опустится, когда корабль снова начнёт действовать.'
  });
  if (bbHasHeal(u)) out.push({
    key: 'heal', ico: '\u{1F6E0}', name: 'Ремонт',
    cost: fc.toFixed(1) + ' c',
    ok: bbCanFire(u) && acts,
    why: 'Нано-рой латает союзника. Стоит столько же, сколько залп — ' + fc.toFixed(1) + ' c.',
    hint: 'Кликните по подсвеченному союзнику.'
  });
  if (u.wings > 0) out.push({
    key: 'wing', ico: '\u{1F6E9}', name: 'Авиакрыло',
    cost: '1 активация',
    ok: !u.acted && s.acts_left > 0,
    why: 'В ангарах ' + u.wings + '. Крыло вступает в бой со следующего хода и живёт само.',
    hint: 'Поднимется рядом с носителем.'
  });
  return out;
}

function bbWheelOpen(id) {
  const s = BB.st; if (!s || !s.my_turn) return;
  const u = (s.units || []).find(q => q.id === (id || BB.sel));
  if (!u || !u.mine) { toast('Сначала выберите свой корабль', 'err'); return; }
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
        '<text class="bbw-hub-t" x="' + cx + '" y="' + (cy - 6) + '">' + (a ? esc(a.name) : 'Наведитесь') + '</text>' +
        '<text class="bbw-hub-s" x="' + cx + '" y="' + (cy + 14) + '">' + (a ? esc(a.cost) : 'на сегмент') + '</text>' +
      '</svg>' +
      '<div class="bbw-why">' + (a ? esc(a.why) + (a.ok ? ' ' + esc(a.hint) : '')
        : 'Ход корабля — это секунды. Здесь видно, на что их хватит: тусклый сегмент не по карману.') + '</div>' +
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
  if (!BBW.open || BBW.aim < 0) return;
  const seg = BBW.segs[BBW.aim], u = BBW.unit;
  if (!seg.ok) { toast(seg.why, 'err'); return; }
  BB.sel = u.id;
  bbWheelClose();
  if (seg.key === 'shield') { bbAct('battle_shield', { p_battle: BB.id, p_unit: u.id, p_sec: null }); return; }
  if (seg.key === 'wing')   { bbLaunch(u.id); return; }
  if (seg.key === 'heal')   { if (!BB.heal) bbHealMode(); return; }
  // манёвр и залп подтверждения в колесе не требуют: гексы и враги уже подсвечены
  // на доске — колесо закрывается и говорит, куда именно кликать.
  BB.heal = false; BB.reach = null;
  toast(seg.hint, 'ok');
  bbRender();
}

// «У» (и латинская U на той же клавише) открывает/закрывает колесо.
document.addEventListener('keydown', function (ev) {
  if (typeof BB === 'undefined' || !BB.st || BB.st.status !== 'active') return;
  const t = ev.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
  const k = (ev.key || '').toLowerCase();
  if (k === 'escape' && BBW.open) { bbWheelClose(); ev.preventDefault(); return; }
  if (k === 'у' || k === 'u') {
    if (BBW.open) bbWheelClose(); else bbWheelOpen(BB.sel);
    ev.preventDefault();
  }
});
