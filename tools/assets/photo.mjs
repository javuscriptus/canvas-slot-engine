// Превращение фотографий из art/downloaded/backgrounds/ в слои параллакса.
//
// Задача модуля. В папке 29 фотографий 3840 px: закатное небо, море,
// Кавказ, галечный пляж, пальмы. По отдельности каждая — чужая картинка
// со своим светом, балансом белого и горизонтом. Чтобы из них собрался
// ОДИН пейзаж, нужны четыре операции, и все они здесь:
//
//   keySilhouette() — вынуть объект (гору, пальму) из ровного неба;
//   grade()         — привести цвет к палитре темы, чтобы слои не спорили;
//   aerial()        — воздушная перспектива: дальний план светлеет,
//                     обесцвечивается и уходит в цвет дымки. Без неё
//                     все планы читаются на одной глубине, и параллакс
//                     выглядит как наклейки на стекле;
//   layer()         — собрать всё вместе и отдать PNG нужного размера.
//
// Всё на sharp, без внешних бинарников.
//
//   import { photo, silhouetteLayer, skyLayer } from "./photo.mjs";
//   const sky = await skyLayer("wm_sky_Warm_sunset_sky_Unsplash", 1920, 1080);

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
export const PHOTO_DIR = path.join(ROOT, "art/downloaded/backgrounds");

/* ────────────────────────── каталог снимков ─────────────────────── */

/**
 * Осмысленные имена вместо файловых. Четыре агента следующей фазы
 * пишут `photo("sky_warm")`, а не разбирают названия из Unsplash.
 */
export const PHOTOS = {
  // небо заката
  sky_warm:      "wm_sky_Warm_sunset_sky_Unsplash.jpg",
  sky_colorful:  "wm_sky_Colorful_sky_during_sunset_Unsplash.jpg",
  sky_red:       "wm_sky_Red_sky_sunset_Unsplash.jpg",
  sky_aerial:    "wm_sky_Aerial_cloud_sunset_Unsplash.jpg",
  sky_ocean:     "wm_sky_Ocean_sunset_Unsplash.jpg",
  sky_beach:     "wm_sky_Leigh_on_Sea_beach_sunset_Unsplash.jpg",

  // закат над водой (готовый горизонт)
  sunset_black_sea: "wm_sunset_Black_Sea_Sunset_231304617_.jpeg",
  sunset_calm:      "wm_sunset_Richly_colored_sky_over_calm_sea_water_Unsplash_.jpg",
  sunset_foggy:     "wm_sunset_Cape_Town_foggy_sunset_Unsplash_.jpg",
  sunset_air:       "wm_sunset_Secretary_Kerry_s_View_From_the_Airplane_As_He_Flies_Over_the_Red_Sea_.jpg",

  // море
  sea_calm:      "wm_sea_Calm_sea_haleiwa_Unsplash.jpg",
  sea_cliff:     "wm_sea_Green_Cliff_Calm_Sea_Unsplash.jpg",
  sea_ripple:    "wm_sea_Ocean_waves_rippling_Unsplash.jpg",
  sea_spray:     "wm_sea_Sea_spray_and_waves_Unsplash.jpg",
  sea_waves:     "wm_sea_Waves_Unsplash.jpg",

  // Кавказ
  mtn_elbrus:    "wm_mtn_Elbrus_2008.jpg",
  mtn_elbrus2:   "wm_mtn_Mt_Elbrus_Caucasus_Range_2941.jpg",
  mtn_dombay:    "wm_mtn_Snow_covered_mountains_in_Dombay_Unsplash.jpg",
  mtn_range:     "wm_mtn_Snow_dusted_mountain_range_Unsplash.jpg",
  mtn_gudauri:   "wm_mtn_Snow_on_a_mountain_in_Gudauri_Unsplash.jpg",

  // пальмы
  palm_coconut:  "wm_palm_Coconut_palm_Unsplash.jpg",
  palm_ocean:    "wm_palm_Palm_trees_and_the_ocean_Unsplash.jpg",
  palm_wind:     "wm_palm_Palm_trees_wind_Unsplash.jpg",
  palm_sunset:   "wm_palm_Sunset_palm_tree_in_Goodyear_Unsplash.jpg",
  palm_tropical: "wm_palm_Tropical_palm_Unsplash.jpg",

  // галька
  pebble_wash:   "wm_beach_Ocean_washing_on_pebble_beach_Unsplash.jpg",
  pebble_deposit:"wm_beach_Pebble_deposit_at_beach_Unsplash.jpg",
  pebble_round:  "wm_beach_Round_pebble_pattern_Unsplash.jpg",
  pebble_wet:    "wm_beach_Wet_pebbles_Unsplash.jpg"
};

export function listPhotos() { return Object.keys(PHOTOS); }

export function photoPath(key) {
  const f = PHOTOS[key] || key;
  return path.isAbsolute(f) ? f : path.join(PHOTO_DIR, f);
}

/**
 * photo(key, opts) — загрузить снимок и привести к размеру.
 * @param {number} opts.width,height  целевой размер (по умолчанию как есть)
 * @param {"cover"|"contain"|"fill"} opts.fit
 * @param {string} opts.position      "north" | "centre" | "south" …
 * @param {[number,number,number,number]} opts.crop  [left,top,w,h] в долях 0..1
 */
export async function photo(key, opts = {}) {
  const { width, height, fit = "cover", position = "centre", crop = null } = opts;
  let img = sharp(photoPath(key), { limitInputPixels: false });
  if (crop) {
    const m = await img.metadata();
    img = img.extract({
      left: Math.round(crop[0] * m.width),
      top: Math.round(crop[1] * m.height),
      width: Math.max(1, Math.round(crop[2] * m.width)),
      height: Math.max(1, Math.round(crop[3] * m.height))
    });
  }
  if (width || height) img = img.resize(width, height, { fit, position, kernel: "lanczos3" });
  return img.png({ compressionLevel: 6 }).toBuffer();
}

/* ─────────────────────────── цветокоррекция ─────────────────────── */

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function hexRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * grade(buf, opts) — цветокоррекция под палитру темы.
 *
 * Работает как цветокоррекция в кино: раздельная тонировка теней и
 * светов плюс общий контраст и насыщенность. Именно раздельная —
 * если красить кадр целиком, снимок становится монохромным и мёртвым.
 * Тени уводятся в лиловый ночного неба, света — в золото заката,
 * и любые два кадра из разных источников начинают выглядеть снятыми
 * в один вечер.
 *
 * @param {Buffer} buf
 * @param {object} opts
 * @param {string} opts.shadows     цвет тонировки теней ("#2A0B45")
 * @param {string} opts.highlights  цвет тонировки светов ("#FFD9A8")
 * @param {number} opts.shadowAmount    0..1
 * @param {number} opts.highlightAmount 0..1
 * @param {number} opts.exposure    множитель яркости (1)
 * @param {number} opts.contrast    1 — без изменений
 * @param {number} opts.saturation  1 — без изменений
 * @param {number} opts.lift        подъём чёрного 0..1 (даёт «плёночный» вид)
 * @param {number} opts.temperature −1 холоднее … +1 теплее
 */
export async function grade(buf, opts = {}) {
  const {
    shadows = "#2A0B45",
    highlights = "#FFD9A8",
    shadowAmount = 0.22,
    highlightAmount = 0.18,
    exposure = 1,
    contrast = 1,
    saturation = 1,
    lift = 0,
    temperature = 0
  } = opts;

  const { data, info } = await sharp(buf).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const sh = hexRgb(shadows), hi = hexRgb(highlights);
  const n = info.width * info.height;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let r = data[o], g = data[o + 1], b = data[o + 2];

    r *= exposure; g *= exposure; b *= exposure;

    if (contrast !== 1) {
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
    }

    const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;

    // Тени и света красятся по маскам, а не по всему кадру.
    const ms = (1 - lum) * (1 - lum) * shadowAmount;
    const mh = lum * lum * highlightAmount;
    r += (sh[0] - r) * ms + (hi[0] - r) * mh;
    g += (sh[1] - g) * ms + (hi[1] - g) * mh;
    b += (sh[2] - b) * ms + (hi[2] - b) * mh;

    if (temperature !== 0) {
      r += temperature * 22;
      b -= temperature * 22;
    }

    if (saturation !== 1) {
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;
    }

    if (lift > 0) {
      const k = lift * 255;
      r = k + r * (1 - lift);
      g = k + g * (1 - lift);
      b = k + b * (1 - lift);
    }

    data[o] = clamp255(r); data[o + 1] = clamp255(g); data[o + 2] = clamp255(b);
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 6 }).toBuffer();
}

/**
 * aerial(buf, opts) — воздушная перспектива.
 *
 * Дальний план обязан быть светлее, бледнее и мягче ближнего: между
 * зрителем и горой километры воздуха, они рассеивают свет. Слой,
 * снятый в упор и просто уменьшенный, читается вплотную к зрителю
 * независимо от скорости параллакса.
 *
 * @param {number} opts.amount    0..1 — насколько далёк план
 * @param {string} opts.haze      цвет дымки (по умолчанию закатный)
 * @param {number} opts.softness  дополнительное размытие, px
 * @param {number} opts.gradient  0..1 — усиливать дымку книзу
 *                                (у горизонта воздуха больше)
 */
export async function aerial(buf, opts = {}) {
  const { amount = 0.4, haze = "#F2B79A", softness = 0, gradient = 0.5 } = opts;
  let img = sharp(buf).ensureAlpha();
  if (softness > 0) img = img.blur(softness);

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const hz = hexRgb(haze);
  const h = info.height, w = info.width;

  for (let y = 0; y < h; y++) {
    // Ближе к горизонту (низу кадра для гор) дымки больше.
    const gy = gradient > 0 ? 1 - gradient + gradient * (y / Math.max(1, h - 1)) : 1;
    const k = Math.min(1, amount * gy);
    if (k <= 0) continue;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = data[o], g = data[o + 1], b = data[o + 2];
      // Сначала обесцвечивание, потом подмешивание дымки —
      // в обратном порядке кадр уходит в грязь.
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const desat = k * 0.75;
      r = l + (r - l) * (1 - desat);
      g = l + (g - l) * (1 - desat);
      b = l + (b - l) * (1 - desat);
      data[o] = clamp255(r + (hz[0] - r) * k);
      data[o + 1] = clamp255(g + (hz[1] - g) * k);
      data[o + 2] = clamp255(b + (hz[2] - b) * k);
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 6 }).toBuffer();
}

/* ──────────────────────────── вырезание ─────────────────────────── */

/**
 * keySilhouette(buf, opts) — выделить силуэт на ровном небе.
 *
 * Кей по яркости и/или цвету: небо на закатных снимках светлее и
 * теплее объекта, поэтому порог по яркости отделяет гору или пальму
 * без ручного обтравливания. Мягкость порога (`softness`) даёт
 * полупрозрачную кромку — без неё край получается «вырезанным
 * ножницами» и сразу выдаёт монтаж.
 *
 * @param {Buffer} buf
 * @param {object} opts
 * @param {"luma"|"color"} opts.mode
 * @param {number} opts.threshold  0..1 — что считать небом
 * @param {number} opts.softness   0..1 — ширина перехода
 * @param {string} opts.keyColor   для mode:"color" — цвет неба
 * @param {number} opts.tolerance  для mode:"color" — радиус в RGB (0..1)
 * @param {boolean} opts.invert    оставить небо, а не объект
 * @param {number} opts.feather    размытие альфы, px
 * @param {boolean} opts.despill   гасить подмес цвета неба в кромке
 */
export async function keySilhouette(buf, opts = {}) {
  const {
    mode = "luma",
    threshold = 0.62,
    softness = 0.12,
    keyColor = "#FFC98A",
    tolerance = 0.28,
    invert = false,
    feather = 1.5,
    despill = true
  } = opts;

  const { data, info } = await sharp(buf).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const key = hexRgb(keyColor).map((v) => v / 255);
  const alpha = Buffer.alloc(w * h);

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
    let skyness;
    if (mode === "color") {
      const d = Math.sqrt((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2) / 1.732;
      skyness = 1 - smooth(d, tolerance, tolerance + Math.max(0.01, softness));
    } else {
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      skyness = smooth(lum, threshold - softness, threshold + softness);
    }
    let a = 1 - skyness;               // объект непрозрачен, небо прозрачно
    if (invert) a = 1 - a;
    alpha[i] = clamp255(a * 255);

    if (despill && !invert && a > 0.02 && a < 0.98) {
      // Кромка объекта тянет на себя цвет неба; чуть притемняем её,
      // иначе вокруг силуэта остаётся светлый ореол.
      const k = 1 - a;
      data[o] = clamp255(r * 255 * (1 - k * 0.35));
      data[o + 1] = clamp255(g * 255 * (1 - k * 0.35));
      data[o + 2] = clamp255(b * 255 * (1 - k * 0.35));
    }
  }

  const rgb = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .removeAlpha().png().toBuffer();
  return applyAlpha(rgb, alpha, w, h, feather);
}

function smooth(x, a, b) {
  if (b <= a) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * applyAlpha(buf, alphaBuf, w, h, feather) — приклеить готовую карту
 * прозрачности к изображению.
 *
 * ВНИМАНИЕ на грабли. Композиция `blend:"dest-in"` берёт альфу ВХОДЯЩЕЙ
 * картинки, а не её яркость. Серый PNG-трафарет непрозрачен целиком,
 * поэтому dest-in с ним не вырезает ничего — слой остаётся прямоугольным
 * и выглядит наклейкой. Правильный путь — joinChannel: одноканальный
 * буфер приклеивается четвёртым каналом напрямую.
 */
async function applyAlpha(buf, alphaBuf, w, h, feather = 0) {
  const a = feather > 0 ? await blurMask(alphaBuf, w, h, feather) : alphaBuf;
  const rgb = await sharp(buf).removeAlpha()
    .resize(w, h, { fit: "fill" }).toColourspace("srgb").raw().toBuffer();
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(a, { raw: { width: w, height: h, channels: 1 } })
    .png({ compressionLevel: 6 }).toBuffer();
}

/**
 * Размытие одноканальной маски С СОХРАНЕНИЕМ одного канала.
 *
 * Грабли sharp: `.blur()` над сырым одноканальным буфером уводит его
 * в sRGB и возвращает ТРИ канала. Если после этого объявить channels:1,
 * joinChannel читает буфер с втрое меньшим шагом — альфа съезжает и
 * картинка покрывается чересстрочной «расчёской». Ровно так и было.
 * toColourspace("b-w") фиксирует один канал на выходе.
 */
async function blurMask(mask, w, h, radius) {
  return sharp(mask, { raw: { width: w, height: h, channels: 1 } })
    .blur(radius)
    .toColourspace("b-w")
    .raw()
    .toBuffer();
}

/** Одноканальная маска из произвольной картинки (яркость либо альфа). */
async function maskChannel(src, w, h, { channel = "luma", invert = false } = {}) {
  let s = sharp(src, { density: 300 }).resize(w, h, { fit: "fill" });
  s = channel === "luma" ? s.removeAlpha().greyscale() : s.ensureAlpha().extractChannel(3);
  const raw = await s.toColourspace("b-w").raw().toBuffer();
  if (invert) for (let i = 0; i < raw.length; i++) raw[i] = 255 - raw[i];
  return raw;
}

/** scaleAlpha(buf, k) — приглушить слой целиком, сохранив его форму. */
export async function scaleAlpha(buf, k) {
  if (k >= 1) return buf;
  const { data, info } = await sharp(buf).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = clamp255(data[i] * k);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 6 }).toBuffer();
}

/**
 * cutByMask(buf, mask, opts) — вырезать слой по произвольной маске.
 * Маска — PNG или SVG-строка; форму берём из яркости или альфы.
 */
export async function cutByMask(buf, mask, opts = {}) {
  const { channel = "luma", invert = false, feather = 0, combine = true } = opts;
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;
  const src = typeof mask === "string" && mask.trim().startsWith("<")
    ? Buffer.from(mask) : mask;

  const m = await maskChannel(src, w, h, { channel, invert });
  if (combine && meta.hasAlpha) {
    // Собственная прозрачность слоя не должна пропадать под маской.
    const own = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer();
    for (let i = 0; i < m.length; i++) m[i] = (m[i] * own[i]) / 255;
  }
  return applyAlpha(buf, m, w, h, feather);
}

/**
 * fadeEdges(buf, opts) — растворить края слоя.
 * Нужно каждому слою параллакса: жёсткая граница фотографии,
 * доехав до края экрана, мгновенно выдаёт подлог.
 */
export async function fadeEdges(buf, opts = {}) {
  const { top = 0, bottom = 0, left = 0, right = 0 } = opts;
  if (!top && !bottom && !left && !right) return buf;
  const meta = await sharp(buf).metadata();
  const w = meta.width, h = meta.height;

  const own = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer();
  const a = Buffer.alloc(w * h);
  const ramp = (v, width) => (width > 0 ? smooth(v, 0, width) : 1);

  for (let y = 0; y < h; y++) {
    const fy = y / Math.max(1, h - 1);
    const kv = ramp(fy, top) * ramp(1 - fy, bottom);
    for (let x = 0; x < w; x++) {
      const fx = x / Math.max(1, w - 1);
      const kh = ramp(fx, left) * ramp(1 - fx, right);
      a[y * w + x] = clamp255(own[y * w + x] * kv * kh);
    }
  }
  return applyAlpha(buf, a, w, h, 0);
}

/* ──────────────────────── готовые слои сцены ────────────────────── */

/**
 * Общая гамма темы. Все слои проходят через неё, поэтому небо с одного
 * снимка, море с другого и горы с третьего смотрятся одним вечером.
 */
export const SOCHI_GRADE = Object.freeze({
  shadows: "#2A0B45",
  highlights: "#FFD9A8",
  shadowAmount: 0.26,
  highlightAmount: 0.20,
  contrast: 1.06,
  saturation: 1.12,
  temperature: 0.25
});

export const HAZE = "#F2B79A";

/**
 * skyLayer(key, w, h, opts) — дальний план: небо.
 * Уходит целиком, без выреза, с лёгкой дымкой книзу.
 */
export async function skyLayer(key, w, h, opts = {}) {
  const { crop = null, position = "north", aerial: a = 0.12, grade: gr = {} } = opts;
  let buf = await photo(key, { width: w, height: h, fit: "cover", position, crop });
  buf = await grade(buf, { ...SOCHI_GRADE, ...gr });
  if (a > 0) buf = await aerial(buf, { amount: a, haze: HAZE, gradient: 0.85 });
  return buf;
}

/**
 * silhouetteLayer(key, w, h, opts) — средний план: горы или пальмы,
 * вырезанные из неба и отодвинутые вглубь воздушной перспективой.
 */
export async function silhouetteLayer(key, w, h, opts = {}) {
  const {
    crop = null, position = "centre",
    key: keyOpts = {}, aerial: aerialOpts = {}, grade: gr = {},
    fade = null
  } = opts;
  let buf = await photo(key, { width: w, height: h, fit: "cover", position, crop });
  buf = await keySilhouette(buf, keyOpts);
  buf = await grade(buf, { ...SOCHI_GRADE, ...gr });
  buf = await aerial(buf, { amount: 0.35, haze: HAZE, gradient: 0.6, ...aerialOpts });
  if (fade) buf = await fadeEdges(buf, fade);
  return buf;
}

/**
 * seaLayer(key, w, h, opts) — ближний план: вода.
 * Ближний план НЕ обесцвечивается: он должен быть самым контрастным
 * и насыщенным кадром сцены, иначе глубина выворачивается наизнанку.
 */
export async function seaLayer(key, w, h, opts = {}) {
  const { crop = null, position = "south", grade: gr = {}, fade = null } = opts;
  let buf = await photo(key, { width: w, height: h, fit: "cover", position, crop });
  buf = await grade(buf, {
    ...SOCHI_GRADE, contrast: 1.12, saturation: 1.2, highlightAmount: 0.24, ...gr
  });
  if (fade) buf = await fadeEdges(buf, fade);
  return buf;
}

/**
 * compose(w, h, layers, opts) — свести слои в один кадр.
 * @param {Array<{buffer:Buffer, x?:number, y?:number, opacity?:number, blend?:string}>} layers
 */
export async function compose(w, h, layers, opts = {}) {
  const { background = { r: 11, g: 4, b: 19, alpha: 255 }, format = "png", quality = 84 } = opts;
  const composites = [];
  for (const l of layers) {
    let input = l.buffer;
    if (l.opacity !== undefined && l.opacity < 1) input = await scaleAlpha(input, l.opacity);
    composites.push({ input, left: Math.round(l.x || 0), top: Math.round(l.y || 0), blend: l.blend || "over" });
  }
  const img = sharp({ create: { width: w, height: h, channels: 4, background } })
    .composite(composites);
  return format === "webp"
    ? img.webp({ quality, effort: 6 }).toBuffer()
    : img.png({ compressionLevel: 9 }).toBuffer();
}

/** save(buf, file) — записать слой, создав папку. */
export async function save(buf, file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return file;
}
