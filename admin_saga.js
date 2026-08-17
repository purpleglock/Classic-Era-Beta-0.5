// ════════════════════════════════════════════════════════════
// ХРОНИКА · ВЕРСТАК  (вкладка «📜 Хроника» в консоли управления)
//
// Хронику писали вслепую. Полки лежат в saga_kit.js, стан в saga_weave.js,
// пласты в saga_layers*.js — и чтобы увидеть, ЧТО из этого соберётся живому
// игроку, надо было завести державу, найти дозвёздных и пройти хронику до
// нужной главы. Оттого текст дважды писался и дважды браковался: правку
// нельзя было прочитать глазами раньше, чем она уедет в игру.
//
// Здесь мир собирается на месте. Выбрал расу, среду, век и состояние надлома
// — получил ВЕСЬ граф: наряд с полок, главы, кадры, развилки с флагами,
// весом и ценником, и замер по порогам конструктора (lore/saga_constructor.md
// §5) прямо под текстом.
//
// Ничего не пишет в базу и никуда не ходит: сборка целиком клиентская, та же
// самая, что у игрока (SagaWeave.world → SagaLayers.build). Оттого верстак и
// показывает правду, а не свою отдельную версию правды.
//
// ⚠ Порядок скриптов в index.html: этот файл ПОСЛЕ saga_*.js и admin.js.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Что можно выбрать ────────────────────────────────────────
  // Расы и доктрины берём из стана, а не переписываем: разойдётся список —
  // разойдётся и мир, который верстак показывает, с миром в игре.
  const RACES = () => Object.keys((window.SagaWeave && SagaWeave.RACE) || {});
  const DOCS  = () => Object.keys((window.SagaWeave && SagaWeave.DOCTRINE) || {});
  // Среда задаётся СЛОВОМ: стан ловит её теми же регулярками, что и строку
  // `primitive_civs.env` из базы. Слово тут — образец такой строки.
  const ENVS = [
    ['океанический', 'вода · пристань'],
    ['пустыня',      'сушь · колодец'],
    ['джунгли',      'лес · вырубка'],
    ['горный хребет','горы · забой'],
    ['тундра',       'лёд · зимовье'],
    ['вулканический','пепел · тёплый ключ'],
    ['болота',       'топь · гать'],
    ['степь',        'степь · стойбище'],
    ['равнина',      'земля · поселение (запасная)'],
  ];
  const СОСТ = [
    ['',              'не известно (тема по жребию)'],
    ['затянувшийся',  'затянувшийся'],
    ['переписанный',  'переписанный'],
    ['изжитый',       'изжитый'],
    ['вскрытый',      'вскрытый'],
  ];

  // Состояние верстака переживает перерисовку консоли.
  const S = window.ADSAGA = window.ADSAGA || {
    race: 'Гуманоиды', env: 'океанический', phase: 8, state: 'затянувшийся',
    myRace: 'Синтетики / Киборги', myDoc: 'Технократия (Культ науки)',
    name: 'Долгая Вода', sys: 11, pid: 3, envoy: 'Кевен-посланник',
    view: 'граф',            // граф | наряд | замер
    open: {},                // какие узлы развёрнуты
    // На телефоне верстак открывается ТЕКСТОМ, а не десятью селектами:
    // параметры мира трогают раз в заход, читают — постоянно.
    свёрнута: typeof window !== 'undefined' && window.innerWidth <= 720,
  };

  // ══════════════════════════════════════════════════════════
  // СБОРКА
  //
  // Один в один то, что делает saga_worlds.bind для найденного мира, только
  // строка `primitive_civs` не читается из базы, а набирается руками.
  // `живое` — заглушка: посланник и память державы в верстаке пустые, и узлы,
  // которые их читают, обязаны это пережить, не свалившись.
  // ══════════════════════════════════════════════════════════
  function собрать() {
    if (!window.SagaWeave || !window.SagaLayers) {
      return { err: 'Не загружены saga_weave.js / saga_layers.js' };
    }
    const civ = {
      system_id: S.sys, pid: S.pid, races: [S.race], env: S.env,
      phase: S.phase, state: S.state, self_name: S.name,
    };
    const fac = { race: S.myRace, ideology: S.myDoc, envoy: S.envoy };
    try {
      const W = SagaWeave.world(civ, fac);
      W.живое = () => ({ память: [], посланник: {} });
      W.fateList = SagaWeave.FATES;
      const B = SagaLayers.build(W);
      return { W, B };
    } catch (e) {
      return { err: (e && e.message) || String(e), stack: e && e.stack };
    }
  }

  // Кадр бывает строкой, бывает функцией от флагов. Функцию зовём с пустыми
  // флагами — так её увидит игрок, ничего ещё не выбравший. Упала — показываем
  // это прямо в кадре: молча съеденная ошибка и есть та причина, по которой
  // в двух кадрах жило `undefined` вместо беды.
  function кадр(x, flags) {
    if (typeof x === 'string') return { s: x };
    if (typeof x !== 'function') return { s: '' };
    try {
      const r = x(flags || {});
      return { s: String(r == null ? '' : r), fn: true };
    } catch (e) {
      return { s: '⚠ ' + ((e && e.message) || String(e)), fn: true, err: true };
    }
  }

  // ══════════════════════════════════════════════════════════
  // ЗАМЕР  (пороги — tools/saga_lint.js, конструктор §5)
  //
  // Те же числа, что в скрипте. Разойдутся — верстак начнёт хвалить текст,
  // который скрипт бракует, и правку придётся делать дважды.
  // ══════════════════════════════════════════════════════════
  const LIM = { neg: 0.25, sentMax: 4, sentChars: 140, commas: 2 };
  const NEG = /(^|[^а-яё])(не|ни|нет|нечем|некому|нечего|никто|никогда|ничего|никакой|без)([^а-яё]|$)/i;

  function мерить(s) {
    const пр = String(s).replace(/([.!?…])\s+/g, '$1\n').split('\n')
      .map(x => x.trim()).filter(Boolean);
    return {
      neg:    NEG.test(s),
      много:  пр.length > LIM.sentMax,
      длинно: пр.some(p => p.length > LIM.sentChars),
      запятых: пр.some(p => (p.match(/,/g) || []).length > LIM.commas),
    };
  }

  function замер(B) {
    const все = [];
    Object.keys(B.NODES).forEach(id => {
      (B.NODES[id].t || []).forEach(x => {
        const k = кадр(x);
        if (k.s) все.push({ id, s: k.s, err: k.err, m: мерить(k.s) });
      });
    });
    const n = все.length || 1;
    return {
      все,
      кадров: все.length,
      neg:    все.filter(f => f.m.neg).length / n,
      много:  все.filter(f => f.m.много).length / n,
      длинно: все.filter(f => f.m.длинно).length / n,
      запятых: все.filter(f => f.m.запятых).length / n,
      ошибок: все.filter(f => f.err).length,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ОБХОД ГРАФА
  //
  // Порядок узлов — от первого по переходам, а не по алфавиту ключей: читать
  // хронику надо в том порядке, в каком её читает игрок. Заодно видно две
  // болезни разом: узел, до которого не дойти (сирота), и переход в узел,
  // которого нет (дыра).
  // ══════════════════════════════════════════════════════════
  function обход(B) {
    const N = B.NODES, порядок = [], виден = new Set(), дыры = [];
    const очередь = [B.first];
    while (очередь.length) {
      const id = очередь.shift();
      if (виден.has(id)) continue;
      виден.add(id);
      const n = N[id];
      if (!n) { дыры.push(id); continue; }
      порядок.push(id);
      const дальше = [];
      if (typeof n.go === 'string') дальше.push(n.go);
      if (typeof n.go === 'function') {
        ['правда', 'полу', 'подлог', 'умолчание'].forEach(л => {
          try { дальше.push(n.go({ летопись: л })); } catch (e) {}
        });
      }
      (n.ask || []).forEach(a => a && a.to && дальше.push(a.to));
      дальше.filter(Boolean).forEach(x => очередь.push(x));
    }
    const сироты = Object.keys(N).filter(id => !виден.has(id));
    return { порядок, сироты, дыры };
  }

  // ══════════════════════════════════════════════════════════
  // ОТРИСОВКА
  // ══════════════════════════════════════════════════════════
  const T3 = 'var(--t3,#8aa0b0)', T1 = 'var(--t1,#e8edf2)', W2 = 'var(--w2,#2a3340)';
  const B2 = 'var(--b2,#141a22)', B3 = 'var(--b3,#0c1322)', GD = 'var(--gdl,#5fb0e6)';

  const заг = t => `<div style="font-family:var(--font-display,sans-serif);font-size:11px;font-weight:700;`
    + `letter-spacing:.12em;text-transform:uppercase;color:${T3};margin:18px 0 8px">${esc(t)}</div>`;

  // Ширины полей и раскладка шапки — в css/41_saga_verstak.css: разложить
  // контейнер по ширине экрана инлайном нельзя, @media в атрибут не пишется.
  function сел(id, label, opts, cur) {
    return `<label class="svk-f">${esc(label)}
      <select onchange="adSagaSet('${id}',this.value)">
        ${opts.map(o => {
          const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
          return `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
        }).join('')}
      </select></label>`;
  }

  function поле(id, label, cur) {
    return `<label class="svk-f">${esc(label)}
      <input value="${esc(cur)}" oninput="adSagaSet('${id}',this.value)"></label>`;
  }

  // Кадр на экране: текст, а под ним пометки замера. Пометка стоит У КАДРА,
  // а не в общей сводке внизу — иначе правишь по числу, не видя строки.
  function кадрHtml(k) {
    if (!k.s) return '';
    const m = мерить(k.s);
    const badges = [];
    if (k.fn)      badges.push(['ветвь', T3]);
    if (m.neg)     badges.push(['отрицание', '#e8b45f']);
    if (m.много)   badges.push(['> 4 предложений', '#ff7a7a']);
    if (m.длинно)  badges.push(['длинное предложение', '#ff7a7a']);
    if (m.запятых) badges.push(['> 2 запятых', '#e8b45f']);
    return `<div style="padding:6px 0;border-bottom:1px dashed ${W2}">
      <div style="font-size:13px;line-height:1.55;color:${k.err ? '#ff7a7a' : T1}">${esc(k.s)}</div>
      ${badges.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${badges.map(
        ([t, c]) => `<span style="font-size:10px;color:${c};border:1px solid ${c};border-radius:4px;padding:0 5px;opacity:.85">${t}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  function узелHtml(id, n, W) {
    const кадры = (n.t || []).map(x => кадрHtml(кадр(x))).join('');
    const кто = n.who ? ((W.WHO[n.who] || {}).name || n.who) : '';
    const ask = (n.ask || []).map(a => {
      const флаги = Object.keys(a.set || {}).map(k => k + '=' + a.set[k]).join(' · ');
      const цена = a.cost ? [
        a.cost.груз ? a.cost.груз.id + ' −' + a.cost.груз.n : '',
        a.cost.срок ? 'слот ' + a.cost.срок + ' х.' : '',
      ].filter(Boolean).join(', ') : '';
      return `<div style="display:flex;gap:8px;align-items:baseline;padding:5px 0;border-top:1px solid ${W2}">
        <span style="color:${GD};font-size:12px">▸</span>
        <div style="flex:1">
          <div style="font-size:12px;color:${T1}">${esc(a.t)}</div>
          ${a.tail ? `<div style="font-size:11px;color:${T3};font-style:italic">${esc(a.tail)}</div>` : ''}
          <div style="font-size:10px;color:${T3};margin-top:2px">
            → <b>${esc(a.to || '—')}</b>
            ${флаги ? ' · ' + esc(флаги) : ''}
            ${a.вес != null ? ` · вес ${a.вес > 0 ? '+' : ''}${a.вес}` : ''}
            ${цена ? ` · <span style="color:#e8b45f">цена: ${esc(цена)}</span>` : ''}
            ${a.if ? ' · <span style="opacity:.7">условный</span>' : ''}
          </div>
        </div></div>`;
    }).join('');
    const переход = typeof n.go === 'string' ? `→ ${esc(n.go)}`
      : typeof n.go === 'function' ? '→ по флагу летописи'
      : n.resolve ? '→ развязка (исход считает стан)'
      : n.end ? `финал: ${esc(n.end)}` : '';
    return `<div class="svk-box">
      <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px">
        <b style="color:${GD};font-size:12px">${esc(id)}</b>
        ${n.ch ? `<span style="font-size:12px;color:${T1}">${esc(n.ch)}</span>` : ''}
        ${кто ? `<span style="font-size:11px;color:${T3}">говорит: ${esc(кто)}</span>` : ''}
        ${n.wait ? `<span style="font-size:10px;color:#e8b45f;border:1px solid #e8b45f;border-radius:4px;padding:0 5px">срок</span>` : ''}
        <span style="font-size:10px;color:${T3};margin-left:auto">${esc(переход)}</span>
      </div>
      ${кадры || `<div style="font-size:12px;color:${T3};font-style:italic">кадров нет</div>`}
      ${ask}
    </div>`;
  }

  function нарядHtml(Н, W) {
    const стр = (k, v) => `<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid ${W2}">
      <span style="flex:0 0 130px;font-size:11px;color:${T3}">${esc(k)}</span>
      <span style="flex:1;font-size:12px;color:${T1}">${v}</span></div>`;
    const люди = ['лет', 'стар', 'смут', 'низ'].map(r => {
      const ч = Н.Л[r]; if (!ч) return '';
      return `<div style="border:1px solid ${W2};border-radius:8px;background:${B2};padding:8px 10px;margin-bottom:8px">
        <div><b style="color:${T1};font-size:13px">${esc(ч.имя)}</b>
          <span style="font-size:11px;color:${T3}"> — ${esc(ч.роль)} (${esc(ч.род)})</span></div>
        ${стр('нужда', esc(ч.нужда))}
        ${стр('помеха', esc(ч.помеха))}
        ${стр('скрывает', esc(ч.скрывает))}
      </div>`;
    }).join('');
    return `${заг('Полка 1 · Тема')}
      ${стр('тема', `<b>${esc(Н.тема.имя)}</b> <span style="color:${T3}">(${esc(Н.тема.сост || 'по жребию')}, ступень ${Н.тема.ступень})</span>`)}
      ${стр('линия', esc(Н.тема.линия))}
      ${стр('хорошо кончается', esc(Н.тема.хорошо))}
      ${заг('Полка 2 · Люди')}${люди}
      ${заг('Полка 3 · Ружья')}
      ${Н.ружья.map((r, i) => стр('ружьё ' + (i + 1),
        `<b>${esc(r.id || '—')}</b> <span style="color:${T3}">среда: ${esc(r.среда)}</span>`
        + (r.сад ? `<br><span style="color:${T3}">сажают: ${esc(String(r.сад(W)))}</span>` : '')
        + (r.ход ? `<br><span style="color:${T3}">ход: ${esc(String(r.ход))}</span>` : '')
        + (r.бой ? `<br><span style="color:${T3}">стреляет: ${esc(String(r.бой(W)))}</span>` : '')
        + (r.замок ? `<br><span style="color:${T3}">открывает: ${esc(String(r.замок))}</span>` : ''))).join('')}
      ${заг('Полка 4 · События')}
      ${['I', 'II', 'III', 'IV'].map(k => стр('глава ' + k,
        `<b>${esc((Н.соб[k] || {}).имя || '—')}</b> <span style="color:${T3}">${esc((Н.соб[k] || {}).id || '')}</span>`)).join('')}
      ${заг('Полка 6 · Цена')}
      ${стр('груз', `<b>${esc(Н.груз.id)}</b> × ${esc(Н.груз.n)}`)}
      ${заг('Мир (стан)')}
      ${стр('зерно', esc(Н.seed))}
      ${стр('врезка', esc(W.lead))}
      ${стр('как видят вас', esc(W.seen))}
      ${стр('место · узел', esc(W.место) + ' · ' + esc(W.узел))}
      ${стр('беда · край', esc(W.беда) + ' · ' + esc(W.край))}`;
  }

  function замерHtml(z) {
    const строка = (l, v, порог) => {
      const плохо = порог != null && v > порог;
      return `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid ${W2}">
        <span style="flex:1;font-size:12px;color:${T3}">${esc(l)}</span>
        <b style="font-size:12px;color:${плохо ? '#ff7a7a' : '#7fd18a'}">${Math.round(v * 100)}%</b>
        ${порог != null ? `<span style="font-size:11px;color:${T3};flex:0 0 70px;text-align:right">порог ${Math.round(порог * 100)}%</span>` : '<span style="flex:0 0 70px"></span>'}
      </div>`;
    };
    const плохие = z.все.filter(f => f.m.много || f.m.длинно || f.err);
    return `${заг('Замер собранного мира')}
      <div style="font-size:12px;color:${T3};margin-bottom:6px">Кадров: <b style="color:${T1}">${z.кадров}</b>${z.ошибок ? ` · <b style="color:#ff7a7a">ошибок сборки: ${z.ошибок}</b>` : ''}</div>
      ${строка('кадр построен на отрицании', z.neg, LIM.neg)}
      ${строка('предложений в кадре больше четырёх', z.много, 0)}
      ${строка('предложение длиннее 140 знаков', z.длинно, 0)}
      ${строка('в предложении больше двух запятых', z.запятых, null)}
      ${плохие.length ? заг('Кадры-нарушители (' + плохие.length + ')') + нарушителиHtml(плохие) : ''}`;
  }
  function нарушителиHtml(плохие) {
    return плохие.map(f => `<div style="border-left:2px solid #ff7a7a;padding:4px 0 4px 10px;margin-bottom:8px">
      <div style="font-size:10px;color:${T3}">${esc(f.id)}</div>
      <div style="font-size:12px;color:${T1};line-height:1.5">${esc(f.s)}</div></div>`).join('');
  }

  // ══════════════════════════════════════════════════════════
  // ПАНЕЛЬ
  // ══════════════════════════════════════════════════════════
  window.adSagaPanel = function () {
    // На узком экране шапка — десять контролов в столбец, то есть пол-экрана
    // до первого кадра. Кнопка её складывает; на мониторе кнопки нет вовсе
    // (css), и шапка стоит развёрнутой независимо от того, что в S.свёрнута.
    const шапка = `<button class="btn btn-gh btn-sm svk-fold" onclick="adSagaSet('свёрнута',${S.свёрнута ? 'false' : 'true'})">
        ${S.свёрнута ? 'Параметры мира ▾' : 'Параметры мира ▴'}</button>
      <div class="svk-head${S.свёрнута ? ' is-fold' : ''}">
      ${сел('race', 'раса мира', RACES(), S.race)}
      ${сел('env', 'среда', ENVS, S.env)}
      ${сел('phase', 'век', Array.from({ length: 12 }, (_, i) => [i, 'E' + i]), S.phase)}
      ${сел('state', 'состояние надлома', СОСТ, S.state)}
      ${поле('name', 'имя мира', S.name)}
      ${сел('myRace', 'ваша раса', RACES(), S.myRace)}
      ${сел('myDoc', 'ваша доктрина', DOCS(), S.myDoc)}
      ${поле('envoy', 'посланник', S.envoy)}
      ${поле('sys', 'система', S.sys)}
      ${поле('pid', 'pid', S.pid)}
    </div>`;

    const r = собрать();
    if (r.err) {
      return шапка + `<div style="margin-top:14px;color:#ff7a7a;border:1px solid #ff7a7a;border-radius:8px;padding:12px">
        <b>Мир не собрался:</b> ${esc(r.err)}
        ${r.stack ? `<pre style="font-size:11px;white-space:pre-wrap;opacity:.7;margin-top:8px">${esc(r.stack)}</pre>` : ''}</div>`;
    }
    const { W, B } = r;
    const o = обход(B);
    const z = замер(B);

    const правок = Object.keys(D.text).length + Object.keys(D.terms).length;
    const виды = [['граф', 'Хроника целиком'], ['наряд', 'Что достали с полок'],
                  ['замер', 'Замер текста'], ['полки', 'Правка текста'], ['термины', 'Термины']];
    const вкладки = `<div class="svk-tabs svk-views">
      ${виды.map(([id, l]) => `<button class="btn ${S.view === id ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="adSagaSet('view','${id}')">${l}</button>`).join('')}
      <span class="svk-count">
        узлов: <b style="color:${T1}">${o.порядок.length}</b>
        ${o.сироты.length ? ` · <b style="color:#e8b45f">сирот: ${o.сироты.length}</b>` : ''}
        ${o.дыры.length ? ` · <b style="color:#ff7a7a">дыр: ${o.дыры.length}</b>` : ''}
      </span></div>
      <div class="svk-bar">
        <button class="btn btn-gh btn-sm" onclick="adSagaВыгрузитьТекст()">⤓ выгрузить saga_text.js</button>
        <button class="btn btn-gh btn-sm" onclick="adSagaВыгрузитьТермины()">⤓ выгрузить saga_terms.js</button>
        ${правок ? `<button class="btn btn-gh btn-sm" onclick="adSagaСброс()" style="color:#ff7a7a;border-color:#ff7a7a">✕ снять правки</button>` : ''}
        <span style="font-size:11px;color:${правок ? '#e8b45f' : T3}">
          ${правок ? `правок в черновике: <b>${правок}</b> — они живут в браузере, пока не выгружены файлом` : 'правок нет'}</span>
      </div>`;

    let тело;
    if (S.view === 'наряд') тело = нарядHtml(B.наряд, W);
    else if (S.view === 'полки') тело = полкиHtml();
    else if (S.view === 'термины') тело = терминыHtml();
    else if (S.view === 'замер') тело = замерHtml(z);
    else {
      const беда = (o.дыры.length || o.сироты.length)
        ? `<div style="border:1px solid #e8b45f;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#e8b45f">
            ${o.дыры.length ? `Переход в несуществующий узел: ${o.дыры.map(esc).join(', ')}.<br>` : ''}
            ${o.сироты.length ? `До этих узлов не дойти: ${o.сироты.map(esc).join(', ')}.` : ''}</div>`
        : '';
      тело = беда + o.порядок.map(id => узелHtml(id, B.NODES[id], W)).join('');
    }
    return шапка + вкладки + `<div style="margin-top:10px">${тело}</div>`;
  };

  // ══════════════════════════════════════════════════════════
  // ПРАВКА
  //
  // Текст полок лежит в saga_text.js данными, термины — словарями стана.
  // И то и другое правится тут же, в поле, и тут же видно в собранном мире:
  // полки читают значения гетерами и функциями, а не копией при загрузке.
  //
  // Черновик держится в браузере (localStorage). Хранилище правок решено
  // ВЫГРУЗКОЙ ФАЙЛА, а не таблицей в базе: правку текста коммитят, как код,
  // и она проходит те же замеры. Кнопка отдаёт готовый файл на замену.
  // ══════════════════════════════════════════════════════════
  const КЛЮЧ = 'saga_draft_v1';
  const D = S.правки = S.правки || { text: {}, terms: {} };

  function сохранить() {
    try { localStorage.setItem(КЛЮЧ, JSON.stringify(D)); } catch (e) {}
  }

  // Дойти до предпоследнего звена пути и вернуть [объект, поле].
  function поПути(корень, путь) {
    const ч = путь.split('.');
    let o = корень;
    for (let i = 0; i < ч.length - 1 && o != null; i++) o = o[ч[i]];
    return [o, ч[ч.length - 1]];
  }

  function правитьТекст(путь, знач) {
    const [o, k] = поПути(window.SagaText, путь);
    if (!o) return;
    o[k] = знач; D.text[путь] = знач; сохранить();
  }

  function правитьТермин(путь, знач) {
    D.terms[путь] = знач; сохранить();
    if (window.SagaWeave && SagaWeave.применить) {
      const один = {}; один[путь] = знач; SagaWeave.применить(один);
    }
  }
  window.adSagaПравка = (вид, путь, знач) =>
    (вид === 'term' ? правитьТермин : правитьТекст)(путь, знач);

  // Черновик поднимается при загрузке страницы: иначе половина правок жила бы
  // до первого F5, и человек терял бы вечер, не поняв, почему.
  (function поднять() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(КЛЮЧ) || 'null'); } catch (e) {}
    if (!d) return;
    D.text = d.text || {}; D.terms = d.terms || {};
    Object.keys(D.text).forEach(п => {
      const [o, k] = поПути(window.SagaText, п);
      if (o) o[k] = D.text[п];
    });
    if (window.SagaWeave && SagaWeave.применить) SagaWeave.применить(D.terms);
  })();

  window.adSagaСброс = function () {
    if (!confirm('Снять все правки? Собранный текст вернётся к тому, что лежит в файлах. Выгруженное этим не тронется.')) return;
    D.text = {}; D.terms = {}; сохранить();
    location.reload();     // словари стана правились на месте — их чинит только перезагрузка
  };

  // ── выгрузка ────────────────────────────────────────────────
  const кав = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  function рус(v, отступ) {
    const п = ' '.repeat(отступ);
    if (typeof v === 'string') return кав(v);
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) {
      return '[\n' + v.map(x => п + '  ' + рус(x, отступ + 2)).join(',\n') + '\n' + п + ']';
    }
    return '{\n' + Object.keys(v).map(k =>
      п + '  ' + (/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/.test(k) ? k : кав(k))
      + ': ' + рус(v[k], отступ + 2)).join(',\n') + '\n' + п + '}';
  }

  function скачать(имя, текст) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([текст], { type: 'text/javascript;charset=utf-8' }));
    a.download = имя;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // Шапка повторяет ту, что пишет tools/saga_text_extract.js. Тот скрипт —
  // разовый перенос из кода в данные; дальше файл выгружается отсюда.
  const ШАПКА_ТЕКСТА = `// ════════════════════════════════════════════════════════════
// ХРОНИКИ · ТЕКСТ ПОЛОК
//
// Тут лежат ФРАЗЫ, и больше ничего. Ни условий, ни склейки, ни расчётов —
// всё это осталось в saga_kit.js.
//
// ДЫРА в фразе — {W.E.узла}: сюда подставляется значение из собранного мира.
// Корни: W — мир (W.R раса, W.E среда, W.EP век, W.D доктрина),
//        Л — люди этой хроники (Л.стар.имя, Л.лет.нужда).
// {Б:W.R.старшие} — то же, но с большой буквы: фраза начинается с дыры.
//
// ⚠ Дыры выдумывать нельзя: имя, которого нет в мире, останется в кадре как
// есть — {W.E.нетути}. Что бывает, смотри в saga_weave.js (RACE, ENVS, EPOCH)
// или во вкладке «Термины» верстака.
//
// ⚠ Голос — семь правил конструктора (lore/saga_constructor.md §5):
// летописец, а не наблюдатель; кадр = 2–4 коротких предложения; сперва вещь,
// потом её имя; глагол вместо отрицания; никаких выдуманных терминов.
//
// Файл выгружен верстаком: консоль → «📜 Хроника» → выгрузить текст.
// ════════════════════════════════════════════════════════════
`;

  window.adSagaВыгрузитьТекст = function () {
    const T = window.SagaText;
    const тело = ШАПКА_ТЕКСТА + `(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SagaText = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ПОЛКА 1 · ТЕМЫ — о чём хроника. Берётся по состоянию надлома.
  const ТЕМЫ = ${рус(T.ТЕМЫ, 2)};

  // ПОЛКА 2 · ЛЮДИ — нужда, помеха, что скрывает. Нужда НИКОГДА не совпадает
  // с должностью: летописец хочет не «вести свод».
  const НУЖДЫ = ${рус(T.НУЖДЫ, 2)};

  // ПОЛКА 3 · РУЖЬЯ — вещь или привычка, посаженная без объяснения. Стреляет
  // через две главы. Условие («у них есть руки») живёт в saga_kit.js по id.
  const РУЖЬЯ = ${рус(T.РУЖЬЯ, 2)};

  // ПОЛКА 6 · ЦЕНА — груз со склада, которого у мира нет и быть не может.
  const ГРУЗЫ = ${рус(T.ГРУЗЫ, 2)};

  // ПОЛКА 4 · СОБЫТИЯ — по крючкам: ЧУЖОЙ (глава I), УГОВОР (II),
  // ПУСТОЕ (III), ВИРА (V).
  const СОБЫТИЯ = ${рус(T.СОБЫТИЯ, 2)};

  return { ТЕМЫ, НУЖДЫ, РУЖЬЯ, ГРУЗЫ, СОБЫТИЯ };
});
`;
    скачать('saga_text.js', тело);
  };

  window.adSagaВыгрузитьТермины = function () {
    const ключи = Object.keys(D.terms).sort();
    if (!ключи.length) { alert('Термины не правились — выгружать нечего.'); return; }
    const тело = `// ════════════════════════════════════════════════════════════
// ХРОНИКИ · ПРАВЛЕНЫЕ ТЕРМИНЫ
//
// Слова, которыми хроника зовёт вещи этого мира: старшие, вира, узел среды,
// век. Файл кладётся ПОВЕРХ словарей стана (saga_weave.js) при загрузке —
// исходные словари остаются на месте, и видно, что именно правили руками.
//
// Ключ — склад, потом кого правим, потом поле. Правится только текст: списки
// имён и признаки века стан пропустит молча.
//
// Файл выгружен верстаком: консоль → «📜 Хроника» → Термины → выгрузить.
// Подключать в index.html ДО saga_weave.js.
// ════════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SagaTerms = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  return {
${ключи.map(k => '    ' + кав(k) + ': ' + кав(D.terms[k]) + ',').join('\n')}
  };
});
`;
    скачать('saga_terms.js', тело);
  };

  // ── поля правки ─────────────────────────────────────────────
  // Путь едет в атрибут onclick, а внутри него — в строку JS. Апострофа в
  // именах рас и доктрин сегодня нет, но `esc` вернул бы его как &#39;, и
  // разборщик HTML отдал бы в JS настоящую кавычку — обработчик развалился бы
  // молча. Дешевле закрыть сразу, чем ловить это на новом названии.
  const атр = s => esc(s).replace(/&#39;/g, "\\'");

  function строкаПравки(вид, путь, метка, знач, многострочно) {
    const правлено = (вид === 'term' ? D.terms : D.text)[путь] != null;
    // Строк на узком экране считаем по 45 знаков: там поле вдвое уже, и
    // textarea на две строки прятала бы половину фразы под скролл.
    const шир = (typeof window !== 'undefined' && window.innerWidth <= 720) ? 45 : 90;
    const поле = многострочно
      ? `<textarea rows="${Math.max(2, Math.ceil(String(знач).length / шир))}" oninput="adSagaПравка('${вид}','${атр(путь)}',this.value)">${esc(знач)}</textarea>`
      : `<input value="${esc(знач)}" oninput="adSagaПравка('${вид}','${атр(путь)}',this.value)">`;
    return `<div class="svk-row">
      <span class="svk-lbl${правлено ? ' is-edit' : ''}">${esc(метка)}${правлено ? ' ✎' : ''}</span>
      <span class="svk-val">${поле}</span></div>`;
  }

  const коробка = (t, inner) => `<div class="svk-box">
    <div style="font-size:12px;color:${GD};font-weight:700;margin-bottom:4px">${esc(t)}</div>${inner}</div>`;

  function полкиHtml() {
    const T = window.SagaText;
    if (!T) return `<div style="color:#ff7a7a">saga_text.js не загружен</div>`;
    const п = S.полка || 'темы';
    const под = [['темы', 'Темы'], ['люди', 'Люди'], ['ружья', 'Ружья'],
                 ['груз', 'Груз'], ['события', 'События']];
    let тело = '';
    if (п === 'темы') {
      тело = T.ТЕМЫ.map((t, i) => коробка(t.id,
        строкаПравки('text', `ТЕМЫ.${i}.имя`, 'имя', t.имя)
        + строкаПравки('text', `ТЕМЫ.${i}.линия`, 'линия', t.линия, true)
        + строкаПравки('text', `ТЕМЫ.${i}.хорошо`, 'хорошо кончается', t.хорошо, true)
        + `<div style="font-size:11px;color:${T3};padding-top:6px">состояние надлома: <b>${esc(t.сост || '—')}</b> · ступень ${t.ступень}</div>`)).join('');
    } else if (п === 'люди') {
      const РОЛИ = { лет: 'Летописец / счётчик', стар: 'Старший', смут: 'Смутьян', низ: 'Ходящий снизу' };
      тело = Object.keys(T.НУЖДЫ).map(роль =>
        заг(РОЛИ[роль] || роль) + T.НУЖДЫ[роль].map((н, i) => коробка('вариант ' + (i + 1),
          строкаПравки('text', `НУЖДЫ.${роль}.${i}.нужда`, 'нужда', н.нужда, true)
          + строкаПравки('text', `НУЖДЫ.${роль}.${i}.помеха`, 'помеха', н.помеха, true)
          + строкаПравки('text', `НУЖДЫ.${роль}.${i}.скрывает`, 'скрывает', н.скрывает, true))).join('')).join('');
    } else if (п === 'ружья') {
      тело = T.РУЖЬЯ.map((р, i) => коробка(р.id + '  ·  среда: ' + р.среда,
        строкаПравки('text', `РУЖЬЯ.${i}.сад`, 'сажают', р.сад, true)
        + строкаПравки('text', `РУЖЬЯ.${i}.ход`, 'ход игрока', р.ход, true)
        + строкаПравки('text', `РУЖЬЯ.${i}.бой`, 'стреляет', р.бой, true)
        + строкаПравки('text', `РУЖЬЯ.${i}.замок`, 'что открывает', р.замок, true))).join('');
    } else if (п === 'груз') {
      тело = `<div style="font-size:12px;color:${T3};margin-bottom:8px">Чем платят виру: груз, которого у дозвёздного мира нет и быть не может. Число — сколько списывается со склада.</div>`
        + T.ГРУЗЫ.map((г, i) => коробка(г.id,
          строкаПравки('text', `ГРУЗЫ.${i}.id`, 'ресурс', г.id)
          + `<div style="font-size:11px;color:${T3};padding-top:6px">сколько: <b>${г.n}</b> (правится в saga_text.js — это число, а не слово)</div>`)).join('');
    } else {
      const КРЮЧКИ = { ЧУЖОЙ: 'Глава I · Нас увидели', УГОВОР: 'Глава II · Уговор',
                       ПУСТОЕ: 'Глава III · Пустое место', ВИРА: 'Глава V · Чем платят' };
      тело = Object.keys(T.СОБЫТИЯ).map(крючок =>
        заг(КРЮЧКИ[крючок] || крючок) + T.СОБЫТИЯ[крючок].map((с, i) => коробка(с.id,
          строкаПравки('text', `СОБЫТИЯ.${крючок}.${i}.имя`, 'имя главы', с.имя)
          + с.факты.map((ф, j) => строкаПравки('text', `СОБЫТИЯ.${крючок}.${i}.факты.${j}`,
              'кадр ' + (j + 1), ф, true)).join('')
          + строкаПравки('text', `СОБЫТИЯ.${крючок}.${i}.решение`, 'решение', с.решение, true))).join('')).join('');
    }
    return `<div class="svk-tabs" style="margin-bottom:10px">
      ${под.map(([id, l]) => `<button class="btn ${п === id ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="adSagaSet('полка','${id}')">${l}</button>`).join('')}
      </div>${подсказка()}${тело}`;
  }

  function подсказка() {
    return `<div style="border:1px solid ${W2};border-radius:8px;background:${B3};padding:8px 12px;margin-bottom:12px;font-size:11px;color:${T3};line-height:1.6">
      Дыра в фразе — <b style="color:${GD}">{W.E.узла}</b>: подставится слово этого мира.
      <b style="color:${GD}">{Б:W.R.старшие}</b> — то же с большой буквы.
      Корни: <b>W</b> — мир, <b>Л</b> — люди хроники (<b>Л.стар.имя</b>, <b>Л.лет.нужда</b>).
      Дыра, которой в мире нет, останется в кадре как есть — так её видно.
      Правку сразу видно во вкладке «Хроника целиком».</div>`;
  }

  // ── термины ─────────────────────────────────────────────────
  function терминыHtml() {
    const V = window.SagaWeave;
    if (!V) return `<div style="color:#ff7a7a">saga_weave.js не загружен</div>`;
    const т = S.термин || 'раса';
    const под = [['раса', 'Раса мира'], ['среда', 'Среда'], ['век', 'Век'],
                 ['видят', 'Как видят вас'], ['доктрина', 'Ваша доктрина']];
    // Правим тот словарь, что выбран в шапке: термины меняют собранный мир
    // тут же, и видеть надо ровно свой.
    const текстовые = o => Object.keys(o).filter(k => typeof o[k] === 'string');
    let тело = '';
    if (т === 'раса') {
      const R = V.RACE[S.race] || {};
      тело = коробка(S.race, текстовые(R).map(k =>
        строкаПравки('term', `RACE.${S.race}.${k}`, k, R[k], String(R[k]).length > 60)).join('')
        + `<div style="font-size:11px;color:${T3};padding-top:6px">имена (${(R.имена || []).length}) правятся в saga_weave.js — это список, а не слово</div>`);
    } else if (т === 'среда') {
      const E = V.envOf ? V.envOf(S.env) : null;
      тело = E ? коробка(E.id, текстовые(E).map(k =>
        строкаПравки('term', `ENVS.${E.id}.${k}`, k, E[k], String(E[k]).length > 60)).join('')) : '';
    } else if (т === 'век') {
      const EP = V.EPOCH[S.phase] || {};
      тело = коробка(EP.ep, текстовые(EP).map(k =>
        строкаПравки('term', `EPOCH.${EP.ep}.${k}`, k, EP[k])).join('')
        + `<div style="font-size:11px;color:${T3};padding-top:6px">письмо / счёт / город / порох — признаки века, не слова: их правят в saga_weave.js</div>`);
    } else if (т === 'видят') {
      тело = коробка('Чем ваша раса им показалась',
        `<div style="font-size:11px;color:${T3};margin-bottom:6px">Эта строка попадает в ИХ летопись и остаётся там навсегда: следующий игрок прочтёт, кем были вы.</div>`
        + Object.keys(V.SEEN).map(r =>
          строкаПравки('term', `SEEN.${r}`, r.replace(/ \(.*/, ''), V.SEEN[r], true)).join(''));
    } else {
      const Dc = V.DOCTRINE[S.myDoc] || {};
      тело = коробка(S.myDoc, текстовые(Dc).map(k =>
        строкаПравки('term', `DOCTRINE.${S.myDoc}.${k}`, k, Dc[k], true)).join('')
        + `<div style="font-size:11px;color:${T3};padding-top:6px">что доктрина открывает и закрывает (open / shut) — правила, а не слова</div>`);
    }
    return `<div class="svk-tabs" style="margin-bottom:10px">
      ${под.map(([id, l]) => `<button class="btn ${т === id ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="adSagaSet('термин','${id}')">${l}</button>`).join('')}
      </div>
      <div style="font-size:11px;color:${T3};margin-bottom:10px">Правится тот, кто выбран в шапке. Смени расу или среду наверху — здесь откроются её слова.</div>
      ${тело}`;
  }

  window.adSagaSet = function (k, v) {
    if (k === 'phase' || k === 'sys' || k === 'pid') v = parseInt(v, 10) || 0;
    S[k] = v;
    // Поля ввода перерисовывать нельзя — каретка прыгнет в начало. Текстовые
    // правки ждут следующего клика, остальное перерисовывается сразу.
    if (k === 'name' || k === 'envoy' || k === 'sys' || k === 'pid') return;
    if (typeof adPaint === 'function') adPaint();
  };
})();
