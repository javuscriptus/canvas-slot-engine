// Стенд интерфейса: рендерит отдельные куски оправы, таблички и кнопки
// в PNG, чтобы смотреть глазами до полной сборки атласа.
//
//   node tools/assets/probe-ui.mjs                — весь список
//   node tools/assets/probe-ui.mjs corner rope    — только эти
//   node tools/assets/probe-ui.mjs --scene        — тестовая композиция 1920×1080

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { uiAssets, scenePreview } from "./ui.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "probe");

async function main() {
  const argv = process.argv.slice(2);
  const wantScene = argv.includes("--scene");
  const only = argv.filter((a) => !a.startsWith("-"));
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
  });

  if (wantScene) {
    const html = await scenePreview();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1920, height: 1080 } });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "_scene.png") });
    await page.close();
    console.log(`✓ сцена → ${path.join(OUT, "_scene.png")}`);
  }

  const assets = await uiAssets();
  const list = only.length
    ? assets.filter((a) => only.some((o) => a.name.includes(o)))
    : assets;

  // Пачками по десять: все шестьдесят кадров на одной странице —
  // это шестьдесят одновременных feTurbulence по большим областям,
  // и Chromium уходит в своп на несколько минут.
  const BATCH = 10;
  for (let b = 0; b < list.length; b += BATCH) {
    const items = list.slice(b, b + BATCH).map((a) => ({ name: a.name, svg: a.svg() }));
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 2400, height: 1200 }
    });
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent}
      .cell{display:inline-block;width:max-content;line-height:0;vertical-align:top}
      svg{display:block}
    </style></head><body>
      ${items.map((it, i) => `<div class="cell" id="c${i}">${it.svg}</div>`).join("")}
    </body></html>`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    for (let i = 0; i < items.length; i++) {
      const el = await page.$(`#c${i}`);
      await el.screenshot({ path: path.join(OUT, `ui_${items[i].name}.png`), omitBackground: true });
    }
    await page.close();
    console.log(`   ${Math.min(b + BATCH, list.length)}/${list.length}`);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
