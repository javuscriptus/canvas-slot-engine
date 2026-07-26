import { chromium } from "playwright";
const URL = process.env.URL || "http://localhost:3111/";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => {
  // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
  // только мешала бы: её затемнение перехватывает нажатия.
  try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
});

const errors = [];
page.on("console", m => { if (m.type()==="error") errors.push("console: "+m.text()); });
page.on("pageerror", e => errors.push("pageerror: "+e.message));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });
await page.evaluate(() => { window.__game.turbo = true; });

// 30 реальных спинов
let wins = 0, best = 0, shots = 0;
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => window.__game.requestSpin());
  await page.waitForFunction(() => window.__game.state === "idle" || window.__game.state === "presenting",
    { timeout: 20000 }).catch(()=>{});
  const w = await page.evaluate(() => window.__game.lastWin);
  if (w > 0) {
    wins++;
    if (w > best) best = w;
    if (shots < 2) { await page.screenshot({ path: `/tmp/shot-win${shots}.png` }); shots++; }
  }
  await page.waitForTimeout(180);
}
console.log(`30 спинов: выигрышных ${wins}, лучший ${best.toFixed(2)}`);

// Визуальная проверка баннеров и фриспинов (синтетические данные)
await page.evaluate(() => {
  const g = window.__game;
  g.reelSet.showWinningCells([{reel:0,row:1},{reel:1,row:1},{reel:2,row:1},{reel:3,row:1},{reel:4,row:1}], {dim:true});
  g.winPresenter.lines.show([0]);
  g.winPresenter.playBigWin({key:"mega",banner:"banner_mega",sound:"fanfare",duration:4.2}, 250, 1);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: "/tmp/shot-bigwin.png" });

await page.evaluate(() => { window.__game.winPresenter.clear(); window.__game.winPresenter.announceFreeSpins(10); });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/shot-freespins.png" });

await page.evaluate(() => { window.__game.winPresenter.clear(); window.__game._enterFreeMode(); window.__game.freeSpinBadge.show(7,10); });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/shot-freemode.png" });

const perf = await page.evaluate(() => ({ fps: Math.round(window.__game.ticker.fps), draws: window.__game.renderer.drawCalls }));
console.log("производительность:", JSON.stringify(perf));
await browser.close();
if (errors.length) { console.log("⚠ ошибки:"); errors.slice(0,10).forEach(e=>console.log("  "+e)); }
else console.log("✓ ошибок нет");
