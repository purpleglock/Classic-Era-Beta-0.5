// © 2025–2026. Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// УРОВНИ УЧАСТНИКОВ — витрина. Считает ТОЛЬКО сервер (_member_levels.sql,
// rpc/ml_list); здесь лишь кэш и рисование: бейдж у имени, карточка на
// главной, досье в модалке. Ни одна цифра тут не вычисляется заново —
// иначе бейдж в комментариях и карточка на главной разойдутся.
// ════════════════════════════════════════════════════════════

const ML = { by: {}, list: [], loaded: false, loading: null, ts: 0 };

// Пять осей опыта: ключ в parts → как назвать и чем проиллюстрировать.
const ML_AXES = [
  ['tenure', 'СТАЖ',      '⏳', 1500],
  ['active', 'АКТИВНОСТЬ','◉',  1200],
  ['wiki',   'ВКЛАД',     '✍',  3000],
  ['game',   'ИГРА',      '⚔',  2500],
  ['ach',    'АЧИВКИ',    '★',  1200],
];

// Ступени титулов — только для окраски (сам титул приходит с сервера).
function mlTier(level) {
  const l = +level || 1;
  if (l >= 18) return 5;
  if (l >= 14) return 4;
  if (l >= 10) return 3;
  if (l >= 6)  return 2;
  if (l >= 3)  return 1;
  return 0;
}

// Витрину тянем один раз за сеанс; force — после действий, меняющих опыт.
async function mlLoad(force) {
  if (ML.loading) return ML.loading;
  if (ML.loaded && !force) return ML.list;
  ML.loading = (async () => {
    try {
      const rows = await apiFetch('rpc/ml_list', { method: 'POST', body: '{}' }) || [];
      ML.list = rows;
      ML.by = {};
      rows.forEach(r => { if (r.user_id) ML.by[r.user_id] = r; });
      ML.loaded = true; ML.ts = Date.now();
    } catch (e) {
      // Витрины может не быть (SQL не накатан) — молча живём без уровней.
      ML.loaded = true; ML.list = []; ML.by = {};
    } finally { ML.loading = null; }
    return ML.list;
  })();
  return ML.loading;
}

// key = user_id (uuid). Легаси-ключ по почте уровня не имеет: почта не публична.
function mlOf(key) { return (key && ML.by[key]) || null; }

// Доля пройденного пути до следующего уровня, 0..1
function mlProgress(row) {
  if (!row) return 0;
  const p = row.parts || {};
  const prev = +p.prev_xp || 0, next = +p.next_xp || 0;
  if (!next || next <= prev) return 1;
  return Math.max(0, Math.min(1, (row.xp - prev) / (next - prev)));
}

// Бейдж уровня у имени. size: 'sm' (в ленте/комментариях) | 'md'
function mlBadge(key, size) {
  const r = mlOf(key);
  if (!r) return '';
  const t = mlTier(r.level);
  return `<span class="ml-badge ml-t${t}${size === 'sm' ? ' ml-sm' : ''}" title="${esc(r.title)} · ${r.level} уровень · ${r.xp} опыта">${r.level}</span>`;
}

// Полоса опыта (карточка и досье)
function mlBarHtml(row, withText) {
  const pct = Math.round(mlProgress(row) * 100);
  const p = row.parts || {};
  return `<div class="ml-bar"><i style="width:${pct}%"></i></div>` +
    (withText ? `<div class="ml-bar-txt"><span>${row.xp} XP</span><span>${p.next_xp ? (row.level >= 30 ? 'МАКСИМУМ' : p.next_xp + ' → ' + (row.level + 1) + ' ур.') : ''}</span></div>` : '');
}

// Разбивка опыта по осям — сердце досье: видно, ЧЕМ набран уровень.
function mlAxesHtml(row) {
  const p = row.parts || {};
  return `<div class="ml-axes">${ML_AXES.map(([k, name, ico, cap]) => {
    const v = +p[k] || 0;
    const pct = Math.round(Math.min(100, (v / cap) * 100));
    return `<div class="ml-axis">
      <div class="ml-axis-hd"><span class="ml-axis-name">${ico} ${name}</span><span class="ml-axis-val">${v}</span></div>
      <div class="ml-axis-bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join('')}</div>`;
}

// Сухие цифры, из которых сложились оси
function mlFactsHtml(row) {
  const p = row.parts || {};
  const facts = [
    ['НА САЙТЕ', (row.days || 0) + ' сут'],
    ['АКТИВНЫХ ДНЕЙ', row.active_days || 0],
    ['СТРАНИЦ', (p.pub || 0) + (p.draft ? ' (+' + p.draft + ' черн.)' : '')],
    ['КОММЕНТАРИЕВ', p.comments || 0],
    ['ДЕПЕШ', p.news || 0],
    ['КОЛОНИЙ', p.colonies || 0],
    ['ИССЛЕДОВАНИЙ', p.research || 0],
    ['АЧИВОК', p.achs || 0],
    ['БОЁВ', (p.battles || 0) + (p.wins ? ' · ' + p.wins + ' побед' : '')],
  ];
  return `<div class="ml-facts">${facts.map(([k, v]) =>
    `<div class="ml-fact"><span class="ml-fact-k">${k}</span><span class="ml-fact-v">${esc(String(v))}</span></div>`).join('')}</div>`;
}

// Шапка досье: уровень, титул, полоса до следующего
function mlHeadHtml(row) {
  if (!row) return '';
  const t = mlTier(row.level);
  return `<div class="ml-head ml-t${t}">
    <div class="ml-head-lvl"><span class="ml-head-num">${row.level}</span><span class="ml-head-cap">УРОВЕНЬ</span></div>
    <div class="ml-head-body">
      <div class="ml-head-title">${esc(row.title)}</div>
      ${mlBarHtml(row, true)}
    </div>
  </div>`;
}

// Последний раз в сети — короткой строкой (timeAgo из core.js)
function mlSeenHtml(row) {
  if (!row || !row.last_seen) return '';
  return `<div class="ml-seen">◉ был в сети ${esc(typeof timeAgo === 'function' ? timeAgo(row.last_seen) : '')}</div>`;
}
