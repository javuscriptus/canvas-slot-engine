import { chromium } from "playwright";
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
await page.goto(process.env.URL || "http://localhost:3111/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });

// Подменяем сеть: сценарий «3 скаттера → 4 фриспина, один с ретригером и множителем»
await page.evaluate(() => {
  const g = window.__game;
  const S = 11, W = 10;
  const scr = (a) => a;
  g.api.spin = async () => ({
    roundId: "test-round", bet: 1, totalWin: 2, state: "free", balance: 999,
    freeSpins: { total: 4, left: 4, played: 0, win: 0 },
    spins: [{ index:0, type:"base", screen: [[S,3,4,S,5],[1,2,S,6,7],[8,9,0,1,2]],
      scatterCount: 3, win: 2,
      wins: [{ type:"scatter", symbol:S, count:3, payout:2, multiplier:1, amount:2,
        positions:[{reel:0,row:0},{reel:3,row:0},{reel:2,row:1}] }] }]
  });
  let n = 0;
  g.api.freeSpin = async () => {
    n++;
    const left = 4 - n + (n === 2 ? 5 : 0);
    const win = n === 2 ? 45 : (n === 1 ? 3 : 0);
    return {
      roundId: "test-round", bet: 1, totalWin: 2 + win, state: left > 0 ? "free" : "complete",
      balance: 999 + win, freeSpins: { total: n===2?9:4, left, played: n, win: win + (n>1?3:0) },
      spins: [{ index:n, type:"free", screen: [[W,0,0,0,5],[1,2,3,6,7],[8,9,0,1,2]],
        scatterCount: n===2?3:0, retrigger: n===2?5:0, win,
        wins: win>0 ? [{ type:"line", line:1, symbol:0, count:4, payout:200, multiplier:n===2?3:1,
          multipliers:[n===2?3:1], amount:win,
          positions:[{reel:0,row:0},{reel:1,row:0},{reel:2,row:0},{reel:3,row:0}] }] : [] }]
    };
  };
});

await page.evaluate(() => window.__game.requestSpin());
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/bf-1-scatter.png" });
await page.waitForTimeout(2200);
await page.screenshot({ path: "/tmp/bf-2-announce.png" });
await page.waitForTimeout(4000);
await page.screenshot({ path: "/tmp/bf-3-freespin.png" });
await page.waitForFunction(() => window.__game.state === "idle", { timeout: 60000 }).catch(()=>{});
await page.screenshot({ path: "/tmp/bf-4-end.png" });

const st = await page.evaluate(() => ({ state: window.__game.state, freeMode: window.__game.freeMode }));
console.log("после бонуса:", JSON.stringify(st));
await browser.close();
if (errors.length) { console.log("⚠ ошибки:"); errors.slice(0,10).forEach(e=>console.log("  "+e)); }
else console.log("✓ ошибок нет");
