// ════════════════════════════════════════════════════════════
// АРТ ДОЗВЁЗДНЫХ: раскладка по сетке «раса × эпоха» + манифест.
//
// Две двери, логика одна:
//   • tools\precursor_arts.bat — перетащить картинки на батник;
//   • админка → «Дозвёздные» → «Сцены хроник» — та же раскладка сеткой, там
//     ещё и видно, что уже залито (панель шлёт файлы в tools\upload-server.js,
//     а он зовёт put/manifest отсюда же — см. module.exports внизу).
// Логика здесь, а не в .bat, потому что cmd не умеет ни кириллицу в выводе,
// ни кавычки в путях, ни JSON — а всё три нужны сразу.
//
//   node tools/precursor_arts.js <файлы…>   разложить и обновить манифест
//   node tools/precursor_arts.js            только обновить манифест
//
// Имя файла: <раса>_<эпоха>[_номер].(webp|png|jpg|jpeg)
//   humanoid_E8.webp → assets/precursor/worlds/humanoid/E8_1.webp
// ════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'assets', 'precursor', 'worlds');
// Вторая сетка — арт КОНКРЕТНОЙ хроники: спрайты говорящих, фоны сцен и дверь.
// Сетка «раса × эпоха» отвечает на «кто и когда», эта — на «кто именно и где».
const SAGA = path.join(__dirname, '..', 'assets', 'precursor', 'saga');

const RACES = {
  humanoid: 'Гуманоиды', mammal: 'Млекопитающие', reptiloid: 'Рептилоиды',
  avian: 'Авианы (Птицеподобные)', insectoid: 'Инсектоиды', aquatic: 'Акватики (Водные)',
  plantoid: 'Плантоиды (Растениевидные)', lithoid: 'Литоиды (Каменные)',
  synth: 'Синтетики / Киборги', energy: 'Энергетические сущности',
  common: 'любая раса',
};
const EPOCHS = {
  E0: 'Собиратели', E1: 'Оседлость', E2: 'Металл', E3: 'Письмо',
  E4: 'Бронзовые царства', E5: 'Железо', E6: 'Классика', E7: 'Тёмный провал',
  E8: 'Порох и паруса', E9: 'Пар и фабрика', E10: 'Атом и код', E11: 'Порог',
};
const EXT = ['.webp', '.png', '.jpg', '.jpeg'];

// Арт хроники: <мир>_who_<говорящий>, <мир>_bg_<узел>, <мир>_door.
// Имя мира и ключи придумывает не батник, а сам файл хроники (saga_*.js),
// поэтому здесь ничего не сверяется со списком: проверять нечего, реестр
// живёт в клиенте. Форма имени — единственное правило.
const SAGA_RE = /^([a-z0-9-]{2,24})_(who|bg)_([a-z0-9_-]{1,40})$/i;
const DOOR_RE = /^([a-z0-9-]{2,24})_door$/i;

function putSaga(src, base, ext) {
  const m = base.match(SAGA_RE), d = base.match(DOOR_RE);
  if (!m && !d) return false;
  const world = (m ? m[1] : d[1]).toLowerCase();
  const name = m ? `${m[2].toLowerCase()}_${m[3].toLowerCase()}${ext}` : `door${ext}`;
  const dir = path.join(SAGA, world);
  fs.mkdirSync(dir, { recursive: true });
  // Здесь вариантов не бывает: у говорящего одно лицо, у сцены один кадр.
  // Поэтому кладём с перезаписью — залил новый файл, старый ушёл.
  for (const e of EXT) {
    const old = path.join(dir, name.replace(ext, e));
    if (e !== ext && fs.existsSync(old)) fs.unlinkSync(old);
  }
  fs.copyFileSync(src, path.join(dir, name));
  console.log(`  [ок] хроника ${world} · ${name}`);
  return true;
}

function put(src) {
  const ext = path.extname(src).toLowerCase();
  const base = path.basename(src, path.extname(src));
  if (!EXT.includes(ext)) return console.log(`  [пропуск] ${path.basename(src)} — не картинка`);
  if (putSaga(src, base, ext)) return;

  const parts = base.split('_');
  const race = (parts[0] || '').toLowerCase();
  const epoch = (parts[1] || '').toUpperCase();
  let num = parts[2] ? parseInt(parts[2], 10) : 0;

  if (!RACES[race]) return console.log(`  [пропуск] ${base}${ext} — раса «${race}» неизвестна`);
  if (!EPOCHS[epoch]) return console.log(`  [пропуск] ${base}${ext} — эпоха «${epoch}» неизвестна`);

  const dir = path.join(ROOT, race);
  fs.mkdirSync(dir, { recursive: true });

  // Номер не указан — занимаем первый свободный, чтобы не затереть чужой вариант.
  if (!num) {
    num = 1;
    while (EXT.some(e => fs.existsSync(path.join(dir, `${epoch}_${num}${e}`)))) num++;
  }
  const dest = path.join(dir, `${epoch}_${num}${ext}`);
  fs.copyFileSync(src, dest);
  console.log(`  [ок] ${RACES[race]} · ${epoch} ${EPOCHS[epoch]} · вариант ${num}`);
}

// Манифест: ИМЕНА файлов, а не количество — расширения у вариантов разные,
// и «сколько штук» однажды промахнётся мимо .png.
function manifest() {
  const out = {};
  if (fs.existsSync(ROOT)) {
    for (const dir of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const cell = {};
      for (const f of fs.readdirSync(path.join(ROOT, dir.name)).sort()) {
        const m = f.match(/^(E\d+)_(\d+)\.(webp|png|jpe?g)$/i);
        if (!m) continue;
        (cell[m[1].toUpperCase()] = cell[m[1].toUpperCase()] || []).push(f);
      }
      if (Object.keys(cell).length) out[dir.name] = cell;
    }
  }
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(out, null, 1), 'utf8');

  const cells = Object.values(out).reduce((n, c) => n + Object.keys(c).length, 0);
  const files = Object.values(out).reduce(
    (n, c) => n + Object.values(c).reduce((k, a) => k + a.length, 0), 0);
  console.log(`\nМанифест обновлён: ${files} файл(ов) в ${cells} клетках.`);

  // Чего не хватает — говорим прямо: пустая клетка подставится из common,
  // а если и его нет, сцена покажет ровный тон.
  const miss = [];
  for (const r of Object.keys(RACES)) {
    if (r === 'common') continue;
    const have = out[r] || {};
    const gaps = Object.keys(EPOCHS).filter(e => !have[e] && !(out.common || {})[e]);
    if (gaps.length) miss.push(`  ${r.padEnd(10)} нет: ${gaps.join(' ')}`);
  }
  if (miss.length) console.log('\nПустые клетки (арта пока нет):\n' + miss.join('\n'));
}

// Манифест арта хроник: {мир: {who:{ключ:файл}, bg:{узел:файл}, door:файл}}.
// Клиент читает клетки только отсюда — файл без манифеста для него не
// существует, и это нарочно: иначе каждая сцена собирала бы 404 наугад.
function sagaManifest() {
  const out = {};
  if (fs.existsSync(SAGA)) {
    for (const dir of fs.readdirSync(SAGA, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const cell = { who: {}, bg: {} };
      for (const f of fs.readdirSync(path.join(SAGA, dir.name)).sort()) {
        const m = f.match(/^(who|bg)_(.+)\.(webp|png|jpe?g)$/i);
        if (m) { cell[m[1].toLowerCase()][m[2]] = f; continue; }
        if (/^door\.(webp|png|jpe?g)$/i.test(f)) cell.door = f;
      }
      if (Object.keys(cell.who).length || Object.keys(cell.bg).length || cell.door) out[dir.name] = cell;
    }
  }
  fs.mkdirSync(SAGA, { recursive: true });
  fs.writeFileSync(path.join(SAGA, 'manifest.json'), JSON.stringify(out, null, 1), 'utf8');

  const n = Object.values(out).reduce((k, c) =>
    k + Object.keys(c.who).length + Object.keys(c.bg).length + (c.door ? 1 : 0), 0);
  console.log(`Манифест хроник обновлён: ${n} файл(ов) в ${Object.keys(out).length} хрониках.`);
  return out;
}

// Первый свободный номер варианта в клетке «раса × эпоха». Нужен и здесь,
// и аплоад-серверу: заливка из админки не должна затирать чужой вариант.
function freeNum(race, epoch) {
  const dir = path.join(ROOT, race);
  let num = 1;
  while (EXT.some(e => fs.existsSync(path.join(dir, `${epoch}_${num}${e}`)))) num++;
  return num;
}

// Батник запускает файл напрямую, аплоад-сервер подключает его как модуль —
// раскладка и манифест обязаны быть одни и те же, иначе админка и перетаскивание
// на .bat начнут расходиться в мелочах.
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length) { console.log('Раскладываю:'); args.forEach(put); }
  manifest();
  sagaManifest();
  console.log(`\nПапки: ${ROOT}\n       ${SAGA}`);
} else {
  module.exports = { ROOT, SAGA, RACES, EPOCHS, EXT, put, manifest, sagaManifest, freeNum };
}
