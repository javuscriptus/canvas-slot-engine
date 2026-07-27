// Многослойный живой фон «Sochi Sunset».
//
// ЗАЧЕМ. До этого фон был ОДНОЙ плоской картинкой: она физически не может
// двигаться, и никакой параллакс из неё не достаётся. Здесь сцена разобрана
// на 12–14 самостоятельных слоёв с альфой, каждый со своим коэффициентом
// параллакса и своим типом движения (см. LAYER_SPEC внизу файла).
//
// ЧТО ДАЁТ ГЛУБИНУ — по убыванию важности:
//
//   1. ПЕРСПЕКТИВНАЯ ПРОЕКЦИЯ ПОЛА (perspective()). Море и галька — не
//      «фотография, растянутая по низу кадра», а настоящая горизонтальная
//      плоскость: строка экрана y отображается в строку текстуры по закону
//      1/(t+e), а горизонтальный масштаб растёт вместе с глубиной. Рябь
//      сходится к горизонту сама, без ручной отрисовки. Это единственный
//      приём, который превращает плоский фон в пространство.
//
//   2. ВОЗДУШНАЯ ПЕРСПЕКТИВА. Каждый следующий план дальше — светлее,
//      бледнее и мягче. Дальний гребень гор уходит в дымку почти целиком,
//      галька переднего плана не обесцвечивается вообще. Если перепутать
//      направление, глубина выворачивается наизнанку.
//
//   3. РЕЗКОСТЬ. Дальние планы размыты, ближние — резкие. Реализовано
//      depthBlur() поверх результата проекции: у горизонта размытие
//      максимально, у нижней кромки нулевое.
//
//   4. ЕДИНЫЙ СВЕТ. Солнце стоит слева-сверху (SCENE.sun), и от него
//      считаются: бликовая дорожка на воде, контровой свет на пальмах,
//      тёплый угол виньетки, цвет дымки. Тот же азимут 135° экранных
//      координат, что у символов и рамок.
//
// ИСТОЧНИК — только 29 фотографий 3840 px из art/downloaded/backgrounds/.
// Плоские силуэты Kenney не используются вообще: они и тянули визуал вниз.
//
// Модуль ничего не пишет на диск сам. Он возвращает слои, а раскладывает их
// producers/scenery.mjs.
//
//   import { buildScene } from "./scenery.mjs";
//   const scene = await buildScene({ variant: "day", orientation: "landscape" });

import sharp from "sharp";
import {
  photo, photoPath, grade, aerial, fadeEdges, scaleAlpha, SOCHI_GRADE, HAZE
} from "./photo.mjs";

/* ═══════════════════════ 0. Мелкая арифметика ════════════════════ */

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function hexRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function smoothstep(x, a, b) {
  if (b === a) return x >= b ? 1 : 0;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Зеркальная адресация текстуры: …2,1,0,0,1,2… вместо разрыва на стыке. */
function mirror(i, n) {
  const p = 2 * n;
  let k = ((i % p) + p) % p;
  return k < n ? k : p - 1 - k;
}

/** Детерминированный шум: одинаковая картинка при каждой сборке. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

async function raw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function png(data, w, h) {
  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 6 }).toBuffer();
}

function blank(w, h) {
  return { data: Buffer.alloc(w * h * 4), w, h };
}

/* ═══════════════════════ 1. Параметры сцены ══════════════════════ */

/**
 * Единый свет сцены. Солнце слева-сверху — тот же квадрант, что у фаски
 * символов. От него пляшет всё: дорожка на воде, контровик на пальмах,
 * тёплый угол виньетки.
 */
export const SCENE = {
  landscape: {
    view: [1920, 1080],
    horizon: 0.415,          // доля высоты ЭКРАНА
    sun: [0.205, 0.285],     // центр солнца, доли экрана
    sunR: 0.052,             // радиус диска, доли высоты экрана
    shoreline: 0.805,        // где вода переходит в гальку
    // Кулисы задаются долей ШИРИНЫ экрана: только так одна и та же
    // пальма не разрастается на весь кадр при повороте в портрет.
    palmLeftW: 0.68,
    palmRightW: 0.48
  },
  portrait: {
    view: [1080, 1920],
    horizon: 0.325,
    sun: [0.235, 0.195],
    sunR: 0.034,
    shoreline: 0.795,
    palmLeftW: 1.15,
    palmRightW: 0.85
  }
};

/** Запас по краям: без него параллаксу нечем двигаться. */
export const OVERSCAN = 0.15;

/**
 * Палитра сцены. Согласована с tools/assets/palette.mjs (тени royal
 * #2A0B45, золото #F7C948), но описывает АТМОСФЕРУ, а не материалы,
 * поэтому живёт здесь и palette.mjs не трогает.
 */
export const SKIES = {
  day: {
    // Ключевые точки заданы ОТНОСИТЕЛЬНО ГОРИЗОНТА (rel = 1 — линия
    // горизонта), а не в долях холста. Это не косметика: при абсолютной
    // разметке золотая зона градиента уезжала ПОД воду, над горизонтом
    // оставалась одна магента, и вся сцена читалась сиреневой, а по
    // линии горизонта шла красная полоса — стык «розовое небо / кремовая
    // дымка воды». Привязка к горизонту ставит самое горячее место
    // ровно туда, где ему положено быть.
    ramp: [
      { rel: 0.00, c: "#1C0E42" },   // зенит
      { rel: 0.24, c: "#3B1A66" },
      { rel: 0.46, c: "#6E2C76" },
      { rel: 0.64, c: "#AE4A6C" },
      { rel: 0.79, c: "#E0744C" },
      { rel: 0.90, c: "#F8A63E" },
      { rel: 0.97, c: "#FFCD7C" },
      { rel: 1.00, c: "#FFE6BA" }    // линия горизонта, самая горячая
    ],
    tail: "#FFE6BA",                 // ниже горизонта: всё равно под водой
    haze: "#F6BE96",
    hazeFar: "#FBD9B4",
    sunCore: "#FFFCEF",
    sunGlow: "#FFC46A",
    seaTint: { shadows: "#16294D", highlights: "#FFD9A0" },
    grade: SOCHI_GRADE
  },
  night: {
    ramp: [
      { rel: 0.00, c: "#030210" },
      { rel: 0.26, c: "#08072A" },
      { rel: 0.50, c: "#12103C" },
      { rel: 0.70, c: "#1F1B52" },
      { rel: 0.85, c: "#352566" },
      { rel: 0.94, c: "#553670" },
      { rel: 1.00, c: "#6A4A78" }
    ],
    tail: "#6A4A78",
    haze: "#3A2E63",
    hazeFar: "#4E3E77",
    sunCore: "#F4F8FF",
    sunGlow: "#8FB6FF",
    seaTint: { shadows: "#050B22", highlights: "#BFD6FF" },
    grade: {
      shadows: "#08061E", highlights: "#9FC0FF",
      shadowAmount: 0.42, highlightAmount: 0.26,
      contrast: 1.10, saturation: 0.72, temperature: -0.35, exposure: 0.62
    }
  }
};

/** Развернуть ramp (доли от горизонта) в абсолютные стопы холста. */
export function rampToStops(sky, horizonFraction) {
  const hf = clamp01(horizonFraction);
  const stops = sky.ramp.map((s) => ({ at: s.rel * hf, c: s.c }));
  stops.push({ at: Math.min(1, hf + 0.02), c: sky.tail });
  stops.push({ at: 1, c: sky.tail });
  return stops;
}

/* ═══════════════════ 2. Процедурные генераторы ═══════════════════ */

/**
 * skyGradient — вертикальный градиент неба.
 *
 * Пишется попиксельно, а не через SVG, по двум причинам: нужен точный
 * контроль ключевых точек (у заката перелом тона резкий, у линейного
 * градиента его нет) и нужен ДИЗЕРИНГ. Небо занимает половину экрана,
 * и без ±1.5 единицы шума 8-битный градиент разваливается на видимые
 * полосы — это первое, что выдаёт дешёвый фон.
 */
export function skyGradient(w, h, stops, { dither = 1.6, seed = 7 } = {}) {
  const { data } = blank(w, h);
  const pts = stops.map((s) => ({ at: s.at, c: hexRgb(s.c) }));
  const rnd = rng(seed);
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].at < t) i++;
    const a = pts[i], b = pts[i + 1];
    const k = smoothstep(t, a.at, b.at);
    const r = lerp(a.c[0], b.c[0], k), g = lerp(a.c[1], b.c[1], k), bl = lerp(a.c[2], b.c[2], k);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const n = (rnd() - 0.5) * 2 * dither;
      data[o] = clamp255(r + n);
      data[o + 1] = clamp255(g + n);
      data[o + 2] = clamp255(bl + n);
      data[o + 3] = 255;
    }
  }
  return png(data, w, h);
}

/**
 * radialGlow — солнце/луна: ядро, корона, широкий ореол.
 *
 * Три составляющие с РАЗНЫМИ показателями спада. Один гауссиан даёт
 * ватный шар; настоящее светило — это резкий диск, вокруг него быстро
 * падающая корона и очень пологое зарево на полнеба.
 */
export function radialGlow(w, h, opts = {}) {
  const {
    cx = w / 2, cy = h / 2, radius = 60,
    core = "#FFFCEF", glow = "#FFC46A", halo = null,
    coreOpacity = 1, glowScale = 3.4, haloScale = 11,
    glowOpacity = 0.85, haloOpacity = 0.34, edge = 0.16,
    rays = 0, rayLength = 6, raySeed = 3
  } = opts;
  const { data } = blank(w, h);
  const c = hexRgb(core), g = hexRgb(glow), hl = hexRgb(halo || glow);
  const rG = radius * glowScale, rH = radius * haloScale;
  const rnd = rng(raySeed);
  // Лучи: случайные, но детерминированные фазы — иначе «звёздочка из клипарта».
  const rayPhase = Array.from({ length: Math.max(1, rays) }, () => rnd() * Math.PI * 2);
  const rayAmp = Array.from({ length: Math.max(1, rays) }, () => 0.5 + rnd() * 0.5);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > rH) continue;

      const kCore = 1 - smoothstep(d, radius * (1 - edge), radius * (1 + edge));
      const kGlow = Math.pow(1 - clamp01(d / rG), 2.2);
      let kHalo = Math.pow(1 - clamp01(d / rH), 3.0);

      if (rays > 0 && d > radius) {
        const ang = Math.atan2(dy, dx);
        let s = 0;
        for (let i = 0; i < rays; i++) s += rayAmp[i] * Math.pow(Math.abs(Math.cos((ang - rayPhase[i]) * 0.5)), rayLength);
        kHalo += Math.pow(1 - clamp01(d / rH), 1.4) * clamp01(s / rays) * 0.55;
      }

      const aC = kCore * coreOpacity;
      const aG = kGlow * glowOpacity;
      const aH = clamp01(kHalo) * haloOpacity;
      const a = clamp01(aC + aG * (1 - aC) + aH * (1 - aC) * (1 - aG));
      if (a <= 0.002) continue;

      // Цвет: от ядра к ореолу.
      const wC = aC, wG = aG * (1 - aC), wH = aH * (1 - aC) * (1 - aG);
      const sum = wC + wG + wH || 1;
      const o = (y * w + x) * 4;
      data[o] = clamp255((c[0] * wC + g[0] * wG + hl[0] * wH) / sum);
      data[o + 1] = clamp255((c[1] * wC + g[1] * wG + hl[1] * wH) / sum);
      data[o + 2] = clamp255((c[2] * wC + g[2] * wG + hl[2] * wH) / sum);
      data[o + 3] = clamp255(a * 255);
    }
  }
  return png(data, w, h);
}

/**
 * perspective — проекция плоской текстуры на горизонтальную плоскость.
 *
 * ГЛАВНАЯ функция модуля. Для строки экрана y считаем глубину
 *      depth = (1 + e) / (t + e),   t = (y+0.5)/h,
 * то есть у нижней кромки depth = 1, у горизонта depth → 1/e. Вертикальная
 * координата текстуры растёт как depth (плитки сжимаются к горизонту),
 * горизонтальная — как depth относительно центра (плоскость сходится
 * в точку схода). Текстура тайлится по обеим осям.
 *
 * Заодно тут же примешивается дымка по глубине: у горизонта воды больше
 * воздуха, чем у ног. Разносить это на два прохода бессмысленно —
 * коэффициент глубины уже посчитан.
 *
 * @param {Buffer} src        текстура (лучше снятая сверху)
 * @param {number} w,h        размер выходного куска
 * @param {number} opts.e     0.02…0.25 — «высота камеры». Меньше — острее
 *                            перспектива и дальше горизонт
 * @param {number} opts.tileV,tileU  сколько повторов текстуры у нижней кромки
 * @param {string} opts.haze  цвет дымки
 * @param {number} opts.hazeAmount   сила дымки на горизонте, 0..1
 * @param {number} opts.hazePower    показатель степени: 1 — линейно по
 *                                   глубине, БОЛЬШЕ — дымка жмётся к
 *                                   горизонту и не съедает середину плана
 * @param {number} opts.darkenNear   притемнение переднего плана 0..1
 * @param {number} opts.shiftU       сдвиг текстуры по горизонтали
 */
export async function perspective(src, w, h, opts = {}) {
  const {
    e = 0.09, tileV = 1.0, tileU = 1.4,
    haze = HAZE, hazeAmount = 0.85, hazePower = 1.8,
    darkenNear = 0.0, shiftU = 0, shiftV = 0, seed = 11, wobble = 0.37
  } = opts;

  const s = await raw(await sharp(src).ensureAlpha().png().toBuffer());
  const out = blank(w, h);
  const hz = hexRgb(haze);
  const rnd = rng(seed);

  for (let y = 0; y < h; y++) {
    const t = (y + 0.5) / h;
    const depth = (1 + e) / (t + e);              // 1 внизу, 1/e у горизонта
    const dn = clamp01((depth - 1) / (1 / e - 1)); // 0 внизу, 1 у горизонта
    const kHaze = Math.pow(dn, hazePower) * hazeAmount;

    const vSrc = (depth - 1) * (s.h / tileV) + shiftV;
    const magn = depth;                            // во сколько раз ужимается

    // Зеркальный тайлинг убирает швы, но заводит новую беду: ось
    // зеркала стоит на месте, и по всей глубине выстраивается
    // симметричный «бабочкин» узор — в портрете он был виден сразу.
    // Плавающий по глубине сдвиг двигает ось и симметрию ломает.
    const wob = wobble > 0 ? Math.sin(depth * 0.9) * s.w * wobble : 0;

    for (let x = 0; x < w; x++) {
      const uSrc = (x - w / 2) * magn * (s.w / (w * tileU)) + s.w / 2 + shiftU + wob;

      // Билинейная выборка с ЗЕРКАЛЬНЫМ тайлингом — без неё дальний
      // план рябит, а обычный wrap рисует по стыкам плиток чёткие
      // диагональные швы (было видно на первом же рендере моря).
      // У зеркала на стыке рвётся только производная, и на ряби воды
      // это незаметно.
      const u0 = Math.floor(uSrc), v0 = Math.floor(vSrc);
      const fu = uSrc - u0, fv = vSrc - v0;
      const ua = mirror(u0, s.w), ub = mirror(u0 + 1, s.w);
      const va = mirror(v0, s.h), vb = mirror(v0 + 1, s.h);
      const i00 = (va * s.w + ua) * 4, i10 = (va * s.w + ub) * 4;
      const i01 = (vb * s.w + ua) * 4, i11 = (vb * s.w + ub) * 4;

      let r = 0, g = 0, b = 0, a = 0;
      const wts = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv];
      const idx = [i00, i10, i01, i11];
      for (let k = 0; k < 4; k++) {
        r += s.data[idx[k]] * wts[k];
        g += s.data[idx[k] + 1] * wts[k];
        b += s.data[idx[k] + 2] * wts[k];
        a += s.data[idx[k] + 3] * wts[k];
      }

      if (darkenNear > 0) {
        const k = (1 - dn) * darkenNear;
        r *= 1 - k; g *= 1 - k; b *= 1 - k;
      }
      if (kHaze > 0) {
        // сперва обесцвечивание, потом подмес дымки
        const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const ds = kHaze * 0.8;
        r = l + (r - l) * (1 - ds); g = l + (g - l) * (1 - ds); b = l + (b - l) * (1 - ds);
        r += (hz[0] - r) * kHaze; g += (hz[1] - g) * kHaze; b += (hz[2] - b) * kHaze;
      }

      const n = (rnd() - 0.5) * 2.2;
      const o = (y * w + x) * 4;
      out.data[o] = clamp255(r + n);
      out.data[o + 1] = clamp255(g + n);
      out.data[o + 2] = clamp255(b + n);
      out.data[o + 3] = clamp255(a);
    }
  }
  return png(out.data, w, h);
}

/**
 * depthBlur — резкость по глубине: верх кадра мягкий, низ резкий.
 * Смешивает картинку с её размытой копией по вертикальной рампе.
 * Без этого перспективная плоскость выглядит нарисованной: у настоящей
 * камеры дальний план всегда мягче.
 */
export async function depthBlur(buf, { max = 6, power = 2.4 } = {}) {
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;
  const sharpRaw = await raw(buf);
  const softRaw = await raw(await sharp(buf).blur(max).png().toBuffer());
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    const k = Math.pow(1 - y / Math.max(1, h - 1), power); // 1 сверху → 0 снизу
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        out.data[o + c] = clamp255(lerp(sharpRaw.data[o + c], softRaw.data[o + c], k));
      }
    }
  }
  return png(out.data, w, h);
}

/**
 * alphaFromLuma — альфа из яркости. Рабочая лошадка для облаков и пены:
 * светлое (облако, пена) остаётся, тёмное (просвет неба, вода) уходит.
 * @param {boolean} opts.invert  оставить ТЁМНОЕ (силуэт на светлом небе)
 * @param {number} opts.premul   гасить цвет вместе с альфой (для аддитива)
 */
export async function alphaFromLuma(buf, opts = {}) {
  const { lo = 0.35, hi = 0.75, invert = false, gamma = 1, feather = 0, premul = false } = opts;
  const { data, w, h } = await raw(buf);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const lum = (data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722) / 255;
    let a = invert ? 1 - smoothstep(lum, lo, hi) : smoothstep(lum, lo, hi);
    if (gamma !== 1) a = Math.pow(a, gamma);
    a *= data[o + 3] / 255;
    if (premul) {
      data[o] = clamp255(data[o] * a);
      data[o + 1] = clamp255(data[o + 1] * a);
      data[o + 2] = clamp255(data[o + 2] * a);
    }
    data[o + 3] = clamp255(a * 255);
  }
  let out = await png(data, w, h);
  if (feather > 0) out = await featherAlpha(out, feather);
  return out;
}

/**
 * alphaFromColorDistance — кей по цвету ровного неба.
 * Для снежной горы кей по яркости не работает (снег ярче неба), а кей по
 * ЦВЕТУ — работает: небо однородно-голубое, снег нейтрален.
 */
export async function alphaFromColorDistance(buf, opts = {}) {
  const { keyColor = "#BFE2F2", tolerance = 0.10, softness = 0.10, despill = 0.5, feather = 1 } = opts;
  const { data, w, h } = await raw(buf);
  const k = hexRgb(keyColor).map((v) => v / 255);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
    const d = Math.sqrt((r - k[0]) ** 2 + (g - k[1]) ** 2 + (b - k[2]) ** 2) / 1.7320508;
    const a = smoothstep(d, tolerance, tolerance + Math.max(0.005, softness));
    if (despill > 0 && a > 0.02 && a < 0.98) {
      const q = (1 - a) * despill;
      data[o] = clamp255(data[o] * (1 - q * 0.5));
      data[o + 1] = clamp255(data[o + 1] * (1 - q * 0.4));
      data[o + 2] = clamp255(data[o + 2] * (1 - q * 0.7));
    }
    data[o + 3] = clamp255(a * data[o + 3]);
  }
  let out = await png(data, w, h);
  if (feather > 0) out = await featherAlpha(out, feather);
  return out;
}

/**
 * keyByRowModel — кей по МОДЕЛИ НЕБА, а не по абсолютному порогу.
 *
 * Зачем понадобился. Кей по яркости валится на снежной горе: снег ярче
 * неба, порог выбивает вершину. Кей по цвету валится на градиентном
 * небе: у зенита оно синее, у горизонта почти белое, одного ключевого
 * цвета нет. Обе беды описаны в отчёте предыдущего агента как
 * нерешённые. Решение — не искать «цвет неба», а ПОСТРОИТЬ его:
 *
 *   1. по верхним sampleTop строкам (там чистое небо) считается средний
 *      цвет каждой строки;
 *   2. по этим строкам методом наименьших квадратов подгоняется
 *      квадратичная модель цвета от y и экстраполируется на весь кадр;
 *   3. отклонение пикселя от модели — и есть «не небо».
 *
 * Плюс fillDown: гора СПЛОШНАЯ, ниже её кромки неба быть не может.
 * Бегущий максимум альфы сверху вниз закрывает дыры в снегу, чей цвет
 * случайно совпал с небом. Именно этого не хватало, чтобы гребень
 * перестал быть решетом.
 *
 * @param {number} opts.sampleTop  доля кадра сверху, где гарантированно небо
 * @param {number} opts.tol        порог отклонения 0..1
 * @param {number} opts.softness   ширина перехода
 * @param {boolean} opts.fillDown  «залить» всё ниже найденной кромки
 * @param {number} opts.minRun     сколько строк подряд должно отклоняться,
 *                                 чтобы считать это кромкой (глушит шум)
 */
export async function keyByRowModel(buf, opts = {}) {
  const {
    sampleTop = 0.42, tol = 0.055, softness = 0.06,
    fillDown = true, minRun = 3, feather = 1.2, despill = 0.55, fillFrom = 0,
    silhouetteFromBottom = false
  } = opts;
  const { data, w, h } = await raw(buf);
  const rows = Math.max(8, Math.round(h * sampleTop));

  // 1. средний цвет каждой строки чистого неба
  const my = [], mv = [[], [], []];
  for (let y = 0; y < rows; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; r += data[o]; g += data[o + 1]; b += data[o + 2]; }
    my.push(y / h); mv[0].push(r / w); mv[1].push(g / w); mv[2].push(b / w);
  }

  // 2. ЛИНЕЙНАЯ подгонка v(t) = a + b·t.
  //
  // Именно линейная, а не квадратичная. Квадрат по узкому куску кадра
  // экстраполируется вразнос: на 44 % высоты предсказание уезжало на
  // десятки единиц, всё считалось «не небом», и fillDown заливал
  // прямоугольник во весь кадр. Прямая по тому же куску ошибается
  // мягко и в ту же сторону, что реальный градиент.
  const fit = (vals) => {
    let n = 0, st = 0, stt = 0, sv = 0, stv = 0;
    for (let i = 0; i < my.length; i++) {
      const t = my[i], v = vals[i];
      n++; st += t; stt += t * t; sv += v; stv += t * v;
    }
    const den = n * stt - st * st;
    if (Math.abs(den) < 1e-9) return [sv / Math.max(1, n), 0];
    const b = (n * stv - st * sv) / den;
    return [(sv - b * st) / n, b];
  };
  const P = [fit(mv[0]), fit(mv[1]), fit(mv[2])];
  const model = (t, ch) => P[ch][0] + P[ch][1] * t;

  // 3. отклонение → альфа
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const pr = model(t, 0), pg = model(t, 1), pb = model(t, 2);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const d = Math.max(
        Math.abs(data[o] - pr), Math.abs(data[o + 1] - pg), Math.abs(data[o + 2] - pb)
      ) / 255;
      alpha[y * w + x] = smoothstep(d, tol, tol + Math.max(0.005, softness));
    }
  }

  // 4. заливка вниз от кромки
  // 4а. СИЛУЭТ СНИЗУ ВВЕРХ — единственный способ взять Эльбрус.
  //
  // В его небе перистые облака: белая полоса на синем отклоняется от
  // модели на 0.41 при любом разумном допуске 0.05, поэтому и порог, и
  // fillDown цепляются за облака, а не за вершину. Ключевое наблюдение:
  // облака ВСЕГДА выше гребня. Значит, идти надо не сверху вниз, а СНИЗУ
  // ВВЕРХ: столбец начинается в горе, первый устойчивый участок «неба»
  // и есть кромка, выше неё мы просто не поднимаемся — и облака никогда
  // не встречаем. Для дальнего плана силуэт и есть всё содержание, так
  // что потеря внутренней детализации кромки ничего не стоит.
  if (silhouetteFromBottom) {
    const edge = new Int32Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      let run = 0;
      for (let y = h - 1; y >= 0; y--) {
        if (alpha[y * w + x] < 0.45) { run++; if (run >= minRun) { edge[x] = y + minRun; break; } }
        else run = 0;
      }
    }
    // Столбец, где чистого неба не нашлось вовсе (вершина упирается в
    // верх кропа, облако прижато к гребню), нельзя оставлять нулём:
    // ноль означает «гора во весь кадр» и рисует блок с плоской крышей.
    // Такие столбцы достраиваются по соседям.
    const valid = [];
    for (let x = 0; x < w; x++) if (edge[x] >= 0) valid.push(edge[x]);
    const fallback = valid.length
      ? valid.slice().sort((a, b) => a - b)[valid.length >> 1] : Math.round(h * 0.4);
    for (let x = 0; x < w; x++) if (edge[x] < 0) edge[x] = fallback;
    // Кромку нужно чистить в ДВА приёма. Сначала МЕДИАНА: если в столбце
    // просвет между скалами, поиск уезжает вверх и даёт иглу высотой в
    // полкадра (на первом прогоне Эльбрус оброс частоколом). Медиана
    // такие выбросы просто не пропускает, а среднее — размазывает их
    // в горб. Потом среднее — чтобы убрать ступеньки от медианы.
    // Окно медианы шире самого широкого ложного выброса. У Эльбруса
    // перистая полоса подходит к вершине вплотную, разрыв чистого неба
    // короче minRun, и поиск проскакивает сквозь облако — получается
    // «зубец» шириной до 6 % кадра. Окно 9 % его срезает.
    const R = Math.max(3, Math.round(w * 0.045));
    const med = new Float32Array(w);
    const win = [];
    for (let x = 0; x < w; x++) {
      win.length = 0;
      for (let k = -R; k <= R; k++) win.push(edge[Math.min(w - 1, Math.max(0, x + k))]);
      win.sort((a, b) => a - b);
      med[x] = win[win.length >> 1];
    }
    const sm = new Float32Array(w);
    const R2 = Math.max(2, Math.round(w * 0.02));
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -R2; k <= R2; k++) { const i = Math.min(w - 1, Math.max(0, x + k)); s += med[i]; n++; }
      sm[x] = s / n;
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) alpha[y * w + x] = smoothstep(y, sm[x] - 1.5, sm[x] + 1.5);
    }
  } else if (fillDown) {
    const y0 = Math.round(fillFrom * h);
    for (let x = 0; x < w; x++) {
      let run = 0, hit = false;
      for (let y = y0; y < h; y++) {
        const i = y * w + x;
        if (hit) { alpha[i] = 1; continue; }
        if (alpha[i] > 0.55) { run++; if (run >= minRun) { hit = true; for (let k = 0; k < minRun; k++) alpha[(y - k) * w + x] = 1; } }
        else run = 0;
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    const a = alpha[i], o = i * 4;
    if (despill > 0 && a > 0.02 && a < 0.98) {
      const q = (1 - a) * despill;
      data[o] = clamp255(data[o] * (1 - q * 0.45));
      data[o + 1] = clamp255(data[o + 1] * (1 - q * 0.4));
      data[o + 2] = clamp255(data[o + 2] * (1 - q * 0.6));
    }
    data[o + 3] = clamp255(a * data[o + 3]);
  }
  const out = await png(data, w, h);
  return feather > 0 ? featherAlpha(out, feather) : out;
}

/**
 * featherAlpha — размыть ТОЛЬКО альфу.
 *
 * Грабли sharp (описаны в photo.mjs и подтверждены здесь): .blur() над
 * сырым одноканальным буфером уходит в sRGB и возвращает три канала.
 * toColourspace("b-w") фиксирует один.
 */
export async function featherAlpha(buf, radius) {
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;
  const a = await sharp(buf).ensureAlpha().extractChannel(3)
    .blur(radius).toColourspace("b-w").raw().toBuffer();
  const rgb = await sharp(buf).removeAlpha().toColourspace("srgb").raw().toBuffer();
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(a, { raw: { width: w, height: h, channels: 1 } })
    .png({ compressionLevel: 6 }).toBuffer();
}

/** Вертикальная рампа альфы: слой растворяется сверху и/или снизу. */
export async function verticalFade(buf, { top = 0, bottom = 0, topStart = 0, bottomStart = 0 } = {}) {
  const { data, w, h } = await raw(buf);
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    let k = 1;
    if (top > 0) k *= smoothstep(t, topStart, topStart + top);
    if (bottom > 0) k *= 1 - smoothstep(t, 1 - bottomStart - bottom, 1 - bottomStart);
    if (k >= 1) continue;
    for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = clamp255(data[(y * w + x) * 4 + 3] * k);
  }
  return png(data, w, h);
}

/** Горизонтальная рампа — чтобы слой не обрывался на краю оверскана. */
export async function horizontalFade(buf, { left = 0, right = 0 } = {}) {
  const { data, w, h } = await raw(buf);
  for (let x = 0; x < w; x++) {
    const t = x / Math.max(1, w - 1);
    let k = 1;
    if (left > 0) k *= smoothstep(t, 0, left);
    if (right > 0) k *= 1 - smoothstep(t, 1 - right, 1);
    if (k >= 1) continue;
    for (let y = 0; y < h; y++) data[(y * w + x) * 4 + 3] = clamp255(data[(y * w + x) * 4 + 3] * k);
  }
  return png(data, w, h);
}

/**
 * sunPath — бликовая дорожка от светила на воде.
 *
 * Не «белый овал под солнцем». Дорожка складывается из сотен коротких
 * горизонтальных штрихов — бликов на отдельных волнах. У горизонта они
 * мелкие и плотные, у зрителя — крупные и редкие: тот же закон
 * перспективы, что в perspective(). Отдельный слой, потому что дорожка
 * должна мерцать независимо от воды.
 */
export function sunPath(w, h, opts = {}) {
  const {
    cx = w * 0.2, width = w * 0.10, spread = 2.6,
    color = "#FFE7A8", hot = "#FFFFFF",
    density = 1.0, seed = 23, opacity = 1,
    e = 0.09, fadeTop = 0.02
  } = opts;
  const { data } = blank(w, h);
  const c = hexRgb(color), hc = hexRgb(hot);
  const rnd = rng(seed);

  // Строк тем больше, чем ближе к зрителю: шаг растёт по глубине.
  let y = 0;
  while (y < h) {
    const t = (y + 0.5) / h;
    const depth = (1 + e) / (t + e);
    const step = Math.max(1, 1.15 / (depth / (1 / e)) * 0.9 + t * 9);
    const bandW = width * (1 + spread * t);          // дорожка расширяется книзу
    const dashW = Math.max(1.2, 1.0 + t * 26);
    const dashH = Math.max(1, 0.8 + t * 5);
    const n = Math.round((bandW / dashW) * 1.7 * density);
    const kY = smoothstep(t, 0, fadeTop) * (0.35 + 0.65 * Math.pow(1 - t, 0.35));

    for (let i = 0; i < n; i++) {
      const u = (rnd() * 2 - 1);
      const gx = cx + u * bandW * 0.5;
      // Яркость падает к краям дорожки — гауссиан поперёк.
      const k = Math.exp(-(u * u) * 2.4) * kY * (0.35 + rnd() * 0.65);
      if (k < 0.03) continue;
      const dw = dashW * (0.4 + rnd() * 1.1);
      const dh = dashH * (0.5 + rnd() * 1.0);
      const hotK = Math.pow(k, 2.2);
      // Разброс по вертикали внутри шага: без него блики выстраиваются
      // в строки и дорожка читается как пиксельная сетка, а не как вода.
      const y0 = y + (rnd() - 0.5) * step * 1.6;
      for (let yy = Math.floor(y0); yy < y0 + dh && yy < h; yy++) {
        if (yy < 0) continue;
        for (let xx = Math.floor(gx - dw / 2); xx < gx + dw / 2; xx++) {
          if (xx < 0 || xx >= w) continue;
          const fall = 1 - Math.abs((xx - gx) / (dw / 2 + 0.001));
          const a = clamp01(k * (0.4 + 0.6 * fall) * opacity);
          const o = (yy * w + xx) * 4;
          const prev = data[o + 3] / 255;
          const na = clamp01(prev + a * (1 - prev));
          if (na <= prev) continue;
          data[o] = clamp255(lerp(c[0], hc[0], hotK));
          data[o + 1] = clamp255(lerp(c[1], hc[1], hotK));
          data[o + 2] = clamp255(lerp(c[2], hc[2], hotK));
          data[o + 3] = clamp255(na * 255);
        }
      }
    }
    y += step;
  }
  return png(data, w, h);
}

/** Звёзды для ночной версии: три величины, слабая красноватая часть. */
export function starField(w, h, opts = {}) {
  const { count = 900, seed = 91, maxY = 0.72, brightness = 1 } = opts;
  const { data } = blank(w, h);
  const rnd = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * w);
    const yy = rnd() * rnd() * maxY;               // гуще к зениту
    const y = Math.floor(yy * h);
    const mag = Math.pow(rnd(), 3.2);              // ярких единицы
    const a = clamp01((0.10 + mag * 0.95) * brightness);
    const warm = rnd() < 0.25;
    const r = warm ? 255 : 224, g = warm ? 226 : 236, b = warm ? 198 : 255;
    const size = mag > 0.72 ? 2 : 1;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const o = ((y + dy) * w + (x + dx)) * 4;
      if (o < 0 || o + 3 >= data.length) continue;
      data[o] = r; data[o + 1] = g; data[o + 2] = b;
      data[o + 3] = clamp255(a * 255 * (dx || dy ? 0.55 : 1));
    }
  }
  return png(data, w, h);
}

/**
 * promenadeLights — огни набережной для бонусной сцены.
 * Цепочка тёплых фонарей вдоль горизонта: у горизонта плотнее и мельче.
 * Каждый — точка плюс ореол, поэтому в сумме читается «город у воды».
 */
export async function promenadeLights(w, h, opts = {}) {
  const { count = 90, seed = 55, y = h * 0.5, jitter = 6, color = "#FFC46A", cold = "#BFE6FF", scale = 1 } = opts;
  const { data } = blank(w, h);
  const rnd = rng(seed);
  const warm = hexRgb(color), cool = hexRgb(cold);
  for (let i = 0; i < count; i++) {
    // Плотность выше у краёв кадра — центр закрыт барабанами.
    const u = rnd();
    const x = u * w;
    const yy = y + (rnd() - 0.5) * jitter;
    const isCold = rnd() < 0.22;
    const c = isCold ? cool : warm;
    const r = (1.1 + rnd() * 2.4) * scale;
    const glowR = r * (5 + rnd() * 6);
    const amp = 0.45 + rnd() * 0.55;
    for (let dy = -glowR; dy <= glowR; dy++) {
      const py = Math.round(yy + dy);
      if (py < 0 || py >= h) continue;
      for (let dx = -glowR; dx <= glowR; dx++) {
        const px = Math.round(x + dx);
        if (px < 0 || px >= w) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        const kCore = 1 - smoothstep(d, r * 0.5, r);
        const kGlow = Math.pow(1 - clamp01(d / glowR), 3.2) * 0.5;
        const a = clamp01((kCore + kGlow) * amp);
        if (a < 0.004) continue;
        const o = (py * w + px) * 4;
        const prev = data[o + 3] / 255;
        const na = clamp01(prev + a * (1 - prev));
        data[o] = clamp255(lerp(data[o], lerp(c[0], 255, kCore), a));
        data[o + 1] = clamp255(lerp(data[o + 1], lerp(c[1], 250, kCore), a));
        data[o + 2] = clamp255(lerp(data[o + 2], lerp(c[2], 235, kCore), a));
        data[o + 3] = clamp255(na * 255);
      }
    }
  }
  return png(data, w, h);
}

/**
 * vignetteLayer — виньетка, запечённая в текстуру.
 *
 * Запекается, а не считается шейдером в рантайме, по двум причинам:
 * не тратится филл-рейт на мобильном GPU и можно сделать её НЕ круглой.
 * Здесь она смещена от солнца: угол со стороны светила почти не темнеет,
 * противоположный уходит глубоко. Ровное чёрное кольцо по периметру —
 * признак дешёвого фона.
 */
export function vignetteLayer(w, h, opts = {}) {
  const {
    sun = [0.2, 0.28], strength = 0.62, radius = 0.62, softness = 0.55,
    color = "#0B0413", warm = "#FF9A4A", warmth = 0.16, aspect = 1.35, seed = 5,
    bottomShade = 0.30, bottomStart = 0.62
  } = opts;
  const { data } = blank(w, h);
  const dk = hexRgb(color), wm = hexRgb(warm);
  const rnd = rng(seed);
  const sx = sun[0] * w, sy = sun[1] * h;
  const maxD = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2) * aspect;
      const dy = (y - h / 2) / (h / 2);
      const d = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(aspect * aspect + 1) * 1.414;
      let k = smoothstep(d, radius, radius + softness) * strength;

      // Со стороны солнца затемнение слабее — свет «выедает» угол.
      const ds = Math.sqrt((x - sx) ** 2 + (y - sy) ** 2) / maxD;
      k *= lerp(0.25, 1, clamp01(ds));

      // Отдельное затемнение НИЗА кадра. Круглая виньетка низ не берёт,
      // а именно тёмный передний план замыкает сцену в коробку: у всех
      // эталонов Pragmatic нижняя полоса — самое тёмное место кадра.
      if (bottomShade > 0) {
        k = clamp01(k + smoothstep(y / h, bottomStart, 1) * bottomShade * (1 - k));
      }

      const glow = Math.pow(1 - clamp01(ds / 0.85), 4) * warmth;

      // Два вклада сводятся ОДНОЙ формулой «тёмное поверх тёплого».
      // Первая версия писала их по очереди с проверкой «кто непрозрачнее»,
      // и на стыке вылезал светлый эллипс — классика.
      const aTot = clamp01(k + glow * (1 - k));
      if (aTot <= 0.004) continue;
      const wK = k, wG = glow * (1 - k);
      const sum = wK + wG || 1;
      const n = (rnd() - 0.5) * 3;
      const o = (y * w + x) * 4;
      data[o] = clamp255((dk[0] * wK + wm[0] * wG) / sum + n);
      data[o + 1] = clamp255((dk[1] * wK + wm[1] * wG) / sum + n);
      data[o + 2] = clamp255((dk[2] * wK + wm[2] * wG) / sum + n);
      data[o + 3] = clamp255(aTot * 255);
    }
  }
  return png(data, w, h);
}

/* ═══════════════════════ 3. Утилиты слоёв ════════════════════════ */

/**
 * trim — обрезать слой по фактической непрозрачности и вернуть смещение.
 *
 * Экономия веса, ради которой всё затевалось: пальма занимает четверть
 * холста, солнце — восьмую, прибой — полосу в 90 px. Хранить их
 * полноформатными — выбросить больше половины бюджета в 2.5 МБ.
 */
export async function trim(buf, { threshold = 3, pad = 2 } = {}) {
  const { data, w, h } = await raw(buf);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { buffer: buf, x: 0, y: 0, w, h };
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  if (nw === w && nh === h) return { buffer: buf, x: 0, y: 0, w, h };
  const cut = await sharp(buf).extract({ left: x0, top: y0, width: nw, height: nh })
    .png({ compressionLevel: 6 }).toBuffer();
  return { buffer: cut, x: x0, y: y0, w: nw, h: nh };
}

/**
 * place — положить куски на прозрачный холст.
 *
 * sharp отказывается компоновать вход, который БОЛЬШЕ холста или торчит
 * за край («Image to composite must have same dimensions or smaller»),
 * а у нас торчит почти всё: ореол солнца шире кадра, пальма выходит за
 * левый край. Поэтому каждый кусок сначала обрезается по пересечению
 * с холстом, и только потом кладётся.
 */
export async function place(w, h, pieces) {
  const comps = [];
  for (const p of pieces) {
    const px = Math.round(p.x || 0), py = Math.round(p.y || 0);
    const m = await sharp(p.buffer).metadata();
    const l = Math.max(0, -px), t = Math.max(0, -py);
    const r = Math.min(m.width, w - px), b = Math.min(m.height, h - py);
    if (r <= l || b <= t) continue;
    const buf = (l || t || r !== m.width || b !== m.height)
      ? await sharp(p.buffer).extract({ left: l, top: t, width: r - l, height: b - t })
          .png({ compressionLevel: 6 }).toBuffer()
      : p.buffer;
    comps.push({ input: buf, left: px + l, top: py + t, blend: p.blend || "over" });
  }
  const base = sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return (comps.length ? base.composite(comps) : base).png({ compressionLevel: 6 }).toBuffer();
}

/* ═══════════════════ 4. Слои из фотографий ═══════════════════════ */

/** Облака: вынуть из снимка структуру и оставить её с альфой. */
async function cloudsFrom(key, w, h, opts = {}) {
  const {
    crop = null, position = "centre", invert = false,
    lo = 0.34, hi = 0.78, gamma = 1, feather = 1.2,
    hazeAmount = 0, opacity = 1, blurPx = 0,
    gradeOpts = {}, tint = null, tintAmount = 0
  } = opts;
  let buf = await photo(key, { width: w, height: h, fit: "cover", position, crop });
  if (blurPx > 0) buf = await sharp(buf).blur(blurPx).png().toBuffer();
  buf = await grade(buf, { ...SOCHI_GRADE, ...gradeOpts });
  if (hazeAmount > 0) buf = await aerial(buf, { amount: hazeAmount, haze: HAZE, gradient: 0.3 });
  buf = await alphaFromLuma(buf, { lo, hi, invert, gamma, feather });
  if (tint && tintAmount > 0) buf = await tintLayer(buf, tint, tintAmount);
  if (opacity < 1) buf = await scaleAlpha(buf, opacity);
  return buf;
}

/** Подкрасить слой целиком (для ночи и для дальних планов). */
export async function tintLayer(buf, color, amount) {
  const { data, w, h } = await raw(buf);
  const c = hexRgb(color);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[o] = clamp255(lerp(data[o], c[0], amount));
    data[o + 1] = clamp255(lerp(data[o + 1], c[1], amount));
    data[o + 2] = clamp255(lerp(data[o + 2], c[2], amount));
  }
  return png(data, w, h);
}

/**
 * rimLight — контровой свет по кромке силуэта со стороны солнца.
 *
 * Пальма в контражуре без него — чёрное пятно-наклейка. Тонкая тёплая
 * полоса по левому краю (солнце слева) отделяет её от неба и сразу
 * поднимает восприятие качества.
 */
export async function rimLight(buf, opts = {}) {
  const { dx = -3, dy = -3, color = "#FFCE86", strength = 0.9, blur = 1.6, width = 2.2 } = opts;
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;
  const a = await sharp(buf).ensureAlpha().extractChannel(3).toColourspace("b-w").raw().toBuffer();
  // Сдвинутая копия альфы: разность даёт кромку с нужной стороны.
  const shifted = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - Math.round(dy * width)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - Math.round(dx * width)));
      shifted[y * w + x] = a[sy * w + sx];
    }
  }
  const rim = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) rim[i] = clamp255(Math.max(0, a[i] - shifted[i]) * strength);
  const rimPng = await sharp(rim, { raw: { width: w, height: h, channels: 1 } })
    .blur(Math.max(0.31, blur)).toColourspace("b-w").raw().toBuffer();

  const { data } = await raw(buf);
  const c = hexRgb(color);
  for (let i = 0; i < w * h; i++) {
    const k = (rimPng[i] / 255) * (data[i * 4 + 3] / 255);
    if (k < 0.01) continue;
    const o = i * 4;
    data[o] = clamp255(lerp(data[o], c[0], k));
    data[o + 1] = clamp255(lerp(data[o + 1], c[1], k));
    data[o + 2] = clamp255(lerp(data[o + 2], c[2], k));
  }
  return png(data, w, h);
}

/* ═══════════════════════ 5. Сборка сцены ═════════════════════════ */

/**
 * Описание слоёв: порядок по глубине, коэффициенты параллакса и тип
 * движения. Один источник правды и для сборки, и для layers.json,
 * который читает рантайм.
 *
 * parallax — доля смещения от смещения «камеры». 0 = приклеен к фону,
 * 1 = движется вместе с курсором один в один. Значения подобраны так,
 * чтобы при полном ходе камеры (±8 % ширины экрана) ни один слой не
 * вышел за оверскан 15 %.
 */
export const LAYER_SPEC = [
  { name: "sky",         z: 0,  parallax: [0.02, 0.01], motion: { type: "static" } },
  { name: "stars",       z: 1,  parallax: [0.03, 0.02], motion: { type: "twinkle", period: 4.5, amount: 0.35 }, night: true, blend: "add" },
  { name: "sun",         z: 2,  parallax: [0.05, 0.03], motion: { type: "pulse", period: 6.0, scale: 0.045, alpha: 0.14 }, day: true, blend: "add" },
  { name: "moon",        z: 2,  parallax: [0.05, 0.03], motion: { type: "pulse", period: 9.0, scale: 0.02, alpha: 0.08 }, night: true, blend: "add" },
  { name: "clouds_far",  z: 3,  parallax: [0.09, 0.04], motion: { type: "drift", speedX: 3.2, wrap: true } },
  { name: "mountains",   z: 4,  parallax: [0.14, 0.06], motion: { type: "static" } },
  { name: "clouds_near", z: 5,  parallax: [0.22, 0.09], motion: { type: "drift", speedX: 9.0, wrap: true } },
  { name: "lights",      z: 6,  parallax: [0.16, 0.07], motion: { type: "flicker", period: 3.1, amount: 0.22 }, night: true, blend: "add" },
  { name: "sea",         z: 7,  parallax: [0.30, 0.13], motion: { type: "static" } },
  { name: "sea_glitter", z: 8,  parallax: [0.30, 0.13], motion: { type: "shimmer", period: 1.7, amount: 0.45, driftX: 2.0 }, blend: "add" },
  { name: "surf",        z: 9,  parallax: [0.46, 0.20], motion: { type: "surge", period: 5.2, amountY: 9, amountAlpha: 0.25 } },
  { name: "pebbles",     z: 10, parallax: [0.62, 0.28], motion: { type: "static" } },
  { name: "palm_left",   z: 11, parallax: [0.80, 0.34], motion: { type: "sway", period: 7.4, angle: 1.5, pivot: [0.32, 1.0] } },
  { name: "palm_right",  z: 12, parallax: [0.92, 0.40], motion: { type: "sway", period: 6.1, angle: 1.9, pivot: [0.68, 1.0], phase: 0.5 } },
  { name: "vignette",    z: 13, parallax: [0, 0], motion: { type: "static" }, fixed: true }
];

/**
 * buildScene — собрать все слои одной сцены.
 * @param {"day"|"night"} variant
 * @param {"landscape"|"portrait"} orientation
 * @returns {Promise<{layers:Array, canvas:[number,number], view:[number,number], offset:[number,number]}>}
 */
export async function buildScene({ variant = "day", orientation = "landscape", log = () => {} } = {}) {
  const S = SCENE[orientation];
  const sky = SKIES[variant];
  const night = variant === "night";
  const [vw, vh] = S.view;
  const W = Math.round(vw * (1 + OVERSCAN));
  const H = Math.round(vh * (1 + OVERSCAN));
  const OX = Math.round((W - vw) / 2);
  const OY = Math.round((H - vh) / 2);

  // Все «доли экрана» переводим в пиксели ХОЛСТА один раз.
  const horizonY = OY + S.horizon * vh;
  const shoreY = OY + S.shoreline * vh;
  const sunX = OX + S.sun[0] * vw;
  const sunY = OY + S.sun[1] * vh;
  const sunR = S.sunR * vh;

  const out = {};
  const t0 = Date.now();

  /* ── 0. НЕБО ───────────────────────────────────────────────────
     Градиент в цветах темы + настоящая облачная фактура сверху.
     Чисто фотографическое небо тянет за собой чужой баланс белого;
     чистый градиент — мёртвый. Работает только сумма. */
  {
    let base = skyGradient(W, H, rampToStops(sky, horizonY / H), { dither: 1.8, seed: night ? 31 : 7 });
    base = await base;
    // Перистая фактура: снимок размывается и кладётся мягким светом.
    let tex = await photo(night ? "sky_colorful" : "sky_aerial", {
      width: W, height: Math.round(H * 0.82), fit: "cover", position: "north"
    });
    tex = await sharp(tex).blur(2.2).png().toBuffer();
    tex = await alphaFromLuma(tex, { lo: night ? 0.10 : 0.26, hi: night ? 0.42 : 0.72, gamma: 1.25, feather: 1 });
    tex = await scaleAlpha(tex, night ? 0.16 : 0.30);
    tex = await verticalFade(tex, { bottom: 0.34, top: 0.06 });
    out.sky = await sharp(base)
      .composite([{ input: tex, top: 0, left: 0, blend: "soft-light" },
                  { input: await scaleAlpha(tex, 0.55), top: 0, left: 0, blend: "over" }])
      .png({ compressionLevel: 6 }).toBuffer();
  }
  log(`   sky ${Date.now() - t0} ms`);

  /* ── 0b. ЗВЁЗДЫ (ночь) ─────────────────────────────────────── */
  if (night) {
    out.stars = await starField(W, H, { count: Math.round(W * H / 3400), maxY: 0.62, seed: 91 });
  }

  /* ── 1. СВЕТИЛО ────────────────────────────────────────────── */
  {
    // Ореол намеренно огромный (18 радиусов). Именно широкое зарево
    // на полнеба, а не сам диск, читается как «дорогой закат»: в
    // эталонах Pragmatic источник света всегда заливает половину кадра.
    const size = Math.round(sunR * (night ? 11 : 19) * 2);
    const disc = await radialGlow(size, size, {
      cx: size / 2, cy: size / 2,
      radius: night ? sunR * 0.62 : sunR,
      core: sky.sunCore, glow: sky.sunGlow,
      halo: night ? "#5A7FD0" : "#FF6A3C",
      glowScale: night ? 2.6 : 4.2, haloScale: night ? 10.4 : 18.5,
      glowOpacity: night ? 0.55 : 0.92, haloOpacity: night ? 0.22 : 0.46,
      rays: night ? 0 : 11, rayLength: 8, edge: night ? 0.05 : 0.09
    });
    out[night ? "moon" : "sun"] = await place(W, H, [
      { buffer: disc, x: sunX - size / 2, y: sunY - size / 2 }
    ]);
  }
  log(`   sun ${Date.now() - t0} ms`);

  /* ── 2. ДАЛЬНИЕ ОБЛАКА ─────────────────────────────────────
     Узкая полоса у горизонта: перистые, почти растворённые в дымке.
     Слой шире холста — он поедет вбок и не должен обрываться. */
  {
    const bandH = Math.round(vh * 0.30);
    const c = await cloudsFrom(night ? "sky_colorful" : "sky_aerial", W, bandH, {
      crop: [0.0, 0.30, 1.0, 0.42],
      lo: night ? 0.16 : 0.30, hi: night ? 0.50 : 0.72, gamma: 1.4, feather: 1.4,
      gradeOpts: night ? sky.grade : { ...SOCHI_GRADE, exposure: 1.06, saturation: 0.7 },
      hazeAmount: night ? 0 : 0.55,
      opacity: night ? 0.34 : 0.62,
      tint: night ? "#5C6FA8" : "#FFD9AE", tintAmount: night ? 0.45 : 0.35
    });
    const faded = await horizontalFade(await verticalFade(c, { top: 0.30, bottom: 0.30 }), { left: 0.06, right: 0.06 });
    out.clouds_far = await place(W, H, [{ buffer: faded, x: 0, y: horizonY - bandH * 0.86 }]);
  }

  /* ── 3. ГОРЫ: ДВА ГРЕБНЯ ───────────────────────────────────
     Кавказ. Дальний гребень почти растворён (haze 0.78), ближний —
     заметно контрастнее. Два гребня в одном слое дают внутреннюю
     глубину даже без отдельного параллакса. */
  {
    // Дальний гребень: тонкая полоса, почти растворённая в дымке.
    // Дальний гребень mtn_range: в исходнике он лежит на 0.78…0.95 кадра,
    // поэтому кроп с 0.55 оставляет модели неба честные 40 % чистого неба.
    const farH = Math.round(vh * 0.105);
    const far = await ridge("mtn_range", Math.round(W * 1.02), farH, {
      crop: [0.0, 0.55, 1.0, 0.45], sampleTop: 0.42, tol: 0.050, softness: 0.05, minRun: 5, fillFrom: 0.44,
      haze: night ? "#40376F" : "#FAD0B0", hazeAmount: night ? 0.78 : 0.70,
      grade: night ? { ...sky.grade, exposure: 0.55 } : { ...SOCHI_GRADE, exposure: 1.00, saturation: 0.52 }
    });
    // Ближний массив: Эльбрус. Он и есть «Кавказ» в кадре.
    // Вершина начинается с 0.46 исходника, кроп с 0.14 → sampleTop 0.42
    // это строки 0.14…0.44, чистое небо.
    const nearH = Math.round(vh * 0.235);
    const near = await ridge("mtn_elbrus", Math.round(W * 0.66), nearH, {
      crop: [0.10, 0.16, 0.80, 0.64], sampleTop: 0.30, tol: 0.055, softness: 0.05, minRun: 4,
      silhouetteFromBottom: true,
      haze: night ? "#332B62" : "#EC9E78", hazeAmount: night ? 0.56 : 0.34,
      grade: night ? { ...sky.grade, exposure: 0.62 } : { ...SOCHI_GRADE, exposure: 0.86, saturation: 0.80 }
    });
    out.mountains = await place(W, H, [
      { buffer: far, x: -W * 0.01, y: horizonY - farH + 4 },
      { buffer: near, x: W * 0.26, y: horizonY - nearH + 3 }
    ]);
  }
  log(`   mountains ${Date.now() - t0} ms`);

  /* ── 4. БЛИЖНИЕ ОБЛАКА ─────────────────────────────────────
     Крупные подсвеченные снизу массы в верхней трети. Берутся из
     снимка с тёмными облаками на светлом небе — кей ИНВЕРТИРОВАН. */
  {
    const bandH = Math.round(vh * 0.46);
    let c = await cloudsFrom("sky_colorful", W, bandH, {
      crop: [0.0, 0.0, 1.0, 0.55],
      invert: true, lo: night ? 0.10 : 0.20, hi: night ? 0.40 : 0.56, gamma: 0.95, feather: 1.6,
      gradeOpts: night
        ? { ...sky.grade, exposure: 0.5 }
        : { ...SOCHI_GRADE, exposure: 1.02, contrast: 1.05, saturation: 1.05, highlightAmount: 0.34 },
      opacity: night ? 0.42 : 0.78,
      tint: night ? "#2A2A5E" : "#C4547E", tintAmount: night ? 0.5 : 0.30
    });
    // Контровой свет по нижней кромке: облака подсвечены снизу солнцем.
    c = await rimLight(c, { dx: -2, dy: 3, color: night ? "#8FA8E8" : "#FFB463", strength: 1.0, width: 2.6, blur: 2.2 });
    c = await horizontalFade(await verticalFade(c, { top: 0.30, bottom: 0.30 }), { left: 0.16, right: 0.10 });
    out.clouds_near = await place(W, H, [{ buffer: c, x: 0, y: OY - vh * 0.02 }]);
  }
  log(`   clouds ${Date.now() - t0} ms`);

  /* ── 5. ОГНИ НАБЕРЕЖНОЙ (ночь) ─────────────────────────────── */
  if (night) {
    const band = Math.round(vh * 0.10);
    const l = await promenadeLights(W, band, {
      count: Math.round(W / 14), y: band * 0.55, jitter: band * 0.18,
      scale: orientation === "portrait" ? 0.8 : 1
    });
    out.lights = await place(W, H, [{ buffer: l, x: 0, y: horizonY - band * 0.5 }]);
  }

  /* ── 6. МОРЕ ───────────────────────────────────────────────
     Вода — перспективная плоскость, а не растянутый снимок.
     Рябь сходится к горизонту сама (см. perspective()). */
  {
    const seaH = Math.round(H - horizonY);
    // ВАЖЕН КРОП. sea_ripple — это кадр с ЛИНИЕЙ ГОРИЗОНТА и оранжевым
    // небом сверху; без кропа проекция кладёт это небо под ноги зрителю,
    // и вода у переднего края становится песочной. Берём только нижнюю
    // половину — чистую рябь.
    let tex = await photo("sea_ripple", {
      width: 1400, height: 900, fit: "cover", position: "centre",
      crop: [0.02, 0.50, 0.96, 0.50]
    });
    tex = await grade(tex, {
      ...(night ? sky.grade : SOCHI_GRADE),
      shadows: sky.seaTint.shadows, highlights: sky.seaTint.highlights,
      contrast: night ? 1.04 : 1.12, saturation: night ? 0.68 : 1.22,
      shadowAmount: night ? 0.46 : 0.26, highlightAmount: night ? 0.22 : 0.28,
      exposure: night ? 0.58 : 1.02
    });
    // tileV=4.6, а не 0.85. Формально повторов текстуры по глубине
    // должно быть много — но 21 повтор даёт видимую полосатость, а не
    // рябь. Четыре с половиной повтора на всю толщу воды + depthBlur
    // читаются как настоящая вода.
    let sea = await perspective(tex, W, seaH, {
      e: 0.055, tileV: 4.6, tileU: orientation === "portrait" ? 1.7 : 1.15,
      // Цвет дымки на горизонте ОБЯЗАН совпадать с нижней ступенью
      // градиента неба (#FFEBBE), иначе по линии горизонта идёт
      // отчётливая цветная полоса — вода «отклеивается» от неба.
      haze: night ? "#312A63" : "#FFE3B6",
      hazeAmount: night ? 0.72 : 0.95, hazePower: 2.6,
      darkenNear: night ? 0.30 : 0.18
    });
    sea = await depthBlur(sea, { max: 9, power: 2.2 });
    // Первые проценты высоты растворяем: горизонт должен рождаться из
    // дымки, а не из обрезанного края текстуры.
    sea = await verticalFade(sea, { top: 0.030 });
    out.sea = await place(W, H, [{ buffer: sea, x: 0, y: horizonY }]);
  }
  log(`   sea ${Date.now() - t0} ms`);

  /* ── 7. БЛИКОВАЯ ДОРОЖКА ───────────────────────────────────── */
  {
    const seaH = Math.round(H - horizonY);
    let gl = await sunPath(W, seaH, {
      cx: sunX, width: vw * (orientation === "portrait" ? 0.045 : 0.055), spread: orientation === "portrait" ? 5.0 : 7.5,
      color: night ? "#CFE2FF" : "#FFE4A0", hot: "#FFFFFF",
      density: night ? 0.4 : 0.72, opacity: night ? 0.5 : 0.95,
      e: 0.055, seed: night ? 77 : 23, fadeTop: 0.015
    });
    // Лёгкое размытие + ореол: чистые штрихи выглядят вырубленными,
    // а у воды вокруг каждого блика всегда есть свечение.
    const halo = await scaleAlpha(await sharp(gl).blur(9).png().toBuffer(), 0.55);
    gl = await sharp(await sharp(gl).blur(0.9).png().toBuffer())
      .composite([{ input: halo, blend: "over" }]).png({ compressionLevel: 6 }).toBuffer();
    out.sea_glitter = await place(W, H, [{ buffer: gl, x: 0, y: horizonY }]);
  }

  /* ── 8. ПРИБОЙ ─────────────────────────────────────────────
     Пена по линии берега: две гряды, чтобы читалось движение волны. */
  {
    const surfH = Math.round(vh * 0.14);
    let foam = await photo("pebble_wash", {
      width: Math.round(W * 1.1), height: Math.round(surfH * 2.2),
      fit: "cover", position: "centre", crop: [0.0, 0.42, 1.0, 0.26]
    });
    foam = await grade(foam, night
      ? { ...sky.grade, exposure: 0.72 }
      : { ...SOCHI_GRADE, exposure: 1.05, saturation: 0.9, highlightAmount: 0.34 });
    foam = await alphaFromLuma(foam, { lo: night ? 0.48 : 0.56, hi: night ? 0.80 : 0.88, gamma: 1.15, feather: 1.4 });
    foam = await horizontalFade(await verticalFade(foam, { top: 0.16, bottom: 0.22 }), { left: 0.04, right: 0.04 });

    const back = await scaleAlpha(await sharp(foam).resize(W, Math.round(surfH * 0.42), { fit: "fill" }).png().toBuffer(), 0.30);
    const front = await scaleAlpha(
      await sharp(foam).resize(Math.round(W * 1.06), Math.round(surfH * 0.72), { fit: "fill" }).png().toBuffer(), 0.80);
    out.surf = await place(W, H, [
      { buffer: back, x: 0, y: shoreY - surfH * 0.92 },
      { buffer: front, x: -W * 0.03, y: shoreY - surfH * 0.58 }
    ]);
  }
  log(`   surf ${Date.now() - t0} ms`);

  /* ── 9. ГАЛЬКА ─────────────────────────────────────────────
     Передний план. НЕ обесцвечивается и НЕ высветляется — он должен
     быть самым контрастным и тёмным кадром сцены, иначе глубина
     выворачивается наизнанку. */
  {
    // Галька — перспективная плоскость из снимка ВИДА СВЕРХУ.
    //
    // Ключ к тому, чтобы камни не расплылись в блины, — согласование
    // tileU и tileV. Анизотропия выборки у нижней кромки равна
    //     (s.h/tileV)/(1+e)/h  ÷  s.w/(w·tileU),
    // и при tileV 2.2 она доходила до 4:1. tileV 5.0 при tileU 2.0
    // выводит её примерно к 1.5:1 — камни остаются камнями, а сходимость
    // к горизонту сохраняется. Проверено сравнением трёх вариантов
    // (tools/assets/probe/_peb.png).
    const pebH = Math.round(H - shoreY + vh * 0.03);
    let peb = await photo("pebble_round", { width: 1200, height: 900, fit: "cover" });
    // Передний план — почти контражур. В эталонах Pragmatic низ кадра
    // всегда самый тёмный: это и создаёт «коробку» сцены, и заодно
    // прощает текстуре недостаток резкости.
    peb = await grade(peb, night
      ? { ...sky.grade, exposure: 0.40, saturation: 0.44, contrast: 1.18 }
      : { ...SOCHI_GRADE, exposure: 0.38, contrast: 1.30, saturation: 0.95,
          shadows: "#150726", shadowAmount: 0.52, highlights: "#FFA85A", highlightAmount: 0.30,
          temperature: 0.20 });
    peb = await perspective(peb, W, pebH, {
      e: 0.30, tileV: 5.0, tileU: 2.0,
      haze: night ? "#241E4C" : "#E9A87F",
      hazeAmount: night ? 0.40 : 0.44, hazePower: 2.0,
      darkenNear: night ? 0.50 : 0.44, seed: 41
    });
    peb = await depthBlur(peb, { max: 5, power: 3.0 });
    // Верхняя кромка растворяется: там она встречается с прибоем,
    // и жёсткий стык двух фотографий выдал бы монтаж.
    peb = await verticalFade(peb, { top: 0.24 });
    out.pebbles = await place(W, H, [{ buffer: peb, x: 0, y: shoreY - vh * 0.03 }]);
  }
  log(`   pebbles ${Date.now() - t0} ms`);

  /* ── 10. ПАЛЬМЫ ────────────────────────────────────────────
     Кей по ровному небу закатного снимка. Контровик по кромке со
     стороны солнца обязателен: без него силуэт читается наклейкой. */
  {
    // palm_sunset: одинокая пальма в контражуре. Небо — плавный градиент
    // от синего зенита (яркость 0.33) к оранжевому горизонту (0.68),
    // сама пальма 0.03…0.11. Порог 0.13…0.26 разводит их с запасом.
    // Кроп обрезан по 0.94, чтобы не втащить тёмную полосу земли.
    // Кроп ОБЯЗАН вмещать крону целиком. При [0.26…0.76] крона упиралась
    // в правый край кадра и превращалась в сплошной чёрный прямоугольник
    // на треть экрана — самый заметный дефект первых прогонов.
    let left = await palmSilhouette("palm_sunset", Math.round(vw * S.palmLeftW), {
      threshold: 0.195, softness: 0.065, crop: [0.14, 0.03, 0.82, 0.91],
      night, sky
    });
    left = await rimLight(left, {
      dx: -3, dy: -2, color: night ? "#9FBEFF" : "#FFD08A",
      strength: night ? 0.85 : 1.0, width: 2.0, blur: 1.3
    });
    // Внутренняя кромка кулисы растворяется: кроп режет крону по прямой,
    // и без растворения по краю кадра идёт вертикальная линейка.
    left = await horizontalFade(left, { right: 0.07 });
    const lm = await sharp(left).metadata();
    out.palm_left = await place(W, H, [
      { buffer: left, x: OX - lm.width * (orientation === "portrait" ? 0.56 : 0.46), y: H - lm.height + vh * 0.02 }
    ]);

    // palm_ocean: группа пальм на розовом небе. Кроп кончается на 0.86 —
    // ниже начинается тёмная полоса океана, которая иначе уехала бы
    // в силуэт прямоугольником.
    // Крупная группа пальм в palm_ocean стоит СЛЕВА кадра; правый край —
    // мелочь у горизонта. Берём левую группу и зеркалим: наклон стволов
    // разворачивается к центру сцены, как и должен на правой кулисе.
    let right = await palmSilhouette("palm_ocean", Math.round(vw * S.palmRightW), {
      threshold: 0.40, softness: 0.13, crop: [0.02, 0.02, 0.34, 0.80],
      night, sky, flip: true
    });
    right = await rimLight(right, {
      dx: -3, dy: -2, color: night ? "#9FBEFF" : "#FFC878",
      strength: night ? 0.8 : 0.95, width: 2.0, blur: 1.3
    });
    right = await horizontalFade(right, { left: 0.16 });
    const rm = await sharp(right).metadata();
    out.palm_right = await place(W, H, [
      { buffer: right, x: W - rm.width * (orientation === "portrait" ? 0.62 : 0.72), y: H - rm.height + vh * 0.02 }
    ]);
  }
  log(`   palms ${Date.now() - t0} ms`);

  /* ── 11. ВИНЬЕТКА ──────────────────────────────────────────
     Ровно по экрану, без оверскана: она не двигается. */
  out.vignette = await vignetteLayer(vw, vh, {
    sun: S.sun, strength: night ? 0.74 : 0.60,
    radius: 0.52, softness: 0.62,
    color: night ? "#03020C" : "#150627",
    warm: night ? "#4E6BC8" : "#FF9A4A",
    warmth: night ? 0.07 : 0.15,
    aspect: orientation === "portrait" ? 0.72 : 1.4,
    bottomShade: night ? 0.34 : 0.30,
    bottomStart: orientation === "portrait" ? 0.70 : 0.62
  });

  /* ── сборка результата ─────────────────────────────────────── */
  const layers = [];
  for (const spec of LAYER_SPEC) {
    if (spec.day && night) continue;
    if (spec.night && !night) continue;
    const buf = out[spec.name];
    if (!buf) continue;
    const t = await trim(buf);
    layers.push({
      ...spec,
      buffer: t.buffer,
      x: t.x, y: t.y, w: t.w, h: t.h,
      canvas: spec.fixed ? [vw, vh] : [W, H]
    });
  }

  return { layers, canvas: [W, H], view: [vw, vh], offset: [OX, OY], horizon: horizonY, sun: [sunX, sunY] };
}

/**
 * composeScene — свести слои в один кадр размера экрана.
 *
 * Нужна и стенду, и продюсеру: из неё же получаются плоские bg_landscape
 * и bg_portrait, которые пока грузит текущий клиент. camX/camY — сдвиг
 * камеры в долях экрана; ими же проверяется, что параллакс никуда не
 * выезжает за оверскан.
 */
export async function composeScene(scene, opts = {}) {
  const { camX = 0, camY = 0, background = { r: 8, g: 3, b: 16, alpha: 255 }, format = "png", quality = 82 } = opts;
  const [vw, vh] = scene.view;
  const [ox, oy] = scene.offset;
  const pieces = scene.layers.map((l) => ({
    buffer: l.buffer,
    x: l.fixed ? l.x : -ox + l.x + camX * vw * l.parallax[0],
    y: l.fixed ? l.y : -oy + l.y + camY * vh * l.parallax[1],
    blend: l.blend === "add" ? "add" : "over"
  }));
  const flat = await place(vw, vh, pieces);
  const img = sharp({ create: { width: vw, height: vh, channels: 4, background } })
    .composite([{ input: flat, top: 0, left: 0 }]);
  return format === "webp"
    ? img.webp({ quality, effort: 6 }).toBuffer()
    : img.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * ridge — гребень гор.
 *
 * Кей строится по МОДЕЛИ неба (keyByRowModel): снег ярче неба, порог по
 * яркости его срезает, а единого «цвета неба» на градиенте не бывает.
 * fillDown закрывает дыры в снегу — гора обязана быть сплошной.
 */
async function ridge(key, w, h, opts = {}) {
  const {
    haze, hazeAmount, grade: gr, crop,
    sampleTop = 0.4, tol = 0.05, softness = 0.055, fadeSides = 0.05, minRun = 4,
    fillFrom = 0, silhouetteFromBottom = false, src = 1500
  } = opts;

  // ГРАБЛИ, стоившие двух итераций. Просить у photo() сразу полосу
  // 1369×200 нельзя: fit:"cover" доберёт кадр по ширине и выбросит
  // 73 % высоты — ровно то небо, по которому строится модель. Модель
  // получалась по вершине, fillDown заливал полкадра белым
  // прямоугольником. Поэтому: кей на кропе В ЕГО СОБСТВЕННОЙ пропорции,
  // и только потом сплющивание в полосу через fit:"fill".
  // Вертикальное сжатие тут не дефект, а приём: сплющенный гребень
  // читается как более далёкий.
  let buf = await photo(key, { width: src, crop });
  buf = await keyByRowModel(buf, {
    sampleTop, tol, softness, fillDown: true, minRun, fillFrom, silhouetteFromBottom, feather: 1.4
  });
  buf = await grade(buf, gr);
  buf = await aerial(buf, { amount: hazeAmount, haze, gradient: 0.55 });
  buf = await sharp(buf).resize(w, h, { fit: "fill", kernel: "lanczos3" }).png({ compressionLevel: 6 }).toBuffer();
  buf = await horizontalFade(buf, { left: fadeSides, right: fadeSides });
  return verticalFade(buf, { bottom: 0.10 });
}

/** Пальма: кей по яркому небу, силуэт остаётся почти чёрным. */
async function palmSilhouette(key, targetW, opts = {}) {
  const { threshold = 0.42, softness = 0.10, crop = null, night = false, sky, work = 1400, flip = false } = opts;
  // width БЕЗ height: fit:"cover" в заданный прямоугольник срезал крону
  // по краю кадра, и вместо пальмы получался чёрный прямоугольник.
  // Пропорции кропа сохраняем, финальный размер задаём по ВЫСОТЕ.
  let buf = await photo(key, { width: work, crop });
  buf = await alphaFromLuma(buf, {
    lo: threshold - softness, hi: threshold + softness, invert: true, gamma: 1.1, feather: 0.9
  });
  buf = await grade(buf, night
    ? { ...sky.grade, exposure: 0.30, saturation: 0.35 }
    : { shadows: "#2A0B45", highlights: "#FF9A55", shadowAmount: 0.45, highlightAmount: 0.30,
        exposure: 0.42, contrast: 1.18, saturation: 0.55, temperature: 0.2 });
  // Верхний угол кропа почти всегда цепляет чужое: тучу, край кадра,
  // соседнее дерево. Нижний — полосу земли с чужими деревьями.
  // Растворяем оба: ствол всё равно уйдёт под галечный план.
  buf = await verticalFade(buf, { top: 0.08, bottom: 0.05 });
  // Размер задаётся по ШИРИНЕ, а не по высоте. В портрете экран вдвое
  // уже, и пальма, посчитанная от высоты экрана, разрасталась на весь
  // кадр — сцены за ней просто не оставалось.
  const m = await sharp(buf).metadata();
  let img = sharp(buf).resize(targetW, Math.round(m.height * targetW / m.width), { kernel: "lanczos3" });
  if (flip) img = img.flop();
  return img.png({ compressionLevel: 6 }).toBuffer();
}
