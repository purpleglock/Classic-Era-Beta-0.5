// ─────────────────────────────────────────────────────────────────────────────
// РАЗОВЫЙ ОПТИМИЗАТОР УЖЕ ЗАЛИТЫХ КАРТИНОК В SUPABASE STORAGE
//
// ЗАЧЕМ: старые картинки лежат несжатыми (3-4 МБ) и с коротким кэшем
// (max-age=3600 → браузер перекачивает их каждый час). Это главный источник
// egress. Этот скрипт проходит по бакету, пережимает каждую картинку
// (ресайз + webp) и перезаливает ПО ТОМУ ЖЕ ПУТИ с годовым immutable-кэшем.
// URL не меняются → ничего в БД править не нужно.
//
// КАК ЗАПУСТИТЬ:
//   1. Открой свой сайт в браузере и залогинься как админ/редактор.
//   2. Открой консоль (F12 → Console).
//   3. Скопируй ВЕСЬ этот файл и вставь в консоль, нажми Enter.
//   4. Сначала прогон вхолостую (ничего не меняет, только считает):
//        await optimizeStorageImages({ dryRun: true })
//   5. Если цифры экономии нравятся — запусти по-настоящему:
//        await optimizeStorageImages({ dryRun: false })
//
//   Можно указать бакет и качество:
//        await optimizeStorageImages({ dryRun: false, bucket: 'wiki-images', maxDim: 1920, quality: 0.82 })
//
// БЕЗОПАСНОСТЬ: перезаписывает только если сжатая версия МЕНЬШЕ оригинала.
// GIF не трогает (потерялась бы анимация). Любой сбой по картинке — пропуск.
// ─────────────────────────────────────────────────────────────────────────────
async function optimizeStorageImages(opts = {}) {
  const {
    dryRun  = true,
    bucket  = 'wiki-images',
    maxDim  = 1920,
    quality = 0.82,
    pause   = 150,            // пауза между картинками, мс (не душим сервер)
  } = opts;

  // Берём глобалы с твоего сайта
  const URL_  = (typeof SB_URL  !== 'undefined') ? SB_URL  : window.SB_URL;
  const ANON_ = (typeof SB_ANON !== 'undefined') ? SB_ANON : window.SB_ANON;
  const token = (typeof getToken === 'function') ? getToken() : null;
  if (!URL_ || !ANON_) { console.error('Не нашёл SB_URL/SB_ANON — запускай на странице сайта.'); return; }
  if (!token)          { console.error('Нет токена — залогинься как админ.'); return; }

  const auth = { 'apikey': ANON_, 'Authorization': 'Bearer ' + token };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isImg = n => /\.(png|jpe?g|webp)$/i.test(n);   // gif НЕ берём

  // ── 1. Получаем список всех объектов (с пагинацией) ──
  const files = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`${URL_}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) { console.error('list error', r.status, await r.text()); return; }
    const batch = await r.json();
    if (!batch.length) break;
    files.push(...batch.filter(f => f.name && isImg(f.name)));
    if (batch.length < 100) break;
  }
  console.log(`Бакет «${bucket}»: ${files.length} картинок к проверке. dryRun=${dryRun}`);

  // ── 2. Компрессор (тот же приём, что в editor.js) ──
  async function compress(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    return await new Promise(res => c.toBlob(res, 'image/webp', quality));
  }

  // ── 3. Проход ──
  let before = 0, after = 0, changed = 0, skipped = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = f.name;
    try {
      const src = await fetch(`${URL_}/storage/v1/object/public/${bucket}/${encodeURI(path)}`, { cache: 'no-store' });
      if (!src.ok) { failed++; continue; }
      const orig = await src.blob();
      const small = await compress(orig);
      before += orig.size;

      if (!small || small.size >= orig.size) {
        after += orig.size; skipped++;
        console.log(`· ${i + 1}/${files.length} ${path} — без выигрыша (${(orig.size/1024|0)} КБ), пропуск`);
      } else {
        after += small.size; changed++;
        const saved = ((1 - small.size / orig.size) * 100).toFixed(0);
        console.log(`✓ ${i + 1}/${files.length} ${path} — ${(orig.size/1024|0)} → ${(small.size/1024|0)} КБ (−${saved}%)${dryRun ? '  [dryRun]' : ''}`);
        if (!dryRun) {
          const up = await fetch(`${URL_}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'image/webp', 'cache-control': 'max-age=31536000, immutable', 'x-upsert': 'true' },
            body: small,
          });
          if (!up.ok) { failed++; console.warn('  upload fail', up.status, await up.text()); }
        }
      }
    } catch (e) { failed++; console.warn(`✗ ${path}:`, e.message); }
    if (pause) await sleep(pause);
  }

  console.log('─── ИТОГО ───');
  console.log(`Сжато: ${changed} | без выигрыша: ${skipped} | ошибок: ${failed}`);
  console.log(`Объём: ${(before/1048576).toFixed(1)} МБ → ${(after/1048576).toFixed(1)} МБ (−${((1-after/before)*100||0).toFixed(0)}%)`);
  if (dryRun) console.log('Это был холостой прогон. Запусти с { dryRun: false } чтобы применить.');
}
