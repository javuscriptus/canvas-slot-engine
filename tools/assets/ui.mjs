// UI-графика «Sochi Sunset»: оправа барабанов, панели, таблички,
// кнопки, баннеры, логотип.
//
//   node tools/assets/build.mjs --only ui     — собрать
//   node tools/assets/probe-ui.mjs --scene    — посмотреть глазами
//
// Размеры заданы в «дизайнерских» пикселях холста 1920×1080;
// растеризатор поднимает их до 2×.
//
// ─────────────────────────── как это устроено ────────────────────────
//
// Объём здесь НЕ рисуется градиентами. Форма собирается из отдельных
// фигур, а свет по ней считает Chromium: feDiffuseLighting и
// feSpecularLighting по карте высот, полученной из альфы (svg-lib.mjs).
// Отсюда два правила, которые нарушать нельзя:
//
//   1. Каждая выпуклая деталь — ОТДЕЛЬНАЯ фигура с зазором. Фильтр
//      видит только силуэт группы; линии, нарисованные внутри сплошного
//      контура, для карты высот не существуют, и «резьба» остаётся
//      плоской раскраской.
//
//   2. Ключевой свет один на всё — LIGHT из svg-lib.mjs (азимут 225°,
//      элевация 55°, то есть сверху-слева). Ни один локальный градиент
//      не имеет права спорить с ним по направлению.
//
// ──────────────────────── и что про nine-slice ───────────────────────
//
// У растяжимых плашек bevel вызывается с `modeling: 0`. modeling даёт
// широкий перепад тона по всему телу фигуры — на цельной кнопке это
// то, что нужно, а на nine-slice середина растягивается и перепад
// разъезжается: центр плашки светлее краёв ровно настолько, насколько
// её растянули. Макро-тон растяжимых плашек задаётся вертикальным
// градиентом заливки, он растяжение переживает.
//
// Отступы slice указываются в ПИКСЕЛЯХ АТЛАСА, то есть вдвое больше
// дизайнерских: клиент делит их на scaleFactor (см. drawNineSlice).

import {
  svgDoc, namespaceSvg, radial, linear, linearV, polar, pointsAttr,
  shade, sparkle, metalText, blurFilter, dropShadow,
  LIGHT, bevel, metalGold, carvedWood, rimLight, contour, dropContact,
  innerGlow, outerGlow, grain, emboss, envGold, texturePattern, defsOf
} from "./svg-lib.mjs";
import { detailUri, materialUri } from "./pbr.mjs";
import {
  rope, volute, leaf, shellFan, anchor,
  cartouchePath, roundRectPath, ringPath
} from "./ornament.mjs";

/* ══════════════════════════ общие материалы ═════════════════════════ */

/**
 * Отражение сцены в золоте. Курорт на закате: сверху холодное небо,
 * ниже раскалённый горизонт, снизу тёплый отскок от гальки.
 * Ось наклонена по ключевому свету — 118° это «сверху-слева вниз-вправо».
 */
const GOLD_ENV = {
  sky: "#FFFBEA", horizonHot: "#FFFFFF", gold: "#FFD24A",
  deep: "#B4740F", shadow: "#5A3402", bounce: "#FFDF96", angle: 118
};

/** То же для мелких деталей: короче размах, иначе бусина уходит в уголь. */
const GOLD_ENV_SOFT = {
  sky: "#FFF6D8", horizonHot: "#FFFFFF", gold: "#FFCE45",
  deep: "#C07C12", shadow: "#7A4705", bounce: "#FFE3A2", angle: 118
};

/**
 * Отражение сцены в золоте, заданное в КООРДИНАТАХ ХОЛСТА.
 *
 * Это не косметика, а условие целостности. `linear()` из svg-lib отдаёт
 * градиент в objectBoundingBox, то есть КАЖДАЯ фигура получает полную
 * рампу по своему габариту: бусина диаметром четыре пикселя проходит
 * путь от неба до тени, ракушка — тоже, планка — тоже. Сорок деталей
 * оправы превращаются в сорок отдельных хромированных значков.
 *
 * userSpaceOnUse кладёт одно общее отражение на весь предмет: верх
 * оправы ловит небо, середина — раскалённый горизонт, низ — отскок от
 * гальки. Форму каждой детали лепит фильтр, а тон приходит от места
 * в кадре. Именно так собран багет в эталонах.
 */
function sheetGold(id, w, h, o = {}) {
  // Ни одна остановка не подходит к белому ближе, чем #FFE3A0.
  // Причина арифметическая: feSpecularLighting ДОБАВЛЯЕТСЯ к диффузу,
  // и на базе светлее ~#FFF0C0 блик упирается в потолок — фаска
  // схлопывается в белое пятно, а золото становится жестью.
  // Светлоту даёт блик, а рампа обязана оставаться цветной.
  const {
    tilt = 0.28, sky = "#FFE3A0", hot = "#FFD24A", gold = "#E8AE22",
    deep = "#AE710D", shadow = "#7A4B06", bounce = "#F2C455"
  } = o;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"
      x1="0" y1="0" x2="${(w * tilt).toFixed(1)}" y2="${h}">
    <stop offset="0%"   stop-color="${sky}"/>
    <stop offset="11%"  stop-color="${hot}"/>
    <stop offset="26%"  stop-color="${gold}"/>
    <stop offset="46%"  stop-color="${deep}"/>
    <stop offset="60%"  stop-color="${shadow}"/>
    <stop offset="74%"  stop-color="${deep}"/>
    <stop offset="90%"  stop-color="${bounce}"/>
    <stop offset="100%" stop-color="${gold}"/>
  </linearGradient>`;
}

/**
 * Золото ДЛЯ БУКВ — единственный случай, где objectBoundingBox уместен:
 * рампа обязана пройти по высоте каждой литеры, а не по строке. Полоса
 * `glint` на 52 % — то самое «окно», которое в вывесках заливают белым:
 * без неё надпись читается однородной жестью.
 */
function goldType(id) {
  return linear(id, [
    ["0%", "#FFF3D0"], ["22%", "#FFD24A"], ["46%", "#E0A11C"],
    ["52%", "#FFF0BC"], ["58%", "#D89412"], ["82%", "#B4740F"], ["100%", "#FFDF96"]
  ], 90);
}

/** Тёмное поле барабанов. Символ обязан быть СВЕТЛЕЕ своей подложки. */
// Прозрачности высокие намеренно. На 0.86 закатное небо просвечивало
// и вымывало поле в нейтральный серый: цвет подложки складывался с
// оранжевым фоном и терял тон. Подложка обязана оставаться СВОЕГО
// цвета — символ читается по контрасту с ней, а не с пейзажем.
const FIELD = {
  top: "#2C4778", mid: "#181F45", low: "#0A0B20", edge: "#04040F",
  alphaTop: 0.93, alphaLow: 0.97
};

/** Тёмный контур доски: родственный дереву, не чёрный. */
const WOOD_EDGE = "#20120A";

/* ─────────────────── локальные рецепты (только для UI) ──────────────── */

/* ─────────────────── ПРО shininess: читать до правок ────────────────
 *
 * feSpecularLighting при ОДНОМ направленном источнике даёт на плоской
 * площадке РОВНЫЙ блик: N постоянна, значит N·H постоянно. При нашем
 * свете (элевация 55°) N·H = 0.9537, и добавка к КАЖДОМУ пикселю
 * плоскости равна specularConstant · 0.9537^shininess:
 *
 *     shininess   8  →  +0.68 · k     дерево выцветало в бежевую фанеру
 *     shininess  18  →  +0.43 · k     тёмная лента баннера уходила в кофе
 *     shininess  30  →  +0.24 · k
 *     shininess  46  →  +0.11 · k
 *     shininess  80  →  +0.02 · k     практически чисто
 *     shininess 110  →  +0.005 · k
 *
 * Отсюда правило: чем БОЛЬШЕ доля плоскости в фигуре, тем ВЫШЕ должен
 * быть shininess. Низкие значения допустимы только там, где плоскости
 * нет вовсе — на узком канте, на бусине, на выкружке багета. Ровно
 * на этом первая версия панелей, дерева и баннеров ушла в пастель:
 * материалы были подобраны «на глаз» по кромке, а середина фигуры
 * молча получала двадцать-сорок процентов белого.
 */

/**
 * Внутренняя тень с ПРОИЗВОЛЬНЫМ смещением.
 * innerShadow() из svg-lib умеет только вертикальное, а тень от оправы
 * на поле барабанов обязана падать вправо-вниз — туда же, куда все
 * остальные тени игры.
 */
function innerCast(id, opts = {}) {
  const { distance = 8, blur = 10, opacity = 0.62, color = "#000000", light = LIGHT } = opts;
  const dx = (light.shadowX * distance).toFixed(2);
  const dy = (light.shadowY * distance).toFixed(2);
  return {
    id, ref: `url(#${id})`,
    def: `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"
        color-interpolation-filters="sRGB">
      <feOffset in="SourceAlpha" dx="${dx}" dy="${dy}" result="ic_o"/>
      <feGaussianBlur in="ic_o" stdDeviation="${blur}" result="ic_b"/>
      <feComposite in="SourceAlpha" in2="ic_b" operator="out" result="ic_band"/>
      <feFlood flood-color="${color}" flood-opacity="${opacity}" result="ic_c"/>
      <feComposite in="ic_c" in2="ic_band" operator="in" result="ic_sh"/>
      <feComposite in="ic_sh" in2="SourceGraphic" operator="over"/>
    </filter>`
  };
}

/** Обесцвечивание и притемнение — состояние disabled одним фильтром. */
function mute(id, opts = {}) {
  const { saturate = 0.14, brightness = 0.58, margin = 40 } = opts;
  return {
    id, ref: `url(#${id})`,
    def: `<filter id="${id}" x="-${margin}%" y="-${margin}%"
        width="${100 + margin * 2}%" height="${100 + margin * 2}%"
        color-interpolation-filters="sRGB">
      <feColorMatrix type="saturate" values="${saturate}" result="mu_s"/>
      <feComponentTransfer in="mu_s">
        <feFuncR type="linear" slope="${brightness}"/>
        <feFuncG type="linear" slope="${brightness}"/>
        <feFuncB type="linear" slope="${brightness}"/>
      </feComponentTransfer>
    </filter>`
  };
}

/** Осветление под наведение курсора: тот же предмет, ближе к свету. */
function lift(id, opts = {}) {
  const { brightness = 1.16, saturate = 1.06, margin = 40 } = opts;
  return {
    id, ref: `url(#${id})`,
    def: `<filter id="${id}" x="-${margin}%" y="-${margin}%"
        width="${100 + margin * 2}%" height="${100 + margin * 2}%"
        color-interpolation-filters="sRGB">
      <feColorMatrix type="saturate" values="${saturate}" result="lf_s"/>
      <feComponentTransfer in="lf_s">
        <feFuncR type="linear" slope="${brightness}"/>
        <feFuncG type="linear" slope="${brightness}"/>
        <feFuncB type="linear" slope="${brightness}"/>
      </feComponentTransfer>
    </filter>`
  };
}

/**
 * Лучи из центра — под баннеры выигрыша и подсветку логотипа.
 * Считается один раз и печётся в текстуру: shadowBlur в рантайме
 * стоит дороже всего остального рендера вместе взятого.
 */
function rayBurst(cx, cy, r, count, o = {}) {
  const { fill = "url(#rayFade)", wide = 4.4, thin = 1.8, inner = 0.08 } = o;
  let out = "";
  for (let i = 0; i < count; i++) {
    const a = (360 / count) * i;
    const w = i % 2 === 0 ? wide : thin;
    const len = i % 2 === 0 ? r : r * 0.66;
    const p = [
      polar(cx, cy, r * inner, a - w),
      polar(cx, cy, len, a - w * 0.3),
      polar(cx, cy, len, a + w * 0.3),
      polar(cx, cy, r * inner, a + w)
    ];
    out += `<polygon points="${pointsAttr(p)}" fill="${fill}"/>`;
  }
  return out;
}

/* ══════════════════════════ оправа барабанов ════════════════════════ */

const FRAME_W = 1120;   // = сетка 1000 + оправа 60 с каждой стороны
const FRAME_H = 720;    // = сетка 600 + оправа 60
const INNER = 37;       // отступ тёмного поля от края картинки

/**
 * Резной багет вокруг игрового поля.
 *
 * Профиль набран из ТРЁХ отдельных колец — наружный валик, основная
 * выкружка и витой канат по внутренней кромке. Одно кольцо любой
 * толщины под фаской даёт ровно одну грань и читается как полоска
 * жёлтого; три кольца с зазорами дают настоящий погонаж, у которого
 * свет ломается три раза.
 *
 * Ограничение, которое диктует клиент: картинка рисуется ПОД барабанами
 * и растягивается ровно на сетку плюс frameInset (60 px). Значит всё,
 * что попадает одновременно в x>60 и y>60, будет закрыто символами.
 * Поэтому орнамент живёт строго в 60-пиксельной кайме: ракушки
 * прижаты к верхним углам, якоря к нижним, картуши сидят в планках.
 */
function reelFrame({ goldDetail }) {
  const W = FRAME_W, H = FRAME_H;

  // Три материала одного золота с разной крупностью фаски: широкая
  // выкружка, тонкий валик и мелкая резьба. Один общий фильтр на всё
  // либо смазывает резьбу, либо дробит планку на блёстки.
  const metal = metalGold("mtl", {
    href: goldDetail, tile: 260, texture: 0.5,
    height: 3.4, depth: 34, anisotropy: 0.66, grooves: 0.08, grooveFreq: 0.07,
    specular: 1.05, shininess: 40, tint: "#FFF3D0"
  });
  const thin = metalGold("thn", {
    href: goldDetail, tile: 180, texture: 0.4,
    height: 2.1, depth: 24, anisotropy: 0.5, grooves: 0.06, grooveFreq: 0.1,
    specular: 1.0, shininess: 58, tint: "#FFF6DA"
  });
  const orn = metalGold("orn", {
    href: goldDetail, tile: 150, texture: 0.38,
    height: 3.2, depth: 32, anisotropy: 0.35, grooves: 0.05, grooveFreq: 0.11,
    specular: 1.05, shininess: 62, tint: "#FFF6DA"
  });
  const rim = rimLight("rl", "#BFEBFF", 2.2, { opacity: 0.17, offset: 2.2 });
  // Тёмный контур есть у каждого предмета в эталонах. Оправа лежит на
  // закатном небе почти той же светлоты, и без него её край растворяется.
  const ct = contour("ct", "#31190A", 2.6, { opacity: 0.9, softness: 0.7 });
  const cast = innerCast("cast", { distance: 14, blur: 16, opacity: 0.72 });
  const drop = dropContact("drop", 0.5, { distance: 10, contactBlur: 3, ambientBlur: 20, ambient: 0.38 });
  const gr = grain("gn", 0.03, { freq: 0.7 });

  const defs = `
    ${sheetGold("eg", W, H)}
    ${sheetGold("egOrn", W, H, { tilt: 0.34, deep: "#CE8C14", shadow: "#9C5F08" })}
    ${linearV("field", [
      ["0%", FIELD.top, FIELD.alphaTop],
      ["38%", FIELD.mid, 0.9],
      ["78%", FIELD.low, FIELD.alphaLow],
      ["100%", FIELD.edge, FIELD.alphaLow]
    ])}
    ${linear("seam", [
      ["0%", "#000000", 0], ["38%", "#000000", 0.34],
      ["50%", "#000000", 0.42], ["62%", "#7FE3E8", 0.09], ["100%", "#000000", 0]
    ], 0)}
    ${radial("fieldWarm", "#FF9A4C4D", "#FF9A4C00", "50%", "2%", "78%")}
    ${radial("fieldVig", "#00000000", "#000000AA", "50%", "50%", "74%")}
    ${defsOf(metal, thin, orn, rim, ct, cast, drop, gr)}
  `;

  /* ── тёмное поле барабанов ───────────────────────────────────────── */
  //
  // Швы между барабанами запечены прямо в поле. Клиент рисует оправу
  // ПОД лентами и растягивает её ровно на сетку плюс кайму, поэтому
  // шаг швов масштабируется вместе с ячейкой и совпадает с колонками
  // без единой строчки в client/src. Швы намеренно мягкие: в портрете
  // отношение каймы к ячейке другое, и жёсткая линия выдала бы
  // расхождение в несколько пикселей — мягкая не выдаёт.
  const fieldRect = `x="${INNER}" y="${INNER}" width="${W - INNER * 2}" height="${H - INNER * 2}" rx="14"`;
  const cell = (W - 120) / 5;
  let seams = "";
  for (let i = 1; i < 5; i++) {
    const x = 60 + cell * i;
    seams += `<rect x="${x - 7}" y="${INNER + 4}" width="14" height="${H - INNER * 2 - 8}" fill="url(#seam)"/>`;
  }

  const field = `
    <g filter="${cast.ref}"><rect ${fieldRect} fill="url(#field)"/></g>
    ${seams}
    <rect ${fieldRect} fill="url(#fieldWarm)"/>
    <rect ${fieldRect} fill="url(#fieldVig)"/>
    <rect ${fieldRect} fill="none" stroke="#000000" stroke-opacity="0.5" stroke-width="2.4"/>`;

  /* ── погонаж ─────────────────────────────────────────────────────── */
  //
  // Профиль набран ДВУМЯ выкружками с тёмной ложбиной между ними, а не
  // одной широкой планкой. Разница принципиальная: у широкой планки
  // карта высот даёт один пологий купол, и на экране это ровная жёлтая
  // лента. Две узкие выкружки дают ДВА блика и две тени, то есть
  // настоящий погонаж — именно так читается багет в эталонах.
  const ogee = `
    <path d="${ringPath(9.5, 9.5, W - 19, H - 19, 24, 15)}" fill="url(#eg)" fill-rule="evenodd"/>
    <path d="${ringPath(26.5, 26.5, W - 53, H - 53, 16, 9.5)}" fill="url(#eg)" fill-rule="evenodd"/>`;
  // Наружный валик — тонкий, своим фильтром.
  const fillets = `
    <path d="${ringPath(1.5, 1.5, W - 3, H - 3, 30, 6)}" fill="url(#eg)" fill-rule="evenodd"/>`;

  /* ── витой канат по внутренней кромке ────────────────────────────── */
  //
  // Пряди делаются ДЛИННЕЕ шага (half > period), поэтому соседние
  // перекрываются и жгут читается сплошным. Когда длина пряди равна
  // шагу, канат распадается на цепочку шариков — именно так выглядела
  // первая версия.
  //
  // Горизонтальные прогоны РАЗОРВАНЫ под картушами: канат, уходящий
  // под плашку, торчит из-под неё огрызками и читается как брак.
  const r0 = 43;
  const ropeOpt = { width: 14, period: 13, tilt: 30, core: 0.84, fill: "url(#egOrn)" };
  const TOP_GAP = 250, BOT_GAP = 212;
  const ropes = [
    rope(150, r0, W / 2 - TOP_GAP, r0, { ...ropeOpt, tilt: 30 }),
    rope(W / 2 + TOP_GAP, r0, W - 150, r0, { ...ropeOpt, tilt: 30 }),
    rope(150, H - r0, W / 2 - BOT_GAP, H - r0, { ...ropeOpt, tilt: -30 }),
    rope(W / 2 + BOT_GAP, H - r0, W - 150, H - r0, { ...ropeOpt, tilt: -30 }),
    rope(r0, 150, r0, H - 150, { ...ropeOpt, tilt: -30 }),
    rope(W - r0, 150, W - r0, H - 150, { ...ropeOpt, tilt: 30 })
  ].join("");

  /* ── угловые акценты ─────────────────────────────────────────────── */
  //
  // Где им можно жить. Картинка рисуется ПОД барабанами и растягивается
  // на сетку плюс 60 px каймы, значит закрыт ровно прямоугольник
  // 60…W−60 × 60…H−60. Кайма шириной 60 свободна на всю длину, и
  // угловой мотив, развёрнутый ВДОЛЬ диагонали наружу, помещается
  // целиком: его дуга уходит в верхнюю и левую планки, а «слепой»
  // квадрант остаётся пустым.
  const F = `url(#egOrn)`;

  const shellCorner = (x, y, rot) => `
    <g transform="translate(${x} ${y})">
      ${shellFan(0, 0, 44, { ribs: 8, spread: 184, rotation: rot, gap: 5, hinge: 0.24, wave: 0.05, fill: F })}
    </g>`;

  const anchorCorner = (x, y) => `
    <g transform="translate(${x} ${y})">
      ${anchor(0, 0, 78, { fill: F, thick: 0.115 })}
    </g>`;

  // Ус аканта примыкает ВПЛОТНУЮ к угловому мотиву и уходит вдоль
  // планки, а не рассыпается по ней. Длинная лента одинаковых завитков
  // по всему периметру превращает багет в шум: глазу не за что
  // зацепиться, и дорогая резьба читается как рябь.
  const whisker = `
    ${volute(16, 0, 15, { turns: 1.3, start: 205, thick: 0.46, decay: 2.6, dir: 1, fill: F })}
    ${leaf(32, 2, 68, { angle: -6, width: 0.14, curl: 0.09, fill: F })}
    ${volute(98, -3, 9, { turns: 1.1, start: 160, thick: 0.5, decay: 2.3, dir: -1, fill: F })}`;
  const put = (x, y, rot, sy = 1) =>
    `<g transform="translate(${x} ${y}) rotate(${rot}) scale(1 ${sy})">${whisker}</g>`;

  const corners = `
    ${shellCorner(46, 46, -135)}
    ${shellCorner(W - 46, 46, -45)}
    ${anchorCorner(44, H - 46)}
    ${anchorCorner(W - 44, H - 46)}
    ${put(96, 17, 0, 1)}          ${put(W - 96, 17, 180, -1)}
    ${put(104, H - 17, 0, -1)}    ${put(W - 104, H - 17, 180, 1)}
    ${put(17, 96, 90, -1)}        ${put(17, H - 104, -90, 1)}
    ${put(W - 17, 96, 90, 1)}     ${put(W - 17, H - 104, -90, -1)}
  `;

  /* ── картуши ─────────────────────────────────────────────────────── */
  const cartouche = (cx, cy, w, h) => `
    <path d="${cartouchePath(cx, cy, w, h, { waist: 0.22, notch: 0.07 })}" fill="url(#eg)"/>`;

  const cartoucheTrim = (cx, cy, w, h) => `
    ${volute(cx - w / 2 - 2, cy - h * 0.14, 16, { turns: 1.25, start: 150, thick: 0.5, decay: 2.5, dir: -1, fill: F })}
    ${volute(cx + w / 2 + 2, cy - h * 0.14, 16, { turns: 1.25, start: 30, thick: 0.5, decay: 2.5, dir: 1, fill: F })}
    ${leaf(cx - w / 2 - 26, cy + h * 0.1, 46, { angle: 178, width: 0.19, curl: 0.06, fill: F })}
    ${leaf(cx + w / 2 + 26, cy + h * 0.1, 46, { angle: 2, width: 0.19, curl: -0.06, fill: F })}`;

  // Утопленное поле картуша: надпись обязана лежать в углублении,
  // иначе её не отличить от металла вокруг.
  const well = (cx, cy, w, h) => {
    const d = cartouchePath(cx, cy, w, h, { waist: 0.26, notch: 0.08 });
    return `<path d="${d}" fill="#1A0C02" fill-opacity="0.86"/>
      <path d="${d}" fill="none" stroke="#000000" stroke-opacity="0.5" stroke-width="3"/>
      <path d="${d}" fill="none" stroke="#FFE08A" stroke-opacity="0.28" stroke-width="1.4"
            transform="translate(0 1.6)"/>`;
  };

  const body = `
    <g filter="${drop.ref}">
      ${field}
      <g filter="${ct.ref}"><g filter="${gr.ref}">
        <g filter="${rim.ref}">
          <g filter="${metal.ref}">
            ${ogee}
            ${cartouche(W / 2, 29, 470, 48)}
            ${cartouche(W / 2, H - 29, 390, 44)}
          </g>
          <g filter="${thin.ref}">${fillets}</g>
          <!-- ложбины между обломами. Зазор в полтора пикселя между
               кольцами фильтр размывает почти в ноль; явная тёмная
               линия — это то, чем ступень профиля читается с двух
               метров, а не только на стопроцентном увеличении -->
          <path d="${roundRectPath(8.7, 8.7, W - 17.4, H - 17.4, 24)}"
                fill="none" stroke="#3A2109" stroke-opacity="0.85" stroke-width="2.4"/>
          <path d="${roundRectPath(25.6, 25.6, W - 51.2, H - 51.2, 16)}"
                fill="none" stroke="#3A2109" stroke-opacity="0.8" stroke-width="2.2"/>
          <path d="${roundRectPath(36.4, 36.4, W - 72.8, H - 72.8, 12)}"
                fill="none" stroke="#2A1706" stroke-opacity="0.55" stroke-width="2"/>
          <g filter="${orn.ref}">
            ${ropes}${corners}
            ${cartoucheTrim(W / 2, 29, 470, 48)}
            ${cartoucheTrim(W / 2, H - 29, 390, 44)}
          </g>
        </g>
      </g></g>
      ${well(W / 2, 29, 372, 27)}
      ${well(W / 2, H - 29, 302, 23)}
    </g>`;

  return svgDoc(W, H, defs, body);
}

/* ═══════════════════════ подложка поля барабанов ════════════════════ */

/**
 * reel_bg — растяжимая подложка под символы.
 *
 * Ключевой приём эталонов: символ ВСЕГДА светлее того, на чём лежит.
 * Поэтому подложка не «фон в цвет темы», а затемнение: полупрозрачная
 * тёмная плита с лёгким тёплым отсветом сверху (солнце за кадром)
 * и виньеткой по углам.
 */
function reelBg(size = 160) {
  const s = size;
  const cast = innerCast("cast", { distance: 9, blur: 12, opacity: 0.55 });
  const defs = `
    ${defsOf(cast)}
    ${linearV("bgFill", [
      ["0%", FIELD.top, 0.88], ["40%", FIELD.mid, 0.92],
      ["100%", FIELD.low, 0.95]
    ])}
    ${radial("bgWarm", "#FF9A4C33", "#FF9A4C00", "50%", "0%", "80%")}
    ${radial("bgVig", "#00000000", "#000000B0", "50%", "50%", "70%")}
  `;
  const r = `x="2" y="2" width="${s - 4}" height="${s - 4}" rx="10"`;
  return svgDoc(s, s, defs, `
    <g filter="${cast.ref}"><rect ${r} fill="url(#bgFill)"/></g>
    <rect ${r} fill="url(#bgWarm)"/>
    <rect ${r} fill="url(#bgVig)"/>
    <rect ${r} fill="none" stroke="#FFE08A" stroke-opacity="0.12" stroke-width="1.5"/>`);
}

/**
 * Разделитель барабанов. В эталонах он есть всегда и всегда заметен:
 * без вертикальных швов пять барабанов сливаются в одно окно и глаз
 * теряет ритм. Здесь это утопленный жёлоб — тёмная сердцевина
 * с двумя световыми кромками.
 */
// Источник короткий намеренно: разделитель — мягкий градиент, клиент
// растянет его на высоту поля. Кадр 16x600 в дизайне (32x1200 в атласе)
// задавал полку такой же высоты, и упаковщик терял на ней два
// мегапикселя — четверть всего атласа ради одной полоски.
function reelDivider() {
  const W = 16, H = 256;
  const defs = `
    ${linear("divCore", [
      ["0%", "#000000", 0], ["10%", "#000000", 0.55],
      ["50%", "#000000", 0.62], ["90%", "#000000", 0.55], ["100%", "#000000", 0]
    ], 90)}
    ${linear("divLit", [
      ["0%", "#FFE08A", 0], ["14%", "#FFE08A", 0.5],
      ["50%", "#FFF3C4", 0.62], ["86%", "#FFE08A", 0.5], ["100%", "#FFE08A", 0]
    ], 90)}
    ${linear("divShade", [
      ["0%", "#03080F", 0], ["50%", "#03080F", 0.5], ["100%", "#03080F", 0]
    ], 90)}
  `;
  return svgDoc(W, H, defs, `
    <rect x="3" y="0" width="10" height="${H}" fill="url(#divCore)"/>
    <rect x="2" y="0" width="2.2" height="${H}" fill="url(#divShade)"/>
    <rect x="11.8" y="0" width="2.2" height="${H}" fill="url(#divLit)"/>
    <rect x="7.2" y="0" width="1.6" height="${H}" fill="url(#divLit)" opacity="0.35"/>`);
}

/* ═════════════════════════ деревянные таблички ══════════════════════ */

/**
 * Табличка из тёмного дерева в золотой окантовке — nine-slice.
 *
 * Дерево берётся настоящее: цветная карта ambientCG идёт заливкой
 * через <pattern>, карта детали — микрорельефом внутри carvedWood.
 * Заливать форму одной только фотографией нельзя: макро-тон обязан
 * задаваться формой доски, а не случайным местом плитки.
 *
 * Весь орнамент сидит в углах, внутри slice-отступов: середина
 * растягивается под содержимое и обязана быть однородной.
 */
function woodSign(w, h, o = {}) {
  const {
    woodTile = null, woodDetail = null, goldDetail = null,
    accent = "#FFD24A", corner = 26, plateau = 0.62
  } = o;
  const pad = 9;                     // ширина золотой окантовки
  const wood = carvedWood("cw", {
    href: woodDetail, tile: 190, texture: 0.72,
    height: 4.2, depth: 15, grainFreq: 0.011, grainAmount: 0.3, wear: 0.3,
    specular: 0.55, shininess: 85
  });
  const gold = metalGold("mg", {
    href: goldDetail, tile: 140, texture: 0.55,
    height: 3.4, depth: 24, anisotropy: 0.5, grooves: 0.08, grooveFreq: 0.09,
    specular: 1.35, shininess: 48
  });
  const orn = bevel("bv", { height: 2.6, depth: 26, plateau, modeling: 0, specular: 1.4, shininess: 80 });
  const drop = dropContact("drop", 0.5, { distance: 9, contactBlur: 3, ambientBlur: 16, ambient: 0.4 });
  const cast = innerCast("cast", { distance: 6, blur: 8, opacity: 0.5 });
  const ln = contour("ln", WOOD_EDGE, 2, { opacity: 0.9, softness: 0.4 });

  const defs = `
    ${sheetGold("eg", w, h, { tilt: 0.4 })}
    ${woodTile ? texturePattern("woodPat", woodTile, { tile: 190, opacity: 1 }).def : ""}
    ${linearV("woodTone", [
      ["0%", "#8A5A2E", 0.32], ["40%", "#2A1708", 0.22],
      ["100%", "#0E0703", 0.62]
    ])}
    ${radial("woodVig", "#00000000", "#00000078", "50%", "44%", "78%")}
    ${defsOf(wood, gold, orn, drop, cast, ln)}
  `;

  const board = roundRectPath(pad, pad, w - pad * 2, h - pad * 2, corner - pad);
  const frame = ringPath(1.5, 1.5, w - 3, h - 3, corner, pad);

  // Угловая накладка: волюта с двумя листьями, растущая внутрь доски.
  // Живёт целиком внутри slice-отступа — середину растянет клиент.
  const br = corner * 0.9;
  const bracket = (x, y, sx, sy) => `
    <g transform="translate(${x} ${y}) scale(${sx} ${sy})">
      ${volute(0, 0, br * 0.42, { turns: 1.2, start: 214, thick: 0.5, decay: 2.5, dir: 1, fill: "url(#eg)" })}
      ${leaf(br * 0.34, -br * 0.16, br * 1.15, { angle: 4, width: 0.2, curl: 0.06, fill: "url(#eg)" })}
      ${leaf(-br * 0.16, br * 0.34, br * 1.15, { angle: 86, width: 0.2, curl: -0.06, fill: "url(#eg)" })}
      <circle cx="${(br * 0.06).toFixed(2)}" cy="${(br * 0.06).toFixed(2)}" r="${(br * 0.17).toFixed(2)}" fill="url(#eg)"/>
    </g>`;
  const cIn = pad + corner * 0.55;

  return svgDoc(w, h, defs, `
    <g filter="${drop.ref}">
      <g filter="${ln.ref}">
        <g filter="${cast.ref}">
          <g filter="${wood.ref}">
            <path d="${board}" fill="${woodTile ? "url(#woodPat)" : "#5A3A1E"}"/>
          </g>
        </g>
        <path d="${board}" fill="url(#woodTone)"/>
        <path d="${board}" fill="url(#woodVig)"/>
        <!-- цветная врезка: единственное, чем таблички отличаются друг
             от друга, — золото у всех обязано быть одним и тем же -->
        <path d="${roundRectPath(pad + 6, pad + 6, w - (pad + 6) * 2, h - (pad + 6) * 2, Math.max(2, corner - pad - 6))}"
              fill="none" stroke="${accent}" stroke-opacity="0.42" stroke-width="1.8"/>
        <g filter="${gold.ref}"><path d="${frame}" fill="url(#eg)" fill-rule="evenodd"/></g>
        <g filter="${orn.ref}">
          ${bracket(cIn, cIn, 1, 1)}
          ${bracket(w - cIn, cIn, -1, 1)}
          ${bracket(cIn, h - cIn, 1, -1)}
          ${bracket(w - cIn, h - cIn, -1, -1)}
        </g>
      </g>
    </g>`);
}

/* ═══════════════════════════ панели HUD ═════════════════════════════ */

/**
 * Нижняя панель управления.
 *
 * Была толстой коробкой с золотой планкой во всю высоту — читалась как
 * отдельный блок, приклеенный к сцене. В эталонах панель почти
 * невидима: тонкая световая линия сверху и мягкое затемнение под ней,
 * сквозь которое видно фон. Здесь ровно это: волосяная золотая линия,
 * тень под ней и градиент прозрачности, набирающий плотность к низу.
 */
function panelBar(size = 128) {
  const s = size;
  const defs = `
    ${linearV("barWash", [
      ["0%", "#04101C", 0.0], ["7%", "#04101C", 0.30], ["26%", "#04101C", 0.52],
      ["60%", "#020A14", 0.68], ["100%", "#01060D", 0.86]
    ])}
    ${linear("barLine", [
      ["0%", "#8A5206", 0], ["12%", "#FFD24A", 0.85], ["50%", "#FFF3C4", 1],
      ["88%", "#FFD24A", 0.85], ["100%", "#8A5206", 0]
    ], 0)}
  `;
  return svgDoc(s, s, defs, `
    <rect x="0" y="5" width="${s}" height="${s - 5}" fill="url(#barWash)"/>
    <rect x="0" y="4.6" width="${s}" height="2.2" fill="url(#barLine)"/>
    <rect x="0" y="6.8" width="${s}" height="3" fill="#000000" opacity="0.42"/>
    <rect x="0" y="0" width="${s}" height="4.6" fill="#FFE08A" opacity="0.05"/>`);
}

/** Плашка «тёмное стекло в золотой оправе» — модалки, тосты, бейдж. */
function panel(size = 128) {
  const s = size, r = 22, t = 5;
  const gold = bevel("bv", { height: 3, depth: 26, plateau: 0.6, modeling: 0, specular: 1.35, shininess: 80 });
  const cast = innerCast("cast", { distance: 7, blur: 9, opacity: 0.6 });
  const drop = dropContact("drop", 0.5, { distance: 8, contactBlur: 3, ambientBlur: 16, ambient: 0.42 });
  const defs = `
    ${envGold("eg", GOLD_ENV_SOFT)}
    ${linearV("glassPanel", [
      ["0%", "#22103C", 0.94], ["45%", "#120726", 0.96], ["100%", "#070213", 0.97]
    ])}
    ${defsOf(gold, cast, drop)}
  `;
  return svgDoc(s, s, defs, `
    <g filter="${drop.ref}">
      <g filter="${cast.ref}">
        <rect x="${t}" y="${t}" width="${s - t * 2}" height="${s - t * 2}" rx="${r - t}" fill="url(#glassPanel)"/>
      </g>
      <g filter="${gold.ref}">
        <path d="${ringPath(1.5, 1.5, s - 3, s - 3, r, t)}" fill="url(#eg)" fill-rule="evenodd"/>
      </g>
      <rect x="${t + 2}" y="${t + 2}" width="${s - t * 2 - 4}" height="${s - t * 2 - 4}" rx="${r - t - 2}"
            fill="none" stroke="#FFE08A" stroke-opacity="0.16" stroke-width="1.4"/>
    </g>`);
}

/** Плашка без золота — история, автоигра, второстепенные списки. */
function panelDark(size = 112) {
  const s = size, r = 18;
  const cast = innerCast("cast", { distance: 6, blur: 8, opacity: 0.55 });
  const drop = dropContact("drop", 0.45, { distance: 7, contactBlur: 3, ambientBlur: 14, ambient: 0.38 });
  const defs = `
    ${defsOf(cast, drop)}
    ${linearV("darkFill", [
      ["0%", "#241340", 0.9], ["55%", "#100628", 0.93], ["100%", "#05010D", 0.95]
    ])}
    ${linear("darkEdge", [["0%", "#FFD24A", 0.8], ["50%", "#B4740F", 0.55], ["100%", "#5A3402", 0.7]], 118)}
  `;
  return svgDoc(s, s, defs, `
    <g filter="${drop.ref}">
      <g filter="${cast.ref}">
        <rect x="3" y="3" width="${s - 6}" height="${s - 6}" rx="${r}" fill="url(#darkFill)"/>
      </g>
      <rect x="3" y="3" width="${s - 6}" height="${s - 6}" rx="${r}"
            fill="none" stroke="url(#darkEdge)" stroke-width="2.6"/>
      <rect x="6.5" y="6.5" width="${s - 13}" height="${s - 13}" rx="${r - 3}"
            fill="none" stroke="#FFE08A" stroke-opacity="0.13" stroke-width="1.2"/>
    </g>`);
}

/** Табло счётчика: цифры обязаны читаться как на приборе, а не на фоне. */
function meterPlate(size = 112) {
  const s = size, r = 16, t = 6;
  const gold = bevel("bv", { height: 2.4, depth: 24, plateau: 0.62, modeling: 0, specular: 1.3, shininess: 80 });
  const cast = innerCast("cast", { distance: 8, blur: 9, opacity: 0.78 });
  const defs = `
    ${envGold("eg", GOLD_ENV_SOFT)}
    ${linearV("meterGlass", [
      ["0%", "#000407", 0.99], ["46%", "#07293A", 0.99], ["100%", "#01090F", 0.99]
    ])}
    ${defsOf(gold, cast)}
  `;
  return svgDoc(s, s, defs, `
    <g filter="${cast.ref}">
      <rect x="${t}" y="${t}" width="${s - t * 2}" height="${s - t * 2}" rx="${r - t}" fill="url(#meterGlass)"/>
    </g>
    <g filter="${gold.ref}">
      <path d="${ringPath(1, 1, s - 2, s - 2, r, t)}" fill="url(#eg)" fill-rule="evenodd"/>
    </g>
    <rect x="${t + 1.5}" y="${t + 1.5}" width="${s - t * 2 - 3}" height="${(s - t * 2 - 3) * 0.42}"
          rx="${r - t - 1}" fill="#8FE8FF" opacity="0.05"/>`);
}

/* ═══════════════════════════════ кнопки ═════════════════════════════ */

const ICONS = {
  // Две дуги со стрелками. Дуги намеренно короткие (по 150°, а не по
  // 270°) и тонкие: при обводке в 9 % диаметра плюс контур плюс фаска
  // они сливались в сплошное белое кольцо, и знак «спин» пропадал.
  spin: (s) => {
    const r = s * 0.28, c = s * 0.5, w = s * 0.055;
    const RD = Math.PI / 180;
    const arc = (a0, a1) => {
      const p0 = polar(c, c, r, a0), p1 = polar(c, c, r, a1);
      return `<path d="M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}
        A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}"
        fill="none" stroke="#fff" stroke-width="${w.toFixed(2)}" stroke-linecap="butt"/>`;
    };
    // Наконечник строится по КАСАТЕЛЬНОЙ к дуге. Треугольник, привязанный
    // к радиусу (как было), торчит наружу кольца и превращает знак
    // в кляксу.
    const head = (a) => {
      const p = polar(c, c, r, a);
      const tx = -Math.sin(a * RD), ty = Math.cos(a * RD);
      const nx = Math.cos(a * RD), ny = Math.sin(a * RD);
      const L = s * 0.1, D = s * 0.062;
      return `<polygon points="${pointsAttr([
        { x: p.x + tx * L, y: p.y + ty * L },
        { x: p.x + nx * D, y: p.y + ny * D },
        { x: p.x - nx * D, y: p.y - ny * D }
      ])}" fill="#fff"/>`;
    };
    return `${arc(-58, 106)}${arc(122, 286)}${head(112)}${head(292)}`;
  },

  stop: (s) => `<rect x="${s * 0.33}" y="${s * 0.33}" width="${s * 0.34}" height="${s * 0.34}"
      rx="${s * 0.07}" fill="#fff"/>`,

  full: (s) => {
    const a = s * 0.26, b = s * 0.74, l = s * 0.15;
    return `<g fill="none" stroke="#fff" stroke-width="${s * 0.075}"
              stroke-linecap="round" stroke-linejoin="round">
      <path d="M ${a + l} ${a} H ${a} V ${a + l}"/><path d="M ${b - l} ${a} H ${b} V ${a + l}"/>
      <path d="M ${a + l} ${b} H ${a} V ${b - l}"/><path d="M ${b - l} ${b} H ${b} V ${b - l}"/>
    </g>`;
  },

  fullExit: (s) => {
    const a = s * 0.24, b = s * 0.76, m1 = s * 0.44, m2 = s * 0.56;
    return `<g fill="none" stroke="#fff" stroke-width="${s * 0.075}"
              stroke-linecap="round" stroke-linejoin="round">
      <path d="M ${a} ${m1} H ${m1} V ${a}"/><path d="M ${b} ${m1} H ${m2} V ${a}"/>
      <path d="M ${a} ${m2} H ${m1} V ${b}"/><path d="M ${b} ${m2} H ${m2} V ${b}"/>
    </g>`;
  },

  turbo: (s) => `<polygon points="${pointsAttr([
    { x: s * 0.58, y: s * 0.11 }, { x: s * 0.29, y: s * 0.55 }, { x: s * 0.47, y: s * 0.55 },
    { x: s * 0.42, y: s * 0.89 }, { x: s * 0.71, y: s * 0.45 }, { x: s * 0.53, y: s * 0.45 }
  ])}" fill="#fff"/>`,

  auto: (s) => `
    <g fill="none" stroke="#fff" stroke-width="${s * 0.085}" stroke-linecap="round">
      <path d="M ${s * 0.5} ${s * 0.2} A ${s * 0.3} ${s * 0.3} 0 1 1 ${s * 0.24} ${s * 0.65}"/>
    </g>
    <polygon points="${pointsAttr([
      { x: s * 0.5, y: s * 0.08 }, { x: s * 0.5, y: s * 0.32 }, { x: s * 0.7, y: s * 0.2 }
    ])}" fill="#fff"/>
    <circle cx="${s * 0.5}" cy="${s * 0.52}" r="${s * 0.07}" fill="#fff"/>`,

  soundOn: (s) => `
    <path d="M ${s * 0.24} ${s * 0.4} L ${s * 0.36} ${s * 0.4} L ${s * 0.5} ${s * 0.26}
             L ${s * 0.5} ${s * 0.74} L ${s * 0.36} ${s * 0.6} L ${s * 0.24} ${s * 0.6} Z" fill="#fff"/>
    <g fill="none" stroke="#fff" stroke-width="${s * 0.06}" stroke-linecap="round">
      <path d="M ${s * 0.6} ${s * 0.38} A ${s * 0.14} ${s * 0.14} 0 0 1 ${s * 0.6} ${s * 0.62}"/>
      <path d="M ${s * 0.69} ${s * 0.29} A ${s * 0.26} ${s * 0.26} 0 0 1 ${s * 0.69} ${s * 0.71}"/>
    </g>`,

  soundOff: (s) => `
    <path d="M ${s * 0.24} ${s * 0.4} L ${s * 0.36} ${s * 0.4} L ${s * 0.5} ${s * 0.26}
             L ${s * 0.5} ${s * 0.74} L ${s * 0.36} ${s * 0.6} L ${s * 0.24} ${s * 0.6} Z" fill="#fff"/>
    <g stroke="#fff" stroke-width="${s * 0.07}" stroke-linecap="round">
      <line x1="${s * 0.6}" y1="${s * 0.38}" x2="${s * 0.8}" y2="${s * 0.62}"/>
      <line x1="${s * 0.8}" y1="${s * 0.38}" x2="${s * 0.6}" y2="${s * 0.62}"/>
    </g>`,

  menu: (s) => `<g stroke="#fff" stroke-width="${s * 0.08}" stroke-linecap="round">
      <line x1="${s * 0.28}" y1="${s * 0.35}" x2="${s * 0.72}" y2="${s * 0.35}"/>
      <line x1="${s * 0.28}" y1="${s * 0.5}"  x2="${s * 0.72}" y2="${s * 0.5}"/>
      <line x1="${s * 0.28}" y1="${s * 0.65}" x2="${s * 0.72}" y2="${s * 0.65}"/>
    </g>`,

  info: (s) => `
    <circle cx="${s * 0.5}" cy="${s * 0.29}" r="${s * 0.055}" fill="#fff"/>
    <rect x="${s * 0.445}" y="${s * 0.4}" width="${s * 0.11}" height="${s * 0.32}"
          rx="${s * 0.055}" fill="#fff"/>`,

  close: (s) => `<g stroke="#fff" stroke-width="${s * 0.09}" stroke-linecap="round">
      <line x1="${s * 0.32}" y1="${s * 0.32}" x2="${s * 0.68}" y2="${s * 0.68}"/>
      <line x1="${s * 0.68}" y1="${s * 0.32}" x2="${s * 0.32}" y2="${s * 0.68}"/>
    </g>`,

  plus: (s) => `<g stroke="#fff" stroke-width="${s * 0.1}" stroke-linecap="round">
      <line x1="${s * 0.3}" y1="${s * 0.5}" x2="${s * 0.7}" y2="${s * 0.5}"/>
      <line x1="${s * 0.5}" y1="${s * 0.3}" x2="${s * 0.5}" y2="${s * 0.7}"/>
    </g>`,

  minus: (s) => `<g stroke="#fff" stroke-width="${s * 0.1}" stroke-linecap="round">
      <line x1="${s * 0.3}" y1="${s * 0.5}" x2="${s * 0.7}" y2="${s * 0.5}"/>
    </g>`,

  history: (s) => `
    <circle cx="${s * 0.5}" cy="${s * 0.5}" r="${s * 0.28}" fill="none" stroke="#fff" stroke-width="${s * 0.075}"/>
    <g stroke="#fff" stroke-width="${s * 0.075}" stroke-linecap="round">
      <line x1="${s * 0.5}" y1="${s * 0.5}" x2="${s * 0.5}" y2="${s * 0.31}"/>
      <line x1="${s * 0.5}" y1="${s * 0.5}" x2="${s * 0.64}" y2="${s * 0.58}"/>
    </g>`,

  chevronDown: (s) => `<polyline points="${s * 0.32},${s * 0.42} ${s * 0.5},${s * 0.6} ${s * 0.68},${s * 0.42}"
      fill="none" stroke="#fff" stroke-width="${s * 0.09}" stroke-linecap="round" stroke-linejoin="round"/>`,

  // Покупка бонуса: мешочек с монетой — понятнее корзины и не требует
  // локализации.
  buy: (s) => `
    <path d="M ${s * 0.5} ${s * 0.22}
             C ${s * 0.34} ${s * 0.3} ${s * 0.24} ${s * 0.46} ${s * 0.24} ${s * 0.62}
             a ${s * 0.26} ${s * 0.26} 0 0 0 ${s * 0.52} 0
             c 0 ${-s * 0.16} ${-s * 0.1} ${-s * 0.32} ${-s * 0.26} ${-s * 0.4} Z" fill="#fff"/>
    <path d="M ${s * 0.4} ${s * 0.2} L ${s * 0.6} ${s * 0.2} L ${s * 0.54} ${s * 0.3}
             L ${s * 0.46} ${s * 0.3} Z" fill="#fff"/>
    <circle cx="${s * 0.5}" cy="${s * 0.62}" r="${s * 0.12}" fill="#B8730A"/>`,

  // Таблица выплат.
  paytable: (s) => `<g fill="#fff">
      <rect x="${s * 0.26}" y="${s * 0.28}" width="${s * 0.48}" height="${s * 0.08}" rx="${s * 0.03}"/>
      <rect x="${s * 0.26}" y="${s * 0.46}" width="${s * 0.34}" height="${s * 0.08}" rx="${s * 0.03}"/>
      <rect x="${s * 0.26}" y="${s * 0.64}" width="${s * 0.42}" height="${s * 0.08}" rx="${s * 0.03}"/>
    </g>`
};

/**
 * Круглая кнопка.
 *
 * Собирается из четырёх независимых тел, у каждого своя фаска:
 * гнездо (тёмный торец под кольцом), кольцо, сердцевина и значок.
 * Одна фигура с градиентом даёт «наклейку» — именно так выглядела
 * прежняя кнопка.
 *
 * state: normal | hover | pressed | disabled
 */
function roundButton(size, icon, o = {}) {
  const { variant = "ghost", state = "normal", goldDetail = null, accent = null } = o;
  const s = size;
  const primary = variant === "primary";
  const pressed = state === "pressed";
  const R = s * 0.455;
  const ringW = primary ? s * 0.085 : s * 0.062;
  const coreR = R - ringW;
  const sink = pressed ? s * 0.018 : 0;

  const ring = metalGold("ring", {
    href: goldDetail, tile: s * 0.9, texture: 0.55,
    height: s * 0.022, depth: 28, anisotropy: 0.72, grooves: 0.08, grooveFreq: 0.1,
    specular: 1.45, shininess: 52, tint: "#FFF8E0"
  });
  // Сердцевина почти плоская, поэтому shininess высокий: иначе
  // ровная добавка белого съедает весь цвет заливки.
  const dome = bevel("dome", {
    height: s * 0.055, depth: pressed ? 16 : 30, plateau: 0.5,
    modeling: pressed ? 0.35 : 0.85, specular: primary ? 1.4 : 1.0,
    shininess: primary ? 90 : 80
  });
  const ico = bevel("ico", { height: s * 0.009, depth: 20, plateau: 0.72, modeling: 0, specular: 1.0, shininess: 85 });
  const icoLine = contour("icoLn", primary ? "#5E2601" : "#02090F", s * 0.009, { opacity: 0.8, softness: 0.5 });
  const ig = innerGlow("ig", primary ? "#FFF3C4" : "#7FE3E8", { size: s * 0.09, opacity: primary ? 0.5 : 0.28 });
  const drop = dropContact("drop", pressed ? 0.34 : 0.55, {
    distance: pressed ? 4 : 10, contactBlur: 3, ambientBlur: s * 0.1, ambient: 0.42
  });
  const halo = outerGlow("halo", accent || (primary ? "#FFC24F" : "#3FE0FF"), {
    size: s * (state === "hover" ? 0.075 : 0.05),
    opacity: state === "hover" ? 0.55 : 0.3, halo: 2.2, haloOpacity: state === "hover" ? 0.26 : 0.12
  });
  const rim = rimLight("rl", "#9FE6FF", 2, { opacity: 0.4, offset: 2.4 });
  const post = state === "hover" ? lift("post") : state === "disabled" ? mute("post") : null;

  // Сердцевина главной кнопки намеренно ТЕМНЕЕ кольца: белый значок
  // на светлом золоте не читается, а «золотая кнопка» узнаётся по
  // кольцу, а не по заливке.
  const coreStops = primary
    ? [["0%", pressed ? "#D98A22" : "#FFB03A"], ["46%", pressed ? "#A85206" : "#D96A08"],
       ["100%", pressed ? "#5E2601" : "#8A3402"]]
    : [["0%", pressed ? "#123047" : "#1E4A63"], ["50%", pressed ? "#08202F" : "#0C2E42"],
       ["100%", "#04121C"]];

  const defs = `
    ${envGold("eg", GOLD_ENV)}
    ${linearV("coreV", coreStops)}
    ${radial("coreHot", primary ? "#FFF0B47A" : "#8FE8FF4D", "#FFFFFF00", "50%", "24%", "60%")}
    ${defsOf(ring, dome, ico, icoLine, ig, drop, halo, rim, post)}
  `;

  const cx = s / 2, cy = s / 2 + sink;

  const body = `
    <g filter="${drop.ref}">
      <!-- гнездо: тёмный торец, без него кольцо лежит на фоне плоско -->
      <circle cx="${cx}" cy="${cy + s * 0.014}" r="${R + s * 0.008}" fill="#2A1602" opacity="0.85"/>
      <g filter="${halo.ref}">
        <g filter="${rim.ref}">
          <g filter="${ring.ref}">
            <path d="${ringPathCircle(cx, cy, R, ringW)}" fill="url(#eg)" fill-rule="evenodd"/>
          </g>
          <g filter="${ig.ref}"><g filter="${dome.ref}">
            <circle cx="${cx}" cy="${cy}" r="${coreR}" fill="url(#coreV)"/>
          </g></g>
          <circle cx="${cx}" cy="${cy}" r="${coreR}" fill="url(#coreHot)"/>
        </g>
      </g>
      <g transform="translate(${cx - s / 2} ${cy - s / 2})" filter="${icoLine.ref}">
        <g filter="${ico.ref}">${icon(s)}</g>
      </g>
    </g>`;

  return svgDoc(s, s, defs, post ? `<g filter="${post.ref}">${body}</g>` : body);
}

/** Кольцо как путь: внешняя окружность минус внутренняя, evenodd. */
function ringPathCircle(cx, cy, r, t) {
  const ri = r - t;
  const c = (rr) => `M ${cx - rr} ${cy} a ${rr} ${rr} 0 1 0 ${rr * 2} 0 a ${rr} ${rr} 0 1 0 ${-rr * 2} 0 Z`;
  return `${c(r)} ${c(ri)}`;
}

/**
 * Кольцо прогресса под автоигру: клиент маскирует его дугой.
 * Отдельным кадром, потому что вращается и живёт своей анимацией.
 */
function spinRing(size = 208, o = {}) {
  const { active = true } = o;
  const s = size, cx = s / 2, cy = s / 2, r = s * 0.44, t = s * 0.038;
  const glow = outerGlow("g", active ? "#FFD86A" : "#3FE0FF", { size: s * 0.05, opacity: 0.7, halo: 2.4, haloOpacity: 0.3 });
  const bv = bevel("bv", { height: s * 0.012, depth: 24, plateau: 0.6, modeling: 0, specular: 1.5, shininess: 88 });
  const defs = `
    ${linear("ringGrad", [["0%", "#FFF3C4"], ["45%", "#FFD24A"], ["100%", "#FF9A4C"]], 118)}
    ${defsOf(glow, bv)}
  `;
  return svgDoc(s, s, defs, `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#01070C" stroke-opacity="0.55" stroke-width="${t * 1.5}"/>
    <g filter="${glow.ref}"><g filter="${bv.ref}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#ringGrad)" stroke-width="${t}"/>
    </g></g>`);
}

/**
 * Прямоугольная кнопка с надписью — «купить фриспины», «ставка».
 * Тот же принцип: тело, кант, значок — три независимых тела.
 */
function pillButton(w, h, o = {}) {
  const {
    state = "normal", goldDetail = null,
    fill = [["0%", "#FF8A4C"], ["50%", "#E0451F"], ["100%", "#8A1B06"]],
    accent = "#FF7A3D", icon = null
  } = o;
  const pressed = state === "pressed";
  const r = h * 0.42, t = h * 0.075;
  const sink = pressed ? h * 0.03 : 0;

  const gold = metalGold("mg", {
    href: goldDetail, tile: h * 1.4, texture: 0.55,
    height: h * 0.035, depth: 26, anisotropy: 0.6, grooves: 0.08, grooveFreq: 0.09,
    specular: 1.2, shininess: 64
  });
  const dome = bevel("dome", {
    height: h * 0.09, depth: pressed ? 14 : 26, plateau: 0.58,
    modeling: pressed ? 0.3 : 0.7, specular: 1.2, shininess: 88
  });
  const ig = innerGlow("ig", "#FFE3A2", { size: h * 0.13, opacity: pressed ? 0.2 : 0.42 });
  const drop = dropContact("drop", pressed ? 0.34 : 0.55, {
    distance: pressed ? 4 : 9, contactBlur: 3, ambientBlur: h * 0.22, ambient: 0.42
  });
  const halo = outerGlow("halo", accent, {
    size: h * (state === "hover" ? 0.14 : 0.09),
    opacity: state === "hover" ? 0.5 : 0.26, halo: 2.2, haloOpacity: state === "hover" ? 0.24 : 0.1
  });
  const post = state === "hover" ? lift("post") : state === "disabled" ? mute("post") : null;

  const defs = `
    ${envGold("eg", GOLD_ENV)}
    ${linearV("pillFill", pressed
      ? fill.map(([o2, c]) => [o2, shade(c, -0.22)])
      : fill)}
    ${radial("pillHot", "#FFFFFF66", "#FFFFFF00", "50%", "18%", "72%")}
    ${defsOf(gold, dome, ig, drop, halo, post)}
  `;

  const body = `
    <g filter="${drop.ref}" transform="translate(0 ${sink})">
      <g filter="${halo.ref}">
        <g filter="${ig.ref}"><g filter="${dome.ref}">
          <path d="${roundRectPath(t, t, w - t * 2, h - t * 2 - sink, r - t)}" fill="url(#pillFill)"/>
        </g></g>
        <path d="${roundRectPath(t, t, w - t * 2, (h - t * 2 - sink) * 0.52, r - t)}" fill="url(#pillHot)"/>
        <g filter="${gold.ref}">
          <path d="${ringPath(1.5, 1.5, w - 3, h - 3 - sink, r, t)}" fill="url(#eg)" fill-rule="evenodd"/>
        </g>
      </g>
      ${icon ? `<g transform="translate(${h * 0.16} ${h * 0.16})">${icon(h * 0.68)}</g>` : ""}
    </g>`;

  return svgDoc(w, h, defs, post ? `<g filter="${post.ref}">${body}</g>` : body);
}

/* ═════════════════════════ подсветка выигрыша ═══════════════════════ */

function winFrame() {
  const S = 240, pad = 16;
  const bv = bevel("bv", { height: 3, depth: 26, plateau: 0.6, modeling: 0, specular: 1.5, shininess: 80 });
  const glow = outerGlow("g", "#FFE082", { size: 11, opacity: 0.8, halo: 2.4, haloOpacity: 0.34 });
  const defs = `${envGold("eg", GOLD_ENV)}${defsOf(bv, glow)}`;
  const inner = S - pad * 2;
  return svgDoc(S, S, defs, `
    <g filter="${glow.ref}"><g filter="${bv.ref}">
      <path d="${ringPath(pad, pad, inner, inner, 22, 7)}" fill="url(#eg)" fill-rule="evenodd"/>
      ${[[pad + 6, pad + 6], [S - pad - 6, pad + 6], [pad + 6, S - pad - 6], [S - pad - 6, S - pad - 6]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="url(#eg)"/>`).join("")}
    </g></g>`);
}

function winRays() {
  const S = 320, c = S / 2;
  const defs = `
    ${linear("rayFade", [["0%", "#FFF6D8", 0.95], ["50%", "#FFD24A", 0.42], ["100%", "#FF9A4C", 0]], 90)}
    ${radial("rayCore", "#FFF6D8CC", "#FFF6D800")}
    ${blurFilter("raySoft", 3.4)}
  `;
  return svgDoc(S, S, defs, `
    <g filter="url(#raySoft)">${rayBurst(c, c, c * 0.98, 16)}</g>
    <circle cx="${c}" cy="${c}" r="${c * 0.4}" fill="url(#rayCore)"/>`);
}

function cellGlow() {
  const S = 256;
  const defs = radial("cg", "#FFE0829E", "#FFE08200");
  return svgDoc(S, S, defs, `<circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="url(#cg)"/>`);
}

function lineBadge() {
  const S = 60;
  const bv = bevel("bv", { height: 2.4, depth: 26, plateau: 0.55, modeling: 0, specular: 1.4, shininess: 80 });
  const drop = dropContact("drop", 0.5, { distance: 5, contactBlur: 2, ambientBlur: 8, ambient: 0.4 });
  const defs = `${sheetGold("eg", S, S, { tilt: 0.5 })}${defsOf(bv, drop)}`;
  return svgDoc(S, S, defs, `
    <g filter="${drop.ref}">
      <circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 8}" fill="#0A0418" opacity="0.92"/>
      <g filter="${bv.ref}">
        <path d="${ringPathCircle(S / 2, S / 2, S / 2 - 2, 7)}" fill="url(#eg)" fill-rule="evenodd"/>
      </g>
    </g>`);
}

/* ════════════════════════════ частицы ═══════════════════════════════ */

function coinParticle() {
  const S = 72;
  const bv = bevel("bv", { height: 3, depth: 28, plateau: 0.42, modeling: 0.8, specular: 1.6, shininess: 72 });
  const em = emboss("em", { height: 1.4, depth: 3 });
  const defs = `${envGold("eg", GOLD_ENV)}${defsOf(bv, em)}${dropShadow("sh", 2, 3, 0.45)}`;
  return svgDoc(S, S, defs, `
    <g filter="url(#sh)">
      <g filter="${bv.ref}"><circle cx="36" cy="36" r="32" fill="url(#eg)"/></g>
      <g filter="${em.ref}">
        <circle cx="36" cy="36" r="22" fill="none" stroke="#8A5206" stroke-opacity="0.5" stroke-width="3"/>
        ${metalText("C", { x: 36, y: 38, size: 28, fill: "#B4740F", stroke: "none", strokeWidth: 0, family: "Lora" })}
      </g>
    </g>`);
}

function sparkParticle() {
  const S = 48;
  const defs = radial("sp", "#FFFFFF", "#FFD86A00");
  return svgDoc(S, S, defs, `
    <circle cx="24" cy="24" r="24" fill="url(#sp)" opacity="0.85"/>
    ${sparkle(24, 24, 20, 1)}`);
}

function starParticle() {
  const S = 72;
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push(polar(36, 36, i % 2 === 0 ? 33 : 13, -90 + i * 36));
  const bv = bevel("bv", { height: 2.6, depth: 30, plateau: 0.4, modeling: 0.8, specular: 1.6, shininess: 72 });
  const g = outerGlow("g", "#FFE082", { size: 6, opacity: 0.7, halo: 2, haloOpacity: 0.25 });
  const defs = `${envGold("eg", GOLD_ENV)}${defsOf(bv, g)}`;
  return svgDoc(S, S, defs, `
    <g filter="${g.ref}"><g filter="${bv.ref}">
      <polygon points="${pointsAttr(pts)}" fill="url(#eg)"/>
    </g></g>`);
}

function glowDot() {
  const S = 64;
  return svgDoc(S, S, radial("gd", "#FFFFFFDD", "#FFFFFF00"),
    `<circle cx="32" cy="32" r="32" fill="url(#gd)"/>`);
}

/* ═══════════════════════════════ логотип ════════════════════════════ */

/**
 * «СОЧИ · SUNSET» — объёмное золото на закатном диске.
 *
 * Надпись не залита градиентом, а вылеплена: буквы отрисованы дважды —
 * тёмный торец со сдвигом по свету и лицо под фаской, — поэтому у них
 * есть толщина. Плюс якорь как знак темы и лучи из-за диска.
 */
function logo() {
  const W = 900, H = 300, cx = W / 2;
  const bvText = bevel("bvT", { height: 3.4, depth: 30, plateau: 0.52, modeling: 0.75, specular: 1.6, shininess: 88 });
  const bvSub = bevel("bvS", { height: 2, depth: 26, plateau: 0.58, modeling: 0.6, specular: 1.5, shininess: 88 });
  const bvOrn = bevel("bvO", { height: 2.2, depth: 28, plateau: 0.5, modeling: 0.6, specular: 1.5, shininess: 88 });
  const lnText = contour("lnT", "#4A2600", 5.5, { opacity: 0.95, softness: 0.6 });
  const glowText = outerGlow("glT", "#FF9A4C", { size: 13, opacity: 0.5, halo: 2.4, haloOpacity: 0.22 });
  const drop = dropContact("drop", 0.6, { distance: 11, contactBlur: 4, ambientBlur: 22, ambient: 0.45 });

  const defs = `
    ${goldType("gt")}
    ${sheetGold("eg", W, H, { tilt: 0.3 })}
    ${radial("aura", "#FF9A4C66", "#FF9A4C00")}
    ${radial("logoPlate", "#12042099", "#12042000", "50%", "50%", "50%")}
    ${radial("sunDisc", "#FFF6D8", "#FF6B2E", "50%", "38%", "66%")}
    ${linear("rayFade", [["0%", "#FFD166AA"], ["100%", "#FFD16600"]], 90)}
    ${linear("seaLine", [["0%", "#7FE3E800"], ["25%", "#7FE3E8"], ["75%", "#17B7C9"], ["100%", "#17B7C900"]], 0)}
    ${blurFilter("raySoft", 5)}
    ${defsOf(bvText, bvSub, bvOrn, lnText, glowText, drop)}
  `;

  const sunY = 104;
  const body = `
    <ellipse cx="${cx}" cy="${H / 2}" rx="${W / 2}" ry="${H / 2}" fill="url(#aura)"/>
    <!-- тёмная подложка: логотип стоит на ярком закатном небе, и без
         неё золотые буквы теряются в собственной гамме -->
    <ellipse cx="${cx}" cy="${H * 0.62}" rx="${W * 0.46}" ry="${H * 0.36}" fill="url(#logoPlate)"/>

    <!-- закатный диск и лучи за надписью -->
    <g filter="url(#raySoft)" opacity="0.8">${rayBurst(cx, sunY, 300, 24, { wide: 3.4, thin: 1.3 })}</g>
    <circle cx="${cx}" cy="${sunY}" r="86" fill="url(#sunDisc)"/>
    <circle cx="${cx}" cy="${sunY}" r="86" fill="none" stroke="#FFF3C4" stroke-opacity="0.5" stroke-width="3"/>
    <path d="M ${cx - 268} 140 q 67 -24 134 0 q 67 24 134 0 q 67 -24 134 0"
          fill="none" stroke="url(#seaLine)" stroke-width="9" stroke-linecap="round" opacity="0.9"/>

    <g filter="${drop.ref}">
      <!-- якорь как знак темы: слева и справа от надписи -->
      <g filter="${bvOrn.ref}">
        ${anchor(cx - 356, 194, 108, { fill: "url(#eg)", thick: 0.105 })}
        ${anchor(cx + 356, 194, 108, { fill: "url(#eg)", thick: 0.105 })}
      </g>

      <g filter="${glowText.ref}"><g filter="${lnText.ref}">
        <!-- торец букв: копия со сдвигом ОТ света; без неё у надписи
             нет толщины и она читается наклейкой -->
        ${metalText("СОЧИ", {
          x: cx + 7, y: 200, size: 126, family: "Lora", weight: 700,
          fill: "#4A2600", stroke: "#4A2600", strokeWidth: 11, letterSpacing: 10
        })}
        <g filter="${bvText.ref}">
          ${metalText("СОЧИ", {
            x: cx, y: 193, size: 126, family: "Lora", weight: 700,
            fill: "url(#gt)", stroke: "none", strokeWidth: 0, letterSpacing: 10
          })}
        </g>
      </g></g>

      <g filter="${bvSub.ref}">
        ${metalText("SUNSET", {
          x: cx, y: 268, size: 48, family: "Poppins", weight: 700,
          fill: "url(#gt)", stroke: "#4A2600", strokeWidth: 5, letterSpacing: 20
        })}
      </g>
    </g>
    ${sparkle(cx - 286, 146, 26, 0.9)}
    ${sparkle(cx + 292, 176, 19, 0.8)}`;

  return svgDoc(W, H, defs, body);
}

/* ═══════════════════════ баннеры крупных выигрышей ══════════════════ */

/**
 * Баннер уровня выигрыша: лучи, лента, объёмная золотая типографика.
 * Плоская плашка с надписью «BIG WIN» — главная примета дешёвого слота;
 * в эталонах здесь всегда лепка, контровой свет и вспышка за буквами.
 */
function winBanner(text, o = {}) {
  // Лента ОБЯЗАНА быть тёмной. Золотая надпись на золотой плашке —
  // ровно то, что делает баннер дешёвым: контраста нет, буквы
  // «плавают». В эталонах под золотом всегда глубокий цвет уровня.
  const { hot = "#FFC24F", ribbonHot = "#8A2A08", ribbonDeep = "#2A0703" } = o;
  const W = 960, H = 330, cx = W / 2, cy = H / 2;

  const bvText = bevel("bvT", { height: 3.6, depth: 32, plateau: 0.5, modeling: 0.7, specular: 1.5, shininess: 88 });
  const lnText = contour("lnT", "#3A1D00", 6, { opacity: 0.95, softness: 0.6 });
  const glowText = outerGlow("glT", hot, { size: 16, opacity: 0.5, halo: 2.4, haloOpacity: 0.22 });
  const bvRib = bevel("bvR", { height: 5, depth: 20, plateau: 0.68, modeling: 0.4, specular: 0.6, shininess: 100 });
  const goldEdge = bevel("bvE", { height: 2.4, depth: 26, plateau: 0.58, modeling: 0, specular: 1.2, shininess: 80 });
  const drop = dropContact("drop", 0.62, { distance: 12, contactBlur: 4, ambientBlur: 26, ambient: 0.45 });

  const defs = `
    ${goldType("gt")}
    ${sheetGold("eg", W, H, { tilt: 0.3 })}
    ${radial("aura", hot + "8C", hot + "00")}
    ${linear("rayFade", [["0%", hot + "CC"], ["55%", hot + "55"], ["100%", hot + "00"]], 90)}
    ${linearV("ribbon", [["0%", ribbonHot], ["46%", ribbonDeep], ["100%", ribbonDeep]])}
    ${radial("ribbonGloss", "#FFFFFF33", "#FFFFFF00", "50%", "12%", "68%")}
    ${blurFilter("raySoft", 5)}
    ${defsOf(bvText, lnText, glowText, bvRib, goldEdge, drop)}
  `;

  // Лента: шестиугольная плашка с «ласточкиными хвостами» на торцах.
  const rw = W * 0.88, rh = 138;
  const hex = (inset) => {
    const w2 = rw / 2 - inset, h2 = rh / 2 - inset, n = 46 - inset * 0.6;
    return `M ${cx - w2} ${cy - h2} L ${cx + w2} ${cy - h2} L ${cx + w2 - n} ${cy}
      L ${cx + w2} ${cy + h2} L ${cx - w2} ${cy + h2} L ${cx - w2 + n} ${cy} Z`;
  };

  return svgDoc(W, H, defs, `
    <ellipse cx="${cx}" cy="${cy}" rx="${W / 2}" ry="${H / 2}" fill="url(#aura)"/>
    <g filter="url(#raySoft)" opacity="0.9">${rayBurst(cx, cy, W * 0.52, 24, { wide: 4.2, thin: 1.6 })}</g>

    <g filter="${drop.ref}">
      <g filter="${bvRib.ref}"><path d="${hex(0)}" fill="url(#ribbon)"/></g>
      <path d="${hex(0)}" fill="url(#ribbonGloss)"/>
      <g filter="${goldEdge.ref}">
        <path d="${hex(0)}" fill="none" stroke="url(#eg)" stroke-width="10" stroke-linejoin="round"/>
        <path d="${hex(14)}" fill="none" stroke="url(#eg)" stroke-width="3" stroke-linejoin="round"/>
      </g>

      <g filter="${glowText.ref}"><g filter="${lnText.ref}">
        ${metalText(text, {
          x: cx + 5, y: cy + 11, size: 92, family: "Poppins", weight: 700,
          fill: "#3A1D00", stroke: "#3A1D00", strokeWidth: 8, letterSpacing: 4
        })}
        <g filter="${bvText.ref}">
          ${metalText(text, {
            x: cx, y: cy + 5, size: 92, family: "Poppins", weight: 700,
            fill: "url(#gt)", stroke: "none", strokeWidth: 0, letterSpacing: 4
          })}
        </g>
      </g></g>
    </g>
    ${sparkle(cx - rw / 2 + 26, cy - 58, 28, 0.9)}
    ${sparkle(cx + rw / 2 - 30, cy + 52, 21, 0.85)}`);
}

/* ══════════════════════════════ реестр ══════════════════════════════ */

/**
 * Кадры, которые не помещаются в атлас 2048 и грузятся отдельными
 * картинками. Список должен совпадать с STANDALONE в producers/ui.mjs.
 */
export const STANDALONE_NAMES = [
  "reel_frame", "logo", "banner_big", "banner_mega", "banner_epic", "banner_free"
];

/**
 * Собрать описания всех кадров интерфейса.
 *
 * Асинхронно, потому что PBR-карты золота и дерева пекутся из
 * ambientCG-текстур (кеш на диске, второй вызов мгновенный).
 * @returns {Promise<Array<{name, slice, svg: () => string}>>}
 */
export async function uiAssets() {
  let goldDetail = null, woodDetail = null, woodTile = null;
  try {
    goldDetail = await detailUri("gold", { size: 256, amount: 0.34, normalStrength: 0.5 });
    woodDetail = await detailUri("wood", { size: 256, amount: 0.42, normalStrength: 0.6 });
    woodTile = await materialUri("wood", { size: 256, exposure: 0.86, ambient: 0.26, tintAmount: 0.4, saturation: 1.05 });
  } catch (e) {
    console.warn("PBR недоступен, материалы будут процедурными:", e.message);
  }

  const G = { goldDetail };
  const signOpts = { goldDetail, woodDetail, woodTile };

  const small = (icon, name, size = 76) => ([
    { name, draw: () => roundButton(size, icon, { ...G }) },
    { name: `${name}_hover`, draw: () => roundButton(size, icon, { ...G, state: "hover" }) },
    { name: `${name}_pressed`, draw: () => roundButton(size, icon, { ...G, state: "pressed" }) }
  ]);

  const RAW = [
    /* ── игровое поле ────────────────────────────────────────────── */
    { name: "reel_frame", draw: () => reelFrame(G) },
    { name: "reel_bg", draw: () => reelBg(128), slice: [44, 44, 44, 44] },
    { name: "reel_divider", draw: reelDivider },
    { name: "win_frame", draw: winFrame },
    { name: "win_rays", draw: winRays },
    { name: "cell_glow", draw: cellGlow },
    { name: "line_badge", draw: lineBadge },

    /* ── панели ──────────────────────────────────────────────────── */
    { name: "panel", draw: () => panel(128), slice: [56, 56, 56, 56] },
    { name: "panel_dark", draw: () => panelDark(112), slice: [48, 48, 48, 48] },
    { name: "panel_bar", draw: () => panelBar(128), slice: [8, 56, 8, 40] },
    { name: "meter_plate", draw: () => meterPlate(112), slice: [44, 44, 44, 44] },

    /* ── деревянные таблички ─────────────────────────────────────── */
    // Исходники табличек НАМЕРЕННО меньше того, как они лягут на экран:
    // nine-slice рисует углы один к одному и тянет только середину,
    // поэтому крупный исходник даёт не качество, а вес атласа.
    { name: "sign_paytable", draw: () => woodSign(176, 230, { ...signOpts, accent: "#FFD24A", corner: 24 }),
      slice: [84, 84, 84, 84] },
    { name: "sign_buy", draw: () => woodSign(200, 124, { ...signOpts, accent: "#FFB84F", corner: 22 }),
      slice: [80, 76, 80, 76] },
    { name: "sign_bet", draw: () => woodSign(176, 112, { ...signOpts, accent: "#FFD24A", corner: 20 }),
      slice: [72, 68, 72, 68] },
    { name: "sign_free", draw: () => woodSign(184, 116, { ...signOpts, accent: "#7CFFB0", corner: 20 }),
      slice: [72, 68, 72, 68] },

    /* ── главные кнопки ──────────────────────────────────────────── */
    { name: "btn_spin", draw: () => roundButton(180, ICONS.spin, { ...G, variant: "primary" }) },
    { name: "btn_spin_hover", draw: () => roundButton(180, ICONS.spin, { ...G, variant: "primary", state: "hover" }) },
    { name: "btn_spin_pressed", draw: () => roundButton(180, ICONS.spin, { ...G, variant: "primary", state: "pressed" }) },
    { name: "btn_spin_disabled", draw: () => roundButton(180, ICONS.spin, { ...G, variant: "primary", state: "disabled" }) },
    { name: "btn_stop", draw: () => roundButton(180, ICONS.stop, { ...G, variant: "primary" }) },
    { name: "btn_stop_pressed", draw: () => roundButton(180, ICONS.stop, { ...G, variant: "primary", state: "pressed" }) },
    { name: "spin_ring", draw: () => spinRing(208) },

    { name: "btn_buy", draw: () => pillButton(280, 92, { ...G, icon: ICONS.buy }) },
    { name: "btn_buy_hover", draw: () => pillButton(280, 92, { ...G, icon: ICONS.buy, state: "hover" }) },
    { name: "btn_buy_pressed", draw: () => pillButton(280, 92, { ...G, icon: ICONS.buy, state: "pressed" }) },
    { name: "btn_buy_disabled", draw: () => pillButton(280, 92, { ...G, icon: ICONS.buy, state: "disabled" }) },

    /* ── кнопки HUD ──────────────────────────────────────────────── */
    ...small(ICONS.turbo, "btn_turbo", 92),
    ...small(ICONS.auto, "btn_auto", 92),
    ...small(ICONS.soundOn, "btn_sound_on"),
    ...small(ICONS.soundOff, "btn_sound_off"),
    ...small(ICONS.menu, "btn_menu"),
    ...small(ICONS.info, "btn_info"),
    ...small(ICONS.history, "btn_history"),
    ...small(ICONS.full, "btn_full"),
    ...small(ICONS.fullExit, "btn_full_exit"),
    ...small(ICONS.close, "btn_close"),
    ...small(ICONS.plus, "btn_plus"),
    ...small(ICONS.minus, "btn_minus"),
    { name: "btn_chevron", draw: () => roundButton(64, ICONS.chevronDown, G) },
    { name: "btn_paytable", draw: () => roundButton(76, ICONS.paytable, G) },
    { name: "btn_turbo_disabled", draw: () => roundButton(92, ICONS.turbo, { ...G, state: "disabled" }) },
    { name: "btn_auto_disabled", draw: () => roundButton(92, ICONS.auto, { ...G, state: "disabled" }) },

    /* ── частицы ─────────────────────────────────────────────────── */
    { name: "p_coin", draw: coinParticle },
    { name: "p_spark", draw: sparkParticle },
    { name: "p_star", draw: starParticle },
    { name: "p_glow", draw: glowDot },

    /* ── брендинг ────────────────────────────────────────────────── */
    { name: "logo", draw: logo },
    { name: "banner_big", draw: () => winBanner("BIG WIN", { hot: "#FFC24F", ribbonHot: "#8A3208", ribbonDeep: "#2A0A02" }) },
    { name: "banner_mega", draw: () => winBanner("MEGA WIN", { hot: "#FF7AC8", ribbonHot: "#7A0F55", ribbonDeep: "#26031A" }) },
    { name: "banner_epic", draw: () => winBanner("EPIC WIN", { hot: "#63EFFF", ribbonHot: "#0A3F86", ribbonDeep: "#04162E" }) },
    { name: "banner_free", draw: () => winBanner("FREE SPINS", { hot: "#7CFFB0", ribbonHot: "#065A3A", ribbonDeep: "#021C12" }) }
  ];

  return RAW.map((a) => ({
    name: a.name,
    slice: a.slice || null,
    svg: () => namespaceSvg(a.draw(), a.name)
  }));
}

/** Совместимость со старым импортом: список без PBR-материалов. */
export const UI_ASSET_NAMES = [
  "reel_frame", "reel_bg", "reel_divider", "win_frame", "win_rays", "cell_glow", "line_badge",
  "panel", "panel_dark", "panel_bar", "meter_plate",
  "sign_paytable", "sign_buy", "sign_bet", "sign_free",
  "btn_spin", "btn_stop", "btn_buy", "logo"
];

/* ═════════════════════ тестовая композиция 1920×1080 ════════════════ */

/**
 * Собирает страницу «как в игре»: фон, оправа, символы, панель, кнопки,
 * таблички. Нужна ровно для одного — посмотреть глазами и сравнить
 * с эталоном. Раскладка повторяет landscape() из темы при cell = 200.
 */
export async function scenePreview() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const OUT = path.resolve(dir, "../../client/assets");

  const b64 = async (f) => {
    try {
      const buf = await fs.readFile(f);
      const ext = f.endsWith(".webp") ? "webp" : "png";
      return `data:image/${ext};base64,${buf.toString("base64")}`;
    } catch { return null; }
  };

  const bg = (await b64(path.join(OUT, "img/bg_landscape.webp")))
    || (await b64(path.join(OUT, "img/bg_landscape.png")));

  // Символы берём из готового атласа: подложка обязана быть темнее их.
  let symbolsCss = "", symbolCells = "";
  try {
    const json = JSON.parse(await fs.readFile(path.join(OUT, "atlas/symbols.json"), "utf8"));
    const img = await b64(path.join(OUT, "atlas/symbols.png"));
    const names = Object.keys(json.frames);
    if (img && names.length) {
      symbolsCss = `.sym{position:absolute;background-image:url(${img});background-repeat:no-repeat}`;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
          const f = json.frames[names[(r * 5 + c) % names.length]];
          const k = 176 / Math.max(f.w, f.h);
          symbolCells += `<div class="sym" style="
            left:${460 + c * 200 + (200 - f.w * k) / 2}px;
            top:${180 + r * 200 + (200 - f.h * k) / 2}px;
            width:${f.w * k}px;height:${f.h * k}px;
            background-position:${-f.x * k}px ${-f.y * k}px;
            background-size:${json.size.w * k}px ${json.size.h * k}px"></div>`;
        }
      }
    }
  } catch { /* атласа ещё нет — покажем пустое поле */ }

  const assets = await uiAssets();
  const byName = new Map(assets.map((a) => [a.name, a]));
  const get = (n) => byName.get(n)?.svg() || "";

  // Порядок в DOM и есть порядок слоёв. z-index здесь не годится:
  // отрицательный уводит элемент ЗА фон страницы, и оправа исчезает —
  // ровно это и произошло в первом прогоне.
  const at = (x, y, w, h, svg) =>
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px">${svg}</div>`;

  // Настоящий nine-slice в предпросмотре: border-image растягивает
  // середину и оставляет углы, ровно как drawNineSlice в клиенте.
  // Отступы в манифесте указаны в пикселях атласа (2×), здесь картинка
  // кладётся в своём масштабе, поэтому делим на два.
  const slice9 = (name, x, y, w, h) => {
    const a = byName.get(name);
    if (!a) return "";
    const uri = `data:image/svg+xml;base64,${Buffer.from(a.svg(), "utf8").toString("base64")}`;
    const s = (a.slice || [0, 0, 0, 0]).map((v) => v / 2);
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;
      border-style:solid;border-width:${s[1]}px ${s[2]}px ${s[3]}px ${s[0]}px;
      border-image:url('${uri}') ${s[1]} ${s[2]} ${s[3]} ${s[0]} fill stretch"></div>`;
  };

  // Оправа стоит там же, где её ставит grid.js: сетка минус frameInset.
  const gx = 460, gy = 180, cell = 200, inset = 60;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    html,body{margin:0;padding:0;width:1920px;height:1080px;overflow:hidden;
      background:${bg ? `url(${bg}) center/cover` : "linear-gradient(160deg,#3A1B5E,#160726 55%,#0B0413)"};
      font-family:Poppins,Segoe UI,sans-serif}
    svg{display:block;width:100%;height:100%}
    ${symbolsCss}
    .lbl{position:absolute;color:#FFE9B8;text-shadow:0 2px 5px #000,0 0 12px #0008;
         font-weight:700;text-align:center;letter-spacing:.04em}
  </style></head><body>
    ${at(gx - inset, gy - inset, cell * 5 + inset * 2, cell * 3 + inset * 2, get("reel_frame"))}
    ${symbolCells}
    <div class="lbl" style="left:${gx + cell * 2.5 - 230}px;top:${gy - inset + 16}px;width:460px;font-size:25px">
      СИМВОЛЫ ПЛАТЯТ ВЕЗДЕ</div>
    <div class="lbl" style="left:${gx + cell * 2.5 - 190}px;top:${gy + cell * 3 + 20}px;width:380px;font-size:21px">
      СТАВКА 3.00 · ЛИНИЙ 20</div>

    ${slice9("panel_bar", 0, 855, 1920, 225)}

    ${slice9("sign_paytable", 96, 250, 210, 420)}
    ${slice9("sign_bet", 1636, 300, 250, 130)}
    ${slice9("sign_buy", 1610, 470, 290, 160)}
    ${slice9("sign_free", 1636, 670, 250, 140)}
    <div class="lbl" style="left:1610px;top:508px;width:290px;font-size:30px">КУПИТЬ<br>
      <span style="font-size:26px;color:#FFD24A">240.00</span></div>
    <div class="lbl" style="left:1636px;top:322px;width:250px;font-size:22px;color:#C9B6E8">СТАВКА<br>
      <span style="font-size:30px;color:#FFE9B8">3.00</span></div>
    <div class="lbl" style="left:1636px;top:692px;width:250px;font-size:22px;color:#C9B6E8">ФРИСПИНОВ<br>
      <span style="font-size:32px;color:#7CFFB0">10</span></div>
    <div class="lbl" style="left:96px;top:270px;width:210px;font-size:24px">ВЫПЛАТЫ</div>

    ${at(1690, 890, 180, 180, get("btn_spin"))}
    ${at(1560, 926, 92, 92, get("btn_auto"))}
    ${at(1440, 926, 92, 92, get("btn_turbo"))}
    ${at(660, 936, 76, 76, get("btn_minus"))}
    ${at(1000, 936, 76, 76, get("btn_plus"))}
    ${at(40, 936, 76, 76, get("btn_menu"))}
    ${at(130, 936, 76, 76, get("btn_info"))}
    ${at(220, 936, 76, 76, get("btn_sound_on"))}
    ${at(310, 936, 76, 76, get("btn_history"))}
    ${slice9("meter_plate", 420, 918, 330, 112)}
    ${slice9("meter_plate", 750, 924, 240, 100)}
    <div class="lbl" style="left:420px;top:930px;width:330px;font-size:19px;color:#C9B6E8">БАЛАНС<br>
      <span style="font-size:32px;color:#FFE9B8">99 997.00</span></div>
    <div class="lbl" style="left:750px;top:938px;width:240px;font-size:18px;color:#C9B6E8">СТАВКА<br>
      <span style="font-size:28px;color:#FFE9B8">3.00</span></div>

    ${at(1120, 30, 400, 134, get("logo"))}
  </body></html>`;
}
