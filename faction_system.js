// ═══════════════════════════════════════════════════════════════
// FACTION SYSTEM v2 — конструктор фракций
// Контент берётся из статей page_type=faction_concept/culture/accent
// Fallback — встроенный хардкод
// ═══════════════════════════════════════════════════════════════

// ── Утилита: вытащить extra из infobox страницы ──────────────
function _parsePageExtra(content) {
  const extra = {};
  try {
    const blocks = JSON.parse(content || '[]');
    const ib = blocks.find(b => b.type === 'infobox');
    if (ib) (ib.sections||[]).forEach(s => (s.rows||[]).forEach(r => {
      if (r.key) extra[r.key.toLowerCase().replace(/\s+/g,'_')] = r.val || '';
    }));
  } catch {}
  return extra;
}

// ── Получить контент шага из статей или fallback ─────────────
function _getFracItems(pageType, fallback) {
  const pgs = pages.filter(p => isVisiblePage(p) && p.page_type === pageType && p.status === 'published');
  if (pgs.length) {
    return pgs.map(p => {
      const ex = _parsePageExtra(p.content || '[]');
      return {
        slug: p.slug,
        name: pT(p),
        desc: ex['описание'] || ex['description'] || '',
        income_bonus: parseInt(ex['бонус_дохода'] || ex['income_bonus'] || '0', 10),
        cat: ex['категория'] || ex['category'] || '',
      };
    });
  }
  return fallback;
}

// ── Fallback данные ───────────────────────────────────────────
const _FRAC_CONCEPTS_FB = [
  { slug:'rising-empire', name:'Восходящая Империя',  desc:'Молодое агрессивное государство на подъёме. Экспансия, милитаризм, амбиции.' },
  { slug:'fallen-glory',  name:'Осколки Былой Славы', desc:'Некогда великая держава. Ресурсы есть, но дух сломлен. Реваншизм.' },
  { slug:'corporation',   name:'Корпорация',           desc:'Государство как бизнес. Прибыль превыше всего. Эффективность и цинизм.' },
];
const _FRAC_CULTURES_FB = [
  { slug:'neofeudalism',   name:'Неофеодализм',              desc:'Вассальные отношения, абсолютная власть сюзеренов, иерархия.' },
  { slug:'pan-colonialism',name:'Пан-колониализм',           desc:'Культ экспансии, присвоения ресурсов, покорения новых пространств.' },
  { slug:'indulgentionism',name:'Индульгенционизм',          desc:'Грех можно купить. Система индульгенций пронизывает всё общество.' },
  { slug:'neognosticism',  name:'Неогностицизм',             desc:'Знание — священно. Тайные общества, элитаризм, культ посвящённых.' },
  { slug:'autarchy',       name:'Автархичный изоляционизм',  desc:'Полная самодостаточность. Закрытые границы, внутренний рынок, ксенофобия.' },
  { slug:'warlords',       name:'Военачальники Нового Света', desc:'Сила решает всё. Культ личности, вассалы, беспощадная конкуренция.' },
];
const _FRAC_ACCENTS_FB = [
  { slug:'mil-space',     cat:'Вооружённые силы',  name:'Военно-космические силы',   income_bonus:50,  desc:'Господство в орбитальном пространстве.' },
  { slug:'mil-ground',    cat:'Вооружённые силы',  name:'Сухопутные войска',         income_bonus:40,  desc:'Мощная наземная армия.' },
  { slug:'mil-sof',       cat:'Вооружённые силы',  name:'Силы спецопераций',         income_bonus:60,  desc:'Элитные оперативники для точечных ударов.' },
  { slug:'intel-network', cat:'Тайные операции',   name:'Агентурная сеть',           income_bonus:70,  desc:'Разветвлённая сеть агентов и информаторов.' },
  { slug:'intel-lobby',   cat:'Тайные операции',   name:'Теневое лобби',             income_bonus:80,  desc:'Влияние через коррупцию и давление.' },
  { slug:'intel-illegal', cat:'Тайные операции',   name:'Нелегальные операции',      income_bonus:65,  desc:'Контрабанда, чёрный рынок, серые схемы.' },
  { slug:'intel-death',   cat:'Тайные операции',   name:'Эскадроны смерти',          income_bonus:55,  desc:'Устранение врагов любыми средствами.' },
  { slug:'cult-opium',    cat:'Культура',          name:'Опиум для народа',          income_bonus:60,  desc:'Контроль через развлечения и зависимости.' },
  { slug:'cult-demo',     cat:'Культура',          name:'Народовластие',             income_bonus:65,  desc:'Легитимность через выборы и представительство.' },
  { slug:'cult-unity',    cat:'Культура',          name:'Единство',                  income_bonus:70,  desc:'Монолитная идеология, сплочённость.' },
  { slug:'cult-cult',     cat:'Культура',          name:'Культ',                     income_bonus:55,  desc:'Харизматичный лидер как объект поклонения.' },
  { slug:'eco-metro',     cat:'Экономика',         name:'Метрополия',                income_bonus:100, desc:'Центр притяжения ресурсов и капитала.' },
  { slug:'eco-mining',    cat:'Экономика',         name:'Добывающая промышленность', income_bonus:85,  desc:'Контроль над сырьевыми запасами сектора.' },
  { slug:'eco-industry',  cat:'Экономика',         name:'Производственная мощность', income_bonus:90,  desc:'Заводы, верфи, арсеналы.' },
  { slug:'eco-trade',     cat:'Экономика',         name:'Торговый хаб',              income_bonus:110, desc:'Пересечение торговых маршрутов.' },
  { slug:'eco-black',     cat:'Экономика',         name:'Чёрный рынок',              income_bonus:95,  desc:'Теневая экономика приносит больше официальной.' },
  { slug:'eco-orbital',   cat:'Экономика',         name:'Орбитальная инфраструктура',income_bonus:120, desc:'Орбитальные станции, добыча астероидов.' },
];

// ── Состояние ────────────────────────────────────────────────
let _fracStep = 1;
let _fracData = {};
const _FRAC_STEPS = ['НАЗВАНИЕ','КОНЦЕПТ','КУЛЬТУРА','АКЦЕНТ','ФИНАЛ'];

// ── Открыть конструктор ───────────────────────────────────────
function openFactionConstructor() {
  if (!user) { showAuth('login'); return; }
  if (user.is_banned) { toast('Ваш аккаунт заблокирован', 'err'); return; }
  _fracStep = 1;
  _fracData = { name:'', slug:'', concept:'', culture:'', accent:'', image_url:'', description:'', exclude_from_collage:false };
  const scr = document.getElementById('faction-reg-screen');
  if (scr) { scr.style.display = 'block'; _fracRender(); }
}
function fracClose() { const s=document.getElementById('faction-reg-screen'); if(s) s.style.display='none'; }

function _fracRender() {
  const stepsEl   = document.getElementById('freg-steps');
  const contentEl = document.getElementById('freg-content');
  const actionsEl = document.getElementById('freg-actions');
  if (!stepsEl || !contentEl || !actionsEl) return;

  stepsEl.innerHTML = _FRAC_STEPS.map((s,i) => `
    <div class="creg-step ${i+1<_fracStep?'done':i+1===_fracStep?'active':''}" ${i+1<_fracStep?`onclick="_fracStep=${i+1};_fracRender()"`:''}>
      <div class="creg-step-num">${i+1<_fracStep?'✓':i+1}</div>
      <div class="creg-step-info">
        <div class="creg-step-label">${s}</div>
        ${i+1===_fracStep?'<div class="creg-step-cur">ТЕКУЩИЙ</div>':''}
      </div>
    </div>`).join('');

  const fn = [null, _fH1, _fH2, _fH3, _fH4, _fH5];
  contentEl.innerHTML = fn[_fracStep]?.() || '';

  actionsEl.innerHTML = `
    <div class="creg-act-left">
      <button class="creg-btn-back" id="freg-back-btn" onclick="_fracStep>1?_fracBack():fracClose()">
        ${_fracStep>1?'← НАЗАД':'ОТМЕНА'}
      </button>
    </div>
    <div class="creg-act-progress">${_fracStep} / ${_FRAC_STEPS.length}</div>
    <div class="creg-act-right">
      ${_fracStep < _FRAC_STEPS.length
        ? `<button class="btn btn-gd" onclick="_fracNext()">Далее →</button>`
        : `<button class="btn btn-gd" id="frac-submit" onclick="fracSubmit()">✓ Создать фракцию</button>`}
    </div>`;
}

// ── Шаги ─────────────────────────────────────────────────────
function _fH1() { return `
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 1</div>
    <div class="creg-step-title">НАЗВАНИЕ</div>
    <div class="creg-step-desc">Имя фракции — то, под чем она войдёт в историю сектора Квантор.</div>
  </div>
  <div class="creg-form">
    <div class="creg-field">
      <label class="creg-label">Название *</label>
      <input class="creg-input creg-input-lg" id="freg-name" value="${esc(_fracData.name)}"
        placeholder="Введите название..." oninput="_fracData.name=this.value;_fracAutoSlug()">
    </div>
    <div class="creg-field">
      <label class="creg-label">Слаг (URL) *</label>
      <input class="creg-input" id="freg-slug" value="${esc(_fracData.slug)}"
        placeholder="faction-slug" oninput="_fracData.slug=slugify(this.value);this.value=_fracData.slug">
      <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:rgba(255,255,255,.3);margin-top:4px">Заполняется автоматически. Изменить нельзя после создания.</div>
    </div>
    <div class="creg-field">
      <label class="creg-label">Обложка</label>
      <div style="display:flex;gap:8px">
        <input class="creg-input" id="freg-img" value="${esc(_fracData.image_url)}"
          placeholder="https://..." style="flex:1" oninput="_fracData.image_url=this.value;_fracImgPreview()">
        <label class="creg-upload-btn" style="cursor:pointer">📁<input type="file" accept="image/*" style="display:none" onchange="fracImgUpload(this)"></label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-top:8px">
        <input type="checkbox" id="freg-exclude-collage" ${_fracData.exclude_from_collage?'checked':''} onchange="_fracData.exclude_from_collage=this.checked" style="cursor:pointer">
        <span style="font-size:12px;color:rgba(255,255,255,.5)">Не показывать в коллаже главной</span>
      </label>
    </div>
    ${_fracData.image_url
      ? `<div class="creg-img-preview"><img src="${esc(_fracData.image_url)}" style="width:100%;max-height:200px;object-fit:cover;display:block"><div class="creg-img-overlay"></div></div>`
      : `<div class="creg-img-empty">◈ &nbsp; НЕТ ОБЛОЖКИ</div>`}
  </div>`; }

function _fH2() {
  const items = _getFracItems('faction_concept', _FRAC_CONCEPTS_FB);
  const fromPages = pages.some(p=>p.page_type==='faction_concept');
  return `
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 2</div>
    <div class="creg-step-title">КОНЦЕПТ</div>
    <div class="creg-step-desc">Отражает историю государства: внешнеполитическую, экономическую и военную составляющие.</div>
    ${!fromPages?'<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:rgba(168,105,44,.4);margin-top:8px">◈ Создайте статьи с page_type=faction_concept для кастомных концептов</div>':''}
  </div>
  <div class="creg-class-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
    ${items.map(c => `
      <div class="creg-class-card ${_fracData.concept===c.slug?'sel':''}" onclick="_fracData.concept='${esc(c.slug)}';_fracRender()">
        ${c.image_url?`<img src="${esc(c.image_url)}" style="width:100%;height:80px;object-fit:cover;margin-bottom:8px">` : ''}
        <div class="creg-cc-name">${esc(c.name)}</div>
        <div class="creg-cc-desc">${esc(c.desc)}</div>
        ${_fracData.concept===c.slug?'<div class="creg-cc-sel-mark">✓ ВЫБРАНО</div>':''}
      </div>`).join('')}
  </div>`; }

function _fH3() {
  const items = _getFracItems('faction_culture', _FRAC_CULTURES_FB);
  const fromPages = pages.some(p=>p.page_type==='faction_culture');
  return `
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 3</div>
    <div class="creg-step-title">КУЛЬТУРА</div>
    <div class="creg-step-desc">Отражает общественные процессы, идеологию и культурное наследие фракции.</div>
    ${!fromPages?'<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:rgba(168,105,44,.4);margin-top:8px">◈ Создайте статьи с page_type=faction_culture для кастомных культур</div>':''}
  </div>
  <div class="creg-class-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
    ${items.map(c => `
      <div class="creg-class-card ${_fracData.culture===c.slug?'sel':''}" onclick="_fracData.culture='${esc(c.slug)}';_fracRender()">
        <div class="creg-cc-name">${esc(c.name)}</div>
        <div class="creg-cc-desc">${esc(c.desc)}</div>
        ${_fracData.culture===c.slug?'<div class="creg-cc-sel-mark">✓ ВЫБРАНО</div>':''}
      </div>`).join('')}
  </div>`; }

function _fH4() {
  const all = _getFracItems('faction_accent', _FRAC_ACCENTS_FB);
  const cats = {};
  all.forEach(a => { if (!cats[a.cat||'Прочее']) cats[a.cat||'Прочее']=[]; cats[a.cat||'Прочее'].push(a); });
  const fromPages = pages.some(p=>p.page_type==='faction_accent');
  return `
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 4</div>
    <div class="creg-step-title">АКЦЕНТ</div>
    <div class="creg-step-desc">Текущий политический курс. Определяет еженедельный бонус к доходу всех участников фракции.</div>
    ${!fromPages?'<div style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:rgba(168,105,44,.4);margin-top:8px">◈ Создайте статьи с page_type=faction_accent для кастомных акцентов</div>':''}
  </div>
  ${Object.entries(cats).map(([cat, items]) => `
    <div style="margin-bottom:24px">
      <div style="font-family:'Orbitron',sans-serif;font-size:9px;font-weight:700;letter-spacing:3px;color:rgba(168,105,44,.6);text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(168,105,44,.15)">${esc(cat)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
        ${items.map(a => `
          <div class="creg-class-card ${_fracData.accent===a.slug?'sel':''}" onclick="_fracData.accent='${esc(a.slug)}';_fracRender()">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
              <div class="creg-cc-name" style="font-size:9px">${esc(a.name)}</div>
              <div style="font-family:'Orbitron',sans-serif;font-size:11px;font-weight:900;color:var(--gdl);white-space:nowrap;margin-left:8px">+${a.income_bonus} ЭК</div>
            </div>
            <div class="creg-cc-desc">${esc(a.desc)}</div>
            ${_fracData.accent===a.slug?'<div class="creg-cc-sel-mark">✓ ВЫБРАНО</div>':''}
          </div>`).join('')}
      </div>
    </div>`).join('')}`; }

function _fH5() {
  const allAccents = _getFracItems('faction_accent', _FRAC_ACCENTS_FB);
  const accent = allAccents.find(a=>a.slug===_fracData.accent) || {};
  const incomePer = accent.income_bonus || 0;
  const allConcepts = _getFracItems('faction_concept', _FRAC_CONCEPTS_FB);
  const allCultures = _getFracItems('faction_culture', _FRAC_CULTURES_FB);
  const conceptName = allConcepts.find(c=>c.slug===_fracData.concept)?.name || '—';
  const cultureName = allCultures.find(c=>c.slug===_fracData.culture)?.name || '—';
  const accentName  = accent.name || '—';
  return `
  <div class="creg-step-header">
    <div class="creg-step-eyebrow">ШАГ 5</div>
    <div class="creg-step-title">ФИНАЛ</div>
  </div>
  <div class="creg-summary">
    <div class="creg-sum-left">
      ${_fracData.image_url
        ? `<img src="${esc(_fracData.image_url)}" class="creg-sum-avatar">`
        : `<div class="creg-sum-avatar-ph">${esc(_fracData.name||'?').slice(0,2).toUpperCase()}</div>`}
      <div class="creg-sum-id">
        <div class="creg-sum-name">${esc(_fracData.name||'—')}</div>
        <div class="creg-sum-role">${esc(_fracData.slug||'')}</div>
      </div>
    </div>
    <div class="creg-sum-stats">
      <div class="creg-sum-stat"><span class="creg-sum-stat-k">Концепт</span><span class="creg-sum-stat-v" style="font-size:11px">${esc(conceptName)}</span></div>
      <div class="creg-sum-stat"><span class="creg-sum-stat-k">Культура</span><span class="creg-sum-stat-v" style="font-size:11px">${esc(cultureName)}</span></div>
      <div class="creg-sum-stat"><span class="creg-sum-stat-k">Акцент</span><span class="creg-sum-stat-v" style="font-size:11px">${esc(accentName)}</span></div>
      <div class="creg-sum-stat"><span class="creg-sum-stat-k">Бонус участникам</span><span class="creg-sum-stat-v gold">+${incomePer} ЭК/нед</span></div>
    </div>
  </div>
  <div class="creg-field" style="margin-top:20px">
    <label class="creg-label">Описание фракции</label>
    <textarea class="creg-input creg-textarea" id="freg-desc" placeholder="Краткое описание..." oninput="_fracData.description=this.value">${esc(_fracData.description)}</textarea>
  </div>`; }

// ── Навигация ────────────────────────────────────────────────
function _fracNext() {
  if (_fracStep===1 && !_fracData.name.trim()) { toast('Введите название фракции','err'); return; }
  if (_fracStep===1 && !_fracData.slug.trim()) { toast('Слаг обязателен','err'); return; }
  if (_fracStep===2 && !_fracData.concept)     { toast('Выберите концепт','err'); return; }
  if (_fracStep===3 && !_fracData.culture)     { toast('Выберите культуру','err'); return; }
  if (_fracStep===4 && !_fracData.accent)      { toast('Выберите акцент','err'); return; }
  _fracStep = Math.min(_FRAC_STEPS.length, _fracStep+1); _fracRender();
}
function _fracBack()     { _fracStep = Math.max(1, _fracStep-1); _fracRender(); }
function _fracAutoSlug() {
  if (_fracData.slug) return;
  const el = document.getElementById('freg-slug');
  if (el) el.value = _fracData.slug = slugify(_fracData.name);
}
function _fracImgPreview() { _fracRender(); }
async function fracImgUpload(input) {
  const f = input?.files?.[0]; if (!f) return;
  await handleImgUpload(f, url => { _fracData.image_url = url; _fracRender(); });
}

// ── Создание фракции ──────────────────────────────────────────
async function fracSubmit() {
  const btn = document.getElementById('frac-submit'); if (btn) btn.disabled = true;
  const name = _fracData.name.trim();
  const slug = _fracData.slug.trim();
  if (!name || !slug) { toast('Заполните название и слаг','err'); if(btn)btn.disabled=false; return; }

  // ── Проверка дублей ──────────────────────────────────────
  if (pages.find(p => p.slug === slug)) {
    toast(`Страница со слагом «${slug}» уже существует`,'err'); if(btn)btn.disabled=false; return;
  }
  try {
    const existing = await dbGet('factions', `slug=eq.${encodeURIComponent(slug)}&select=slug&limit=1`);
    if (existing?.length) { toast('Фракция с таким слагом уже существует','err'); if(btn)btn.disabled=false; return; }
    const existingName = await dbGet('factions', `name=eq.${encodeURIComponent(name)}&select=slug&limit=1`);
    if (existingName?.length) { toast('Фракция с таким названием уже существует','err'); if(btn)btn.disabled=false; return; }
  } catch {}

  const allAccents = _getFracItems('faction_accent', _FRAC_ACCENTS_FB);
  const accent = allAccents.find(a => a.slug === _fracData.accent) || {};
  const incomePer = accent.income_bonus || 0;
  const now = new Date().toISOString();

  // ── parent_slug = 'gosudarstva' — страница Государства ───
  const parentPage = pages.find(p => p.slug === 'gosudarstva');
  const charSection = parentPage?.section || null;

  try {
    // 1. Создать страницу фракции
    await dbPost('pages', {
      slug, title: name, title_ru: name,
      content: JSON.stringify([{
        type: 'text', id: uid(),
        content: _fracData.description || '',
      }]),
      page_type: 'faction',
      status: 'published',
      image_url: _fracData.image_url || null,
      exclude_from_collage: _fracData.exclude_from_collage || false,
      section: charSection,
      parent_slug: 'gosudarstva',
      created_by: user.email,
      created_at: now, updated_at: now,
    });

    // 2. Запись в таблицу factions
    const token = await getTokenFresh();
    await fetch(`${SB_URL}/rest/v1/factions`, {
      method: 'POST',
      headers: { 'apikey':SB_ANON, 'Authorization':'Bearer '+token, 'Content-Type':'application/json', 'Prefer':'return=minimal' },
      body: JSON.stringify({
        slug, name,
        concept:  _fracData.concept,
        culture:  _fracData.culture,
        accent:   _fracData.accent,
        income_bonus_per_member: incomePer,
        image_url: _fracData.image_url || null,
        description: _fracData.description || '',
        owner_email: user.email,
        created_at: now, updated_at: now,
      }),
    });

    fracClose();
    await loadPgs(); buildNav();
    go(slug, false);
    toast(`✓ Фракция «${name}» создана! Бонус участникам: +${incomePer} ЭК/нед`, 'ok');
  } catch(e) {
    toast('Ошибка: ' + e.message, 'err');
    if (btn) btn.disabled = false;
  }
}

// ── Бонус фракции к зарплате ──────────────────────────────────
async function getFactionIncomeBonusForChar(charFaction) {
  if (!charFaction) return 0;
  try {
    const r = await dbGet('factions', `name=eq.${encodeURIComponent(charFaction)}&select=income_bonus_per_member&limit=1`);
    return r?.[0]?.income_bonus_per_member || 0;
  } catch { return 0; }
}
