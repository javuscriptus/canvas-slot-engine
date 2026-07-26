// Снимки на реальных размерах телефонов + замер «мёртвого» места.
import { chromium } from "playwright";
const PHONES = [
  ["iphone-se",   375, 667],
  ["iphone-14",   390, 844],
  ["pixel-7",     412, 915],
  ["galaxy-s23",  360, 780],
  ["ipad-mini",   744, 1133],
  ["land-phone",  844, 390]
];
const b = await chromium.launch();
for (const [name, w, h] of PHONES) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

  await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
  await p.waitForTimeout(900);
  const m = await p.evaluate(() => {
    const g = window.__game, c = g.renderer.canvas, r = c.getBoundingClientRect();
    const btn = (n) => { const s = n.getLocalSize();
      const a = n.worldMatrix.apply(0,0), b2 = n.worldMatrix.apply(s.width, s.height);
      return Math.round(Math.abs(b2.x-a.x) * (r.width/c.width)); };
    return {
      vw: innerWidth, vh: innerHeight,
      canvasCss: [Math.round(r.width), Math.round(r.height)],
      deadX: Math.round(innerWidth - r.width), deadY: Math.round(innerHeight - r.height),
      design: [g.renderer.designWidth, g.renderer.designHeight],
      spinPx: btn(g.panel.spinButton), menuPx: btn(g.panel.menuButton),
      autoPx: btn(g.panel.autoButton),
      layout: g.layout.name
    };
  });
  console.log(`${name.padEnd(12)} ${String(w).padStart(4)}×${h}  холст ${m.canvasCss[0]}×${m.canvasCss[1]}  пусто по X ${m.deadX} по Y ${m.deadY}  дизайн ${m.design.join("×")}  кнопки: spin ${m.spinPx} menu ${m.menuPx} auto ${m.autoPx}`);
  await p.screenshot({ path: `/tmp/ph-${name}.png` });
  await p.close();
}
await b.close();
