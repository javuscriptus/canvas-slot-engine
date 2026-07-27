// Стенд для рецептов из svg-lib.mjs.
//
//   node tools/assets/probe.mjs                 — весь лист
//   node tools/assets/probe.mjs gem             — один тест
//
// Смысл: любой новый рецепт сначала проверяется здесь глазами на
// тёмном фоне барабана, и только потом идёт в производство символов.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { SOCHI_GEMS, PALETTE as P } from "./palette.mjs";
import {
  svgDoc, namespaceSvg, ngon, pointsAttr, radial, linear, shade,
  LIGHT, bevel, glassGem, metalGold, carvedWood, rimLight, dropContact,
  innerGlow, outerGlow, grain, emboss, defsOf, stack, cutGem, envGold, envSilver, contour
} from "./svg-lib.mjs";
import { detailUri } from "./pbr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "probe");

const S = 512;

/* ─────────────────────────── тесты ──────────────────────────────── */

/** Стеклянный самоцвет: главная проверка фазы. */
function gemProbe(key, sides, rot, geo = {}) {
  const gem = SOCHI_GEMS[key];
  const cx = S / 2, cy = S / 2, r = 176;

  const glass = glassGem("glass", gem, { dome: 8, depth: 34, refraction: 6, edge: 4 });
  const rim = rimLight("rim", shade(gem.lightest, 0.35), 3, { opacity: 0.6, offset: 3.5 });
  const shadow = dropContact("sh", 0.6, { distance: 14, ambientBlur: 22 });
  const halo = outerGlow("halo", gem.glow, { size: 15, opacity: 0.42, haloOpacity: 0.2 });

  return svgDoc(S, S, defsOf(glass, rim, shadow, halo), `
    <g filter="${shadow.ref}">
      <g filter="${halo.ref}">
        <g filter="${rim.ref}">
          <g filter="${glass.ref}">
            ${cutGem(gem, { cx, cy, radius: r, sides, rotation: rot, ...geo })}
          </g>
        </g>
      </g>
    </g>`);
}

/** Золотая пластина по PBR-карте: проверка metalGold. */
function metalProbe(href) {
  const m = metalGold("mg", { href, tile: 300, height: 9, depth: 26, anisotropy: 0.9 });
  const sh = dropContact("sh", 0.6, { distance: 12 });
  const rim = rimLight("rim", "#8FE8FF", 3, { opacity: 0.55, offset: 3 });
  return svgDoc(S, S, defsOf(m, sh, rim) + envGold("eg"), `
    <g filter="${sh.ref}"><g filter="${rim.ref}"><g filter="${m.ref}">
      <path d="M256 44 L 300 168 L 436 168 L 328 248 L 368 380
               L 256 302 L 144 380 L 184 248 L 76 168 L 212 168 Z"
            fill="url(#eg)"/>
    </g></g></g>`);
}

/** Резное дерево: проверка carvedWood. */
function woodProbe(href) {
  const w = carvedWood("cw", { href, tile: 300, height: 10, depth: 18 });
  const sh = dropContact("sh", 0.55, { distance: 12 });
  return svgDoc(S, S, defsOf(w, sh), `
    <g filter="${sh.ref}"><g filter="${w.ref}">
      <rect x="52" y="52" width="408" height="408" rx="46" fill="${w.fill || "#6B4423"}"/>
    </g></g>`);
}

/** Фаска на кнопке: проверка bevel + innerGlow + grain. */
function bevelProbe() {
  const b = bevel("bv", { height: 13, depth: 30, specular: 1.3, shininess: 34, plateau: 0.62 });
  const ig = innerGlow("ig", "#FFF3C4", { size: 14, opacity: 0.5 });
  const sh = dropContact("sh", 0.55, { distance: 12 });
  const gr = grain("gr", 0.05);
  return svgDoc(S, S, defsOf(b, ig, sh, gr) + envGold("g"), `
    <g filter="${sh.ref}"><g filter="${gr.ref}"><g filter="${ig.ref}"><g filter="${b.ref}">
      <circle cx="256" cy="256" r="196" fill="url(#g)"/>
    </g></g></g></g>`);
}

/**
 * Самоцвет в золотой оправе — то, из чего сделан КАЖДЫЙ символ
 * в эталонах Pragmatic. Проверяет, что рецепты складываются:
 * металл оправы, стекло камня и общая контактная тень должны
 * читаться как один предмет с одним источником света.
 */
function setGemProbe(key, sides, rot, href) {
  const gem = SOCHI_GEMS[key];
  const cx = S / 2, cy = S / 2, R = 196;

  const bezel = metalGold("bz", { href, tile: 260, height: 7, depth: 26,
    anisotropy: 0.55, grooves: 0.07, specular: 1.35, shininess: 50 });
  const glass = glassGem("gl", gem, { dome: 7, depth: 32, refraction: 5, edge: 5,
    innerGlow: 0.3, modeling: 1.0 });
  const rim = rimLight("rl", shade(gem.lightest, 0.3), 3, { opacity: 0.45, offset: 3 });
  const ct = contour("ct", "#2C0B22", 4, { opacity: 0.95, softness: 0.7 });
  const sh = dropContact("sh", 0.62, { distance: 15, ambientBlur: 24 });
  const halo = outerGlow("ha", gem.glow, { size: 14, opacity: 0.3, haloOpacity: 0.14 });

  const outer = pointsAttr(ngon(cx, cy, R, sides, rot));
  const inner = pointsAttr(ngon(cx, cy, R * 0.8, sides, rot));

  // Оправа — кольцо: внешний контур минус внутреннее отверстие.
  const ring = `<path d="M ${outer.split(" ").map((p, i) => (i ? "L " : "") + p.replace(",", " ")).join(" ")} Z
                   M ${inner.split(" ").map((p, i) => (i ? "L " : "") + p.replace(",", " ")).join(" ")} Z"
                 fill="url(#eg)" fill-rule="evenodd"/>`;

  return svgDoc(S, S, defsOf(bezel, glass, rim, ct, sh, halo) + envGold("eg", { angle: 100 }), `
    <g filter="${sh.ref}">
      <g filter="${halo.ref}">
        <g filter="${ct.ref}">
          <g filter="${rim.ref}"><g filter="${glass.ref}">
            ${cutGem(gem, { cx, cy, radius: R * 0.86, sides, rotation: rot, contrast: 1.15, deepen: 0.3 })}
          </g></g>
          <g filter="${bezel.ref}">${ring}</g>
        </g>
      </g>
    </g>`);
}

const TESTS = {
  gem_aqua: () => gemProbe("aqua", 12, -90),
  gem_ruby: () => gemProbe("ruby", 6, -90),
  gem_amethyst: () => gemProbe("amethyst", 4, -45, { table: 0.34 }),
  bevel_button: bevelProbe
};

/* ─────────────────────────── прогон ─────────────────────────────── */

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  await fs.mkdir(OUT, { recursive: true });

  // PBR-плитки печём один раз и раздаём как data:-URI.
  let gold = null, wood = null;
  try {
    gold = await detailUri("gold", { size: 384, amount: 0.3, normalStrength: 0.4 });
    wood = await detailUri("wood", { size: 384, amount: 0.4, normalStrength: 0.6 });
    TESTS.metal_gold = () => metalProbe(gold);
    TESTS.gem_set_ruby = () => setGemProbe("ruby", 5, -90, gold);
    TESTS.gem_set_green = () => setGemProbe("emerald", 3, -90, gold);
    TESTS.wood_carved = () => woodProbe(wood);
  } catch (e) {
    console.warn("PBR недоступен:", e.message);
  }

  const names = only.length ? only : Object.keys(TESTS);
  const items = names.map((n) => ({ name: n, svg: namespaceSvg(TESTS[n](), n) }));

  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
  });
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: S + 64, height: S + 64 }
  });
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .cell{display:inline-block;width:max-content;line-height:0;vertical-align:top}
    svg{display:block}
  </style></head><body>
    ${items.map((it, i) => `<div class="cell" id="c${i}">${it.svg}</div>`).join("")}
  </body></html>`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  for (let i = 0; i < items.length; i++) {
    const el = await page.$(`#c${i}`);
    await el.screenshot({ path: path.join(OUT, `${items[i].name}.png`), omitBackground: true });
  }

  // Контрольный лист на фоне барабана — как символы будут видны в игре.
  const sheet = await browser.newPage({ deviceScaleFactor: 1 });
  const cols = Math.min(3, items.length);
  await sheet.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:20px;width:max-content;
         background:linear-gradient(160deg,#2A0B45,#160726 55%,#0B0413);
         display:grid;grid-template-columns:repeat(${cols},280px);gap:14px}
    .c{width:280px;height:280px;display:flex;align-items:center;justify-content:center;
       background:rgba(255,255,255,.05);border-radius:14px;position:relative;overflow:hidden}
    .c svg{width:100%;height:100%}
    .l{position:absolute;bottom:4px;left:0;right:0;text-align:center;
       color:#ffffff90;font:11px sans-serif}
  </style></head><body>
    ${items.map((it) => `<div class="c">${it.svg}<div class="l">${it.name}</div></div>`).join("")}
  </body></html>`, { waitUntil: "load" });
  await sheet.screenshot({ path: path.join(OUT, "_sheet.png"), fullPage: true });

  await browser.close();
  console.log(`✓ ${items.length} шт. → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
