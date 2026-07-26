// Снимает набор скриншотов реальной игры для визуальной оценки.
//
// Стенд запускается против поднятого сервера и складывает кадры в каталог.
// Нужен ровно для одного: чтобы визуальное качество можно было оценивать
// по картинке, а не по описанию кода.
//
//   node tools/preview/capture.mjs --out <каталог> [--port 3111] [--tag base]
//
// Кадры: landscape idle, landscape spin, landscape win, портрет, таблица
// выплат, автоигра. Имена файлов начинаются с тега, поэтому прогоны
// разных версий кладутся рядом и сравниваются попарно.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = arg("out", "shots");
const PORT = arg("port", "3111");
const TAG = arg("tag", "shot");
const URL = `http://localhost:${PORT}/`;

const LANDSCAPE = { width: 1280, height: 720 };
const PORTRAIT = { width: 520, height: 980 };

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [];

async function shot(page, name) {
  const file = path.join(OUT, `${TAG}-${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  return file;
}

/** Ждёт готовности игры; бросает с текстом ошибки со страницы, если не поднялась. */
async function open(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => window.__gameReady === true, { timeout: 30000 });
  } catch {
    const visible = await page.evaluate(() => document.getElementById("error-text")?.textContent || "");
    throw new Error(`игра не поднялась: ${visible || errors.slice(0, 3).join(" | ") || "таймаут"}`);
  }
  await page.waitForTimeout(1500);
  return { page, errors };
}

/* ─────────────────────────── ландшафт ─────────────────────────── */

const land = await open(LANDSCAPE);
await shot(land.page, "01-idle-landscape");

// Спин: кадр в середине вращения — видно смаз и физику барабанов.
await land.page.evaluate(() => window.__game.requestSpin());
await land.page.waitForTimeout(420);
await shot(land.page, "02-spinning");

// Ждём окончания презентации выигрыша и снимаем итог.
await land.page.waitForFunction(() => window.__game.state === "idle", { timeout: 30000 }).catch(() => {});
await land.page.waitForTimeout(600);
await shot(land.page, "03-after-spin");

// Крутим, пока не поймаем выигрыш: подсветка линий — ключевой кадр.
for (let i = 0; i < 40; i++) {
  await land.page.evaluate(() => window.__game.requestSpin());
  await land.page.waitForFunction(() => window.__game.state === "presenting" || window.__game.state === "idle", { timeout: 30000 }).catch(() => {});
  const win = await land.page.evaluate(() => window.__game.lastWin);
  if (win > 0) {
    await land.page.waitForTimeout(500);
    await shot(land.page, "04-win");
    break;
  }
  await land.page.waitForFunction(() => window.__game.state === "idle", { timeout: 30000 }).catch(() => {});
}

await land.page.evaluate(() => window.__game.paytable.show());
await land.page.waitForTimeout(600);
await shot(land.page, "05-paytable");
await land.page.evaluate(() => window.__game.paytable.hide());

await land.page.evaluate(() => window.__game.autoplayModal.show());
await land.page.waitForTimeout(500);
await shot(land.page, "06-autoplay");

/* ──────────────────────────── портрет ─────────────────────────── */

const port = await open(PORTRAIT);
await shot(port.page, "07-idle-portrait");
await port.page.evaluate(() => window.__game.requestSpin());
await port.page.waitForTimeout(420);
await shot(port.page, "08-portrait-spinning");

/* ───────────────────────────── итог ───────────────────────────── */

const errors = [...new Set([...land.errors, ...port.errors])];
await browser.close();

console.log(JSON.stringify({ ok: true, shots, errors }, null, 2));
if (errors.length) process.exitCode = 0; // ошибки не валят стенд, но видны в отчёте
