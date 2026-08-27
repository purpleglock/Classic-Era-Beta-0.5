// © 2025–2026. Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════════
//  АДМИНКА: СТИКЕРЫ ЧАТА — РАСКЛАДКА МЫШЬЮ
//
//  Задача редактора: положить на картинку ДВЕ вещи — подпись и окно, куда при
//  отправке встанет флаг державы игрока. Обе кладутся руками, потому что на
//  каждом рисунке своё «свободное место»: у одного оно под подбородком, у
//  другого — на нагрудной пластине, и никакая автораскладка этого не угадает.
//
//  ⚠️ РЕДАКТОР НЕ РИСУЕТ СТИКЕР САМ. Картинку собирает stHtml() из
//  chat_sticker.js — тот же код, что в ленте и палитре. Редактор только кладёт
//  поверх две прозрачные ручки. Если рисовать здесь свою версию, раскладка
//  разойдётся с игровой, и админ будет двигать подпись «на глаз мимо».
//
//  ⚠️ ВСЁ СЧИТАЕТСЯ В ДОЛЯХ ХОЛСТА. Тянем мышью → делим на размер холста →
//  храним 0..1. Поэтому холст можно менять как угодно, а раскладка не поедет.
//
//  ⚠️ КВАДРАТ ПОД ФЛАГ ПО УМОЛЧАНИЮ ДЕРЖИТ КВАДРАТ. Гербы у держав квадратные;
//  растянутое окно даёт обрезанный или сплюснутый флаг. Пропорцию можно
//  разорвать (Shift при тяге за угол) — иногда рамка на рисунке прямоугольная.
//
//  Файлы: assets/stickers/<key>.<ext>. Заливка — батником tools/stickers.bat
//  или прямо здесь (нужен запущенный «Загрузка артов.bat»).
//  Зависит от: admin.js (AD, AD_PORT_SERVER, adPortServerAlive, adPaint,
//  compressImageFile), core.js (dbGet/dbPost/dbPatch/dbDel, esc, toast),
//  chat_sticker.js (stHtml, stCfg, ST_FONTS, ST_TEXT_MODES).
// ════════════════════════════════════════════════════════════════════════

const AST = {
  list: [],        // стикеры из базы
  sel: '',         // ключ открытого
  loaded: false,
  busy: false,
  drag: null,      // {what:'text'|'flag', mode:'move'|'size', ...}
  dirty: false,
  side: 360,       // сторона холста редактора, px
  demo: 'НУ ТЫ ДАЁШЬ',   // подпись для примера
  files: [],       // что реально лежит в assets/stickers (из index.json)
  scanned: false,
};
const AST_FLAG_DEMO = 'assets/icons/flag-demo.svg';

function astSel() { return AST.list.find(x => x.key === AST.sel) || null; }
function astCfg() { const s = astSel(); return s ? stCfg(s.cfg) : stCfg(null); }

// ── Что лежит в папке ──────────────────────────────────────────
// Браузер не читает каталог с диска, поэтому список файлов пишет батник
// (tools/stickers.bat → assets/stickers/index.json). Без него админ вбивал бы
// каждый ключ руками — ровно та лишняя работа, ради которой батник и заведён.
async function astScan() {
  try {
    const r = await fetch(`${ST_DIR}/index.json?t=${Date.now()}`, { cache: 'no-store' });
    AST.files = r.ok ? (await r.json()) : [];
  } catch (e) { AST.files = []; }
  AST.scanned = true;
}
function astNewFiles() {
  const have = new Set(AST.list.map(x => x.key));
  return (AST.files || []).filter(f => f && f.key && !have.has(f.key));
}
// Заводим пачкой: по одному вставлять десять стикеров — та же ручная работа,
// только медленнее.
async function astAddAll() {
  const add = astNewFiles();
  if (!add.length) return;
  try {
    const rows = await dbPost('chat_stickers', add.map(f => ({
      key: f.key, name: f.key, pack: 'Общие', ext: f.ext || 'webp', cfg: stCfg(null),
    })));
    AST.list = AST.list.concat(Array.isArray(rows) ? rows : []);
    AST.list.sort((a, b) => (a.ord - b.ord) || a.key.localeCompare(b.key));
    if (!AST.sel && AST.list.length) AST.sel = AST.list[0].key;
    else AST.sel = add[0].key;
    toast(`Заведено стикеров: ${add.length}. Осталось разложить подпись и флаг`, 'ok');
    adPaint();
  } catch (e) { toast(e.message || 'не вышло', 'err'); }
}

async function astLoad(force) {
  if (AST.loaded && !force) return;
  try {
    await astScan();
    const rows = await dbGet('chat_stickers', 'select=key,name,pack,ext,ord,enabled,cfg&order=ord.asc,key.asc');
    AST.list = Array.isArray(rows) ? rows : [];
    AST.loaded = true;
    if (!AST.sel && AST.list.length) AST.sel = AST.list[0].key;
    adPaint();
  } catch (e) { toast('Стикеры не загрузились: ' + (e.message || e), 'err'); }
}

// ── Панель ─────────────────────────────────────────────────────
function adStickersPanel() {
  if (!AST.loaded) { astLoad(); return `<div class="sload" style="min-height:120px"><div class="pulse-loader"></div></div>`; }
  const s = astSel();
  const fresh = astNewFiles();
  // Плашка ставится ПЕРВОЙ и только когда есть что заводить: постоянная
  // «инструкция сверху» перестаёт читаться через день.
  const banner = fresh.length ? `<div style="margin-bottom:14px;padding:10px 14px;background:color-mix(in srgb, var(--te,#3ec0d0) 12%, transparent);border-left:2px solid var(--te,#3ec0d0);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:12.5px;color:var(--t2,#b6c4d0)">В папке новых картинок: <b style="color:var(--te,#3ec0d0)">${fresh.length}</b> — ${fresh.slice(0, 6).map(f => esc(f.key)).join(', ')}${fresh.length > 6 ? '…' : ''}</span>
      <button class="btn btn-gd btn-sm" onclick="astAddAll()">Завести все новые</button>
      <button class="btn btn-gh btn-sm" onclick="astRescan()">↺ Перечитать папку</button>
    </div>` : '';
  const rail = AST.list.length
    ? AST.list.map(x => `<button class="btn ${x.key === AST.sel ? 'btn-gd' : 'btn-gh'} btn-sm" style="width:100%;justify-content:flex-start;text-align:left;margin-bottom:4px;${x.enabled ? '' : 'opacity:.5'}"
        onclick="astPick('${esc(x.key)}')">${esc(x.name || x.key)}<span style="opacity:.55;font-size:10px;margin-left:6px">${esc(x.pack || '')}</span></button>`).join('')
    : `<div style="font-size:11px;color:var(--t4,#6a7a88);line-height:1.6">Пусто. Залей картинку батником <b>tools\\stickers.bat</b> и заведи её здесь по ключу (= имя файла без расширения).</div>`;

  return banner + `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
    <div style="width:250px;flex-shrink:0">
      <div style="font-family:var(--font-display,sans-serif);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--t3,#8aa0b0);margin-bottom:8px">Стикеры · ${AST.list.length}</div>
      <div style="max-height:420px;overflow-y:auto;padding-right:4px">${rail}</div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--w2,#2a3340)">
        <div style="font-size:10px;color:var(--t4,#6a7a88);margin-bottom:6px">Обычный путь — батник <b>tools\stickers.bat</b>: перетащил картинки, тут появится «завести все новые». Ниже — ручной запасной ход.</div>
        <input id="ast-new-key" placeholder="kot-ugar" style="width:100%;margin-bottom:6px;padding:6px 8px;background:var(--b1,#0d1117);border:1px solid var(--w3,#2a3340);color:var(--t1,#e8edf2);font-size:12px">
        <button class="btn btn-gh btn-sm" style="width:100%" onclick="astCreate()">+ Завести</button>
        <input type="file" accept="image/*" id="ast-file" style="display:none" onchange="astUpload(this)">
        <button class="btn btn-gh btn-sm" style="width:100%;margin-top:6px" onclick="astUploadPick()">⇪ Загрузить картинку</button>
        <div id="ast-up-st" style="font-size:9px;color:var(--t4,#6a7a88);margin-top:4px;min-height:12px"></div>
      </div>
    </div>
    ${s ? astEditor(s) : '<div style="color:var(--t4,#6a7a88);font-size:12px">Выбери стикер слева.</div>'}
  </div>`;
}

function astEditor(s) {
  const c = stCfg(s.cfg), t = c.text, f = c.flag;
  const side = AST.side;
  // Холст: сам стикер (общей отрисовкой) + прозрачные ручки поверх.
  const canvas = `<div id="ast-canvas" class="ast-canvas" style="width:${side}px;height:${side}px"
      onmousedown="astDown(event)">
    ${stHtml(s, { text: AST.demo, name: 'Setis241', flag: AST_FLAG_DEMO, size: side, box: true })}
    ${t.on ? `<div class="ast-h ast-h-text" data-what="text" style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%;width:${(t.w * 100).toFixed(2)}%;height:${(t.size * 1.35 * 100).toFixed(2)}%">
        <span class="ast-h-lbl">подпись</span><i class="ast-grip ast-grip-e" data-grip="w"></i></div>` : ''}
    ${f.on ? `<div class="ast-h ast-h-flag" data-what="flag" style="left:${(f.x * 100).toFixed(2)}%;top:${(f.y * 100).toFixed(2)}%;width:${(f.w * 100).toFixed(2)}%;height:${(f.h * 100).toFixed(2)}%">
        <span class="ast-h-lbl">флаг</span><i class="ast-grip ast-grip-se" data-grip="wh"></i></div>` : ''}
  </div>`;

  const num = (lbl, key, val, min, max, step) => `<label class="ast-f"><span>${lbl}</span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" oninput="astSet('${key}', this.value, true)">
    <b>${(+val).toFixed(step < 1 ? 2 : 0)}</b></label>`;

  return `<div style="flex:1;min-width:320px;display:flex;gap:18px;flex-wrap:wrap">
    <div>
      ${canvas}
      <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
        <input id="ast-demo" value="${esc(AST.demo)}" placeholder="подпись для примера" oninput="AST.demo=this.value;astRepaint()"
          style="flex:1;padding:6px 8px;background:var(--b1,#0d1117);border:1px solid var(--w3,#2a3340);color:var(--t1,#e8edf2);font-size:12px">
        <span style="font-size:10px;color:var(--t4,#6a7a88)">пример</span>
      </div>
      <div style="font-size:10px;color:var(--t4,#6a7a88);margin-top:6px;line-height:1.6">
        Рамки таскай мышью, размер — за уголок. Флаг держит квадрат; Shift при тяге — свободно.
      </div>
    </div>

    <div style="flex:1;min-width:280px;max-width:420px">
      <div class="ast-row">
        <input value="${esc(s.name || '')}" placeholder="Название" onchange="astMeta('name', this.value)" class="ast-in">
        <input value="${esc(s.pack || 'Общие')}" placeholder="Раздел" onchange="astMeta('pack', this.value)" class="ast-in" style="max-width:120px">
      </div>
      <div class="ast-row">
        <label class="ast-chk"><input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="astMeta('enabled', this.checked)"> в палитре</label>
        <label class="ast-chk">порядок <input type="number" value="${s.ord ?? 100}" onchange="astMeta('ord', +this.value)" style="width:64px" class="ast-in"></label>
        <label class="ast-chk">файл <input value="${esc(s.ext || 'webp')}" onchange="astMeta('ext', this.value)" style="width:60px" class="ast-in"></label>
      </div>

      <div class="ast-sect">Подпись</div>
      <div class="ast-row">
        <label class="ast-chk"><input type="checkbox" ${t.on ? 'checked' : ''} onchange="astSet('text.on', this.checked)"> показывать</label>
        <select onchange="astSet('text.mode', this.value)" class="ast-in">
          ${Object.entries(ST_TEXT_MODES).map(([k, v]) => `<option value="${k}"${t.mode === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      ${t.mode === 'fixed' ? `<div class="ast-row"><input class="ast-in" value="${esc(t.fixed || '')}" placeholder="текст стикера" onchange="astSet('text.fixed', this.value)"></div>` : ''}
      <div class="ast-row">
        <select onchange="astSet('text.font', this.value)" class="ast-in">
          ${Object.entries(ST_FONTS).map(([k, v]) => `<option value="${k}"${t.font === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
        </select>
        <select onchange="astSet('text.align', this.value)" class="ast-in" style="max-width:120px">
          ${[['left', 'по левому'], ['center', 'по центру'], ['right', 'по правому']].map(([k, v]) => `<option value="${k}"${t.align === k ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      ${num('кегль', 'text.size', t.size, 0.04, 0.4, 0.005)}
      ${num('поворот', 'text.rot', t.rot, -25, 25, 1)}
      <div class="ast-row">
        <label class="ast-chk">цвет <input type="color" value="${esc(t.color || '#ffffff')}" onchange="astSet('text.color', this.value)"></label>
        <label class="ast-chk">контур <input type="color" value="${esc(t.stroke || '#000000')}" onchange="astSet('text.stroke', this.value)"></label>
        <label class="ast-chk"><input type="checkbox" ${t.caps ? 'checked' : ''} onchange="astSet('text.caps', this.checked)"> ПРОПИСНЫЕ</label>
      </div>

      <div class="ast-sect">Окно под флаг державы</div>
      <div class="ast-row">
        <label class="ast-chk"><input type="checkbox" ${f.on ? 'checked' : ''} onchange="astSet('flag.on', this.checked)"> показывать</label>
        <select onchange="astSet('flag.fit', this.value)" class="ast-in" style="max-width:150px">
          <option value="cover"${f.fit === 'cover' ? ' selected' : ''}>заполнить (обрежет)</option>
          <option value="contain"${f.fit === 'contain' ? ' selected' : ''}>вписать целиком</option>
        </select>
        <button class="btn btn-gh btn-sm" onclick="astSquare()">сделать квадратным</button>
      </div>
      ${num('поворот флага', 'flag.rot', f.rot, -25, 25, 1)}

      <div class="ast-row" style="margin-top:14px;gap:8px">
        <button class="btn ${AST.dirty ? 'btn-gd' : 'btn-gh'} btn-sm" onclick="astSave()">${AST.dirty ? '💾 Сохранить' : 'Сохранено'}</button>
        <button class="btn btn-gh btn-sm" onclick="astReset()">Сбросить раскладку</button>
        <button class="btn btn-gh btn-sm" style="margin-left:auto;color:#ff7a7a" onclick="astDelete()">Удалить</button>
      </div>
    </div>
  </div>`;
}

// ── Правка ─────────────────────────────────────────────────────
function astPick(key) { AST.sel = key; adPaint(); }
async function astRescan() { await astScan(); adPaint(); }
function astRepaint() {
  // Перерисовываем ТОЛЬКО холст: полная перерисовка вкладки роняет фокус из
  // полей и рвёт тягу мышью на середине жеста.
  const box = document.getElementById('ast-canvas');
  const s = astSel(); if (!box || !s) return;
  const c = stCfg(s.cfg), t = c.text, f = c.flag;
  box.innerHTML = stHtml(s, { text: AST.demo, name: 'Setis241', flag: AST_FLAG_DEMO, size: AST.side, box: true })
    + (t.on ? `<div class="ast-h ast-h-text" data-what="text" style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%;width:${(t.w * 100).toFixed(2)}%;height:${(t.size * 1.35 * 100).toFixed(2)}%"><span class="ast-h-lbl">подпись</span><i class="ast-grip ast-grip-e" data-grip="w"></i></div>` : '')
    + (f.on ? `<div class="ast-h ast-h-flag" data-what="flag" style="left:${(f.x * 100).toFixed(2)}%;top:${(f.y * 100).toFixed(2)}%;width:${(f.w * 100).toFixed(2)}%;height:${(f.h * 100).toFixed(2)}%"><span class="ast-h-lbl">флаг</span><i class="ast-grip ast-grip-se" data-grip="wh"></i></div>` : '');
}
// Кнопку «Сохранить» подсвечивает следующая полная перерисовка; во время тяги
// мышью её не трогаем — иначе каждое движение дёргало бы всю панель.
function astMark() { AST.dirty = true; }
function astSet(path, val, live) {
  const s = astSel(); if (!s) return;
  const c = stCfg(s.cfg);
  const [grp, key] = path.split('.');
  let v = val;
  if (typeof v === 'string' && !isNaN(parseFloat(v)) && ['size', 'rot', 'x', 'y', 'w', 'h'].includes(key)) v = parseFloat(v);
  c[grp][key] = v;
  s.cfg = c;
  astMark();
  if (live) { astRepaint(); const el = event && event.target && event.target.parentElement?.querySelector('b'); if (el) el.textContent = (+v).toFixed(Math.abs(v) < 1 ? 2 : 0); }
  else adPaint();
}
function astMeta(key, val) {
  const s = astSel(); if (!s) return;
  s[key] = val; astMark();
  if (key === 'ext') astRepaint(); else adPaint();
}
function astSquare() {
  const s = astSel(); if (!s) return;
  const c = stCfg(s.cfg);
  c.flag.h = c.flag.w;              // холст квадратный, поэтому доли равны
  s.cfg = c; astMark(); astRepaint();
}
function astReset() {
  const s = astSel(); if (!s) return;
  s.cfg = stCfg(null); astMark(); adPaint();
}

// ── Тяга мышью ─────────────────────────────────────────────────
// Один обработчик на холст: цель определяем по data-what, а «за уголок или за
// тело» — по data-grip. Слушатели движения вешаем на ДОКУМЕНТ, иначе быстрый
// жест уводит курсор за пределы холста и рамка застывает на полпути.
function astDown(e) {
  const grip = e.target.closest('.ast-grip');
  const h = e.target.closest('.ast-h');
  if (!h) return;
  e.preventDefault();
  const s = astSel(); if (!s) return;
  const c = stCfg(s.cfg);
  const what = h.dataset.what;
  const box = document.getElementById('ast-canvas').getBoundingClientRect();
  AST.drag = {
    what, mode: grip ? 'size' : 'move', grip: grip ? grip.dataset.grip : '',
    box, startX: e.clientX, startY: e.clientY,
    o: { ...(what === 'text' ? c.text : c.flag) },
  };
  document.addEventListener('mousemove', astMove);
  document.addEventListener('mouseup', astUp);
}
function astMove(e) {
  const d = AST.drag; if (!d) return;
  const s = astSel(); if (!s) return;
  const c = stCfg(s.cfg);
  const dx = (e.clientX - d.startX) / d.box.width;
  const dy = (e.clientY - d.startY) / d.box.height;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const g = d.what === 'text' ? c.text : c.flag;
  if (d.mode === 'move') {
    g.x = +clamp(d.o.x + dx, -0.15, 1).toFixed(4);
    g.y = +clamp(d.o.y + dy, -0.15, 1).toFixed(4);
  } else if (d.what === 'text') {
    g.w = +clamp(d.o.w + dx, 0.08, 1.2).toFixed(4);
  } else {
    const w = clamp(d.o.w + dx, 0.05, 1.2);
    g.w = +w.toFixed(4);
    // Квадрат держим по умолчанию: гербы квадратные, растянутое окно даёт
    // сплюснутый флаг. Shift — разорвать пропорцию.
    g.h = +(e.shiftKey ? clamp(d.o.h + dy, 0.05, 1.2) : w).toFixed(4);
  }
  s.cfg = c; AST.dirty = true;
  astRepaint();
}
function astUp() {
  AST.drag = null;
  document.removeEventListener('mousemove', astMove);
  document.removeEventListener('mouseup', astUp);
  adPaint();
}

// ── Сервер ─────────────────────────────────────────────────────
async function astCreate() {
  const el = document.getElementById('ast-new-key');
  const key = String(el && el.value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(key)) { toast('Ключ: латиница, цифры, дефис (2–40)', 'err'); return; }
  if (AST.list.some(x => x.key === key)) { toast('Такой ключ уже есть', 'err'); return; }
  try {
    const rows = await dbPost('chat_stickers', { key, name: key, pack: 'Общие', ext: 'webp', cfg: stCfg(null) });
    AST.list.push(Array.isArray(rows) ? rows[0] : { key, name: key, pack: 'Общие', ext: 'webp', enabled: true, ord: 100, cfg: stCfg(null) });
    AST.sel = key; AST.dirty = false;
    toast('Стикер заведён — теперь разложи подпись и флаг', 'ok');
    adPaint();
  } catch (e) { toast(e.message || 'не вышло', 'err'); }
}
// Заливка из админки — второй путь (когда батник не под рукой). Ключ берём из
// имени файла, запись заводим сами: «сначала заведи, потом залей» — лишний шаг.
function astUploadPick() { document.getElementById('ast-file')?.click(); }
async function astUpload(inputEl) {
  const f = inputEl && inputEl.files && inputEl.files[0];
  const st = document.getElementById('ast-up-st');
  if (!f) return;
  let s = astSel();
  const auto = String(f.name || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s || s.key !== auto) {
    const exist = AST.list.find(x => x.key === auto);
    if (exist) { AST.sel = auto; s = exist; }
    else if (/^[a-z0-9][a-z0-9_-]{1,39}$/.test(auto)) {
      try {
        const rows = await dbPost('chat_stickers', { key: auto, name: auto, pack: 'Общие', ext: 'webp', cfg: stCfg(null) });
        s = Array.isArray(rows) ? rows[0] : { key: auto, name: auto, pack: 'Общие', ext: 'webp', enabled: true, ord: 100, cfg: stCfg(null) };
        AST.list.push(s); AST.sel = auto;
      } catch (e) { toast(e.message || 'не завёлся', 'err'); return; }
    } else { toast('Имя файла не годится в ключ: латиница, цифры, дефис', 'err'); return; }
  }
  if (st) st.textContent = 'Проверка сервера…';
  if (!(await adPortServerAlive())) {
    if (st) st.textContent = 'нет сервера';
    toast('Запусти «Загрузка артов.bat» — или залей батником tools\\stickers.bat', 'err');
    return;
  }
  try {
    if (st) st.textContent = 'Сохранение…';
    // Стикер смотрят максимум в 210 px, но жмём до 640: хватит и для ретины.
    const cf = (typeof compressImageFile === 'function') ? await compressImageFile(f, 640, 0.92) : f;
    const r = await fetch(`${AD_PORT_SERVER}/upload?dir=stickers&name=${encodeURIComponent(s.key + '.webp')}`, {
      method: 'POST', headers: { 'Content-Type': cf.type || 'image/webp' }, body: cf,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('сервер: HTTP ' + r.status));
    if (s.ext !== 'webp') { s.ext = 'webp'; await astSave(true); }
    if (st) st.textContent = 'Готово';
    toast('Картинка сохранена', 'ok');
    adPaint();
  } catch (e) {
    if (st) st.textContent = 'Ошибка';
    toast('Не удалось сохранить: ' + (e.message || e), 'err');
  }
}
async function astSave(quiet) {
  const s = astSel(); if (!s || AST.busy) return;
  AST.busy = true;
  try {
    await dbPatch('chat_stickers', `key=eq.${encodeURIComponent(s.key)}`, {
      name: s.name || s.key, pack: s.pack || 'Общие', ext: s.ext || 'webp',
      ord: s.ord ?? 100, enabled: s.enabled !== false, cfg: stCfg(s.cfg),
    });
    AST.dirty = false;
    if (!quiet) { toast('Раскладка сохранена', 'ok'); adPaint(); }
  } catch (e) { toast(e.message || 'не сохранилось', 'err'); }
  finally { AST.busy = false; }
}
async function astDelete() {
  const s = astSel(); if (!s) return;
  if (!confirm(`Убрать стикер «${s.name || s.key}» из палитры? Файл на диске останется.`)) return;
  try {
    await dbDel('chat_stickers', `key=eq.${encodeURIComponent(s.key)}`);
    AST.list = AST.list.filter(x => x.key !== s.key);
    AST.sel = AST.list[0]?.key || '';
    toast('Стикер убран', 'ok');
    adPaint();
  } catch (e) { toast(e.message || 'не вышло', 'err'); }
}
