// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// ОРУЖЕЙНАЯ ВЕРФЬ (#build-turret) — верстак орудий внутри игры
// ────────────────────────────────────────────────────────────
// Это ПОРТ страницы _turret_gen.html без изменений облика: та же сцена с
// сеткой и виньеткой, те же узлы правки НА самом орудии, те же всплывашки
// с дельтами ТТХ, то же досье справа и те же сегментные полосы внизу.
// Добавлено ровно то, чего требует игра: имя орудия, регистрация в базе
// (turret_upsert) и список своих орудий.
//
// turret_gen.js (window.TG) рисует и считает. В базу пишет ЗЕРКАЛО НА
// СЕРВЕРЕ (_tg_stats, файл _turret_forge.sql) — клиентским цифрам не
// доверяем. Расхождение зеркал = баг: правил turret_gen.js — правь и SQL.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var CNT = { cfg: null, editId: null, editName: '', turrets: [], busy: false, openNode: null, drag: null };
  window.CNT = CNT;

  function T() { return window.TG; }
  function $t(id) { return document.getElementById('tf_' + id); }
  function NUM(n) {
    return n >= 1e9 ? (n / 1e9).toFixed(2) + ' млрд'
         : n >= 1e6 ? (n / 1e6).toFixed(2) + ' млн'
         : Math.round(n).toLocaleString('ru-RU');
  }

  // ── Стили: копия оформления верстака, загнанная под .tf-app ──
  function injectStyle() {
    if (document.getElementById('tf-style')) return;
    var s = document.createElement('style'); s.id = 'tf-style';
    s.textContent = [
      '.tf-app{--bg:#0f1113;--panel:#191c1f;--panel2:#22262a;--line:#2e3338;--line2:#414850;',
        '--txt:#c8c5bc;--dim:#7b7f86;--tan:#b9a06a;--amber:#e8a93f;--good:#86c25c;--bad:#c9553c;',
        'position:relative;display:flex;flex-direction:column;height:calc(100vh - 96px);min-height:520px;',
        'background:#0f1113;color:var(--txt);overflow:hidden;user-select:none;',
        'font:13px/1.4 "Segoe UI",Roboto,system-ui,sans-serif;border:1px solid var(--line2)}',
      '.tf-app *{box-sizing:border-box}',
      '.tf-app button,.tf-app select,.tf-app input{font-family:inherit}',

      // ── Верхняя планка
      '.tf-app #tf_top{flex:none;min-height:44px;display:flex;align-items:center;gap:8px;padding:0 10px;',
        'background:linear-gradient(180deg,#22262a,#15181b);border-bottom:1px solid var(--line2);z-index:40}',
      '.tf-app .hbtn{background:#262b30;color:var(--txt);border:1px solid var(--line2);padding:6px 11px;cursor:pointer;',
        'font-size:11px;letter-spacing:1.4px;text-transform:uppercase;text-decoration:none;white-space:nowrap}',
      '.tf-app .hbtn:hover{background:#333940;border-color:var(--tan);color:#fff}',
      '.tf-app .hbtn.acc{background:var(--tan);color:#15181b;font-weight:700;border-color:var(--amber)}',
      '.tf-app .hbtn.acc:hover{background:var(--amber)}',
      '.tf-app .hbtn[disabled]{opacity:.4;cursor:default}',
      '.tf-app #tf_nm{flex:1;min-width:140px;background:#101314;color:#e3ded1;border:1px solid var(--line2);',
        'padding:6px 9px;font-size:12px;letter-spacing:.06em}',
      '.tf-app #tf_nm:focus{outline:none;border-color:var(--tan)}',

      // ── Сцена
      '.tf-app #tf_stage{flex:1;position:relative;min-height:0;overflow:hidden;cursor:grab;',
        'background:radial-gradient(ellipse at 50% 46%,#242a2e 0%,#0d0f11 70%)}',
      '.tf-app #tf_stage.drag{cursor:grabbing}',
      '.tf-app #tf_grid{position:absolute;inset:0;pointer-events:none;',
        'background:linear-gradient(rgba(185,160,106,.055) 1px,transparent 1px) 0 0/100% 40px,',
        'linear-gradient(90deg,rgba(185,160,106,.055) 1px,transparent 1px) 0 0/40px 100%;',
        '-webkit-mask-image:radial-gradient(ellipse at 50% 50%,#000 18%,transparent 76%);',
        'mask-image:radial-gradient(ellipse at 50% 50%,#000 18%,transparent 76%)}',
      '.tf-app #tf_vig{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 160px rgba(0,0,0,.9)}',
      '.tf-app #tf_svgbox{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}',
      '.tf-app #tf_svgbox svg{max-width:74%;max-height:76%;filter:drop-shadow(0 20px 40px rgba(0,0,0,.75))}',
      '.tf-app #tf_leads{position:absolute;inset:0;pointer-events:none;z-index:5}',
      '.tf-app .corner{position:absolute;width:20px;height:20px;border:1px solid rgba(185,160,106,.35);pointer-events:none;z-index:6}',
      '.tf-app .corner.tl{top:12px;left:12px;border-right:0;border-bottom:0}',
      '.tf-app .corner.tr{top:12px;right:12px;border-left:0;border-bottom:0}',
      '.tf-app .corner.bl{bottom:12px;left:12px;border-right:0;border-top:0}',
      '.tf-app .corner.br{bottom:12px;right:12px;border-left:0;border-top:0}',
      '.tf-app #tf_tip{position:absolute;left:12px;top:12px;z-index:6;pointer-events:none;',
        'font:10px/1.7 "Consolas",monospace;color:var(--dim);letter-spacing:1.4px;text-transform:uppercase}',
      '.tf-app #tf_tip b{color:var(--tan)}',
      '.tf-app #tf_tip em{font-style:normal;color:#e3ded1;letter-spacing:1.8px}',

      // ── Точка модификации на орудии
      '.tf-app .node{position:absolute;z-index:10;transform:translate(-50%,-50%);cursor:pointer;',
        'width:26px;height:26px;display:grid;place-items:center;',
        'background:rgba(20,23,26,.9);border:1px solid var(--line2);color:var(--tan);font-size:13px;',
        'transition:transform .1s,background .12s,border-color .12s}',
      '.tf-app .node:before{content:"";position:absolute;inset:-7px;border:1px solid transparent}',
      '.tf-app .node:hover,.tf-app .node.on{background:var(--tan);color:#15181b;border-color:var(--amber);transform:translate(-50%,-50%) scale(1.12)}',
      '.tf-app .node:hover:before,.tf-app .node.on:before{border-color:rgba(232,169,63,.5)}',
      '.tf-app .node .lb{position:absolute;left:34px;top:50%;transform:translateY(-50%);white-space:nowrap;',
        'background:rgba(16,19,21,.94);border:1px solid var(--line2);border-left:2px solid var(--tan);',
        'padding:4px 9px;pointer-events:none;opacity:0;transition:opacity .12s}',
      '.tf-app .node.lft .lb{left:auto;right:34px;border-left:1px solid var(--line2);border-right:2px solid var(--tan)}',
      '.tf-app .node:hover .lb{opacity:1}',
      '.tf-app .node .lb i{display:block;font-style:normal;font-size:8px;letter-spacing:2px;color:var(--dim);text-transform:uppercase}',
      '.tf-app .node .lb b{font-size:12px;color:#e3ded1;font-weight:500}',

      // ── Нижняя планка ТТХ
      '.tf-app #tf_bottom{flex:none;display:flex;align-items:stretch;background:linear-gradient(180deg,#1b1f22,#121517);',
        'border-top:1px solid var(--line2);z-index:30;overflow-x:auto}',
      '.tf-app .st{flex:1;min-width:132px;padding:7px 12px;border-right:1px solid #24282c}',
      '.tf-app .st .hd{display:flex;justify-content:space-between;align-items:baseline}',
      '.tf-app .st i{font-style:normal;font-size:8.5px;letter-spacing:2px;text-transform:uppercase;color:var(--dim)}',
      '.tf-app .st u{text-decoration:none;font:600 13px "Consolas",monospace;color:#e3ded1}',
      '.tf-app .st em{font-style:normal;font:600 10px "Consolas",monospace;margin-left:5px;opacity:0}',
      '.tf-app .st em.show{opacity:1}.tf-app .st em.up{color:var(--good)}.tf-app .st em.dn{color:var(--bad)}',
      '.tf-app .seg{display:flex;gap:2px;margin-top:6px;height:7px}',
      '.tf-app .seg s{flex:1;background:#22262a;border-top:1px solid #2c3136;text-decoration:none}',
      '.tf-app .seg s.f{background:linear-gradient(180deg,#c9ae74,#8d7642)}',
      '.tf-app .seg s.up{background:repeating-linear-gradient(45deg,#86c25c 0 3px,#5d8b3f 3px 6px)}',
      '.tf-app .seg s.dn{background:repeating-linear-gradient(45deg,#c9553c 0 3px,#8b3826 3px 6px)}',

      // ── Всплывающий выбор детали
      '.tf-app #tf_pop{position:absolute;z-index:60;width:340px;max-height:520px;display:none;',
        'flex-direction:column;background:var(--panel);border:1px solid var(--line2);box-shadow:0 20px 50px rgba(0,0,0,.75)}',
      '.tf-app #tf_pop.on{display:flex}',
      '.tf-app #tf_pop .ph{flex:none;display:flex;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line2);',
        'background:linear-gradient(180deg,#262b30,#1c2024)}',
      '.tf-app #tf_pop .ph b{flex:1;font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:var(--tan)}',
      '.tf-app #tf_pop .ph span{cursor:pointer;color:var(--dim);font-size:17px;line-height:1;padding:0 3px}',
      '.tf-app #tf_pop .ph span:hover{color:var(--bad)}',
      // flex:1 + min-height:0 — иначе список распирает окно вместо прокрутки.
      '.tf-app #tf_pop .pb{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px}',
      '.tf-app .opt{padding:7px 10px;cursor:pointer;background:#1d2124;border:1px solid #2b3035;margin-bottom:5px;position:relative}',
      '.tf-app .opt:hover{background:#2b3238;border-color:var(--tan)}',
      '.tf-app .opt.sel{border-color:var(--amber);background:#2a2820}',
      '.tf-app .opt.sel:after{content:"✔";position:absolute;top:6px;right:9px;color:var(--amber);font-size:11px}',
      '.tf-app .opt .nm{font-size:12.5px;color:#e3ded1;padding-right:20px}',
      '.tf-app .opt .dl{display:flex;flex-wrap:wrap;gap:3px 9px;font:10px "Consolas",monospace;color:#5f646a;margin-top:3px}',
      '.tf-app .opt .dl s{text-decoration:none}.tf-app .opt .dl s.up{color:var(--good)}.tf-app .opt .dl s.dn{color:var(--bad)}',
      '.tf-app .sl{padding:7px 10px 9px;border-bottom:1px solid #24282c}',
      '.tf-app .sl .h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}',
      '.tf-app .sl .h i{font-style:normal;font-size:9px;letter-spacing:1.8px;text-transform:uppercase;color:var(--dim)}',
      '.tf-app .sl .h b{font:600 12px "Consolas",monospace;color:var(--amber)}',
      '.tf-app .sl .h b.lim{font-size:9px;color:#5b6067;font-weight:400;margin-left:5px}',
      '.tf-app input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:16px;background:none;margin:0;cursor:pointer}',
      '.tf-app input[type=range]::-webkit-slider-runnable-track{height:4px;background:#101314;border:1px solid #2e3338}',
      '.tf-app input[type=range]::-moz-range-track{height:4px;background:#101314;border:1px solid #2e3338}',
      '.tf-app input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:15px;margin-top:-6px;',
        'background:linear-gradient(180deg,#dcc084,#a3854a);border:1px solid #0f1113}',
      '.tf-app input[type=range]::-moz-range-thumb{width:11px;height:15px;border-radius:0;',
        'background:linear-gradient(180deg,#dcc084,#a3854a);border:1px solid #0f1113}',
      '.tf-app input[type=color]{width:100%;height:28px;background:#101314;border:1px solid var(--line2);padding:2px;cursor:pointer}',
      '.tf-app select.kv{width:100%;background:#101314;color:var(--txt);border:1px solid var(--line2);padding:6px;font-size:12px}',
      '.tf-app .row2{display:flex;gap:8px;padding:8px 10px}.tf-app .row2>div{flex:1}',
      '.tf-app .row2 i{font-style:normal;display:block;font-size:9px;letter-spacing:1.8px;text-transform:uppercase;color:var(--dim);margin-bottom:4px}',
      '.tf-app .mine{padding:8px 10px;border-bottom:1px solid #24282c;display:flex;gap:8px;align-items:center}',
      '.tf-app .mine .mn{flex:1;min-width:0;cursor:pointer}',
      '.tf-app .mine .mn b{display:block;font-size:12.5px;color:#e3ded1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tf-app .mine .mn s{text-decoration:none;display:block;font:10px "Consolas",monospace;color:#5f646a;margin-top:2px}',
      '.tf-app .mine .mn:hover b{color:var(--amber)}',
      '.tf-app .xb{background:none;border:1px solid var(--line2);color:var(--dim);cursor:pointer;padding:3px 7px;font-size:11px}',
      '.tf-app .xb:hover{border-color:var(--bad);color:var(--bad)}',

      // ── Досье
      '.tf-app #tf_dos{position:absolute;top:0;right:0;bottom:0;width:288px;z-index:35;overflow-y:auto;',
        'background:rgba(21,24,27,.97);border-left:1px solid var(--line2);transform:translateX(100%);transition:transform .18s ease}',
      '.tf-app #tf_dos.on{transform:none}',
      '.tf-app .sec{padding:8px 12px 6px;font-size:9px;letter-spacing:2.4px;text-transform:uppercase;color:var(--tan);',
        'background:#1d2124;border-top:1px solid var(--line);border-bottom:1px solid var(--line);position:sticky;top:0}',
      '.tf-app #tf_dos table{width:100%;border-collapse:collapse}',
      '.tf-app #tf_dos td{padding:4px 12px;font-size:11.5px;border-bottom:1px solid #23272b}',
      '.tf-app #tf_dos td:first-child{color:var(--dim)}',
      '.tf-app #tf_dos td:last-child{text-align:right;color:#e3ded1;font-family:"Consolas",monospace}',
      '.tf-app #tf_dos tr.ok td:first-child{color:#9dbd8b}.tf-app #tf_dos tr.no td{opacity:.42}',
      '.tf-app #tf_dos tr.ok td:last-child,.tf-app #tf_dos tr.no td:last-child{font-size:10px;color:var(--dim);font-family:inherit}',

      '@media (max-width:900px){',
        '.tf-app #tf_top{flex-wrap:wrap;padding:7px}',
        '.tf-app #tf_nm{order:5;flex:1 0 100%}',
        '.tf-app #tf_svgbox svg{max-width:88%}',
        '.tf-app .st{min-width:112px;padding:6px 9px}',
        '.tf-app #tf_pop{left:0!important;right:0;top:auto!important;bottom:0;width:100%;max-height:72vh;border-bottom:0}',
        '.tf-app #tf_dos{width:100%}',
        '.tf-app .node{width:32px;height:32px}',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  // ══ УЗЛЫ ═══════════════════════════════════════════════════
  // Каждый узел висит на реальной детали SVG (data-slot проставлен
  // генератором), а не в списке сбоку: щёлкаешь по стволу — правишь ствол.
  var NODES = [
    { id: 'gun',   ic: '⌖', ru: 'Ствол',        anchor: ['barrel', 'last', 0.98],  side: 'r', fields: ['tech', 'caliber', 'barrelLen'] },
    { id: 'block', ic: '≡', ru: 'Блок стволов', anchor: ['barrel', 'first', 0.35], side: 'r', fields: ['layout', 'barrels'] },
    { id: 'hull',  ic: '⚔', ru: 'Башня',        anchor: ['hull', 'first', 0.5],    side: 'l', fields: ['klass', 'size', 'detail'] },
    { id: 'base',  ic: '⚙', ru: 'Платформа',    anchor: ['base', 'first', 0.16],   side: 'l', fields: ['platform', 'yaw', 'seed'] },
  ];
  var SLIDERS = {
    caliber:   ['Калибр, мм',        6, 500, 1],
    barrels:   ['Стволов',           1, 8, 1],
    barrelLen: ['Длина ствола, клб', 15, 110, 1],
    size:      ['Масштаб',           0.4, 3, 0.05],
    yaw:       ['Поворот башни, °',  -180, 180, 1],
    detail:    ['Детализация',       0, 1, 0.05],
    seed:      ['Сид',               1, 9999, 1],
  };
  var PICKS = { platform: 'Платформа', klass: 'Класс установки', tech: 'Технология', layout: 'Компоновка' };

  // Набор допустимых вариантов сужается под класс и число стволов.
  function optionsOf(key) {
    var cfg = CNT.cfg, o = {}, l;
    if (key === 'platform') return T().PLATFORMS;
    if (key === 'klass') { for (var k in T().CLASSES) o[k] = T().CLASSES[k].ru; return o; }
    if (key === 'tech') {
      T().rulesOf(cfg.klass).techs.forEach(function (t) { if (T().TECHS[t]) o[t] = T().TECHS[t].ru; });
      return o;
    }
    var LMIN = { row: 1, stacked: 2, quad: 4, rotary: 3 };
    for (l in T().LAYOUTS) if ((cfg.barrels | 0) >= (LMIN[l] || 1)) o[l] = T().LAYOUTS[l];
    return o;
  }
  function limitsOf(key) {
    var R = T().rulesOf(CNT.cfg.klass);
    if (key === 'caliber') return R.cal;
    if (key === 'barrelLen') return R.len;
    var s = SLIDERS[key]; return [s[1], s[2]];
  }

  // ══ ТТХ ════════════════════════════════════════════════════
  // Потолок полосы — предельная сборка ЭТОГО же класса: шкалы дрона и
  // линкора несопоставимы, общая шкала не сообщала бы ничего.
  var BARS = [
    ['damage', 'Урон', NUM],
    ['dalnost', 'Дальность', function (v) { return v + ' гекс'; }],
    ['rof', 'Темп', NUM],
    ['energy', 'Энергия', NUM],
    ['mass', 'Масса', function (v) { return NUM(v) + ' кг'; }],
    ['gs', 'Цена', function (v) { return NUM(v) + ' ГС'; }],
  ];
  var BETTER = { damage: 1, dalnost: 1, rof: 1, energy: -1, mass: -1, gs: -1 };
  var SEGN = 14, capMemo = {};
  function capsOf(klass) {
    if (capMemo[klass]) return capMemo[klass];
    var R = T().rulesOf(klass), c = {};
    R.techs.forEach(function (t) {
      var s = T().stats({ klass: klass, tech: t, caliber: R.cal[1], barrelLen: R.len[1], barrels: 8, layout: 'row' });
      BARS.forEach(function (b) { c[b[0]] = Math.max(c[b[0]] || 0, s[b[0]] || 0); });
    });
    for (var k in c) c[k] = c[k] || 1;
    return (capMemo[klass] = c);
  }
  function buildBars() {
    $t('bottom').innerHTML = BARS.map(function (b) {
      return '<div class="st"><div class="hd"><i>' + b[1] + '</i><div><u id="tf_u_' + b[0] + '"></u><em id="tf_d_' + b[0] + '"></em></div></div>' +
        '<div class="seg" id="tf_s_' + b[0] + '">' + new Array(SEGN + 1).join('<s></s>') + '</div></div>';
    }).join('');
  }
  function fillBars(s, prev) {
    var caps = capsOf(CNT.cfg.klass);
    BARS.forEach(function (b) {
      var k = b[0];
      $t('u_' + k).textContent = b[2](s[k]);
      var n = Math.max(0, Math.min(SEGN, Math.round((s[k] || 0) / caps[k] * SEGN)));
      var segs = $t('s_' + k).children, em = $t('d_' + k);
      // Призрачные сегменты: разница между текущей и наведённой сборкой.
      var pn = n, cls = '';
      if (prev) {
        pn = Math.max(0, Math.min(SEGN, Math.round((prev[k] || 0) / caps[k] * SEGN)));
        var diff = (s[k] || 0) - (prev[k] || 0);
        cls = diff ? (((diff > 0 ? 1 : -1) === BETTER[k]) ? 'up' : 'dn') : '';
        var pct = prev[k] ? Math.round(diff / prev[k] * 100) : 0;
        em.className = diff ? 'show ' + cls : '';
        em.textContent = (diff > 0 ? '+' : '') + pct + '%';
      } else em.className = '';
      var lo = Math.min(n, pn), hi = Math.max(n, pn);
      for (var i = 0; i < SEGN; i++) segs[i].className = i < lo ? 'f' : (prev && i < hi ? cls : '');
    });
  }
  // Наведение на вариант в списке: показываем, какой была бы сборка.
  function preview(candidate) {
    if (!candidate) { fillBars(T().stats(CNT.cfg)); return; }
    fillBars(T().stats(candidate), T().stats(CNT.cfg));
  }

  // ══ ВСПЛЫВАЮЩИЙ ВЫБОР ══════════════════════════════════════
  var DELTA = [['damage', 'УР'], ['dalnost', 'ДАЛ'], ['rof', 'ТЕМП'], ['energy', 'ЭН'], ['mass', 'МАС']];

  function optHTML(key) {
    var base = T().stats(CNT.cfg), opts = optionsOf(key), out = '';
    for (var v in opts) {
      var cand = T().normalize(Object.assign({}, CNT.cfg, { [key]: v })), s = T().stats(cand), d = '';
      DELTA.forEach(function (f) {
        var diff = (s[f[0]] || 0) - (base[f[0]] || 0);
        if (!diff) { d += '<span>' + f[1] + ' —</span>'; return; }
        var good = (diff > 0 ? 1 : -1) === BETTER[f[0]];
        d += '<s class="' + (good ? 'up' : 'dn') + '">' + f[1] + ' ' + (diff > 0 ? '+' : '') +
          (base[f[0]] ? Math.round(diff / base[f[0]] * 100) : 0) + '%</s>';
      });
      // Смена класса может выбить несовместимую технологию — предупреждаем.
      if (key === 'klass' && cand.tech !== CNT.cfg.tech) d += '<s class="dn">тех → ' + T().TECHS[cand.tech].ru + '</s>';
      out += '<div class="opt' + (CNT.cfg[key] === v ? ' sel' : '') + '" data-key="' + esc(key) + '" data-v="' + esc(v) + '">' +
        '<div class="nm">' + esc(opts[v]) + '</div><div class="dl">' + d + '</div></div>';
    }
    return out;
  }
  function sliderHTML(key) {
    var lim = limitsOf(key), st = SLIDERS[key][3];
    var lb = (key === 'caliber' || key === 'barrelLen') ? '<b class="lim">' + lim[0] + '–' + lim[1] + '</b>' : '';
    return '<div class="sl"><div class="h"><i>' + SLIDERS[key][0] + '</i><div><b id="tf_v_' + key + '">' + CNT.cfg[key] + '</b>' + lb + '</div></div>' +
      '<input type="range" data-k="' + key + '" min="' + lim[0] + '" max="' + lim[1] + '" step="' + st + '" value="' + CNT.cfg[key] + '"></div>';
  }
  function openNodePop(node, el) {
    if (CNT.openNode === node.id) { closePop(); return; }
    CNT.openNode = node.id;
    $t('popT').textContent = node.ru;
    $t('popB').innerHTML = node.fields.map(function (f) {
      return PICKS[f] ? '<div class="sec">' + PICKS[f] + '</div>' + optHTML(f) : sliderHTML(f);
    }).join('');
    showPop(el);
  }
  function showPop(el) {
    var p = $t('pop'), s = $t('stage').getBoundingClientRect();
    p.classList.add('on');
    // Окно не должно вылезать за сцену — лишнее уходит в прокрутку списка.
    p.style.maxHeight = Math.max(160, s.height - 16) + 'px';
    if (el) {
      var r = el.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
      var x = r.right - s.left + 14, y = r.top - s.top - h / 2 + r.height / 2;
      if (x + w > s.width - 8) x = r.left - s.left - w - 14;
      p.style.left = Math.max(8, Math.min(s.width - w - 8, x)) + 'px';
      p.style.top = Math.max(8, Math.min(s.height - h - 8, y)) + 'px';
    }
    document.querySelectorAll('.tf-app .node').forEach(function (n) { n.classList.toggle('on', n.dataset.id === CNT.openNode); });
  }
  function closePop() {
    CNT.openNode = null;
    var p = $t('pop'); if (p) p.classList.remove('on');
    preview(null);
    document.querySelectorAll('.tf-app .node').forEach(function (n) { n.classList.remove('on'); });
  }

  // ══ РАЗМЕЩЕНИЕ УЗЛОВ НА ДЕТАЛЯХ ════════════════════════════
  // Координата берётся из bbox реальной детали в SVG: башня повернулась или
  // сменила силуэт — узлы уехали вместе с ней.
  function anchorPoint(a) {
    var svg = document.querySelector('.tf-app #tf_svgbox svg'); if (!svg) return null;
    var els = svg.querySelectorAll('[data-slot="' + a[0] + '"]');
    if (!els.length) return null;
    var el = a[1] === 'last' ? els[els.length - 1] : els[0];
    var r = el.getBoundingClientRect(), s = $t('stage').getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left - s.left + r.width * a[2], y: r.top - s.top + r.height / 2 };
  }
  function placeNodes() {
    if (!$t('stage')) return;
    var s = $t('stage').getBoundingClientRect(), leads = $t('leads');
    leads.setAttribute('viewBox', '0 0 ' + s.width + ' ' + s.height);
    leads.setAttribute('width', s.width); leads.setAttribute('height', s.height);
    var lines = '';
    NODES.forEach(function (nd) {
      var el = document.querySelector('.tf-app .node[data-id="' + nd.id + '"]'); if (!el) return;
      var p = anchorPoint(nd.anchor) || { x: s.width / 2, y: s.height / 2 };
      // Узел выносим ЗА габарит рисунка, а не просто в сторону: иначе на
      // широких силуэтах он ложится поверх той самой детали, что подписывает.
      var svg = document.querySelector('.tf-app #tf_svgbox svg');
      var b = svg ? svg.getBoundingClientRect() : null;
      var edge = b ? (nd.side === 'l' ? b.left - s.left - 26 : b.right - s.left + 26) : p.x;
      var nx = Math.max(30, Math.min(s.width - 30, edge));
      var ny = Math.max(30, Math.min(s.height - 30, p.y + (nd.id === 'block' ? -64 : nd.id === 'base' ? 60 : 0)));
      el.style.left = nx + 'px'; el.style.top = ny + 'px';
      el.classList.toggle('lft', nd.side === 'l');
      lines += '<path d="M ' + nx + ' ' + ny + ' L ' + p.x + ' ' + p.y + '" stroke="rgba(185,160,106,.45)" stroke-width="1" fill="none"/>' +
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.5" fill="#e8a93f"/>';
    });
    leads.innerHTML = lines;
  }
  function buildNodes() {
    var html = NODES.map(function (n) {
      return '<div class="node" data-id="' + n.id + '"><span>' + n.ic + '</span>' +
        '<div class="lb"><i>' + n.ru + '</i><b id="tf_nb_' + n.id + '"></b></div></div>';
    }).join('');
    $t('stage').insertAdjacentHTML('beforeend', html);
    document.querySelectorAll('.tf-app .node').forEach(function (el) {
      var nd = NODES.find(function (n) { return n.id === el.dataset.id; });
      el.onclick = function (ev) { ev.stopPropagation(); openNodePop(nd, el); };
      // Наведение подсвечивает саму деталь на орудии.
      el.onmouseenter = function () { hilite(nd.anchor[0], true); };
      el.onmouseleave = function () { hilite(nd.anchor[0], false); };
    });
  }
  function hilite(slot, on) {
    var svg = document.querySelector('.tf-app #tf_svgbox svg'); if (!svg) return;
    svg.querySelectorAll('[data-slot="' + slot + '"]').forEach(function (e) {
      e.style.filter = on ? 'brightness(1.55) saturate(1.2)' : '';
    });
  }
  function nodeLabels() {
    var cfg = CNT.cfg;
    $t('nb_gun').textContent = T().TECHS[cfg.tech].ru + ' · ' + cfg.caliber + 'мм';
    $t('nb_block').textContent = (T().LAYOUTS[cfg.layout] || '') + ' ×' + cfg.barrels;
    $t('nb_hull').textContent = T().CLASSES[cfg.klass].ru;
    $t('nb_base').textContent = T().PLATFORMS[cfg.platform];
  }

  // ══ ДОСЬЕ ══════════════════════════════════════════════════
  var RES = { blackmetall: 'Чёрный металл', coloredmetall: 'Цветной металл',
              rudametall: 'Рудный металл', kristall: 'Кристаллы', staarvis: 'Ставрис' };
  var KIND_RU = { kinetic: 'кинетика', energy: 'энергия', missile: 'ракеты' };
  function drawDossier(s) {
    var h = '<div class="sec">Детали</div><table>' +
      '<tr><td>Урон за ствол</td><td>' + NUM(s.salvo) + '</td></tr>' +
      '<tr><td>Урона на энергию</td><td>' + s.dmgPerEnergy + '</td></tr>' +
      '<tr><td>Боеприпас</td><td>' + (KIND_RU[s.kind] || s.kind) + '</td></tr>' +
      '<tr><td>KV-прайс (не тратится)</td><td>' + NUM(s.price) + '</td></tr>' +
      '<tr><td>Технология</td><td>×' + s.tC + '</td></tr><tr><td>Тип урона</td><td>+' + s.dC + '</td></tr>' +
      '<tr><td>Класс</td><td>×' + s.cC + '</td></tr></table>';
    // Списывается со склада державы именно это (ведомость игровых ресурсов).
    h += '<div class="sec">Ресурсы на постройку</div><table>';
    for (var k in s.bill) h += '<tr><td>' + esc(k) + '</td><td>' + s.bill[k] + '</td></tr>';
    // Носители считаются из самой сборки (класс установки + масса + энергия).
    h += '</table><div class="sec">Ставится на</div><table>';
    T().carriers(CNT.cfg).forEach(function (c) {
      h += '<tr class="' + (c.ok ? 'ok' : 'no') + '"><td>' + (c.ok ? '✔' : '✕') + ' ' + esc(c.ru) + '</td><td>' + esc(c.why || '') + '</td></tr>';
    });
    // Связка с материаловедением: стойкость сплава к ТИПУ урона этого орудия —
    // ровно тот процент, на который бой погасит залп.
    var alloys = (typeof CN_ALLOYS !== 'undefined' && CN_ALLOYS) ? CN_ALLOYS : [];
    if (alloys.length) {
      h += '</table><div class="sec">Против своих сплавов</div><table>';
      alloys.map(function (a) {
        var r = ((a.stats || {}).resist || {})[s.kind] || 0;
        return { name: a.name, r: r, through: Math.max(0, Math.round(s.damage * (1 - r))) };
      }).sort(function (a, b) { return b.r - a.r; }).forEach(function (x) {
        h += '<tr><td>⚗ ' + esc(x.name) + '</td><td>−' + Math.round(x.r * 100) + '% → ' + NUM(x.through) + '</td></tr>';
      });
    }
    // Внутренняя KV-номенклатура — справочно, на склад не ложится.
    h += '</table><div class="sec">Конструкц. сырьё (KV, справочно)</div><table>';
    for (var r2 in s.resurs) if (s.resurs[r2] > 0) h += '<tr><td>' + RES[r2] + '</td><td>' + s.resurs[r2] + '</td></tr>';
    $t('dos').innerHTML = h + '</table>';
  }

  // ══ ОТРИСОВКА ══════════════════════════════════════════════
  // Сводка сборки живёт тут, а не в шапке: в шапке место нужно названию.
  function tipHTML(cfg) {
    return '<em>' + esc(T().CLASSES[cfg.klass].ru) + ' · ' + esc(T().TECHS[cfg.tech].ru) + ' · ' +
      cfg.caliber + 'мм L' + cfg.barrelLen + ' · ×' + cfg.barrels + '</em><br>' +
      'ЛКМ по узлу — правка · тяни фон — поворот · колесо — масштаб<br>' +
      'сид <b>' + cfg.seed + '</b> · поворот <b>' + Math.round(cfg.yaw) + '°</b> · масштаб <b>' + (+cfg.size).toFixed(2) + '</b>';
  }
  function draw() {
    var cfg = CNT.cfg;
    $t('svgbox').innerHTML = T().render(cfg);
    var s = T().stats(cfg);
    fillBars(s); drawDossier(s); nodeLabels();
    $t('tip').innerHTML = tipHTML(cfg);
    var save = $t('bSave');
    if (save) {
      var can = T().carrierKeys(cfg).length > 0;
      save.disabled = !can;
      save.textContent = CNT.editId ? '💾 Сохранить' : '✓ Зарегистрировать';
      save.title = can ? '' : 'Сборку не тянет ни один носитель';
    }
    requestAnimationFrame(placeNodes);
  }
  // Поворот НЕ трогает ни геометрию, ни ТТХ — это rotate() на группе башни.
  var pending = false;
  function spin(deg) {
    var g = document.querySelector('.tf-app #tf_svgbox svg [data-yaw]');
    if (g) g.setAttribute('transform', 'rotate(' + (Math.round(deg * 100) / 100) + ')');
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false; placeNodes();
      $t('tip').innerHTML = tipHTML(CNT.cfg);
    });
  }

  // ══ ВХОД ═══════════════════════════════════════════════════
  window.cnRenderTurretForge = async function () {
    setPg('<div class="sload"><div class="pulse-loader"></div></div>');
    await cnLoadMyFaction();
    if (!cnCanAccess()) { cnGate(); return; }
    if (!T()) { setPg('<div class="sempty">turret_gen.js не загружен</div>'); return; }
    injectStyle();
    if (!CNT.cfg) CNT.cfg = T().normalize(Object.assign({}, T().DEFAULTS));
    await loadMine();

    var fac = cnMyFactionMeta();
    setPg(
      '<div class="tf-app">' +
        '<div id="tf_top">' +
          '<a class="hbtn" onclick="go(\'constructors\')" style="cursor:pointer">← Назад</a>' +
          '<button class="hbtn" id="tf_bPreset">Пресет</button>' +
          '<button class="hbtn" id="tf_bPaint">Окраска</button>' +
          '<button class="hbtn" id="tf_bMine">Мои орудия</button>' +
          '<input id="tf_nm" maxlength="48" placeholder="Название орудия" value="' + esc(CNT.editName || '') + '">' +
          '<button class="hbtn" id="tf_bDos">Досье</button>' +
          '<button class="hbtn" id="tf_bDl">SVG</button>' +
          '<button class="hbtn acc" id="tf_bSave">✓ Зарегистрировать</button>' +
        '</div>' +
        '<div id="tf_stage">' +
          '<div id="tf_grid"></div>' +
          '<div id="tf_svgbox"></div>' +
          '<svg id="tf_leads"></svg>' +
          '<div id="tf_vig"></div>' +
          '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>' +
          '<div id="tf_tip"></div>' +
          '<div id="tf_pop"><div class="ph"><b id="tf_popT"></b><span id="tf_popX">✕</span></div><div class="pb" id="tf_popB"></div></div>' +
          '<div id="tf_dos"></div>' +
        '</div>' +
        '<div id="tf_bottom"></div>' +
      '</div>' +
      (fac ? '' : '')
    );
    buildBars(); buildNodes(); bindStage(); draw();
  };

  async function loadMine() {
    var fac = cnMyFactionMeta();
    try {
      var q = 'select=*&order=updated_at.desc';
      if (fac && fac.faction_id) q = 'faction_id=eq.' + encodeURIComponent(fac.faction_id) + '&' + q;
      CNT.turrets = await dbGet('faction_turrets', q) || [];
    } catch (e) { CNT.turrets = []; }
    // сплавы фракции — для секции досье «против своих сплавов»
    try { if (typeof cnLoadAlloys === 'function') await cnLoadAlloys(); } catch (e) { /* не критично */ }
  }

  // ══ СОБЫТИЯ СЦЕНЫ ══════════════════════════════════════════
  function bindStage() {
    var stage = $t('stage'), popB = $t('popB');

    $t('popX').onclick = closePop;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $t('pop')) closePop(); });

    popB.onclick = function (e) {
      var o = e.target.closest('.opt'); if (!o) return;
      CNT.cfg[o.dataset.key] = o.dataset.v;
      Object.assign(CNT.cfg, T().normalize(CNT.cfg));
      closePop(); draw();
    };
    popB.oninput = function (e) {
      var k = e.target.dataset.k; if (!k) return;
      CNT.cfg[k] = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
      Object.assign(CNT.cfg, T().normalize(CNT.cfg));
      var b = $t('v_' + k); if (b) b.textContent = CNT.cfg[k];
      // Поворот — только transform, без перерисовки и пересчёта ТТХ.
      if (k === 'yaw') { spin(CNT.cfg.yaw); return; }
      // Число стволов меняет сам список компоновок — пересобираем список.
      var keep = CNT.openNode; draw();
      if (k === 'barrels' && keep) {
        var n = document.querySelector('.tf-app .node[data-id="' + keep + '"]');
        if (n) { CNT.openNode = null; openNodePop(NODES.find(function (x) { return x.id === keep; }), n); }
      }
    };
    popB.onmouseover = function (e) {
      var o = e.target.closest('.opt'); if (!o) return;
      preview(T().normalize(Object.assign({}, CNT.cfg, { [o.dataset.key]: o.dataset.v })));
    };
    popB.onmouseout = function (e) { if (e.target.closest('.opt')) preview(null); };

    // ── Панели шапки
    $t('bPreset').onclick = function (e) {
      CNT.openNode = 'preset';
      $t('popT').textContent = 'Пресет из каталога';
      $t('popB').innerHTML = '<div style="padding:8px 10px"><select class="kv" id="tf_kv"><option value="">— вручную —</option></select></div>';
      showPop(e.target);
      var kv = $t('kv');
      if (window.KV) {
        // Только башенные орудия: ножи, пистолеты и ангарные звенья тут ни к чему.
        var lib = T().turretCatalog(KV.weaponLibrary), byCat = {};
        for (var n in lib) (byCat[lib[n].category || 'Прочее'] || (byCat[lib[n].category || 'Прочее'] = [])).push(n);
        Object.keys(byCat).sort().forEach(function (cat) {
          var g = document.createElement('optgroup'); g.label = cat;
          byCat[cat].sort().forEach(function (nm) {
            var o = document.createElement('option'); o.value = nm; o.textContent = nm; g.appendChild(o);
          });
          kv.appendChild(g);
        });
        kv.onchange = function (ev) {
          if (!ev.target.value) return;
          Object.assign(CNT.cfg, T().fromKV(ev.target.value, KV.weaponLibrary[ev.target.value]));
          // имя пресета — разумная заготовка для названия своего орудия
          var nmEl = $t('nm');
          if (nmEl && !nmEl.value.trim()) nmEl.value = ev.target.value.slice(0, 48);
          closePop(); draw();
        };
      }
    };
    $t('bPaint').onclick = function (e) {
      CNT.openNode = 'paint';
      $t('popT').textContent = 'Окраска и вид';
      $t('popB').innerHTML = '<div class="row2">' +
        '<div><i>Основной</i><input type="color" data-k="tint" value="' + CNT.cfg.tint + '"></div>' +
        '<div><i>Акцент</i><input type="color" data-k="accent" value="' + CNT.cfg.accent + '"></div></div>' +
        sliderHTML('detail') + sliderHTML('seed') + sliderHTML('size');
      showPop(e.target);
    };
    $t('bMine').onclick = function (e) { openMinePop(e.target); };
    $t('bDos').onclick = function () { $t('dos').classList.toggle('on'); };
    $t('bDl').onclick = function () {
      var b = new Blob([T().render(CNT.cfg)], { type: 'image/svg+xml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = ((($t('nm') || {}).value || 'turret').trim() || 'turret') + '.svg';
      a.click();
    };
    $t('bSave').onclick = register;

    // ── Сцена: тянем фон — крутим башню, колесо — масштаб
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.node, #tf_pop, #tf_dos')) return;
      closePop();
      CNT.drag = { x: e.clientX, yaw: +CNT.cfg.yaw };
      stage.classList.add('drag'); stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!CNT.drag) return;
      var y = CNT.drag.yaw + (e.clientX - CNT.drag.x) * 0.55;
      CNT.cfg.yaw = ((y + 180) % 360 + 360) % 360 - 180;
      spin(CNT.cfg.yaw);
    });
    var stopDrag = function () {
      if (!CNT.drag) return;
      CNT.drag = null; stage.classList.remove('drag');
      // Ползунок поворота в открытой панели должен догнать реальный угол.
      var inp = document.querySelector('.tf-app #tf_popB input[data-k="yaw"]');
      if (inp) { inp.value = CNT.cfg.yaw; var b = $t('v_yaw'); if (b) b.textContent = Math.round(CNT.cfg.yaw); }
    };
    stage.addEventListener('pointerup', stopDrag);
    stage.addEventListener('pointercancel', stopDrag);
    // Масштаб меняет саму геометрию — тут перерисовка нужна, но не чаще кадра.
    var zoomRAF = false;
    stage.addEventListener('wheel', function (e) {
      // Попап и досье лежат ВНУТРИ сцены: без этой отсечки зум съедал их прокрутку.
      if (e.target.closest('#tf_pop, #tf_dos')) return;
      e.preventDefault();
      CNT.cfg.size = Math.max(0.4, Math.min(3, +(CNT.cfg.size - Math.sign(e.deltaY) * 0.06).toFixed(2)));
      if (zoomRAF) return;
      zoomRAF = true;
      requestAnimationFrame(function () { zoomRAF = false; draw(); });
    }, { passive: false });
    window.addEventListener('resize', placeNodes);
  }

  // ══ МОИ ОРУДИЯ ═════════════════════════════════════════════
  function openMinePop(el) {
    CNT.openNode = 'mine';
    $t('popT').textContent = 'Мои орудия';
    var list = CNT.turrets || [];
    $t('popB').innerHTML = list.length
      ? '<div style="padding:6px 10px"><button class="hbtn" data-new="1" style="width:100%">+ Новое орудие</button></div>' +
        list.map(function (t) {
          var st = t.stats || {};
          return '<div class="mine"><div class="mn" data-id="' + t.id + '"><b>⚙ ' + esc(t.name) + '</b>' +
            '<s>урон ' + NUM(st.damage || 0) + ' · ' + (st.dalnost || 0) + ' гекс · Э ' + NUM(st.energy || 0) +
            ' · ' + NUM(st.mass || 0) + ' кг · носителей ' + ((t.carriers || []).length) + '</s></div>' +
            '<button class="xb" data-del="' + t.id + '">✕</button></div>';
        }).join('')
      : '<div style="padding:14px 12px;color:#7b7f86;font-size:12px;line-height:1.6">Пока пусто. Собери орудие, дай ему имя и зарегистрируй — оно появится в слоте вооружения корабельной верфи и планетарного арсенала.</div>';
    showPop(el);
    $t('popB').querySelectorAll('.mn').forEach(function (n) { n.onclick = function () { edit(n.dataset.id); }; });
    $t('popB').querySelectorAll('[data-del]').forEach(function (n) { n.onclick = function () { del(n.dataset.del); }; });
    var nb = $t('popB').querySelector('[data-new]');
    if (nb) nb.onclick = newDraft;
  }

  function newDraft() {
    CNT.editId = null; CNT.editName = '';
    CNT.cfg = T().normalize(Object.assign({}, T().DEFAULTS));
    var nm = $t('nm'); if (nm) nm.value = '';
    closePop(); draw();
  }

  function edit(id) {
    var t = (CNT.turrets || []).find(function (x) { return String(x.id) === String(id); });
    if (!t) return;
    CNT.editId = t.id; CNT.editName = t.name || '';
    CNT.cfg = T().normalize(Object.assign({}, T().DEFAULTS, t.cfg || {}));
    var nm = $t('nm'); if (nm) nm.value = CNT.editName;
    closePop(); draw();
  }

  async function register() {
    if (CNT.busy) return;
    var nm = $t('nm'), name = (nm && nm.value || '').trim();
    if (!name) { toast('Дайте орудию название', 'err'); if (nm) nm.focus(); return; }
    if (!T().carrierKeys(CNT.cfg).length) { toast('Сборку не тянет ни один носитель', 'err'); return; }
    CNT.editName = name;
    var fac = cnMyFactionMeta();
    // Поворот башни — режим осмотра, а не свойство орудия: в базу не едет.
    var cfg = Object.assign({}, CNT.cfg); delete cfg.yaw;
    CNT.busy = true;
    try {
      var res = await ecRpc('turret_upsert', {
        p_turret_id: CNT.editId || null,
        p_name: name,
        p_cfg: cfg,
        p_faction_id: (fac && fac.faction_id) || null,
        p_faction_name: (fac && fac.faction_name) || null,
        p_faction_color: (fac && fac.faction_color) || null,
      });
      var row = (res && res.id) ? res : (Array.isArray(res) ? res[0] : res);
      var wasEdit = !!CNT.editId;
      if (row && row.id) CNT.editId = row.id;
      // сбросить кэш каталогов конструктора — орудие должно появиться в слоте
      if (typeof cnInvalidateTurrets === 'function') cnInvalidateTurrets();
      toast(wasEdit ? 'Орудие сохранено ✓' : 'Орудие зарегистрировано ✓', 'ok');
      await loadMine(); draw();
    } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'err'); }
    finally { CNT.busy = false; }
  }

  async function del(id) {
    if (CNT.busy) return;
    if (!confirm('Удалить орудие? Оно исчезнет из слота вооружения (уже построенная техника не изменится).')) return;
    CNT.busy = true;
    try {
      await ecRpc('turret_delete', { p_turret_id: id });
      if (typeof cnInvalidateTurrets === 'function') cnInvalidateTurrets();
      if (String(CNT.editId) === String(id)) newDraft();
      toast('Орудие удалено', 'ok');
      await loadMine(); closePop(); draw();
    } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'err'); }
    finally { CNT.busy = false; }
  }
})();
