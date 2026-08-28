// ════════════════════════════════════════════════════════════════════════
//  MT — машинный перевод игрового текста.
//
//  Задача: стереть языковой барьер между игроками. Статический словарь I18N
//  переводит ИНТЕРФЕЙС; здесь переводится то, что игроки пишут сами — чат,
//  сводки держав, отыгрыш в локациях, вики-статьи фракций.
//
//  Как пользоваться из рендереров: повесить на контейнер с текстом игрока
//  атрибут data-mt и вызвать mtScan(root) после отрисовки.
//
//      <div class="ch-body" data-mt>привет, сосед</div>
//      …
//      mtScan(document.getElementById('ch-log'));
//
//  Дальше модуль сам: определит язык, отсеет совпадающий с твоим, соберёт
//  пачку, сходит на edge-функцию translate и подменит текст, подписав строку
//  «переведено · оригинал» с переключателем.
//
//  Переводятся ТЕКСТОВЫЕ УЗЛЫ, а не innerHTML: разметка внутри (упоминания,
//  ссылки, стикеры) остаётся на месте, ничего не ломается.
// ════════════════════════════════════════════════════════════════════════

const MT_URL      = SB_URL + '/functions/v1/translate';
const MT_KEY      = 'wk_mt';          // выключатель автоперевода
const MT_CACHE_K  = 'wk_mt_cache';    // локальный кэш переводов
const MT_CACHE_N  = 800;              // строк в локальном кэше
const MT_BATCH    = 40;               // столько строк уходит в один запрос
const MT_DEBOUNCE = 90;               // мс: собираем пачку, а не долбим по одной
const MT_MIN      = 2;                // короче — не переводим (смайлы, «ок»)

const MT = {
  cache: new Map(),   // 'to|текст' → перевод
  queue: new Map(),   // текст → [resolve, …]
  timer: null,
  busy: 0,     // кусков в работе — на нём держится индикатор в шапке
};

// ── Выключатель. По умолчанию включён: барьер убираем, а не предлагаем. ──
function mtOn() { try { return localStorage.getItem(MT_KEY) !== '0'; } catch (e) { return true; } }
function mtSetOn(on) {
  try { localStorage.setItem(MT_KEY, on ? '1' : '0'); } catch (e) {}
  // Разом перерисовать всё дешевле, чем ходить по узлам: снимаем отметки
  // и заново прогоняем видимый текст.
  document.querySelectorAll('[data-mt-done]').forEach(el => {
    if (!on) mtRestore(el);
    el.removeAttribute('data-mt-done');
  });
  if (on) mtScan(document.body);
}

// ── Язык строки: кириллица против латиницы. Игра двуязычная, этого хватает,
//    и это ноль запросов в сеть. Сервер проверяет то же самое ещё раз. ──
function mtDetect(text) {
  const s = String(text || '');
  const cyr = (s.match(/[Ѐ-ӿ]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  if (cyr === 0 && lat === 0) return '';
  return cyr >= lat ? 'ru' : 'en';
}

// Стоит ли вообще связываться: слишком короткое, одни цифры или чужого языка
// в строке нет — оставляем как есть.
function mtWorth(text, to) {
  const s = String(text || '').trim();
  if (s.length < MT_MIN || !/[\p{L}]{2}/u.test(s)) return false;
  const d = mtDetect(s);
  return !!d && d !== to;
}

// ── Локальный кэш поверх серверного: одна и та же реплика на экране не
//    заставляет ходить в сеть при каждой перерисовке чата. ──
function mtCacheLoad() {
  try {
    const o = JSON.parse(localStorage.getItem(MT_CACHE_K) || '{}');
    for (const k in o) MT.cache.set(k, o[k]);
  } catch (e) {}
}
function mtCacheSave() {
  try {
    const ent = [...MT.cache.entries()].slice(-MT_CACHE_N);
    localStorage.setItem(MT_CACHE_K, JSON.stringify(Object.fromEntries(ent)));
  } catch (e) {}
}

// Готов ли перевод ПРЯМО СЕЙЧАС. Знать это синхронно принципиально: то,
// что уже лежит в кэше, надо подставить без всякого ожидания и анимации.
// Иначе при каждой перерисовке ленты блоки пропадали и появлялись заново —
// это и читалось как «дёрганая анимация, которая играет много раз».
function mtCacheGet(text) {
  const to = (typeof lang !== 'undefined' ? lang : 'ru');
  return MT.cache.get(to + '|' + String(text).trim()) || null;
}

function mtCached(text) {
  const to = (typeof lang !== 'undefined' ? lang : 'ru');
  return MT.cache.has(to + '|' + String(text).trim());
}

// ── Очередь. Всё, что попросили за 90 мс, уезжает одним запросом. ──
function mtTranslate(text) {
  const to = (typeof lang !== 'undefined' ? lang : 'ru');
  const key = to + '|' + text;
  if (MT.cache.has(key)) return Promise.resolve(MT.cache.get(key));
  return new Promise(res => {
    const w = MT.queue.get(text);
    if (w) { w.push(res); return; }
    MT.queue.set(text, [res]);
    if (!MT.timer) MT.timer = setTimeout(mtFlush, MT_DEBOUNCE);
  });
}

async function mtFlush() {
  MT.timer = null;
  const to = (typeof lang !== 'undefined' ? lang : 'ru');
  const all = [...MT.queue.keys()];
  if (!all.length) return;
  const batch = all.slice(0, MT_BATCH);
  const waiters = batch.map(t => MT.queue.get(t));
  batch.forEach(t => MT.queue.delete(t));
  if (MT.queue.size) MT.timer = setTimeout(mtFlush, MT_DEBOUNCE);

  let out = null;
  try {
    const r = await fetch(MT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SB_ANON,
                 authorization: 'Bearer ' + SB_ANON },
      body: JSON.stringify({ q: batch, to }),
    });
    if (r.ok) out = (await r.json()).t;
  } catch (e) { /* сеть молчит — покажем оригинал */ }

  batch.forEach((t, i) => {
    const tr = (out && typeof out[i] === 'string') ? out[i] : null;
    if (tr) { MT.cache.set(to + '|' + t, tr); }
    waiters[i].forEach(res => res(tr));
  });
  if (out) mtCacheSave();
}

// ── Разбор узла: собираем текстовые узлы, каждый переводим отдельно, чтобы
//    разметка (упоминания, ссылки, стикеры) уцелела. ──
function mtTextNodes(el) {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      // Код, время, счётчики и служебные подписи не трогаем.
      if (p.closest('code,pre,time,.mt-note,[data-mt-skip]')) return NodeFilter.FILTER_REJECT;
      return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let n; while ((n = w.nextNode())) out.push(n);
  return out;
}

// ── Единицы перевода: абзацы, а не блок целиком. ─────────────────────
//  Статья на скриншоте превратилась в сплошную простыню именно потому, что
//  весь блок склеивался в одну фразу: абзацы, цитата, выделенные строки и
//  таблица инфобокса теряли границы. Поэтому режем на минимальные блочные
//  куски — каждый переводится отдельно и остаётся на своём месте.
// Куски, которые перевод обязан обойти: имя упомянутой державы (чип в
// новостях), текст ссылки, всё с data-mt-keep.
const MT_KEEP = 'a,.md-fac,.cmt-fac-chip,[data-mt-keep]';
// Метка места неприкасаемого куска. Скобки редкие — переводчик их не трогает.
const MT_MARK = k => '⟦' + k + '⟧';

const MT_BLOCK = 'p,div,li,td,th,tr,h1,h2,h3,h4,h5,h6,blockquote,section,'
               + 'article,figcaption,dd,dt,summary';

function mtUnits(el) {
  const units = [];
  const push = nodes => { if (nodes.length) units.push(nodes); };

  // Листовые блоки — те, внутри которых своих блоков уже нет.
  const blocks = [...el.querySelectorAll(MT_BLOCK)].filter(b => !b.querySelector(MT_BLOCK));

  for (const b of blocks) {
    // <br> внутри абзаца — тоже граница строки: склеив через него, мы
    // склеили бы разные реплики в одну.
    const group = mtTextNodes(b);
    if (!b.querySelector('br')) { push(group); continue; }
    let cur = [];
    for (const n of group) {
      cur.push(n);
      const next = n.nextSibling;
      if (next && next.nodeName === 'BR') { push(cur); cur = []; }
    }
    push(cur);
  }

  // Текст, лежащий прямо в блоке мимо всех абзацев (короткая реплика чата,
  // подпись, ячейка) — тоже единица.
  const loose = mtTextNodes(el).filter(n => !blocks.some(b => b.contains(n)));
  push(loose);

  return units;
}

function mtRestore(el) {
  const orig = el._mtOrig;
  if (!orig) return;
  orig.forEach(([n, v]) => { if (n.isConnected) n.nodeValue = v; });
  el.querySelector(':scope > .mt-note')?.remove();
  el.classList.remove('mt-shown');
}

function mtShow(el) {
  const pairs = el._mtTr;
  if (!pairs) return;
  pairs.forEach(([n, v]) => { if (n.isConnected) n.nodeValue = v; });
  el.classList.add('mt-shown');
}

// Подпись под переведённым куском: игрок всегда может вернуть оригинал.
function mtNote(el) {
  if (el.querySelector(':scope > .mt-note')) return;
  const ru = (typeof lang !== 'undefined' ? lang : 'ru') === 'ru';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mt-note';
  b.textContent = ru ? 'переведено · оригинал' : 'translated · original';
  b.onclick = (e) => {
    e.stopPropagation();
    const shown = el.classList.contains('mt-shown');
    if (shown) { mtRestore(el); mtNote(el); el.querySelector(':scope > .mt-note').textContent = ru ? 'оригинал · перевод' : 'original · translation'; }
    else       { mtShow(el);    el.querySelector(':scope > .mt-note').textContent = ru ? 'переведено · оригинал' : 'translated · original'; }
  };
  el.appendChild(b);
}

// ── Точка входа для рендереров. ──
//  ВАЖНО: сначала СОБИРАЕМ работу со всех блоков и только потом ждём. Первая
//  версия шла по блокам с `await` внутри цикла: каждая карточка новостей
//  дожидалась своего ответа, и главная с дюжиной сводок переводилась дюжиной
//  последовательных рейсов вместо одного. Теперь все строки попадают в одно
//  окно накопления и уезжают вместе.
async function mtScan(root) {
  if (!mtOn()) return;
  const to = (typeof lang !== 'undefined' ? lang : 'ru');
  const scope = root || document.body;
  const list = [];
  if (scope.nodeType === 1 && scope.hasAttribute?.('data-mt') && !scope.hasAttribute('data-mt-done')) list.push(scope);
  scope.querySelectorAll?.('[data-mt]:not([data-mt-done])').forEach(el => {
    // Вложенный блок внутри уже помеченного не берём: иначе на один и тот же
    // текст выходит ДВЕ подписи «переведено · оригинал» — одна от внешнего
    // блока, вторая от внутреннего.
    if (el.parentElement?.closest('[data-mt]')) { el.setAttribute('data-mt-done', '1'); return; }
    list.push(el);
  });
  if (!list.length) return;

  const jobs = [];
  for (const el of list) {
    el.setAttribute('data-mt-done', '1');
    const units = mtUnits(el);
    if (!units.length) continue;

    const pieces = [];
    for (const nodes of units) {
      // ── Внутри ОДНОГО абзаца фразу переводим целиком: рвать её по узлам
      //    разметки значит отдать переводчику обрубки («Hold the» / «anchor»
      //    / «, the black star is») — выходит каша.
      //    Исключение — ссылки: их текст осмыслен сам по себе и вычищать его
      //    из <a> нельзя, поэтому там идём по узлам.
      // Особые куски абзаца: чип упомянутой державы, текст ссылки, всё с
      // data-mt-keep. При склейке их гасить нельзя — именно так из новостей
      // пропадали вставленные державы, оставались пустые квадратики. Но и
      // оставлять их кириллицей посреди английской фразы нельзя: имя
      // переводится ОТДЕЛЬНЫМ куском и остаётся на своём месте.
      const anchor = n => !!n.parentElement?.closest(MT_KEEP);
      const keep = nodes.filter(anchor);
      const free = nodes.filter(n => !anchor(n));

      // Имена в чипах и ссылках — сами по себе, каждое своим запросом.
      for (const n of keep) {
        const v = n.nodeValue.trim();
        if (!mtWorth(v, to)) continue;
        pieces.push({ nodes: [n], whole: false, cached: mtCached(v), p: [mtTranslate(v)] });
      }
      if (!free.length) continue;

      if (!keep.length) {
        const whole = nodes.map(n => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
        if (!mtWorth(whole, to)) continue;
        pieces.push({ nodes, whole: true, cached: mtCached(whole), p: [mtTranslate(whole)] });
      } else {
        // Собираем фразу с метками на месте особых кусков: переводчик видит
        // связный текст, а метки возвращаются на свои места.
        let text = '', k = 0;
        const slots = [];              // сегмент → узлы обычного текста
        let cur = [];
        for (const n of nodes) {
          if (anchor(n)) { slots.push(cur); cur = []; text += ' ' + MT_MARK(k++) + ' '; }
          else { cur.push(n); text += n.nodeValue; }
        }
        slots.push(cur);
        const whole = text.replace(/\s+/g, ' ').trim();
        if (!mtWorth(whole, to)) continue;
        pieces.push({ nodes: free, slots, marks: k, whole: 'marked',
                      cached: mtCached(whole), p: [mtTranslate(whole)] });
      }
    }
    if (pieces.length) {
      // Всё нужное уже в кэше — подставим в этой же микрозадаче, кадр между
      // «спрятали» и «показали» не успеет отрисоваться. Такому блоку ни
      // ожидание, ни анимация не нужны: он просто сразу правильный.
      const warm = pieces.every(p => p.cached);
      jobs.push({ el, pieces, warm });
    }
    // Блоку перевод не нужен (он уже на языке читателя) — показываем сразу,
    // иначе правило ожидания оставило бы его невидимым.
    else mtWaitOff(el);
  }
  if (!jobs.length) return;

  // ── Прогретые блоки подставляем ПРЯМО СЕЙЧАС, синхронно. Раньше даже они
  //    шли через await: браузер успевал отрисовать кадр с оригиналом, и текст
  //    прыгал «оригинал → перевод» при каждой перерисовке ленты и меню.
  const cold = [];
  for (const j of jobs) {
    if (!j.warm) { cold.push(j); continue; }
    const orig = [], tr = [];
    let ok = true;
    for (const p of j.pieces) {
      // Абзац с метками (в нём есть чипы держав) собирается сложнее — его
      // проводим обычным путём, синхронную дорожку не усложняем.
      if (p.whole === 'marked') { ok = false; break; }
      const vals = p.whole
        ? [mtCacheGet(p.nodes.map(n => n.nodeValue).join('').replace(/\s+/g, ' ').trim())]
        : p.nodes.map(n => mtCacheGet(n.nodeValue));
      if (!vals.some(Boolean)) { ok = false; break; }
      p.nodes.forEach((n, i) => {
        orig.push([n, n.nodeValue]);
        tr.push([n, p.whole ? (i === 0 ? vals[0] : '') : (vals[i] != null ? vals[i] : n.nodeValue)]);
      });
    }
    if (!ok) { cold.push(j); continue; }
    j.el._mtOrig = orig;
    j.el._mtTr = tr;
    mtShow(j.el);
    j.el.setAttribute('data-mt-ready', '1');
    if (!j.el.hasAttribute('data-mt-quiet') && mtBig(j.el)) mtNote(j.el);
  }
  if (!cold.length) return;

  // Ожидание показываем ТОЛЬКО тем, кто правда ждёт рейса.
  // Показываем ожидание ТОЛЬКО крупным блокам — статье, реплике, посту.
  // Пункт меню, заголовок и короткая подпись переводятся молча: они
  // перерисовываются постоянно, и любая анимация на них превращается в
  // мельтешение по всему сайту.
  cold.forEach(j => { if (mtBig(j.el)) mtWaitOn(j.el); });
  mtBusy(cold.length);

  try {
    await Promise.all(cold.map(async (j) => {
      const done = await Promise.all(j.pieces.map(p => Promise.all(p.p)));
      mtWaitOff(j.el);
      if (!done.some(trs => trs.some(Boolean))) return;

      const orig = [], tr = [];
      j.pieces.forEach((p, k) => {
        const trs = done[k];
        p.nodes.forEach(n => orig.push([n, n.nodeValue]));
        if (!trs.some(Boolean)) {           // абзац не перевёлся — оставляем как есть
          p.nodes.forEach(n => tr.push([n, n.nodeValue]));
          return;
        }
        // Перевод абзаца кладём в его первый узел, остальные узлы этого же
        // абзаца гасим. Границы абзаца при этом целы — раньше в первый узел
        // сваливалась ВСЯ статья, и она превращалась в простыню без абзацев,
        // цитат и выделений.
        if (p.whole === 'marked') {
          // Режем перевод по меткам и раскладываем куски между неприкасаемыми:
          // державы остаются на своих местах, текст вокруг них — переведённый.
          // Метку переводчик может слегка исказить (пробел внутри, другие
          // скобки), поэтому разрез терпимый к мусору вокруг номера.
          const parts = String(trs[0] || '').split(/\s*[⟦[【]{1,2}\s*\d+\s*[⟧\]】]{1,2}\s*/);
          p.slots.forEach((slot, si) => {
            const val = parts[si] != null ? parts[si] : '';
            slot.forEach((n, i) => tr.push([n, i === 0 ? (si ? ' ' + val + ' ' : val + ' ') : '']));
          });
          return;
        }
        p.nodes.forEach((n, i) => tr.push([n,
          p.whole ? (i === 0 ? trs[0] : '')
                  : (trs[i] != null ? trs[i] : n.nodeValue)]));
      });
      j.el._mtOrig = orig;
      j.el._mtTr = tr;
      mtShow(j.el);
      // Заголовок переводим молча: подпись под каждым — визуальный мусор,
      // на карточке новостей их выходило по две подряд. Возврат к оригиналу
      // живёт на теле текста.
      if (!j.el.hasAttribute('data-mt-quiet') && mtBig(j.el)) mtNote(j.el);
    }));
  } finally {
    cold.forEach(j => mtWaitOff(j.el));
    mtBusy(-cold.length);
  }
}

// Крупный ли блок: ожидание уместно там, где игрок правда ждёт чтения —
// статья, реплика новеллы, пост. На коротком заголовке скелетон читается
// как поломка, а не как загрузка.
const MT_BIG_CHARS = 140;
function mtBig(el) {
  return (el.textContent || '').trim().length >= MT_BIG_CHARS;
}

// ── Ожидание перевода ────────────────────────────────────────────────
//  Правила простые: игрок не видит, как текст переводится у него на глазах,
//  и не видит мельтешения. Поэтому:
//   • блок, для которого перевод уже в кэше, вообще не проходит через это
//     состояние — он сразу правильный (см. warm в mtScan);
//   • блок, который правда ждёт рейса, накрывается спокойным скелетоном:
//     текст под ним не читается, высота сохраняется, страница не прыгает;
//   • готовый текст выходит мягким проявлением, один раз.
function mtWaitOn(el) {
  el.classList.remove('mt-appear');
  el.classList.add('mt-pending');
}
function mtWaitOff(el) {
  const waited = el.classList.contains('mt-pending');
  el.classList.remove('mt-pending');
  el.setAttribute('data-mt-ready', '1');
  if (!waited) return;                 // ничего не ждали — не за что и проявляться
  el.classList.add('mt-appear');
  // Класс снимаем по окончании, иначе повторный рендер проиграет проявление
  // заново — именно так и получалось «дёрганье по многу раз».
  setTimeout(() => el.classList.remove('mt-appear'), 420);
}

// Счётчик кусков в работе: пока он не ноль, в шапке горит ровная (без
// мерцания) отметка «перевод».
function mtBusy(delta) {
  MT.busy = Math.max(0, MT.busy + delta);
  const btn = document.getElementById('lb-mt');
  if (btn) btn.classList.toggle('mt-run', MT.busy > 0);
}

// Смена языка интерфейса обесценивает все подмены на экране: возвращаем
// оригиналы и снимаем отметки, дальше рендер пройдёт заново.
function mtDropAll() {
  document.querySelectorAll('[data-mt-done]').forEach(el => {
    mtRestore(el);
    el.removeAttribute('data-mt-done');
    delete el._mtOrig; delete el._mtTr;
  });
}

// ── Выключатель в шапке рядом с RU/EN. ──
function mtToggle() {
  mtSetOn(!mtOn());
  mtBtnSync();
  if (typeof toast === 'function') {
    const ru = (typeof lang !== 'undefined' ? lang : 'ru') === 'ru';
    toast(mtOn() ? (ru ? 'Речь игроков переводится' : 'Player speech is translated')
                 : (ru ? 'Перевод речи выключен'   : 'Speech translation off'));
  }
}
function mtBtnSync() {
  const btn = document.getElementById('lb-mt');
  if (!btn) return;
  const on = mtOn();
  btn.classList.toggle('on', on);
  // Цвет ставим на элемент, а не правилом: в шапке цвет кнопок задан
  // с !important (07_premium), и обычный inline-стиль его не перебьёт.
  btn.style.setProperty('color', on ? 'hsl(200 65% 66%)' : 'hsl(220 12% 36%)', 'important');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const ru = (typeof lang !== 'undefined' ? lang : 'ru') === 'ru';
  btn.title = on ? (ru ? 'Речь игроков переводится — выключить' : 'Player speech is translated — turn off')
                 : (ru ? 'Переводить речь игроков'             : 'Translate player speech');
}


mtCacheLoad();
document.addEventListener('DOMContentLoaded', mtBtnSync);
