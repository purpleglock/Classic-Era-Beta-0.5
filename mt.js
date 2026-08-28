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
  scope.querySelectorAll?.('[data-mt]:not([data-mt-done])').forEach(el => list.push(el));
  if (!list.length) return;

  const jobs = [];
  for (const el of list) {
    el.setAttribute('data-mt-done', '1');
    const nodes = mtTextNodes(el);
    if (!nodes.length) continue;

    // ── Фразу переводим ЦЕЛИКОМ. Разбить реплику по узлам разметки значит
    //    отдать переводчику обрубки («Hold the» / «anchor» / «, the black
    //    star is») — выходит каша. Жирное и курсив в переведённом виде
    //    теряются, зато смысл цел; оригинал со всей разметкой — по подписи.
    //    Исключение — ссылки: у них текст осмысленный сам по себе и его
    //    нельзя вычищать из <a>, поэтому там идём по узлам.
    const hasLinks = !!el.querySelector('a,[data-mt-keep]');

    if (!hasLinks) {
      const whole = nodes.map(n => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
      if (!mtWorth(whole, to)) continue;
      jobs.push({ el, nodes, whole: true, p: [mtTranslate(whole)] });
    } else {
      const part = nodes.filter(n => mtWorth(n.nodeValue, to));
      if (!part.length) continue;
      jobs.push({ el, nodes: part, whole: false, p: part.map(n => mtTranslate(n.nodeValue.trim())) });
    }
  }
  if (!jobs.length) return;

  // Пока идёт рейс — говорим об этом: и в самой строке, и счётчиком в шапке.
  jobs.forEach(j => mtWaitOn(j.el));
  mtBusy(jobs.length);

  try {
    await Promise.all(jobs.map(async (j) => {
      const trs = await Promise.all(j.p);
      mtWaitOff(j.el);
      if (!trs.some(Boolean)) return;
      j.el._mtOrig = j.nodes.map(n => [n, n.nodeValue]);
      j.el._mtTr = j.whole
        ? j.nodes.map((n, i) => [n, i === 0 ? trs[0] : ''])
        : j.nodes.map((n, i) => [n, trs[i] != null ? trs[i] : n.nodeValue]);
      mtShow(j.el);
      // Заголовок переводим молча: подпись под каждым — визуальный мусор,
      // на карточке новостей их выходило по две подряд. Возврат к оригиналу
      // живёт на теле текста.
      if (!j.el.hasAttribute('data-mt-quiet')) mtNote(j.el);
    }));
  } finally {
    jobs.forEach(j => mtWaitOff(j.el));
    mtBusy(-jobs.length);
  }
}

// ── Статус перевода ──────────────────────────────────────────────────
// Ожидание должно быть видно. Молчащий экран, который через несколько секунд
// вдруг подменяет текст, читается как «сайт тормозит», а не «идёт перевод».
function mtWaitOn(el) {
  if (el.hasAttribute('data-mt-quiet')) return;
  if (el.querySelector(':scope > .mt-note')) return;
  const ru = (typeof lang !== 'undefined' ? lang : 'ru') === 'ru';
  const n = document.createElement('span');
  n.className = 'mt-note mt-wait';
  n.textContent = ru ? 'перевод…' : 'translating…';
  el.appendChild(n);
}
function mtWaitOff(el) {
  el.querySelector(':scope > .mt-note.mt-wait')?.remove();
}

// Счётчик в шапке: сколько кусков сейчас в работе. Пока идёт хоть один —
// глобус светится и крутится, и понятно, чего ждать.
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
