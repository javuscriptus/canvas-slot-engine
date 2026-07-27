// Раскладки под ландшафт и портрет.
//
// ─────────────────────── почему они считаются ────────────────────────
//
// Раньше здесь лежали два жёстких холста: 1920×1080 и 1080×1920. Движок
// вписывал холст в экран по меньшей стороне и центрировал — а значит,
// на любом устройстве с другим соотношением сторон сверху и снизу
// оставались пустые полосы.
//
// Для телефона это не мелочь. Экран 390×844 имеет отношение 0.462,
// портретный холст — 0.5625. Масштаб берётся минимальный, картинка
// получается 390×693, и 151 пиксель по высоте — почти пятая часть
// экрана — уходит в пустоту. Именно эта полоса и была видна снизу.
//
// Поэтому холст теперь строится под фактическое соотношение сторон:
// ширина фиксирована, высота равна ширине, делённой на соотношение.
// Масштаб по обеим осям совпадает, отступы равны нулю, экран занят
// целиком. Элементы при этом не растягиваются, а раскладываются
// заново: панель прижата к низу, барабаны к центру, кнопки к верху.
//
// Второе, что чинится здесь же, — размер кнопок. При масштабе 0.36
// кнопка в 90 дизайнерских пикселей превращается в 32 экранных, а это
// вдвое меньше минимального размера, пригодного для пальца. В портрете
// все органы управления увеличены.
//
// Размер сетки раскладка не знает и не выдумывает: сколько барабанов
// и рядов — приходит параметром из конфигурации сервера.

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/** Минимальный размер элемента управления под палец, в реальных пикселях. */
export const MIN_TOUCH_PX = 48;

/** Размер круглой кнопки в дизайнерских пикселях (см. tools/assets/ui.mjs). */
const BUTTON_PX = 76;

/**
 * Во сколько раз увеличить кнопки, чтобы по ним можно было попасть пальцем.
 *
 * Подбирать множители вручную бессмысленно: один и тот же холст
 * растягивается и на 360-пиксельный телефон, и на планшет, и на
 * десктоп. Поэтому считаем от фактического масштаба: кнопка обязана
 * занимать на экране не меньше MIN_TOUCH_PX независимо от устройства.
 * На больших экранах множитель выходит меньше единицы и обрезается —
 * раздувать кнопки там незачем.
 */
function touchBoost(vw, vh, width, height) {
  const scale = Math.min(vw / width, vh / height);
  if (!(scale > 0)) return 1;
  return clamp(MIN_TOUCH_PX / (BUTTON_PX * scale), 1, 2.4);
}

/* ─────────────────────────── портрет ────────────────────────────── */

function portrait(aspect, vw, vh, reels, rows) {
  const width = 1080;
  // Пределы страхуют от крайностей: очень «квадратный» планшет и
  // сверхдлинный телефон не должны ломать композицию.
  const height = Math.round(clamp(width / aspect, 1400, 2500));

  // Барабаны занимают почти всю ширину — на телефоне это главное.
  const margin = 18;
  const inset = 42;
  const cell = Math.floor((width - margin * 2 - inset * 2) / reels);
  const gridW = cell * reels;
  const gridH = cell * rows;
  const frameH = gridH + inset * 2;

  const boostEarly = touchBoost(vw, vh, width, height);

  // Панель прижата к низу. Её высота считается от того, что в неё нужно
  // уложить: три ряда — счётчики, выигрыш и кнопки, — а нижний ряд
  // задаёт крупная круглая кнопка спина. Подбирать высоту «на глаз»
  // нельзя: при увеличенных под палец кнопках спин вылезал за нижний
  // край экрана.
  const spinPx = 180 * (boostEarly * 0.95);          // диаметр в дизайн-пикселях
  const panelH = Math.round(clamp(spinPx + 380, 520, height * 0.36));
  const panelY = height - panelH;

  const rowMeters = panelY + Math.round(panelH * 0.16);
  const rowWin = panelY + Math.round(panelH * 0.36);
  const rowButtons = panelY + panelH - Math.round(spinPx * 0.5) - 34;

  const topY = Math.round(clamp(height * 0.045, 76, 130));
  const topBarBottom = topY + BUTTON_PX;

  // Барабаны — по центру свободного места между верхним рядом кнопок
  // и панелью, чуть ниже середины: сверху остаётся воздух под логотип,
  // и композиция не выглядит съехавшей вверх.
  const free = panelY - topBarBottom;
  // Барабаны ближе к панели, чем к верху: под ними пустая полоса
  // читается как недоделка, а сверху — как небо, ради которого фон
  // и рисовался.
  const frameY = Math.round(topBarBottom + (free - frameH) * 0.78);
  const gridY = frameY + inset;
  const gridX = Math.round((width - gridW) / 2);

  const logoY = Math.round(topBarBottom + (frameY - topBarBottom) * 0.52);
  const boost = touchBoost(vw, vh, width, height);

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

    logo: { x: width / 2, y: logoY, scale: 0.78 },
    freeSpinBadge: { x: width / 2, y: frameY - 92 },

    panel: { x: 0, y: panelY, width, height: panelH },
    meterPlate: { width: 392, height: 128 },
    meters: {
      balance: { x: 232, y: rowMeters },
      bet: { x: width - 232, y: rowMeters },
      win: { x: width / 2, y: rowWin }
    },
    // Кнопки в портрете крупнее ландшафтных: тем же пальцем по тому же
    // экрану, но масштаб холста втрое мельче.
    spinButton: { x: width / 2, y: rowButtons, scale: boost * 0.95 },
    betButtons: {
      // Плюс и минус стоят по краям табло ставки, а не рядом с ним:
      // так между ними остаётся сама цифра, и промахнуться сложнее.
      minus: { x: width - 470, y: rowMeters, scale: boost * 0.95 },
      plus: { x: width - 42 - 38 * boost, y: rowMeters, scale: boost * 0.95 }
    },
    sideButtons: {
      turbo: { x: 46 + 46 * boost, y: rowButtons, scale: boost },
      auto: { x: width - 46 - 46 * boost, y: rowButtons, scale: boost }
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

/* ────────────────────────── ландшафт ────────────────────────────── */

function landscape(aspect, vw, vh, reels, rows) {
  const height = 1080;
  const width = Math.round(clamp(height * aspect, 1400, 2600));
  // Телефон, повёрнутый набок, — это те же 390 пикселей высоты,
  // и кнопкам там нужен тот же запас, что и в портрете.
  const boost = touchBoost(vw, vh, width, height);

  // Высота панели считается от кнопки спина — как и в портрете.
  // При фиксированных 224 пикселях увеличенная под палец кнопка
  // вылезала за нижний край экрана и наезжала на счётчик выигрыша.
  const spinPx = 180 * boost;
  const panelH = Math.round(clamp(spinPx * 0.72 + 96, 224, height * 0.34));
  const panelY = height - panelH;

  const inset = 60;
  // Поле не должно упираться в панель и в верхний ряд кнопок.
  const topBarBottom = 26 + 68 * boost;
  const cell = Math.floor(clamp((panelY - topBarBottom - 40 - inset * 2) / rows, 96, 200));
  const gridW = cell * reels;
  const gridH = cell * rows;
  const gridX = Math.round((width - gridW) / 2);
  const gridY = Math.round(topBarBottom + (panelY - topBarBottom - gridH) / 2 + 12);

  const cx = width / 2;
  const midY = panelY + Math.round(panelH * 0.5);
  const spinX = width - Math.round(spinPx * 0.5) - 28;
  const sideR = Math.round(46 * boost);

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

    logo: { x: cx, y: 66, scale: 0.34 },
    freeSpinBadge: { x: cx, y: panelY - 16 },

    panel: { x: 0, y: panelY, width, height: panelH },
    meterPlate: { width: 330, height: 112 },
    meters: {
      balance: { x: 210, y: midY },
      bet: { x: 620, y: midY },
      win: { x: spinX - Math.round(spinPx * 0.5) - sideR * 2 - 220, y: midY }
    },
    spinButton: { x: spinX, y: midY, scale: boost },
    betButtons: {
      minus: { x: 620 - 202, y: midY, scale: boost * 0.8 },
      plus: { x: 620 + 202, y: midY, scale: boost * 0.8 }
    },
    sideButtons: {
      // Турбо и автоигра стоят колонкой вплотную к спину: в ландшафте
      // на телефоне это единственное место, где они не наезжают
      // ни на счётчики, ни на край экрана.
      turbo: { x: spinX - Math.round(spinPx * 0.5) - sideR, y: midY + sideR, scale: boost * 0.8 },
      auto: { x: spinX - Math.round(spinPx * 0.5) - sideR, y: midY - sideR, scale: boost * 0.8 }
    },
    topButtons: {
      menu: { x: 34 + 34 * boost, y: 26 + 34 * boost, scale: boost },
      sound: { x: 34 + 120 * boost, y: 26 + 34 * boost, scale: boost },
      full: { x: width - 34 - 292 * boost, y: 26 + 34 * boost, scale: boost },
      info: { x: width - 34 - 206 * boost, y: 26 + 34 * boost, scale: boost },
      history: { x: width - 34 - 120 * boost, y: 26 + 34 * boost, scale: boost }
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
 * Раскладка под конкретный экран.
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
