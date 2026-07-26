import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
  await p.addInitScript(() => {
    // Заставка — предмет отдельного стенда (intro.mjs). Здесь она
    // только мешала бы: её затемнение перехватывает нажатия.
    try { localStorage.setItem("sochi.skipIntro", "1"); } catch {}
  });

const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:3111/", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__gameReady === true, { timeout: 25000 });

const r = await p.evaluate(async () => {
  const g = window.__game;
  const results = { spins: 0, mismatches: [], durations: [], aligned: 0 };

  const runSpin = async (turbo, useStop) => {
    g.turbo = turbo;
    const t0 = performance.now();
    const promise = g.requestSpin();
    if (useStop) {
      await new Promise(r => setTimeout(r, 500));
      g.requestStop();
    }
    await promise;
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (g.reelSet.reels.every(x => x.state === "idle")) { clearInterval(iv); res(); }
      }, 30);
    });
    results.durations.push(+((performance.now()-t0)/1000).toFixed(2));

    // сверяем то, что видно, с тем, что прислал сервер
    const screen = g.currentRound.spins[g.currentRound.spins.length-1].screen;
    for (let reel = 0; reel < 5; reel++) {
      const vis = g.reelSet.reels[reel].visible;
      for (let row = 0; row < 3; row++) {
        if (vis[row] !== screen[row][reel]) {
          results.mismatches.push(`барабан ${reel} ряд ${row}: на экране ${vis[row]}, сервер прислал ${screen[row][reel]}`);
        }
      }
      const t = g.reelSet.reels[reel].total;
      if (Math.abs(t - Math.round(t)) < 1e-6) results.aligned++;
    }
    results.spins++;
  };

  for (let i = 0; i < 4; i++) await runSpin(false, false);
  for (let i = 0; i < 3; i++) await runSpin(true, false);
  for (let i = 0; i < 3; i++) await runSpin(false, true);   // с кнопкой «Стоп»
  return results;
});

console.log(`спинов: ${r.spins}`);
console.log(`расхождений символов: ${r.mismatches.length}`, r.mismatches.length ? "✗" : "✓ экран всегда равен ответу сервера");
r.mismatches.slice(0,5).forEach(m => console.log("  " + m));
console.log(`барабанов выровнено по сетке: ${r.aligned} из ${r.spins*5}`, r.aligned === r.spins*5 ? "✓" : "✗");
console.log(`длительность спинов, с: обычные ${r.durations.slice(0,4).join(", ")} | турбо ${r.durations.slice(4,7).join(", ")} | со «Стоп» ${r.durations.slice(7).join(", ")}`);
if (errs.length) console.log("ошибки:", errs.slice(0,3)); else console.log("ошибок нет ✓");
await b.close();
