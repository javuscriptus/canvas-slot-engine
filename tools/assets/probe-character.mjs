// Стенд персонажа.
//
//   node tools/assets/probe-character.mjs            слои + сборка
//   node tools/assets/probe-character.mjs --scene    сборка на фоне барабанов
//
// Результат — tools/assets/probe/char/. Смотреть ГЛАЗАМИ: composite.png
// (фигура на закатном градиенте) и _layers.png (контрольный лист слоёв).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

import { layers, DRAW_ORDER, FIGURE } from "./character.mjs";
import { detailUri } from "./pbr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "probe/char");

async function rasterize(items, scale = 1) {
  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
  });
  const maxW = Math.max(...items.map((i) => i.w));
  const maxH = Math.max(...items.map((i) => i.h));
  const page = await browser.newPage({
    deviceScaleFactor: scale,
    viewport: { width: Math.ceil(maxW) + 40, height: Math.ceil(maxH) + 40 }
  });
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .cell{display:inline-block;width:max-content;line-height:0;vertical-align:top}
    svg{display:block}
  </style></head><body>
    ${items.map((it, i) => `<div class="cell" id="c${i}">${it.svg}</div>`).join("")}
  </body></html>`, { waitUntil: "load" });

  const out = [];
  for (let i = 0; i < items.length; i++) {
    const el = await page.$(`#c${i}`);
    out.push({ ...items[i], buffer: await el.screenshot({ omitBackground: true }) });
  }
  await browser.close();
  return out;
}

function ns(svg, prefix) {
  return svg
    .replace(/id="([A-Za-z][\w-]*)"/g, (_, id) => `id="${prefix}__${id}"`)
    .replace(/url\(#([A-Za-z][\w-]*)\)/g, (_, id) => `url(#${prefix}__${id})`);
}

// Крупный план головы — самый частый цикл правок. Растеризуется в 2×,
// потому что оценивать лицо по 380-пиксельному кадру бессмысленно.
const GROUPS = {
  head: ["char_head", "char_eyes_open", "char_moustache", "char_hat"],
  blink: ["char_head", "char_eyes_closed", "char_moustache", "char_hat"],
  torso: ["char_arm_left", "char_body", "char_arm_right", "char_hand_glass"]
};

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const argv = process.argv.slice(2);
  const groupKey = argv.find((a) => GROUPS[a.replace(/^--/, "")]) || null;
  const group = groupKey ? GROUPS[groupKey.replace(/^--/, "")] : null;

  let gold = null;
  try {
    gold = await detailUri("gold", { size: 320, amount: 0.34, normalStrength: 0.45 });
  } catch (e) { console.warn("PBR недоступен:", e.message); }

  const L = layers(gold).filter((l) => !group || group.includes(l.name));
  const scale = group ? 2 : 1;
  const items = L.map((l) => ({
    name: l.name, box: l.box, w: l.box.w, h: l.box.h, svg: ns(l.svg, l.key)
  }));

  const t = Date.now();
  const rendered = await rasterize(items, scale);
  console.log(`растеризовано ${rendered.length} слоёв за ${((Date.now() - t) / 1000).toFixed(1)} с`);

  const byName = new Map();
  for (const r of rendered) {
    byName.set(r.name, r);
    await fs.writeFile(path.join(OUT, `${r.name}.png`), r.buffer);
  }

  // ── сборка фигуры (или группы)
  const order = (group || DRAW_ORDER).filter((n) => byName.has(n));
  const ox = group ? Math.min(...order.map((n) => byName.get(n).box.x)) : 0;
  const oy = group ? Math.min(...order.map((n) => byName.get(n).box.y)) : 0;
  const W = group
    ? Math.round((Math.max(...order.map((n) => byName.get(n).box.x + byName.get(n).box.w)) - ox) * scale)
    : FIGURE.width;
  const H = group
    ? Math.round((Math.max(...order.map((n) => byName.get(n).box.y + byName.get(n).box.h)) - oy) * scale)
    : FIGURE.height;

  const comp = order.map((n) => {
    const r = byName.get(n);
    return { input: r.buffer, left: Math.round((r.box.x - ox) * scale),
             top: Math.round((r.box.y - oy) * scale) };
  });

  const figure = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite(comp).png().toBuffer();
  const figName = group ? `figure_${groupKey.replace(/^--/, "")}.png` : "figure.png";
  await fs.writeFile(path.join(OUT, figName), figure);
  if (group) { console.log(`✓ → ${path.join(OUT, figName)}`); return; }

  // ── на закатном фоне, в масштабе экрана слота
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
      <defs>
        <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2A1B5E"/><stop offset="42%" stop-color="#C94E7A"/>
          <stop offset="68%" stop-color="#FF8A4C"/><stop offset="82%" stop-color="#0E6E8C"/>
          <stop offset="100%" stop-color="#062E45"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#s)"/>
      <circle cx="900" cy="470" r="86" fill="#FFD166" opacity="0.9"/>
      <rect x="70" y="60" width="740" height="560" rx="20" fill="#2A0B45" opacity="0.85"/>
      ${[...Array(30)].map((_, i) => {
        const c = i % 6, r = (i / 6) | 0;
        return `<rect x="${86 + c * 122}" y="${76 + r * 110}" width="110" height="98" rx="10"
                 fill="#3D1163" opacity="0.7"/>`;
      }).join("")}
    </svg>`);

  const charH = 640;                       // ~89 % высоты кадра 720
  const charW = Math.round(FIGURE.width * (charH / FIGURE.height));
  const scaled = await sharp(figure).resize(charW, charH).png().toBuffer();
  const scene = await sharp(bg).png().toBuffer();
  await sharp(scene)
    .composite([{ input: scaled, left: 1280 - charW - 10, top: 720 - charH }])
    .png().toFile(path.join(OUT, "scene.png"));

  // ── контрольный лист слоёв
  const cells = rendered.map((r) =>
    `<div class="c"><img src="data:image/png;base64,${r.buffer.toString("base64")}">
     <div class="l">${r.name}<br>${r.box.w}×${r.box.h}</div></div>`).join("");
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:14px;width:max-content;background:#20102c;
         display:grid;grid-template-columns:repeat(6,220px);gap:10px}
    .c{width:220px;height:260px;display:flex;align-items:center;justify-content:center;
       background:rgba(255,255,255,.06);border-radius:10px;position:relative;overflow:hidden}
    .c img{max-width:94%;max-height:88%}
    .l{position:absolute;bottom:3px;left:0;right:0;text-align:center;color:#fffc;font:10px sans-serif}
  </style></head><body>${cells}</body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: path.join(OUT, "_layers.png"), fullPage: true });
  await browser.close();

  console.log(`✓ → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
