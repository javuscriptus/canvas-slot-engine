// Сменяемость темы в браузере: обе темы поднимаются, играют и снимаются.
//
// Тесты в client/test/ проверяют контракт темы по коду; здесь проверяется
// то, чего код не покажет, — что игра на второй теме действительно
// запускается, крутит барабаны и не сыплет ошибками. Кадры кладутся рядом
// именами <тема>-<кадр>.png, чтобы разницу можно было посмотреть глазами:
// две темы, отличающиеся только id, ничего не доказывают.
//
//   node tools/preview/themes.mjs [--out .shots-themes] [--port 3111]

import { chromium } from "playwright";
import fs from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const PORT = arg("port", "3111");
const OUT = arg("out", ".shots-themes");
const THEMES = arg("themes", "sochi,neon").split(",");

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const report = [];

for (const theme of THEMES) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  // Заставку снимаем отдельным кадром: под ней не видно ни панели, ни поля.
  await page.addInitScript((names) => {
    for (const n of names) { try { localStorage.setItem(`${n}.skipIntro`, "1"); } catch {} }
  }, THEMES);
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(`http://localhost:${PORT}/?theme=${theme}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });
  await page.waitForTimeout(700);

  const id = await page.evaluate(() => window.__game.theme.id);
  await page.screenshot({ path: `${OUT}/${theme}-idle.png` });

  // Крутим, пока не выпадет выигрыш: показ линий и всплывающей суммы —
  // самая «тематическая» часть кадра.
  let win = 0;
  for (let i = 0; i < 25 && win === 0; i++) {
    await page.evaluate(() => window.__game.requestSpin());
    await page.waitForTimeout(2600);
    win = await page.evaluate(() => window.__game.lastWin);
  }
  await page.screenshot({ path: `${OUT}/${theme}-win.png` });

  await page.evaluate(() => window.__game.paytable.show());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${theme}-paytable.png` });

  const state = await page.evaluate(() => ({
    state: window.__game.state,
    fps: Math.round(window.__game.ticker.fps)
  }));
  await page.close();

  const intro = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  intro.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await intro.goto(`http://localhost:${PORT}/?theme=${theme}`, { waitUntil: "domcontentloaded" });
  await intro.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });
  await intro.waitForTimeout(900);
  await intro.screenshot({ path: `${OUT}/${theme}-intro.png` });
  await intro.close();

  const ok = id === theme && errors.length === 0;
  console.log(`${ok ? "✓" : "✗"} ${theme}: подключилась «${id}», ${JSON.stringify(state)}, выигрыш ${win}`);
  for (const e of errors) console.log("   " + e);
  report.push({ theme, id, ok, win, ...state, errors });
}

await browser.close();
const bad = report.filter((r) => !r.ok);
console.log(bad.length
  ? `\n✗ тем с ошибками: ${bad.map((r) => r.theme).join(", ")}`
  : `\n✓ все темы поднимаются и играют; кадры в ${OUT}`);
process.exitCode = bad.length ? 1 : 0;
