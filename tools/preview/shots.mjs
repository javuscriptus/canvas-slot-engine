import { chromium } from "playwright";
const b = await chromium.launch();
// портрет
const p1 = await b.newPage({ viewport: { width: 520, height: 980 }, deviceScaleFactor: 2 });
  await p1.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

await p1.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await p1.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
await p1.waitForTimeout(1200);
await p1.screenshot({ path: "/tmp/final-portrait.png" });
// таблица выплат
await p1.evaluate(() => window.__game.paytable.show());
await p1.waitForTimeout(500);
await p1.screenshot({ path: "/tmp/final-paytable.png" });
console.log("ok");
await b.close();
