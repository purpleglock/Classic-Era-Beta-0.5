// ════════════════════════════════════════════════════════════════════════
//  ПОДСКАЗКИ → ВЫДЕРЖКА ИЗ ПРАВИЛ
//
//  Правило проекта: правила живут в гайдбуке, а не расползаются абзацами по
//  интерфейсу. В кабинете же под каждой карточкой висело по абзацу-пояснению
//  («Системы — захватываются на карте…», «Добывают workers…»): экран читался
//  как учебник, а не как пульт.
//
//  Что делает модуль: находит такие абзацы, УБИРАЕТ их из потока и вешает на
//  заголовок карточки один компактный значок. Клик — панель «Из правил» с
//  этим текстом и ссылкой в гайдбук. Ничего не пропадает: текст на месте, но
//  по требованию.
//
//  Чего НЕ трогает:
//   • короткие строки (до 100 знаков) — это данные, а не правила:
//     «🔵 гражданские 40% · 🔴 военные 30%» обязано остаться на экране;
//   • блоки с кнопками, полями и ссылками — там живёт управление;
//   • речь игроков (data-mt) — вотчина mt.js.
// ════════════════════════════════════════════════════════════════════════

// Классы пояснений — собраны по кабинету (economy.js) и соседям.
const HINT_SEL = [
  '.ec-hint', '.ec-ovx-hint', '.ec-mine-hint', '.ec-pl-hint', '.ec-stars-hint',
  '.ec-war-hint', '.ec-lg-d-hint', '.ec-tins-hint', '.ec-pth-step-hint',
  '.ec-pth-spot-hint', '.ec-bk-note', '.ec-door-note', '.ec-gal-note',
  '.ec-race-note', '.ec-meter-note', '.ec-trade-note', '.ec-loan-note',
  '.ec-shrine-note', '.ec-rinfo-note', '.ec-bdg-extra-note',
  '.ec-pth-promo-note', '.ec-pth-filter-note', '.ec-intro-hints',
].join(',');

// Заголовок карточки, к которому цепляем значок.
const HINT_HEAD = '.ec-section-title,.ec-sub-title,.ec-cap,.ec-bp-hd,.ec-ih-head,'
                + '.ec-bless-hd,.ec-shrine-title,h2,h3';

const HINT_MIN = 100;      // короче — это данные, а не правило
const HINT_KEY = 'data-hint-done';

const HINTS = { open: null, seen: new WeakSet() };

function hintRu() { return (typeof lang === 'undefined' || lang !== 'en'); }

// Пояснение ли это. Кнопки, поля и ссылки означают, что блок несёт
// управление, а не текст правила — такой не трогаем.
function hintIsRule(el) {
  if (el.hasAttribute(HINT_KEY)) return false;
  if (el.closest('[data-mt],[data-mt-skip]')) return false;
  if (el.querySelector('button,input,select,textarea,a,canvas,svg')) return false;
  return (el.textContent || '').trim().length >= HINT_MIN;
}

// ── Панель «Из правил» ────────────────────────────────────────────────
function hintClose() {
  HINTS.open?.remove();
  HINTS.open = null;
  document.removeEventListener('keydown', hintEsc);
}
function hintEsc(e) { if (e.key === 'Escape') hintClose(); }

function hintShow(btn, html) {
  hintClose();
  const ru = hintRu();
  const box = document.createElement('div');
  box.className = 'hint-pop';
  box.innerHTML = `
    <div class="hint-pop-hd">
      <span class="hint-pop-tag">${ru ? 'ИЗ ПРАВИЛ' : 'FROM THE RULES'}</span>
      <button type="button" class="hint-pop-x" aria-label="${ru ? 'Закрыть' : 'Close'}">✕</button>
    </div>
    <div class="hint-pop-body">${html}</div>
    <button type="button" class="hint-pop-go">${ru ? 'Открыть гайдбук →' : 'Open the guidebook →'}</button>`;
  document.body.appendChild(box);

  // Ставим под значком, но не даём вылезти за экран.
  const r = btn.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 24);
  box.style.width = w + 'px';
  let left = Math.min(r.left, window.innerWidth - w - 12);
  box.style.left = Math.max(12, left) + 'px';
  box.style.top = (r.bottom + window.scrollY + 8) + 'px';

  box.querySelector('.hint-pop-x').onclick = hintClose;
  box.querySelector('.hint-pop-go').onclick = () => {
    hintClose();
    if (typeof go === 'function') go('guide');
  };
  HINTS.open = box;
  document.addEventListener('keydown', hintEsc);
}

// ── Значок ────────────────────────────────────────────────────────────
// Один на карточку: если под ней лежало три абзаца, в панель уедут все три,
// а на экране будет один значок, а не частокол.
function hintButton(host, texts) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hint-btn';
  b.setAttribute('aria-label', hintRu() ? 'Как это работает' : 'How it works');
  b.title = hintRu() ? 'Как это работает — выдержка из правил'
                     : 'How it works — an excerpt from the rules';
  b.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
              + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
              + '<path d="M9.2 9a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.1 1-1.1 1.9"/>'
              + '<path d="M12 17.2h.01"/></svg>';
  b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (HINTS.open && HINTS.open._for === b) { hintClose(); return; }
    hintShow(b, texts.map(t => `<p>${t}</p>`).join(''));
    if (HINTS.open) HINTS.open._for = b;
  };
  host.appendChild(b);
  return b;
}

// ── Проход по готовому DOM ────────────────────────────────────────────
function hintSweep(root) {
  const scope = (root && root.nodeType === 1) ? root : document.body;
  let list = [];
  try { list = [...scope.querySelectorAll(HINT_SEL)]; } catch (e) { return; }
  if (scope.matches?.(HINT_SEL)) list.push(scope);
  if (!list.length) return;

  // Группируем по карточке: значок должен быть один на блок.
  const byHost = new Map();
  for (const el of list) {
    if (!hintIsRule(el)) { el.setAttribute(HINT_KEY, 'keep'); continue; }
    el.setAttribute(HINT_KEY, '1');
    const card = el.closest('section,.ec-card,.ec-block,.ec-panel,.ec-box') || el.parentElement;
    const head = card?.querySelector(HINT_HEAD) || null;
    const key = head || card || el;
    if (!byHost.has(key)) byHost.set(key, { head, texts: [], nodes: [] });
    const g = byHost.get(key);
    g.texts.push(el.innerHTML);
    g.nodes.push(el);
  }

  for (const [key, g] of byHost) {
    if (!g.texts.length) continue;
    // Значок — в заголовок карточки; заголовка нет — на место первого абзаца.
    const host = g.head || g.nodes[0].parentElement;
    if (!host) continue;
    if (host.querySelector(':scope > .hint-btn')) {
      g.nodes.forEach(n => n.remove());
      continue;
    }
    hintButton(host, g.texts);
    g.nodes.forEach(n => n.remove());   // из потока текст уходит целиком
  }
}

// Панели кабинета рисуются по кликам — слушаем DOM, как и словарь.
function hintWatch() {
  if (!('MutationObserver' in window)) return;
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && !n.classList?.contains('hint-pop')) hintSweep(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  hintSweep(document.body);
}

document.addEventListener('DOMContentLoaded', hintWatch);
document.addEventListener('click', (e) => {
  if (HINTS.open && !e.target.closest('.hint-pop,.hint-btn')) hintClose();
});
