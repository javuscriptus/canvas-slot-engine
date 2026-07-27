// Раскладки темы «Неон».
//
// Композиция другая, не перекрашенная: в ландшафте кнопка пуска стоит
// слева, счётчики уходят вправо, служебные кнопки собраны в один блок
// у правого края. В портрете панель ниже и плотнее — ряд счётчиков один,
// а не два.
//
// Общего кода с «Сочи» нет намеренно. Раскладка — это и есть композиция
// игры; вынести её «в общую библиотеку» значит получить одну композицию
// на все темы, то есть ровно то, от чего слой тем и заводился. Что
// действительно обязано быть общим — правило размера под палец, — здесь
// повторено пятью строками, и это дешевле любой абстракции.
//
// Размер сетки раскладка не выдумывает: reels и rows приходят параметром
// из конфигурации сервера.

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/** Минимальный размер органа управления под палец, реальные пиксели. */
export const MIN_TOUCH_PX = 48;

/** Диаметр круглой кнопки в дизайнерских пикселях (tools/assets/ui.mjs). */
const BUTTON_PX = 76;

/**
 * Множитель, при котором кнопка занимает на экране не меньше MIN_TOUCH_PX.
 * На больших экранах выходит меньше единицы и обрезается: раздувать
 * кнопки там незачем.
 */
function touchBoost(vw, vh, width, height) {
  const scale = Math.min(vw / width, vh / height);
  if (!(scale > 0)) return 1;
  return clamp(MIN_TOUCH_PX / (BUTTON_PX * scale), 1, 2.4);
}

/* ────────────────────────── ландшафт ────────────────────────────── */

function landscape(aspect, vw, vh, reels, rows) {
  const height = 1080;
  const width = Math.round(clamp(height * aspect, 1400, 2600));
  const boost = touchBoost(vw, vh, width, height);

  // Панель считается от кнопки пуска: при фиксированной высоте увеличенная
  // под палец кнопка вылезает за нижний край экрана.
  const spinPx = 176 * boost;
  const panelH = Math.round(clamp(spinPx * 0.78 + 88, 232, height * 0.34));
  const panelY = height - panelH;
  const midY = panelY + Math.round(panelH * 0.5);

  const inset = 56;
  const topBarBottom = 24 + 72 * boost;
  const cell = Math.floor(clamp((panelY - topBarBottom - 44 - inset * 2) / rows, 96, 200));
  const gridW = cell * reels;
  const gridH = cell * rows;
  const gridX = Math.round((width - gridW) / 2);
  const gridY = Math.round(topBarBottom + (panelY - topBarBottom - gridH) / 2 + 10);

  // Пуск слева: правая половина панели отдана деньгам, и глаз читает
  // её как табло, а не как продолжение ряда кнопок.
  const spinX = Math.round(spinPx * 0.5) + 30;
  const sideR = Math.round(46 * boost);
  const sideX = spinX + Math.round(spinPx * 0.5) + sideR;
  const rightEdge = width - 40;
  const topY = 24 + 34 * boost;

  // Ряд табло считается, а не расставляется числами. Ширина холста в
  // ландшафте гуляет от 1400 до 2600, и при фиксированных координатах
  // на «квадратном» экране кнопка ставки наезжала на соседнее табло —
  // ровно та ошибка, которую видно только на чужом мониторе.
  const btnR = Math.round(38 * boost);        // половина кнопки ставки
  const pad = 22;                             // просвет между кнопкой и табло
  const gap = 34;                             // просвет между табло
  const minLeft = sideX + sideR + 30;         // правее колонки турбо/авто
  const rowW = rightEdge - minLeft;
  // Ставка стоит между двумя кнопками, дальше счёт и выигрыш. Табло
  // ужимаются под холст: в ландшафте он гуляет от 1400 до 2600, и при
  // фиксированных координатах на «квадратном» экране кнопка ставки
  // наезжала на соседнее табло — ошибка, которую видно только на чужом
  // мониторе. Лишнее место уходит влево, к пуску.
  const plateW = Math.round(clamp((rowW - btnR * 4 - pad * 3 - gap) / 3, 240, 344));
  const blockLeft = rightEdge - (btnR * 4 + pad * 3 + plateW * 3 + gap);
  const minusX = blockLeft + btnR;
  const betX = minusX + btnR + pad + plateW / 2;
  const plusX = betX + plateW / 2 + pad + btnR;
  const balanceX = plusX + btnR + pad + plateW / 2;
  const winX = balanceX + plateW + gap;

  return {
    name: "landscape",
    width,
    height,
    mode: "fit",
    background: "bg_landscape",
    backgroundFree: "bg_landscape_free",

    cell,
    grid: { x: gridX, y: gridY },
    frameInset: inset,

    logo: { x: width / 2, y: 60, scale: 0.3 },
    freeSpinBadge: { x: width / 2, y: panelY - 14 },

    panel: { x: 0, y: panelY, width, height: panelH },
    meterPlate: { width: plateW, height: 116 },
    meters: {
      bet: { x: betX, y: midY },
      balance: { x: balanceX, y: midY },
      win: { x: winX, y: midY }
    },
    spinButton: { x: spinX, y: midY, scale: boost },
    // Плюс и минус обнимают табло ставки: между ними остаётся сама цифра,
    // и промахнуться мимо нужной кнопки сложнее.
    betButtons: {
      minus: { x: minusX, y: midY, scale: boost * 0.8 },
      plus: { x: plusX, y: midY, scale: boost * 0.8 }
    },
    sideButtons: {
      turbo: { x: sideX, y: midY - sideR, scale: boost * 0.8 },
      auto: { x: sideX, y: midY + sideR, scale: boost * 0.8 }
    },
    // Служебные кнопки собраны справа одним блоком: слева наверху пусто,
    // и логотип не соседствует с рядом мелких значков.
    topButtons: {
      menu: { x: width - 34 - 378 * boost, y: topY, scale: boost },
      sound: { x: width - 34 - 292 * boost, y: topY, scale: boost },
      full: { x: width - 34 - 206 * boost, y: topY, scale: boost },
      info: { x: width - 34 - 120 * boost, y: topY, scale: boost },
      history: { x: width - 34 - 34 * boost, y: topY, scale: boost }
    }
  };
}

/* ─────────────────────────── портрет ────────────────────────────── */

function portrait(aspect, vw, vh, reels, rows) {
  const width = 1080;
  const height = Math.round(clamp(width / aspect, 1400, 2500));

  const margin = 16;
  const inset = 38;
  const cell = Math.floor((width - margin * 2 - inset * 2) / reels);
  const gridW = cell * reels;
  const gridH = cell * rows;
  const frameH = gridH + inset * 2;

  const boost = touchBoost(vw, vh, width, height);
  const spinPx = 184 * boost * 0.95;
  // Один ряд счётчиков вместо двух — панель ниже, барабанам больше места.
  const panelH = Math.round(clamp(spinPx + 300, 470, height * 0.34));
  const panelY = height - panelH;

  const rowMeters = panelY + Math.round(panelH * 0.24);
  const rowButtons = panelY + panelH - Math.round(spinPx * 0.5) - 30;

  const topY = Math.round(clamp(height * 0.045, 76, 130));
  const topBarBottom = topY + BUTTON_PX;

  const free = panelY - topBarBottom;
  const frameY = Math.round(topBarBottom + (free - frameH) * 0.72);
  const gridY = frameY + inset;
  const gridX = Math.round((width - gridW) / 2);
  const logoY = Math.round(topBarBottom + (frameY - topBarBottom) * 0.5);

  return {
    name: "portrait",
    width,
    height,
    mode: "fit",
    background: "bg_portrait",
    backgroundFree: "bg_portrait_free",

    cell,
    grid: { x: gridX, y: gridY },
    frameInset: inset,

    logo: { x: width / 2, y: logoY, scale: 0.72 },
    freeSpinBadge: { x: width / 2, y: frameY - 88 },

    panel: { x: 0, y: panelY, width, height: panelH },
    meterPlate: { width: 336, height: 120 },
    meters: {
      balance: { x: 186, y: rowMeters },
      win: { x: width / 2, y: rowMeters },
      bet: { x: width - 186, y: rowMeters }
    },
    spinButton: { x: width / 2, y: rowButtons, scale: boost * 0.95 },
    betButtons: {
      minus: { x: width - 340, y: rowMeters + 108, scale: boost * 0.9 },
      plus: { x: width - 60 - 38 * boost, y: rowMeters + 108, scale: boost * 0.9 }
    },
    sideButtons: {
      turbo: { x: 44 + 46 * boost, y: rowButtons, scale: boost },
      auto: { x: width - 44 - 46 * boost, y: rowButtons, scale: boost }
    },
    topButtons: {
      menu: { x: 88, y: topY, scale: boost },
      sound: { x: 236, y: topY, scale: boost },
      full: { x: width - 384, y: topY, scale: boost },
      info: { x: width - 236, y: topY, scale: boost },
      history: { x: width - 88, y: topY, scale: boost }
    }
  };
}

/**
 * Есть ли в браузере полноэкранный режим для элементов.
 * Safari на iPhone его не даёт — там кнопку показывать нельзя.
 */
export function fullscreenSupported() {
  if (typeof document === "undefined") return false;
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

/**
 * @param {number} vw ширина области в CSS-пикселях
 * @param {number} vh высота области
 * @param {object} size { reels, rows } — размер сетки из конфигурации
 */
export function build(vw, vh, { reels, rows }) {
  const aspect = vw / Math.max(1, vh);
  const layout = aspect >= 1
    ? landscape(aspect, vw, vh, reels, rows)
    : portrait(aspect, vw, vh, reels, rows);
  if (!fullscreenSupported()) delete layout.topButtons.full;
  return layout;
}
