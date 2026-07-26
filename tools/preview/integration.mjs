import { chromium } from "playwright";
import { execSync } from "node:child_process";

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1500, height: 860 }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto("http://localhost:3111/lobby-demo.html", { waitUntil: "domcontentloaded" });

await page.waitForFunction(() => {
  const f = document.getElementById("game");
  try { return f.contentWindow.__gameReady === true; } catch { return false; }
}, { timeout: 30000 });
console.log("✓ игра загрузилась ВНУТРИ iframe (CSP frame-ancestors пропустил)");

const gotLoaded = await page.evaluate(() =>
  [...document.querySelectorAll("#log .k")].some((e) => e.textContent === "game.loaded"));
console.log(gotLoaded ? "✓ postMessage: лобби получило game.loaded" : "✗ game.loaded не пришло");

const wsOk = await page.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  return !!(w.__game && w.__game.socket && w.__game.socket.connected);
});
console.log(wsOk ? "✓ WebSocket подключён" : "✗ WebSocket не подключён");

const playerId = await page.evaluate(() =>
  document.getElementById("game").contentWindow.__game.session.player.id);
execSync(
  `WALLET_SECRET=test PORT=3111 node server/src/tools/notify.js --player ${playerId} --event balance --balance 777000`,
  { stdio: "pipe", cwd: "/home/claude/slot" }
);
await page.waitForTimeout(800);
const pushed = await page.evaluate(() =>
  document.getElementById("game").contentWindow.__game.balance);
console.log(pushed === 7770
  ? `✓ push по сокету дошёл: баланс стал ${pushed}`
  : `✗ баланс ${pushed}, ожидали 7770`);

await page.evaluate(() => document.getElementById("game").contentWindow.__game.requestSpin());
await page.waitForTimeout(3400);
const events = await page.evaluate(() =>
  [...document.querySelectorAll("#log .k")].map((e) => e.textContent));
console.log("события в лобби:", [...new Set(events)].join(", "));

await page.click('[data-cmd="pause"]');
await page.waitForTimeout(300);
const paused = await page.evaluate(() => document.getElementById("game").contentWindow.__game._paused);
console.log(paused ? "✓ команда pause применена" : "✗ pause не сработала");
await page.click('[data-cmd="resume"]');
await page.waitForTimeout(200);

await page.screenshot({ path: "/tmp/lobby.png" });
console.log(errs.length ? "ошибки: " + errs.slice(0, 4).join(" | ") : "✓ ошибок нет");
await b.close();
