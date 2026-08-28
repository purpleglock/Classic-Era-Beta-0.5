// ════════════════════════════════════════════════════════════════════════
//  I18N-СЛОВАРЬ ИНТЕРФЕЙСА
//
//  Интерфейс написан по-русски прямо в шаблонах — 75 файлов, десятки тысяч
//  мест. Перевод для них лежит в репозитории (i18n/en.json + glossary.json)
//  и подставляется ЗДЕСЬ, на выходе рендера: синхронно, из памяти, без
//  единого обращения в сеть. Ни один игрок ничего не ждёт.
//
//  Это НЕ машинный перевод в рантайме. Словарь готовится заранее
//  (tools/i18n_extract.js → tools/i18n_fill.js), правится руками и живёт в
//  git как обычный файл: увидели кривую фразу — поправили строку в en.json.
//
//  Глоссарий сильнее словаря: термины, названия валют и имена собственные
//  задаются вручную и машине не отдаются.
//
//  Чего здесь нет: речи игроков. Чат, сводки держав и отыгрыш переводит
//  mt.js через переводчик — там текст заранее неизвестен.
// ════════════════════════════════════════════════════════════════════════

const I18D = {
  map: null,          // русская фраза → английская
  tpl: [],            // шаблоны с местами под значения: [regexp, шаблон EN]
  ready: false,
  seen: new WeakSet(),
  miss: new Map(),    // фразы, которых в словаре нет — на дозаполнение
  applying: false,
  timer: null,
  roots: [],
};

const I18D_MISS_KEY = 'wk_i18n_miss';
const I18D_MAX  = 400;    // узлов за один проход
const I18D_WAIT = 60;     // мс на склейку правок DOM

// Поля ввода, код, холсты и векторные карты не трогаем; блоки речи игроков
// (data-mt) — вотчина mt.js.
const I18D_STOP = 'input,textarea,select,option,script,style,code,pre,svg,canvas,'
                + '[contenteditable],[data-mt],[data-mt-skip],.mt-note';

// ── Загрузка словаря ──────────────────────────────────────────────────
async function i18dLoad() {
  if (I18D.map) return I18D.ready;
  I18D.map = new Map();
  try {
    const [en, gloss] = await Promise.all([
      fetch('i18n/en.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('i18n/glossary.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);
    for (const k in en) I18D.map.set(k, en[k]);
    for (const k in gloss) I18D.map.set(k, gloss[k]);   // ручное сильнее машинного

    // Фразы с местами под значения («Показать ещё {0} · раньше») точным
    // совпадением не поймать — держим их отдельно, как образцы.
    for (const [ru, tr] of I18D.map) {
      if (!ru.includes('{0}')) continue;
      const rx = new RegExp('^' + ru
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')          // экранируем всё,
        // …кроме мест под значения. Дыра НЕ должна перепрыгивать разделители:
        // с обычным (.+?) образец «{0} уровень» сжирал «Пустотный рейдер · 3
        // уровень» целиком и выдавал «level Пустотный рейдер · 3».
        .replace(/\\\{(\d+)\\\}/g, '([^·•|]+?)') + '$');
      I18D.tpl.push([rx, tr, ru.replace(/\{\d+\}/g, '').trim().length]);
    }
    // Сначала образцы с бо́льшей опорой на постоянный текст: они точнее, а
    // «почти сплошная дыра» вроде «{0} ГС» должна пробоваться последней.
    I18D.tpl.sort((a, b) => b[2] - a[2]);
    I18D.ready = I18D.map.size > 0;
  } catch (e) { I18D.ready = false; }
  return I18D.ready;
}

// ── Перевод одной фразы ───────────────────────────────────────────────
function i18d(text) {
  if (!I18D.ready) return null;
  const s = String(text).trim();
  if (!s) return null;

  const hit = I18D.map.get(s);
  if (hit) return hit;

  // Строку могли собрать в рантайме из кусков: «Пустотный рейдер · 3 уровень»
  // — это звание из базы плюс подпись из кода, и целиком её в словаре нет и
  // быть не может. Составную строку разбираем по разделителям ДО образцов:
  // иначе образец схватит её целиком и перемешает куски местами.
  if (/ [·•|—] /.test(s)) {
    const parts = s.split(/ [·•|—] /);
    const seps = s.match(/ [·•|—] /g);
    const trs = parts.map(p => I18D.map.get(p.trim()) || i18dTpl(p.trim()));
    if (trs.some(Boolean)) {
      let out = trs[0] ?? parts[0];
      for (let k = 1; k < parts.length; k++) out += seps[k - 1] + (trs[k] ?? parts[k]);
      return out;
    }
  }

  // Образцы: «Найдено 12 из 44» ← «Найдено {0} из {1}».
  const byTpl = i18dTpl(s);
  if (byTpl) return byTpl;

  // Не нашли — копим: так словарь дозаполняется реальными строками экрана,
  // а не только тем, что удалось вытащить из кода. Выгрузка: i18dMisses().
  if (/[А-ЯЁа-яё]{2}/.test(s) && I18D.miss.size < 3000) {
    I18D.miss.set(s, (I18D.miss.get(s) || 0) + 1);
  }
  return null;
}

// Образцы вынесены отдельно: их зовёт и точный поиск, и разбор по сегментам.
function i18dTpl(s) {
  for (const [rx, tr] of I18D.tpl) {
    const m = rx.exec(s);
    if (m) return tr.replace(/\{(\d+)\}/g, (_, k) => m[+k + 1] ?? '');
  }
  return null;
}

// ── Проход по DOM ─────────────────────────────────────────────────────
function i18dNodes(root) {
  if (!root || root.nodeType !== 1 || root.closest?.(I18D_STOP)) return [];
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (I18D.seen.has(n)) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p || p.closest(I18D_STOP)) return NodeFilter.FILTER_REJECT;
      return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let n; while ((n = w.nextNode()) && out.length < I18D_MAX) out.push(n);
  return out;
}

// Подписи полей и подсказки живут в атрибутах — в формах это половина текста.
const I18D_ATTRS = ['placeholder', 'title', 'aria-label'];

function i18dApply(roots) {
  if (!I18D.ready || lang !== 'en') return;
  I18D.applying = true;
  let hits = 0, over = false;
  try {
    for (const r of roots) {
      const nodes = i18dNodes(r);
      if (nodes.length >= I18D_MAX) over = true;
      for (const n of nodes) {
        I18D.seen.add(n);
        const tr = i18d(n.nodeValue);
        if (!tr) continue;
        // Пробелы по краям несут вёрстку — возвращаем их на место.
        const m = /^([ \t\n]*)([\s\S]*?)([ \t\n]*)$/.exec(n.nodeValue);
        n.nodeValue = (m ? m[1] : '') + tr + (m ? m[3] : '');
        hits++;
      }
      if (r.nodeType !== 1) continue;
      for (const el of [r, ...r.querySelectorAll('*')]) {
        for (const a of I18D_ATTRS) {
          const v = el.getAttribute?.(a);
          if (!v) continue;
          const tr = i18d(v);
          if (tr && tr !== v) { el.setAttribute(a, tr); hits++; }
        }
      }
    }
  } finally {
    I18D.applying = false;
  }
  // Упёрлись в потолок прохода — за остатком никто не вернётся, наблюдатель
  // молчит, пока DOM не меняется. Идём сами.
  if (over) i18dQueue(document.body);
  return hits;
}

function i18dQueue(root) {
  if (lang !== 'en') return;
  if (root) I18D.roots.push(root);
  if (I18D.timer) return;
  I18D.timer = setTimeout(() => {
    I18D.timer = null;
    const roots = I18D.roots.length ? I18D.roots : [document.body];
    I18D.roots = [];
    i18dApply(roots);
  }, I18D_WAIT);
}

// Панели рисуются по мере кликов. Ждать вызова от каждого рендерера — значит
// гарантированно что-то забыть, поэтому слушаем сам DOM.
function i18dWatch() {
  if (!('MutationObserver' in window)) return;
  new MutationObserver(muts => {
    if (I18D.applying || lang !== 'en') return;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) i18dQueue(n);
        else if (n.nodeType === 3 && m.target?.nodeType === 1) i18dQueue(m.target);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// Смена языка: обратно на русский возвращаемся перерисовкой (setLang и так
// перерисовывает страницу), а отметки сбрасываем — иначе новый текст
// посчитается уже пройденным.
function i18dReset() {
  I18D.seen = new WeakSet();
  i18dStart();      // на английский переключились впервые — словарь ещё не загружен
}

// ── Дозаполнение словаря ──────────────────────────────────────────────
// Всё, чего не хватило на живых экранах, копится здесь. Выгрузить из консоли:
//   i18dMisses()            — показать и скачать файл
// Дальше строки кладутся в i18n/strings.ru.json и добиваются tools/i18n_fill.js.
function i18dMisses() {
  const rows = [...I18D.miss.entries()].sort((a, b) => b[1] - a[1]);
  console.log('нет в словаре:', rows.length, 'фраз');
  console.table(rows.slice(0, 40).map(([s, n]) => ({ фраза: s.slice(0, 80), встреч: n })));
  try { localStorage.setItem(I18D_MISS_KEY, JSON.stringify(rows.map(r => r[0]).slice(0, 2000))); } catch (e) {}
  return rows.map(r => r[0]);
}

// Словарь весит под мегабайт, и русскому игроку он не нужен ни секунды —
// грузим его только под английский язык, хоть при заходе, хоть при
// переключении. Отсюда же вызывается i18dReset (см. setLang в core.js).
function i18dStart() {
  if (lang !== 'en') return;
  i18dLoad().then(ok => {
    if (!ok) return;              // словаря нет — интерфейс просто остаётся русским
    if (!I18D.watching) { I18D.watching = true; i18dWatch(); }
    i18dQueue(document.body);
  });
}

document.addEventListener('DOMContentLoaded', i18dStart);
