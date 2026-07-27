// 12 игровых символов слота «Sochi Sunset» + покадровые анимации.
//
// ID и ключи обязаны совпадать с SYMBOL_KEYS в server/src/math/gameConfig.js —
// это контракт между математикой и графикой: индекс в ленте и есть id символа.
// Переименование кадра ломает клиент молча: атлас соберётся, барабан будет пуст.
//
// ─────────────────────────────────────────────────────────────────────
// ЧТО ИЗМЕНИЛОСЬ ПО СРАВНЕНИЮ С ПЕРВОЙ ВЕРСИЕЙ
//
// Первая версия рисовала символы плоскими заливками с градиентом. На
// барабане это читается как аппликация: у предмета нет толщины, свет
// нарисован, а не посчитан, и все двенадцать выглядят как прототип.
//
// Здесь объём считается по-настоящему — feDiffuseLighting и
// feSpecularLighting по карте высот из альфы (рецепты в svg-lib.mjs).
// Растеризатор — headless Chromium с полной реализацией SVG-фильтров,
// поэтому «фотографический» объём получается процедурно.
//
// Три вещи, из которых состоит качество эталонов Pragmatic и которых
// не было раньше:
//
//   1. ОПРАВА. У Gates of Olympus каждый самоцвет сидит в золотой
//      обойме с завитками по углам и тёмной линией между металлом и
//      камнем. Оправа даёт едва ли не половину воспринимаемой цены
//      символа — сам камень при этом простой.
//   2. МЕДАЛЬОН. Каждый дорогой символ лежит на цветном диске в золотом
//      ободе. Диск задаёт одинаковый силуэт всем пяти, поэтому «вещь»
//      мгновенно отличается от «камешка», а цвет диска работает меткой
//      номинала: глаз ловит цвет раньше, чем силуэт.
//   3. КОНТУР И КОНТАКТНАЯ ТЕНЬ у КАЖДОГО символа. Без тёмной обводки
//      яркий символ растворяется в ярком фоне; без двойной тени
//      (плотное пятно контакта + широкий ореол) он висит в пустоте.
//
// Свет один на все двенадцать — LIGHT из svg-lib (азимут 225°,
// элевация 55°, то есть сверху-слева). Отклонение допущено ровно одно
// и осознанно: ГРАВИРОВКА освещается зеркально (азимут 45°), потому
// что у канавки освещена дальняя стенка, а не ближняя.
//
// Любой символ можно заменить готовым PNG: положите art/symbols/<ключ>.png.
// ─────────────────────────────────────────────────────────────────────

import { PALETTE as P, SOCHI as S, SOCHI_GEMS as GEMS } from "./palette.mjs";
import {
  LIGHT, svgDoc, namespaceSvg, ngon, polar, mix, sparkle,
  linear, linearV, radial, blurFilter,
  bevel, glassGem, cutGem, metalGold,
  contour, dropContact, outerGlow, grain, defsOf
} from "./svg-lib.mjs";
import { detailUri } from "./pbr.mjs";

const SIZE = 256;
const C = 128;

/**
 * Пространство имён с поправкой на href.
 *
 * namespaceSvg из svg-lib переименовывает `id="…"` и `url(#…)`, но НЕ
 * трогает `href="#…"`. Растеризатор кладёт все символы в один документ,
 * поэтому id обязаны быть уникальны — и после переименования ссылка
 * `<textPath href="#arc">` указывает в пустоту.
 *
 * Ломается это МОЛЧА: SVG без ошибок рисует текст нулевой длины. Ровно
 * так с символа scatter пропала надпись — файл собирался, тест проходил,
 * а надписи на картинке не было.
 *
 * Править общий svg-lib нельзя (его читают ещё три агента), поэтому
 * поправка живёт здесь. `href="data:…"` не затрагивается: регулярное
 * выражение требует решётки.
 */
function ns(svg, prefix) {
  return namespaceSvg(svg, prefix)
    .replace(/href="#([A-Za-z][\w-]*)"/g, (m, id) =>
      id.startsWith(`${prefix}__`) ? m : `href="#${prefix}__${id}"`);
}

/* ──────────────────────── карта микрорельефа ─────────────────────── */
//
// metalGold подмешивает карту ДЕТАЛИ (обесцвеченную, вокруг 0.5), а не
// цветную фотографию золота: макро-тон обязан задаваться формой предмета,
// а не случайным местом плитки.
//
// Плитка маленькая намеренно: data:-URI встраивается в КАЖДЫЙ символ, и
// карта на 512 px раздула бы страницу растеризатора до десятков мегабайт.
//
// Загрузка один раз на модуль через top-level await: svg() обязан остаться
// синхронным — его так зовёт и producers/symbols.mjs, и tools/preview/run.mjs.
let GOLD_DETAIL = null;
try {
  GOLD_DETAIL = await detailUri("gold", { size: 160, amount: 0.42, saturation: 0.08 });
} catch (err) {
  console.warn(`  symbols: PBR-карта золота недоступна (${err.message}) — металл без микрорельефа`);
}

/* ═══════════════════════ ГЕОМЕТРИЧЕСКИЕ УТИЛИТЫ ═══════════════════ */

const f2 = (v) => (Math.round(v * 100) / 100).toString();

/** Сплющивание набора точек относительно центра (овал, «маркиз»). */
function squash(pts, cx, cy, sx, sy) {
  return pts.map((p) => ({ x: cx + (p.x - cx) * sx, y: cy + (p.y - cy) * sy }));
}

/** Замкнутый путь по точкам. */
function poly(pts) {
  return `M ${pts.map((p) => `${f2(p.x)} ${f2(p.y)}`).join(" L ")} Z`;
}

/**
 * Контур, отодвинутый наружу на постоянное расстояние, со СКРУГЛЁННЫМИ
 * углами.
 *
 * Наивный способ раздуть многоугольник — умножить радиус. Он даёт полосу
 * разной ширины (у треугольника вдвое уже, чем у шестиугольника) и
 * вытягивает углы в шипы: у треугольника внешний угол уезжает от камня
 * на две ширины полосы, и символ превращается в золотую звезду с
 * камешком внутри.
 *
 * Здесь каждое РЕБРО отодвигается ровно на d, а стыки замыкаются дугой
 * радиуса d вокруг исходной вершины. Полоса выходит одинаковой по всему
 * периметру при любом числе сторон, а угол получает то самое мягкое
 * скругление, которое есть у настоящей ювелирной обоймы.
 */
function offsetRound(pts, cx, cy, d, steps = 6) {
  const n = pts.length;
  const normal = (p, q) => {
    const tx = q.x - p.x, ty = q.y - p.y;
    const l = Math.hypot(tx, ty) || 1;
    let nx = ty / l, ny = -tx / l;
    // Наружу — та сторона, что дальше от центра.
    const mx = (p.x + q.x) / 2 - cx, my = (p.y + q.y) / 2 - cy;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
    return { x: nx, y: ny };
  };

  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const nA = normal(prev, cur), nB = normal(cur, next);
    const a0 = Math.atan2(nA.y, nA.x);
    const a1 = Math.atan2(nB.y, nB.x);
    let da = a1 - a0;
    while (da <= -Math.PI) da += 2 * Math.PI;
    while (da > Math.PI) da -= 2 * Math.PI;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (da * k) / steps;
      out.push({ x: cur.x + d * Math.cos(a), y: cur.y + d * Math.sin(a) });
    }
  }
  return out;
}

/**
 * Кольцо между двумя контурами.
 * fill-rule="evenodd" делает внутренний контур дыркой независимо от
 * направления обхода — не нужно следить за порядком точек.
 */
function ringPath(outer, inner) {
  return `${poly(outer)} ${poly(inner)}`;
}

/**
 * Спиральный завиток (волюта) — базовый элемент барочного орнамента.
 *
 * Лента вдоль логарифмической спирали с сужением к концу. Рисовать
 * завитки безье «на глаз» бесполезно: они получаются разной кривизны и
 * орнамент выглядит кустарным. Аналитическая спираль даёт одинаковый
 * ход завитка на любом масштабе.
 */
function volute(cx, cy, { r0 = 10, r1 = 1.8, w0 = 3.4, w1 = 0.7, turns = 1.1, start = 0, dir = 1, steps = 40 }) {
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = ((start + dir * turns * 360 * t) * Math.PI) / 180;
    const r = r0 * Math.pow(r1 / r0, t);
    const w = (w0 + (w1 - w0) * t) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    outer.push({ x: cx + (r + w) * ca, y: cy + (r + w) * sa });
    inner.push({ x: cx + (r - w) * ca, y: cy + (r - w) * sa });
  }
  const pt = (p) => `${f2(p.x)} ${f2(p.y)}`;
  return `M ${pt(outer[0])} ${outer.slice(1).map((p) => `L ${pt(p)}`).join(" ")} ` +
         `L ${pt(inner[inner.length - 1])} ${inner.slice().reverse().slice(1).map((p) => `L ${pt(p)}`).join(" ")} Z`;
}

/**
 * Ювелирный «лепесток» — орнамент оправы.
 *
 * Локальная система координат: НАРУЖУ смотрит +Y. Вызывающий поворачивает
 * группу так, чтобы +Y совпал с внешней нормалью угла, — тогда орнамент
 * одинаково садится на любой угол любой огранки.
 */
function fleur(s) {
  // Три доли и бусина. Пропорции подобраны так, чтобы орнамент
  // ЗАКРУГЛЯЛ угол оправы, а не удлинял его: вытянутый лепесток
  // превращает угол в наконечник стрелы и ломает узнаваемость силуэта.
  return `
    <ellipse cx="${f2(-0.66 * s)}" cy="${f2(0.06 * s)}" rx="${f2(0.36 * s)}" ry="${f2(0.27 * s)}"/>
    <ellipse cx="${f2(0.66 * s)}"  cy="${f2(0.06 * s)}" rx="${f2(0.36 * s)}" ry="${f2(0.27 * s)}"/>
    <path d="M 0 ${f2(-0.30 * s)}
             C ${f2(0.50 * s)} ${f2(0.02 * s)} ${f2(0.40 * s)} ${f2(0.50 * s)} 0 ${f2(0.70 * s)}
             C ${f2(-0.40 * s)} ${f2(0.50 * s)} ${f2(-0.50 * s)} ${f2(0.02 * s)} 0 ${f2(-0.30 * s)} Z"/>
    <circle cx="0" cy="${f2(0.16 * s)}" r="${f2(0.24 * s)}"/>`;
}

/** Орнамент, поставленный на угол оправы нормалью наружу. */
function fleurAt(x, y, normalDeg, s) {
  // rotate(θ) переводит локальный +Y в (−sinθ, cosθ). Нужно, чтобы это
  // был вектор внешней нормали (cos α, sin α) ⇒ θ = α − 90.
  return `<g transform="translate(${f2(x)} ${f2(y)}) rotate(${f2(normalDeg - 90)})">${fleur(s)}</g>`;
}

/* ═══════════════════════ ОБЩИЙ КАРКАС СИМВОЛА ════════════════════ */

// Тень одна и та же у всех двенадцати.
//
// Дальность выбрана из размера кадра, а не «на глаз». Символ обязан
// заполнять ячейку: в эталонах камень занимает 94 % ширины кадра, и
// именно поэтому он выглядит крупным и дорогим. Значит на тень остаётся
// 16 px: distance·0.7 + 2σ = 3.5 + 16 ≈ 19 px, а дальний хвост ореола
// (третья сигма) обрезается краем и глазом не читается.
const SHADOW = { distance: 5, contactBlur: 2, ambientBlur: 8, ambient: 0.46 };

/**
 * Локальная подстройка камней.
 *
 * palette.mjs держит агент темы, туда лезть нельзя, а курортная гамма
 * объективно светлее эталонной: у рубина `light` — пастельный #FF7A8C,
 * и освещённые грани уезжают в розовый леденец. В эталоне те же грани
 * ОРАНЖЕВЫЕ: камень лежит в закатном свете и ловит его цвет.
 *
 * Поэтому светлые ступени рампы уводятся в тепло прямо здесь, на уровне
 * символа. Тон массы (`base`, `dark`, `darkest`) не трогается — по нему
 * тема узнаёт камень в таблице выплат и в частицах.
 */
const GEM_WARMTH = {
  ruby:     { lightest: "#FFD8B8", light: "#FF6A44", glow: "#FF7A2E" },
  amber:    { lightest: "#FFF3D0", light: "#FFB53A", glow: "#FFAE21" },
  emerald:  { lightest: "#E4FFD6", light: "#7BEE7E", glow: "#5FE06A" },
  aqua:     { lightest: "#EAFDFF", light: "#8FE9DC", glow: "#4FE3D2" },
  amethyst: { lightest: "#FFE4FF", light: "#D678FF", glow: "#C05CFF" }
};

function warmGem(key) {
  return { ...GEMS[key], ...(GEM_WARMTH[key] || {}) };
}

/**
 * Подмешивание белого — им сделан «удар света» в кадрах победы.
 * feComponentTransfer по цветовым каналам, альфа не трогается: символ не
 * раздувается и не теряет контур.
 */
function whiten(id, amount) {
  const s = f2(1 - amount * 0.30);
  const i = f2(amount * 0.62);
  const ch = ["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="${s}" intercept="${i}"/>`).join("");
  return {
    id, ref: `url(#${id})`,
    def: `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%"
        color-interpolation-filters="sRGB"><feComponentTransfer>${ch}</feComponentTransfer></filter>`
  };
}

/**
 * ГРАВИРОВКА — тот же bevel, но свет зеркально отражён (азимут 45°).
 *
 * Это не нарушение единого источника, а его следствие: у выступающего
 * рельефа освещена ближняя к источнику стенка, у КАНАВКИ — дальняя.
 * Иначе «вдавленность» не изобразить, а нарисованная штриховка сразу
 * читается наклейкой поверх металла.
 */
const CARVE_LIGHT = Object.freeze({
  azimuth: 45, elevation: 55, x: 0.7071, y: 0.7071, shadowX: -0.7071, shadowY: -0.7071
});

function engrave(id, opts = {}) {
  const { height = 1.7, depth = 20, specular = 0.55, shininess = 30 } = opts;
  return bevel(id, {
    height, depth, plateau: 0.35, modeling: 0,
    specular, shininess, specColor: "#FFF3C4",
    light: CARVE_LIGHT, margin: 30
  });
}

/**
 * Металл оправы. Один набор параметров на всю игру: ширина фаски
 * подобрана под толщину ободов 10…16 px в проектных координатах.
 */
function goldMetal(id, opts = {}) {
  return metalGold(id, {
    href: GOLD_DETAIL,
    tile: 150,
    texture: 0.26,
    height: 3.0,
    depth: 21,
    anisotropy: 0.72,
    grooves: 0.028,
    grooveFreq: 0.07,
    // Блик держится СКРОМНЫМ, а острота — высокой.
    //
    // Ширина фаски (height) обязана быть заметно меньше ширины полосы
    // металла. Как только σ размытия подбирается к половине полосы,
    // карта высот не успевает выйти на плато: наклон остаётся по всей
    // ширине, блик ложится на всё разом, и золото белеет до состояния
    // жести. Один шаг height с 3.3 до 4.5 на ободе 15 px обесцветил
    // весь комплект — на глаз, до замера, это выглядит просто «ярче».
    specular: 1.0,
    shininess: 40,
    tint: "#FFF6D8",
    ...opts
  });
}

/**
 * ЗОЛОТО СИМВОЛА — один градиент на весь кадр.
 *
 * Здесь была самая дорогая ошибка этой фазы. envGold() из svg-lib —
 * градиент в долях ОГРАНИЧИВАЮЩЕЙ РАМКИ элемента. На одной большой
 * пластине это правильно, но символ состоит из десятка золотых кусков:
 * обод, завитки, лепестки оправы, шампур. Каждый кусок получает СВОЮ
 * рамку, то есть свой полный ход «небо → горизонт → тень → отскок»,
 * сжатый в двадцать пикселей. Завиток размером с ноготь оказывается
 * наполовину белым и наполовину чёрным, обод белеет сверху, и весь
 * металл рассыпается на несогласованные пятна. Именно от этого золото
 * выглядело жестью, а не золотом.
 *
 * gradientUnits="userSpaceOnUse" привязывает ход к КАДРУ: сколько бы
 * золотых деталей ни было, все они освещены одним и тем же перепадом
 * сверху вниз. Это и есть «единый источник света» применительно к
 * заливке.
 *
 * Ось наклонена по ключу (сверху-слева вниз-направо). Чисто белого в
 * рампе нет: раскалённый горизонт — тёплый #FFFAE6. Белый превращает
 * золото в хром.
 */
function goldEnv(id) {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"
      x1="46" y1="4" x2="212" y2="252">
    <stop offset="0%"   stop-color="#FFE08C"/>
    <stop offset="6%"   stop-color="#FFF4CC"/>
    <stop offset="16%"  stop-color="#F6C63E"/>
    <stop offset="36%"  stop-color="#C9871A"/>
    <stop offset="52%"  stop-color="#7E4C06"/>
    <stop offset="68%"  stop-color="#C08117"/>
    <stop offset="86%"  stop-color="#FFD880"/>
    <stop offset="100%" stop-color="#D89A25"/>
  </linearGradient>`;
}

/**
 * Золото БУКВ — отдельный градиент, не envGold.
 *
 * envGold — отражение сцены: в середине ленты у него намеренно тёмная
 * полоса тени. На большой пластине это читается формой, а на букве
 * высотой 30 px тёмная полоса приходится ровно на середину знака, и
 * надпись выглядит коричневой. Буквам нужен простой ход «свет сверху».
 */
function goldLetters(id) {
  return linearV(id, [
    ["0%", "#FFF6D2"], ["30%", "#FFDB78"], ["58%", "#F0B02A"],
    ["82%", "#C9860F"], ["100%", "#F6D264"]
  ]);
}

/**
 * Каркас: тень снаружи, ореол, контур, дальше содержимое.
 *
 * Порядок вложения обязателен. Тень снаружи всех — иначе она попадёт под
 * блик и станет светлой; контур внутри ореола — иначе ореол рисуется от
 * необведённого силуэта и по краю остаётся щель.
 */
function shell(pre, { contourColor = "#2A0B45", contourWidth = 3.0, shadow = 0.62, glow = null, glowSize = 15, glowOpacity = 0.38 } = {}) {
  const sh = dropContact(`${pre}sh`, shadow, SHADOW);
  const ct = contour(`${pre}ct`, contourColor, contourWidth, { softness: 0.65 });
  const gl = glow ? outerGlow(`${pre}gl`, glow, {
    size: glowSize, opacity: glowOpacity, halo: 2.3, haloOpacity: glowOpacity * 0.5
  }) : null;
  return {
    defs: defsOf(sh, gl, ct),
    open: `<g filter="${sh.ref}">${gl ? `<g filter="${gl.ref}">` : ""}<g filter="${ct.ref}">`,
    close: `</g>${gl ? "</g>" : ""}</g>`
  };
}

/* ═══════════════════════════ САМОЦВЕТЫ ═══════════════════════════ */

/**
 * Младший символ: огранённый камень в золотой оправе.
 *
 * Слои снизу вверх:
 *   оправа (кольцо по контуру камня, металл по PBR-карте с фаской)
 *   орнаменты на углах оправы
 *   камень: cutGem даёт геометрию граней, glassGem — стекло
 *   тёмная линия «металл/камень» — без неё оправа сливается с камнем
 *   искра поверх блика
 *
 * Все пять — одно семейство форм: правильный многоугольник разного числа
 * сторон. Иерархия ценности обязана читаться силуэтом, а не деталями,
 * поэтому камни намеренно проще дорогих символов.
 */
function gemSymbol(pre, gemKey, opts = {}) {
  const {
    sides = 5,
    rotation = -90,
    outer = 114,          // габарит символа по описанной окружности
    squashX = 1,
    squashY = 1,
    deepen = 0.30,
    table = 0.50,
    girdle = 0.85,
    contrast = 1.2,
    // ТОЛЩИНА ОПРАВЫ ЗАДАЁТСЯ В ПИКСЕЛЯХ, а не в долях радиуса.
    //
    // Две ловушки подряд. Первая: 0.185 радиуса давало золотую
    // ПРОВОЛОКУ — в такую полосу физически не помещается ни фаска, ни
    // тёмная линия по внутреннему краю, а без них оправы просто нет.
    //
    // Вторая тоньше. Доля радиуса — НЕ ширина полосы: у правильного
    // n-угольника расстояние от центра до стороны равно r·cos(π/n),
    // поэтому один и тот же множитель даёт у шестиугольника полосу
    // 0.87·k·r, а у треугольника — 0.5·k·r, вдвое уже. Пять камней,
    // собранных «одним параметром», получались с оправами разной
    // толщины, и семейство разваливалось. Здесь множитель считается из
    // нужной ширины полосы обратно.
    band = 17,
    ornaments = null,       // индексы вершин под орнамент; null — все
    ornScale = 1,
    seed = 7
  } = opts;

  const gem = warmGem(gemKey);
  const cx = C, cy = C;

  // Габарит символа задаётся СНАРУЖИ, а размер камня считается из него.
  //
  // Иначе не свести: при постоянной ширине полосы оправа отъедает от
  // радиуса тем больше, чем острее угол (у треугольника вдвое больше,
  // чем у шестиугольника). Задавая радиус камня, получаешь пять
  // символов разного габарита — треугольники вылезают за кадр, а
  // шестиугольник теряется. Задавая габарит, получаешь пять одинаково
  // крупных символов, что и требуется от одного номинала.
  // Со скруглением стыков внешний контур отстоит от вершины камня ровно
  // на ширину полосы, поэтому радиус камня считается вычитанием.
  const inK = 0.955;
  const r = (outer - band) / inK;
  const rimIn = squash(ngon(cx, cy, r * inK, sides, rotation), cx, cy, squashX, squashY);
  const rimOut = offsetRound(rimIn, cx, cy, band);
  const line = squash(ngon(cx, cy, r * 0.985, sides, rotation), cx, cy, squashX, squashY);

  const metal = goldMetal(`${pre}mg`, { height: Math.max(2.8, band * 0.21), depth: 17 });
  const glass = glassGem(`${pre}gg`, gem, {
    dome: 6,
    depth: 34,
    refraction: 4.5,
    innerGlow: 0.15,
    edge: 3,
    caustic: 0.15,
    specular: 1.75,
    shininess: 110,
    modeling: 0.9,
    saturate: 1.34,
    seed
  });
  const sk = shell(pre, {
    contourColor: mix(gem.darkest, "#1A0730", 0.45),
    contourWidth: 3.0,
    glow: gem.glow,
    glowSize: 13,
    glowOpacity: 0.30
  });

  // Орнаменты на углах оправы: внешняя нормаль вершины совпадает с
  // направлением от центра, поэтому лепесток «садится» на угол сам.
  const corners = squash(ngon(cx, cy, r, sides, rotation), cx, cy, squashX, squashY);
  const pick = ornaments || corners.map((_, i) => i);
  const ornS = band * 0.62 * ornScale;
  const orn = pick.map((i) => {
    const p = corners[i];
    const a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
    // Орнамент садится на угол КАМНЯ и уходит наружу в тело оправы —
    // там для него есть металл. Посаженный на внешнюю кромку, он торчит
    // за силуэт, и на 90 px камень перестаёт читаться многоугольником.
    const at = { x: cx + (p.x - cx) * 1.02, y: cy + (p.y - cy) * 1.02 };
    return fleurAt(at.x, at.y, a, ornS);
  }).join("");

  // «Огонь» камня: пунктир по стыку граней с освещённой стороны.
  // В эталонах это единственная мелкая деталь внутри камня, и именно она
  // не даёт огранке выглядеть плоской развёрткой.
  const gir = squash(ngon(cx, cy, r * girdle, sides, rotation), cx, cy, squashX, squashY);
  let fire = "";
  for (let i = 0; i < sides; i++) {
    const a = gir[i], b = gir[(i + 1) % sides];
    const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy;
    const l = Math.hypot(mx, my) || 1;
    if ((mx / l) * LIGHT.x + (my / l) * LIGHT.y > 0.35) {
      // Пунктир держится ЕДВА ЗАМЕТНЫМ. При opacity 0.75 он читался
      // строчкой шва поперёк камня — деталь, которая должна намекать на
      // блеск огранки, начинала спорить с самой огранкой.
      fire += `<line x1="${f2(a.x)}" y1="${f2(a.y)}" x2="${f2(b.x)}" y2="${f2(b.y)}"
        stroke="${gem.lightest}" stroke-width="${f2(r * 0.018)}" stroke-linecap="round"
        stroke-dasharray="${f2(r * 0.04)} ${f2(r * 0.07)}" opacity="0.32"/>`;
    }
  }

  // Искра — на светлой вершине рундиста, а не в центре камня: в центре
  // она садится на площадку и читается наклеенной звёздочкой.
  const spx = cx + LIGHT.x * r * 0.80 * squashX;
  const spy = cy + LIGHT.y * r * 0.80 * squashY;

  const defs = `
    ${sk.defs}
    ${defsOf(metal, glass)}
    ${goldEnv(`${pre}eg`)}
  `;

  const body = `
    ${sk.open}
      <g filter="${metal.ref}">
        <path d="${ringPath(rimOut, rimIn)}" fill-rule="evenodd" fill="url(#${pre}eg)"/>
        <g fill="url(#${pre}eg)">${orn}</g>
      </g>
      <g filter="${glass.ref}">
        ${cutGem(gem, { cx, cy, radius: r, sides, rotation, squashX, squashY, table, girdle, contrast, deepen })}
        ${fire}
      </g>
      <path d="${poly(squash(ngon(cx, cy, r * inK * 1.012, sides, rotation), cx, cy, squashX, squashY))}"
            fill="none" stroke="#FFE9A8" stroke-width="${f2(band * 0.16)}" opacity="0.65"
            stroke-linejoin="round"/>
      <path d="${poly(line)}" fill="none" stroke="${mix(gem.darkest, "#1A0500", 0.5)}"
            stroke-width="${f2(band * 0.19)}" opacity="0.92" stroke-linejoin="round"/>
    ${sk.close}
    ${sparkle(spx, spy, r * 0.13, 0.85)}
  `;
  return { defs, body };
}

/* ═══════════════════════ МЕДАЛЬОН ДОРОГИХ ════════════════════════ */

/**
 * Диск с золотым ободом — общая «подложка» пяти дорогих символов.
 *
 * Зачем: пять разных предметов без общей формы читаются как пять разных
 * игр. Одинаковый диск склеивает их в один номинал, а цвет диска работает
 * быстрой меткой. Ровно этим приёмом собраны дорогие символы Gates of Olympus.
 */
function medallion(pre, tone, opts = {}) {
  const { rimR = 112, rimW = 15, rays = 30 } = opts;
  const inR = rimR - rimW;

  const metal = goldMetal(`${pre}mr`, { height: rimW * 0.22, depth: 18 });
  const gr = grain(`${pre}gr`, 0.055, { freq: 0.9, seed: 21 });

  // Лучи от центра: слабая радиальная фактура. Без неё диск — плоская
  // заливка, и весь объём символа держится на одном ободе.
  let rayStr = "";
  for (let i = 0; i < rays; i++) {
    const a0 = (360 / rays) * i;
    const p1 = polar(C, C, inR * 1.02, a0 - 360 / rays / 3.4);
    const p2 = polar(C, C, inR * 1.02, a0 + 360 / rays / 3.4);
    // Лучи держатся на пороге видимости: на 0.10 они читались спицами
    // колеса и спорили с предметом, который лежит поверх.
    rayStr += `<path d="M ${C} ${C} L ${f2(p1.x)} ${f2(p1.y)} L ${f2(p2.x)} ${f2(p2.y)} Z"
      fill="${tone.glow}" opacity="0.03"/>`;
  }

  const defs = `
    ${defsOf(metal, gr)}
    ${goldEnv(`${pre}eg`)}
    ${radial(`${pre}disc`, tone.mid, tone.deep, "36%", "31%", "72%")}
    ${linear(`${pre}vig`, [["55%", "#000000", 0], ["100%", "#000000", 0.55]], 90)}
    <radialGradient id="${pre}vg" cx="50%" cy="50%" r="50%">
      <stop offset="58%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="${tone.deep}" stop-opacity="0.85"/>
    </radialGradient>
    <clipPath id="${pre}clip"><circle cx="${C}" cy="${C}" r="${f2(inR + 2)}"/></clipPath>
  `;

  const back = `
    <g filter="${gr.ref}">
      <circle cx="${C}" cy="${C}" r="${f2(inR + 2)}" fill="url(#${pre}disc)"/>
      <g clip-path="url(#${pre}clip)">${rayStr}</g>
      <circle cx="${C}" cy="${C}" r="${f2(inR + 2)}" fill="url(#${pre}vg)"/>
    </g>`;

  const rim = `
    <g filter="${metal.ref}">
      <circle cx="${C}" cy="${C}" r="${f2(rimR - rimW / 2)}" fill="none"
              stroke="url(#${pre}eg)" stroke-width="${f2(rimW)}"/>
    </g>
    <circle cx="${C}" cy="${C}" r="${f2(inR + 1)}" fill="none" stroke="#2A1000"
            stroke-width="2.4" opacity="0.75"/>`;

  return { defs, back, rim, inR, rimR };
}

/* ═════════════════════ ТАБЛИЧКА С НАДПИСЬЮ ═══════════════════════ */

/**
 * Подпись wild и scatter — не наклейка и не лента поверх символа.
 *
 * Конструкция ровно та, что у эталонов: в золотой оправе ВЫБРАНО
 * углубление, оно залито тёмной эмалью, а буквы отлиты из того же
 * золота и подняты над эмалью. Три признака, каждый обязателен:
 *
 *   • углубление имеет внутреннюю тень сверху — иначе эмаль
 *     читается краской, а не выемкой;
 *   • буквы получают фаску по ЕДИНОМУ свету, поэтому лежат в одной
 *     световой схеме с оправой;
 *   • буквы получают тёмный контур — на золоте по золоту без него
 *     не читается ни одна надпись.
 *
 * Почему не гравировка в чистом виде: канавка глубиной в пиксель на
 * 90 px не видна вообще, а надпись обязана читаться в мобильном
 * портрете. Утопленная эмаль с поднятыми буквами даёт и «часть
 * оправы», и контраст.
 */
function nameplate(pre) {
  const carve = engrave(`${pre}nc`, { height: 2.6, depth: 26, specular: 0.35 });
  const letters = bevel(`${pre}nl`, {
    height: 2.0, depth: 26, plateau: 0.42, modeling: 0.35,
    specular: 1.5, shininess: 40, specColor: "#FFF8DC", margin: 30
  });
  const lct = contour(`${pre}nx`, "#2A1000", 2.2, { softness: 0.4 });
  return {
    defs: `${defsOf(carve, letters, lct)}
      ${goldLetters(`${pre}gt`)}
      ${linearV(`${pre}en2`, [["0%", "#180703"], ["45%", "#33130A"], ["100%", "#200D08"]])}`,
    /** Заливка букв. */
    fill: `url(#${pre}gt)`,
    /** Выемка под эмаль: фигура + фильтр «вдавленности». */
    recess: (shape) => `<g filter="${carve.ref}">${shape.replace("__F__", `url(#${pre}en2)`)}</g>`,
    /** Буквы: контур снаружи, фаска внутри. */
    text: (t) => `<g filter="${lct.ref}"><g filter="${letters.ref}">${t}</g></g>`
  };
}

/** Мягкая тень предмета НА диске — предмет обязан лежать, а не парить. */
function castShadow(pre, body, { dx = 5, dy = 6, opacity = 0.42 } = {}) {
  return `<g transform="translate(${dx} ${dy})" filter="url(#${pre}cs)"
             opacity="${opacity}" fill="#000" stroke="none">${body}</g>`;
}

/** Сборка дорогого символа: диск, тень предмета, предмет, обод. */
function premium(pre, tone, object, opts = {}) {
  const { overflow = false, contourColor = "#1B0730", medal = {} } = opts;
  const m = medallion(pre, tone, medal);
  const sk = shell(pre, { contourColor, contourWidth: 3.2, shadow: 0.64 });
  const csBlur = blurFilter(`${pre}cs`, 5);

  const inner = overflow
    ? `${m.back}${m.rim}${object.shadow || ""}${object.body}`
    : `${m.back}${object.shadow || ""}${object.body}${m.rim}`;

  return {
    defs: `${sk.defs}${m.defs}${csBlur}${object.defs || ""}`,
    body: `${sk.open}${inner}${sk.close}${object.over || ""}`
  };
}

/* ═════════════════════════ ДОРОГИЕ СИМВОЛЫ ═══════════════════════ */

/* ────────────────────────────── ЯКОРЬ ──────────────────────────── */

function anchor() {
  const pre = "a";
  const tone = { mid: "#1C7FA6", deep: "#052436", glow: S.seaLight };

  const shape = `
    <circle cx="128" cy="62" r="16" fill="none" stroke="url(#${pre}eg)" stroke-width="11"/>
    <rect x="120" y="66" width="16" height="122" rx="7" fill="url(#${pre}eg)"/>
    <rect x="82" y="92" width="92" height="13" rx="6.5" fill="url(#${pre}eg)"/>
    <circle cx="82" cy="98.5" r="8.5" fill="url(#${pre}eg)"/>
    <circle cx="174" cy="98.5" r="8.5" fill="url(#${pre}eg)"/>
    <path d="M 128 194 C 96 194 70 172 63 140 L 82 133
             C 87 158 104 174 128 174 C 152 174 169 158 174 133 L 193 140
             C 186 172 160 194 128 194 Z" fill="url(#${pre}eg)"/>
    <path d="M 55 122 L 84 145 L 52 152 Z" fill="url(#${pre}eg)"/>
    <path d="M 201 122 L 172 145 L 204 152 Z" fill="url(#${pre}eg)"/>`;

  const metal = goldMetal(`${pre}ma`, { height: 3.6, depth: 24, tile: 120 });
  const ct = contour(`${pre}oc`, "#3A1C02", 2.4, { softness: 0.5 });

  // Волна по низу медальона: якорь обязан быть в воде, иначе это просто
  // золотая железка на цветном круге.
  const rope = `
    <g clip-path="url(#${pre}clip)">
      <path d="M 20 178 q 26 -14 52 0 t 52 0 t 52 0 t 52 0 v 90 H 20 Z"
            fill="${S.seaMid}" opacity="0.55"/>
      <path d="M 20 196 q 26 -14 52 0 t 52 0 t 52 0 t 52 0 v 70 H 20 Z"
            fill="${S.seaDeep}" opacity="0.55"/>
      <path d="M 20 178 q 26 -14 52 0 t 52 0 t 52 0 t 52 0" fill="none"
            stroke="${S.seaLight}" stroke-width="3" opacity="0.55"/>
    </g>`;

  const object = {
    defs: defsOf(metal, ct),
    shadow: castShadow(pre, shape.replace(/fill="[^"]*"/g, "").replace(/stroke="[^"]*"/g, "")),
    body: `${rope}<g filter="${ct.ref}"><g filter="${metal.ref}">${shape}</g></g>`,
    over: sparkle(178, 74, 15, 0.85)
  };
  return premium(pre, tone, object, { contourColor: "#03202F" });
}

/* ──────────────────────────── МОРОЖЕНОЕ ────────────────────────── */

function iceCream() {
  const pre = "b";
  const tone = { mid: "#C43C74", deep: "#3E0A29", glow: "#FF9CC4" };

  const cone = `M 96 148 L 160 148 L 128 220 Z`;

  const bv = bevel(`${pre}bv`, { height: 6, depth: 30, plateau: 0.5, specular: 1.15, shininess: 26 });
  const bvC = bevel(`${pre}bc`, { height: 4.5, depth: 26, plateau: 0.55, specular: 0.7, shininess: 28 });
  const ct = contour(`${pre}oc`, "#4A1030", 2.6, { softness: 0.5 });

  // Вафля: сетка. Рисуется ПОД фаской, чтобы фаска её осветила.
  let waffle = "";
  for (let i = -6; i <= 6; i++) {
    waffle += `<line x1="${96 + i * 11}" y1="148" x2="${128 + i * 5}" y2="220"
      stroke="#8A5218" stroke-width="2.2" opacity="0.55"/>`;
    waffle += `<line x1="${96 - i * 3}" y1="${162 + i * 9}" x2="${160 + i * 3}" y2="${162 + i * 9}"
      stroke="#8A5218" stroke-width="2.2" opacity="0.45"/>`;
  }

  const defs = `
    ${defsOf(bv, bvC, ct)}
    ${linearV(`${pre}wf`, [["0%", "#F4C173"], ["55%", "#D3922F"], ["100%", "#8A5218"]])}
    ${radial(`${pre}s1`, "#FFC2D4", "#E2588A", "36%", "30%", "70%")}
    ${radial(`${pre}s2`, "#FFF6DC", "#EFC98A", "36%", "30%", "70%")}
    ${radial(`${pre}s3`, "#CFF3B4", "#78C161", "36%", "30%", "70%")}
    ${radial(`${pre}ch`, "#FF7A82", "#B00C22", "34%", "28%", "70%")}
    <clipPath id="${pre}cc"><path d="${cone}"/></clipPath>
  `;

  const body = `
    <g filter="${ct.ref}">
      <g filter="${bvC.ref}">
        <g clip-path="url(#${pre}cc)">
          <path d="${cone}" fill="url(#${pre}wf)"/>
          ${waffle}
        </g>
      </g>
      <g filter="${bv.ref}">
        <circle cx="152" cy="132" r="30" fill="url(#${pre}s3)"/>
        <circle cx="106" cy="130" r="32" fill="url(#${pre}s1)"/>
        <circle cx="129" cy="98" r="31" fill="url(#${pre}s2)"/>
      </g>
      <g filter="${bv.ref}">
        <circle cx="140" cy="62" r="13" fill="url(#${pre}ch)"/>
      </g>
      <path d="M 140 50 C 142 36 152 30 164 32" fill="none" stroke="#5E3703"
            stroke-width="5" stroke-linecap="round"/>
    </g>`;

  const object = {
    defs,
    shadow: castShadow(pre, `<path d="${cone}"/>
      <circle cx="106" cy="130" r="32"/><circle cx="152" cy="132" r="30"/>
      <circle cx="129" cy="98" r="31"/>`),
    body,
    over: sparkle(96, 76, 13, 0.8)
  };
  return premium(pre, tone, object, { contourColor: "#2A0620" });
}

/* ───────────────────────────── ШАШЛЫК ──────────────────────────── */

function shashlik() {
  const pre = "c";
  const tone = { mid: "#3E8C4E", deep: "#092A17", glow: "#96E6A6" };

  // Мясо получает СВОЙ свет: фаска мягкая (низкая острота блика), зато
  // глубокая. Общий bevel с высокой остротой давал пластиковую подушку —
  // ровно то, из-за чего первые куски читались зефиром, а не шашлыком.
  const bvM = bevel(`${pre}bm`, { height: 4.5, depth: 32, plateau: 0.34,
    // diffuse ниже нейтрального: жареное мясо ТЁМНОЕ. С нейтральным
    // светом фаска вытягивала его в бежевую луковицу.
    diffuse: 1.02, modeling: 0.9, specular: 0.5, shininess: 30 });
  const bvV = bevel(`${pre}bv`, { height: 4, depth: 30, plateau: 0.4, specular: 1.5, shininess: 34 });
  const metal = goldMetal(`${pre}ms`, { height: 2.0, depth: 18, tile: 120 });
  const ct = contour(`${pre}oc`, "#2E1006", 2.8, { softness: 0.5 });

  // Шампур и куски выкладываются по горизонтали и разом поворачиваются:
  // считать координаты вдоль наклонной оси вручную — верный способ
  // получить разъезжающиеся интервалы.
  const rot = -34;

  // РАЗМЕР КУСКА. Первая версия делала их во всю высоту шампура, и
  // шампур пропадал между ними: оставались четыре коричневых окатыша на
  // зелёном круге — «жёлуди», а не «мясо на шампуре». Нанизанность
  // читается ровно тогда, когда между кусками ВИДЕН стержень.
  const meat = (x) => `
    <path d="M ${x - 23} 108 C ${x - 23} 96 ${x - 8} 92 ${x + 1} 96
             C ${x + 12} 92 ${x + 24} 98 ${x + 23} 111
             C ${x + 25} 128 ${x + 21} 145 ${x + 10} 152
             C ${x} 157 ${x - 15} 153 ${x - 21} 142
             C ${x - 26} 131 ${x - 25} 118 ${x - 23} 108 Z"
          fill="url(#${pre}mt)"/>
    <g stroke="#2A0D02" stroke-linecap="round" opacity="0.5" fill="none">
      <path d="M ${x - 16} 114 q 16 -7 32 1" stroke-width="5"/>
      <path d="M ${x - 17} 132 q 17 -7 34 1" stroke-width="5"/>
    </g>
    <ellipse cx="${x - 6}" cy="106" rx="9" ry="5" fill="#FFD9A0" opacity="0.26"
             transform="rotate(-22 ${x - 6} 106)"/>`;

  const tomato = (x) => `
    <circle cx="${x}" cy="128" r="24" fill="url(#${pre}tm)"/>
    <ellipse cx="${x - 8}" cy="119" rx="7" ry="4.5" fill="#FFFFFF" opacity="0.4"
             transform="rotate(-28 ${x - 8} 119)"/>`;

  const pepper = (x) => `
    <path d="M ${x - 20} 116 C ${x - 18} 102 ${x + 18} 102 ${x + 20} 116
             C ${x + 22} 134 ${x + 15} 150 ${x} 150
             C ${x - 15} 150 ${x - 22} 134 ${x - 20} 116 Z" fill="url(#${pre}pp)"/>
    <ellipse cx="${x - 7}" cy="113" rx="6.5" ry="4" fill="#FFFFFF" opacity="0.28"
             transform="rotate(-25 ${x - 7} 113)"/>`;

  const items = [
    { x: 52, f: meat }, { x: 104, f: tomato }, { x: 152, f: meat }, { x: 202, f: pepper }
  ];

  // Шампур виден с обоих концов и заканчивается кольцом-ручкой: без
  // концов предмет читается «мясо на палке из ниоткуда».
  const skewer = `
    <rect x="18" y="123" width="220" height="10" rx="5" fill="url(#${pre}eg2)"/>
    <circle cx="20" cy="128" r="11" fill="none" stroke="url(#${pre}eg2)" stroke-width="7"/>
    <path d="M 238 128 l 16 0" stroke="url(#${pre}eg2)" stroke-width="9" stroke-linecap="round"/>`;

  const defs = `
    ${defsOf(bvM, bvV, metal, ct)}
    ${goldEnv(`${pre}eg2`)}
    ${radial(`${pre}mt`, "#B96A28", "#3D1404", "32%", "24%", "84%")}
    ${radial(`${pre}tm`, "#FF6247", "#8E0A12", "32%", "24%", "80%")}
    ${radial(`${pre}pp`, "#9BE267", "#215E1E", "32%", "24%", "80%")}
  `;

  // Каждый кусок — своя группа, но порядок ВДОЛЬ ШАМПУРА сохраняется.
  // Сгруппировав сначала всё мясо, а потом все овощи, легко получить
  // помидор поверх дальнего куска: нанизанное перестаёт читаться
  // нанизанным.
  const inner = `
    <g filter="${metal.ref}">${skewer}</g>
    ${items.map((it) => `<g filter="${it.f === meat ? bvM.ref : bvV.ref}">${it.f(it.x)}</g>`).join("")}`;

  const object = {
    defs,
    shadow: castShadow(pre, `<g transform="rotate(${rot} 128 128)">
       <rect x="18" y="122" width="222" height="11" rx="5"/>
       ${items.map((it) => `<rect x="${it.x - 24}" y="98" width="48" height="58" rx="18"/>`).join("")}
     </g>`),
    body: `<g filter="${ct.ref}"><g transform="rotate(${rot} 128 128)">${inner}</g></g>`,
    over: sparkle(190, 72, 13, 0.8)
  };
  return premium(pre, tone, object, { contourColor: "#05200F" });
}

/* ────────────────────────────── ШЛЯПА ──────────────────────────── */

function sunHat() {
  const pre = "d";
  const tone = { mid: "#17A8BE", deep: "#04333F", glow: S.seaLight };

  const brim = `M 128 108 C 196 108 218 142 218 158 C 218 178 176 192 128 192
                C 80 192 38 178 38 158 C 38 142 60 108 128 108 Z`;
  const crown = `M 74 152 C 74 96 96 66 128 66 C 160 66 182 96 182 152
                 C 168 160 148 164 128 164 C 108 164 88 160 74 152 Z`;

  // Солома почти не зеркалит. Первая версия ставила блик как на пластике,
  // и шляпа выцветала в белое пятно: на диске оставался силуэт-гриб без
  // разделения тульи и полей.
  const bv = bevel(`${pre}bv`, { height: 6.5, depth: 30, plateau: 0.48, specular: 0.3, shininess: 26 });
  const bvR = bevel(`${pre}br`, { height: 4, depth: 28, plateau: 0.5, specular: 1.1, shininess: 24 });
  const ct = contour(`${pre}oc`, "#4A2E06", 2.8, { softness: 0.5 });
  const under = blurFilter(`${pre}ub`, 7);

  // Соломка: волокно обязано идти ПО форме, иначе шляпа читается как
  // крашеный пластик.
  let straw = "";
  for (let i = 1; i <= 5; i++) {
    const k = i / 6;
    straw += `<path d="M ${f2(74 + k * 8)} ${f2(152 - k * 4)} C ${f2(90 + k * 6)} ${f2(100 - k * 26)}
      ${f2(166 - k * 6)} ${f2(100 - k * 26)} ${f2(182 - k * 8)} ${f2(152 - k * 4)}"
      fill="none" stroke="#A87A24" stroke-width="2.2" opacity="0.4"/>`;
  }
  for (let i = 1; i <= 3; i++) {
    const k = i / 4;
    straw += `<path d="M ${f2(38 + k * 26)} ${f2(158 + k * 4)} C ${f2(60 + k * 20)} ${f2(190 - k * 12)}
      ${f2(196 - k * 20)} ${f2(190 - k * 12)} ${f2(218 - k * 26)} ${f2(158 + k * 4)}"
      fill="none" stroke="#A87A24" stroke-width="2.2" opacity="0.34"/>`;
  }

  // Лента шире и с узлом: она единственный тёплый акцент на шляпе и
  // единственное, что отделяет тулью от полей по ЦВЕТУ, а не по тону.
  const ribbon = `
    <path d="M 72 144 C 92 158 164 158 184 144 L 187 166 C 164 180 92 180 69 166 Z"
          fill="url(#${pre}rb)"/>
    <path d="M 180 150 l 30 -14 l 6 26 l -32 6 Z" fill="url(#${pre}rb)"/>
    <path d="M 176 148 l 8 22 l -14 -2 Z" fill="#7C0C26"/>`;

  const defs = `
    ${defsOf(bv, bvR, ct, under)}
    ${linearV(`${pre}st`, [["0%", "#F7DC9E"], ["42%", "#DDB25A"], ["100%", "#8E6416"]])}
    ${linearV(`${pre}sb`, [["0%", "#C99B45"], ["55%", "#A97F2C"], ["100%", "#70490D"]])}
    ${linearV(`${pre}rb`, [["0%", "#F26A8C"], ["55%", "#C82B52"], ["100%", "#7C0C26"]])}
    ${goldEnv(`${pre}eg3`)}
    <clipPath id="${pre}hc"><path d="${brim}"/><path d="${crown}"/></clipPath>
  `;

  const body = `
    <g filter="${ct.ref}">
      <g filter="${bv.ref}">
        <!-- поля темнее тульи: свет падает сверху, поля стоят к нему
             ребром и обязаны быть глуше, иначе шляпа плоская -->
        <path d="${brim}" fill="url(#${pre}sb)"/>
        <path d="${crown}" fill="url(#${pre}st)"/>
      </g>
      <g clip-path="url(#${pre}hc)" opacity="0.85">${straw}</g>
      <!-- тень тульи на полях: без неё тулья приклеена, а не надета -->
      <g clip-path="url(#${pre}hc)">
        <path d="${crown}" fill="#3A2405" opacity="0.32" filter="url(#${pre}ub)"
              transform="translate(6 12)"/>
      </g>
      <g filter="${bvR.ref}">${ribbon}</g>
      <!-- пряжка: единственная золотая деталь, она связывает шляпу с
           общим металлом набора -->
      <g filter="${bvR.ref}">
        <rect x="106" y="148" width="30" height="22" rx="5" fill="none"
              stroke="url(#${pre}eg3)" stroke-width="6"/>
      </g>
    </g>`;

  const object = {
    defs,
    shadow: castShadow(pre, `<path d="${brim}"/><path d="${crown}"/>`),
    body,
    over: sparkle(92, 82, 13, 0.8)
  };
  return premium(pre, tone, object, { contourColor: "#02222C" });
}

/* ─────────────────────────────── ВИНО ──────────────────────────── */

function wineGlass() {
  const pre = "e";
  const tone = { mid: "#7A2CB0", deep: "#25073F", glow: "#C88CFF" };

  const bowl = `M 76 58 L 180 58 C 180 122 156 152 128 156 C 100 152 76 122 76 58 Z`;
  const drink = `M 82 84 L 174 84 C 172 120 152 146 128 150 C 104 146 84 120 82 84 Z`;
  const stem = `M 121 154 h 14 v 46 h -14 Z`;
  const foot = `M 84 210 C 84 200 104 196 128 196 C 152 196 172 200 172 210
                C 172 218 152 222 128 222 C 104 222 84 218 84 210 Z`;

  const bvG = bevel(`${pre}bg`, { height: 4, depth: 26, plateau: 0.6, specular: 1.6, shininess: 60 });
  const glass = glassGem(`${pre}wl`, GEMS.ruby, {
    dome: 5, depth: 26, refraction: 3, edge: 2.5, caustic: 0.10,
    innerGlow: 0.18, specular: 1.4, shininess: 100, modeling: 0.8, saturate: 1.3, seed: 41
  });
  const ct = contour(`${pre}oc`, "#3A0A52", 2.6, { softness: 0.5 });

  const defs = `
    ${defsOf(bvG, glass, ct)}
    ${linearV(`${pre}gl`, [["0%", "#EAF6FF", 0.85], ["40%", "#BFD9EC", 0.55], ["100%", "#8FB4CE", 0.75]])}
    ${radial(`${pre}gp`, "#C46BE0", "#4A0F6B", "34%", "26%", "70%")}
  `;

  // Гроздь у подножки: символ должен читаться как «вино», а не «бокал».
  const grapePts = [[82, 178, 13], [104, 172, 13], [92, 196, 13], [114, 192, 12], [72, 196, 12], [100, 208, 11]];
  const grapes = grapePts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${pre}gp)"/>`).join("");
  const grapeMask = grapePts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");

  const body = `
    <g filter="${ct.ref}">
      <g filter="${bvG.ref}">${grapes}</g>
      <path d="M 108 168 C 92 148 108 132 126 136 C 116 146 114 158 108 168 Z" fill="#2E7A46"/>
      <g filter="${bvG.ref}">
        <path d="${foot}" fill="url(#${pre}gl)"/>
        <path d="${stem}" fill="url(#${pre}gl)"/>
        <path d="${bowl}" fill="url(#${pre}gl)"/>
      </g>
      <g filter="${glass.ref}"><path d="${drink}" fill="${GEMS.ruby.base}"/></g>
      <path d="M 90 66 C 90 108 100 132 116 146" fill="none" stroke="#FFFFFF"
            stroke-width="7" opacity="0.4" stroke-linecap="round"/>
      <path d="M 76 58 L 180 58" stroke="#EAF6FF" stroke-width="5" opacity="0.75"
            stroke-linecap="round"/>
    </g>`;

  const object = {
    defs,
    shadow: castShadow(pre, `<path d="${bowl}"/><path d="${foot}"/>${grapeMask}`),
    body,
    over: sparkle(166, 74, 14, 0.85)
  };
  return premium(pre, tone, object, { contourColor: "#1A0430" });
}

/* ═══════════════════════════ WILD ════════════════════════════════ */

/**
 * Дикий символ обязан быть заметно богаче остальных, поэтому: барочный
 * картуш с волютами по углам, закат внутри, четыре камня-вставки на раме
 * и надпись, ВЫРЕЗАННАЯ в золоте, а не наклеенная лентой. Плюс золотой
 * ореол — на барабане wild должен «звенеть».
 */
function wild() {
  const pre = "w";
  const R = 111;

  const plate = squash(ngon(C, C, R, 8, -90 + 22.5), C, C, 1.0, 0.96);
  const inner = squash(ngon(C, C, R - 21, 8, -90 + 22.5), C, C, 1.0, 0.96);
  const lip = squash(ngon(C, C, R - 19, 8, -90 + 22.5), C, C, 1.0, 0.96);

  const metal = goldMetal(`${pre}mg`, { height: 4.8, depth: 25, tile: 110 });
  const np = nameplate(pre);
  const sk = shell(pre, {
    contourColor: "#3A1C02", contourWidth: 3.2, shadow: 0.66,
    glow: P.gold, glowSize: 17, glowOpacity: 0.46
  });

  // Волюты по четырём диагоналям — то, чего не хватало символам, чтобы
  // оправа перестала быть «золотым прямоугольником».
  const scrolls = [45, 135, 225, 315].map((a) => {
    const p = polar(C, C, R * 0.99, a);
    return `<g transform="translate(${f2(p.x)} ${f2(p.y)}) rotate(${f2(a + 90)})">
      <path d="${volute(-7, 2, { r0: 9.5, r1: 2, w0: 5.4, w1: 1.2, turns: 1.05, start: -95, dir: 1 })}"/>
      <path d="${volute(7, 2, { r0: 9.5, r1: 2, w0: 5.4, w1: 1.2, turns: 1.05, start: -85, dir: -1 })}"/>
      <circle cx="0" cy="10" r="4.4"/>
    </g>`;
  }).join("");

  const studs = [0, 180, 270].map((a, i) => {
    const p = polar(C, C, R - 8, a);
    const g = [GEMS.aqua, GEMS.emerald, GEMS.ruby][i];
    return `<g><circle cx="${f2(p.x)}" cy="${f2(p.y)}" r="7.5" fill="${g.darkest}"/>
      <circle cx="${f2(p.x)}" cy="${f2(p.y)}" r="5.6" fill="${g.base}"/>
      <circle cx="${f2(p.x - 1.8)}" cy="${f2(p.y - 1.8)}" r="2.1" fill="${g.lightest}" opacity="0.9"/></g>`;
  }).join("");

  const defs = `
    ${sk.defs}
    ${defsOf(metal)}
    ${np.defs}
    ${goldEnv(`${pre}eg`)}
    ${linearV(`${pre}sky`, [["0%", "#241457"], ["30%", "#6E2779"], ["56%", "#D9497A"], ["78%", "#FF8A4C"], ["100%", "#FFC96E"]])}
    ${radial(`${pre}sun`, "#FFFCE4", "#FFAE43", "50%", "50%", "50%")}
    ${linearV(`${pre}sea`, [["0%", "#2196A8"], ["100%", "#04324A"]])}
    <clipPath id="${pre}ic"><path d="${poly(inner)}"/></clipPath>
  `;

  // Композиция внутри картуша: солнце в верхней трети, море в нижней,
  // табличка ложится на границу. Если табличку поставить по центру,
  // она закрывает солнце — а солнце и есть тема игры.
  const scene = `
    <g clip-path="url(#${pre}ic)">
      <rect x="10" y="10" width="236" height="236" fill="url(#${pre}sky)"/>
      <circle cx="128" cy="96" r="46" fill="url(#${pre}sun)" opacity="0.30"/>
      <circle cx="128" cy="96" r="31" fill="url(#${pre}sun)"/>
      <rect x="10" y="126" width="236" height="120" fill="url(#${pre}sea)"/>
      <path d="M 10 126 h 236" stroke="#FFE2B0" stroke-width="3" opacity="0.85"/>
      <path d="M 118 126 l -14 120 h 52 l -14 -120 Z" fill="#FFE0A0" opacity="0.32"/>
      <g stroke="#FFF0D0" stroke-width="3.4" opacity="0.34" stroke-linecap="round">
        <path d="M 36 142 h 40"/><path d="M 176 148 h 40"/>
      </g>
    </g>`;

  const band = `<rect x="30" y="160" width="196" height="50" rx="12" fill="__F__"/>`;

  const body = `
    ${sk.open}
      <g filter="${metal.ref}">
        <path d="${poly(plate)}" fill="url(#${pre}eg)"/>
        <g fill="url(#${pre}eg)">${scrolls}</g>
      </g>
      ${scene}
      <path d="${poly(lip)}" fill="none" stroke="#2A1000" stroke-width="3" opacity="0.85"
            stroke-linejoin="round"/>
      <g filter="${metal.ref}">
        <rect x="22" y="153" width="212" height="64" rx="17" fill="url(#${pre}eg)"/>
      </g>
      ${np.recess(band)}
      ${np.text(`<text x="128" y="186" font-family="'Arial Black','Segoe UI Black',Impact,sans-serif"
              font-weight="900" font-size="38" letter-spacing="2" text-anchor="middle"
              dominant-baseline="central" fill="${np.fill}">WILD</text>`)}
      ${studs}
    ${sk.close}
    ${sparkle(210, 52, 18, 0.95)}
    ${sparkle(44, 84, 12, 0.7)}
  `;
  return { defs, body };
}

/* ══════════════════════════ SCATTER ══════════════════════════════ */

/**
 * Скаттер: закат над морем в круглой барочной раме.
 *
 * Подпись НЕ лента поверх символа, а гравировка по нижней дуге самой
 * рамы — она принадлежит предмету, освещена тем же светом и не читается
 * наклейкой. Ради этого нижняя часть обода сделана шире.
 */
function scatter() {
  const pre = "s";
  const R = 112;
  const rimW = 16;
  const inR = R - rimW;

  const metal = goldMetal(`${pre}mg`, { height: 4.8, depth: 26, tile: 110 });
  const np = nameplate(pre);
  const sk = shell(pre, {
    contourColor: "#3A1C02", contourWidth: 3.2, shadow: 0.66,
    glow: S.sun, glowSize: 18, glowOpacity: 0.5
  });

  // Полярная точка в разметке пути.
  const pp = (deg, rad) => {
    const p = polar(C, C, rad, deg);
    return `${f2(p.x)} ${f2(p.y)}`;
  };

  /**
   * Кольцевой сектор — им сделана табличка по нижней дуге рамы.
   * Углы в экранной системе: Y вниз, поэтому 90° — низ кадра, а рост
   * угла — движение по часовой стрелке (флаг sweep = 1).
   */
  const sector = (a0, a1, rIn, rOut) =>
    `M ${pp(a0, rOut)} A ${rOut} ${rOut} 0 0 1 ${pp(a1, rOut)} ` +
    `L ${pp(a1, rIn)} A ${rIn} ${rIn} 0 0 0 ${pp(a0, rIn)} Z`;

  // Лучи солнца ЗА рамой — скаттер обязан бросаться в глаза первым.
  //
  // Лучи РАЗМЫВАЮТСЯ. Резкий треугольник на тёмном фоне читается зубцом
  // шестерни, а не светом: у света нет кромки. Размытие превращает те же
  // двенадцать клиньев в сияние вокруг рамы.
  const rayBlur = blurFilter(`${pre}rb`, 5);
  let burst = "";
  for (let i = 0; i < 12; i++) {
    const a = (360 / 12) * i + 15;
    burst += `<path d="M ${pp(a - 6, R * 0.82)} L ${pp(a, R * 1.17)} L ${pp(a + 6, R * 0.82)} Z"
      fill="${S.sun}" opacity="0.34"/>`;
  }

  // Волюты по бокам и сверху; снизу их нет — там лежит табличка.
  const scrolls = [-90, -145, -35].map((a) => {
    const p = polar(C, C, R - 4, a);
    return `<g transform="translate(${f2(p.x)} ${f2(p.y)}) rotate(${f2(a + 90)})">
      <path d="${volute(-8, 1, { r0: 10, r1: 2, w0: 5.6, w1: 1.2, turns: 1.05, start: -95, dir: 1 })}"/>
      <path d="${volute(8, 1, { r0: 10, r1: 2, w0: 5.6, w1: 1.2, turns: 1.05, start: -85, dir: -1 })}"/>
      <circle cx="0" cy="9" r="4.6"/>
    </g>`;
  }).join("");

  // Дуга под надпись. Направление обхода обязано быть СЛЕВА НАПРАВО по
  // низу: иначе буквы уходят на верхнюю дугу и встают вверх ногами.
  // Слева — угол 158°, справа — 22°, значит угол УБЫВАЕТ, значит
  // sweep = 0. Первая версия стояла с флагом наоборот, и надписи на
  // символе просто не было — она рисовалась за рамой сверху.
  const textR = 103;
  const arc = `M ${pp(158, textR)} A ${textR} ${textR} 0 0 0 ${pp(22, textR)}`;

  const defs = `
    ${sk.defs}
    ${defsOf(metal, rayBlur)}
    ${np.defs}
    ${goldEnv(`${pre}eg`)}
    ${linearV(`${pre}sky`, [["0%", "#2A1660"], ["28%", "#7E2A78"], ["54%", "#E0507A"], ["76%", "#FF8B4A"], ["100%", "#FFCB74"]])}
    ${radial(`${pre}sun`, "#FFFDEC", "#FF9A3C", "50%", "50%", "50%")}
    ${linearV(`${pre}sea`, [["0%", "#22A0B0"], ["100%", "#04304A"]])}
    <clipPath id="${pre}ic"><circle cx="${C}" cy="${C}" r="${f2(inR + 2)}"/></clipPath>
    <path id="${pre}arc" fill="none" d="${arc}"/>
  `;

  const scene = `
    <g clip-path="url(#${pre}ic)">
      <rect x="12" y="12" width="232" height="232" fill="url(#${pre}sky)"/>
      <circle cx="132" cy="104" r="36" fill="url(#${pre}sun)"/>
      <circle cx="132" cy="104" r="50" fill="url(#${pre}sun)" opacity="0.32"/>
      <rect x="12" y="134" width="232" height="110" fill="url(#${pre}sea)"/>
      <path d="M 12 134 h 232" stroke="#FFE6BC" stroke-width="3" opacity="0.85"/>
      <path d="M 120 134 l -14 110 h 52 l -14 -110 Z" fill="#FFE0A0" opacity="0.36"/>
      <g stroke="#FFF0D0" stroke-width="3.4" opacity="0.38" stroke-linecap="round">
        <path d="M 38 152 h 38"/><path d="M 178 166 h 40"/><path d="M 60 180 h 30"/>
      </g>
      <!-- пальма силуэтом: без неё «закат» читается как любой закат -->
      <g fill="#160C1E" opacity="0.92">
        <path d="M 58 200 q 1 -38 13 -56 l 7 3 q -11 20 -13 53 Z"/>
        <path d="M 72 144 q -26 -13 -40 1 q 22 -2 40 6 Z"/>
        <path d="M 72 144 q 27 -15 43 -1 q -27 -2 -43 7 Z"/>
        <path d="M 72 144 q -7 -27 12 -35 q -6 21 -12 35 Z"/>
        <path d="M 72 144 q 21 -22 41 -15 q -23 4 -41 21 Z"/>
        <circle cx="72" cy="143" r="4"/>
      </g>
    </g>`;

  const band = `<path d="${sector(19, 161, 84, 107)}" fill="__F__"/>`;

  const body = `
    ${sk.open}
      <g filter="${rayBlur.ref}">${burst}</g>
      ${scene}
      <g filter="${metal.ref}">
        <circle cx="${C}" cy="${C}" r="${f2(R - rimW / 2)}" fill="none"
                stroke="url(#${pre}eg)" stroke-width="${rimW}"/>
        <path d="${sector(14, 166, 79, R)}" fill="url(#${pre}eg)"/>
        <g fill="url(#${pre}eg)">${scrolls}</g>
      </g>
      <circle cx="${C}" cy="${C}" r="${f2(inR + 1)}" fill="none" stroke="#2A1000"
              stroke-width="2.6" opacity="0.75"/>
      ${np.recess(band)}
      ${np.text(`<text font-family="'Arial Black','Segoe UI Black',Impact,sans-serif"
            font-weight="900" font-size="24" letter-spacing="3.4" fill="${np.fill}">
          <textPath href="#${pre}arc" startOffset="50%" text-anchor="middle">SCATTER</textPath>
        </text>`)}
    ${sk.close}
    ${sparkle(214, 58, 19, 0.95)}
    ${sparkle(48, 84, 13, 0.75)}
  `;
  return { defs, body };
}

/* ═══════════════════════════ СБОРКА ══════════════════════════════ */

const FIGURES = {
  anchor,
  icecream: iceCream,
  shashlik,
  hat: sunHat,
  wine: wineGlass,
  gem_red:    () => gemSymbol("g0", "ruby",     { sides: 5, rotation: -90, deepen: 0.30, contrast: 1.30, seed: 7 }),
  gem_amber:  () => gemSymbol("g1", "amber",    { sides: 6, rotation: 0,   deepen: 0.38, table: 0.34, girdle: 0.76, contrast: 1.55, ornaments: [0, 3], ornScale: 1.5, seed: 19 }),
  gem_green:  () => gemSymbol("g2", "emerald",  { sides: 3, rotation: -90, deepen: 0.30, table: 0.36, girdle: 0.76, contrast: 1.40, ornScale: 0.95, seed: 31 }),
  gem_aqua:   () => gemSymbol("g3", "aqua",     { sides: 4, rotation: -90, deepen: 0.30, table: 0.38, girdle: 0.78, contrast: 1.40, ornScale: 0.95, seed: 47 }),
  gem_purple: () => gemSymbol("g4", "amethyst", { sides: 3, rotation: 90,  deepen: 0.32, table: 0.36, girdle: 0.76, contrast: 1.40, ornScale: 0.95, seed: 59 }),
  wild,
  scatter
};

const RAW = [
  { id: 0, key: "anchor", label: "ЯКОРЬ" },
  { id: 1, key: "icecream", label: "МОРОЖЕНОЕ" },
  { id: 2, key: "shashlik", label: "ШАШЛЫК" },
  { id: 3, key: "hat", label: "ШЛЯПА" },
  { id: 4, key: "wine", label: "ВИНО" },
  { id: 5, key: "gem_red", label: "КРАСНЫЙ" },
  { id: 6, key: "gem_amber", label: "ЯНТАРЬ" },
  { id: 7, key: "gem_green", label: "ЗЕЛЁНЫЙ" },
  { id: 8, key: "gem_aqua", label: "БИРЮЗА" },
  { id: 9, key: "gem_purple", label: "ФИОЛЕТОВЫЙ" },
  { id: 10, key: "wild", label: "WILD" },
  { id: 11, key: "scatter", label: "SCATTER" }
];

/**
 * Кадр символа.
 *
 * @param opts.scale  масштаб (пульс победы)
 * @param opts.flash  подмешивание белого 0..1
 * @param opts.glow   доп. ореол 0..1
 * @param opts.stars  всплывающие искры
 * @param opts.size   размер кадра в пользовательских единицах
 */
function frameSvg(key, opts = {}) {
  const { scale = 1, flash = 0, glow = 0, stars = null, size = SIZE, view = SIZE } = opts;
  const fig = FIGURES[key]();

  const fl = flash > 0.001 ? whiten("fxw", flash) : null;
  const gw = glow > 0.001
    ? outerGlow("fxg", key === "scatter" ? S.sun : P.gold, {
        size: 10 + glow * 20, opacity: 0.15 + glow * 0.5, halo: 2.2, haloOpacity: 0.1 + glow * 0.26
      })
    : null;

  const starStr = (stars || []).map((s) => sparkle(s.x, s.y, s.size, s.opacity, s.color || "#FFF6D8")).join("");

  // Масштаб вокруг центра кадра.
  //
  // `view` — сколько ДИЗАЙНЕРСКИХ единиц покрывает кадр. У статики это
  // ровно символ (256), у анимации — больше: пульс увеличивает рисунок,
  // и в кадре по размеру символа он упирается в края. Первая версия
  // приземления скаттера начиналась с масштаба 1.42 и теряла четверть
  // картинки — снаружи это выглядит не «наездом камеры», а обрезкой.
  //
  // Лишнее поле прозрачно и уходит в манифест через scale, поэтому
  // символ в покое совпадает по габариту со статикой: подмена статики
  // анимацией не даёт скачка.
  const k = (size / view) * scale;
  const t = `translate(${f2(size / 2)} ${f2(size / 2)}) scale(${f2(k)}) translate(${-C} ${-C})`;

  let content = `<g transform="${t}">${fig.body}${starStr}</g>`;
  if (fl) content = `<g filter="${fl.ref}">${content}</g>`;
  if (gw) content = `<g filter="${gw.ref}">${content}</g>`;

  return svgDoc(size, size, `${fig.defs}${fl ? fl.def : ""}${gw ? gw.def : ""}`, content);
}

export const SYMBOLS = RAW.map((s) => ({
  id: s.id,
  key: s.key,
  label: s.label,
  svg: () => ns(frameSvg(s.key), `s${s.id}`)
}));

export const SYMBOL_SIZE = SIZE;

/* ═════════════════════════ АНИМАЦИИ ══════════════════════════════ */

// Кадры анимации мельче статики намеренно.
//
// Статика — 512 px (дизайн 256 × 2). Тех же 130 кадров анимации в этом
// разрешении дали бы атлас 2048×4400, то есть 36 МБ видеопамяти под то,
// что видно доли секунды. 176 px — это 0.6875 дизайнерского пикселя:
// на мобильной ячейке 90…110 px запас ещё есть, а во время вспышки и
// пульса недостаток чёткости не читается вовсе.
//
// В манифест уходит scale = ANIM_SIZE/ANIM_VIEW: клиент делит w кадра на этот
// множитель и получает тот же габарит, что у статики (display.js,
// `width = frame.w / scaleFactor`), поэтому подмена статики анимацией
// не даёт скачка размера.
export const ANIM_SIZE = 190;

// Поле кадра анимации в дизайнерских единицах: 256 символа + запас под
// пульс и наезд приземления (максимум 1.18).
export const ANIM_VIEW = 300;

const WIN_FRAMES = 8;
const LAND_FRAMES = 10;
const IDLE_FRAMES = 8;

const ease = (t) => t * t * (3 - 2 * t);

/** Искры вокруг символа — по кругу, чтобы вспышка «раскрывалась». */
function winStars(phase) {
  const pts = [[70, 62], [190, 74], [196, 178], [64, 172]];
  return pts.map(([x, y], i) => {
    // Каждая искра живёт свою треть цикла: одновременная вспышка четырёх
    // точек читается как мигание рамки, а не как блеск.
    const local = Math.min(1, Math.max(0, phase * 1.6 - i * 0.16));
    const a = Math.sin(local * Math.PI);
    return { x, y, size: 6 + a * 15, opacity: a * 0.95 };
  }).filter((s) => s.opacity > 0.03);
}

/**
 * Цикл победы: короткий «вдох» объёма и удар света. Пик приходится на
 * треть цикла, спад длиннее подъёма — так удар читается как акцент, а не
 * как равномерное пульсирование.
 */
function winFrame(key, i, n = WIN_FRAMES) {
  const t = i / n;
  const p = t < 0.34 ? ease(t / 0.34) : 1 - ease((t - 0.34) / 0.66);
  return frameSvg(key, {
    size: ANIM_SIZE, view: ANIM_VIEW,
    scale: 1 + p * 0.075,
    flash: p * 0.34,
    glow: p,
    stars: winStars(t)
  });
}

/** Приземление скаттера: падение сверху, сплющивание, вспышка. */
function landFrame(i, n = LAND_FRAMES) {
  const t = i / (n - 1);
  const e = ease(Math.min(1, t / 0.45));
  const bounce = t < 0.45 ? 0 : Math.sin(((t - 0.45) / 0.55) * Math.PI) * 0.07;
  const impact = t < 0.45 ? 0 : 1 - (t - 0.45) / 0.55;
  return frameSvg("scatter", {
    size: ANIM_SIZE, view: ANIM_VIEW,
    scale: (1.18 - 0.18 * e) * (1 + bounce),
    flash: Math.max(0, impact) * 0.5,
    glow: Math.max(0.15, impact),
    stars: t < 0.45 ? [] : winStars(Math.min(1, (t - 0.45) / 0.55))
  });
}

/** Дыхание дикого символа: едва заметный цикл, чтобы он «жил» на барабане. */
function idleFrame(i, n = IDLE_FRAMES) {
  const p = (1 - Math.cos((i / n) * Math.PI * 2)) / 2;
  return frameSvg("wild", {
    size: ANIM_SIZE, view: ANIM_VIEW,
    scale: 1 + p * 0.028,
    flash: p * 0.10,
    glow: 0.25 + p * 0.45
  });
}

const pad = (n) => String(n).padStart(4, "0");

/**
 * Список анимаций для сборщика и манифеста.
 * Имена кадров — `<клип>_0001`, как ждёт SpriteSheet.fromNames.
 */
export const ANIMATIONS = [
  ...RAW.map((s) => ({
    name: `${s.key}_win`,
    fps: 20,
    loop: false,
    frames: Array.from({ length: WIN_FRAMES }, (_, i) => ({
      name: `${s.key}_win_${pad(i + 1)}`,
      svg: () => ns(winFrame(s.key, i), `w${s.id}x${i}`)
    }))
  })),
  {
    name: "scatter_land",
    fps: 22,
    loop: false,
    frames: Array.from({ length: LAND_FRAMES }, (_, i) => ({
      name: `scatter_land_${pad(i + 1)}`,
      svg: () => ns(landFrame(i), `slx${i}`)
    }))
  },
  {
    name: "wild_idle",
    fps: 12,
    loop: true,
    frames: Array.from({ length: IDLE_FRAMES }, (_, i) => ({
      name: `wild_idle_${pad(i + 1)}`,
      svg: () => ns(idleFrame(i), `wix${i}`)
    }))
  }
];
