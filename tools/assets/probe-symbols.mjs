// Стенд символов. Смотреть ГЛАЗАМИ после каждой правки фильтров.
//
//   node tools/assets/probe-symbols.mjs            — лист 12 символов + строка 90 px
//   node tools/assets/probe-symbols.mjs gem_red    — один символ крупно
//   node tools/assets/probe-symbols.mjs --anim     — раскадровка победы и приземления
//
// Фон намеренно тот же, что на барабане: тёмно-фиолетовый с виньеткой.
// На белом фоне любой символ выглядит контрастнее, чем есть, и ошибка
// «символ растворяется» находится только на реальной подложке.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

import { SYMBOLS, SYMBOL_SIZE, ANIMATIONS, ANIM_SIZE } from "./symbols.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "probe");

const REEL_BG = "#241041";

async function rasterize(items, scale) {
  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
  });
  const maxW = Math.max(...items.map((i) => i.size));
  const page = await browser.newPage({
    deviceScaleFactor: scale,
    viewport: { width: Math.ceil(maxW) + 40, height: Math.ceil(maxW) + 40 }
  });
  await page.setContent(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent}
      .cell{display:inline-block;width:max-content;line-height:0;vertical-align:top}
      svg{display:block}
     </style></head><body>
      ${items.map((it, i) => `<div class="cell" id="c${i}">${it.svg}</div>`).join("")}
     </body></html>`,
    { waitUntil: "load" }
  );
  await page.evaluate(() => document.fonts.ready);
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const el = await page.$(`#c${i}`);
    out.push({ name: items[i].name, buffer: await el.screenshot({ omitBackground: true }) });
  }
  await browser.close();
  return out;
}

/** Контактный лист на подложке барабана. */
async function sheet(frames, cell, cols, file, { label = true } = {}) {
  const pad = 10;
  const rows = Math.ceil(frames.length / cols);
  const w = cols * (cell + pad) + pad;
  const h = rows * (cell + pad + (label ? 16 : 0)) + pad;

  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><radialGradient id="v" cx="50%" cy="42%" r="72%">
        <stop offset="0%" stop-color="#3A1A63"/><stop offset="100%" stop-color="#12061F"/>
      </radialGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#v)"/>
      ${frames.map((_, i) => {
        const cx = pad + (i % cols) * (cell + pad);
        const cy = pad + Math.floor(i / cols) * (cell + pad + (label ? 16 : 0));
        return `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" rx="8"
          fill="${REEL_BG}" stroke="#00000055"/>`;
      }).join("")}
      ${label ? frames.map((f, i) => {
        const cx = pad + (i % cols) * (cell + pad);
        const cy = pad + Math.floor(i / cols) * (cell + pad + 16);
        return `<text x="${cx + cell / 2}" y="${cy + cell + 12}" fill="#ffffffaa"
          font-family="sans-serif" font-size="11" text-anchor="middle">${f.name}</text>`;
      }).join("") : ""}
    </svg>`
  );

  const composites = [];
  for (let i = 0; i < frames.length; i++) {
    const cx = pad + (i % cols) * (cell + pad);
    const cy = pad + Math.floor(i / cols) * (cell + pad + (label ? 16 : 0));
    composites.push({
      input: await sharp(frames[i].buffer).resize(cell, cell, { fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
      left: cx, top: cy
    });
  }
  await sharp(bg).composite(composites).png().toFile(file);
  console.log(`  ${path.relative(process.cwd(), file)}  ${w}×${h}`);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const arg = process.argv[2];

  if (arg === "--anim") {
    const clips = ANIMATIONS.filter((a) => ["gem_red_win", "wild_idle", "scatter_land", "anchor_win"].includes(a.name));
    const items = clips.flatMap((c) => c.frames.map((f) => ({ name: f.name, svg: f.svg(), size: ANIM_SIZE })));
    const png = await rasterize(items, 1);
    await sheet(png, 150, 10, path.join(OUT, "_sym_anim.png"));
    return;
  }

  const list = arg ? SYMBOLS.filter((s) => s.key === arg) : SYMBOLS;
  if (!list.length) throw new Error(`Нет символа "${arg}"`);

  const items = list.map((s) => ({ name: s.key, svg: s.svg(), size: SYMBOL_SIZE }));
  const big = await rasterize(items, 2);

  if (arg) {
    await fs.writeFile(path.join(OUT, `_sym_${arg}.png`), big[0].buffer);
    console.log(`  probe/_sym_${arg}.png`);
    return;
  }

  // Крупно — судить материал и свет.
  await sheet(big, 232, 4, path.join(OUT, "_sym_sheet.png"));
  // 90 px — проверка читаемости в мобильном портрете.
  await sheet(big, 90, 12, path.join(OUT, "_sym_90.png"), { label: false });
  // 128 px — типичный размер ячейки в ландшафте.
  await sheet(big, 128, 6, path.join(OUT, "_sym_128.png"), { label: false });
}

main().catch((e) => { console.error(e); process.exit(1); });
