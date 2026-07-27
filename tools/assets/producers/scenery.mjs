// Производитель семейства «пейзаж»: МНОГОСЛОЙНЫЙ ЖИВОЙ ФОН.
//
//   node tools/assets/build.mjs --only scenery
//
// Что кладётся в client/assets:
//
//   img/layers/<вариант>_<ориентация>_<слой>.webp   14–15 слоёв × 4 сцены
//   img/layers/layers.json                          геометрия, параллакс,
//                                                   типы движения — всё,
//                                                   что нужно рантайму
//   img/bg_landscape.webp и ещё три                 плоская сводка тех же
//                                                   слоёв: старый клиент
//                                                   грузит их по именам
//                                                   из манифеста и не
//                                                   должен сломаться
//
// Раньше здесь брались растры из tools/assets/rendered/img (их делал
// scenery.py) либо векторные заглушки backgrounds.mjs. Оба источника
// давали ОДНУ плоскую картинку, которая физически не может двигаться —
// это и была находка аудита №1. scenery.py оставлен в дереве, но из
// сборки исключён: ни один путь сюда больше не ведёт.
//
// Ручной арт по-прежнему главнее всего: если художник положит
// art/img/bg_landscape.png, продюсер возьмёт его и не станет ничего
// пересчитывать.

import fs from "node:fs/promises";
import path from "node:path";
import { buildScene, composeScene, SCENE, OVERSCAN, LAYER_SPEC } from "../scenery.mjs";

const VARIANTS = ["day", "night"];
const ORIENTATIONS = ["landscape", "portrait"];

/** Короткие имена в файлах: day_land_sky.webp читается, day_landscape_sky — нет. */
const SHORT = { landscape: "land", portrait: "port" };

/** Плоские сводки под именами, которые уже знает клиент. */
const FLAT = {
  "day:landscape": "bg_landscape",
  "night:landscape": "bg_landscape_free",
  "day:portrait": "bg_portrait",
  "night:portrait": "bg_portrait_free"
};

export default {
  name: "scenery",
  describe: "многослойный фон: 2 сцены × 2 ориентации",

  async build(ctx) {
    const sharp = (await import("sharp")).default;
    const images = [];
    const manifestLayers = {};
    let bytes = 0;

    // Слои пишутся НАПРЯМУЮ, минуя ctx.writeImage.
    // writeImage перекодирует всё в WebP с одним качеством 82; прогнав
    // через него уже сжатый слой, мы получили бы двойное сжатие и
    // потеряли бы поштучную настройку качества, ради которой набор
    // укладывается в бюджет. Через writeImage идут только четыре
    // плоские сводки — они и должны попасть в общий манифест.
    const layersDir = path.join(ctx.OUT, "img/layers");
    await fs.mkdir(layersDir, { recursive: true });
    for (const f of await fs.readdir(layersDir).catch(() => [])) {
      if (f.endsWith(".webp")) await fs.rm(path.join(layersDir, f), { force: true });
    }

    for (const variant of VARIANTS) {
      manifestLayers[variant] = {};
      for (const orientation of ORIENTATIONS) {
        const t = Date.now();
        const scene = await buildScene({ variant, orientation });
        const tag = `${variant}_${SHORT[orientation]}`;

        const entries = [];
        for (const l of scene.layers) {
          const file = `${tag}_${l.name}.webp`;
          // Качество по слоям разное. Небо и вода — большие гладкие
          // заливки, на них лишние проценты качества уходят в мегабайты;
          // у пальм и гор важна кромка альфы, там жать нельзя.
          const q = QUALITY[l.name] ?? 74;
          const buf = await sharp(l.buffer)
            .webp({ quality: q, effort: 6, alphaQuality: ALPHA_QUALITY[l.name] ?? 88 }).toBuffer();
          bytes += buf.length;
          await fs.writeFile(path.join(layersDir, file), buf);
          entries.push({
            name: l.name,
            z: l.z,
            file: `img/layers/${file}`,
            x: l.x, y: l.y, w: l.w, h: l.h,
            parallax: l.parallax,
            motion: l.motion,
            blend: l.blend || "normal",
            fixed: !!l.fixed
          });
        }

        manifestLayers[variant][orientation] = {
          canvas: scene.canvas,
          view: scene.view,
          offset: scene.offset,
          horizon: Math.round(scene.horizon),
          sun: scene.sun.map(Math.round),
          layers: entries.sort((a, b) => a.z - b.z)
        };

        // Плоская сводка для текущего клиента.
        images.push({
          name: FLAT[`${variant}:${orientation}`],
          buffer: await composeScene(scene, { format: "png" }),
          photographic: true
        });

        ctx.log(`   ${variant}/${orientation}: ${scene.layers.length} слоёв, ` +
                `${((Date.now() - t) / 1000).toFixed(1)} с`);
      }
    }

    // Ручной арт главнее: если для плоского фона есть готовый файл —
    // подменяем сводку им.
    //
    // Смотрим ТОЛЬКО в art/img (то, что положил человек). Раньше здесь
    // был ещё findRendered() — растры из tools/assets/rendered/img,
    // которые делал scenery.py. Пока он в цепочке, старый плоский фон
    // молча побеждает новую сцену: сборка отчитывалась «ручной арт для
    // bg_landscape» и клали именно его. Это и есть «исключить scenery.py
    // из сборки».
    for (const flatName of Object.values(FLAT)) {
      const file = await ctx.findOverride("img", flatName);
      if (!file) continue;
      const i = images.findIndex((im) => im.name === flatName);
      const buffer = await sharp(file).png({ compressionLevel: 9 }).toBuffer();
      if (i >= 0) images[i].buffer = buffer;
      ctx.log(`   ручной арт для ${flatName}`);
    }

    // layers.json кладётся рядом со слоями, а не в общий манифест:
    // он большой, а рантайму нужен только когда фон реально строится.
    const doc = {
      version: 2,
      generator: "tools/assets/scenery.mjs",
      overscan: OVERSCAN,
      // Единый источник света всей игры — тот же, что у символов и рамок.
      light: { azimuth: 135, elevation: 55, screen: "сверху-слева" },
      order: LAYER_SPEC.map((s) => s.name),
      scenes: manifestLayers
    };
    await fs.writeFile(path.join(layersDir, "layers.json"), JSON.stringify(doc, null, 1));

    ctx.log(`   слои: ${(bytes / 1024 / 1024).toFixed(2)} МБ WebP всего ` +
            `(${(bytes / 1024 / 1024 / 2).toFixed(2)} МБ на ориентацию)`);

    return {
      images,
      manifest: {
        scale: { images: 1 },
        layers: { file: "img/layers/layers.json" }
      }
    };
  }
};

/**
 * Качество WebP по слоям.
 *
 * Небо и вода занимают весь холст и при этом почти лишены деталей —
 * там каждый лишний пункт качества стоит сотни килобайт. Кулисы и
 * горы, наоборот, живут кромкой альфы: на них экономить нельзя,
 * зато они маленькие после обрезки по содержимому.
 */
const QUALITY = {
  sky: 68,
  sea: 68,
  pebbles: 70,
  vignette: 60,
  clouds_far: 70,
  clouds_near: 72,
  surf: 64,
  sea_glitter: 68,
  mountains: 78,
  // Кулисы — самые тяжёлые файлы набора: перистая крона это гектары
  // мелкой полупрозрачной кромки, и именно АЛЬФА, а не цвет, съедала
  // по 340 КБ на слой. Опускать пришлось обе шкалы; силуэт почти
  // чёрный, потеря цвета на нём не видна вовсе.
  palm_left: 72,
  palm_right: 72,
  sun: 78,
  moon: 82,
  stars: 82,
  lights: 80
};

/** Качество альфы отдельно: у кулис она и есть основной вес. */
const ALPHA_QUALITY = {
  palm_left: 76,
  palm_right: 76,
  surf: 78,
  sea_glitter: 78,
  clouds_near: 82,
  clouds_far: 82
};
