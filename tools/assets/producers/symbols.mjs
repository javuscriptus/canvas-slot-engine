// Производитель семейства «символы».
//
//   node tools/assets/build.mjs --only symbols
//
// Источник фигур — symbols.mjs (SYMBOLS, ANIMATIONS). Здесь только
// сборка: растр, подмена готовым артом из art/symbols/ и упаковка.
//
// ПОРЯДОК КАДРОВ И ИХ ИМЕНА — КОНТРАКТ С МАТЕМАТИКОЙ. Ключ символа
// совпадает с SYMBOL_KEYS в server/src/math/gameConfig.js, а id — с
// индексом в ленте. Переименовать кадр значит сломать клиент молча:
// атлас соберётся, а на барабане будет пусто.
//
// ДВА АТЛАСА, а не один. Статика (12 кадров по 512 px) нужна до первого
// вращения, покадровые анимации (130 кадров по 176 px) — только в момент
// выигрыша. В одном атласе они дали бы 2048×4400 и заставили бы игрока
// ждать анимацию победы ещё до того, как он увидит барабан.

import { SYMBOLS, SYMBOL_SIZE, ANIMATIONS, ANIM_SIZE, ANIM_VIEW } from "../symbols.mjs";

const SCALE = 2;                       // 256 → 512 px: запас под ретину
const ANIM_SCALE = ANIM_SIZE / ANIM_VIEW;    // кадр крупнее символа на запас под пульс

export default {
  name: "symbols",
  describe: `${SYMBOLS.length} игровых символов + ${ANIMATIONS.length} клипов`,

  async build(ctx) {
    const target = SYMBOL_SIZE * SCALE;

    // Готовый файл важнее генерации: положите art/symbols/<ключ>.png,
    // и сборка возьмёт его вместо отрисовки.
    const overrides = new Map();
    for (const sym of SYMBOLS) {
      const file = await ctx.findOverride("symbols", sym.key);
      if (file) overrides.set(sym.key, await ctx.loadOverride(file, target));
    }
    if (overrides.size) ctx.log(`   из art/symbols/: ${overrides.size}`);

    const rendered = await ctx.rasterize(
      SYMBOLS.filter((s) => !overrides.has(s.key)).map((s) => ({ name: s.key, svg: s.svg() })),
      SCALE
    );

    const frames = SYMBOLS.map((sym) => {
      const own = overrides.get(sym.key);
      if (own) return { name: sym.key, slice: null, ...own };
      const r = rendered.find((x) => x.name === sym.key);
      if (!r) throw new Error(`Символ "${sym.key}" не отрисовался`);
      return r;
    });

    // Анимации растеризуются в масштабе 1: SVG уже отдан в размере кадра.
    const animItems = ANIMATIONS.flatMap((clip) =>
      clip.frames.map((f) => ({ name: f.name, svg: f.svg() }))
    );
    const animFrames = await ctx.rasterize(animItems, 1);
    ctx.log(`   кадров анимации: ${animFrames.length} по ${ANIM_SIZE} px`);

    return {
      atlases: {
        symbols: frames,
        symbols_anim: animFrames
      },
      manifest: {
        scale: { symbols: SCALE, symbols_anim: ANIM_SCALE },
        symbols: SYMBOLS.map((s) => ({ id: s.id, key: s.key, label: s.label })),
        // Клипы описываются здесь, а не угадываются клиентом по именам:
        // SpriteSheet.fromNames принимает готовый список, и порядок кадров
        // не должен зависеть от того, как атлас разложил их по полкам.
        animations: Object.fromEntries(ANIMATIONS.map((c) => [c.name, {
          atlas: "symbols_anim",
          fps: c.fps,
          loop: c.loop,
          frames: c.frames.map((f) => f.name)
        }]))
      },
      sheet: frames
    };
  }
};
