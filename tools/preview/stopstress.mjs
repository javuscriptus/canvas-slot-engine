// Нагрузочная проверка кнопки «Стоп».
//
// Ошибка, ради которой написан этот стенд, была плавающей: барабан вставал
// на чужих символах примерно в одном случае из тридцати, и только если
// «Стоп» нажат в определённой фазе. Обычный прогон её не ловил, поэтому
// здесь спины гоняются десятками с РАЗНОЙ задержкой нажатия — важно
// покрыть и разгон, и ровное вращение, и момент штатной остановки.
//
//   node tools/preview/stopstress.mjs [число_спинов]

import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:3111/";
const TOTAL = parseInt(process.argv[2] || "60", 10);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
  // только мешала бы: её затемнение перехватывает нажатия.
  try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
});

const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });

const r = await page.evaluate(async (total) => {
  const g = window.__game;
  const out = { spins: 0, mismatches: [], minShift: 99, aligned: 0, delays: [] };

  const idle = () => new Promise((res) => {
    const iv = setInterval(() => {
      if (g.reelSet.reels.every((x) => x.state === "idle")) { clearInterval(iv); res(); }
    }, 20);
  });

  for (let i = 0; i < total; i++) {
    g.turbo = i % 3 === 2;
    // Задержка гуляет по всей длине спина: 0 мс — «Стоп» раньше ответа
    // сервера, 900 мс — уже во время штатной остановки барабанов.
    const delay = (i * 37) % 900;
    out.delays.push(delay);

    const pr = g.requestSpin();
    await new Promise((res) => setTimeout(res, delay));
    g.requestStop();
    await pr;
    await idle();

    const rd = g.currentRound;
    const screen = rd.spins[rd.spins.length - 1].screen;
    for (let reel = 0; reel < 5; reel++) {
      const vis = g.reelSet.reels[reel].visible;
      for (let row = 0; row < 3; row++) {
        if (vis[row] !== screen[row][reel]) {
          out.mismatches.push(`спин ${i} (задержка ${delay} мс) барабан ${reel} ряд ${row}: ` +
            `на экране ${vis[row]}, сервер прислал ${screen[row][reel]}`);
        }
      }
      const t = g.reelSet.reels[reel].total;
      if (Math.abs(t - Math.round(t)) < 1e-6) out.aligned++;
    }
    out.spins++;
    // Бонус ломает схему сравнения (экран уже от фриспина) — выходим,
    // проверка кнопки «Стоп» к нему отношения не имеет.
    if (g.freeMode) break;
  }
  return out;
}, TOTAL);

console.log(`спинов со «Стоп»: ${r.spins}, ячеек проверено: ${r.spins * 15}`);
console.log(`задержки нажатия, мс: ${Math.min(...r.delays)}…${Math.max(...r.delays)}`);
console.log(`расхождений символов: ${r.mismatches.length}`,
  r.mismatches.length ? "✗" : "✓ экран всегда равен ответу сервера");
r.mismatches.slice(0, 6).forEach((m) => console.log("  " + m));
console.log(`барабанов выровнено по сетке: ${r.aligned} из ${r.spins * 5}`,
  r.aligned === r.spins * 5 ? "✓" : "✗");
if (errs.length) console.log("ошибки:", errs.slice(0, 3));
else console.log("ошибок нет ✓");

await browser.close();
process.exit(r.mismatches.length || errs.length ? 1 : 0);
