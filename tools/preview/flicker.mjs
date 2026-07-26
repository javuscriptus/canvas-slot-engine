import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 2 });
  await p.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
await p.waitForTimeout(1500);

const r = await p.evaluate(async () => {
  const g = window.__game, R = g.renderer;
  let renders = 0, resizes = 0;
  const origRender = R.render.bind(R);
  R.render = () => { renders++; return origRender(); };
  const origResize = R.resize.bind(R);
  R.resize = (...a) => { resizes++; return origResize(...a); };

  // Снимаем контрольную область (кнопка спина) на каждом кадре
  // и считаем, насколько сильно она меняется между соседними кадрами.
  const ctx = R.canvas.getContext("2d");
  const x = Math.round(R.canvas.width * 0.86), y = Math.round(R.canvas.height * 0.86);
  const w = 80, h = 80;
  const samples = [];
  await new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      try { samples.push(ctx.getImageData(x, y, w, h).data.slice()); } catch {}
      if (++n < 60) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });

  let maxDiff = 0, sumDiff = 0, blankFrames = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], c = samples[i];
    let d = 0, lum = 0;
    for (let k = 0; k < a.length; k += 16) { d += Math.abs(a[k] - c[k]); lum += c[k]; }
    const n = a.length / 16;
    d /= n; lum /= n;
    maxDiff = Math.max(maxDiff, d);
    sumDiff += d;
    if (lum < 6) blankFrames++;      // кадр, где кнопка «пропала»
  }
  return {
    rendersPerSec: +(renders / (samples.length / 60)).toFixed(0),
    resizes,
    avgFrameDiff: +(sumDiff / (samples.length - 1)).toFixed(2),
    maxFrameDiff: +maxDiff.toFixed(2),
    blankFrames,
    frames: samples.length
  };
});
console.log(JSON.stringify(r, null, 1));
console.log(r.blankFrames === 0 && r.maxFrameDiff < 25
  ? "✓ картинка стабильна, мигания нет"
  : "✗ ОБНАРУЖЕНА НЕСТАБИЛЬНОСТЬ КАДРА");
await b.close();
