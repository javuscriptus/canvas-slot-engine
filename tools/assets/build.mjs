// Реестр производителей арта.
//
//   node tools/assets/build.mjs                  — собрать всё
//   node tools/assets/build.mjs --only symbols   — только символы
//   node tools/assets/build.mjs --only ui,logo   — несколько семейств
//   node tools/assets/build.mjs --list           — что вообще есть
//   node tools/assets/build.mjs --sheet          — плюс контрольный лист
//
// Почему реестр, а не линейный скрипт. Над артом работают несколько
// агентов сразу, и каждому нужно пересобирать СВОЁ семейство за секунды,
// не трогая чужое и не ломая манифест. Поэтому:
//
//   • каждое семейство живёт в producers/<имя>.mjs и собирается само;
//   • манифест не переписывается целиком, а ДОПОЛНЯЕТСЯ — частичная
//     сборка не может потерять чужие кадры;
//   • атласы, которые не пересобирались, остаются на диске как есть.
//
// Контракт производителя (producers/<имя>.mjs, default export):
//
//   {
//     name: "symbols",
//     describe: "12 игровых символов",
//     async build(ctx) {
//       return {
//         atlases: { symbols: [ {name, buffer, width, height, slice?} ] },
//         images:  [ {name, buffer, width, height, photographic?} ],
//         manifest: { … кусок манифеста … }
//       };
//     }
//   }
//
// Всё поля необязательны: производитель может отдавать только атлас,
// только картинки или только кусок манифеста.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { chromium } from "playwright";
import sharp from "sharp";

import { packAtlas } from "./pack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const OUT = path.join(ROOT, "client/assets");
export const ART = path.join(ROOT, "art");
export const DOWNLOADED = path.join(ROOT, "art/downloaded");
export const RENDERED = path.join(__dirname, "rendered");
const PRODUCERS_DIR = path.join(__dirname, "producers");

/* ────────────────────────── общие утилиты ───────────────────────── */

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

/**
 * Свой арт важнее сгенерированного.
 * Как только появляется нарисованный или купленный файл, он кладётся
 * в art/<kind>/<имя>.png и подменяет генерацию. Имена кадров при этом
 * не меняются, поэтому клиент ничего не замечает.
 */
async function findOverride(kind, name) {
  for (const ext of ["png", "webp"]) {
    const f = path.join(ART, kind, `${name}.${ext}`);
    if (await exists(f)) return f;
  }
  return null;
}

/** Растр, посчитанный отдельным инструментом (пейзажи из scenery.py). */
async function findRendered(kind, name) {
  for (const ext of ["webp", "png"]) {
    const f = path.join(RENDERED, kind, `${name}.${ext}`);
    if (await exists(f)) return f;
  }
  return null;
}

async function loadOverride(file, targetPx) {
  const buffer = await sharp(file)
    .resize(targetPx, targetPx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { buffer, width: targetPx, height: targetPx };
}

function svgSize(svg) {
  const m = svg.match(/width="([\d.]+)"\s+height="([\d.]+)"/);
  if (!m) throw new Error("В SVG нет width/height — размер кадра неизвестен");
  return { width: parseFloat(m[1]), height: parseFloat(m[2]) };
}

/* ───────────────────────── контекст сборки ──────────────────────── */

/**
 * Браузер поднимается ЛЕНИВО и ровно один раз на всю сборку.
 * Старт Chromium — почти секунда; при шести производителях подряд это
 * заметно, а при пересборке одного семейства не нужен вовсе (например,
 * scenery работает на sharp и SVG не растеризует).
 */
function makeContext(log) {
  let browser = null;
  const ctx = {
    ROOT, OUT, ART, DOWNLOADED, RENDERED,
    log,
    exists, findOverride, findRendered, loadOverride, svgSize,

    async browser() {
      if (!browser) {
        browser = await chromium.launch({
          args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
        });
      }
      return browser;
    },

    /**
     * rasterize(items, scale) — SVG → PNG-буферы одной сессией браузера.
     * @param {Array<{name:string, svg:string, slice?:object}>} items
     * @param {number} scale  во сколько раз пиксели крупнее проектных
     */
    async rasterize(items, scale = 2) {
      if (!items.length) return [];
      const sized = items.map((it) => ({ ...it, ...svgSize(it.svg) }));
      // Вьюпорт обязан вмещать самый широкий ассет целиком: скриншот
      // элемента режется по видимой области, и фон 1920 px в окне 1280 px
      // потерял бы правый край вместе со всем, что на нём нарисовано.
      const maxW = Math.max(...sized.map((s) => s.width));
      const maxH = Math.max(...sized.map((s) => s.height));

      const page = await (await ctx.browser()).newPage({
        deviceScaleFactor: scale,
        viewport: { width: Math.ceil(maxW) + 64, height: Math.ceil(maxH) + 64 }
      });
      await page.setContent(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          html,body{margin:0;padding:0;background:transparent}
          .cell{display:inline-block;width:max-content;line-height:0;vertical-align:top}
          svg{display:block}
        </style></head><body>
          ${sized.map((it, i) => `<div class="cell" id="c${i}">${it.svg}</div>`).join("")}
        </body></html>`,
        { waitUntil: "load" }
      );
      await page.evaluate(() => document.fonts.ready);

      const out = [];
      for (let i = 0; i < sized.length; i++) {
        const el = await page.$(`#c${i}`);
        out.push({
          name: sized[i].name,
          slice: sized[i].slice || null,
          buffer: await el.screenshot({ omitBackground: true }),
          width: Math.round(sized[i].width * scale),
          height: Math.round(sized[i].height * scale)
        });
      }
      await page.close();
      return out;
    },

    async close() { if (browser) { await browser.close(); browser = null; } }
  };
  return ctx;
}

/* ──────────────────────── загрузка реестра ──────────────────────── */

export async function loadProducers() {
  if (!(await exists(PRODUCERS_DIR))) return [];
  const files = (await fs.readdir(PRODUCERS_DIR))
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("_"))
    .sort();
  const list = [];
  for (const f of files) {
    const mod = await import(new URL(`./producers/${f}`, import.meta.url).href);
    const p = mod.default;
    if (!p || typeof p.build !== "function") {
      console.warn(`  producers/${f}: нет default-экспорта с build() — пропущен`);
      continue;
    }
    list.push({ ...p, name: p.name || path.basename(f, ".mjs"), file: f });
  }
  return list;
}

/* ─────────────────────────── запись ─────────────────────────────── */

/**
 * Манифест ДОПОЛНЯЕТСЯ, а не переписывается.
 *
 * Иначе `--only symbols` стёр бы записи об UI и фонах, и клиент упал бы
 * на первом же обращении к несуществующему кадру. Слияние поверхностное
 * по секциям — этого достаточно, структура манифеста плоская.
 */
function mergeManifest(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v)
      ? { ...(base[k] || {}), ...v }
      : v;
  }
  return out;
}

async function writeImage(name, buffer, { photographic = false, quality = 82 } = {}) {
  // Фоны уходят в WebP, всё остальное остаётся PNG.
  //
  // У отрисованного пейзажа есть плёночное зерно, и PNG на нём бессилен:
  // каждый пиксель отличается от соседа, сжимать нечего. Кнопки и рамки
  // остаются PNG — у них резкие края и альфа, а лоссы на прозрачном
  // контуре дают заметный ореол.
  const file = `img/${name}.${photographic ? "webp" : "png"}`;
  const dest = path.join(OUT, file);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (photographic) {
    await sharp(buffer).webp({ quality, effort: 6 }).toFile(dest);
    await fs.rm(path.join(OUT, `img/${name}.png`), { force: true });
  } else {
    await sharp(buffer).png({ compressionLevel: 9, effort: 10 }).toFile(dest);
    await fs.rm(path.join(OUT, `img/${name}.webp`), { force: true });
  }
  const meta = await sharp(dest).metadata();
  return { file, w: meta.width, h: meta.height };
}

/* ──────────────────────────── сборка ────────────────────────────── */

export async function build({ only = null, sheet = false, quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const all = await loadProducers();
  if (!all.length) throw new Error(`Нет ни одного производителя в ${PRODUCERS_DIR}`);

  const wanted = only
    ? all.filter((p) => only.includes(p.name))
    : all;
  if (only) {
    const missing = only.filter((n) => !all.some((p) => p.name === n));
    if (missing.length) {
      throw new Error(`Неизвестные семейства: ${missing.join(", ")}. ` +
        `Есть: ${all.map((p) => p.name).join(", ")}`);
    }
  }

  await fs.mkdir(path.join(OUT, "atlas"), { recursive: true });
  await fs.mkdir(path.join(OUT, "img"), { recursive: true });

  const ctx = makeContext(log);
  ctx.writeImage = writeImage;
  ctx.packAtlas = packAtlas;

  let manifest = {};
  const manifestFile = path.join(OUT, "manifest.json");
  if (await exists(manifestFile)) {
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  }

  const sheets = [];
  const t0 = Date.now();

  try {
    for (const p of wanted) {
      const t = Date.now();
      log(`→ ${p.name}${p.describe ? ` — ${p.describe}` : ""}`);
      const res = (await p.build(ctx)) || {};

      // атласы
      for (const [atlasName, frames] of Object.entries(res.atlases || {})) {
        if (!frames.length) continue;
        const info = await packAtlas(frames, {
          outPng: path.join(OUT, `atlas/${atlasName}.png`),
          outJson: path.join(OUT, `atlas/${atlasName}.json`),
          maxWidth: 2048
        });
        log(`   атлас ${atlasName}: ${info.atlasW}×${info.atlasH}, ${info.count} кадров`);
        manifest.atlases = {
          ...(manifest.atlases || {}),
          [atlasName]: { json: `atlas/${atlasName}.json`, image: `atlas/${atlasName}.png` }
        };
      }

      // отдельные картинки
      if (res.images?.length) {
        const images = { ...(manifest.images || {}) };
        for (const img of res.images) {
          images[img.name] = await writeImage(img.name, img.buffer, {
            photographic: img.photographic ?? img.name.startsWith("bg_")
          });
        }
        manifest.images = images;
        log(`   картинок: ${res.images.length}`);
      }

      if (res.manifest) manifest = mergeManifest(manifest, res.manifest);
      if (res.sheet) sheets.push(...res.sheet);

      log(`   ${((Date.now() - t) / 1000).toFixed(1)} с`);
    }

    if (sheet && sheets.length) await contactSheet(ctx, sheets);
  } finally {
    await ctx.close();
  }

  // Версия — хеш от содержимого всех атласов на диске. Меняется ровно
  // тогда, когда изменилась графика, поэтому кеш игроков сбрасывается
  // когда нужно и ни разу лишний раз.
  const hash = crypto.createHash("sha1");
  for (const name of Object.keys(manifest.atlases || {}).sort()) {
    const f = path.join(OUT, manifest.atlases[name].image);
    if (await exists(f)) hash.update(await fs.readFile(f));
  }
  manifest.version = hash.digest("hex").slice(0, 10);

  // Звук собирается своим инструментом, но ссылка на него живёт здесь.
  manifest.audio = manifest.audio ||
    { sprite: "audio/sfx.json", files: ["audio/sfx.webm", "audio/sfx.mp3"] };

  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));

  const total = await du(OUT);
  log(`✓ ${wanted.map((p) => p.name).join(", ")} — ` +
      `${((Date.now() - t0) / 1000).toFixed(1)} с, ` +
      `${(total / 1024 / 1024).toFixed(2)} МБ в client/assets`);
  return manifest;
}

/** Разовый предпросмотр всех кадров на фоне барабана. */
async function contactSheet(ctx, items) {
  const page = await (await ctx.browser()).newPage({ deviceScaleFactor: 1 });
  const cell = 180, cols = 8;
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;width:max-content;
         background:linear-gradient(160deg,#2A0B45,#160726 55%,#0B0413);
         display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px}
    .c{width:${cell}px;height:${cell}px;display:flex;align-items:center;justify-content:center;
       background:rgba(255,255,255,.05);border-radius:10px;position:relative;overflow:hidden}
    .c img{max-width:100%;max-height:100%}
    .l{position:absolute;bottom:2px;left:0;right:0;text-align:center;color:#fff9;font:10px sans-serif}
  </style></head><body>
    ${items.map((it) => `<div class="c"><img src="data:image/png;base64,${it.buffer.toString("base64")}"><div class="l">${it.name}</div></div>`).join("")}
  </body></html>`, { waitUntil: "load" });
  const file = path.join(__dirname, "probe/_contact.png");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  console.log(`   контрольный лист → ${file}`);
}

async function du(dir) {
  let sum = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sum += await du(p);
    else sum += (await fs.stat(p)).size;
  }
  return sum;
}

/* ────────────────────────────── CLI ─────────────────────────────── */

function parseArgs(argv) {
  const out = { only: null, sheet: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only" || a === "-o") out.only = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--only=")) out.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--sheet") out.sheet = true;
    else if (a === "--list" || a === "-l") out.list = true;
  }
  if (out.only && !out.only.length) out.only = null;
  return out;
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    const all = await loadProducers();
    console.log("Семейства арта:");
    for (const p of all) console.log(`  ${p.name.padEnd(12)} ${p.describe || ""}`);
    console.log("\n  node tools/assets/build.mjs --only <имя>[,<имя>…]");
  } else {
    await build(args).catch((err) => { console.error(err); process.exit(1); });
  }
}
