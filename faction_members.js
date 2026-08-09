// ════════════════════════════════════════════════════════════
// СОСТАВ ДЕРЖАВЫ И ПРАВА  (_faction_members.sql + _fm_gates.sql)
//
// Две роли игрока:
//   • владелец  — зарегистрировал державу, видит вкладку «👥 Двор»
//                 в кабинете: заявки, состав, права, зоны ответственности;
//   • служащий  — своей державы нет, подал заявку и принят. Играет тем же
//                 кабинетом, но сервер режет действия, на которые нет права.
//
// Клиент здесь — только удобство: истина о правах живёт в _fm_gate() на
// сервере, спрятать кнопку и разрешить действие — разные вещи.
// ════════════════════════════════════════════════════════════

const FM = {
  me: null,          // ответ fm_me(): own_fid / membership / perms / pending
  list: null,        // состав моей державы (для владельца)
  assets: null,      // системы/флоты/армии для закрепления
  draft: {},         // правки прав по id участника, до «Сохранить»
};

// Права: код → [иконка, название, пояснение]
const FM_PERMS = [
  ['build',    '🏗', 'Строительство',     'строить, сносить, переключать режимы шахт'],
  ['colonize', '🌍', 'Колонизация',       'колонии, станции, терраформинг, переименование'],
  ['produce',  '🏭', 'Производство',      'ставить технику в очередь, списывать, чинить'],
  ['design',   '⚙',  'Конструкторы',      'корабли, орудия, реакторы, сплавы'],
  ['research', '🔬', 'Наука',             'исследования, очередь, обмен технологиями'],
  ['corp',     '🏢', 'Корпорации',        'создавать, распускать, вписывать постройки'],
  ['market',   '📈', 'Рынок и биржа',     'купля-продажа, ордера, облигации, деривативы'],
  ['treasury', '🏛', 'Казна и курс',      'бюджет, экономический курс, займы, ставки'],
  ['trade',    '🚛', 'Торговля',          'маршруты, потоки ресурсов, концессии'],
  ['fleet',    '🚀', 'Флот',              'формировать, двигать, распускать, рейды'],
  ['army',     '🎖', 'Армии',             'формировать, двигать, распускать'],
  ['battle',   '⚔',  'Командование боем', 'расстановка, ход, огонь в тактическом бою'],
  ['strike',   '☢',  'Стратег. удар',     'МЗА, Длань, подпространство, ПРО'],
  ['defense',  '🛡', 'Оборона',           'мины, дроны, стражи, аванпосты, станции'],
  ['diplo',    '🤝', 'Дипломатия',        'союзы, вассалитет, границы, реакции'],
  ['war',      '🔥', 'Война',             'объявлять, вступать, заключать мир'],
  ['spy',      '🕵', 'Разведка',          'агенты, операции, пленные'],
  ['faith',    '🛐', 'Вера',              'основание, догматы, монументы'],
  ['news',     '📰', 'Депеши',            'объявления от имени державы'],
];
const FM_ROLES = [
  ['observer',     'Наблюдатель'],
  ['governor',     'Наместник'],
  ['admiral',      'Адмирал'],
  ['marshal',      'Маршал'],
  ['industrialist','Промышленник'],
  ['treasurer',    'Казначей'],
  ['diplomat',     'Дипломат'],
  ['spymaster',    'Глава разведки'],
  ['scientist',    'Учёный совет'],
  ['coruler',      'Соправитель'],
];
const FM_ROLE_PERMS = {
  observer: [], coruler: FM_PERMS.map(p => p[0]),
  governor: ['build','colonize','produce','corp','trade','defense'],
  admiral: ['fleet','battle','strike','produce','defense'],
  marshal: ['army','battle','produce'],
  industrialist: ['corp','design','produce','market','trade'],
  treasurer: ['treasury','market','trade'],
  diplomat: ['diplo','news','faith'],
  spymaster: ['spy'],
  scientist: ['research','design'],
};

async function fmRpc(fn, body) {
  const token = await getTokenFresh();
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const t = await r.text();
    let m = t; try { m = JSON.parse(t).message || t; } catch (e) {}
    throw new Error(m || ('HTTP ' + r.status));
  }
  return r.status === 204 ? null : r.json();
}

// Кто я сейчас: владелец / служащий / соискатель. Кэш на сессию, сбрасывается
// после любого действия с составом.
async function fmLoadMe(force) {
  if (!user) { FM.me = null; return null; }
  if (FM.me && !force) return FM.me;
  try { FM.me = await fmRpc('fm_me'); } catch (e) { FM.me = null; }
  return FM.me;
}
function fmReset() { FM.me = null; FM.list = null; FM.assets = null; FM.draft = {}; }
// Есть ли у меня право (для показа/скрытия кнопок; сервер проверяет сам).
function fmCan(code) {
  if (!FM.me) return true;                       // ещё не знаем — не мешаем
  if (FM.me.is_owner) return true;
  if (!FM.me.membership) return true;            // не служащий — обычный игрок
  return (FM.me.perms || []).includes(code);
}
function fmIsMember() { return !!(FM.me && FM.me.membership); }

// ════════════════════════════════════════════════════════════
// СТОРОНА ИГРОКА: поступить на службу, следить за заявкой, уйти
// ════════════════════════════════════════════════════════════

// Блок для страницы «Фракции». Возвращает HTML (пусто, если не при чём).
function fmServiceBlock(hasOwnApp) {
  if (!user || !FM.me) return '';
  const m = FM.me.membership, pend = FM.me.pending || [];
  if (m) {
    const perms = (FM.me.perms || []).map(c => {
      const p = FM_PERMS.find(x => x[0] === c); return p ? `${p[1]} ${p[2]}` : c;
    });
    const sc = m.scope || {};
    const scope = m.scope_all ? 'вся держава'
      : [ (sc.systems || []).length ? `систем: ${sc.systems.length}` : '',
          (sc.fleets  || []).length ? `флотов: ${sc.fleets.length}`  : '',
          (sc.armies  || []).length ? `армий: ${sc.armies.length}`   : '' ].filter(Boolean).join(' · ') || 'ничего не закреплено';
    return `<div class="fr-mine">
      <div class="fr-mine-hd">
        <span class="fr-status-badge" style="color:var(--ok);border-color:var(--ok)">НА СЛУЖБЕ</span>
        <span class="fr-mine-name">${esc(m.faction_name || m.faction_id)} — ${esc(m.role_title)}</span></div>
      <div class="fm-perm-line">${perms.length ? perms.map(t => `<span class="fm-chip">${esc(t)}</span>`).join('') : '<span class="fm-chip fm-chip-off">прав пока нет</span>'}</div>
      <div class="fm-scope-line">Зона ответственности: ${esc(scope)}</div>
      <div class="fr-actions">
        <button class="btn btn-gd btn-sm" onclick="go('economy')">Открыть кабинет державы</button>
        <button class="btn btn-gh btn-sm" onclick="fmLeave()">Выйти из состава</button>
      </div></div>`;
  }
  if (pend.length) {
    return `<div class="fr-mine">
      <div class="fr-mine-hd">
        <span class="fr-status-badge" style="color:var(--color-warning);border-color:var(--color-warning)">${pend.length > 1 ? 'ЗАЯВКИ ПОДАНЫ' : 'ЗАЯВКА ПОДАНА'}</span>
        <span class="fr-mine-name">${pend.map(p => esc(p.faction_name || p.faction_id)).join(', ')}</span></div>
      <div class="fm-scope-line">Ждём решения владельца державы. Пока решения нет, можно проситься и в другие.</div>
      <div class="fr-actions">
        ${pend.map(p => `<button class="btn btn-gh btn-sm" onclick="fmWithdraw('${p.id}')">Отозвать — ${esc(p.faction_name || p.faction_id)}</button>`).join('')}
        <button class="btn btn-gh btn-sm" onclick="fmOpenApply()">⚑ Ещё держава</button>
      </div>
    </div>`;
  }
  if (hasOwnApp || FM.me.is_owner) return '';
  return `<div class="fr-mine">
    <div class="fr-mine-hd"><span class="fr-mine-name">Служба в чужой державе</span></div>
    <div class="fm-scope-line">Не хотите вести своё государство — поступите на службу к другому игроку: он выдаст должность и права действовать от имени державы.</div>
    <div class="fr-actions"><button class="btn btn-gd btn-sm" onclick="fmOpenApply()">⚑ Поступить на службу</button></div>
  </div>`;
}

async function fmOpenApply() {
  const modal = fmModal();
  modal.innerHTML = `<div class="fr-modal"><div class="sload"><div class="pulse-loader"></div></div></div>`;
  modal.classList.add('show');
  let facs = [];
  try { facs = await fmRpc('fm_open_factions') || []; } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  const cards = facs.map(f => `<button type="button" class="fm-fac" onclick="fmApply('${esc(f.faction_id)}','${esc((f.name || '').replace(/'/g, "\\'"))}')">
      <span class="fm-fac-herald">${f.herald_url ? `<img src="${esc(f.herald_url)}">` : '◈'}</span>
      <span class="fm-fac-main"><b>${esc(f.name)}</b><i>${esc(f.gov || '')}${f.race ? ' · ' + esc(f.race) : ''}</i></span>
      <span class="fm-fac-n">👥 ${+f.members || 0}</span>
    </button>`).join('') || '<div class="fr-empty">Пока нет одобренных держав.</div>';
  modal.innerHTML = `<div class="fr-modal">
    <h2 style="margin:0 0 4px">Поступить на службу</h2>
    <p style="color:var(--t3);font-size:13px;margin:0 0 14px">Выберите державу. Владелец решит, принять ли вас и какие права выдать.</p>
    <div class="fm-fac-list">${cards}</div>
    <div class="fr-actions"><button class="btn btn-gh btn-sm" onclick="fmCloseModal()">Закрыть</button></div>
  </div>`;
}

async function fmApply(fid, name) {
  const note = prompt(`Заявка в державу «${name}». Пара слов о себе (увидит владелец):`, '');
  if (note === null) return;
  try {
    await fmRpc('fm_apply', { p_fid: fid, p_note: note });
    toast('Заявка отправлена', 'ok');
    fmCloseModal(); fmReset(); await fmLoadMe(true);
    if (typeof renderFactionsPage === 'function') renderFactionsPage();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

async function fmWithdraw(id) {
  if (!confirm('Отозвать заявку?')) return;
  try {
    await fmRpc('fm_withdraw', { p_id: id });
    toast('Заявка отозвана', 'ok');
    fmReset(); await fmLoadMe(true);
    if (typeof renderFactionsPage === 'function') renderFactionsPage();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

async function fmLeave() {
  if (!confirm('Выйти из состава державы? Все выданные права пропадут, кабинет станет недоступен.')) return;
  try {
    await fmRpc('fm_leave');
    toast('Вы больше не на службе', 'ok');
    fmReset(); await fmLoadMe(true);
    if (typeof EC === 'object') { EC.app = null; EC.myAppUid = null; }
    go('factions');
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

function fmModal() {
  return document.getElementById('fm-modal') || (() => {
    const m = document.createElement('div'); m.id = 'fm-modal'; m.className = 'fr-modal-ov';
    m.onclick = e => { if (e.target === m) fmCloseModal(); };
    document.body.appendChild(m); return m;
  })();
}
function fmCloseModal() { document.getElementById('fm-modal')?.classList.remove('show'); }

// ════════════════════════════════════════════════════════════
// СТОРОНА ВЛАДЕЛЬЦА: вкладка «👥 Двор» в кабинете
// ════════════════════════════════════════════════════════════
async function fmLoadCourt(force) {
  if (FM.list && !force) return;
  try {
    const [list, assets] = await Promise.all([fmRpc('fm_list'), fmRpc('fm_assets')]);
    FM.list = list || []; FM.assets = assets || { systems: [], fleets: [], armies: [] };
  } catch (e) { FM.list = []; FM.assets = { systems: [], fleets: [], armies: [] }; }
}

// Рабочая копия правки для участника (создаётся при первом касании).
function fmDraft(m) {
  if (!FM.draft[m.id]) {
    FM.draft[m.id] = {
      role: m.role || 'observer',
      perms: [...(m.perms || [])],
      scope_all: !!m.scope_all,
      scope: {
        systems: [...((m.scope || {}).systems || [])],
        fleets:  [...((m.scope || {}).fleets  || [])],
        armies:  [...((m.scope || {}).armies  || [])],
      },
    };
  }
  return FM.draft[m.id];
}
// Итоговые права = пресет роли ∪ ручные флаги (так же считает сервер).
function fmEffective(d) {
  return [...new Set([...(FM_ROLE_PERMS[d.role] || []), ...(d.perms || [])])];
}

function fmSetRole(id, role) { fmDraftOf(id).role = role; fmRenderCourt(); }
function fmTogglePerm(id, code) {
  const d = fmDraftOf(id);
  if ((FM_ROLE_PERMS[d.role] || []).includes(code)) {
    // право пришло из роли — снять его можно только сменой роли
    toast('Это право даёт роль. Смените роль или выберите «Наблюдатель» и наберите права вручную.', 'inf');
    return;
  }
  const i = d.perms.indexOf(code);
  if (i < 0) d.perms.push(code); else d.perms.splice(i, 1);
  fmRenderCourt();
}
function fmToggleScopeAll(id, on) { fmDraftOf(id).scope_all = on; fmRenderCourt(); }
function fmToggleScope(id, kind, val) {
  const arr = fmDraftOf(id).scope[kind];
  const i = arr.indexOf(val);
  if (i < 0) arr.push(val); else arr.splice(i, 1);
  fmRenderCourt();
}
function fmDraftOf(id) {
  const m = (FM.list || []).find(x => x.id === id);
  return fmDraft(m || { id, role: 'observer', perms: [], scope: {} });
}

async function fmSave(id) {
  const d = fmDraftOf(id);
  try {
    await fmRpc('fm_set', { p_id: id, p_role: d.role, p_perms: d.perms, p_scope_all: d.scope_all, p_scope: d.scope });
    toast('Права обновлены', 'ok');
    delete FM.draft[id]; await fmLoadCourt(true); fmRenderCourt();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
async function fmAccept(id) {
  const d = fmDraftOf(id);
  try {
    await fmRpc('fm_respond', { p_id: id, p_accept: true, p_role: d.role, p_perms: d.perms, p_scope_all: d.scope_all, p_scope: d.scope });
    toast('Игрок принят в державу', 'ok');
    delete FM.draft[id]; await fmLoadCourt(true); fmRenderCourt();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
async function fmReject(id) {
  if (!confirm('Отклонить заявку?')) return;
  try {
    await fmRpc('fm_respond', { p_id: id, p_accept: false });
    await fmLoadCourt(true); fmRenderCourt();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
async function fmKick(id) {
  if (!confirm('Исключить из состава державы? Игрок потеряет доступ к кабинету.')) return;
  try {
    await fmRpc('fm_kick', { p_id: id });
    toast('Исключён', 'ok');
    await fmLoadCourt(true); fmRenderCourt();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// ── Разметка вкладки ────────────────────────────────────────
function fmCourtHtml() {
  if (!FM.list) return `<div class="sload"><div class="pulse-loader"></div></div>`;
  const pend = FM.list.filter(m => m.status === 'pending');
  const act  = FM.list.filter(m => m.status === 'active');
  return `<div class="fm-court">
    <div class="fm-intro">Игроки без своей державы могут проситься к вам на службу. Принятый действует от имени державы ровно в тех пределах, которые вы ему очертите: роль задаёт набор прав, а зона ответственности — на какие системы, флоты и армии эти права распространяются.</div>
    ${pend.length ? `<h3 class="fm-h">Заявки <span>${pend.length}</span></h3>${pend.map(m => fmCardHtml(m, true)).join('')}` : ''}
    <h3 class="fm-h">Состав <span>${act.length}</span></h3>
    ${act.length ? act.map(m => fmCardHtml(m, false)).join('') : '<div class="fr-empty">Пока никто не служит вашей державе.</div>'}
  </div>`;
}

function fmCardHtml(m, isPending) {
  const d = fmDraft(m);
  const eff = fmEffective(d);
  const rolePerms = FM_ROLE_PERMS[d.role] || [];
  const dirty = !isPending && JSON.stringify({ r: m.role, p: [...(m.perms || [])].sort(), a: !!m.scope_all, s: m.scope || {} })
             !== JSON.stringify({ r: d.role, p: [...d.perms].sort(), a: d.scope_all, s: d.scope });

  const roleSel = `<select class="fm-sel" onchange="fmSetRole('${m.id}', this.value)">
    ${FM_ROLES.map(([v, t]) => `<option value="${v}"${d.role === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;

  const perms = FM_PERMS.map(([code, ico, title, hint]) => {
    const on = eff.includes(code), byRole = rolePerms.includes(code);
    return `<button type="button" class="fm-p${on ? ' on' : ''}${byRole ? ' role' : ''}" title="${esc(hint)}${byRole ? ' · даётся ролью' : ''}"
      onclick="fmTogglePerm('${m.id}','${code}')"><span>${ico}</span>${esc(title)}</button>`;
  }).join('');

  const needScope = eff.some(c => ['build','colonize','produce','defense','fleet','army'].includes(c));
  const box = (kind, label, items) => {
    const sel = d.scope[kind] || [];
    if (!items.length) return '';
    return `<div class="fm-scope-box"><b>${label}</b><div class="fm-scope-items">${items.map(o =>
      `<button type="button" class="fm-s${sel.includes(String(o.id)) ? ' on' : ''}" onclick="fmToggleScope('${m.id}','${kind}','${esc(String(o.id))}')">${esc(o.name || o.id)}</button>`).join('')}</div></div>`;
  };
  const A = FM.assets || { systems: [], fleets: [], armies: [] };
  const scopeUi = !needScope ? '' : `<div class="fm-scope">
      <label class="fm-all"><input type="checkbox"${d.scope_all ? ' checked' : ''} onchange="fmToggleScopeAll('${m.id}', this.checked)"> Вся держава — без привязки к объектам</label>
      ${d.scope_all ? '' : `${box('systems', 'Системы', A.systems || [])}${box('fleets', 'Флоты', A.fleets || [])}${box('armies', 'Армии', A.armies || [])}
        <div class="fm-scope-note">Пустой список = запрет: права на объекты сработают только там, где вы их закрепили.</div>`}
    </div>`;

  return `<div class="fm-card${isPending ? ' pend' : ''}">
    <div class="fm-card-hd">
      <span class="fm-ava">${m.avatar_url ? `<img src="${esc(m.avatar_url)}">` : '◈'}</span>
      <span class="fm-card-name">${esc(m.name || 'Игрок')}</span>
      ${isPending ? '<span class="fm-badge">заявка</span>' : `<span class="fm-badge ok">${esc(m.role_title)}</span>`}
      <span class="fm-sp"></span>${roleSel}
    </div>
    ${isPending && m.note ? `<div class="fm-note">«${esc(m.note)}»</div>` : ''}
    <div class="fm-perms">${perms}</div>
    ${scopeUi}
    <div class="fm-card-act">
      ${isPending
        ? `<button class="btn btn-gd btn-sm" onclick="fmAccept('${m.id}')">Принять на службу</button>
           <button class="btn btn-gh btn-sm" onclick="fmReject('${m.id}')">Отклонить</button>`
        : `<button class="btn btn-gd btn-sm"${dirty ? '' : ' disabled'} onclick="fmSave('${m.id}')">${dirty ? 'Сохранить изменения' : 'Изменений нет'}</button>
           <button class="btn btn-gh btn-sm" onclick="fmKick('${m.id}')">Исключить</button>`}
    </div>
  </div>`;
}

function fmRenderCourt() {
  const host = document.getElementById('fm-court-host');
  if (host) host.innerHTML = fmCourtHtml();
}
