// ── ПАТЧ ПУБЛИКАЦИИ ПОД ТВОРЧЕСКИЙ КОРПУС ─────────────────────────────────────
// _cn_plate_map и _cn_recompute правятся не «перепиши файл заново», а точечно
// поверх ЖИВОГО определения из базы: репозиторный _unit_publish.sql не применён и
// его накат снёс бы заслон слотов и прочие живые правки (см. память module-slot-caps).
// Скрипт снимает функции с базы, вносит правки и печатает готовый _colossus_patch.sql.
//
// Запуск: node tools/gen_colossus_patch.js > _colossus_patch.sql
const fs = require('fs'), path = require('path'), { Client } = require('pg');
const root = path.join(__dirname, '..'), envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
// Правка идемпотентна: если в живой функции уже стоит наш кусок (патч катали
// раньше), просто оставляем как есть — иначе повторный прогон падал бы, а нам надо
// уметь перегенерировать файл в любой момент.
const must = (src, from, to, what) => {
  if (src.indexOf(to) >= 0) return src;
  if (src.indexOf(from) < 0) throw new Error('не найдено для правки: ' + what);
  return src.replace(from, to);
};

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const get = async n => {
    const r = await c.query(`select pg_get_functiondef(p.oid) src from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where p.proname = $1 and ns.nspname = 'public'`, [n]);
    if (!r.rows.length) throw new Error('нет функции ' + n);
    if (r.rows.length > 1) throw new Error('перегрузок больше одной: ' + n);
    // База отдаёт исходник с CRLF (функции заливались из Windows-файлов) — приводим
    // к \n, иначе ни один шаблон правки не совпадёт.
    return r.rows[0].src.replace(/\r\n/g, '\n');
  };

  // ── 1. Карта платы: маску колосса печём на лету из корпуса проекта ──
  let plate = await get('_cn_plate_map');
  plate = must(plate,
    `  select * into msk from public.cn_deck_mask where class = p_class;
  if not found then `,
    `  -- КОЛОСС: решётки в справочнике нет и быть не может — корпус у каждого проекта
  -- свой. Печём маску из data.hull (его прокидывает _cn_recompute в layout).
  if p_class = 'colossus' then
    msk := public._cn_hull_mask(p_layout->'hull');
  else
    select * into msk from public.cn_deck_mask where class = p_class;
  end if;
  if msk.w is null then `, 'plate: выборка маски');

  // ── 2. Публикация ──
  let rec = await get('_cn_recompute');
  // Снимаем предыдущую редакцию блока (в базе мог остаться потолок площади, от
  // которого отказались): иначе новая вставка ляжет рядом, и обе будут работать.
  rec = rec.replace(/\n *-- ── ТВОРЧЕСКИЙ КОРПУС[\s\S]*?\n  end if;(?=\n)/g, '');
  rec = must(rec,
    `  k text; cls jsonb;`,
    `  -- творческий корпус (Имперский колосс): параметры проекта и маска по ним
  v_hull jsonb; v_hmask public.cn_deck_mask; slotcap int;
  k text; cls jsonb;`, 'recompute: объявления');

  rec = must(rec,
    `  if cls is null then raise exception 'bad class'; end if;`,
    `  if cls is null then raise exception 'bad class'; end if;
  -- ── ТВОРЧЕСКИЙ КОРПУС ──────────────────────────────────────────────────────
  -- У колосса ТТХ класса в каталоге — только эталон «корпуса по умолчанию».
  -- Настоящие масса/экипаж/трюм/сырьё/цена и потолок отсеков считаются от площади
  -- нарисованного корпуса, а сама фигура — из САНИРОВАННОЙ маски (один кусок,
  -- обрезка полей, зажим габарита канвы), а не из того, что прислал клиент.
  -- ⚠️ Потолка площади нет намеренно: предел — канва и цена (квадратичная от
  -- площади), см. _cn_colossus_cls. Мелочь отсекаем: колосс начинается с 40 клеток.
  if k = 'colossus' then
    v_hull := public._cn_hull_sane(p_data->'hull');
    v_hmask := public._cn_hull_mask(v_hull);
    if v_hmask.cells < (public._cn_col_lim()->>'min')::int then
      raise exception 'корпус слишком мал: % клеток, колосс начинается с %',
        v_hmask.cells, (public._cn_col_lim()->>'min')::int;
    end if;
    cls := public._cn_colossus_cls(cls, v_hmask.cells);
  end if;`, 'recompute: ТТХ корпуса');

  rec = must(rec,
    `  plate := public._cn_plate_map(k, coalesce(p_data->'layout','{}'::jsonb), db);`,
    `  plate := public._cn_plate_map(k,
    coalesce(p_data->'layout','{}'::jsonb) || jsonb_build_object('hull', v_hull), db);`,
    'recompute: вызов карты платы');

  rec = must(rec,
    `  if jsonb_array_length(mlist) > public._cn_mod_slots(k) then
    raise exception 'модулей больше предела класса: % при потолке %',
      jsonb_array_length(mlist), public._cn_mod_slots(k);`,
    `  -- Потолок слотов у колосса тоже плавает вместе с корпусом (страховка от прямой
  -- записи; форму по-прежнему держит маска палубы).
  slotcap := case when k = 'colossus' then greatest(4, (cls->>'modul')::int * 2)
                  else public._cn_mod_slots(k) end;
  if jsonb_array_length(mlist) > slotcap then
    raise exception 'модулей больше предела класса: % при потолке %',
      jsonb_array_length(mlist), slotcap;`, 'recompute: потолок слотов');

  // Корпус едет в summary: по нему рисуют силуэт карточка и боевой рендер —
  // класса 'colossus' для этого мало, у каждого борта своя форма.
  rec = must(rec,
    `    'className', cls->>'name', 'typeName', coalesce(typeObj->>'name',''));`,
    `    'hull', v_hull, 'hullCells', v_hmask.cells,
    'className', cls->>'name', 'typeName', coalesce(typeObj->>'name',''));`,
    'recompute: корпус в summary');

  await c.end();
  process.stdout.write(`-- ============================================================
-- ИМПЕРСКИЙ КОЛОСС · ПАТЧ ПУБЛИКАЦИИ (АВТОГЕН)
-- Источник: ЖИВЫЕ _cn_plate_map/_cn_recompute из базы + правки
-- tools/gen_colossus_patch.js. Руками не править — перегенерировать.
-- Применять ПОСЛЕ _colossus_hull.sql и _unit_catalog.sql.
-- ⚠️ Репозиторный _unit_publish.sql НЕ применён и его накат снесёт и это, и
-- заслон слотов: правки всегда снимаются с базы, а не с файла.
-- ============================================================

${plate};

${rec};
`);
})().catch(e => { console.error(e.message); process.exit(1); });
