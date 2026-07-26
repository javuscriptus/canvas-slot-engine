import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
  // только мешала бы: её затемнение перехватывает нажатия.
  try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
});

await page.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });
await page.waitForTimeout(500);

const r = await page.evaluate(async () => {
  const g = window.__game, R = g.renderer;
  const time = (fn, n = 60) => { const t0 = performance.now(); for (let i=0;i<n;i++) fn(); return (performance.now()-t0)/n; };

  const full = time(() => R.render());

  // без фона
  g.background.visible = false;
  const noBg = time(() => R.render());
  g.background.visible = true;

  // без барабанов
  g.reelSet.visible = false;
  const noReels = time(() => R.render());
  g.reelSet.visible = true;

  // только очистка холста
  const ctx = R.ctx;
  const clearOnly = time(() => { ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle="#000"; ctx.fillRect(0,0,R.canvas.width,R.canvas.height); });

  // качество сглаживания
  const prevQ = ctx.imageSmoothingQuality;
  ctx.imageSmoothingQuality = "low";
  const origRender = R.render.bind(R);
  R.render = function(){ const c=this.ctx; origRender(); c.imageSmoothingQuality="low"; };
  const lowQ = time(() => R.render());
  R.render = origRender;
  ctx.imageSmoothingQuality = prevQ;

  return {
    canvas: [R.canvas.width, R.canvas.height], dpr: R.dpr, scale: +R.scale.toFixed(3),
    fullMs: +full.toFixed(2), noBgMs: +noBg.toFixed(2), noReelsMs: +noReels.toFixed(2),
    clearOnlyMs: +clearOnly.toFixed(2), lowQualityMs: +lowQ.toFixed(2),
    drawCalls: R.drawCalls
  };
});
console.log(JSON.stringify(r, null, 1));
console.log(`\nбюджет кадра при 60 fps — 16.7 мс`);
console.log(`  весь кадр            ${r.fullMs} мс`);
console.log(`  из них фон           ${(r.fullMs - r.noBgMs).toFixed(2)} мс`);
console.log(`  из них барабаны      ${(r.fullMs - r.noReelsMs).toFixed(2)} мс`);
console.log(`  только очистка       ${r.clearOnlyMs} мс`);
console.log(`  при сглаживании low  ${r.lowQualityMs} мс`);
await browser.close();
