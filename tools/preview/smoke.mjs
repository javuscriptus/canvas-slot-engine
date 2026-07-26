import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:3111/";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

await page.addInitScript(() => {
  // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
  // только мешала бы: её затемнение перехватывает нажатия.
  try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
});

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => errors.push("request: " + r.url() + " " + r.failure()?.errorText));

await page.goto(URL, { waitUntil: "domcontentloaded" });
try {
  await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });
  console.log("✓ игра загрузилась");
} catch {
  console.log("✗ игра не инициализировалась");
  const txt = await page.textContent("#error-text").catch(()=>null);
  if (txt) console.log("  экран ошибки:", txt);
}
await page.screenshot({ path: "/tmp/shot-idle.png" });

// один спин
await page.evaluate(() => window.__game?.requestSpin());
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/shot-spinning.png" });
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/shot-result.png" });

const st = await page.evaluate(() => ({
  state: window.__game?.state,
  balance: window.__game?.balance,
  win: window.__game?.lastWin,
  fps: Math.round(window.__game?.ticker.fps),
  draws: window.__game?.renderer.drawCalls
}));
console.log("состояние после спина:", JSON.stringify(st));

// портрет
await page.setViewportSize({ width: 500, height: 950 });
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/shot-portrait.png" });

// таблица выплат
await page.evaluate(() => window.__game?.paytable.show());
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/shot-paytable.png" });

await browser.close();
if (errors.length) { console.log("\n⚠ ошибки:"); errors.slice(0,15).forEach(e=>console.log("  "+e)); }
else console.log("✓ ошибок в консоли нет");
