// Производитель семейства «эффекты»: атлас fx.
//
//   node tools/assets/build.mjs --only particles
//
// Здесь ничего не рисуется. art/downloaded/particles/ — Kenney Particle
// Pack и Light Masks, 512², градации серого на чёрном, лицензия CC0.
// Это ПРОИЗВОДСТВЕННОЕ качество: спрайты кладутся в игру как есть под
// аддитивное смешивание, и рисовать вместо них что-то своё нет смысла.
//
// Задача сборки — только отобрать нужное, привести к рабочему размеру
// и упаковать. Тонирование НЕ запекается: кадры остаются белыми, цвет
// задаётся в рантайме множителем, поэтому один спрайт обслуживает и
// золотые монеты, и бирюзовые брызги.
//
// Чёрный фон исходников обязателен для аддитивного режима: там, где
// чёрно, аддитив не добавляет ничего, и прямоугольник кадра не виден.

import path from "node:path";

const SCALE = 1;
const SIZE = 256; // 512 исходника пополам: на экране частица мельче кадра

/**
 * Отбор. Ключ слева — имя кадра в атласе, значение — файл в
 * art/downloaded/particles/. Имена кадров стабильны: рантайм
 * обращается к ним по строке, переименование ломает эффект молча.
 */
export const FX_FRAMES = {
  // мягкие точки — искры, монеты, брызги
  fx_dot:        "kenney_particle_circle_05.png",
  fx_ring_thin:  "kenney_particle_circle_01.png",
  fx_glow:       "kenney_particle_light_01.png",
  fx_glow_wide:  "kenney_particle_light_03.png",
  fx_flare:      "kenney_particle_flare_01.png",

  // звёзды и магия — выигрышные всплески
  fx_star:       "kenney_particle_star_01.png",
  fx_star_soft:  "kenney_particle_star_09.png",
  fx_magic:      "kenney_particle_magic_05.png",
  fx_magic_ring: "kenney_particle_magic_04.png",

  // дым и пена — приземление барабана, волна
  fx_smoke:      "kenney_particle_smoke_01.png",
  fx_smoke_soft: "kenney_particle_smoke_04.png",

  // росчерки — след падающего символа
  fx_trail:      "kenney_particle_trace_01.png",
  fx_slash:      "kenney_particle_slash_01.png",

  // световые маски — лучи из-за барабанов и боке на фоне
  fx_beam:       "kenney_lightmask_cone_a_blur.png",
  fx_beam_wide:  "kenney_lightmask_cone_composed_a_noise.png",
  fx_bokeh:      "kenney_lightmask_circle_a.png",
  fx_ring:       "kenney_lightmask_circle_rings_a.png",
  fx_streak:     "kenney_lightmask_circle_a_streaks.png"
};

export default {
  name: "particles",
  describe: `${Object.keys(FX_FRAMES).length} кадров эффектов (Kenney, CC0)`,

  async build(ctx) {
    const sharp = (await import("sharp")).default;
    const dir = path.join(ctx.DOWNLOADED, "particles");
    if (!(await ctx.exists(dir))) {
      ctx.log("   art/downloaded/particles/ нет — пропущено");
      return {};
    }

    const frames = [];
    const missing = [];
    for (const [name, file] of Object.entries(FX_FRAMES)) {
      const src = path.join(dir, file);
      if (!(await ctx.exists(src))) { missing.push(file); continue; }
      const buffer = await sharp(src)
        .resize(SIZE, SIZE, { fit: "inside" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const meta = await sharp(buffer).metadata();
      frames.push({ name, buffer, width: meta.width, height: meta.height, slice: null });
    }
    if (missing.length) ctx.log(`   нет файлов: ${missing.join(", ")}`);
    if (!frames.length) return {};

    return {
      atlases: { fx: frames },
      manifest: { scale: { fx: SCALE } },
      sheet: frames
    };
  }
};
