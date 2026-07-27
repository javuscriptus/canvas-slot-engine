// Обрыв связи во фриспинах: игра не должна остаться в бонусном режиме.
//
// Стенд появился после конкретного дефекта. Режим фриспинов держался
// локальным флагом: связь рвалась посреди серии, серия обрывалась, а игра
// навсегда оставалась в бонусной оболочке — бонусный фон, бонусная музыка,
// индикатор оставшихся спинов — и без единого фриспина. Теперь режим
// восстанавливается из /api/state, то есть с сервера, а не из памяти
// клиента.
//
//   node tools/preview/reconnect.mjs
//
// Стенд идёт минуты: восстановление ходит к серверу с нарастающей паузой,
// и это часть проверяемого поведения.
import { chromium } from "playwright";

const URL = process.env.URL || "http://localhost:3111/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => { try { localStorage.setItem("sochi.skipIntro", "1"); } catch {} });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });

// Загоняем игру в бонус: крутим, пока не выпадут фриспины.
await page.evaluate(async () => {
  const g = window.__game;
  g.turbo = true;
  g.machine.turbo = true;
  for (let i = 0; i < 4000 && !g.freeMode; i++) {
    if (g.state === "idle") await g.requestSpin();
    else await new Promise((r) => setTimeout(r, 40));
  }
});
const entered = await page.evaluate(() => window.__game.freeMode);
console.log("бонус запущен:", entered);

// Рвём связь: и сам фриспин, и восстановление состояния.
await page.route("**/api/freespin", (route) => route.abort());
await page.route("**/api/state", (route) => route.abort());
await page.waitForTimeout(6000);
console.log("во время обрыва:", JSON.stringify(await page.evaluate(() => ({
  free: window.__game.freeMode, state: window.__game.state
}))));

// Связь вернулась, но раунд на сервере уже не бонусный: сервер
// восстановит его сам — в этом стенде важно, что режим не залипает.
await page.unroute("**/api/state");
await page.waitForTimeout(1000);

const after = await page.evaluate(async () => {
  const g = window.__game;
  // Даём восстановлению отработать: попытки идут с нарастающей паузой.
  for (let i = 0; i < 120 && g.freeMode; i++) await new Promise((r) => setTimeout(r, 500));
  return { free: g.freeMode, state: g.state, badge: g.freeSpinBadge.visible };
});
console.log("после восстановления:", JSON.stringify(after));
console.log(after.free === false && after.state === "idle"
  ? "✓ бонусный режим снят, игра вернулась в простой"
  : "✗ игра осталась в бонусном режиме");

await browser.close();
if (errs.length) console.log("⚠ ошибки:", errs.slice(0, 3).join(" | "));
process.exit(after.free === false && after.state === "idle" ? 0 : 1);
