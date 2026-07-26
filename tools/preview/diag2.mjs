import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });

await page.evaluate(() => {
  const g = window.__game;
  window.__stats = { resize: 0, textRedraw: 0, frames: 0, reloads: 0 };
  g.viewport.onOrientationChange.add(() => window.__stats.resize++);
  g.renderer.onResize.add(() => window.__stats.resize++);
  // считаем перерисовки текста
  const walk = (n, out=[]) => { if (n.children) n.children.forEach(c=>walk(c,out)); else out.push(n); return out; };
  window.__texts = walk(g.renderer.stage).filter(n => n._canvas !== undefined || n.style);
  window.__texts.forEach(t => {
    const orig = t.redraw.bind(t);
    t.redraw = (dpr) => { window.__stats.textRedraw++; return orig(dpr); };
  });
  g.ticker.onTick.add(() => window.__stats.frames++);
});

await page.waitForTimeout(3000);
const s = await page.evaluate(() => ({ ...window.__stats, texts: window.__texts.length,
  drawCalls: window.__game.renderer.drawCalls, fps: Math.round(window.__game.ticker.fps),
  tweens: window.__game.tweens.active.length }));
console.log("за 3 секунды простоя:", JSON.stringify(s));
console.log(`  перерисовок текста на кадр: ${(s.textRedraw / s.frames).toFixed(2)}  (норма ~0)`);
console.log(`  событий resize: ${s.resize}  (норма 0)`);

// то же во время анимации баланса
await page.evaluate(() => { window.__stats.textRedraw = 0; window.__stats.frames = 0; window.__game.panel.balanceMeter.setValue(1234.56); });
await page.waitForTimeout(1500);
const s2 = await page.evaluate(() => window.__stats);
console.log(`во время докрутки счётчика: ${(s2.textRedraw/s2.frames).toFixed(2)} перерисовок/кадр`);
await browser.close();
