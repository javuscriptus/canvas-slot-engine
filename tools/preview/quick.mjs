import { chromium } from "playwright";
const DPR = Number(process.env.DPR || 2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: DPR });
  await p.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

const errs = [];
p.on("pageerror", e => errs.push(e.message));
p.on("console", m => { if (m.type()==="error") errs.push(m.text()); });
const t0 = Date.now();
await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
try { await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 }); }
catch { console.log("НЕ ЗАГРУЗИЛОСЬ за 25с"); console.log("ошибки:", errs.slice(0,5)); await b.close(); process.exit(1); }
console.log(`DPR=${DPR} загрузка ${((Date.now()-t0)/1000).toFixed(1)}с`);
await p.waitForTimeout(2000);
const st = await p.evaluate(() => ({ fps: Math.round(window.__game.ticker.fps), draws: window.__game.renderer.drawCalls }));
console.log("fps:", st.fps, "draw calls:", st.draws);
if (errs.length) console.log("ошибки:", errs.slice(0,5)); else console.log("ошибок нет");
await b.close();
