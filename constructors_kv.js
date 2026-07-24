// ════════════════════════════════════════════════════════════
// ДАННЫЕ КВАКВАНТОРА (перенос из govno-копия.html, дословно)
// Классы юнитов, реакторы, материалы брони, модули, оружие, коэффициенты.
// Экспорт в window.KV — потребляется constructors.js (синтез).
// НЕ РЕДАКТИРОВАТЬ вручную по мелочи: источник — Кваквантор.
// ════════════════════════════════════════════════════════════
window.KV = (function () {
"use strict";
      const speedBoostConfig = [
          {
              engineName: 'РИТЭГ-3-Ф «Неферитовая лоза»',
              moduleName: 'ККЗ Ионный маршевый двигатель',
              speedBoost: 5000000000000
          },
          {
              engineName: '˻✦˺ Биологические ресурсы [Колонисты/Наёмники/Приывники]',
              moduleName: 'Модуль адаптации М3',
              speedBoost: 3
          }
      ];


      // ИСХОДНЫЕ ХАРАКТЕРИСТИКИ КЛАССОВ
      const shipClasses = {
        peh: { hp: 0, size: 1, orugie: 2, modul: 0, crewRequired: 1, price: 5000, capacity: 10, shieldBoost: 0, speed: 1, resurs: { blackmetall: 5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 1 }, mass: 100, gabarit: 1, xxx: "Пехота" },
        btr: { hp: 0, size: 2, orugie: 2, modul: 0, crewRequired: 2, price: 500000, capacity: 70, shieldBoost: 0, speed: 1, resurs: { blackmetall: 5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 2 }, mass: 13600, gabarit: 5, xxx: "БТР" },
          tanki: { hp: 0, size: 2, orugie: 3, modul: 0, crewRequired: 3, price: 900000, capacity: 130, shieldBoost: 0, speed: 1, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 5 }, mass: 46500, gabarit: 9, xxx: "Танк" },
          arta: { hp: 0, size: 1, orugie: 2, modul: 0, crewRequired: 10, price: 2000000, capacity: 160, shieldBoost: 0, speed: 1, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 10 }, mass: 5000, gabarit: 4, xxx: "Артиллерия" },
          aviacia: { hp: 0, size: 1, orugie: 5, modul: 0, crewRequired: 1, price: 1500000, capacity: 80, shieldBoost: 0, speed: 1, resurs: { blackmetall: 5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 15 }, mass: 20000, gabarit: 7, xxx: "Атмосферная авиация" },
          vertihui: { hp: 0, size: 1, orugie: 6, modul: 0, crewRequired: 3, price: 3000000, capacity: 100, shieldBoost: 0, speed: 1, resurs: { blackmetall: 5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 10 }, mass: 8000, gabarit: 5, xxx: "Вертолет" },
          dron: { hp: 0, size: 1, orugie: 3, modul: 0, crewRequired: 0, price: 500000, capacity: 6, shieldBoost: 0, speed: 1, resurs: { blackmetall: 5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 1 }, mass: 20, gabarit: 0.1, xxx: "Дрон" },

          mla: { hp: 0, size: 1, orugie: 5, modul: 0, crewRequired: 1, price: 1500000, capacity: 80, shieldBoost: 0, speed: 1, resurs: { blackmetall: 5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 15 }, mass: 20000, gabarit: 7, xxx: "Звездолет" },
          dronkos: { hp: 0, size: 1, orugie: 3, modul: 0, crewRequired: 0, price: 500000, capacity: 6, shieldBoost: 0, speed: 1, resurs: { blackmetall: 5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 3 }, mass: 50, gabarit: 0.4, xxx: "БПЛА" },

        //  brig: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 10, price: 1000000, capacity: 0, shieldBoost: 5, speed: 1, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 20 }, mass: 50500, gabarit: 40, xxx: "Бриг" },
      //    satelloid: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 10, price: 5000000, capacity: 100, shieldBoost: 8, speed: 1, resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 50 }, mass: 60500, gabarit: 20, xxx: "Сателлоид" },
          corvette: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 20, price: 15000000, capacity: 10, shieldBoost: 1, speed: 1, resurs: { blackmetall: 200, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 30 }, mass: 90000, gabarit: 100, xxx: "Корвет" },
          destroyer: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 30, price: 30000000, capacity: 0, shieldBoost: 9, speed: 1, resurs: { blackmetall: 300, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 50 }, mass: 109500, gabarit: 150, xxx: "Эсминец" },
          supportCarrier: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 25, price: 45000000, capacity: 600, shieldBoost: 15, speed: 1, resurs: { blackmetall: 400, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 }, mass: 100000, gabarit: 80, xxx: "Поддерживающий авианосец" },
        //  lightCruiser: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 40, price: 60000000, capacity: 0, shieldBoost: 13, speed: 1, resurs: { blackmetall: 600, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, mass: 200000, gabarit: 300, xxx: "Лёгкий крейсер" },
          mediumCruiser: { hp: 0, size: 3, orugie: 1, modul: 0, crewRequired: 50, price: 75000000, capacity: 0, shieldBoost: 40, speed: 1, resurs: { blackmetall: 800, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 200 }, mass: 250000, gabarit: 400, xxx: "Средний крейсер" },
          hyperCruiser: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 40, price: 100000000, capacity: 0, shieldBoost: 14, speed: 1, resurs: { blackmetall: 1000, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 800 }, mass: 200000, gabarit: 220, xxx: "Гиперкрейсер" },
          multiroleCarrier: { hp: 0, size: 1, orugie: 1, modul: 0, crewRequired: 40, price: 120000000, capacity: 5500, shieldBoost: 19, speed: 1, resurs: { blackmetall: 1200, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 400 }, mass: 230000, gabarit: 350, xxx: "Многоцелевой авианосец" },
          battleship: { hp: 0, size: 2, orugie: 1, modul: 0, crewRequired: 70, price: 200000000, capacity: 0, shieldBoost: 40, speed: 1, resurs: { blackmetall: 1500, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 1000 }, mass: 400000, gabarit: 500, xxx: "Линкор" },
          dreadnought: { hp: 0, size: 3, orugie: 1, modul: 0, crewRequired: 100, price: 250000000, capacity: 0, shieldBoost: 40, speed: 1, resurs: { blackmetall: 1800, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 4000 }, mass: 500000, gabarit: 800, xxx: "Дредноут" },
          ss13: { hp: 0, size: 4, orugie: 1, modul: 0, crewRequired: 250, price: 70000000, capacity: 1000, shieldBoost: 40, speed: 1, resurs: { blackmetall: 2000, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 600 }, mass: 450000, gabarit: 400, xxx: "СС-13" }

      };

//*--------------------------------------------------------------------------*//
////////// Р Е А К Т О Р Ы ////// Р Е А К Т О Р Ы ///// /Р Е А К Т О Р Ы //////
//*--------------------------------------------------------------------------*//

      const engines = {
          peh: [
                    { name: '˻ПЕХОТИНЕЦ˺ Его отважное сердце', capacityBoost: 0, price: 0, power: 0, modul: 3, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 50 },
                    { name: '˻✦˺ Переносной генератор ', capacityBoost: -2, price: 1500000, power: 3, modul: 6, dviglo: 1, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 80 },
                    { name: '˻АВТОМАТОН˺ Внутренний реактор ', capacityBoost: 10, price: 3000000, power: 40, modul: 5, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 100 },
          ],
          btr: [
                    { name: '˻✦˺ Электрический генератор Х3000 «Прометей»', price: 3000000, power: 100, modul: 1, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 200 },
                    { name: '˻✦˺ Силовая установка M1 «Ай-Тодор»', price: 4000000, power: 200, modul: 2, dviglo: 2, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 300 }
          ],
          tanki: [
                    { name: '˻✦˺ Электрический генератор Х2-3350 «Прометей»', capacityBoost: 0, price: 900000, power: 250, modul: 1, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 185  },
                    { name: '˻✦˺ Силовая установка M2-10 «Ай-Тодор»', capacityBoost: -5, price: 1000000, power: 450, modul: 2, dviglo: 1, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 200 },
                    { name: '˻✦˺ Электрохимические ячейка М2х60 «Треченто»', capacityBoost: -5, price: 5500000, power: 600, modul: 3, dviglo: 2, radar: 3, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 220 },
                    { name: '˻✦˺ Аккумулятор N.II «Паллада»', capacityBoost: -10, price: 10000000, power: 900, modul: 4, dviglo: 2, radar: 4, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 300, rudametall: 0, kristall: 0, staarvis: 0 }, force: 260 },
          ],
          arta: [
                    { name: '˻✦˺ Электрический генератор Х2-3360 «Прометей»', capacityBoost: 0, price: 1500000, power: 450, modul: 1, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 20  },
                    { name: '˻✦˺ Силовая установка M3 «Ай-Тодор»', capacityBoost: -5, price: 3000000, power: 600, modul: 2, dviglo: 1, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 24 },
                    { name: '˻✦˺ Электрохимические ячейка М2х61 «Треченто»', capacityBoost: -5, price: 4500000, power: 900, modul: 3, dviglo: 2, radar: 3, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 29 },
          ],
          aviacia: [
                    { name: '˻✦˺ Турбогенератор T-5 «Фрилис»', capacityBoost: 0, price: 1000000, power: 600, modul: 1, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 210 },
                    { name: '˻✦˺ Гибридная энергетическая установка 4ÆM20 «Фотон»', capacityBoost: 20, price: 3000000, power: 900, modul: 2, dviglo: 1, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 220 },
                    { name: '˻✦˺ Аккумуляторная система AС-9 «Эридан»', capacityBoost: -5, price: 6000000, power: 1000, modul: 3, dviglo: 2, radar: 3, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 200, rudametall: 0, kristall: 0, staarvis: 0 }, force: 230 },
                    { name: '˻✦˺ РИТЭГ-1-К «Эвенк»', capacityBoost: -5, price: 10000000, power: 1200, modul: 5, dviglo: 2, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 400, rudametall: 0, kristall: 0, staarvis: 0 }, force: 250 }
          ],
          vertihui: [
                    { name: '˻✦˺ Турбогенератор T-57 «Фрилис»', capacityBoost: 0, price: 4500000, power: 700, modul: 1, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 100 },
                    { name: '˻✦˺ Энергоблок X-I «Млекомеда»', capacityBoost: -5, price: 10000000, power: 1300, modul: 2, dviglo: 2, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 110 }
          ],
          dron: [
                    { name: '˻✦˺ Аккумулятор боевого дрона АД 4 «Блыскавица»', capacityBoost: 0, price: 3000000, power: 100, modul: 2, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 50 },
                    { name: '˻✦˺ Аккумулятор грузового дрона АД 1 «Сервитор»', capacityBoost: 10, price: 3000000, power: 50, modul: 1, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 120 },

          ],

          mla: [
                    { name: '˻✦˺ РИТЭГ-1.2-К «Электра»', capacityBoost: 0, price: 1000000, power: 600, modul: 1, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, force: 50 },
                    { name: '˻✦˺ ГАР10 М1-К «Камлание»', capacityBoost: -5, price: 3000000, power: 900, modul: 2, dviglo: 1, radar: 2, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 80 },
          ],

          dronkos: [
                    { name: '˻✦˺ Аккумулятор боевого дрона АД 12 «Звездная блыскавица»', capacityBoost: 0, price: 3000000, power: 100, modul: 2, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 50 },
                    { name: '˻✦˺ Аккумулятор грузового дрона АД 20 «Космосервитор»', capacityBoost: 15, price: 3000000, power: 100, modul: 2, dviglo: 1, radar: 1, svaz: 1, speed: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0, kristall: 0, staarvis: 0 }, force: 69 },

          ],

          corvette: [
              { name: 'КГГРн22-К «Моздок»', capacityBoost: 0, price: 2000000, power: 950, modul: 1, dviglo: 1, radar: 1, svaz: 1, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 70 },
              { name: 'АР22 М3-К «Саркосома»', capacityBoost: 0, price: 15000000, power: 1050, modul: 1, dviglo: 1, radar: 1, svaz: 1, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 20, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 100 },
              { name: 'РнА55-К «Аквитания»', capacityBoost: 50, price: 20000000, power: 1300, modul: 1, dviglo: 1, radar: 1, svaz: 1, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 10 }, force: 140 }
          ],
          destroyer: [
              { name: 'РИТЭГ-3-Ф «Неферитовая лоза»', capacityBoost: 0, price: 10500000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 800, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 20, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 40 },
              { name: 'ТРИС-51К М3-Ф «Азуми»', capacityBoost: 0, price: 5500000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 950, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 70 },
              { name: 'ТГ-3С-Ф «Мальцин»', capacityBoost: 0, price: 20500000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 1500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 100 },
              { name: 'КГГРн22-Ф «Чигирин»', capacityBoost: 0, price: 15500000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 1300, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 140 },
              { name: 'СТЛ X1 «Энет»', capacityBoost: 0, price: 25000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 2500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 100, rudametall: 0,  kristall: 0,  staarvis: 100 }, force: 180 }
          ],
          supportCarrier: [
              { name: 'РИТЭГ-51П «Свайнсона»', capacityBoost: 0, price: 12000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 1400, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 80 }
          ],
          lightCruiser: [
              { name: 'СТЛ Х1-51В-ЛКР «Янасса»', capacityBoost: 0, price: 27000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 2400, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 100, rudametall: 0,  kristall: 0,  staarvis: 0 } },
              { name: 'ТРИС-01Т «Акербо»', capacityBoost: 0, price: 12000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 3800, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 100, rudametall: 0,  kristall: 0,  staarvis: 100 } }
          ],
          mediumCruiser: [
              { name: 'ТГ-51К М3-СКР «Владимир»', capacityBoost: 0, price: 6000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 2000, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0,  kristall: 0,  staarvis: 50 }, force: 50 },
              { name: 'КГГРн22 У-СКР «Днепропетровск»', capacityBoost: 0, price: 15000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 2200, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 100 },
              { name: 'СТЛ Х1-51Г-СКР «Нерида»', capacityBoost: 0, price: 27500000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 2700, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 100 }, force: 150 },
              { name: 'РнА51С «Киев»', capacityBoost: 50, price: 35000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 3700, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 100, rudametall: 0,  kristall: 0,  staarvis: 100 }, force: 200 },
              { name: 'СТЛ Х1-51Г-СКР «Мельпомена»', capacityBoost: 0, price: 40000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 5500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 200, rudametall: 0,  kristall: 0,  staarvis: 250 }, force: 250 },
          ],
          hyperCruiser: [
              { name: 'КГГРн22 У-ТКР  «Московиен»', capacityBoost: 0, price: 16000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 3500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 200, rudametall: 0,  kristall: 0,  staarvis: 50 }, force: 50  },
              { name: 'СТЛ Х1-51Д-ТКР «Акид»', capacityBoost: 0, price: 30000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 5000, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 300, rudametall: 0,  kristall: 0,  staarvis: 50 }, force: 100  },
              { name: 'КГГРн-Х4 «Царьград»', capacityBoost: 0, price: 40000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 7500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 300, rudametall: 0,  kristall: 0,  staarvis: 100 }, force: 250  },
          ],
          multiroleCarrier: [
              { name: 'АР25-ТКР «Артомицес»', capacityBoost: 0, price: 50000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 7500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 200, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 50  },
              { name: 'ТРИС-02Х «Терминус»', capacityBoost: 0, price: 70000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 10000, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 100, rudametall: 0,  kristall: 0,  staarvis: 100 }, force: 100  }

          ],
          battleship: [
              { name: 'РнА55А-Л «Парфия»', capacityBoost: 50, price: 35000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 7500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 200, rudametall: 0,  kristall: 0,  staarvis: 100 }, force: 30  },
              { name: 'КГГРн31 У-ЛН «Курск»', capacityBoost: 0, price: 60000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 9500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 50, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 80  },
              { name: 'АР60-Х «Чага»', capacityBoost: 0, price: 80000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 13000, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 400, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 100  },
          ],
          dreadnought: [
              { name: 'АР57 «Трюфель»', capacityBoost: 0, price: 45000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 5500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 700, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 5  },
              { name: 'РнА55А-ДН «Женева»', capacityBoost: 50, price: 70000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 11000, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 500, rudametall: 0,  kristall: 0,  staarvis: 250 }, force: 15  },
              { name: 'КГГРн51П «Верхгермания»', capacityBoost: 0, price: 150000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 20500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 600, rudametall: 0,  kristall: 0,  staarvis: 400 }, force: 25  },
          ],
          ss13: [
              { name: 'АР60 «Млечник»', capacityBoost: 0, price: 90000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 35500, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 600, rudametall: 0,  kristall: 0,  staarvis: 0 }, force: 0  },
              { name: 'ТРИС-777 «Коломор»', capacityBoost: 0, price: 70000000, modul: 1, dviglo: 1, radar: 1, svaz: 1, power: 40000, visibility: 0, resurs: { blackmetall: 0, coloredmetall: 500, rudametall: 0,  kristall: 0,  staarvis: 300 }, force: 0  }
          ],
      };



//*--------------------------------------------------------------------------*//
/////// Б Р О Н Я /// Б Р О Н Я /// Б Р О Н Я/// Б Р О Н Я/// Б Р О Н Я/////////
//*--------------------------------------------------------------------------*//

const materialsDatabase = {
  // --- ЭКЗОСКЕЛЕТЫ (ПЕХОТА ТОП) ---
    // Специализация: Огромный бонус к лимиту веса (capacityBoost), но слабее собственная защита (hpBoost)

      ambrozius: {
        name: 'Экзоскелет «Амброзиус»',
        price: 350000,
        visibility: 0,
        capacityBoost: 40,
        hpBoost: 15,
        category: 'lightMetal',
        material: {
          density: 4.2,
          tensileStrength: { min: 450, max: 600 },
          thermalConductivity: 45,
          heatResistance: 800
        },
        resurs: { blackmetall: 25, coloredmetall: 10, rudametall: 5, kristall: 2, staarvis: 0 },
        description: "Армейский экзоскелет. Гидравлика позволяет носить на себе бронесталь."
      },

      platon: {
        name: 'Тяжелый экзоскелет «Платон»',
        price: 950000,
        visibility: 0,
        capacityBoost: 80,
        hpBoost: 40,
        category: 'heavyMetal',
        material: {
          density: 7.8,
          tensileStrength: { min: 650, max: 900 },
          thermalConductivity: 35,
          heatResistance: 1200
        },
        resurs: { blackmetall: 50, coloredmetall: 15, rudametall: 15, kristall: 5, staarvis: 0 },
        description: "Штурмовая броня с сервоприводами. Зачастую выдерживает попадание крупного калибра, зачастую невыдерживает."
      },

      hinima: {
        name: 'Штурмовой комплекс «Хиним-Ма»',
        price: 4200000,
        visibility: 0,
        capacityBoost: 150,
        hpBoost: 120,
        category: 'composite',
        material: {
          density: 5.5,
          tensileStrength: { min: 1100, max: 1400 },
          thermalConductivity: 12,
          heatResistance: 1800
        },
        resurs: { blackmetall: 80, coloredmetall: 40, rudametall: 25, kristall: 20, staarvis: 0 },
        description: "В этой броне вас будут называть пехотным танком... с завистью."
      },

      tiri: {
        name: 'Осадная платформа «Ти-Ри»',
        price: 12000000,
        visibility: 0,
        capacityBoost: 400,
        hpBoost: 350,
        category: 'heavyMetal',
        material: {
          density: 8.2,
          tensileStrength: { min: 900, max: 1150 },
          thermalConductivity: 25,
          heatResistance: 2500
        },
        resurs: { blackmetall: 250, coloredmetall: 80, rudametall: 60, kristall: 30, staarvis: 0 },
        description: "Старый добрый мех, в котором пилот буквально замурован в металл."
      },

    // --- ПЕХОТА (БРОНЕЖИЛЕТЫ) ---
    // Специализация: Хорошая защита (hpBoost), но штраф к весу (отрицательный capacityBoost)

        inf_kevlar: {
          name: 'Комплект «Альтаанец»',
          price: 45000,
          visibility: 0,
          capacityBoost: -2,
          hpBoost: 40,
          category: 'lightMetal',
          material: {
            density: 1.4, // Арамидное волокно очень легкое
            tensileStrength: { min: 280, max: 350 },
            thermalConductivity: 0.15, // Плохой проводник (хороший изолятор)
            heatResistance: 450
          },
          resurs: { blackmetall: 2, coloredmetall: 8, rudametall: 0, kristall: 0, staarvis: 0 },
          description: "Стандартная общевойсковая защита в сврхсекторе, разработаная одним из колониальных правительств Квантора. Включает бронежелет из усиленного арамидного волокна, бронешлем «Инвикта», оборудованный визором, способным видеть сквозь стены, а также мимикрирующим плащём-невидимкой."
        },

        inf_steel: {
          name: 'Взрывозащитный костюм «Акони»',
          price: 25000,
        visibility: 0,
          capacityBoost: -5,
          hpBoost: 80,
          category: 'heavyMetal',
          material: {
            density: 7.85, // Обычная сталь — тяжелая и громоздкая
            tensileStrength: { min: 400, max: 550 },
            thermalConductivity: 50,
            heatResistance: 1100
          },
          resurs: { blackmetall: 25, coloredmetall: 2, rudametall: 4, kristall: 0, staarvis: 0 },
          description: "Тяжелая... очень тяжелая стальная броня. Относительно дешевая и надежная, но спина спасибо не скажет."
        },

        inf_carbide: {
          name: 'Модульная броня «Ларец»',
          price: 150000,
        visibility: 0,
          capacityBoost: -3,
          hpBoost: 130,
          category: 'ceramic',
          material: {
            density: 3.1, // Карбиды легче стали, но тяжелее кевлара
            tensileStrength: { min: 600, max: 750 },
            thermalConductivity: 110, // Высокая теплопроводность (быстро рассеивает энергию пули/плазмы)
            heatResistance: 2200 // Керамика держит жар даже лучше космостали
          },
          resurs: { blackmetall: 10, coloredmetall: 15, rudametall: 20, kristall: 15, staarvis: 0 },
          description: "Сверхтвердый материал этой брони позволяет ломать сердечники пуль."
        },

  // --- НАЗЕМКА (БТР/ТАНКИ) ---
  // --- НАЗЕМКА (БТР/ТАНКИ) ---
    // Специализация: Высокая прочность ценой мобильности (сильные штрафы к capacity)

        // --- ТЯЖЕЛОЕ БРОНИРОВАНИЕ (ТЕХНИКА/УКРЕПЛЕНИЯ) ---
        scrap_metal: {
          name: 'Наварные экраны',
          price: 15000,
        visibility: 0,
          hpBoost: 50,
          capacityBoost: -2,
          category: 'heavyMetal',
          material: {
            density: 7.2,
            tensileStrength: { min: 250, max: 350 },
            thermalConductivity: 60,
            heatResistance: 900
          },
          resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 5, kristall: 0 },
          description: "Листы, сетки и траки, наваренные поверх корпуса выглядят жутко, но куда деваться?"
        },

        rha_steel: {
          name: 'Катаная гомогенная броня «Фока»',
          price: 180000,
        visibility: 0,
          hpBoost: 200,
          capacityBoost: -20,
          category: 'heavyMetal',
          material: {
            density: 7.85,
            tensileStrength: { min: 500, max: 700 },
            thermalConductivity: 52,
            heatResistance: 1400
          },
          resurs: { blackmetall: 150, coloredmetall: 10, rudametall: 30, kristall: 0 },
          description: "Классическая сталь высокой твердости. Проверена днями... годами... веками..."
        },

        composite_screen: {
          name: 'Многослойный композит «Эмпирей»',
          price: 550000,
        visibility: 0,
          hpBoost: 350,
          capacityBoost: -10,
          category: 'composite',
          material: {
            density: 4.5, // Намного легче стали при высокой прочности
            tensileStrength: { min: 850, max: 1300 }, // На пике превосходит космосталь
            thermalConductivity: 15,
            heatResistance: 2200
          },
          resurs: { blackmetall: 20, coloredmetall: 365, rudametall: 20, kristall: 25 },
          description: "Наивкуснейший сэндвич из стали, текстолита и керамики."
        },

        uranium_plate: {
          name: 'Дифференцированная бронезащита «Старлей»',
        visibility: 0,
          price: 2800000,
          hpBoost: 750,
          capacityBoost: -5,
          category: 'heavyMetal',
          material: {
            density: 19.1, // Чрезвычайно высокая плотность (уран)
            tensileStrength: { min: 900, max: 1100 }, // На уровне космостали
            thermalConductivity: 27,
            heatResistance: 1130 // Плавится раньше космостали
          },
          resurs: { blackmetall: 300, coloredmetall: 150, rudametall: 120, kristall: 15 },
          description: "Бронирование отдельно взятых мест техники сильно повышает её живучесть, но это не точно."
        },

        // --- АВИАЦИЯ ---
        duralumin: {
          name: 'Авиационный дюралюминий',
        visibility: 0,
          price: 95000,
          hpBoost: 60,
          capacityBoost: -5,
          category: 'lightMetal',
          material: {
            density: 2.8,
            tensileStrength: { min: 400, max: 480 },
            thermalConductivity: 140,
            heatResistance: 500
          },
          resurs: { blackmetall: 10, coloredmetall: 40, rudametall: 5, kristall: 10 },
          description: "Легкий и прочный сплав..."
        },

        titan_aviation: {
          name: 'Титановый сплав',
        visibility: 0,
          price: 480000,
          hpBoost: 180,
          capacityBoost: -20,
          category: 'lightMetal',
          material: {
            density: 4.5,
            tensileStrength: { min: 750, max: 950 }, // Почти космосталь!
            thermalConductivity: 20,
            heatResistance: 1650
          },
          resurs: { blackmetall: 20, coloredmetall: 90, rudametall: 40, kristall: 30 },
          description: "Дорогой, но надежный авиационный сплав, который уверенно держит перегрузки и даже попадания."
        },

    // --- КОСМОС: СПЕЦ. БРОНЯ (ВЕС 0 В КОДЕ, НО "ЖЕЛЕЗО" В ЛОРЕ) ---
    // Специализация: Нулевой вес (интегрирована), но огромная стоимость и затраты ресурсов
        // --- КОРАБЕЛЬНАЯ БРОНЯ (Уровень: Космос) ---
        ship_steel_k1: {
          name: 'Коломорская корабельная бронесталь ККБ-54',
          price: 3500000,
        visibility: 0,
          capacityBoost: 0,
          hpBoost: 500,
          category: 'heavyMetal',
          material: {
            density: 8.5,
            tensileStrength: { min: 800, max: 1200 }, // Эталон космостали
            thermalConductivity: 30,
            heatResistance: 2000
          },
          resurs: { blackmetall: 800, coloredmetall: 80, rudametall: 250, kristall: 0 },
          description: "Стандартная обшивка военных кораблей, разработанная инженерами Коломорской Империи с характерной коломорцам массивной и не особо технологичной конструкцией."
        },

        ship_titan_alloy: {
          name: 'Титано-молибденовая броня ККБ-54-М',
          price: 7200000,
        visibility: 0,
          capacityBoost: 0,
          hpBoost: 950,
          category: 'heavyMetal',
          material: {
            density: 6.2,
            tensileStrength: { min: 1100, max: 1500 },
            thermalConductivity: 15,
            heatResistance: 3200 // Тугоплавкость молибдена решает
          },
          resurs: { blackmetall: 1200, coloredmetall: 250, rudametall: 400, kristall: 50 },
          description: "Усиленная версия ККБ-54 из тугоплавкого сплава, которая разрабатывалась для защиты от термических орудий и плазмы."
        },

        ship_composite_x: {
          name: 'Эрлендийский композит «Вероника»',
          price: 15000000,
        visibility: 0,
          capacityBoost: 0,
          hpBoost: 1600,
          category: 'composite',
          material: {
            density: 4.8,
            tensileStrength: { min: 1400, max: 2100 },
            thermalConductivity: 8,
            heatResistance: 2800
          },
          resurs: { blackmetall: 600, coloredmetall: 450, rudametall: 200, kristall: 300 },
          description: "Сложная структура из керамики и полимеров, гасящая взрывные волны."
        },

        ship_nano_lattice: {
          name: 'Эрлендийская наноброня «Мелоди»',
          price: 28000000,
        visibility: 0,
          capacityBoost: 0,
          hpBoost: 2400,
          category: 'ceramic',
          material: {
            density: 3.5, // Невероятно легкая для своей прочности
            tensileStrength: { min: 3500, max: 5000 }, // Алмазная структура
            thermalConductivity: 2000, // Сверхпроводимость тепла (мгновенное рассеивание луча)
            heatResistance: 4000
          },
          resurs: { blackmetall: 400, coloredmetall: 300, rudametall: 300, kristall: 800 },
          description: "Искусственно выращенный алмазоподобный слой, по характеристикам тверже любого металла."
        },

        ship_giperhuina: {
          name: 'Структура 762',
          price: 32000000,
        visibility: 0,
          capacityBoost: 0,
          hpBoost: 3000,
          category: 'ceramic',
          material: {
            density: 0.8, // Пустотная структура, легче воды
            tensileStrength: { min: 4000, max: 6500 },
            thermalConductivity: 0.01, // Полный тепловой изолятор
            heatResistance: 6000
          },
          resurs: { blackmetall: 500, coloredmetall: 400, rudametall: 400, kristall: 1000 },
          description: "Так называемая пустотная броня гиперкрейсера, защищающая его от уничожения в подпространстве."
        },

        ship_heavy_bulkhead: {
          name: 'Царь-цитадель',
        visibility: 0,
          price: 60000000,
          capacityBoost: 0,
          hpBoost: 5500,
          category: 'heavyMetal',
          material: {
            density: 22.5, // Плотнее осмия, чудовищная масса
            tensileStrength: { min: 2000, max: 3000 },
            thermalConductivity: 40,
            heatResistance: 3500
          },
          resurs: { blackmetall: 3500, coloredmetall: 200, rudametall: 900, kristall: 100 },
          description: "Защитные экраны из метровых слеёв сплошного металла, покрывающие весь корпус."
        },

        // --- ДЛЯ ДРОНОВ ---
        plastic_cheap: {
          name: 'Армированный пластик',
        visibility: 0,
          price: 25000,
          hpBoost: 30,
          capacityBoost: 0,
          category: 'composite',
          material: {
            density: 1.2,
            tensileStrength: { min: 50, max: 120 },
            thermalConductivity: 0.2,
            heatResistance: 220
          },
          resurs: { blackmetall: 2, coloredmetall: 12, rudametall: 2, kristall: 5 },
          description: "Дешевая штамповка для расходных дронов."
        },

        // --- ПОКРЫТИЯ ---
        // --- ДЛЯ ДРОНОВ ---
        nakidka: {
          name: 'Многоцелевое покрытие «Юканадте»',
        visibility: 0,
          price: 1000,
          hpBoost: 0,
          capacityBoost: 0,
          category: 'composite',
          material: {
            density: 0,
            tensileStrength: { min: 0, max: 0 },
            thermalConductivity: 0,
            heatResistance: 0
          },
          resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0 },
          description: "Чехол из специального радиопоглощающего материала, снижающий тепловую сигнатуру в 3 раза."
        },

        adaptiv_panels: {
          name: 'Тахронские панели «Контриллюминация»',
        visibility: 0,
          price: 500000,
          hpBoost: 0,
          capacityBoost: 0,
          category: 'composite',
          material: {
            density: 0,
            tensileStrength: { min: 0, max: 0 },
            thermalConductivity: 0,
            heatResistance: 0
          },
          resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0 },
          description: "Активная система из тысяч шестиугольных пикселей, меняющих цвет под окружающую среду."
        },

        have_glass: {
          name: 'Азарданское ферромагнитное покрытие «Ртуть»',
        visibility: 0,
          price: 5000,
          hpBoost: 0,
          capacityBoost: 0,
          category: 'composite',
          material: {
            density: 0,
            tensileStrength: { min: 0, max: 0 },
            thermalConductivity: 0,
            heatResistance: 0
          },
          resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0 },
          description: "Эта краска с микросферами железа преобразует ррадиоволны вражеского радара в тепло."
        },

        ram_paint: {
          name: 'РПП покрытие «Ъ»',
        visibility: 0,
          price: 2000,
          hpBoost: 0,
          capacityBoost: 0,
          category: 'composite',
          material: {
            density: 0,
            tensileStrength: { min: 0, max: 0 },
            thermalConductivity: 0,
            heatResistance: 0
          },
          resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0 },
          description: "Стандартное стелс-покрытие для уменьшения заметности конструкции."
        },

};

const armorElements = {
    // 1. ПЕХОТА
    peh: [
        { reference: 'inf_kevlar' },
        { reference: 'inf_steel' },
        { reference: 'inf_carbide' },
        { reference: 'ambrozius' },
        { reference: 'platon' },
        { reference: 'hinima' },
        { reference: 'tiri' }
    ],

    // 2. НАЗЕМКА (БТР/Танки)
    btr: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'scrap_metal' },
        { reference: 'rha_steel' },
        { reference: 'composite_screen' },
        { reference: 'nakidka' },
{ reference: 'ram_paint' },
{ reference: 'have_glass' },
{ reference: 'adaptiv_panels' }
    ],
    tanki: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'scrap_metal' },
        { reference: 'rha_steel' },
        { reference: 'composite_screen' },
        { reference: 'uranium_plate' },
        { reference: 'nakidka' },
{ reference: 'ram_paint' },
{ reference: 'have_glass' },
{ reference: 'adaptiv_panels' },
    ],
    arta: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'scrap_metal' },
        { reference: 'rha_steel' },
        { reference: 'nakidka' },
{ reference: 'ram_paint' },
{ reference: 'have_glass' },
{ reference: 'adaptiv_panels' },
    ],

    // 3. АВИАЦИЯ
    aviacia: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'duralumin' },
        { reference: 'titan_aviation' },
{ reference: 'ram_paint' },
{ reference: 'have_glass' },
    ],
    vertihui: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'scrap_metal' }, // Вертолетам часто варят мусор на дно
        { reference: 'duralumin' },
        { reference: 'titan_aviation' },
        { reference: 'nakidka' },
{ reference: 'ram_paint' },
{ reference: 'have_glass' },
{ reference: 'adaptiv_panels' },
    ],

    // 4. ДРОНЫ
    dron: [ { reference: 'plastic_cheap' } ],
    dronkos: [ { reference: 'plastic_cheap' }, { reference: 'duralumin' } ],

    // 5. КОСМОС (5 видов "0-весовой" брони)
    // Используем одну функцию, чтобы не копипастить, или массив напрямую
    mla: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_steel_k1' },
{ reference: 'ram_paint' },
{ reference: 'adaptiv_panels' },

    ],
    corvette: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_steel_k1' }, { reference: 'ship_titan_alloy' }, { reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
    destroyer: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_steel_k1' }, { reference: 'ship_titan_alloy' },{ reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
    // Крупные корабли получают доступ к топам
    supportCarrier: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_steel_k1' }, { reference: 'ship_composite_x' },{ reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
    mediumCruiser: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_steel_k1' }, { reference: 'ship_composite_x' }, { reference: 'ship_nano_lattice' },{ reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
    hyperCruiser: [
        { reference: 'ship_giperhuina' },
    ],
    multiroleCarrier: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_steel_k1' }, { reference: 'ship_composite_x' }, { reference: 'ship_heavy_bulkhead' }, { reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
    battleship: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_composite_x' }, { reference: 'ship_nano_lattice' }, { reference: 'ship_heavy_bulkhead' }, { reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
    dreadnought: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_nano_lattice' }, { reference: 'ship_heavy_bulkhead' }, { reference: 'uranium_plate' }, { reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
    ss13: [
        { name: 'Нет выбранной брони', price: 0, hpBoost: 0, capacityBoost: 0, category: 'composite' },
        { reference: 'ship_heavy_bulkhead' }, { reference: 'ship_nano_lattice' }, { reference: 'ram_paint' },
        { reference: 'adaptiv_panels' },
    ],
};

//*--------------------------------------------------------------------------*//
////////////М О Д У Л И////////////М О Д У Л И//////////////М О Д У Л И//////
//*-------------------------------------------------------------------------*//



// combat: боевой эффект модуля на гекс-доске (зеркалится сервером в summary.mods):
//   pd      — ПРО: доля ракетного урона, которую сбивает комплекс (суммируется, кап 0.6)
//   jam     — РЭБ: глушит радары врагов в радиусе 5 гексов (−jam к их сенсору, берётся максимум)
//   stealth — маскировка: +к скрытности корабля
//   sensor  — +к дальности захвата радара
//   hangar  — очки авиакрыльев: каждые 300 очков = 1 запуск авиакрыла в бою
//   dejam   — контр-РЭБ: снимает до N вражеского jam со своих наблюдателей в радиусе 5
//   interdict — интердикция: пока носитель жив, враг НЕ может вызывать подкрепления
//               (модули с interdict/stabil доступны только линкорам и дредноутам)
//   stabil  — анти-интердикция: пока носитель жив, своя сторона игнорирует интердикцию врага
//   ftl     — свой гипердвигатель: корабль прыгает подкреплением СКВОЗЬ вражескую
//             интердикцию (заградитель врага его не держит)
const modulesLibrary = {
    empty: { name: 'Нет выбранных модулей', price: 0, category: 'Демонстрационный модуль', power: 0, speed: 0, protectiveField: 0, modul: 0, crewRequired: 0, capacity: 0, crewProvided: 0, shieldBoost: 0, hp: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },

    // --- ДЕСАНТ И ЭКИПАЖ ---
    crew_extra: { name: 'Дополнитльный член экипажа', damageBoost: 0, price: 10000, category: 'Десант', power: 0, speed: 0, protectiveField: 0, modul: 0, crewRequired: 0, capacity: -5, crewProvided: 1, shieldBoost: 0, hp: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    desantnik: { name: 'Десантник', damageBoost: 0, price: 0, category: 'Десант', power: 0, speed: 0, protectiveField: 0, modul: 0, crewRequired: 0, capacity: -5, crewProvided: 1, shieldBoost: 0, hp: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    drone_cargo: { name: 'Дрон', damageBoost: 0, price: 0, category: 'Десант', power: 0, speed: 0, protectiveField: 0, modul: 0, crewRequired: 0, capacity: -2, crewProvided: 0, shieldBoost: 0, hp: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    cargo_support: { name: 'Груз поддержки', price: 0, category: 'Десант', visibility: 0, power: 0, capacity: -30, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Ящики с припасами превратит ваше судно в мобильную точку для переснаряжения ваших бойцов.' },
    btr_platform: { name: 'БТР/БМП', price: 0, category: 'Десант', visibility: 0, power: 0, capacity: -50, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Платформа для транспортировки бронетехники' },
    tank_platform: { name: 'Танк', price: 0, category: 'Десант', visibility: 0, power: 0, capacity: -200, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Платформа для транспортировки бронетехники, но побольше.' },
    arta_platform: { name: 'Артиллерия', price: 0, category: 'Десант', visibility: 0, power: 0, capacity: -500, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Ваш корабль станет такси для бога войны.' },
    atmo_aviation: { name: 'Атмосферная авиация', price: 0, category: 'Десант', visibility: 0, power: 0, capacity: -100, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Не схоже племя кораблей, что летает по космосу, и племя авиации, что ходит по атмосфере.' },
    heli_platform: { name: 'Вертолет', price: 0, category: 'Десант', visibility: 0, power: 0, capacity: -100, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Корабли и авиация - братья на века.' },

    // --- ОБОРУДОВАНИЕ ---
    ftl_ramon: { name: '«FTL Гипердвигатель «Рамонь»', price: 30000000, category: 'Конструкционные модули', visibility: 0, power: 300, capacity: 0, crewProvided: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 20, staarvis: 30 }, combat: { ftl: 1 }, lor: 'Двигатель, использующий переработанный Старвис. Собственный прыжковый привод пробивает вражескую интердикцию: корабль можно вызвать подкреплением даже под FTL-заградителем противника.' },
    living_module: { name: 'Складской отсек', price: 900000, category: 'Конструкционные модули', visibility: 0, power: 50, capacity: 10, crewProvided: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 40, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Модуль для транспортировки грузов. Добавляет грузоподъёмности корпусу.' },
    docking_port: { name: 'Стыковочный шлюз', price: 6000000, category: 'Конструкционные модули', visibility: 0, power: 250, capacity: 100, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 60, coloredmetall: 20, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Причальный узел для перегрузки в космосе: серьёзная прибавка к грузовместимости.' },
    transponder: { name: 'Ренегатский транспондер', price: 15000000, category: 'Конструкционные модули', power: 500, crewRequired: 1, visibility: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 10, rudametall: 0, kristall: 40, staarvis: 0 }, combat: { stealth: 3 }, lor: 'Имитирует сигнатуры гражданских бортов: +3 к скрытности в бою — радарам врага труднее взять корабль на захват.' },
    sidis_defense: { name: 'Сидисский комплекс активной защиты', price: 30000000, category: 'Конструкционные модули', power: 500, crewRequired: 10, visibility: 100, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 30, coloredmetall: 30, rudametall: 0, kristall: 20, staarvis: 0 }, combat: { pd: 0.35 }, lor: 'КАЗ с радаром управления огнём: сбивает 35% входящих ракет (ПРО суммируется, потолок 60%).' },
    hangar: { name: 'Ангар', price: 25000000, category: 'Конструкционные модули', visibility: 0, power: 1200, capacity: 600, crewRequired: 20, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 120, coloredmetall: 40, rudametall: 0, kristall: 0, staarvis: 0 }, combat: { hangar: 300 }, lor: 'Палубный ангар: каждые 300 очков ангаров дают одно авиакрыло, которое можно поднять прямо в бою.' },
    tocka: { name: 'Лазерная точечная защита', price: 5000000, category: 'Конструкционные модули', visibility: 10, power: 500, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 20, rudametall: 0, kristall: 10, staarvis: 0 }, combat: { pd: 0.25 }, lor: 'Лазерные турели ближнего рубежа: сбивают 25% входящих ракет (ПРО суммируется, потолок 60%).' },

    // --- ИИ ---
      // ai_sofokl: { name: 'Модуль «Софокл» v9.0.3', price: 10000000, category: 'Конструкционные модули', visibility: 0, power: 1800, capacity: 0, crewProvided: 40, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'ИИ, способный справляться с широким спектром задач.' },
    //  ai_kassandra: { name: 'Модуль «Кассандра» v13.0.4', price: 5000000, category: 'Конструкционные модули', visibility: 0, power: 100, capacity: 0, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'ИИ потери телеметрии экипажа.' },
    //  ai_beatrice: { name: 'Защитный модуль «Беатрис» v3.3', price: 15000000, category: 'Конструкционные модули', visibility: 0, power: 1400, shieldBoost: 0.8, capacity: 0, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Модуль позволяет повысить HP корабля.' },
    //  ai_roiental: { name: 'Тактический модуль «Ройенталь» v1.0.3', price: 35000000, category: 'Конструкционные модули', visibility: 0, power: 2500, damageBoost: 0.8, capacity: 0, crewRequired: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 10, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Значительно увеличивает урон вооружения корабля.' },
    //  ai_vitautas: { name: 'Защитный модуль «Витаутас Сердобольный» v8.2.0', price: 40000000, category: 'Конструкционные модули', visibility: 0, protectiveField: 1000, power: 2200, customParameterradar: { dalnost: 0 }, effect: { powerBonus: 0 }, crewRequired: 30, resurs: { blackmetall: 10, coloredmetall: 10, rudametall: 10, t: 0, d: 10, kristall: 10, staarvis: 10 }, lor: 'Увеличивает количество щита на 1000' },

    // --- РЭБ ---
    ew_blackdomain: { name: 'Ретранслятор-заградитель «Черный домен»', price: 20000000, category: 'Модули радиотумана', visibility: 0, power: 600, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 20, rudametall: 0, kristall: 40, staarvis: 0 }, combat: { interdict: 1 }, lor: 'Глушит FTL-каналы: пока носитель жив, противник не может вызывать подкрепления в бой.' },
    ew_graywave: { name: 'Ретранслятор-заградитель «Серая волна»', price: 35000000, category: 'Модули радиотумана', visibility: 0, power: 450, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 20, rudametall: 0, kristall: 60, staarvis: 0 }, combat: { interdict: 1, jam: 2 }, lor: 'Продвинутое заграждение: блокирует подкрепления врага и фонит по радарам (−2 к сенсорам в радиусе 5).' },
    ew_orwell: { name: 'Радио Туман «Оруэл» СРТ-25', price: 20000000, category: 'Модули радиотумана', visibility: 0, power: 500, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 40, rudametall: 0, kristall: 80, staarvis: 0 }, combat: { jam: 5 }, lor: 'Полностью давит астрогацию и наведение: −5 к сенсорам врага в радиусе 5 гексов. Нейтрализуется «Аркадием С.».' },
    ew_bradbury: { name: 'Радио Туман «Брэдбери» РБТ-20', price: 22000000, category: 'Модули радиотумана', visibility: 0, power: 400, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 20, rudametall: 0, kristall: 60, staarvis: 0 }, combat: { jam: 4 }, lor: 'Давит системы наблюдения: −4 к сенсорам врага в радиусе 5 гексов.' },
    ew_arcady: { name: 'Радио Туман «Аркадий С.» РТС-30', price: 24000000, category: 'Модули радиотумана', visibility: 0, power: 500, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 40, rudametall: 0, kristall: 60, staarvis: 0 }, combat: { dejam: 5 }, lor: 'Контр-РЭБ: вычищает до 5 единиц вражеских помех со своих кораблей в радиусе 5 — «Оруэл» нейтрализуется полностью.' },
    ew_boris: { name: 'Радио Туман «Борис С.» ССК-35', price: 21000000, category: 'Модули радиотумана', visibility: 0, power: 600, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 20, rudametall: 0, kristall: 40, staarvis: 0 }, combat: { dejam: 2 }, lor: 'Связной комплекс: держит союзный канал сквозь помехи — снимает до 2 единиц вражеского глушения со своих в радиусе 5.' },
    ew_asimov: { name: 'Радио Туман «Азимов» СРТ-40', price: 25000000, category: 'Модули радиотумана', visibility: 0, power: 600, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 40, rudametall: 0, kristall: 80, staarvis: 0 }, combat: { jam: 3, sensor: 2 }, lor: 'Радио туманное око: глушит врага (−3 к сенсорам в радиусе 5) и само видит сквозь туман (+2 к радару носителя).' },
    ew_starker: { name: 'Штурмовой заградитель «Штаркерштат»', price: 50000000, category: 'Модули радиотумана', visibility: 0, power: 1500, capacity: 0, crewRequired: 10, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 40, coloredmetall: 60, rudametall: 0, kristall: 100, staarvis: 10 }, combat: { interdict: 1, jam: 3 }, lor: 'Агрессивная интердикция: враг не может вызывать подкрепления, плюс −3 к его сенсорам в радиусе 5.' },
    ew_altaan: { name: 'Стабилизационное поле «Альтаан»', price: 55000000, category: 'Модули радиотумана', visibility: 0, power: 900, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 40, coloredmetall: 40, rudametall: 0, kristall: 100, staarvis: 10 }, combat: { stabil: 1 }, lor: 'Стабилизационное поле: пока носитель жив, интердикция врага не действует — свои подкрепления приходят сквозь заграждение.' },
    ew_heinlein: { name: 'Радио Туман «Хайнлайн» СРТ-45', price: 26000000, category: 'Модули радиотумана', visibility: 0, power: 700, capacity: 0, crewRequired: 5, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 20, coloredmetall: 40, rudametall: 0, kristall: 80, staarvis: 0 }, combat: { sensor: 4 }, lor: 'Разведка сквозь радиотуман: +4 к дальности захвата радара носителя.' },

    // --- СТАНЦИИ ---
    st_astartek: { name: 'Цеха астартек', price: 50000000, category: 'Модули станции', visibility: 0, power: 1500, capacity: 0, crewRequired: 300, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Позволяет производить гиперкрейсера.' },
    st_kolomor: { name: 'Коломоркорветзавод', price: 30000000, category: 'Модули станции', visibility: 0, power: 1000, capacity: 0, crewRequired: 300, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Для массового производства корветов.' },
    st_docks: { name: 'Доки', price: 500000000, category: 'Модули станции', visibility: 0, power: 4000, capacity: 1000, crewRequired: 60, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Приносят 1000 ПП.' },
    st_medbay: { name: 'Медбей', price: 100000000, category: 'Модули станции', visibility: 0, shieldBoost: 0.2, damageBoost: 0.2, hp: 50, power: 5000, capacity: 1000, crewRequired: 60, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Повышает выживаемость станции.' },
    st_habitat: { name: 'Среда обитания', price: 300000000, category: 'Модули станции', visibility: 0, power: 15000, capacity: 0, crewRequired: 100, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Приносит 50 млн гелионов.' },
    st_trade: { name: 'Торговый отсек', price: 10000000, category: 'Модули станции', visibility: 0, power: 10000, capacity: 0, crewRequired: 40, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Краеугольный камень экономики Элизиума.' },
    st_lancer: { name: 'ПП лансер Х-54', price: 10000000000, category: 'Модули станции', visibility: 0, power: 10000, capacity: 0, crewRequired: 100, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, lor: 'Супероружие подпространственного типа.' }
};

//*-------------------------------------------------------------------------*//
//////////// 2. РАСПРЕДЕЛЕНИЕ ПО КЛАССАМ (Тут только ID ссылок) ////////////
//*-------------------------------------------------------------------------*//

const modules_ids = {
    peh: ['empty'],
    btr: ['empty', 'crew_extra', 'desantnik', 'drone_cargo'],
    tanki: ['empty', 'crew_extra', 'drone_cargo'],
    arta: ['empty', 'crew_extra'],
    aviacia: ['empty', 'crew_extra', 'desantnik', 'drone_cargo'],
    vertihui: ['empty', 'crew_extra', 'desantnik', 'drone_cargo'],
    dron: ['empty'],
    dronkos: ['empty'],
    mla: ['empty', 'crew_extra'],
    corvette: [
        'empty','ftl_ramon', 'living_module', 'docking_port', 'transponder', 'sidis_defense',
        'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov',
        'cargo_support', 'crew_extra', 'desantnik', 'btr_platform', 'tank_platform', 'arta_platform', 'drone_cargo', 'atmo_aviation', 'heli_platform'
    ],
    destroyer: [
        'empty','ftl_ramon', 'living_module', 'docking_port', 'transponder', 'sidis_defense', 'tocka',
        'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov',
        'cargo_support', 'crew_extra', 'desantnik', 'btr_platform', 'tank_platform', 'arta_platform', 'drone_cargo', 'atmo_aviation', 'heli_platform'
    ],
    supportCarrier: [
        'empty','ftl_ramon', 'living_module', 'docking_port', 'hangar', 'transponder', 'sidis_defense', 'tocka',
        'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov',
        'cargo_support', 'crew_extra', 'desantnik', 'btr_platform', 'tank_platform', 'arta_platform', 'drone_cargo', 'atmo_aviation', 'heli_platform'
    ],
    mediumCruiser: [
        'empty','ftl_ramon', 'living_module', 'docking_port', 'transponder', 'sidis_defense', 'tocka',
        'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov', 'ew_heinlein',
        'cargo_support', 'crew_extra', 'desantnik', 'btr_platform', 'tank_platform', 'arta_platform', 'drone_cargo', 'atmo_aviation', 'heli_platform'
    ],
    hyperCruiser: [
        'empty','living_module', 'docking_port', 'transponder', 'sidis_defense', 'tocka',
        'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov', 'ew_heinlein',
        'cargo_support', 'crew_extra', 'desantnik', 'btr_platform', 'tank_platform', 'arta_platform', 'drone_cargo', 'atmo_aviation', 'heli_platform'
    ],
    multiroleCarrier: [
        'empty','ftl_ramon', 'living_module', 'docking_port', 'hangar', 'transponder', 'sidis_defense', 'tocka',
        'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov', 'ew_heinlein',
        'cargo_support', 'crew_extra', 'desantnik', 'btr_platform', 'tank_platform', 'arta_platform', 'drone_cargo', 'atmo_aviation', 'heli_platform'
    ],
    battleship: [
        'empty','ftl_ramon', 'living_module', 'docking_port', 'hangar', 'transponder', 'sidis_defense', 'tocka',
        'ew_blackdomain', 'ew_graywave', 'ew_starker', 'ew_altaan', 'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov', 'ew_heinlein',
        'cargo_support', 'crew_extra', 'desantnik', 'btr_platform', 'tank_platform', 'arta_platform', 'drone_cargo', 'atmo_aviation', 'heli_platform'
    ],
    dreadnought: [
        'empty','ftl_ramon', 'living_module', 'docking_port', 'hangar', 'transponder', 'sidis_defense', 'tocka',
        'ew_blackdomain', 'ew_graywave', 'ew_starker', 'ew_altaan', 'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov', 'ew_heinlein',
        'cargo_support', 'crew_extra'
    ],
    ss13: [
        'empty','st_astartek', 'st_kolomor', 'st_docks', 'st_medbay', 'st_habitat', 'st_trade', 'st_lancer', 'tocka',
        'living_module', 'hangar', 'transponder', 'sidis_defense',
        'ew_blackdomain', 'ew_graywave', 'ew_starker', 'ew_altaan', 'ew_orwell', 'ew_bradbury', 'ew_arcady', 'ew_boris', 'ew_asimov', 'ew_heinlein',
        'crew_extra'
    ]
};

//*-------------------------------------------------------------------------*//
//////////// 3. СБОРЩИК (Генерирует нужный массив сам) ////////////
//*-------------------------------------------------------------------------*//

const modules = {};

Object.keys(modules_ids).forEach(className => {
    modules[className] = modules_ids[className].map(id => {
        // Если модуль не найден, пишем ошибку в консоль, но не ломаем сайт
        if (!modulesLibrary[id]) {
            console.error(`ОШИБКА: Модуль с ID "${id}" не найден в библиотеке! Проверь название.`);
            return modulesLibrary['empty'];
        }
        // Создаем полную копию данных для addModule
        return JSON.parse(JSON.stringify(modulesLibrary[id]));
    });
});

//*--------------------------------------------------------------------------*//
////////////О Р У Д И Я////////////О Р У Д И Я//////////////О Р У Д И Я/////////dronkos
//*--------------------------------------------------------------------------*//

const techCoefficients = {
  // Базовые (Исправил 0 на 1.0, иначе урон будет 0!)
  "нет": 0, // Для заглушек
  "кинетическое": 1.0,
  "электрохимическое": 1.2,
  "рельсотрон": 1.5,
  "лазер": 1.3,

  // Новые из базы
  "плазма": 1.4,
  "ионное": 1.1,
  "твердотельное": 1.2,        // Ракеты
  "электронное подавление": 1.0, // РЭБ (урон наносит БЧ, а не движок)
  "управляемое наведение": 1.3,  // Умные ракеты
  "взрывчатое": 1.0,           // Мины/БЧ
  "антиматериальное": 5.0,     // БЧ с антиматерией
  "электромагнитное": 1.6,     // Сверхтяжелая арта
  "традиционное": 1.0,         // Обычные РСЗО
  "современные технологии": 1.5, // МБР

  // Бонусы
  "земные оружейные мастера": 0.5,
  "вибро": 1.4,
  "гидравлика": 1.3,
  "нанотехнологии": 2.0, // Для катаны
  "гравитационное": 2.5, // Для мины
};

const damageTypeCoefficients = {
  // Твои старые
  "нет": 0,
  "кинетический": 1.1,
  "электрохимическая система": 1.6,
  "взрывной": 3.6,
  "ядерное оружие": 10.5,
  "антимат": 15.5,
  "рельсотрон": 5.5,
  "энергетический": 3.8,
  "импульсный лазер": 1.5,
  "пучковый лазер": 2.0,
  "суперлазер": 5.5,
  "урон дрона": 20.8,
  "урон дрона-камикадзе": 5.0,
  "урон авиации": 10.0,

  // Новые добавленные
  "термический": 4.0,       // Плазма и огнеметы
  "гравитационный": 5.0, // Гравитация ломает всё
  "кумулятивный": 4.5,      // Противотанковые БЧ
  "термобарический": 6.0,   // Объемный взрыв
  "ионный": 0.5,            // Ионки бьют по щитам, малый физ. урон
  "разведка": 0.0           // Дроны-разведчики не наносят урон
};

const classCoefficients = {
  // Пехота и легкое
  "нет": 0,
  "melee": 3.0,     // Ближний бой должен быть опасным
  "grenade": 4.5,   // Граната наносит много урона (разово)
  "пистолет": 0.2,
  "пистолет-пулемет": 0.3,
  "пп": 0.3,               // Добавил, так как в базе есть class: "пп"
  "карабин": 0.8,
  "винтовка": 1.5,
  "автомат": 1.5,          // Добавил синоним для штурмовых винтовок
  "снайперка": 2.5,        // Добавил для "Вдовы"
  "дробовик": 0.6,
  "пулемет": 2.5,
  "тяжелое вооружение": 1.0,
  "гранатомет": 1.2,       // Чуть поднял для РПГ

  // Техника и Арта
  "турель бтр": 1.3,
  "турель": 1.5,
  "турель ПВО": 2.5,
  "бронетанковая пушка": 1.5,
  "танковая пушка": 1.9,
  "авиапушка": 2.0,
  "арторудие": 2.4,
  "гаубица": 2.8,          // Добавил для Мста-С
  "рсу": 3.0,              // Добавил для РСЗО




};

// --- ЕДИНАЯ БАЗА ВСЕГО ОРУЖИЯ (СКЛАД) ---
const weaponLibrary = {

  // --- ПЕХОТА: БЛИЖНИЙ БОЙ И МЕТАТЕЛЬНОЕ ---
      "Виброклинок ВК-4 «Потрошитель»": {
          price: 45000, category: "Ближний бой", crewRequired: 0,
          power: 0,
        visibility: 0,
          capacityPenalty: 0.5, weight: 2, tech: "вибро", damageType: "кинетический", class: "melee",
          customParameter: { kal: "1", dalnost: 0, skorostrelnost: 0, metrika: "0" },
          resurs: { blackmetall: 0.5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
          description: "Армейский нож с генератором высокочастотных колебаний режет керамическую броню и кости как теплое масло."
      },

      "Мономолекулярная катана «Айон»": {
          price: 150000, category: "Ближний бой", crewRequired: 0,
          power: 0,
        visibility: 0,
          capacityPenalty: 1, weight: 3, tech: "нанотехнологии", damageType: "кинетический", class: "melee",
          customParameter: { kal: "1", dalnost: 0, skorostrelnost: 0, metrika: "0" },
          resurs: { blackmetall: 0, coloredmetall: 0.5, rudametall: 0, kristall: 1, staarvis: 0 },
          description: "Лезвие заточено до толщины в одну молекулу."
      },

      "Осколочная граната М-24 «Терранка»": {
          price: 5000, category: "Метательное", crewRequired: 0,
          power: 0,
        visibility: 0,
          capacityPenalty: 0.5, weight: 0.5, tech: "взрывчатое", damageType: "взрывной", class: "grenade",
          customParameter: { kal: "5", dalnost: 1, skorostrelnost: 0, metrika: "0" },
          resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
          description: "Будь мужчиной! Пропусти вперёд гранату и только потом заходи сам!"
      },

      "Плазменная граната «Гуерре»": {
          price: 25000, category: "Метательное", crewRequired: 0,
          power: 0,
        visibility: 0,
          capacityPenalty: 0.5, weight: 0.8, tech: "плазма", damageType: "термический", class: "grenade",
          customParameter: { kal: "5", dalnost: 1, skorostrelnost: 0, metrika: "0" },
          resurs: { blackmetall: 0, coloredmetall: 0.2, rudametall: 0, kristall: 0.5, staarvis: 0 },
          description: "Создает локальный сгусток перегретой плазмы."
      },

      "Гравитационная мина «Воронка»": {
          price: 80000, category: "Метательное", crewRequired: 0,
          power: 0,
        visibility: 0,
          capacityPenalty: 1, weight: 1.5, tech: "гравитационное", damageType: "гравитационный", class: "grenade",
          customParameter: { kal: "5", dalnost: 1, skorostrelnost: 0, metrika: "0" },
          resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
          description: "Генерирует микро-гравитационную тень, которая стягивает врагов в одну точку и размалывает их давлением. Запрещена тремя конвенциями."
      },


    // --- СЛУЖЕБНОЕ ---
    "Нет выбранного вооружения": {
        price: 0, visibility: 0, category: "Демонстрационное вооружение", crewRequired: 0, power: 0, capacityPenalty: 0, damage: 0,
        customParameter: { kal: "0", dalnost: 0, skorostrelnost: 0, metrika: "0/0" },
        resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Нет выбранного вооружения."
    },

    // --- ПЕХОТНОЕ ВООРУЖЕНИЕ ---
    "9-мм пистолет Дистрила А100 «Астра»": {
        price: 50000, visibility: 0, category: "Пистолет", crewRequired: 0, power: 0, capacityPenalty: 1.5, weight: 150, damage: 5, tech: "кинетическое", damageType: "кинетический", class: "пистолет",
        customParameter: { kal: "9 мм", dalnost: 2, skorostrelnost: 30, metrika: "8" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Самозарядный пистолет, разработанный известным конструктором штурмовых винтовок - многоуважаемым господином Дистрилом."
    },

    "Пистолет-пулемёт No.51 «Сатаст»": {
        price: 300000, visibility: 0, category: "Основное оружие", crewRequired: 0, power: 0, capacityPenalty: 3.5, weight: 350, damage: 120, tech: "кинетическое", damageType: "кинетический", class: "пистолет-пулемет",
        customParameter: { kal: "15 мм", dalnost: 2, skorostrelnost: 1200, metrika: "20" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Автоматический карабин с коротким стволом. Хотя у него более низкие показатели по дальности и точности, чем у винтовок, это компенсируется компактностью, низкой стоимостью и высокой скорострельностью."
    },

    "Карабин «Арей»": {
        price: 180000, visibility: 0, category: "Основное оружие", crewRequired: 0, power: 0, capacityPenalty: 3.8, weight: 380, damage: 60, tech: "кинетическое", damageType: "кинетический", class: "карабин",
        customParameter: { kal: "6.16 мм", dalnost: 3, skorostrelnost: 600, metrika: "30" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Карабин с удлинённым стволом, который часто встречается в мегаполисах среди синдикатов или в руках боевых групп на кораблях."
    },

    "Штурмовая винтовка Дистрила АД-60": {
        price: 400000, visibility: 0, category: "Основное оружие", crewRequired: 0, power: 0, capacityPenalty: 4.3, weight: 4300, damage: 85, tech: "кинетическое", damageType: "кинетический", class: "винтовка",
        customParameter: { kal: "7.62 мм", dalnost: 5, skorostrelnost: 700, metrika: "32" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Кто-то называет эту штурмовую винтовку лучшей подругой наемников."
    },

    "Помповое ружье «Гефест»": {
        price: 500000, visibility: 0, category: "Дробовик", crewRequired: 0, power: 0, capacityPenalty: 3.5, weight: 350, damage: 90, tech: "кинетическое", damageType: "кинетический", class: "дробовик",
        customParameter: { kal: "12 мм", dalnost: 1, skorostrelnost: 60, metrika: "6" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Ничто не сравнится с характерным звуком работающего помпового ружья. Эта конфигурация безнадежно устарела, но не теряет популярности."
    },

    "Ручной пулемет «Ребрик»": {
        price: 1000000, visibility: 0, category: "Пулемет", crewRequired: 0, power: 0, capacityPenalty: 10, weight: 1000, damage: 300, tech: "кинетическое", damageType: "кинетический", class: "пулемет",
        customParameter: { kal: "7.62 мм", dalnost: 4, skorostrelnost: 800, metrika: "8,5/6,3" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Легкий и мобильный пулемет, предназначенный для поддержки пехоты."
    },

    "Станковый пулемет «Текарус»": {
        price: 2000000, visibility: 0, category: "Тяжелое вооружение", crewRequired: 0, power: 0, capacityPenalty: 35, weight: 3500, damage: 400, tech: "кинетическое", damageType: "кинетический", class: "пулемет",
        customParameter: { kal: "12.7 мм", dalnost: 4, skorostrelnost: 500, metrika: "10,0/7,5" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Тяжелый пулемет с высокой скорострельностью, эффективен против легкобронированных целей и пехоты на средних дистанциях."
    },

    "Противотанковая винтовка «Клин»": {
        price: 2500000, visibility: 0, category: "Тяжелое вооружение", crewRequired: 0, power: 0, capacityPenalty: 20, weight: 2000, damage: 0, tech: "кинетическое", damageType: "кинетический", class: "тяжелое вооружение",
        customParameter: { kal: "22 мм", dalnost: 5, skorostrelnost: 30, metrika: "12,0/8,0" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Мощная винтовка, способная пробивать броню легких и средних танков."
    },

    "РПГ Mk.IV «Каратель»": {
        price: 4500000, visibility: 0, category: "Тяжелое вооружение", crewRequired: 0, power: 0, capacityPenalty: 6.5, damage: 900, tech: "электрохимическое", damageType: "взрывной", class: "гранатомет",
        customParameter: { kal: "28 мм", dalnost: 5, skorostrelnost: 15, metrika: "18,0/12,0" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Компактный противотанковый гранатомет с ручной перезарядкой. Простой в использовании и надежный в бою."
    },

    "Многозарядный гранатомет «Викли»": {
        price: 3000000, visibility: 0, category: "Тяжелое вооружение", crewRequired: 0, power: 0, capacityPenalty: 5.9, damage: 700, tech: "электрохимическое", damageType: "взрывной", class: "гранатомет",
        customParameter: { kal: "35 мм", dalnost: 3, skorostrelnost: 45, metrika: "16,0/11,0" }, // Исправил опечатку в skorostrelnost
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Многоразовый гранатомет с барабанным магазином, способный вести скорострельный огонь по группам целей."
    },

    "Плазменный огнемёт АО-10 «Неугасаемый»": {
        price: 3500000, visibility: 0, category: "Тяжелое вооружение", crewRequired: 0, power: 0, capacityPenalty: 18, damage: 0, tech: "лазер", damageType: "взрывной", class: "гранатомет",
        customParameter: { kal: "20 мм", dalnost: 2, skorostrelnost: 20, metrika: "20,0/15,0" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Хотя эта технология крайне непопулярна в космосе, ей все еще удается удерживать свою нишу в колониальных войнах."
    },

    "Переносной ЗРК No.12 «Вемона»": {
        price: 5000000, visibility: 0, category: "Тяжелое вооружение", crewRequired: 0, power: 0, capacityPenalty: 17, damage: 1800, tech: "лазер", damageType: "взрывной", class: "тяжелое вооружение",
        customParameter: { kal: "45 мм", dalnost: 6, skorostrelnost: 5, metrika: "22,0/18,0" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Переносной зенитный ракетный комплекс с высокой мобильностью. Предназначен для поражения низколетящих воздушных целей и легкобронированных объектов."
    },

    // --- ВООРУЖЕНИЕ БТР ---
        "25-мм автоматическая пушка АК-30М «Азазан»": {
            price: 1500000, visibility: 0, category: "Турель БТР", crewRequired: 10,
            power: 10, // Электроника башни
            capacityPenalty: 10, weight: 7000, damage: 0, tech: "электрохимическое", damageType: "кинетический", class: "турель бтр",
            customParameter: { kal: "25", dalnost: 5, skorostrelnost: 1800, metrika: "20,0/15,0" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
            description: "АК-30М расшифровывается как «автоматическая короткоствольная», калибра 30 мм, а «М», соответственно, — модификация. Однако в секторе больше распространено название БМАП-БТР — боевой модуль автоматической пушки для бронетранспортёров. Или просто — «Азазан». При калибре 30-мм имеет дальность стрельбы до 5 АсК и скорострельность 300 выстрелов за ход."
        },

        "30-мм электрохимическое орудие «Центара» ЭХО-30": {
            price: 1900000, visibility: 0, category: "Турель БТР", crewRequired: 1,
            power: 30, // ЭХО требует заряд для инициации
            capacityPenalty: 20, damage: 0, weight: 500, tech: "электрохимическое", damageType: "электрохимическая система", class: "турель бтр",
            customParameter: { kal: "30 мм", dalnost: 6, skorostrelnost: 300, metrika: "25,0/18,0" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 3, kristall: 0, staarvis: 0 },
            description: "ЭХО-30М использует гибридную технологию. Электрический ток инициирует сгорание химического вещества, обеспечивая равномерное расширение газов и ускорение снаряда."
        },

        "70-мм электрохимическое орудие «Двина» ЭХО-70": {
            price: 4500000, visibility: 0, category: "Бронетанковая пушка", crewRequired: 1,
            power: 50, // Более мощное ЭХО требует больше энергии
            capacityPenalty: 40, damage: 0, weight: 2000, tech: "электрохимическое", damageType: "взрывной", class: "турель бтр",
            customParameter: { kal: "70 мм", dalnost: 10, skorostrelnost: 90, metrika: "25,0/18,0" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 3, kristall: 0, staarvis: 0 },
            description: "ЭХО-70 – орудие на основе технологии ЭХС, разработанное для тех, кому 30 мм показались недостаточно убедительными. Орудие отличается увеличенной дальностью, но требует значительного места."
        },

        "100-мм рельсотронное орудие «АРКОН-100»": {
            price: 38000000, visibility: 0, category: "Бронетанковая пушка", crewRequired: 1,
            power: 400, // Рельсотрон жрет много энергии
            capacityPenalty: 50, damage: 0, weight: 3000, tech: "рельсотрон", damageType: "рельсотрон", class: "бронетанковая пушка",
            customParameter: { kal: "100 мм", dalnost: 8, skorostrelnost: 20, metrika: "40,0/30,0" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
            description: "Мощное 100-мм рельсотронное орудие с высокой дальностью и хорошим уроном. АРКОН-100 расшифровывается как армейское рельсовое компактное орудие наземное."
        },

        "Лазерное орудие «ЛУКС VI»": {
            price: 4000000, visibility: 0, category: "Турель БТР", crewRequired: 1,
            power: 200, // Лазер
            capacityPenalty: 25, damage: 0, weight: 2500, tech: "лазер", damageType: "энергетический", class: "бронетанковая пушка",
            customParameter: { kal: "20 мм", dalnost: 6, skorostrelnost: 20, metrika: "18,0/12,0" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
            description: "ЛУКС (лазерная ударная когерентная система). Среди военных чаще шутливо именуется «Лучеславом». Типичное лазерное орудие с высоким энергопотреблением."
        },

        "Зенитная ракета «Гало»": {
        price: 5000000, visibility: 10, category: "РПУ", crewRequired: 0,
        power: 10,
        capacityPenalty: 15, damage: 0, weight: 500, tech: "кинетическое", damageType: "взрывной", class: "рпу",
        customParameter: { kal: "60 мм", dalnost: 4, skorostrelnost: 6, metrika: "20,0/15,0" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Компактная ракета на базе однозарядной пусковой установки. Оснащается радиолокационной головкой самонаведения для поражения воздушных целей."
    },

      "Барражирующая ракета «Коготь»": {
            price: 6000000, visibility: 0, category: "РПУ", crewRequired: 0,
            power: 15, // Запуск и управление
            capacityPenalty: 70, damage: 0, weight: 700, tech: "кинетическое", damageType: "взрывной", class: "рпу",
            customParameter: { kal: "400 мм", dalnost: 5, skorostrelnost: 3, metrika: "22,0/18,0" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
            description: "Два барражирующих боеприпаса «Коготь», интегрируемых в контейнеры на каждом из бортов бронетехники."
        },

        // --- ТАНКОВОЕ ВООРУЖЕНИЕ ---
            "6-мм 8-ствольный пулемет АК-6М «Гремлин»": {
                price: 1200000, visibility: 0, category: "Турель танка", crewRequired: 0,
                power: 100, // Гатлинг крутится быстро
                capacityPenalty: 2.5, damage: 0, weight: 180, tech: "электрохимическое", damageType: "кинетический", class: "турель",
                customParameter: { kal: "40 мм", dalnost: 3, skorostrelnost: 6000, metrika: "10,0/8,0" },
                resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "АК-6М «Гремлин». Этот 8-ствольный пулемет обладает невероятной скорострельностью, достигающей 6000 выстрелов за ход, и используется для подавления пехоты и легкобронированных целей."
            },

            "12-мм спаренный пулемёт АК-12М «Громобой»": {
                price: 800000, visibility: 0, category: "Турель танка", crewRequired: 0,
                power: 50, // Электроприводы
                capacityPenalty: 5, damage: 0, weight: 150, tech: "электрохимическое", damageType: "кинетический", class: "турель",
                customParameter: { kal: "24 мм", dalnost: 4, skorostrelnost: 2400, metrika: "15,0/10,0" },
                resurs: { blackmetall: 0.5, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "АК-12М «Громобой». Спаренный пулемёт с высокой скорострельностью, подходящий для борьбы с пехотой и легкобронированными целями."
            },

            "15-мм автоматическая пушка АК-15Т «Иззар»": {
                price: 1200000, visibility: 0, category: "Турель БТР", crewRequired: 0,
                power: 60,
                capacityPenalty: 5.5, damage: 0, weight: 150, tech: "электрохимическое", damageType: "кинетический", class: "турель бтр",
                customParameter: { kal: "15 мм", dalnost: 4, skorostrelnost: 2000, metrika: "18,0/12,0" },
                resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "АК-15Т «Иззар» — это 15-мм автоматическая короткоствольная пушка, предназначенная для установки на танковые платформы."
            },

            "Гранатомет Мк.V «Защитник»": {
                price: 7500000, visibility: 0, category: "Тяжелое вооружение", crewRequired: 0,
                power: 10,
                capacityPenalty: 8.0, damage: 1200, tech: "электрохимическое", damageType: "взрывной", class: "танковая пушка",
                customParameter: { kal: "40 мм", dalnost: 10, skorostrelnost: 10, metrika: "22,0/15,0" },
                resurs: { blackmetall: 2, coloredmetall: 1, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "Гранатомет для танков, предназначенный для поражения укрепленных целей и огневых точек противника."
            },

            "120-мм электрохимическое орудие «Никея» ЭХО-120М": {
                price: 9500000, visibility: 0, category: "Бронетанковая пушка", crewRequired: 0,
                power: 100, // Мощное ЭХО
                capacityPenalty: 100, damage: 0, weight: 7000, tech: "электрохимическое", damageType: "электрохимическая система", class: "танковая пушка",
                customParameter: { kal: "152 мм", dalnost: 18, skorostrelnost: 30, metrika: "30,0/22,0" },
                resurs: { blackmetall: 2, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "ЭХО-120М (Модернизированное) является мощным оружием, предназначенным для установки на основные боевые танки колониальных правительств сектора."
            },

            "130-мм рельсотронное орудие «АРКОН-130»": {
                price: 38000000, visibility: 0, category: "Бронетанковая пушка", crewRequired: 1,
                power: 600, // Рельса требует много
                capacityPenalty: 120, damage: 0, weight: 3000, tech: "рельсотрон", damageType: "рельсотрон", class: "танковая пушка",
                customParameter: { kal: "130 мм", dalnost: 8, skorostrelnost: 5, metrika: "5" },
                resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "Мощное 130-мм рельсотронное орудие с высокой дальностью и хорошим уроном. Официальное название АРКОН-160 (в описании у тебя 160, хотя в названии 130 - оставил как в оригинале)."
            },

            "Лазерное орудие «ЛУКС X»": {
                price: 6000000, visibility: 0, category: "Турель БТР", crewRequired: 0,
                power: 300, // Лазер
                capacityPenalty: 35, damage: 0, weight: 3500, tech: "лазер", damageType: "энергетический", class: "танковая пушка",
                customParameter: { kal: "40 мм", dalnost: 6, skorostrelnost: 20, metrika: "18,0/12,0" },
                resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "Лазерная ударная когерентная система поколения Х - танковая модификация всеми любимого «Лучеслава»."
            },

            // --- АРТИЛЛЕРИЯ (САУ и РСЗО) ---
    "30-мм электрохимическое орудие «Центара» ЭХО-30М": {
        price: 1900000, visibility: 0, category: "Турель БТР", crewRequired: 1,
        power: 30, // ЭХО требует импульс
        capacityPenalty: 20, damage: 0, weight: 500, tech: "электрохимическое", damageType: "электрохимическая система", class: "турель",
        customParameter: { kal: "30 мм", dalnost: 6, skorostrelnost: 300, metrika: "25,0/18,0" },
        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 3, kristall: 0, staarvis: 0 },
        description: "ЭХО-30М (Модернизированное). Использует гибридную технологию, сочетающую электрическую и химическую энергию для запуска снаряда."
    },

    "152-мм электрохимическое орудие «Психея» ЭХО-152М": {
        price: 9500000, visibility: 0, category: "Бронетанковая пушка", crewRequired: 1,
        power: 120, // Крупный калибр ЭХО
        capacityPenalty: 100, damage: 0, weight: 7000, tech: "электрохимическое", damageType: "электрохимическая система", class: "арторудие",
        customParameter: { kal: "152 мм", dalnost: 18, skorostrelnost: 30, metrika: "30,0/22,0" },
        resurs: { blackmetall: 2, coloredmetall: 1, rudametall: 4, kristall: 0, staarvis: 0 },
        description: "ЭХО-152М (Модернизированное) является мощным оружием, предназначенным для установки на САУ колониальных правительств сектора."
    },

    "300-мм электромагнитное орудие «Озалия» ЭХО-300М": {
        price: 17500000, visibility: 0, category: "Сверхтяжелая артиллерия", crewRequired: 1,
        power: 800, // Электромагнитный разгон (Гаусс/Рельса) требует уйму энергии
        capacityPenalty: 150, damage: 0, weight: 15000, tech: "электромагнитное", damageType: "электрохимическая система", class: "арторудие",
        customParameter: { kal: "300 мм", dalnost: 25, skorostrelnost: 15, metrika: "40,0/30,0" },
        resurs: { blackmetall: 4, coloredmetall: 2, rudametall: 6, kristall: 0, staarvis: 0 },
        description: "ЭХО-300М — это мощная сверхтяжелая артиллерийская система, созданная для... радикального решения вопросов."
    },

    "24х76 система залпового огня «Марс»": {
        price: 7500000, visibility: 0, category: "АПУ", crewRequired: 0,
        power: 15, // Электроника наведения
        capacityPenalty: 55, damage: 0, weight: 800, tech: "традиционное", damageType: "взрывной", class: "арторудие",
        customParameter: { kal: "76 мм", dalnost: 12, skorostrelnost: 24, metrika: "30,0/20,0" },
        resurs: { blackmetall: 2, coloredmetall: 1, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Система залпового огня «Марс». Ракета вращается при выходе из пусковой установки, использует двухантенный широкополосный радар для наведения."
    },

    "Пятизарядная пусковая установка «Гермес»": {
        price: 7500000, visibility: 0, category: "АПУ", crewRequired: 0,
        power: 20, // СУО
        capacityPenalty: 95, damage: 0, weight: 1200, tech: "традиционное", damageType: "взрывной", class: "арторудие",
        customParameter: { kal: "250 мм", dalnost: 12, skorostrelnost: 5, metrika: "30,0/20,0" },
        resurs: { blackmetall: 2, coloredmetall: 1, rudametall: 0, kristall: 0, staarvis: 0 },
        description: "Современная пусковая установка для тяжелых 250 мм ракет с полуактивным радарным наведением."
    },

    "Пусковая установка МБР «Титан»": {
        price: 12000000, visibility: 0, category: "АПУ", crewRequired: 0,
        power: 50, // Гидравлика подъема и предстартовая подготовка
        capacityPenalty: 150, damage: 0, weight: 1800, tech: "современные технологии", damageType: "ядерное оружие", class: "арторудие",
        customParameter: { kal: "350 мм", dalnost: 15, skorostrelnost: 1, metrika: "50,0/30,0" },
        resurs: { blackmetall: 3, coloredmetall: 2, rudametall: 1, kristall: 0, staarvis: 0 },
        description: "Мобильная пусковая установка для межконтинентальных баллистических ракет. Используется для уничтожения крупных целей на стратегическом уровне."
    },

    // --- АВИАЦИЯ ---
        "35-мм электрохимическое орудие «Гарпия» ЭХО-35А": {
            price: 2500000, visibility: 10, category: "Авиационная турель", crewRequired: 0,
            power: 40, // ЭХО
            capacityPenalty: 25, damage: 0, weight: 600, tech: "электрохимическое", damageType: "электрохимическая система", class: "авиапушка",
            customParameter: { kal: "35 мм", dalnost: 8, skorostrelnost: 350, metrika: "28,0/20,0" },
            resurs: { blackmetall: 1, coloredmetall: 1, rudametall: 4, kristall: 0, staarvis: 0 },
            description: "ЭХО-35А использует передовую электрохимическую технологию, которая обеспечивает оптимальное соотношение массы и мощности для авиации."
        },

        "Неуправляемая ракета «Фотоид»": {
            price: 3000000, visibility: 0, category: "Ракеты", crewRequired: 0,
            power: 5, // Питание пилонов
            capacityPenalty: 50, damage: 0, weight: 120, tech: "твердотельное", damageType: "взрывной", class: "ракета",
            customParameter: { kal: "80 мм", dalnost: 20, skorostrelnost: 0, metrika: "4.5" },
            resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 10 },
            description: "Неуправляемая ракета с улучшенной дальностью и скоростью. Использует твердотельный двигатель для повышения дальности и точности."
        },

        "РГЧ «Феникс»": {
            price: 15000000,  visibility: 10, category: "Ракеты", crewRequired: 0,
            power: 10, // Авионика
            capacityPenalty: 35, damage: 5, weight: 250, tech: "твердотельное", damageType: "взрывной", class: "ракета",
            customParameter: { kal: "45 мм", dalnost: 15, skorostrelnost: 0, metrika: "2.5" },
            resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 10 },
            description: "Ракета средней дальности с улучшенной точностью и увеличенной мощностью. Применяется для уничтожения вражеских средств ПВО и командных пунктов."
        },

        "Противорадиолокационная ракета ПРК-1 «Страж»": {
            price: 6500000, visibility: 10, category: "Ракеты", crewRequired: 0,
            power: 25, // Системы РЭБ требуют энергии
            capacityPenalty: 45, damage: 10, weight: 180, tech: "электронное подавление", damageType: "взрывной", class: "ракета",
            customParameter: { kal: "80 мм", dalnost: 30, skorostrelnost: 0, metrika: "0" },
            resurs: { blackmetall: 30, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 50 },
            description: "Противорадиолокационная ракета с высокоэффективной системой нейтрализации вражеских РЛС. Используется для подавления ПВО и засечек."
        },

        "Управляемая ракета УР-4 «Нови-Сад»": {
            price: 14000000, category: "Ракеты", crewRequired: 0,
            power: 20, // Головка самонаведения
            capacityPenalty: 60, damage: 15, weight: 300, tech: "управляемое наведение", damageType: "взрывной", class: "ракета",
            customParameter: { kal: "90 мм", dalnost: 30, skorostrelnost: 0, metrika: "5.5" },
            resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 },
            description: "Управляемая ракета дальнего действия с высокой точностью, предназначенная для поражения движущихся и стационарных целей на больших дистанциях."
        },
        // --- ВЕРТОЛЕТЫ ---
            "12,5-мм автоматическая турель ВКТ-125 «Шершень»": {
                price: 1200000, visibility: 10, category: "Турель вертолета", crewRequired: 1,
                power: 8, // Электроприводы турели
                capacityPenalty: 0, damage: 0, weight: 150, tech: "электрохимическое", damageType: "кинетический", class: "авиапушка",
                customParameter: { kal: "12,5 мм", dalnost: 4, skorostrelnost: 2200, metrika: "18,0/12,0" },
                resurs: { blackmetall: 1, coloredmetall: 1, rudametall: 0, kristall: 0, staarvis: 0 },
                description: "Автоматическая турель для вертолётов ближнего боя. Оснащена системой стабилизации, эффективна против пехоты и дронов."
            },

            "45-мм электрохимическое орудие «Шторм» ЭХО-45В": {
                price: 3200000,  visibility: 50, category: "Авиационная турель", crewRequired: 0,
                power: 50, // ЭХО требует энергии
                capacityPenalty: 30, damage: 0, weight: 750, tech: "электрохимическое", damageType: "электрохимическая система", class: "авиапушка",
                customParameter: { kal: "45 мм", dalnost: 10, skorostrelnost: 300, metrika: "35,0/25,0" },
                resurs: { blackmetall: 2, coloredmetall: 2, rudametall: 6, kristall: 1, staarvis: 0 },
                description: "ЭХО-45В (Воздушное) является усовершенствованной версией авиационного электрохимического вооружения для поражения целей на средней дистанции."
            },

            "50-мм авиационная электрохимическая пушка «Квиты» ЭХО-50": {
                price: 3200000,  visibility: 50, category: "Курсовое орудие", crewRequired: 0,
                power: 60, // Мощное ЭХО
                capacityPenalty: 20, damage: 0, weight: 1500, tech: "электрохимическое", damageType: "электрохимическая система", class: "авиапушка",
                customParameter: { kal: "50 мм", dalnost: 8, skorostrelnost: 120, metrika: "18,0/12,0" },
                resurs: { blackmetall: 0.7, coloredmetall: 0.3, rudametall: 2.5, kristall: 0, staarvis: 0 },
                description: "ЭХО-50 «Квиты» – легкая, но мощная пушка. Уменьшенный калибр и вес обеспечивают высокую мобильность и минимальное влияние на грузоподъемность."
            },

            // --- ДРОНЫ И БОЕПРИПАСЫ ---
                "Осколочно-фугасная мина МБ-15": {
                    price: 120000,  visibility: 0, category: "Боеприпасы", crewRequired: 0,
                    power: 0,
                    capacityPenalty: 3, damage: 0, weight: 8, tech: "взрывчатое", damageType: "взрывной", class: "рпу",
                    customParameter: { kal: "40 мм", dalnost: 1, skorostrelnost: 0, metrika: "0,8/1,2" },
                    resurs: { blackmetall: 0.15, coloredmetall: 0.2, rudametall: 0.3, kristall: 0, staarvis: 0 },
                    description: "МБ-15 – компактная высокоточная бомба с осколочно-фугасным зарядом для сброса на силы противника."
                },

                "Блок боевой части БЧ-15К": {
                    price: 400000, visibility: 0, category: "Боевые части", crewRequired: 0,
                    power: 0,
                    capacityPenalty: 5, damage: 0, weight: 15, tech: "взрывчатое", damageType: "взрывной", class: "рпу",
                    customParameter: { kal: "15 кг", dalnost: 0, skorostrelnost: 0, metrika: "2,0/1,5" },
                    resurs: { blackmetall: 0.3, coloredmetall: 0.5, rudametall: 0.8, kristall: 0, staarvis: 0 },
                    description: "БЧ-15К – унифицированный блок боевой части для дронов-камикадзе. Эффективно поражает бронированные и небронированные цели."
                },

                "Тандемная боевая часть БЧ-20Т": {
                    price: 600000, visibility: 0, category: "Боевые части", crewRequired: 0,
                    power: 0,
                    capacityPenalty: 7, damage: 0, weight: 20, tech: "взрывчатое", damageType: "кумулятивный", class: "рпуе",
                    customParameter: { kal: "20 кг", dalnost: 0, skorostrelnost: 0, metrika: "2,5/1,8" },
                    resurs: { blackmetall: 0.4, coloredmetall: 0.6, rudametall: 1, kristall: 0, staarvis: 0 },
                    description: "БЧ-20Т – тандемная боевая часть, разработанная для пробития сложных препятствий, включая многослойную броню."
                },

                "Термобарическая боевая часть БЧ-25ТБ": {
                    price: 900000, visibility: 0, category: "Боевые части", crewRequired: 0,
                    power: 0,
                    capacityPenalty: 12, damage: 0, weight: 25, tech: "взрывчатое", damageType: "термобарический", class: "рпу",
                    customParameter: { kal: "25 кг", dalnost: 0, skorostrelnost: 0, metrika: "3,5/2,5" },
                    resurs: { blackmetall: 0.5, coloredmetall: 0.8, rudametall: 1.5, kristall: 0, staarvis: 0 },
                    description: "БЧ-25ТБ – термобарическая боевая часть для поражения живой силы в укрытиях. Создает мощный объемный взрыв."
                },

                "Боевая часть БЧ-АМ1": {
                    price: 100000000, visibility: 0, category: "Боевые части", crewRequired: 0,
                    power: 0,
                    capacityPenalty: 20, damage: 0, weight: 10, tech: "антиматериальное", damageType: "антимат", class: "ракета",
                    customParameter: { kal: "50 мм", dalnost: 0, skorostrelnost: 0, metrika: "10,0/5,0" },
                    resurs: { blackmetall: 1, coloredmetall: 2, rudametall: 5, kristall: 10, staarvis: 5 },
                    description: "БЧ-АМ1 – содержит малый запас антиматерии. Взрыв колоссальной мощности. Не использовать вблизи дружественных объектов."
                },
                // --- КОСМИЧЕСКИЕ ДРОНЫ (DRONKOS) ---
                    "Импульсный лазер Л-5 «Стилет»": {
                        price: 800000, visibility: 0, category: "Энергооружие", crewRequired: 0,
                        power: 15, // Лазер ест энергию
                        capacityPenalty: 2, damage: 0, weight: 80, tech: "лазер", damageType: "энергетический", class: "дрон-пушка",
                        customParameter: { kal: "10 мм", dalnost: 3, skorostrelnost: 120, metrika: "5,0/4,0" },
                        resurs: { blackmetall: 0.5, coloredmetall: 0.5, rudametall: 0, kristall: 1, staarvis: 0 },
                        description: "Л-5 «Стилет» — легкий скорострельный лазер для маневренных дронов. Предназначен для перехвата вражеских ракет и «выжигания» сенсоров крупным кораблям."
                    },

                    "Микро-рельсотрон МР-2 «Игла»": {
                        price: 1500000, visibility: 1, category: "Кинетика", crewRequired: 0,
                        power: 25, // Разгон снаряда
                        capacityPenalty: 4, damage: 0, weight: 120, tech: "рельсотрон", damageType: "рельсотрон", class: "дрон-пушка",
                        customParameter: { kal: "8 мм", dalnost: 5, skorostrelnost: 15, metrika: "8,0/6,0" },
                        resurs: { blackmetall: 1, coloredmetall: 1, rudametall: 0, kristall: 0, staarvis: 0 },
                        description: "Миниатюризированная технология рельсотрона. Разгоняет 8-мм вольфрамовую иглу до колоссальных скоростей. Идеален для пробития обшивки истребителей."
                    },

                  //  "Ионный излучатель «Пульсар-М»": {
                  //      price: 1200000, category: "Энергооружие", crewRequired: 0,
                  //      power: 30,
                  //      capacityPenalty: 3, damage: 0, weight: 100, tech: "ионное", damageType: "ионный", class: "дрон-пушка",
                  //      customParameter: { kal: "N/A", dalnost: 2, skorostrelnost: 40, metrika: "6,0/5,0" },
                  //      resurs: { blackmetall: 0.5, coloredmetall: 1, rudametall: 0, kristall: 2, staarvis: 1 },
                  //      description: "Специализированное оружие для отключения щитов и электроники противника. Сам по себе наносит мало физического урона, но крайне эффективен против энергосистем."
                //    },

                    "Плазменный резак «Оса»": {
                        price: 2000000, visibility: 0, category: "Плазма", crewRequired: 0,
                        power: 40,
                        capacityPenalty: 5, damage: 0, weight: 150, tech: "плазма", damageType: "термический", class: "дрон-пушка",
                        customParameter: { kal: "15 мм", dalnost: 1, skorostrelnost: 10, metrika: "10,0/8,0" },
                        resurs: { blackmetall: 1, coloredmetall: 1, rudametall: 0, kristall: 1, staarvis: 2 },
                        description: "Короткодействующий, но разрушительный плазменный излучатель. Используется штурмовыми дронами для вскрытия обшивки кораблей при абордаже или ближнем бое."
                    },

                    "20-мм роторная автопушка «Шквал»": {
                        price: 900000, visibility: 10, category: "Кинетика", crewRequired: 0,
                        power: 5, // Вращение стволов
                        capacityPenalty: 6, damage: 0, weight: 200, tech: "кинетическое", damageType: "кинетический", class: "дрон-пушка",
                        customParameter: { kal: "20 мм", dalnost: 2, skorostrelnost: 1500, metrika: "12,0/9,0" },
                        resurs: { blackmetall: 2, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                        description: "Модифицированная версия классического гатлинга с системой безгильзовой подачи и радиаторами охлаждения для работы в вакууме."
                    },


                    // --- КОРАБЕЛЬНОЕ ВООРУЖЕНИЕ (КОРВЕТЫ) ---
                        "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»": {
                            price: 8000000, visibility: 10, category: 'ПВО Орудия', crewRequired: 1,
                            power: 100, // Питание башни ПВО
                            capacityPenalty: 0, damage: 0, weight: 500, tech: "электрохимическое", damageType: "электрохимическая система", class: "турель ПВО",
                            customParameter: { kal: "15.6 мм", dalnost: 3, skorostrelnost: 10000, metrika: "10000" },
                            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                            description: "Эрзац-модификация орудийной системы Серкам МтП-40. От изначальной системы осталась только башенная установка и подача снарядов. Отличная ПВО."
                        },

                        "90-мм электрохимическое орудие МтП-40 «Серкам»": {
                            price: 15000000,  visibility: 0, category: "ЭХС Орудия", crewRequired: 5,
                            power: 250, // Мощное ЭХО
                            capacityPenalty: 0, damage: 0, weight: 5000, tech: "электрохимическое", damageType: "электрохимическая система", class: "легкое корабельное орудие",
                            customParameter: { kal: "90 мм", dalnost: 3, skorostrelnost: 90, metrika: "35" },
                            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                            description: "Башенное Универсальное Орудие Серкам МтП-40. Во многих аспектах не уступает аналогам благодаря сбалансированным характеристикам."
                        },

                        "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»": {
                            price: 17000000, visibility: 0, category: "Энерго Орудия", crewRequired: 10,
                            power: 650, // Лазеры жрут энергию
                            capacityPenalty: 0, damage: 0, weight: 40000, tech: "лазер", damageType: "импульсный лазер", class: "среднее корабельное орудие",
                            customParameter: { kal: "40 мм", dalnost: 6, skorostrelnost: 1, metrika: "1000" },
                            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                            description: "Импульсно Лазерное башенное орудие. Высокая популярность в качестве вооружения против энергощитов в эпоху возвышения рельсотронных систем."
                        },
                        // --- КОРАБЕЛЬНОЕ ВООРУЖЕНИЕ (ЭСМИНЦЫ) ---
                            "150-мм электрохимическое орудие «Роджер»": {
                                price: 13000000, visibility: 0, category: "ЭХС Орудия", crewRequired: 5,
                                power: 450, // power -> power
                                capacityPenalty: 0, damage: 0, weight: 10000, tech: "электрохимическое", damageType: "электрохимическая система", class: "среднее корабельное орудие",
                                customParameter: { kal: "150 мм", dalnost: 3, skorostrelnost: 20, metrika: "5" },
                                resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                                description: "Первая специализированная система под космические задачи. Представляет из себя одно 150 мм ЭХС орудие со значительно изменённой системой."
                            },

                            "90-мм рельсотрон ПРВ-30 «Басл»": {
                                price: 20000000, visibility: 0, category: "Рельсотроные Орудия", crewRequired: 5,
                                power: 600, // Рельсотрон жрет много
                                capacityPenalty: 0, damage: 0, weight: 7000, tech: "электрохимическое", damageType: "рельсотрон", class: "среднее корабельное орудие",
                                customParameter: { kal: "90 мм", dalnost: 3, skorostrelnost: 50, metrika: "100" },
                                resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                                description: "Пропульсионное орудие Басл ПРВ-30 — рельсотронная система первых поколений. Крайне громоздкая, но мощная."
                            },

                            "100-мм пучковый лазер ПЛВ-55 «Меглос»": {
                                price: 17000000, visibility: 0, category: "Энерго Орудия", crewRequired: 10,
                                power: 800, // Пучковый лазер
                                capacityPenalty: 0, damage: 0, weight: 40000, tech: "лазер", damageType: "пучковый лазер", class: "среднее корабельное орудие",
                                customParameter: { kal: "100 мм", dalnost: 6, skorostrelnost: 1, metrika: "1000" },
                                resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                                description: "Пучковый лазер с упором на высокую дальность огня. Одно из первых вооружений, созданных в системе Элизиум специально для дальнего боя."
                            },
                            // --- АНГАРЫ И РОИ ДРОНОВ (ДРОНОНОСЦЫ) ---
                                "Рой разведывательныых дронов «Кефир»": {
                                    price: 10000000, visibility: 0, category: "Ангар", crewRequired: 0,
                                    power: 50, // Питание ангара и зарядка
                                    capacityPenalty: 25, damage: 0, weight: 30000, tech: "управляемое наведение", damageType: "разведка", class: "дрон разведывательный",
                                    customParameter: { kal: "0", dalnost: 30, skorostrelnost: 0, metrika: "0" },
                                    resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 },
                                    description: "Стандартный разведывательный дрон. Не несет боевой нагрузки, оснащен комплексом авионики «Горда» для скрытной разведки."
                                },

                                "Рой ударных дронов «Стрелка»": {
                                    price: 25000000, visibility: 0, category: "Ангар", crewRequired: 0,
                                    power: 100, // Питание и ремонт
                                    capacityPenalty: 30, damage: 15, weight: 30000, tech: "управляемое наведение", damageType: "кинетический", class: "дрон ударный",
                                    customParameter: { kal: "6.5 мм", dalnost: 30, skorostrelnost: 2000, metrika: "2000" },
                                    resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 },
                                    description: "Ударные дроны с 6.5-мм ЭХС орудием. Предназначены для стремительных и суицидальных атак на цели противника."
                                },

                                "Рой дронов-камикадзе «Коломорская роза»": {
                                    price: 15000000, visibility: 0, category: "Ангар", crewRequired: 0,
                                    power: 80,
                                    capacityPenalty: 50, damage: 1500, weight: 30000, tech: "управляемое наведение", damageType: "взрывной", class: "дрон ударный",
                                    customParameter: { kal: "100 кг", dalnost: 30, skorostrelnost: 1, metrika: "2000" },
                                    resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 },
                                    description: "Массивные дроны-камикадзе. Сближаются с целью и подрывают камеры с боевой нагрузкой. Оснащены малозаметными ионными двигателями."
                                },
                                // --- КОРАБЕЛЬНОЕ ВООРУЖЕНИЕ (КРЕЙСЕРА) ---
                                    "120-мм рельсотрон ЭКВ-82 «Годдард»": {
                                        price: 14000000, visibility: 0, category: "Рельсотроные Орудия", crewRequired: 10,
                                        power: 500,
                                        capacityPenalty: 0, damage: 0, weight: 15000, tech: "электрохимическое", damageType: "рельсотрон", class: "среднее корабельное орудие",
                                        customParameter: { kal: "120 мм", dalnost: 3, skorostrelnost: 10, metrika: "20" },
                                        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                                        description: "Классический представитель электромагнитных орудий. Создан как ответ на усиление защитных качеств ЭМП полей."
                                    },

                                    "4х350-мм рельсотрон ТБС-100 «Мюллер»": {
                                        price: 30000000, visibility: 0, category: "Рельсотроные Орудия", crewRequired: 15,
                                        power: 850,
                                        capacityPenalty: 0, damage: 0, weight: 90000, tech: "электрохимическое", damageType: "рельсотрон", class: "тяжелое корабельное орудие",
                                        customParameter: { kal: "350 мм", dalnost: 3, skorostrelnost: 8, metrika: "8" },
                                        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                                        description: "Тяжелое башенное орудие класса «поработитель». Спаренная установка из четырёх орудий калибра 350 мм. Самая серьёзная аргументация в споре."
                                    },

                                    "Лазерное орудие ВПЛ-65 «Плага»": {
                                        price: 20000000, visibility: 0, category: "Энерго Орудия", crewRequired: 10,
                                        power: 1000, // Очень мощный лазер
                                        capacityPenalty: 0, damage: 0, weight: 80000, tech: "лазер", damageType: "импульсный лазер", class: "тяжелое корабельное орудие",
                                        customParameter: { kal: "100 мм", dalnost: 6, skorostrelnost: 1, metrika: "1000" },
                                        resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
                                        description: "Конец линейки лазеров - самый тяжелый и дальнобойный вариант данного вида вооружения."
                                    },

                                    "Баллистическая ракета БМР-03 «Отблеск»": {
                                        price: 70000000,  visibility: 0, category: "Ракеты", crewRequired: 0,
                                        power: 100, // Предстартовая подготовка
                                        capacityPenalty: 200, damage: 15, weight: 300, tech: "управляемое наведение", damageType: "ядерное оружие", class: "баллистическая ракета",
                                        customParameter: { kal: "300 мм", dalnost: 30, skorostrelnost: 0, metrika: "5.5" },
                                        resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 },
                                        description: "БМР-03 — баллистическая межконтинентальная ракета с термоядерным зарядом. Оружие судного дня или последнего шанса."
                                    },
                                    // --- АВИАГРУППЫ (МНОГОЦЕЛЕВЫЕ АВИАНОСЦЫ) ---
                                        "Звено перехватчиков «Нубранон»": {
                                            price: 5000000,  visibility: 20, category: "Ангар", crewRequired: 0,
                                            power: 60, // Обслуживание звеньев
                                            capacityPenalty: 80, damage: 15, weight: 30000, tech: "управляемое наведение", damageType: "урон авиации", class: "истребитель-перехватчик",
                                            customParameter: { kal: "22 мм", dalnost: 30, skorostrelnost: 0, metrika: "2000" },
                                            resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 },
                                            description: "Списанные перехватчики, наводнившие Квантор. Используют автопушку и ракеты «Страж» для борьбы с авиацией. Оснащены системами РЭБ."
                                        },

                                        "Бомбардировщик «Мелоди»": {
                                            price: 30000000,  visibility: 0, category: "Ангар", crewRequired: 0,
                                            power: 120, // Тяжелое обслуживание
                                            capacityPenalty: 150, damage: 15, weight: 30000, tech: "управляемое наведение", damageType: "урон авиации", class: "истребитель-перехватчик",
                                            customParameter: { kal: "100 мм", dalnost: 30, skorostrelnost: 0, metrika: "2000" },
                                            resurs: { blackmetall: 100, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 100 },
                                            description: "Многоцелевой бомбардировщик, встреча с которым не оставит равнодушным даже капитана капитального корабля."
                                        },
                                        // --- КОРАБЕЛЬНОЕ ВООРУЖЕНИЕ (ЛИНКОРЫ) ---
        "2х500-мм спаренный рельсотрон ТБС-2000 «Вольфанг»": {
            price: 80000000, visibility: 0, category: "Рельсотроные Орудия", crewRequired: 15,
            power: 1200,
            capacityPenalty: 0, damage: 0, weight: 150000, tech: "электрохимическое", damageType: "рельсотрон", class: "супероружие",
            customParameter: { kal: "500 мм", dalnost: 3, skorostrelnost: 4, metrika: "4" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
            description: "Один выстрел - 1 мертвый линкор. Спаренный рельсотрон калибра 500 мм."
        },

        "Каскадный суперлазер КСЛ-44 «Астраспис»": {
            price: 50000000, visibility: 0, category: "Энерго Орудия", crewRequired: 20,
            power: 1500,
            capacityPenalty: 0, damage: 0, weight: 100000, tech: "лазер", damageType: "суперлазер", class: "супероружие",
            customParameter: { kal: "500 мм", dalnost: 6, skorostrelnost: 1, metrika: "1000" },
            resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 },
            description: "Лазерное вооружение такой силы, что игнорирует любые защитные свойства материалов."
        },
      };

// --- СПИСКИ ДОСТУПНОГО ОРУЖИЯ ПО КЛАССАМ ---
const weapons = {
  peh: [
          "Нет выбранного вооружения",

          "=== ХОЛОДНОЕ ОРУЖИЕ ===",
          "Виброклинок ВК-4 «Потрошитель»",
          "Мономолекулярная катана «Айон»",

          "=== ЛИЧНОЕ ОРУЖИЕ ===",
          "9-мм пистолет Дистрила А100 «Астра»",
          "Пистолет-пулемёт No.51 «Сатаст»",
          "Помповое ружье «Гефест»",

          "=== ШТУРМОВОЕ ОРУЖИЕ ===",
          "Карабин «Арей»",
          "Штурмовая винтовка Дистрила АД-60",

          "=== ПУЛЕМЕТЫ ===",
          "Ручной пулемет «Ребрик»",
          "Станковый пулемет «Текарус»",

          "=== ГРАНАТЫ И МИНЫ ===",
          "Осколочная граната М-24 «Терранка»",
          "Плазменная граната «Гуерре»",
          "Гравитационная мина «Воронка»",

          "=== ТЯЖЕЛОЕ ВООРУЖЕНИЕ ===",
          "Противотанковая винтовка «Клин»",
          "РПГ Mk.IV «Каратель»",
          "Многозарядный гранатомет «Викли»",
          "Плазменный огнемёт АО-10 «Неугасаемый»",
          "Переносной ЗРК No.12 «Вемона»"
      ],

  btr: [
        "Нет выбранного вооружения",

        "=== КИНЕТИКА ===",
        "25-мм автоматическая пушка АК-30М «Азазан»",
        "30-мм электрохимическое орудие «Центара» ЭХО-30",
        "70-мм электрохимическое орудие «Двина» ЭХО-70",
        "100-мм рельсотронное орудие «АРКОН-100»",

        "=== ЭНЕРГЕТИКА ===",
        "Лазерное орудие «ЛУКС VI»",

        "=== РАКЕТНОЕ (БУМ) ===",
        "Зенитная ракета «Гало»",
        "Барражирующая ракета «Коготь»"
    ],
    tanki: [
        "Нет выбранного вооружения",

        "=== ПУЛЕМЕТЫ И ТУРЕЛИ ===",
        "6-мм 8-ствольный пулемет АК-6М «Гремлин»",
        "12-мм спаренный пулемёт АК-12М «Громобой»",
        "15-мм автоматическая пушка АК-15Т «Иззар»",

        "=== ОСНОВНОЙ КАЛИБР ===",
        "Гранатомет Мк.V «Защитник»",
        "70-мм электрохимическое орудие «Двина» ЭХО-70",
        "120-мм электрохимическое орудие «Никея» ЭХО-120М",
        "130-мм рельсотронное орудие «АРКОН-130»",

        "=== ЭНЕРГЕТИКА ===",
        "Лазерное орудие «ЛУКС X»",

        "=== РАКЕТНОЕ ВООРУЖЕНИЕ ===",
        "Зенитная ракета «Гало»",
        "Барражирующая ракета «Коготь»"
    ],
    arta: [
        "Нет выбранного вооружения",

        "=== СТВОЛЬНАЯ АРТИЛЛЕРИЯ ===",
        "30-мм электрохимическое орудие «Центара» ЭХО-30М",
        "152-мм электрохимическое орудие «Психея» ЭХО-152М",
        "300-мм электромагнитное орудие «Озалия» ЭХО-300М",

        "=== РЕАКТИВНЫЕ СИСТЕМЫ ===",
        "24х76 система залпового огня «Марс»",
        "Пятизарядная пусковая установка «Гермес»",
        "Пусковая установка МБР «Титан»"
    ],

    aviacia: [
        "Нет выбранного вооружения",

        "=== АВИАПУШКИ ===",
        "35-мм электрохимическое орудие «Гарпия» ЭХО-35А",

        "=== РАКЕТНОЕ ВООРУЖЕНИЕ ===",
        "Зенитная ракета «Гало»",
        "Неуправляемая ракета «Фотоид»",
        "РГЧ «Феникс»",
        "Противорадиолокационная ракета ПРК-1 «Страж»",
        "Управляемая ракета УР-4 «Нови-Сад»"
    ],
      vertihui: [
          "Нет выбранного вооружения",

          "=== ПУШКИ И ТУРЕЛИ ===",
          "12,5-мм автоматическая турель ВКТ-125 «Шершень»",
          "45-мм электрохимическое орудие «Шторм» ЭХО-45В",
          "50-мм авиационная электрохимическая пушка «Квиты» ЭХО-50",

          "=== РАКЕТНОЕ ВООРУЖЕНИЕ ===",
          "Зенитная ракета «Гало»",
          "Неуправляемая ракета «Фотоид»",
          "РГЧ «Феникс»",
          "Противорадиолокационная ракета ПРК-1 «Страж»",
          "Управляемая ракета УР-4 «Нови-Сад»"
      ],
      dron: [
          "Нет выбранного вооружения",

          "=== БОЕВЫЕ ЧАСТИ (КАМИКАДЗЕ) ===",
          "Осколочно-фугасная мина МБ-15",
          "Блок боевой части БЧ-15К",
          "Тандемная боевая часть БЧ-20Т",
          "Термобарическая боевая часть БЧ-25ТБ",
          "Боевая часть БЧ-АМ1",

          "=== СТРЕЛКОВОЕ ВООРУЖЕНИЕ ===",
          "9-мм пистолет Дистрила А100 «Астра»",
          "Пистолет-пулемёт No.51 «Сатаст»",
          "Карабин «Арей»",
          "Штурмовая винтовка Дистрила АД-60",
          "Помповое ружье «Гефест»",
          "Ручной пулемет «Ребрик»"
      ],
      mla: [
        "Нет выбранного вооружения",

        "=== КУРСОВОЕ ВООРУЖЕНИЕ ===",
        "35-мм электрохимическое орудие «Гарпия» ЭХО-35А",

        "=== РАКЕТЫ ===",
        "Зенитная ракета «Гало»",
        "Неуправляемая ракета «Фотоид»",
        "РГЧ «Феникс»",
        "Противорадиолокационная ракета ПРК-1 «Страж»",
        "Управляемая ракета УР-4 «Нови-Сад»"
    ],
    dronkos: [
        "Нет выбранного вооружения",

        "=== КОСМИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "Импульсный лазер Л-5 «Стилет»",
        "Микро-рельсотрон МР-2 «Игла»",
        "Ионный излучатель «Пульсар-М»",
        "Плазменный резак «Оса»",
        "20-мм роторная автопушка «Шквал» (Вакуумная)",

        "=== МОДУЛИ КАМИКАДЗЕ И МИНЫ ===",
        "Осколочно-фугасная мина МБ-15",
        "Блок боевой части БЧ-15К",
        "Тандемная боевая часть БЧ-20Т",
        "Термобарическая боевая часть БЧ-25ТБ",
        "Боевая часть БЧ-АМ1"
    ],
    corvette: [
        "Нет выбранного вооружения",

        "=== КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
        "90-мм электрохимическое орудие МтП-40 «Серкам»",

        "=== ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",

        "=== ВЗРЫВНОЕ ВООРУЖЕНИЕ ===",
        "Зенитная ракета «Гало»",
        "Неуправляемая ракета «Фотоид»",
        "РГЧ «Феникс»",
        "Противорадиолокационная ракета ПРК-1 «Страж»",
        "Управляемая ракета УР-4 «Нови-Сад»"
    ],
    destroyer: [
        "Нет выбранного вооружения",

        "=== КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
        "90-мм электрохимическое орудие МтП-40 «Серкам»",
        "150-мм электрохимическое орудие «Роджер»",
        "90-мм рельсотрон ПРВ-30 «Басл»",

        "=== ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",
        "100-мм пучковый лазер ПЛВ-55 «Меглос»",

        "=== ВЗРЫВНОЕ ВООРУЖЕНИЕ ===",
        "Зенитная ракета «Гало»",
        "Неуправляемая ракета «Фотоид»",
        "РГЧ «Феникс»",
        "Противорадиолокационная ракета ПРК-1 «Страж»",
        "Управляемая ракета УР-4 «Нови-Сад»"
    ],
        supportCarrier: [
            "Нет выбранного вооружения",

            "=== ОБОРОНИТЕЛЬНОЕ ВООРУЖЕНИЕ ===",
            "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
            "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",

            "=== АНГАРЫ И АВИАГРУППЫ ===",
            "Рой разведывательныых дронов «Кефир»",
            "Рой ударных дронов «Стрелка»",
            "Рой дронов-камикадзе «Коломорская роза»"
        ],
            mediumCruiser: [
                "Нет выбранного вооружения",

                "=== КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
                "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
                "90-мм электрохимическое орудие МтП-40 «Серкам»",
                "150-мм электрохимическое орудие «Роджер»",
                "90-мм рельсотрон ПРВ-30 «Басл»",
                "120-мм рельсотрон ЭКВ-82 «Годдард»",
                "4х350-мм рельсотрон ТБС-100 «Мюллер»",

                "=== ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
                "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",
                "100-мм пучковый лазер ПЛВ-55 «Меглос»",
                "Лазерное орудие ВПЛ-65 «Плага»",

                "=== ВЗРЫВНОЕ ВООРУЖЕНИЕ ===",
                "Зенитная ракета «Гало»",
                "Неуправляемая ракета «Фотоид»",
                "РГЧ «Феникс»",
                "Противорадиолокационная ракета ПРК-1 «Страж»",
                "Управляемая ракета УР-4 «Нови-Сад»",
                "Баллистическая ракета БМР-03 «Отблеск»"
            ],

                hyperCruiser: [
                    "Нет выбранного вооружения",

                    "=== КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
                    "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",

                    "=== ЛАЗЕРНОЕ ВООРУЖЕНИЕ ===",
                    "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",
                    "100-мм пучковый лазер ПЛВ-55 «Меглос»",
                    "Лазерное орудие ВПЛ-65 «Плага»"
                ],

                multiroleCarrier: [
                    "Нет выбранного вооружения",

                    "=== ОБОРОНИТЕЛЬНОЕ ВООРУЖЕНИЕ ===",
                    "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
                    "90-мм электрохимическое орудие МтП-40 «Серкам»",

                    "=== РАКЕТНОЕ ВООРУЖЕНИЕ ===",
                    "Зенитная ракета «Гало»",
                    "Неуправляемая ракета «Фотоид»",
                    "РГЧ «Феникс»",
                    "Противорадиолокационная ракета ПРК-1 «Страж»",
                    "Управляемая ракета УР-4 «Нови-Сад»",

                    "=== АВИАГРУППЫ И ДРОНЫ ===",
                    "Рой разведывательныых дронов «Кефир»",
                    "Рой ударных дронов «Стрелка»",
                    "Рой дронов-камикадзе «Коломорская роза»",
                    "Звено перехватчиков «Нубранон»",
                    "Бомбардировщик «Мелоди»"
                ],
    battleship: [
        "Нет выбранного вооружения",

        "=== КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
        "90-мм электрохимическое орудие МтП-40 «Серкам»",
        "150-мм электрохимическое орудие «Роджер»",
        "90-мм рельсотрон ПРВ-30 «Басл»",
        "120-мм рельсотрон ЭКВ-82 «Годдард»",
        "4х350-мм рельсотрон ТБС-100 «Мюллер»",
        "2х500-мм спаренный рельсотрон ТБС-2000 «Вольфанг»",

        "=== ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",
        "100-мм пучковый лазер ПЛВ-55 «Меглос»",
        "Лазерное орудие ВПЛ-65 «Плага»",
        "Каскадный суперлазер КСЛ-44 «Астраспис»",

        "=== ВЗРЫВНОЕ ВООРУЖЕНИЕ ===",
        "Зенитная ракета «Гало»",
        "Неуправляемая ракета «Фотоид»",
        "РГЧ «Феникс»",
        "Противорадиолокационная ракета ПРК-1 «Страж»",
        "Управляемая ракета УР-4 «Нови-Сад»",
        "Баллистическая ракета БМР-03 «Отблеск»"
    ],
    dreadnought: [
        "Нет выбранного вооружения",

        "=== КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
        "90-мм электрохимическое орудие МтП-40 «Серкам»",
        "150-мм электрохимическое орудие «Роджер»",
        "90-мм рельсотрон ПРВ-30 «Басл»",
        "120-мм рельсотрон ЭКВ-82 «Годдард»",
        "4х350-мм рельсотрон ТБС-100 «Мюллер»",
        "2х500-мм спаренный рельсотрон ТБС-2000 «Вольфанг»",

        "=== ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",
        "100-мм пучковый лазер ПЛВ-55 «Меглос»",
        "Лазерное орудие ВПЛ-65 «Плага»",
        "Каскадный суперлазер КСЛ-44 «Астраспис»",

        "=== ВЗРЫВНОЕ ВООРУЖЕНИЕ ===",
        "Зенитная ракета «Гало»",
        "Неуправляемая ракета «Фотоид»",
        "РГЧ «Феникс»",
        "Противорадиолокационная ракета ПРК-1 «Страж»",
        "Управляемая ракета УР-4 «Нови-Сад»",
        "Баллистическая ракета БМР-03 «Отблеск»"
    ],
    ss13: [
        "Нет выбранного вооружения",

        "=== КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х15,6-мм спаренный пулемет ЭтА-30 «Грязнокровка»",
        "90-мм электрохимическое орудие МтП-40 «Серкам»",
        "150-мм электрохимическое орудие «Роджер»",
        "90-мм рельсотрон ПРВ-30 «Басл»",
        "120-мм рельсотрон ЭКВ-82 «Годдард»",
        "4х350-мм рельсотрон ТБС-100 «Мюллер»",
        "2х500-мм спаренный рельсотрон ТБС-2000 «Вольфанг»",

        "=== ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ ===",
        "2х40-мм спаренное лазерное орудие ИЛВ-60 «Акатименос»",
        "100-мм пучковый лазер ПЛВ-55 «Меглос»",
        "Лазерное орудие ВПЛ-65 «Плага»",
        "Каскадный суперлазер КСЛ-44 «Астраспис»",

        "=== ВЗРЫВНОЕ ВООРУЖЕНИЕ ===",
        "Зенитная ракета «Гало»",
        "Неуправляемая ракета «Фотоид»",
        "РГЧ «Феникс»",
        "Противорадиолокационная ракета ПРК-1 «Страж»",
        "Управляемая ракета УР-4 «Нови-Сад»",
        "Баллистическая ракета БМР-03 «Отблеск»",

        "=== АНГАР И АВИАГРУППЫ ===",
        "Рой разведывательныых дронов «Кефир»",
        "Рой ударных дронов «Стрелка»",
        "Рой дронов-камикадзе «Коломорская роза»",
        "Звено перехватчиков «Нубранон»",
        "Бомбардировщик «Мелоди»"
    ],
};






//*--------------------------------------------------------------------------*//
////////////Р А Д А Р Ы////////////Р А Д А Р Ы//////////////Р А Д А Р Ы/////////
//*--------------------------------------------------------------------------*//


const radarTypes = {
  l: { rangeKm: 450, epr: 2 },
  s: { rangeKm: 200, epr: 1 },
  c: { rangeKm: 50, epr: 0.5 },
  x: { rangeKm: 20, epr: 0.2 },
  ka: { rangeKm: 10, epr: 0.1 }
};

const baseVisionRanges = {
  peh: 1,
  btr: 2,
  tanki: 3,
  arta: 5,
  aviacia: 10,
  vertihui: 8,
  dron: 2
};


const modules5 = {
  peh: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, capacityPenalty: 150, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..." },
    { name: 'Портативная радиолокационная станция ЕБ-44 КА', price: 200000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 0, dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пехотная РЛС: дальность 6, помехозащищённость 2."  },

      ],
  btr: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «Око»', price: 200000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 20,dalnostBoost: 1, customParameterradar: { dalnost: 4, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптика: дальность 4, но помехи почти не берут (защита 4)."  },
    { name: 'Лазерный дальномер «Марка»', price: 400000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 20,dalnostBoost: 3, customParameterradar: { dalnost: 5, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Лазерный канал: дальность 5, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Притяжение»', price: 400000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50, dalnostBoost: 8, customParameterradar: { dalnost: 8, diapazon: 'c', eccm: 1, pwrPer: 2000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 8 (+1 за каждые 2000 E реактора, до +2), уязвима к РЭБ (защита 1)."  },


  ],
  tanki: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «Око»', price: 200000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 20,dalnostBoost: 1, customParameterradar: { dalnost: 4, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптика: дальность 4, но помехи почти не берут (защита 4)."  },
    { name: 'Беспилотный летательный аппарат «Цедра»', price: 700000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 10, dalnostBoost: 8, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Разведывательный БПЛА: дальность 9, помехозащищённость 2."  },

  ],
  arta: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Беспилотный летательный аппарат «Цедра»', price: 700000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 10, dalnostBoost: 8, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Разведывательный БПЛА: дальность 9, помехозащищённость 2."  },
  ],
  aviacia: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },

  ],
  vertihui: [
      { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
      { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
      { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
  ],
  dron: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
  ],
  dronkos: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
  ],
  mla: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
  ],
  corvette: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },

  ],
  destroyer: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
  ],
  supportCarrier: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
  ],
  mediumCruiser: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
    { name: 'ГРАВИК «Лира»', price: 80000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 6, customParameterradar: { dalnost: 12, diapazon: 'c', eccm: 6, pwrPer: 10000, pwrCap: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Гравитационный сенсор: дальность 12 (+1 за каждые 10000 E реактора, до +5), помехам недоступен (защита 6)."  },
  ],
  hyperCruiser: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
    { name: 'ГРАВИК «Лира»', price: 80000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 6, customParameterradar: { dalnost: 12, diapazon: 'c', eccm: 6, pwrPer: 10000, pwrCap: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Гравитационный сенсор: дальность 12 (+1 за каждые 10000 E реактора, до +5), помехам недоступен (защита 6)."  },
    { name: 'ПП-сонар', price: 90000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 4, customParameterradar: { dalnost: 15, diapazon: 'c', eccm: 6, pwrPer: 8000, pwrCap: 3 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Подпространственный сонар: дальность 15 (+1 за каждые 8000 E реактора, до +3), классической РЭБ недоступен (защита 6)."  },
  ],
  multiroleCarrier: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
    { name: 'ГРАВИК «Лира»', price: 80000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 6, customParameterradar: { dalnost: 12, diapazon: 'c', eccm: 6, pwrPer: 10000, pwrCap: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Гравитационный сенсор: дальность 12 (+1 за каждые 10000 E реактора, до +5), помехам недоступен (защита 6)."  },
  ],
  battleship: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
    { name: 'ГРАВИК «Лира»', price: 80000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 6, customParameterradar: { dalnost: 12, diapazon: 'c', eccm: 6, pwrPer: 10000, pwrCap: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Гравитационный сенсор: дальность 12 (+1 за каждые 10000 E реактора, до +5), помехам недоступен (защита 6)."  },
  ],
  dreadnought: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
    { name: 'ГРАВИК «Лира»', price: 80000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 6, customParameterradar: { dalnost: 12, diapazon: 'c', eccm: 6, pwrPer: 10000, pwrCap: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Гравитационный сенсор: дальность 12 (+1 за каждые 10000 E реактора, до +5), помехам недоступен (защита 6)."  },
  ],
  ss13: [
    { name: 'Не выбран', price: 0, crewProvided: 0, crewRequired: 0, modulBoost: 0, category: 'Радары', power: 0,dalnostBoost: 0, customParameterradar: { dalnost: 0, diapazon: 'c' }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 0, kristall: 0, staarvis: 0 }, description: "..."  },
    { name: 'Оптико-электронная система «ИКС-Y»', price: 500000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 50,dalnostBoost: 2, customParameterradar: { dalnost: 6, diapazon: 'c', eccm: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Оптико-электронный пост: дальность 6, глушению почти не поддаётся (защита 5)."  },
    { name: 'Активная радиолокационная станция «Радиоромантик» А1»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 2, category: 'Радары', power: 100, dalnostBoost: 4, customParameterradar: { dalnost: 10, diapazon: 'c', eccm: 1, pwrPer: 8000, pwrCap: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Активная РЛС: дальность 10 (+1 за каждые 8000 E реактора, до +4), уязвима к РЭБ (защита 1)."  },
    { name: 'Пассивная радиолокационная станция «Рубикория IV»', price: 2000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 10, customParameterradar: { dalnost: 13, diapazon: 'c', eccm: 4 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Пассивная станция: слушает эфир на дальность 13, помехозащищённость 4."  },
    { name: 'ЛИДАР «Лучевая душа»', price: 1000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 350, dalnostBoost: 5, customParameterradar: { dalnost: 9, diapazon: 'c', eccm: 5, pwrPer: 15000, pwrCap: 2 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "ЛИДАР: дальность 9 (+1 за каждые 15000 E реактора, до +2), лазер не глушится (защита 5)."  },
    { name: 'ГРАВИК «Лира»', price: 80000000, crewProvided: 0, crewRequired: 0, modulBoost: 6, category: 'Радары', power: 500, dalnostBoost: 6, customParameterradar: { dalnost: 12, diapazon: 'c', eccm: 6, pwrPer: 10000, pwrCap: 5 }, resurs: { blackmetall: 5, coloredmetall: 3, rudametall: 1, kristall: 0, staarvis: 0 }, description: "Гравитационный сенсор: дальность 12 (+1 за каждые 10000 E реактора, до +5), помехам недоступен (защита 6)."  },
  ],
};
//*--------------------------------------------------------------------------*//
////////////Д В И Г А Т Е Л И////////////Д В И Г А Т Е Л И/////////////////////
//*--------------------------------------------------------------------------*//

const modules3 = {
  peh: [
    { name: 'Левой, правой, шагай, детка', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 1 },
    { name: 'Реактиный ранец', price: 1000, power: 1, speedBoost: 3, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 3 }

  ],
  btr: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 0  },
    { name: 'ККЗ Революция-01', price: 5000, power: 10, speedBoost: 3, crewRequired: 0,  resurs: { blackmetall: 200, coloredmetall: 150, rudametall: 50, kristall: 0, staarvis: 30 }, force: 250  },
    { name: 'А-Тек Вектор-03', price: 6500, power: 50, speedBoost: 8, crewRequired: 0, resurs: { blackmetall: 220, coloredmetall: 180, rudametall: 70, kristall: 0, staarvis: 40 }, force: 400 }
],

tanki: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0,  resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 0  },
    { name: 'ККЗ Левия-09', price: 10000, power: 50, speedBoost: 5, crewRequired: 0, resurs: { blackmetall: 500, coloredmetall: 300, rudametall: 100, kristall: 0, staarvis: 50 }, force: 850  },
    { name: 'А-Тек Мустанг-04', price: 12000, power: 100, speedBoost: 10, crewRequired: 0, resurs: { blackmetall: 550, coloredmetall: 350, rudametall: 120, kristall: 0, staarvis: 60 }, force: 1100  }
],

arta: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 0  },
    { name: 'ККЗ Уния-07', price: 8000, power: 100, speedBoost: 2, crewRequired: 0, resurs: { blackmetall: 300, coloredmetall: 200, rudametall: 80, kristall: 0, staarvis: 35 }, force: 950  },
],
  aviacia: [

    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 0 },
    { name: 'ККЗ Турбореактивный двигатель TRJ-500', price: 50000, power: 10, speedBoost: 6, crewRequired: 0, description: 'Турбореактивный двигатель использует компрессор для сжатия воздуха и камеру сгорания для создания тяги. Состоит из компрессора, камеры сгорания, турбины и сопла.', resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 10500 },
    { name: 'ККЗ Гиперзвуковой прямоточный двигатель SCRJ-800', price: 80000, power: 10, speedBoost: 12, crewRequired: 0, description: 'Гиперзвуковой прямоточный двигатель работает на сверхзвуковой скорости воздуха, что позволяет достигать невероятной тяги. Состоит из сверхзвукового воздухозаборника, камеры сгорания и сопла.', resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 35000 },
    { name: 'ККЗ Газовая турбина GT-700', price: 70000, power: 0, speedBoost: 10, crewRequired: 0, description: 'Газовая турбина сжимает воздух, сжигает топливо и производит вращение турбины для генерации мощности. Состоит из компрессора, камеры сгорания, турбины и системы выхлопа.', resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 33000 },
    { name: 'А-Тек Турбовальный двигатель TVD-400', price: 40000, power: 10, speedBoost: 5, crewRequired: 0, description: 'Турбовальный двигатель работает на основе компрессора и камеры сгорания, создавая вращение вала для передачи энергии на механические системы. Состоит из компрессора, камеры сгорания, турбины и выходного вала.', resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 4000 },
    { name: 'А-Тек Прямоточный воздушно-реактивный двигатель RJ-450', price: 45000, power: 50, speedBoost: 8, crewRequired: 0, description: 'Прямоточный воздушно-реактивный двигатель использует аэродинамическое сжатие воздуха для горения топлива. Состоит из воздухозаборника, камеры сгорания и сопла.', resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 16000 },
    { name: 'А-Тек Ракетный двигатель RKT-750', price: 75000, power: 200, speedBoost: 10, crewRequired: 0, description: 'Ракетный двигатель создает тягу за счет сгорания топлива внутри изолированной камеры и выброса газа через сопло. Состоит из камеры сгорания, сопла и системы зажигания.', resurs: { blackmetall: 1, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 30000 }

  ],
  vertihui: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'ККЗ Композитный винт KR-110', price: 20000, power: 100, speedBoost: 3, crewRequired: 0, description: 'Винт из современных композитных материалов, обеспечивающий высокий КПД и устойчивость к повреждениям. Состоит из композитного лопастного материала, усиленного центрального узла и системы регулировки угла наклона.', resurs: { blackmetall: 300, coloredmetall: 120, rudametall: 90, kristall: 5, staarvis: 10 }, force: 5000 },
    { name: 'А-Тек Винт со сниженным шумом', price: 30000, power: 200, speedBoost: 3, crewRequired: 0, description: 'Винт со сниженным уровнем шума для гражданских вертолетов, выполненный из легкого композита с оптимизированной аэродинамикой. Состоит из легкого композитного материала и системы демпфирования.', resurs: { blackmetall: 350, coloredmetall: 180, rudametall: 70, kristall: 15, staarvis: 10 }, force: 6000 }

  ],
  dron: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Высокооборотистый униврсальный двигатель', price: 1000, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 6 },
  ],
  dronkos: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Солнечные паруса', price: 5000000, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 800, lor: 'Использует давление света для создания тяги.' },
    { name: 'Ионный двигатель «Скорпион»', price: 5000000, power: 150, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 1100,lor: 'Ионы ускоряются электрическим полем, создавая небольшую тягу.' },
  ],
  mla: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Химический реактивный двигатель «Факельщик»', price: 15000000, power: 50, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 298000, lor: 'Топливо сжигается в камере сгорания, создавая выхлоп и тягу. Простой в конструкции, но маломощный.' },
    { name: 'Твердотопливный антиматериальный двигатель «Искра»', price: 35000000, power: 600, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 348000, lor: 'Антиматериальная версия твердотопливного ядерного ракетного двигателя. Вольфрамовая цель облучается антипротонами, нагревая топливо, которое выбрасывается через сопло.' },
  ],
  corvette: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Солнечные паруса', price: 5000000, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 418000, lor: 'Использует давление света для создания тяги.' },
    { name: 'Фазовый двигатель «Гелиос»', price: 25000000, power: 400, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 598000, lor: 'Работает на ядерном делении, производя высокоэнергетические частицы для тяги.' },
    { name: 'Твердотопливный антиматериальный двигатель «Искра»', price: 35000000, power: 600, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 648000, lor: 'Антиматериальная версия твердотопливного ядерного ракетного двигателя. Вольфрамовая цель облучается антипротонами, нагревая топливо, которое выбрасывается через сопло.' },

  ],
  destroyer: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Солнечные паруса', price: 5000000, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 259000, lor: 'Использует давление света для создания тяги.' },
    { name: 'Антиматериальный парус «Повелитель мух»"', price: 5000000, power: 250, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 418000, lor: 'Использует антипротоны для ядерного деления в графитовом парусе. Отдача от деления толкает парус, тянущий космический корабль.' },
    { name: 'Фазовый двигатель «Гелиос»', price: 25000000, power: 0, speedBoost: 400, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 468000, lor: 'Работает на ядерном делении, производя высокоэнергетические частицы для тяги.' },
    { name: 'Твердотопливный антиматериальный двигатель «Искра»', price: 35000000, power: 600, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 588000, lor: 'Антиматериальная версия твердотопливного ядерного ракетного двигателя. Вольфрамовая цель облучается антипротонами, нагревая топливо, которое выбрасывается через сопло.' },

  ],
  supportCarrier: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Фазовый двигатель «Гелиос»', price: 25000000, power: 400, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 298000, lor: 'Работает на ядерном делении, производя высокоэнергетические частицы для тяги.' },
    { name: 'Твердотопливный антиматериальный двигатель «Искра»', price: 35000000, power: 600, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 498000, lor: 'Антиматериальная версия твердотопливного ядерного ракетного двигателя. Вольфрамовая цель облучается антипротонами, нагревая топливо, которое выбрасывается через сопло.' },
  ],
  mediumCruiser: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Термоядерный двигатель «Безлер»', price: 30000000, power: 1000, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 298000, lor: 'Использует реакцию термоядерного синтеза для создания тяги.' },
    { name: 'Твердотопливный антиматериальный двигатель «Искра»', price: 35000000, power: 600, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 458000, lor: 'Антиматериальная версия твердотопливного ядерного ракетного двигателя. Вольфрамовая цель облучается антипротонами, нагревая топливо, которое выбрасывается через сопло.' },
    { name: 'Газо-топливный антиматериальный двигатель «Елена»', price: 30000000, power: 1000, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 598000, lor: 'Использует микроскопические количества антиматерии для превращения водорода в плазму. Обладает высоким удельным импульсом, но ограниченной мощностью' },

  ],
  hyperCruiser: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Позитронный абляционный двигатель AzardanCore', price: 35000000, power: 1000, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 100000000, lor: 'Использует антиматерию без топлива. Заряженные пионы направляются в магнитную ловушку. Огромный удельный импульс, но низкая тяга.' },
  ],
  multiroleCarrier: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Твердотопливный антиматериальный двигатель «Искра»', price: 35000000, power: 600, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 1198000, lor: 'Антиматериальная версия твердотопливного ядерного ракетного двигателя. Вольфрамовая цель облучается антипротонами, нагревая топливо, которое выбрасывается через сопло.' },

  ],
  battleship: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Термоядерный двигатель «Безлер»', price: 30000000, power: 1000, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 1698000, lor: 'Использует реакцию термоядерного синтеза для создания тяги.' },
    { name: 'ACMF51 «Планета людей»', price: 170000000, power: 1200, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 2198000, lor: 'Двигатель антипротонно-катализируемого микро-деления использует антипротоны для деления гранул урана и дейтерия. Свинцовая оболочка преобразует гамма-лучи в рентгеновские.' },
  ],
  dreadnought: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'ACMF51 «Планета людей»', price: 170000000, power: 1200, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 10008000, lor: 'Двигатель антипротонно-катализируемого микро-деления использует антипротоны для деления гранул урана и дейтерия. Свинцовая оболочка преобразует гамма-лучи в рентгеновские.' },
  ],
  ss13: [
    { name: 'Нет двигателей', price: 0, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'ККЗ Ионный маневровый двигатель', price: 5000000, power: 0, speedBoost: 0, crewRequired: 0, speedPercent: 0, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 }, force: 10008000 },
  ],
};

//*--------------------------------------------------------------------------*//
////////////Щ И Т Ы////////////Щ И Т Ы//////////////Щ И Т Ы/////////////////////
//*--------------------------------------------------------------------------*//

const modules6 = {
  peh: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Персональный эмиттер «Доба» ГСЗ-1', price: 1000000, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 10, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }

  ],
  btr: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Энергокупол «Цикл» ГСЗ-3350', price: 5000000, category: 'Демонстрационный модуль', shieldBoost: 0, power: 60, speed: 0, crewRequired: 0, protectiveField: 100, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }
  ],
  tanki: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Энергокупол «Цикл» ГСЗ-3350', price: 5000000, category: 'Демонстрационный модуль', shieldBoost: 0, power: 60, speed: 0, crewRequired: 0, protectiveField: 100, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }

  ],
  arta: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Энергокупол «Цикл» ГСЗ-3350', price: 5000000, category: 'Демонстрационный модуль', shieldBoost: 0, power: 60, speed: 0, crewRequired: 0, protectiveField: 100, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }

  ],
  aviacia: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }
  ],
  vertihui: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }
  ],
  dron: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }
  ],
  dronkos: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
  ],
  mla: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } }
  ],
  corvette: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
  ],
  destroyer: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
  ],
  supportCarrier: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
  ],
  mediumCruiser: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Лоррен» СЗ-96', price: 27000000, power: 1000, protectiveField: 1000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Плазменный экран «Горуда» ГПЗ-98', price: 50000000, power: 300, protectiveField: 1000, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 250, coloredmetall: 0, rudametall: 0, kristall: 150, staarvis: 0 } },
  ],
  hyperCruiser: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Лоррен» СЗ-96', price: 27000000, power: 1000, protectiveField: 1000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Плазменный экран «Горуда» ГПЗ-98', price: 50000000, power: 300, protectiveField: 1000, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 250, coloredmetall: 0, rudametall: 0, kristall: 150, staarvis: 0 } },
  ],
  multiroleCarrier: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Лоррен» СЗ-96', price: 27000000, power: 1000, protectiveField: 1000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Виталд» ГСЗ-78', price: 35200000, power: 1000, protectiveField: 1500, visibility: 0, crewRequired: 10, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 200, coloredmetall: 0, rudametall: 10, kristall: 150, staarvis: 0 } },
    { name: 'Плазменный экран «Горуда» ГПЗ-98', price: 50000000, power: 300, protectiveField: 1000, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 250, coloredmetall: 0, rudametall: 0, kristall: 150, staarvis: 0 } },
  ],
  battleship: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Лоррен» СЗ-96', price: 27000000, power: 1000, protectiveField: 1000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Виталд» ГСЗ-78', price: 35200000, power: 1000, protectiveField: 1500, visibility: 0, crewRequired: 10, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 200, coloredmetall: 0, rudametall: 10, kristall: 150, staarvis: 0 } },
    { name: 'Плазменный экран «Горуда» ГПЗ-98', price: 50000000, power: 300, protectiveField: 1000, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 250, coloredmetall: 0, rudametall: 0, kristall: 150, staarvis: 0 } },
    { name: 'Плазменный экран «Фэнхуа» ГПЗ-140', price: 75000000, power: 4500, protectiveField: 20000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 1000, coloredmetall: 0, rudametall: 0, kristall: 600, staarvis: 100 } }  ],
  dreadnought: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Лоррен» СЗ-96', price: 27000000, power: 1000, protectiveField: 1000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Виталд» ГСЗ-78', price: 35200000, power: 1000, protectiveField: 1500, visibility: 0, crewRequired: 10, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 200, coloredmetall: 0, rudametall: 10, kristall: 150, staarvis: 0 } },
    { name: 'Плазменный экран «Горуда» ГПЗ-98', price: 50000000, power: 300, protectiveField: 1000, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 250, coloredmetall: 0, rudametall: 0, kristall: 150, staarvis: 0 } },
    { name: 'Плазменный экран «Фэнхуа» ГПЗ-140', price: 75000000, power: 4500, protectiveField: 20000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 1000, coloredmetall: 0, rudametall: 0, kristall: 600, staarvis: 100 } }  ],
  ss13: [
    { name: 'Нет выбранных щитов', price: 0, category: 'Демонстрационный модуль', shieldBoost: 0, power: 0, speed: 0, crewRequired: 0, protectiveField: 0, customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 0, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Аспид» ПЗ-40', price: 3900000, power: 100, protectiveField: 100, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Дистанционный щит «Маура» ПЗ-70', price: 18000000, power: 250, protectiveField: 600, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 0, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Луар» СЗ-58', price: 14000000, power: 400, protectiveField: 200, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 10, coloredmetall: 0, rudametall: 0, kristall: 10, staarvis: 0 } },
    { name: 'Лазерный дефлектор «Лоррен» СЗ-96', price: 27000000, power: 1000, protectiveField: 1000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Йовеф» ГСЗ-68', price: 30100000, power: 650, protectiveField: 600, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 50, coloredmetall: 0, rudametall: 0, kristall: 50, staarvis: 0 } },
    { name: 'Электромагнитный щит «Виталд» ГСЗ-78', price: 35200000, power: 1000, protectiveField: 1500, visibility: 0, crewRequired: 10, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 200, coloredmetall: 0, rudametall: 10, kristall: 150, staarvis: 0 } },
    { name: 'Плазменный экран «Горуда» ГПЗ-98', price: 50000000, power: 300, protectiveField: 1000, visibility: 0, crewRequired: 5, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 250, coloredmetall: 0, rudametall: 0, kristall: 150, staarvis: 0 } },
    { name: 'Плазменный экран «Фэнхуа» ГПЗ-140', price: 75000000, power: 4500, protectiveField: 20000, visibility: 0, crewRequired: 15, category: 'Модули щитов', customParameterradar: { dalnost: 0 }, resurs: { blackmetall: 1000, coloredmetall: 0, rudametall: 0, kristall: 600, staarvis: 100 } }  ],
};
  return {
    speedBoostConfig, shipClasses, engines, materialsDatabase, armorElements,
    modulesLibrary, modules_ids, modules, techCoefficients, damageTypeCoefficients,
    classCoefficients, weaponLibrary, weapons, radarTypes, baseVisionRanges,
    modules5, modules3, modules6
  };
})();
