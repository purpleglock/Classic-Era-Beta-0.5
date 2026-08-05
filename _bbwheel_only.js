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

// Куда направить мощность в этом ходу. Это НЕ меню действий: ходить и стрелять
// можно кликом по доске и без колеса. Режим даёт БОНУС и стоит секунд.
// Числа считаем от самого борта, чтобы человек видел «16 вместо 10», а не «×0.5».
var BBW_ENG = 0.5, BBW_WPN_DMG = 1.3, BBW_WPN_CST = 0.8, BBW_COST = 1.0;   // зеркало _bt_stance.sql


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
    u.stance === 'eng' ? 'двигатели' : u.stance === 'wpn' ? 'орудия' : 'щит'
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
  ].concat(bbWheelKit(u, acts));
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
  // есть act. Остальные сегменты — режимы мощности, это ОДИН вызов сервера.
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
