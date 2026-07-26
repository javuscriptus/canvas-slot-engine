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
  const reel = g.reelSet.reels[0];
  const track = [];
  const off = g.ticker.onTick.add((dt) => {
    track.push({ t: g.ticker.time, total: reel.total, state: reel.state, dt });
  });
  g.requestSpin();
  await new Promise((res) => {
    const iv = setInterval(() => {
      if (g.reelSet.reels.every(r => r.state === "idle") && track.length > 30) { clearInterval(iv); res(); }
    }, 50);
  });
  off();

  // скорость и рывок (производная ускорения) по записи
  const v = [], a = [];
  for (let i = 1; i < track.length; i++) {
    const dt = track[i].t - track[i-1].t;
    if (dt > 0) v.push({ t: track[i].t, v: (track[i].total - track[i-1].total) / dt, state: track[i].state });
  }
  for (let i = 1; i < v.length; i++) {
    const dt = v[i].t - v[i-1].t;
    if (dt > 0) a.push({ t: v[i].t, a: (v[i].v - v[i-1].v) / dt, state: v[i].state });
  }
  const maxV = Math.max(...v.map(x => x.v));
  // ищем кадр, где скорость скакнула сильнее всего
  let jump = 0, jumpAt = null;
  for (let i = 1; i < v.length; i++) {
    const d = Math.abs(v[i].v - v[i-1].v);
    if (d > jump) { jump = d; jumpAt = v[i].state; }
  }
  const totalTime = track[track.length-1].t - track[0].t;
  const states = {};
  for (const s of track) states[s.state] = (states[s.state]||0)+1;
  return {
    длительностьСпина: +totalTime.toFixed(2),
    максСкорость: +maxV.toFixed(1),
    максСкачокСкоростиЗаКадр: +jump.toFixed(1),
    скачокВСостоянии: jumpAt,
    доляОтМаксСкорости: +(jump/maxV).toFixed(3),
    кадровПоСостояниям: states,
    финальнаяПозиция: +reel.total.toFixed(4),
    выровненаПоСетке: Math.abs(reel.total - Math.round(reel.total)) < 1e-6
  };
});
console.log(JSON.stringify(r, null, 1));
console.log(r.доляОтМаксСкорости < 0.2 && r.выровненаПоСетке
  ? "✓ движение непрерывное, барабан выровнен по сетке"
  : "✗ есть разрыв скорости");
if (errs.length) console.log("ошибки:", errs.slice(0,3));
await b.close();
