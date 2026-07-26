import { chromium } from "playwright";
const DPR = Number(process.env.DPR || 1);
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: DPR });
await page.addInitScript(() => {
  // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
  // только мешала бы: её затемнение перехватывает нажатия.
  try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
});

const errs = [];
page.on("pageerror", e => errs.push("pageerror: " + e.message));
page.on("console", m => { if (m.type()==="error") errs.push("console: " + m.text()); });
await page.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });
await page.waitForTimeout(600);

// где по мнению движка находится кнопка спина и попадаем ли мы по ней
const info = await page.evaluate(() => {
  const g = window.__game;
  const b = g.panel.spinButton;
  const m = b.worldMatrix;
  const r = g.renderer;
  return {
    dpr: r.dpr, scale: r.scale, offsetX: r.offsetX, offsetY: r.offsetY,
    canvasCss: [r.canvas.style.width, r.canvas.style.height],
    canvasPx: [r.canvas.width, r.canvas.height],
    btnDesign: [b.x, b.y],
    btnWorld: [m.tx, m.ty]
  };
});
console.log("DPR=" + DPR, JSON.stringify(info, null, 1));

// кликаем ровно в центр кнопки спина по экранным координатам
const rect = await page.evaluate(() => {
  const g = window.__game;
  const b = g.panel.spinButton;
  const r = g.renderer.canvas.getBoundingClientRect();
  return { x: r.left + g.renderer.offsetX + b.x * g.renderer.scale,
           y: r.top + g.renderer.offsetY + b.y * g.renderer.scale };
});
const before = await page.evaluate(() => window.__game.state);
await page.mouse.click(rect.x, rect.y);
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.__game.state);
console.log(`клик по кнопке спина: состояние ${before} -> ${after}`, after !== "idle" ? "✓ сработало" : "✗ КНОПКА НЕ РЕАГИРУЕТ");

await page.waitForTimeout(1200);
await page.screenshot({ path: `/tmp/diag-dpr${DPR}.png` });
if (errs.length) console.log("ошибки:", errs.slice(0,5));
await browser.close();
