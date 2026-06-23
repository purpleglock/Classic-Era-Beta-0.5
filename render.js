// ════════════════════════════════════════════════════════════
// RENDER — home, page, section, blocks, markdown, nav
// ════════════════════════════════════════════════════════════

async function renderHome() {
  if (!_pgCache.has('home')) await loadHomePage();
  let customHtml = '';
  const homePg = _pgCache.get('home');
  if (homePg?.content) { try { const parsed = JSON.parse(homePg.content); if (Array.isArray(parsed) && parsed.length) { customHtml = `<div class="home-custom-blocks">${parsed.map(renderBlock).join('')}</div>`; } } catch {} }

  const topSecs = sections.filter(s=>!s.parent_id).sort((a,b)=>a.sort_order-b.sort_order);
  const strips = topSecs.map(sec => {
    const subSecs = sections.filter(s=>s.parent_id===sec.id);
    const cnt = pages.filter(p=>isVisiblePage(p)&&(p.section===sec.slug||subSecs.some(s=>s.slug===p.section))).length;
    if (!cnt && !user) return '';
    const imgUrl = sec.image_url || 'https://images.unsplash.com/photo-1614729939124-03290b5609ce?q=80&w=800&auto=format&fit=crop';
    const secName = esc(sN(sec));
    const iconHtml = sec.icon && sec.icon.startsWith('http')
      ? `<img src="${esc(sec.icon)}" alt="">`
      : `<span class="st-glyph">${esc(sec.icon||'◇')}</span>`;
    return `<a class="sec-tile" onclick="go('sec:${esc(sec.slug)}')">
      <div class="st-media"><img src="${esc(imgUrl)}" loading="lazy" alt=""></div>
      <div class="st-scrim"></div>
      <div class="st-top"><span class="st-ico">${iconHtml}</span><span class="st-count">${esc(String(cnt).padStart(2,'0'))}</span></div>
      <div class="st-foot">
        <span class="st-name">${secName}</span>
        <span class="st-meta">${cnt}&nbsp;${T('articles')}</span>
      </div>
      <div class="st-edge"></div>
    </a>`;
  }).filter(Boolean).join('');

  const sorted = [...pages].filter(isVisiblePage).sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0)).slice(0,10);
  const clRows = sorted.map(p => {
    const isNew = Math.abs(new Date(p.updated_at||0)-new Date(p.created_at||0))<60000;
    const sec2 = p.section ? sections.find(s=>s.slug===p.section) : null;
    const authorName = userLabel(p.created_by||'');
    return `<div class="cl-row" onclick="go('${esc(p.slug)}')"><span class="cl-type ${isNew?'ct-new':'ct-edit'}">${isNew?T('new_tag'):T('edit_tag')}</span><div class="cl-info"><span class="cl-title">${esc(pT(p))}</span><span class="cl-author">✍ ${esc(authorName)}</span></div>${sec2 ? `<span class="cl-sec-tag">${esc(sN(sec2))}</span>` : ''}<span class="cl-date">${timeAgo(p.updated_at)}</span></div>`;
  }).join('');

  const contribMap = {}; pages.filter(isVisiblePage).forEach(p=>{ if(p.created_by) contribMap[p.created_by]=(contribMap[p.created_by]||0)+1; });
  allProfiles.forEach(prof=>{ if(prof.email && !contribMap[prof.email]) contribMap[prof.email]=0; });
  const sortedContribs = Object.entries(contribMap).sort((a,b)=>b[1]-a[1]);
  const maxCnt = Math.max(100, sortedContribs.length ? sortedContribs[0][1] : 1);
  const contribsHtml = sortedContribs.length ? `<section class="home-block hp-contribs"><div class="hb-head"><span class="hb-tag">${T('contributors')}</span></div><div class="contrib-grid">${sortedContribs.map(([email, cnt], idx) => {
    const rank = idx + 1;
    const rankClass = rank <= 3 ? ` rank-${rank}` : '';
    const emailAttr = esc(email).replace(/'/g,'&#39;'); const name = email.includes('@') ? email.split('@')[0] : email; const hue = [...email].reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
    const prof = getProfileOf(email); const displayName = prof.display_name || name; const avUrl = prof.avatar_url || '';
    const avHtml = avUrl ? `<img src="${esc(avUrl)}" loading="lazy">` : `<span style="font-size:20px;font-family:Rajdhani,sans-serif;font-weight:900;color:hsl(${hue},60%,72%)">${esc(displayName.slice(0,2).toUpperCase())}</span>`;
    const barPct = Math.min(100, Math.round((cnt / 100) * 100));
    const rankNumHtml = rank <= 9 ? `<div class="contrib-rank-num">${rank}</div>` : '';
    const tier = Math.min(Math.floor(cnt / 5), 20);
    const tierHue = (hue + tier * 12) % 360;
    const tierSat = Math.min(22 + tier * 2.5, 60);
    const tierLight = Math.min(12 + tier * 0.8, 24);
    const tierBorderSat = Math.min(30 + tier * 3, 70);
    const tierBorderLight = Math.min(20 + tier * 2, 45);
    const tierGlow = tier >= 4 ? `box-shadow: 0 0 ${tier * 2.5}px hsla(${tierHue}, ${tierSat + 20}%, 50%, ${Math.min(tier * 0.035, 0.4)}), inset 0 0 ${tier * 3}px hsla(${tierHue}, ${tierSat}%, 30%, ${Math.min(tier * 0.02, 0.15)});` : '';
    const barHue = (tierHue + 10) % 360;
    const barSat = Math.min(40 + tier * 3, 80);
    const barLight = Math.min(45 + tier * 1.5, 65);
    return `<div class="contrib-card${rankClass}" onclick="openContribModal('${emailAttr}','${esc(displayName).replace(/'/g,'&#39;')}','${esc(avUrl).replace(/'/g,'&#39;')}',${hue},${cnt})" title="Посмотреть профиль" style="background:linear-gradient(145deg, hsl(${tierHue},${tierSat}%,${tierLight}%) 0%, hsl(${tierHue},${tierSat - 4}%,${tierLight - 3}%) 100%); border-color:hsl(${tierHue},${tierBorderSat}%,${tierBorderLight}%); ${tierGlow}"><div class="contrib-scan"></div><div class="contrib-card-top"><div class="contrib-av-wrap"><div class="contrib-av" style="background:linear-gradient(135deg, hsl(${tierHue},${tierSat + 5}%,${tierLight + 4}%) 0%, hsl(${tierHue},${tierSat}%,${tierLight}%) 100%);border-color:hsl(${tierHue},${tierBorderSat + 10}%,${tierBorderLight + 8}%)">${avHtml}</div><div class="contrib-av-ring" style="color:hsl(${tierHue},${tierSat + 25}%,${50 + tier * 1.5}%)"></div>${rankNumHtml}</div><div class="contrib-card-info"><div class="contrib-name">${esc(displayName)}</div></div></div><div class="contrib-card-bottom"><div class="contrib-stat-bar"><div class="contrib-stat-fill" style="width:${barPct}%; background:linear-gradient(90deg, hsl(${barHue},${barSat}%,${barLight}%) 0%, hsl(${barHue},${barSat + 10}%,${barLight + 8}%) 100%); box-shadow: 0 0 ${tier * 1.5}px hsla(${barHue}, ${barSat}%, ${barLight}%, ${Math.min(tier * 0.05, 0.6)});"></div></div><div class="contrib-cnt">${cnt}&nbsp;СТР</div></div></div>`;
  }).join('')}</div></section>` : '';

  // ── Единая обложка главной (одно изображение) ──
  const heroHtml = buildHero(_heroCoverUrl, user);

  const sectionsHtml = strips ? `<section class="home-block"><div class="hb-head"><span class="hb-tag">${T('sections')}</span></div><div class="sec-grid">${strips}</div></section>` : `<p class="hp-empty-note">${user?'Создайте разделы и статьи.':'Войдите для редактирования.'}</p>`;

  // ── Вестник фракций: одобренные новости ──
  let newsHtml = '';
  if (typeof fnLoadApproved === 'function') {
    try { await fnLoadApproved(); newsHtml = fnHomeBlockHtml(); } catch (e) { newsHtml = ''; }
  }

  setPg(`${heroHtml}${customHtml}${newsHtml}${sectionsHtml}${clRows ? `<section class="home-block"><div class="hb-head"><span class="hb-tag">${T('recentChanges')}</span></div><div class="cl-list">${clRows}</div></section>` : ''}${contribsHtml}`);

  // Биржевая бегущая лента в «Ленте сектора» — дозаполняем асинхронно (не блокирует главную)
  if (typeof fnLoadCorpTicker === 'function') fnLoadCorpTicker();

  // Клик по обложке открывает изображение в полном размере
  requestAnimationFrame(() => {
    const heroImg = document.querySelector('#hp-hero-cover .hp-hero-img');
    if (heroImg && heroImg.getAttribute('data-img-url')) {
      heroImg.style.cursor = 'pointer';
      heroImg.addEventListener('click', () => openCollageImageModal(heroImg.getAttribute('data-img-url')));
    }
  });
}

async function renderPage(pg) {
  if (pg.page_type === 'character') { renderCharacterPage(pg); return; }
  if (pg.page_type === 'item')      { renderItemPage(pg);      return; }
  if (pg.page_type === 'preview')   { renderPreviewPage(pg);   return; }
  if (pg.page_type === 'preview-weapon') { 
    const kids = pages.filter(p => isVisiblePage(p) && p.parent_slug === pg.slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    let blocks = [];
    try { blocks = JSON.parse(pg.content || '[]'); } catch(e) {}
    const otherBlocks = blocks.filter(b => b.type !== 'infobox');
    renderWeaponPreviewPage(pg, kids, otherBlocks); 
    return; 
  }
  if (pg.page_type === 'preview-armor')  { 
    const kids = pages.filter(p => isVisiblePage(p) && p.parent_slug === pg.slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    let blocks = [];
    try { blocks = JSON.parse(pg.content || '[]'); } catch(e) {}
    const otherBlocks = blocks.filter(b => b.type !== 'infobox');
    renderArmorPreviewPage(pg, kids, otherBlocks); 
    return; 
  }
  if (pg.page_type === 'ability') {
    if (typeof renderAbilityPage === 'function') { renderAbilityPage(pg); }
    else { _renderAbilityPageInline(pg); }
    return;
  }
  if (pg.page_type === 'faction')   { renderFactionPage(pg);   return; }
  if (pg.page_type === 'unit')       { await renderUnitPage(pg); return; }
  if (pg.page_type === 'location')   { renderLocationPage(pg);  return; }
  const kids = pages.filter(p => isVisiblePage(p) && p.parent_slug === pg.slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const sec  = sections.find(s=>s.slug===pg.section);
  const isDraft = pg.status === 'draft';
  const canEdit = user && ['superadmin','editor','moderator'].includes(user.role);
  
  const covH = pg.cover_height || 340;
  const covPos = pg.cover_pos || 'center center';
  const titleHtml = `${esc(pT(pg))}${isDraft ? `<span class="art-draft-tag">${T('draft')}</span>` : ''}`;
  const cover = pg.image_url
    ? `<div class="art-cov" data-cover-type="${pg.cover_type||'standard'}" style="--cov-h:${covH}px;--cov-pos:${covPos}"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${titleHtml}</h1></div></div><div class="art-cov-spacer"></div>`
    : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${titleHtml}</h1></div>`;
  const content = pC(pg);
  const wrapDraft = (inner) => isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК — ДОКУМЕНТ НЕ ЗАВЕРШЁН</div><div class="scp-redact-wrap"><div class="scp-redact-inner">${inner}</div></div>` : inner;

  if (kids.length > 0) {
    const grid = kids.some(k=>k.image_url) ? `<div class="cgrid">${kids.map(mkCard).join('')}</div>` : `<div class="flat-grid">${kids.map(k=>`<div class="flat-row" onclick="go('${esc(k.slug)}')">${esc(pT(k))}</div>`).join('')}</div>`;
    setPg(`${cover}${wrapDraft(grid+(content?`<div class="prose">${renderBlocks(content)}</div>`:''))}`);
    renderCommentsSection(pg.slug);
  } else {
    setPg(`${cover}${wrapDraft(`<div class="prose">${renderBlocks(content)}</div>`)}`);
    renderCommentsSection(pg.slug);
  }
}
// ── Локация: форумная RP-страница, доступная только игрокам ──
function renderLocationPage(pg) {
  // Закрытый экран для не-игроков (зрители/гости)
  if (typeof canSeeLocations === 'function' && !canSeeLocations()) {
    setPg(`<div class="loc-gate">
      <div class="loc-gate-ico">⛬</div>
      <div class="loc-gate-title">ЗАКРЫТАЯ ЗОНА</div>
      <div class="loc-gate-sub">Локации доступны только участникам игры. Получите роль игрока, зарегистрировав государство.</div>
      ${typeof user !== 'undefined' && user ? `<button class="btn btn-gd" onclick="go('factions')">⬡ К фракциям</button>` : `<button class="btn btn-gd" onclick="showAuth('login')">Войти</button>`}
    </div>`);
    return;
  }
  const isDraft = pg.status === 'draft';
  const covH = pg.cover_height || 340;
  const covPos = pg.cover_pos || 'center center';
  const badge = `<div class="loc-badge">📍 ЛОКАЦИЯ · только для игроков</div>`;
  const titleHtml = `${esc(pT(pg))}${isDraft ? `<span class="art-draft-tag">${T('draft')}</span>` : ''}`;
  const cover = pg.image_url
    ? `<div class="art-cov loc-cov" data-cover-type="${pg.cover_type||'standard'}" style="--cov-h:${covH}px;--cov-pos:${covPos}"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot">${badge}<h1 class="art-h1">${titleHtml}</h1></div></div><div class="art-cov-spacer"></div>`
    : `<div class="art-page-header art-page-header--nocov">${badge}<h1 class="art-h1">${titleHtml}</h1></div>`;
  // Разбираем блоки: инфобокс -> модульное «досье планеты» (HUD-панель с
  // секциями), остальное -> описание. Не используем плавающую вики-карточку.
  let blocks = [];
  try { blocks = JSON.parse(pC(pg) || '[]'); } catch (e) {}
  const infobox = blocks.find(b => b && b.type === 'infobox');
  const otherBlocks = blocks.filter(b => b && b.type !== 'infobox');
  const LOC_ICONS = {
    'сектор':'⬡', 'система':'☀', 'звезда':'★', 'владелец':'⚑', 'контроль':'⚑',
    'опасность':'⚠', 'статус':'◉', 'регион':'🜨', 'координаты':'✦', 'тип мира':'🜨',
    'освоение':'⛬', 'население':'☉', 'климат':'❂', 'столица':'⛨', 'правитель':'♛',
    'язык':'✎', 'религия':'☥', 'фракция':'⬡', 'столичный град':'⛫', 'достопримечательности':'❖',
  };
  let dossier = '';
  if (infobox) {
    const isCap = pg.slug && pg.slug.indexOf('loc-cap-') === 0;
    const groups = [];
    (infobox.sections || []).forEach(s => {
      const cells = (s.rows || []).filter(r => r && r.key).map(r => {
        const ic = LOC_ICONS[(r.key || '').toLowerCase().trim()] || '◈';
        const val = (r.val || '').trim();
        return `<div class="loc-dcell${val ? '' : ' empty'}">
          <span class="loc-dcell-ic">${ic}</span>
          <span class="loc-dcell-txt"><span class="loc-dcell-k">${esc(r.key)}</span><span class="loc-dcell-v">${val ? esc(val) : '—'}</span></span>
        </div>`;
      });
      if (!cells.length) return;
      const gname = (s.name || '').trim();
      const gt = gname && gname.toLowerCase() !== 'основное'
        ? `<div class="loc-dgroup-t"><span></span>${esc(gname)}<span></span></div>` : '';
      groups.push(`<div class="loc-dgroup">${gt}<div class="loc-dcells">${cells.join('')}</div></div>`);
    });
    if (groups.length) {
      dossier = `<div class="loc-dossier-panel">
        <div class="loc-dhud loc-dhud-tl"></div><div class="loc-dhud loc-dhud-tr"></div>
        <div class="loc-dhud loc-dhud-bl"></div><div class="loc-dhud loc-dhud-br"></div>
        <div class="loc-dossier-head">
          <span class="loc-dossier-head-ic">🪐</span>
          <span class="loc-dossier-head-t">${isCap ? 'ДОСЬЕ СТОЛИЧНОГО МИРА' : 'ДОСЬЕ ЛОКАЦИИ'}</span>
          <span class="loc-dossier-head-line"></span>
          <span class="loc-dossier-head-sub">${esc(pT(pg))}</span>
        </div>
        ${groups.join('')}
      </div>`;
    }
  }
  const descHtml = otherBlocks.length
    ? `<div class="prose loc-desc">${otherBlocks.map(renderBlock).join('')}</div>`
    : '';
  // Панель инструментов локации (кнопка редактирования) — для всех локаций
  const capTools = `<div id="loc-cap-tools"></div>`;
  setPg(`${cover}${capTools}${dossier}${descHtml}`);
  // Кнопки добавляем асинхронно (проверка владельца/стаффа)
  if (typeof locMaybeAddCapEditBtn === 'function') locMaybeAddCapEditBtn(pg);
  // Лента отыгрыша — через движок комментариев в «режиме локации»
  renderCommentsSection(pg.slug);
}

// Fallback — на случай если renderAbilityPage ещё не объявлена
function _renderAbilityPageInline(pg) {
  const isDraft = pg.status === 'draft';
  const canEdit = user && ['superadmin','editor','moderator'].includes(user.role);
  if (isDraft && !canEdit) { setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div></div>`); return; }
  let extra = {}; let hasInfobox = false; let otherBlocks = [];
  try {
    const blocks = JSON.parse(pg.content || '[]');
    const ib = blocks.find(b => b.type === 'infobox');
    otherBlocks = blocks.filter(b => b.type !== 'infobox');
    if (ib) { hasInfobox = true; (ib.sections||[]).forEach(s=>(s.rows||[]).forEach(r=>{ if(r.key){extra[r.key.toLowerCase().replace(/\s+/g,'_')]=r.val||'';extra[r.key.toLowerCase().trim()]=r.val||'';} })); }
  } catch(e) {}
  if (!hasInfobox) {
    const cover = pg.image_url
      ? `<div class="art-cov" style="--cov-h:${pg.cover_height||340}px;--cov-pos:center center"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${esc(pT(pg))}</h1></div></div><div class="art-cov-spacer"></div>`
      : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${esc(pT(pg))}</h1></div>`;
    setPg(`${cover}<div class="prose">${renderBlocks(pC(pg))}</div>`);
    renderCommentsSection(pg.slug); return;
  }
  const ABTYPES = { passive:{ru:'Пассивная',c:'#1f8fd8'}, action:{ru:'Действие',c:'#2d9fd8'}, bonus:{ru:'Бонусное',c:'#3db855'}, reaction:{ru:'Реакция',c:'#d83040'}, '1/day':{ru:'1/День',c:'#9040e8'}, '1/rest':{ru:'1/Отдых',c:'#d86828'} };
  const type = (extra['тип']||extra['type']||'passive').toLowerCase();
  const AT = ABTYPES[type] || ABTYPES.passive;
  const range = extra['дальность']||extra['range']||'';
  const cost = extra['стоимость']||extra['cost']||'';
  const effect = extra['эффект']||extra['effect']||'';
  const desc = extra['описание']||extra['description']||'';
  const trigger = extra['триггер']||extra['trigger']||'';
  const immunities = (extra['иммунитеты']||extra['immunities']||'').split(',').map(s=>s.trim()).filter(Boolean);
  const SKEYS = [['бонус_кз','КЗ'],['бонус_сил','СИЛ'],['бонус_лов','ЛОВ'],['бонус_тел','ТЕЛ'],['бонус_инт','ИНТ'],['бонус_мдр','МДР'],['бонус_хар','ХАР']];
  const bonuses = SKEYS.map(([k,l])=>extra[k]&&extra[k]!=='0'?[l,(parseFloat(extra[k])>=0?'+':'')+extra[k]]:null).filter(Boolean);
  const iconUrl = pg.image_url || (typeof getAbilityIconUrl==='function' ? getAbilityIconUrl(pT(pg)) : null);
  const statItems = [range&&{k:'Дальность',v:range}, cost&&{k:'Стоимость',v:cost}, trigger&&{k:'Триггер',v:trigger}, ...bonuses.map(([k,v])=>({k,v,accent:true})), ...immunities.map(im=>({k:'Иммунитет',v:im}))].filter(Boolean);
  const draftBanner = isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК</div>` : '';
  setPg(`${draftBanner}<div class="abx-page" style="--tc:${AT.c}"><div class="abx-card"><div class="abx-bolts abx-bolt-tl"></div><div class="abx-bolts abx-bolt-tr"></div><div class="abx-bolts abx-bolt-bl"></div><div class="abx-bolts abx-bolt-br"></div>${iconUrl?`<div class="abx-image-side"><img src="${esc(iconUrl)}" loading="eager" onclick="openLightbox('${esc(iconUrl)}','${esc(pT(pg))}');return false;" alt="${esc(pT(pg))}"><div class="abx-image-mask"></div></div>`:'<div class="abx-image-side" style="background:#1f1812"></div>'}<div class="abx-content-side"><div class="abx-type" style="border-color:${AT.c};color:${AT.c}">${AT.ru.toUpperCase()}</div><h1 class="abx-name">${esc(pT(pg))}</h1><div class="abx-divider"></div>${effect?`<div class="abx-effect" style="border-left-color:${AT.c}">${esc(effect)}</div>`:''} ${desc?`<p class="abx-desc">${esc(desc)}</p>`:''} ${otherBlocks.length?`<div class="prose abx-blocks">${otherBlocks.map(renderBlock).join('')}</div>`:''} ${statItems.length?`<div class="abx-stats">${statItems.map(s=>`<div class="abx-stat-item"><span class="abx-stat-k">${esc(s.k)}</span><span class="abx-stat-v"${s.accent?` style="color:${AT.c}"`:''}>${esc(s.v)}</span></div>`).join('')}</div>`:''}</div></div></div>`);
  renderCommentsSection(pg.slug);
}

const _previewState = {};

function _pvNorm(v) {
  return String(v || '').trim().toLowerCase();
}

function _pvFormatNum(v) {
  const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return String(v || '').trim();
  return n.toLocaleString('ru-RU');
}

function _pvNum(v) {
  const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function _pvDisplayTerm(k, v) {
  const key = _pvNorm(k);
  const val = _pvNorm(v);
  const dictCommon = {
    common: 'Обычный',
    uncommon: 'Необычный',
    rare: 'Редкий',
    epic: 'Эпический',
    legendary: 'Легендарный',
    weapon: 'Оружие',
    armor: 'Броня',
    helmet: 'Шлем',
    ring: 'Кольцо',
    artifact: 'Артефакт',
    consumable: 'Расходник',
    conventional: 'Конвенциональная',
    kinetic: 'Кинетический',
    thermal: 'Термический',
    laser: 'Лазерный',
    plasma: 'Плазменный',
    smg: 'ПП',
    shotgun: 'Дробовик',
    rifle: 'Винтовка',
    sniper: 'Снайперская',
    pistol: 'Пистолет',
    heavy: 'Тяжёлое'
  };
  if (key === 'цена' || key === 'стоимость' || key === 'price' || key === 'cost') {
    const formatted = _pvFormatNum(v);
    return /\bэк\b/i.test(String(v)) ? formatted : `${formatted} ЭК`;
  }
  return dictCommon[val] || String(v || '').trim();
}

function _pvPrettyKey(k) {
  const key = _pvNorm(k);
  const m = {
    'цена':'Цена',
    'стоимость':'Стоимость',
    'слот':'Слот',
    'класс оружия':'Класс оружия',
    'тип технологии':'Тип технологии',
    'тип урона':'Тип урона',
    'темп стрельбы':'Темп стрельбы',
    'дальность':'Дальность',
    'калибр':'Калибр',
    'вес':'Вес',
    'редкость':'Редкость',
    'подвид':'Подвид'
  };
  if (m[key]) return m[key];
  return key ? key[0].toUpperCase() + key.slice(1) : '';
}

function _pvRowsFromPage(pg) {
  try {
    const blocks = JSON.parse(pg.content || '[]');
    const ib = blocks.find(b => b.type === 'infobox');
    const rows = [];
    (ib?.sections || []).forEach(sec => {
      (sec.rows || []).forEach(r => {
        const key = ((lang === 'en' && r.key_en?.trim()) ? r.key_en : r.key || '').trim();
        const val = ((lang === 'en' && r.val_en?.trim()) ? r.val_en : r.val || '').trim();
        if (key && val) rows.push([key, val]);
      });
    });
    return rows;
  } catch {
    return [];
  }
}

function _pvSubtype(rows, pageType) {
  const m = new Map(rows.map(([k,v]) => [_pvNorm(k), String(v || '').trim()]));
  if (pageType === 'item') {
    return _pvDisplayTerm('subtype', m.get('слот') || m.get('класс оружия') || m.get('тип технологии') || m.get('тип урона') || '');
  }
  if (pageType === 'unit') {
    return _pvDisplayTerm('subtype', m.get('класс') || m.get('тип') || '');
  }
  if (pageType === 'ability') {
    return _pvDisplayTerm('subtype', m.get('тип') || '');
  }
  return '';
}

function _pvPickSpecs(rows, pageType, subtype) {
  const priByType = {
    item: ['Слот','Класс оружия','Тип технологии','Тип урона','Урон','Темп стрельбы','Дальность','Вес','Цена','Стоимость','Калибр','Требования'],
    unit: ['Класс','Масса','Мощность','Скорость','Экипаж','Вместимость','Габарит','Орудий','Цена','Стоимость','Статус'],
    ability: ['Тип','Дальность','Стоимость','Эффект','Иммунитеты'],
    character: ['Класс','Фракция','Уровень','Роль','Статус']
  };
  const pri = priByType[pageType] || ['Тип','Класс','Роль','Статус','Стоимость'];
  const out = [];
  const used = new Set();
  const push = (k, v) => {
    const kk = _pvNorm(k);
    if (!kk || !v || used.has(kk)) return;
    used.add(kk);
    out.push([k, _pvDisplayTerm(k, v)]);
  };
  if (subtype) push(lang === 'en' ? 'Subtype' : 'Подвид', subtype);
  for (const p of pri) {
    const hit = rows.find(([k]) => _pvNorm(k) === _pvNorm(p));
    if (hit) push(hit[0], hit[1]);
    if (out.length >= 8) break;
  }
  for (const [k,v] of rows) {
    push(k, v);
    if (out.length >= 8) break;
  }
  return out;
}

function pvSetFilter(slug, chip, btn) {
  if (!_previewState[slug]) _previewState[slug] = { chip: 'all', key: 'all', val: '', sort: 'none' };
  _previewState[slug].chip = chip || 'all';
  document.querySelectorAll('.pv-chip').forEach(x => x.classList.remove('on'));
  btn?.classList?.add('on');
  pvRefreshOptions(slug);
  pvApplyFilter(slug);
}

function pvSetKey(slug, key) {
  if (!_previewState[slug]) _previewState[slug] = { chip: 'all', key: 'all', val: '', sort: 'none' };
  _previewState[slug].key = key || 'all';
  _previewState[slug].val = '';
  _previewState[slug].sort = 'none';
  document.querySelectorAll('.pv-kchip').forEach(x => x.classList.remove('on'));
  document.querySelector(`.pv-kchip[data-k="${CSS.escape(_previewState[slug].key)}"]`)?.classList?.add('on');
  pvRefreshOptions(slug);
  pvApplyFilter(slug);
}

function pvSetVal(slug, val) {
  if (!_previewState[slug]) _previewState[slug] = { chip: 'all', key: 'all', val: '', sort: 'none' };
  _previewState[slug].val = val || '';
  document.querySelectorAll('.pv-vchip').forEach(x => x.classList.remove('on'));
  document.querySelector(`.pv-vchip[data-v="${CSS.escape(_previewState[slug].val)}"]`)?.classList?.add('on');
  pvApplyFilter(slug);
}

function pvSetSort(slug, sort) {
  if (!_previewState[slug]) _previewState[slug] = { chip: 'all', key: 'all', val: '', sort: 'none' };
  _previewState[slug].sort = sort || 'none';
  document.querySelectorAll('.pv-schip').forEach(x => x.classList.remove('on'));
  document.querySelector(`.pv-schip[data-s="${CSS.escape(_previewState[slug].sort)}"]`)?.classList?.add('on');
  pvApplyFilter(slug);
}

function pvRefreshOptions(slug) {
  const st = _previewState[slug] || { chip: 'all', key: 'all', val: '', sort: 'none' };
  const allCards = Array.from(document.querySelectorAll('.pv-card'));
  const byChip = allCards.filter(card => {
    const type = card.dataset.type || '';
    return st.chip === 'all' || (st.chip.startsWith('type:') && type === st.chip.slice(5));
  });
  const keyMap = new Map();
  byChip.forEach(card => {
    const pairs = (card.dataset.pairs || '').split('||').filter(Boolean).map(x => {
      const p = x.split('::');
      return [p[0] || '', p[1] || ''];
    });
    pairs.forEach(([k, v]) => {
      if (!k) return;
      if (!keyMap.has(k)) keyMap.set(k, { label: _pvPrettyKey(k), vals: new Set() });
      if (String(v || '').trim()) keyMap.get(k).vals.add(String(v).trim());
    });
  });

  const keyBox = document.getElementById('pv-key-chips');
  if (keyBox) {
    const keys = Array.from(keyMap.keys()).sort((a, b) => a.localeCompare(b, 'ru'));
    if (st.key !== 'all' && !keyMap.has(st.key)) st.key = 'all';
    keyBox.innerHTML = `<button class="pv-kchip${st.key==='all'?' on':''}" data-k="all" onclick="pvSetKey('${esc(slug)}','all')">${lang==='en'?'Any characteristic':'Любая характеристика'}</button>`
      + keys.map(k => `<button class="pv-kchip${st.key===k?' on':''}" data-k="${esc(k)}" onclick="pvSetKey('${esc(slug)}','${esc(k)}')">${esc(_pvPrettyKey(k))}</button>`).join('');
  }

  const valBox = document.getElementById('pv-val-chips');
  const sortBox = document.getElementById('pv-sort-chips');
  const selectedValues = st.key === 'all' ? [] : Array.from((keyMap.get(st.key)?.vals || [])).sort((a, b) => a.localeCompare(b, 'ru'));
  const isNumericKey = selectedValues.length > 0 && selectedValues.every(v => _pvNum(v) !== null);
  if (valBox) {
    if (st.val && !selectedValues.includes(st.val)) st.val = '';
    valBox.style.display = (st.key !== 'all' && !isNumericKey) ? '' : 'none';
    valBox.innerHTML = `<button class="pv-vchip${!st.val?' on':''}" data-v="" onclick="pvSetVal('${esc(slug)}','')">${lang==='en'?'Any value':'Любое значение'}</button>`
      + selectedValues.map(v => `<button class="pv-vchip${st.val===v?' on':''}" data-v="${esc(v)}" onclick="pvSetVal('${esc(slug)}','${esc(v)}')">${esc(_pvDisplayTerm(st.key, v))}</button>`).join('');
  }

  if (sortBox) {
    sortBox.style.display = (st.key !== 'all' && isNumericKey) ? '' : 'none';
    if (!isNumericKey) st.sort = 'none';
    sortBox.innerHTML =
      `<button class="pv-schip${st.sort==='none'?' on':''}" data-s="none" onclick="pvSetSort('${esc(slug)}','none')">${lang==='en'?'No sorting':'Без сортировки'}</button>` +
      `<button class="pv-schip${st.sort==='desc'?' on':''}" data-s="desc" onclick="pvSetSort('${esc(slug)}','desc')">${lang==='en'?'More to less':'Больше к меньшему'}</button>` +
      `<button class="pv-schip${st.sort==='asc'?' on':''}" data-s="asc" onclick="pvSetSort('${esc(slug)}','asc')">${lang==='en'?'Less to more':'Меньше к большему'}</button>`;
  }
}

function pvApplyFilter(slug) {
  const st = _previewState[slug] || { chip: 'all', key: 'all', val: '', sort: 'none' };
  const cards = Array.from(document.querySelectorAll('.pv-card'));
  cards.forEach(card => {
    const type = card.dataset.type || '';
    const pairs = (card.dataset.pairs || '').split('||').filter(Boolean).map(x => {
      const p = x.split('::');
      return [p[0] || '', p[1] || ''];
    });
    const byChip = st.chip === 'all'
      || (st.chip.startsWith('type:') && type === st.chip.slice(5));
    const byKey = st.key === 'all' || pairs.some(([k]) => k === st.key);
    const byVal = !st.val || pairs.some(([k, v]) => (st.key === 'all' || k === st.key) && _pvNorm(v) === _pvNorm(st.val));
    card.style.display = (byChip && byKey && byVal) ? '' : 'none';
  });

  if (st.key !== 'all' && st.sort !== 'none') {
    const grid = document.querySelector('.pv-grid');
    if (grid) {
      const visible = cards.filter(c => c.style.display !== 'none');
      visible.sort((a, b) => {
        const ap = (a.dataset.pairs || '').split('||').map(x => x.split('::')).find(([k]) => k === st.key);
        const bp = (b.dataset.pairs || '').split('||').map(x => x.split('::')).find(([k]) => k === st.key);
        const av = _pvNum(ap?.[1] || '');
        const bv = _pvNum(bp?.[1] || '');
        const aa = av === null ? Number.NEGATIVE_INFINITY : av;
        const bb = bv === null ? Number.NEGATIVE_INFINITY : bv;
        return st.sort === 'asc' ? aa - bb : bb - aa;
      });
      visible.forEach(el => grid.appendChild(el));
    }
  }

  const shown = cards.filter(c => c.style.display !== 'none').length;
  const cnt = document.getElementById('pv-count');
  if (cnt) cnt.textContent = String(shown);
}

// ══════════════════════════════════════════════════════════════
// WEAPON PREVIEW PAGE — специализированное превью для оружия
// ══════════════════════════════════════════════════════════════
function renderWeaponPreviewPage(pg, kids, otherBlocks) {
  const isDraft = pg.status === 'draft';
  
  // Собираем данные по всем оружиям
  const weapons = kids.map(k => {
    const rows = _pvRowsFromPage(k);
    const m = new Map(rows.map(([k,v]) => [_pvNorm(k), _pvNorm(v)])); // Нормализуем и ключи и значения!
    
    // Извлекаем характеристики оружия
    const wData = {
      caliber: m.get('калибр') || m.get('caliber') || '0',
      weight: m.get('вес') || m.get('weight') || '0',
      fireRate: m.get('темп_стрельбы') || m.get('темп стрельбы') || m.get('fire_rate') || m.get('firerate') || '0',
      techType: m.get('тип_технологии') || m.get('тип технологии') || m.get('tech_type') || m.get('techtype') || 'conventional',
      damageType: m.get('тип_урона') || m.get('тип урона') || m.get('damage_type') || m.get('damagetype') || 'kinetic',
      weaponClass: m.get('класс_оружия') || m.get('класс оружия') || m.get('weapon_class') || m.get('weaponclass') || 'rifle',
      baseRange: m.get('дальность') || m.get('dalnost') || m.get('base_range') || m.get('baserange') || '0',
    };
    
    // Рассчитываем характеристики если доступна функция
    let stats = { damage: 0, finalRange: 0, rangeLabel: '—' };
    if (typeof calculateWeaponStats === 'function') {
      stats = calculateWeaponStats(wData);
    }
    
    const rarity = m.get('редкость') || m.get('rarity') || 'common';
    const price = m.get('цена') || m.get('стоимость') || m.get('price') || m.get('cost') || '';
    
    return {
      slug: k.slug,
      title: pT(k),
      image: k.image_url || '',
      rarity: rarity, // уже нормализовано
      price,
      weaponClass: wData.weaponClass, // уже нормализовано
      techType: wData.techType, // уже нормализовано
      damageType: wData.damageType, // уже нормализовано
      caliber: parseFloat(wData.caliber) || 0,
      weight: parseFloat(wData.weight) || 0,
      fireRate: parseFloat(wData.fireRate) || 0,
      damage: stats.damage,
      range: stats.finalRange,
      rangeLabel: stats.rangeLabel,
      rows
    };
  });
  
  // Определяем диапазоны для фильтров
  const damages = weapons.map(w => w.damage).filter(d => d > 0);
  const ranges = weapons.map(w => w.range).filter(r => r > 0);
  const calibers = weapons.map(w => w.caliber).filter(c => c > 0);
  const weights = weapons.map(w => w.weight).filter(w => w > 0);
  const fireRates = weapons.map(w => w.fireRate).filter(f => f > 0);
  
  const damageRanges = damages.length ? [
    { label: '< 50', min: 0, max: 49 },
    { label: '50-100', min: 50, max: 100 },
    { label: '100-200', min: 100, max: 200 },
    { label: '200-500', min: 200, max: 500 },
    { label: '> 500', min: 500, max: Infinity }
  ] : [];
  
  const rangeRanges = ranges.length ? [
    { label: '< 5 АсК', min: 0, max: 5 },
    { label: '5-10 АсК', min: 5, max: 10 },
    { label: '10-20 АсК', min: 10, max: 20 },
    { label: '20-50 АсК', min: 20, max: 50 },
    { label: '> 50 АсК', min: 50, max: Infinity }
  ] : [];
  
  const caliberRanges = calibers.length ? [
    { label: '< 10 мм', min: 0, max: 10 },
    { label: '10-20 мм', min: 10, max: 20 },
    { label: '20-50 мм', min: 20, max: 50 },
    { label: '50-100 мм', min: 50, max: 100 },
    { label: '> 100 мм', min: 100, max: Infinity }
  ] : [];
  
  const weightRanges = weights.length ? [
    { label: '< 5 кг', min: 0, max: 5 },
    { label: '5-10 кг', min: 5, max: 10 },
    { label: '10-20 кг', min: 10, max: 20 },
    { label: '20-50 кг', min: 20, max: 50 },
    { label: '> 50 кг', min: 50, max: Infinity }
  ] : [];
  
  const fireRateRanges = fireRates.length ? [
    { label: '< 300 в/м', min: 0, max: 300 },
    { label: '300-600 в/м', min: 300, max: 600 },
    { label: '600-1000 в/м', min: 600, max: 1000 },
    { label: '> 1000 в/м', min: 1000, max: Infinity }
  ] : [];
  
  // Собираем уникальные значения для категориальных фильтров
  const weaponClasses = [...new Set(weapons.map(w => w.weaponClass))].sort();
  const techTypes = [...new Set(weapons.map(w => w.techType))].sort();
  const damageTypes = [...new Set(weapons.map(w => w.damageType))].sort();
  const rarities = [...new Set(weapons.map(w => w.rarity))].sort();
  
  // Словари для отображения (все варианты в нижнем регистре)
  const classLabels = {
    rifle: 'Винтовка', smg: 'ПП', shotgun: 'Дробовик', sniper: 'Снайперская',
    pistol: 'Пистолет', heavy: 'Тяжёлое', 
    пп: 'ПП', винтовка: 'Винтовка', дробовик: 'Дробовик', пистолет: 'Пистолет',
    'пистолет-пулемёт': 'Пистолет-пулемёт', карабин: 'Карабин',
    'штурмовая винтовка': 'Штурмовая винтовка', 'снайперская винтовка': 'Снайперская винтовка',
    'пулемёт': 'Пулемёт', 'гранатомёт': 'Гранатомёт', 'ракетный пусковой': 'Ракетный пусковой',
    'орудие (пушка)': 'Орудие (пушка)', 'автоматическая пушка': 'Автоматическая пушка',
    'гаубица': 'Гаубица', 'миномёт': 'Миномёт', 'огнемёт': 'Огнемёт',
    'торпеда': 'Торпеда', 'ракета': 'Ракета', 'крылатая ракета': 'Крылатая ракета',
    'рельсотронная установка': 'Рельсотронная установка', 'главный калибр': 'Главный калибр',
    'зенитный комплекс': 'Зенитный комплекс'
  };
  const techLabels = {
    conventional: 'Конвенциональная', конвенциональная: 'Конвенциональная',
    laser: 'Лазерная', plasma: 'Плазменная', gauss: 'Гаусс', railgun: 'Рельсотрон'
  };
  const damageLabels = {
    kinetic: 'Кинетический', кинетический: 'Кинетический',
    thermal: 'Термический', laser: 'Лазерный', plasma: 'Плазменный',
    explosive: 'Взрывной'
  };
  const rarityLabels = {
    common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий',
    epic: 'Эпический', legendary: 'Легендарный', обычный: 'Обычный'
  };
  
  _previewState[pg.slug] = _previewState[pg.slug] || {
    weaponClass: 'all', techType: 'all', damageType: 'all', rarity: 'all',
    damageRange: 'all', rangeRange: 'all', caliberRange: 'all',
    weightRange: 'all', fireRateRange: 'all', sort: 'none'
  };
  
  const st = _previewState[pg.slug];
  
  // Генерируем HTML карточек
  const cardsHtml = weapons.map(w => {
    const rarityColors = {
      common: '#9a9aaa', uncommon: '#4ec96a', rare: '#4aaaf0',
      epic: '#b060f8', legendary: '#3ca8e8'
    };
    const rarityColor = rarityColors[w.rarity] || rarityColors.common;
    
    const priceFormatted = w.price ? _pvFormatNum(w.price) : '';
    const priceDisplay = priceFormatted ? (/\bэк\b/i.test(w.price) ? priceFormatted : `${priceFormatted} ЭК`) : '';
    
    const classIcon = {
      винтовка: '⚔', rifle: '⚔', 
      пп: '⚡', smg: '⚡', 'пистолет-пулемёт': '⚡',
      дробовик: '◈', shotgun: '◈',
      пистолет: '◆', pistol: '◆',
      снайперская: '◉', sniper: '◉', 'снайперская винтовка': '◉',
      тяжёлое: '▣', heavy: '▣',
      карабин: '⚔', 'штурмовая винтовка': '⚔',
      пулемёт: '▣', гранатомёт: '◎', 'ракетный пусковой': '◎',
      'орудие (пушка)': '▣', 'автоматическая пушка': '▣',
      гаубица: '◈', миномёт: '◈', огнемёт: '◈',
      торпеда: '◎', ракета: '◎', 'крылатая ракета': '◎',
      'рельсотронная установка': '◉', 'главный калибр': '▣',
      'зенитный комплекс': '◎'
    };
    const icon = classIcon[w.weaponClass] || '◈';
    
    return `<div class="pv-card wpv-card" 
      data-class="${esc(w.weaponClass)}" 
      data-tech="${esc(w.techType)}" 
      data-dmgtype="${esc(w.damageType)}" 
      data-rarity="${esc(w.rarity)}"
      data-damage="${w.damage}"
      data-range="${w.range}"
      data-caliber="${w.caliber}"
      data-weight="${w.weight}"
      data-firerate="${w.fireRate}"
      onclick="go('${esc(w.slug)}')">
      
      <div class="wpv-card-scan"></div>
      
      <div class="pv-c-media wpv-media">
        ${w.image
          ? `<img src="${esc(w.image)}" alt="${esc(w.title)}" loading="lazy">`
          : `<div class="pv-c-noimg wpv-noimg"><span class="wpv-noimg-icon">${icon}</span></div>`
        }
        <div class="pv-c-media-grad"></div>
        <div class="wpv-media-top-bar">
          <div class="wpv-class-badge">${esc(classLabels[w.weaponClass] || w.weaponClass)}</div>
          <div class="wpv-rarity-badge" style="--rarity-color:${rarityColor}">
            <span class="wpv-rarity-dot"></span>
            <span>${esc(rarityLabels[w.rarity] || w.rarity)}</span>
          </div>
        </div>
      </div>
      
      <div class="pv-c-body wpv-body">
        <div class="wpv-header">
          <div class="wpv-title-row">
            <span class="wpv-icon">${icon}</span>
            <h3 class="wpv-title">${esc(w.title)}</h3>
          </div>
        </div>
        
        <div class="wpv-stats-grid">
          <div class="wpv-stat wpv-stat--damage">
            <div class="wpv-stat-icon">⚔</div>
            <div class="wpv-stat-content">
              <div class="wpv-stat-label">Урон</div>
              <div class="wpv-stat-value">${w.damage || '—'}</div>
            </div>
          </div>
          
          <div class="wpv-stat wpv-stat--range">
            <div class="wpv-stat-icon">◎</div>
            <div class="wpv-stat-content">
              <div class="wpv-stat-label">Дальность</div>
              <div class="wpv-stat-value">${esc(w.rangeLabel)}</div>
            </div>
          </div>
          
          <div class="wpv-stat wpv-stat--caliber">
            <div class="wpv-stat-icon">◈</div>
            <div class="wpv-stat-content">
              <div class="wpv-stat-label">Калибр</div>
              <div class="wpv-stat-value">${w.caliber ? w.caliber + ' мм' : '—'}</div>
            </div>
          </div>
        </div>
        
        <div class="wpv-details">
          <div class="wpv-detail-row">
            <span class="wpv-detail-label">Технология:</span>
            <span class="wpv-detail-value">${esc(techLabels[w.techType] || w.techType)}</span>
          </div>
          <div class="wpv-detail-row">
            <span class="wpv-detail-label">Тип урона:</span>
            <span class="wpv-detail-value">${esc(damageLabels[w.damageType] || w.damageType)}</span>
          </div>
          ${w.weight ? `<div class="wpv-detail-row">
            <span class="wpv-detail-label">Вес:</span>
            <span class="wpv-detail-value">${w.weight} кг</span>
          </div>` : ''}
          ${w.fireRate ? `<div class="wpv-detail-row">
            <span class="wpv-detail-label">Темп:</span>
            <span class="wpv-detail-value">${w.fireRate} в/м</span>
          </div>` : ''}
        </div>
        
        ${priceDisplay ? `<div class="wpv-price">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M7 3.5v7M5 5.5h4M5 8.5h4" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          <span>${esc(priceDisplay)}</span>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
  
  const cover = pg.image_url
    ? `<div class="art-cov" style="--cov-h:${pg.cover_height||340}px;--cov-pos:${pg.cover_pos||'center center'}"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${esc(pT(pg))}</h1></div></div><div class="art-cov-spacer"></div>`
    : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${esc(pT(pg))}</h1></div>`;
  const draftBanner = isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК</div>` : '';
  
  setPg(`${draftBanner}${cover}
    <div class="pv-wrap wpv-wrap">
      <div class="wpv-toolbar">
        <button class="wpv-filter-btn" onclick="wpvToggleFilters('${esc(pg.slug)}')">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L10.5 6H13.5L9 10L10.5 15L8 12L5.5 15L7 10L2.5 6H5.5L8 1Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
          <span>Фильтры</span>
          <span class="wpv-filter-count" id="wpv-filter-count-${esc(pg.slug)}">0</span>
        </button>
        <div class="wpv-quick-sort">
          <button class="wpv-sort-btn${st.sort==='damage-desc'?' active':''}" onclick="wpvSetSort('${esc(pg.slug)}','damage-desc')" title="Сортировка по урону">
            <span>Урон</span>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2L6 10M6 10L3 7M6 10L9 7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
          <button class="wpv-sort-btn${st.sort==='range-desc'?' active':''}" onclick="wpvSetSort('${esc(pg.slug)}','range-desc')" title="Сортировка по дальности">
            <span>Дальность</span>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2L6 10M6 10L3 7M6 10L9 7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
          <button class="wpv-sort-btn${st.sort==='caliber-desc'?' active':''}" onclick="wpvSetSort('${esc(pg.slug)}','caliber-desc')" title="Сортировка по калибру">
            <span>Калибр</span>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2L6 10M6 10L3 7M6 10L9 7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
        </div>
        <div class="wpv-count-display">
          <span>Показано:</span>
          <span id="wpv-count" class="wpv-count-num">0</span>
        </div>
      </div>
      
      <div class="wpv-filters-panel" id="wpv-filters-${esc(pg.slug)}" style="display:none">
        <div class="wpv-filters-grid">
          <div class="wpv-filter-col">
            <div class="wpv-filter-section">
              <div class="wpv-filter-title">Класс оружия</div>
              <div class="wpv-filter-options" data-group="class">
                <label class="wpv-filter-option"><input type="radio" name="class-${esc(pg.slug)}" value="all" ${st.weaponClass==='all'?'checked':''} onchange="wpvSetClass('${esc(pg.slug)}','all')"><span>Все</span></label>
                ${weaponClasses.map(c => `<label class="wpv-filter-option"><input type="radio" name="class-${esc(pg.slug)}" value="${esc(c)}" ${st.weaponClass===c?'checked':''} onchange="wpvSetClass('${esc(pg.slug)}','${esc(c)}')"><span>${esc(classLabels[c] || c)}</span></label>`).join('')}
              </div>
            </div>
            
            <div class="wpv-filter-section">
              <div class="wpv-filter-title">Технология</div>
              <div class="wpv-filter-options" data-group="tech">
                <label class="wpv-filter-option"><input type="radio" name="tech-${esc(pg.slug)}" value="all" ${st.techType==='all'?'checked':''} onchange="wpvSetTech('${esc(pg.slug)}','all')"><span>Все</span></label>
                ${techTypes.map(t => `<label class="wpv-filter-option"><input type="radio" name="tech-${esc(pg.slug)}" value="${esc(t)}" ${st.techType===t?'checked':''} onchange="wpvSetTech('${esc(pg.slug)}','${esc(t)}')"><span>${esc(techLabels[t] || t)}</span></label>`).join('')}
              </div>
            </div>
            
            <div class="wpv-filter-section">
              <div class="wpv-filter-title">Тип урона</div>
              <div class="wpv-filter-options" data-group="dmgtype">
                <label class="wpv-filter-option"><input type="radio" name="dmgtype-${esc(pg.slug)}" value="all" ${st.damageType==='all'?'checked':''} onchange="wpvSetDamageType('${esc(pg.slug)}','all')"><span>Все</span></label>
                ${damageTypes.map(d => `<label class="wpv-filter-option"><input type="radio" name="dmgtype-${esc(pg.slug)}" value="${esc(d)}" ${st.damageType===d?'checked':''} onchange="wpvSetDamageType('${esc(pg.slug)}','${esc(d)}')"><span>${esc(damageLabels[d] || d)}</span></label>`).join('')}
              </div>
            </div>
            
            <div class="wpv-filter-section">
              <div class="wpv-filter-title">Редкость</div>
              <div class="wpv-filter-options" data-group="rarity">
                <label class="wpv-filter-option"><input type="radio" name="rarity-${esc(pg.slug)}" value="all" ${st.rarity==='all'?'checked':''} onchange="wpvSetRarity('${esc(pg.slug)}','all')"><span>Все</span></label>
                ${rarities.map(r => `<label class="wpv-filter-option"><input type="radio" name="rarity-${esc(pg.slug)}" value="${esc(r)}" ${st.rarity===r?'checked':''} onchange="wpvSetRarity('${esc(pg.slug)}','${esc(r)}')"><span>${esc(rarityLabels[r] || r)}</span></label>`).join('')}
              </div>
            </div>
          </div>
          
          <div class="wpv-filter-col">
            ${damageRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Урон</div>
              <div class="wpv-filter-options" data-group="damage">
                <label class="wpv-filter-option"><input type="radio" name="damage-${esc(pg.slug)}" value="all" ${st.damageRange==='all'?'checked':''} onchange="wpvSetDamageRange('${esc(pg.slug)}','all')"><span>Любой</span></label>
                ${damageRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="damage-${esc(pg.slug)}" value="${i}" ${st.damageRange===String(i)?'checked':''} onchange="wpvSetDamageRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
            
            ${rangeRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Дальность</div>
              <div class="wpv-filter-options" data-group="range">
                <label class="wpv-filter-option"><input type="radio" name="range-${esc(pg.slug)}" value="all" ${st.rangeRange==='all'?'checked':''} onchange="wpvSetRangeRange('${esc(pg.slug)}','all')"><span>Любая</span></label>
                ${rangeRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="range-${esc(pg.slug)}" value="${i}" ${st.rangeRange===String(i)?'checked':''} onchange="wpvSetRangeRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
            
            ${caliberRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Калибр</div>
              <div class="wpv-filter-options" data-group="caliber">
                <label class="wpv-filter-option"><input type="radio" name="caliber-${esc(pg.slug)}" value="all" ${st.caliberRange==='all'?'checked':''} onchange="wpvSetCaliberRange('${esc(pg.slug)}','all')"><span>Любой</span></label>
                ${caliberRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="caliber-${esc(pg.slug)}" value="${i}" ${st.caliberRange===String(i)?'checked':''} onchange="wpvSetCaliberRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
            
            ${weightRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Вес</div>
              <div class="wpv-filter-options" data-group="weight">
                <label class="wpv-filter-option"><input type="radio" name="weight-${esc(pg.slug)}" value="all" ${st.weightRange==='all'?'checked':''} onchange="wpvSetWeightRange('${esc(pg.slug)}','all')"><span>Любой</span></label>
                ${weightRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="weight-${esc(pg.slug)}" value="${i}" ${st.weightRange===String(i)?'checked':''} onchange="wpvSetWeightRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
            
            ${fireRateRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Темп стрельбы</div>
              <div class="wpv-filter-options" data-group="firerate">
                <label class="wpv-filter-option"><input type="radio" name="firerate-${esc(pg.slug)}" value="all" ${st.fireRateRange==='all'?'checked':''} onchange="wpvSetFireRateRange('${esc(pg.slug)}','all')"><span>Любой</span></label>
                ${fireRateRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="firerate-${esc(pg.slug)}" value="${i}" ${st.fireRateRange===String(i)?'checked':''} onchange="wpvSetFireRateRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
          </div>
        </div>
        
        <div class="wpv-filter-actions">
          <button class="wpv-reset-btn" onclick="wpvResetFilters('${esc(pg.slug)}')">Сбросить все</button>
          <button class="wpv-close-btn" onclick="wpvToggleFilters('${esc(pg.slug)}')">Закрыть</button>
        </div>
      </div>
      
      <div class="pv-meta">Показано: <span id="wpv-count">0</span></div>
      <div class="pv-grid wpv-grid">${cardsHtml || `<div class="pv-empty">Оружие пока не добавлено</div>`}</div>
      ${otherBlocks.length ? `<div class="prose pv-extra">${otherBlocks.map(renderBlock).join('')}</div>` : ''}
    </div>
  `);
  
  renderCommentsSection(pg.slug);
  
  // Сохраняем диапазоны в глобальную переменную для использования в фильтрах
  window._wpvRanges = window._wpvRanges || {};
  window._wpvRanges[pg.slug] = { damageRanges, rangeRanges, caliberRanges, weightRanges, fireRateRanges };
  
  // Применяем фильтры
  requestAnimationFrame(() => wpvApplyFilters(pg.slug));
}

// ══════════════════════════════════════════════════════════════
// ARMOR PREVIEW PAGE — специализированное превью для брони
// ══════════════════════════════════════════════════════════════
function renderArmorPreviewPage(pg, kids, otherBlocks) {
  const isDraft = pg.status === 'draft';
  
  console.log('renderArmorPreviewPage:', pg.slug, 'kids:', kids.length);
  
  // Собираем данные по всей броне
  const armors = kids.map(k => {
    // Используем предварительно распарсенный инфобокс из data.js
    const ib = k.infobox || {};
    
    // Извлекаем характеристики - инфобокс уже содержит lowercase ключи
    const armorClass = ib['класс брони'] || ib['класс_брони'] || ib['armor_class'] || ib['класс'] || 'infantry';
    const hp = parseInt(ib['hp'] || ib['хп'] || '0', 10) || 0;
    const penMm = parseInt(ib['пробитие мм'] || ib['пробитие_мм'] || ib['пробитие'] || '0', 10) || 0;
    const laserRating = ib['лазер рейтинг'] || ib['лазер_рейтинг'] || ib['лазер'] || '';
    const weight = parseFloat(ib['вес'] || ib['weight'] || '0') || 0;
    const rarity = ib['редкость'] || ib['rarity'] || 'common';
    const price = ib['цена'] || ib['стоимость'] || ib['price'] || ib['cost'] || '';
    
    return {
      slug: k.slug,
      title: pT(k),
      image: k.image_url || '',
      rarity,
      price,
      armorClass,
      hp,
      penMm,
      laserRating,
      weight
    };
  });
  
  console.log('Total armors:', armors.length);
  
  // Определяем диапазоны для фильтров
  const hps = armors.map(a => a.hp).filter(h => h > 0);
  const pens = armors.map(a => a.penMm).filter(p => p > 0);
  const weights = armors.map(a => a.weight).filter(w => w > 0);
  
  const hpRanges = hps.length ? [
    { label: '< 100', min: 0, max: 100 },
    { label: '100-500', min: 100, max: 500 },
    { label: '500-1000', min: 500, max: 1000 },
    { label: '1000-5000', min: 1000, max: 5000 },
    { label: '> 5000', min: 5000, max: Infinity }
  ] : [];
  
  const penRanges = pens.length ? [
    { label: '< 50 мм', min: 0, max: 50 },
    { label: '50-100 мм', min: 50, max: 100 },
    { label: '100-200 мм', min: 100, max: 200 },
    { label: '200-500 мм', min: 200, max: 500 },
    { label: '> 500 мм', min: 500, max: Infinity }
  ] : [];
  
  const weightRanges = weights.length ? [
    { label: '< 10 кг', min: 0, max: 10 },
    { label: '10-50 кг', min: 10, max: 50 },
    { label: '50-100 кг', min: 50, max: 100 },
    { label: '100-500 кг', min: 100, max: 500 },
    { label: '> 500 кг', min: 500, max: Infinity }
  ] : [];
  
  // Собираем уникальные значения
  const armorClasses = [...new Set(armors.map(a => a.armorClass))].sort();
  const laserRatings = [...new Set(armors.map(a => a.laserRating).filter(Boolean))].sort();
  const rarities = [...new Set(armors.map(a => a.rarity))].sort();
  
  // Словари
  const classLabels = {
    infantry: 'Пехота', vehicle: 'Техника', tank: 'Танк',
    aviation_light: 'Лёгкая авиация', aviation_medium: 'Средняя авиация', aviation_heavy: 'Тяжёлая авиация',
    ship_light: 'Лёгкий корабль', ship_medium: 'Средний корабль', ship_heavy: 'Тяжёлый корабль'
  };
  const rarityLabels = {
    common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий',
    epic: 'Эпический', legendary: 'Легендарный', обычный: 'Обычный'
  };
  
  _previewState[pg.slug] = _previewState[pg.slug] || {
    armorClass: 'all', laserRating: 'all', rarity: 'all',
    hpRange: 'all', penRange: 'all', weightRange: 'all', sort: 'none'
  };
  
  const st = _previewState[pg.slug];
  
  // Генерируем HTML карточек
  const cardsHtml = armors.map(a => {
    const rarityColors = {
      common: '#9a9aaa', uncommon: '#4ec96a', rare: '#4aaaf0',
      epic: '#b060f8', legendary: '#3ca8e8'
    };
    const rarityColor = rarityColors[a.rarity] || rarityColors.common;
    
    const priceFormatted = a.price ? _pvFormatNum(a.price) : '';
    const priceDisplay = priceFormatted ? (/\bэк\b/i.test(a.price) ? priceFormatted : `${priceFormatted} ЭК`) : '';
    
    const icon = '🛡';
    
    return `<div class="pv-card wpv-card apv-card" 
      data-class="${esc(a.armorClass)}" 
      data-laser="${esc(a.laserRating)}" 
      data-rarity="${esc(a.rarity)}"
      data-hp="${a.hp}"
      data-pen="${a.penMm}"
      data-weight="${a.weight}"
      onclick="go('${esc(a.slug)}')">
      
      <div class="wpv-card-scan"></div>
      
      <div class="pv-c-media wpv-media">
        ${a.image
          ? `<img src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy">`
          : `<div class="pv-c-noimg wpv-noimg"><span class="wpv-noimg-icon">${icon}</span></div>`
        }
        <div class="pv-c-media-grad"></div>
        <div class="wpv-media-top-bar">
          <div class="wpv-class-badge">${esc(classLabels[a.armorClass] || a.armorClass)}</div>
          <div class="wpv-rarity-badge" style="--rarity-color:${rarityColor}">
            <span class="wpv-rarity-dot"></span>
            <span>${esc(rarityLabels[a.rarity] || a.rarity)}</span>
          </div>
        </div>
      </div>
      
      <div class="pv-c-body wpv-body">
        <div class="wpv-header">
          <div class="wpv-title-row">
            <span class="wpv-icon">${icon}</span>
            <h3 class="wpv-title">${esc(a.title)}</h3>
          </div>
        </div>
        
        <div class="wpv-stats-grid apv-stats-grid">
          <div class="wpv-stat apv-stat--hp">
            <div class="wpv-stat-icon">◈</div>
            <div class="wpv-stat-content">
              <div class="wpv-stat-label">HP брони</div>
              <div class="wpv-stat-value">${a.hp ? a.hp.toLocaleString('ru') : '—'}</div>
            </div>
          </div>
          
          <div class="wpv-stat apv-stat--pen">
            <div class="wpv-stat-icon">⚔</div>
            <div class="wpv-stat-content">
              <div class="wpv-stat-label">Пробитие</div>
              <div class="wpv-stat-value">${a.penMm ? a.penMm + ' мм' : '—'}</div>
            </div>
          </div>
          
          <div class="wpv-stat apv-stat--laser apv-stat--full">
            <div class="wpv-stat-icon">◎</div>
            <div class="wpv-stat-content">
              <div class="wpv-stat-label">Защита от лазера</div>
              <div class="wpv-stat-value">${a.laserRating || '—'}</div>
            </div>
          </div>
        </div>
        
        <div class="wpv-details">
          <div class="wpv-detail-row">
            <span class="wpv-detail-label">Класс брони:</span>
            <span class="wpv-detail-value">${esc(classLabels[a.armorClass] || a.armorClass)}</span>
          </div>
          ${a.weight ? `<div class="wpv-detail-row">
            <span class="wpv-detail-label">Вес:</span>
            <span class="wpv-detail-value">${a.weight} кг</span>
          </div>` : ''}
        </div>
        
        ${priceDisplay ? `<div class="wpv-price">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M7 3.5v7M5 5.5h4M5 8.5h4" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          <span>${esc(priceDisplay)}</span>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
  
  const cover = pg.image_url
    ? `<div class="art-cov" style="--cov-h:${pg.cover_height||340}px;--cov-pos:${pg.cover_pos||'center center'}"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${esc(pT(pg))}</h1></div></div><div class="art-cov-spacer"></div>`
    : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${esc(pT(pg))}</h1></div>`;
  const draftBanner = isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК</div>` : '';
  
  setPg(`${draftBanner}${cover}
    <div class="pv-wrap wpv-wrap apv-wrap">
      <div class="wpv-toolbar">
        <button class="wpv-filter-btn" onclick="apvToggleFilters('${esc(pg.slug)}')">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L10.5 6H13.5L9 10L10.5 15L8 12L5.5 15L7 10L2.5 6H5.5L8 1Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
          <span>Фильтры</span>
          <span class="wpv-filter-count" id="apv-filter-count-${esc(pg.slug)}">0</span>
        </button>
        <div class="wpv-quick-sort">
          <button class="wpv-sort-btn${st.sort==='hp-desc'?' active':''}" onclick="apvSetSort('${esc(pg.slug)}','hp-desc')" title="Сортировка по HP">
            <span>HP</span>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2L6 10M6 10L3 7M6 10L9 7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
          <button class="wpv-sort-btn${st.sort==='pen-desc'?' active':''}" onclick="apvSetSort('${esc(pg.slug)}','pen-desc')" title="Сортировка по пробитию">
            <span>Пробитие</span>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2L6 10M6 10L3 7M6 10L9 7" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
        </div>
        <div class="wpv-count-display">
          <span>Показано:</span>
          <span id="apv-count" class="wpv-count-num">0</span>
        </div>
      </div>
      
      <div class="wpv-filters-panel" id="apv-filters-${esc(pg.slug)}" style="display:none">
        <div class="wpv-filters-grid">
          <div class="wpv-filter-col">
            <div class="wpv-filter-section">
              <div class="wpv-filter-title">Класс брони</div>
              <div class="wpv-filter-options" data-group="class">
                <label class="wpv-filter-option"><input type="radio" name="aclass-${esc(pg.slug)}" value="all" ${st.armorClass==='all'?'checked':''} onchange="apvSetClass('${esc(pg.slug)}','all')"><span>Все</span></label>
                ${armorClasses.map(c => `<label class="wpv-filter-option"><input type="radio" name="aclass-${esc(pg.slug)}" value="${esc(c)}" ${st.armorClass===c?'checked':''} onchange="apvSetClass('${esc(pg.slug)}','${esc(c)}')"><span>${esc(classLabels[c] || c)}</span></label>`).join('')}
              </div>
            </div>
            
            ${laserRatings.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Лазер рейтинг</div>
              <div class="wpv-filter-options" data-group="laser">
                <label class="wpv-filter-option"><input type="radio" name="laser-${esc(pg.slug)}" value="all" ${st.laserRating==='all'?'checked':''} onchange="apvSetLaser('${esc(pg.slug)}','all')"><span>Все</span></label>
                ${laserRatings.map(l => `<label class="wpv-filter-option"><input type="radio" name="laser-${esc(pg.slug)}" value="${esc(l)}" ${st.laserRating===l?'checked':''} onchange="apvSetLaser('${esc(pg.slug)}','${esc(l)}')"><span>${esc(l)}</span></label>`).join('')}
              </div>
            </div>` : ''}
            
            <div class="wpv-filter-section">
              <div class="wpv-filter-title">Редкость</div>
              <div class="wpv-filter-options" data-group="rarity">
                <label class="wpv-filter-option"><input type="radio" name="ararity-${esc(pg.slug)}" value="all" ${st.rarity==='all'?'checked':''} onchange="apvSetRarity('${esc(pg.slug)}','all')"><span>Все</span></label>
                ${rarities.map(r => `<label class="wpv-filter-option"><input type="radio" name="ararity-${esc(pg.slug)}" value="${esc(r)}" ${st.rarity===r?'checked':''} onchange="apvSetRarity('${esc(pg.slug)}','${esc(r)}')"><span>${esc(rarityLabels[r] || r)}</span></label>`).join('')}
              </div>
            </div>
          </div>
          
          <div class="wpv-filter-col">
            ${hpRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">HP брони</div>
              <div class="wpv-filter-options" data-group="hp">
                <label class="wpv-filter-option"><input type="radio" name="hp-${esc(pg.slug)}" value="all" ${st.hpRange==='all'?'checked':''} onchange="apvSetHpRange('${esc(pg.slug)}','all')"><span>Любой</span></label>
                ${hpRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="hp-${esc(pg.slug)}" value="${i}" ${st.hpRange===String(i)?'checked':''} onchange="apvSetHpRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
            
            ${penRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Пробитие</div>
              <div class="wpv-filter-options" data-group="pen">
                <label class="wpv-filter-option"><input type="radio" name="pen-${esc(pg.slug)}" value="all" ${st.penRange==='all'?'checked':''} onchange="apvSetPenRange('${esc(pg.slug)}','all')"><span>Любое</span></label>
                ${penRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="pen-${esc(pg.slug)}" value="${i}" ${st.penRange===String(i)?'checked':''} onchange="apvSetPenRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
            
            ${weightRanges.length ? `<div class="wpv-filter-section">
              <div class="wpv-filter-title">Вес</div>
              <div class="wpv-filter-options" data-group="weight">
                <label class="wpv-filter-option"><input type="radio" name="aweight-${esc(pg.slug)}" value="all" ${st.weightRange==='all'?'checked':''} onchange="apvSetWeightRange('${esc(pg.slug)}','all')"><span>Любой</span></label>
                ${weightRanges.map((r,i) => `<label class="wpv-filter-option"><input type="radio" name="aweight-${esc(pg.slug)}" value="${i}" ${st.weightRange===String(i)?'checked':''} onchange="apvSetWeightRange('${esc(pg.slug)}','${i}')"><span>${esc(r.label)}</span></label>`).join('')}
              </div>
            </div>` : ''}
          </div>
        </div>
        
        <div class="wpv-filter-actions">
          <button class="wpv-reset-btn" onclick="apvResetFilters('${esc(pg.slug)}')">Сбросить все</button>
          <button class="wpv-close-btn" onclick="apvToggleFilters('${esc(pg.slug)}')">Закрыть</button>
        </div>
      </div>
      
      <div class="pv-grid wpv-grid apv-grid">${cardsHtml || `<div class="pv-empty">Броня пока не добавлена</div>`}</div>
      ${otherBlocks.length ? `<div class="prose pv-extra">${otherBlocks.map(renderBlock).join('')}</div>` : ''}
    </div>
  `);
  
  renderCommentsSection(pg.slug);
  
  // Сохраняем диапазоны
  window._apvRanges = window._apvRanges || {};
  window._apvRanges[pg.slug] = { hpRanges, penRanges, weightRanges };
  
  // Применяем фильтры
  requestAnimationFrame(() => apvApplyFilters(pg.slug));
}

function renderPreviewPage(pg) {
  const isDraft = pg.status === 'draft';
  const canEdit = user && ['superadmin','editor','moderator'].includes(user.role);
  if (isDraft && !canEdit) {
    setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div></div>`);
    return;
  }

  let blocks = [];
  try { blocks = JSON.parse(pg.content || '[]'); } catch(e) { blocks = []; }
  const otherBlocks = blocks.filter(b => b.type !== 'infobox');
  const kids = pages.filter(p => p.parent_slug === pg.slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));

  const chips = [{ id: 'all', label: lang === 'en' ? 'All' : 'Все' }];
  const chipSet = new Set(['all']);
  const typeMapRu = { article:'Статья', character:'Персонаж', faction:'Фракция', item:'Предмет', ability:'Способность', unit:'Юнит', preview:'Превью' };
  const typeMapEn = { article:'Article', character:'Character', faction:'Faction', item:'Item', ability:'Ability', unit:'Unit', preview:'Preview' };
  const cards = kids.map(k => {
    const pageType = _pvNorm(k.page_type || 'article') || 'article';
    const rows = _pvRowsFromPage(k);
    const subtype = _pvNorm(_pvSubtype(rows, pageType));
    const typeChip = `type:${pageType}`;
    if (!chipSet.has(typeChip)) {
      chipSet.add(typeChip);
      chips.push({ id: typeChip, label: (lang==='en' ? typeMapEn[pageType] : typeMapRu[pageType]) || pageType });
    }
    const specs = _pvPickSpecs(rows, pageType, subtype);
    return {
      slug: k.slug,
      title: pT(k),
      image: k.image_url || '',
      pageType,
      subtype,
      specs,
      rows
    };
  });

  _previewState[pg.slug] = _previewState[pg.slug] || { chip: 'all', key: 'all', val: '', sort: 'none' };
  const st = _previewState[pg.slug];
  const chipsHtml = chips.map(c =>
    `<button class="pv-chip${st.chip===c.id?' on':''}" onclick="pvSetFilter('${esc(pg.slug)}','${esc(c.id)}',this)">${esc(c.label)}</button>`
  ).join('');
  const cardsHtml = cards.map(c => {
    const specText = c.specs.map(([k,v]) => `${k} ${v}`).join(' ');
    const pairsText = c.rows.map(([k,v]) => `${_pvNorm(k)}::${String(v||'').trim()}`).join('||');
    const get = (name) => c.specs.find(([k]) => _pvNorm(k) === _pvNorm(name))?.[1] || '';
    const slot = get('Слот');
    const rarity = get('Редкость');
    const typeLabel = c.pageType === 'item' ? 'Предмет' : (c.pageType === 'unit' ? 'Юнит' : (c.pageType === 'ability' ? 'Способность' : 'Карточка'));
    const mainStatsOrder = ['Урон','Дальность','Темп стрельбы','Вес','Калибр','Цена'];
    const mainStats = mainStatsOrder.map(k => [k, get(k)]).filter(([,v]) => !!v).slice(0,3);
    const restStats = c.specs.filter(([k]) => !mainStats.some(([mk]) => _pvNorm(mk) === _pvNorm(k))).slice(0,5);
    const mainHtml = mainStats.length
      ? mainStats.map(([k,v]) => `<div class="pv-c-main"><span class="pv-c-main-k">${esc(_pvPrettyKey(k))}</span><span class="pv-c-main-v">${esc(v)}</span></div>`).join('')
      : `<div class="pv-c-main pv-c-main--empty"><span class="pv-c-main-k">Данные</span><span class="pv-c-main-v">—</span></div>`;
    const restHtml = restStats.map(([k,v]) => {
      const isPrice = /^(цена|стоимость|price|cost)$/i.test(k);
      return `<span class="pv-c-chip${isPrice?' pv-c-chip--price':''}">${esc(_pvPrettyKey(k))}: ${esc(v)}</span>`;
    }).join('');
    return `<div class="pv-card" data-type="${esc(c.pageType)}" data-title="${esc(c.title)}" data-spec="${esc(specText)}" data-pairs="${esc(pairsText)}" onclick="go('${esc(c.slug)}')">
      <div class="pv-c-media">${c.image?`<img src="${esc(c.image)}" alt="${esc(c.title)}" loading="lazy">`:`<div class="pv-c-noimg">◈</div>`}<div class="pv-c-media-grad"></div></div>
      <div class="pv-c-body">
        <div class="pv-c-topline">
          <span class="pv-c-type">${esc(typeLabel)}</span>
          ${slot?`<span class="pv-c-slot">${esc(slot)}</span>`:''}
          ${rarity?`<span class="pv-c-rarity">${esc(rarity)}</span>`:''}
        </div>
        <div class="pv-c-title">${esc(c.title)}</div>
        <div class="pv-c-main-grid">${mainHtml}</div>
        <div class="pv-c-specs">${restHtml || `<span class="pv-c-chip pv-c-chip--empty">Нет доп. характеристик</span>`}</div>
      </div>
    </div>`;
  }).join('');

  const cover = pg.image_url
    ? `<div class="art-cov" style="--cov-h:${pg.cover_height||340}px;--cov-pos:${pg.cover_pos||'center center'}"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${esc(pT(pg))}</h1></div></div><div class="art-cov-spacer"></div>`
    : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${esc(pT(pg))}</h1></div>`;
  const draftBanner = isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК</div>` : '';

  setPg(`${draftBanner}${cover}
    <div class="pv-wrap">
      <div class="pv-toolbar">
        <div class="pv-chips">${chipsHtml}</div>
      </div>
      <div class="pv-adv">
        <div class="pv-adv-row">
          <div class="pv-adv-label">${lang==='en'?'Characteristic':'Характеристика'}</div>
          <div class="pv-chipline" id="pv-key-chips"></div>
        </div>
        <div class="pv-adv-row" id="pv-val-chips" style="display:none"></div>
        <div class="pv-adv-row" id="pv-sort-chips" style="display:none"></div>
      </div>
      <div class="pv-meta">${lang==='en'?'Shown':'Показано'}: <span id="pv-count">0</span></div>
      <div class="pv-grid">${cardsHtml || `<div class="pv-empty">${lang==='en'?'No cards yet':'Карточки пока не добавлены'}</div>`}</div>
      ${otherBlocks.length ? `<div class="prose pv-extra">${otherBlocks.map(renderBlock).join('')}</div>` : ''}
    </div>`);

  pvRefreshOptions(pg.slug);
  pvApplyFilter(pg.slug);
  renderCommentsSection(pg.slug);
}

const mkCard = pg => {
  const typeClass = pg.page_type ? `card-${pg.page_type}` : 'card-default';
  return pg.image_url 
    ? `<div class="card ${typeClass}" onclick="go('${esc(pg.slug)}')"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="card-ov"><div class="card-hud-tl"></div><div class="card-hud-tr"></div><div class="card-status"></div></div><div class="card-nm"><span class="card-title">${esc(pT(pg))}</span></div></div>` 
    : `<div class="card ${typeClass}" onclick="go('${esc(pg.slug)}')"><div class="card-noimg"></div><div class="card-ov"><div class="card-hud-tl"></div><div class="card-hud-tr"></div><div class="card-status"></div></div><div class="card-nm"><span class="card-title">${esc(pT(pg))}</span></div></div>`;
};

function renderSectionPage(sec) {
  if (!sec) { setPg(`<div class="sempty"><div>${T('notFound')}</div></div>`); return; }
  const subSecs = sections.filter(s=>s.parent_id===sec.id).sort((a,b)=>a.sort_order-b.sort_order);
  const directPgs = pages.filter(p=>isVisiblePage(p)&&p.section===sec.slug&&!p.parent_slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const cover = sec.image_url
    ? `<div class="art-cov" style="--cov-h:340px;--cov-pos:center center"><img src="${esc(sec.image_url)}" alt="${esc(sN(sec))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${esc(sN(sec))}</h1></div></div><div class="art-cov-spacer"></div>`
    : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${esc(sN(sec))}</h1></div>`;

  let grid='';
  if (directPgs.length) grid = directPgs.some(p=>p.image_url) ? `<div class="cgrid">${directPgs.map(mkCard).join('')}</div>` : `<div class="flat-grid">${directPgs.map(k=>`<div class="flat-row" onclick="go('${esc(k.slug)}')">${esc(pT(k))}</div>`).join('')}</div>`;
  const subHtml = subSecs.map(sub=>{
    const spgs=pages.filter(p=>isVisiblePage(p)&&p.section===sub.slug&&!p.parent_slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    if (!spgs.length&&!user) return '';
    const sg=spgs.some(p=>p.image_url)?`<div class="cgrid">${spgs.map(mkCard).join('')}</div>`:`<div class="flat-grid">${spgs.map(k=>`<div class="flat-row" onclick="go('${esc(k.slug)}')">${esc(pT(k))}</div>`).join('')}</div>`;
    const iconHtml = sub.icon ? `<img src="${esc(sub.icon)}" alt="" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;margin-right:6px">` : '<span style="margin-right:6px">◈</span>';
    return `<div class="grp-hdr"><span class="grp-hdr-t" onclick="go('sec:${esc(sub.slug)}')">${iconHtml}${esc(sN(sub))}</span></div>${sg}`;
  }).filter(Boolean).join('');

  const isFracSec = sec.slug?.includes('frak')||sec.slug?.includes('frac')||sec.name_ru?.toLowerCase().includes('фракц');
  const fracBtn = (isFracSec && user?.role==='superadmin')
    ? `<div style="margin-top:20px"><button class="btn btn-gd" onclick="openFactionConstructor()">◈ + Новая фракция</button></div>`
    : '';
  setPg(`${cover}${grid}${subHtml}${!grid&&!subHtml?`<p style="color:var(--t3);font-size:13px;padding:20px 0">В этом разделе нет статей.</p>`:''}${fracBtn}`);
}

function renderBlocks(content) {
  if (!content) return `<p style="color:var(--t3);font-style:italic">${T('noContent')}</p>`;
  try {
    const blocks = JSON.parse(content);
    if (Array.isArray(blocks)) {
      _tocBlocks = blocks;
      const html = blocks.map(renderBlock).join('');
      _tocBlocks = null;
      return html;
    }
  } catch {}
  _tocBlocks = null;
  return renderMd(content);
}

// Build TOC from all heading/text blocks in same content string
function _buildTOCFromBlocks(blocks) {
  const heads = [];
  for (const b of blocks) {
    if (!b?.type) continue;
    if (b.type === 'heading') {
      const isSub = b.style === 'h-sub';
      const txt = (lang==='en' && b.text_en?.trim()) ? b.text_en : b.text || '';
      if (txt.trim()) heads.push({ level: isSub ? 3 : 2, text: txt.trim() });
    } else if (b.type === 'text' || b.type === 'frame' || b.type === 'callout') {
      const raw = (lang==='en' && b.content_en?.trim()) ? b.content_en : b.content || '';
      for (const line of raw.split('\n')) {
        const m3 = line.match(/^### (.+)/);
        const m2 = line.match(/^## (.+)/);
        if (m3)      heads.push({ level: 3, text: m3[1].trim() });
        else if (m2) heads.push({ level: 2, text: m2[1].trim() });
      }
    }
  }
  if (heads.length < 1) return '';
  let n2 = 0;
  const items = heads.map((h, i) => {
    if (h.level === 2) n2++;
    const num  = h.level === 2 ? n2 + '.' : '·';
    const pad  = h.level === 3 ? ' style="padding-left:18px;font-size:12px"' : '';
    return `<li${pad}><a class="wiki-toc-link" href="javascript:void(0)" onclick="wikiTocGo(${i})">`
         + `<span class="wiki-toc-num">${num}</span><span>${esc(h.text)}</span></a></li>`;
  }).join('');
  return `<div class="wiki-toc"><div class="wiki-toc-hdr" onclick="this.parentElement.classList.toggle('wiki-toc-collapsed')">`
       + `<span>◈ ${lang==='ru'?'СОДЕРЖАНИЕ':'CONTENTS'}</span><span class="wiki-toc-arr">▾</span></div>`
       + `<ul class="wiki-toc-list">${items}</ul></div>`;
}
// _tocBlocks is set by renderBlock when it encounters a 'toc' block
let _tocBlocks = null;
function wikiTocGo(idx) {
  const els = document.querySelectorAll('#pg .blk-heading, #pg h2, #pg h3');
  if (els[idx]) els[idx].scrollIntoView({ behavior:'smooth', block:'start' });
}

function renderBlock(b) {
  if (!b?.type) return '';
  switch(b.type) {
    case 'toc': {
      if (!_tocBlocks) return '';
      return _buildTOCFromBlocks(_tocBlocks);
    }
    case 'heading': return `<div class="blk blk-heading ${safeClass(b.style,SAFE_STYLES_HEADING,'h-scan')}">${esc((lang==='en'&&b.text_en?.trim())?b.text_en:b.text||'')}</div>`;
    case 'alert': {
      const v=safeClass(b.variant,SAFE_VARIANTS_ALERT,'intel'); const labels={classified:'ЗАСЕКРЕЧЕНО',secret:'КОНФИДЕНЦИАЛЬНО',intel:'РАЗВЕДДАННЫЕ'};
      return `<div class="blk blk-alert a-${v}"><span class="blk-alert-ico">${{classified:'🔴',secret:'🟡',intel:'🔵'}[v]||'◈'}</span><div style="flex:1"><div class="blk-alert-title">${esc(((lang==='en'&&b.title_en?.trim())?b.title_en:b.title)||labels[v])}</div><div class="blk-alert-body prose">${renderMd((lang==='en'&&b.content_en?.trim())?b.content_en:b.content||'')}</div></div></div>`;
    }
    case 'spoiler': return `<div class="blk blk-spoiler" id="sp-${escId(b.id)}"><button class="blk-spoiler-toggle" onclick="document.getElementById('sp-${escId(b.id)}').classList.toggle('open')"><span class="sp-arr">▶</span><span>${esc(((lang==='en'&&b.label_en?.trim())?b.label_en:b.label)||'СКРЫТАЯ ИНФОРМАЦИЯ')}</span></button><div class="blk-spoiler-body prose">${renderMd((lang==='en'&&b.content_en?.trim())?b.content_en:b.content||'')}</div></div>`;
    case 'stats': return `<div class="blk blk-stat-row">${(b.items||[]).map(it=>`<div class="blk-stat-item"><span class="blk-stat-val">${esc((lang==='en'&&it.val_en?.trim())?it.val_en:it.val||'')}</span><span class="blk-stat-lbl">${esc((lang==='en'&&it.label_en?.trim())?it.label_en:it.label||'')}</span></div>`).join('')}</div>`;
    case 'timeline': return `<div class="blk blk-timeline">${(b.items||[]).map(it=>{const d=(lang==='en'&&it.date_en?.trim())?it.date_en:it.date||'';const tx=(lang==='en'&&it.text_en?.trim())?it.text_en:it.text||((lang==='en'&&it.title_en?.trim())?it.title_en:it.title||'');return `<div class="blk-timeline-item">${d?`<div class="blk-timeline-date">${esc(d)}</div>`:''}${tx?`<div class="blk-timeline-text">${esc(tx)}</div>`:''}</div>`;}).join('')}</div>`;
    case 'text': return `<div class="blk prose">${renderMd((lang==='en'&&b.content_en?.trim())?b.content_en:b.content||'')}</div>`;
    case 'image': return `<div class="blk blk-image">${b.url?`<img src="${esc(safeUrl(b.url))}" alt="${esc(b.alt||'')}" loading="lazy" style="width:100%;max-height:${parseInt(b.maxh,10)||480}px;object-fit:cover;display:block;border:1px solid var(--w2);cursor:zoom-in" onclick="event.preventDefault();event.stopPropagation();openLightbox('${esc(safeUrl(b.url))}','${esc(b.alt||'')}');return false;">`:''}${b.caption?`<div class="bim-caption">${esc(b.caption)}</div>`:''}</div>`;
    case 'imgtext': return `<div class="blk blk-imgtext lay-${safeClass(b.layout,SAFE_LAYOUTS_IMGTEXT,'l')}"><div class="bim-i"><img src="${esc(safeUrl(b.imgUrl||''))}" alt="${esc(b.imgAlt||'')}" loading="lazy" style="cursor:zoom-in" onclick="event.preventDefault();event.stopPropagation();openLightbox('${esc(safeUrl(b.imgUrl||''))}','${esc(b.imgAlt||'')}');return false;">${((lang==='en'&&b.caption_en?.trim())?b.caption_en:b.caption)?`<div class="bim-caption">${esc(((lang==='en'&&b.caption_en?.trim())?b.caption_en:b.caption))}</div>`:''}</div><div class="bim-t"><div class="prose">${renderMd((lang==='en'&&b.content_en?.trim())?b.content_en:b.content||'')}</div></div></div>`;
    case 'callout': { const ct=(lang==='en'&&b.title_en?.trim())?b.title_en:b.title||''; return `<div class="blk blk-callout c-${safeClass(b.variant,SAFE_VARIANTS_CALLOUT,'info')}"><span class="blk-callout-ico">${esc(b.icon||'ℹ️')}</span><div>${ct?`<div class="blk-callout-title">${esc(ct)}</div>`:''}<div class="blk-callout-body prose">${renderMd((lang==='en'&&b.content_en?.trim())?b.content_en:b.content||'')}</div></div></div>`; }
    case 'frame': return `<div class="blk blk-frame"><div class="blk-frame-label">${esc((lang==='en'&&b.label_en?.trim())?b.label_en:b.label||'')}</div><div class="blk-frame-body prose">${renderMd((lang==='en'&&b.content_en?.trim())?b.content_en:b.content||'')}</div></div>`;
    case 'table': { const heads=(lang==='en'&&b.headers_en?.length)?b.headers_en.map((v,i)=>String(v||'').trim()||(b.headers||[])[i]||''):b.headers||[]; const rows=(lang==='en'&&b.rows_en?.length)?b.rows_en.map((row,ri)=>row.map((c,ci)=>String(c||'').trim()||((b.rows||[])[ri]||[])[ci]||'')):b.rows||[]; return `<div class="blk blk-table"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
    case 'divider': { const ds=safeClass(b.style,SAFE_STYLES_DIVIDER,'ornament'); const sym=ds==='ornament'?'◈ ◈ ◈':ds==='stars'?'✦ ✦ ✦':''; return `<div class="blk blk-divider d-${ds}">${sym?`<span class="bd-inner">${sym}</span>`:''}</div>`; }
    case 'cols': { const its=(lang==='en'&&b.items_en?.length)?b.items_en.map((v,i)=>String(v||'').trim()||(b.items||[])[i]||''):b.items||[]; return `<div class="blk blk-cols c${Math.min(parseInt(b.cols,10)||2,3)}">${its.map(item=>`<div class="blk-col-inner prose">${renderMd(item||'')}</div>`).join('')}</div>`; }
    case 'infobox': {
      const ibt=(lang==='en'&&b.title_en?.trim())?b.title_en:b.title||''; const ibs=(lang==='en'&&b.subtitle_en?.trim())?b.subtitle_en:b.subtitle||''; const ibl=(lang==='en'&&b.label_en?.trim())?b.label_en:b.label||''; const ibc=(lang==='en'&&b.img_caption_en?.trim())?b.img_caption_en:b.img_caption||'';
      const rs=(b.sections||[]).map(sec2=>{ const sn=(lang==='en'&&sec2.name_en?.trim())?sec2.name_en:sec2.name||''; const rh=(sec2.rows||[]).map(row=>{ const k=(lang==='en'&&row.key_en?.trim())?row.key_en:row.key||''; const v=(lang==='en'&&row.val_en?.trim())?row.val_en:row.val||''; if(!k&&!v) return ''; const _IB_RU={common:'Обычный',uncommon:'Необычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный',weapon:'Оружие',armor:'Броня',helmet:'Шлем',ring:'Кольцо',artifact:'Артефакт',consumable:'Расходник',passive:'Пассивная',action:'Действие',bonus:'Бонусное действие',reaction:'Реакция','1/day':'Раз в день','1/rest':'Раз в отдых'}; const vDisp=_IB_RU[v]||v; const vStr=String(v); const vh=/^https?:\/\//.test(vStr.trim())?`<a href="${esc(safeUrl(vStr))}" target="_blank">${esc(vStr)}</a>`:esc(vDisp); return `<div class="ib-row"><div class="ib-key">${esc(k)}</div><div class="ib-val">${vh}</div></div>`; }).filter(Boolean).join(''); return (sn?`<div class="ib-section">${esc(sn)}</div>`:'')+rh; }).join('');
      return `<div class="blk-infobox">${(ibl||ibt||ibs)?`<div class="ib-head">${ibl?`<span class="ib-head-label">${esc(ibl)}</span>`:''}<span class="ib-head-title">${esc(ibt)}</span>${ibs?`<span class="ib-head-sub">${esc(ibs)}</span>`:''}</div>`:''}${b.image_url?`<img class="ib-image" src="${esc(safeUrl(b.image_url))}" loading="lazy">${ibc?`<div class="ib-image-caption">${esc(ibc)}</div>`:''}`:''}${rs}</div>`;
    }
    case 'quote': return `<div class="blk blk-quote"><div class="blk-quote-text">${esc((lang==='en'&&b.text_en?.trim())?b.text_en:b.text||'')}</div>${((lang==='en'&&b.author_en?.trim())?b.author_en:b.author)?`<div class="blk-quote-author">${esc(((lang==='en'&&b.author_en?.trim())?b.author_en:b.author))}</div>`:''}</div>`;
    case 'gallery': return `<div class="blk blk-gallery ${(b.images?.length||0)<=2?'g2':'g3'}">${(b.images||[]).map(img=>`<img src="${esc(safeUrl(img))}" loading="lazy">`).join('')}</div>`;
    case 'battle_map': return renderBattleMapBlock(b);
    case 'rel_graph': return renderRelGraph(b);
    case 'vis_timeline': return renderVisTimeline(b);
    case 'chart': return renderChart(b);
    case 'statblock': return renderStatblock(b);
    default: return '';
  }
}

function il(t) {
  t = String(t).replace(/\x00/g,'');
  const ph = [];
  const mark = v => { ph.push(v); return '\x00'+(ph.length-1)+'\x00'; };
  // resolve all accumulated placeholders (recursive so nesting works)
  const resolve = s => {
    let prev;
    do { prev = s; s = s.replace(/\x00(\d+)\x00/g, (_,i) => ph[+i] || ''); } while (s !== prev);
    return s;
  };
  // XSS-защита: экранируем СЫРОЙ текст (вне плейсхолдеров) внутри тегов
  // [c:]/[bg:]/[center]/[fx:…]. Без этого их содержимое попадало в DOM как сырой
  // HTML (напр. <img onerror>) → stored XSS у всех читателей, включая модератора.
  // Легальный markdown к этому моменту уже в плейсхолдерах и не пострадает.
  const escFx = s => String(s).replace(/(\x00\d+\x00)|([^\x00]+)/g, (_, p, raw) => p || esc(raw));

  // FX schizo (админский «шизотекст») — раньше всего: внутри плоский текст → руны.
  t=t.replace(/\[fx:schizo\]([\s\S]*?)\[\/fx\]/g,(_,s)=>mark(schizoWrap(s)));

  // images first - with onclick handler
  t=t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,url)=>mark(`<img src="${esc(safeUrl(url))}" alt="${esc(alt)}" loading="lazy" style="cursor:zoom-in" onclick="event.preventDefault();event.stopPropagation();openLightbox('${esc(safeUrl(url))}','${esc(alt)}');return false;">`));
  
  // Remove image links syntax [![alt](img)](link) -> just image
  t=t.replace(/\[(\x00\d+\x00)\]\([^)]+\)/g, '$1');
  
  // page links
  t=t.replace(/\[page:([^\]]+)\]/g,(_,s)=>{const pg=pages.find(x=>x.slug===s);return mark(`<a href="javascript:void(0)" onclick="go('${esc(s)}')">${pg?esc(pT(pg)):esc(s)}</a>`);});
  
  // regular links
  t=t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,text,url)=>mark(`<a href="${esc(safeUrl(url))}" target="_blank">${esc(text)}</a>`));

  // faction mention chip — [fac:FID|FLAG_URL]Имя[/fac] (флаг необязателен).
  // «Пинг» страны: при публикации новости FID попадает в mentions, а упомянутая
  // фракция видит запись в своей ленте «Оповещения». Если задан флаг — показываем
  // его картинкой; иначе (или при ошибке загрузки) — символ ⬡.
  t=t.replace(/\[fac:([^\]|]+)(?:\|([^\]]*))?\]([\s\S]*?)\[\/fac\]/g,(_,fid,flag,s)=>{
    // флаг: из тега, иначе резолвим по FID из реестра (старые упоминания без URL)
    let url = (flag && flag.trim()) || '';
    if (!url && typeof fnFlagFor === 'function') { try { url = fnFlagFor(fid) || ''; } catch (e) {} }
    const ic = url
      ? `<img class="md-fac-flag" src="${esc(safeUrl(url))}" alt="" onerror="this.outerHTML='⬡'">`
      : '⬡';
    return mark(`<span class="md-fac" onclick="if(typeof fnGotoFaction==='function')fnGotoFaction('${esc(fid)}',event)" title="Перейти к фракции «${esc(s)}»">${ic}<span>${esc(s)}</span></span>`);
  });

  // standard MD (innermost — process first so they can be nested inside others)
  t=t.replace(/\*\*([^*]+)\*\*/g,(_,s)=>mark(`<strong>${esc(s)}</strong>`));
  t=t.replace(/\*([^*]+)\*/g,(_,s)=>mark(`<em>${esc(s)}</em>`));
  t=t.replace(/`([^`]+)`/g,(_,s)=>mark(`<code>${esc(s)}</code>`));

  // color — inner, can wrap MD marks
  const colMap={gold:'tc-gold',cyan:'tc-cyan',red:'tc-red',purple:'tc-purple',green:'tc-green',dim:'tc-dim'};
  t=t.replace(/\[c:(\w+)\]([\s\S]*?)\[\/c\]/g,(_,k,s)=>mark(`<span class="${colMap[k]||'tc-cyan'}">${resolve(escFx(s))}</span>`));

  // background highlight — inner, can wrap color/MD
  const bgMap={cyber:'bg-cyber',gold:'bg-gold',danger:'bg-danger',lore:'bg-lore',redacted:'bg-redacted'};
  t=t.replace(/\[bg:(\w+)\]([\s\S]*?)\[\/bg\]/g,(_,k,s)=>mark(`<span class="${bgMap[k]||'bg-cyber'}">${resolve(escFx(s))}</span>`));

  // alignment — блочное выравнивание абзаца (центр / право / лево)
  t=t.replace(/\[(center|right|left)\]([\s\S]*?)\[\/\1\]/g,(_,a,s)=>mark(`<span class="al-${a}">${resolve(escFx(s))}</span>`));

  // FX — outermost, wraps everything above
  t=t.replace(/\[fx:scanner\]([\s\S]*?)\[\/fx\]/g,(_,s)=>mark(`<span class="fx-scanner">${resolve(escFx(s))}</span>`));
  t=t.replace(/\[fx:glitch\]([\s\S]*?)\[\/fx\]/g,(_,s)=>{const inner=resolve(escFx(s));return mark(`<span class="fx-glitch" data-text="${esc(s)}">${inner}</span>`);});
  t=t.replace(/\[fx:jitter\]([\s\S]*?)\[\/fx\]/g,(_,s)=>mark(jitterWrap(resolve(escFx(s)))));

  // escape remaining raw text (only what's left outside placeholders)
  t = t.replace(/(\x00\d+\x00)|([^\x00]+)/g, (_, ph_match, raw) => ph_match || esc(raw));
  return resolve(t);
}

function jitterWrap(text) {
  // Small varied offsets — subtle, not epileptic
  const offsets = [
    [[-0.6, 0.4],[ 0.5,-0.3]],
    [[ 0.4,-0.5],[-0.5, 0.4]],
    [[-0.3, 0.6],[ 0.4,-0.5]],
    [[ 0.5,-0.3],[-0.4, 0.5]],
    [[-0.4, 0.3],[ 0.6,-0.4]],
    [[ 0.3,-0.6],[-0.3, 0.5]],
  ];
  const durations = [0.20, 0.24, 0.18, 0.22, 0.26, 0.20];
  const letters = [...text].map((ch, i) => {
    if (ch === ' ') return `<span style="display:inline-block;width:.3em"> </span>`;
    const o = offsets[i % offsets.length];
    const d = durations[i % durations.length];
    const delay = (i * 0.018).toFixed(3);
    return `<span class="jl" style="--jx1:${o[0][0]}px;--jy1:${o[0][1]}px;--jx2:${o[1][0]}px;--jy2:${o[1][1]}px;--jd:${d}s;animation-delay:${delay}s">${ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch}</span>`;
  }).join('');
  return `<span class="fx-jitter">${letters}</span>`;
}

// ── FX: SCHIZO («шизотекст») ──────────────────────────────────
// Текст показывается анимированными хаотичными рунами; при наведении курсора
// небольшая зона вокруг него «фонариком» высвечивает оригинальные буквы.
// Каждый символ — пара слоёв: настоящая буква (скрыта) + руна (поверх).
const SCHIZO_RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟᛃᛘᛯᛦᚷᚦ⌖⍜⎔⏃⌬';
function schizoRune() { return SCHIZO_RUNES.charAt((Math.random() * SCHIZO_RUNES.length) | 0); }
function schizoWrap(text) {
  const cleanText = String(text).replace(/\r/g, '').trim();
  const cells = [...cleanText].map(ch => {
    if (ch === '\n') return '<br>';                                   // перенос строки внутри блока
    if (ch === ' ' || ch === '\t') return '<span class="sz-sp"> </span>';
    const e = ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : esc(ch);
    return `<span class="sz-c"><span class="sz-real">${e}</span><span class="sz-rune" aria-hidden="true">${schizoRune()}</span></span>`;
  }).join('');
  if (typeof window !== 'undefined') setTimeout(schizoEnsure, 0);
  return `<span class="fx-schizo" onmousemove="schizoMove(event,this)" onmouseleave="schizoLeave(this)" ontouchstart="schizoMove(event,this)" ontouchmove="schizoMove(event,this)" ontouchend="schizoLeave(this)" title="наведи — высветится оригинал">${cells}</span>`;
}
let _schizoTimer = null;
function schizoEnsure() { if (_schizoTimer == null) _schizoTimer = setInterval(schizoTick, 110); }
function schizoTick() {
  const runes = document.querySelectorAll('.fx-schizo .sz-rune');
  if (!runes.length) { clearInterval(_schizoTimer); _schizoTimer = null; return; }   // нет шизотекста на экране — гасим таймер
  for (let i = 0; i < runes.length; i++) { if (Math.random() < 0.45) runes[i].textContent = schizoRune(); }
}
let _schizoRaf = 0;
function schizoMove(ev, root) {
  const pt = (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
  const x = pt.clientX, y = pt.clientY;
  if (_schizoRaf) return;                                  // троттлинг через rAF
  _schizoRaf = requestAnimationFrame(() => {
    _schizoRaf = 0;
    const cells = root.__cells || (root.__cells = [].slice.call(root.querySelectorAll('.sz-c')));
    const R2 = 42 * 42;                                     // радиус «фонарика»
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i].getBoundingClientRect();
      const dx = (r.left + r.width / 2) - x, dy = (r.top + r.height / 2) - y;
      const lit = (dx * dx + dy * dy) < R2;
      if (lit !== cells[i].__lit) { cells[i].__lit = lit; cells[i].classList.toggle('lit', lit); }
    }
  });
}
function schizoLeave(root) {
  const cells = root.__cells || [];
  for (let i = 0; i < cells.length; i++) { if (cells[i].__lit) { cells[i].__lit = false; cells[i].classList.remove('lit'); } }
}
function renderMd(txt) {
  if (!txt && txt !== 0) return ''; txt = String(txt); const lines=txt.split('\n'); let out='',ul=false; const eu=()=>{if(ul){out+='</ul>';ul=false;}};
  for(const l of lines){
    if(/^### (.+)/.test(l)){eu();out+=`<h3>${il(l.slice(4))}</h3>`;} else if(/^## (.+)/.test(l)){eu();out+=`<h2>${il(l.slice(3))}</h2>`;} else if(/^# (.+)/.test(l)){eu();out+=`<h1>${il(l.slice(2))}</h1>`;} else if(l==='---'){eu();out+='<hr>';} else if(/^> (.+)/.test(l)){eu();out+=`<blockquote>${il(l.slice(2))}</blockquote>`;} else if(/^[-*] (.+)/.test(l)){if(!ul){out+='<ul>';ul=true;}out+=`<li>${il(l.replace(/^[-*] /,''))}</li>`;} else if(l.trim()===''){eu();} else{eu();out+=`<p>${il(l)}</p>`;}
  } eu(); return out;
}

function buildNav(filt='') {
  const q=(filt||'').toLowerCase().trim();
  const L=(ru,en)=>lang==='ru'?ru:en;
  let h=`<a class="n-home${curSlug==='home'?' on':''}" id="ntl-h" href="#home" onclick="return navGo(event,'home')"><span class="n-home-icon">⌂</span>${T('home')}</a>`;
  // Гайдбук — сразу под главной (важно для новичков)
  h+=`<a class="n-home${curSlug==='guide'?' on':''}" id="ntl-guide" href="#guide" onclick="return navGo(event,'guide')"><span class="n-home-icon">📖</span>${L('Игровой гайдбук','Game guidebook')}</a>`;
  // ── Группа «Правила проекта» (раскрывающаяся): отдельные страницы правил ──
  const ruleItems=[['rules-general','◈',L('Общие правила','General rules')],['rules-charter','⚖',L('Устав проекта','Charter')],['rules-rp','⚔',L('Регламент RP и боёв','RP & combat')],['rules-conduct','⚠',L('Дисциплина и общение','Conduct')],['rules-naming','✎',L('Регистрация и нейминг','Registration')]];
  const rulesActive=(curSlug||'').startsWith('rules-');
  h+=`<div class="n-group${rulesActive?' op':''}" id="nav-rules">
    <div class="n-group-hdr${rulesActive?' on':''}" id="ntl-rules" onclick="document.getElementById('nav-rules').classList.toggle('op')">
      <span class="n-home-icon">⚖</span><span class="n-group-t">${L('Правила проекта','Project rules')}</span><span class="n-group-arr">▸</span>
    </div>
    <div class="n-group-body">
      ${ruleItems.map(([sl,ic,nm])=>`<a class="n-sub${curSlug===sl?' on':''}" id="ntl-${sl}" href="#${sl}" onclick="return navGo(event,'${sl}')"><span class="n-home-icon">${ic}</span>${nm}</a>`).join('')}
    </div>
  </div>`;
  // Кабинет игрока — высоко: игрокам с одобренной анкетой и стаффу
  if (typeof ecNavEnsure==='function') ecNavEnsure();
  if (typeof ecCanAccess==='function' && ecCanAccess()) {
    h+=`<a class="n-home${curSlug==='economy'?' on':''}" id="ntl-eco" href="#economy" onclick="return navGo(event,'economy')"><span class="n-home-icon">🛰</span>${L('Кабинет игрока','Cabinet')}</a>`;
  }
  h+=`<a class="n-home${curSlug==='map'?' on':''}" id="ntl-map" href="#map" onclick="return navGo(event,'map')"><span class="n-home-icon">🜨</span>${L('Карта галактики','Galaxy map')}</a>`;
  h+=`<a class="n-home${curSlug==='factions'||curSlug==='faction-new'?' on':''}" id="ntl-fac" href="#factions" onclick="return navGo(event,'factions')"><span class="n-home-icon">⬡</span>${L('Фракции','Factions')}</a>`;
  // Игровые локации — игрокам с одобренной анкетой и стаффу
  if (typeof canSeeLocations==='function' && canSeeLocations()) {
    h+=`<a class="n-home${curSlug==='locations'?' on':''}" id="ntl-loc" href="#locations" onclick="return navGo(event,'locations')"><span class="n-home-icon">⛬</span>${L('Игровые локации','Game locations')}</a>`;
  }
  // Конструкторы — игрокам с одобренной анкетой и стаффу
  if (typeof cnNavEnsure==='function') cnNavEnsure();
  if (typeof cnCanAccess==='function' && cnCanAccess()) {
    const cnOn = (curSlug==='constructors'||(curSlug||'').startsWith('build-'))?' on':'';
    h+=`<a class="n-home${cnOn}" id="ntl-con" href="#constructors" onclick="return navGo(event,'constructors')"><span class="n-home-icon">⚒</span>${L('Конструкторы','Constructors')}</a>`;
  }
  // ── Группа «Войска»: каталоги юнитов (раскрывающаяся) ──
  const cnCats=[['cat-ships','🚀',L('Флот','Fleet')],['cat-ground','🛡',L('Наземная техника','Ground')],['cat-aviation','✈',L('Авиация','Aviation')],['cat-divisions','⛬',L('Дивизии','Divisions')]];
  const troopsActive=(curSlug||'').startsWith('cat-');
  h+=`<div class="n-group${troopsActive?' op':''}" id="nav-troops">
    <div class="n-group-hdr${troopsActive?' on':''}" id="ntl-troops" onclick="document.getElementById('nav-troops').classList.toggle('op')">
      <span class="n-home-icon">⚔</span><span class="n-group-t">${L('Войска','Forces')}</span><span class="n-group-arr">▸</span>
    </div>
    <div class="n-group-body">
      ${cnCats.map(([sl,ic,nm])=>`<a class="n-sub${curSlug===sl?' on':''}" id="ntl-${sl}" href="#${sl}" onclick="return navGo(event,'${sl}')"><span class="n-home-icon">${ic}</span>${nm}</a>`).join('')}
    </div>
  </div>`;
  // Администрирование — только суперадмины и эдиторы
  if (typeof adCanAccess==='function' && adCanAccess()) {
    h+=`<a class="n-home${curSlug==='admin'?' on':''}" id="ntl-adm" href="#admin" onclick="return navGo(event,'admin')"><span class="n-home-icon">🛠</span>${L('Управление','Admin')}</a>`;
  }
  h+=`<div class="nav-divider"></div>`;

  if (q) {
    const matched=pages.filter(p=>isVisiblePage(p)&&(pT(p).toLowerCase().includes(q)||(p.slug&&p.slug.toLowerCase().includes(q))));
    if(!matched.length) h+=`<div class="nav-no-results">${lang==='ru'?'Ничего не найдено':'Nothing found'}</div>`;
    else {
      h+=`<div class="nav-search-count">${matched.length} ${T('articles')}</div>`;
      matched.forEach(p=>{
        const sec=p.section?sections.find(s=>s.slug===p.section):null;
        const trail=sec?`<span style="font-size:9px;color:var(--t4);font-family:JetBrains Mono,monospace;display:block;margin-top:1px;letter-spacing:.5px">${sN(sec)}</span>`:'';
        h+=`<a class="np${curSlug===p.slug?' on':''}" href="#${esc(p.slug)}" onclick="return navGo(event,'${esc(p.slug)}')">${esc(pT(p))}${trail}</a>`;
      });
    }
    document.getElementById('nav').innerHTML=h; setAct(curSlug||'home'); return;
  }

  // Локации (page_type='location') не показываем в дереве вики — у них свой
  // хаб «Игровые локации». Иначе авто-страницы столиц засоряют боковое меню.
  const isNav = p => isVisiblePage(p) && p.page_type !== 'location';
  const topSecs=sections.filter(s=>!s.parent_id).sort((a,b)=>a.sort_order-b.sort_order);
  topSecs.forEach(sec=>{
    const subSecs=sections.filter(s=>s.parent_id===sec.id).sort((a,b)=>a.sort_order-b.sort_order);
    const directPgs=pages.filter(p=>isNav(p)&&p.section===sec.slug&&!p.parent_slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    const totalCnt=pages.filter(p=>isNav(p)&&(p.section===sec.slug||subSecs.some(ss=>ss.slug===p.section))).length;
    const hasContent=directPgs.length||subSecs.some(ss=>pages.some(p=>isNav(p)&&p.section===ss.slug));
    if (!hasContent&&!user) return;

    // Section is open if current slug is this section, or a page/subsection inside it
    const isSecPage = curSlug==='sec:'+sec.slug;
    const hasActivePg = directPgs.some(p=>p.slug===curSlug) ||
      subSecs.some(sub=>pages.filter(p=>isNav(p)&&p.section===sub.slug).some(p=>p.slug===curSlug));
    const isOpen = isSecPage || hasActivePg;

    const _secIconUrl = sec.icon && /^(https?:|data:)/i.test(sec.icon);
    const iconHtml = _secIconUrl ? `<span class="nl-ico"><img src="${esc(sec.icon)}" alt=""></span>` : `<span class="nl-ico" style="font-size:9px;color:var(--t4)">◈</span>`;
    const bigIconHtml = sec.icon && sec.icon.startsWith('http') ? `<div class="nl-big-icon"><img src="${esc(sec.icon)}" alt=""></div>` : '';
    const cntHtml = totalCnt ? `<span class="nl-cnt">${totalCnt}</span>` : '';

    h+=`<div class="ns${isOpen?' op':''}" id="ns-${sec.id}">`;
    h+=`<div class="nl-hdr${isSecPage?' on':''}" id="nlh-${sec.id}" onclick="tgNs('${sec.id}','${esc(sec.slug)}')">${bigIconHtml}${iconHtml}<span class="nl-name">${esc(sN(sec))}</span>${cntHtml}<span class="nl-arr">▶</span></div>`;
    h+=`<div class="nl-body" id="nlb-${sec.id}">`;
    directPgs.forEach(p=>{h+=npEl(p,pages);});
    subSecs.forEach(sub=>{
      const spgs=pages.filter(p=>isNav(p)&&p.section===sub.slug&&!p.parent_slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
      if(!spgs.length&&!user) return;
      const subHasActive=spgs.some(p=>p.slug===curSlug||pages.filter(c=>isNav(c)&&c.parent_slug===p.slug).some(c=>c.slug===curSlug));
      const subCnt=spgs.length?`<span class="ng-cnt">${spgs.length}</span>`:'';
      h+=`<div class="ng${subHasActive?' op':''}" id="ng-${sub.id}"><div class="ng-hdr" id="ngh-${sub.id}" onclick="tgNg('${sub.id}')"><span class="ng-arr">▶</span><span class="ng-t">${esc(sN(sub))}</span>${subCnt}</div><div class="ng-body">${spgs.map(p=>npEl(p,pages)).join('')}</div></div>`;
    });
    h+=`</div></div>`;
  });

  const orphans=pages.filter(p=>isNav(p)&&!p.section&&!p.parent_slug&&p.slug!=='home');
  if(orphans.length){
    h+=`<div class="nav-divider" style="margin-top:8px"></div>`;
    h+=`<div class="nl-static">${T('other')}</div>`;
    orphans.forEach(p=>{h+=npEl(p,pages);});
  }
  document.getElementById('nav').innerHTML=h;
  setAct(curSlug||'home');
  
  // Добавляем блок "Близкие по теме" если есть текущая страница с тегами
  renderRelatedArticles();
}

function npEl(p,all) {
  const kids=all.filter(c=>isVisiblePage(c)&&c.parent_slug===p.slug).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const dd=(user&&p.status==='draft')?'<span class="np-d">DFT</span>':'';
  const isOpen=kids.some(k=>k.slug===curSlug||all.filter(c=>isVisiblePage(c)&&c.parent_slug===k.slug).some(c=>c.slug===curSlug));
  if(!kids.length) return `<a class="np${curSlug===p.slug?' on':''}" id="np-${p.slug}" href="#${esc(p.slug)}" onclick="return navGo(event,'${esc(p.slug)}')">${esc(pT(p))}${dd}</a>`;
  return `<div class="ng${isOpen||curSlug===p.slug?' op':''}" id="ngp-${p.slug}"><div class="ng-hdr${curSlug===p.slug?' on':''}" id="ngph-${p.slug}" onclick="tgNgP('${p.slug}')"><span class="ng-arr">▶</span><a class="ng-t" href="#${esc(p.slug)}" onclick="event.stopPropagation();return navGo(event,'${esc(p.slug)}')">${esc(pT(p))}${dd}</a></div><div class="ng-body">${kids.map(k=>npEl(k,all)).join('')}</div></div>`;
}

const tgNs = (id, secSlug) => {
  const ns = document.getElementById('ns-'+id);
  const hdr = document.getElementById('nlh-'+id);
  if (!ns) return;
  const wasOpen = ns.classList.contains('op');
  if (wasOpen) { ns.classList.remove('op'); }
  else { ns.classList.add('op'); }
};
const tgNg  = id   => { document.getElementById('ng-'+id)?.classList.toggle('op'); };
const tgNgP = slug => { document.getElementById('ngp-'+slug)?.classList.toggle('op'); };

function setAct(slug) {
  // Clear ALL active states
  document.querySelectorAll('.np,.n-home,.ng-hdr,.nl-hdr,.n-group-hdr,.n-sub').forEach(el=>el.classList.remove('on'));
  // Set active page
  document.getElementById('np-'+slug)?.classList.add('on');
  // Верхнеуровневые спец-разделы (Главная, Карта, Фракции, Конструкторы,
  // Кабинет, Управление, Гайдбук, каталоги) — подсветка по slug→id кнопки.
  const TOP_NAV = {
    'home': 'ntl-h', 'map': 'ntl-map',
    'factions': 'ntl-fac', 'faction-new': 'ntl-fac', 'locations': 'ntl-loc',
    'economy': 'ntl-eco', 'admin': 'ntl-adm', 'guide': 'ntl-guide',
    'constructors': 'ntl-con', 'build-ship': 'ntl-con', 'build-ground': 'ntl-con',
    'build-aviation': 'ntl-con', 'build-division': 'ntl-con',
    'cat-ships': 'ntl-cat-ships', 'cat-ground': 'ntl-cat-ground',
    'cat-aviation': 'ntl-cat-aviation', 'cat-divisions': 'ntl-cat-divisions',
  };
  if (TOP_NAV[slug]) document.getElementById(TOP_NAV[slug])?.classList.add('on');
  // Каталог войск — подсветить заголовок группы и раскрыть её
  if (slug.startsWith('cat-')) {
    document.getElementById('ntl-troops')?.classList.add('on');
    document.getElementById('nav-troops')?.classList.add('op');
  }
  // Правила проекта — подсветить активную подстраницу, заголовок группы и раскрыть её
  if (slug.startsWith('rules-')) {
    document.getElementById('ntl-'+slug)?.classList.add('on');
    document.getElementById('ntl-rules')?.classList.add('on');
    document.getElementById('nav-rules')?.classList.add('op');
  }
  // Active page parent
  const pg=pages.find(p=>p.slug===slug);
  if(pg?.parent_slug){
    document.getElementById('ngph-'+pg.parent_slug)?.classList.add('on');
    document.getElementById('ngp-'+pg.parent_slug)?.classList.add('op');
  }
  // Section active
  if(slug.startsWith('sec:')) {
    const secSlug=slug.slice(4);
    const sec=sections.find(s=>s.slug===secSlug);
    if(sec) {
      document.getElementById('nlh-'+sec.id)?.classList.add('on');
      document.getElementById('ns-'+sec.id)?.classList.add('op');
    }
  }
  // Ensure containing section is open for active page
  if(pg?.section) {
    const sec=sections.find(s=>s.slug===pg.section);
    if(sec) {
      const parentSec = sec.parent_id ? sections.find(s=>s.id===sec.parent_id) : sec;
      const topSec = parentSec || sec;
      document.getElementById('ns-'+topSec.id)?.classList.add('op');
    }
  }
}
function updTopBcSec(sec) {
  const el=document.getElementById('top-bc'); if(!el) return;
  const parts=[`<span class="bc-item" onclick="go('home')">${T('home')}</span>`];
  if(sec){
    const parSec=sec.parent_id?sections.find(s=>s.id===sec.parent_id):null;
    if(parSec) parts.push(`<span class="bc-sep">›</span><span class="bc-item" onclick="go('sec:${esc(parSec.slug)}')">${esc(sN(parSec))}</span>`);
    parts.push(`<span class="bc-sep">›</span><span class="bc-current">${esc(sN(sec))}</span>`);
  }
  el.innerHTML=parts.join('');
}
function updTopBc(slug, pg) {
  const el=document.getElementById('top-bc'); if(!el) return;
  if(slug==='home'){el.innerHTML=`<span class="bc-current">${T('home')}</span>`;return;}
  const parts=[`<span class="bc-item" onclick="go('home')">${T('home')}</span>`];
  if(pg){
    const sec=sections.find(s=>s.slug===pg.section);
    if(sec){
      const parSec=sec.parent_id?sections.find(s=>s.id===sec.parent_id):null;
      if(parSec) parts.push(`<span class="bc-sep">›</span><span class="bc-item" onclick="go('sec:${esc(parSec.slug)}')">${esc(sN(parSec))}</span>`);
      parts.push(`<span class="bc-sep">›</span><span class="bc-item" onclick="go('sec:${esc(sec.slug)}')">${esc(sN(sec))}</span>`);
    }
    const chain=[]; let cur=pg;
    while(cur.parent_slug){const par=pages.find(x=>x.slug===cur.parent_slug);if(!par) break;chain.unshift(par);cur=par;}
    chain.forEach(pp=>parts.push(`<span class="bc-sep">›</span><span class="bc-item" onclick="go('${esc(pp.slug)}')">${esc(pT(pp))}</span>`));
    parts.push(`<span class="bc-sep">›</span><span class="bc-current">${esc(pT(pg))}</span>`);
  } else { parts.push(`<span class="bc-sep">›</span><span class="bc-current">${esc(slug)}</span>`); }
  el.innerHTML=parts.join('');
}

// ВАЖНО: Убрали await getSession(), теперь редактор открывается мгновенно и не виснет

// ════════════════════════════════════════════════════════════
// БЛОК: ГРАФ СВЯЗЕЙ (rel_graph)
// ════════════════════════════════════════════════════════════
function renderRelGraph(b) {
  const bid = 'rg-' + (b.id || uid());
  const nodes = b.nodes || [];
  const edges = b.edges || [];
  const title = (lang==='en'&&b.title_en?.trim()) ? b.title_en : b.title || '';
  const dataNodes = esc(JSON.stringify(nodes));
  const dataEdges = esc(JSON.stringify(edges));
  return `<div class="blk blk-rel-graph" id="${bid}-wrap">
  ${title ? `<div class="blk-rg-title">${esc(title)}</div>` : ''}
  <div class="blk-rg-canvas-wrap">
    <canvas id="${bid}" class="blk-rg-canvas" data-nodes="${dataNodes}" data-edges="${dataEdges}"></canvas>
    <div class="blk-rg-tooltip" id="${bid}-tip"></div>
  </div>
</div>`;
}

function initRelGraph(id, nodes, edges) {
  const canvas = document.getElementById(id);
  if (!canvas || !nodes.length) return;
  const wrap = canvas.parentElement;
  const W = wrap.offsetWidth || wrap.getBoundingClientRect().width || document.getElementById('pg')?.offsetWidth || 600;
  const H = Math.max(300, Math.min(480, Math.round(W * 0.52)));
  canvas.width = W;
  canvas.height = H;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');

  // Layout: arrange nodes in circle if no positions given
  nodes.forEach((n, i) => {
    if (n.x === undefined) {
      const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      const rx = W * 0.36, ry = H * 0.36;
      n.x = W / 2 + Math.cos(angle) * rx;
      n.y = H / 2 + Math.sin(angle) * ry;
    }
    n.vx = 0; n.vy = 0;
  });

  // Color scheme matching wiki palette
  const COLORS = {
    default: { fill: 'hsl(215 12% 18%)', stroke: 'hsl(190 60% 45%)', text: 'hsl(220 15% 88%)' },
    hero:    { fill: 'hsl(35 60% 16%)',  stroke: 'hsl(35 85% 55%)',  text: 'hsl(35 90% 80%)' },
    villain: { fill: 'hsl(0 30% 15%)',   stroke: 'hsl(0 70% 50%)',   text: 'hsl(0 80% 80%)' },
    faction: { fill: 'hsl(270 20% 16%)', stroke: 'hsl(270 55% 55%)', text: 'hsl(270 70% 82%)' },
    place:   { fill: 'hsl(160 20% 14%)', stroke: 'hsl(160 60% 42%)', text: 'hsl(160 70% 75%)' },
  };
  const EDGE_COLORS = {
    default:  'hsl(220 15% 40%)',
    ally:     'hsl(160 60% 42%)',
    enemy:    'hsl(0 70% 50%)',
    family:   'hsl(35 85% 55%)',
    subordinate: 'hsl(190 60% 45%)',
    romantic: 'hsl(320 60% 55%)',
  };

  let dragNode = null, dragOffX = 0, dragOffY = 0;
  let hovNode = null;
  const tip = document.getElementById(id + '-tip');

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Draw edges
    edges.forEach(e => {
      const s = nodes.find(n => n.id === e.from);
      const t = nodes.find(n => n.id === e.to);
      if (!s || !t) return;
      const color = EDGE_COLORS[e.type] || EDGE_COLORS.default;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = e.strength ? Math.max(1, Math.min(4, e.strength)) : 1.5;
      ctx.globalAlpha = 0.65;
      ctx.setLineDash(e.dashed ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      // Edge label
      if (e.label) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = color;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, (s.x + t.x) / 2, (s.y + t.y) / 2 - 5);
      }
      ctx.restore();
    });

    // Draw nodes
    nodes.forEach(n => {
      const c = COLORS[n.type] || COLORS.default;
      const r = n.size ? Math.max(18, Math.min(40, n.size)) : 24;
      const isHov = hovNode === n;
      ctx.save();
      // Glow on hover
      if (isHov) {
        ctx.shadowColor = c.stroke;
        ctx.shadowBlur = 18;
      }
      // Node body
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = c.fill;
      ctx.fill();
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = isHov ? 2.5 : 1.5;
      ctx.globalAlpha = isHov ? 1 : 0.85;
      ctx.stroke();
      // Node avatar initial
      if (n.avatar) {
        // skip img for performance; draw initial only
      }
      const initials = (n.label || '?').slice(0, 2).toUpperCase();
      ctx.fillStyle = c.text;
      ctx.font = `700 ${Math.round(r * 0.55)}px Rajdhani, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 1;
      ctx.fillText(initials, n.x, n.y);
      // Node label below
      ctx.font = `${Math.round(r * 0.42)}px Exo 2, sans-serif`;
      ctx.fillStyle = c.text;
      ctx.globalAlpha = 0.9;
      ctx.fillText(n.label || '', n.x, n.y + r + 11);
      ctx.restore();
    });
  }

  function getNode(mx, my) {
    return nodes.find(n => {
      const r = n.size ? Math.max(18, Math.min(40, n.size)) : 24;
      return Math.hypot(n.x - mx, n.y - my) < r + 4;
    });
  }

  canvas.addEventListener('mousedown', e => {
    if (!editMode) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    dragNode = getNode(mx, my);
    if (dragNode) { dragOffX = dragNode.x - mx; dragOffY = dragNode.y - my; }
  });
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    if (dragNode && editMode) {
      dragNode.x = mx + dragOffX;
      dragNode.y = my + dragOffY;
      draw();
    } else {
      const h = getNode(mx, my);
      if (h !== hovNode) { hovNode = h; draw(); }
      if (h && tip) {
        tip.textContent = h.desc || h.label || '';
        tip.style.display = h.desc ? 'block' : 'none';
        tip.style.left = (e.clientX - canvas.getBoundingClientRect().left + 12) + 'px';
        tip.style.top  = (e.clientY - canvas.getBoundingClientRect().top  - 8) + 'px';
      } else if (tip) { tip.style.display = 'none'; }
    }
  });
  canvas.addEventListener('mouseup', () => { dragNode = null; });
  canvas.addEventListener('mouseleave', () => { dragNode = null; hovNode = null; if (tip) tip.style.display='none'; draw(); });

  // Touch support — only in editMode
  canvas.addEventListener('touchstart', e => {
    if (!editMode) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    const mx = (t.clientX - rect.left) * (W / rect.width);
    const my = (t.clientY - rect.top) * (H / rect.height);
    dragNode = getNode(mx, my);
    if (dragNode) { dragOffX = dragNode.x - mx; dragOffY = dragNode.y - my; }
  }, {passive:false});
  canvas.addEventListener('touchmove', e => {
    if (!editMode || !dragNode) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    dragNode.x = (t.clientX - rect.left) * (W / rect.width) + dragOffX;
    dragNode.y = (t.clientY - rect.top) * (H / rect.height) + dragOffY;
    draw();
  }, {passive:false});
  canvas.addEventListener('touchend', () => { dragNode = null; });

  draw();
}

// ════════════════════════════════════════════════════════════
// БЛОК: ВИЗУАЛЬНЫЙ ТАЙМЛАЙН (vis_timeline)
// ════════════════════════════════════════════════════════════

const BVT_CATS = {
  default:   { icon: '◈', label: 'Событие',      labelEn: 'Event'       },
  character: { icon: '◉', label: 'Персонаж',     labelEn: 'Character'   },
  tech:      { icon: '⬡', label: 'Технология',   labelEn: 'Technology'  },
  war:       { icon: '✦', label: 'Конфликт',     labelEn: 'Conflict'    },
  politics:  { icon: '◆', label: 'Политика',     labelEn: 'Politics'    },
  disaster:  { icon: '▲', label: 'Катастрофа',   labelEn: 'Disaster'    },
  discovery: { icon: '◎', label: 'Открытие',     labelEn: 'Discovery'   },
  mystery:   { icon: '◇', label: 'Тайна',        labelEn: 'Mystery'     },
};

function renderVisTimeline(b) {
  const items = b.items || [];
  const title = (lang==='en'&&b.title_en?.trim()) ? b.title_en : b.title || '';
  const orient = b.orient || 'v';
  const showLegend = false; // Legend disabled

  if (!items.length) return `<div class="blk blk-vis-timeline blk-vis-timeline--empty">◈ ${lang==='ru'?'Нет событий':'No events'}</div>`;

  // Build legend from used categories
  const usedCats = [...new Set(items.map(it => it.category || it.accent || 'default'))];
  const legendHtml = showLegend && usedCats.length > 1 ? `<div class="bvt-legend">${
    usedCats.map(cat => {
      const c = BVT_CATS[cat] || BVT_CATS.default;
      return `<div class="bvt-leg-item"><span class="bvt-leg-dot" style="background:var(--bvt-${cat},var(--bvt-default))"></span>${lang==='en'?c.labelEn:c.label}</div>`;
    }).join('')
  }</div>` : '';

  if (orient === 'h') {
    return `<div class="blk blk-vis-timeline blk-vis-timeline--h">
  ${title ? `<div class="bvt-title">${esc(title)}</div>` : ''}
  ${legendHtml}
  <div class="bvt-h-scroll">
    <div class="bvt-h-track">
      <div class="bvt-h-line"></div>
      ${items.map((it, i) => {
        const date = (lang==='en'&&it.date_en?.trim()) ? it.date_en : it.date || '';
        const txt  = (lang==='en'&&it.text_en?.trim())  ? it.text_en  : it.text  || '';
        const cat  = it.category || it.accent || 'default';
        const catDef = BVT_CATS[cat] || BVT_CATS.default;
        const above = i % 2 === 0;
        return `<div class="bvt-h-item bvt-cat-${cat}">
          ${above ? `<div class="bvt-h-card bvt-h-card--above">
            ${date ? `<div class="bvt-h-date">${esc(date)}</div>` : ''}
            <div class="bvt-h-text">${esc(txt)}</div>
          </div><div class="bvt-h-stem bvt-h-stem--above"></div>` : ''}
          <div class="bvt-h-marker">${catDef.icon}</div>
          ${!above ? `<div class="bvt-h-stem bvt-h-stem--below"></div><div class="bvt-h-card bvt-h-card--below">
            ${date ? `<div class="bvt-h-date">${esc(date)}</div>` : ''}
            <div class="bvt-h-text">${esc(txt)}</div>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>
</div>`;
  }

  // Vertical (default)
  return `<div class="blk blk-vis-timeline blk-vis-timeline--v">
  ${title ? `<div class="bvt-title">${esc(title)}</div>` : ''}
  ${legendHtml}
  <div class="bvt-v-track">
    ${items.map(it => {
      const date = (lang==='en'&&it.date_en?.trim()) ? it.date_en : it.date || '';
      const txt  = (lang==='en'&&it.text_en?.trim())  ? it.text_en  : it.text  || '';
      const cat  = it.category || it.accent || 'default';
      const catDef = BVT_CATS[cat] || BVT_CATS.default;
      return `<div class="bvt-v-item bvt-cat-${cat}">
        <div class="bvt-v-marker">${catDef.icon}</div>
        <div class="bvt-v-connector"></div>
        <div class="bvt-v-card">
          ${date ? `<div class="bvt-v-date">${esc(date)}</div>` : ''}
          <div class="bvt-v-text">${esc(txt)}</div>
        </div>
      </div>`;
    }).join('')}
  </div>
</div>`;
}

// ════════════════════════════════════════════════════════════
// БЛОК: СТАТИСТИЧЕСКИЙ ГРАФИК (chart)
// ════════════════════════════════════════════════════════════
function renderChart(b) {
  const cid = 'chart-' + (b.id || uid());
  const title = (lang==='en'&&b.title_en?.trim()) ? b.title_en : b.title || '';
  const labels = (lang==='en'&&b.labels_en?.length) ? b.labels_en : b.labels || [];
  const datasets = b.datasets || [];
  const chartType = b.chart_type || 'bar';
  const dataEncoded = esc(JSON.stringify({ labels, datasets, chartType, options: b.options || {} }));
  return `<div class="blk blk-chart">
  ${title ? `<div class="blk-chart-title">${esc(title)}</div>` : ''}
  <div class="blk-chart-wrap">
    <canvas id="${cid}" class="blk-chart-canvas" data-chart="${dataEncoded}" height="280"></canvas>
  </div>
</div>`;
}

function initWikiChart(id, d) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const W = canvas.parentElement?.offsetWidth || canvas.parentElement?.getBoundingClientRect().width || 500;
  const H = 280;
  canvas.width = W;
  canvas.height = H;

  const PALETTE = [
    'hsl(190 70% 50%)',
    'hsl(35 80% 55%)',
    'hsl(270 55% 58%)',
    'hsl(160 55% 45%)',
    'hsl(0 65% 52%)',
    'hsl(50 75% 52%)',
  ];
  const PALETTE_ALPHA = PALETTE.map(c => c.replace(')', ' / .25)').replace('hsl(', 'hsl('));

  const ctx = canvas.getContext('2d');

  const labels = d.labels || [];
  const datasets = d.datasets || [];
  const type = d.chartType || 'bar';

  const PAD = { top: 24, right: 20, bottom: 40, left: 50 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  // Grid & axis style
  ctx.save();
  ctx.strokeStyle = 'hsl(220 12% 22%)';
  ctx.lineWidth = 1;

  const allVals = datasets.flatMap(ds => ds.data || []);
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  const toY = v => PAD.top + cH - ((v - minVal) / range) * cH;
  const toX = (i, total) => PAD.left + (i / (total - 1 || 1)) * cW;
  const toBarX = (di, dsCount, i, total) => PAD.left + (i / total) * cW + (di / dsCount) * (cW / total) * 0.85;

  // Y grid lines
  const steps = 5;
  for (let s = 0; s <= steps; s++) {
    const v = minVal + (range / steps) * s;
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(W - PAD.right, y);
    ctx.stroke();
    ctx.fillStyle = 'hsl(220 12% 40%)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(v * 10) / 10, PAD.left - 6, y + 3);
  }

  // X axis labels
  labels.forEach((lbl, i) => {
    const x = type === 'line'
      ? toX(i, labels.length)
      : PAD.left + (i + 0.5) * (cW / labels.length);
    ctx.fillStyle = 'hsl(220 12% 45%)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(lbl), x, H - PAD.bottom + 16);
  });

  if (type === 'bar') {
    const groupW = cW / labels.length;
    const barW = (groupW * 0.8) / (datasets.length || 1);
    datasets.forEach((ds, di) => {
      (ds.data || []).forEach((v, i) => {
        const x = PAD.left + i * groupW + groupW * 0.1 + di * barW;
        const y = toY(v);
        const h = toY(minVal) - y;
        const col = PALETTE[di % PALETTE.length];
        const colA = PALETTE_ALPHA[di % PALETTE_ALPHA.length];
        // Bar fill with gradient
        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, col);
        grad.addColorStop(1, colA);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW - 2, h);
        // Top highlight
        ctx.fillStyle = col;
        ctx.fillRect(x, y, barW - 2, 2);
      });
    });
  } else if (type === 'line') {
    datasets.forEach((ds, di) => {
      const col = PALETTE[di % PALETTE.length];
      const data = ds.data || [];
      if (!data.length) return;
      // Fill area
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(toX(0, data.length), toY(minVal));
      data.forEach((v, i) => ctx.lineTo(toX(i, data.length), toY(v)));
      ctx.lineTo(toX(data.length - 1, data.length), toY(minVal));
      ctx.closePath();
      ctx.fillStyle = PALETTE_ALPHA[di % PALETTE_ALPHA.length];
      ctx.fill();
      ctx.restore();
      // Line
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i, data.length), toY(v)) : ctx.lineTo(toX(i, data.length), toY(v)));
      ctx.stroke();
      // Dots
      data.forEach((v, i) => {
        ctx.beginPath();
        ctx.arc(toX(i, data.length), toY(v), 4, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      });
      ctx.restore();
    });
  } else if (type === 'pie' || type === 'donut') {
    const total = allVals.reduce((a, v) => a + Math.abs(v), 0) || 1;
    const cx = W / 2, cy = H / 2, r = Math.min(cW, cH) / 2 - 10;
    const innerR = type === 'donut' ? r * 0.5 : 0;
    let angle = -Math.PI / 2;
    const firstDs = (datasets[0]?.data || []);
    firstDs.forEach((v, i) => {
      const slice = (Math.abs(v) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fill();
      ctx.strokeStyle = 'hsl(215 12% 10%)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Label
      const midA = angle + slice / 2;
      const lx = cx + Math.cos(midA) * (r * 0.7);
      const ly = cy + Math.sin(midA) * (r * 0.7);
      ctx.fillStyle = 'hsl(220 15% 92%)';
      ctx.font = 'bold 11px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (slice > 0.25) ctx.fillText(labels[i] || '', lx, ly);
      angle += slice;
    });
    if (innerR > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fillStyle = 'hsl(215 12% 10%)';
      ctx.fill();
    }
  }

  ctx.restore();
}

// ════════════════════════════════════════════════════════════
// БЛОК: ЧАРНИК (statblock) — карточка существа в стиле бестиария
// ════════════════════════════════════════════════════════════
function renderStatblock(b) {
  const cards = (b.cards && b.cards.length) ? b.cards : [];
  if (!cards.length) return `<div class="blk blk-statblock blk-statblock--empty">🐉 ${lang==='ru'?'Пустой чарник':'Empty statblock'}</div>`;
  const bid = escId(b.id || uid());
  const multi = cards.length > 1;

  const cardHtml = cards.map((c, ci) => {
    const title    = (lang==='en'&&c.title_en?.trim())    ? c.title_en    : c.title    || '';
    const subtitle = (lang==='en'&&c.subtitle_en?.trim()) ? c.subtitle_en : c.subtitle || '';
    const hasImg = !!c.image_url;
    const bg = hasImg ? `<div class="sbk-bg" style="background-image:url('${esc(safeUrl(c.image_url))}')"></div>` : '';

    const stats = (c.stats||[]).map(st => {
      const k = (lang==='en'&&st.key_en?.trim()) ? st.key_en : st.key || '';
      const v = (lang==='en'&&st.val_en?.trim()) ? st.val_en : st.val || '';
      if (!k && !v) return '';
      return `<div class="sbk-stat"><span class="sbk-stat-k">${esc(k)}</span><span class="sbk-stat-v">${esc(v)}</span></div>`;
    }).filter(Boolean).join('');

    const sections = (c.sections||[]).map(sec => {
      const sn = (lang==='en'&&sec.name_en?.trim()) ? sec.name_en : sec.name || '';
      const entries = (sec.entries||[]).map(en => {
        const nm = (lang==='en'&&en.name_en?.trim()) ? en.name_en : en.name || '';
        const tx = (lang==='en'&&en.text_en?.trim()) ? en.text_en : en.text || '';
        if (!nm && !tx) return '';
        return `<div class="sbk-trait">${nm?`<span class="sbk-trait-name">${esc(nm)}.</span> `:''}<span class="sbk-trait-body">${il(tx)}</span></div>`;
      }).filter(Boolean).join('');
      if (!sn && !entries) return '';
      return `${sn?`<div class="sbk-section-hd">${esc(sn)}</div><div class="sbk-rule"></div>`:''}<div class="sbk-section-body">${entries}</div>`;
    }).filter(Boolean).join('');

    return `<div class="sbk-card${ci===0?' on':''}${hasImg?' has-img':''}" data-idx="${ci}">
      ${bg}
      <div class="sbk-body">
        <div class="sbk-name">${esc(title)}</div>
        ${subtitle?`<div class="sbk-sub">${esc(subtitle)}</div>`:''}
        ${stats?`<div class="sbk-stats">${stats}</div><div class="sbk-rule sbk-rule-lg"></div>`:''}
        ${sections}
      </div>
    </div>`;
  }).join('');

  const nav = multi ? `<div class="sbk-nav">
    <button class="sbk-nav-btn" onclick="sbFlip('${bid}',-1)" aria-label="prev">‹</button>
    <div class="sbk-dots">${cards.map((_,k)=>`<span class="sbk-dot${k===0?' on':''}" onclick="sbFlip('${bid}',${k},true)"></span>`).join('')}</div>
    <span class="sbk-counter"><span class="sbk-cur">1</span> / ${cards.length}</span>
    <button class="sbk-nav-btn" onclick="sbFlip('${bid}',1)" aria-label="next">›</button>
  </div>` : '';

  return `<div class="blk blk-statblock" id="sbk-${bid}" data-count="${cards.length}">${nav}<div class="sbk-stage">${cardHtml}</div></div>`;
}

// Листание карт чарника
function sbFlip(bid, arg, absolute) {
  const wrap = document.getElementById('sbk-' + bid);
  if (!wrap) return;
  const cards = [...wrap.querySelectorAll('.sbk-card')];
  if (cards.length < 2) return;
  let cur = cards.findIndex(c => c.classList.contains('on'));
  if (cur < 0) cur = 0;
  let next = absolute ? arg : ((cur + arg) % cards.length + cards.length) % cards.length;
  cards.forEach((c,k)=>c.classList.toggle('on', k===next));
  const dots = wrap.querySelectorAll('.sbk-dot');
  dots.forEach((d,k)=>d.classList.toggle('on', k===next));
  const cnt = wrap.querySelector('.sbk-cur');
  if (cnt) cnt.textContent = String(next+1);
}


// ════════════════════════════════════════════════════════════
// HERO — единая обложка главной (одно изображение + заголовок)
// ════════════════════════════════════════════════════════════
// CTA-кнопка на обложке: регистрация фракции / вход / переход в кабинет.
function buildHeroCta(user) {
  const isPlayer = typeof ecCanAccess === 'function' && ecCanAccess();
  if (isPlayer) {
    return `<button class="hp-hero-cta" onclick="go('economy')"><span class="hp-cta-ic">🛰</span>${lang === 'en' ? 'Open cabinet' : 'Открыть кабинет'}</button>`;
  }
  const action = user ? "go('faction-new')" : (typeof showAuth === 'function' ? "showAuth('login')" : "go('faction-new')");
  return `<button class="hp-hero-cta" onclick="${action}"><span class="hp-cta-ic">⬡</span>${lang === 'en' ? 'Register a faction' : 'Зарегистрировать фракцию'}</button>`;
}

// Выбранная фраза приветствия кэшируется на сессию, чтобы НЕ менялась при
// перерисовках (оптимистичный рендер → после загрузки user). Сбрасывается при reload.
let _heroGreet = null; // { name, text }
// Есть ли в localStorage активная сессия Supabase (синхронно, до загрузки user).
function _heroLikelyLoggedIn() {
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /-auth-token$/.test(k) && localStorage.getItem(k)) return true; } } catch (e) {}
  return false;
}
// Персональное приветствие для игроков/админов (по имени), иначе null (покажем бренд).
// Чтобы не мигало «бренд → приветствие» при загрузке: если сессия есть, а user ещё
// не загрузился — показываем приветствие сразу по кэшированному имени.
function heroGreeting(user) {
  let name = null;
  if (user && ['superadmin', 'editor', 'moderator', 'player'].includes(user.role)) {
    name = ((typeof userProfile !== 'undefined' && userProfile.display_name) || '').trim()
      || (user.email ? user.email.split('@')[0] : '') || 'командир';
    try { localStorage.setItem('wk_greet_name', name); } catch (e) {}
  } else if (user) {
    return null;                       // залогинен, но viewer → бренд
  } else if (_heroLikelyLoggedIn()) {  // сессия грузится → оптимистично приветствуем по кэшу
    name = (localStorage.getItem('wk_greet_name') || '').trim();
    if (!name) return null;
  } else {
    return null;                       // аноним → бренд
  }
  name = name.trim();
  // та же фраза на всю сессию для этого имени — никаких «прыжков» при перерисовке
  if (_heroGreet && _heroGreet.name === name) return _heroGreet.text;
  const en = (typeof lang !== 'undefined' && lang === 'en');
  const greets = en ? [
    `Welcome back, ${name}`, `Good to see you, ${name}`, `${name} on deck`,
    `Back in the saddle, ${name}`, `Signal locked, ${name}`, `Systems nominal, ${name}`,
    `The galaxy awaits, ${name}`, `Course set, ${name}`, `Ready when you are, ${name}`,
    `${name}, the bridge is yours`, `All stations report ready, ${name}`,
  ] : [
    `С возвращением, ${name}`,
    `Как же я рад видеть тебя, ${name}`,
    `${name} в свете прожекторов`,
    `Снова в строю, ${name}?`,
    `ПРИЕМ, ${name}`,
    `Все системы готовы, ${name}`,
    `Галактика ждёт твоих побед, ${name}`,
    `Курс проложен, ${name}`,
    `Мостик в вашем распоряжении, ${name}`,
    `Флот ждёт приказов, ${name}`,
    `Сектор как-то неспокоен, ${name}`,
    `Скучал, ${name}?`,
    `Всё для тебя, ${name}`,
    `Мы обречены идти дальше, ${name}`,
    `Готовность номер один, ${name}`,
    `${name}, соберись. `,
    `Привет от Рейхсклингера, ${name}`,
    `Снова в гиперпространство, ${name}?`,
    `Отдохни, ${name}`,
    `Добро пожаловать в рубку, ${name}`,
    `Какие же красивые песни поют на Травивале, ${name}`,
    `Двигатели прогреты, ${name}`,
    `Пора выступать, ${name}`,
    `${name}, империя не ждёт`,
    `Сводки, как всегда, на столе, ${name}`,
    `Сигнал принят, ${name}`,
    `Топлива точно хватит до следующей станции, ${name}`,
    `Не забывай про радары, ${name}`,
    `Навигация онлайн, ${name}`,
    `${name}, к звёздам, К ТРИУМФУ!`,
  ];
  const h = new Date().getHours();
  if (en) {
    if (h < 5) greets.push(`Still up, ${name}?`, `Deep space never sleeps, ${name}`);
    else if (h < 12) greets.push(`Good morning, ${name}`);
    else if (h < 18) greets.push(`Good afternoon, ${name}`);
    else greets.push(`Good evening, ${name}`);
  } else {
    if (h < 5) greets.push(`Не спится, ${name}?`, `Лучше поспи, ${name}`, `Как красив сегодня уважаемый спутник Земли, правда, ${name}?`);
    else if (h < 12) greets.push(`С первыми лучами ты тут, словно солнышко, ${name}`, `С добрым утром, ${name}`, `Подъём, ${name}`);
    else if (h < 18) greets.push(`Добрый день, ${name}`, `Хорошего дня, ${name}`);
    else greets.push(`Добрый вечер, ${name}`, `Вечереет, ${name}`);
  }
  const text = greets[Math.floor(Math.random() * greets.length)];
  _heroGreet = { name, text };
  return text;
}
function buildHero(coverUrl, user) {
  const _homePg = _pgCache.get('home');
  // title = RU надпись, title_ru = EN надпись (исторически так в схеме)
  const _titleRu = (_homePg?.title || 'КЛАССИЧЕСКАЯ ЭРА').trim().toUpperCase();
  const _titleEn = (_homePg?.title_ru || 'CLASSIC ERA').trim().toUpperCase();
  const title = (lang === 'en' ? _titleEn : _titleRu) || 'КЛАССИЧЕСКАЯ ЭРА';
  const eyebrow = lang === 'en' ? 'WIKI' : 'ВИКИ';

  const url = (coverUrl || '').trim();
  const imgLayer = url
    ? `<img class="hp-hero-img" src="${esc(url)}" data-img-url="${esc(url)}" alt="" loading="eager">`
    : `<div class="hp-hero-noimg"></div>`;

  const uploadBtn = user?.role === 'superadmin'
    ? `<button class="hp-hero-upload-btn" id="hero-upload-btn" onclick="triggerHeroCoverUpload()" style="display:block;z-index:20;">✎ Обложка</button>`
    : '';

  return `<div class="hp-hero-cover" id="hp-hero-cover">
    ${imgLayer}
    <div class="hp-hero-grad"></div>
    <div class="hp-hero-frame"></div>
    <span class="hpc-corner hpc-tl"></span><span class="hpc-corner hpc-tr"></span>
    <span class="hpc-corner hpc-bl"></span><span class="hpc-corner hpc-br"></span>
    <div class="hp-hero-titlewrap">
      ${(() => { const g = heroGreeting(user); return g
        ? `<h1 class="hp-hero-title hp-hero-greet">${esc(g)}</h1>`
        : `<h1 class="hp-hero-title">${esc(title)}</h1>`; })()}
      <div class="hp-hero-rule"></div>
      ${buildHeroCta(user)}
    </div>
    ${uploadBtn}
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// АНИМАЦИЯ ВОЙНЫ ДВУХ ФРАКЦИЙ
// ══════════════════════════════════════════════════════════════
function animateWarTerritories() {
  const t1   = document.getElementById('territory-1');
  const t2   = document.getElementById('territory-2');
  const tb1  = document.getElementById('territory-bg-1');
  const tb2  = document.getElementById('territory-bg-2');
  const routesG = document.getElementById('routes');
  const cpGroup = document.getElementById('control-points');
  const unitsG  = document.getElementById('units');
  if (!t1 || !t2) return;

  const NS = 'http://www.w3.org/2000/svg';
  const Z  = { x:350, y:160, w:400, h:180 };

  // ── Карта сектора — асимметричная, органичная ────────────────
  // Красные: 3 базы, кластеры разного размера, фронт сдвинут влево
  // Синие: 2 базы, но больше промежуточных, фронт сдвинут правее
  // Центр — спорный, не по середине
  const ND = [
    // ═══ КРАСНАЯ ФРАКЦИЯ ═══
    // Главная база — крупный кластер сверху-слева
    {rx:0.02,ry:0.14,s:'red',t:'base', name:'Альфа-Прайм'},
    {rx:0.09,ry:0.04,s:'red',t:'node', name:'Альфа-1'},
    {rx:0.12,ry:0.22,s:'red',t:'node', name:'Альфа-2'},
    {rx:0.18,ry:0.12,s:'red',t:'node', name:'Альфа-3'},
    // Вторая база — маленький кластер посередине слева
    {rx:0.04,ry:0.58,s:'red',t:'base', name:'Мю-Прайм'},
    {rx:0.13,ry:0.50,s:'red',t:'node', name:'Мю-1'},
    {rx:0.08,ry:0.72,s:'red',t:'node', name:'Мю-2'},
    // Третья база — внизу, далеко от других
    {rx:0.06,ry:0.92,s:'red',t:'base', name:'Сигма-Прайм'},
    {rx:0.15,ry:0.85,s:'red',t:'node', name:'Сигма-1'},
    // Перекрёсток — неровно, ближе к верху
    {rx:0.25,ry:0.30,s:'red',t:'node', name:'Узел-Р'},
    {rx:0.22,ry:0.65,s:'red',t:'node', name:'Узел-Р2'},
    // Передовая красных — неравномерная линия
    {rx:0.36,ry:0.10,s:'red',t:'front',name:'Форпост-Р1'},
    {rx:0.38,ry:0.38,s:'red',t:'front',name:'Форпост-Р2'},
    {rx:0.33,ry:0.60,s:'red',t:'front',name:'Форпост-Р3'},
    {rx:0.40,ry:0.82,s:'red',t:'front',name:'Форпост-Р4'},
    // Спорный центр — сдвинут влево от середины, ближе к красным
    {rx:0.46,ry:0.25,s:'red', t:'front',name:'Спорный-1'},
    {rx:0.44,ry:0.55,s:'red', t:'front',name:'Спорный-2'},
    {rx:0.48,ry:0.80,s:'blue',t:'front',name:'Спорный-3'},

    // ═══ СИНЯЯ ФРАКЦИЯ ═══
    // Одна большая база — правый верх, крупный кластер
    {rx:0.97,ry:0.10,s:'blue',t:'base', name:'Дельта-Прайм'},
    {rx:0.90,ry:0.02,s:'blue',t:'node', name:'Дельта-1'},
    {rx:0.88,ry:0.18,s:'blue',t:'node', name:'Дельта-2'},
    {rx:0.94,ry:0.24,s:'blue',t:'node', name:'Дельта-3'},
    {rx:0.83,ry:0.08,s:'blue',t:'node', name:'Дельта-4'},
    // Вторая база — правый низ, маленькая
    {rx:0.95,ry:0.78,s:'blue',t:'base', name:'Омикрон-Прайм'},
    {rx:0.87,ry:0.70,s:'blue',t:'node', name:'Омикрон-1'},
    {rx:0.92,ry:0.90,s:'blue',t:'node', name:'Омикрон-2'},
    // Промежуточные — больше чем у красных, разбросаны
    {rx:0.75,ry:0.15,s:'blue',t:'node', name:'Узел-С1'},
    {rx:0.78,ry:0.40,s:'blue',t:'node', name:'Узел-С2'},
    {rx:0.72,ry:0.62,s:'blue',t:'node', name:'Узел-С3'},
    {rx:0.80,ry:0.82,s:'blue',t:'node', name:'Узел-С4'},
    {rx:0.65,ry:0.28,s:'blue',t:'node', name:'Узел-С5'},
    {rx:0.68,ry:0.52,s:'blue',t:'node', name:'Узел-С6'},
    {rx:0.62,ry:0.75,s:'blue',t:'node', name:'Узел-С7'},
    // Передовая синих — глубже в центр (они наступают)
    {rx:0.55,ry:0.08,s:'blue',t:'front',name:'Форпост-С1'},
    {rx:0.57,ry:0.38,s:'blue',t:'front',name:'Форпост-С2'},
    {rx:0.53,ry:0.62,s:'blue',t:'front',name:'Форпост-С3'},
    {rx:0.56,ry:0.90,s:'blue',t:'front',name:'Форпост-С4'},
  ];

  const nodes = ND.map((d,i)=>({
    id:i, side:d.s, type:d.t, name:d.name,
    x:Z.x+d.rx*Z.w, y:Z.y+d.ry*Z.h,
    el:null,
  }));

  // ── Трассы — гиперпути между соседними системами ──────────────
  const MAX_LINK = Z.w * 0.19;
  const links = [];
  for(let i=0;i<nodes.length;i++)
    for(let j=i+1;j<nodes.length;j++){
      const d=Math.hypot(nodes[j].x-nodes[i].x,nodes[j].y-nodes[i].y);
      if(d<MAX_LINK) links.push({a:nodes[i],b:nodes[j]});
    }

  // Рисуем гиперпути — белые пунктиры
  routesG.innerHTML='';
  links.forEach(lk=>{
    // Основной пунктир
    const p=document.createElementNS(NS,'path');
    const cx=(lk.a.x+lk.b.x)/2+(Math.random()-.5)*6;
    const cy=(lk.a.y+lk.b.y)/2+(Math.random()-.5)*5;
    p.setAttribute('d',`M${lk.a.x},${lk.a.y} Q${cx},${cy} ${lk.b.x},${lk.b.y}`);
    p.setAttribute('stroke','rgba(200,210,255,0.22)');
    p.setAttribute('stroke-width','0.6');
    p.setAttribute('stroke-dasharray','2,4');
    routesG.appendChild(p);
    lk.el=p;
  });

  // ── Узлы — звёздные системы ───────────────────────────────────
  cpGroup.innerHTML='';
  nodes.forEach(nd=>{
    const g=document.createElementNS(NS,'g');
    const rc=nd.side==='red';

    if(nd.type==='base'){
      // Столица — большая звезда (4-конечная) + свечение
      const glow=document.createElementNS(NS,'circle');
      glow.setAttribute('cx',nd.x);glow.setAttribute('cy',nd.y);glow.setAttribute('r','9');
      glow.setAttribute('fill',rc?'rgba(255,60,60,0.08)':'rgba(60,100,255,0.08)');
      g.appendChild(glow);
      // Звезда (4 луча)
      const star=document.createElementNS(NS,'polygon');
      const R=4.5, r2=1.8;
      const spts=[];
      for(let k=0;k<8;k++){
        const a=k*Math.PI/4-Math.PI/8;
        const rr=k%2===0?R:r2;
        spts.push(`${(nd.x+rr*Math.cos(a)).toFixed(1)},${(nd.y+rr*Math.sin(a)).toFixed(1)}`);
      }
      star.setAttribute('points',spts.join(' '));
      star.setAttribute('fill',rc?'rgba(255,120,120,0.9)':'rgba(120,160,255,0.9)');
      star.setAttribute('stroke',rc?'rgba(255,200,200,0.7)':'rgba(200,220,255,0.7)');
      star.setAttribute('stroke-width','0.5');
      g.appendChild(star);
    } else if(nd.type==='front'){
      // Форпост — ромб небольшой
      const s=2.8;
      const dm=document.createElementNS(NS,'polygon');
      dm.setAttribute('points',
        `${nd.x},${nd.y-s} ${nd.x+s*0.7},${nd.y} ${nd.x},${nd.y+s} ${nd.x-s*0.7},${nd.y}`);
      dm.setAttribute('fill',rc?'rgba(220,80,80,0.7)':'rgba(80,120,220,0.7)');
      dm.setAttribute('stroke',rc?'rgba(255,160,160,0.6)':'rgba(160,200,255,0.6)');
      dm.setAttribute('stroke-width','0.5');
      g.appendChild(dm);
    } else {
      // Обычная система — кружок + маленькая точка
      const ring=document.createElementNS(NS,'circle');
      ring.setAttribute('cx',nd.x);ring.setAttribute('cy',nd.y);ring.setAttribute('r','2.8');
      ring.setAttribute('fill','none');
      ring.setAttribute('stroke',rc?'rgba(220,100,100,0.45)':'rgba(100,140,220,0.45)');
      ring.setAttribute('stroke-width','0.5');
      g.appendChild(ring);
      const dot=document.createElementNS(NS,'circle');
      dot.setAttribute('cx',nd.x);dot.setAttribute('cy',nd.y);dot.setAttribute('r','1');
      dot.setAttribute('fill',rc?'rgba(255,150,150,0.8)':'rgba(150,190,255,0.8)');
      g.appendChild(dot);
    }
    cpGroup.appendChild(g);
    nd.el=g;
  });

  // ── Территории — взвешенное поле ─────────────────────────────
  function buildTerritories(){
    const GX=50,GY=28;
    const cw=Z.w/GX,ch=Z.h/GY;
    const red=[],blue=[];
    for(let gy=0;gy<GY;gy++) for(let gx=0;gx<GX;gx++){
      const px=Z.x+cw*(gx+.5),py=Z.y+ch*(gy+.5);
      let rW=0,bW=0;
      for(const n of nodes){
        const d2=Math.hypot(n.x-px,n.y-py);
        const w=1/(d2*d2+1);
        if(n.side==='red') rW+=w; else bW+=w;
      }
      const cell=`M${Z.x+cw*gx},${Z.y+ch*gy}h${cw}v${ch}h-${cw}z`;
      if(rW>bW) red.push(cell); else blue.push(cell);
    }
    if(t1)  t1.setAttribute('d',red.join(' '));
    if(t2)  t2.setAttribute('d',blue.join(' '));
    if(tb1) tb1.setAttribute('d',red.join(' '));
    if(tb2) tb2.setAttribute('d',blue.join(' '));
    const _hR=units.filter(u=>u.alive&&u.s==='red').reduce((s,u)=>s+u.hp,0);
    const _hB=units.filter(u=>u.alive&&u.s==='blue').reduce((s,u)=>s+u.hp,0);
    const _tot=_hR+_hB||1,_dR=_hR/_tot,_dB=_hB/_tot;
    if(t1)  t1.setAttribute('fill',`rgba(${Math.round(200+_dR*40)},${Math.round(30+_dR*20)},${Math.round(30+_dR*10)},${(0.75+_dR*0.20).toFixed(2)})`);
    if(t2)  t2.setAttribute('fill',`rgba(${Math.round(25+_dB*25)},${Math.round(65+_dB*35)},${Math.round(195+_dB*40)},${(0.75+_dB*0.20).toFixed(2)})`);
    if(tb1) tb1.setAttribute('fill',`rgba(${Math.round(130+_dR*50)},15,15,${(0.25+_dR*0.25).toFixed(2)})`);
    if(tb2) tb2.setAttribute('fill',`rgba(15,${Math.round(35+_dB*30)},${Math.round(145+_dB*50)},${(0.25+_dB*0.25).toFixed(2)})`);
    const _wm=document.getElementById('px-wm');
    if(_wm){
      const _wr=Math.round(180*_dR+30*_dB),_wg=Math.round(20*_dR+60*_dB),_wb=Math.round(20*_dR+200*_dB);
      const _wa=(0.13+Math.max(_dR,_dB)*0.14).toFixed(2);
      _wm.querySelectorAll('rect').forEach(el=>el.setAttribute('fill',`rgba(${_wr},${_wg},${_wb},${_wa})`));
    }
  }

  // ── Стреловидные юниты ────────────────────────────────────────
  function makeArrow(side, sz){
    // sz=1: разведчик, sz=2: крейсер, sz=3: флагман
    // Все меньше базовых систем (база r=4.5, диаметр ~9)
    const L=sz===1?2.8:sz===2?4.2:6; // длина — флагман макс 6px
    const W=sz===1?1.1:sz===2?1.8:2.6; // ширина
    const pts = [
      [L, 0],           // нос
      [-L*0.4, -W],     // левое крыло
      [-L*0.1, -W*0.3], // левый вырез
      [-L*0.6, -W*0.2], // левый хвост
      [-L*0.6,  W*0.2], // правый хвост
      [-L*0.1,  W*0.3], // правый вырез
      [-L*0.4,  W],     // правое крыло
    ];
    return pts;
  }

  function arrowPointsStr(pts, cx, cy, angle){
    return pts.map(([px,py])=>{
      const rx=px*Math.cos(angle)-py*Math.sin(angle);
      const ry=px*Math.sin(angle)+py*Math.cos(angle);
      return `${(cx+rx).toFixed(1)},${(cy+ry).toFixed(1)}`;
    }).join(' ');
  }

  const UDEFS=[
    {s:'red', sz:1},{s:'red', sz:1},{s:'red', sz:2},
    {s:'red', sz:2},{s:'red', sz:3},
    {s:'blue',sz:1},{s:'blue',sz:1},{s:'blue',sz:2},
    {s:'blue',sz:2},{s:'blue',sz:3},
  ];
  const FRONT_X=Z.x+0.5*Z.w;

  function nodeNbrs(nd){
    return links.filter(lk=>lk.a.id===nd.id||lk.b.id===nd.id)
      .map(lk=>lk.a.id===nd.id?lk.b:lk.a);
  }
  function stepToward(nd){
    const nbrs=nodeNbrs(nd);
    if(!nbrs.length) return nd;
    return nbrs.reduce((best,n)=>
      Math.abs(n.x-FRONT_X)<Math.abs(best.x-FRONT_X)?n:best);
  }

  const units=[];
  UDEFS.forEach(def=>{
    const spd=def.sz===1?0.007:def.sz===2?0.0045:0.0027;
    const hp =def.sz*2;
    const arrowPts=makeArrow(def.s,def.sz);

    // Цвет: яркий, чётко отличается от узлов и территории
    const fill=def.s==='red'
      ?(def.sz===1?'rgba(255,230,230,0.95)':def.sz===2?'rgba(255,80,60,1)':'rgba(220,20,20,1)')
      :(def.sz===1?'rgba(220,235,255,0.95)':def.sz===2?'rgba(80,140,255,1)':'rgba(20,60,220,1)');
    const strokeC=def.s==='red'?'rgba(255,200,200,0.7)':'rgba(200,225,255,0.7)';

    const bases=nodes.filter(n=>n.type==='base'&&n.side===def.s);
    const from=bases[Math.floor(Math.random()*bases.length)];
    const to=stepToward(from);

    const poly=document.createElementNS(NS,'polygon');
    poly.setAttribute('fill',fill);
    poly.setAttribute('stroke',strokeC);
    poly.setAttribute('stroke-width','0.5');
    poly.setAttribute('stroke-linejoin','round');
    // Начальный угол: красные летят вправо (0), синие влево (π)
    const initAngle=def.s==='red'?0:Math.PI;
    poly.setAttribute('points',arrowPointsStr(arrowPts,from.x,from.y,initAngle));
    unitsG.appendChild(poly);

    units.push({s:def.s,sz:def.sz,hp,maxHp:hp,spd,arrowPts,fill,strokeC,
      poly,from,to,t:Math.random()*0.3,
      alive:true,dead:0,x:from.x,y:from.y,_stop:0,angle:initAngle});
  });

  // ── Захват + бои ──────────────────────────────────────────────
  function updateNodeEl(nd){
    const rc=nd.side==='red';
    // Перекрашиваем элементы узла
    nd.el.querySelectorAll('polygon,circle').forEach(el=>{
      const fill=el.getAttribute('fill');
      if(!fill||fill==='none') return;
      if(nd.type==='base'){
        if(el.tagName==='polygon'){
          el.setAttribute('fill',rc?'rgba(255,120,120,0.9)':'rgba(120,160,255,0.9)');
          el.setAttribute('stroke',rc?'rgba(255,200,200,0.7)':'rgba(200,220,255,0.7)');
        }
      } else if(nd.type==='front'){
        el.setAttribute('fill',rc?'rgba(220,80,80,0.7)':'rgba(80,120,220,0.7)');
        el.setAttribute('stroke',rc?'rgba(255,160,160,0.6)':'rgba(160,200,255,0.6)');
      } else {
        el.setAttribute('fill',rc?'rgba(255,150,150,0.8)':'rgba(150,190,255,0.8)');
      }
    });
  }

  let fightTick=0;
  function resolveFights(){
    fightTick++;
    for(let i=0;i<units.length;i++){
      if(!units[i].alive) continue;
      for(let j=i+1;j<units.length;j++){
        if(!units[j].alive||units[i].s===units[j].s) continue;
        const sz=Math.max(units[i].sz,units[j].sz)*1.5;
        if(Math.hypot(units[i].x-units[j].x,units[i].y-units[j].y)<sz){
          units[i]._stop=3;units[j]._stop=3;
          if(fightTick%80===0){
            units[j].hp--;units[i].hp--;
            if(units[j].hp<=0){units[j].alive=false;units[j].poly.setAttribute('opacity','0');}
            if(units[i].hp<=0){units[i].alive=false;units[i].poly.setAttribute('opacity','0');}
          }
        }
      }
    }
  }

  let frame=0;
  buildTerritories();

  function tick(){
    if(!document.getElementById('territory-1')) return;
    frame++;
    resolveFights();

    let needRebuild=frame%200===0;

    units.forEach(u=>{
      if(!u.alive){
        u.dead++;
        if(u.dead>350){
          const bases=nodes.filter(n=>n.type==='base'&&n.side===u.s);
          const b=bases[Math.floor(Math.random()*bases.length)];
          u.from=b;u.to=stepToward(b);u.t=0;
          u.x=b.x;u.y=b.y;u.hp=u.maxHp;u.alive=true;u.dead=0;
          u.poly.setAttribute('opacity','0.9');
        }
        return;
      }
      if(u._stop>0){u._stop--;return;}

      u.t+=u.spd;
      if(u.t>=1){
        u.t=0;
        if(u.to.side!==u.s&&u.to.type!=='base'){
          u.to.side=u.s;
          updateNodeEl(u.to);
          needRebuild=true;
        }
        u.from=u.to;
        u.to=stepToward(u.from);
      }

      const e=u.t<.5?2*u.t*u.t:-1+(4-2*u.t)*u.t;
      u.x=u.from.x+(u.to.x-u.from.x)*e;
      u.y=u.from.y+(u.to.y-u.from.y)*e;

      // Угол — направление движения к цели
      u.angle=Math.atan2(u.to.y-u.from.y,u.to.x-u.from.x);
      u.poly.setAttribute('points',arrowPointsStr(u.arrowPts,u.x,u.y,u.angle));
      u.poly.setAttribute('opacity',(0.8+Math.sin(frame*0.1+u.t*5)*0.15).toFixed(2));
    });

    if(needRebuild) buildTerritories();
    requestAnimationFrame(tick);
  }
  tick();
}

// ══════════════════════════════════════════════════════════════
// ITEM PAGE — карточка снаряжения
// ══════════════════════════════════════════════════════════════
async function renderItemPage(pg) {
  const isDraft = pg.status === 'draft';
  const canEdit = user && ['superadmin','editor','moderator'].includes(user.role);
  if (isDraft && !canEdit) { setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div></div>`); return; }

  // Если в кэше нет content (неполная запись из списка pages) — фетчим полную страницу
  if (!pg.content || pg.content === '[]' || pg.content === 'null') {
    try {
      const rows = await fetch(`${SB_URL}/rest/v1/pages?slug=eq.${encodeURIComponent(pg.slug)}&select=*&limit=1`,
        { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() } }).then(r => r.json());
      if (rows?.[0]) { pg = rows[0]; _pgCache.set(pg.slug, pg); }
    } catch(e) {}
  }

  let extra = {}; let hasInfobox = false; let otherBlocks = []; let _allBlocks = [];
  try {
    const blocks = JSON.parse(pg.content || '[]');
    _allBlocks = blocks;
    const ib = blocks.find(b => b.type === 'infobox');
    otherBlocks = blocks.filter(b => b.type !== 'infobox');
    if (ib) { hasInfobox = true; (ib.sections||[]).forEach(s=>(s.rows||[]).forEach(r=>{ if(r.key){extra[r.key.toLowerCase().replace(/\s+/g,'_')]=r.val||'';extra[r.key.toLowerCase().trim()]=r.val||'';} })); }
  } catch(e) {}

  if (!hasInfobox) {
    const cover = pg.image_url ? `<div class="art-cov" style="--cov-h:${pg.cover_height||340}px;--cov-pos:center center"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${esc(pT(pg))}</h1></div></div><div class="art-cov-spacer"></div>` : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${esc(pT(pg))}</h1></div>`;
    setPg(`${cover}<div class="prose">${renderBlocks(pC(pg))}</div>`);
    renderCommentsSection(pg.slug); return;
  }

  const RARITY = {
    common:    { ru:'Обычный',     c:'#9a9aaa', g:'rgba(154,154,170,.15)', scan:'rgba(154,154,170,.04)' },
    uncommon:  { ru:'Необычный',   c:'#4ec96a', g:'rgba(78,201,106,.18)',  scan:'rgba(78,201,106,.05)'  },
    rare:      { ru:'Редкий',      c:'#4aaaf0', g:'rgba(74,170,240,.2)',   scan:'rgba(74,170,240,.06)'  },
    epic:      { ru:'Эпический',   c:'#b060f8', g:'rgba(176,96,248,.22)',  scan:'rgba(176,96,248,.07)'  },
    legendary: { ru:'Легендарный', c:'#3ca8e8', g:'rgba(245,160,32,.28)',  scan:'rgba(245,160,32,.08)'  },
  };
  const SLOT_LABEL = {
    weapon:'Оружие',armor:'Броня',artifact:'Артефакт',consumable:'Расходник',
    engine:'Двигатель',reactor:'Реактор',radar:'Радар',shield:'Щит',
    module:'Модуль',hull:'Корпус',helmet:'Шлем',ring:'Кольцо'
  };

  const rarity  = extra['редкость']||extra['rarity']||'common';
  const R = RARITY[rarity] || RARITY.common;
  const slot    = (extra['слот']||extra['slot']||'').toLowerCase().trim().replace(/\s+/g,'');
  const weight  = extra['вес']||extra['weight']||'';
  const req     = extra['требования']||extra['requirements']||'';
  const damage  = extra['урон']||extra['damage']||'';
  const armor_  = extra['защита']||extra['armor']||'';
  const effect  = extra['эффект']||extra['effect']||'';
  const desc    = extra['описание']||extra['description']||'';
  const immunities = (extra['иммунитеты']||extra['immunities']||'').split(',').map(s=>s.trim()).filter(Boolean);
  const SKEYS = [['бонус_кз','КЗ'],['бонус_сил','СИЛ'],['бонус_лов','ЛОВ'],['бонус_тел','ТЕЛ'],['бонус_инт','ИНТ'],['бонус_мдр','МДР'],['бонус_хар','ХАР']];
  const bonuses = SKEYS.map(([k,l])=>extra[k]&&extra[k]!=='0'?[l,(parseFloat(extra[k])>=0?'+':'')+extra[k]]:null).filter(Boolean);
  const _nz = v => v && v !== '0' && v !== '—' && v !== '';
  const isWeapon = slot === 'weapon'; // объявляем ДО secondaryStats

  // Only show non-zero primary stats
  const primaryStats = [
    _nz(damage) && ['УРОН', damage, '#f07070'],
    ...bonuses.map(([k,v])=>[k, v, R.c]),
  ].filter(Boolean);

  const secondaryStats = [
    req    && !isWeapon && ['ТРЕБОВАНИЯ', req.match(/^\d+$/) ? `Ур. ${req}` : req, null],
    weight && !isWeapon && ['ВЕС',        weight, null],
    ...(!isWeapon ? immunities.map(im=>['ИММУНИТЕТ', im, null]) : []),
  ].filter(Boolean);

  // HP брони + физические рейтинги из новой системы
  // Динамический пересчет HP если есть параметры брони
  let armorHp = 0;
  let armorPenMm = 0;
  let armorLaser = '';
  let armorLaserColor = '#cc4848';
  
  const armorClassKey = extra['класс брони'] || extra['Класс брони'] || extra['класс_брони'] || '';
  
  // Проверяем есть ли параметры для динамического расчета
  const hasDynamicArmor = armorClassKey && (
    extra['оч плотность'] || extra['оч прочность'] || extra['оч термостойкость'] ||
    extra['оч_плотность'] || extra['оч_прочность'] || extra['оч_термостойкость']
  );
  
  if (hasDynamicArmor && typeof calcArmorFull === 'function') {
    // Динамический расчет
    const density_pts = parseFloat(extra['оч плотность'] || extra['оч_плотность'] || 0);
    const tensile_pts = parseFloat(extra['оч прочность'] || extra['оч_прочность'] || 0);
    const thermal_pts = parseFloat(extra['оч термостойкость'] || extra['оч_термостойкость'] || 0);
    
    const result = calcArmorFull({
      armorClass: armorClassKey,
      resources: {},
      density_pts,
      tensile_pts,
      thermal_pts,
      unit_gabrit: 1
    });
    
    armorHp = result.hp_on_unit;
    armorPenMm = result.pen_mm;
    armorLaser = result.laser_label;
    armorLaserColor = result.laser_color;
  } else {
    // Используем сохраненные значения
    const armorHpRaw = extra['hp'] || extra['HP'] || '';
    armorHp = parseInt(armorHpRaw, 10) || 0;
    
    const armorPenRaw = extra['пробитие мм'] || extra['Пробитие мм'] || '';
    armorPenMm = parseInt(armorPenRaw, 10) || 0;
    
    armorLaser = extra['лазер рейтинг'] || extra['Лазер рейтинг'] || '';
    // Resolve laser color
    if (armorLaser.includes('Иммунитет'))  armorLaserColor = '#4ec96a';
    else if (armorLaser.includes('Сопрот')) armorLaserColor = '#6bb8d4';
    else if (armorLaser.includes('Частич')) armorLaserColor = '#4e9ed8';
  }
  // Armor class label
  const armorClassName = (typeof ARMOR_CLASSES !== 'undefined' && ARMOR_CLASSES[armorClassKey])
    ? ARMOR_CLASSES[armorClassKey].ru : '';

  // ── Динамический расчёт характеристик оружия ──────────────
  let wStats       = null;
  let weaponCalcOn = false;

  if (isWeapon && typeof calculateWeaponStats === 'function') {
    const wData = typeof weaponDataFromExtra === 'function' ? weaponDataFromExtra(extra) : {
      caliber     : extra['калибр']         || extra['caliber']      || 0,
      weight      : extra['вес']            || extra['weight']       || 0,
      fireRate    : extra['темп_стрельбы']  || extra['темп стрельбы'] || extra['fire_rate'] || 0,
      techType    : extra['тип_технологии'] || extra['тип технологии'] || extra['tech_type'] || 'conventional',
      damageType  : extra['тип_урона']      || extra['тип урона']    || extra['damage_type'] || 'kinetic',
      weaponClass : extra['класс_оружия']   || extra['класс оружия'] || extra['weapon_class'] || 'rifle',
      baseRange   : extra['дальность']      || extra['dalnost']      || extra['base_range']  || 0,
    };
    wStats = calculateWeaponStats(wData);
    weaponCalcOn = true; // всегда показываем панель для slot=weapon
  }

  const allStats = [...primaryStats, ...secondaryStats];

  // ── Инфобокс строки по слоту ─────────────────────────────
  const _iv = (...keys) => { for(const k of keys){ const v=extra[k]||extra[k.toLowerCase()]||''; if(v&&v!=='0') return v; } return ''; };
  
  // Словари для перевода технических значений
  const TECH_LABELS = {
    conventional: 'Обычная', kinetic: 'Кинетическая', energy: 'Энергетическая',
    plasma: 'Плазменная', laser: 'Лазерная', railgun: 'Рельсотрон',
    gauss: 'Гаусс', missile: 'Ракетная', torpedo: 'Торпедная'
  };
  const DAMAGE_LABELS = {
    kinetic: 'Кинетический', energy: 'Энергетический', explosive: 'Взрывной',
    thermal: 'Термический', emp: 'ЭМИ', plasma: 'Плазменный'
  };
  const WEAPON_CLASS_LABELS = {
    rifle: 'Винтовка', pistol: 'Пистолет', smg: 'ПП', shotgun: 'Дробовик',
    sniper: 'Снайперская', heavy: 'Тяжёлое', cannon: 'Пушка',
    autocannon: 'Автопушка', railgun: 'Рельсотрон', laser: 'Лазер',
    plasma: 'Плазмомёт', missile: 'Ракетная', torpedo: 'Торпедная',
    'зенитный комплекс': 'Зенитный комплекс'
  };
  
  const infoRows = [];
  const _row = (k,v,col) => { if(v) infoRows.push([k,v,col]); };

  if (slot==='weapon') {
    if(wStats){ _row('УРН', String(wStats.damage), '#c87060'); _row('ДАЛЬНОСТЬ', wStats.finalRange>0?wStats.rangeLabel:'—','#5aaac0'); if(wStats.fireRate>0)_row('ТЕМП',wStats.fireRate+' выст/мин',null); }
    _row('КАЛИБР',_iv('Калибр','калибр'),null); _row('ВЕС',_iv('Вес','вес')?_iv('Вес','вес')+' кг':'',null);
    const techVal = _iv('Тип технологии','тип_технологии');
    const dmgVal = _iv('Тип урона','тип_урона');
    const classVal = _iv('Класс оружия','класс_оружия');
    _row('ТЕХНОЛ.', techVal ? (TECH_LABELS[techVal.toLowerCase()] || techVal) : '', null);
    _row('ТИП УРОНА', dmgVal ? (DAMAGE_LABELS[dmgVal.toLowerCase()] || dmgVal) : '', null);
    _row('КЛАСС', classVal ? (WEAPON_CLASS_LABELS[classVal.toLowerCase()] || classVal) : '', null);
    _row('⚡ ПОТРЕБ.',_iv('Потребление энергии')?'−'+_iv('Потребление энергии')+' МВт':'','#c87060');
    _row('📦 ШТРАФ',_iv('Штраф вместимости')?'−'+_iv('Штраф вместимости')+' ед.':'','#c87060');
  } else if (slot==='armor') {
    if(armorHp) _row('HP БРОНИ',armorHp.toLocaleString('ru'),'#82c4a0');
    if(armorPenMm) _row('ПРОБИТИЕ',typeof fmtPen==='function'?fmtPen(armorPenMm):armorPenMm+'мм','#4e9ed8');
    if(armorLaser) _row('ЛАЗЕР',armorLaser,armorLaserColor);
    _row('КЛАСС БРОНИ',armorClassName,null);
  } else if (slot==='reactor') {
    _row('⚡ МОЩНОСТЬ',_iv('Мощность')?_iv('Мощность')+' МВт':'','#4e9ed8');
    _row('✦ СИЛА',_iv('Сила реактора'),'#5aaac0');
    _row('🚀 БСК',_iv('Буст скорости')?_iv('Буст скорости')+'%':'','#82c4a0');
    _row('◎ БРДР',_iv('Буст радаров')?_iv('Буст радаров')+'%':'','#5aaac0');
    _row('◈ БЩТ',_iv('Буст щитов')?_iv('Буст щитов')+'%':'','#7c4dff');
    _row('⚙ ДВИ.',_iv('Слотов двигателей')?_iv('Слотов двигателей')+' сл.':'',null);
    _row('📦 ВМСТ.',_iv('Бонус вместимости')?'+'+_iv('Бонус вместимости')+' ед.':'','#82c4a0');
  } else if (slot==='engine') {
    _row('✦ ТЯГА',_iv('Сила тяги'),'#5aaac0');
    _row('⚡ ПОТРЕБ.',_iv('Потребление энергии')?'−'+_iv('Потребление энергии')+' МВт':'','#c87060');
    _row('⊕ КЛАСС',_iv('Класс юнита'),null);
  } else if (slot==='radar') {
    _row('◎ ДАЛЬН.',_iv('Дальность обнаружения')?_iv('Дальность обнаружения')+' АсК':'','#5aaac0');
    _row('◈ ДИАП.',_iv('Диапазон'),null);
    _row('⚡ ПОТРЕБ.',_iv('Потребление энергии')?'−'+_iv('Потребление энергии')+' МВт':'','#c87060');
  } else if (slot==='shield') {
    _row('◈ ПОЛЕ',_iv('Защитное поле'),'#7c4dff');
    _row('⚡ ПОТРЕБ.',_iv('Потребление энергии')?'−'+_iv('Потребление энергии')+' МВт':'','#c87060');
  } else if (slot==='hull') {
    _row('⚔ ОРУДИЙ',_iv('Слотов орудий')?_iv('Слотов орудий')+' сл.':'','#c87060');
    _row('⚖ МАССА',_iv('Масса')?_iv('Масса')+' кг':'',null);
    _row('⊕ ГАБАРИТ',_iv('Габарит'),null);
    _row('🎯 ДАЛЬН.',_iv('Дальность')?_iv('Дальность')+' АсК':'','#5aaac0');
  } else if (slot==='module') {
    _row('🔧 КАТ.',_iv('Категория','Эффект'),null);
    _row('⚡ ПОТРЕБ.',_iv('Потребление энергии')?'−'+_iv('Потребление энергии')+' МВт':'','#c87060');
    _row('📦 ШТРАФ',_iv('Штраф вместимости')?'−'+_iv('Штраф вместимости')+' ед.':'','#c87060');
  } else {
    allStats.forEach(([k,v,col])=>_row(k,v,col));
  }
  _row('💰 ЦЕНА',_iv('Цена')?_iv('Цена')+' ЭК':'','#4e9ed8');

  const _CLS_LABEL = {
    peh:'Пехота',btr:'БТР',tanki:'Танк',arta:'Артиллерия',
    aviacia:'Авиация',vertihui:'Вертолёт',dron:'Дрон',dronkos:'БПЛА',
    mla:'Звездолёт',corvette:'Корвет',destroyer:'Эсминец',
    supportCarrier:'Авианосец',mediumCruiser:'Ср.крейсер',
    hyperCruiser:'Гиперкрейсер',multiroleCarrier:'МЦ авианосец',
    battleship:'Линкор',dreadnought:'Дредноут',ss13:'СС-13',
  };
  const _clsList = (_iv('Доступно для')||'').split(',')
    .map(s=>{ const k=s.trim(); return _CLS_LABEL[k]||_CLS_LABEL[k.toLowerCase()]||null; })
    .filter(Boolean);

  const infoHtml = infoRows.map(([k,v,col])=>
    '<div class="itm-ib-row"><span class="itm-ib-k">'+esc(k)+'</span><span class="itm-ib-v"'+(col?' style="color:'+col+'"':'')+'>'+esc(v)+'</span></div>'
  ).join('');

  // Build stats HUD HTML (used in hero on desktop, inline on mobile)
  const statsHudHtml = (allStats.length || armorHp || armorPenMm || armorLaser || weaponCalcOn) ? `<div class="itm-stats-hud">
      ${armorClassName ? `<div class="itm-hud-row" style="border-bottom:1px solid rgba(28,100,148,.15);padding-bottom:5px;margin-bottom:5px">
        <span class="itm-hud-k" style="color:rgba(28,100,148,.6)">КЛАСС</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v" style="color:rgba(28,100,148,.85);font-size:9px">${esc(armorClassName)}</span>
      </div>` : ''}
      ${armorHp ? `<div class="itm-hud-row" style="border-bottom:1px solid rgba(78,201,106,.2);padding-bottom:8px;margin-bottom:4px">
        <span class="itm-hud-k">HP БРОНИ</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v" style="color:#4ec96a;font-size:15px">${armorHp.toLocaleString('ru')}</span>
      </div>` : ''}
      ${armorPenMm ? `<div class="itm-hud-row" style="border-bottom:1px solid rgba(212,146,74,.2);padding-bottom:6px;margin-bottom:4px">
        <span class="itm-hud-k">ПРОБИТИЕ</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v" style="color:#4e9ed8;font-size:10px">${esc(typeof fmtPen === 'function' ? fmtPen(armorPenMm) : armorPenMm + 'мм')}</span>
      </div>` : ''}
      ${armorLaser ? `<div class="itm-hud-row" style="padding-bottom:4px;margin-bottom:4px">
        <span class="itm-hud-k">ЛАЗЕР</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v" style="color:${armorLaserColor};font-size:9px">${esc(armorLaser)}</span>
      </div>` : ''}
      ${wStats ? `<div class="itm-hud-row" style="border-bottom:1px solid rgba(240,112,112,.2);padding-bottom:8px;margin-bottom:4px">
        <span class="itm-hud-k">УРН</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v" style="color:${wStats.damage > 0 ? '#f07070' : 'var(--t4)'};font-size:${wStats.damage > 0 ? '22' : '12'}px">${wStats.damage > 0 ? wStats.damage : '—'}</span>
      </div>` : ''}
      ${wStats ? `<div class="itm-hud-row" style="border-bottom:1px solid rgba(107,184,212,.2);padding-bottom:6px;margin-bottom:4px">
        <span class="itm-hud-k">ДАЛЬНОСТЬ</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v" style="color:${wStats.finalRange > 0 ? '#6bb8d4' : 'var(--t4)'};font-size:12px">${esc(wStats.rangeLabel || '—')}</span>
      </div>` : ''}
      ${(wStats && wStats.fireRate > 0) ? `<div class="itm-hud-row" style="padding-bottom:4px;margin-bottom:4px">
        <span class="itm-hud-k">ТЕМП</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v" style="font-size:9px">${wStats.fireRate} выст/мин</span>
      </div>` : ''}
      ${allStats.map(([k,v,col])=>`<div class="itm-hud-row">
        <span class="itm-hud-k">${k}</span>
        <span class="itm-hud-sep"></span>
        <span class="itm-hud-v"${col?` style="color:${col}"`:''}>${esc(v)}</span>
      </div>`).join('')}
    </div>` : '';

  const draftBanner = isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК</div>` : '';

  const _draftBanner = isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК</div>` : '';
  const _slotLabel = SLOT_LABEL[slot]||slot||'Снаряжение';
  const _eff = effect || desc || '';

  setPg(`${_draftBanner}<div class="ch-root itm-root">

    <div class="ch-hero">
      ${pg.image_url ? `<img class="ch-hero-bg" src="${esc(pg.image_url)}" loading="eager" alt="">` : ''}
      ${pg.image_url ? `<img class="ch-hero-img" src="${esc(pg.image_url)}" loading="eager" alt="${esc(pT(pg))}">` : '<div class="ch-hero-img-ph"></div>'}
      <div class="ch-hero-grad"></div><div class="ch-hero-scanlines"></div>
      <div class="ch-hero-corner ch-hero-corner--tl"></div><div class="ch-hero-corner ch-hero-corner--tr"></div>
      <div class="ch-hero-info">
        <h1 class="ch-name">${esc(pT(pg))}</h1>
        <div class="ch-hero-badges">
          <div class="ch-badge-faction"><span class="ch-faction-gem"></span>${esc(_slotLabel)}</div>
          <div class="ch-badge-status" style="color:${R.c};border-color:${R.c}">${R.ru}</div>
        </div>
      </div>
    </div>

    <div class="ch-mob-hero">
      ${pg.image_url ? `<img class="ch-mob-img" src="${esc(pg.image_url)}" loading="eager" alt="">` : '<div class="ch-mob-img-ph"></div>'}
      <div class="ch-mob-grad"></div>
      <div class="ch-mob-info">
        <div class="ch-mob-name">${esc(pT(pg))}</div>
        <div class="ch-mob-badges">
          <span class="ch-mob-badge ch-mob-badge--faction">${esc(_slotLabel)}</span>
          <span class="ch-mob-badge" style="color:${R.c};border-color:${R.c}">${R.ru}</span>
        </div>
      </div>
    </div>

    <div class="itm-infobox"><div class="itm-ib-rows">${infoHtml || '<div class="itm-ib-empty">Заполните инфобокс</div>'}</div></div>

    ${_clsList.length ? '<div class="itm-classes-bar"><span class="itm-classes-label">⊕ ДОСТУПНО</span>' + _clsList.map(cl=>`<span class="itm-class-tag">${esc(cl)}</span>`).join('') + '</div>' : ''}

    <div class="itm-body-wrap">
      ${_eff ? `<div class="itm-lore-block" style="--rc:${R.c}">
        <div class="itm-lore-accent"></div>
        <p class="itm-lore-text">${esc(_eff)}</p>
      </div>` : ''}
      ${otherBlocks.length ? `<div class="prose itm-prose">${(_tocBlocks=_allBlocks, otherBlocks.map(renderBlock).join(''))}</div>` : ''}
      ${!_eff && !otherBlocks.length ? `<div class="itm-lore-empty"><span style="font-size:32px;opacity:.1">◈</span><span>Описание не заполнено</span></div>` : ''}
    </div>

  </div>`);
  renderCommentsSection(pg.slug);
}

function renderArmorConfigPage() {
  if (!user || user.role !== 'superadmin') {
    setPg(`<div class="sempty"><div style="font-size:40px;opacity:.15">🔒</div><div style="font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px">ДОСТУП ЗАПРЕЩЁН</div></div>`);
    return;
  }
  // Обновляем breadcrumb
  const bcEl = document.getElementById('top-bc');
  if (bcEl) bcEl.innerHTML = `<span class="bc-item bc-home" onclick="go('home')" style="cursor:pointer">Главная</span><span class="bc-sep">›</span><span class="bc-item">Конфигуратор брони</span>`;

  // Читаем текущие значения из armor_system.js константы + localStorage override
  const saved = (() => { try { return JSON.parse(localStorage.getItem('armor_sys_cfg') || '{}'); } catch(e) { return {}; } })();

  const FIELDS = [
    { key:'ARMOR_K_AREA',            label:'Коэф. масштаба площади',    step:0.01,  def: typeof ARMOR_K_AREA!=='undefined'?ARMOR_K_AREA:0.8,
      hint:'Делитель площади поверхности юнита. Чем больше — тем меньше HP на юните.' },
    { key:'ARMOR_SPEED_PER_PCT',     label:'Штраф скорости / % перегруза', step:0.01, def: typeof ARMOR_SPEED_PER_PCT!=='undefined'?ARMOR_SPEED_PER_PCT:0.2,
      hint:'Единиц скорости снимается за каждый % перегруза. 0.2 = -1 скорость каждые 5%.' },
    { key:'ARMOR_SPEED_MAX_PENALTY', label:'Макс. штраф скорости',      step:1,    def: typeof ARMOR_SPEED_MAX_PENALTY!=='undefined'?ARMOR_SPEED_MAX_PENALTY:30,
      hint:'Максимум единиц скорости которые можно потерять от перегруза брони.' },
    { key:'ARMOR_PEN_PHYS_PER_KG',  label:'Пробитие: физ. кг → мм',   step:0.001, def: typeof ARMOR_PEN_PHYS_PER_KG!=='undefined'?ARMOR_PEN_PHYS_PER_KG:0.15,
      hint:'Вклад 1 кг физического материала в рейтинг пробития (мм калибра).' },
    { key:'ARMOR_PEN_HP_FACTOR',     label:'Пробитие: HP → мм',         step:0.0001, def: typeof ARMOR_PEN_HP_FACTOR!=='undefined'?ARMOR_PEN_HP_FACTOR:0.002,
      hint:'Вклад каждого очка HP брони в рейтинг пробития.' },
    { key:'ARMOR_PEN_TENSILE_FACTOR',label:'Пробитие: прочность на разрыв', step:0.001, def: typeof ARMOR_PEN_TENSILE_FACTOR!=='undefined'?ARMOR_PEN_TENSILE_FACTOR:0.008,
      hint:'Вклад средней прочности на разрыв материала в пробитие.' },
    { key:'ARMOR_PEN_RP_FACTOR',     label:'Пробитие: ОЧ Прочность → мм', step:0.1, def: typeof ARMOR_PEN_RP_FACTOR!=='undefined'?ARMOR_PEN_RP_FACTOR:1.5,
      hint:'Каждое очко ОЧ Прочность добавляет этот множитель к пробитию.' },
  ];

  const RESOURCES_FIELDS = [
    { id:'chermet',  label:'Чермет',       fields:[{k:'kg_per_unit',l:'кг/ед',step:0.1},{k:'hp_per_kg',l:'HP/кг',step:0.01},{k:'density',l:'плотность',step:0.01},{k:'thermal',l:'теплопровод.',step:0.1},{k:'tensile',l:'прочность',step:1}] },
    { id:'ruda',     label:'Руда',         fields:[{k:'kg_per_unit',l:'кг/ед',step:0.1},{k:'hp_per_kg',l:'HP/кг',step:0.01},{k:'density',l:'плотность',step:0.01},{k:'thermal',l:'теплопровод.',step:0.1},{k:'tensile',l:'прочность',step:1}] },
    { id:'crystals', label:'Кристаллы',    fields:[{k:'kg_per_unit',l:'кг/ед',step:0.1},{k:'hp_per_kg',l:'HP/кг',step:0.01},{k:'density',l:'плотность',step:0.01},{k:'thermal',l:'теплопровод.',step:0.1},{k:'tensile',l:'прочность',step:1}] },
    { id:'starvis',  label:'Старвис (ПП)', fields:[{k:'kg_per_unit',l:'кг/ед',step:0.1},{k:'hp_per_kg',l:'HP/кг',step:0.01},{k:'density',l:'плотность',step:0.01},{k:'thermal',l:'теплопровод.',step:0.1},{k:'tensile',l:'прочность',step:1}] },
  ];

  const getVal = (key) => {
    if (saved[key] !== undefined) return saved[key];
    return FIELDS.find(f=>f.key===key)?.def ?? 0;
  };
  const getResVal = (rid, k) => {
    if (saved['res_'+rid+'_'+k] !== undefined) return saved['res_'+rid+'_'+k];
    if (typeof ARMOR_RESOURCES !== 'undefined' && ARMOR_RESOURCES[rid]) return ARMOR_RESOURCES[rid][k] ?? 0;
    return 0;
  };

  // Класс брони — лимиты
  const clsKeys = typeof ARMOR_CLASSES !== 'undefined' ? Object.keys(ARMOR_CLASSES) : [];
  const clsRows = clsKeys.map(k => {
    const cls = ARMOR_CLASSES[k];
    const bw = saved['cls_'+k+'_baseWeight'] ?? cls.baseWeight;
    const ll = saved['cls_'+k+'_loadLimit']  ?? cls.loadLimit;
    return `<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:6px 10px;font-family:Rajdhani,sans-serif;font-size:9px;color:var(--te);letter-spacing:1px">${cls.ru}</td>
      <td style="padding:4px 6px"><input class="fi" type="number" step="1" value="${bw}" style="width:80px" onchange="_asCfg['cls_${k}_baseWeight']=parseFloat(this.value)||${cls.baseWeight}"></td>
      <td style="padding:4px 6px"><input class="fi" type="number" step="1" value="${ll}" style="width:100px" onchange="_asCfg['cls_${k}_loadLimit']=parseFloat(this.value)||${cls.loadLimit}"></td>
    </tr>`;
  }).join('');

  const fieldRows = FIELDS.map(f => `
    <div class="fg" style="grid-column:span 1">
      <label class="fl" title="${esc(f.hint)}">${f.label} <span style="color:rgba(28,100,148,.4);font-size:9px">?</span></label>
      <input class="fi" type="number" step="${f.step}" value="${getVal(f.key)}"
        onchange="_asCfg['${f.key}']=parseFloat(this.value)">
      <div style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);margin-top:3px">${esc(f.hint)}</div>
    </div>`).join('');

  const resHtml = RESOURCES_FIELDS.map(r => `
    <div style="border:1px solid var(--w2);padding:12px 14px;margin-bottom:8px;background:var(--b3)">
      <div style="font-family:Rajdhani,sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;color:var(--te);margin-bottom:10px">${r.label}</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
        ${r.fields.map(f=>`<div class="fg">
          <label class="fl">${f.l}</label>
          <input class="fi" type="number" step="${f.step}" value="${getResVal(r.id,f.k)}"
            onchange="_asCfg['res_${r.id}_${f.k}']=parseFloat(this.value)">
        </div>`).join('')}
      </div>
    </div>`).join('');

  setPg(`<div style="padding-bottom:80px">
<div style="font-family:Rajdhani,sans-serif;font-size:10px;font-weight:700;letter-spacing:4px;color:var(--te);padding:0 0 16px;border-bottom:1px solid var(--w2);margin-bottom:24px;display:flex;align-items:center;gap:12px">
  <span>⚙ КОНФИГУРАТОР БРОНИ</span>
  <span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--t4);letter-spacing:1px;font-weight:400">СУПЕРАДМИН</span>
</div>

<div style="background:rgba(28,100,148,.06);border:1px solid rgba(28,100,148,.2);border-left:3px solid var(--gdl);padding:10px 14px;margin-bottom:24px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--t3);line-height:1.8">
  Значения сохраняются в localStorage и применяются поверх defaults из armor_system.js.<br>
  Для применения изменений к уже существующим предметам — пересохрани их в редакторе.
</div>

<div style="font-family:Rajdhani,sans-serif;font-size:8px;letter-spacing:3px;color:var(--te);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--w2)">ГЛОБАЛЬНЫЕ КОЭФФИЦИЕНТЫ</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px">
  ${fieldRows}
</div>

<div style="font-family:Rajdhani,sans-serif;font-size:8px;letter-spacing:3px;color:var(--te);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--w2)">РЕСУРСЫ — ФИЗИЧЕСКИЕ СВОЙСТВА</div>
<div style="margin-bottom:28px">${resHtml}</div>

<div style="font-family:Rajdhani,sans-serif;font-size:8px;letter-spacing:3px;color:var(--te);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--w2)">КЛАССЫ БРОНИ — ВЕС И ЛИМИТ НАГРУЗКИ</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:28px">
  <thead><tr style="font-family:Rajdhani,sans-serif;font-size:7px;letter-spacing:1px;color:rgba(28,100,148,.5)">
    <th style="text-align:left;padding:4px 10px">Класс</th>
    <th style="text-align:left;padding:4px 6px">Баз. вес (кг)</th>
    <th style="text-align:left;padding:4px 6px">Лимит нагрузки (кг)</th>
  </tr></thead>
  <tbody>${clsRows}</tbody>
</table>

<div style="display:flex;gap:12px;align-items:center;position:sticky;bottom:0;background:var(--b1);padding:14px 0;border-top:1px solid var(--w2);margin-top:8px">
  <button class="btn btn-gd" onclick="asSave()">✓ СОХРАНИТЬ</button>
  <button class="btn btn-gh" onclick="asReset()">↺ Сброс к дефолту</button>
  <span id="as-status" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--te)"></span>
</div>
</div>`);

  window._asCfg = {...saved};

  window.asSave = () => {
    localStorage.setItem('armor_sys_cfg', JSON.stringify(window._asCfg));
    // Применяем значения к живым константам
    const applyMap = {
      ARMOR_K_AREA: v => { if(typeof ARMOR_K_AREA!=='undefined') window.ARMOR_K_AREA=v; },
      ARMOR_SPEED_PER_PCT: v => { if(typeof ARMOR_SPEED_PER_PCT!=='undefined') window.ARMOR_SPEED_PER_PCT=v; },
      ARMOR_SPEED_MAX_PENALTY: v => { if(typeof ARMOR_SPEED_MAX_PENALTY!=='undefined') window.ARMOR_SPEED_MAX_PENALTY=v; },
      ARMOR_PEN_PHYS_PER_KG: v => { if(typeof ARMOR_PEN_PHYS_PER_KG!=='undefined') window.ARMOR_PEN_PHYS_PER_KG=v; },
      ARMOR_PEN_HP_FACTOR: v => { if(typeof ARMOR_PEN_HP_FACTOR!=='undefined') window.ARMOR_PEN_HP_FACTOR=v; },
      ARMOR_PEN_TENSILE_FACTOR: v => { if(typeof ARMOR_PEN_TENSILE_FACTOR!=='undefined') window.ARMOR_PEN_TENSILE_FACTOR=v; },
      ARMOR_PEN_RP_FACTOR: v => { if(typeof ARMOR_PEN_RP_FACTOR!=='undefined') window.ARMOR_PEN_RP_FACTOR=v; },
    };
    for (const [k,v] of Object.entries(window._asCfg)) {
      if (applyMap[k]) applyMap[k](v);
      // Ресурсы: res_chermet_hp_per_kg -> ARMOR_RESOURCES.chermet.hp_per_kg
      if (k.startsWith('res_') && typeof ARMOR_RESOURCES !== 'undefined') {
        const parts = k.slice(4).split('_');
        // id может быть 'starvis' (1 слово) или 'starvis_pp' (2 слова) - используем known ids
        const knownIds = ['chermet','ruda','crystals','starvis'];
        const rid = knownIds.find(id => k.startsWith('res_'+id+'_'));
        if (rid) {
          const prop = k.slice(('res_'+rid+'_').length);
          if (ARMOR_RESOURCES[rid]) ARMOR_RESOURCES[rid][prop] = v;
        }
      }
      // Классы: cls_infantry_loadLimit
      if (k.startsWith('cls_') && typeof ARMOR_CLASSES !== 'undefined') {
        const knownCls = Object.keys(ARMOR_CLASSES);
        const cls = knownCls.find(c => k.startsWith('cls_'+c+'_'));
        if (cls) {
          const prop = k.slice(('cls_'+cls+'_').length);
          if (ARMOR_CLASSES[cls]) ARMOR_CLASSES[cls][prop] = v;
        }
      }
    }
    const el = document.getElementById('as-status');
    if (el) { el.textContent = '✓ Сохранено'; setTimeout(()=>el.textContent='', 3000); }
    toast('Конфигурация брони сохранена', 'ok');
  };

  window.asReset = () => {
    if (!confirm('Сбросить все настройки к значениям по умолчанию из armor_system.js?')) return;
    localStorage.removeItem('armor_sys_cfg');
    window._asCfg = {};
    renderArmorConfigPage();
    toast('Сброшено к дефолту', 'inf');
  };

  // Применяем сохранённые значения при загрузке страницы
  window.asSave && (() => {
    const cfg = window._asCfg;
    if (Object.keys(cfg).length) {
      // тихое применение без toast
      const _t = window.toast; window.toast = ()=>{};
      window.asSave();
      window.toast = _t;
    }
  })();
}


// ══════════════════════════════════════════════════════════════
// ABILITY PAGE
// ══════════════════════════════════════════════════════════════
function renderAbilityPage(pg) {
  const isDraft = pg.status === 'draft';
  const canEdit = user && ['superadmin','editor','moderator'].includes(user.role);
  if (isDraft && !canEdit) { setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div></div>`); return; }

  let extra = {}; let hasInfobox = false; let otherBlocks = [];
  try {
    const blocks = JSON.parse(pg.content || '[]');
    const ib = blocks.find(b => b.type === 'infobox');
    otherBlocks = blocks.filter(b => b.type !== 'infobox');
    if (ib) { hasInfobox = true; (ib.sections||[]).forEach(s=>(s.rows||[]).forEach(r=>{ if(r.key){extra[r.key.toLowerCase().replace(/\s+/g,'_')]=r.val||'';extra[r.key.toLowerCase().trim()]=r.val||'';} })); }
  } catch(e) {}

  if (!hasInfobox) {
    const cover = pg.image_url ? `<div class="art-cov" style="--cov-h:${pg.cover_height||340}px;--cov-pos:center center"><img src="${esc(pg.image_url)}" alt="${esc(pT(pg))}" loading="lazy"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div><div class="art-cov-title-slot"><h1 class="art-h1">${esc(pT(pg))}</h1></div></div><div class="art-cov-spacer"></div>` : `<div class="art-page-header art-page-header--nocov"><h1 class="art-h1">${esc(pT(pg))}</h1></div>`;
    setPg(`${cover}<div class="prose">${renderBlocks(pC(pg))}</div>`);
    renderCommentsSection(pg.slug); return;
  }

  const TYPES = {
    passive:  { ru:'Пассивная',  c:'#1f8fd8' },
    action:   { ru:'Действие',   c:'#2d9fd8' },
    bonus:    { ru:'Бонусное',   c:'#3db855' },
    reaction: { ru:'Реакция',    c:'#d83040' },
    '1/day':  { ru:'1/День',     c:'#9040e8' },
    '1/rest': { ru:'1/Отдых',    c:'#d86828' },
  };

  const type    = (extra['тип']||extra['type']||'passive').toLowerCase();
  const T       = TYPES[type] || TYPES.passive;
  const range   = extra['дальность']||extra['range']||'';
  const cost    = extra['стоимость']||extra['cost']||'';
  const effect  = extra['эффект']||extra['effect']||'';
  const desc    = extra['описание']||extra['description']||'';
  const trigger = extra['триггер']||extra['trigger']||'';
  const immunities = (extra['иммунитеты']||extra['immunities']||'').split(',').map(s=>s.trim()).filter(Boolean);
  const SKEYS = [['бонус_кз','КЗ'],['бонус_сил','СИЛ'],['бонус_лов','ЛОВ'],['бонус_тел','ТЕЛ'],['бонус_инт','ИНТ'],['бонус_мдр','МДР'],['бонус_хар','ХАР']];
  const bonuses = SKEYS.map(([k,l])=>extra[k]&&extra[k]!=='0'?[l,(parseFloat(extra[k])>=0?'+':'')+extra[k]]:null).filter(Boolean);
  const iconUrl = pg.image_url || ((typeof getAbilityIconUrl==='function')?getAbilityIconUrl(pT(pg)):null);

  const statItems = [
    range   && {k:'Дальность', v:range},
    cost    && {k:'Стоимость', v:cost},
    trigger && {k:'Триггер',   v:trigger},
    ...bonuses.map(([k,v])=>({k, v, accent:true})),
    ...immunities.map(im=>({k:'Иммунитет', v:im})),
  ].filter(Boolean);

  const draftBanner = isDraft ? `<div class="scp-draft-banner">⚠ ЧЕРНОВИК</div>` : '';

  setPg(`${draftBanner}<div class="abx-page" style="--tc:${T.c}">
  
  <div class="abx-card">
    <div class="abx-bolts abx-bolt-tl"></div>
    <div class="abx-bolts abx-bolt-tr"></div>
    <div class="abx-bolts abx-bolt-bl"></div>
    <div class="abx-bolts abx-bolt-br"></div>
    
    <!-- LEFT: Image with fade mask -->
    ${iconUrl ? `<div class="abx-image-side">
      <img src="${esc(iconUrl)}" loading="eager" onclick="event.preventDefault();event.stopPropagation();openLightbox('${esc(iconUrl)}','${esc(pT(pg))}');return false;" alt="${esc(pT(pg))}">
      <div class="abx-image-mask"></div>
    </div>` : '<div class="abx-image-side" style="background:#1f1812"></div>'}
    
    <!-- RIGHT: Content -->
    <div class="abx-content-side">
      <div class="abx-type" style="border-color:${T.c};color:${T.c}">${T.ru.toUpperCase()}</div>
      <h1 class="abx-name">${esc(pT(pg))}</h1>
      <div class="abx-divider"></div>
      
      ${effect ? `<div class="abx-effect" style="border-left-color:${T.c}">${esc(effect)}</div>` : ''}
      ${desc   ? `<p class="abx-desc">${esc(desc)}</p>` : ''}
      ${otherBlocks.length ? `<div class="prose abx-blocks">${(_tocBlocks=otherBlocks,otherBlocks.map(renderBlock).join(""))}</div>` : ''}
      
      ${statItems.length ? `<div class="abx-stats">
        ${statItems.map(s=>`<div class="abx-stat-item">
          <span class="abx-stat-k">${esc(s.k)}</span>
          <span class="abx-stat-v"${s.accent?` style="color:${T.c}"`:''}>${esc(s.v)}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>
  </div>
  
</div>`);
  renderCommentsSection(pg.slug);
}

// ══════════════════════════════════════════════════════════════
// FACTION PAGE — страница государства/фракции
// ══════════════════════════════════════════════════════════════
async function renderFactionPage(pg) {
  const isDraft = pg.status === 'draft';
  const canEdit = user && ['superadmin','editor','moderator'].includes(user.role);
  if (isDraft && !canEdit) { setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div><div>${T('notFound')}</div></div>`); return; }

  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);

  const name = pT(pg);
  const content_pg = pC(pg);

  // Faction: title lives in infobox header — no separate art-h1 to avoid duplication
  const cover = pg.image_url
    ? `<div class="art-cov" style="--cov-h:260px;--cov-pos:center center"><img src="${esc(pg.image_url)}" alt="${esc(name)}" loading="eager"><div class="art-cov-scan"></div><div class="art-cov-fade"></div><div class="art-cov-hud hud-tl"></div><div class="art-cov-hud hud-tr"></div></div><div class="art-cov-spacer"></div>`
    : '';

  const html = `${cover}
  <div class="prose fac-prose-wrap" style="margin-bottom:24px">
    ${content_pg ? renderBlocks(content_pg) : ''}
    <div style="clear:both"></div>
  </div>
  <div class="fac-members-hdr">◈ ${T('contributors')}</div>
  <div class="fac-members-list" id="fac-members-list">
    <div class="sload" style="min-height:60px"><div class="quote-loader">${getRandomQuote()}</div></div>
  </div>`;

  setPg(html);
  renderCommentsSection(pg.slug);

  // Async: load characters that have this faction name
  try {
    const chars = await dbGet('characters', `faction=eq.${encodeURIComponent(name)}&select=slug,name,class,status,owner_email&order=name.asc`) || [];
    const el = document.getElementById('fac-members-list');
    if (!el) return;
    if (!chars.length) { el.innerHTML = '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:rgba(255,255,255,.25);padding:16px 0">Нет участников</div>'; return; }
    const CLASS_LABELS = {soldier:'Солдат',pilot:'Пилот',agent:'Агент',commander:'Командир',engineer:'Инженер',diplomat:'Дипломат',hacker:'Хакер',medic:'Медик',sniper:'Снайпер',spy:'Шпион',warlord:'Военачальник',navigator:'Навигатор'};
    el.innerHTML = chars.map(c => {
      const clsLabel = CLASS_LABELS[c.class] || c.class || '—';
      const pg2 = pages.find(p=>p.slug===c.slug);
      const stMap = {active:'АКТИВЕН',dead:'ПОГИБ',retired:'НА ПОКОЕ'};
      const stCls = {active:'st-active',dead:'st-dead',retired:'st-retired'}[c.status]||'st-retired';
      return `<div class="fac-member" onclick="go('${esc(c.slug)}')">
        ${pg2?.image_url ? `<img src="${esc(pg2.image_url)}" class="fac-member-av" loading="lazy">` : `<div class="fac-member-av fac-member-av--ph">${esc((c.name||'?').slice(0,2).toUpperCase())}</div>`}
        <div class="fac-member-info">
          <div class="fac-member-name">${esc(c.name||c.slug)}</div>
          <div class="fac-member-cls">${esc(clsLabel)}</div>
        </div>
        <div class="fac-member-status ${stCls}">${stMap[c.status]||c.status}</div>
      </div>`;
    }).join('');
  } catch(e) {
    const el = document.getElementById('fac-members-list');
    if (el) el.innerHTML = '<div style="color:var(--t4);font-size:11px">Не удалось загрузить участников</div>';
  }
}


// ══════════════════════════════════════════════════════════════
// CHARACTER PAGE v4 — полностью переписан, стабильная вёрстка
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// UNIT PAGE
// ══════════════════════════════════════════════════════════════════════════════
window.uDC = function(n, sl, slt) {
  var gp = (typeof pages !== 'undefined' ? pages : []).find(function(p){ return (p.title||p.name||'') === n; });
  var img = gp ? gp.image_url : '';
  var ib2 = gp ? (gp.infobox||{}) : {};
  var SC  = {engine:'Двигатель',armor:'Броня',radar:'Радар',shield:'Щит',module:'Модуль',weapon:'Орудие'};
  var scC = {engine:'#4caf50',armor:'#78909c',radar:'#5aaac0',shield:'#7c4dff',module:'#9e9e9e',weapon:'#c87060'};
  var kk  = ['Мощность','Сила тяги','Сила реактора','Дальность обнаружения','Защитное поле',
             'Потребление энергии','Штраф вместимости','Цена','HP','Урон','Дальность',
             'Калибр','Буст скорости','Буст радаров','Буст щитов'];
  var ss = []; kk.forEach(function(k){ var v=ib2[k]||ib2[k.toLowerCase()]||''; if(v&&v!=='0') ss.push([k,v]); });
  var ds = ib2['Описание']||ib2['описание']||'';
  var e = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  var linkHtml = sl ? '<div class="un-dc-link" onclick="go(this.dataset.s)" data-s="'+e(sl)+'">Открыть статью &#8594;</div>' : '';
  return ['<div class="un-dc">',
    img ? '<div class="un-dc-img"><img src="'+e(img)+'" alt="'+e(n)+'" loading="lazy"></div>' : '',
    '<div class="un-dc-header">',
      '<div class="un-dc-slot" style="color:'+(scC[slt]||'#888')+'">'+(SC[slt]||slt||'')+'</div>',
      '<div class="un-dc-name">'+e(n)+'</div>',
    '</div>',
    ss.length ? '<div class="un-dc-stats">'+ss.map(function(s){
      return '<div class="un-dc-stat"><span class="un-dc-stat-k">'+e(s[0])+'</span><span class="un-dc-stat-v">'+e(s[1])+'</span></div>';
    }).join('')+'</div>' : '',
    ds ? '<div class="un-dc-desc">'+e(ds).replace(/\n/g,'<br>')+'</div>' : '',
    linkHtml, '</div>'
  ].join('');
};

window.showUnitDrawer = function(n, sl, slt) {
  var existing = document.getElementById('un-drawer');
  if (existing) existing.remove();
  var d = document.createElement('div');
  d.id = 'un-drawer'; d.className = 'un-drawer';
  d.innerHTML = '<div class="un-drawer-bg" onclick="document.getElementById(\'un-drawer\').remove()"></div>'
    + '<div class="un-drawer-sheet"><div class="un-drawer-handle"></div>'
    + '<div class="un-drawer-close" onclick="document.getElementById(\'un-drawer\').remove()">✕</div>'
    + window.uDC(n, sl, slt) + '</div>';
  document.body.appendChild(d);
  requestAnimationFrame(function(){ d.classList.add('un-drawer--open'); });
};


// ── uShowDetail: показ карточки модуля/орудия справа или в drawer (мобайл) ──
window.uShowDetail = function(name, sl, slt, panelId) {
  var isMobile = window.innerWidth <= 900;
  if (isMobile) {
    window.showUnitDrawer(name, sl, slt);
    return;
  }
  var panel = document.getElementById(panelId);
  if (!panel) return;

  // Снять выделение со всех строк в текущей панели
  var parentPanel = panel.closest('.ch-panel');
  if (parentPanel) {
    parentPanel.querySelectorAll('.un-weap-row, .un-mod-item').forEach(function(el) {
      el.classList.remove('un-selected');
    });
  }

  // Выделить кликнутый элемент (ищем по имени в data-tip или у ближайшего)
  if (parentPanel) {
    parentPanel.querySelectorAll('.un-weap-row, .un-mod-item').forEach(function(el) {
      var tip = el.getAttribute('data-tip') || '';
      var nm = el.querySelector('.un-weap-name, .un-mod-name');
      if (nm && nm.textContent.trim() === name) el.classList.add('un-selected');
    });
  }

  panel.innerHTML = window.uDC(name, sl, slt);
};

async function renderUnitPage(pg) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const pT  = p => p?.title || p?.name || '';

  // Парсим инфобокс из content
  var extra = {};
  try {
    var _blocks = JSON.parse(pg.content||'[]');
    var _ib0 = _blocks.find(b=>b.type==='infobox');
    if (_ib0) (_ib0.sections||[]).forEach(function(s){(s.rows||[]).forEach(function(r){
      if(r.key){extra[r.key]=r.val||'';extra[r.key.toLowerCase()]=r.val||'';extra[r.key.toLowerCase().trim()]=r.val||'';}
    });});
  } catch(e){}

  // Читаем инфобокс другой страницы по имени
  var _getIb = function(name){
    if(!name) return {};
    var found = pages.find(function(p){return (p.title||p.name||'')===name;});
    var slug  = found ? found.slug : name;
    var cached = _pgCache.get(slug);
    if(cached){
      if(cached.infobox) return cached.infobox;
      try{
        var bs=JSON.parse(cached.content||'[]');
        var ib2=bs.find(function(b){return b.type==='infobox';});
        if(ib2){var flat={};(ib2.sections||[]).forEach(function(s){(s.rows||[]).forEach(function(r){if(r.key){flat[r.key]=r.val||'';flat[r.key.toLowerCase()]=r.val||'';}});});cached.infobox=flat;return flat;}
      }catch(e){}
    }
    return found&&found.infobox ? found.infobox : {};
  };
  var _ibv = function(name,key){var ib=_getIb(name);return ib[key]||ib[key.toLowerCase()]||'';};

  // Загружаем страницу по имени
  var _loadByName = async function(name){
    if(!name||!name.trim()) return;
    var found=pages.find(function(p){return (p.title||p.name||'')===name;});
    if(!found) return; // нет в pages — не делаем запрос
    var slug=found.slug;
    if(!_pgCache.has(slug)){
      try{var r=await fetch('/api/pages/'+encodeURIComponent(slug));if(r.ok)_pgCache.set(slug,await r.json());}catch(e){}
    }
  };

  // Получаем имена из инфобокса юнита
  var reactorName = extra['Реактор']||'';
  var hullName    = extra['Корпус']||'';

  // Лимиты слотов
  var _ri = function(k,d){return Math.max(d,parseInt(_ibv(reactorName,k)||d,10)||d);};
  var _hi = function(k,d){return Math.max(d,parseInt(_ibv(hullName,k)||d,10)||d);};
  var maxEng = reactorName ? _ri('Слотов двигателей',1) : 1;
  var maxRad = reactorName ? _ri('Слотов радаров',1)    : 1;
  var maxShd = reactorName ? _ri('Слотов щитов',1)      : 1;
  var maxMod = reactorName ? (_ri('Слотов модулей',0) || parseInt(_ibv(reactorName,'modul')||0,10)||0) : 0;
  var CLASS_OR2={peh:2,btr:2,tanki:3,arta:2,aviacia:5,vertihui:6,dron:3,dronkos:3,
    mla:5,corvette:1,destroyer:1,supportcarrier:1,mediumcruiser:1,hypercruiser:1,
    multirolecarrier:1,battleship:1,dreadnought:1,ss13:1};
  var hullClass = (extra['Класс']||extra['класс']||'').toLowerCase();
  var maxWep = hullName ? _hi('Слотов орудий',0)||CLASS_OR2[hullClass]||2 : CLASS_OR2[hullClass]||2;
  var maxArm = hullName ? _hi('Слотов брони',4) : 4;

  // Собираем имена по слотам
  var _getNames = function(base,max){var r=[];for(var n=1;n<=max;n++){var v=extra[base+' '+n]||'';if(v)r.push(v);}return r;};
  var engNames   = _getNames('Двигатель',maxEng);
  var armorNames = _getNames('Броня',    maxArm);
  var weapNames  = _getNames('Орудие',   maxWep);
  var radarNames = _getNames('Радар',    maxRad);
  var shieldNames= _getNames('Щит',      maxShd);
  var modNames   = [];
  for(var _mi=1;_mi<=Math.max(maxMod,20);_mi++){var _mv=extra['Модуль '+_mi]||'';if(!_mv)break;modNames.push(_mv);}

  // Загружаем все страницы
  var allNames=[reactorName,hullName,...engNames,...armorNames,...weapNames,...radarNames,...shieldNames,...modNames].filter(Boolean);
  for(var _n of allNames) await _loadByName(_n);

  // ── Расчёты ──────────────────────────────────────────────
  var unitMass    = parseFloat((hullName?_ibv(hullName,'Масса'):extra['Масса']||extra['масса']||'100').replace(/[^0-9.]/g,''))||100;
  var unitGabarit = parseFloat(hullName?_ibv(hullName,'Габарит'):extra['Габарит']||1)||1;
  var reactorPower= parseFloat(_ibv(reactorName,'Мощность')||_ibv(reactorName,'power')||0)||0;
  var reactorForce= parseFloat(_ibv(reactorName,'Сила реактора')||_ibv(reactorName,'force')||0)||0;
  var _boostSpd = parseFloat(_ibv(reactorName,'Буст скорости')||_ibv(reactorName,'Буст')||0)||0;
  var _boostRdr = parseFloat(_ibv(reactorName,'Буст радаров')||_ibv(reactorName,'Буст')||0)||0;
  var _boostShd = parseFloat(_ibv(reactorName,'Буст щитов')||_ibv(reactorName,'Буст')||0)||0;
  var _multSpd = 1 + _boostSpd/100;
  var _multRdr = 1 + _boostRdr/100;
  var _multShd = 1 + _boostShd/100;
  var reactorCapB = parseFloat(_ibv(reactorName,'Бонус вместимости')||0)||0;

  var SPEED_ENV2={peh:5,btr:8,tanki:8,arta:8,aviacia:140,vertihui:50,dron:8,dronkos:1000,
    mla:1000,corvette:1000,destroyer:1000,supportcarrier:1000,mediumcruiser:1000,
    hypercruiser:1000,multirolecarrier:1000,battleship:1000,dreadnought:1000,ss13:1};
  // Наземка/авиация — формат 0,X. Космос — целое
  var SMALL_FORMAT=['peh','btr','tanki','arta','aviacia','vertihui','dron'];
  var envK2 = SPEED_ENV2[hullClass]||1;
  var totalSpeedU=0;
  engNames.forEach(function(n){
    var t=parseFloat(_ibv(n,'Сила тяги')||0);
    if(t>0&&reactorForce>0){
      var kmh=(t*reactorForce)/unitMass*10*_multSpd;
      totalSpeedU+=Math.min(100, kmh/envK2);
    }
  });
  if(totalSpeedU>100)totalSpeedU=100;
  // Форматирование
  // Скорость: наземка/авиация/дроны → "0,N АсК/ход", космос → целое
  var ZERO_FMT=['peh','btr','tanki','arta','aviacia','vertihui','dron'];
  var _fmtSpd=function(v){
    var rounded = Math.round(v);
    if(ZERO_FMT.indexOf(hullClass)>=0) return '0,'+rounded+' АсК/ход';
    return rounded+' АсК/ход';
  };
  // Конвертация АсК → метры/ход (1 АсК = 1 клетка = 1.5 м по умолчанию, для космоса ~150 км)
  var _askToMeters=function(ask,cls){
    if(['corvette','destroyer','supportcarrier','mediumcruiser','hypercruiser',
        'multirolecarrier','battleship','dreadnought','mla','dronkos'].indexOf(cls)>=0)
      return Math.round(ask*150)+' км/ход';
    if(['aviacia','vertihui'].indexOf(cls)>=0)
      return Math.round(ask*140/3.6)+' м/с · '+Math.round(ask*140)+' км/ход';
    // Наземка: 1 АсК = 1 клетка = 1.5 м
    return Math.round(ask*1.5)+' м/ход';
  };
  var totalSpeedFmt=totalSpeedU>0?_fmtSpd(totalSpeedU):'';

  var totalHP2=0;
  armorNames.forEach(function(n){totalHP2+=parseFloat(_ibv(n,'HP')||_ibv(n,'hp')||0)||0;});

  var radarRangeBonus=0; radarNames.forEach(function(n){ radarRangeBonus+=parseFloat(_ibv(n,'Дальность обнаружения')||0)||0;});
  radarRangeBonus = Math.round(radarRangeBonus * _multRdr * 100)/100;

  // Дальность корабля из корпуса — прибавляется к дальности всех орудий
  var shipRangeBonus = parseFloat(_ibv(hullName,'Дальность')||_ibv(hullName,'Дальность стрельбы')||extra['Дальность']||0)||0;
  var totalDmg2=0, weapList2=[];
  weapNames.forEach(function(n){
    var dmg=0;
    if(typeof calculateWeaponStats==='function'){
      try{var ws2=calculateWeaponStats({caliber:_ibv(n,'Калибр'),weight:_ibv(n,'Вес'),fireRate:_ibv(n,'Темп стрельбы'),techType:_ibv(n,'Тип технологии'),damageType:_ibv(n,'Тип урона'),weaponClass:_ibv(n,'Класс оружия'),baseRange:_ibv(n,'Дальность')},{radarDalnostBoost:0});dmg=ws2.damage||0;}catch(e){}
    }
    var md=parseInt(_ibv(n,'Урон')||0,10)||0; var fd=md||dmg;
    totalDmg2+=fd;
    var _baseRng=parseFloat((_ibv(n,'Дальность')||'0').toString().replace(',','.'))||0;
    // Для наземных классов радар в других единицах: 1 АсК радара = 0,1 наземного АсК
    // Радар всегда в единицах дальности оружия: 1 АсК радара = 0,1 АсК дальности
    var _radarInUnits = radarRangeBonus / 10;
    var _totalRng = _baseRng + shipRangeBonus + _radarInUnits;
    var GROUND_CLS = ['peh','btr','tanki','arta','aviacia','vertihui','dron'];
    var _fmtRange = function(v) {
      if (v <= 0) return '';
      var rounded = Math.round(v*10)/10;
      var s = rounded.toFixed(1).replace('.', ',');
      return GROUND_CLS.indexOf(hullClass) >= 0 ? s + ' шаг' : s + ' АсК';
    };
    weapList2.push({name:n,dmg:fd,baseRange:_baseRng,radarBonus:_radarInUnits,range:_fmtRange(_totalRng)});
  });

  var totalShield2=0; shieldNames.forEach(function(n){totalShield2+=parseFloat(_ibv(n,'Защитное поле')||0)||0;});
  totalShield2 = Math.round(totalShield2 * _multShd);

  var baseCapacity2=Math.round(unitMass*0.7)+reactorCapB;
  var usedPower2=0, usedCap2=0, totalPrice2=0;
  [engNames,radarNames,shieldNames,modNames,weapNames].forEach(function(arr){
    arr.forEach(function(n){
      usedPower2+=parseFloat(_ibv(n,'Потребление энергии')||_ibv(n,'power')||0)||0;
      usedCap2  +=parseFloat(_ibv(n,'Штраф вместимости')||_ibv(n,'capacityPenalty')||0)||0;
      totalPrice2+=parseFloat(_ibv(n,'Цена')||0)||0;
    });
  });
  armorNames.forEach(function(n){totalPrice2+=parseFloat(_ibv(n,'Цена')||0)||0;});
  totalPrice2+=parseFloat(_ibv(hullName,'Цена')||extra['Цена']||0)||0;
  totalPrice2+=parseFloat(_ibv(reactorName,'Цена')||0)||0;
  var energyBal2=reactorPower-usedPower2;
  var freeCap2=baseCapacity2-usedCap2;

  var CLASS_LBL2={peh:'Пехота',btr:'БТР',tanki:'Танк',arta:'Артиллерия',aviacia:'Авиация',
    vertihui:'Вертолёт',dron:'Дрон',dronkos:'БПЛА',mla:'Звездолёт',corvette:'Корвет',
    destroyer:'Эсминец',supportcarrier:'Авианосец (подд.)',mediumcruiser:'Средний крейсер',
    hypercruiser:'Гиперкрейсер',multirolecarrier:'Многоцелевой авианосец',
    battleship:'Линкор',dreadnought:'Дредноут',ss13:'СС-13'};
  var classLabel2=CLASS_LBL2[hullClass]||hullClass||'Юнит';
  var status2=(extra['Статус']||extra['статус']||'активен').toLowerCase();
  var ST2={активен:{label:'АКТИВЕН',color:'#4caf50'},уничтожен:{label:'УНИЧТОЖЕН',color:'#f44336'},законсервирован:{label:'ЗАКОНСЕРВИРОВАН',color:'#ff9800'}};
  var st2=ST2[status2]||{label:status2.toUpperCase(),color:'#888'};
  var fmtP=function(p){return p>=1e9?(p/1e9).toFixed(1)+' млрд ЭК':p>=1e6?(p/1e6).toFixed(1)+' млн ЭК':p>=1e3?Math.round(p/1e3)+' тыс ЭК':p+' ЭК';};
  var ec2=function(v,max){return v<0?'#f44336':v<max*0.1?'#ff9800':'#4caf50';};

  // ── Statbar ───────────────────────────────────────────────
  var _armorDetails = armorNames.length ? armorNames.filter(Boolean).map(function(n){
    var hp=parseFloat(_ibv(n,'HP')||_ibv(n,'hp')||0)||0;
    return n+(hp?' → '+Math.round(hp)+' HP':'');
  }).join('\n') : '';
  var _tipHP   = 'Прочность: '+Math.round(totalHP2)+' HP\n\n'+(_armorDetails?_armorDetails+'\n\n':'')+'Рассчитывается из материала брони (плотность/прочность/термостойкость)\n× масса юнита и габарит';
  // Детализация дальности — базовая + бонусы
  var _weapDetails = weapList2.length ? weapList2.filter(function(w){return w.dmg>0;}).map(function(w){
    var _rStr = w.range ? '\nДальность: '+w.range : '';
    return w.name+' → '+w.dmg+_rStr;
  }).join('\n') : '';
  var _rangeNote = '';
  var _tipDmg  = ['Урон: '+totalDmg2+' (сумма)',
    '',
    _weapDetails||'нет оружия',
    _rangeNote,
    '',
    'Формула: Калибр × √Вес × коэф.технологии × коэф.типа / 50'
  ].filter(function(s){return s!==undefined;}).join('\n').replace(/\n\n\n/g,'\n\n');
  var _engDetails = engNames.length ? engNames.filter(Boolean).map(function(n){
    var t=parseFloat(_ibv(n,'Сила тяги')||0)||0;
    var ask=(t>0&&reactorForce>0)?Math.min(100,parseFloat(((t*reactorForce)/unitMass*10/envK2).toFixed(2))):0;
    return n+(ask?' → '+ask+' АсК/ход':'');
  }).join('\n') : '';
  var _metersLabel=totalSpeedU>0?_askToMeters(totalSpeedU,hullClass):'';
  var _tipSpd = ['Скорость: '+_fmtSpd(totalSpeedU||0)+(_metersLabel?' ('+_metersLabel+')':''),
    '',
    _engDetails||'',
    'Формула: (Сила тяги × Сила реактора) / Масса × 10 / '+envK2,
    'Масса: '+unitMass+' кг  |  Реактор force: '+reactorForce,
    'Коэф. среды ['+hullClass+']: '+envK2,
    _boostSpd>0?'Буст скорости: +'+_boostSpd+'%':'',_boostRdr>0?'Буст радаров: +'+_boostRdr+'%':'',_boostShd>0?'Буст щитов: +'+_boostShd+'%':''
  ].filter(Boolean).join('\n');
  var _tipShld = 'Защитное поле\n\nСуммарное поле всех щитов. Поглощает урон до исчерпания.';
  var _tipRdr  = 'Радар\n\nСуммарная дальность обнаружения в АсК';
  var _tipEng  = 'Энергобаланс\n\nМощность реактора минус потребление всех модулей.\nОтрицательное значение — юнит не может быть создан.';
  var _tipPrc  = 'Стоимость\n\nСумма цен всех установленных модулей в энергокредитах (ЭК)';
  var sbi2=[
    totalHP2>0      &&{k:'HP',   v:Math.round(totalHP2),                         cls:'--hp'},
    totalDmg2>0     &&{k:'УРН',  v:totalDmg2,                                    cls:'--hp'},
    true            &&{k:'СКОР', v:totalSpeedU>0?_fmtSpd(totalSpeedU):'1 АсК/ход',cls:''},
    totalShield2>0  &&{k:'ЩИТ',  v:Math.round(totalShield2),                     cls:''},
    radarRangeBonus>0   &&{k:'РДР',  v:'+'+radarRangeBonus+' АсК', cls:'', tip:'Бонус дальности от радаров\n\nПрибавляется к дальности всех орудий\n'+(radarNames.join(', ')||'радар')+' → +'+radarRangeBonus+' АсК'},
    reactorPower>0  &&{k:'ЭНГ',  v:(energyBal2>=0?'+':'')+energyBal2+' МВт',    cls:energyBal2<0?'--hp':''},
    totalPrice2>0   &&{k:'ЦЕНА', v:fmtP(totalPrice2),                            cls:''},
  ].filter(Boolean);
  var _tipMap={'HP':_tipHP,'УРН':_tipDmg,'СКОР':_tipSpd,'ЩИТ':_tipShld,'РДР':_tipRdr,'ЭНГ':_tipEng,'ЦЕНА':_tipPrc};
  var _vcMap={'HP':'--hp','ЩИТ':'--hp','УРН':'--dmg','ЦЕНА':'--gold','РДР':'--cyan'};
  var sbiHtml2=sbi2.map(function(x){
    var tip=_tipMap[x.k]||'';
    var vc=_vcMap[x.k]||(x.cls==='--hp'?'--neg':'');
    return '<div class="un-stat"'+(tip?' data-tip="'+esc(tip)+'"':'')+'>'+
      '<span class="un-stat-k">'+esc(x.k)+'</span>'+
      '<span class="un-stat-v'+(vc?' un-stat-v'+vc:'')+'">'+esc(String(x.v))+'</span></div>';
  }).join('');

  // ── Derived ───────────────────────────────────────────────
  var drvRows2=[
    totalHP2>0        &&[,'Прочность',       armorNames.join(', ')||'броня',      Math.round(totalHP2)+'',         ''],
    totalShield2>0    &&[,'Защитное поле',    shieldNames.join(', ')||'щит',       Math.round(totalShield2)+'',     ''],
    totalSpeedU>0     &&[,'Скорость',         engNames.join(', ')||'двигатель',    totalSpeedFmt||totalSpeedU+' АсК/ход',''],
    radarRangeBonus>0 &&[,'Дальность (радар)', radarNames.join(', '),               '+'+radarRangeBonus+' АсК к орудиям', ''],
    reactorPower>0    &&[,'Энергия',          reactorName+' · '+usedPower2+' МВт пот.', (energyBal2>=0?'+':'')+energyBal2+' МВт', ec2(energyBal2,reactorPower)],
    baseCapacity2>0   &&[,'Вместимость',      'масса×0.7'+(reactorCapB?'+'+reactorCapB:''),freeCap2+'/'+baseCapacity2+' ед.',ec2(freeCap2,baseCapacity2)],
  ].filter(Boolean);
  var _drvTipMap={'Прочность':_tipHP,'Защитное поле':_tipShld,'Скорость':_tipSpd,'Радар':_tipRdr,'Энергия':_tipEng,'Вместимость':'Вместимость\n\nБазовая = Масса × 0.7 + бонус реактора\nОрудия и модули занимают вместимость\nЕсли в минусе — юнит нельзя создать','Стоимость':_tipPrc};
  var drvHtml2=drvRows2.map(function(r){
    var tipBase=_drvTipMap[r[1]]||'';
    var tip=tipBase+(r[2]?'\n\nИсточник: '+r[2]:'');
    return '<div class="un-param-row"'+(tip?' data-tip="'+esc(tip)+'"':'')+'>'+
      '<span class="un-param-k">'+esc(r[1])+'</span>'+
      '<span class="un-param-v"'+(r[4]?' style="color:'+r[4]+'"':'')+'>'+esc(r[3])+'</span>'+
      '</div>';
  }).join('');





  var descHtml2=(extra['Описание']||extra['описание'])?
    '<div class="ch-section-label" style="margin-top:24px">ОПИСАНИЕ</div>'+
    '<div class="ch-bio">'+esc(extra['Описание']||extra['описание']).replace(/\n/g,'<br>')+'</div>':'';

  // ── Ресурсные бары (энергия + вместимость) ─────────────────
  var _pwPct = reactorPower>0 ? Math.min(100,Math.round(usedPower2/reactorPower*100)) : 0;
  var _cpPct = baseCapacity2>0 ? Math.min(100,Math.round(usedCap2/baseCapacity2*100)) : 0;
  var _pwC = energyBal2<0?'#f44336':energyBal2<reactorPower*0.1?'#ff9800':'#4caf50';
  var _cpC = freeCap2<0?'#f44336':freeCap2<baseCapacity2*0.1?'#ff9800':'#4caf50';

  // ── Секция "Установка" — реактор + корпус ───────────────────
  var _boostStr = (_boostSpd>0||_boostRdr>0||_boostShd>0)
    ? '🚀 '+(_boostSpd?'скор +'+_boostSpd+'% ':'')+(_boostRdr?'рдр +'+_boostRdr+'% ':'')+(_boostShd?'щит +'+_boostShd+'%':'')
    : '';
  var installHtml =
    '<div class="un-install-grid">'
    +(reactorName
      ? '<div class="un-install-card" style="border-top-color:rgba(255,152,0,.9)">'
        +'<div class="un-ic-label">⚛ РЕАКТОР</div>'
        +'<div class="un-ic-name">'+esc(reactorName)+'</div>'
        +(reactorPower>0 ? '<div class="un-ic-stat">⚡ '+reactorPower+' МВт  ✦ force '+reactorForce+'</div>' : '')
        +(_boostStr ? '<div class="un-ic-stat" style="color:#4caf50">'+_boostStr+'</div>' : '')
        +'</div>'
      : '')
    +'<div class="un-install-card" style="border-top-color:rgba(28,100,148,.9)">'
      +'<div class="un-ic-label">⊕ КОРПУС</div>'
      +'<div class="un-ic-name">'+esc(classLabel2)+(hullName?' · '+esc(hullName):'')+'</div>'
      +'<div class="un-ic-stat">'+unitMass.toLocaleString('ru')+' кг'+(unitGabarit?' · габарит '+unitGabarit:'')+'</div>'
      +'</div>'
    +'</div>';

  // ── Ресурсные бары ───────────────────────────────────────────
  var resourceBarsHtml = (reactorPower>0||baseCapacity2>0) ?
    '<div class="un-res-bars">'
    +(reactorPower>0?
      '<div class="un-res-bar" data-tip="'+esc('Энергобюджет\n\nРеактор: '+reactorPower+' МВт\nИспользовано: '+usedPower2+' МВт\nСвободно: '+energyBal2+' МВт')+'">'
      +'<div class="un-res-label"><span style="color:'+_pwC+'">⚡ ЭНЕРГИЯ</span><span style="color:'+_pwC+'">'+usedPower2+' / '+reactorPower+' МВт</span></div>'
      +'<div class="un-res-track"><div class="un-res-fill" style="width:'+_pwPct+'%;background:'+_pwC+'"></div></div>'
      +'</div>':'')
    +(baseCapacity2>0?
      '<div class="un-res-bar" data-tip="'+esc('Вместимость\n\nБаза: масса×0.7 = '+Math.round(unitMass*0.7)+'\nИспользовано: '+usedCap2+'\nСвободно: '+freeCap2)+'">'
      +'<div class="un-res-label"><span style="color:'+_cpC+'">📦 ВМЕСТИМОСТЬ</span><span style="color:'+_cpC+'">'+usedCap2+' / '+baseCapacity2+' ед.</span></div>'
      +'<div class="un-res-track"><div class="un-res-fill" style="width:'+_cpPct+'%;background:'+_cpC+'"></div></div>'
      +'</div>':'')
    +'</div>' : '';

  // ── Оружие с дальностью ──────────────────────────────────────
  var weapHtml2 = weapList2.length
    ? '<div class="un-weap-list">'+weapList2.map(function(w){
        var gp=pages.find(function(p){return (p.title||p.name||'')===w.name;});
        var sl=gp?gp.slug:w.name;
        return '<div class="un-weap-row" onclick="uShowDetail(\''+esc(w.name)+'\',\''+esc(sl)+'\',\'weapon\',\'un-detail-weapons\')" style="cursor:pointer" data-tip="'+esc('⚔ '+w.name+'\nУрон: '+w.dmg+(w.range?'\nДальность: '+w.range:''))+'">'
          +'<div class="un-weap-name">'+esc(w.name)+'</div>'
          +(w.range?'<div class="un-weap-range">'+esc(w.range)+'</div>':'')
          +'<div class="un-weap-dmg">'+w.dmg+'</div>'
          +'</div>';
      }).join('')+'</div>'
    : '<div class="ch-empty">Вооружение не установлено</div>';

  // ── Модули по группам ────────────────────────────────────────
  var _mkModGroup = function(names, slt, label, icon, color) {
    var items = names.filter(Boolean);
    if (!items.length) return '';
    return '<div class="un-mod-group">'
      +'<div class="un-mg-label" style="color:'+color+'">'+icon+' '+label+'</div>'
      +'<div class="un-mg-items">'
      +items.map(function(name){
        var gp=pages.find(function(p){return (p.title||p.name||'')===name;});
        var sl=gp?gp.slug:name;
        var ep=parseFloat(_ibv(name,'Потребление энергии')||0)||0;
        var cp=parseFloat(_ibv(name,'Штраф вместимости')||0)||0;
        return '<div class="un-mod-item" onclick="uShowDetail(\''+esc(name)+'\',\''+esc(sl)+'\',\''+slt+'\',\'un-detail-modules\')" style="cursor:pointer">'
          +'<div class="un-mod-dot" style="background:'+color+'"></div>'
          +'<div class="un-mod-name">'+esc(name)+'</div>'
          +(ep||cp?'<div class="un-mod-cost">'+(ep?'−'+ep+' МВт':'')+( ep&&cp?' ':'')+( cp?'−'+cp+' вмст':'')+'</div>':'')
          +'</div>';
      }).join('')
      +'</div></div>';
  };

  var modHtml2 =
    _mkModGroup(engNames,   'engine', 'ДВИГАТЕЛИ',  '⚙', '#4caf50')
   +_mkModGroup(armorNames, 'armor',  'БРОНЯ',       '🛡', '#607d8b')
   +_mkModGroup(radarNames, 'radar',  'РАДАРЫ',      '◎', '#00e5ff')
   +_mkModGroup(shieldNames,'shield', 'ЩИТЫ',        '◈', '#7c4dff')
   +_mkModGroup(modNames,   'module', 'МОДУЛИ',      '🔧', '#aaa');

  if (!modHtml2) modHtml2 = '<div class="ch-empty">Модули не установлены</div>';

  // ── Итоговая цена ────────────────────────────────────────────
  var priceHtml = totalPrice2>0
    ? '<div class="un-price-row"><span class="un-price-label">СТОИМОСТЬ</span><span class="un-price-val">'+esc(fmtP(totalPrice2))+'</span></div>'
    : '';

  setPg('<div class="ch-root">'+
    '<div class="ch-hero">'+
      (pg.image_url?'<img class="ch-hero-bg" src="'+esc(pg.image_url)+'" loading="eager" alt="">':'')+
      (pg.image_url?'<img class="ch-hero-img" src="'+esc(pg.image_url)+'" loading="eager" alt="'+esc(pT(pg))+'">':'<div class="ch-hero-img-ph"></div>')+
      '<div class="ch-hero-grad"></div><div class="ch-hero-scanlines"></div>'+
      '<div class="ch-hero-corner ch-hero-corner--tl"></div><div class="ch-hero-corner ch-hero-corner--tr"></div>'+
      '<div class="ch-hero-info">'+
        '<h1 class="ch-name">'+esc(pT(pg))+'</h1>'+
        '<div class="ch-hero-badges">'+
          '<div class="ch-badge-faction"><span class="ch-faction-gem"></span>'+esc(classLabel2)+'</div>'+
          '<div class="ch-badge-status" style="color:'+st2.color+';border-color:'+st2.color+'">'+st2.label+'</div>'+
          (reactorName?'<div class="ch-badge-faction" style="border-color:rgba(201,161,74,.35);color:#4e9ed8">⚛ '+esc(reactorName)+'</div>':'')+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="ch-mob-hero">'+
      (pg.image_url?'<img class="ch-mob-img" src="'+esc(pg.image_url)+'" loading="eager" alt="">':'<div class="ch-mob-img-ph"></div>')+
      '<div class="ch-mob-grad"></div>'+
      '<div class="ch-mob-info">'+
        '<div class="ch-mob-name">'+esc(pT(pg))+'</div>'+
        '<div class="ch-mob-badges">'+
          '<span class="ch-mob-badge ch-mob-badge--faction">'+esc(classLabel2)+'</span>'+
          '<span class="ch-mob-badge" style="color:'+st2.color+';border-color:'+st2.color+'">'+st2.label+'</span>'+
          (reactorName?'<span class="ch-mob-badge" style="color:#4e9ed8">⚛ '+esc(reactorName)+'</span>':'')+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="un-statbar">'+sbiHtml2+'</div>'+
    resourceBarsHtml+
    '<div class="ch-tabs">'+
      '<button class="ch-tab on" onclick="chTab(\'unit-overview\',this)">ОБЗОР</button>'+
      '<button class="ch-tab" onclick="chTab(\'unit-weapons\',this)">ВООРУЖЕНИЕ</button>'+
      '<button class="ch-tab" onclick="chTab(\'unit-modules\',this)">МОДУЛИ</button>'+
    '</div>'+
    '<div class="ch-panel on" id="ch-unit-overview">'+
      '<div style="padding:28px 48px 40px">'+
        installHtml+
        '<div class="un-section-label" style="margin-top:4px">ТАКТИЧЕСКИЕ ПАРАМЕТРЫ</div>'+
        '<div class="un-derived">'+(drvRows2.length?drvHtml2:'<div class="un-empty">Нет данных</div>')+'</div>'+
        priceHtml+
        descHtml2+
      '</div>'+
    '</div>'+
    '<div class="ch-panel" id="ch-unit-weapons">'+
      '<div class="un-two-col">'+
        '<div class="un-col-left">'+
          '<div class="ch-section-label">ВООРУЖЕНИЕ</div>'+
          weapHtml2+
        '</div>'+
        '<div class="un-col-right" id="un-detail-weapons">'+
          '<div class="un-detail-empty">'+
            '<div class="un-detail-empty-icon">⚔</div>'+
            '<div class="un-detail-empty-text">Выберите орудие</div>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="ch-panel" id="ch-unit-modules">'+
      '<div class="un-two-col">'+
        '<div class="un-col-left">'+
          '<div class="ch-section-label">УСТАНОВЛЕННЫЕ МОДУЛИ</div>'+
          modHtml2+
        '</div>'+
        '<div class="un-col-right" id="un-detail-modules">'+
          '<div class="un-detail-empty">'+
            '<div class="un-detail-empty-icon">◈</div>'+
            '<div class="un-detail-empty-text">Выберите модуль</div>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>');
  renderCommentsSection(pg.slug);
}
async function renderCharacterPage(pg) {
  const isDraft  = pg.status === 'draft';
  const canAdmin = user && ['superadmin','editor','moderator'].includes(user.role);
  if (isDraft && !canAdmin) {
    setPg(`<div class="sempty"><div style="font-size:48px;opacity:.15">◈</div><div>${T('notFound')}</div></div>`);
    return;
  }

  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);

  let ch = null;
  try {
    ch = (await dbGet('characters', `slug=eq.${encodeURIComponent(pg.slug)}&select=*&limit=1`))?.[0] || null;
  } catch(e) {}

  if (!ch) {
    setPg(`<div class="sempty">
      <div style="font-size:48px;opacity:.15">◈</div>
      <div>Данные персонажа не найдены</div>
      ${canAdmin ? `<button class="btn btn-gd" style="margin-top:16px" onclick="toggleEdit()">✎ Заполнить</button>` : ''}
    </div>`);
    return;
  }

  const extra     = ch.extra     || {};
  const stats     = ch.stats     || {};
  const abilities = ch.abilities || [];
  const gear      = ch.gear      || [];

  // ── Уровень ────────────────────────────────────────────────
  // Эталон: игроки с 2014 года ≈ максимальный уровень (20)
  // Для dead/retired — замораживаем на дате play_end
  const REFERENCE_YEAR = 2014;
  const MAX_LEVEL = 20;

  const startDate = ch.play_start ? new Date(ch.play_start) : new Date();
  const isFinished = ch.status === 'dead' || ch.status === 'retired';
  const endDate = (isFinished && ch.play_end) ? new Date(ch.play_end) : new Date();

  // Количество дней в игре
  const daysPlayed = Math.max(0, Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)));
  // Количество дней у эталонного игрока (с 2014 по сегодня)
  const refDays = Math.floor((new Date() - new Date(`${REFERENCE_YEAR}-01-01`)) / (1000 * 60 * 60 * 24));
  // Уровень пропорционально эталону
  const lvl = Math.min(MAX_LEVEL, Math.max(1, Math.round((daysPlayed / refDays) * MAX_LEVEL)));
  const pb  = Math.ceil(lvl / 4) + 1;

  // Лейбл для тултипа уровня
  const lvlYears = (daysPlayed / 365).toFixed(1);
  const lvlFrozenNote = isFinished ? `\n\n⚠ Уровень заморожен — персонаж ${ch.status === 'dead' ? 'погиб' : 'на покое'} (${ch.play_end || '—'})` : '';
  const mod = v => { const m = Math.floor(((v||10)-10)/2); return (m>=0?'+':'')+m; };

  const CLASS_LABELS = {
    soldier:'Солдат',pilot:'Пилот',agent:'Агент',commander:'Командир',
    engineer:'Инженер',diplomat:'Дипломат',hacker:'Хакер',
    medic:'Медик',sniper:'Снайпер',spy:'Шпион',warlord:'Военачальник',navigator:'Навигатор',
  };
  const clsLabel = CLASS_LABELS[ch.class] || ch.class || '—';
  const STATUS   = {
    active: {label:'АКТИВЕН', color:'#4caf50'},
    dead:   {label:'ПОГИБ',   color:'#f44336'},
    retired:{label:'НА ПОКОЕ',color:'rgba(28,100,148,.85)'},
  };
  const st = STATUS[ch.status] || STATUS.active;

  // ── Загружаем данные предметов: по source_slug или по имени ──
  const itemPagesList = pages.filter(p => isVisiblePage(p) && p.page_type === 'item');
  const liveItems = {}; // индекс: slug -> page, name -> page

  await Promise.all(gear.map(async g => {
    let pageSlug = g.source_slug;
    if (!pageSlug) {
      const found = itemPagesList.find(p => pT(p) === g.name || p.title === g.name || p.title_ru === g.name);
      if (found) pageSlug = found.slug;
    }
    if (!pageSlug) return;
    if (_pgCache.has(pageSlug) && _pgCache.get(pageSlug)?.content) {
      const cached = _pgCache.get(pageSlug);
      liveItems[pageSlug] = cached;
      liveItems[g.name]   = cached;
      return;
    }
    try {
      const rows = await dbGet('pages', 'slug=eq.'+encodeURIComponent(pageSlug)+'&select=slug,content,image_url&limit=1');
      const r = rows?.[0];
      if (r) { _pgCache.set(r.slug, r); liveItems[r.slug] = r; liveItems[g.name] = r; }
    } catch(e) {}
  }));

  // ── Читаем поле infobox (ключи хранятся как 'Редкость', 'Бонус КЗ' и т.д.) ──
  // Читаем infobox: принимает source_slug или имя предмета
  const _ib = (nameOrSlug, key) => {
    if (!nameOrSlug) return '';
    try {
      const src = liveItems[nameOrSlug]?.content || _pgCache.get(nameOrSlug)?.content || '[]';
      const ib  = JSON.parse(src).find(b => b.type === 'infobox');
      if (!ib) return '';
      const kl = key.toLowerCase().trim();
      for (const s of ib.sections||[])
        for (const r of s.rows||[])
          if ((r.key||'').toLowerCase().trim() === kl) return r.val||'';
    } catch {}
    return '';
  };

  // ── Бонусы от снаряжения ──────────────────────────────────
  const gb = {str:0,dex:0,con:0,int:0,wis:0,cha:0,hp:0};
  
  for (const g of gear) {
    const s = g.source_slug || g.name;
    
    // Бонусы к характеристикам
    for (const [key,stat] of [
      ['Бонус СИЛ','str'],['Бонус ЛОВ','dex'],['Бонус ТЕЛ','con'],
      ['Бонус ИНТ','int'],['Бонус МДР','wis'],['Бонус ХАР','cha'],
    ]) {
      const raw = _ib(s,key) || _ib(g.name,key);
      const v = parseInt(raw, 10);
      if (v && !isNaN(v)) gb[stat] = (gb[stat]||0) + v;
    }
    
    // HP брони
    const hpRaw = _ib(s,'HP') || _ib(g.name,'HP') || _ib(s,'hp') || _ib(g.name,'hp');
    const hpNum = parseInt(hpRaw, 10);
    if (hpNum && !isNaN(hpNum)) gb.hp = (gb.hp||0) + hpNum;
    // Слот
    const slt_g = _ib(s,'Слот') || _ib(g.name,'Слот') || g.slot || '';
    // Двигатель
    if (slt_g === 'engine') {
      const thrust = parseFloat(_ib(s,'Сила тяги')||_ib(g.name,'Сила тяги')||0);
      if (thrust > (gb.engineThrust||0)) {
        gb.engineThrust = thrust;
        gb.engineName   = g.name || s;
        gb.engineClass  = (_ib(s,'Класс юнита')||_ib(g.name,'Класс юнита')||'').toLowerCase();
      }
    }
    // Реактор
    if (slt_g === 'reactor') {
      const rp = parseFloat(_ib(s,'Сила реактора')||_ib(g.name,'Сила реактора')||0);
      if (rp > (gb.reactorPower||0)) {
        gb.reactorPower = rp;
        gb.reactorName  = g.name || s;
      }
    }
    // Оружие — урон
    if (slt_g === 'weapon' && typeof calculateWeaponStats === 'function') {
      const _wi = (k1,k2) => _ib(s,k1)||_ib(g.name,k1)||(k2?_ib(s,k2)||_ib(g.name,k2):'')||'';
      const _ws = calculateWeaponStats({
        caliber    :_wi('Калибр','caliber'),
        weight     :_wi('Вес','weight'),
        fireRate   :_wi('Темп стрельбы','fire_rate'),
        techType   :_wi('Тип технологии','tech_type'),
        damageType :_wi('Тип урона','damage_type'),
        weaponClass:_wi('Класс оружия','weapon_class'),
        baseRange  :_wi('Дальность','base_range'),
      },{radarDalnostBoost:0});
      const _md = parseInt(_ib(s,'Урон')||_ib(g.name,'Урон'),10)||0;
      const _wd = _md || (_ws.damage>0?_ws.damage:0);
      if (!gb.weapons) gb.weapons = [];
      gb.weapons.push({name:g.name||s, dmg:_wd, range:_ws.finalRange>0?_ws.rangeLabel:''});
      if (_wd > (gb.weaponDmg||0)) {
        gb.weaponDmg   = _wd;
        gb.weaponRange = _ws.finalRange>0 ? _ws.rangeLabel : '';
        gb.weaponName  = g.name || s;
      }
    }
  }

  const fs      = k => (stats[k]||10)+(gb[k]||0);
  const acTotal = 10+Math.floor(((stats.dex||10)-10)/2); // КЗ только от ЛОВ
  
  // HP с использованием коэффициентов
  const hp_base_per_level = typeof getCoef === 'function' ? getCoef('char_hp_base_per_level') : 8;
  const hp_con_divisor = typeof getCoef === 'function' ? getCoef('char_hp_con_divisor') : 2;
  const hpTotal = lvl * (hp_base_per_level + Math.floor((fs('con')-10) / hp_con_divisor)) + (gb.hp||0);
  const initVal = Math.floor((fs('dex')-10)/2);

  // ── Снаряжение ─────────────────────────────────────────────
  const RC={common:'#666',uncommon:'#4caf50',rare:'#2196f3',epic:'#9c27b0',legendary:'#ff9800'};
  const RL={common:'Обычный',uncommon:'Необычный',rare:'Редкий',epic:'Эпический',legendary:'Легендарный'};
  const SI={weapon:'⚔',armor:'🛡',helmet:'⛑',ring:'◇',artifact:'◈',consumable:'⬡',engine:'⚙',reactor:'⚛',radar:'◎',shield:'◈',module:'🔧',hull:'⊕'};
  const SL={weapon:'Оружие',armor:'Броня',helmet:'Шлем',ring:'Кольцо',artifact:'Артефакт',consumable:'Расходник',engine:'Двигатель',reactor:'Реактор',radar:'Радар',shield:'Щит',module:'Модуль',hull:'Корпус'};

  const gearHtml = gear.length ? gear.map(g => {
    const s   = g.source_slug || g.name;
    const gp  = pages.find(p => p.slug===g.source_slug || pT(p)===g.name);
    const img = liveItems[s]?.image_url || liveItems[g.name]?.image_url || g.image_url || gp?.image_url;
    const rar = _ib(s,'Редкость') || _ib(g.name,'Редкость') || g.rarity || 'common';
    const slt = _ib(s,'Слот')     || _ib(g.name,'Слот')     || g.slot   || '';
    const rc  = RC[rar]||'#666';
    const tags = [];
    const dmg = _ib(s,'Урон');   if(dmg) tags.push(`⚔ ${dmg}`);
    const def = _ib(s,'Защита'); if(def) tags.push(`🛡 ${def}`);

    // Динамический расчёт оружия
    let wsDmg = 0, wsRange = '';
    if (slt === 'weapon' && typeof calculateWeaponStats === 'function') {
      const _wi = (k1, k2) => _ib(s, k1) || _ib(g.name, k1) || (k2 ? _ib(s, k2) || _ib(g.name, k2) : '') || '';
      const ws = calculateWeaponStats({
        caliber     : _wi('Калибр',         'caliber'),
        weight      : _wi('Вес',            'weight'),
        fireRate    : _wi('Темп стрельбы',  'fire_rate'),
        techType    : _wi('Тип технологии', 'tech_type'),
        damageType  : _wi('Тип урона',      'damage_type'),
        weaponClass : _wi('Класс оружия',   'weapon_class'),
        baseRange   : _wi('Дальность',      'base_range'),
      }, { radarDalnostBoost: 0 });
      if (!dmg && ws.damage > 0) wsDmg = ws.damage;
      if (ws.finalRange > 0) wsRange = ws.rangeLabel;
    }
    
    const hpRaw = _ib(s,'HP') || _ib(g.name,'HP') || _ib(s,'hp') || _ib(g.name,'hp');
    const hpNum = parseInt(hpRaw, 10);
    if (hpNum && !isNaN(hpNum)) tags.push(`♡ ${hpNum.toLocaleString('ru')} HP`);
    for (const [key,lbl] of [
      ['Бонус СИЛ','СИЛ'],['Бонус ЛОВ','ЛОВ'],
      ['Бонус ТЕЛ','ТЕЛ'],['Бонус ИНТ','ИНТ'],['Бонус МДР','МДР'],['Бонус ХАР','ХАР'],
    ]) { const v=parseInt(_ib(s,key),10); if(v) tags.push(`${v>0?'+':''}${v} ${lbl}`); }
    const slug = gp?.slug||s;

    return `<div class="ch-gear-row" style="--rc:${rc}" ${slug?`onclick="go('${esc(slug)}')"`:''}>
      ${img?`<img class="ch-gear-img" src="${esc(img)}" loading="lazy">`
           :`<div class="ch-gear-img ch-gear-img--ph" style="border-color:${rc}; box-shadow: 0 0 15px ${rc}40 inset;">${SI[slt]||'◈'}</div>`}
      <div class="ch-gear-body">
        <div class="ch-gear-name">${esc(g.name||'—')}</div>
        <div class="ch-gear-sub">
          <span style="color:${rc}; text-shadow: 0 0 8px ${rc}80;">${RL[rar]||rar}</span>
          ${slt?`<span style="color:rgba(255,255,255,0.3)">/</span><span style="color:rgba(255,255,255,0.5)">${SL[slt]||slt}</span>`:''}
        </div>
        ${(wsDmg > 0 || wsRange) ? `<div style="display:flex;gap:12px;margin-top:5px;align-items:center">
          ${wsDmg > 0 ? `<div style="font-family:Rajdhani,sans-serif;font-size:11px;font-weight:900;color:#f07070" title="Расчётный урон">⚔ ${wsDmg}</div>` : (dmg ? `<div style="font-family:Rajdhani,sans-serif;font-size:11px;color:#f07070">⚔ ${esc(dmg)}</div>` : '')}
          ${wsRange ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#6bb8d4" title="Дальность">◎ ${esc(wsRange)}</div>` : ''}
        </div>` : ''}
        ${tags.length?`<div class="ch-tags">${tags.map(t=>`<span class="ch-tag">${esc(t)}</span>`).join('')}</div>`:''}
      </div>
    </div>`;
  }).join('') : '';

  
  // ── Способности ───────────────────────────────────────────
  const abPages = pages.filter(p => isVisiblePage(p) && p.page_type==='ability');
  const TC={passive:'rgba(28,100,148,.85)',action:'rgba(80,160,220,.85)',bonus:'rgba(80,200,120,.85)',reaction:'rgba(200,80,80,.85)','1/day':'rgba(160,80,200,.85)','1/rest':'rgba(200,140,80,.85)'};
  const TT={passive:'Пассивная — работает постоянно',action:'Действие — тратит действие в бою',bonus:'Бонусное действие',reaction:'Реакция — в ответ на событие','1/day':'Раз в день','1/rest':'Раз в отдых'};

  const abHtml = abilities.length ? abilities.map(a => {
    const ap      = abPages.find(p => p.slug===a.source_slug || pT(p)===a.name);
    const aSlug   = ap?.slug || a.source_slug;
    const liveType= (_ib(aSlug,'Тип') || a.type || 'passive');
    const clr     = TC[liveType]||TC.passive;
    const liveDesc= _ib(aSlug,'Эффект') || _ib(aSlug,'Описание') || a.desc || '';
    return `<div class="ch-ab-card">
      <div class="ch-ab-top">
        <span class="ch-ab-name"${ap?` onclick="go('${esc(ap.slug)}')" style="cursor:pointer"`:''}>
          ${esc(a.name||'—')}${ap?' <span class="ch-arrow">↗</span>':''}
        </span>
        <span class="ch-ab-type" style="color:${clr}" data-tip="${esc(TT[liveType]||liveType)}">${esc(liveType)}</span>
      </div>
      ${liveDesc?`<div class="ch-ab-desc">${esc(liveDesc).replace(/\n/g,'<br>')}</div>`:''}
    </div>`;
  }).join('') : '';

  // ── Характеристики ────────────────────────────────────────
  const STAT_TIPS={
    str:`Сила — физическая мощь\n\nВлияет на: Атаку в ближнем бою\nЧем выше — тем сильнее рукопашные удары и броски силы`,
    dex:`Ловкость — скорость и точность\n\nВлияет на: Атаку дальнего боя, Инициативу, Рефлексы\nЧем выше — тем точнее стрельба и быстрее реакция`,
    con:`Телосложение — выносливость\n\nВлияет на: Очки здоровья, Стойкость\nЧем выше — тем больше HP и устойчивость к физическим угрозам`,
    int:`Интеллект — острота ума\n\nВлияет на: знания, расследование, технические навыки\nЧем выше — тем лучше анализ и понимание сложных систем`,
    wis:`Мудрость — интуиция и восприятие\n\nВлияет на: Волю, медицину, наблюдательность\nЧем выше — тем лучше чувствуешь опасность и людей`,
    cha:`Харизма — сила личности\n\nВлияет на: убеждение, запугивание, лидерство\nЧем выше — тем проще влиять на других`,
  };

  const statsHtml = Object.entries({str:'СИЛ',dex:'ЛОВ',con:'ТЕЛ',int:'ИНТ',wis:'МДР',cha:'ХАР'}).map(([k,label]) => {
    const base=stats[k]||10, bonus=gb[k]||0, total=base+bonus;
    const pct=Math.round(Math.min(100,(total/20)*100));
    const bonusMod = Math.floor((total-10)/2);
    const bonusStr = bonusMod>=0?`+${bonusMod}`:String(bonusMod);
    const tip=STAT_TIPS[k]
      +`\n\nЗначение: ${total}  →  бонус ${bonusStr}`
      +(bonus?`\n(база ${base} + ${bonus} от снаряжения)`:'');
    return `<div class="ch-stat" data-tip="${esc(tip)}">
      <div class="ch-stat-name">${label}</div>
      <div class="ch-stat-val">${total}</div>
      <div class="ch-stat-mod">${bonusStr}</div>
      ${bonus?`<div class="ch-stat-bonus">+${bonus} ↑</div>`:''}
      <div class="ch-stat-track"><div class="ch-stat-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  // ── Штраф скорости от брони (новая система лимита нагрузки) ──
  let armorSpeedPenalty = 0;
  let armorClassName_ch = '';
  for (const g of gear) {
    const s    = g.source_slug || g.name;
    const slot = _ib(s,'Слот') || _ib(g.name,'Слот') || g.slot || '';
    if (slot !== 'armor') continue;
    // Read stored armor config from infobox fields
    const armorClass  = _ib(s,'Класс брони') || _ib(g.name,'Класс брони') || 'infantry';
    const chermet     = parseFloat(_ib(s,'Чермет') || _ib(g.name,'Чермет')) || 0;
    const ruda        = parseFloat(_ib(s,'Руда')   || _ib(g.name,'Руда'))   || 0;
    const crystals    = parseFloat(_ib(s,'Кристаллы') || _ib(g.name,'Кристаллы')) || 0;
    const starvispp   = parseFloat(_ib(s,'Старвис ПП') || _ib(g.name,'Старвис ПП')) || 0;
    const density_pts = parseFloat(_ib(s,'ОЧ Плотность') || _ib(g.name,'ОЧ Плотность')) || 0;
    const tensile_pts = parseFloat(_ib(s,'ОЧ Прочность') || _ib(g.name,'ОЧ Прочность')) || 0;
    const thermal_pts = parseFloat(_ib(s,'ОЧ Термостойкость') || _ib(g.name,'ОЧ Термостойкость')) || 0;
    const unitGabrit  = parseFloat(extra.gabrit || 1);
    if (typeof calcArmorFull === 'function') {
      const res = calcArmorFull({
        armorClass,
        resources: { chermet, ruda, crystals, starvis: starvispp },
        density_pts, tensile_pts, thermal_pts,
        unit_gabrit: unitGabrit,
      });
      armorSpeedPenalty += res.speed_penalty;
      if (!armorClassName_ch && res.cls?.ru) armorClassName_ch = res.cls.ru;
    }
    break; // только одна броня
  }
  const baseSpeed  = 9;
  const finalSpeed = Math.max(0, baseSpeed - Math.round(armorSpeedPenalty*0.3));
  var askSpeed = 0, askLabel = '', askTip = '';
  if (gb.engineThrust && gb.reactorPower) {
    var _eMap = {пехота:1,infantry:1,техника:2,vehicle:2,бтр:2,танк:4,tank:4,авиация:8,aviation:8,корабль:12,ship:12};
    var _ec = gb.engineClass || '';
    var _eK = _eMap[_ec] || 1;
    var _mDef = {пехота:100,техника:5000,танк:46500,авиация:15000,корабль:800000};
    var _mRaw = parseFloat((extra['масса']||extra['mass']||'').replace(/[^0-9.]/g,''));
    var _mass = _mRaw > 0 ? _mRaw : (_mDef[_ec] || 100);
    var _raw  = (gb.engineThrust * gb.reactorPower) / _mass * 10 / _eK;
    askSpeed  = Math.min(100, parseFloat(_raw.toFixed(2)));
    var _cap  = _ec === 'корабль' || _ec === 'ship';
    askLabel  = (_cap ? Math.round(askSpeed) : askSpeed) + ' АсК/ход';
    askTip    = 'Тяга ' + gb.engineThrust + ' × Реактор ' + gb.reactorPower + ' / Масса ' + _mass + ' × 10 / ' + _eK + ' = ' + askSpeed + ' АсК/ход';
  } else if (gb.engineThrust || gb.reactorPower) {
    askLabel = '—'; askTip = gb.engineThrust ? 'Нет реактора' : 'Нет двигателя';
  }
  var _sm2 = Math.floor(((stats.str||10)+(gb.str||0)-10)/2);
  var _dm2 = Math.floor(((stats.dex||10)+(gb.dex||0)-10)/2);
  var _statB = Math.max(_sm2, _dm2);
  var totalDmg = gb.weaponDmg ? (gb.weaponDmg + _statB + pb) : 0;
  var dmgStat  = _sm2 >= _dm2 ? 'СИЛ' : 'ЛОВ';
  const speedLabel = askSpeed ? askLabel : '1 АсК/ход';
  const DERIVED=[
    {k:'Очки здоровья', v:hpTotal, sub:`${lvl} × (8 + ${Math.floor((fs('con')-10)/2)})`,
     tip:`Сколько урона выдержишь прежде чем упасть\n\nРастёт каждый уровень\nФормула: Уровень × (8 + бонус Телосложения)\n= ${lvl} × (8 + ${Math.floor((fs('con')-10)/2)}) = ${hpTotal}${gb.hp?`\n+ ${gb.hp} от снаряжения`:''}\n\nЧтобы увеличить → прокачивай ТЕЛ и повышай уровень`},
    {k:'Инициатива',    v:(initVal>=0?'+':'')+initVal, sub:`бонус Ловкости`,
     tip:`Определяет порядок ходов в бою\nЧем выше — тем раньше действуешь\n\nРавна бонусу Ловкости\nЛОВ ${fs('dex')} → бонус ${initVal>=0?'+':''}${initVal}\n\nЧтобы увеличить → прокачивай Ловкость`},
    ...(totalDmg ? [{k:'Урон', v:totalDmg, sub:(gb.weaponName||'оружие')+' + '+dmgStat+' + БМ', tip:'Оружие '+gb.weaponDmg+' + '+dmgStat+' '+_statB+' + БМ '+pb+' = '+totalDmg}] : []),
    {k:'Скорость', v: askSpeed ? askLabel : '1 АсК/ход', sub: askSpeed ? (gb.engineName||'двигатель')+' + '+(gb.reactorName||'реактор') : 'без двигателя', tip: askSpeed ? askTip : 'Базовая скорость без двигателя\n1 АсК/ход — минимум\n\nЭкипируй двигатель + реактор для увеличения'},
    {k:'Бонус мастера', v:'+'+pb, sub:`уровень ${lvl}`,
     tip:`Бонус к действиям, которыми ты владеешь\n\nПрибавляется к атакам, навыкам и спасброскам\nАвтоматически растёт с уровнем:\nУровень ${lvl} → +${pb}\n\nНе зависит от характеристик — только от уровня`},
    {k:'Атака ближн.',  v:mod(fs('str')), sub:`бонус Силы`,
     tip:`Бонус к броску атаки в рукопашном бою\n\nРавен бонусу Силы\nСИЛ ${fs('str')} → бонус ${mod(fs('str'))}${gb.str?`\n(+${gb.str} от снаряжения)`:''}\n\nЧтобы увеличить → прокачивай Силу`},
    {k:'Атака дальн.',  v:mod(fs('dex')), sub:`бонус Ловкости`,
     tip:`Бонус к броску атаки при стрельбе\n\nРавен бонусу Ловкости\nЛОВ ${fs('dex')} → бонус ${mod(fs('dex'))}${gb.dex?`\n(+${gb.dex} от снаряжения)`:''}\n\nЧтобы увеличить → прокачивай Ловкость`},
    {k:'Стойкость',     v:'+'+(Math.floor((fs('con')-10)/2)+pb), sub:`ТЕЛ + бонус мастера`,
     tip:`Спасбросок против яда, болезней и физических угроз\n\nЧем выше — тем лучше выдерживаешь\nТЕЛ ${fs('con')} → бонус ${mod(fs('con'))} + БМ +${pb} = ${Math.floor((fs('con')-10)/2)+pb}\n\nЧтобы увеличить → прокачивай Телосложение`},
    {k:'Рефлексы',      v:'+'+(Math.floor((fs('dex')-10)/2)+pb), sub:`ЛОВ + бонус мастера`,
     tip:`Спасбросок против взрывов, ловушек и быстрых угроз\n\nЧем выше — тем лучше уворачиваешься\nЛОВ ${fs('dex')} → бонус ${mod(fs('dex'))} + БМ +${pb} = ${Math.floor((fs('dex')-10)/2)+pb}\n\nЧтобы увеличить → прокачивай Ловкость`},
    {k:'Воля',          v:'+'+(Math.floor((fs('wis')-10)/2)+pb), sub:`МДР + бонус мастера`,
     tip:`Спасбросок против страха, иллюзий и контроля разума\n\nЧем выше — тем сильнее психическая устойчивость\nМДР ${fs('wis')} → бонус ${mod(fs('wis'))} + БМ +${pb} = ${Math.floor((fs('wis')-10)/2)+pb}\n\nЧтобы увеличить → прокачивай Мудрость`},
  ];

  const derivedHtml=DERIVED.map(({k,v,sub,tip})=>
    `<div class="ch-dr-row" data-tip="${esc(tip)}">
      <span class="ch-dr-k">${k}</span>
      <span class="ch-dr-sub">${sub}</span>
      <span class="ch-dr-v">${esc(String(v))}</span>
    </div>`).join('');

  const draft=isDraft?`<div class="ch-draft-bar">⚠ ЧЕРНОВИК</div>`:'';

  // statbar — понятные тултипы
  const sbiHtml = [
    {k:'HP',   v:hpTotal,                     cls:'--hp', tip:`Очки здоровья — сколько урона выдержишь\n\nФормула: Уровень × (8 + бонус ТЕЛ)\n= ${lvl} × (8 + ${Math.floor((fs('con')-10)/2)}) = ${hpTotal}\n\nРастёт с уровнем и показателем Телосложения${gb.hp?`\nСнаряжение даёт +${gb.hp} HP`:''}`},
    {k:'ИНИ',  v:(initVal>=0?'+':'')+initVal, cls:'',     tip:`Инициатива — кто первым действует в бою\n\nЧем выше — тем раньше твой ход\nЗависит от Ловкости: ${fs('dex')} ЛОВ → бонус ${initVal>=0?'+':''}${initVal}`},
    ...(totalDmg ? [{k:'УРН', v:totalDmg, cls:'--hp', tip:'⚔ ' + (gb.weaponName||'оружие') + '\nУрон оружия: ' + gb.weaponDmg + '\n' + dmgStat + ': +' + _statB + '\nБМ: +' + pb + '\n\nИтого: ' + totalDmg + (gb.weaponRange ? '\nДальность: ' + gb.weaponRange : '')}] : []),
    {k:'СКОР', v: askSpeed ? askLabel : '1 АсК/ход', cls:'', tip: askSpeed ? askTip : 'Базовая скорость без двигателя\n1 АсК/ход — минимальное движение\n\nДля увеличения: экипируй двигатель + реактор'},
    {k:'УР',   v:lvl,                          cls:'',     tip:`Уровень персонажа: ${lvl}\n\nВремя в игре: ${lvlYears} лет\nРастёт пропорционально опыту — эталон максимума (ур. 20) это игроки с ${REFERENCE_YEAR} года${lvlFrozenNote}`},
    {k:'БМ',   v:'+'+pb,                       cls:'',     tip:`Бонус мастера — бонус к броскам навыков\n\nУровень ${lvl} → +${pb}\nПрибавляется к атакам, спасброскам и проверкам навыков, которыми владеешь`},
  ].map(({k,v,cls,tip})=>`<div class="ch-sbi" data-tip="${esc(tip)}"><span class="ch-sbi-k">${k}</span><span class="ch-sbi-v${cls?` ch-sbi-v${cls}`:''}"">${v}</span></div>`).join('');

  setPg(`${draft}<div class="ch-root">

    <!-- DESKTOP HERO -->
    <div class="ch-hero">
      ${pg.image_url ? `<img class="ch-hero-bg" src="${esc(pg.image_url)}" loading="eager" alt="">` : ''}
      ${pg.image_url ? `<img class="ch-hero-img" src="${esc(pg.image_url)}" loading="eager" alt="${esc(pT(pg))}">` : '<div class="ch-hero-img-ph"></div>'}
      <div class="ch-hero-grad"></div>
      <div class="ch-hero-scanlines"></div>
      <div class="ch-hero-corner ch-hero-corner--tl"></div>
      <div class="ch-hero-corner ch-hero-corner--tr"></div>
      <div class="ch-hero-info">
        <h1 class="ch-name">${esc(pT(pg))}</h1>
        <div class="ch-hero-badges">
          ${ch.faction ? `<div class="ch-badge-faction"><span class="ch-faction-gem"></span>${esc(ch.faction)}</div>` : ''}
          <div class="ch-badge-status" style="color:${st.color};border-color:${st.color}">${st.label}</div>
        </div>
      </div>
    </div>

    <!-- STATBAR (sticky под hero, скрыт на мобиле через CSS) -->
    <div class="ch-statbar">${sbiHtml}</div>

    <!-- MOBILE HERO (display:none на десктопе, block на ≤768) -->
    <div class="ch-mob-hero">
      ${pg.image_url ? `<img class="ch-mob-img" src="${esc(pg.image_url)}" loading="eager" alt="">` : '<div class="ch-mob-img-ph"></div>'}
      <div class="ch-mob-grad"></div>
      <div class="ch-mob-info">
        <h1 class="ch-mob-name">${esc(pT(pg))}</h1>
        <div class="ch-mob-badges">
          ${ch.faction ? `<span class="ch-mob-badge ch-mob-badge--faction">◆ ${esc(ch.faction)}</span>` : ''}
          <span class="ch-mob-badge" style="color:${st.color};border-color:${st.color}">${st.label}</span>
        </div>
      </div>
    </div>

    <!-- MOBILE STATS STRIP (display:none на десктопе) -->
    <div class="ch-mob-stats">
      <div class="ch-mob-stat"><span class="ch-mob-stat-k">HP</span><span class="ch-mob-stat-v ch-mob-stat-v--hp">${hpTotal}</span></div>
      <div class="ch-mob-stat"><span class="ch-mob-stat-k">ИНИ</span><span class="ch-mob-stat-v">${initVal >= 0 ? '+' : ''}${initVal}</span></div>
      ${totalDmg ? `<div class="ch-mob-stat"><span class="ch-mob-stat-k">УРН</span><span class="ch-mob-stat-v ch-mob-stat-v--hp">${totalDmg}</span></div>` : ''}
      <div class="ch-mob-stat"><span class="ch-mob-stat-k">СКОР</span><span class="ch-mob-stat-v">${askSpeed ? askLabel : '1 АсК/ход'}</span></div>
      <div class="ch-mob-stat"><span class="ch-mob-stat-k">УР</span><span class="ch-mob-stat-v">${lvl}</span></div>
      <div class="ch-mob-stat"><span class="ch-mob-stat-k">БМ</span><span class="ch-mob-stat-v">+${pb}</span></div>
    </div>

    <!-- TABS -->
    <div class="ch-tabs">
      <button class="ch-tab on" onclick="chTab('dosye',this)">ДОСЬЕ</button>
      <button class="ch-tab" onclick="chTab('stats',this)">ХАРАКТЕРИСТИКИ</button>
      <button class="ch-tab" onclick="chTab('gear',this)">СНАРЯЖЕНИЕ</button>
      <button class="ch-tab" onclick="chTab('ab',this)">СПОСОБНОСТИ</button>
    </div>

    <!-- PANEL: ДОСЬЕ -->
    <div class="ch-panel on" id="ch-dosye">
      ${extra.bio
        ? `<div class="ch-section-label">БИОГРАФИЯ</div>
           <div class="ch-bio prose">${renderMd(extra.bio)}</div>`
        : `<div class="ch-empty">БД ПУСТА // ДАННЫЕ УДАЛЕНЫ</div>`}
    </div>

    <!-- PANEL: ХАРАКТЕРИСТИКИ -->
    <div class="ch-panel" id="ch-stats">
      <div class="ch-stats-grid">${statsHtml}</div>
      <div class="ch-section-label" style="margin-top:24px">ПРОИЗВОДНЫЕ ПАРАМЕТРЫ</div>
      <div class="ch-derived">${derivedHtml}</div>
    </div>

    <!-- PANEL: СНАРЯЖЕНИЕ -->
    <div class="ch-panel" id="ch-gear">
      ${gearHtml
        ? `<div class="ch-gear-list">${gearHtml}</div>`
        : `<div class="ch-empty">БАЗА ДАННЫХ СНАРЯЖЕНИЯ ПУСТА</div>`}
    </div>

    <!-- PANEL: СПОСОБНОСТИ -->
    <div class="ch-panel" id="ch-ab">
      ${abHtml
        ? `<div class="ch-ab-list">${abHtml}</div>`
        : `<div class="ch-empty">НЕТ СПОСОБНОСТЕЙ</div>`}
    </div>

  </div>`);

  renderCommentsSection(pg.slug);
}

// 3. ДОБАВЬ ЭТОТ JS В ФАЙЛ render.js (вне других функций, чтобы выполнился один раз).
// Этот скрипт отвязывает тултип от верстки, он будет следовать за мышью и никогда не обрежется.

(function initGlobalTooltip() {
  if (document.getElementById('rpg-tooltip')) return;
  // Skip tooltips on touch devices
  if ('ontouchstart' in window) return;
  
  const tip = document.createElement('div');
  tip.id = 'rpg-tooltip';
  document.body.appendChild(tip);

  let activeTarget = null;

  document.addEventListener('mouseover', e => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    
    activeTarget = target;
    let text = target.getAttribute('data-tip').replace(/\n/g, '<br>');
    
    if (text.includes('<br>')) {
      text = text.replace(/^(.*?)<br>/, '<strong>$1</strong>');
    } else {
      text = `<strong>${text}</strong>`;
    }

    tip.innerHTML = text;
    tip.classList.add('visible');
  });

  document.addEventListener('mousemove', e => {
    if (!activeTarget || !tip.classList.contains('visible')) return;
    
    const GAP = 14;
    let x = e.clientX + GAP;
    let y = e.clientY + GAP;
    
    // Force a layout to get real dimensions
    tip.style.left = '0px';
    tip.style.top  = '-9999px';
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (x + w > vw - 8) x = e.clientX - w - GAP;
    if (x < 8)          x = 8;
    if (y + h > vh - 8) y = e.clientY - h - GAP;
    if (y < 8)          y = 8;

    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });

  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-tip]')) {
      activeTarget = null;
      tip.classList.remove('visible');
    }
  });
})();



function chTab(id, el) {
  document.querySelectorAll('.ch-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.ch-panel').forEach(p => p.classList.remove('on'));
  document.getElementById('ch-'+id)?.classList.add('on');
}

function csTab(id, el) { chTab(id, el); }

// adjustHeroMask — removed (SVG mask approach was fragile)
function adjustHeroMask(img) { /* no-op, legacy stub */ }




// ══════════════════════════════════════════════════════════════
// WEAPON PREVIEW FILTERS — фильтры для превью оружия
// ══════════════════════════════════════════════════════════════
function wpvToggleFilters(slug) {
  const panel = document.getElementById(`wpv-filters-${slug}`);
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
}

function wpvResetFilters(slug) {
  if (!_previewState[slug]) return;
  _previewState[slug] = {
    weaponClass: 'all', techType: 'all', damageType: 'all', rarity: 'all',
    damageRange: 'all', rangeRange: 'all', caliberRange: 'all',
    weightRange: 'all', fireRateRange: 'all', sort: 'none'
  };
  document.querySelectorAll('.wpv-filters-panel input[type="radio"]').forEach(inp => {
    inp.checked = inp.value === 'all' || inp.value === 'none';
  });
  document.querySelectorAll('.wpv-sort-btn').forEach(btn => btn.classList.remove('active'));
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvUpdateFilterCount(slug) {
  const st = _previewState[slug];
  if (!st) return;
  let count = 0;
  if (st.weaponClass !== 'all') count++;
  if (st.techType !== 'all') count++;
  if (st.damageType !== 'all') count++;
  if (st.rarity !== 'all') count++;
  if (st.damageRange !== 'all') count++;
  if (st.rangeRange !== 'all') count++;
  if (st.caliberRange !== 'all') count++;
  if (st.weightRange !== 'all') count++;
  if (st.fireRateRange !== 'all') count++;
  const badge = document.getElementById(`wpv-filter-count-${slug}`);
  if (badge) {
    badge.textContent = count > 0 ? String(count) : '';
    badge.style.display = count > 0 ? '' : 'none';
  }
}

function wpvSetClass(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].weaponClass = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetTech(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].techType = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetDamageType(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].damageType = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetRarity(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].rarity = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetDamageRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].damageRange = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetRangeRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].rangeRange = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetCaliberRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].caliberRange = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetWeightRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].weightRange = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetFireRateRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].fireRateRange = val;
  wpvUpdateFilterCount(slug);
  wpvApplyFilters(slug);
}

function wpvSetSort(slug, val) {
  if (!_previewState[slug]) return;
  const prevSort = _previewState[slug].sort;
  // Toggle между desc/asc/none
  if (val.includes('-desc') && prevSort === val) {
    _previewState[slug].sort = val.replace('-desc', '-asc');
  } else if (val.includes('-asc') && prevSort === val) {
    _previewState[slug].sort = 'none';
  } else {
    _previewState[slug].sort = val;
  }
  document.querySelectorAll('.wpv-sort-btn').forEach(btn => btn.classList.remove('active'));
  if (_previewState[slug].sort !== 'none') {
    const activeBtn = document.querySelector(`.wpv-sort-btn[onclick*="'${_previewState[slug].sort.split('-')[0]}-"]`);
    activeBtn?.classList.add('active');
  }
  wpvApplyFilters(slug);
}

function wpvApplyFilters(slug) {
  const st = _previewState[slug];
  if (!st) return;
  
  const ranges = window._wpvRanges?.[slug] || {};
  const cards = Array.from(document.querySelectorAll('.wpv-card'));
  
  cards.forEach(card => {
    const wClass = card.dataset.class || '';
    const tech = card.dataset.tech || '';
    const dmgType = card.dataset.dmgtype || '';
    const rarity = card.dataset.rarity || '';
    const damage = parseFloat(card.dataset.damage) || 0;
    const range = parseFloat(card.dataset.range) || 0;
    const caliber = parseFloat(card.dataset.caliber) || 0;
    const weight = parseFloat(card.dataset.weight) || 0;
    const fireRate = parseFloat(card.dataset.firerate) || 0;
    
    let show = true;
    
    // Категориальные фильтры
    if (st.weaponClass !== 'all' && wClass !== st.weaponClass) show = false;
    if (st.techType !== 'all' && tech !== st.techType) show = false;
    if (st.damageType !== 'all' && dmgType !== st.damageType) show = false;
    if (st.rarity !== 'all' && rarity !== st.rarity) show = false;
    
    // Диапазонные фильтры
    if (st.damageRange !== 'all' && ranges.damageRanges) {
      const idx = parseInt(st.damageRange, 10);
      const r = ranges.damageRanges[idx];
      if (r && (damage < r.min || damage > r.max)) show = false;
    }
    
    if (st.rangeRange !== 'all' && ranges.rangeRanges) {
      const idx = parseInt(st.rangeRange, 10);
      const r = ranges.rangeRanges[idx];
      if (r && (range < r.min || range > r.max)) show = false;
    }
    
    if (st.caliberRange !== 'all' && ranges.caliberRanges) {
      const idx = parseInt(st.caliberRange, 10);
      const r = ranges.caliberRanges[idx];
      if (r && (caliber < r.min || caliber > r.max)) show = false;
    }
    
    if (st.weightRange !== 'all' && ranges.weightRanges) {
      const idx = parseInt(st.weightRange, 10);
      const r = ranges.weightRanges[idx];
      if (r && (weight < r.min || weight > r.max)) show = false;
    }
    
    if (st.fireRateRange !== 'all' && ranges.fireRateRanges) {
      const idx = parseInt(st.fireRateRange, 10);
      const r = ranges.fireRateRanges[idx];
      if (r && (fireRate < r.min || fireRate > r.max)) show = false;
    }
    
    card.style.display = show ? '' : 'none';
  });
  
  // Сортировка
  if (st.sort !== 'none') {
    const grid = document.querySelector('.wpv-grid');
    if (grid) {
      const visible = cards.filter(c => c.style.display !== 'none');
      visible.sort((a, b) => {
        const [field, dir] = st.sort.split('-');
        const av = parseFloat(a.dataset[field]) || 0;
        const bv = parseFloat(b.dataset[field]) || 0;
        return dir === 'asc' ? av - bv : bv - av;
      });
      visible.forEach(el => grid.appendChild(el));
    }
  }
  
  // Обновляем счетчик
  const shown = cards.filter(c => c.style.display !== 'none').length;
  const cnt = document.getElementById('wpv-count');
  if (cnt) cnt.textContent = String(shown);
}


// ══════════════════════════════════════════════════════════════
// ARMOR PREVIEW FILTERS — фильтры для превью брони
// ══════════════════════════════════════════════════════════════
function apvToggleFilters(slug) {
  const panel = document.getElementById(`apv-filters-${slug}`);
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
}

function apvResetFilters(slug) {
  if (!_previewState[slug]) return;
  _previewState[slug] = {
    armorClass: 'all', laserRating: 'all', rarity: 'all',
    hpRange: 'all', penRange: 'all', weightRange: 'all', sort: 'none'
  };
  document.querySelectorAll('.wpv-filters-panel input[type="radio"]').forEach(inp => {
    inp.checked = inp.value === 'all' || inp.value === 'none';
  });
  document.querySelectorAll('.wpv-sort-btn').forEach(btn => btn.classList.remove('active'));
  apvUpdateFilterCount(slug);
  apvApplyFilters(slug);
}

function apvUpdateFilterCount(slug) {
  const st = _previewState[slug];
  if (!st) return;
  let count = 0;
  if (st.armorClass !== 'all') count++;
  if (st.laserRating !== 'all') count++;
  if (st.rarity !== 'all') count++;
  if (st.hpRange !== 'all') count++;
  if (st.penRange !== 'all') count++;
  if (st.weightRange !== 'all') count++;
  const badge = document.getElementById(`apv-filter-count-${slug}`);
  if (badge) {
    badge.textContent = count > 0 ? String(count) : '';
    badge.style.display = count > 0 ? '' : 'none';
  }
}

function apvSetClass(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].armorClass = val;
  apvUpdateFilterCount(slug);
  apvApplyFilters(slug);
}

function apvSetLaser(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].laserRating = val;
  apvUpdateFilterCount(slug);
  apvApplyFilters(slug);
}

function apvSetRarity(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].rarity = val;
  apvUpdateFilterCount(slug);
  apvApplyFilters(slug);
}

function apvSetHpRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].hpRange = val;
  apvUpdateFilterCount(slug);
  apvApplyFilters(slug);
}

function apvSetPenRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].penRange = val;
  apvUpdateFilterCount(slug);
  apvApplyFilters(slug);
}

function apvSetWeightRange(slug, val) {
  if (!_previewState[slug]) return;
  _previewState[slug].weightRange = val;
  apvUpdateFilterCount(slug);
  apvApplyFilters(slug);
}

function apvSetSort(slug, val) {
  if (!_previewState[slug]) return;
  const prevSort = _previewState[slug].sort;
  if (val.includes('-desc') && prevSort === val) {
    _previewState[slug].sort = val.replace('-desc', '-asc');
  } else if (val.includes('-asc') && prevSort === val) {
    _previewState[slug].sort = 'none';
  } else {
    _previewState[slug].sort = val;
  }
  document.querySelectorAll('.wpv-sort-btn').forEach(btn => btn.classList.remove('active'));
  if (_previewState[slug].sort !== 'none') {
    const activeBtn = document.querySelector(`.wpv-sort-btn[onclick*="'${_previewState[slug].sort.split('-')[0]}-"]`);
    activeBtn?.classList.add('active');
  }
  apvApplyFilters(slug);
}

function apvApplyFilters(slug) {
  const st = _previewState[slug];
  if (!st) return;
  
  const ranges = window._apvRanges?.[slug] || {};
  const cards = Array.from(document.querySelectorAll('.apv-card'));
  
  cards.forEach(card => {
    const armorClass = card.dataset.class || '';
    const laser = card.dataset.laser || '';
    const rarity = card.dataset.rarity || '';
    const hp = parseFloat(card.dataset.hp) || 0;
    const pen = parseFloat(card.dataset.pen) || 0;
    const weight = parseFloat(card.dataset.weight) || 0;
    
    let show = true;
    
    if (st.armorClass !== 'all' && armorClass !== st.armorClass) show = false;
    if (st.laserRating !== 'all' && laser !== st.laserRating) show = false;
    if (st.rarity !== 'all' && rarity !== st.rarity) show = false;
    
    if (st.hpRange !== 'all' && ranges.hpRanges) {
      const idx = parseInt(st.hpRange, 10);
      const r = ranges.hpRanges[idx];
      if (r && (hp < r.min || hp > r.max)) show = false;
    }
    
    if (st.penRange !== 'all' && ranges.penRanges) {
      const idx = parseInt(st.penRange, 10);
      const r = ranges.penRanges[idx];
      if (r && (pen < r.min || pen > r.max)) show = false;
    }
    
    if (st.weightRange !== 'all' && ranges.weightRanges) {
      const idx = parseInt(st.weightRange, 10);
      const r = ranges.weightRanges[idx];
      if (r && (weight < r.min || weight > r.max)) show = false;
    }
    
    card.style.display = show ? '' : 'none';
  });
  
  // Сортировка
  if (st.sort !== 'none') {
    const grid = document.querySelector('.apv-grid');
    if (grid) {
      const visible = cards.filter(c => c.style.display !== 'none');
      visible.sort((a, b) => {
        const [field, dir] = st.sort.split('-');
        const av = parseFloat(a.dataset[field]) || 0;
        const bv = parseFloat(b.dataset[field]) || 0;
        return dir === 'asc' ? av - bv : bv - av;
      });
      visible.forEach(el => grid.appendChild(el));
    }
  }
  
  const shown = cards.filter(c => c.style.display !== 'none').length;
  const cnt = document.getElementById('apv-count');
  if (cnt) cnt.textContent = String(shown);
}


// ════════════════════════════════════════════════════════════
// RELATED ARTICLES — Близкие по теме статьи
// ════════════════════════════════════════════════════════════
function renderRelatedArticles() {
  const relatedBlock = document.getElementById('related-articles-block');
  if (!relatedBlock) return;
  
  const currentPage = pages.find(p => p.slug === curSlug);
  
  // Очищаем блок если нет тегов или это главная
  if (!currentPage || !currentPage.tags || currentPage.tags.trim() === '' || curSlug === 'home') {
    relatedBlock.innerHTML = '';
    relatedBlock.style.display = 'none';
    return;
  }
  
  // Парсим теги текущей страницы
  const currentTags = currentPage.tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
  if (currentTags.length === 0) {
    relatedBlock.innerHTML = '';
    relatedBlock.style.display = 'none';
    return;
  }
  
  // Находим статьи с похожими тегами
  const relatedPages = pages
    .filter(p => p.slug !== curSlug && p.tags && p.status === 'published')
    .map(p => {
      const pageTags = p.tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
      const matchCount = pageTags.filter(t => currentTags.includes(t)).length;
      return { page: p, matchCount, hasImage: !!p.image_url };
    })
    .filter(item => item.matchCount > 0)
    .sort((a, b) => {
      // Сначала сортируем по количеству совпадений
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      // Потом приоритет картинкам
      if (b.hasImage !== a.hasImage) return b.hasImage ? 1 : -1;
      return 0;
    });
  
  if (relatedPages.length === 0) {
    relatedBlock.innerHTML = '';
    relatedBlock.style.display = 'none';
    return;
  }
  
  // Выбираем 2-3 случайные статьи из топ-10 (с приоритетом на картинки)
  const topCandidates = relatedPages.slice(0, Math.min(10, relatedPages.length));
  const withImages = topCandidates.filter(item => item.hasImage);
  const withoutImages = topCandidates.filter(item => !item.hasImage);
  
  // Берем 2-3 статьи: сначала перемешиваем с картинками, потом без
  const count = Math.min(3, Math.max(2, topCandidates.length));
  const shuffledWithImages = withImages.sort(() => Math.random() - 0.5);
  const shuffledWithoutImages = withoutImages.sort(() => Math.random() - 0.5);
  const selected = [...shuffledWithImages, ...shuffledWithoutImages].slice(0, count);
  
  // Создаем блок
  relatedBlock.style.display = 'block';
  relatedBlock.innerHTML = `
    <div class="related-divider"></div>
    <div class="related-header">${lang === 'ru' ? 'БЛИЗКИЕ ПО ТЕМЕ' : 'RELATED ARTICLES'}</div>
    <div class="related-list">
      ${selected.map(item => `
        <div class="related-item" onclick="go('${esc(item.page.slug)}')">
          ${item.hasImage ? `<div class="related-img"><img src="${esc(item.page.image_url)}" alt="${esc(pT(item.page))}" loading="lazy"></div>` : ''}
          <div class="related-content">
            <span class="related-icon">◆</span>
            <span class="related-title">${esc(pT(item.page))}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}


// ════════════════════════════════════════════════════════════
// REDACTED PASSWORD SYSTEM
// ════════════════════════════════════════════════════════════

let _redactedUnlocked = false;
const REDACTED_PASSWORD = 'newera';

function createRedactedModal() {
  const modal = document.createElement('div');
  modal.className = 'redacted-modal';
  modal.id = 'redacted-modal';
  modal.innerHTML = `
    <div class="redacted-modal-content">
      <div class="redacted-modal-icon">🔒</div>
      <div class="redacted-modal-title">Засекреченные данные</div>
      <div class="redacted-modal-desc">Доступ к конфиденциальной информации ограничен. Требуется авторизация.</div>
      <form onsubmit="event.preventDefault();checkRedactedPassword()">
      <input type="password" class="redacted-modal-input" id="redacted-password-input" placeholder="••••••••" autocomplete="off">
      <div class="redacted-modal-actions">
        <button type="button" class="redacted-modal-btn redacted-modal-btn-cancel" id="redacted-cancel">Отмена</button>
        <button type="submit" class="redacted-modal-btn redacted-modal-btn-submit" id="redacted-submit">Разблокировать</button>
      </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeRedactedModal();
  });
  
  // Cancel button
  document.getElementById('redacted-cancel').addEventListener('click', closeRedactedModal);
  
  // Submit button
  document.getElementById('redacted-submit').addEventListener('click', checkRedactedPassword);
  
  // Enter key
  document.getElementById('redacted-password-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkRedactedPassword();
  });
}

function showRedactedModal() {
  const modal = document.getElementById('redacted-modal');
  if (!modal) return;
  
  modal.classList.add('show');
  const input = document.getElementById('redacted-password-input');
  input.value = '';
  setTimeout(() => input.focus(), 100);
}

function closeRedactedModal() {
  const modal = document.getElementById('redacted-modal');
  if (modal) modal.classList.remove('show');
}

function checkRedactedPassword() {
  const input = document.getElementById('redacted-password-input');
  const password = input.value;
  
  if (!password) return;
  
  if (password.toLowerCase() === REDACTED_PASSWORD) {
    _redactedUnlocked = true;
    unlockAllRedacted();
    closeRedactedModal();
    toast('✓ Доступ разрешен', 'ok');
  } else {
    input.value = '';
    input.style.borderColor = '#cc4848';
    input.placeholder = 'Неверный пароль';
    setTimeout(() => {
      input.style.borderColor = '';
      input.placeholder = '••••••••';
    }, 1500);
    toast('✗ Неверный пароль', 'err');
  }
}

function initRedactedSystem() {
  createRedactedModal();
  
  document.addEventListener('click', (e) => {
    const redacted = e.target.closest('.bg-redacted');
    if (!redacted) return;
    
    if (_redactedUnlocked || redacted.classList.contains('unlocked')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    showRedactedModal();
  });
}

function unlockAllRedacted() {
  document.querySelectorAll('.bg-redacted').forEach(el => {
    el.classList.add('unlocked');
  });
}

// Инициализация при загрузке страницы
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRedactedSystem);
  } else {
    initRedactedSystem();
  }
}
