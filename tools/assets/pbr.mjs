// Освещение PBR-карт из art/downloaded/textures/.
//
// Зачем модуль вообще нужен. В папке лежат не картинки материалов, а
// НАБОРЫ КАРТ: Color (альбедо), Roughness (шероховатость), NormalGL
// (микрорельеф), Metalness (металличность). Положить Color прямо в
// заливку — значит получить плоское пятно: у альбедо по определению
// нет ни бликов, ни теней, ambientCG снимает его при рассеянном свете.
// Материал появляется только когда карты сведены под КОНКРЕТНЫЙ
// источник света — тот же, что на символах и рамках (LIGHT из svg-lib).
//
// Результат — обычный PNG, который отдаётся в SVG через texturePattern()
// как data:-URI либо кладётся под маску через cutout().
//
//   import { bakeMaterial, goldTile, cutout, dataUri } from "./pbr.mjs";
//   const gold = await goldTile({ size: 512 });      // data:-URI
//   const png  = await bakeMaterial("gold_polished", { size: 1024 });

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { LIGHT } from "./svg-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
export const TEX_DIR = path.join(ROOT, "art/downloaded/textures");
const CACHE = path.join(__dirname, ".cache/pbr");

/* ─────────────────────────── реестр карт ────────────────────────── */

/**
 * Человеческие имена материалов → префиксы файлов ambientCG.
 * Все карты 2048², бесшовные, лицензия CC0.
 */
export const TEXTURES = {
  gold_polished: { prefix: "acg_Metal048A", metal: true },
  gold_hammered: { prefix: "acg_Metal042A", metal: true },
  gold_worn:     { prefix: "acg_Metal034",  metal: true },
  steel_brushed: { prefix: "acg_Metal009",  metal: true },
  wood_dark:     { prefix: "acg_Wood027",   metal: false },
  wood_walnut:   { prefix: "acg_Wood051",   metal: false },
  marble_white:  { prefix: "acg_Marble012", metal: false },
  marble_grey:   { prefix: "acg_Marble016", metal: false },
  onyx:          { prefix: "acg_Onyx013",   metal: false },
  fabric:        { prefix: "acg_Fabric030", metal: false },
  leather:       { prefix: "acg_Leather026", metal: false }
};

export function listMaterials() {
  return Object.keys(TEXTURES);
}

/* ─────────────────────── цветовые пространства ──────────────────── */

// Свести карты можно и в sRGB, но тогда тени уходят в грязь, а блики
// выжигаются: умножать и складывать яркости корректно только в линейном
// пространстве. Таблицы на 256 значений дешевле, чем Math.pow на пиксель.
const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linToSrgb(v) {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return c * 255;
}

/* ───────────────────────── загрузка карт ────────────────────────── */

async function exists(f) {
  try { await fs.access(f); return true; } catch { return false; }
}

async function readMap(prefix, kind, size) {
  const file = path.join(TEX_DIR, `${prefix}_2K_${kind}.jpg`);
  if (!(await exists(file))) return null;
  const { data, info } = await sharp(file)
    .resize(size, size, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

/**
 * loadMaps(material, {size}) — сырые карты материала.
 * @returns {Promise<{color,roughness,normal,metalness,size}>}
 *          каждая карта — {data:Buffer, w, h, ch} либо null, если её нет
 */
export async function loadMaps(material, { size = 512 } = {}) {
  const def = TEXTURES[material];
  if (!def) throw new Error(`Неизвестный материал "${material}". Есть: ${listMaterials().join(", ")}`);
  const [color, roughness, normal, metalness] = await Promise.all([
    readMap(def.prefix, "Color", size),
    readMap(def.prefix, "Roughness", size),
    readMap(def.prefix, "NormalGL", size),
    readMap(def.prefix, "Metalness", size)
  ]);
  if (!color) throw new Error(`Нет карты Color для ${material} (${def.prefix})`);
  return { color, roughness, normal, metalness, size, isMetal: def.metal };
}

/* ─────────────────────────── освещение ──────────────────────────── */

/** Направление «на источник» в экранных координатах (Y вниз). */
export function lightVector(light = LIGHT) {
  const a = (light.azimuth * Math.PI) / 180;
  const e = (light.elevation * Math.PI) / 180;
  return { x: Math.cos(a) * Math.cos(e), y: Math.sin(a) * Math.cos(e), z: Math.sin(e) };
}

/**
 * Окружение, которое отражает металл.
 *
 * Без него полированное золото под ОДНИМ направленным источником
 * получается ровной горчичной заливкой — и это физически верно:
 * плоская зеркальная поверхность отражает не лампу, а всю сцену.
 * Золотым золото делают отражения: раскалённый горизонт, тёплое небо
 * сверху и тёмная земля снизу. Поэтому к Ламберту с Блинном добавлен
 * трёхзонный «кубмап» — он и даёт материалу диапазон от почти белого
 * блика до глубокой коричневой тени.
 *
 * Гамма подобрана под черноморский закат, тот же, что на фонах.
 */
export const ENV_SUNSET = Object.freeze({
  sky: "#FFC98A",      // тёплое небо над головой
  horizon: "#FFF6DE",  // раскалённая полоса солнца
  ground: "#2A1024"    // тёмный лиловый низ сцены
});

export const ENV_NEUTRAL = Object.freeze({
  sky: "#BFD8F0", horizon: "#FFFFFF", ground: "#20242C"
});

/**
 * bakeMaterial(material, opts) — свести карты в одну освещённую текстуру.
 *
 * Модель: Ламберт + Блинн-Фонг с металлическим/диэлектрическим
 * разделением и приближением Френеля. Этого достаточно: текстура идёт
 * фоном под фаску, а форму объекта всё равно лепит SVG-фильтр.
 *
 * @param {string} material            ключ из TEXTURES
 * @param {object} opts
 * @param {number} opts.size           сторона результата, px (по умолчанию 512)
 * @param {object} opts.light          источник света; по умолчанию общий LIGHT
 * @param {number} opts.ambient        заполняющий свет 0..1 (0.28)
 * @param {number} opts.exposure       общая экспозиция (1.0)
 * @param {number} opts.specStrength   множитель зеркальной составляющей (1.0)
 * @param {number} opts.roughnessBias  сдвиг шероховатости, − делает глянцевее
 * @param {number} opts.normalStrength усиление микрорельефа (1.0)
 * @param {string} opts.tint           hex-подкраска альбедо ("#F7C948")
 * @param {number} opts.tintAmount     доля подкраски 0..1
 * @param {number} opts.saturation     насыщенность результата (1.0)
 * @param {string} opts.rimColor       цвет холодной подсветки с теневой стороны
 * @param {number} opts.rim            сила этой подсветки 0..1
 * @param {object} opts.env            окружение {sky, horizon, ground} — hex
 * @param {number} opts.envStrength    сила отражения окружения (0.85)
 * @param {boolean} opts.cache         кешировать результат (по умолчанию да)
 * @returns {Promise<Buffer>} PNG
 */
export async function bakeMaterial(material, opts = {}) {
  const {
    size = 512,
    light = LIGHT,
    ambient = 0.28,
    exposure = 1.0,
    specStrength = 1.0,
    roughnessBias = 0,
    normalStrength = 1.0,
    tint = null,
    tintAmount = 0.5,
    saturation = 1.0,
    rimColor = "#7FD8F0",
    rim = 0.0,
    env = ENV_SUNSET,
    envStrength = 0.85,
    cache = true
  } = opts;

  const key = crypto.createHash("sha1")
    .update(JSON.stringify([material, size, light, ambient, exposure, specStrength,
      roughnessBias, normalStrength, tint, tintAmount, saturation, rimColor, rim,
      env, envStrength]))
    .digest("hex").slice(0, 16);
  const cacheFile = path.join(CACHE, `${material}-${key}.png`);
  if (cache && await exists(cacheFile)) return fs.readFile(cacheFile);

  const maps = await loadMaps(material, { size });
  const L = lightVector(light);
  // Половинный вектор для Блинна: камера смотрит по +Z.
  const hx = L.x, hy = L.y, hz = L.z + 1;
  const hl = Math.hypot(hx, hy, hz) || 1;
  const H = { x: hx / hl, y: hy / hl, z: hz / hl };

  const tintRgb = tint ? hexRgbLin(tint) : null;
  const rimRgb = hexRgbLin(rimColor);
  const envSky = hexRgbLin(env.sky);
  const envHor = hexRgbLin(env.horizon);
  const envGnd = hexRgbLin(env.ground);

  // Отражение направления взгляда в трёхзонное окружение.
  // ry < 0 — луч уходит вверх экрана (небо), ry > 0 — вниз (земля).
  const sampleEnv = (ry, out) => {
    const t = Math.max(-1, Math.min(1, ry));
    if (t < 0) {
      const k = -t;                      // 0 у горизонта → 1 в зените
      out[0] = envHor[0] + (envSky[0] - envHor[0]) * k;
      out[1] = envHor[1] + (envSky[1] - envHor[1]) * k;
      out[2] = envHor[2] + (envSky[2] - envHor[2]) * k;
    } else {
      out[0] = envHor[0] + (envGnd[0] - envHor[0]) * t;
      out[1] = envHor[1] + (envGnd[1] - envHor[1]) * t;
      out[2] = envHor[2] + (envGnd[2] - envHor[2]) * t;
    }
  };
  const envC = [0, 0, 0];

  const n = size * size;
  const out = Buffer.alloc(n * 4);
  const C = maps.color.data, Cch = maps.color.ch;
  const R = maps.roughness?.data, Rch = maps.roughness?.ch ?? 3;
  const N = maps.normal?.data, Nch = maps.normal?.ch ?? 3;
  const M = maps.metalness?.data, Mch = maps.metalness?.ch ?? 3;

  for (let i = 0; i < n; i++) {
    // альбедо в линейном пространстве
    let ar = SRGB_TO_LIN[C[i * Cch]];
    let ag = SRGB_TO_LIN[C[i * Cch + 1]];
    let ab = SRGB_TO_LIN[C[i * Cch + 2]];

    if (tintRgb) {
      ar += (tintRgb[0] - ar) * tintAmount;
      ag += (tintRgb[1] - ag) * tintAmount;
      ab += (tintRgb[2] - ab) * tintAmount;
    }

    // Шероховатость и металличность — линейные данные, гамма к ним не применяется.
    let rough = R ? R[i * Rch] / 255 : 0.5;
    rough = Math.min(1, Math.max(0.03, rough + roughnessBias));
    const metal = M ? M[i * Mch] / 255 : (maps.isMetal ? 1 : 0);

    // нормаль: NormalGL — Y вверх, экран — Y вниз
    let nx = 0, ny = 0, nz = 1;
    if (N) {
      nx = (N[i * Nch] / 127.5 - 1) * normalStrength;
      ny = -(N[i * Nch + 1] / 127.5 - 1) * normalStrength;
      nz = N[i * Nch + 2] / 127.5 - 1;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
    }

    const ndl = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
    const ndh = Math.max(0, nx * H.x + ny * H.y + nz * H.z);
    const ndv = Math.max(0, nz);

    // Блинн-Фонг: показатель выводится из шероховатости.
    const shin = 2 / (rough * rough * rough * rough + 1e-4) - 2;
    const spec = Math.pow(ndh, Math.min(2048, shin)) * (shin + 8) / 25.13 * ndl;

    // Френель Шлика: у краёв бликует всё, даже дерево.
    const f0 = 0.04 + 0.96 * metal;
    const fres = f0 + (1 - f0) * Math.pow(1 - ndv, 5);
    const sK = spec * fres * specStrength;

    // У металла зеркальный отблик красится альбедо, у диэлектрика — белый.
    const sr = (metal ? ar : 1) * sK;
    const sg = (metal ? ag : 1) * sK;
    const sb = (metal ? ab : 1) * sK;

    // Отражение окружения. У металла это ОСНОВНОЙ источник цвета:
    // золото без него — ровная горчица.
    // Шероховатость размывает отражение — тянем его к горизонту.
    const ry = (2 * nz * ny) * (1 - rough * 0.75);
    sampleEnv(ry, envC);
    const eK = fres * envStrength * (1 - rough * 0.55);
    const er = (metal ? ar : 1) * envC[0] * eK;
    const eg = (metal ? ag : 1) * envC[1] * eK;
    const eb = (metal ? ab : 1) * envC[2] * eK;

    // Металл не имеет диффузной составляющей.
    const kd = 1 - metal;
    let r = ar * (ambient + ndl * kd) + sr + er;
    let g = ag * (ambient + ndl * kd) + sg + eg;
    let b = ab * (ambient + ndl * kd) + sb + eb;

    if (rim > 0) {
      // Холодная подсветка с теневой стороны — приём предметной съёмки:
      // она отрывает материал от фона, не трогая ключевой свет.
      const back = Math.max(0, -(nx * L.x + ny * L.y)) * (1 - ndl);
      r += rimRgb[0] * back * rim;
      g += rimRgb[1] * back * rim;
      b += rimRgb[2] * back * rim;
    }

    r *= exposure; g *= exposure; b *= exposure;

    if (saturation !== 1) {
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = lum + (r - lum) * saturation;
      g = lum + (g - lum) * saturation;
      b = lum + (b - lum) * saturation;
    }

    const o = i * 4;
    out[o] = linToSrgb(r);
    out[o + 1] = linToSrgb(g);
    out[o + 2] = linToSrgb(b);
    out[o + 3] = 255;
  }

  const png = await sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  if (cache) {
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(cacheFile, png);
  }
  return png;
}

function hexRgbLin(hex) {
  const h = hex.replace("#", "");
  return [
    SRGB_TO_LIN[parseInt(h.slice(0, 2), 16)],
    SRGB_TO_LIN[parseInt(h.slice(2, 4), 16)],
    SRGB_TO_LIN[parseInt(h.slice(4, 6), 16)]
  ];
}

/* ──────────────────────── работа с результатом ──────────────────── */

/**
 * detailMap(png, opts) — карта микроструктуры вместо цветного материала.
 *
 * Зачем. Заливать форму цветной фотографией золота — тупик: макро-тон
 * (где светло, где темно) обязан задаваться формой предмета и общим
 * светом, а не случайным местом плитки. Поэтому материал разделяется:
 * ЦВЕТ приходит градиентом или feDiffuseLighting, а от текстуры берётся
 * только МИКРОРЕЛЬЕФ — обесцвеченный и центрированный на 0.5, чтобы
 * лечь режимом overlay и ничего не сдвинуть по тону.
 *
 * @param {Buffer} png
 * @param {number} opts.amount     контраст детали 0..1 (0.5)
 * @param {number} opts.saturation остаток цветности (0.12)
 */
export async function detailMap(png, { amount = 0.5, saturation = 0.12 } = {}) {
  const { data, info } = await sharp(png).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += data[i * 3] * 0.2126 + data[i * 3 + 1] * 0.7152 + data[i * 3 + 2] * 0.0722;
  }
  mean /= n;
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
    // Отклонение от среднего → серый вокруг 128.
    const d = (lum - mean) * amount + 128;
    out[i * 3] = clamp255(d + (r - lum) * saturation);
    out[i * 3 + 1] = clamp255(d + (g - lum) * saturation);
    out[i * 3 + 2] = clamp255(d + (b - lum) * saturation);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png({ compressionLevel: 9 }).toBuffer();
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** detail(preset, opts) — сразу карта микроструктуры пресета. */
export async function detail(preset, opts = {}) {
  const { amount, saturation, ...rest } = opts;
  return detailMap(await material(preset, rest), { amount, saturation });
}

/** detailUri(preset, opts) — то же, data:-URI под feImage. */
export async function detailUri(preset, opts = {}) {
  return dataUri(await detail(preset, opts));
}

/** dataUri(png) — вставка растра прямо в SVG (страница растеризатора не
 *  имеет базового пути, ссылки на файлы в ней не резолвятся). */
export function dataUri(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * tileTexture(png, w, h, opts) — размножить бесшовную плитку до размера.
 * Материалы ambientCG бесшовные, поэтому это просто повтор.
 */
export async function tileTexture(png, w, h, { scale = 1, offsetX = 0, offsetY = 0 } = {}) {
  const meta = await sharp(png).metadata();
  const ts = Math.max(2, Math.round(meta.width * scale));
  const tile = scale === 1 ? png : await sharp(png).resize(ts, ts).png().toBuffer();
  const composites = [];
  for (let y = -1; y * ts < h + ts; y++) {
    for (let x = -1; x * ts < w + ts; x++) {
      composites.push({ input: tile, left: x * ts + (offsetX % ts), top: y * ts + (offsetY % ts) });
    }
  }
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * cutout(texturePng, maskPng, opts) — вырезать материал по трафарету.
 *
 * Главный способ применить PBR к готовой форме: маска — любой чёрно-белый
 * силуэт (в том числе fantasy-рамка из art/downloaded/ui или отрисованный
 * SVG), альфа результата берётся из её яркости или собственной альфы.
 *
 * @param {Buffer} texturePng  освещённый материал
 * @param {Buffer} maskPng     трафарет
 * @param {object} opts
 * @param {"alpha"|"luma"} opts.channel  откуда брать форму (по умолчанию alpha)
 * @param {boolean} opts.invert
 * @param {number} opts.feather          размытие края, px
 */
export async function cutout(texturePng, maskPng, opts = {}) {
  const { channel = "alpha", invert = false, feather = 0 } = opts;
  const mMeta = await sharp(maskPng).metadata();
  const w = mMeta.width, h = mMeta.height;

  let alpha;
  if (channel === "luma") {
    alpha = await sharp(maskPng).removeAlpha().greyscale()
      .toColourspace("b-w").raw().toBuffer();
  } else {
    alpha = await sharp(maskPng).ensureAlpha().extractChannel(3)
      .toColourspace("b-w").raw().toBuffer();
  }
  if (invert) for (let i = 0; i < alpha.length; i++) alpha[i] = 255 - alpha[i];

  // toColourspace("b-w") обязателен: .blur() над сырым одноканальным
  // буфером возвращает ТРИ канала, и joinChannel читает альфу с втрое
  // меньшим шагом — картинка покрывается чересстрочной «расчёской».
  let a = alpha;
  if (feather > 0) {
    a = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
      .blur(feather).toColourspace("b-w").raw().toBuffer();
  }

  // joinChannel, а НЕ composite/dest-in: dest-in смотрит на альфу
  // входящей картинки, а у серого трафарета она сплошная — вырезание
  // молча не срабатывает и материал остаётся прямоугольником.
  const tex = await tileTexture(texturePng, w, h);
  const rgb = await sharp(tex).removeAlpha().toColourspace("srgb").raw().toBuffer();
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(a, { raw: { width: w, height: h, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * heightToNormal(greyPng, strength) — карта нормалей из карты высот.
 * Нужна, когда рельеф задан рисунком (гравировка, резьба), а готовой
 * NormalGL под него нет.
 */
export async function heightToNormal(greyPng, strength = 2.0) {
  const { data, info } = await sharp(greyPng).removeAlpha().greyscale()
    .raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const out = Buffer.alloc(w * h * 3);
  const at = (x, y) => data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1; // ny положителен вверх — конвенция GL
      const l = Math.hypot(nx, ny, nz);
      const o = (y * w + x) * 3;
      out[o] = ((nx / l) * 0.5 + 0.5) * 255;
      out[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      out[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/* ──────────────────── готовые материалы темы ────────────────────── */

// Пресеты под палитру «Sochi Sunset»: подкраска в тёплое золото заката
// и одинаковые параметры света на всех поверхностях игры.

const PRESETS = {
  gold:   { material: "gold_polished", tint: "#F7C948", tintAmount: 0.55, ambient: 0.30,
            exposure: 1.12, specStrength: 1.25, roughnessBias: -0.12, rim: 0.18 },
  goldOld:{ material: "gold_worn",     tint: "#C98F2A", tintAmount: 0.45, ambient: 0.26,
            exposure: 1.02, specStrength: 1.0,  roughnessBias: 0, rim: 0.15 },
  brass:  { material: "gold_hammered", tint: "#E0A32A", tintAmount: 0.5,  ambient: 0.28,
            exposure: 1.05, specStrength: 1.1,  roughnessBias: -0.05, rim: 0.16 },
  steel:  { material: "steel_brushed", tint: "#C3CEE0", tintAmount: 0.35, ambient: 0.30,
            exposure: 1.0,  specStrength: 1.15, roughnessBias: -0.08, rim: 0.2 },
  wood:   { material: "wood_dark",     tint: "#6B4423", tintAmount: 0.25, ambient: 0.26,
            exposure: 1.05, specStrength: 0.55, roughnessBias: 0.05, rim: 0.12 },
  walnut: { material: "wood_walnut",   tint: "#7A4A26", tintAmount: 0.22, ambient: 0.26,
            exposure: 1.05, specStrength: 0.6,  roughnessBias: 0.05, rim: 0.12 },
  marble: { material: "marble_white",  tint: "#F0D9A8", tintAmount: 0.18, ambient: 0.34,
            exposure: 1.06, specStrength: 0.8,  roughnessBias: -0.05, rim: 0.14 },
  onyx:   { material: "onyx",          tint: "#1A0730", tintAmount: 0.35, ambient: 0.20,
            exposure: 0.95, specStrength: 1.2,  roughnessBias: -0.15, rim: 0.22 },
  leather:{ material: "leather",       tint: "#4A2A18", tintAmount: 0.28, ambient: 0.24,
            exposure: 1.0,  specStrength: 0.4,  roughnessBias: 0.08, rim: 0.1 },
  fabric: { material: "fabric",        tint: "#2A0B45", tintAmount: 0.3,  ambient: 0.26,
            exposure: 1.0,  specStrength: 0.25, roughnessBias: 0.1,  rim: 0.1 }
};

export function listPresets() { return Object.keys(PRESETS); }

/**
 * material(preset, opts) — освещённый PNG по пресету темы.
 * Любой параметр bakeMaterial можно переопределить через opts.
 */
export async function material(preset, opts = {}) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`Нет пресета "${preset}". Есть: ${listPresets().join(", ")}`);
  const { material: mat, ...rest } = p;
  return bakeMaterial(mat, { ...rest, ...opts });
}

/** materialUri(preset, opts) — то же, но сразу data:-URI для SVG. */
export async function materialUri(preset, opts = {}) {
  return dataUri(await material(preset, opts));
}

/** Короткие обёртки под самые частые случаи. */
export const goldTile = (opts = {}) => materialUri("gold", opts);
export const brassTile = (opts = {}) => materialUri("brass", opts);
export const steelTile = (opts = {}) => materialUri("steel", opts);
export const woodTile = (opts = {}) => materialUri("wood", opts);
export const marbleTile = (opts = {}) => materialUri("marble", opts);
export const onyxTile = (opts = {}) => materialUri("onyx", opts);
