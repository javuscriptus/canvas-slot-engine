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

/** Крутит барабаны. Точка входа могла переехать — ищем её по вариантам. */
function spin(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const fn = g?.requestSpin || g?.spin || g?.machine?.requestSpin || g?.machine?.spin;
    if (typeof fn === "function") return fn.call(fn === g?.machine?.requestSpin || fn === g?.machine?.spin ? g.machine : g);
    throw new Error("не найдена точка входа спина на window.__game");
  });
}

/** Ждёт одного из состояний автомата, где бы оно ни жило. */
async function waitState(page, want, timeout = 30000) {
  await page
    .waitForFunction(
      (states) => {
        const g = window.__game;
        const s = g?.state ?? g?.machine?.state;
        return states.includes(s);
      },
      Array.isArray(want) ? want : [want],
      { timeout }
    )
    .catch(() => {});
}

/* ─────────────────────────── ландшафт ─────────────────────────── */

const land = await open(LANDSCAPE);
await shot(land.page, "01-idle-landscape");

// Спин: кадр в середине вращения — видно смаз и физику барабанов.
await spin(land.page);
await land.page.waitForTimeout(420);
await shot(land.page, "02-spinning");

// Ждём окончания презентации выигрыша и снимаем итог.
await waitState(land.page, "idle");
await land.page.waitForTimeout(600);
await shot(land.page, "03-after-spin");

// Крутим, пока не поймаем выигрыш: подсветка линий — ключевой кадр.
for (let i = 0; i < 40; i++) {
  await spin(land.page);
  await waitState(land.page, ["presenting", "idle"]);
  const win = await land.page.evaluate(() => window.__game?.lastWin ?? 0);
  if (win > 0) {
    await land.page.waitForTimeout(500);
    await shot(land.page, "04-win");
    break;
  }
  await waitState(land.page, "idle");
}

// Модалки ищутся по нескольким возможным путям: структура клиента
// переезжает, а стенд обязан переживать переименования — иначе он падает
// на рефакторинге ровно тогда, когда кадры нужнее всего.
async function openModal(page, names) {
  return page.evaluate((keys) => {
    const g = window.__game;
    const roots = [g, g?.ui, g?.modals, g?.overlays, g?.scene];
    for (const root of roots) {
      if (!root) continue;
      for (const key of keys) {
        const m = root[key];
        if (m && typeof m.show === "function") {
          m.show();
          return key;
        }
      }
    }
    return null;
  }, names);
}

async function closeModal(page, names) {
  await page.evaluate((keys) => {
    const g = window.__game;
    const roots = [g, g?.ui, g?.modals, g?.overlays, g?.scene];
    for (const root of roots) {
      if (!root) continue;
      for (const key of keys) {
        const m = root[key];
        if (m && typeof m.hide === "function") m.hide();
      }
    }
  }, names);
}

const PAYTABLE = ["paytable", "paytableModal", "infoModal"];
const AUTOPLAY = ["autoplayModal", "autoplay", "autoModal"];

if (await openModal(land.page, PAYTABLE)) {
  await land.page.waitForTimeout(600);
  await shot(land.page, "05-paytable");
  await closeModal(land.page, PAYTABLE);
  await land.page.waitForTimeout(300);
}

if (await openModal(land.page, AUTOPLAY)) {
  await land.page.waitForTimeout(500);
  await shot(land.page, "06-autoplay");
  await closeModal(land.page, AUTOPLAY);
}

/* ──────────────────────────── портрет ─────────────────────────── */

const port = await open(PORTRAIT);
await shot(port.page, "07-idle-portrait");
await spin(port.page);
await port.page.waitForTimeout(420);
await shot(port.page, "08-portrait-spinning");

/* ───────────────────────────── итог ───────────────────────────── */

const errors = [...new Set([...land.errors, ...port.errors])];
await browser.close();

console.log(JSON.stringify({ ok: true, shots, errors }, null, 2));
if (errors.length) process.exitCode = 0; // ошибки не валят стенд, но видны в отчёте
