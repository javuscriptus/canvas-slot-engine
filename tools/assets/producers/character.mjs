// Производитель семейства «персонаж».
//
//   node tools/assets/build.mjs --only character
//
// Отдаёт три вещи:
//   1. СЛОИ рига — 13 PNG в client/assets/img/character/. Каждый со
//      своим прямоугольником в пространстве фигуры и точкой поворота.
//   2. КАДРЫ РЕАКЦИЙ — char_react_win_*, char_react_big_*,
//      char_react_lose_*, char_idle_blink_*. Пекутся ИЗ ТЕХ ЖЕ СЛОЁВ
//      прямо в браузере: страница расставляет слои CSS-трансформами по
//      позе из character.REACTIONS, скриншот — готовый кадр. Отдельной
//      отрисовки поз не существует, поэтому кадры физически не могут
//      разойтись с ригом.
//   3. Секцию manifest.character — полное описание рига: боксы, пивоты,
//      группы, параметры синусов idle, правила моргания и реакций.
//      Клиенту не нужно знать ни одной константы из этого файла.
//
// ПОЧЕМУ КАДРЫ РЕАКЦИЙ ОБРЕЗАНЫ ПО ПОЯС. В реакциях двигается только
// верх фигуры: ноги стоят. Полный кадр 900×1500 в спрайт-листе на 20
// поз — это мегабайты ради неподвижных штанин. Кадр режется по
// REACT_BAND (верх фигуры), клиент подкладывает под него char_legs из
// рига. Экономия примерно 40 % без единого компромисса по картинке.
//
// Готовый растр из art/img/<имя>.png по-прежнему главнее генерации.

import path from "node:path";

// Полоса фигуры, попадающая в кадры реакций (в координатах фигуры).
// Взято с запасом вверх: в big-реакции фуражка улетает выше макушки.
const REACT_BAND = { x: 60, y: 0, w: 800, h: 1060 };
const REACT_SCALE = 0.55;

/* ─────────────────────── выпечка кадров позы ────────────────────── */

/**
 * Собирает страницу, где каждый слой лежит абсолютно и получает две
 * вложенные трансформации: внешнюю от ГРУППЫ (вокруг пивота группы) и
 * внутреннюю от самого слоя (вокруг собственного пивота). Порядок
 * важен: сначала группа, потом слой — иначе фуражка «уезжает» с
 * головы при повороте шеи.
 */
function poseHtml(frames, layerData, rig, band, scale) {
  const cell = (pose) => {
    const eyes = pose.eyes || "open";
    const order = rig.drawOrder.map((n) => (n === "char_eyes_open" ? `char_eyes_${eyes}` : n));

    const groupOf = (name) => {
      for (const [g, spec] of Object.entries(rig.groups)) {
        if (spec.members.includes(name)) return { key: `@${g}`, pivot: spec.pivot };
      }
      return null;
    };

    const imgs = order.map((name) => {
      const L = layerData[name];
      if (!L) return "";
      const g = groupOf(name);
      const gt = g ? (pose[g.key] || {}) : {};
      const lt = pose[name] || {};

      const inner = `left:${L.box.x}px;top:${L.box.y}px;width:${L.box.w}px;height:${L.box.h}px;` +
        `transform-origin:${L.pivot[0] - L.box.x}px ${L.pivot[1] - L.box.y}px;` +
        `transform:translate(${lt.dx || 0}px,${lt.dy || 0}px) rotate(${lt.rot || 0}deg)` +
        ` scale(${lt.scale ? 1 + lt.scale : 1},${lt.scaleY ? 1 + lt.scaleY : (lt.scale ? 1 + lt.scale : 1)});` +
        (lt.alpha ? `opacity:${1 + lt.alpha};` : "");

      const img = `<img src="data:image/png;base64,${L.b64}" style="position:absolute;${inner}">`;
      if (!g) return img;
      return `<div style="position:absolute;left:0;top:0;width:100%;height:100%;` +
        `transform-origin:${g.pivot[0]}px ${g.pivot[1]}px;` +
        `transform:translate(${gt.dx || 0}px,${gt.dy || 0}px) rotate(${gt.rot || 0}deg)` +
        ` scale(${gt.scale ? 1 + gt.scale : 1});">${img}</div>`;
    }).join("");

    return `<div class="f"><div class="fig">${imgs}</div></div>`;
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .f{position:relative;width:${Math.round(band.w * scale)}px;
       height:${Math.round(band.h * scale)}px;overflow:hidden;
       display:inline-block;vertical-align:top;line-height:0}
    .fig{position:absolute;left:${-band.x * scale}px;top:${-band.y * scale}px;
         width:${rig.figure.width}px;height:${rig.figure.height}px;
         transform:scale(${scale});transform-origin:0 0}
    img{display:block}
  </style></head><body>${frames.map(cell).join("")}</body></html>`;
}

/* ──────────────────────────── сборка ────────────────────────────── */

export default {
  name: "character",
  describe: "капитан: 13 слоёв рига + кадры реакций",

  async build(ctx) {
    const sharp = (await import("sharp")).default;

    let mod;
    try {
      mod = await import("../character.mjs");
    } catch (e) {
      ctx.log(`   модуля ../character.mjs нет (${e.message}) — семейство пропущено`);
      return {};
    }
    if (typeof mod.layers !== "function") {
      ctx.log("   ../character.mjs не экспортирует layers() — семейство пропущено");
      return {};
    }

    // PBR-карта золота: кокарда и подстаканник. Без неё металл
    // получится «жёлтым пластиком», но сборка не должна падать.
    let goldHref = null;
    try {
      const { detailUri } = await import("../pbr.mjs");
      goldHref = await detailUri("gold", { size: 320, amount: 0.34, normalStrength: 0.45 });
    } catch (e) {
      ctx.log(`   PBR недоступен (${e.message}) — золото пойдёт по градиенту`);
    }

    const defs = mod.layers(goldHref);
    const ns = (svg, p) => svg
      .replace(/id="([A-Za-z][\w-]*)"/g, (_, id) => `id="${p}__${id}"`)
      .replace(/url\(#([A-Za-z][\w-]*)\)/g, (_, id) => `url(#${p}__${id})`);

    // Слои растеризуются в 1:1 — SVG уже авторские 900×1500.
    const rendered = await ctx.rasterize(
      defs.map((l) => ({ name: l.name, svg: ns(l.svg, l.key) })), 1
    );

    const byName = new Map(rendered.map((r) => [r.name, r]));
    const layerData = {};
    const images = [];

    for (const l of defs) {
      const r = byName.get(l.name);
      if (!r) continue;
      let buffer = r.buffer;

      // Свой арт важнее сгенерированного.
      const override = await ctx.findOverride("img", `character/${l.name}`)
                    || await ctx.findOverride("img", l.name);
      if (override) buffer = await sharp(override).png({ compressionLevel: 9 }).toBuffer();

      // Ореол уходит в WebP: 860×1470 гладкого градиента с альфой
      // весит в PNG 260 КБ и сжимается вчетверо без единого видимого
      // артефакта — резких краёв там нет вообще. Всё остальное
      // остаётся PNG: у слоёв с контуром лоссы дают ореол по кромке.
      const soft = l.name === "char_glow";
      layerData[l.name] = { box: l.box, pivot: l.pivot, b64: buffer.toString("base64"),
                            ext: soft ? "webp" : "png" };
      images.push({ name: `character/${l.name}`, buffer, photographic: soft });
    }

    const rig = {
      figure: mod.RIG.figure,
      anchor: mod.RIG.anchor,
      groups: mod.RIG.groups,
      drawOrder: mod.DRAW_ORDER
    };

    /* ── кадры реакций ─────────────────────────────────────────────
       Выпекаются одной страницей на реакцию: старт Chromium дороже,
       чем сама отрисовка двадцати кадров. */
    const page = await (await ctx.browser()).newPage({
      deviceScaleFactor: 1,
      viewport: {
        width: Math.ceil(REACT_BAND.w * REACT_SCALE) + 32,
        height: Math.ceil(REACT_BAND.h * REACT_SCALE) + 32
      }
    });

    const reactions = {};
    for (const [key, spec] of Object.entries(mod.REACTIONS)) {
      await page.setContent(
        poseHtml(spec.frames, layerData, rig, REACT_BAND, REACT_SCALE),
        { waitUntil: "load" }
      );
      const cells = await page.$$(".f");
      for (let i = 0; i < cells.length; i++) {
        const buffer = await cells[i].screenshot({ omitBackground: true });
        // Кадры реакций — WebP q90. Двадцать кадров по 65 КБ в PNG
        // это 1.3 МБ ради четырёх секунд анимации; WebP срезает до
        // трети, а контур переживает q90 без ореола (проверено
        // сравнением кромки кителя пиксель в пиксель).
        images.push({ name: `character/char_react_${key}_${i}`, buffer,
                      photographic: true, quality: 90 });
      }
      reactions[key] = {
        fps: spec.fps,
        frames: cells.length,
        prefix: `char_react_${key}_`,
        ext: "webp",
        // Кадр покрывает только верх фигуры; ноги клиент берёт из рига.
        band: REACT_BAND,
        scale: REACT_SCALE
      };
      ctx.log(`   реакция ${key}: ${cells.length} кадров`);
    }
    await page.close();

    // Моргание — кадры глаз, а не фигуры: слой крошечный, полный кадр
    // ради двух прикрытых век был бы расточительством в чистом виде.
    const blinkStates = ["open", "half", "closed"];
    blinkStates.forEach((state, i) => {
      const src = byName.get(`char_eyes_${state}`);
      if (src) images.push({ name: `character/char_idle_blink_${i}`, buffer: src.buffer,
                            photographic: false });
    });

    const manifest = {
      character: {
        ...rig,
        dir: "img/character",
        layers: Object.fromEntries(defs
          .filter((l) => layerData[l.name])
          .map((l) => [l.name, {
            file: `img/character/${l.name}.${layerData[l.name].ext}`,
            x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h,
            pivot: l.pivot
          }])),
        idle: mod.RIG.idle,
        blink: {
          ...mod.RIG.blink,
          prefix: "char_idle_blink_",
          ext: "png",
          frames: blinkStates.length,
          box: mod.RIG.groups.head.members.includes("char_eyes_open")
            ? layerData["char_eyes_open"].box : null
        },
        reactions
      }
    };

    return {
      images,
      manifest,
      sheet: images
        .filter((i) => !i.name.includes("_react_"))
        .map((i) => ({ name: path.basename(i.name), buffer: i.buffer }))
    };
  }
};
