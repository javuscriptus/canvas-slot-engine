import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await p.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: "/tmp/look-idle.png" });

// спин до выигрыша, снимок в момент показа
for (let i = 0; i < 25; i++) {
  await p.evaluate(() => window.__game.requestSpin());
  await p.waitForFunction(() => window.__game.state === "idle" || window.__game.state === "presenting", { timeout: 20000 }).catch(()=>{});
  const w = await p.evaluate(() => window.__game.lastWin);
  if (w > 0) { await p.waitForTimeout(700); await p.screenshot({ path: "/tmp/look-win.png" }); break; }
  await p.waitForTimeout(120);
}
console.log(errs.length ? "ошибки: " + errs.slice(0,4).join(" | ") : "ошибок нет ✓");
await b.close();
