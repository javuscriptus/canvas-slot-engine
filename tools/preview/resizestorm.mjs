import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
  await p.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
const r = await p.evaluate(async () => {
  const R = window.__game.renderer;
  let reinit = 0;
  const c = R.canvas;
  let lastW = c.width;
  // 200 «пустых» событий resize — размер окна не менялся
  for (let i = 0; i < 200; i++) {
    window.dispatchEvent(new Event("resize"));
    if (c.width !== lastW) { reinit++; lastW = c.width; }
  }
  return { canvasReinit: reinit };
});
console.log(`холст переинициализирован ${r.canvasReinit} раз`,
  r.canvasReinit === 0 ? "✓ ложные resize игнорируются" : "✗ ЕСТЬ ЛИШНИЕ СБРОСЫ");
await b.close();
