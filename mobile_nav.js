// © 2025–2026. Все права защищены.
// ═══════════════════════════════════════════════════════════════
// КАБИНЕТ НА ТЕЛЕФОНЕ — ТА ЖЕ НАВИГАЦИЯ, ЧТО НА МОНИТОРЕ.
//
// ⚠️ ЗДЕСЬ СТОЯЛА НИЖНЯЯ ПАНЕЛЬ С ЛИСТАМИ, И ЭТО БЫЛА ОШИБКА. Навигацию кабинета
// увели вниз экрана: четыре кнопки, по тапу поднимается лист — вертикальный
// список ведомств и разделов. То есть на телефоне игрок получил ВТОРУЮ, ни на
// что не похожую навигацию: на мониторе разделы — вкладки в потоке страницы,
// на телефоне те же разделы — модальный список из-под низа. Одно и то же место
// игры выглядело и работало по-разному в зависимости от ширины окна.
//
// КАК ДОЛЖНО БЫТЬ (и как теперь): устройство навигации ОДНО. Ведомства — лента
// вкладок, разделы ведомства — лента вкладок под ней, главы — третья. На
// мониторе они стоят строкой и колонкой, на телефоне те же ленты едут вбок
// пальцем. Ничего не прячется и ничего не всплывает поверх работы.
//
// ЧТО ОСТАЛОСЬ ОТ ФАЙЛА. Только метка режима: `html.mnav-on` поднимается, пока
// игрок на телефоне и на странице кабинета (#cab-stage живёт лишь в ней). На
// ней держится весь мобильный ремонт тел ведомств в 31_mobile_nav.css — сетки
// в одну колонку, таблицы со своей прокруткой, поля ввода в 16px, тап-мишени.
// Разметку кабинета файл не трогает вовсе.
// ═══════════════════════════════════════════════════════════════

// ⚠️ ПОРОГ ТОТ ЖЕ, ЧТО У `_cabWide()` В cabinet.js, И ЭТО ОБЯЗАТЕЛЬНО: до 768px
// полосы вкладок остаются лентами на месте, выше — `cabRailify` переставляет их
// в колонку монитора. Разъедутся числа — раскладка окажется между двумя.
const MNAV_MQ = '(max-width:768px)';
function mnavPhone() {
  try { return window.matchMedia(MNAV_MQ).matches; } catch (e) { return false; }
}

function mnavStage() { return document.getElementById('cab-stage'); }

function mnavSync() {
  const on = !!(mnavPhone() && mnavStage());
  const html = document.documentElement;
  if (html.classList.contains('mnav-on') === on) return;
  html.classList.toggle('mnav-on', on);
}

// Кабинет перерисовывает себя из десятка мест (cabPaint, estRefresh, ответы
// сервера) — ловить все вызовы значит править их все. Слушаем сам DOM, кадром
// ожидания, как это делает cabRailify.
(function _mnavWatch() {
  const start = () => {
    const cw = document.getElementById('cw');
    if (!cw) { setTimeout(start, 300); return; }
    if (typeof MutationObserver === 'function') {
      let queued = false;
      const mo = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; try { mnavSync(); } catch (e) {} });
      });
      mo.observe(cw, { childList: true, subtree: true });
    }
    try { mnavSync(); } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.addEventListener('hashchange', () => { setTimeout(() => { try { mnavSync(); } catch (e) {} }, 60); });
  window.addEventListener('resize', () => { try { mnavSync(); } catch (e) {} });
  // Страховка на случай пересозданного #cw, которого наблюдатель не увидел.
  setInterval(() => { try { mnavSync(); } catch (e) {} }, 1500);
})();
