// Стенд многослойного фона.
//
//   node tools/assets/probe-scenery.mjs                  день, ландшафт
//   node tools/assets/probe-scenery.mjs night portrait
//
// Кладёт в tools/assets/probe/:
//   scene_<вариант>_<ориентация>.png    сведённая композиция 1:1 экрана
//   scene_<…>_layers.png                контактный лист слоёв на шахматке
//   scene_<…>_parallax.png              та же сцена со сдвигом камеры,
//                                       чтобы увидеть, что параллакс есть
//
// Смотреть ОБЯЗАТЕЛЬНО глазами: плоскую сцену числа не ловят.

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, composeScene, place } from "./scenery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "probe");

const variant = process.argv[2] || "day";
const orientation = process.argv[3] || "landscape";

const t0 = Date.now();
const scene = await buildScene({ variant, orientation, log: (...a) => console.log(...a) });
console.log(`сцена собрана за ${((Date.now() - t0) / 1000).toFixed(1)} с`);

await fs.mkdir(OUT, { recursive: true });
const [vw, vh] = scene.view;
const [ox, oy] = scene.offset;

const flatten = (camX = 0, camY = 0) => composeScene(scene, { camX, camY });

const tag = `${variant}_${orientation}`;
await fs.writeFile(path.join(OUT, `scene_${tag}.png`), await flatten(0, 0));
await fs.writeFile(path.join(OUT, `scene_${tag}_parallax.png`), await flatten(0.07, 0.05));

/* Контактный лист слоёв на шахматке — видно альфу и обрезку. */
{
  const CW = 380, CH = Math.round(CW * vh / vw);
  const COLS = 4;
  const rows = Math.ceil(scene.layers.length / COLS);
  const checker = await sharp({
    create: { width: CW, height: CH, channels: 3, background: "#404040" }
  }).composite([{
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">${
      Array.from({ length: Math.ceil(CW / 16) * Math.ceil(CH / 16) }, (_, i) => {
        const cx = i % Math.ceil(CW / 16), cy = Math.floor(i / Math.ceil(CW / 16));
        return (cx + cy) % 2 ? `<rect x="${cx * 16}" y="${cy * 16}" width="16" height="16" fill="#606060"/>` : "";
      }).join("")}</svg>`), top: 0, left: 0
  }]).png().toBuffer();

  const tiles = [];
  for (let i = 0; i < scene.layers.length; i++) {
    const l = scene.layers[i];
    const canvasW = l.canvas[0], canvasH = l.canvas[1];
    const full = await sharp(await place(canvasW, canvasH, [{ buffer: l.buffer, x: l.x, y: l.y }]))
      .resize(CW, CH, { fit: "fill" }).png().toBuffer();
    const kb = (l.buffer.length / 1024).toFixed(0);
    const tile = await sharp(checker).composite([
      { input: full, top: 0, left: 0 },
      { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}"><text x="6" y="18" font-family="monospace" font-size="15" fill="#7CFF3F" stroke="#000" stroke-width="3" paint-order="stroke">${l.z}. ${l.name}  ${l.w}x${l.h} ${kb}k</text></svg>`), top: 0, left: 0 }
    ]).png().toBuffer();
    tiles.push({ input: tile, left: (i % COLS) * CW, top: Math.floor(i / COLS) * CH });
  }
  await sharp({ create: { width: CW * COLS, height: CH * rows, channels: 3, background: "#202020" } })
    .composite(tiles).png().toFile(path.join(OUT, `scene_${tag}_layers.png`));
}

console.log("готово:", path.join(OUT, `scene_${tag}.png`));
for (const l of scene.layers) {
  console.log(`  ${String(l.z).padStart(2)} ${l.name.padEnd(12)} ${String(l.w).padStart(5)}x${String(l.h).padStart(4)} @ ${l.x},${l.y}  ${(l.buffer.length / 1024).toFixed(0)} KB png`);
}
