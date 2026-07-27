// Производитель семейства «интерфейс»: оправа барабанов, панели,
// деревянные таблички, кнопки, баннеры, логотип.
//
//   node tools/assets/build.mjs --only ui
//
// Мелкие кадры уходят в атлас ui, крупные — отдельными файлами:
// оправа и баннеры на 2048-й атлас не влезают, а класть их туда и
// незачем — они рисуются поштучно и в батчинге не участвуют.

import { uiAssets, STANDALONE_NAMES } from "../ui.mjs";

const SCALE = 2;

/** Кадры, которые не помещаются в общий атлас и грузятся как картинки. */
export const STANDALONE = new Set(STANDALONE_NAMES);

export default {
  name: "ui",
  describe: "оправа, панели, таблички, кнопки, баннеры",

  async build(ctx) {
    // Список асинхронный: золото и дерево пекутся из PBR-карт ambientCG
    // (кеш на диске, повторная сборка мгновенная).
    const assets = await uiAssets();

    // Тяжёлые фильтры считаются в браузере, и все кадры разом кладут
    // страницу в несколько гигабайт видеопамяти. Режем на пачки.
    const rendered = [];
    const BATCH = 12;
    for (let i = 0; i < assets.length; i += BATCH) {
      const part = assets.slice(i, i + BATCH);
      rendered.push(...await ctx.rasterize(
        part.map((a) => ({ name: a.name, svg: a.svg(), slice: a.slice })),
        SCALE
      ));
    }

    // Готовый арт подменяет сгенерированный поштучно и БЕЗ приведения
    // к квадрату: у кнопок и панелей своя геометрия и свой 9-slice.
    let taken = 0;
    for (let i = 0; i < rendered.length; i++) {
      const file = await ctx.findOverride("ui", rendered[i].name);
      if (!file) continue;
      const sharp = (await import("sharp")).default;
      const meta = await sharp(file).metadata();
      rendered[i] = {
        ...rendered[i],
        buffer: await sharp(file).png({ compressionLevel: 9 }).toBuffer(),
        width: meta.width,
        height: meta.height
      };
      taken++;
    }
    if (taken) ctx.log(`   из art/ui/: ${taken}`);

    const frames = rendered.filter((f) => !STANDALONE.has(f.name));
    const standalone = rendered.filter((f) => STANDALONE.has(f.name));

    return {
      atlases: { ui: frames },
      images: standalone.map((f) => ({ ...f, photographic: false })),
      manifest: { scale: { ui: SCALE } },
      sheet: frames
    };
  }
};
