// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// ECONOMY — экономический слой (колонизация · застройка · доход)
// Данные: Supabase (faction_economy / colonies / colony_buildings),
//         RPC economy_init / economy_tick (см. _economy_setup.sql).
// Доступ: одобренная анкета государства ИЛИ superadmin/editor.
// Зависит от: core.js (dbGet/dbPost/dbPatch/dbDel, SB_URL/SB_ANON, getTokenFresh, esc, toast, setPg, go),
//             auth.js (user), faction_reg.js (frReadable)
// ════════════════════════════════════════════════════════════

const EC = { app: null, myAppUid: null, fid: null, eco: null, colonies: [], buildings: [], systems: [], designs: [], roster: [], queue: [], projects: [], allSystems: [], lanes: [], factions: [], routes: [], loans: [], missions: [], dossiers: [], alerts: [], passive: {}, tab: 'overview', busy: false, openColony: null, openSys: null, spyTarget: null, spyOp: 'recon_basic', spyAgents: 1 };
const EC_CLAIM_COST = 3000, EC_CLAIM_CD_DAYS = 4;
// ── ТАЙНЫЕ ОПЕРАЦИИ — каталог (зеркало spy_launch/ spy_resolve в SQL) ──
// diff — сложность; base — базовая длительность (ходов); need — нужная разведка
// ('','basic','deep'); recon — это разведка (даёт досье).
const EC_SPY_OPS = {
  recon_basic:   { label: 'Разведка (базовая)',  diff: 0,  base: 1, need: '',      recon: 'basic', icon: '🔍', desc: 'Экономика цели: ГС, наука, агенты, колонии.' },
  recon_deep:    { label: 'Глубокая разведка',   diff: 15, base: 2, need: '',      recon: 'deep',  icon: '🛰', desc: 'Постройки, флот, армия, изученные технологии. Открывает сложные операции.' },
  steal_gc:      { label: 'Кража казны',         diff: 25, base: 2, need: 'basic', icon: '💰', desc: 'Похитить часть ГС цели (до 30%, растёт с числом агентов).' },
  steal_res:     { label: 'Кража ресурсов',      diff: 28, base: 2, need: 'basic', icon: '📦', desc: 'Похитить сырьё со складов цели (до 25%, растёт с числом агентов). Инфильтратор усиливает.' },
  sabotage:      { label: 'Саботаж постройки',   diff: 30, base: 2, need: 'deep',  icon: '💥', desc: 'Вывести из строя одно здание цели.' },
  destabilize:   { label: 'Дестабилизация',      diff: 35, base: 3, need: 'basic', icon: '🔥', desc: 'Снизить ГС-доход цели на несколько ходов.' },
  kill_agent:    { label: 'Ликвидация агента',   diff: 38, base: 2, need: 'basic', icon: '🗡', desc: 'Устранить одного готового агента цели. Призрак повышает шанс успеха.' },
  steal_tech:    { label: 'Кража технологий',    diff: 45, base: 4, need: 'deep',  icon: '🧪', desc: 'Украсть технологию (мин. 2 агента). Добавится в ваше дерево.' },
  mass_demolish: { label: 'Массовый снос',       diff: 45, base: 3, need: 'deep',  minAgents: 2, icon: '🏚', desc: 'Уничтожить сразу N зданий цели (N = число агентов, max 5). Мин. 2 агента. Саботёр усиливает.' },
  faith_impose:  { label: 'Тайная секта',        diff: 28, base: 3, need: 'basic', icon: '🛐', desc: 'Внедрить тайную секту вашей веры в чужую державу. Работает как храм (доход и сила — вам), пока контрразведка цели её не вскроет. Нужна исповедуемая вера.' },
  subspace_hunt: { label: 'Подпространственная охота', diff: 40, base: 2, need: '', tactical: true, icon: '🛰', desc: 'Вскрыть скрытые гиперкрейсера цели — при успехе они подсветятся на карте на 2 суток (крит — 4). Иначе их не видно ни с разведкой, ни без.' },
  fleet_sabotage:{ label: 'Диверсия против флота', diff: 34, base: 2, need: '', tactical: true, targetFleet: true, icon: '⚙', desc: 'Подрыв вражеского флота. По степени успеха: крит → выводит из строя часть кораблей состава; обычный успех → обездвиживает флот на сутки. Сопротивление — «защита ВС» цели.' },
  outpost_strike:{ label: 'Подрыв аванпоста', diff: 32, base: 2, need: '', tactical: true, icon: '💣', desc: 'Диверсанты уничтожают развёрнутый аванпост цели. Крит — добивает корабль-носитель в той же системе. Сопротивление — «защита ВС» цели. Разведка не нужна.' },
};
const EC_SPY_ORDER = ['recon_basic', 'recon_deep', 'steal_gc', 'steal_res', 'sabotage', 'destabilize', 'kill_agent', 'steal_tech', 'mass_demolish', 'faith_impose', 'subspace_hunt', 'fleet_sabotage', 'outpost_strike'];
// Перки агентов (зеркало _spy_agents6.sql). Перк-бонус РАСТЁТ с уровнем агента (+2/ур.).
const EC_SPY_PERKS = {
  infiltrator: { label: 'Инфильтратор', icon: '🕵', desc: '+12% успех краж (казна, технологии, ресурсы). С уровнем — больше.' },
  saboteur:    { label: 'Диверсант',    icon: '💣', desc: '+12% успех саботажа, дестабилизации и массового сноса. С уровнем — больше.' },
  ghost:       { label: 'Призрак',      icon: '👻', desc: '−10% риск раскрытия любой операции; +успех ликвидации агентов. С уровнем — больше.' },
  analyst:     { label: 'Аналитик',     icon: '📊', desc: '+10% успех разведки, досье качественнее. С уровнем — больше.' },
  handler:     { label: 'Куратор',      icon: '🛡', desc: 'Пассивно усиливает контрразведку и ускоряет расследования.' },
};
function ecPerk(p) { return EC_SPY_PERKS[p] || { label: p || '—', icon: '•', desc: '' }; }
// Перк-бонус успеха с учётом уровня (зеркало SQL _spy_perk_succ)
function ecPerkSucc(perk, op, level) {
  const lv = Math.max(1, level || 1);
  if (perk === 'infiltrator' && (op === 'steal_gc' || op === 'steal_tech' || op === 'steal_res')) return 12 + (lv - 1) * 2;
  if (perk === 'saboteur' && (op === 'sabotage' || op === 'destabilize' || op === 'mass_demolish')) return 12 + (lv - 1) * 2;
  if (perk === 'analyst' && (op === 'recon_basic' || op === 'recon_deep')) return 10 + (lv - 1) * 2;
  if (perk === 'ghost' && op === 'kill_agent') return 8 + (lv - 1) * 2;
  return 0;
}
// Уровни агентов (зеркало _spy_level / _spy_xp_floor): пороги XP 0/100/300/600/1000.
function ecSpyLevelFloor(level) { return [0, 0, 100, 300, 600, 1000][Math.max(1, Math.min(5, level || 1))]; }
function ecSpyTrain(id) {
  if (ecSpyFree() <= 0) { toast('Нет свободных агентов — все в контрразведке. Снимите кого-то с защиты (блок «🛡 Контрразведка»).', 'err'); return; }
  ecRpcAct('spy_train', { p_agent_ids: [id] }, 'Агент отправлен на тайное обучение (2 ход.)');
}
// Плен (срез 7): действия жертвы над пленником и владельца по выкупу
function ecCaptiveExecute(id, name) { if (confirm(`Казнить пленника «${name}»? Владелец затаит обиду (−отношения, casus belli).`)) ecRpcAct('spy_captive_execute', { p_id: id }, 'Пленник казнён'); }
function ecCaptiveReturn(id, name) { if (confirm(`Вернуть «${name}» владельцу даром? Жест доброй воли (+отношения).`)) ecRpcAct('spy_captive_return', { p_id: id }, 'Агент возвращён владельцу'); }
function ecCaptiveRecruit(id, name) { if (confirm(`Завербовать «${name}» в двойные агенты за 400 ГС? Он перейдёт в ваш ростер (нужен свободный слот).`)) ecRpcAct('spy_captive_recruit', { p_id: id }, 'Пленник перевербован'); }
function ecCaptiveRansom(id, name) {
  const v = prompt(`Запросить выкуп за «${name}» (ГС):`, '500');
  if (v == null) return;
  const price = Math.max(1, parseInt(v) || 0);
  ecRpcAct('spy_captive_ransom', { p_id: id, p_price_gc: price }, `Выкуп за «${name}» выставлен (${ecNum(price)} ГС)`);
}
function ecRansomAccept(id, price) { if (confirm(`Уплатить ${ecNum(price)} ГС и вернуть своего агента?`)) ecRpcAct('spy_ransom_accept', { p_id: id }, 'Выкуп уплачен, агент возвращён'); }
function ecRansomDecline(id) { ecRpcAct('spy_ransom_decline', { p_id: id }, 'Выкуп отклонён'); }
// Артефакты (срез 8, зеркало _spy_agents8.sql): экип-предметы, 2 слота на агента
const EC_SPY_ARTS = {
  masterkey: { icon: '🗝', label: 'Мастер-ключ', desc: '+8% успех краж (казна, технологии, ресурсы).' },
  charge:    { icon: '🧨', label: 'Заряд-фантом', desc: '+8% успех саботажа, дестабилизации и сноса.' },
  scanner:   { icon: '📡', label: 'Сканер-имплант', desc: '+10% успех разведки.' },
  blade:     { icon: '🔪', label: 'Моно-клинок', desc: '+12% успех ликвидации агентов.' },
  neurochip: { icon: '🧬', label: 'Нейро-чип', desc: '+5% успех любой операции.' },
  jammer:    { icon: '🛰', label: 'Глушилка', desc: '+4% успех и −6% раскрытие.' },
  mask:      { icon: '🎭', label: 'Маска-морф', desc: '−10% раскрытие.' },
  sim:       { icon: '📚', label: 'Симулятор', desc: '+50% получаемого опыта.' },
};
function ecArt(k) { return EC_SPY_ARTS[k] || { icon: '🎁', label: k || '—', desc: '' }; }
function ecArtSucc(kind, op) {
  if (kind === 'masterkey' && (op === 'steal_gc' || op === 'steal_tech' || op === 'steal_res')) return 8;
  if (kind === 'charge' && (op === 'sabotage' || op === 'destabilize' || op === 'mass_demolish')) return 8;
  if (kind === 'scanner' && (op === 'recon_basic' || op === 'recon_deep')) return 10;
  if (kind === 'blade' && op === 'kill_agent') return 12;
  if (kind === 'neurochip') return 5;
  if (kind === 'jammer') return 4;
  return 0;
}
function ecArtDet(kind) { return kind === 'mask' ? 10 : kind === 'jammer' ? 6 : 0; }
function ecArtifactEquip(artId, agentId) { ecRpcAct('spy_artifact_equip', { p_artifact_id: artId, p_agent_id: agentId }, 'Артефакт экипирован'); }
function ecArtifactUnequip(artId) { ecRpcAct('spy_artifact_unequip', { p_artifact_id: artId }, 'Артефакт снят'); }
// Краткий флавор-атрибуты агента (раса · пол · репликация)
function ecAgentAttr(a) {
  const parts = [a.race, a.gender, a.replication && a.replication !== 'Оригинал' ? a.replication : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
}
async function ecSpyHire(id) {
  // ЛЁГКИЙ найм: не гоняем полный ecReloadPaint (≈40 RPC + перерисовка всего
  // кабинета под открытым окном — давало «мигание окон»). Достаточно обновить
  // агентуру одним запросом и перерисовать вкладку из памяти.
  if (EC.busy) return; EC.busy = true;
  try {
    await ecRpc('spy_hire', { p_recruit_id: id });
    // списываем стоимость локально (шапка казны), пока не пришёл свежий ростер
    const rec = ((EC.spyAgency && EC.spyAgency.recruits) || []).find(r => r.id === id);
    if (rec && EC.eco) EC.eco.gc = Math.max(0, (EC.eco.gc || 0) - (rec.cost || 0));
    toast('Агент нанят', 'ok');
    const ag = await ecRpc('spy_recruits_list').catch(() => null);
    if (ag) { EC.spyAgency = ag; EC.spyCounter = ag.counterintel || EC.spyCounter; }
    ecPaintCabinet();   // перерисовка текущей вкладки из EC — без сетевого релоада/лоадера
    if (document.getElementById('ec-recruits-host')) ecRecruitsRender();   // окно открыто — обновить список рекрутов
  } catch (e) { toast(ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}
function ecSpyFire(id) { if (confirm('Уволить агента?')) ecRpcAct('spy_agent_fire', { p_id: id }, 'Агент уволен'); }
// Сила спецслужб от доктрины (связь с agents_flat): +5% за пункт.
function ecSpyPower(app) { return (ecFactionMods(app).agents_flat || 0) * 5; }
// Свежие разведданные по цели: вернуть {level:'basic'|'deep'|null, ageDays, bonus}.
function ecSpyDossier(targetFid) {
  const recs = (EC.dossiers || []).filter(m => m.target_fid === targetFid && m.outcome === 'success' && (m.op === 'recon_basic' || m.op === 'recon_deep'));
  if (!recs.length) return { level: null, ageDays: Infinity, bonus: 0, result: null, deep: false };
  const deep = recs.find(m => m.op === 'recon_deep');
  const latest = recs[0]; // dossiers отсортированы desc по created_at
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(latest.ready_at || latest.created_at).getTime()) / 86400000));
  const base = deep ? 20 : 10;
  const bonus = Math.max(0, base - ageDays); // затухает со временем
  return { level: deep ? 'deep' : 'basic', ageDays, bonus, result: (deep || latest).result || {}, deep: !!deep };
}
// ── Пассивная разведка: размытый срез по союзникам/торг.партнёрам/друзьям ──
// Источник интел даётся СЕРВЕРОМ (passive_intel_all), клиент только рисует.
function ecPassiveIntel(fid) { return (EC.passive || {})[fid] || null; }
const EC_PI_SOURCE = {
  ally:      { ic: '🤝', label: 'союзник',           hint: 'Союз / вассалитет — самый подробный пассивный срез (≈ значения).' },
  trade:     { ic: '🚢', label: 'торговый путь',      hint: 'Торговые караваны приносят слухи о партнёре.' },
  relations: { ic: '💬', label: 'хорошие отношения',  hint: 'Дипломатические каналы при тёплых отношениях (балл ≥ 40).' },
};
// Цвет вердикта сравнения сил: их превосходство = тревога, их отставание = в нашу пользу.
function ecPiCmpColor(v) {
  if (/значительно опережает/.test(v)) return 'var(--color-warning,#e0a030)';
  if (/опережает/.test(v))             return 'var(--te,#e08a8a)';
  if (/значительно отстаёт/.test(v))   return 'var(--ok,#7bd88f)';
  if (/отстаёт/.test(v))               return 'var(--ok,#7bd88f)';
  return 'var(--t3,#9fb0c8)';
}
// Карточка пассивной разведки по фракции fid (или '' если данных нет).
function ecPassiveIntelCard(fid) {
  const p = ecPassiveIntel(fid); if (!p) return '';
  const src = EC_PI_SOURCE[p.source] || EC_PI_SOURCE.relations;
  const e = p.enterprises || { civ_pct: 0, mil_pct: 0, faith_pct: 0, total: '—' };
  const f = p.forces || {};
  const fl = p.fleet || {};
  const cmpRow = (k, v) => `<div class="ec-res" style="align-items:baseline"><span class="ec-res-k">${k}</span><span class="ec-res-v" style="font-size:13px;color:${ecPiCmpColor(v || '')}">${esc(v || '—')}</span></div>`;
  const barSeg = (pct, color, title) => +pct > 0 ? `<div title="${title}: ${pct}%" style="width:${pct}%;background:${color}"></div>` : '';
  return `<div class="ec-dip-card" style="border-color:rgba(120,160,220,.25)">
    <div class="ec-dip-t">🛰 Пассивная разведка <span class="ec-hint" title="${esc(src.hint)}">${src.ic} ${esc(src.label)}</span></div>
    <div class="cn-fac-hint" style="margin:0 0 8px">Приблизительные данные без агентов. Для точных цифр и операций нужна активная разведка ниже.</div>
    <div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:8px">
      <div class="ec-res"><span class="ec-res-k">🚀 Флот (кораблей)</span><span class="ec-res-v" style="font-size:14px">${esc(fl.ships || '—')}</span></div>
      <div class="ec-res"><span class="ec-res-k">🪖 Наземка / авиация</span><span class="ec-res-v" style="font-size:14px">${esc(fl.ground || '—')}</span></div>
      <div class="ec-res"><span class="ec-res-k">💰 Доход</span><span class="ec-res-v" style="font-size:14px">${esc(p.income || '—')}</span></div>
      <div class="ec-res"><span class="ec-res-k">🏭 Предприятий</span><span class="ec-res-v" style="font-size:14px">${esc(e.total || '—')}</span></div>
    </div>
    <div class="ec-res-k" style="margin-bottom:4px">Распределение предприятий</div>
    <div style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.06);margin-bottom:4px">
      ${barSeg(e.civ_pct, 'var(--bl,#5a9bd4)', 'Гражданские')}${barSeg(e.mil_pct, 'var(--te,#e08a8a)', 'Военные')}${barSeg(e.faith_pct, 'var(--pu,#b07bd8)', 'Культовые')}
    </div>
    <div class="ec-hint" style="margin-bottom:8px">🔵 гражданские ${e.civ_pct || 0}% · 🔴 военные ${e.mil_pct || 0}% · 🟣 культовые ${e.faith_pct || 0}%</div>
    <div class="ec-res-k" style="margin-bottom:4px">Соотношение сил (их уровень против вашего)</div>
    <div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      ${cmpRow('🔬 Наука', f.science)}${cmpRow('⚙ Военпром', f.mil_industry)}${cmpRow('⚔ Армия', f.army)}
    </div>
  </div>`;
}
// Агентура — из ростера (этап 2): операции на именованных агентах, не на пуле.
function ecSpyRoster() { return (EC.spyAgency && EC.spyAgency.roster) || []; }
function ecSpyReadyAgents() { return ecSpyRoster().filter(a => a.status === 'ready'); }     // обучены и не заняты
function ecSpyCommitted() { return ecSpyRoster().filter(a => a.status === 'busy').length; }  // на операциях
function ecSpyTraining() { return ecSpyRoster().filter(a => a.status === 'training').length; }
function ecSpyFree() { return Math.max(0, ecSpyReadyAgents().length - (EC.eco.counter_agents || 0)); }
// Колонии цели из последней УСПЕШНОЙ разведки (для выбора цели саботажа) — этап 3.
function ecSpyColonyOptions(targetFid) {
  const dos = ecSpyDossier(targetFid);
  return (dos && dos.result && Array.isArray(dos.result.colony_list)) ? dos.result.colony_list : [];
}
// Контрразведка цели (видна только если есть глубокая разведка; иначе считаем 0 для превью).
function ecSpyTargetCI(targetFid) { const f = (EC.factions || []).find(x => x.faction_id === targetFid); return (f && +f.counter_agents) || 0; }
// Сила контрразведки цели от её доктрины (нужна анкета цели — приблизительно 0, точный расчёт на сервере).
// ── Раса агента ↔ раса цели: «вживание» в чужое общество (зеркало SQL _spy_race_*) ──
// Класс «субстрата»: 1 органик-позвоночные, 2 органик-экзотика, 3 камень, 4 машины, 5 энергия.
function ecRaceClass(r) {
  switch (r) {
    case 'Гуманоиды': case 'Млекопитающие': case 'Рептилоиды': case 'Авианы (Птицеподобные)': return 1;
    case 'Инсектоиды': case 'Акватики (Водные)': case 'Плантоиды (Растениевидные)': return 2;
    case 'Литоиды (Каменные)': return 3;
    case 'Синтетики / Киборги': return 4;
    case 'Энергетические сущности': return 5;
    default: return 0;
  }
}
// Штраф к успеху (положительный = тяжелее). Свой среди своих = бонус (−5).
function ecRacePenalty(agentRace, targetRace) {
  if (!agentRace || !targetRace) return 0;
  if (agentRace === targetRace) return -5;
  const ca = ecRaceClass(agentRace), ct = ecRaceClass(targetRace);
  if (!ca || !ct) return 0;
  if (ca === ct) return 8;                          // разные виды одного субстрата
  if (ca <= 2 && ct <= 2) return 18;                // органик ↔ органик
  if (ca <= 2 || ct <= 2) return 32;                // органик ↔ камень/машина/энергия — почти невозможно
  return 28;                                         // камень/машина/энергия между собой
}
// Раса цели для превью (из реестра фракций; race добавлен в select).
function ecFacRace(fid) { const f = (EC.factions || []).find(x => x.faction_id === fid); return (f && f.race) || null; }

// Живой расчёт операции: успех/раскрытие/длительность (зеркало spy_launch).
// agentIds — массив id выбранных агентов (перки баффают). Для превью (lock-check) можно [].
function ecSpyCalc(op, agentIds, targetFid) {
  const d = EC_SPY_OPS[op]; if (!d) return null;
  const ids = Array.isArray(agentIds) ? agentIds : [];
  const picked = ecSpyRoster().filter(a => ids.includes(a.id));
  const A = Math.max(1, picked.length);
  const dos = ecSpyDossier(targetFid);
  const CI = ecSpyTargetCI(targetFid);
  const intel = d.recon ? 0 : dos.bonus;
  const spyPow = ecSpyPower();
  // перк-бонусы + бонусы уровня выбранных агентов (зеркало spy_launch / _spy_perk_succ)
  let succB = 0, detB = 0;
  picked.forEach(a => {
    const lv = Math.max(1, a.level || 1);
    succB += ecPerkSucc(a.perk, op, lv) + ecPerkSucc(a.perk2, op, lv) + (lv - 1) * 3;
    detB += ((a.perk === 'ghost' || a.perk2 === 'ghost') ? 10 + (lv - 1) * 2 : 0) + (lv - 1) * 2;
    (a.arts || []).forEach(k => { succB += ecArtSucc(k, op); detB += ecArtDet(k); });   // бонусы артефактов
  });
  // «Вживание» по расе: средний штраф выбранных агентов против расы цели.
  // Разведка (recon) — наблюдение со стороны, штраф вполовину.
  const tRace = ecFacRace(targetFid);
  let racePen = 0;
  if (picked.length && tRace) {
    racePen = picked.reduce((s, a) => s + ecRacePenalty(a.race, tRace), 0) / picked.length;
    if (d.recon) racePen *= 0.5;
  }
  const raceMod = Math.round(racePen);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  const success = clamp(45 + A * 8 + intel + spyPow - d.diff - CI * 9 + succB - raceMod, 5, 95);
  const detect = clamp(8 + d.diff * 0.5 + CI * 12 + A * 2 - spyPow - detB, 2, 90);
  const turns = Math.max(1, Math.min(2, Math.ceil(d.base / Math.sqrt(A))));   // 1–2 цикла
  // требование разведки
  let err = '';
  if (op === 'faith_impose' && !(EC.faith && EC.faith.faith)) err = 'Нужна исповедуемая вера (вкладка «Вера»)';
  else if ((op === 'steal_tech' || op === 'mass_demolish') && A < 2) err = 'Нужно минимум 2 агента';
  else if (d.need === 'basic' && !dos.level) err = 'Нужна разведка цели (базовая)';
  else if (d.need === 'deep' && dos.level !== 'deep') err = 'Нужна глубокая разведка цели';
  return { success, detect, turns, intel, dossier: dos, ci: CI, err, agents: A, succB, detB, ids, raceMod, tRace };
}
// Ресурсы планет: цена продажи и добыча/слот по редкости
const EC_RES_PRICE = { common: 2, uncommon: 10, rare: 50, epic: 200, legendary: 1200 };
const EC_RES_RATE = { common: 8, uncommon: 5, rare: 3, epic: 2, legendary: 1 };   // темп ОДНОЙ постройки (до баффов и слотов)
// КАП: планетарный потолок добычи ресурса /сут по РАЗМЕРУ месторождения (×баффы, жёсткий предел 40) — зеркало _mine_cap.
const EC_MINE_CAP = { 'колоссально': 20, 'очень много': 16, 'много': 12, 'умеренно': 8, 'мало': 5, 'следы': 2 };
function ecMineCap(amt) { const b = EC_MINE_CAP[String(amt || '').trim()]; return Math.min(40, Math.max(1, Math.round((b == null ? 8 : b) * ecFactionMods().mine))); }
const EC_DEST_CUT = 0.5;   // доля получателя каравана — зеркало живой economy_accrue (round(shipped*price*0.5))
// Шанс нападения на КАЖДУЮ угрозу на пути (зеркало economy_accrue): с конвоем меньше.
const EC_THREAT_CHANCE = { ancient: { escort: 0.65, bare: 0.80 }, pirates: { escort: 0.40, bare: 0.80 } };
// Итоговый риск потери каравана за ход (%) с учётом конвоя: 1 - произведение «прошёл мимо каждой угрозы».
function ecTradeRiskPct(threats, convoy) {
  const escorted = (convoy || 0) > 0;
  let safe = 1;
  (threats || []).forEach(t => { const c = (EC_THREAT_CHANCE[t.type] || EC_THREAT_CHANCE.pirates)[escorted ? 'escort' : 'bare']; safe *= (1 - c); });
  return Math.round((1 - safe) * 100);
}
function ecResPrice(r) { return EC_RES_PRICE[r] || EC_RES_PRICE.common; }
// ЖИВАЯ цена по ИМЕНИ ресурса. Источник истины — рынок (SQL market_resources,
// зеркало в EC.market). Фолбэк: базовый якорь resPrice → редкость. Округляем до
// целого для подписей (не меньше 1 ГС); точную цену рынка см. EC.market[name].
function ecResPriceN(name) {
  const m = EC.market && EC.market[name];
  if (m && m.price != null) return Math.max(1, Math.round(m.price));
  if (typeof resPrice === 'function') return resPrice(name);
  return ecResPrice(ecResRarity(name));
}
function ecResRarity(name) { return (EC.resInfo && EC.resInfo[name] && EC.resInfo[name].r) || 'common'; }
// Иконка ресурса как HTML: картинка из каталога (resIconHtml), иначе — сохранённая эмодзи.
function ecResIcon(name) {
  if (typeof resIconSrc === 'function' && resIconSrc(name)) return resIconHtml(name);
  const em = (EC.resInfo && EC.resInfo[name] && EC.resInfo[name].icon) || '◈';
  return `<span class="res-ic res-ic-emoji">${em}</span>`;
}

const ecId = id => document.getElementById(id);
const ecNum = n => Number(n || 0).toLocaleString('ru-RU');
const ecReadable = c => (typeof frReadable === 'function') ? frReadable(c) : (c || '#cfe3ff');

// Каталог зданий — зеркало _economy_setup.sql (для цен и превью дохода; источник истины дохода — RPC)
const EC_BUILD = {
  factory:          { name: 'Гражданская фабрика', cost: 500,  ladder: [0, 0, 500, 1500, 1500, 3000], free: 2, inc: { gc: 200 }, cat: 'civ', desc: '+200 ГС за слот' },
  mining:           { name: 'Добывающий завод',    cost: 500,  ladder: [0, 0, 500, 1500, 1500, 3000], free: 2, inc: {}, cat: 'civ', desc: 'Добыча ПРОСТЫХ ресурсов планеты: только обычные залежи' },
  mining_deep:      { name: 'Глубинный горный комплекс', cost: 2500, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'civ', desc: 'Добыча ЦЕННЫХ ресурсов планеты: необычные и редкие залежи' },
  mining_exotic:    { name: 'Экзотический экстрактор',   cost: 8000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'civ', desc: 'Добыча ЭЛИТНЫХ залежей планеты (эпические и легендарные) — единственный способ качать уникальные ресурсы' },
  trade:            { name: 'Торговый хаб',         cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: { gc: 100 }, cat: 'civ', desc: '+100 ГС за слот (торговый путь)' },
  market:           { name: 'Товарная биржа',       cost: 1500, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'civ', desc: 'Продаёт добытые ресурсы за ГС (50–75% цены по редкости), без торговых путей' },
  goodsfab:         { name: 'Фабрика товаров',       cost: 1200, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'civ', desc: 'Из воды и сырья делает товары ровно под спрос населения: слот покрывает до 10 товаров/сут (0.6 воды + 0.4 сырья на товар). Обеспечение населения умножает доход державы' },
  warehouse:        { name: 'Склад',                 cost: 800,  ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'civ', desc: 'Поднимает лимит хранения ресурсов (+500 ёмкости за слот)' },
  science:          { name: 'Научный Институт',     cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: { science: 1 }, cat: 'mil', desc: '+1 ОН за слот' },
  training:         { name: 'Центр Подготовки',     cost: 500,  ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1000 пехоты' },
  intel:            { name: 'Центр Спецслужб',      cost: 3000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1 агент' },
  military_factory: { name: 'Военный Завод',        cost: 1000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 100 ед. техники' },
  shipyard:         { name: 'Корабельная Верфь',    cost: 2000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: '1 слот = 1 корабль / 12 МЛА' },
  temple:           { name: 'Храм Веры',            cost: 1200, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: { gc: 150 }, cat: 'faith', desc: '+150 ГС за слот и удешевляет постройку войск. При постройке выбираете, чьей религии храм (можно строить храмы разных вер)' },
  // ─ ОБОРОННЫЕ СТРУКТУРЫ (зеркало _defense_*.sql) ─
  starbase:         { name: 'Звёздная База',         cost: 5000, ladder: [0, 5000, 5000, 8000, 8000, 12000], free: 1, inc: {}, cat: 'mil', desc: 'Вместимость флота: +50 кораблей за слот. Без неё нельзя строить корабли сверх лимита (содержания нет — только вместимость)' },
  flak:             { name: 'Батарея ПВО',           cost: 1500, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: 'Пассивная защита планеты от вражеской авиации: снижает урон атакующих авиагрупп (за слот)' },
  abm:              { name: 'Комплекс ПРО',          cost: 3000, ladder: [0, 500, 500, 1500, 1500, 3000], free: 1, inc: {}, cat: 'mil', desc: 'Перехват ударов по планете. Требует снаряды — их докупают за ГС, поставка 1 день. Нет снарядов — нет перехвата' },
  // ОРУДИЕ СУДНОГО ДНЯ — строится отдельным путём (doom_build): ГС + Программируемая
  // материя, требует исследование «Сама неотвратимость». Слоты не открываются.
  doomgun:          { name: 'Длань Неотвратимости', cost: 500000, ladder: [0, 0, 0, 0, 0, 0], free: 1, inc: {}, cat: 'mil', desc: 'Межзвёздная артиллерия: залп из системы в систему превращает планету-цель в мёртвый камень. Жрёт Гравиядро на залп и Программируемую материю на содержание; с каждым выстрелом и днём деградирует, пока не распадётся.' },
};
// Стоимость орудия в Программируемой материи (зеркало _doom_const('build_matter')).
const EC_DOOM_BUILD_MATTER = 40, EC_DOOM_SHOT_GRAV = 20;
// Гиперпейсер — мобильная «Длань» (зеркало _mza_const): цена постройки + расход залпа.
const EC_MZA_BUILD_GC = 1200000, EC_MZA_BUILD_MATTER = 60, EC_MZA_SHOT_GRAV = 12, EC_MZA_SHOT_WEAR = 25;
const EC_ORDER = ['factory', 'mining', 'mining_deep', 'mining_exotic', 'goodsfab', 'trade', 'market', 'warehouse', 'science', 'training', 'intel', 'military_factory', 'shipyard', 'starbase', 'flak', 'abm', 'temple'];
// Рецепт фабрики товаров (зеркало accrue в _budget_wellbeing.sql): на слот/сутки.
// Товары ДЕМАТЕРИАЛИЗОВАНЫ — не ресурс: выпуск ровно под спрос населения.
const EC_GOODS = { water: 6, mat: 4, out: 10 };
// Имена ресурсов-входов (как в data.js/galaxy_gen.js): вода и сырьё.
const EC_GOODS_WATER = ['Лёд', 'Жидкая вода'];
const EC_GOODS_MAT = ['Железо', 'Силикаты'];
// ПРО: цена снаряда + срок доставки (зеркало _defense_const).
const EC_ABM_AMMO_COST = 800;
// Вместимость флота: каждый слот Звёздной Базы даёт столько мест под корабли (зеркало _defense_const).
const EC_STARBASE_CAP_PER_SLOT = 50;
// Верфь-ремонт: цена ремонта = доля стоимости постройки корабля (зеркало _defense_const).
const EC_REPAIR_COST_FRAC = 0.50;
// Короткая подсказка «как пользоваться» для каждого типа здания (показывается в карточке).
const EC_BLD_HOWTO = {
  factory:          'Пассивный доход ГС. Открывайте слоты — каждый добавляет +200 ГС/сут.',
  mining:           'Копает автоматически все ОБЫЧНЫЕ залежи планеты. Необычные и выше не берёт — для них Глубинный комплекс и Экстрактор.',
  mining_deep:      'Копает автоматически НЕОБЫЧНЫЕ и РЕДКИЕ залежи планеты. Обычные не трогает — их берёт Добывающий завод.',
  mining_exotic:    'Копает автоматически ЭПИЧЕСКИЕ и ЛЕГЕНДАРНЫЕ залежи планеты. Ставьте только там, где такая залежь есть — иначе будет простаивать.',
  goodsfab:         'Перерабатывает воду (Лёд/Жидкая вода) и сырьё (Железо/Силикаты) в товары РОВНО под спрос населения — ничего не копится и не продаётся. Держите запас входов на складе — без них фабрика простаивает. Обеспечение: хватает → доход растёт (до ×1.10), дефицит → проседает (до ×0.90).',
  trade:            'Доход только при активном торговом пути (вкладка «Торговля и потоки» → Караваны).',
  market:           'Сама сбывает свежедобытый поток (заводы в режиме «Склад») за ГС (50–75% цены по редкости), без торговых путей. Накопленный склад НЕ трогает — стратегический запас в безопасности.',
  warehouse:        'Каждый слот склада повышает лимит общего хранилища (+500). Без склада лимит мал — лишняя добыча теряется (или ставьте завод в режим «Экспорт»).',
  science:          'Даёт очки науки (ОН) для исследований.',
  training:         'Даёт мощность для производства пехоты (заказ — во вкладке «Строительство вооружённых сил»).',
  intel:            'Даёт агентов для разведки (вкладка «Разведка»).',
  military_factory: 'Даёт мощность для производства наземной техники (вкладка «Строительство вооружённых сил»).',
  shipyard:         'Даёт мощность для постройки кораблей и авиации (вкладка «Строительство вооружённых сил»).',
  starbase:         'Открывает вместимость флота (+50 кораблей за слот). Нельзя строить корабли сверх суммарной вместимости баз — это не содержание, а «места под флот». Уже имеющийся флот сверх лимита остаётся, но новые корабли заблокированы, пока не построите базу/слот.',
  flak:             'Пассивная защита планеты от авиации: снижает урон вражеских авиагрупп при ударе по этой планете. Боезапаса не требует.',
  abm:              'Перехватывает удары по планете (орбитальные удары, залп орудия судного дня). Каждый перехват тратит снаряд. Снаряды докупаются за ГС и прибывают через 1 день. Нет снарядов — удар проходит.',
  temple:           'Пассивный доход ГС + «сила веры»: чем больше слотов храмов, тем дешевле постройка войск. Спиритуалистам и теократиям бонус сильнее. Требует исповедуемой веры; при постройке указывается её религия (можно держать храмы разных вер).',
  doomgun:          'Откройте пульт орудия, выберите систему-цель и планету — залп тратит 20 Гравиядра. Снаряд летит тем дольше, чем дальше цель: от ~3 ч до соседней системы и до суток — от края до края галактики. Держите запас Программируемой материи: без неё орудие деградирует быстрее и распадётся.',
};
// Иконки зданий (для каталога-выбора при постройке)
const EC_BLD_ICON = {
  factory: '🏭', mining: '⛏', mining_deep: '⚒', mining_exotic: '💎', goodsfab: '🛍', trade: '💱', market: '📈',
  science: '🔬', training: '🪖', intel: '🕵', military_factory: '🛠', shipyard: '🚀', warehouse: '📦', temple: '🛐', doomgun: '🜨',
  starbase: '🛰', flak: '🎯', abm: '🚀',
};
const EC_COLONIZE_COST = 400, EC_MAX_SLOTS = 6, EC_DEFAULT_CELLS = 6;
// Обустройство среды обитания на своей колонии (+ячейки, 1 ход)
const EC_HABITAT_COST = 1000, EC_HABITAT_CELLS = 3, EC_HABITAT_TURNS = 1;
// Небожители: орбитальные/наземные станции в непригодных мирах — малые колонии (3–5 ячеек).
const EC_STATION_COST = 300;
// Строительство слота здания (1 ход; ГС берётся из лестницы здания)
const EC_SLOT_TURNS = 1;
// Терраформирование непригодной планеты — уровни сложности (срок + доп. ОН)
const EC_TERRA = {
  1: { label: 'Простое',        turns: 1, gc: 1000, science: 0   },
  2: { label: 'Сложное',        turns: 2, gc: 1800, science: 60  },
  3: { label: 'Экстремальное',  turns: 4, gc: 4800, science: 30  },
};
// «Климатическая» координата групп планет (для оценки взаимной несовместимости).
// Чем дальше планета от родных миров расы по этой шкале — тем сложнее терраформ.
const EC_ENV = { cryo: 0, oceanic: 2, terrestrial: 2, micro: 3, desert: 3, exotic: 4, volcanic: 5, lava: 6 };
// Уровень сложности терраформирования планеты p для расы race (1..3)
function ecTerraTier(p, race) {
  const g = ecPlanetGroup(p);
  const pe = EC_ENV[g];
  if (pe == null) return 3; // неизвестная/экзотика — максимально сложно
  const natives = (EC_HAB[race] || []).map(x => EC_ENV[x]).filter(v => v != null);
  if (!natives.length) return 2;
  const dist = Math.min(...natives.map(v => Math.abs(pe - v)));
  return dist <= 1 ? 1 : dist <= 3 ? 2 : 3;
}

// ════════════════════════════════════════════════════════════
// ДОКТРИНА ГОСУДАРСТВА — модификаторы от выбора в анкете.
// ПРОЦЕНТНЫЕ поля (доли, 0.20 = +20%): gc, mine, build — доход/добыча/стройка;
//   colonize, claim_cost — стоимости (<1 дешевле); claim_cd — кулдаун колонизации
//   систем (<1 чаще); research — стоимость исследований (<1 дешевле = больше техов).
// ПЛОСКИЕ поля (целые, +N в сутки): sci_flat — ОН/сут, agents_flat — агентов/сут.
//   Наука и агенты — дискретные малые величины, проценты для них бессмысленны.
// ⚠ ЧИСЛА ДОЛЖНЫ СОВПАДАТЬ с public._faction_mods() в _economy_setup.sql.
// ════════════════════════════════════════════════════════════
const EC_MODS = {
  // Форма правления → ТЕМП ЭКСПАНСИИ и контроль (захват/кулдаун/агенты/стройка).
  // Деньги дают слабо — это не «денежная» ось.
  gov: {
    'Республика':           { gc: 0.05, sci_flat: 1, agents_flat: -1 },
    'Монархия':             { gc: 0.15, research: 0.10, claim_cd: 0.10 },
    'Империя':              { claim_cost: -0.20, claim_cd: -0.15, gc: -0.15, agents_flat: 1 },
    'Олигархия':            { gc: 0.20, sci_flat: -1, agents_flat: -1 },
    'Диктатура':            { claim_cd: -0.20, agents_flat: 1, gc: -0.10, sci_flat: -1 },
    'Теократия':            { gc: 0.10, research: 0.10, agents_flat: 1, sci_flat: -1 },   // ★ вера сильнее
    'Технократия':          { gc: -0.20, research: -0.15, build: 0.05, sci_flat: 2 },     // ★ +1 слот исследований
    'Корпоратократия':      { gc: 0.10, mine: 0.10, agents_flat: -1 },
    'Коллективный разум':   { mine: 0.20, claim_cost: 0.15, gc: -0.10, sci_flat: 1 },
    'Машинный разум (ИИ)':  { gc: -0.15, build: -0.10, research: -0.10, sci_flat: 1, agents_flat: 1 },  // ★ робот-набор
  },
  // Режим → ЭКОНОМИЧЕСКИЙ ТЕМПЕРАМЕНТ: дил «доход ↔ добыча ↔ наука».
  regime: {
    'Демократический':      { gc: 0.15, agents_flat: -1 },
    'Эгалитарный':          { gc: 0.10, claim_cost: 0.10, sci_flat: 1 },
    'Меритократический':    { gc: -0.10, research: -0.15, sci_flat: 2 },
    'Плутократический':     { gc: 0.20, sci_flat: -1, agents_flat: -1 },
    'Олигархический':       { gc: 0.15, mine: -0.10 },
    'Авторитарный':         { mine: 0.10, agents_flat: 1, gc: -0.10 },
    'Тоталитарный':         { mine: 0.20, gc: -0.15, agents_flat: 1 },
    'Деспотичный':          { claim_cd: -0.20, agents_flat: 1, sci_flat: -1 },
    'Деспотизм':            { mine: 0.15, gc: 0.10, research: 0.15, sci_flat: -1, agents_flat: 1 },
    'Анархический':         { colonize: -0.20, build: 0.15, gc: -0.15, sci_flat: 1 },
  },
  // Идеология → ГЛАВНАЯ ИДЕНТИЧНОСТЬ + сигнатура. Может бить 0.25–0.30 на свою линию,
  // но платит на другой. См. EC_ARCHETYPE.
  ideology: {
    'Технократия (Культ науки)': { gc: -0.15, research: -0.20, sci_flat: 2 },             // ★ +1 слот исследований
    'Милитаризм (Культ силы)':   { claim_cost: -0.20, gc: -0.10, research: 0.10, agents_flat: 1 },
    'Пацифизм':                  { gc: 0.25, claim_cd: 0.15, agents_flat: -1 },           // ★ золотой век, слабая армия
    'Экспансионизм':             { colonize: -0.25, claim_cost: -0.20, gc: -0.10 },        // ★ пул из 2 захватов
    'Изоляционизм':              { gc: 0.15, claim_cost: 0.20, claim_cd: 0.20, agents_flat: 1 },
    'Ксенофилия':                { gc: 0.20, colonize: -0.10, agents_flat: -1 },
    'Ксенофобия':                { mine: 0.15, gc: -0.10, agents_flat: 1 },
    'Спиритуализм':              { gc: 0.10, research: 0.10, sci_flat: -1, agents_flat: 1 },  // ★ вера сильнее
    'Трансгуманизм':             { gc: -0.10, research: -0.20, sci_flat: 2 },
    'Экоцентризм':               { mine: 0.25, gc: -0.15, build: 0.05 },
    'Индустриализм':             { build: -0.15, mine: 0.10, gc: 0.05, research: 0.10 },
  },
  // Раса → мягкая биология (≤0.20) + родные миры (EC_HAB). Нетто ≈ 0.
  race: {
    'Гуманоиды':                  { gc: 0.05, sci_flat: 1 },
    'Млекопитающие':              { gc: 0.15 },
    'Рептилоиды':                 { gc: -0.10, agents_flat: 1 },
    'Авианы (Птицеподобные)':     { claim_cd: -0.20, gc: -0.05, agents_flat: 1 },
    'Инсектоиды':                 { mine: 0.15, gc: 0.05, research: 0.10, sci_flat: -1 },
    'Акватики (Водные)':          { gc: 0.15, colonize: 0.15 },
    'Плантоиды (Растениевидные)': { mine: 0.15, gc: 0.05, agents_flat: -1 },
    'Литоиды (Каменные)':         { mine: 0.20, gc: -0.15 },
    'Синтетики / Киборги':        { gc: -0.35, research: -0.15, sci_flat: 2 },  // все планеты родные → намеренно сильный дебаф денег
    'Энергетические сущности':    { gc: -0.15, research: -0.10, sci_flat: 1, agents_flat: 1 },
  },
  // Тип → СТАРТ: фронтир = дешёвая быстрая экспансия, но бедно; колония = богато/вглубь, медленно вширь.
  civ: {
    'frontier': { colonize: -0.20, claim_cd: -0.20, gc: -0.15 },
    'colony':   { gc: 0.15, mine: 0.10, claim_cost: 0.15, build: -0.10 },
  },
};
// ── АРХЕТИПЫ доктрины (идентичность по идеологии) ──────────────
// Несут «лицо» плейстайла для карточки: заголовок, слоган, цветовая линия (lane)
// и текст сигнатуры (★ — главная фишка). lane → акцентный цвет карточки.
const EC_ARCHETYPE = {
  'Технократия (Культ науки)': { title: 'Научная держава',  lane: 'science', tagline: 'Гонка технологий: дешёвые исследования и параллельные проекты.', signature: '+1 слот параллельных исследований' },
  'Милитаризм (Культ силы)':   { title: 'Военная машина',   lane: 'war',     tagline: 'Экспансия силой: дешёвый захват систем и сильные спецслужбы.',      signature: 'Военная экономика — дешёвый захват + агенты' },
  'Пацифизм':                  { title: 'Золотой век',      lane: 'econ',    tagline: 'Максимум дохода ценой слабой армии и разведки.',                    signature: 'Процветание — топовый доход, но без милитаризации' },
  'Экспансионизм':             { title: 'Великое расселение',lane: 'expand', tagline: 'Дешёвая безостановочная колонизация во все стороны.',               signature: 'Пул из 2 захватов систем подряд' },
  'Изоляционизм':              { title: 'Затворники',       lane: 'econ',    tagline: 'Богатое замкнутое ядро; расширяться дорого и медленно.',            signature: 'Крепкий тыл — доход и агенты, дорогая экспансия' },
  'Ксенофилия':                { title: 'Открытый мир',     lane: 'econ',    tagline: 'Торговля и дружелюбие приносят доход и удешевляют колонии.',         signature: 'Открытые границы — доход + дешёвая колонизация' },
  'Ксенофобия':                { title: 'Крепость-мир',     lane: 'mine',    tagline: 'Замкнутая мобилизация на добычу и контроль.',                       signature: 'Осадная экономика — добыча + спецслужбы' },
  'Спиритуализм':              { title: 'Держава духа',     lane: 'faith',   tagline: 'Вера кормит казну и удешевляет войска.',                            signature: 'Усиленная Вера — храмы дают больше' },
  'Трансгуманизм':             { title: 'Постлюди',         lane: 'science', tagline: 'Жертвуют экономикой ради чистой науки.',                            signature: 'Постчеловек — дешёвая наука и приток ОН' },
  'Экоцентризм':               { title: 'Гармония',         lane: 'mine',    tagline: 'Бережная сверхдобыча ресурсов родных миров.',                       signature: 'Гармония с миром — максимум добычи' },
  'Индустриализм':             { title: 'Промышленность',   lane: 'build',   tagline: 'Дешёвое строительство и развитая производственная база.',           signature: 'Индустриальная база — дешёвые постройки и слоты' },
};
// Акцентные цвета линий архетипа (CSS-переменные с фолбэком).
const EC_LANE_COLOR = {
  science: 'var(--te, #3ec0d0)', war: 'var(--err, #e05050)', econ: 'var(--gd, #d4af37)',
  expand: 'var(--ok, #4caf6a)', faith: 'var(--pu, #a98bff)', mine: '#e0962f', build: '#e0962f',
};
const EC_LANE_ICON = { science: '🔬', war: '⚔', econ: '💰', expand: '🪐', faith: '🛐', mine: '⛏', build: '🏗' };
// Архетип текущей анкеты (по идеологии; робот переопределяет).
function ecArchetype(app) {
  app = app || EC.app || {};
  const isRobot = app.race === 'Синтетики / Киборги' || app.gov === 'Машинный разум (ИИ)';
  if (isRobot) return { title: 'Машинный разум', lane: 'science', tagline: 'Синтетический рой: любой мир — дом, наука и сила вместо денег.', signature: 'Робот-набор — все миры родные, пехота ×3, +слот, 2 захвата' };
  return EC_ARCHETYPE[app.ideology] || { title: 'Независимая держава', lane: 'econ', tagline: 'Сбалансированный путь без выраженной специализации.', signature: '' };
}

// ── ПЛАНЕТЫ-СТОЛИЦЫ: характеристики и лёгкий бонус родного мира ──
// Ключ = среда (env, EC_HAB). Бонусы намеренно мягкие — это «характер» родного
// мира, а не основной источник силы фракции. cells = ячейки застройки столицы,
// res = базовый профиль ресурсов (common), mods = лёгкий пассивный бонус,
// title/flavor — для регистрации и гайдбука. Зеркало: _faction_mods (capital_env)
// и _basic_capital_res в SQL.
const EC_CAPITAL = {
  terrestrial: { title: 'Колыбель жизни',     cells: 9, res: ['Железо', 'Силикаты', 'Углерод'], mods: { gc: 0.05 },        flavor: 'Сбалансированный, обжитой мир. Стабильная биосфера даёт лёгкий бонус к доходу.' },
  oceanic:     { title: 'Мир океанов',        cells: 9, res: ['Силикаты', 'Лёд'],               mods: { colonize: -0.10 }, flavor: 'Сплошной океан и развитая логистика по воде удешевляют расселение новых колоний.' },
  desert:      { title: 'Выжженные пустоши',  cells: 8, res: ['Железо', 'Силикаты', 'Сера'],    mods: { mine: 0.10 },      flavor: 'Минералы лежат прямо на поверхности — выше скорость добычи ресурсов.' },
  volcanic:    { title: 'Геотермальный мир',  cells: 8, res: ['Железо', 'Сера'],                mods: { mine: 0.10 },      flavor: 'Вулканическая активность питает шахты дешёвой энергией — выше добыча.' },
  lava:        { title: 'Расплавленные недра',cells: 7, res: ['Железо', 'Сера'],                mods: { mine: 0.12 },      flavor: 'Море магмы богато тяжёлыми металлами. Суровый мир, но максимум добычи.' },
  cryo:        { title: 'Ледяной мир',        cells: 8, res: ['Лёд', 'Железо', 'Силикаты'],     mods: { research: -0.08 }, flavor: 'Криолаборатории и сверхпроводники в вечном холоде удешевляют исследования.' },
  micro:       { title: 'Малое тело',         cells: 7, res: ['Железо', 'Силикаты'],            mods: { claim_cd: -0.12 }, flavor: 'Низкая гравитация удешевляет запуск кораблей — экспансия идёт быстрее.' },
  exotic:      { title: 'Аномальный мир',     cells: 8, res: ['Углерод', 'Силикаты'],           mods: { sci_flat: 1 },     flavor: 'Странная физика родного мира даёт учёным стабильный приток научных данных.' },
};
function ecCapital(env) { return EC_CAPITAL[env] || EC_CAPITAL.terrestrial; }
// Процентные поля (множители 1+sum) и плоские поля (целые суммы).
const EC_MOD_PCT = ['gc', 'mine', 'build', 'colonize', 'claim_cost', 'claim_cd', 'research'];
const EC_MOD_FLAT = ['sci_flat', 'agents_flat'];
// ── Конкретные ПЛЮШКИ доктрины (зеркало _doctrine_grant_* в SQL) ──
// Бонусные стартовые постройки: форма правления + идеология дают по зданию.
const EC_DOCTRINE_BUILD = {
  gov: {
    'Республика': 'trade', 'Монархия': 'factory', 'Империя': 'military_factory', 'Олигархия': 'factory',
    'Диктатура': 'training', 'Теократия': 'training', 'Технократия': 'science', 'Корпоратократия': 'trade',
    'Коллективный разум': 'science', 'Машинный разум (ИИ)': 'science',
  },
  ideology: {
    'Технократия (Культ науки)': 'science', 'Милитаризм (Культ силы)': 'military_factory', 'Пацифизм': 'factory',
    'Экспансионизм': 'mining', 'Изоляционизм': 'intel', 'Ксенофилия': 'trade', 'Ксенофобия': 'training',
    'Спиритуализм': 'training', 'Трансгуманизм': 'science', 'Экоцентризм': 'mining', 'Индустриализм': 'factory',
  },
};
// Бесплатная стартовая технология (по идеологии).
const EC_DOCTRINE_TECH = {
  'Технократия (Культ науки)': 'Продвинутые реакторы (корабли)',
  'Милитаризм (Культ силы)':   'Продвинутая броня (наземка)',
  'Трансгуманизм':             'Продвинутые щиты (наземка)',
  'Индустриализм':             'Продвинутые двигатели (корабли)',
  'Изоляционизм':              'Продвинутые щиты (наземка)',
  'Ксенофобия':                'Продвинутая броня (наземка)',
};
// Бонусные слоты параллельных исследований по выбору доктрины («доп. исследования»).
// Технократия как форма правления и «Культ науки» как идеология дают по +1 слоту
// (стекаются → полноценная научная держава). Зеркало: ecTechnoSlots() /
// public._research_slots в _technocracy.sql.
const EC_DOCTRINE_SLOTS = {
  gov:      { 'Технократия': 1 },
  ideology: { 'Технократия (Культ науки)': 1 },
};
function ecBuildName(bt) { return (typeof EC_BUILD !== 'undefined' && EC_BUILD[bt]) ? EC_BUILD[bt].name : bt; }
// Считает итоговые модификаторы доктрины для анкеты app (по умолчанию — текущая фракция).
function ecFactionMods(app) {
  app = app || (typeof EC !== 'undefined' && EC.app) || {};
  const f = {}; [...EC_MOD_PCT, ...EC_MOD_FLAT].forEach(k => f[k] = 0);
  const add = m => { if (m) for (const k in m) f[k] = (f[k] || 0) + m[k]; };
  add(EC_MODS.gov[app.gov]); add(EC_MODS.regime[app.regime]);
  add(EC_MODS.ideology[app.ideology]); add(EC_MODS.race[app.race]);
  add(EC_MODS.civ[app.civ_type]);
  add((EC_CAPITAL[app.capital_env] || {}).mods);   // лёгкий бонус планеты-столицы
  // Бонусы изученных политических технологий (зеркало SQL _faction_mods).
  // Применяются к текущей фракции (research лежит в EC.eco, не в анкете).
  if (typeof EC !== 'undefined' && EC.eco && Array.isArray(EC.eco.research) && (!app || app === EC.app)) {
    EC.eco.research.forEach(id => add(EC_RESEARCH_BONUS[id]));
  }
  const clamp = (v, lo) => Math.max(lo, 1 + v);
  return {
    gc: clamp(f.gc, 0.3), mine: clamp(f.mine, 0.3), build: clamp(f.build, 0.3),
    research: clamp(f.research, 0.3),
    sci_flat: Math.round(f.sci_flat), agents_flat: Math.round(f.agents_flat),
    colonize: clamp(f.colonize, 0.3),
    claim_cost: clamp(f.claim_cost, 0.3), claim_cd: clamp(f.claim_cd, 0.25),
    _raw: f,
  };
}

// ── Расы → родные группы планет (дефолт, правится) ──────────
const EC_HAB = {
  'Гуманоиды': ['terrestrial'],
  'Млекопитающие': ['terrestrial', 'oceanic'],
  'Рептилоиды': ['desert', 'volcanic', 'terrestrial'],
  'Авианы (Птицеподобные)': ['terrestrial', 'desert'],
  'Инсектоиды': ['terrestrial', 'desert', 'volcanic'],
  'Акватики (Водные)': ['oceanic'],
  'Плантоиды (Растениевидные)': ['terrestrial', 'oceanic'],
  'Литоиды (Каменные)': ['micro', 'lava', 'desert'],
  // Роботы: пригодны ВСЕ колонизируемые типы планет (нет терраформа) — расплата
  //   за это в сильном денежном дебафе (см. EC_MODS.race). Зеркало: _race_native_envs.
  'Синтетики / Киборги': ['terrestrial', 'oceanic', 'desert', 'volcanic', 'lava', 'cryo', 'micro', 'exotic'],
  'Энергетические сущности': ['exotic', 'cryo', 'lava'],
};
const EC_GRP_LABEL = { lava: 'Лавовые', volcanic: 'Вулканические', terrestrial: 'Землеподобные', oceanic: 'Океанические', desert: 'Пустынные', cryo: 'Криомиры', gasgiant: 'Газовый гигант', icegiant: 'Ледяной гигант', hotgiant: 'Горячий гигант', exotic: 'Экзотическая', micro: 'Малое тело', anomaly: 'Аномалия', belt: 'Пояс', unknown: 'Неизвестно' };
// type = имя группы (генератор)
const EC_GRP_NAME = { 'Лавовые миры': 'lava', 'Вулканические': 'volcanic', 'Землеподобные': 'terrestrial', 'Океанические': 'oceanic', 'Пустынные': 'desert', 'Криомиры': 'cryo', 'Газовые гиганты': 'gasgiant', 'Ледяные гиганты': 'icegiant', 'Горячие гиганты': 'hotgiant', 'Экзотические': 'exotic', 'Малые тела': 'micro', 'Аномалии': 'anomaly' };
// фолбэк: имя планеты → группа (сид-данные/старый формат)
const EC_PLANET_NAME = { 'Катархей': 'lava', 'Мёртвая планета': 'lava', 'Супервулканическая планета': 'volcanic', 'Хтонический мир': 'lava', 'Горячий Юпитер': 'hotgiant', 'Горячий Нептун': 'hotgiant', 'Железный мир': 'lava', 'Дастория': 'volcanic', 'Литара': 'desert', 'Океаническая суперземля': 'exotic', 'Рыхлый гигант': 'gasgiant', 'Железный карлик': 'terrestrial', 'Духлесс': 'volcanic', 'Терра': 'terrestrial', 'Суперземля': 'terrestrial', 'Гикеан': 'oceanic', 'Панталассическая планета': 'oceanic', 'Теракрон': 'terrestrial', 'Мини-Нептун': 'gasgiant', 'Водный Юпитер': 'gasgiant', 'Тундровая планета': 'terrestrial', 'Псамора': 'oceanic', 'Мир дюн': 'desert', 'Гельвард': 'cryo', 'Турмион': 'gasgiant', 'Ледяной гигант': 'icegiant', 'Аммиачный мир': 'cryo', 'Газовый карлик': 'gasgiant', 'Метановый мир': 'cryo', 'Суперюпитер': 'gasgiant', 'Коричневый карлик': 'gasgiant', 'Планета-сирота': 'exotic', 'Углеродная планета': 'cryo', 'Тёмный замёрзший мир': 'cryo', 'Карликовая планета': 'micro', 'Мегаастероид': 'micro', 'Черная дыра': 'anomaly', 'Кротовая нора': 'anomaly', 'Токсичный карлик': 'anomaly' };
const EC_NOCOL = new Set(['gasgiant', 'icegiant', 'hotgiant', 'anomaly', 'belt']);
function ecPlanetGroup(p) {
  if (!p) return 'unknown';
  if (p.kind === 'belt') return 'belt';
  if (p.kind === 'anomaly') return 'anomaly';
  const t = (p.type || '').trim();
  if (EC_GRP_NAME[t]) return EC_GRP_NAME[t];
  if (EC_PLANET_NAME[t]) return EC_PLANET_NAME[t];
  if (EC_PLANET_NAME[(p.name || '').trim()]) return EC_PLANET_NAME[(p.name || '').trim()];
  return 'unknown';
}
function ecColonizable(p) { return !EC_NOCOL.has(ecPlanetGroup(p)); }
// Роботы (раса «Синтетики / Киборги» ИЛИ правление «Машинный разум») колонизируют
// ЛЮБОЙ пригодный мир напрямую — без терраформа. Зеркало сервера: economy_colonize
// (native := _faction_native_all(fid) or grp = any(_race_native_envs(...))).
// ── Легаси-исключение (разовое): фракции, взявшие правление «Машинный разум (ИИ)»
//    с БИОЛОГИЧЕСКОЙ расой ещё до разделения перка. Для них «жить где угодно без
//    терраформа» НЕ действует — терраформ обязателен, как у их расы. Прочие
//    робо-бонусы (наука ×2, захваты ×2, пехота ×3) сохраняются. Зеркало сервера:
//    public._faction_native_all (fid <> любой из этого списка). НЕ общее правило.
const EC_HAB_NOSHORTCUT = new Set(['fac_d9662abfe6']); // «Супердемократия Люмена» (Гуманоиды + ИИ)
// «Все миры родные / терраформ не нужен» — роботы, КРОМЕ легаси-исключений.
function ecNativeAll() { return ecIsRobot() && !EC_HAB_NOSHORTCUT.has(EC.fid); }
function ecNative(p, race) { return ecNativeAll() || (EC_HAB[race] || []).includes(ecPlanetGroup(p)); }
// Небожители: конфиг станции, если ИЗУЧЕНА технология, открывающая группу планет g.
function ecStationFor(group) {
  const done = (EC.eco && EC.eco.research) || [];
  for (const n of EC_POLITICS) {
    if (n.special === 'station' && n.station && n.station.groups.includes(group) && done.includes(n.id)) return n.station;
  }
  return null;
}
// Технология-станция, которая ОТКРЫЛА БЫ группу g (для подсказки «нужна технология»).
function ecStationTechFor(group) {
  return EC_POLITICS.find(n => n.special === 'station' && n.station && n.station.groups.includes(group)) || null;
}

// ── Производство ────────────────────────────────────────────
const EC_BLD_LABEL = { training: 'Центр Подготовки', military_factory: 'Военный Завод', shipyard: 'Корабельная Верфь' };
const EC_VEH_WEIGHT = { tank_light: 1, tank_mbt: 2, tank_heavy: 4, tank_walker: 4, btr_wheel: 1, bmp_track: 2, btr_hover: 1, art_mortar: 1, art_sau: 2, art_rszo: 2, art_laser: 4 };
const EC_GROUND_WEIGHT = { light: 1, medium: 2, artillery: 2, heavy: 4, walker: 4 };
function ecUnitWeight(u) { return EC_GROUND_WEIGHT[(u && u.data && u.data.class) || ''] || 2; }
function ecSlotsSum(t) { return EC.buildings.filter(b => b.btype === t).reduce((a, b) => a + (b.slots_open || 0), 0); }
// Лимит ёмкости общего склада ресурсов. Зеркало _resources_phase1.sql:
// база 1000 + 500 за каждый открытый слот здания «Склад».
const EC_STORE_BASE = 1000, EC_STORE_PER_SLOT = 500;
function ecStoreCap() { return EC_STORE_BASE + ecSlotsSum('warehouse') * EC_STORE_PER_SLOT; }
// ── Раса/правление «роботов»: раса «Синтетики / Киборги» ИЛИ правление
//    «Машинный разум (ИИ)». Роботы: пехота на Военном Заводе (×3), 2 слота
//    исследований, 2 захвата систем за цикл. Зеркало: public._faction_is_robot().
function ecIsRobot() {
  const a = EC.app || {};
  return a.race === 'Синтетики / Киборги' || a.gov === 'Машинный разум (ИИ)';
}
// Сигнатура экспансионизма: пул из 2 захватов систем подряд (как у роботов / «Дома в небесах»).
function ecIsExpansionist() { return (EC.app || {}).ideology === 'Экспансионизм'; }
const EC_INF_PER_SLOT = 1000, EC_ROBOT_INF_PER_SLOT = 3000;
function ecCaps() {
  const tr = ecSlotsSum('training'), mf = ecSlotsSum('military_factory'), sy = ecSlotsSum('shipyard');
  const robot = ecIsRobot();
  // Роботы «собирают» пехоту как технику — на Военном Заводе, втрое эффективнее.
  const infFromMf = robot ? mf * EC_ROBOT_INF_PER_SLOT : 0;
  const infFromTr = tr * EC_INF_PER_SLOT;
  // Вместимость флота: Звёздные Базы + ДОБЫВАЮЩИЕ аванпосты-стоянки (зеркало _fleet_capacity).
  const baseCap = ecSlotsSum('starbase') * EC_STARBASE_CAP_PER_SLOT;
  const opMining = (EC.outposts || []).filter(o => o.mine && o.mode === 'mining').length;
  const outpostCap = opMining * EC_OUTPOST_CAP;
  const fleetCap = baseCap + outpostCap;
  return {
    training: robot ? infFromMf : infFromTr,   // суммарная мощность пехоты
    military: mf * 100, ships: sy, mla: sy * 12,
    fleetCap,                                   // мест под корабли (суммарно)
    fleetBaseCap: baseCap, fleetOutpostCap: outpostCap, fleetOutposts: opMining,
    hasTraining: robot ? mf > 0 : tr > 0,       // у роботов «носитель пехоты» = Военный Завод
    hasMil: mf > 0, hasShipyard: sy > 0, hasStarbase: ecSlotsSum('starbase') > 0, robot,
  };
}
// Сколько кораблей фракция уже держит. Зеркало _fleet_used.
// ВАЖНО: корабли, собранные в соединения (EC.fleets), сервер СНИМАЕТ из unit_production
// (см. fleet_form в _army_fleet.sql), поэтому в составе/ростере их уже нет. Чтобы метр и
// гейт вместимости не «теряли» развёрнутый флот, добавляем сюда корабли из соединений.
function ecFleetUsed() {
  const ships = arr => (arr || []).filter(r => r.category === 'ship').reduce((a, r) => a + (r.qty || 0), 0);
  const inFleets = (EC.fleets || []).reduce((a, fl) =>
    a + (fl.composition || []).reduce((b, c) => b + (c.qty || 0), 0), 0);
  return ships(EC.roster) + ships(EC.queue) + ships(EC.damaged) + ships(EC.repairing) + inFleets;
}
// Сколько пехоты / техники / кораблей «съедает» дивизия за ход.
// Пехота → мощность Центра Подготовки (caps.training), наземная техника и авиация →
// Военный Завод (caps.military), корабли в составе → Верфь (caps.ships).
// Физическое количество = model.count × count блока (пехота 1000, техника 100, авиация 10).
function ecDivManpower(div) {
  const blocks = (div.data && div.data.blocks) || [];
  let inf = 0, tech = 0, ships = 0;
  blocks.forEach(b => {
    const id = b.modelId || '';
    const c = b.count || 1;
    if (id.indexOf('tech:') === 0) {
      const u = EC.designs.find(d => d.id === id.slice(5));
      if (u && u.category === 'ship') ships += c; else tech += c;
    } else {
      const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === id) : null;
      if (!m) return;
      const units = (m.count || 1) * c;
      if (m.type === 'inf') inf += units; else tech += units;
    }
  });
  return { inf, tech, ships };
}
function ecPendingUse() {
  let ships = 0, inf = 0, tech = 0;
  EC.queue.forEach(q => {
    const qty = q.qty || 1;
    if (q.category === 'ship') { ships += qty; return; }
    if (q.category === 'division') {
      const d = EC.designs.find(x => x.id === q.unit_id && x.category === 'division');
      if (d) { const mp = ecDivManpower(d); inf += mp.inf * qty; tech += mp.tech * qty; ships += mp.ships * qty; }
    }
  });
  return { ships, inf, tech };
}
function ecHasBuilding(bt) { return EC.buildings.some(b => b.btype === bt); }
// Имя компонента состава дивизии (сток или зарегистрированная техника)
function ecDivCompName(modelId) {
  if ((modelId || '').indexOf('tech:') === 0) { const u = EC.designs.find(d => d.id === modelId.slice(5)); return u ? u.name : 'техника'; }
  const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === modelId) : null;
  return m ? m.name : (modelId || '—');
}
// Какие здания нужны под состав дивизии: пехота→Подготовка, техника→Воензавод, корабль→Верфь.
// Роботы: пехота тоже собирается на Военном Заводе (Центр Подготовки им не нужен).
function ecDivReqBuildings(div) {
  const blocks = (div.data && div.data.blocks) || [];
  const infBld = ecIsRobot() ? 'military_factory' : 'training';
  const need = new Set();
  blocks.forEach(b => {
    const id = b.modelId || '';
    if (id.indexOf('tech:') === 0) {
      const u = EC.designs.find(d => d.id === id.slice(5));
      const cat = u ? u.category : 'ground';
      need.add(cat === 'ship' ? 'shipyard' : 'military_factory');
    } else {
      const m = (typeof CN_DIV_DATA !== 'undefined') ? CN_DIV_DATA.find(x => x.id === id) : null;
      need.add((m && m.type === 'inf') ? infBld : 'military_factory');
    }
  });
  return [...need];
}

// ── Доступ / фракция ────────────────────────────────────────
function ecIsStaff() { return !!(user && ['superadmin', 'editor'].includes(user.role)); }
async function ecLoadApp() {
  if (!user) { EC.app = null; EC.myAppUid = null; return null; }
  if (EC.myAppUid === user.id) return EC.app;
  try {
    const rows = await dbGet('faction_applications', `owner_id=eq.${user.id}&status=eq.approved&order=updated_at.desc&limit=1`);
    EC.app = (rows && rows[0]) ? rows[0] : null;
  } catch (e) { EC.app = null; }
  EC.myAppUid = user.id;
  return EC.app;
}
function ecCanAccess() { return !!(user && (ecIsStaff() || (EC.myAppUid === user.id && EC.app && EC.app.faction_id))); }
let _ecNavLoading = false;
function ecNavEnsure() {
  if (!user || ecIsStaff() || EC.myAppUid === user.id || _ecNavLoading) return;
  _ecNavLoading = true;
  ecLoadApp().finally(() => { _ecNavLoading = false; if (typeof buildNav === 'function') buildNav(); });
}

async function ecRpc(fn, body) {
  const token = await getTokenFresh();
  // Таймаут 28 с — сырой fetch без AbortController вешал страницу
  // насмерть, если Supabase «просыпался» (cold start ~25 с).
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 28000);
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) { const t = await r.text(); throw new Error(t || ('HTTP ' + r.status)); }
    if (r.status === 204) return null;
    return r.json();
  } catch (e) {
    clearTimeout(tid);
    if (e.name === 'AbortError') throw new Error('сервер не ответил вовремя');
    throw e;
  }
}

// ── Пространственная экономика (срез 1-4): полоска баланса системы ──
// Покрытие <0.7 — дефицит (красный), 0.7..1 — впритык (жёлтый), ≥1 — профицит (зелёный).
function ecSpatialCovCls(v) { return v < 0.7 ? 'lo' : (v < 1 ? 'mid' : 'hi'); }
// Активное экономическое событие сектора системы (срез 4).
const EC_SECTOR_EVENT = { war: '⚔ война', pirates: '☠ пираты', boom: '↑ бум', depression: '↓ кризис' };
function ecSysSectorEvent(sid) {
  const now = Date.now();
  const sec = (EC.sectors || []).find(s => Array.isArray(s.system_ids) && s.system_ids.includes(sid)
    && s.econ_event && (!s.econ_until || new Date(s.econ_until).getTime() > now));
  return sec ? { event: sec.econ_event, mod: +sec.econ_mod || 1, name: sec.name } : null;
}
function ecSpatialBar(bal) {
  if (!bal) return '';
  const cov = bal.coverage || {};
  const pr = +bal.prosperity || 1;
  const st = bal.status || 'ok';
  const stTxt = st === 'stagnation' ? 'стагнация' : (st === 'unrest' ? 'волнения' : 'баланс');
  const chip = (ic, label, v) => {
    const n = (v == null ? 1 : +v);
    return `<span class="ec-sb-cov ec-sb-${ecSpatialCovCls(n)}" title="${label}: покрытие ${Math.round(n * 100)}%">${ic} ${Math.round(n * 100)}%</span>`;
  };
  const sum = o => o ? Math.round((+o.r || 0) + (+o.g || 0) + (+o.c || 0)) : 0;
  // Спилловер от соседей (срез 4)
  const spl = bal.spill && sum(bal.spill);
  const spill = spl ? `<span class="ec-sb-cov ec-sb-hi" title="Спилловер: соседи той же фракции гасят дефицит">🌐 +${spl}</span>` : '';
  // Событие сектора (срез 4)
  const ev = ecSysSectorEvent(bal.system_id);
  const evChip = ev ? `<span class="ec-sb-cov ${ev.mod >= 1 ? 'ec-sb-hi' : 'ec-sb-lo'}" title="Событие сектора «${esc(ev.name || '')}»: просперити ×${ev.mod}">${EC_SECTOR_EVENT[ev.event] || esc(ev.event)} ×${ev.mod}</span>` : '';
  // Бедность (срез 6): отток населения + штраф после восстания
  const popM = bal.pop_mult == null ? 1 : +bal.pop_mult;
  const popChip = popM < 0.995 ? `<span class="ec-sb-cov ec-sb-lo" title="Отток населения: бедность гонит жителей прочь. Доля заселённости — ${Math.round(popM * 100)}% от ёмкости.">👥 ${Math.round(popM * 100)}%</span>` : '';
  const revolt = bal.revolt_until && new Date(bal.revolt_until).getTime() > Date.now();
  const revChip = revolt ? `<span class="ec-sb-cov ec-sb-lo" title="Последствия беспорядков: просперити ×0.95 до ${new Date(bal.revolt_until).toLocaleDateString('ru-RU')}.">🔥 беспорядки</span>` : '';
  const relChips = (bal.relief || []).map(r => `<span class="ec-sb-cov ec-sb-hi" title="${esc((EC_RELIEF[r.kind] || {}).name || r.kind)} активна">${(EC_RELIEF[r.kind] || {}).ic || '🤝'}</span>`).join('');
  return `<div class="ec-sb">
    <span class="ec-sb-pill ec-sb-${st}" title="Просперити системы — множитель дохода домиков.">просперити ×${pr.toFixed(2)} · ${stTxt}</span>
    ${chip('👷', 'Труд', cov.l)}${chip('⛏', 'Сырьё', cov.r)}${spill}${evChip}${popChip}${revChip}${relChips}
  </div>`;
}

// ── Бедность (срез 6): сводка державы, карточки бедных систем, меры помощи ──
// Меры зеркалят RPC poverty_relief: множитель цены на эффективное население системы.
const EC_RELIEF = {
  subsidy: { ic: '💰', name: 'Дотация', short: 'деньги → просперити',
    desc: '+0.25 просперити на 5 дней. Деньги напрямую поднимают доход системы — лечит симптом, не корень.', mul: 450, min: 15000 },
  ration:  { ic: '📦', name: 'Снабжение', short: 'гасит напряжение',
    desc: '−3 напряжения сразу + малый буст просперити на 3 дня. Быстро сбивает волнения и стагнацию.', mul: 300, min: 10000 },
  import:  { ic: '🚀', name: 'Экстренный импорт', short: 'закрывает дефицит',
    desc: '+0.15 просперити на 7 дней и тормозит рост напряжения. Затыкает провал снабжения, пока строите производство.', mul: 350, min: 12000 },
};
function ecPovActive(bal, kind) {
  return (bal.relief || []).some(r => r.kind === kind && (!r.until || new Date(r.until).getTime() > Date.now()));
}
function ecReliefCost(bal, kind) {
  const cfg = EC_RELIEF[kind]; if (!cfg) return 0;
  return Math.max(cfg.min, Math.ceil((+bal.pop || 0) * cfg.mul));
}
// Сводка бедности по всем системам державы (для обзора и заголовка секции).
function ecPovertyStats() {
  const arr = Object.values(EC.spatial || {});
  const now = Date.now();
  let totPop = 0, poorPop = 0, unrest = 0, stagn = 0, revolt = 0, relief = 0;
  arr.forEach(b => {
    const pop = +b.pop || 0; totPop += pop;
    if (b.status === 'stagnation') { stagn++; poorPop += pop; }
    else if (b.status === 'unrest') { unrest++; poorPop += pop; }
    if (b.revolt_until && new Date(b.revolt_until).getTime() > now) revolt++;
    if ((b.relief || []).some(r => !r.until || new Date(r.until).getTime() > now)) relief++;
  });
  return { n: arr.length, unrest, stagn, revolt, relief, totPop, poorPop,
    poorPct: totPop > 0 ? Math.round(poorPop / totPop * 100) : 0 };
}
// Что именно «провисает» в системе — причины дефицита (для карточки).
function ecPovDeficits(bal) {
  const cov = bal.coverage || {};
  const items = [['l', '👷 Труд'], ['r', '⛏ Сырьё']];
  return items.filter(([k]) => (cov[k] == null ? 1 : +cov[k]) < 0.7)
    .map(([k, label]) => ({ k, label, cov: cov[k] == null ? 1 : +cov[k] }));
}
// Бедные системы (волнения/стагнация/бунт), самые тяжёлые сверху.
function ecPovPoorSystems() {
  const now = Date.now();
  return Object.values(EC.spatial || {})
    .filter(b => b.status === 'unrest' || b.status === 'stagnation'
      || (b.revolt_until && new Date(b.revolt_until).getTime() > now)
      || (b.pop_mult != null && +b.pop_mult < 0.995))
    .sort((a, b) => (+a.prosperity || 1) - (+b.prosperity || 1));
}

// ГС/сут, теряемые из-за просперити<1 в бедных системах (фабрики+хабы режутся
// множителем просперити в economy_accrue). «Цена бедности» для обзора/казны.
function ecPovertyDrag() {
  const gcMul = (typeof ecGcMul === 'function') ? ecGcMul() : 1;
  let lost = 0;
  (EC.buildings || []).forEach(b => {
    if (b.btype !== 'factory' && b.btype !== 'trade') return;
    const bal = ecBuildingSysBal(b);
    const pr = bal ? (+bal.prosperity || 1) : 1;
    if (pr >= 1) return;
    const d = EC_BUILD[b.btype]; if (!d) return;
    const base = (d.inc.gc || 0) * b.slots_open;
    lost += base * (1 - pr) * gcMul;
  });
  return Math.round(lost);
}
// Компактная панель в обзоре кабинета: индекс бедности державы.
function ecPovertyPanel() {
  const s = ecPovertyStats();
  if (!s.n) return '';
  const poor = s.unrest + s.stagn;
  const cls = s.stagn || s.revolt ? 'bad' : (s.unrest ? 'warn' : 'ok');
  const headVal = poor ? `${poor} / ${s.n}` : `0`;
  const desc = poor
    ? `Плотная застройка/нехватка рабочих рук слегка давит доход и понемногу гонит население. Разрядите застройку или помогите системам во вкладке «Благополучие».`
    : `Все системы держатся в достатке — бедности нет.`;
  const drag = ecPovertyDrag();
  const reliefActive = Object.values(EC.spatial || {}).reduce((a, b) => a + ((b.relief || []).filter(r => !r.until || new Date(r.until).getTime() > Date.now()).length), 0);
  const top = ecPovPoorSystems().slice(0, 3).map(b => {
    const st = b.status === 'stagnation' ? 'стагнация' : (b.status === 'unrest' ? 'волнения' : 'отток');
    return `<button type="button" class="ec-pov-mini" onclick="ecSetTab('welfare')">
      <span class="ec-pov-mini-n">🌐 ${esc(b.name || 'Система')}</span>
      <span class="ec-pov-mini-st ec-sb-${b.status || 'ok'}">${st} · ×${(+b.prosperity || 1).toFixed(2)}</span>
    </button>`;
  }).join('');
  return `<div class="ec-ovx-panel ec-ovx-half ec-pov-panel ec-pov-${cls}">
    <div class="ec-ovx-panel-t">⚖ Бедность <span class="ec-ovx-panel-sub">благополучие систем</span></div>
    <div class="ec-ovx-stat-grid">
      <div class="ec-ovx-stat"><div class="ec-ovx-stat-v ec-pov-v-${cls}">${headVal}</div><div class="ec-ovx-stat-k">Бедных систем</div></div>
      <div class="ec-ovx-stat"><div class="ec-ovx-stat-v">${s.poorPct}%</div><div class="ec-ovx-stat-k">Населения в нужде</div></div>
      <div class="ec-ovx-stat"><div class="ec-ovx-stat-v ec-pov-v-${s.revolt ? 'bad' : 'ok'}">${s.revolt || 0}</div><div class="ec-ovx-stat-k">🔥 Восстаний</div></div>
      <div class="ec-ovx-stat"><div class="ec-ovx-stat-v ec-pov-v-ok">${s.relief || 0}</div><div class="ec-ovx-stat-k">🤝 Под помощью</div></div>
    </div>
    <div class="ec-ovx-stat-grid" style="margin-top:8px">
      <div class="ec-ovx-stat ec-ovx-stat-wide" data-tip="Сколько ГС/сут недополучает казна из-за просперити<1 в бедных системах (фабрики и торговые хабы режутся множителем просперити). Это и есть «цена бедности» — поднимите благополучие, чтобы вернуть доход.">
        <div class="ec-ovx-stat-k">💸 Потери дохода от бедности</div>
        <div class="ec-ovx-stat-barline"><b style="color:${drag ? 'var(--err,#e05050)' : 'var(--t4)'}">${drag ? '−' + ecNum(drag) : '0'}</b> ГС/сут${reliefActive ? ` · 🤝 активных мер помощи: <b>${reliefActive}</b>` : ''}</div>
      </div>
    </div>
    <div class="ec-ovx-hint">${desc}</div>
    ${top ? `<div class="ec-pov-minis">${top}</div>` : ''}
    ${poor ? `<button class="btn btn-gh btn-sm" onclick="ecSetTab('welfare')" style="margin-top:8px">⚖ Открыть благополучие →</button>` : ''}
  </div>`;
}

// Одна причина «почему доход такой»: множитель + бар + объяснение словами + что делать.
function ecWhyRow(ic, name, scope, mul, covPct, text, fix) {
  const pct = Math.max(0, Math.min(100, Math.round(covPct)));
  const cls = mul == null ? (pct < 40 ? 'lo' : pct < 70 ? 'mid' : 'hi')
    : (mul < 0.97 ? 'lo' : (mul > 1.03 ? 'hi' : 'mid'));
  return `<div class="ec-why-row ec-cov-${cls}">
    <div class="ec-why-head">
      <span class="ec-why-nm">${ic} ${name} <i class="ec-why-scope">${scope}</i></span>
      <span class="ec-cov-bar"><i style="width:${pct}%"></i></span>
      <b class="ec-why-mul">${mul == null ? pct + '%' : '×' + mul.toFixed(2)}</b>
    </div>
    <div class="ec-why-txt">${text}${fix ? ` <span class="ec-why-fix">→ ${fix}</span>` : ''}</div>
  </div>`;
}

// Раскрываемая панель под строкой системы: итог + причины словами + меры помощи.
function ecWelfareDetail(bal, isCap) {
  const pr = +bal.prosperity || 1;
  const cov = bal.coverage || {};
  const g = ecGoodsInfo();
  const total = pr * g.welfare;
  const totCls = total < 0.97 ? 'lo' : (total > 1.03 ? 'hi' : 'mid');
  const totWord = total < 0.97 ? 'меньше обычного' : (total > 1.03 ? 'больше обычного' : 'обычный доход');
  const verdict = `<div class="ec-wf-verdict">Постройки этой системы приносят
    <b class="ec-cov-${totCls}">×${total.toFixed(2)}</b> дохода <span class="ec-why-scope">(${totWord})</span>.
    Ниже — из чего складывается и что подкрутить.</div>`;
  // причина 1: труд — своя для каждой системы
  const pop = Math.round(+bal.pop || 0);
  const jobs = Math.round((bal.labor && +bal.labor.demand) || 0);
  const cl = cov.l == null ? 1 : +cov.l;
  const labTxt = jobs <= 0 ? `Рабочих построек нет — труд не ограничивает.`
    : cl >= 1 ? `Жителей ${ecNum(pop)}, рабочих мест ${ecNum(jobs)} — рук хватает всем, есть запас.`
    : `Жителей ${ecNum(pop)}, а рабочих мест ${ecNum(jobs)} — люди закрывают только ${Math.round(cl * 100)}% мест, остальные постройки простаивают.`;
  const labFix = jobs > 0 && cl < 1
    ? `ждать роста населения (поднимите соцобеспечение/товары в бюджете) или снести часть построек`
    : (pr > 1.05 ? `можно ставить ещё доходные постройки` : '');
  // причина 2: товары — ОДИН множитель на всю державу
  const gPct = Math.round(g.cov * 100);
  const lowW = g.waterNeed > 0 && g.water < g.waterNeed;
  const lowM = g.matNeed > 0 && g.mat < g.matNeed;
  let gTxt, gFix = '';
  if (g.cov >= 1) {
    gTxt = `Фабрики товаров полностью кормят население державы товарами.`;
  } else if (g.slots <= 0) {
    gTxt = `Фабрик товаров нет — население державы сидит без товаров, доход везде срезан.`;
    gFix = `постройте 🛍 Фабрику товаров — множитель общий для всех систем`;
  } else if (g.ratio < 1) {
    const lacks = [lowW ? `воды (${ecNum(g.water)} из ${ecNum(g.waterNeed)})` : '', lowM ? `сырья (${ecNum(g.mat)} из ${ecNum(g.matNeed)})` : ''].filter(Boolean).join(' и ');
    gTxt = `Фабрика товаров есть, но простаивает: на складе не хватает ${lacks} — выпуск ${Math.round(g.ratio * 100)}% от полного.`;
    gFix = `добывайте ${EC_GOODS_WATER.join('/')} и ${EC_GOODS_MAT.join('/')} и держите запас на складе (режим «на склад» во «🔀 Потоках»)`;
  } else {
    gTxt = `Фабрика работает (+${ecNum(Math.round(g.made))} товаров/сут), но это лишь ${gPct}% спроса населения державы.`;
    gFix = `откройте больше слотов Фабрики товаров`;
  }
  const why = `<div class="ec-wf-why">
    ${ecWhyRow('👷', 'Труд', 'только эта система', pr, cl * 100, labTxt, labFix)}
    ${ecWhyRow('🛍', 'Товары', 'вся держава', g.welfare, gPct, gTxt, gFix)}
    ${ecRawWhyRow(bal)}
  </div>`;
  const mult = verdict + why;
  let acts;
  if (isCap) {
    acts = `<div class="ec-wf-d-cap">★ Столица не беднеет никогда — экстренные меры ей не нужны.</div>`;
  } else {
    const btns = Object.keys(EC_RELIEF).map(kind => {
      const cfg = EC_RELIEF[kind];
      const cost = ecReliefCost(bal, kind);
      const active = ecPovActive(bal, kind);
      const afford = (EC.eco.gc || 0) >= cost;
      const dis = active || !afford;
      return `<button class="ec-relief-btn ec-relief-${kind}${active ? ' is-active' : ''}${!afford && !active ? ' is-off' : ''}" ${dis ? 'disabled' : ''}
        title="${esc(cfg.desc)}" onclick="ecReliefApply('${esc(bal.system_id)}','${kind}')">
        <span class="ec-relief-ic">${cfg.ic}</span>
        <span class="ec-relief-main"><span class="ec-relief-n">${esc(cfg.name)}</span><span class="ec-relief-s">${esc(cfg.short)}</span></span>
        <span class="ec-relief-cost">${active ? '✓ активно' : ecNum(cost) + ' ГС'}</span>
      </button>`;
    }).join('');
    acts = `<div class="ec-pov-acts-k">Экстренная помощь за ГС (временная):</div><div class="ec-pov-card-acts">${btns}</div>`;
  }
  return `${mult}${acts}`;
}

// Причина 3 (показываем ТОЛЬКО если в системе есть фабрики): хватает ли им сырья.
// Сырьё не режет доход напрямую — оно двигает местные цены, поэтому строка отдельная.
function ecRawWhyRow(bal) {
  const demR = (bal.demand && +bal.demand.r) || 0;
  if (demR <= 0) return '';
  const supR = (bal.supply && +bal.supply.r) || 0;
  const cr = (bal.coverage && bal.coverage.r != null) ? +bal.coverage.r : 1;
  const prR = (bal.prices && +bal.prices.r) || 1;
  const txt = cr >= 1 ? `Добывающие заводы дают ${ecNum(Math.round(supR))} сырья — фабрикам системы хватает.`
    : `Фабрикам системы нужно ${ecNum(Math.round(demR))} сырья, заводы дают только ${ecNum(Math.round(supR))} (${Math.round(cr * 100)}%). Это не режет доход, но местное сырьё дороже (цена ×${prR.toFixed(2)}).`;
  const fix = cr < 1 ? `постройте добывающий завод в этой системе или у соседей` : '';
  return ecWhyRow('⛏', 'Сырьё', 'снабжение фабрик', null, cr * 100, txt, fix);
}

// Одна строка системы: имя · доход(благополучие) · товарная цена · труд · жители · места · статус.
// Клик по строке разворачивает детали (множители + меры) прямо под ней — без отдельных карточек.
function ecWelfareSysRow(bal, isCap) {
  const pr = +bal.prosperity || 1;
  const cl = (bal.coverage && bal.coverage.l != null) ? +bal.coverage.l : 1;
  const pop = Math.round(+bal.pop || 0);
  const jobs = Math.round((bal.labor && +bal.labor.demand) || 0);
  const popM = bal.pop_mult == null ? 1 : +bal.pop_mult;
  const st = isCap ? 'ok' : (bal.status || 'ok');
  const prCls = pr < 0.93 ? 'lo' : (pr < 1.05 ? 'mid' : 'hi');
  const clPct = Math.round(cl * 100);
  const clCls = cl < 0.5 ? 'lo' : (cl < 0.8 ? 'mid' : 'hi');
  const stTxt = isCap ? '★ столица' : (st === 'stagnation' ? 'стагнация' : st === 'unrest' ? 'волнения' : 'в достатке');
  const sid = esc(bal.system_id);
  const revolt = bal.revolt_until && new Date(bal.revolt_until).getTime() > Date.now();
  return `<div class="ec-wf-item" id="wf-i-${sid}">
    <div class="ec-wf-row" role="button" tabindex="0" onclick="ecWfToggle('${sid}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ecWfToggle('${sid}')}">
      <div class="ec-wf-nm"><span class="ec-wf-caret">▸</span>🌐 ${esc(bal.name || 'Система')}${isCap ? ' <span class="ec-wf-cap">★</span>' : ''}${revolt ? ' 🔥' : ''}</div>
      <div class="ec-wf-pr ec-cov-${prCls}" title="Благополучие — множитель дохода всех построек системы">×${pr.toFixed(2)}</div>
      <div class="ec-wf-bar ec-cov-${clCls}" title="Покрытие труда: население ÷ рабочие места"><span class="ec-cov-bar"><i style="width:${Math.min(100, clPct)}%"></i></span><b>${clPct}%</b></div>
      <div class="ec-wf-pop" title="Жители системы (доля заселённости)">👥 ${ecNum(pop)}${popM < 0.995 ? ` <span class="ec-cov-lo">${Math.round(popM * 100)}%</span>` : ''}</div>
      <div class="ec-wf-jobs" title="Рабочих мест требуют постройки">👷 ${ecNum(jobs)}</div>
      <div class="ec-wf-st ec-sb-${st}">${stTxt}</div>
    </div>
    <div class="ec-wf-detail">${ecWelfareDetail(bal, isCap)}</div>
  </div>`;
}
// Развернуть/свернуть детали строки системы (без перерисовки всей вкладки).
function ecWfToggle(sid) { document.getElementById('wf-i-' + sid)?.classList.toggle('open'); }

// ── Панель «Бюджет державы»: 5 ползунков финансирования ─────
// Ползунки правят слоты построек (авто, от населения), скорость военпрома,
// науку, благополучие и склады. Зеркало _budget_wellbeing.sql.
function ecBudgetPanel() {
  const pop = ecBudgetPop();
  const rows = Object.keys(EC_BUDGET).map(k => {
    const d = EC_BUDGET[k], lvl = ecBudgetLvl(k);
    const cost = Math.round(EC_BUDGET_W[lvl] * d.k * pop * ecBudgetPopMult(pop));
    const eff = k === 'military'
      ? (lvl === 0 ? '⛔ юниты не строятся' : `постройка юнитов ×${d.mults[lvl]} времени`)
      : d.mults ? `множитель ×${d.mults[lvl].toFixed(2)}` : `до ${EC_BUDGET_SLOTS[lvl]} слот./постройка`;
    const dots = [0, 1, 2, 3, 4].map(i =>
      `<button class="ec-bud-dot${i <= lvl ? ' on' : ''}${i === lvl ? ' cur' : ''}" title="${EC_BUDGET_LVL[i]}" onclick="ecBudgetSet('${k}',${i})"></button>`).join('');
    return `<div class="ec-bud-row" data-tip="${esc(d.desc)}">
      <span class="ec-bud-ic">${d.ic}</span>
      <span class="ec-bud-nm">${d.name}<i class="ec-bud-lvl">${EC_BUDGET_LVL[lvl]}</i></span>
      <span class="ec-bud-dots">${dots}</span>
      <span class="ec-bud-eff">${eff}</span>
      <span class="ec-bud-cost">${cost ? `−${ecNum(cost)} ГС/сут` : '—'}</span>
    </div>`;
  }).join('');
  const cap = ecBudgetPopCap();
  const grB = ecBudgetGrowthBase(), grG = ecBudgetGrowthGoods(), gr = grB + grG;
  const dPop = Math.round(pop * gr);
  const jobs = Math.floor(pop / EC_POP_PER_SLOT);
  const grTxt = gr >= 0 ? `+${(gr * 100).toFixed(1)}%` : `${(gr * 100).toFixed(1)}%`;
  const grCls = gr < 0 ? 'ec-cov-lo' : (gr < 0.015 ? 'ec-cov-mid' : 'ec-cov-hi');
  return `<div class="ec-bud-panel">
    <div class="ec-section-title">🏛 Бюджет державы <span class="ec-hint">— цена растёт с населением и уровнем</span></div>
    <div class="ec-bud-pop">
      <span class="ec-bud-pop-i" data-tip="Население живёт в ячейках колоний: потолок = ячейки × ${EC_POP_CAP_CELL}. Колонизация и терраформ добавляют ячейки — поднимают потолок.">👥 Население <b>${ecNum(pop)}</b> / ${ecNum(cap)}</span>
      <span class="ec-bud-pop-i ${grCls}" data-tip="Прирост = соцобеспечение (${(grB * 100).toFixed(1)}%: ${EC_POP_GROWTH.map((g, i) => `${EC_BUDGET_LVL[i]} ${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)}%`).join(' · ')}) + товары (${grG >= 0 ? '+' : ''}${(grG * 100).toFixed(1)}%: полное обеспечение Фабрикой товаров даёт до +1.0%/сут).">${gr >= 0 ? '📈' : '📉'} ${grTxt}/сут (${dPop >= 0 ? '+' : ''}${ecNum(dPop)} чел.) <i style="font-style:normal;opacity:.7">⚖${(grB * 100).toFixed(1)} + 🛍${(grG * 100).toFixed(1)}</i></span>
      <span class="ec-bud-pop-i" data-tip="Каждый рабочий слот постройки требует ${EC_POP_PER_SLOT} жителей. Не хватает рук — слоты всех построек срезаются пропорционально.">👷 хватает на <b>${ecNum(jobs)}</b> слот.</span>
    </div>
    <div class="ec-bud-legend">Как это играется: <b>население</b> — и налоговая база, и рабочие руки (${EC_POP_PER_SLOT} жителей = 1 слот постройки; слоты двигают доход, науку и темп добычи). Растёт от <b>соцобеспечения</b> и <b>товаров</b> (Фабрика товаров), потолок поднимают новые ячейки (колонизация/терраформ). Цена уровней <b>прогрессивная</b> (веса ${EC_BUDGET_W.join('/')}): «норма» дешёвая, «максимум» кусается. Итог: <b>−${ecNum(ecBudgetUpkeep())} ГС/сут</b> · благополучие ×${ecBudgetGcMult().toFixed(2)} ко всему доходу.</div>
    ${rows}
  </div>`;
}
async function ecBudgetSet(key, lvl) {
  if (EC.busy) return;
  const b = { industry: ecBudgetLvl('industry'), military: ecBudgetLvl('military'), science: ecBudgetLvl('science'), social: ecBudgetLvl('social'), infra: ecBudgetLvl('infra') };
  if (b[key] === lvl) return;
  b[key] = lvl;
  EC.busy = true;
  try {
    await ecRpc('budget_set', { p_industry: b.industry, p_military: b.military, p_science: b.science, p_social: b.social, p_infra: b.infra });
    toast(`${EC_BUDGET[key].ic} ${EC_BUDGET[key].name}: ${EC_BUDGET_LVL[lvl]}`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
  finally { EC.busy = false; }
}

// Вкладка «Благополучие»: одна интерактивная таблица систем (клик по строке = детали + меры).
function ecTabWelfare() {
  const head = `${ecBudgetPanel()}<div class="ec-section-title">⚖ Благополучие систем <span class="ec-hint">— нажмите на строку системы, чтобы увидеть подробности</span></div>
    <div class="ec-wf-legend">Простыми словами: чем больше в системе <b>жителей</b> относительно её построек — тем выше её доход. А <b>🛍 Фабрики товаров</b> дают общий бонус (или штраф) сразу всей державе. Зелёное — хорошо, жёлтое/красное — теряете деньги.</div>`;
  if (!Object.keys(EC.spatial || {}).length) {
    return `${head}<div class="ec-empty">Пока нет систем с колониями — благополучие появится, когда заселите планеты.</div>`;
  }
  const capSet = new Set((EC.colonies || []).filter(c => c.is_capital).map(c => c.system_id));
  const all = Object.values(EC.spatial).slice().sort((a, b) => (+a.prosperity || 1) - (+b.prosperity || 1));
  const s = ecPovertyStats();
  const drag = ecPovertyDrag();
  const gInfo = ecGoodsInfo();
  const gCls = gInfo.welfare < 0.97 ? 'stagnation' : (gInfo.welfare > 1.03 ? 'ok' : '');
  const summary = `<div class="ec-pov-sum">
    <span class="ec-pov-sum-i">⚖ <b>${ecNum(all.length)}</b> систем(ы)</span>
    <span class="ec-pov-sum-i ec-sb-${gCls}" data-tip="Общий бонус к доходу всех систем от Фабрик товаров. Меньше ×1.00 — товаров не хватает, стройте Фабрики товаров.">🛍 товары: доход <b>×${gInfo.welfare.toFixed(2)}</b>${gInfo.welfare >= 1 ? '' : gInfo.slots > 0 ? ' — фабрика простаивает' : ' — стройте фабрики товаров'}</span>
    <span class="ec-pov-sum-i ec-sb-${s.stagn ? 'stagnation' : (s.unrest ? 'unrest' : 'ok')}" data-tip="Системы в волнениях или стагнации — раскройте их строки ниже, там же кнопки помощи."><b>${ecNum(s.unrest + s.stagn)}</b> бедных систем</span>
    <span class="ec-pov-sum-i" data-tip="Доля жителей державы, живущих в бедных системах."><b>${s.poorPct}%</b> населения в нужде</span>
    ${drag ? `<span class="ec-pov-sum-i ec-sb-stagnation" title="Сколько ГС/сут недополучает казна из-за благополучия<1 в бедных системах">💸 <b>−${ecNum(drag)}</b> ГС/сут от бедности</span>` : ''}
    ${s.revolt ? `<span class="ec-pov-sum-i ec-sb-stagnation">🔥 <b>${ecNum(s.revolt)}</b> беспорядков</span>` : ''}
    ${s.relief ? `<span class="ec-pov-sum-i ec-sb-ok">🤝 <b>${ecNum(s.relief)}</b> под помощью</span>` : ''}
  </div>`;
  const table = `<div class="ec-wf-table">
      <div class="ec-wf-head"><span>Система</span><span>Доход</span><span>Труд</span><span>Жители</span><span>Места</span><span>Статус</span></div>
      ${all.map(b => ecWelfareSysRow(b, capSet.has(b.system_id))).join('')}
    </div>`;
  return `${head}${summary}${table}`;
}

// Применить меру помощи системе (тратит ГС). Зеркало RPC poverty_relief.
async function ecReliefApply(systemId, kind) {
  if (EC.busy) return;
  const bal = EC.spatial && EC.spatial[systemId];
  if (!bal) return;
  const cfg = EC_RELIEF[kind]; if (!cfg) return;
  const cost = ecReliefCost(bal, kind);
  if ((EC.eco.gc || 0) < cost) { toast(`Недостаточно ГС: нужно ${ecNum(cost)}`, 'err'); return; }
  if (!confirm(`${cfg.ic} ${cfg.name} для системы «${bal.name || ''}» за ${ecNum(cost)} ГС?\n${cfg.desc}`)) return;
  await ecRpcAct('poverty_relief', { p_system_id: systemId, p_kind: kind }, `${cfg.ic} ${cfg.name}: помощь оказана`);
}

// ── Инициализация экономики (без начисления!) ───────────────
// Доход начисляется И сервером (pg_cron -> economy_tick_all раз в сутки для
// всех), И при заходе в кабинет (economy_tick — «догоняет» накопленные сутки
// сразу, чтобы не висело «готов к начислению»). Двойного начисления нет:
// economy_tick делает FOR UPDATE и двигает last_tick на целые сутки.
// Дедуп промиса — чтобы повторный рендер не дёргал тик параллельно.
let _ecBoot = null;
// Доход считается СЕРВЕРОМ по целым суткам (от last_tick). Поэтому дёргать тик на
// каждом заходе в кабинет бессмысленно — доход тот же, а каждый вызов = записи в БД
// (FOR UPDATE + цепочка market_tick→*_settle). Зовём не чаще раза в N минут на
// фракцию (метка в localStorage). Это БЕЗ ПОТЕРЬ дохода — лишь реже трогаем диск.
const EC_TICK_THROTTLE_MS = 3 * 60 * 1000;
function _ecTickKey() { return 'ec_lasttick_' + ((EC.app && EC.app.faction_id) || 'x'); }
function _ecTickThrottled() {
  try {
    const last = +localStorage.getItem(_ecTickKey()) || 0;
    return last && (Date.now() - last < EC_TICK_THROTTLE_MS);
  } catch (e) { return false; }   // нет localStorage — не троттлим
}
async function ecBootOnce() {
  if (_ecBoot) return _ecBoot;
  if (_ecTickThrottled()) return null;   // недавно тикали — пропускаем лишние записи в БД
  _ecBoot = (async () => {
    await ecRpc('economy_init');
    const tick = await ecRpc('economy_tick');
    try { localStorage.setItem(_ecTickKey(), String(Date.now())); } catch (e) {}
    // Тост — РОВНО ОДИН раз на реальный тик (а не на каждый вызов рендера,
    // иначе при повторных рендерах из init было двойное оповещение).
    if (tick && tick.days >= 1) {
      const parts = [];
      if (tick.income && tick.income.gc) parts.push(`+${ecNum(tick.income.gc * tick.days)} ГС`);
      if (tick.income && tick.income.science) parts.push(`+${ecNum(tick.income.science * tick.days)} ОН`);
      if (parts.length) toast(`Доход за ${tick.days} сут.: ${parts.join(' · ')}`, 'ok');
      // Пираты срезали караваны за этот период — иначе доход «меньше превью» без объяснений.
      if (tick.income && tick.income.pirate) {
        const lost = tick.income.pirate_loss ? ` (~${ecNum(tick.income.pirate_loss)} ГС)` : '';
        toast(`🏴‍☠ Караваны атакованы пиратами — потеряно${lost} торгового дохода`, 'err');
      }
    }
    return tick;
  })();
  _ecBoot.finally(() => setTimeout(() => { _ecBoot = null; }, 2000));
  return _ecBoot;
}

// ── Вход в кабинет чужой фракции (администрация) ─────────────
// Стафф открывает экономику/кабинет глазами владельца — для проверки и помощи.
// Игрок не снимается, владелец не меняется: это режим просмотра. Серверные
// RPC (тик дохода, постройки) резолвят фракцию по auth.uid(), поэтому при
// impersonation суточный тик НЕ запускаем — только читаем данные фракции.
async function ecEnterAsFaction(fid) {
  if (!ecIsStaff()) { toast('Только администрация', 'err'); return; }
  if (!fid) return;
  try {
    const rows = await dbGet('faction_applications', `faction_id=eq.${encodeURIComponent(fid)}&status=eq.approved&order=updated_at.desc&limit=1`);
    const app = rows && rows[0];
    if (!app) { toast('Одобренная анкета фракции не найдена', 'err'); return; }
    EC.app = app;
    EC.myAppUid = user.id;                 // фиксируем кэш — ecLoadApp не перезатрёт чужой анкетой
    EC.actAs = { fid, name: app.name };    // флаг режима администрации
    go('economy', false);
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}

// Выйти из чужого кабинета — сбросить кэш анкеты и вернуться в консоль.
function ecExitImpersonation() {
  EC.actAs = null;
  EC.app = null; EC.myAppUid = null;       // следующий ecLoadApp подтянет свою (или пусто)
  go('admin', false);
}

// ── Точка входа (#economy) ──────────────────────────────────
async function ecRenderDashboard() {
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  await ecLoadApp();
  if (!ecCanAccess()) { ecGate(); return; }
  if (!EC.app || !EC.app.faction_id) {
    setPg(`<div class="ec-gate"><div class="ec-gate-ico">💰</div>
      <h2>Экономика государства</h2>
      <p>Экономика привязана к одобренной фракции. У вашего аккаунта нет одобренной анкеты — создайте и проведите её через модерацию.</p>
      <button class="btn btn-gd" onclick="go('factions')">К фракциям</button></div>`);
    return;
  }
  try {
    if (!EC.actAs) await ecBootOnce();   // создаём экономику + начисляем доход (тост внутри). В режиме администрации тик не запускаем — он резолвит фракцию по auth.uid()
    // ФАЗА 1: ядро — кабинет появляется СРАЗУ, не дожидаясь биржи/веры/обороны/артиллерии.
    await _ecLoadCore();
    ecPaintCabinet();
    // Личные сообщения админа этой фракции — всплывают 1 раз при входе в кабинет.
    if (typeof fnCheckPrivatePopup === 'function') fnCheckPrivatePopup(EC.app.faction_id);
    // ФАЗА 2: подсистемы вкладок догружаем фоном; по готовности до-рисовываем экран,
    // если игрок ещё в кабинете (мог уйти на карту/в вики за время загрузки).
    _ecLoadRest().then(() => {
      if (curSlug === 'economy' && EC.app && EC.app.faction_id) ecPaintCabinet();
    }).catch(() => {});
  } catch (e) {
    // Никакого вечного спиннера — показываем причину и кнопку повтора
    setPg(`<div class="ec-wrap"><div class="sempty" style="gap:12px;flex-direction:column">
      <div style="font-size:32px;opacity:.2">⏱</div>
      <div style="font-size:13px;color:var(--t2)">Не удалось загрузить экономику</div>
      <div style="font-size:11px;color:var(--t4);max-width:320px;text-align:center">${esc(e.message)}<br>Если повторяется — возможно, не выполнен _economy_setup.sql, либо сервер ещё «просыпается».</div>
      <button class="btn btn-gh" onclick="go('economy',false)">↺ Повторить</button>
    </div></div>`);
  }
}

function ecGate() {
  setPg(`<div class="ec-gate">
    <div class="ec-gate-ico">💰</div>
    <h2>Экономика государства</h2>
    <p>Доступно игрокам с одобренной анкетой государства и администрации.</p>
    ${user
      ? `<button class="btn btn-gd" onclick="go('factions')">К фракциям</button>`
      : `<button class="btn btn-gd" onclick="showAuth('login')">Войти</button>`}
  </div>`);
}

// Кэш «статики» на сессию: данные, которые НЕ меняются по ходу игры (топология
// гиперпутей, раскладка/связи дерева технологий, пул портретов). Грузим один раз,
// а не на каждой перезагрузке кабинета — меньше запросов и трафика к БД.
// Сброс — обычным обновлением страницы (F5): кэш в памяти, переживает только сессию.
const _ecStaticCache = {};
function ecCached(key, fetcher) {
  if (key in _ecStaticCache) return Promise.resolve(_ecStaticCache[key]);
  return fetcher().then(v => { _ecStaticCache[key] = v; return v; }).catch(() => []);  // ошибку не кэшируем — повторим в следующий раз
}

// Дедуп параллельных загрузок: пока один ecLoad в полёте, повторные вызовы
// (быстрые действия подряд, двойной рендер) ждут его, а не запускают ещё ~40 RPC.
let _ecLoadInFlight = null, _ecCoreInFlight = null, _ecRestInFlight = null;
// Полная загрузка (ядро + подсистемы) — для перезагрузки кабинета после действий.
async function ecLoad() {
  if (_ecLoadInFlight) return _ecLoadInFlight;
  _ecLoadInFlight = (async () => { await _ecLoadCore(); await _ecLoadRest(); })();
  try { return await _ecLoadInFlight; }
  finally { _ecLoadInFlight = null; }
}
// ── ФАЗА 1 (ядро) ── Данные для обложки, казны и стартовых вкладок (Обзор/Колонии/
// Силы/Территория). Грузится ПЕРЕД первой отрисовкой — кабинет появляется сразу, не
// дожидаясь биржи/веры/обороны/артиллерии. Тяжёлые подсистемы вкладок — в _ecLoadRest.
async function _ecLoadCore() {
  if (_ecCoreInFlight) return _ecCoreInFlight;
  _ecCoreInFlight = _ecLoadCoreImpl();
  try { return await _ecCoreInFlight; }
  finally { _ecCoreInFlight = null; }
}
async function _ecLoadCoreImpl() {
  EC.fid = EC.app.faction_id;
  const fid = encodeURIComponent(EC.fid);
  // Безопасные дефолты подсистем фазы 2: клик по их вкладке ДО загрузки не падает на
  // undefined, а показывает пустое состояние — до прихода данных и до-рисовки кабинета.
  ecResetDeferred();
  const [ecoRows, cols, blds, designs, prod, allSys, lanes, facs, routes, loans, missions, projects, alerts, relations, barters, techOffers, myRaids, raidStatus, tradeCargo, incomeHistory, spatial, sectors, market, marketCfg, diploStatus, spyAgency, defMines, resFlows, concessions, concSlots, concInfo, budgetRows] = await Promise.all([
    dbGet('faction_economy', `faction_id=eq.${fid}`),
    dbGet('colonies', `faction_id=eq.${fid}&order=created_at.asc`).catch(() => []),
    dbGet('colony_buildings', `faction_id=eq.${fid}&order=created_at.asc`).catch(() => []),
    dbGet('faction_units', `or=(faction_id.eq.${fid},faction_id.is.null)&order=name.asc`).catch(() => []),
    dbGet('unit_production', `faction_id=eq.${fid}&order=created_at.desc`).catch(() => []),
    dbGet('map_systems', `select=id,name,faction,x,y,planets`).catch(() => []),
    ecCached('lanes', () => dbGet('map_hyperlanes', `select=a_id,b_id`)),   // топология гиперпутей не меняется по ходу игры — кэш на сессию
    dbGet('faction_applications', `status=eq.approved&select=faction_id,name,herald_url,color,gov,leader,race&order=name.asc`).catch(() => []),
    dbGet('trade_routes', `order=created_at.desc`).catch(() => []),
    dbGet('loans', `order=created_at.desc`).catch(() => []),
    // ТОЛЬКО свои операции (приватность); цель видит входящие через RPC (исполнитель скрыт, если не раскрыт)
    dbGet('spy_missions', `actor_fid=eq.${fid}&order=created_at.desc&limit=40`).catch(() => []),
    dbGet('colony_projects', `faction_id=eq.${fid}&order=ready_at.asc`).catch(() => []),
    ecRpc('spy_incoming').catch(() => []),
    // Отношения: только свои пары (RLS отдаёт где я from или to)
    dbGet('faction_relations', `or=(from_fid.eq.${fid},to_fid.eq.${fid})`).catch(() => []),
    dbGet('barter_offers', `status=eq.pending&order=created_at.desc`).catch(() => []),
    dbGet('tech_offers', `status=eq.pending&order=created_at.desc`).catch(() => []),
    dbGet('raid_missions', `actor_fid=eq.${fid}&order=created_at.desc&limit=40`).catch(() => []),
    ecRpc('raid_status').catch(() => null),
    ecRpc('trade_capacity').catch(() => null),   // грузоподъёмность торгового флота
    dbGet('income_history', `owner_id=eq.${user.id}&order=tick_at.desc&limit=30`).catch(() => []),  // доход по времени (графики статистики)
    ecRpc('spatial_status').catch(() => []),   // пространственная экономика: NET-баланс систем (просперити Обзора)
    dbGet('map_sectors', `select=id,name,system_ids,econ_event,econ_mod,econ_until`).catch(() => []),   // сектора + эконом-события
    dbGet('market_resources', `select=name,base_price,price,stock,equilibrium,npc_supply,npc_demand`).catch(() => []),  // галактический рынок
    dbGet('market_config', `select=elasticity,clamp_lo,clamp_hi,reversion,volatility,npc_react,walk&limit=1`).catch(() => null),  // живые параметры рынка
    ecRpc('diplo_status').catch(() => null),         // союзы: федерация/конфедерация + вассалитеты (нужны Обзору)
    ecRpc('spy_recruits_list').catch(() => null),   // агентура: ростер + рынок рекрутов (счётчик в Обзоре)
    ecRpc('minefields_visible').catch(() => []),  // оборона: минные поля (счётчик в Обзоре)
    dbGet('faction_res_flows', `faction_id=eq.${fid}`).catch(() => []),   // потоки: настройки по ресурсам (вкладка «Потоки»)
    dbGet('mining_concessions', `or=(from_fid.eq.${fid},to_fid.eq.${fid})&order=created_at.desc`).catch(() => []),  // концессии (право добычи)
    dbGet('concession_slots', `order=created_at.asc`).catch(() => []),   // купленные слоты концессионера (RLS отдаёт мои и на моих колониях)
    ecRpc('concessions_info').catch(() => []),   // имена планет/систем концессионных колоний (чужие колонии по RLS не видны)
    dbGet('faction_budget', `faction_id=eq.${fid}`).catch(() => []),   // бюджет державы (ползунки финансирования)
  ]);
  EC.eco = (ecoRows && ecoRows[0]) || { gc: 0, science: 0, tnp: 0, last_tick: null };
  EC.colonies = cols || [];
  EC.buildings = blds || [];
  // Свои системы выводим из общего списка allSys (он уже содержит faction/planets) — без второго запроса к map_systems.
  EC.systems = (allSys || []).filter(s => String(s.faction) === String(EC.fid)).map(s => ({ ...s, planets: s.planets || [] }));
  EC.minefields = Array.isArray(defMines) ? defMines : [];      // оборона: видимые минные поля (гексы) — счётчик в Обзоре
  // Пространственная экономика: NET-баланс системы (покрытия R/G/C/труд, просперити, статус), индекс по system_id.
  EC.spatial = {};
  (Array.isArray(spatial) ? spatial : []).forEach(b => { if (b && b.system_id) EC.spatial[b.system_id] = b; });
  EC.sectors = Array.isArray(sectors) ? sectors : [];   // сектора карты + эконом-события (срез 4)
  EC.designs = (designs || []);
  EC.roster = (prod || []).filter(p => p.status === 'done');
  EC.queue = (prod || []).filter(p => p.status === 'queued');
  EC.damaged = (prod || []).filter(p => p.status === 'damaged' && p.category === 'ship');     // повреждённые в бою — чинит Верфь
  EC.repairing = (prod || []).filter(p => p.status === 'repairing' && p.category === 'ship'); // уже в ремонте
  EC.allSystems = (allSys || []).map(s => ({ ...s, x: +s.x, y: +s.y }));
  EC.lanes = lanes || [];
  EC.factions = (facs || []).filter(f => f.faction_id);
  EC.routes = routes || [];
  EC.loans = loans || [];
  EC.missions = missions || [];                 // мои операции (active + done)
  EC.alerts = alerts || [];                      // входящие операции против меня (исполнитель скрыт, если не раскрыт)
  EC.relations = relations || [];                // дипотношения (мои пары)
  EC.barters = barters || [];                    // активные предложения обмена (мои пары)
  EC.techOffers = techOffers || [];              // предложения продажи технологий/чертежей (мои пары)
  EC.raids = myRaids || [];                       // мои рейды (active + done)
  EC.raidStatus = raidStatus || { ships: 0, convoy: 0, raids: 0, policy: 0, free: 0 };  // статус флота
  EC.tradeCargo = tradeCargo || { total: 0, used: 0, free: 0 };   // грузоподъёмность торгового флота
  EC.spyAgency = spyAgency || { cap: 0, hired: 0, roster: [], recruits: [], refresh_at: null };  // агентура: ростер + рынок
  // Контрразведка с именным назначением (2 роли state/forces) — из spy_counter_list
  // (вложен в ответ spy_recruits_list). Падаем на пустой объект, если срез не накачен.
  EC.spyCounter = (EC.spyAgency && EC.spyAgency.counterintel) || { state_power: 0, forces_power: 0, assignments: [] };
  EC.diplo = diploStatus || { union: null, members: [], invites: [], vassals: [] };  // союзы и вассалитеты
  // Потоки: настройки по ресурсам (faction_res_flows → карта по имени) + концессии (обе стороны)
  EC.resFlows = {};
  (Array.isArray(resFlows) ? resFlows : []).forEach(f => { if (f && f.res_name) EC.resFlows[f.res_name] = f; });
  EC.concessions = Array.isArray(concessions) ? concessions : [];
  EC.concSlots = Array.isArray(concSlots) ? concSlots : [];   // слоты концессионера (extra/lease) по колониям
  EC.concInfo = {};   // colony_id → {planet_name, system_name} для подписей концессий
  (Array.isArray(concInfo) ? concInfo : []).forEach(x => { if (x && x.colony_id) EC.concInfo[x.colony_id] = x; });
  // Бюджет державы: ползунки 0..4 (дефолт 2 — «норма», зеркало _budget_wellbeing.sql)
  EC.budget = (Array.isArray(budgetRows) && budgetRows[0]) || { industry: 2, military: 2, science: 2, social: 2, infra: 2 };
  EC.incomeHistory = incomeHistory || [];   // снимки дохода по тикам (доход по времени)
  EC.dossiers = (missions || []).filter(m => m.outcome === 'success' && (m.op === 'recon_basic' || m.op === 'recon_deep')); // мои разведданные
  EC.projects = projects || [];
  // карта редкости/иконки ресурсов: сначала полный каталог (источник истины —
  // GalaxyGen.RESOURCES), затем поверх — данные из колоний/планет. Без сидирования
  // каталогом ресурс, лежащий «в запасе» без активной добычи (напр. начисленный
  // из админ-панели), не имел бы редкости и падал в 'common' (легендарное Гравиядро
  // показывалось как ОБЫЧНЫЙ). Зеркало AD_RES_CATALOG в admin.js.
  EC.resInfo = {};
  ((window.GalaxyGen && window.GalaxyGen.RESOURCES) || []).forEach(rc => { if (rc && rc.name) EC.resInfo[rc.name] = { r: rc.r || 'common', icon: rc.icon || '◈' }; });
  EC.colonies.forEach(c => (c.resources || []).forEach(r => { if (r && r.name) EC.resInfo[r.name] = { r: r.r || EC.resInfo[r.name]?.r || 'common', icon: r.icon || EC.resInfo[r.name]?.icon || '◈' }; }));
  EC.systems.forEach(s => (s.planets || []).forEach(p => (p.resources || []).forEach(r => { if (r && r.name) EC.resInfo[r.name] = { r: r.r || EC.resInfo[r.name]?.r || 'common', icon: r.icon || EC.resInfo[r.name]?.icon || '◈' }; })));

  // Галактический рынок: name → { price (живая), base (якорь), stock (запас), eq (равновесие) }.
  // Источник истины — SQL market_resources (тикается на сервере). Питает ecResPriceN и вкладку «Рынок».
  EC.market = {};
  (Array.isArray(market) ? market : []).forEach(m => { if (m && m.name) EC.market[m.name] = { price: +m.price, base: +m.base_price, stock: +m.stock, eq: +m.equilibrium, sup: +m.npc_supply || 0, dem: +m.npc_demand || 0 }; });
  // Живые параметры рынка (market_config из _mining_market_routing.sql). Нужны, чтобы
  // предпросмотр/прогноз в UI считал цену по ТЕМ ЖЕ числам, что и сервер. Фолбэк —
  // дефолты _market_setup.sql (elast 0.45, зажим 0.25..4.0), если конфиг не применён.
  const _mc = Array.isArray(marketCfg) ? marketCfg[0] : marketCfg;
  EC.marketCfg = _mc ? {
    k: +_mc.elasticity || 0.45, lo: +_mc.clamp_lo || 0.25, hi: +_mc.clamp_hi || 4.0,
    reversion: +_mc.reversion || 0.08, npc_react: +_mc.npc_react || 0, walk: +_mc.walk || 0
  } : { k: 0.45, lo: 0.25, hi: 4.0, reversion: 0.08, npc_react: 0, walk: 0 };
}

// ── ФАЗА 2 (подсистемы вкладок) ── Биржа/деривативы/заказы, вера, разведка-портреты/
// пассив, оборона-аванпосты, флоты, артиллерия, дерево исследований, ачивки. Грузится
// ФОНОМ после первой отрисовки кабинета; по готовности вызывающий до-рисовывает экран.
async function _ecLoadRest() {
  if (_ecRestInFlight) return _ecRestInFlight;
  _ecRestInFlight = _ecLoadRestImpl();
  try { return await _ecRestInFlight; }
  finally { _ecRestInFlight = null; }
}
async function _ecLoadRestImpl() {
  if (!EC.app || !EC.fid) return;
  const [faithStatus, faithList, passiveIntel, techLayout, techPrereq, exchange, bonds, corps, margin, futures, options, doom, defOutposts, defOpShips, defOutIntel, spyPortraits, orders, mzaShips, myFleets] = await Promise.all([
    ecRpc('faith_status').catch(() => null),          // вера: статус текущей фракции
    ecRpc('faith_list').catch(() => []),              // вера: реестр всех религий
    ecRpc('passive_intel_all').catch(() => []),       // пассивная разведка: размытый срез
    ecCached('techLayout', () => dbGet('tech_layout', `select=node_id,x,y,icon,img,nocore`)),   // раскладка дерева — кэш на сессию
    ecCached('techPrereq', () => dbGet('tech_prereq', `select=node_id,prereq`)),   // связи дерева — кэш на сессию
    ecRpc('exchange_status').catch(() => null),   // биржа: индекс/ETF + спарклайны
    ecRpc('bonds_status').catch(() => null),      // биржа: облигации
    ecRpc('corps_status').catch(e => ({ __err: (e && e.message) || 'нет ответа' })),   // биржа: корпорации
    ecRpc('margin_status').catch(() => null),    // биржа: маржа (срез 5)
    ecRpc('futures_status').catch(() => null),   // биржа: фьючерсы (срез 6)
    ecRpc('options_status').catch(() => null),   // биржа: опционы (срез 7)
    ecRpc('doom_status').catch(() => null),       // межзвёздная артиллерия
    ecRpc('outposts_visible').catch(() => []),    // оборона: развёрнутые аванпосты
    ecRpc('outpost_ships_mine').catch(() => []),  // оборона: мои корабли-носители
    ecRpc('outpost_intel').catch(() => []),       // оборона: разведданные разведаванпостов
    ecCached('spyPortraits', () => dbGet('spy_portraits', `select=id,race,gender,url`)),  // пул портретов — кэш на сессию
    ecRpc('orders_status').catch(() => null),     // биржа: заказы (госзаказы/RFQ)
    ecRpc('mza_ships_mine').catch(() => []),      // Гиперпейсер: мои мобильные «Длани»
    ecRpc('fleets_mine').catch(() => []),         // флоты: мои мобильные соединения
  ]);
  // Межзвёздная артиллерия: орудия фракции (с integrity) + залпы в полёте + баланс.
  EC.doom = (doom && typeof doom === 'object') ? doom : { guns: [], salvos: [], const: {} };
  EC.doomByBuilding = {};
  (EC.doom.guns || []).forEach(g => { if (g && g.building_id) EC.doomByBuilding[g.building_id] = g; });
  EC.outposts = Array.isArray(defOutposts) ? defOutposts : [];  // оборона: развёрнутые аванпосты
  EC.opShips = Array.isArray(defOpShips) ? defOpShips : [];     // оборона: мои корабли-носители
  EC.mzaShips = Array.isArray(mzaShips) ? mzaShips : [];        // Гиперпейсер: мои мобильные «Длани»
  EC.fleets = Array.isArray(myFleets) ? myFleets : [];          // флоты: мои мобильные соединения
  EC.outpostIntel = Array.isArray(defOutIntel) ? defOutIntel : [];  // оборона: разведданные разведаванпостов
  EC.spyPortraits = Array.isArray(spyPortraits) ? spyPortraits : [];  // агентура: общий пул портретов
  EC.faith = faithStatus || { faith: null, faiths: [], can_found: false, strength: 0, unit_discount: 0, temple_income: 150 };  // вера: статус
  if (!Array.isArray(EC.faith.faiths)) EC.faith.faiths = EC.faith.faith ? [EC.faith.faith] : [];  // мультивера: все исповедуемые
  EC.faithList = faithList || [];           // вера: реестр религий
  // мультивера: справочник «id веры → {name,color}» для подписи храмов
  EC.faithById = {};
  (EC.faith.faiths || []).forEach(f => { if (f && f.id) EC.faithById[f.id] = { name: f.name, color: f.color }; });
  (EC.faithList || []).forEach(f => { if (f && f.id && !EC.faithById[f.id]) EC.faithById[f.id] = { name: f.name, color: f.color }; });
  // PoE-раскладка дерева исследований: node_id → { x, y, icon, img }.
  EC.techLayout = {};
  (Array.isArray(techLayout) ? techLayout : []).forEach(r => { if (r && r.node_id) EC.techLayout[r.node_id] = r; });
  // Staff-override связей дерева. Сбрасываем мемо, чтобы overlay применился.
  EC.techPrereq = {};
  (Array.isArray(techPrereq) ? techPrereq : []).forEach(r => { if (r && r.node_id) EC.techPrereq[r.node_id] = Array.isArray(r.prereq) ? r.prereq : []; });
  EC._research = null;
  // Пассивная разведка: размытый срез по фракциям. Индекс по fid.
  EC.passive = {};
  (Array.isArray(passiveIntel) ? passiveIntel : []).forEach(p => { if (p && p.target_fid) EC.passive[p.target_fid] = p; });
  // Биржа (срез 2): индекс рынка + ETF-позиция + спарклайны (подмешиваем в EC.market[name].spark).
  EC.exchange = exchange || { index: { value: 1000, base: 1000, spark: [] }, holdings: { units: 0, basis: 0 }, resources: {} };
  const exRes = (EC.exchange && EC.exchange.resources) || {};
  Object.keys(exRes).forEach(n => { if (EC.market[n]) EC.market[n].spark = (exRes[n] || []).map(Number); });
  EC.bonds = bonds || { issuer: [], holdings: [], market: [] };   // облигации (срез 3)
  // Корпорации (срез 4a): null = RPC не ответил — UI покажет диагностику с текстом ошибки.
  EC.corpsErr = (corps && corps.__err) || null;
  EC.corps = EC.corpsErr ? null : corps;
  EC.margin  = margin  || null;   // деривативы (срезы 5–7): маржа/фьючерсы/опционы
  EC.futures = futures || null;
  EC.options = options || null;
  EC.orders = orders || null;     // заказы (срез 8): госзаказы/RFQ

  // Ачивки: сервер пересчитывает условия, выдаёт новые и начисляет ГС.
  try {
    const ach = await ecRpc('ach_check');
    EC.ach = (ach && ach.earned) || [];
    if (ach && ach.gc != null && EC.eco) EC.eco.gc = ach.gc;
    if (ach && ach.newly > 0 && Array.isArray(ach.new_ids) && ach.new_ids.length) {
      const names = ach.new_ids.map(id => (EC_ACH[id] || {}).name || id).join(', ');
      const tot = ach.new_ids.reduce((a, id) => a + ((EC_ACH[id] || {}).reward || 0), 0);
      if (typeof toast === 'function') toast(`🏆 Достижение: ${names}${tot ? ` · +${ecNum(tot)} ГС` : ''}`, 'ok');
      // Публикуем каждое новое достижение в ленту «Хроники сектора» (best-effort).
      ach.new_ids.forEach(id => {
        ecRpc('news_announce_ach', { p_ach_id: id, p_name: (EC_ACH[id] || {}).name || id }).catch(() => {});
      });
    }
  } catch (e) { EC.ach = EC.ach || []; }
}

// Безопасные дефолты подсистем фазы 2 — ставятся ДО первой отрисовки кабинета, чтобы
// клик по ещё-не-загруженной вкладке (Биржа/Вера/Оборона/Длань…) не падал на undefined.
function ecResetDeferred() {
  EC.doom = { guns: [], salvos: [], const: {} }; EC.doomByBuilding = {};
  EC.outposts = []; EC.opShips = []; EC.mzaShips = []; EC.fleets = []; EC.outpostIntel = []; EC.spyPortraits = [];
  EC.faith = { faith: null, faiths: [], can_found: false, strength: 0, unit_discount: 0, temple_income: 150 }; EC.faithList = []; EC.faithById = {};
  EC.passive = {}; EC.techLayout = {}; EC.techPrereq = {}; EC._research = null;
  EC.exchange = { index: { value: 1000, base: 1000, spark: [] }, holdings: { units: 0, basis: 0 }, resources: {} };
  EC.bonds = { issuer: [], holdings: [], market: [] }; EC.corps = null; EC.corpsErr = null;
  EC.margin = null; EC.futures = null; EC.options = null; EC.orders = null;
  EC.ach = EC.ach || [];
}
async function ecReloadPaint() {
  await ecLoad();
  // Кабинет перерисовываем ТОЛЬКО когда игрок в нём: ecPaintCabinet() делает
  // setPg() (замена всей страницы), и вызов с главной «перекидывал» в кабинет.
  if (typeof curSlug !== 'undefined' && curSlug === 'economy') ecPaintCabinet();
  // Оверлей «Управление колониями» в новелле живёт на тех же данных EC —
  // после любого действия перерисовываем и его (если открыт).
  if (typeof heroVNPlanetsRefresh === 'function') heroVNPlanetsRefresh();
}

// ── Превью дохода (зеркало RPC) ─────────────────────────────
// Пространственная экономика (срез 2): просперити/цена товаров системы постройки
// (зеркало _system_balance). Без данных (старая БД / нет среза) — нейтрально ×1.
function ecBuildingSysBal(b) {
  const c = EC.colonies.find(x => x.id === b.colony_id);
  return (c && EC.spatial && EC.spatial[c.system_id]) || null;
}
function ecBuildingProsp(b) { const bal = ecBuildingSysBal(b); return bal ? (+bal.prosperity || 1) : 1; }
function ecBuildingIncome(b) {
  const d = EC_BUILD[b.btype]; if (!d) return { gc: 0, science: 0 };
  let gc = (d.inc.gc || 0) * b.slots_open;
  // ГС-домики × просперити (благополучие) системы постройки
  if (b.btype === 'factory' || b.btype === 'trade' || b.btype === 'temple') gc *= ecBuildingProsp(b);
  return { gc, science: (d.inc.science || 0) * b.slots_open };
}
// Разбивка ГС-дохода домика на множители (для карточки): база × благополучие × обеспечение.
// ВСЕГДА показывается у доходных factory/trade/temple — словами, почему доход выше/ниже базы.
function ecBuildingIncomeBreak(b) {
  if (b.btype !== 'factory' && b.btype !== 'trade' && b.btype !== 'temple') return '';
  const d = EC_BUILD[b.btype]; if (!d || !(d.inc.gc > 0)) return '';
  const base = (d.inc.gc || 0) * b.slots_open;
  const pr = ecBuildingProsp(b);
  const gw = ecGoodsInfo().welfare;   // обеспечение товарами (множитель дохода державы)
  const noData = !ecBuildingSysBal(b);   // срез не накатан / нет данных системы
  const pct = v => (v >= 1 ? '+' : '−') + Math.round(Math.abs(v - 1) * 100) + '%';
  const cls = v => v > 1.005 ? 'ec-bk-hi' : (v < 0.995 ? 'ec-bk-lo' : 'ec-bk-mid');
  // строка-формула
  const parts = [`<span class="ec-bk-base" title="База: ${b.slots_open} слот(ов) × ${d.inc.gc} ГС">${ecNum(base)} база</span>`,
    `<span class="${cls(pr)}" title="Благополучие системы (×${pr.toFixed(2)}): растёт от рабочих рук, падает при перегрузе застройкой">⚖ ${pct(pr)}</span>`];
  if (Math.abs(gw - 1) >= 0.005) parts.push(
    `<span class="${cls(gw)}" title="Обеспечение товарами (×${gw.toFixed(2)}): хватает товаров населению → доход растёт, дефицит → проседает. Стройте Фабрику товаров.">🛍 ${pct(gw)}</span>`);
  const total = base * pr * gw;
  // короткий вывод словами: почему так
  let note = '';
  if (noData) note = 'Данные системы не загружены — показана база.';
  else if (gw < 0.995) note = `Нехватка товаров населению — доход проседает. Стройте Фабрику товаров.`;
  else if (pr < 0.995) note = `Перегруз застройкой давит благополучие.`;
  else if (pr > 1.005) note = `Запас рабочих рук поднимает доход.`;
  return `<div class="ec-bld-break">
    <div class="ec-bk-line">${parts.join('<span class="ec-bk-x">×</span>')}<span class="ec-bk-x">=</span><span class="ec-bk-tot">${ecNum(Math.round(total))}/сут</span></div>
    ${note ? `<div class="ec-bk-note">${esc(note)}</div>` : ''}
  </div>`;
}

// ── ФАБРИКА ТОВАРОВ: поток под спрос (зеркало accrue из _budget_wellbeing.sql) ──
// Товары ДЕМАТЕРИАЛИЗОВАНЫ: не ресурс, а поток внутри тика. Фабрика делает
// ровно под спрос населения (pop/600/сут) и тратит входы пропорционально
// фактическому выпуску. Никакого склада/излишка/продажи.
function ecGoodsStock(name) { return +(((EC.eco && EC.eco.resources) || {})[name] || 0); }
function ecGoodsInfo() {
  const slots = ecSlotsSum('goodsfab');
  const water = EC_GOODS_WATER.reduce((a, n) => a + ecGoodsStock(n), 0);
  const mat = EC_GOODS_MAT.reduce((a, n) => a + ecGoodsStock(n), 0);
  const waterNeed = EC_GOODS.water * slots, matNeed = EC_GOODS.mat * slots;
  const ratio = slots <= 0 ? 0 : Math.max(0, Math.min(1,
    waterNeed > 0 ? water / waterNeed : 1, matNeed > 0 ? mat / matNeed : 1));
  // ЖИВОЕ население державы → спрос на товары: pop/600 (зеркало accrue)
  const pop = ecBudgetPop();
  const demand = pop / 600;
  const made = Math.min(demand, EC_GOODS.out * slots * ratio);
  const cov = demand <= 0 ? 1 : Math.min(1, made / demand);
  const welfare = Math.min(1.10, Math.max(0.90, 0.90 + 0.20 * cov));
  return { slots, water, mat, waterNeed, matNeed, ratio, made, pop, demand, cov, welfare };
}
// Блок фабрики товаров в карточке: рецепт · наличие входов · обеспечение.
function ecGoodsHtml(b) {
  const g = ecGoodsInfo();
  const lowW = g.waterNeed > 0 && g.water < g.waterNeed;
  const lowM = g.matNeed > 0 && g.mat < g.matNeed;
  const covPct = Math.round(g.cov * 100);
  const covCls = g.cov >= 1 ? 'hi' : (g.cov >= 0.6 ? 'mid' : 'lo');
  const wPct = Math.round((g.welfare - 1) * 100);
  return `<div class="ec-gf">
    <div class="ec-gf-recipe">
      <span class="ec-gf-in ${lowW ? 'ec-gf-low' : ''}" title="Под полную мощность нужно ${ecNum(g.waterNeed)}/сут · на складе ${ecNum(g.water)}. Списывается только под фактический выпуск (0.6/товар)">💧 ${ecNum(g.water)}<small>/${ecNum(g.waterNeed)}</small></span>
      <span class="ec-gf-in ${lowM ? 'ec-gf-low' : ''}" title="Под полную мощность нужно ${ecNum(g.matNeed)}/сут · на складе ${ecNum(g.mat)}. Списывается только под фактический выпуск (0.4/товар)">⚙️ ${ecNum(g.mat)}<small>/${ecNum(g.matNeed)}</small></span>
      <span class="ec-gf-arrow">→</span>
      <span class="ec-gf-out" title="Выпуск ровно под спрос населения — излишка не бывает">🛍 ${ecNum(Math.round(g.made))}<small>/${ecNum(Math.round(g.demand))} спрос</small></span>
    </div>
    ${g.ratio < 1 && g.slots > 0 ? `<div class="ec-gf-warn">⚠ Не хватает ${lowW ? 'воды' : ''}${lowW && lowM ? ' и ' : ''}${lowM ? 'сырья' : ''} — мощность ${Math.round(g.ratio * 100)}% от полной. Добывайте ${EC_GOODS_WATER.join('/')} и ${EC_GOODS_MAT.join('/')}.</div>` : ''}
    <div class="ec-gf-prov">
      <span>Обеспечение населения: <b class="ec-cov-${covCls}">${covPct}%</b></span>
      <span class="ec-cov-${wPct >= 0 ? 'hi' : 'lo'}" title="Обеспечение умножает доход всех построек державы">доход ×${g.welfare.toFixed(2)} (${wPct >= 0 ? '+' : ''}${wPct}%)</span>
    </div>
    <div class="ec-gf-prov ec-gf-sub">Товары не копятся на складе — производятся и потребляются в момент тика</div>
  </div>`;
}
// Итоговый доход империи с учётом доктрины государства (зеркало economy_accrue).
// Наука/агенты — ПЛОСКИЙ бонус доктрины (+N/сут), а не процент (они дискретны).
// Активная дестабилизация (вражеская операция) режет ГС-доход на debuff_pct,
// пока не истёк debuff_until. Зеркало economy_accrue на сервере. Доля 0..1.
function ecDebuffPct() {
  const e = EC.eco;
  if (e && e.debuff_until && new Date(e.debuff_until) > new Date()) return Math.max(0, Math.min(1, +e.debuff_pct || 0));
  return 0;
}
function ecIncomePreview() {
  let gc = 0, science = 0, agents = 0;
  EC.buildings.forEach(b => { const i = ecBuildingIncome(b); gc += i.gc; science += i.science; if (b.btype === 'intel') agents += b.slots_open; });
  const m = ecFactionMods();
  const dz = ecDebuffPct();
  const gw = ecGoodsInfo().welfare;   // обеспечение товарами (зеркало economy_accrue)
  const gcMul = m.gc * (1 - dz) * gw * ecBudgetGcMult();   // доктрина × дестабилизация × обеспечение × благополучие (соцбюджет)
  return {
    gc: Math.round(gc * gcMul),
    science: Math.max(0, science + m.sci_flat),
    agents: Math.max(0, agents + m.agents_flat),
    base: { gc, science, agents }, mods: m, debuff: dz, gcMul, goodsWelfare: gw,
  };
}
// Доход с активных караванов за сутки — единый источник для шапки и обзора («Казна»).
// Исходящие (я продаю) учитывают доктрину (× m.gc); входящие — доля партнёра (EC_DEST_CUT).
function ecCaravanIncome() {
  const m = ecFactionMods();
  const now = Date.now();
  const act = (EC.routes || []).filter(r => r.status === 'active');
  const out = act.filter(r => r.a_fid === EC.fid);   // исходящие — я продаю
  const inn = act.filter(r => r.b_fid === EC.fid);   // входящие — доля партнёра
  // Валовый экспортный поток добычи — общий пул mine_flow: сервер отгружает караванам
  // ТОЛЬКО реально добытое export-заводами за тик, маршруты черпают пул по очереди.
  const flow = {};
  (EC.buildings || []).filter(ecIsMiner).forEach(b => {
    ecMineYields(b).forEach(y => {
      if (ecEffMode(b, y.name) !== 'export' || ecIsConceded(b.colony_id, y.name)) return;
      flow[y.name] = (flow[y.name] || 0) + y.rate;
    });
  });
  let outRaw = 0, contractRaw = 0, riskRaw = 0, transitN = 0, shortUnits = 0;
  // ПОТОКИ: маршруты с «брать со склада» добирают недостающее из запаса (общий остаток на все пути)
  const storeLeft = { ...((EC.eco && EC.eco.resources) || {}) };
  out.forEach(r => {
    const dip = ecDipCoef(r.b_fid);
    // мультигруз оплачивается по редкости (_res_price), одиночный — по цене контракта
    const items = (Array.isArray(r.cargo) && r.cargo.length)
      ? r.cargo.map(ci => ({ res: ci.res, vol: +ci.vol || 0, price: ecResPrice(ecResRarity(ci.res)) }))
      : [{ res: r.resource, vol: +r.volume || 0, price: +r.price || 0 }];
    const inTransit = r.transit_until && new Date(r.transit_until).getTime() > now;
    if (inTransit) { transitN++; items.forEach(i => { contractRaw += i.vol * i.price * dip; }); return; }
    let gcRoute = 0;
    items.forEach(i => {
      contractRaw += i.vol * i.price * dip;
      const avail = flow[i.res] || 0;
      let shipped = Math.min(i.vol, avail);
      flow[i.res] = avail - shipped;
      // ПОТОКИ: добор недостающего объёма со склада (галочка «брать со склада» у пути)
      if (r.from_store && shipped < i.vol) {
        const st = Math.min(i.vol - shipped, Math.max(0, +storeLeft[i.res] || 0));
        storeLeft[i.res] = (+storeLeft[i.res] || 0) - st;
        shipped += st;
      }
      if (shipped < i.vol) shortUnits += i.vol - shipped;
      if (shipped <= 0) return;
      gcRoute += shipped * i.price * dip;
    });
    // пиратские угрозы: шанс срыва рейса за тик (без конвоя 0.80; с конвоем 0.40, древние 0.65)
    const thr = Array.isArray(r.threats) ? r.threats : [];
    if (thr.length && gcRoute > 0) {
      const escorted = (+r.convoy || 0) > 0;
      let pSafe = 1;
      thr.forEach(t => { pSafe *= 1 - ((t && t.type) === 'ancient' ? (escorted ? 0.65 : 0.80) : (escorted ? 0.40 : 0.80)); });
      riskRaw += gcRoute * (1 - pSafe);
    }
    outRaw += gcRoute;
  });
  const gcM = m.gc || 1;
  const outGc = Math.round(outRaw * gcM);           // реально отгружаемое (поток × цена × дипломатия × доктрина)
  const contract = Math.round(contractRaw * gcM);   // «бумажный» максимум по контрактам
  const risk = Math.round(riskRaw * gcM);           // ожидаемые потери от пиратов
  // Входящие: 50% × дипломатия партнёра ко мне; реальная сумма ограничена ДОБЫЧЕЙ партнёра
  // (нам не видна) — поэтому это верхняя оценка.
  const inGc = inn.reduce((a, r) => {
    const rel = (EC.relations || []).find(x => x.from_fid === r.a_fid && x.to_fid === EC.fid);
    const dip = Math.max(0.8, Math.min(1.2, 1 + (rel ? +rel.score || 0 : 0) / 500));
    const items = (Array.isArray(r.cargo) && r.cargo.length)
      ? r.cargo.map(ci => ({ vol: +ci.vol || 0, price: ecResPrice(ecResRarity(ci.res)) }))
      : [{ vol: +r.volume || 0, price: +r.price || 0 }];
    return a + items.reduce((s, i) => s + Math.round(i.vol * i.price * EC_DEST_CUT * dip), 0);
  }, 0);
  return { out: outGc, inc: inGc, net: outGc - risk + inGc,
    contract, short: Math.round(shortUnits), risk, transitN, outRoutes: out, inRoutes: inn };
}
// Множитель доктрины к ГС-потокам (доктрина × срез дестабилизации) — единый рычаг,
// зеркало m_gc в economy_accrue. Используют market/export/preview, чтобы не расходились.
function ecGcMul() { return (ecFactionMods().gc || 1) * (1 - ecDebuffPct()); }
// Ценность ресурса (анкер по имени, фолбэк по редкости) — клиентское зеркало _res_value.
function ecResVal(name) { return (typeof resPrice === 'function') ? resPrice(name) : ecResPrice(ecResRarity(name)); }
// Доход ХРАМОВ за сутки до доктрины: slots×150, лишь пока исповедуешь веру храма
// (мультивера: faith_id ∈ мои; null=старый храм при любой вере). Зеркало economy_accrue v5
// (_faith_multi.sql, ветка temple) — БЕЗ гейта по вере доход храма не идёт.
function ecTempleIncome() {
  const faiths = (EC.faith && EC.faith.faiths) || [];
  const has = faiths.length > 0;
  let gc = 0;
  (EC.buildings || []).forEach(b => {
    if (b.btype !== 'temple') return;
    const ok = b.faith_id ? faiths.some(f => f && f.id === b.faith_id) : has;
    if (ok) gc += (b.slots_open || 0) * 150;
  });
  return gc;
}
// Десятина основателю за сутки до доктрины: tithe_pct (≈20%) дохода храмов адептов
// (кроме самого основателя). Зеркало _faith_multi.sql ВЕРА-2; данные из faith_status (EC.faith).
function ecTitheIncome() {
  const fs = EC.faith || {};
  if (fs.role !== 'founder') return 0;
  const slots = (fs.adepts || []).filter(a => a.role !== 'founder').reduce((s, a) => s + (+a.flock || 0), 0);
  return slots * (+fs.temple_income || 150) * (+fs.tithe_pct || 0.20);
}
// Доход моих тайных сект за сутки до доктрины: каждая активная секта = храм (+150 ГС).
// Зеркало _faith_multi.sql ВЕРА-4. Счётчик из faith_status (если не отдаётся — 0).
function ecSectIncome() { return (+((EC.faith || {}).active_sects) || 0) * 150; }
// Доля выручки по редкости при продаже на Товарной бирже — зеркало economy_accrue (market_gc).
const EC_MARKET_FRAC = { legendary: 0.75, epic: 0.70, rare: 0.65, uncommon: 0.55, common: 0.50 };
// ── Потоки ресурсов (вкладка «Потоки», зеркало _res_flows.sql) ──
// Настройки потока ресурса; null = записи нет, всё по умолчанию (режим здания, без лимитов).
function ecFlowCfg(name) { return (EC.resFlows || {})[name] || null; }
// Эффективный режим потока: панель «Потоки» перекрывает режим здания. Зеркало eff_mode accrue v6.
function ecEffMode(b, resName) {
  const f = ecFlowCfg(resName);
  if (f && f.mode) return f.mode;
  return (b && b.mine_mode === 'export') ? 'export' : 'store';
}
// Залежь отдана мною в концессию — её поток уходит другой державе (в мои потоки не входит).
function ecIsConceded(colonyId, resName) {
  return (EC.concessions || []).some(c => c.colony_id === colonyId && c.res_name === resName && c.from_fid === EC.fid);
}
// Дневной поток добычи в режиме СКЛАД (mine_mode=store) — то, что «Товарная биржа»
// может сбыть. Зеркало res_add в economy_accrue. Биржа НЕ трогает накопленный склад
// (иначе колонизация новой залежи разом сливала бы стратегический запас).
function ecStoreFlowEntries() {
  const gross = {};
  (EC.buildings || []).filter(ecIsMiner).forEach(b => {
    ecMineYields(b).forEach(y => {
      if (ecEffMode(b, y.name) !== 'store' || ecIsConceded(b.colony_id, y.name)) return;
      gross[y.name] = (gross[y.name] || 0) + y.rate;
    });
  });
  return Object.entries(gross).filter(([, v]) => v > 0);
}
// Доход ТОВАРНОЙ БИРЖИ за сутки: сбывает СВЕЖЕДОБЫТЫЙ поток (mine_mode=store) по ценности
// × доля редкости, до лимита market_slots×25/сут, по убыванию ценности. НАКОПЛЕННЫЙ СКЛАД
// НЕ ТРОГАЕТ. ×доктрина. Зеркало market_gc.
function ecMarketCalc() {
  let cap = ecSlotsSum('market') * 25;
  const left = {};
  const flowAll = ecStoreFlowEntries();
  if (cap <= 0) return { gc: 0, left: Object.fromEntries(flowAll) };
  let gc = 0;
  const flow = flowAll.map(([n, q]) => [n, q, ecResRarity(n)]).sort((a, b) => ecResVal(b[0]) - ecResVal(a[0]));
  for (const [n, q, rar] of flow) {
    const f = ecFlowCfg(n);
    const lim = (f && f.market_limit != null) ? +f.market_limit : null;   // ПОТОКИ: лимит биржи /сут
    let sell = Math.min(q, Math.max(0, cap));
    if (lim != null) sell = Math.min(sell, lim);
    if (sell > 0) { gc += sell * ecResVal(n) * (EC_MARKET_FRAC[rar] || 0.5); cap -= sell; }
    left[n] = q - sell;
  }
  // ПОТОКИ: явный добор со склада (market_from_store ед./сут), в пределах остатка лимита биржи
  const store = (EC.eco && EC.eco.resources) || {};
  Object.values(EC.resFlows || {}).forEach(f => {
    if (cap <= 0 || !f || !(+f.market_from_store > 0)) return;
    const sell = Math.min(+f.market_from_store, +store[f.res_name] || 0, cap);
    if (sell <= 0) return;
    gc += sell * ecResVal(f.res_name) * (EC_MARKET_FRAC[ecResRarity(f.res_name)] || 0.5);
    cap -= sell;
  });
  return { gc: Math.round(gc * ecGcMul()), left };
}
function ecMarketIncome() { return ecMarketCalc().gc; }
// Доход ЭКСПОРТА за сутки: свободный экспортный поток (export-заводы − занятое караванами)
// × ценность × 0.6. ×доктрина. Зеркало economy_accrue (export_gc).
function ecExportIncome() {
  let gc = 0;
  ecExtractEntries().forEach(([n, q]) => { gc += (+q || 0) * ecResVal(n) * 0.6; });
  // ПОТОКИ: перелив на склад выключен (to_store=false) — непроданный биржей остаток
  // потока авто-продаётся как экспорт ×0.6 (зеркало merge-ветки accrue v6).
  const left = ecMarketCalc().left;
  Object.entries(left).forEach(([n, q]) => {
    const f = ecFlowCfg(n);
    if (f && f.to_store === false && q > 0) gc += q * ecResVal(n) * 0.6;
  });
  return Math.round(gc * ecGcMul());
}
// Расход на торговую политику за сутки (NPC-конвой) — зеркало policy_cost (НЕ ×доктрина).
function ecPolicyCostDay() {
  const tier = (EC.eco && EC.eco.trade_policy != null) ? +EC.eco.trade_policy
             : ((EC.raidStatus && +EC.raidStatus.policy) || 0);
  return ((typeof EC_TRADE_POLICY !== 'undefined' && EC_TRADE_POLICY[tier]) || { cost: 0 }).cost || 0;
}
// Итоговый ГС-доход за сутки в разбивке — ПОЛНОЕ зеркало economy_accrue v5: постройки
// (фабрики+хабы+храмы+десятина+секты) ×доктрина + караваны + Товарная биржа + экспорт
// − торговая политика + регулярные потоки биржи. Единый источник для шапки и «Казны».
// ── Бюджет державы (зеркало _budget_wellbeing.sql v3) ────────
// 5 ползунков 0..4; каждый уровень стоит СТАВКУ ГС/сут НА ДУШУ живого населения.
const EC_BUDGET = {
  industry: { ic: '🏭', name: 'Промышленность', k: 0.12, desc: 'Слоты гражданских построек (фабрики, хабы, склады, храмы) и ТЕМП ДОБЫЧИ: добывающий завод копает быстрее с каждым слотом.' },
  military: { ic: '⚔', name: 'Оборонзаказ',     k: 0.15, desc: 'Слоты военных построек + скорость постройки юнитов. На нуле корабли и войска НЕ строятся вовсе.', mults: [null, 1.5, 1.0, 0.8, 0.65] },
  science:  { ic: '🔬', name: 'Образование',     k: 0.12, desc: 'Слоты НИИ и разведцентров + множитель очков науки.', mults: [0.5, 0.8, 1.0, 1.2, 1.4] },
  social:   { ic: '⚖', name: 'Соцобеспечение',  k: 0.12, desc: 'Благополучие (множитель ВСЕГО денежного дохода) и РОСТ НАСЕЛЕНИЯ: на нуле люди бегут (−2%/сут).', mults: [0.85, 0.95, 1.0, 1.08, 1.15] },
  infra:    { ic: '🚚', name: 'Инфраструктура',  k: 0.09, desc: 'Ёмкость складов ресурсов.', mults: [0.8, 0.9, 1.0, 1.15, 1.3] },
};
const EC_BUDGET_LVL = ['нет финансирования', 'скудно', 'норма', 'усиленно', 'максимум'];
const EC_BUDGET_SLOTS = [1, 2, 3, 5, 6];   // целевые слоты постройки по уровню профильного ползунка
// Вес уровня: цена ПРОГРЕССИВНАЯ — «норма» дешёвая, «максимум» кусается (зеркало _budget_lvl_w)
const EC_BUDGET_W = [0, 1, 2, 4, 7];
// Ставка единая для всех держав, скидки малых держав нет (зеркало _budget_pop_mult)
function ecBudgetPopMult(pop) { return 1; }
// ── Население (зеркало _fac_pop / _pop_growth / _budget_auto_slots) ──
const EC_POP_PER_SLOT = 3;                 // жителей на один рабочий слот (было 50)
const EC_POP_CAP_CELL = 100;               // потолок жителей на ячейку колонии
const EC_POP_START_CELL = 50;              // старт/бэкфилл жителей на ячейку
const EC_POP_GROWTH = [-0.02, 0.005, 0.015, 0.025, 0.035];  // %/сут по уровню соцобеспечения
function ecBudgetLvl(key) { const v = +(EC.budget && EC.budget[key]); return isNaN(v) ? 2 : Math.max(0, Math.min(4, v)); }
// Живое население державы: colonies.pop (бэкфилл cells×50 для старых записей)
function ecBudgetPop() {
  return Math.round((EC.colonies || []).reduce((a, c) =>
    a + (c.pop != null ? +c.pop : (+c.cells || 0) * EC_POP_START_CELL), 0));
}
function ecBudgetPopCap() { return (EC.colonies || []).reduce((a, c) => a + (+c.cells || 0), 0) * EC_POP_CAP_CELL; }
// Рост населения %/сут = соцобеспечение + бонус за обеспечение товарами
// (до +1%/сут при полном покрытии) — зеркало роста pop в economy_accrue.
function ecBudgetGrowthBase() { return EC_POP_GROWTH[ecBudgetLvl('social')]; }
function ecBudgetGrowthGoods() { return 0.01 * Math.min(1, ecGoodsInfo().cov); }
function ecBudgetGrowth() { return ecBudgetGrowthBase() + ecBudgetGrowthGoods(); }
// Апкип ГС/сут = население × скидка(нас.) × Σ(ставка × вес уровня) — зеркало _budget_upkeep
function ecBudgetUpkeep() {
  const pop = ecBudgetPop();
  return Math.round(pop * ecBudgetPopMult(pop) *
    Object.keys(EC_BUDGET).reduce((a, k) => a + EC_BUDGET_W[ecBudgetLvl(k)] * EC_BUDGET[k].k, 0));
}
// Благополучие от соцобеспечения — множитель всего ГС-дохода (зеркало _budget_gc_mult)
function ecBudgetGcMult() { return EC_BUDGET.social.mults[ecBudgetLvl('social')]; }

function ecGcIncome() {
  const inc = ecIncomePreview();
  const gcMul = inc.gcMul != null ? inc.gcMul : 1;
  let factory = 0, trade = 0;
  (EC.buildings || []).forEach(b => {
    if (b.btype === 'factory') factory += ecBuildingIncome(b).gc;
    else if (b.btype === 'trade') trade += ecBuildingIncome(b).gc;
  });
  factory = Math.round(factory * gcMul);
  trade   = Math.round(trade * gcMul);
  const temple = Math.round(ecTempleIncome() * gcMul);
  const tithe  = Math.round(ecTitheIncome()  * gcMul);
  const sects  = Math.round(ecSectIncome()   * gcMul);
  const cv = ecCaravanIncome();
  const market = ecMarketIncome();
  const exportGc = ecExportIncome();
  const policy = ecPolicyCostDay();
  const ex = ecExchangeIncome();
  const op = ecOutpostMineTotals();   // добывающие аванпосты: +ГС/сут (ленивый settle, вне основного тика)
  // НАЧИСЛЯЕТ ТИК (зеркало economy_accrue → income_history): постройки + караваны + биржа + экспорт − политика.
  const budget = ecBudgetUpkeep();   // апкип бюджета державы (зеркало _budget_upkeep)
  const net = factory + trade + cv.net + market + exportGc - policy - budget;
  // НЕ входит в основной тик (вера/биржевые потоки/аванпосты — отдельный/ленивый settle, в income_history их нет).
  const netExtra = temple + tithe + sects + ex.net + op.gc;
  return { factory, trade, temple, tithe, sects, caravan: cv, market, export: exportGc, policy, budget, exchange: ex, outpost: op, net, netExtra };
}
// Регулярные ГС-потоки с БИРЖИ за ход — чтобы «Чистый доход» учитывал ВСЁ, а не
// только постройки/караваны. Берём строго то, что НЕ задвоится с доходом фабрик:
//  • купоны облигаций (мой доход держателя) минус купоны, что плачу как эмитент;
//  • дивиденды по ЧУЖИМ долям (выручку тех построек accrue платит чужому учредителю,
//    мне она иначе не достаётся — чистый приход);
//  • СИНЕРГИЯ моих корпораций (бонус ×efficiency на мою долю): валовую выручку
//    построек фабрики УЖЕ принесли через accrue, поэтому из своих корпораций берём
//    только надбавку, иначе доход построек посчитается дважды (см. _exchange_corps.sql corp_fix).
function ecExchangeIncome() {
  let bondIn = 0, bondOut = 0, corpDiv = 0, corpSyn = 0;
  const bo = EC.bonds || {};
  (bo.holdings || []).forEach(h => { bondIn  += +h.daily_coupon || 0; });   // я инвестор → купон мне
  (bo.issuer   || []).forEach(i => { bondOut += +i.daily_coupon || 0; });   // я эмитент → купон держателям
  const c = EC.corps || {};
  (c.holdings || []).forEach(h => {                                          // чужие корпорации — чистый приход
    const tot = Math.max(1, +h.total_shares || 1);
    corpDiv += Math.round((+h.daily_gross || 0) * (+h.shares || 0) / tot);
  });
  (c.mine || []).forEach(co => {                                            // мои корпорации — только синергия
    const tot = Math.max(1, +co.total_shares || 1);
    corpSyn += Math.round((+co.daily_gross || 0) * (+co.efficiency || 0) * (+co.my_shares || 0) / tot);
  });
  const bonds = bondIn - bondOut;
  return { bondIn, bondOut, bonds, corpDiv, corpSyn, net: bonds + corpDiv + corpSyn };
}
// Сумма наград за уже полученные достижения (РАЗОВО, не в /сут) — для отдельной строки в Казне.
function ecAchTotal() {
  return (EC.ach || []).reduce((a, id) => a + ((EC_ACH[id] || {}).reward || 0), 0);
}
function ecResEntries() { const res = (EC.eco && EC.eco.resources) || {}; return Object.keys(res).map(k => [k, +res[k] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]); }
// Множитель богатства месторождения (amt с карты) — зеркало public._richness_mult.
const EC_RICHNESS = { 'колоссально': 3.0, 'очень много': 2.5, 'много': 2.0, 'умеренно': 1.5, 'мало': 1.0, 'следы': 0.6 };
function ecRichMult(amt) { const v = EC_RICHNESS[String(amt || '').trim()]; return v == null ? 1.5 : v; }
// Добыча за слот/сутки: редкость × богатство месторождения × доктрина — зеркало economy_accrue.
function ecMineRate(rar, amt) { return Math.min(ecMineCap(amt), Math.max(1, Math.round((EC_RES_RATE[rar || 'common'] || 8) * ecFactionMods().mine))); }
// ЯРУСЫ ДОБЫЧИ: каждая добывающая постройка берёт только залежи своего яруса —
// зеркало public._mine_tier_ok в _budget_wellbeing.sql.
const EC_MINE_TIERS = { mining: ['common'], mining_deep: ['uncommon', 'rare'], mining_exotic: ['epic', 'legendary'] };
function ecIsMiner(b) { return !!(b && EC_MINE_TIERS[b.btype]); }
// БЮДЖЕТ v3: авто-добыча — завод копает залежи СВОЕГО ЯРУСА на планете, темп по залежи =
// база(редкость) × богатство × доктрина × (слоты/3). Слоты = рабочие руки от
// промышленного бюджета и населения. Зеркало цикла mining в economy_accrue.
function ecMineYields(b) {
  if (!ecIsMiner(b)) return [];
  const tiers = EC_MINE_TIERS[b.btype];
  const mine = ecFactionMods().mine;
  // Сырой темп постройки по залежи (до планетарного капа) — постройки СКЛАДЫВАЮТСЯ
  const raw = (bb, ri) => Math.max(1, Math.round((EC_RES_RATE[ri.r || 'common'] || 8) * mine * Math.max(1, +bb.slots_open || 1) / 3));
  // КАП КАЖДОГО ДОМИКА: потолок = размер месторождения (ecMineCap: макс 20 базово,
  // ×баффы, жёсткий предел 40). Постройки складываются ЦЕЛИКОМ, каждая копает свой
  // полный темп независимо — зеркало цикла mining в economy_accrue.
  // Фолбэк редкости: у старых снимков поле r бывает пустым — добираем из каталога
  // (ecResRarity), иначе ценная залежь сойдёт за common и достанется заводу.
  return ecMiningPlanetRes(b).filter(ri => tiers.includes(ri.r || ecResRarity(ri.name))).map(ri => ({
    name: ri.name, r: ri.r || 'common', amt: ri.amt, icon: ri.icon || '◈',
    rate: Math.min(raw(b, ri), ecMineCap(ri.amt)),
  })).filter(y => y.rate > 0);
}
// Стоимость экспансии (колонизация/терраформ/обустройство) с учётом доктрины (mods.colonize).
function ecColonizeCost(base) { return Math.max(1, Math.round((base || 0) * ecFactionMods().colonize)); }
// Стоимость построек и слотов с учётом доктрины (mods.build).
function ecBuildCost(base) { return Math.max(1, Math.round((base || 0) * ecFactionMods().build)); }
// Стоимость исследования с учётом доктрины (mods.research) — дешевле = больше техов доступно.
function ecResearchCost(base) { return Math.max(1, Math.round((base || 0) * ecFactionMods().research)); }

// Ресурсы планеты для mining-здания (из данных карты или снимка колонии)
function ecMiningPlanetRes(b) {
  const colony = EC.colonies.find(c => c.id === b.colony_id);
  if (!colony) {
    // Домик на ЧУЖОЙ колонии (концессия): её снимка у нас нет — восстанавливаем
    // залежи из полученных концессий (сервер и так пустит только их).
    return (EC.concessions || []).filter(c => c.to_fid === EC.fid && c.colony_id === b.colony_id)
      .map(c => ({ name: c.res_name, r: ecResRarity(c.res_name), amt: null }));
  }
  // ИСТИНА — снимок самой колонии (его же использует сервер при начислении добычи).
  // По имени матчить нельзя: в системе бывают ДВЕ планеты с одинаковым именем,
  // и .find хватает не ту (часто пустого двойника) → ресурсы «пропадают».
  if (Array.isArray(colony.resources) && colony.resources.length) return colony.resources.filter(r => r && r.name);
  const sys = EC.systems.find(s => s.id === colony.system_id);
  const planet = ecFindPlanet(sys, colony.planet_name, colony.planet_pid) || colony;
  return (planet && Array.isArray(planet.resources)) ? planet.resources.filter(r => r && r.name) : [];
}
// Суммарная АВТО-добыча по всем mining-зданиям колонии (для заголовка).
// Выбор месторождений убран: завод копает все залежи планеты (ecMineYields).
function ecColonyMinePreview(blds, planet) {
  const mBlds = blds.filter(ecIsMiner);
  if (!mBlds.length) return '';
  const totals = new Map();
  const rars = new Map();
  mBlds.forEach(b => ecMineYields(b).forEach(y => {
    totals.set(y.name, (totals.get(y.name) || 0) + y.rate);
    rars.set(y.name, y.r);
  }));
  if (!totals.size) return '';
  const chips = [...totals.entries()].map(([name, total]) =>
    `<span class="ec-rchip ec-rchip-mine ec-rar-${rars.get(name) || 'common'}" title="${esc(name)}: +${total}/сут"><span class="ec-rchip-i">${ecResIcon(name)}</span>${esc(name)} <b>+${total}</b></span>`).join('');
  return `<div class="ec-pl-mine"><span class="ec-pl-lbl">⛏ Добывается:</span>${chips}<span class="ec-mine-hint">/сут</span></div>`;
}

// ── Рендер кабинета ─────────────────────────────────────────
function ecTreasuryHtml() {
  const inc = ecIncomePreview();
  const gcNet = ecGcIncome().net;   // постройки + караваны — как «Чистый доход» в обзоре
  const incParts = [];
  if (gcNet) incParts.push(`<span style="color:var(--gd)">+${ecNum(gcNet)} ГС</span>`);
  if (inc.science) incParts.push(`<span style="color:var(--pu)">+${ecNum(inc.science)} ОН</span>`);
  const incLine = incParts.length ? incParts.join(' · ') : '<span style="color:var(--t4)">нет дохода — откройте слоты</span>';
  let nextHtml = '';
  if (EC.eco.last_tick) {
    const start = new Date(EC.eco.last_tick).getTime();
    nextHtml = ecProgress(start, start + 86400000, 'доход готов к начислению');
  }
  const entries = ecResEntries();
  const resIco = (n) => (typeof resIconHtml === 'function') ? resIconHtml(n) : '<span class="res-ic res-ic-emoji">◈</span>';
  const resHtml = entries.length
    ? entries.map(([n, v]) => `<div class="ec-rchip ec-res-click" title="${esc(n)}" onclick="ecSetTab('trade')"><span class="ec-rchip-ic">${resIco(n)}</span><b>${ecNum(v)}</b><span class="ec-rchip-n">${esc(n)}</span></div>`).join('')
    : '<div class="ec-rchip-empty">Склад пуст — переведите добывающие заводы в режим 📦 Склад, чтобы копить ресурсы.</div>';
  return `<div class="ec-stats">
      <div class="ec-stat"><span class="ec-stat-ic" style="color:var(--gd)">⛃</span><div class="ec-stat-tx"><span class="ec-stat-k">Галактический стандарт</span><span class="ec-stat-v" style="color:var(--gd)">${ecNum(EC.eco.gc)} ГС</span></div></div>
      <div class="ec-stat"><span class="ec-stat-ic" style="color:var(--pu)">🔬</span><div class="ec-stat-tx"><span class="ec-stat-k">Очки науки</span><span class="ec-stat-v" style="color:var(--pu)">${ecNum(EC.eco.science)} ОН</span></div></div>
      <div class="ec-stat ec-stat-inc"><span class="ec-stat-ic">📈</span><div class="ec-stat-tx"><span class="ec-stat-k">Доход / сутки</span><span class="ec-stat-v" style="font-size:14px">${incLine}</span>${nextHtml ? `<span class="ec-next">${nextHtml}</span>` : ''}</div></div>
    </div>
    <div class="ec-resbar">
      <div class="ec-resbar-hd"><span>Ресурсы планет</span><span class="ec-resbar-n">${entries.length} ${entries.length === 1 ? 'вид' : 'вид(ов)'}</span></div>
      <div class="ec-resbar-list">${resHtml}</div>
    </div>`;
}

// Вводный блок-объяснялка вверху вкладки: что это, как работает, что делать.
// text — короткая суть (HTML допустим), hints — список ключевых правил/цифр.
function ecIntro(icon, title, text, hints) {
  const list = (hints && hints.length)
    ? `<ul class="ec-intro-hints">${hints.map(h => `<li>${h}</li>`).join('')}</ul>` : '';
  return `<div class="ec-intro">
    <div class="ec-intro-hd"><span class="ec-intro-ic">${icon}</span><b>${esc(title)}</b></div>
    <div class="ec-intro-tx">${text}</div>${list}</div>`;
}

function ecPaintCabinet() {
  const col = ecReadable(EC.app.color);
  const tabs = [['overview', '◈', 'Обзор'], ['colonies', '🏗', 'Колонии'], ['forces', '⚔', 'Вооружённые силы'], ['milbuild', '🏭', 'Военпром'], ['outposts', '🛰', 'Аванпосты'], ['research', '🔬', 'Исследования'], ['territory', '🌐', 'Территория'], ['welfare', '⚖', 'Благополучие'], ['flows', '⇄', 'Торговля и потоки'], ['exchange', '📊', 'Биржа'], ['diplomacy', '🤝', 'Дипломатия'], ['faith', '🛐', 'Вера'], ['intel', '🕵', 'Разведка'], ['raids', '🏴‍☠', 'Рейды'], ['achievements', '🏆', 'Достижения'], ['news', '📰', 'Новости']];
  // Длань Неотвратимости — отдельная вкладка-пульт, появляется когда орудие доступно
  // (исследование открыто или орудие уже стоит).
  if (ecDoomUnlocked()) tabs.splice(13, 0, ['doom', '🜨', 'Длань Неотвратимости']);
  const tabsHtml = tabs.map(([id, ic, l]) => `<button class="ec-tab${EC.tab === id ? ' on' : ''}" onclick="ecSetTab('${id}')"><span class="ec-tab-ic">${ic}</span><span class="ec-tab-l">${l}</span></button>`).join('');
  const body = EC.tab === 'overview' ? ecTabOverview() : EC.tab === 'forces' ? ecTabForces()
    : EC.tab === 'milbuild' ? ecTabMilBuild()
    : EC.tab === 'outposts' ? ecTabOutposts()
    : EC.tab === 'research' ? ecTabResearch() : EC.tab === 'territory' ? ecTabTerritory()
    : EC.tab === 'welfare' ? ecTabWelfare()
    : EC.tab === 'trade' ? ecTabFlows()   // легаси-ссылки: «Торговля» слита в «Потоки»
    : EC.tab === 'flows' ? ecTabFlows()
    : EC.tab === 'exchange' ? ecTabExchange()
    : EC.tab === 'diplomacy' ? ecTabDiplomacy() : EC.tab === 'faith' ? ecTabFaith() : EC.tab === 'intel' ? ecTabIntel()
    : EC.tab === 'raids' ? ecTabRaids()
    : EC.tab === 'doom' ? ecTabDoom()
    : EC.tab === 'achievements' ? ecTabAchievements()
    : EC.tab === 'news' ? ecTabNews() : ecTabColonies();
  const img = (EC.app && (EC.app.herald_url || EC.app.image_url)) || '';
  const coverBg = img
    ? `<img class="ec-cover-img" src="${esc(img)}" alt=""><div class="ec-cover-fade"></div>`
    : `<div class="ec-cover-bg" style="background:linear-gradient(135deg, ${col}33, var(--b1) 70%)"></div>`;
  const adminBanner = EC.actAs
    ? `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;margin-bottom:12px;border:1px solid var(--gd,#3a7fbf);border-radius:8px;background:color-mix(in srgb,var(--gd,#3a7fbf) 14%,transparent);color:var(--gdl,#5fb0e6);font-size:13px">
        <span>🔑 Режим администрации — вы в кабинете фракции <b>${esc(EC.actAs.name || EC.app.name || '')}</b>. Игрок не снят; изменения через серверные действия могут не примениться к этой фракции.</span>
        <button class="btn btn-gh btn-sm" style="margin-left:auto" onclick="ecExitImpersonation()">✕ Выйти из кабинета</button>
      </div>`
    : '';
  setPg(`<div class="ec-wrap">
    ${adminBanner}
    <div class="ec-cover" style="--fac:${col}">
      ${coverBg}
      <div class="ec-cover-scan"></div>
      <div class="ec-cover-hud hud-tl"></div><div class="ec-cover-hud hud-tr"></div>
      <div class="ec-cover-inner">
        <div class="ec-cover-row">
          <h1 class="ec-cover-title">${esc(EC.app.name || 'Моя фракция')}</h1>
          <div class="ec-cover-btns">
            <button class="btn btn-gh btn-sm" onclick="go('guide')" title="Полные правила и механики игры">❓ Как играть</button>
          </div>
        </div>
        ${ecTreasuryHtml()}
      </div>
    </div>
    <div class="ec-tabs">${tabsHtml}</div>
    <div class="ec-tabbody">${body}</div>
  </div>`);
  // На телефоне лента вкладок скроллится — подвинем активную вкладку в центр обзора
  try {
    const tabsEl = document.querySelector('.ec-tabs'), onTab = tabsEl && tabsEl.querySelector('.ec-tab.on');
    if (tabsEl && onTab && tabsEl.scrollWidth > tabsEl.clientWidth) {
      tabsEl.scrollLeft = onTab.offsetLeft - tabsEl.clientWidth / 2 + onTab.clientWidth / 2;
    }
  } catch (e) {}
  if (EC.tab === 'trade') { try { ecCvSync(); } catch (e) {} } // флот каравана → объём/эскорт + живой расчёт
  if (EC.tab === 'intel') { try { ecSpyCalcLive(); } catch (e) {} }   // живой расчёт операции
  if (EC.tab === 'research') {
    ecResearchDrain();  // немедленно заполнить свободные слоты из очереди
    ecTreeBind();       // пан/зум холста + drag-редактор раскладки (staff)
  }
  // Новости: контейнер уже в DOM — дозаполняем асинхронно (как в faction_news.js)
  if (EC.tab === 'news') {
    const mount = document.getElementById('ec-news-mount');
    if (mount && typeof fnRenderNewsTab === 'function') { fnRenderNewsTab(mount); }
  }
}
function ecSetTab(t) {
  // «Торговля» слита во вкладку «Потоки»: старые ссылки ведут на под-вкладку караванов
  if (t === 'trade') { t = 'flows'; if (!EC.flowSub || EC.flowSub === 'flows') EC.flowSub = 'caravans'; }
  EC.tab = t; ecPaintCabinet();
}

// ── Состояние «Обзора»-статистики: раскрытые секции, активный график, окно истории ──
function ecOvState() {
  if (!EC.ov) EC.ov = { exp: {}, chart: 'net', range: 14 };
  if (!EC.ov.exp) EC.ov.exp = {};
  return EC.ov;
}
function ecOvExpanded(key) { return !!ecOvState().exp[key]; }
function ecOvToggle(key) { const s = ecOvState(); s.exp[key] = !s.exp[key]; ecPaintCabinet(); }
function ecOvSetChart(metric) { ecOvState().chart = metric; ecStatRepaint(); }
function ecOvSetRange(n) { ecOvState().range = n; ecStatRepaint(); }
// Заголовок раскрываемой секции: стрелка + текст; клик — разворот/сворот детального блока.
function ecOvFold(key, label, sub) {
  const open = ecOvExpanded(key);
  return `<button type="button" class="ec-fold-btn${open ? ' open' : ''}" onclick="ecOvToggle('${key}')">
    <span class="ec-fold-chev">${open ? '▾' : '▸'}</span>
    <span class="ec-fold-lbl">${label}</span>
    ${sub ? `<span class="ec-fold-sub">${sub}</span>` : ''}
  </button>`;
}

// Вкладка «Новости»: статический каркас, тело подгружает faction_news.js.
function ecTabNews() {
  return ecIntro('📰', 'Новости фракции',
    'Пишите новости от лица своего государства. После проверки администрацией они выходят на главной в «Вестнике фракций».',
    ['Кнопка <b>«Написать новость»</b> — ниже.',
     'Новость уходит на <b>модерацию</b>, затем публикуется или отклоняется.',
     'Опубликованные новости видны всем на главной странице.'])
    + `<div id="ec-news-mount"><div class="ec-empty">Загрузка…</div></div>`;
}

// ── Метаданные полей доктрины для карточки: иконка, подпись, группа, направление ──
// goodHigh: больше = лучше? (для стоимостей/кулдауна — нет). flat: плоское поле (целые).
const EC_FIELD_META = {
  gc:          { label: 'Доход',        icon: '📈', group: 'econ',   goodHigh: true,  flat: false },
  mine:        { label: 'Добыча',       icon: '⛏', group: 'econ',   goodHigh: true,  flat: false },
  build:       { label: 'Постройки',    icon: '🏗', group: 'dev',    goodHigh: false, flat: false },
  research:    { label: 'Цена науки',   icon: '🧪', group: 'dev',    goodHigh: false, flat: false },
  sci_flat:    { label: 'Наука',        icon: '🔬', group: 'dev',    goodHigh: true,  flat: true,  unit: ' ОН/сут' },
  colonize:    { label: 'Колонии',      icon: '🪐', group: 'expand', goodHigh: false, flat: false },
  claim_cost:  { label: 'Захват: цена', icon: '⚑', group: 'expand', goodHigh: false, flat: false },
  claim_cd:    { label: 'Перезарядка',  icon: '⏳', group: 'expand', goodHigh: false, flat: false },
};
const EC_GROUP_ORDER = ['econ', 'dev', 'expand'];
const EC_GROUP_TITLE = { econ: 'Экономика', dev: 'Развитие', expand: 'Экспансия' };
// Нормализует моды в список строк {key,meta,delta,good,flat}. mode='agg' → множители
// из ecFactionMods (1.10); mode='raw' → доли одного выбора (0.10). Плоские — целые в обоих.
function ecModRows(src, mode) {
  const rows = [];
  for (const key in EC_FIELD_META) {
    const meta = EC_FIELD_META[key];
    let delta;
    if (meta.flat) delta = Math.round(+src[key] || 0);
    else { const raw = +src[key] || 0; delta = mode === 'agg' ? Math.round((raw - 1) * 100) : Math.round(raw * 100); }
    if (!delta) continue;
    rows.push({ key, meta, delta, good: meta.goodHigh ? delta > 0 : delta < 0, flat: meta.flat });
  }
  return rows;
}
// Одна стат-полоска (бар, длина ∝ модулю значения).
function ecStatBar(r) {
  const sign = r.delta > 0 ? '+' : '';
  const unit = r.flat ? (r.meta.unit || '') : '%';
  const len = Math.min(100, Math.round(r.flat ? Math.abs(r.delta) * 28 : Math.abs(r.delta) * 4));
  return `<div class="ec-stat ${r.good ? 'pos' : 'neg'}"><span class="ec-stat-l">${r.meta.icon} ${r.meta.label}</span><span class="ec-stat-track"><i style="width:${len}%"></i></span><span class="ec-stat-v">${sign}${r.delta}${unit}</span></div>`;
}
// Профиль статов, сгруппированный по линиям (экономика/развитие/экспансия/безопасность).
function ecStatGroups(rows) {
  return EC_GROUP_ORDER.map(g => {
    const gr = rows.filter(r => r.meta.group === g);
    if (!gr.length) return '';
    return `<div class="ec-stat-grp"><div class="ec-stat-grp-t">${EC_GROUP_TITLE[g]}</div>${gr.map(ecStatBar).join('')}</div>`;
  }).join('');
}

// Компактные эффекты ОДНОГО выбора в анкете (cat: gov|regime|ideology|race|civ|capital).
function ecChoiceChips(cat, value) {
  const m = (cat === 'capital') ? (EC_CAPITAL[value] || {}).mods : (EC_MODS[cat] || {})[value];
  const rows = m ? ecModRows(m, 'raw') : [];
  const tags = rows.map(r => {
    const sign = r.delta > 0 ? '+' : '', unit = r.flat ? (r.meta.unit || '') : '%';
    return `<span class="ec-doc-tag ${r.good ? 'pos' : 'neg'}">${r.meta.icon} ${r.meta.label} ${sign}${r.delta}${unit}</span>`;
  });
  const bgBld = (EC_DOCTRINE_BUILD[cat] || {})[value];
  if (bgBld) tags.push(`<span class="ec-doc-tag grant">🏗 +${esc(ecBuildName(bgBld))}</span>`);
  if (cat === 'ideology' && EC_DOCTRINE_TECH[value]) tags.push(`<span class="ec-doc-tag grant">🔬 ${esc(EC_DOCTRINE_TECH[value])}</span>`);
  const slotBonus = (EC_DOCTRINE_SLOTS[cat] || {})[value];
  if (slotBonus) tags.push(`<span class="ec-doc-tag special">🔬 +${slotBonus} слот</span>`);
  // Для идеологии — шапка архетипа с сигнатурой.
  let head = '';
  if (cat === 'ideology' && EC_ARCHETYPE[value]) {
    const a = EC_ARCHETYPE[value];
    head = `<div class="ec-choice-arch" style="--lane:${EC_LANE_COLOR[a.lane] || EC_LANE_COLOR.econ}"><span class="ec-choice-arch-i">${EC_LANE_ICON[a.lane] || '⚜'}</span><b>${esc(a.title)}</b>${a.signature ? `<span class="ec-choice-sig">★ ${esc(a.signature)}</span>` : ''}</div>`;
  }
  if (!head && !tags.length) return '';
  return `<div class="ec-choice-eff">${head}${tags.length ? `<div class="ec-doc-tags">${tags.join('')}</div>` : ''}</div>`;
}
// Особые способности (не-процентные механики): роботы, «Дом в небесах».
function ecDoctrineSpecials(app) {
  app = app || EC.app || {};
  const isRobot = app.race === 'Синтетики / Киборги' || app.gov === 'Машинный разум (ИИ)';
  const research = (EC.eco && EC.eco.research) || [];
  const out = [];
  if (isRobot) {
    out.push('🪐 Все планеты родные — без терраформа');
    out.push('⚙ Пехота на Военном Заводе ×3');
    out.push('🔬 +1 слот исследований (машинный разум)');
  }
  // Пул захватов складывается по источникам (Экспансионизм + «Дом в небесах» + роботы).
  const claimMax = ecClaimMax(app);
  if (claimMax > 1) out.push(`⬢ ${claimMax} захвата подряд, затем перезарядка`);
  if (research.includes('pol.mind_supremacy')) out.push('🔬 +2 слота исследований — «Превосходство разума»');
  else if (research.includes('pol.light_knowledge')) out.push('🔬 +1 слот исследований — «Свет знаний»');
  const techno = ecTechnoSlots(app);
  if (techno) out.push(`🔬 +${techno} слот${techno > 1 ? 'а' : ''} исследований — технократия (доп. исследования)`);
  if (typeof ecResearchSlots === 'function') out.push(`🔬 Всего слотов исследований: ${ecResearchSlots()}`);
  // Небожители: разблокированные станции на непригодных мирах.
  EC_POLITICS.forEach(n => {
    if (n.special === 'station' && n.station && research.includes(n.id)) {
      out.push(`${n.station.icon || '★'} ${n.name} — станция на ${n.station.cells} ячеек`);
    }
  });
  const _bcN = (EC.eco && Array.isArray(EC.eco.borders_closed_fids)) ? EC.eco.borders_closed_fids.length : 0;
  if (_bcN) out.push(`🔒 Границы закрыты для ${_bcN} фракц. — их флоты в ваши системы не летают`);
  return out;
}
// Сводка конкретных стартовых плюшек доктрины (постройки + технологии).
function ecDoctrineGrants(app) {
  app = app || EC.app || {};
  const blds = [(EC_DOCTRINE_BUILD.gov || {})[app.gov], (EC_DOCTRINE_BUILD.ideology || {})[app.ideology]].filter(Boolean);
  const tech = EC_DOCTRINE_TECH[app.ideology];
  const items = [];
  blds.forEach(bt => items.push(`<span class="ec-doc-tag grant">🏗 ${esc(ecBuildName(bt))}</span>`));
  if (tech) items.push(`<span class="ec-doc-tag grant">🔬 ${esc(tech)}</span>`);
  return items;
}
// КАРТОЧКА ДОКТРИНЫ: герой-архетип + сигнатура + профиль статов + «Сила ↔ Цена» + плюшки.
function ecDoctrineHtml(app) {
  app = app || EC.app || {};
  const rows = ecModRows(ecFactionMods(app), 'agg');
  const arch = ecArchetype(app);
  if (!rows.length && !app.ideology && !app.gov) return '';
  const lane = EC_LANE_COLOR[arch.lane] || EC_LANE_COLOR.econ;
  const icon = EC_LANE_ICON[arch.lane] || '⚜';
  const sub = [app.gov, app.regime, app.ideology, app.race, app.civ_type === 'frontier' ? 'Фронтир' : (app.civ_type === 'colony' ? 'Колония' : '')].filter(Boolean).map(esc).join(' · ');
  const specials = ecDoctrineSpecials(app);
  const grants = ecDoctrineGrants(app);
  const strengths = rows.filter(r => r.good), costs = rows.filter(r => !r.good);
  const tradeTag = (r) => {
    const sign = r.delta > 0 ? '+' : '', unit = r.flat ? (r.meta.unit || '') : '%';
    return `<span class="ec-trade-tag ${r.good ? 'pos' : 'neg'}">${r.meta.icon} ${r.meta.label} <b>${sign}${r.delta}${unit}</b></span>`;
  };
  return `<div class="ec-doctrine" style="--lane:${lane}">
    <div class="ec-doc-hero">
      <div class="ec-doc-hero-ic">${icon}</div>
      <div class="ec-doc-hero-tx">
        <div class="ec-doc-hero-t">${esc(arch.title)}</div>
        <div class="ec-doc-hero-tag">${esc(arch.tagline)}</div>
        ${sub ? `<div class="ec-doc-hero-sub">${sub}</div>` : ''}
      </div>
    </div>
    ${arch.signature ? `<div class="ec-doc-sig"><span class="ec-doc-sig-star">★</span><div class="ec-doc-sig-tx"><div class="ec-doc-sig-h">Сигнатура</div><div class="ec-doc-sig-v">${esc(arch.signature)}</div></div></div>` : ''}
    ${specials.length ? `<div class="ec-doc-block"><div class="ec-doc-sect">Особые способности</div><div class="ec-doc-specials">${specials.map(s => `<div class="ec-doc-special">${esc(s)}</div>`).join('')}</div></div>` : ''}
    ${rows.length ? `<div class="ec-doc-block"><div class="ec-doc-sect">Профиль доктрины</div><div class="ec-stat-groups">${ecStatGroups(rows)}</div></div>
    <div class="ec-trade">
      <div class="ec-trade-col"><div class="ec-trade-h ec-trade-h-pos">▲ Сила</div><div class="ec-doc-tags">${strengths.length ? strengths.map(tradeTag).join('') : '<span class="ec-trade-none">—</span>'}</div></div>
      <div class="ec-trade-col"><div class="ec-trade-h ec-trade-h-neg">▼ Цена</div><div class="ec-doc-tags">${costs.length ? costs.map(tradeTag).join('') : '<span class="ec-trade-none">—</span>'}</div></div>
    </div>` : ''}
    ${grants.length ? `<div class="ec-doc-block"><div class="ec-doc-sect">Стартовые плюшки</div><div class="ec-doc-tags">${grants.join('')}</div></div>` : ''}
  </div>`;
}

// Суммарная суточная добыча по ресурсам (по всем mining-зданиям державы).
// Для каждого ресурса собираем ещё и источники (srcs): откуда, сколько слотов,
// какое богатство месторождения и какой вклад в добычу — для подробной справки.
function ecMineTotals() {
  const totals = new Map();
  EC.buildings.filter(ecIsMiner).forEach(b => {
    const colony = EC.colonies.find(c => c.id === b.colony_id);
    const colName = (colony && (colony.name || colony.planet_name)) || '—';
    const slots = Math.max(1, +b.slots_open || 1);
    ecMineYields(b).forEach(y => {
      const cur = totals.get(y.name) || { rate: 0, r: y.r, icon: y.icon, slots: 0, srcs: new Map() };
      cur.rate += y.rate; cur.slots += slots;
      const s = cur.srcs.get(colName) || { rate: 0, slots: 0, amt: y.amt };
      s.rate += y.rate; s.slots += slots; s.amt = y.amt;
      cur.srcs.set(colName, s);
      totals.set(y.name, cur);
    });
  });
  return totals;
}
// Добыча с ДОБЫВАЮЩИХ аванпостов за сутки — зеркало _outpost_mining_settle v2:
// каждый mode='mining' аванпост тянет ВСЕ ресурсы планет своей системы, КРОМЕ
// эпических и легендарных (элита — только экзотический экстрактор на колонии),
// по фикс-ставкам (вне границ — ниже колониальных) + EC_OUTPOST_MINE_GC ГС/сут.
// Возвращает { totals: Map(res→{rate,r,srcs:Map(sys→{rate,n})}), gc, n }.
const EC_OUTPOST_MINE_GC = 75;
const EC_OUTPOST_RES_RATE = { uncommon: 6, rare: 3, epic: 1, legendary: 1, common: 12 };
// Ресурсы, доступные для добычи в системе: Map(name → {r}). Берём с планет системы.
function ecSysResources(systemId) {
  const out = new Map();
  const sys = (EC.allSystems || []).find(s => s.id === systemId);
  const planets = (sys && Array.isArray(sys.planets)) ? sys.planets : [];
  planets.forEach(p => (Array.isArray(p.resources) ? p.resources : []).forEach(ri => {
    if (ri && ri.name && !out.has(ri.name)) out.set(ri.name, { r: ri.r || 'common' });
  }));
  return out;
}
function ecOutpostMineTotals() {
  const totals = new Map();
  let gc = 0, n = 0;
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  (EC.outposts || []).filter(o => o.mine && o.mode === 'mining').forEach(o => {
    n++; gc += EC_OUTPOST_MINE_GC;
    const sys = byId.get(o.system_id);
    const sysName = (sys && sys.name) || (typeof ecSysName === 'function' ? ecSysName(o.system_id) : o.system_id);
    const planets = (sys && Array.isArray(sys.planets)) ? sys.planets : [];
    planets.forEach(p => {
      (Array.isArray(p.resources) ? p.resources : []).forEach(ri => {
        if (!ri || !ri.name) return;
        const rar = ri.r || ecResRarity(ri.name);
        if (rar === 'epic' || rar === 'legendary') return;   // элита — только экзотический экстрактор
        const rate = EC_OUTPOST_RES_RATE[rar] != null ? EC_OUTPOST_RES_RATE[rar] : EC_OUTPOST_RES_RATE.common;
        const cur = totals.get(ri.name) || { rate: 0, r: rar, srcs: new Map() };
        cur.rate += rate;
        const s = cur.srcs.get(sysName) || { rate: 0, n: 0 };
        s.rate += rate; s.n += 1;
        cur.srcs.set(sysName, s);
        totals.set(ri.name, cur);
      });
    });
  });
  return { totals, gc, n };
}
// Человекочитаемые названия редкости ресурсов (для подробной справки).
const EC_RAR_LABEL = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', epic: 'эпический', legendary: 'легендарный' };
function ecRarLabel(r) { return EC_RAR_LABEL[r] || r || 'обычный'; }
// Полоска заполнения used/cap (для мощностей и ячеек).
function ecOvBar(used, cap, cls) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return `<span class="ec-ovx-bar"><span class="ec-ovx-bar-fill${cls ? ' ' + cls : ''}" style="width:${pct}%"></span></span>`;
}

// ── ДВИЖОК ГРАФИКОВ (чистый SVG, без библиотек) ─────────────────────────────
// «Красивое» округление верхней границы оси Y.
function ecChartNiceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return s * p;
}
const ecChartFmt = v => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1) + 'М' : a >= 1e3 ? Math.round(v / 1e3) + 'к' : ecNum(Math.round(v)); };
// Линейный/столбчатый/стопочный график.
// cfg: { labels:[str], series:[{name,color,vals:[num]}], type:'line'|'bar'|'stack', h, money, fmtTip }
function ecSvgChart(cfg) {
  const labels = cfg.labels || [], series = cfg.series || [], n = labels.length;
  if (!n) return '<div class="ec-chart-empty">Нет данных за выбранный период.</div>';
  const type = cfg.type || 'line';
  const VW = 1000, VH = cfg.h || 240, pad = { l: 56, r: 16, t: 16, b: 34 };
  const pw = VW - pad.l - pad.r, ph = VH - pad.t - pad.b;
  let yMax = 0, yMin = 0;
  if (type === 'stack') {
    for (let i = 0; i < n; i++) { let pos = 0, neg = 0; series.forEach(s => { const v = +s.vals[i] || 0; if (v >= 0) pos += v; else neg += v; }); yMax = Math.max(yMax, pos); yMin = Math.min(yMin, neg); }
  } else {
    series.forEach(s => s.vals.forEach(x => { const v = +x || 0; yMax = Math.max(yMax, v); yMin = Math.min(yMin, v); }));
  }
  yMax = ecChartNiceMax(yMax || 1);
  if (yMin < 0) yMin = -ecChartNiceMax(-yMin); else yMin = 0;
  const span = (yMax - yMin) || 1;
  const Y = v => pad.t + (1 - ((v - yMin) / span)) * ph;
  const bandW = pw / n;
  const cx = i => pad.l + bandW * (i + 0.5);
  // Сетка + подписи Y
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const val = yMin + span * (k / 4), y = Y(val);
    grid += `<line class="ec-chart-grid" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${VW - pad.r}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ec-chart-ylab" x="${pad.l - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${ecChartFmt(val)}</text>`;
  }
  if (yMin < 0) { const y0 = Y(0); grid += `<line class="ec-chart-zero" x1="${pad.l}" y1="${y0.toFixed(1)}" x2="${VW - pad.r}" y2="${y0.toFixed(1)}"/>`; }
  // Подписи X (прорежаем)
  const step = Math.ceil(n / 9);
  let xlab = '';
  for (let i = 0; i < n; i++) if (i % step === 0 || i === n - 1) xlab += `<text class="ec-chart-xlab" x="${cx(i).toFixed(1)}" y="${VH - 12}" text-anchor="middle">${esc(labels[i])}</text>`;
  // Тело графика
  let body = '';
  const tip = (i, extra) => `${esc(labels[i])}${extra}`;
  if (type === 'stack') {
    const bw = Math.min(38, bandW * 0.62);
    for (let i = 0; i < n; i++) {
      let accP = 0, accN = 0;
      series.forEach(s => {
        const v = +s.vals[i] || 0; if (!v) return;
        const y0 = v >= 0 ? Y(accP + v) : Y(accN); const y1 = v >= 0 ? Y(accP) : Y(accN + v);
        if (v >= 0) accP += v; else accN += v;
        const hh = Math.max(0.5, y1 - y0);
        body += `<rect class="ec-chart-seg" x="${(cx(i) - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" fill="${s.color}" rx="1.5"><title>${tip(i, `\n${s.name}: ${ecNum(v)}`)}</title></rect>`;
      });
    }
  } else if (type === 'bar') {
    const s = series[0], bw = Math.min(40, bandW * 0.6);
    for (let i = 0; i < n; i++) {
      const v = +s.vals[i] || 0, y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)), hh = Math.max(0.5, y1 - y0);
      body += `<rect class="ec-chart-seg" x="${(cx(i) - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" fill="${v < 0 ? 'var(--rd,#c0392b)' : s.color}" rx="1.5"><title>${tip(i, `\n${s.name}: ${ecNum(v)}`)}</title></rect>`;
    }
  } else { // line
    series.forEach(s => {
      const pts = s.vals.map((v, i) => `${cx(i).toFixed(1)},${Y(+v || 0).toFixed(1)}`).join(' ');
      const areaPts = `${cx(0).toFixed(1)},${Y(yMin < 0 ? 0 : yMin).toFixed(1)} ${pts} ${cx(n - 1).toFixed(1)},${Y(yMin < 0 ? 0 : yMin).toFixed(1)}`;
      if (s.fill !== false) body += `<polygon class="ec-chart-area" points="${areaPts}" fill="${s.color}" opacity="0.10"/>`;
      body += `<polyline class="ec-chart-line" points="${pts}" stroke="${s.color}" fill="none"/>`;
      s.vals.forEach((v, i) => { body += `<circle class="ec-chart-dot" cx="${cx(i).toFixed(1)}" cy="${Y(+v || 0).toFixed(1)}" r="3" fill="${s.color}"><title>${tip(i, `\n${s.name}: ${ecNum(+v || 0)}`)}</title></circle>`; });
    });
  }
  const legend = series.length > 1 ? `<div class="ec-chart-legend">${series.map(s => `<span class="ec-chart-leg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<div class="ec-chart-wrap"><svg class="ec-chart-svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" role="img">${grid}${body}${xlab}</svg>${legend}</div>`;
}

// Кольцевая диаграмма состава (donut). parts: [{name,color,value}] — только value>0.
function ecSvgDonut(parts, opts) {
  parts = (parts || []).filter(p => (+p.value || 0) > 0);
  const total = parts.reduce((a, p) => a + (+p.value || 0), 0);
  if (!total) return '';
  const R = 52, r = 32, C = 60, circ = 2 * Math.PI * ((R + r) / 2), sw = R - r;
  let off = 0, segs = '';
  parts.forEach(p => {
    const frac = (+p.value || 0) / total, len = frac * circ;
    segs += `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${p.color}" stroke-width="${sw}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
      transform="rotate(-90 ${C} ${C})"><title>${esc(p.name)}: ${ecNum(Math.round(p.value))} (${Math.round(frac * 100)}%)</title></circle>`;
    off += len;
  });
  const center = opts && opts.center ? `<text class="ec-donut-c" x="${C}" y="${C - 2}" text-anchor="middle">${esc(opts.center)}</text>${opts.sub ? `<text class="ec-donut-s" x="${C}" y="${C + 12}" text-anchor="middle">${esc(opts.sub)}</text>` : ''}` : '';
  const legend = parts.map(p => `<span class="ec-donut-leg"><i style="background:${p.color}"></i>${esc(p.name)} <b>${Math.round((+p.value || 0) / total * 100)}%</b></span>`).join('');
  return `<div class="ec-donut-wrap"><svg class="ec-donut-svg" viewBox="0 0 120 120">${segs}${center}</svg><div class="ec-donut-legend">${legend}</div></div>`;
}

// ── ПАНЕЛЬ СТАТИСТИКИ ФРАКЦИИ: график + фильтры метрик/периода + сводка + журнал ──
const EC_STAT_METRICS = [
  { id: 'net',     name: 'Чистый доход', ic: '💰', color: 'var(--gd)',         type: 'bar',   field: r => +r.gc_net || 0,   unit: 'ГС' },
  { id: 'balance', name: 'Казна',        ic: '🏦', color: 'var(--gdl,var(--gd))', type: 'line',  field: r => +r.gc_after || 0, unit: 'ГС' },
  { id: 'sources', name: 'Доходы по статьям', ic: '📊', color: '',              type: 'stack', unit: 'ГС' },
  { id: 'mined',   name: 'Добыча',       ic: '⛏', color: 'var(--te)',          type: 'bar',   field: r => +r.mined || 0,    unit: 'ед.' },
  { id: 'sci',     name: 'Наука',        ic: '🔬', color: 'var(--pu)',          type: 'line',  field: r => +r.sci || 0,      unit: 'ОН' },
];
// Легенда иконок журнала: эмодзи → расшифровка (чипы в журнале сами по себе непонятны).
const EC_STAT_LEGEND = [
  ['🏭', 'фабрики и торговые хабы'], ['🚚', 'караваны'], ['📈', 'товарная биржа'],
  ['📤', 'экспорт добычи'], ['📜', 'апкип торговой политики (расход)'], ['⛏', 'добыто на склад'], ['🔬', 'наука'],
];
function ecStatLabel(r) {
  const dt = r.tick_at ? new Date(r.tick_at) : null;
  return dt ? dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—';
}
// Outer-обёртка со стабильным id — содержимое перерисовываем на месте (без полного
// перерендера кабинета и прыжка скролла) при смене метрики/периода/журнала.
function ecStatsPanel() {
  return `<div class="ec-ovx-panel ec-stat-panel" id="ec-stat-panel" style="grid-column:1/-1">${ecStatsInner()}</div>`;
}
function ecStatRepaint() {
  const el = document.getElementById('ec-stat-panel');
  if (el) el.innerHTML = ecStatsInner(); else if (typeof ecPaintCabinet === 'function') ecPaintCabinet();
}
function ecStatToggleLog() { const s = ecOvState(); s.exp.statlog = !s.exp.statlog; ecStatRepaint(); }
function ecStatsInner() {
  const hAll = (EC.incomeHistory || []).slice();   // desc (новые сверху)
  if (!hAll.length) return `<div class="ec-ovx-panel-t">📈 Статистика фракции <span class="ec-ovx-panel-sub">доходы · расходы · добыча по ходам</span></div>
    <div class="ec-ovx-empty">Истории пока нет — она появится после первого начисления (тика). Сделайте ход, и здесь будут графики доходов, расходов и добычи по времени.</div>`;
  const st = ecOvState();
  // Период не может быть больше, чем накоплено ходов — иначе кнопки «30/всё» выглядят бесполезными.
  let range = st.range || 14;
  const slice = (range >= 999 ? hAll : hAll.slice(0, range)).slice().reverse();
  const labels = slice.map(ecStatLabel);
  const metric = EC_STAT_METRICS.find(m => m.id === st.chart) || EC_STAT_METRICS[0];

  // Кнопки выбора метрики
  const metricBtns = EC_STAT_METRICS.map(m =>
    `<button type="button" class="ec-stat-mbtn${m.id === metric.id ? ' on' : ''}" onclick="ecOvSetChart('${m.id}')">${m.ic} ${m.name}</button>`).join('');
  // Кнопки периода: прячем те, что превышают объём истории (кроме активной/«всё»).
  const ranges = [[7, '7 ход.'], [14, '14 ход.'], [30, '30 ход.'], [999, 'всё']];
  const rangeBtns = ranges.filter(([v]) => v >= 999 || v <= hAll.length + (range === v ? 999 : 0) || v === 7).map(([v, l]) =>
    `<button type="button" class="ec-stat-rbtn${range === v ? ' on' : ''}" onclick="ecOvSetRange(${v})">${l}</button>`).join('');

  // Данные графика
  let chart, sumLine;
  if (metric.id === 'sources') {
    const series = [
      { name: '🏭 Фабрики/хабы', color: 'var(--gd)',         vals: slice.map(r => +r.gc_build || 0) },
      { name: '🚚 Караваны',      color: 'var(--te)',          vals: slice.map(r => +r.gc_trade || 0) },
      { name: '📈 Биржа',         color: 'var(--ok)',          vals: slice.map(r => +r.gc_market || 0) },
      { name: '📤 Экспорт',       color: 'var(--ec-amb,#e0a030)', vals: slice.map(r => +r.gc_export || 0) },
      { name: '📜 Апкип политики', color: 'var(--rd,#c0392b)',  vals: slice.map(r => -(+r.gc_policy || 0)) },
    ].filter(s => s.vals.some(v => v));
    chart = ecSvgChart({ labels, series, type: 'stack', h: 250 });
    const tot = { b: 0, t: 0, mk: 0, e: 0, p: 0 };
    slice.forEach(r => { tot.b += +r.gc_build || 0; tot.t += +r.gc_trade || 0; tot.mk += +r.gc_market || 0; tot.e += +r.gc_export || 0; tot.p += +r.gc_policy || 0; });
    const grossAll = tot.b + tot.t + tot.mk + tot.e;
    sumLine = `<div class="ec-stat-sum">
      <span class="ec-stat-sum-i">всего получено: <b class="pos">+${ecNum(grossAll)}</b> ГС</span>
      <span class="ec-stat-sum-i">расходы (апкип): <b class="neg">−${ecNum(tot.p)}</b> ГС</span>
      <span class="ec-stat-sum-i">чисто: <b>${grossAll - tot.p >= 0 ? '+' : ''}${ecNum(grossAll - tot.p)}</b> ГС</span>
    </div>`;
  } else {
    const vals = slice.map(metric.field);
    chart = ecSvgChart({ labels, series: [{ name: metric.name, color: metric.color, vals }], type: metric.type, h: 250 });
    const sum = vals.reduce((a, b) => a + b, 0), avg = vals.length ? sum / vals.length : 0;
    const mx = Math.max(...vals, 0), mn = Math.min(...vals, 0);
    sumLine = `<div class="ec-stat-sum">
      <span class="ec-stat-sum-i">сумма: <b>${ecNum(Math.round(sum))}</b> ${metric.unit}</span>
      <span class="ec-stat-sum-i">в среднем: <b>${ecNum(Math.round(avg))}</b> ${metric.unit}/ход</span>
      <span class="ec-stat-sum-i">макс: <b class="pos">${ecNum(mx)}</b></span>
      ${mn < 0 ? `<span class="ec-stat-sum-i">мин: <b class="neg">${ecNum(mn)}</b></span>` : ''}
    </div>`;
  }

  // Журнал тиков (свёрнут по умолчанию) — детально что/откуда за каждый ход
  const open = ecOvExpanded('statlog');
  const legend = `<div class="ec-ih-legend">${EC_STAT_LEGEND.map(([ic, t]) => `<span class="ec-ih-leg"><b>${ic}</b> ${esc(t)}</span>`).join('')}</div>`;
  const logRows = slice.slice().reverse().map(r => {   // снова новые сверху для журнала
    const net = +r.gc_net || 0;
    const dt = r.tick_at ? new Date(r.tick_at) : null;
    const when = dt ? `${dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '—';
    const chip = (cond, cls, txt, title) => cond ? `<span class="ec-ih-chip${cls ? ' ' + cls : ''}" data-tip="${esc(title)}">${txt}</span>` : '';
    const parts = [
      chip(+r.gc_build, '', `🏭 +${ecNum(+r.gc_build)}`, 'Гражданские фабрики и торговые хабы — основной доход ГС'),
      chip(+r.gc_trade, '', `🚚 +${ecNum(+r.gc_trade)}`, 'Караваны — продажа и доля с поставок'),
      chip(+r.gc_market, '', `📈 +${ecNum(+r.gc_market)}`, 'Товарная биржа — сбыт свежедобытого потока за ГС (склад не трогает)'),
      chip(+r.gc_export, '', `📤 +${ecNum(+r.gc_export)}`, 'Экспорт добычи караванами'),
      chip(+r.gc_policy, 'neg', `📜 −${ecNum(+r.gc_policy)}`, 'Апкип торговой политики — расход ГС'),
      chip(+r.mined, 'res', `⛏ ${ecNum(+r.mined)}`, 'Добыто ресурсов на склад за этот ход'),
      chip(+r.sci, 'sci', `🔬 +${ecNum(+r.sci)}`, 'Очки науки получено'),
    ].filter(Boolean).join('');
    return `<div class="ec-ih-row">
        <div class="ec-ih-head">
          <span class="ec-ih-when">${esc(when)}${(+r.days > 1) ? ` · ${r.days} дн.` : ''}</span>
          <span class="ec-ih-net ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${ecNum(net)} ГС · казна ${ecNum(+r.gc_after || 0)}</span>
        </div>
        <div class="ec-ih-chips">${parts || '<span class="ec-ih-chip">нет потоков</span>'}</div>
      </div>`;
  }).join('');

  return `<div class="ec-ovx-panel-t">📈 Статистика фракции <span class="ec-ovx-panel-sub">${metric.ic} ${esc(metric.name)} · последние ${slice.length} ход(ов)</span></div>
    <div class="ec-stat-controls">
      <div class="ec-stat-metrics">${metricBtns}</div>
      <div class="ec-stat-ranges"><span class="ec-stat-ranges-k">период:</span>${rangeBtns}</div>
    </div>
    ${chart}
    ${sumLine}
    <button type="button" class="ec-fold-btn${open ? ' open' : ''}" onclick="ecStatToggleLog()">
      <span class="ec-fold-chev">${open ? '▾' : '▸'}</span>
      <span class="ec-fold-lbl">🧾 Журнал по ходам</span>
      <span class="ec-fold-sub">что/откуда/когда за каждый тик</span>
    </button>
    ${open ? `<div class="ec-ih-detail">${legend}<div class="ec-ih-list">${logRows}</div></div>` : ''}`;
}

// Статистика за ходы — разбивка «сколько чего пришло» по статьям (income_history)
function ecIncomeHistoryPanel() {
  const h = EC.incomeHistory || [];
  if (!h.length) return `<div class="ec-ovx-panel" style="grid-column:1/-1"><div class="ec-ovx-panel-t">📈 Статистика за ходы</div><div class="ec-ovx-empty">Истории пока нет — появится после первого начисления (тика). Сделайте ход и она начнёт наполняться.</div></div>`;
  const rows = h.map(r => {
    const net = +r.gc_net || 0;
    const dt = r.tick_at ? new Date(r.tick_at) : null;
    const when = dt ? `${dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '—';
    const chip = (cond, cls, txt, title) => cond ? `<span class="ec-ih-chip${cls ? ' ' + cls : ''}" title="${esc(title)}">${txt}</span>` : '';
    const parts = [
      chip(+r.gc_build, '', `🏭 +${ecNum(+r.gc_build)}`, 'Фабрики и торговые хабы'),
      chip(+r.gc_trade, '', `🚚 +${ecNum(+r.gc_trade)}`, 'Караваны'),
      chip(+r.gc_market, '', `📈 +${ecNum(+r.gc_market)}`, 'Товарная биржа'),
      chip(+r.gc_export, '', `📤 +${ecNum(+r.gc_export)}`, 'Экспорт добычи'),
      chip(+r.gc_policy, 'neg', `📜 −${ecNum(+r.gc_policy)}`, 'Апкип торговой политики'),
      chip(+r.mined, 'res', `⛏ ${ecNum(+r.mined)}`, 'Добыто ресурсов на склад'),
      chip(+r.sci, 'sci', `🔬 +${ecNum(+r.sci)}`, 'Наука'),
    ].filter(Boolean).join('');
    return `<div class="ec-ih-row">
        <div class="ec-ih-head">
          <span class="ec-ih-when">${esc(when)}${(+r.days > 1) ? ` · ${r.days} дн.` : ''}</span>
          <span class="ec-ih-net ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${ecNum(net)} ГС</span>
        </div>
        <div class="ec-ih-chips">${parts || '<span class="ec-ih-chip">нет потоков</span>'}</div>
      </div>`;
  }).join('');
  return `<div class="ec-ovx-panel" style="grid-column:1/-1">
    <div class="ec-ovx-panel-t">📈 Статистика за ходы <span class="ec-ovx-panel-sub">что приходило в казну за каждый тик · последние ${h.length}</span></div>
    <div class="ec-ih-list">${rows}</div>
  </div>`;
}
// ── ДОСТИЖЕНИЯ (ачивки) — в стиле стоицизма ─────────────────
// Каталог = зеркало RPC ach_check (_achievements.sql). Условия и награды
// считает сервер; здесь — только подписи, арт и порядок показа.
// Арт игрок заливает в assets/ach/<id>.webp (см. assets/ach/_IMAGES.md);
// если файла нет — показываем эмодзи-заглушку, вёрстка не ломается.
// Ачивки живут в отдельной вкладке «Достижения» (ecTabAchievements ниже);
// в «Обзоре» — только компактная карточка-зазывалка (ecAchOverviewTeaser).
const EC_ACH = {
  sibi_imperare: { name: 'Власть над собой', ic: '🜍', reward: 1000,
    quote: 'Imperare sibi maximum imperium est.',
    desc: 'Наивысшая власть есть власть над собой.',
    cond: 'Заверши первое исследование' },
  constantia: { name: 'Постоянство', ic: '🜔', reward: 2000,
    quote: 'Gutta cavat lapidem non vi, sed saepe cadendo.',
    desc: 'Не силой, но постоянством капля точит камень.',
    cond: 'Возведи 10 построек' },
  cosmopolites: { name: 'Гражданин космоса', ic: '🜨', reward: 2500,
    quote: 'Дорогой мне град Зевса, весь мир.',
    desc: 'Для мудреца отечество весь космос.',
    cond: 'Удержи 5 колоний' },
  amor_fati: { name: 'Возлюби судьбу', ic: '🜂', reward: 0,
    quote: 'Amor fati, не желай, чтобы было иначе.',
    desc: 'Один из множества ударов судьбы.',
    cond: 'Стань целью вражеской операции' },
  dichotomia: { name: 'Дихотомия контроля', ic: '🜁', reward: 1500,
    quote: 'Различай подвластное тебе и неподвластное.',
    desc: 'Властвуй над тем, что в твоей власти.',
    cond: 'Открой первый торговый путь' },
  temperantia: { name: 'Изобилие в умеренности', ic: '🜛', reward: 0,
    quote: 'Богат не тот, у кого много, а кто малым доволен.',
    desc: 'Владей, не привязываясь.',
    cond: 'Скопи 10 000 ГС в казне' },

  // ── Тяжёлые ачивки (четыре добродетели + усердие) ──
  sophia: { name: 'Знание сущего', ic: '🜚', reward: 4000,
    quote: 'Мудрость есть знание дел божественных и человеческих.',
    desc: 'Истинная мудрость объемлет всё.',
    cond: 'Изучи 10 технологий' },
  fortitudo: { name: 'Ни мужества, ни чести', ic: '🜏', reward: 4000,
    quote: 'Мужество есть знание того, чего следует и не следует страшиться.',
    desc: 'Доблесть проверяется в деле, а не в покое.',
    cond: 'Проведи успешный рейд' },
  prudentia: { name: 'Предусмотрительность', ic: '🜖', reward: 3500,
    quote: 'Разумный знает прежде, чем действует.',
    desc: 'Кто предвидит, тот владеет.',
    cond: 'Успешно проведи разведывательную операцию' },
  iustitia: { name: 'Воздать каждому своё', ic: '🜂', reward: 3500,
    quote: 'Справедливость воздаёт каждому по достоинству.',
    desc: 'Сильный поддерживает, а не только берёт.',
    cond: 'Выдай заём другой фракции' },
  magnum_opus: { name: 'Великое из малого', ic: '🜕', reward: 7000,
    quote: 'Великое не родится вдруг.',
    desc: 'Держава растёт трудом без устали.',
    cond: 'Возведи 30 построек' },

  // ── Большой набор: масштаб державы ──
  abundantia: { name: 'Изобилие...', ic: '🜝', reward: 8000,
    quote: 'Magnae fortunae magna servitus.',
    desc: 'Большое богатство есть большая ответственность.',
    cond: 'Скопи 50 000 ГС в казне' },
  imperium_sine_fine: { name: 'Границы Империи нигде не заканчиваются', ic: '🝆', reward: 8000,
    quote: 'Imperium sine fine dedi.',
    desc: 'Жизненного пространства много не бывает.',
    cond: 'Удержи 10 колоний' },
  res_publica: { name: 'Общее дело', ic: '🝅', reward: 15000,
    quote: 'Res publica res populi.',
    desc: 'Государство есть дело народа.',
    cond: 'Возведи 100 построек' },
  terra_nova: { name: 'Новое небо и новая земля', ic: '🝧', reward: 3000,
    quote: 'Naturam mutare labor.',
    desc: 'Так долго копировать всё за природой, чтобы изменить и её?',
    cond: 'Терраформируй планету' },
  magnae_divitiae: { name: 'Закрома', ic: '🝐', reward: 4000,
    quote: 'Divitiae apud sapientem virum in servitute sunt.',
    desc: 'У мудрого богатство в услужении, а не он у богатства.',
    cond: 'Накопи 100 единиц одного ресурса' },

  // ── Наука ──
  omniscientia: { name: 'Объять сущее', ic: '🜿', reward: 10000,
    quote: 'Omnia mea mecum porto.',
    desc: 'Всё своё ношу с собою - в разуме.',
    cond: 'Изучи 25 технологий' },

  // ── Торговля ──
  mercator: { name: 'Купеческие пути', ic: '🝁', reward: 4000,
    quote: 'Navigare necesse est.',
    desc: 'Торговля движет мирами, подобно притяжение.',
    cond: 'Держи 5 торговых путей' },
  via_argentaria: { name: 'Серебряный путь', ic: '🝍', reward: 3000,
    quote: 'Pecunia nervus rerum.',
    desc: 'Деньги есть движитель всех дел, даже дел изыскательских.',
    cond: 'Продай технологию на рынке' },

  // ── Война ──
  legio: { name: 'Мечи к солнцу', ic: '🜨', reward: 3500,
    quote: 'Si vis pacem, para bellum.',
    desc: 'Хочешь мира - готовь войско.',
    cond: 'Спроектируй 5 боевых единиц' },
  imperator_belli: { name: 'Вождь войны', ic: '🜟', reward: 8000,
    quote: 'Veni, vidi, vici.',
    desc: 'Пришёл, увидел, победил - и так пять раз.',
    cond: 'Проведи 5 успешных рейдов' },

  // ── Шпионаж ──
  magister_arcanorum: { name: 'Мастер тайн', ic: '🜗', reward: 8000,
    quote: 'Qui tacet consentire videtur.',
    desc: 'Кто молчит - тот знает больше.',
    cond: 'Проведи 5 успешных разведопераций' },
  missionarius: { name: 'Тайный поклонник', ic: '🜘', reward: 3000,
    quote: 'Sub rosa.',
    desc: 'Под розой молчания зреет вера.',
    cond: 'Внедри тайную секту в чужую державу' },

  // ── Урон тайных операций (накопительные итоги) ──
  praeda_aurea: { name: 'Добыча', ic: '💰', reward: 4000,
    quote: 'Lucri bonus est odor ex re qualibet.',
    desc: 'Запах прибыли хорош, откуда бы она ни шла.',
    cond: 'Укради из чужих казён 25 000 ГС суммарно' },
  fur_maximus: { name: 'Лучше, чем в Ренессансе', ic: '🎭', reward: 9000,
    quote: 'Occasio facit furem.',
    desc: 'Случай делает вором, а ты не упускаешь ни одного?',
    cond: 'Укради из чужих казён 100 000 ГС суммарно' },
  direptor: { name: 'Расхититель', ic: '📦', reward: 3500,
    quote: 'Spolia opima.',
    desc: 'Чужие закрома пустеют твоими трудами.',
    cond: 'Укради чужого сырья 100 единиц суммарно' },
  eversor: { name: 'Плановая деконструкция', ic: '💥', reward: 4000,
    quote: 'Delenda est.',
    desc: 'То, что построено врагом, должно быть разрушено.',
    cond: 'Уничтожь тайными операциями 10 чужих построек' },
  vastator: { name: 'Выженная земля', ic: '🔥', reward: 8000,
    quote: 'Solitudinem faciunt, pacem appellant.',
    desc: 'Оставляй руины и называй это миром, что они заслужили.',
    cond: 'Уничтожь тайными операциями 50 чужих построек' },
  sicarius: { name: 'Встреча с лезвием Немизиды', ic: '🗡', reward: 3500,
    quote: 'Sublata causa, tollitur effectus.',
    desc: 'Устрани причину, тогда исчезнет и следствие.',
    cond: 'Раскрой 3 вражеских агента' },
  fur_arcanorum: { name: 'Похититель тайн', ic: '📜', reward: 4000,
    quote: 'Scientia rapta — vis parta.',
    desc: 'Похищенное знание есть обретённая сила.',
    cond: 'Укради 3 чужие технологии' },

  // ── Вера ──
  credens: { name: 'Верующий', ic: '🝫', reward: 1500,
    quote: 'Credo ut intelligam.',
    desc: 'Верю, чтобы понимать.',
    cond: 'Прими веру' },
  fides_fundata: { name: 'Школа разума', ic: '🝬', reward: 3000,
    quote: 'In principio erat verbum.',
    desc: 'В начале было слово.',
    cond: 'Основай собственную веру' },
  pontifex_maximus: { name: 'Звездный понтифик', ic: '🝭', reward: 5000,
    quote: 'Vox populi, vox Dei.',
    desc: 'Голос народа - голос неба.',
    cond: 'Добейся признания веры тремя державами' },

  // ── Дипломатия ──
  foederati: { name: 'Союзник', ic: '🝳', reward: 2000,
    quote: 'Concordia parvae res crescunt.',
    desc: 'В согласии растёт и малое.',
    cond: 'Вступи в союз' },
  dux_foederis: { name: 'Глава союза', ic: '🝴', reward: 4000,
    quote: 'Primus inter pares.',
    desc: 'Первый среди равных.',
    cond: 'Возглавь союз' },
  dominus_terrarum: { name: 'Сюзерен', ic: '🝵', reward: 5000,
    quote: 'Divide et impera.',
    desc: 'Разделяй и властвуй.',
    cond: 'Возьми державу в вассалитет' },
  creditor_magnus: { name: 'Великий кредитор', ic: '🝎', reward: 4000,
    quote: 'Qui dat, accipit.',
    desc: 'Кто даёт - тот и получает.',
    cond: 'Выдай заём на 20 000 ГС' },

  // ── Слово ──
  vox_imperii: { name: 'Глас и воля миллиардов', ic: '🝪', reward: 2000,
    quote: 'Verba volant, scripta manent.',
    desc: 'Слова уходят, но написанное остаётся.',
    cond: 'Опубликуй новость державы' },

  // ── Инфраструктура ──
  classis: { name: 'Верфь', ic: '🝓', reward: 2500,
    quote: 'Qui mare teneat, eum necesse rerum potiri.',
    desc: 'Кто владеет навигационной орбитой, тот владеет всем.',
    cond: 'Заложи верфь' },
  cohors_arcana: { name: 'Тиха секторальная ночь', ic: '🝏', reward: 2500,
    quote: 'Praemonitus, praemunitus.',
    desc: 'Кто предупреждён - тот вооружён.',
    cond: 'Открой разведцентр' },
  plena_officina: { name: 'Полная мощность', ic: '🝒', reward: 3000,
    quote: 'Festina lente.',
    desc: 'Спеши медленно, но раскрой всё до конца.',
    cond: 'Построй все 6 слотов одной постройки' },
  copia_rerum: { name: 'Многообразие благ', ic: '🝑', reward: 3000,
    quote: 'Varietas delectat.',
    desc: 'Это радует и укрепляет, разве нет?',
    cond: 'Имей в запасе 5 разных ресурсов' },
  arsenal: { name: 'Всё больше проектов', ic: '🝕', reward: 6000,
    quote: 'In arsenali virtus.',
    desc: 'Лушче союзников, чем армия и флот, увы, в политике не бывает.',
    cond: 'Спроектируй 15 боевых единиц' },
  arma_omnia: { name: 'Час Х', ic: '🝖', reward: 4000,
    quote: 'Bellum omnium contra omnes.',
    desc: 'Кто готов ко всему, тот не застигнут врасплох.',
    cond: 'Создай юнит каждого рода войск' },

  // ── Оборона ──
  contra_speculator: { name: 'Тимур гордился бы вами', ic: '🝙', reward: 3500,
    quote: 'Caveat emptor.',
    desc: 'Чужой соглядатай схвачен у твоих ворот.',
    cond: 'Раскрой вражеского шпиона' },
  inquisitor: { name: 'Дознаватель', ic: '🔍', reward: 6000,
    quote: 'Quis custodiet ipsos custodes?',
    desc: 'Кто устережёт самих сторожей? Только ты.',
    cond: 'Раскрой 5 чужих шпионов (в т.ч. через расследование)' },
  // ── Тонкая торговля ──
  permutatio: { name: 'Мена?', ic: '🝛', reward: 2500,
    quote: 'Do ut des.',
    desc: 'Ты мне древосталь, а я тебе котлы.',
    cond: 'Заключи бартерную сделку' },
  emptor: { name: 'Сумма технологий', ic: '🝜', reward: 2500,
    quote: 'Bona fide.',
    desc: 'Добросовестно приобрети чужой труд.',
    cond: 'Купи технологию на рынке' },

  // ── Тонкая дипломатия ──
  fidelis: { name: 'Верный вассал', ic: '🝝', reward: 2000,
    quote: 'Fideli certa merces.',
    desc: 'Верному - верная награда.',
    cond: 'Стань вассалом другой державы' },
  amicitia: { name: 'Дружба', ic: '🝞', reward: 3000,
    quote: 'Amicus certus in re incerta cernitur.',
    desc: 'Верный друг познаётся в беде.',
    cond: 'Достигни прочной дружбы с державой' },
  debitum_solutum: { name: 'Долг платежом', ic: '🝟', reward: 2500,
    quote: 'Qui solvit, liberatur.',
    desc: 'Кто платит, тот свободен.',
    cond: 'Погаси взятый заём' },

  // ── Познание ──
  duae_viae: { name: 'Дуализм мысли', ic: '🝠', reward: 3000,
    quote: 'Per aspera ad astra.',
    desc: 'Иди через тернии двумя путями сразу.',
    cond: 'Веди 2 исследования одновременно' },
  ordo_cognoscendi: { name: 'Порядок познания', ic: '🝡', reward: 2000,
    quote: 'Ordo ab chao.',
    desc: 'Порядок из хаоса, хаос из порядка.',
    cond: 'Выстрой очередь из 3 технологий' },

  // ════════ ГРАНД-ТИРЫ — вершины каждой ветви ════════
  croesus: { name: 'Богатство Креза', ic: '🜢', reward: 15000,
    quote: 'Aurea mediocritas - но казна полна до краёв.',
    desc: 'Богатейший среди богатых.',
    cond: 'Скопи 250 000 ГС в казне' },
  urbs_aeterna: { name: 'Вечный город', ic: '🜣', reward: 20000,
    quote: 'Roma aeterna.',
    desc: 'Держава, что переживёт века.',
    cond: 'Возведи 150 построек' },
  pax_galactica: { name: 'Галактический мир', ic: '🜤', reward: 15000,
    quote: 'Pax per imperium.',
    desc: 'Мир, что держится силой державы.',
    cond: 'Удержи 20 колоний' },
  terraformator: { name: 'Преобразитель миров', ic: '🝨', reward: 6000,
    quote: 'Ex nihilo nihil — но из пустыни рождается жизнь.',
    desc: 'Три мёртвых мира зацвели твоим трудом.',
    cond: 'Терраформируй 3 планеты' },
  thesaurus: { name: 'Сокровищница', ic: '🝩', reward: 8000,
    quote: 'Ubi thesaurus tuus, ibi cor tuum.',
    desc: 'Где сокровище твоё, там и сердце твоё.',
    cond: 'Накопи 500 единиц одного ресурса' },
  sapientia_summa: { name: 'Высшая мудрость', ic: '🜦', reward: 20000,
    quote: 'Sapientia summa.',
    desc: 'Познавший почти всё сущее.',
    cond: 'Изучи 50 технологий' },
  magister_magnus: { name: 'Тихо ходит лихо', ic: '🜫', reward: 12000,
    quote: 'Scientia occulta — vis maxima.',
    desc: 'Будет забавно, когда оповещение об этом всплывёт в галактической ленте...',
    cond: 'Проведи 10 успешных разведопераций' },
  archipirata: { name: 'Архипират', ic: '🜬', reward: 12000,
    quote: 'Mare nostrum — всё наше.',
    desc: 'Гроза торговых путей галактики.',
    cond: 'Проведи 10 успешных рейдов' },
  machina_belli: { name: 'Военная машина', ic: '🜭', reward: 10000,
    quote: 'Cedant arma — но не твои.',
    desc: 'Несокрушимая военная мощь.',
    cond: 'Спроектируй 30 боевых единиц' },
  via_magna: { name: 'Продаван', ic: '🝂', reward: 6000,
    quote: 'Omnes viae ad opes ducunt.',
    desc: 'Путеводная звезда галактической торговли.',
    cond: 'Держи 10 торговых путей' },
  imperator_imperatorum: { name: 'Галактический чиноначальник', ic: '🝷', reward: 10000,
    quote: 'Rex regum.',
    desc: 'Три державы склонились под твою руку.',
    cond: 'Держи 3 вассала одновременно' },

  // ════════ ВОЕНКА — техи классов и реальное производство ════════
  crucigera: { name: 'Крейсерская верфь', ic: '🜪', reward: 3000,
    quote: 'Maiora premunt.',
    desc: 'Капитальные корабли вновь среди звезд.',
    cond: 'Открой класс «Крейсер» в дереве технологий' },
  dreadnought: { name: 'Медленно, но верно', ic: '🜨', reward: 6000,
    quote: 'Ultima ratio regum.',
    desc: 'Титаны снова пройдут по земле.',
    cond: 'Открой класс «Дредноут» в дереве технологий' },
  centuria_navium: { name: 'Сотни вымелов', ic: '🜬', reward: 5000,
    quote: 'Multitudo navium.',
    desc: 'Они затмят собой звёзды.',
    cond: 'Построй 100 корветов' },
  leviathan: { name: 'Эхо великой войны', ic: '🜭', reward: 6000,
    quote: 'Behemoth maris.',
    desc: 'Стальной исполин сошел со стапелей.',
    cond: 'Построй дредноут' },
  classis_magna: { name: 'Пан-колониальный флот', ic: '🝃', reward: 8000,
    quote: 'Classis invicta.',
    desc: 'Зачатки великого Галактического флота.',
    cond: 'Построй 50 кораблей' },
  legio_ferrata: { name: 'Железный легион', ic: '🜸', reward: 4000,
    quote: 'Ferro et igni.',
    desc: 'Бронированный кулак наземных войск собран в боевые соединения.',
    cond: 'Сформируй 10 дивизий' },
  ala_magna: { name: 'Великая армия', ic: '🜹', reward: 6000,
    quote: 'Per ardua ad astra.',
    desc: 'Несокрушимые соединения пехоты, брони и авиации под единым знаменем.',
    cond: 'Сформируй 30 дивизий' },
  brandtaucher: { name: 'Брандтаухер', ic: '⚓', reward: 6000,
    quote: 'Leuchtturm - маяк, что ведёт флот в бой.',
    desc: ' «Лейх-турм» сошёл со стапелей и продолжит сражаться.',
    cond: 'Создай линкор с именем «Брандтаухер-(ваш номер)», например «Брандтаухер-(100)»' },
  belicosa: { name: 'Беликоза', ic: '🚢', reward: 4000,
    quote: 'Bellicosus - рождённый для войны.',
    desc: 'Крейсер «Беликоза» снова занял своё место в строю.',
    cond: 'Создай крейсер с именем «Беликоза-(ваш номер)», например «Беликоза-(100)»' },

  // ── Новые ветви охвата ──
  rete_arcanum: { name: 'Наши узы всё крепче', ic: '🜩', reward: 5000,
    quote: 'Sub rosa, ubique.',
    desc: 'Незримая сеть опутала их.',
    cond: 'Внедри 3 тайные секты' },
  magna_foederatio: { name: 'Великая федерация', ic: '🝶', reward: 8000,
    quote: 'E pluribus unum.',
    desc: 'Из многих - единое, и ты во главе.',
    cond: 'Возглавь союз из 5+ держав' },
  inimicus: { name: 'Реалполитик', ic: '🜮', reward: 2000,
    quote: 'Inimicum quamvis humilem docti est metuere.',
    desc: 'Мудрый опасается даже малого врага.',
    cond: 'Доведи отношения с державой до вражды' },
  usura: { name: 'Дом займов', ic: '🝏', reward: 5000,
    quote: 'Qui dat mutuum, amicum vendit.',
    desc: 'Дающий в долг - приобретает власть.',
    cond: 'Выдай 5 займов' },
  industria_plena: { name: 'Индустриализация за индустриализацией', ic: '🜯', reward: 6000,
    quote: 'Labor omnia vincit.',
    desc: 'Труд всё побеждает во всех отраслях.',
    cond: 'Построй все 8 типов сооружений' },
  dispersio: { name: 'Жители пустоты', ic: '🜰', reward: 5000,
    quote: 'Crescit eundo.',
    desc: 'Растёт, распространяясь меж звёзд.',
    cond: 'Засели колонии в 5 системах' },

  // ════════ КОЛОНИИ-СТАНЦИИ НЕБОЖИТЕЛЕЙ — требуют исследований ════════
  statio_orbitalis: { name: 'Дом над бездной', ic: '🛰', reward: 3500,
    quote: 'Ad astra per aspera.',
    desc: 'Подвесные платформы парят над вечной бурей гиганта.',
    cond: 'Построй колонию-станцию на газовом гиганте (нужна технология «Орбитальные станции»)' },
  statio_anomala: { name: 'Жизнь в невозможном', ic: '🌀', reward: 5000,
    quote: 'Ignotum per ignotius.',
    desc: 'Там, где рвётся сама ткань пространства, теплится свет твоей колонии.',
    cond: 'Засели колонию-станцию в космической аномалии (нужна технология «Аномальные станции»)' },

  // ════════ ПАСХАЛКА ════════
  kfzlib: { name: 'Девять миллиардов имён Бога', ic: '🥚', reward: 2000,
    quote: 'Nomen est omen.',
    desc: 'Им всем предпочти одно людское.',
    cond: 'Переименуй колонию в «Kfzlib»' },
  templum_mundi: { name: 'Отчаяние', ic: '⛩', reward: 5000,
    quote: 'Sacrum in centro mundi.',
    desc: 'Где сходятся начала всего сущего, воздвигни алтарь веры, и верни надежду, что покинула этот мир.',
    cond: 'Возведи Храм Веры в колонии системы «Храм мироздания»' },
  spes_perdita: { name: 'Надежда не вернётся', ic: '☄', reward: 10000,
    quote: 'Sic transit gloria mundi.',
    desc: 'Где сходились начала всего сущего — теперь лишь пепел да мёртвый камень. Ты не оставил даже надежды.',
    cond: 'Сотри все уничтожимые планеты системы «Храм мироздания» Дланью Неотвратимости' },
  solitudo: { name: 'Так одиноко', ic: '🛰', reward: 3000,
    quote: 'Ubi solitudinem faciunt.',
    desc: 'На самом краю изведанного, где обрывается последний гиперпуть, горит одинокий огонёк твоего форпоста.',
    cond: 'Разверни аванпост в системе «Конец гиперпути»' },
  iudex_et_iudicium: { name: 'Суд и судья', ic: '⚖', reward: 6000,
    quote: 'Iudex damnatur ubi nocens absolvitur.',
    desc: 'Ты вынес приговор целому миру — и сам же привёл его в исполнение. Кто судит звёзды?',
    cond: 'Уничтожь планету межзвёздной артиллерией' },
  mundicida: { name: 'Мироубийца', ic: '💀', reward: 8000,
    quote: 'Hostem qui feriet, mihi erit Carthaginiensis.',
    desc: 'Чужой дом, чужие надежды, чужая история — всё обратилось в пепел по твоему слову.',
    cond: 'Уничтожь колонию другого игрока' },
  quinque_stationes: { name: 'я не придумал название...', ic: '🛰', reward: 5000,
    quote: 'Per aspera ad astra.',
    desc: 'Твои форпосты раскинулись по всей галактике — тихие маяки в пустоте.',
    cond: 'Развернуть 5 аванпостов по галактике' },
  capitale: { name: 'Капитал', ic: '🏛', reward: 3000,
    quote: 'Pecunia non olet.',
    desc: 'Из камня и труда ты сложил организацию, чьи акции теперь ходят по бирже.',
    cond: 'Учреди корпорацию на бирже' },

  // ════════ КАПСТОУН ════════
  summa_perfectio: { name: 'Гиперпуть стоика завершён', ic: '🟆', reward: 0,
    quote: 'Perfectus — feci quod potui.',
    desc: 'Все добродетели обретены. Дальше только пример другим.',
    cond: 'Получи все остальные достижения' },
};
// Правки подписей ачивок (имя/цитата/описание/условие) админ заливает файлом
// assets/ach/_overrides.json (вкладка «Ачивки» в «Управлении»). Накладываем
// поверх каталога при загрузке — числа условий/наград по-прежнему за сервером.
(function ecAchLoadOverrides() {
  try {
    fetch('assets/ach/_overrides.json?t=' + Date.now())
      .then(r => r.ok ? r.json() : null)
      .then(ov => {
        if (!ov || typeof ov !== 'object') return;
        Object.keys(ov).forEach(id => { if (EC_ACH[id] && ov[id]) Object.assign(EC_ACH[id], ov[id]); });
      })
      .catch(() => {});
  } catch (e) {}
})();
const EC_ACH_ORDER = ['sibi_imperare', 'constantia', 'cosmopolites', 'amor_fati', 'dichotomia', 'temperantia',
  'sophia', 'prudentia', 'fortitudo', 'iustitia', 'magnum_opus',
  // ── Большой набор ──
  'imperium_sine_fine', 'res_publica', 'abundantia', 'terra_nova', 'magnae_divitiae',
  'omniscientia',
  'mercator', 'via_argentaria',
  'legio', 'imperator_belli',
  'magister_arcanorum', 'missionarius',
  'credens', 'fides_fundata', 'pontifex_maximus',
  'foederati', 'dux_foederis', 'dominus_terrarum', 'creditor_magnus',
  'vox_imperii',
  // ── Третий набор ──
  'classis', 'cohors_arcana', 'plena_officina', 'copia_rerum', 'arsenal', 'arma_omnia',
  'contra_speculator',
  'permutatio', 'emptor',
  'fidelis', 'amicitia', 'debitum_solutum',
  'duae_viae', 'ordo_cognoscendi',
  // ── Военка: техи классов + производство + именные корабли ──
  'crucigera', 'dreadnought', 'centuria_navium', 'leviathan', 'classis_magna', 'legio_ferrata', 'ala_magna',
  'brandtaucher', 'belicosa',
  // ── Урон тайных операций ──
  'praeda_aurea', 'direptor', 'eversor', 'sicarius', 'fur_arcanorum',
  // ── Новые ветви охвата ──
  'inquisitor',
  'rete_arcanum', 'magna_foederatio', 'inimicus', 'usura',
  'industria_plena', 'dispersio',
  // ── Гранд-тиры ──
  'croesus', 'urbs_aeterna', 'pax_galactica', 'terraformator', 'thesaurus',
  'sapientia_summa',
  'magister_magnus', 'fur_maximus', 'vastator', 'archipirata', 'machina_belli', 'via_magna', 'imperator_imperatorum',
  // ── Колонии-станции Небожителей ──
  'statio_orbitalis', 'statio_anomala',
  // ── Война / экспансия / биржа (новые) ──
  'iudex_et_iudicium', 'mundicida', 'quinque_stationes', 'capitale',
  // ── Пасхалка / особое + капстоун ──
  'kfzlib', 'templum_mundi', 'spes_perdita', 'solitudo',
  'summa_perfectio'];

// Пути достижений — для фильтра и группировки в панели. Каждая ачивка отнесена
// ровно к одному пути; порядок путей задаёт порядок секций и чипов.
const EC_ACH_CATS = [
  { key: 'power',   label: 'Держава',      ic: '👑' },
  { key: 'science', label: 'Познание',     ic: '🔬' },
  { key: 'war',     label: 'Война',        ic: '⚔️' },
  { key: 'spy',     label: 'Тайная война', ic: '🕵️' },
  { key: 'faith',   label: 'Вера',         ic: '🛐' },
  { key: 'diplo',   label: 'Политика',     ic: '🤝' },
  { key: 'trade',   label: 'Торговля',     ic: '⚖️' },
  { key: 'special', label: 'Особое',       ic: '🌟' },
];
const EC_ACH_CAT = {
  // Держава — масштаб, ресурсы, инфраструктура
  constantia: 'power', cosmopolites: 'power', temperantia: 'power', magnum_opus: 'power',
  abundantia: 'power', imperium_sine_fine: 'power', res_publica: 'power', terra_nova: 'power',
  magnae_divitiae: 'power', classis: 'power', plena_officina: 'power', copia_rerum: 'power',
  industria_plena: 'power', dispersio: 'power', croesus: 'power', urbs_aeterna: 'power',
  pax_galactica: 'power', terraformator: 'power', thesaurus: 'power',
  statio_orbitalis: 'power', statio_anomala: 'power', quinque_stationes: 'power',
  // Познание — наука и исследования
  sibi_imperare: 'science', sophia: 'science', omniscientia: 'science', sapientia_summa: 'science',
  duae_viae: 'science', ordo_cognoscendi: 'science',
  // Война — армия, флот, рейды
  fortitudo: 'war', legio: 'war', imperator_belli: 'war', arsenal: 'war', arma_omnia: 'war',
  crucigera: 'war', dreadnought: 'war', centuria_navium: 'war', leviathan: 'war',
  classis_magna: 'war', legio_ferrata: 'war', ala_magna: 'war', machina_belli: 'war', archipirata: 'war',
  brandtaucher: 'war', belicosa: 'war', iudex_et_iudicium: 'war', mundicida: 'war',
  // Тайная война — шпионаж, секты, контрразведка
  prudentia: 'spy', amor_fati: 'spy', magister_arcanorum: 'spy', missionarius: 'spy',
  contra_speculator: 'spy', magister_magnus: 'spy', rete_arcanum: 'spy', cohors_arcana: 'spy',
  inquisitor: 'spy',
  praeda_aurea: 'spy', fur_maximus: 'spy', direptor: 'spy', eversor: 'spy', vastator: 'spy',
  sicarius: 'spy', fur_arcanorum: 'spy',
  // Вера — религия
  credens: 'faith', fides_fundata: 'faith', pontifex_maximus: 'faith',
  // Политика — дипломатия, союзы, вассалы, займы, слово
  iustitia: 'diplo', foederati: 'diplo', dux_foederis: 'diplo', dominus_terrarum: 'diplo',
  creditor_magnus: 'diplo', fidelis: 'diplo', amicitia: 'diplo', debitum_solutum: 'diplo',
  inimicus: 'diplo', usura: 'diplo', magna_foederatio: 'diplo', imperator_imperatorum: 'diplo',
  vox_imperii: 'diplo',
  // Торговля — пути, бартер, рынок технологий
  dichotomia: 'trade', mercator: 'trade', via_argentaria: 'trade', permutatio: 'trade',
  emptor: 'trade', via_magna: 'trade', capitale: 'trade',
  // Особое — пасхалка + храм мироздания + мета-капстоун
  kfzlib: 'special', templum_mundi: 'special', spes_perdita: 'special', solitudo: 'special',
  summa_perfectio: 'special',
};
function ecAchCat(id) { return EC_ACH_CAT[id] || 'special'; }

// Карточка одной ачивки (общая для всех режимов панели).
function ecAchCard(id, e) {
  const a = EC_ACH[id]; if (!a) return '';
  const unlocked = !!e;
  const when = e && e.earned_at ? new Date(e.earned_at).toLocaleDateString('ru-RU') : '';
  const rew = a.reward > 0 ? `<span class="ec-ach-rew">+${ecNum(a.reward)} ГС</span>` : '<span class="ec-ach-rew ec-ach-rew-respect">Молодец!</span>';
  return `<div class="ec-ach-card${unlocked ? ' on' : ''}">
    <div class="ec-ach-art">
      <img src="assets/ach/${id}.webp" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span class="ec-ach-art-ph" style="display:none">${a.ic}</span>
      ${unlocked ? '' : '<span class="ec-ach-lock">🔒</span>'}
    </div>
    <div class="ec-ach-body">
      <div class="ec-ach-name">${esc(a.name)}</div>
      <div class="ec-ach-desc">${esc(a.desc)}</div>
      <div class="ec-ach-cond">→ ${esc(a.cond)}</div>
      <div class="ec-ach-foot">${rew}${when ? `<span class="ec-ach-when">${esc(when)}</span>` : ''}</div>
    </div>
  </div>`;
}

// Смена активного фильтра-пути: локальный ре-рендер панели без полного перекраса кабинета.
function ecAchFilter(key) {
  EC.achFilter = key;
  const el = document.getElementById('ec-ach-panel');
  if (el) el.innerHTML = ecAchPanelInner();
}

// Внутренности панели (чипы-фильтры + секции путей) — перерисовываются при смене
// фильтра. Полученные ачивки идут ПЕРВЫМИ внутри каждого пути (свежие сверху).
function ecAchPanelInner() {
  const earned = new Map((EC.ach || []).map(a => [a.id, a]));
  const filt = EC.achFilter || 'all';
  const allIds = EC_ACH_ORDER.filter(id => EC_ACH[id]);
  const got = allIds.filter(id => earned.has(id)).length, total = allIds.length;
  const orderIdx = {}; EC_ACH_ORDER.forEach((id, i) => orderIdx[id] = i);
  const sortIds = ids => ids.slice().sort((x, y) => {
    const ex = earned.has(x), ey = earned.has(y);
    if (ex !== ey) return ex ? -1 : 1;                                   // полученные — вперёд
    if (ex && ey) {                                                      // оба получены — свежие выше
      const d = new Date(earned.get(y).earned_at || 0) - new Date(earned.get(x).earned_at || 0);
      if (d) return d;
    }
    return orderIdx[x] - orderIdx[y];                                    // иначе — порядок каталога
  });
  const cats = EC_ACH_CATS
    .map(c => ({ ...c, ids: allIds.filter(id => ecAchCat(id) === c.key) }))
    .filter(c => c.ids.length);
  const chip = (key, ic, label, g, t, on) =>
    `<button type="button" class="ec-ach-chip${on ? ' on' : ''}" onclick="ecAchFilter('${key}')">
       <span class="ec-ach-chip-ic">${ic}</span><span class="ec-ach-chip-l">${esc(label)}</span>
       <span class="ec-ach-chip-n">${ecNum(g)}/${ecNum(t)}</span></button>`;
  const chips = chip('all', '🏆', 'Все', got, total, filt === 'all')
    + cats.map(c => chip(c.key, c.ic, c.label, c.ids.filter(id => earned.has(id)).length, c.ids.length, filt === c.key)).join('');
  const shown = filt === 'all' ? cats : cats.filter(c => c.key === filt);
  const sections = shown.map(c => {
    const g = c.ids.filter(id => earned.has(id)).length;
    const cards = sortIds(c.ids).map(id => ecAchCard(id, earned.get(id))).join('');
    return `<div class="ec-ach-cat">
      <div class="ec-ach-cat-h"><span class="ec-ach-cat-ic">${c.ic}</span>
        <span class="ec-ach-cat-l">${esc(c.label)}</span>
        <span class="ec-ach-cat-n">${ecNum(g)} / ${ecNum(c.ids.length)}</span></div>
      <div class="ec-ach-grid">${cards}</div></div>`;
  }).join('');
  return `<div class="ec-ach-filters">${chips}</div>
    ${sections}`;
}

// Сводка по ачивкам для шапки «Зала достижений»: сколько получено, % и сумма наград.
function ecAchStats() {
  const earned = new Map((EC.ach || []).map(a => [a.id, a]));
  const allIds = EC_ACH_ORDER.filter(id => EC_ACH[id]);
  const got = allIds.filter(id => earned.has(id)).length, total = allIds.length;
  const pct = total ? Math.round(got / total * 100) : 0;
  const rewardGot = allIds.reduce((s, id) => s + (earned.has(id) ? (EC_ACH[id].reward || 0) : 0), 0);
  return { got, total, pct, rewardGot };
}

// Кольцо-прогресс (SVG) для шапки зала достижений.
function ecAchRing(pct) {
  const r = 46, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<svg class="ec-ach-ring" viewBox="0 0 110 110" width="110" height="110" aria-hidden="true">
    <circle class="ec-ach-ring-bg" cx="55" cy="55" r="${r}"></circle>
    <circle class="ec-ach-ring-fg" cx="55" cy="55" r="${r}"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
      transform="rotate(-90 55 55)"></circle>
    <text class="ec-ach-ring-pct" x="55" y="52">${pct}%</text>
    <text class="ec-ach-ring-sub" x="55" y="70">пройдено</text>
  </svg>`;
}

// Полноценная вкладка «Достижения» — зал славы: героическая шапка + фильтры + секции.
function ecTabAchievements() {
  const s = ecAchStats();
  const earned = new Map((EC.ach || []).map(a => [a.id, a]));
  const allIds = EC_ACH_ORDER.filter(id => EC_ACH[id]);
  let lastId = null;
  if (earned.size > 0) {
    const lastEarned = [...earned.entries()].sort((a, b) => new Date(b[1].earned_at || 0) - new Date(a[1].earned_at || 0))[0];
    lastId = lastEarned[0];
  } else if (allIds.length > 0) {
    lastId = allIds[0];
  }
  const bgImg = lastId ? `<img class="ec-ach-hero-bg" src="assets/ach/${esc(lastId)}.webp" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
  const hero = `<div class="ec-ach-hero">
    <div class="ec-ach-hero-glow"></div>
    ${bgImg}
    <div class="ec-ach-hero-ring">${ecAchRing(s.pct)}</div>
    <div class="ec-ach-hero-main">
      <div class="ec-ach-hero-kick">🏆 Зал достижений · путь стоика</div>
      <h2 class="ec-ach-hero-title">${esc(EC.app && EC.app.name || 'Моя фракция')}</h2>
      <div class="ec-ach-hero-bar">${ecOvBar(s.got, s.total, s.got >= s.total ? 'fill-gc' : 'fill-amb')}</div>
      <div class="ec-ach-hero-stats">
        <div class="ec-ach-hs"><span class="ec-ach-hs-v">${ecNum(s.got)}<span class="ec-ach-hs-of">/${ecNum(s.total)}</span></span><span class="ec-ach-hs-k">получено</span></div>
        <div class="ec-ach-hs"><span class="ec-ach-hs-v ec-ovx-c-gc">+${ecNum(s.rewardGot)}</span><span class="ec-ach-hs-k">ГС наград</span></div>
        <div class="ec-ach-hs"><span class="ec-ach-hs-v">${ecNum(s.total - s.got)}</span><span class="ec-ach-hs-k">осталось</span></div>
      </div>
    </div>
  </div>`;
  return `<div class="ec-ach-tab">
    ${hero}
    <div id="ec-ach-panel">${ecAchPanelInner()}</div>
  </div>`;
}

// Компактная карточка-зазывалка в «Обзоре» — прогресс + переход во вкладку «Достижения».
function ecAchOverviewTeaser() {
  const s = ecAchStats();
  return `<div class="ec-ovx-panel ec-ach-teaser ec-ov-clk" style="grid-column:1/-1" onclick="ecSetTab('achievements')">
    <div class="ec-ach-teaser-ring">${ecAchRing(s.pct)}</div>
    <div class="ec-ach-teaser-main">
      <div class="ec-ovx-panel-t" style="margin:0">🏆 Достижения <span class="ec-ovx-panel-sub">путь стоика</span></div>
      <div class="ec-ach-teaser-bar">${ecOvBar(s.got, s.total, s.got >= s.total ? 'fill-gc' : 'fill-amb')}</div>
      <div class="ec-ach-teaser-line">получено <b>${ecNum(s.got)}</b> / ${ecNum(s.total)} · награды <b class="ec-ovx-c-gc">+${ecNum(s.rewardGot)}</b> ГС</div>
    </div>
    <div class="ec-ach-teaser-go">Открыть зал →</div>
  </div>`;
}

function ecTabOverview() {
  const sumCat = c => EC.roster.filter(r => r.category === c).reduce((a, r) => a + (r.qty || 0), 0);
  const ships = sumCat('ship'), divs = sumCat('division'), ground = sumCat('ground'), avia = sumCat('aviation');
  const queued = EC.queue.reduce((a, r) => a + (r.qty || 0), 0);
  const totalCells = EC.colonies.reduce((a, c) => a + (c.cells || EC_DEFAULT_CELLS), 0);
  const usedCells = EC.buildings.length;
  const researchAll = (typeof ecBuildResearch === 'function') ? ecBuildResearch() : [];
  const researchDone = Array.isArray(EC.eco.research) ? EC.eco.research.length : 0;
  const researchTotal = researchAll.length;
  const activeSlot = (Array.isArray(EC.eco.research_slots) ? EC.eco.research_slots : [])[0];
  const activeProj = activeSlot && activeSlot.n;
  const activeName = activeProj ? ((researchAll.find(n => n.id === activeProj) || {}).name || activeProj) : '';
  const myRoutes = (EC.routes || []).filter(r => (r.a_fid === EC.fid || r.b_fid === EC.fid) && r.status === 'active').length;
  const myLoans = (EC.loans || []).filter(l => (l.lender_fid === EC.fid || l.borrower_fid === EC.fid) && l.status === 'active').length;
  const agentsTot = (typeof ecSpyRoster === 'function') ? ecSpyRoster().length : (EC.eco.agents || 0);
  const agentsFree = (typeof ecSpyFree === 'function') ? ecSpyFree() : agentsTot;
  const agentsCI = EC.eco.counter_agents || 0;
  const agentsOps = (typeof ecSpyCommitted === 'function') ? ecSpyCommitted() : 0;
  const inc = ecIncomePreview();
  const m = inc.mods || {};
  const col = ecReadable(EC.app.color);

  // Имя/ГС/наука/доход/тик уже показаны в постоянной шапке кабинета (ec-treasury) —
  // в обзоре НЕ повторяем (убран дублирующий hero-блок). Доход детально — в «Казне» ниже.
  const gcPct = Math.round(((m.gc || 1) - 1) * 100);

  // ── 2. КАЗНА — игровой реестр доходов/расходов ГС за сутки ──
  const gcMul = inc.gcMul != null ? inc.gcMul : (m.gc || 1);
  // Торговля и караваны: продажа (исходящие), доля партнёра (входящие), вывоз ресурсов
  const _cv = ecCaravanIncome();
  const _out = _cv.outRoutes;   // исходящие — я продаю
  const _in  = _cv.inRoutes;    // входящие — получаю долю партнёра
  const _outGc = _cv.out;
  const _inGc  = _cv.inc;
  const _resOut = {};
  _out.forEach(r => { if (r.resource) _resOut[r.resource] = (_resOut[r.resource] || 0) + (r.volume || 0); });
  const _resOutTotal = Object.values(_resOut).reduce((a, b) => a + b, 0);
  const _resOutTxt = Object.entries(_resOut).map(([n, v]) => `${ecResIcon(n)} ${ecNum(v)}`).join(' · ');
  const facSlots = ecSlotsSum('factory'), trSlots = ecSlotsSum('trade'), marketSlots = ecSlotsSum('market'), tmplSlots = ecSlotsSum('temple');
  // Полная разбивка ГС-дохода — единый источник с шапкой «Доход/сутки» (зеркало economy_accrue).
  const g = ecGcIncome();
  // Источники ГС-дохода (с долей-вкладом для столбика). moneyInc = статьи, которые РЕАЛЬНО
  // начисляет серверный тик economy_accrue (зеркало income_history); extraInc = потоки вне тика
  // (вера/биржевые купоны/аванпосты — отдельный/ленивый settle, в «Чистый доход» НЕ входят).
  const moneyInc = [];
  const extraInc = [];
  if (facSlots) moneyInc.push({ ic: '🏭', name: 'Гражданские фабрики', sub: `${ecNum(facSlots)} слот. × 200`, gc: g.factory, tab: 'colonies' });
  if (trSlots)  moneyInc.push({ ic: '💱', name: 'Торговые хабы', sub: `${ecNum(trSlots)} слот. × 100`, gc: g.trade, tab: 'trade' });
  if (_out.length) moneyInc.push({ ic: '🚚', name: 'Караваны · продажа', sub: `${_out.length} пут. → партнёрам${_cv.short ? ` · поток покрывает ${Math.round(_outGc / Math.max(1, _cv.contract) * 100)}% контрактов` : ''}${_cv.transitN ? ` · ${_cv.transitN} в пути` : ''}`, gc: _outGc, tab: 'trade' });
  if (_cv.risk) moneyInc.push({ ic: '🏴', name: 'Пиратские угрозы', sub: 'ожидаемые потери рейсов под угрозой', gc: -_cv.risk, tab: 'trade' });
  if (_in.length)  moneyInc.push({ ic: '📦', name: 'Доля с поставок', sub: `${_in.length} пут. ← вам шлют · до добычи партнёра`, gc: _inGc, tab: 'trade' });
  if (g.market) moneyInc.push({ ic: '📈', name: 'Товарная биржа', sub: `${ecNum(marketSlots)} слот. · сбыт добычи`, gc: g.market, tab: 'trade' });
  if (g.export) moneyInc.push({ ic: '📤', name: 'Экспорт добычи', sub: 'поток export-заводов', gc: g.export, tab: 'trade' });
  if (g.policy) moneyInc.push({ ic: '📜', name: 'Торговая политика', sub: 'апкип NPC-конвоя', gc: -g.policy, tab: 'raids' });
  if (g.budget) moneyInc.push({ ic: '🏛', name: 'Бюджет державы', sub: 'финансирование отраслей × население', gc: -g.budget, tab: 'welfare' });
  // ── НЕ входит в тик (информативно, не суммируется в «Чистый доход») ──
  if (g.temple) extraInc.push({ ic: '🛐', name: 'Храмы веры', sub: `${ecNum(tmplSlots)} слот. × 150`, gc: g.temple, tab: 'faith' });
  if (g.tithe)  extraInc.push({ ic: '🤝', name: 'Десятина с адептов', sub: 'доля дохода чужих храмов', gc: g.tithe, tab: 'faith' });
  if (g.sects)  extraInc.push({ ic: '🕯', name: 'Тайные секты', sub: 'covert-храмы за рубежом', gc: g.sects, tab: 'faith' });
  // Биржа: регулярные потоки (облигации/дивиденды/синергия) — отдельный settle вне основного тика.
  const _ex = g.exchange;
  if (_ex.bonds)   extraInc.push({ ic: '🏦', name: 'Облигации · купоны', sub: _ex.bondOut ? `${ecNum(_ex.bondIn)} держателю − ${ecNum(_ex.bondOut)} выплаты эмитента` : 'купон по моим вложениям', gc: _ex.bonds, tab: 'exchange' });
  if (_ex.corpDiv) extraInc.push({ ic: '🏢', name: 'Дивиденды · чужие доли', sub: 'мои доли в чужих корпорациях', gc: _ex.corpDiv, tab: 'exchange' });
  if (_ex.corpSyn) extraInc.push({ ic: '⚡', name: 'Синергия корпораций', sub: 'бонус моих корпораций сверх дохода построек', gc: _ex.corpSyn, tab: 'exchange' });
  // Добывающие аванпосты вне границ: ГС/сут (плюс ресурсы — в панели «Ресурсы»).
  const _op = g.outpost || { gc: 0, n: 0, totals: new Map() };
  if (_op.n) extraInc.push({ ic: '🛰', name: 'Аванпосты · добыча', sub: `${_op.n} аванпост. вне границ × ${EC_OUTPOST_MINE_GC}`, gc: _op.gc, tab: 'outposts' });
  const _povDrag = (typeof ecPovertyDrag === 'function') ? ecPovertyDrag() : 0;
  const netGc = g.net;
  const maxGc = moneyInc.reduce((a, x) => Math.max(a, Math.abs(x.gc)), 0) || 1;
  const moneyRows = moneyInc.map(x => {
    const w = Math.max(5, Math.round(Math.abs(x.gc) / maxGc * 100));
    const neg = x.gc < 0;
    return `<button type="button" class="ec-bdg-row" onclick="ecSetTab('${x.tab}')">
      <span class="ec-bdg-ic">${x.ic}</span>
      <span class="ec-bdg-info"><span class="ec-bdg-name">${esc(x.name)}</span><span class="ec-bdg-sub">${esc(x.sub)}</span></span>
      <span class="ec-bdg-bar"><i style="width:${w}%"></i></span>
      <span class="ec-bdg-val ${neg ? 'neg' : 'pos'}">${neg ? '−' : '+'}${ecNum(Math.abs(x.gc))}</span>
    </button>`;
  }).join('');
  // Потоки ВНЕ тика — те же строки, но приглушённые и с пометкой «не в начислении тика».
  const extraSum = extraInc.reduce((a, x) => a + x.gc, 0);
  const extraRows = extraInc.length ? extraInc.map(x => {
    const neg = x.gc < 0;
    return `<button type="button" class="ec-bdg-row ec-bdg-row-extra" onclick="ecSetTab('${x.tab}')">
      <span class="ec-bdg-ic">${x.ic}</span>
      <span class="ec-bdg-info"><span class="ec-bdg-name">${esc(x.name)}</span><span class="ec-bdg-sub">${esc(x.sub)}</span></span>
      <span class="ec-bdg-val ${neg ? 'neg' : 'pos'}">${neg ? '−' : '+'}${ecNum(Math.abs(x.gc))}</span>
    </button>`;
  }).join('') : '';
  const extraBlock = extraInc.length ? `<div class="ec-bdg-extra">
      <div class="ec-bdg-extra-hd">Вне начисления тика <span class="ec-bdg-extra-sum">≈ +${ecNum(extraSum)} ГС/сут</span></div>
      <div class="ec-bdg-extra-note">Эти потоки (вера, биржевые купоны/дивиденды, аванпосты) считаются отдельно от основного тика и в «Чистый доход» не входят — поэтому в казну за ход падает только сумма выше.</div>
      ${extraRows}
    </div>` : '';
  // Товарная биржа теперь числовой строкой в moneyInc (оценка по складу) — отдельный плейсхолдер не нужен.
  const marketRow = '';
  const expRow = _resOutTotal ? `<button type="button" class="ec-bdg-row ec-bdg-exp" onclick="ecSetTab('trade')">
      <span class="ec-bdg-ic">📤</span>
      <span class="ec-bdg-info"><span class="ec-bdg-name">Караваны · вывоз ресурсов</span><span class="ec-bdg-sub">${_resOutTxt}</span></span>
      <span class="ec-bdg-bar"></span>
      <span class="ec-bdg-val neg">−${ecNum(_resOutTotal)} ед.</span>
    </button>` : '';
  // Прочие потоки (не деньги) — компактной строкой, без дублирования панелей
  const flows = [];
  if (inc.science) flows.push(`<span class="ec-bdg-flow" onclick="ecSetTab('research')"><span class="ec-bdg-flow-ic">🔬</span><b class="ec-ovx-c-sci">+${ecNum(inc.science)}</b> ОН/сут</span>`);
  // Агенты НЕ выдаются автоматически — они нанимаются на рынке рекрутов (Центр Спецслужб задаёт потолок).
  // Поэтому никакого «+N агент/сут» в казне не показываем.
  if (gcPct) flows.push(`<span class="ec-bdg-flow"><span class="ec-bdg-flow-ic">${gcPct > 0 ? '⚖' : '⚠'}</span>доктрина ${gcPct > 0 ? '+' : ''}${gcPct}% ГС</span>`);
  // Достижения — РАЗОВЫЕ награды (не в /сут): показываем накопленную сумму отдельной строкой.
  const _achTot = ecAchTotal();
  if (_achTot) flows.push(`<span class="ec-bdg-flow" onclick="ecSetTab('achievements')"><span class="ec-bdg-flow-ic">🏆</span>достижения <b class="pos">+${ecNum(_achTot)}</b> ГС <small>(разово, получено)</small></span>`);
  const hasBudget = moneyInc.length || extraInc.length || marketSlots || _resOutTotal || flows.length;
  // ── Раскрываемая детальная справка по казне: формула каждого источника + состав (donut) ──
  const gcMulPct = Math.round((gcMul - 1) * 100);
  const fxRow = (ic, name, formula, gc) => `<div class="ec-bdg-dt-row">
      <span class="ec-bdg-dt-ic">${ic}</span>
      <span class="ec-bdg-dt-info"><span class="ec-bdg-dt-name">${esc(name)}</span><span class="ec-bdg-dt-fx">${formula}</span></span>
      <span class="ec-bdg-dt-val ${gc < 0 ? 'neg' : 'pos'}">${gc >= 0 ? '+' : ''}${ecNum(gc)}</span>
    </div>`;
  const detRows = [];
  if (facSlots) detRows.push(fxRow('🏭', 'Гражданские фабрики', `${ecNum(facSlots)} слот × 200${gcMulPct ? ` × ${gcMul.toFixed(2)} (доктрина ${gcMulPct > 0 ? '+' : ''}${gcMulPct}%)` : ''}`, g.factory));
  if (trSlots) detRows.push(fxRow('💱', 'Торговые хабы', `${ecNum(trSlots)} слот × 100${gcMulPct ? ` × ${gcMul.toFixed(2)}` : ''}`, g.trade));
  if (g.temple) detRows.push(fxRow('🛐', 'Храмы веры', `${ecNum(tmplSlots)} слот × 150${gcMulPct ? ` × ${gcMul.toFixed(2)}` : ''} (пока исповедуешь веру храма)`, g.temple));
  if (g.tithe)  detRows.push(fxRow('🤝', 'Десятина с адептов', `доля дохода храмов адептов вашей веры${gcMulPct ? ` × ${gcMul.toFixed(2)}` : ''}`, g.tithe));
  if (g.sects)  detRows.push(fxRow('🕯', 'Тайные секты', `активные covert-храмы × 150${gcMulPct ? ` × ${gcMul.toFixed(2)}` : ''}`, g.sects));
  if (_out.length) detRows.push(fxRow('🚚', 'Караваны · продажа', `${_out.length} путь(ей): мин(объём, поток export-добычи) × цена × дипломатия (±20%)${gcMulPct ? ` × доктрина` : ''}`, _outGc));
  if (_cv.risk) detRows.push(fxRow('🏴', 'Пиратские угрозы', `рейсы под угрозой срываются с шансом 40–80% (конвой снижает риск)`, -_cv.risk));
  if (_in.length) detRows.push(fxRow('📦', 'Доля с поставок', `${_in.length} путь(ей): ${Math.round(EC_DEST_CUT * 100)}% × дипломатия партнёра · верхняя оценка (ограничена его добычей)`, _inGc));
  if (g.market) detRows.push(fxRow('📈', 'Товарная биржа', `${ecNum(marketSlots)} слот · сбыт добытого потока по ценности × 50–75% (до ${ecNum(marketSlots * 25)} ед/сут, склад не трогает)`, g.market));
  if (g.export) detRows.push(fxRow('📤', 'Экспорт добычи', `свободный поток export-заводов × ценность × 0.6`, g.export));
  if (g.policy) detRows.push(fxRow('📜', 'Торговая политика', `апкип NPC-конвоя (защита караванов)`, -g.policy));
  if (g.budget) detRows.push(fxRow('🏛', 'Бюджет державы', `${ecNum(ecBudgetPop())} нас. × ставки отраслей (вкладка «Благополучие»)`, -g.budget));
  if (_ex.bonds)   detRows.push(fxRow('🏦', 'Облигации · купоны', `купоны по вложениям ${ecNum(_ex.bondIn)} − выплаты как эмитент ${ecNum(_ex.bondOut)}`, _ex.bonds));
  if (_ex.corpDiv) detRows.push(fxRow('🏢', 'Дивиденды (чужие доли)', `выручка × моя доля по чужим корпорациям`, _ex.corpDiv));
  if (_ex.corpSyn) detRows.push(fxRow('⚡', 'Синергия моих корпораций', `доход построек × синергия × моя доля (сверх дохода фабрик)`, _ex.corpSyn));
  if (_op.n) detRows.push(fxRow('🛰', 'Аванпосты · добыча', `${_op.n} аванпост(ов) × ${EC_OUTPOST_MINE_GC} ГС/сут + ресурсы с планет их систем (ленивый расчёт, вне основного тика)`, _op.gc));
  const composition = moneyInc.length ? ecSvgDonut(moneyInc.filter(x => x.gc > 0).map(x => ({ name: x.name, color: { 'Гражданские фабрики': 'var(--gd)', 'Торговые хабы': 'var(--te)', 'Храмы веры': 'var(--ec-amb,#e0a030)', 'Десятина с адептов': 'var(--ec-amb,#e0a030)', 'Тайные секты': 'var(--pu)', 'Караваны · продажа': 'var(--ok)', 'Доля с поставок': 'var(--ec-amb,#e0a030)', 'Товарная биржа': 'var(--ok)', 'Экспорт добычи': 'var(--te)', 'Облигации · купоны': 'var(--pu)', 'Дивиденды · чужие доли': 'var(--ok)', 'Синергия корпораций': 'var(--te)', 'Аванпосты · добыча': 'var(--te)' }[x.name] || 'var(--gd)', value: x.gc })), { center: ecChartFmt(netGc), sub: 'ГС/сут' }) : '';
  const bdgDetail = `<div class="ec-bdg-detail">
      ${composition ? `<div class="ec-bdg-dt-sect">Состав дохода</div>${composition}` : ''}
      <div class="ec-bdg-dt-sect">Формулы по источникам</div>
      <div class="ec-bdg-dt-list">${detRows.join('') || '<div class="ec-ovx-hint">Денежных источников нет.</div>'}</div>
      ${_cv.short ? `<div class="ec-bdg-dt-warn">🚚 Караваны недогружены: контракты обещают ≈ +${ecNum(_cv.contract)} ГС/сут, но export-поток добычи покрывает лишь +${ecNum(_outGc)} — не хватает ${ecNum(_cv.short)} ед. сырья/сут. Переведите добывающие заводы в режим «экспорт», расширьте добычу нужных ресурсов или урежьте объёмы маршрутов.</div>` : ''}
      ${_cv.transitN ? `<div class="ec-bdg-dt-warn">🚀 ${_cv.transitN} караван(ов) ещё в пути — их доход начнётся после прибытия и в сумму выше не входит.</div>` : ''}
      ${_resOutTotal ? `<div class="ec-bdg-dt-warn">📤 Вывоз ресурсов караванами: −${ecNum(_resOutTotal)} ед/сут (${_resOutTxt}) — это расход сырья, не денег.</div>` : ''}
      ${_povDrag ? `<div class="ec-bdg-dt-warn">💸 Бедность съедает ≈ −${ecNum(_povDrag)} ГС/сут: фабрики и хабы в небогатых системах режутся просперити (уже учтено в строках «Фабрики»/«Хабы»). Поднимайте благополучие во вкладке «Благополучие».</div>` : ''}
      ${inc.debuff ? `<div class="ec-bdg-dt-warn">🔥 Дестабилизация режет денежный доход на ${Math.round(inc.debuff * 100)}% — уже учтено в суммах.</div>` : ''}
      <div class="ec-ovx-hint">Доход начисляется в конце каждого хода (тика). Доктрина даёт ×${gcMul.toFixed(2)} к ГС-потокам${gcMulPct ? ` (${gcMulPct > 0 ? '+' : ''}${gcMulPct}%)` : ''} (к доходу биржи не применяется). Содержания армии/зданий нет — постройка тратит ГС разово.</div>
      <div class="ec-ovx-hint">📊 «Чистый доход» = ровно те статьи, что начисляет тик сервера (зеркало income_history): фабрики+хабы, караваны, Товарная биржа (оценка по складу), экспорт добычи, − торговая политика. Вера (храмы/десятина/секты), биржевые купоны/дивиденды/синергия и аванпосты считаются ОТДЕЛЬНО от основного тика и показаны в блоке «Вне начисления тика» — в «Чистый доход» они не входят. Спекуляции (маржа/фьючерсы/опционы) переменны и в «/сут» не входят. 🏆 Награды за достижения — разовые, показаны отдельной строкой. 🏛 Законы Межзвёздной Ассамблеи и 🖋 итоги «Поэмы недели» — разовые выплаты/поборы по всей галактике: они падают в казну напрямую и объявляются в ленте новостей.</div>
    </div>`;
  const budget = `<div class="ec-ovx-panel ec-bdg-panel">
    <div class="ec-ovx-panel-t">💰 Казна <span class="ec-ovx-panel-sub">доходы и расходы за сутки</span></div>
    ${hasBudget ? `
      <div class="ec-bdg-net${netGc > 0 ? ' up' : ''}">
        <span class="ec-bdg-net-k">Чистый доход / сут</span>
        <span class="ec-bdg-net-v">${netGc >= 0 ? '+' : ''}${ecNum(netGc)} <small>ГС</small></span>
        ${inc.debuff ? `<span class="ec-bdg-net-warn">🔥 дестабилизация −${Math.round(inc.debuff * 100)}%</span>` : ''}
      </div>
      ${(moneyRows || marketRow) ? `<div class="ec-bdg-rows">${moneyRows}${marketRow}</div>` : ''}
      ${extraBlock}
      ${flows.length ? `<div class="ec-bdg-flows">${flows.join('')}</div>` : ''}
      ${ecOvFold('bdg', '🔍 Подробно: формулы и состав', 'откуда каждый ГС')}
      ${ecOvExpanded('bdg') ? bdgDetail : ''}`
      : `<div class="ec-ovx-empty">Казна пуста. Постройте Гражданские фабрики во вкладке «Колонии» — это база дохода.</div>`}
  </div>`;

  // ── 3. РЕСУРСЫ — добыча/сутки + склад (подробная справка: что/откуда/сколько/цена/почему) ──
  // Источники добычи: колониальные заводы (ecMineTotals) + добывающие аванпосты вне границ (_op.totals).
  const mineT = ecMineTotals();
  const opT = _op.totals || new Map();
  const stock = new Map(ecResEntries());
  const resNames = new Set([...mineT.keys(), ...opT.keys(), ...stock.keys()]);
  const resRows = [...resNames].map(n => {
    const mt = mineT.get(n), ot = opT.get(n);
    const colRate = mt ? mt.rate : 0, opRate = ot ? ot.rate : 0;
    const rate = colRate + opRate, have = stock.get(n) || 0;
    const rar = (mt && mt.r) || (ot && ot.r) || ecResRarity(n) || 'common';
    return { n, rate, colRate, opRate, have, rar, slots: (mt && mt.slots) || 0, srcs: (mt && mt.srcs) || null, opSrcs: (ot && ot.srcs) || null };
  }).sort((a, b) => (b.rate - a.rate) || (b.have - a.have));
  const storeCap = ecStoreCap();
  const storeUsed = resRows.reduce((s, r) => s + (r.have || 0), 0);
  const storePct = storeCap > 0 ? Math.round(storeUsed / storeCap * 100) : 0;
  const mineDay = resRows.reduce((s, r) => s + (r.rate || 0), 0);
  const freeCap = Math.max(0, storeCap - storeUsed);
  const daysFull = mineDay > 0 ? Math.ceil(freeCap / mineDay) : 0;
  const minedKinds = resRows.filter(r => r.rate > 0).length;
  const whSlots = ecSlotsSum('warehouse');
  // Итоговая полоса склада + «когда заполнится»
  const capBar = `<div class="ec-ovx-stat-wide ec-ov-clk" onclick="ecSetTab('colonies')" data-tip="Ёмкость общего склада: база ${ecNum(EC_STORE_BASE)} + по ${ecNum(EC_STORE_PER_SLOT)} за слот «Склада». Лимит ОБЩИЙ — на все ресурсы вместе.\n${whSlots ? whSlots + ' слот(ов) склада → +' + ecNum(whSlots * EC_STORE_PER_SLOT) : 'Складов нет — стройте «Склад», чтобы поднять лимит'}.\nНет свободного места — добыча на склад НЕ идёт (нет места — нет добычи). Чтобы сбывать сверх лимита, ставьте завод в режим 🚚 Экспорт или 🏪 Рынок.">
        <div class="ec-ovx-stat-k">📦 Вместимость склада <span class="ec-res-cap-pct">${storePct}%</span></div>
        <div class="ec-ovx-stat-barline"><b>${ecNum(storeUsed)}</b> / ${ecNum(storeCap)} ${ecOvBar(storeUsed, storeCap, storeUsed >= storeCap ? 'fill-rd' : (storePct >= 85 ? 'fill-amb' : 'fill-gc'))}</div>
      </div>`;
  // Сводка-итоги: суммарная добыча/сут, виды, прогноз заполнения
  const opMineDay = resRows.reduce((s, r) => s + (r.opRate || 0), 0);
  const resSummary = `<div class="ec-res-sum">
    <span class="ec-res-sum-i"><b class="${mineDay ? 'ok' : 'dim'}">${mineDay ? '+' + ecNum(mineDay) : '0'}</b> ед/сут добыча</span>
    <span class="ec-res-sum-i"><b>${ecNum(minedKinds)}</b> вид(ов) добывается</span>
    ${_op.n ? `<span class="ec-res-sum-i" data-tip="Каждый добывающий аванпост вне границ тянет ВСЕ ресурсы своей системы, кроме эпических и легендарных, + ${EC_OUTPOST_MINE_GC} ГС/сут. Кламп по ёмкости склада для каждого ресурса — переполнение сгорает.">🛰 <b>${ecNum(_op.n)}</b> аванпост. добычи · +${ecNum(opMineDay)} ед/сут${_op.gc ? ' + ' + ecNum(_op.gc) + ' ГС' : ''}</span>` : ''}
    ${mineDay && freeCap > 0 ? `<span class="ec-res-sum-i">склад полон через <b>${ecNum(daysFull)}</b> ход(ов)</span>` : (mineDay && freeCap <= 0 ? '<span class="ec-res-sum-i ec-res-sum-warn">⚠ склад полон — добыча на склад остановлена (нет места — нет добычи)</span>' : '')}
  </div>`;
  // Карточка ресурса: верх (иконка + полное имя + редкость), числа (добыча/склад/цена),
  // источники (откуда добывается) либо причина «не добывается».
  const resCard = (r) => {
    const price = ecResPriceN(r.n);
    const rarTxt = ecRarLabel(r.rar);
    let foot;
    const colChips = (r.srcs && r.srcs.size) ? [...r.srcs.entries()].map(([col, s]) =>
        `<span class="ec-res-src-chip" title="${esc(col)}: ${s.slots} слот(ов)${s.amt ? ', месторождение «' + esc(s.amt) + '»' : ''} → +${ecNum(s.rate)}/сут">⛏ ${esc(col)} ×${s.slots} <b>+${ecNum(s.rate)}</b></span>`
      ).join('') : '';
    const opChips = (r.opSrcs && r.opSrcs.size) ? [...r.opSrcs.entries()].map(([sys, s]) =>
        `<span class="ec-res-src-chip ec-res-src-op" title="Аванпост(ы) в системе ${esc(sys)} (${s.n} шт.) → +${ecNum(s.rate)}/сут (добыча вне границ)">🛰 ${esc(sys)}${s.n > 1 ? ' ×' + s.n : ''} <b>+${ecNum(s.rate)}</b></span>`
      ).join('') : '';
    if (colChips || opChips) {
      foot = `<div class="ec-res-card-src"><span class="ec-res-card-src-k">откуда:</span>${colChips}${opChips}</div>`;
    } else if (r.have > 0) {
      foot = `<div class="ec-res-card-why">в запасе, добыча не ведётся — постройте на планете с залежью «${esc(r.n)}» добывающую постройку её яруса (завод — обычные, глубинный комплекс — необычные/редкие, экстрактор — эпические/легендарные)</div>`;
    } else {
      foot = `<div class="ec-res-card-why">не добывается и склад пуст</div>`;
    }
    return `<div class="ec-res-card ec-rar-${r.rar}${r.have > 0 ? ' ec-res-has' : ''}">
      <div class="ec-res-card-top">
        <span class="ec-res-card-ic">${ecResIcon(r.n)}</span>
        <span class="ec-res-card-name">${esc(r.n)}</span>
        <span class="ec-res-card-rar ec-rar-tx-${r.rar}">${rarTxt}</span>
      </div>
      <div class="ec-res-card-nums">
        <div class="ec-res-card-num"${r.opRate ? ` title="колонии: +${ecNum(r.colRate)} · аванпосты: +${ecNum(r.opRate)}"` : ''}><span class="ec-res-card-num-v ${r.rate ? 'ok' : 'dim'}">${r.rate ? '+' + ecNum(r.rate) : '—'}</span><span class="ec-res-card-num-k">добыча / сут${r.opRate ? ' <span class="ec-hint">🛰' + (r.colRate ? '+⛏' : '') + '</span>' : ''}</span></div>
        <div class="ec-res-card-num"><span class="ec-res-card-num-v">${ecNum(r.have)}</span><span class="ec-res-card-num-k">на складе</span></div>
        <div class="ec-res-card-num"><span class="ec-res-card-num-v">${ecNum(price)}</span><span class="ec-res-card-num-k">ГС / ед.</span></div>
      </div>
      ${foot}
    </div>`;
  };
  const resPanel = `<div class="ec-ovx-panel">
    <div class="ec-ovx-panel-t">⛏ Ресурсы <span class="ec-ovx-panel-sub">добыча · склад · цена · источники</span></div>
    ${capBar}
    ${resRows.length ? resSummary + ecOvFold('rescards', '📦 Все ресурсы', `${resRows.length} вид(ов) — добыча · склад · цена · источники`) + (ecOvExpanded('rescards') ? `<div class="ec-res-filters" role="tablist">
        <button class="ec-flt is-on" onclick="ecResFilter(this,'all')">Все</button>
        <button class="ec-flt" onclick="ecResFilter(this,'have')">📦 В запасе</button>
        <button class="ec-flt" onclick="ecResFilter(this,'common')">Обычные</button>
        <button class="ec-flt" onclick="ecResFilter(this,'uncommon')">Редкие</button>
        <button class="ec-flt" onclick="ecResFilter(this,'rare')">Ценные</button>
        <button class="ec-flt" onclick="ecResFilter(this,'epic')">Эпич.</button>
        <button class="ec-flt" onclick="ecResFilter(this,'legendary')">Легенд.</button>
      </div><div class="ec-res-cards flt-all">${resRows.map(resCard).join('')}</div>` : '') : '<div class="ec-ovx-res-empty">Ресурсов нет. Постройте «Добывающий завод» в колонии и назначьте слотам месторождения планеты — добыча начисляется в конце каждого хода.</div>'}
    <div class="ec-ovx-hint">Добыча = редкость месторождения × его богатство × доктрина, начисляется в конце каждого хода (тика). Сверх ёмкости склада ресурсы не копятся.${_op.n ? ` 🛰 Аванпосты добычи тянут ресурсы со всех планет своих систем по фикс-ставкам (обычн. 12, необыч. 6, ред. 3, эпич./лег. 1 ед/сут за вид) + ${EC_OUTPOST_MINE_GC} ГС/сут каждый — расчёт ленивый, вне основного тика.` : ''}</div>
  </div>`;

  // ── 4. ДЕРЖАВА ──
  const bldByType = {};
  EC.buildings.forEach(b => { bldByType[b.btype] = (bldByType[b.btype] || 0) + 1; });
  const bldChips = EC_ORDER.map(t => bldByType[t] ? `<span class="ec-ovx-chip"><span class="ec-ovx-chip-ic">${EC_BLD_ICON[t] || '▣'}</span>${esc(ecBuildName(t))} <b>${ecNum(bldByType[t])}</b></span>` : '').filter(Boolean).join('');
  // Раскрываемое дерево: система → её колонии → постройки и занятые ячейки.
  // Полоска баланса системы (пространственная экономика, срез 1).
  const empTreeRows = (EC.systems || []).map(s => {
    const bal = EC.spatial && EC.spatial[s.id];
    const cols = EC.colonies.filter(c => c.system_id === s.id);
    const colRows = cols.map(c => {
      const cb = EC.buildings.filter(b => b.colony_id === c.id);
      const cap = c.cells || EC_DEFAULT_CELLS;
      const bt = {}; cb.forEach(b => { bt[b.btype] = (bt[b.btype] || 0) + 1; });
      const chips = Object.keys(bt).map(t => `<span class="ec-emp-bchip" title="${esc(ecBuildName(t))}">${EC_BLD_ICON[t] || '▣'} ${ecNum(bt[t])}</span>`).join('') || '<span class="ec-emp-empty">пусто</span>';
      return `<div class="ec-emp-col">
        <div class="ec-emp-col-h"><span class="ec-emp-col-n">🪐 ${esc(c.name || c.planet_name || 'Колония')}</span><span class="ec-emp-col-cells">${ecNum(cb.length)}/${ecNum(cap)} яч.</span></div>
        <div class="ec-emp-col-chips">${chips}</div>
      </div>`;
    }).join('') || '<div class="ec-emp-empty">колоний нет</div>';
    return `<div class="ec-emp-sys"><div class="ec-emp-sys-h">🌐 ${esc(s.name || 'Система')} <span class="ec-emp-sys-sub">${ecNum(cols.length)} колон.</span></div>${ecSpatialBar(bal)}${colRows}</div>`;
  }).join('');
  const empDetail = `<div class="ec-emp-detail">
      ${bldChips ? `<div class="ec-emp-dt-sect">Все постройки державы</div><div class="ec-ovx-chips">${bldChips}</div>` : ''}
      <div class="ec-emp-dt-sect">По системам и колониям</div>
      ${empTreeRows || '<div class="ec-ovx-hint">Систем нет — захватывайте их на карте.</div>'}
    </div>`;
  const empire = `<div class="ec-ovx-panel ec-ovx-half">
    <div class="ec-ovx-panel-t">🏛 Держава</div>
    <div class="ec-ovx-stat-grid">
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('territory')"><div class="ec-ovx-stat-v">${ecNum(EC.systems.length)}</div><div class="ec-ovx-stat-k">Систем</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('colonies')"><div class="ec-ovx-stat-v">${ecNum(EC.colonies.length)}</div><div class="ec-ovx-stat-k">Колоний</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('colonies')"><div class="ec-ovx-stat-v">${ecNum(EC.buildings.length)}</div><div class="ec-ovx-stat-k">Построек</div></div>
      <div class="ec-ovx-stat ec-ovx-stat-wide ec-ov-clk" onclick="ecSetTab('colonies')">
        <div class="ec-ovx-stat-k">Ячейки застройки</div>
        <div class="ec-ovx-stat-barline"><b>${ecNum(usedCells)}</b> / ${ecNum(totalCells)} ${ecOvBar(usedCells, totalCells, 'fill-gc')}</div>
      </div>
    </div>
    <div class="ec-ovx-hint">Системы — захвачены на карте (вкладка «Территория»). Колонии — заселённые планеты в них. Ячейки застройки — лимит построек на планетах (зависит от их размера); постройки расходуют ячейки и дают доход/добычу/мощности.</div>
    ${ecOvFold('emp', '🔍 Подробно: системы и колонии', 'что и где построено')}
    ${ecOvExpanded('emp') ? empDetail : ''}
  </div>`;

  // ── 5. АРМИЯ + мощности производства ──
  const caps = ecCaps(), use = (typeof ecPendingUse === 'function') ? ecPendingUse() : { ships: 0, inf: 0, tech: 0 };
  const capRow = (label, used, cap, cls) => cap ? `<div class="ec-ovx-cap">
      <span class="ec-ovx-cap-k">${esc(label)}</span>
      <span class="ec-ovx-cap-v">${ecNum(used)} / ${ecNum(cap)} за ход</span>
      ${ecOvBar(used, cap, cls)}
    </div>` : '';
  // Раскрываемая разбивка армии по проектам внутри категорий + очередь.
  const armyCats = [['ship', '🚀 Корабли'], ['division', '⚔ Дивизии'], ['ground', '🛡 Наземка'], ['aviation', '✈ Авиация']];
  const armyDetailRows = armyCats.map(([cat, label]) => {
    const items = EC.roster.filter(r => r.category === cat);
    if (!items.length) return '';
    const byName = {};
    items.forEach(r => { const nm = r.unit_name || r.name || '—'; byName[nm] = (byName[nm] || 0) + (r.qty || 0); });
    const chips = Object.entries(byName).sort((a, b) => b[1] - a[1]).map(([nm, q]) => `<span class="ec-army-uchip">${esc(nm)} <b>×${ecNum(q)}</b></span>`).join('');
    const tot = Object.values(byName).reduce((a, b) => a + b, 0);
    return `<div class="ec-army-cat"><div class="ec-army-cat-h">${label} <span class="ec-army-cat-tot">${ecNum(tot)}</span></div><div class="ec-army-uchips">${chips}</div></div>`;
  }).filter(Boolean).join('');
  const queueRows = (EC.queue || []).length ? `<div class="ec-army-dt-sect">🕓 В очереди производства</div><div class="ec-army-uchips">${EC.queue.map(q => `<span class="ec-army-uchip ec-army-uchip-q">${esc(q.unit_name || '—')} <b>×${ecNum(q.qty || 0)}</b></span>`).join('')}</div>` : '';
  const armyDetail = `<div class="ec-army-detail">
      ${armyDetailRows || '<div class="ec-ovx-hint">Войск пока нет — стройте их во вкладке «Военпром».</div>'}
      ${queueRows}
      ${(caps.training || caps.military || caps.ships) ? `<div class="ec-army-dt-sect">⚙ Мощности производства за ход</div>
      <div class="ec-ovx-hint">Пехота: <b>${ecNum(caps.training)}</b> ед/ход (Центр Подготовки${caps.robot ? ' / робо-сборка на Военном Заводе ×3' : ''}) · Техника: <b>${ecNum(caps.military)}</b> ед/ход (Военный Завод) · Корабли: <b>${ecNum(caps.ships)}</b> шт/ход (Верфь). Каждый слот завода добавляет мощность; постройка тратит ГС и сырьё (дефицит ×1.5).</div>` : ''}
    </div>`;
  // Вместимость флота: места под корабли (Звёздные Базы + добывающие аванпосты-стоянки).
  const fUsed = ecFleetUsed(), fCap = caps.fleetCap, fFull = fCap > 0 && fUsed >= fCap;
  const fleetCapTip = `Места под корабли. Базы: ${ecNum(ecSlotsSum('starbase'))} слот × ${EC_STARBASE_CAP_PER_SLOT} = ${ecNum(caps.fleetBaseCap)}${caps.fleetOutposts ? `; аванпосты добычи: ${ecNum(caps.fleetOutposts)} × ${EC_OUTPOST_CAP} = ${ecNum(caps.fleetOutpostCap)}` : ''}. Считаются готовые + в очереди + повреждённые + в ремонте. Сверх лимита новые корабли строить нельзя — стройте Звёздную Базу или разверните добывающий аванпост.`;
  const fleetCapBar = (fCap > 0 || fUsed > 0) ? `<div class="ec-ovx-stat ec-ovx-stat-wide ec-ov-clk" onclick="ecSetTab('forces')" data-tip="${esc(fleetCapTip)}">
      <div class="ec-ovx-stat-k">🛰 Вместимость флота${fFull ? ' <span class="ec-res-cap-pct">лимит исчерпан</span>' : ''}</div>
      <div class="ec-ovx-stat-barline"><b style="color:${fFull ? 'var(--err,#e05050)' : 'var(--pu)'}">${ecNum(fUsed)}</b> / ${ecNum(fCap)} мест ${ecOvBar(fUsed, fCap, fFull ? 'fill-rd' : 'fill-sci')}</div>
    </div>` : '';
  const army = `<div class="ec-ovx-panel ec-ovx-half">
    <div class="ec-ovx-panel-t">⚔ Вооружённые силы ${queued ? `<span class="ec-ovx-panel-sub ec-ov-clk" onclick="ecSetTab('milbuild')">в очереди: ${ecNum(queued)}</span>` : ''}</div>
    <div class="ec-ovx-stat-grid">
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v ec-ovx-c-sci">${ecNum(ships)}</div><div class="ec-ovx-stat-k">🚀 Корабли</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v ec-ovx-c-gc">${ecNum(divs)}</div><div class="ec-ovx-stat-k">⚔ Дивизии</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v">${ecNum(ground)}</div><div class="ec-ovx-stat-k">🛡 Наземка</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('forces')"><div class="ec-ovx-stat-v">${ecNum(avia)}</div><div class="ec-ovx-stat-k">✈ Авиация</div></div>
      ${fleetCapBar}
    </div>
    ${(caps.training || caps.military || caps.ships) ? `<div class="ec-ovx-caps">
      ${capRow('🪖 Подготовка пехоты', use.inf || 0, caps.training, 'fill-gc')}
      ${capRow('🛠 Военный завод', use.tech || 0, caps.military, 'fill-amb')}
      ${capRow('🚀 Корабельная верфь', use.ships || 0, caps.ships, 'fill-sci')}
    </div>
    <div class="ec-ovx-hint">Производство — партиями за ход: лимит каждой мощности = слоты соответствующих заводов (Центр Подготовки / Военный Завод / Верфь). Постройка тратит ГС и сырьё со склада; дефицит сырья докупается ×1.5. Очередь и сборка — во вкладке «Военпром».</div>` : '<div class="ec-ovx-hint">Военных мощностей нет — постройте Центр Подготовки (пехота), Военный Завод (техника) или Верфь (корабли) во вкладке «Колонии», затем стройте войска в «Военпроме».</div>'}
    ${ecOvFold('army', '🔍 Подробно: состав и производство', 'по проектам и очередь')}
    ${ecOvExpanded('army') ? armyDetail : ''}
  </div>`;

  // ── 6. НАУКА · ДИПЛОМАТИЯ · РАЗВЕДКА ──
  const allSlots = Array.isArray(EC.eco.research_slots) ? EC.eco.research_slots : [];
  const qCnt = Array.isArray(EC.eco.research_queue) ? EC.eco.research_queue.length : 0;
  const activeHtml = activeProj
    ? `<div class="ec-ovx-active">🔬 Исследуется: <b>${esc(activeName)}</b>${allSlots.length > 1 ? ` <span class="ec-hint">+ ещё ${allSlots.length - 1}</span>` : ''}${qCnt ? ` <span class="ec-hint">· 🕓 ${qCnt} в очереди</span>` : ''}${activeSlot && activeSlot.r ? ecProgressISO(null, activeSlot.r, 1, 'готово в конце хода') : ''}</div>` : '';
  const sciInc = inc.science || 0;
  const spyAg = EC.spyAgency || { cap: 0, hired: 0 };
  const agCap = spyAg.cap || 0, agHired = spyAg.hired || agentsTot;
  const sci = `<div class="ec-ovx-panel">
    <div class="ec-ovx-panel-t">🔬 Наука · Дипломатия · Разведка <span class="ec-ovx-panel-sub">${sciInc ? '+' + ecNum(sciInc) + ' ОН/сут' : 'нет науки'}</span></div>
    ${activeHtml}
    <div class="ec-ovx-stat ec-ovx-stat-wide ec-ov-clk" onclick="ecSetTab('research')">
      <div class="ec-ovx-stat-k">Изучено технологий</div>
      <div class="ec-ovx-stat-barline"><b class="ec-ovx-c-sci">${ecNum(researchDone)}</b> / ${ecNum(researchTotal)} ${ecOvBar(researchDone, researchTotal, 'fill-sci')}</div>
    </div>
    <div class="ec-ovx-stat-grid" style="margin-top:10px">
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('intel')" data-tip="Нанятые оперативники / потолок (Центр Спецслужб). Агенты нанимаются на рынке рекрутов, не выдаются автоматически."><div class="ec-ovx-stat-v">${ecNum(agHired)}<span class="ec-ovx-stat-cap">/${ecNum(agCap)}</span></div><div class="ec-ovx-stat-k">Агенты (найм)</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('intel')"><div class="ec-ovx-stat-v ec-ovx-c-agt">${ecNum(agentsCI)}</div><div class="ec-ovx-stat-k">Контрразведка</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('trade')"><div class="ec-ovx-stat-v">${ecNum(myRoutes)}</div><div class="ec-ovx-stat-k">Торг. пути</div></div>
      <div class="ec-ovx-stat ec-ov-clk" onclick="ecSetTab('diplomacy')"><div class="ec-ovx-stat-v">${ecNum(myLoans)}</div><div class="ec-ovx-stat-k">Займы</div></div>
    </div>
    ${agentsOps ? `<div class="ec-ovx-hint">Задействовано в операциях: <b>${ecNum(agentsOps)}</b> · свободно: <b>${ecNum(agentsFree)}</b></div>` : ''}
    ${(() => {
      const u = EC.diplo && EC.diplo.union, vs = (EC.diplo && EC.diplo.vassals) || [];
      const mine = vs.filter(v => v.overlord === EC.fid && v.status === 'active').length;
      const lord = vs.find(v => v.vassal === EC.fid && v.status === 'active');
      const parts = [];
      if (u) parts.push(`${u.kind === 'federation' ? '🛡 Федерация' : '🤝 Конфедерация'}: <b>${esc(u.name)}</b>`);
      if (mine) parts.push(`вассалов: <b>${mine}</b>`);
      if (lord) parts.push(`сюзерен: <b>${esc(lord.overlord_name)}</b>`);
      return parts.length ? `<div class="ec-ovx-hint ec-ov-clk" onclick="ecSetTab('diplomacy')">${parts.join(' · ')}</div>` : '';
    })()}
    <div class="ec-ovx-hint">Наука (ОН/сут) — со слотов «Научного Института», копится и тратится на технологии (готовы в конце хода). Агенты <b>нанимаются на рынке рекрутов</b> во вкладке «Разведка» (Центр Спецслужб задаёт потолок) — автоматически не выдаются. Торг. пути и займы создаются в «Торговле»/«Дипломатии».</div>
  </div>`;

  const raceNote = `<div class="ec-race-note">Раса: <b>${esc(EC.app.race || '—')}</b> · ${ecIsRobot()
    ? 'родные миры: <b>все типы планет</b> — колонизация без терраформа (бонус роботов).'
    : 'родные миры: ' + ((EC_HAB[EC.app.race] || []).map(g => EC_GRP_LABEL[g] || g).join(', ') || '—') + '. Чужие типы планет — через терраформ.'}</div>`;

  const achTeaser = ecAchOverviewTeaser();
  return `<div class="ec-ovx-grid">${budget}${ecStatsPanel()}${resPanel}${empire}${ecPovertyPanel()}${army}${sci}${ecDoctrineHtml()}${achTeaser}</div>${raceNote}
    <div class="ec-ov-links">
      <button class="btn btn-gh btn-sm" onclick="go('constructors')">⚒ Конструкторы</button>
      <button class="btn btn-gh btn-sm" onclick="go('cat-ships')">🚀 Каталоги</button>
      <button class="btn btn-gh btn-sm" onclick="go('map')">🜨 Карта</button>
    </div>`;
}

function ecToggleColony(id) { EC.openColony = (EC.openColony === id) ? null : id; ecPaintCabinet(); }
// Системы сворачиваются НЕЗАВИСИМО: EC.closedSys — множество свёрнутых id (по умолчанию все открыты).
function ecToggleSys(id) {
  if (!EC.closedSys) EC.closedSys = new Set();
  if (EC.closedSys.has(id)) EC.closedSys.delete(id); else EC.closedSys.add(id);
  ecPaintCabinet();
}
function ecAllSysIds() {
  const ids = new Set();
  (EC.systems || []).forEach(s => ids.add(s.id));
  (EC.colonies || []).forEach(c => { if (c.system_id) ids.add(c.system_id); });
  return [...ids];
}
function ecCollapseAllSys() { EC.closedSys = new Set(ecAllSysIds()); ecPaintCabinet(); }
function ecExpandAllSys() { EC.closedSys = new Set(); ecPaintCabinet(); }

// Кнопка/бейдж колонизации для незаселённой планеты
function ecColonizeInfo(s, p, race) {
  const g = ecPlanetGroup(p), label = EC_GRP_LABEL[g] || g, cells = +p.slotsP || EC_DEFAULT_CELLS;
  // Мёртвый мир (стёрт «Дланью Неотвратимости») — ни колонизировать, ни терраформировать нельзя.
  if (p.dead || p.doomed) return { cls: 'no', tag: 'мёртвая', label: 'Мёртвая планета',
    btn: `<button class="btn btn-gh btn-sm" disabled title="Планета уничтожена орудием судного дня. Мёртвый мир нельзя колонизировать или терраформировать.">☠ мёртвый мир</button>` };
  if (!ecColonizable(p)) {
    // Небожители: непригодный мир можно освоить станцией, если изучена технология.
    const st = ecStationFor(g);
    if (st) {
      const sc = ecColonizeCost(EC_STATION_COST);
      return { cls: 'station', tag: 'станция', label, cells: st.cells,
        btn: `<button class="btn btn-gd btn-sm" title="Построить ${esc(st.label.toLowerCase())} — малая станция на ${st.cells} ячеек застройки. Стоимость ${ecNum(sc)} ГС." onclick="event.stopPropagation();ecBuildStation('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${ecArg(g)},${ecPidArg(p)})">${st.icon} Станция · ${st.cells} ячеек · ${ecNum(sc)} ГС</button>` };
    }
    const tech = ecStationTechFor(g);
    const lockTitle = tech
      ? `Непригодно для жизни. Изучите технологию «${tech.name}» (ветка Небожители), чтобы построить станцию (${tech.station.cells} ячеек).`
      : 'Газовые гиганты, аномалии и пояса заселить нельзя.';
    return { cls: 'no', tag: 'непригодна', label, btn: `<button class="btn btn-gh btn-sm" disabled title="${esc(lockTitle)}">${tech ? '🔒 нужна технология' : '— нельзя'}</button>` };
  }
  if (ecNative(p, race)) return { cls: 'native', tag: 'родная', label, btn: `<button class="btn btn-gd btn-sm" onclick="event.stopPropagation();ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},0,${ecPidArg(p)})">Колонизировать · ${ecNum(ecColonizeCost(EC_COLONIZE_COST))} ГС</button>` };
  // Чужая планета — терраформ с уровнем сложности (срок + ОН)
  const pend = ecPendingTerraform(s.id, p.name, p.pid);
  if (pend) return { cls: 'foreign', tag: 'чужая', label, btn: `<span class="ec-proj-tag" title="${ecProjEtaTxt(pend)}">⏳ терраформ (${ecProjEtaTxt(pend)})</span>` };
  const tier = ecTerraTier(p, race), spec = EC_TERRA[tier];
  const costTxt = `${ecNum(ecColonizeCost(spec.gc))} ГС${spec.science ? ` + ${ecNum(spec.science)} ОН` : ''}`;
  // одна понятная кнопка: заселить нельзя — но можно терраформировать (сложность + цена + срок)
  return { cls: 'foreign', tag: 'чужая', label,
    btn: `<button class="btn btn-sm ec-terra-btn ec-terra-t${tier}" title="Заселить сразу нельзя. Терраформировать (${spec.label.toLowerCase()}) → затем станет колонией. Стоимость ${costTxt}, срок ${spec.turns} ход(ов)." onclick="event.stopPropagation();ecColonize('${esc(s.id)}',${ecArg(p.name)},${ecArg(p.type)},${cells},1,${ecPidArg(p)})">🌱 Терраформ · ${spec.label} · ${costTxt} · ${spec.turns} ход.</button>` };
}

// Чипы ресурсов планеты (иконка + название + цвет по редкости)
function ecPlanetResChips(p) {
  const res = (p && Array.isArray(p.resources)) ? p.resources.filter(r => r && r.name) : [];
  if (!res.length) return '<span class="ec-nres">◌ ресурсов нет</span>';
  return res.map(r => {
    const rar = r.r || 'common';
    return `<span class="ec-rchip ec-rar-${rar}" title="${esc(r.name)} · ${rar}"><span class="ec-rchip-i">${ecResIcon(r.name)}</span>${esc(r.name)}</span>`;
  }).join('');
}
// Подсказка «что выгодно строить» по ресурсам/пригодности планеты
function ecPlanetBuildHint(p) {
  const res = (p && Array.isArray(p.resources)) ? p.resources.filter(r => r && r.name) : [];
  const tips = [];
  if (res.some(r => (r.r || 'common') === 'common')) tips.push('⛏ Добывающий завод');
  if (res.some(r => ['uncommon', 'rare'].includes(r.r))) tips.push('⚒ Глубинный комплекс — ценные ресурсы!');
  if (res.some(r => ['epic', 'legendary'].includes(r.r))) tips.push('💎 Экзотический экстрактор — элитная залежь!');
  if (ecColonizable(p)) tips.push('🏭 Фабрика · 🔬 Институт');
  return tips.length ? `<div class="ec-pl-hint">💡 Выгодно: ${tips.join(' · ')}</div>` : '';
}

// Тело управления колонией (застройка) — показывается только в развёрнутой колонии
function ecColonyManage(c) {
  const blds = EC.buildings.filter(b => b.colony_id === c.id);
  const pendBuilds = (EC.projects || []).filter(p => p.kind === 'build' && p.colony_id === c.id);
  const used = blds.length + pendBuilds.length, cap = c.cells || EC_DEFAULT_CELLS, full = used >= cap;
  const pendBldHtml = pendBuilds.map(p => {
    const d = EC_BUILD[p.btype] || {};
    return `<div class="ec-bld-row ec-bld-pending">
      <span class="ec-bld-name">🏗 ${esc(d.name || p.btype)}</span>
      <span class="ec-proj-tag">⏳ ${ecProjEtaTxt(p)}</span>
      <button class="ec-bld-del" title="Отменить постройку (возврат затрат)" onclick="ecCancelProject('${p.id}')">✕</button>
    </div>`;
  }).join('');
  const bHtml = blds.map(ecBuildingRow).join('') + pendBldHtml || `<div class="ec-empty" style="padding:8px 0">Пусто. Постройте структуру ↓</div>`;
  const pendHab = ecPendingHabitat(c.id);
  const habBtn = pendHab
    ? `<span class="ec-proj-tag" title="${ecProjEtaTxt(pendHab)}">⏳ обустройство среды (${ecProjEtaTxt(pendHab)})</span>`
    : !c.terraformed
      ? `<button class="btn btn-gh btn-sm" onclick="ecHabitat('${c.id}')" title="Расширить жизненное пространство: +${EC_HABITAT_CELLS} ячеек, завершится через 1 день">🌱 Обустроить среду (+${EC_HABITAT_CELLS} ⬚, ${ecNum(ecColonizeCost(EC_HABITAT_COST))} ГС)</button>`
      : '';
  return `<div class="ec-bld-grid">${bHtml}</div>
    <div class="ec-colony-actions">
      <button class="btn btn-gd btn-sm ec-build-btn" ${full ? 'disabled title="Нет свободных ячеек"' : ''} onclick="ecBuildPicker('${c.id}')">🏗 Построить${full ? '' : ` <span class="ec-build-free">${cap - used} ⬚</span>`}</button>
      ${habBtn}
      ${(typeof user !== 'undefined' && user && ['superadmin','editor','moderator'].includes(user.role))
        ? `<button class="btn btn-gh btn-sm" onclick="ecRenameColony('${c.id}',${ecArg(c.planet_name || '')})" title="Переименовать планету (стафф, бесплатно)">✎ Имя</button>`
        : `<button class="btn btn-gh btn-sm" onclick="ecRenameColonyPaid('${c.id}',${ecArg(c.planet_name || '')})" title="Переименовать планету за ${EC_RENAME_COST} ГС">✎ Имя · ${EC_RENAME_COST} ГС</button>`}
      ${ecMineButton(c)}
      <button class="btn btn-gh btn-sm ec-danger" onclick="ecAbandon('${c.id}')" title="Бросить колонию">✕ Бросить</button>
    </div>`;
}

// Минное поле у планеты колонии — застраивается ГЕКС ЗА ГЕКСОМ (зеркало
// _defense_minefield.sql). Каждый клик «+гекс» закрывает ещё один гекс кольца
// вокруг планеты за EC_MINE_HEX_COST; полное поле — EC_MINE_HEX_MAX гексов.
// Никакой кнопки «заминировать всё сразу»: поле растёт по одному гексу.
const EC_MINE_HEX_COST = 1000;
const EC_MINE_HEX_MAX = 6;
function ecMyMinefield(c) {
  return (EC.minefields || []).find(m => m.mine && m.system_id === c.system_id &&
    (m.planet_pid == null || c.planet_pid == null || +m.planet_pid === +c.planet_pid));
}
function ecMineButton(c) {
  const mf = ecMyMinefield(c);
  const hexes = mf ? Math.min(+mf.hexes || 0, +mf.hex_max || EC_MINE_HEX_MAX) : 0;
  const hexMax = mf ? (+mf.hex_max || EC_MINE_HEX_MAX) : EC_MINE_HEX_MAX;
  const pidArg = c.planet_pid == null ? 'null' : c.planet_pid;
  const layBtn = hexes >= hexMax
    ? `<button class="btn btn-gh btn-sm" disabled title="Поле полностью застроено">⛯ Поле полное · ${hexes}/${hexMax}</button>`
    : `<button class="btn btn-gh btn-sm" onclick="ecMineLay('${c.system_id}',${pidArg})" title="Закрыть ещё один гекс минами">⛯ +гекс мин (${hexes}/${hexMax}) · ${ecNum(EC_MINE_HEX_COST)} ГС</button>`;
  const clearBtn = mf
    ? `<button class="btn btn-gh btn-sm" onclick="ecMineClear('${mf.id}')" title="Снять поле (возврат ~50% за гекс)">⛯ Снять поле</button>` : '';
  return layBtn + clearBtn;
}
async function ecMineLay(sysId, pid) {
  if (EC.busy) return;
  if ((EC.eco.gc || 0) < EC_MINE_HEX_COST) { toast(`Нужно ${ecNum(EC_MINE_HEX_COST)} ГС`, 'err'); return; }
  EC.busy = true;
  try {
    const r = await ecRpc('minefield_lay', { p_system_id: sysId, p_pid: pid });
    toast(`Гекс заминирован · ${r && r.hexes || ''}/${r && r.hex_max || EC_MINE_HEX_MAX} · −${ecNum(EC_MINE_HEX_COST)} ГС`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}
async function ecMineClear(id) {
  if (EC.busy) return;
  if (!confirm('Снять минное поле целиком? Вернётся ~50% за каждый гекс.')) return;
  EC.busy = true;
  try {
    const r = await ecRpc('minefield_clear', { p_id: id });
    toast(`Поле снято · +${ecNum(r && r.refund || 0)} ГС`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Переименование планеты/колонии — через единый источник истины (colonies + map_systems).
// Стафф — бесплатно (rename_colony). Игрок-владелец — платно (colony_rename_paid, 500 ГС).
const EC_RENAME_COST = 500;
async function ecRenameColony(colId, cur) {
  const nm = prompt('Новое название планеты:', cur || '');
  if (nm === null) return;
  const v = nm.trim();
  if (!v || v === cur) return;
  if (typeof badName === 'function' && badName(v)) { toast('Название содержит недопустимые слова (мат или запрещённое)', 'err'); return; }
  try {
    await ecRpc('rename_colony', { p_colony_id: colId, p_new_name: v });
    toast('Планета переименована', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}
// Платное переименование для игрока-владельца: списывает EC_RENAME_COST ГС на сервере.
async function ecRenameColonyPaid(colId, cur) {
  const bal = (EC.eco && EC.eco.gc) || 0;
  if (bal < EC_RENAME_COST) { toast(`Нужно ${ecNum(EC_RENAME_COST)} ГС, в казне ${ecNum(bal)}`, 'err'); return; }
  const nm = prompt(`Новое название планеты (стоимость ${ecNum(EC_RENAME_COST)} ГС):`, cur || '');
  if (nm === null) return;
  const v = nm.trim();
  if (!v || v === cur) return;
  if (typeof badName === 'function' && badName(v)) { toast('Название содержит недопустимые слова (мат или запрещённое)', 'err'); return; }
  if (!confirm(`Переименовать в «${v}» за ${ecNum(EC_RENAME_COST)} ГС?`)) return;
  try {
    await ecRpc('colony_rename_paid', { p_colony_id: colId, p_new_name: v });
    toast(`Планета переименована · −${ecNum(EC_RENAME_COST)} ГС`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}

// Строка КОЛОНИИ (всегда показывается, даже если планета не совпала с картой)
function ecColonyRowHtml(colony, sys) {
  const open = EC.openColony === colony.id;
  const blds = EC.buildings.filter(b => b.colony_id === colony.id);
  const used = blds.length, cap = colony.cells || EC_DEFAULT_CELLS;
  // ГС-доход построек × доктрина (+дебафф) — как в шапке/Казне; наука — плоский поток.
  const incGc = Math.round(blds.reduce((a, b) => a + (ecBuildingIncome(b).gc || 0), 0) * ecGcMul());
  const incSci = blds.reduce((a, b) => a + (ecBuildingIncome(b).science || 0), 0);
  const incTxt = [incGc ? `+${ecNum(incGc)} ГС` : '', incSci ? `+${ecNum(incSci)} ОН` : ''].filter(Boolean).join(' ');
  // ресурсы: ИСТИНА — снимок самой колонии (его использует сервер для добычи).
  // Матчинг по имени ненадёжен: в системе бывает ДВЕ одноимённые планеты,
  // .find берёт первую (часто пустую) и затирает корректный снимок колонии.
  const mapPlanet = ecFindPlanet(sys, colony.planet_name, colony.planet_pid);
  const planet = (Array.isArray(colony.resources) && colony.resources.length) ? colony : (mapPlanet || colony);
  const minePreview = ecColonyMinePreview(blds, planet);
  const head = `<div class="ec-pl ec-pl-own${open ? ' open' : ''}" onclick="ecToggleColony('${colony.id}')">
    <div class="ec-pl-top">
      <div class="ec-pl-l"><span class="ec-pl-ic">${colony.is_capital ? '★' : '🏙'}</span><div class="ec-pl-txt"><div class="ec-pl-nm">${esc(colony.planet_name || 'Колония')}</div><div class="ec-pl-sb">${colony.is_capital ? 'Столица · ' : ''}${esc(colony.planet_type || '')}${colony.terraformed ? ' · терраформ' : ''}</div></div></div>
      <div class="ec-pl-r"><span class="ec-pl-cells">⬚ ${used}/${cap}</span>${incTxt ? `<span class="ec-pl-inc">${incTxt}/сут</span>` : ''}<span class="ec-pl-chev">${open ? '▾' : '▸'}</span></div>
    </div>
    <div class="ec-pl-res"><span class="ec-pl-lbl">Ресурсы:</span>${ecPlanetResChips(planet)}</div>
    ${minePreview}
  </div>`;
  return head + (open ? `<div class="ec-pl-detail">${ecColonyManage(colony)}</div>` : '');
}
// Строка незаселённой планеты (опция колонизации)
function ecFreeRowHtml(s, p, race) {
  const cz = ecColonizeInfo(s, p, race);
  // станция (пояс/аномалия) застраивается на cells самой станции, а не на slotsP (=0 → фолбэк 6)
  const cells = cz.cells || +p.slotsP || EC_DEFAULT_CELLS;
  return `<div class="ec-pl ec-pl-free">
    <div class="ec-pl-top">
      <div class="ec-pl-l"><span class="ec-pl-ic">${cz.cls === 'no' ? '⊘' : '◌'}</span><div class="ec-pl-txt"><div class="ec-pl-nm">${esc(p.name)}</div><div class="ec-pl-sb"><span class="ec-cz-${cz.cls}">${esc(cz.tag)}</span> · ${esc(cz.label)} · ⬚ ${cells} ячеек</div></div></div>
      <div class="ec-pl-r">${cz.btn}</div>
    </div>
    <div class="ec-pl-res"><span class="ec-pl-lbl">Ресурсы:</span>${ecPlanetResChips(p)}</div>
    ${cz.cls !== 'no' ? ecPlanetBuildHint(p) : ''}
  </div>`;
}

function ecTabColonies() {
  const race = EC.app.race;
  // Системы: владеемые + те, где есть колонии (чтобы колонии НЕ ТЕРЯЛИСЬ,
  // даже если имя колонии не совпало с планетой на карте или система не в списке).
  // Источник истины по составу системы — ПОЛНЫЙ список карты (EC.allSystems),
  // тот же, что рисует галактическая карта. Раньше состав брался из EC.systems
  // (отдельная выборка по faction=eq.fid), и планеты, добавленные через редактор
  // карты, могли не появиться во вкладке при любом расхождении тегов faction —
  // на карте видно, а в «Системы и колонии» нет. Теперь планеты всегда берутся
  // из allSystems → состав вкладки совпадает с картой.
  const allById = new Map((EC.allSystems || []).map(s => [s.id, s]));
  const sysMap = new Map();
  const addSys = (id, fallbackName) => {
    if (!id || sysMap.has(id)) return;
    const live = allById.get(id);
    const own = (EC.systems || []).find(s => s.id === id);
    const name = (live && live.name) || (own && own.name) || fallbackName || 'Система';
    const planets = ((live && live.planets) || (own && own.planets) || []).filter(p => p && p.name);
    sysMap.set(id, { id, name, planets });
  };
  // 1) системы, которыми владеет фракция игрока
  (EC.systems || []).forEach(s => addSys(s.id, s.name));
  // 2) системы, где у игрока есть колонии (даже если тег faction отличается)
  (EC.colonies || []).forEach(c => addSys(c.system_id));
  // По умолчанию системы СВЁРНУТЫ (раскрываются кликом по шапке). Инициализируем
  // один раз за сессию — дальше твои раскрытия/сворачивания сохраняются.
  if (!EC.sysCollapseInit) { EC.closedSys = new Set([...sysMap.keys()]); EC.sysCollapseInit = true; }
  if (!sysMap.size) {
    return `${ecIntro('🏗', 'Колонии и застройка', 'Здесь вы строите здания на своих планетах — это основа дохода, науки и армии.', ['Сначала получите систему во вкладке «🌐 Территория».', 'Затем колонизируйте пригодную планету и стройте на ней здания.'])}<div class="ec-section-title">Системы и колонии</div>
      <div class="ec-empty">У вас пока нет систем и колоний. Захватывайте системы во вкладке «🌐 Территория».</div>`;
  }
  const totalCol = EC.colonies.length;
  const blocks = [...sysMap.values()].map(s => {
    const cols = EC.colonies.filter(c => c.system_id === s.id);
    // Занятость планеты определяем по pid (две одноимённые планеты — разные объекты).
    // Имя — фолбэк только для старых колоний без planet_pid.
    const colPids = new Set(cols.map(c => c.planet_pid).filter(v => v != null));
    const colNamesNoPid = new Set(cols.filter(c => c.planet_pid == null).map(c => c.planet_name));
    const sysOpen = !(EC.closedSys && EC.closedSys.has(s.id));
    // 1) ВСЕ колонии системы (всегда), 2) незаселённые планеты
    const colHtml = cols.map(c => ecColonyRowHtml(c, s)).join('');
    const freeHtml = s.planets.filter(p => {
      if (p.pid != null && colPids.has(p.pid)) return false;
      if (colNamesNoPid.has(p.name)) return false;
      return true;
    }).map(p => ecFreeRowHtml(s, p, race)).join('');
    const body = (colHtml + freeHtml) || `<div class="ec-empty" style="padding:10px 12px">Нет планет.</div>`;
    return `<div class="ec-sysblk">
      <div class="ec-sysblk-hd" onclick="ecToggleSys('${esc(s.id)}')">
        <span class="ec-sysblk-nm">🜨 ${esc(s.name)}</span>
        <span class="ec-sysblk-meta">${cols.length} колон. · ${s.planets.length} планет <span class="ec-pl-chev">${sysOpen ? '▾' : '▸'}</span></span>
      </div>
      ${sysOpen ? `<div class="ec-sysblk-body">${body}</div>` : ''}
    </div>`;
  }).join('');
  const allIds = ecAllSysIds();
  const allClosed = allIds.length > 0 && allIds.every(id => EC.closedSys && EC.closedSys.has(id));
  const foldBtn = allIds.length > 1
    ? `<button class="btn btn-gh btn-xs" onclick="${allClosed ? 'ecExpandAllSys()' : 'ecCollapseAllSys()'}">${allClosed ? '▾ Развернуть все' : '▸ Свернуть все'}</button>`
    : '';
  return `${ecIntro('🏗', 'Колонии и застройка', 'Стройте здания на планетах — это основа дохода, науки и армии.', ['Каждое здание занимает <b>ячейку</b> планеты и имеет до <b>6 слотов</b> мощности.', 'Постройка здания и открытие нового слота длятся <b>1 день</b> (можно отменить с возвратом ГС).', 'Нажмите на колонию, чтобы развернуть застройку. ⛏ Добывающему заводу нужно назначить месторождения.'])}${ecProjectsBlock()}<div class="ec-section-title">Системы и колонии <span class="ec-hint">— ${totalCol} колоний · клик по шапке системы сворачивает её</span>${foldBtn}</div>
    <div class="ec-syslist">${blocks}</div>`;
}

// Блок «Проекты в работе» — слоты, терраформ, обустройство среды (с таймером и отменой)
function ecProjectsBlock() {
  const ps = (EC.projects || []).slice().sort((a, b) => new Date(a.ready_at || 0) - new Date(b.ready_at || 0));
  if (!ps.length) return '';
  const icon = { slot: '🏗', terraform: '🌍', habitat: '🌱', build: '🏗' };
  const rows = ps.map(p => `<div class="ec-q-row">
      <span class="ec-r-name">${icon[p.kind] || '⏳'} ${esc(p.label || p.kind)}</span>
      ${ecProgressISO(p.created_at, p.ready_at, 1, 'готово — ждёт тика')}
      <button class="ec-bld-del" title="Отменить (возврат затрат)" onclick="ecCancelProject('${p.id}')">✕</button>
    </div>`).join('');
  return `<div class="ec-section-title">Проекты в работе <span class="ec-hint">— применяются через 1 день</span></div>
    <div class="ec-queue" style="margin-bottom:14px">${rows}</div>`;
}

function ecDivBuildCard(div) {
  const need = ecDivReqBuildings(div);
  const missing = need.filter(bt => !ecHasBuilding(bt));
  const can = missing.length === 0;
  const blocks = (div.data && div.data.blocks) || [];
  const comp = blocks.length
    ? blocks.map(b => `${esc(ecDivCompName(b.modelId))} ×${ecNum(b.count || 1)}`).join(', ')
    : 'состав пуст';
  const needChips = need.length
    ? need.map(bt => `<span class="ec-need ${ecHasBuilding(bt) ? 'ok' : 'no'}">${ecHasBuilding(bt) ? '✓' : '✗'} ${esc(EC_BLD_LABEL[bt])}</span>`).join('')
    : '<span class="ec-need ok">✓ без спец-зданий</span>';
  const cost = (div.summary && div.summary.cost) || 0;
  return `<div class="ec-div-card">
    <div class="ec-div-hd"><span class="ec-div-name">⚔ ${esc(div.name)}</span><span class="ec-div-cost">${ecNum(cost)} ГС</span></div>
    <div class="ec-div-comp">${comp}</div>
    <div class="ec-div-need">${needChips}</div>
    <div id="ec-div-bill-${esc(div.id)}" class="ec-ship-bill">${ecDivBillHtml(div.id, 1)}</div>
    <div class="ec-div-act">
      <input type="number" id="ec-div-qty-${esc(div.id)}" value="1" min="1" class="ec-prod-qty" oninput="ecDivBillUpd('${esc(div.id)}')">
      ${can
      ? `<button class="btn btn-gd btn-sm" onclick="ecProduceDivision('${esc(div.id)}')">Сформировать</button>`
      : `<button class="btn btn-gh btn-sm" disabled>Нет: ${missing.map(m => esc(EC_BLD_LABEL[m])).join(', ')}</button>`}
    </div>
  </div>`;
}

// ── Вкладка 1: «Вооружённые силы государства» — текущий состав (ростер) ──
function ecTabForces() {
  const stock = {};
  EC.roster.forEach(r => { const k = (r.category || '') + '|' + (r.unit_name || ''); if (!stock[k]) stock[k] = { name: r.unit_name, category: r.category, qty: 0 }; stock[k].qty += r.qty || 0; });
  const all = Object.values(stock);
  let rosterHtml = '';
  [['division', '⚔', 'Дивизии', 'army', 'Дивизия'], ['ship', '🚀', 'Флот', 'fleet', 'Корабль']].forEach(([c, ic, lbl, mod, unit]) => {
    const arr = all.filter(s => s.category === c).sort((a, b) => (b.qty || 0) - (a.qty || 0));
    if (!arr.length) return;
    const tot = arr.reduce((a, s) => a + (s.qty || 0), 0);
    const cards = arr.map(s => `<div class="ec-force-card ec-force-card--${mod}" style="cursor:pointer" onclick="ecShowUnitSpecs('${esc(s.name)}', '${c}')">
        <span class="ec-force-tok">${ic}</span>
        <div class="ec-force-info"><div class="ec-force-name">${esc(s.name)}</div><div class="ec-force-sub">${unit}</div></div>
        <span class="ec-force-qty">×${ecNum(s.qty)}</span>
      </div>`).join('');
    rosterHtml += `<div class="ec-force-group">
      <div class="ec-force-hd ec-force-hd--${mod}"><span class="ec-force-hd-ic">${ic}</span><span class="ec-force-hd-l">${lbl}</span><span class="ec-force-hd-ct">${ecNum(tot)} ед.</span></div>
      <div class="ec-force-grid">${cards}</div>
    </div>`;
  });
  if (!rosterHtml) rosterHtml = `<div class="ec-force-empty"><span class="ec-force-empty-ic">🎖</span><div>Вооружённых сил пока нет.<br><span class="ec-force-empty-sub">Сформируйте их во вкладке «🏭 Строительство вооружённых сил».</span></div></div>`;

  const totDiv = EC.roster.filter(r => r.category === 'division').reduce((a, r) => a + (r.qty || 0), 0);
  const totShip = EC.roster.filter(r => r.category === 'ship').reduce((a, r) => a + (r.qty || 0), 0);
  const inQueue = EC.queue.reduce((a, q) => a + (q.qty || 0), 0);

  return `<div class="ec-cyb-forces">${ecIntro('⚔', 'Вооружённые силы государства', 'Текущий состав ваших вооружённых сил — сформированные дивизии и построенный флот.', ['Войска производятся во вкладке «🏭 Строительство вооружённых сил».', 'Готовые заказы пополняют этот состав в конце игрового хода.'])}<div class="ec-section-title">Сводка</div>
    <div class="ec-ov-grid ec-force-stats">
      <div class="ec-ov-card"><div class="ec-ov-v" style="color:var(--gd)">${ecNum(totDiv)}</div><div class="ec-ov-k">⚔ Дивизий</div></div>
      <div class="ec-ov-card"><div class="ec-ov-v" style="color:var(--te)">${ecNum(totShip)}</div><div class="ec-ov-k">🚀 Кораблей</div></div>
      ${inQueue ? `<div class="ec-ov-card ec-ov-clk" onclick="ecSetTab('milbuild')"><div class="ec-ov-v" style="color:var(--color-warning, #e0a030)">${ecNum(inQueue)}</div><div class="ec-ov-k">🏭 В очереди</div></div>` : ''}
    </div>
    <div class="ec-section-title">Боевой состав</div>
    ${rosterHtml}
    ${ecFleetSectionHtml()}</div>`;
}

// ── «Сформировать флот» (зеркало _army_fleet.sql) ──
// Флот собирается из РЕАЛЬНЫХ кораблей состава, размещается в системе своей
// колонии и управляется на ГАЛАКТИЧЕСКОЙ КАРТЕ (клик по значку флота слева от
// звезды): переброска / возврат на базу / роспуск. Здесь — только формирование
// и список флотов с роспуском.
function ecFleetSectionHtml() {
  // свободные корабли состава (те, что не заняты в уже сформированных флотах —
  // их сервер уже снял из unit_production, поэтому EC.roster показывает остаток)
  const stock = {};
  (EC.roster || []).filter(r => r.category === 'ship' && r.unit_id).forEach(r => {
    const k = r.unit_id;
    if (!stock[k]) stock[k] = { unit_id: r.unit_id, name: r.unit_name, qty: 0 };
    stock[k].qty += r.qty || 0;
  });
  const ships = Object.values(stock).filter(s => s.qty > 0).sort((a, b) => (b.qty || 0) - (a.qty || 0));
  const colSysIds = [...new Set((EC.colonies || []).map(c => c.system_id))];
  const fleets = EC.fleets || [];

  const pick = ships.length
    ? ships.map(s => `<div class="ec-q-row">
        <span class="ec-r-name">🚀 ${esc(s.name)} <span class="ec-hint">в составе ×${ecNum(s.qty)}</span></span>
        <input type="number" class="ec-fleet-q ec-prod-qty" data-uid="${esc(s.unit_id)}" min="0" max="${s.qty}" value="0" style="width:70px">
      </div>`).join('')
    : `<div class="ec-empty" style="padding:8px;line-height:1.45">Свободных кораблей нет. Постройте флот во вкладке «🏭 Строительство вооружённых сил» — или распустите существующий флот, чтобы вернуть корабли в состав.</div>`;

  const canForm = ships.length && colSysIds.length;
  const formBlock = !colSysIds.length
    ? `<div class="ec-empty" style="padding:8px">Нет колоний для размещения флота.</div>`
    : `${pick}
      ${ships.length ? `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px;margin-top:8px">
        <select id="ec-fleet-sys">${colSysIds.map(sid => `<option value="${esc(sid)}">${esc(ecSysName(sid))}</option>`).join('')}</select>
        <input type="text" id="ec-fleet-name" class="ec-prod-qty" style="width:160px" maxlength="40" placeholder="имя флота (необязательно)">
        <button class="btn btn-gd btn-sm" ${canForm ? '' : 'disabled'} onclick="ecFleetForm()">⚓ Сформировать флот</button>
      </div>
      <div class="ec-cap">Укажите, сколько кораблей каждого типа забрать, выберите систему с колонией и сформируйте флот. Он появится на <b>галактической карте</b> значком ⚓ <b>слева от звезды</b> — оттуда перебрасывайте его по гиперпутям, возвращайте на базу или распускайте. Роспуск возвращает корабли в состав.</div>` : ''}`;

  const fleetRows = fleets.map(fl => {
    if (EC.fleetEdit === fl.id) return ecFleetEditorHtml(fl);
    const comp = (fl.composition || []).map(c => `${esc(c.unit_name || '?')} ×${ecNum(c.qty)}`).join(', ');
    const fuelHint = fl.status === 'transit' ? '' : ecFleetFuelHint(fl.composition);
    let right;
    if (fl.status === 'transit') {
      right = ecProgressISO(fl.depart_at, fl.arrive_at, 1, 'прибывает');
    } else {
      const editBtn = fl.editable
        ? `<button class="ec-bld-del" style="color:var(--te)" title="Редактировать состав (нужна стоянка у своей верфи)" onclick="ecFleetEditOpen('${fl.id}')">✎</button>`
        : '';
      right = `${editBtn}<button class="ec-bld-del" title="Распустить флот — корабли вернутся в состав" onclick="ecFleetDisband('${fl.id}')">✕</button>`;
    }
    const where = fl.status === 'transit' ? `→ ${esc(ecSysName(fl.dest_sys))}` : `в системе ${esc(ecSysName(fl.system_id))}`;
    return `<div class="ec-q-row"><span class="ec-r-name">⚓ Флот${fl.name ? ' «' + esc(fl.name) + '»' : ''} <span class="ec-hint">${comp || '—'} · ${where}${fuelHint ? ' · ⛽ ' + fuelHint + '/прыжок' : ''}</span></span>${right}</div>`;
  }).join('');

  return `<div class="ec-section-title">⚓ Сформировать флот <span class="ec-hint">— из кораблей состава; управление на карте</span></div>
    ${formBlock}
    ${fleets.length ? `<div class="ec-sub-title" style="margin-top:10px">Мои флоты · ${fleets.length}</div>${fleetRows}` : ''}`;
}

// ── Топливо перелёта (зеркало _fleet_ops.sql: _fleet_fuel_for) ──
// Класс корабля → топливо и расход на 1 корабль за 1 прыжок. Жжёт ОСНОВНОЕ
// топливо тира (Гелий-3 / Дейтерий / Старвис) + ВТОРИЧНОЕ (Метан / Углерод /
// Изотопы). Неизвестный класс ≈ фрегат.
const EC_FLEET_FUEL = {
  corvette:   [{ res: 'Гелий-3',  per: 1 }, { res: 'Метан',   per: 1 }],
  frigate:    [{ res: 'Гелий-3',  per: 2 }, { res: 'Метан',   per: 1 }],
  destroyer:  [{ res: 'Дейтерий', per: 2 }, { res: 'Углерод', per: 1 }],
  cruiser:    [{ res: 'Дейтерий', per: 3 }, { res: 'Углерод', per: 2 }],
  battleship: [{ res: 'Старвис',  per: 2 }, { res: 'Изотопы', per: 1 }],
  dreadnought:[{ res: 'Старвис',  per: 4 }, { res: 'Изотопы', per: 2 }],
};
const EC_FLEET_FUEL_DEF = [{ res: 'Гелий-3', per: 2 }, { res: 'Метан', per: 1 }];
// Карта {ресурс: количество} на ОДИН прыжок для данного состава.
function ecFleetFuelPerJump(comp) {
  const out = {};
  (comp || []).forEach(c => {
    const qty = Math.max(0, c.qty || 0); if (!qty) return;
    const fs = EC_FLEET_FUEL[c.cls] || EC_FLEET_FUEL_DEF;
    fs.forEach(f => { out[f.res] = (out[f.res] || 0) + f.per * qty; });
  });
  return out;
}
// «Дейтерий 12, Гелий-3 4» — компактная подпись расхода.
function ecFleetFuelFmt(map) {
  return Object.keys(map || {}).filter(k => map[k] > 0).map(k => `${k} ${ecNum(map[k])}`).join(', ');
}
function ecFleetFuelHint(comp) { return ecFleetFuelFmt(ecFleetFuelPerJump(comp)); }

// Сформировать флот из выбранных кораблей в системе своей колонии.
async function ecFleetForm() {
  if (EC.busy) return;
  const sel = ecId('ec-fleet-sys'); if (!sel || !sel.value) { toast('Выберите систему с колонией', 'err'); return; }
  const units = [];
  document.querySelectorAll('.ec-fleet-q').forEach(inp => { const q = parseInt(inp.value, 10) || 0; if (q > 0) units.push({ unit_id: inp.dataset.uid, qty: q }); });
  if (!units.length) { toast('Укажите, сколько кораблей забрать во флот', 'err'); return; }
  const nm = (ecId('ec-fleet-name')?.value || '').trim();
  EC.busy = true;
  try {
    const r = await ecRpc('fleet_form', { p_system_id: sel.value, p_name: nm || null, p_units: units });
    toast('⚓ Флот сформирован · ' + ecNum((r && r.ships) || 0) + ' кор. · управляйте им на карте', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Распустить флот — корабли возвращаются в состав (unit_production).
async function ecFleetDisband(id) {
  if (EC.busy) return;
  if (!confirm('Распустить флот? Все его корабли вернутся в боевой состав.')) return;
  EC.busy = true;
  try {
    const r = await ecRpc('fleet_disband', { p_id: id });
    toast('Флот распущен · +' + ecNum((r && r.returned) || 0) + ' кор. в состав', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── Редактирование флота (зеркало _fleet_ops.sql: fleet_edit) ──
// Доступно только когда флот стоит у своей верфи (fl.editable). Игрок ставит
// итоговое число каждого корабля; разница списывается из состава или
// возвращается в него. EC.fleetEdit — id редактируемого флота, EC.fleetEditDelta
// — карта unit_id → дельта (положительная = добрать из состава, отрицательная =
// вернуть в состав).
function ecFleetEditOpen(id) {
  EC.fleetEdit = id;
  EC.fleetEditDelta = {};
  const fl = (EC.fleets || []).find(f => f.id === id);
  EC.fleetEditName = (fl && fl.name) || '';
  ecPaintCabinet();
}
function ecFleetEditClose() {
  EC.fleetEdit = null; EC.fleetEditDelta = {}; EC.fleetEditName = '';
  ecPaintCabinet();
}
// Свободные корабли состава по unit_id (не занятые во флотах — сервер их уже снял).
function ecRosterShipsByUid() {
  const m = {};
  (EC.roster || []).filter(r => r.category === 'ship' && r.unit_id).forEach(r => {
    if (!m[r.unit_id]) m[r.unit_id] = { unit_id: r.unit_id, name: r.unit_name, qty: 0 };
    m[r.unit_id].qty += r.qty || 0;
  });
  return m;
}
function ecFleetEditAdjust(uid, delta) {
  const fl = (EC.fleets || []).find(f => f.id === EC.fleetEdit); if (!fl) return;
  const comp = (fl.composition || []).find(c => c.unit_id === uid);
  const inFleet = comp ? (comp.qty || 0) : 0;
  const avail = (ecRosterShipsByUid()[uid] || {}).qty || 0;
  let d = (EC.fleetEditDelta[uid] || 0) + delta;
  d = Math.max(-inFleet, Math.min(avail, d));   // не ниже 0 в составе флота, не выше запаса
  EC.fleetEditDelta[uid] = d;
  const cont = ecId('ec-fleet-editor'); if (cont) cont.innerHTML = ecFleetEditorInner(fl);
}
// Внутренность редактора (без обёртки) — чтобы перерисовывать только её.
function ecFleetEditorInner(fl) {
  EC.fleetEditDelta = EC.fleetEditDelta || {};
  const comp = fl.composition || [];
  const roster = ecRosterShipsByUid();
  // объединяем юниты во флоте и свободные в составе
  const rows = {};
  comp.forEach(c => { rows[c.unit_id] = { unit_id: c.unit_id, name: c.unit_name, cls: c.cls, inFleet: c.qty || 0, avail: 0 }; });
  Object.values(roster).forEach(s => {
    if (!rows[s.unit_id]) rows[s.unit_id] = { unit_id: s.unit_id, name: s.name, cls: null, inFleet: 0, avail: 0 };
    rows[s.unit_id].avail = s.qty;
  });
  const list = Object.values(rows).sort((a, b) => (b.inFleet + b.avail) - (a.inFleet + a.avail)).map(r => {
    const d = EC.fleetEditDelta[r.unit_id] || 0;
    const fin = r.inFleet + d;
    const canMinus = fin > 0, canPlus = d < r.avail;
    const dTxt = d > 0 ? ` <span style="color:var(--te)">+${ecNum(d)}</span>` : d < 0 ? ` <span style="color:var(--rd,#d66)">${ecNum(d)}</span>` : '';
    return `<div class="ec-q-row">
        <span class="ec-r-name">🚀 ${esc(r.name || '?')} <span class="ec-hint">в составе ×${ecNum(r.avail)}${dTxt}</span></span>
        <span style="display:flex;align-items:center;gap:6px">
          <button class="ec-mine-btn" ${canMinus ? '' : 'disabled'} onclick="ecFleetEditAdjust('${esc(r.unit_id)}',-1)">−</button>
          <b style="min-width:26px;text-align:center">${ecNum(fin)}</b>
          <button class="ec-mine-btn" ${canPlus ? '' : 'disabled'} title="${canPlus ? '' : 'нет свободных в составе'}" onclick="ecFleetEditAdjust('${esc(r.unit_id)}',1)">+</button>
        </span>
      </div>`;
  }).join('');
  // прогноз состава после правок → топливо/прыжок
  const projComp = Object.values(rows).map(r => ({ cls: r.cls, qty: r.inFleet + (EC.fleetEditDelta[r.unit_id] || 0) })).filter(c => c.qty > 0);
  const total = projComp.reduce((a, c) => a + c.qty, 0);
  const fuel = ecFleetFuelHint(projComp);
  return `<div class="ec-prod-form" style="margin-bottom:8px">
      <input type="text" id="ec-fleet-edit-name" class="ec-prod-qty" style="width:200px" maxlength="40" placeholder="имя флота" value="${esc(EC.fleetEditName || '')}">
    </div>
    ${list || '<div class="ec-empty" style="padding:6px">Нет кораблей.</div>'}
    <div class="ec-cap">Итог: <b>${ecNum(total)}</b> кор.${fuel ? ` · ⛽ ${fuel}/прыжок` : ''}. Добор «+» снимает корабли из состава, «−» возвращает их в состав. Сохраняйте у своей верфи.</div>
    <div class="ec-prod-form" style="gap:6px;margin-top:8px">
      <button class="btn btn-gd btn-sm" ${total > 0 ? '' : 'disabled'} onclick="ecFleetEditApply('${fl.id}')">💾 Сохранить</button>
      <button class="btn btn-gh btn-sm" onclick="ecFleetEditClose()">Отмена</button>
    </div>`;
}
function ecFleetEditorHtml(fl) {
  return `<div class="ec-q-row" style="flex-direction:column;align-items:stretch;background:rgba(120,200,235,0.06);border:1px solid rgba(120,200,235,0.25);border-radius:8px;padding:10px">
      <div class="ec-sub-title" style="margin:0 0 6px">✎ Правка флота${fl.name ? ' «' + esc(fl.name) + '»' : ''} <span class="ec-hint">· в системе ${esc(ecSysName(fl.system_id))}</span></div>
      <div id="ec-fleet-editor">${ecFleetEditorInner(fl)}</div>
    </div>`;
}
async function ecFleetEditApply(id) {
  if (EC.busy) return;
  const add = [], remove = [];
  Object.keys(EC.fleetEditDelta || {}).forEach(uid => {
    const d = EC.fleetEditDelta[uid] || 0;
    if (d > 0) add.push({ unit_id: uid, qty: d });
    else if (d < 0) remove.push({ unit_id: uid, qty: -d });
  });
  const nm = (ecId('ec-fleet-edit-name')?.value || '').trim();
  if (!add.length && !remove.length && nm === (EC.fleetEditName || '')) { ecFleetEditClose(); return; }
  EC.busy = true;
  try {
    const r = await ecRpc('fleet_edit', { p_id: id, p_add: add, p_remove: remove, p_name: nm });
    toast('⚓ Флот обновлён · ' + ecNum((r && r.ships) || 0) + ' кор.', 'ok');
    EC.fleetEdit = null; EC.fleetEditDelta = {}; EC.fleetEditName = '';
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Метр вместимости/мощности: подпись + значение used/cap + бар + примечание.
// opts: {unit, full, fullNote, freeNote, overOk} — overOk=false красит бар в тревогу при превышении.
function ecCapMeter(icon, label, used, cap, opts) {
  opts = opts || {};
  const over = used > cap, full = opts.full !== undefined ? opts.full : (cap > 0 && used >= cap);
  const pct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : (used > 0 ? 100 : 0);
  const danger = full || (over && opts.overOk === false);
  const free = Math.max(0, cap - used);
  const note = danger
    ? (opts.fullNote || `Превышено: ${ecNum(used)} из ${ecNum(cap)}`)
    : (opts.freeNote ? `${opts.freeNote} ${ecNum(free)}${opts.unit ? ' ' + opts.unit : ''}` : `${opts.unit || ''}`.trim());
  return `<div class="ec-meter${danger ? ' ec-meter--full' : ''}">
    <div class="ec-meter-hd"><span class="ec-meter-lb">${icon} ${label}</span><span class="ec-meter-val">${ecNum(used)}<i> / ${ecNum(cap)}</i></span></div>
    <div class="ec-meter-bar"><div class="ec-meter-fill" style="width:${pct}%"></div></div>
    ${note ? `<div class="ec-meter-note">${note}</div>` : ''}
  </div>`;
}

// ── Вкладка 2: «Строительство вооружённых сил» — производство и очередь ──
function ecTabMilBuild() {
  const caps = ecCaps(), use = ecPendingUse();
  const divisions = EC.designs.filter(d => d.category === 'division');
  const ships = EC.designs.filter(d => d.category === 'ship');

  const divHtml = divisions.length
    ? `<div class="ec-div-grid">${divisions.map(ecDivBuildCard).join('')}</div>`
    : `<div class="ec-empty">Нет дивизий. Спроектируйте дивизию в Конструкторе дивизий. <button class="btn btn-gh btn-sm" style="margin-left:8px" onclick="go('build-division')">⛬ Конструктор дивизий</button></div>`;

  let shipForm;
  if (!caps.hasShipyard) shipForm = `<div class="ec-empty">Нужна Корабельная Верфь — постройте её во вкладке «Колонии».</div>`;
  else if (!ships.length) shipForm = `<div class="ec-empty">Нет проектов кораблей. Спроектируйте в Корабельном конструкторе. <button class="btn btn-gh btn-sm" style="margin-left:8px" onclick="go('build-ship')">🚀 Конструктор</button></div>`;
  else {
    const fUsed = ecFleetUsed(), fCap = caps.fleetCap, fFull = fUsed >= fCap;
    shipForm = `<div class="ec-prod-form">
      <select id="ec-ship-sel" onchange="ecShipBillUpd()">${ships.map(d => `<option value="${esc(d.id)}">${esc(d.name)} — ${ecNum((d.summary && d.summary.cost) || 0)} ГС</option>`).join('')}</select>
      <input type="number" id="ec-ship-qty" value="1" min="1" class="ec-prod-qty" oninput="ecShipBillUpd()">
      <button class="btn btn-gd btn-sm" onclick="ecProduceShip()">＋ Заложить</button>
    </div>
    <div id="ec-ship-bill" class="ec-ship-bill">${ecShipBillHtml(ships[0].id, 1)}</div>
    <div class="ec-meter-row">
      ${ecCapMeter('🏗', 'Верфь за ход', use.ships, caps.ships, { unit: 'кораблей', overOk: false })}
      ${ecCapMeter('🛰', 'Вместимость флота', fUsed, fCap, { unit: 'мест', full: fFull, fullNote: 'Лимит исчерпан — постройте Звёздную Базу или откройте её слот', freeNote: 'свободно' })}
    </div>`;
  }

  const queueHtml = EC.queue.length
    ? EC.queue.map(q => `<div class="ec-q-row"><span class="ec-r-name">${esc(q.unit_name)} ×${ecNum(q.qty)}</span>${ecProgressISO(q.created_at, q.ready_at, 1, 'готово на след. ходу')}<button class="ec-bld-del" title="Отменить" onclick="ecCancelProd('${q.id}')">✕</button></div>`).join('')
    : `<div class="ec-empty" style="padding:8px">Очередь пуста.</div>`;

  const infLine = caps.robot
    ? `Пехота-роботы → <b>Военный завод</b> (×3: ${ecNum(EC_ROBOT_INF_PER_SLOT)}/слот), техника → <b>Военный завод</b>, корабли → <b>Корабельная верфь</b>.`
    : 'Объём производства зависит от слотов военных зданий: пехота → <b>Центр подготовки</b>, техника → <b>Военный завод</b>, корабли → <b>Корабельная верфь</b>.';
  const divHint = caps.robot
    ? '— роботы собирают пехоту и технику на Военном Заводе (Центр Подготовки не нужен)'
    : '— комплектование: нужны здания под состав (пехота → Подготовка, техника → Воензавод)';
  const groundCap = `<div class="ec-cap">Пехота: <b>${ecNum(caps.training)} ед./ход</b>${caps.robot ? ' <span class="ec-rbadge">⚙ робо-сборка ×3</span>' : ''} · Техника: <b>${ecNum(caps.military)} ед./ход</b></div>`;
  return `${ecIntro('🏭', 'Строительство вооружённых сил', 'Производство войск. Сами шаблоны проектируются в <b>Конструкторах</b>, а заказ на производство — здесь.', [infLine, 'Нет проектов? Откройте «⚒ Конструкторы» и спроектируйте дивизию или корабль.', 'Заказы выполняются к следующему игровому дню и попадают в «⚔ Вооружённые силы государства».'])}<div class="ec-section-title">Дивизии <span class="ec-hint">${divHint}</span></div>
    ${groundCap}
    ${divHtml}
    <div class="ec-section-title">Флот <span class="ec-hint">— корабли строятся на Верфи поштучно</span></div>
    ${shipForm}
    ${ecRepairPanelHtml(caps)}
    <div class="ec-section-title">В очереди <span class="ec-hint">— доставка в конце хода (сутки)</span></div>
    <div class="ec-queue">${queueHtml}</div>`;
}

// Цена ремонта корабля = доля стоимости постройки его проекта (зеркало _repair_cost).
function ecRepairCost(unitId, qty) {
  const d = (EC.designs || []).find(x => x.id === unitId && x.category === 'ship');
  const cost = (d && d.summary && d.summary.cost) || 100;
  return Math.max(1, Math.ceil(cost * EC_REPAIR_COST_FRAC * Math.max(1, qty || 1)));
}

// Панель «Повреждённые корабли»: чинятся на Корабельной Верфи за ГС и 1 ход.
function ecRepairPanelHtml(caps) {
  const dmg = EC.damaged || [], rep = EC.repairing || [];
  if (!dmg.length && !rep.length) return '';
  const slots = caps.ships, busy = rep.reduce((a, r) => a + (r.qty || 0), 0), free = Math.max(0, slots - busy);
  const dmgRows = dmg.map(r => {
    const each = ecRepairCost(r.unit_id, 1), all = ecRepairCost(r.unit_id, r.qty);
    const can = caps.hasShipyard && free > 0 && (EC.eco.gc || 0) >= each;
    return `<div class="ec-q-row">
      <span class="ec-r-name">🛠 ${esc(r.unit_name)} ×${ecNum(r.qty)} <span class="ec-hint">— ${ecNum(each)} ГС/шт</span></span>
      <button class="btn btn-gd btn-sm" ${can ? '' : 'disabled'} title="${can ? '' : (!caps.hasShipyard ? 'Нужна Верфь' : free <= 0 ? 'Мощность Верфи занята' : 'Не хватает ГС')}" onclick="ecShipyardRepair('${r.id}', ${r.qty})">Чинить всё (${ecNum(all)} ГС)</button>
    </div>`;
  }).join('');
  const repRows = rep.map(r => `<div class="ec-q-row"><span class="ec-r-name">⚙ ${esc(r.unit_name)} ×${ecNum(r.qty)} <span class="ec-hint">в ремонте</span></span>${ecProgressISO(r.created_at, r.ready_at, 1, 'готово на след. ходу')}</div>`).join('');
  return `<div class="ec-section-title">Повреждённые корабли <span class="ec-hint">— чинит Верфь: ${ecNum(busy)}/${ecNum(slots)} мощности занято</span></div>
    ${dmg.length ? dmgRows : ''}
    ${rep.length ? repRows : ''}
    ${!caps.hasShipyard && dmg.length ? '<div class="ec-empty" style="padding:8px">Постройте Корабельную Верфь, чтобы чинить.</div>' : ''}`;
}

// Аванпосты (зеркало _defense_outpost.sql) — отдельная вкладка кабинета.
// Постройка носителя — здесь; отправка/развёртывание — на ГАЛАКТИЧЕСКОЙ КАРТЕ
// (клик по носителю); смена режима развёрнутого аванпоста — здесь (ecOutpostSetMode).
const EC_OUTPOST_CAP = 20, EC_OUTPOST_SHIP_COST = 2000, EC_OUTPOST_BUILD_H = 24;   // вместимость + цена носителя + время постройки (зеркало _defense_const)
function ecSysName(id) { const s = (EC.allSystems || []).find(x => x.id === id); return (s && s.name) || id; }
// Вкладка «Аванпосты»: вводный блок + панель управления.
function ecTabOutposts() {
  return `${ecIntro('🛰', 'Аванпосты', 'Форпосты в нейтральном космосе вне ваших границ. Сначала на <b>Верфи</b> строится корабль-носитель (сутки), затем на карте вы отправляете его в нейтральную систему и разворачиваете, выбирая режим.', [
    '<b>🛰 Разведка</b> — раскрывает оборону системы и даёт размытый срез по соседним по гиперпутям державам (внизу — «Разведсводка»).',
    '<b>⛏ Добыча</b> — работает как вынесенный добывающий завод: каждые сутки тянет <b>ВСЕ ресурсы</b> с планет своей системы, <b>кроме эпических и легендарных</b> (элиту качает только Экзотический экстрактор на колонии), + ГС, и служит стоянкой флота (+' + EC_OUTPOST_CAP + ' мест).',
    'Режим можно <b>переключать</b> у уже развёрнутого аванпоста — в списке ниже.',
    'Нельзя входить в чужие границы; разворачивать — не впритык к чужой границе.'])}
    ${ecOutpostPanelHtml()}`;
}
// Подпись режима развёрнутого аванпоста.
function ecOutpostModeLabel(mode) {
  return mode === 'mining'
    ? `⛏ добыча <span class="ec-hint">+${EC_OUTPOST_CAP} мест флота</span>`
    : `🛰 разведка <span class="ec-hint">— срез по соседним державам</span>`;
}
// Список добываемых ресурсов системы аванпоста (v2: все, кроме эпик/легендарных).
function ecOutpostResList(o) {
  const res = ecSysResources(o.system_id);
  const list = [...res.entries()].filter(([name, m]) => {
    const r = m.r || ecResRarity(name);
    return r !== 'epic' && r !== 'legendary';
  }).map(([name]) => esc(name));
  return list.length ? 'добывает: ' + list.join(', ') : 'в системе нет доступных ресурсов (элита не в счёт)';
}
function ecOutpostPanelHtml() {
  const mine = (EC.outposts || []).filter(o => o.mine);
  const ships = EC.opShips || [];
  const transit = ships.filter(s => s.status === 'transit').length;
  const building = ships.filter(s => s.status === 'building').length;
  const idle = ships.filter(s => s.status === 'idle').length;
  const shipRows = ships.map(sh => {
    if (sh.status === 'building') {
      return `<div class="ec-q-row"><span class="ec-r-name">🏗 Носитель${sh.name ? ' «' + esc(sh.name) + '»' : ''} <span class="ec-hint">строится в ${esc(ecSysName(sh.system_id))}</span></span>
        ${ecProgressISO(sh.depart_at, sh.arrive_at, 1, 'готов')}</div>`;
    }
    if (sh.status === 'transit') {
      return `<div class="ec-q-row"><span class="ec-r-name">🚀 Носитель${sh.name ? ' «' + esc(sh.name) + '»' : ''} <span class="ec-hint">→ ${esc(ecSysName(sh.dest_sys))}</span></span>
        ${ecProgressISO(sh.depart_at, sh.arrive_at, 1, 'прибывает')}</div>`;
    }
    return `<div class="ec-q-row"><span class="ec-r-name">🚀 Носитель${sh.name ? ' «' + esc(sh.name) + '»' : ''} <span class="ec-hint">в системе ${esc(ecSysName(sh.system_id))}</span></span>
      <span class="ec-hint">${sh.can_deploy ? 'можно развернуть' : 'на стоянке'}</span></div>`;
  }).join('');
  const opRows = mine.map(o => {
    const toMining = o.mode !== 'mining';
    const swBtn = `<button class="btn btn-gh btn-sm" style="padding:1px 8px;font-size:11px" title="Переключить режим аванпоста" onclick="ecOutpostSetMode('${o.id}','${toMining ? 'mining' : 'recon'}')">${toMining ? '→ ⛏ добыча' : '→ 🛰 разведка'}</button>`;
    // v2: аванпост добывает все ресурсы системы (кроме эпик/легендарных) — пикер убран
    const resPick = o.mode === 'mining' ? `<div class="ec-op-respick"><span class="ec-hint">⛏ ${ecOutpostResList(o)}</span></div>` : '';
    return `<div class="ec-q-row ec-op-row"><span class="ec-r-name">🛰 ${esc(ecSysName(o.system_id))}${o.name ? ' · ' + esc(o.name) : ''} <span class="ec-hint">${ecOutpostModeLabel(o.mode)}</span></span>${swBtn}${resPick}</div>`;
  }).join('');
  // Разведданные разведаванпостов: размытый срез по соседним по гиперпутям державам.
  const intel = EC.outpostIntel || [];
  const intelRows = intel.map(r => {
    const fl = r.fleet || {}, fo = r.forces || {};
    const det = r.income
      ? `доход: ${esc(r.income)} · флот: ${esc(fl.ships || '?')} кор., ${esc(fl.ground || '?')} назем. · армия: ${esc(fo.army || '—')}`
      : 'данные собираются…';
    return `<div class="ec-q-row"><span class="ec-r-name">🛰 ${esc(r.target_name || r.target_fid)}</span><span class="ec-hint">${det}</span></div>`;
  }).join('');
  // Носитель аванпоста — обычный корабль: строится на Корабельной Верфи. Доступные
  // системы постройки — те, где стоит своя Верфь (как и весь остальной флот).
  const verfColonyIds = new Set((EC.buildings || []).filter(b => b.btype === 'shipyard').map(b => b.colony_id));
  const verfSysIds = [...new Set((EC.colonies || []).filter(c => verfColonyIds.has(c.id)).map(c => c.system_id))];
  const gc = EC.eco.gc || 0, afford = gc >= EC_OUTPOST_SHIP_COST;
  const buildForm = !verfSysIds.length
    ? `<div class="ec-empty" style="padding:8px;line-height:1.45">Носитель аванпоста строится на <b>Корабельной Верфи</b>, как и весь флот. Постройте Верфь во вкладке «Колонии».</div>`
    : `<div class="ec-prod-form">
        <select id="ec-op-sys">${verfSysIds.map(sid => `<option value="${esc(sid)}">${esc(ecSysName(sid))}</option>`).join('')}</select>
        <input type="text" id="ec-op-name" class="ec-prod-qty" style="width:150px" maxlength="40" placeholder="имя (необязательно)">
        <button class="btn btn-gd btn-sm" ${afford ? '' : 'disabled'} title="${afford ? '' : 'Не хватает ГС'}" onclick="ecOutpostBuildShip()">＋ Заложить носитель · ${ecNum(EC_OUTPOST_SHIP_COST)} ГС</button>
      </div>
      <div class="ec-cap">Постройка носителя занимает <b>сутки</b>. Готовый носитель появится на <b>галактической карте</b> в выбранной системе — оттуда отправляйте его по гиперпутям и при развёртывании выбирайте режим: <b>🛰 разведка</b> (срез по соседним державам) или <b>⛏ добыча</b> (ресурсы вне границ + стоянка флота). Нельзя входить в чужие границы; разворачивать — не впритык к чужой границе.</div>`;
  return `<div class="ec-section-title">Постройка носителя <span class="ec-hint">— строится сутки на Верфи; отправка и развёртывание — на карте</span></div>
    ${buildForm}
    ${ships.length ? `<div class="ec-sub-title" style="margin-top:8px">Носители · ${building} строятся, ${idle} на стоянке, ${transit} в пути</div>${shipRows}` : ''}
    ${mine.length ? `<div class="ec-sub-title" style="margin-top:8px">Развёрнутые аванпосты · ${mine.length}</div>${opRows}` : ''}
    ${intelRows ? `<div class="ec-sub-title" style="margin-top:8px">🛰 Разведсводка аванпостов · ${intel.length}</div>${intelRows}` : ''}`;
}

// Заложить носитель аванпоста на Верфи (в системе своей колонии с Верфью).
// Тот же RPC, что раньше дёргала карта, — теперь точка входа в кабинете.
async function ecOutpostBuildShip() {
  if (EC.busy) return;
  const sel = ecId('ec-op-sys'); if (!sel || !sel.value) { toast('Выберите систему с Верфью', 'err'); return; }
  if ((EC.eco.gc || 0) < EC_OUTPOST_SHIP_COST) { toast('Не хватает ГС: носитель стоит ' + ecNum(EC_OUTPOST_SHIP_COST), 'err'); return; }
  const nm = (ecId('ec-op-name')?.value || '').trim();
  EC.busy = true;
  try {
    await ecRpc('outpost_ship_build', { p_system_id: sel.value, p_name: nm || null });
    toast('Носитель аванпоста заложен · −' + ecNum(EC_OUTPOST_SHIP_COST) + ' ГС · строится сутки', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Переключить режим уже развёрнутого аванпоста (разведка ↔ добыча).
async function ecOutpostSetMode(id, mode) {
  if (EC.busy) return;
  const md = mode === 'mining' ? 'mining' : 'recon';
  EC.busy = true;
  try {
    await ecRpc('outpost_set_mode', { p_id: id, p_mode: md });
    toast(md === 'mining' ? '⛏ Аванпост переведён в добычу' : '🛰 Аванпост переведён в разведку', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// v2: выбор добываемого ресурса убран — аванпост копает все ресурсы системы,
// кроме эпических и легендарных (ecOutpostSetRes/outpost_set_resource выпилены).

async function ecShipyardRepair(id, qty) {
  if (EC.busy) return;
  EC.busy = true;
  try {
    const r = await ecRpc('shipyard_repair', { p_id: id, p_qty: qty });
    toast(`Ремонт запущен · ${ecNum(r && r.cost || 0)} ГС · готово на след. ходу`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── Территория: смежность, миникарта, захват ───────────────
function ecMySysIds() { return new Set((EC.allSystems || []).filter(s => s.faction === EC.fid).map(s => s.id)); }
function ecClaimableIds() {
  const mine = ecMySysIds(), adj = new Set();
  (EC.lanes || []).forEach(l => {
    if (mine.has(l.a_id) && !mine.has(l.b_id)) adj.add(l.b_id);
    if (mine.has(l.b_id) && !mine.has(l.a_id)) adj.add(l.a_id);
  });
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  return [...adj].filter(id => { const s = byId.get(id); return s && !s.faction; });
}
// Цена и кулдаун колонизации системы с учётом доктрины (зеркало economy_claim_system).
function ecClaimCost() { return Math.max(1, Math.round(EC_CLAIM_COST * ecFactionMods().claim_cost)); }
function ecClaimCdDays() { return Math.max(1, Math.round(EC_CLAIM_CD_DAYS * ecFactionMods().claim_cd)); }
function ecClaimCooldownMs() {
  if (!EC.eco.last_system_claim) return 0;
  return Math.max(0, new Date(EC.eco.last_system_claim).getTime() + ecClaimCdDays() * 86400000 - Date.now());
}
// Размер пула захватов: СКЛАДЫВАЕТСЯ по источникам, без потолка (зеркало economy_claim_system).
//   база 1  +1 Экспансионизм  +1 «Дом в небесах»  +1 роботы.
function ecClaimMax(app) {
  app = app || EC.app || {};
  let n = 1;
  if (app.ideology === 'Экспансионизм') n++;
  if (((EC.eco && EC.eco.research) || []).includes('pol.house_heavens')) n++;
  if (app.race === 'Синтетики / Киборги' || app.gov === 'Машинный разум (ИИ)') n++;
  return n;
}
// Сколько захватов осталось в пуле (зеркало модели «пул» в economy_claim_system):
//   кулдаун идёт → 0; кулдаун прошёл → пул пополнен (max); пул открыт → max − использовано.
function ecClaimsLeft() {
  if (ecClaimCooldownMs() > 0) return 0;
  if (EC.eco.last_system_claim) return ecClaimMax();
  return Math.max(0, ecClaimMax() - (EC.eco.claim_used || 0));
}
function ecMinimap() {
  const all = EC.allSystems || [];
  if (!all.length) return `<div class="ec-empty">Карта недоступна.</div>`;
  mapZoomClean('ec-minimap-zoom');
  const W = (typeof GM_W !== 'undefined') ? GM_W : 3300, H = (typeof GM_H !== 'undefined') ? GM_H : 2062;
  const mine = ecMySysIds(), claim = new Set(ecClaimableIds()), myCol = ecReadable(EC.app.color);
  const byId = new Map(all.map(s => [s.id, s]));
  const lanesSvg = (EC.lanes || []).map(l => {
    const a = byId.get(l.a_id), b = byId.get(l.b_id); if (!a || !b) return '';
    const own = mine.has(l.a_id) && mine.has(l.b_id);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${own ? myCol : 'rgba(255,255,255,.07)'}" stroke-width="${own ? 5 : 2}"/>`;
  }).join('');
  const dots = all.map(s => {
    let r = 14, fill = 'rgba(140,160,190,.5)', stroke = 'transparent', sw = 0, click = '';
    if (mine.has(s.id)) { r = 22; fill = myCol; }
    else if (claim.has(s.id)) { r = 20; fill = 'rgba(0,0,0,.45)'; stroke = 'var(--gd)'; sw = 5; click = ` style="cursor:pointer" onclick="ecClaimSystem('${esc(s.id)}')"`; }
    else if (s.faction) { fill = 'rgba(255,90,90,.35)'; }
    return `<g${click}><circle cx="${s.x}" cy="${s.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"><title>${esc(s.name)}${mine.has(s.id) ? ' (ваша)' : claim.has(s.id) ? ' — можно колонизировать' : s.faction ? ' (занята)' : ' (ничья)'}</title></circle></g>`;
  }).join('');
  const html = `<div class="ec-minimap"><div class="mm-zoom-wrapper"><div class="mm-zoom-btns"><button class="mm-zoom-btn" onclick="mapZoomIn('ec-minimap-zoom')">+</button><button class="mm-zoom-btn" onclick="mapZoomOut('ec-minimap-zoom')">−</button></div><div class="mm-zoom-viewport" id="ec-minimap-zoom"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${lanesSvg}${dots}</svg></div></div></div>
    <div class="ec-mm-legend"><span><i style="background:${myCol}"></i> ваши</span><span><i style="background:rgba(0,0,0,.4);box-shadow:inset 0 0 0 2px var(--gd)"></i> доступно</span><span><i style="background:rgba(255,90,90,.35)"></i> заняты</span><span><i style="background:rgba(140,160,190,.5)"></i> ничьи</span></div>`;
  requestAnimationFrame(() => mapZoomInit('ec-minimap-zoom'));
  return html;
}
function ecTabTerritory() {
  const cdMs = ecClaimCooldownMs(), claim = ecClaimableIds();
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  const claimStart = EC.eco.last_system_claim ? new Date(EC.eco.last_system_claim).getTime() : 0;
  const left = ecClaimsLeft(), max = ecClaimMax(), canClaim = left > 0;
  const leftTag = max > 1 ? ` <b style="color:var(--gd)">· осталось захватов: ${left}/${max}</b>` : '';
  const cdLine = canClaim
    ? `<div class="ec-cap">Доступно${leftTag}. Раз в ${ecClaimCdDays()} дн., стоимость ${ecNum(ecClaimCost())} ГС.</div>`
    : `<div class="ec-cap ec-warn ec-cap-prog">Колонизация системы: ${ecProgress(claimStart, claimStart + ecClaimCdDays() * 86400000, 'доступно')}</div>`;
  const list = claim.length
    ? claim.map(id => { const s = byId.get(id); return `<div class="ec-colonize-row"><div class="ec-cz-main"><span class="ec-cz-name">★ ${esc(s.name)}</span><span class="ec-cz-sub">смежная · ничья</span></div>
        <button class="btn ${canClaim ? 'btn-gd' : 'btn-gh'} btn-sm" ${canClaim ? '' : 'disabled'} onclick="ecClaimSystem('${esc(id)}')">Колонизировать систему · ${ecNum(ecClaimCost())} ГС</button></div>`; }).join('')
    : `<div class="ec-empty">Нет смежных свободных систем. Расширяйтесь вдоль гиперпутей — соседние ничьи системы появятся здесь.</div>`;
  const claimMax = ecClaimMax();
  const claimSrc = [
    ecIsExpansionist() ? 'Экспансионизм' : null,
    (EC.eco.research || []).includes('pol.house_heavens') ? '«Дом в небесах»' : null,
    ecIsRobot() ? 'роботы' : null
  ].filter(Boolean);
  const claimBullet = claimMax > 1
    ? `Стоит ${ecNum(EC_CLAIM_COST)} ГС. Можно взять <b>${claimMax} системы подряд</b>${claimSrc.length ? ' (' + claimSrc.join(' + ') + ')' : ''}, затем перезарядка <b>${ecClaimCdDays()} дн.</b>`
    : `Стоит ${ecNum(EC_CLAIM_COST)} ГС. После захвата — перезарядка <b>${ecClaimCdDays()} дн.</b> (срок зависит от доктрины).`;
  return `${ecIntro('🌐', 'Территория и расширение', 'Захватывайте звёздные системы, чтобы получать новые планеты под колонии.', ['Колонизировать можно только систему, <b>смежную по гиперпути</b> с вашей и <b>ничью</b> (серую).', claimBullet, 'Получив систему — заселяйте её планеты во вкладке «🏗 Колонии».'])}<div class="ec-section-title">Карта территории <span class="ec-hint">— ваши системы и доступные для колонизации</span></div>
    ${ecMinimap()}
    <div class="ec-section-title">Колонизация системы <span class="ec-hint">— смежная по гиперпути и ничья · раз в ${ecClaimCdDays()} дн. (доктрина)</span></div>
    ${cdLine}
    <div class="ec-colonize">${list}</div>`;
}
async function ecClaimSystem(systemId) {
  if (EC.busy) return;
  if (ecClaimsLeft() <= 0) { toast('Колонизация системы на перезарядке', 'err'); return; }
  const claimCost = ecClaimCost();
  if ((EC.eco.gc || 0) < claimCost) { toast(`Недостаточно ГС: нужно ${ecNum(claimCost)}`, 'err'); return; }
  if (!confirm('Колонизировать систему за ' + ecNum(claimCost) + ' ГС? (раз в ' + ecClaimCdDays() + ' дн.)')) return;
  EC.busy = true;
  try {
    await ecRpc('economy_claim_system', { p_system_id: systemId });
    toast('Система колонизирована!', 'ok');
    await ecReloadPaint();
    if (typeof loadGalaxyData === 'function' && typeof GM !== 'undefined' && GM.loaded) { try { await loadGalaxyData(); } catch (e) {} }
  } catch (e) {
    const m = e.message || '';
    toast(m.includes('cooldown') ? 'Колонизация системы на перезарядке' : m.includes('adjacent') ? 'Система не граничит с вашей территорией' : m.includes('already') ? 'Система уже занята' : m.includes('not enough') ? 'Недостаточно ГС' : 'Ошибка: ' + m, 'err');
    await ecReloadPaint();
  } finally { EC.busy = false; }
}

// ── Дипломатия и разведка: общие хелперы ───────────────────
function ecOtherFactions() { return (EC.factions || []).filter(f => f.faction_id && f.faction_id !== EC.fid); }
function ecFacName(fid) { const f = (EC.factions || []).find(x => x.faction_id === fid); return f ? f.name : (fid || '—'); }
function ecFacOf(fid) { return (EC.factions || []).find(x => x.faction_id === fid) || null; }
// Флаг/герб фракции как HTML-чип. Картинка из herald_url, иначе — инициалы на цветовом фоне.
function ecFacFlag(fid, size) {
  const s = size || 28; const f = ecFacOf(fid);
  const col = ecReadable((f && f.color) || '#6f8bb5');
  const url = f && f.herald_url;
  if (url) return `<span class="ec-flag" style="width:${s}px;height:${s}px;border-color:${col}"><img src="${esc(url)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('ec-flag-fb');this.remove()"><b style="color:${col}">${esc(((f && f.name) || '?').slice(0, 2).toUpperCase())}</b></span>`;
  const ini = ((f && f.name) || fid || '?').slice(0, 2).toUpperCase();
  return `<span class="ec-flag ec-flag-fb" style="width:${s}px;height:${s}px;border-color:${col}"><b style="color:${col}">${esc(ini)}</b></span>`;
}
// Относительное время «N назад» для журналов разведки (когда что произошло).
function ecAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин. назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч. назад`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн. назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
// Точная отметка времени (когда) для досье и журналов.
function ecStamp(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  return `${dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
// Цветовое кодирование перков агентов (для портретов/бейджей).
function ecPerkColor(perk) {
  return ({ infiltrator: '#5fb0e6', saboteur: '#e08a4a', ghost: '#b07bd8', analyst: '#5fd0c0', handler: '#7bd88f' })[perk] || '#9fb0c8';
}
function ecFacSelect(id) { const opts = ecOtherFactions().map(f => `<option value="${esc(f.faction_id)}">${esc(f.name)}</option>`).join(''); return `<select id="${id}">${opts || '<option value="">— нет фракций —</option>'}</select>`; }
function ecErr(m) {
  m = m || '';
  // PostgREST отдаёт ошибку JSON-ом ({"code":...,"message":"..."}) — вытащим текст,
  // чтобы игроку не вываливался сырой объект с code/hint/details.
  let raw = m;
  try { const j = JSON.parse(m); if (j && j.message) raw = m = j.message; } catch (_) {}
  // Лимит размера сделки (анти-манипуляция рынком): max N единиц за раз.
  const big = m.match(/(?:too large|units per trade)[^\d]*(\d+)/i);
  if (big) return `Слишком крупная сделка: рынок такого объёма не выдержит. Можно не больше ${big[1]} ед. за раз — разбейте на несколько сделок`;
  if (m.includes('too large') || m.includes('units per trade')) return 'Слишком крупная сделка — уменьшите количество и попробуйте снова';
  // Суточный потолок объёма по ресурсу (сбрасывается в 00:00 UTC).
  const day = m.match(/daily volume limit for (.+?):\s*(\d+)\s*used of\s*(\d+)/i);
  if (day) return `Дневной лимит торговли «${day[1]}» исчерпан: ${day[2]} из ${day[3]} ед. за сутки. Лимит обнулится в 00:00 UTC`;
  if (m.includes('daily volume limit')) return 'Дневной лимит торговли этим ресурсом исчерпан (сброс в 00:00 UTC)';
  if (m.includes('not enough resource')) return 'Недостаточно ресурса на складе';
  if (m.includes('not enough on market')) return 'На рынке нет столько ресурса';
  if (m.includes('not enough GC') || m.includes('not enough gc')) return 'Недостаточно ГС';
  if (m.includes('not enough')) return 'Недостаточно средств';
  if (m.includes('not your system')) return 'Это не ваша система';
  if (m.includes('bad kind')) return 'Неизвестная мера помощи';
  if (m.includes('no free trade hub')) return 'Нет свободных слотов Торгового хаба';
  if (m.includes('has no economy')) return 'У второй стороны нет экономики (не заходила в кабинет)';
  if (m.includes('no agents')) return 'Нет агентов';
  if (m.includes('research in progress')) return 'Уже идёт исследование';
  if (m.includes('already researched')) return 'Уже изучено';
  if (m.includes('not enough science')) return 'Недостаточно ОН';
  if (m.includes('self')) return 'Нельзя с самим собой';
  if (m.includes('forbidden')) return 'Недостаточно прав';
  if (m.includes('name violates')) return 'Название нарушает правила (мат или запрещённое)';
  if (m.includes('empty name')) return 'Пустое название';
  if (m.includes('missing prerequisites')) return 'Не изучены технологии, нужные для чертежа';
  if (m.includes('seller lacks tech')) return 'У вас нет этой технологии';
  if (m.includes('tech trade cooldown')) return 'Торговля технологиями — не чаще 1 сделки в 3 дня';
  if (m.includes('recipient not found')) return 'Получатель не найден';
  if (m.includes('bad price')) return 'Неверная цена';
  return 'Ошибка: ' + m;
}
async function ecRpcAct(fn, body, okMsg) {
  if (EC.busy) return; EC.busy = true;
  try { await ecRpc(fn, body); toast(okMsg, 'ok'); await ecReloadPaint(); }
  catch (e) { toast(ecErr(e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── Маршруты/угрозы/эскорт ──────────────────────────────────
function ecMyShipsAvailable() {
  const total = (EC.roster || []).filter(r => r.category === 'ship').reduce((a, r) => a + (r.qty || 0), 0);
  const committed = (EC.routes || []).filter(r => r.a_fid === EC.fid && ['pending', 'active'].includes(r.status)).reduce((a, r) => a + (r.convoy || 0), 0);
  const raids = (EC.raids || []).filter(m => m.status === 'active').reduce((a, m) => a + (m.ships || 0), 0);
  return Math.max(0, total - committed - raids);
}
function ecPath(from, to) {
  if (!from || !to) return null;
  if (from === to) return [from];
  const adj = {}; (EC.lanes || []).forEach(l => { (adj[l.a_id] = adj[l.a_id] || []).push(l.b_id); (adj[l.b_id] = adj[l.b_id] || []).push(l.a_id); });
  const q = [from], prev = { [from]: null }, seen = new Set([from]);
  while (q.length) {
    const c = q.shift();
    if (c === to) { const path = []; let n = to; while (n != null) { path.unshift(n); n = prev[n]; } return path; }
    (adj[c] || []).forEach(nb => { if (!seen.has(nb)) { seen.add(nb); prev[nb] = c; q.push(nb); } });
  }
  return null;
}
function ecThreatType(id) { let h = 0; for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 2 === 0 ? 'pirates' : 'ancient'; }
function ecRouteThreats(path) {
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  return (path || []).slice(1, -1).map(id => byId.get(id)).filter(s => s && !s.faction).map(s => ({ sys: s.id, name: s.name, type: ecThreatType(s.id) }));
}
function ecFillDestSys() {
  const dFac = ecId('ec-cv-dfac')?.value, sel = ecId('ec-cv-dsys'); if (!sel) return;
  const sys = (EC.allSystems || []).filter(s => s.faction === dFac);
  sel.innerHTML = sys.length ? sys.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('') : '<option value="">— нет систем —</option>';
}
// ── Интерактив формы каравана (живой расчёт без перерисовки) ──
function ecPickTradeRes(btn) {
  document.querySelectorAll('#ec-cv-reslist .ec-trade-res').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const hid = ecId('ec-cv-res'); if (hid) hid.value = btn.dataset.res;
  ecCvSync();   // объём пересчитается под запас нового ресурса и собранный флот
}

// ── Сборщик флота каравана: выбираешь ПРОЕКТЫ кораблей (грузовые → грузоподъёмность, боевые → эскорт) ──
function ecCvShipCargo(unitId) { const d = (EC.designs || []).find(x => x.id === unitId); return (d && d.summary && +d.summary.cargo) || 0; }
function ecCvFleetGroups() {
  const by = {};
  (EC.roster || []).filter(r => r.category === 'ship').forEach(r => {
    if (!by[r.unit_id]) by[r.unit_id] = { id: r.unit_id, name: r.unit_name || 'Корабль', qty: 0, cargo: ecCvShipCargo(r.unit_id) };
    by[r.unit_id].qty += r.qty || 0;
  });
  const all = Object.values(by);
  return { freighters: all.filter(d => d.cargo > 0), warships: all.filter(d => d.cargo <= 0) };
}
function ecCvFleetTotals() {
  const f = EC.cvFleet || {}; let cap = 0, escort = 0;
  Object.keys(f).forEach(id => { const c = ecCvShipCargo(id); if (c > 0) cap += (f[id] || 0) * c; else escort += (f[id] || 0); });
  return { cap, escort };
}
// Свободная вместимость флота = вся минус занятая активными/ожидающими исходящими путями.
// Это потолок объёма нового каравана (сервер проверяет то же самое).
function ecCvFreeCap() {
  const t = EC.tradeCargo || {};
  return Math.max(0, (t.total || 0) - (t.used || 0));
}
// ── Поштучное закрепление грузовых: какой корабль уже занят моими путями ──
// Сумма по моим pending/active исходящим путям их ships = {unit_id: qty}.
function ecCvCommittedShips() {
  const m = {};
  (EC.routes || []).filter(r => r.a_fid === EC.fid && ['pending', 'active'].includes(r.status)).forEach(r => {
    const s = r.ships || {};
    Object.keys(s).forEach(id => { m[id] = (m[id] || 0) + (+s[id] || 0); });
  });
  return m;
}
function ecCvShipOwned(unitId) {
  return (EC.roster || []).filter(r => r.category === 'ship' && r.unit_id === unitId).reduce((a, r) => a + (r.qty || 0), 0);
}
// Свободно к назначению = всего во владении − уже закреплено другими путями.
function ecCvShipAvail(unitId) {
  return Math.max(0, ecCvShipOwned(unitId) - (ecCvCommittedShips()[unitId] || 0));
}
function ecCvFleetHtml() {
  EC.cvFleet = EC.cvFleet || {};
  const { freighters, warships } = ecCvFleetGroups();
  const { cap, escort } = ecCvFleetTotals();
  const f = EC.cvFleet;
  // Данные о лимитах и занятости
  const totalCap = (EC.tradeCargo && EC.tradeCargo.total) || 0;  // вся вместимость флота
  const usedCap = (EC.tradeCargo && EC.tradeCargo.used) || 0;    // объём активных путей
  const freeCap = Math.max(0, totalCap - usedCap);
  const totalWar = warships.reduce((a, d) => a + (d.qty || 0), 0);
  const committedConvoy = (EC.routes || []).filter(r => r.a_fid === EC.fid && ['pending', 'active'].includes(r.status)).reduce((a, r) => a + (r.convoy || 0), 0);
  const committedRaids = (EC.raids || []).filter(m => m.status === 'active').reduce((a, m) => a + (m.ships || 0), 0);
  const freeWar = Math.max(0, totalWar - committedConvoy - committedRaids);

  const isOverloaded = usedCap > totalCap;
  const cargoSel = cap;                         // суммарный груз выбранных кораблей
  const effVol = Math.min(cargoSel, freeCap);   // реальный объём каравана (режется свободной вместимостью)

  const row = (d, tag, isFr) => {
    const n = f[d.id] || 0;
    // Грузовые: закрепляются поштучно — доступно = владение − занятое другими путями.
    // Эскорт: ограничен числом свободных боевых (по-старому).
    const avail = isFr ? ecCvShipAvail(d.id) : d.qty;
    const canAdd = isFr ? (n < avail) : (n < d.qty && escort + 1 <= freeWar);
    const busy = isFr && avail < d.qty;   // часть закреплена другими путями
    const availTxt = busy ? `свободно ${ecNum(avail)} из ${ecNum(d.qty)}` : `в наличии ${ecNum(d.qty)}`;
    const title = isFr
      ? (n >= avail && avail < d.qty ? 'Остальные корабли этого типа закреплены за другими путями — закройте путь, чтобы освободить' : '')
      : (!canAdd && n < d.qty ? 'Свободные боевые корабли заняты конвоями/рейдами' : '');
    return `<div class="ec-q-row" style="gap:6px">
      <span class="ec-r-name">${esc(d.name)} <i style="color:var(--t4)">${tag} · ${availTxt}</i></span>
      <span class="ec-mine-step">
        <button class="ec-mine-btn" ${n <= 0 ? 'disabled' : ''} onclick="ecCvFleetAdd('${esc(d.id)}',-1)">−</button>
        <span class="ec-mine-cnt ${n ? 'on' : ''}">${n}</span>
        <button class="ec-mine-btn" ${canAdd ? '' : 'disabled'} title="${title}" onclick="ecCvFleetAdd('${esc(d.id)}',1)">+</button>
      </span></div>`;
  };
  const frHtml = freighters.length ? freighters.map(d => row(d, `📦 груз ${d.cargo}`, true)).join('')
    : '<div class="ec-empty" style="padding:6px">Нет грузовых кораблей — постройте корабль с грузовыми ангарами (Конструктор → Корабль) и заложите его в Военпроме.</div>';
  const wsHtml = warships.length ? warships.map(d => row(d, '⚔ эскорт', false)).join('')
    : '<div class="ec-empty" style="padding:6px">Нет боевых кораблей для эскорта.</div>';

  // Информационная панель о состоянии флота
  let statusLine = `<b>Флот каравана:</b> 📦 везёт <b>${ecNum(effVol)}/ход</b> · ⚔ эскорт <b>${ecNum(escort)}</b> кораблей`;
  if (cargoSel < 1) statusLine += ' — <b style="color:var(--err)">добавьте грузовой корабль, иначе объём = 0</b>';
  else if (cargoSel > freeCap) statusLine += ` <i style="color:var(--t3)">(выбранный флот тянет ${ecNum(cargoSel)}, но свободно лишь ${ecNum(freeCap)} — остальное заняли активные пути)</i>`;

  // Грузовой флот в трюме (поштучное закрепление за путями)
  const ownedShipCargo = freighters.reduce((a, d) => a + d.cargo * d.qty, 0);
  const committedMap = ecCvCommittedShips();
  let reservedShipCargo = 0;
  Object.keys(committedMap).forEach(id => { reservedShipCargo += ecCvShipCargo(id) * committedMap[id]; });
  const freeShipCargo = Math.max(0, ownedShipCargo - reservedShipCargo);

  let capacityInfo = `<div style="font-size:12px;color:var(--t3);line-height:1.6;margin:8px 0">
    <div>Грузовой флот всего: <b>${ecNum(ownedShipCargo)}</b> трюма</div>
    <div>Закреплено за активными путями: <b style="color:var(--ok)">${ecNum(reservedShipCargo)}</b></div>
    <div>Свободно к назначению: <b style="color:${freeShipCargo > 0 ? 'var(--ok)' : 'var(--err)'}">${ecNum(freeShipCargo)}</b></div>
  </div>`;

  if (isOverloaded) {
    capacityInfo = `<div style="padding:8px;margin:8px 0;background:rgba(255,100,100,.15);border-left:3px solid var(--err);border-radius:4px">
      <div style="font-weight:bold;color:var(--err)">⚠ Флот перегружен</div>
      <div style="font-size:12px;color:var(--t2);margin-top:4px">Активные пути требуют <b>${ecNum(usedCap)}/ход</b>, а флот может везти только <b>${ecNum(totalCap)}/ход</b>. Закройте один из путей, чтобы освободить вместимость.</div>
    </div>`;
  }

  return `${capacityInfo}
    <div class="ec-r-sec">📦 Грузовые — дают грузоподъёмность</div>${frHtml}
    <div class="ec-r-sec">⚔ Эскорт — защита в пути <span class="ec-hint">свободно ${ecNum(freeWar)}</span></div>${wsHtml}
    <div class="ec-trade-note${cargoSel < 1 ? ' warn' : ''}${isOverloaded ? ' warn' : ''}">${statusLine}</div>`;
}
function ecCvFleetAdd(unitId, delta) {
  EC.cvFleet = EC.cvFleet || {};
  // грузовые лимитируются свободными (не закреплёнными) кораблями; эскорт — владением
  const limit = ecCvShipCargo(unitId) > 0 ? ecCvShipAvail(unitId) : ecCvShipOwned(unitId);
  EC.cvFleet[unitId] = Math.max(0, Math.min(limit, (EC.cvFleet[unitId] || 0) + delta));
  const cont = ecId('ec-cv-fleet'); if (cont) cont.innerHTML = ecCvFleetHtml();
  ecCvSync();
}
// Шаг мастера каравана (1 Флот · 2 Ресурсы · 3 Маршрут). Состояние выбора —
// в EC.cvFleet/cvCargo/cvOrigin/cvDFac/cvDSys, поэтому переход не сбрасывает выбранное.
function ecCvStep(n) { EC.cvStep = Math.min(3, Math.max(1, n | 0)); ecPaintCabinet(); }
// Пересчитать скрытые объём/конвой из собранного флота и запаса выбранного ресурса
function ecCvSync() {
  const { escort } = ecCvFleetTotals();
  const conI = ecId('ec-cv-convoy'); if (conI) conI.value = escort;
  const cargoEl = ecId('ec-cv-cargo'); if (cargoEl) cargoEl.innerHTML = ecCvCargoHtml();   // грузоподъёмность могла измениться
  ecTradeCalc();
}
// Аллокатор груза каравана: распределяем грузоподъёмность по ресурсам ДОБЫЧИ
// Авто-распределение грузоподъёмности по выбранным месторождениям: самые ценные
// грузим первыми, каждый ресурс — его поток добычи, пока не кончится трюм.
function ecCvAllocate() {
  // объём ограничен И собранным флотом, И свободной вместимостью (что меньше)
  const cap = Math.min(ecCvFleetTotals().cap, ecCvFreeCap());
  const sel = Object.keys(EC.cvCargo || {}).filter(r => EC.cvCargo[r]);
  sel.sort((a, b) => ecResPriceN(b) - ecResPriceN(a));
  let rem = cap; const out = [];
  sel.forEach(res => {
    const vol = Math.min(ecExtractRate(res), rem);
    if (vol > 0) { out.push({ res, vol }); rem -= vol; }
  });
  return out;
}
// Выбор месторождений для каравана: тыкаешь ресурс из своей добычи — он грузится
// потоком (никаких ручных чисел, объём = добыча, капается грузоподъёмностью флота).
function ecCvCargoHtml() {
  EC.cvCargo = EC.cvCargo || {};
  const ex = ecExtractEntries();
  if (!ex.length) return '<div class="ec-empty" style="padding:6px">Нет ресурсов для каравана. Переключите добывающий завод в режим 🚚 Торговый путь (вкладка «Колонии») — караванам доступен только этот поток; склад и рынок копят/сбывают сами.</div>';
  const alloc = {}; ecCvAllocate().forEach(c => alloc[c.res] = c.vol);
  return ex.map(([n, rate]) => {
    const on = !!EC.cvCargo[n];
    const ship = alloc[n] || 0;
    const bd = on ? 'var(--gd)' : 'var(--bd,#2a3550)';
    const tail = on
      ? (ship > 0 ? `<b style="color:var(--gd)">грузим ${ecNum(ship)}${ship < rate ? ' · лимит трюма' : ''}</b>` : `<b style="color:var(--err)">${rate <= 0 ? 'поток занят' : 'трюм полон'}</b>`)
      : (rate <= 0 ? `<i style="color:var(--t4);font-style:normal">занято караванами</i>` : '');
    return `<button type="button" ${!on && rate <= 0 ? 'disabled' : ''} onclick="ecCvCargoToggle('${esc(n)}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;margin:4px 0;border-radius:8px;cursor:${!on && rate <= 0 ? 'not-allowed' : 'pointer'};border:1px solid ${bd};background:${on ? 'rgba(120,200,140,.10)' : 'transparent'};color:inherit;font:inherit;opacity:${!on && rate <= 0 ? '.55' : '1'}">
      <span style="width:18px;height:18px;flex:none;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;border:1px solid ${on ? 'var(--gd)' : 'var(--t4)'};color:${on ? 'var(--gd)' : 'var(--t4)'};font-weight:700">${on ? '✓' : '+'}</span>
      <span style="flex:1">${ecResIcon(n)} ${esc(n)} <i style="color:var(--t4);font-style:normal"> · ⛏ ${ecNum(rate)}/ход · ${ecResPriceN(n)} ГС/ед</i></span>
      ${tail}
    </button>`;
  }).join('');
}
function ecCvCargoToggle(res) {
  EC.cvCargo = EC.cvCargo || {};
  if (EC.cvCargo[res]) delete EC.cvCargo[res];
  else if (ecExtractRate(res) <= 0) return;
  else EC.cvCargo[res] = true;
  const el = ecId('ec-cv-cargo'); if (el) el.innerHTML = ecCvCargoHtml();
  ecTradeCalc();
}
// Валовый ЭКСПОРТНЫЙ поток ресурса /ход (сумма export-заводов — зеркало mine_flow до караванов).
function ecExtractRateGross(resName) {
  let total = 0;
  (EC.buildings || []).filter(ecIsMiner).forEach(b => {
    ecMineYields(b).forEach(y => {
      if (y.name !== resName || ecEffMode(b, y.name) !== 'export' || ecIsConceded(b.colony_id, y.name)) return;
      total += y.rate;
    });
  });
  return total;
}
// Поток, уже занятый исходящими караванами (зеркало economy_accrue: pending + active не в пути).
function ecCommittedExtractFlow() {
  const out = {};
  const now = Date.now();
  (EC.routes || []).forEach(r => {
    if (r.a_fid !== EC.fid) return;
    if (r.status === 'pending') { /* ожидает — резервируем, как конвой у кораблей */ }
    else if (r.status === 'active') {
      if (r.transit_until && new Date(r.transit_until).getTime() > now) return; // в пути — бэкенд поток не списывает
    } else return;
    const cargo = Array.isArray(r.cargo) && r.cargo.length ? r.cargo
      : (r.resource ? [{ res: r.resource, vol: r.volume || 0 }] : []);
    cargo.forEach(ci => {
      const res = ci.res; if (!res) return;
      out[res] = (out[res] || 0) + (+ci.vol || 0);
    });
  });
  return out;
}
// СВОБОДНЫЙ экспортный поток /ход (валовая − занятое активными/ожидающими караванами).
function ecExtractRate(resName) {
  const committed = ecCommittedExtractFlow();
  return Math.max(0, ecExtractRateGross(resName) - (committed[resName] || 0));
}
// Дипломатический коэффициент к выгоде каравана (зеркало economy_accrue)
function ecDipCoef(toFid) {
  const rel = (EC.relations || []).find(x => x.from_fid === EC.fid && x.to_fid === toFid);
  const s = rel ? (+rel.score || 0) : 0;
  return Math.max(0.8, Math.min(1.2, 1 + s / 500));
}
// Средняя скорость торгового флота (взвеш. по грузоподъёмности) — зеркало _fleet_speed
function ecFleetSpeed() {
  let wsum = 0, w = 0;
  (EC.roster || []).filter(r => r.category === 'ship').forEach(r => {
    const d = (EC.designs || []).find(x => x.id === r.unit_id);
    const cargo = (d && d.summary && +d.summary.cargo) || 0;
    const speed = (d && d.summary && +d.summary.speed) || 0;
    if (cargo > 0) { wsum += speed * cargo * (r.qty || 0); w += cargo * (r.qty || 0); }
  });
  return w > 0 ? Math.round(wsum / w) : 20;
}
// Оценка времени в пути каравана (зеркало trade_respond): дистанция/скорость
function ecTravelTurns(oSys, dSys) {
  if (!oSys || !dSys) return null;
  const adj = (EC.lanes || []).some(l => (l.a_id === oSys && l.b_id === dSys) || (l.a_id === dSys && l.b_id === oSys));
  return Math.max(1, Math.min(2, Math.ceil((adj ? 1 : 2) * 20 / Math.max(1, ecFleetSpeed()))));   // 1–2 цикла
}
// Что фракция отдаёт в ЭКСПОРТ — список для каравана (свободный поток /ход, не валовая добыча).
function ecExtractEntries() {
  const gross = {};
  (EC.buildings || []).filter(ecIsMiner).forEach(b => {
    ecMineYields(b).forEach(y => {
      if (ecEffMode(b, y.name) !== 'export' || ecIsConceded(b.colony_id, y.name)) return;
      gross[y.name] = (gross[y.name] || 0) + y.rate;
    });
  });
  const committed = ecCommittedExtractFlow();
  return Object.entries(gross)
    .map(([n, g]) => [n, Math.max(0, g - (committed[n] || 0))])
    .sort((a, b) => b[1] - a[1]);
}
function ecSyncVol(v) {
  v = Math.max(1, parseInt(v) || 1);
  const sl = ecId('ec-cv-vol-slider'), num = ecId('ec-cv-vol');
  const max = sl ? (+sl.max || v) : v; v = Math.min(v, max);
  if (sl) sl.value = v; if (num) num.value = v;
  ecTradeCalc();
}
function ecSyncConvoy(v) {
  v = Math.max(0, parseInt(v) || 0);
  const sl = ecId('ec-cv-convoy-slider'), num = ecId('ec-cv-convoy');
  const max = sl ? (+sl.max || 0) : 0; v = Math.min(v, max);
  if (sl) sl.value = v; if (num) num.value = v;
  ecTradeCalc();
}
// Живой расчёт сделки: цена, доход обеих сторон, маршрут, риск; обновляет сводку и кнопку.
function ecTradeCalc() {
  const sumEl = ecId('ec-cv-summary'); if (!sumEl) return null; // форма не на экране
  const send = ecId('ec-cv-send');
  // эскорт/маршрут берём из СОСТОЯНИЯ (EC.cvFleet + EC.cv*), а не из DOM —
  // чтобы значения не терялись при переходе между шагами мастера.
  const convoy = ecCvFleetTotals().escort;
  const oSys = ecId('ec-cv-osys')?.value || EC.cvOrigin || '';
  const dFac = ecId('ec-cv-dfac')?.value || EC.cvDFac || '';
  const dSys = ecId('ec-cv-dsys')?.value || EC.cvDSys || '';
  const cargoCap = Math.min(ecCvFleetTotals().cap, ecCvFreeCap());  // объём каравана: флот, но не больше свободной вместимости
  const dipCoef = ecDipCoef(dFac);                     // дипломатия → ±20% к выгоде
  const gcMod = ecFactionMods().gc;
  // грузы: авто-распределение грузоподъёмности по выбранным месторождениям (поток добычи)
  const cargo = ecCvAllocate();
  let alloc = 0, myInc = 0, partnerInc = 0; const dealParts = [];
  cargo.forEach(({ res, vol }) => {
    alloc += vol;
    const ship = vol;                                  // vol уже = min(добыча, остаток трюма)
    const price = ecResPriceN(res);
    myInc += Math.round(ship * price * gcMod * dipCoef);
    partnerInc += Math.round(ship * price * EC_DEST_CUT * dipCoef);
    if (ship > 0) dealParts.push(`${ecResIcon(res)} ${ecNum(ship)} ${esc(res)}`);
  });
  const anySel = Object.keys(EC.cvCargo || {}).some(r => EC.cvCargo[r]);
  // маршрут и угрозы (для расчёта риска; отсутствие пути НЕ блокирует сделку)
  const path = ecPath(oSys, dSys);
  const threats = path ? ecRouteThreats(path) : [];
  const riskPct = ecTradeRiskPct(threats, convoy);
  const hops = path ? path.length - 1 : null;
  // блокирующие ошибки
  let err = '';
  if (!dFac) err = 'Нет партнёра для торговли';
  else if (!dSys) err = 'У партнёра нет систем на карте — выберите другого';
  else if (!oSys) err = 'У вас нет систем на карте';
  else if (ecCvFleetTotals().cap <= 0) err = 'Соберите флот каравана — добавьте грузовой корабль';
  else if (ecCvFreeCap() <= 0) err = 'Нет свободной вместимости — закройте активный путь';
  else if (!anySel) err = 'Выберите месторождения для загрузки — нажмите на ресурс';
  else if (!cargo.length) err = 'Грузоподъёмности не хватает — соберите больше торговых кораблей';
  const shipsFree = (typeof ecMyShipsAvailable === 'function') ? ecMyShipsAvailable() : 0;
  const threatNames = [...new Set(threats.map(t => t.type === 'ancient' ? 'древние' : 'пираты'))].join(' / ');
  // ожидаемый доход с учётом риска грабежа — главный показатель «стоит ли оно того»
  const effMy = Math.round(myInc * (1 - riskPct / 100));

  // вердикт по риску + что делать
  let riskColor = riskPct >= 50 ? 'var(--err)' : riskPct > 0 ? 'var(--color-warning)' : 'var(--ok)';
  let riskAdvice = '';
  if (threats.length && riskPct >= 50) {
    riskAdvice = shipsFree > convoy
      ? `<div class="ec-trade-note warn">⚠ Высокий риск грабежа. Добавьте конвой (есть свободных кораблей: ${shipsFree}).</div>`
      : `<div class="ec-trade-note warn">⚠ Высокий риск, а свободных кораблей охраны нет. Постройте корабли на Корабельной Верфи или выберите более близкого/безопасного партнёра.</div>`;
  }
  const routeLine = (!dFac || !dSys || !oSys)
    ? `<div class="ec-trade-srow err">⚠ ${esc(err || 'Маршрут не задан')}</div>`
    : hops == null
      ? `<div class="ec-trade-srow"><span>Путь</span><b style="color:var(--t3)">напрямую · угрозы неизвестны</b></div>`
      : `<div class="ec-trade-srow"><span>Путь</span><b>${hops} прыжк.${threats.length ? ` · <span style="color:var(--color-warning)">${threats.length} опасн. сист. (${esc(threatNames)})</span>` : ' · <span style="color:var(--ok)">безопасно</span>'}</b></div>`;

  sumEl.innerHTML = `
    <div class="ec-trade-deal">Каждый ход: <b>${dealParts.length ? dealParts.join(' · ') : '—'}</b> → партнёру · вы <b style="color:var(--gd)">+${ecNum(myInc)} ГС</b>, партнёр <b style="color:var(--te)">+${ecNum(partnerInc)} ГС</b></div>
    <div class="ec-trade-srow"><span>Загрузка</span><b style="color:${alloc > cargoCap ? 'var(--err)' : 'var(--t2)'}">${ecNum(alloc)} / грузоподъёмность ${ecNum(cargoCap)}</b></div>
    ${routeLine}
    ${(oSys && dSys) ? `<div class="ec-trade-srow"><span>Время в пути</span><b>🚀 ${ecTravelTurns(oSys, dSys)} ход. · скорость флота ${ecFleetSpeed()}</b></div>` : ''}
    <div class="ec-trade-srow"><span>Риск грабежа / ход</span><b style="color:${riskColor}">${riskPct}%${convoy ? ` · 🛡 конвой ${convoy}` : threats.length ? ' · без охраны' : ''}</b></div>
    <div class="ec-trade-srow big"><span>Ожидаемо с учётом риска</span><b style="color:${effMy > 0 ? 'var(--gd)' : 'var(--err)'}">+${ecNum(effMy)} ГС/ход</b></div>
    <div class="ec-trade-srow"><span>Длительность</span><b style="color:var(--t3)">бессрочно — пока путь не закрыт</b></div>
    ${riskAdvice}`;
  if (send) {
    send.disabled = !!err;
    send.textContent = err ? err : `Предложить караван (+${ecNum(effMy)} ГС/ход)`;
  }
  return { convoy, oSys, dFac, dSys, threats, path, err, riskPct, cargo };
}
// Текст груза маршрута: все ресурсы мультигруза (или легаси один ресурс)
function ecRouteCargoText(r) {
  const cargo = Array.isArray(r.cargo) ? r.cargo : [];
  if (cargo.length) return cargo.map(ci => `${ecResIcon(ci.res)} ${esc(ci.res)} ×${ecNum(ci.vol)}`).join(', ');
  return `${ecResIcon(r.resource)} ${esc(r.resource || '')} ×${ecNum(r.volume)}`;
}
function ecRouteRow(r) {
  const isOrigin = r.a_fid === EC.fid;
  const other = isOrigin ? (r.b_name || ecFacName(r.b_fid)) : (r.a_name || ecFacName(r.a_fid));
  const value = (r.volume || 0) * (r.price || 0);
  // исходящий караван (продажа) учитывает бонус доктрины к ГС — как в «Казне» обзора;
  // входящий — фиксированная доля партнёра без доктрины.
  const income = isOrigin ? Math.round(value * ecFactionMods().gc) : Math.round(value * EC_DEST_CUT);
  const threats = r.threats || [];
  const riskPct = ecTradeRiskPct(threats, r.convoy);
  const riskTxt = threats.length ? `риск ${riskPct}%${r.convoy ? ` · 🛡${r.convoy}` : ' · без охраны'}` : 'безопасно';
  const verb = isOrigin ? `отправляю → ${esc(other)}` : `получаю ← ${esc(other)}`;
  const transitMs = r.transit_until ? new Date(r.transit_until).getTime() - Date.now() : 0;
  const inTransit = transitMs > 0;
  const badge = inTransit
    ? `<span class="ec-route-badge wait">🚀 в пути · прибудет ${ecFmtLeft(transitMs)}</span>`
    : `<span class="ec-route-badge ok">✓ активен</span>`;
  const incomeTxt = inTransit ? `<i style="color:var(--t3)"> · доход после прибытия</i>` : ` · <b style="color:var(--gd)">+${ecNum(income)} ГС/ход</b>`;
  // ПОТОКИ: караван может добирать недостающий объём со склада (галочка на пути)
  const storeBtn = isOrigin
    ? `<button class="btn btn-xs ${r.from_store ? 'btn-gd' : 'btn-gh'}" style="margin-left:6px"
        title="${r.from_store ? 'Недостающий объём добирается со склада — выключить' : 'Если добычи не хватает, добирать недостающее со склада'}"
        onclick="ecRouteFromStore('${r.id}',${r.from_store ? 'false' : 'true'})">📦 со склада: ${r.from_store ? 'вкл' : 'выкл'}</button>`
    : '';
  return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      ${badge}
      <b>${ecRouteCargoText(r)}</b>/ход · ${verb}${incomeTxt}
      <i style="color:${threats.length ? 'var(--color-warning)' : 'var(--ok)'}"> · ${esc(riskTxt)}</i>${storeBtn}
    </span><button class="ec-bld-del" title="Закрыть путь" onclick="ecTradeClose('${r.id}')">✕</button></div>`;
}

// ── Вкладка «Дипломатия» ────────────────────────────────────
// ── Дипломатия: таблица отношений (респект) ─────────────────
function ecRelLabel(score) {
  const s = score || 0;
  if (s >= 60)  return { t: 'Союзные',       c: 'var(--ok)' };
  if (s >= 20)  return { t: 'Дружелюбны',    c: 'var(--ok)' };
  if (s <= -60) return { t: 'Враждебны',     c: 'var(--err)' };
  if (s <= -20) return { t: 'Напряжённость', c: 'var(--err)' };
  return { t: 'Нейтральны', c: 'var(--t3)' };
}
// Двусторонний бар: от центра вправо (+, зелёный) или влево (−, красный).
function ecRelBar(score) {
  const s = Math.max(-100, Math.min(100, Math.round(score || 0)));
  const w = Math.abs(s) / 2;                       // 0..50 (% от половины трека)
  const side = s >= 0 ? 'left:50%' : 'right:50%';
  const col = s > 0 ? 'var(--ok)' : s < 0 ? 'var(--err)' : 'var(--t4)';
  return `<span class="ec-rel-bar"><span class="ec-rel-mid"></span><span class="ec-rel-fill" style="${side};width:${w}%;background:${col}"></span></span>`;
}
function ecRelationsBlock() {
  const others = ecOtherFactions();
  if (!others.length) return '<div class="ec-dip-card"><div class="ec-dip-t">Таблица отношений</div><div class="ec-empty">Нет других фракций.</div></div>';
  const relMap = new Map();
  (EC.relations || []).forEach(r => relMap.set(r.from_fid + '>' + r.to_fid, r.score));
  const cell = (score, cap) => {
    const lbl = ecRelLabel(score || 0);
    const val = (score == null) ? '—' : `${score > 0 ? '+' : ''}${score} · ${lbl.t}`;
    return `<span class="ec-rel-cell"><span class="ec-rel-cap">${cap}</span>${ecRelBar(score)}<span class="ec-rel-val" style="color:${lbl.c}">${val}</span></span>`;
  };
  const rows = others.map(f => {
    const mine = relMap.get(EC.fid + '>' + f.faction_id);
    const theirs = relMap.get(f.faction_id + '>' + EC.fid);
    return `<div class="ec-rel-row">
      <span class="ec-rel-name">${esc(f.name || ecFacName(f.faction_id))}</span>
      ${cell(mine, 'вы →')}
      ${cell(theirs, '→ вам')}
    </div>`;
  }).join('');
  return `<div class="ec-dip-card ec-rel-card"><div class="ec-dip-t">Таблица отношений <span class="ec-hint">— баллы −100..+100, копятся от реакций на ваши и чужие новости</span></div>
    <div class="ec-rel-list">${rows}</div></div>`;
}

// ── Мини-спарклайн котировки: компактный inline-SVG из ряда значений ──
// series — массив чисел (старое→новое). col — цвет линии. Возвращает '' если данных <2.
function ecSparkline(series, col, w, h) {
  const s = (series || []).map(Number).filter(v => isFinite(v));
  if (s.length < 2) return '';
  w = w || 64; h = h || 18;
  const min = Math.min(...s), max = Math.max(...s), span = (max - min) || 1;
  const stepX = w / (s.length - 1);
  const pts = s.map((v, i) => `${(i * stepX).toFixed(1)},${(h - 1 - (v - min) / span * (h - 2)).toFixed(1)}`).join(' ');
  const c = col || (s[s.length - 1] >= s[0] ? '#5fc98a' : '#e0688a');
  return `<svg class="ec-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// ── Зеркало серверной математики рынка (_market_setup.sql + _mining_market_routing.sql) ──
// Параметры берём из EC.marketCfg (живой market_config), фолбэк — дефолты _market_setup.
// Нужно только для ПРЕДПРОСМОТРА/ПРОГНОЗА в UI — деньги всё равно считает сервер.
function ecMkCfg() { return EC.marketCfg || { k: 0.45, lo: 0.25, hi: 4.0, reversion: 0.08, npc_react: 0, walk: 0 }; }
function ecMkPrice(base, stock, eq) {
  const c = ecMkCfg();
  base = base || 2; eq = Math.max(eq || 1, 1); stock = Math.max(stock || 1, 1);
  return base * Math.min(c.hi, Math.max(c.lo, Math.pow(eq / stock, c.k)));
}
// ∫ цены по запасу на [a,b] (a<b) = точная стоимость партии (площадь под кривой)
function ecMkArea(base, a, b, eq) {
  const c = ecMkCfg(), k = c.k, lo = c.lo, hi = c.hi;
  base = Math.max(base || 2, 0); eq = Math.max(eq || 1, 1); a = Math.max(a, 0); b = Math.max(b, 0);
  if (b <= a) return 0;
  const xCap = eq * Math.pow(hi, -1 / k), xFlr = eq * Math.pow(lo, -1 / k);
  let area = Math.max(0, Math.min(b, xCap) - a) * base * hi;           // потолок
  const a2 = Math.max(a, xCap), b2 = Math.min(b, xFlr);
  if (b2 > a2) area += base * Math.pow(eq, k) * (Math.pow(b2, 1 - k) - Math.pow(a2, 1 - k)) / (1 - k); // кривая
  area += Math.max(0, b - Math.max(a, xFlr)) * base * lo;              // пол
  return area;
}
// Прогноз цены на СЛЕДУЮЩИЙ ЦИКЛ (1 ход ≈ сутки), зеркало market_tick:
//   1) NPC-арбитраж: дорого (price>base) → боты вбрасывают (запас↑); дёшево → скупают (запас↓)
//   2) возврат запаса к равновесию (reversion)
// Случайный шум/шоки/сделки других игроков НЕ учтены → это ОРИЕНТИР, не гарантия.
function ecMkForecast(base, stock, eq, sup, dem) {
  const c = ecMkCfg();
  let ns = Math.max(1, stock + (base ? (ecMkPrice(base, stock, eq) / base - 1) : 0) * c.npc_react * ((sup || 0) + (dem || 0)) * 0.5);
  ns = ns + (eq - ns) * c.reversion;
  return { price: ecMkPrice(base, ns, eq), stock: ns };
}
// Прикидка чистого NPC-движения запаса за цикл (только арбитраж, без шума) — для подписи притока/оттока
function ecMkNpcNet(m) {
  const c = ecMkCfg();
  return (m.base ? (m.price / m.base - 1) : 0) * c.npc_react * ((m.sup || 0) + (m.dem || 0)) * 0.5;
}

// ── Галактический рынок (под-вкладка «Рынок»): живые цены + конечный запас ──
// Единые цены на всю галактику; продажа двигает цену вниз, покупка — вверх.
// stock — ваши складские остатки (ecResEntries): [[name, qty], ...].
function ecMarketBlock(stock) {
  const mk = EC.market || {};
  const myStock = {}; (stock || []).forEach(([n, v]) => { myStock[n] = v; });
  // показываем все рыночные ресурсы; для каждого — живая цена, тренд к базе, запас рынка, ваш остаток
  const names = Object.keys(mk).sort((a, b) => (mk[b].price || 0) - (mk[a].price || 0));
  if (!names.length) {
    return `<div class="ec-dip-card"><div class="ec-dip-t">🏪 Галактический рынок</div>
      <div class="ec-empty" style="padding:8px">⚙ Галактический рынок ещё открывается — котировки появятся, как только заработают торги.
        <details style="margin-top:7px;opacity:.55"><summary style="cursor:pointer">для администратора</summary>
          Примените <code>_market_setup.sql</code> и обновите страницу.</details></div></div>`;
  }
  const rows = names.map((n, i) => {
    const m = mk[n], rar = ecResRarity(n);
    const base = m.base || m.price || 1;
    const dpct = Math.round((m.price / base - 1) * 100);
    const trend = m.price > base * 1.02 ? `<span style="color:#e0688a">▲</span>`
      : m.price < base * 0.98 ? `<span style="color:#5fc98a">▼</span>`
        : `<span style="color:var(--t4)">▬</span>`;
    const mine = myStock[n] || 0;
    const spark = ecSparkline(m.spark);
    // прогноз цены на следующий цикл (NPC-арбитраж + возврат к равновесию)
    const fc = ecMkForecast(base, m.stock, m.eq, m.sup, m.dem);
    const fpct = Math.round((fc.price / m.price - 1) * 100);
    const fdir = fc.price > m.price * 1.01 ? '▲' : fc.price < m.price * 0.99 ? '▼' : '→';
    const fcl = fc.price > m.price * 1.01 ? '#e0688a' : fc.price < m.price * 0.99 ? '#5fc98a' : 'var(--t4)';
    // NPC-движение запаса за цикл: >0 = боты вбрасывают (цена вниз), <0 = скупают (цена вверх)
    const net = ecMkNpcNet(m);
    const netTxt = Math.abs(net) < 0.5
      ? `<span style="color:var(--t4)">НПС: рынок у равновесия</span>`
      : net > 0
        ? `<span title="дорого → боты вбрасывают запас (цена вниз)">Гал.торговля: <b style="color:#5fc98a">+${ecNum(Math.round(net))}</b> поступит ⇒ цена ↓</span>`
        : `<span title="дёшево → боты скупают запас (цена вверх)">Гал.торговля: <b style="color:#e0688a">−${ecNum(Math.round(-net))}</b> скуп ⇒ цена ↑</span>`;
    return `<div class="ec-mk-card${mine > 0 ? ' ec-mk-has' : ''}" data-rar="${esc(rar)}">
      <div class="ec-q-row ec-mk-row">
        <span class="ec-r-name ec-mk-name">${ecResIcon(n)} ${esc(n)} <i style="color:var(--t4)">(${esc(rar)})</i></span>
        <span class="ec-mk-spark" title="динамика цены за последние ходы">${spark}</span>
        <span class="ec-mk-price">${trend} <b>${ecNum(Math.round(m.price))} ГС</b> <i style="color:var(--t4)">${dpct >= 0 ? '+' : ''}${dpct}%</i></span>
        <span class="ec-mk-stock" title="запас рынка · ваш склад">📦 ${ecNum(Math.round(m.stock))} · у вас ${ecNum(mine)}</span>
      </div>
      <div class="ec-mk-tools">
        <span class="ec-mk-npc">${netTxt}
          <i class="ec-mk-fc" title="прогноз цены к началу следующего цикла — ориентир, сместят сделки игроков и шоки">🔮 след. цикл: <b style="color:${fcl}">${fdir} ~${ecNum(Math.round(fc.price))}</b> ${fpct >= 0 ? '+' : ''}${fpct}%</i></span>
        <span class="ec-mk-act">
          <span class="ec-mk-quick">
            <button class="btn btn-gh btn-xs ec-mk-qbtn" onclick="ecRowQAdd('${esc(n)}',${i},100)" title="+100 к количеству">+100</button>
            <button class="btn btn-gh btn-xs ec-mk-qbtn" onclick="ecRowQAdd('${esc(n)}',${i},1000)" title="+1000 к количеству">+1к</button>
            ${mine > 0 ? `<button class="btn btn-gh btn-xs ec-mk-qbtn" onclick="ecRowQSet('${esc(n)}',${i},${mine})" title="весь ваш склад — для быстрой продажи">склад ${ecNum(mine)}</button>` : ''}
            <button class="btn btn-gh btn-xs ec-mk-qbtn" onclick="ecRowQSet('${esc(n)}',${i},0)" title="сбросить">×</button>
          </span>
          <input type="number" id="ec-mk-q-${i}" min="1" placeholder="кол-во" class="ec-prod-qty ec-mk-q" oninput="ecRowPrev('${esc(n)}',${i})">
          <button class="btn btn-gd btn-sm" onclick="ecRowTrade('${esc(n)}','buy',${i})">Купить</button>
          <button class="btn btn-gh btn-sm" onclick="ecRowTrade('${esc(n)}','sell',${i})">Продать</button>
        </span>
        <span class="ec-mk-rowpv" id="ec-mk-pv-${i}"></span>
      </div>
    </div>`;
  }).join('');
  const form = `<div class="cn-fac-hint" style="margin-top:8px">Цена живая: продажа сбивает её, покупка — поднимает; крупная сделка двигает цену прямо по ходу исполнения (площадь под кривой — дробить на 20+10 бесполезно). Запас рынка конечен. Спред 20% (продажа — 80% цены), доктрина на спот не действует. <b>🤖 НПС/цикл</b> — куда боты-арбитражёры толкают запас за один ход; <b>🔮 след. цикл</b> — прогноз цены (ориентир). Караваны выгоднее.</div>`;
  const filters = `<div class="ec-mk-filters" role="tablist">
      <button class="ec-flt is-on" onclick="ecMkFilter(this,'all')">Все</button>
      <button class="ec-flt" onclick="ecMkFilter(this,'mine')">📦 Только моё</button>
      <button class="ec-flt" onclick="ecMkFilter(this,'common')">Обычные</button>
      <button class="ec-flt" onclick="ecMkFilter(this,'uncommon')">Редкие</button>
      <button class="ec-flt" onclick="ecMkFilter(this,'rare')">Ценные</button>
      <button class="ec-flt" onclick="ecMkFilter(this,'epic')">Эпич.</button>
      <button class="ec-flt" onclick="ecMkFilter(this,'legendary')">Легенд.</button>
    </div>`;
  return `<div class="ec-dip-card"><div class="ec-dip-t">🏪 Галактический рынок <span class="ec-hint">— единые цены на всю галактику, спрос/предложение двигают их каждый ход</span></div>${filters}<div class="ec-mk-list flt-all">${rows}</div>${form}</div>`;
}
// ── Биржа брендов УДАЛЕНА (2026-07-12): товары дематериализованы — не ресурс,
// а поток под спрос населения внутри тика (см. ecGoodsInfo / _goods_dematerialize.sql).
// Фильтр списка рынка по редкости / «только моё» (CSS-классом, без перерисовки).
function ecMkFilter(btn, mode) {
  const card = btn.closest('.ec-dip-card'); if (!card) return;
  card.querySelectorAll('.ec-mk-filters .ec-flt').forEach(b => b.classList.toggle('is-on', b === btn));
  const list = card.querySelector('.ec-mk-list');
  if (list) list.className = 'ec-mk-list flt-' + mode;
}
// Фильтр карточек ресурсов склада по редкости / «в запасе».
function ecResFilter(btn, mode) {
  const filt = btn.closest('.ec-res-filters'); if (!filt) return;
  filt.querySelectorAll('.ec-flt').forEach(b => b.classList.toggle('is-on', b === btn));
  const list = filt.parentElement.querySelector('.ec-res-cards');
  if (list) list.className = 'ec-res-cards flt-' + mode;
}

// ── Вкладка «Торговля»: рынок · караваны · обмен (бартер с кораблями) ──
// ── Вкладка «Потоки» ────────────────────────────────────────
// Единая панель управления добычей: по каждому ресурсу видно, сколько добывается,
// сколько уходит караванам / на Товарную биржу / на склад, и здесь же всё настраивается
// (режим, лимиты биржи, перелив, разовая продажа). Галочки со зданий убраны — один
// статичный набор настроек на державу (faction_res_flows, зеркало _res_flows.sql).
function ecFlowRowsData() {
  const rows = {};
  const mk = (n) => rows[n] || (rows[n] = { mine: 0, exp: 0, sto: 0, conc: 0 });
  (EC.buildings || []).filter(ecIsMiner).forEach(b => {
    ecMineYields(b).forEach(y => {
      const row = mk(y.name);
      row.mine += y.rate;
      if (ecIsConceded(b.colony_id, y.name)) row.conc += y.rate;
      else if (ecEffMode(b, y.name) === 'export') row.exp += y.rate;
      else row.sto += y.rate;
    });
  });
  // ресурсы, которых нет в добыче, но есть на складе или в настройках — тоже показываем
  Object.keys((EC.eco && EC.eco.resources) || {}).forEach(n => { if ((+EC.eco.resources[n] || 0) > 0) mk(n); });
  Object.keys(EC.resFlows || {}).forEach(n => mk(n));
  return rows;
}
function ecTabFlows() {
  const rows = ecFlowRowsData();
  const names = Object.keys(rows).sort((a, b) => ecResVal(b) - ecResVal(a));
  EC._flowRows = names;
  const store = (EC.eco && EC.eco.resources) || {};
  const committed = ecCommittedExtractFlow();
  const mCalc = ecMarketCalc();
  const marketCap = ecSlotsSum('market') * 25;
  const capStore = 1000 + ecSlotsSum('warehouse') * 500;
  const hasMarket = marketCap > 0;

  const head = `<div class="ec-q-row ec-fl-row ec-fl-head">
      <span class="ec-fl-name">Ресурс</span><span class="ec-fl-mine">⛏ Добыча/сут</span>
      <span class="ec-fl-mode">Режим</span><span class="ec-fl-cv">🚚 Караваны</span>
      <span class="ec-fl-mk">🏪 Биржа: лимит · со склада/сут</span>
      <span class="ec-fl-st">📦 Склад</span><span class="ec-fl-sell">Разовая продажа</span><span class="ec-fl-act"></span>
    </div>`;
  const list = names.map((n, i) => {
    const r = rows[n];
    const f = ecFlowCfg(n) || {};
    const mode = f.mode || '';
    const effTxt = r.exp > 0 && r.sto > 0 ? 'смешанный' : r.exp > 0 ? 'экспорт' : 'склад';
    const cvUse = Math.min(committed[n] || 0, r.exp);
    const concTxt = r.conc > 0 ? `<div style="color:var(--color-warning);font-size:11px">⚖ ${ecNum(r.conc)}/сут в концессии</div>` : '';
    const stQty = +store[n] || 0;
    return `<div class="ec-q-row ec-fl-row">
      <span class="ec-fl-name">${ecResIcon(n)} <b>${esc(n)}</b> <i style="color:var(--t4);font-style:normal">· ${ecResPriceN(n)} ГС</i>${concTxt}</span>
      <span class="ec-fl-mine" title="экспорт ${ecNum(r.exp)} · склад ${ecNum(r.sto)}"><i class="ec-fl-lb">⛏ Добыча/сут</i>${r.mine ? `+${ecNum(r.mine)}` : '<span style="color:var(--t4)">—</span>'}</span>
      <span class="ec-fl-mode"><i class="ec-fl-lb">Режим потока</i><select id="ec-fl-mode-${i}" class="ec-prod-qty" title="Куда идёт поток этого ресурса со ВСЕХ заводов">
        <option value="" ${mode === '' ? 'selected' : ''}>авто (${effTxt})</option>
        <option value="store" ${mode === 'store' ? 'selected' : ''}>📦 склад/биржа</option>
        <option value="export" ${mode === 'export' ? 'selected' : ''}>🚚 экспорт</option>
      </select></span>
      <span class="ec-fl-cv" title="Занято активными караванами"><i class="ec-fl-lb">🚚 Караваны</i>${cvUse ? `−${ecNum(cvUse)}/сут` : '<span style="color:var(--t4)">—</span>'}</span>
      <span class="ec-fl-mk"><i class="ec-fl-lb">🏪 Биржа: лимит · со склада/сут</i><span class="ec-fl-mk-in">
        <input type="number" id="ec-fl-lim-${i}" class="ec-prod-qty" min="0" placeholder="∞"
          value="${f.market_limit != null ? +f.market_limit : ''}" title="Максимум ед./сут, что биржа продаёт из потока (пусто = без лимита, 0 = не продавать)">
        <input type="number" id="ec-fl-fs-${i}" class="ec-prod-qty" min="0" placeholder="0"
          value="${+f.market_from_store > 0 ? +f.market_from_store : ''}" title="Сколько ед./сут биржа ДОБИРАЕТ со склада (0 = склад не трогать)">
      </span></span>
      <span class="ec-fl-st"><i class="ec-fl-lb">📦 На склад · запас</i><label title="Переливать остаток потока на склад (иначе — авто-продажа ×0.6)">
        <input type="checkbox" id="ec-fl-st-${i}" ${f.to_store === false ? '' : 'checked'}> ${ecNum(stQty)}</label></span>
      <span class="ec-fl-sell"><i class="ec-fl-lb">Разовая продажа со склада</i><span class="ec-fl-sell-in">
        <input type="number" id="ec-fl-sell-${i}" class="ec-prod-qty" min="1" max="${stQty}" placeholder="кол-во" ${stQty > 0 ? '' : 'disabled'}>
        <button class="btn btn-gh btn-xs" ${stQty > 0 ? '' : 'disabled'} title="${stQty > 0 ? 'Продать со склада сейчас (50–75% цены в зависимости от редкости)' : 'Склад пуст'}" onclick="ecFlowSellNow(${i})">Продать</button>
      </span></span>
      <span class="ec-fl-act"><button class="btn btn-gd btn-xs" onclick="ecFlowApply(${i})">Применить</button></span>
    </div>`;
  }).join('');

  // ── Концессии (право добычи) ──
  const myDeps = [];
  (EC.colonies || []).forEach(c => (Array.isArray(c.resources) ? c.resources : []).forEach(r => {
    if (r && r.name && !ecIsConceded(c.id, r.name)) myDeps.push({ cid: c.id, res: r.name, label: `${c.planet_name || 'колония'} · ${r.name}` });
  }));
  const facOpts = (EC.factions || []).filter(f => f.faction_id !== EC.fid)
    .map(f => `<option value="${esc(f.faction_id)}">${esc(f.name)}</option>`).join('');
  const depOpts = myDeps.map(dp => `<option value="${esc(dp.cid)}|${esc(dp.res)}">${esc(dp.label)}</option>`).join('');
  const given = (EC.concessions || []).filter(c => c.from_fid === EC.fid);
  const got = (EC.concessions || []).filter(c => c.to_fid === EC.fid);
  // v5: концессии — механика КОРПОРАЦИЙ, сгруппированы ПО КОЛОНИЯМ (системам).
  // Одна ячейка на колонию: планета · система · залежи · слоты СТРОКОЙ (как в
  // науке). Слоты: 1 бесплатный вне ячеек + 1 корпоративный (2500 ГС) +
  // 2 выкупных у владельца (4000 ГС + аренда 150 ГС/сут). Макс 4 домика.
  const concColStat = (cid) => {
    const slots = (EC.concSlots || []).filter(s => s.colony_id === cid && s.fid === EC.fid);
    const bld = (EC.buildings || []).filter(b => b.colony_id === cid).length;   // мои постройки на чужой колонии = только концессионные
    const pend = (EC.projects || []).filter(p => p.kind === 'build' && p.colony_id === cid).length;
    return { slots, bld, pend, used: bld + pend, cap: 1 + slots.length,
             extra: slots.filter(s => s.kind === 'extra').length,
             lease: slots.filter(s => s.kind === 'lease').length };
  };
  const concPlace = (cid, fallbackFid) => {
    const i = (EC.concInfo || {})[cid] || {};
    const p = esc(i.planet_name || 'колония'), s = i.system_name ? ` · сист. ${esc(i.system_name)}` : '';
    return `🪐 <b>${p}</b>${s}${fallbackFid ? ` · ${esc(ecFacName(fallbackFid))}` : ''}`;
  };
  // Ячейка колонии-концессии: всё в одной — место, залежи, слоты, покупка
  const concColCell = (cid, list, mine) => {
    const st = concColStat(cid);
    const rows = list.map(c => {
      const cRar = ecResRarity(c.res_name);
      const bt = cRar === 'common' ? 'mining' : (cRar === 'epic' || cRar === 'legendary') ? 'mining_exotic' : 'mining_deep';
      let act = '';
      if (!mine) {
        const myTier = (EC.buildings || []).filter(b => b.colony_id === cid && (EC_MINE_TIERS[b.btype] || []).includes(cRar)).length;
        act = st.used < st.cap
          ? `<button class="btn btn-gd btn-xs" title="Построить ${esc(EC_BUILD[bt].name)} (готов через сутки; ячейки владельца не занимает)" onclick="ecConcBuild('${c.id}','${bt}')">🏗 ${ecNum(ecBuildCost(EC_BUILD[bt].cost))} ГС</button>`
          : (myTier ? `<span class="ec-hint">✓ добывается</span>` : `<span class="ec-hint">нет свободных слотов</span>`);
      }
      return `<div class="ec-q-row"><span class="ec-r-name">${ecResIcon(c.res_name)} <b>${esc(c.res_name)}</b> <span class="ec-hint">(${ecRarLabel(cRar)})</span></span>${act}
        <button class="ec-bld-del" title="${mine ? 'Отозвать право добычи (домики получателя снесутся, ½ цены ему вернётся)' : 'Отказаться от концессии (мои домики там снесутся, ½ цены вернётся)'}" onclick="ecConcRevoke('${c.id}')">✕</button></div>`;
    }).join('');
    // слоты СТРОКОЙ (как слоты исследований): ▰ занят, ▱ свободен
    let slotLine;
    if (mine) {
      const rent = (EC.concSlots || []).filter(s => s.colony_id === cid && s.kind === 'lease')
        .reduce((a, s) => a + (+s.rent || 0), 0);
      slotLine = rent ? `<div class="ec-hint">🤝 продано слотов: аренда <b>+${ecNum(rent)} ГС/сут</b> в казну</div>` : '';
    } else {
      const parts = [`1 базовый`];
      parts.push(st.extra >= 1 ? '+1 корпоративный ✓'
        : `<a href="#" title="Корпорация докупает 1 слот вне ячеек планеты (деньги сгорают)" onclick="ecConcSlotBuy('${cid}','extra');return false">докупить корпоративный · 2 500 ГС</a>`);
      parts.push(st.lease > 0 ? `+${st.lease} у владельца ✓${st.lease < 2 ? ` · <a href="#" title="Выкупить ещё слот у владельца: 4 000 ГС ему сразу + аренда 150 ГС/сут" onclick="ecConcSlotBuy('${cid}','lease');return false">ещё · 4 000 ГС</a>` : ''}`
        : `<a href="#" title="Выкупить слот у владельца колонии: 4 000 ГС ему сразу + аренда 150 ГС/сут (макс 2)" onclick="ecConcSlotBuy('${cid}','lease');return false">выкупить у владельца · 4 000 ГС + 150/сут</a>`);
      const rent = st.slots.filter(s => s.kind === 'lease').reduce((a, s) => a + (+s.rent || 0), 0);
      if (rent) parts.push(`аренда −${ecNum(rent)} ГС/сут`);
      if (st.pend) parts.push(`⏳ строится: ${st.pend}`);
      slotLine = `<div class="ec-hint">Слоты: ${'▰'.repeat(Math.min(st.used, st.cap))}${'▱'.repeat(Math.max(0, st.cap - st.used))} <b>${st.used}/${st.cap}</b> · ${parts.join(' · ')}</div>`;
    }
    return `<div class="ec-conc-col" style="margin:6px 0 10px"><div class="ec-hint">${concPlace(cid, mine ? list[0].to_fid : list[0].from_fid)}</div>${rows}${slotLine}</div>`;
  };
  const concGroup = (arr, mine) => [...new Set(arr.map(c => c.colony_id))]
    .map(cid => concColCell(cid, arr.filter(c => c.colony_id === cid), mine)).join('');
  const concHtml = `<div class="ec-r-sec" style="margin-top:18px">⚖ Концессии — право добычи</div>
    <div class="ec-hint" style="margin:4px 0 8px">Право добычи конкретной залежи можно передать другой державе: колония остаётся у вас, а получатель <b>строит на ней СВОЙ добывающий домик нужного яруса</b> (кнопка появится у него в этом блоке) и добывает залежь как свою — слоты от его населения, поток в его «Потоки». Без построенного домика концессия <b>ничего не даёт</b>. Домик занимает ячейку вашей колонии; ваши заводы отданную залежь не копают. При отзыве/отказе домики получателя сносятся с возвратом ½ цены.</div>
    ${myDeps.length ? `<div class="ec-prod-form ec-conc-form">
      <select id="ec-conc-dep" class="ec-prod-qty">${depOpts}</select>
      <select id="ec-conc-fac" class="ec-prod-qty">${facOpts}</select>
      <button class="btn btn-gd btn-sm" onclick="ecConcGrant()">Передать право добычи</button>
    </div>` : '<div class="ec-hint">Нет свободных залежей для передачи.</div>'}
    ${given.length ? `<div class="ec-r-sec">Отдано мной</div>${concGroup(given, true)}` : ''}
    ${got.length ? `<div class="ec-r-sec">Получено мной</div>${concGroup(got, false)}` : ''}`;

  const flowsBody = `${ecIntro('🔀', 'Потоки ресурсов',
    'Одна панель на державу: что добывается, что уходит караванам, что продаёт Товарная биржа и что копится на складе. Настройки действуют на ресурс ЦЕЛИКОМ (по всем заводам) и перекрывают режимы зданий.',
    [`Биржа сбывает до <b>${ecNum(marketCap)}</b> ед./сут (слоты Товарной биржи × 25); прогноз выручки: <b>+${ecNum(mCalc.gc)} ГС/сут</b>.`,
     `Ёмкость склада: <b>${ecNum(capStore)}</b> ед. на ресурс (1000 + слоты Склада × 500).`,
     'Лимит биржи «0» = ресурс не продаётся вовсе; «со склада/сут» &gt; 0 — биржа добирает из запаса.',
     'Разовая продажа сбывает запас со склада сразу (50–75% цены, Товарная биржа не нужна).',
     'Караваны берут только из экспортного потока; галочка «📦 со склада» на пути (под-вкладка «Караваны») разрешает добирать из запаса.'])}
    ${names.length ? head + list : '<div class="ec-hint">Нет добычи и запасов — постройте Добывающий завод и назначьте месторождения.</div>'}
    ${concHtml}`;

  // ── Под-вкладки: Потоки + вся торговля (караваны/рынок/обмен) в одном месте ──
  const sub = EC.flowSub || 'flows';
  const subTabs = [['flows', '🔀', 'Потоки'], ['caravans', '🚛', 'Караваны'], ['market', '🏪', 'Рынок'], ['barter', '🤝', 'Обмен']];
  const subNav = `<div class="ec-tabs" style="margin:4px 0 12px">${subTabs.map(([id, ic, l]) => `<button class="ec-tab${sub === id ? ' on' : ''}" onclick="ecSetFlowSub('${id}')"><span class="ec-tab-ic">${ic}</span><span class="ec-tab-l">${l}</span></button>`).join('')}</div>`;
  const body = sub === 'flows' ? `<div class="ec-flows-tab">${flowsBody}</div>`
    : `<div class="ec-trade-tab">${ecTradeSubBody(sub)}</div>`;
  return `<div class="ec-flowx">${subNav}${body}</div>`;
}
function ecSetFlowSub(s) { EC.flowSub = s; ecPaintCabinet(); }
async function ecFlowApply(i) {
  const n = (EC._flowRows || [])[i]; if (!n) return;
  const mode = ecId(`ec-fl-mode-${i}`)?.value || null;
  const limRaw = (ecId(`ec-fl-lim-${i}`)?.value ?? '').trim();
  const lim = limRaw === '' ? null : Math.max(0, +limRaw || 0);
  const fs = Math.max(0, +(ecId(`ec-fl-fs-${i}`)?.value || 0) || 0);
  const toStore = !!ecId(`ec-fl-st-${i}`)?.checked;
  ecRpcAct('res_flow_set', { p_res: n, p_mode: mode, p_market_limit: lim, p_market_from_store: fs, p_to_store: toStore },
    `Поток «${n}» настроен`);
}
function ecFlowSellNow(i) {
  const n = (EC._flowRows || [])[i]; if (!n) return;
  const qty = Math.max(0, parseInt(ecId(`ec-fl-sell-${i}`)?.value) || 0);
  if (!qty) { toast('Укажите количество', 'err'); return; }
  ecRpcAct('res_sell_now', { p_res: n, p_qty: qty }, `Продано со склада: ${ecNum(qty)} ${n}`);
}
function ecRouteFromStore(id, on) {
  ecRpcAct('trade_route_from_store', { p_id: id, p_on: !!on },
    on ? 'Караван будет добирать недостающее со склада' : 'Караван берёт только из добычи');
}
function ecConcGrant() {
  const dep = ecId('ec-conc-dep')?.value || '', fac = ecId('ec-conc-fac')?.value || '';
  const [cid, res] = dep.split('|');
  if (!cid || !res) { toast('Выберите залежь', 'err'); return; }
  if (!fac) { toast('Выберите фракцию', 'err'); return; }
  ecRpcAct('concession_grant', { p_colony: cid, p_res: res, p_to_fid: fac }, 'Право добычи передано');
}
function ecConcRevoke(id) {
  if (!confirm('Прекратить концессию? Добывающие домики получателя на этой колонии снесутся (½ цены вернётся ему), залежь вернётся владельцу.')) return;
  ecRpcAct('concession_revoke', { p_id: id }, 'Концессия прекращена');
}
// Построить свой добывающий домик на чужой колонии по концессии (concession_build).
// Требует корпорацию (механика корпораций) — сервер вернёт понятную ошибку.
function ecConcBuild(concId, btype) {
  const cost = ecBuildCost((EC_BUILD[btype] || {}).cost || 0);
  if ((EC.eco.gc || 0) < cost) { toast('Не хватает ГС: нужно ' + ecNum(cost), 'err'); return; }
  ecRpcAct('concession_build', { p_conc: concId, p_btype: btype }, 'Стройка начата — домик будет готов через сутки');
}
// Купить слот концессионера: extra = вне ячеек за счёт корпорации, lease = выкуп у владельца + аренда.
function ecConcSlotBuy(colonyId, kind) {
  const price = kind === 'extra' ? 2500 : 4000;
  if ((EC.eco.gc || 0) < price) { toast('Не хватает ГС: нужно ' + ecNum(price), 'err'); return; }
  if (!confirm(kind === 'extra'
    ? 'Докупить 1 слот вне ячеек планеты за 2 500 ГС? (деньги сгорают, слот навсегда за корпорацией)'
    : 'Выкупить слот у владельца колонии? 4 000 ГС ему сразу + аренда 150 ГС/сут, пока концессия жива.')) return;
  ecRpcAct('concession_slot_buy', { p_colony: colonyId, p_kind: kind },
    kind === 'extra' ? 'Слот корпорации докуплен' : 'Слот выкуплен у владельца — аренда 150 ГС/сут');
}

// Тело торговой под-вкладки («Караваны»/«Рынок»/«Обмен») — рендерится внутри
// вкладки «Торговля и потоки» (ecTabFlows). Бывшая отдельная вкладка «Торговля».
function ecTradeSubBody(sub) {
  const others = ecOtherFactions(), noOthers = !others.length;
  const tradeCap = ecSlotsSum('trade');
  const used = EC.routes.filter(r => r.a_fid === EC.fid && ['pending', 'active'].includes(r.status)).length;
  const incoming = EC.routes.filter(r => r.b_fid === EC.fid && r.status === 'pending');
  const active = EC.routes.filter(r => r.status === 'active' && (r.a_fid === EC.fid || r.b_fid === EC.fid));
  const pendingOut = EC.routes.filter(r => r.a_fid === EC.fid && r.status === 'pending');
  const stock = ecResEntries();
  const mySys = (EC.allSystems || []).filter(s => s.faction === EC.fid);
  const ships = ecMyShipsAvailable();
  const cargo = EC.tradeCargo || { total: 0, used: 0, free: 0 };   // грузоподъёмность торгового флота
  const volMax = Math.max(1, Math.min(stock.length ? stock[0][1] : 1, cargo.free || 0));

  const resBlock = ecMarketBlock(stock);

  const barterBlock = ecBarterBlock(others, noOthers, stock);

  const destFac0 = others[0] && others[0].faction_id;
  const destSys0 = (EC.allSystems || []).filter(s => s.faction === destFac0);
  // Чип-выбор ресурса каравана — из вашей ДОБЫЧИ (поток), не со склада
  const extractEntries = ecExtractEntries();
  const resChips = extractEntries.map(([n, v], i) => {
    const rar = ecResRarity(n);
    return `<button type="button" class="ec-trade-res ec-rar-${rar}${i === 0 ? ' on' : ''}" data-res="${esc(n)}" onclick="ecPickTradeRes(this)">
      <span class="ec-trade-res-ic">${ecResIcon(n)}</span><span class="ec-trade-res-n">${esc(n)}</span>
      <span class="ec-trade-res-meta">⛏ ${ecNum(v)}/ход · ${ecResPriceN(n)} ГС/ед</span></button>`;
  }).join('');
  const caravanForm = (tradeCap < 1) ? '<div class="ec-empty">Нужен Торговый хаб (вкладка «Колонии») — он открывает торговые пути.</div>'
    : noOthers ? '<div class="ec-empty">Нет других фракций для торговли.</div>'
      : !mySys.length ? '<div class="ec-empty">Нет ваших систем на карте — расширяйтесь (вкладка «Территория»).</div>'
        : !extractEntries.length ? '<div class="ec-empty">Нет ресурсов для каравана. Поставьте добывающий завод в режим 🚚 Торговый путь (вкладка «Колонии») — караван возит только этот поток, склад и рынок идут своими каналами.</div>'
          : (() => {
        // ── ПОШАГОВЫЙ МАСТЕР: 1) Флот+эскорт → 2) Ресурсы → 3) Кому/куда ──
        const step = EC.cvStep = Math.min(3, Math.max(1, EC.cvStep || 1));
        if (!EC.cvOrigin || !mySys.find(s => s.id === EC.cvOrigin)) EC.cvOrigin = mySys[0] && mySys[0].id;
        if (!EC.cvDFac || !others.find(f => f.faction_id === EC.cvDFac)) EC.cvDFac = others[0] && others[0].faction_id;
        const destList = (EC.allSystems || []).filter(s => s.faction === EC.cvDFac);
        if (!EC.cvDSys || !destList.find(s => s.id === EC.cvDSys)) EC.cvDSys = destList[0] ? destList[0].id : '';
        const labels = ['Флот', 'Ресурсы', 'Маршрут'];
        const stepNav = `<div class="ec-cv-steps">${[1, 2, 3].map(n => `<button class="ec-cv-stepbtn${step === n ? ' on' : ''}${step > n ? ' done' : ''}" onclick="ecCvStep(${n})"><span class="ec-cv-stepn">${step > n ? '✓' : n}</span>${labels[n - 1]}</button>${n < 3 ? '<span class="ec-cv-steparr">›</span>' : ''}`).join('')}</div>`;
        let body;
        if (step === 1) {
          body = `<div class="ec-trade-label">Соберите флот каравана <span class="ec-hint">грузовые → грузоподъёмность · эскорт опционален</span></div>
            <div id="ec-cv-fleet">${ecCvFleetHtml()}</div>
            <div class="ec-cv-nav"><span></span><button class="btn btn-gd" onclick="ecCvStep(2)">Далее: ресурсы →</button></div>`;
        } else if (step === 2) {
          body = `<div class="ec-trade-label">Что грузим <span class="ec-hint">тыкните месторождения — флот грузит их поток, ценные первыми</span></div>
            <div id="ec-cv-cargo">${ecCvCargoHtml()}</div>
            <div class="ec-cv-nav"><button class="btn btn-gh" onclick="ecCvStep(1)">← Флот</button><button class="btn btn-gd" onclick="ecCvStep(3)">Далее: маршрут →</button></div>`;
        } else {
          body = `<div class="ec-trade-label">Кому и куда <span class="ec-hint">чужие системы на пути = угрозы по дороге</span></div>
            <div class="ec-trade-route">
              <select id="ec-cv-osys" onchange="EC.cvOrigin=this.value;ecTradeCalc()" title="Из вашей системы отправления">${mySys.map(s => `<option value="${esc(s.id)}"${s.id === EC.cvOrigin ? ' selected' : ''}>🜨 ${esc(s.name)}</option>`).join('')}</select>
              <span class="ec-trade-arrow">→</span>
              <select id="ec-cv-dfac" onchange="EC.cvDFac=this.value;EC.cvDSys='';ecFillDestSys();EC.cvDSys=ecId('ec-cv-dsys')?.value||'';ecTradeCalc()" title="Партнёр-получатель">${others.map(f => `<option value="${esc(f.faction_id)}"${f.faction_id === EC.cvDFac ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
              <select id="ec-cv-dsys" onchange="EC.cvDSys=this.value;ecTradeCalc()" title="В систему партнёра">${destList.map(s => `<option value="${esc(s.id)}"${s.id === EC.cvDSys ? ' selected' : ''}>${esc(s.name)}</option>`).join('') || '<option value="">— нет систем —</option>'}</select>
            </div>
            <div class="ec-trade-summary" id="ec-cv-summary"></div>
            <div class="ec-cv-nav"><button class="btn btn-gh" onclick="ecCvStep(2)">← Ресурсы</button><button class="btn btn-gd" id="ec-cv-send" onclick="ecTradePropose()">Предложить караван</button></div>`;
        }
        return `<div class="ec-trade-form">
          <div class="ec-trade-how">
            <b>Как это работает:</b> караван — постоянное торговое соглашение. После того как партнёр <b>примет</b>, <b>каждый ход</b> ваш караван возит вашу <b>экспортную добычу</b> (режим 💱 Экспорт на заводе) и <b>оба получаете ГС</b>. Путь бессрочный, пока не закроете.
          </div>
          ${stepNav}${body}
        </div>`;
      })();
  const inHtml = incoming.map(r => { const value = (r.volume || 0) * (r.price || 0); return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge new">предложение</span>
      <b>${esc(r.a_name || ecFacName(r.a_fid))}</b> предлагает слать вам <b>${ecRouteCargoText(r)}</b>/ход · вы получите <b style="color:var(--gd)">+${ecNum(Math.round(value * EC_DEST_CUT))} ГС/ход</b> (бессрочно)
    </span><button class="btn btn-gd btn-xs" title="Согласиться — путь станет активным" onclick="ecTradeRespond('${r.id}',true)">Принять</button><button class="ec-bld-del" title="Отклонить" onclick="ecTradeRespond('${r.id}',false)">✕</button></div>`; }).join('');
  const outHtml = pendingOut.map(r => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge wait">⏳ ждёт ответа</span>
      <b>${ecRouteCargoText(r)}</b>/ход → <b>${esc(r.b_name || ecFacName(r.b_fid))}</b> · начнёт приносить доход после принятия
    </span><button class="ec-bld-del" title="Отозвать предложение" onclick="ecTradeClose('${r.id}')">✕</button></div>`).join('');
  const caravanBlock = `<div class="ec-dip-card ec-dip-trade"><div class="ec-dip-t">Торговые караваны <span class="ec-hint">пути: ${used}/${tradeCap}</span></div>
      ${caravanForm}
      ${incoming.length ? `<div class="ec-r-sec">Входящие предложения</div>${inHtml}` : ''}
      ${active.length ? `<div class="ec-r-sec">Активные пути</div>${active.map(ecRouteRow).join('')}` : ''}
      ${pendingOut.length ? `<div class="ec-r-sec">Отправленные</div>${outHtml}` : ''}</div>`;

  const subBody = sub === 'market' ? resBlock
    : sub === 'barter' ? `${barterBlock}<div class="ec-section-title">Технологии и чертежи</div>${ecTechMarketBlock()}`
      : caravanBlock;
  return `${ecIntro('⇄', 'Торговля', 'Превращайте ресурсы в ГС и обменивайтесь активами с другими фракциями.', ['<b>Караваны</b> — постоянные пути (поток добычи к партнёру, доход каждый ход). <b>Рынок</b> — продать со склада за 80%. <b>Обмен</b> — подарки/сделки и биржа техов и чертежей.'])}${subBody}`;
}
function ecSetTradeSub(s) { EC.flowSub = s; ecPaintCabinet(); }   // легаси: старые ссылки на под-вкладки торговли

// ── Вкладка «Биржа»: финансовые инструменты поверх рынка ресурсов ──
// Срез 2: индекс рынка / ETF. Под-вкладки-заготовки под облигации/акции/фьючерсы
// добавятся срезами 3–5 по тому же образцу (EC.exSub + ecSetExSub).
function ecSetExSub(s) { EC.exSub = s; ecPaintCabinet(); }
// Перебалансированы и снова открыты (_exchange_safeguards.sql): mark-цена против
// манипуляций, пул дома против печати ГС, плечо ≤×2, лимиты ставки. Ничего не закрыто.
const EC_EX_CLOSED = {};
function ecTabExchange() {
  let sub = EC.exSub || 'corps';
  if (EC_EX_CLOSED[sub]) sub = 'corps';   // не залипаем на закрытой вкладке
  const subTabs = [['corps', '🏢', 'Организации'], ['orders', '📋', 'Заказы'],
    ['margin', '📈', 'Маржа'], ['futures', '📅', 'Фьючерсы'], ['options', '🎲', 'Опционы'], ['bonds', '🏛', 'Облигации']];
  const subNav = `<div class="ec-tabs" style="margin:4px 0 12px">${subTabs.map(([id, ic, l]) =>
    EC_EX_CLOSED[id]
      ? `<button class="ec-tab" disabled title="На реконструкции" style="opacity:.45;cursor:not-allowed"><span class="ec-tab-ic">🔒</span><span class="ec-tab-l">${l}</span></button>`
      : `<button class="ec-tab${sub === id ? ' on' : ''}" onclick="ecSetExSub('${id}')"><span class="ec-tab-ic">${ic}</span><span class="ec-tab-l">${l}</span></button>`
  ).join('')}</div>`;
  const closedBanner = `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;margin:0 0 12px;border:1px solid #2f6b46;border-radius:8px;background:rgba(95,201,138,.10);color:#9fe0b6;font-size:13px;line-height:1.5">🛡 <span><b>Честные торги.</b> Деривативы считаются по <b>официальному биржевому курсу</b>, который <b>Биржевой совет</b> пересчитывает <b>раз в 3 часа</b> — <b>ваши сделки на курс не влияют</b>, накрутить цену под свою ставку нельзя. <b>Палата</b> берёт небольшую <b>комиссию</b> с каждой ставки, а выигрыши выплачивает из <b>своего резерва</b> (он наполняется проигрышами и комиссиями, кредиты из воздуха не печатаются), плечо до <b>×2</b>.</span></div>`;
  const body = sub === 'orders' ? ecExOrdersBlock()
    : sub === 'margin' ? ecExMarginBlock()
    : sub === 'futures' ? ecExFuturesBlock()
    : sub === 'options' ? ecExOptionsBlock()
    : sub === 'bonds' ? ecExBondsBlock()
    : ecExCorpsBlock();
  const ses = (EC.corps && EC.corps.session) || { open: false, open_hour: 12, close_hour: 18 };
  const sesTag = ses.open
    ? `<b style="color:#5fc98a">● торги открыты</b> до ${ses.close_hour}:00 UTC`
    : `<b style="color:#e0688a">● торги закрыты</b> · открытие в ${ses.open_hour}:00 UTC`;
  return `${ecIntro('📊', 'Биржа', `Финансовые инструменты, привязанные к реальной экономике галактики. ${sesTag}.`, ['<b>Организации</b> — объедините реальные постройки; вместе они дают <b>синергию</b> (+3% дохода за постройку, до +30%). Доли продаются другим фракциям.', '<b>Спрос отраслей</b> — доход и котировки двигает сама галактика: дефицит сырья поднимает рудники, очередь кораблей — верфи, торговые пути — хабы (множитель 0.25×…3.0×).', '<b>Облигации</b> — займ под купон. Сделки с долями — только при <b>открытых торгах</b>; на закрытии фиксинг и дивиденды.', '<b>Маржа</b> — лонг/шорт с плечом до ×2 (ликвидация при просадке залога). <b>Фьючерсы</b> — срочные контракты с расчётом по экспирации. <b>Опционы</b> — колл/пут за премию. Расчёт идёт по <b>официальному курсу</b> (его пересчитывает Биржевой совет раз в 3 часа, а не ваши сделки; курс двигают дефициты ресурсов и события-новости) с <b>комиссией палаты</b>; выигрыши — из резерва палаты. Спот-торговля ресурсами — во вкладке «Торговля и потоки → Рынок».', '<b>Заказы</b> — разместите госзаказ на закупку ресурса (деньги блокируются в <b>эскроу</b>); заказ объявляется в ленте сектора, и любая фракция выполняет его из своих запасов — полностью или частями. Гарантированная оплата из эскроу.'])}${subNav}${closedBanner}${body}`;
}

// Карточка индекса рынка / ETF: значение, тренд, спарклайн, моя позиция, формы.
function ecExIndexBlock() {
  const ex = EC.exchange || {};
  const idx = ex.index || { value: 1000, base: 1000, spark: [] };
  const hold = ex.holdings || { units: 0, basis: 0 };
  const val = +idx.value || 1000, base = +idx.base || 1000;
  const dpct = Math.round((val / base - 1) * 100);
  const up = val >= base;
  const trend = val > base * 1.005 ? `<span style="color:#5fc98a">▲</span>`
    : val < base * 0.995 ? `<span style="color:#e0688a">▼</span>`
      : `<span style="color:var(--t4)">▬</span>`;
  const spark = ecSparkline(idx.spark, up ? '#5fc98a' : '#e0688a', 220, 56);
  const spread = +ex.spread || 0.005;    // комиссия дома по индексу (доля на сторону)
  const units = +hold.units || 0, basis = +hold.basis || 0;
  const posVal = units * val * (1 - spread);  // во что реально продастся (за вычетом комиссии)
  const pl = posVal - basis;             // нереализованный P/L (как если продать сейчас)
  const plPct = basis > 0 ? Math.round(pl / basis * 100) : 0;
  const plCol = pl >= 0 ? 'var(--gd)' : 'var(--err)';
  const gc = (EC.eco && EC.eco.gc) || 0;

  const posCard = units > 0.0001
    ? `<div class="ec-q-row" style="flex-wrap:wrap;gap:12px;margin-top:8px">
        <span class="ec-r-name" style="flex:1 1 100%">Моя позиция</span>
        <span>Паёв: <b>${units.toFixed(3)}</b></span>
        <span>Вложено: <b>${ecNum(Math.round(basis))} ГС</b></span>
        <span title="за вычетом комиссии дома ${(spread * 100).toFixed(1)}%">Продастся за: <b>${ecNum(Math.round(posVal))} ГС</b></span>
        <span>Прибыль: <b style="color:${plCol}">${pl >= 0 ? '+' : ''}${ecNum(Math.round(pl))} ГС (${plPct >= 0 ? '+' : ''}${plPct}%)</b></span>
      </div>
      <div class="cn-fac-hint" style="margin-top:4px">Старт с минуса — это комиссия дома (${(spread * 100).toFixed(1)}% на сторону). Курс обновляется <b>каждые ~10 минут</b>: позиция уйдёт в плюс, когда индекс подрастёт выше комиссии.</div>`
    : `<div class="cn-fac-hint" style="margin-top:8px">Позиции нет. Купите паи на ГС — они подорожают, если корзина курсов вырастет. Учтите комиссию дома ${(spread * 100).toFixed(1)}% и то, что индекс пересчитывается каждые ~10 минут.</div>`;

  const form = `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px;margin-top:8px">
      <input type="number" id="ec-ix-gc" min="1" placeholder="вложить ГС" class="ec-prod-qty">
      <button class="btn btn-gd btn-sm" onclick="ecIndexBuy()">Купить паи</button>
      <input type="number" id="ec-ix-units" min="0" step="0.001" placeholder="продать паёв" class="ec-prod-qty">
      <button class="btn btn-gh btn-sm" onclick="ecIndexSell()">Продать</button>
      ${units > 0.0001 ? `<button class="btn btn-gh btn-sm" onclick="ecIndexSellAll()" title="Продать всю позицию">Всё</button>` : ''}
    </div>
    <div class="cn-fac-hint" style="margin-top:5px">1 пай ≈ значение индекса (${ecNum(Math.round(val))} ГС), покупка/продажа с комиссией ${(spread * 100).toFixed(1)}%. В казне: ${ecNum(Math.round(gc))} ГС.</div>`;

  return `<div class="ec-dip-card">
    <div class="ec-dip-t">📊 Индекс рынка <span class="ec-hint">— корзина официальных курсов ресурсов (база = 1000) · обновляется каждые ~10 минут</span></div>
    <div class="ec-q-row" style="align-items:center;gap:14px">
      <span style="font-size:26px;font-weight:700">${trend} ${ecNum(Math.round(val))}</span>
      <span style="color:${up ? '#5fc98a' : '#e0688a'}">${dpct >= 0 ? '+' : ''}${dpct}% к базе</span>
      <span style="flex:1 1 auto;text-align:right">${spark}</span>
    </div>
    ${posCard}
    ${form}
  </div>`;
}

// ── Общая карточка «инструмент недоступен» (RPC не ответил → SQL не применён) ──
// Игроку — внутриигровой текст; техническая подсказка скрыта под спойлером для админа.
function ecDerivNA(title, file) {
  return `<div class="ec-dip-card ec-corp-warn">
    <div class="ec-dip-t">${title} — зал на профилактике</div>
    <div class="cn-fac-hint">⚙ Этот зал биржи временно закрыт на техническое обслуживание. Биржевой совет уже работает над возобновлением торгов — загляните чуть позже.
      <details style="margin-top:7px;opacity:.55"><summary style="cursor:pointer">для администратора</summary>
        <span style="word-break:break-word">Примените <code>${file}</code>, затем <code>notify pgrst, 'reload schema';</code> и обновите страницу.</span></details>
    </div>
  </div>`;
}
// Бейдж стороны позиции
function ecSideBadge(side) {
  return side === 'long'
    ? `<span class="ec-route-badge" style="background:#2f6b46">▲ ЛОНГ</span>`
    : `<span class="ec-route-badge" style="background:#7a2f44">▼ ШОРТ</span>`;
}
const ecPlCol = v => (+v >= 0 ? 'var(--gd)' : 'var(--err)');
const ecSign  = v => (+v >= 0 ? '+' : '');
const ecDays  = iso => { const ms = new Date(iso) - Date.now(); return ms <= 0 ? 0 : Math.ceil(ms / 86400000); };
// Официальный биржевой курс ресурса (на нём считаются деривативы): последняя
// точка истории market_price_history = ref_price; фолбэк — спотовая цена статуса.
function ecRefPx(r) {
  const sp = (EC.market && EC.market[r.name] && EC.market[r.name].spark) || [];
  const last = sp.length ? +sp[sp.length - 1] : NaN;
  return Number.isFinite(last) && last > 0 ? last : (+r.price || 0);
}

// ── Доска котировок: живая цена + %Δ к базе + мини-график по ресурсам.
//    Спарклайны берутся из market_price_history (EC.market[name].spark, грузится
//    в exchange_status). Сортировка — по величине движения (крупнейшие сверху),
//    чтобы трейдер сразу видел, что взлетело/упало. Это «график» под деривативы.
function ecDerivPriceBoard(resources, limit) {
  const mk = EC.market || {};
  const list = (resources || []).map(r => {
    const px = ecRefPx(r), base = +r.base || 0;   // официальный курс, не спот
    return { name: r.name, px, base, dpct: base > 0 ? (px / base - 1) * 100 : 0 };
  }).sort((a, b) => Math.abs(b.dpct) - Math.abs(a.dpct)).slice(0, limit || 999);
  if (!list.length) return '';
  const rows = list.map(r => {
    const up = r.px >= r.base, d = Math.round(r.dpct);
    const trend = r.px > r.base * 1.01 ? `<span style="color:#5fc98a">▲</span>`
      : r.px < r.base * 0.99 ? `<span style="color:#e0688a">▼</span>` : `<span style="color:var(--t4)">▬</span>`;
    const spark = ecSparkline((mk[r.name] && mk[r.name].spark) || [], up ? '#5fc98a' : '#e0688a', 96, 26);
    return `<div class="ec-q-row" style="gap:10px;align-items:center">
        <span class="ec-r-name" style="flex:1 1 36%">${esc(r.name)}</span>
        <span style="flex:0 0 auto;min-width:120px;text-align:right">${trend} <b>${ecNum(r.px)}</b> ГС <span style="color:${up ? '#5fc98a' : '#e0688a'}">${ecSign(d)}${d}%</span></span>
        <span style="flex:0 0 auto">${spark}</span>
      </div>`;
  }).join('');
  return `<div class="ec-dip-card">
      <div class="ec-dip-t">📉 Котировки <span class="ec-hint">— официальный курс всех ресурсов и динамика (крупнейшие движения сверху, обновление раз в 3 часа); на этом вы и зарабатываете</span></div>
      ${rows}
    </div>`;
}

// ── Объяснение инструмента простыми словами (разворачивающийся блок) ──
// Цель: игрок без биржевого опыта понимает суть и риск на конкретном примере.
function ecDerivHelp(kind) {
  const g = 'color:var(--gd)', e = 'color:var(--err)';
  const wrap = (title, body) => `<div class="ec-dip-card" style="border-left:3px solid var(--gd)">
      <details open><summary style="cursor:pointer;font-weight:600;font-size:15px">📖 ${title} <span class="ec-hint">— простыми словами</span></summary>
        <div style="margin-top:10px;line-height:1.65">${body}</div>
      </details>
    </div>`;
  if (kind === 'margin') return wrap('Что такое маржа: лонг и шорт', `
    <p style="margin:0 0 8px"><b>Суть:</b> ты ставишь деньги на то, что цена ресурса <b style="${g}">вырастет</b> (ставка «лонг») или <b style="${e}">упадёт</b> (ставка «шорт»). Сам ресурс при этом не покупаешь — это чистая ставка на движение цены, выигрыш/проигрыш приходит деньгами (ГС).</p>
    <p style="margin:0 0 8px"><b>Плечо</b> — множитель ставки. Вносишь <b>залог</b> 1000 ГС с плечом <b>×5</b> — играешь так, будто вложил 5000.</p>
    <p style="margin:0 0 8px"><b>Пример (лонг на рост):</b> Платина стоит 70 ГС. Залог 1000, плечо ×5 (ставка как на 5000 ГС). Цена выросла на 10% → <b style="${g}">+500 ГС</b> (10% от 5000, а не от 1000). Упала на 10% → <b style="${e}">−500 ГС</b>. <b>Шорт</b> — всё наоборот: зарабатываешь на падении.</p>
    <p style="margin:0"><b>⚠ Главный риск — ликвидация:</b> если цена пойдёт против тебя слишком далеко (до «цены ликвидации», она написана в карточке позиции), биржа закроет позицию сама и <b style="${e}">весь залог сгорит</b>. Чем больше плечо — тем ближе ликвидация: ×10 «вылетает» уже при движении против тебя на ~9–10%.</p>`);
  if (kind === 'futures') return wrap('Что такое фьючерс', `
    <p style="margin:0 0 8px"><b>Суть:</b> то же, что маржа (ставка на цену с плечом, лонг или шорт), но у контракта есть <b>дата экспирации</b> — день, когда он закроется и рассчитается сам.</p>
    <p style="margin:0 0 8px"><b>Пример:</b> думаешь, Дейтерий (65 ГС) подорожает за 2 недели. Берёшь фьючерс-<b style="${g}">лонг</b> на 14 дней, залог 2000, плечо ×4 (ставка как на 8000). Через 14 дней контракт сам рассчитается по цене того дня: вырос на 8% → <b style="${g}">+640 ГС</b>. Можно закрыть и раньше кнопкой «Закрыть».</p>
    <p style="margin:0 0 8px"><b>Что за «контанго»:</b> вход во фьючерс чуть дороже текущей цены — надбавка за срок. К дате расчёта она тает. Поэтому если цена просто стоит на месте, лонг теряет эту небольшую надбавку (а шорт — наоборот зарабатывает).</p>
    <p style="margin:0"><b>⚠ Риск:</b> то же плечо и та же <b style="${e}">ликвидация</b>, что в марже, плюс жёсткая дата, когда позиция закроется в любом случае.</p>`);
  if (kind === 'options') return wrap('Что такое опцион: колл и пут', `
    <p style="margin:0 0 8px"><b>Суть:</b> ты покупаешь <b>право</b> (не обязанность). Платишь «<b>премию</b>» — как цену билета. Угадал направление — получаешь выплату; не угадал — теряешь <b>только премию</b>, и больше ничего.</p>
    <p style="margin:0 0 8px"><b style="${g}">КОЛЛ</b> = ставка на рост, <b style="${e}">ПУТ</b> = ставка на падение. <b>Страйк</b> — цена-порог, от которой считается выигрыш.</p>
    <p style="margin:0 0 8px"><b>Пример (колл на рост):</b> Гелий-3 стоит 80 ГС. Покупаешь КОЛЛ со страйком 80 на 100 контрактов, премия например 600 ГС. Цена выросла до 100 → выплата (100−80)×100 = 2000 ГС, минус 600 премии = <b style="${g}">+1400 ГС</b>. Цена осталась ≤80 → опцион сгорает, потерял <b style="${e}">только 600</b>.</p>
    <p style="margin:0"><b>Чем лучше маржи:</b> убыток ограничен премией — тебя не ликвидируют. <b>Чем хуже:</b> если не угадал, премия сгорает целиком. В срок опцион исполняется сам; можно и продать досрочно.</p>`);
  if (kind === 'bonds') return wrap('Что такое облигации', `
    <p style="margin:0 0 8px"><b>Суть:</b> это долг. Два режима — ты можешь <b>давать в долг</b> или <b>занимать</b>.</p>
    <p style="margin:0 0 8px"><b>Ты инвестор (даёшь в долг):</b> покупаешь облигации другой державы. Каждый ход получаешь проценты («<b>купон</b>»), а в конце срока тебе возвращают «<b>номинал</b>» (вложенное).</p>
    <p style="margin:0 0 8px"><b>Пример:</b> держава выпустила облигации по 1000 ГС, купон 1%/ход, срок 14 дней. Купил 10 штук = дал 10 000 ГС. Каждый ход <b style="${g}">+100 ГС</b> купона, через 14 дней вернут 10 000. Итого ~<b style="${g}">+1400 ГС</b> за срок.</p>
    <p style="margin:0 0 8px"><b>Ты эмитент (занимаешь):</b> сам выпускаешь облигации — получаешь ГС сразу, но каждый ход платишь купон держателям и гасишь номинал в срок.</p>
    <p style="margin:0"><b>⚠ Риск (для инвестора):</b> если у эмитента кончатся ГС на выплату — <b style="${e}">дефолт</b>: купоны прекращаются и номинал не вернут. Высокий купон обычно значит и выше риск дефолта.</p>`);
  return '';
}

// ── Панель «правил биржи»: лимиты карточками + объяснение защиты человеческим
//    языком (без биржевого жаргона). Общая для Маржи и Фьючерсов.
function ecExRules(d) {
  const maxLev = +d.max_lev || 2, maxColl = +d.max_coll || 100000, maxOpen = +d.max_open || 6;
  const house = +d.house || 0;
  const chip = (ic, label, val) => `<span style="display:inline-flex;align-items:center;gap:8px;padding:7px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:9px">
      <span style="font-size:16px">${ic}</span>
      <span style="display:inline-flex;flex-direction:column;line-height:1.2">
        <span style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--t4)">${label}</span>
        <b style="font-size:13px">${val}</b>
      </span></span>`;
  return `<div class="ec-dip-card" style="border-left:3px solid #c9a227">
      <div class="ec-dip-t">🛡 Правила торговой палаты <span class="ec-hint">— чтобы никто не сорвал состояние из воздуха</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 12px">
        ${d.max_lev ? chip('⚖️', 'Множитель ставки', `до ×${maxLev}`) : ''}
        ${chip('💰', 'Ставка на сделку', `до ${ecNum(maxColl)} ГС`)}
        ${chip('🏛️', 'Доля казны', 'не больше ¼')}
        ${chip('📑', 'Сделок разом', `до ${maxOpen}`)}
        ${house ? chip('🏦', 'Резерв палаты', `${ecNum(Math.round(house))} ГС`) : ''}
      </div>
      <div style="line-height:1.65;font-size:13px;color:var(--t2)">
        <p style="margin:0 0 7px">📊 <b>Сделки считаются по официальному биржевому курсу</b>, который <b>Биржевой совет</b> пересчитывает <b>раз в 3 часа</b> — не ваши сделки. Поэтому скупить или обвалить ресурс, чтобы качнуть цену под свою ставку, <b>невозможно в принципе</b>: курс живёт отдельно от рынка.</p>
        <p style="margin:0 0 7px">📈 <b>Курс трендит и реагирует на реальные события сектора</b> — удар Длани/МЗА (планета стёрта → дефицит → цены вверх), тайные операции и конфликты (нестабильность → вверх), дефолты по облигациям (вниз), рост фракций и союзы (спрос). Плюс <b>настрой по новостям</b>: много 👎-реакций игроков → рынок проседает, 👍 → растёт. Навык = прочитать ленту и поймать движение с плечом.</p>
        <p style="margin:0 0 7px">💸 <b>Палата берёт небольшую комиссию</b> на входе (≈0.5%) — позиция стартует с лёгкого минуса, как разница покупки/продажи на настоящей бирже. Так палата держится в плюсе, а не печатает кредиты.</p>
        <p style="margin:0">🏦 <b>Выигрыши палата платит из своего резерва</b>, а он наполняется проигрышами и комиссиями. Палата <b>не печатает кредиты из воздуха</b> — сколько внесено, столько и можно выплатить, не больше.</p>
      </div>
    </div>`;
}

// ── Маржа (под-вкладка «Маржа»): лонги/шорты с плечом, cash-settled ──
function ecExMarginBlock() {
  const d = EC.margin;
  if (!d) return ecDerivNA('📈 Маржинальная торговля', '_exchange_margin.sql');
  const maxLev = +d.max_lev || 2, mm = +d.mm || 0.05;
  const house = +d.house || 0;
  const opens = d.open || [], hist = d.history || [];
  const totPnl = opens.reduce((a, p) => a + (+p.pnl || 0), 0);
  const totColl = opens.reduce((a, p) => a + (+p.collateral || 0), 0);

  const openRows = opens.map(p => {
    const px = +p.price || 0, liq = +p.liq || 0, pnl = +p.pnl || 0;
    const near = p.side === 'long' ? px <= liq * 1.05 : px >= liq * 0.95;
    const pnlPct = p.collateral > 0 ? Math.round(pnl / p.collateral * 100) : 0;
    return `<div class="ec-q-row" style="flex-wrap:wrap;gap:8px;align-items:center">
        <span class="ec-r-name" style="flex:1 1 40%">${ecSideBadge(p.side)} <b>${esc(p.resource)}</b> ×${(+p.leverage).toFixed(0)} · ${ecNum(p.size)} ед.</span>
        <span>курс входа ${ecNum(p.entry)} → сейчас <b>${ecNum(px)}</b></span>
        <span title="курс принудительного закрытия" style="color:${near ? 'var(--err)' : 'var(--t4)'}">⚠ закроют при ${ecNum(liq)}</span>
        <span>прибыль <b style="color:${ecPlCol(pnl)}">${ecSign(pnl)}${ecNum(pnl)} ГС (${ecSign(pnlPct)}${pnlPct}%)</b></span>
        <button class="btn btn-gh btn-sm" onclick="ecMarginClose('${p.id}')">Закрыть</button>
      </div>`;
  }).join('') || '<div class="cn-fac-hint">Открытых ставок нет.</div>';

  const histRows = hist.map(p => `<div class="ec-q-row" style="flex-wrap:wrap;gap:8px">
      <span class="ec-r-name" style="flex:1 1 45%">${p.status === 'liquidated' ? '<span class="ec-route-badge" style="background:var(--err)">принуд. закрытие</span>' : '<span class="ec-route-badge">закрыто</span>'} ${ecSideBadge(p.side)} <b>${esc(p.resource)}</b> ×${(+p.leverage).toFixed(0)}</span>
      <span>курс ${ecNum(p.entry)} → ${ecNum(p.exit)}</span>
      <span>итог <b style="color:${ecPlCol(p.realized)}">${ecSign(p.realized)}${ecNum(Math.round(p.realized))} ГС</b></span>
    </div>`).join('') || '<div class="cn-fac-hint">История пуста.</div>';

  const opts = (d.resources || []).map(r => `<option value="${esc(r.name)}">${esc(r.name)} · ${ecNum(ecRefPx(r))} ГС</option>`).join('');
  const form = `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px;margin-top:6px">
      <select id="ec-mg-res" class="ec-prod-qty" style="max-width:180px">${opts}</select>
      <input type="number" id="ec-mg-coll" min="100" placeholder="залог ГС" class="ec-prod-qty" style="max-width:120px">
      <input type="number" id="ec-mg-lev" min="1" max="${maxLev}" placeholder="плечо 1–${maxLev}" class="ec-prod-qty" style="max-width:120px">
      <button class="btn btn-gd btn-sm" onclick="ecMarginOpen('long')">▲ Лонг</button>
      <button class="btn btn-gh btn-sm" onclick="ecMarginOpen('short')">▼ Шорт</button>
    </div>
    <div class="cn-fac-hint" style="margin-top:5px">Объём сделки = залог × множитель. Прибыль и убыток тоже множатся. Если курс развернётся против тебя и съест почти весь залог — сделку закроют принудительно, и <b>залог сгорит</b>.</div>`;

  return `${ecDerivHelp('margin')}${ecExRules(d)}${ecDerivPriceBoard(d.resources)}
    <div class="ec-dip-card">
      <div class="ec-dip-t">📈 Мои ставки на цену <span class="ec-hint">— заработок на движении курса ресурса, множитель до ×${maxLev}</span></div>
      ${opens.length ? `<div class="ec-q-row" style="gap:14px;flex-wrap:wrap"><span>Открыто: <b>${opens.length}</b></span><span>Залог в деле: <b>${ecNum(Math.round(totColl))} ГС</b></span><span>Текущая прибыль: <b style="color:${ecPlCol(totPnl)}">${ecSign(totPnl)}${ecNum(Math.round(totPnl))} ГС</b></span></div>` : ''}
      ${openRows}
      ${form}
    </div>
    <div class="ec-dip-card">
      <div class="ec-dip-t">История сделок</div>
      ${histRows}
    </div>`;
}

// ── Фьючерсы (под-вкладка «Фьючерсы»): срочные контракты с экспирацией ──
function ecExFuturesBlock() {
  const d = EC.futures;
  if (!d) return ecDerivNA('📅 Фьючерсы', '_exchange_futures.sql');
  const maxLev = +d.max_lev || 2;
  const house = +d.house || 0;
  const opens = d.open || [], hist = d.history || [];

  const openRows = opens.map(p => {
    const px = +p.price || 0, liq = +p.liq || 0, pnl = +p.pnl || 0;
    const near = p.side === 'long' ? px <= liq * 1.05 : px >= liq * 0.95;
    return `<div class="ec-q-row" style="flex-wrap:wrap;gap:8px;align-items:center">
        <span class="ec-r-name" style="flex:1 1 38%">${ecSideBadge(p.side)} <b>${esc(p.resource)}</b> ×${(+p.leverage).toFixed(0)} · до расчёта ${ecDays(p.expires_at)} дн</span>
        <span>курс контракта ${ecNum(p.entry)} → сейчас <b>${ecNum(px)}</b></span>
        <span style="color:${near ? 'var(--err)' : 'var(--t4)'}">⚠ закроют при ${ecNum(liq)}</span>
        <span>прибыль <b style="color:${ecPlCol(pnl)}">${ecSign(pnl)}${ecNum(pnl)} ГС</b></span>
        <button class="btn btn-gh btn-sm" onclick="ecFuturesClose('${p.id}')">Закрыть</button>
      </div>`;
  }).join('') || '<div class="cn-fac-hint">Открытых контрактов нет.</div>';

  const histRows = hist.map(p => `<div class="ec-q-row" style="flex-wrap:wrap;gap:8px">
      <span class="ec-r-name" style="flex:1 1 45%">${p.status === 'liquidated' ? '<span class="ec-route-badge" style="background:var(--err)">принуд. закрытие</span>' : p.status === 'settled' ? '<span class="ec-route-badge">срок вышел</span>' : '<span class="ec-route-badge">закрыто</span>'} ${ecSideBadge(p.side)} <b>${esc(p.resource)}</b> ×${(+p.leverage).toFixed(0)}</span>
      <span>курс ${ecNum(p.entry)} → ${ecNum(p.exit)}</span>
      <span>итог <b style="color:${ecPlCol(p.realized)}">${ecSign(p.realized)}${ecNum(Math.round(p.realized))} ГС</b></span>
    </div>`).join('') || '<div class="cn-fac-hint">История пуста.</div>';

  const opts = (d.resources || []).map(r => `<option value="${esc(r.name)}">${esc(r.name)} · ${ecNum(ecRefPx(r))} ГС</option>`).join('');
  const form = `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px;margin-top:6px">
      <select id="ec-ft-res" class="ec-prod-qty" style="max-width:170px">${opts}</select>
      <input type="number" id="ec-ft-coll" min="100" placeholder="залог ГС" class="ec-prod-qty" style="max-width:110px">
      <input type="number" id="ec-ft-lev" min="1" max="${maxLev}" placeholder="плечо" class="ec-prod-qty" style="max-width:90px">
      <input type="number" id="ec-ft-term" min="1" max="90" placeholder="срок, дней" class="ec-prod-qty" style="max-width:120px">
      <button class="btn btn-gd btn-sm" onclick="ecFuturesOpen('long')">▲ Лонг</button>
      <button class="btn btn-gh btn-sm" onclick="ecFuturesOpen('short')">▼ Шорт</button>
    </div>
    <div class="cn-fac-hint" style="margin-top:5px">Вход — по курсу контракта (биржевой курс + небольшая надбавка за срок). В назначенный день контракт закроется сам по биржевому курсу того дня. Если курс развернётся против тебя раньше срока — закроют принудительно, залог сгорит.</div>`;

  return `${ecDerivHelp('futures')}${ecExRules(d)}${ecDerivPriceBoard(d.resources)}
    <div class="ec-dip-card">
      <div class="ec-dip-t">📅 Срочные контракты <span class="ec-hint">— ставка на цену ресурса с назначенным днём расчёта</span></div>
      ${openRows}
      ${form}
    </div>
    <div class="ec-dip-card">
      <div class="ec-dip-t">История контрактов</div>
      ${histRows}
    </div>`;
}

// ── Опционы (под-вкладка «Опционы»): колл/пут за премию ──
function ecExOptionsBlock() {
  const d = EC.options;
  if (!d) return ecDerivNA('🎲 Опционы', '_exchange_options.sql');
  const opens = d.open || [], hist = d.history || [];

  const openRows = opens.map(p => {
    const val = +p.value || 0, paid = +p.premium_paid || 0, pl = val - paid;
    return `<div class="ec-q-row" style="flex-wrap:wrap;gap:8px;align-items:center">
        <span class="ec-r-name" style="flex:1 1 40%"><span class="ec-route-badge" style="background:${p.kind === 'call' ? '#2f6b46' : '#7a2f44'}">${p.kind === 'call' ? 'КОЛЛ' : 'ПУТ'}</span> <b>${esc(p.resource)}</b> страйк ${ecNum(p.strike)} · ${ecNum(p.contracts)} к. · ${ecDays(p.expires_at)} дн</span>
        <span>курс <b>${ecNum(p.spot)}</b> · в плюсе на ${ecNum(p.intrinsic)}</span>
        <span>сейчас стоит ${ecNum(val)} / отдал ${ecNum(paid)}</span>
        <span>прибыль <b style="color:${ecPlCol(pl)}">${ecSign(pl)}${ecNum(Math.round(pl))} ГС</b></span>
        <button class="btn btn-gh btn-sm" onclick="ecOptionsClose('${p.id}')" title="Продать досрочно по текущей стоимости">Продать</button>
      </div>`;
  }).join('') || '<div class="cn-fac-hint">Открытых опционов нет.</div>';

  const histRows = hist.map(p => `<div class="ec-q-row" style="flex-wrap:wrap;gap:8px">
      <span class="ec-r-name" style="flex:1 1 45%">${p.status === 'exercised' ? '<span class="ec-route-badge" style="background:#2f6b46">исполнен</span>' : p.status === 'expired' ? '<span class="ec-route-badge" style="background:var(--err)">сгорел</span>' : '<span class="ec-route-badge">продан</span>'} ${p.kind === 'call' ? 'КОЛЛ' : 'ПУТ'} <b>${esc(p.resource)}</b> страйк ${ecNum(p.strike)}</span>
      <span>премия ${ecNum(Math.round(p.premium_paid))} · выплата ${ecNum(Math.round(p.payout))}</span>
      <span>итог <b style="color:${ecPlCol(p.realized)}">${ecSign(p.realized)}${ecNum(Math.round(p.realized))} ГС</b></span>
    </div>`).join('') || '<div class="cn-fac-hint">История пуста.</div>';

  const opts = (d.resources || []).map(r => `<option value="${esc(r.name)}" data-px="${ecRefPx(r)}">${esc(r.name)} · ${ecNum(ecRefPx(r))} ГС</option>`).join('');
  const form = `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px;margin-top:6px">
      <select id="ec-op-res" class="ec-prod-qty" style="max-width:170px" onchange="ecOptionsPreview()">${opts}</select>
      <select id="ec-op-kind" class="ec-prod-qty" style="max-width:100px" onchange="ecOptionsPreview()"><option value="call">КОЛЛ ▲</option><option value="put">ПУТ ▼</option></select>
      <input type="number" id="ec-op-strike" min="0.01" step="0.01" placeholder="страйк" class="ec-prod-qty" style="max-width:100px" oninput="ecOptionsPreview()">
      <input type="number" id="ec-op-ct" min="1" placeholder="контрактов" class="ec-prod-qty" style="max-width:110px" oninput="ecOptionsPreview()">
      <input type="number" id="ec-op-term" min="1" max="90" placeholder="срок, дней" class="ec-prod-qty" style="max-width:110px" oninput="ecOptionsPreview()">
      <button class="btn btn-gd btn-sm" onclick="ecOptionsBuy()">Купить</button>
    </div>
    <div class="cn-fac-hint" id="ec-op-prev" style="margin-top:5px">Колл выигрывает при росте выше страйка, пут — при падении ниже. Премия — это максимум, что можно потерять; в срок опцион сам исполняется по биржевому курсу.</div>`;

  return `${ecDerivHelp('options')}${ecExRules(d)}${ecDerivPriceBoard(d.resources)}
    <div class="ec-dip-card">
      <div class="ec-dip-t">🎲 Опционы <span class="ec-hint">— право на выплату по страйку за уплаченную премию</span></div>
      ${openRows}
      ${form}
    </div>
    <div class="ec-dip-card">
      <div class="ec-dip-t">История опционов</div>
      ${histRows}
    </div>`;
}

// ── Облигации (под-вкладка «Облигации»): рынок чужих бумаг + выпуск + позиции ──
// Купон в б.п./сутки от номинала; в срок эмитент гасит номинал. Дефолт = риск.
function ecExBondsBlock() {
  const b = EC.bonds || { issuer: [], holdings: [], market: [] };
  const daysLeft = iso => { const ms = new Date(iso) - Date.now(); return ms <= 0 ? 0 : Math.ceil(ms / 86400000); };
  const pct = bps => (bps / 100).toFixed(bps % 100 ? 2 : 0);   // б.п. → %
  const statusTag = s => s === 'open' ? '' : s === 'redeemed' ? '<span class="ec-route-badge">погашен</span>'
    : s === 'default' ? '<span class="ec-route-badge" style="background:var(--err)">дефолт</span>'
      : '<span class="ec-route-badge">снят</span>';

  // Рынок: чужие открытые выпуски — купить
  const market = (b.market || []).map(i => `<div class="ec-q-row" style="flex-wrap:wrap;gap:8px">
      <span class="ec-r-name" style="flex:1 1 50%"><b>${esc(i.issuer_name || '—')}</b> · номинал ${ecNum(Math.round(i.face))} ГС · купон <b style="color:var(--gd)">${pct(i.coupon_bps)}%/ход</b> · до погашения ${daysLeft(i.matures_at)} дн · доступно ${ecNum(i.units_left)}</span>
      <input type="number" id="ec-bd-buy-${i.id}" min="1" max="${i.units_left}" placeholder="шт" class="ec-prod-qty" style="max-width:90px">
      <button class="btn btn-gd btn-sm" onclick="ecBondBuy('${i.id}')">Купить</button>
    </div>`).join('') || '<div class="cn-fac-hint">Нет чужих выпусков в продаже.</div>';

  // Мои держания
  const holds = (b.holdings || []).map(h => `<div class="ec-q-row" style="flex-wrap:wrap;gap:10px">
      <span class="ec-r-name" style="flex:1 1 50%">${statusTag(h.status)} <b>${esc(h.issuer_name || '—')}</b> · ${ecNum(h.units)} шт × ${ecNum(Math.round(h.face))} = <b>${ecNum(Math.round(h.value))} ГС</b></span>
      <span style="color:var(--t4)">купон +${ecNum(Math.round(h.daily_coupon))} ГС/ход${h.status === 'open' ? ` · погашение через ${daysLeft(h.matures_at)} дн` : ''}</span>
    </div>`).join('') || '<div class="cn-fac-hint">Вы не держите чужих облигаций.</div>';

  // Мои выпуски
  const mine = (b.issuer || []).map(i => `<div class="ec-q-row" style="flex-wrap:wrap;gap:10px">
      <span class="ec-r-name" style="flex:1 1 50%">${statusTag(i.status)} номинал ${ecNum(Math.round(i.face))} · купон ${pct(i.coupon_bps)}%/ход · размещено ${ecNum(i.units_sold)}/${ecNum(i.units_total)}${i.status === 'open' ? ` · срок ${daysLeft(i.matures_at)} дн` : ''}</span>
      <span style="color:${i.daily_coupon ? 'var(--err)' : 'var(--t4)'}">${i.daily_coupon ? `−${ecNum(Math.round(i.daily_coupon))} ГС/ход` : 'выплат нет'}</span>
      ${i.status === 'open' && i.units_sold === 0 ? `<button class="ec-bld-del" title="Снять выпуск" onclick="ecBondCancel('${i.id}')">✕</button>` : ''}
    </div>`).join('') || '<div class="cn-fac-hint">У вас нет выпусков.</div>';

  const issueForm = `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px;margin-top:6px">
      <input type="number" id="ec-bd-face" min="1" placeholder="номинал ГС" class="ec-prod-qty" style="max-width:120px">
      <input type="number" id="ec-bd-units" min="1" placeholder="кол-во бумаг" class="ec-prod-qty" style="max-width:120px">
      <input type="number" id="ec-bd-coupon" min="0.01" max="10" step="0.01" placeholder="купон %/ход" class="ec-prod-qty" style="max-width:120px">
      <input type="number" id="ec-bd-term" min="1" max="120" placeholder="срок, дней" class="ec-prod-qty" style="max-width:120px">
      <button class="btn btn-gd btn-sm" onclick="ecBondIssue()">Выпустить</button>
    </div>
    <div class="cn-fac-hint" style="margin-top:5px">Инвесторы покупают бумаги — их ГС идут вам сразу. Каждый ход платите купон держателям, в срок гасите номинал. Не хватит ГС на выплату → <b style="color:var(--err)">дефолт</b> (репутация и доверие падают).</div>`;

  return `${ecDerivHelp('bonds')}<div class="ec-dip-card">
      <div class="ec-dip-t">🏛 Рынок облигаций <span class="ec-hint">— занимайте ГС под купон или вкладывайтесь в чужой долг</span></div>
      ${market}
    </div>
    <div class="ec-dip-card">
      <div class="ec-dip-t">Мои вложения в облигации</div>
      ${holds}
    </div>
    <div class="ec-dip-card">
      <div class="ec-dip-t">Мои выпуски <span class="ec-hint">— заём под мой долг</span></div>
      ${mine}
      ${issueForm}
    </div>`;
}

// ── Корпорации (под-вкладка «Корпорации»): организации из реальных построек ──
// Доход вложенных построек уходит акционерам дивидендами на закрытии торгов.
// Доли продаются через стакан, покупка — только при открытых торгах.
const ecBldIcon = bt => (typeof EC_BLD_ICON !== 'undefined' && EC_BLD_ICON[bt]) || '◈';
const ecBldNm = bt => (typeof ecBuildName === 'function' ? ecBuildName(bt) : bt);

// Шкала секторного спроса: множитель 0.25×…3.0× (нейтраль 1.0 = треть шкалы).
function ecDemandBar(mult) {
  const m = +mult || 1;
  const pct = Math.max(2, Math.min(100, (m / 3) * 100));     // 0..3× → 0..100%
  const col = m > 1.05 ? '#5fc98a' : m < 0.95 ? '#e0688a' : 'var(--t4)';
  const arrow = m > 1.05 ? '▲' : m < 0.95 ? '▼' : '▬';
  return `<span class="ec-dem-bar"><span class="ec-dem-fill" style="width:${pct}%;background:${col}"></span><span class="ec-dem-mark"></span></span>
    <span class="ec-dem-val" style="color:${col}">${arrow} ${m.toFixed(2)}×</span>`;
}
// Инфографика: множители спроса по всем отраслям (привязка к реальной галактике).
function ecDemandPanel(dem) {
  if (!dem) return '';
  const rows = [
    ['mining', '⛏', 'Рудники', 'чем меньше сырья на рынке — тем выше'],
    ['factory', '🏭', 'Фабрики', 'растёт с уровнем цен на рынке'],
    ['shipyard', '🚀', 'Верфи', 'растёт с очередью постройки кораблей'],
    ['military_factory', '⚙', 'Военпром', 'растёт с очередью дивизий и авиации'],
    ['trade', '💱', 'Торг. хабы', 'растёт с числом активных торговых путей'],
    ['temple', '🛐', 'Храмы', 'растёт с охватом веры в галактике'],
  ];
  const body = rows.map(([k, ic, nm, sub]) => `<div class="ec-dem-row" title="${sub}">
      <span class="ec-dem-nm">${ic} ${nm}</span>${ecDemandBar(dem[k])}</div>`).join('');
  return `<div class="ec-dip-card">
    <div class="ec-dip-t">📊 Секторный спрос <span class="ec-hint">— реальная галактика крутит доход и котировки (0.25×…3.0×, отметка = норма)</span></div>
    ${body}</div>`;
}
// ── Биржа: заказы (госзаказы / RFQ — твёрдые заявки на закупку с эскроу) ──────
// Заказчик блокирует ГС в эскроу; заказ виден на доске и в ленте сектора; любая
// фракция выполняет из своих запасов (полностью/частями), оплата из эскроу.
const EC_ORD_STATUS = { open: '● открыт', filled: '✅ выполнен', cancelled: '✕ отменён', expired: '⌛ истёк' };
function ecExOrdersBlock() {
  const o = EC.orders;
  if (!o) return ecDerivNA('📋 Биржа заказов', '_exchange_orders.sql');
  const gc = (EC.eco && EC.eco.gc) || 0;
  const mine = o.mine || [], board = o.board || [];

  // справочник имён ресурсов (рынок + мой склад) для подсказок ввода
  const names = new Set(Object.keys(EC.market || {}));
  ecResEntries().forEach(([n]) => names.add(n));
  const datalist = `<datalist id="ec-ord-reslist">${Array.from(names).sort().map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;

  // ── Форма размещения заказа ──
  const createCard = `<div class="ec-dip-card">
      <div class="ec-dip-t">📋 Разместить заказ <span class="ec-hint">— твёрдая заявка на закупку; сумма блокируется в эскроу</span></div>
      <div class="ec-prod-form" style="flex-wrap:wrap;gap:6px">
        <input list="ec-ord-reslist" id="ec-ord-res" placeholder="ресурс (напр. Дилитий)" class="ec-prod-qty" style="min-width:160px" oninput="ecOrderCalc()">${datalist}
        <input type="number" id="ec-ord-qty" min="1" placeholder="объём, ед." class="ec-prod-qty" oninput="ecOrderCalc()">
        <input type="number" id="ec-ord-price" min="1" placeholder="цена ГС/ед." class="ec-prod-qty" oninput="ecOrderCalc()">
        <input type="number" id="ec-ord-days" min="1" max="60" value="7" title="срок жизни заказа, суток" class="ec-prod-qty" style="max-width:90px">
        <button class="btn btn-gd btn-sm" onclick="ecOrderCreate()">Разместить</button>
      </div>
      <input type="text" id="ec-ord-note" maxlength="120" placeholder="комментарий к заказу (необязательно)" class="ec-corp-name-in" style="margin-top:6px">
      <div class="cn-fac-hint" style="margin-top:5px" id="ec-ord-summary">Укажите ресурс, объём и цену. В казне: <b>${ecNum(Math.round(gc))} ГС</b>.</div>
    </div>`;

  // ── Мои заказы ──
  const mineRows = mine.map(r => {
    const open = r.status === 'open';
    const prog = r.qty_total > 0 ? Math.round(r.qty_filled / r.qty_total * 100) : 0;
    const stCol = open ? 'var(--ok)' : r.status === 'filled' ? 'var(--gd)' : 'var(--t4)';
    const exp = open && r.expires_at ? ` · истекает через ${ecDays(r.expires_at)} сут` : '';
    return `<div class="ec-corp-listed" style="flex-wrap:wrap;gap:6px">
        <span style="flex:1 1 60%">📦 <b>${esc(r.resource)}</b> — ${ecNum(r.qty_filled)}/${ecNum(r.qty_total)} ед. (${prog}%) по <b>${ecNum(Math.round(r.price))} ГС</b>
          <span style="color:${stCol}">· ${EC_ORD_STATUS[r.status] || r.status}</span>${exp}
          ${r.note ? `<br><span class="ec-hint">«${esc(r.note)}»</span>` : ''}</span>
        <span style="flex:0 0 auto">эскроу: <b>${ecNum(Math.round(r.escrow))} ГС</b></span>
        ${open ? `<button class="ec-bld-del" title="Отменить заказ (вернуть эскроу)" onclick="ecOrderCancel('${r.id}')">✕</button>` : ''}
      </div>`;
  }).join('') || '<div class="cn-fac-hint">У вас нет заказов. Разместите заявку на закупку выше.</div>';
  const mineCard = `<div class="ec-dip-card"><div class="ec-dip-t">🗂 Мои заказы</div>${mineRows}</div>`;

  // ── Доска чужих заказов (можно выполнить) ──
  const boardRows = board.map(r => {
    const stock = +r.my_stock || 0;
    const can = stock > 0 && r.remaining > 0;
    const dflt = Math.max(1, Math.min(r.remaining, stock));
    const exp = r.expires_at ? `истекает через ${ecDays(r.expires_at)} сут` : '';
    const earn = ecNum(Math.round(dflt * r.price));
    const fulfill = can
      ? `<div class="ec-prod-form" style="gap:6px;margin-top:4px">
          <input type="number" id="ec-ordf-${r.id}" min="1" max="${Math.min(r.remaining, stock)}" value="${dflt}" class="ec-prod-qty" style="max-width:120px">
          <button class="btn btn-gd btn-sm" onclick="ecOrderFulfill('${r.id}')">Выполнить → +${earn} ГС</button>
        </div>`
      : `<div class="cn-fac-hint" style="margin-top:4px">${stock <= 0 ? `Нет «${esc(r.resource)}» на складе — выполнить нельзя.` : 'Заказ уже выбран.'}</div>`;
    return `<div class="ec-corp-card" style="padding:10px 12px">
        <div class="ec-q-row" style="flex-wrap:wrap;gap:8px;align-items:baseline">
          <span style="flex:1 1 100%"><b>${esc(r.buyer || 'Держава')}</b> закупает <b>${esc(r.resource)}</b></span>
          <span>нужно: <b>${ecNum(r.remaining)}</b> из ${ecNum(r.qty_total)} ед.</span>
          <span>цена: <b>${ecNum(Math.round(r.price))} ГС</b>/ед</span>
          <span style="color:var(--t4)">${exp}</span>
        </div>
        ${r.note ? `<div class="ec-hint" style="margin:2px 0">«${esc(r.note)}»</div>` : ''}
        <div class="ec-hint">На моём складе: <b>${ecNum(stock)}</b> ед.</div>
        ${fulfill}
      </div>`;
  }).join('') || '<div class="cn-fac-hint">Сейчас открытых заказов от других фракций нет.</div>';
  const boardCard = `<div class="ec-dip-card"><div class="ec-dip-t">🛒 Доска заказов <span class="ec-hint">— открытые госзаказы других держав; выполните из своих запасов</span></div>${boardRows}</div>`;

  return `${createCard}${mineCard}${boardCard}`;
}

function ecExCorpsBlock() {
  const c = EC.corps;
  // RPC не ответил → честная диагностика вместо «пусто»
  if (!c) {
    const err = EC.corpsErr || '';
    const schemaCache = /schema cache|Could not find|PGRST20\d|does not exist/i.test(err);
    return `<div class="ec-dip-card ec-corp-warn">
      <div class="ec-dip-t">🏢 Реестр организаций на профилактике</div>
      <div class="cn-fac-hint">⚙ Биржевой реестр компаний временно закрыт на техническое обслуживание. Котировки долей и дивиденды вернутся, как только торговая палата возобновит работу.
        <details style="margin-top:7px;opacity:.55"><summary style="cursor:pointer">для администратора</summary>
          ${err ? `Ответ сервера: <code style="color:var(--err);word-break:break-word">${esc(err)}</code><br>` : ''}${schemaCache
            ? 'Кэш схемы: выполните <code>notify pgrst, \'reload schema\';</code> и обновите страницу через минуту.'
            : 'Если <code>_exchange_corps.sql</code> применялся с ошибкой — скрипт откатывается целиком. Перезапустите файл и убедитесь, что внизу «Success».'}</details>
      </div></div>`;
  }
  const ses = c.session || { open: false };
  const free = c.free_buildings || [];

  // ── Учреждение: карточки-постройки + живой итог ──
  const sumGross = free.reduce((a, b) => a + (b.daily_gc || 0), 0);
  const pickCards = free.map(b => `<label class="ec-corp-bcard" data-gc="${b.daily_gc || 0}" onclick="setTimeout(ecCorpPick,0)">
      <input type="checkbox" class="ec-co-newb" value="${b.id}">
      <span class="ec-corp-bcard-ic">${ecBldIcon(b.btype)}</span>
      <span class="ec-corp-bcard-meta"><span class="ec-corp-bcard-n">${esc(ecBldNm(b.btype))}</span>
        <span class="ec-corp-bcard-sub">${b.colony ? esc(b.colony) + ' · ' : ''}${b.slots} сл</span></span>
      <span class="ec-corp-bcard-gc">${b.daily_gc ? '+' + ecNum(b.daily_gc) : '0'}<small>/ход</small></span>
    </label>`).join('');

  const canFound = c.can_found !== false;   // право учреждать — только «корпоративные» державы
  const createCard = !canFound
    ? `<div class="ec-dip-card ec-corp-warn" style="border-color:var(--w2)">
        <div class="ec-dip-t">🔒 Учреждение организаций недоступно</div>
        <div class="cn-fac-hint">Учреждать организации могут только державы с <b>корпоративным укладом</b>: форма правления <b>Корпоратократия</b> или <b>Олигархия</b>, либо политический режим <b>Плутократический</b>/<b>Олигархический</b>. Покупать доли чужих организаций и получать дивиденды вы можете при любом укладе.</div></div>`
    : free.length
    ? `<div class="ec-corp-create">
        <div class="ec-corp-create-hd">
          <span class="ec-corp-create-ic">🏢</span>
          <div><div class="ec-corp-create-t">Учредить организацию</div>
            <div class="ec-corp-create-s">Объедините реальные постройки державы. Вместе они дают <b>синергию</b> (+3% дохода за постройку, до +30%) — этот доход распределяется дивидендами на закрытии торгов. Держите все доли — весь бонус ваш; продаёте доли — делите с инвесторами, зато получаете капитал сразу.</div></div>
        </div>
        <input type="text" id="ec-co-name" maxlength="40" placeholder="Название организации (напр. «Орбитальный консорциум»)" class="ec-corp-name-in" oninput="ecCorpPick()">
        <textarea id="ec-co-desc" maxlength="400" placeholder="Описание организации (профиль, сфера, лор) — необязательно" class="ec-corp-name-in" style="margin-top:8px;min-height:54px;resize:vertical"></textarea>
        <input type="hidden" id="ec-co-img" value="">
        <div class="ec-faith-imgrow" style="margin-top:8px">
          <div class="ec-faith-imgprev" id="ec-co-imgprev"><span>нет эмблемы</span></div>
          <label class="btn btn-gh btn-sm">🖼 Эмблема<input type="file" accept="image/*" style="display:none" onchange="ecCorpImg(this,'ec-co-img','ec-co-imgprev')"></label>
        </div>
        <div class="cn-fac-hint" style="margin-top:6px">⏳ Название, описание и эмблема пройдут <b>модерацию</b> (как анкета). Доход и дивиденды начисляются сразу; доли выйдут на рынок после одобрения.</div>
        <div class="ec-corp-pick-lbl">Активы организации <span class="ec-hint">— отметьте постройки (всего доступно ${free.length}, суммарно ${ecNum(sumGross)} ГС/ход)</span></div>
        <div class="ec-corp-pick">${pickCards}</div>
        <div class="ec-corp-foot">
          <div class="ec-corp-foot-sum" id="ec-co-summary">Выбрано: 0 построек · выручка 0 ГС/ход</div>
          <button class="btn btn-gd" onclick="ecCorpCreate()">Учредить организацию</button>
        </div>
      </div>`
    : `<div class="ec-dip-card"><div class="ec-dip-t">🏢 Учредить организацию</div>
        <div class="cn-fac-hint">Нет свободных построек${(c.mine || []).length ? ' — все уже в ваших организациях' : ''}. Организация обеспечивается реальными постройками (фабрики, торговые хабы, храмы) — постройте их во вкладке <b>«Колонии»</b>.</div>
        <button class="btn btn-gh btn-sm" style="margin-top:8px" onclick="ecSetTab('colonies')">→ К колониям</button></div>`;

  // ── Мои организации ──
  const mine = (c.mine || []).map(co => {
    const bchips = (co.buildings || []).map(b => `<span class="ec-corp-chip">${ecBldIcon(b.btype)} ${esc(ecBldNm(b.btype))}${b.colony ? ` · ${esc(b.colony)}` : ''} (${b.slots})</span>`).join('') || '<i style="color:var(--t4)">без построек — доход 0</i>';
    const myListed = (c.listings || []).filter(l => l.mine && l.corp_id === co.id);
    const ownPct = co.total_shares ? Math.round(co.my_shares / co.total_shares * 100) : 0;
    const listedRows = myListed.map(l => `<div class="ec-corp-listed"><span>📤 В продаже: <b>${ecNum(l.shares)}</b> долей (${Math.round(l.shares / Math.max(1, co.total_shares) * 100)}%) по <b>${ecNum(Math.round(l.price))} ГС</b></span><button class="ec-bld-del" title="Снять с продажи" onclick="ecCorpCancelListing('${l.id}')">✕</button></div>`).join('');
    const canDissolve = co.my_shares >= co.total_shares && co.holders <= 1;
    const effPct = Math.round((co.efficiency || 0) * 100);
    const myDiv = Math.round((co.daily_gross || 0) * co.my_shares / Math.max(1, co.total_shares)); // мой дивиденд/ход
    const smult = +co.sector_mult || 1;                                       // секторный спрос
    const smCol = smult > 1.05 ? 'var(--gd)' : smult < 0.95 ? 'var(--err)' : 'var(--t3)';
    const effBadge = effPct ? `<span class="ec-corp-ses on" title="Синергия: доход построек увеличен">⚡ +${effPct}%</span>` : '';
    const demBadge = `<span class="ec-corp-ses ${smult > 1.05 ? 'on' : smult < 0.95 ? 'off' : ''}" title="Секторный спрос: реальная галактика крутит доход">📊 ${smult.toFixed(2)}×</span>`;
    // ── Статус модерации контента ──
    const st = co.status || 'approved';
    const approved = st === 'approved';
    const modBanner =
      st === 'pending' ? `<div class="ec-faith-status pend">⏳ Организация на модерации — название, описание и эмблема станут видны другим фракциям после одобрения. Доход и дивиденды уже идут, но выставить доли на рынок можно только после одобрения.</div>`
      : st === 'rejected' ? `<div class="ec-faith-status rej">✕ Контент отклонён администрацией.${co.reject_reason ? ` Причина: «${esc(co.reject_reason)}». ` : ' '}Отредактируйте и подайте заново.</div>`
      : (co.pending_review ? `<div class="ec-faith-status pend">⏳ Правка профиля на проверке — другие пока видят прежний вид.${co.pending && co.pending.name ? ` Предложено: «${esc(co.pending.name)}».` : ''}</div>`
      : (co.reject_reason ? `<div class="ec-faith-status rej">✕ Прошлая правка отклонена.${co.reject_reason ? ` Причина: «${esc(co.reject_reason)}».` : ''}</div>` : ''));
    const editing = !!(EC.corpEditing && EC.corpEditing[co.id]);
    // Редактор состава предприятий (за 10 000 ГС): текущие постройки (отмечены) + свободные.
    const recCards = editing ? (co.buildings || []).map(b =>
        `<label class="ec-corp-bcard on"><input type="checkbox" value="${b.id}" checked onchange="this.closest('.ec-corp-bcard').classList.toggle('on',this.checked)">
          <span class="ec-corp-bcard-ic">${ecBldIcon(b.btype)}</span>
          <span class="ec-corp-bcard-meta"><span class="ec-corp-bcard-n">${esc(ecBldNm(b.btype))}</span>
            <span class="ec-corp-bcard-sub">${b.colony ? esc(b.colony) + ' · ' : ''}${b.slots} сл</span></span></label>`)
      .concat(free.map(b =>
        `<label class="ec-corp-bcard"><input type="checkbox" value="${b.id}" onchange="this.closest('.ec-corp-bcard').classList.toggle('on',this.checked)">
          <span class="ec-corp-bcard-ic">${ecBldIcon(b.btype)}</span>
          <span class="ec-corp-bcard-meta"><span class="ec-corp-bcard-n">${esc(ecBldNm(b.btype))}</span>
            <span class="ec-corp-bcard-sub">${b.colony ? esc(b.colony) + ' · ' : ''}${b.slots} сл</span></span>
          <span class="ec-corp-bcard-gc">+${ecNum(b.daily_gc || 0)}<small>/ход</small></span></label>`)).join('') : '';
    const editForm = editing ? `<div class="ec-faith-edit">
        <div class="ec-bless-hd" style="margin-top:0">Редактирование — изменения уйдут на модерацию</div>
        <input id="ec-ce-name-${co.id}" placeholder="название организации" class="ec-corp-name-in" maxlength="40" value="${esc(co.name || '')}">
        <textarea id="ec-ce-desc-${co.id}" placeholder="описание (профиль, сфера, лор)" class="ec-corp-name-in" style="margin-top:8px;min-height:54px;resize:vertical" maxlength="400">${esc(co.description || '')}</textarea>
        <input type="hidden" id="ec-ce-img-${co.id}" value="${esc(co.image_url || '')}">
        <div class="ec-faith-imgrow" style="margin-top:8px">
          <div class="ec-faith-imgprev" id="ec-ce-imgprev-${co.id}">${co.image_url ? `<img src="${esc(co.image_url)}" alt="">` : '<span>нет эмблемы</span>'}</div>
          <label class="btn btn-gh btn-sm">🖼 Эмблема<input type="file" accept="image/*" style="display:none" onchange="ecCorpImg(this,'ec-ce-img-${co.id}','ec-ce-imgprev-${co.id}')"></label>
          ${co.image_url ? `<button class="btn btn-gh btn-sm" onclick="ecCorpImgClear('ec-ce-img-${co.id}','ec-ce-imgprev-${co.id}')">Убрать</button>` : ''}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn btn-gd btn-sm" onclick="ecCorpEdit('${co.id}')">Отправить на модерацию</button>
          <button class="btn btn-gh btn-sm" onclick="ecCorpEditToggle('${co.id}',false)">Отмена</button>
        </div>
        <div class="ec-corp-pick-lbl" style="margin-top:14px">Состав предприятий <span class="ec-hint">— отметьте постройки организации; изменение состава стоит <b>10 000 ГС</b> и применяется сразу (без модерации)</span></div>
        <div class="ec-corp-pick" id="ec-co-rec-${co.id}">${recCards || '<i style="color:var(--t4)">нет доступных построек</i>'}</div>
        <button class="btn btn-gh btn-sm" style="margin-top:8px" onclick="ecCorpRecompose('${co.id}')">Изменить состав — 10 000 ГС</button>
      </div>` : '';
    const emblem = co.image_url ? `<span class="ec-corp-emblem" style="background-image:url('${esc(co.image_url)}')"></span>` : '';
    const descHtml = (co.description && !editing) ? `<div class="ec-corp-desc">${esc(co.description)}</div>` : '';
    return `<div class="ec-corp-card">
      ${modBanner}
      <div class="ec-corp-card-hd"><span class="ec-corp-card-n">${emblem}🏢 ${esc(co.name)} ${effBadge}${demBadge}</span>
        ${canDissolve ? `<button class="ec-bld-del" title="Распустить организацию" onclick="ecCorpDissolve('${co.id}')">✕</button>` : ''}</div>
      ${descHtml}
      <div class="ec-corp-stats">
        <span><i>Котировка</i><b>${ecNum(Math.round(co.share_price))} ГС</b>/доля</span>
        <span><i>Доход (спрос×синергия)</i><b>${ecNum(Math.round(co.daily_gross))} /ход</b></span>
        <span><i>Спрос отрасли</i><b style="color:${smCol}">${smult.toFixed(2)}×</b></span>
        <span><i>Моя доля</i><b>${ownPct}% (${ecNum(co.my_shares)}/${ecNum(co.total_shares)})</b></span>
        <span><i>Мой дивиденд</i><b style="color:var(--gd)">+${ecNum(myDiv)} /ход</b></span>
      </div>
      <div class="ec-corp-chips">${bchips}</div>
      ${editForm}
      ${listedRows}
      <div class="ec-corp-sell">
        <input type="number" id="ec-co-ls-sh-${co.id}" min="1" max="${co.my_shares}" placeholder="долей на продажу (есть ${ecNum(co.my_shares)})" class="ec-prod-qty"${approved ? '' : ' disabled'}>
        <input type="number" id="ec-co-ls-pr-${co.id}" min="1" placeholder="цена за долю" class="ec-prod-qty"${approved ? '' : ' disabled'}>
        <button class="btn btn-gh btn-sm" onclick="ecCorpListShares('${co.id}')"${approved ? '' : ' disabled title="Доли можно выставить после одобрения организации"'}>Выставить доли</button>
        ${editing ? '' : `<button class="btn btn-gh btn-sm" onclick="ecCorpEditToggle('${co.id}',true)">✎ Редактировать</button>`}
      </div>
    </div>`;
  }).join('');

  // ── Рынок долей (чужие листинги, покупка только в сессию) ──
  const others = (c.listings || []).filter(l => !l.mine);
  const market = others.map(l => {
    const divid = (l.daily_gross || 0) / Math.max(1, l.total_shares);     // дивиденд на 1 долю/ход
    const yieldPct = l.price > 0 ? Math.round(divid / l.price * 100) : 0; // доходность/ход
    const sm = +l.sector_mult || 1;
    const smTag = sm > 1.05 ? ` · <span style="color:var(--gd)">спрос ${sm.toFixed(2)}×▲</span>` : sm < 0.95 ? ` · <span style="color:var(--err)">спрос ${sm.toFixed(2)}×▼</span>` : '';
    return `<div class="ec-corp-offer">
      <span class="ec-corp-offer-main"><b>${esc(l.name)}</b> <i style="color:var(--t4)">от ${esc(l.seller)}</i><br>
        <span class="ec-corp-offer-sub">${ecNum(l.shares)} долей × ${ecNum(Math.round(l.price))} ГС · дивиденд ≈ ${ecNum(Math.round(divid))} ГС/доля/ход${yieldPct ? ` · доходность ~${yieldPct}%/ход` : ''}${smTag}</span></span>
      <input type="number" id="ec-co-buy-${l.id}" min="1" max="${l.shares}" placeholder="долей" class="ec-prod-qty" style="max-width:90px">
      <button class="btn btn-gd btn-sm"${ses.open ? '' : ' disabled title="Торги закрыты — покупка недоступна"'} onclick="ecCorpBuyShares('${l.id}')">Купить</button>
    </div>`;
  }).join('') || `<div class="cn-fac-hint">Нет долей в продаже${ses.open ? '' : ' · торги сейчас закрыты'}.</div>`;

  // ── Мои доли в чужих организациях ──
  const holds = (c.holdings || []).map(h => {
    const myListed = (c.listings || []).filter(l => l.mine && l.corp_id === h.corp_id);
    const listedRows = myListed.map(l => `<div class="ec-corp-listed"><span>📤 В продаже: <b>${ecNum(l.shares)}</b> долей по <b>${ecNum(Math.round(l.price))} ГС</b></span><button class="ec-bld-del" title="Снять с продажи" onclick="ecCorpCancelListing('${l.id}')">✕</button></div>`).join('');
    return `<div class="ec-corp-offer">
      <span class="ec-corp-offer-main"><b>${esc(h.name)}</b> <i style="color:var(--t4)">(${esc(h.founder)})</i><br>
        <span class="ec-corp-offer-sub">${ecNum(h.shares)}/${ecNum(h.total_shares)} долей = ${ecNum(Math.round(h.value))} ГС · дивиденд ≈ ${ecNum(Math.round((h.daily_gross || 0) * h.shares / Math.max(1, h.total_shares)))} ГС/ход</span></span>
      ${listedRows}
      <div class="ec-corp-sell">
        <input type="number" id="ec-co-ls-sh-${h.corp_id}" min="1" max="${h.shares}" placeholder="долей на продажу (есть ${ecNum(h.shares)})" class="ec-prod-qty">
        <input type="number" id="ec-co-ls-pr-${h.corp_id}" min="1" placeholder="цена за долю (котир. ${ecNum(Math.round(h.share_price))})" class="ec-prod-qty">
        <button class="btn btn-gh btn-sm" onclick="ecCorpListShares('${h.corp_id}')">Выставить доли</button>
      </div>
    </div>`;
  }).join('') || '<div class="cn-fac-hint">Вы не держите чужих долей.</div>';

  const sesPill = ses.open
    ? `<span class="ec-corp-ses on">● торги открыты</span>`
    : `<span class="ec-corp-ses off">● торги закрыты</span>`;

  // ════════ ТОРГОВЫЙ ТЕРМИНАЛ ════════
  const board = c.board || [];
  const chgOf = (price, sp) => { const f = (sp && sp.length) ? +sp[0] : price; return f ? Math.round((price / f - 1) * 100) : 0; };
  // Δ за ход: рост · падение · без изменения (нейтрально, не зелёная стрелка вверх)
  const chgArrow = ch => ch > 0 ? '▲' : ch < 0 ? '▼' : '▬';
  const chgCol   = ch => ch > 0 ? '#5fc98a' : ch < 0 ? '#e0688a' : 'var(--t4)';
  const chgTxt   = ch => `${ch > 0 ? '+' : ''}${ch}%`;

  // ── Индекс корпораций: значение + Δ + линейный график ──
  const idx = c.index || { value: 1000, base: 1000, spark: [] };
  const iv = +idx.value || 1000, ib = +idx.base || 1000, isp = idx.spark || [];
  const iChg = chgOf(iv, isp), iCol = chgCol(iChg);
  const indexHeader = `<div class="ec-xch-index">
    <div class="ec-xch-index-l">
      <div class="ec-xch-index-cap">📈 Индекс корпораций <span class="ec-hint">CORP·IDX · ${sesPill}</span></div>
      <div class="ec-xch-index-val">${ecNum(Math.round(iv))} <span style="color:${iCol}">${chgArrow(iChg)} ${chgTxt(iChg)}</span></div>
      <div class="ec-xch-index-sub">база ${ecNum(Math.round(ib))} · ${ecNum(board.length)} компан. в листинге</div>
    </div>
    <div class="ec-xch-index-chart">${ecSparkline(isp, iCol, 360, 92) || '<span class="ec-hint">история индекса копится — зайдите завтра</span>'}</div>
  </div>`;

  // Бегущая лента котировок перенесена в «Ленту сектора» на главной
  // (fnCorpTickerHtml в faction_news.js) — там она тематически уместнее.

  // ── Доска котировок: все одобренные организации ──
  const boardRows = board.map(b => {
    const ch = chgOf(b.share_price, b.spark), col = chgCol(ch);
    const sm = +b.sector_mult || 1, smc = sm > 1.05 ? 'var(--gd)' : sm < 0.95 ? 'var(--err)' : 'var(--t3)';
    const ask = b.ask;
    const bid = (ask && !b.mine)
      ? `<button class="btn btn-gd btn-xs"${ses.open ? '' : ' disabled title="Торги закрыты"'} onclick="ecCorpBuyAsk('${ask.id}',${Math.round(ask.price)},${ask.shares})">${ecNum(Math.round(ask.price))} ⤵</button>`
      : '<span class="ec-hint">—</span>';
    const emblem = b.image_url ? `<span class="ec-corp-emblem" style="background-image:url('${esc(b.image_url)}')"></span>` : '<span class="ec-xch-noemb">🏢</span>';
    return `<div class="ec-xch-row${b.mine ? ' mine' : ''}">
      <span class="ec-xch-tk">${emblem}<span class="ec-xch-tkn"><b>${esc(b.name)}</b><i>${esc(b.founder)}${b.mine ? ' · ваша' : ''}</i></span></span>
      <span class="ec-xch-px">${ecNum(Math.round(b.share_price))}</span>
      <span class="ec-xch-ch" style="color:${col}">${chgArrow(ch)} ${chgTxt(ch)}</span>
      <span class="ec-xch-dm" style="color:${smc}" title="секторный спрос">${sm.toFixed(2)}×</span>
      <span class="ec-xch-sp">${ecSparkline(b.spark, col, 84, 26) || '<span class="ec-hint" style="font-size:10px">—</span>'}</span>
      <span class="ec-xch-bid">${bid}</span>
    </div>`;
  }).join('') || '<div class="cn-fac-hint">В листинге пока нет одобренных организаций. Учредите свою ниже — после модерации она появится в котировках.</div>';
  const boardCard = `<div class="ec-dip-card ec-xch-board">
    <div class="ec-dip-t">🏛 Котировки организаций</div>
    <div class="ec-xch-row ec-xch-head"><span class="ec-xch-tk">Компания</span><span class="ec-xch-px">Цена</span><span class="ec-xch-ch">Δ ход</span><span class="ec-xch-dm">Спрос</span><span class="ec-xch-sp">График</span><span class="ec-xch-bid">Аск</span></div>
    ${boardRows}</div>`;

  // ── Управление (учредить · мои · правка · рынок долей) — сворачиваемое ──
  const hasAttention = (c.mine || []).some(co => (co.status && co.status !== 'approved') || co.pending_review || co.reject_reason);
  const manageOpen = (EC.corpManage === undefined) ? (hasAttention || board.length === 0) : !!EC.corpManage;
  EC._corpManageEff = manageOpen;   // эффективное состояние для тоггла
  const manageBtn = `<button class="ec-xch-manage-btn" onclick="ecCorpManageToggle()">${manageOpen ? '▾' : '▸'} Управление организациями <span class="ec-hint">— учредить · мои · правка · продать доли</span></button>`;
  const manageBody = manageOpen ? `${createCard}
    <div class="ec-section-title">Мои организации</div>
    ${mine || '<div class="cn-fac-hint">У вас пока нет организаций — учредите выше.</div>'}
    <div class="ec-dip-card" style="margin-top:10px"><div class="ec-dip-t">🛒 Рынок долей ${sesPill}</div>${market}</div>
    <div class="ec-dip-card"><div class="ec-dip-t">📈 Мои доли в чужих организациях</div>${holds}</div>` : '';

  return `${indexHeader}${boardCard}${ecDemandPanel(c.demand)}
    <div class="ec-xch-manage">${manageBtn}${manageBody}</div>`;
}
function ecCorpManageToggle() {
  EC.corpManage = !EC._corpManageEff;
  ecPaintCabinet();
}
// Живой пересчёт итога формы учреждения (выбранные постройки → выручка/ход).
function ecCorpPick() {
  const boxes = Array.from(document.querySelectorAll('.ec-co-newb'));
  let n = 0, gross = 0;
  boxes.forEach(b => {
    const card = b.closest('.ec-corp-bcard');
    if (b.checked) { n++; gross += +(card?.dataset.gc || 0); card?.classList.add('on'); }
    else card?.classList.remove('on');
  });
  const out = ecId('ec-co-summary');
  if (!out) return;
  const eff = Math.min(0.30, n * 0.03);            // зеркало _corp_efficiency
  const net = Math.round(gross * (1 + eff));
  out.innerHTML = n
    ? `Выбрано <b>${n}</b> ${n === 1 ? 'постройка' : 'построек'} · база ${ecNum(gross)} + синергия <b style="color:#5fc98a">+${Math.round(eff * 100)}%</b> = <b style="color:var(--gd)">${ecNum(net)} ГС/ход</b> к распределению · котировка ≈ ${ecNum(Math.round(net * 20 / 1000))} ГС/доля`
    : `Выбрано: 0 построек · выручка 0 ГС/ход`;
}

// ── Биржа технологий и чертежей (адресные предложения) ──────────
function ecResearchLabel(key) {
  const all = (typeof ecBuildResearch === 'function') ? ecBuildResearch() : [];
  const n = all.find(x => x.id === key);
  return (n && n.name) || key;
}
// Свои чертежи: юниты своей фракции, кроме дивизий (дивизия — композиция другой техники).
function ecMyBlueprints() {
  return (EC.designs || []).filter(u => u && u.faction_id === EC.fid && u.category !== 'division');
}
function ecTechKindToggle() {
  const k = document.getElementById('ec-tm-kind') && document.getElementById('ec-tm-kind').value;
  const t = document.getElementById('ec-tm-tech-wrap'), b = document.getElementById('ec-tm-bp-wrap');
  if (t) t.style.display = (k === 'tech') ? '' : 'none';
  if (b) b.style.display = (k === 'blueprint') ? '' : 'none';
}
function ecTechMarketBlock() {
  const others = ecOtherFactions();
  const myTechs = (EC.eco && Array.isArray(EC.eco.research)) ? EC.eco.research : [];
  const mine = new Set(myTechs);
  const bps = ecMyBlueprints();
  const incoming = (EC.techOffers || []).filter(o => o.buyer_fid === EC.fid && o.status === 'pending');
  const outgoing = (EC.techOffers || []).filter(o => o.seller_fid === EC.fid && o.status === 'pending');

  const techOpts = myTechs.map(k => `<option value="${esc(k)}">${esc(ecResearchLabel(k))}</option>`).join('');
  const bpOpts = bps.map(u => `<option value="${esc(u.id)}">${esc(u.name || 'Чертёж')} · ${esc(u.category || '')}</option>`).join('');

  const form = !others.length
    ? '<div class="ec-empty">Нет других фракций для сделки.</div>'
    : `<div class="ec-prod-form" style="flex-wrap:wrap;gap:6px">
        ${ecFacSelect('ec-tm-buyer')}
        <select id="ec-tm-kind" onchange="ecTechKindToggle()">
          <option value="tech">Технология</option>
          <option value="blueprint">Чертёж (юнит)</option>
        </select>
        <span id="ec-tm-tech-wrap">${techOpts ? `<select id="ec-tm-tech">${techOpts}</select>` : '<span class="ec-hint">нет изученных технологий</span>'}</span>
        <span id="ec-tm-bp-wrap" style="display:none">${bpOpts ? `<select id="ec-tm-bp">${bpOpts}</select>` : '<span class="ec-hint">нет своих чертежей</span>'}</span>
        <input type="number" id="ec-tm-price" min="0" placeholder="цена ГС" class="ec-prod-qty">
        <button class="btn btn-gd btn-sm" onclick="ecTechOfferPropose()">Предложить</button>
      </div>
      <div class="ec-hint" style="margin-top:4px">Технологию покупатель получает в своё дерево исследований. Чертёж — копией, но купить выйдет, только если у него уже изучены все нужные для чертежа технологии.</div>`;

  const inHtml = incoming.map(o => {
    if (o.kind === 'tech') {
      return `<div class="ec-q-row"><span class="ec-r-name"><span class="ec-route-badge new">тех</span> <b>${esc(o.seller_name || ecFacName(o.seller_fid))}</b> продаёт технологию «${esc(o.tech_label || o.tech_key)}» за <b style="color:var(--gd)">${ecNum(o.price)} ГС</b></span><button class="btn btn-gd btn-xs" onclick="ecTechOfferAccept('${o.id}')">Купить</button><button class="ec-bld-del" title="Отклонить" onclick="ecTechOfferReject('${o.id}')">✕</button></div>`;
    }
    const req = Array.isArray(o.req_tech) ? o.req_tech : [];
    const missing = req.filter(k => !mine.has(k));
    const missTxt = missing.length ? `<div class="ec-hint" style="color:var(--err)">Не хватает технологий: ${missing.map(k => esc(ecResearchLabel(k))).join(', ')}</div>` : '';
    return `<div class="ec-q-row" style="flex-wrap:wrap"><span class="ec-r-name"><span class="ec-route-badge new">чертёж</span> <b>${esc(o.seller_name || ecFacName(o.seller_fid))}</b> продаёт чертёж «${esc(o.unit_name || 'юнит')}» (${esc(o.unit_category || '')}) за <b style="color:var(--gd)">${ecNum(o.price)} ГС</b>${missTxt}</span>${missing.length ? `<button class="btn btn-gh btn-xs" disabled title="Сначала изучите недостающие технологии">🔒 Нельзя</button>` : `<button class="btn btn-gd btn-xs" onclick="ecTechOfferAccept('${o.id}')">Купить</button>`}<button class="ec-bld-del" title="Отклонить" onclick="ecTechOfferReject('${o.id}')">✕</button></div>`;
  }).join('');

  const outHtml = outgoing.map(o => `<div class="ec-q-row"><span class="ec-r-name"><span class="ec-route-badge wait">⏳ ждёт ответа</span> ${o.kind === 'tech' ? 'технология «' + esc(o.tech_label || o.tech_key) + '»' : 'чертёж «' + esc(o.unit_name || 'юнит') + '»'} → <b>${esc(ecFacName(o.buyer_fid))}</b> · ${ecNum(o.price)} ГС</span><button class="ec-bld-del" title="Отозвать предложение" onclick="ecTechOfferCancel('${o.id}')">✕</button></div>`).join('');

  return `<div class="ec-dip-card">
      <div class="ec-dip-t">Биржа технологий и чертежей</div>
      ${form}
      ${incoming.length ? `<div class="ec-r-sec">Входящие предложения</div>${inHtml}` : ''}
      ${outgoing.length ? `<div class="ec-r-sec">Отправленные</div>${outHtml}` : ''}
    </div>`;
}
async function ecTechOfferPropose() {
  const buyer = document.getElementById('ec-tm-buyer') && document.getElementById('ec-tm-buyer').value;
  const kind = (document.getElementById('ec-tm-kind') && document.getElementById('ec-tm-kind').value) || 'tech';
  const price = Math.max(0, Math.round(+(document.getElementById('ec-tm-price') && document.getElementById('ec-tm-price').value) || 0));
  if (!buyer) { toast('Выберите фракцию-покупателя', 'err'); return; }
  const body = { p_buyer_fid: buyer, p_kind: kind, p_price: price,
    p_tech_key: null, p_tech_label: null, p_unit_name: null, p_unit_category: null, p_unit_snapshot: null, p_req_tech: [] };
  if (kind === 'tech') {
    const key = document.getElementById('ec-tm-tech') && document.getElementById('ec-tm-tech').value;
    if (!key) { toast('Нет технологии для продажи', 'err'); return; }
    body.p_tech_key = key; body.p_tech_label = ecResearchLabel(key);
  } else {
    const uid = document.getElementById('ec-tm-bp') && document.getElementById('ec-tm-bp').value;
    const u = ecMyBlueprints().find(x => x.id === uid);
    if (!u) { toast('Нет чертежа для продажи', 'err'); return; }
    body.p_unit_name = u.name || 'Чертёж';
    body.p_unit_category = u.category;
    body.p_unit_snapshot = { name: u.name, summary: u.summary, data: u.data, card_text: u.card_text };
    body.p_req_tech = (typeof cnUnitReqTech === 'function') ? cnUnitReqTech(u) : [];
  }
  try {
    await ecRpc('tech_offer_propose', body);
    toast('Предложение отправлено', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}
async function ecTechOfferAccept(id) {
  if (!confirm('Купить? С казны спишется цена предложения.')) return;
  try { await ecRpc('tech_offer_accept', { p_offer_id: id }); toast('Сделка совершена ✓', 'ok'); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}
async function ecTechOfferReject(id) {
  try { await ecRpc('tech_offer_reject', { p_offer_id: id }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}
async function ecTechOfferCancel(id) {
  try { await ecRpc('tech_offer_cancel', { p_offer_id: id }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + ecErr(e.message), 'err'); }
}

// ── Вкладка «Дипломатия»: отношения · кредиты ──
function ecTabDiplomacy() {
  const others = ecOtherFactions(), noOthers = !others.length;
  const asLender = EC.loans.filter(l => l.lender_fid === EC.fid && ['active', 'disputed'].includes(l.status));
  const asBorrower = EC.loans.filter(l => l.borrower_fid === EC.fid && ['active', 'disputed'].includes(l.status));

  const lenderHtml = asLender.map(l => `<div class="ec-q-row"><span class="ec-r-name">${esc(l.borrower_name || ecFacName(l.borrower_fid))} должен ${ecNum(l.amount)} ГС${l.status === 'disputed' ? ' · <b style="color:var(--color-warning)">СПОР</b>' : ''}</span>${l.status === 'active' ? `<button class="btn btn-gh btn-xs" onclick="ecLoanDispute('${l.id}')">Спор</button>` : '<span class="ec-q-t">в МГА</span>'}</div>`).join('');
  const borrowerHtml = asBorrower.map(l => `<div class="ec-q-row"><span class="ec-r-name">Долг ${esc(l.lender_name || ecFacName(l.lender_fid))}: ${ecNum(l.amount)} ГС${l.status === 'disputed' ? ' · <b style="color:var(--color-warning)">СПОР</b>' : ''}</span><button class="btn btn-gd btn-xs" onclick="ecLoanRepay('${l.id}')">Погасить</button></div>`).join('');
  const loanBlock = `<div class="ec-dip-card">
      <div class="ec-dip-t">Кредиты</div>
      ${noOthers ? '<div class="ec-empty">Нет других фракций.</div>' : `<div class="ec-prod-form">${ecFacSelect('ec-loan-fac')}<input type="number" id="ec-loan-amt" min="1" placeholder="сумма ГС" class="ec-prod-qty"><button class="btn btn-gd btn-sm" onclick="ecLoanIssue()">Выдать заём</button></div>
      <input id="ec-loan-note" placeholder="условия (необязательно)" class="ec-loan-note" style="margin-top:6px">`}
      ${asLender.length ? `<div class="ec-r-sec">Я кредитор</div>${lenderHtml}` : ''}
      ${asBorrower.length ? `<div class="ec-r-sec">Я заёмщик</div>${borrowerHtml}` : ''}
    </div>`;

  return `${ecIntro('🤝', 'Дипломатия', 'Союзы, отношения и кредиты. Федерация/конфедерация дают защиту и общий флот; вассал платит сюзерену дань. Торговля и обмен — на вкладке «Торговля и потоки».', ['<b>Федерация/конфедерация</b> — союз нескольких держав: защита караванов и от разведки, общий флот.', '<b>Вассалитет</b> — вассал платит сюзерену дань с дохода (как у Paradox).', '<b>Границы</b> — закрываются для выбранных фракций: их флоты не войдут в ваши системы.', 'Можно выдавать займы; споры по долгам решает МГА.'])}<div class="ec-section-title">Границы <span class="ec-hint">— пограничный контроль</span></div>
    <div class="ec-dip-grid">${ecBordersBlock()}</div>
    <div class="ec-section-title">Союзы <span class="ec-hint">— федерация · конфедерация · вассалитет</span></div>
    ${ecAllianceBlock()}
    <div class="ec-section-title">Отношения <span class="ec-hint">— дипломатический респект</span></div>
    ${ecRelationsBlock()}
    <div class="ec-section-title">Кредиты</div>
    <div class="ec-dip-grid">${loanBlock}</div>`;
}

// Блок «Границы»: пофракционное закрытие границ (зеркало _borders_closed.sql).
// Клик по гербу переключает: fid в списке → его флоты в наши системы не летают,
// гипермаршруты идут в обход. Союзники по федерации/конфедерации проходят всегда.
function ecBordersClosedFids() {
  return (EC.eco && Array.isArray(EC.eco.borders_closed_fids)) ? EC.eco.borders_closed_fids : [];
}
function ecBordersBlock() {
  const closed = new Set(ecBordersClosedFids());
  const others = ecOtherFactions();
  const state = closed.size
    ? `<b style="color:var(--err)">🔒 Закрыты для ${closed.size} из ${others.length}</b> — флоты выбранных фракций не могут прилетать в ваши системы, а их гипермаршруты сквозь вас строятся в обход. Союзники по федерации/конфедерации проходят.`
    : `<b style="color:var(--ok,#7bd88f)">🔓 Открыты</b> — любые флоты летают через ваши системы свободно. Клик по фракции закрывает границу для неё.`;
  const rows = others.map(f => {
    const c = closed.has(f.faction_id);
    return `<button class="ec-bord-fac${c ? ' ec-bord-closed' : ''}" onclick="ecBordersToggle('${jsq(f.faction_id)}', ${c ? 'false' : 'true'})" title="${c ? 'Открыть границу для' : 'Закрыть границу для'} «${esc(f.name)}»">
        ${ecFacFlag(f.faction_id, 24)}<span class="ec-bord-name">${esc(f.name)}</span><span class="ec-bord-lock">${c ? '🔒' : '🔓'}</span>
      </button>`;
  }).join('');
  return `<div class="ec-dip-card">
      <div class="ec-dip-t">🛂 Границы государства</div>
      <div style="font-size:12.5px;color:var(--t2);margin:6px 0">${state}</div>
      ${others.length ? `<div class="ec-bord-grid">${rows}</div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${closed.size < others.length ? '<button class="btn btn-gh btn-xs" onclick="ecBordersAll(true)">🔒 Закрыть для всех</button>' : ''}
        ${closed.size ? '<button class="btn btn-gh btn-xs" onclick="ecBordersAll(false)">🔓 Открыть все</button>' : ''}
      </div>` : '<div class="ec-empty">Нет других фракций.</div>'}
    </div>`;
}
function ecBordersToggle(fid, close) {
  ecRpcAct('borders_set', { p_fid: fid, p_closed: !!close },
    close ? `Границы закрыты для «${ecFacName(fid)}»` : `Границы открыты для «${ecFacName(fid)}»`);
}
function ecBordersAll(close) {
  if (close && !confirm('Закрыть границы для ВСЕХ фракций? Их флоты не смогут прилетать в ваши системы (союзники по федерации/конфедерации проходят). Открыть обратно можно в любой момент.')) return;
  ecRpcAct('borders_set', { p_fid: null, p_closed: !!close }, close ? 'Границы закрыты для всех' : 'Границы открыты');
}

// Блок союзов: федерация/конфедерация (группа) + вассалитет (парный пакт). Слайс 1.
function ecAllianceBlock() {
  const d = EC.diplo || { union: null, members: [], invites: [], vassals: [] };
  const chip = (txt, crown) => `<span style="display:inline-block;background:var(--b1);border:1px solid var(--w2);border-radius:8px;padding:3px 9px;margin:2px;font-size:12px">${esc(txt)}${crown ? ' 👑' : ''}</span>`;
  let unionHtml;
  if (d.union) {
    const u = d.union;
    const isLeader = u.leader_fid === EC.fid;
    const kindName = u.kind === 'federation' ? 'Федерация' : 'Конфедерация';
    const membersHtml = (d.members || []).map(m => chip(m.name, m.fid === u.leader_fid)).join('');
    const bonuses = u.kind === 'federation'
      ? ['🛡 Защита караванов — крепкая', '🔍 Защита от разведки — крепкая', '🚀 Общий пул кораблей']
      : ['🛡 Защита караванов — умеренная', '🔍 Защита от разведки — умеренная'];
    const bonusHtml = `<div class="ec-union-bonus" style="margin:8px 0;padding:8px 10px;background:var(--b1);border:1px solid var(--w2);border-radius:8px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:5px">Бонусы союза (${ecNum((d.members || []).length)} чл.)</div>
        ${bonuses.map(b => `<div style="font-size:12.5px;color:var(--t2);padding:1px 0">${b}</div>`).join('')}
        <div style="font-size:10.5px;color:var(--t4);margin-top:5px">⚙ механические эффекты вводятся постепенно</div>
      </div>`;
    // Статус модерации профиля союза (зеркало веры)
    let modNote = '';
    if (u.status === 'pending' && !u.pending_review) modNote = `<div style="margin:4px 0;font-size:11.5px;color:var(--color-warning)">⏳ Союз на модерации администрации — в общем реестре фракций появится после одобрения.</div>`;
    else if (u.status === 'rejected') modNote = `<div style="margin:4px 0;font-size:11.5px;color:var(--err)">✕ Профиль отклонён${u.reject_reason ? ': ' + esc(u.reject_reason) : ''}.${isLeader ? ' Отредактируйте и отправьте снова.' : ''}</div>`;
    else if (u.pending_review) modNote = `<div style="margin:4px 0;font-size:11.5px;color:var(--color-warning)">⏳ Правка профиля на проверке — мир пока видит прежний вид.</div>`;
    const flag = u.herald_url ? `<img src="${esc(u.herald_url)}" alt="" style="width:38px;height:38px;border-radius:7px;object-fit:cover;border:1px solid var(--w2);flex-shrink:0">` : '';
    const editForm = (isLeader && EC.unionEditing) ? `<div class="ec-union-edit" style="margin-top:8px;padding:10px;background:var(--b1);border:1px solid var(--w2);border-radius:8px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:6px">✎ Профиль союза (на модерацию)</div>
        <input id="ec-ue-name" class="ec-loan-note" style="width:100%;margin-bottom:6px" value="${esc(u.name || '')}" placeholder="название союза">
        <textarea id="ec-ue-desc" class="ec-loan-note" rows="3" style="width:100%;margin-bottom:6px" placeholder="описание / лор союза">${esc(u.description || '')}</textarea>
        <div class="ec-prod-form" style="flex-wrap:wrap;align-items:center;gap:8px">
          <label style="font-size:12px;color:var(--t2)">Цвет <input type="color" id="ec-ue-color" value="${esc(u.color || '#5a7fb0')}" style="vertical-align:middle"></label>
          <input type="hidden" id="ec-ue-img" value="${esc(u.herald_url || '')}">
          <label class="btn btn-gh btn-sm" style="cursor:pointer">📁 Флаг<input type="file" accept="image/*" style="display:none" onchange="ecUnionImg(this,'ec-ue-img','ec-ue-img-prev')"></label>
          <span id="ec-ue-img-prev">${u.herald_url ? `<img src="${esc(u.herald_url)}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover;vertical-align:middle">` : '<span style="font-size:11px;color:var(--t4)">нет флага</span>'}</span>
          ${u.herald_url ? `<button class="ec-bld-del" title="Убрать флаг" onclick="ecUnionImgClear('ec-ue-img','ec-ue-img-prev')">✕</button>` : ''}
        </div>
        <div style="margin-top:8px"><button class="btn btn-gd btn-sm" onclick="ecUnionEdit()">Отправить на модерацию</button>
          <button class="btn btn-gh btn-sm" onclick="ecUnionEditToggle(false)">Отмена</button></div>
      </div>` : '';
    unionHtml = `<div class="ec-dip-t" style="display:flex;align-items:center;gap:8px">${flag}<span>${u.kind === 'federation' ? '🛡' : '🤝'} ${esc(kindName)}: «${esc(u.name)}»</span></div>
      ${modNote}
      ${u.description ? `<div style="margin:6px 0;font-size:12.5px;color:var(--t2);white-space:pre-wrap">${esc(u.description)}</div>` : ''}
      <div style="margin:6px 0">${membersHtml}</div>
      ${bonusHtml}
      ${isLeader && !EC.unionEditing ? `<div class="ec-prod-form" style="margin-top:6px">${ecFacSelect('ec-union-inv')}<button class="btn btn-gd btn-sm" onclick="ecUnionInvite()">Пригласить</button></div>` : ''}
      ${editForm}
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
        ${isLeader && !EC.unionEditing ? `<button class="btn btn-gh btn-sm" onclick="ecUnionEditToggle(true)">✎ Редактировать профиль</button>` : ''}
        <button class="btn btn-gh btn-sm" onclick="ecUnionLeave()">Выйти из союза</button>
      </div>`;
  } else {
    unionHtml = `<div class="ec-dip-t">🤝 Союз</div>
      <div class="ec-empty" style="padding:6px">Вы не в союзе. Создайте федерацию или конфедерацию и приглашайте державы.</div>
      <div class="ec-prod-form" style="margin-top:6px;flex-wrap:wrap">
        <input id="ec-union-name" placeholder="название союза" class="ec-loan-note" style="flex:1;min-width:140px">
        <select id="ec-union-kind" class="ec-prod-qty" style="width:auto"><option value="confederation">Конфедерация</option><option value="federation">Федерация</option></select>
        <button class="btn btn-gd btn-sm" onclick="ecUnionCreate()">Создать</button>
      </div>`;
  }
  const invHtml = (d.invites || []).map(i => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge new">приглашение</span> <b>${esc(i.name)}</b> (${i.kind === 'federation' ? 'федерация' : 'конфедерация'}) от ${esc(i.leader)}
    </span><button class="btn btn-gd btn-xs" onclick="ecUnionInviteRespond('${i.id}',true)">Вступить</button><button class="ec-bld-del" onclick="ecUnionInviteRespond('${i.id}',false)">✕</button></div>`).join('');

  const vassals = d.vassals || [];
  const myVassals = vassals.filter(v => v.overlord === EC.fid);
  const asVassal = vassals.filter(v => v.vassal === EC.fid);
  const vassalRows = myVassals.map(v => `<div class="ec-q-row"><span class="ec-r-name">${v.status === 'pending' ? '⏳ ' : '👑 '}Вассал <b>${esc(v.vassal_name)}</b> · дань ${Math.round(v.tribute_pct * 100)}%${v.status === 'pending' ? ' (ждёт ответа)' : ''}</span><button class="ec-bld-del" title="Разорвать" onclick="ecVassalBreak('${v.id}')">✕</button></div>`).join('');
  const overlordRows = asVassal.map(v => v.status === 'pending'
    ? `<div class="ec-q-row ec-route-row"><span class="ec-r-name"><span class="ec-route-badge new">вассалитет</span> <b>${esc(v.overlord_name)}</b> предлагает стать сюзереном · дань ${Math.round(v.tribute_pct * 100)}%</span><button class="btn btn-gd btn-xs" onclick="ecVassalRespond('${v.id}',true)">Принять</button><button class="ec-bld-del" onclick="ecVassalRespond('${v.id}',false)">✕</button></div>`
    : `<div class="ec-q-row"><span class="ec-r-name">Сюзерен <b>${esc(v.overlord_name)}</b> · дань ${Math.round(v.tribute_pct * 100)}%</span><button class="ec-bld-del" title="Разорвать" onclick="ecVassalBreak('${v.id}')">✕</button></div>`).join('');
  const amVassal = asVassal.some(v => v.status === 'active');
  const vassalBlock = `<div class="ec-dip-card"><div class="ec-dip-t">👑 Вассалитет <span class="ec-hint">вассал платит сюзерену дань с дохода</span></div>
      ${amVassal ? '<div class="ec-empty" style="padding:6px">Вы уже чей-то вассал — нельзя брать своих вассалов.</div>' : `<div class="ec-prod-form" style="flex-wrap:wrap">${ecFacSelect('ec-vassal-fac')}<input type="number" id="ec-vassal-pct" min="5" max="30" value="10" class="ec-prod-qty" style="width:70px" title="дань, %"><button class="btn btn-gd btn-sm" onclick="ecVassalPropose()">Сделать вассалом</button></div>`}
      ${vassalRows ? `<div class="ec-r-sec">Мои вассалы</div>${vassalRows}` : ''}
      ${overlordRows ? `<div class="ec-r-sec">Мой статус</div>${overlordRows}` : ''}
    </div>`;

  return `<div class="ec-dip-grid">
      <div class="ec-dip-card">${unionHtml}${invHtml ? `<div class="ec-r-sec">📥 Приглашения вам</div>${invHtml}` : ''}</div>
      ${vassalBlock}
    </div>`;
}
function ecUnionCreate() {
  const name = ecId('ec-union-name')?.value?.trim();
  const kind = ecId('ec-union-kind')?.value || 'confederation';
  if (!name) { toast('Введите название союза', 'err'); return; }
  ecRpcAct('union_create', { p_kind: kind, p_name: name }, 'Союз создан');
}
function ecUnionInvite() {
  const fid = ecId('ec-union-inv')?.value;
  if (!fid || !EC.diplo.union) { toast('Выберите фракцию', 'err'); return; }
  ecRpcAct('union_invite', { p_union_id: EC.diplo.union.id, p_target_fid: fid }, 'Приглашение отправлено');
}
function ecUnionInviteRespond(id, acc) { ecRpcAct('union_invite_respond', { p_invite_id: id, p_accept: !!acc }, acc ? 'Вы вступили в союз' : 'Приглашение отклонено'); }
function ecUnionLeave() { if (confirm('Выйти из союза?')) ecRpcAct('union_leave', {}, 'Вы вышли из союза'); }
// ── Профиль союза: редактирование лидером (через модерацию) ──
function ecUnionEditToggle(on) { EC.unionEditing = !!on; ecPaintCabinet(); }
function ecUnionEdit() {
  const name = ecId('ec-ue-name')?.value?.trim();
  const desc = ecId('ec-ue-desc')?.value?.trim() || null;
  const color = ecId('ec-ue-color')?.value || null;
  const herald = ecId('ec-ue-img')?.value?.trim() || null;
  if (!name) { toast('Введите название союза', 'err'); return; }
  EC.unionEditing = false;
  ecRpcAct('union_edit', { p_name: name, p_description: desc, p_color: color, p_herald_url: herald }, 'Профиль союза отправлен на модерацию');
}
// Флаг союза: загрузка в Storage через общий хелпер (как у веры)
function ecUnionImg(input, hiddenId, prevId) {
  const file = input.files && input.files[0]; if (!file) return;
  if (typeof handleImgUpload !== 'function') { toast('Загрузка недоступна', 'err'); return; }
  handleImgUpload(file, url => {
    const h = ecId(hiddenId); if (h) h.value = url;
    const p = ecId(prevId); if (p) p.innerHTML = `<img src="${esc(url)}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover;vertical-align:middle">`;
  });
}
function ecUnionImgClear(hiddenId, prevId) {
  const h = ecId(hiddenId); if (h) h.value = '';
  const p = ecId(prevId); if (p) p.innerHTML = '<span style="font-size:11px;color:var(--t4)">нет флага</span>';
}

// ── ВЕРА (религия) · справочник механики ────────────────────
// Подробное объяснение: что на что влияет, сколько, как, когда и почему.
// Числа берутся из faith_status (зеркало серверных формул _faith_setup.sql):
//   доход храма 150 ГС/слот/сут; скидка спирит/теократ 2%/слот до 30%,
//   прочие 1.2%/слот до 18%, флоту — половина; десятина основателю 20% (30 ГС/слот).
function ecFaithMechanics(fs) {
  const spirit   = !!fs.can_found;                       // спирит/теократ → усиленная вера
  const strength = fs.strength || 0;                     // паства = сумма слотов всех храмов
  const income   = fs.temple_income || 150;             // ГС за слот в сутки
  const disc     = Math.round((fs.unit_discount || 0) * 100);
  const tithePct = Math.round((fs.tithe_pct || 0.20) * 100);
  const perSlot  = spirit ? 2 : 1.2;                     // % скидки за слот
  const cap      = spirit ? 30 : 18;                     // потолок скидки
  const titheSlot = Math.round(income * (tithePct / 100)); // ГС основателю за слот адепта
  const dayIncome = strength * income;
  const isFounder = fs.role === 'founder';
  const isReco    = fs.role === 'recognized';

  // — Личные «сейчас» под каждое правило —
  const nowStrength = strength > 0
    ? `Сейчас у вас <b>${ecNum(strength)}</b> слот(ов) храмов.`
    : `Сейчас храмов нет — постройте Храм Веры во вкладке «Колонии», чтобы запустить все бонусы.`;
  const nowIncome = strength > 0
    ? `Сейчас: <b>${ecNum(strength)}</b> слот(ов) × ${income} = <b>+${ecNum(dayIncome)} ГС/сут</b>.`
    : `Сейчас: 0 ГС — нет храмов.`;
  let nowDisc;
  if (strength <= 0) {
    nowDisc = `Сейчас скидки нет — нужен хотя бы один слот храма.`;
  } else {
    const raw = strength * perSlot;
    const capped = raw >= cap;
    nowDisc = `Сейчас: ${ecNum(strength)} слот × ${perSlot}% = ${capped ? `${cap}% (достигнут потолок)` : `${(Math.round(raw * 10) / 10)}%`} → <b>−${disc}%</b> на наземные войска, <b>−${Math.round(disc / 2)}%</b> на флот.`;
  }
  const nowTithe = isFounder
    ? (() => {
        const fromAdepts = (fs.adepts || []).filter(a => a.role !== 'founder').reduce((s, a) => s + (a.flock || 0), 0);
        return fromAdepts > 0
          ? `Сейчас вам платят <b>${ecNum(fromAdepts)}</b> чужих слот(ов) → <b>+${ecNum(fromAdepts * titheSlot)} ГС/сут</b> десятины.`
          : `Сейчас адептов с храмами нет — рассылайте миссии признания, чтобы пошла десятина.`;
      })()
    : isReco
      ? `Сейчас вы под чужой верой: <b>${tithePct}%</b> дохода ваших храмов (${titheSlot} ГС/слот) уходит её основателю.`
      : `Касается только основателей вер.`;

  const row = (ic, t, d, now) => `<div class="ec-mech">
      <div class="ec-mech-ic">${ic}</div>
      <div class="ec-mech-bd">
        <div class="ec-mech-t">${t}</div>
        <div class="ec-mech-d">${d}</div>
        ${now ? `<div class="ec-mech-now">${now}</div>` : ''}
      </div>
    </div>`;

  return `<details class="ec-mech-wrap" open>
    <summary class="ec-section-title" style="cursor:pointer">📖 Как работает вера — подробно <span class="ec-hint">— что на что влияет, сколько, когда и почему</span></summary>
    <div class="ec-mech-grid">
      ${row('🛐', 'Сила веры (паства)',
        `<b>Что:</b> суммарное число слотов всех ваших Храмов Веры — это база, от которой считаются <b>все</b> бонусы ниже. <b>Как растёт:</b> стройте и расширяйте храмы во вкладке «Колонии» (каждое расширение = +слоты). <b>Почему:</b> чем шире паства, тем сильнее культ.`,
        nowStrength)}
      ${row('💰', 'Доход храмов',
        `<b>Сколько:</b> <b>+${income} ГС</b> за каждый слот в сутки. <b>Когда:</b> начисляется ежедневным тиком экономики, пока вы исповедуете религию храма. <b>Почему:</b> храмы — культовые предприятия, духовный аналог торговли. Доход прекращается, если отречься от веры храма.`,
        nowIncome)}
      ${row('⚔', 'Удешевление войск',
        `<b>Сколько:</b> ${spirit ? '<b>−2%</b> за слот, потолок <b>−30%</b>' : '<b>−1.2%</b> за слот, потолок <b>−18%</b>'} (вы — ${spirit ? 'спиритуалист/теократия, усиленная вера' : 'обычная держава'}). Корабли (флот) получают <b>половину</b> скидки. <b>Когда:</b> применяется при постройке войск и кораблей. <b>Почему:</b> вера вдохновляет народ на службу; духовным державам — сильнее.`,
        nowDisc)}
      ${row('🤝', `Десятина основателю (+${tithePct}%)`,
        `<b>Сколько:</b> основатель веры получает <b>${tithePct}%</b> дохода храмов каждого адепта = <b>${titheSlot} ГС</b> за чужой слот в сутки. <b>Когда:</b> ежедневным тиком, пока адепт исповедует вашу веру. <b>Почему:</b> награда за распространение — рассылайте миссии признания, чтобы паства (и десятина) росла.`,
        nowTithe)}
      ${row('🕊', 'Кто может исповедовать',
        `<b>Свободно</b> основать или принять веру могут идеология «Спиритуализм» и форма правления «Теократия» (и администрация). <b>Прочие</b> народы обращаются только по предложению признания от основателя. Своя религия — <b>лишь одна</b>; чужих можно исповедовать несколько.`,
        spirit ? `Вам открыт путь веры: можно основать свою и принимать чужие.` : `Вам нужно дождаться предложения признания от основателя веры.`)}
      ${row('🌐', 'Мультивера',
        `Держава может следовать <b>нескольким</b> верам сразу и строить храмы любой из них — при постройке храма выбираете его религию. Доход и бонусы каждого храма идут, пока вы исповедуете именно его веру.`,
        '')}
      ${row('🕳', 'Тайные секты',
        `Через шпионаж (операция «Тайная секта») вы внедряете культ в чужую державу. Секта работает как храм — <b>+${income} ГС/сут вам</b> — пока контрразведка хозяина её не вскроет. <b>Риск вскрытия</b> со временем растёт; вскрытую секту ликвидируют.`,
        '')}
    </div>
  </details>`;
}

// ── ВЕРА (религия) · слайс 1 ────────────────────────────────
// Спиритуалист/теократ основывает веру → исповедующие строят храмы (вкладка
// «Колонии», тип «Храм Веры») → +ГС и удешевление постройки войск.
function ecTabFaith() {
  const fs = EC.faith || { faith: null, can_found: false, strength: 0, unit_discount: 0, temple_income: 150 };
  const intro = ecIntro('🛐', 'Вера', 'Спиритуалисты и теократии основывают религии. Исповедующие строят Храмы Веры — каждый слот даёт пассивный доход и удешевляет постройку войск. Чем больше паствы (слотов храмов), тем сильнее эффект.', [
    '<b>Основать веру</b> могут идеология «Спиритуализм», форма правления «Теократия» и администрация (свою — только одну).',
    '<b>Несколько религий</b>: держава может исповедовать сразу несколько вер и строить храмы разных религий — при постройке храма указывается его религия.',
    '<b>Храм Веры</b> строится во вкладке «Колонии». Доход храма идёт, пока вы исповедуете его религию.',
  ]);

  // Карточка моей веры или блок основания/вступления
  const blessTile = (ic, v, l) => `<div class="ec-bless"><span class="ec-bless-ic">${ic}</span><span class="ec-bless-tx"><span class="ec-bless-v">${v}</span><span class="ec-bless-l">${l}</span></span></div>`;
  let mine;
  if (fs.faith) {
    const f = fs.faith;
    const fc = esc(f.color || '#c9a227');
    // ── Статус модерации контента ──
    const st = f.status || 'approved';
    const stBanner =
      st === 'pending' ? `<div class="ec-faith-status pend">⏳ Религия на модерации — название, догма и образ станут видны миру после одобрения администрации. Бонусы храмов уже действуют.</div>`
      : st === 'rejected' ? `<div class="ec-faith-status rej">✕ Религия отклонена администрацией.${f.reject_reason ? ` Причина: «${esc(f.reject_reason)}». ` : ' '}Отредактируйте её и подайте заново.</div>`
      : (f.pending_review ? `<div class="ec-faith-status pend">⏳ Изменения отправлены на проверку — мир пока видит прежний облик веры.${f.pending && f.pending.name ? ` Предложено: «${esc(f.pending.name)}».` : ''}</div>`
      : (f.reject_reason ? `<div class="ec-faith-status rej">✕ Прошлые изменения отклонены.${f.reject_reason ? ` Причина: «${esc(f.reject_reason)}».` : ''}</div>` : ''));
    const banner = f.image_url ? `<div class="ec-faith-banner" style="--faith-img:url('${esc(f.image_url)}')">
          <img src="${esc(f.image_url)}" alt="образ веры «${esc(f.name)}»" loading="lazy">
        </div>` : '';
    const disc = Math.round((fs.unit_discount || 0) * 100);
    const tithePct = Math.round((fs.tithe_pct || 0.20) * 100);
    const income = ecNum(fs.temple_income || 150);
    const strength = ecNum(fs.strength || 0);
    const isFounder = fs.role === 'founder';
    const roleTxt = isFounder ? '👑 Пророк-основатель' : fs.role === 'recognized' ? '🕊 Признавший веру' : '🙏 Адепт веры';
    // паства: прячем удалённые/несуществующие фракции (их fid не резолвится в имя)
    const adepts = (fs.adepts || []).filter(a => ecFacOf(a.fid));
    const adeptIc = r => r === 'founder' ? '👑 ' : r === 'recognized' ? '🕊 ' : '🙏 ';
    const adeptsHtml = adepts.map(a => `<span class="ec-faith-pew">${adeptIc(a.role)}${esc(ecFacName(a.fid))} · паства <b>${ecNum(a.flock)}</b></span>`).join('');
    // Распространение веры — только основатель
    const offersOut = (fs.offers_out || []);
    const offersOutHtml = offersOut.filter(o => ecFacOf(o.to_fid)).map(o => `<div class="ec-faith-mission"><span class="ec-faith-mission-ic">✉</span><span>Миссионеры в пути: <b>${esc(ecFacName(o.to_fid))}</b></span></div>`).join('');
    const others = (typeof ecOtherFactions === 'function' ? ecOtherFactions() : []);
    const spreadBlock = isFounder ? `<div class="ec-bless-hd" style="margin-top:16px">Распространение веры — десятина +${tithePct}%</div>
        <div class="ec-shrine-note">Отправьте миссионеров к чужой державе: признав вашу веру, она станет возводить ваши храмы, а с их дохода вам потечёт десятина (+${tithePct}%).</div>
        ${others.length ? `<div class="ec-prod-form" style="margin-top:8px">${ecFacSelect('ec-faith-reco')}<button class="btn btn-gd btn-sm" onclick="ecFaithOffer()">Предложить признание</button></div>` : '<div class="ec-empty">Нет других держав.</div>'}
        ${offersOutHtml ? `<div style="margin-top:8px">${offersOutHtml}</div>` : ''}` : '';
    const editForm = (isFounder && EC.faithEditing) ? `<div class="ec-faith-edit">
          <div class="ec-bless-hd" style="margin-top:0">Редактирование веры — изменения уйдут на модерацию</div>
          <div class="ec-prod-form" style="flex-wrap:wrap">
            <input id="ec-fe-name" placeholder="имя веры" class="ec-loan-note" style="flex:1;min-width:160px" maxlength="60" value="${esc(f.name || '')}">
            <input id="ec-fe-color" type="color" value="${esc(f.color || '#c9a227')}" class="ec-prod-qty" style="width:46px;padding:2px" title="священный цвет">
          </div>
          <input id="ec-fe-dogma" placeholder="священный девиз / догмат (необязательно)" class="ec-loan-note" style="margin-top:8px;width:100%" maxlength="160" value="${esc(f.dogma || '')}">
          <input type="hidden" id="ec-fe-img" value="${esc(f.image_url || '')}">
          <div class="ec-faith-imgrow">
            <div class="ec-faith-imgprev" id="ec-fe-imgprev">${f.image_url ? `<img src="${esc(f.image_url)}" alt="">` : '<span>нет образа</span>'}</div>
            <label class="btn btn-gh btn-sm">📷 Образ веры<input type="file" accept="image/*" style="display:none" onchange="ecFaithImg(this,'ec-fe-img','ec-fe-imgprev')"></label>
            ${f.image_url ? `<button class="btn btn-gh btn-sm" onclick="ecFaithImgClear('ec-fe-img','ec-fe-imgprev')">Убрать</button>` : ''}
          </div>
          <div style="margin-top:10px;display:flex;gap:8px">
            <button class="btn btn-gd btn-sm" onclick="ecFaithEdit()">Отправить на модерацию</button>
            <button class="btn btn-gh btn-sm" onclick="ecFaithEditToggle(false)">Отмена</button>
          </div>
        </div>` : '';
    mine = `<div class="ec-shrine" style="--fc:${fc}">
        ${stBanner}
        ${banner}
        <div class="ec-shrine-hd">
          <div class="ec-shrine-sigil">🛐</div>
          <div><div class="ec-shrine-name">«${esc(f.name)}»</div>
            <div class="ec-shrine-role">${roleTxt} · ${ecNum(adepts.length)} народ(ов) в лоне веры</div></div>
        </div>
        ${f.dogma ? `<div class="ec-shrine-dogma">«${esc(f.dogma)}»</div>` : ''}
        ${editForm}
        <div class="ec-bless-hd">Благословения веры — паства ${strength} слот(ов) храмов</div>
        <div class="ec-bless-grid">
          ${blessTile('💰', '+' + income, 'ГС с каждого храма')}
          ${blessTile('⚔', '−' + disc + '%', disc > 0 ? 'дешевле войска (флот — вдвое)' : 'войска (стройте храмы)')}
          ${blessTile('🛐', strength, 'сила паствы')}
          ${isFounder ? blessTile('🤝', '+' + tithePct + '%', 'десятина с адептов') : ''}
        </div>
        ${fs.role === 'recognized' ? `<div class="ec-shrine-note" style="margin-top:10px">🕊 Вы под покровительством чужой веры: с дохода ваших храмов её основатель взимает десятину ${tithePct}%.</div>` : ''}
        ${adeptsHtml ? `<div class="ec-bless-hd" style="margin-top:16px">Паства веры</div><div>${adeptsHtml}</div>` : ''}
        ${spreadBlock}
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          ${(isFounder && !EC.faithEditing) ? `<button class="btn btn-gd btn-sm" onclick="ecFaithEditToggle(true)">✎ Редактировать веру</button>` : ''}
          <button class="btn btn-gh btn-sm" onclick="ecFaithLeave('${f.id}')">Отречься от веры</button>
        </div>
      </div>`;
  } else if (fs.can_found) {
    mine = ecFaithFoundCard(false);
  } else {
    mine = `<div class="ec-shrine" style="--fc:#6a6f7a">
        <div class="ec-shrine-hd"><div class="ec-shrine-sigil">🔒</div>
          <div><div class="ec-shrine-name" style="color:var(--t3)">Путь веры закрыт</div>
            <div class="ec-shrine-role">нужна духовная природа державы</div></div></div>
        <div class="ec-shrine-note">Учреждать и принимать веру по своей воле могут лишь державы с идеологией «Спиритуализм» или формой правления «Теократия». Прочие народы могут обратиться в чужую веру только по зову её основателя — следите за предложениями признания.</div>
      </div>`;
  }

  // Мультивера: все исповедуемые религии (с ролью, паствой и кнопкой отречься)
  const myFaiths = (fs.faiths || []);
  // спиритуалист/теократ, уже исповедующий чужую веру, всё ещё может основать СВОЮ (одну)
  const hasFounded = myFaiths.some(f => f.role === 'founder');
  if (fs.faith && fs.can_found && !hasFounded) mine += ecFaithFoundCard(true);
  const followedIds = new Set(myFaiths.map(f => f.id));
  const roleIc = r => r === 'founder' ? '👑' : r === 'recognized' ? '🕊' : '🙏';
  const roleNm = r => r === 'founder' ? 'основатель' : r === 'recognized' ? 'признавший' : 'адепт';
  const followedHtml = myFaiths.length > 1 ? `<div class="ec-section-title">Исповедуемые религии <span class="ec-hint">— ваша держава следует ${ecNum(myFaiths.length)} вер(ам); храмы можно строить любой</span></div>
    <div class="ec-dip-card">${myFaiths.map(f => {
      const fc = esc(f.color || '#c9a227');
      const st = f.status && f.status !== 'approved' ? ` <span class="ec-q-t">(${f.status === 'pending' ? 'на модерации' : 'отклонена'})</span>` : '';
      return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${fc};margin-right:6px"></span>
          <b style="color:${fc}">«${esc(f.name)}»</b> · ${roleIc(f.role)} ${roleNm(f.role)} · паства ${ecNum(f.flock || 0)}${st}
        </span><button class="ec-bld-del" title="Отречься от этой веры" onclick="ecFaithLeave('${f.id}')">✕</button></div>`;
    }).join('')}</div>` : '';

  // Реестр религий мира
  const list = EC.faithList || [];
  const canJoin = fs.can_found;   // мультивера: спиритуалист/теократ может принять ещё одну веру
  const rows = list.map(f => {
    const isMine = followedIds.has(f.id);
    const joinBtn = isMine ? '' : (canJoin && f.open) ? `<button class="btn btn-gd btn-xs" onclick="ecFaithJoin('${f.id}')">Принять</button>` : (f.open ? '' : '<span class="ec-q-t">закрыта</span>');
    const thumb = f.image_url
      ? `<span class="ec-faith-thumb" style="background-image:url('${esc(f.image_url)}')"></span>`
      : `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(f.color || '#c9a227')};margin-right:6px"></span>`;
    return `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
        ${thumb}
        <b style="color:${esc(f.color || '#c9a227')}">${esc(f.name)}</b>${isMine ? ' <span class="ec-hint">— ваша</span>' : ''} · ${ecNum(f.adepts)} адепт(ов) · паства ${ecNum(f.flock)}
        <span class="ec-hint">основатель ${esc(ecFacName(f.founder_fid))}</span>
      </span><span style="display:inline-flex;gap:6px"><button class="btn btn-gh btn-xs" onclick="ecFaithDetail('${f.id}')">Подробнее</button>${isMine ? '' : joinBtn}</span></div>`;
  }).join('');
  const registry = `<div class="ec-section-title">Религии мира <span class="ec-hint">— реестр всех вер</span></div>
    ${list.length ? `<div class="ec-dip-card">${rows}</div>` : '<div class="ec-empty">Ни одной веры ещё не основано.</div>'}`;

  // Входящие предложения признания — видны любой фракции без веры (в т.ч. не-спиритуалистам)
  const offersIn = (fs.offers_in || []);
  const offersInHtml = offersIn.length ? `<div class="ec-section-title">Предложения признания <span class="ec-hint">— вам предлагают принять веру</span></div>
    <div class="ec-dip-card">${offersIn.map(o => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
        <span class="ec-route-badge new">признание</span> <b style="color:${esc(o.faith_color || '#c9a227')}">«${esc(o.faith_name)}»</b> от ${esc(ecFacName(o.from_fid))} — сможете строить храмы этой веры
      </span><button class="btn btn-gd btn-xs" onclick="ecFaithOfferRespond('${o.id}',true)">Принять</button><button class="ec-bld-del" onclick="ecFaithOfferRespond('${o.id}',false)">✕</button></div>`).join('')}</div>` : '';

  // Мои тайные секты (covert temples в чужих державах) + риск вскрытия
  const sects = (fs.sects || []);
  const sectsHtml = sects.length ? `<div class="ec-section-title">🕳 Тайные секты <span class="ec-hint">— работают как храмы, пока не вскроют</span></div>
    <div class="ec-dip-card">${sects.map(s => {
      const exp = Math.round(s.exposure || 0);
      const col = exp >= 67 ? 'var(--err)' : exp >= 34 ? 'var(--color-warning,#e0a030)' : 'var(--ok)';
      return `<div class="ec-q-row"><span class="ec-r-name">🕳 секта в <b>${esc(ecFacName(s.host_fid))}</b> · +150 ГС/сут</span>
        <span class="ec-hint" title="риск вскрытия контрразведкой хозяина">вскрытие <b style="color:${col}">${exp}%</b></span></div>`;
    }).join('')}</div>` : '';
  // Вскрытые секты на МОЕЙ территории
  const exposedHere = (fs.exposed_here || []);
  const exposedHtml = exposedHere.length ? `<div class="ec-section-title">🛐 Вскрыто контрразведкой <span class="ec-hint">— чужие секты у вас</span></div>
    <div class="ec-dip-card">${exposedHere.map(e => `<div class="ec-q-row"><span class="ec-r-name">⚠ ликвидирована секта веры <b>«${esc(e.faith_name || '—')}»</b> — насаждала <b>${esc(ecFacName(e.owner_fid))}</b></span></div>`).join('')}</div>` : '';

  return `${intro}
    ${ecFaithMechanics(fs)}
    ${offersInHtml}
    <div class="ec-section-title">🛐 Ваша вера</div>
    ${mine}
    ${followedHtml}
    ${sectsHtml}
    ${exposedHtml}
    ${registry}`;
}
// Карточка основания веры. additional=true — когда держава уже исповедует другие веры.
function ecFaithFoundCard(additional) {
  const title = additional ? 'Основать собственную веру' : 'Провозгласить веру';
  const role = additional ? 'у вас может быть лишь одна СВОЯ религия' : 'ваш народ ещё не обрёл высшего смысла';
  const note = additional
    ? 'Вы вольны исповедовать чужие веры, но провозгласить можете и собственную религию — основать дозволено только одну.'
    : 'Учредите новый культ и поведите за собой народы — либо примите одну из уже сияющих в галактике религий ниже.';
  return `<div class="ec-shrine" style="--fc:#c9a227${additional ? ';margin-top:14px' : ''}">
        <div class="ec-shrine-hd"><div class="ec-shrine-sigil">✶</div>
          <div><div class="ec-shrine-name" style="color:var(--gd)">${title}</div>
            <div class="ec-shrine-role">${role}</div></div></div>
        <div class="ec-shrine-note">${note}</div>
        <div class="ec-shrine-note" style="color:var(--t4)">Новая религия проходит модерацию администрации, как анкета фракции: её облик станет виден миру после одобрения. Бонусы храмов действуют сразу.</div>
        <div class="ec-prod-form" style="margin-top:12px;flex-wrap:wrap">
          <input id="ec-faith-name" placeholder="имя веры" class="ec-loan-note" style="flex:1;min-width:160px" maxlength="60">
          <input id="ec-faith-color" type="color" value="#c9a227" class="ec-prod-qty" style="width:46px;padding:2px" title="священный цвет">
          <button class="btn btn-gd btn-sm" onclick="ecFaithFound()">Провозгласить</button>
        </div>
        <input id="ec-faith-dogma" placeholder="священный девиз / догмат (необязательно)" class="ec-loan-note" style="margin-top:8px;width:100%" maxlength="160">
        <input type="hidden" id="ec-faith-img" value="">
        <div class="ec-faith-imgrow">
          <div class="ec-faith-imgprev" id="ec-faith-imgprev"><span>нет образа</span></div>
          <label class="btn btn-gh btn-sm">📷 Образ веры<input type="file" accept="image/*" style="display:none" onchange="ecFaithImg(this,'ec-faith-img','ec-faith-imgprev')"></label>
        </div>
      </div>`;
}
function ecFaithOffer() {
  const fid = ecId('ec-faith-reco')?.value;
  if (!fid) { toast('Выберите державу', 'err'); return; }
  ecRpcAct('faith_offer_recognition', { p_to_fid: fid }, 'Признание предложено');
}
function ecFaithOfferRespond(id, acc) { ecRpcAct('faith_offer_respond', { p_offer_id: id, p_accept: !!acc }, acc ? 'Вы признали веру' : 'Предложение отклонено'); }
function ecFaithFound() {
  const name = ecId('ec-faith-name')?.value?.trim();
  const dogma = ecId('ec-faith-dogma')?.value?.trim() || null;
  const color = ecId('ec-faith-color')?.value || null;
  const image = ecId('ec-faith-img')?.value?.trim() || null;
  if (!name) { toast('Введите название веры', 'err'); return; }
  ecRpcAct('faith_found', { p_name: name, p_dogma: dogma, p_color: color, p_image_url: image }, 'Вера основана — отправлена на модерацию');
}
function ecFaithJoin(id) { ecRpcAct('faith_join', { p_faith_id: id }, 'Вы приняли веру'); }
function ecFaithLeave(faithId) {
  if (!faithId) return;
  const fa = (EC.faithById && EC.faithById[faithId]) || null;
  const name = fa && fa.name;
  if (confirm('Отречься от веры' + (name ? ` «${name}»` : '') + '? Доход её храмов прекратится.')) ecRpcAct('faith_leave', { p_faith_id: faithId }, 'Вы отреклись от веры');
}
// ── Картинка веры: загрузка в Storage через общий хелпер ─────
function ecFaithImg(input, hiddenId, prevId) {
  const file = input.files && input.files[0]; if (!file) return;
  if (typeof handleImgUpload !== 'function') { toast('Загрузка недоступна', 'err'); return; }
  handleImgUpload(file, url => {
    const h = ecId(hiddenId); if (h) h.value = url;
    const p = ecId(prevId); if (p) p.innerHTML = `<img src="${esc(url)}" alt="">`;
  });
}
function ecFaithImgClear(hiddenId, prevId) {
  const h = ecId(hiddenId); if (h) h.value = '';
  const p = ecId(prevId); if (p) p.innerHTML = '<span>нет образа</span>';
}
// ── Редактирование веры основателем (через модерацию) ───────
function ecFaithEditToggle(on) { EC.faithEditing = !!on; ecPaintCabinet(); }
function ecFaithEdit() {
  const name = ecId('ec-fe-name')?.value?.trim();
  const dogma = ecId('ec-fe-dogma')?.value?.trim() || null;
  const color = ecId('ec-fe-color')?.value || null;
  const image = ecId('ec-fe-img')?.value?.trim() || null;
  if (!name) { toast('Введите название веры', 'err'); return; }
  EC.faithEditing = false;
  ecRpcAct('faith_edit', { p_name: name, p_dogma: dogma, p_color: color, p_image_url: image }, 'Изменения отправлены на модерацию');
}
// ── Просмотр религии с описанием — модалка (видно всем) ─────
async function ecFaithDetail(id) {
  let d;
  try { d = await ecRpc('faith_detail', { p_faith_id: id }); }
  catch (e) { toast(ecErr(e.message), 'err'); return; }
  if (!d) return;
  const fc = esc(d.color || '#c9a227');
  const adeptIc = r => r === 'founder' ? '👑 ' : r === 'recognized' ? '🕊 ' : '🙏 ';
  const adepts = (d.adepts || []).map(a => `<span class="ec-faith-pew">${adeptIc(a.role)}${esc(ecFacName(a.fid))} · паства <b>${ecNum(a.flock)}</b></span>`).join('');
  const heroStyleM = d.image_url ? ` style="--faith-img:url('${esc(d.image_url)}')"` : '';
  const heroClassM = `ec-faith-hero${d.image_url ? ' has-img' : ''}`;
  const html = `<div class="ec-faith-modal-back" onclick="ecFaithDetailClose(event)">
    <div class="ec-faith-modal ec-shrine" style="--fc:${fc}" onclick="event.stopPropagation()">
      <button class="ec-faith-modal-x" onclick="ecFaithDetailClose()">✕</button>
      <div class="${heroClassM}"${heroStyleM}>
        <div class="ec-shrine-hd"><div class="ec-shrine-sigil">🛐</div>
          <div><div class="ec-shrine-name">«${esc(d.name)}»</div>
            <div class="ec-shrine-role">основатель ${esc(ecFacName(d.founder_fid))} · ${ecNum((d.adepts || []).length)} народ(ов) · паства ${ecNum(d.flock || 0)}</div></div></div>
      </div>
      ${d.dogma ? `<div class="ec-shrine-dogma">«${esc(d.dogma)}»</div>` : '<div class="ec-shrine-note">Догмат веры не записан.</div>'}
      ${adepts ? `<div class="ec-bless-hd" style="margin-top:16px">Паства веры</div><div>${adepts}</div>` : ''}
    </div></div>`;
  const wrap = document.createElement('div');
  wrap.id = 'ec-faith-modal-host';
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
}
function ecFaithDetailClose(ev) {
  if (ev && ev.target && !ev.target.classList.contains('ec-faith-modal-back') && ev.target.tagName !== 'BUTTON') return;
  document.getElementById('ec-faith-modal-host')?.remove();
}
function ecVassalPropose() {
  const fid = ecId('ec-vassal-fac')?.value;
  const pct = Math.max(5, Math.min(30, parseInt(ecId('ec-vassal-pct')?.value) || 10)) / 100;
  if (!fid) { toast('Выберите фракцию', 'err'); return; }
  ecRpcAct('vassal_propose', { p_target_fid: fid, p_tribute_pct: pct }, 'Предложение вассалитета отправлено');
}
function ecVassalRespond(id, acc) { ecRpcAct('vassal_respond', { p_id: id, p_accept: !!acc }, acc ? 'Вассалитет принят' : 'Отклонено'); }
function ecVassalBreak(id) { if (confirm('Разорвать вассалитет?')) ecRpcAct('vassal_break', { p_id: id }, 'Вассалитет разорван'); }

// ── Блок «Обмен» (бартер): отдать/запросить ГС·ОН·ресурсы·корабли ──
function ecBarterBlock(others, noOthers, stock) {
  if (noOthers) return `<div class="ec-dip-card"><div class="ec-dip-t">Обмен</div><div class="ec-empty">Нет других фракций.</div></div>`;
  if (!EC.bt) EC.bt = { give: [], want: [] };

  // входящие/исходящие предложения обмена
  const inOf = (EC.barters || []).filter(o => o.to_fid === EC.fid);
  const outOf = (EC.barters || []).filter(o => o.from_fid === EC.fid);
  const inHtml = inOf.map(o => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge new">обмен</span>
      <b>${esc(ecFacName(o.from_fid))}</b>: вы получите <b style="color:var(--gd)">${esc(ecBarterSummary(o.give))}</b> за <b style="color:var(--color-warning,#e0a030)">${esc(ecBarterSummary(o.want))}</b>
    </span><button class="btn btn-gd btn-xs" title="Принять обмен" onclick="ecBarterAccept('${o.id}')">Принять</button><button class="ec-bld-del" title="Отклонить" onclick="ecBarterReject('${o.id}')">✕</button></div>`).join('');
  const outHtml = outOf.map(o => `<div class="ec-q-row ec-route-row"><span class="ec-r-name">
      <span class="ec-route-badge wait">⏳ ждёт ответа</span>
      → <b>${esc(ecFacName(o.to_fid))}</b>: отдаёте <b>${esc(ecBarterSummary(o.give))}</b> за <b>${esc(ecBarterSummary(o.want))}</b>
    </span><button class="ec-bld-del" title="Отозвать" onclick="ecBarterCancel('${o.id}')">✕</button></div>`).join('');

  const inBadge = inOf.length ? `<span class="ec-route-badge new">${inOf.length} вам</span>` : '';
  return `<div class="ec-dip-card ec-bt-card"><div class="ec-dip-t"><span>Обмен ${inBadge}</span><span class="ec-hint">подарок или сделка «отдать ↔ получить»</span></div>
      <div class="ec-bt-fac">${ecFacSelect('ec-bt-fac')}</div>
      <div class="ec-bt-cols">
        <div class="ec-bt-col"><div class="ec-bt-col-t">📤 Вы отдаёте</div><div id="ec-bt-give-box">${ecBarterBoxHtml('give')}</div></div>
        <div class="ec-bt-col"><div class="ec-bt-col-t">📥 Хотите взамен <span class="ec-hint">пусто = подарок</span></div><div id="ec-bt-want-box">${ecBarterBoxHtml('want')}</div></div>
      </div>
      <button class="btn btn-gd btn-sm ec-bt-send" onclick="ecBarterPropose()">Предложить обмен</button>
      <div class="ec-r-sec">📥 Входящие предложения${inOf.length ? '' : ' <span class="ec-hint">— нажмите «Принять», когда появятся</span>'}</div>
      ${inHtml || '<div class="ec-empty" style="padding:8px">Пока никто не предложил вам обмен. Чужие предложения появятся здесь с кнопкой «Принять».</div>'}
      <div class="ec-r-sec">📤 Отправленные вами</div>
      ${outHtml || '<div class="ec-empty" style="padding:8px">Вы пока не отправляли предложений.</div>'}
    </div>`;
}
// Подпись добавленной позиции обмена
function ecBarterItemLabel(it) {
  if (it.kind === 'gc') return `${ecNum(it.qty)} ГС`;
  if (it.kind === 'science') return `${ecNum(it.qty)} ОН`;
  if (it.kind === 'ship') return `${ecNum(it.qty)}× ${it.name}`;
  return `${ecNum(it.qty)} ${it.name}`;
}
// Список добавленных позиций (чипы) + строка добавления
function ecBarterBoxHtml(side) {
  const items = (EC.bt && EC.bt[side]) || [];
  const list = items.length
    ? items.map((it, i) => `<span class="ec-bt-chip"><span>${esc(ecBarterItemLabel(it))}</span><button title="Убрать" onclick="ecBarterDel('${side}',${i})">✕</button></span>`).join('')
    : `<div class="ec-bt-empty">${side === 'give' ? 'ничего не выбрано' : 'пусто — будет подарок'}</div>`;
  return `<div class="ec-bt-chips">${list}</div>${ecBarterAddRow(side)}`;
}
// Строка «тип → значение → ＋». Поля зависят от выбранного типа.
function ecBarterAddRow(side) {
  const kind = (EC.bt && EC.bt[side + 'Kind']) || 'gc';
  let valHtml;
  if (kind === 'gc' || kind === 'science') {
    valHtml = `<input type="number" id="ec-bt-${side}-val" min="1" placeholder="сумма" class="ec-bt-num">`;
  } else if (kind === 'resource') {
    if (side === 'give') {
      const opts = ecResEntries().map(([n, v]) => `<option value="${esc(n)}">${esc(n)} (${ecNum(v)})</option>`).join('') || '<option value="">— нет —</option>';
      valHtml = `<select id="ec-bt-${side}-name">${opts}</select><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    } else {
      valHtml = `<input id="ec-bt-${side}-name" placeholder="ресурс" class="ec-bt-name"><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    }
  } else { // ship
    if (side === 'give') {
      const opts = ecMyShipList().map(s => `<option value="${esc(s.name)}">${esc(s.name)} (${ecNum(s.qty)})</option>`).join('') || '<option value="">— нет —</option>';
      valHtml = `<select id="ec-bt-${side}-name">${opts}</select><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    } else {
      valHtml = `<input id="ec-bt-${side}-name" placeholder="корабль" class="ec-bt-name"><input type="number" id="ec-bt-${side}-val" min="1" placeholder="кол-во" class="ec-prod-qty">`;
    }
  }
  return `<div class="ec-bt-add">
      <select class="ec-bt-kind" onchange="ecBarterKind('${side}',this.value)">
        <option value="gc"${kind === 'gc' ? ' selected' : ''}>ГС</option>
        <option value="science"${kind === 'science' ? ' selected' : ''}>ОН</option>
        <option value="resource"${kind === 'resource' ? ' selected' : ''}>Ресурс</option>
        <option value="ship"${kind === 'ship' ? ' selected' : ''}>Корабль</option>
      </select>
      ${valHtml}
      <button class="btn btn-gh btn-xs ec-bt-addbtn" title="Добавить" onclick="ecBarterAdd('${side}')">＋</button>
    </div>`;
}
function ecBarterRefresh(side) { const box = ecId(`ec-bt-${side}-box`); if (box) box.innerHTML = ecBarterBoxHtml(side); }
function ecBarterKind(side, v) { EC.bt[side + 'Kind'] = v; ecBarterRefresh(side); }
function ecBarterAdd(side) {
  if (!EC.bt) EC.bt = { give: [], want: [] };
  const kind = EC.bt[side + 'Kind'] || 'gc';
  const qty = Math.max(0, parseInt(ecId(`ec-bt-${side}-val`)?.value) || 0);
  if (!qty) { toast('Укажите количество', 'err'); return; }
  let name = null;
  if (kind === 'resource' || kind === 'ship') {
    name = (ecId(`ec-bt-${side}-name`)?.value || '').trim();
    if (!name) { toast(kind === 'ship' ? 'Укажите корабль' : 'Укажите ресурс', 'err'); return; }
  }
  EC.bt[side] = EC.bt[side] || [];
  const ex = EC.bt[side].find(it => it.kind === kind && it.name === name);
  if (ex) ex.qty += qty; else EC.bt[side].push({ kind, name, qty });
  ecBarterRefresh(side);
}
function ecBarterDel(side, i) { if (EC.bt && EC.bt[side]) { EC.bt[side].splice(i, 1); ecBarterRefresh(side); } }

// ── Разведка: визуальные конструкторы карточек (срез UI 2.0) ──
// Статусы агента (зеркало stBadge): обучение / на операции / готов.
const EC_SPY_ST = {
  training:     { t: 'обучается',       c: 'var(--color-warning,#e0a030)', ic: '🎓' },
  busy:         { t: 'на операции',     c: 'var(--te,#5fd0c0)',            ic: '🛰' },
  counterintel: { t: 'в контрразведке', c: 'var(--pu,#b07bd8)',           ic: '🛡' },
  ready:        { t: 'в строю',         c: 'var(--ok,#7bd88f)',            ic: '✓' },
};
// Какие агенты назначены в контрразведку — теперь ИМЕННО (faction_counterintel),
// а не «последние N». Берём из EC.spyCounter.assignments (срез _spy_fleet_ops).
function ecSpyCounterIds() {
  return new Set(((EC.spyCounter && EC.spyCounter.assignments) || []).map(x => x.agent_id));
}
// Роль агента в контрразведке ('state' | 'forces' | null).
function ecSpyCounterRole(id) {
  const a = ((EC.spyCounter && EC.spyCounter.assignments) || []).find(x => x.agent_id === id);
  return a ? a.role : null;
}
// Поставить/снять агента в роль контрразведки (state=государство, forces=ВС).
function ecCounterAgent(id, role, on) {
  ecRpcAct('spy_counter_set', { p_agent_id: id, p_role: role, p_on: on },
    on ? 'Агент в контрразведке' : 'Агент снят с защиты');
}
// Подгрузка видимых флотов всех держав (для селектора цели диверсии). Кэш в EC.fleetsVisible.
async function ecLoadFleetsVisible() {
  try {
    const r = await ecRpc('fleets_visible');
    EC.fleetsVisible = Array.isArray(r) ? r : [];
  } catch (e) { EC.fleetsVisible = EC.fleetsVisible || []; }
  if (typeof ecSpyCalcLive === 'function') ecSpyCalcLive();   // обновить селектор, если планировщик открыт
}
// Из выпадающего списка: ставит выбранного агента в роль.
function ecCounterPick(role, sel) {
  const id = sel && sel.value; if (!id) return;
  ecCounterAgent(id, role, true);
}
// Блок «Контрразведка» с двумя ролями и поимённым выбором агентов.
function ecCounterIntelBlock(free) {
  const assigns = (EC.spyCounter && EC.spyCounter.assignments) || [];
  const ready = ecSpyReadyAgents();                       // готовые, не на операции
  const roster = ecSpyRoster ? ecSpyRoster() : ((EC.spyAgency || {}).roster || []);
  const byId = id => roster.find(a => a.id === id) || assigns.find(a => a.agent_id === id) || {};
  // свободные для назначения = готовые и ещё не в контрразведке
  const assignedSet = new Set(assigns.map(a => a.agent_id));
  const freeAgents = ready.filter(a => !assignedSet.has(a.id));
  const roleCol = (role, label, icon, sub) => {
    const mine = assigns.filter(a => a.role === role);
    const chips = mine.length ? mine.map(a => {
      const ag = byId(a.agent_id); const pk = ecPerk(a.perk || ag.perk);
      return `<span class="ec-ci-chip" style="border-color:${ecPerkColor(a.perk || ag.perk)}">
          ${pk.icon} <b>${esc((a.first_name || ag.first_name || '') + ' ' + (a.last_name || ag.last_name || ''))}</b>
          <i style="opacity:.7;font-style:normal">ур.${a.level || ag.level || 1}</i>
          <button class="ec-ci-x" title="Снять с защиты" onclick="ecCounterAgent('${esc(a.agent_id)}','${role}',false)">✕</button>
        </span>`;
    }).join('') : '<i style="color:var(--t4);font-style:normal">никто не назначен</i>';
    const opts = freeAgents.map(a => `<option value="${esc(a.id)}">${esc(a.first_name + ' ' + a.last_name)} · ${ecPerk(a.perk).label} · ур.${a.level || 1}</option>`).join('');
    const picker = freeAgents.length
      ? `<select class="ec-ci-sel" onchange="ecCounterPick('${role}', this)"><option value="">＋ поставить агента…</option>${opts}</select>`
      : '<i style="color:var(--t4);font-style:normal">свободных агентов нет</i>';
    return `<div class="ec-ci-col">
        <div class="ec-ci-col-t"><b>${icon} ${esc(label)}</b> <i style="color:var(--t4);font-style:normal">${esc(sub)}</i></div>
        <div class="ec-ci-chips">${chips}</div>
        <div class="ec-ci-add">${picker}</div>
      </div>`;
  };
  // Колонии — защита конкретной колонии от саботажа по ней (роль = id колонии).
  const colCols = (EC.colonies || []).map(c =>
    roleCol(c.id, c.planet_name || 'Колония', '🏗', 'защита этой колонии от саботажа по ней')).join('');
  return `<div class="ec-dip-card"><div class="ec-dip-t">🛡 Контрразведка <span class="ec-hint">в защите: ${ecNum((EC.eco && EC.eco.counter_agents) || 0)} · свободно ${ecNum(free)}</span></div>
      <div class="ec-ci-cols" style="display:flex;gap:10px;flex-wrap:wrap">
        ${roleCol('state', 'Защита государства', '🏛', 'ловит шпионов кабинета: казна, технологии, дестабилизация')}
        ${roleCol('forces', 'Защита вооружённых сил', '⚔', 'сопротивление диверсиям против флота (подпространственная охота, саботаж)')}
        ${colCols}
      </div>
      <div class="cn-fac-hint" style="margin-top:6px">Ставьте <b>конкретных</b> агентов в роль. Чем выше их уровень — тем сильнее защита (мощь: 🏛 ${ecNum((EC.spyCounter || {}).state_power || 0)} · ⚔ ${ecNum((EC.spyCounter || {}).forces_power || 0)}). <b>Центр</b> ловит шпионов по казне/технологиям, <b>колония</b> — саботаж именно по ней, <b>ВС</b> — диверсии против флота. Назначенные агенты не идут на операции.</div></div>`;
}
// Бейдж уровня в виде шевронов (RP-погоны): заполнено = уровень, всего 5.
function ecLevelPips(lv) {
  const n = Math.max(1, Math.min(5, lv || 1));
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<i class="ec-pip${i <= n ? ' on' : ''}"></i>`;
  return `<span class="ec-pips" title="Уровень ${n}/5">${s}</span>`;
}
// Портрет-аватар агента: тайл с иконкой перка, цвет — по специальности.
function ecAgentPortrait(a, size) {
  const s = size || 46; const col = ecPerkColor(a.perk);
  const pk = ecPerk(a.perk);
  const ring = a.status === 'busy' ? 'var(--te,#5fd0c0)' : a.status === 'training' ? 'var(--color-warning,#e0a030)' : col;
  return `<span class="ec-agent-pic" style="width:${s}px;height:${s}px;border-color:${ring};background:color-mix(in srgb, ${col} 16%, var(--b0,#0c1322))" title="${esc(pk.label)}">
    <span class="ec-agent-pic-ic">${pk.icon}</span>
    <b class="ec-agent-pic-lv" style="background:${col}">${Math.max(1, a.level || 1)}</b></span>`;
}
// Детерминированный хэш строки (FNV-1a) — чтобы портрет агента не «прыгал» между рендерами.
function ecHash(str) { let h = 2166136261; for (let i = 0; i < (str || '').length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// Подбор портрета агенту из общего пула (EC.spyPortraits): сперва раса+пол,
// затем только раса, затем «универсальные» (без расы), затем любой. Выбор
// СТАБИЛЕН (seed = id агента), поэтому портрет закреплён за конкретным агентом.
// Может ли раса брать обезличенный/гуманоидный арт по фолбэку. Гуманоиды,
// млекопитающие и неизвестная раса — да; экзотика — нет (иначе у растения/робота
// лицо гуманоида). Подбор арта именно по расе всё равно работает, если он загружен.
function ecRaceAllowsGenericArt(race) {
  if (!race) return true;
  return race === 'Гуманоиды' || race === 'Млекопитающие';
}
function ecAgentPortraitUrl(a) {
  const pool = (EC.spyPortraits || []).filter(p => p && p.url);
  if (!pool.length) return null;
  const race = a.race, gender = a.gender;
  let cand = pool.filter(p => p.race === race && p.gender === gender);
  if (!cand.length) cand = pool.filter(p => p.race === race && (!p.gender || p.gender === gender));
  if (!cand.length) cand = pool.filter(p => p.race === race);
  // Только «человекоподобные» расы (и неизвестная) могут брать обезличенный/любой
  // портрет. Для экзотики (растения, насекомые, неорганики) чужой гуманоидный арт
  // выглядит абсурдно — лучше показать иконку-плейсхолдер (вернуть null).
  if (!cand.length && ecRaceAllowsGenericArt(race)) {
    cand = pool.filter(p => !p.race);
    if (!cand.length) cand = pool;
  }
  if (!cand.length) return null;
  const idx = ecHash(String(a.id || (a.first_name + a.last_name) || '')) % cand.length;
  return cand[idx].url;
}
// Полная «оперативная карта» агента в ростере (досье + действия).
function ecAgentCard(a) {
  const pk = ecPerk(a.perk);
  // готовый агент, попавший в резерв контрразведки → отдельный статус
  const onCI = a.status === 'ready' && ecSpyCounterIds().has(a.id);
  const st = EC_SPY_ST[onCI ? 'counterintel' : a.status] || EC_SPY_ST.ready;
  const lv = Math.max(1, a.level || 1);
  const col = ecPerkColor(a.perk);
  // полоса опыта
  const floor = a.xp_floor != null ? a.xp_floor : ecSpyLevelFloor(lv);
  const next = a.xp_next; const xp = a.xp || 0;
  const pct = next != null ? Math.max(0, Math.min(100, Math.round((xp - floor) / (next - floor) * 100))) : 100;
  const xpLabel = next != null ? `${ecNum(xp)} / ${ecNum(next)} XP · до ур. ${lv + 1}` : `${ecNum(xp)} XP · максимальный уровень`;
  // таймер обучения
  const trainLeft = a.status === 'training' && a.ready_at
    ? `~${Math.max(1, Math.ceil((new Date(a.ready_at).getTime() - Date.now()) / 86400000))} ход.` : '';
  // перки
  const perk2 = a.perk2 ? `<span class="ec-agent-perk" title="${esc(ecPerk(a.perk2).desc)}" style="border-color:${ecPerkColor(a.perk2)};color:${ecPerkColor(a.perk2)}">${ecPerk(a.perk2).icon} ${esc(ecPerk(a.perk2).label)}</span>` : '';
  // атрибуты
  const attr = ecAgentAttr(a);
  // артефакты
  const arts = (a.arts || []).map(k => { const m = ecArt(k); return `<span class="ec-agent-art" title="${esc(m.label)}: ${esc(m.desc)}">${m.icon}</span>`; }).join('');
  // действия
  // обучать можно только реально свободного агента (не занятого контрразведкой)
  const trainBtn = (a.status === 'ready' && !onCI)
    ? `<button class="btn btn-gh btn-xs" title="Тайное обучение: 2 ход., 120 ГС → +150 XP гарантированно, без риска" onclick="ecSpyTrain('${esc(a.id)}')">🎓 Обучить</button>`
    : '';
  const fireBtn = `<button class="btn btn-gh btn-xs ec-agent-fire" title="${a.status === 'busy' ? 'Агент на операции' : 'Уволить'}" ${a.status === 'busy' ? 'disabled' : ''} onclick="ecSpyFire('${esc(a.id)}')">✕</button>`;
  // RPG-портрет на задний фон карточки (или иконка-плейсхолдер, если пул пуст)
  const img = ecAgentPortraitUrl(a);
  const heroStyle = img ? `background-image:url('${esc(img)}')` : '';
  return `<div class="ec-agent-card rpg${img ? ' has-img' : ''}" style="--ag-col:${col}">
    <div class="ec-agent-hero" style="${heroStyle}">
      ${img ? '' : `<div class="ec-agent-hero-ph">${pk.icon}</div>`}
      <div class="ec-agent-hero-top">
        <span class="ec-agent-rank" title="Уровень ${lv}/5"><b>${lv}</b>${ecLevelPips(lv)}</span>
        <span class="ec-agent-status" style="color:${st.c};border-color:color-mix(in srgb,${st.c} 55%,transparent)">${st.ic} ${st.t}${trainLeft ? ` · ${trainLeft}` : ''}</span>
      </div>
      ${arts ? `<span class="ec-agent-arts" title="Артефакты">${arts}</span>` : ''}
      <div class="ec-agent-hero-grad"></div>
      <div class="ec-agent-hero-id">
        <div class="ec-agent-name">${esc(a.first_name)} ${esc(a.last_name)}</div>
        <div class="ec-agent-sub"><span class="ec-agent-attr">${attr ? esc(attr) : 'оперативник'}</span></div>
      </div>
    </div>
    <div class="ec-agent-body">
      <div class="ec-agent-perks">
        <span class="ec-agent-perk" title="${esc(pk.desc)}" style="border-color:${col};color:${col}">${pk.icon} ${esc(pk.label)}</span>${perk2}
      </div>
      <div class="ec-agent-xp" title="${esc(xpLabel)}">
        <div class="ec-agent-xp-bar"><div style="width:${pct}%;background:${next != null ? 'var(--gd,#7bd88f)' : 'var(--pu,#b07bd8)'}"></div></div>
        <span class="ec-agent-xp-t">${next != null ? `ур. ${lv} · ${pct}%` : `ур. 5 · макс.`}</span>
      </div>
      <div class="ec-agent-acts">${trainBtn}${fireBtn}</div>
    </div>
  </div>`;
}
// Карточка рекрута на рынке (RPG-стиль, портрет на фоне).
function ecRecruitCard(r, atCap) {
  const pk = ecPerk(r.perk); const col = ecPerkColor(r.perk);
  const attr = ecAgentAttr(r);
  const img = ecAgentPortraitUrl(r);
  const heroStyle = img ? `background-image:url('${esc(img)}')` : '';
  return `<div class="ec-agent-card ec-recruit-card rpg${img ? ' has-img' : ''}" style="--ag-col:${col}">
    <div class="ec-agent-hero" style="${heroStyle}">
      ${img ? '' : `<div class="ec-agent-hero-ph">${pk.icon}</div>`}
      <div class="ec-agent-hero-top">
        <span class="ec-agent-rank ec-rank-rec" title="Новобранец · уровень 1">★ нов.</span>
      </div>
      <div class="ec-agent-hero-grad"></div>
      <div class="ec-agent-hero-id">
        <div class="ec-agent-name">${esc(r.first_name)} ${esc(r.last_name)}</div>
        <div class="ec-agent-sub"><span class="ec-agent-attr">${attr ? esc(attr) : 'новобранец'}</span></div>
      </div>
    </div>
    <div class="ec-agent-body">
      <div class="ec-agent-perks"><span class="ec-agent-perk" title="${esc(pk.desc)}" style="border-color:${col};color:${col}">${pk.icon} ${esc(pk.label)}</span></div>
      <button class="btn btn-gd btn-xs ec-recruit-hire" ${atCap ? 'disabled title="Достигнут потолок агентов — стройте Центр Спецслужб"' : ''} onclick="ecSpyHire('${esc(r.id)}')">Нанять · ${ecNum(r.cost)} ГС</button>
    </div>
  </div>`;
}
// ── Рынок рекрутов: отдельное окно (не забивает кабинет) ──
// Остаток до метки времени словами: «2 д 3 ч» / «3 ч 42 мин» / «57 сек».
function ecCountdown(ts) {
  if (!ts) return null;
  let s = Math.floor((new Date(ts).getTime() - Date.now()) / 1000);
  if (s <= 0) return 'обновляется…';
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);    s -= m * 60;
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s} сек`;
  return `${s} сек`;
}
// Тик живого таймера в окне рынка: обновляет все .ec-rec-cd; на нуле — подтянуть свежий пул.
function ecRecruitsTick() {
  if (!document.getElementById('ec-recruits-host')) { ecRecruitsStopTimer(); return; }
  const ag = EC.spyAgency;
  const ts = ag && ag.refresh_at ? new Date(ag.refresh_at).getTime() : 0;
  if (ts && ts - Date.now() <= 0 && !EC._recReloading) {     // окно суток истекло — обновить пул
    EC._recReloading = true;
    ecRpc('spy_recruits_list').then(a => {
      if (a) { EC.spyAgency = a; EC.spyCounter = a.counterintel || EC.spyCounter; }
      if (document.getElementById('ec-recruits-host')) ecRecruitsRender();
      ecPaintCabinet();
    }).catch(() => {}).finally(() => { EC._recReloading = false; });
    return;
  }
  const txt = ecCountdown(ag && ag.refresh_at);
  document.querySelectorAll('.ec-rec-cd').forEach(el => { el.textContent = txt || ''; });
}
function ecRecruitsStartTimer() { ecRecruitsStopTimer(); EC._recTimer = setInterval(ecRecruitsTick, 1000); }
function ecRecruitsStopTimer() { if (EC._recTimer) { clearInterval(EC._recTimer); EC._recTimer = null; } }
function ecRecruitsHtml() {
  const ag = EC.spyAgency || { cap: 0, hired: 0, recruits: [], refresh_at: null };
  const cd = ecCountdown(ag.refresh_at);
  const atCap = (ag.hired || 0) >= (ag.cap || 0);
  const recruitsHtml = (ag.recruits || []).length
    ? `<div class="ec-agent-grid">${ag.recruits.map(r => ecRecruitCard(r, atCap)).join('')}</div>`
    : `<div class="ec-empty" style="padding:14px">Список рекрутов пуст — свежие${cd ? ` через <b class="ec-rec-cd">${cd}</b>` : ' подвезут автоматически'}.</div>`;
  return `<div class="ec-recruits-modal-back" onclick="ecRecruitsClose(event)">
    <div class="ec-recruits-modal" onclick="event.stopPropagation()">
      <div class="ec-recruits-hd">
        <div><div class="ec-recruits-ttl">📋 Рынок рекрутов</div>
          <div class="ec-recruits-sub">штат ${ag.hired || 0}/${ag.cap || 0}${cd ? ` · обновление через <b class="ec-rec-cd">${cd}</b>` : ''}${atCap ? ' · <b style="color:var(--color-warning,#e0a030)">потолок достигнут — стройте Центр Спецслужб</b>' : ''}</div></div>
        <button class="ec-recruits-x" onclick="ecRecruitsClose()" title="Закрыть">✕</button>
      </div>
      <div class="ec-recruits-body">${recruitsHtml}</div>
    </div></div>`;
}
function ecRecruitsOpen() {
  let host = document.getElementById('ec-recruits-host');
  if (!host) { host = document.createElement('div'); host.id = 'ec-recruits-host'; document.body.appendChild(host); }
  host.innerHTML = ecRecruitsHtml();
  ecRecruitsStartTimer();
}
function ecRecruitsRender() { const host = document.getElementById('ec-recruits-host'); if (host) host.innerHTML = ecRecruitsHtml(); }
function ecRecruitsClose(ev) {
  if (ev && ev.target && !ev.target.classList.contains('ec-recruits-modal-back') && ev.target.tagName !== 'BUTTON') return;
  ecRecruitsStopTimer();
  document.getElementById('ec-recruits-host')?.remove();
}

// Категории операций для группировки в планировщике.
const EC_SPY_OP_CATS = [
  ['recon',   '🔭 Разведка',            'Сбор сведений — открывает сложные операции'],
  ['econ',    '💰 Экономический удар',  'Кражи и подрыв хозяйства цели'],
  ['direct',  '💥 Прямое действие',     'Саботаж, снос и устранение'],
  ['special', '🛐 Особые операции',     'Идеологическое внедрение'],
  ['tactical','🛰 Тактический слой',     'Охота и диверсии против флота'],
];
const EC_SPY_OP_CAT = {
  recon_basic: 'recon', recon_deep: 'recon',
  steal_gc: 'econ', steal_res: 'econ', steal_tech: 'econ', destabilize: 'econ',
  sabotage: 'direct', mass_demolish: 'direct', kill_agent: 'direct',
  faith_impose: 'special',
  subspace_hunt: 'tactical', fleet_sabotage: 'tactical', outpost_strike: 'tactical',
};
// Требование операции — короткий бейдж (что нужно, чтобы открыть).
function ecSpyOpReq(d) {
  if (d.need === 'deep') return { t: 'нужна глубокая разведка', ic: '🛰' };
  if (d.need === 'basic') return { t: 'нужна разведка', ic: '🔍' };
  return null;
}
// Карточка операции в планировщике (богатая, с метром сложности и требованиями).
function ecSpyOpCard(opk) {
  const d = EC_SPY_OPS[opk]; const c = ecSpyCalc(opk, [], EC.spyTarget);
  const locked = !!(c && c.err);
  const on = opk === EC.spyOp;
  // метр сложности 0..5
  const diffN = Math.max(0, Math.min(5, Math.ceil((d.diff || 0) / 9)));
  let diffPips = '';
  for (let i = 1; i <= 5; i++) diffPips += `<i class="ec-pip${i <= diffN ? ' on' : ''}"></i>`;
  const req = ecSpyOpReq(d);
  const minAg = (opk === 'steal_tech' || opk === 'mass_demolish') ? '<span class="ec-op-tag">≥2 агента</span>' : '';
  const faithTag = opk === 'faith_impose' ? '<span class="ec-op-tag">нужна вера</span>' : '';
  const reqTag = req ? `<span class="ec-op-tag${locked ? ' locked' : ''}">${req.ic} ${esc(req.t)}</span>` : '';
  return `<button type="button" class="ec-spy-op${on ? ' on' : ''}${locked ? ' locked' : ''}" ${locked ? `title="${esc(c.err)}"` : ''} onclick="ecPickSpyOp('${opk}')">
    <div class="ec-op-hd"><span class="ec-op-ic">${d.icon}</span><span class="ec-op-n">${esc(d.label)}</span>${locked ? '<span class="ec-op-lock">🔒</span>' : on ? '<span class="ec-op-chk">✓</span>' : ''}</div>
    <div class="ec-op-desc">${esc(d.desc)}</div>
    <div class="ec-op-meta">
      <span class="ec-op-diff" title="Сложность">риск <span class="ec-pips sm">${diffPips}</span></span>
      ${reqTag}${minAg}${faithTag}
    </div>
  </button>`;
}

// ── Вкладка «Разведка» (тайные операции 2.0) ────────────────
function ecTabIntel() {
  const intelSlots = ecSlotsSum('intel');
  const others = ecOtherFactions();
  const free = ecSpyFree(), committed = ecSpyCommitted(), ci = EC.eco.counter_agents || 0;
  const active = (EC.missions || []).filter(m => m.actor_fid === EC.fid && m.status === 'active');
  const doneOps = (EC.missions || []).filter(m => m.status === 'done');

  // ── Командный HUD разведуправления ──
  const cap = (EC.spyAgency || {}).cap || 0, hired = (EC.spyAgency || {}).hired || 0, training = ecSpyTraining();
  const agentBar = `<div class="ec-spy-hud">
      <div class="ec-spy-hud-ttl"><span>🛰</span><div><b>Разведуправление</b><i>оперативная сводка агентуры</i></div></div>
      <div class="ec-spy-hud-stats">
        <div class="ec-spy-stat"><span class="ec-spy-stat-v" style="color:var(--ok,#7bd88f)">${ecNum(free)}</span><span class="ec-spy-stat-k">в строю</span></div>
        <div class="ec-spy-stat"><span class="ec-spy-stat-v" style="color:var(--te,#5fd0c0)">${ecNum(committed)}</span><span class="ec-spy-stat-k">на операциях</span></div>
        <div class="ec-spy-stat"><span class="ec-spy-stat-v" style="color:var(--color-warning,#e0a030)">${ecNum(training)}</span><span class="ec-spy-stat-k">обучаются</span></div>
        <div class="ec-spy-stat"><span class="ec-spy-stat-v" style="color:var(--pu,#b07bd8)">${ecNum(ci)}</span><span class="ec-spy-stat-k">контрразведка</span></div>
        <div class="ec-spy-stat"><span class="ec-spy-stat-v">${ecNum(hired)}<i>/${ecNum(cap)}</i></span><span class="ec-spy-stat-k">штат / потолок</span></div>
      </div>
    </div>`;

  // Контрразведка — ИМЕННОЕ назначение в две роли (зеркало _spy_fleet_ops.sql):
  //   state  — защита государства (контршпионаж кабинета);
  //   forces — защита вооружённых сил (сопротивление диверсиям против флота).
  const ciBlock = ecCounterIntelBlock(free);

  // Планировщик операции (вынесен в ecSpyPlannerHtml для перерисовки при смене цели)
  let planner;
  if (!others.length) planner = '<div class="ec-empty">Нет других фракций для операций.</div>';
  else if (!ecSpyRoster().length) planner = '<div class="ec-empty">Нет агентов. Наймите оперативников на рынке рекрутов выше (Центр Спецслужб задаёт потолок).</div>';
  else {
    if (!EC.spyTarget || !others.find(f => f.faction_id === EC.spyTarget)) EC.spyTarget = others[0].faction_id;
    planner = `<div id="ec-spy-planner">${ecSpyPlannerHtml()}</div>`;
  }

  // Пассивная разведка по всем доступным целям (союз / торговля / отношения) — даётся даром, без агентов.
  const passList = Object.values(EC.passive || {});
  const passBlock = passList.length
    ? `<div class="ec-section-title">🛰 Пассивная разведка <span class="ec-hint">— приблизительный срез по союзникам, торговым партнёрам и дружественным фракциям (без агентов)</span></div>
       <div class="ec-dip-grid">${passList.map(p => ecPassiveIntelCard(p.target_fid)).join('')}</div>`
    : '';

  const activeHtml = active.length ? active.map(ecSpyActiveRow).join('') : '<div class="ec-empty" style="padding:8px">Активных операций нет.</div>';
  const logHtml = doneOps.length ? doneOps.slice(0, 20).map(ecSpyLogRow).join('') : '<div class="ec-empty" style="padding:8px">Операций ещё не было.</div>';
  const alertsHtml = (EC.alerts || []).length
    ? EC.alerts.slice(0, 15).map(ecSpyAlertRow).join('')
    : '<div class="ec-empty" style="padding:8px">Тревог нет — против вас ничего не предпринимали (или попытки не оставили следов).</div>';

  // Агентура: ростер нанятых (карточки-досье) + еженедельный рынок рекрутов
  const ag = EC.spyAgency || { cap: 0, hired: 0, roster: [], recruits: [], refresh_at: null };
  const refreshCd = ecCountdown(ag.refresh_at);
  const atCap = (ag.hired || 0) >= (ag.cap || 0);
  const rosterHtml = (ag.roster || []).length
    ? `<div class="ec-agent-grid">${ag.roster.map(ecAgentCard).join('')}</div>`
    : '<div class="ec-empty" style="padding:10px">Нет нанятых агентов — откройте «📋 Рынок рекрутов» и наймите оперативников.</div>';
  // Рынок рекрутов вынесен в отдельное окно (ecRecruitsOpen) — не забивает кабинет.
  const recCount = (ag.recruits || []).length;
  const agencyBlock = `<div class="ec-dip-card">
      <div class="ec-dip-t" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span>🕵 Агентура <span class="ec-hint">штат оперативников (${ag.hired || 0}/${ag.cap || 0})</span></span>
        <button class="btn btn-gd btn-sm ec-recruit-open" onclick="ecRecruitsOpen()" title="${atCap ? 'Достигнут потолок — стройте Центр Спецслужб' : 'Нанять новых оперативников'}">📋 Рынок рекрутов${recCount ? ` · ${recCount}` : ''}${refreshCd ? ` <i style="opacity:.7;font-style:normal">· ${refreshCd}</i>` : ''}</button>
      </div>
      ${rosterHtml}
      <div class="cn-fac-hint" style="margin-top:8px">Шевроны = <b>уровень</b> (растёт за успешные операции: выше успех, ниже раскрытие, сильнее перк; на 5-м — <b>второй перк</b>). 🎓 <b>Обучить</b> — тайная подготовка (2 ход., 120 ГС): +150 XP гарантированно, без риска.</div>
    </div>`;

  // Плен (срез 7): пленники у меня + мои агенты в чужом плену
  const prisoners = ag.prisoners || [], captured = ag.captured || [];
  let captiveBlock = '';
  if (prisoners.length || captured.length) {
    const prisHtml = prisoners.length ? prisoners.map(p => {
      const pk = ecPerk(p.perk); const id = esc(p.id); const nm = `${esc(p.first_name)} ${esc(p.last_name)}`;
      const ransom = p.ransom_price != null ? ` <i style="color:var(--color-warning,#e0a030);font-style:normal">· выкуп ${ecNum(p.ransom_price)} ГС выставлен</i>` : '';
      return `<div class="ec-q-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <span class="ec-r-name">⛓ <b>${nm}</b> <b style="color:var(--gd,#7bd88f)" title="Уровень">★${Math.max(1, p.level || 1)}</b> <i style="color:var(--t4);font-style:normal">· ${pk.icon} ${esc(pk.label)} · из «${esc(p.orig_name || p.orig_fid)}»</i>${ransom}</span>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <button class="btn btn-rd btn-xs" onclick="ecCaptiveExecute('${id}','${nm.replace(/'/g, '')}')">⚔ Казнить</button>
          <button class="btn btn-gh btn-xs" onclick="ecCaptiveReturn('${id}','${nm.replace(/'/g, '')}')">🕊 Вернуть</button>
          <button class="btn btn-gh btn-xs" onclick="ecCaptiveRansom('${id}','${nm.replace(/'/g, '')}')">💰 Выкуп</button>
          <button class="btn btn-gd btn-xs" onclick="ecCaptiveRecruit('${id}','${nm.replace(/'/g, '')}')">🔁 Завербовать · 400 ГС</button>
        </div></div>`;
    }).join('') : '<div class="ec-empty" style="padding:6px">Пленников нет — ловите чужих агентов контрразведкой.</div>';
    const capHtml = captured.length ? captured.map(c => {
      const pk = ecPerk(c.perk); const nm = `${esc(c.first_name)} ${esc(c.last_name)}`;
      const offer = c.ransom_id ? `<div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-gd btn-xs" onclick="ecRansomAccept('${esc(c.ransom_id)}', ${c.ransom_price || 0})">💰 Выкупить · ${ecNum(c.ransom_price)} ГС</button>
          <button class="btn btn-gh btn-xs" onclick="ecRansomDecline('${esc(c.ransom_id)}')">Отклонить</button>
        </div>` : '<i style="color:var(--t4);font-style:normal">ждём решения противника…</i>';
      return `<div class="ec-q-row" style="flex-direction:column;align-items:stretch;gap:4px">
        <span class="ec-r-name">🔒 <b>${nm}</b> <b style="color:var(--gd,#7bd88f)">★${Math.max(1, c.level || 1)}</b> <i style="color:var(--t4);font-style:normal">· ${pk.icon} ${esc(pk.label)} · у «${esc(c.captor_name || c.captor_fid)}»</i></span>
        ${offer}</div>`;
    }).join('') : '';
    captiveBlock = `<div class="ec-section-title">⛓ Пленные агенты</div>
      <div class="ec-dip-grid">
        <div class="ec-dip-card"><div class="ec-dip-t">⛓ Мои пленники <span class="ec-hint">чужие агенты, схваченные вами</span></div>
          <div class="ec-queue">${prisHtml}</div></div>
        ${captured.length ? `<div class="ec-dip-card"><div class="ec-dip-t">🔒 Мои агенты в плену <span class="ec-hint">схвачены противником</span></div>
          <div class="ec-queue">${capHtml}</div></div>` : ''}
      </div>`;
  }

  // Артефакты (срез 8): инвентарь + экипировка на агентов
  let artifactBlock = '';
  if ((ag.roster || []).length || (ag.artifacts || []).length) {
    const arts = ag.artifacts || [];
    const agName = id => { const a = (ag.roster || []).find(x => x.id === id); return a ? `${a.first_name} ${a.last_name}` : '—'; };
    const equipOpts = (ag.roster || []).map(a => {
      const slots = (a.arts || []).length;
      return `<option value="${esc(a.id)}"${slots >= 2 ? ' disabled' : ''}>${esc(a.first_name)} ${esc(a.last_name)} ★${Math.max(1, a.level || 1)} (${slots}/2)</option>`;
    }).join('');
    const artsHtml = arts.length ? arts.map(x => {
      const meta = ecArt(x.kind);
      if (x.equipped_agent) {
        return `<div class="ec-q-row" style="flex-wrap:wrap;gap:6px">
          <span class="ec-r-name" title="${esc(meta.desc)}">${meta.icon} <b>${esc(meta.label)}</b> <i style="color:var(--gd,#7bd88f);font-style:normal">· на: ${esc(agName(x.equipped_agent))}</i></span>
          <button class="btn btn-gh btn-xs" onclick="ecArtifactUnequip('${esc(x.id)}')">Снять</button></div>`;
      }
      return `<div class="ec-q-row" style="flex-wrap:wrap;gap:6px">
        <span class="ec-r-name" title="${esc(meta.desc)}">${meta.icon} <b>${esc(meta.label)}</b> <i style="color:var(--t4);font-style:normal">· ${esc(meta.desc)}</i></span>
        <select class="ec-mini-sel" onchange="if(this.value)ecArtifactEquip('${esc(x.id)}',this.value)"><option value="">— экипировать на —</option>${equipOpts}</select></div>`;
    }).join('') : '<div class="ec-empty" style="padding:6px">Артефактов нет — они выпадают с шансом за успешные боевые операции.</div>';
    artifactBlock = `<div class="ec-section-title">🎒 Артефакты <span class="ec-hint">— экип-предметы, до 2 на агента; бонусы идут в расчёт операций</span></div>
      <div class="ec-dip-card"><div class="ec-queue">${artsHtml}</div></div>`;
  }

  const activeCount = active.length, alertCount = (EC.alerts || []).length;
  return `${ecIntro('🕵', 'Разведка и тайные операции', 'Шпионьте за другими фракциями: разведка, кража казны и технологий, саботаж, дестабилизация.', ['<b>Агентов</b> нанимаете на еженедельном рынке рекрутов — у каждого имя, перк, раса и пол. Центр спецслужб задаёт потолок числа агентов.', 'Сложные операции требуют сначала провести <b>разведку</b> цели.', 'Оставляйте часть агентов на <b>контрразведку</b> — иначе вас безнаказанно атакуют. Пойманный чужой агент попадает к вам в <b>плен</b> — казните, верните, требуйте выкуп или вербуйте.'])}${agentBar}
    ${agencyBlock}
    ${artifactBlock}
    ${captiveBlock}
    <div class="ec-dip-grid">
      <div class="ec-dip-card ec-dip-trade"><div class="ec-dip-t">🎯 Планирование операции <span class="ec-hint">расчёт по разведданным и агентам</span></div>${planner}</div>
      ${ciBlock}
    </div>
    ${passBlock}
    <div class="ec-section-title">⏳ Операции в работе ${activeCount ? `<span class="ec-spy-count">${activeCount}</span>` : ''}<span class="ec-hint">— завершаются через N ходов</span></div>
    <div class="ec-spy-feed">${activeHtml}</div>
    <div class="ec-section-title">🛡 Тревоги контрразведки ${alertCount ? `<span class="ec-spy-count warn">${alertCount}</span>` : ''}<span class="ec-hint">— операции против вас (исполнитель виден только если раскрыт)</span></div>
    <div class="ec-spy-feed">${alertsHtml}</div>
    <div class="ec-section-title">📜 Журнал операций <span class="ec-hint">— ваши завершённые миссии: кто, где, когда и с каким итогом</span></div>
    <div class="ec-spy-feed">${logHtml}</div>`;
}

// Внутренняя разметка планировщика (перерисовывается при смене цели/операции).
function ecSpyPlannerHtml() {
  const others = ecOtherFactions();
  if (!others.length) return '<div class="ec-empty">Нет других фракций для операций.</div>';
  if (!EC.spyTarget || !others.find(f => f.faction_id === EC.spyTarget)) EC.spyTarget = others[0].faction_id;
  const free = ecSpyFree();
  // 1 · Цель — карточки-флаги с отношениями и статусом досье
  const relMap = new Map();
  (EC.relations || []).forEach(r => { if (r.from_fid === EC.fid) relMap.set(r.to_fid, r.score); });
  const tgtCards = others.map(f => {
    const on = f.faction_id === EC.spyTarget;
    const dos = ecSpyDossier(f.faction_id);
    const rel = ecRelLabel(relMap.get(f.faction_id) || 0);
    const dosBadge = dos.level
      ? `<span class="ec-tgt-dos" style="color:var(--ok,#7bd88f)">${dos.level === 'deep' ? '🛰 глубокое' : '🔍 базовое'} досье · ${dos.ageDays} дн.</span>`
      : `<span class="ec-tgt-dos" style="color:var(--t4)">нет досье</span>`;
    return `<button type="button" class="ec-tgt-card${on ? ' on' : ''}" onclick="ecPickSpyTarget('${esc(f.faction_id)}')">
      ${ecFacFlag(f.faction_id, 34)}
      <div class="ec-tgt-info">
        <div class="ec-tgt-name">${esc(f.name)}</div>
        <div class="ec-tgt-meta"><span style="color:${rel.c}">${rel.t}</span> · ${dosBadge}</div>
      </div>${on ? '<span class="ec-tgt-chk">✓</span>' : ''}</button>`;
  }).join('');
  const tgt = ecFacOf(EC.spyTarget);
  return `<div class="ec-trade-form">
    <div class="ec-trade-label">1 · Цель <span class="ec-hint">кого разрабатываем</span></div>
    <div class="ec-tgt-grid">${tgtCards}</div>
    <div class="ec-trade-label">2 · Операция <span class="ec-hint">→ ${esc((tgt && tgt.name) || '—')}</span></div>
    <div id="ec-spy-ops">${ecSpyOpsHtml()}</div>
    <div id="ec-spy-colony"></div>
    <div class="ec-trade-label">3 · Оперативная группа <span class="ec-hint">перки и артефакты баффают операцию · свободно ${free}</span></div>
    <div id="ec-spy-agents-pick" class="ec-pick-grid">${ecSpyAgentPickHtml()}</div>
    <div class="ec-trade-summary" id="ec-spy-summary"></div>
    <button class="btn btn-gd" id="ec-spy-launch" onclick="ecSpyLaunch()">Запустить операцию</button>
  </div>${ecPassiveIntelCard(EC.spyTarget)}`;
}
// Операции, сгруппированные по категориям (перерисовывается при смене цели/операции).
function ecSpyOpsHtml() {
  return EC_SPY_OP_CATS.map(([cat, label, sub]) => {
    const ops = EC_SPY_ORDER.filter(opk => EC_SPY_OP_CAT[opk] === cat);
    if (!ops.length) return '';
    return `<div class="ec-op-group">
      <div class="ec-op-group-hd">${esc(label)} <i>${esc(sub)}</i></div>
      <div class="ec-spy-ops">${ops.map(ecSpyOpCard).join('')}</div></div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
// КАПЕРСТВО (РЕЙДЫ) — флот грабит чужие караваны
// ════════════════════════════════════════════════════════════
// Тиры торговой политики — зеркало _trade_policy_cost/_def (бэкенд авторитетен)
const EC_TRADE_POLICY = [
  { name: 'Нет', cost: 0, def: 0 },
  { name: 'Патрульный контракт', cost: 120, def: 8 },
  { name: 'Конвой Торговой Лиги', cost: 350, def: 18 },
];
function ecRaidPolicySet(t) { ecRpcAct('raid_policy_set', { p_tier: Math.max(0, Math.min(2, t)) }, 'Торговая политика обновлена'); }
function ecTabRaids() {
  const st = EC.raidStatus || { ships: 0, free: 0, raids: 0, policy: 0 };
  const pol = st.policy || 0; const polInfo = EC_TRADE_POLICY[pol] || EC_TRADE_POLICY[0];
  const others = ecOtherFactions();
  const active = (EC.raids || []).filter(m => m.status === 'active');
  const done = (EC.raids || []).filter(m => m.status === 'done');

  const shipBar = `<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <div class="ec-res"><span class="ec-res-k">Корабли</span><span class="ec-res-v">${ecNum(st.ships || 0)}</span></div>
      <div class="ec-res"><span class="ec-res-k">Свободно</span><span class="ec-res-v" style="color:var(--te)">${ecNum(st.free || 0)}</span></div>
      <div class="ec-res"><span class="ec-res-k">В рейдах</span><span class="ec-res-v" style="color:var(--color-warning,#e0a030)">${ecNum(st.raids || 0)}</span></div>
      <div class="ec-res"><span class="ec-res-k">Защита</span><span class="ec-res-v" style="color:var(--pu)">${esc(polInfo.name)}</span></div>
    </div>`;

  const policyBlock = `<div class="ec-dip-card"><div class="ec-dip-t">📜 Торговая политика <span class="ec-hint">платная защита всех караванов</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        ${EC_TRADE_POLICY.map((p, i) => `<button class="btn ${i === pol ? 'btn-gd' : 'btn-gh'} btn-sm" style="display:flex;justify-content:space-between;gap:8px" onclick="ecRaidPolicySet(${i})">
            <span>${i === pol ? '✓ ' : ''}${esc(p.name)}</span>
            <span style="opacity:.8">${p.cost ? `${ecNum(p.cost)} ГС/ход · +${p.def} защ.` : 'бесплатно'}</span>
          </button>`).join('')}
      </div>
      <div class="cn-fac-hint" style="margin-top:6px">Контракт с NPC-флотом защищает ВСЕ ваши караваны от рейдов; апкип списывается каждый ход. Конвой (свои корабли на конкретный путь) добавляется сверху.</div></div>`;

  let planner;
  if ((st.ships || 0) < 1) planner = '<div class="ec-empty">Нет военных кораблей. Постройте Корабельную Верфь и заложите корабли (вкладка «Военпром»).</div>';
  else if (!others.length) planner = '<div class="ec-empty">Нет других фракций для рейда.</div>';
  else {
    if (!EC.raidTarget || !others.find(f => f.faction_id === EC.raidTarget)) { EC.raidTarget = others[0].faction_id; EC.raidScout = null; EC.raidRoute = null; EC.raidComp = {}; }
    const tgtOpts = others.map(f => `<option value="${esc(f.faction_id)}"${f.faction_id === EC.raidTarget ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
    const hasRecon = !!(ecSpyDossier(EC.raidTarget).level);   // караваны видны только после разведки цели
    const scout = (EC.raidScout && EC.raidScout.fid === EC.raidTarget) ? EC.raidScout.routes : null;
    // выбранный караван должен существовать в текущей разведке
    if (EC.raidRoute && !(scout || []).find(r => r.id === EC.raidRoute)) EC.raidRoute = null;
    let caravans;
    if (!hasRecon) caravans = `<div class="ec-empty" style="padding:8px">🔒 Нет разведданных об этой фракции. Чужие караваны видны <b>только после разведки</b> — проведите операцию «Разведка» во вкладке «Разведка». <button class="btn btn-gh btn-xs" style="margin-left:6px" onclick="ecSetTab('intel')">→ В Разведку</button></div>`;
    else if (scout == null) caravans = `<div class="ec-empty" style="padding:8px">Нажмите «🔭 Обновить караваны», чтобы увидеть текущие караваны цели.</div>`;
    else if (!scout.length) caravans = `<div class="ec-empty" style="padding:8px">У цели нет активных караванов — грабить нечего.</div>`;
    else caravans = scout.map(rt => {
      const sel = EC.raidRoute === rt.id;
      return `<div class="ec-q-row${sel ? ' on' : ''}" style="flex-wrap:wrap;gap:6px">
        <span class="ec-r-name">${ecRouteCargoText(rt)} · 🛡 эскорт ${ecNum(rt.convoy || 0)}</span>
        <button class="btn ${sel ? 'btn-gd' : 'btn-gh'} btn-xs" onclick="ecRaidPickRoute('${esc(rt.id)}')">${sel ? '✓ Цель выбрана' : '🎯 Выбрать целью'}</button>
      </div>`;
    }).join('');

    // 3 · Состав рейда — конкретные корабли (появляется при выбранном караване)
    let compBlock;
    if (EC.raidRoute && (scout || []).find(r => r.id === EC.raidRoute)) {
      const { ships } = ecRaidCompTotals();
      compBlock = `<div class="ec-trade-label">3 · Состав рейда <span class="ec-hint">выберите КОНКРЕТНЫЕ корабли — мощь зависит от состава</span></div>
        <div class="ec-queue" id="ec-raid-comp">${ecRaidCompHtml()}</div>
        <button class="btn btn-gd btn-sm" style="margin-top:8px" ${ships < 1 ? 'disabled' : ''} onclick="ecRaidLaunch()">🏴‍☠ Отправить рейд</button>`;
    } else {
      compBlock = `<div class="ec-trade-label">3 · Состав рейда</div><div class="ec-empty" style="padding:8px">Сначала выберите целевой караван выше.</div>`;
    }

    planner = `<div class="ec-trade-form">
      <div class="ec-trade-label">1 · Цель <span class="ec-hint">караваны видны только по разведанным фракциям</span></div>
      <div style="display:flex;gap:6px">
        <select id="ec-raid-target" onchange="ecRaidPickTarget(this.value)" style="flex:1">${tgtOpts}</select>
        ${hasRecon
          ? `<button class="btn btn-gh btn-sm" onclick="ecRaidScout()">🔭 Обновить караваны</button>`
          : `<button class="btn btn-gh btn-sm" onclick="ecSetTab('intel')">🕵 Разведать в «Разведке»</button>`}
      </div>
      <div class="ec-trade-label">2 · Караваны цели <span class="ec-hint">грабить можно только то, что везут</span></div>
      <div class="ec-queue">${caravans}</div>
      ${compBlock}
    </div>`;
  }

  const activeHtml = active.length ? active.map(ecRaidActiveRow).join('') : '<div class="ec-empty" style="padding:8px">Активных рейдов нет.</div>';
  const logHtml = done.length ? done.slice(0, 20).map(ecRaidLogRow).join('') : '<div class="ec-empty" style="padding:8px">Рейдов ещё не было.</div>';

  return `${ecIntro('🏴‍☠', 'Каперство · рейды', 'Шлите военные корабли грабить чужие караваны. Добыча — ресурсы и ГС. Но эскорт даёт отпор: в бою корабли теряют обе стороны.', ['Соберите <b>состав рейда</b> из конкретных кораблей — мощь зависит от их класса (дредноут сильнее корвета). Защита цели (конвой + торговая политика) сопротивляется: победит сильнейший.', 'В бою гибнут только корабли <b>отправленного состава</b> — флот, оставшийся дома, в безопасности.', 'Грабить можно только <b>активный караван</b> цели. Включите <b>торговую политику</b> — платный контракт защищает все ваши караваны. За раскрытый разбой отношения падают.'])}${shipBar}
    <div class="ec-dip-grid">
      <div class="ec-dip-card ec-dip-trade"><div class="ec-dip-t">🎯 Планирование рейда</div>${planner}</div>
      ${policyBlock}
    </div>
    <div class="ec-section-title">Активные рейды <span class="ec-hint">— флот в пути, завершатся через N ходов</span></div>
    <div class="ec-queue">${activeHtml}</div>
    <div class="ec-section-title">Журнал рейдов</div>
    <div class="ec-queue">${logHtml}</div>`;
}

function ecRaidActiveRow(m) {
  return `<div class="ec-q-row"><span class="ec-r-name">🏴‍☠ Рейд на <b>${esc(m.target_name || ecFacName(m.target_fid))}</b> · ${ecRaidCompText(m)}</span>${ecProgressISO(m.started_at, m.ready_at, 1, 'подходит к цели')}<button class="ec-bld-del" title="Отозвать рейд" onclick="ecRaidCancel('${esc(m.id)}')">✕</button></div>`;
}
function ecRaidLogRow(m) {
  const o = m.outcome || {};
  if (o.result === 'no_target') return `<div class="ec-q-row"><span class="ec-r-name">🏴‍☠ Рейд на <b>${esc(m.target_name || ecFacName(m.target_fid))}</b> — караван ушёл, добычи нет</span></div>`;
  const loot = [];
  if (o.loot_units) loot.push(`${ecNum(o.loot_units)} ед. ${esc(o.resource || 'груза')}`);
  if (o.loot_gc) loot.push(`${ecNum(o.loot_gc)} ГС`);
  const lootTxt = loot.length ? `угнано ${loot.join(' + ')}` : 'добычи нет';
  const win = (o.loot_frac || 0) > 0;
  const disrupt = o.disrupt_days ? ` · трасса сорвана на ${ecNum(o.disrupt_days)} х.` : '';
  return `<div class="ec-q-row"><span class="ec-r-name">${win ? '✅' : '❌'} Рейд на <b>${esc(m.target_name || ecFacName(m.target_fid))}</b> — ${lootTxt}. Потери: ваши ${ecNum(o.att_losses || 0)}, эскорт ${ecNum(o.def_losses || 0)}.${disrupt}${o.detected ? ' · <b style="color:var(--err)">раскрыты</b>' : ''}</span></div>`;
}

// ── Сборщик СОСТАВА рейда: выбираешь конкретные корабли (дизайны), не «число» ──
// Зеркало серверного raid_launch(p_comp): мощь = Σ qty × cost-мощь дизайна.
function ecRaidShipCost(unitId) { const d = (EC.designs || []).find(x => x.id === unitId); return (d && d.summary && +d.summary.cost) || 100; }
function ecRaidShipPower(unitId) { return Math.max(1, ecRaidShipCost(unitId) / 10); }
function ecRaidDesignName(unitId) {
  const r = (EC.roster || []).find(x => x.unit_id === unitId);
  if (r && r.unit_name) return r.unit_name;
  const d = (EC.designs || []).find(x => x.id === unitId);
  return (d && d.name) || 'Корабль';
}
// Все готовые дизайны кораблей (агрегат по ростеру)
function ecRaidShipDesigns() {
  const by = {};
  (EC.roster || []).filter(r => r.category === 'ship').forEach(r => {
    if (!by[r.unit_id]) by[r.unit_id] = { id: r.unit_id, name: r.unit_name || 'Корабль', qty: 0, cargo: ecCvShipCargo(r.unit_id) };
    by[r.unit_id].qty += r.qty || 0;
  });
  return Object.values(by);
}
// Корабли дизайна, занятые активными рейдами (по их составу comp)
function ecRaidCommittedShips() {
  const m = {};
  (EC.raids || []).filter(x => x.status === 'active').forEach(x => {
    (x.comp || []).forEach(c => { m[c.unit_id] = (m[c.unit_id] || 0) + (+c.qty || 0); });
  });
  return m;
}
// Свободно дизайна = владение − закреплено караванами (поштучно) − занято рейдами
function ecRaidShipAvail(unitId) {
  return Math.max(0, ecCvShipOwned(unitId) - (ecCvCommittedShips()[unitId] || 0) - (ecRaidCommittedShips()[unitId] || 0));
}
function ecRaidCompTotals() {
  const c = EC.raidComp || {}; let ships = 0, power = 0;
  Object.keys(c).forEach(id => { const n = c[id] || 0; ships += n; power += n * ecRaidShipPower(id); });
  return { ships, power: Math.round(power) };
}
function ecRaidCompAdd(unitId, delta) {
  EC.raidComp = EC.raidComp || {};
  const perDesign = ecRaidShipAvail(unitId);
  const { ships } = ecRaidCompTotals();
  const globalFree = ecMyShipsAvailable();
  let next = (EC.raidComp[unitId] || 0) + delta;
  next = Math.max(0, Math.min(perDesign, next));
  // глобальный потолок свободного флота (с учётом уже выбранного в этом рейде)
  if (delta > 0 && ships + delta > globalFree) next = EC.raidComp[unitId] || 0;
  EC.raidComp[unitId] = next;
  const cont = ecId('ec-raid-comp'); if (cont) cont.innerHTML = ecRaidCompHtml();
}
function ecRaidCompHtml() {
  EC.raidComp = EC.raidComp || {};
  const designs = ecRaidShipDesigns();
  if (!designs.length) return '<div class="ec-empty" style="padding:6px">Нет готовых кораблей. Заложите корабли во вкладке «Военпром».</div>';
  const { ships, power } = ecRaidCompTotals();
  const globalFree = ecMyShipsAvailable();
  const row = d => {
    const n = EC.raidComp[d.id] || 0;
    const avail = ecRaidShipAvail(d.id);
    const canAdd = n < avail && ships < globalFree;
    const tag = d.cargo > 0 ? '📦 грузовой' : '⚔ боевой';
    const title = n >= avail ? 'Нет свободных кораблей этого типа' : (ships >= globalFree ? 'Достигнут предел свободного флота' : '');
    return `<div class="ec-q-row" style="gap:6px">
      <span class="ec-r-name">${esc(d.name)} <i style="color:var(--t4)">${tag} · 💥 ${ecNum(Math.round(ecRaidShipPower(d.id)))} · свободно ${ecNum(avail)}</i></span>
      <span class="ec-mine-step">
        <button class="ec-mine-btn" ${n <= 0 ? 'disabled' : ''} onclick="ecRaidCompAdd('${esc(d.id)}',-1)">−</button>
        <span class="ec-mine-cnt ${n ? 'on' : ''}">${n}</span>
        <button class="ec-mine-btn" ${canAdd ? '' : 'disabled'} title="${title}" onclick="ecRaidCompAdd('${esc(d.id)}',1)">+</button>
      </span></div>`;
  };
  const note = ships < 1
    ? '<b style="color:var(--err)">Добавьте хотя бы один корабль в рейд</b>'
    : `<b>Состав рейда:</b> 🚀 <b>${ecNum(ships)}</b> кор. · 💥 мощь <b>${ecNum(power)}</b>`;
  return `${designs.map(row).join('')}
    <div class="ec-trade-note${ships < 1 ? ' warn' : ''}">${note} <span class="ec-hint">свободно во флоте: ${ecNum(globalFree)}</span></div>`;
}
// Состав рейда текстом (для активных рейдов и журнала)
function ecRaidCompText(m) {
  if (Array.isArray(m.comp) && m.comp.length) return m.comp.map(c => `${ecNum(c.qty)}× ${esc(ecRaidDesignName(c.unit_id))}`).join(', ');
  return `${ecNum(m.ships)} кораблей`;
}

// ── Действия рейдов ─────────────────────────────────────────
function ecRaidPickTarget(fid) { EC.raidTarget = fid; EC.raidScout = null; EC.raidRoute = null; EC.raidComp = {}; ecPaintCabinet(); }
function ecRaidPickRoute(id) { EC.raidRoute = (EC.raidRoute === id ? null : id); ecPaintCabinet(); }
async function ecRaidScout() {
  const fid = EC.raidTarget; if (!fid) return;
  if (!ecSpyDossier(fid).level) { toast('Сначала разведайте эту фракцию во вкладке «Разведка»', 'err'); ecSetTab('intel'); return; }
  try {
    const routes = await ecRpc('raid_scout', { p_target_fid: fid });
    EC.raidScout = { fid, routes: routes || [] };
    ecPaintCabinet();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}
function ecRaidLaunch() {
  if (!EC.raidTarget) { toast('Выберите цель', 'err'); return; }
  if (!EC.raidRoute) { toast('Выберите целевой караван', 'err'); return; }
  const c = EC.raidComp || {};
  const comp = Object.keys(c).filter(id => (c[id] || 0) > 0).map(id => ({ unit_id: id, qty: c[id] }));
  if (!comp.length) { toast('Соберите состав рейда — выберите конкретные корабли', 'err'); return; }
  const routeId = EC.raidRoute, target = EC.raidTarget;
  EC.raidComp = {}; EC.raidRoute = null;   // сбрасываем выбор после отправки
  ecRpcAct('raid_launch', { p_target_fid: target, p_route_id: routeId, p_comp: comp }, 'Рейд отправлен — флот в пути');
}
function ecRaidCancel(id) { ecRpcAct('raid_cancel', { p_id: id }, 'Рейд отозван'); }
function ecRaidPatrol(n) { ecRpcAct('raid_patrol_set', { p_n: Math.max(0, n) }, 'Патруль обновлён'); }
// Строка активной операции (с таймером)
function ecSpyActiveRow(m) {
  if (m.op === 'train') {
    return `<div class="ec-spy-row wait">
      <span class="ec-spy-row-badge wait">🎓</span>
      <div class="ec-spy-row-body">
        <div class="ec-spy-row-top"><b>Тайное обучение</b></div>
        <div class="ec-spy-row-foot">🕵 ${ecNum(m.agents)} агент(ов) набираются опыта · начато ${ecAgo(m.created_at)}</div>
      </div>
      <div class="ec-spy-row-side">${ecProgressISO(m.created_at, m.ready_at, 1, 'вернутся в конце хода')}<button class="ec-bld-del" title="Отозвать (вернуть агентов без опыта)" onclick="ecSpyCancel('${m.id}')">✕</button></div>
    </div>`;
  }
  const d = EC_SPY_OPS[m.op] || { icon: '•', label: m.op };
  return `<div class="ec-spy-row wait">
    <span class="ec-spy-row-badge wait">${d.icon}</span>
    <div class="ec-spy-row-body">
      <div class="ec-spy-row-top"><b>${esc(d.label)}</b> <span class="ec-spy-row-arr">→</span> ${ecFacFlag(m.target_fid, 22)}<span class="ec-spy-row-tgt">${esc(m.target_name || ecFacName(m.target_fid))}</span></div>
      <div class="ec-spy-row-foot">🕵 ${ecNum(m.agents)} · успех ${ecNum(m.success_pct)}% · раскрытие ${ecNum(m.detect_pct)}% · начато ${ecAgo(m.created_at)}</div>
    </div>
    <div class="ec-spy-row-side">${ecProgressISO(m.created_at, m.ready_at, 1, 'готово в конце хода')}<button class="ec-bld-del" title="Отозвать (вернуть агентов)" onclick="ecSpyCancel('${m.id}')">✕</button></div>
  </div>`;
}
// Строка «тревоги» — входящая операция против нас. Исполнитель показывается,
// только если операция раскрыта (detected); иначе виден лишь факт ущерба.
function ecSpyAlertRow(a) {
  const d = EC_SPY_OPS[a.op] || { icon: '⚠', label: a.op };
  const r = a.result || {};
  const ok = a.outcome === 'success';
  let detail = '';
  if (a.op === 'steal_gc') detail = ok ? `похищено <b style="color:var(--err)">${ecNum(r.gc)} ГС</b> из казны` : 'попытка кражи казны';
  else if (a.op === 'steal_res') detail = ok ? `похищено <b style="color:var(--err)">${ecNum(r.amount)}</b> ед. <b>${esc(r.resource || '?')}</b> со складов` : 'попытка кражи ресурсов';
  else if (a.op === 'sabotage') detail = ok ? `выведено из строя: ${esc(r.building || 'здание')}` : 'попытка саботажа';
  else if (a.op === 'mass_demolish') detail = ok ? `массовый снос: уничтожено <b style="color:var(--err)">${r.count || 0}</b> зданий` : 'попытка массового сноса';
  else if (a.op === 'steal_tech') detail = ok ? `похищена технология: ${esc(r.tech_name || r.tech || '—')}` : 'попытка кражи технологий';
  else if (a.op === 'destabilize') detail = ok ? `дестабилизация: доход −${Math.round((r.debuff_pct || 0) * 100)}% (${r.turns || 0} ход.)` : 'попытка дестабилизации';
  else if (a.op === 'kill_agent') detail = ok ? `ликвидирован агент: <b style="color:var(--err)">${esc(r.agent_name || '—')}</b>` : 'попытка ликвидации агента';
  else if (a.op === 'recon_basic' || a.op === 'recon_deep') detail = 'разведка вашей фракции';
  else if (a.op === 'faith_impose') detail = ok ? `в вашей державе внедрена тайная секта: <b style="color:var(--color-warning,#e0a030)">${esc(r.sect || '—')}</b>` : 'попытка внедрить тайную секту';
  else detail = ok ? 'операция удалась' : 'операция сорвана';
  // исполнитель: раскрыт → имя (+ флаг); не раскрыт → аноним
  const actor = a.detected
    ? `${a.actor_fid ? ecFacFlag(a.actor_fid, 20) : ''}<b style="color:var(--color-warning,#e0a030)">${esc(a.actor_name || 'раскрытая фракция')}</b>`
    : `<span class="ec-spy-anon">❓ неизвестно <i>(исполнитель не раскрыт)</i></span>`;
  const badge = a.detected ? 'alert' : 'wait';
  const badgeIc = a.detected ? '⚠' : '❓';
  const caught = (a.detected && r.caught) ? ' · <span style="color:var(--ok)">агент пойман</span>' : '';
  const status = ok ? 'удалось' : 'сорвано';
  // мини-игра расследования: незаметную враждебную операцию можно вскрыть через
  // следственное дело (дедукция + методы). has_case приходит с сервера.
  let investHtml = '';
  if (a.has_case) {
    const conf = Math.max(0, Math.min(100, a.case_confidence || 0));
    const started = conf > 0 || (a.case_verdict != null);
    investHtml = `<div class="ec-spy-invest">
      <div class="ec-spy-invest-bar"><div class="ec-spy-invest-track"><div style="width:${conf}%"></div></div><span class="ec-hint">ясность ${conf}%</span>
        <button class="btn btn-gh btn-xs" onclick="ecSpyCaseOpen('${esc(a.id)}')">🗂 ${started ? 'Продолжить дело' : 'Открыть дело'}</button></div></div>`;
  } else if (!a.detected && a.case_verdict === 'wrong') {
    investHtml = `<div class="ec-spy-invest"><div class="ec-hint" style="color:var(--err)">⚖ ложное обвинение — дело сгорело, шпион ушёл</div></div>`;
  } else if (!a.detected && a.case_verdict === 'cold') {
    investHtml = `<div class="ec-spy-invest"><div class="ec-hint" style="color:var(--t4)">❄ след остыл — дело закрыто нераскрытым</div></div>`;
  }
  return `<div class="ec-spy-row ${badge}">
    <span class="ec-spy-row-badge ${badge}">${badgeIc}</span>
    <div class="ec-spy-row-body">
      <div class="ec-spy-row-top">${d.icon} <b>${esc(d.label)}</b> <span class="ec-spy-tag ${ok ? 'bad' : ''}">${status}</span></div>
      <div class="ec-spy-row-detail">${detail}${caught}</div>
      <div class="ec-spy-row-foot">от: ${actor} · ${ecAgo(a.created_at || a.ready_at)}</div>
      ${investHtml}
    </div>
  </div>`;
}
// ════════════════════════════════════════════════════════════
//  СЛЕДСТВЕННОЕ ДЕЛО — дедукция + методы (мини-игра контрразведки)
// ════════════════════════════════════════════════════════════
function _ecCaseHost() {
  let h = document.getElementById('ec-case-host');
  if (!h) { h = document.createElement('div'); h.id = 'ec-case-host'; document.body.appendChild(h); }
  return h;
}
function ecSpyCaseClose() { const h = document.getElementById('ec-case-host'); if (h) h.innerHTML = ''; EC.caseData = null; }

// Метаданные следственных измерений (порядок столбцов = порядок дедукции).
const EC_CASE_DIMS = [
  ['gov', '🏛', 'Режим'],
  ['race', '👽', 'Раса'],
  ['motive', '🎯', 'Мотив'],
];
// Описание методов: иконка, название, к какому измерению ведёт, базовая цена.
const EC_CASE_METHODS = {
  forensics: { ic: '🔬', name: 'Криминалистика', dim: 'gov', cost: 80, hint: 'Анализ улик на месте — вскрывает режим виновного.' },
  surveil: { ic: '👁', name: 'Слежка', dim: 'race', cost: 60, hint: 'Занимает свободного агента — устанавливает расу исполнителя.' },
  wiretap: { ic: '📡', name: 'Перехват связи', dim: 'motive', cost: 120, hint: 'Нужна сильная КР области — вскрывает мотив (отношения к вам).' },
  interro: { ic: '🗣', name: 'Допрос пойманного', dim: null, cost: 0, hint: 'Доступен, только если агент пойман: сдаёт приметы хозяина (режим+раса чисто).' },
};

async function ecSpyCaseOpen(id) {
  if (EC.busy) return; EC.busy = true;
  try {
    const c = await ecRpc('spy_case_open', { p_mission_id: id });
    EC.caseData = c; ecSpyCaseRender(c);
  } catch (e) { toast(ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}

async function ecSpyCaseMethod(method) {
  const c = EC.caseData; if (!c || EC.busy) return; EC.busy = true;
  try {
    const v = await ecRpc('spy_case_method', { p_mission_id: c.mission_id, p_method: method });
    EC.caseData = v; ecSpyCaseRender(v);
    const m = EC_CASE_METHODS[method];
    const dim = method === 'interro' ? null : m.dim;
    const noisy = dim && (v.clues || []).find(cl => cl.dim === dim && cl.noisy);
    if (method === 'interro') toast('🗣 Пойманный агент сдал приметы хозяина', 'ok');
    else if (noisy) toast('Улика смазана — перепроверьте метод (дороже) или усильте КР', 'err');
    else toast('Новая улика по делу получена', 'ok');
  } catch (e) { toast(ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}

function ecSpyCaseAccuse(fid) {
  const c = EC.caseData; if (!c) return;
  const nm = (c.suspects.find(s => s.fid === fid) || {}).name || ecFacName(fid);
  // подтверждение: ложное обвинение сжигает дело и роняет отношения
  _ecCaseHost().querySelector('.ec-case-confirm')?.remove();
  const modal = _ecCaseHost().querySelector('.ec-bp-modal'); if (!modal) return;
  const box = document.createElement('div');
  box.className = 'ec-case-confirm';
  box.innerHTML = `<div class="ec-case-confirm-in">
      <div class="ec-case-confirm-t">⚖ Обвинить «${esc(nm)}»?</div>
      <div class="ec-case-confirm-d">Верное обвинение раскроет шпиона. <b style="color:var(--err)">Ошибка сожжёт дело</b> — реальный шпион уйдёт, а отношения с невиновной державой упадут.</div>
      <div class="ec-case-confirm-act">
        <button class="btn btn-gh btn-sm" onclick="this.closest('.ec-case-confirm').remove()">Отмена</button>
        <button class="btn btn-rd btn-sm" onclick="ecSpyCaseAccuseDo('${esc(fid)}')">⚖ Обвинить</button>
      </div></div>`;
  modal.appendChild(box);
}

async function ecSpyCaseAccuseDo(fid) {
  const c = EC.caseData; if (!c || EC.busy) return; EC.busy = true;
  try {
    const r = await ecRpc('spy_case_accuse', { p_mission_id: c.mission_id, p_suspect_fid: fid });
    if (r && r.correct) {
      toast('🕵 Шпион вычислен: ' + (r.actor_name || 'фракция раскрыта'), 'ok');
      ecSpyCaseClose(); await ecReloadPaint();
    } else {
      toast('⚖ Ошибка следствия: «' + (r.accused_name || '') + '» невиновна. Дело сгорело.', 'err');
      ecSpyCaseClose(); await ecReloadPaint();
    }
  } catch (e) { toast(ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}

// Отметка подозреваемого по измерению: ✓ совпало / ✗ нет / ? смазано / · не вскрыто.
function _ecCaseMark(v) {
  if (v === 'yes') return '<span class="ec-case-m yes">✓</span>';
  if (v === 'no') return '<span class="ec-case-m no">✗</span>';
  if (v === '?') return '<span class="ec-case-m unk">?</span>';
  return '<span class="ec-case-m none">·</span>';
}

function ecSpyCaseRender(c) {
  const op = EC_SPY_OPS[c.op] || { icon: '🗂', label: c.op };
  const trail = Math.max(0, Math.min(100, c.trail || 0));
  const trailColor = trail > 60 ? '#5fd27f' : trail > 30 ? '#e6c45f' : '#ff6a6a';
  const conf = Math.max(0, Math.min(100, c.confidence || 0));
  const closed = !!c.verdict;
  const revealedDims = (c.clues || []).reduce((m, cl) => (m[cl.dim] = cl, m), {});

  // баннер исхода закрытого дела
  let banner = '';
  if (c.verdict === 'solved') banner = `<div class="ec-case-banner ok">✅ Дело раскрыто — шпион вычислен.</div>`;
  else if (c.verdict === 'wrong') banner = `<div class="ec-case-banner bad">⚖ Ложное обвинение — дело сгорело, шпион ушёл.</div>`;
  else if (c.verdict === 'cold') banner = `<div class="ec-case-banner cold">❄ След остыл — дело закрыто нераскрытым.</div>`;

  // открытые улики (профиль виновного)
  const cluesHtml = (c.clues && c.clues.length)
    ? c.clues.map(cl => {
      const d = EC_CASE_DIMS.find(x => x[0] === cl.dim) || ['', '•', cl.dim];
      return `<span class="ec-case-clue${cl.noisy ? ' noisy' : ''}">${d[1]} ${esc(d[2])}: <b>${cl.noisy ? '<i>смазано</i>' : esc(cl.value)}</b></span>`;
    }).join('')
    : `<span class="ec-hint">улик ещё нет — примените следственный метод</span>`;

  // методы
  const methodsHtml = Object.keys(EC_CASE_METHODS).map(k => {
    const m = EC_CASE_METHODS[k];
    const uses = (c.methods || {})[k] || 0;
    let cost = m.cost;
    if (k !== 'interro' && m.dim && revealedDims[m.dim]) cost = Math.ceil(cost * 1.5); // перепроверка
    let locked = false, why = '';
    if (closed) { locked = true; }
    else if (k === 'surveil' && (c.idle_agents || 0) < 1) { locked = true; why = 'нет свободного агента'; }
    else if (k === 'wiretap' && (c.ci || 0) < 3) { locked = true; why = `нужна КР области ≥3 (есть ${c.ci || 0})`; }
    else if (k === 'interro' && !c.caught) { locked = true; why = 'агент не пойман'; }
    else if (k === 'interro' && uses >= 1) { locked = true; why = 'уже допрошен'; }
    const recheck = (k !== 'interro' && m.dim && revealedDims[m.dim]);
    const label = k === 'interro' ? 'допросить' : recheck ? 'перепроверить' : 'применить';
    const costTxt = cost > 0 ? `${ecNum(cost)} ГС` : 'бесплатно';
    return `<button class="ec-case-method${locked ? ' locked' : ''}${uses ? ' used' : ''}" ${locked ? 'disabled' : ''}
        title="${esc(m.hint)}${why ? ' · ' + why : ''}" onclick="ecSpyCaseMethod('${k}')">
      <span class="ec-case-method-ic">${m.ic}</span>
      <span class="ec-case-method-body">
        <span class="ec-case-method-name">${esc(m.name)}${uses ? ` <small>×${uses}</small>` : ''}</span>
        <span class="ec-case-method-sub">${locked && why ? esc(why) : `${label} · ${costTxt}`}</span>
      </span>
    </button>`;
  }).join('');

  // таблица подозреваемых
  const headCols = EC_CASE_DIMS.map(d => `<span class="ec-case-col" title="${esc(d[2])}">${d[1]}</span>`).join('');
  const rows = (c.suspects || []).map(s => {
    const marks = EC_CASE_DIMS.map(d => `<span class="ec-case-cell">${_ecCaseMark((s.marks || {})[d[0]])}</span>`).join('');
    const accuseBtn = closed
      ? (c.accused === s.fid ? `<span class="ec-case-accused">${c.verdict === 'solved' ? '✅ виновен' : '⚖ обвинён'}</span>` : '')
      : (s.consistent
          ? `<button class="btn btn-rd btn-xs" onclick="ecSpyCaseAccuse('${esc(s.fid)}')">⚖ Обвинить</button>`
          : `<span class="ec-case-ruled" title="Отсеян уликами — обвинять нельзя">— отсеян</span>`);
    return `<div class="ec-case-row${s.consistent ? ' consistent' : ' ruled-out'}">
      <span class="ec-case-sus">${ecFacFlag(s.fid, 22)}<b>${esc(s.name)}</b></span>
      <span class="ec-case-marks">${marks}</span>
      <span class="ec-case-act">${accuseBtn}</span>
    </div>`;
  }).join('');

  _ecCaseHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecSpyCaseClose()">
    <div class="ec-bp-modal ec-case-modal" role="dialog" aria-modal="true">
      <div class="ec-bp-hd">
        <div class="ec-bp-hd-t"><span class="ec-bp-hd-ic">🗂</span><span>Следственное дело · ${esc(op.label)}</span></div>
        <button class="ec-bp-x" title="Закрыть" onclick="ecSpyCaseClose()">✕</button>
      </div>
      ${banner}
      <div class="ec-case-meters">
        <div class="ec-case-meter">
          <div class="ec-case-meter-lbl"><span>❄ Свежесть следа</span><b style="color:${trailColor}">${trail}%</b></div>
          <div class="ec-case-meter-bar"><div style="width:${trail}%;background:${trailColor}"></div></div>
          <div class="ec-hint">След остывает со временем — успейте довести дело до обвинения.</div>
        </div>
        <div class="ec-case-meter">
          <div class="ec-case-meter-lbl"><span>🎯 Ясность картины</span><b>${conf}%</b></div>
          <div class="ec-case-meter-bar"><div style="width:${conf}%;background:#6aa0e6"></div></div>
          <div class="ec-hint">Чем меньше держав сходится с уликами — тем выше ясность.</div>
        </div>
      </div>
      <div class="ec-case-clues">${cluesHtml}</div>
      <div class="ec-case-sec-t">Следственные методы</div>
      <div class="ec-case-methods">${methodsHtml}</div>
      <div class="ec-case-sec-t">Подозреваемые <span class="ec-hint">(✓ сходится · ✗ нет · ? смазано · · не вскрыто)</span></div>
      <div class="ec-case-board">
        <div class="ec-case-head"><span class="ec-case-sus"> </span><span class="ec-case-marks">${headCols}</span><span class="ec-case-act"> </span></div>
        ${rows}
      </div>
      <div class="ec-bp-foot">Сопоставьте улики с подозреваемыми и выдвиньте обвинение. Ошибка сожжёт дело.</div>
    </div>
  </div>`;
}
// Строка журнала (завершённая операция)
function ecSpyLogRow(m) {
  const when = ecAgo(m.ready_at || m.created_at);
  if (m.op === 'train') {
    return `<div class="ec-spy-row ok">
      <span class="ec-spy-row-badge ok">✓</span>
      <div class="ec-spy-row-body">
        <div class="ec-spy-row-top">🎓 <b>Тайное обучение</b></div>
        <div class="ec-spy-row-detail">${ecNum(m.agents)} агент(ов) получили опыт</div>
        <div class="ec-spy-row-foot">${when}</div>
      </div>
    </div>`;
  }
  const d = EC_SPY_OPS[m.op] || { icon: '•', label: m.op };
  const r = m.result || {};
  const ok = m.outcome === 'success';
  let detail = '', meaning = '';   // detail = что произошло, meaning = что это значит
  if (m.op === 'recon_basic' || m.op === 'recon_deep') { detail = ok ? `ГС ${ecNum(r.gc)} · ОН ${ecNum(r.science)} · агентов ${ecNum(r.agents)} · колоний ${r.colonies ?? '—'} · построек ${r.buildings ?? '—'}` : 'разведка сорвана'; meaning = ok ? 'досье собрано — открыты операции по цели' : ''; }
  else if (m.op === 'steal_gc') { detail = ok ? `украдено ${ecNum(r.gc)} ГС` : 'провал — добыча не получена'; }
  else if (m.op === 'steal_res') { detail = ok ? `похищено ${ecNum(r.amount)} ед. ${esc(r.resource || '?')}` : 'провал'; }
  else if (m.op === 'sabotage') { detail = ok ? `выведено из строя: ${esc(r.building || 'здание')}${r.colony ? ` (${esc(r.colony)})` : ''}` : 'провал'; meaning = ok ? 'у цели простаивает постройка' : ''; }
  else if (m.op === 'mass_demolish') { detail = ok ? `снесено ${r.count || 0} зданий: ${(r.buildings || []).map(b => esc(b)).join(', ') || '—'}` : 'провал'; }
  else if (m.op === 'steal_tech') { detail = ok ? `украдена технология: ${esc(r.tech_name || r.tech || '—')}` : 'провал'; meaning = ok ? 'технология добавлена в ваше дерево' : ''; }
  else if (m.op === 'destabilize') { detail = ok ? `доход цели снижен на ${Math.round((r.debuff_pct || 0) * 100)}% (${r.turns || 0} ход.)` : 'провал'; }
  else if (m.op === 'kill_agent') { detail = ok ? `агент ликвидирован: ${esc(r.agent_name || '—')}` : 'провал'; }
  else if (m.op === 'faith_impose') { detail = ok ? `внедрена тайная секта: ${esc(r.faith || r.sect || '—')}` : 'провал'; meaning = ok ? 'тайный доход вам, пока цель не вскроет секту' : ''; }
  const artTxt = r.artifact ? `<span class="ec-spy-tag art">🎒 артефакт: ${esc(ecArt(r.artifact).label)}</span>` : '';
  const footBits = [when];
  if (m.agents) footBits.push(`🕵 ${ecNum(m.agents)}`);
  if (m.detected) footBits.push('<span style="color:var(--color-warning,#e0a030)">⚠ раскрыто</span>');
  return `<div class="ec-spy-row ${ok ? 'ok' : 'fail'}">
    <span class="ec-spy-row-badge ${ok ? 'ok' : 'fail'}">${ok ? '✓' : '✕'}</span>
    <div class="ec-spy-row-body">
      <div class="ec-spy-row-top">${d.icon} <b>${esc(d.label)}</b> <span class="ec-spy-row-arr">→</span> ${ecFacFlag(m.target_fid, 22)}<span class="ec-spy-row-tgt">${esc(m.target_name || ecFacName(m.target_fid))}</span>${artTxt}</div>
      <div class="ec-spy-row-detail">${detail}${meaning ? ` <i class="ec-spy-mean">— ${meaning}</i>` : ''}</div>
      <div class="ec-spy-row-foot">${footBits.join(' · ')}</div>
    </div>
  </div>`;
}

// ── Каталог исследований (из данных конструкторов) ──────────
// Ветки дерева исследований (метка + иконка). Военные — из данных конструктора,
// политика — ручное дерево с пассивными бонусами (ниже EC_POLITICS).
const EC_RES_CATS = [
  ['ship', 'Флот', '🚀'],
  ['ground', 'Наземные войска', '⚙'],
  ['aviation', 'Авиация', '✈'],
  ['politics', 'Политика', '🏛'],
];
// ── ПОЛИТИКА: пассивные бонусы на экономику/производство/экспансию ──
// Политические доктрины фракции. bonus — модификаторы (зеркало в SQL _faction_mods!).
// special:'claim2' — спец-механика захвата двух систем за цикл.
const EC_POLITICS = [
  // Экономика
  { id: 'pol.new_deal',     branch: 'econ',   name: 'Торговые концессии',        cost: 30, prereq: [],                  bonus: { gc: 0.10 },
    desc: 'Открытие рынков и налоговые льготы для межзвёздных корпораций — приток капитала в казну. +10% дохода.' },
  { id: 'pol.mercantile',   branch: 'econ',   name: 'Торговая монополия',        cost: 50, prereq: ['pol.new_deal'],    bonus: { gc: 0.10, build: -0.05 },
    desc: 'Государственный контроль над межсистемными торговыми маршрутами. +10% дохода, −5% к цене построек.' },
  // Производство
  { id: 'pol.five_year',    branch: 'prod',   name: 'Директивная экономика',     cost: 35, prereq: [],                  bonus: { build: -0.15 },
    desc: 'Централизованное планирование производства: верфи и заводы работают по единому государственному плану. −15% к цене построек.' },
  { id: 'pol.goelro',       branch: 'prod',   name: 'Энергетическая сеть',       cost: 55, prereq: ['pol.five_year'],   bonus: { mine: 0.15 },
    desc: 'Единая энергосеть фракции: реакторные узлы повышают КПД добывающих комплексов. +15% добычи.' },
  // Экспансия → капстоун «Дом в небесах»
  { id: 'pol.land_reform',  branch: 'expand', name: 'Колонизационный кодекс',    cost: 30, prereq: [],                  bonus: { colonize: -0.15 },
    desc: 'Стандартизация прав поселенцев и льготная логистика для первых волн освоения. −15% к цене колоний.' },
  { id: 'pol.total_mob',    branch: 'expand', name: 'Экспансионный мандат',      cost: 55, prereq: ['pol.land_reform'], bonus: { claim_cost: -0.20 },
    desc: 'Доктрина приоритетной экспансии: флот и дипломатия брошены на расширение границ. −20% к цене захвата систем.' },
  { id: 'pol.house_heavens', branch: 'expand', name: 'Дом в небесах',            cost: 90, prereq: ['pol.total_mob'],   special: 'claim2',
    desc: 'Имперский колониальный проект: служба освоения позволяет захватить ДВЕ системы за один цикл, прежде чем уйти на кулдаун.' },
  // Небожители — освоение НЕПРИГОДНЫХ миров через малые станции (3–5 ячеек застройки).
  // station.groups — какие группы планет открывает; station.cells — размер станции.
  { id: 'pol.cel_asteroid', branch: 'celestial', name: 'Астероидные станции',     cost: 20,  prereq: [],
    special: 'station', station: { groups: ['belt'], cells: 3, label: 'Астероидная станция', icon: '🪨' },
    desc: 'Небожители учатся крепить обитаемые модули прямо к астероидам и телам пояса. Открывает постройку малой станции (3 ячейки застройки) на поясах и астероидах, где обычная колония невозможна.' },
  { id: 'pol.cel_giants',   branch: 'celestial', name: 'Орбитальные станции',     cost: 40, prereq: ['pol.cel_asteroid'],
    special: 'station', station: { groups: ['gasgiant', 'icegiant', 'hotgiant'], cells: 4, label: 'Орбитальная станция', icon: '🛰' },
    desc: 'Подвесные орбитальные платформы над газовыми, ледяными и горячими гигантами — забор газов и тяжёлая промышленность на орбите. Открывает станцию на 4 ячейки над гигантами всех типов.' },
  { id: 'pol.cel_anomaly',  branch: 'celestial', name: 'Аномальные станции',      cost: 60, prereq: ['pol.cel_giants'],
    special: 'station', station: { groups: ['anomaly'], cells: 5, label: 'Аномальная станция', icon: '🌀' },
    desc: 'Технология стабилизации конструкций внутри пространственных аномалий. Открывает крупнейшую станцию Небожителей — 5 ячеек застройки прямо в аномалии.' },
  // Разум — дополнительные слоты очереди исследований (параллельные проекты).
  { id: 'pol.light_knowledge', branch: 'mind', name: 'Свет знаний',           cost: 70,  prereq: [],
    special: 'rslot', slots: 1,
    desc: 'Государственная программа всеобщего просвещения и сети академий. Открывает +1 слот исследований — можно вести на одну технологию больше параллельно.' },
  { id: 'pol.mind_supremacy',  branch: 'mind', name: 'Превосходство разума',   cost: 140, prereq: ['pol.light_knowledge'],
    special: 'rslot', slots: 2,
    desc: 'Доктрина приоритета фундаментальной науки: лучшие умы фракции работают сразу над несколькими прорывами. Открывает +2 слота исследований.' },
  // Неотвратимость — запредельно дорогой капстоун. Открывает постройку «Длань
  // Неотвратимости» (межзвёздную артиллерию). Зеркало tech_nodes.pol.inevitability.
  { id: 'pol.inevitability', branch: 'doom', name: 'Сама неотвратимость',     cost: 5000, prereq: [],
    special: 'artillery',
    desc: 'Запретная доктрина конца. Государство учится фокусировать гравитацию в луч, способный пройти межзвёздную бездну и вскипятить кору целой планеты. Открывает постройку «Длань Неотвратимости» — орудие, стирающее миры. Цена изучения чудовищна, и не зря: то, что нельзя забыть, лучше было не узнавать.' },
];
// id → bonus (для ecFactionMods). Спец-механики (special) применяются отдельно.
const EC_RESEARCH_BONUS = {};
EC_POLITICS.forEach(n => { if (n.bonus) EC_RESEARCH_BONUS[n.id] = n.bonus; });
// Привязка оружия/компонентов к классу-тиру (тематичные prereq → ветвление дерева).
// Значение = ключ класса (k из CN_*.data). Базовый класс/отсутствие → узел-корень ветки.
const EC_TECH_TREE = {
  ship: {
    weapon: { 'Легкие': 'corvette', 'Средние': 'frigate', 'Тяжёлые': 'cruiser', 'Сверхтяжёлые': 'battleship', 'Ракетное': 'destroyer', 'Зенитное': 'frigate' },
    comp:   { engine: 'frigate', reactor: 'destroyer', armor: 'destroyer', shield: 'cruiser' },
  },
  ground: {
    weapon: { 'Противопехотное': 'light', 'Противотанковое': 'medium', 'Артиллерия и ПВО': 'artillery' },
    comp:   { engine: 'medium', armor: 'heavy', shield: 'heavy' },
  },
  aviation: {
    weapon: { 'Курсовое вооружение': 'light', 'Ракетное и бомбовое': 'medium', 'Спецоборудование': 'heavy' },
    comp:   { engine: 'medium', reactor: 'medium', armor: 'heavy', shield: 'heavy' },
  },
};
// «Исследовать всё в конструкторах»: бывшая бесплатная база (CN_BASE) стала
// СТАРТОВЫМИ исследованиями — дешёвые корни дерева, не сдвигающие цены легаси-
// узлов (не увеличивают счётчик тира). Существующим фракциям выданы бэкфиллом
// (_research_total.sql). Зеркало: tech_nodes в SQL.
const EC_TECH_STARTER = {
  'cls.ship.corvette': 1, 'cls.ground.light': 1, 'cls.aviation.light': 1,
  'wpn.ship.Легкие': 1, 'wpn.ship.Средние': 1,
  'wpn.ground.Противопехотное': 1, 'wpn.ground.Противотанковое': 1,
  'wpn.aviation.Курсовое вооружение': 1,
};
// Дерево исследований: узлы того же id-формата (cls./wpn./comp.) — id-контракт с
// конструкторами сохранён. Добавлены branch/prereq/desc для древовидной раскладки.
function ecBuildResearch() {
  if (EC._research) return EC._research;
  const out = [];
  const base = (typeof CN_BASE !== 'undefined') ? CN_BASE : { classes: {}, weapons: {} };
  const DB = { ship: (typeof CN_SHIP !== 'undefined' ? CN_SHIP : null), ground: (typeof CN_GROUND !== 'undefined' ? CN_GROUND : null), aviation: (typeof CN_AIR !== 'undefined' ? CN_AIR : null) };
  EC_RES_CATS.forEach(([cat, catLabel]) => {
    const db = DB[cat]; if (!db) return;
    const hasReactor = !!db.reactors;
    const tree = EC_TECH_TREE[cat] || { weapon: {}, comp: {} };
    const baseCls = base.classes[cat] || [];
    // class prereq → массив id (база/отсутствие = корень ветки)
    const clsId = k => (k && !baseCls.includes(k) && db.data[k]) ? ['cls.' + cat + '.' + k] : [];

    // ── Класс-хребет (линейная цепочка по тирам) ──
    // Стартовые классы (бывшая база) — дёшево (3 ОН) и БЕЗ сдвига тир-счётчика,
    // чтобы цены легаси-узлов не поменялись от их появления в цепочке.
    let prev = null, ci = 0;
    Object.keys(db.data).forEach(k => {
      if (baseCls.includes(k)) return;
      const id = 'cls.' + cat + '.' + k;
      const startr = EC_TECH_STARTER[id];
      out.push({ id, cat, catLabel, branch: 'class', name: db.data[k].name,
        desc: startr ? 'Стартовый класс: открывает ветку конструктора' : 'Открывает класс в конструкторе и ветку технологий',
        cost: startr ? 3 : 5 * Math.pow(2, ci), prereq: prev ? [prev] : [] });
      prev = id; if (!startr) ci++;
    });

    // ── Оружие (ветви, привязаны к классу-тиру) ──
    // Стартовые группы (бывшая база) — 5 ОН и без сдвига счётчика цен.
    const baseW = base.weapons[cat] || [];
    let wi = 0;
    Object.keys(db.weapons || {}).forEach(g => {
      if (baseW.includes(g)) return;
      const wid = 'wpn.' + cat + '.' + g;
      const startr = EC_TECH_STARTER[wid];
      out.push({ id: wid, cat, catLabel, branch: 'weapon', name: g,
        desc: 'Разблокирует орудия «' + g + '» в конструкторе', cost: startr ? 5 : 12 + wi * 8, prereq: clsId(tree.weapon && tree.weapon[g]) });
      if (!startr) wi++;
    });

    // ── Компоненты (ветви) ──
    const COMP_DESC = { armor: 'Модули усиленной брони — повышают выживаемость в бою', shield: 'Щиты нового поколения: выше регенерация и ёмкость', engine: 'Продвинутые двигатели: скорость, тяга и манёвренность', reactor: 'Реакторы высокой мощности — энергия для тяжёлых систем' };
    const comps = [['armor', 14], ['shield', 16], ['engine', 10]];
    if (hasReactor) comps.unshift(['reactor', 16]);
    const COMP_NAMES = { armor: 'Продвинутая броня', shield: 'Продвинутые щиты', engine: 'Продвинутые двигатели', reactor: 'Продвинутые реакторы' };
    comps.forEach(([t, cost]) => {
      out.push({ id: 'comp.' + cat + '.' + t, cat, catLabel, branch: t, name: COMP_NAMES[t],
        desc: COMP_DESC[t], cost, prereq: clsId(tree.comp && tree.comp[t]) });
    });

    // ── Продвинутые типы корпусов (2-й/3-й вариант класса) ──
    Object.keys(db.data).forEach(k => {
      const types = db.data[k].types;
      if (!types || types.length < 2) return;
      // база-класс → корень ветки; иначе требует свой класс
      const pre = baseCls.includes(k) ? [] : ['cls.' + cat + '.' + k];
      out.push({ id: 'type.' + cat + '.' + k, cat, catLabel, branch: 'type', name: 'Спец-корпуса: ' + db.data[k].name,
        desc: 'Спецкорпуса: уникальные роли и нестандартные компоновки', cost: 10, prereq: pre });
    });

    // ── Модули и системы (отдельная ветка-цепочка) ──
    let prevMod = null, mi = 0;
    Object.keys(db.modules || {}).forEach(g => {
      const id = 'mod.' + cat + '.' + g;
      out.push({ id, cat, catLabel, branch: 'module', name: g,
        desc: 'Системы «' + g + '» — доступны в конструкторе', cost: 8 + mi * 5, prereq: prevMod ? [prevMod] : [] });
      prevMod = id; mi++;
    });

    // ── Ангары и авиакрылья (только флот) ──
    if (cat === 'ship') {
      out.push({ id: 'hangar.ship', cat, catLabel, branch: 'hangar', name: 'Ангарные палубы',
        desc: 'Ангары для базирования авиакрыльев и малых судов на борту кораблей', cost: 22, prereq: clsId('destroyer') });
      out.push({ id: 'hangar.ship.heavy', cat, catLabel, branch: 'hangar', name: 'Тяжёлые ангары',
        desc: 'Крупные боевые ангары — вмещают тяжёлые и штурмовые авиакрылья', cost: 40, prereq: ['hangar.ship'] });
    }
  });
  // ── Политика: ручное дерево бонусов ──
  EC_POLITICS.forEach(n => out.push({
    id: n.id, cat: 'politics', catLabel: 'Политика', branch: n.branch,
    name: n.name, desc: n.desc, cost: n.cost, prereq: n.prereq || [],
    bonus: n.bonus || null, special: n.special || null, station: n.station || null, slots: n.slots || null,
  }));
  // ── Overlay staff-правок связей: prereq из tech_prereq поверх дефолта ──
  // _prereq0 хранит дефолт (для «сброса к авто-связям»); prereq — действующее.
  out.forEach(n => {
    n._prereq0 = n.prereq || [];
    if (EC.techPrereq && EC.techPrereq[n.id]) n.prereq = EC.techPrereq[n.id].slice();
  });
  EC._research = out;
  return out;
}
function ecSetResearchCat(c) { EC.researchCat = c; ecPaintCabinet(); }
// Глубина узла = длиннейшая цепочка prereq (роль тира). Мемоизация.
function ecTechDepth(n, byId, cache) {
  if (cache[n.id] != null) return cache[n.id];
  cache[n.id] = 0;
  let d = 0;
  (n.prereq || []).forEach(p => { const pn = byId.get(p); if (pn) d = Math.max(d, ecTechDepth(pn, byId, cache) + 1); });
  cache[n.id] = d; return d;
}
// Кол-во слотов исследований: база 1 (+1 роботам) + политики «Свет знаний» (+1)
// и «Превосходство разума» (+2). Зеркало public._research_slots в SQL.
function ecResearchSlots() {
  const r = (EC.eco && EC.eco.research) || [];
  let n = ecIsRobot() ? 2 : 1;
  n += ecTechnoSlots();
  if (r.includes('pol.light_knowledge')) n += 1;
  if (r.includes('pol.mind_supremacy')) n += 2;
  return n;
}
// Технократы ведут больше исследований параллельно: форма правления «Технократия»
// и/или идеология «Культ науки» дают по +1 слоту. Стекается с роботами и
// политиками ветки «Разум». Зеркало: public._research_slots в _technocracy.sql.
function ecTechnoSlots(app) {
  app = app || (typeof EC !== 'undefined' && EC.app) || {};
  return ((EC_DOCTRINE_SLOTS.gov || {})[app.gov] || 0) + ((EC_DOCTRINE_SLOTS.ideology || {})[app.ideology] || 0);
}
// Активные исследования: массив {n: node, r: ready_iso}.
function ecActiveResearch() { return Array.isArray(EC.eco.research_slots) ? EC.eco.research_slots : []; }
// Очередь технологий: массив node-id.
function ecResearchQueueArr() { return Array.isArray(EC.eco.research_queue) ? EC.eco.research_queue : []; }
function ecTabResearch() {
  const all = ecBuildResearch();
  const done = new Set(EC.eco.research || []);
  // Слоты: база + бонусы роботов/политики. Очередь автозапускается на тике.
  const maxSlots = ecResearchSlots();
  const activeSlots = ecActiveResearch().map(s => [s.n, s.r]);
  const queue = ecResearchQueueArr();
  const activeSet = new Set(activeSlots.map(([a]) => a));
  const queueSet = new Set(queue);
  const slotsFull = activeSlots.length >= maxSlots;
  const sci = EC.eco.science || 0;
  const sciInc = ecIncomePreview().science;
  const sel = EC.researchCat || 'ship';

  const nameOf = id => { const node = all.find(n => n.id === id); return node ? node.name : id; };
  const activeHtml = activeSlots.map(([a, ready], i) => {
    return `<div class="ec-cap ec-cap-prog">⏳ Слот ${i + 1}: <b>${esc(nameOf(a))}</b> ${ecProgressISO(null, ready, 1, 'готово на след. ходу')}</div>`;
  }).join('') + Array.from({ length: Math.max(0, maxSlots - activeSlots.length) }, (_, i) =>
    `<div class="ec-cap ec-cap-prog ec-cap-free">○ Слот ${activeSlots.length + i + 1}: <span style="color:var(--t4)">свободен</span></div>`).join('');

  // ── Причина простоя для каждой техи в очереди ──
  // Симуляция зеркалит серверный _research_step: порядок проверок строго
  // слот → предшественник → ОН; стартующие техи «занимают» слот и тратят ОН,
  // поэтому подсказка для нижних элементов учитывает расход верхних.
  const queueReason = (() => {
    let freeSlots = Math.max(0, maxSlots - activeSlots.length);
    let budget = sci;
    const map = {};
    for (const id of queue) {
      const node = all.find(n => n.id === id) || {};
      const cost = ecResearchCost(node.cost || 0);
      if (freeSlots <= 0) { map[id] = { ic: '⏸', cls: 'wait', txt: 'ждёт свободный слот' }; continue; }
      const miss = (node.prereq || []).filter(p => !done.has(p));
      if (miss.length) { map[id] = { ic: '🔒', cls: 'lock', txt: 'ждёт: ' + miss.map(nameOf).join(', ') }; continue; }
      if (budget < cost) { map[id] = { ic: '⚠', cls: 'sci', txt: `не хватает ОН: нужно ${ecNum(cost)} (есть ${ecNum(budget)})` }; continue; }
      map[id] = { ic: '▶', cls: 'go', txt: 'стартует в этот слот' };
      freeSlots -= 1; budget -= cost;
    }
    return map;
  })();

  // Очередь технологий — автозапуск в освободившиеся слоты (сразу при действии и на тике).
  const queueHtml = queue.length
    ? `<div class="ec-rqueue"><div class="ec-rqueue-h">🕓 Очередь технологий <span class="ec-hint">(${queue.length}) — запускаются автоматически, как только освободится слот и хватит ОН</span></div>
        ${queue.map((id, i) => { const rsn = queueReason[id] || { ic: '', cls: 'wait', txt: '' }; return `<div class="ec-rqueue-item"><span class="ec-rqueue-n">${i + 1}</span><b>${esc(nameOf(id))}</b><span class="ec-rqueue-cost">${ecNum(ecResearchCost((all.find(n => n.id === id) || {}).cost || 0))} ОН</span><span class="ec-rqueue-why ${rsn.cls}" title="${esc(rsn.txt)}">${rsn.ic} ${esc(rsn.txt)}</span><button class="btn btn-gh btn-xs" onclick="ecDequeueResearch(${i})" title="Убрать">✕</button></div>`; }).join('')}
      </div>`
    : '';

  // под-вкладки родов войск — теперь это кнопки БЫСТРОГО ПЕРЕХОДА по единому
  // холсту (а не фильтр): клик скроллит к секции рода и подсвечивает её.
  const subTabs = EC_RES_CATS.map(([c, l, ic]) => {
    const cnt = all.filter(n => n.cat === c);
    const dn = cnt.filter(n => done.has(n.id)).length;
    return `<button class="ec-rcat${sel === c ? ' on' : ''}" data-cat="${c}" onclick="ecTreeJump('${c}')" title="Перейти к ветке «${esc(l)}»">${ic} ${esc(l)} <span class="ec-rcat-cnt">${dn}/${cnt.length}</span></button>`;
  }).join('');

  // ── ЕДИНОЕ ДРЕВО (как в Path of Exile): один холст, ветви расходятся из
  // ЦЕНТРА (ядра) в РАЗНЫЕ стороны. Категория = сектор-«рукав», внутри неё ветки
  // веером, глубина prereq = радиус (дальше от ядра — продвинутее технология).
  // Холст не привязан к краю; навигация — свободный пан мышью + зум колесом.
  const nodes = all;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const cache = {};
  nodes.forEach(n => { n._d = ecTechDepth(n, byId, cache); });

  const W = EC_TREE_W, H = EC_TREE_H;
  const PAD = 140;
  // Порядок веток внутри каждой категории (угол ветки в рукаве + порядок в под-вкладке).
  const CAT_LANES = {
    ship:     ['class', 'type', 'weapon', 'reactor', 'engine', 'armor', 'shield', 'hangar', 'module'],
    ground:   ['class', 'type', 'weapon', 'reactor', 'engine', 'armor', 'shield', 'hangar', 'module'],
    aviation: ['class', 'type', 'weapon', 'reactor', 'engine', 'armor', 'shield', 'hangar', 'module'],
    politics: ['econ', 'prod', 'expand', 'mind', 'celestial'],
  };

  // ── СТАБИЛЬНАЯ РАСКЛАДКА ХОЛСТА ──────────────────────────────────────────
  // Радиальная авто-раскладка зависит от ГЛУБИНЫ prereq (depth → радиус). Если
  // считать её заново на каждую правку связи, depth меняется и ВСЕ незакреплённые
  // узлы прыгают на новые места — «выкидывает все исследования». Поэтому тяжёлый
  // радиальный расчёт + нормализацию делаем ОДИН раз и кэшируем по набору узлов
  // каталога: правка связей набор не меняет → берём готовые авто-места из кэша,
  // а связи лишь перерисовывают рёбра между неподвижными узлами.
  const nodeKey = nodes.map(n => n.id).join('|');
  let pos, armLabels, coreX, coreY, cw, ch;
  if (EC._treeLayoutKey === nodeKey && EC._treeLayoutCache) {
    const c = EC._treeLayoutCache;
    pos = Object.assign({}, c.pos);              // авто-места (мировые координаты)
    armLabels = c.armLabels; coreX = c.coreX; coreY = c.coreY; cw = c.cw; ch = c.ch;
  } else {
    // Параметры радиальной раскладки (под компактные узлы-самоцветы).
    const R0 = 420;            // радиус первого кольца (depth 0) от ядра
    const RING = 200;          // прирост радиуса на каждый тир глубины
    const STAG = 110;          // сдвиг радиуса для чётных веток (чтобы соседние не налезали)
    const ARC = 170;           // целевой шаг между соседними узлами вдоль дуги (px)
    const CX = 5000, CY = 5000;   // центр на большом холсте (нормализуем ниже)

    const activeCats = EC_RES_CATS.filter(([cat]) => nodes.some(n => n.cat === cat));
    const nCats = activeCats.length || 1;
    pos = {};
    armLabels = [];      // { x, y, cat, label }
    activeCats.forEach(([cat, catLabel], ci) => {
      const cnodes = nodes.filter(n => n.cat === cat);
      const aCat = (ci / nCats) * Math.PI * 2 - Math.PI / 2;        // центральный угол рукава
      const catSpan = (Math.PI * 2 / nCats) * 0.8;                  // угловой размах рукава (оставляем зазор между рукавами)
      const branches = (CAT_LANES[cat] || []).concat(
        [...new Set(cnodes.map(n => n.branch))].filter(b => !(CAT_LANES[cat] || []).includes(b)))
        .filter(b => cnodes.some(n => n.branch === b));
      const nb = branches.length || 1;
      branches.forEach((branch, bi) => {
        const lnodes = cnodes.filter(n => n.branch === branch);
        if (!lnodes.length) return;
        const aBranch = aCat + (nb > 1 ? (bi / (nb - 1) - 0.5) * catSpan : 0);   // угол ветки в рукаве
        const bStag = (bi % 2) * STAG;                              // чередуем радиус соседних веток
        const byDepth = {};
        lnodes.forEach(n => { (byDepth[n._d] = byDepth[n._d] || []).push(n); });
        Object.entries(byDepth).forEach(([d, ns]) => {
          const r = R0 + bStag + parseInt(d) * RING;
          const spread = (ns.length - 1) * ARC / r;                 // угловой разброс узлов одного тира
          ns.forEach((n, i) => {
            const a = aBranch + (ns.length > 1 ? (i / (ns.length - 1) - 0.5) * spread : 0);
            pos[n.id] = { x: CX + r * Math.cos(a) - W / 2, y: CY + r * Math.sin(a) - H / 2 };
          });
        });
      });
      // метка рукава категории — между ядром и первым кольцом, по центральному углу
      armLabels.push({ x: CX + (R0 * 0.42) * Math.cos(aCat) - 60, y: CY + (R0 * 0.42) * Math.sin(aCat) - 16, cat, label: catLabel });
    });

    // Нормализация: сдвигаем всё, чтобы минимум был в PAD (без пустых краёв холста).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.values(pos).forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + W); maxY = Math.max(maxY, p.y + H); });
    armLabels.forEach(l => { minX = Math.min(minX, l.x); minY = Math.min(minY, l.y); maxX = Math.max(maxX, l.x + 140); maxY = Math.max(maxY, l.y + 34); });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = W; maxY = H; }
    const dx = PAD - minX, dy = PAD - minY;
    Object.keys(pos).forEach(k => { pos[k].x += dx; pos[k].y += dy; });
    armLabels.forEach(l => { l.x += dx; l.y += dy; });
    coreX = CX + dx; coreY = CY + dy;
    cw = maxX + dx + PAD; ch = maxY + dy + PAD;

    // кэш авто-раскладки (без ручных оверрайдов) — переиспользуется, пока набор узлов тот же
    EC._treeLayoutCache = { pos: Object.assign({}, pos), armLabels, coreX, coreY, cw, ch };
    EC._treeLayoutKey = nodeKey;
  }

  // ── Поверх авто-раскладки — сохранённые позиции (staff двигает руками) ──
  // Применяем КАЖДЫЙ раз, в мировых координатах и БЕЗ ренормализации — поэтому
  // правка связей и драг не сдвигают закреплённые узлы. Узлы без записи в
  // tech_layout остаются на радиальном авто-месте из кэша.
  nodes.forEach(n => {
    const L = EC.techLayout && EC.techLayout[n.id];
    if (L && L.x != null && L.y != null) {
      pos[n.id] = { x: +L.x, y: +L.y };
      cw = Math.max(cw, +L.x + W + PAD); ch = Math.max(ch, +L.y + H + PAD);   // не обрезать вручную утащенные узлы
    }
  });

  // bbox каждой категории (для прыжка по под-вкладке — вписываем всю секцию,
  // чтобы попадать на узлы, а не в пустоту между разъехавшимися ветками).
  const catBox = {};
  EC_RES_CATS.forEach(([cat]) => {
    const cn = nodes.filter(n => n.cat === cat && pos[n.id]);
    if (!cn.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    cn.forEach(n => { const p = pos[n.id]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + W); y1 = Math.max(y1, p.y + H); });
    catBox[cat] = { x0, y0, x1, y1 };
  });

  EC._treePos = pos;            // живые позиции для drag-редактора
  EC._treeNodes = nodes;        // все узлы холста (для перерисовки связей)
  EC._treeDone = done;
  EC._treeCore = { x: coreX, y: coreY };
  EC._treeCatBox = catBox;

  const svg = ecTreeSvg(nodes, pos, done, activeSet, cw, ch, W, H, { x: coreX, y: coreY }, !!EC.treePathEdit);

  // состояние + внутреннее содержимое узла (общее для холста и мобильного списка)
  const nodeState = n => {
    const isDone = done.has(n.id), isActive = activeSet.has(n.id);
    const qIdx = queue.indexOf(n.id);
    const prereqOk = (n.prereq || []).every(p => done.has(p));
    // Цепочку можно ставить в очередь, если каждый предшественник изучен,
    // изучается ИЛИ уже стоит в очереди (зеркало проверки economy_research_queue).
    const chainOk = (n.prereq || []).every(p => done.has(p) || activeSet.has(p) || queueSet.has(p));
    let state = 'locked', foot = '';
    if (isDone) { state = 'done'; foot = '<span class="ec-tnode-badge ok">✓ изучено</span>'; }
    else if (isActive) { state = 'active'; foot = '<span class="ec-tnode-badge cur">⏳ изучается</span>'; }
    else if (qIdx >= 0) { state = 'queued'; foot = `<span class="ec-tnode-badge q">🕓 в очереди №${qIdx + 1}</span><button class="btn btn-gh btn-xs" onclick="event.stopPropagation();ecDequeueResearch(${qIdx})" title="Убрать из очереди">✕</button>`; }
    else if (!prereqOk && !chainOk) { state = 'locked'; const need = (n.prereq || []).map(p => (byId.get(p) || {}).name || p).join(', '); foot = `<span class="ec-tnode-badge lock" title="${esc(need)}">🔒 ${esc(need)}</span>`; }
    else {
      const rc = ecResearchCost(n.cost);
      if (prereqOk && !slotsFull && sci >= rc) { state = 'avail'; foot = `<button class="btn btn-gd btn-xs" onclick="event.stopPropagation();ecResearch('${n.id}')">${ecNum(rc)} ОН</button>`; }
      else { state = 'avail'; foot = `<button class="btn btn-gh btn-xs" onclick="event.stopPropagation();ecQueueResearch('${n.id}')" title="Добавить в очередь — запустится автоматически">+ в очередь · ${ecNum(rc)} ОН</button>`; }
    }
    const bonus = (n.bonus || n.special) ? ecBonusChips(n.bonus, n.special, n.station, n.slots) : '';
    const descHtml = n.desc ? `<div class="ec-tnode-desc">${esc(n.desc)}</div>` : '';
    const inner = `<div class="ec-tnode-h"><span class="ec-tnode-tag">${esc(ecBranchTag(n.branch))}</span></div>
      <div class="ec-tnode-name">${esc(n.name)}</div>
      ${descHtml}${bonus}
      <div class="ec-tnode-foot">${foot}</div>`;
    return { state, inner };
  };
  // ── Самоцвет узла (PoE): картинка/иконка в гранёной рамке + кольцо состояния ──
  const gem = n => {
    const L = (EC.techLayout && EC.techLayout[n.id]) || {};
    const ic = L.icon || EC_BRANCH_ICON[n.branch] || EC_CAT_ICON[n.cat] || '✦';
    return L.img
      ? `<span class="ec-tgem"><img class="ec-tgem-img" src="${esc(L.img)}" alt="" loading="lazy"><span class="ec-tgem-ring"></span></span>`
      : `<span class="ec-tgem ec-tgem-ph"><span class="ec-tgem-ic">${esc(ic)}</span><span class="ec-tgem-ring"></span></span>`;
  };
  const editing = !!EC.treeEdit;
  const pathEditing = editing && !!EC.treePathEdit;   // режим правки связей (prereq)
  // холст (десктоп): компактные узлы-самоцветы (иконка + имя). Подробности,
  // бонусы и кнопки исследования — в модалке по клику (ecResNodeInfo).
  const nodeCard = n => {
    const { state } = nodeState(n); const p = pos[n.id];
    const click = pathEditing ? `ecPathPick('${esc(n.id)}')` : editing ? `ecTreeSelect('${esc(n.id)}',event)` : `ecResNodeInfo('${esc(n.id)}')`;
    const sel = (editing && EC.treeSel === n.id) ? ' ec-tnode-sel' : '';
    const pf = (pathEditing && EC.pathFrom === n.id) ? ' ec-tnode-pathfrom' : '';
    const ttl = pathEditing ? (EC.pathFrom ? 'Клик — провести связь сюда (станет наследником)' : 'Клик — выбрать узел-источник связи')
      : editing ? 'Перетащите · клик — настроить'
      : `${n.name}${n.desc ? ' — ' + n.desc : ''}`;
    const badge = state === 'done' ? '<span class="ec-gpip ok">✓</span>'
      : state === 'active' ? '<span class="ec-gpip cur">⏳</span>'
      : state === 'queued' ? '<span class="ec-gpip q">🕓</span>' : '';
    return `<div class="ec-tnode ec-tnode-gem ec-tnode-${state} ec-br-${n.branch} ec-tnode-clk${sel}${pf}" data-nid="${esc(n.id)}" style="left:${p.x}px;top:${p.y}px;width:${W}px;height:${H}px" onclick="${click}" title="${esc(ttl)}">
      <span class="ec-tnode-gemwrap">${gem(n)}${badge}</span><div class="ec-tnode-glabel">${esc(n.name)}</div></div>`;
  };
  const cards = nodes.map(nodeCard).join('');
  // Ядро дерева (центр) + метки рукавов-категорий.
  const coreHtml = `<div class="ec-tcore" style="left:${coreX - 46}px;top:${coreY - 46}px">🔬<span>НАУКА</span></div>`;
  const armHtml = armLabels.map(l =>
    `<div class="ec-tarm" data-cat="${esc(l.cat)}" style="left:${l.x}px;top:${l.y}px">${esc(EC_CAT_ICON[l.cat] || '')} ${esc(l.label)}</div>`).join('');
  const editBar = ecIsStaff() ? `<div class="ec-tree-tools">
      <button class="ec-tree-tbtn${editing ? ' on' : ''}" onclick="ecTreeEditToggle()" title="Режим раскладки: тащите узлы мышью">${editing ? '✓ Раскладка вкл.' : '✎ Раскладка'}</button>
      ${editing ? `<button class="ec-tree-tbtn${pathEditing ? ' on' : ''}" onclick="ecPathToggle()" title="Режим связей: клик по двум узлам — создать путь, клик по линии — удалить">🔗 Связи</button>` : ''}
      ${editing ? '<button class="ec-tree-tbtn ec-tree-tdanger" onclick="ecTreeResetAll()" title="Сбросить ВСЮ ручную раскладку — узлы вернутся на авто-радиальные места">↺ Сброс всего</button>' : ''}
      <span class="ec-tree-tsep"></span>
      <button class="ec-tree-tbtn${EC.treeFs ? ' on' : ''}" onclick="ecTreeFullscreen()" title="${EC.treeFs ? 'Свернуть' : 'На весь экран'}">${EC.treeFs ? '✕' : '⛶'}</button>
      <button class="ec-tree-tbtn" onclick="ecTreeFit()" title="Вместить всё дерево">⤢</button>
      <button class="ec-tree-tbtn" onclick="ecTreeZoom(-1)" title="Отдалить">−</button>
      <button class="ec-tree-tbtn ec-tree-tzoom" onclick="ecTreeZoom(0)" title="Сброс масштаба">${Math.round((EC.treeZoom || 1) * 100)}%</button>
      <button class="ec-tree-tbtn" onclick="ecTreeZoom(1)" title="Приблизить">+</button>
    </div>` : `<div class="ec-tree-tools">
      <button class="ec-tree-tbtn${EC.treeFs ? ' on' : ''}" onclick="ecTreeFullscreen()" title="${EC.treeFs ? 'Свернуть' : 'На весь экран'}">${EC.treeFs ? '✕' : '⛶'}</button>
      <button class="ec-tree-tbtn" onclick="ecTreeFit()" title="Вместить всё дерево">⤢</button>
      <button class="ec-tree-tbtn" onclick="ecTreeZoom(-1)">−</button>
      <button class="ec-tree-tbtn ec-tree-tzoom" onclick="ecTreeZoom(0)">${Math.round((EC.treeZoom || 1) * 100)}%</button>
      <button class="ec-tree-tbtn" onclick="ecTreeZoom(1)">+</button>
    </div>`;
  const z = EC.treeZoom || 1, px = EC.treePanX || 0, py = EC.treePanY || 0;
  const hint = pathEditing
    ? `<div class="ec-tree-edhint">🔗 Режим связей: ${EC.pathFrom ? `источник <b>${esc((nodes.find(n => n.id === EC.pathFrom) || {}).name || EC.pathFrom)}</b> — кликните узел-наследник` : 'кликните узел-<b>источник</b>'} · клик по линии — удалить связь · правый клик/Esc — отмена</div>`
    : editing
      ? '<div class="ec-tree-edhint">Перетаскивайте узлы мышью — позиция сохраняется. Клик по узлу — emoji/картинка. «🔗 Связи» — править пути.</div>'
      : '<div class="ec-tree-edhint ec-tree-navhint">Тащите мышью — двигать дерево · колесо — зум · клик по узлу — детали</div>';
  const tree = `<div class="ec-tree-stage${editing ? ' ec-tree-editing' : ''}${pathEditing ? ' ec-tree-pathedit' : ''}${EC.treeFs ? ' ec-tree-fs' : ''}">${editBar}
    <div class="ec-tree-viewport" id="ec-tree-vp">
      <div class="ec-tree-world" id="ec-tree-world" style="width:${cw}px;height:${ch}px;transform:translate(${px}px,${py}px) scale(${z});transform-origin:0 0">${svg}${coreHtml}${armHtml}${cards}</div>
    </div>${hint}</div>`;

  // мобильный список: всё дерево — категории, внутри ветки, отсортированы по тиру
  const treeMobile = `<div class="ec-tree-mobile">${EC_RES_CATS.map(([cat, catLabel]) => {
    const cn = nodes.filter(n => n.cat === cat);
    if (!cn.length) return '';
    const order = (CAT_LANES[cat] || []).concat(
      [...new Set(cn.map(n => n.branch))].filter(b => !(CAT_LANES[cat] || []).includes(b)));
    const lanesHtml = order.map(branch => {
      const ln = cn.filter(n => n.branch === branch).sort((a, b) => (a._d || 0) - (b._d || 0));
      if (!ln.length) return '';
      const cardsM = ln.map(n => { const { state, inner } = nodeState(n); return `<div class="ec-tnode ec-tnode-m ec-tnode-${state} ec-br-${n.branch} ec-tnode-clk" onclick="ecResNodeInfo('${esc(n.id)}')"><div class="ec-tnode-top">${gem(n)}<div class="ec-tnode-top-tx">${inner}</div></div></div>`; }).join('');
      return `<div class="ec-tm-lane"><div class="ec-tm-lane-h">${esc(ecBranchTag(branch))}</div><div class="ec-tm-cards">${cardsM}</div></div>`;
    }).join('');
    return lanesHtml ? `<div class="ec-tm-cat"><div class="ec-tm-cat-h">${esc(EC_CAT_ICON[cat] || '')} ${esc(catLabel)}</div>${lanesHtml}</div>` : '';
  }).join('')}</div>`;

  const slotsBullet = maxSlots > 1
    ? `Сейчас доступно <b>${maxSlots} слот${maxSlots > 4 ? 'ов' : 'а'}</b> исследований — столько технологий изучается параллельно (1 ход на каждую). Слоты дают роботы и политики «Свет знаний» (+1) и «Превосходство разума» (+2).`
    : 'Одновременно изучается <b>одна</b> технология, 1 ход на исследование. Открыть параллельные слоты можно политиками «Свет знаний» (+1) и «Превосходство разума» (+2).';
  const slotsHint = `${activeSlots.length}/${maxSlots} слот${maxSlots > 1 ? (maxSlots > 4 ? 'ов' : 'а') : ''} занято · очередь автозапускается`;
  return `${ecIntro('🔬', 'Исследования', 'Тратьте очки науки (ОН) на технологии — они открывают классы, оружие и компоненты в конструкторах.', ['ОН копятся от <b>Научных институтов</b> + бонусов доктрины. Стройте их во вкладке «Колонии».', slotsBullet, 'Тяжёлое оружие и продвинутые компоненты требуют сначала изучить класс-носитель.'])}<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="ec-res"><span class="ec-res-k">Очки науки</span><span class="ec-res-v" style="color:var(--pu)">${ecNum(sci)} ОН</span></div>
      <div class="ec-res"><span class="ec-res-k">Доход</span><span class="ec-res-v" style="font-size:15px">+${sciInc} ОН/ход</span></div>
    </div>
    ${activeHtml}
    ${queueHtml}
    <div class="ec-rcat-tabs">${subTabs}</div>
    <div class="ec-section-title">Единое дерево исследований <span class="ec-hint">— ${slotsHint} · клик по роду войск выше — переход к ветке</span></div>
    ${tree}${treeMobile}`;
}
// Размер слота узла-самоцвета на холсте (десктоп). Компактный: иконка + имя.
const EC_TREE_W = 150, EC_TREE_H = 104;
// Дефолтные emoji-значки по ветке/роду — пока узлу не задана картинка/иконка.
const EC_BRANCH_ICON = { class: '🚀', type: '🛰', weapon: '🎯', armor: '🛡', shield: '🔰', engine: '🚀', reactor: '⚛', hangar: '🛬', module: '📡', econ: '💰', prod: '🏭', expand: '🧭', celestial: '🌌', mind: '🧠' };
const EC_CAT_ICON = { ship: '🚀', ground: '⚙', aviation: '✈', politics: '🏛' };

// Связи дерева — прямые «созвездные» линии центр→центр (PoE), загораются по
// изученной цепочке (.lit) и «текут» в активные узлы (.flow).
function ecTreeSvg(nodes, pos, done, activeSet, cw, ch, W, H, core, pathEdit) {
  let html = '';
  // Спицы от ядра к корневым узлам (без prereq) — связывают всё в ОДНО древо.
  // Узлы, помеченные nocore (откреплены staff'ом), спицу к ядру не получают.
  if (core) nodes.forEach(n => {
    if ((n.prereq || []).length || ecTreeNoCore(n.id)) return;
    const b = pos[n.id]; if (!b) return;
    html += `<path d="M${core.x},${core.y} L${b.x + W / 2},${b.y + H / 2}" class="ec-tedge core${done.has(n.id) ? ' lit' : ''}"/>`;
  });
  nodes.forEach(n => (n.prereq || []).forEach(pid => {
    const a = pos[pid], b = pos[n.id]; if (!a || !b) return;
    const ax = a.x + W / 2, ay = a.y + H / 2, bx = b.x + W / 2, by = b.y + H / 2;
    const cls = 'ec-tedge' + (done.has(pid) ? ' lit' : '') + (activeSet.has(n.id) ? ' flow' : '');
    // в режиме связей — широкая невидимая «хит»-линия для удаления кликом
    if (pathEdit) html += `<path d="M${ax},${ay} L${bx},${by}" class="ec-tedge-hit" onclick="ecPathDelete('${esc(n.id)}','${esc(pid)}')"><title>Удалить связь</title></path>`;
    html += `<path d="M${ax},${ay} L${bx},${by}" class="${cls}"/>`;
  }));
  return `<svg class="ec-tree-svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">${html}</svg>`;
}

// ════════════════════════════════════════════════════════════
// ПАН/ЗУМ ХОЛСТА ДЕРЕВА + drag-редактор узлов (staff).
// Модель: мир (#ec-tree-world) двигается через transform translate()+scale();
// нет нативного скролла — свободный пан мышью/пальцем в любую сторону, зум
// колесом к курсору. Перерисовки нет — только меняем transform (плавно).
// ════════════════════════════════════════════════════════════
function ecTreeEditToggle() { if (!ecIsStaff()) return; EC.treeEdit = !EC.treeEdit; EC.treeSel = null; EC.treePathEdit = false; EC.pathFrom = null; ecTreeInspectorClose(); ecPaintCabinet(); }
// ── Редактор связей дерева (prereq): клик по двум узлам = путь, клик по линии = удалить ──
function ecPathToggle() { if (!ecIsStaff() || !EC.treeEdit) return; EC.treePathEdit = !EC.treePathEdit; EC.pathFrom = null; ecPaintCabinet(); }
function ecPathPick(id) {
  if (!EC.treePathEdit) return;
  if (!EC.pathFrom) { EC.pathFrom = id; ecPaintCabinet(); return; }            // выбран источник
  if (EC.pathFrom === id) { EC.pathFrom = null; ecPaintCabinet(); return; }    // отмена выбора
  const from = EC.pathFrom; EC.pathFrom = null;
  ecPathAdd(from, id);                                                          // from → id (id наследует from)
}
// Зависит ли узел a (транзитивно) от b? — защита от циклов.
function ecDependsOn(a, b, byId) {
  const seen = new Set(), st = [a];
  while (st.length) { const x = st.pop(); if (x === b) return true; if (seen.has(x)) continue; seen.add(x); ((byId.get(x) || {}).prereq || []).forEach(p => st.push(p)); }
  return false;
}
async function ecPathAdd(fromId, toId) {
  const all = ecBuildResearch(), byId = new Map(all.map(n => [n.id, n]));
  const to = byId.get(toId), from = byId.get(fromId);
  if (!to || !from) { toast('Узел не найден', 'err'); return; }
  if ((to.prereq || []).includes(fromId)) { toast('Связь уже есть', 'inf'); return; }
  if (ecDependsOn(fromId, toId, byId)) { toast('Нельзя: образуется цикл связей', 'err'); return; }
  await ecPathSave(toId, [...(to.prereq || []), fromId]);
}
function ecPathDelete(toId, fromId) {
  const all = ecBuildResearch(), to = all.find(n => n.id === toId);
  if (!to) return;
  ecPathSave(toId, (to.prereq || []).filter(p => p !== fromId));
}
async function ecPathSave(nodeId, prereqArr) {
  if (EC.busy) return; EC.busy = true;
  const tools = document.querySelector('.ec-tree-tools'); if (tools) tools.style.opacity = '.5';
  try {
    await ecRpc('tech_prereq_set', { p_node: nodeId, p_prereq: prereqArr });
    EC.techPrereq[nodeId] = prereqArr.slice();
    EC._research = null;                       // пересобрать дерево с новыми связями
    toast('Связь обновлена ✓', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Связь не сохранена: ' + ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}
// Сброс связей узла к дефолту (из inspector).
async function ecPathResetNode(nodeId) {
  if (!ecIsStaff() || EC.busy) return;
  const all = ecBuildResearch(), n = all.find(x => x.id === nodeId); if (!n) return;
  EC.busy = true;
  try {
    await ecRpc('tech_prereq_reset', { p_node: nodeId, p_default: n._prereq0 || [] });
    delete EC.techPrereq[nodeId];
    EC._research = null;
    toast('Связи узла сброшены к дефолту', 'ok');
    await ecReloadPaint();
  } catch (e) { toast(ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}
// Сбросить ВСЮ ручную раскладку: удаляем все сохранённые записи (узлы вернутся
// на авто-радиальные места) и пере-вписываем камеру по центру нового дерева.
// Используем tech_layout_reset (DELETE строки) — set(p_x:null) НЕ чистит позицию
// (coalesce оставляет старое значение), поэтому нужен именно reset.
async function ecTreeResetAll() {
  if (!ecIsStaff() || EC.busy) return;
  const ids = Object.keys(EC.techLayout || {});
  if (!ids.length) { toast('Ручных позиций нет — дерево уже радиальное', 'inf'); return; }
  if (!confirm(`Сбросить ВСЮ ручную раскладку (${ids.length} узл.)? Все позиции, иконки и картинки удалятся, дерево станет радиальным.`)) return;
  EC.busy = true;
  const tools = document.querySelector('.ec-tree-tools'); if (tools) tools.style.opacity = '.5';
  try {
    for (const id of ids) await ecRpc('tech_layout_reset', { p_node: id }).catch(() => {});
    EC.techLayout = {};
    EC.treePanX = null; EC.treePanY = null;     // авто-вписать заново по центру
    toast('Раскладка сброшена — дерево радиальное', 'ok');
    await ecReloadPaint();
  } catch (e) { toast(ecErr(e.message), 'err'); }
  finally { EC.busy = false; }
}
const EC_TREE_ZMIN = 0.1, EC_TREE_ZMAX = 2;
function ecTreeApply() {
  const w = document.getElementById('ec-tree-world'); if (!w) return;
  w.style.transform = `translate(${EC.treePanX || 0}px,${EC.treePanY || 0}px) scale(${EC.treeZoom || 1})`;
  const lbl = document.querySelector('.ec-tree-tzoom'); if (lbl) lbl.textContent = Math.round((EC.treeZoom || 1) * 100) + '%';
}
// Зум кнопками — вокруг центра окна просмотра.
function ecTreeZoom(dir) {
  const vp = document.getElementById('ec-tree-vp');
  const oldZ = EC.treeZoom || 1;
  let z = dir === 0 ? 1 : Math.min(EC_TREE_ZMAX, Math.max(EC_TREE_ZMIN, +(oldZ + dir * 0.15).toFixed(2)));
  if (vp) {
    const r = vp.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
    EC.treePanX = cx - (cx - (EC.treePanX || 0)) * (z / oldZ);
    EC.treePanY = cy - (cy - (EC.treePanY || 0)) * (z / oldZ);
  }
  EC.treeZoom = z; ecTreeApply();
}
// Первый показ: центрируем ЯДРО при читаемом зуме (видно центр + рукава),
// а не отдаляем всё дерево. Холст большой — детали смотрят паном/зумом.
function ecTreeCenterCore() {
  const vp = document.getElementById('ec-tree-vp');
  if (!vp || !EC._treeCore) { return ecTreeFit(); }
  const r = vp.getBoundingClientRect();
  const z = Math.min(0.85, Math.max(0.5, +((Math.min(r.width, r.height)) / 1000).toFixed(2)));
  EC.treeZoom = z;
  EC.treePanX = r.width / 2 - EC._treeCore.x * z;
  EC.treePanY = r.height / 2 - EC._treeCore.y * z;
  ecTreeApply();
}
// Вместить всё дерево в окно и отцентрировать.
function ecTreeFit() {
  const vp = document.getElementById('ec-tree-vp'), world = document.getElementById('ec-tree-world');
  if (!vp || !world) return;
  const cw = (parseFloat(world.style.width) || world.offsetWidth) || 1;
  const ch = (parseFloat(world.style.height) || world.offsetHeight) || 1;
  const r = vp.getBoundingClientRect();
  const z = Math.max(EC_TREE_ZMIN, Math.min(1, +Math.min((r.width - 60) / cw, (r.height - 60) / ch).toFixed(3)));
  EC.treeZoom = z;
  EC.treePanX = (r.width - cw * z) / 2;
  EC.treePanY = (r.height - ch * z) / 2;
  ecTreeApply();
}
// Прыжок к секции категории — ВПИСЫВАЕМ всю секцию в окно (zoom+центр по её
// bbox), чтобы кадр всегда падал на узлы, а не в пустоту. Плавно + вспышка метки.
function ecTreeJump(cat) {
  EC.researchCat = cat;
  document.querySelectorAll('.ec-rcat').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
  const box = EC._treeCatBox && EC._treeCatBox[cat], vp = document.getElementById('ec-tree-vp'), world = document.getElementById('ec-tree-world');
  if (box && vp && world) {
    const r = vp.getBoundingClientRect();
    const bw = (box.x1 - box.x0) || 1, bh = (box.y1 - box.y0) || 1;
    const z = Math.max(EC_TREE_ZMIN, Math.min(1.1, +Math.min((r.width - 120) / bw, (r.height - 120) / bh).toFixed(3)));
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    EC.treeZoom = z;
    EC.treePanX = r.width / 2 - cx * z;
    EC.treePanY = r.height / 2 - cy * z;
    world.classList.add('ec-tree-anim');
    ecTreeApply();
    setTimeout(() => world.classList.remove('ec-tree-anim'), 420);
  }
  const arm = document.querySelector(`.ec-tarm[data-cat="${cat}"]`);
  if (arm) { document.querySelectorAll('.ec-tarm.flash').forEach(e => e.classList.remove('flash')); arm.classList.add('flash'); setTimeout(() => arm.classList.remove('flash'), 1300); }
}
// Полноэкранный режим холста дерева. Сохраняем в EC.treeFs (переживает
// перерисовку). Настоящий фуллскрин: ecTreePortal выносит сцену в <body> мимо
// трансформируемых предков (иначе position:fixed упирается в область контента).
function ecTreeFullscreen() {
  EC.treeFs = !EC.treeFs;
  document.body.classList.toggle('ec-tree-fs-lock', EC.treeFs);
  ecPaintCabinet();
  requestAnimationFrame(() => requestAnimationFrame(ecTreeCenterCore));
}
// Портал сцены в body при фуллскрине (и уборка при выходе). Вызывается из
// ecTreeBind после каждой перерисовки, чтобы новая сцена тоже попадала в body.
function ecTreePortal() {
  if (EC._treeFsEl && EC._treeFsEl.parentNode === document.body) EC._treeFsEl.remove();
  EC._treeFsEl = null;
  if (!EC.treeFs) return;
  const stage = document.querySelector('.ec-tree-stage.ec-tree-fs');
  if (!stage) return;
  if (stage.parentNode !== document.body) document.body.appendChild(stage);
  EC._treeFsEl = stage;
}
let _ecTreeDrag = null, _ecPan = null, _ecTreeSuppressClick = 0;
// Допуск «дрожания» руки при клике: пока курсор не сместился больше этого порога,
// нажатие считается КЛИКОМ по узлу, а не паном/драгом. 3px слишком жёстко — обычный
// клик мышью часто уводит курсор на 4–6px, и клик «съедался» (узлы «не жмутся»).
const EC_TREE_CLICK_SLOP = 6;
function ecTreePt(e) { const t = e.touches && e.touches[0]; return { x: t ? t.clientX : e.clientX, y: t ? t.clientY : e.clientY }; }
function ecTreeBind() {
  ecTreePortal();   // фуллскрин: вынести сцену в body мимо трансформ-предков
  const vp = document.getElementById('ec-tree-vp');
  if (vp && !vp._ecBound) {
    vp._ecBound = true;
    vp.addEventListener('mousedown', ecTreeDown);
    vp.addEventListener('touchstart', ecTreeDown, { passive: false });
    vp.addEventListener('wheel', ecTreeWheel, { passive: false });
  }
  if (!document._ecTreeMoves) {
    document._ecTreeMoves = true;
    document.addEventListener('mousemove', ecTreeMove);
    document.addEventListener('mouseup', ecTreeUp);
    document.addEventListener('touchmove', ecTreeMove, { passive: false });
    document.addEventListener('touchend', ecTreeUp);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (EC.treePathEdit && EC.pathFrom) { EC.pathFrom = null; ecPaintCabinet(); }
      else if (EC.treeFs) { ecTreeFullscreen(); }
    });
  }
  if (EC.treePanX == null) requestAnimationFrame(ecTreeCenterCore);   // первый показ — ядро по центру
}
function ecTreeDown(e) {
  if (e.type === 'mousedown' && e.button !== 0) {
    if (EC.treePathEdit && EC.pathFrom) { EC.pathFrom = null; ecPaintCabinet(); }   // правый клик — отмена выбора источника
    return;
  }
  if (e.target.closest && e.target.closest('button')) return;
  const node = e.target.closest && e.target.closest('.ec-tnode[data-nid]');
  if (EC.treeEdit && !EC.treePathEdit && node) {   // staff: перетаскиваем узел (вне режима связей)
    const id = node.dataset.nid, p = (EC._treePos && EC._treePos[id]) || { x: 0, y: 0 }, pt = ecTreePt(e);
    _ecTreeDrag = { id, card: node, sx: pt.x, sy: pt.y, ox: p.x, oy: p.y, z: EC.treeZoom || 1, moved: false };
    node.classList.add('ec-tnode-dragging');
    e.preventDefault(); e.stopPropagation(); return;
  }
  const pt = ecTreePt(e);                           // иначе — свободный пан холста
  _ecPan = { sx: pt.x, sy: pt.y, px: EC.treePanX || 0, py: EC.treePanY || 0, moved: false };
  if (e.cancelable) e.preventDefault();
}
function ecTreeMove(e) {
  if (_ecTreeDrag) {
    const d = _ecTreeDrag, pt = ecTreePt(e);
    const nx = Math.round(d.ox + (pt.x - d.sx) / d.z), ny = Math.round(d.oy + (pt.y - d.sy) / d.z);
    if (Math.abs(pt.x - d.sx) > EC_TREE_CLICK_SLOP || Math.abs(pt.y - d.sy) > EC_TREE_CLICK_SLOP) d.moved = true;
    d.card.style.left = nx + 'px'; d.card.style.top = ny + 'px';
    if (EC._treePos) EC._treePos[d.id] = { x: nx, y: ny };
    ecTreeRedrawEdges();
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (_ecPan) {
    const pt = ecTreePt(e);
    EC.treePanX = _ecPan.px + (pt.x - _ecPan.sx);
    EC.treePanY = _ecPan.py + (pt.y - _ecPan.sy);
    if (Math.abs(pt.x - _ecPan.sx) > EC_TREE_CLICK_SLOP || Math.abs(pt.y - _ecPan.sy) > EC_TREE_CLICK_SLOP) { _ecPan.moved = true; document.body.classList.add('ec-tree-grabbing'); }
    ecTreeApply();
    if (e.cancelable) e.preventDefault();
  }
}
function ecTreeUp() {
  if (_ecTreeDrag) {
    const d = _ecTreeDrag; _ecTreeDrag = null;
    d.card.classList.remove('ec-tnode-dragging');
    if (d.moved) {
      _ecTreeSuppressClick = Date.now();
      const p = (EC._treePos && EC._treePos[d.id]) || { x: d.ox, y: d.oy };
      EC.techLayout[d.id] = Object.assign({}, EC.techLayout[d.id], { x: p.x, y: p.y });
      ecRpc('tech_layout_set', { p_node: d.id, p_x: p.x, p_y: p.y })
        .catch(err => toast('Позиция не сохранена: ' + (err.message || ''), 'err'));
    }
  }
  if (_ecPan) {
    if (_ecPan.moved) _ecTreeSuppressClick = Date.now();   // после пана не открываем карточку узла
    _ecPan = null; document.body.classList.remove('ec-tree-grabbing');
  }
}
// Зум колесом — к точке под курсором (мир остаётся «прибит» к курсору).
function ecTreeWheel(e) {
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top, oldZ = EC.treeZoom || 1;
  const z = Math.min(EC_TREE_ZMAX, Math.max(EC_TREE_ZMIN, +(oldZ * (e.deltaY < 0 ? 1.12 : 1 / 1.12)).toFixed(3)));
  EC.treePanX = sx - (sx - (EC.treePanX || 0)) * (z / oldZ);
  EC.treePanY = sy - (sy - (EC.treePanY || 0)) * (z / oldZ);
  EC.treeZoom = z; ecTreeApply();
}
function ecTreeRedrawEdges() {
  const svg = document.querySelector('#ec-tree-world .ec-tree-svg');
  if (!svg || !EC._treeNodes || !EC._treePos) return;
  const pos = EC._treePos, done = EC._treeDone || new Set(), W = EC_TREE_W, H = EC_TREE_H, core = EC._treeCore;
  let html = '';
  if (core) EC._treeNodes.forEach(n => {
    if ((n.prereq || []).length || ecTreeNoCore(n.id)) return;
    const b = pos[n.id]; if (!b) return;
    html += `<path d="M${core.x},${core.y} L${b.x + W / 2},${b.y + H / 2}" class="ec-tedge core${done.has(n.id) ? ' lit' : ''}"/>`;
  });
  EC._treeNodes.forEach(n => (n.prereq || []).forEach(pid => {
    const a = pos[pid], b = pos[n.id]; if (!a || !b) return;
    const ax = a.x + W / 2, ay = a.y + H / 2, bx = b.x + W / 2, by = b.y + H / 2;
    html += `<path d="M${ax},${ay} L${bx},${by}" class="ec-tedge${done.has(pid) ? ' lit' : ''}"/>`;
  }));
  svg.innerHTML = html;
}
// Клик по узлу в режиме раскладки → выбрать + открыть инспектор (иконка/картинка).
function ecTreeSelect(id, ev) {
  if (ev) ev.stopPropagation();
  if (_ecTreeSuppressClick && Date.now() - _ecTreeSuppressClick < 350) return;   // это был конец drag
  EC.treeSel = id;
  document.querySelectorAll('.ec-tnode-sel').forEach(e => e.classList.remove('ec-tnode-sel'));
  const c = document.querySelector(`.ec-tnode[data-nid="${id}"]`); if (c) c.classList.add('ec-tnode-sel');
  ecTreeInspector(id);
}
function ecTreeInspector(id) {
  const n = ecBuildResearch().find(x => x.id === id); if (!n) return;
  const L = (EC.techLayout && EC.techLayout[id]) || {};
  let ov = document.getElementById('ec-tins-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'ec-tins-ov'; ov.className = 'ec-tins-ov'; ov.onclick = e => { if (e.target === ov) ecTreeInspectorClose(); }; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="ec-tins ec-br-${esc(n.branch)}">
    <button class="ec-rinfo-x" onclick="ecTreeInspectorClose()">✕</button>
    <div class="ec-tins-h">${esc(n.name)}</div>
    <div class="ec-tins-id">${esc(id)}</div>
    <label class="ec-tins-l">Emoji-значок <span class="ec-hint">(если нет картинки)</span></label>
    <input id="ec-tins-icon" class="ec-tins-i" maxlength="8" value="${esc(L.icon || '')}" placeholder="напр. 🚀 ⚛ 🛡">
    <label class="ec-tins-l">URL картинки <span class="ec-hint">(Storage)</span></label>
    <input id="ec-tins-img" class="ec-tins-i" value="${esc(L.img || '')}" placeholder="https://…">
    <div class="ec-tins-act">
      <button class="btn btn-gd btn-sm" onclick="ecTreeInspectorSave('${esc(id)}')">✓ Сохранить</button>
      <button class="btn btn-gh btn-sm" onclick="ecTreeNodeReset('${esc(id)}')" title="Сбросить позицию и иконку к авто-раскладке">↺ Сброс</button>
    </div>
    <label class="ec-tins-l">Связи (требует изучить) ${EC.techPrereq && EC.techPrereq[id] ? '<span class="ec-hint" style="color:var(--te)">— изменены</span>' : ''}</label>
    <div class="ec-tins-prereq">${(n.prereq || []).length ? (n.prereq).map(p => `<span class="ec-tins-pchip">${esc((ecBuildResearch().find(x => x.id === p) || {}).name || p)}</span>`).join('') : '<span class="ec-hint">нет требований (корень)</span>'}</div>
    ${EC.techPrereq && EC.techPrereq[id] ? `<button class="btn btn-gh btn-xs" onclick="ecPathResetNode('${esc(id)}')" title="Вернуть связи узла к дефолтным">↺ Сбросить связи к дефолту</button>` : ''}
    ${(n.prereq || []).length ? '' : `<label class="ec-tins-l">Связь с ядром «НАУКА»</label>
    <button class="btn ${ecTreeNoCore(id) ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="ecTreeToggleCore('${esc(id)}')" title="Корень — рисуется спица от центрального блока. Откреплённый корень висит сам по себе.">${ecTreeNoCore(id) ? '⛓️‍💥 Откреплён от ядра — прицепить' : '✂ Открепить от ядра'}</button>`}
    <div class="ec-tins-hint">Позицию двигаешь мышью на холсте. Здесь — значок/картинка. Сами пути правятся кнопкой «🔗 Связи» на холсте.</div>
  </div>`;
  ov.classList.add('show');
}
function ecTreeInspectorClose() { const ov = document.getElementById('ec-tins-ov'); if (ov) ov.classList.remove('show'); EC.treeSel = null; }
async function ecTreeInspectorSave(id) {
  const icon = (document.getElementById('ec-tins-icon') || {}).value || '';
  const img = (document.getElementById('ec-tins-img') || {}).value || '';
  try {
    await ecRpc('tech_layout_set', { p_node: id, p_x: null, p_y: null, p_icon: icon, p_img: img });
    EC.techLayout[id] = Object.assign({}, EC.techLayout[id], { icon: icon || null, img: img || null });
    toast('Сохранено ✓', 'ok'); ecTreeInspectorClose(); ecPaintCabinet();
  } catch (e) { toast('Ошибка сохранения: ' + (e.message || ''), 'err'); }
}
async function ecTreeNodeReset(id) {
  try {
    await ecRpc('tech_layout_reset', { p_node: id });
    delete EC.techLayout[id];
    toast('Сброшено к авто-раскладке', 'ok'); ecTreeInspectorClose(); ecPaintCabinet();
  } catch (e) { toast('Ошибка: ' + (e.message || ''), 'err'); }
}
// Открепить/прицепить корневой узел к ядру «НАУКА» (спица центр→узел).
async function ecTreeToggleCore(id) {
  if (!ecIsStaff() || EC.busy) return;
  const next = !ecTreeNoCore(id);
  EC.busy = true;
  try {
    await ecRpc('tech_layout_set', { p_node: id, p_nocore: next });
    EC.techLayout[id] = Object.assign({}, EC.techLayout[id], { nocore: next });
    toast(next ? 'Узел откреплён от ядра' : 'Узел прицеплен к ядру', 'ok');
    ecPaintCabinet();
    ecTreeInspector(id);   // перерисовать инспектор (обновить надпись кнопки)
  } catch (e) { toast('Ошибка: ' + (e.message || ''), 'err'); }
  finally { EC.busy = false; }
}
// Откреплён ли корневой узел от ядра «НАУКА» (staff-флаг в раскладке).
function ecTreeNoCore(id) { const L = EC.techLayout && EC.techLayout[id]; return !!(L && L.nocore); }
function ecBranchTag(branch) {
  return { class: 'КЛАСС', type: 'КОРПУС', weapon: 'ОРУЖИЕ', armor: 'БРОНЯ', shield: 'ЩИТЫ', engine: 'ДВИГАТЕЛЬ', reactor: 'РЕАКТОР', hangar: 'АНГАР', module: 'СИСТЕМА', econ: 'ЭКОНОМИКА', prod: 'ПРОИЗВОДСТВО', expand: 'ЭКСПАНСИЯ', celestial: 'НЕБОЖИТЕЛИ', mind: 'РАЗУМ', doom: 'НЕОТВРАТИМОСТЬ' }[branch] || branch;
}
// Чипы бонуса политического узла (для карточки дерева).
function ecBonusChips(b, special, station, slots) {
  const out = [];
  const pct = (k, lbl, goodHigh) => { if (!b || b[k] == null) return; const p = Math.round(b[k] * 100); const good = goodHigh ? p > 0 : p < 0; out.push(`<span class="ec-bchip ${good ? 'good' : 'bad'}">${lbl} ${p > 0 ? '+' : ''}${p}%</span>`); };
  pct('gc', 'Доход', true); pct('mine', 'Добыча', true);
  pct('build', 'Постройки', false); pct('colonize', 'Колонии', false); pct('claim_cost', 'Захват', false); pct('claim_cd', 'Кулдаун', false); pct('research', 'Наука', false);
  if (b && b.sci_flat) out.push(`<span class="ec-bchip good">Наука +${b.sci_flat}/ход</span>`);
  if (b && b.agents_flat) out.push(`<span class="ec-bchip good">Агенты +${b.agents_flat}/ход</span>`);
  if (special === 'claim2') out.push('<span class="ec-bchip special">★ +1 захват до перезарядки</span>');
  if (special === 'rslot') out.push(`<span class="ec-bchip special">🔬 +${slots || 1} слот${(slots || 1) > 1 ? 'а' : ''} исследований</span>`);
  if (special === 'station' && station) out.push(`<span class="ec-bchip special">${station.icon || '★'} ${station.cells} ячеек</span>`);
  if (special === 'artillery') out.push('<span class="ec-bchip special" style="background:rgba(220,40,40,.18);border-color:rgba(220,40,40,.5);color:#ff8a8a">🜨 Орудие судного дня</span>');
  return out.length ? `<div class="ec-tnode-bonus">${out.join('')}</div>` : '';
}
async function ecResearch(nodeId) {
  const n = ecBuildResearch().find(x => x.id === nodeId); if (!n) { toast('Узел не найден', 'err'); return; }
  const done = new Set(EC.eco.research || []);
  const maxSlots = ecResearchSlots();
  const activeIds = ecActiveResearch().map(s => s.n);
  if (activeIds.includes(nodeId)) { toast('Уже изучается', 'inf'); return; }
  if (done.has(nodeId)) { toast('Уже изучено', 'inf'); return; }
  if (activeIds.length >= maxSlots) { ecQueueResearch(nodeId); return; }   // слоты заняты → в очередь
  if (!(n.prereq || []).every(p => done.has(p))) { toast('Сначала изучите предшественников', 'err'); return; }
  const rc = ecResearchCost(n.cost);
  if ((EC.eco.science || 0) < rc) { ecQueueResearch(nodeId); return; }      // не хватает ОН → в очередь
  if (EC.busy) return; EC.busy = true;
  try {
    // Сервер сам добирает очередь в свободные слоты (perform _research_step в economy_research).
    await ecRpc('economy_research', { p_node: nodeId, p_cost: rc });
    toast('Исследование начато (1 ход)', 'ok');
    await ecReloadPaint();
  } catch (e) { toast(ecErr(e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}
// Добавить технологию в очередь — автозапуск в свободный слот на тике.
async function ecQueueResearch(nodeId) {
  const n = ecBuildResearch().find(x => x.id === nodeId); if (!n) { toast('Узел не найден', 'err'); return; }
  const done = new Set(EC.eco.research || []);
  if (done.has(nodeId)) { toast('Уже изучено', 'inf'); return; }
  if (ecActiveResearch().some(s => s.n === nodeId)) { toast('Уже изучается', 'inf'); return; }
  if (ecResearchQueueArr().includes(nodeId)) { toast('Уже в очереди', 'inf'); return; }
  const active = new Set(ecActiveResearch().map(s => s.n)), queued = new Set(ecResearchQueueArr());
  if (!(n.prereq || []).every(p => done.has(p) || active.has(p) || queued.has(p))) {
    toast('Сначала поставьте в очередь предшественников', 'err'); return;
  }
  if (EC.busy) return; EC.busy = true;
  try {
    // Сервер сам добирает очередь в свободные слоты (perform _research_step в economy_research_queue).
    await ecRpc('economy_research_queue', { p_node: nodeId });
    toast('Добавлено в очередь технологий', 'ok');
    await ecReloadPaint();
  } catch (e) { toast(ecErr(e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}
function ecDequeueResearch(idx) {
  ecRpcAct('economy_research_dequeue', { p_idx: idx | 0 }, 'Убрано из очереди');
}
// Немедленно заполнить свободные слоты из очереди (без ожидания тика).
// Дёргается при открытии вкладки и после любых изменений очереди.
// Дебаунс: не чаще раза в 5 с, чтобы не создавать гонку при быстром рекликинге.
let _ecDrainTimer = 0;
async function ecResearchDrain() {
  if (EC.busy) return;
  const now = Date.now();
  if (now - _ecDrainTimer < 5000) return;
  _ecDrainTimer = now;
  const slots = ecActiveResearch().length;
  const maxSlots = ecResearchSlots();
  const queue = ecResearchQueueArr();
  if (slots >= maxSlots || !queue.length) return;   // нечего добирать
  try {
    await ecRpc('research_drain_queue', {});
    await ecReloadPaint();
  } catch (e) { /* тихо: дрейн — фоновый помощник, не блокирующее действие */ }
}

// Карточка-описание узла дерева (по клику) — полный текст не влезает в плитку.
function ecResNodeInfo(id) {
  if (_ecTreeSuppressClick && Date.now() - _ecTreeSuppressClick < 300) return;   // это был конец пана/драга, не клик
  const all = ecBuildResearch();
  const n = all.find(x => x.id === id); if (!n) return;
  const byId = new Map(all.map(x => [x.id, x]));
  const done = new Set(EC.eco.research || []);
  const activeIds = ecActiveResearch().map(s => s.n);
  const queue = ecResearchQueueArr();
  const qIdx = queue.indexOf(n.id);
  const isDone = done.has(n.id), isActive = activeIds.includes(n.id), isQueued = qIdx >= 0;
  const prereqOk = (n.prereq || []).every(p => done.has(p));
  const chainOk = (n.prereq || []).every(p => done.has(p) || activeIds.includes(p) || queue.includes(p));
  const maxSlots = ecResearchSlots();
  const slotsFull = activeIds.length >= maxSlots;
  const rc = ecResearchCost(n.cost), sci = EC.eco.science || 0;
  const can = !isDone && !isActive && !isQueued && prereqOk && !slotsFull && sci >= rc;       // старт сейчас
  const canQueue = !isDone && !isActive && !isQueued && chainOk;                              // в очередь

  const status = isDone ? '<span class="ec-tnode-badge ok">✓ изучено</span>'
    : isActive ? '<span class="ec-tnode-badge cur">⏳ изучается</span>'
    : isQueued ? `<span class="ec-tnode-badge q">🕓 в очереди №${qIdx + 1}</span>`
    : !chainOk ? '<span class="ec-tnode-badge lock">🔒 заблокировано</span>' : '';
  const prereqTxt = (n.prereq || []).length
    ? (n.prereq).map(p => `${done.has(p) ? '✓' : '🔒'} ${esc((byId.get(p) || {}).name || p)}`).join(' · ')
    : '<span style="color:var(--t4)">нет требований</span>';
  let stationHtml = '';
  if (n.special === 'station' && n.station) {
    const groups = n.station.groups.map(g => EC_GRP_LABEL[g] || g).join(', ');
    stationHtml = `<div class="ec-rinfo-station">${n.station.icon} <b>Станция</b> — открывает постройку на мирах: <b>${esc(groups)}</b> · размер <b>${n.station.cells} ячеек</b> · постройка <b>${ecNum(ecColonizeCost(EC_STATION_COST))} ГС</b></div>`;
  }
  if (n.special === 'artillery') {
    stationHtml = `<div class="ec-rinfo-station" style="background:rgba(220,40,40,.1);border-color:rgba(220,40,40,.4)">🜨 <b>Орудие судного дня</b> — открывает постройку «Длань Неотвратимости»: межзвёздная артиллерия, стирающая планеты целых систем. Содержание — Программируемая материя, залп — 20 Гравиядра.</div>`;
  }
  const bonus = (n.bonus || n.special) ? ecBonusChips(n.bonus, n.special, n.station, n.slots) : '';
  let actHint = '';
  if (isDone) actHint = '';
  else if (isActive) actHint = '<span class="ec-rinfo-note">Уже изучается — завершится в конце хода.</span>';
  else if (isQueued) actHint = '<span class="ec-rinfo-note">В очереди — запустится автоматически, когда освободится слот и хватит ОН.</span>';
  else if (!chainOk) actHint = '<span class="ec-rinfo-note">Сначала изучите (или поставьте в очередь) предшественников.</span>';
  else if (slotsFull) actHint = '<span class="ec-rinfo-note">Все слоты заняты — можно добавить в очередь.</span>';
  else if (sci < rc) actHint = `<span class="ec-rinfo-note">Не хватает ОН: нужно ${ecNum(rc)}, есть ${ecNum(sci)}. Можно добавить в очередь.</span>`;
  // Кнопки: старт сейчас (если можно) и/или в очередь; для очереди — убрать.
  let actBtn = '';
  if (isQueued) {
    actBtn = `<button class="btn btn-gh" onclick="ecResNodeInfoClose();ecDequeueResearch(${qIdx})">✕ Убрать из очереди</button>`;
  } else if (!isDone && !isActive) {
    if (can) actBtn += `<button class="btn btn-gd" onclick="ecResNodeInfoClose();ecResearch('${esc(n.id)}')">🔬 Исследовать · ${ecNum(rc)} ОН</button>`;
    if (canQueue) actBtn += `<button class="btn btn-gh" onclick="ecResNodeInfoClose();ecQueueResearch('${esc(n.id)}')">🕓 В очередь</button>`;
  }

  let ov = document.getElementById('ec-rinfo-ov');
  // Пересоздаём, если оверлея нет ИЛИ его выпилил из DOM блокировщик рекламы
  // (uBlock/AdGuard scriptlet `:remove()`): иначе ссылка «висит» в воздухе и
  // карточка узла «не открывается» только у людей с адблоком.
  if (!ov || !document.body.contains(ov)) { ov = document.createElement('div'); ov.id = 'ec-rinfo-ov'; ov.className = 'ec-rinfo-ov'; ov.onclick = e => { if (e.target === ov) ecResNodeInfoClose(); }; document.body.appendChild(ov); }
  const L = (EC.techLayout && EC.techLayout[n.id]) || {};
  const gicon = L.icon || EC_BRANCH_ICON[n.branch] || EC_CAT_ICON[n.cat] || '✦';
  const gemHtml = L.img
    ? `<span class="ec-tgem ec-rinfo-gem"><img class="ec-tgem-img" src="${esc(L.img)}" alt=""><span class="ec-tgem-ring"></span></span>`
    : `<span class="ec-tgem ec-tgem-ph ec-rinfo-gem"><span class="ec-tgem-ic">${esc(gicon)}</span><span class="ec-tgem-ring"></span></span>`;
  ov.innerHTML = `<div class="ec-rinfo ec-br-${esc(n.branch)}">
    <button class="ec-rinfo-x" onclick="ecResNodeInfoClose()">✕</button>
    <div class="ec-rinfo-head">${gemHtml}<div>
    <div class="ec-rinfo-tag">${esc(ecBranchTag(n.branch))}${n.catLabel ? ' · ' + esc(n.catLabel) : ''}</div>
    <div class="ec-rinfo-name">${esc(n.name)} ${status}</div></div></div>
    ${n.desc ? `<div class="ec-rinfo-desc">${esc(n.desc)}</div>` : ''}
    ${stationHtml}
    ${bonus}
    <div class="ec-rinfo-meta"><span>Стоимость: <b style="color:var(--pu)">${ecNum(rc)} ОН</b></span><span>Требует: ${prereqTxt}</span></div>
    ${actHint}
    ${actBtn ? `<div class="ec-rinfo-act">${actBtn}</div>` : ''}
  </div>`;
  ov.classList.add('show');
  // Форсим показ инлайн-стилем с !important — перебивает внедрённый блокировщиком
  // `display:none !important` (косметический фильтр на полноэкранный оверлей).
  // Обычный класс `.show` такой фильтр перебить не может — у адблок-юзеров
  // карточка «не открывалась».
  ov.style.setProperty('display', 'flex', 'important');
}
function ecResNodeInfoClose() {
  const ov = document.getElementById('ec-rinfo-ov');
  if (!ov) return;
  ov.classList.remove('show');
  ov.style.setProperty('display', 'none', 'important');
}

// ── Рынок: покупка/продажа прямо из строки ресурса ──────────────────────────
// Кнопки в каждой строке (ec-mk-card) → берут кол-во из своего поля #ec-mk-q-<i>.
function ecRowTrade(name, act, i) {
  const units = Math.max(0, parseInt((ecId('ec-mk-q-' + i) || {}).value) || 0);
  const m = (EC.market || {})[name];
  if (!units) { toast('Укажите количество', 'err'); return; }
  if (act === 'buy') {
    if (m && units > m.stock) { toast(`На рынке только ${ecNum(Math.round(m.stock))} ед.`, 'err'); return; }
    ecRpcAct('market_buy_resource', { p_name: name, p_units: units }, `Куплено: ${esc(name)} ×${ecNum(units)}`);
  } else {
    ecRpcAct('market_sell_resource', { p_name: name, p_units: units }, `Продано: ${esc(name)} ×${ecNum(units)}`);
  }
}
// Быстрый ввод количества: +100/+1к прибавляют к полю, «склад» ставит весь остаток.
function ecRowQAdd(name, i, d) {
  const el = ecId('ec-mk-q-' + i); if (!el) return;
  el.value = Math.max(0, (parseInt(el.value) || 0) + d);
  ecRowPrev(name, i);
}
function ecRowQSet(name, i, v) {
  const el = ecId('ec-mk-q-' + i); if (!el) return;
  el.value = Math.max(0, Math.round(v)) || '';
  ecRowPrev(name, i);
}
// Живой предпросмотр строки: почём пройдёт сделка и как сдвинет цену (зеркало сервера)
function ecRowPrev(name, i) {
  const box = ecId('ec-mk-pv-' + i); if (!box) return;
  const m = (EC.market || {})[name];
  const units = Math.max(0, parseInt((ecId('ec-mk-q-' + i) || {}).value) || 0);
  if (!m || !units) { box.innerHTML = ''; return; }
  const base = m.base || m.price || 1, eq = m.eq, st = m.stock;
  const sellGain = Math.floor(ecMkArea(base, st, st + units, eq) * 0.8);
  const sellPx = ecMkPrice(base, st + units, eq);
  const canBuy = units <= st;
  const buyCost = Math.ceil(ecMkArea(base, Math.max(0, st - units), st, eq));
  const buyPx = ecMkPrice(base, Math.max(0, st - units), eq);
  const pct = (a, b) => { const d = Math.round((b / a - 1) * 100); return `${d >= 0 ? '+' : ''}${d}%`; };
  box.innerHTML =
    `<span class="ec-mk-pvi" title="купить ${ecNum(units)} — спишется ГС, цена вырастет">📈 −${ecNum(buyCost)} ГС <i>(≈${ecNum(Math.round(buyCost / units))}/ед, цена ${pct(m.price, buyPx)})</i></span>` +
    (canBuy ? '' : ` <i style="color:#e0688a">только ${ecNum(Math.round(st))} на рынке</i>`) +
    `<span class="ec-mk-pvi" title="продать ${ecNum(units)} — начислится ГС, цена упадёт">📉 +${ecNum(sellGain)} ГС <i>(≈${ecNum(Math.round(sellGain / units))}/ед, цена ${pct(m.price, sellPx)})</i></span>`;
}
// ── Действия дипломатии/разведки ────────────────────────────
function ecSellResource() {
  const name = (ecId('ec-mk-res') || ecId('ec-sell-res'))?.value;
  const units = Math.max(0, parseInt((ecId('ec-mk-units') || ecId('ec-sell-units'))?.value) || 0);
  if (!name) { toast('Выберите ресурс', 'err'); return; }
  if (!units) { toast('Укажите количество', 'err'); return; }
  ecRpcAct('market_sell_resource', { p_name: name, p_units: units }, 'Продано на рынке');
}
function ecBuyResource() {
  const name = ecId('ec-mk-res')?.value, units = Math.max(0, parseInt(ecId('ec-mk-units')?.value) || 0);
  if (!name) { toast('Выберите ресурс', 'err'); return; }
  if (!units) { toast('Укажите количество', 'err'); return; }
  ecRpcAct('market_buy_resource', { p_name: name, p_units: units }, 'Куплено на рынке');
}
// ── Биржа: индекс/ETF ────────────────────────────────────────
function ecIndexBuy() {
  const gc = Math.max(0, parseInt(ecId('ec-ix-gc')?.value) || 0);
  if (!gc) { toast('Укажите сумму ГС', 'err'); return; }
  ecRpcAct('index_buy', { p_gc: gc }, 'Паи индекса куплены');
}
function ecIndexSell() {
  const units = Math.max(0, parseFloat(ecId('ec-ix-units')?.value) || 0);
  if (!units) { toast('Укажите количество паёв', 'err'); return; }
  ecRpcAct('index_sell', { p_units: units }, 'Паи индекса проданы');
}
function ecIndexSellAll() {
  const units = ((EC.exchange && EC.exchange.holdings && +EC.exchange.holdings.units) || 0);
  if (units <= 0) { toast('Нет позиции', 'err'); return; }
  ecRpcAct('index_sell', { p_units: units }, 'Позиция закрыта');
}
// ── Биржа: облигации ─────────────────────────────────────────
function ecBondIssue() {
  const face = Math.max(0, parseInt(ecId('ec-bd-face')?.value) || 0);
  const units = Math.max(0, parseInt(ecId('ec-bd-units')?.value) || 0);
  const couponPct = Math.max(0, parseFloat(ecId('ec-bd-coupon')?.value) || 0);
  const term = Math.max(0, parseInt(ecId('ec-bd-term')?.value) || 0);
  if (!face) { toast('Укажите номинал', 'err'); return; }
  if (!units) { toast('Укажите кол-во бумаг', 'err'); return; }
  if (!couponPct) { toast('Укажите купон', 'err'); return; }
  if (!term) { toast('Укажите срок', 'err'); return; }
  ecRpcAct('bond_issue', { p_face: face, p_units: units, p_coupon_bps: Math.round(couponPct * 100), p_term_days: term }, 'Выпуск размещён');
}
function ecBondBuy(id) {
  const units = Math.max(0, parseInt(ecId('ec-bd-buy-' + id)?.value) || 0);
  if (!units) { toast('Укажите количество', 'err'); return; }
  ecRpcAct('bond_buy', { p_issue_id: id, p_units: units }, 'Облигации куплены');
}
function ecBondCancel(id) { ecRpcAct('bond_cancel', { p_issue_id: id }, 'Выпуск снят'); }
// ── Биржа: маржа (лонги/шорты с плечом) ──────────────────────
function ecMarginOpen(side) {
  const res = ecId('ec-mg-res')?.value || '';
  const coll = Math.max(0, parseInt(ecId('ec-mg-coll')?.value) || 0);
  const lev = Math.max(0, parseInt(ecId('ec-mg-lev')?.value) || 0);
  if (!res) { toast('Выберите ресурс', 'err'); return; }
  if (coll < 100) { toast('Залог минимум 100 ГС', 'err'); return; }
  if (lev < 1) { toast('Укажите плечо', 'err'); return; }
  ecRpcAct('margin_open', { p_resource: res, p_side: side, p_collateral: coll, p_leverage: lev }, side === 'long' ? 'Лонг открыт' : 'Шорт открыт');
}
function ecMarginClose(id) { ecRpcAct('margin_close', { p_id: id }, 'Позиция закрыта'); }
// ── Биржа: фьючерсы ──────────────────────────────────────────
function ecFuturesOpen(side) {
  const res = ecId('ec-ft-res')?.value || '';
  const coll = Math.max(0, parseInt(ecId('ec-ft-coll')?.value) || 0);
  const lev = Math.max(0, parseInt(ecId('ec-ft-lev')?.value) || 0);
  const term = Math.max(0, parseInt(ecId('ec-ft-term')?.value) || 0);
  if (!res) { toast('Выберите ресурс', 'err'); return; }
  if (coll < 100) { toast('Залог минимум 100 ГС', 'err'); return; }
  if (lev < 1) { toast('Укажите плечо', 'err'); return; }
  if (term < 1) { toast('Укажите срок', 'err'); return; }
  ecRpcAct('futures_open', { p_resource: res, p_side: side, p_collateral: coll, p_leverage: lev, p_term_days: term }, side === 'long' ? 'Фьючерс-лонг открыт' : 'Фьючерс-шорт открыт');
}
function ecFuturesClose(id) { ecRpcAct('futures_close', { p_id: id }, 'Контракт закрыт'); }
// ── Биржа: опционы (колл/пут) ────────────────────────────────
function ecOptionsPreview() {
  const box = ecId('ec-op-prev'); if (!box) return;
  const opt = ecId('ec-op-res')?.selectedOptions?.[0];
  const spot = opt ? (+opt.getAttribute('data-px') || 0) : 0;
  const kind = ecId('ec-op-kind')?.value || 'call';
  const strike = Math.max(0, parseFloat(ecId('ec-op-strike')?.value) || 0);
  const ct = Math.max(0, parseInt(ecId('ec-op-ct')?.value) || 0);
  const term = Math.max(0, parseInt(ecId('ec-op-term')?.value) || 0);
  if (!spot || !strike || !ct || !term) { box.innerHTML = 'Колл выигрывает при росте выше страйка, пут — при падении ниже. Премия — это максимум, что можно потерять; в срок опцион сам исполняется по биржевому курсу.'; return; }
  const vol = (EC.options && +EC.options.vol) || 0.45;
  const intrinsic = Math.max(0, kind === 'call' ? spot - strike : strike - spot);
  const prem = Math.max(1, intrinsic + spot * vol * Math.sqrt(term / 365) * 0.5);
  box.innerHTML = `Премия ≈ <b>${ecNum(Math.round(prem))} ГС</b>/контракт · итого ≈ <b>${ecNum(Math.round(prem * ct))} ГС</b> (курс ${ecNum(spot)}).`;
}
function ecOptionsBuy() {
  const res = ecId('ec-op-res')?.value || '';
  const kind = ecId('ec-op-kind')?.value || 'call';
  const strike = Math.max(0, parseFloat(ecId('ec-op-strike')?.value) || 0);
  const ct = Math.max(0, parseInt(ecId('ec-op-ct')?.value) || 0);
  const term = Math.max(0, parseInt(ecId('ec-op-term')?.value) || 0);
  if (!res) { toast('Выберите ресурс', 'err'); return; }
  if (!strike) { toast('Укажите страйк', 'err'); return; }
  if (!ct) { toast('Укажите контракты', 'err'); return; }
  if (!term) { toast('Укажите срок', 'err'); return; }
  ecRpcAct('options_buy', { p_resource: res, p_kind: kind, p_strike: strike, p_contracts: ct, p_term_days: term }, 'Опцион куплен');
}
function ecOptionsClose(id) { ecRpcAct('options_close', { p_id: id }, 'Опцион продан'); }
// ── Биржа: корпорации ────────────────────────────────────────
function ecCorpCreate() {
  const name = (ecId('ec-co-name')?.value || '').trim();
  if (name.length < 2) { toast('Укажите название', 'err'); return; }
  const desc = (ecId('ec-co-desc')?.value || '').trim() || null;
  const image = (ecId('ec-co-img')?.value || '').trim() || null;
  const ids = Array.from(document.querySelectorAll('.ec-co-newb:checked')).map(el => el.value);
  ecRpcAct('corp_create', { p_name: name, p_buildings: ids, p_description: desc, p_image_url: image }, 'Организация учреждена — отправлена на модерацию');
}
function ecCorpDissolve(id) { ecRpcAct('corp_dissolve', { p_corp: id }, 'Организация распущена'); }
// ── Редактирование организации владельцем (через модерацию) ──
function ecCorpEditToggle(id, on) { EC.corpEditing = EC.corpEditing || {}; if (on) EC.corpEditing[id] = true; else delete EC.corpEditing[id]; ecPaintCabinet(); }
function ecCorpEdit(id) {
  const name = (ecId('ec-ce-name-' + id)?.value || '').trim();
  if (name.length < 2) { toast('Укажите название', 'err'); return; }
  const desc = (ecId('ec-ce-desc-' + id)?.value || '').trim() || null;
  const image = (ecId('ec-ce-img-' + id)?.value || '').trim() || null;
  if (EC.corpEditing) delete EC.corpEditing[id];
  ecRpcAct('corp_edit', { p_corp: id, p_name: name, p_description: desc, p_image_url: image }, 'Изменения отправлены на модерацию');
}
// ── Смена состава предприятий организации за 10 000 ГС (применяется сразу) ──
function ecCorpRecompose(id) {
  const box = ecId('ec-co-rec-' + id);
  if (!box) return;
  const ids = Array.from(box.querySelectorAll('input[type=checkbox]:checked')).map(el => el.value);
  if (!confirm(`Изменить состав предприятий организации за ${ecNum(10000)} ГС?\nВыбрано построек: ${ids.length}. Котировка пересчитается по новому доходу.`)) return;
  ecRpcAct('corp_recompose', { p_corp: id, p_buildings: ids }, 'Состав изменён · списано 10 000 ГС');
}
// ── Эмблема организации: загрузка в Storage через общий хелпер ──
function ecCorpImg(input, hiddenId, prevId) {
  const file = input.files && input.files[0]; if (!file) return;
  if (typeof handleImgUpload !== 'function') { toast('Загрузка недоступна', 'err'); return; }
  handleImgUpload(file, url => {
    const h = ecId(hiddenId); if (h) h.value = url;
    const p = ecId(prevId); if (p) p.innerHTML = `<img src="${esc(url)}" alt="">`;
  });
}
function ecCorpImgClear(hiddenId, prevId) {
  const h = ecId(hiddenId); if (h) h.value = '';
  const p = ecId(prevId); if (p) p.innerHTML = '<span>нет эмблемы</span>';
}
function ecCorpListShares(corp) {
  const shares = Math.max(0, parseInt(ecId('ec-co-ls-sh-' + corp)?.value) || 0);
  const price = Math.max(0, parseInt(ecId('ec-co-ls-pr-' + corp)?.value) || 0);
  if (!shares) { toast('Укажите кол-во долей', 'err'); return; }
  if (!price) { toast('Укажите цену', 'err'); return; }
  // нельзя выставить больше, чем держишь (сервер тоже режет эскроу)
  const co = ((EC.corps && EC.corps.mine) || []).find(x => x.id === corp);
  const hd = ((EC.corps && EC.corps.holdings) || []).find(x => x.corp_id === corp);
  const have = co ? co.my_shares : (hd ? hd.shares : null);
  if (have != null && shares > have) { toast(`У вас только ${ecNum(have)} долей`, 'err'); return; }
  ecRpcAct('corp_list_shares', { p_corp: corp, p_shares: shares, p_price: price }, 'Доли выставлены');
}
function ecCorpCancelListing(id) { ecRpcAct('corp_cancel_listing', { p_listing: id }, 'Снято с продажи'); }
function ecCorpBuyShares(listing) {
  const shares = Math.max(0, parseInt(ecId('ec-co-buy-' + listing)?.value) || 0);
  if (!shares) { toast('Укажите количество', 'err'); return; }
  ecRpcAct('corp_buy_shares', { p_listing: listing, p_shares: shares }, 'Акции куплены');
}
// Быстрая покупка по лучшему аску прямо из доски котировок (терминал).
function ecCorpBuyAsk(listing, price, maxShares) {
  const ans = prompt(`Купить долей по ${price} ГС (доступно ${maxShares}):`, String(maxShares || 1));
  if (ans === null) return;
  const shares = Math.max(0, parseInt(ans) || 0);
  if (!shares) { toast('Укажите количество', 'err'); return; }
  ecRpcAct('corp_buy_shares', { p_listing: listing, p_shares: shares }, 'Акции куплены');
}
// ── Биржа: заказы (госзаказы / RFQ) ──────────────────────────
// Живой итог формы размещения: эскроу = объём×цена + подсказка рыночной цены.
function ecOrderCalc() {
  const res = (ecId('ec-ord-res')?.value || '').trim();
  const qty = Math.max(0, parseInt(ecId('ec-ord-qty')?.value) || 0);
  const price = Math.max(0, parseInt(ecId('ec-ord-price')?.value) || 0);
  const gc = (EC.eco && EC.eco.gc) || 0;
  const box = ecId('ec-ord-summary'); if (!box) return;
  if (!res || !qty || !price) { box.innerHTML = `Укажите ресурс, объём и цену. В казне: <b>${ecNum(Math.round(gc))} ГС</b>.`; return; }
  const escrow = qty * price;
  const mk = res && EC.market && EC.market[res] ? Math.round(EC.market[res].price) : 0;
  const mkTip = mk ? ` · рыночная цена «${esc(res)}» ≈ <b>${ecNum(mk)} ГС</b>/ед` : '';
  const lack = escrow > gc ? ` <span style="color:var(--err)">— не хватает ${ecNum(escrow - Math.round(gc))} ГС</span>` : '';
  box.innerHTML = `Заблокируем в эскроу: <b style="color:${escrow > gc ? 'var(--err)' : 'var(--gd)'}">${ecNum(escrow)} ГС</b>${lack}${mkTip}. В казне: <b>${ecNum(Math.round(gc))} ГС</b>.`;
}
// Заказывать можно только РЕАЛЬНЫЙ складской ресурс. ГС/ОН — валюты, их на складе
// не бывает (исполнитель отдаёт ресурс из `resources`, а науки там нет), поэтому
// такой заказ невыполним и засоряет доску. Сверяем со справочником рынка.
function ecIsTradeableRes(name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  return Object.keys(EC.market || {}).some(k => k.toLowerCase() === n);
}
function ecOrderCreate() {
  const res = (ecId('ec-ord-res')?.value || '').trim();
  const qty = Math.max(0, parseInt(ecId('ec-ord-qty')?.value) || 0);
  const price = Math.max(0, parseInt(ecId('ec-ord-price')?.value) || 0);
  const days = Math.max(1, Math.min(60, parseInt(ecId('ec-ord-days')?.value) || 7));
  const note = (ecId('ec-ord-note')?.value || '').trim() || null;
  if (!res) { toast('Укажите ресурс', 'err'); return; }
  if (!ecIsTradeableRes(res)) { toast('«' + res + '» — не складской ресурс. Заказывать можно только добываемые ресурсы (ГС и ОН на складе не бывает).', 'err'); return; }
  if (!qty) { toast('Укажите объём', 'err'); return; }
  if (!price) { toast('Укажите цену', 'err'); return; }
  ecRpcAct('order_create', { p_resource: res, p_qty: qty, p_price: price, p_note: note, p_days: days },
    `Заказ размещён · в эскроу ${ecNum(qty * price)} ГС`);
}
function ecOrderFulfill(id) {
  const qty = Math.max(0, parseInt(ecId('ec-ordf-' + id)?.value) || 0);
  if (!qty) { toast('Укажите объём поставки', 'err'); return; }
  ecRpcAct('order_fulfill', { p_order: id, p_qty: qty }, 'Заказ выполнен — оплата зачислена');
}
function ecOrderCancel(id) {
  if (!confirm('Отменить заказ? Остаток эскроу вернётся в казну.')) return;
  ecRpcAct('order_cancel', { p_order: id }, 'Заказ отменён · эскроу возвращён');
}

function ecTransfer() {
  const fac = ecId('ec-tr-fac')?.value, res = ecId('ec-tr-res')?.value, amt = parseInt(ecId('ec-tr-amt')?.value) || 0;
  if (!fac) { toast('Выберите фракцию', 'err'); return; }
  if (amt <= 0) { toast('Укажите сумму', 'err'); return; }
  ecRpcAct('economy_transfer', { p_to_fid: fac, p_res: res, p_amount: amt }, 'Передано');
}

// ── Обмен (бартер) ──────────────────────────────────────────
// Список своих кораблей роста: [{name, qty}] по моделям (только готовые).
function ecMyShipList() {
  const m = {};
  (EC.roster || []).filter(r => r.category === 'ship').forEach(r => { m[r.unit_name] = (m[r.unit_name] || 0) + (r.qty || 0); });
  return Object.entries(m).filter(([, q]) => q > 0).map(([name, qty]) => ({ name, qty }));
}
// Человекочитаемая сводка набора активов.
function ecBarterSummary(a) {
  if (!a) return '—';
  const p = [];
  if (+a.gc) p.push(`${ecNum(a.gc)} ГС`);
  if (+a.science) p.push(`${ecNum(a.science)} ОН`);
  if (a.resources) for (const [k, v] of Object.entries(a.resources)) { if (+v) p.push(`${ecNum(v)} ${k}`); }
  if (a.ships) for (const [k, v] of Object.entries(a.ships)) { if (+v) p.push(`${ecNum(v)}× ${k}`); }
  return p.length ? p.join(', ') : '—';
}
// Собрать jsonb-набор активов из состояния EC.bt[side].
function ecBarterAssets(side) {
  const a = {};
  ((EC.bt && EC.bt[side]) || []).forEach(it => {
    if (it.kind === 'gc') a.gc = (a.gc || 0) + it.qty;
    else if (it.kind === 'science') a.science = (a.science || 0) + it.qty;
    else if (it.kind === 'resource') { a.resources = a.resources || {}; a.resources[it.name] = (a.resources[it.name] || 0) + it.qty; }
    else if (it.kind === 'ship') { a.ships = a.ships || {}; a.ships[it.name] = (a.ships[it.name] || 0) + it.qty; }
  });
  return a;
}
function ecBarterHasAny(a) { return !!(a.gc || a.science || a.resources || a.ships); }
function ecBarterPropose() {
  const fac = ecId('ec-bt-fac')?.value;
  if (!fac) { toast('Выберите фракцию', 'err'); return; }
  const give = ecBarterAssets('give'), want = ecBarterAssets('want');
  if (!ecBarterHasAny(give)) { toast('Добавьте, что отдаёте', 'err'); return; }
  const isGift = !ecBarterHasAny(want);
  EC.bt = { give: [], want: [] };   // очистим конструктор после отправки
  ecRpcAct('barter_propose', { p_to_fid: fac, p_give: give, p_want: want }, isGift ? 'Передано (подарок)' : 'Предложение обмена отправлено');
}
function ecBarterAccept(id) { ecRpcAct('barter_accept', { p_id: id }, 'Обмен совершён'); }
function ecBarterReject(id) { ecRpcAct('barter_reject', { p_id: id }, 'Предложение отклонено'); }
function ecBarterCancel(id) { ecRpcAct('barter_cancel', { p_id: id }, 'Предложение отозвано'); }
function ecTradePropose() {
  const c = ecTradeCalc();
  if (!c) { toast('Форма недоступна', 'err'); return; }
  if (c.err) { toast(c.err, 'err'); return; }
  // Отсутствие гиперпути НЕ блокирует: караван идёт напрямую, просто без данных об угрозах.
  const riskTxt = c.threats.length ? `риск ${c.riskPct}%` : 'путь безопасен';
  // состав грузовых кораблей пути (только грузовые из собранного флота) — закрепляется за путём
  const ships = {};
  Object.keys(EC.cvFleet || {}).forEach(id => { if ((EC.cvFleet[id] || 0) > 0 && ecCvShipCargo(id) > 0) ships[id] = EC.cvFleet[id]; });
  ecRpcAct('trade_propose_multi',
    { p_to_fid: c.dFac, p_origin_sys: c.oSys, p_dest_sys: c.dSys, p_cargo: c.cargo, p_convoy: c.convoy, p_threats: c.threats, p_ships: ships },
    `Караван предложен партнёру (${riskTxt})`);
}
function ecTradeRespond(id, acc) { ecRpcAct('trade_respond', { p_id: id, p_accept: !!acc }, acc ? 'Путь принят' : 'Отклонено'); }
function ecTradeClose(id) { ecRpcAct('trade_close', { p_id: id }, 'Путь закрыт'); }
function ecLoanIssue() {
  const fac = ecId('ec-loan-fac')?.value, amt = parseInt(ecId('ec-loan-amt')?.value) || 0, note = ecId('ec-loan-note')?.value || '';
  if (!fac) { toast('Выберите фракцию', 'err'); return; }
  if (amt <= 0) { toast('Укажите сумму', 'err'); return; }
  ecRpcAct('loan_issue', { p_to_fid: fac, p_amount: amt, p_note: note }, 'Заём выдан');
}
function ecLoanRepay(id) { ecRpcAct('loan_repay', { p_id: id }, 'Заём погашен'); }
function ecLoanDispute(id) { ecRpcAct('loan_dispute', { p_id: id }, 'Спор подан в МГА'); }
// ── Тайные операции: интерактив планировщика ────────────────
function ecPickSpyTarget(fid) {
  EC.spyTarget = fid;
  // смена цели меняет доступность операций (по досье) — перерисуем планировщик целиком
  const el = ecId('ec-spy-planner');
  if (el) { el.innerHTML = ecSpyPlannerHtml(); ecSpyCalcLive(); }
  else ecSpyCalcLive();
}
function ecPickSpyOp(op) {
  const c = ecSpyCalc(op, [], EC.spyTarget);
  if (c && c.err) {
    const recon = EC_SPY_OPS[c.err.includes('глубок') ? 'recon_deep' : 'recon_basic'].label;
    toast(`🔒 ${c.err}. Сначала запустите операцию «${recon}» по этой цели.`, 'err');
    return;
  }
  EC.spyOp = op;
  // тактические операции против флота — подгрузить видимые флоты цели для селектора
  if ((EC_SPY_OPS[op] || {}).targetFleet) ecLoadFleetsVisible();
  const ops = ecId('ec-spy-ops');
  if (ops) ops.innerHTML = ecSpyOpsHtml();   // перерисовать карточки операций (галочки/выделение)
  else document.querySelectorAll('.ec-spy-op').forEach(b => b.classList.toggle('on', b.getAttribute('onclick').includes(`'${op}'`)));
  ecSpyCalcLive();
}
// Карточки выбора агентов под операцию (только свободные обученные)
function ecSpyAgentPickHtml() {
  const ready = ecSpyReadyAgents();
  EC.spyPick = (EC.spyPick || []).filter(id => ready.some(a => a.id === id));   // выкинуть ставших недоступными
  if (!ready.length) return '<div class="ec-empty" style="padding:8px">Нет свободных оперативников — наймите новых, дождитесь обучения или снимите часть с контрразведки.</div>';
  return ready.map(a => {
    const pk = ecPerk(a.perk); const on = EC.spyPick.includes(a.id);
    const lv = Math.max(1, a.level || 1); const col = ecPerkColor(a.perk);
    const p2 = a.perk2 ? `<span class="ec-pick-p2" style="color:${ecPerkColor(a.perk2)}" title="${esc(ecPerk(a.perk2).desc)}">${ecPerk(a.perk2).icon}</span>` : '';
    const arts = (a.arts || []).map(k => ecArt(k).icon).join('');
    return `<button type="button" class="ec-pick-card${on ? ' on' : ''}" style="--ag-col:${col}" onclick="ecSpyTogglePick('${esc(a.id)}')" title="${esc(pk.desc)}">
      <span class="ec-pick-check">${on ? '✓' : '+'}</span>
      <span class="ec-pick-ic" style="color:${col}">${pk.icon}</span>
      <span class="ec-pick-body">
        <span class="ec-pick-name">${esc(a.first_name)} ${esc(a.last_name)} ${ecLevelPips(lv)}</span>
        <span class="ec-pick-perk" style="color:${col}">${esc(pk.label)}${p2}${arts ? ` <span class="ec-pick-arts" title="артефакты">${arts}</span>` : ''}</span>
      </span></button>`;
  }).join('');
}
function ecSpyTogglePick(id) {
  EC.spyPick = EC.spyPick || [];
  const i = EC.spyPick.indexOf(id);
  if (i >= 0) EC.spyPick.splice(i, 1);
  else {
    const cap = Math.max(0, ecSpyReadyAgents().length - (EC.eco.counter_agents || 0));   // ready − контрразведка
    if (EC.spyPick.length >= cap) { toast('Все свободные агенты выбраны (часть зарезервирована в контрразведке)', 'inf'); return; }
    EC.spyPick.push(id);
  }
  const el = ecId('ec-spy-agents-pick'); if (el) el.innerHTML = ecSpyAgentPickHtml();
  ecSpyCalcLive();
}
// Живая сводка операции + состояние кнопки
function ecSpyCalcLive() {
  const sumEl = ecId('ec-spy-summary'); if (!sumEl) return null;
  const op = EC.spyOp, picks = EC.spyPick || [];
  const c = ecSpyCalc(op, picks, EC.spyTarget); if (!c) return null;
  const d = EC_SPY_OPS[op];
  const noAgents = picks.length < 1;
  // колония-цель для саботажа (из глубокой разведки)
  const colEl = ecId('ec-spy-colony');
  let colErr = '';
  if (colEl) {
    if (op === 'sabotage') {
      const cols = ecSpyColonyOptions(EC.spyTarget);
      if (!cols.length) { colEl.innerHTML = '<div class="ec-trade-note warn" style="margin:6px 0">⚠ Нужна свежая глубокая разведка цели, чтобы выбрать колонию для саботажа.</div>'; colErr = 'Нет данных о колониях — проведите глубокую разведку'; }
      else {
        if (!EC.spyColony || !cols.find(x => x.id === EC.spyColony)) EC.spyColony = cols[0].id;
        colEl.innerHTML = `<div class="ec-trade-label">Колония-цель</div>
          <select id="ec-spy-colony-sel" onchange="EC.spyColony=this.value;ecSpyCalcLive()">${cols.map(x => `<option value="${esc(x.id)}"${x.id === EC.spyColony ? ' selected' : ''}>${esc(x.name)}${Array.isArray(x.buildings) ? ` · ${x.buildings.length} построек` : ''}</option>`).join('')}</select>`;
      }
    } else if (op === 'fleet_sabotage') {
      // флот-цель: видимые вражеские флоты выбранной державы (fleets_visible)
      const fls = (EC.fleetsVisible || []).filter(f => f.faction_id === EC.spyTarget);
      if (!fls.length) { colEl.innerHTML = '<div class="ec-trade-note warn" style="margin:6px 0">⚠ У этой державы нет флотов на карте (или они вне зоны видимости).</div>'; colErr = 'Нет видимых флотов цели'; EC.spyFleetTarget = null; }
      else {
        if (!EC.spyFleetTarget || !fls.find(x => x.id === EC.spyFleetTarget)) EC.spyFleetTarget = fls[0].id;
        colEl.innerHTML = `<div class="ec-trade-label">Флот-цель</div>
          <select id="ec-spy-fleet-sel" onchange="EC.spyFleetTarget=this.value;ecSpyCalcLive()">${fls.map(x => {
            const sz = x.intel ? `${x.ships} кор.` : 'состав неизвестен';
            const loc = x.status === 'transit' ? 'в полёте' : 'в системе';
            return `<option value="${esc(x.id)}"${x.id === EC.spyFleetTarget ? ' selected' : ''}>${esc(x.name || 'Флот')} · ${sz} · ${loc}</option>`;
          }).join('')}</select>`;
      }
    } else { colEl.innerHTML = ''; EC.spyFleetTarget = null; }
  }
  // госуровневая операция требует сети (≥2 агента)
  let netErr = (op === 'steal_tech' && picks.length === 1) ? 'Госуровень: нужна сеть — минимум 2 агента' : '';
  const dosTxt = c.dossier.level ? `${c.dossier.level === 'deep' ? 'глубокая' : 'базовая'} (${c.dossier.ageDays} дн., +${c.intel})` : 'нет данных';
  const sColor = c.success >= 60 ? 'var(--ok)' : c.success >= 35 ? 'var(--color-warning,#e0a030)' : 'var(--err)';
  const dColor = c.detect >= 50 ? 'var(--err)' : c.detect > 20 ? 'var(--color-warning,#e0a030)' : 'var(--ok)';
  const gateErr = c.err || (noAgents ? 'Выберите агентов для операции' : '') || colErr || netErr;
  // состав группы (кто идёт) — мини-чипы с именами
  const team = ecSpyRoster().filter(a => picks.includes(a.id));
  const teamHtml = team.length
    ? team.map(a => `<span class="ec-sum-agent" style="color:${ecPerkColor(a.perk)}">${ecPerk(a.perk).icon} ${esc(a.first_name)} ${esc(a.last_name)} <b>★${Math.max(1, a.level || 1)}</b></span>`).join('')
    : '<span class="ec-hint">группа не назначена</span>';
  const gauge = (pct, color) => `<div class="ec-sum-gauge"><div class="ec-sum-gauge-fill" style="width:${noAgents ? 0 : pct}%;background:${color}"></div></div>`;
  sumEl.innerHTML = `
    <div class="ec-sum-head">
      <span class="ec-sum-op">${d.icon} <b>${esc(d.label)}</b></span>
      <span class="ec-sum-arrow">→</span>
      ${ecFacFlag(EC.spyTarget, 26)}<b class="ec-sum-tgt">${esc(ecFacName(EC.spyTarget))}</b>
    </div>
    <div class="ec-sum-team">${teamHtml}</div>
    <div class="ec-sum-desc">${esc(d.desc)}</div>
    <div class="ec-sum-metric"><span class="ec-sum-k">Шанс успеха</span>${gauge(c.success, sColor)}<b style="color:${sColor}">${noAgents ? '—' : c.success + '%'}</b></div>
    <div class="ec-sum-metric"><span class="ec-sum-k">Риск раскрытия</span>${gauge(c.detect, dColor)}<b style="color:${dColor}">${noAgents ? '—' : c.detect + '%'}</b></div>
    <div class="ec-sum-rows">
      <span><i>Длительность</i> <b>${noAgents ? '—' : c.turns + ' ход.'}</b></span>
      <span><i>Разведданные</i> <b>${dosTxt}</b></span>
      ${(c.succB || c.detB) ? `<span><i>Бонусы группы</i> <b style="color:var(--ok)">${c.succB ? `+${c.succB}% усп.` : ''}${c.succB && c.detB ? ' · ' : ''}${c.detB ? `−${c.detB}% раскр.` : ''}</b></span>` : ''}
      ${(c.raceMod && c.tRace) ? `<span><i>Вживание в расу</i> <b style="color:${c.raceMod > 0 ? 'var(--err)' : 'var(--ok)'}" title="Агенты должны сойти за «${esc(c.tRace)}». Чужеродные расы — огромный штраф к успеху.">${c.raceMod > 0 ? `−${c.raceMod}% усп. (чужая раса)` : `+${-c.raceMod}% усп. (своя раса)`}</b></span>` : ''}
    </div>
    ${gateErr ? `<div class="ec-trade-note warn">⚠ ${esc(gateErr)}</div>` : `<div class="ec-trade-note">При раскрытии назначенный агент будет схвачен (выбывает), а цель узнает, кто за этим стоит. Расчёт ориентировочный — контрразведка цели уточнится при исполнении.</div>`}`;
  const btn = ecId('ec-spy-launch');
  if (btn) { btn.disabled = !!gateErr; btn.textContent = gateErr ? gateErr : `Запустить · успех ${c.success}% · ${c.turns} ход.`; }
  c.gateErr = gateErr;
  return c;
}
function ecSpyLaunch() {
  const picks = EC.spyPick || [];
  if (!picks.length) { toast('Выберите хотя бы одного агента', 'err'); return; }
  const c = ecSpyCalcLive(); if (!c) return;
  if (c.gateErr) { toast(c.gateErr, 'err'); return; }
  const d = EC_SPY_OPS[EC.spyOp] || {};
  // Тактические операции (флот) — отдельный RPC spy_fleet_op, но запускаются ПО ТАЙМЕРУ
  // (как обычные): агенты уходят на c.turns ходов, результат и слух — при завершении.
  if (d.tactical) {
    if (d.targetFleet && !EC.spyFleetTarget) { toast('Выберите вражеский флот-цель', 'err'); return; }
    ecRpcAct('spy_fleet_op',
      { p_target_fid: EC.spyTarget, p_op: EC.spyOp, p_agent_ids: picks, p_fleet_id: d.targetFleet ? EC.spyFleetTarget : null },
      `Операция «${d.label}» запущена (${c.turns} ход.)`);
    return;
  }
  const colonyId = (EC.spyOp === 'sabotage') ? (EC.spyColony || null) : null;
  ecRpcAct('spy_launch', { p_target_fid: EC.spyTarget, p_op: EC.spyOp, p_agent_ids: picks, p_colony_id: colonyId }, `Операция «${EC_SPY_OPS[EC.spyOp].label}» запущена (${c.turns} ход.)`);
}
function ecSpyCancel(id) { ecRpcAct('spy_cancel', { p_id: id }, 'Операция отозвана, агенты возвращены'); }
function ecCounterIntel(scope, n) {
  ecRpcAct('counterintel_set', { p_scope: scope, p_n: Math.max(0, n | 0) }, 'Контрразведка обновлена');
}

// ── МГА: арбитраж спорных займов (вкладка в админ-панели) ───
async function ecRenderMgaTab(b) {
  b.innerHTML = '<div class="sload" style="min-height:60px"><div class="quote-loader">Загрузка...</div></div>';
  let loans = [];
  try { loans = await dbGet('loans', 'status=eq.disputed&order=created_at.asc') || []; }
  catch (e) { b.innerHTML = `<p style="color:var(--err)">Ошибка: ${esc(e.message)}</p>`; return; }
  if (!loans.length) { b.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--t3)">Нет спорных займов</div>`; return; }
  b.innerHTML = `<div style="margin-bottom:10px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--te)">${loans.length} спор(ов) в МГА</div>` +
    loans.map(l => `<div class="fr-app" id="mga-${l.id}">
      <div class="fr-app-hd"><span class="fr-app-badge new">СПОР</span><b>${esc(l.borrower_name || l.borrower_fid)}</b> должен <b>${esc(l.lender_name || l.lender_fid)}</b> — ${ecNum(l.amount)} ГС</div>
      ${l.note ? `<div class="fr-app-meta">${esc(l.note)}</div>` : ''}
      <div class="fr-app-acts">
        <button class="btn btn-gd btn-sm" onclick="ecMgaVerdict('${l.id}','repay')">⚖ Взыскать</button>
        <button class="btn btn-gh btn-sm" onclick="ecMgaVerdict('${l.id}','forgive')">Простить</button>
        <button class="btn btn-rd btn-sm" onclick="ecMgaVerdict('${l.id}','default')">Дефолт</button>
      </div></div>`).join('');
}
async function ecMgaVerdict(id, action) {
  try { await ecRpc('loan_verdict', { p_id: id, p_action: action }); toast('Вердикт МГА вынесен', 'ok'); document.getElementById('mga-' + id)?.remove(); }
  catch (e) { toast(ecErr(e.message), 'err'); }
}

// ── Почему у постройки столько слотов (зеркало _budget_auto_slots) ──
// Профиль ползунка: военные → Оборонзаказ, наука/разведка → Образование, остальное → Промышленность.
function ecBudgetCatOf(btype) {
  if (['shipyard', 'military_factory', 'training', 'starbase'].includes(btype)) return 'military';
  if (['science', 'intel'].includes(btype)) return 'science';
  return 'industry';
}
function ecSlotWhy(b) {
  const cat = ecBudgetCatOf(b.btype);
  const lvl = ecBudgetLvl(cat);
  const target = EC_BUDGET_SLOTS[lvl];
  const pop = ecBudgetPop();
  // Сколько рабочих мест хочет ВСЯ держава при текущих ползунках — от этого срез.
  const totalTarget = (EC.buildings || []).reduce((a, x) =>
    a + EC_BUDGET_SLOTS[ecBudgetLvl(ecBudgetCatOf(x.btype))], 0);
  const need = totalTarget * EC_POP_PER_SLOT;
  const cut = totalTarget > 0 && pop < need;                  // рук не хватает — слоты срезаны
  const workers = Math.max(1, +b.slots_open || 1) * EC_POP_PER_SLOT;
  const budName = EC_BUDGET[cat].name;
  const tip = `Слоты открывает бюджет, вручную не покупаются. Ползунок «${budName}» = «${EC_BUDGET_LVL[lvl]}» → цель ${target} слот. на такую постройку. Каждый слот — ${EC_POP_PER_SLOT} рабочих. Всего державе нужно ${ecNum(need)} жителей на ${totalTarget} мест, есть ${ecNum(pop)}${cut ? ' — рук не хватает, слоты ВСЕХ построек срезаны пропорционально' : ' — хватает'}.`;
  const fix = cut ? 'рук не хватает → растите население (соцобеспечение, товары)'
    : (lvl < 4 ? `Больше слотов — поднять «${budName}».` : 'Бюджет на максимуме.');
  return `<span class="ec-bld-slotwhy${cut ? ' cut' : ''}" data-tip="${esc(tip + ' ' + fix)}" onclick="ecSetTab('welfare')">👷${ecNum(workers)}${cut ? '⚠' : ''}</span>`;
}

function ecBuildingRow(b) {
  if (b.btype === 'doomgun') return ecDoomgunRow(b);
  const d = EC_BUILD[b.btype]; if (!d) return '';
  const inc = ecBuildingIncome(b);
  const incTxt = inc.gc ? `+${ecNum(inc.gc)} ГС / сутки` : inc.science ? `+${ecNum(inc.science)} ОН / сутки` : d.desc;
  const dots = Array.from({ length: EC_MAX_SLOTS }, (_, i) => `<span class="ec-slot ${i < b.slots_open ? 'on' : ''}"></span>`).join('');
  // Слоты открывает бюджет (профильный ползунок × население), вручную не покупаются.
  const openBtn = `<span class="ec-slot-auto" data-tip="Слоты выставляет финансирование отрасли во вкладке «Благополучие» (и хватает ли населения на рабочие места)" onclick="ecSetTab('welfare')">🏛 авто</span>`;
  const slotCount = `<span class="ec-slot-count">${b.slots_open}/${EC_MAX_SLOTS}</span>`;
  let mineHtml = '';
  if (ecIsMiner(b)) {
    // БЮДЖЕТ v3 + ЯРУСЫ: добыча автоматическая — постройка копает залежи
    // СВОЕГО яруса, темп ×(слоты/3). Маршруты — вкладка «Потоки».
    const yields = ecMineYields(b);
    if (yields.length) {
      const rows = yields.map(y => `<div class="ec-mine-row active ec-rar-${y.r}">
          <span class="ec-mine-ic ec-rar-${y.r}">${esc(y.icon)}</span>
          <span class="ec-mine-nm">${esc(y.name)}</span>
          <span class="ec-mine-rt">+${y.rate}/сут</span>
        </div>`).join('');
      const mul = (Math.max(1, +b.slots_open || 1) / 3);
      mineHtml = `<div class="ec-bld-mine-hd">⛏ Добывается автоматически <span class="ec-mine-slots-used" data-tip="Слоты — рабочие руки: темп добычи ×(слоты/3). Слоты выставляет промышленный бюджет и население.">${b.slots_open} слот. · темп ×${mul.toFixed(2)}</span></div><div class="ec-mine-list">${rows}</div>`;
    } else {
      mineHtml = `<div class="ec-bld-mine-empty">◌ на планете нет залежей ${b.btype === 'mining' ? 'обычных' : b.btype === 'mining_deep' ? 'необычных/редких' : 'эпических/легендарных'} ресурсов — постройке нечего добывать</div>`;
    }
    mineHtml += `<div class="ec-bld-mine-hd" style="margin-top:8px;color:var(--t3)">Куда идёт добыча (склад/экспорт/биржа) — во вкладке <a href="#" onclick="ecSetTab('flows');return false" style="color:var(--gd)">🔀 Потоки</a></div>`;
  }
  // мультивера: у храма пишем, чьей он религии
  let faithBadge = '';
  if (b.btype === 'temple') {
    const fa = b.faith_id ? (EC.faithById && EC.faithById[b.faith_id]) : null;
    faithBadge = fa
      ? `<span class="ec-bld-faith" style="color:${esc(fa.color || '#c9a227')}" title="Храм религии «${esc(fa.name)}»">🛐 «${esc(fa.name)}»</span>`
      : `<span class="ec-bld-faith ec-bld-faith-none" title="Религия храма не указана">🛐 без религии</span>`;
  }
  return `<div class="ec-bld">
    <div class="ec-bld-top">
      <span class="ec-bld-name">${esc(d.name)}${faithBadge}</span>
      <button class="ec-bld-del" title="Снести" onclick="ecDemolish('${b.id}')">✕</button>
    </div>
    <div class="ec-slots" title="${b.slots_open} / ${EC_MAX_SLOTS} слотов открыто">${dots}</div>
    <div class="ec-bld-inc">${esc(incTxt)}</div>
    ${ecBuildingIncomeBreak(b)}
    ${(() => {
      let ht = EC_BLD_HOWTO[b.btype];
      if (ecIsRobot()) {
        if (b.btype === 'training') ht = '⚙ Роботам не нужен: пехота собирается на Военном Заводе. Можно снести.';
        else if (b.btype === 'military_factory') ht = 'Робо-сборка: пехота (×3, 3000/слот) и наземная техника. Заказ — во вкладке «Строительство вооружённых сил».';
      }
      return ht ? `<div class="ec-bld-howto">${esc(ht)}</div>` : '';
    })()}
    ${mineHtml}
    ${b.btype === 'goodsfab' ? ecGoodsHtml(b) : ''}
    ${b.btype === 'abm' ? ecAbmAmmoHtml(b) : ''}
    <div class="ec-bld-act">${slotCount}${ecSlotWhy(b)}${openBtn}</div>
  </div>`;
}

// Боезапас ПРО на строке здания: счётчик + докупка (доставка 1 день). Зеркало _defense_planetary.sql.
function ecAbmAmmoHtml(b) {
  const ammo = +(b.ammo || 0), pend = +(b.ammo_pending || 0);
  const pendTxt = pend > 0 ? ` <span class="ec-hint">+${ecNum(pend)} в пути${b.ammo_ready ? ' (' + ecEtaShort(b.ammo_ready) + ')' : ''}</span>` : '';
  return `<div class="ec-bld-mine-hd" style="display:flex;align-items:center;gap:8px;margin-top:8px">
      🚀 Снаряды ПРО: <b>${ecNum(ammo)}</b>${pendTxt}
    </div>
    <div class="ec-prod-form" style="margin-top:6px">
      <input type="number" id="ec-abm-qty-${b.id}" value="5" min="1" class="ec-prod-qty">
      <button class="btn btn-gh btn-sm" onclick="ecAbmBuyAmmo('${b.colony_id}', '${b.id}')">Докупить · ${ecNum(EC_ABM_AMMO_COST)} ГС/шт</button>
    </div>`;
}
// Короткая оценка времени до готовности (если нет ecProgressISO под рукой).
function ecEtaShort(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'скоро';
  const h = Math.ceil(ms / 3600000);
  return h >= 24 ? Math.ceil(h / 24) + ' дн.' : h + ' ч.';
}
async function ecAbmBuyAmmo(colonyId, bldId) {
  if (EC.busy) return;
  const qty = Math.max(1, parseInt(ecId('ec-abm-qty-' + bldId)?.value) || 1);
  const cost = EC_ABM_AMMO_COST * qty;
  if ((EC.eco.gc || 0) < cost) { toast(`Нужно ${ecNum(cost)} ГС`, 'err'); return; }
  EC.busy = true;
  try {
    await ecRpc('abm_buy_ammo', { p_colony_id: colonyId, p_qty: qty });
    toast(`Заказано снарядов: ${ecNum(qty)} · −${ecNum(cost)} ГС · прибудут через 1 день`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// экранирование строки для inline-onclick (одинарные кавычки)
function ecArg(s) { return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
// pid планеты как числовой литерал для inline-onclick (или null для немигрированных данных карты)
function ecPidArg(p) { return (p && Number.isInteger(p.pid)) ? String(p.pid) : 'null'; }

// ── Денежные операции теперь СЕРВЕРНЫЕ ──────────────────────
// Списание/возврат ГС и ОН делают SECURITY DEFINER RPC (economy_build,
// economy_colonize, economy_terraform, economy_produce, ... в _security_money.sql),
// которые сами считают цену. Прямой записи баланса с клиента больше нет —
// ecSpend/ecSpendBoth удалены как небезопасные (игрок мог писать любое число).

// ── Проекты колоний (отложенные на 1+ ход) ──────────────────
// Момент готовности = сейчас + turns суток (1 реальный день от момента постройки).
const _ecReadyTurns = (turns) => new Date(Date.now() + Math.max(1, turns || 1) * 86400000).toISOString();
function ecPendingSlot(buildingId) { return (EC.projects || []).find(p => p.kind === 'slot' && p.building_id === buildingId); }
function ecPendingHabitat(colonyId) { return (EC.projects || []).find(p => p.kind === 'habitat' && p.colony_id === colonyId); }
function ecPendingBuild(colonyId, btype) { return (EC.projects || []).find(p => p.kind === 'build' && p.colony_id === colonyId && p.btype === btype); }
function ecPendingTerraform(sysId, planetName, pid) {
  return (EC.projects || []).find(p => {
    if (p.kind !== 'terraform' || p.system_id !== sysId) return false;
    // pid точнее имени (две одноимённые планеты); имя — фолбэк для старых проектов без pid
    if (pid != null && p.planet_pid != null) return p.planet_pid === pid;
    return p.planet_name === planetName;
  });
}
// Сколько ходов осталось до завершения проекта
function ecProjTurnsLeft(p) {
  if (!p || !p.ready_at) return 0;
  const ms = new Date(p.ready_at).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 86400000));
}
function ecProjEtaTxt(p) {
  if (!p || !p.ready_at) return 'неизвестно';
  const ms = new Date(p.ready_at).getTime() - Date.now();
  if (ms <= 0) return 'готово — ждёт тика';
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `через ~${h} ч`;
  return `через ~${Math.ceil(ms / 86400000)} д`;
}

// ── Прогресс-бар таймера: шкала заполнения + остаток времени ──
// Компактный остаток времени (мин / ч / д).
function ecFmtLeft(ms) {
  if (ms <= 0) return 'готово';
  if (ms < 3600000)  return `${Math.max(1, Math.round(ms / 60000))} мин`;
  if (ms < 86400000) { const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return m ? `${h} ч ${m} мин` : `${h} ч`; }
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000); return h ? `${d} д ${h} ч` : `${d} д`;
}
// Прогресс-бар [startMs..endMs] + подпись остатка. readyText — подпись по завершении.
function ecProgress(startMs, endMs, readyText) {
  const now = Date.now();
  const total = Math.max(1, endMs - startMs);
  const left = endMs - now;
  const ready = left <= 0;
  const pct = ready ? 100 : Math.min(100, Math.max(0, Math.round((now - startMs) / total * 100)));
  const txt = ready ? (readyText || 'готово') : ecFmtLeft(left);
  return `<span class="ec-prog${ready ? ' is-ready' : ''}">`
    + `<span class="ec-prog-track"><span class="ec-prog-fill" style="width:${pct}%"></span></span>`
    + `<span class="ec-prog-txt">${esc(txt)}</span></span>`;
}
// Враппер для ISO-строк. start может отсутствовать → берём end − fallbackDays.
function ecProgressISO(startISO, endISO, fallbackDays, readyText) {
  if (!endISO) return `<span class="ec-prog-txt">${esc(readyText || '—')}</span>`;
  const end = new Date(endISO).getTime();
  const start = startISO ? new Date(startISO).getTime() : end - Math.max(1, fallbackDays || 1) * 86400000;
  return ecProgress(start, end, readyText);
}
// Сколько вернуть при отмене проекта. Сначала — точные затраты из payload (как при
// создании). Фолбэк для старых проектов без payload: восстанавливаем цену из правил,
// чтобы возврат не пропадал (раньше такие проекты возвращали 0 — частая жалоба).
function ecProjectRefund(p) {
  let gc = (p.payload && +p.payload.spent_gc) || 0;
  let sci = (p.payload && +p.payload.spent_science) || 0;
  if (gc || sci) return { gc, science: sci };
  try {
    if (p.kind === 'slot') {
      const b = EC.buildings.find(x => x.id === p.building_id);
      const d = b && EC_BUILD[b.btype];
      if (d && d.ladder) gc = ecBuildCost(d.ladder[Math.max(0, b.slots_open)] || 0);
    } else if (p.kind === 'build') {
      const d = EC_BUILD[p.btype];
      if (d) gc = ecBuildCost(d.cost || 0);
    } else if (p.kind === 'habitat') {
      gc = ecColonizeCost(EC_HABITAT_COST);
    }
  } catch (e) {}
  return { gc, science: sci };
}
// Отмена проекта с возвратом ГС/ОН
async function ecCancelProject(id) {
  const p = (EC.projects || []).find(x => x.id === id); if (!p) return;
  const raw = ecProjectRefund(p);
  const isBldKind = p.kind === 'build' || p.kind === 'slot';
  const rg = isBldKind ? Math.floor(raw.gc / 2) : raw.gc;
  const rs = isBldKind ? Math.floor(raw.science / 2) : raw.science;
  const refundTxt = (rg || rs)
    ? `Вернётся: ${rg ? ecNum(rg) + ' ГС' : ''}${rg && rs ? ' + ' : ''}${rs ? ecNum(rs) + ' ОН' : ''}${isBldKind ? ' (½ затрат)' : ''}.`
    : 'Затрат к возврату нет.';
  if (!confirm(`Отменить проект «${p.label || p.kind}»? ${refundTxt}`)) return;
  try {
    await ecRpc('economy_cancel_project', { p_project_id: id });
    toast(isBldKind && rg ? `Проект отменён · возврат ${ecNum(rg)} ГС` : 'Проект отменён', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}

// Колонизация РОДНОЙ планеты — мгновенно (просто заселение пригодного мира).
// Поиск планеты в системе по стабильному pid (фолбэк — по имени для немигрированных данных).
function ecFindPlanet(sys, planetName, pid) {
  const planets = (sys && sys.planets) || [];
  if (pid != null) { const byPid = planets.find(x => x.pid === pid); if (byPid) return byPid; }
  return planets.find(x => x.name === planetName);
}

async function ecColonize(sysId, planetName, planetType, cells, foreign, pid) {
  if (foreign) return ecTerraform(sysId, planetName, planetType, cells, pid); // непригодная → отложенный терраформ
  if (EC.busy) return; EC.busy = true;
  try {
    if (pid == null) { toast('У планеты нет pid — обновите карту', 'err'); return; }
    await ecRpc('economy_colonize', { p_system_id: sysId, p_planet_pid: pid });
    toast('Планета колонизирована', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Небожители: построить станцию на непригодном мире — малая колония (3–5 ячеек), сразу.
// Требует изученной технологии-станции для группы этого мира. Ресурсы пояса/гиганта
// копируются в колонию — на станции можно добывать (астероидная добыча и т.п.).
async function ecBuildStation(sysId, planetName, planetType, group, pid) {
  if (EC.busy) return;
  const st = ecStationFor(group);
  if (!st) { toast('Нужна технология Небожителей для этого типа мира', 'err'); return; }
  EC.busy = true;
  try {
    if (pid == null) { toast('У планеты нет pid — обновите карту', 'err'); return; }
    await ecRpc('economy_build_station', { p_system_id: sysId, p_planet_pid: pid });
    toast(`${st.icon} ${st.label} построена · ${st.cells} ячеек`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Терраформирование НЕПРИГОДНОЙ планеты — отложенный проект (1..4 хода + ОН по сложности).
async function ecTerraform(sysId, planetName, planetType, cells, pid) {
  if (EC.busy) return;
  if (ecPendingTerraform(sysId, planetName, pid)) { toast('Терраформирование уже идёт', 'inf'); return; }
  const sys = EC.systems.find(s => s.id === sysId);
  const p = ecFindPlanet(sys, planetName, pid);
  const tier = ecTerraTier(p, EC.app.race), spec = EC_TERRA[tier];
  const terraGc = ecColonizeCost(spec.gc);
  if (!confirm(`Терраформирование «${planetName}» (${spec.label.toLowerCase()}):\n• срок: ${spec.turns} ход(ов)\n• затраты: ${ecNum(terraGc)} ГС${spec.science ? ` + ${ecNum(spec.science)} ОН` : ''}\nНачать?`)) return;
  EC.busy = true;
  try {
    if (pid == null) { toast('У планеты нет pid — обновите карту', 'err'); return; }
    await ecRpc('economy_terraform', { p_system_id: sysId, p_planet_pid: pid });
    toast(`Терраформирование начато (${spec.turns} ход.)`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── Производство юнитов ─────────────────────────────────────
const _ecReady = () => new Date((EC.eco.last_tick ? new Date(EC.eco.last_tick).getTime() : Date.now()) + 86400000).toISOString();

// Комплектование дивизии — нужны здания под её состав
async function ecProduceDivision(divId) {
  if (EC.busy) return;
  const div = EC.designs.find(d => d.id === divId && d.category === 'division'); if (!div) { toast('Дивизия не найдена', 'err'); return; }
  const qty = Math.max(1, parseInt(ecId('ec-div-qty-' + divId)?.value) || 1);
  const missing = ecDivReqBuildings(div).filter(bt => !ecHasBuilding(bt));
  if (missing.length) { toast('Нужны здания: ' + missing.map(m => EC_BLD_LABEL[m]).join(', '), 'err'); return; }
  // Лимит мощности за ход: пехота → Центр Подготовки, техника → Военный Завод, корабли → Верфь.
  const caps = ecCaps(), use = ecPendingUse(), mp = ecDivManpower(div);
  const needInf = mp.inf * qty, needTech = mp.tech * qty, needShips = mp.ships * qty;
  if (use.inf + needInf > caps.training) { toast(`Лимит Центра Подготовки: ${ecNum(needInf)} пехоты нужно, свободно ${ecNum(Math.max(0, caps.training - use.inf))}/${ecNum(caps.training)} за ход — постройте слоты или ждите хода`, 'err'); return; }
  if (use.tech + needTech > caps.military) { toast(`Лимит Военного Завода: ${ecNum(needTech)} техники нужно, свободно ${ecNum(Math.max(0, caps.military - use.tech))}/${ecNum(caps.military)} за ход — постройте слоты или ждите хода`, 'err'); return; }
  if (use.ships + needShips > caps.ships) { toast(`Лимит Верфи: ${ecNum(needShips)} кораблей в составе, свободно ${ecNum(Math.max(0, caps.ships - use.ships))}/${ecNum(caps.ships)} за ход`, 'err'); return; }
  const cost = ((div.summary && div.summary.cost) || 0) * qty;
  EC.busy = true;
  try {
    const r = await ecRpc('economy_produce', { p_unit_id: div.id, p_qty: qty });
    const sc = r && +r.surcharge || 0;
    toast(`Формируется дивизия: ${div.name} ×${qty}` + (sc > 0 ? ` · докуплено сырья на ${ecNum(sc)} ГС` : ''), 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// ── Ресурсная ведомость корабля в панели производства ───────
// Сравнивает summary.bill дизайна со складом (EC.eco.resources), считает
// дефицит и наценку ×1.5 — зеркало economy_produce (_unit_resources.sql).
function ecShipBillIcon(name) {
  try { if (window.GalaxyGen && GalaxyGen.resIconHtml) return GalaxyGen.resIconHtml(name, 'ec-bill-ic') + ' '; } catch (e) {}
  return '';
}
// Ядро: ведомость по дизайну (корабль/дивизия) и количеству. Зеркало
// economy_produce (_unit_resources.sql): дефицит докупается ×1.5.
function ecUnitBillHtml(u, qty) {
  if (!u) return '';
  qty = Math.max(1, qty || 1);
  const bill = (u.summary && u.summary.bill) || {};
  const keys = Object.keys(bill);
  const base = ((u.summary && u.summary.cost) || 0) * qty;
  if (!keys.length) return `<div class="ec-bill-foot"><span class="ec-bill-note ec-bill-ok">✓ Сырьё не требуется.</span><span class="ec-bill-total">Итого <b>${ecNum(base)} ГС</b></span></div>`;
  const res = (EC.eco && EC.eco.resources) || {};
  let surchargeRaw = 0, anyShort = false, anyBlocked = false;
  // сортировка: сначала блокирующие, потом дефицитные, потом покрытые — глаз сразу видит проблему
  const rows = keys.map(nm => {
    const need = (+bill[nm] || 0) * qty, have = +res[nm] || 0, short = Math.max(0, need - have);
    const mkStock = (EC.market && EC.market[nm] && Number.isFinite(EC.market[nm].stock)) ? EC.market[nm].stock : null;
    const blocked = short > 0 && mkStock !== null && mkStock < short;
    return { nm, need, have, short, mkStock, blocked };
  }).sort((a, b) => (b.blocked - a.blocked) || (b.short - a.short) || a.nm.localeCompare(b.nm));
  const items = rows.map(r => {
    if (r.short > 0) { surchargeRaw += r.short * ecResPriceN(r.nm) * 1.5; anyShort = true; }
    if (r.blocked) anyBlocked = true;
    const cls = r.blocked ? 'ec-bom--block' : (r.short > 0 ? 'ec-bom--short' : 'ec-bom--ok');
    const pct = r.need > 0 ? Math.min(100, Math.round(r.have / r.need * 100)) : 100;
    const tag = r.blocked
      ? `<span class="ec-bom-tag" title="На рынке всего ${ecNum(r.mkStock)} ед. — меньше дефицита">рынок: ${ecNum(r.mkStock)}</span>`
      : r.short > 0
      ? `<span class="ec-bom-tag">докупка ${ecNum(r.short)}</span>`
      : `<span class="ec-bom-tag">✓</span>`;
    return `<div class="ec-bom ${cls}">
      <span class="ec-bom-ic">${ecShipBillIcon(r.nm)}</span>
      <div class="ec-bom-main">
        <div class="ec-bom-top"><span class="ec-bom-nm">${esc(r.nm)}</span><span class="ec-bom-qty"><b>${ecNum(r.have)}</b><i> / ${ecNum(r.need)}</i></span></div>
        <div class="ec-bom-bar"><div class="ec-bom-fill" style="width:${pct}%"></div></div>
      </div>
      ${tag}
    </div>`;
  }).join('');
  const surcharge = Math.ceil(surchargeRaw);
  const note = anyBlocked
    ? `<span class="ec-bill-note ec-bill-block">⛔ На рынке нет столько сырья — закладка не пройдёт. Ждите суточного обновления рынка (NPC) или закупки у других держав.</span>`
    : anyShort
    ? `<span class="ec-bill-note ec-bill-short">⚠ Дефицит докупается с рынка ×1.5: <b>+${ecNum(surcharge)} ГС</b></span>`
    : `<span class="ec-bill-note ec-bill-ok">✓ Сырья на складе хватает — берётся бесплатно.</span>`;
  return `<div class="ec-bom-grid">${items}</div>
    <div class="ec-bill-foot">${note}<span class="ec-bill-total">Итого <b>${ecNum(base + surcharge)} ГС</b>${surcharge ? ` <span class="ec-hint">(${ecNum(base)} + ${ecNum(surcharge)})</span>` : ''}</span></div>`;
}
function ecShipBillHtml(unitId, qty) {
  return ecUnitBillHtml(EC.designs.find(d => d.id === unitId && d.category === 'ship'), qty);
}
function ecShipBillUpd() {
  const box = ecId('ec-ship-bill'), sel = ecId('ec-ship-sel'); if (!box || !sel) return;
  box.innerHTML = ecShipBillHtml(sel.value, Math.max(1, parseInt(ecId('ec-ship-qty')?.value) || 1));
}
function ecDivBillHtml(divId, qty) {
  return ecUnitBillHtml(EC.designs.find(d => d.id === divId && d.category === 'division'), qty);
}
function ecDivBillUpd(divId) {
  const box = ecId('ec-div-bill-' + divId); if (!box) return;
  box.innerHTML = ecDivBillHtml(divId, Math.max(1, parseInt(ecId('ec-div-qty-' + divId)?.value) || 1));
}

// Постройка корабля — поштучно на Верфи
async function ecProduceShip() {
  if (EC.busy) return;
  const sel = ecId('ec-ship-sel'); if (!sel || !sel.value) { toast('Выберите корабль', 'err'); return; }
  const qty = Math.max(1, parseInt(ecId('ec-ship-qty')?.value) || 1);
  const u = EC.designs.find(d => d.id === sel.value && d.category === 'ship'); if (!u) { toast('Проект не найден', 'err'); return; }
  const caps = ecCaps(), use = ecPendingUse();
  if (!caps.hasShipyard) { toast('Нужна Корабельная Верфь', 'err'); return; }
  if (use.ships + qty > caps.ships) { toast(`Лимит верфи на ход: ${use.ships}/${caps.ships} кораблей — откройте слоты или ждите хода`, 'err'); return; }
  const fUsed = ecFleetUsed();
  if (fUsed + qty > caps.fleetCap) { toast(`Превышена вместимость флота: ${ecNum(fUsed)}/${ecNum(caps.fleetCap)}. Постройте Звёздную Базу или откройте её слот.`, 'err'); return; }
  const cost = ((u.summary && u.summary.cost) || 0) * qty;
  EC.busy = true;
  try {
    const r = await ecRpc('economy_produce', { p_unit_id: u.id, p_qty: qty });
    const sc = r && +r.surcharge || 0;
    toast(`Заложен корабль: ${u.name} ×${qty}` + (sc > 0 ? ` · докуплено сырья на ${ecNum(sc)} ГС` : ''), 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

async function ecCancelProd(id) {
  try {
    await ecRpc('economy_cancel_production', { p_id: id });
    toast('Производство отменено', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}

// ── Постройка зданий: каталог-выбор → подтверждение → стройка ──
function _ecBuildFree(colonyId) {
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return 0;
  const used = EC.buildings.filter(b => b.colony_id === colonyId).length
    + (EC.projects || []).filter(p => p.kind === 'build' && p.colony_id === colonyId).length;
  return (colony.cells || EC_DEFAULT_CELLS) - used;
}
function _ecBuildHost() {
  let h = document.getElementById('ec-bp-host');
  if (!h) { h = document.createElement('div'); h.id = 'ec-bp-host'; document.body.appendChild(h); }
  return h;
}
function ecBuildClose() { const h = document.getElementById('ec-bp-host'); if (h) h.innerHTML = ''; }

// Шаг 1 — каталог построек (что можно построить)
function ecBuildPicker(colonyId) {
  if (EC.busy) return;
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const free = _ecBuildFree(colonyId);
  if (free <= 0) { toast('Нет свободных ячеек на планете', 'err'); return; }
  const gc = EC.eco.gc || 0;
  const myFaiths = (EC.faith && EC.faith.faiths) || [];        // мультивера: исповедуемые религии
  const hasFaith = myFaiths.length > 0;                        // храм доступен только исповедующим веру
  // добывающие домики: какие типы залежей копает каждый ярус (визуальные чипы редкости)
  const MINE_RARS = { mining: ['common'], mining_deep: ['uncommon', 'rare'], mining_exotic: ['epic', 'legendary'] };
  const cards = EC_ORDER.filter(t => t !== 'temple' || hasFaith).map(t => {
    const d = EC_BUILD[t]; const cost = ecBuildCost(d.cost); const afford = gc >= cost;
    const catLabel = d.cat === 'civ' ? 'Гражд.' : d.cat === 'faith' ? 'Вера' : 'Воен.';
    const mineChips = MINE_RARS[t] ? `<span class="ec-bp-mine">⛏ добывает: ${MINE_RARS[t].map(r =>
      `<span class="ec-bp-rar ec-bp-rar-${r}">◈ ${ecRarLabel(r)}</span>`).join('')}</span>` : '';
    // мультивера: для храма сперва выбираем веру (если их несколько); иначе сразу подтверждение
    const act = t === 'temple' ? `ecBuildTempleFaith('${colonyId}')` : `ecBuildConfirm('${colonyId}','${t}')`;
    return `<button class="ec-bp-card ec-bp-${d.cat}${afford ? '' : ' ec-bp-noaf'}" ${afford ? '' : 'disabled'} onclick="${act}">
      <span class="ec-bp-ic">${EC_BLD_ICON[t] || '⌂'}</span>
      <span class="ec-bp-info">
        <span class="ec-bp-row1"><span class="ec-bp-name">${esc(d.name)}</span><span class="ec-bp-cat ec-bp-cat-${d.cat}">${catLabel}</span></span>
        <span class="ec-bp-desc">${esc(d.desc)}</span>
        ${mineChips}
        <span class="ec-bp-howto">${esc(EC_BLD_HOWTO[t] || '')}</span>
      </span>
      <span class="ec-bp-cost${afford ? '' : ' ec-bp-cant'}">${ecNum(cost)} <small>ГС</small></span>
    </button>`;
  }).join('') + ecDoomBuildCard(colonyId, gc);
  _ecBuildHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecBuildClose()">
    <div class="ec-bp-modal" role="dialog" aria-modal="true">
      <div class="ec-bp-hd">
        <div class="ec-bp-hd-t"><span class="ec-bp-hd-ic">🏗</span><span>Что построить</span></div>
        <button class="ec-bp-x" title="Закрыть" onclick="ecBuildClose()">✕</button>
      </div>
      <div class="ec-bp-meta"><span>🪐 ${esc(colony.planet_name || 'Колония')}</span><span>⬚ свободно ячеек: <b>${free}</b></span><span>💰 казна: <b>${ecNum(gc)}</b> ГС</span></div>
      <div class="ec-bp-filters" role="tablist">
        <button class="ec-flt is-on" data-cat="all" onclick="ecBpFilter(this,'all')">Все</button>
        <button class="ec-flt" data-cat="civ" onclick="ecBpFilter(this,'civ')">🏭 Гражданские</button>
        <button class="ec-flt" data-cat="mil" onclick="ecBpFilter(this,'mil')">🪖 Военные</button>
        <button class="ec-flt" data-cat="faith" onclick="ecBpFilter(this,'faith')">🛐 Вера</button>
      </div>
      <div class="ec-bp-grid flt-all">${cards}</div>
      <div class="ec-bp-foot">Постройка занимает 1 ячейку и завершается через 1 игровой день. Затраты возвращаются при отмене.</div>
    </div>
  </div>`;
}

// Фильтр каталога постройки по категории (CSS-классом, без перерисовки).
function ecBpFilter(btn, cat) {
  const wrap = btn.closest('.ec-bp-modal'); if (!wrap) return;
  wrap.querySelectorAll('.ec-bp-filters .ec-flt').forEach(b => b.classList.toggle('is-on', b === btn));
  const grid = wrap.querySelector('.ec-bp-grid');
  if (grid) grid.className = 'ec-bp-grid flt-' + cat;
}

// ════════════════════════════════════════════════════════════
//  МЕЖЗВЁЗДНАЯ АРТИЛЛЕРИЯ — «Длань Неотвратимости» (клиент)
// ════════════════════════════════════════════════════════════
// Запас ресурса на складе по русскому имени (зеркало faction_economy.resources).
function ecStockOf(name) { return +(((EC.eco && EC.eco.resources) || {})[name] || 0); }
// Открыто ли исследование «Сама неотвратимость».
function ecHasDoomTech() { return ((EC.eco && EC.eco.research) || []).includes('pol.inevitability'); }

// Карточка постройки орудия в меню «Что построить» (только если изучено).
function ecDoomBuildCard(colonyId, gc) {
  if (!ecHasDoomTech()) return '';
  const d = EC_BUILD.doomgun; const cost = ecBuildCost(d.cost);
  const matter = ecStockOf('Программируемая материя');
  const afford = gc >= cost && matter >= EC_DOOM_BUILD_MATTER;
  const why = gc < cost ? 'Не хватает ГС' : matter < EC_DOOM_BUILD_MATTER ? `Нужно ${EC_DOOM_BUILD_MATTER} 🟢 Программируемой материи (есть ${ecNum(matter)})` : '';
  return `<button class="ec-bp-card ec-bp-mil ec-bp-doom${afford ? '' : ' ec-bp-noaf'}" ${afford ? '' : 'disabled'} onclick="ecDoomBuildConfirm('${colonyId}')" title="${esc(why)}" style="border-color:rgba(220,40,40,.5)">
      <span class="ec-bp-ic">🜨</span>
      <span class="ec-bp-info">
        <span class="ec-bp-row1"><span class="ec-bp-name">${esc(d.name)}</span><span class="ec-bp-cat ec-bp-cat-mil" style="background:rgba(220,40,40,.25)">СУДНЫЙ ДЕНЬ</span></span>
        <span class="ec-bp-desc">${esc(d.desc)}</span>
        <span class="ec-bp-howto">${esc(EC_BLD_HOWTO.doomgun)}</span>
      </span>
      <span class="ec-bp-cost${afford ? '' : ' ec-bp-cant'}">${ecNum(cost)} <small>ГС</small><br><small>+${EC_DOOM_BUILD_MATTER} 🟢</small></span>
    </button>`;
}

// Подтверждение постройки орудия.
function ecDoomBuildConfirm(colonyId) {
  const d = EC_BUILD.doomgun; const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const cost = ecBuildCost(d.cost); const matter = ecStockOf('Программируемая материя');
  const afterGc = (EC.eco.gc || 0) - cost; const afterMatter = matter - EC_DOOM_BUILD_MATTER;
  const ok = afterGc >= 0 && afterMatter >= 0;
  _ecBuildHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecBuildClose()">
    <div class="ec-bp-modal ec-bp-cf" role="dialog" aria-modal="true">
      <div class="ec-bp-cf-ic ec-bp-mil" style="background:rgba(220,40,40,.2)">🜨</div>
      <div class="ec-bp-cf-title">Возвести «${esc(d.name)}»?</div>
      <div class="ec-bp-cf-desc">${esc(d.desc)}</div>
      <div class="ec-bp-cf-howto">⚠ Орудие необратимо меняет правила: им можно стереть планету любой державы. Содержите его Программируемой материей, иначе оно деградирует и распадётся.</div>
      <div class="ec-bp-cf-rows">
        <div class="ec-bp-cf-row"><span>🪐 Планета</span><b>${esc(colony.planet_name || 'Колония')}</b></div>
        <div class="ec-bp-cf-row"><span>💰 Стоимость</span><b>${ecNum(cost)} ГС</b></div>
        <div class="ec-bp-cf-row"><span>🟢 Программируемая материя</span><b class="${afterMatter < 0 ? 'ec-warn' : ''}">${EC_DOOM_BUILD_MATTER} (есть ${ecNum(matter)})</b></div>
        <div class="ec-bp-cf-row"><span>⏳ Срок</span><b>1 игровой день</b></div>
        <div class="ec-bp-cf-row"><span>🏦 Казна после</span><b class="${afterGc < 0 ? 'ec-warn' : ''}">${ecNum(afterGc)} ГС</b></div>
      </div>
      <div class="ec-bp-cf-act">
        <button class="btn btn-gh btn-sm" onclick="ecBuildPicker('${colonyId}')">← Назад</button>
        <button class="btn btn-gd btn-sm" ${ok ? '' : 'disabled'} onclick="ecDoomBuildDo('${colonyId}')">🜨 Возвести</button>
      </div>
    </div>
  </div>`;
}

// Запуск постройки орудия (RPC doom_build).
async function ecDoomBuildDo(colonyId) {
  if (EC.busy) return; EC.busy = true;
  try {
    await ecRpc('doom_build', { p_colony_id: colonyId });
    ecBuildClose();
    toast('Длань Неотвратимости — возведение начато (1 день)', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
  finally { EC.busy = false; }
}

// Строка постройки-орудия в списке колонии: integrity + пульт залпа.
function ecDoomgunRow(b) {
  const d = EC_BUILD.doomgun;
  const g = EC.doomByBuilding[b.id];
  const integ = g ? Math.max(0, Math.round(+g.integrity)) : 100;
  const inFlight = g && g.in_flight;
  const salvo = inFlight ? (EC.doom.salvos || []).find(s => s.gun_id === g.id) : null;
  const grav = ecStockOf('Гравиядро');
  const matter = ecStockOf('Программируемая материя');
  const integColor = integ > 60 ? '#5fd27f' : integ > 30 ? '#e6c45f' : '#ff6a6a';
  const wrecked = integ <= 0;
  const fireBtn = wrecked
    ? `<span class="ec-maxed" style="color:#ff6a6a">💥 распалось</span>`
    : inFlight
      ? `<span class="ec-proj-tag" title="Снаряд в полёте">☄️ залп в пути${salvo ? ' · ' + ecProgressISO(null, salvo.ready_at, 1, 'на подлёте') : ''}</span>`
      : `<button class="btn btn-rd btn-xs" onclick="ecDoomOpenTab('${g ? g.id : ''}')" title="Открыть пульт залпа с визуальным наведением">🜨 Пульт залпа</button>`;
  return `<div class="ec-bld ec-bld-doom" style="border-color:rgba(220,40,40,.45)">
    <div class="ec-bld-top">
      <span class="ec-bld-name">🜨 ${esc(d.name)}</span>
      <button class="ec-bld-del" title="Снести" onclick="ecDemolish('${b.id}')">✕</button>
    </div>
    <div class="ec-doom-integ" title="Целостность орудия">
      <div class="ec-doom-integ-bar" style="background:rgba(255,255,255,.08);border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${integ}%;height:100%;background:${integColor};transition:width .3s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:3px">
        <span style="color:${integColor}">Целостность: <b>${integ}%</b></span>
        <span style="color:var(--t4)">выстрелов: ${g ? g.total_shots : 0}</span>
      </div>
    </div>
    <div class="ec-bld-howto">🟢 Программируемая материя на складе: <b>${ecNum(matter)}</b> · 🔮 Гравиядро: <b>${ecNum(grav)}</b>. ${matter <= 0 ? '<span style="color:#ff6a6a">Нет материи — орудие быстро деградирует!</span>' : 'Материя сдерживает деградацию.'}</div>
    <div class="ec-bld-act" style="justify-content:flex-end">${fireBtn}</div>
  </div>`;
}

// Пульт залпа — выбор системы-цели и планеты, запуск.
function ecDoomConsole(buildingId) {
  const b = EC.buildings.find(x => x.id === buildingId); if (!b) return;
  EC._doomBuilding = buildingId;
  const grav = ecStockOf('Гравиядро');
  const canFuel = grav >= EC_DOOM_SHOT_GRAV;
  const st = EC._doomTarget || {};
  // Все известные системы карты (allSys → EC.allSystems), с планетами.
  const sysList = (EC.allSystems || EC.systems || []);
  const sysOpts = sysList.slice().sort((a, b2) => (a.name || '').localeCompare(b2.name || '', 'ru'))
    .map(s => `<option value="${esc(s.id)}" ${st.sysId === s.id ? 'selected' : ''}>${esc(s.name || s.id)}${s.faction ? '' : ''}</option>`).join('');
  let planetHtml = '<div class="ec-bld-howto">Выберите систему-цель.</div>';
  if (st.sysId) {
    const sys = sysList.find(s => s.id === st.sysId);
    const planets = ecDoomTargetablePlanets(sys);
    if (!planets.length) planetHtml = '<div class="ec-bld-howto" style="color:#e6c45f">В этой системе нет планет-целей (или данные карты не мигрированы).</div>';
    else planetHtml = `<div class="ec-doom-planets">${planets.map(p => {
      const dead = p.dead || p.doomed;
      const sel = st.pid === p.pid;
      return `<button class="ec-bp-card${sel ? ' ec-bp-sel' : ''}" ${dead ? 'disabled' : ''} onclick="ecDoomPick('${esc(st.sysId)}',${p.pid})" style="${sel ? 'border-color:#ff6a6a' : ''}">
        <span class="ec-bp-ic">${dead ? '🪨' : (p.icon || '🪐')}</span>
        <span class="ec-bp-info"><span class="ec-bp-name">${esc(p.name || 'Планета')}</span><span class="ec-bp-desc">${dead ? 'уже мёртвая' : esc(p.type || '')}</span></span>
      </button>`;
    }).join('')}</div>`;
  }
  const target = (st.sysId && Number.isInteger(st.pid)) ? sysList.find(s => s.id === st.sysId) : null;
  const tgtPlanet = target ? (target.planets || []).find(p => p.pid === st.pid) : null;
  const canFire = canFuel && tgtPlanet && !(tgtPlanet.dead || tgtPlanet.doomed);
  // Оценка времени полёта = функция расстояния (зеркало _doom_fire): соседняя
  // система ≈ 3 ч, край↔край карты ≈ 24 ч. Считаем по координатам систем.
  const gun = EC.doomByBuilding ? EC.doomByBuilding[buildingId] : null;
  const orig = gun ? sysList.find(s => s.id === gun.system_id) : null;
  const tgtSys = st.sysId ? sysList.find(s => s.id === st.sysId) : null;
  let flyTxt = 'от 3 ч (рядом) до 24 ч (край карты) — зависит от расстояния';
  if (orig && tgtSys && Number.isFinite(+orig.x) && Number.isFinite(+tgtSys.x)) {
    const dist = Math.hypot(+tgtSys.x - +orig.x, +tgtSys.y - +orig.y);
    const xs = sysList.map(s => +s.x).filter(Number.isFinite);
    const ys = sysList.map(s => +s.y).filter(Number.isFinite);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
    const flyH = 3 + Math.min(1, Math.max(0, dist / diag)) * (24 - 3);
    flyTxt = `≈ ${flyH.toFixed(1)} ч полёта (дистанция ${Math.round(dist)})`;
  }
  _ecBuildHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecBuildClose()">
    <div class="ec-bp-modal" role="dialog" aria-modal="true" style="max-width:560px">
      <div class="ec-bp-hd" style="background:rgba(220,40,40,.12)">
        <div class="ec-bp-hd-t"><span class="ec-bp-hd-ic">🜨</span><span>Пульт залпа — Длань Неотвратимости</span></div>
        <button class="ec-bp-x" title="Закрыть" onclick="ecBuildClose()">✕</button>
      </div>
      <div class="ec-bp-meta"><span>🔮 Гравиядро: <b class="${canFuel ? '' : 'ec-warn'}">${ecNum(grav)}</b> / нужно ${EC_DOOM_SHOT_GRAV}</span><span>☄️ ${flyTxt}</span></div>
      <div style="padding:10px 14px">
        <label style="font-size:12px;color:var(--t3)">Система-цель</label>
        <select class="ec-input" style="width:100%;margin:4px 0 10px" onchange="ecDoomPickSys(this.value)">
          <option value="">— выберите систему —</option>${sysOpts}
        </select>
        ${planetHtml}
        ${tgtPlanet ? `<div class="ec-bld-howto" style="margin-top:10px;color:#ff8a8a">Цель: <b>${esc(tgtPlanet.name || '')}</b> — после поражения станет мёртвым камнем. Любая колония на ней будет стёрта.</div>` : ''}
      </div>
      <div class="ec-bp-cf-act" style="padding:0 14px 14px">
        <button class="btn btn-gh btn-sm" onclick="ecBuildClose()">Отмена</button>
        <button class="btn btn-rd btn-sm" ${canFire ? '' : 'disabled'} onclick="ecDoomFire('${buildingId}')">🜨 ЗАЛП (−${EC_DOOM_SHOT_GRAV} 🔮)</button>
      </div>
    </div>
  </div>`;
}
function ecDoomPickSys(sysId) { EC._doomTarget = { sysId: sysId || null, pid: null }; const b = EC._doomBuilding; if (b) ecDoomConsole(b); }
function ecDoomPick(sysId, pid) { EC._doomTarget = { sysId, pid }; const b = EC._doomBuilding; if (b) ecDoomConsole(b); }
async function ecDoomFire(buildingId) {
  if (EC.busy) return;
  const st = EC._doomTarget || {};
  if (!st.sysId || !Number.isInteger(st.pid)) { toast('Выберите цель', 'err'); return; }
  const g = EC.doomByBuilding[buildingId];
  if (!g) { toast('Орудие не найдено', 'err'); return; }
  if (!confirm('Дать залп по выбранной планете? Это необратимо уничтожит её.')) return;
  EC.busy = true;
  try {
    const r = await ecRpc('doom_fire', { p_gun_id: g.id, p_target_system_id: st.sysId, p_target_pid: st.pid });
    EC._doomTarget = null;
    ecBuildClose();
    toast(`Залп выпущен по «${r?.target || 'цели'}» — снаряд в пути`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
  finally { EC.busy = false; }
}

/* ════════════════════════════════════════════════════════════════
   ВКЛАДКА «ДЛАНЬ НЕОТВРАТИМОСТИ» — пульт залпа с визуальным наведением
   ════════════════════════════════════════════════════════════════ */
// Вкладка доступна, если открыто исследование ИЛИ уже стоит орудие.
function ecDoomUnlocked() {
  return ecHasDoomTech() || !!((EC.doom && EC.doom.guns && EC.doom.guns.length));
}
// Планеты-цели системы: любая планета со стабильным pid, кроме поясов/аномалий.
// ВАЖНО: столичные/колонизированные планеты, рождённые _ensure_capital, не имеют
// полей kind/g — поэтому фильтруем по «не пояс и не аномалия», а не по наличию kind.
function ecDoomTargetablePlanets(sys) {
  return ((sys && sys.planets) || []).filter(p =>
    p && Number.isInteger(p.pid) && p.kind !== 'belt' && p.kind !== 'anomaly');
}
// Открыть вкладку-пульт и навестись конкретным орудием (из строки постройки).
function ecDoomOpenTab(gunId) {
  EC._doomTab = { gunId: gunId || null, sysId: null, pid: null };
  EC.tab = 'doom';
  ecPaintCabinet();
}
// Активное орудие пульта: выбранное игроком, иначе первое боеготовое.
function ecDoomActiveGun() {
  const guns = (EC.doom && EC.doom.guns) || [];
  if (!guns.length) return null;
  const st = EC._doomTab || {};
  let g = st.gunId ? guns.find(x => x.id === st.gunId) : null;
  if (!g) g = guns.find(x => !x.in_flight && +x.integrity > 0) || guns[0];
  return g;
}
// Оценка времени полёта снаряда (зеркало _doom_fire): соседняя система ≈ 3 ч,
// край↔край карты ≈ 24 ч. Возвращает {txt, hours, dist} или null.
function ecDoomFlight(gun, sysId) {
  const sysList = EC.allSystems || EC.systems || [];
  const orig = gun ? sysList.find(s => s.id === gun.system_id) : null;
  const tgt = sysId ? sysList.find(s => s.id === sysId) : null;
  if (!orig || !tgt || !Number.isFinite(+orig.x) || !Number.isFinite(+tgt.x)) return null;
  const dist = Math.hypot(+tgt.x - +orig.x, +tgt.y - +orig.y);
  const xs = sysList.map(s => +s.x).filter(Number.isFinite);
  const ys = sysList.map(s => +s.y).filter(Number.isFinite);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const hours = 3 + Math.min(1, Math.max(0, dist / diag)) * (24 - 3);
  return { txt: `≈ ${hours.toFixed(1)} ч полёта (дистанция ${Math.round(dist)})`, hours, dist: Math.round(dist) };
}
// Разовая инъекция стилей карты наведения (вместе с бампом economy.js?v — всегда свежие).
function ecDoomEnsureStyle() {
  if (document.getElementById('ec-doom-style')) return;
  const s = document.createElement('style'); s.id = 'ec-doom-style';
  s.textContent = `
    .ec-doom-map .mm-zoom-viewport{background:radial-gradient(circle at 50% 38%,rgba(90,20,20,.28),var(--b1) 70%)}
    .dm-star circle{transition:filter .15s}
    .dm-star.dm-can:hover circle{filter:brightness(1.5)}
    .dm-star.dm-sel circle{stroke:#ff5a5a;stroke-width:7;animation:dmPulse 1.2s ease-in-out infinite}
    .dm-star.dm-origin circle{stroke:#ffd166;stroke-width:7}
    .dm-orig-mk{font-size:54px;fill:#ffd166;pointer-events:none}
    #dm-aim{stroke:#ff5a5a;stroke-width:4;stroke-dasharray:18 12;opacity:.85;animation:dmDash 1s linear infinite;pointer-events:none}
    @keyframes dmDash{to{stroke-dashoffset:-30}}
    @keyframes dmPulse{0%,100%{stroke-opacity:1}50%{stroke-opacity:.3}}
    .ec-doom-gunsel{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
    .ec-doom-gunchip{cursor:pointer;border:1px solid var(--bd,#2a3550);border-radius:8px;padding:6px 10px;font-size:12px;background:var(--b2,#141b2e)}
    .ec-doom-gunchip.on{border-color:#ff6a6a;box-shadow:inset 0 0 0 1px #ff6a6a}
  `;
  document.head.appendChild(s);
}
// Карта наведения: SVG-звёзды; клик по системе с целями выбирает её.
function ecDoomMap(gun) {
  const all = EC.allSystems || [];
  if (!all.length) return '<div class="ec-empty">Карта галактики недоступна.</div>';
  mapZoomClean('ec-doom-zoom');
  const W = (typeof GM_W !== 'undefined') ? GM_W : 3300, H = (typeof GM_H !== 'undefined') ? GM_H : 2062;
  const myCol = ecReadable(EC.app.color);
  const byId = new Map(all.map(s => [s.id, s]));
  const originId = gun ? gun.system_id : null;
  const st = EC._doomTab || {};
  const lanes = (EC.lanes || []).map(l => {
    const a = byId.get(l.a_id), b = byId.get(l.b_id); if (!a || !b) return '';
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(255,255,255,.06)" stroke-width="2"/>`;
  }).join('');
  // линия наведения орудие→цель (всегда в DOM, прячем когда цели нет)
  const orig = originId ? byId.get(originId) : null;
  const tgt = st.sysId ? byId.get(st.sysId) : null;
  const aimShow = orig && tgt && orig !== tgt;
  const aimLine = `<line id="dm-aim" x1="${aimShow ? orig.x : 0}" y1="${aimShow ? orig.y : 0}" x2="${aimShow ? tgt.x : 0}" y2="${aimShow ? tgt.y : 0}" style="${aimShow ? '' : 'display:none'}"/>`;
  const dots = all.map(s => {
    const alive = ecDoomTargetablePlanets(s).filter(p => !(p.dead || p.doomed));
    const targetable = alive.length > 0;
    const isOrigin = s.id === originId;
    const isSel = st.sysId === s.id;
    let r = 14, fill = 'rgba(120,140,170,.35)';
    if (s.faction === EC.fid) fill = myCol;
    else if (s.faction) fill = 'rgba(255,90,90,.30)';
    if (!targetable && !isOrigin) { fill = 'rgba(90,100,120,.20)'; r = 11; }
    const cls = 'dm-star' + (isOrigin ? ' dm-origin' : '') + (isSel ? ' dm-sel' : '') + (targetable ? ' dm-can' : '');
    const click = targetable ? ` onclick="ecDoomTabPickSys(this,'${esc(s.id)}')" style="cursor:crosshair"` : '';
    const owner = s.faction ? (s.faction === EC.fid ? ' (ваша)' : ' · ' + esc(ecFacName(s.faction))) : ' (ничья)';
    const ttl = esc(s.name || s.id) + owner + (targetable ? ` · планет-целей: ${alive.length}` : ' · нет целей');
    return `<g class="${cls}" data-sys="${esc(s.id)}"${click}><circle cx="${s.x}" cy="${s.y}" r="${r}" fill="${fill}"></circle>${isOrigin ? `<text class="dm-orig-mk" x="${s.x}" y="${(+s.y) - r - 14}" text-anchor="middle">🜨</text>` : ''}<title>${ttl}</title></g>`;
  }).join('');
  const html = `<div class="ec-minimap ec-doom-map"><div class="mm-zoom-wrapper"><div class="mm-zoom-btns"><button class="mm-zoom-btn" onclick="mapZoomIn('ec-doom-zoom')">+</button><button class="mm-zoom-btn" onclick="mapZoomOut('ec-doom-zoom')">−</button></div><div class="mm-zoom-viewport" id="ec-doom-zoom"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${lanes}${aimLine}${dots}</svg></div></div></div>
    <div class="ec-mm-legend"><span><i style="background:#ffd166"></i> ваше орудие</span><span><i style="background:#ff5a5a"></i> цель</span><span><i style="background:${myCol}"></i> ваши</span><span><i style="background:rgba(255,90,90,.3)"></i> чужие</span><span><i style="background:rgba(120,140,170,.35)"></i> ничьи</span></div>`;
  requestAnimationFrame(() => mapZoomInit('ec-doom-zoom'));
  return html;
}
// Правая панель: выбор планеты-цели в наведённой системе + расчёт + ЗАЛП.
function ecDoomPanelRender() {
  const gun = ecDoomActiveGun();
  const st = EC._doomTab || {};
  const sysList = EC.allSystems || EC.systems || [];
  const grav = ecStockOf('Гравиядро');
  const canFuel = grav >= EC_DOOM_SHOT_GRAV;
  if (gun && gun.in_flight) {
    const salvo = ((EC.doom && EC.doom.salvos) || []).find(s => s.gun_id === gun.id);
    return `<div class="ec-bld-howto" style="color:#ff8a8a">☄️ Это орудие уже дало залп — снаряд в пути${salvo ? '. Подлёт: ' + ecProgressISO(null, salvo.ready_at, 1, 'на подлёте') : ''}. Дождитесь поражения цели, затем перезарядите.</div>`;
  }
  if (!st.sysId) return `<div class="ec-bld-howto">🎯 Кликните звезду на карте слева, чтобы навести орудие на систему-цель.</div>`;
  const sys = sysList.find(s => s.id === st.sysId);
  const sysName = (sys && sys.name) || st.sysId;
  const planets = ecDoomTargetablePlanets(sys);
  let planetHtml;
  if (!planets.length) planetHtml = '<div class="ec-bld-howto" style="color:#e6c45f">В этой системе нет планет-целей (или данные карты не мигрированы).</div>';
  else planetHtml = `<div class="ec-doom-planets">${planets.map(p => {
    const dead = p.dead || p.doomed;
    const sel = st.pid === p.pid;
    return `<button class="ec-bp-card${sel ? ' ec-bp-sel' : ''}" ${dead ? 'disabled' : ''} onclick="ecDoomTabPickPlanet(${p.pid})" style="${sel ? 'border-color:#ff6a6a' : ''}">
      <span class="ec-bp-ic">${dead ? '🪨' : (p.icon || '🪐')}</span>
      <span class="ec-bp-info"><span class="ec-bp-name">${esc(p.name || 'Планета')}</span><span class="ec-bp-desc">${dead ? 'уже мёртвая' : esc(p.type || '')}</span></span>
    </button>`;
  }).join('')}</div>`;
  const tgtPlanet = Number.isInteger(st.pid) ? planets.find(p => p.pid === st.pid) : null;
  const fly = ecDoomFlight(gun, st.sysId);
  const canFire = !!gun && canFuel && tgtPlanet && !(tgtPlanet.dead || tgtPlanet.doomed);
  return `<div class="ec-bp-meta" style="margin:0 0 8px"><span>🔮 Гравиядро: <b class="${canFuel ? '' : 'ec-warn'}">${ecNum(grav)}</b> / нужно ${EC_DOOM_SHOT_GRAV}</span><span>☄️ ${fly ? esc(fly.txt) : 'от 3 ч до 24 ч'}</span></div>
    <div class="ec-section-title" style="margin-top:0">Цель в системе «${esc(sysName)}»</div>
    ${planetHtml}
    ${tgtPlanet ? `<div class="ec-bld-howto" style="margin-top:10px;color:#ff8a8a">Цель: <b>${esc(tgtPlanet.name || '')}</b> — после поражения станет мёртвым камнем. Любая колония на ней (в т.ч. <b>столица</b>) будет стёрта.</div>` : ''}
    <div class="ec-bp-cf-act" style="padding:12px 0 0;justify-content:flex-end">
      <button class="btn btn-rd btn-sm" ${canFire ? '' : 'disabled'} onclick="ecDoomTabFire()">🜨 ЗАЛП (−${EC_DOOM_SHOT_GRAV} 🔮)</button>
    </div>`;
}
// Точечная перерисовка панели (карта/зум не трогаем).
function ecDoomPanelSync() { const el = document.getElementById('ec-doom-panel'); if (el) el.innerHTML = ecDoomPanelRender(); }
// Перерисовка всей вкладки (смена орудия → меняется точка-источник на карте).
function ecDoomBodySync() { const host = document.querySelector('.ec-tabbody'); if (host) host.innerHTML = ecTabDoom(); else ecPaintCabinet(); }
// Клик по звезде: навестись на систему (без перерисовки карты — сохраняем зум/пан).
function ecDoomTabPickSys(el, sysId) {
  const st = EC._doomTab = EC._doomTab || {};
  st.sysId = sysId; st.pid = null;
  document.querySelectorAll('#ec-doom-zoom .dm-star.dm-sel').forEach(g => g.classList.remove('dm-sel'));
  const g = (el && el.classList && el.classList.contains('dm-star')) ? el : (el && el.closest && el.closest('.dm-star'));
  if (g) g.classList.add('dm-sel');
  const gun = ecDoomActiveGun();
  const byId = new Map((EC.allSystems || []).map(s => [s.id, s]));
  const orig = gun ? byId.get(gun.system_id) : null, tgt = byId.get(sysId);
  const aim = document.getElementById('dm-aim');
  if (aim) {
    if (orig && tgt && orig !== tgt) { aim.setAttribute('x1', orig.x); aim.setAttribute('y1', orig.y); aim.setAttribute('x2', tgt.x); aim.setAttribute('y2', tgt.y); aim.style.display = ''; }
    else aim.style.display = 'none';
  }
  ecDoomPanelSync();
}
function ecDoomTabPickPlanet(pid) { (EC._doomTab = EC._doomTab || {}).pid = pid; ecDoomPanelSync(); }
function ecDoomTabSelGun(gunId) { (EC._doomTab = EC._doomTab || {}).gunId = gunId; EC._doomTab.sysId = null; EC._doomTab.pid = null; ecDoomBodySync(); }
// ЗАЛП из пульта-вкладки.
async function ecDoomTabFire() {
  if (EC.busy) return;
  const st = EC._doomTab || {};
  const gun = ecDoomActiveGun();
  if (!gun) { toast('Орудие не найдено', 'err'); return; }
  if (!st.sysId || !Number.isInteger(st.pid)) { toast('Выберите систему и планету-цель', 'err'); return; }
  if (!confirm('Дать залп по выбранной планете? Это необратимо уничтожит её вместе с любой колонией (включая столицу).')) return;
  EC.busy = true;
  try {
    const r = await ecRpc('doom_fire', { p_gun_id: gun.id, p_target_system_id: st.sysId, p_target_pid: st.pid });
    EC._doomTab = { gunId: gun.id, sysId: null, pid: null };
    toast(`Залп выпущен по «${r?.target || 'цели'}» — снаряд в пути`, 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
  finally { EC.busy = false; }
}
// Staff: мгновенно приземлить снаряды (для тестов).
async function ecDoomTabSpeed() {
  if (EC.busy || !ecIsStaff()) return;
  EC.busy = true;
  try { await ecRpc('admin_test_speed_doom', { p_fid: EC.fid }); toast('Снаряды приземлены', 'ok'); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { EC.busy = false; }
}
// Вкладка целиком.
function ecTabDoom() {
  ecDoomEnsureStyle();
  const guns = (EC.doom && EC.doom.guns) || [];
  const salvos = ((EC.doom && EC.doom.salvos) || []).filter(s => s.status === 'in_flight');
  const intro = ecIntro('🜨', 'Длань Неотвратимости — пульт залпа',
    'Орудие судного дня стирает планету в другой системе, превращая её в мёртвый камень. Любая колония на цели — включая столицу противника — будет уничтожена.',
    ['Залп тратит <b>' + EC_DOOM_SHOT_GRAV + ' 🔮 Гравиядра</b>. Время полёта зависит от дистанции: <b>≈3 ч</b> к соседней системе, до <b>24 ч</b> на край карты.',
      'Каждый выстрел изнашивает орудие; <b>🟢 Программируемая материя</b> на складе сдерживает деградацию между залпами.',
      'Цель защищена планетарной ПРО? Снаряд может быть перехвачен.']);
  // Нет орудия, но открыто исследование — приглашаем построить.
  if (!guns.length) {
    return intro + `<div class="ec-empty" style="text-align:center;padding:24px">
      <div style="font-size:15px;margin-bottom:6px">Орудие ещё не возведено.</div>
      <div style="color:var(--t3);margin-bottom:14px">Постройте «Длань Неотвратимости» на одной из колоний — это откроет пульт наведения.</div>
      <button class="btn btn-rd btn-sm" onclick="ecSetTab('colonies')">🏗 Перейти к колониям и возвести орудие</button>
    </div>` + ecMzaSection();
  }
  const gun = ecDoomActiveGun();
  (EC._doomTab = EC._doomTab || {}).gunId = gun.id;
  // Селектор орудий (если их несколько).
  const gunSel = guns.length > 1
    ? `<div class="ec-doom-gunsel">${guns.map(g => {
        const nm = ecSysName(g.system_id);
        const tag = g.in_flight ? ' · ☄️ в залпе' : (+g.integrity <= 0 ? ' · 💥' : '');
        return `<div class="ec-doom-gunchip${g.id === gun.id ? ' on' : ''}" onclick="ecDoomTabSelGun('${g.id}')">🜨 ${esc(nm)} <small style="color:var(--t4)">${Math.round(+g.integrity)}%${tag}</small></div>`;
      }).join('')}</div>`
    : '';
  // Карточка состояния активного орудия.
  const integ = Math.max(0, Math.round(+gun.integrity));
  const integColor = integ > 60 ? '#5fd27f' : integ > 30 ? '#e6c45f' : '#ff6a6a';
  const matter = ecStockOf('Программируемая материя');
  const statusCard = `<div class="ec-bld ec-bld-doom" style="border-color:rgba(220,40,40,.45);margin-bottom:12px">
    <div class="ec-bld-top"><span class="ec-bld-name">🜨 Орудие · система «${esc(ecSysName(gun.system_id))}»</span>
      <span style="color:var(--t4);font-size:12px">выстрелов: ${gun.total_shots || 0}</span></div>
    <div class="ec-doom-integ" title="Целостность орудия">
      <div class="ec-doom-integ-bar" style="background:rgba(255,255,255,.08);border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${integ}%;height:100%;background:${integColor};transition:width .3s"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:3px">
        <span style="color:${integColor}">Целостность: <b>${integ}%</b></span>
        <span style="color:var(--t4)">🟢 Материя: <b>${ecNum(matter)}</b> · 🔮 Гравиядро: <b>${ecNum(ecStockOf('Гравиядро'))}</b></span></div></div>
    ${matter <= 0 ? '<div class="ec-bld-howto" style="color:#ff6a6a">Нет программируемой материи — орудие быстро деградирует!</div>' : ''}
  </div>`;
  // Снаряды в полёте.
  const salvoHtml = salvos.length
    ? `<div class="ec-section-title">Снаряды в полёте</div>${salvos.map(s => `<div class="ec-colonize-row">
        <div class="ec-cz-main"><span class="ec-cz-name">☄️ ${esc(s.target_planet || 'цель')} <small style="color:var(--t4)">· ${esc(ecSysName(s.target_system_id))}</small></span>
          <span class="ec-cz-sub">${ecProgressISO(null, s.ready_at, 1, 'на подлёте')}</span></div>
        ${ecIsStaff() ? `<button class="btn btn-gh btn-sm" onclick="ecDoomTabSpeed()" title="Staff: мгновенно приземлить">⏩ Тест</button>` : ''}
      </div>`).join('')}`
    : '';
  // Двухколоночный пульт: карта наведения + панель цели.
  const consoleHtml = `<div class="ec-doom-console" style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
    <div style="flex:1 1 380px;min-width:300px" id="ec-doom-map-wrap">${ecDoomMap(gun)}</div>
    <div style="flex:1 1 280px;min-width:260px" id="ec-doom-panel">${ecDoomPanelRender()}</div>
  </div>`;
  return intro + gunSel + statusCard + salvoHtml +
    `<div class="ec-section-title">Визуальное наведение <span class="ec-hint">— кликните систему-цель на карте, затем выберите планету</span></div>` +
    consoleHtml + ecMzaSection();
}

// ── Гиперпейсер — мобильное орудие судного дня: постройка прямо в этой вкладке ──
// Строится как корабль в системе своей колонии; дальше живёт на карте
// (переброска/залп — кликом по носителю на галактической карте).
function ecMzaSection() {
  const ships = EC.mzaShips || [];
  const gc = +EC.eco.gc || 0, matter = ecStockOf('Программируемая материя');
  const afford = gc >= EC_MZA_BUILD_GC && matter >= EC_MZA_BUILD_MATTER;
  // системы со своей колонией — где можно заложить носитель
  const sysIds = [...new Set((EC.colonies || []).map(c => c.system_id).filter(Boolean))];
  const buildForm = !sysIds.length
    ? `<div class="ec-empty" style="padding:8px">Нет колоний — Гиперпейсер закладывается в системе вашей колонии.</div>`
    : `<div class="ec-prod-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0">
        <select id="ec-mza-sys" class="ec-input" style="min-width:180px">${sysIds.map(sid => `<option value="${esc(sid)}">${esc(ecSysName(sid))}</option>`).join('')}</select>
        <input type="text" id="ec-mza-name" class="ec-input" style="width:160px" maxlength="40" placeholder="имя (необязательно)">
        <button class="btn btn-rd btn-sm" ${afford ? '' : 'disabled'} title="${afford ? '' : 'Не хватает ГС или Программируемой материи'}" onclick="ecMzaBuild()">☣ Заложить Гиперпейсер · ${ecNum(EC_MZA_BUILD_GC)} ГС + ${EC_MZA_BUILD_MATTER} 🟢</button>
      </div>
      <div class="ec-bld-howto">Строится <b>сутки</b>, затем появляется на <b>галактической карте</b>. Переброска по всей карте и залпы по планетам — кликом по носителю на карте. Залп тратит <b>${EC_MZA_SHOT_GRAV} 🔮 Гравиядра</b> и изнашивает корпус (≈4 залпа).</div>`;
  const haveGrav = ecStockOf('Гравиядро');
  const shipRows = ships.length
    ? `<div class="ec-mza-grid">${ships.map(sh => ecMzaCard(sh, haveGrav)).join('')}</div>`
    : '';
  return `<div class="ec-section-title" style="margin-top:18px">☣ Гиперпейсер <span class="ec-hint">— мобильное орудие судного дня на корабле: ездит по всей карте</span></div>
    ${buildForm}
    ${ships.length ? `<div class="ec-sub-title" style="margin-top:8px">Мои гиперпейсеры · ${ships.length} <span class="ec-hint">(управление — на карте)</span></div>${shipRows}` : ''}`;
}

// Карточка одного Гиперпейсера: флаг фракции, статус-бейдж, ШКАЛА корпуса,
// готовность залпа (Гравиядра), счётчик залпов и ETA перелёта/постройки.
function ecMzaCard(sh, haveGrav) {
  const integ = Math.max(0, Math.round(+sh.integrity || 0));
  const wear = (typeof EC_MZA_SHOT_WEAR === 'number' && EC_MZA_SHOT_WEAR) || 25;
  const gravNeed = EC_MZA_SHOT_GRAV || 12;
  const shotsLeft = Math.floor(integ / wear);              // сколько залпов выдержит корпус
  // статус-бейдж
  let stIc, stTxt, stCol;
  if (sh.status === 'building')      { stIc = '🏗'; stTxt = 'строится'; stCol = '#8a93a8'; }
  else if (sh.status === 'transit')  { stIc = '➤'; stTxt = 'в пути'; stCol = '#6f9bd8'; }
  else if (sh.in_flight)             { stIc = '☄️'; stTxt = 'залп в полёте'; stCol = '#e6a23c'; }
  else if (sh.can_fire)              { stIc = '🜨'; stTxt = 'готов к залпу'; stCol = '#e14637'; }
  else if (integ <= 0)               { stIc = '☠'; stTxt = 'корпус изношен'; stCol = '#b34b4b'; }
  else                               { stIc = '⚓'; stTxt = 'на стоянке'; stCol = '#7d8aa0'; }
  // цвет шкалы корпуса
  const hullCol = integ >= 60 ? '#3fa66a' : integ >= 30 ? '#d8a13a' : '#d65a4a';
  const where = sh.system_id ? esc(ecSysName(sh.system_id)) : '—';
  // ETA для строящихся/летящих
  let etaRow = '';
  if ((sh.status === 'building' || sh.status === 'transit') && sh.arrive_at) {
    const lbl = sh.status === 'building' ? 'готов через' : 'долёт через';
    etaRow = `<div class="ec-mza-stat"><span class="ec-mza-k">⏱ ${lbl}</span><b>${ecEtaShort(sh.arrive_at)}</b></div>`;
  }
  // готовность залпа по Гравиядрам
  const gravOk = haveGrav >= gravNeed;
  const gravRow = `<div class="ec-mza-stat"><span class="ec-mza-k">🔮 Гравиядра</span><b style="color:${gravOk ? 'var(--gd,#3fa66a)' : 'var(--rd,#d65a4a)'}">${ecNum(Math.floor(haveGrav))}/${gravNeed}</b></div>`;
  const shotsRow = `<div class="ec-mza-stat"><span class="ec-mza-k">🎯 залпов дано</span><b>${ecNum(+sh.total_shots || 0)}</b></div>`;
  const flag = ecFacFlag(EC.fid, 34);
  return `<div class="ec-mza-card">
    <div class="ec-mza-hd">
      ${flag}
      <div class="ec-mza-id">
        <div class="ec-mza-name">☣ Гиперпейсер${sh.name ? ' «' + esc(sh.name) + '»' : ''}</div>
        <div class="ec-mza-loc">📍 ${where}</div>
      </div>
      <span class="ec-mza-badge" style="color:${stCol};border-color:${stCol}55;background:${stCol}1a">${stIc} ${stTxt}</span>
    </div>
    <div class="ec-mza-hull">
      <div class="ec-mza-hull-top"><span>Корпус</span><b style="color:${hullCol}">${integ}%</b></div>
      <div class="ec-mza-bar"><i style="width:${integ}%;background:${hullCol}"></i></div>
      <div class="ec-mza-hull-sub">${integ <= 0 ? 'негоден — спишите носитель' : '≈ ' + shotsLeft + ' залп(ов) до износа'}</div>
    </div>
    <div class="ec-mza-stats">
      ${etaRow}${gravRow}${shotsRow}
    </div>
    <div class="ec-mza-foot">🗺 Перебросить, дать залп и списать — кликом по носителю на карте</div>
  </div>`;
}
async function ecMzaBuild() {
  if (EC.busy) return;
  const sel = ecId('ec-mza-sys'); if (!sel || !sel.value) { toast('Выберите систему с колонией', 'err'); return; }
  if ((+EC.eco.gc || 0) < EC_MZA_BUILD_GC) { toast('Не хватает ГС: Гиперпейсер стоит ' + ecNum(EC_MZA_BUILD_GC), 'err'); return; }
  const nm = (ecId('ec-mza-name')?.value || '').trim();
  EC.busy = true;
  try {
    await ecRpc('mza_build', { p_system_id: sel.value, p_name: nm || null });
    toast('☣ Гиперпейсер заложен · строится сутки · появится на карте', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Шаг 1.5 (только храм) — выбор веры, чьим будет храм. Если вера одна — пропускаем.
function ecBuildTempleFaith(colonyId) {
  const myFaiths = (EC.faith && EC.faith.faiths) || [];
  if (myFaiths.length <= 1) { ecBuildConfirm(colonyId, 'temple', myFaiths[0] && myFaiths[0].id); return; }
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const cards = myFaiths.map(f => {
    const fc = esc(f.color || '#c9a227');
    const roleTxt = f.role === 'founder' ? '👑 ваша' : f.role === 'recognized' ? '🕊 признана' : '🙏 принята';
    return `<button class="ec-bp-card ec-bp-faith" onclick="ecBuildConfirm('${colonyId}','temple','${f.id}')">
      <span class="ec-bp-ic" style="color:${fc}">🛐</span>
      <span class="ec-bp-info">
        <span class="ec-bp-row1"><span class="ec-bp-name" style="color:${fc}">«${esc(f.name)}»</span><span class="ec-bp-cat ec-bp-cat-faith">${roleTxt}</span></span>
        <span class="ec-bp-desc">Храм этой веры · паства ${ecNum(f.flock || 0)} слот(ов)</span>
      </span>
      <span class="ec-bp-cost">→</span>
    </button>`;
  }).join('');
  _ecBuildHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecBuildClose()">
    <div class="ec-bp-modal" role="dialog" aria-modal="true">
      <div class="ec-bp-hd">
        <div class="ec-bp-hd-t"><span class="ec-bp-hd-ic">🛐</span><span>Храм какой веры?</span></div>
        <button class="ec-bp-x" title="Закрыть" onclick="ecBuildClose()">✕</button>
      </div>
      <div class="ec-bp-meta"><span>🪐 ${esc(colony.planet_name || 'Колония')}</span><span>Выберите религию — она будет указана у храма</span></div>
      <div class="ec-bp-grid">${cards}</div>
      <div class="ec-bp-foot"><button class="btn btn-gh btn-sm" onclick="ecBuildPicker('${colonyId}')">← Назад к списку</button></div>
    </div>
  </div>`;
}

// Шаг 2 — подтверждение выбранной постройки (faithId — только для храма)
function ecBuildConfirm(colonyId, btype, faithId) {
  const d = EC_BUILD[btype]; if (!d) return;
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const cost = ecBuildCost(d.cost); const after = (EC.eco.gc || 0) - cost;
  const fa = faithId ? (EC.faithById[faithId] || null) : null;
  const faithRow = (btype === 'temple' && fa) ? `<div class="ec-bp-cf-row"><span>🛐 Религия</span><b style="color:${esc(fa.color || '#c9a227')}">«${esc(fa.name)}»</b></div>` : '';
  const fArg = faithId ? `,'${faithId}'` : '';
  _ecBuildHost().innerHTML = `<div class="ec-bp-ov" onclick="if(event.target===this)ecBuildClose()">
    <div class="ec-bp-modal ec-bp-cf" role="dialog" aria-modal="true">
      <div class="ec-bp-cf-ic ec-bp-${d.cat}">${EC_BLD_ICON[btype] || '⌂'}</div>
      <div class="ec-bp-cf-title">Построить «${esc(d.name)}»?</div>
      <div class="ec-bp-cf-desc">${esc(d.desc)}</div>
      <div class="ec-bp-cf-howto">${esc(EC_BLD_HOWTO[btype] || '')}</div>
      <div class="ec-bp-cf-rows">
        <div class="ec-bp-cf-row"><span>🪐 Планета</span><b>${esc(colony.planet_name || 'Колония')}</b></div>
        ${faithRow}
        <div class="ec-bp-cf-row"><span>💰 Стоимость</span><b>${ecNum(cost)} ГС</b></div>
        <div class="ec-bp-cf-row"><span>⏳ Срок</span><b>1 игровой день</b></div>
        <div class="ec-bp-cf-row"><span>🏦 Казна после</span><b class="${after < 0 ? 'ec-warn' : ''}">${ecNum(after)} ГС</b></div>
      </div>
      <div class="ec-bp-cf-act">
        <button class="btn btn-gh btn-sm" onclick="${btype === 'temple' ? `ecBuildTempleFaith('${colonyId}')` : `ecBuildPicker('${colonyId}')`}">← Назад</button>
        <button class="btn btn-gd btn-sm" onclick="ecBuildDo('${colonyId}','${btype}'${fArg})">✓ Построить за ${ecNum(cost)} ГС</button>
      </div>
    </div>
  </div>`;
}

// Шаг 3 — собственно постройка (отложенный проект, 1 ход)
async function ecBuildDo(colonyId, btype, faithId) {
  if (EC.busy) return;
  const d = EC_BUILD[btype]; if (!d) return;
  const colony = EC.colonies.find(c => c.id === colonyId); if (!colony) return;
  const used = EC.buildings.filter(b => b.colony_id === colonyId).length;
  const pending = (EC.projects || []).filter(p => p.kind === 'build' && p.colony_id === colonyId).length;
  if (used + pending >= (colony.cells || EC_DEFAULT_CELLS)) { toast('Нет свободных ячеек на планете', 'err'); ecBuildClose(); return; }
  EC.busy = true;
  try {
    await ecRpc('economy_build', { p_colony_id: colonyId, p_btype: btype, p_faith_id: (btype === 'temple' ? (faithId || null) : null) });
    ecBuildClose();
    toast(d.name + ' — строительство начато (1 день)', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); ecBuildClose(); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Слоты построек открывает бюджет (ecBudgetPanel) — ручного economy_open_slot больше нет.

async function ecToggleTnp(buildingId, checked) {
  try { await ecRpc('economy_set_tnp', { p_building_id: buildingId, p_on: !!checked }); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}
// Режим добывающего завода: 'store' (склад) | 'export' (торговый путь/караваны) | 'market' (живой рынок)
async function ecSetMineMode(buildingId, mode) {
  try {
    await ecRpc('economy_set_mine_mode', { p_building_id: buildingId, p_mode: mode });
    const b = EC.buildings.find(x => x.id === buildingId); if (b) b.mine_mode = mode;
    ecPaintCabinet();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); }
}

// Обустройство среды обитания на своей колонии (+ячейки) — отложенный проект (1 ход).
async function ecHabitat(colonyId) {
  if (EC.busy) return;
  const c = EC.colonies.find(x => x.id === colonyId); if (!c) return;
  if (ecPendingHabitat(colonyId)) { toast('Обустройство уже идёт', 'inf'); return; }
  EC.busy = true;
  try {
    await ecRpc('economy_habitat', { p_colony_id: colonyId });
    toast('Обустройство среды начато — завершится через 1 день', 'ok');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
  finally { EC.busy = false; }
}

// Вложенная стоимость здания = только база постройки: слоты открывает бюджет
// бесплатно, поэтому в возврат при сносе они не входят (зеркало economy_demolish).
function ecBuildingInvested(b) {
  const d = EC_BUILD[b.btype]; if (!d) return 0;
  return ecBuildCost(d.cost || 0);
}
async function ecDemolish(buildingId) {
  const b = EC.buildings.find(x => x.id === buildingId); if (!b) return;
  const pend = ecPendingSlot(buildingId);
  let refund = Math.floor((ecBuildingInvested(b) + (pend ? ecProjectRefund(pend).gc : 0)) / 2);
  if (!confirm(`Снести постройку?${refund ? ` Вернётся ${ecNum(refund)} ГС (½ стоимости${pend ? ' + незавершённого слота' : ''}).` : ''}`)) return;
  try {
    await ecRpc('economy_demolish', { p_building_id: buildingId });
    toast(refund ? `Снесено · возврат ${ecNum(refund)} ГС` : 'Снесено', 'inf');
    await ecReloadPaint();
  } catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}

async function ecAbandon(colonyId) {
  const c = EC.colonies.find(x => x.id === colonyId); if (!c) return;
  if (!confirm('Бросить колонию «' + (c.planet_name || '') + '»? Все её постройки будут потеряны.')) return;
  try { await ecRpc('economy_abandon', { p_colony_id: colonyId }); toast('Колония оставлена', 'inf'); await ecReloadPaint(); }
  catch (e) { toast('Ошибка: ' + (typeof ecErr === 'function' ? ecErr(e.message) : e.message), 'err'); await ecReloadPaint(); }
}

// Показать ТТХ корабля или дивизии из боевого состава.
// Юниты в ростере — это проекты конструктора (EC.designs = faction_units),
// поэтому переиспользуем готовую модалку конструктора cnViewUnit.
function ecShowUnitSpecs(unitName, category) {
  if (!unitName) return;
  // Ищем проект по имени + категории; если переименовали — по одному имени.
  const designs = EC.designs || [];
  const design = designs.find(d => d.name === unitName && d.category === category)
              || designs.find(d => d.name === unitName);
  if (design && typeof cnViewUnit === 'function' && typeof CN !== 'undefined') {
    // Подсовываем проект в каталог конструктора, чтобы cnViewUnit нашёл его по id.
    CN.catUnits = CN.catUnits || [];
    if (!CN.catUnits.some(u => u.id === design.id)) CN.catUnits.push(design);
    cnViewUnit(design.id);
    return;
  }
  // Фолбэк: проект удалён/недоступен — покажем минимальную карточку из снапшота.
  ecShowUnitSpecsFallback(unitName, category, design);
}

// Запасная карточка ТТХ, если исходный проект конструктора недоступен.
function ecShowUnitSpecsFallback(unitName, category, design) {
  const sm = (design && design.summary) || {};
  const card = (design && design.card_text) || '';
  const rows = [];
  if (sm.hp != null)     rows.push(['HP', ecNum(sm.hp)]);
  if (sm.armor != null)  rows.push(['Броня', ecNum(sm.armor)]);
  if (sm.shield)         rows.push(['Щит', ecNum(sm.shield)]);
  if (sm.speed != null)  rows.push(['Скорость', ecNum(sm.speed)]);
  if (sm.on != null)     rows.push(['ОН', sm.on]);
  if (sm.cost != null)   rows.push(['Цена', ecNum(sm.cost) + ' ГС']);
  const statsHtml = rows.length
    ? `<div class="ec-treasury" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));margin:12px 0">
        ${rows.map(([k, v]) => `<div class="ec-res"><span class="ec-res-k">${esc(k)}</span><span class="ec-res-v" style="font-size:15px">${esc(String(v))}</span></div>`).join('')}
      </div>` : '';
  const specHtml = card ? `<pre class="cn-spec">${esc(card)}</pre>` : '';
  const body = (statsHtml || specHtml)
    ? `${statsHtml}${specHtml}`
    : `<div class="ec-empty" style="margin:12px 0">Подробные характеристики недоступны — проект больше не существует в конструкторе.</div>`;
  let ov = document.getElementById('ec-unit-spec-ov');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'ec-unit-spec-ov'; ov.className = 'cn-modal-ov';
    ov.onclick = e => { if (e.target === ov) ov.classList.remove('show'); };
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="cn-modal">
    <button class="cn-modal-x" onclick="document.getElementById('ec-unit-spec-ov').classList.remove('show')">✕</button>
    <div class="cn-modal-bar"></div>
    <div class="cn-modal-name">${esc(unitName)}</div>
    <div class="cn-card-fac">${category === 'ship' ? '🚀 Корабль' : '⚔ Дивизия'}</div>
    ${body}
  </div>`;
  ov.classList.add('show');
}
