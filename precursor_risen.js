// ════════════════════════════════════════════════════════════
// ДОЗВЁЗДНЫЕ · ВСТАВШИЕ МИРЫ (этап 12, пункты 2 и 3 — клиент)
//
// Сервер (_precursor_risen.sql) держит миры, которые вышли из хроники
// субъектами. Здесь их видно и с ними можно иметь дело: купить ихор,
// закрыть старый счёт, попроситься в уговор, заплатить виру кризису.
//
// Карточка НЕ объясняет игроку модель. Она показывает, что мир делает и
// что он назначил ценой, — как ведомость, а не как справка. Правила живут
// в руководстве и открываются значком «?».
//
// Эмодзи запрещены: значки — контурный SVG на currentColor.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const num = v => Math.round(Number(v) || 0).toLocaleString('ru-RU');
  const n1  = v => (Math.round(Number(v) * 10) / 10).toLocaleString('ru-RU');

  let _worlds = [];

  // Чем этот мир занят — одной строкой и его словами, без разбора причин.
  const ЛИЦО = {
    'побратим':     'Уговор с вами отдельный от общего прейскуранта.',
    'своё_имя':     'Торгует с теми, с кем сговорился.',
    'долгий_счёт':  'Считает по старому счёту прежде нового.',
    'отпущенные':   'Одна цена всем. Союза не будет ни с кем.',
    'возвратный_ход': 'Уводит людей с чужих миров.',
    'ложный_устой': 'Держит слово и сроки.',
    'немой_век':    'Молчит.',
    'смута':        'Ватаги выходят наружу без спроса.',
  };

  async function load() {
    if (typeof ecRpc !== 'function') return [];
    try {
      const r = await ecRpc('pc_risen_list', {});
      _worlds = (r && r.ok && r.worlds) || [];
    } catch (e) { _worlds = []; }
    return _worlds;
  }

  function html() {
    if (!_worlds.length) return '';
    return `<div class="pcs pcs-ris">
      <div class="pcs-hd"><b>Вставшие миры</b><span>${_worlds.length}</span>
        <span class="pcs-hd-sp"></span>
        <button class="pcs-q" type="button" title="Как это работает"
          onclick="event.stopPropagation();gbHelpOpen('pc_risen')">${
            (window.PrecursorDossier && PrecursorDossier.ICO.q) || '?'}</button></div>
      <div class="pcs-ris-list">${_worlds.map(card).join('')}</div>
    </div>`;
  }

  function card(w) {
    const кризис = w.игра === 'кризис';
    const долг = +w.долг || 0;
    const счёт = +w.счёт || 0;
    // Цена названа всегда — и когда торгуют, и когда уводят: это одна и та же
    // вещь, счёт, и мир не делает из неё тайны.
    return `<div class="pcs-ris-row${кризис ? ' hot' : ''}">
      <div class="pcs-ris-top">
        <span class="pcs-ris-nm">${esc(w.name || 'Мир')}${
          w.ваш ? ' <i>ваша хроника</i>' : ''}</span>
        <span class="pcs-ris-fate">${esc(w.имя || '')}</span>
      </div>
      <div class="pcs-ris-lead">${esc(ЛИЦО[w.fate] || '')}${
        кризис && w.уведено ? ` Уведено: ${num(w.уведено)}.` : ''}</div>
      <div class="pcs-ris-bar">
        ${!кризис ? `<span class="pcs-ris-t">Ихор ${n1(w.ихор)} · ${
          num(w.цена)} ГС за единицу</span>` : ''}
        ${долг > 0 ? `<span class="pcs-ris-t hot">По старому счёту: ${n1(долг)} ихора</span>` : ''}
        ${кризис && счёт > 0 ? `<span class="pcs-ris-t hot">Счёт: ${n1(счёт)} ихора</span>` : ''}
        ${w.уговор === 'побратим' ? '<span class="pcs-ris-t ok">Побратимство</span>'
          : w.уговор === 'торг' ? '<span class="pcs-ris-t ok">Уговор о торге</span>' : ''}
      </div>
      <div class="pcs-ris-act">
        ${!кризис && +w.ихор >= 1 ? `<button class="hp-vn-btn" type="button"
          onclick="pcRisenBuy('${esc(w.world)}')">Купить ихор</button>` : ''}
        ${долг > 0 ? `<button class="hp-vn-btn" type="button"
          onclick="pcRisenSettle('${esc(w.world)}',${долг})">Закрыть старый счёт</button>` : ''}
        ${кризис && счёт > 0 && !w.утих ? `<button class="hp-vn-btn" type="button"
          onclick="pcRisenSettle('${esc(w.world)}',${счёт})">Заплатить виру</button>` : ''}
        ${!кризис && w.союз && w.уговор !== 'побратим' ? `<button class="hp-vn-btn" type="button"
          onclick="pcRisenPact('${esc(w.world)}')">Просить уговора</button>` : ''}
      </div>
    </div>`;
  }

  // ── действия ──────────────────────────────────────────────
  const toastOf = (r, ok) => {
    if (typeof toast !== 'function') return;
    if (r && r.ok) toast(ok(r), 'ok'); else toast((r && r.err) || 'не вышло', 'err');
  };
  const refresh = () => {
    if (typeof heroVNTamaRefresh === 'function') heroVNTamaRefresh();
  };

  window.pcRisenBuy = async function (world) {
    const w = _worlds.find(x => x.world === world); if (!w) return;
    const q = prompt(`Сколько ихора взять? У них лежит ${n1(w.ихор)}, `
      + `цена ${num(w.цена)} ГС за единицу.`, '1');
    if (q == null) return;
    const r = await ecRpc('pc_risen_buy', { p_world: world, p_qty: +q || 0 }).catch(e => null);
    toastOf(r, x => `Взято ${n1(x.ихор)} ихора за ${num(x.гс)} ГС`);
    await load(); refresh();
  };

  window.pcRisenSettle = async function (world, need) {
    const q = prompt(`Сколько ихора отдать? Названо: ${n1(need)}.`, String(need));
    if (q == null) return;
    const r = await ecRpc('pc_risen_settle', { p_world: world, p_qty: +q || 0 }).catch(() => null);
    toastOf(r, x => x.утих ? 'Счёт закрыт. Брать больше не будут.'
      : x.закрыт ? 'Старый счёт закрыт.'
      : `Принято. Осталось ${n1(x.долг != null ? x.долг : (x.счёт - x.закрыто))}`);
    await load(); refresh();
  };

  window.pcRisenPact = async function (world) {
    const r = await ecRpc('pc_risen_pact', { p_world: world }).catch(() => null);
    toastOf(r, () => 'Уговор о торге принят');
    await load(); refresh();
  };

  window.PrecursorRisen = { load, html, get worlds() { return _worlds; } };
})();
