// Стенд для photo.mjs: три плана параллакса из настоящих фотографий.
//
//   node tools/assets/probe-photo.mjs
//
// Результат — tools/assets/probe/_parallax.png и слои ph_*.png.
// Параметры кея здесь ПОДОБРАНЫ ПОД КОНКРЕТНЫЕ СНИМКИ и служат
// образцом вызова, а не готовой сценой: на снежной горе порог по
// яркости выбивает и снег, поэтому для неё берётся кей по цвету неба.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  skyLayer, silhouetteLayer, seaLayer, compose, save, photo, keySilhouette, grade, aerial
} from "./photo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "probe");
const W = 960, H = 540;

const sky = await skyLayer("sky_warm", W, H, { position: "north" });
await save(sky, path.join(OUT, "ph_1_sky.png"));

const mtn = await silhouetteLayer("mtn_dombay", W, Math.round(H * 0.5), {
  position: "centre",
  crop: [0, 0.05, 1, 0.55],
  key: { mode: "color", keyColor: "#F0A860", tolerance: 0.16, softness: 0.10, feather: 1.4 },
  aerial: { amount: 0.42, gradient: 0.35 },
  fade: { left: 0.08, right: 0.08, bottom: 0.12 }
});
await save(mtn, path.join(OUT, "ph_2_mtn.png"));

const sea = await seaLayer("sea_calm", W, Math.round(H * 0.42), {
  position: "south", fade: { top: 0.25 }
});
await save(sea, path.join(OUT, "ph_3_sea.png"));

const palm = await silhouetteLayer("palm_sunset", Math.round(W * 0.42), Math.round(H * 0.9), {
  position: "centre",
  key: { mode: "luma", threshold: 0.40, softness: 0.06, feather: 0.8 },
  aerial: { amount: 0, gradient: 0 },
  grade: { exposure: 0.45, saturation: 0.6 }
});
await save(palm, path.join(OUT, "ph_4_palm.png"));

const scene = await compose(W, H, [
  { buffer: sky, x: 0, y: 0 },
  { buffer: mtn, x: 0, y: Math.round(H * 0.16) },
  { buffer: sea, x: 0, y: Math.round(H * 0.58) },
  { buffer: palm, x: Math.round(W * 0.62), y: Math.round(H * 0.1) }
]);
await save(scene, path.join(OUT, "_parallax.png"));
console.log("ok");
