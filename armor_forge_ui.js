// © 2025–2026 Setis241. Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// ARMOR FORGE UI — «⚗ Материаловедение» (страница конструкторов)
// ────────────────────────────────────────────────────────────
// Живая мешалка: игрок задаёт рецепт из реальных ресурсов, движок
// armor_alchemy.js (window.ARMOR_ALCHEMY) считает статы/трейты, кнопка
// регистрирует сплав через RPC armor_alloy_upsert (сервер пересчитывает
// авторитетно и хранит в faction_armor_alloys). Готовый сплав уходит в
// слот брони всех KV-конструкторов (см. cnMergeAlloys в constructors.js).
// Зависит от: core.js (setPg/go/esc/toast/dbGet), constructors.js
// (cnLoadMyFaction/cnCanAccess/cnMyFactionMeta/cnGate/cnIsStaff), economy.js (ecRpc).
// ════════════════════════════════════════════════════════════
(function () {
  "use strict";
  var CNA = { mix: {}, alloys: [], busy: false };
  window.CNA = CNA;

  // Порядок редкости для группировки палитры (презентационно)
  var RAR = {
    IRON:'common', SILICATE:'common', ICEWATER:'common', CARBON:'common', METHANE:'common', SULFUR:'common',
    COPPER:'uncommon', TITANIUM:'uncommon', SULFIDES:'uncommon', AMMONIA:'uncommon',
    RAREEARTH:'rare', PLATINUM:'rare', URANIUM:'rare', WATER:'rare', ORGANICS:'rare', DEUTERIUM:'rare', HELIUM3:'rare',
    THERMFUEL:'epic', DIAMONDS:'epic', EXOCRYST:'epic',
    QUANTUMCRYST:'legendary', DEGENERATE:'legendary', NEUTRONMAT:'legendary',
  };
  var RAR_ORDER = ['common','uncommon','rare','epic','legendary'];
  var RAR_LABEL = { common:'Обычные', uncommon:'Редкие', rare:'Ценные', epic:'Эпические', legendary:'Легендарные' };
  var RAR_COLOR = { common:'#8a8a9a', uncommon:'#5fbf6a', rare:'#4e9ed8', epic:'#b06bd8', legendary:'#e0a13a' };

  function A() { return window.ARMOR_ALCHEMY; }
  // Наличие ресурса на складе фракции (по ИМЕНИ), если экономика загружена
  function stockOf(id) {
    var el = A().ELEMENTS[id]; if (!el) return null;
    var res = (window.EC && EC.eco && EC.eco.resources) || null;
    if (!res) return null;
    return +res[el.name] || 0;
  }

  function injectStyle() {
    if (document.getElementById('cna-style')) return;
    var s = document.createElement('style'); s.id = 'cna-style';
    s.textContent = [
      // Киберпанк: срезанные углы БЕЗ border (несовместимы) — слой-подложка
      // ::before рисует «обводку», контент лежит поверх. Один акцент: --cna-acc.
      '.cna-wrap{--cna-acc:#59d6ff;--cna-cut:14px;max-width:1120px;margin:0 auto;padding:18px 16px 60px;position:relative}',
      '.cna-wrap *{box-sizing:border-box}',
      '.cna-wrap h1{font-size:24px;margin:6px 0 4px;letter-spacing:.04em;text-transform:uppercase}',
      '.cna-wrap h1::after{content:"";display:block;width:64px;height:2px;margin-top:6px;background:linear-gradient(90deg,var(--cna-acc),transparent)}',
      '.cna-lead{opacity:.65;font-size:13px;max-width:760px;margin:10px 0 16px;line-height:1.5}',
      '.cna-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:18px;align-items:start}',
      '@media(max-width:860px){.cna-grid{grid-template-columns:1fr}}',
      '.cna-panel{position:relative;padding:17px;min-width:0;isolation:isolate;',
        'clip-path:polygon(var(--cna-cut) 0,100% 0,100% calc(100% - var(--cna-cut)),calc(100% - var(--cna-cut)) 100%,0 100%,0 var(--cna-cut))}',
      '.cna-panel::before{content:"";position:absolute;inset:0;z-index:-2;background:linear-gradient(155deg,rgba(89,214,255,.45),rgba(89,214,255,.07) 34%,rgba(255,255,255,.05))}',
      '.cna-panel::after{content:"";position:absolute;inset:1px;z-index:-1;background:',
        'repeating-linear-gradient(0deg,rgba(255,255,255,.015) 0 1px,transparent 1px 3px),',
        'linear-gradient(180deg,rgba(16,22,33,.96),rgba(12,17,26,.92));',
        'clip-path:polygon(var(--cna-cut) 0,100% 0,100% calc(100% - var(--cna-cut)),calc(100% - var(--cna-cut)) 100%,0 100%,0 var(--cna-cut))}',
      '.cna-out-col{display:flex;flex-direction:column;gap:16px;position:sticky;top:12px}',
      '@media(max-width:860px){.cna-out-col{position:static}}',
      // бюджет
      '.cna-budget{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:12px}',
      '.cna-budget .cna-bar{flex:1}',
      // палитра
      '.cna-rar-h{font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin:16px 0 8px;font-weight:700}',
      '.cna-rar-h:first-child{margin-top:0}',
      '.cna-els{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:10px}',
      '.cna-el{position:relative;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.035);padding:9px 10px;transition:background .12s,box-shadow .12s;',
        'clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}',
      '.cna-el.on{background:rgba(89,214,255,.09);box-shadow:inset 3px 0 0 var(--acc,#59d6ff)}',
      '.cna-el-ic{width:30px;height:30px;flex:0 0 30px;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1}',
      '.cna-el-ic img{width:30px;height:30px;object-fit:contain;display:block}',
      '.cna-el-b{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}',
      '.cna-el-n{display:block;max-width:100%;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cna-el-t{display:block;max-width:100%;font-size:10.5px;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cna-el-st{opacity:.75}',
      '.cna-el-i{width:50px;flex:0 0 50px;text-align:center;background:rgba(0,0,0,.35);border:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:inherit;padding:6px 4px;font-size:13px;font-variant-numeric:tabular-nums;',
        'clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}',
      '.cna-el-i:focus{outline:none;box-shadow:inset 0 0 0 1px var(--acc,#59d6ff)}',
      // выхлоп
      '.cna-head{display:flex;align-items:center;gap:16px;margin-bottom:14px}',
      '.cna-grade{font-size:40px;font-weight:800;line-height:.9}',
      '.cna-grade-l{font-size:10px;opacity:.5;letter-spacing:.08em;margin-top:2px}',
      '.cna-stat{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px}',
      '.cna-stat:last-child{border-bottom:none}',
      '.cna-stat b{font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.cna-bars{margin:12px 0}',
      '.cna-bars>div{margin:9px 0}',
      '.cna-bar{height:8px;border-radius:5px;background:rgba(255,255,255,.09);overflow:hidden}',
      '.cna-bar>i{display:block;height:100%;border-radius:5px;transition:width .18s}',
      '.cna-tags{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}',
      '.cna-chip{font-size:11px;padding:4px 9px;background:rgba(95,191,106,.16);color:#a9e2b0;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}',
      '.cna-warn{font-size:11px;padding:4px 9px;background:rgba(204,72,72,.18);color:#ff9d9d;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}',
      '.cna-hints{margin-top:12px;font-size:11.5px;opacity:.7;line-height:1.5}',
      '.cna-hints li{margin:2px 0}',
      '.cna-reg{margin-top:16px;border-top:1px solid rgba(255,255,255,.08);padding-top:14px}',
      '.cna-name{width:100%;text-align:left;padding:10px 12px;background:rgba(0,0,0,.3);border:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);color:inherit;font-size:14px;margin-bottom:10px;',
        'clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}',
      '.cna-name:focus{outline:none;box-shadow:inset 0 0 0 1px var(--cna-acc)}',
      '.cna-mine{background:rgba(255,255,255,.03);padding:11px 13px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;',
        'clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}',
      '.cna-empty{opacity:.5;text-align:center;padding:30px 10px}',
    ].join('');
    document.head.appendChild(s);
  }

  window.cnRenderAlloyForge = async function () {
    setPg('<div class="sload"><div class="pulse-loader"></div></div>');
    await cnLoadMyFaction();
    if (!cnCanAccess()) { cnGate(); return; }
    if (!A()) { setPg('<div class="sempty">armor_alchemy.js не загружен</div>'); return; }
    injectStyle();
    await cnaLoadAlloys();
    cnaPaint();
  };

  async function cnaLoadAlloys() {
    var fac = cnMyFactionMeta();
    try {
      var q = 'select=*&order=updated_at.desc';
      if (fac && fac.faction_id) q = 'faction_id=eq.' + encodeURIComponent(fac.faction_id) + '&' + q;
      CNA.alloys = await dbGet('faction_armor_alloys', q) || [];
    } catch (e) { CNA.alloys = []; }
  }

  function cnaPaint() {
    var fac = cnMyFactionMeta();
    var facLine = fac ? 'От имени фракции: <b>' + esc(fac.faction_name || '—') + '</b>'
      : (cnIsStaff() ? 'Режим администрации — сплав будет общедоступным.' : '');
    setPg(
      '<div class="cna-wrap">' +
        '<div class="cn-back"><a onclick="go(\'constructors\')">← к конструкторам</a></div>' +
        '<h1>⚗ Материаловедение</h1>' +
        '<p class="cn-hub-faction">' + facLine + '</p>' +
        '<p class="cna-lead">Пропорции решают. Броня в игре — это <b>прочность корпуса</b> корабля (отдельного HP нет: щит поглощает, корпус ломается). Сплав задаёт эту прочность, <b>стойкости к трём типам оружия</b> — они реально гасят урон в тактическом бою — и вес: тяжёлый сплав режет грузоподъёмность, лёгкий добавляет. Чистый монолит хрупок, волатильные без связки рыхлые.</p>' +
        '<div class="cna-grid">' +
          '<div class="cna-panel" id="cna-pal"></div>' +
          '<div class="cna-out-col">' +
            '<div class="cna-panel" id="cna-out"></div>' +
            '<div class="cna-panel" id="cna-mine"></div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    cnaRenderPalette();
    cnaCalc();
    cnaRenderMine();
  }

  // иконка ресурса: настоящий арт (assets/icons/res/<id>.png) с эмодзи-фолбэком
  function iconHtml(el) {
    if (typeof window.resIconHtml === 'function') return window.resIconHtml(el.name, 'cna-ic-img');
    return '<span>' + el.icon + '</span>';
  }
  function usedUnits() { var t = 0; for (var id in CNA.mix) t += CNA.mix[id] || 0; return t; }

  function cnaRenderBudget() {
    var box = document.getElementById('cna-budget'); if (!box) return;
    var max = A().MAX_UNITS || 100, used = usedUnits(), pct = Math.min(100, Math.round(used / max * 100));
    var col = used > max ? '#cc4848' : used >= max * 0.85 ? '#e0a13a' : '#5fbf6a';
    box.innerHTML = '<span style="opacity:.7">Сырьё в рецепте</span>' +
      '<span class="cna-bar"><i style="width:' + pct + '%;background:' + col + '"></i></span>' +
      '<b style="color:' + col + ';font-variant-numeric:tabular-nums">' + used + ' / ' + max + '</b>';
  }

  function cnaRenderPalette() {
    var els = A().ELEMENTS, html = '<div class="cna-budget" id="cna-budget"></div>';
    RAR_ORDER.forEach(function (rar) {
      var ids = Object.keys(els).filter(function (id) { return RAR[id] === rar; });
      if (!ids.length) return;
      html += '<div class="cna-rar-h" style="color:' + RAR_COLOR[rar] + '">' + RAR_LABEL[rar] + '</div><div class="cna-els">';
      ids.forEach(function (id) {
        var e = els[id], v = +CNA.mix[id] || 0, st = stockOf(id);
        html += '<div class="cna-el' + (v > 0 ? ' on' : '') + '" id="cnael-' + id + '" style="--acc:' + RAR_COLOR[rar] + '">' +
          '<span class="cna-el-ic">' + iconHtml(e) + '</span>' +
          '<span class="cna-el-b"><span class="cna-el-n" title="' + esc(e.name) + '">' + esc(e.name) + '</span>' +
          '<span class="cna-el-t">' + esc(e.tag) + (st != null ? ' · <span class="cna-el-st">' + Math.floor(st) + ' на складе</span>' : '') + '</span></span>' +
          '<input class="cna-el-i" type="number" min="0" step="1" value="' + (v || '') + '" ' +
            'oninput="cnaSet(\'' + id + '\',this.value)" placeholder="0">' +
          '</div>';
      });
      html += '</div>';
    });
    html += '<div style="margin-top:16px"><button class="btn btn-gh btn-sm" onclick="cnaClear()">Очистить рецепт</button></div>';
    var pal = document.getElementById('cna-pal'); if (pal) pal.innerHTML = html;
    cnaRenderBudget();
  }

  window.cnaSet = function (id, val) {
    var max = A().MAX_UNITS || 100;
    var n = Math.max(0, Math.floor(+val || 0));
    if (n > 0) CNA.mix[id] = n; else delete CNA.mix[id];
    // лимит бюджета: не даём суммарно превысить потолок — режем последний ввод
    var over = usedUnits() - max;
    if (over > 0) {
      n = Math.max(0, n - over);
      if (n > 0) CNA.mix[id] = n; else delete CNA.mix[id];
      var inp = document.querySelector('#cnael-' + id + ' input');
      if (inp) inp.value = n || '';
    }
    // точечная подсветка карточки (не перерисовываем палитру — не сбить фокус)
    var card = document.getElementById('cnael-' + id);
    if (card) card.classList.toggle('on', (CNA.mix[id] || 0) > 0);
    cnaRenderBudget();
    cnaCalc();
  };
  window.cnaClear = function () { CNA.mix = {}; cnaRenderPalette(); cnaCalc(); };

  function bar(label, val, color) {
    var pct = Math.round(val * 100);
    return '<div><div class="cna-stat" style="border:none;padding-bottom:2px"><span>' + label + '</span><b>' + pct + '%</b></div>' +
      '<div class="cna-bar"><i style="width:' + Math.min(100, pct) + '%;background:' + color + '"></i></div></div>';
  }

  function cnaCalc() {
    var r = A().calcAlloy(CNA.mix), out = document.getElementById('cna-out');
    if (!out) return;
    // сохранить набранное имя перед перерисовкой блока регистрации
    var nm = document.getElementById('cna-name');
    if (nm) CNA.editName = nm.value;
    if (!r.ok) {
      out.innerHTML = '<div class="cna-empty">Добавьте ресурсы слева, чтобы начать плавку.</div>';
      cnaRenderRegister(false);
      return;
    }
    var gradeColor = r.grade >= 70 ? '#5fbf6a' : r.grade >= 45 ? '#4e9ed8' : r.grade >= 25 ? '#e0a13a' : '#cc4848';
    var catRu = { heavyMetal:'Тяжёлый металл', lightMetal:'Лёгкий металл', ceramic:'Керамика', composite:'Композит' }[r.category] || r.category;
    var tags = r.traits.map(function (t) { return '<span class="cna-chip">✦ ' + esc(t) + '</span>'; })
      .concat(r.warnings.map(function (w) { return '<span class="cna-warn">⚠ ' + esc(w) + '</span>'; })).join('');
    var html =
      '<div class="cna-head">' +
        '<div style="text-align:center"><div class="cna-grade" style="color:' + gradeColor + '">' + r.grade + '</div><div class="cna-grade-l">ОЦЕНКА</div></div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="cna-stat"><span>Прочность корпуса</span><b>' + r.hpBoost + '</b></div>' +
          '<div class="cna-stat"><span>Усиление корпуса</span><b>' + (r.hpPercentBoost > 0 ? '+' + Math.round(r.hpPercentBoost * 100) + '%' : '—') + '</b></div>' +
          '<div class="cna-stat"><span>Вес → грузоподъёмность</span><b>' + (r.capacityBoost >= 0 ? '+' : '') + r.capacityBoost + '</b></div>' +
          '<div class="cna-stat"><span>Тип брони</span><b>' + catRu + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="cna-bars">' +
        bar('Кинетическая (пули/снаряды)', r.resist.kinetic, '#d8a24e') +
        bar('Энергетическая (лазер)', r.resist.energy, '#59d6ff') +
        bar('Против ракет / взрыва', r.resist.missile, '#b06bd8') +
      '</div>' +
      '<div style="font-size:11px;opacity:.5;margin:-4px 0 8px">Стойкости работают в тактическом бою: урон орудия гасится на процент стойкости к его типу.</div>' +
      '<div style="font-size:11px;opacity:.5">Плотность ' + r.blend.density + ' · Прочность ' + r.blend.tensile + ' МПа · Теплостойк. ' + r.blend.heat + '</div>' +
      (tags ? '<div class="cna-tags">' + tags + '</div>' : '');
    out.innerHTML = html;
    cnaRenderRegister(true);
  }

  function cnaRenderRegister(enabled) {
    var out = document.getElementById('cna-out'); if (!out) return;
    var block = document.createElement('div');
    block.className = 'cna-reg';
    block.innerHTML =
      '<input id="cna-name" class="cna-name" placeholder="Название сплава" maxlength="48" value="' + esc((CNA.editName || '')) + '">' +
      '<button class="btn btn-gd btn-fw"' + (enabled ? '' : ' disabled style="opacity:.4"') + ' onclick="cnaRegister()">' +
        (CNA.editId ? '💾 Сохранить сплав' : '✓ Зарегистрировать сплав') + '</button>' +
      (CNA.editId ? '<button class="btn btn-gh btn-fw" style="margin-top:6px" onclick="cnaNewDraft()">+ Новый сплав</button>' : '');
    out.appendChild(block);
  }

  window.cnaNewDraft = function () { CNA.editId = null; CNA.editName = ''; CNA.mix = {}; cnaRenderPalette(); cnaCalc(); };

  window.cnaRegister = async function () {
    if (CNA.busy) return;
    var nameEl = document.getElementById('cna-name');
    var name = (nameEl && nameEl.value || '').trim();
    if (!name) { toast('Укажите название сплава', 'err'); return; }
    if (!A().calcAlloy(CNA.mix).ok) { toast('Добавьте ресурсы', 'err'); return; }
    var fac = cnMyFactionMeta();
    CNA.busy = true;
    try {
      var res = await ecRpc('armor_alloy_upsert', {
        p_alloy_id: CNA.editId || null,
        p_name: name,
        p_recipe: CNA.mix,
        p_faction_id: (fac && fac.faction_id) || null,
        p_faction_name: (fac && fac.faction_name) || null,
        p_faction_color: (fac && fac.faction_color) || null,
      });
      var row = (res && res.id) ? res : (Array.isArray(res) ? res[0] : res);
      if (row && row.id) CNA.editId = row.id;
      // сбросим кэш каталогов конструктора, чтобы сплав появился в слоте брони
      if (typeof cnInvalidateAlloys === 'function') cnInvalidateAlloys();
      toast(CNA.editId ? 'Сплав сохранён ✓' : 'Сплав зарегистрирован ✓', 'ok');
      await cnaLoadAlloys();
      cnaRenderMine();
    } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'err'); }
    finally { CNA.busy = false; }
  };

  function cnaRenderMine() {
    var box = document.getElementById('cna-mine'); if (!box) return;
    var list = CNA.alloys || [];
    if (!list.length) { box.innerHTML = '<div class="cna-rar-h">Мои сплавы</div><div class="cna-empty" style="padding:14px 10px">Пока пусто. Собери рецепт и зарегистрируй сплав.</div>'; return; }
    box.innerHTML = '<div class="cna-rar-h">Мои сплавы</div>' + list.map(function (a) {
      var st = a.stats || {};
      return '<div class="cna-mine">' +
        '<div><b>' + esc(a.name) + '</b>' +
          '<div style="font-size:11px;opacity:.6">Корпус ' + (st.hpBoost || 0) +
            ' · к' + Math.round((st.resist && st.resist.kinetic || 0) * 100) +
            '/э' + Math.round((st.resist && st.resist.energy || 0) * 100) +
            '/р' + Math.round((st.resist && st.resist.missile || 0) * 100) + '%' +
            ' · оценка ' + (st.grade || 0) + '</div></div>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="btn btn-gh btn-sm" onclick="cnaEdit(\'' + a.id + '\')">Правка</button>' +
          '<button class="btn btn-gh btn-sm" onclick="cnaDelete(\'' + a.id + '\')">✕</button>' +
        '</div></div>';
    }).join('');
  }

  window.cnaEdit = function (id) {
    var a = (CNA.alloys || []).find(function (x) { return String(x.id) === String(id); });
    if (!a) return;
    CNA.editId = a.id; CNA.editName = a.name || '';
    CNA.mix = Object.assign({}, a.recipe || {});
    cnaRenderPalette(); cnaCalc();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.cnaDelete = async function (id) {
    if (CNA.busy) return;
    if (!confirm('Удалить сплав? Он исчезнет из слота брони (уже построенные юниты не изменятся).')) return;
    CNA.busy = true;
    try {
      await ecRpc('armor_alloy_delete', { p_alloy_id: id });
      if (typeof cnInvalidateAlloys === 'function') cnInvalidateAlloys();
      if (String(CNA.editId) === String(id)) cnaNewDraft();
      toast('Сплав удалён', 'ok');
      await cnaLoadAlloys(); cnaRenderMine();
    } catch (e) { toast('Ошибка: ' + (e && e.message ? e.message : e), 'err'); }
    finally { CNA.busy = false; }
  };
})();
