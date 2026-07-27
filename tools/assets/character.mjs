// ════════════════════════════════════════════════════════════════════
//  ПЕРСОНАЖ — пожилой капитан-черноморец.
//
//  Главный визуальный разрыв с Pragmatic закрывается здесь: у Gates of
//  Olympus справа стоит Зевс, у Starlight Princess — принцесса, у Big
//  Bass Bonanza — рыбак. Персонаж занимает 55–70 % высоты экрана, стоит
//  сбоку от барабанов, смотрит НА барабаны и частично уходит за нижний
//  край кадра: обрезка читается как «он не помещается» и работает на
//  масштаб.
//
//  ТЕХНИКА — послойный спрайтовый риг, не Spine и не Rive:
//    • Spine требует платной лицензии на распространение рантайма;
//    • Rive тянет ~0.5 МБ WASM и просит 'wasm-unsafe-eval' в CSP.
//  Здесь персонаж разобран на 12 PNG с прозрачностью, каждый со своей
//  точкой поворота. Idle делается синусами по трансформам, реакции —
//  ключевыми кадрами тех же трансформов плюс подменой пары слоёв.
//  Всё рисует обычный canvas drawImage, рантайм нулевой.
//
//  ОТКУДА ОБЪЁМ. Растеризатор — headless Chromium, значит доступны
//  настоящие SVG-фильтры. Кожа, сукно, золото и лак козырька лепятся
//  feDiffuseLighting/feSpecularLighting по карте высот из альфы — это
//  РЕАЛЬНОЕ освещение поверхности, а не нарисованный градиент. Свет
//  один на всю игру: svgLib.LIGHT (азимут 225° = сверху-слева в
//  экранных координатах, где ось Y смотрит вниз).
//
//  СИСТЕМА КООРДИНАТ. Все слои живут в одном «пространстве фигуры»
//  FIGURE (900×1500). Каждый слой — прямоугольник box внутри него,
//  заданный через viewBox="x y w h", поэтому ВНУТРИ слоя рисуют в
//  координатах фигуры. Клиенту достаточно положить слой в
//  (originX + box.x, originY + box.y): никакой арифметики смещений и
//  никаких «почему рука уехала на два пикселя».
//
//  АНТРОПОМЕТРИЯ (иначе лицо не собирается). Темя 178, подбородок 480,
//  высота головы 302. Линия бровей 0.44 → 311, глаза 0.50 → 328,
//  основание носа 0.72 → 396, рот 0.85 → 435. Околыш фуражки обязан
//  кончаться ВЫШЕ бровей: первая версия села на 336 и закрыла лицо
//  целиком — фигура читалась как манекен.
// ════════════════════════════════════════════════════════════════════

import {
  LIGHT, bevel, contour, innerGlow, outerGlow, rimLight, distantLight,
  grain, metalGold, envGold, defsOf, linear, radial, shade
} from "./svg-lib.mjs";
import { PALETTE as P } from "./palette.mjs";

/* ─────────────────────────── пространство ───────────────────────── */

export const FIGURE = Object.freeze({ width: 900, height: 1500 });

// Прямоугольники слоёв в пространстве фигуры. Запас по краям нужен
// фильтрам: ореол, контур и контровой свет выходят за силуэт, тесная
// рамка их срежет.
const BOX = {
  glow:      { x:  20, y:  30, w: 860, h: 1470 },
  legs:      { x: 240, y: 880, w: 420, h:  620 },
  armLeft:   { x: 520, y: 420, w: 240, h:  460 },
  body:      { x: 210, y: 390, w: 480, h:  620 },
  head:      { x: 250, y: 130, w: 400, h:  430 },
  eyes:      { x: 310, y: 275, w: 240, h:  100 },
  moustache: { x: 250, y: 350, w: 280, h:  160 },
  hat:       { x: 160, y:  60, w: 520, h:  270 },
  armRight:  { x: 180, y: 420, w: 240, h:  340 },
  handGlass: { x:  90, y: 300, w: 270, h:  340 }
};

// Точки поворота в пространстве фигуры (не в локальном!). Клиент
// переводит их в локальные вычитанием box.x/box.y — так проще держать
// в голове: все суставы заданы на одном чертеже.
const PIVOT = {
  glow:      [450, 900],
  legs:      [452, 950],   // таз
  armLeft:   [582, 486],   // дальнее плечо
  body:      [452, 950],   // поясница: дыхание качает торс отсюда
  head:      [452, 500],   // основание шеи
  eyes:      [452, 328],
  moustache: [376, 396],   // под носом
  hat:       [452, 250],   // посадка на голове
  armRight:  [340, 480],   // ближнее плечо
  handGlass: [268, 572]    // запястье
};

/* ─────────────────────────── палитра героя ──────────────────────── */

// Кожа южанина: загар не «жёлтый», а красно-коричневый, с румянцем на
// носу и скулах. Холодных полутонов нет — вечернее солнце.
const SKIN = {
  hi:    "#FFE2BC",
  light: "#F5C293",
  base:  "#DDA070",
  mid:   "#BE7A47",
  shade: "#96522C",
  deep:  "#6A3418",
  line:  "#4A2210",
  ruddy: "#D0684A",
  sss:   "#C0472C"     // просвет крови в тонких местах (уши, крылья носа)
};

// Тельняшка — синяя, черноморская. Полосы не чёрные и не «электрик»:
// вылинявший на солнце ультрамарин.
const TEL = {
  cloth:  "#F2F5FA",
  clothS: "#BCC8DA",
  stripe: "#20539A",
  stripeS: "#123563",
  stripeH: "#4A80C4"
};

// Китель — тёмный синий, почти чёрный в тени: он держит силуэт и
// отделяет фигуру от закатного фона.
const COAT = {
  hi:   "#44608C",
  base: "#22334F",
  mid:  "#16223A",
  dark: "#0B1120",
  line: "#060A12"
};

// Брюки — белые курортные. Тени в них голубые: белая ткань на солнце
// ловит небо, и без холодных теней она выглядит серой тряпкой.
const DUCK = {
  hi:   "#FFFFFF",
  base: "#EEF2F8",
  mid:  "#C2CFE2",
  dark: "#8B9FBC",
  line: "#54678A"
};

const CAP = {
  hi:   "#FFFFFF",
  base: "#F0F3F9",
  mid:  "#C6D1E1",
  dark: "#93A3BB",
  band: "#161A22",
  bandH: "#3C4553",
  peak: "#090C12",
  peakH: "#66738A"
};

const HAIR = {
  hi:   "#FFFFFF",
  base: "#E4E9F0",
  mid:  "#B4BFCC",
  dark: "#818C9C",
  line: "#4E5765"
};

// Закатный контровой свет: солнце стоит за спиной героя, и тёплая
// кромка по дальнему краю — главный приём, который отрывает фигуру от
// фона. Ключ при этом остаётся общим для игры (сверху-слева).
const RIM = "#FFB05A";

// Контур. Не чёрный: чёрный делает картинку грязной. Тёмный тёплый
// баклажан родствен и коже, и кителю, и держит фигуру на закатном фоне.
const INK = "#2C1018";

/* ──────────────────────────── утилиты ───────────────────────────── */

/**
 * Документ слоя. Отличие от svgLib.svgDoc: viewBox сдвинут, поэтому
 * внутри слоя рисуют В КООРДИНАТАХ ФИГУРЫ. Это единственный способ не
 * сойти с ума, собирая руку, которая обязана состыковаться с плечом,
 * нарисованным на другом слое.
 */
function layerDoc(box, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}"
  viewBox="${box.x} ${box.y} ${box.w} ${box.h}" shape-rendering="geometricPrecision">
  <defs>${defs}</defs>
  ${body}
</svg>`;
}

function blur(id, std) {
  return `<filter id="${id}" x="-70%" y="-70%" width="240%" height="240%"
      color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${std}"/></filter>`;
}

/** Мягкое пятно тени/света поверх заливки: «подрисовка» формы. */
function sh(d, color, opacity, filterId) {
  return `<path d="${d}" fill="${color}" opacity="${opacity}" filter="url(#${filterId})"/>`;
}

/**
 * Кожа. Отдельный пресет, потому что кожа — не металл и не ткань:
 *   • блик широкий и слабый (кожа матовая, но жирная на носу и лбу);
 *   • лепка мягкая, без резкой фаски — иначе лицо выглядит маской;
 *   • низкое плато делает подушку, а не фаску.
 * Подповерхностное рассеивание кладётся отдельно, рецептом innerGlow с
 * тёплым красным: свет проходит сквозь тонкие места (уши, крылья носа,
 * пальцы), и без этого кожа выглядит крашеным пластиком.
 */
/**
 * formLight(id, opts) — освещение органической формы.
 *
 * ЗАЧЕМ СВОЙ РЕЦЕПТ, если в svg-lib есть bevel. bevel строит карту
 * высот так: размытие альфы → feComponentTransfer с tableValues →
 * освещение. Именно tableValues и убивает крупные органические формы.
 * При plateau 0.3 таблица сжимает верхнюю четверть входного диапазона
 * в 7 % выходного, то есть примерно втрое; на большой площади это
 * означает МЕНЬШЕ ОДНОГО уровня альфы на пиксель, а feDiffuseLighting
 * считает нормаль как производную карты высот и превращает каждую
 * такую ступеньку в видимую горизонталь. Щека и тулья фуражки
 * покрывались топографическими кольцами. Плёночное зерно поверх это
 * НЕ лечит: полосы шире зерна.
 *
 * Здесь ремапа нет вовсе. Размытая альфа сама по себе — идеальный
 * гладкий купол, ровно то, что нужно щеке, носу и подбородку. Плато
 * (для рукотворных предметов вроде козырька) задаётся гаммой:
 * монотонной и без ступеней.
 *
 * ВТОРОЕ отличие — режим `soft`. Мягкие подформы (скула, надбровье,
 * шар носа) рисуются заливкой с АЛЬФА-СПАДОМ к краям, чтобы стыка не
 * было видно. Финальный `operator="in"` из bevel умножает результат на
 * исходную альфу ещё раз и такую заливку возводит в квадрат, съедая
 * растушёвку. При specular = 0 клампа не нужно: умножение на свет
 * альфу и так сохраняет.
 */
function formLight(id, opts = {}) {
  const {
    height = 16, depth = 26,
    specular = 0, shininess = 14, specColor = "#FFF0DA",
    plateau = 0, light = LIGHT, margin = 30,
    jitter = 0.012, seed = 23
  } = opts;

  const kd = (1 / Math.max(0.15, Math.sin((light.elevation * Math.PI) / 180))).toFixed(3);
  const ramp = plateau > 0
    ? `<feComponentTransfer in="fl_h0" result="fl_h1">
         <feFuncA type="gamma" amplitude="1" exponent="${(1 - plateau * 0.65).toFixed(3)}"/>
       </feComponentTransfer>`
    : `<feOffset in="fl_h0" result="fl_h1"/>`;

  // ДИТЕРИНГ КАРТЫ ВЫСОТ. feDiffuseLighting берёт нормаль как Собеля от
  // карты высот, а карта высот 8-битная. На пологом склоне соседние
  // пиксели отличаются на 1/255, Собель выдаёт ступеньку, и при
  // surfaceScale 28 это ±0.11 к нормали — ровно те концентрические
  // кольца, что покрывали тулью фуражки и щёку.
  //
  // Зерно поверх КАРТИНКИ это не лечит (полосы шире зерна), а зерно в
  // КАРТУ ВЫСОТ — лечит: ступеньки рассыпаются в шум амплитудой в те же
  // ±1 уровень. Побочный эффект приятный: у сукна и кожи появляется
  // микрофактура, которой у плоской заливки не бывает.
  const dz = jitter > 0 ? `
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1"
                  seed="${seed}" stitchTiles="stitch" result="fl_n"/>
    <feColorMatrix in="fl_n" type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="fl_nA"/>
    <feComposite in="fl_h1" in2="fl_nA" operator="arithmetic"
                 k1="0" k2="1" k3="${jitter}" k4="${(-jitter / 2).toFixed(4)}" result="fl_h"/>`
    : `<feOffset in="fl_h1" result="fl_h"/>`;

  const spec = specular > 0 ? `
    <feSpecularLighting in="fl_h" surfaceScale="${depth}" specularConstant="${specular}"
        specularExponent="${shininess}" lighting-color="${specColor}" result="fl_s">
      ${distantLight(light)}
    </feSpecularLighting>
    <feComposite in="fl_s" in2="SourceAlpha" operator="in" result="fl_sm"/>
    <feComposite in="fl_lit" in2="fl_sm" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0" result="fl_add"/>
    <feComposite in="fl_add" in2="SourceAlpha" operator="in"/>`
    : `<feOffset in="fl_lit"/>`;

  return {
    id,
    ref: `url(#${id})`,
    def: `<filter id="${id}" x="-${margin}%" y="-${margin}%"
        width="${100 + margin * 2}%" height="${100 + margin * 2}%"
        color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${height}" result="fl_h0"/>
      ${ramp}
      ${dz}
      <feDiffuseLighting in="fl_h" surfaceScale="${depth}" diffuseConstant="${kd}"
                         lighting-color="#FFFFFF" result="fl_d">
        ${distantLight(light)}
      </feDiffuseLighting>
      <feComposite in="fl_d" in2="SourceGraphic" operator="arithmetic"
                   k1="1" k2="0" k3="0" k4="0" result="fl_lit"/>
      ${spec}
    </filter>`
  };
}

/** Мягкая подформа: заливка со спадом альфы к краям, стыка не видно. */
function blobFill(id, color, inner = 0.9) {
  return `<radialGradient id="${id}">
    <stop offset="0%"   stop-color="${color}" stop-opacity="${inner}"/>
    <stop offset="52%"  stop-color="${color}" stop-opacity="${(inner * 0.72).toFixed(3)}"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </radialGradient>`;
}

function skinShade(id, opts = {}) {
  const { height = 20, depth = 30, specular = 0.38, shininess = 14 } = opts;
  return formLight(id, { height, depth, specular, shininess, specColor: "#FFF0DA" });
}

/** Плёночное зерно поверх слоя: добивает остатки бандинга. */
function dither(id, amount = 0.028) {
  return grain(id, amount, { freq: 0.62 });
}

/**
 * Ткань. Плато шире, блик почти выключен, зато сильная общая лепка:
 * складки должны читаться перепадом тона, а не бликом.
 */
function clothShade(id, opts = {}) {
  const { height = 12, depth = 22, specular = 0.2, shininess = 8, plateau = 0.3 } = opts;
  return formLight(id, { height, depth, specular, shininess, specColor: "#FFE9C6", plateau });
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: ореол и контактная тень (char_glow)

   Печётся в текстуру, а не считается в рантайме: ctx.shadowBlur на
   фигуре 900×1500 каждый кадр — гарантированные просадки на мобильном.

   Лучи держатся НАМЕРЕННО слабыми (opacity 0.05…0.09) и размываются
   на 40 px. Первая версия шла по 0.10…0.17 без достаточного размытия и
   давала жёсткие клинья и кольца бандинга: закат превращался в
   рекламу автосервиса. Плёночное зерно поверх добивает бандинг.
   ══════════════════════════════════════════════════════════════════ */

function drawGlow() {
  const b = BOX.glow;

  // Плёночного зерна здесь НЕТ намеренно. grain() кладёт серый шум
  // режимом overlay: на почти прозрачном слое overlay с 0.5 даёт серое
  // пятно, и весь закатный ореол превращался в грязную кляксу. Зерно —
  // инструмент для НЕПРОЗРАЧНЫХ заливок.
  const defs = `
    <radialGradient id="gw_warm" cx="50%" cy="44%" r="52%">
      <stop offset="0%"   stop-color="#FFC377" stop-opacity="0.40"/>
      <stop offset="38%"  stop-color="#FF9A4E" stop-opacity="0.22"/>
      <stop offset="70%"  stop-color="#E2603C" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#8A2C4A" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gw_core" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#FFF3D2" stop-opacity="0.42"/>
      <stop offset="46%"  stop-color="#FFC272" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#FF9A4E" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gw_ground" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#1A0620" stop-opacity="0.6"/>
      <stop offset="58%"  stop-color="#1A0620" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#1A0620" stop-opacity="0"/>
    </radialGradient>
    <!-- Дитер альфы. Радиальный градиент с opacity 0.4…0 на 500 px
         имеет меньше одного уровня альфы на пиксель, и PNG раскладывает
         его в концентрические кольца. Шум ±1/255 по альфе (RGB не
         трогаем) кольца рассыпает. -->
    <filter id="gw_d" x="0%" y="0%" width="100%" height="100%"
            color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="1"
                    seed="9" stitchTiles="stitch" result="gwn"/>
      <feColorMatrix in="gwn" type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="gwa"/>
      <feComposite in="SourceGraphic" in2="gwa" operator="arithmetic"
                   k1="0" k2="1" k3="0.02" k4="-0.01"/>
    </filter>`;

  // ЛУЧЕЙ ЗДЕСЬ НЕТ. Клинья из точки за головой при opacity 0.05…0.09
  // и размытии 40 давали кольца бандинга по всему кадру: у почти
  // прозрачной заливки на 8 бит просто нет разрешения, чтобы гаусс
  // сошёлся гладко. Лучи — забота фона (producers/scenery), где они
  // лежат на непрозрачном небе и банда не дают. Персонажу нужен ровно
  // тёплый нимб, отделяющий тёмный китель от тёмного низа неба.
  return layerDoc(b, defs, `
    <g filter="url(#gw_d)">
      <ellipse cx="462" cy="620" rx="330" ry="520" fill="url(#gw_warm)"/>
      <ellipse cx="452" cy="330" rx="220" ry="200" fill="url(#gw_core)"/>
    </g>
    <!-- контактная тень: без неё фигура висит в воздухе -->
    <ellipse cx="452" cy="1478" rx="270" ry="52" fill="url(#gw_ground)"/>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: ноги (char_legs)

   Вынесены из торса намеренно. Во-первых, дыхание качает торс, не
   таская за собой ботинки. Во-вторых, кадры реакций перерисовывают
   только верх фигуры — ноги в них не участвуют, и это экономит больше
   трети веса спрайт-листов.
   ══════════════════════════════════════════════════════════════════ */

function drawLegs() {
  const b = BOX.legs;
  const cl = clothShade("lg_c", { height: 17, depth: 22, modeling: 0.85 });
  const ct = contour("lg_k", INK, 4, { opacity: 0.9, softness: 0.8 });
  const rim = rimLight("lg_r", RIM, 4, { opacity: 0.5, offset: 4 });

  const defs = defsOf(cl, ct, rim) + `
    ${linear("lg_duck", [
      ["0%", DUCK.hi], ["16%", DUCK.base], ["48%", DUCK.mid], ["100%", DUCK.line]
    ], 14)}
    ${linear("lg_shoe", [
      ["0%", "#9A6A3E"], ["36%", "#6B4223"], ["100%", "#331D0C"]
    ], 100)}
    ${blur("lg_s", 13)}
    ${blur("lg_s2", 6)}`;

  // Дальняя нога отставлена и уходит в тень — воздушная перспектива в
  // миниатюре. Две одинаково освещённые ноги слипаются в столб.
  const farLeg = `M 468 930
    C 526 926 572 942 578 976
    C 588 1044 584 1132 576 1220
    C 570 1308 564 1390 558 1452
    L 470 1452
    C 470 1378 468 1288 462 1210
    C 456 1130 452 1030 462 962 Z`;

  const nearLeg = `M 322 928
    C 382 916 452 918 470 938
    C 476 1012 466 1102 454 1194
    C 444 1276 438 1366 434 1452
    L 334 1452
    C 332 1360 326 1266 318 1178
    C 310 1084 304 996 312 950 Z`;

  const shoes = `
    <path d="M 466 1432 L 564 1432 C 576 1478 582 1508 582 1528
             C 582 1548 564 1556 526 1556 L 460 1556
             C 450 1556 446 1546 448 1528 Z" fill="url(#lg_shoe)"/>
    <path d="M 330 1432 L 438 1432 C 440 1474 436 1508 428 1530
             C 422 1550 400 1558 354 1558 L 298 1558
             C 286 1558 282 1546 288 1526 Z" fill="url(#lg_shoe)"/>`;

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g filter="${rim.ref}">
        <g filter="${cl.ref}">
          <path d="${farLeg}" fill="url(#lg_duck)"/>
          ${sh("M 458 926 L 592 926 L 576 1456 L 458 1456 Z", "#1B2C4A", 0.5, "lg_s")}
          <!-- падающая тень от кителя на брюки: она пришивает низ к
               верху. Без неё белые штаны читаются отдельной фигурой -->
          ${sh("M 300 900 C 380 946 530 946 610 900 L 610 1010 C 520 1042 380 1042 300 1010 Z", "#22304C", 0.45, "lg_s")}
          <path d="${nearLeg}" fill="url(#lg_duck)"/>
          <!-- складки на белом полотне: только тон, никакого блика -->
          ${sh("M 316 1046 C 358 1030 420 1036 462 1052 L 458 1090 C 414 1072 356 1068 314 1084 Z", DUCK.dark, 0.52, "lg_s2")}
          ${sh("M 322 1198 C 364 1184 422 1190 450 1204 L 446 1236 C 410 1220 362 1216 324 1230 Z", DUCK.dark, 0.44, "lg_s2")}
          ${sh("M 424 930 C 452 962 458 1130 440 1310 L 470 1310 L 476 952 Z", DUCK.mid, 0.62, "lg_s")}
          ${sh("M 306 940 C 322 960 320 1120 330 1300 L 300 1300 L 296 950 Z", DUCK.mid, 0.35, "lg_s")}
          <!-- колено: ткань натягивается и даёт светлое пятно, под ним
               мешок складок. Без этого штанина — труба -->
          ${sh("M 330 1130 C 372 1118 424 1124 448 1140 C 424 1176 366 1180 328 1166 Z", DUCK.hi, 0.55, "lg_s")}
          ${sh("M 470 1120 C 512 1110 556 1116 578 1130 C 552 1164 502 1168 468 1154 Z", DUCK.hi, 0.3, "lg_s")}
          <!-- стрелка: одна светлая линия делает штанину цилиндром -->
          <path d="M 370 940 C 364 1090 358 1290 354 1440" fill="none"
                stroke="${DUCK.hi}" stroke-width="8" opacity="0.6" stroke-linecap="round"/>
          <path d="M 383 940 C 377 1090 371 1290 367 1440" fill="none"
                stroke="${DUCK.line}" stroke-width="3" opacity="0.22" stroke-linecap="round"/>
          <!-- отвороты: горизонталь внизу штанины останавливает взгляд
               и объясняет, почему фигура обрезана кадром -->
          <path d="M 330 1398 C 372 1410 412 1410 438 1400 L 436 1440
                   C 410 1450 370 1450 332 1438 Z" fill="${DUCK.base}"/>
          <path d="M 330 1398 C 372 1410 412 1410 438 1400" fill="none"
                stroke="${DUCK.line}" stroke-width="4" opacity="0.35"/>
          <path d="M 468 1400 C 508 1412 546 1412 570 1402 L 568 1442
                   C 544 1452 506 1452 470 1440 Z" fill="${DUCK.base}"/>
          <path d="M 468 1400 C 508 1412 546 1412 570 1402" fill="none"
                stroke="${DUCK.line}" stroke-width="4" opacity="0.3"/>
          ${shoes}
          <path d="M 296 1520 L 582 1520" stroke="#241206" stroke-width="10" opacity="0.6"/>
          <path d="M 338 1444 C 378 1452 418 1452 438 1444" fill="none"
                stroke="#F0DEBE" stroke-width="6" opacity="0.45" stroke-linecap="round"/>
        </g>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: дальняя рука (char_arm_left) — за торсом
   ══════════════════════════════════════════════════════════════════ */

function drawArmLeft() {
  const b = BOX.armLeft;
  const cl = clothShade("al_c", { height: 13, depth: 22 });
  const sk = skinShade("al_s", { height: 11, depth: 26 });
  const ct = contour("al_k", INK, 4, { opacity: 0.9, softness: 0.8 });
  const rim = rimLight("al_r", RIM, 4, { opacity: 0.62, offset: 4.5 });

  const ep = formLight("al_e", { height: 4, depth: 20, plateau: 0.5,
    specular: 1.5, shininess: 42, specColor: "#FFF6D8" });

  const defs = defsOf(cl, sk, ct, rim, ep) + `
    ${linear("al_coat", [
      ["0%", COAT.hi], ["24%", COAT.base], ["68%", COAT.mid], ["100%", COAT.dark]
    ], 24)}
    ${linear("al_skin", [["0%", SKIN.light], ["40%", SKIN.base], ["100%", SKIN.mid]], 24)}
    ${envGold("al_gold", { angle: 100 })}
    ${blur("al_s", 8)}`;

  // Рука опущена вдоль тела и чуть отведена назад.
  const sleeve = `M 556 444
    C 610 452 646 490 654 548
    C 664 622 660 692 648 748
    C 642 776 616 788 590 780
    C 566 772 556 750 560 724
    C 570 656 570 574 548 506 Z`;

  const hand = `M 592 758
    C 628 752 656 768 658 798
    C 660 828 650 854 630 864
    C 608 874 584 866 574 846
    C 564 826 568 786 580 770 Z`;

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g filter="${rim.ref}">
        <g filter="${sk.ref}">
          ${hand}
          <path d="${hand}" fill="url(#al_skin)"/>
          <g stroke="${SKIN.deep}" stroke-width="3.6" opacity="0.5" fill="none" stroke-linecap="round">
            <path d="M 586 798 C 608 792 632 794 648 804"/>
            <path d="M 584 822 C 606 818 630 820 646 830"/>
            <path d="M 588 846 C 606 844 626 846 638 854"/>
          </g>
        </g>
        <g filter="${cl.ref}">
          <path d="${sleeve}" fill="url(#al_coat)"/>
          ${sh("M 552 462 C 594 476 606 540 602 640 C 598 720 592 758 588 778 L 552 774 Z", COAT.dark, 0.45, "al_s")}
          <!-- погон дальнего плеча: короче и темнее ближнего -->
          <g filter="${ep.ref}">
            <path d="M 552 442 C 588 436 620 444 634 460
                     C 630 478 616 488 594 490
                     C 570 490 552 480 548 462 Z" fill="url(#al_gold)"/>
            <path d="M 556 450 C 588 446 612 452 626 464" fill="none"
                  stroke="${P.goldShadow}" stroke-width="4" opacity="0.6"/>
            <circle cx="572" cy="468" r="5.5" fill="${P.goldLight}" opacity="0.75"/>
            <circle cx="594" cy="472" r="5.5" fill="${P.goldLight}" opacity="0.75"/>
            <circle cx="616" cy="472" r="5.5" fill="${P.goldLight}" opacity="0.75"/>
          </g>

          <!-- галуны на обшлаге: четыре нашивки = капитан дальнего плавания -->
          <g>
            ${[688, 712, 736, 760].map((y) => `
              <path d="M 560 ${y} C 594 ${y + 10} 630 ${y + 12} 652 ${y + 6}
                       L 650 ${y - 10} C 628 ${y - 4} 592 ${y - 6} 560 ${y - 16} Z"
                    fill="url(#al_gold)"/>`).join("")}
          </g>
        </g>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: торс (char_body)
   ══════════════════════════════════════════════════════════════════ */

function drawBody() {
  const b = BOX.body;
  const cl = clothShade("bd_c", { height: 15, depth: 25, modeling: 0.92 });
  const ct = contour("bd_k", INK, 4.5, { opacity: 0.92, softness: 0.8 });
  const rim = rimLight("bd_r", RIM, 5, { opacity: 0.66, offset: 5 });
  const gr = grain("bd_g", 0.035, { freq: 0.6 });
  const emb = bevel("bd_e", { height: 3, depth: 22, plateau: 0.5, specular: 1.5,
    shininess: 40, specColor: "#FFF6D8", modeling: 0.5, margin: 30 });

  const defs = defsOf(cl, ct, rim, gr, emb) + `
    ${linear("bd_coat", [
      ["0%", COAT.hi], ["20%", COAT.base], ["60%", COAT.mid], ["100%", COAT.dark]
    ], 18)}
    ${linear("bd_tel", [["0%", TEL.cloth], ["52%", TEL.cloth], ["100%", TEL.clothS]], 16)}
    ${envGold("bd_gold", { angle: 100 })}
    ${linear("bd_belt", [["0%", "#8A5628"], ["42%", "#4E2C12"], ["100%", "#251205"]], 100)}
    ${blur("bd_s", 15)}
    ${blur("bd_s2", 7)}`;

  // Силуэт: покатые плечи пожилого человека и круглый живот. Ровная
  // «спортивная» трапеция убила бы характер.
  const torso = `M 452 432
    C 410 434 382 444 356 460
    C 312 486 292 526 288 582
    C 282 662 294 748 304 812
    C 312 866 318 912 322 958
    L 596 958
    C 600 912 606 862 614 806
    C 624 740 628 656 622 582
    C 617 524 596 486 552 460
    C 526 444 494 432 452 432 Z`;

  // Тельняшка: полосы ИЗОГНУТЫ по бочке торса. Прямые полосы мгновенно
  // расплющивают фигуру в аппликацию — самый заметный признак дешёвого
  // векторного персонажа.
  let stripes = "";
  for (let i = 0; i < 16; i++) {
    const y = 452 + i * 34;
    const sag = 16 + Math.sin((i / 15) * Math.PI) * 11;
    const w = 21;
    const arc = (yy) => `M 350 ${yy} C 396 ${yy + sag} 512 ${yy + sag} 558 ${yy}`;
    stripes += `<path d="${arc(y)} L 558 ${y + w} C 512 ${y + sag + w} 396 ${y + sag + w} 350 ${y + w} Z"
                 fill="${TEL.stripe}"/>`;
    stripes += `<path d="${arc(y)} L 558 ${y + 4.5} C 512 ${y + sag + 4.5} 396 ${y + sag + 4.5} 350 ${y + 4.5} Z"
                 fill="${TEL.stripeH}" opacity="0.75"/>`;
    stripes += `<path d="${arc(y + w - 4)} L 558 ${y + w} C 512 ${y + sag + w} 396 ${y + sag + w} 350 ${y + w} Z"
                 fill="${TEL.stripeS}" opacity="0.7"/>`;
  }

  const shirtArea = `M 386 442
    C 420 430 486 430 520 442
    C 540 500 548 700 542 918
    L 362 918 C 356 700 366 500 386 442 Z`;

  // Полы кителя: левая ближе к зрителю и заходит на правую.
  const coatLeft = `M 392 440
    C 348 452 310 484 300 534
    C 290 610 294 720 304 812 C 312 866 318 912 322 958
    L 430 958 C 416 866 404 700 406 556 C 407 496 400 462 396 436 Z`;

  const coatRight = `M 516 438
    C 560 452 600 484 610 540
    C 620 620 618 722 608 810 C 600 866 596 912 592 958
    L 498 958 C 508 866 518 700 516 556 C 515 496 520 462 524 434 Z`;

  const collar = `M 396 436 C 424 424 484 424 516 436
    C 508 466 496 486 480 500 C 462 480 442 480 424 500
    C 410 486 400 464 396 436 Z`;

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g filter="${rim.ref}">
        <g filter="${gr.ref}">
          <g filter="${cl.ref}">
            <path d="${torso}" fill="${COAT.mid}"/>

            <!-- тельняшка -->
            <clipPath id="bd_shirt"><path d="${shirtArea}"/></clipPath>
            <g clip-path="url(#bd_shirt)">
              <path d="${shirtArea}" fill="url(#bd_tel)"/>
              ${stripes}
              <!-- бочка торса: перепад тона поперёк полос. Сами полосы
                   объёма не дают, его даёт этот перепад. -->
              ${sh("M 492 430 L 566 430 L 556 924 L 492 924 Z", "#0A1730", 0.42, "bd_s")}
              ${sh("M 348 430 L 390 430 L 386 924 L 344 924 Z", "#0A1730", 0.26, "bd_s")}
              ${sh("M 380 430 L 470 430 L 466 470 L 376 470 Z", "#0A1730", 0.35, "bd_s2")}
            </g>

            <!-- полы кителя -->
            <path d="${coatRight}" fill="url(#bd_coat)"/>
            ${sh("M 524 434 C 512 520 508 760 500 958 L 470 958 L 474 434 Z", "#000000", 0.3, "bd_s")}
            <path d="${coatLeft}" fill="url(#bd_coat)"/>
            ${sh("M 396 436 C 412 520 414 760 424 958 L 476 958 L 466 436 Z", "#000000", 0.38, "bd_s")}
            <!-- свет по левому плечу: ключ приходит сверху-слева -->
            ${sh("M 392 440 C 348 452 312 486 302 536 L 344 552 C 356 500 380 470 404 456 Z", COAT.hi, 0.5, "bd_s2")}

            <!-- воротник и лацканы -->
            <path d="${collar}" fill="url(#bd_coat)"/>
            <path d="M 396 436 C 386 486 390 542 400 580 C 414 548 418 492 414 444 Z"
                  fill="${COAT.hi}" opacity="0.45"/>
            <path d="M 516 438 C 526 488 524 542 514 580 C 502 548 498 492 502 446 Z"
                  fill="${COAT.hi}" opacity="0.3"/>
            <path d="M 396 436 C 424 424 484 424 516 436" fill="none"
                  stroke="${COAT.hi}" stroke-width="5" opacity="0.5"/>
          </g>

          <!-- пуговицы: на кромке полы, а не посреди тельняшки -->
          <g filter="${emb.ref}">
            ${[562, 636, 710, 784].map((y, i) => `
              <circle cx="${416 - i * 3}" cy="${y}" r="16" fill="url(#bd_gold)"/>
              <circle cx="${416 - i * 3}" cy="${y}" r="16" fill="none"
                      stroke="${P.goldShadow}" stroke-width="3" opacity="0.7"/>
              <circle cx="${411 - i * 3}" cy="${y - 5}" r="5" fill="${P.goldLight}" opacity="0.85"/>`).join("")}
          </g>

          <!-- ремень -->
          <g filter="${cl.ref}">
            <path d="M 310 888 C 382 910 522 910 604 888 L 608 944 C 522 966 384 966 306 944 Z"
                  fill="url(#bd_belt)"/>
            <path d="M 310 898 C 382 918 522 918 604 898" fill="none"
                  stroke="#C58A4E" stroke-width="4" opacity="0.4"/>
          </g>
          <g filter="${emb.ref}">
            <rect x="424" y="890" width="76" height="62" rx="11" fill="url(#bd_gold)"/>
            <rect x="440" y="906" width="44" height="30" rx="6" fill="none"
                  stroke="${P.goldShadow}" stroke-width="6" opacity="0.55"/>
          </g>
        </g>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: голова (char_head)

   Самый рискованный ассет проекта. Правила, по которым он собран:
   • Три четверти влево — герой смотрит НА барабаны, а не мимо игрока.
   • Крупный нос, тяжёлые веки, мешки под глазами, глубокие носогубные
     складки: возраст читается ФОРМОЙ, а не сеткой морщин-царапин.
   • Нос — отдельная фигура со своей фаской поверх лица, а не пятно
     тени. Вложенный фильтр даёт ему настоящую боковую плоскость, и
     профиль перестаёт быть аппликацией.
   • Рот закрыт усами (отдельный слой). Нарисованный вектором рот —
     самая частая причина, по которой персонаж уезжает в жуткое.
   ══════════════════════════════════════════════════════════════════ */

// Череп-яйцо, а не круг: затылок шире лба, лоб уходит назад, челюсть
// узкая. Нос ВХОДИТ в силуэт — в профиль он обязан торчать за линию
// лба, иначе три четверти читаются как анфас. Первая версия рисовала
// нос отдельной крупной фигурой поверх лица, и он превращался в клюв,
// приклеенный к щеке.
const HEAD_PATH = `M 450 182
  C 400 182 362 204 344 246
  C 336 268 336 292 342 306
  C 348 316 352 318 350 328
  C 346 344 332 356 316 374
  C 304 388 308 398 326 400
  C 340 402 348 400 352 404
  C 357 414 355 424 349 434
  C 344 444 350 452 362 458
  C 380 468 404 472 432 470
  C 468 466 498 448 516 420
  C 536 390 550 352 552 314
  C 556 270 548 230 526 208
  C 506 188 486 182 450 182 Z`;

function drawHead() {
  const b = BOX.head;
  // Главная форма головы: широкое мягкое освещение по силуэту.
  const sk = skinShade("hd_s", { height: 22, depth: 30, specular: 0.34, shininess: 13 });
  // Подформы — БЕЗ блика: их дело давать объём, а не свет. Блик один
  // на всё лицо, иначе оно рассыпается на блестящие шарики.
  const f1 = formLight("hd_f1", { height: 16, depth: 24 });   // крупные массы
  const f2 = formLight("hd_f2", { height: 9,  depth: 20 });   // мелкие
  const nose = formLight("hd_n", { height: 7, depth: 22, specular: 0.5, shininess: 22 });
  const ig = innerGlow("hd_g", SKIN.sss, { size: 18, opacity: 0.28 });
  const ct = contour("hd_k", INK, 2.6, { opacity: 0.82, softness: 0.9 });
  const rim = rimLight("hd_r", RIM, 4, { opacity: 0.62, offset: 4.5 });
  const dz = dither("hd_z");

  const defs = defsOf(sk, f1, f2, nose, ig, ct, rim, dz) + `
    ${linear("hd_skin", [
      ["0%", SKIN.hi], ["16%", SKIN.light], ["46%", SKIN.base],
      ["74%", SKIN.mid], ["100%", SKIN.shade]
    ], 22)}
    ${linear("hd_nose", [["0%", SKIN.light], ["44%", SKIN.base], ["100%", SKIN.mid]], 22)}
    ${linear("hd_neck", [["0%", SKIN.mid], ["55%", SKIN.shade], ["100%", SKIN.deep]], 100)}
    ${blobFill("hd_b", SKIN.base, 0.92)}
    ${blobFill("hd_bl", SKIN.light, 0.8)}
    ${blobFill("hd_bd", SKIN.mid, 0.75)}
    <radialGradient id="hd_blush">
      <stop offset="0%" stop-color="${SKIN.ruddy}" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="${SKIN.ruddy}" stop-opacity="0"/>
    </radialGradient>
    ${blur("hd_s0", 24)}
    ${blur("hd_s", 13)}
    ${blur("hd_s2", 6)}
    ${blur("hd_s3", 3)}`;

  // ── АНАТОМИЯ ПОДФОРМАМИ ──────────────────────────────────────────
  //
  // Один силуэт с нарисованными пятнами тени даёт «подушку с
  // аппликацией» — это и было в первых двух итерациях. Настоящий объём
  // получается иначе: лицо собирается из НЕСКОЛЬКИХ пересекающихся
  // масс, и КАЖДАЯ получает своё освещение по своей карте высот. Лоб,
  // скулы, надбровье, шар носа, подбородок и жевательная мышца — шесть
  // объёмов, которые в пересечении и читаются как череп с мясом.
  // Заливка у всех со спадом альфы (blobFill), поэтому границ не видно.
  const forms = `
    <!-- лоб -->
    <g filter="${f1.ref}"><ellipse cx="414" cy="256" rx="82" ry="54" fill="url(#hd_bl)"
       transform="rotate(-8 414 256)"/></g>
    <!-- черепная коробка сзади -->
    <g filter="${f1.ref}"><ellipse cx="478" cy="268" rx="66" ry="70" fill="url(#hd_b)"/></g>
    <!-- ближняя скула: главная масса лица -->
    <g filter="${f1.ref}"><ellipse cx="456" cy="362" rx="62" ry="54" fill="url(#hd_b)"
       transform="rotate(12 456 362)"/></g>
    <!-- дальняя скула, короче и ниже: это и есть три четверти -->
    <g filter="${f2.ref}"><ellipse cx="368" cy="358" rx="46" ry="40" fill="url(#hd_b)"/></g>
    <!-- надбровные дуги -->
    <g filter="${f2.ref}"><ellipse cx="376" cy="306" rx="44" ry="19" fill="url(#hd_bl)"
       transform="rotate(-10 376 306)"/></g>
    <g filter="${f2.ref}"><ellipse cx="466" cy="304" rx="42" ry="19" fill="url(#hd_bl)"
       transform="rotate(6 466 304)"/></g>
    <!-- жевательная мышца и челюсть -->
    <g filter="${f2.ref}"><ellipse cx="474" cy="408" rx="42" ry="36" fill="url(#hd_bd)"
       transform="rotate(-18 474 408)"/></g>
    <!-- подбородок -->
    <g filter="${f2.ref}"><ellipse cx="398" cy="434" rx="50" ry="30" fill="url(#hd_b)"/></g>
    <!-- валик над верхней губой (под усами, но форму держит) -->
    <g filter="${f2.ref}"><ellipse cx="390" cy="406" rx="40" ry="19" fill="url(#hd_b)"/></g>`;

  // Шея узкая и короткая — она почти вся уйдёт под воротник кителя.
  const neck = `M 400 444 C 402 490 396 512 382 528
    C 412 542 476 542 510 528
    C 496 512 490 490 490 442
    C 468 462 424 462 400 444 Z`;

  const ear = `
    <path d="M 522 328 C 548 320 562 338 560 366 C 558 392 544 410 526 410
             C 516 408 512 394 514 378 Z" fill="url(#hd_skin)"/>
    <path d="M 530 344 C 546 342 550 356 546 374 C 543 386 536 392 530 394"
          fill="none" stroke="${SKIN.shade}" stroke-width="5" opacity="0.6"/>
    <path d="M 522 332 C 542 328 554 342 554 362" fill="none"
          stroke="${SKIN.hi}" stroke-width="3.5" opacity="0.5"/>`;

  // Нос: силуэт уже задан HEAD_PATH, здесь только объём. Маленький
  // «шарик» кончика с собственной фаской + крыло + ноздря. Крупная
  // отдельная фигура носа поверх лица давала клюв — не повторять.
  const noseShape = `
    <g filter="${nose.ref}">
      <path d="M 330 356 C 314 368 306 382 310 392
               C 316 402 340 404 356 396
               C 366 390 366 372 358 360
               C 350 350 338 350 330 356 Z" fill="url(#hd_nose)"/>
    </g>
    <!-- боковая плоскость спинки: нос обязан иметь три плоскости -->
    ${sh("M 350 322 C 360 344 364 372 358 392 L 336 392 C 342 368 344 342 342 320 Z", SKIN.mid, 0.6, "hd_s3")}
    <!-- крыло и ноздря -->
    <path d="M 336 384 C 348 378 360 380 364 390 C 366 398 356 402 342 402
             C 330 402 328 392 336 384 Z" fill="${SKIN.mid}" opacity="0.6"/>
    <path d="M 322 390 C 330 384 342 386 346 392 C 340 399 328 399 322 390 Z"
          fill="${SKIN.deep}" opacity="0.72"/>
    <!-- блик на кончике: у пожилого человека нос всегда самый жирный -->
    <ellipse cx="320" cy="374" rx="13" ry="9" fill="${SKIN.hi}" opacity="0.6"
             transform="rotate(-34 320 374)" filter="url(#hd_s3)"/>`;

  // Общая лепка кладётся руками: широкие мягкие пятна вместо фильтра.
  // Так лицо получает форму без топографических колец (см. dither()).
  const modelling = `
    <!-- тень от козырька. Держится ВЫШЕ бровей: закрыв брови, она
         стирает всё выражение — на этом первая версия и погорела -->
    ${sh("M 336 236 C 392 208 516 208 594 246 C 596 274 592 282 584 288 C 500 250 390 256 340 284 Z", "#4A200E", 0.45, "hd_s")}
    <!-- височная и скуловая плоскости: свет уходит вправо-вниз.
         Размытие широкое НАМЕРЕННО: при stdDeviation 13 край пятна
         читался швом поперёк щеки -->
    ${sh("M 476 284 C 522 294 542 332 536 382 C 530 418 504 448 470 458 C 498 402 498 330 476 284 Z", SKIN.shade, 0.5, "hd_s0")}
    ${sh("M 428 458 C 470 456 500 440 518 418 C 508 450 470 470 428 472 Z", SKIN.deep, 0.38, "hd_s2")}
    <!-- линия челюсти: тень ПОД скулой + светлая кромка на самой
         челюсти. Без неё низ лица — гладкое яйцо -->
    ${sh("M 372 424 C 410 450 460 450 498 420 C 494 442 470 466 426 468 C 388 470 366 452 372 424 Z", SKIN.shade, 0.4, "hd_s2")}
    <path d="M 366 430 C 402 456 456 456 494 428" fill="none"
          stroke="${SKIN.hi}" stroke-width="7" opacity="0.28" stroke-linecap="round" filter="url(#hd_s2)"/>
    <!-- рефлекс закатного солнца по нижней кромке челюсти -->
    <path d="M 372 448 C 406 468 452 468 488 444" fill="none"
          stroke="${RIM}" stroke-width="10" opacity="0.3" stroke-linecap="round" filter="url(#hd_s2)"/>
    <!-- светлая масса лба и скулы слева: ключ приходит сверху-слева -->
    ${sh("M 348 258 C 386 232 448 228 486 244 C 442 250 388 268 358 300 Z", SKIN.hi, 0.4, "hd_s")}
    <!-- носогубные складки -->
    <path d="M 366 392 C 378 414 380 438 372 456" fill="none"
          stroke="${SKIN.shade}" stroke-width="7" opacity="0.42" stroke-linecap="round" filter="url(#hd_s3)"/>
    <path d="M 448 400 C 462 422 464 444 458 460" fill="none"
          stroke="${SKIN.shade}" stroke-width="6" opacity="0.3" stroke-linecap="round" filter="url(#hd_s3)"/>
    <!-- рот: видна только нижняя губа из-под усов, но без неё лицо
         мёртвое. Уголок приподнят — герой ДОБРОДУШНЫЙ, и это
         единственное место, где это можно сказать прямо -->
    ${sh("M 352 436 C 384 452 424 452 452 438 C 448 456 414 464 388 462 C 364 460 350 450 352 436 Z", SKIN.deep, 0.45, "hd_s3")}
    <path d="M 362 442 C 390 456 424 454 446 442" fill="none"
          stroke="${SKIN.line}" stroke-width="5" opacity="0.5" stroke-linecap="round"/>
    <ellipse cx="404" cy="452" rx="26" ry="9" fill="${SKIN.ruddy}" opacity="0.45"
             filter="url(#hd_s3)"/>
    <ellipse cx="396" cy="450" rx="14" ry="4" fill="${SKIN.hi}" opacity="0.4"
             filter="url(#hd_s3)"/>
    <!-- румянец: юг, солнце, стакан чаю -->
    <ellipse cx="356" cy="366" rx="44" ry="32" fill="url(#hd_blush)"/>
    <ellipse cx="472" cy="374" rx="46" ry="36" fill="url(#hd_blush)" opacity="0.6"/>
    <!-- блик на лбу -->
    <ellipse cx="392" cy="266" rx="42" ry="20" fill="${SKIN.hi}" opacity="0.32"
             transform="rotate(-20 392 266)" filter="url(#hd_s2)"/>`;

  // Мешки под глазами и гусиные лапки. Веки нависают — это возраст.
  const sockets = `
    ${sh("M 348 306 C 374 294 402 296 416 308 C 404 328 368 330 350 322 Z", SKIN.shade, 0.5, "hd_s3")}
    ${sh("M 432 310 C 460 298 492 300 506 314 C 492 334 454 336 434 326 Z", SKIN.shade, 0.44, "hd_s3")}
    <path d="M 352 348 C 372 360 396 360 412 352" fill="none"
          stroke="${SKIN.shade}" stroke-width="6" opacity="0.42" stroke-linecap="round"/>
    <path d="M 438 356 C 460 368 484 368 502 356" fill="none"
          stroke="${SKIN.shade}" stroke-width="6" opacity="0.38" stroke-linecap="round"/>
    <g stroke="${SKIN.shade}" stroke-width="4" opacity="0.4" fill="none" stroke-linecap="round">
      <path d="M 502 320 L 526 310"/>
      <path d="M 504 332 L 530 328"/>
      <path d="M 502 344 L 524 350"/>
    </g>`;

  // Брови — густые, седые, нависают КОЗЫРЬКОМ над глазами. Главный
  // носитель «добродушия»: подняты к внешним краям, а не сведены к
  // переносице. Рисуются пучками волос, а не сплошным пятном.
  const brow = (pts, flip) => {
    const [x0, y0, x1, y1, x2, y2] = pts;
    const base = `M ${x0} ${y0} C ${(x0 + x1) / 2} ${y0 - 22} ${(x1 + x2) / 2} ${y1 - 24} ${x2} ${y2}
      C ${(x1 + x2) / 2} ${y1 + 4} ${(x0 + x1) / 2} ${y0 + 12} ${x0} ${y0 + 14} Z`;
    // Волоски: четыре, вполсилы. Семь ярких белых штрихов читались как
    // расчёска, приклеенная ко лбу, — брови делает МАССА, а штрихи
    // только намекают на фактуру.
    let hairs = "";
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const x = x0 + (x2 - x0) * t;
      const y = y0 + (y2 - y0) * t - 10 - Math.sin(t * Math.PI) * 7;
      hairs += `<path d="M ${x.toFixed(0)} ${(y + 13).toFixed(0)} L ${(x + (flip ? 8 : -8)).toFixed(0)} ${y.toFixed(0)}"
                 stroke="${HAIR.hi}" stroke-width="3.4" opacity="0.42" stroke-linecap="round"/>`;
    }
    return `<path d="${base}" fill="#96A1B0"/>
            <path d="${base}" fill="#C9D1DA" opacity="0.85" transform="translate(0 -3)"/>
            <path d="${base}" fill="#ECEFF3" opacity="0.5" transform="translate(-2 -7)"/>
            ${hairs}
            <path d="M ${x0} ${y0 + 12} C ${(x0 + x2) / 2} ${(y0 + y2) / 2 + 4} ${(x1 + x2) / 2} ${y1 + 4} ${x2} ${y2 + 2}"
                  fill="none" stroke="${SKIN.shade}" stroke-width="4.5" opacity="0.45"/>`;
  };

  const brows = `${brow([336, 310, 376, 300, 420, 300], false)}
                 ${brow([434, 308, 472, 296, 512, 304], true)}`;

  // Седые виски из-под фуражки: ПУЧКИ ВОЛОС, а не белое пятно.
  // Сплошная светлая заливка на затылке читалась как приклеенный
  // бинт — светлое пятно на тёмной стороне головы физически
  // невозможно, если это не отдельный предмет.
  // ВЕНЧИК ВОКРУГ ЛЫСИНЫ. Нужен не для базовой позы — там его закрывает
  // фуражка, — а для реакции «крупный выигрыш», где герой снимает
  // фуражку и машет ею. Без венчика под фуражкой оказывался гладкий
  // телесный купол, и четыре кадра из восьми выглядели как манекен.
  // Полоса лежит по кромке черепа между 236 и 330: выше её прячет
  // тулья, ниже начинается висок.
  const fringe = `
    <path d="M 344 262 C 352 232 380 210 414 200
             C 462 188 512 200 536 232
             C 548 250 552 274 550 296
             C 540 264 516 240 480 230
             C 436 218 384 232 356 268 Z" fill="${HAIR.base}"/>
    <path d="M 348 258 C 360 232 386 216 416 208
             C 458 198 504 208 528 234
             C 500 216 456 212 416 224 C 382 234 360 244 348 258 Z"
          fill="${HAIR.hi}" opacity="0.7"/>
    <g stroke="${HAIR.mid}" stroke-width="4" opacity="0.5" fill="none" stroke-linecap="round">
      <path d="M 372 250 C 392 230 424 218 452 216"/>
      <path d="M 396 236 C 424 222 460 218 492 226"/>
      <path d="M 470 220 C 500 226 522 240 536 260"/>
    </g>`;

  const hair = `
    ${fringe}
    <path d="M 486 274 C 514 276 532 292 534 316 C 536 336 528 350 514 356
             C 512 328 500 298 486 274 Z" fill="${HAIR.mid}" opacity="0.85"/>
    <g stroke="${HAIR.base}" stroke-width="7" opacity="0.85" fill="none" stroke-linecap="round">
      <path d="M 490 280 C 512 286 526 300 528 320"/>
      <path d="M 496 300 C 514 306 524 318 524 336"/>
    </g>
    <g stroke="${HAIR.hi}" stroke-width="2.6" opacity="0.55" fill="none" stroke-linecap="round">
      <path d="M 492 284 C 510 292 522 304 524 320"/>
    </g>
    <!-- бакенбард перед ухом -->
    <path d="M 500 336 C 514 340 522 352 520 372 C 512 366 504 352 500 336 Z"
          fill="${HAIR.mid}" opacity="0.7"/>
    <path d="M 340 272 C 346 256 356 248 366 246" fill="none"
          stroke="${HAIR.base}" stroke-width="8" opacity="0.75" stroke-linecap="round"/>`;

  // Щетина по челюсти — «просоленный», а не гладко выбрит.
  const stubble = `<path d="M 350 424 C 380 450 442 458 480 436
    C 490 456 466 478 420 480 C 374 482 348 462 350 424 Z"
    fill="${HAIR.dark}" opacity="0.28" filter="url(#hd_s2)"/>`;

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g filter="${rim.ref}">
        <g filter="${dz.ref}">
          <g filter="${ig.ref}">
            <g filter="${sk.ref}">
              <path d="${neck}" fill="url(#hd_neck)"/>
              ${sh("M 392 448 C 418 470 472 470 494 448 C 494 492 496 516 504 530 L 386 530 C 394 516 396 492 392 448 Z", SKIN.deep, 0.55, "hd_s2")}
              ${ear}
              <path d="${HEAD_PATH}" fill="url(#hd_skin)"/>
            </g>
            <!-- подформы и подрисовка обрезаются силуэтом: иначе мягкие
                 края блобов вылезают за контур и дают ореол -->
            <clipPath id="hd_clip"><path d="${HEAD_PATH}"/></clipPath>
            <g clip-path="url(#hd_clip)">
              ${forms}
              ${modelling}
              ${noseShape}
              ${sockets}
              ${stubble}
            </g>
            ${brows}
            ${hair}
          </g>
        </g>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: глаза (char_eyes_open / char_eyes_closed)

   Дальний глаз (у профиля) короче и ниже ближнего: это и есть три
   четверти. Одинаковые глаза мгновенно разворачивают лицо в анфас и
   ломают весь поворот головы.
   ══════════════════════════════════════════════════════════════════ */

function eyePair(state) {
  const b = BOX.eyes;
  const open = state === "open" || state === "squint";
  const squint = state === "squint";
  const half = state === "half";
  const defs = `
    <radialGradient id="ey_i" cx="42%" cy="34%">
      <stop offset="0%" stop-color="#8FA982"/>
      <stop offset="62%" stop-color="#5C7A55"/>
      <stop offset="100%" stop-color="#2C3F2C"/>
    </radialGradient>
    ${blur("ey_s", 3)}`;

  const eye = (cx, cy, rx, ry, ix) => {
    const lid = `M ${cx - rx} ${cy} C ${cx - rx * 0.55} ${cy - ry * 1.75} ${cx + rx * 0.55} ${cy - ry * 1.7} ${cx + rx} ${cy - ry * 0.15}`;
    const low = `C ${cx + rx * 0.5} ${cy + ry * 1.05} ${cx - rx * 0.5} ${cy + ry * 1.05} ${cx - rx} ${cy}`;
    const id = `ec${Math.round(cx)}`;
    if (!open) {
      // Полузакрытые и закрытые. Веко идёт ДУГОЙ ВНИЗ: прямая линия
      // читается как «зажмурился от боли», а дуга — как моргание.
      const k = half ? 0.45 : 0.9;
      return `<g>
        <path d="M ${cx - rx} ${cy - 2} C ${cx - rx * 0.4} ${cy + ry * k} ${cx + rx * 0.4} ${cy + ry * k} ${cx + rx} ${cy - 2}"
              fill="none" stroke="${SKIN.line}" stroke-width="6.5" stroke-linecap="round"/>
        <path d="M ${cx - rx} ${cy - 8} C ${cx - rx * 0.4} ${cy + ry * k * 0.45} ${cx + rx * 0.4} ${cy + ry * k * 0.45} ${cx + rx} ${cy - 8}"
              fill="none" stroke="${SKIN.mid}" stroke-width="9" opacity="0.6" stroke-linecap="round"/>
      </g>`;
    }
    if (squint) {
      // Прищур радости: НИЖНЕЕ веко поднимается, верхнее опускается
      // слегка. Именно поднятое нижнее веко отличает улыбку глазами от
      // сонного взгляда — без него герой выглядит уставшим, а не
      // довольным.
      return `<g>
        <path d="M ${cx - rx} ${cy + 2} C ${cx - rx * 0.5} ${cy - ry * 1.15} ${cx + rx * 0.5} ${cy - ry * 1.1} ${cx + rx} ${cy + 1}
                 C ${cx + rx * 0.5} ${cy - ry * 0.1} ${cx - rx * 0.5} ${cy - ry * 0.1} ${cx - rx} ${cy + 2} Z"
              fill="#F0E1D0"/>
        <circle cx="${cx + ix}" cy="${cy - ry * 0.3}" r="${(ry * 0.9).toFixed(1)}" fill="url(#ey_i)"
                clip-path="url(#sq${Math.round(cx)})"/>
        <clipPath id="sq${Math.round(cx)}">
          <path d="M ${cx - rx} ${cy + 2} C ${cx - rx * 0.5} ${cy - ry * 1.15} ${cx + rx * 0.5} ${cy - ry * 1.1} ${cx + rx} ${cy + 1}
                   C ${cx + rx * 0.5} ${cy - ry * 0.1} ${cx - rx * 0.5} ${cy - ry * 0.1} ${cx - rx} ${cy + 2} Z"/>
        </clipPath>
        <path d="M ${cx - rx} ${cy + 2} C ${cx - rx * 0.5} ${cy - ry * 1.15} ${cx + rx * 0.5} ${cy - ry * 1.1} ${cx + rx} ${cy + 1}"
              fill="none" stroke="${SKIN.line}" stroke-width="6" stroke-linecap="round"/>
        <path d="M ${cx - rx} ${cy + 4} C ${cx - rx * 0.5} ${cy + ry * 0.1} ${cx + rx * 0.5} ${cy + ry * 0.1} ${cx + rx} ${cy + 3}"
              fill="none" stroke="${SKIN.mid}" stroke-width="7" opacity="0.75" stroke-linecap="round"/>
      </g>`;
    }
    return `<g>
      <path d="${lid} ${low} Z" fill="#F0E1D0"/>
      <clipPath id="${id}"><path d="${lid} ${low} Z"/></clipPath>
      <g clip-path="url(#${id})">
        <circle cx="${cx + ix}" cy="${cy}" r="${(ry * 1.25).toFixed(1)}" fill="url(#ey_i)"/>
        <circle cx="${cx + ix}" cy="${cy}" r="${(ry * 0.55).toFixed(1)}" fill="#100A06"/>
        <circle cx="${(cx + ix - ry * 0.45).toFixed(1)}" cy="${(cy - ry * 0.52).toFixed(1)}"
                r="${(ry * 0.32).toFixed(1)}" fill="#FFFFFF" opacity="0.95"/>
        <circle cx="${(cx + ix + ry * 0.5).toFixed(1)}" cy="${(cy + ry * 0.45).toFixed(1)}"
                r="${(ry * 0.16).toFixed(1)}" fill="#FFE8C8" opacity="0.5"/>
        <!-- тень верхнего века на радужке: без неё глаз выпучен -->
        <path d="M ${cx - rx - 5} ${cy - ry * 2} L ${cx + rx + 5} ${cy - ry * 2}
                 L ${cx + rx + 5} ${cy - ry * 0.35} C ${cx + rx * 0.4} ${cy - ry * 1.0} ${cx - rx * 0.4} ${cy - ry * 1.0} ${cx - rx - 5} ${cy - ry * 0.3} Z"
              fill="${SKIN.deep}" opacity="0.45" filter="url(#ey_s)"/>
      </g>
      <path d="${lid}" fill="none" stroke="${SKIN.line}" stroke-width="6" stroke-linecap="round"/>
      <path d="M ${cx - rx} ${cy} ${low.replace(/^C/, "C")}" fill="none"
            stroke="${SKIN.shade}" stroke-width="3" opacity="0.6" stroke-linecap="round"/>
    </g>`;
  };

  // Разрез узкий: у пожилого человека верхнее веко нависает, и белка
  // видно вдвое меньше, чем у молодого. Круглый «мультяшный» глаз
  // мгновенно скидывает герою тридцать лет.
  return layerDoc(b, defs, `
    ${eye(378, 328, 26, 10, 3)}
    ${eye(462, 334, 30, 12, -4)}`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: усы (char_moustache)

   Отдельным слоем, потому что при реакциях они «подпрыгивают» с
   опозданием на 2–3 кадра — дешёвый и очень заметный признак живого
   персонажа.
   ══════════════════════════════════════════════════════════════════ */

function drawMoustache() {
  const b = BOX.moustache;
  const bv = formLight("ms_b", { height: 7, depth: 18, specular: 0.16, shininess: 9,
    specColor: "#FFFFFF" });
  const ct = contour("ms_k", "#5A6474", 2.2, { opacity: 0.42, softness: 1.2 });

  // Не чисто-белый. Седой волос на закате тёплый, а «#FFFFFF плюс
  // фаска» даёт фарфор — первая версия выглядела приклеенной
  // керамической деталью.
  const defs = defsOf(bv, ct) + `
    ${linear("ms_h", [
      ["0%", "#F7F3EC"], ["22%", "#E2E2E0"], ["58%", "#B9BFC8"], ["100%", "#8A93A0"]
    ], 26)}
    ${blur("ms_s", 5)}`;

  // Моржовые усы В ТРИ ЧЕТВЕРТИ, а не симметричная бабочка. Дальняя
  // половина укорочена и частично уходит за нос, ближняя длиннее и
  // ниже. Симметричные усы разворачивают лицо в анфас и спорят с
  // поворотом головы, а торчащий за профиль левый ус читался как
  // приклеенный банан.
  const body = `M 366 392
    C 348 388 330 394 322 408
    C 314 422 318 440 330 444
    C 340 446 346 438 352 428
    C 358 418 362 412 370 410
    C 388 414 406 424 422 442
    C 436 458 452 458 460 448
    C 470 432 460 408 436 396
    C 414 386 386 386 366 392 Z`;

  const strands = [
    "M 362 398 C 344 400 332 410 326 424",
    "M 364 408 C 348 410 338 418 332 432",
    "M 374 398 C 400 402 422 416 438 438",
    "M 372 408 C 396 412 414 424 428 444",
    "M 370 418 C 390 424 404 434 414 450"
  ].map((d) =>
    `<path d="${d}" fill="none" stroke="${HAIR.hi}" stroke-width="4" opacity="0.65" stroke-linecap="round"/>
     <path d="${d}" fill="none" stroke="${HAIR.line}" stroke-width="1.6" opacity="0.26"
           stroke-linecap="round" transform="translate(2 5)"/>`).join("");

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g filter="${bv.ref}">
        <path d="${body}" fill="url(#ms_h)"/>
        ${sh("M 366 392 C 400 388 438 404 456 436 L 428 452 C 414 426 394 412 366 410 Z", "#7E8794", 0.28, "ms_s")}
        ${strands}
        <!-- ложбинка под носом -->
        <path d="M 366 392 C 360 402 360 414 366 426" fill="none"
              stroke="${HAIR.dark}" stroke-width="4" opacity="0.5"/>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: фуражка (char_hat)

   Три материала в одном предмете, и все три обязаны отличаться на
   глаз: матовое сукно тульи (широкий слабый блик), лакированный
   козырёк (узкий жёсткий, shininess 70) и золото краба (тёплый
   анизотропный через metalGold).
   ══════════════════════════════════════════════════════════════════ */

function drawHat(goldHref) {
  const b = BOX.hat;
  const cl = clothShade("ht_c", { height: 15, depth: 28, modeling: 0.4, specular: 0.3, shininess: 12 });
  const ct = contour("ht_k", INK, 2.6, { opacity: 0.82, softness: 0.9 });
  const rim = rimLight("ht_r", RIM, 5, { opacity: 0.7, offset: 5 });
  const gold = metalGold("ht_g", { href: goldHref, tile: 150, height: 3.5, depth: 20,
    anisotropy: 0.6, grooves: 0.08, specular: 1.35, shininess: 46 });
  const lac = bevel("ht_l", { height: 6, depth: 26, plateau: 0.6, specular: 2.4,
    shininess: 74, specColor: "#DCEBFF", modeling: 0.5, margin: 30 });
  const dz = dither("ht_z");

  const defs = defsOf(cl, ct, rim, gold, lac, dz) + `
    ${linear("ht_crown", [
      ["0%", CAP.hi], ["24%", CAP.base], ["66%", CAP.mid], ["100%", CAP.dark]
    ], 20)}
    ${linear("ht_band", [["0%", CAP.bandH], ["28%", CAP.band], ["100%", "#04060A"]], 100)}
    ${linear("ht_peak", [
      ["0%", CAP.peakH], ["16%", CAP.peak], ["58%", "#10141C"], ["100%", "#333B4C"]
    ], 100)}
    ${envGold("ht_gold", { angle: 100 })}
    ${blur("ht_s", 11)}
    ${blur("ht_s2", 4)}`;

  // Тулья «блином», как на настоящей морской фуражке. Первая версия
  // была вдвое выше и превращала капитана в повара: у морской фуражки
  // тулья ПЛОСКАЯ и шире околыша, а не купол.
  //
  // Нижняя кромка околыша обязана остаться ВЫШЕ бровей (276) — иначе
  // фуражка съедает лицо. Здесь самая низкая точка 266.
  const crown = `M 338 212
    C 326 172 352 136 406 122
    C 464 108 540 120 580 150
    C 608 172 614 198 602 214
    C 590 232 556 240 506 242
    C 444 244 376 232 338 212 Z`;

  const band = `M 336 206
    C 380 232 456 244 514 238
    C 552 234 584 224 598 208
    C 602 226 600 238 594 246
    C 576 262 514 270 450 266
    C 390 262 346 246 332 228 Z`;

  const peak = `M 340 240
    C 322 236 286 240 256 252
    C 224 266 212 284 226 296
    C 242 310 288 308 330 294
    C 362 284 384 272 392 254
    C 378 248 360 244 340 240 Z`;

  // «Краб» — кокарда: венок, якорь, звезда. Мелочь, но именно такие
  // мелочи отличают персонажа от иконки.
  const wreath = (from, step, n) => [...Array(n)].map((_, i) => {
    const a = from + i * step;
    const r = (a * Math.PI) / 180;
    const x = 404 + Math.cos(r) * 32, y = 230 + Math.sin(r) * 27;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="8.5" ry="4.2"
             transform="rotate(${(a + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join("");

  const badge = `
    <ellipse cx="404" cy="230" rx="40" ry="33" fill="url(#ht_gold)"/>
    <ellipse cx="404" cy="230" rx="26" ry="21" fill="#101827"/>
    <ellipse cx="404" cy="230" rx="26" ry="21" fill="none" stroke="${P.goldDeep}" stroke-width="3"/>
    <path d="M 404 218 L 404 244 M 393 224 L 415 224 M 391 237 C 391 249 417 249 417 237"
          fill="none" stroke="${P.goldPale}" stroke-width="4.2" stroke-linecap="round"/>
    <circle cx="404" cy="216" r="4.2" fill="none" stroke="${P.goldPale}" stroke-width="3"/>
    <g fill="url(#ht_gold)">${wreath(128, 17, 7)}${wreath(52, -17, 7)}</g>`;

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g filter="${rim.ref}">
        <g filter="${dz.ref}">
          <g filter="${cl.ref}">
            <path d="${crown}" fill="url(#ht_crown)"/>
            <!-- верхняя площадка тульи ловит небо, бок уходит в тень -->
            ${sh("M 356 152 C 420 120 528 126 582 164 C 548 142 440 134 356 166 Z", CAP.hi, 0.6, "ht_s")}
            ${sh("M 518 128 C 582 148 610 182 602 220 L 552 236 C 572 194 558 158 518 134 Z", CAP.dark, 0.5, "ht_s")}
            ${sh("M 338 208 C 392 236 466 244 532 238 L 538 214 C 458 222 386 210 342 188 Z", CAP.dark, 0.45, "ht_s")}
            <!-- кант между тульёй и околышем -->
            <path d="M 338 208 C 384 234 456 246 516 240 C 554 236 584 226 598 210"
                  fill="none" stroke="${CAP.hi}" stroke-width="6" opacity="0.85"/>
          </g>
          <g filter="${cl.ref}">
            <path d="${band}" fill="url(#ht_band)"/>
            ${sh("M 336 218 C 394 248 466 258 534 252 L 538 240 C 470 248 392 238 338 208 Z", "#FFFFFF", 0.18, "ht_s2")}
          </g>
          <g filter="${lac.ref}">
            <path d="${peak}" fill="url(#ht_peak)"/>
            <!-- отражение неба на лаке: узкая изогнутая полоса -->
            <path d="M 306 254 C 272 260 244 274 236 284" fill="none"
                  stroke="#A8D6F8" stroke-width="7" opacity="0.55" stroke-linecap="round"/>
            <path d="M 334 292 C 296 300 254 298 232 290" fill="none"
                  stroke="#75849E" stroke-width="4" opacity="0.45" stroke-linecap="round"/>
          </g>
        </g>
        <g filter="${gold.ref}">${badge}</g>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: ближняя рука (char_arm_right) — перед торсом

   Локоть прижат к боку, предплечье поднято: так держат горячий
   подстаканник. Предплечье сильно ракурсное (смотрит на зрителя) и
   потому короткое — это норма для трёх четвертей, а не ошибка.
   ══════════════════════════════════════════════════════════════════ */

function drawArmRight() {
  const b = BOX.armRight;
  const cl = clothShade("ar_c", { height: 14, depth: 24 });
  const ct = contour("ar_k", INK, 4, { opacity: 0.92, softness: 0.8 });
  const rim = rimLight("ar_r", RIM, 4, { opacity: 0.55, offset: 4 });
  const ep = formLight("ar_e", { height: 4, depth: 20, plateau: 0.5,
    specular: 1.5, shininess: 42, specColor: "#FFF6D8" });

  const defs = defsOf(cl, ct, rim, ep) + `
    ${linear("ar_coat", [
      ["0%", COAT.hi], ["22%", COAT.base], ["64%", COAT.mid], ["100%", COAT.dark]
    ], 24)}
    ${envGold("ar_gold", { angle: 100 })}
    ${blur("ar_s", 9)}`;

  // Плечо (340,480) → локоть (268,668) → запястье (256,556).
  const upper = `M 366 442
    C 310 452 280 494 270 556
    C 262 606 264 654 276 692
    C 288 722 330 720 340 692
    C 348 668 340 626 336 588
    C 332 546 342 502 372 470 Z`;

  const fore = `M 286 700
    C 258 690 240 656 238 616
    C 236 578 250 552 276 548
    C 302 544 320 566 324 606
    C 328 646 330 682 332 704 Z`;

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g filter="${rim.ref}">
        <g filter="${cl.ref}">
          <path d="${upper}" fill="url(#ar_coat)"/>
          ${sh("M 272 560 C 300 566 314 616 312 668 L 344 668 L 344 500 L 286 480 Z", COAT.dark, 0.45, "ar_s")}
          <path d="${fore}" fill="url(#ar_coat)"/>
          <!-- складка на сгибе локтя: без неё рукав — резиновый шланг -->
          <path d="M 276 668 C 296 690 316 700 334 702" fill="none"
                stroke="${COAT.line}" stroke-width="7" opacity="0.55" stroke-linecap="round"/>
          <path d="M 286 636 C 302 648 316 654 328 656" fill="none"
                stroke="${COAT.line}" stroke-width="5" opacity="0.35" stroke-linecap="round"/>
          <!-- свет по верхней кромке плеча -->
          <path d="M 360 452 C 320 468 296 502 288 552" fill="none"
                stroke="${COAT.hi}" stroke-width="8" opacity="0.4" stroke-linecap="round"/>
          <!-- ПОГОН. Прямое сравнение с эталонами (probe/char/_compare.png)
               показало главную беду силуэта: тёмный китель — сплошное
               ровное пятно, тогда как у Зевса и принцессы золото
               расставлено по всей фигуре и ведёт взгляд сверху вниз.
               Погоны дают золотую точку ровно там, где силуэт шире
               всего, и связывают кокарду с пряжкой ремня. -->
          <g filter="${ep.ref}">
            <path d="M 296 476 C 328 464 360 466 378 478
                     C 376 500 362 514 340 518
                     C 314 520 294 508 290 490 Z" fill="url(#ar_gold)"/>
            <path d="M 300 484 C 330 476 354 478 370 488" fill="none"
                  stroke="${P.goldShadow}" stroke-width="4" opacity="0.55"/>
            <circle cx="312" cy="498" r="6" fill="${P.goldLight}" opacity="0.9"/>
            <circle cx="334" cy="500" r="6" fill="${P.goldLight}" opacity="0.9"/>
            <circle cx="356" cy="500" r="6" fill="${P.goldLight}" opacity="0.9"/>
          </g>

          <!-- обшлаг с галунами -->
          <path d="M 236 604 C 250 578 288 574 306 596 L 314 630 C 296 606 256 610 240 634 Z"
                fill="${COAT.dark}"/>
          <g>
            ${[0, 15, 30].map((d) => `
              <path d="M ${236 - d * 0.1} ${594 - d} C ${252 - d * 0.1} ${568 - d} ${290 - d * 0.1} ${566 - d} ${306 - d * 0.1} ${588 - d}
                       L ${304 - d * 0.1} ${574 - d} C ${288 - d * 0.1} ${552 - d} ${250 - d * 0.1} ${556 - d} ${236 - d * 0.1} ${580 - d} Z"
                    fill="url(#ar_gold)"/>`).join("")}
          </g>
        </g>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СЛОЙ: кисть со стаканом (char_hand_glass)

   Подстаканник — самый «наш» предмет во всей картинке и самый
   благодарный: тонкая золотая филигрань, стекло, янтарный чай, ложка
   и пар. Именно на таких деталях считывается «дорогой арт», и именно
   он поднимается в реакции на выигрыш.
   ══════════════════════════════════════════════════════════════════ */

function drawHandGlass(goldHref) {
  const b = BOX.handGlass;
  // Кисть лепится ПОПАЛЬЦЕВО. Один фильтр на всю кисть строит карту
  // высот по ОБЪЕДИНЁННОЙ альфе, и три соседних пальца превращаются в
  // один купол — получалась варежка. Каждый палец обязан быть
  // отдельным маленьким объёмом со своей тенью в промежутке.
  const sk = skinShade("hg_s", { height: 9, depth: 24 });
  const fg = formLight("hg_f", { height: 5, depth: 20 });
  const gold = metalGold("hg_g", { href: goldHref, tile: 140, height: 3, depth: 20,
    anisotropy: 0.7, grooves: 0.09, specular: 1.45, shininess: 52 });
  const ct = contour("hg_k", INK, 4, { opacity: 0.9, softness: 0.8 });
  const rim = rimLight("hg_r", RIM, 4, { opacity: 0.6, offset: 4 });
  // Ореола вокруг стакана НЕТ. outerGlow с size 14 на почти прозрачном
  // краю раскладывался в цветные кольца — та же беда 8-битной альфы,
  // что и у ореола фигуры. Тёплый акцент на стакане и так есть: пар,
  // золото каркаса и rimLight по кромке.
  const glow = { ref: "none", def: "" };

  const defs = defsOf(sk, fg, gold, ct, rim, glow) + `
    ${linear("hg_skin", [["0%", SKIN.light], ["45%", SKIN.base], ["100%", SKIN.mid]], 24)}
    ${envGold("hg_gold", { angle: 96, sky: "#FFFAE8", horizonHot: "#FFFFFF",
      gold: "#FFD661", deep: "#C07E12", shadow: "#6B4406", bounce: "#FFE7A6" })}
    ${linear("hg_tea", [
      ["0%", "#F8B94E"], ["28%", "#D9791C"], ["68%", "#9C4A0C"], ["100%", "#5A2606"]
    ], 100)}
    ${linear("hg_glass", [
      ["0%", "#FFFFFF"], ["28%", "#DDEFF5"], ["55%", "#A7C9D6"], ["100%", "#EAF7FB"]
    ], 14)}
    ${blur("hg_s", 7)}
    ${blur("hg_s2", 3)}`;

  // РУЧКА СПРАВА, СТАКАН СЛЕВА. В первой версии ручка была слева, и
  // кисть, обхватывая корпус, закрывала собой весь подстаканник —
  // самая дорогая деталь картинки пропадала. Взявшись за ручку, герой
  // оставляет стакан полностью открытым.
  const glassBody = `M 158 446 L 250 446 L 236 566 L 172 566 Z`;
  const tea = `M 165 478 L 243 478 L 233 560 L 175 560 Z`;

  // ПРОРЕЗНАЯ стенка, а не сплошная. Первая версия заливала корпус
  // золотом целиком, и стакан с чаем исчезал под ним: получался
  // золотой стаканчик. Подстаканник — это КАРКАС, и держится он на
  // просветах между стойками.
  let lattice = "";
  for (let i = 0; i < 5; i++) {
    const x = 172 + i * 17;
    lattice += `<path d="M ${x} 470 L ${x + 5} 568" stroke="url(#hg_gold)"
                stroke-width="7" fill="none" stroke-linecap="round"/>`;
  }
  // ободок, поясок и донце — три горизонтали, которые держат каркас
  lattice += `<path d="M 164 512 C 194 520 214 520 240 512" stroke="url(#hg_gold)"
              stroke-width="9" fill="none" stroke-linecap="round"/>`;
  lattice += `<path d="M 160 472 C 194 482 216 482 248 472" stroke="url(#hg_gold)"
              stroke-width="11" fill="none" stroke-linecap="round"/>`;
  lattice += `<path d="M 172 566 C 194 574 214 574 236 566" stroke="url(#hg_gold)"
              stroke-width="10" fill="none" stroke-linecap="round"/>`;

  // Ручка крепится ВЫШЕ кулака, поэтому её видно поверх пальцев.
  const handle = `M 248 450
    C 296 444 322 470 320 502
    C 318 532 300 550 270 554
    L 268 528 C 290 524 300 514 300 500
    C 300 480 284 472 248 472 Z`;

  const spoon = `M 232 366 C 238 402 238 432 236 448 L 224 448
    C 226 432 226 402 220 366 Z`;

  // Кулак на ручке: четыре пальца поперёк дужки, большой сверху.
  // Пальцы РАЗДЕЛЕНЫ тёмными промежутками. Три одинаково освещённых
  // скруглённых пятна сливаются в варежку — читаемость кисти держится
  // не на форме пальцев, а на щелях между ними.
  const fingers = [
    ["M 262 480 C 292 470 316 482 320 502 C 324 522 306 532 278 532 C 258 532 250 520 252 502 C 254 488 258 482 262 480 Z", 530],
    ["M 260 508 C 290 498 316 510 320 530 C 324 550 304 562 276 562 C 256 562 248 550 250 532 C 252 518 256 510 260 508 Z", 560],
    ["M 264 536 C 292 528 314 538 318 556 C 322 576 304 586 278 586 C 258 586 250 576 252 558 C 254 546 258 538 264 536 Z", 584]
  ].map(([d, y]) =>
    `<g filter="${fg.ref}"><path d="${d}" fill="url(#hg_skin)"/></g>
     <path d="M 250 ${y - 2} C 276 ${y + 8} 304 ${y + 6} 322 ${y - 6}" fill="none"
           stroke="${SKIN.deep}" stroke-width="7" opacity="0.6" stroke-linecap="round"
           filter="url(#hg_s2)"/>`).join("");

  const palm = `M 280 474 C 316 466 338 492 340 528
    C 342 566 320 590 290 590 C 264 590 252 570 252 536
    C 252 502 262 480 280 474 Z`;

  const thumb = `M 266 448 C 288 440 306 452 308 470
    C 310 488 296 498 274 498 C 258 498 250 488 252 472 C 254 460 260 452 266 448 Z`;

  return layerDoc(b, defs, `
    <g filter="${ct.ref}">
      <g>
        <g filter="${rim.ref}">
          <!-- пар: рисуется первым, иначе ляжет поверх чая -->
          <g opacity="0.42" filter="url(#hg_s)">
            <path d="M 188 442 C 178 414 198 398 190 374 C 184 356 198 342 194 326"
                  fill="none" stroke="#FFE9C4" stroke-width="8" stroke-linecap="round"/>
            <path d="M 222 444 C 234 418 216 402 226 380 C 234 360 222 346 228 330"
                  fill="none" stroke="#FFE9C4" stroke-width="6.5" stroke-linecap="round"/>
          </g>
          <path d="${glassBody}" fill="url(#hg_glass)" opacity="0.92"/>
          <path d="${tea}" fill="url(#hg_tea)"/>
          <!-- мениск: светлый эллипс на поверхности чая -->
          <ellipse cx="204" cy="478" rx="39" ry="9" fill="#FFDCA6" opacity="0.65"/>
          <ellipse cx="204" cy="478" rx="39" ry="9" fill="none" stroke="#7A3606"
                   stroke-width="2" opacity="0.5"/>
          <path d="M 176 452 L 186 560" stroke="#FFFFFF" stroke-width="9" opacity="0.5"/>
          <g filter="${gold.ref}">
            <path d="${spoon}" fill="url(#hg_gold)"/>
            ${lattice}
            <ellipse cx="204" cy="448" rx="54" ry="12" fill="url(#hg_gold)"/>
            <ellipse cx="204" cy="448" rx="42" ry="7" fill="#3A2A10" opacity="0.5"/>
            <ellipse cx="202" cy="578" rx="34" ry="9" fill="url(#hg_gold)"/>
            <path d="${handle}" fill="url(#hg_gold)"/>
          </g>
          <g filter="${sk.ref}">
            <path d="${palm}" fill="url(#hg_skin)"/>
            <path d="${thumb}" fill="url(#hg_skin)"/>
            ${sh("M 280 472 C 318 466 344 492 344 530 L 306 594 C 328 552 318 492 280 488 Z", SKIN.shade, 0.45, "hg_s2")}
          </g>
          ${fingers}
        </g>
      </g>
    </g>`);
}

/* ══════════════════════════════════════════════════════════════════
   СБОРКА
   ══════════════════════════════════════════════════════════════════ */

/** Слои в порядке отрисовки: от дальнего к ближнему. */
export function layers(goldHref = null) {
  return [
    { key: "glow",       name: "char_glow",        box: BOX.glow,      pivot: PIVOT.glow,      svg: drawGlow() },
    { key: "legs",       name: "char_legs",        box: BOX.legs,      pivot: PIVOT.legs,      svg: drawLegs() },
    { key: "armLeft",    name: "char_arm_left",    box: BOX.armLeft,   pivot: PIVOT.armLeft,   svg: drawArmLeft() },
    { key: "body",       name: "char_body",        box: BOX.body,      pivot: PIVOT.body,      svg: drawBody() },
    { key: "head",       name: "char_head",        box: BOX.head,      pivot: PIVOT.head,      svg: drawHead() },
    { key: "eyesOpen",   name: "char_eyes_open",   box: BOX.eyes,      pivot: PIVOT.eyes,      svg: eyePair("open") },
    { key: "eyesHalf",   name: "char_eyes_half",   box: BOX.eyes,      pivot: PIVOT.eyes,      svg: eyePair("half") },
    { key: "eyesClosed", name: "char_eyes_closed", box: BOX.eyes,      pivot: PIVOT.eyes,      svg: eyePair("closed") },
    { key: "eyesSquint", name: "char_eyes_squint", box: BOX.eyes,      pivot: PIVOT.eyes,      svg: eyePair("squint") },
    { key: "moustache",  name: "char_moustache",   box: BOX.moustache, pivot: PIVOT.moustache, svg: drawMoustache() },
    { key: "hat",        name: "char_hat",         box: BOX.hat,       pivot: PIVOT.hat,       svg: drawHat(goldHref) },
    { key: "armRight",   name: "char_arm_right",   box: BOX.armRight,  pivot: PIVOT.armRight,  svg: drawArmRight() },
    { key: "handGlass",  name: "char_hand_glass",  box: BOX.handGlass, pivot: PIVOT.handGlass, svg: drawHandGlass(goldHref) }
  ];
}

/** Порядок композиции базовой позы. Варианты глаз в неё не входят. */
export const DRAW_ORDER = [
  "char_glow", "char_legs", "char_arm_left", "char_body", "char_head",
  "char_eyes_open", "char_moustache", "char_hat", "char_arm_right", "char_hand_glass"
];

/* ══════════════════════════════════════════════════════════════════
   РИГ

   ГРУППА ГОЛОВЫ. Голова, глаза, усы и фуражка обязаны вращаться
   вокруг ОДНОЙ точки — основания шеи (452, 500), а не каждый вокруг
   своей. Если повернуть каждый слой вокруг собственного пивота,
   фуражка съедет с макушки, а глаза уползут со лба: это самая частая
   ошибка в послойных ригах. Собственный пивот слоя нужен ВНУТРИ
   группы — для запаздывания фуражки и подскока усов.
   ══════════════════════════════════════════════════════════════════ */

export const RIG = Object.freeze({
  figure: FIGURE,
  // якорь: точка фигуры, которую клиент ставит в нужное место экрана.
  // Ноги обрезаны кадром, поэтому якорь — не «низ картинки», а точка
  // между ступнями на уровне земли.
  anchor: [452, 1470],
  groups: {
    head: { pivot: [452, 500],
            members: ["char_head", "char_eyes_open", "char_eyes_half",
                      "char_eyes_closed", "char_eyes_squint",
                      "char_moustache", "char_hat"] },
    torso: { pivot: [452, 950],
             members: ["char_body", "char_arm_left", "char_arm_right",
                       "char_hand_glass"] }
  },

  // Idle: сумма синусов. Периоды НАМЕРЕННО не кратны друг другу —
  // при кратных периодах вся фигура раз в цикл «схлопывается» в одну
  // фазу, и анимация начинает читаться как механизм.
  idle: {
    breath: { period: 3.4, layers: {
      "char_body":       { scaleY: 0.012, dy: -3, phase: 0 },
      "char_arm_left":   { rot: 1.1, dy: -2, phase: 0.12 },
      "char_arm_right":  { rot: -0.9, dy: -2, phase: 0.12 },
      "char_hand_glass": { rot: -0.7, dy: -2, phase: 0.18 },
      "@head":           { dy: -4, phase: 0.08 }
    } },
    sway: { period: 5.1, layers: {
      "@torso":          { rot: 0.8, phase: 0 },
      "@head":           { rot: -1.4, phase: 0.25 },
      "char_hat":        { rot: -1.8, phase: 0.42 },
      "char_moustache":  { rot: 1.2, phase: 0.5 },
      "char_arm_left":   { rot: 2.2, phase: 0.3 },
      "char_arm_right":  { rot: -1.6, phase: 0.35 }
    } },
    // Пар над стаканом и блеск золота живут своей жизнью.
    glass: { period: 2.3, layers: {
      "char_hand_glass": { rot: 0.6, dx: 1.5, phase: 0 }
    } },
    // Ореол дышит отдельно и очень медленно.
    glow: { period: 7.3, layers: {
      "char_glow": { scale: 0.03, alpha: 0.12, phase: 0 }
    } }
  },

  // Моргание. `sequence` — индексы КАДРОВ (0 open, 1 half, 2 closed),
  // а не имена: полуприкрытый кадр переиспользуется на закрытии и на
  // открытии, поэтому кадров три, а шагов пять.
  blink: { minGap: 2.6, maxGap: 6.4, sequence: [0, 1, 2, 1, 0],
           holdMs: [0, 45, 110, 45, 0] }
});

/* ─────────────────────── позы реакций ──────────────────────────────
   Поза — карта «слой или @группа» → {rot, dx, dy, scale, eyes}.
   Трансформы группы и слоя ПЕРЕМНОЖАЮТСЯ: сначала группа вокруг
   своего пивота, потом слой вокруг своего.
   ─────────────────────────────────────────────────────────────────── */

const P0 = {};

export const REACTIONS = Object.freeze({
  // Доволен: приподнимает стакан, кивает, глаза в прищур.
  win: { fps: 14, hold: 0, frames: [
    P0,
    { "@head": { rot: -2, dy: -4 }, "char_hat": { rot: -3 },
      "char_arm_right": { rot: -9 }, "char_hand_glass": { rot: -10, dx: 4, dy: -22 },
      eyes: "half" },
    { "@head": { rot: -5, dy: -9 }, "char_hat": { rot: -7, dy: -3 },
      "char_moustache": { rot: -3, dy: -2 },
      "char_arm_right": { rot: -20 }, "char_hand_glass": { rot: -22, dx: 10, dy: -58 },
      "@torso": { rot: -1 }, eyes: "squint" },
    { "@head": { rot: -4, dy: -7 }, "char_hat": { rot: -5, dy: -2 },
      "char_arm_right": { rot: -17 }, "char_hand_glass": { rot: -18, dx: 8, dy: -50 },
      eyes: "squint" },
    { "@head": { rot: -2, dy: -3 }, "char_arm_right": { rot: -8 },
      "char_hand_glass": { rot: -8, dx: 3, dy: -20 }, eyes: "squint" },
    P0
  ] },

  // Крупный выигрыш: снимает фуражку дальней рукой и машет ею,
  // стакан вверх, голова запрокинута.
  big: { fps: 15, hold: 0, frames: [
    P0,
    { "@head": { rot: -4, dy: -6 }, "char_hat": { rot: -6, dy: -14 },
      "char_arm_left": { rot: -26 }, "char_arm_right": { rot: -12 },
      "char_hand_glass": { rot: -12, dx: 6, dy: -34 }, eyes: "squint" },
    { "@head": { rot: -8, dy: -12 }, "char_hat": { rot: -30, dx: 84, dy: -96 },
      "char_arm_left": { rot: -62 }, "char_arm_right": { rot: -26 },
      "char_hand_glass": { rot: -26, dx: 14, dy: -76 },
      "@torso": { rot: -2, dy: -6 }, eyes: "squint" },
    { "@head": { rot: -9, dy: -14 }, "char_hat": { rot: -6, dx: 102, dy: -118 },
      "char_arm_left": { rot: -78 }, "char_arm_right": { rot: -30 },
      "char_hand_glass": { rot: -30, dx: 16, dy: -84 },
      "@torso": { rot: -3, dy: -8 }, "char_moustache": { rot: -4, dy: -3 }, eyes: "squint" },
    { "@head": { rot: -7, dy: -12 }, "char_hat": { rot: -40, dx: 80, dy: -108 },
      "char_arm_left": { rot: -60 }, "char_arm_right": { rot: -28 },
      "char_hand_glass": { rot: -28, dx: 15, dy: -80 },
      "@torso": { rot: -2, dy: -6 }, eyes: "squint" },
    { "@head": { rot: -9, dy: -14 }, "char_hat": { rot: -4, dx: 104, dy: -122 },
      "char_arm_left": { rot: -80 }, "char_arm_right": { rot: -30 },
      "char_hand_glass": { rot: -30, dx: 16, dy: -86 },
      "@torso": { rot: -3, dy: -8 }, eyes: "squint" },
    { "@head": { rot: -4, dy: -6 }, "char_hat": { rot: -8, dy: -16 },
      "char_arm_left": { rot: -30 }, "char_arm_right": { rot: -14 },
      "char_hand_glass": { rot: -14, dx: 7, dy: -38 }, eyes: "half" },
    P0
  ] },

  // Не повезло: пожимает плечами, брови вверх, стакан чуть в сторону.
  lose: { fps: 11, hold: 0, frames: [
    P0,
    { "@head": { rot: 2, dy: 3 }, "@torso": { dy: -4 },
      "char_arm_left": { rot: 8, dy: -8 }, "char_arm_right": { rot: 7, dy: -8 },
      "char_hand_glass": { rot: 8, dx: -6, dy: -8 }, eyes: "half" },
    { "@head": { rot: 4, dy: 7 }, "@torso": { dy: -9 },
      "char_arm_left": { rot: 17, dy: -18 }, "char_arm_right": { rot: 15, dy: -18 },
      "char_hand_glass": { rot: 17, dx: -14, dy: -18 },
      "char_hat": { rot: 3, dy: 2 }, eyes: "half" },
    { "@head": { rot: 4, dy: 7 }, "@torso": { dy: -9 },
      "char_arm_left": { rot: 17, dy: -18 }, "char_arm_right": { rot: 15, dy: -18 },
      "char_hand_glass": { rot: 17, dx: -14, dy: -18 },
      "char_hat": { rot: 3, dy: 2 }, eyes: "half" },
    { "@head": { rot: 2, dy: 3 }, "@torso": { dy: -4 },
      "char_arm_left": { rot: 8, dy: -8 }, "char_arm_right": { rot: 7, dy: -8 },
      "char_hand_glass": { rot: 8, dx: -6, dy: -8 } },
    P0
  ] }
});

/** Контракт для producers/character.mjs. */
export const CHARACTER = layers().map((l) => ({
  name: l.name, svg: () => l.svg, box: l.box, pivot: l.pivot
}));
