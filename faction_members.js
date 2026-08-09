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
  office: null,      // ответ ch_office(): мой персонаж как должностное лицо
  council: null,     // совет державы: посты и их вклад в модификаторы
};

// Характеристики: ключ → [название, за что отвечает на посту]
const FM_STAT_RU = {
  str: ['Сила',       'Маршал'], dex: ['Ловкость', 'Адмирал'],
  con: ['Стойкость',  '—'],      int: ['Интеллект','Промышленник, Учёный совет'],
  wis: ['Мудрость',   'Наместник, Глава разведки'], cha: ['Харизма', 'Казначей, Дипломат'],
};
// Ключи модификаторов державы: [подпись, куда растёт польза, единица, множитель].
// good:-1 — выгода в минусе (это цена), good:+1 — выгода в плюсе.
// ⚠ Подписывать по ЖИВОМУ эффекту ключа, а не по его имени:
//   claim_* — это колонизация СИСТЕМЫ (economy_claim_system), не «притязания»;
//   agents_flat — уже не «агенты в сутки» (счётчик вытеснен ростером spy_agents),
//   а _spy_power = agents_flat × 5: п.п. к успеху операций и к защите от чужих.
const FM_MOD_RU = {
  gc:         ['Доход',                    1, '%'], mine:     ['Добыча',      1, '%'],
  build:      ['Цена стройки',            -1, '%'], research: ['Цена науки', -1, '%'],
  colonize:   ['Цена колонии',            -1, '%'],
  claim_cost: ['Цена колонизации системы',-1, '%'],
  claim_cd:   ['Откат колонизации системы',-1,'%'],
  sci_flat:   ['Наука',                    1, ' ОН/сут'],
  agents_flat:['Разведка: успех операций', 1, ' п.п.', 5],
};
// Боевой вклад штаба: врезается в паспорт борта (_char_office_war.sql).
const FM_WAR_RU = { tp: ['Секунды хода', 1, '%'], armor: ['Броня', 1, '%'] };

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
// Классы персонажей (для подписи в карточке состава; истина — CLASS_DEFS).
const FM_CLASS_RU = {
  soldier: 'Солдат', commander: 'Командир', pilot: 'Пилот', engineer: 'Инженер',
  agent: 'Агент', diplomat: 'Дипломат', hacker: 'Хакер',
};
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
      ${m.char_slug ? `<div class="fm-scope-line">Служит: <a href="#${esc(m.char_slug)}" onclick="go('${esc(m.char_slug)}');return false">персонаж</a></div>` : ''}
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
        <span class="fr-status-badge" style="color:var(--color-warning);border-color:var(--color-warning)">ЗАЯВКА ПОДАНА</span>
        <span class="fr-mine-name">${pend.map(p => esc(p.faction_name || p.faction_id)).join(', ')}</span></div>
      <div class="fm-scope-line">Ждём решения владельца державы. Служить можно только одной державе: чтобы проситься в другую, сначала отзовите эту заявку.</div>
      <div class="fr-actions">
        ${pend.map(p => `<button class="btn btn-gh btn-sm" onclick="fmWithdraw('${p.id}')">Отозвать заявку — ${esc(p.faction_name || p.faction_id)}</button>`).join('')}
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
  await fmLoadMe();
  if (FM.me && FM.me.membership) { toast('Вы уже служите державе — сначала выйдите из состава', 'err'); return; }
  if (FM.me && (FM.me.pending || []).length) { toast('Заявка уже подана. Служить можно только одной державе.', 'err'); return; }
  const modal = fmModal();
  modal.innerHTML = `<div class="fr-modal"><div class="sload"><div class="pulse-loader"></div></div></div>`;
  modal.classList.add('show');
  let facs = [];
  try { facs = await fmRpc('fm_open_factions') || []; } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  const cards = facs.map(f => `<button type="button" class="fm-fac" onclick="fmApply('${esc(f.faction_id)}','${esc((f.name || '').replace(/'/g, "\\'"))}','${esc((f.herald_url || '').replace(/'/g, "\\'"))}')">
      <span class="fm-fac-herald">${f.herald_url ? `<img src="${esc(f.herald_url)}">` : esc((f.name || '?').slice(0, 2).toUpperCase())}</span>
      <span class="fm-fac-main"><b>${esc(f.name)}</b><i>${esc(f.gov || '—')}${f.race ? ' · ' + esc(f.race) : ''}</i></span>
      <span class="fm-fac-n">👥 ${+f.members || 0}</span>
    </button>`).join('') || '<div class="fr-empty">Пока нет одобренных держав.</div>';
  modal.innerHTML = `<div class="fr-modal fm-svc">
    <h2 class="fm-svc-hd">Поступить на службу</h2>
    <p class="fm-svc-sub">Служить можно <b>только одной державе</b>. Выберите её — и заведите персонажа: именно он подаст прошение, а владелец решит, принять ли его и какие права выдать.</p>
    <div class="fm-fac-list">${cards}</div>
    <div class="fr-actions"><button class="btn btn-gh btn-sm" onclick="fmCloseModal()">Закрыть</button></div>
  </div>`;
}

// Заявка = досье персонажа. Своего персонажа ещё нет — поднимаем обычный
// мастер регистрации с приклеенной державой; есть — служит он же.
async function fmApply(fid, name, herald) {
  if (FM.me && FM.me.pending && FM.me.pending.length) {
    toast('Заявка уже подана. Служить можно только одной державе — сначала отзовите её.', 'err');
    return;
  }
  const mine = typeof myCharPage === 'function' ? myCharPage() : null;
  if (mine) {
    if (!confirm(`Подать заявку в державу «${name}» от лица персонажа «${mine.title_ru || mine.title}»?`)) return;
    return fmSendApply(fid, mine.slug, `${mine.title_ru || mine.title} — на службу державе «${name}».`);
  }
  fmCloseModal();
  toast('Сначала создайте персонажа: он и поступит на службу', 'inf');
  openCharRegister({
    faction: name,
    factionFlag: herald || '',
    lockFaction: true,
    title: 'ПОСТУПЛЕНИЕ НА СЛУЖБУ',
    onDone: async (ch) => {
      await fmSendApply(fid, ch.slug, `${ch.name} · ${ch.class_label}. ${ch.bio || ''}`.trim());
      go('factions');
    },
  });
}

async function fmSendApply(fid, charSlug, note) {
  try {
    await fmRpc('fm_apply', { p_fid: fid, p_note: (note || '').slice(0, 1000), p_char: charSlug || null });
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
  await fmLoadOffice(force);
}

// ── Совет державы и моя должность ───────────────────────────
// ch_office отдаёт разом и персонажа (уровень/очки), и совет державы.
async function fmLoadOffice(force) {
  if (FM.office && !force) return FM.office;
  try { FM.office = await fmRpc('ch_office') || {}; } catch (e) { FM.office = {}; }
  FM.council = (FM.office && FM.office.council) || { posts: [], mods: {} };
  if (typeof EC !== 'undefined') EC.council = FM.council;   // зеркало для расчёта дохода
  return FM.office;
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

// ── Совет державы: должность → характеристика → цифра ───────
// Значение поста считает сервер (_fm_council), клиент только показывает.
function fmModStr(key, val, dict) {
  const d = (dict || FM_MOD_RU)[key]; if (!d || !val) return '';
  const flat = key.endsWith('_flat');
  const v    = val * (d[3] || 1);
  const num  = flat ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 10;
  if (!num) return '';
  const good = (num > 0 ? 1 : -1) === d[1];
  return `<span class="fm-mod ${good ? 'up' : 'down'}">${num > 0 ? '+' : ''}${num}${d[2]} ${d[0]}</span>`;
}

function fmCouncilHtml() {
  const c = FM.council; if (!c) return '';
  const posts = c.posts || [], mods = c.mods || {}, war = c.war || {};
  const total = Object.keys(FM_MOD_RU).map(k => fmModStr(k, mods[k])).filter(Boolean).join('')
              + Object.keys(FM_WAR_RU).map(k => fmModStr(k, war[k], FM_WAR_RU)).filter(Boolean).join('');
  const rows = posts.map(p => {
    const gain = Object.keys(FM_MOD_RU).map(k => fmModStr(k, (p.mods || {})[k])).filter(Boolean).join('')
              + Object.keys(FM_WAR_RU).map(k => fmModStr(k, (p.war || {})[k], FM_WAR_RU)).filter(Boolean).join('')
              || '<span class="fm-mod flat">ничего не даёт: характеристика ниже 12</span>';
    const cov = p.coverage < 1 ? `<span class="fm-chip fm-chip-off">зона ${Math.round(p.coverage * 100)}%</span>` : '';
    return `<div class="fm-post${p.head ? ' head' : ''}">
      <div class="fm-post-hd">
        <span class="fm-post-title">${esc(p.title)}</span>
        <span class="fm-post-who">${p.char_slug
          ? `<a href="#${esc(p.char_slug)}" onclick="go('${esc(p.char_slug)}');return false">${esc(p.char_name || '—')}</a>`
          : '—'}</span>
        ${p.head ? '<span class="fm-chip fm-chip-off">вакансия · глава вполсилы</span>' : ''}
        <span class="fm-sp"></span>
        <span class="fm-chip">ур. ${p.lvl}</span>
        <span class="fm-chip">${esc((FM_STAT_RU[p.stat] || [p.stat])[0])} ${p.stat_val}</span>${cov}
      </div>
      <div class="fm-post-gain">${gain}</div></div>`;
  }).join('');
  return `<div class="fm-council">
    <h3 class="fm-h">Совет державы</h3>
    <div class="fm-intro">Должность в составе — это место в совете. Профильная характеристика того, кто её занимает, идёт слагаемым в экономику державы: доход, добычу, цену стройки и науки. Территориальные посты считаются по охвату зоны ответственности — не закрепили систем, не будет и вклада. Адмирал и Маршал в бухгалтерию не лезут: их характеристики врезаются в паспорт борта — секунды хода и броня. Вакансии закрывает сам правитель, но вполсилы.</div>
    ${posts.length ? rows : '<div class="fr-empty">Совета нет: ни у вас, ни у служащих нет действующего персонажа.</div>'}
    ${total ? `<div class="fm-council-total"><b>Итог совета:</b> ${total}</div>` : ''}
  </div>`;
}

// ── Моя должность: уровень, опыт, вложение очков ────────────
function fmOfficeHtml() {
  const o = FM.office; if (!o || o.anon) return '';
  const ch = o.character;
  if (!ch) return `<div class="fm-office"><h3 class="fm-h">Моя должность</h3>
    <div class="fm-intro">У вас нет действующего персонажа — в совете вы никого не представляете и опыт не капает. Заведите персонажа, и его характеристики начнут работать на державу.</div></div>`;
  const prev = 20 * Math.pow(ch.lvl - 1, 2), pct = ch.lvl >= 20 ? 100
    : Math.max(0, Math.min(100, Math.round((ch.xp - prev) / Math.max(1, ch.next_xp - prev) * 100)));
  const stats = Object.keys(FM_STAT_RU).map(k => {
    const v = (ch.stats || {})[k] || 10, mod = Math.floor((v - 10) / 2);
    const can = ch.points > 0 && v < 20;
    return `<div class="fm-stat">
      <span class="fm-stat-k" title="${esc(FM_STAT_RU[k][1])}">${esc(FM_STAT_RU[k][0])}</span>
      <span class="fm-stat-v">${v}</span>
      <span class="fm-stat-m">${mod >= 0 ? '+' : ''}${mod}</span>
      <button class="fm-stat-add" ${can ? '' : 'disabled'} onclick="chSpend('${k}')">+</button></div>`;
  }).join('');
  return `<div class="fm-office">
    <h3 class="fm-h">Моя должность</h3>
    <div class="fm-office-hd">
      <a href="#${esc(ch.slug)}" onclick="go('${esc(ch.slug)}');return false">${esc(ch.name)}</a>
      <span class="fm-badge ok">${o.is_head ? 'Глава государства' : esc((FM.me && FM.me.membership && FM.me.membership.role_title) || 'на службе')}</span>
      <span class="fm-sp"></span><span class="fm-chip">уровень ${ch.lvl}</span>
    </div>
    <div class="fm-xp"><div class="fm-xp-fill" style="width:${pct}%"></div></div>
    <div class="fm-scope-line">${ch.lvl >= 20 ? 'Потолок уровня' : `${ch.xp} / ${ch.next_xp} опыта`} · сегодня заработано ${ch.today_xp} из 150 · опыт даёт работа от имени державы, а не время в игре</div>
    <div class="fm-stats">${stats}</div>
    <div class="fm-scope-line">${ch.points > 0
      ? `Свободных очков: <b>${ch.points}</b> — вложите в характеристику, и совет сразу станет считать по-новому.`
      : 'Свободных очков нет: следующее придёт с уровнем.'}</div>
  </div>`;
}

async function chSpend(stat) {
  try {
    FM.office = await fmRpc('ch_spend', { p_stat: stat });
    FM.council = FM.office.council || FM.council;
    if (typeof EC !== 'undefined') EC.council = FM.council;
    toast('Очко вложено', 'ok'); fmRenderCourt();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// ── Разметка вкладки ────────────────────────────────────────
function fmCourtHtml() {
  if (!FM.list) return `<div class="sload"><div class="pulse-loader"></div></div>`;
  const pend = FM.list.filter(m => m.status === 'pending');
  const act  = FM.list.filter(m => m.status === 'active');
  const head = fmOfficeHtml() + fmCouncilHtml();
  if (!FM.me || !FM.me.is_owner) return `<div class="fm-court">${head}</div>`;
  return `<div class="fm-court">
    ${head}
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
      <span class="fm-card-name">${m.char_slug
        ? `<a href="#${esc(m.char_slug)}" onclick="go('${esc(m.char_slug)}');return false">${esc(m.char_name || m.name || 'Игрок')}</a>`
        : esc(m.name || 'Игрок')}</span>
      ${m.char_class ? `<span class="fm-badge">${esc(FM_CLASS_RU[m.char_class] || m.char_class)}</span>` : ''}
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
