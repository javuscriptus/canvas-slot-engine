// Полная сборка графики: SVG → PNG → атласы → manifest.json
//
//   node tools/assets/build.mjs
//
// Результат кладётся в client/assets/. Скрипт детерминирован:
// один и тот же исходник всегда даёт побайтово одинаковые атласы.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { chromium } from "playwright";
import sharp from "sharp";

import { SYMBOLS } from "./symbols.mjs";
import { UI_ASSETS } from "./ui.mjs";
import { BACKGROUNDS } from "./backgrounds.mjs";
import { packAtlas } from "./pack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "client/assets");

/**
 * Папка с «настоящим» артом.
 *
 * Сгенерированная кодом графика — это заготовка. Как только появляется
 * нарисованный художником или купленный арт, он кладётся сюда с теми же
 * именами, и сборка берёт файлы вместо генерации. Код игры при этом не
 * меняется вообще: имена кадров зафиксированы в manifest.json.
 *
 *   art/symbols/<ключ символа>.png   — 12 символов
 *   art/ui/<имя>.png                 — кнопки, рамка, панели
 *   art/img/<имя>.png                — фоны, логотип, баннеры
 *
 * Требования к файлам: PNG с прозрачностью, квадрат для символов,
 * сторона не меньше 512 px — меньше будет мылить на ретине.
 */
const ART = path.join(ROOT, "art");

/**
 * Отрисованные растром ассеты — то, что нельзя получить из SVG.
 *
 * Пейзаж невозможно нарисовать вектором убедительно: воздушная дымка,
 * рассеяние света, зерно и блики на воде — это операции над пикселями.
 * Поэтому фоны считает tools/assets/scenery.py, а сборка берёт готовые
 * PNG отсюда.
 *
 * Приоритет: art/ (ваш арт) → rendered/ (отрисованный) → SVG (запасной).
 */
const RENDERED = path.join(__dirname, "rendered");

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function findOverride(kind, name) {
  const own = path.join(ART, kind, `${name}.png`);
  if (await exists(own)) return own;
  return null;
}

async function findRendered(kind, name) {
  // WebP в приоритете: пейзаж с зерном хранится именно так, PNG на нём
  // раздувает исходники на порядок.
  for (const ext of ["webp", "png"]) {
    const file = path.join(RENDERED, kind, `${name}.${ext}`);
    if (await exists(file)) return file;
  }
  return null;
}

/** Готовит кадр из готового файла: приводит к нужному размеру. */
async function loadOverride(file, targetPx) {
  const buffer = await sharp(file)
    .resize(targetPx, targetPx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { buffer, width: targetPx, height: targetPx };
}

// Ассеты, которые слишком велики для общего атласа и грузятся отдельно.
const STANDALONE = new Set([
  "reel_frame", "logo",
  "banner_big", "banner_mega", "banner_epic", "banner_free"
]);

const SYMBOL_SCALE = 2;   // 256 → 512 px
const UI_SCALE = 2;
const BG_SCALE = 1;       // фоны и так большие

function svgSize(svg) {
  const m = svg.match(/width="([\d.]+)"\s+height="([\d.]+)"/);
  return { width: parseFloat(m[1]), height: parseFloat(m[2]) };
}

/** Растеризует набор SVG в буферы PNG одной сессией браузера. */
async function rasterize(browser, items, scale) {
  const sized = items.map((it) => ({ ...it, ...svgSize(it.svg) }));
  const maxW = Math.max(...sized.map((s) => s.width));
  const maxH = Math.max(...sized.map((s) => s.height));

  const page = await browser.newPage({
    deviceScaleFactor: scale,
    viewport: { width: Math.ceil(maxW) + 64, height: Math.ceil(maxH) + 64 }
  });

  await page.setContent(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent}
      .cell{display:inline-block;width:max-content;line-height:0;vertical-align:top}
      svg{display:block}
    </style></head><body>
      ${sized.map((it, i) => `<div class="cell" id="c${i}">${it.svg}</div>`).join("")}
    </body></html>`,
    { waitUntil: "load" }
  );
  await page.evaluate(() => document.fonts.ready);

  const out = [];
  for (let i = 0; i < sized.length; i++) {
    const el = await page.$(`#c${i}`);
    const buffer = await el.screenshot({ omitBackground: true });
    out.push({
      name: sized[i].name,
      slice: sized[i].slice || null,
      buffer,
      width: Math.round(sized[i].width * scale),
      height: Math.round(sized[i].height * scale)
    });
  }
  await page.close();
  return out;
}

async function main() {
  await fs.mkdir(path.join(OUT, "atlas"), { recursive: true });
  await fs.mkdir(path.join(OUT, "img"), { recursive: true });

  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
  });

  console.log("→ символы");
  const overrides = { symbols: 0, ui: 0, img: 0 };
  const symbolTarget = 256 * SYMBOL_SCALE;

  // Символы, для которых есть готовый файл, не рендерятся из SVG.
  const symbolOverrides = new Map();
  for (const sym of SYMBOLS) {
    const file = await findOverride("symbols", sym.key);
    if (file) {
      symbolOverrides.set(sym.key, await loadOverride(file, symbolTarget));
      overrides.symbols++;
    }
  }

  const symbolItems = SYMBOLS
    .filter((s) => !symbolOverrides.has(s.key))
    .map((s) => ({ name: s.key, svg: s.svg() }));
  const rendered = symbolItems.length
    ? await rasterize(browser, symbolItems, SYMBOL_SCALE)
    : [];

  // Порядок обязан совпадать с SYMBOLS: id символа — контракт с математикой.
  const symbolPngs = SYMBOLS.map((sym) => {
    const own = symbolOverrides.get(sym.key);
    if (own) return { name: sym.key, slice: null, ...own };
    return rendered.find((r) => r.name === sym.key);
  });

  console.log("→ UI");
  const uiPngs = await rasterize(
    browser,
    UI_ASSETS.map((a) => ({ name: a.name, svg: a.svg(), slice: a.slice })),
    UI_SCALE
  );
  // Готовый UI-арт подменяет сгенерированный поштучно.
  for (let i = 0; i < uiPngs.length; i++) {
    const file = await findOverride("ui", uiPngs[i].name);
    if (!file) continue;
    const meta = await sharp(file).metadata();
    uiPngs[i] = {
      ...uiPngs[i],
      buffer: await sharp(file).png({ compressionLevel: 9 }).toBuffer(),
      width: meta.width,
      height: meta.height
    };
    overrides.ui++;
  }

  console.log("→ фоны");
  const bgItems = BACKGROUNDS.map((b) => ({ name: b.name, svg: b.svg() }));
  const bgPngs = await rasterize(browser, bgItems, BG_SCALE);

  await browser.close();

  // ── атласы ──────────────────────────────────────────────────────
  const symbolAtlas = await packAtlas(symbolPngs, {
    outPng: path.join(OUT, "atlas/symbols.png"),
    outJson: path.join(OUT, "atlas/symbols.json"),
    maxWidth: 2048
  });
  console.log(`  символы: ${symbolAtlas.atlasW}×${symbolAtlas.atlasH}, ${symbolAtlas.count} кадров`);

  const uiAtlasFrames = uiPngs.filter((p) => !STANDALONE.has(p.name));
  const uiAtlas = await packAtlas(uiAtlasFrames, {
    outPng: path.join(OUT, "atlas/ui.png"),
    outJson: path.join(OUT, "atlas/ui.json"),
    maxWidth: 2048
  });
  console.log(`  UI: ${uiAtlas.atlasW}×${uiAtlas.atlasH}, ${uiAtlas.count} кадров`);

  // ── отдельные изображения ───────────────────────────────────────
  //
  // Фоны уходят в WebP, всё остальное остаётся PNG.
  //
  // Причина: у отрисованного пейзажа есть плёночное зерно, и PNG на нём
  // бессилен — каждый пиксель отличается от соседа, сжимать нечего.
  // Четыре фона весили три с лишним мегабайта каждый, то есть больше,
  // чем вся остальная игра. WebP с потерями даёт тот же кадр в двадцать
  // раз меньше; на градиентах и зерне разница не видна даже вплотную.
  //
  // Кнопки и рамки остаются PNG: у них резкие края и альфа, а лоссы
  // на прозрачном контуре дают заметный ореол.
  const images = {};
  for (const p of [...uiPngs.filter((x) => STANDALONE.has(x.name)), ...bgPngs]) {
    // Свой арт важнее отрисованного, отрисованный важнее векторного.
    const own = (await findOverride("img", p.name)) || (await findRendered("img", p.name));
    let buffer = p.buffer;
    let w = p.width;
    let h = p.height;
    if (own) {
      buffer = await sharp(own).png({ compressionLevel: 9 }).toBuffer();
      const meta = await sharp(own).metadata();
      w = meta.width;
      h = meta.height;
      overrides.img++;
    }

    const photographic = p.name.startsWith("bg_");
    const file = `img/${p.name}.${photographic ? "webp" : "png"}`;
    const out = path.join(OUT, file);
    if (photographic) {
      await sharp(buffer).webp({ quality: 82, effort: 6 }).toFile(out);
      // Старый PNG рядом с новым WebP сбил бы с толку и раздул папку.
      await fs.rm(path.join(OUT, `img/${p.name}.png`), { force: true });
    } else {
      await sharp(buffer).png({ compressionLevel: 9, effort: 10 }).toFile(out);
    }
    images[p.name] = { file, w, h };
  }

  // ── манифест ────────────────────────────────────────────────────
  // Версия — хеш от содержимого атласов. Меняется только когда реально
  // изменилась графика, поэтому кеш игроков сбрасывается ровно тогда,
  // когда это нужно, и ни разу лишний раз.
  const hash = crypto.createHash("sha1");
  for (const f of ["atlas/symbols.png", "atlas/ui.png"]) {
    hash.update(await fs.readFile(path.join(OUT, f)));
  }
  const version = hash.digest("hex").slice(0, 10);

  const manifest = {
    version,
    // Во сколько раз пиксели атласа крупнее «дизайнерских».
    // Движок делит на это число, чтобы рисовать в проектных координатах.
    scale: { symbols: SYMBOL_SCALE, ui: UI_SCALE, images: BG_SCALE },
    atlases: {
      symbols: { json: "atlas/symbols.json", image: "atlas/symbols.png" },
      ui: { json: "atlas/ui.json", image: "atlas/ui.png" }
    },
    images,
    symbols: SYMBOLS.map((s) => ({ id: s.id, key: s.key, label: s.label })),
    audio: { sprite: "audio/sfx.json", files: ["audio/sfx.webm", "audio/sfx.mp3"] }
  };
  await fs.writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  const total = await du(OUT);
  const usedArt = overrides.symbols + overrides.ui + overrides.img;
  if (usedArt) {
    console.log(`  подставлено из art/: символов ${overrides.symbols}, ` +
      `UI ${overrides.ui}, картинок ${overrides.img}`);
  } else {
    console.log("  готового арта в art/ не найдено — вся графика сгенерирована");
  }
  console.log(`✓ готово, ${(total / 1024 / 1024).toFixed(2)} МБ в client/assets`);
}

async function du(dir) {
  let sum = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sum += await du(p);
    else sum += (await fs.stat(p)).size;
  }
  return sum;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
