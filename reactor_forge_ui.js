// © 2025–2026. Все права защищены.
// Проприетарное ПО. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// РЕАКТОРНАЯ ВЕРФЬ (#build-reactor) — верстак энергоустановок
// ────────────────────────────────────────────────────────────
// Оформление и вся механика сцены — те же, что на оружейной верфи
// (turret_forge_ui.js): узлы правки стоят НА самом изделии, всплывашки
// показывают дельты ТТХ, внизу сегментные полосы. Отличается предмет:
// вместо калибра и стволов — школа реактора, топливо со склада державы,
// теплоноситель, схема преобразования (КПД), удержание и регулирование.
//
// reactor_gen.js (window.RG) рисует и считает. В базу пишет ЗЕРКАЛО НА
// СЕРВЕРЕ (_rg_stats, файл _reactor_forge.sql) — клиентским цифрам не
// доверяем. Расхождение зеркал = баг: правил reactor_gen.js — правь и SQL.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var CNR = { cfg: null, editId: null, editName: '', reactors: [], busy: false, openNode: null, drag: null };
  window.CNR = CNR;

  function R() { return window.RG; }
  function $r(id) { return document.getElementById('rf_' + id); }
  function NUM(n) {
    return n >= 1e9 ? (n / 1e9).toFixed(2) + ' млрд'
         : n >= 1e6 ? (n / 1e6).toFixed(2) + ' млн'
         : Math.round(n).toLocaleString('ru-RU');
  }

  // ── Стили: та же палитра верстака, загнанная под .rf-app ──
  // Срезанные углы делаются слоем-подложкой (правила оформления игры),
  // поэтому у плашек тут нет border — только фон и разница отступов.
  function injectStyle() {
    if (document.getElementById('rf-style')) return;
    var s = document.createElement('style'); s.id = 'rf-style';
    s.textContent = [
      '.rf-app{--bg:#0f1113;--panel:#191c1f;--panel2:#22262a;--line:#2e3338;--line2:#414850;',
        '--txt:#c8c5bc;--dim:#7b7f86;--tan:#b9a06a;--amber:#e8a93f;--good:#86c25c;--bad:#c9553c;',
        'position:relative;display:flex;flex-direction:column;height:calc(100vh - 96px);min-height:520px;',
        'background:#0f1113;color:var(--txt);overflow:hidden;user-select:none;',
        'font:13px/1.4 "Segoe UI",Roboto,system-ui,sans-serif;border:1px solid var(--line2)}',
      '.rf-app *{box-sizing:border-box}',
      '.rf-app button,.rf-app select,.rf-app input{font-family:inherit}',

      '.rf-app #rf_top{flex:none;min-height:44px;display:flex;align-items:center;gap:8px;padding:0 10px;',
        'background:linear-gradient(180deg,#22262a,#15181b);border-bottom:1px solid var(--line2);z-index:40}',
      '.rf-app .hbtn{background:#262b30;color:var(--txt);border:1px solid var(--line2);padding:6px 11px;cursor:pointer;',
        'font-size:11px;letter-spacing:1.4px;text-transform:uppercase;text-decoration:none;white-space:nowrap}',
      '.rf-app .hbtn:hover{background:#333940;border-color:var(--tan);color:#fff}',
      '.rf-app .hbtn.acc{background:var(--tan);color:#15181b;font-weight:700;border-color:var(--amber)}',
      '.rf-app .hbtn.acc:hover{background:var(--amber)}',
      '.rf-app .hbtn[disabled]{opacity:.4;cursor:default}',
      '.rf-app #rf_nm{flex:1;min-width:140px;background:#101314;color:#e3ded1;border:1px solid var(--line2);',
        'padding:6px 9px;font-size:12px;letter-spacing:.06em}',
      '.rf-app #rf_nm:focus{outline:none;border-color:var(--tan)}',

      // touch-action:none — иначе на телефоне протяжка по сцене скроллит
      // страницу, а не поворачивает изделие.
      '.rf-app #rf_stage{flex:1;position:relative;min-height:0;overflow:hidden;cursor:grab;touch-action:none;',
        'background:radial-gradient(ellipse at 50% 46%,#242a2e 0%,#0d0f11 70%)}',
      '.rf-app #rf_stage.drag{cursor:grabbing}',
      '.rf-app #rf_grid{position:absolute;inset:0;pointer-events:none;',
        'background:linear-gradient(rgba(185,160,106,.055) 1px,transparent 1px) 0 0/100% 40px,',
        'linear-gradient(90deg,rgba(185,160,106,.055) 1px,transparent 1px) 0 0/40px 100%;',
        '-webkit-mask-image:radial-gradient(ellipse at 50% 50%,#000 18%,transparent 76%);',
        'mask-image:radial-gradient(ellipse at 50% 50%,#000 18%,transparent 76%)}',
      '.rf-app #rf_vig{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 160px rgba(0,0,0,.9)}',
      '.rf-app #rf_svgbox{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}',
      '.rf-app #rf_svgbox svg{max-width:74%;max-height:76%;filter:drop-shadow(0 20px 40px rgba(0,0,0,.75))}',
      '.rf-app #rf_leads{position:absolute;inset:0;pointer-events:none;z-index:5}',
      '.rf-app .corner{position:absolute;width:20px;height:20px;border:1px solid rgba(185,160,106,.35);pointer-events:none;z-index:6}',
      '.rf-app .corner.tl{top:12px;left:12px;border-right:0;border-bottom:0}',
      '.rf-app .corner.tr{top:12px;right:12px;border-left:0;border-bottom:0}',
      '.rf-app .corner.bl{bottom:12px;left:12px;border-right:0;border-top:0}',
      '.rf-app .corner.br{bottom:12px;right:12px;border-left:0;border-top:0}',
      '.rf-app #rf_tip{position:absolute;left:12px;top:12px;z-index:6;pointer-events:none;',
        'font:10px/1.7 "Consolas",monospace;color:var(--dim);letter-spacing:1.4px;text-transform:uppercase}',
      '.rf-app #rf_tip b{color:var(--tan)}',
      '.rf-app #rf_tip em{font-style:normal;color:#e3ded1;letter-spacing:1.8px}',

      '.rf-app .node{position:absolute;z-index:10;transform:translate(-50%,-50%);cursor:pointer;',
        'width:26px;height:26px;display:grid;place-items:center;',
        'background:rgba(20,23,26,.9);border:1px solid var(--line2);color:var(--tan);font-size:13px;',
        'transition:transform .1s,background .12s,border-color .12s}',
      '.rf-app .node:before{content:"";position:absolute;inset:-7px;border:1px solid transparent}',
      '.rf-app .node:hover,.rf-app .node.on{background:var(--tan);color:#15181b;border-color:var(--amber);transform:translate(-50%,-50%) scale(1.12)}',
      '.rf-app .node:hover:before,.rf-app .node.on:before{border-color:rgba(232,169,63,.5)}',
      '.rf-app .node .lb{position:absolute;left:34px;top:50%;transform:translateY(-50%);white-space:nowrap;',
        'background:rgba(16,19,21,.94);border:1px solid var(--line2);border-left:2px solid var(--tan);',
        'padding:4px 9px;pointer-events:none;opacity:0;transition:opacity .12s}',
      '.rf-app .node.lft .lb{left:auto;right:34px;border-left:1px solid var(--line2);border-right:2px solid var(--tan)}',
      '.rf-app .node:hover .lb{opacity:1}',
      '.rf-app .node .lb i{display:block;font-style:normal;font-size:8px;letter-spacing:2px;color:var(--dim);text-transform:uppercase}',
      '.rf-app .node .lb b{font-size:12px;color:#e3ded1;font-weight:500}',

      '.rf-app #rf_bottom{flex:none;display:flex;align-items:stretch;background:linear-gradient(180deg,#1b1f22,#121517);',
        'border-top:1px solid var(--line2);z-index:30;overflow-x:auto}',
      '.rf-app .st{flex:1;min-width:132px;padding:7px 12px;border-right:1px solid #24282c}',
      '.rf-app .st .hd{display:flex;justify-content:space-between;align-items:baseline}',
      '.rf-app .st i{font-style:normal;font-size:8.5px;letter-spacing:2px;text-transform:uppercase;color:var(--dim)}',
      '.rf-app .st u{text-decoration:none;font:600 13px "Consolas",monospace;color:#e3ded1}',
      '.rf-app .st em{font-style:normal;font:600 10px "Consolas",monospace;margin-left:5px;opacity:0}',
      '.rf-app .st em.show{opacity:1}.rf-app .st em.up{color:var(--good)}.rf-app .st em.dn{color:var(--bad)}',
      '.rf-app .seg{display:flex;gap:2px;margin-top:6px;height:7px}',
      '.rf-app .seg s{flex:1;background:#22262a;border-top:1px solid #2c3136;text-decoration:none}',
      '.rf-app .seg s.f{background:linear-gradient(180deg,#c9ae74,#8d7642)}',
      // Сегменты СВЕРХ заводского потолка красим отдельно: игрок должен видеть,
      // где кончается «как на заводе» и начинается его собственный выигрыш.
      '.rf-app .seg s.over{background:linear-gradient(180deg,#e8a93f,#966a1c)}',
      '.rf-app .seg s.up{background:repeating-linear-gradient(45deg,#86c25c 0 3px,#5d8b3f 3px 6px)}',
      '.rf-app .seg s.dn{background:repeating-linear-gradient(45deg,#c9553c 0 3px,#8b3826 3px 6px)}',

      '.rf-app #rf_pop{position:absolute;z-index:60;width:352px;max-height:520px;display:none;',
        'flex-direction:column;background:var(--panel);border:1px solid var(--line2);box-shadow:0 20px 50px rgba(0,0,0,.75)}',
      '.rf-app #rf_pop.on{display:flex}',
      '.rf-app #rf_pop .ph{flex:none;display:flex;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line2);',
        'background:linear-gradient(180deg,#262b30,#1c2024)}',
      '.rf-app #rf_pop .ph b{flex:1;font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:var(--tan)}',
      '.rf-app #rf_pop .ph span{cursor:pointer;color:var(--dim);font-size:17px;line-height:1;padding:0 3px}',
      '.rf-app #rf_pop .ph span:hover{color:var(--bad)}',
      '.rf-app #rf_pop .pb{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px}',
      '.rf-app .opt{padding:7px 10px;cursor:pointer;background:#1d2124;border:1px solid #2b3035;margin-bottom:5px;position:relative}',
      '.rf-app .opt:hover{background:#2b3238;border-color:var(--tan)}',
      '.rf-app .opt.sel{border-color:var(--amber);background:#2a2820}',
      '.rf-app .opt.sel:after{content:"✔";position:absolute;top:6px;right:9px;color:var(--amber);font-size:11px}',
      '.rf-app .opt .nm{font-size:12.5px;color:#e3ded1;padding-right:20px}',
      '.rf-app .opt .lore{font-size:10.5px;line-height:1.5;color:#6d727a;margin-top:3px}',
      '.rf-app .opt .dl{display:flex;flex-wrap:wrap;gap:3px 9px;font:10px "Consolas",monospace;color:#5f646a;margin-top:3px}',
      '.rf-app .opt .dl s{text-decoration:none}.rf-app .opt .dl s.up{color:var(--good)}.rf-app .opt .dl s.dn{color:var(--bad)}',
      '.rf-app .sec{padding:8px 10px 4px;font-size:9px;letter-spacing:2.4px;text-transform:uppercase;color:var(--tan)}',
      '.rf-app .sl{padding:7px 10px 9px;border-bottom:1px solid #24282c}',
      '.rf-app .sl .h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}',
      '.rf-app .sl .h i{font-style:normal;font-size:9px;letter-spacing:1.8px;text-transform:uppercase;color:var(--dim)}',
      '.rf-app .sl .h b{font:600 12px "Consolas",monospace;color:var(--amber)}',
      '.rf-app .sl .hint{font-size:10px;line-height:1.5;color:#6d727a;margin-top:4px}',
      '.rf-app input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:16px;background:none;margin:0;cursor:pointer}',
      '.rf-app input[type=range]::-webkit-slider-runnable-track{height:4px;background:#101314;border:1px solid #2e3338}',
      '.rf-app input[type=range]::-moz-range-track{height:4px;background:#101314;border:1px solid #2e3338}',
      '.rf-app input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:15px;margin-top:-6px;',
        'background:linear-gradient(180deg,#dcc084,#a3854a);border:1px solid #0f1113}',
      '.rf-app input[type=range]::-moz-range-thumb{width:11px;height:15px;border-radius:0;',
        'background:linear-gradient(180deg,#dcc084,#a3854a);border:1px solid #0f1113}',
      '.rf-app input[type=color]{width:100%;height:28px;background:#101314;border:1px solid var(--line2);padding:2px;cursor:pointer}',
      '.rf-app .row2{display:flex;gap:8px;padding:8px 10px}.rf-app .row2>div{flex:1}',
      '.rf-app .row2 i{font-style:normal;display:block;font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:var(--dim);margin-bottom:4px}',
      '.rf-app select.kv{width:100%;background:#101314;color:#e3ded1;border:1px solid var(--line2);padding:6px 8px;font-size:12px}',

      // ── Досье
      '.rf-app #rf_dos{position:absolute;right:0;top:0;bottom:0;width:340px;z-index:35;display:none;',
        'overflow-y:auto;overscroll-behavior:contain;padding:10px 12px 20px;',
        'background:linear-gradient(90deg,rgba(15,17,19,.4),rgba(21,24,27,.97) 22%)}',
      '.rf-app #rf_dos.on{display:block}',
      '.rf-app #rf_dos table{width:100%;border-collapse:collapse;font-size:11.5px}',
      '.rf-app #rf_dos td{padding:3px 0;border-bottom:1px solid #21252a;color:#9a9ea5}',
      '.rf-app #rf_dos td:last-child{text-align:right;color:#e3ded1;font-family:Consolas,monospace}',
      '.rf-app #rf_dos tr.ok td:last-child{color:var(--good)}',
      '.rf-app #rf_dos tr.no td,.rf-app #rf_dos tr.no td:last-child{color:#6b5148}',

      // ── Предупреждение приёмки
      '.rf-app #rf_warn{position:absolute;left:12px;right:12px;bottom:12px;z-index:20;display:none;',
        'padding:9px 12px;background:rgba(40,18,14,.94);color:#e5b1a4;font-size:11.5px;line-height:1.6;',
        'border-left:2px solid var(--bad)}',
      '.rf-app #rf_warn.on{display:block}',
      '.rf-app #rf_warn b{color:#ffb9a8}',

      // ── «Мои реакторы»
      '.rf-app .mine{display:flex;align-items:stretch;gap:5px;margin-bottom:5px}',
      '.rf-app .mine .mn{flex:1;padding:7px 10px;background:#1d2124;border:1px solid #2b3035;cursor:pointer}',
      '.rf-app .mine .mn:hover{background:#2b3238;border-color:var(--tan)}',
      '.rf-app .mine .mn b{display:block;font-size:12.5px;color:#e3ded1;font-weight:500}',
      '.rf-app .mine .mn s{display:block;text-decoration:none;font:10px "Consolas",monospace;color:#5f646a;margin-top:2px}',
      '.rf-app .mine .xb{width:30px;background:#1d2124;border:1px solid #2b3035;color:#6b7077;cursor:pointer}',
      '.rf-app .mine .xb:hover{background:#3a231e;border-color:var(--bad);color:#e5b1a4}',

      // ── Телефон ─────────────────────────────────────────────
      // Правки не косметические: на тач-экране нет ни курсора, ни колеса,
      // поэтому всплывашка становится нижней шторкой, подписи узлов уходят
      // (их некому наводить), а габарит крутится ползунком, а не колесом.
      '@media (max-width:900px){',
        '.rf-app{height:calc(100dvh - 96px);min-height:420px}',
        '.rf-app #rf_top{flex-wrap:wrap;padding:7px;gap:6px}',
        '.rf-app #rf_nm{order:9;flex:1 0 100%}',
        '.rf-app .hbtn{padding:8px 10px;font-size:10.5px}',
        '.rf-app #rf_svgbox svg{max-width:96%;max-height:80%}',
        '.rf-app .node{width:34px;height:34px;font-size:15px}',
        '.rf-app .node .lb{display:none}',
        // Шторка снизу: у узла её ставить некуда — палец закрывает пол-экрана.
        '.rf-app #rf_pop{left:0!important;right:0;top:auto!important;bottom:0;width:100%;',
          'max-height:64vh!important;box-shadow:0 -18px 40px rgba(0,0,0,.8)}',
        '.rf-app #rf_pop .ph{padding:12px}',
        '.rf-app #rf_pop .ph span{font-size:22px;padding:0 8px}',
        '.rf-app .opt{padding:10px 12px}',
        '.rf-app #rf_dos{width:100%;background:rgba(17,20,22,.98)}',
        '.rf-app .st{min-width:104px;padding:6px 9px}',
        '.rf-app #rf_tip{font-size:9px;letter-spacing:1px;right:12px}',
        '.rf-app #rf_warn{font-size:11px;padding:8px 10px}',
        // Ручка ползунка под палец, а не под мышь.
        '.rf-app input[type=range]{height:30px}',
        '.rf-app input[type=range]::-webkit-slider-thumb{width:20px;height:26px;margin-top:-12px}',
        '.rf-app input[type=range]::-moz-range-thumb{width:20px;height:26px}',
      '}',
      // Узкий и низкий экран (телефон лёжа): досье и шторка не должны
      // съедать всю сцену.
      '@media (max-width:900px) and (max-height:520px){',
        '.rf-app #rf_pop{max-height:80vh!important}',
        '.rf-app .st{min-width:92px}',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  // ══ УЗЛЫ ПРАВКИ НА ИЗДЕЛИИ ═════════════════════════════════
  // anchor: [data-slot детали, какую из них брать, доля ширины].
  var NODES = [
    { id: 'fuel',   ic: '☢', ru: 'Топливо',        side: 'l', anchor: ['fuel', 'first', 0.5],
      fields: ['fuel', 'enrich'] },
    { id: 'core',   ic: '⬢', ru: 'Активная зона',  side: 'l', anchor: ['vessel', 'first', 0.5],
      fields: ['school', 'cores', 'temp', 'size'] },
    { id: 'conf',   ic: '⊙', ru: 'Удержание',      side: 'l', anchor: ['conf', 'first', 0.5],
      fields: ['conf', 'damp'] },
    { id: 'cool',   ic: '≋', ru: 'Теплоноситель',  side: 'r', anchor: ['cool', 'first', 0.5],
      fields: ['cool'] },
    { id: 'conv',   ic: '⚡', ru: 'Преобразование', side: 'r', anchor: ['conv', 'first', 0.5],
      fields: ['conv'] },
    { id: 'rad',    ic: '▤', ru: 'Радиаторы',      side: 'r', anchor: ['rad', 'first', 0.5],
      fields: ['rad'] },
    { id: 'shield', ic: '▣', ru: 'Биозащита',      side: 'r', anchor: ['shield', 'first', 0.5],
      fields: ['shield'] },
    { id: 'klass',  ic: '⛴', ru: 'Носитель',       side: 'l', anchor: ['frame', 'first', 0.5],
      fields: ['klass'] },
  ];

  var SLIDERS = {
    size:   ['Габарит установки', 'Больше объём зоны — больше выработки и железа'],
    cores:  ['Контуров в зоне',   'Каналы мешают друг другу: шесть не вшестеро мощнее одного'],
    enrich: ['Обогащение',        'Выше чистота — плотнее выход, но меньше запас устойчивости'],
    temp:   ['Рабочая температура', 'Главный дроссель: тянет вверх и выработку, и риск'],
    rad:    ['Площадь радиаторов', 'Сбрасывает тепло, но добавляет массу и заметность: сигнатура режет скрытность борта в бою'],
    shield: ['Биозащита',          'Гасит сигнатуру и добавляет устойчивости — ценой массы и объёма'],
    damp:   ['Регулирование',      'Поглотители глушат зону: −мощность, +устойчивость. Устойчивость = секунды хода в бою'],
    detail: ['Детализация', ''],
    seed:   ['Сид', ''],
  };
  var PICKS = { school: 'Школа реактора', fuel: 'Топливо', conv: 'Схема преобразования',
                cool: 'Теплоноситель', conf: 'Удержание зоны', klass: 'Класс-носитель' };

  // Набор допустимых вариантов сужается школой и классом.
  function optionsOf(key) {
    var cfg = CNR.cfg, o = {}, i, L;
    if (key === 'klass') {
      R().CARRIER_ORDER.forEach(function (k) {
        if (R().allowedSchools(k).length) o[k] = R().CARRIERS[k].ru;
      });
      return o;
    }
    if (key === 'school') {
      R().allowedSchools(cfg.klass).forEach(function (k) {
        o[k] = R().SCHOOLS[k].ab + ' — ' + R().SCHOOLS[k].ru;
      });
      return o;
    }
    if (key === 'fuel') { L = R().allowedFuels(cfg.school); for (i = 0; i < L.length; i++) o[L[i]] = R().FUELS[L[i]].ru; return o; }
    if (key === 'conv') { L = R().allowedConv(cfg.school); for (i = 0; i < L.length; i++) o[L[i]] = R().CONV[L[i]].ru + ' — КПД ' + Math.round(R().CONV[L[i]].eff * 100) + '%'; return o; }
    if (key === 'conf') { L = R().allowedConf(cfg.school); for (i = 0; i < L.length; i++) o[L[i]] = R().CONF[L[i]].ru; return o; }
    if (key === 'cool') { L = R().allowedCool(cfg.school); for (i = 0; i < L.length; i++) o[L[i]] = R().COOL[L[i]].ru; return o; }
    return o;
  }
  function loreOf(key, v) {
    if (key === 'school') return R().SCHOOLS[v].lore;
    if (key === 'fuel') return 'Со склада державы: ' + R().FUELS[v].res;
    if (key === 'klass') {
      var c = R().CARRIERS[v];
      return 'Заводской максимум ' + NUM(c.refPower) + ' ⚡ · масса до ' + NUM(c.massCap) + ' кг';
    }
    return '';
  }

  // ══ ТТХ ════════════════════════════════════════════════════
  // Полосы меряются потолком КЛАССА, а не абстрактным максимумом: смысл
  // верстака в том, насколько сборка обгоняет заводской реактор этого борта.
  var BARS = [
    ['power', 'Выработка', function (v) { return NUM(v) + ' ⚡'; }],
    // Тот же показатель, что в конструкторе кораблей (kv.cap): единицы нагрузки,
    // а не килограммы. Сами кг остались в досье.
    ['capacityPenalty', 'Нагрузка на шасси', NUM],
    ['eff',   'КПД',       function (v) { return v + '%'; }],
    ['stab',  'Устойчивость', function (v) { return v + '%'; }],
    ['force', 'Отдача на ход', NUM],
    ['sig',   'Сигнатура', function (v) { return v; }],
    ['on',    'Наука',     function (v) { return v + ' ОН'; }],
  ];
  var BETTER = { power: 1, capacityPenalty: -1, mass: -1, eff: 1, stab: 1, force: 1, sig: -1, on: -1 };
  var SEGN = 14;
  function capsOf(cfg) {
    var c = R().CARRIERS[cfg.klass] || R().CARRIERS.corvette;
    return { power: Math.round(c.refPower * R().CAP_RATIO), mass: c.massCap, eff: 100, stab: 100,
             force: Math.round(c.refForce * R().CAP_RATIO), sig: 6, on: 60,
             // Полоса меряется грузоподъёмностью класса из KV — сколько шасси вообще несёт.
             capacityPenalty: c.cap || 1,
             // Отметка «заводской уровень» на полосе выработки.
             _refPower: c.refPower, _refForce: c.refForce };
  }
  function buildBars() {
    $r('bottom').innerHTML = BARS.map(function (b) {
      return '<div class="st"><div class="hd"><i>' + b[1] + '</i><div><u id="rf_u_' + b[0] + '"></u><em id="rf_d_' + b[0] + '"></em></div></div>' +
        '<div class="seg" id="rf_s_' + b[0] + '">' + new Array(SEGN + 1).join('<s></s>') + '</div></div>';
    }).join('');
  }
  function fillBars(s, prev) {
    var caps = capsOf(CNR.cfg);
    BARS.forEach(function (b) {
      var k = b[0];
      $r('u_' + k).textContent = b[2](s[k]);
      var n = Math.max(0, Math.min(SEGN, Math.round((s[k] || 0) / (caps[k] || 1) * SEGN)));
      // Где на шкале стоит заводской реактор класса — за этой чертой начинается
      // выигрыш игрока, и он красится другим цветом.
      var refN = k === 'power' ? Math.round(caps._refPower / caps.power * SEGN)
               : k === 'force' ? Math.round(caps._refForce / caps.force * SEGN) : SEGN;
      var segs = $r('s_' + k).children, em = $r('d_' + k);
      var pn = n, cls = '';
      if (prev) {
        pn = Math.max(0, Math.min(SEGN, Math.round((prev[k] || 0) / (caps[k] || 1) * SEGN)));
        var diff = (s[k] || 0) - (prev[k] || 0);
        cls = diff ? (((diff > 0 ? 1 : -1) === BETTER[k]) ? 'up' : 'dn') : '';
        var pct = prev[k] ? Math.round(diff / prev[k] * 100) : 0;
        em.className = diff ? 'show ' + cls : '';
        em.textContent = (diff > 0 ? '+' : '') + pct + '%';
      } else em.className = '';
      var lo = Math.min(n, pn), hi = Math.max(n, pn);
      for (var i = 0; i < SEGN; i++) {
        segs[i].className = i < lo ? (i >= refN ? 'over' : 'f') : (prev && i < hi ? cls : '');
      }
    });
  }
  function preview(candidate) {
    if (!candidate) { fillBars(R().stats(CNR.cfg)); return; }
    fillBars(R().stats(candidate), R().stats(CNR.cfg));
  }

  // ══ ВСПЛЫВАЮЩИЙ ВЫБОР ══════════════════════════════════════
  var DELTA = [['power', 'ВЫРАБ'], ['capacityPenalty', 'ШАССИ'], ['eff', 'КПД'], ['stab', 'УСТ'], ['force', 'ХОД']];

  function optHTML(key) {
    var base = R().stats(CNR.cfg), opts = optionsOf(key), out = '';
    for (var v in opts) {
      var patch = {}; patch[key] = v;
      var cand = R().normalize(Object.assign({}, CNR.cfg, patch)), s = R().stats(cand), d = '';
      DELTA.forEach(function (f) {
        var diff = (s[f[0]] || 0) - (base[f[0]] || 0);
        if (!diff) { d += '<span>' + f[1] + ' —</span>'; return; }
        var good = (diff > 0 ? 1 : -1) === BETTER[f[0]];
        d += '<s class="' + (good ? 'up' : 'dn') + '">' + f[1] + ' ' + (diff > 0 ? '+' : '') +
          (base[f[0]] ? Math.round(diff / base[f[0]] * 100) : 0) + '%</s>';
      });
      // Смена школы/класса может выбить несовместимое топливо или схему —
      // говорим об этом до клика, а не после.
      ['school', 'fuel', 'conv', 'conf', 'cool'].forEach(function (f) {
        if (f !== key && cand[f] !== CNR.cfg[f]) {
          var ru = f === 'school' ? R().SCHOOLS[cand[f]].ab : f === 'fuel' ? R().FUELS[cand[f]].ru
                 : f === 'conv' ? R().CONV[cand[f]].ru : f === 'conf' ? R().CONF[cand[f]].ru : R().COOL[cand[f]].ru;
          d += '<s class="dn">' + PICKS[f] + ' → ' + esc(ru) + '</s>';
        }
      });
      var lore = loreOf(key, v);
      out += '<div class="opt' + (CNR.cfg[key] === v ? ' sel' : '') + '" data-key="' + esc(key) + '" data-v="' + esc(v) + '">' +
        '<div class="nm">' + esc(opts[v]) + '</div>' +
        (lore ? '<div class="lore">' + esc(lore) + '</div>' : '') +
        '<div class="dl">' + d + '</div></div>';
    }
    return out;
  }
  // Ползунок ограничен ЖИВЫМ пределом приёмки (RG.sliderRange), а не абсолютной
  // шкалой: за край допустимого его физически не увести. Полный ход схемы
  // подписываем рядом — чтобы было видно, что упор поставил носитель, а не верстак.
  function sliderHTML(key) {
    var lim = R().LIMITS[key], st = lim[2], meta = SLIDERS[key] || [key, ''];
    var rng = R().sliderRange(CNR.cfg, key);
    var lo = rng[0], hi = rng[1];
    var val = Math.max(lo, Math.min(hi, CNR.cfg[key]));
    var capped = (lo > lim[0] + 1e-9 || hi < lim[1] - 1e-9);
    var hint = meta[1] || '';
    if (capped) hint += (hint ? '<br>' : '') + '<span style="color:#b9a06a">Предел носителя: ' +
      lo + '…' + hi + ' (схема тянет ' + lim[0] + '…' + lim[1] + ')</span>';
    return '<div class="sl"><div class="h"><i>' + meta[0] + '</i><b id="rf_v_' + key + '">' + val + '</b></div>' +
      '<input type="range" data-k="' + key + '" min="' + lo + '" max="' + hi + '" step="' + st + '" value="' + val + '">' +
      (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }
  // Ползунки связаны через приёмку: подняли температуру — просел допустимый
  // габарит. Поэтому после каждого движения переставляем упоры у ОСТАЛЬНЫХ
  // ползунков открытой всплывашки (у самого ведущего — не трогаем, иначе
  // ручка прыгает под пальцем).
  function syncRanges(skip) {
    var box = $r('popB'); if (!box) return;
    box.querySelectorAll('input[type=range]').forEach(function (inp) {
      var k = inp.dataset.k;
      if (!k || k === skip || !R().LIMITS[k]) return;
      var rng = R().sliderRange(CNR.cfg, k);
      inp.min = rng[0]; inp.max = rng[1];
      var v = Math.max(rng[0], Math.min(rng[1], parseFloat(inp.value)));
      if (v !== parseFloat(inp.value)) {
        inp.value = v; CNR.cfg[k] = v;
        var b = $r('v_' + k); if (b) b.textContent = v;
      }
    });
  }

  function openNodePop(node, el) {
    if (CNR.openNode === node.id) { closePop(); return; }
    CNR.openNode = node.id;
    $r('popT').textContent = node.ru;
    $r('popB').innerHTML = node.fields.map(function (f) {
      return PICKS[f] ? '<div class="sec">' + PICKS[f] + '</div>' + optHTML(f) : sliderHTML(f);
    }).join('');
    showPop(el);
  }
  function showPop(el) {
    var p = $r('pop'), s = $r('stage').getBoundingClientRect();
    p.classList.add('on');
    p.style.maxHeight = Math.max(160, s.height - 16) + 'px';
    if (el) {
      var r = el.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
      var x = r.right - s.left + 14, y = r.top - s.top - h / 2 + r.height / 2;
      if (x + w > s.width - 8) x = r.left - s.left - w - 14;
      p.style.left = Math.max(8, Math.min(s.width - w - 8, x)) + 'px';
      p.style.top = Math.max(8, Math.min(s.height - h - 8, y)) + 'px';
    }
    document.querySelectorAll('.rf-app .node').forEach(function (n) { n.classList.toggle('on', n.dataset.id === CNR.openNode); });
  }
  function closePop() {
    CNR.openNode = null;
    var p = $r('pop'); if (p) p.classList.remove('on');
    preview(null);
    document.querySelectorAll('.rf-app .node').forEach(function (n) { n.classList.remove('on'); });
  }

  // ══ РАЗМЕЩЕНИЕ УЗЛОВ ═══════════════════════════════════════
  function anchorPoint(a) {
    var svg = document.querySelector('.rf-app #rf_svgbox svg'); if (!svg) return null;
    var els = svg.querySelectorAll('[data-slot="' + a[0] + '"]');
    if (!els.length) return null;
    var el = a[1] === 'last' ? els[els.length - 1] : els[0];
    var r = el.getBoundingClientRect(), s = $r('stage').getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left - s.left + r.width * a[2], y: r.top - s.top + r.height / 2 };
  }
  function placeNodes() {
    if (!$r('stage')) return;
    var s = $r('stage').getBoundingClientRect(), leads = $r('leads');
    leads.setAttribute('viewBox', '0 0 ' + s.width + ' ' + s.height);
    leads.setAttribute('width', s.width); leads.setAttribute('height', s.height);
    var svg = document.querySelector('.rf-app #rf_svgbox svg');
    var b = svg ? svg.getBoundingClientRect() : null;
    // Узлы одной стороны раскладываем столбиком, чтобы подписи не наезжали.
    var side = { l: 0, r: 0 };
    var lines = '';
    NODES.forEach(function (nd) {
      var el = document.querySelector('.rf-app .node[data-id="' + nd.id + '"]'); if (!el) return;
      var p = anchorPoint(nd.anchor) || { x: s.width / 2, y: s.height / 2 };
      var edge = b ? (nd.side === 'l' ? b.left - s.left - 26 : b.right - s.left + 26) : p.x;
      var nx = Math.max(30, Math.min(s.width - 30, edge));
      var idx = side[nd.side]++;
      var total = NODES.filter(function (x) { return x.side === nd.side; }).length;
      var ny = 44 + (s.height - 88) * (total > 1 ? idx / (total - 1) : 0.5);
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
        '<div class="lb"><i>' + n.ru + '</i><b id="rf_nb_' + n.id + '"></b></div></div>';
    }).join('');
    $r('stage').insertAdjacentHTML('beforeend', html);
    document.querySelectorAll('.rf-app .node').forEach(function (el) {
      var nd = NODES.find(function (n) { return n.id === el.dataset.id; });
      el.onclick = function (ev) { ev.stopPropagation(); openNodePop(nd, el); };
      el.onmouseenter = function () { hilite(nd.anchor[0], true); };
      el.onmouseleave = function () { hilite(nd.anchor[0], false); };
    });
  }
  function hilite(slot, on) {
    var svg = document.querySelector('.rf-app #rf_svgbox svg'); if (!svg) return;
    svg.querySelectorAll('[data-slot="' + slot + '"]').forEach(function (e) {
      e.style.filter = on ? 'brightness(1.55) saturate(1.2)' : '';
    });
  }
  function nodeLabels() {
    var c = CNR.cfg;
    $r('nb_fuel').textContent   = R().FUELS[c.fuel].ru + ' · ×' + (+c.enrich).toFixed(1);
    $r('nb_core').textContent   = R().SCHOOLS[c.school].ab + ' · ' + c.cores + ' контур(а) · T ' + (+c.temp).toFixed(2);
    $r('nb_conf').textContent   = R().CONF[c.conf].ru;
    $r('nb_cool').textContent   = R().COOL[c.cool].ru;
    $r('nb_conv').textContent   = R().CONV[c.conv].ru;
    $r('nb_rad').textContent    = 'площадь ' + (+c.rad).toFixed(1);
    $r('nb_shield').textContent = 'слоёв ' + (+c.shield).toFixed(2);
    $r('nb_klass').textContent  = R().CARRIERS[c.klass].ru;
  }

  // ══ ДОСЬЕ ══════════════════════════════════════════════════
  var RES = { blackmetall: 'Чёрный металл', coloredmetall: 'Цветной металл',
              rudametall: 'Рудный металл', kristall: 'Кристаллы', staarvis: 'Ставрис' };
  function drawDossier(s) {
    var cfg = CNR.cfg, f = R().fit(cfg), c = R().CARRIERS[cfg.klass];
    var h = '<div class="sec">Против заводского</div><table>' +
      '<tr><td>Заводской максимум класса</td><td>' + NUM(c.refPower) + ' ⚡</td></tr>' +
      '<tr class="' + (f.gain >= 0 ? 'ok' : 'no') + '"><td>Эта установка</td><td>' + NUM(s.power) +
        ' ⚡ (' + (f.gain > 0 ? '+' : '') + f.gain + '%)</td></tr>' +
      '<tr><td>Потолок схемы ' + esc(s.schoolAb) + '</td><td>' + NUM(f.pCap) + ' ⚡</td></tr>' +
      '<tr><td>Масса установки</td><td>' + NUM(s.mass) + ' кг</td></tr>' +
      '<tr><td>Массовый лимит класса</td><td>' + NUM(f.mCap) + ' кг</td></tr>' +
      '<tr><td>Нагрузка на шасси</td><td>' + NUM(s.capacityPenalty) + ' из ' + NUM(s.capCls) +
        ' грузоподъёмности класса</td></tr></table>';

    h += '<div class="sec">Режим работы</div><table>' +
      '<tr><td>Тепловая мощность (индекс)</td><td>' + s.heat + '</td></tr>' +
      '<tr><td>КПД преобразования</td><td>' + s.eff + '%</td></tr>' +
      '<tr><td>Теплонапряжённость</td><td>×' + s.dens + ' к эталону</td></tr>' +
      '<tr><td>Запас устойчивости</td><td>' + s.stab + '% (минимум ' + R().STAB_MIN + ')</td></tr>' +
      '<tr class="' + (s.tpk >= 1 ? 'ok' : 'no') + '"><td>— секунд в ходу боя</td><td>×' + s.tpk +
        ' (' + (Math.round(6 * s.tpk * 100) / 100) + ' с из 6)</td></tr>' +
      '<tr><td>Тепловая сигнатура</td><td>' + s.sig + '</td></tr>' +
      '<tr class="' + (s.stealthCut ? 'no' : 'ok') + '"><td>— скрытность борта</td><td>' +
        (s.stealthCut ? '−' + s.stealthCut : 'не страдает') + '</td></tr></table>';

    h += '<div class="sec">Что даёт борту</div><table>' +
      '<tr><td>Энергосеть</td><td>' + NUM(s.power) + ' ⚡</td></tr>' +
      '<tr><td>Сила реактора (ход)</td><td>' + s.force + '</td></tr>' +
      '<tr><td>Модульных отсеков</td><td>до ' + s.modul + '</td></tr>' +
      '<tr><td>Двигателей / радаров</td><td>' + s.dviglo + ' / ' + s.radar + '</td></tr>' +
      '<tr><td>Связь</td><td>' + s.svaz + '</td></tr>' +
      '<tr><td>Полезный объём</td><td>' + (s.capacityBoost > 0 ? '+' : '') + s.capacityBoost + '</td></tr>' +
      '<tr><td>Разработка (разово)</td><td>' + s.on + ' ОН</td></tr>' +
      '<tr><td>KV-прайс (не тратится)</td><td>' + NUM(s.price) + '</td></tr></table>';

    // Именно это списывается со склада державы при постройке борта.
    h += '<div class="sec">Закладка при постройке</div><table>';
    for (var k in s.bill) h += '<tr><td>' + esc(k) + '</td><td>' + NUM(s.bill[k]) + '</td></tr>';
    h += '</table>';

    // Куда ещё имеет смысл переложить эту же схему, сменив класс.
    h += '<div class="sec">Та же схема на других классах</div><table>';
    R().carriers(cfg).forEach(function (x) {
      h += '<tr class="' + (x.ok ? 'ok' : 'no') + '"><td>' + (x.ok ? '✔' : '✕') + ' ' + esc(x.ru) +
        '</td><td>' + (x.ok ? (x.gain > 0 ? '+' : '') + x.gain + '%' : 'не проходит') + '</td></tr>';
    });
    h += '</table><div class="sec">Конструкц. сырьё (KV, справочно)</div><table>';
    for (var r2 in s.resurs) if (s.resurs[r2] > 0) h += '<tr><td>' + RES[r2] + '</td><td>' + s.resurs[r2] + '</td></tr>';
    $r('dos').innerHTML = h + '</table>';
  }

  // ══ ОТРИСОВКА ══════════════════════════════════════════════
  function tipHTML(cfg, s) {
    return '<em>' + esc(R().SCHOOLS[cfg.school].ab) + ' · ' + esc(R().FUELS[cfg.fuel].ru) + ' · КПД ' +
      s.eff + '% · ' + esc(R().CARRIERS[cfg.klass].ru) + '</em><br>' +
      'ЛКМ по узлу — правка · тяни фон — поворот · колесо — габарит<br>' +
      'сид <b>' + cfg.seed + '</b> · поворот <b>' + Math.round(cfg.yaw) + '°</b> · габарит <b>' + (+cfg.size).toFixed(2) + '</b>';
  }
  function draw() {
    var cfg = CNR.cfg;
    $r('svgbox').innerHTML = R().render(cfg);
    var s = R().stats(cfg);
    fillBars(s); drawDossier(s); nodeLabels();
    $r('tip').innerHTML = tipHTML(cfg, s);
    var f = R().fit(cfg);
    var save = $r('bSave');
    if (save) {
      save.disabled = !f.ok;
      save.textContent = CNR.editId ? '💾 Сохранить' : '✓ Зарегистрировать';
      save.title = f.ok ? '' : f.why;
    }
    var warn = $r('warn');
    if (warn) {
      warn.className = f.ok ? '' : 'on';
      if (!f.ok) {
        warn.innerHTML = '<b>' + esc(R().CARRIERS[cfg.klass].ru) + ' такую установку не примет.</b> ' +
          esc(f.why) + '. Убавьте габарит, температуру или обогащение — либо возьмите класс покрупнее.';
      }
    }
    requestAnimationFrame(placeNodes);
  }
  // Поворот не трогает ни геометрию, ни ТТХ — это rotate() на группе.
  var pending = false;
  function spin(deg) {
    var g = document.querySelector('.rf-app #rf_svgbox svg [data-yaw]');
    if (g) g.setAttribute('transform', 'rotate(' + (Math.round(deg * 100) / 100) + ')');
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false; placeNodes();
      $r('tip').innerHTML = tipHTML(CNR.cfg, R().stats(CNR.cfg));
    });
  }

  // ══ ВХОД ═══════════════════════════════════════════════════
  window.cnRenderReactorForge = async function () {
    setPg('<div class="sload"><div class="pulse-loader"></div></div>');
    await cnLoadMyFaction();
    if (!cnCanAccess()) { cnGate(); return; }
    if (!R()) { setPg('<div class="sempty">reactor_gen.js не загружен</div>'); return; }
    injectStyle();
    if (!CNR.cfg) CNR.cfg = R().tame(Object.assign({}, R().DEFAULTS));
    await loadMine();

    setPg(
      '<div class="rf-app">' +
        '<div id="rf_top">' +
          '<a class="hbtn" onclick="go(\'constructors\')" style="cursor:pointer">← Назад</a>' +
          '<button class="hbtn" id="rf_bPreset">Пресет</button>' +
          '<button class="hbtn" id="rf_bPaint">Окраска</button>' +
          '<button class="hbtn" id="rf_bMine">Мои реакторы</button>' +
          '<input id="rf_nm" maxlength="48" placeholder="Название установки" value="' + esc(CNR.editName || '') + '">' +
          '<button class="hbtn" id="rf_bDos">Досье</button>' +
          '<button class="hbtn" id="rf_bDl">SVG</button>' +
          '<button class="hbtn acc" id="rf_bSave">✓ Зарегистрировать</button>' +
        '</div>' +
        '<div id="rf_stage">' +
          '<div id="rf_grid"></div>' +
          '<div id="rf_svgbox"></div>' +
          '<svg id="rf_leads"></svg>' +
          '<div id="rf_vig"></div>' +
          '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>' +
          '<div id="rf_tip"></div>' +
          '<div id="rf_pop"><div class="ph"><b id="rf_popT"></b><span id="rf_popX">✕</span></div><div class="pb" id="rf_popB"></div></div>' +
          '<div id="rf_dos"></div>' +
          '<div id="rf_warn"></div>' +
        '</div>' +
        '<div id="rf_bottom"></div>' +
      '</div>'
    );
    buildBars(); buildNodes(); bindStage(); draw();
  };

  async function loadMine() {
    var fac = cnMyFactionMeta();
    try {
      var q = 'select=*&order=updated_at.desc';
      if (fac && fac.faction_id) q = 'faction_id=eq.' + encodeURIComponent(fac.faction_id) + '&' + q;
      CNR.reactors = await dbGet('faction_reactors', q) || [];
    } catch (e) { CNR.reactors = []; }
  }

  // ══ СОБЫТИЯ СЦЕНЫ ══════════════════════════════════════════
  function bindStage() {
    var stage = $r('stage'), popB = $r('popB');

    $r('popX').onclick = closePop;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $r('pop')) closePop(); });

    popB.onclick = function (e) {
      var o = e.target.closest('.opt'); if (!o) return;
      CNR.cfg[o.dataset.key] = o.dataset.v;
      // Смена класса/школы/топлива двигает не значения, а ГРАНИЦЫ: загоняем
      // сборку внутрь допустимого сразу, а не ругаемся на неё потом.
      Object.assign(CNR.cfg, R().tame(CNR.cfg));
      closePop(); draw();
    };
    popB.oninput = function (e) {
      var k = e.target.dataset.k; if (!k) return;
      var v = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
      if (e.target.type === 'range' && R().LIMITS[k]) {
        var rng = R().sliderRange(CNR.cfg, k);
        v = Math.max(rng[0], Math.min(rng[1], v));
        if (v !== parseFloat(e.target.value)) e.target.value = v;
      }
      CNR.cfg[k] = v;
      Object.assign(CNR.cfg, R().normalize(CNR.cfg));
      var b = $r('v_' + k); if (b) b.textContent = CNR.cfg[k];
      if (k === 'yaw') { spin(CNR.cfg.yaw); return; }
      draw();
      syncRanges(k);
    };
    popB.onmouseover = function (e) {
      var o = e.target.closest('.opt'); if (!o) return;
      var patch = {}; patch[o.dataset.key] = o.dataset.v;
      preview(R().normalize(Object.assign({}, CNR.cfg, patch)));
    };
    popB.onmouseout = function (e) { if (e.target.closest('.opt')) preview(null); };

    $r('bPreset').onclick = function (e) {
      CNR.openNode = 'preset';
      $r('popT').textContent = 'Пресет из каталога';
      $r('popB').innerHTML = '<div style="padding:8px 10px"><select class="kv" id="rf_kv"><option value="">— вручную —</option></select></div>' +
        '<div class="sl"><div class="hint">Каталожный реактор разбирается на школу, топливо и габарит — дальше его можно доводить руками.</div></div>';
      showPop(e.target);
      var kv = $r('kv');
      if (window.KV) {
        var lib = R().catalog(KV.engines);
        Object.keys(lib).sort().forEach(function (nm) {
          var op = document.createElement('option'); op.value = nm;
          op.textContent = nm + ' (' + Math.round((+lib[nm].power || 0) * 4) + ' ⚡)';
          kv.appendChild(op);
        });
        kv.onchange = function (ev) {
          if (!ev.target.value) return;
          var got = R().fromKV(ev.target.value, lib[ev.target.value]);
          // Класс — выбор игрока, пресет его не переопределяет.
          got.klass = CNR.cfg.klass;
          Object.assign(CNR.cfg, R().tame(got));
          var nmEl = $r('nm');
          if (nmEl && !nmEl.value.trim()) nmEl.value = ev.target.value.slice(0, 48);
          closePop(); draw();
        };
      }
    };
    $r('bPaint').onclick = function (e) {
      CNR.openNode = 'paint';
      $r('popT').textContent = 'Окраска и вид';
      $r('popB').innerHTML = '<div class="row2">' +
        '<div><i>Основной</i><input type="color" data-k="tint" value="' + CNR.cfg.tint + '"></div>' +
        '<div><i>Акцент</i><input type="color" data-k="accent" value="' + CNR.cfg.accent + '"></div></div>' +
        sliderHTML('detail') + sliderHTML('seed');
      showPop(e.target);
    };
    $r('bMine').onclick = function (e) { openMinePop(e.target); };
    $r('bDos').onclick = function () { $r('dos').classList.toggle('on'); };
    $r('bDl').onclick = function () {
      var b = new Blob([R().render(CNR.cfg)], { type: 'image/svg+xml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = ((($r('nm') || {}).value || 'reactor').trim() || 'reactor') + '.svg';
      a.click();
    };
    $r('bSave').onclick = register;

    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.node, #rf_pop, #rf_dos')) return;
      closePop();
      CNR.drag = { x: e.clientX, yaw: +CNR.cfg.yaw };
      stage.classList.add('drag'); stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!CNR.drag) return;
      var y = CNR.drag.yaw + (e.clientX - CNR.drag.x) * 0.55;
      CNR.cfg.yaw = ((y + 180) % 360 + 360) % 360 - 180;
      spin(CNR.cfg.yaw);
    });
    var stopDrag = function () {
      if (!CNR.drag) return;
      CNR.drag = null; stage.classList.remove('drag');
    };
    stage.addEventListener('pointerup', stopDrag);
    stage.addEventListener('pointercancel', stopDrag);
    // Колесо меняет габарит — это геометрия И ТТХ, поэтому перерисовка, но не чаще кадра.
    var zoomRAF = false;
    stage.addEventListener('wheel', function (e) {
      if (e.target.closest('#rf_pop, #rf_dos')) return;
      e.preventDefault();
      // Тот же упор, что у ползунка: колесом за приёмку тоже не выкрутить.
      var L = R().sliderRange(CNR.cfg, 'size');
      CNR.cfg.size = Math.max(L[0], Math.min(L[1], +(CNR.cfg.size - Math.sign(e.deltaY) * 0.05).toFixed(2)));
      if (zoomRAF) return;
      zoomRAF = true;
      requestAnimationFrame(function () { zoomRAF = false; draw(); });
    }, { passive: false });
    window.addEventListener('resize', placeNodes);
  }

  // ══ МОИ РЕАКТОРЫ ═══════════════════════════════════════════
  function openMinePop(el) {
    CNR.openNode = 'mine';
    $r('popT').textContent = 'Мои реакторы';
    var list = CNR.reactors || [];
    $r('popB').innerHTML = list.length
      ? '<div style="padding:6px 10px"><button class="hbtn" data-new="1" style="width:100%">+ Новая установка</button></div>' +
        list.map(function (t) {
          var st = t.stats || {};
          return '<div class="mine"><div class="mn" data-id="' + t.id + '"><b>⚛ ' + esc(t.name) + '</b>' +
            '<s>' + esc(st.schoolAb || '') + ' · ' + NUM(st.power || 0) + ' ⚡ · КПД ' + (st.eff || 0) + '% · ' +
            NUM(st.mass || 0) + ' кг · уст. ' + (st.stab || 0) + '% · ' +
            ((t.carriers || []).map(function (c) { return (R().CARRIERS[c] || {}).ru || c; }).join(', ') || '—') +
            '</s></div><button class="xb" data-del="' + t.id + '">✕</button></div>';
        }).join('')
      : '<div style="padding:14px 12px;color:#7b7f86;font-size:12px;line-height:1.6">Пока пусто. Соберите установку, дайте ей имя и зарегистрируйте — она появится в слоте реактора того класса, под который спроектирована.</div>';
    showPop(el);
    $r('popB').querySelectorAll('.mn').forEach(function (n) { n.onclick = function () { edit(n.dataset.id); }; });
    $r('popB').querySelectorAll('[data-del]').forEach(function (n) { n.onclick = function () { del(n.dataset.del); }; });
    var nb = $r('popB').querySelector('[data-new]');
    if (nb) nb.onclick = newDraft;
  }

  function newDraft() {
    CNR.editId = null; CNR.editName = '';
    CNR.cfg = R().tame(Object.assign({}, R().DEFAULTS));
    var nm = $r('nm'); if (nm) nm.value = '';
    closePop(); draw();
  }

  function edit(id) {
    var t = (CNR.reactors || []).find(function (x) { return String(x.id) === String(id); });
    if (!t) return;
    CNR.editId = t.id; CNR.editName = t.name || '';
    CNR.cfg = R().normalize(Object.assign({}, R().DEFAULTS, t.cfg || {}));
    var nm = $r('nm'); if (nm) nm.value = CNR.editName;
    closePop(); draw();
  }

  async function register() {
    if (CNR.busy) return;
    var nm = $r('nm'), name = (nm && nm.value || '').trim();
    if (!name) { toast('Дайте установке название', 'err'); if (nm) nm.focus(); return; }
    var f = R().fit(CNR.cfg);
    if (!f.ok) { toast(f.why, 'err'); return; }
    CNR.editName = name;
    var fac = cnMyFactionMeta();
    // Поворот — режим осмотра, а не свойство изделия: в базу не едет.
    var cfg = Object.assign({}, CNR.cfg); delete cfg.yaw;
    CNR.busy = true;
    try {
      var res = await ecRpc('reactor_upsert', {
        p_reactor_id: CNR.editId || null,
        p_name: name,
        p_cfg: cfg,
        p_faction_id: (fac && fac.faction_id) || null,
        p_faction_name: (fac && fac.faction_name) || null,
        p_faction_color: (fac && fac.faction_color) || null,
      });
      var row = (res && res.id) ? res : (Array.isArray(res) ? res[0] : res);
      var wasEdit = !!CNR.editId;
      if (row && row.id) CNR.editId = row.id;
      if (typeof cnInvalidateReactors === 'function') cnInvalidateReactors();
      toast(wasEdit ? 'Установка сохранена ✓' : 'Реактор зарегистрирован ✓', 'ok');
      await loadMine(); draw();
    } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'err'); }
    finally { CNR.busy = false; }
  }

  async function del(id) {
    if (CNR.busy) return;
    if (!confirm('Удалить установку? Она исчезнет из слота реактора (уже построенные корабли не изменятся).')) return;
    CNR.busy = true;
    try {
      await ecRpc('reactor_delete', { p_reactor_id: id });
      if (typeof cnInvalidateReactors === 'function') cnInvalidateReactors();
      if (String(CNR.editId) === String(id)) newDraft();
      toast('Установка удалена', 'ok');
      await loadMine(); closePop(); draw();
    } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'err'); }
    finally { CNR.busy = false; }
  }
})();
