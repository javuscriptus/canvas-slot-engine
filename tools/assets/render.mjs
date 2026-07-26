// Растеризация SVG → PNG через headless Chromium.
// Chromium даёт настоящие SVG-фильтры (blur, drop-shadow, specular),
// которых нет у большинства лёгких растеризаторов.

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * @param {Array<{name:string, svg:string, width:number, height:number}>} items
 * @param {{outDir:string, scale:number}} opts
 */
export async function renderAll(items, { outDir, scale = 2 }) {
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
  });

  // Вьюпорт обязан вмещать самый широкий ассет целиком: скриншот элемента
  // обрезается по видимой области, и фон 1920px в окне 1280px потерял бы
  // правый край вместе со всем, что на нём нарисовано.
  const maxW = Math.max(...items.map((i) => i.width), 512);
  const maxH = Math.max(...items.map((i) => i.height), 512);
  const page = await browser.newPage({
    deviceScaleFactor: scale,
    viewport: { width: Math.ceil(maxW) + 64, height: Math.ceil(maxH) + 64 }
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .cell{display:inline-block;width:max-content;line-height:0;vertical-align:top}
    svg{display:block}
  </style></head><body>
    ${items.map((it, i) => `<div class="cell" id="c${i}">${it.svg}</div>`).join("")}
  </body></html>`;

  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const el = await page.$(`#c${i}`);
    const file = path.join(outDir, `${it.name}.png`);
    await el.screenshot({ path: file, omitBackground: true });
    results.push({ name: it.name, file, width: it.width * scale, height: it.height * scale });
  }

  await browser.close();
  return results;
}

/** Разовый предпросмотр: всё на тёмном фоне, одним листом. */
export async function renderContactSheet(items, outFile, { columns = 6, cell = 200, bg = "#1A0730" } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const rows = Math.ceil(items.length / columns);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:${bg};display:grid;grid-template-columns:repeat(${columns},${cell}px);gap:8px;padding:16px;width:max-content}
    .c{width:${cell}px;height:${cell}px;display:flex;align-items:center;justify-content:center;
       background:rgba(255,255,255,.04);border-radius:10px;position:relative}
    .c svg{width:100%;height:100%}
    .l{position:absolute;bottom:2px;left:0;right:0;text-align:center;color:#fff8;font:10px sans-serif}
  </style></head><body>
    ${items.map((it) => `<div class="c">${it.svg}<div class="l">${it.name}</div></div>`).join("")}
  </body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.setViewportSize({ width: columns * (cell + 8) + 32, height: rows * (cell + 8) + 32 });
  await page.screenshot({ path: outFile, fullPage: true });
  await browser.close();
  return outFile;
}
