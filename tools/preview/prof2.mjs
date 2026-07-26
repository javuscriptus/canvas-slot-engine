import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  const g = window.__game, R = g.renderer;
  // считаем построения текстур
  let built = 0;
  const cache = R.textures;
  const origGet = cache.get.bind(cache);
  const sizeBefore = cache.map.size;
  cache.get = (f, dw, dh) => { const before = cache.map.size; const r = origGet(f, dw, dh); if (cache.map.size > before) built++; return r; };

  const t0 = performance.now();
  let frames = 0;
  for (let i = 0; i < 40; i++) { R.render(); frames++; }
  const ms = (performance.now() - t0) / frames;

  return { msPerFrame: +ms.toFixed(2), texturesBuiltIn40Frames: built,
           cacheSize: cache.map.size, cacheSizeBefore: sizeBefore, drawCalls: R.drawCalls };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
