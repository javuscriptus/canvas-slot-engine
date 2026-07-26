// Фоны сцены «Sochi Sunset». Отдельные файлы для ландшафта и портрета —
// растянуть один фон на оба соотношения нельзя, композиция разваливается.
//
// Композиция от дальнего плана к ближнему: закатное небо с солнцем →
// горы за морем → море с солнечной дорожкой → галечный берег → пальмы
// по краям кадра. К низу всё темнеет: игровое поле обязано оставаться
// самым контрастным пятном на экране.

import { PALETTE as P, SOCHI as S } from "./palette.mjs";
import {
  radial, linear, linearV, blurFilter, svgDoc, ngon, pointsAttr, polar,
  sparkle, namespaceSvg, shade, mix
} from "./svg-lib.mjs";

/** Псевдослучайность с фиксированным зерном: сборка обязана быть детерминированной. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ──────────────────────────── элементы ──────────────────────────── */

/** Горная гряда: ломаная линия с шапками снега на вершинах. */
function ridge(w, y, height, color, snow, rnd, peaks = 7) {
  const pts = [{ x: -40, y: y + height }];
  for (let i = 0; i <= peaks; i++) {
    const x = -40 + ((w + 80) / peaks) * i;
    const hh = height * (0.35 + rnd() * 0.65);
    pts.push({ x, y: y + height - hh });
    pts.push({ x: x + (w + 80) / peaks / 2, y: y + height - hh * (0.3 + rnd() * 0.3) });
  }
  pts.push({ x: w + 40, y: y + height });

  const path = pts.map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(0)} ${p.y.toFixed(0)}`).join(" ");
  let caps = "";
  if (snow) {
    for (let i = 1; i < pts.length - 2; i += 2) {
      const p = pts[i];
      caps += `<path d="M ${p.x - 24} ${p.y + 24} L ${p.x} ${p.y} L ${p.x + 24} ${p.y + 24}
                 L ${p.x + 9} ${p.y + 17} L ${p.x} ${p.y + 22} L ${p.x - 11} ${p.y + 16} Z"
               fill="${snow}" opacity="0.85"/>`;
    }
  }
  return `<g><path d="${path} L ${w + 40} ${y + height + 240} L -40 ${y + height + 240} Z"
    fill="${color}"/>${caps}</g>`;
}

/** Силуэт пальмы: ствол дугой и веер листьев. */
function palm(x, baseY, height, color, flip = false) {
  const s = flip ? -1 : 1;
  let fronds = "";
  for (const a of [-158, -128, -96, -62, -30, -6]) {
    const tip = polar(0, 0, height * 0.52, a);
    const mid = polar(0, 0, height * 0.32, a + 14);
    fronds += `<path d="M 0 0 Q ${mid.x.toFixed(0)} ${mid.y.toFixed(0)}
                 ${tip.x.toFixed(0)} ${tip.y.toFixed(0)}
                 Q ${(mid.x * 1.1).toFixed(0)} ${(mid.y + height * 0.09).toFixed(0)} 0 0 Z"
               fill="${color}"/>`;
  }
  return `
  <g transform="translate(${x.toFixed(0)} ${baseY.toFixed(0)}) scale(${s} 1)">
    <path d="M 0 0 q ${(height * 0.1).toFixed(0)} ${(-height * 0.5).toFixed(0)}
             ${(height * 0.22).toFixed(0)} ${(-height).toFixed(0)}"
          fill="none" stroke="${color}" stroke-width="${Math.max(6, height * 0.055).toFixed(1)}"
          stroke-linecap="round"/>
    <g transform="translate(${(height * 0.22).toFixed(0)} ${(-height).toFixed(0)})">${fronds}
      <circle cx="0" cy="0" r="${(height * 0.045).toFixed(1)}" fill="${color}"/>
    </g>
  </g>`;
}

/** Блики на воде вдоль солнечной дорожки. */
function seaSparkle(rnd, cx, top, bottom, w, count) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const t = rnd();
    const y = top + (bottom - top) * t;
    const spread = w * (0.04 + t * 0.3);
    const x = cx + (rnd() - 0.5) * spread * 2;
    const len = 8 + rnd() * (26 + t * 46);
    const o = 0.12 + rnd() * 0.5 * (1 - t * 0.4);
    out += `<rect x="${(x - len / 2).toFixed(0)}" y="${y.toFixed(0)}"
             width="${len.toFixed(0)}" height="${(2 + rnd() * 3).toFixed(1)}" rx="2"
             fill="${S.sunCore}" opacity="${o.toFixed(3)}"/>`;
  }
  return out;
}

/** Волновые полосы, сгущающиеся к горизонту. */
function waves(w, top, bottom, count) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const y = top + (bottom - top) * Math.pow(t, 1.6);
    out += `<rect x="0" y="${y.toFixed(0)}" width="${w}" height="${(1.5 + t * 3).toFixed(1)}"
             fill="${S.foam}" opacity="${(0.03 + t * 0.09).toFixed(3)}"/>`;
  }
  return out;
}

/* ───────────────────────────── сборка ───────────────────────────── */

function scene(w, h, theme, layout) {
  // Тема фриспинов — то же место после заката.
  const isNight = theme === "free";
  const { horizon, sunY, beachY, stageCx, stageCy, stageR, palmScale } = layout;
  const rnd = seeded(isNight ? 20240717 : 1337);

  const skyTop = isNight ? "#080B2E" : S.skyTop;
  const skyMid = isNight ? "#1E2A6E" : S.skyMid;
  const skyLow = isNight ? "#4A3C8C" : S.skyLow;
  const sunColor = isNight ? "#DCE8FF" : S.sun;
  const sunCore = isNight ? "#FFFFFF" : S.sunCore;
  const seaTop = isNight ? "#123A66" : S.sea;
  const seaBottom = isNight ? "#04122E" : S.seaDeep;
  const sandTone = isNight ? "#3A3A52" : S.sand;
  const palmTone = isNight ? "#040A16" : "#0A2A22";

  const defs = `
    ${linearV("sky", [["0%", skyTop], ["38%", skyMid], ["72%", skyLow], ["100%", sunCore]])}
    ${radial("sunGlow", sunColor + "AA", sunColor + "00")}
    ${radial("sunDisc", sunCore, sunColor)}
    ${linearV("seaGrad", [
      ["0%", shade(seaTop, 0.25)], ["12%", seaTop],
      ["55%", shade(seaTop, -0.35)], ["100%", seaBottom]
    ])}
    ${linearV("sandGrad", [
      ["0%", sandTone], ["45%", shade(sandTone, -0.28)], ["100%", shade(sandTone, -0.62)]
    ])}
    ${radial("stageGlow", (isNight ? "#6FA8FF" : S.sun) + "55", (isNight ? "#6FA8FF" : S.sun) + "00")}
    ${radial("vignette", "#00000000", (isNight ? "#01040F" : "#04121C") + "E6", "50%", "48%", "78%")}
    ${linearV("bottomFade", [["0%", "#00000000"], ["55%", "#000000AA"], ["100%", "#000000EE"]])}
    ${blurFilter("bgSoft", 26)}
    ${blurFilter("bgSofter", 55)}
    ${blurFilter("sunSoft", 14)}
  `;

  const body = `
    <rect width="${w}" height="${horizon + 4}" fill="url(#sky)"/>

    <!-- ореол солнца: под горами, чтобы небо светилось за силуэтами -->
    <circle cx="${stageCx}" cy="${sunY}" r="${(w * 0.3).toFixed(0)}"
            fill="url(#sunGlow)" filter="url(#bgSofter)"/>

    <!-- облачные полосы -->
    ${[0.18, 0.3, 0.42].map((t, i) => `
      <rect x="${(-40 + i * 90).toFixed(0)}" y="${(horizon * t).toFixed(0)}"
            width="${w + 80}" height="${6 + i * 5}" rx="6"
            fill="${sunCore}" opacity="${(0.06 + i * 0.03).toFixed(3)}"/>`).join("")}

    <!-- горы за морем -->
    ${ridge(w, horizon - h * 0.2, h * 0.2, isNight ? "#1A1F4A" : "#6E4A7A",
            isNight ? "#8EA8D8" : "#FFE6F0", rnd, 6)}
    ${ridge(w, horizon - h * 0.13, h * 0.13, isNight ? "#0E1236" : "#4A2E5E", null, rnd, 8)}

    <!-- диск солнца: садится в море, поэтому рисуется поверх гор,
         но под водой — нижняя половина уходит за горизонт -->
    <circle cx="${stageCx}" cy="${sunY}" r="${(w * 0.075).toFixed(0)}"
            fill="url(#sunDisc)" filter="url(#sunSoft)"/>
    <circle cx="${stageCx}" cy="${sunY}" r="${(w * 0.058).toFixed(0)}"
            fill="${sunCore}" opacity="0.92"/>

    <!-- море -->
    <rect x="0" y="${horizon}" width="${w}" height="${beachY - horizon}" fill="url(#seaGrad)"/>
    ${waves(w, horizon, beachY, 13)}
    <path d="M ${(stageCx - w * 0.03).toFixed(0)} ${horizon}
             L ${(stageCx + w * 0.03).toFixed(0)} ${horizon}
             L ${(stageCx + w * 0.22).toFixed(0)} ${beachY}
             L ${(stageCx - w * 0.22).toFixed(0)} ${beachY} Z"
          fill="${sunCore}" opacity="${isNight ? 0.1 : 0.16}" filter="url(#bgSoft)"/>
    ${seaSparkle(rnd, stageCx, horizon + 6, beachY - 10, w, 90)}

    <!-- берег -->
    <path d="M 0 ${beachY} Q ${(w * 0.5).toFixed(0)} ${(beachY - h * 0.03).toFixed(0)} ${w} ${beachY}
             L ${w} ${h} L 0 ${h} Z" fill="url(#sandGrad)"/>
    <path d="M 0 ${beachY} Q ${(w * 0.5).toFixed(0)} ${(beachY - h * 0.03).toFixed(0)} ${w} ${beachY}"
          fill="none" stroke="${S.foam}" stroke-width="5" opacity="0.5"/>

    <!-- пальмы по краям кадра -->
    ${palm(w * 0.085, beachY + h * 0.06, h * palmScale, palmTone)}
    ${palm(w * 0.915, beachY + h * 0.06, h * palmScale * 0.92, palmTone, true)}
    ${palm(w * 0.17, beachY + h * 0.02, h * palmScale * 0.62, shade(palmTone, -0.3))}
    ${palm(w * 0.845, beachY + h * 0.02, h * palmScale * 0.58, shade(palmTone, -0.3), true)}

    <!-- свет под игровым полем -->
    <ellipse cx="${stageCx}" cy="${stageCy}" rx="${stageR}" ry="${(stageR * 0.78).toFixed(0)}"
             fill="url(#stageGlow)" filter="url(#bgSofter)"/>

    <!-- затемнение к низу: панель управления не должна спорить с пейзажем -->
    <rect x="0" y="${(h * 0.62).toFixed(0)}" width="${w}" height="${(h * 0.38).toFixed(0)}"
          fill="url(#bottomFade)"/>
    <rect width="${w}" height="${h}" fill="url(#vignette)"/>

    ${sparkle(w * 0.22, horizon * 0.3, w * 0.009, 0.4)}
    ${sparkle(w * 0.78, horizon * 0.42, w * 0.007, 0.35)}
  `;
  return svgDoc(w, h, defs, body);
}

const LANDSCAPE = {
  horizon: 430, sunY: 424, beachY: 760,
  stageCx: 960, stageCy: 520, stageR: 700, palmScale: 0.5
};
const PORTRAIT = {
  horizon: 760, sunY: 752, beachY: 1240,
  stageCx: 540, stageCy: 900, stageR: 560, palmScale: 0.34
};

const RAW_BG = [
  { name: "bg_landscape", draw: () => scene(1920, 1080, "base", LANDSCAPE) },
  { name: "bg_landscape_free", draw: () => scene(1920, 1080, "free", LANDSCAPE) },
  { name: "bg_portrait", draw: () => scene(1080, 1920, "base", PORTRAIT) },
  { name: "bg_portrait_free", draw: () => scene(1080, 1920, "free", PORTRAIT) }
];

export const BACKGROUNDS = RAW_BG.map((b) => ({
  name: b.name,
  svg: () => namespaceSvg(b.draw(), b.name)
}));
