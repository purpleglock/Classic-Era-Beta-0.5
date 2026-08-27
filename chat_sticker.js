// © 2025–2026. Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════════
//  СТИКЕРЫ ЧАТА: ОДНА ОТРИСОВКА НА ВСЕХ
//
//  Стикер рисуют трое: палитра в чате (мелко), лента (крупно) и редактор в
//  админке (поверх — рамки, которые таскают мышью). Раскладка обязана
//  совпадать до пикселя во всех трёх, иначе админ двигает подпись в одном
//  месте, а игроки видят её в другом. Поэтому картинку собирает ОДНА функция —
//  stHtml(), а редактор лишь кладёт свои ручки поверх её результата.
//
//  ⚠️ ВСЁ В ДОЛЯХ ЕДИНИЦЫ И em/%. Ни одного пикселя в раскладке: стикер живёт
//  в трёх размерах сразу. Кегль подписи — доля ВЫСОТЫ стикера, поэтому текст
//  ужимается вместе с картинкой, а не выпирает на превью.
//
//  ⚠️ ПОДПИСЬ РЕЖЕТСЯ ПО СЛОВАМ, А НЕ МАСШТАБИРУЕТСЯ. Автоподгонка кегля под
//  длину («сожмём, чтобы влезло») даёт у одного игрока плакат, у другого —
//  мышиный шрифт на том же стикере. Кегль задан раскладкой, длинная подпись
//  переносится и обрезается по высоте блока.
//
//  Зависит от: esc() из core.js.
// ════════════════════════════════════════════════════════════════════════

const ST_DIR = 'assets/stickers';

// Начертания берём из уже подключённых на сайте: Orbitron 900 и Audiowide —
// это и есть «стикерный» голос, Rajdhani/JetBrains — спокойные.
const ST_FONTS = {
  poster:  { label: 'Плакат',   css: "'Orbitron', 'Rajdhani', sans-serif",     weight: 900, ls: '.02em', caps: true },
  sign:    { label: 'Вывеска',  css: "'Audiowide', 'Orbitron', sans-serif",    weight: 400, ls: '.01em', caps: false },
  speech:  { label: 'Реплика',  css: "'Rajdhani', sans-serif",                 weight: 700, ls: '.01em', caps: false },
  term:    { label: 'Терминал', css: "'JetBrains Mono', monospace",            weight: 400, ls: '.08em', caps: true },
  italic:  { label: 'Курсив',   css: "'Exo 2', sans-serif",                    weight: 700, ls: '0',     caps: false, italic: true },
};
const ST_TEXT_MODES = { author: 'Пишет отправитель', fixed: 'Всегда один текст', name: 'Ник отправителя', none: 'Без подписи' };

const ST_CFG_DEF = {
  text: { on: true, mode: 'author', x: .06, y: .72, w: .88, size: .13, align: 'center',
          font: 'poster', color: '#ffffff', stroke: '#000000', rot: 0, caps: true, fixed: '' },
  flag: { on: true, x: .62, y: .62, w: .3, h: .3, rot: 0, fit: 'cover' },
};
function stCfg(cfg) {
  const c = (cfg && typeof cfg === 'object') ? cfg : {};
  return {
    text: { ...ST_CFG_DEF.text, ...(c.text || {}) },
    flag: { ...ST_CFG_DEF.flag, ...(c.flag || {}) },
  };
}
function stUrl(s) { return `${ST_DIR}/${encodeURIComponent(s.key)}.${encodeURIComponent(s.ext || 'webp')}`; }
function stNum(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function stPct(v) { return (stNum(v, 0) * 100).toFixed(3) + '%'; }
function stColor(v, d) { return /^#[0-9a-fA-F]{3,8}$/.test(String(v || '')) ? v : d; }

// Какую подпись показывать в этом конкретном отправлении.
function stText(cfg, opt) {
  const t = cfg.text;
  if (!t.on || t.mode === 'none') return '';
  if (t.mode === 'fixed') return String(t.fixed || '');
  if (t.mode === 'name') return String((opt && opt.name) || '');
  return String((opt && opt.text) || '');
}

// Собранный стикер. opt: {text, name, flag, size, box}
//   size — сторона в пикселях (лента 210, палитра 64, редактор — свой),
//   box  — true, если наружная обёртка уже задана снаружи (редактор).
function stHtml(s, opt) {
  const o = opt || {};
  const cfg = stCfg(s.cfg);
  const t = cfg.text, f = cfg.flag;
  const side = stNum(o.size, 210);
  const body = stText(cfg, o);
  const font = ST_FONTS[t.font] || ST_FONTS.poster;

  // Кегль — доля высоты стикера. Контур рисуем text-stroke с paint-order:
  // так буква остаётся читаемой на любом фоне, а тени по кругу (старый приём
  // из четырёх text-shadow) мылят края на мелком превью.
  const fs = (stNum(t.size, .13) * side).toFixed(2) + 'px';
  const txt = body ? `<span class="st-txt" style="
      left:${stPct(t.x)};top:${stPct(t.y)};width:${stPct(t.w)};
      font-family:${font.css};font-weight:${font.weight};letter-spacing:${font.ls};
      ${font.italic ? 'font-style:italic;' : ''}
      font-size:${fs};line-height:1.06;text-align:${t.align === 'left' || t.align === 'right' ? t.align : 'center'};
      color:${stColor(t.color, '#fff')};
      -webkit-text-stroke:${Math.max(1, side * .012).toFixed(2)}px ${stColor(t.stroke, '#000')};
      ${t.caps ?? font.caps ? 'text-transform:uppercase;' : ''}
      transform:rotate(${stNum(t.rot, 0)}deg);">${esc(body)}</span>` : '';

  // Окно под флаг: сначала подложка (чтобы прозрачный герб не висел в воздухе),
  // сверху сам флаг. Нет флага — окна не рисуем вовсе, дырки в стикере не надо.
  const flag = (f.on && o.flag) ? `<span class="st-flag" style="
      left:${stPct(f.x)};top:${stPct(f.y)};width:${stPct(f.w)};height:${stPct(f.h)};
      transform:rotate(${stNum(f.rot, 0)}deg);">
      <img src="${esc(o.flag)}" alt="" loading="lazy" style="object-fit:${f.fit === 'contain' ? 'contain' : 'cover'}">
    </span>` : '';

  const inner = `<img class="st-base" src="${esc(stUrl(s))}" alt="${esc(s.name || s.key)}" loading="lazy">${flag}${txt}`;
  if (o.box) return inner;
  return `<span class="st-wrap" style="width:${side}px;height:${side}px">${inner}</span>`;
}
