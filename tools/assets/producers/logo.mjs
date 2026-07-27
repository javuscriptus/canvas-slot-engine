// Производитель семейства «логотип».
//
//   node tools/assets/build.mjs --only logo
//
// Сейчас логотип живёт внутри ui.mjs (UI_ASSETS, кадр "logo") и
// собирается вместе с интерфейсом. Этот слот существует, чтобы агент
// брендинга мог переделать логотип НЕ ЗАДЕВАЯ ui.mjs, над которым
// параллельно работает другой агент, и пересобирать его за секунду
// вместо полной сборки интерфейса.
//
// Как включить: создать ../logo.mjs с экспортом
//
//   export const LOGO = [
//     { name: "logo",        svg: () => "<svg …>" },
//     { name: "logo_small",  svg: () => "<svg …>" }
//   ];
//
// и удалить кадр "logo" из RAW_UI в ui.mjs. Пока такого модуля нет,
// производитель молча уступает интерфейсу — двух источников одного
// кадра не бывает, побеждает тот, что собран последним, и это была бы
// гонка между агентами.
//
// Имя кадра "logo" зафиксировано в manifest.images и в клиенте.

export default {
  name: "logo",
  describe: "логотип (пока внутри ui)",

  async build(ctx) {
    let list = [];
    try {
      const mod = await import("../logo.mjs");
      list = mod.LOGO || [];
    } catch {
      ctx.log("   отдельного ../logo.mjs нет — логотип собирается семейством ui");
      return {};
    }
    if (!list.length) return {};

    const rendered = await ctx.rasterize(
      list.map((l) => ({ name: l.name, svg: l.svg() })), 2
    );

    const sharp = (await import("sharp")).default;
    const images = [];
    for (const r of rendered) {
      const file = await ctx.findOverride("img", r.name);
      images.push({
        name: r.name,
        buffer: file ? await sharp(file).png({ compressionLevel: 9 }).toBuffer() : r.buffer,
        photographic: false
      });
    }
    return { images, sheet: images.map((i) => ({ name: i.name, buffer: i.buffer })) };
  }
};
